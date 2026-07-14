import { Hono } from "@hono/hono";
import { cors } from "@hono/hono/cors";
import { upgradeWebSocket } from "@hono/hono/deno";
import { registerErrorMiddleware } from "@publicdomainrelay/hono-error-middleware";
import { createLogger, type LoggerInterface } from "@publicdomainrelay/logger";
import type { Storage, Signer, Did, Sequencer, RepoApi } from "@publicdomainrelay/atproto-repo-abc";
import { XrpcError } from "@publicdomainrelay/atproto-repo-abc";
import { Repo } from "@publicdomainrelay/atproto-repo-deno";
import { signServiceAuth } from "@publicdomainrelay/atproto-repo-deno";
import { createAccountStore } from "@publicdomainrelay/atproto-repo-deno";
import type { AccountStore } from "@publicdomainrelay/atproto-repo-deno";
import type { SubscribeHandler } from "@publicdomainrelay/atproto-repo-common";
import { mountRepoRoutes } from "./repo-handlers.ts";
import { mountSyncRoutes } from "./sync-handlers.ts";
import { FirehoseSequencer } from "./sequencer.ts";
import { createSubscribeHandler } from "./subscribe.ts";
// OAuth server
import {
  createMemoryTokenStore,
  createSessionInjector,
  createDpopVerifier,
  createDpopNonceStore,
} from "@publicdomainrelay/atproto-oauth-server-deno";
import type {
  DpopNonceStore,
  DpopVerifier,
  SessionInjector,
  TokenStore,
} from "@publicdomainrelay/atproto-oauth-server-abc";
import { DPOP_NONCE_HEADER, DPoP_AUTH_SCHEME, DPoP_HEADER } from "@publicdomainrelay/oauth-server-common";

export interface RepoFactoryOptions {
  storage: Storage;
  signer: Signer;
  did?: Did;
  sequencer?: Sequencer;
  baseOrigin?: string;
  didWebServices?: Array<{ id: string; type: string }>;
  publicHostname?: string;
  crawlers?: string[];
  log?: LoggerInterface;
  /** did:key public key for the atproto signing key (published as verificationMethod in did:web doc). */
  publicKeyDid?: string;
  /** did:key public key for the attestation key (published as verificationMethod in did:web doc). */
  attestationKeyDid?: string;
  /** Enable test-only OAuth authorization server. Mounts well-known endpoints,
   *  DPoP-protected token endpoint (refresh_token grant), DPoP middleware on
   *  XRPC routes, and exposes a SessionInjector for programmatic token issuance. */
  oauthServer?: {
    enabled: boolean;
    issuer: string; // "http://127.0.0.1:PORT" — actual port resolved at route time from Host header
  };
}

export interface RepoFactory {
  app: Hono;
  subscribe: SubscribeHandler;
  api: RepoApi;
  sequencer: Sequencer;
  /** Only present when oauthServer.enabled. Issues programmatic OAuth tokens. */
  sessionInjector?: SessionInjector;
}

function extractBearer(authHeader?: string): string | null {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function b64urlToStandard(b64urlStr: string): string {
  let s = b64urlStr.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4 !== 0) s += "=";
  return s;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(atob(b64urlToStandard(parts[1])));
  } catch { return null; }
}

export function createRepoFactory(opts: RepoFactoryOptions): RepoFactory {
  const repo = new Repo(opts.storage, opts.signer, opts.did);
  const did = opts.did ?? opts.signer.did();
  const sequencer = opts.sequencer ?? new FirehoseSequencer();
  const log = opts.log ?? createLogger("pds");

  const accountStore: AccountStore = createAccountStore(did, opts.signer);
  const userSigners = new Map<string, Signer>();

  const app = new Hono();

  app.use("*", cors());

  app.use("*", async (c, next) => {
    c.set("requesterDid" as never, did as never);
    await next();
  });

  registerErrorMiddleware(app, log);

  app.get("/xrpc/_health", (c) => {
    return c.json({ version: "0.0.0" });
  });

  app.get("/xrpc/com.atproto.server.describeServer", (c) => {
    return c.json({
      did,
      version: "0.0.0",
      availableUserDomains: [],
      inviteCodeRequired: false,
    });
  });

  app.get("/.well-known/atproto-did", (c) => {
    return c.text(did);
  });

  if (opts.didWebServices && opts.didWebServices.length > 0) {
    app.get("/.well-known/did.json", (c) => {
      const host = (c.req.header("host") ?? "").split(":")[0];
      if (!host) {
        throw new XrpcError("InvalidRequest", "missing Host header");
      }
      const verificationMethod: Array<{ id: string; type: string; controller: string; publicKeyMultibase: string }> = [];
      if (opts.publicKeyDid) {
        verificationMethod.push({
          id: `did:web:${host}#atproto`,
          type: "Multikey",
          controller: `did:web:${host}`,
          publicKeyMultibase: opts.publicKeyDid.replace(/^did:key:/, ""),
        });
      }
      if (opts.attestationKeyDid) {
        verificationMethod.push({
          id: `did:web:${host}#attestation`,
          type: "Multikey",
          controller: `did:web:${host}`,
          publicKeyMultibase: opts.attestationKeyDid.replace(/^did:key:/, ""),
        });
      }
      const context: string[] = ["https://www.w3.org/ns/did/v1"];
      if (verificationMethod.length > 0) context.push("https://w3id.org/security/multikey/v1");
      return c.json({
        "@context": context,
        id: `did:web:${host}`,
        ...(verificationMethod.length > 0 ? { verificationMethod } : {}),
        service: opts.didWebServices!.map((s) => ({
          id: s.id.startsWith("#") ? s.id : `#${s.id}`,
          type: s.type,
          serviceEndpoint: `https://${host}`,
        })),
      });
    });
  }

  // ── PDS auth middleware ─────────────────────────────────────────────

  async function requirePdsAuth(c: { req: { header: (name: string) => string | undefined }; json: (body: unknown, status: number) => unknown }, next: () => Promise<void>) {
    const token = extractBearer(c.req.header("authorization"));
    if (!token) {
      return c.json({ error: "AuthenticationRequired", message: "missing Authorization header" }, 401);
    }
    const payload = decodeJwtPayload(token);
    if (!payload || !payload.sub) {
      return c.json({ error: "AuthenticationRequired", message: "invalid access token" }, 401);
    }
    const result = accountStore.validateAccessJwt(token);
    if (!result) {
      return c.json({ error: "AuthenticationRequired", message: "token expired or invalid" }, 401);
    }
    (c as Record<string, unknown>).set = (key: string, value: unknown) => {
      (c as Record<string, unknown>)[`_ctx_${key}`] = value;
    };
    (c as Record<string, unknown>)["_ctx_authDid"] = result.did;
    (c as Record<string, unknown>)["_ctx_authHandle"] = result.handle;
    await next();
  }

  // ── createAccount ───────────────────────────────────────────────────

  app.post("/xrpc/com.atproto.server.createAccount", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "InvalidRequest", message: "invalid JSON" }, 400);
    }

    const handle = (body.handle as string) || undefined;
    const email = (body.email as string) || undefined;
    const password = (body.password as string) || undefined;

    try {
      const result = await accountStore.createAccount({ handle, email, password });
      userSigners.set(result.did, result.signer);
      return c.json({
        accessJwt: result.accessJwt,
        refreshJwt: result.refreshJwt,
        handle: result.handle,
        did: result.did,
      });
    } catch (err) {
      log.error("createAccount failed", { error: String(err) });
      return c.json({ error: "InternalError", message: "failed to create account" }, 500);
    }
  });

  // ── createSession ───────────────────────────────────────────────────

  app.post("/xrpc/com.atproto.server.createSession", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "InvalidRequest", message: "invalid JSON" }, 400);
    }
    const identifier = body.identifier as string | undefined;
    const password = body.password as string | undefined;
    if (!identifier || !password) {
      return c.json({ error: "InvalidRequest", message: "identifier and password required" }, 400);
    }

    const valid = await accountStore.validatePassword(identifier, password);
    if (!valid) {
      return c.json({ error: "AuthenticationRequired", message: "invalid identifier or password" }, 401);
    }

    const account = accountStore.getAccount(identifier)!;
    const tokens = await accountStore.createSessionTokens(account.did, account.handle);
    return c.json({
      accessJwt: tokens.accessJwt,
      refreshJwt: tokens.refreshJwt,
      handle: account.handle,
      did: account.did,
    });
  });

  // ── getServiceAuth ──────────────────────────────────────────────────

  app.get("/xrpc/com.atproto.server.getServiceAuth", async (c) => {
    const aud = c.req.query("aud");
    if (!aud) {
      return c.json({ error: "InvalidRequest", message: 'missing required "aud" param' }, 400);
    }
    const lxm = c.req.query("lxm") ?? undefined;
    const expQ = c.req.query("exp");

    // Check for Authorization header — if present, use the authenticated user's signer.
    // Otherwise fall back to PDS's own signer (backward compat).
    const authHeader = c.req.header("authorization");
    const token = extractBearer(authHeader);
    let signer = opts.signer;
    if (token) {
      const result = accountStore.validateAccessJwt(token);
      if (result) {
        const userSigner = userSigners.get(result.did);
        if (userSigner) signer = userSigner;
      }
    }

    const serviceAuthToken = await signServiceAuth(signer, {
      aud,
      lxm,
      expiresInSec: expQ
        ? Math.max(0, parseInt(expQ) - Math.floor(Date.now() / 1000))
        : undefined,
    });
    return c.json({ token: serviceAuthToken });
  });

  const requestCrawlDebounce = new Map<string, number>();

  const wiredRepo: RepoApi = {
    describe: (d) => repo.describe(d),
    getRecord: (d, c, r) => repo.getRecord(d, c, r),
    listRecords: (d, c, o) => repo.listRecords(d, c, o),
    async applyWrites(d, writes) {
      const evt = await repo.applyWrites(d, writes);
      sequencer.append(evt);
      if (opts.crawlers && opts.publicHostname) {
        const now = Date.now();
        for (const rawUrl of opts.crawlers) {
          const last = requestCrawlDebounce.get(rawUrl) ?? 0;
          if (now - last < 1000) continue;
          requestCrawlDebounce.set(rawUrl, now);
          const url = new URL("/xrpc/com.atproto.sync.requestCrawl", rawUrl);
          fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ hostname: opts.publicHostname }),
          }).catch(() => {});
        }
      }
      return evt;
    },
  };

  // ── OAuth authorization server (test-only) ────────────────────────────
  // MUST be BEFORE mountRepoRoutes/mountSyncRoutes so the DPoP middleware
  // runs before the XRPC route handlers registered by those functions.

  let sessionInjector: SessionInjector | undefined;

  if (opts.oauthServer?.enabled) {
    const tokenStore: TokenStore = createMemoryTokenStore(opts.signer);
    const dpopVerifier: DpopVerifier = createDpopVerifier();
    const dpopNonceStore: DpopNonceStore = createDpopNonceStore();
    sessionInjector = createSessionInjector(tokenStore, opts.oauthServer.issuer);

    // Resolve issuer from request Host header (handles port: 0 dynamic assignment)
    function resolveIssuer(c: { req: { header: (n: string) => string | undefined } }): string {
      const host = c.req.header("host") ?? "127.0.0.1";
      const scheme = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
      return `${scheme}://${host}`;
    }

    // /.well-known/oauth-protected-resource
    app.get("/.well-known/oauth-protected-resource", (c) => {
      const issuer = resolveIssuer(c);
      return c.json({
        resource: issuer,
        authorization_servers: [issuer],
      });
    });

    // /.well-known/oauth-authorization-server
    app.get("/.well-known/oauth-authorization-server", (c) => {
      const issuer = resolveIssuer(c);
      return c.json({
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        pushed_authorization_request_endpoint: `${issuer}/oauth/par`,
        require_pushed_authorization_requests: true,
        token_endpoint_auth_methods_supported: ["none"],
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        dpop_signing_alg_values_supported: ["ES256"],
        code_challenge_methods_supported: ["S256"],
        scopes_supported: ["atproto"],
      });
    });

    // POST /oauth/token — refresh_token grant only (test-mode: skips client auth)
    app.post("/oauth/token", async (c) => {
      let body: URLSearchParams;
      try {
        const text = await c.req.text();
        body = new URLSearchParams(text);
      } catch {
        return c.json({ error: "invalid_request" }, 400);
      }

      const grantType = body.get("grant_type");
      const dpopProofHeader = c.req.header(DPoP_HEADER);

      // Issue nonce header on every response
      const origin = resolveIssuer(c);
      const nonce = await dpopNonceStore.issue(origin);
      const headers: Record<string, string> = { [DPOP_NONCE_HEADER]: nonce };

      if (!dpopProofHeader) {
        return c.json({ error: "use_dpop_nonce" }, 400, headers);
      }

      // Verify DPoP proof (no access token yet — ath not required for refresh)
      const proofValidation = await dpopVerifier.verifyProof(
        dpopProofHeader, "POST", resolveIssuer(c) + "/oauth/token",
      );
      if (!proofValidation) {
        return c.json({ error: "invalid_dpop_proof" }, 401, headers);
      }

      if (grantType === "refresh_token") {
        const refreshToken = body.get("refresh_token");
        if (!refreshToken) {
          return c.json({ error: "invalid_request", error_description: "missing refresh_token" }, 400, headers);
        }

        const result = await tokenStore.refresh(refreshToken);
        if (!result) {
          return c.json({ error: "invalid_grant", error_description: "invalid or expired refresh token" }, 400, headers);
        }

        return c.json({
          access_token: result.accessToken,
          token_type: "DPoP",
          refresh_token: result.refreshToken,
          expires_in: result.expiresIn,
          scope: "atproto",
        }, 200, headers);
      }

      return c.json({ error: "unsupported_grant_type" }, 400, headers);
    });

    // ── DPoP auth middleware for XRPC routes ─────────────────────────────

    app.use("/xrpc/*", async (c, next) => {
      const authHeader = c.req.header("authorization") ?? "";
      if (!authHeader.startsWith(`${DPoP_AUTH_SCHEME} `)) {
        // No DPoP token — fall through to default requesterDid (PDS itself)
        await next();
        return;
      }

      const token = authHeader.slice(DPoP_AUTH_SCHEME.length + 1).trim();
      const dpopProof = c.req.header(DPoP_HEADER);
      if (!dpopProof) {
        const nonce = await dpopNonceStore.issue(resolveIssuer(c));
        return c.json({ error: "use_dpop_nonce" }, 401, { [DPOP_NONCE_HEADER]: nonce });
      }

      // Verify DPoP proof (with ath check against access token)
      const proofValidation = await dpopVerifier.verifyProof(
        dpopProof, c.req.method, resolveIssuer(c) + new URL(c.req.url).pathname, token,
      );
      if (!proofValidation) {
        const nonce = await dpopNonceStore.issue(resolveIssuer(c));
        return c.json({ error: "invalid_dpop_proof" }, 401, { [DPOP_NONCE_HEADER]: nonce });
      }

      // Validate the access token
      const tokenData = await tokenStore.validate(token);
      if (!tokenData) {
        return c.json({ error: "invalid_token" }, 401);
      }

      // Verify token's jkt matches proof's jkt (DPoP binding)
      if (tokenData.jkt !== proofValidation.jkt) {
        return c.json({ error: "invalid_token", error_description: "token not bound to this DPoP key" }, 401);
      }

      // Emit nonce on successful responses too
      const nonce = await dpopNonceStore.issue(resolveIssuer(c));
      c.header(DPOP_NONCE_HEADER, nonce);

      // In this single-tenant PDS, all repo operations go to the PDS's DID.
      // The token's sub identifies the authenticated user but requesterDid
      // stays as the PDS DID for repo routing. Store auth'd user DID separately.
      c.set("oauthUserDid" as never, tokenData.sub as never);
      await next();
    });
  }

  // ── XRPC routes (AFTER DPoP middleware so middleware runs first) ────────

  mountRepoRoutes(app, wiredRepo);
  mountSyncRoutes(app, { repo: wiredRepo, storage: opts.storage });

  const subscribe = createSubscribeHandler(sequencer);

  const subscribeReposHandler = upgradeWebSocket((c) => {
    const cursorQ = c.req.query("cursor");
    const params: Record<string, string> = {};
    if (cursorQ) params.cursor = cursorQ;
    let unsubscribe: (() => void) | void = undefined;
    return {
      onOpen(_evt, ws) {
        unsubscribe = subscribe({ nsid: "com.atproto.sync.subscribeRepos", params }, (frame) => {
          try { ws.send(JSON.stringify(frame)); } catch { /* ws closed */ }
        });
      },
      onClose() { if (unsubscribe) unsubscribe(); },
      onError() { if (unsubscribe) unsubscribe(); },
    };
  });
  app.get("/xrpc/com.atproto.sync.subscribeRepos", subscribeReposHandler);

  return {
    app,
    subscribe,
    api: wiredRepo,
    sequencer,
    ...(sessionInjector ? { sessionInjector } : {}),
  };
}

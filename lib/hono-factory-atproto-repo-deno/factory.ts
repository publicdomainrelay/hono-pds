import { Hono } from "@hono/hono";
import { cors } from "@hono/hono/cors";
import { upgradeWebSocket } from "@hono/hono/deno";
import { registerErrorMiddleware } from "@publicdomainrelay/hono-error-middleware";
import { createLogger, type LoggerInterface } from "@publicdomainrelay/logger";
import type { Storage, Signer, Did, Sequencer, RepoApi } from "@publicdomainrelay/atproto-repo-abc";
import { XrpcError } from "@publicdomainrelay/atproto-repo-abc";
import { Repo } from "@publicdomainrelay/atproto-repo-deno";
import { signServiceAuth, verifyServiceAuthToken } from "@publicdomainrelay/atproto-repo-deno";
import { createAccountStore } from "@publicdomainrelay/atproto-repo-deno";
import type { AccountStore } from "@publicdomainrelay/atproto-repo-deno";
import type { SubscribeHandler } from "@publicdomainrelay/atproto-repo-common";
import { base32Encode, drislEncode, encode as cborEncode } from "@publicdomainrelay/atproto-repo-common";
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
  createMemoryAuthorizationCodeStore,
  createMemoryParStore,
  fetchClientMetadata,
  verifyClientAssertion,
} from "@publicdomainrelay/atproto-oauth-server-deno";
import type { AuthorizationCodeStore, ParStore } from "@publicdomainrelay/atproto-oauth-server-deno";
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
  /** Admin password for admin-protected endpoints (HTTP Basic). */
  adminPassword?: string;
  /** PLC directory URL for did:plc account creation. Without this, did:key is used. */
  plcDirectoryUrl?: string;
  /** Firehose subscribeRepos wire format. "drisl" (default) for binary DRISL frames;
   *  "json" for JSON string frames (compatible with atproto-relay and firehose watchers). */
  subscribeReposFormat?: "drisl" | "json";
}

export interface RepoFactory {
  app: Hono;
  subscribe: SubscribeHandler;
  api: RepoApi;
  sequencer: Sequencer;
  /** Only present when oauthServer.enabled. Issues programmatic OAuth tokens. */
  sessionInjector?: SessionInjector;
  /** Get the signer for an account DID (for service auth token generation). */
  getUserSigner(did: Did): Signer | undefined;
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

function bytesToBase64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface PlcGenesis {
  did: Did;
  op: Record<string, unknown>;
}

/**
 * did:plc genesis per spec v0.3.0: the identifier is
 * base32(sha256(dag-cbor(signed op))[0..15]), and the op is published at
 * `POST {plcDirectoryUrl}/{did}` — the derived did:plc, never the rotation key.
 */
async function buildPlcGenesis(
  kp: { did: () => string; sign: (b: Uint8Array) => Promise<Uint8Array> },
  opts: { pdsEndpoint: string; handle?: string },
): Promise<PlcGenesis> {
  const rotationKey = kp.did();
  const unsigned = {
    type: "plc_operation",
    rotationKeys: [rotationKey],
    verificationMethods: { atproto: rotationKey },
    alsoKnownAs: opts.handle ? [`at://${opts.handle}`] : [],
    services: {
      atproto_pds: { type: "AtprotoPersonalDataServer", endpoint: opts.pdsEndpoint },
    },
    prev: null,
  };
  const sig = bytesToBase64url(await kp.sign(cborEncode(unsigned)));
  const op = { ...unsigned, sig };
  const signedBytes = new Uint8Array(cborEncode(op));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", signedBytes.buffer));
  return { did: `did:plc:${base32Encode(hash.slice(0, 15))}` as Did, op };
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

  const adminPassword = opts.adminPassword;
  const plcDirectoryUrl = opts.plcDirectoryUrl;

  // ── Admin auth middleware ───────────────────────────────────────────

  function requireAdminAuth(c: { req: { header: (name: string) => string | undefined }; json: (body: unknown, status: number) => unknown }, next: () => Promise<void>) {
    if (!adminPassword) {
      return c.json({ error: "AuthenticationRequired", message: "admin not configured" }, 401);
    }
    const authHeader = c.req.header("authorization") ?? "";
    if (!authHeader.startsWith("Basic ")) {
      return c.json({ error: "AuthenticationRequired", message: "admin Basic auth required" }, 401);
    }
    const creds = atob(authHeader.slice(6));
    const [user, pw] = creds.split(":");
    if (user !== "admin" || pw !== adminPassword) {
      return c.json({ error: "AuthenticationRequired", message: "invalid admin credentials" }, 401);
    }
    return next();
  }

  // ── Unified auth middleware (DPoP or Bearer service/access JWT) ────

  async function requireAuth(c: { req: { header: (name: string) => string | undefined; path?: string }; json: (body: unknown, status: number) => unknown; set: (k: string, v: unknown) => void; get: (k: string) => unknown }, next: () => Promise<void>) {
    // DPoP middleware already validated — use oauthUserDid if set
    const oauthDid = c.get("oauthUserDid") as Did | undefined;
    if (oauthDid) {
      c.set("requesterDid" as never, oauthDid as never);
      return next();
    }

    // Try Bearer auth: service auth JWT first, then legacy access JWT
    const token = extractBearer(c.req.header("authorization"));
    if (!token) {
      return c.json({ error: "AuthenticationRequired", message: "valid DPoP or Bearer token required" }, 401);
    }

    // Extract lxm from request path (e.g. /xrpc/com.atproto.repo.createRecord → com.atproto.repo.createRecord)
    const path = c.req.path ?? "";
    const lxm = path.startsWith("/xrpc/") ? path.slice("/xrpc/".length) : undefined;

    const svc = await verifyServiceAuthToken(token, {
      audDid: did,
      lxm,
      isHostedAccount: (queryDid: Did) => accountStore.getAccount(queryDid) !== undefined,
    });
    if (svc) {
      c.set("requesterDid" as never, svc.iss as never);
      return next();
    }

    const legacy = await accountStore.validateAccessJwt(token);
    if (legacy) {
      c.set("requesterDid" as never, legacy.did as never);
      return next();
    }

    return c.json({ error: "AuthenticationRequired", message: "invalid token" }, 401);
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
      let didOverride: Did | undefined;
      let signerOverride: Signer | undefined;
      // did:plc path: if plcDirectoryUrl configured, create PLC DID
      if (plcDirectoryUrl) {
        const { Secp256k1Keypair } = await import("@atproto/crypto");
        const kp = await Secp256k1Keypair.create({ exportable: true });
        // The genesis op advertises where this account's repo actually lives.
        // publicHostname wins; otherwise trust the Host the client reached us on,
        // which keeps ephemeral (port 0) deployments self-configuring.
        const hostHeader = c.req.header("host") ?? "";
        const authority = opts.publicHostname || hostHeader;
        if (!authority) {
          return c.json(
            { error: "InvalidRequest", message: "cannot determine PDS endpoint: no publicHostname or Host header" },
            400,
          );
        }
        const scheme = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(authority) ? "http" : "https";
        const { did: plcDid, op } = await buildPlcGenesis(kp, {
          pdsEndpoint: `${scheme}://${authority}`,
          handle,
        });
        const plcRes = await fetch(`${plcDirectoryUrl}/${plcDid}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(op),
        });
        if (!plcRes.ok) {
          const detail = await plcRes.text().catch(() => "");
          log.error("createAccount PLC genesis rejected", { did: plcDid, status: plcRes.status, detail });
          return c.json(
            { error: "InternalError", message: `PLC directory rejected genesis op: ${plcRes.status} ${detail}` },
            500,
          );
        }
        didOverride = plcDid;
        signerOverride = {
          did: () => plcDid,
          sign: (bytes: Uint8Array) => kp.sign(bytes),
        };
      }
      const result = await accountStore.createAccount({ handle, email, password, didOverride, signerOverride });
      userSigners.set(result.did, result.signer);
      // Bootstrap an empty repo for the new account
      await repo.applyWrites(result.did, []);
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

  // ── refreshSession ────────────────────────────────────────────────

  app.post("/xrpc/com.atproto.server.refreshSession", async (c) => {
    const authHeader = c.req.header("authorization");
    const token = extractBearer(authHeader);
    if (!token) {
      return c.json({ error: "AuthenticationRequired", message: "missing Authorization header" }, 401);
    }
    const result = await accountStore.validateRefreshJwt(token);
    if (!result) {
      return c.json({ error: "AuthenticationRequired", message: "token expired or invalid" }, 401);
    }
    const tokens = await accountStore.createSessionTokens(result.did, result.handle);
    const account = accountStore.getAccount(result.did);
    return c.json({
      accessJwt: tokens.accessJwt,
      refreshJwt: tokens.refreshJwt,
      handle: account?.handle ?? result.handle,
      did: result.did,
    });
  });

  // ── Admin-protected endpoints ─────────────────────────────────────

  const inviteCodes = new Set<string>();

  app.post("/xrpc/com.atproto.server.createInviteCode", requireAdminAuth, async (c) => {
    let body: Record<string, unknown> = {};
    try { body = await c.req.json().catch(() => ({})); } catch { /* optional */ }
    const useCount = (body.useCount as number) ?? 1;
    const codes: string[] = [];
    for (let i = 0; i < useCount; i++) {
      const code = `${btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(12))))}-${Date.now().toString(36)}`;
      inviteCodes.add(code);
      codes.push(code);
    }
    return c.json({ code: codes[0], codes });
  });

  app.post("/xrpc/com.atproto.server.createInviteCodes", requireAdminAuth, async (c) => {
    let body: Record<string, unknown> = {};
    try { body = await c.req.json().catch(() => ({})); } catch { /* optional */ }
    const count = (body.codeCount as number) ?? 1;
    const useCount = (body.useCount as number) ?? 1;
    const codes: { code: string; available: number }[] = [];
    for (let i = 0; i < count; i++) {
      const code = `${btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(12))))}-${Date.now().toString(36)}`;
      inviteCodes.add(code);
      codes.push({ code, available: useCount });
    }
    return c.json({ codes });
  });

  app.post("/xrpc/com.atproto.admin.getInviteCodes", requireAdminAuth, async (c) => {
    return c.json({ codes: [...inviteCodes].map((code) => ({ code, available: 1, disabled: false })) });
  });

  // ── getServiceAuth ──────────────────────────────────────────────────

  async function handleGetServiceAuth(c: { req: { query: (name: string) => string | undefined }; json: (body: unknown, status?: number) => unknown }) {
    const aud = c.req.query("aud");
    if (!aud) {
      return c.json({ error: "InvalidRequest", message: 'missing required "aud" param' }, 400);
    }
    const lxm = c.req.query("lxm") ?? undefined;
    const expQ = c.req.query("exp");

    // OAuth DPoP path: resolve signer from the authenticated user session
    let signer = opts.signer;
    const oauthDid = (c as unknown as { get: (k: string) => unknown }).get("oauthUserDid") as Did | undefined;
    if (oauthDid) {
      const userSigner = userSigners.get(oauthDid);
      if (userSigner) signer = userSigner;
    }
    // Fall back to Bearer token (legacy access JWT)
    if (signer === opts.signer) {
      const authHeader = (c as unknown as { req: { header: (name: string) => string | undefined } }).req.header("authorization");
      const token = extractBearer(authHeader);
      if (token) {
        const result = await accountStore.validateAccessJwt(token);
        if (result) {
          const userSigner = userSigners.get(result.did);
          if (userSigner) signer = userSigner;
        }
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
  }

  // requestCrawl is a registration, not a keepalive: a relay treats it as
  // "(re)subscribe from scratch" and tears down the live firehose socket to obey.
  // Announcing on every write therefore kept the relay in a re-subscribe loop and
  // dropped commits streamed in the gap — records went missing exactly during a
  // burst of writes. Announce once per crawler; the firehose carries the rest. A
  // restarted PDS gets a fresh set and re-announces on its first write, which is
  // when the relay actually does need to reset its cursor.
  const announcedCrawlers = new Set<string>();

  const wiredRepo: RepoApi = {
    describe: (d) => repo.describe(d),
    getRecord: (d, c, r) => repo.getRecord(d, c, r),
    listRecords: (d, c, o) => repo.listRecords(d, c, o),
    async applyWrites(d, writes) {
      const evt = await repo.applyWrites(d, writes);
      sequencer.append(evt);
      if (opts.crawlers && opts.publicHostname) {
        for (const rawUrl of opts.crawlers) {
          if (announcedCrawlers.has(rawUrl)) continue;
          announcedCrawlers.add(rawUrl);
          const url = new URL("/xrpc/com.atproto.sync.requestCrawl", rawUrl);
          fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ hostname: opts.publicHostname }),
          }).catch(() => {
            // Let a failed announce be retried by the next write.
            announcedCrawlers.delete(rawUrl);
          });
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
    const authCodeStore: AuthorizationCodeStore = createMemoryAuthorizationCodeStore();
    const parStore: ParStore = createMemoryParStore();
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
        token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
        token_endpoint_auth_signing_alg_values_supported: ["ES256"],
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        dpop_signing_alg_values_supported: ["ES256"],
        authorization_response_iss_parameter_supported: true,
        client_id_metadata_document_supported: true,
        dpop_bound_access_tokens_supported: true,
        code_challenge_methods_supported: ["S256"],
        scopes_supported: ["atproto"],
      });
    });

    // POST /oauth/par — Pushed Authorization Requests (mandatory for ATProto OAuth)
    app.post("/oauth/par", async (c) => {
      const origin = resolveIssuer(c);
      const dpopProofHeader = c.req.header(DPoP_HEADER);
      const nonce = await dpopNonceStore.issue(origin);
      const headers: Record<string, string> = { [DPOP_NONCE_HEADER]: nonce };

      if (!dpopProofHeader) {
        return c.json({ error: "use_dpop_nonce" }, 400, headers);
      }
      const proof = await dpopVerifier.verifyProof(dpopProofHeader, "POST", `${origin}/oauth/par`);
      if (!proof) {
        return c.json({ error: "invalid_dpop_proof" }, 401, headers);
      }

      let body: URLSearchParams;
      try {
        body = new URLSearchParams(await c.req.text());
      } catch {
        return c.json({ error: "invalid_request" }, 400, headers);
      }

      const clientId = body.get("client_id");
      const codeChallenge = body.get("code_challenge");
      const codeChallengeMethod = body.get("code_challenge_method") ?? "S256";
      const redirectUri = body.get("redirect_uri");
      const scope = body.get("scope") ?? "atproto";
      const state = body.get("state");
      const responseType = body.get("response_type");

      if (!clientId || !codeChallenge || !redirectUri || !responseType || !state) {
        return c.json({ error: "invalid_request", error_description: "client_id, code_challenge, redirect_uri, response_type, and state required" }, 400, headers);
      }
      if (responseType !== "code") {
        return c.json({ error: "unsupported_response_type" }, 400, headers);
      }

      // Gap 4: validate client metadata
      const clientMeta = await fetchClientMetadata(clientId);
      if (!clientMeta) {
        return c.json({ error: "invalid_client_metadata", error_description: "could not resolve client metadata" }, 400, headers);
      }
      if (!clientMeta.redirect_uris.includes(redirectUri)) {
        return c.json({ error: "invalid_redirect_uri", error_description: "redirect_uri not registered in client metadata" }, 400, headers);
      }

      const requestUri = await parStore.store({
        clientId, codeChallenge, codeChallengeMethod, redirectUri, scope, state, responseType,
      });

      return c.json({ request_uri: requestUri, expires_in: 60 }, 200, headers);
    });

    // POST /oauth/authorize — authorization code flow (DPoP-bound)
    app.post("/oauth/authorize", async (c) => {
      const authHeader = c.req.header("authorization") ?? "";
      if (!authHeader.startsWith(`${DPoP_AUTH_SCHEME} `)) {
        return c.json({ error: "invalid_request", error_description: "DPoP authorization required" }, 401);
      }
      const token = authHeader.slice(DPoP_AUTH_SCHEME.length + 1).trim();
      const tokenValid = await tokenStore.validate(token);
      if (!tokenValid) {
        return c.json({ error: "invalid_token" }, 401);
      }

      let body: URLSearchParams;
      try {
        body = new URLSearchParams(await c.req.text());
      } catch {
        return c.json({ error: "invalid_request" }, 400);
      }

      // PAR flow: resolve request_uri
      const requestUri = body.get("request_uri");
      const clientId = body.get("client_id");
      let codeChallenge: string | null;
      let codeChallengeMethod: string;
      let redirectUri: string | null;
      let scope: string;
      let state: string | null;

      if (requestUri && clientId) {
        const stored = await parStore.consume(requestUri);
        if (!stored || stored.clientId !== clientId) {
          return c.json({ error: "invalid_request", error_description: "invalid or expired request_uri" }, 400);
        }
        codeChallenge = stored.codeChallenge;
        codeChallengeMethod = stored.codeChallengeMethod;
        redirectUri = stored.redirectUri;
        scope = stored.scope;
        state = stored.state;
      } else {
        codeChallenge = body.get("code_challenge");
        codeChallengeMethod = body.get("code_challenge_method") ?? "S256";
        redirectUri = body.get("redirect_uri");
        scope = body.get("scope") ?? "atproto";
        state = body.get("state");
        if (!codeChallenge || !redirectUri) {
          return c.json({ error: "invalid_request", error_description: "code_challenge and redirect_uri required" }, 400);
        }
      }

      const responseType = body.get("response_type");
      if (responseType && responseType !== "code") {
        return c.json({ error: "unsupported_response_type" }, 400);
      }

      const code = await authCodeStore.create({
        userDid: tokenValid.sub,
        handle: tokenValid.handle ?? tokenValid.sub,
        scope,
        codeChallenge: codeChallenge!,
        codeChallengeMethod,
        redirectUri: redirectUri!,
      });

      const redirectParams = new URLSearchParams({ code });
      if (state) redirectParams.set("state", state);
      return c.json({ redirect_uri: `${redirectUri}?${redirectParams.toString()}`, code });
    });

    // POST /oauth/token — refresh_token + authorization_code grants
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

      // Gap 5: verify client assertion for confidential clients (private_key_jwt)
      const clientAssertionType = body.get("client_assertion_type");
      const clientAssertion = body.get("client_assertion");
      const clientId = body.get("client_id");
      if (clientAssertionType === "urn:ietf:params:oauth:client-assertion-type:jwt-bearer") {
        if (!clientAssertion || !clientId) {
          return c.json({ error: "invalid_client", error_description: "client_assertion and client_id required" }, 401, headers);
        }
        const valid = await verifyClientAssertion(clientAssertion, clientId, resolveIssuer(c));
        if (!valid) {
          return c.json({ error: "invalid_client", error_description: "client assertion verification failed" }, 401, headers);
        }
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

      if (grantType === "authorization_code") {
        const code = body.get("code");
        const codeVerifier = body.get("code_verifier");
        if (!code || !codeVerifier) {
          return c.json({ error: "invalid_request", error_description: "code and code_verifier required" }, 400, headers);
        }

        const validated = await authCodeStore.validate(code, codeVerifier);
        if (!validated) {
          return c.json({ error: "invalid_grant", error_description: "invalid or expired authorization code" }, 400, headers);
        }

        const result = await tokenStore.issue({
          userDid: validated.userDid,
          handle: validated.handle,
          scope: validated.scope,
          jkt: proofValidation.jkt,
        });

        return c.json({
          access_token: result.accessToken,
          token_type: "DPoP",
          refresh_token: result.refreshToken,
          expires_in: result.expiresIn,
          scope: validated.scope,
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

  // ── getServiceAuth (AFTER DPoP middleware so oauthUserDid is set) ──────

  app.get("/xrpc/com.atproto.server.getServiceAuth", async (c) => {
    return handleGetServiceAuth(c) as unknown as Response;
  });

  app.post("/xrpc/com.atproto.server.getServiceAuth", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const aud = body.aud as string | undefined;
    if (!aud) {
      return c.json({ error: "InvalidRequest", message: 'missing required "aud" param' }, 400);
    }
    const lxm = body.lxm as string | undefined;
    // OAuth DPoP path: resolve signer from the authenticated user session
    let signer = opts.signer;
    const oauthDid = (c as unknown as { get: (k: string) => unknown }).get("oauthUserDid") as Did | undefined;
    if (oauthDid) {
      const userSigner = userSigners.get(oauthDid);
      if (userSigner) signer = userSigner;
    }
    // Fall back to Bearer token (legacy access JWT)
    if (signer === opts.signer) {
      const authHeader = c.req.header("authorization");
      const token = extractBearer(authHeader);
      if (token) {
        const result = await accountStore.validateAccessJwt(token);
        if (result) {
          const userSigner = userSigners.get(result.did);
          if (userSigner) signer = userSigner;
        }
      }
    }
    const serviceAuthToken = await signServiceAuth(signer, { aud, lxm });
    return c.json({ token: serviceAuthToken });
  });

  // ── XRPC routes (AFTER DPoP middleware so middleware runs first) ────────

  app.use("/xrpc/com.atproto.repo.createRecord", requireAuth);
  app.use("/xrpc/com.atproto.repo.putRecord", requireAuth);
  app.use("/xrpc/com.atproto.repo.deleteRecord", requireAuth);
  app.use("/xrpc/com.atproto.repo.applyWrites", requireAuth);

  mountRepoRoutes(app, wiredRepo);
  mountSyncRoutes(app, { repo: wiredRepo, storage: opts.storage });

  const subscribe = createSubscribeHandler(sequencer);

  const subscribeReposHandler = upgradeWebSocket((c) => {
    const cursorQ = c.req.query("cursor");
    const params: Record<string, string> = {};
    if (cursorQ) params.cursor = cursorQ;
    const useJson = opts.subscribeReposFormat === "json";
    let unsubscribe: (() => void) | void = undefined;
    return {
      onOpen(_evt, ws) {
        unsubscribe = subscribe({ nsid: "com.atproto.sync.subscribeRepos", params }, (frame) => {
          try {
            if (useJson) {
              ws.send(JSON.stringify(frame));
            } else {
              // Detect frame type for header
              const frameType = (frame as Record<string, unknown>).repo != null ? "#commit"
                : (frame as Record<string, unknown>).active != null ? "#account" : "#identity";
              const header = drislEncode({ op: 1, t: frameType });
              const body = drislEncode(frame);
              const wireFrame = new Uint8Array(header.length + body.length);
              wireFrame.set(header, 0);
              wireFrame.set(body, header.length);
              ws.send(wireFrame as unknown as ArrayBuffer);
            }
          } catch { /* ws closed */ }
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
    getUserSigner: (queryDid: Did) => userSigners.get(queryDid),
  };
}

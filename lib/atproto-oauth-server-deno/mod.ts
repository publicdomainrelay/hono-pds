// Deno implementations of the OAuth server ABC interfaces.
// I/O layer: crypto.subtle, timers. Depends on abc + common only.
import type { Signer } from "@publicdomainrelay/atproto-repo-abc";
import { base64Encode, utf8Encode } from "@publicdomainrelay/atproto-repo-common";
import { b64url, computeJkt } from "@publicdomainrelay/oauth-server-common";
import type {
  DpopNonceStore,
  DpopProofValidation,
  DpopVerifier,
  IssueTokenParams,
  IssueTokenResult,
  InjectedSession,
  SessionInjector,
  TokenStore,
  TokenValidation,
} from "@publicdomainrelay/atproto-oauth-server-abc";

// ── helpers ───────────────────────────────────────────────────────────────────

function b64urlJson(value: unknown): string {
  return b64url(utf8Encode(JSON.stringify(value)));
}

async function signJwt(signer: Signer, payload: Record<string, unknown>): Promise<string> {
  const header = { typ: "JWT", alg: "ES256K" };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = await signer.sign(utf8Encode(signingInput));
  return `${signingInput}.${b64url(sig)}`;
}

function decodeB64UrlPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const s = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function decodeB64Url(s: string): Uint8Array {
  const std = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = std + "=".repeat((4 - (std.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function b64urlToStandard(b64urlStr: string): string {
  let s = b64urlStr.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4 !== 0) s += "=";
  return s;
}

// ── MemoryTokenStore ──────────────────────────────────────────────────────────

interface StoredToken {
  claims: Record<string, unknown>;
  type: "access" | "refresh";
}

export function createMemoryTokenStore(signer: Signer): TokenStore {
  const tokens = new Map<string, StoredToken>();

  async function makeToken(
    params: IssueTokenParams,
    type: "access" | "refresh",
    expiresIn: number,
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const jti = crypto.randomUUID();
    const payload: Record<string, unknown> = {
      iss: signer.did(),
      sub: params.userDid,
      handle: params.handle,
      scope: params.scope ?? "atproto",
      cnf: { jkt: params.jkt },
      iat: now,
      exp: now + expiresIn,
      jti,
    };
    const token = await signJwt(signer, payload);
    tokens.set(jti, { claims: payload, type });
    return token;
  }

  return {
    async issue(params: IssueTokenParams): Promise<IssueTokenResult> {
      const accessToken = await makeToken(params, "access", 900);
      const refreshToken = await makeToken(params, "refresh", 604800);
      return { accessToken, refreshToken, expiresIn: 900 };
    },

    async validate(accessToken: string): Promise<TokenValidation | null> {
      const payload = decodeB64UrlPayload(accessToken);
      if (!payload || !payload.jti || payload.jti === "undefined") return null;
      if (payload.exp && Math.floor(Date.now() / 1000) > (payload.exp as number)) return null;

      const stored = tokens.get(payload.jti as string);
      if (!stored || stored.type !== "access") return null;
      // Verify JWT signature (the stored claims ARE the payload)
      // Re-sign and compare — the signatures match iff the token was signed by us
      const expected = await signJwt(signer, stored.claims);
      if (expected !== accessToken) return null;

      return {
        sub: payload.sub as string,
        handle: payload.handle as string | undefined,
        scope: (payload.scope as string) ?? "atproto",
        jkt: ((payload.cnf as Record<string, string>)?.jkt) ?? "",
      };
    },

    async refresh(refreshToken: string): Promise<IssueTokenResult | null> {
      const payload = decodeB64UrlPayload(refreshToken);
      if (!payload || !payload.jti) return null;
      if (payload.exp && Math.floor(Date.now() / 1000) > (payload.exp as number)) return null;

      const stored = tokens.get(payload.jti as string);
      if (!stored || stored.type !== "refresh") return null;

      const expected = await signJwt(signer, stored.claims);
      if (expected !== refreshToken) return null;

      // Revoke old tokens
      tokens.delete(payload.jti as string);

      // Issue new pair with same claims
      const userDid = stored.claims.sub as string;
      const handle = stored.claims.handle as string;
      const scope = stored.claims.scope as string;
      const jkt = (stored.claims.cnf as Record<string, string>)?.jkt ?? "";
      return this.issue({ userDid, handle, scope, jkt });
    },

    async revoke(token: string): Promise<void> {
      const payload = decodeB64UrlPayload(token);
      if (payload?.jti) tokens.delete(payload.jti as string);
    },
  };
}

// ── SessionInjector ───────────────────────────────────────────────────────────

export function createSessionInjector(
  tokenStore: TokenStore,
  pdsUrl: string,
): SessionInjector {
  return {
    async injectSession(opts: {
      userDid: string;
      handle: string;
      scope?: string;
    }): Promise<InjectedSession> {
      // 1. Generate DPoP keypair (P-256)
      const dpopKeyPair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"],
      );

      // 2. Export JWKs
      const publicJwk = await crypto.subtle.exportKey("jwk", dpopKeyPair.publicKey);
      const privateJwk = await crypto.subtle.exportKey("jwk", dpopKeyPair.privateKey);

      // 3. Compute jkt
      const jkt = await computeJkt(publicJwk as unknown as Record<string, string>);

      // 4. Issue tokens
      const scope = opts.scope ?? "atproto";
      const { accessToken, refreshToken } = await tokenStore.issue({
        userDid: opts.userDid,
        handle: opts.handle,
        scope,
        jkt,
      });

      // 5. Build OAuthSessionData
      function cleanJwk(jwk: JsonWebKey): Record<string, string> {
        const out: Record<string, string> = {};
        if (jwk.kty) out.kty = jwk.kty;
        if (jwk.crv) out.crv = jwk.crv;
        if (jwk.x) out.x = jwk.x;
        if (jwk.y) out.y = jwk.y;
        if (jwk.d !== undefined) out.d = jwk.d;
        return out;
      }

      return {
        sessionData: {
          accessJwt: accessToken,
          refreshJwt: refreshToken,
          userDid: opts.userDid,
          handle: opts.handle,
          pds: pdsUrl,
          dpopPublicJwk: cleanJwk(publicJwk),
          dpopPrivateJwk: cleanJwk(privateJwk),
        },
        dpopKeyPair,
      };
    },
  };
}

// ── DpopVerifier ──────────────────────────────────────────────────────────────

const CLOCK_SKEW_SEC = 30;
const JTI_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function createDpopVerifier(): DpopVerifier {
  const seenJtis = new Map<string, number>(); // jti → expiresAt

  function isReplayed(jti: string): boolean {
    const now = Date.now();
    const expires = seenJtis.get(jti);
    if (expires === undefined) return false;
    if (now > expires) {
      seenJtis.delete(jti);
      return false;
    }
    return true;
  }

  function recordJti(jti: string): void {
    seenJtis.set(jti, Date.now() + JTI_TTL_MS);
    // Lazy cleanup
    if (seenJtis.size > 1000) {
      const now = Date.now();
      for (const [k, v] of seenJtis) if (now > v) seenJtis.delete(k);
    }
  }

  // strip query and fragment from URL for htu comparison
  function buildHtu(url: string): string {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  }

  async function verifyProof(
    proof: string,
    method: string,
    url: string,
    accessToken?: string,
  ): Promise<DpopProofValidation | null> {
    // Step 1: Parse JWT
    const parts = proof.split(".");
    if (parts.length !== 3) return null;

    let header: Record<string, unknown>;
    let payload: Record<string, unknown>;
    try {
      const hdrJson = new TextDecoder().decode(
        decodeB64Url(parts[0]),
      );
      header = JSON.parse(hdrJson);
      const payJson = new TextDecoder().decode(
        decodeB64Url(parts[1]),
      );
      payload = JSON.parse(payJson);
    } catch {
      return null;
    }

    // Verify typ and alg
    if (header.typ !== "dpop+jwt") return null;
    if (header.alg !== "ES256") return null;

    // Step 2: Extract jwk from header
    const jwk = header.jwk as Record<string, unknown> | undefined;
    if (!jwk || typeof jwk !== "object") return null;
    if (jwk.kty !== "EC" || jwk.crv !== "P-256") return null;
    if ("d" in jwk) return null; // private key in proof — reject
    if (typeof jwk.x !== "string" || typeof jwk.y !== "string") return null;

    // Step 3: Verify htm and htu
    if (payload.htm !== method.toUpperCase()) return null;
    if (payload.htu !== buildHtu(url)) return null;

    // Step 4: Verify iat
    const iat = payload.iat as number;
    if (typeof iat !== "number") return null;
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - iat) > CLOCK_SKEW_SEC) return null;

    // Step 5: Verify ath if present
    if (payload.ath && accessToken) {
      const accessTokenBytes = utf8Encode(accessToken);
      const accessTokenHash = new Uint8Array(
        await crypto.subtle.digest("SHA-256", new Uint8Array(accessTokenBytes)),
      );
      const expectedAth = b64url(accessTokenHash);
      if (payload.ath !== expectedAth) return null;
    }

    // Step 6: Verify signature
    const sigBytes = decodeB64Url(parts[2]);
    let publicKey: CryptoKey;
    try {
      publicKey = await crypto.subtle.importKey(
        "jwk",
        { kty: "EC", crv: "P-256", x: jwk.x as string, y: jwk.y as string },
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
    } catch {
      return null;
    }

    const signingInput = utf8Encode(`${parts[0]}.${parts[1]}`);
    // Web Crypto's ECDSA verify accepts raw r||s format directly (RFC 7518).
    // No DER conversion needed.
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: { name: "SHA-256" } },
      publicKey,
      sigBytes,
      new Uint8Array(signingInput),
    );
    if (!valid) return null;

    // Step 7: Replay check
    const jti = payload.jti as string;
    if (typeof jti !== "string" || !jti) return null;
    if (isReplayed(jti)) return null;
    recordJti(jti);

    // Step 8: Compute jkt
    const jkt = await computeJkt(jwk as unknown as Record<string, string>);

    return { jkt, jti };
  }

  return { verifyProof };
}

// ── DpopNonceStore ────────────────────────────────────────────────────────────

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes per spec

export function createDpopNonceStore(): DpopNonceStore {
  const store = new Map<string, { nonce: string; expiresAt: number }>();

  return {
    async issue(origin: string): Promise<string> {
      const nonce = crypto.randomUUID();
      store.set(origin, { nonce, expiresAt: Date.now() + NONCE_TTL_MS });
      return nonce;
    },

    async verify(origin: string, nonce: string): Promise<boolean> {
      const entry = store.get(origin);
      if (!entry) return false;
      if (Date.now() > entry.expiresAt) {
        store.delete(origin);
        return false;
      }
      // Spec: servers should accept recently-stale nonces for rotation smoothness.
      // We accept exact match only; rotation is handled by issue() replacing the entry.
      if (entry.nonce !== nonce) return false;
      // Delete on successful use (nonces are one-time)
      store.delete(origin);
      return true;
    },
  };
}

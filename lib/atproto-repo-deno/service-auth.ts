import type { Bytes, Did, Signer } from "@publicdomainrelay/atproto-repo-abc";
import { base64Encode, utf8Encode } from "@publicdomainrelay/atproto-repo-common";

function b64url(bytes: Bytes): string {
  return base64Encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson(value: unknown): string {
  return b64url(utf8Encode(JSON.stringify(value)));
}

export interface ServiceAuthOptions {
  aud: Did;
  lxm?: string;
  expiresInSec?: number;
}

export async function signServiceAuth(signer: Signer, opts: ServiceAuthOptions): Promise<string> {
  const iss = signer.did();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (opts.expiresInSec ?? 60);

  const header: { typ: string; alg: string; kid?: string } = { typ: "JWT", alg: "ES256K", kid: "#atproto" };
  const payload: Record<string, unknown> = {
    iss,
    aud: opts.aud,
    iat: now,
    exp,
    jti: b64url(crypto.getRandomValues(new Uint8Array(16))),
  };
  if (opts.lxm) payload.lxm = opts.lxm;

  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = await signer.sign(utf8Encode(signingInput));
  return `${signingInput}.${b64url(sig)}`;
}

function b64urlToStandard(b64urlStr: string): string {
  let s = b64urlStr.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4 !== 0) s += "=";
  return s;
}

// ── JTI replay prevention ──────────────────────────────────────────────────────

const jtiSeen = new Map<string, number>();
let jtiCleanupCounter = 0;

function checkJtiReplay(jti: string): boolean {
  jtiCleanupCounter++;
  // Garbage collect expired entries every ~100 calls
  if (jtiCleanupCounter > 100) {
    const now = Date.now();
    for (const [key, exp] of jtiSeen) {
      if (now > exp) jtiSeen.delete(key);
    }
    jtiCleanupCounter = 0;
  }
  const existing = jtiSeen.get(jti);
  if (existing && Date.now() < existing) return true; // still valid → replay
  return false;
}

export interface VerifyServiceAuthOptions {
  /** The expected audience DID (this PDS). */
  audDid: Did;
  /** Expected lexicon method (NSID). If token has lxm, must match. */
  lxm?: string;
  /** Optional: verify the issuer is a locally-hosted account. */
  isHostedAccount?: (did: Did) => boolean;
}

export async function verifyServiceAuthToken(
  token: string,
  opts: VerifyServiceAuthOptions,
): Promise<{ iss: Did } | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const headerJson = atob(b64urlToStandard(parts[0]));
    const header = JSON.parse(headerJson);
    if (header.typ !== "JWT" || header.alg !== "ES256K") return null;

    const payloadJson = atob(b64urlToStandard(parts[1]));
    const payload = JSON.parse(payloadJson);

    // Gap 1: lxm check — if token has lxm, it must match expected
    if (opts.lxm && payload.lxm && payload.lxm !== opts.lxm) return null;

    // Gap 2: jti replay check
    if (payload.jti && checkJtiReplay(payload.jti)) return null;

    if (payload.aud !== opts.audDid) return null;
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    if (!payload.iss) return null;

    const { verifySignature } = await import("@atproto/crypto");
    const signingInput = utf8Encode(`${parts[0]}.${parts[1]}`);
    const sigBytes = Uint8Array.from(atob(b64urlToStandard(parts[2])), (c) => c.charCodeAt(0));
    const valid = await verifySignature(payload.iss as Did, signingInput, sigBytes as unknown as Uint8Array<ArrayBuffer>);
    if (!valid) return null;

    // Gap 3: restrict to hosted accounts
    if (opts.isHostedAccount && !opts.isHostedAccount(payload.iss as Did)) return null;

    // Track jti for replay prevention (store expiration)
    if (payload.jti) {
      jtiSeen.set(payload.jti, (payload.exp as number) * 1000);
    }

    return { iss: payload.iss as Did };
  } catch {
    return null;
  }
}

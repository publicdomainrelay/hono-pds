// DPoP + OAuth constants and helpers. Pure utilities — zero project-local deps beyond
// atproto-repo-common for base64.
import { base64Encode, utf8Encode } from "@publicdomainrelay/atproto-repo-common";

// ── constants ─────────────────────────────────────────────────────────────────

export const DPoP_HEADER = "DPoP";
export const DPOP_NONCE_HEADER = "DPoP-Nonce";
export const DPoP_AUTH_SCHEME = "DPoP";

// ── helpers ───────────────────────────────────────────────────────────────────

export function generateDpopNonce(): string {
  return crypto.randomUUID();
}

export function b64url(bytes: Uint8Array): string {
  return base64Encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 thumbprint of a JWK public key per RFC 7638.
 *  Only EC P-256 keys (kty=EC, crv=P-256) are supported. */
export async function computeJkt(jwk: Record<string, string>): Promise<string> {
  // Canonical form: sorted keys, no whitespace, only public fields
  const canonical: Record<string, string> = {};
  const keys = Object.keys(jwk).filter((k) => k !== "d" && k !== "kid" && k !== "alg" && k !== "key_ops" && k !== "ext" && k !== "use").sort();
  for (const k of keys) canonical[k] = jwk[k];
  const json = JSON.stringify(canonical);
  const bytes = utf8Encode(json);
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return b64url(new Uint8Array(hash));
}

// ── OAuthSessionData ──────────────────────────────────────────────────────────
// Duplicated from atproto-market/lib/atproto-helpers/agent.ts to avoid
// a cross-workspace dependency from hono-pds → atproto-market.

export interface OAuthSessionData {
  accessJwt: string;
  refreshJwt: string;
  userDid: string;
  handle: string;
  pds: string;
  dpopPublicJwk: Record<string, string>;
  dpopPrivateJwk: Record<string, string>;
}

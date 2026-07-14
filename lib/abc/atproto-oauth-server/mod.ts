// Pure interfaces for OAuth server state. Zero I/O — no fetch, crypto, timers,
// or Deno.*. Every impl package satisfies these contracts.

import type { OAuthSessionData } from "@publicdomainrelay/oauth-server-common";

// ── TokenStore ────────────────────────────────────────────────────────────────

export interface IssueTokenParams {
  userDid: string;
  handle: string;
  scope?: string;
  /** DPoP public key thumbprint (SHA-256 of canonical JWK) — binds the token to
   *  a specific client DPoP key. */
  jkt: string;
}

export interface IssueTokenResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface TokenValidation {
  sub: string;
  handle?: string;
  scope: string;
  jkt: string;
}

export interface TokenStore {
  issue(params: IssueTokenParams): Promise<IssueTokenResult>;
  validate(accessToken: string): Promise<TokenValidation | null>;
  refresh(refreshToken: string): Promise<IssueTokenResult | null>;
  revoke(token: string): Promise<void>;
}

// ── SessionInjector ───────────────────────────────────────────────────────────

export interface InjectedSession {
  sessionData: OAuthSessionData;
  dpopKeyPair: CryptoKeyPair;
}

export interface SessionInjector {
  injectSession(opts: {
    userDid: string;
    handle: string;
    scope?: string;
  }): Promise<InjectedSession>;
}

// ── DpopVerifier ──────────────────────────────────────────────────────────────

export interface DpopProofValidation {
  jkt: string;
  jti: string;
}

export interface DpopVerifier {
  verifyProof(
    proof: string,
    method: string,
    url: string,
    accessToken?: string,
  ): Promise<DpopProofValidation | null>;
}

// ── DpopNonceStore ────────────────────────────────────────────────────────────

export interface DpopNonceStore {
  issue(origin: string): Promise<string>;
  verify(origin: string, nonce: string): Promise<boolean>;
}

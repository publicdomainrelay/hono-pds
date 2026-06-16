import type { Bytes, Did, Signer } from "@publicdomainrelay/atproto-repo-abc";
import { base64Encode, utf8Encode } from "@publicdomainrelay/common";

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

  const header = { typ: "JWT", alg: "ES256K" };
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

import type { Did, Signer } from "@publicdomainrelay/atproto-repo-abc";
import { base64Encode, utf8Encode } from "@publicdomainrelay/atproto-repo-common";

function b64url(bytes: Uint8Array): string {
  return base64Encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson(value: unknown): string {
  return b64url(utf8Encode(JSON.stringify(value)));
}

function b64urlToStandard(b64urlStr: string): string {
  let s = b64urlStr.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4 !== 0) s += "=";
  return s;
}

async function signJwt(signer: Signer, payload: Record<string, unknown>): Promise<string> {
  const header = { typ: "JWT", alg: "ES256K" };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = await signer.sign(utf8Encode(signingInput));
  return `${signingInput}.${b64url(sig)}`;
}

export interface AccountRecord {
  did: Did;
  handle: string;
  passwordHash: string;
  passwordSalt: string;
  email?: string;
  createdAt: number;
}

export interface AccountStore {
  createAccount(opts: {
    handle?: string;
    email?: string;
    password?: string;
    didOverride?: Did;
    signerOverride?: Signer;
  }): Promise<{ accessJwt: string; refreshJwt: string; handle: string; did: Did; signer: Signer }>;
  getAccount(handleOrDid: string): AccountRecord | undefined;
  validatePassword(handleOrDid: string, password: string): Promise<boolean>;
  createSessionTokens(did: Did, handle: string): Promise<{
    accessJwt: string;
    refreshJwt: string;
  }>;
  validateAccessJwt(token: string): { did: Did; handle: string } | null;
}

function createAccountStore(pdsDid: Did, pdsSigner: Signer): AccountStore {
  const accounts = new Map<string, AccountRecord>();

  async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey(
      "raw", utf8Encode(password).buffer as ArrayBuffer, "PBKDF2", false, ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
      key, 256,
    );
    return { hash: b64url(new Uint8Array(bits)), salt: b64url(salt) };
  }

  async function verifyPassword(password: string, record: AccountRecord): Promise<boolean> {
    const saltStr = b64urlToStandard(record.passwordSalt);
    const saltBytes = Uint8Array.from(atob(saltStr), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      "raw", utf8Encode(password).buffer as ArrayBuffer, "PBKDF2", false, ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: saltBytes, iterations: 100_000, hash: "SHA-256" },
      key, 256,
    );
    return b64url(new Uint8Array(bits)) === record.passwordHash;
  }

  return {
    async createAccount(opts) {
      const handle = opts.handle ?? `user-${b64url(crypto.getRandomValues(new Uint8Array(6)))}`;
      const password = opts.password ?? b64url(crypto.getRandomValues(new Uint8Array(12)));
      const { hash: passwordHash, salt: passwordSalt } = await hashPassword(password);

      let did: Did;
      let signer: Signer;

      if (opts.signerOverride) {
        signer = opts.signerOverride;
        did = opts.didOverride ?? signer.did();
      } else {
        const { Secp256k1Keypair } = await import("@atproto/crypto");
        const kp = await Secp256k1Keypair.create({ exportable: true });
        did = kp.did();
        signer = {
          did: () => did,
          sign: (bytes: Uint8Array) => kp.sign(bytes),
        };
      }

      accounts.set(handle, { did, handle, passwordHash, passwordSalt, email: opts.email, createdAt: Date.now() });
      const tokens = await this.createSessionTokens(did, handle);
      return { ...tokens, handle, did, signer };
    },

    getAccount(handleOrDid: string) {
      const byHandle = accounts.get(handleOrDid);
      if (byHandle) return byHandle;
      for (const a of accounts.values()) {
        if (a.did === handleOrDid) return a;
      }
      return undefined;
    },

    async validatePassword(handleOrDid: string, password: string) {
      const record = this.getAccount(handleOrDid);
      if (!record) return false;
      return verifyPassword(password, record);
    },

    async createSessionTokens(did: Did, handle: string) {
      const now = Math.floor(Date.now() / 1000);
      const accessPayload = {
        iss: pdsDid, sub: did, handle, aud: pdsDid,
        iat: now, exp: now + 900,
        jti: b64url(crypto.getRandomValues(new Uint8Array(16))),
      };
      const refreshPayload = {
        iss: pdsDid, sub: did, handle, aud: pdsDid,
        iat: now, exp: now + 604800,
        jti: b64url(crypto.getRandomValues(new Uint8Array(16))),
      };
      const [accessJwt, refreshJwt] = await Promise.all([
        signJwt(pdsSigner, accessPayload),
        signJwt(pdsSigner, refreshPayload),
      ]);
      return { accessJwt, refreshJwt };
    },

    validateAccessJwt(token: string) {
      try {
        const parts = token.split(".");
        if (parts.length !== 3) return null;
        const payloadJson = atob(b64urlToStandard(parts[1]));
        const payload = JSON.parse(payloadJson);
        if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
        if (!payload.sub || !payload.handle) return null;
        return { did: payload.sub, handle: payload.handle };
      } catch { return null; }
    },
  };
}

export { createAccountStore };

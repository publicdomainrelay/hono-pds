import { assert, assertEquals } from "@std/assert";
import { Secp256k1Keypair } from "@atproto/crypto";
import { createAccountStore, signServiceAuth, signerFromKeypair, verifyServiceAuthToken } from "@publicdomainrelay/atproto-repo-deno";
import type { Did, Signer } from "@publicdomainrelay/atproto-repo-abc";

const LXM = "com.atproto.repo.createRecord";

function signerFor(did: string, kp: Secp256k1Keypair): Signer {
  return {
    did: () => did as Did,
    sign: (bytes: Uint8Array) => kp.sign(bytes),
  } as unknown as Signer;
}

Deno.test("defect5 [lxm] a token carrying NO lxm is rejected", async () => {
  const kp = await Secp256k1Keypair.create();
  const did = kp.did();
  const token = await signServiceAuth(signerFor(did, kp), { aud: did as Did });
  const res = await verifyServiceAuthToken(token, { audDid: did as Did, lxm: LXM });
  console.log("[lxm] result =", JSON.stringify(res));
  assertEquals(res, null);
});

Deno.test("defect5 [did:plc] a signed did:plc issuer token verifies", async () => {
  const kp = await Secp256k1Keypair.create();
  const plcDid = "did:plc:defect5testpds";
  const token = await signServiceAuth(signerFor(plcDid, kp), { aud: plcDid as Did, lxm: LXM });
  const res = await verifyServiceAuthToken(token, {
    audDid: plcDid as Did,
    lxm: LXM,
    idResolver: { did: { resolveAtprotoKey: async () => kp.did() } },
  });
  console.log("[did:plc] result =", JSON.stringify(res));
  assert(res !== null);
  assertEquals(res!.iss, plcDid);
});

Deno.test("defect5 control: a signed did:key token still verifies", async () => {
  const kp = await Secp256k1Keypair.create();
  const did = kp.did();
  const token = await signServiceAuth(signerFor(did, kp), { aud: did as Did, lxm: LXM });
  const res = await verifyServiceAuthToken(token, { audDid: did as Did, lxm: LXM });
  assert(res !== null);
  assertEquals(res!.iss, did);
});

// ---------------------------------------------------------------------------
// defect5's RESIDUAL: the patch made `lxm` required one line above and left `exp`
// OPTIONAL, in both verifiers. A token with no `exp` therefore never expires, and
// it takes replay detection down with it:
//
//   service-auth.ts:138   jtiSeen.set(payload.jti, payload.exp * 1000)  -> NaN
//   service-auth.ts:60    if (existing && Date.now() < existing)        -> NaN is falsy
//   service-auth.ts:55    if (now > exp) jtiSeen.delete(key)            -> false, NEVER collected
//
// Three consequences, not one: immortal token, replay undetected, and an entry that
// leaks for the process's lifetime.
//
// `exp` is REQUIRED rather than optional because every signer in the org sets it --
// the reference `signServiceAuth` (crypto/service-auth.ts:38, "payload.exp number",
// `?? 60`) and this repo's own `createSessionTokens` (account-store.ts:151,156).
// The signer decides, exactly as CLAUDE.md says for the `lxm`/nil question: if the
// signer always sets a claim, the verifier must require it.
// ---------------------------------------------------------------------------

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson(o: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(o)));
}

/** Mint a JWT with a payload WE choose, so `exp` can be omitted on purpose. */
async function mintWithoutExp(
  signer: Signer,
  payload: Record<string, unknown>,
  typ = "JWT",
): Promise<string> {
  const signingInput = `${b64urlJson({ typ, alg: "ES256K" })}.${b64urlJson(payload)}`;
  const sig = await signer.sign(new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64url(sig)}`;
}

Deno.test("defect5-residual [service-auth] a signed token carrying NO exp is rejected", async () => {
  const kp = await Secp256k1Keypair.create();
  const did = kp.did();
  const signer = signerFor(did, kp);
  // Everything ELSE is correct: aud matches, lxm matches, iss is the signing did.
  const token = await mintWithoutExp(signer, {
    iss: did, aud: did, lxm: LXM, jti: "no-exp-1",
  });
  const res = await verifyServiceAuthToken(token, { audDid: did as Did, lxm: LXM });
  console.log("[no-exp] result =", JSON.stringify(res));
  assertEquals(res, null, "a token with no exp must not verify -- it would never expire");
});

Deno.test("defect5-residual [account-store] a session token carrying NO exp is rejected", async () => {
  const kp = await Secp256k1Keypair.create();
  const pdsDid = "did:plc:defect5pdsidentity";
  const store = createAccountStore(pdsDid as Did, signerFromKeypair(kp), kp.did() as Did);
  const token = await mintWithoutExp(
    signerFor(pdsDid, kp),
    { sub: "did:plc:defect5user", handle: "alice.test" },
    "at+jwt",
  );
  const res = await store.validateAccessJwt(token);
  console.log("[no-exp account-store] validateAccessJwt =", JSON.stringify(res));
  assertEquals(res, null, "a session token with no exp must not validate");
});

Deno.test("defect5-residual control: the SAME token with an exp still verifies", async () => {
  const kp = await Secp256k1Keypair.create();
  const did = kp.did();
  const signer = signerFor(did, kp);
  const token = await mintWithoutExp(signer, {
    iss: did, aud: did, lxm: LXM, jti: "with-exp-1",
    exp: Math.floor(Date.now() / 1000) + 300,
  });
  const res = await verifyServiceAuthToken(token, { audDid: did as Did, lxm: LXM });
  console.log("[with-exp control] result =", JSON.stringify(res));
  assert(res !== null, "the control must pass, or the rejection above proves nothing");
  assertEquals(res!.iss, did);
});

Deno.test("defect5 [account-store] session tokens verify when the PDS identity is did:plc", async () => {
  const kp = await Secp256k1Keypair.create();
  const pdsDid = "did:plc:defect5pdsidentity";
  const keyDid = kp.did();
  const store = createAccountStore(pdsDid as Did, signerFromKeypair(kp), keyDid as Did);
  const { accessJwt } = await store.createSessionTokens("did:plc:defect5user" as Did, "alice.test");
  const res = await store.validateAccessJwt(accessJwt);
  console.log("[account-store] validateAccessJwt =", JSON.stringify(res));
  assert(res !== null);
  assertEquals(res!.did, "did:plc:defect5user");
});

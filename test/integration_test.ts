import { assertEquals, assertExists } from "@std/assert";
import { createRepoFactory } from "@publicdomainrelay/hono-factory-atproto-repo-deno";
import { MemoryStorage, signerFromKeypair, signServiceAuth } from "@publicdomainrelay/atproto-repo-deno";
import { Secp256k1Keypair } from "@atproto/crypto";

Deno.test("[integration] GET /xrpc/_health over HTTP", async () => {
  const kp = await Secp256k1Keypair.create();
  const signer = signerFromKeypair(kp);
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer });

  const controller = new AbortController();
  const { promise: portReady, resolve: resolvePort } = Promise.withResolvers<number>();
  const server = Deno.serve({ port: 0, signal: controller.signal, onListen: (addr) => resolvePort((addr as Deno.NetAddr).port) }, factory.app.fetch);
  const port = await portReady;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/xrpc/_health`);
    assertEquals(res.status, 200);
    const data = await res.json();
    assertExists(data.version);
  } finally {
    controller.abort();
    await server.finished;
  }
});

Deno.test("[integration] POST /xrpc/com.atproto.repo.createRecord over HTTP", async () => {
  const kp = await Secp256k1Keypair.create();
  const signer = signerFromKeypair(kp);
  const pdsDid = signer.did();
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer });

  // Create account first to get service auth token
  const acctRes = await factory.app.request("/xrpc/com.atproto.server.createAccount", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "int-test-user", password: "int-test-pw" }),
  });
  const acct = await acctRes.json() as { did: string; handle: string };
  const acctSigner = factory.getUserSigner(acct.did);
  if (!acctSigner) throw new Error("no signer for account");
  const svcToken = await signServiceAuth(acctSigner, { aud: pdsDid });

  const controller = new AbortController();
  const { promise: portReady, resolve: resolvePort } = Promise.withResolvers<number>();
  const server = Deno.serve({ port: 0, signal: controller.signal, onListen: (addr) => resolvePort((addr as Deno.NetAddr).port) }, factory.app.fetch);
  const port = await portReady;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/xrpc/com.atproto.repo.createRecord`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${svcToken}` },
      body: JSON.stringify({
        repo: acct.did,
        collection: "com.example.test",
        record: { hello: "world" },
      }),
    });
    assertEquals(res.status, 200);
    const data = await res.json() as { uri: string; cid: string };
    assertExists(data.uri);
    assertExists(data.cid);
  } finally {
    controller.abort();
    await server.finished;
  }
});

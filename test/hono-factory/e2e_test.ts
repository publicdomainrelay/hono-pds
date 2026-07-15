import { assertEquals, assertExists } from "@std/assert";
import { createRepoFactory } from "@publicdomainrelay/hono-factory-atproto-repo-deno";
import { MemoryStorage, signerFromKeypair, signServiceAuth } from "@publicdomainrelay/atproto-repo-deno";
import type { SequencedFrame } from "@publicdomainrelay/atproto-repo-abc";
import { Secp256k1Keypair } from "@atproto/crypto";

async function createAccountAndToken(factory: ReturnType<typeof createRepoFactory>, pdsDid: string) {
  const res = await factory.app.request("/xrpc/com.atproto.server.createAccount", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "e2e-user", password: "e2e-pw" }),
  });
  const acct = await res.json() as { did: string; handle: string };
  const signer = factory.getUserSigner(acct.did);
  if (!signer) throw new Error("no signer for account");
  const svcToken = await signServiceAuth(signer, { aud: pdsDid });
  return { did: acct.did, handle: acct.handle, token: svcToken };
}

Deno.test("e2e createRecord returns uri+cid", async () => {
  const kp = await Secp256k1Keypair.create();
  const signer = signerFromKeypair(kp);
  const pdsDid = signer.did();
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer });
  const { did, token } = await createAccountAndToken(factory, pdsDid);

  const body = JSON.stringify({
    repo: did,
    collection: "com.example.record",
    rkey: "abc123",
    record: { hello: "world" },
  });

  const res = await factory.app.request(
    "/xrpc/com.atproto.repo.createRecord",
    { method: "POST", body, headers: { "content-type": "application/json", authorization: `Bearer ${token}` } },
  );

  assertEquals(res.status, 200);
  const data = await res.json() as { uri: string; cid: string };
  assertEquals(typeof data.uri, "string");
  assertEquals(data.uri, `at://${did}/com.example.record/abc123`);
  assertEquals(typeof data.cid, "string");
});

Deno.test("e2e getRecord returns stored record", async () => {
  const kp = await Secp256k1Keypair.create();
  const signer = signerFromKeypair(kp);
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer });
  const { did } = await createAccountAndToken(factory, signer.did());

  await factory.api.applyWrites(did, [{
    action: "create",
    collection: "com.example.record",
    rkey: "gettest",
    record: { foo: "bar" },
  }]);

  const res = await factory.app.request(
    `/xrpc/com.atproto.repo.getRecord?repo=${did}&collection=com.example.record&rkey=gettest`,
  );

  assertEquals(res.status, 200);
  const data = await res.json() as { uri: string; cid: string; value: unknown };
  assertEquals(data.value, { foo: "bar" });
});

Deno.test("e2e listRecords returns paginated records", async () => {
  const kp = await Secp256k1Keypair.create();
  const signer = signerFromKeypair(kp);
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer });
  const { did } = await createAccountAndToken(factory, signer.did());

  for (let i = 0; i < 3; i++) {
    await factory.api.applyWrites(did, [{
      action: "create",
      collection: "com.example.record",
      rkey: `page${i}`,
      record: { n: i },
    }]);
  }

  const res = await factory.app.request(
    `/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=com.example.record&limit=2`,
  );

  assertEquals(res.status, 200);
  const data = await res.json() as { records: unknown[]; cursor?: string };
  assertEquals(data.records.length, 2);
  assertExists(data.cursor);
});

Deno.test("e2e describeRepo returns collections", async () => {
  const kp = await Secp256k1Keypair.create();
  const signer = signerFromKeypair(kp);
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer });
  const { did } = await createAccountAndToken(factory, signer.did());

  await factory.api.applyWrites(did, [{
    action: "create",
    collection: "com.example.alpha",
    rkey: "a1",
    record: { v: 1 },
  }]);

  const res = await factory.app.request(
    `/xrpc/com.atproto.repo.describeRepo?repo=${did}`,
  );

  assertEquals(res.status, 200);
  const data = await res.json() as { collections: string[]; head: string };
  assertEquals(data.collections, ["com.example.alpha"]);
  assertExists(data.head);
});

Deno.test("e2e subscribe delivers frame after createRecord", async () => {
  const kp = await Secp256k1Keypair.create();
  const signer = signerFromKeypair(kp);
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer });
  const { did } = await createAccountAndToken(factory, signer.did());

  let emittedFrame: SequencedFrame | null = null;

  const dispose = factory.subscribe(
    { params: {} },
    (frame: SequencedFrame) => { emittedFrame = frame; },
  );

  await factory.api.applyWrites(did, [{
    action: "create",
    collection: "com.example.record",
    rkey: "subtest",
    record: { x: 1 },
  }]);

  for (let i = 0; i < 20 && emittedFrame === null; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }

  assertExists(emittedFrame);
  assertEquals(emittedFrame.repo, did);
  assertEquals(emittedFrame.ops.length, 1);
  assertEquals(emittedFrame.ops[0].action, "create");
  assertEquals(emittedFrame.ops[0].path, "com.example.record/subtest");

  dispose();
});

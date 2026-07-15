import { assertEquals, assertExists, assertGreater } from "@std/assert";
import { createRepoFactory } from "@publicdomainrelay/hono-factory-atproto-repo-deno";
import { MemoryStorage, signerFromKeypair, signServiceAuth } from "@publicdomainrelay/atproto-repo-deno";
import { Secp256k1Keypair } from "@atproto/crypto";

// All write tests use real secp256k1 keypairs + service auth Bearer tokens.
// Read-only tests (health, describeServer, well-known, getRecord, listRecords, describeRepo) are public.

async function createAccountAndToken(factory: ReturnType<typeof createRepoFactory>, pdsDid: string) {
  const res = await factory.app.request("/xrpc/com.atproto.server.createAccount", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "test-user", email: "test@test.com", password: "test-password" }),
  });
  const acct = await res.json() as { did: string; handle: string; accessJwt: string };
  const signer = factory.getUserSigner(acct.did);
  if (!signer) throw new Error("no signer for account");
  // Return a token generator for fresh tokens per request (jti replay prevention)
  const getToken = () => signServiceAuth(signer, { aud: pdsDid });
  return { did: acct.did, handle: acct.handle, getToken };
}

function authHeaders(token: string): Record<string, string> {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

Deno.test("[conformance] health endpoint returns version", async () => {
  const kp = await Secp256k1Keypair.create();
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer: signerFromKeypair(kp) });
  const res = await factory.app.request("/xrpc/_health");
  assertEquals(res.status, 200);
  const data = await res.json() as { version?: string };
  assertEquals(typeof data.version, "string");
});

Deno.test("[conformance] describeServer returns did, version, availableUserDomains, inviteCodeRequired", async () => {
  const kp = await Secp256k1Keypair.create();
  const signer = signerFromKeypair(kp);
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer });
  const res = await factory.app.request("/xrpc/com.atproto.server.describeServer");
  assertEquals(res.status, 200);
  const data = await res.json() as {
    did: string; version: string; availableUserDomains: string[]; inviteCodeRequired: boolean;
  };
  assertEquals(data.did, signer.did());
  assertEquals(typeof data.version, "string");
  assertEquals(Array.isArray(data.availableUserDomains), true);
  assertEquals(typeof data.inviteCodeRequired, "boolean");
});

Deno.test("[conformance] well-known atproto-did returns did", async () => {
  const kp = await Secp256k1Keypair.create();
  const signer = signerFromKeypair(kp);
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer });
  const res = await factory.app.request("/.well-known/atproto-did");
  assertEquals(res.status, 200);
  const text = await res.text();
  assertEquals(text, signer.did());
});

Deno.test("[conformance] createRecord returns uri and cid", async () => {
  const kp = await Secp256k1Keypair.create();
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer: signerFromKeypair(kp) });
  const pdsDid = signerFromKeypair(kp).did();
  const { did, getToken } = await createAccountAndToken(factory, pdsDid);

  const res = await factory.app.request("/xrpc/com.atproto.repo.createRecord", {
    method: "POST",
    body: JSON.stringify({ repo: did, collection: "app.bsky.feed.post", record: { text: "Hello", createdAt: new Date().toISOString() } }),
    headers: authHeaders(await getToken()),
  });
  assertEquals(res.status, 200);
  const data = await res.json() as { uri: string; cid: string };
  assertEquals(typeof data.uri, "string");
  assertEquals(data.uri.startsWith(`at://${did}/`), true);
  assertEquals(typeof data.cid, "string");
  assertEquals(data.cid.startsWith("b"), true);
});

Deno.test("[conformance] createRecord defaults $type to collection name", async () => {
  const kp = await Secp256k1Keypair.create();
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer: signerFromKeypair(kp) });
  const pdsDid = signerFromKeypair(kp).did();
  const { did, getToken } = await createAccountAndToken(factory, pdsDid);

  const res = await factory.app.request("/xrpc/com.atproto.repo.createRecord", {
    method: "POST",
    body: JSON.stringify({ repo: did, collection: "com.example.record", record: { foo: "bar" } }),
    headers: authHeaders(await getToken()),
  });
  assertEquals(res.status, 200);
  const data = await res.json() as { uri: string };
  const uriParts = data.uri.split("/");
  const collection = uriParts[3];
  const rkey = uriParts[4];

  const getRes = await factory.app.request(
    `/xrpc/com.atproto.repo.getRecord?repo=${did}&collection=${collection}&rkey=${rkey}`,
  );
  const record = await getRes.json() as { value: Record<string, unknown> };
  assertEquals(record.value.$type, "com.example.record");
});

Deno.test("[conformance] createRecord getRecord round-trip preserves value", async () => {
  const kp = await Secp256k1Keypair.create();
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer: signerFromKeypair(kp) });
  const pdsDid = signerFromKeypair(kp).did();
  const { did, getToken } = await createAccountAndToken(factory, pdsDid);

  const recordValue = { $type: "app.bsky.feed.post", text: "Hello, world!", createdAt: new Date().toISOString() };
  const createRes = await factory.app.request("/xrpc/com.atproto.repo.createRecord", {
    method: "POST",
    body: JSON.stringify({ repo: did, collection: "app.bsky.feed.post", record: recordValue }),
    headers: authHeaders(await getToken()),
  });
  const createData = await createRes.json() as { uri: string; cid: string };
  const uriParts = createData.uri.split("/");
  const rkey = uriParts[4];

  const getRes = await factory.app.request(
    `/xrpc/com.atproto.repo.getRecord?repo=${did}&collection=app.bsky.feed.post&rkey=${rkey}`,
  );
  assertEquals(getRes.status, 200);
  const getData = await getRes.json() as { uri: string; cid: string; value: Record<string, unknown> };
  assertEquals(getData.uri, createData.uri);
  assertEquals(typeof getData.cid, "string");
  assertEquals(getData.value.text, "Hello, world!");
  assertEquals(getData.value.$type, "app.bsky.feed.post");
});

Deno.test("[conformance] getRecord returns 404 for missing record", async () => {
  const kp = await Secp256k1Keypair.create();
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer: signerFromKeypair(kp) });
  const pdsDid = signerFromKeypair(kp).did();
  const { did } = await createAccountAndToken(factory, pdsDid);

  const res = await factory.app.request(
    `/xrpc/com.atproto.repo.getRecord?repo=${did}&collection=com.example.record&rkey=nonexistent`,
  );
  assertEquals(res.status, 400);
  const data = await res.json() as { error: string };
  assertEquals(data.error, "RecordNotFound");
});

Deno.test("[conformance] listRecords returns paginated results with cursor", async () => {
  const kp = await Secp256k1Keypair.create();
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer: signerFromKeypair(kp) });
  const pdsDid = signerFromKeypair(kp).did();
  const { did } = await createAccountAndToken(factory, pdsDid);

  for (let i = 0; i < 5; i++) {
    await factory.api.applyWrites(did, [{
      action: "create", collection: "app.bsky.feed.post",
      rkey: `post${i}`, record: { $type: "app.bsky.feed.post", text: `Post ${i}`, createdAt: new Date().toISOString() },
    }]);
  }

  const res = await factory.app.request(
    `/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=app.bsky.feed.post&limit=2`,
  );
  assertEquals(res.status, 200);
  const data = await res.json() as { records: unknown[]; cursor?: string };
  assertEquals(data.records.length, 2);
  assertExists(data.cursor);

  const res2 = await factory.app.request(
    `/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=app.bsky.feed.post&limit=5&cursor=${data.cursor}`,
  );
  assertEquals(res2.status, 200);
  const data2 = await res2.json() as { records: unknown[]; cursor?: string };
  assertEquals(data2.records.length, 3);
});

Deno.test("[conformance] describeRepo returns did, handle, collections, head", async () => {
  const kp = await Secp256k1Keypair.create();
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer: signerFromKeypair(kp) });
  const pdsDid = signerFromKeypair(kp).did();
  const { did } = await createAccountAndToken(factory, pdsDid);

  await factory.api.applyWrites(did, [{
    action: "create", collection: "com.example.alpha",
    rkey: "a1", record: { v: 1 },
  }]);

  const res = await factory.app.request(`/xrpc/com.atproto.repo.describeRepo?repo=${did}`);
  assertEquals(res.status, 200);
  const data = await res.json() as { did: string; handle: string; collections: string[]; head: string | null };
  assertEquals(data.did, did);
  assertExists(data.handle);
  assertEquals(data.collections.includes("com.example.alpha"), true);
  assertExists(data.head);
});

Deno.test("[conformance] deleteRecord no-ops if record does not exist", async () => {
  const kp = await Secp256k1Keypair.create();
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer: signerFromKeypair(kp) });
  const pdsDid = signerFromKeypair(kp).did();
  const { did, getToken } = await createAccountAndToken(factory, pdsDid);

  const res = await factory.app.request("/xrpc/com.atproto.repo.deleteRecord", {
    method: "POST",
    body: JSON.stringify({ repo: did, collection: "com.example.record", rkey: "nonexistent" }),
    headers: authHeaders(await getToken()),
  });
  assertEquals(res.status, 200);
});

Deno.test("[conformance] putRecord creates if not exists, updates if exists", async () => {
  const kp = await Secp256k1Keypair.create();
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer: signerFromKeypair(kp) });
  const pdsDid = signerFromKeypair(kp).did();
  const { did, getToken } = await createAccountAndToken(factory, pdsDid);

  const putRes1 = await factory.app.request("/xrpc/com.atproto.repo.putRecord", {
    method: "POST",
    body: JSON.stringify({ repo: did, collection: "app.bsky.actor.profile", rkey: "self", record: { displayName: "Alice" } }),
    headers: authHeaders(await getToken()),
  });
  assertEquals(putRes1.status, 200);
  const putData1 = await putRes1.json() as { uri: string; cid: string };
  assertEquals(putData1.uri, `at://${did}/app.bsky.actor.profile/self`);

  const getRes1 = await factory.app.request(
    `/xrpc/com.atproto.repo.getRecord?repo=${did}&collection=app.bsky.actor.profile&rkey=self`,
  );
  const getData1 = await getRes1.json() as { value: Record<string, unknown> };
  assertEquals(getData1.value.displayName, "Alice");

  const putRes2 = await factory.app.request("/xrpc/com.atproto.repo.putRecord", {
    method: "POST",
    body: JSON.stringify({ repo: did, collection: "app.bsky.actor.profile", rkey: "self", record: { displayName: "Alice2", description: "Updated" } }),
    headers: authHeaders(await getToken()),
  });
  assertEquals(putRes2.status, 200);

  const getRes2 = await factory.app.request(
    `/xrpc/com.atproto.repo.getRecord?repo=${did}&collection=app.bsky.actor.profile&rkey=self`,
  );
  const getData2 = await getRes2.json() as { value: Record<string, unknown> };
  assertEquals(getData2.value.displayName, "Alice2");
  assertEquals(getData2.value.description, "Updated");
});

Deno.test("[conformance] applyWrites batch creates multiple records", async () => {
  const kp = await Secp256k1Keypair.create();
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer: signerFromKeypair(kp) });
  const pdsDid = signerFromKeypair(kp).did();
  const { did, getToken } = await createAccountAndToken(factory, pdsDid);

  const res = await factory.app.request("/xrpc/com.atproto.repo.applyWrites", {
    method: "POST",
    body: JSON.stringify({
      repo: did,
      writes: [
        { $type: "com.atproto.repo.applyWrites#create", collection: "app.bsky.feed.post", value: { $type: "app.bsky.feed.post", text: "A", createdAt: new Date().toISOString() } },
        { $type: "com.atproto.repo.applyWrites#create", collection: "app.bsky.feed.post", value: { $type: "app.bsky.feed.post", text: "B", createdAt: new Date().toISOString() } },
      ],
    }),
    headers: authHeaders(await getToken()),
  });
  assertEquals(res.status, 200);
  const data = await res.json() as { results: Array<{ $type: string; uri: string; cid: string }> };
  assertEquals(data.results.length, 2);
  assertEquals(data.results[0].$type, "com.atproto.repo.applyWrites#createResult");
  assertEquals(data.results[1].$type, "com.atproto.repo.applyWrites#createResult");
});

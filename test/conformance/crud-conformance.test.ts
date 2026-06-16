import { assertEquals, assertExists, assertRejects, assertGreater } from "@std/assert";
import { createRepoFactory } from "@publicdomainrelay/hono-factory-atproto-repo-deno";
import { MemoryStorage } from "@publicdomainrelay/atproto-repo-deno";
import { encode as cborEncode, decode as cborDecode } from "@publicdomainrelay/common";
import type { Signer, Bytes, Did, SequencedFrame } from "@publicdomainrelay/atproto-repo-abc";

class MockSigner implements Signer {
  #did: Did;
  constructor(did: Did = "did:key:zConformanceTest") { this.#did = did; }
  did(): Did { return this.#did; }
  async sign(bytes: Bytes): Promise<Bytes> {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
    return new Uint8Array(digest);
  }
}

function buildHeaders(did: Did): Record<string, string> {
  return { "content-type": "application/json" };
}

Deno.test("[conformance] health endpoint returns version", async () => {
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer: new MockSigner() });
  const res = await factory.app.request("/xrpc/_health");
  assertEquals(res.status, 200);
  const data = await res.json() as { version?: string };
  assertEquals(typeof data.version, "string");
});

Deno.test("[conformance] describeServer returns did, version, availableUserDomains, inviteCodeRequired", async () => {
  const signer = new MockSigner();
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
  const signer = new MockSigner();
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer });
  const res = await factory.app.request("/.well-known/atproto-did");
  assertEquals(res.status, 200);
  const text = await res.text();
  assertEquals(text, signer.did());
});

Deno.test("[conformance] createRecord returns uri and cid", async () => {
  const signer = new MockSigner();
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer });
  const did = signer.did();
  const res = await factory.app.request("/xrpc/com.atproto.repo.createRecord", {
    method: "POST",
    body: JSON.stringify({ repo: did, collection: "app.bsky.feed.post", record: { text: "Hello", createdAt: new Date().toISOString() } }),
    headers: buildHeaders(did),
  });
  assertEquals(res.status, 200);
  const data = await res.json() as { uri: string; cid: string };
  assertEquals(typeof data.uri, "string");
  assertEquals(data.uri.startsWith(`at://${did}/`), true);
  assertEquals(typeof data.cid, "string");
  assertEquals(data.cid.startsWith("b"), true);
});

Deno.test("[conformance] createRecord defaults $type to collection name", async () => {
  const signer = new MockSigner();
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer });
  const did = signer.did();
  const res = await factory.app.request("/xrpc/com.atproto.repo.createRecord", {
    method: "POST",
    body: JSON.stringify({ repo: did, collection: "com.example.record", record: { foo: "bar" } }),
    headers: buildHeaders(did),
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
  const signer = new MockSigner();
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer });
  const did = signer.did();
  const recordValue = { $type: "app.bsky.feed.post", text: "Hello, world!", createdAt: new Date().toISOString() };
  const createRes = await factory.app.request("/xrpc/com.atproto.repo.createRecord", {
    method: "POST",
    body: JSON.stringify({ repo: did, collection: "app.bsky.feed.post", record: recordValue }),
    headers: buildHeaders(did),
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
  const signer = new MockSigner();
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer });
  const did = signer.did();
  const res = await factory.app.request(
    `/xrpc/com.atproto.repo.getRecord?repo=${did}&collection=com.example.record&rkey=nonexistent`,
  );
  assertEquals(res.status, 400);
  const data = await res.json() as { error: string };
  assertEquals(data.error, "RecordNotFound");
});

Deno.test("[conformance] listRecords returns paginated results with cursor", async () => {
  const signer = new MockSigner();
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer });
  const did = signer.did();

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
  const signer = new MockSigner();
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer });
  const did = signer.did();

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
  const signer = new MockSigner();
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer });
  const did = signer.did();
  const res = await factory.app.request("/xrpc/com.atproto.repo.deleteRecord", {
    method: "POST",
    body: JSON.stringify({ repo: did, collection: "com.example.record", rkey: "nonexistent" }),
    headers: buildHeaders(did),
  });
  assertEquals(res.status, 200);
});

Deno.test("[conformance] putRecord creates if not exists, updates if exists", async () => {
  const signer = new MockSigner();
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer });
  const did = signer.did();

  const putRes1 = await factory.app.request("/xrpc/com.atproto.repo.putRecord", {
    method: "POST",
    body: JSON.stringify({ repo: did, collection: "app.bsky.actor.profile", rkey: "self", record: { displayName: "Alice" } }),
    headers: buildHeaders(did),
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
    headers: buildHeaders(did),
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
  const signer = new MockSigner();
  const factory = createRepoFactory({ storage: new MemoryStorage(), signer });
  const did = signer.did();

  const res = await factory.app.request("/xrpc/com.atproto.repo.applyWrites", {
    method: "POST",
    body: JSON.stringify({
      repo: did,
      writes: [
        { $type: "com.atproto.repo.applyWrites#create", collection: "app.bsky.feed.post", value: { $type: "app.bsky.feed.post", text: "A", createdAt: new Date().toISOString() } },
        { $type: "com.atproto.repo.applyWrites#create", collection: "app.bsky.feed.post", value: { $type: "app.bsky.feed.post", text: "B", createdAt: new Date().toISOString() } },
      ],
    }),
    headers: buildHeaders(did),
  });
  assertEquals(res.status, 200);
  const data = await res.json() as { results: Array<{ $type: string; uri: string; cid: string }> };
  assertEquals(data.results.length, 2);
  assertEquals(data.results[0].$type, "com.atproto.repo.applyWrites#createResult");
  assertEquals(data.results[1].$type, "com.atproto.repo.applyWrites#createResult");
});

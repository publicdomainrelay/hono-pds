import { assertEquals, assertExists } from "@std/assert";
import { createRepoFactory } from "@publicdomainrelay/hono-factory-atproto-repo-deno";
import { MemoryStorage } from "@publicdomainrelay/atproto-repo-deno";
import type { Signer, Bytes, Did, SequencedFrame } from "@publicdomainrelay/atproto-repo-abc";

class MockSigner implements Signer {
  #did: Did;
  constructor(did: Did = "did:key:zE2eTest") { this.#did = did; }
  did(): Did { return this.#did; }
  async sign(bytes: Bytes): Promise<Bytes> {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
    return new Uint8Array(digest);
  }
}

Deno.test("e2e createRecord returns uri+cid", async () => {
  const storage = new MemoryStorage();
  const signer = new MockSigner();
  const factory = createRepoFactory({ storage, signer });

  const body = JSON.stringify({
    repo: signer.did(),
    collection: "com.example.record",
    rkey: "abc123",
    record: { hello: "world" },
  });

  const res = await factory.app.request(
    "/xrpc/com.atproto.repo.createRecord",
    { method: "POST", body, headers: { "content-type": "application/json" } },
  );

  assertEquals(res.status, 200);
  const data = await res.json() as { uri: string; cid: string };
  assertEquals(typeof data.uri, "string");
  assertEquals(data.uri, `at://${signer.did()}/com.example.record/abc123`);
  assertEquals(typeof data.cid, "string");
});

Deno.test("e2e getRecord returns stored record", async () => {
  const storage = new MemoryStorage();
  const signer = new MockSigner();
  const factory = createRepoFactory({ storage, signer });

  await factory.api.applyWrites(signer.did(), [{
    action: "create",
    collection: "com.example.record",
    rkey: "gettest",
    record: { foo: "bar" },
  }]);

  const res = await factory.app.request(
    `/xrpc/com.atproto.repo.getRecord?repo=${signer.did()}&collection=com.example.record&rkey=gettest`,
  );

  assertEquals(res.status, 200);
  const data = await res.json() as { uri: string; cid: string; value: unknown };
  assertEquals(data.value, { foo: "bar" });
});

Deno.test("e2e listRecords returns paginated records", async () => {
  const storage = new MemoryStorage();
  const signer = new MockSigner();
  const factory = createRepoFactory({ storage, signer });

  for (let i = 0; i < 3; i++) {
    await factory.api.applyWrites(signer.did(), [{
      action: "create",
      collection: "com.example.record",
      rkey: `page${i}`,
      record: { n: i },
    }]);
  }

  const res = await factory.app.request(
    `/xrpc/com.atproto.repo.listRecords?repo=${signer.did()}&collection=com.example.record&limit=2`,
  );

  assertEquals(res.status, 200);
  const data = await res.json() as { records: unknown[]; cursor?: string };
  assertEquals(data.records.length, 2);
  assertExists(data.cursor);
});

Deno.test("e2e describeRepo returns collections", async () => {
  const storage = new MemoryStorage();
  const signer = new MockSigner();
  const factory = createRepoFactory({ storage, signer });

  await factory.api.applyWrites(signer.did(), [{
    action: "create",
    collection: "com.example.alpha",
    rkey: "a1",
    record: { v: 1 },
  }]);

  const res = await factory.app.request(
    `/xrpc/com.atproto.repo.describeRepo?repo=${signer.did()}`,
  );

  assertEquals(res.status, 200);
  const data = await res.json() as { collections: string[]; head: string };
  assertEquals(data.collections, ["com.example.alpha"]);
  assertExists(data.head);
});

Deno.test("e2e subscribe delivers frame after createRecord", async () => {
  const storage = new MemoryStorage();
  const signer = new MockSigner();
  const factory = createRepoFactory({ storage, signer });

  let emittedFrame: SequencedFrame | null = null;

  const dispose = factory.subscribe(
    { params: {} },
    (frame: SequencedFrame) => { emittedFrame = frame; },
  );

  await factory.api.applyWrites(signer.did(), [{
    action: "create",
    collection: "com.example.record",
    rkey: "subtest",
    record: { x: 1 },
  }]);

  for (let i = 0; i < 20 && emittedFrame === null; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }

  assertExists(emittedFrame);
  assertEquals(emittedFrame.repo, signer.did());
  assertEquals(emittedFrame.ops.length, 1);
  assertEquals(emittedFrame.ops[0].action, "create");
  assertEquals(emittedFrame.ops[0].path, "com.example.record/subtest");

  dispose();
});

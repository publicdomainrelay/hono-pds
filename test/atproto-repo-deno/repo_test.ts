import { assertEquals, assertExists } from "@std/assert";
import { MemoryStorage, Repo } from "@publicdomainrelay/atproto-repo-deno";
import type { Signer, Bytes, Did } from "@publicdomainrelay/atproto-repo-abc";

class MockSigner implements Signer {
  #did: Did;
  constructor(did: Did = "did:key:zTest123") { this.#did = did; }
  did(): Did { return this.#did; }
  async sign(bytes: Bytes): Promise<Bytes> {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
    return new Uint8Array(digest);
  }
}

Deno.test("Repo createRecord getRecord round-trip", async () => {
  const store = new MemoryStorage();
  const signer = new MockSigner();
  const repo = new Repo(store, signer);

  const result = await repo.applyWrites(repo.did, [{
    action: "create",
    collection: "com.example.record",
    rkey: "abc123",
    record: { hello: "world" },
  }]);

  assertExists(result.commit);
  assertExists(result.rev);
  assertEquals(result.ops.length, 1);
  assertEquals(result.ops[0].action, "create");

  const record = await repo.getRecord(repo.did, "com.example.record", "abc123");
  assertExists(record);
  assertEquals(record.uri, `at://${repo.did}/com.example.record/abc123`);
  assertEquals(record.value, { hello: "world" });
});

Deno.test("Repo listRecords with pagination", async () => {
  const store = new MemoryStorage();
  const signer = new MockSigner();
  const repo = new Repo(store, signer);

  for (let i = 0; i < 5; i++) {
    await repo.applyWrites(repo.did, [{
      action: "create",
      collection: "com.example.record",
      rkey: `key${String(i).padStart(3, "0")}`,
      record: { n: i },
    }]);
  }

  const page1 = await repo.listRecords(repo.did, "com.example.record", { limit: 2 });
  assertEquals(page1.records.length, 2);
  assertExists(page1.cursor);

  const page2 = await repo.listRecords(repo.did, "com.example.record", { limit: 10, cursor: page1.cursor });
  assertEquals(page2.records.length, 3);
});

Deno.test("Repo deleteRecord", async () => {
  const store = new MemoryStorage();
  const signer = new MockSigner();
  const repo = new Repo(store, signer);

  await repo.applyWrites(repo.did, [{
    action: "create",
    collection: "com.example.record",
    rkey: "delete-me",
    record: { data: "test" },
  }]);

  await repo.applyWrites(repo.did, [{
    action: "delete",
    collection: "com.example.record",
    rkey: "delete-me",
  }]);

  const record = await repo.getRecord(repo.did, "com.example.record", "delete-me");
  assertEquals(record, null);
});

Deno.test("Repo applyWrites batch create/update/delete", async () => {
  const store = new MemoryStorage();
  const signer = new MockSigner();
  const repo = new Repo(store, signer);

  const created = await repo.applyWrites(repo.did, [{
    action: "create",
    collection: "com.example.record",
    rkey: "batch-test",
    record: { v: 1 },
  }]);
  assertEquals(created.ops[0].action, "create");

  const updated = await repo.applyWrites(repo.did, [{
    action: "update",
    collection: "com.example.record",
    rkey: "batch-test",
    record: { v: 2 },
  }]);
  assertEquals(updated.ops[0].action, "update");

  const deleted = await repo.applyWrites(repo.did, [{
    action: "delete",
    collection: "com.example.record",
    rkey: "batch-test",
  }]);
  assertEquals(deleted.ops[0].action, "delete");
});

Deno.test("Repo describeRepo collections", async () => {
  const store = new MemoryStorage();
  const signer = new MockSigner();
  const repo = new Repo(store, signer);

  const emptyDesc = await repo.describe(repo.did);
  assertEquals(emptyDesc.collections.length, 0);
  assertEquals(emptyDesc.head, null);

  await repo.applyWrites(repo.did, [{
    action: "create",
    collection: "com.example.alpha",
    rkey: "a1",
    record: { x: 1 },
  }]);

  await repo.applyWrites(repo.did, [{
    action: "create",
    collection: "com.example.beta",
    rkey: "b1",
    record: { y: 2 },
  }]);

  const desc = await repo.describe(repo.did);
  assertExists(desc.head);
  assertEquals(desc.collections.length, 2);
  assertEquals(desc.collections, ["com.example.alpha", "com.example.beta"]);
});

// A commit is read-modify-write over the repo head. Writes that interleave both
// build the MST from the same root, so without serialization the last setHead
// silently drops the other's records while still reporting success.
Deno.test("Repo concurrent applyWrites to one repo keep every record", async () => {
  const store = new MemoryStorage();
  const signer = new MockSigner();
  const repo = new Repo(store, signer);
  const did = signer.did();

  const rkeys = ["a", "b", "c", "d", "e"];
  const events = await Promise.all(rkeys.map((rkey) =>
    repo.applyWrites(did, [{
      action: "create" as const,
      collection: "com.example.record",
      rkey,
      record: { rkey },
    }])
  ));

  for (const rkey of rkeys) {
    const got = await repo.getRecord(did, "com.example.record", rkey);
    assertExists(got, `record ${rkey} must survive concurrent commits`);
    assertEquals((got.value as { rkey: string }).rkey, rkey);
  }

  const listed = await repo.listRecords(did, "com.example.record");
  assertEquals(listed.records.length, rkeys.length);

  // Each commit must build on the previous one, not fork off a shared parent.
  const revs = new Set(events.map((e) => e.rev));
  assertEquals(revs.size, rkeys.length, "each commit needs its own rev");
});

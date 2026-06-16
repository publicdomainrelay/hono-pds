import { assertEquals, assertExists } from "@std/assert";
import { MemoryStorage, DenoKvStorage } from "@publicdomainrelay/atproto-repo-deno";

Deno.test("MemoryStorage put/get round-trip", async () => {
  const store = new MemoryStorage();
  const cid = "btest123";
  const bytes = new Uint8Array([1, 2, 3]);
  await store.put(cid, bytes);
  const result = await store.get(cid);
  assertEquals(result, bytes);
});

Deno.test("MemoryStorage has works", async () => {
  const store = new MemoryStorage();
  const cid = "btest456";
  assertEquals(await store.has(cid), false);
  await store.put(cid, new Uint8Array([4, 5, 6]));
  assertEquals(await store.has(cid), true);
});

Deno.test("MemoryStorage missing returns null", async () => {
  const store = new MemoryStorage();
  const result = await store.get("bmissing");
  assertEquals(result, null);
});

Deno.test("MemoryStorage overwrite works", async () => {
  const store = new MemoryStorage();
  const cid = "boverwrite";
  await store.put(cid, new Uint8Array([1]));
  await store.put(cid, new Uint8Array([2]));
  const result = await store.get(cid);
  assertEquals(result, new Uint8Array([2]));
});

Deno.test("MemoryStorage getHead/setHead", async () => {
  const store = new MemoryStorage();
  const did = "did:key:zTest";
  const head = { commit: "bheadcommit", rev: "3abc234" as string };
  assertEquals(await store.getHead(did), null);
  await store.setHead(did, head);
  const result = await store.getHead(did);
  assertExists(result);
  assertEquals(result.commit, head.commit);
  assertEquals(result.rev, head.rev);
});

Deno.test("DenoKvStorage class exists", () => {
  assertExists(DenoKvStorage);
  assertEquals(typeof DenoKvStorage, "function");
});

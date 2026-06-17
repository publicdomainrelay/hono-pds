import { assertEquals } from "@std/assert";
import { createMst } from "@publicdomainrelay/atproto-repo-abc";
import type { Hasher, Bytes } from "@publicdomainrelay/atproto-repo-abc";
import { MemoryStorage } from "@publicdomainrelay/atproto-repo-deno";
import { cidFromDigest } from "@publicdomainrelay/atproto-repo-common";

const sha256: Hasher = async (data: Bytes): Promise<Bytes> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
  );
  return new Uint8Array(digest);
};

const makeCid = (fill: number): string => {
  const digest = new Uint8Array(32).fill(fill);
  return cidFromDigest(digest);
};

Deno.test("MST create empty node", async () => {
  const store = new MemoryStorage();
  const mst = createMst(store, sha256);
  await mst.init();
  assertEquals(mst.root, null);
  assertEquals(mst.size, 0);
});

Deno.test("MST insert and get records", async () => {
  const store = new MemoryStorage();
  const mst = createMst(store, sha256);
  await mst.init();
  const cid = makeCid(1);
  await mst.set("com.example.record/abc123", cid);
  const retrieved = await mst.get("com.example.record/abc123");
  assertEquals(retrieved, cid);
});

Deno.test("MST update records", async () => {
  const store = new MemoryStorage();
  const mst = createMst(store, sha256);
  await mst.init();
  const cidA = makeCid(1);
  await mst.set("com.example.record/abc123", cidA);
  const cidB = makeCid(2);
  await mst.set("com.example.record/abc123", cidB);
  const retrieved = await mst.get("com.example.record/abc123");
  assertEquals(retrieved, cidB);
});

Deno.test("MST delete records", async () => {
  const store = new MemoryStorage();
  const mst = createMst(store, sha256);
  await mst.init();
  const cid = makeCid(3);
  await mst.set("com.example.record/abc123", cid);
  await mst.delete("com.example.record/abc123");
  const retrieved = await mst.get("com.example.record/abc123");
  assertEquals(retrieved, null);
});

Deno.test("MST list entries", async () => {
  const store = new MemoryStorage();
  const mst = createMst(store, sha256);
  await mst.init();
  await mst.set("com.example.record/a", makeCid(1));
  await mst.set("com.example.record/b", makeCid(2));
  const entries: { key: string; value: string }[] = [];
  for await (const entry of mst.entries()) {
    entries.push(entry);
  }
  assertEquals(entries.length, 2);
});

Deno.test("MST root CID determinism", async () => {
  const storeA = new MemoryStorage();
  const storeB = new MemoryStorage();
  const mstA = createMst(storeA, sha256);
  const mstB = createMst(storeB, sha256);
  await mstA.init();
  await mstB.init();
  const cid = makeCid(42);
  await mstA.set("com.example.record/foo", cid);
  await mstB.set("com.example.record/foo", cid);
  assertEquals(mstA.root, mstB.root);
});

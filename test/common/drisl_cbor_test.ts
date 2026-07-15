import { assertEquals, assert } from "@std/assert";
import { drislEncode, drislDecode, drislCidLink, isDrislCidLink, drislCidFromLink, cidFromDigest, SHA256_DIGEST_LEN } from "@publicdomainrelay/atproto-repo-common";

Deno.test("drisl-cbor encode/decode integer round-trip", () => {
  const bytes = drislEncode(42);
  const val = drislDecode(bytes);
  assertEquals(val, 42);
});

Deno.test("drisl-cbor encode/decode negative integer", () => {
  const bytes = drislEncode(-42);
  const val = drislDecode(bytes);
  assertEquals(val, -42);
});

Deno.test("drisl-cbor encode/decode zero", () => {
  const bytes = drislEncode(0);
  const val = drislDecode(bytes);
  assertEquals(val, 0);
});

Deno.test("drisl-cbor encode/decode string", () => {
  const bytes = drislEncode("hello");
  const val = drislDecode(bytes);
  assertEquals(val, "hello");
});

Deno.test("drisl-cbor encode/decode bytes", () => {
  const input = new Uint8Array([1, 2, 3]);
  const bytes = drislEncode(input);
  const val = drislDecode(bytes) as Uint8Array;
  assertEquals(val instanceof Uint8Array, true);
  assertEquals(val.length, 3);
  assertEquals(val[0], 1);
  assertEquals(val[1], 2);
  assertEquals(val[2], 3);
});

Deno.test("drisl-cbor encode/decode array", () => {
  const bytes = drislEncode([1, "two", [3]]);
  const val = drislDecode(bytes) as unknown[];
  assertEquals(Array.isArray(val), true);
  assertEquals(val.length, 3);
  assertEquals(val[0], 1);
  assertEquals(val[1], "two");
  assertEquals(Array.isArray((val as unknown[])[2]), true);
});

Deno.test("drisl-cbor encode/decode map", () => {
  const bytes = drislEncode({ a: 1, b: "c" });
  const val = drislDecode(bytes) as Record<string, unknown>;
  assertEquals(val.a, 1);
  assertEquals(val.b, "c");
});

Deno.test("drisl-cbor encode/decode CID link", async () => {
  const digest = new Uint8Array(SHA256_DIGEST_LEN);
  crypto.getRandomValues(digest);
  const cid = cidFromDigest(digest);
  const link = drislCidLink(cid);
  assert(isDrislCidLink(link));
  const extracted = drislCidFromLink(link);
  assertEquals(extracted, cid);
  const bytes = drislEncode(link);
  const decoded = drislDecode(bytes) as { $link: string };
  assert(isDrislCidLink(decoded));
  assertEquals(drislCidFromLink(decoded), cid);
});

Deno.test("drisl-cbor encode/decode null/true/false", () => {
  assertEquals(drislDecode(drislEncode(null)), null);
  assertEquals(drislDecode(drislEncode(true)), true);
  assertEquals(drislDecode(drislEncode(false)), false);
});

Deno.test("drisl-cbor deterministic map key ordering", () => {
  const obj1 = { c: 1, a: 2, b: 3 };
  const obj2 = { a: 2, b: 3, c: 1 };
  const bytes1 = drislEncode(obj1);
  const bytes2 = drislEncode(obj2);
  assertEquals(bytes1.length, bytes2.length);
  for (let i = 0; i < bytes1.length; i++) {
    assertEquals(bytes1[i], bytes2[i], `byte ${i} differs`);
  }
});

Deno.test("drisl-cbor same object produces identical bytes", () => {
  const obj = { x: 1 };
  const bytes1 = drislEncode(obj);
  const bytes2 = drislEncode(obj);
  assertEquals(bytes1.length, bytes2.length);
  for (let i = 0; i < bytes1.length; i++) {
    assertEquals(bytes1[i], bytes2[i], `byte ${i} differs`);
  }
});

Deno.test("drisl-cbor rejects floats", () => {
  try {
    drislEncode(3.14);
    assert(false, "should have thrown");
  } catch (e) {
    assert((e as Error).message.includes("floats not allowed"));
  }
});

Deno.test("drisl-cbor cidFromDigest produces 0x72 codec", async () => {
  const digest = new Uint8Array(SHA256_DIGEST_LEN);
  crypto.getRandomValues(digest);
  const cid = cidFromDigest(digest);
  assertEquals(typeof cid, "string");
  assert(cid.startsWith("b"), "CID should start with multibase 'b'");
  assertEquals(cid.length, 59);
});

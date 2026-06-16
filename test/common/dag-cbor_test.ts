import { assertEquals } from "@std/assert";
import { encode, decode, cidLink, isCidLink, cidFromLink, cidFromDigest } from "@publicdomainrelay/common";

Deno.test("encode/decode integer round-trip", () => {
  assertEquals(decode(encode(42)), 42);
});

Deno.test("encode/decode negative integer", () => {
  assertEquals(decode(encode(-42)), -42);
});

Deno.test("encode/decode zero", () => {
  assertEquals(decode(encode(0)), 0);
});

Deno.test("encode/decode string", () => {
  assertEquals(decode(encode("hello")), "hello");
});

Deno.test("encode/decode bytes", () => {
  const val = new Uint8Array([1, 2, 3]);
  const decoded = decode(encode(val)) as Uint8Array;
  assertEquals(decoded, val);
});

Deno.test("encode/decode array", () => {
  const val = [1, "two", [3]];
  assertEquals(decode(encode(val)), val);
});

Deno.test("encode/decode map", () => {
  const val = { a: 1, b: "c" };
  assertEquals(decode(encode(val)), val);
});

Deno.test("encode/decode CID link", () => {
  const digest = new Uint8Array(32).fill(0);
  digest[0] = 0xe3;
  digest[1] = 0xb0;
  const cid = cidFromDigest(digest);
  const link = cidLink(cid);
  const bytes = encode(link);
  const decoded = decode(bytes);
  assertEquals(isCidLink(decoded), true);
  assertEquals(cidFromLink(decoded as { $link: string }), cid);
});

Deno.test("encode/decode null/true/false", () => {
  assertEquals(decode(encode(null)), null);
  assertEquals(decode(encode(true)), true);
  assertEquals(decode(encode(false)), false);
});

Deno.test("deterministic map key ordering", () => {
  const a = encode({ z: 1, a: 2, m: 3 });
  const b = encode({ a: 2, m: 3, z: 1 });
  assertEquals(a, b);
});

Deno.test("same object twice produces identical bytes", () => {
  const obj = { hello: "world", num: 123 };
  const a = encode(obj);
  const b = encode(obj);
  assertEquals(a, b);
});

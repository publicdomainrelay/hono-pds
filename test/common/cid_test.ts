import { assertEquals } from "@std/assert";
import { cidFromDigest, cidToBytes, cidDigest, isValidCid, cidEquals } from "@publicdomainrelay/common";

const EMPTY_SHA256 = new Uint8Array([
  0xe3, 0xb0, 0xc4, 0x42, 0x98, 0xfc, 0x1c, 0x14,
  0x9a, 0xfb, 0xf4, 0xc8, 0x99, 0x6f, 0xb9, 0x24,
  0x27, 0xae, 0x41, 0xe4, 0x64, 0x9b, 0x93, 0x4c,
  0xa4, 0x95, 0x99, 0x1b, 0x78, 0x52, 0xb8, 0x55,
]);

Deno.test("cidFromDigest produces correct format", () => {
  const cid = cidFromDigest(EMPTY_SHA256);
  assertEquals(typeof cid, "string");
  assertEquals(cid.startsWith("b"), true);
  assertEquals(cid.length, 59);
});

Deno.test("cidToBytes round-trip", () => {
  const cid = cidFromDigest(EMPTY_SHA256);
  const bytes = cidToBytes(cid);
  assertEquals(bytes.length, 36);
  assertEquals(bytes[0], 0x01);
  assertEquals(bytes[1], 0x71);
  assertEquals(bytes[2], 0x12);
  assertEquals(bytes[3], 0x20);
});

Deno.test("cidDigest extracts correctly", () => {
  const cid = cidFromDigest(EMPTY_SHA256);
  const digest = cidDigest(cid);
  assertEquals(digest, EMPTY_SHA256);
});

Deno.test("isValidCid validates", () => {
  const cid = cidFromDigest(EMPTY_SHA256);
  assertEquals(isValidCid(cid), true);
  assertEquals(isValidCid("binvalid"), false);
  assertEquals(isValidCid(""), false);
});

Deno.test("cidEquals works", () => {
  const a = cidFromDigest(EMPTY_SHA256);
  const b = cidFromDigest(EMPTY_SHA256);
  assertEquals(cidEquals(a, b), true);
});

import { assertEquals, assertThrows } from "@std/assert";
import {
  hexEncode, hexDecode,
  base64Encode, base64Decode,
  base32Encode, base32Decode,
  utf8Encode, utf8Decode,
  concat, bytesEqual,
} from "@publicdomainrelay/atproto-repo-common";

Deno.test("hexEncode/hexDecode round-trip", () => {
  const input = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
  const encoded = hexEncode(input);
  assertEquals(encoded, "deadbeef");
  const decoded = hexDecode(encoded);
  assertEquals(decoded, input);
});

Deno.test("hexDecode accepts uppercase", () => {
  const decoded = hexDecode("DEADBEEF");
  assertEquals(decoded, new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
});

Deno.test("hexDecode throws on odd length", () => {
  assertThrows(() => hexDecode("abc"));
});

Deno.test("base64Encode/base64Decode round-trip", () => {
  const input = new Uint8Array([104, 101, 108, 108, 111]);
  const encoded = base64Encode(input);
  assertEquals(encoded, "aGVsbG8=");
  const decoded = base64Decode(encoded);
  assertEquals(decoded, input);
});

Deno.test("base32Encode/base32Decode round-trip", () => {
  const input = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
  const encoded = base32Encode(input);
  const decoded = base32Decode(encoded);
  assertEquals(decoded, input);
});

Deno.test("utf8Encode/utf8Decode round-trip", () => {
  const input = "Hello, World!";
  const encoded = utf8Encode(input);
  assertEquals(encoded, new Uint8Array([72, 101, 108, 108, 111, 44, 32, 87, 111, 114, 108, 100, 33]));
  const decoded = utf8Decode(encoded);
  assertEquals(decoded, input);
});

Deno.test("utf8Encode handles empty string", () => {
  assertEquals(utf8Encode(""), new Uint8Array(0));
});

Deno.test("concat combines multiple arrays", () => {
  const a = new Uint8Array([1, 2, 3]);
  const b = new Uint8Array([4, 5]);
  const c = new Uint8Array([6]);
  const result = concat(a, b, c);
  assertEquals(result, new Uint8Array([1, 2, 3, 4, 5, 6]));
});

Deno.test("bytesEqual returns true for equal arrays", () => {
  assertEquals(bytesEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true);
});

Deno.test("bytesEqual returns false for different arrays", () => {
  assertEquals(bytesEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false);
});

Deno.test("bytesEqual returns false for different lengths", () => {
  assertEquals(bytesEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2])), false);
});

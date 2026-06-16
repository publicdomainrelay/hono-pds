import { assertEquals } from "@std/assert";
import { nextTid, parseTid, isValidTid, resetClockId } from "@publicdomainrelay/common";

Deno.test("nextTid produces 13-char strings", () => {
  const tid = nextTid();
  assertEquals(tid.length, 13);
});

Deno.test("nextTid is strictly increasing", () => {
  const a = nextTid();
  const b = nextTid();
  const c = nextTid();
  assertEquals(a < b, true);
  assertEquals(b < c, true);
});

Deno.test("parseTid round-trips", () => {
  const tid = nextTid();
  const parsed = parseTid(tid);
  assertEquals(typeof parsed.micros, "number");
  assertEquals(typeof parsed.clockId, "number");
});

Deno.test("isValidTid validates", () => {
  const tid = nextTid();
  assertEquals(isValidTid(tid), true);
  assertEquals(isValidTid(""), false);
  assertEquals(isValidTid("short"), false);
});

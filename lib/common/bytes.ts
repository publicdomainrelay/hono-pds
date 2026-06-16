export type Bytes = Uint8Array;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8Encode(s: string): Bytes {
  return encoder.encode(s);
}

export function utf8Decode(b: Bytes): string {
  return decoder.decode(b);
}

const HEX_ALPHABET = "0123456789abcdef";

export function hexEncode(b: Bytes): string {
  let s = "";
  for (let i = 0; i < b.length; i++) {
    s += HEX_ALPHABET[b[i] >> 4];
    s += HEX_ALPHABET[b[i] & 0x0f];
  }
  return s;
}

export function hexDecode(s: string): Bytes {
  if (s.length % 2 !== 0) throw new Error("hex: odd length");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2) {
    out[i / 2] = (hexNibble(s.charCodeAt(i)) << 4) | hexNibble(s.charCodeAt(i + 1));
  }
  return out;
}

function hexNibble(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
  throw new Error(`hex: invalid nibble ${String.fromCharCode(c)}`);
}

export function base64Encode(b: Bytes): string {
  let bin = "";
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin);
}

export function base64Decode(s: string): Bytes {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const BASE32_RFC_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export function base32Encode(b: Bytes): string {
  let s = "";
  let bits = 0;
  let value = 0;
  for (let i = 0; i < b.length; i++) {
    value = (value << 8) | b[i];
    bits += 8;
    while (bits >= 5) {
      s += BASE32_RFC_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    s += BASE32_RFC_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return s;
}

export function base32Decode(s: string): Bytes {
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (let i = 0; i < s.length; i++) {
    const idx = BASE32_RFC_ALPHABET.indexOf(s[i]);
    if (idx === -1) throw new Error(`base32: invalid character '${s[i]}'`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function concat(...arrays: Bytes[]): Bytes {
  const total = arrays.reduce((acc, a) => acc + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

export function bytesEqual(a: Bytes, b: Bytes): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

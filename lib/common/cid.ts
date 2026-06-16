import type { Bytes } from "./bytes.ts";
import { base32Encode, base32Decode, bytesEqual } from "./bytes.ts";

export type Cid = string;

export const DAG_CBOR_CODEC = 0x71;
export const SHA256_CODE = 0x12;
export const SHA256_DIGEST_LEN = 32;

const CIDv1_HEADER_LEN = 4;
const CIDv1_BYTES_LEN = CIDv1_HEADER_LEN + SHA256_DIGEST_LEN;

export function cidFromDigest(digest: Bytes): Cid {
  if (digest.length !== SHA256_DIGEST_LEN) {
    throw new Error(`cidFromDigest: digest must be 32 bytes, got ${digest.length}`);
  }
  const cidBytes = new Uint8Array(CIDv1_BYTES_LEN);
  cidBytes[0] = 0x01;
  cidBytes[1] = DAG_CBOR_CODEC;
  cidBytes[2] = SHA256_CODE;
  cidBytes[3] = SHA256_DIGEST_LEN;
  cidBytes.set(digest, CIDv1_HEADER_LEN);
  return "b" + base32Encode(cidBytes);
}

export function cidToBytes(cid: Cid): Bytes {
  if (!cid.startsWith("b")) {
    throw new Error(
      `cidToBytes: CID must start with 'b' (multibase base32), got '${cid[0] ?? ""}'`,
    );
  }
  return base32Decode(cid.slice(1));
}

export function cidDigest(cid: Cid): Bytes {
  const raw = cidToBytes(cid);
  if (raw.length < CIDv1_BYTES_LEN) {
    throw new Error(`cidDigest: CID too short (${raw.length} bytes, expected ${CIDv1_BYTES_LEN})`);
  }
  if (raw[0] !== 0x01) throw new Error("cidDigest: not CIDv1");
  if (raw[1] !== DAG_CBOR_CODEC) throw new Error("cidDigest: not dag-cbor");
  if (raw[2] !== SHA256_CODE) throw new Error("cidDigest: not sha2-256");
  return raw.slice(CIDv1_HEADER_LEN, CIDv1_HEADER_LEN + SHA256_DIGEST_LEN);
}

export function isValidCid(s: string): s is Cid {
  try {
    const raw = cidToBytes(s);
    return raw.length === CIDv1_BYTES_LEN &&
      raw[0] === 0x01 &&
      raw[1] === DAG_CBOR_CODEC &&
      raw[2] === SHA256_CODE &&
      raw[3] === SHA256_DIGEST_LEN;
  } catch {
    return false;
  }
}

export function cidEquals(a: Cid, b: Cid): boolean {
  return bytesEqual(cidToBytes(a), cidToBytes(b));
}

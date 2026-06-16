import type {
  Bytes, Cid, Did, Tid,
  Signer, Storage,
  WriteOp, CommitEvent, CommitOp,
  RepoApi,
} from "@publicdomainrelay/atproto-repo-abc";
import { XrpcError } from "@publicdomainrelay/atproto-repo-abc";
import { encode as cborEncode, decode as cborDecode, cidLink } from "@publicdomainrelay/common";
import { cidFromDigest } from "@publicdomainrelay/common";
import { nextTid } from "@publicdomainrelay/common";
import { createMst, diff } from "@publicdomainrelay/atproto-repo-abc";
import { concat } from "@publicdomainrelay/common";

interface CommitData {
  did: Did;
  version: number;
  data: Cid;
  rev: Tid;
  prev: Cid | null;
  sig: Bytes;
}

function commitToObj(commit: Omit<CommitData, "sig">): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    did: commit.did,
    version: commit.version,
    data: cidLink(commit.data),
    rev: commit.rev,
  };
  if (commit.prev !== null) {
    obj.prev = cidLink(commit.prev);
  }
  return obj;
}

function encodeCommit(commit: CommitData): Bytes {
  const obj = commitToObj(commit);
  obj.sig = commit.sig;
  return cborEncode(obj);
}

function decodeCommit(bytes: Bytes): CommitData {
  const obj = cborDecode(bytes) as Record<string, unknown>;
  const data = obj.data as { $link: Cid } | undefined;
  const prevRaw = obj.prev as { $link: Cid } | undefined;
  return {
    did: obj.did as Did,
    version: obj.version as number,
    data: data?.$link ?? "",
    rev: obj.rev as Tid,
    prev: prevRaw?.$link ?? null,
    sig: obj.sig as Bytes,
  };
}

async function cidForBytes(bytes: Bytes): Promise<Cid> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  );
  return cidFromDigest(new Uint8Array(digest));
}

async function getMstRoot(store: Storage, commitCid: Cid): Promise<Cid | null> {
  const bytes = await store.get(commitCid);
  if (!bytes) return null;
  const commit = decodeCommit(bytes);
  return commit.data;
}

export class Repo implements RepoApi {
  #store: Storage;
  #signer: Signer;
  #did: Did;

  constructor(store: Storage, signer: Signer, did?: Did) {
    this.#store = store;
    this.#signer = signer;
    this.#did = did ?? signer.did();
  }

  get did(): Did {
    return this.#did;
  }

  async describe(_did: Did): Promise<{ collections: string[]; head: Tid | null }> {
    const head = await this.#store.getHead(_did);
    if (!head) return { collections: [], head: null };
    const rootCid = await getMstRoot(this.#store, head.commit);
    if (!rootCid) return { collections: [], head: head.rev };

    const mst = createMst(this.#store, rootCid);
    await mst.init();
    const collections = new Set<string>();
    for await (const { key } of mst.entries()) {
      const slash = key.indexOf("/");
      if (slash !== -1) collections.add(key.slice(0, slash));
    }
    return {
      collections: [...collections].sort(),
      head: head.rev,
    };
  }

  async getRecord(
    _did: Did,
    collection: string,
    rkey: string,
  ): Promise<{ uri: string; cid: Cid; value: unknown } | null> {
    const head = await this.#store.getHead(_did);
    if (!head) return null;

    const rootCid = await getMstRoot(this.#store, head.commit);
    if (!rootCid) return null;

    const mst = createMst(this.#store, rootCid);
    await mst.init();
    const key = `${collection}/${rkey}`;
    const valueCid = await mst.get(key);
    if (!valueCid) return null;

    const recordBytes = await this.#store.get(valueCid);
    if (!recordBytes) return null;
    const value = cborDecode(recordBytes);
    const uri = `at://${_did}/${collection}/${rkey}`;
    return { uri, cid: valueCid, value };
  }

  async listRecords(
    _did: Did,
    collection: string,
    opts?: { limit?: number; cursor?: string },
  ): Promise<{ records: { uri: string; cid: Cid; value: unknown }[]; cursor?: string }> {
    const head = await this.#store.getHead(_did);
    if (!head) return { records: [] };

    const rootCid = await getMstRoot(this.#store, head.commit);
    if (!rootCid) return { records: [] };

    const mst = createMst(this.#store, rootCid);
    await mst.init();
    const limit = opts?.limit ?? 50;
    const cursor = opts?.cursor ?? "";
    const prefix = `${collection}/`;

    const results: { uri: string; cid: Cid; value: unknown }[] = [];
    let nextCursor: string | undefined;

    for await (const { key, value: valueCid } of mst.entries()) {
      if (!key.startsWith(prefix)) continue;
      if (cursor && key < cursor) continue;
      if (results.length >= limit) {
        nextCursor = key;
        break;
      }
      const recordBytes = await this.#store.get(valueCid);
      if (!recordBytes) continue;
      const value = cborDecode(recordBytes);
      results.push({ uri: `at://${_did}/${key}`, cid: valueCid, value });
    }

    return { records: results, cursor: nextCursor };
  }

  async applyWrites(_did: Did, writes: WriteOp[]): Promise<CommitEvent> {
    if (_did !== this.#did) {
      throw new XrpcError("InvalidRequest", `DID mismatch: expected ${this.#did}`);
    }

    const head = await this.#store.getHead(_did);
    const prevCommit = head?.commit ?? null;
    const since = head?.rev ?? null;

    const prevRoot = prevCommit ? await getMstRoot(this.#store, prevCommit) : null;

    const mst = createMst(this.#store, prevRoot);
    await mst.init();

    const ops: CommitOp[] = [];

    for (const write of writes) {
      const key = `${write.collection}/${write.rkey}`;

      switch (write.action) {
        case "create":
        case "update": {
          if (!write.record) {
            throw new XrpcError(
              "InvalidRequest",
              `record is required for ${write.action}`,
            );
          }
          const recordBytes = cborEncode(write.record);
          const recordCid = await cidForBytes(recordBytes);
          await this.#store.put(recordCid, recordBytes);

          const existing = await mst.get(key);
          await mst.set(key, recordCid);
          ops.push({
            action: existing ? "update" : "create",
            path: key,
            cid: recordCid,
          });
          break;
        }
        case "delete": {
          const existing = await mst.get(key);
          if (!existing) {
            throw new XrpcError("RecordNotFound", `record not found: ${key}`);
          }
          await mst.delete(key);
          ops.push({ action: "delete", path: key, cid: null });
          break;
        }
      }
    }

    const newRoot = mst.root;
    let rootForCommit = newRoot;
    if (rootForCommit === null) {
      const emptyBytes = cborEncode({ e: [] });
      const digest = await crypto.subtle.digest(
        "SHA-256",
        emptyBytes.buffer.slice(
          emptyBytes.byteOffset,
          emptyBytes.byteOffset + emptyBytes.byteLength,
        ) as ArrayBuffer,
      );
      rootForCommit = cidFromDigest(new Uint8Array(digest));
      await this.#store.put(rootForCommit, emptyBytes);
    }

    const changedCids = await diff(this.#store, prevRoot, rootForCommit);
    const carBlocks = await buildCarSlice(this.#store, changedCids);

    const rev = nextTid();
    const commitData: CommitData = {
      did: _did,
      version: 3,
      data: rootForCommit,
      rev,
      prev: prevCommit,
      sig: new Uint8Array(0),
    };

    const dataForSigning: Omit<CommitData, "sig"> = {
      did: commitData.did,
      version: commitData.version,
      data: commitData.data,
      rev: commitData.rev,
      prev: commitData.prev,
    };
    const bytesToSign = cborEncode(commitToObj(dataForSigning));
    const sig = await this.#signer.sign(bytesToSign);
    commitData.sig = sig;

    const commitBytes = encodeCommit(commitData);
    const commitCid = await cidForBytes(commitBytes);
    await this.#store.put(commitCid, commitBytes);

    await this.#store.setHead(_did, { commit: commitCid, rev });

    return {
      repo: _did,
      commit: commitCid,
      rev,
      since,
      blocks: carBlocks,
      ops,
    };
  }
}

async function buildCarSlice(store: Storage, cids: Cid[]): Promise<Bytes> {
  const parts: Bytes[] = [];

  const header = cborEncode({ roots: [], version: 1 });
  const headerLen = varintEncode(header.length);
  parts.push(headerLen, header);

  for (const cid of cids) {
    const block = await store.get(cid);
    if (!block) continue;
    const cidBytes = cidToRawBytes(cid);
    const blockLen = varintEncode(cidBytes.length + block.length);
    parts.push(blockLen, cidBytes, block);
  }

  const total = parts.reduce((acc, p) => acc + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function cidToRawBytes(cid: Cid): Bytes {
  if (!cid.startsWith("b")) throw new Error("CID must start with 'b'");
  const B32 = "abcdefghijklmnopqrstuvwxyz234567";
  const s = cid.slice(1);
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (let i = 0; i < s.length; i++) {
    const idx = B32.indexOf(s[i]);
    if (idx === -1) throw new Error(`Invalid base32 character: ${s[i]}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

function varintEncode(n: number): Bytes {
  const out: number[] = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n & 0x7f);
  return new Uint8Array(out);
}

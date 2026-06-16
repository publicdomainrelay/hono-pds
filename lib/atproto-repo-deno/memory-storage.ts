import type { Storage, Cid, Did, Tid, Bytes } from "@publicdomainrelay/atproto-repo-abc";

export class MemoryStorage implements Storage {
  private blocks = new Map<string, Uint8Array>();
  private heads = new Map<string, { commit: Cid; rev: Tid }>();

  async get(cid: Cid): Promise<Bytes | null> {
    return this.blocks.get(cid) ?? null;
  }

  async put(cid: Cid, bytes: Bytes): Promise<void> {
    this.blocks.set(cid, bytes);
  }

  async has(cid: Cid): Promise<boolean> {
    return this.blocks.has(cid);
  }

  async getHead(did: Did): Promise<{ commit: Cid; rev: Tid } | null> {
    return this.heads.get(did) ?? null;
  }

  async setHead(did: Did, head: { commit: Cid; rev: Tid }): Promise<void> {
    this.heads.set(did, head);
  }
}

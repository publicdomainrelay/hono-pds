import type { Storage, Cid, Did, Tid, Bytes } from "@publicdomainrelay/atproto-repo-abc";

export class DenoKvStorage implements Storage {
  private kv: Deno.Kv;

  private constructor(kv: Deno.Kv) {
    this.kv = kv;
  }

  static async create(path?: string): Promise<DenoKvStorage> {
    if (typeof Deno === "undefined" || typeof Deno.openKv !== "function") {
      throw new Error(
        "DenoKvStorage: Deno.openKv is not available in this environment",
      );
    }
    if (path) {
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";
      await Deno.mkdir(parent, { recursive: true });
    }
    const kv = await Deno.openKv(path);
    return new DenoKvStorage(kv);
  }

  async get(cid: Cid): Promise<Bytes | null> {
    const result = await this.kv.get<Bytes>(["blocks", cid]);
    return result.value ?? null;
  }

  async put(cid: Cid, bytes: Bytes): Promise<void> {
    await this.kv.set(["blocks", cid], bytes);
  }

  async has(cid: Cid): Promise<boolean> {
    const result = await this.kv.get<Bytes>(["blocks", cid]);
    return result.value !== null;
  }

  async getHead(did: Did): Promise<{ commit: Cid; rev: Tid } | null> {
    const result = await this.kv.get<{ commit: Cid; rev: Tid }>(["heads", did]);
    return result.value ?? null;
  }

  async setHead(did: Did, head: { commit: Cid; rev: Tid }): Promise<void> {
    await this.kv.set(["heads", did], head);
  }

  close(): void {
    this.kv.close();
  }
}

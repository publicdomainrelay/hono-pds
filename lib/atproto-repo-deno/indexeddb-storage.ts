import type { Storage, Cid, Did, Tid, Bytes } from "@publicdomainrelay/atproto-repo-abc";

const DB_NAME = "atproto-repo";
const DB_VERSION = 1;

interface IdbReq<T> {
  result: T;
  error: Error | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}

interface IdbTx {
  objectStore(name: string): {
    get(key: string): IdbReq<unknown>;
    put(value: unknown): IdbReq<unknown>;
  };
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  error: Error | null;
}

interface IdbDb {
  transaction(name: string, mode: string): IdbTx;
  objectStoreNames: { contains(n: string): boolean };
  createObjectStore(name: string, opts: { keyPath: string }): unknown;
}

declare function openIndexedDb(name: string, version: number): {
  result: IdbDb & { objectStoreNames: { contains(n: string): boolean }; createObjectStore(n: string, o: { keyPath: string }): unknown };
  onupgradeneeded: (() => void) | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
};

declare var indexedDB: {
  open(name: string, version: number): {
    result: IdbDb;
    error: Error | null;
    onupgradeneeded: (() => void) | null;
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
  };
};

export class IndexedDbStorage implements Storage {
  private db: IdbDb;

  private constructor(db: IdbDb) {
    this.db = db;
  }

  static async create(): Promise<IndexedDbStorage> {
    if (typeof indexedDB === "undefined") {
      throw new Error(
        "IndexedDbStorage: indexedDB is not available in this environment",
      );
    }
    const db = await new Promise<IdbDb>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("blocks")) {
          db.createObjectStore("blocks", { keyPath: "cid" });
        }
        if (!db.objectStoreNames.contains("heads")) {
          db.createObjectStore("heads", { keyPath: "did" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return new IndexedDbStorage(db);
  }

  async get(cid: Cid): Promise<Bytes | null> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("blocks", "readonly");
      const store = tx.objectStore("blocks");
      const req = store.get(cid);
      req.onsuccess = () =>
        resolve(
          (req.result as { cid: Cid; bytes: Bytes } | undefined)?.bytes ?? null,
        );
      req.onerror = () => reject(req.error);
    });
  }

  async put(cid: Cid, bytes: Bytes): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("blocks", "readwrite");
      const store = tx.objectStore("blocks");
      store.put({ cid, bytes });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async has(cid: Cid): Promise<boolean> {
    const bytes = await this.get(cid);
    return bytes !== null;
  }

  async getHead(did: Did): Promise<{ commit: Cid; rev: Tid } | null> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("heads", "readonly");
      const store = tx.objectStore("heads");
      const req = store.get(did);
      req.onsuccess = () =>
        resolve(
          (req.result as { did: Did; head: { commit: Cid; rev: Tid } } | undefined)
            ?.head ?? null,
        );
      req.onerror = () => reject(req.error);
    });
  }

  async setHead(did: Did, head: { commit: Cid; rev: Tid }): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("heads", "readwrite");
      const store = tx.objectStore("heads");
      store.put({ did, head });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

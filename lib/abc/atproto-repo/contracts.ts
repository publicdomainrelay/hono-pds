import type { Bytes, Cid, Tid } from "@publicdomainrelay/common";

export type { Bytes, Cid, Tid } from "@publicdomainrelay/common";

export type Did = string;

export interface Signer {
  did(): Did;
  sign(bytes: Bytes): Promise<Bytes>;
}

export interface Verifier {
  verify(did: Did, bytes: Bytes, sig: Bytes): Promise<boolean>;
}

export interface BlockStore {
  get(cid: Cid): Promise<Bytes | null>;
  put(cid: Cid, bytes: Bytes): Promise<void>;
  has(cid: Cid): Promise<boolean>;
}

export interface RepoStore {
  getHead(did: Did): Promise<{ commit: Cid; rev: Tid } | null>;
  setHead(did: Did, head: { commit: Cid; rev: Tid }): Promise<void>;
}

export interface Storage extends BlockStore, RepoStore {}

export interface CommitOp {
  action: "create" | "update" | "delete";
  path: string;
  cid: Cid | null;
}

export interface CommitEvent {
  repo: Did;
  commit: Cid;
  rev: Tid;
  since: Tid | null;
  blocks: Bytes;
  ops: CommitOp[];
}

export type SequencedFrame = Record<string, unknown>;

export interface Sequencer {
  append(evt: CommitEvent): SequencedFrame;
  backfill(since?: number): AsyncIterable<SequencedFrame>;
  live(): AsyncIterable<SequencedFrame>;
}

export interface WriteOp {
  action: "create" | "update" | "delete";
  collection: string;
  rkey: string;
  record?: unknown;
}

export interface RepoApi {
  describe(did: Did): Promise<{ collections: string[]; head: Tid | null }>;
  getRecord(
    did: Did,
    collection: string,
    rkey: string,
  ): Promise<{ uri: string; cid: Cid; value: unknown } | null>;
  listRecords(
    did: Did,
    collection: string,
    opts?: { limit?: number; cursor?: string },
  ): Promise<{ records: { uri: string; cid: Cid; value: unknown }[]; cursor?: string }>;
  applyWrites(did: Did, writes: WriteOp[]): Promise<CommitEvent>;
}

export const XrpcErrorNames = {
  InvalidRequest: "InvalidRequest",
  AuthenticationRequired: "AuthenticationRequired",
  RecordNotFound: "RecordNotFound",
  RepoNotFound: "RepoNotFound",
  InvalidSwap: "InvalidSwap",
} as const;

export type XrpcErrorName = (typeof XrpcErrorNames)[keyof typeof XrpcErrorNames];

export class XrpcError extends Error {
  readonly error: XrpcErrorName;
  readonly status: number;

  constructor(error: XrpcErrorName, message: string, status?: number) {
    super(message);
    this.error = error;
    this.status = status ?? (error === "AuthenticationRequired" ? 401 : 400);
    this.name = "XrpcError";
  }

  toJSON(): { error: string; message: string } {
    return { error: this.error, message: this.message };
  }
}

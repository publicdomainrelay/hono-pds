import type { Bytes, Cid, Tid } from "@publicdomainrelay/atproto-repo-common";

export type { Bytes, Cid, Tid } from "@publicdomainrelay/atproto-repo-common";

export type Did = string;

export interface Signer {
  did(): Did;
  sign(bytes: Bytes): Promise<Bytes>;
}

export interface Verifier {
  verify(did: Did, bytes: Bytes, sig: Bytes): Promise<boolean>;
}

export type Hasher = (data: Bytes) => Promise<Bytes>;

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
  prev: Cid | null;
}

export interface CommitEvent {
  repo: Did;
  commit: Cid;
  rev: Tid;
  since: Tid | null;
  blocks: Bytes;
  ops: CommitOp[];
  prevData: Cid | null;
}

export type SequencedFrame = Record<string, unknown>;

export interface Sequencer {
  append(evt: CommitEvent): SequencedFrame;
  appendIdentity(did: Did, handle?: string): SequencedFrame;
  appendAccount(did: Did, active: boolean, status?: string): SequencedFrame;
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

/**
 * Per the XRPC spec's status code table: 400 for a request that was invalid and
 * not processed, 401 when authentication is required, 404 for a missing
 * resource. The error name carries the specific meaning; the status only has to
 * put it in the right class.
 * https://atproto.com/specs/xrpc#summary-of-http-status-codes
 */
const XRPC_ERROR_STATUS: Record<XrpcErrorName, number> = {
  InvalidRequest: 400,
  AuthenticationRequired: 401,
  RecordNotFound: 404,
  RepoNotFound: 404,
  InvalidSwap: 400,
};

export class XrpcError extends Error {
  readonly error: XrpcErrorName;
  readonly status: number;

  constructor(error: XrpcErrorName, message: string, status?: number) {
    super(message);
    this.error = error;
    this.status = status ?? XRPC_ERROR_STATUS[error] ?? 400;
    this.name = "XrpcError";
  }

  toJSON(): { error: string; message: string } {
    return { error: this.error, message: this.message };
  }
}

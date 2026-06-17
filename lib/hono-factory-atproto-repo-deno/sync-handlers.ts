import type { Hono } from "@hono/hono";
import type { RepoApi, Storage, Did } from "@publicdomainrelay/atproto-repo-abc";
import { XrpcError } from "@publicdomainrelay/atproto-repo-abc";
import { exportCar } from "@publicdomainrelay/atproto-repo-deno";
import { decode as cborDecode } from "@publicdomainrelay/atproto-repo-common";

export interface SyncHandlerOptions {
  repo: RepoApi;
  storage: Storage;
}

export function mountSyncRoutes(app: Hono, opts: SyncHandlerOptions): void {
  app.get("/xrpc/com.atproto.sync.getRepo", async (c) => {
    const did = c.req.query("did");
    if (!did) throw new XrpcError("InvalidRequest", "did is required");

    const head = await opts.storage.getHead(did);
    if (!head) throw new XrpcError("RepoNotFound", `no repo for ${did}`);

    const commitBytes = await opts.storage.get(head.commit);
    if (!commitBytes) throw new XrpcError("RepoNotFound", "commit not found");
    const commit = cborDecode(commitBytes) as Record<string, unknown>;
    const rootCid = (commit.data as { $link: string })?.$link;
    if (!rootCid) throw new XrpcError("RepoNotFound", "MST root not found in commit");

    const carBytes = await exportCar(opts.storage, rootCid);
    return new Response(carBytes as unknown as BodyInit, {
      status: 200,
      headers: { "content-type": "application/vnd.ipld.car" },
    });
  });

  app.get("/xrpc/com.atproto.sync.getLatestCommit", async (c) => {
    const did = c.req.query("did");
    if (!did) throw new XrpcError("InvalidRequest", "did is required");

    const desc = await opts.repo.describe(did);
    return c.json({ cid: desc.head ?? null, rev: desc.head ?? null });
  });

  app.get("/xrpc/com.atproto.sync.getRecord", async (c) => {
    const did = c.req.query("did");
    const collection = c.req.query("collection");
    const rkey = c.req.query("rkey");
    if (!did || !collection || !rkey) {
      throw new XrpcError("InvalidRequest", "did, collection, and rkey are required");
    }
    const record = await opts.repo.getRecord(did, collection, rkey);
    if (!record) {
      throw new XrpcError("RecordNotFound", `${collection}/${rkey}`);
    }
    return c.json(record);
  });
}

import type { Context, Hono } from "@hono/hono";
import type { RepoApi, Did } from "@publicdomainrelay/atproto-repo-abc";
import { XrpcError } from "@publicdomainrelay/atproto-repo-abc";
import { nextTid } from "@publicdomainrelay/common";

function jsonError(err: unknown): Response {
  if (err instanceof XrpcError) {
    return new Response(JSON.stringify(err.toJSON()), {
      status: err.status,
      headers: { "content-type": "application/json" },
    });
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new Response(JSON.stringify({ error: "InvalidRequest", message: msg }), {
    status: 500,
    headers: { "content-type": "application/json" },
  });
}

function requesterDid(c: Context): Did {
  return c.get("requesterDid" as never) as Did;
}

export function mountRepoRoutes(app: Hono, repo: RepoApi): void {
  app.post("/xrpc/com.atproto.repo.createRecord", async (c) => {
    try {
      const did = requesterDid(c);
      const body = (await c.req.json()) as {
        collection: string;
        rkey?: string;
        record: unknown;
      };
      if (!body.collection || !body.record) {
        throw new XrpcError("InvalidRequest", "collection and record are required");
      }
      const rkey = body.rkey ?? nextTid();
      const writes = [{
        action: "create" as const,
        collection: body.collection,
        rkey,
        record: body.record,
      }];
      const evt = await repo.applyWrites(did, writes);
      const uri = `at://${did}/${body.collection}/${rkey}`;
      return c.json({ uri, cid: evt.commit });
    } catch (err) {
      return jsonError(err);
    }
  });

  app.get("/xrpc/com.atproto.repo.getRecord", async (c) => {
    try {
      const did = c.req.query("repo") ?? requesterDid(c);
      const collection = c.req.query("collection");
      const rkey = c.req.query("rkey");
      if (!collection || !rkey) {
        throw new XrpcError("InvalidRequest", "collection and rkey are required");
      }
      const record = await repo.getRecord(did, collection, rkey);
      if (!record) {
        throw new XrpcError("RecordNotFound", `record not found: ${collection}/${rkey}`);
      }
      return c.json(record);
    } catch (err) {
      return jsonError(err);
    }
  });

  app.get("/xrpc/com.atproto.repo.listRecords", async (c) => {
    try {
      const did = c.req.query("repo") ?? requesterDid(c);
      const collection = c.req.query("collection");
      if (!collection) {
        throw new XrpcError("InvalidRequest", "collection is required");
      }
      const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : undefined;
      const cursor = c.req.query("cursor") ?? undefined;
      const result = await repo.listRecords(did, collection, { limit, cursor });
      return c.json(result);
    } catch (err) {
      return jsonError(err);
    }
  });

  app.get("/xrpc/com.atproto.repo.describeRepo", async (c) => {
    try {
      const did = c.req.query("repo") ?? requesterDid(c);
      const desc = await repo.describe(did);
      return c.json(desc);
    } catch (err) {
      return jsonError(err);
    }
  });
}

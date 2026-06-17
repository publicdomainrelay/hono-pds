import type { Context, Hono } from "@hono/hono";
import type { RepoApi, Did, WriteOp } from "@publicdomainrelay/atproto-repo-abc";
import { XrpcError } from "@publicdomainrelay/atproto-repo-abc";
import { nextTid } from "@publicdomainrelay/atproto-repo-common";

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

function defaultType(record: unknown, collection: string): unknown {
  if (
    typeof record === "object" &&
    record !== null &&
    !("$type" in record)
  ) {
    return { $type: collection, ...(record as Record<string, unknown>) };
  }
  return record;
}

export function mountRepoRoutes(app: Hono, repo: RepoApi): void {
  app.post("/xrpc/com.atproto.repo.createRecord", async (c) => {
    try {
      const did = requesterDid(c);
      const body = (await c.req.json()) as {
        repo?: string;
        collection: string;
        rkey?: string;
        record: unknown;
        validate?: boolean;
        swapCommit?: string;
      };
      if (!body.collection || !body.record) {
        throw new XrpcError("InvalidRequest", "collection and record are required");
      }
      const rkey = body.rkey ?? nextTid();
      const record = defaultType(body.record, body.collection);
      const evt = await repo.applyWrites(did, [{
        action: "create" as const,
        collection: body.collection,
        rkey,
        record,
      }]);
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
      return c.json({
        did,
        handle: did,
        ...desc,
      });
    } catch (err) {
      return jsonError(err);
    }
  });

  app.post("/xrpc/com.atproto.repo.deleteRecord", async (c) => {
    try {
      const did = requesterDid(c);
      const body = (await c.req.json()) as {
        repo?: string;
        collection: string;
        rkey: string;
        swapCommit?: string;
        swapRecord?: string;
      };
      if (!body.collection || !body.rkey) {
        throw new XrpcError("InvalidRequest", "collection and rkey are required");
      }
      const existing = await repo.getRecord(did, body.collection, body.rkey);
      if (!existing) {
        return c.json({});
      }
      await repo.applyWrites(did, [{
        action: "delete",
        collection: body.collection,
        rkey: body.rkey,
      }]);
      return c.json({});
    } catch (err) {
      return jsonError(err);
    }
  });

  app.post("/xrpc/com.atproto.repo.putRecord", async (c) => {
    try {
      const did = requesterDid(c);
      const body = (await c.req.json()) as {
        repo?: string;
        collection: string;
        rkey: string;
        record: unknown;
        swapRecord?: string | null;
        swapCommit?: string;
      };
      if (!body.collection || !body.rkey || !body.record) {
        throw new XrpcError(
          "InvalidRequest",
          "collection, rkey, and record are required",
        );
      }
      const record = defaultType(body.record, body.collection);
      const existing = await repo.getRecord(did, body.collection, body.rkey);
      const action = existing ? "update" as const : "create" as const;
      const evt = await repo.applyWrites(did, [{
        action,
        collection: body.collection,
        rkey: body.rkey,
        record,
      }]);
      const uri = `at://${did}/${body.collection}/${body.rkey}`;
      return c.json({ uri, cid: evt.commit });
    } catch (err) {
      return jsonError(err);
    }
  });

  app.post("/xrpc/com.atproto.repo.applyWrites", async (c) => {
    try {
      const did = requesterDid(c);
      const body = (await c.req.json()) as {
        repo?: string;
        writes: Array<{
          $type: string;
          collection: string;
          rkey?: string;
          value?: unknown;
          swapRecord?: string | null;
        }>;
        swapCommit?: string;
      };
      if (!body.writes || !Array.isArray(body.writes)) {
        throw new XrpcError("InvalidRequest", "writes array is required");
      }
      const writeOps: WriteOp[] = [];
      for (const w of body.writes) {
        if (w.$type === "com.atproto.repo.applyWrites#create") {
          const rkey = w.rkey ?? nextTid();
          const record = defaultType(w.value ?? {}, w.collection);
          writeOps.push({ action: "create", collection: w.collection, rkey, record });
        } else if (w.$type === "com.atproto.repo.applyWrites#update") {
          if (!w.rkey) throw new XrpcError("InvalidRequest", "rkey is required for update");
          const record = defaultType(w.value ?? {}, w.collection);
          writeOps.push({ action: "update", collection: w.collection, rkey: w.rkey, record });
        } else if (w.$type === "com.atproto.repo.applyWrites#delete") {
          if (!w.rkey) throw new XrpcError("InvalidRequest", "rkey is required for delete");
          writeOps.push({ action: "delete", collection: w.collection, rkey: w.rkey });
        }
      }
      const evt = await repo.applyWrites(did, writeOps);
      const results = writeOps.map((op, i) => {
        if (op.action === "delete") {
          return { $type: "com.atproto.repo.applyWrites#deleteResult" };
        }
        const uri = `at://${did}/${op.collection}/${op.rkey}`;
        const resultCid = evt.ops[i]?.cid ?? evt.commit;
        if (op.action === "create") {
          return {
            $type: "com.atproto.repo.applyWrites#createResult",
            uri,
            cid: resultCid,
            validationStatus: "valid",
          };
        }
        return {
          $type: "com.atproto.repo.applyWrites#updateResult",
          uri,
          cid: resultCid,
          validationStatus: "valid",
        };
      });
      return c.json({ commit: { cid: evt.commit, rev: evt.rev }, results });
    } catch (err) {
      return jsonError(err);
    }
  });
}

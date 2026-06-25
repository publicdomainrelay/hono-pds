import { Hono } from "@hono/hono";
import { cors } from "@hono/hono/cors";
import { upgradeWebSocket } from "@hono/hono/deno";
import { registerErrorMiddleware } from "@publicdomainrelay/hono-error-middleware";
import { createLogger, type LoggerInterface } from "@publicdomainrelay/logger";
import type { Storage, Signer, Did, Sequencer, RepoApi } from "@publicdomainrelay/atproto-repo-abc";
import { XrpcError } from "@publicdomainrelay/atproto-repo-abc";
import { Repo } from "@publicdomainrelay/atproto-repo-deno";
import { signServiceAuth } from "@publicdomainrelay/atproto-repo-deno";
import type { SubscribeHandler } from "@publicdomainrelay/atproto-repo-common";
import { mountRepoRoutes } from "./repo-handlers.ts";
import { mountSyncRoutes } from "./sync-handlers.ts";
import { FirehoseSequencer } from "./sequencer.ts";
import { createSubscribeHandler } from "./subscribe.ts";

export interface RepoFactoryOptions {
  storage: Storage;
  signer: Signer;
  did?: Did;
  sequencer?: Sequencer;
  baseOrigin?: string;
  didWebServices?: Array<{ id: string; type: string }>;
  publicHostname?: string;
  crawlers?: string[];
  log?: LoggerInterface;
}

export interface RepoFactory {
  app: Hono;
  subscribe: SubscribeHandler;
  api: RepoApi;
  sequencer: Sequencer;
}

export function createRepoFactory(opts: RepoFactoryOptions): RepoFactory {
  const repo = new Repo(opts.storage, opts.signer, opts.did);
  const did = opts.did ?? opts.signer.did();
  const sequencer = opts.sequencer ?? new FirehoseSequencer();
  const log = opts.log ?? createLogger("pds");

  const app = new Hono();

  app.use("*", cors());

  app.use("*", async (c, next) => {
    c.set("requesterDid" as never, did as never);
    await next();
  });

  registerErrorMiddleware(app, log);

  app.get("/xrpc/_health", (c) => {
    return c.json({ version: "0.0.0" });
  });

  app.get("/xrpc/com.atproto.server.describeServer", (c) => {
    return c.json({
      did,
      version: "0.0.0",
      availableUserDomains: [],
      inviteCodeRequired: false,
    });
  });

  app.get("/.well-known/atproto-did", (c) => {
    return c.text(did);
  });

  if (opts.didWebServices && opts.didWebServices.length > 0) {
    app.get("/.well-known/did.json", (c) => {
      const host = (c.req.header("host") ?? "").split(":")[0];
      if (!host) {
        throw new XrpcError("InvalidRequest", "missing Host header");
      }
      return c.json({
        "@context": ["https://www.w3.org/ns/did/v1"],
        id: `did:web:${host}`,
        service: opts.didWebServices!.map((s) => ({
          id: s.id.startsWith("#") ? s.id : `#${s.id}`,
          type: s.type,
          serviceEndpoint: `https://${host}`,
        })),
      });
    });
  }

  app.get("/xrpc/com.atproto.server.getServiceAuth", async (c) => {
    const aud = c.req.query("aud");
    if (!aud) {
      return new Response(
        JSON.stringify({ error: "InvalidRequest", message: 'missing required "aud" param' }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
    const lxm = c.req.query("lxm") ?? undefined;
    const expQ = c.req.query("exp");
    const token = await signServiceAuth(opts.signer, {
      aud,
      lxm,
      expiresInSec: expQ
        ? Math.max(0, parseInt(expQ) - Math.floor(Date.now() / 1000))
        : undefined,
    });
    return c.json({ token });
  });

  const requestCrawlDebounce = new Map<string, number>();

  const wiredRepo: RepoApi = {
    describe: (d) => repo.describe(d),
    getRecord: (d, c, r) => repo.getRecord(d, c, r),
    listRecords: (d, c, o) => repo.listRecords(d, c, o),
    async applyWrites(d, writes) {
      const evt = await repo.applyWrites(d, writes);
      sequencer.append(evt);
      if (opts.crawlers && opts.publicHostname) {
        const now = Date.now();
        for (const rawUrl of opts.crawlers) {
          const last = requestCrawlDebounce.get(rawUrl) ?? 0;
          if (now - last < 1000) continue;
          requestCrawlDebounce.set(rawUrl, now);
          const url = new URL("/xrpc/com.atproto.sync.requestCrawl", rawUrl);
          fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ hostname: opts.publicHostname }),
          }).catch(() => {});
        }
      }
      return evt;
    },
  };

  mountRepoRoutes(app, wiredRepo);
  mountSyncRoutes(app, { repo: wiredRepo, storage: opts.storage });

  const subscribe = createSubscribeHandler(sequencer);

  // subscribeRepos WebSocket endpoint — enables relay crawling of local PDS.
  const subscribeReposHandler = upgradeWebSocket((c) => {
    const cursorQ = c.req.query("cursor");
    const params: Record<string, string> = {};
    if (cursorQ) params.cursor = cursorQ;
    let unsubscribe: (() => void) | void = undefined;
    return {
      onOpen(_evt, ws) {
        unsubscribe = subscribe({ nsid: "com.atproto.sync.subscribeRepos", params }, (frame) => {
          try {
            ws.send(JSON.stringify(frame));
          } catch { /* ws closed */ }
        });
      },
      onClose() {
        if (unsubscribe) unsubscribe();
      },
      onError() {
        if (unsubscribe) unsubscribe();
      },
    };
  });
  app.get("/xrpc/com.atproto.sync.subscribeRepos", subscribeReposHandler);

  return {
    app,
    subscribe,
    api: wiredRepo,
    sequencer,
  };
}

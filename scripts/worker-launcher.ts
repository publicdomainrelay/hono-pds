// Worker — pure compute. Exposes app.fetch via message passing.
// Zero network. Zero Deno.serve. Just init → fetch requests.
/// <reference lib="deno.worker" />

import { createFromEnv } from "../bundle.js";

interface RequestMessage {
  id: number;
  method: string;
  url: string;
  headers: [string, string][];
  body: number[] | null;
}

let app: { fetch(req: Request): Response | Promise<Response> } | null = null;

async function init() {
  const repo = await createFromEnv();
  app = repo.app;
}

function reply(msg: Record<string, unknown>) {
  self.postMessage(msg);
}

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data as Record<string, unknown>;

  switch (msg.type) {
    case "init": {
      try {
        await init();
        reply({ type: "ready" });
      } catch (err) {
        reply({ type: "error", message: String(err) });
      }
      break;
    }

    case "request": {
      const req = msg as unknown as RequestMessage;
      if (!app) {
        reply({ type: "response", id: req.id, status: 500, headers: [], body: null });
        return;
      }
      try {
        const init: RequestInit = {
          method: req.method,
          headers: new Headers(req.headers),
        };
        if (req.body && req.body.length > 0) {
          init.body = new Uint8Array(req.body);
        }
        const res = await app.fetch(new Request(req.url, init));
        const resBody = res.body ? new Uint8Array(await res.arrayBuffer()) : null;
        reply({
          type: "response",
          id: req.id,
          status: res.status,
          headers: Array.from(res.headers.entries()) as [string, string][],
          body: resBody ? Array.from(resBody) : null,
        });
      } catch (err) {
        reply({ type: "response", id: req.id, status: 500, headers: [], body: null });
      }
      break;
    }

    case "shutdown": {
      reply({ type: "stopped" });
      self.close();
      break;
    }
  }
};

// PDS sandbox: runs bundle in a Worker with permission sandbox.
// Exposes a transparent fetch() proxy — caller doesn't know it's a Worker.
//
// Usage:
//   import { createPdsSandbox } from "./scripts/sandbox.ts";
//   const pds = await createPdsSandbox();
//   const res = await pds.fetch(new Request("at://did:key:.../xrpc/com.atproto.server.describeServer"));
//   await pds.shutdown();

export interface PdsSandbox {
  fetch: (req: Request) => Promise<Response>;
  shutdown: () => Promise<void>;
}

export async function createPdsSandbox(): Promise<PdsSandbox> {
  const workerUrl = new URL("./worker-launcher.ts", import.meta.url);

  const worker = new Worker(workerUrl, {
    type: "module",
    deno: {
      permissions: {
        // Zero network — Worker is pure compute
        env: ["PDS_PRIVATE_KEY_HEX", "PDS_DID_WEB_SERVICES"],
        read: [".kv"],
        write: [".kv"],
      },
    },
  });

  let nextId = 1;
  const pending = new Map<number, (res: Response) => void>();
  let initialized = false;

  const initPromise = new Promise<void>((resolve, reject) => {
    worker.onmessage = (ev: MessageEvent) => {
      const m = ev.data as Record<string, unknown>;

      if (m.type === "ready") {
        initialized = true;
        resolve();
        return;
      }

      if (m.type === "response") {
        const id = m.id as number;
        const resolveReq = pending.get(id);
        pending.delete(id);
        if (resolveReq) {
          const headers = new Headers(m.headers as [string, string][]);
          const body = m.body != null ? new Uint8Array(m.body as number[]) : null;
          resolveReq(new Response(body, { status: m.status as number, headers }));
        }
        return;
      }
    };

    worker.onerror = (err) => {
      reject(new Error(`worker error: ${err.message}`));
    };
  });

  worker.postMessage({ type: "init" });
  await initPromise;

  async function fetch(req: Request): Promise<Response> {
    const id = nextId++;
    const body = req.body ? Array.from(new Uint8Array(await req.arrayBuffer())) : null;

    worker.postMessage({
      type: "request",
      id,
      method: req.method,
      url: req.url,
      headers: Array.from(req.headers.entries()) as [string, string][],
      body,
    });

    return new Promise((resolve) => {
      pending.set(id, resolve);
    });
  }

  async function shutdown() {
    worker.postMessage({ type: "shutdown" });
    await new Promise((resolve) => setTimeout(resolve, 200));
    worker.terminate();
  }

  return { fetch, shutdown };
}

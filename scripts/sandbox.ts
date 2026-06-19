import { createPersistentDenoWorker } from "@publicdomainrelay/sandbox-deno";
import type { SandboxPermissions } from "@publicdomainrelay/sandbox-abc";

export interface PdsSandbox {
  fetch: (req: Request) => Promise<Response>;
  shutdown: () => Promise<void>;
}

export async function createPdsSandbox(): Promise<PdsSandbox> {
  const workerUrl = new URL("./worker-launcher.ts", import.meta.url);

  const permissions: SandboxPermissions = {
    env: ["PDS_PRIVATE_KEY_HEX", "PDS_DID_WEB_SERVICES", "MIN_LOG_LEVEL"],
    read: [".kv"],
    write: [".kv"],
  };

  const pw = createPersistentDenoWorker(workerUrl, permissions);

  let nextId = 1;
  const pending = new Map<number, (res: Response) => void>();

  const initPromise = new Promise<void>((resolve, reject) => {
    pw.onMessage((msg: unknown) => {
      const m = msg as Record<string, unknown>;

      if (m.type === "ready") {
        resolve();
        return;
      }

      if (m.type === "error") {
        reject(new Error(m.message as string));
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
    });
  });

  pw.postMessage({ type: "init" });
  await initPromise;

  async function fetch(req: Request): Promise<Response> {
    const id = nextId++;
    const body = req.body ? Array.from(new Uint8Array(await req.arrayBuffer())) : null;

    pw.postMessage({
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
    pw.postMessage({ type: "shutdown" });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await pw.shutdown();
  }

  return { fetch, shutdown };
}

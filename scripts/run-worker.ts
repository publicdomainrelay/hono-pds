// Run PDS in a Worker sandbox. Optionally expose via HTTP.
//
// Usage:
//   deno run -A --unstable-kv --unstable-worker-options scripts/run-worker.ts
//   deno run -A --unstable-kv --unstable-worker-options scripts/run-worker.ts 2583  # serve HTTP too

import { createPdsSandbox } from "./sandbox.ts";

const port = Deno.args[0] ? parseInt(Deno.args[0]) : 0;

const pds = await createPdsSandbox();
console.log("PDS sandbox ready");

if (port > 0) {
  // Thin HTTP wrapper — main thread owns transport, Worker owns compute
  Deno.serve({ port, hostname: "127.0.0.1" }, (req) => pds.fetch(req));
  console.log(`HTTP on http://127.0.0.1:${port}/`);
} else {
  console.log("Interactive mode. Call pds.fetch(new Request(...))");
  // Keep alive for programmatic use
  (globalThis as Record<string, unknown>).pds = pds;
  await new Promise(() => {}); // wait forever
}

function shutdown() {
  console.log("\nShutting down...");
  pds.shutdown().then(() => Deno.exit(0));
}

Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);

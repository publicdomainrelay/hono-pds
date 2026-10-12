import { assert } from "@std/assert";

const REPO_ROOT = new URL("..", import.meta.url).pathname;

async function waitFor(path: string, ms: number, exited: () => boolean): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && !exited()) {
    try {
      await Deno.stat(path);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return false;
}

Deno.test("hono-pds keeps its Deno KV at --kv-path, so two PDSes never share one store", async () => {
  const dir = await Deno.makeTempDir({ prefix: "pds-kv-path-" });
  const kvPath = `${dir}/state/pds.sqlite3`;
  const portFile = `${dir}/port-bound-to`;
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "--node-modules-dir=none", "--unstable-kv", "main.ts", "--port", "0", "--hostname", "127.0.0.1", "--kv-path", kvPath, "--port-file", portFile],
    cwd: REPO_ROOT,
    stdout: "null",
    stderr: "null",
    stdin: "null",
  }).spawn();
  let exited = false;
  child.status.then(() => exited = true);
  try {
    assert(await waitFor(portFile, 60_000, () => exited), "the PDS never wrote its port file");
    assert((await Deno.stat(kvPath)).isFile, `no Deno KV store at ${kvPath}`);
  } finally {
    child.kill("SIGKILL");
    await child.status;
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});

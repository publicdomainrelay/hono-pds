import { assertEquals, assertExists } from "@std/assert";
import { createRepoFactory } from "@publicdomainrelay/hono-factory-atproto-repo-deno";
import { MemoryStorage } from "@publicdomainrelay/atproto-repo-deno";
import type { Signer, Bytes, Did } from "@publicdomainrelay/atproto-repo-abc";

class MockSigner implements Signer {
  #did: Did;
  constructor(did: Did = "did:key:zIntegrationTest") { this.#did = did; }
  did(): Did { return this.#did; }
  async sign(bytes: Bytes): Promise<Bytes> {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
    return new Uint8Array(digest);
  }
}

function allocatePort(): number {
  const listener = Deno.listen({ port: 0 });
  const port = listener.addr.port;
  try { listener.close(); } catch { /* ok */ }
  return port;
}

Deno.test("[integration] GET /xrpc/_health over HTTP", async () => {
  const storage = new MemoryStorage();
  const signer = new MockSigner();
  const factory = createRepoFactory({ storage, signer });

  const controller = new AbortController();
  const port = allocatePort();
  const server = Deno.serve({ port, signal: controller.signal }, factory.app.fetch);

  try {
    const res = await fetch(`http://127.0.0.1:${port}/xrpc/_health`);
    assertEquals(res.status, 200);
    const data = await res.json();
    assertExists(data.version);
  } finally {
    controller.abort();
    await server.finished;
  }
});

Deno.test("[integration] POST /xrpc/com.atproto.repo.createRecord over HTTP", async () => {
  const storage = new MemoryStorage();
  const signer = new MockSigner();
  const factory = createRepoFactory({ storage, signer });

  const controller = new AbortController();
  const port = allocatePort();
  const server = Deno.serve({ port, signal: controller.signal }, factory.app.fetch);

  try {
    const res = await fetch(`http://127.0.0.1:${port}/xrpc/com.atproto.repo.createRecord`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repo: signer.did(),
        collection: "com.example.test",
        record: { hello: "world" },
      }),
    });
    assertEquals(res.status, 200);
    const data = await res.json() as { uri: string; cid: string };
    assertExists(data.uri);
    assertExists(data.cid);
  } finally {
    controller.abort();
    await server.finished;
  }
});

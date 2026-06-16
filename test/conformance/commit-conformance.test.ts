import { assertEquals, assertExists } from "@std/assert";
import { createRepoFactory } from "@publicdomainrelay/hono-factory-atproto-repo-deno";
import { MemoryStorage } from "@publicdomainrelay/atproto-repo-deno";
import { encode as cborEncode, decode as cborDecode, cidFromDigest, cidDigest } from "@publicdomainrelay/common";
import { createVerifier, signerFromKeypair } from "@publicdomainrelay/atproto-repo-deno";
import type { Signer, Bytes, Did } from "@publicdomainrelay/atproto-repo-abc";
import { Secp256k1Keypair } from "@atproto/crypto";

Deno.test("[conformance] commit CBOR structure matches version:3", async () => {
  const storage = new MemoryStorage();
  const kp = await Secp256k1Keypair.create();
  const signer = signerFromKeypair(kp);
  const factory = createRepoFactory({ storage, signer });
  const did = signer.did();

  const evt = await factory.api.applyWrites(did, [{
    action: "create", collection: "app.bsky.feed.post",
    rkey: "test1", record: { $type: "app.bsky.feed.post", text: "Hello", createdAt: new Date().toISOString() },
  }]);

  const commitBytes = await storage.get(evt.commit);
  assertExists(commitBytes);
  const commit = cborDecode(commitBytes) as Record<string, unknown>;

  assertEquals(commit.did, did);
  assertEquals(commit.version, 3);
  assertEquals(typeof (commit.data as { $link: string }).$link, "string");
  assertEquals(typeof commit.rev, "string");
  assertEquals(commit.rev.length, 13);
  assertEquals(commit.sig instanceof Uint8Array, true);
});

Deno.test("[conformance] commit CID is reproducible from stored bytes", async () => {
  const storage = new MemoryStorage();
  const kp = await Secp256k1Keypair.create();
  const signer = signerFromKeypair(kp);
  const factory = createRepoFactory({ storage, signer });
  const did = signer.did();

  const record = { $type: "app.bsky.feed.post", text: "Reproducible", createdAt: "2024-01-01T00:00:00.000Z" };
  const evt = await factory.api.applyWrites(did, [{
    action: "create", collection: "app.bsky.feed.post", rkey: "repr1", record,
  }]);

  const commitBytes = await storage.get(evt.commit);
  assertExists(commitBytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      commitBytes.buffer.slice(commitBytes.byteOffset, commitBytes.byteOffset + commitBytes.byteLength) as ArrayBuffer,
    ),
  );
  const { cidFromDigest } = await import("@publicdomainrelay/common");
  const recomputedCid = cidFromDigest(digest);
  assertEquals(recomputedCid, evt.commit);
});

Deno.test("[conformance] commit signature verifies with did:key", async () => {
  const storage = new MemoryStorage();
  const kp = await Secp256k1Keypair.create();
  const signer = signerFromKeypair(kp);
  const verifier = createVerifier();
  const factory = createRepoFactory({ storage, signer });
  const did = signer.did();

  const evt = await factory.api.applyWrites(did, [{
    action: "create", collection: "app.bsky.feed.post",
    rkey: "verify1", record: { $type: "app.bsky.feed.post", text: "Verify me", createdAt: new Date().toISOString() },
  }]);

  const commitBytes = await storage.get(evt.commit);
  assertExists(commitBytes);
  const commit = cborDecode(commitBytes) as Record<string, unknown>;
  const sig = commit.sig as Uint8Array;

  const dataForSigning: Record<string, unknown> = {
    did: commit.did,
    version: commit.version,
    data: commit.data,
    rev: commit.rev,
    prev: commit.prev ?? null,
  };
  const signingBytes = cborEncode(dataForSigning);
  const isValid = await verifier.verify(did, signingBytes, sig);
  assertEquals(isValid, true);
});

Deno.test("[conformance] commit has prev pointing to previous commit", async () => {
  const storage = new MemoryStorage();
  const kp = await Secp256k1Keypair.create();
  const signer = signerFromKeypair(kp);
  const factory = createRepoFactory({ storage, signer });
  const did = signer.did();

  const evt1 = await factory.api.applyWrites(did, [{
    action: "create", collection: "app.bsky.feed.post",
    rkey: "first", record: { $type: "app.bsky.feed.post", text: "First", createdAt: new Date().toISOString() },
  }]);

  const commit1Bytes = await storage.get(evt1.commit);
  const commit1 = cborDecode(commit1Bytes!) as Record<string, unknown>;
  assertEquals(commit1.prev, null);

  const evt2 = await factory.api.applyWrites(did, [{
    action: "create", collection: "app.bsky.feed.post",
    rkey: "second", record: { $type: "app.bsky.feed.post", text: "Second", createdAt: new Date().toISOString() },
  }]);

  const commit2Bytes = await storage.get(evt2.commit);
  const commit2 = cborDecode(commit2Bytes!) as Record<string, unknown>;
  assertEquals(typeof (commit2.prev as { $link: string }).$link, "string");
  assertEquals((commit2.prev as { $link: string }).$link, evt1.commit);
});

Deno.test("[conformance] commit CID is dag-cbor sha256 CIDv1", async () => {
  const storage = new MemoryStorage();
  const kp = await Secp256k1Keypair.create();
  const signer = signerFromKeypair(kp);
  const factory = createRepoFactory({ storage, signer });
  const did = signer.did();

  const evt = await factory.api.applyWrites(did, [{
    action: "create", collection: "app.bsky.feed.post",
    rkey: "cidtest", record: { $type: "app.bsky.feed.post", text: "CID test", createdAt: new Date().toISOString() },
  }]);

  assertEquals(evt.commit.startsWith("b"), true);
  const digest = cidDigest(evt.commit);
  assertEquals(digest.length, 32);

  const commitBytes = await storage.get(evt.commit);
  assertExists(commitBytes);
  const computedDigest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      commitBytes.buffer.slice(commitBytes.byteOffset, commitBytes.byteOffset + commitBytes.byteLength) as ArrayBuffer,
    ),
  );
  assertEquals(digest, computedDigest);
});

Deno.test("[conformance] empty repo commits have null prev and since", async () => {
  const storage = new MemoryStorage();
  const kp = await Secp256k1Keypair.create();
  const signer = signerFromKeypair(kp);
  const factory = createRepoFactory({ storage, signer });
  const did = signer.did();

  const evt = await factory.api.applyWrites(did, [{
    action: "create", collection: "app.bsky.feed.post",
    rkey: "first", record: { $type: "app.bsky.feed.post", text: "First", createdAt: new Date().toISOString() },
  }]);

  assertEquals(evt.since, null);

  const commitBytes = await storage.get(evt.commit);
  const commit = cborDecode(commitBytes!) as Record<string, unknown>;
  assertEquals(commit.prev, null);
});

Deno.test("[conformance] rev is TID format (13 chars, base32-sortable)", async () => {
  const storage = new MemoryStorage();
  const kp = await Secp256k1Keypair.create();
  const signer = signerFromKeypair(kp);
  const factory = createRepoFactory({ storage, signer });
  const did = signer.did();

  const evt = await factory.api.applyWrites(did, [{
    action: "create", collection: "app.bsky.feed.post",
    rkey: "tidtest", record: { $type: "app.bsky.feed.post", text: "TID test", createdAt: new Date().toISOString() },
  }]);

  assertEquals(evt.rev.length, 13);
  assertEquals(/^[234567abcdefghijklmnopqrstuvwxyz]{13}$/.test(evt.rev), true);
});

Deno.test("[conformance] rev is strictly increasing", async () => {
  const storage = new MemoryStorage();
  const kp = await Secp256k1Keypair.create();
  const signer = signerFromKeypair(kp);
  const factory = createRepoFactory({ storage, signer });
  const did = signer.did();

  const evt1 = await factory.api.applyWrites(did, [{
    action: "create", collection: "app.bsky.feed.post",
    rkey: "inc1", record: { $type: "app.bsky.feed.post", text: "1", createdAt: new Date().toISOString() },
  }]);
  const evt2 = await factory.api.applyWrites(did, [{
    action: "create", collection: "app.bsky.feed.post",
    rkey: "inc2", record: { $type: "app.bsky.feed.post", text: "2", createdAt: new Date().toISOString() },
  }]);

  assertEquals(evt1.rev < evt2.rev, true);
  assertEquals(evt2.since, evt1.rev);
});

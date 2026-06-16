import { assertEquals, assertExists } from "@std/assert";
import { createRepoFactory } from "@publicdomainrelay/hono-factory-atproto-repo-deno";
import { MemoryStorage } from "@publicdomainrelay/atproto-repo-deno";
import { signerFromKeypair } from "@publicdomainrelay/atproto-repo-deno";
import type { SequencedFrame, Did } from "@publicdomainrelay/atproto-repo-abc";
import { Secp256k1Keypair } from "@atproto/crypto";

Deno.test("[conformance] firehose frame has required #commit fields", async () => {
  const storage = new MemoryStorage();
  const kp = await Secp256k1Keypair.create();
  const signer = signerFromKeypair(kp);
  const factory = createRepoFactory({ storage, signer });
  const did = signer.did();

  let frame: SequencedFrame | null = null;
  factory.subscribe(
    { params: {} },
    (f: SequencedFrame) => { frame = f; },
  );

  await factory.api.applyWrites(did, [{
    action: "create", collection: "app.bsky.feed.post",
    rkey: "frame1", record: { $type: "app.bsky.feed.post", text: "Frame test", createdAt: new Date().toISOString() },
  }]);

  for (let i = 0; i < 20 && frame === null; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  assertExists(frame);

  assertEquals(frame.$type, "com.atproto.sync.subscribeRepos#commit");
  assertEquals(typeof frame.seq, "number");
  assertEquals(frame.seq, 1);
  assertEquals(frame.repo, did);
  assertEquals(typeof frame.commit, "object");
  assertEquals(typeof frame.rev, "string");
  assertEquals(Array.isArray(frame.ops), true);
  assertEquals(typeof frame.time, "string");
});

Deno.test("[conformance] firehose frame ops match write actions", async () => {
  const storage = new MemoryStorage();
  const kp = await Secp256k1Keypair.create();
  const signer = signerFromKeypair(kp);
  const factory = createRepoFactory({ storage, signer });
  const did = signer.did();

  let frame: SequencedFrame | null = null;
  factory.subscribe(
    { params: {} },
    (f: SequencedFrame) => { frame = f; },
  );

  await factory.api.applyWrites(did, [
    { action: "create", collection: "app.bsky.feed.post", rkey: "op1", record: { $type: "app.bsky.feed.post", text: "Op1", createdAt: new Date().toISOString() } },
    { action: "create", collection: "app.bsky.feed.post", rkey: "op2", record: { $type: "app.bsky.feed.post", text: "Op2", createdAt: new Date().toISOString() } },
  ]);

  for (let i = 0; i < 20 && frame === null; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  assertExists(frame);

  assertEquals(frame.ops.length, 2);
  assertEquals(frame.ops[0].action, "create");
  assertEquals(frame.ops[0].path, "app.bsky.feed.post/op1");
  assertEquals(frame.ops[1].action, "create");
  assertEquals(frame.ops[1].path, "app.bsky.feed.post/op2");
});

Deno.test("[conformance] firehose seq numbers are monotonic", async () => {
  const storage = new MemoryStorage();
  const kp = await Secp256k1Keypair.create();
  const signer = signerFromKeypair(kp);
  const factory = createRepoFactory({ storage, signer });
  const did = signer.did();

  const frames: SequencedFrame[] = [];
  factory.subscribe(
    { params: {} },
    (f: SequencedFrame) => { frames.push(f); },
  );

  await factory.api.applyWrites(did, [{
    action: "create", collection: "app.bsky.feed.post",
    rkey: "seq1", record: { $type: "app.bsky.feed.post", text: "Seq1", createdAt: new Date().toISOString() },
  }]);
  await factory.api.applyWrites(did, [{
    action: "create", collection: "app.bsky.feed.post",
    rkey: "seq2", record: { $type: "app.bsky.feed.post", text: "Seq2", createdAt: new Date().toISOString() },
  }]);
  await factory.api.applyWrites(did, [{
    action: "create", collection: "app.bsky.feed.post",
    rkey: "seq3", record: { $type: "app.bsky.feed.post", text: "Seq3", createdAt: new Date().toISOString() },
  }]);

  for (let i = 0; i < 20 && frames.length < 3; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  assertEquals(frames.length, 3);
  assertEquals((frames[0].seq as number) < (frames[1].seq as number), true);
  assertEquals((frames[1].seq as number) < (frames[2].seq as number), true);
  assertEquals(frames[0].seq, 1);
  assertEquals(frames[1].seq, 2);
  assertEquals(frames[2].seq, 3);
});

Deno.test("[conformance] firehose backfill replays events from cursor", async () => {
  const storage = new MemoryStorage();
  const kp = await Secp256k1Keypair.create();
  const signer = signerFromKeypair(kp);
  const factory = createRepoFactory({ storage, signer });
  const did = signer.did();

  await factory.api.applyWrites(did, [{
    action: "create", collection: "app.bsky.feed.post",
    rkey: "bf1", record: { $type: "app.bsky.feed.post", text: "BF1", createdAt: new Date().toISOString() },
  }]);
  await factory.api.applyWrites(did, [{
    action: "create", collection: "app.bsky.feed.post",
    rkey: "bf2", record: { $type: "app.bsky.feed.post", text: "BF2", createdAt: new Date().toISOString() },
  }]);

  const backfilled: SequencedFrame[] = [];
  for await (const frame of factory.sequencer.backfill(0)) {
    backfilled.push(frame);
  }
  assertEquals(backfilled.length, 2);
  assertEquals(backfilled[0].seq, 1);
  assertEquals(backfilled[1].seq, 2);

  const fromCursor: SequencedFrame[] = [];
  for await (const frame of factory.sequencer.backfill(1)) {
    fromCursor.push(frame);
  }
  assertEquals(fromCursor.length, 1);
  assertEquals(fromCursor[0].seq, 2);
});

Deno.test("[conformance] firehose frame has since pointing to previous rev", async () => {
  const storage = new MemoryStorage();
  const kp = await Secp256k1Keypair.create();
  const signer = signerFromKeypair(kp);
  const factory = createRepoFactory({ storage, signer });
  const did = signer.did();

  const frames: SequencedFrame[] = [];
  factory.subscribe(
    { params: {} },
    (f: SequencedFrame) => { frames.push(f); },
  );

  const evt1 = await factory.api.applyWrites(did, [{
    action: "create", collection: "app.bsky.feed.post",
    rkey: "since1", record: { $type: "app.bsky.feed.post", text: "Since1", createdAt: new Date().toISOString() },
  }]);
  const evt2 = await factory.api.applyWrites(did, [{
    action: "create", collection: "app.bsky.feed.post",
    rkey: "since2", record: { $type: "app.bsky.feed.post", text: "Since2", createdAt: new Date().toISOString() },
  }]);

  for (let i = 0; i < 20 && frames.length < 2; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  assertEquals(frames.length, 2);
  assertEquals(frames[0].since, null);
  assertEquals(frames[1].since, evt1.rev);
  assertEquals(frames[1].since, evt2.since);
});

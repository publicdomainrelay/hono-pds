// XRPC conformance via createPdsSandbox — tests the Worker-sandboxed PDS
// through its fetch() interface (full HTTP boundary, not internal Hono routing).
// Validates that the sandbox conforms to AT Protocol XRPC semantics
// and behaves identically to the reference implementation.

import { assertEquals, assertExists } from "@std/assert";
import { createPdsSandbox } from "../../scripts/sandbox.ts";
import type { PdsSandbox } from "../../scripts/sandbox.ts";

function url(path: string, params?: Record<string, string>): string {
  const u = new URL(`http://localhost${path}`);
  if (params) for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

function headers(extra?: Record<string, string>): Record<string, string> {
  return { "content-type": "application/json", ...extra };
}

async function getDid(pds: PdsSandbox): Promise<string> {
  const res = await pds.fetch(new Request(url("/xrpc/com.atproto.server.describeServer")));
  const data = await res.json() as { did: string };
  return data.did;
}

// --- Read-only endpoints ---

Deno.test("[conformance:sandbox] health endpoint returns version", async () => {
  const pds = await createPdsSandbox();
  try {
    const res = await pds.fetch(new Request(url("/xrpc/_health")));
    assertEquals(res.status, 200);
    const data = await res.json() as { version?: string };
    assertEquals(typeof data.version, "string");
  } finally {
    await pds.shutdown();
  }
});

Deno.test("[conformance:sandbox] describeServer returns did, version, availableUserDomains, inviteCodeRequired", async () => {
  const pds = await createPdsSandbox();
  try {
    const res = await pds.fetch(new Request(url("/xrpc/com.atproto.server.describeServer")));
    assertEquals(res.status, 200);
    const data = await res.json() as {
      did: string; version: string; availableUserDomains: string[]; inviteCodeRequired: boolean;
    };
    assertEquals(typeof data.did, "string");
    assertEquals(data.did.startsWith("did:key:"), true);
    assertEquals(typeof data.version, "string");
    assertEquals(Array.isArray(data.availableUserDomains), true);
    assertEquals(typeof data.inviteCodeRequired, "boolean");
  } finally {
    await pds.shutdown();
  }
});

Deno.test("[conformance:sandbox] well-known atproto-did returns did", async () => {
  const pds = await createPdsSandbox();
  try {
    const res = await pds.fetch(new Request(url("/.well-known/atproto-did")));
    assertEquals(res.status, 200);
    const text = await res.text();
    assertEquals(text.startsWith("did:key:"), true);
  } finally {
    await pds.shutdown();
  }
});

Deno.test("[conformance:sandbox] describeServer and well-known-atproto-did return same did", async () => {
  const pds = await createPdsSandbox();
  try {
    const descRes = await pds.fetch(new Request(url("/xrpc/com.atproto.server.describeServer")));
    const descData = await descRes.json() as { did: string };
    const wkRes = await pds.fetch(new Request(url("/.well-known/atproto-did")));
    const wkDid = await wkRes.text();
    assertEquals(descData.did, wkDid);
  } finally {
    await pds.shutdown();
  }
});

Deno.test("[conformance:sandbox] getServiceAuth returns token for valid aud", async () => {
  const pds = await createPdsSandbox();
  try {
    const did = await getDid(pds);
    const res = await pds.fetch(new Request(url("/xrpc/com.atproto.server.getServiceAuth", {
      aud: "did:web:example.com",
      lxm: "com.atproto.repo.getRecord",
    })));
    assertEquals(res.status, 200);
    const data = await res.json() as { token: string };
    assertEquals(typeof data.token, "string");
    assertEquals(data.token.split(".").length, 3);
  } finally {
    await pds.shutdown();
  }
});

Deno.test("[conformance:sandbox] getServiceAuth returns 400 for missing aud", async () => {
  const pds = await createPdsSandbox();
  try {
    const res = await pds.fetch(new Request(url("/xrpc/com.atproto.server.getServiceAuth")));
    assertEquals(res.status, 400);
  } finally {
    await pds.shutdown();
  }
});

// --- Repo CRUD endpoints ---

Deno.test("[conformance:sandbox] createRecord returns uri and cid", async () => {
  const pds = await createPdsSandbox();
  try {
    const did = await getDid(pds);
    const res = await pds.fetch(new Request(url("/xrpc/com.atproto.repo.createRecord"), {
      method: "POST",
      body: JSON.stringify({ repo: did, collection: "app.bsky.feed.post", record: { text: "Hello", createdAt: new Date().toISOString() } }),
      headers: headers(),
    }));
    assertEquals(res.status, 200);
    const data = await res.json() as { uri: string; cid: string };
    assertEquals(typeof data.uri, "string");
    assertEquals(data.uri.startsWith(`at://${did}/`), true);
    assertEquals(typeof data.cid, "string");
    assertEquals(data.cid.startsWith("b"), true);
  } finally {
    await pds.shutdown();
  }
});

Deno.test("[conformance:sandbox] createRecord defaults $type to collection name", async () => {
  const pds = await createPdsSandbox();
  try {
    const did = await getDid(pds);
    const createRes = await pds.fetch(new Request(url("/xrpc/com.atproto.repo.createRecord"), {
      method: "POST",
      body: JSON.stringify({ repo: did, collection: "com.example.record", record: { foo: "bar" } }),
      headers: headers(),
    }));
    assertEquals(createRes.status, 200);
    const createData = await createRes.json() as { uri: string };
    const uriParts = createData.uri.split("/");
    const collection = uriParts[3];
    const rkey = uriParts[4];

    const getRes = await pds.fetch(new Request(
      url(`/xrpc/com.atproto.repo.getRecord`, { repo: did, collection, rkey }),
    ));
    assertEquals(getRes.status, 200);
    const record = await getRes.json() as { value: Record<string, unknown> };
    assertEquals(record.value.$type, "com.example.record");
  } finally {
    await pds.shutdown();
  }
});

Deno.test("[conformance:sandbox] createRecord getRecord round-trip preserves value", async () => {
  const pds = await createPdsSandbox();
  try {
    const did = await getDid(pds);
    const recordValue = {
      $type: "app.bsky.feed.post",
      text: "Hello, world!",
      createdAt: new Date().toISOString(),
    };
    const createRes = await pds.fetch(new Request(url("/xrpc/com.atproto.repo.createRecord"), {
      method: "POST",
      body: JSON.stringify({ repo: did, collection: "app.bsky.feed.post", record: recordValue }),
      headers: headers(),
    }));
    const createData = await createRes.json() as { uri: string; cid: string };
    const uriParts = createData.uri.split("/");
    const rkey = uriParts[4];

    const getRes = await pds.fetch(new Request(
      url(`/xrpc/com.atproto.repo.getRecord`, { repo: did, collection: "app.bsky.feed.post", rkey }),
    ));
    assertEquals(getRes.status, 200);
    const getData = await getRes.json() as { uri: string; cid: string; value: Record<string, unknown> };
    assertEquals(getData.uri, createData.uri);
    assertEquals(typeof getData.cid, "string");
    assertEquals(getData.value.text, "Hello, world!");
    assertEquals(getData.value.$type, "app.bsky.feed.post");
  } finally {
    await pds.shutdown();
  }
});

Deno.test("[conformance:sandbox] getRecord returns 400 for missing record", async () => {
  const pds = await createPdsSandbox();
  try {
    const did = await getDid(pds);
    const res = await pds.fetch(new Request(
      url(`/xrpc/com.atproto.repo.getRecord`, { repo: did, collection: "com.example.record", rkey: "nonexistent" }),
    ));
    assertEquals(res.status, 400);
    const data = await res.json() as { error: string };
    assertEquals(data.error, "RecordNotFound");
  } finally {
    await pds.shutdown();
  }
});

Deno.test("[conformance:sandbox] listRecords returns paginated results with cursor", async () => {
  const pds = await createPdsSandbox();
  try {
    const did = await getDid(pds);
    for (let i = 0; i < 5; i++) {
      const r = await pds.fetch(new Request(url("/xrpc/com.atproto.repo.createRecord"), {
        method: "POST",
        body: JSON.stringify({
          repo: did, collection: "app.bsky.feed.post",
          record: { $type: "app.bsky.feed.post", text: `Post ${i}`, createdAt: new Date().toISOString() },
        }),
        headers: headers(),
      }));
      assertEquals(r.status, 200);
    }

    const res = await pds.fetch(new Request(
      url(`/xrpc/com.atproto.repo.listRecords`, { repo: did, collection: "app.bsky.feed.post", limit: "2" }),
    ));
    assertEquals(res.status, 200);
    const data = await res.json() as { records: unknown[]; cursor?: string };
    assertEquals(data.records.length, 2);
    assertExists(data.cursor);

    const res2 = await pds.fetch(new Request(
      url(`/xrpc/com.atproto.repo.listRecords`, { repo: did, collection: "app.bsky.feed.post", limit: "5", cursor: data.cursor! }),
    ));
    assertEquals(res2.status, 200);
    const data2 = await res2.json() as { records: unknown[]; cursor?: string };
    assertEquals(data2.records.length, 3);
  } finally {
    await pds.shutdown();
  }
});

Deno.test("[conformance:sandbox] describeRepo returns did, handle, collections, head", async () => {
  const pds = await createPdsSandbox();
  try {
    const did = await getDid(pds);
    const r = await pds.fetch(new Request(url("/xrpc/com.atproto.repo.createRecord"), {
      method: "POST",
      body: JSON.stringify({
        repo: did, collection: "com.example.alpha",
        record: { $type: "com.example.alpha", v: 1 },
      }),
      headers: headers(),
    }));
    assertEquals(r.status, 200);

    const res = await pds.fetch(new Request(
      url(`/xrpc/com.atproto.repo.describeRepo`, { repo: did }),
    ));
    assertEquals(res.status, 200);
    const data = await res.json() as { did: string; handle: string; collections: string[]; head: string | null };
    assertEquals(data.did, did);
    assertExists(data.handle);
    assertEquals(data.collections.includes("com.example.alpha"), true);
    assertExists(data.head);
  } finally {
    await pds.shutdown();
  }
});

Deno.test("[conformance:sandbox] deleteRecord no-ops if record does not exist", async () => {
  const pds = await createPdsSandbox();
  try {
    const did = await getDid(pds);
    const res = await pds.fetch(new Request(url("/xrpc/com.atproto.repo.deleteRecord"), {
      method: "POST",
      body: JSON.stringify({ repo: did, collection: "com.example.record", rkey: "nonexistent" }),
      headers: headers(),
    }));
    assertEquals(res.status, 200);
  } finally {
    await pds.shutdown();
  }
});

Deno.test("[conformance:sandbox] deleteRecord removes existing record", async () => {
  const pds = await createPdsSandbox();
  try {
    const did = await getDid(pds);
    const createRes = await pds.fetch(new Request(url("/xrpc/com.atproto.repo.createRecord"), {
      method: "POST",
      body: JSON.stringify({
        repo: did, collection: "com.example.tmp",
        record: { $type: "com.example.tmp", text: "to-delete" },
      }),
      headers: headers(),
    }));
    const createData = await createRes.json() as { uri: string };
    const uriParts = createData.uri.split("/");
    const rkey = uriParts[4];

    const delRes = await pds.fetch(new Request(url("/xrpc/com.atproto.repo.deleteRecord"), {
      method: "POST",
      body: JSON.stringify({ repo: did, collection: "com.example.tmp", rkey }),
      headers: headers(),
    }));
    assertEquals(delRes.status, 200);

    const getRes = await pds.fetch(new Request(
      url(`/xrpc/com.atproto.repo.getRecord`, { repo: did, collection: "com.example.tmp", rkey }),
    ));
    assertEquals(getRes.status, 400);
  } finally {
    await pds.shutdown();
  }
});

Deno.test("[conformance:sandbox] putRecord creates if not exists, updates if exists", async () => {
  const pds = await createPdsSandbox();
  try {
    const did = await getDid(pds);

    const putRes1 = await pds.fetch(new Request(url("/xrpc/com.atproto.repo.putRecord"), {
      method: "POST",
      body: JSON.stringify({
        repo: did, collection: "app.bsky.actor.profile", rkey: "self",
        record: { displayName: "Alice" },
      }),
      headers: headers(),
    }));
    assertEquals(putRes1.status, 200);
    const putData1 = await putRes1.json() as { uri: string; cid: string };
    assertEquals(putData1.uri, `at://${did}/app.bsky.actor.profile/self`);

    const getRes1 = await pds.fetch(new Request(
      url(`/xrpc/com.atproto.repo.getRecord`, { repo: did, collection: "app.bsky.actor.profile", rkey: "self" }),
    ));
    const getData1 = await getRes1.json() as { value: Record<string, unknown> };
    assertEquals(getData1.value.displayName, "Alice");

    const putRes2 = await pds.fetch(new Request(url("/xrpc/com.atproto.repo.putRecord"), {
      method: "POST",
      body: JSON.stringify({
        repo: did, collection: "app.bsky.actor.profile", rkey: "self",
        record: { displayName: "Alice2", description: "Updated" },
      }),
      headers: headers(),
    }));
    assertEquals(putRes2.status, 200);

    const getRes2 = await pds.fetch(new Request(
      url(`/xrpc/com.atproto.repo.getRecord`, { repo: did, collection: "app.bsky.actor.profile", rkey: "self" }),
    ));
    const getData2 = await getRes2.json() as { value: Record<string, unknown> };
    assertEquals(getData2.value.displayName, "Alice2");
    assertEquals(getData2.value.description, "Updated");
  } finally {
    await pds.shutdown();
  }
});

Deno.test("[conformance:sandbox] applyWrites batch creates multiple records", async () => {
  const pds = await createPdsSandbox();
  try {
    const did = await getDid(pds);
    const res = await pds.fetch(new Request(url("/xrpc/com.atproto.repo.applyWrites"), {
      method: "POST",
      body: JSON.stringify({
        repo: did,
        writes: [
          { $type: "com.atproto.repo.applyWrites#create", collection: "app.bsky.feed.post", value: { $type: "app.bsky.feed.post", text: "A", createdAt: new Date().toISOString() } },
          { $type: "com.atproto.repo.applyWrites#create", collection: "app.bsky.feed.post", value: { $type: "app.bsky.feed.post", text: "B", createdAt: new Date().toISOString() } },
        ],
      }),
      headers: headers(),
    }));
    assertEquals(res.status, 200);
    const data = await res.json() as { results: Array<{ $type: string; uri: string; cid: string }> };
    assertEquals(data.results.length, 2);
    assertEquals(data.results[0].$type, "com.atproto.repo.applyWrites#createResult");
    assertEquals(data.results[1].$type, "com.atproto.repo.applyWrites#createResult");
  } finally {
    await pds.shutdown();
  }
});

// --- Extended conformance ---

Deno.test("[conformance:sandbox] createRecord with swapCommit via describeRepo head", async () => {
  const pds = await createPdsSandbox();
  try {
    const did = await getDid(pds);

    const descRes = await pds.fetch(new Request(
      url(`/xrpc/com.atproto.repo.describeRepo`, { repo: did }),
    ));
    const descData = await descRes.json() as { head: string | null };
    // empty repo has null head
    assertEquals(descData.head, null);

    const res = await pds.fetch(new Request(url("/xrpc/com.atproto.repo.createRecord"), {
      method: "POST",
      body: JSON.stringify({
        repo: did, collection: "app.bsky.feed.post",
        record: { text: "Swap test", createdAt: new Date().toISOString() },
        swapCommit: descData.head,
      }),
      headers: headers(),
    }));
    assertEquals(res.status, 200);
  } finally {
    await pds.shutdown();
  }
});

Deno.test("[conformance:sandbox] unknown collection creates record without schema validation", async () => {
  const pds = await createPdsSandbox();
  try {
    const did = await getDid(pds);
    const res = await pds.fetch(new Request(url("/xrpc/com.atproto.repo.createRecord"), {
      method: "POST",
      body: JSON.stringify({
        repo: did,
        collection: "com.example.novel-nsid",
        record: { $type: "com.example.novel-nsid", arbitrary: true, nested: { data: [1, 2, 3] } },
      }),
      headers: headers(),
    }));
    assertEquals(res.status, 200);
    const data = await res.json() as { uri: string; cid: string };
    assertEquals(data.uri.startsWith("at://"), true);

    const uriParts = data.uri.split("/");
    const rkey = uriParts[4];
    const getRes = await pds.fetch(new Request(
      url(`/xrpc/com.atproto.repo.getRecord`, { repo: did, collection: "com.example.novel-nsid", rkey }),
    ));
    assertEquals(getRes.status, 200);
  } finally {
    await pds.shutdown();
  }
});

Deno.test("[conformance:sandbox] createRecord uses server DID regardless of repo field", async () => {
  const pds = await createPdsSandbox();
  try {
    const did = await getDid(pds);
    // The sandbox sets requesterDid from the server's configured DID, not from
    // the repo field. Records are always created under the server's own DID.
    const res = await pds.fetch(new Request(url("/xrpc/com.atproto.repo.createRecord"), {
      method: "POST",
      body: JSON.stringify({
        repo: "did:key:zNotMyDid",
        collection: "app.bsky.feed.post",
        record: { text: "Server DID used", createdAt: new Date().toISOString() },
      }),
      headers: headers(),
    }));
    assertEquals(res.status, 200);
    const data = await res.json() as { uri: string; cid: string };
    assertEquals(data.uri.startsWith(`at://${did}/`), true);
  } finally {
    await pds.shutdown();
  }
});

Deno.test("[conformance:sandbox] empty writes array returns empty results", async () => {
  const pds = await createPdsSandbox();
  try {
    const did = await getDid(pds);
    const res = await pds.fetch(new Request(url("/xrpc/com.atproto.repo.applyWrites"), {
      method: "POST",
      body: JSON.stringify({ repo: did, writes: [] }),
      headers: headers(),
    }));
    assertEquals(res.status, 200);
    const data = await res.json() as { results: unknown[] };
    assertEquals(data.results.length, 0);
  } finally {
    await pds.shutdown();
  }
});

Deno.test("[conformance:sandbox] cross-sandbox isolation — separate sandboxes have different DIDs", async () => {
  const pds1 = await createPdsSandbox();
  const pds2 = await createPdsSandbox();
  try {
    const d1 = await getDid(pds1);
    const d2 = await getDid(pds2);
    assertEquals(d1.startsWith("did:key:"), true);
    assertEquals(d2.startsWith("did:key:"), true);
    assertEquals(d1 !== d2, true);
  } finally {
    await pds1.shutdown();
    await pds2.shutdown();
  }
});

Deno.test("[conformance:sandbox] sandbox fetch preserves error status codes", async () => {
  const pds = await createPdsSandbox();
  try {
    // non-existent route
    const res = await pds.fetch(new Request(url("/xrpc/com.atproto.server.nonexistent")));
    assertEquals(res.status, 404);
  } finally {
    await pds.shutdown();
  }
});

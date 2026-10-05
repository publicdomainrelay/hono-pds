import { assertEquals, assertExists } from "@std/assert";
import { createRepoFactory } from "@publicdomainrelay/hono-factory-atproto-repo-deno";
import { MemoryStorage, signerFromKeypair } from "@publicdomainrelay/atproto-repo-deno";
import { Secp256k1Keypair } from "@atproto/crypto";

const ORIGIN = "http://127.0.0.1:2583";
const EVIL_HOST = "evil.example";
const LEGIT_HOST = "legit.example";

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

interface CountingServer {
  label: string;
  port: number;
  hits: number;
  paths: string[];
  stop(): void;
}

function startServer(
  label: string,
  routes: Record<string, () => unknown>,
): CountingServer {
  const state: CountingServer = {
    label,
    port: 0,
    hits: 0,
    paths: [],
    stop: () => {},
  };
  const server = Deno.serve(
    {
      hostname: "127.0.0.1",
      port: 0,
      onListen: (a) => {
        state.port = a.port;
      },
    },
    (req) => {
      state.hits++;
      const path = new URL(req.url).pathname;
      state.paths.push(`GET ${path}`);
      const route = routes[path];
      if (!route) return new Response("not found", { status: 404 });
      const value = route();
      if (value instanceof Response) return value;
      return new Response(JSON.stringify(value), {
        headers: { "content-type": "application/json" },
      });
    },
  );
  state.stop = () => {
    server.shutdown();
  };
  server.unref();
  return state;
}

async function makeDpopProof(method: string, url: string): Promise<string> {
  const kp = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const pub = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const u = new URL(url);
  const header = {
    typ: "dpop+jwt",
    alg: "ES256",
    jwk: { kty: "EC", crv: "P-256", x: pub.x, y: pub.y },
  };
  const payload = {
    htm: method.toUpperCase(),
    htu: `${u.origin}${u.pathname}`,
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
  };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    kp.privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}

interface ClientKeys {
  privateKey: CryptoKey;
  jwk: Record<string, unknown>;
}

async function makeClientKeys(kid: string): Promise<ClientKeys> {
  const kp = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const pub = await crypto.subtle.exportKey("jwk", kp.publicKey);
  return {
    privateKey: kp.privateKey,
    jwk: { kty: "EC", crv: "P-256", x: pub.x, y: pub.y, kid, use: "sig", alg: "ES256" },
  };
}

async function makeClientAssertion(
  clientId: string,
  audience: string,
  keys: ClientKeys,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { typ: "JWT", alg: "ES256", kid: keys.jwk.kid };
  const payload = {
    iss: clientId,
    sub: clientId,
    aud: audience,
    exp: now + 300,
    iat: now,
    jti: crypto.randomUUID(),
  };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keys.privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}

function clientDoc(clientId: string, extra: Record<string, unknown> = {}): unknown {
  return {
    client_id: clientId,
    redirect_uris: ["https://client.example/callback"],
    grant_types: ["authorization_code", "refresh_token"],
    scope: "atproto",
    dpop_bound_access_tokens: true,
    ...extra,
  };
}

const kp = await Secp256k1Keypair.create();
const signer = signerFromKeypair(kp);
const factory = createRepoFactory({
  storage: new MemoryStorage(),
  signer,
  oauthServer: { enabled: true, issuer: ORIGIN },
});

const internal = startServer("internal", {});
const attacker = startServer("attacker", {});
const evil = startServer(EVIL_HOST, {
  "/client-metadata.json": () =>
    clientDoc(`https://${EVIL_HOST}/client-metadata.json`, {
      jwks_uri: `http://127.0.0.1:${internal.port}/internal-jwks.json`,
    }),
  "/redirecting-metadata.json": () =>
    new Response(null, {
      status: 302,
      headers: { location: `http://127.0.0.1:${internal.port}/leaked.json` },
    }),
});
const legitKeys = await makeClientKeys("client-key-1");
const legit = startServer(LEGIT_HOST, {
  "/client-metadata.json": () =>
    clientDoc(`https://${LEGIT_HOST}/client-metadata.json`, {
      jwks_uri: `https://${LEGIT_HOST}/jwks.json`,
    }),
  "/jwks.json": () => ({ keys: [legitKeys.jwk] }),
  "/c2-metadata.json": () =>
    clientDoc(`https://${LEGIT_HOST}/c2-metadata.json`, {
      jwks_uri: `https://${LEGIT_HOST}/c2-jwks.json`,
    }),
  "/c2-jwks.json": () => ({ keys: [legitKeys.jwk] }),
});

const ATTACKER_ID = `http://127.0.0.1:${attacker.port}/client-metadata.json`;
const EVIL_ID = `https://${EVIL_HOST}/client-metadata.json`;
const REDIRECT_ID = `https://${EVIL_HOST}/redirecting-metadata.json`;
const LEGIT_ID = `https://${LEGIT_HOST}/client-metadata.json`;
const LEGIT2_ID = `https://${LEGIT_HOST}/c2-metadata.json`;

const realFetch = globalThis.fetch;
const attempted: string[] = [];

globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string"
    ? input
    : input instanceof URL
    ? input.href
    : input.url;
  attempted.push(url);
  if (url.startsWith("http://localhost/")) {
    // The spec's development exception is http://localhost with NO port, so :80 cannot be
    // rebound here without privilege. Record the attempt and refuse it, so this case measures
    // "did the guard admit it to fetch()", not a served response.
    return Promise.reject(new TypeError("connection refused"));
  }
  const rewritten = url
    .replace(`https://${EVIL_HOST}`, `http://127.0.0.1:${evil.port}`)
    .replace(`https://${LEGIT_HOST}`, `http://127.0.0.1:${legit.port}`);
  return realFetch(rewritten, init);
}) as typeof fetch;

function reset(): void {
  for (const s of [internal, attacker, evil, legit]) {
    s.hits = 0;
    s.paths = [];
  }
  attempted.length = 0;
}

function report(label: string, servers: CountingServer[]): void {
  console.log(`  ${label} attempted URLs: ${JSON.stringify(attempted)}`);
  console.log(
    `  ${label} servers reached: ${
      servers.map((s) => `${s.label}=${s.hits}`).join(" ")
    }`,
  );
  for (const s of servers) {
    console.log(
      `    ${s.label} (127.0.0.1:${s.port}) received: ${JSON.stringify(s.paths)}`,
    );
  }
}

async function parRequest(clientId: string, redirectUri: string): Promise<Response> {
  const proof = await makeDpopProof("POST", `${ORIGIN}/oauth/par`);
  const body = new URLSearchParams({
    client_id: clientId,
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
    redirect_uri: redirectUri,
    response_type: "code",
    state: "st-1234567890",
    scope: "atproto",
  });
  return await factory.app.fetch(
    new Request(`${ORIGIN}/oauth/par`, {
      method: "POST",
      headers: {
        host: "127.0.0.1:2583",
        "content-type": "application/x-www-form-urlencoded",
        dpop: proof,
      },
      body: body.toString(),
    }),
  );
}

async function tokenRequest(clientId: string, assertion: string): Promise<Response> {
  const proof = await makeDpopProof("POST", `${ORIGIN}/oauth/token`);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: "not-a-real-token",
    client_id: clientId,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: assertion,
  });
  return await factory.app.fetch(
    new Request(`${ORIGIN}/oauth/token`, {
      method: "POST",
      headers: {
        host: "127.0.0.1:2583",
        "content-type": "application/x-www-form-urlencoded",
        dpop: proof,
      },
      body: body.toString(),
    }),
  );
}

Deno.test("ATTACK A: a client_id naming a plaintext caller-chosen host is not fetched", async () => {
    reset();
    const res = await parRequest(ATTACKER_ID, "https://client.example/callback");
    const bodyText = await res.text();
    console.log(`  status=${res.status} body=${bodyText}`);
    report("ATTACK A", [attacker]);
    assertEquals(
      attacker.hits,
      0,
      `server fetched a plaintext caller-named host ${attacker.hits} time(s); attempted=${JSON.stringify(attempted)}`,
    );
  });

  Deno.test("ATTACK B: a caller-written jwks_uri at a second plaintext host is not fetched", async () => {
    reset();
    const assertion = await makeClientAssertion(EVIL_ID, ORIGIN, legitKeys);
    const res = await tokenRequest(EVIL_ID, assertion);
    const bodyText = await res.text();
    console.log(`  status=${res.status} body=${bodyText}`);
    report("ATTACK B", [internal, evil]);
    assertEquals(
      internal.hits,
      0,
      `server fetched a plaintext host named by the caller's own document ${internal.hits} time(s); attempted=${JSON.stringify(attempted)}`,
    );
  });

  Deno.test("ATTACK C: a non-http scheme client_id is never fetched", async () => {
  reset();
  const res = await parRequest("file:///etc/passwd", "https://client.example/callback");
  const bodyText = await res.text();
  console.log(`  status=${res.status} body=${bodyText}`);
  report("ATTACK C", [attacker, internal]);
  assertEquals(
    attempted.length,
    0,
    `a non-http scheme reached fetch(): ${JSON.stringify(attempted)}`,
  );
});

Deno.test("ATTACK D: an https client_id that redirects to a plaintext host does not reach it", async () => {
  reset();
  const res = await parRequest(REDIRECT_ID, "https://client.example/callback");
  const bodyText = await res.text();
  console.log(`  status=${res.status} body=${bodyText}`);
  report("ATTACK D", [internal, evil]);
  assertEquals(
    internal.hits,
    0,
    `a redirect carried the fetch to a plaintext host ${internal.hits} time(s); attempted=${JSON.stringify(attempted)}`,
  );
});

Deno.test("SCHEME CONTROL: the spec's http://localhost development exception is still admitted", async () => {
  reset();
  const res = await parRequest("http://localhost/", "https://client.example/callback");
  const bodyText = await res.text();
  console.log(`  status=${res.status} body=${bodyText}`);
  console.log(`  http://localhost/ admitted to fetch: ${attempted.length === 1}`);
  console.log(`  attempted URLs: ${JSON.stringify(attempted)}`);
  assertEquals(
    attempted.length,
    1,
    "the spec's http://localhost exception was dropped, so local development clients can no longer register",
  );
});

Deno.test("CONTROL 1: a legitimate https client still registers via PAR", async () => {
    reset();
    const res = await parRequest(LEGIT_ID, "https://client.example/callback");
    const bodyText = await res.text();
    console.log(`  status=${res.status} body=${bodyText}`);
    report("CONTROL 1", [legit]);
    assertEquals(res.status, 200, `legitimate client was refused: ${bodyText}`);
    const body = JSON.parse(bodyText) as { request_uri?: string };
    assertExists(body.request_uri);
    assertEquals(legit.hits, 1, "the legitimate client's metadata was never fetched");
  });

  Deno.test("CONTROL 2: a legitimate assertion verifies against its published jwks_uri", async () => {
    reset();
    const assertion = await makeClientAssertion(LEGIT2_ID, ORIGIN, legitKeys);
    const res = await tokenRequest(LEGIT2_ID, assertion);
    const bodyText = await res.text();
    console.log(`  status=${res.status} body=${bodyText}`);
    report("CONTROL 2", [legit]);
    assertEquals(
      res.status !== 401,
      true,
      `assertion verification failed for a legitimate client: ${bodyText}`,
    );
    assertEquals(
      legit.paths.includes("GET /c2-jwks.json"),
      true,
      `the legitimate client's jwks_uri was never fetched: ${JSON.stringify(legit.paths)}`,
    );
  });
Deno.test("TEARDOWN: stop the counting servers", () => {
  for (const s of [internal, attacker, evil, legit]) s.stop();
});

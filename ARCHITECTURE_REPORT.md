# Hono PDS — Comprehensive Architecture Report

## 1. Project Overview

**What it is:** An AT Protocol Personal Data Server (PDS) — the server component that hosts a user's repository of records (posts, likes, follows, etc.) and participates in the AT Protocol federation. It implements repo CRUD, firehose subscription, account management, and has an optional OAuth authorization server.

**Technology stack:**
- **Runtime:** Deno (stable APIs, no `--unstable-*` flags)
- **Web framework:** Hono (`@hono/hono@^4`) — lightweight, typed, middleware-oriented
- **Crypto:** `@atproto/crypto` (secp256k1/ES256K for repo signing), Web Crypto API (P-256/ES256 for DPoP), PBKDF2 (password hashing)
- **Identity:** `@atproto/identity` (DID resolution)
- **JSR packages:** All project-local packages published as `@publicdomainrelay/*` on JSR

**Polyrepo context:** The `hono-pds` directory is one workspace in a polyrepo rooted at `org-root-dispatcher-typescript/`. Sibling repos include `typescript-helpers/` (cross-repo shared utilities: logger, serve, cli-args-env, event-bus, hono-error-middleware), `deno-worker-sandbox/` (sandbox ABC + impl), and other concept repos (relay, compute-provider, market). Scripts at `scripts/find-all-package.ts | yq -P` provide a session-start map of all packages across the polyrepo.

---

## 2. Package Architecture (ABC Layering)

The codebase strictly follows a 4-layer dependency flow with no cycles:

```
lib/common/*                   <- external deps ONLY (zero project-local deps)
    ^
lib/abc/*                      <- imports common (type imports), pure interfaces + state
    ^
lib/${concept}-${transport}    <- imports abc + common, concrete I/O
    ^
lib/hono-factory-${concept}    <- imports impl + abc + common + Hono
    ^
hono-${concept} (CLI)          <- imports hono-factory + common + external tools
```

### Package inventory (7 workspace members)

| Directory | Package (JSR) | Layer | Role |
|-----------|--------------|-------|------|
| `lib/common/` | _(no name)_ | common | Leaf utilities (bytes, cid, tid, dag-cbor, subscribe-types) |
| `lib/common/oauth-server-common/` | _(no name)_ | common | OAuth constants + `generateDpopNonce`, `computeJkt`, `OAuthSessionData` |
| `lib/abc/atproto-repo/` | `@publicdomainrelay/atproto-repo-abc` | abc | `RepoApi`, `Storage`, `Signer`, `Verifier`, `Sequencer`, `Mst`, `CommitEvent` interfaces + pure MST implementation |
| `lib/abc/atproto-oauth-server/` | `@publicdomainrelay/atproto-oauth-server-abc` | abc | `TokenStore`, `SessionInjector`, `DpopVerifier`, `DpopNonceStore` interfaces |
| `lib/atproto-repo-deno/` | `@publicdomainrelay/atproto-repo-deno` | impl | `Repo`, `MemoryStorage`, `DenoKvStorage`, `IndexedDbStorage`, `signerFromKeypair`, `createAccountStore`, `exportCar`/`importCar`, `signServiceAuth` |
| `lib/atproto-oauth-server-deno/` | `@publicdomainrelay/atproto-oauth-server-deno` | impl | `createMemoryTokenStore`, `createSessionInjector`, `createDpopVerifier`, `createDpopNonceStore` |
| `lib/hono-factory-atproto-repo-deno/` | `@publicdomainrelay/hono-factory-atproto-repo-deno` | factory | `createRepoFactory`, `mountRepoRoutes`, `mountSyncRoutes`, `createSubscribeHandler`, `FirehoseSequencer` |

### Dependency graph (verified acyclic)

```
atproto-repo-common  (external JSR package)
    ^
    ├── lib/common/{bytes,cid,tid,dag-cbor,subscribe-types}
    │       ^
    │       └── lib/abc/atproto-repo  (type-only from common + external)
    │               ^
    │               ├── lib/atproto-repo-deno  (concrete Repo, storages, signers)
    │               │       ^
    │               │       └── lib/hono-factory-atproto-repo-deno
    │               │               ^
    │               │               └── hono-pds (main.ts CLI)
    │               │
    │               └── (auth concept, same pattern)
    │
    ├── oauth-server-common
    │       ^
    │       └── lib/abc/atproto-oauth-server
    │               ^
    │               └── lib/atproto-oauth-server-deno
    │                       ^
    │                       └── lib/hono-factory-atproto-repo-deno (composes OAuth impl)
```

---

## 3. Data Model

### Core data structures

**CID (Content Identifier):**
```typescript
type Cid = string;  // CIDv1, DAG-CBOR codec (0x71), SHA2-256 (0x12), multibase base32 ("b" prefix)
// Binary: [0x01, 0x71, 0x12, 0x20, 32_bytes_of_digest]
// String: "bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
```

**TID (Timestamp Identifier):**
```typescript
type Tid = string;  // 13-char base32 (alphabet: 234567abcdefghijklmnopqrstuvwxyz)
// Packing: 6 bytes timestamp (microsecond precision) + 1 byte clock ID → 13 base32 chars
// Guaranteed monotonically increasing within process via lastMicros tracking
```

**Merkle Search Tree (MST):**
```
TreeNodeData = {
  l: Cid | null;       // leftmost subtree CID
  e: TreeNodeEntry[];  // entries (sorted by key)
}
TreeNodeEntry = {
  p: number;           // common prefix length with previous entry's key
  k: Uint8Array;       // key suffix (after stripping p bytes of prefix)
  v: Cid;              // value CID (points to CBOR-encoded record)
  t: Cid | null;       // subtree CID to the right of this entry
}
```
Layer assignment: `leadingZerosOnHash(key, sha256)` returns the number of leading base-4 zeros in SHA-256(key), determining the tree layer where a key resides. Keys on higher layers (more leading zeros) sit closer to the root.

**Commit structure:**
```typescript
CommitData = {
  version: 3;           // always 3
  did: Did;             // repo owner DID
  data: Cid;            // CID link to MST root
  rev: Tid;             // revision timestamp
  prev: Cid | null;     // previous commit CID
  sig: Bytes;           // secp256k1 signature over CBOR(did, version, data, rev, prev)
}
```

**CommitEvent (what the sequencer stores):**
```typescript
CommitEvent = {
  repo: Did;
  commit: Cid;
  rev: Tid;
  since: Tid | null;    // previous rev (null for first commit)
  blocks: Bytes;        // CAR slice containing only changed blocks
  ops: CommitOp[];
}
CommitOp = {
  action: "create" | "update" | "delete";
  path: string;         // "{collection}/{rkey}"
  cid: Cid | null;
}
```

**WriteOp (user-facing write operation):**
```typescript
WriteOp = {
  action: "create" | "update" | "delete";
  collection: string;
  rkey: string;
  record?: unknown;     // CBOR-encodable value
}
```

### Storage abstraction

```typescript
interface BlockStore {
  get(cid: Cid): Promise<Bytes | null>;
  put(cid: Cid, bytes: Bytes): Promise<void>;
  has(cid: Cid): Promise<boolean>;
}
interface RepoStore {
  getHead(did: Did): Promise<{ commit: Cid; rev: Tid } | null>;
  setHead(did: Did, head: { commit: Cid; rev: Tid }): Promise<void>;
}
type Storage = BlockStore & RepoStore;
```

Three backends implement `Storage`:

| Backend | Class | Environment | Persistence | Constructor |
|---------|-------|-------------|-------------|-------------|
| In-memory | `MemoryStorage` | Any JS runtime | None (process) | `new MemoryStorage()` |
| Deno.KV | `DenoKvStorage` | Deno | Disk (SQLite) | `await DenoKvStorage.create(path?)` |
| IndexedDB | `IndexedDbStorage` | Browser | Disk (IndexedDB) | `await IndexedDbStorage.create()` |

---

## 4. API Surface (Route Table)

### XRPC endpoints (mounted via `mountRepoRoutes` and `mountSyncRoutes`)

| Method | Path | Auth | Handler File | Description |
|--------|------|------|-------------|-------------|
| GET | `/xrpc/_health` | none | factory.ts | `{ version: "0.0.0" }` |
| GET | `/xrpc/com.atproto.server.describeServer` | none | factory.ts | PDS metadata (did, version, availableUserDomains, inviteCodeRequired) |
| POST | `/xrpc/com.atproto.server.createAccount` | none | factory.ts | Create account, return accessJwt + refreshJwt |
| POST | `/xrpc/com.atproto.server.createSession` | none | factory.ts | Password auth, return accessJwt + refreshJwt |
| GET | `/xrpc/com.atproto.server.getServiceAuth` | optional Bearer | factory.ts | Service auth JWT for inter-PDS calls |
| POST | `/xrpc/com.atproto.server.getServiceAuth` | optional Bearer | factory.ts | Same via POST body |
| GET | `/xrpc/com.atproto.repo.describeRepo` | requesterDid | repo-handlers.ts | Collections list + head revision |
| GET | `/xrpc/com.atproto.repo.getRecord` | requesterDid | repo-handlers.ts | Single record by collection + rkey |
| GET | `/xrpc/com.atproto.repo.listRecords` | requesterDid | repo-handlers.ts | Paginated record listing (limit + cursor) |
| POST | `/xrpc/com.atproto.repo.createRecord` | requesterDid | repo-handlers.ts | Create record with auto-TID or explicit rkey |
| POST | `/xrpc/com.atproto.repo.putRecord` | requesterDid | repo-handlers.ts | Upsert (create if not exists, update if exists) |
| POST | `/xrpc/com.atproto.repo.deleteRecord` | requesterDid | repo-handlers.ts | Delete (idempotent, 200 on already-missing) |
| POST | `/xrpc/com.atproto.repo.applyWrites` | requesterDid | repo-handlers.ts | Atomic batch of create/update/delete operations |
| GET | `/xrpc/com.atproto.sync.getRepo` | none | sync-handlers.ts | Full repo CAR export |
| GET | `/xrpc/com.atproto.sync.getLatestCommit` | none | sync-handlers.ts | `{ cid, rev }` |
| GET | `/xrpc/com.atproto.sync.getRecord` | none | sync-handlers.ts | Record JSON (public read) |
| WS | `/xrpc/com.atproto.sync.subscribeRepos` | none | factory.ts | Real-time firehose over WebSocket, cursor-based backfill |

### Well-known endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/.well-known/atproto-did` | PDS DID as plain text |
| GET | `/.well-known/did.json` | `did:web` DID document with `verificationMethod` (atproto key + attestation key) and `service` entries |
| GET | `/.well-known/oauth-protected-resource` | RFC 8707 resource indicator |
| GET | `/.well-known/oauth-authorization-server` | RFC 8414 AS metadata |

### OAuth authorization server endpoints (conditional, enabled via `oauthServer.enabled`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/oauth/token` | Token endpoint (refresh_token grant only, DPoP-bound) |

### Unimplemented lexicons (schema registered, no route)

- `com.atproto.identity.resolveHandle`
- `com.atproto.identity.updateHandle`

### Auth context variable flow

```
Context variable "requesterDid" → set at top of factory (default = PDS DID)
    ↑
Context variable "oauthUserDid" → set by DPoP middleware when DPoP token is present
    (overrides requesterDid for the handler)
```

---

## 5. Auth & Security

### Two authentication systems coexist

**1. Legacy PDS auth (account-store JWT):**

Used by `createAccount` / `createSession` / `getServiceAuth`. The `AccountStore` (from `atproto-repo-deno`) issues ES256K-signed JWTs:

```typescript
// Access token: 15 min TTL
{ iss: pdsDid, sub: did, aud: pdsDid, handle, iat, exp, jti }
// Refresh token: 7 day TTL
{ iss: pdsDid, sub: did, aud: pdsDid, handle, iat, exp, jti }
```

**Notable:** `validateAccessJwt` only decodes the JWT payload and checks expiration — it does NOT verify the JWT signature against the PDS's public key. This is a simplification for the in-memory account store; production should verify signatures.

Service auth tokens (for inter-service calls) use the same signing key but are audience-bound:
```typescript
signServiceAuth(signer, { aud, lxm?, expiresInSec? })
// Header: { typ: "JWT", alg: "ES256K" }
// Payload: { iss: signer.did(), aud, iat, exp, jti, lxm? }
```

**2. OAuth server (DPoP-bound, RFC 9449):**

When `oauthServer.enabled` is true, the factory creates:
- **`TokenStore`** (via `createMemoryTokenStore(signer)`) — issues ES256K JWTs with `cnf: { jkt }` (DPoP key thumbprint binding). Signature verification strategy: re-signs the stored claims and compares JWT strings (no JWT verification library).
- **`DpopVerifier`** (via `createDpopVerifier()`) — 8-step verification per RFC 9449: checks `typ: "dpop+jwt"`, `alg: "ES256"`, JWK in header (P-256 only, no private key `d`), `htm` matches http method, `htu` matches URL, `iat` within 30-second clock skew, optional `ath` (access token hash) verification, ECDSA signature via Web Crypto, and replay protection via 5-minute jti cache.
- **`DpopNonceStore`** (via `createDpopNonceStore()`) — one-time nonces per origin with 5-minute TTL.
- **`SessionInjector`** (via `createSessionInjector(tokenStore, issuer)`) — creates programmatic sessions with fresh P-256 DPoP keypairs.

**DPoP middleware flow** (registered on `/xrpc/*`, active only when a `DPoP ` Authorization header is present):

```
Request → Authorization: DPoP {access_token}
       → DPoP header: {DPoP proof JWT}
       → Verify proof (DpopVerifier.verifyProof)
       → Validate token (TokenStore.validate)
       → Bind: token.jkt === proof.jkt
       → Set context variable "oauthUserDid" = token.sub
       → Issue new DPoP-Nonce header on response
```

If no DPoP token is present, the middleware is a no-op and `requesterDid` defaults to the PDS DID.

### Password hashing

PBKDF2 with SHA-256, 100,000 iterations, 16-byte random salt. Server-side only — password is never stored, only `passwordHash + passwordSalt`.

### Dual crypto domains

| Domain | Algorithm | Key type | Used for |
|--------|-----------|----------|----------|
| AT Protocol repo | ES256K (`-`) / ECDSA | secp256k1 | Commit signing, service auth JWTs, account session JWTs |
| OAuth DPoP | ES256 | P-256 | DPoP proof JWTs, client key binding |

---

## 6. Data Flow

### Write path

```
Client HTTP POST /xrpc/com.atproto.repo.createRecord (or applyWrites, putRecord)
    │
    ▼
Hono routing → auth middleware → repo-handlers.ts handler
    │
    ▼
handler.parse XRPC input → builds WriteOp[]
    │
    ▼
RepoApi.applyWrites(did, writes)       ← wiredRepo (factory.ts)
    │
    ├── Validates DID matches repo DID
    ├── Loads current head from Storage.getHead(did)
    ├── Loads MST from previous root (or creates empty)
    ├── For each WriteOp:
    │   ├── CBOR-encodes record
    │   ├── Computes CID via SHA-256
    │   ├── Storage.put(cid, bytes)
    │   └── MST.set(key, cid) or MST.delete(key)
    ├── Computes changedCids via diff(oldRoot, newRoot)
    ├── Builds CAR slice of changed blocks (buildCarSlice)
    ├── Generates new Tid via nextTid()
    ├── Signs commit: CBOR(commitFields) → Signer.sign() → attach sig
    ├── Storage.put(commitCid, signedBytes)
    └── Storage.setHead(did, { commit: commitCid, rev: newRev })
    │
    ▼
WiredRepo:
    ├── sequencer.append(commitEvent) → broadcasts on EventBus
    └── POST /xrpc/com.atproto.sync.requestCrawl → crawlers (debounced 1s)
    │
    ▼
Response: { uri: string, cid: Cid }
```

### Read path

```
Client GET /xrpc/com.atproto.repo.getRecord?repo={did}&collection={nsid}&rkey={rkey}
    │
    ▼
Hono routing → auth middleware → repo-handlers.ts handler
    │
    ▼
Repo.getRecord(did, collection, rkey)
    │
    ├── Storage.getHead(did) → { commit, rev }
    ├── storage.get(commit) → CBOR decode → extract data CID (MST root)
    ├── MST.get({collection}/{rkey})
    │   └── Tree traversal: find insertion index → check LeafNode → recurse into subtree
    ├── Storage.get(valueCid) → CBOR decode → record value
    │
    ▼
Response: { uri, cid, value }
```

### Firehose subscription flow

```
Client WebSocket connect /xrpc/com.atproto.sync.subscribeRepos?cursor={seq}
    │
    ▼
Hono upgradeWebSocket → createSubscribeHandler(sequencer)
    │
    ├── sequencer.backfill(cursor) → yields historical frames (seq > cursor)
    │   └── emit(frame) → WebSocket send (JSON)
    │
    ├── sequencer.live() → yields frames as they arrive
    │   └── emit(frame) → WebSocket send (JSON)
    │
    └── On close/error: set active=false → async iterator aborts
```

**FirehoseSequencer internals:**
```
append(evt) → inc #seq, store in #backlog (circular buffer, 10k cap), publish to EventBus
backfill(since?) → iterate #backlog yielding seq > since (defaults to 0)
live() → subscribe to EventBus, yield frames as they arrive (Promise-based push)
```

**SequencedFrame format:**
```typescript
SequencedFrame = {
  $type: "com.atproto.sync.subscribeRepos#commit",
  seq: number,
  repo: Did,
  commit: Cid,
  rev: Tid,
  since: Tid | null,
  blocks: Bytes,          // CAR-slice of changed blocks
  ops: Array<{
    action: "create" | "update" | "delete";
    path: string;
    cid: { $link: Cid } | null;
    prev: null;
  }>,
  time: string            // ISO timestamp
}
```

---

## 7. Configuration & Deployment

### CLI config flow (4-tier priority)

```
CLI flag (--port 9000)  << highest
    > env var (PORT=9000)
        > config.json ("port": 2583)
            > cli-args-env.json default (2583)  << lowest
```

### cli-args-env.json options

| Option | Type | Env var | Default | Description |
|--------|------|---------|---------|-------------|
| `port` | number | `PORT` | `2583` | Listen port |
| `hostname` | string | `HOSTNAME` | `127.0.0.1` | Bind address |
| `private-key-hex` | string | `PDS_PRIVATE_KEY_HEX` | _(auto-generate)_ | secp256k1 private key hex |
| `did-web-services` | string | `PDS_DID_WEB_SERVICES` | _(none)_ | JSON array of did:web service entries |
| `public-hostname` | string | `PDS_PUBLIC_HOSTNAME` | _(none)_ | Public hostname for requestCrawl |
| `crawlers` | string | `PDS_CRAWLERS` | _(none)_ | Comma-separated relay URLs |

### CLI startup flow (main.ts)

```
import.meta.main block:
    1. load config.json (optional, catch errors)
    2. new Command("CONFIG_PATH_HONO_PDS", cliArgsEnv, runtimeConfig).resolve()
    3. createLogger({ serviceName: "hono-pds" })
    4. createFromEnv(options):
        a. import or generate Secp256k1Keypair
        b. signerFromKeypair(kp)
        c. DenoKvStorage.create() — repo database
        d. parse didWebServices JSON, split crawlers on commas
        e. createRepoFactory({ storage, signer, didWebServices, publicHostname, crawlers })
    5. createServe({ logger, tcp: { addr, port } })
    6. serve.app.route("/", repo.app)
    7. Deno.addSignalListener("SIGINT/SIGTERM" → serve.shutdown())
    8. serve.beginServe() — blocking
```

### Bundle/deployment

**`trusted-deno.json`** — stripped workspace (no OAuth, no sandbox) for production `deno bundle` via `scripts/bundle.sh`:
```
deno bundle --frozen --config ./trusted-deno.json -o bundle.js main.ts
```

**Sandbox deployment** — `scripts/worker-launcher.ts` runs PDS in a Deno Worker with message-passing protocol (init → ready, request → response, shutdown → close). Used by `scripts/sandbox.ts` for programmatic sandboxed PDS instances.

**`deno compile`** bundles both JSON config files:
```json
"compile": { "include": ["cli-args-env.json", "config.json"] }
```

**Config file override:** `CONFIG_PATH_HONO_PDS` env var points to an alternative `config.json` path, enabling environment-specific configs without binary modification.

---

## 8. Test Architecture

### Test organization (15 files, ~70 tests)

| Category | Files | Tests | Patterns |
|----------|-------|-------|----------|
| **Common utilities** | `cid_test.ts`, `bytes_test.ts`, `dag-cbor_test.ts`, `tid_test.ts` | 27 | Pure function tests, inline fixtures |
| **ABC layer** | `mst_test.ts` | 6 | MemoryStorage + custom hasher, MST interface coverage |
| **Impl layer** | `storage_test.ts`, `repo_test.ts` | 12 | Direct class instantiation, MockSigner |
| **HTTP conformance** | `crud-conformance.test.ts`, `commit-conformance.test.ts`, `firehose-conformance.test.ts` | 26 | `factory.app.request()` (internal Hono), real Secp256k1Keypair for commit/firehose tests |
| **Sandbox conformance** | `sandbox-conformance.test.ts` | 14 | Full HTTP boundary via Deno Worker, `createPdsSandbox()` |
| **Factory e2e** | `e2e_test.ts` | 5 | `factory.app.request()`, subscribe callback polling |
| **Integration** | `integration_test.ts` | 2 | Real `Deno.serve({port:0})`, real `fetch()` |
| **CLI smoke** | `cli_smoke_test.ts` | 1 | `Deno.Command("deno run main.ts --help")` |

### Mock patterns (3 levels)

1. **MockSigner** — SHA-256 hash as "signature" (not valid secp256k1). Used in 15 tests across repo_test, crud-conformance, e2e, integration.
2. **`Secp256k1Keypair.create()` + `signerFromKeypair()`** — real keypair from `@atproto/crypto`. Used in commit-conformance (8 tests) and firehose-conformance (6 tests).
3. **`MemoryStorage`** — in-memory `Map`-based storage. Used in all factory/repo/MST tests.

### Key patterns

- **No real I/O for majority of tests** — 70+ tests run in-process via `factory.app.request()`. Only integration_test and sandbox tests bind ports or spawn workers.
- **Async subscription polling** — firehose tests use `setTimeout(5ms, ...)` in a loop (up to 20 tries) for async event delivery.
- **Direct CBOR inspection** — commit-conformance tests decode raw commit bytes from storage to verify field structure, CID reproducibility, and signature chains.
- **Fresh state per test** — each test creates its own `MemoryStorage`, `Repo`, and `factory` instances.

### Notable coverage gaps

1. **DenoKvStorage**: Only a compile-time existence check. No test opens a real `Deno.openKv()`.
2. **Authentication/Authorization**: No tests for PDS auth middleware, session tokens, OAuth flows, or access control on write endpoints.
3. **Error handling**: No tests for malformed input, invalid CBOR, oversized records, invalid NSID/rkey syntax, or `swapCommit` conflicts.
4. **Blob/upload**: `com.atproto.repo.uploadBlob` has no tests (and likely no implementation beyond the lexicon schema).
5. **Account management**: No tests for `createAccount`, `createSession`, or password reset flows.
6. **Admin endpoints**: No `com.atproto.admin.*` tests.
7. **WebSocket transport**: The firehose subscribe callback is tested in-process, but no test exercises the actual WebSocket upgrade.
8. **CLI**: Only `--help` tested. No config-file loading, no server startup validation.
9. **sequencer persistence**: No test for what happens to sequence numbers after crash/restart.
10. **Cross-tenant isolation**: Only sandbox test verifies different DIDs per instance. No test validates one DID cannot read/write another's records.
11. **MockSigner limitation**: SHA-256 as "signature" is not a valid secp256k1 signature. CRUD and e2e tests never verify signatures — they trust the factory's internal signing implicitly.

---

## 9. Key Design Decisions & Trade-offs

### 1. Pure ABC layer
The entire `lib/abc/` layer contains zero I/O — no `fetch`, `crypto.subtle`, `Deno.*`, timers, or side effects. Even the MST class (the most complex data structure) is a pure state machine: tree mutations return new `MstNode` instances (structural sharing via spread), serialization is lazy, and the `BlockStore` is only called from the `Mst` wrapper, not from `MstNode` operations.

**Consequence:** ABC code can be unit-tested with no mocks, no timers, no I/O. The trade-off is more explicit parameter passing (the hasher and block store must be threaded through).

### 2. Three storage backends, one interface
`MemoryStorage`, `DenoKvStorage`, and `IndexedDbStorage` all satify the same `Storage = BlockStore & RepoStore` interface. The `Repo` class and factory are entirely backend-agnostic.

**Trade-off:** DenoKvStorage and IndexedDbStorage are structurally similar but have different storage schemas (Deno.Kv uses `["blocks", cid]` key prefixes; IndexedDB uses object stores). The unified interface means storage-specific features (transactions, atomic operations) are not surfaced to callers.

### 3. In-memory sequencer with 10k backlog cap
The `FirehoseSequencer` keeps events in a circular buffer. Slow subscribers that fall behind by more than 10,000 events miss frames.

**Trade-off:** No persistence means no replay across restarts. The backfill only works for subscribers within the window. This is acceptable for a development/single-tenant PDS but would need a persistent sequencer for production federation.

### 4. No JWT verification library
Both `account-store.ts` and `oauth-server-deno/mod.ts` implement JWT handling without a library:
- Account store: `validateAccessJwt` decodes payload only (no signature verification).
- Token store: Re-signs stored claims and compares JWT strings (custom verification).

**Trade-off:** Zero external dependency for JWT handling, but the account store's approach is insecure (trivially forgeable JWTs) and the token store's re-sign approach works only because both issuer and verifier are the same process with access to the same key. The account store's missing signature verification is a **security gap** noted in the code itself.

### 5. Single-tenant PDS model
The PDS is designed as a single-tenant server — one repo instance serves one DID. The `requesterDid` context variable defaults to the PDS DID. The `repo` query parameter in XRPC requests is accepted but overridden:

> "createRecord ignores the repo field and always uses the server DID"

**Rationale:** Each PDS instance serves exactly one user (or one bot/automation). Multi-tenant PDS would require routing by `repo` to the correct storage backend. The sandbox model (each sandbox has its own DID) provides isolation when multiple identities are needed.

### 6. Hono factory composition over subclassing
The factory pattern (`createRepoFactory(opts)`) returns an object with `app`, `subscribe`, `api`, `sequencer`, and optionally `sessionInjector`. There is no class inheritance — composition only. Route mounting functions (`mountRepoRoutes`, `mountSyncRoutes`) are separately exported for external composition (e.g., mounting under a sub-path in a larger app).

### 7. Dual crypto domains (secp256k1 vs P-256)
AT Protocol's native signing uses secp256k1 (ES256K), sourced from `@atproto/crypto`. OAuth DPoP (RFC 9449) requires P-256 (ES256), sourced from Web Crypto API. The codebase maintains both key types, separate signers, and separate JWT formats (AT Protocol JWTs use `alg: "ES256K"`; DPoP proofs use `alg: "ES256"`).

### 8. Hand-rolled CBOR codec
DAG-CBOR encoding/decoding (`lib/common/dag-cbor.ts`) is implemented from scratch (~200 lines) rather than using `@ipld/dag-cbor`. Supports only the IPLD subset: no floats, no indefinite-length items, deterministic map key ordering. CIDs are encoded as CBOR tag 42.

**Rationale:** Zero external dependency, full control over the encoding format, smaller bundle size. Trade-off is maintenance burden for a non-trivial binary format codec.

---

## 10. Cross-Repo Dependencies

### From `typescript-helpers/` (same org root)

| Import specifier | Repo source | Used in | Purpose |
|-----------------|-------------|---------|---------|
| `@publicdomainrelay/hono-error-middleware` | `typescript-helpers/lib/hono-error-middleware/` | factory.ts | XrpcError → JSON error response middleware |
| `@publicdomainrelay/logger` | `typescript-helpers/lib/logger/` | main.ts | `createLogger({ serviceName })` |
| `@publicdomainrelay/serve` | `typescript-helpers/lib/serve/` | main.ts | `createServe()` — composable serve handle with tcp/unix/relay options, signal-aware shutdown |
| `@publicdomainrelay/cli-args-env` | `typescript-helpers/lib/cli-args-env/` | main.ts | `Command` class for multi-source config resolution |
| `@publicdomainrelay/event-bus` | `typescript-helpers/lib/event-bus/` | sequencer.ts | Pub-sub for firehose frame delivery |

### From `deno-worker-sandbox/` (same org root)

| Import specifier | Repo source | Used in | Purpose |
|-----------------|-------------|---------|---------|
| `@publicdomainrelay/sandbox-abc` | `deno-worker-sandbox/lib/abc/sandbox/` | sandbox.ts | Sandbox interface |
| `@publicdomainrelay/sandbox-deno` | `deno-worker-sandbox/lib/sandbox-deno/` | sandbox.ts | Deno Worker sandbox implementation |

### From npm / JSR (external)

| Package | Source | Used in | Purpose |
|---------|--------|---------|---------|
| `@hono/hono` | jsr | factory | Web framework, routing, middleware, WebSocket upgrade |
| `@atproto/crypto` | npm | impl layer | `Secp256k1Keypair`, `verifySignature` (secp256k1 ECDSA) |
| `@atproto/identity` | npm | impl layer | DID resolution |
| `@std/assert` | jsr | tests | Assertion library |

### External common types (JSR `@publicdomainrelay/atproto-repo-common`)

The `lib/common/` files import from this external JSR package (which is actually the published form of the same common types — resolved locally because they are workspace members). Types: `Bytes`, `Cid`, `Tid`, `encode`, `decode`, `cidFromDigest`, `bytesEqual`, `SHA256_DIGEST_LEN`.

---

### Summary architecture diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              hono-pds (main.ts)                            │
│  CLI entrypoint: cli-args-env→config→factory→serve→signal→beginServe()     │
│        ├── createFromEnv() → keypair → signer → storage → factory          │
│        └── scripts/worker-launcher.ts (Deno Worker sandbox entrypoint)     │
└────────────────────────────────────────────────────────────────────────────┘
                                    │ depends on
┌────────────────────────────────────────────────────────────────────────────┐
│              lib/hono-factory-atproto-repo-deno/  (Hono factory)           │
│  createRepoFactory() → routes (repo CRUD + sync + firehose WS + OAuth)     │
│  ┌──────────────────────────────────────────────────────────────────┐      │
│  │  Mounted route modules:                                         │      │
│  │  repo-handlers.ts  (6 XRPC routes)                              │      │
│  │  sync-handlers.ts  (3 XRPC routes, public)                      │      │
│  │  factory.ts        (health, server, account, WS, OAuth, well-known)    │      │
│  │  subscribe.ts      (WebSocket ↔ Sequencer bridge)               │      │
│  │  sequencer.ts      (FirehoseSequencer: backlog + EventBus)      │      │
│  │  lexicons/         (12 JSON schemas indexed by NSID)            │      │
│  └──────────────────────────────────────────────────────────────────┘      │
└────────────────────────────────────────────────────────────────────────────┘
                                    │ depends on
┌────────────────────────────────────────────────────────────────────────────┐
│  lib/atproto-repo-deno/ (impl)     │ lib/atproto-oauth-server-deno/ (impl) │
│  Repo class (RepoApi impl)        │ createMemoryTokenStore()               │
│  MemoryStorage / DenoKvStorage /  │ createSessionInjector()                │
│    IndexedDbStorage               │ createDpopVerifier()                   │
│  signerFromKeypair()             │ createDpopNonceStore()                  │
│  createVerifier()                 │                                        │
│  createAccountStore()            │                                        │
│  exportCar() / importCar()       │                                        │
│  signServiceAuth()               │                                        │
└──────────────────────────────────┴────────────────────────────────────────┘
                                    │ depends on
┌────────────────────────────────────────────────────────────────────────────┐
│  lib/abc/atproto-repo/  (pure)    │ lib/abc/atproto-oauth-server/  (pure) │
│  Storage, Signer, Verifier,      │ TokenStore, SessionInjector,          │
│    Hasher, RepoApi, Sequencer     │   DpopVerifier, DpopNonceStore        │
│  Mst class + diff() + createMst()│ interfaces                             │
│  CommitEvent, CommitOp, XrpcError│                                        │
└────────────────────────────────────────────────────────────────────────────┘
                                    │ depends on (type-only)
┌────────────────────────────────────────────────────────────────────────────┐
│  lib/common/                       │ lib/common/oauth-server-common/      │
│  bytes.ts  (Bytes, utf8, hex,     │ OAuthSessionData interface            │
│    base64, base32, concat, eq)    │ generateDpopNonce, computeJkt         │
│  cid.ts    (Cid type, helpers)    │ DPoP constants (header names, scheme) │
│  tid.ts    (Tid type, nextTid)    │                                       │
│  dag-cbor.ts (CBOR codec)         │                                       │
│  subscribe-types.ts                │                                       │
└────────────────────────────────────────────────────────────────────────────┘
```

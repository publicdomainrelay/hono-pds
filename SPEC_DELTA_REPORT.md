# AT Protocol Spec Delta Report — hono-pds

Comparison date: 2026-07-14. Specs fetched from `atproto.com/specs/*`, implementation analyzed from `lib/` and `lib/hono-factory-atproto-repo-deno/`.

---

## Critical (blocking interoperability)

### 1. DRISL CBOR vs DAG-CBOR — WRONG CODEC

**Spec:** "The specific normalized subset of CBOR used in the atproto data model is called DRISL (which is successor to DAG-CBOR)." All commit objects, MST nodes, and records are serialized with DRISL.

**Impl:** Uses DAG-CBOR codec (`0x71` in CID multicodec), not DRISL. `lib/common/dag-cbor.ts` hand-rolls DAG-CBOR encoding/decoding.

**Impact:** DRISL has different normalization rules than DAG-CBOR. Same data → different CBOR bytes → different SHA-256 hash → different CID. Commit CIDs, record CIDs, and MST node CIDs produced by this PDS will NOT match any other AT Protocol implementation. Repos are non-verifiable by external consumers.

**Fix:** Replace `dag-cbor.ts` with a DRISL CBOR codec. Update CID codec byte from `0x71` (dag-cbor) to DRISL's codec identifier. All stored CIDs will change.

---

### 2. Firehose wire encoding — JSON, not CBOR

**Spec:** Event stream uses "binary DRISL-CBOR encoding over WebSockets." Frames are CBOR-encoded binary messages (WebSocket binary frames), not text.

**Impl:** `FirehoseSequencer.append()` emits plain JSON objects (`Record<string, unknown>`). The subscribe handler sends JSON over WebSocket (Hono's `emit()`). No CBOR encoding.

**Impact:** Any client expecting binary CBOR frames (per spec) will fail to parse. The entire firehose protocol is wire-incompatible with spec-compliant consumers and relays.

**Fix:** CBOR-encode frames as binary WebSocket messages. Add DRISL CBOR encoding for CID links (`$link` → CBOR tag 42), byte strings, and the frame envelope.

---

### 3. Commit signing process — hash then sign, but wrong bytes to hash

**Spec:** "Serialize the unsigned commit with DRISL CBOR. The output bytes are then hashed with SHA-256, and the binary hash output (without hex encoding) is then signed using the current signing key."

**Impl:** `repo.ts:277-279` signs the CBOR-encoded commit object directly (not SHA-256(DRISL(CBOR))). The `signer.sign()` call in `@atproto/crypto` likely hashes internally before signing, so the effective process is `sign(SHA256(DAG-CBOR(unsignedCommit)))`.

**Impact:** Even with internal hashing, the bytes fed to SHA-256 differ because DAG-CBOR ≠ DRISL. Commit signatures won't verify against the DID document's public key when checked by spec-compliant verifiers.

---

### 4. Commit CID — CID codec mismatch

**Spec:** "The DRISL CBOR (not 'raw') codec should be used for CIDs linking to commit objects."

**Impl:** All CIDs are computed with DAG-CBOR codec byte `0x71`. Commit CIDs use the same codec as records.

**Impact:** Commit CIDs are permanently incompatible. External services cannot verify the commit chain.

---

## High (missing protocol features)

### 5. Missing firehose event types: `#identity`, `#account`, `#sync`

**Spec:** Firehose must emit four event types:
- `#commit` — repository mutations (implemented)
- `#sync` — "indicates that a repository needs to be caught up"
- `#identity` — DID document or handle may have changed
- `#account` — account hosting status changed (active/deleted/takendown/etc.)

**Impl:** Only `#commit` events emitted. No `#sync`, `#identity`, or `#account` events.

**Impact:** Downstream relays and app views cannot track identity changes, account status, or sync state. A relay consuming this firehose would miss critical state changes.

---

### 6. Missing firehose frame fields: `tooBig`, `blobs`, `prevData`

**Spec:** `#commit` event frame requires:

| Field | Spec | Impl |
|-------|------|------|
| `tooBig` | boolean, required (deprecated, always `false`) | **MISSING** |
| `blobs` | cid-link array, required (deprecated, always `[]`) | **MISSING** |
| `prevData` | cid-link, semi-optional ("effectively required for MST inversion") | **MISSING** |
| `ops[].prev` | cid-link, optional, should be present for update/delete | **HARDCODED `null`** |

**Impact:** Frame structure is a subset of the spec. Consuming services expecting these fields will fail. Missing `prevData` prevents MST inversion for repo sync verification.

---

### 7. Missing `com.atproto.server.refreshSession` endpoint

**Spec:** "Every couple minutes, a new access JWT can be requested by hitting the `com.atproto.server.refreshSession` endpoint, using the refresh JWT instead of an access JWT."

**Impl:** `createSession` returns `accessJwt` + `refreshJwt`, but `refreshSession` endpoint does not exist in the route table.

**Impact:** Access tokens expire after 15 minutes with no way to refresh. Any client session longer than 15 minutes breaks.

---

### 8. JWT `typ` header wrong

**Spec:** "Access tokens should use `at+jwt`, and refresh tokens should use `refresh+jwt`."

**Impl:** All JWTs use `typ: "JWT"` and `alg: "ES256K"`. No domain separation between access/refresh tokens.

```typescript
// account-store.ts:19
const header = { typ: "JWT", alg: "ES256K" };
```

**Impact:** Spec-compliant clients expecting `at+jwt`/`refresh+jwt` typ may reject tokens. No domain separation means a refresh token could be used where an access token is expected.

---

### 9. `validateAccessJwt` — no signature verification

**Spec:** Implicitly requires JWT signature verification against the account's DID document public key.

**Impl:** `validateAccessJwt` decodes the JWT payload, checks expiration, and returns `{ did, handle }`. **Never verifies the signature.**

```typescript
// account-store.ts:140-150
validateAccessJwt(token: string) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payloadJson = atob(b64urlToStandard(parts[1]));
  const payload = JSON.parse(payloadJson);
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
  if (!payload.sub || !payload.handle) return null;
  return { did: payload.sub, handle: payload.handle };
}
```

**Impact:** Trivially forgeable JWTs. Any caller can craft a valid-looking token with any DID. This is a security vulnerability.

---

### 10. Missing `com.atproto.repo.uploadBlob` implementation

**Spec:** "The convention for working with blobs is for clients to upload them via the `com.atproto.repo.uploadBlob` endpoint."

**Impl:** Lexicon schema registered in `lexicons/index.ts` but no route mounted — no handler exists.

**Impact:** Clients cannot upload blobs (images, media). Records referencing blobs cannot be created because there's no way to upload the blob first.

---

## Medium (partial/incorrect implementation)

### 11. No `com.atproto.identity.*` handler implementation

**Spec:** `resolveHandle` and `updateHandle` endpoints exist in the lexicon.

**Impl:** Lexicons registered, marked as "unimplemented" in the route table. No routes mounted.

**Impact:** Handle resolution not functional on this PDS. Handles assigned at account creation are static and unresolvable by external services.

---

### 12. Single-tenant PDS model — repos not DID-scoped

**Spec:** PDS hosts repositories for multiple accounts, routing by DID. `com.atproto.repo.*` endpoints accept a `repo` parameter (DID) to identify which repository to operate on.

**Impl:** `requesterDid` always resolves to the single PDS DID. `createRecord` "ignores the repo field and always uses the server DID." `requirePdsAuth` middleware matches token DID against PDS DID.

**Impact:** Can only host one DID's repository per PDS instance. Not suitable for multi-user PDS deployment.

---

### 13. OAuth server — refresh_token grant only, no authorization_code flow

**Spec:** OAuth is "the primary client/server authentication and authorization scheme." Full OAuth 2.0 with authorization code flow (browser-based login), PKCE, DPoP binding.

**Impl:** OAuth server only supports `refresh_token` grant. No `authorization_code` flow — no browser redirect, no consent screen, no authorization endpoint (`/oauth/authorize`). Token endpoint only serves token refresh.

**Impact:** Cannot perform initial OAuth login. The OAuth system is usable only for programmatic token refresh after some other mechanism creates the initial session (via `SessionInjector`).

---

### 14. No admin auth / admin endpoints

**Spec:** "Some administrative XRPC endpoints require authentication with admin privileges. The current scheme for this is to use HTTP Basic authentication with user 'admin' and a fixed token." Endpoints include `com.atproto.admin.*`, `com.atproto.server.createInviteCode(s)`.

**Impl:** No admin endpoints implemented. No admin auth middleware. `describeServer` returns `inviteCodeRequired: false`.

**Impact:** No moderation capabilities (takedowns, account actions, invite code management). Acceptable for dev/single-tenant but insufficient for production PDS.

---

### 15. Account DIDs are `did:key`, not `did:plc`

**Spec:** AT Protocol uses DIDs as persistent identifiers. `did:plc` is the primary DID method in the ecosystem, supporting key rotation and service endpoint updates.

**Impl:** `createAccount` generates a secp256k1 keypair and uses `kp.did()` → `did:key:z...`. No PLC directory interaction. `did:key` embeds the public key directly in the DID — no rotation possible.

**Impact:** Account DIDs cannot rotate keys or change PDS hosting. `did:key` DIDs are valid AT Protocol DIDs but lack the operational flexibility of `did:plc`.

---

### 16. `signServiceAuth` JWT — missing `kid` header

**Spec:** Inter-service auth JWTs require:
- `typ: "JWT"` (intending to update to more specific value)
- `kid` header (optional, defaults to `#atproto`): "Corresponds to identifier fragment in DID document"

**Impl:** `signJwt` in `account-store.ts` and `atproto-oauth-server-deno/mod.ts`:
```typescript
const header = { typ: "JWT", alg: "ES256K" };
```
No `kid` header field.

**Impact:** Verifiers cannot identify which verification method in the DID document was used. Mitigated by `kid` defaulting to `#atproto` and there being typically only one atproto key.

---

### 17. `prev` field in commits — conditionally omitted (minor)

**Spec:** "In version 3 repos, this field must exist in the CBOR object, but is virtually always null. NOTE: previously specified as nullable and optional, but this caused interoperability issues."

**Impl:** `commitToObj` in `repo.ts:29`:
```typescript
prev: commit.prev !== null ? cidLink(commit.prev) : null,
```
Field is always present in the CBOR object (null when no previous commit). **This is correct.**

**Verdict:** ✅ Compliant.

---

### 18. `version` field — fixed at 3

**Spec:** "fixed value of 3 for this repo format version"

**Impl:** `repo.ts:269`: `version: 3`. **Correct.**

**Verdict:** ✅ Compliant.

---

### 19. `rev` monotonicity — TID-based

**Spec:** "Must increase monotonically. Recommend using current timestamp as TID."

**Impl:** Uses `nextTid()` which tracks `lastMicros` for monotonicity within process. **Directionally correct** but restart loses the last-micros tracker (generates new TID from wall clock, could regress if clock moved backward).

**Verdict:** ⚠️ Mostly compliant. Clock regression after restart could produce non-monotonic revs.

---

### 20. CAR file serialization

**Spec:** CARv1 format. "The first element of the CAR roots metadata array must be the CID of the most relevant Commit object."

**Impl:** `buildCarSlice` produces CARv1 with `{ roots: [], version: 1 }` — **roots array is always empty.**

```typescript
// repo.ts:308
const header = cborEncode({ roots: [], version: 1 });
```

**Impact:** CAR slices in firehose frames have empty roots. Spec-compliant consumers expecting the commit CID in `roots[0]` will not find it. The commit CID is present in the frame's `commit` field, but the CAR file itself is non-conformant.

---

### 21. ops array length — no limit check

**Spec:** The spec mentions a limit (200 operations per commit).

**Impl:** `applyWrites` processes all writes in the array. No validation of `writes.length`.

**Impact:** Could exceed the 200-op limit, producing commits rejected by spec-compliant relays.

---

### 22. Commit data CID — no `$type` field

**Spec:** "In atproto, object nodes often include a string field `$type` that specifies their Lexicon schema."

**Impl:** Commit objects do not include `$type`. The commit is not a lexicon-defined record, so this may be intentional. The spec is ambiguous on whether commits require `$type`.

**Verdict:** ⚠️ Unclear. May be fine for v3 commits.

---

## Low (non-breaking deviations)

### 23. `describeServer` response — inviteCodeRequired

**Spec:** Required field.

**Impl:** Returns `inviteCodeRequired: false`. ✅ Compliant for dev/no-invite mode.

---

### 24. `availableUserDomains` — empty array

**Spec:** Required field in `describeServer`.

**Impl:** Returns `availableUserDomains: []`. ✅ Compliant for single-user PDS.

---

### 25. CORS enabled globally

**Spec:** Not specified but expected for browser clients.

**Impl:** `app.use("*", cors())`. ✅ Good practice.

---

### 26. Well-known endpoints

| Endpoint | Spec | Impl | Status |
|----------|------|------|--------|
| `/.well-known/atproto-did` | Returns DID as text | ✅ implemented | Compliant |
| `/.well-known/did.json` | DID doc with verificationMethod + service | ✅ implemented | Compliant |
| `/.well-known/oauth-protected-resource` | RFC 8707 | ✅ conditional (oauthServer) | Compliant |
| `/.well-known/oauth-authorization-server` | RFC 8414 | ✅ conditional (oauthServer) | Compliant |

---

## Summary

| Severity | Count | Key Items |
|----------|-------|-----------|
| Critical | 4 | DAG-CBOR not DRISL, JSON not CBOR firehose, wrong commit signing bytes, CID codec mismatch |
| High | 6 | Missing firehose event types, missing frame fields, missing refreshSession, JWT typ wrong, no signature verification, missing uploadBlob |
| Medium | 7 | Missing identity endpoints, single-tenant only, OAuth partial, no admin endpoints, did:key not did:plc, missing kid header, empty CAR roots |
| Low | 4 | Minor deviations in describeServer, availableUserDomains, well-known endpoints |

**Core root cause:** The DAG-CBOR vs DRISL codec mismatch propagates into every CID, every commit signature, and every MST node. Without fixing this, the PDS produces repos that are self-consistent internally but unverifiable by any other AT Protocol implementation. This is the first thing that must be addressed.

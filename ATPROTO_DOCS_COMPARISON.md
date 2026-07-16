# AT Protocol Docs vs Implementation Comparison

Cross-referenced against `atproto.com/specs/*` via atproto-docs MCP (kapa.ai index).

---

## 1. DRISL Codec Byte → **WRONG. `0x72` must be `0x71`**

**Spec (Data Model):** "Codec: DRISL (0x71; also known as dag-cbor) for links to DRISL-CBOR data objects"

**Spec (Commit Objects):** "The DRISL CBOR (not 'raw') codec should be used for CIDs linking to commit objects."

**Our code:** `lib/common/cid.ts` defines `DRISL_CBOR_CODEC = 0x72` and `cidFromDigestDrisl()` uses it for commit CIDs.

**Verdict:** DRISL and DAG-CBOR share multicodec `0x71`. The difference is normalization rules, not the codec byte. Our `0x72` codec is non-existent — no AT Protocol implementation will recognize these CIDs. **Fix: remove `0x72`, keep `0x71` for ALL CIDs. Remove `cidFromDigestDrisl` — use existing `cidFromDigest` for everything.**

---

## 2. Commit Signing → **MOSTLY CORRECT**

**Spec:** "serialize the unsigned commit with DRISL CBOR. The output bytes are then hashed with SHA-256, and the binary hash output is then signed using the current signing key"

**Our code:** `drislEncode(commitToObj(unsigned))` → `signer.sign(bytes)`. `signer.sign()` from `@atproto/crypto` hashes with SHA-256 internally before ECDSA sign. This is correct — the sign primitive always hashes first for secp256k1.

**Verdict:** ✅ Correct. The spec's "hash then sign" describes the full crypto operation. Our `sign()` call does this internally. Just need to use `0x71` codec for the CID.

---

## 3. Firehose Wire Format → **WRONG**

**Spec (Event Stream):** "Every event on the wire is two concatenated CBOR values: header `{op: 1, t: "#commit"}` concatenated with body CBOR per lexicon shape"

**Our code:** Sends a SINGLE CBOR object — the frame body directly via `ws.send(drislEncode(frame))`. No header CBOR object. No `{op: 1, t: "#commit"}` prefix.

**Spec details:**
- Header fields: `op` (int, 1=message, -1=error), `t` (string, `#commit`/`#identity`/`#account`/`#sync`/`#info`)
- Body: the lexicon-shaped CBOR with `$type` omitted (already indicated in header)
- Messages have 5 MB hard size limit
- `#sync` is not emitted in v1 — only `#commit`, `#identity`, `#account`, `#info`

**Verdict:** ❌ Wire-incompatible. Need to prepend CBOR header `{op: 1, t: "#commit"}` before each frame body.

---

## 4. Event Stream Backfill → **PARTIAL**

**Spec:** (1) Replay historical events with `seq > cursor`, (2) Join live fanout, (3) Send `#info` with name `OutdatedCursor` when cursor is too old, (4) Close connection with `1011 Internal Error` on overflow

**Our code:** `backfill(cursor)` then `live()` — correct replay+live pattern. BUT: no `#info OutdatedCursor` when cursor older than retained backlog; no per-subscriber bounded channel; no overflow handling.

**Verdict:** ⚠️ Core mechanism correct but missing edge cases: outdated cursor signaling, backpressure.

---

## 5. OAuth Authorization Server Metadata → **INCOMPLETE**

**Spec:** `/.well-known/oauth-authorization-server` MUST include:
- `token_endpoint_auth_methods_supported: ["none", "private_key_jwt"]` ← we have only `["none"]`
- `token_endpoint_auth_signing_alg_values_supported: ["ES256"]` ← **MISSING**
- `authorization_response_iss_parameter_supported: true` ← **MISSING**
- `client_id_metadata_document_supported: true` ← **MISSING**
- `require_request_uri_registration` default `true` (only need to set if `false`)
- `dpop_bound_access_tokens_supported: true` ← **MISSING**

**Our code:** `factory.ts` returns a subset. Missing 4 required fields + `private_key_jwt` auth method.

**Verdict:** ❌ Spec-compliant clients checking these fields will reject the server. Add missing fields.

---

## 6. OAuth PAR → **NOT IMPLEMENTED**

**Spec:** PAR is MANDATORY ("Authorization Servers must support PAR"). Endpoint: `pushed_authorization_request_endpoint`.

**Our code:** Well-known advertises the PAR endpoint but no route exists.

**Verdict:** ❌ PAR endpoint declared but not served. Either implement PAR or remove from well-known.

---

## 7. OAuth Authorization Interface → **NOT IMPLEMENTED**

**Spec:** "The Authorization Server must implement a web interface for users to authenticate with the server, approve Authorization Requests, and manage active sessions."

**Our code:** No web UI at all. `/oauth/authorize` is a programmatic API-only endpoint.

**Verdict:** ❌ Complete OAuth flow requires a browser-based authorization interface. Missing HTML consent screen, sign-in form, session management UI.

---

## 8. Legacy Auth JWT → **PARTIALLY FIXED**

**Spec:** "access tokens should use `at+jwt`, and refresh tokens should use `refresh+jwt`"

**Our code:** ✅ Fixed in Phase 4 — `signJwt` uses correct typ values. Service auth stays `"JWT"` which matches spec.

**Spec:** "Clients should treat the tokens as opaque string tokens: the JWT fields and semantics are not a stable part of the specification."

**Our code:** `validateAccessJwt` parses JWT internals (sub, handle, exp). This is implementation-specific — acceptable for legacy auth but the spec warns against relying on JWT structure stability.

**Verdict:** ✅ typ headers correct now. JWT parsing for legacy auth is acceptable.

---

## 9. Admin Auth → **CORRECT**

**Spec:** "HTTP Basic authentication with user 'admin' and a fixed token in the password field"

**Our code:** `requireAdminAuth` middleware checks `Basic base64(admin:password)` — matches spec exactly.

**Required admin endpoints:** `com.atproto.admin.*`, `com.atproto.server.createInviteCode`, `com.atproto.server.createInviteCodes`

**Our code:** `createInviteCode`, `createInviteCodes`, `admin.getInviteCodes` (stub) — all admin-protected.

**Verdict:** ✅ Admin auth mechanism correct. Routes match spec requirements.

---

## 10. PDS Feature Gap Analysis

| Feature | Spec Requires | Our Status |
|---------|-------------|------------|
| Account signup | ✅ | ✅ `createAccount` |
| Account deletion | ✅ (lifecycle) | ❌ Not implemented |
| Account migration | ✅ (CAR import/export) | ⚠️ CAR export exists, import/migration flow not implemented |
| Email verification | ✅ | ❌ Not implemented |
| Password reset flow | ✅ | ❌ Not implemented |
| App passwords | ✅ (xxxx-xxxx-xxxx-xxxx) | ❌ Not implemented |
| Blob storage/upload | ✅ | ❌ `uploadBlob` not implemented |
| Blob enumeration | ✅ | ❌ Not implemented |
| Lexicon validation | ✅ (with override option) | ❌ Not implemented |
| Service proxying (`atproto-proxy` header) | ✅ | ❌ Not implemented |
| Handle management (base domain) | ✅ | ❌ `resolveHandle`/`updateHandle` lexicon registered, no route |
| PLC operations | ✅ (validate, sign, submit) | ⚠️ did:plc creation in createAccount (Phase 6), no rotation/update |
| Secret key management | ✅ (atproto + PLC rotation) | ⚠️ Single keypair, no rotation |
| OAuth web sign-in page | ✅ | ❌ No browser UI |
| OAuth session management UI | ✅ | ❌ No management interface |
| `#identity` events | ✅ | ✅ Stub method added (Phase 3) |
| `#account` events | ✅ | ✅ Stub method added (Phase 3) |
| `#sync` events | Spec says "not emitted in v1" | N/A |
| MST diff generation | ✅ | ✅ `diff()` function |
| CAR import/export | ✅ | ✅ `exportCar()`/`importCar()` exist |
| `com.atproto.sync.getRepo` | ✅ | ✅ Implemented |
| `com.atproto.sync.getLatestCommit` | ✅ | ✅ Implemented |
| `com.atproto.sync.getRecord` | ✅ | ✅ Implemented |
| `com.atproto.sync.subscribeRepos` | ✅ | ⚠️ Implemented but wrong wire format |
| `com.atproto.sync.listRepos` | ❌ (relay responsibility) | Not a PDS requirement |
| `com.atproto.sync.requestCrawl` | ✅ | ✅ Debounced notifications to crawlers |

---

## 11. Data Model Correctness

**Spec:** CID format — version 1 (0x01), codec 0x71 (DRISL/DAG-CBOR), hash SHA-256 (0x12), digest 32 bytes (0x20), multibase base32 prefix `b`

**Our code:** ✅ Correct after reverting `0x72` → `0x71`.

**Spec:** CBOR tag 42 for CID links, `0x00` prefix byte before raw CID bytes

**Our code:** ✅ Both `dag-cbor.ts` and `drisl-cbor.ts` implement tag 42 with `0x00` prefix.

**Spec:** "No floats", "always sort the keys in a dict" (length-then-lexicographic)

**Our code:** ✅ Both codecs enforce no-floats and deterministic key sort.

---

## Immediate Fix Priority

1. **CRITICAL:** Revert `0x72` → `0x71`. Remove `cidFromDigestDrisl`. Use `cidFromDigest` for all CIDs. This is a one-line conceptual fix across ~5 files.
2. **CRITICAL:** Fix firehose wire format — prepend `{op:1, t:"#commit"}` CBOR header before each frame body.
3. **HIGH:** Add 5 missing OAuth AS metadata fields to well-known response.
4. **HIGH:** Implement PAR endpoint or remove from well-known advertisement.
5. **MEDIUM:** Add `private_key_jwt` support to token endpoint auth methods.

# Changes on `open-architecture/hono-pds--fix-crawler-announce-retries`

The requirement-level delta against `open-architecture/hono-pds`, and what this branch realized.

## Requirements

### hono-pds

- intent: "" -> "This context covers the wiring layer that turns process-level options into a running PDS instance in hono-pds: it owns keypair import or generation, Deno KV storage creation, parsing and normalisation of the did-web-services JSON and crawler list, and the createRepoFactory call that assembles the repository factory. It exists so the configuration surface (CreateFromEnvOptions) and the server lifecycle (StartOptions / StartResult, the start helper) can be exercised directly in tests and embedded by other launchers such as the worker-launcher script, without going through a CLI flag parser."
- added `r.crawlers-normalised` (MUST): "createFromEnv must derive the crawlers value from opts.crawlersStr by splitting on commas, trimming each entry, dropping empty entries and de-duplicating the remainder, and must pass undefined when the option is absent."
- added `r.default-logger` (SHOULD): "createFromEnv and start must use opts.log when supplied and otherwise fall back to the module-level defaultLog, so logging is never undefined at the call sites."
- added `r.did-web-services-parse` (MUST): "createFromEnv must JSON-parse opts.didWebServicesStr into the didWebServices array when the string is present, and on a parse failure must log a warn that the JSON was ignored and leave the array empty rather than throwing."
- added `r.factory-wiring` (MUST): "createFromEnv must build the RepoFactory via createRepoFactory with Deno KV storage, the signer produced from the keypair, publicKeyDid set to the signer DID, publicHostname from opts, the normalised crawlers, didWebServices only when the parsed list is non-empty, and an enabled OAuth server whose issuer is http://127.0.0.1:2583."
- added `r.keypair-import-or-generate` (MUST): "createFromEnv must import a Secp256k1 keypair from opts.keyHex when it is set, and otherwise create a fresh keypair and emit a warn-level log entry carrying the generated DID before continuing."
- added `r.start-options-superset` (MUST): "StartOptions must carry the required port and hostname for the HTTP bind plus the optional keyHex, didWebServicesStr, publicHostname, crawlersStr and log fields, and must be accepted directly as the CreateFromEnvOptions argument to createFromEnv."
- added `r.start-serves-app` (MUST): "start must create the repo through createFromEnv with the StartOptions, serve repo.app.fetch with Deno.serve bound to options.port and options.hostname, log an info entry with the port in the onListen callback, and return a StartResult carrying app, server, repo and port."

### lib-abc-atproto-oauth-server

- intent: "" -> "This context exists to fix the shape of OAuth server state handling without committing to any transport or storage mechanism. By declaring IssueTokenParams, IssueTokenResult, TokenValidation, TokenStore, InjectedSession, SessionInjector, DpopProofValidation, DpopVerifier, and DpopNonceStore as pure interfaces with no imports of fetch, crypto, timers, or Deno APIs, it lets concrete impl packages (such as lib/atproto-oauth-server-deno) be swapped in behind a stable contract. It is the dependency boundary that the rest of the OAuth server code compiles against, and it carries the DPoP binding requirement: tokens are tied to a client key thumbprint (jkt) at issue time and re-checked at validation and proof-verification time."
- added `r.dpop-nonce-issue-verify` (MUST): "DpopNonceStore issues a nonce for an origin and verifies a supplied nonce against that origin, resolving the verification to a boolean so callers can reject replayed or foreign-origin proofs."
- added `r.dpop-verify-proof` (MUST): "DpopVerifier.verifyProof takes the serialized proof, the HTTP method, the request URL, and an optional access token, and resolves to a DpopProofValidation stating the jkt and jti, or to null when the proof does not verify."
- added `r.inject-session` (MUST): "SessionInjector.injectSession takes a user DID, handle, and optional scope, and resolves to an InjectedSession pairing the OAuthSessionData with the CryptoKeyPair used for DPoP."
- added `r.injected-session-shape` (MUST): "InjectedSession holds the session data typed as OAuthSessionData alongside the DPoP CryptoKeyPair, so the caller can both persist the session and sign subsequent DPoP proofs with the same key."
- added `r.issue-token-params-binding` (MUST): "IssueTokenParams carries the user DID, handle, an optional scope, and a required jkt — the SHA-256 thumbprint of the client DPoP public key — so an issued token is bound to one specific client DPoP key."
- added `r.pure-interfaces-no-io` (MUST): "The module declares only pure interfaces and must import no I/O or runtime primitives — no fetch, no crypto, no timers, no Deno.* — so any implementation package can satisfy the contracts."
- added `r.token-store-issue` (MUST): "TokenStore.issue accepts IssueTokenParams and resolves to an IssueTokenResult containing the access token, refresh token, and expiry in seconds."
- added `r.token-store-refresh` (MUST): "TokenStore.refresh takes a refresh token and resolves to a fresh IssueTokenResult, or to null when the refresh token is unknown or unusable."
- added `r.token-store-revoke` (MUST): "TokenStore.revoke takes a token and resolves to void, invalidating it without reporting a result."
- added `r.token-store-validate` (MUST): "TokenStore.validate takes an access token and resolves either to a TokenValidation exposing sub, optional handle, scope, and jkt, or to null when the token is not valid, rather than throwing."

### lib-abc-atproto-repo

- intent: "" -> "This context exists to fix the interface contract that every concrete AT Protocol repo transport implements against, so storage backends, signers, and XRPC handlers can be swapped without touching repo semantics. It separates the abstract layer (types, MST algorithm) from the Deno/KV/IndexedDB and Hono implementations that live in sibling packages, and it pins the error shape (XrpcError) that handlers serialize onto the wire."
- added `r.abc-layer-isolation` (SHOULD): "The MST implementation depends only on the abstract BlockStore and Hasher contracts and performs no I/O beyond them, keeping this layer free of any concrete database or HTTP transport."
- added `r.block-diff-and-collect` (MUST): "diff returns the Cids of blocks reachable from the new root but not from the old root, giving a sync peer exactly the blocks it is missing, and collect walks a tree from a Cid accumulating every reachable Cid into a caller-supplied Set."
- added `r.create-mst-factory` (MUST): "createMst builds an Mst from a BlockStore and a Hasher with an optional root Cid, so callers open a tree through one factory instead of the constructor."
- added `r.did-identifier` (MUST): "Did is a plain string alias naming a repository account, and every contract that identifies a repo (signing, verification, head lookup) takes a Did rather than an untyped string."
- added `r.mst-content-addressed` (MUST): "Mst stores a key to Cid map as an immutable tree of blocks inside a BlockStore, hashing nodes through an injected Hasher, and is constructed from a store, a hasher and a nullable root Cid so an existing tree can be reopened from its root."
- added `r.mst-entries-stream` (MUST): "Mst.entries walks the tree lazily as an AsyncIterable of key/value pairs, so a large tree is enumerated without materializing every entry at once."
- added `r.mst-init` (MUST): "Mst.init loads the tree from its BlockStore before use, so subsequent reads and writes operate on nodes that have already been fetched."
- added `r.mst-read-write-delete` (MUST): "Mst.get returns the Cid stored for a key or null when the key is absent; Mst.set inserts or replaces the key and returns the new root Cid; Mst.delete removes the key and returns the previous root Cid, or null when the key was not present."
- added `r.mst-root-and-size` (MUST): "Mst.root returns the current root Cid, or null when the tree is empty, and Mst.size returns the number of key entries held."
- added `r.signer-and-verifier` (MUST): "Signer reports its own did and signs a byte string into a signature; Verifier independently checks a signature against a did and the signed bytes and answers with a boolean, so commit signing and verification are separable roles."
- added `r.single-entrypoint` (MUST): "mod.ts is the package's single public entrypoint and re-exports both the contract types from contracts.ts and the MST implementation from mst.ts, so consumers import the package once."
- added `r.storage-boundaries` (MUST): "BlockStore is the content-addressed block boundary keyed by Cid and Storage layers record persistence above it, while RepoStore records each repo's head as a commit Cid paired with a rev Tid, returning null from getHead when a repo has no head yet and overwriting it through setHead."
- added `r.write-path` (SHOULD): "CommitOp, CommitEvent, SequencedFrame, Sequencer and WriteOp describe the repo write path — an operation, the commit event it produces, the frame the sequencer emits, and the operation requested by a client — and RepoApi is the surface a transport exposes for those writes."
- added `r.xrpc-error-shape` (MUST): "XrpcError carries an XrpcErrorName and a message, and its toJSON produces exactly { error, message } so handlers can serialize it as an AT Protocol XRPC error body."
- added `r.xrpc-error-status-optional` (SHOULD): "The HTTP status is optional when constructing an XrpcError, so an error can be raised before a transport has decided a status code for it."

## Realization

| change | direction | phase | commit | verify | acceptance |
| --- | --- | --- | --- | --- | --- |
| hono-pds-c2s-fa8920306bc4-fa8920306bc4 | CodeToSpec | Succeeded |  | 0 | - |
| lib-abc-atproto-oauth-server-c2s-fa8920306bc4-fa8920306bc4 | CodeToSpec | Succeeded |  | 0 | - |
| lib-abc-atproto-repo-c2s-fa8920306bc4-fa8920306bc4 | CodeToSpec | Succeeded |  | 0 | - |
| lib-atproto-oauth-server-deno-c2s-fa8920306bc4-fa8920306bc4 | CodeToSpec | Running |  | 0 | - |
| lib-atproto-repo-deno-c2s-fa8920306bc4-fa8920306bc4 | CodeToSpec | Running |  | 0 | - |

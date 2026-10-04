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

## Realization

| change | direction | phase | commit | verify | acceptance |
| --- | --- | --- | --- | --- | --- |
| hono-pds-c2s-fa8920306bc4-fa8920306bc4 | CodeToSpec | Succeeded |  | 0 | - |
| lib-abc-atproto-oauth-server-c2s-fa8920306bc4-fa8920306bc4 | CodeToSpec | Succeeded |  | 0 | - |
| lib-abc-atproto-repo-c2s-fa8920306bc4-fa8920306bc4 | CodeToSpec | Running |  | 0 | - |
| lib-atproto-oauth-server-deno-c2s-fa8920306bc4-fa8920306bc4 | CodeToSpec | Running |  | 0 | - |

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

## Realization

| change | direction | phase | commit | verify | acceptance |
| --- | --- | --- | --- | --- | --- |
| hono-pds-c2s-fa8920306bc4-fa8920306bc4 | CodeToSpec | Succeeded |  | 0 | - |
| lib-abc-atproto-oauth-server-c2s-fa8920306bc4-fa8920306bc4 | CodeToSpec | Running |  | 0 | - |
| lib-abc-atproto-repo-c2s-fa8920306bc4-fa8920306bc4 | CodeToSpec | Running |  | 0 | - |

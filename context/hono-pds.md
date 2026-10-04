# Context: hono-pds

Repository: `hono-pds`

This context covers the wiring layer that turns process-level options into a running PDS instance in hono-pds: it owns keypair import or generation, Deno KV storage creation, parsing and normalisation of the did-web-services JSON and crawler list, and the createRepoFactory call that assembles the repository factory. It exists so the configuration surface (CreateFromEnvOptions) and the server lifecycle (StartOptions / StartResult, the start helper) can be exercised directly in tests and embedded by other launchers such as the worker-launcher script, without going through a CLI flag parser.

_The resolved code references are regenerated on every run. Cite the ids above rather than writing them here._

<!-- SPECD_MANAGED_BEGIN -->
## Resolved code references

- `file:main.ts` file main.ts (main.ts)
- `function:6d4615056e267ea626ccfe4721e8c7e9` function createFromEnv (main.ts)
- `function:801fee3a6255e197b1fd30a72241ed54` function start (main.ts)
- `interface:320a7c33d923f7e0048407e6a52e340d` interface StartResult (main.ts)
- `interface:9e33edf403a8421c9005065417701a8b` interface CreateFromEnvOptions (main.ts)
- `interface:aa5b00cd4b1a22b790ac1a9fd4dbebcb` interface StartOptions (main.ts)
<!-- SPECD_MANAGED_END -->

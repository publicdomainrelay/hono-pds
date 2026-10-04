# Context: lib-hono-factory-atproto-repo-deno-lexicons

Repository: `hono-pds`

This context exists so the factory layer can resolve an NSID to its full lexicon document at runtime without embedding schema copies. It gives the Deno atproto repo implementation one typed, read-only lookup over the com.atproto lexicons it serves - repo read/write (createRecord, getRecord, listRecords, uploadBlob, describeRepo), sync (subscribeRepos), server session and account methods (describeServer, createAccount, createSession, refreshSession), and identity methods (resolveHandle, updateHandle) - so request validation and response shaping can be driven by the stored JSON schemas rather than hardcoded shapes.

_The resolved code references are regenerated on every run. Cite the ids above rather than writing them here._

<!-- SPECD_MANAGED_BEGIN -->
## Resolved code references

- `file:lib/hono-factory-atproto-repo-deno/lexicons/index.ts` file index.ts (lib/hono-factory-atproto-repo-deno/lexicons/index.ts)
- `function:6103e9664172adb5c144151e19db4ac0` function getLexicon (lib/hono-factory-atproto-repo-deno/lexicons/index.ts)
- `interface:e9404607f25e4bff7a872f8c957e6cc5` interface LexiconSchema (lib/hono-factory-atproto-repo-deno/lexicons/index.ts)
<!-- SPECD_MANAGED_END -->

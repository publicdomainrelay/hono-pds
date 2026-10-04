# Context: test-atproto-repo-deno

Repository: `hono-pds`

These tests exist to pin down the observable behavior of the Repo API and its storage backends so that changes to the MST, commit, or storage layers cannot silently break record durability, pagination, or head tracking. The concurrency test in particular exists because a commit is a read-modify-write over the repo head: without serialization, interleaved applyWrites build the MST from the same root and the last setHead silently drops the other's records while still reporting success. The suite is the executable contract the lib layer must satisfy.

_The resolved code references are regenerated on every run. Cite the ids above rather than writing them here._

<!-- SPECD_MANAGED_BEGIN -->
## Resolved code references

- `file:test/atproto-repo-deno/repo_test.ts` file repo_test.ts (test/atproto-repo-deno/repo_test.ts)
- `file:test/atproto-repo-deno/storage_test.ts` file storage_test.ts (test/atproto-repo-deno/storage_test.ts)
<!-- SPECD_MANAGED_END -->

# Context: test

Repository: `hono-pds`

This context exists to pin down what the repository's automated tests actually assert, so that implementation changes elsewhere in hono-pds can be checked against the contracts the suite already enforces. It is the executable definition of the PDS's external surface as the tests see it: the CLI must start and accept `--help`, the health route must answer over HTTP with a version string, and the record-write path must accept an account creation, a service-auth JWT scoped to the PDS DID, and a `createRecord` call, returning the created record's URI and CID. It also fixes the test harness conventions — ephemeral ports, deterministic teardown, per-test keypairs — that keep the suite hermetic and cheap to run in CI.

_The resolved code references are regenerated on every run. Cite the ids above rather than writing them here._

<!-- SPECD_MANAGED_BEGIN -->
## Resolved code references

- `file:test/cli_smoke_test.ts` file cli_smoke_test.ts (test/cli_smoke_test.ts)
- `file:test/integration_test.ts` file integration_test.ts (test/integration_test.ts)
<!-- SPECD_MANAGED_END -->

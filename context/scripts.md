# Context: scripts

Repository: `hono-pds`

This context exists to keep the PDS compute isolated from its transport: the application and its storage run inside a Deno Worker with an explicit, minimal permission set, while the main thread owns the network and the CLI surface. createPdsSandbox is the seam that lets tests and scripts drive the full PDS through a normal fetch(Request) API without the worker ever touching the network itself, and worker-launcher.ts is the compute-only counterpart that speaks the init/request/shutdown message protocol. run-worker.ts and bundle.sh exist so the same sandbox can be exercised interactively, served over HTTP for local use, or bundled into a single deployable artifact.

_The resolved code references are regenerated on every run. Cite the ids above rather than writing them here._

<!-- SPECD_MANAGED_BEGIN -->
## Resolved code references

- `file:scripts/run-worker.ts` file run-worker.ts (scripts/run-worker.ts)
- `file:scripts/sandbox.ts` file sandbox.ts (scripts/sandbox.ts)
- `file:scripts/worker-launcher.ts` file worker-launcher.ts (scripts/worker-launcher.ts)
- `function:1e8a394a85efb094e83417600cb5d9c6` function createPdsSandbox (scripts/sandbox.ts)
- `function:7c88be26c839763d478fc66921bff4ad` function fetch (scripts/sandbox.ts)
- `function:de2941b3a7c432edebcb7aedc17dacfd` function shutdown (scripts/sandbox.ts)
- `interface:76792809058bca60ee2f8020cd282718` interface PdsSandbox (scripts/sandbox.ts)
<!-- SPECD_MANAGED_END -->

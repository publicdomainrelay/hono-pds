# Context: test-conformance

Repository: `hono-pds`

This context exists to prove, mechanically, that the PDS implementation conforms to AT Protocol XRPC and repo semantics at the boundaries that clients actually observe: the HTTP route surface, the signed commit and CBSE/CBOR wire encoding, the firehose frame stream, the documented OAuth and PDS fixes, and the sandboxed production target. It is the executable contract that the sc.* implementation contexts must satisfy, and the reason a change to the factory, storage, sequencer or sandbox cannot silently drift from the spec.

_The resolved code references are regenerated on every run. Cite the ids above rather than writing them here._

<!-- SPECD_MANAGED_BEGIN -->
## Resolved code references

- `file:test/conformance/commit-conformance.test.ts` file commit-conformance.test.ts (test/conformance/commit-conformance.test.ts)
- `file:test/conformance/crud-conformance.test.ts` file crud-conformance.test.ts (test/conformance/crud-conformance.test.ts)
- `file:test/conformance/docs-compliance.test.ts` file docs-compliance.test.ts (test/conformance/docs-compliance.test.ts)
- `file:test/conformance/firehose-conformance.test.ts` file firehose-conformance.test.ts (test/conformance/firehose-conformance.test.ts)
- `file:test/conformance/sandbox-conformance.test.ts` file sandbox-conformance.test.ts (test/conformance/sandbox-conformance.test.ts)
<!-- SPECD_MANAGED_END -->

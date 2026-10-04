# Context: test-common

Repository: `hono-pds`

This context exists to pin down the observable behaviour of the lowest-level shared primitives — byte codecs, CIDs, CBOR codecs, TIDs — that every higher layer of the PDS (repo blocks, MST nodes, record serialization, record keys) is built on. It is the contract test for those primitives: any change to encoding, digest handling, link representation or determinism that would break repo or wire compatibility fails here first, and because the tests import the common package by name they also guard the package's public export list.

_The resolved code references are regenerated on every run. Cite the ids above rather than writing them here._

<!-- SPECD_MANAGED_BEGIN -->
## Resolved code references

- `file:test/common/bytes_test.ts` file bytes_test.ts (test/common/bytes_test.ts)
- `file:test/common/cid_test.ts` file cid_test.ts (test/common/cid_test.ts)
- `file:test/common/dag-cbor_test.ts` file dag-cbor_test.ts (test/common/dag-cbor_test.ts)
- `file:test/common/drisl_cbor_test.ts` file drisl_cbor_test.ts (test/common/drisl_cbor_test.ts)
- `file:test/common/tid_test.ts` file tid_test.ts (test/common/tid_test.ts)
<!-- SPECD_MANAGED_END -->

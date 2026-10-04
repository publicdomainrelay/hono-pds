# Context: test-hono-factory

Repository: `hono-pds`

This context exists to pin the observable HTTP and API behaviour of the repo factory: that its XRPC routes answer with AT Protocol-shaped payloads (uri plus cid on writes, value on reads, collections plus head on describeRepo, cursor on paginated lists), that its subscribe handler delivers a SequencedFrame carrying the committed ops and can be disposed, and that write responses report the record CID rather than the commit CID so that strongRefs built from a write address the same bytes a later getRecord or listRecords returns. It is the regression net for the factory's public surface, including the fix that createRecord and putRecord no longer answer with the commit CID, and it is the place a change to factory routing, auth, or CID reporting is expected to show up as a failing test.

_The resolved code references are regenerated on every run. Cite the ids above rather than writing them here._

<!-- SPECD_MANAGED_BEGIN -->
## Resolved code references

- `file:test/hono-factory/e2e_test.ts` file e2e_test.ts (test/hono-factory/e2e_test.ts)
<!-- SPECD_MANAGED_END -->

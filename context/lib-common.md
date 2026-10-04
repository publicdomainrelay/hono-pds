# Context: lib-common

Repository: `hono-pds`

This context exists to pin down the lowest layer of the repo so every other package can depend on one definition of bytes, CIDs, DAG-CBOR, TIDs and subscription callbacks instead of re-deriving them. It is pure data-format code: no I/O, no config, no Hono. Anything in the repo that needs to hash, encode, or order identifiers imports from here, so the invariants below — codec round-trips, CID validation, TID monotonicity and ordering, DAG-CBOR link tagging — are the contract the rest of the system relies on.

_The resolved code references are regenerated on every run. Cite the ids above rather than writing them here._

<!-- SPECD_MANAGED_BEGIN -->
## Resolved code references

- `file:lib/common/bytes.ts` file bytes.ts (lib/common/bytes.ts)
- `file:lib/common/cid.ts` file cid.ts (lib/common/cid.ts)
- `file:lib/common/dag-cbor.ts` file dag-cbor.ts (lib/common/dag-cbor.ts)
- `file:lib/common/drisl-cbor.ts` file drisl-cbor.ts (lib/common/drisl-cbor.ts)
- `file:lib/common/mod.ts` file mod.ts (lib/common/mod.ts)
- `file:lib/common/subscribe-types.ts` file subscribe-types.ts (lib/common/subscribe-types.ts)
- `file:lib/common/tid.ts` file tid.ts (lib/common/tid.ts)
- `function:01c98d3a332fbbf7eb0235c431cb8a72` function hexEncode (lib/common/bytes.ts)
- `function:0f5bb9fbeaea51e0ed9695514c4cff46` function parseTid (lib/common/tid.ts)
- `function:17133f0ecd019ece0b7865268773e6cd` function cidDigest (lib/common/cid.ts)
- `function:227950df02ace808ee9d20754ad7397f` function isValidTid (lib/common/tid.ts)
- `function:227d7666fdd45b742ef3af7c92dfc6ee` function isCidLink (lib/common/dag-cbor.ts)
- `function:24748c1afdcced17ac675c4b3a27714f` function nextTid (lib/common/tid.ts)
- `function:4572442dfcba55aa00003f0c97b8f9de` function base64Decode (lib/common/bytes.ts)
- `function:524e4abef36ca7c2474670680ced7739` function bytesEqual (lib/common/bytes.ts)
- `function:55685ba8bbe657ba51874ac7b87cf527` function utf8Encode (lib/common/bytes.ts)
- `function:715632c4c02e805c4fddf2c3c53f8365` function encode (lib/common/dag-cbor.ts)
- `function:9f66c4b3aa766d98b237b1b2732672bc` function base32Encode (lib/common/bytes.ts)
- `function:a484eb570c93476518efcecf4c14139b` function cidFromDigest (lib/common/cid.ts)
- `function:a9cd82ca460c103d42d9a8119893325d` function resetClockId (lib/common/tid.ts)
- `function:ab529efcf58f550a1fa9ee9812b3182e` function concat (lib/common/bytes.ts)
- `function:ad71575387e43d8ea0fc5fc55115b874` function cidToBytes (lib/common/cid.ts)
- `function:afb689bb3b7a1f7bedb035285a03a235` function cidLink (lib/common/dag-cbor.ts)
- `function:b2cf9899ec95c445e72b05ee3e51aff1` function cidEquals (lib/common/cid.ts)
- `function:bedbccfced7ce19d9df8d264e9d5f28f` function decode (lib/common/dag-cbor.ts)
- `function:c2c1d8ea15e2a84502dd41bb0c7117af` function base32Decode (lib/common/bytes.ts)
- `function:cbf5c2696667b12cfdeed24e0a090ddf` function tidFromTime (lib/common/tid.ts)
- `function:d1582016bd9fbd5cef48a212d75a077b` function cidFromLink (lib/common/dag-cbor.ts)
- `function:d2b6a53592dcd51bc62f2e8c817006b1` function hexDecode (lib/common/bytes.ts)
- `function:d444906f0cb0d192ea63ac4c86299c8d` function utf8Decode (lib/common/bytes.ts)
- `function:f088a1ac5ff6b45107bcd08bd3c8b964` function base64Encode (lib/common/bytes.ts)
- `function:fbeb8b947ca578391b990b133e1a980e` function isValidCid (lib/common/cid.ts)
- `interface:47bc85c7c8975ca35be2d248a39fc8f8` interface Subscription (lib/common/subscribe-types.ts)
- `type_alias:349a878ef851f1767aff55630d58fc0e` type_alias Bytes (lib/common/bytes.ts)
- `type_alias:70120236446060d8609cd55827e58058` type_alias Cid (lib/common/cid.ts)
- `type_alias:8456cefe0f30f0368ef52c81427cf681` type_alias Tid (lib/common/tid.ts)
- `type_alias:b497332f11279a3ca8c515bffde9accd` type_alias SubscribeHandler (lib/common/subscribe-types.ts)
<!-- SPECD_MANAGED_END -->

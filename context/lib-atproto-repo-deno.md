# Context: lib-atproto-repo-deno

Repository: `hono-pds`

This context exists so the rest of the monorepo (notably the Hono factory and sync handlers) can depend on a single, portable atproto repository implementation without caring which persistence engine is underneath. The Storage contract is the seam: the same Repo, CAR, and service-auth code runs against in-memory, Deno KV, or browser IndexedDB storage. It also centralizes the crypto boundary, giving callers a Signer/Verifier pair derived from a secp256k1 keypair or a hex private key, and a service-auth token format used for inter-service atproto calls.

_The resolved code references are regenerated on every run. Cite the ids above rather than writing them here._

<!-- SPECD_MANAGED_BEGIN -->
## Resolved code references

- `class:2ec5a9ace354dde4dc09fbe7f899b52d` class Repo (lib/atproto-repo-deno/repo.ts)
- `class:900132c026ae2899422c8e1d504ed2ad` class DenoKvStorage (lib/atproto-repo-deno/deno-kv-storage.ts)
- `class:ab614785501d1fa9e92a1f480160e0b1` class IndexedDbStorage (lib/atproto-repo-deno/indexeddb-storage.ts)
- `class:fcc00cb42cf9a5f08a6a047fef8c7cd5` class MemoryStorage (lib/atproto-repo-deno/memory-storage.ts)
- `file:lib/atproto-repo-deno/account-store.ts` file account-store.ts (lib/atproto-repo-deno/account-store.ts)
- `file:lib/atproto-repo-deno/car.ts` file car.ts (lib/atproto-repo-deno/car.ts)
- `file:lib/atproto-repo-deno/deno-kv-storage.ts` file deno-kv-storage.ts (lib/atproto-repo-deno/deno-kv-storage.ts)
- `file:lib/atproto-repo-deno/indexeddb-storage.ts` file indexeddb-storage.ts (lib/atproto-repo-deno/indexeddb-storage.ts)
- `file:lib/atproto-repo-deno/memory-storage.ts` file memory-storage.ts (lib/atproto-repo-deno/memory-storage.ts)
- `file:lib/atproto-repo-deno/mod.ts` file mod.ts (lib/atproto-repo-deno/mod.ts)
- `file:lib/atproto-repo-deno/repo.ts` file repo.ts (lib/atproto-repo-deno/repo.ts)
- `file:lib/atproto-repo-deno/service-auth.ts` file service-auth.ts (lib/atproto-repo-deno/service-auth.ts)
- `file:lib/atproto-repo-deno/signer.ts` file signer.ts (lib/atproto-repo-deno/signer.ts)
- `function:06e7ca4348a3e4f0d985f3502c754f17` function signerFromPrivateKeyHex (lib/atproto-repo-deno/signer.ts)
- `function:2f89c606ae5e1b54b5c7fe0157160ba0` function signerFromKeypair (lib/atproto-repo-deno/signer.ts)
- `function:614b56ba7a356b0d07d1c49c98255ccc` function verifierFromKeypair (lib/atproto-repo-deno/signer.ts)
- `function:b68f2d498225520650b7f337a28b4e7b` function createVerifier (lib/atproto-repo-deno/signer.ts)
- `function:bbf87f02c552d289a5635b9002d7c4a5` function verifyServiceAuthToken (lib/atproto-repo-deno/service-auth.ts)
- `function:bf75ebd3ed0c15cebd48c93df4e0c08f` function exportCar (lib/atproto-repo-deno/car.ts)
- `function:d1aa3833f729ad382a2349c5ff9d0b90` function importCar (lib/atproto-repo-deno/car.ts)
- `function:f11aecc30653d50d6ac86f5d953ad4e3` function signServiceAuth (lib/atproto-repo-deno/service-auth.ts)
- `interface:1c680c3bde2f864d734d712749874f48` interface CarBlock (lib/atproto-repo-deno/car.ts)
- `interface:917aa49d7556f04395e50ef78ffea4a9` interface ServiceAuthOptions (lib/atproto-repo-deno/service-auth.ts)
- `interface:97e164168cae0b7db41098de66ca12c1` interface AccountRecord (lib/atproto-repo-deno/account-store.ts)
- `interface:c6a5e87a7a04735ed8077142c0b7ec37` interface VerifyServiceAuthOptions (lib/atproto-repo-deno/service-auth.ts)
- `interface:c7b8ac06d88fe59259003d958ab76de7` interface AccountStore (lib/atproto-repo-deno/account-store.ts)
- `method:09d5ff902fe131e56e15ae79cf0e34b8` method Repo.listRecords (lib/atproto-repo-deno/repo.ts)
- `method:13d90ea0508c01245c5bd60bc12bb3bc` method MemoryStorage.has (lib/atproto-repo-deno/memory-storage.ts)
- `method:18f8ebd803ee5493235b54b18309d232` method DenoKvStorage.setHead (lib/atproto-repo-deno/deno-kv-storage.ts)
- `method:374e6fc5f69255fb1b76ae6d6d0c3d16` method MemoryStorage.put (lib/atproto-repo-deno/memory-storage.ts)
- `method:393a521a81ce73ee6b607245d6131434` method DenoKvStorage.getHead (lib/atproto-repo-deno/deno-kv-storage.ts)
- `method:47827d3680f72ed5e570912637954038` method DenoKvStorage.put (lib/atproto-repo-deno/deno-kv-storage.ts)
- `method:4a983388c7216cc2940f56ce4399fc23` method MemoryStorage.getHead (lib/atproto-repo-deno/memory-storage.ts)
- `method:4bbd2ad23f28f45e3743eb117062f72d` method DenoKvStorage.has (lib/atproto-repo-deno/deno-kv-storage.ts)
- `method:55a498f1563c27058c34d2adf3667417` method DenoKvStorage.close (lib/atproto-repo-deno/deno-kv-storage.ts)
- `method:5895656e6e5869b86dd23a86ad73f953` method Repo.getRecord (lib/atproto-repo-deno/repo.ts)
- `method:59a2f48e4034cc7f1d986cef644edd34` method Repo.did (lib/atproto-repo-deno/repo.ts)
- `method:5d168db0bb1ffd0b0a82319541bf5d3c` method IndexedDbStorage.getHead (lib/atproto-repo-deno/indexeddb-storage.ts)
- `method:6db395c8cf41c05f9fed9c167da2a10e` method Repo.describe (lib/atproto-repo-deno/repo.ts)
- `method:6e9f02d0bdb31ee0beab549b4ebead47` method IndexedDbStorage.create (lib/atproto-repo-deno/indexeddb-storage.ts)
- `method:73128a372db5ced9cd73eb7eb1d91cc1` method Repo.applyWrites (lib/atproto-repo-deno/repo.ts)
- `method:76ce1d0b8e89fdc8bf7c53c23778cc1a` method IndexedDbStorage.setHead (lib/atproto-repo-deno/indexeddb-storage.ts)
- `method:76face40c454a4c22db1103b77f0192d` method IndexedDbStorage.put (lib/atproto-repo-deno/indexeddb-storage.ts)
- `method:83705247f8ddbca0f99c8d6728b8d5dc` method IndexedDbStorage.has (lib/atproto-repo-deno/indexeddb-storage.ts)
- `method:8ac32f60eb5a2e1dc398b91681dd1a98` method MemoryStorage.setHead (lib/atproto-repo-deno/memory-storage.ts)
- `method:97b2de6d5d6e899cada2cbc294041724` method IndexedDbStorage.get (lib/atproto-repo-deno/indexeddb-storage.ts)
- `method:99bf6a25ea6dc545264a8e7c1d58377a` method MemoryStorage.get (lib/atproto-repo-deno/memory-storage.ts)
- `method:9bec2fd3aa425a31ea41a5290904ad36` method MemoryStorage.close (lib/atproto-repo-deno/memory-storage.ts)
- `method:9e2c373ee53fae0c69d215af81459c34` method DenoKvStorage.get (lib/atproto-repo-deno/deno-kv-storage.ts)
- `method:b2be5dc3db8be6b4c07f524b1d04f298` method DenoKvStorage.create (lib/atproto-repo-deno/deno-kv-storage.ts)
- `method:c227104ab246d619ccc784ead73cb379` method Repo.constructor (lib/atproto-repo-deno/repo.ts)
<!-- SPECD_MANAGED_END -->

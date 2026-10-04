# Context: lib-common-oauth-server-common

Repository: `hono-pds`

This context exists so the OAuth and DPoP primitives shared by the hono-pds OAuth server packages have a single described home in the common layer. It defines the byte-encoding, nonce-generation, and JWK-thumbprint helpers plus the session record shape that the OAuth server implementation and its session injector depend on, keeping the dependency direction one-way from common outward.

_The resolved code references are regenerated on every run. Cite the ids above rather than writing them here._

<!-- SPECD_MANAGED_BEGIN -->
## Resolved code references

- `file:lib/common/oauth-server-common/mod.ts` file mod.ts (lib/common/oauth-server-common/mod.ts)
- `function:5810e31edf2e6e95afc34833da48dc86` function b64url (lib/common/oauth-server-common/mod.ts)
- `function:693ae22c42b1d574a4b56af51d12c703` function computeJkt (lib/common/oauth-server-common/mod.ts)
- `function:da455fe1f77703d9b1b570ac018ae475` function generateDpopNonce (lib/common/oauth-server-common/mod.ts)
- `interface:3ea5feb96bfcd60114c5b7bb013568cb` interface OAuthSessionData (lib/common/oauth-server-common/mod.ts)
<!-- SPECD_MANAGED_END -->

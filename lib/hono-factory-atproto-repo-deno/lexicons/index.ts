import createRecord from "./com/atproto/repo/createRecord.json" with { type: "json" };
import getRecord from "./com/atproto/repo/getRecord.json" with { type: "json" };
import listRecords from "./com/atproto/repo/listRecords.json" with { type: "json" };
import uploadBlob from "./com/atproto/repo/uploadBlob.json" with { type: "json" };
import describeRepo from "./com/atproto/repo/describeRepo.json" with { type: "json" };
import subscribeRepos from "./com/atproto/sync/subscribeRepos.json" with { type: "json" };
import describeServer from "./com/atproto/server/describeServer.json" with { type: "json" };
import createAccount from "./com/atproto/server/createAccount.json" with { type: "json" };
import createSession from "./com/atproto/server/createSession.json" with { type: "json" };
import refreshSession from "./com/atproto/server/refreshSession.json" with { type: "json" };
import resolveHandle from "./com/atproto/identity/resolveHandle.json" with { type: "json" };
import updateHandle from "./com/atproto/identity/updateHandle.json" with { type: "json" };

export interface LexiconSchema {
  lexicon: 1;
  id: string;
  defs: Record<string, unknown>;
}

const lexicons: Record<string, LexiconSchema> = {
  "com.atproto.repo.createRecord": createRecord as LexiconSchema,
  "com.atproto.repo.getRecord": getRecord as LexiconSchema,
  "com.atproto.repo.listRecords": listRecords as LexiconSchema,
  "com.atproto.repo.uploadBlob": uploadBlob as LexiconSchema,
  "com.atproto.repo.describeRepo": describeRepo as LexiconSchema,
  "com.atproto.sync.subscribeRepos": subscribeRepos as LexiconSchema,
  "com.atproto.server.describeServer": describeServer as LexiconSchema,
  "com.atproto.server.createAccount": createAccount as LexiconSchema,
  "com.atproto.server.createSession": createSession as LexiconSchema,
  "com.atproto.server.refreshSession": refreshSession as LexiconSchema,
  "com.atproto.identity.resolveHandle": resolveHandle as LexiconSchema,
  "com.atproto.identity.updateHandle": updateHandle as LexiconSchema,
};

export function getLexicon(nsid: string): LexiconSchema | undefined {
  return lexicons[nsid];
}

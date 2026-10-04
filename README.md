# open-architecture/hono-pds

The architecture and specs of `hono-pds`, as kcp holds them.

Written by specd, one commit per change in kcp. An orphan branch: it shares no
history with the code and is never checked out next to it, so an agent working
on the code never mistakes the spec for the code.

A `.gitattributes` marks every derived file `linguist-generated`, so a
review shows `specs/` and `CHANGES.md` and collapses the rest.

| path | holds |
| --- | --- |
| `arch.yaml` | the structure of the repository as generated system contexts (`kind: GeneratedArchitecture`): each one's id, upstream, depends_on, arch node, requirement ids and levels, and a pointer to its spec file |
| `repository.yaml` | the Repository manifest, its populate state, and the commits every context shares |
| `specs/<context>.yaml` | each context's declared spec; edit here to change kcp |
| `status/<context>.yaml` | observed code facts and conditions |
| `context/<context>.md` | the context's prose and resolved code references; the spec lives in `specs/` |
| `changes/<name>.yaml` | each SpecChange: direction, a delta summary (counts and ids), a progress summary, the agent's report and the verify summary |
| `CHANGES.md` | on a feature branch: the requirement delta against the default branch |
| `graph/*.jsonl` | the context graph, one vertex or edge per line |

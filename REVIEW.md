# Initial project review

Reviewed on 2026-09-16. No tracked working changes existed at intake. The
merge-request reviewer examined `5deb02c` against its parent as an onboarding
sample; the senior reviewer examined related request flows. Findings below are
static code findings, not reproduced browser failures. No application fixes are
included in this workflow setup.

| Priority | Finding | Follow-up |
| --- | --- | --- |
| P2 | `frontend/src/pages/Library.jsx`: failed optimistic wishlist removal relies on a second request to recover; if that fails too, the star falsely stays empty. | Restore known state and show a retryable error. |
| P2 | `frontend/src/pages/Library.jsx`: an older wishlist GET can overwrite a later successful removal. | Reconcile reads with mutations; test delayed responses. |
| Compatibility | Existing duplicate wishlist rows are reduced to one ID by the Library map; deleting that ID can leave another row behind. | Decide how to reconcile duplicates while preserving notes and target prices. |
| Performance | `frontend/src/hooks/useCardSearch.js`: resetting from page 2+ dispatches both an explicit search and the page effect's search. | Use one dispatch owner; verify submit, sort and programmatic search. |
| Performance | `frontend/src/pages/Collection.jsx`: mutation refresh calls load directly and indirectly through the parent's refresh key. | Give one path responsibility for collection/value refresh. |
| Performance | Backend search and binder creation await fallback pricing serially per card. | Evaluate bounded concurrency and shared failure/in-flight caching with mocked upstream outages. |

Developer assessment: the wishlist findings merit focused regression fixes; the
duplicate frontend requests are suitable bounded optimization tasks. Backend
fallback concurrency needs a separate design and isolated validation. No timing
benchmarks were run, and no speculative speedup is claimed.

Validation: `npm run build` passed (48 modules). Neither frontend nor backend
defines test/lint scripts. Backend runtime checks were not run against the user's
SQLite file. The build verifies bundling, not behavioral correctness.

Patch notes for this change: document project architecture and the developer,
merge-request reviewer, senior reviewer and final approver responsibilities in
`AGENTS.md`; record the initial review backlog here. Application behavior is
unchanged. No commit, merge or deployment was performed.

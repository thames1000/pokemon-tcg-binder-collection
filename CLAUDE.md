# Project Context

This is a two-part app: `frontend` (React + Vite) and `backend` (Express +
SQLite), siblings under this root. `frontend/src/App.jsx` owns routes and
collection-value refreshes; `frontend/src/api.js` wraps the Express API via
`/api`. `frontend/src/hooks/useCardSearch.js` provides reusable search state
and logic; each hook instance maintains its own state.

Pages cover the library, collection, price lookup, analytics, wishlist, binders
and the pack simulator. `SIMULATOR.md` documents the virtual economy and pack rules.

`backend` owns collection/wishlist records, binder layouts, price calculations
and card/API caches. Cookie-session authentication with admin/user roles lives
in `backend/auth.js` and `backend/routes/auth.js`; every API route except health
and sign-in requires a session, and all users share the same data. Roles gate
actions; they do not partition collections.

Card data comes from pokemontcg.io, with TCGdex price fallback. A completed full
sync enables local cache search. See `README.md` for setup, endpoints and data
model.

`frontend/src/pricing.js` mirrors backend pricing for display. Check both when
changing price semantics. Preserve:
- variant-aware binder ownership;
- unknown-price handling;
- the distinction between partial and fully synced card caches;
- authentication/session behavior;
- the separation between real collection data and simulator data.

# Claude Code Development Workflow

Use a staged developer/review workflow for non-trivial changes.

Optimize for correctness per unit of Claude usage. Do not maximize subagent
activity.

Use subagents when work:
- benefits from independent review;
- can run as an isolated workstream;
- benefits from separate context;
- requires a deliberately different model/capability profile.

For simple tasks, sequential operations, direct searches, single-file mechanical
edits or work that requires continuous shared context, work directly instead of
delegating.

## Claude model policy

Preferred hierarchy:

| Role | Default | Escalation |
| --- | --- | --- |
| Explorer/helper | Haiku | Sonnet |
| Developer | Sonnet | Fable 5.1 only when necessary |
| Merge-request reviewer | Sonnet high | Fable 5.1 |
| Senior reviewer | Sonnet high | Fable 5.1 high |
| Final approver | Fable 5.1 high | Fable 5.1 maximum/deep reasoning |

Reserve Fable 5.1 for:
- significant architecture review;
- difficult cross-component interactions;
- security/authentication;
- concurrency;
- persistence/data integrity;
- transaction correctness;
- unresolved review findings;
- final review of high-risk changes.

Do not invoke Fable merely because it is available.

When escalation is needed, give Fable the narrow unresolved question,
relevant diff and surrounding code rather than automatically sending
the entire repository.

## Risk classification

Classify the change before spawning reviewers.

### Trivial

Examples:
- documentation-only edits;
- wording/comments/formatting;
- non-behavioral CSS polish;
- mechanical cleanup with no runtime behavior change.

Required workflow:
- primary Developer only;
- relevant deterministic validation if any.

Do not spawn reviewers unless the scope becomes behavioral.

### Low risk

Examples:
- bounded UI behavior;
- isolated helper logic;
- straightforward display-state changes;
- small refactors with obvious equivalence.

Required workflow:
- Developer;
- Merge-request reviewer.

Final approval is optional unless the task expands or review finds material
concerns.

### Normal risk

Examples:
- ordinary feature work;
- user-visible bug fixes;
- API changes;
- non-trivial state management;
- pricing, binder or collection logic;
- frontend/backend changes that interact.

Required workflow:
- Developer;
- Merge-request reviewer;
- Final approver.

Add Senior review when architecture, performance, cross-component behavior or
review disagreement materially matters.

### High risk

Examples:
- authentication/authorization;
- session behavior;
- persistence/schema changes;
- transactions;
- simulator money/inventory consistency;
- concurrency or asynchronous ordering;
- cache completeness/correctness;
- security/trust-boundary changes;
- destructive operations;
- architecture spanning several subsystems.

Required workflow:
- Developer;
- Merge-request reviewer;
- Senior reviewer;
- Final approver.

Material revisions after review must be re-reviewed by the affected role before
final approval.

# Claude Subagent Roles

## Developer

The primary Claude instance owns implementation and integration unless an
isolated implementation workstream clearly benefits from delegation.

Default to Sonnet-class capability with normal/moderate reasoning.

Responsibilities:
- inspect relevant code before making claims or edits;
- understand the requested behavior;
- make the smallest defensible change;
- preserve unrelated work;
- avoid scope creep and unrelated refactors;
- run appropriate validation;
- present the actual diff and validation evidence to reviewers;
- evaluate reviewer recommendations rather than blindly applying them;
- record the reason for any material deferral or disagreement.

Do not perform exhaustive architecture review before ordinary implementation.

Escalate a specific problem when:
- requirements are materially ambiguous;
- the change crosses several architectural boundaries;
- targeted debugging repeatedly fails;
- concurrency, persistence, auth/security or data integrity becomes difficult to
  reason about;
- a reviewer identifies an issue that cannot be confidently resolved.

Return to the cheaper normal Developer profile after the difficult portion is
resolved.

## Merge-Request Reviewer

This subagent is independent and READ-ONLY.

Use Sonnet-class capability with elevated reasoning.

Review the actual diff against:
1. the requested task;
2. existing behavior and invariants;
3. relevant surrounding code;
4. validation evidence.

Prioritize:
- correctness;
- regressions;
- edge cases;
- unsafe assumptions;
- async/state ordering;
- persistence/data integrity;
- auth/security implications;
- missing task-specific validation.

For every material finding include:
- severity;
- file/location;
- concrete trigger;
- actual behavior;
- expected behavior;
- reasoning.

Distinguish regressions from pre-existing issues.

If intent is unclear, request the Developer's rationale instead of inventing it.

Do not:
- edit files;
- request unrelated cleanup;
- focus on subjective style unless it hides a material problem;
- invent findings to justify the review.

If no material findings exist, explicitly say so.

## Senior Reviewer

This subagent is independent and READ-ONLY.

The Senior Reviewer does not automatically require the highest-tier model.

Use the normal senior-review profile first.

Escalate the Senior Reviewer to Fable 5.1 when:
- the change is classified High risk;
- the first review and Developer disagree on a material issue;
- architecture or data-flow reasoning spans multiple subsystems;
- concurrency, security, persistence or transaction behavior is involved;
- the normal Senior Reviewer explicitly identifies an unresolved uncertainty.

Run after the Developer has responded to material first-review findings unless
early architecture review is specifically useful.

Do not merely repeat the Merge-Request Reviewer.

Concentrate on:
- architecture and component boundaries;
- state/responsibility ownership;
- cross-component interactions;
- data flow;
- race/lifecycle behavior;
- auth/security boundaries;
- evidence-supported performance issues;
- unnecessary complexity;
- maintainability risks significant enough to affect future correctness;
- whether previous fixes address root causes.

Avoid speculative optimization and unrelated redesign.

Explain disagreements with evidence and tradeoffs.

Do not edit files.

## Final Approver

This subagent is independent and READ-ONLY.

Final Approver:
- Normal-risk changes: Sonnet-class or Fable 5.1 when the patch is broad.
- High-risk changes: Fable 5.1 with high reasoning.
- Reserve maximum/deep reasoning for unresolved architecture,
  concurrency, security, persistence, or data-integrity questions.

Run only after:
- implementation is stable;
- material findings are resolved or explicitly dispositioned;
- relevant validation has completed.

Inspect the final diff directly. Do not approve from other agents' summaries
alone.

Review:
- the original task;
- the final diff;
- unresolved findings and Developer explanations;
- validation evidence;
- relevant invariants;
- remaining risks.

Return exactly one advisory verdict:

`APPROVE`

`REQUEST CHANGES`

`BLOCKED`

Definitions:
- `APPROVE`: no known material issue remains in scope.
- `REQUEST CHANGES`: a concrete material issue remains.
- `BLOCKED`: available code, requirements, environment or validation evidence is
  insufficient to decide responsibly.

Include concise reasons, remaining risks and user-facing patch notes.

Approval is advisory only. It does not authorize merge, deployment or
destructive actions.

# Delegation and Usage Controls

Do not delegate merely because subagents exist.

Use direct tools/work for:
- simple grep/search;
- file lookup;
- deterministic commands;
- trivial edits;
- single-file mechanical changes;
- repeated review of unchanged code;
- work whose result is already established by direct evidence.

Use subagents for:
- independent review;
- genuinely parallel workstreams;
- isolated context that should not pollute the main implementation context;
- specialized reasoning that requires a different capability tier.

Do not ask multiple expensive subagents the same open-ended question simply to
collect opinions.

If a cheaper agent is uncertain, contradictory, repeatedly failing or lacks
evidence for a material conclusion, escalate that specific unresolved question
instead of rerunning the entire task on a stronger model.

Keep context targeted. Give reviewers:
- task requirements;
- actual diff;
- affected files;
- relevant project documentation;
- only nearby code needed to reason about the change.

Model escalation and agent spawning are separate decisions.

A task that needs deeper reasoning does not necessarily need another agent.
An independent review does not necessarily require a stronger model.

Choose independently:
1. whether another perspective is needed;
2. how capable that agent needs to be.

# Review Loop

Default normal-risk sequence:

Developer implements
→ Merge-Request Reviewer reviews
→ Developer resolves or dispositions findings
→ Senior Reviewer only when risk/complexity warrants
→ Developer makes justified final revisions
→ affected reviewer re-checks material revisions when needed
→ Final Approver independently reviews the stabilized result

Minor changes made solely to address a clearly bounded finding do not require
restarting every stage.

Material changes affecting behavior, architecture, persistence, security,
transactions, concurrency or public interfaces must be reviewed again.

When no task diff exists, say so. A specifically identified recent commit may be
used for onboarding review, but baseline findings must remain separate from the
current task.

Do not invent application changes merely to create something to review.

# Validation

Run `npm run build` in `frontend` for frontend code changes.

Run `npm run test:simulator` in `backend` for simulator changes.

Run `npm run test:auth` in `backend` for authentication/user-role changes.

`npm test` in `backend` runs both backend suites. These tests use isolated
in-memory SQLite databases.

There is no general lint script. Do not describe a successful frontend build as
behavioral test coverage.

Add or run focused regression checks when justified, especially for:
- asynchronous state ordering;
- pricing;
- persistence;
- authentication;
- transactions;
- cache correctness.

State exactly what was and was not verified.

Importing backend `db.js` opens and initializes
`backend/data/collection.db`. Use isolated data for runtime tests. Do not
exercise write endpoints against the user's real collection.

Preserve unrelated user files and uncommitted changes.

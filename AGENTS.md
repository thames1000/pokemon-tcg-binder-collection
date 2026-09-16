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

# Codex Development Workflow

Use a staged developer/review workflow for non-trivial changes.

The goal is not maximum agent activity. The goal is the minimum model usage
required to achieve high confidence in the finished change.

Spend stronger-model capacity where independent reasoning has the highest value:
review, architecture, subtle state/data behavior and final approval.

Do not use the strongest available model for every subagent by default.

## Model and reasoning policy

Preferred hierarchy:

| Role | Default | Escalation |
| --- | --- | --- |
| Explorer/helper | Luna low/medium | Terra medium |
| Developer | Terra medium | Sol high |
| Merge-request reviewer | Terra high | Sol high |
| Senior reviewer | Sol high | Astra high |
| Final approver | Sol xhigh | Astra high/xhigh |

Reserve Astra for:
- high-risk changes;
- unresolved architectural questions;
- security/authentication issues;
- concurrency or race conditions;
- persistence/data-integrity concerns;
- transaction correctness;
- difficult reviewer disagreement.

Do not use Astra for ordinary implementation, routine code review,
simple debugging, mechanical edits, or repository exploration.

Escalate the specific unresolved problem rather than rerunning the
entire task with Astra.

## Risk classification

Before spawning review agents, classify the change by its highest-risk behavior.

### Trivial

Examples:
- documentation-only edits;
- wording, comments or formatting;
- non-behavioral CSS/layout polish;
- mechanical cleanup with no runtime behavior change.

Required workflow:
- Developer only;
- run relevant deterministic validation if any.

Do not spawn review agents unless the change unexpectedly becomes behavioral.

### Low risk

Examples:
- bounded UI behavior;
- isolated helper logic;
- straightforward error-message or display-state changes;
- small refactors with obvious equivalence.

Required workflow:
- Developer;
- Merge-request reviewer.

Final approval is optional unless the change expands in scope or the reviewer
finds material concerns.

### Normal risk

Examples:
- ordinary feature work;
- user-visible bug fixes;
- API behavior changes;
- non-trivial state management;
- pricing, binder or collection logic;
- changes spanning frontend and backend.

Required workflow:
- Developer;
- Merge-request reviewer;
- Final approver.

Add the Senior reviewer when architecture, performance, cross-component behavior
or unresolved reviewer disagreement materially matters.

### High risk

Examples:
- authentication or authorization;
- session behavior;
- persistence or schema changes;
- transactions;
- simulator economy or money/inventory consistency;
- concurrency, race conditions or asynchronous ordering;
- cache completeness/correctness;
- security/trust-boundary changes;
- destructive operations;
- architectural changes affecting several subsystems.

Required workflow:
- Developer;
- Merge-request reviewer;
- Senior reviewer;
- Final approver.

Material revisions after review must be re-reviewed by the affected role before
final approval.

# Agent Roles

## 1. Developer

The Developer owns implementation and integration.

Use the fast/cost-efficient coding profile with MEDIUM reasoning by default.

Responsibilities:
- understand the requested change before editing;
- inspect relevant existing code;
- make the smallest defensible change;
- preserve unrelated user work and uncommitted changes;
- avoid unrelated refactors;
- run appropriate validation;
- provide the actual diff and validation evidence to reviewers;
- evaluate reviewer recommendations instead of blindly applying them;
- record reasons for deferrals or disagreements.

The Developer should prioritize forward progress rather than performing an
exhaustive architecture review before ordinary implementation.

Escalate a specific problem to a stronger profile or higher reasoning when:
- requirements are materially ambiguous;
- a change crosses several architectural boundaries;
- a targeted debugging attempt repeatedly fails;
- concurrency, persistence, auth/security or data integrity is difficult to
  reason about;
- a reviewer identifies an issue the Developer cannot confidently resolve.

After resolving the difficult portion, return to the normal Developer profile.

Do not spawn a subagent for trivial file lookup, simple grep/search, one-line
edits or deterministic commands.

## 2. Merge-Request Reviewer

The Merge-Request Reviewer is independent and READ-ONLY.

Use a fast/cost-efficient coding model with HIGH reasoning.

Review the actual diff against:
1. the requested task;
2. existing behavior and project invariants;
3. relevant surrounding code;
4. available validation evidence.

Prioritize:
- correctness;
- regressions;
- broken edge cases;
- unsafe assumptions;
- async/state ordering;
- persistence/data integrity;
- auth/security implications;
- missing validation directly related to the change.

For every material finding include:
- severity;
- file and relevant code location;
- concrete triggering condition;
- actual behavior;
- expected behavior;
- why the diff introduced the problem or failed to address it.

Distinguish regressions introduced by the task from pre-existing issues.

Ask the Developer for rationale when intent is unclear rather than inventing it.

Do not:
- edit files;
- request unrelated rewrites;
- spend review capacity on subjective style comments unless they hide a
  correctness or maintainability problem;
- invent findings when the patch is sound.

If no material findings exist, say so explicitly.

## 3. Senior Reviewer

The Senior Reviewer is independent and READ-ONLY.

The Senior Reviewer does not automatically require the highest-tier model.

Use the normal senior-review profile first.

Escalate the Senior Reviewer to Astra/Fable 5.1 when:
- the change is classified High risk;
- the first review and Developer disagree on a material issue;
- architecture or data-flow reasoning spans multiple subsystems;
- concurrency, security, persistence or transaction behavior is involved;
- the normal Senior Reviewer explicitly identifies an unresolved uncertainty.
Run after the Developer has responded to material Merge-Request Reviewer
findings, unless early architectural review is specifically useful.

Do not merely repeat the first review.

Concentrate on:
- architecture and component boundaries;
- ownership of state and responsibilities;
- interactions between changed and unchanged systems;
- data flow;
- race conditions and lifecycle behavior;
- authentication/security boundaries;
- performance problems supported by code or measurements;
- unnecessary complexity;
- maintainability problems significant enough to affect future correctness;
- whether earlier findings were fixed at the root cause.

Prefer evidence-supported concerns over hypothetical possibilities.

Avoid speculative optimization and unrelated redesign.

When disagreeing with the Developer or first reviewer, explain the tradeoff and
evidence rather than appealing to seniority.

Do not edit files.

## 4. Final Approver

The Final Approver is independent and READ-ONLY.

Final Approver:
- Normal-risk changes: GPT-5.6 Sol with high/xhigh reasoning.
- High-risk changes: GPT-6 Astra with high reasoning.
- Use Astra xhigh only for unresolved architectural, concurrency,
  security, persistence, transaction, or data-integrity concerns.
- Do not use Astra merely because it is available.

Run only after:
- implementation has stabilized;
- material reviewer findings have been addressed or explicitly dispositioned;
- relevant validation has completed.

The Final Approver must inspect the final diff. Do not approve solely from
summaries produced by other agents.

Examine:
- the original requested behavior;
- the final diff;
- unresolved findings and Developer explanations;
- validation evidence;
- relevant project invariants;
- remaining risks.

Return exactly one advisory verdict:

`APPROVE`

`REQUEST CHANGES`

`BLOCKED`

Definitions:
- `APPROVE`: no known material issue remains within the requested scope.
- `REQUEST CHANGES`: a concrete issue remains that should be corrected before
  treating the work as complete.
- `BLOCKED`: available code, environment, requirements or validation evidence
  is insufficient to responsibly decide.

Include concise reasons, remaining risks and user-facing patch notes.

This verdict is advisory. It does not authorize merge, deployment or destructive
actions.

# Subagent Cost and Usage Controls

Use subagents for independent workstreams or independent review.

Prefer direct work instead of delegation for:
- trivial edits;
- simple file lookup;
- grep/search that can be performed directly;
- deterministic commands;
- repeated review of unchanged code;
- single-file mechanical changes;
- work whose result is already established by tests or direct evidence.

Avoid sending the entire repository context to every role. Provide:
- the task;
- the actual diff;
- relevant project documentation;
- affected files;
- only the neighboring code required to reason about the change.

Follow references further only when necessary.

Reuse the same role agent within a session when possible rather than spawning
duplicate agents with identical context.

Do not run several expensive agents in parallel merely to obtain multiple
opinions. Parallelize only genuinely independent work.

Model escalation and agent spawning are separate decisions.

A task that needs deeper reasoning does not necessarily need another agent.
An independent review does not necessarily require a stronger model.

Choose independently:
1. whether another perspective is needed;
2. how capable that agent needs to be.

# Review Loop

Default sequence for a normal change:

Developer implements
→ Merge-Request Reviewer reviews
→ Developer resolves or dispositions findings
→ Senior Reviewer runs only when risk/complexity warrants it
→ Developer makes justified final revisions
→ affected reviewer re-checks material revisions when necessary
→ Final Approver independently reviews the stabilized result

Minor changes made solely to address a clearly bounded finding do not require
restarting every review stage.

Material changes affecting behavior, architecture, persistence, security,
transactions, concurrency or public interfaces must be reviewed again.

When no task diff exists, say so. An explicitly identified recent commit can
serve as an onboarding review, but keep baseline findings separate from the
current task.

Do not invent application changes merely to provide a diff for review.

# Validation

Run `npm run build` in `frontend` for frontend code changes.

Run `npm run test:simulator` in `backend` for simulator changes.

Run `npm run test:auth` in `backend` for authentication/user-role changes.

`npm test` in `backend` runs both backend suites. These tests use isolated
in-memory SQLite databases.

There is no general lint script. Do not describe a successful frontend build as
behavioral test coverage.

Add or run focused regression checks when justified by the change, especially
for:
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

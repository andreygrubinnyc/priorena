# Codex development workflow

This public repository uses bounded authority, direct evidence retrieval, and explicit handoffs. Repository security, privacy, sanitization, and supported local-only boundaries apply in every state.

## Roles

- **Product owner:** makes product decisions and authorizes protected boundaries.
- **Coordinator:** scopes bounded work, sends authority directly to the implementation task, monitors task and GitHub evidence, performs independent review, and brings only decisions or blockers to the product owner.
- **Implementation task:** changes only the authorized repository and worktree scope, validates it, publishes a draft pull request when authorized, or stops at its assigned boundary.
- **GitHub:** is the durable evidence and handoff point for source changes, commits, checks, reviews, and pull-request state.

## Lifecycle states

| State | Allowed actions | Evidence required to leave | Next state |
| --- | --- | --- | --- |
| `DISCOVERY` | Inspect public-safe repository context and define the product outcome; do not mutate. | Outcome, invariants, risks, and unresolved decisions are recorded. | `AUTHORITY_READY` or `BLOCKED` |
| `AUTHORITY_READY` | Fix repository identity, base, branch, exact scope, exclusions, gates, and stop rules. | Complete authority is sent directly to the implementation task. | `IMPLEMENTING` or `BLOCKED` |
| `IMPLEMENTING` | Perform preflight and change only the authorized scope. | Scoped diff and implementation evidence exist. | `VALIDATING` or `BLOCKED` |
| `VALIDATING` | Review the complete diff and run every authorized test, scan, audit, staging, and commit gate. | All required gates pass conclusively for the exact reviewed snapshot. | `DRAFT_PR` or `BLOCKED` |
| `DRAFT_PR` | Push the focused branch normally and create and verify a draft pull request when publication is authorized. | Draft PR identity, commit SHA, scope, description, and checks are retrievable. | `INDEPENDENT_REVIEW` or `BLOCKED` |
| `INDEPENDENT_REVIEW` | Coordinator reads the diff, commits, PR description, reviews, and GitHub checks directly. | Review conclusion and any focused findings are recorded. | `CORRECTION`, `MERGE_AUTH_REQUIRED`, or `BLOCKED` |
| `CORRECTION` | Apply a focused correction that remains inside the existing outcome, paths, invariants, and publication authority. | Corrected exact revision passes the required gates and review. | `INDEPENDENT_REVIEW` or `BLOCKED` |
| `MERGE_AUTH_REQUIRED` | Report merge readiness; do not approve or merge. | Product owner gives separate explicit merge authority for the exact PR and revision. | `RELEASE_AUTH_REQUIRED`, `COMPLETE`, or `BLOCKED` |
| `RELEASE_AUTH_REQUIRED` | Report source-only release readiness; do not operate a runtime or touch live/private data. | Product owner gives separate exact release authority and all release preconditions pass. | `COMPLETE` or `BLOCKED` |
| `COMPLETE` | Record the completed authorized boundary and stable handoff; take no further consequential action. | Final evidence is durable and retrievable. | A newly authorized lifecycle only. |
| `BLOCKED` | Preserve state and report the exact mismatch, failed gate, or missing authority; do not improvise cleanup or expansion. | The blocker is resolved within scope or new product-owner authority is issued. | The state named by the resolved evidence. |

A draft pull request is a source handoff point, not merge authority.

## Authority boundaries

Each consequential boundary is authorized separately and exactly:

- **Implementation and publication:** permits only the stated worktree, paths, validation, commit, normal push, and draft-PR actions.
- **Merge:** permits merging only the reviewed PR revision after required checks and review.
- **Source-only live release:** permits only the exact source release procedure; it does not imply runtime or live-data authority.
- **Live-data mutation, restoration, or migration:** requires an exact data scope, fingerprints, backups, interlocks, and stop rules.
- **Destructive repository operations:** require explicit targets and separate authorization; routine implementation authority never permits history rewriting or force-push.
- **External communication or service changes:** require explicit recipients/services, content, and action authority; monitoring does not grant it.

Merge and live release require separate explicit authority. Neither grants live-data authority unless that boundary is stated separately.

## Direct coordination

The coordinator reads implementation-task and GitHub evidence directly. The product owner does not copy full reports between tasks. A short user nudge may identify a task when no monitor is active, but the report itself is not relayed.

A monitor or heartbeat may notify only when a decision, blocker, merge-ready pull request, failed check, or completed protected phase needs attention. Unchanged progress does not need notification. Monitoring never authorizes merge, release, live-data mutation, destructive work, external communication, or service changes.

## Corrections and stop rules

The coordinator may send a focused correction directly when it stays within the existing product outcome, approved paths, security and privacy invariants, trust boundaries, and publication authority. A new product-owner decision is required for scope expansion, a new path, changed product behavior, relaxed control, destructive action, external effect, merge, release, or live-data work.

Stop on any authority mismatch, unexpected repository state, private or operational value, inconclusive security gate, failed required check, or need to weaken a control. Preserve the worktree state and report the last completed boundary. Never copy credentials, Source content, private paths, runtime data, real identifiers, transcripts, screenshots, or operational evidence into tasks, commits, pull requests, fixtures, or handoffs.

## Handoff contract

Finish with a short human summary followed by this stable block:

```text
PHASE_RESULT: <result>
STATUS: <status>
BRANCH: <branch-or-none>
HEAD: <commit-or-none>
PR: <pull-request-or-none>
CHECKS: <checks-and-results>
NEXT_AUTHORITY: <required-authority-or-none>
```

Every value must be public-safe. Exclude private paths, runtime data, Source content, credentials, secrets, operational identifiers, and other non-public evidence.

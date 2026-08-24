# <Bounded change title>

## Authority status

**Status:** `<AUTHORIZED | NOT_AUTHORIZED>`

This template is not authority for a current operation. Replace every placeholder and obtain explicit product-owner approval before consequential action.

## Fixed identity

- Repository: `<repository-owner>/<repository-name>`
- Starting base commit: `<full-public-commit-sha>`
- Feature branch: `<focused-feature-branch>`
- Pull-request base: `<base-branch>`
- Commit message: `<exact-commit-message>`
- Draft PR title: `<exact-draft-pr-title>`

## Path scope

### Exact approved paths

1. `<approved/path-one>`
2. `<approved/path-two>`

### Exact prohibited paths

- `<prohibited/path-or-category>`
- Any path not listed as approved.

## Product, security, privacy, and trust invariants

- Product outcome: `<bounded-public-safe-outcome>`
- Supported deployment boundary: `<supported-boundary>`
- Security controls that must remain unchanged: `<controls>`
- Privacy and sanitization requirements: `<requirements>`
- Trust boundaries that must remain unchanged: `<boundaries>`
- Fictional English fixture requirements: `<requirements>`

## Exact read-only preconditions

Before mutation, prove:

1. `<expected-worktree-identity>`
2. `HEAD`, local base, and remote-tracking base equal `<full-public-commit-sha>`.
3. The branch is exactly `<focused-feature-branch>` and is not in use elsewhere.
4. The worktree and index are clean, with no untracked files, conflicts, or submodule changes.
5. `<additional-read-only-precondition>`

Stop without cleanup, reset, stash, rebase, restore, or editing if a precondition differs.

## Implementation requirements

- `<required-behavior-or-artifact>`
- `<required-security-or-test-property>`
- Change only the exact approved path scope.

## Non-goals

- `<explicit-non-goal>`
- Product, schema, seed, runtime, live-data, dependency, or provider changes unless each is expressly approved above.

## Tests and verification gates

1. `<focused-test-command-and-success-condition>`
2. `<full-test-command-and-success-condition>`
3. Inspect the complete diff and run `git diff --check`.
4. Run `npm run verify:commit` for the exact staged snapshot.
5. Run registry-backed `npm audit --audit-level=moderate` conclusively.
6. Run `npm run verify:push` for the exact committed revision.
7. `<additional-required-gate>`

An unavailable or inconclusive required check is not a pass.

## Staging, commit, push, and draft-PR rules

- Stage only the exact approved paths with explicit file arguments; never use broad staging.
- Confirm the staged path set and tree equal the reviewed snapshot.
- Create one commit with the fixed message and verify its parent, path set, and tree.
- Push only the fixed feature branch with a normal non-force push.
- Open one draft PR with the fixed title and base, then verify its base, head, SHA, draft state, description, and checks.
- Publication authority does not include approval, ready-for-review conversion, or merge.

## Universal stop rules

Stop and preserve state if any precondition, scope, invariant, path, gate, staged tree, commit identity, remote state, permission, or publication result differs. Stop if private or operational content appears, a control would be weakened, or a prohibited operation would be required. Do not improvise cleanup, workarounds, retries that rewrite history, or scope expansion.

## Prohibited operations

- Merge, release, deployment, runtime operation, or live/private-data access without its separate exact authority.
- Force-push, history rewriting, destructive repository action, dependency change, gate bypass, or suppressed finding.
- Schema, seed, product behavior, external communication, provider, or service change outside the approved scope.
- Copying private authority files, paths, credentials, Source content, transcripts, screenshots, runtime data, or operational evidence into public artifacts.

## Separate protected boundaries

- Merge authority: `<not-granted-or-exact-separate-authority>`
- Release authority: `<not-granted-or-exact-source-only-authority>`
- Live-data authority: `<not-granted-or-exact-mutation-restoration-migration-authority>`
- Destructive-operation authority: `<not-granted-or-exact-targets-and-action>`
- External-communication or service authority: `<not-granted-or-exact-recipients-services-and-action>`

No one boundary implies another.

## Required final report

Report the classification, repository/branch/base and preflight, exact changed paths, security/privacy/sanitization review, test totals, every required gate, commit identity and tree proof, push/upstream state, draft-PR identity and state, final worktree/index state, prohibited operations not performed, blockers, and next required authority.

Use the repository-approved security wording when applicable. Do not claim that the software is vulnerability-free.

Finish with a short human summary and this public-safe stable handoff block:

```text
PHASE_RESULT: <result>
STATUS: <status>
BRANCH: <branch-or-none>
HEAD: <commit-or-none>
PR: <pull-request-or-none>
CHECKS: <checks-and-results>
NEXT_AUTHORITY: <required-authority-or-none>
```

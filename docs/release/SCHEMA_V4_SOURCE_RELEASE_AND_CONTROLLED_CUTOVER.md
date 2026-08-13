# Schema-v4 source release and controlled-cutover boundary

**Status:** source-release procedure; no live cutover authorization

**Date:** 2026-08-13

## Source release

The schema-v4 Work Item Feature and Jira Epic association release is developed, tested, and smoked only in a separate Codex-managed worktree and temporary data paths. The live Priorena process and schema-v3 runtime file must not be modified, stopped, restarted, migrated, normalized, replaced, or used as implementation input.

Before source publication:

1. Confirm the feature branch is based on current `origin/main` and contains release commit `49e59a3fbb56c9ec6ea01c6f0c58d0c9d66113a5`.
2. Confirm the live runtime still has the separately recorded exact empty generic schema-v3 fingerprint and process identity using read-only checks.
3. Validate schema v4, all five association states, exact parents, independent preview/apply, import proposals, UI controls, search, Briefings, exports/backups, and AI context.
4. Run the complete commit and push gates, including dependency audit and staged startup/smoke.
5. Rehearse checksum-verified rollback with temporary bytes and the exact schema-v3 application at commit `49e59a3fbb56c9ec6ea01c6f0c58d0c9d66113a5`.
6. Publish a focused non-draft pull request and require all GitHub checks, including CodeQL and dependency review, to succeed.
7. Do not merge without explicit source-code merge authorization.

## Later controlled cutover

Merging the source pull request does not authorize a live schema-v4 reset. A separate explicit authorization must identify the approved release commit and exact staged schema-v4 seed fingerprint before any live action.

At that later gate, the operator must revalidate the live schema-v3 fingerprint, confirm the prepared rollback revision and temporary rehearsal evidence, stop the exact validated loopback process, create and reverify the private byte-for-byte backup, atomically replace only the authorized runtime file, start the approved schema-v4 application, and run the bounded acceptance smoke. Any required failure permits one checksum-verified rollback and schema-v3 smoke, then stops the procedure. No migration, selective restoration, or compatibility mode is allowed.

The pull request for this source release must state that the live runtime was unchanged and that live reset authorization remains outstanding.

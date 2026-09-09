# Decision and Risk schema-v6 foundation

**Status:** Current schema-v6 foundation; source workflows implemented, live migration and release pending

**Persisted model:** strict `schemaVersion: 6`

**Application boundary:** single-user, local-only, loopback `127.0.0.1`

## Product decision

Priorena represents durable Decisions and Risks as separate Workspace-owned
entities. They are not Findings, Evidence, Proposed Changes, Audit Events,
Briefings, Work Items, or a generic management-record type.

- A Finding is an untrusted extracted Source claim.
- Evidence is an explicitly accepted claim with exact Source provenance.
- A Proposed Change can change one supported Work Item field after separate
  review and apply.
- An Audit Event records that a mutation occurred through bounded hashes; it is
  not the canonical record being managed.
- A Briefing freezes selected facts and manual material for communication.
- A Risk is a human-recorded possible future condition, not accepted Evidence
  or current state.
- A Decision is a human-recorded choice and rationale, optionally supported by
  compatible accepted Evidence.

Schema v6 adds the required root collections `decisions[]` and `risks[]` while
leaving every schema-v5 entity shape and relationship unchanged.

## Decision record

A Decision is owned by exactly one Organization and Workspace. It may select
one Initiative and one Work Item. When both are present, the Work Item's
Initiative must match exactly. Optional Evidence IDs must resolve in the same
Workspace and must not contradict the selected Work Item or Initiative.

The lifecycle is deliberately small:

```text
Draft -> Decided
```

A Draft has null decision metadata. A Decided record requires a non-empty
outcome and rationale, `decidedAt`, and `decidedBy`; `decidedAt` equals the
record's final `updatedAt`. Decided records are immutable through target-store
transitions.

A Decision may name one earlier Decided Decision in the same Workspace through
`supersedesDecisionId`. Self-reference, draft targets, foreign parents, and
multiple successors for one Decision fail closed. Supersession creates no
implicit mutation of the earlier record.

## Risk record

A Risk uses the same exact optional Initiative, Work Item, and Evidence scope.
It stores a human-authored title and description plus nullable response plan,
owner, and review date.

The lifecycle is deliberately small:

```text
Open -> Closed
```

An Open Risk has no closure metadata. A Closed Risk requires `closedAt`,
`closedBy`, and a non-empty closure note; `closedAt` equals its final
`updatedAt`. Closed records are immutable through target-store transitions.

The schema contains no probability, severity, impact score, ranking, inferred
priority, acceptance state, automatic owner, automatic due date, or automatic
closure. A separate explicit Decision may later record risk acceptance, but no
structured Decision-to-Risk relationship is part of this foundation.

## Audit, bounds, and disclosure

Decision and Risk are valid Workspace-owned Audit Event entity types. Existing
Audit Events remain append-only, ordered, and immutable. The schema retains the
1,000-record per-root-collection limit, 5,000 aggregate root-record limit, and
4 MiB target-file read/write limits.

Organization export and backup preserve Decision and Risk records. They are not
added to the optional AI context, Today, Portfolio, Search, Briefing candidates,
generic child routes, or browser UI in this foundation. Briefing isolation does
consider their stable IDs so a frozen Version cannot embed foreign-Workspace
Decision or Risk references.

## One-way offline migration

The migration command is:

```text
npm run schema:migrate-v5-to-v6 -- --source <private-v5-file> --destination <new-private-v6-candidate>
```

This command is a tool, not authority to run it against private or live data.
It requires separate source and destination paths outside the repository. The
source must be a regular non-symlink `0600` file within the existing bounded
target size. The destination must not exist.

The pure migration:

1. requires exact schema-v5 root fields;
2. preserves every existing collection, record, ordering, preference, setting,
   and Audit Event value;
3. changes `schemaVersion` from `5` to `6`;
4. adds only empty `decisions[]` and `risks[]`; and
5. validates the complete result through the strict schema-v6 validator.

The file command writes and syncs a private temporary file, publishes the
candidate through an exclusive same-directory hard link, verifies strict v6,
mode `0600`, and the candidate revision, and confirms the source revision did
not change. Failure removes only the candidate created by that invocation. It
never overwrites or migrates in place.

The target runtime has no schema-v5 compatibility reader and no dual-write
path. A later live migration requires exact private-data authority, backup and
fingerprint evidence, a no-user-write acceptance window, exact old-release
rollback, and separate release authority.

## Explicit exclusions

The foundation change itself added no Decision or Risk API, mutation service,
projection, navigation, UI, seed record, Demo record, attention signal,
Briefing fact, dependency relationship, Source parser, provider, Jira action,
AI behavior, notification, scoring, ranking, external call, runtime operation,
LaunchAgent operation, live-data read or mutation, or release action. The later
parent-scoped API and browser workflows are documented in
`docs/architecture/DECISION_RISK_MANAGEMENT_WORKFLOWS.md`; their explicit
projection and automation exclusions remain unchanged.

# Work Item Dependency Context

**Status:** Isolated target implementation

**Persisted model:** unchanged strict `schemaVersion: 5`

**API:** existing Work Item triage-detail read

**Application boundary:** single-user, local-only, loopback `127.0.0.1`

## Capability boundary

Work Item Dependency Context exposes dependency links already persisted on a
schema-v5 Work Item. It adds no entity, field, migration, route, write,
attention level, Source parser, provider, Jira action, or runtime behavior.

The selected Work Item detail shows two exact relationship directions:

- **Listed dependencies** are the stable Work Item IDs present in the selected
  Work Item's `dependencies[]`.
- **Work Items listing this item as a dependency** are same-Workspace Work
  Items whose own `dependencies[]` contains the selected Work Item ID.

The projection does not infer relationships from titles, Jira keys, status,
Source text, Evidence, Initiative membership, or proximity. It does not expand
transitive chains or interpret a relationship as blocking, satisfied, causal,
risky, or prioritized.

## Read projection

The existing route remains unchanged:

```text
GET /api/v2/organizations/:organizationId/workspaces/:workspaceId/work-items/:workItemId/triage
```

Its response adds one `dependencyContext` object containing the exact parent
IDs, selected Work Item ID, frozen trust label, listed dependencies,
referencing Work Items, and listed-dependency cue counts. The established
`X-Priorena-Target-Revision` header identifies the persisted snapshot.

Every related Work Item is allowlisted to:

- stable ID;
- nullable Jira key;
- summary;
- nullable Initiative stable ID and name;
- canonical status;
- current-state confidence;
- archived state; and
- review cues for listed dependencies only.

Descriptions, notes, labels, assignees, contacts, current-state provenance,
Source content or metadata, Findings, Evidence, Proposed Change values,
preview hashes, Audit payloads, and private paths are excluded.

## Deterministic review cues

Listed dependencies use this fixed, overlapping cue order:

1. `archived`
2. `blocked-status`
3. `at-risk-status`
4. `unknown-status`
5. `state-needs-confirmation`

Status matching reuses the established case-normalized attention semantics.
Blocked matches exactly `Blocked`. At-risk matches exactly `At risk` or
`At-risk`. Unknown matches exactly `Unknown`. A known status with `inferred`
or `unknown` current-state confidence receives `state-needs-confirmation`.

Cue counts cover all exact listed dependencies and can overlap. Cues are
review context, not a score, severity order, satisfaction assessment, blocker
inference, impact claim, or automatic priority. Absence of a cue means only
that none of these allowlisted conditions is present.

## Parents, ordering, and bounds

The server resolves the Organization, Workspace, and selected Work Item before
calculating any relationship. Every listed dependency is re-resolved through
the exact same-Workspace resolver. Referencing Work Items are selected only
after exact Organization and Workspace filtering. Cross-Initiative links are
shown because schema v5 permits them inside one Workspace. Archived links are
retained and labeled rather than hidden.

Unknown and wrong-parent selected IDs retain the same generic response. The
strict schema-v5 reader already rejects missing, foreign-Workspace, duplicate,
and self dependency IDs before the projection runs.

Both relationship directions sort independently by Jira key or stable ID,
then summary, then stable ID using the established English case-normalized
comparison with exact text as the final tie-breaker. Review cues never
influence ordering.

Each direction returns at most 100 records and declares `total`, `returned`,
`limit`, and `truncated`. The complete dependency context is capped at 1 MiB
and fails closed with the established output-too-large response.

## Browser behavior

The browser validates the revision, exact parent IDs, selected Work Item ID,
trust label, allowlisted record shapes, stable IDs, status-confidence values,
cue vocabulary and derivation, aggregate cue counts, independent bounds,
duplicate absence, truncation declarations, and deterministic ordering before
rendering.

The existing Workspace generation token and Work Item detail request ID discard
late responses after a context or selection change. Dynamic values render only
through text nodes and safe control values. The detail panel contains no
dependency mutation control and issues no follow-on request.

## Required verification

- Exact forward and reverse same-Workspace relationships, including a
  cross-Initiative relationship.
- Exact cue derivation, overlap, fixed order, and non-priority ordering.
- Archived relationship visibility.
- Independent 100-record truncation metadata and the 1 MiB output stop.
- Organization and Workspace isolation with wrong-parent non-disclosure.
- No disallowed Work Item fields, Source content, Evidence, or Proposed Change
  values in the dependency projection.
- Browser rejection of malformed parents, revision, items, cues, counts,
  bounds, duplicates, or ordering.
- Literal safe rendering of hostile-looking fictional values.
- Repeated reads preserve persisted bytes, revision, schema version, and
  collection counts.

## Explicit exclusions

This capability does not implement dependency creation or editing, Decision or
Risk entities, scoring, ranking, automatic prioritization, automatic state
changes, dependency type or lifecycle, dates, owners, Evidence binding,
cross-Workspace links, cycle policy, transitive or critical-path analysis,
inferred blocking, satisfaction, impact, Today or Portfolio changes, Source
parsing, Jira, AI, external calls, schema or seed changes, migration, runtime,
startup, hosting, release, deployment, or merge behavior.

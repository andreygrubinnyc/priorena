# Portfolio and Attention Intelligence

**Status:** Isolated target implementation

**Persisted model:** strict `schemaVersion: 6`; projection behavior unchanged from its schema-v5 introduction

**API namespace:** `/api/v2`

**Application boundary:** single-user, local-only, loopback `127.0.0.1`

## Capability boundary

Portfolio and Attention Intelligence makes existing canonical Priorena state
actionable without creating a score, inferring delivery facts, or changing any
record. It extends the existing read-only projections:

- `GET /api/v2/organizations/:organizationId/portfolio`
- `GET /api/v2/organizations/:organizationId/workspaces/:workspaceId/today`

No schema, seed, route, persistence, import, mutation, provider, Jira,
communication, startup, release, or runtime path is added or changed.

## Grounded signal model

Signals are deterministic counts over already-persisted canonical state. One
record can contribute to more than one signal, so counts are deliberately
described as overlapping review signals and never as a risk score.

Signals are grouped into the first applicable attention level:

1. `urgent`
   - canonical Work Item status is exactly `Blocked` after case normalization;
   - an active Milestone is overdue;
   - an Open or Waiting Follow-Up has an overdue due date.
2. `attention`
   - canonical Work Item status is exactly `At risk` or `At-risk`;
   - an active Milestone is due within the Workspace threshold;
   - an Open or Waiting Follow-Up is not already counted as overdue.
3. `review`
   - a Finding is pending review;
   - a Proposed Change is pending review;
   - an approved Proposed Change is waiting for explicit apply.
4. `readiness`
   - canonical status is `Unknown`;
   - Work Item type is `Unknown`;
   - Initiative is Unassigned;
   - a known canonical status has inferred or unknown current-state confidence.
5. `clear`
   - none of the preceding signals is present.

Completed, done, and cancelled Milestones do not create timing pressure.
Unknown state stays unknown. Current-state confidence is shown separately from
provenance, and accepted Evidence remains separate from pending Findings and
Proposed Changes.

## Portfolio projection

Portfolio validates one Organization before reading any Workspace-owned
collection. Existing Workspace rows and totals remain available. Each active
Workspace also receives:

- one attention level and plain-language label;
- ordered active signals with count, level, and intended product destination;
- grounded counts for status, Follow-Up, Milestone, review, and readiness.

The Organization projection adds a deterministic attention queue ordered by
level, then Workspace name, then stable Workspace ID. The queue returns at most
50 Workspaces and includes explicit total, returned, limit, and truncation
metadata. Archived Workspaces remain visible in the established Workspace list
but do not enter the operational attention queue or attention aggregates.

Portfolio returns no Source content, Source metadata, Evidence excerpts,
Proposed Change values, preview hashes, or cross-Organization records.

## Today projection

Today reuses the same Workspace signal calculation and returns bounded review
collections with at most 50 records per category:

- blocked and at-risk Work Items;
- active Follow-Ups;
- overdue and due-soon Milestones;
- pending Findings;
- pending or approved Proposed Changes represented only by stable identity,
  Work Item, Initiative, field, and review state;
- Work Items with explicit readiness reasons.

The response declares per-category truncation. Proposed values, before values,
Evidence IDs, hashes, and raw Source content are excluded from the new
attention summaries. The established Finding queue continues to expose exact
Finding excerpts under its existing trust boundary. For compatibility with the
existing Today contract, `blockedWorkItems` remains the combined Blocked-or-
At-risk count/list; `atRiskWorkItems` additionally identifies that subset while
the ordered signal model keeps Blocked and At-risk severity distinct.

## Interface behavior

Portfolio presents Organization-level metrics, an overlap/non-score
explanation, a bounded Workspace attention queue, and the established complete
Workspace list. `Open Today` is an explicit action that validates the selected
Workspace through the existing context controller before Today renders.

Today presents one attention summary followed by separate delivery, Follow-Up,
Milestone, Finding, Proposed Change, and readiness cards. Dynamic values render
only through text nodes and safe control values. The interface makes clear that
readiness does not infer or change current state.

## Security and privacy invariants

- Organization and Workspace parents are resolved on the server before any
  signal is calculated.
- Archived Work Items stay outside operational signals.
- Wrong-parent and unknown IDs retain the same generic response.
- Attention reads do not write, audit, normalize, enrich, approve, apply, send,
  or contact an external service.
- Source content and private paths never enter Portfolio.
- New Today summaries expose no raw Source content or Proposed Change values.
- All returned collections and strings remain bounded by existing schema and
  explicit response limits.
- Public fixtures and documentation remain deterministic, fictional, English,
  and free of private runtime or operational evidence.

## Required verification

- Organization isolation in both directions.
- Exact signal categorization and deterministic ordering.
- Overdue versus due-soon Milestone and Follow-Up behavior.
- Pending Finding, pending Proposed Change, and approved-not-applied separation.
- Unknown, Unassigned, and confidence readiness reasons without inference.
- Queue and Today category bounds with explicit truncation.
- No Source content or Proposed Change values in new summaries.
- Persisted revision and document unchanged by attention reads.
- Safe DOM rendering, non-score explanation, responsive signal layout, and
  explicit validated Portfolio-to-Today drill-down.

## Explicit exclusions

This capability does not implement automatic prioritization, numeric scoring,
risk or decision entities, dependency inference, AI analysis, Source parsing,
automatic Evidence acceptance, automatic Proposed Change creation or apply,
Jira writes, Briefing changes, schema migration, seed changes, runtime access,
private-data access, startup operations, hosting, release, or deployment.

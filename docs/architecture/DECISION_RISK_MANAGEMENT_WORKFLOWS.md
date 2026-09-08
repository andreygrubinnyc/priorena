# Decision and Risk management workflows

**Status:** Repository-source target API and browser UI implementation; not released

**Persisted model:** strict `schemaVersion: 6`

**Application boundary:** single-user, local-only, loopback `127.0.0.1`

**Production release:** Not part of this implementation

## Purpose and boundary

This capability activates explicit human management of the separate Decision
and Risk entities introduced by the schema-v6 foundation. It adds bounded,
parent-scoped API reads and writes plus local browser workflows while preserving
the foundation's deliberate absence of scores, rankings, inferred priority,
automation, and external actions.

Decision and Risk records remain outside Search, Today, Portfolio, dependency
context, Source parsing, Briefing facts, and optional AI context in this slice.

## Decision workflow

A Decision begins as a Draft. Creation and editing accept only:

- title;
- optional Initiative;
- optional Work Item;
- zero or more compatible accepted Evidence IDs; and
- an optional earlier Decided Decision to supersede.

Drafts cannot contain an outcome, rationale, decision timestamp, or decision
owner. The irreversible transition is:

```text
Draft -> Decided
```

The user first previews an exact outcome, rationale, and `decidedBy` value. The
preview is bound to the current file revision and a hash of the complete Draft.
Apply must repeat the exact final values, approved preview hash, expected
revision, and actor. A successful apply writes one timestamp to `updatedAt` and
`decidedAt`, appends a bounded Audit Event, and makes the Decision immutable.

Supersession remains explicit and non-mutating. The referenced Decision must be
Decided in the same Workspace before the successor Draft was created, and one
Decision may have at most one successor.

## Risk workflow

A Risk begins Open. Creation and editing accept only:

- title and description;
- optional response plan, owner, and review date;
- optional Initiative and Work Item; and
- zero or more compatible accepted Evidence IDs.

The irreversible transition is:

```text
Open -> Closed
```

Closure uses a revision- and record-hash-bound preview containing the exact
closure note and `closedBy` value. Apply must repeat those values and the
approved preview hash. A successful apply writes one timestamp to `updatedAt`
and `closedAt`, appends a bounded Audit Event, and makes the Risk immutable.

There is no reopen action. A later record may describe a new condition without
rewriting the closed historical Risk.

## Parent, Evidence, and disclosure rules

All reads and writes resolve the exact Organization and Workspace before the
child record. Unknown and wrong-parent child references produce the same public
not-found response.

An optional Initiative and Work Item must be compatible when both are selected.
Every Evidence ID must resolve inside the same Workspace. Evidence explicitly
associated with another Work Item or Initiative is rejected. An Evidence-linked
Work Item must also remain compatible with the effective selected Initiative.

Reads return stored Decision or Risk fields only. They do not include Source
content, file paths, Finding text, Evidence excerpts, unrelated records, or
foreign-parent existence information.

## Browser interaction model

Workspace navigation exposes separate Decisions and Risks destinations. Each
page loads one bounded status-filtered page at a time and validates the exact
Organization, Workspace, lifecycle fields, and file revision before assigning
response data to browser state. Organization or Workspace changes clear all
Decision and Risk browser state, and late responses are ignored.

Create and edit forms use stable-ID Initiative, Work Item, Evidence, and
Decision-supersession choices. Evidence selectors show metadata only and are
locally narrowed to choices compatible with the selected Initiative and Work
Item; the server repeats the authoritative parent and compatibility checks.

Deciding a Draft or closing an Open Risk always follows this sequence:

1. the user enters every required terminal value;
2. the browser requests a write-free, revision-bound server preview;
3. the browser validates the preview against the exact active parents, entity,
   action, revision, and entered values;
4. an in-application modal presents the irreversible result; and
5. only explicit confirmation applies the exact preview hash and values.

Cancellation performs no write. A stale revision or preview conflict requires a
fresh page load and new review. Decided Decisions and Closed Risks render as
read-only history with no edit, reopen, or repeat-transition control.

## Routes

All routes are under:

```text
/api/v2/organizations/:organizationId/workspaces/:workspaceId
```

| Method | Route | Behavior |
| --- | --- | --- |
| `GET` | `/decisions?page=&pageSize=&status=` | Deterministic, bounded Draft/Decided list. |
| `GET` | `/decisions/:decisionId` | Exact parent-scoped Decision read. |
| `POST` | `/decisions` | Create one Draft with expected revision and actor. |
| `PATCH` | `/decisions/:decisionId` | Edit only a Draft's allowed fields. |
| `POST` | `/decisions/:decisionId/decide/preview` | Build a write-free finalization preview. |
| `POST` | `/decisions/:decisionId/decide/apply` | Apply the exact approved finalization. |
| `GET` | `/risks?page=&pageSize=&status=` | Deterministic, bounded Open/Closed list. |
| `GET` | `/risks/:riskId` | Exact parent-scoped Risk read. |
| `POST` | `/risks` | Create one Open Risk with expected revision and actor. |
| `PATCH` | `/risks/:riskId` | Edit only an Open Risk's allowed fields. |
| `POST` | `/risks/:riskId/close/preview` | Build a write-free closure preview. |
| `POST` | `/risks/:riskId/close/apply` | Apply the exact approved closure. |

List page size defaults to 50 and is capped at 100. Status vocabularies remain
exactly `draft | decided` and `open | closed`.

## Audit actions

Successful writes append one exact Workspace-owned Audit Event using only
bounded hashes for before/after state:

- `decision-created`;
- `decision-updated`;
- `decision-decided`;
- `risk-created`;
- `risk-updated`; and
- `risk-closed`.

Preview, list, detail, invalid, stale, wrong-parent, and hash-conflict requests
do not write or append Audit Events.

## Explicit exclusions

This capability adds no seed or Demo records, Decision-to-Risk relationship,
deletion, reopening, score, probability, severity, impact, ranking, inferred
priority, automatic owner, automatic due date, automatic transition,
notification, Jira action, provider or AI behavior, external call, schema
migration execution, runtime operation, LaunchAgent operation, private/live-data
access or mutation, release, or merge.

## Verification

Synthetic tests cover Draft and Open creation, editing, bounded list/detail
reads, exact parent and Evidence isolation, supersession, preview write-freedom,
preview-hash conflicts, stale revisions, terminal immutability, audit actions,
unknown fields, prohibited scoring fields, pagination bounds, exact client
routes, response validation, context clearing, inert rendering, confirmation
copy, and bounded browser selectors. The complete repository security, syntax,
regression, build, legacy, release-rehearsal, and dependency gates remain
required before publication.

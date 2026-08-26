# Evidence-to-Current-State Review

**Status:** Isolated target implementation

**Persisted model:** strict `schemaVersion: 5`

**API namespace:** `/api/v2`

**Application boundary:** single-user, local-only, loopback `127.0.0.1`

## Capability boundary

Evidence-to-Current-State Review completes the human-reviewed path from one
explicitly selected existing Source to one supported canonical Work Item field.
It reuses the schema-v5 Source, Finding, Evidence, Proposed Change, Work Item,
and Audit Event records. It adds no schema, migration, compatibility reader,
dual write, seed, dependency, provider, Jira, communication, or runtime path.

The trust layers remain separate:

```text
Untrusted Source claim
        ↓ exact excerpt selected by the user
Pending Finding
        ↓ explicit currentness and association review
Accepted Evidence
        ↓ write-free preview and separate pending review
Proposed Change
        ↓ separate approval and revision-bound apply
Canonical Work Item current state
```

Creating a Finding does not create Evidence or change a Work Item. Accepting a
Finding creates Evidence but does not create a Proposed Change. Creating or
approving a Proposed Change does not apply it. Only applying an approved,
still-current Proposed Change updates its one named Work Item field. Evidence
remains unchanged and historical after application.

## Existing read projections

The workflow composes existing parent-scoped reads:

- Source lists return safe metadata only and omit content, raw metadata, and
  managed paths.
- One explicitly selected Source detail may return bounded content after exact
  Organization, Workspace, and Source validation.
- Source-scoped Finding and Evidence reads validate the complete Source parent
  chain.
- The Finding review queue remains bounded to 100 records per server request;
  the UI uses 25 pending Findings per page.
- Workspace Evidence, Proposed Change, and safe Work Item projections remain
  available through their established bounded reads.

Every successful response carries the persisted target revision. The client
accepts selected Source content and pending Finding pages only when the response
parents and revision still match the current validated Workspace snapshot.
Generation tokens prevent late responses from repopulating an earlier context.

## Source-scoped Finding creation

The only new route is:

```text
POST /api/v2/organizations/:organizationId/workspaces/:workspaceId/sources/:sourceId/findings
```

The exact body is:

```json
{
  "expectedRevision": "<sha256>",
  "actor": "local-target-ui",
  "finding": {
    "startOffset": 10,
    "endOffset": 42,
    "exactExcerpt": "Exact fictional text selected by the user.",
    "category": "status",
    "currentness": "unknown",
    "proposedWorkItemId": null,
    "proposedInitiativeId": null
  }
}
```

All objects use exact-key validation. Offsets are zero-based UTF-16 string
offsets. They must be ordered integers inside the current non-empty Source
content, and `source.content.slice(startOffset, endOffset)` must equal the
submitted excerpt. The excerpt is non-empty and limited to 50,000 characters.
Category is non-control text limited to 100 characters. Currentness is exactly
`current`, `historical`, `contradicted`, or `unknown`.

Both proposed association fields are explicit and nullable. A selected Work
Item and Initiative share the exact Organization and Workspace, and the
Initiative must exactly equal the Work Item's current nullable Initiative. The
server fixes the extraction method and version, pending review status, and null
supersession state. Offsets validate the selection but are not persisted in
schema v5.

One revision-aware atomic write creates only the Finding and one hashed Audit
Event. The Source, Evidence, Proposed Changes, and Work Items remain unchanged.
Unknown and wrong-parent Source, Work Item, and Initiative IDs use the same
generic not-found response without existence or parent hints.

## Finding review and Evidence acceptance

Rejection accepts only expected revision, actor, and `decision: "reject"`.
It marks the pending Finding rejected, appends a hashed Audit Event, and creates
no Evidence.

Acceptance requires every reviewed value explicitly:

```json
{
  "expectedRevision": "<sha256>",
  "actor": "local-target-ui",
  "decision": "accept",
  "currentness": "current",
  "workItemId": "work-item-id-or-null",
  "initiativeId": "initiative-id-or-null"
}
```

The selected Finding must still be pending. The Source, Finding, Work Item, and
Initiative must share exact parents. When a Work Item is selected, the submitted
Initiative must exactly equal its current nullable Initiative, including the
Unassigned case. Acceptance updates the Finding to the reviewed currentness and
accepted state and creates one Evidence record in the same atomic write.

Evidence copies the exact Source ID and date, Finding ID and excerpt, reviewed
currentness and associations, actor, and timestamp. Separate hashed Audit Events
record Finding acceptance and Evidence creation. Duplicate acceptance, stale
revision, invalid association, or a foreign parent fails without a write. The
bounded bulk-review route follows the same explicit acceptance selection.

## Proposed Change workflow

The interface reuses the established four server commands:

1. `POST .../proposed-changes/preview`
2. `POST .../proposed-changes`
3. `POST .../proposed-changes/:proposedChangeId/review`
4. `POST .../proposed-changes/:proposedChangeId/apply`

Supported fields remain:

- `canonicalStatus`
- `sourceStatus`
- `assignee`
- `sprint`
- `currentStateConfidence`
- `currentStateProvenance`
- `lastCapturedCommentAt`

The user selects an exact Work Item, one or more compatible accepted Evidence
IDs, one field, and a typed proposed value. At least one Evidence record must
derive from the accepted Finding. Every Evidence record must share the exact
Organization and Workspace, must not name another Work Item, and must not name
an incompatible Initiative.

Preview is read-only. It returns the exact current and proposed values, stable
targets, Evidence IDs, expected revision, and SHA-256 preview hash. Pending
creation reconstructs the preview at that revision and hash. Approve and reject
are separate atomic writes. Approval does not apply. Apply requires approved
state, the latest expected revision, stored snapshot hash, unchanged target
value, and revalidated Evidence compatibility.

A successful apply changes exactly one Work Item field, marks the Proposed
Change applied, and appends hashed Audit Events in one atomic write. Evidence
content, provenance, acceptance values, and currentness remain unchanged.
Revision races return `REVISION_CONFLICT`; an altered hash, target value, or
compatibility state returns `PREVIEW_CONFLICT`. The UI discards draft preview
and confirmation state on conflicts. A stale Proposed Change remains visible
and read-only; the user must construct a fresh write-free preview.

## Interface and accessibility

Source Library retains metadata-only rows and adds an explicit `Open Source`
action. Selected content appears in a labeled read-only textarea through its
`value`. Native textarea selection offsets establish the exact excerpt. The
user reviews the excerpt, category, currentness, and associations before an
in-application confirmation that states only a pending Finding will be created.

Review provides pending Finding pagination, Source provenance, exact excerpts,
explicit acceptance controls, accepted Evidence cards, a typed Proposed Change
composer, write-free preview, pending approval or rejection, and exact apply
review. Completed, rejected, and stale records remain visibly labeled and
read-only. After every mutation, the client reloads the full Workspace snapshot
before enabling the next consequential action.

All actions are keyboard-operable ordinary controls. Consequential actions use
the accessible application dialog. Layouts collapse to one column on narrower
screens, selected Source panels stop being sticky, controls wrap, visible focus
remains enabled, and reduced-motion preferences remain honored.

## Security and privacy invariants

- Startup remains bound to `127.0.0.1`, with loopback Host validation before
  body parsing.
- Mutation requests retain same-origin and cross-site Fetch Metadata checks.
- Organization and Workspace isolation, wrong-parent non-disclosure, whole-
  document validation, exact revisions, and atomic writes remain authoritative.
- Source content is absent from lists, URLs, public errors, Audit payloads, and
  Proposed Change hashes.
- Source, excerpt, category, provenance, actor, Work Item, and proposed values
  render only through `textContent`, text nodes, textarea `value`, or safe form
  values. No HTML, Markdown, prompt, or URL execution is introduced.
- No network client, external provider, Jira mutation, message sender,
  analytics, telemetry, automatic approval, or automatic current-state change
  exists in this workflow.
- Public tests and documentation remain deterministic, fictional, English-only,
  and contain no private Source content, operational identifiers, paths, logs,
  screenshots, credentials, or runtime evidence.

## Explicit exclusions

This capability does not authorize or implement schema, seed, persistence,
dependency, startup, release, compatibility, dual-write, migration, hosting,
LAN, multi-user, provider, Jira, communication, runtime, backup, private-data,
merge, deployment, or release changes.

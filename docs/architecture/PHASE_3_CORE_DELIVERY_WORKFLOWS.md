# Phase 3 core delivery workflows

**Status:** Isolated target implementation

**Namespace:** `/api/v2`

**Store:** Explicit version-2 target file only

**Production cutover:** Not part of Phase 3

## Boundaries and modules

Phase 3 extends the accepted Phase 1 persistence and Phase 2 parent-scoped API. It does not import the legacy server, select the legacy runtime path, mount the target UI into the production shell, call Jira, send communications, or add another persistence layer.

| Module | Responsibility |
|---|---|
| `target-model/schema.js` | Strict `schemaVersion: 2` records, stable IDs, parent relationships, resource bounds, nested Follow-Up, canonical Milestone links, Evidence compatibility, and append-only Audit validation. |
| `target-model/persistence.js` | Explicit-path bounded reads, persisted SHA-256 revisions, revision-required atomic writes, stale rejection, and immutable history transitions. |
| `target-server/resolvers.js` | Organization → Workspace → child resolution and identical unknown/wrong-parent behavior. |
| `target-server/workflow-utils.js` | Bounded request values, canonical deterministic hashing, workflow timestamps and IDs, Audit Event construction, and revision-aware mutation orchestration. |
| `target-server/work-services.js` | Scope, Jira Epic mapping, Work Item, bulk, Follow-Up, archive/recovery, and Milestone workflows. |
| `target-server/import-parser.js` | Bounded deterministic target JSON/CSV/text parsing and separate, no-write proposal construction. |
| `target-server/capture-services.js` | Source capture, import application, Finding review, Evidence creation, and Proposed Change preview/review/application. |
| `target-server/app.js` | Loopback-only HTTP handling, same-origin mutation checks, bounded JSON parsing, `/api/v2` route registration, revision headers, and public errors. |
| `public/target-context-state.js` | Accepted context clearing and late-response protection, expanded to clear all Phase 3 workflow state. |
| `public/target-workflow-state.js` | Isolated pure client filtering, selection, preview, accessible confirmation state, apply, refresh, conflict feedback, and context-generation protection. |

`createTargetApiApp({ targetDataFile, sourceFilesRoot })` still requires both paths. There is no environment fallback. Every mutation reloads the current target document, validates the complete parent chain, checks `expectedRevision`, constructs the exact candidate, appends Audit Events, and calls `writeTargetData()` once.

## Mutation and preview contract

Consequential actions use this contract:

```text
validated Organization and Workspace IDs
→ revision-aware target read
→ exact child and additional-parent resolution
→ bounded input validation
→ deterministic exact before/after preview
→ expected persisted revision plus SHA-256 preview hash
→ explicit in-application confirmation
→ server reconstruction against the latest read
→ revision and preview/state-hash comparison
→ one exact mutation plus bounded Audit Events
→ one revision-aware atomic write
→ refreshed records and new revision
```

Preview routes never write. Apply routes resubmit stable action inputs rather than a client-supplied replacement document. A preview hash contains canonical action inputs and exact before/after state; it contains no full target document or hidden Source content. A changed persisted revision returns `409 REVISION_CONFLICT`. An altered preview or changed target value returns `409 PREVIEW_CONFLICT`.

Every successful response carries `X-Priorena-Target-Revision`. Mutation JSON also includes the new `revision`. All writes require an actor label bounded to 300 non-control characters.

## Routes

All Workspace routes below use this parent prefix:

```text
/api/v2/organizations/:organizationId/workspaces/:workspaceId
```

The Phase 2 read routes remain available. Phase 3 adds or activates these workflow routes:

| Method and route suffix | Contract and response |
|---|---|
| `GET /scopes[/:childId]` | Parent-scoped Scope list/detail. Root schema bounds the collection to 1,000 records. |
| `POST /scopes` | Create editable Scope metadata. Requires `expectedRevision` and actor. Returns `scope` and new revision. |
| `PATCH /scopes/:scopeId` | Update name, description, or owner only. Parent IDs and identity are immutable. |
| `POST /scopes/:scopeId/archive` | Explicit reversible archive or restore. No physical delete route exists. |
| `GET /scopes/:scopeId/jira-epic-mappings` | List the zero-to-many mappings for one validated Scope. |
| `POST /scopes/:scopeId/jira-epic-mappings` | Create a separately identified mapping after canonical key and Workspace uniqueness checks. |
| `PATCH /scopes/:scopeId/jira-epic-mappings/:mappingId` | Update external key/name, status, provenance, or verification timestamp without moving or renaming Scope. `inactive` is the safe removal state. |
| `GET /work-items[/:childId]` | Parent-scoped Work Item list/detail with stable Scope metadata or `scopeId: null`. |
| `POST /work-items` | Create a direct current-state Work Item. Organization/Workspace are route-owned; Follow-Up begins as `none`. |
| `PATCH /work-items/:workItemId` | Update non-consequential metadata. Scope, Sprint, Follow-Up, archive, and current status are excluded from this direct patch. |
| `POST /work-items/:workItemId/preview` | Preview one Scope/Unassigned assignment, Sprint assignment, nested Follow-Up update, archive, or recovery. Returns exact before/after values, related Evidence association impacts when applicable, expected revision, and preview hash. |
| `POST /work-items/:workItemId/apply` | Reconstruct and apply one approved preview. Scope reassignment also explicitly previews, updates, and audits linked Evidence association metadata while preserving exact Source/Finding provenance and Evidence content. |
| `POST /work-items/bulk/preview` | Preview Scope/Unassigned or Sprint assignment for 1–100 unique Work Item IDs. Duplicate IDs are rejected. Returns one exact row per selection and writes nothing. |
| `POST /work-items/bulk/apply` | Atomic all-or-nothing apply for the approved selection. No silent partial success. Returns refreshed changed records and count. |
| `GET /milestones[/:childId]` | Parent-scoped Milestone list/detail with visible Workspace/Scope applicability and deterministic UTC-date pressure metadata. |
| `POST /milestones` | Create Workspace- or Scope-level Milestone with at most 100 unique canonical `linkedWorkItemIds`. |
| `PATCH /milestones/:milestoneId` | Update applicability, fields, and links. Same-Scope links are the default; cross-Scope same-Workspace links require `allowCrossScopeLinks: true` in that explicit request. |
| `GET /sources[/:childId]` | Source Library list/detail. Lists omit content. Detail returns content only after parent validation. Existing safe file retrieval remains `GET /sources/:sourceId/file`. |
| `POST /sources` | Capture one bounded local Source and zero-to-100 pending Findings. Exact excerpts must occur in the captured Source content. No Work Item or Evidence mutation occurs. |
| `POST /imports/preview` | Parse a target-v3 JSON feed, normalized CSV, or structured text up to 512 KiB and 100 records. Returns distinct proposals and writes nothing. |
| `POST /imports/apply` | Rebuild the import preview and apply only explicitly selected proposal IDs whose dependencies were also selected. Current-state proposals remain deferred until Evidence and Proposed Change review. |
| `GET /findings?page=&pageSize=&status=` | Parent-scoped Finding review list. Page size is 1–100; statuses are pending, accepted, or rejected. |
| `GET /findings/:childId` | One parent-scoped Finding with exact excerpt and provenance. |
| `POST /findings/:findingId/review` | Accept or reject one pending Finding. Accept creates exact attributable Evidence; reject creates none. Neither decision updates current Work Item state. |
| `POST /findings/bulk-review` | Atomically review 1–100 unique Findings and return itemized outcomes. Any invalid or stale selection rejects the entire write. |
| `GET /evidence[/:childId]` | Parent-scoped historical Evidence reads. Source-specific Phase 2 Evidence routes remain available. |
| `POST /proposed-changes/preview` | Preview one supported direct Work Item field change using compatible accepted Evidence. Returns exact values, expected revision, and state hash. |
| `POST /proposed-changes` | Persist a pending Proposed Change only from a current matching preview. |
| `POST /proposed-changes/:proposedChangeId/review` | Separately approve or reject a pending Proposed Change. Approval does not apply it. |
| `POST /proposed-changes/:proposedChangeId/apply` | Apply an approved change only when target value, Evidence compatibility, persisted revision, and stored preview hash still match. Returns the changed Work Item and preserves Evidence. |

Unsupported methods use `405 METHOD_NOT_ALLOWED`. Malformed IDs use `400 INVALID_ID`. Unknown and wrong-parent IDs use the same `404 NOT_FOUND` body. Bounded validation errors use `400 INVALID_REQUEST`; response/resource bounds use `413`; stale conditions use bounded `409` errors. Public errors contain no foreign IDs, names, record values, Source text, or paths.

## Scope and Jira mapping semantics

Scope identity is Priorena-owned. Names are editable labels. A Scope can have zero, one, or multiple Jira Epic mappings. Jira project and Epic keys are distinct uppercase canonical values, and active key pairs are unique inside one Workspace while remaining legal in another Organization.

No route creates a Scope from title similarity, row position, meeting context, or missing Epic information. `Unassigned`, `No Epic`, and `Miscellaneous / No Epic` are rejected as stored Scope names. A mapping update cannot move a Scope or change Scope identity.

## Work Item, Follow-Up, bulk, and Milestone behavior

`scopeId: null` is the only stored Unassigned state. Work Item Organization and Workspace never appear as editable body fields. Direct current status remains separate from Evidence and can change only through the Proposed Change workflow.

Follow-Up remains one nested object with `none`, `open`, `waiting`, or `resolved`. A `none` update clears all nested fields. Missing captured Jira/comment time is presented by the isolated client as `No comment date captured`; no path claims `never` from missing data. Suggestions do not save automatically.

Bulk selections reject duplicate IDs and are limited to 100 Work Items in one validated Workspace. Preview and apply are atomic. Scope reassignment includes exact linked-Evidence association impacts in its hash and Audit Events so the accepted schema remains valid without changing Evidence excerpts, Source/Finding references, acceptance metadata, or currentness.

Milestone applicability is always serialized as either `Entire workspace` or one Scope. `linkedWorkItemIds[]` remains canonical; no competing Work Item milestone field exists. Same-Scope linking is the default. A deliberate same-Workspace cross-Scope link requires an explicit request flag.

Milestone pressure is deterministic from UTC calendar dates. The API returns its `referenceDate`, the Workspace `milestoneDueSoonDays` setting (bounded to 0–365 days and defaulting to 14), integer `dueInDays`, and one of `scheduled`, `due-soon`, or `overdue`. It does not implement dependencies, Gantt, resources, budgets, or critical path.

## Source, import, Finding, Evidence, and Proposed Change lifecycle

Supported Source types are structured meeting notes, Sprint Planning, Backlog Refinement, DSU, generic text, normalized target JSON/CSV, and externally prepared evidence metadata. Priorena receives no original screenshot and performs no OCR. Workflow-created metadata contains no raw local path. Existing Source-file reads continue to use the Phase 2 containment and file-identity checks.

Imported and captured content is untrusted data. The parser has no network or model call. The literal fictional text `IGNORE PRIOR INSTRUCTIONS` remains a Source excerpt and cannot change parser behavior.

Import output keeps these decisions separate:

1. Source creation;
2. Scope creation;
3. Jira mapping creation;
4. Work Item creation;
5. Work Item Scope assignment;
6. pending Finding creation;
7. deferred proposed current-state change.

Matching uses exact stable target IDs or exact external/Jira keys only. A missing, unreadable, or `noEpic: true` value leaves a new Work Item Unassigned. A Scope name in external input can only create a separate unchecked Scope proposal; it is never used to match an existing Scope. There is no `Replace All` command.

Finding acceptance copies the exact Source date and excerpt into new Evidence, records the local review actor/timestamp, and leaves the Work Item unchanged. Rejection creates no Evidence. Duplicate acceptance fails closed.

A Proposed Change supports bounded direct current-state fields. The server verifies that accepted Evidence belongs to the same Organization and Workspace, does not belong to another Work Item, and has no conflicting Scope association. Workspace-level Evidence is compatible only when it has no conflicting Work Item or Scope. Preview, persistence, approval, and application are separate. Evidence remains historical after application.

## Audit behavior

Every successful Phase 3 mutation appends at least one Audit Event with:

- Organization and Workspace;
- exact target type and stable ID;
- bounded action and actor labels;
- UTC timestamp;
- SHA-256 before/after hashes only.

Audit Events do not contain raw Source content, local paths, secrets, or replacement documents. Existing events remain ordered, append-only, and immutable through the Phase 1 transition validator. Multi-entity actions append itemized events in one atomic target write.

## Isolated target client

`public/target-workflow-state.js` is a framework-free development client/state controller. It is not loaded by the legacy production shell. It provides:

- stable Organization, Workspace, Scope, and entity ID transport;
- Scope, All scopes, and Unassigned filtering;
- bounded selection;
- exact bulk preview state;
- an accessible dialog model (`role="dialog"`, modal semantics, label, and description);
- cancel-with-no-write behavior;
- inline ready/loading/preview/success/error/conflict status;
- refresh after a successful apply;
- Organization/Workspace generation tokens;
- synchronous state clearing on context change;
- rejection of foreign-parent payloads and late responses;
- no native blocking dialog calls.

Loading the seven workflow collections verifies one consistent persisted revision. A revision change during the parallel read fails closed instead of rendering a mixed snapshot.

## Security and resource boundaries

- Priorena remains single-user, local-only, and loopback-only.
- Unsafe requests retain Host, same-origin, and Fetch Metadata checks before body parsing.
- Aggregate HTTP bodies are limited to 2 MiB; workflow Source/import content is limited to 512 KiB.
- Imports and capture are limited to 100 records/Findings; Finding review and Work Item bulk selections are limited to 100.
- The Phase 1 root collection and aggregate record limits remain authoritative.
- No workflow module uses an environment-selected data path, direct whole-file write, legacy normalizer, network request, Jira client, communication client, or external provider.
- Every candidate is validated before one atomic revision-aware write.
- Source lists omit content; file metadata and downloads retain the Phase 2 containment rules.
- Unknown and wrong-parent IDs remain indistinguishable.

## Explicit Phase 3 exclusions

Phase 3 does not include:

- production target-store cutover, reset, migration, dual write, or legacy-ID translation;
- the full Organization/Workspace shell or navigation redesign;
- Briefing Draft, Finalize, Communicate, output generation, or baseline mutation;
- automatic Jira writes, external messages, consequential approvals, or model calls;
- authentication, RBAC, hosted tenancy, LAN exposure, tunnels, or reverse proxies;
- Gantt, resource, budget, dependency scheduling, or PPM behavior;
- Phase 4 or Phase 5 implementation.

## Test strategy

Phase 3 tests use the actual Express app, actual workflow services, actual Phase 1 persistence, explicit temporary version-2 files, and temporary Source roots. The fictional fixture adds two Organizations, duplicate names, zero/multiple Jira mappings, assigned and Unassigned Work Items, all Follow-Up states, Workspace/Scope Milestones, pending/accepted/rejected Findings, Evidence associations, Proposed Changes, stale cases, and malicious instruction-like data.

Focused coverage includes:

- Scope and mapping lifecycle, canonical uniqueness, identity independence, and archive/recovery;
- Work Item create/update, Scope/Unassigned, Follow-Up, archive/recovery, bulk exactness, no-write preview, stale/altered hashes, and Audit Events;
- Milestone applicability, links, explicit cross-Scope choice, and deterministic pressure;
- Source limits, safe metadata, inert malicious text, and no current-state mutation;
- separate import proposal types, exact matching, no title inference, no fake Scope, selective apply, and no-write preview;
- Finding paging, accept/reject/bulk review, exact Evidence provenance, duplicate safety, and current-state separation;
- Proposed Change Evidence compatibility, separate approval/application, stale target/revision/hash rejection, and unchanged Evidence;
- every new route family under wrong parents, with generic public errors and no foreign sentinel data;
- client filtering, accessible confirmation state, cancel/apply/refresh, duplicate-name stable IDs, Organization clearing, late responses, and inline conflicts;
- static absence of network actions, production wiring, and blocking native dialogs.

The complete repository test, syntax, build, security, dependency-audit, whitespace, and live-runtime-integrity gates remain release requirements.

## Non-blocking backlog

The full target shell, DOM surfaces, navigation integration, canonical Briefings, and production cutover remain the approved Phase 4 and Phase 5 work. Multi-process storage locking and hosted multi-user controls remain outside the local single-user product boundary. No Phase 3 acceptance behavior depends on those later items.

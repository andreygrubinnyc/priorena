# Priorena Clean-Cutover Implementation Plan

**Status:** Proposed implementation plan; no implementation or runtime-data change is authorized by this document
**Target hierarchy:** Organization → PM Workspace → Scope → Work Item
**Cutover approach:** Clean reset, not migration
**Authority:** `PRIORENA_TARGET_PRODUCT_MODEL_SPEC.md`, `docs/audits/PRIORENA_TARGET_MODEL_GAP_ANALYSIS.md`, and the approved disposable-runtime-data decision

## 1. Decision and implementation contract

The current local runtime data is disposable. The implementation must not create an item-level migration, reconciliation package, tombstone system, legacy-ID translation manifest, dual-write mechanism, or compatibility layer solely to retain it. This applies to the existing Work Items, Project/Jira Epic records and assignments, `Miscellaneous / No Epic`, Sources, Findings, Evidence, recorded updates, Follow-Up state, Milestones, Briefings and versions, baselines, history, IDs, mutable Workspace-name references, and feed state.

The clean cutover does **not** weaken the product's continuing safety requirements:

- explicit human review and approval;
- exact, attributable evidence;
- preview before consequential changes;
- stale-value protection at approval time;
- no automatic Jira writes;
- no automatic communication;
- grounded, deterministic final output;
- strict Organization and Workspace parent validation on the server;
- no cross-Organization data in queries, UI responses, exports, backups, Briefings, Source/Evidence access, or AI context.

The current runtime file remains untouched while the target is built and verified. Development and automated tests use temporary target-shaped data files. At cutover, the only preservation step is one timestamped byte-for-byte backup plus a recorded SHA-256 checksum.

## 2. Proposed clean target schema

### 2.1 Root shape

Use a versioned, normalized root document. Normalization makes parent validation and Organization-scoped filtering explicit while retaining the current local JSON persistence approach.

```text
PriorenaData
├─ schemaVersion: 2
├─ organizations[]
├─ workspaces[]
├─ scopes[]
├─ jiraEpicMappings[]
├─ workItems[]
├─ milestones[]
├─ sources[]
├─ findings[]
├─ evidence[]
├─ proposedChanges[]
├─ briefings[]
├─ briefingVersions[]
├─ auditEvents[]
├─ userPreferences
└─ globalTechnicalSettings
```

`schemaVersion` is mandatory and validated before reads or writes. Unknown future versions fail closed; the server must not normalize and overwrite them.

### 2.2 Entity ownership and key fields

| Entity | Required ownership and identity | Target behavior |
|---|---|---|
| Organization | Stable globally unique `id`; editable `name` | Top-level tenant boundary. Names are labels, never lookup identity. |
| PM Workspace | Stable `id`; required `organizationId`; editable `name` | Belongs to exactly one Organization. Normal movement to another Organization is rejected. |
| Scope | Stable `id`; required `organizationId` and `workspaceId`; editable `name` | Represents a meaningful delivery boundary. May have zero, one, or many Jira Epic mappings. |
| Jira Epic Mapping | Stable `id`; required Organization/Workspace/Scope parents; external Jira project/Epic identity | Optional external mapping, not Scope identity. Uniqueness is enforced within the correct Organization/integration boundary. |
| Work Item | Stable `id`; required Organization/Workspace parents; nullable `scopeId` | `scopeId: null` is the only unassigned representation. Current status, assignee, sprint, comment, comment timestamp, and confidence are direct current-state fields. Jira issue identity is optional external metadata. |
| Follow-Up | Nested on one Work Item | States are None, Open, Waiting, and Resolved. It does not create a separate delivery hierarchy. |
| Milestone | Stable `id`; required Organization/Workspace; nullable `scopeId` | `scopeId: null` means Workspace-level; otherwise the Scope must belong to the same Workspace and Organization. |
| Source | Stable `id`; required Organization/Workspace | Stores source type, provenance, capture metadata, safe file metadata, processing state, and source-level text/data as permitted. |
| Finding | Stable `id`; required Organization/Workspace and `sourceId` | Extracted candidate with Pending, Accepted, or Rejected review state. Acceptance alone does not mutate Work Item current state. |
| Evidence | Stable `id`; required Organization/Workspace and accepted Finding/Source provenance | Historical, attributable evidence. It remains separate from current Work Item fields. Optional Work Item/Scope links must validate within the same parents. |
| Proposed Change | Stable `id`; required Organization/Workspace; target entity/field; proposed value; expected-state hash; approval state | Previewed separately from Evidence acceptance. Application requires explicit approval and a current stale-value check. |
| Briefing | Stable `id`; required `organizationId` | Canonical communication definition. May select one or more Workspaces in the same Organization and optional Scopes within them. |
| Briefing Version | Stable `id`; required Organization and `briefingId`; immutable snapshot after finalization | Lifecycle is Draft → Finalized → Communicated. Only Communicated advances the last-communicated baseline. |
| Audit Event | Stable `id`; required Organization and applicable Workspace/entity references | Records preview, approval/rejection, application, finalization, communication, actor/session, timestamp, and before/after hashes without storing secrets. |
| User Preferences | `activeOrganizationId` and per-Organization active Workspace IDs | Convenience state only. Every saved ID is revalidated by the server before use. |

All child records carry explicit parent IDs even if stored in a collection whose context seems implicit. The server validates the full parent chain on create, read, update, delete, export, prompt assembly, and file retrieval. A known child ID supplied with the wrong Organization or Workspace must return no data and must not reveal whether the record exists elsewhere.

### 2.3 Important invariants

1. Every Workspace belongs to exactly one Organization.
2. Every Scope belongs to exactly one Workspace and the same Organization.
3. A Work Item belongs to one Workspace and zero or one Scope in that Workspace.
4. No catch-all or `Miscellaneous / No Epic` Scope is created.
5. A Scope can exist without a Jira Epic; Jira names and keys never rename or identify a Scope.
6. A Milestone is Workspace-level or Scope-level, never globally unowned.
7. Accepted Evidence is historical support; it never silently becomes current Work Item state.
8. Proposed Changes require preview, explicit approval, and stale-value validation.
9. Briefing snapshots and finalized output are immutable; communication is explicit and recorded.
10. Organization filtering occurs on the server before serialization or AI prompt construction.

## 3. Proposed seed structure

The committed seed is fictional, deterministic, target-shaped, and intentionally sparse. A real local-instance bootstrap file is environment-specific private configuration and is excluded from version control. Generic product onboarding starts without hardcoded customer data.

| Type | Stable seed ID | Name | Parent | Additional seed state |
|---|---|---|---|---|
| Organization | `org-example` | Example Organization | None | Active fictional fixture |
| PM Workspace | `workspace-example-data-analytics-delivery` | Data & Analytics Delivery | `org-example` | Default editable Workspace settings |
| Scope | `scope-example-regulatory-reporting` | Regulatory Reporting | Data & Analytics Delivery | No Jira Epic mapping |
| Scope | `scope-example-capacity-planning` | Capacity Planning | Data & Analytics Delivery | No Jira Epic mapping |
| Scope | `scope-example-bi-modernization` | BI Modernization | Data & Analytics Delivery | No Jira Epic mapping |
| Scope | `scope-example-master-data-management` | Master Data Management | Data & Analytics Delivery | No Jira Epic mapping |

The seed contains no Work Items, Jira Epic mappings, Sources, Findings, Evidence, Proposed Changes, Milestones, Briefings, Briefing Versions, or migrated history. It does not contain `Miscellaneous / No Epic` or any other catch-all Scope. Automated isolation tests use a separate fictional fixture with at least two Organizations, duplicate Workspace/Scope names where helpful, and clearly distinguishable sentinel text; that fixture is never the default runtime seed.

New runtime records use generated stable IDs. Seed IDs are fixed constants, not derived at lookup time from mutable names.

## 4. Five-phase implementation plan

### Phase 1 — Clean target schema and seed

**Estimated risk:** Medium. The data is disposable, but a permissive parser or ambiguous parent model would propagate defects into every later phase.

**Objective**

Establish the versioned target domain, validation rules, persistence boundary, deterministic clean seed, and fictional multi-Organization test fixture without touching the current runtime file.

**Exact in-scope behavior**

- Add the root `schemaVersion` and strict target-schema validator.
- Define stable-ID entities and all parent-chain invariants from Section 2.
- Add a clean-seed factory containing the fictional Example Organization, Data & Analytics Delivery, and the four fictional Scopes only.
- Represent unassigned Work Items only as `scopeId: null` and UI label metadata as `Unassigned`.
- Represent Jira Epic identity only through optional mapping records.
- Add target read/write functions that accept an explicit data-file path, validate before persistence, write atomically, and never fall back to name identity.
- Add a fictional two-Organization fixture for isolation tests.
- Run target development against a temporary data file; retain the existing runtime and old application unchanged.

**Explicitly out of scope**

- Reading, translating, reconciling, or importing the current runtime data.
- A dual-schema canonical store, dual writes, ID aliases, tombstones, or a migration manifest.
- Public target APIs, production navigation, or live cutover.
- Creating initial Work Items, Jira mappings, Sources, Milestones, or Briefings.

**Likely files and modules affected**

- New domain/persistence modules under a target-oriented directory such as `domain/` or `data/`.
- `demo/demo-fixture.js` or a replacement target fixture module.
- New focused tests under `test/` and target fixtures under `test/fixtures/`.
- `server.js` only to inject/select a target data store in test/development mode; no legacy route removal yet.
- `package.json` only if a dedicated validation or target-start script is needed.

**Schema changes**

- Introduce the complete version-2 root and entities in Section 2.
- Make Organization/Workspace parent IDs mandatory on all applicable records.
- Make Work Item and Milestone `scopeId` nullable with strict same-parent validation.

**API changes**

- No public endpoint cutover.
- Add internal repository/service interfaces that require Organization and Workspace IDs and never accept mutable names as identity.

**UI changes**

- No production UI change.
- Test/demo harnesses may render target fixtures only to validate labels such as `Unassigned`.

**Tests**

- Valid clean seed and invalid/unknown schema versions.
- Round-trip persistence to a temporary file, atomic-write failure, malformed input, and corrupt-input no-overwrite behavior.
- Duplicate Workspace names in two Organizations and duplicate Scope names in different Workspaces.
- Parent mismatch, cross-Organization child links, invalid Scope assignment, and illegal Workspace movement.
- Scope with zero and multiple Jira mappings; Jira rename leaves Scope unchanged.
- Deterministic seed IDs and exact absence of forbidden seed records.

**Acceptance criteria**

- The clean seed validates with `schemaVersion: 2` and reloads without semantic change.
- The four approved Scopes are present under the one approved Workspace and Organization; all prohibited/legacy records are absent.
- Every invalid parent combination fails closed.
- Tests operate only on temporary files and do not change the current runtime file.

**Rollback considerations**

- Revert the phase commits; no runtime rollback is required because the live file was not read or written by target code.
- Keep schema and seed changes in isolated commits so later phases cannot obscure validation failures.

**Dependencies**

- Approved target specification and clean-reset decision.
- No dependency on legacy record review or ID preservation.

### Phase 2 — Organization-isolated server and APIs

**Estimated risk:** High. A single missed global query, file path, export, or prompt input can leak data across Organizations.

**Objective**

Make Organization and Workspace context mandatory in server data access and expose only parent-validated, Organization-scoped APIs.

**Exact in-scope behavior**

- Resolve every request from stable Organization and Workspace IDs on the server.
- Filter before serialization; client-side filtering is never the security boundary.
- Validate all child IDs against both parents for CRUD, search, bulk operations, Source files, Evidence, exports, backups, Briefings, and AI inputs.
- Scope Portfolio to the active Organization and Today to the active Workspace.
- Clear/reload client context when Organization changes; never reuse a prior Workspace selection without validation.
- Separate ordinary Organization-scoped backup/export from the offline administrative pre-reset safeguard.
- Keep loopback/local protections, validation, payload limits, and safe file handling that remain valid.

**Explicitly out of scope**

- Full authentication, RBAC, hosted multi-tenancy, or an administrative cross-Organization UI.
- A product API that exports all Organizations at once.
- Legacy-name route compatibility solely for the disposable runtime.
- Core Capture, Follow-Up, Milestone, and Briefing behavior beyond the access-control foundation.

**Likely files and modules affected**

- `server.js`, split where useful into route, resolver, repository, export, file-access, and AI-context modules.
- `public/app.js` and `public/index.html` for active-context transport and context clearing.
- `public/security-utils.js` for client-safe validation only; server rules remain authoritative.
- New Organization-isolation tests in `test/security.test.js` or dedicated test files.

**Schema changes**

- No new hierarchy beyond Phase 1.
- Add only indexes/maps derived at runtime for efficient Organization/Workspace resolution; do not create alternate identity fields.

**API changes**

- Replace name-based/global routes with parent-scoped routes, using a consistent shape such as:
  - `/api/organizations`
  - `/api/organizations/:organizationId/workspaces`
  - `/api/organizations/:organizationId/portfolio`
  - `/api/organizations/:organizationId/briefings`
  - `/api/organizations/:organizationId/workspaces/:workspaceId/...`
- Add a validated session/context endpoint for active Organization and Workspace IDs.
- Make search, exports, ordinary backups, Source-file retrieval, and AI endpoints use the same parent-scoped route contract.
- Return a generic not-found/forbidden response for cross-parent IDs without foreign record details.

**UI changes**

- Add active Organization and Workspace context plumbing.
- Organization switching clears pending selections, cached records, rendered lists, counts, and search results before loading the new context.
- Portfolio and Today consume only their correctly scoped endpoints.

**Tests**

- At least two Organizations with unmistakable sentinel records across every entity type.
- No foreign IDs or text in Portfolio, Today, search, exports, backups, Briefings, Sources, Evidence, Source-file responses, or captured AI request payloads.
- Wrong Organization/right Workspace and right Organization/wrong Workspace requests fail.
- Duplicate mutable names do not affect resolution.
- Organization switching clears prior DOM and state.
- Normal Workspace movement across Organizations is rejected.

**Acceptance criteria**

- Every target route and service method requires or derives a validated Organization parent.
- Adversarial two-Organization tests prove zero foreign data reaches server responses, the DOM, files, exports, backups, or AI context.
- No active target path calls global `getProject(data, name)`-style lookup or iterates all Workspaces without an Organization boundary.

**Rollback considerations**

- Continue serving the existing app/runtime while target endpoints are developed against temporary files.
- Revert target routes and resolvers together; do not partially fall back to global queries.

**Dependencies**

- Phase 1 schema, repositories, seed, and two-Organization fixture accepted.

### Phase 3 — Core delivery workflows

**Estimated risk:** High. Capture and bulk changes combine external content, entity resolution, stale state, and user approval.

**Objective**

Implement target-shaped Work, Scope, Milestone, Capture, Evidence, current-state, and Follow-Up workflows while preserving the valid human-control safeguards.

**Exact in-scope behavior**

- Scope CRUD and independent optional Jira Epic mapping CRUD.
- Work Item CRUD, bulk selection, deletion/recovery where retained, bulk Sprint assignment, bulk Scope assignment, and explicit assignment to `Unassigned` (`scopeId: null`).
- Import/capture proposals that keep Scope creation, Jira mapping, Work Item assignment, Evidence acceptance, and current-state changes as distinct reviewable decisions.
- Source Library for meeting notes, screenshots, JSON/CSV feeds, sprint planning, backlog refinement, DSU updates, and other supported source types.
- Finding review in usable page sizes and safe bulk accept/reject behavior.
- Accepted Findings create attributable historical Evidence; they do not directly update current Work Item state.
- Proposed Changes show exact current and proposed values, evidence, expected-state hash, and preview; apply only after explicit approval and fresh stale-value validation.
- Current Work Item state is stored directly and separately from Evidence.
- Follow-Up states None/Open/Waiting/Resolved, Workspace-scoped calculation, owner/reason/next action where applicable, and the wording `No comment date captured` when no timestamp exists.
- Workspace- and Scope-level Milestones with validated Work Item links and visible applicability.
- No automatic Jira write or other external action.

**Explicitly out of scope**

- Inferring Scopes from titles or creating one Scope per Jira Epic.
- Creating a catch-all Scope for unreadable/missing Epic data.
- Automatic current-state mutation when Evidence is accepted.
- Live Jira writes, autonomous messaging, or auto-finalization/communication.
- Importing any current runtime record.
- Full navigation redesign and canonical Briefing UI, which belong to Phase 4.

**Likely files and modules affected**

- `work-items/bulk-domain.js` and target Work Item/Follow-Up services.
- `workspaces/workspace-domain.js` only while extracting reusable validation; its legacy Project/Epic model is retired in Phase 5.
- `external-feed.js`, Capture/import parsers, and new Source/Finding/Evidence/Proposed Change modules.
- `server.js` target Workspace routes.
- `public/app.js`, `public/index.html`, `public/domain-utils.js`, and `public/work-item-types.js` for workflow surfaces.
- Relevant fixtures and `test/work-item-bulk.test.js`, `test/external-feed-v3.test.js`, `test/workspace-domain.test.js`, and security tests, rewritten around target semantics.

**Schema changes**

- Activate Phase 1 collections and fields for Scopes, mappings, Work Items, Milestones, Sources, Findings, Evidence, Proposed Changes, audit events, and Follow-Up.
- Store current Work Item fields separately from immutable historical Evidence/provenance.

**API changes**

- Add parent-scoped CRUD and bulk endpoints for Scopes, Jira mappings, Work Items, Milestones, Sources, Findings, Evidence, Proposed Changes, and Follow-Up.
- Make preview and apply separate requests. Apply includes the preview/expected-state hash and rejects stale state.
- Make import parsing produce proposals only. No parser endpoint may create a Scope, mapping, assignment, or current-state change without the corresponding approved action.

**UI changes**

- Work: Scope/Unassigned filters, bulk select, Sprint/Scope assignment preview, confirm action in an application dialog, clear success/error feedback, and refreshed data after success.
- Capture: generic source terminology, Source Library, larger review pages, safe bulk review, assignment/creation summaries, and explicit next-step feedback.
- Milestones: display Workspace versus Scope applicability.
- Follow-Up: consistent states and missing-date wording.
- Replace blocking browser `alert`, `confirm`, and `prompt` use in touched workflows with accessible in-app dialogs/toasts and inline validation.

**Tests**

- Scope without Epic, multiple mappings, mapping uniqueness, Jira rename independence, nullable assignment, and no fake Scope.
- Import with mixed/unknown Epics; no title matching; separate approval paths; no write during preview.
- Finding acceptance versus Proposed Change approval; exact evidence and stale-value rejection.
- Bulk Sprint/Scope/delete actions, confirmation, page refresh, undo/recovery where retained, and partial-failure feedback.
- Workspace/Scope Milestones and cross-parent rejection.
- Follow-Up states, calculation boundaries, comment timestamps, and unknown-date wording.
- Malicious external content treated as data, not instructions; payload and token controls preserved.
- Two-Organization isolation for every new route and captured AI context.

**Acceptance criteria**

- No workflow creates `Miscellaneous / No Epic` or derives Scope identity from Jira Epic identity.
- An unassigned Work Item persists with `scopeId: null` and displays as `Unassigned`.
- Evidence acceptance and current-state application are observably separate approvals.
- Consequential bulk/current-state actions provide preview, stale protection, explicit confirmation, outcome feedback, and refreshed UI.
- No tested path writes to Jira or communicates automatically.

**Rollback considerations**

- Target workflows remain pointed at temporary target data until release.
- Keep parsers, proposals, and apply services in separate commits so apply can be disabled without losing read/review behavior.
- Reverting this phase must not require interpreting the old runtime file.

**Dependencies**

- Accepted Phase 2 parent-scoped services and isolation tests.

### Phase 4 — Navigation, operational UI, and Briefings

**Estimated risk:** High. The shell must change context safely, while Briefing versions and communicated baselines must remain internally consistent.

**Objective**

Expose the target hierarchy and workflows coherently across the application, and make Briefing/Briefing Version the sole target communication model.

**Exact in-scope behavior**

- Organization selector and PM Workspace selector based on stable IDs.
- Portfolio for the active Organization and Today for the active Workspace.
- Target terminology and Scope/Unassigned visibility across Work, Capture, Source Library, Finding/Evidence review, Follow-Up, Milestones, search, settings, and operational counts.
- Canonical Briefing definitions owned by one Organization, selecting one or more Workspaces in that Organization and optional Scopes within them.
- Briefing Version lifecycle: Draft, Finalized, Communicated.
- Draft creation from the last Communicated baseline; accepted Evidence only; frozen snapshot on Finalize; immutable Finalized/Communicated versions.
- Deterministic output formats built from one frozen content model. Optional AI may review/draft under explicit controls, but it may not finalize or communicate.
- Explicit communication action records actor/session, timestamp, channel/output reference, and advances the baseline only after success.
- History and current/open placement follow lifecycle state rather than legacy page concepts.
- Accessible in-app confirmations, status notices, and error handling throughout the target UI.

**Explicitly out of scope**

- Automatic communication, background sending, automatic Finalize, or automatic baseline advancement.
- Cross-Organization Briefings or mixed-parent Scope selections.
- Migration of old Briefing definitions, versions, snapshots, outputs, or baselines.
- A Program layer, Gantt/resource/budget features, or unrelated visual redesign.
- Final deletion of legacy routes/files before target parity passes; cleanup is Phase 5.

**Likely files and modules affected**

- `public/index.html`, `public/app.js`, `public/styles.css`, and client domain/security helpers.
- `briefings/briefing-domain.js` and `briefings/briefing-evidence.js`, replaced or refactored to stable parent IDs.
- `server.js` target Briefing/version/output/communication routes.
- `test/briefing-domain.test.js`, `test/briefing-evidence.test.js`, UI/security tests, and demo-session tests.

**Schema changes**

- Activate canonical `briefings`, `briefingVersions`, snapshot/output metadata, lifecycle timestamps, communication result, comparison baseline, and audit events.
- Briefing Workspaces/Scopes are stable IDs and must all resolve within the Briefing Organization.

**API changes**

- Add Organization-scoped Briefing definition/list routes and stable-ID version routes.
- Separate create Draft, refresh Draft, Finalize, render output, and Communicate commands.
- Each command validates Organization, selected Workspace/Scope parents, lifecycle state, expected version/hash, and allowed transition.
- AI review/draft endpoints receive only the validated Briefing snapshot and Organization-scoped evidence.

**UI changes**

- Replace Project-based shell/navigation with Organization → Workspace context.
- Add Scope/Unassigned filters and labels wherever Work Items are shown.
- Present Briefing definition, Draft workbench, preview/finalize confirmation, deterministic outputs, explicit communicate confirmation, current/open versions, and history.
- Remove misleading `Extracted DSU updates` wording in favor of general extracted findings/updates appropriate to all supported Source types.

**Tests**

- Selector persistence by stable ID, duplicate names, Organization switch clearing, and empty states.
- Portfolio active Organization; Today and operational pages active Workspace.
- Briefing same-Organization multi-Workspace selection and cross-Organization rejection.
- Optional Scopes validate against their Workspaces.
- Accepted Evidence only; snapshot immutability; one shared fact/content set across formats.
- Draft/Finalized/Communicated transitions; Finalized remains open until communicated; only Communicated advances baseline.
- Failed communication does not advance baseline; no automatic communication.
- No foreign sentinel data in Briefing UI, outputs, history, exports, or AI payloads.
- Keyboard/focus behavior and no blocking native dialogs in target flows.

**Acceptance criteria**

- The visible hierarchy is Organization → PM Workspace → Scope → Work Item throughout the target UI.
- Portfolio, Today, operational pages, and Briefings obey their required scopes with server-side proof.
- Briefing Version history, immutable snapshots, deterministic outputs, and last-communicated baseline pass lifecycle tests.
- Target communication behavior reaches an agreed parity checklist; legacy communication routes are no longer needed for normal use.

**Rollback considerations**

- Keep the existing app/runtime available until the complete target shell and Briefing lifecycle pass.
- The target UI can be reverted as one unit without converting data because it still uses temporary target files.
- Do not remove legacy communication code in this phase; mark it unreachable from target navigation after parity, then delete it in Phase 5.

**Dependencies**

- Phase 3 workflows accepted.
- Current target external-feed support and the approved deterministic Teams-style, email-style, and Confluence-style output formats.

### Phase 5 — Hardening, cleanup, and release

**Estimated risk:** Medium-high. Historical data loss is accepted, but the file replacement and legacy-code retirement must be atomic, observable, and reversible.

**Objective**

Prove target readiness, remove superseded behavior, perform the one safeguarded clean reset, and release the target application.

**Exact in-scope behavior**

- Run the full unit, integration, security, isolation, lifecycle, UI, and startup suite against the clean target seed.
- Verify dependency/security checks, local-only/network protections, validation, file protections, rate/payload/token controls, logging, and prompt/tool authorization.
- Remove legacy model/routes/UI/tests after target behavior exists and is accepted.
- Remove old Status Summary/Teams-specific creation workflows after canonical Briefing parity exists; retain deterministic output formats only if still part of the canonical Briefing model.
- Validate the exact clean seed and stage it outside the live runtime path.
- Start the application successfully against the staged seed and complete a smoke test.
- Create one timestamped byte-for-byte backup of the current runtime file, compute SHA-256, and record original path, backup path, byte count, timestamp, and checksum in the release record.
- Atomically replace the stopped application's runtime file with the already validated clean seed, restart, and run post-cutover smoke/isolation checks.

**Explicitly out of scope**

- Migrating or restoring selected legacy records into the target seed.
- A reconciliation UI, tombstones, legacy ID aliases, dual reads/writes, or long-term legacy runtime adapters.
- Deleting the timestamped backup as part of cutover.
- New product features unrelated to the target hierarchy and required safety controls.

**Likely files and modules affected**

- `server.js`, `workspaces/workspace-domain.js`, `external-feed.js`, `briefings/*`, `work-items/*`, and `public/*` for removal of unreachable legacy branches.
- `demo/demo-fixture.js` and all `test/*.test.js`/fixtures for final target-only expectations.
- `package.json` scripts and release/check tooling if needed.
- Operational backup/release record outside the normal Organization-scoped product API.
- The runtime data file only at the gated reset point below, not during plan implementation.

**Schema changes**

- No new model change is expected; freeze version 2 for release.
- Remove parser/default branches that silently synthesize the legacy `projects`, `deliveryProjects`, `stories`, `timeline`, or `transcripts` shape on target writes.

**API changes**

- Remove global/name-based Project routes and legacy communication endpoints after callers are gone.
- Remove or disable all-org ordinary backup/export behavior.
- Keep only stable-ID, parent-scoped target routes plus an explicitly offline release safeguard.

**UI changes**

- Remove Project-as-Epic terminology, fake no-Epic behavior, legacy selectors, and legacy communication entry points.
- Complete empty, loading, success, partial-failure, stale-preview, and recovery states.
- Verify no conditional native browser popup remains in normal target workflows.

**Tests**

- Full clean install/start against the target seed.
- Full target suite, including at least two Organizations for every isolation-sensitive surface.
- No legacy route/UI/domain behavior remains reachable.
- Backup creation/checksum verification and restore rehearsal using temporary copies.
- Cutover rehearsal: stopped process, staged seed validation, atomic replacement, restart, smoke tests, and rollback.
- Corrupt seed and failed-start scenarios prove that the current runtime is never overwritten before gates pass.
- Static search/regression checks for mutable Workspace-name identity, global Workspace aggregation, fake Scope creation, native popup use, automatic Jira writes, and automatic communication.

**Acceptance criteria**

- New schema validates and clean seed loads.
- All automated tests pass.
- The target application starts and target smoke tests pass against the staged clean seed.
- Timestamped backup path and SHA-256 are recorded and independently verified before runtime replacement.
- The live clean-reset sequence succeeds and post-cutover checks show only the approved environment-specific clean seed structure.
- No current route, UI, test, or canonical domain logic requires one Project per Epic, `Miscellaneous / No Epic`, mutable name identity, or a global cross-Workspace query.

**Rollback considerations**

- Before replacement: abort with the current runtime untouched.
- After replacement but before release acceptance: stop the app, verify the recorded backup checksum, atomically restore that byte-for-byte backup, restart the prior application revision, and record the rollback.
- Retain the backup until the release owner accepts the clean environment and the chosen retention period expires.

**Dependencies**

- All Phase 1–4 acceptance criteria complete.
- Backup location writable with sufficient space.
- Release owner available for go/no-go and post-cutover smoke acceptance.

## 5. Legacy code and tests to remove

Remove these only after the corresponding target behavior is accepted:

| Legacy area | Removal target |
|---|---|
| `workspaces/workspace-domain.js` combined Project/Jira Epic model | One-Project-per-Epic rules, exact name identity, and automatic `Miscellaneous / No Epic` creation. Replace with independent Scope and Jira mapping services. |
| `server.js` global root/name lookup | `projects` map routes, mutable-name `getProject` resolution, unscoped aggregation/search/export/backup/AI assembly, and legacy write normalizers. |
| `external-feed.js` legacy association behavior | Automatic Project/Epic or no-Epic creation and any approval path that combines Scope creation, mapping, assignment, Evidence acceptance, and state mutation. |
| `public/app.js`, `public/index.html`, helpers | Project-only selector, global Workspace loops, Project-as-Epic labels, fake no-Epic semantics, legacy communication entry points, and conditional native dialogs. |
| `briefings/briefing-domain.js`, `briefings/briefing-evidence.js` legacy ownership | Name-based Workspace references, Project-scoped evidence, and stream terminology where it conflicts with canonical Briefing/Version ownership. Preserve the valid lifecycle rules in target code. |
| `demo/demo-fixture.js` | Legacy `projects`-shaped demo data. Replace with the clean seed plus separate fictional two-Organization fixture. |
| `test/workspace-domain.test.js` | Expectations for one Project per Jira Epic and fake no-Epic Project creation. |
| `test/external-feed-v3.test.js` and affected `test/security.test.js` cases | Expectations that imports create legacy Projects/no-Epic containers or rely on global/name-based context. Retain and rewrite evidence, preview, stale-check, and malicious-input protections. |
| Other Briefing, bulk, and demo tests | Replace mutable-name/global-scope fixtures while retaining immutability, baseline, deterministic-output, undo/recovery, and approval safety assertions. |

Do not keep legacy behavior merely to make an old assertion pass. Rewrite the assertion around the approved target invariant.

## 6. Legacy behavior temporarily retained for sequencing only

Until Phase 5 cutover:

- the current runtime file and current application revision remain available as-is;
- target development uses a separate temporary/staged data path;
- legacy modules/routes/UI may remain callable only by the old application while target replacements are incomplete;
- existing Briefing/communication code remains until target Briefing parity passes;
- no target write is mirrored to the old runtime, and no old record is copied into target data;
- no compatibility contract is inferred from this temporary coexistence.

Once target acceptance passes, these paths are removed rather than adapted. External-feed version compatibility is retained only if separately chosen as a continuing product input requirement, not because the current data contains old feed state.

## 7. Exact data-reset checkpoint

The old runtime data may be reset **only during Phase 5, after the release candidate has passed all pre-cutover gates**:

1. Version-2 schema validation passes.
2. The exact clean environment seed validates and loads from a staged, non-live path.
3. All automated tests pass, including two-Organization isolation tests.
4. The new application starts successfully against the staged seed and completes smoke tests.
5. The current application is stopped so no write can race with backup/replacement.
6. A timestamped byte-for-byte backup of the current runtime file is created.
7. A SHA-256 checksum is computed, rechecked from the backup, and recorded with the original path, backup path, timestamp, and byte count.
8. A release owner gives go/no-go approval.

Only then may the live runtime file be atomically replaced with the already validated clean seed. The application is restarted and smoke-tested immediately. Any failure before post-cutover acceptance triggers checksum-verified restoration of the backup. The old file is never deleted or replaced merely because the code has compiled or a partial phase has passed.

## 8. Recommended commit boundaries

1. **Schema contract:** version-2 types/validators, stable-ID rules, and pure validation tests.
2. **Clean seed and fixtures:** fictional target-shaped seed, two-Organization isolation fixture, temporary-store harness, and persistence tests.
3. **Scoped repositories and routes:** Organization/Workspace resolvers, parent-scoped APIs, exports/files/AI filtering, and isolation tests.
4. **Scope and Work:** Scope/Jira mappings, Work Items, bulk actions, Milestones, Follow-Up, and their tests.
5. **Capture and evidence:** Sources, Findings, Evidence, Proposed Changes, preview/stale/apply boundaries, UI feedback, and tests.
6. **Target shell:** Organization/Workspace navigation, Portfolio, Today, operational pages, and UI isolation tests.
7. **Canonical Briefings:** definitions, versions, lifecycle, outputs, communication, baselines, and tests.
8. **Legacy retirement:** delete old domain/routes/UI/fixtures and replace superseded tests; no runtime reset in this commit.
9. **Release hardening:** security/startup/cutover tooling and runbook checks. The runtime reset is an operational go/no-go event, not source history to commit.

Each commit must leave tests green for the behavior it exposes. Do not mix legacy deletion with the first implementation of its replacement.

## 9. Resolved release scope

No decision about the current runtime records remains; all are explicitly disposable. The first target release uses:

1. the current target external-feed format only, unless an active producer is verified to require an older version;
2. Teams-style, email-style, and Confluence-style deterministic Briefing outputs from one finalized fact set;
3. 30-day retention of the pre-reset backup after successful release acceptance;
4. Organization-scoped ordinary exports and backups, with privileged all-Organization export deferred.

These decisions are release requirements, not open product-owner questions.

## 10. Completion definition

The clean cutover is complete when the released application uses only version-2 target data, exposes the approved hierarchy and workflows, passes two-Organization isolation tests, preserves the valid human-review and evidence safeguards, has canonical Briefing lifecycle behavior, contains only the approved clean seed, and has a recorded, checksum-verified pre-reset backup available for rollback. No legacy runtime record or ID is required in the new system.

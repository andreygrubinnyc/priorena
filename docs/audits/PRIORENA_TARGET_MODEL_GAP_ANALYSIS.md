# Priorena Target Product Model — Repository-Safe Implementation Gap Analysis

**Status:** Current structural implementation analysis
**Audit date:** 2026-08-07
**Approved target:** `PRIORENA_TARGET_PRODUCT_MODEL_SPEC.md` version 1.2
**Implementation plan:** `docs/plans/PRIORENA_CLEAN_CUTOVER_IMPLEMENTATION_PLAN.md`
**Scope:** Repository code, routes, domain logic, UI, fixtures, and tests; private runtime content is excluded

## Executive conclusion

The current application implements useful human-reviewed evidence intake, preview and stale-value controls for several consequential changes, stable IDs for many records, and a substantial Briefing version lifecycle. It does not yet implement the approved hierarchy or a server-enforced Organization boundary.

The current structural hierarchy is effectively:

```text
Root `projects` map
└── entry keyed by mutable Workspace display name
    ├── `deliveryProjects[]` combining a Priorena Project and one Jira Epic
    ├── `stories[]` linked by `deliveryProjectId`
    ├── `timeline[]` without explicit Workspace/Scope applicability
    └── `transcripts[]` containing extracted Findings

Root
├── `briefingStreams[]` as reusable communication definitions
└── `briefings[]` as Draft, Finalized, or Communicated versions
```

The approved target is:

```text
Organization
└── PM Workspace
    ├── Scope
    │   └── zero or more optional Jira Epic mappings
    ├── Work Item with `scopeId` set to one Scope or `null`
    │   └── nested Follow-Up
    ├── Milestone for the Workspace or one Scope
    │   └── canonical `linkedWorkItemIds[]`
    └── Source → Finding → Evidence → Proposed Change

Organization
└── Briefing → Briefing Version
                 Draft → Finalized → Communicated
```

The clean-cutover decision makes the private current runtime disposable. Implementation therefore does not require record-by-record migration, legacy-ID translation, tombstones, reconciliation UI, or long-lived dual-schema/dual-write behavior. The code, query, isolation, approval, and test gaps identified below remain applicable.

## 1. Current implemented hierarchy

### Persistence root

`server.js` reads and writes a whole-file JSON document. The current reader expects a root `projects` object and applies compatibility normalization in memory. There is no explicit `schemaVersion` in the legacy shape.

The structural root includes:

```text
projects
settings
aiPrompts
briefingStreams
briefings
```

Each `projects` entry acts like a PM Workspace but is keyed and addressed by mutable display name. Workspace child collections include legacy Projects, Work Items, Milestones, Sources/Findings, mappings, saved views, and history.

### Combined Project/Jira Epic model

`workspaces/workspace-domain.js` treats each `deliveryProjects[]` record as both a Priorena delivery container and one Jira Epic association. Resolution is based on exact names or one Epic key. The current structure cannot model a Scope with no Jira Epic or with multiple Jira Epic mappings without special cases.

Some import paths create a legacy no-Epic container to force assignment coverage. This conflicts with the target requirement that an unknown Scope remain `scopeId: null` and display as **Unassigned**.

### Work Items

`stories[]` is the physical Work Item collection. Work Items have stable local IDs and optional Jira identifiers, but use legacy `deliveryProjectId` rather than canonical `workspaceId` and nullable `scopeId` ownership.

The selectable Work Item types already align with the approved Story, Feature, Task, Bug, Other, and Unknown types.

### Source, Finding, Evidence, and Proposed Change

`transcripts[]` is the physical Source collection. Extracted records combine pending Findings and accepted Evidence through review status. Exact excerpts and Source relationships are substantially present.

Some external-feed field proposals and bulk Work actions already implement preview hashes and stale-value checks. However, Proposed Change is not a general first-class entity across all intake paths. In at least one review path, accepting a Finding can also create a Work Item update, combining evidence acceptance with current-state mutation.

### Current state

Current status calculation can fall back from direct state to the existence of historical updates. That creates a structural risk that historical Evidence may be presented as current state. The target requires direct current-state fields, provenance, and an explicit inferred/estimated label when status is not directly known.

### Follow-Up

Follow-Up-related flags and timestamps exist on Work Items, but there is no single nested Follow-Up object with None, Open, Waiting, and Resolved states. Some client calculations aggregate beyond the active Workspace. Unknown comment dates can be presented with wording that implies a known absence rather than missing captured data.

### Milestones

Legacy Milestones are stored in `timeline[]`. They do not declare whether they apply to the entire Workspace or one Scope. The legacy Work Item-to-Milestone direction also conflicts with the approved canonical relationship `Milestone.linkedWorkItemIds[]`.

### Briefings

`briefings/briefing-domain.js` and `briefings/briefing-evidence.js` implement much of the desired lifecycle:

- reusable definitions;
- Draft, Finalized, and Communicated versions;
- frozen snapshots;
- evidence and manual-fact boundaries;
- deterministic output generation;
- comparison with the last communicated version;
- baseline advancement only after explicit communication.

The ownership model remains legacy. Definitions and versions use mutable Workspace names and legacy Project IDs, have no Organization parent, and can be listed through global routes.

### Portfolio and Today

The browser receives the legacy root map. Portfolio aggregates its entries, while Today renders the selected entry. Without an Organization entity and server-scoped query, Portfolio, selectors, search, badges, and related calculations can blend every root entry available to the process.

## 2. Target hierarchy and invariants

The implementation must enforce:

1. Every PM Workspace belongs to exactly one Organization.
2. Every Scope belongs to exactly one Workspace and that Workspace's Organization.
3. A Scope has zero or more optional Jira Epic mappings and remains independent of Jira names and keys.
4. Every Work Item belongs to exactly one Workspace and zero or one Scope in that Workspace.
5. `scopeId: null` is the only Unassigned representation.
6. No path creates `Miscellaneous / No Epic` or another catch-all Scope.
7. Follow-Up is nested on Work Item.
8. Milestones are Workspace-level or Scope-level and use `linkedWorkItemIds[]` canonically.
9. Sources and all derived Findings, Evidence, and Proposed Changes stay inside one Workspace and Organization.
10. Historical Evidence does not silently overwrite current Work Item state.
11. Briefings belong to one Organization and select only Workspaces/Scopes inside it.
12. Portfolio is scoped to the active Organization; Today is scoped to the active Workspace.
13. Ordinary exports and backups are Organization-scoped; privileged all-Organization export is deferred.
14. AI prompt context is filtered on the server before model invocation.

## 3. Entity-by-entity gap analysis

| Area | Current implementation | Approved target | Gap |
|---|---|---|---|
| Root schema | Legacy collections with read-time normalization | Explicit `schemaVersion: 2` | Missing versioned schema and fail-closed reader. |
| Organization | No entity or active context | Stable independent tenant boundary | Critical missing entity and boundary. |
| PM Workspace | Mutable map key is identity | Stable ID and required `organizationId` | Identity and parent model conflict. |
| Scope | Legacy Project combined with one Jira Epic | Priorena-owned Scope | Entity must be separated from Jira mapping. |
| Jira Epic mapping | One key/name embedded in legacy Project | Zero-to-many optional mapping records | Missing mapping identity, provenance, and parent validation. |
| Work Item ownership | Implicit Workspace nesting and `deliveryProjectId` | Explicit Workspace and nullable `scopeId` | Relationship must be replaced. |
| Unassigned | Empty/forced legacy associations | `scopeId: null`, UI `Unassigned` | Import and UI semantics conflict. |
| Follow-Up | Several flags/timestamps | Nested coherent state object | Partial implementation requires consolidation. |
| Milestone | Legacy timeline record; inverse link | Workspace/Scope applicability and `linkedWorkItemIds[]` | Material schema and UI gap. |
| Source | Workspace-like nesting | Explicit Organization/Workspace parent | Parent validation is missing. |
| Finding/Evidence | One record differentiated by review state | Pending Finding and accepted Evidence concepts | Conceptually partial; currentness and supersession need stronger support. |
| Proposed Change | Embedded in selected workflows | General evidence-backed reviewed mutation | Partial and inconsistent across intake paths. |
| Current state | Direct fields plus historical-update fallback | Direct current state with provenance | Historical/current separation conflicts. |
| Briefing | Strong lifecycle, legacy ownership | Organization-owned definition and stable selections | Lifecycle is reusable; ownership must be replaced. |
| Portfolio | Global legacy-root aggregation | Active Organization | Query scope conflicts. |
| Today | Selected legacy container | Active Workspace | Partial; requires stable context and Scope labels. |
| Settings | Root-global and Workspace-like configuration mixed | Workspace settings separated from technical globals | Ownership classification is required. |
| Export/backup | Whole-root ordinary route | Organization-scoped product operation | Cross-Organization exposure risk. |
| API identity | Mutable Workspace name supplied by client | Stable IDs with server parent resolution | Critical server contract gap. |
| Fixture | Legacy-shaped demo | Fictional target-shaped seed and two-Organization fixture | Existing fixture is structurally stale. |

## 4. Organization-isolation risks

Loopback-only hosting reduces network exposure but does not establish logical tenant isolation.

| Current path | Structural behavior | Required correction |
|---|---|---|
| Root Workspace list | Returns all legacy root entries | Resolve active Organization and return only its Workspaces. |
| Mutable-name Workspace lookup | Searches the global root by display name | Resolve stable Organization → Workspace IDs on the server. |
| Portfolio | Aggregates every root entry | Query only active-Organization Workspaces. |
| Follow-Up and navigation counts | Iterate broadly in the client | Return active-Workspace calculations from the server. |
| Settings search and sprint inference | Can inspect multiple root entries | Restrict to active Organization/Workspace before serialization. |
| Briefing lists and validation | Use global definitions and mutable names | Require one Organization and validate every selected Workspace/Scope. |
| Source upload and file retrieval | Workspace name is the principal boundary | Validate Organization/Workspace parents and safe file ownership. |
| Ordinary backup/export | Can serialize the full root | Export only the explicitly selected Organization. |
| AI routes | Assemble context from globally addressable Workspaces | Build context only from validated Organization-scoped records. |
| Shell context | Has no Organization selector | Add active Organization and clear prior Workspace state on switch. |

Filtering only in the browser is insufficient. Foreign Organization records must be removed on the server before JSON responses, files, exports, backups, deterministic outputs, or AI requests are created.

## 5. API and server gaps

Target APIs should consistently use parent-scoped routes or service calls equivalent to:

```text
/api/organizations
/api/organizations/:organizationId/workspaces
/api/organizations/:organizationId/portfolio
/api/organizations/:organizationId/briefings
/api/organizations/:organizationId/workspaces/:workspaceId/...
```

Every child operation must validate the complete parent chain. A known child ID supplied under the wrong parent must return a generic not-found/forbidden result without confirming that a foreign record exists.

The server must apply the same boundary to:

- reads and mutations;
- bulk preview and apply;
- search and selectors;
- Source uploads and retrieval;
- Findings, Evidence, and Proposed Changes;
- Briefing snapshots and outputs;
- ordinary exports and backups;
- AI prompt assembly and model calls.

## 6. UI and workflow gaps

### Navigation and context

The shell needs stable-ID Organization and Workspace selectors. Switching Organization must clear rendered records, caches, pending selections, filters, counts, and search results before loading the new context.

### Work

Work needs Scope/Unassigned display and filtering, stable parent-scoped queries, and bulk assignment to one Scope or `scopeId: null`. Consequential bulk actions require preview, an in-application confirmation, stale-value protection where state could change, clear outcome feedback, and a refreshed list.

### Capture, Source Library, and review

Capture terminology must cover all supported Source types rather than one meeting category. Source upload does not require one Scope because a Source may mention several Scopes and Work Items inside its Workspace.

Finding review and Proposed Change review must remain separate consequence-based surfaces. Bulk review needs usable page sizes and explicit counts. Exact excerpts, Source provenance, proposed associations, and whether an action changes current state must remain visible.

### Current state and Follow-Up

Evidence acceptance must not mutate current state automatically. Proposed current-state changes require their own preview and approval. Follow-Up uses one nested Work Item object, active-Workspace calculations, and `No comment date captured` when a timestamp is unknown.

### Milestones

Creation must require `Entire workspace` or one Scope. Every card/detail view must show applicability. Work Item links are stored on the Milestone through `linkedWorkItemIds[]` and validated against Organization and Workspace parents.

### Briefings

Briefing and Briefing Version replace parallel communication domains after feature parity. The target retains Draft → Finalized → Communicated, frozen facts, accepted Evidence only, deterministic Teams-style/email-style/Confluence-style outputs, explicit communication, and last-communicated baselines. No AI path may finalize or communicate.

### Native browser dialogs

Touched target workflows should replace blocking `alert`, `confirm`, and `prompt` calls with accessible in-application dialogs, inline validation, and status notices.

## 7. Security requirements retained from the current implementation

The clean cutover must retain or strengthen:

- exact evidence provenance;
- human review before consequential changes;
- preview-before-apply;
- expected-state hashes and stale-value rejection;
- validation and payload limits;
- safe upload/file handling;
- malicious external content treated as data rather than instructions;
- model input restricted to validated Organization-scoped context;
- no automatic Jira writes;
- no automatic communication;
- deterministic output that does not require AI;
- immutable Finalized and Communicated Briefing content;
- explicit audit events for approvals and external actions;
- repository security gates and private-data exclusions.

Prompt overrides and drafting guidance belong to the Workspace. They must not be stored in global technical settings or enter another Workspace's AI context.

## 8. Affected repository modules

| Module | What it establishes or must change |
|---|---|
| `server.js` | Persistence, legacy normalizers, global/name-based routes, imports, Sources, Milestones, backups, AI inputs, and Briefing actions. |
| `workspaces/workspace-domain.js` | Combined Project/Epic model, exact matching, and no-Epic creation behavior. Replace with Scope and Jira mapping domains. |
| `work-items/bulk-domain.js` | Bulk hashes, history, delete/recovery, and legacy relationship fields. Retain safety; replace ownership fields. |
| `external-feed.js` | Feed parsing, evidence rules, association proposals, and no-Epic behavior. Keep approvals separate. |
| `briefings/briefing-domain.js` | Strong lifecycle and baseline behavior; replace mutable-name ownership. |
| `briefings/briefing-evidence.js` | Accepted-evidence selection and legacy Project scoping. Add Organization/Workspace/Scope validation. |
| `public/app.js` | Shell context, broad aggregation, Work/Capture/Follow-Up/Milestone/Briefing UI, and feedback behavior. |
| `public/index.html` | Legacy selector and terminology. |
| `public/domain-utils.js` | Current status fallback from historical updates. |
| `public/work-item-types.js` | Canonical Work Item types are substantially aligned. |
| `demo/demo-fixture.js` | Legacy-shaped fixture; replace with fictional target-shaped data. |
| `test/*.test.js` | Existing safety assertions plus superseded model assumptions. Replace selectively as described below. |

## 9. Clean-cutover implementation implications

The current private runtime is not a migration source. The implementation must:

1. introduce and validate `schemaVersion: 2`;
2. build the clean target store and fictional fixture at a separate temporary path;
3. implement Organization-scoped repositories and routes before enabling multiple Organizations;
4. implement Scope, Work Item, Milestone, Evidence, Follow-Up, and Briefing target workflows;
5. validate startup and tests against the clean environment seed;
6. create one timestamped pre-reset backup with a recorded checksum;
7. rehearse atomic replacement and checksum-verified rollback using temporary copies;
8. replace the stopped application's runtime only after every release gate passes;
9. retain the pre-reset backup for 30 days after successful release acceptance;
10. remove legacy readers, routes, UI, and tests after target behavior is accepted.

The implementation must not create a reconciliation package, item-level migration, tombstone system, legacy-ID manifest, dual writes, or long-lived dual-schema compatibility. The committed fixture is fictional. A real local bootstrap file is private, environment-specific, and excluded from version control. Generic onboarding contains no hardcoded customer data.

## 10. Tests to replace

Replace tests whose only purpose is to require:

- one Priorena Project per Jira Epic;
- automatic `Miscellaneous / No Epic` creation;
- mutable Workspace names as identity;
- global cross-Workspace queries without Organization context;
- legacy current-data preservation or ID translation;
- old communication creation flows after Briefing parity.

Retain and adapt tests for:

- exact Evidence boundaries;
- preview and stale-value checks;
- bulk confirmation and recovery;
- Briefing snapshot immutability;
- explicit communication and baseline advancement;
- malicious-input handling;
- deterministic outputs;
- no automatic external actions.

## 11. Tests to add

At minimum, add automated tests for:

1. version-2 schema validation and unknown-version rejection;
2. clean fictional seed loading with no legacy records;
3. at least two Organizations with duplicate Workspace names and distinct sentinel content;
4. Organization-scoped CRUD, search, Portfolio, Today, exports, backups, files, Briefings, and AI context;
5. wrong-parent ID rejection without foreign-record disclosure;
6. Scope with no Jira Epic and Scope with multiple Jira Epic mappings;
7. duplicate mapping rejection within a Workspace;
8. `scopeId: null` and **Unassigned** UI behavior;
9. no automatic catch-all Scope creation;
10. nested Follow-Up states and unknown-comment-date wording;
11. Workspace- and Scope-level Milestones using `linkedWorkItemIds[]`;
12. Source → Finding → Evidence → Proposed Change separation;
13. Evidence acceptance without automatic current-state mutation;
14. current-state provenance and inferred/estimated labels;
15. Briefing same-Organization selection, lifecycle, immutable snapshots, deterministic outputs, and baseline behavior;
16. Workspace prompt configuration isolation;
17. no automatic Jira write, Finalize, or communication action;
18. successful clean-seed startup and smoke checks;
19. timestamped backup/checksum verification plus atomic reset and rollback rehearsal;
20. static regression checks for mutable-name identity, global aggregation, legacy catch-all creation, and native browser dialogs.

## 12. Release acceptance summary

The target-model implementation is ready for clean cutover only when:

- the version-2 schema validates;
- the environment-specific clean seed validates and loads;
- no legacy runtime records are present in the target store;
- the target application starts successfully;
- all automated tests pass;
- two-Organization isolation tests pass;
- the pre-reset backup path and checksum are recorded outside committed documentation;
- atomic reset and rollback rehearsal succeed;
- the repository security checks pass;
- only Organization-scoped ordinary exports/backups are exposed;
- no automatic Jira or communication action is reachable.

## 13. Repository evidence examined

- `server.js`
- `workspaces/workspace-domain.js`
- `work-items/bulk-domain.js`
- `external-feed.js`
- `briefings/briefing-domain.js`
- `briefings/briefing-evidence.js`
- `public/app.js`
- `public/index.html`
- `public/domain-utils.js`
- `public/work-item-types.js`
- `demo/demo-fixture.js`
- `test/*.test.js`
- `PRIORENA_TARGET_PRODUCT_MODEL_SPEC.md`
- `docs/plans/PRIORENA_CLEAN_CUTOVER_IMPLEMENTATION_PLAN.md`

## 14. Repository-safety statement

This document describes repository structures, implementation gaps, and required safeguards. It intentionally excludes customer identities, operational program names, real Jira keys, record IDs, private runtime counts, uploaded Source names, Briefing recipients/content, workstation paths, and private-runtime checksums. The private source audit remains outside version control and is not a canonical repository document.

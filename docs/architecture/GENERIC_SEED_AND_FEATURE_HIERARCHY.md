# Generic Seed and Feature Hierarchy

**Status:** Implemented source model; live runtime reset not authorized
**Schema:** strict `schemaVersion: 3`
**API namespace:** existing `/api/v2`
**Runtime boundary:** single-user, local-only, loopback `127.0.0.1`

## Authority and safety boundary

This document records the current schema-v3 source architecture. It does not authorize replacing, migrating, normalizing, stopping, or restarting the live runtime. Source-code merge authorization and a future live schema-v3 runtime-reset authorization are separate gates.

There is no schema-v2 migration, compatibility reader, dual reader, dual writer, or legacy-ID translation path. A v2 document fails closed and is left byte-for-byte unchanged.

## Canonical hierarchy

```text
Organization
└── PM Workspace
    └── Scope
        ├── Feature
        │   └── Work Items
        ├── Work Items with no Feature
        └── zero or more Jira Epic mappings
```

Feature and Jira Epic mapping are independent. Creating, reading, updating, or renaming a Feature performs no external call and creates no Jira mapping.

## Exact generic seed

The tracked and staged seed shape is exact:

| Entity | Stable ID | Display name | Parent |
|---|---|---|---|
| Organization | `org-1` | `Organization 1` | — |
| PM Workspace | `workspace-1` | `PM Workspace 1` | `org-1` |
| Scope | `scope-1` | `Scope 1` | `org-1` / `workspace-1` |
| Scope | `scope-2` | `Scope 2` | `org-1` / `workspace-1` |
| Scope | `scope-3` | `Scope 3` | `org-1` / `workspace-1` |
| Scope | `scope-4` | `Scope 4` | `org-1` / `workspace-1` |

`features`, `jiraEpicMappings`, `workItems`, `milestones`, `sources`, `findings`, `evidence`, `proposedChanges`, `briefings`, `briefingVersions`, and `auditEvents` are empty. Preferences select `org-1` and `workspace-1`. The seed is fictional, English-only, and contains no operational identifiers or runtime history.

## Feature contract

A Feature contains exactly these persisted fields:

```text
id
organizationId
workspaceId
scopeId
name
description
```

Its stable ID is opaque. Duplicate names are valid. A Feature cannot move across Organization, Workspace, or Scope in an ordinary transition. Its description is bounded. No archive or hidden lifecycle field is added to the minimal schema-v3 record.

`WorkItem.featureId` is mandatory as a nullable field. When non-null, the referenced Feature must share the Work Item's Organization, Workspace, and non-null Scope. `Feature` is not an allowed Work Item type; the allowed types are Story, Task, Bug, Other, and Unknown. An imported external type value of `Feature` becomes a bounded `external-item-type-review` proposal and never creates a Work Item without explicit mapping.

## Scope and Feature assignment

Consequential Work Item changes use the existing revision-bound preview/apply contract. Scope-change previews include a `featureChange` with:

- `retained` when the existing Feature remains compatible;
- `cleared` when it would become incompatible or the target Scope is null;
- `replaced` when the request explicitly selects a Feature under the target Scope.

Individual, bulk, and approved-import Scope changes apply the same invariant. Evidence Scope association updates remain explicit and audited. No operation silently moves a Feature to another Scope.

Feature assignment and clear use `assign-feature` preview/apply. Foreign, wrong-Workspace, and wrong-Scope Feature IDs return the same public not-found response as unknown IDs.

## Controlled display-name rename

Organization, PM Workspace, Scope, and Feature use explicit rename preview/apply routes. A preview binds old name, new name, stable target IDs, parent context, and current persisted revision into a hash. Apply reconstructs that preview against the expected revision and rejects stale or altered requests.

Successful rename:

- changes only the current display name and supported timestamp fields;
- preserves stable IDs and all parent/child relationships;
- appends a parent-scoped Audit Event;
- leaves finalized and communicated Briefing facts, outputs, and frozen definition snapshots unchanged;
- makes new reads, exports, searches, UI surfaces, AI context, and newly prepared Briefing drafts use the current name.

Direct Scope or Feature metadata PATCH operations cannot bypass the rename workflow.

## Parent-scoped API surface

Feature routes remain under the existing API namespace:

```text
GET  /api/v2/organizations/:organizationId/workspaces/:workspaceId/features
GET  /api/v2/organizations/:organizationId/workspaces/:workspaceId/features/:featureId
GET  /api/v2/organizations/:organizationId/workspaces/:workspaceId/scopes/:scopeId/features
POST /api/v2/organizations/:organizationId/workspaces/:workspaceId/scopes/:scopeId/features
GET  /api/v2/organizations/:organizationId/workspaces/:workspaceId/scopes/:scopeId/features/:featureId
PATCH /api/v2/organizations/:organizationId/workspaces/:workspaceId/scopes/:scopeId/features/:featureId
POST /api/v2/organizations/:organizationId/workspaces/:workspaceId/scopes/:scopeId/features/:featureId/rename/preview
POST /api/v2/organizations/:organizationId/workspaces/:workspaceId/scopes/:scopeId/features/:featureId/rename/apply
GET  /api/v2/organizations/:organizationId/workspaces/:workspaceId/scopes/:scopeId/features/:featureId/work-items
```

Equivalent `/rename/preview` and `/rename/apply` endpoints exist for Organization, PM Workspace, and Scope. All mutations keep existing loopback, same-origin, bounded-request, optimistic-revision, atomic-write, audit, and safe-error protections.

## Product surfaces

Features appear in Workspace-scoped lists, Today, Work Item rows, Scope-filtered Feature selectors, the Feature filter, search, Organization export/backup, Briefing candidate facts, and scoped AI context. Settings keeps Features separate from Jira Epic mappings and provides explicit create and controlled rename operations.

Briefing candidate facts freeze the current Feature name at draft creation. Later Feature renames affect only newly prepared candidates and do not rewrite prior snapshots.

## Validation coverage

Deterministic fictional fixtures include two Organizations, duplicate Workspace/Scope/Feature names, Features in multiple Scopes, Work Items with and without Features, Unassigned Work Items, foreign parent attempts, Jira mappings independent from Features, frozen Briefing names, and cross-surface isolation sentinels.

Release and security gates continue to require syntax checks, the complete test suite, production validation build, legacy regression scan, repository sanitization scan, release rehearsal, dependency audit, loopback smoke behavior, and a final read-only live-runtime fingerprint comparison. Passing these checks does not authorize the live schema-v3 reset.

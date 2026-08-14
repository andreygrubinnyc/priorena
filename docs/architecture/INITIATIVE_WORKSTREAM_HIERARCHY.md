# Initiative and Workstream hierarchy

**Status:** Current schema-v5 architecture
**Date:** 2026-08-14

## Decision

Priorena uses this local, single-user hierarchy:

```text
Organization
└── Workspace
    └── Initiative
        ├── optional Workstream
        ├── zero or more local Jira Epic mappings
        └── Work Items
```

A Work Item has nullable `initiativeId`, `workstreamId`, and `jiraEpicMappingId` fields. Workstream and Jira Epic associations are independent. Either non-null association requires the same non-null Initiative parent.

The five valid association states are Unassigned, Initiative only, Initiative plus Workstream, Initiative plus Jira Epic, and Initiative plus both optional associations.

Strategy and Sub-task hierarchy are intentionally absent.

## Strict schema boundary

Persisted data uses `schemaVersion: 5` and requires `initiatives[]` and `workstreams[]`. The schema-v5 reader rejects schema v4 and unknown fields. There is no migration, compatibility reader, alias route, dual write, or legacy-ID translation layer.

Initiatives have stable Organization and Workspace parents. Workstreams have stable Organization, Workspace, and Initiative parents. Existing Initiatives, Workstreams, and Jira Epic mappings cannot be removed or moved through ordinary persistence transitions.

The generic seed is exactly:

```text
org-1 / Organization 1
└── workspace-1 / Workspace 1
    ├── initiative-1 / Initiative 1
    ├── initiative-2 / Initiative 2
    ├── initiative-3 / Initiative 3
    └── initiative-4 / Initiative 4
```

`workstreams[]` and all operational collections are empty.

## APIs and actions

The HTTP namespace remains `/api/v2`; it is independent from the persisted schema version. Current parent routes use `/initiatives/:initiativeId`, nested `/workstreams/:workstreamId`, and nested `/jira-epic-mappings/:mappingId`. Consequential Work Item actions use `assign-initiative`, `assign-workstream`, and `assign-jira-epic`.

Initiative-change previews report `workstreamChange` and `jiraEpicChange` independently. Selecting Unassigned clears both optional relationships. Wrong-parent records are indistinguishable from missing records.

Controlled rename preview/apply exists for Organization, Workspace, Initiative, and Workstream. Renames preserve stable IDs, parents, children, and finalized or communicated Briefing snapshots.

## Jira Epic mapping management

Settings has separate Initiatives, Workstreams, and Jira Epic mappings sections. A mapping is a local Priorena record under one Initiative. Users can create, read, edit, verify, deactivate, and reactivate it with expected-revision enforcement. Duplicate active Jira identity in one Workspace is rejected.

The UI states: “This creates or updates a Priorena mapping only. It does not create or modify anything in Jira.” No mapping operation contains an external Jira client or network write.

## Projections and communication

Today, search, Work Item projections, Organization export, ordinary backup, scoped AI context, and current Briefing candidates use Initiative and Workstream fields. Work Item Jira identity remains distinct from its optional parent Jira Epic mapping.

Briefing definitions and new Drafts select optional Initiatives within selected Workspaces. Finalized and Communicated snapshots remain immutable and retain the names captured when finalized.

## Import boundary

The strict import contract is `target-v4`, distinct from persisted `schemaVersion: 5`. The parser rejects the prior contract and legacy relationship fields. Mutable source text does not infer an Initiative or Workstream. External labels such as Feature remain bounded provenance only. Imports never create a Workstream or Jira Epic mapping, never assign a relationship without explicit review/apply, and never call Jira.

## Security and release boundary

The application remains bound to `127.0.0.1`, local-only, single-user, and free of automatic external transmission. Source merge authorization does not authorize replacing the live schema-v4 runtime. The one-time empty schema-v4-to-schema-v5 reset has a separate, explicit post-merge gate.

# Work Item Feature and Jira Epic associations

**Status:** schema-v4 source architecture

**Date:** 2026-08-13

**Authority:** `PRIORENA_TARGET_PRODUCT_MODEL_SPEC.md` version 1.4

## Boundary

This architecture is local-only, single-user, and loopback-bound. It does not authorize a live runtime reset, migration, normalization, restart, or replacement. Source-code merge authorization and a later live schema-v4 runtime-reset authorization are separate gates. The currently running schema-v3 runtime remains read-only and unchanged during this source release.

## Persisted model

Schema version 4 adds one required nullable field to every Work Item:

```text
workItem.jiraEpicMappingId: stable Jira Epic mapping ID | null
```

`featureId` and `jiraEpicMappingId` are independent. A Work Item has exactly one of five valid association states:

1. Unassigned: `scopeId`, `featureId`, and `jiraEpicMappingId` are null.
2. Scope only: non-null `scopeId`, both relationship IDs null.
3. Scope and Feature: non-null `scopeId` and `featureId`, null `jiraEpicMappingId`.
4. Scope and Jira Epic: non-null `scopeId` and `jiraEpicMappingId`, null `featureId`.
5. Scope, Feature, and Jira Epic: all three IDs non-null.

Every non-null relationship must share the Work Item's exact Organization, Workspace, and Scope. Schema v3 and every unknown version fail closed; there is no compatibility reader, migration, normalization, or dual write.

The Work Item's `jiraId` and `jiraKey` identify that Work Item in Jira. They do not identify its parent Jira Epic. Parent Epic metadata is resolved through `jiraEpicMappingId` and is projected separately as key, name, project key, and mapping status.

Existing Scope, Feature, and Jira Epic mapping IDs cannot be removed or reparented by ordinary persisted transitions. Jira Epic mapping metadata and status remain editable under the stable ID. An inactive mapping may remain referenced; status changes do not clear Work Items.

## Consequential workflows

Direct `assign-feature` and `assign-jira-epic` actions use the same parent-scoped, revision-bound preview/apply protocol. Their preview hash binds the exact before/after values to the current persisted revision. Apply reconstructs the preview, rejects stale or altered input, appends an Audit Event, and performs no Jira call. A direct action changes only its named relationship.

Individual and bulk `assign-scope` previews return `featureChange` and `jiraEpicChange` independently. Each effect is `retained`, `cleared`, or `replaced`.

- Omitting a relationship preserves it only when it is compatible with the target Scope; otherwise it clears.
- Supplying a relationship explicitly validates its exact parents and applies it.
- Supplying null explicitly clears only that relationship.
- Selecting Unassigned forces both relationships to null.
- Wrong-parent and unknown IDs share the same non-disclosing response.
- No-op and stale previews fail without mutation.

Evidence Scope reassociation remains part of Scope assignment and is audited separately. It does not combine Feature and Jira Epic identity.

## Import boundary

The target JSON import format remains `target-v3`; import-format version and persisted-data schema version are independent.

Import remains human-in-the-loop. Exact Jira project and Epic keys may propose association with an existing active mapping. The proposal contains the stable mapping ID and separate Feature/Jira effects, writes nothing, and is applied only when explicitly selected against the original revision and preview hash. Name-only, fuzzy, ambiguous, or conflicting identifiers remain unresolved. A proposed mapping creation never automatically associates a Work Item and never calls Jira.

## Read models and UI

Work Item list/detail, Today, search, Briefing candidates, Organization export/backup, and scoped AI context expose Feature and Jira Epic context as separate fields. Search matches Feature name, mapped Epic key/name, and the Work Item's own Jira key without conflating them. Current Briefing candidates resolve current mapping metadata; finalized and communicated frozen snapshots are immutable.

The Work Items screen provides stable-ID Scope, Feature, and Jira Epic filters. Assignment controls are Scope-filtered and disambiguate duplicate names with IDs and Jira metadata. `No Feature` and `No Jira Epic` are explicit choices. Compatible-retention is the default for each relationship, so changing one does not change the other. Unassigned disables both selectors and sends explicit null values. Rows display Scope, Feature, mapped Epic key/name/status, and the Work Item Jira key distinctly. Settings show Scopes, Features, and Jira Epic mappings in separate cards.

## Seed, release, and security

The schema-v4 generic seed retains the exact fictional Organization, Workspace, and four Scopes from schema v3 and leaves every operational collection empty. No customer identifiers, private paths, runtime bytes, or operational evidence belong in Git.

The source release must pass focused association tests, the complete test/build/security gates, dependency audit, staged schema-v4 startup and browser/API smoke, exact schema-v3 rollback rehearsal at commit `49e59a3fbb56c9ec6ea01c6f0c58d0c9d66113a5`, and a final read-only comparison of the live schema-v3 fingerprint. Publication does not authorize merge or live reset.

# Priorena Target Product Model Specification

**Status:** Approved target model
**Version:** 1.5
**Date:** 2026-08-14
**Product owner:** Priorena product owner
**Purpose:** Canonical product-model, terminology, scope, workflow, clean-cutover, and acceptance specification for implementation by Codex.

---

## 1. Authority and supersession

This repository copy is the repository-safe canonical target-model specification for Priorena. Customer-specific local bootstrap data is private environment configuration and must not be committed. All named Organizations, Workspaces, Initiatives, Jira records, and IDs in this document are fictional examples; they do not prescribe universal onboarding defaults.

Version 1.5 adopts the strict schema-v5 Initiative and Workstream model. It replaces the schema-v4 Scope and Feature source model without migration, aliases, or dual-schema behavior. Workstreams and Jira Epic mappings are independent optional Initiative children or associations, and all consequential Work Item relationship changes remain human-reviewed. The current local schema-v4 runtime is disposable and remains untouched until a separate post-merge reset authorization.

`docs/audits/PRIORENA_TARGET_MODEL_GAP_ANALYSIS.md` remains authoritative about the current implementation, routes, logic, Organization-isolation and security risks, and tests. Its migration, reconciliation, legacy-preservation, and compatibility recommendations are superseded by this version and `docs/plans/PRIORENA_CLEAN_CUTOVER_IMPLEMENTATION_PLAN.md`.

It supersedes any current documentation, code comments, UI copy, or architectural decision that treats:

- a Workspace as a Project;
- a Priorena Project as the same entity as a Jira Epic;
- `Project / Jira Epic` as one combined concept;
- `Miscellaneous / No Epic` as a real Project or Initiative;
- Portfolio as an aggregation across all organizations;
- Today as a global cross-workspace view;
- Status Summary and Teams Draft as permanent communication systems parallel to Briefings.

The following existing principles remain in force unless this specification explicitly changes them:

- human review before consequential changes;
- no automatic Jira write-back;
- preview-before-apply for bulk and imported changes;
- exact evidence provenance;
- deterministic grounded output without requiring AI;
- optional, reviewable AI enhancement;
- immutable finalized/communicated briefing history;
- safe archive and recovery behavior.

Legacy code may remain temporarily only while its target replacement is being implemented and verified against a separate target-shaped data file. The target implementation must not create a long-lived dual-schema, dual-write, legacy-ID translation, or compatibility architecture. Legacy storage names are not canonical product terms and must not be introduced into new UI, documentation, APIs, tests, or domain logic.

One timestamped byte-for-byte backup of the pre-reset runtime file, with a recorded SHA-256 checksum, is retained as a release rollback safeguard. It is not a migration source and must not be used to repopulate selected legacy records into the target model.

---

## 2. Product intent

Priorena is a human-in-the-loop delivery-intelligence SaaS for:

- individual Scrum Masters;
- project managers;
- Agile and delivery consultants;
- small delivery teams.

Priorena is not intended to become a heavyweight enterprise PPM platform.

Its primary job is to help a user answer:

1. What requires my attention?
2. What evidence supports that conclusion?
3. What delivery action or follow-up should I take?
4. What can I communicate accurately to stakeholders?

The product must favor grounded decisions over project-administration overhead.

---

## 3. Approved decisions

The following decisions are approved and must be treated as requirements.

1. Priorena supports multiple Organizations.
2. Organizations are independent data and operating boundaries.
3. The canonical hierarchy begins with:

   `Organization → Workspace → Initiative`

   An Initiative may contain Workstreams, Jira Epic mappings, and Work Items. A Work Item may use either optional association, both, or neither.

4. The normal UI label for Initiative is **Initiative**.
5. An Initiative can exist without a Jira Epic.
6. An Initiative can contain zero or more Jira Epic mappings.
7. A Jira Epic is an optional external-system mapping, not the identity of an Initiative.
8. A Work Item can remain **Unassigned** when its Initiative is unknown.
9. Priorena must not automatically create `Miscellaneous / No Epic` or an equivalent fake Initiative.
10. Milestones can apply to:
    - an entire Workspace; or
    - one Initiative.
11. Portfolio is a separate global destination within the selected Organization.
12. Today always represents the selected Workspace.
13. Briefings become the only current communication workflow after target behavior, automated tests, and release acceptance confirm feature parity.
14. The committed and staged generic seed uses exactly Organization `org-1` / `Organization 1`, Workspace `workspace-1` / `Workspace 1`, and Initiatives `initiative-1` through `initiative-4` / `Initiative 1` through `Initiative 4`. It contains no Workstreams or operational records.
15. Data from different Organizations must never be blended in ordinary product views, searches, Briefings, Sources, Evidence, exports, or settings.
16. The current local runtime records and history are disposable and are not migrated into the schema-v5 target model.
17. Follow-Up is stored as a nested object on Work Item.
18. `Milestone.linkedWorkItemIds[]` is the canonical Milestone/Work Item relationship.
19. Workspace-specific prompt overrides and drafting guidance must be stored in Workspace settings, never in `globalTechnicalSettings`.
20. The first target release accepts the current target external-feed format only, unless an active producer is verified to require an older version.
21. Briefings retain Teams-style, email-style, and Confluence-style deterministic outputs from one finalized fact set.
22. The timestamped pre-reset backup and checksum record are retained for 30 days after successful release acceptance.
23. Privileged all-Organization export is deferred; ordinary exports and backups remain Organization-scoped.
24. The target implementation must not create a long-lived dual-schema, dual-write, or legacy-ID translation architecture.
25. Workstream is a Priorena-owned entity under one Initiative and is independent from Jira Epic mappings.
26. A Work Item has a nullable `workstreamId`; any non-null Workstream must match its Organization, Workspace, and Initiative.
27. Workstream is not a Work Item type. Allowed Work Item types are Story, Task, Bug, Other, and Unknown.
28. Organization, Workspace, Initiative, and Workstream display-name changes require revision-bound preview/apply and audit history while preserving stable IDs and frozen Briefing snapshots.
29. Every schema-v5 Work Item persists a required nullable `jiraEpicMappingId` independently from `workstreamId` and from the Work Item's own `jiraId` and `jiraKey`.
30. A non-null Work Item Jira Epic mapping must match the Work Item's exact Organization, Workspace, and Initiative.
31. Changing, clearing, or editing one Work Item relationship must not change the other unless an Initiative change makes that relationship incompatible.
32. Source-code merge authorization remains separate from authorization to reset the live schema-v4 runtime with a schema-v5 seed.
33. Active schema-v5 APIs, payloads, exports, imports, UI, and tests have no Scope or Feature compatibility aliases.
34. Jira Epic mappings are created and managed locally in Settings under a parent Initiative; this never creates or modifies Jira data.
35. The strict import contract is `target-v4`, distinct from persisted `schemaVersion: 5`; it does not create a Workstream or Jira Epic mapping and never assigns relationships without explicit review/apply.
36. Strategy and Sub-task hierarchy are not part of this model.

---

## 4. Canonical hierarchy

```text
Organization
    ↓
Workspace
    ↓
Initiative
    ├── optional Workstream ────→ Work Items
    ├── optional Jira Epic mapping
    └── Work Items with optional Workstream and/or Jira Epic association
```

Fictional target-shaped example:

```text
Organization 1                           Organization
└── Workspace 1                       Workspace
    ├── Initiative 1                          Initiative
    │   └── future Workstreams              Workstream
    ├── Initiative 2                          Initiative
    ├── Initiative 3                          Initiative
    └── Initiative 4                          Initiative
```

The clean seed contains no Workstreams or Work Items. Future Work Items whose Initiative is unknown use `initiativeId: null`, `workstreamId: null`, and `jiraEpicMappingId: null` and appear as **Unassigned**; Unassigned is a state/view, not an entity.

Jira is mapped beside this hierarchy:

```text
Initiative ─────────────→ zero or more Jira Epic mappings
Work Item ─────────→ optional Jira work-item mapping
```

Jira does not create an additional Priorena hierarchy level.

---

## 5. Core entity definitions and invariants

### 5.1 Organization

An Organization is the customer, company, employer, consulting account, or other independent tenant boundary.

Examples:

- Organization 1
- another fictional tenant used in isolation tests

#### Organization invariants

- Every Workspace belongs to exactly one Organization.
- An Organization can contain multiple Workspaces.
- An Organization can exist with no Workspaces during onboarding.
- A Workspace cannot belong to more than one Organization.
- A Workspace cannot be moved to another Organization through a normal edit operation. Such a move requires an explicit migration with validation and audit history.
- Ordinary product operations must never combine data from more than one Organization.
- Organization deletion must not be the default cleanup mechanism. Archive is preferred.
- A user may access multiple Organizations, but only one Organization is active in the normal product context at a time.

#### Current implementation boundary

The present local single-user build does not need full hosted authentication or member-role administration to implement this model. However:

- stable Organization IDs must exist now;
- every data-access path must be Organization-aware;
- cross-Organization references must be rejected;
- the model must be ready for future membership and authorization without another domain rewrite.

Authentication, billing, and enterprise role design are outside this specification.

---

### 5.2 Workspace

A Workspace is the delivery operating context that one PM, Scrum Master, consultant, or small team manages together.

A Workspace contains related delivery work that benefits from one operational Today view, shared Sources, shared settings, and potentially Workspace-wide Briefings and Milestones.

For the fictional repository example:

- Organization: `Organization 1`
- Workspace: `Workspace 1`

#### Workspace invariants

- Every Workspace belongs to exactly one Organization.
- Every Initiative belongs to exactly one Workspace.
- Every Work Item belongs to exactly one Workspace.
- Sources belong to one Workspace.
- Evidence extracted from a Source cannot be associated with a Work Item in another Workspace.
- Workspace settings do not automatically apply to another Workspace, even inside the same Organization.
- A Workspace can contain Work Items with no Initiative assignment.
- A Workspace name must describe the whole operating context, not only one subordinate Initiative.

#### Workspace-level settings

The following remain Workspace-specific unless a later decision explicitly promotes them:

- sprint catalog and current-sprint vocabulary;
- Jira status mapping;
- assignee directory;
- comment-freshness threshold;
- milestone due-soon threshold;
- prompt overrides and drafting guidance, which must never be stored in global technical settings;
- saved Work views;
- Workspace backup/export.

---

### 5.3 Initiative

An Initiative is a distinct initiative, project, workstream, product area, or body of work inside a Workspace that the user needs to filter, assess, milestone, or brief separately.

The canonical documentation term is **Initiative**. The ordinary UI label is **Initiative**.

Examples:

- Initiative 1
- Initiative 2
- Initiative 3
- Initiative 4

#### Initiative invariants

- Every Initiative belongs to exactly one Workspace.
- An Initiative may exist with no Jira Epic mapping.
- An Initiative may have zero or more Jira Epic mappings.
- One Jira Epic mapping may belong to only one active Initiative within a Workspace.
- An Initiative is not automatically created for every Jira Epic.
- A separate Initiative should exist only when the user needs separate filtering, risk assessment, Milestones, or Briefings.
- Initiative identity is Priorena-owned and survives external-system renames or removal.
- An Initiative may be archived without deleting its Work Items, Evidence, Milestones, or Briefing history.
- Similar names are never sufficient for automatic merging.

#### Initiative creation rule

Create an Initiative when the user needs to manage that body of work independently.

Do not create an Initiative merely because:

- a Jira Epic exists;
- a screenshot contains an Epic name;
- a Work Item has no Epic;
- two titles appear similar;
- an imported file groups rows together.

---

### 5.3.1 Workstream

A Workstream is a Priorena-owned body of related Work Items inside exactly one Initiative. It is a management grouping below Initiative, not a Jira Epic alias and not a Work Item type.

#### Workstream invariants

- Every Workstream has a stable ID and exactly one Organization, Workspace, and Initiative parent.
- Its persisted fields are `id`, `organizationId`, `workspaceId`, `initiativeId`, `name`, and bounded `description`.
- Duplicate Workstream names are allowed; identity and routing always use stable IDs and validated parents.
- A Workstream cannot move to another Initiative through rename or ordinary update.
- Creating, reading, updating, or renaming a Workstream performs no Jira call and creates no Jira Epic mapping.
- Workstream creation and metadata update are distinct from Jira mapping workflows.
- A Work Item may have `workstreamId: null`. A non-null `workstreamId` requires a non-null `initiativeId` and an exact Organization, Workspace, and Initiative match.
- Changing a Work Item Initiative must preview whether its Workstream is retained, cleared, or explicitly replaced. An incompatible Workstream is never silently moved.
- Workstream display-name changes use revision-bound preview/apply, append an Audit Event, preserve IDs and relationships, and do not rewrite frozen Briefing snapshots.

---

### 5.4 Jira mapping

Jira Project and Jira Epic are external-system concepts and must be stored separately from Priorena Initiative identity.

An Initiative may contain zero or more mappings such as:

```text
Jira project key: EXAMPLE
Jira Epic key: EXAMPLE-123
Jira Epic name: Fictional External Epic
Mapping status: verified
```

#### Jira mapping invariants

- `jiraProjectKey` and `jiraEpicKey` are different fields.
- A missing Jira Epic is not represented by a fake Initiative.
- `noEpic: true` from a reviewed external feed means only that no Epic mapping was visible for that Work Item.
- An exact Epic mapping may propose an Initiative association only when the Epic mapping already belongs to one Initiative or the user explicitly selects the Initiative.
- Priorena must not assign an Initiative from title similarity, row proximity, meeting context, or hidden/unreadable screenshot content.
- Duplicate Jira Epic mappings within one Workspace must be blocked or routed to reconciliation.
- External names are preserved for provenance even when the user-facing Initiative name differs.
- A Jira Epic mapping has a stable ID and cannot be removed or reparented while ordinary metadata edits remain allowed.
- Mapping status changes do not clear Work Item references. Current projections show the current mapping key, name, and status; frozen Briefing Versions remain unchanged.
- Assigning or clearing a mapping on a Work Item uses revision-bound preview/apply and performs no Jira call.

#### Example

```text
Initiative: Initiative 1
Jira Epic mappings:
- EXAMPLE-123 — Fictional External Epic
- additional verified fictional Epics, if later approved
```

This allows the Initiative to remain the PM’s management boundary while Jira Epics remain external delivery structures.

---

### 5.5 Work Item

A Work Item is the unit of delivery work Priorena tracks.

Canonical types remain:

- Story
- Task
- Bug
- Other
- Unknown

#### Work Item invariants

- Every Work Item belongs to exactly one Workspace.
- A Work Item has zero or one primary Initiative in the MVP.
- `initiativeId = null` means **Unassigned**.
- A Work Item has zero or one Workstream through nullable `workstreamId`.
- `workstreamId = null` means the Work Item has no Workstream; it is independent from Unassigned Initiative state.
- A non-null Workstream must be a child of the Work Item's exact Initiative and matching Organization and Workspace.
- A Work Item has zero or one Jira Epic mapping through required nullable `jiraEpicMappingId`.
- `jiraEpicMappingId = null` means the Work Item has no Jira Epic association. A non-null mapping must belong to the Work Item's exact Organization, Workspace, and Initiative.
- Workstream and Jira Epic associations are independent. Either, both, or neither may be present under a non-null Initiative.
- The Work Item's own `jiraId` and `jiraKey` identify the Work Item; they are not its parent Jira Epic mapping.
- `Initiative`, `Workstream`, `Feature`, `Epic`, and `Sub-task` are rejected as Work Item `itemType` values. An external source value such as `Feature` is retained as bounded provenance and never infers a Workstream.
- A Work Item may have a Jira key even when it is Unassigned.
- Work Item identity must not be inferred from title alone when an external Jira key is available.
- Work Items in different Organizations are independent even when they have the same Jira key, title, or external-system name.
- Archived Work Items are excluded from ordinary operational views but retained for history and recovery.
- Current operational state and historical Evidence are separate concepts.
- Historical Evidence must not silently overwrite current state.

The five valid Work Item association states are:

1. Unassigned: `initiativeId`, `workstreamId`, and `jiraEpicMappingId` are null.
2. Initiative only.
3. Initiative plus Workstream.
4. Initiative plus Jira Epic mapping.
5. Initiative plus both Workstream and Jira Epic mapping.

A non-null Workstream or Jira Epic mapping always requires the same non-null Initiative parent.

#### Initiative assignment

A Work Item may be assigned to an Initiative through:

1. explicit user assignment;
2. a reviewed external-feed proposal supported by exact same-item evidence;
3. an exact Jira Epic mapping that uniquely resolves to one Initiative, with preview and approval where consequential.

A Work Item must remain Unassigned when the association is ambiguous.

Every individual or bulk Initiative preview reports `workstreamChange` and `jiraEpicChange` separately as retained, cleared, or replaced. An omitted relationship selection preserves a compatible current value and otherwise clears it; an explicit selection is validated against the target Initiative. Selecting Unassigned forces both relationships to null. A direct `assign-workstream` action never changes the Jira Epic mapping, and a direct `assign-jira-epic` action never changes the Workstream.

#### No-Epic handling

The following are valid and distinct:

```text
Initiative: Initiative 1
Jira Epic: none
```

```text
Initiative: Unassigned
Jira Epic: none
```

The product must not create or use `Miscellaneous / No Epic` to make assignment coverage appear complete.

---

### 5.6 Source, Finding, Evidence, and Proposed Change

Priorena’s grounded-intelligence lifecycle is:

```text
Source
    ↓ extraction
Finding
    ↓ human review
Accepted Evidence
    ↓ optional field-level proposal
Proposed Change
    ↓ explicit approval
Current local Work Item state
```

#### Source

A Source is the original retained input or the normalized record of an approved external feed.

Examples:

- DSU notes
- Sprint Planning notes
- Backlog Refinement notes
- structured meeting note
- approved screenshot transcription feed

Source invariants:

- A Source belongs to exactly one Workspace.
- A Source may discuss multiple Initiatives and Work Items within that Workspace.
- A Source cannot directly modify current Work Item state.
- Source provenance and trust limitations must remain visible.

#### Finding

A Finding is a statement extracted from a Source and awaiting review.

- A pending Finding is not yet Evidence.
- A Finding retains its exact excerpt, source ID, extraction method/version, category, and proposed associations.
- A Finding may be accepted, rejected, or left pending.

#### Evidence

Evidence is an accepted Finding.

Evidence may support:

- an entire Workspace;
- one Initiative;
- one Work Item;
- a Proposed Change.

Evidence must retain:

- source date;
- exact excerpt;
- accepted date;
- accepted-by context where available;
- current versus historical relevance when known;
- superseded or contradicted state when later Evidence establishes a change.

Implementation may store Finding and Evidence as one record with review status. The product must preserve the conceptual distinction in UI and business logic.

#### Proposed Change

A Proposed Change is a field-level local mutation supported by Evidence.

It must include:

- target Work Item;
- target field;
- current value at preview time;
- proposed value;
- supporting Evidence IDs;
- review state;
- stale-value protection.

Acceptance of Evidence does not automatically approve a Proposed Change.

---

### 5.7 Current state and historical updates

Current Work Item state must be distinguishable from historical updates.

Required rule:

> Priorena must not present an old accepted update as the current state merely because no newer update exists.

The implementation may use source-status mapping and reviewed local state to determine current status, but it must retain provenance.

When a status is inferred rather than explicitly recorded, the UI must label it as inferred or estimated.

Historical Evidence remains available for audit and Briefing history but does not silently become current.

---

### 5.8 Follow-Up

Follow-Up is the PM’s intervention state around a Work Item. It is not a second Work Item type and not a separate backlog hierarchy.

Conceptually:

```text
Work Item
└── Follow-Up state and fields
```

Recommended states:

- None
- Open
- Waiting
- Resolved

Follow-Up must be stored as a nested object on its Work Item. It must not be implemented as a separate top-level delivery entity, backlog, or long-lived compatibility record. The target UI presents one coherent Follow-Up concept.

A Follow-Up may contain:

- person/contact;
- last contact date;
- last captured Jira comment date;
- next action;
- optional due date;
- PM note.

#### Follow-Up signal rules

- **Needs follow-up** and **quiet thread** are separate signals.
- A missing captured comment date must not be displayed as `never` unless Priorena has explicit evidence that no comment exists.
- Preferred wording for unknown data is `No comment date captured`.
- Quiet-thread logic may suggest Follow-Up but must not create or send anything automatically.

---

### 5.9 Milestone

A Milestone is a dated delivery checkpoint.

Every Milestone must explicitly apply to either:

- the entire Workspace; or
- one Initiative.

Reference shape:

```text
Milestone
- workspaceId
- initiativeId: null for entire Workspace, otherwise one Initiative
- title
- date
- status
- notes
- linkedWorkItemIds
```

#### Milestone invariants

- An Initiative-level Milestone and all linked Work Items must belong to the same Workspace.
- A Work Item from another Initiative may be linked only when the user explicitly chooses it and the product clearly displays the cross-scope relationship. The default should be same-Initiative linking.
- No Milestone may link to a Work Item in another Organization.
- `Milestone.linkedWorkItemIds[]` is the canonical Milestone/Work Item relationship. Work Items must not store a competing canonical `milestoneId` or legacy `timelineId` relationship.
- Existing independent Project/Initiative target dates should not compete with Milestone dates.
- A primary delivery target should be represented by a designated Milestone rather than a second unrelated date field.

---

### 5.10 Briefing and Briefing Version

Briefings are the canonical communication workflow.

A **Briefing** is a reusable configuration containing:

- name;
- Organization;
- one or more Workspaces within that Organization;
- optional selected Initiatives within those Workspaces;
- audience profile;
- output formats;
- default sections;
- last-communicated baseline.

A **Briefing Version** is one generated update moving through:

```text
Draft → Finalized → Communicated
```

#### Briefing invariants

- A Briefing belongs to exactly one Organization.
- A Briefing may cover one or more Workspaces only within that Organization.
- A Briefing can cover an entire selected Workspace, selected Initiatives, or both, according to explicit scope selection.
- A Briefing cannot include data from another Organization.
- Pending or rejected Findings are excluded.
- Finalized facts are frozen and retain provenance.
- Manual PM input is visibly labeled and cannot claim Evidence IDs.
- Teams, email, and Confluence outputs derive from the same finalized fact set.
- Only **Mark communicated** advances the last-communicated baseline.
- A finalized but not communicated version remains Open; it is not ordinary history yet.
- Communicated versions are immutable History records.

#### Status Summary

Status Summary becomes a Briefing template/type, for example:

```text
Briefing type: Delivery status
```

Legacy Status Summary and Legacy Teams Draft may remain only while the target Briefing behavior is being implemented. After feature parity and release acceptance are confirmed, they must be removed from normal navigation and creation flows. Existing legacy Briefing records and history are not migration requirements.

---

### 5.11 Portfolio

Portfolio is a computed view across Workspaces in the active Organization.

#### Portfolio invariants

- Portfolio never combines Organizations.
- Portfolio counts Workspaces as Workspaces, not Projects.
- Every Portfolio item must display its Workspace and, where relevant, its Initiative.
- Portfolio is not a stored project-management container.
- Portfolio does not own Sources, Work Items, Milestones, or Briefings.
- An Organization with one Workspace may still show Portfolio, but the UI may de-emphasize it.

Example heading:

```text
Portfolio — Organization 1
All Workspaces
```

---

### 5.12 Today

Today is the selected Workspace’s attention-first operating view.

#### Today invariants

- Today always requires one active Workspace.
- Today never represents all Organizations.
- Today does not silently switch to Portfolio behavior.
- Today surfaces blocked work, Follow-Up signals, milestone pressure, evidence gaps, and other delivery attention within the selected Workspace.
- Every item shown from a subordinate Initiative displays that Initiative.

Example heading:

```text
Today — Workspace 1
Organization 1
```

---

## 6. Organization isolation requirements

Organization independence is a hard product and data integrity requirement.

### 6.1 Data-access rules

Every read, calculation, mutation, search, export, import, and generated output must resolve the Organization boundary before returning data.

The server must validate parent relationships rather than trusting client-supplied IDs.

Examples:

- a Workspace ID must resolve to the active Organization;
- an Initiative ID must resolve to the selected Workspace;
- a Work Item’s Initiative must belong to the same Workspace;
- a Milestone’s Initiative and linked Work Items must remain inside the same Organization;
- a Briefing’s Workspaces and Initiatives must all belong to one Organization;
- a Source’s Findings cannot link to Work Items outside the Source Workspace.

### 6.2 User-facing isolation

When `Organization 1` is active, the following must contain only that Organization's data:

- Portfolio;
- Workspace selector;
- Today;
- Work;
- Follow-Up;
- Milestones;
- Capture and Source Library;
- Evidence Review;
- Briefings and History;
- search;
- filters;
- exports and ordinary backups;
- assignee directory;
- Jira mappings;
- sprint catalog;
- status mapping;
- AI prompt context.

There is no normal `All Organizations` operational view in this specification.

Privileged all-Organization export is deferred beyond the first target release. Ordinary exports and product backups must be explicitly Organization-scoped. The one offline, whole-file pre-reset backup is a release rollback safeguard, not a product export and not a Portfolio capability.

### 6.3 Selection behavior

The application maintains:

- one active Organization;
- one active Workspace within that Organization.

When the user switches Organizations:

- the Workspace list changes immediately;
- the application restores the last active Workspace for that Organization when available;
- otherwise it selects the first available Workspace or prompts the user to create/select one;
- no previous Organization’s operational data remains visible.

---

## 7. Canonical terminology

| Canonical term | Meaning | Do not use as synonym |
|---|---|---|
| Organization | Independent customer/company/account boundary | Portfolio, Project, Workspace |
| Workspace | Delivery operating context managed together | Project |
| Initiative | Canonical model term for a distinct initiative/workstream inside a Workspace | Project / Jira Epic |
| Initiative | Normal UI label for Initiative | Epic unless specifically external Jira data |
| Jira project | External Jira container/project key | Priorena Project |
| Jira Epic | External Jira Epic mapped to an Initiative | Initiative identity |
| Work Item | Tracked unit of delivery work | Story when type is unknown |
| Unassigned | Work Item has no Initiative yet | Project not identified, Miscellaneous / No Epic |
| Source | Original retained input or normalized external feed | Evidence before review |
| Finding | Extracted statement awaiting review | Evidence pending |
| Evidence | Accepted Finding with provenance | Unreviewed extraction |
| Proposed Change | Suggested local field mutation requiring approval | Accepted Evidence |
| Follow-Up | PM intervention/conversation state around a Work Item | Tracked item as the primary noun |
| Milestone | Dated Workspace- or Initiative-level checkpoint | Project target when duplicative |
| Briefing | Reusable stakeholder update configuration | Briefing stream, Project stream |
| Briefing Version | Draft, Finalized, or Communicated instance | Separate Teams/status systems |
| Portfolio | Cross-Workspace view inside the active Organization | Cross-organization view |
| Today | Attention view for the selected Workspace | Portfolio |

### Required wording replacements

| Current wording | Required wording |
|---|---|
| Projects / Jira Epics | Initiatives |
| Project / Jira Epic | Initiative |
| Assign Project / Jira Epic | Assign Initiative |
| Project not identified | Unassigned |
| Miscellaneous / No Epic | Remove as an entity; show Unassigned or No Jira Epic linked |
| All projects | All initiatives, or All workspaces depending on actual level |
| this project when Workspace-scoped | this workspace |
| whole PM workspace | entire workspace |
| Project stream | Briefing |
| Create briefing stream | Create briefing |
| Evidence pending | Findings to review |
| last comment never for missing data | No comment date captured |
| Delivery progress | Estimated progress, with basis shown |

---

## 8. Reference logical data model

This is a logical target model. The local single-file implementation may remain nested for simplicity, provided all identities and invariants are enforced.

```text
RootData
- schemaVersion
- organizations[]
- workspaces[]
- initiatives[]
- workstreams[]
- jiraEpicMappings[]
- workItems[]
- milestones[]
- sources[]
- findings[]
- evidence[]
- proposedChanges[]
- briefings[]
- briefingVersions[]
- auditEvents[]
- userPreferences
- globalTechnicalSettings, technical-only; no Workspace prompt or drafting configuration

Organization
- id
- name
- description
- archived
- createdAt
- updatedAt
- workspaces[]
- briefings[]
- briefingVersions[]

Workspace
- id
- organizationId
- name
- description
- archived
- createdAt
- updatedAt
- initiatives[]
- workstreams[]
- workItems[]
- milestones[]
- sources[]
- savedViews[]
- changeHistory[]
- settings
- promptOverrides
- draftingGuidance
- assigneeDirectory
- jiraStatusMapping

Initiative
- id
- organizationId
- workspaceId
- name
- description
- owner
- archived
- createdAt
- updatedAt
- jiraEpicMappings[]
- primaryMilestoneId optional

Workstream
- id
- organizationId
- workspaceId
- initiativeId
- name
- description

JiraEpicMapping
- id
- organizationId
- workspaceId
- initiativeId
- jiraProjectKey
- jiraEpicKey
- jiraEpicName
- mappingStatus
- provenance
- verifiedAt

WorkItem
- id
- organizationId
- workspaceId
- initiativeId null or one Initiative
- workstreamId null or one Workstream under that Initiative
- jiraEpicMappingId null or one Jira Epic mapping under that Initiative
- jiraId optional
- jiraKey optional; identifies the Work Item, not the parent Jira Epic
- itemType
- summary
- description
- canonicalStatus
- sourceStatus optional
- assignee
- sprint
- labels[]
- dependencies[]
- notes
- archived
- followUp nested object
  - state: none | open | waiting | resolved
  - person/contact optional
  - lastContactAt optional
  - lastCapturedCommentAt optional
  - nextAction optional
  - dueAt optional
  - note optional
- evidence/update history references

Milestone
- id
- organizationId
- workspaceId
- initiativeId null for entire Workspace
- title
- date
- status
- notes
- linkedWorkItemIds[]

Source
- id
- workspaceId
- title
- type
- sourceKind
- date
- provenance
- file metadata or normalized feed
- findings[]

Finding
- id
- sourceId
- exactExcerpt
- category
- reviewStatus
- proposedWorkItemId optional
- proposedInitiativeId optional
- currentness
- supersededBy optional

Evidence
- id
- sourceId
- findingId
- workspaceId
- initiativeId optional
- workItemId optional
- exactExcerpt
- sourceDate
- acceptedAt
- acceptedBy context optional
- currentness
- supersededBy optional

ProposedChange
- id
- findingId
- evidenceIds[]
- workItemId
- field
- beforeValue
- proposedValue
- reviewStatus
- snapshotHash

Briefing
- id
- organizationId
- name
- workspaceIds[]
- initiativeIds[]
- audienceProfile
- preferredFormats[]
  - teams
  - email
  - confluence
- defaultSections[]
- lastCommunicatedVersionId
- archived

BriefingVersion
- id
- organizationId
- briefingId
- workspaceIds[]
- initiativeIds[]
- status: draft | finalized | communicated
- comparisonVersionId
- frozenSnapshot
- facts[]
- outputs[]
- createdAt
- finalizedAt
- communicatedAt
```

### Target storage transition

- The target source model uses strict `schemaVersion: 5`, requires `workstreams[]`, `jiraEpicMappings[]`, and required nullable `workItems[].jiraEpicMappingId`, and uses canonical target identities.
- Schema version 4 fails closed. There is no v4 compatibility reader, migration path, or dual reader/writer.
- The current legacy runtime file is not read as a migration input by the target implementation and is not translated record by record.
- Target development and validation use a separate target-shaped data file until cutover.
- The old application and legacy schema may remain temporarily available only for implementation sequencing.
- There is no target dual write, long-lived dual-schema reader, legacy-ID manifest, tombstone system, or name-to-ID compatibility layer.
- At the gated cutover, the stopped application's runtime file is atomically replaced with the already validated clean environment seed.

---

## 9. Screen context requirements

### 9.1 Global shell

The shell must show:

1. active Organization;
2. active Workspace within that Organization;
3. navigation appropriate to the current level.

Suggested arrangement:

```text
Organization
[Organization 1 ▼]

Workspace
[Workspace 1 ▼]

GLOBAL
Portfolio

WORKSPACE
Today
Work
Capture
Communicate

CONFIGURE
Settings
```

### 9.2 Portfolio

Initiative: active Organization.

Must show:

- Workspaces, not Projects;
- attention signals across those Workspaces;
- Workspace name on every row/card;
- Initiative when a specific Initiative is relevant;
- no other Organization data.

### 9.3 Today

Initiative: active Workspace.

Must show:

- current Workspace name;
- attention queue;
- Initiative on each subordinate item;
- Workspace-level and Initiative-level Milestone pressure separately where relevant.

### 9.4 Work

Initiative: active Workspace.

Required filters:

- Initiative, default `All initiatives`;
- Workstream, including `No Workstream`;
- Jira Epic, including `No Jira Epic`;
- type;
- status;
- assignee;
- sprint;
- readiness;
- lifecycle;
- search.

Required bulk action wording:

- preview and apply Initiative, Workstream, and Jira Epic associations independently;
- Initiative may be one stable-ID Initiative or `Unassigned`;
- Workstream and Jira Epic selectors are limited to the selected Initiative and support keeping a compatible value or explicitly clearing it.

Every row must display:

- Work Item key and summary;
- Initiative or Unassigned;
- Workstream or No Workstream;
- Jira Epic key/name/status or No Jira Epic, visually distinct from the Work Item's own Jira key;
- assignee;
- sprint;
- status;
- relevant Follow-Up/readiness signal.

### 9.5 Follow-Up

Initiative: active Workspace, optionally filtered by Initiative.

Use Follow-Up language rather than exposing a separate tracked-item domain.

Required actions:

- Add follow-up to existing Work Item;
- add manual Work Item with Follow-Up only when the user explicitly creates it;
- record contact/comment freshness;
- resolve or remove Follow-Up without deleting the Work Item.

### 9.6 Milestones

Initiative: active Workspace.

Creation requires:

```text
Applies to
○ Entire workspace
○ Initiative: [select]
```

Every Milestone card must display its applicability.

### 9.7 Capture and Source Library

Initiative: active Workspace.

Recommended local navigation:

```text
Add Source | Sources | Review
```

Source upload does not require one Initiative because a Source may discuss several Initiatives.

### 9.8 Review

Display two consequence-based surfaces:

- Evidence-only Findings;
- Proposed Work Item changes.

Every review row shows:

- exact excerpt;
- Source;
- Work Item;
- Initiative or Unassigned;
- source date;
- whether acceptance changes current local state.

### 9.9 Communicate / Briefings

Initiative: active Organization, with explicitly selected Workspaces and optional Initiatives.

Primary navigation:

```text
Prepare | Open | History
```

Open contains Draft and Finalized versions. History contains Communicated versions.

No Briefing may span Organizations.

### 9.10 Settings

Recommended sections:

```text
Organization
Workspace
Initiatives
Workstreams
Jira Epic mappings
Behavior
AI — Advanced
Data & Privacy
```

Organization settings must not expose another Organization’s Workspaces or data.

The Workstreams section selects a parent Initiative and supports create and controlled rename. The Jira Epic mappings section selects a parent Initiative and supports local create, list, metadata edit, status change, deactivate, and reactivate behavior. It displays stable IDs, Jira project and Epic keys, Epic name, mapping status, provenance, and parent Initiative. It must state: “This creates or updates a Priorena mapping only. It does not create or modify anything in Jira.”

---

## 10. Workflow requirements

### 10.1 Organization and Workspace selection

```text
Select Organization
→ select Workspace within that Organization
→ Today opens for that Workspace
→ Portfolio remains available for the Organization
```

### 10.2 Initiative management

```text
Create Initiative
→ optionally add one or more Jira Epic mappings
→ review possible duplicates
→ assign Work Items explicitly or through reviewed exact mappings
```

### 10.3 Capture and evidence

```text
Capture Source
→ extract Findings
→ review exact excerpts
→ accept/reject
→ confirm Workspace/Initiative/Work Item association
→ preview Proposed Change when applicable
→ apply locally with stale-value protection
```

### 10.4 Daily triage

```text
Today — selected Workspace
→ inspect attention signal
→ open Initiative or Work Item
→ review current state and Evidence
→ add/resolve Follow-Up or approve local change
```

### 10.5 Milestone management

```text
Create Milestone
→ choose Entire Workspace or one Initiative
→ link Work Items
→ calculate delivery pressure/readiness
→ expose grounded Milestone facts to Briefings
```

### 10.6 Briefing workflow

```text
Create Briefing
→ select one Organization
→ select one or more Workspaces in that Organization
→ optionally select Initiatives
→ compare with last communicated version
→ review candidate facts
→ edit/select facts
→ generate deterministic outputs
→ optionally enhance with AI
→ finalize
→ copy/use externally
→ mark communicated
→ advance baseline
```

---

## 11. Clean cutover and local initial seed

### 11.1 Clean-cutover authority

The current local runtime data is disposable. The target implementation must not preserve, reconcile, translate, or migrate current runtime records solely because they exist. This includes:

- current Work Items and their assignments;
- legacy Project and Jira Epic records;
- `Miscellaneous / No Epic`;
- Sources, Findings, Evidence, recorded updates, and feed decisions;
- Follow-Up state;
- Milestones;
- Briefing definitions, versions, facts, outputs, and baselines;
- record IDs, mutable Workspace-name references, change history, and pending/applied feed state.

No item-level reconciliation package, tombstone system, legacy-ID translation manifest, or compatibility layer is required for these records.

### 11.2 Fictional repository seed and private bootstrap

The committed schema-v5 generic seed is fictional, deterministic, and target-shaped:

```text
Organization: org-1 / Organization 1
└── Workspace: workspace-1 / Workspace 1
    ├── Initiative: initiative-1 / Initiative 1
    ├── Initiative: initiative-2 / Initiative 2
    ├── Initiative: initiative-3 / Initiative 3
    └── Initiative: initiative-4 / Initiative 4
```

All four Initiatives have `organizationId: org-1` and `workspaceId: workspace-1`. User preferences select `org-1` and `workspace-1`. The seed creates no Workstreams, Work Items, Jira Epic mappings, Sources, Findings, Evidence, Proposed Changes, Follow-Up state, Milestones, Briefings, Briefing Versions, Audit Events, or legacy history. It does not create `Miscellaneous / No Epic` or another catch-all Initiative.

This committed seed is the exact authorized generic bootstrap shape for a future clean reset. It contains no customer-specific or operational values. Source-code merge authorization for this model remains separate from any later authorization to replace the live schema-v4 runtime with a schema-v5 seed.

### 11.3 Reset safeguard and retention

Before reset, create one timestamped byte-for-byte backup of the current runtime file and record:

- original runtime path;
- backup path;
- timestamp;
- byte count;
- SHA-256 checksum, reverified from the backup.

The backup is a rollback safeguard, not a migration source. Retain the backup and checksum record for **30 days after successful release acceptance**, then dispose of them according to the applicable local data-handling policy.

### 11.4 Reset gate

The current runtime file must not be deleted or replaced until all of the following are true:

1. the schema-v5 seed validates and a schema-v4 document fails closed;
2. the exact clean environment seed validates and loads from a staged, non-live path;
3. all automated tests pass, including two-Organization isolation tests;
4. the target application starts successfully against the staged seed and passes smoke tests;
5. the application is stopped so no write can race with backup or replacement;
6. the timestamped backup path and reverified checksum are recorded;
7. atomic reset and checksum-verified rollback have succeeded in rehearsal;
8. release go/no-go approval is recorded.

Only then may the stopped application's runtime file be atomically replaced with the already validated clean seed. A failed post-reset startup or smoke test triggers checksum-verified restoration of the backup.

### 11.5 Prohibited transition architecture

The target implementation must not create:

- long-lived dual-schema reads;
- dual writes;
- an old-ID-to-new-ID translation service;
- record tombstones solely for disposable local data;
- a reconciliation UI or item-level migration manifest;
- name-based Workspace aliases as permanent identity;
- compatibility code retained only because superseded tests assert legacy behavior.

Legacy code may coexist temporarily only while target replacements are implemented against a separate target data file. It must be removed after target behavior and release gates pass.

---

## 12. External-feed behavior under the target model

The strict active import contract is `target-v4`. This import-contract version is independent from persisted `schemaVersion: 5`. The prior `target-v3` contract and legacy relationship fields are rejected; there is no general compatibility parser.

Target behavior:

- feed import occurs inside one selected Workspace;
- feed evidence never chooses an Organization;
- exact visible Jira Epic evidence may identify a Jira Epic mapping;
- a mapped Epic may propose an Initiative only when it uniquely maps to one Initiative;
- an unmatched Epic remains an explicit reference-review item and does not create a mapping or infer an Initiative;
- `noEpic: true` never creates `Miscellaneous / No Epic`;
- missing, cropped, hidden, or unreadable Epic data means unknown, not no Epic;
- mutable names do not infer an Initiative or Workstream;
- external terms such as Feature are retained as bounded provenance and never infer a Workstream;
- imports never create a Workstream or Jira Epic mapping;
- Work Item creation and any exact-identifier Initiative or Jira association remain separate explicit review/apply decisions;
- Replace All must not bypass relationship approvals;
- stale-value protection remains mandatory.

---

## 13. Clean-cutover rollout

### 13.1 Cutover principles

- Build and validate the schema-v5 target model against separate temporary/staged data.
- Leave the current runtime file untouched until the reset gate in Section 11.4 passes.
- Do not expose legacy terminology in new UI, APIs, tests, or domain logic.
- Do not preserve legacy routes, mutable-name identity, data shapes, IDs, or history solely for the current disposable runtime.
- Retain legacy code only for bounded implementation sequencing; do not dual write.
- Remove legacy communication creation flows only after canonical Briefing behavior reaches feature parity.
- Treat the pre-reset backup as short-lived rollback protection, not target application data.

### 13.2 Required implementation phases

1. **Clean target schema and seed**
2. **Organization-isolated server and APIs**
3. **Core delivery workflows**
4. **Navigation, operational UI, and Briefings**
5. **Hardening, cleanup, and release**

The detailed phase gates, likely modules, tests, rollback steps, and commit boundaries are defined in `docs/plans/PRIORENA_CLEAN_CUTOVER_IMPLEMENTATION_PLAN.md`. That plan must remain consistent with this version of the specification.

---

## 14. Acceptance criteria

### 14.1 Organization isolation

- Two Organizations may contain Workspaces with identical names without collision.
- Two Organizations may contain Work Items with the same Jira key without collision.
- Switching Organization changes the Workspace selector and removes the previous Organization’s data from the screen.
- Portfolio shows only Workspaces in the active Organization.
- Search returns only active-Organization data.
- Briefing creation rejects Workspaces or Initiatives from another Organization.
- Source/Evidence links across Organizations are rejected.
- Exports and ordinary backups contain only the explicitly selected Organization or Workspace.
- AI prompt context contains no data from another Organization.

### 14.2 Workspace and Initiative

- In the generic repository seed, `org-1` / `Organization 1` exists as the only Organization.
- In that seed, `workspace-1` / `Workspace 1` exists as the only Workspace under `org-1`.
- In that seed, `initiative-1` through `initiative-4` / `Initiative 1` through `Initiative 4` exist under `workspace-1`.
- Other environments are not forced to create the example Organization or its Initiatives as an onboarding default.
- An Initiative can be created with no Jira Epic.
- An Initiative can hold multiple Jira Epic mappings.
- The same Jira Epic mapping cannot be active under two Initiatives in the same Workspace.
- A Jira Epic rename does not rename or recreate the Initiative automatically.
- Work can remain Unassigned.
- No action automatically creates `Miscellaneous / No Epic`.

### 14.3 Work

- Work displays `Initiative` and `Unassigned`, never `Project / Jira Epic`.
- Work includes an `All initiatives` filter.
- Bulk assignment supports one Initiative or Unassigned.
- A Work Item cannot be assigned to an Initiative from another Workspace.
- Ambiguous external associations remain pending/unassigned.

### 14.4 Milestones

- A Milestone can be created for the entire Workspace.
- A Milestone can be created for one Initiative.
- `Milestone.linkedWorkItemIds[]` is the canonical stored relationship to Work Items.
- Its applicability is visible on every card and detail screen.
- Cross-Organization links are rejected.
- Initiative-level Briefings include only applicable Milestones unless the user explicitly includes Workspace-wide Milestones.

### 14.5 Portfolio and Today

- Portfolio is a distinct global destination for the active Organization.
- Portfolio labels the count as Workspaces.
- Today always names and uses the active Workspace.
- Today does not show another Workspace’s Work Items.
- Queue rows display Initiative when applicable.

### 14.6 Evidence integrity

- Pending Findings are not labeled Evidence.
- Accepted Evidence retains exact Source provenance.
- Acceptance of Evidence does not automatically approve a Proposed Change.
- Historical Evidence does not silently replace current state.
- Missing comment data is not displayed as `never` unless explicitly known.

### 14.7 Briefings

- A Briefing belongs to one Organization.
- It can cover one or more Workspaces in that Organization.
- It can cover the entire Workspace or selected Initiatives.
- It cannot cover multiple Organizations.
- Open shows Draft and Finalized versions.
- History shows Communicated versions.
- Only Mark communicated advances the baseline.
- Teams-style, email-style, and Confluence-style outputs are generated deterministically from the same finalized fact set.
- Status Summary is available as a Briefing template.
- Legacy Status Summary and Teams Draft creation are removed from normal UI after parity validation.

### 14.8 Clean reset

- The schema-v5 model validates and schema v4 fails closed.
- The exact generic seed loads from a staged, non-live path.
- No legacy runtime records are present in the target store.
- The target application starts successfully against the clean seed.
- All automated tests pass.
- Two-Organization isolation tests pass.
- The timestamped pre-reset backup path and SHA-256 checksum are recorded and verified.
- Atomic reset and checksum-verified rollback rehearsal succeed before live replacement.
- The reset occurs only at the Section 11.4 gate.

---

## 15. Required tests

At minimum, implement automated tests for:

1. Organization-scoped reads and writes.
2. Duplicate names and Jira keys across Organizations.
3. Initiative-to-Workspace validation.
4. Work Item-to-Initiative validation.
5. Multiple Jira Epic mappings per Initiative.
6. Duplicate Epic mapping rejection within a Workspace.
7. Unassigned Work Item behavior.
8. No automatic `Miscellaneous / No Epic` creation.
9. Workspace- and Initiative-level Milestones using canonical `linkedWorkItemIds[]`.
10. Follow-Up persisted only as a nested Work Item object.
11. Briefing single-Organization enforcement, immutable lifecycle, and last-communicated baseline behavior.
12. Teams-style, email-style, and Confluence-style deterministic outputs from one finalized fact set.
13. Current target external-feed and no-Epic behavior, with older versions tested only when an active producer requires support.
14. Portfolio active-Organization filtering.
15. Today active-Workspace filtering.
16. Current-state versus historical-Evidence behavior.
17. Server/client status calculation consistency for any calculation that remains duplicated.
18. Workspace prompt overrides and drafting guidance never entering another Workspace or global technical settings.
19. Schema-v5 and exact generic-seed validation, including mandatory empty `workstreams[]`, the absence of legacy records, and v4 fail-closed behavior.
20. Successful application startup and smoke behavior against the clean seed.
21. At least two Organizations proving isolation across routes, UI, search, exports, backups, Briefings, Sources, Evidence, files, and AI context.
22. Timestamped backup creation, checksum verification, atomic reset rehearsal, and checksum-verified rollback rehearsal using temporary copies.
23. No automatic Jira write, Briefing finalization, or communication action.
24. Workstream parent validation, duplicate display names, nullable Work Item assignment, and foreign-reference rejection.
25. Initiative-change previews showing Workstream retained, cleared, or replaced for individual, bulk, and imported changes.
26. Revision-bound Organization, Workspace, Initiative, and Workstream renames preserving IDs, relationships, and frozen Briefing snapshots.
27. Workstream context in UI filters, Today, search, Briefing candidates, exports, backups, and scoped AI context.
28. Required nullable Jira Epic references, all five valid Work Item association states, exact-parent rejection, and stable mapping metadata updates.
29. Independent direct and Initiative-change preview/apply behavior for Workstream and Jira Epic associations, including no-op, stale, wrong-parent, bulk, import, and Unassigned cases.
30. Jira Epic context in UI filters/selectors, Today, search, Briefing candidates, exports, backups, and scoped AI context, while Work Item Jira identity remains distinct.
31. Strict rejection of legacy root collections, relationship fields, routes, actions, and import versions.
32. Complete local-only Jira Epic mapping management, including create, read, edit, status, deactivate/reactivate, stale revision, duplicate identity, and wrong-parent cases.
33. No Strategy or Sub-task entity, navigation, relationship, or Work Item type.

---

## 16. Non-goals

This implementation must not introduce:

- cross-Organization Portfolio reporting in normal product use;
- a Program layer between Workspace and Initiative;
- a Strategy layer, entity, ID, relationship, or navigation;
- a Sub-task entity, hierarchy, parent-child model, or Work Item type;
- automatic creation of one Initiative per Jira Epic;
- multiple primary Initiatives on one Work Item in the MVP;
- title-based Jira or Initiative matching;
- autonomous Jira updates;
- autonomous message sending;
- Gantt charts;
- resource capacity planning;
- budget or financial portfolio management;
- enterprise dependency planning;
- complex role-based access control in the current local build;
- a privileged all-Organization product export in the first target release;
- migration or selective restoration of the current disposable runtime records;
- a long-lived dual-schema, dual-write, tombstone, or legacy-ID translation architecture;
- a redesign of the visual system unrelated to this clean cutover.

---

## 17. Implementation freedoms

Codex may choose the least risky implementation approach for:

- nested versus normalized JSON storage;
- route and component decomposition;
- target schema validation and repository module structure;
- stable-ID generation for new non-seed records;
- temporary/staged target data-file placement before cutover;
- exact visual placement of selectors and breadcrumbs;
- test framework and fixtures.

Codex must not reinterpret the approved hierarchy, Organization isolation, Initiative semantics, Unassigned behavior, nested Follow-Up storage, canonical Milestone links, Workspace-owned prompt configuration, or Briefing lifecycle and outputs.

When implementation details are ambiguous, prefer:

1. data safety;
2. reviewability;
3. reversibility;
4. explicit scope;
5. the simplest UI understandable without training.

---

## 18. Definition of done

The target-model implementation is complete only when:

- the canonical hierarchy is visible and enforced;
- in the generic repository seed, `org-1` / `Organization 1` is the only Organization;
- in that seed, `workspace-1` / `Workspace 1` is the only Workspace;
- in that seed, `initiative-1` through `initiative-4` are the four exact Initiatives and `workstreams[]` is empty;
- Initiatives may exist without Jira Epics and may map to multiple Jira Epics;
- Work Items may remain Unassigned without a fake no-Epic Initiative;
- Follow-Up is nested on Work Item;
- Milestones are explicitly Workspace- or Initiative-level and use `linkedWorkItemIds[]` canonically;
- Portfolio is Organization-scoped and Today is Workspace-scoped;
- Workspace-specific prompt overrides and drafting guidance are not stored globally;
- Briefings are the canonical current communication workflow and retain Teams-style, email-style, and Confluence-style deterministic outputs;
- no ordinary screen, search, export, Briefing, or AI context leaks data across Organizations;
- the schema-v5 model validates, schema v4 fails closed, and the generic seed contains no operational or legacy records;
- the application starts successfully against the clean seed;
- all tests, including two-Organization isolation tests, pass;
- the pre-reset backup path and checksum are recorded;
- atomic reset and checksum-verified rollback rehearsal succeed;
- the pre-reset backup is retained for 30 days after successful release acceptance;
- no long-lived legacy compatibility or translation architecture remains;
- current APIs, payloads, imports, exports, UI, and active documentation contain no Scope or Feature aliases;
- Jira Epic mapping management is complete, local-only, and explicitly makes no Jira write;
- all acceptance criteria and required tests pass;
- current documentation no longer contradicts this specification.

---

## 19. Codex implementation contract

Before replacing the current runtime file or deleting legacy implementation paths, Codex must:

1. read this specification in full;
2. read `docs/plans/PRIORENA_CLEAN_CUTOVER_IMPLEMENTATION_PLAN.md` and the still-valid implementation findings in `docs/audits/PRIORENA_TARGET_MODEL_GAP_ANALYSIS.md`;
3. inspect current code and schema against them;
4. implement and validate the target against a separate temporary/staged data file;
5. validate the schema-v5 model and exact generic clean seed;
6. pass all automated tests, two-Organization isolation tests, target startup, and smoke tests;
7. create and verify the timestamped pre-reset backup and SHA-256 checksum;
8. rehearse atomic reset and checksum-verified rollback using temporary copies;
9. identify any implementation fact that makes a requirement unsafe or impossible as written;
10. stop for product-owner review only when the conflict changes product behavior or exceeds the approved clean-reset risk.

The target implementation must not use the current runtime as a migration source, and the current runtime must remain untouched until the Section 11.4 reset gate passes.

Codex must not treat old naming as evidence that the old domain model remains approved.

This document is the source of truth for the target product model.

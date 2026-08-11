# Phase 2 target server and API architecture

**Status:** Isolated development foundation

**Namespace:** `/api/v2`

**Store:** Explicit version-2 target file only

**Production cutover:** Not part of Phase 2

## Construction and boundaries

`createTargetApiApp({ targetDataFile, sourceFilesRoot })` creates the isolated target Express application. Both paths are mandatory constructor inputs. The target server has no environment-variable or live-runtime fallback and does not import the legacy server.

Every request reloads and validates the target file through `readTargetDataWithRevision()`. Successful API responses include `X-Priorena-Target-Revision`. Phase 2 exposes no target mutation route, so every target write remains reserved for later workflows that must call `writeTargetData()` with an explicit expected revision.

The target app preserves the local-only boundary, validates loopback Host values, rejects cross-origin or cross-site unsafe requests, applies bounded request handling and no-store security headers, and never listens on a network interface by itself. A future development launcher must bind it to `127.0.0.1` explicitly.

## Parent resolver contract

All identities are stable opaque IDs. Organization and Workspace names are display values only.

The authoritative resolver sequence is:

```text
Organization ID
→ Workspace ID and matching organizationId
→ child ID and matching organizationId + workspaceId
→ any additional Source, Finding, Evidence, Briefing, or Version parent
```

Workspace-owned resolution covers Scopes, Jira Epic Mappings, Work Items, Milestones, Sources, Findings, Evidence, Proposed Changes, and Source-file metadata. Briefing resolution validates the Organization plus every selected Workspace and Scope. Briefing Version resolution also validates its Briefing and selected parents.

Malformed IDs return:

```json
{"error":{"code":"INVALID_ID","message":"A valid stable identifier is required"}}
```

Unknown and wrong-parent IDs both return status `404` with the same body:

```json
{"error":{"code":"NOT_FOUND","message":"The requested target resource was not found"}}
```

The response never includes a foreign record name, ID, correct parent, count, or existence hint.

## Route contract

All routes are read-only.

| Route | Scope and response |
|---|---|
| `GET /api/v2/organizations` | Safe Organization display metadata. |
| `GET /api/v2/organizations/:organizationId` | One validated Organization. |
| `GET /api/v2/organizations/:organizationId/workspaces` | Workspaces owned by the Organization. |
| `GET /api/v2/organizations/:organizationId/workspaces/:workspaceId` | One validated Workspace. |
| `GET /api/v2/context?organizationId=...&workspaceId=...` | Server-validated active Organization and optional Workspace. An omitted Workspace uses a revalidated saved preference. |
| `GET /api/v2/organizations/:organizationId/portfolio` | Organization-scoped Portfolio projection. |
| `GET /api/v2/organizations/:organizationId/workspaces/:workspaceId/today` | Workspace-scoped Today projection. |
| `GET /api/v2/organizations/:organizationId/workspaces/:workspaceId/search?q=...` | Bounded Workspace search. |
| `GET .../scopes[/:childId]` | Scoped Scope list or record. |
| `GET .../jira-epic-mappings[/:childId]` | Scoped Jira Epic Mapping list or record. |
| `GET .../work-items[/:childId]` | Scoped Work Item list or record. |
| `GET .../milestones[/:childId]` | Scoped Milestone list or record. |
| `GET .../sources[/:childId]` | Safe Source list or explicitly authorized Source detail. Source content appears only in the detail response. |
| `GET .../findings[/:childId]` | Scoped Finding list or record. |
| `GET .../evidence[/:childId]` | Scoped Evidence list or record. |
| `GET .../proposed-changes[/:childId]` | Read-only scoped Proposed Change list or record. |
| `GET .../sources/:sourceId/findings[/:findingId]` | Source-parent-validated Findings. |
| `GET .../sources/:sourceId/evidence[/:evidenceId]` | Source-parent-validated Evidence. |
| `GET .../sources/:sourceId/file` | Parent-validated bounded Source-file download. |
| `GET /api/v2/organizations/:organizationId/briefings[/:briefingId]` | Organization-scoped Briefing definitions. |
| `GET /api/v2/organizations/:organizationId/briefings/:briefingId/versions[/:versionId]` | Read-only Version list or frozen Version content and output metadata. |
| `GET /api/v2/organizations/:organizationId/export` | Bounded Organization-only export. |
| `GET /api/v2/organizations/:organizationId/backup` | Bounded Organization-only ordinary backup. |

The target server has no all-Organization Portfolio, search, export, or backup route. It has no Scope, Work Item, Capture, review, Milestone, Briefing lifecycle, Jira-write, or communication mutation route.

## Portfolio response

Portfolio returns:

```text
organization: safe Organization metadata
counts:
  workspaces
  activeWorkspaces
  workItems
  unassignedWorkItems
  openFollowUps
  milestones
  sources
  findingsToReview
  acceptedEvidence
  briefings
workspaces[]:
  stable Workspace metadata
  counts for Scopes, Work Items, Unassigned Work Items, open Follow-Ups,
  Milestones, Sources, Findings to review, and accepted Evidence
```

All collections are restricted to the requested Organization before counting or serialization. Duplicate Workspace names remain separate rows keyed by stable ID.

## Today response

Today returns:

```text
organization: safe Organization metadata
workspace: safe Workspace metadata
counts:
  workItems
  assignedWorkItems
  unassignedWorkItems
  blockedWorkItems
  openFollowUps
  milestones
  findingsToReview
  acceptedEvidence
workItems[]: active local Work Items with stable Scope metadata or scopeId: null
attention:
  blockedWorkItems[]
  followUps[] for Open or Waiting state
  milestones[]
  findingsToReview[]
```

Blocked counts use the direct canonical statuses `Blocked` and `At risk`, case-insensitively. Archived Work Items are excluded. `scopeId: null` remains Unassigned and is never replaced by a synthetic Scope.

## Search

Search requires a trimmed query of 2–200 characters and returns at most 50 results. It searches only the validated Workspace's Scopes, Work Item display fields, Milestones, safe Source metadata, and Evidence excerpts. Source content and raw file metadata are not searched or returned through Source metadata results.

## Source, Evidence, and file access

Source lists omit Source content. One explicitly requested Source detail may include content after Organization, Workspace, and Source validation. Source-specific Finding and Evidence routes validate both the Workspace parent and the Source chain.

Optional file metadata uses this internal target shape:

```json
{
  "file": {
    "relativePath": "fictional-source.txt",
    "displayName": "fictional-source.txt",
    "mediaType": "text/plain",
    "byteLength": 123
  }
}
```

The API never serializes `relativePath` or arbitrary Source metadata, and it reduces a file display name to a safe basename. Retrieval resolves the configured safe root, rejects absolute paths and traversal, verifies real-path containment, opens a regular file without following a final symlink, ties the opened descriptor to the initially verified file identity, revalidates the root, candidate real path, descriptor identity, size, and timestamps before and after reading, applies the 10 MiB limit, and permits only the existing safe text, document, spreadsheet, presentation, PDF, and image extensions. Missing, foreign, invalid, swapped, and inaccessible files use the generic not-found contract.

## Briefing reads

Briefing list and detail responses contain definitions and safe selected Workspace/Scope display metadata. Version lists contain lifecycle and allowlisted output metadata. One Version detail also contains an unchanged clone of its frozen snapshot and facts only after a recursive stable-ID isolation check rejects references to another Organization or an unselected Workspace. Export, backup, and AI context reuse that same ownership-aware Version projection. Raw generated output bodies are not returned in Phase 2. No Draft, Finalize, Communicate, baseline, or output-generation command exists.

## Export and ordinary backup

Export and ordinary backup reuse one Organization-scoped projection. The projection contains:

- schema version and operation kind;
- the requested Organization only;
- owned Workspaces, Scopes, Jira Epic Mappings, Work Items, Milestones, allowlisted Sources, Findings, Evidence, Proposed Changes, Briefings, ownership-checked Briefing Versions, and Audit Events;
- one safely scoped active-Workspace preference.

It omits all other Organizations, global technical settings, foreign preferences, arbitrary Source metadata, raw Source-file bytes, internal Source-file paths, and raw generated Briefing output bodies. Serialized output is limited to 2 MiB. The offline all-data Phase 5 reset safeguard is not a route and is not replaced by this projection.

## AI-context assembly

`services.buildAiContext(organizationId, workspaceId)` is a server-side service, not a client download or external-provider call. It validates both parents, then assembles only the selected Organization and Workspace, local prompt overrides and drafting guidance, local Scopes, Work Items, Milestones, Source content, Evidence, and single-Workspace Briefings/Versions for that exact Workspace. Multi-Workspace Briefing content is conservatively omitted because the Phase 1 opaque snapshot shape cannot be safely partitioned; typed multi-Workspace AI assembly belongs to a later Briefing workflow phase. It never includes `globalTechnicalSettings` or records from another Workspace or Organization. The assembled JSON payload is limited to 512 KiB.

## Client context state

`public/target-context-state.js` is an isolated pure API client and state controller for Phase 2 tests and later target-client integration. It does not replace the legacy production UI. The API client constructs only stable parent-scoped Workspace, context, Portfolio, and Today URLs.

Beginning an Organization switch synchronously clears the active Workspace, cached Workspace records, Portfolio, Today, pending selections, search results, counts, Sources, Evidence, Briefings, and rendered output before any request starts. The controller loads Workspaces from the selected Organization endpoint and sends a saved Workspace ID through the server context resolver before use. Every later operational request captures an opaque token containing the current generation and validated Organization/Workspace IDs; response application requires that exact still-current token. Failed or superseded loads and late search, Source, Evidence, Briefing, or rendered-output responses remain empty and cannot restore stale foreign data. Display names are never used for selection identity.

# Source Snapshot Change Review

## Status and boundary

Source Snapshot Change Review is a repository-only schema-v6 read projection. It compares two Sources that a user explicitly selects in one Organization and Workspace. It does not add a persisted baseline, lineage, or additional fields.

The comparison is informational only. Its result is labeled **Source comparison — not accepted Evidence or current state**. Running or clearing a comparison does not create, update, or delete Sources, Findings, Evidence, Work Items, current-state fields, or any other target record.

## Eligible Sources

Both selected Sources must:

- be distinct stable Source IDs;
- resolve under the exact selected Organization and Workspace;
- have `sourceKind: normalized-feed`;
- retain a supported capture format (`target-json`, `target-csv`, or `structured-text`); and
- parse under the existing bounded import parser.

The UI shows only normalized-feed Sources as candidates, but the server independently enforces all eligibility requirements. Source content remains server-side; the comparison response returns safe Source metadata and bounded record differences, not raw Source content, provenance details, or private capture metadata.

The user assigns the baseline and current roles. Priorena does not infer chronology, automatically select a baseline, persist either role, or treat the later-dated Source as authoritative.

## Deterministic identity and readiness

Rows are joined only by exact, case-sensitive `externalKey`. Every row in both Sources must have exactly one key, and a key may occur only once per Source.

The comparison stops without partial results when either Source is unsupported, malformed, missing a row key, or contains a duplicate row key. A blocked response contains only bounded readiness reasons, zero counts, and no change rows. Missing or wrong-parent Source IDs use the standard non-disclosing `NOT_FOUND` response.

When ready, the result sorts keys deterministically and assigns exactly one state per key:

- **Added:** key exists only in the current Source.
- **Removed:** key exists only in the baseline Source.
- **Changed:** key exists in both Sources and one or more allowlisted fields differ.
- **Unchanged:** key exists in both Sources and every allowlisted field is equal.

## Allowlisted field differences

Only these normalized import fields participate in change detection:

- `itemType`
- `externalItemType`
- `summary`
- `description`
- `jiraProjectKey`
- `jiraEpicKey`
- `noEpic`
- `requestedInitiativeId`
- `initiativeName`
- `canonicalStatus`
- `evidenceExcerpt`
- `category`

Each displayed string value is capped at 300 characters and includes a transparent truncation flag and original character count. The complete JSON projection is capped at 1 MiB. Existing import limits also cap a Source at 512 KiB and 100 records.

## API

`GET /api/v2/organizations/:organizationId/workspaces/:workspaceId/sources/change-review?baselineSourceId=:baselineSourceId&currentSourceId=:currentSourceId`

The route is registered before generic Source-by-ID routes. It uses the exact-parent resolvers and returns the current target revision in `X-Priorena-Target-Revision`. The browser validates that revision, parent context, Source IDs, trust boundary, readiness, counts, row identities, statuses, and field-difference shapes before rendering the result.

## Deliberate exclusions

This slice does not provide durable snapshot lineage, a saved baseline, automatic monitoring, notifications, source ingestion, change acceptance, Jira synchronization, AI interpretation, or runtime/release behavior. Durable lineage and automatic baseline policy remain a later product and schema decision.

Tests use fictional normalized-feed fixtures and cover deterministic classification, bounded values, safe-stop ambiguity, exact-parent disclosure behavior, revision validation, client URL construction, static safe rendering, and persistence fingerprints proving the read path performs no write.

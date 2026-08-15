# External Feed Import review workflow

## Boundary

External Feed Import is a single-user, local-only workflow inside the selected
Organization and Workspace. The browser reads a selected `.json` or `.csv`
file as text, or accepts an explicitly formatted paste, and sends that text
only to the Priorena server on `127.0.0.1`.

Screenshots are never uploaded to Priorena. A user may copy or download a
locally generated extraction prompt, use it with screenshots in a separate
ChatGPT conversation, download the resulting raw feed, and then bring that
feed back to Priorena. There is no ChatGPT, OpenAI, Jira, telemetry, analytics,
remote-storage, hosting, LAN, or communication client in this workflow.

The persisted model remains strict `schemaVersion: 5`. The generic seed and
root collections do not change. Review decisions are request data only and are
never added to a Source, Work Item, or another persisted record.

## Feed contract

JSON accepts only the strict `target-v4` object:

```json
{
  "version": "target-v4",
  "records": []
}
```

The supported input formats are `target-json`, `target-csv`, and
`structured-text`. JSON records and CSV headers use this exact allowlist:

- `externalKey`
- `itemType`
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

Unknown fields and headers fail closed. Retired versions and compatibility
readers are not accepted. Content is limited to 512 KiB, each feed to 100
records, and bounded cell text to 4,000 characters.

## Capability projection

`GET /api/v2/organizations/:organizationId/workspaces/:workspaceId/imports/capabilities`
returns the current strict contract, limits, canonical Work Item types, active
Initiatives, Workstreams, and existing local Jira Epic mappings for the exact
validated parent context. It is read-only and does not expose Source content,
paths, foreign records, credentials, or runtime state.

## Prepare and validate

Capture → Import Feed provides two explicit inputs:

- Upload a `.json` or `.csv` text file with native browser file reading.
- Paste content after choosing JSON, CSV, or Structured text.

The user reviews the Source title, Source date, and preparation provenance.
The browser rejects empty, unsupported, or oversized files before a loopback
request. It does not interpret content as HTML.

The first `imports/preview` request validates and normalizes the strict feed,
resolves only exact parent-scoped identities, constructs record-oriented
review rows, and returns the current persisted revision. It performs zero
writes. The page states that validation and preview have not changed Priorena
data. Rejected feeds return only bounded reason metadata; the page maps it to
plain-English record- or field-level correction guidance without returning
raw content or private paths.

## Exact matching and duplicate review

An existing Work Item matches only when `externalKey` exactly equals an
accepted local Jira key or Jira ID. Summary, description, order, proximity,
token overlap, mutable names, and neighboring rows are never matching inputs.
A row with no external key is always a new-item candidate.

The preview reports duplicate external keys inside the feed and multiple exact
local matches. Conflicting feed rows cannot be included together, but the user
may exclude all but one safe row. A multiple-local-match row remains blocked.
No row is silently removed or deduplicated.

External hierarchy types that are not canonical Work Item types remain
review-only. They may be retained inside an explicitly selected Source but
cannot create a Work Item or Workstream.

## Human review decisions

Every feed record has one strict, bounded review decision. New Work Item
creation starts unselected. Creation requires an explicitly selected canonical
Work Item type plus a reviewed summary and description. Feed type and summary
values remain suggestions until the human action supplies the approved values.
Imports never create an Initiative, Workstream, or Jira Epic mapping.

Relationship decisions are independent:

- Initiative is either Unassigned or one active Initiative in the Workspace.
- Workstream is empty or one Workstream under the selected Initiative.
- Jira Epic is empty or one existing local mapping under the selected
  Initiative.

Feed Initiative wording and exact Jira Epic values are displayed as source
suggestions and are never silently applied. Changing Initiative clears an
incompatible Workstream or Jira Epic choice. Foreign, unknown, archived, or
wrong-parent choices fail without disclosing the other context.

Eligible records support reversible bulk actions for new-item selection,
creation type, Initiative, Workstream, Jira Epic, pending Findings, exclusion,
and clearing. Duplicate-review and blocked rows are not silently selected.
The feed remains bounded to 100 decisions.

## Source, Finding, and current-state boundaries

Source creation is explicit. A valid review may apply Source plus selected Work
Item actions, Source plus pending Findings, or Source only. Initial validation
never creates a Source. After apply, the normalized feed text is retained in
the local Source record; original screenshots are not stored.

An explicitly included `evidenceExcerpt` creates one pending Finding. It does
not create accepted Evidence. A status difference is returned as a deferred
current-state proposal and is not applied by Import Feed. Accepted Evidence
and a separate Proposed Change review remain prerequisites for a later current
state change.

When an explicit Initiative reassignment would also reassociate existing
accepted Evidence for that Work Item, the final proposal, hash, visible review,
and confirmation list every affected Evidence stable ID and its exact before
and after Initiative. Apply verifies that the atomic Evidence changes match
that disclosure.

## Final preview and atomic apply

The final preview rebuilds proposals from:

- exact Organization and Workspace;
- original format and content;
- Source metadata;
- normalized records;
- every record and association decision;
- exact current local values;
- selected proposal IDs;
- current persisted revision.

The resulting hash binds the full consequential state. Apply requires that
revision, the original input, exact decisions, the final preview hash, and the
complete approvable proposal-ID set. The server rebuilds the preview, rejects a
stale or mismatched request, validates dependencies and parents, and performs
one atomic schema-v5 replacement. A validation or persistence failure writes
nothing. While apply is in progress, the action is disabled and re-entry is
ignored. Any failed validation, final preview, or apply removes stale review
controls before presenting the next corrective action.

The outcome groups Sources, new Work Items, relationship changes, pending
Findings, deferred state changes, excluded rows, and blocked rows. The same
preview cannot be applied twice. The user may then open Work Items, Review, or
Source Library; no automatic navigation, Jira write, or communication occurs.

## Local GPT prompt and template

The shared prompt builder is deterministic and browser-safe. It instructs the
separate ChatGPT conversation to use only clearly visible facts, omit
unreadable values, preserve exact Jira values and excerpts, distinguish current
from historical information, avoid proximity-based association, never invent
Priorena IDs, emit only raw `target-v4` JSON, and split outputs into numbered
files of at most 100 records. It cannot inspect Priorena or apply changes.

The downloadable JSON template is exact, valid JSON with an empty `records`
array. A separate visible example contains fictional English data; the
template itself contains no invalid comments.

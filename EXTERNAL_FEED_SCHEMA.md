# External ChatGPT Feed Contract

**Current schema version:** `pm-external-feed/v3` (`v1` and `v2` remain accepted)
**Security status:** untrusted external transcription; strict local validation and explicit review required

The `pm-external-feed` schema, filename, and prompt-version names are stable compatibility identifiers retained by Priorena after its product rebrand.

Priorena performs no OCR and never receives or stores screenshots. Screenshots remain in a separate user-controlled ChatGPT conversation. The app accepts only one bounded `.json` or `.md` feed, persists only normalized validated data, and labels it as externally transcribed with original screenshots not retained.

## JSON shape

```json
{
  "schemaVersion": "pm-external-feed/v3",
  "generatedAt": "2026-07-16T12:00:00.000Z",
  "source": {
    "title": "Sprint story review",
    "sourceType": "Story Snapshot",
    "visibleDate": "2026-07-16",
    "transcriptionProvider": "ChatGPT",
    "promptVersion": "pm-external-feed-v3.0",
    "sourceDescription": "Externally transcribed from screenshots; originals not retained"
  },
  "warnings": [],
  "workItems": [
    {
      "jiraId": "PM-123",
      "fields": {
        "itemType": "Epic",
        "status": "In progress"
      },
      "fieldEvidence": {
        "itemType": ["evidence-1"],
        "status": ["evidence-1"]
      },
      "epicAssociation": {
        "jiraEpicKey": "PM-100",
        "jiraEpicName": "Exact visible Epic name",
        "evidenceIds": ["evidence-1"]
      }
    }
  ],
  "evidence": [
    {
      "id": "evidence-1",
      "jiraId": "PM-123",
      "category": "progress_update",
      "sourceRef": "image 1",
      "speaker": "",
      "visibleTimestamp": "",
      "exactExcerpt": "PM-123 · Type: Epic · In Progress · Epic Link: PM-100 Exact visible Epic name",
      "reviewNote": ""
    }
  ],
  "unlinkedEvidence": []
}
```

## File rules

- A JSON file contains exactly one JSON object.
- A Markdown file contains exactly one fenced `json` block. Surrounding prose is ignored.
- Only `.json` and `.md` are accepted, up to 1 MB.
- The original feed file is not persisted.
- The normalized validated feed is hashed canonically for duplicate and provenance checks.

## Source types

- `Story Snapshot`
- `Developer Conversation`
- `Sprint Planning`
- `Backlog Refinement`
- `DSU`
- `Other External Evidence`

## Proposed fields

- `summary`, `description`, `status`, `assignee`, `sprint`, `labels`
- `itemType`: `Story`, `Epic`, `Feature`, `Task`, `Bug`, `Other`, or `Unknown`
- `dependencies`, `environment`, `acceptanceCriteria`
- `lastComment`, `lastCommentedAt`

## Invariants

- Partial feeds are valid. Uncertain, unsupported, truncated, or unreadable fields are omitted with warnings while remaining readable information is retained.
- A feed may contain linked or unlinked evidence without proposed fields. In v3, a `workItems[]` entry may contain fields, an explicit `epicAssociation`, or both.
- Every `unlinkedEvidence[]` record has a unique `id`, an empty `jiraId`, a supported category, an exact excerpt, and an empty `visibleTimestamp` unless a complete non-future ISO timestamp is visibly available.
- The generator should decline the entire batch only when no valid readable fact or evidence record can be represented.
- Every proposed field has one or more `fieldEvidence` references.
- Each reference resolves to evidence carrying the same exact Jira key and a readable verbatim excerpt.
- `[UNREADABLE]` evidence cannot support a proposed field.
- Similar titles are never matched.
- A latest comment requires a valid, complete, non-future `lastCommentedAt`.
- Unknown fields, reserved keys, unsupported statuses, and future timestamps are rejected.
- Preview writes nothing; saving creates only pending normalized metadata and findings.
- All fields default to Keep current. Applying requires an explicit replacement and an unchanged expected current value.
- Creating a work item requires separate creation approval, an approved Summary, and a reviewer-selected canonical creation type. The creation type defaults to Story in the review UI and is recorded as a human decision; it does not require feed evidence. This also permits a valid v1 feed to create an item after human type selection.
- itemType is proposed only when the exact type is visibly associated with the same Jira key. Titles, icons, hierarchy, proximity, and screen placement are not type evidence.
- A missing itemType proposal never blocks partial-feed generation or new-item review. For a new item, any proposed type is displayed as a suggestion beside the independent creation-type selector. For an existing item, it remains a normal evidence-backed replacement proposal.
- Applying fields does not accept evidence; evidence review remains separate.
- A Priorena Project is a Jira Epic delivery scope inside a PM workspace. `epicAssociation` is permitted only in v3 and must identify an exact visible Epic key and/or exact visible Epic name.
- Every association evidence ID resolves to readable evidence carrying the same work-item Jira key and visibly supporting the relationship. Proximity, a similar title, a browser tab, a nearby row, or meeting context is insufficient.
- Preview resolves only an exact active local Project match. Ambiguous or unresolved associations are blocked. Assignment has its own unchecked human decision and stale-value check; it is not part of Replace All.

## Prompt provenance

`pm-external-feed-v3.0` retains region-by-region partial-file generation, optional evidence-backed itemType, and the downloadable raw-JSON requirement. It adds optional evidence-backed Jira Epic association. Missing type or Epic evidence never blocks a partial feed; Priorena collects creation type separately and never infers an Epic association.

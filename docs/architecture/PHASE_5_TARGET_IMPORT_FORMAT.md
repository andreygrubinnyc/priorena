# Phase 5 target import format

The first target release accepts only the current target import formats inside one explicitly selected PM Workspace:

- `target-json`
- `target-csv`
- `structured-text`

Older compatibility formats are not accepted. No active producer was identified that requires them.

## Target JSON

Target JSON uses one bounded object:

```json
{
  "version": "target-v3",
  "records": [
    {
      "externalKey": "FICTA-101",
      "itemType": "Story",
      "summary": "Fictional delivery item",
      "jiraProjectKey": "FICTA",
      "jiraEpicKey": "FICTA-100",
      "evidenceExcerpt": "Fictional exact excerpt.",
      "category": "status"
    }
  ]
}
```

Input is limited to 512 KiB and 100 records. Unknown fields, unsupported versions, invalid stable IDs, non-canonical Jira keys, oversized cells, and inconsistent Jira/no-Epic combinations fail closed.

Import is proposal-only. Source creation, Scope creation, Jira mapping, Work Item creation, assignment, Finding creation, Evidence acceptance, and current-state change remain separate decisions. A preview writes nothing; apply rebuilds the preview and requires explicitly selected proposal IDs and the current persisted revision/hash.

`noEpic: true` leaves a Work Item Unassigned unless another explicit stable Scope decision is approved. Names, titles, proximity, and instruction-like content never identify an existing Scope. Priorena performs no OCR, receives no original screenshots, makes no network request, and performs no automatic external action.

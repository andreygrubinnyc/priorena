# External Feed Import and Review UI source release

**Status:** source change awaiting review and merge authorization

**Persistence:** unchanged strict `schemaVersion: 5`

**Feed contract:** strict `target-v4`; no compatibility readers

**Application boundary:** single-user, local-only, `127.0.0.1`

## Release scope

This source release adds Capture → Import Feed as a dedicated workflow for
local JSON/CSV upload and explicit JSON, CSV, or Structured text paste. It adds
a parent-scoped capability projection, strict request-only review decisions,
record-oriented write-free preview, duplicate review, human-controlled Work
Item creation, independent Initiative/Workstream/Jira Epic selection, bounded
bulk review, final hash-bound confirmation, atomic apply, and grouped outcome
navigation.

The release also adds a deterministic local GPT screenshot-extraction prompt
with copy/download controls and an exact empty `target-v4` JSON template. The
application neither uploads screenshots nor contacts ChatGPT. No OpenAI,
ChatGPT, Jira, telemetry, analytics, remote-storage, hosting, LAN, tunnel, or
communication integration was added.

## User workflow

1. Open Capture → Import Feed.
2. Copy or download the GPT extraction prompt.
3. In a separate ChatGPT conversation, upload screenshots and use the prompt.
4. Download the raw `target-v4` JSON feed.
5. Return to Priorena and upload the feed, or use an explicit paste format.
6. Review Source metadata, then validate and preview.
7. Review every duplicate, new-item decision, and Initiative, Workstream, and
   Jira Epic relationship.
8. Run the final write-free server preview.
9. Confirm and apply only the exact selected local actions.
10. Review pending Findings separately before accepting Evidence or proposing
    any current-state change.

## Trust and persistence results

- Validation and both preview stages write nothing.
- Exact Jira identity is the only existing-Work-Item match; titles and
  proximity are never matches.
- Same-feed duplicate keys cannot be applied simultaneously. Multiple local
  exact matches remain blocked.
- New Work Item creation starts unselected and uses the human-approved type,
  summary, and description.
- Initiative, Workstream, and Jira Epic choices are explicit stable-ID
  decisions limited to the current Workspace and valid parent relationships.
- The workflow never creates an Initiative, Workstream, or Jira Epic mapping.
- Source-only, Source-plus-Finding, and Source-plus-Work-Item outcomes remain
  explicit.
- Imported Findings remain pending and never become Evidence automatically.
- Feed status differences remain deferred for the separate Evidence and
  Proposed Change workflow.
- Final apply rebuilds the complete preview, checks its revision and hash,
  requires the exact approved proposal set, and writes atomically.
- Any Evidence Initiative reassociations are listed by stable ID with exact
  before/after Initiative values in the preview and confirmation.
- Validation failures provide bounded record- or field-level correction text;
  failed or in-progress applies cannot leave an enabled stale Apply control.
- Apply never writes to Jira, sends a message, communicates a Briefing, or
  performs another external action.

## Locked compatibility and limits

The persisted schema remains version 5 and generic seed bytes are unchanged.
The JSON contract accepts only `target-v4`; CSV headers and JSON fields remain
strictly allowlisted. Input remains limited to 512 KiB, 100 records, and 4,000
characters per bounded cell. Images, PDFs, Office files, archives, executables,
and other binary formats are not accepted by Import Feed.

## Validation coverage

Executable coverage includes the strict JSON/CSV/Structured text contract and
limits, malformed and retired input rejection, capabilities, parent isolation,
write-free validation, exact and non-fuzzy matching, duplicate conflicts,
strict review decisions, human creation values, relationship parents, preview
hash invalidation, stale revisions, exact proposal approval, atomic failure,
pending Finding and deferred-state boundaries, prompt rules, template bytes,
native local file controls, bulk review controls, custom confirmation, and
absence of external clients.

Source merge authorization remains separate from any later source-only live
release or process-restart authorization. This document authorizes no live
runtime mutation, source deployment, process restart, merge, hosting, LAN
access, tunnel, Jira write, or communication.

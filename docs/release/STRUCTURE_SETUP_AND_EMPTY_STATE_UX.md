# Structure setup and empty-state UX source release

**Status:** source change awaiting review and merge authorization

**Persistence:** unchanged strict `schemaVersion: 5`

**Application boundary:** single-user, local-only, `127.0.0.1`

## Release scope

This source release exposes the existing Initiative create, archive, restore,
and stable-ID rename behavior in Settings. It also groups Settings by purpose,
separates Work Item filters from bulk assignment, disables bulk controls until
Work Items are selected, distinguishes a genuinely empty Workspace from an
empty filtered result, and simplifies ordinary interface copy.

Archive remains reversible and does not delete related records. Initiative,
Workstream, and Jira Epic relationships keep their existing schema-v5 model and
revision-aware service behavior. The import parser, preview/apply APIs, strict
`target-v4` import contract, and explicit human-approval boundary are unchanged.

This document authorizes no live runtime change, process restart, hosted or LAN
operation, Jira write, communication, analytics, or telemetry. Source merge and
any later source-only live release remain separate authorization gates.

## Accepted follow-up

### External Feed Import and Review UI

The current backend already supports strict import parsing plus separate
preview and explicit apply. A browser workflow for uploading, previewing record
changes, and reviewing a feed is not implemented by this release.

Planned capabilities:

- JSON and CSV upload;
- paste option;
- validation before persistence;
- preview before persistence;
- duplicate review;
- Initiative mapping;
- Workstream mapping;
- Jira Epic mapping review;
- per-record and bulk approval;
- explicit apply;
- no automatic Jira write or communication.

The future workflow will keep human approval before apply. This release adds no
Import Feed navigation, placeholder, dead link, or unfinished control.

## Later follow-up status

The separately scoped External Feed Import and Review UI follow-up is now
implemented in source and documented in
`docs/release/EXTERNAL_FEED_IMPORT_REVIEW_UI.md`. This factual pointer does not
change the historical scope, authorization, or live-runtime state of the
Structure setup and empty-state UX release recorded above.

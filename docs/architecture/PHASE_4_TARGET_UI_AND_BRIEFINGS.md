# Phase 4 target UI and canonical Briefings

**Status:** Isolated target implementation

**Target entry:** `/target/`

**Target API:** `/api/v2`

**Store:** Explicit version-2 target file only

**Production cutover:** Not part of Phase 4

## Isolation and startup

Phase 4 adds an isolated, framework-free target shell to `createTargetApiApp({ targetDataFile, sourceFilesRoot })`. The legacy `server.js` and legacy `public/index.html` do not import, mount, redirect to, or select it. `target-server/dev.js` requires explicit `--data-file` and `--source-files-root` arguments and binds only to `127.0.0.1`. It has no live-runtime or environment-selected data-file fallback.

The target application serves only these allowlisted assets:

- `/target/` from `public/target/`;
- `/target-modules/target-context-state.js`;
- `/target-modules/target-workflow-state.js`;
- `/target-modules/target-briefing-state.js`.

The target content-security policy defaults to no content, allows same-origin scripts, styles, and API connections, and continues to deny framing, objects, forms, and base-URI changes. No target asset loads a CDN, analytics service, external provider, or third-party font.

The explicit `Initialize target` action is the first operational action. No Organization, Workspace, Source, Briefing, or other target request occurs before it.

## Visible hierarchy and terminology

The shell uses this hierarchy consistently:

```text
Organization
└── PM Workspace
    └── Scope or Unassigned
        └── Work Item
```

Stable opaque IDs drive selection and routes. Names are presentation values, so duplicate Organization, PM Workspace, and Scope names do not alter identity.

`Portfolio` is Organization-scoped. `Today` and the ordinary delivery pages are PM Workspace-scoped. Work displays `All scopes`, individual Scopes, and `Unassigned`; Milestones display `Entire workspace` or their selected Scope. Review presents Findings separately from Proposed changes. Normal target navigation contains only canonical `Briefings`; legacy communication entry points remain outside the isolated target UI.

Navigation is:

- Portfolio;
- Today;
- Work: Work Items, Follow-Up, Milestones;
- Capture: Add Source, Source Library, Review;
- Search;
- Briefings;
- Settings.

## Context clearing and late responses

Organization changes synchronously clear the active context, Workflow data, Scope filter, Work Item selection, Briefing definitions, candidates, active Version, and output state before loading the new Organization. PM Workspace changes synchronously clear all Workspace-owned state and the full rendered Briefing/output state before validation.

The accepted context controller revalidates saved stable IDs through the server. Each load captures a monotonically increasing generation. Results apply only if that generation and the validated parent IDs remain current; late results cannot repopulate an earlier Organization or Workspace. Loading failures leave an empty safe state.

## Operational-page composition

The target shell composes the accepted Phase 2 and Phase 3 APIs rather than copying data into a new client store:

- Portfolio uses the Organization projection;
- Today uses the selected Workspace projection;
- Work Items provides Scope/Unassigned filtering and revision-aware bulk Scope preview/apply;
- Follow-Up and Milestones use current Workspace records and visible applicability;
- Add Source captures bounded local text for separate Finding review;
- Source Library displays safe Source metadata, not hidden paths;
- Review separates pending Findings from Proposed changes;
- Search is bounded to the selected Workspace;
- Settings explains supported target settings, local storage/privacy, and the disabled optional-AI boundary.

Phase 3 remains authoritative for mutation reconstruction, revision conflicts, previews, and Audit Events. The UI uses an accessible in-application dialog for consequential confirmation and never calls native `alert`, `confirm`, or `prompt`.

## Canonical Briefing model

`Briefing` and `Briefing Version` are the only target communication model:

```text
Briefing definition (Organization-owned)
└── Briefing Version
    Draft → Finalized → Communicated
```

A definition contains stable selected Workspace and Scope IDs, audience profile, Briefing type, sections, output formats, and bounded drafting guidance. It must select at least one Workspace from its Organization. Every selected Scope must belong to one selected Workspace. An empty Scope selection for a Workspace is displayed as `Entire workspace`. Create and update require the current persisted revision and append Organization-scoped Audit Events. Deletion or archival is absent because the accepted schema does not safely expose that mutation.

## Candidate facts and grounding

Candidate preparation is read-only, deterministic, sorted by stable candidate ID, limited to 500 facts, and bounds text to 2,000 characters with transparent truncation metadata. Candidates come only from the definition's validated parent set:

- direct current Work Item state with its current-state provenance;
- Workspace- or selected-Scope Milestones;
- open or waiting Follow-Up state;
- accepted Evidence whose Finding is still accepted.

Pending and rejected Findings are excluded. Historical Evidence remains labeled `accepted-evidence` and does not replace or assert current Work Item state. Direct current state remains separately labeled `direct-work-item-state`. Every candidate includes its Organization, Workspace, Scope, record ID, section, currentness, and provenance.

Manual material is stored in the Draft snapshot as bounded entries and rendered as facts labeled exactly `Manual PM input`. It has `manual-pm-input` provenance and never receives an Evidence ID or Evidence label. Prompt-like, HTML-like, Source, Evidence, and Manual text remain inert data.

## Baseline and Draft refresh

Only `Briefing.lastCommunicatedVersionId` is a comparison baseline. A new Draft freezes that communicated Version ID, or `null` when none exists. Finalized-but-not-Communicated Versions do not advance or replace the baseline.

A Draft freezes its definition, parent selection, candidate list, candidate-state hash, explicit selected fact IDs, Manual PM input, comparison, and preparation time. Draft editing can change only explicit selected candidates and Manual PM input. The server reconstructs candidates before saving and rejects stale candidate state.

Refresh is explicit. It rebuilds candidates from current target state using the Draft's frozen definition and comparison baseline. It:

- preserves selected candidate IDs that still exist;
- reports and removes selected candidate IDs that disappeared;
- reports new candidates without selecting them automatically;
- preserves Manual PM input and its order;
- keeps the original comparison baseline;
- writes no Work Item or other current state.

## Finalize contract

Finalize is a two-step consequential command. Preview rereads the target store, reconstructs current candidate state, and returns the exact Briefing, Organization-owned selections, audience, sections, selected facts, Manual PM input, snapshot basis, output formats, expected revision, and Draft-state hash without writing.

After accessible in-application confirmation, the apply request supplies the previewed expected revision and Draft-state hash. The server rereads and reconstructs the command again. Stale revisions, candidate state, or altered hashes fail closed. A successful Finalize freezes facts, parent selection, snapshot, Manual PM input, canonical content/output basis, actor, timestamp, revision, and hashes; appends an Audit Event; and returns the frozen Version and new revision.

Finalized content is immutable. Finalized remains in Open, does not communicate, and does not advance the comparison baseline.

## Deterministic outputs

One canonical content model contains the exact definition snapshot, audience, Workspace/Scope labels, sections, comparison, fact list, fact IDs, Manual PM input IDs, and content hash. Teams-style, Email-style, and Confluence-style plain text are structural renderings of that one model. Each output carries the same content hash, fact IDs, and Manual input IDs. Each output is limited to 128 KiB.

Draft preview revalidates current candidate state and writes nothing. Finalize stores immutable output records. Frozen-output reads return one explicitly selected format. The UI places output in a text-only `<pre>` and copies it only after the user presses `Copy output`; copying does not change Version state or baseline.

## Mark as communicated

Priorena does not send messages in Phase 4. A user first copies or uses a Finalized output externally and may then choose `Mark as communicated`.

Communication preview requires a Finalized Version and one stored output format. It writes nothing and returns the exact Version, selected output metadata, expected revision, frozen-Version content hash, current baseline ID, and the statement that Priorena is recording an external action rather than sending output.

After accessible confirmation, the mutation requires:

- the exact Organization, Briefing, and Version route IDs;
- expected persisted revision;
- actor;
- output format and channel;
- bounded external reference note;
- ISO timestamp not earlier than Finalize;
- unchanged frozen-Version content hash.

One atomic write changes the Version to Communicated, records communication metadata, advances the parent Briefing baseline, and appends exactly one communication Audit Event. It returns `sent: false`. A stale, altered, cancelled, or invalid attempt leaves the Version Finalized in Open, leaves the baseline unchanged, and appends no false event.

## Open and History

The UI groups the lifecycle as follows:

| Placement | Contents | Mutability |
|---|---|---|
| Prepare | Organization-owned definitions and Create Draft | Definitions revision-aware; creation explicit |
| Open | Draft and Finalized-not-Communicated Versions | Draft editable; Finalized immutable |
| History | Communicated Versions only | Immutable |

History includes frozen outputs and communication metadata. New Draft comparisons reference the last Communicated Version. Finalized Versions never appear in History, and Communicated Versions never appear in Open.

## Briefing routes

Every route has the prefix `/api/v2/organizations/:organizationId/briefings`. All responses include `X-Priorena-Target-Revision`. Unknown and wrong-parent resources share the bounded `404 NOT_FOUND` response. Unsupported methods return `405 METHOD_NOT_ALLOWED`.

| Method and suffix | Requirements and response |
|---|---|
| `GET /` | Lists safe definitions for one validated Organization. No global list exists. |
| `POST /` | `expectedRevision`, actor, and definition. Creates after same-Organization parent validation; returns definition. |
| `GET /:briefingId` | Returns one definition after Organization ownership validation. |
| `PATCH /:briefingId` | `expectedRevision`, actor, and allowed definition changes. Identity/parents remain server-owned; returns definition. |
| `POST /:briefingId/candidates/prepare` | Empty body. Returns frozen-definition basis, bounded candidates, comparison, candidate hash, and expected revision; writes nothing. |
| `GET /:briefingId/versions` | Lists all Versions for one Briefing. |
| `POST /:briefingId/versions` | `expectedRevision`, actor, up to 500 selected candidate IDs, and up to 50 Manual inputs; creates Draft. |
| `GET /:briefingId/versions/open` | Lists Draft and Finalized Versions. |
| `GET /:briefingId/versions/history` | Lists Communicated Versions. |
| `GET /:briefingId/versions/:versionId` | Returns ownership-checked Version metadata and frozen content. |
| `PATCH /:briefingId/versions/:versionId` | Draft only; `expectedRevision`, actor, selected IDs, and Manual inputs; reconstructs candidate state. |
| `POST /:briefingId/versions/:versionId/refresh` | Draft only; `expectedRevision` and actor; returns reconciled Draft. |
| `POST /:briefingId/versions/:versionId/outputs/preview` | Draft only, empty body, no write; returns canonical content and every deterministic output. |
| `GET /:briefingId/versions/:versionId/outputs/:format` | Finalized or Communicated only; returns one immutable `teams`, `email`, or `confluence` plain-text output. |
| `POST /:briefingId/versions/:versionId/finalize/preview` | Draft only, empty body, no write; returns exact finalization basis, revision, and hashes. |
| `POST /:briefingId/versions/:versionId/finalize` | Draft only; expected revision, actor, and exact Draft-state hash; returns frozen Finalized Version. |
| `POST /:briefingId/versions/:versionId/communicate/preview` | Finalized only; selected output format; no write; returns exact communication basis. |
| `POST /:briefingId/versions/:versionId/communicate` | Finalized only; expected revision, actor, channel, output format, note, chronological timestamp, and frozen content hash; returns Communicated Version and `sent: false`. |

Definition names are at most 300 characters; audience is 500; drafting guidance and each Manual input are 4,000; communication references are 2,000. Root schema and 2 MiB HTTP limits remain authoritative. Every body rejects unexpected keys, duplicates, malformed IDs, invalid enumerations, and control-character-bearing actor values.

## Optional AI boundary

No accepted target-safe optional-AI execution seam exists for this Phase 4 surface. The UI therefore exposes AI as disabled advanced functionality. Deterministic Briefings are complete without AI. No provider, dependency, model call, network call, AI-generated fact, or external transmission was added. Optional bounded Draft wording assistance remains future work and could never finalize, communicate, mutate current state, or advance a baseline.

## Responsive design and accessibility

The target shell uses semantic navigation, main, section, heading, list, form, label, fieldset, table-like metadata, status, and dialog structures. Visible focus styles, a skip link, status live region, readable text output, bounded scroll areas, wrapping, and reduced-motion behavior are provided. The two-column shell contracts on tablet and becomes a stacked navigation on narrow screens. Dialog height is viewport-bounded, returns focus on close, and keeps actions usable on mobile.

All mutations are ordinary buttons/forms and remain keyboard-operable. Lifecycle badges always accompany placement text; color is not the only status signal.

## XSS and content safety

The target client constructs DOM nodes and assigns untrusted values through `textContent` or text nodes. It does not use `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, executable URLs, or inline event-handler strings. Confluence-style markup and malicious HTML-like fixtures display as literal text. Output previews are plain-text `<pre>` elements. Clipboard writes copy the intended text only and do not evaluate it.

Source lists continue to omit Source content and internal paths. Briefing candidates exclude unreviewed Source text. Public errors remain bounded and non-revealing. Frozen Version projection recursively rejects foreign Organization and unselected Workspace references.

## Parity and temporary coexistence

Target Briefings cover Entire-workspace, one-Scope, multi-Scope, same-Organization multi-Workspace, accepted Evidence, direct current state, selected facts, Manual PM input, all three deterministic formats, every lifecycle state, Open/History placement, immutable content, exact communication audit, communicated baseline comparison, failure atomicity, and no sending.

The isolated target navigation therefore exposes only canonical Briefings. Legacy UI, Status Summary, and communication implementation files remain unchanged and temporarily coexist for the still-default legacy runtime. Their removal and production cutover belong to Phase 5.

## Test strategy

Phase 4 tests use the actual Express app, actual services, actual Phase 1 persistence, explicit temporary version-2 files, and pure target client modules. The deterministic fixture remains outside test discovery and contains two Organizations, duplicate display names, multiple Workspaces and Scopes, Unassigned Work Items, Follow-Up, Milestones, pending/rejected/accepted Findings, accepted Evidence, every required Briefing selection shape, Manual PM input, Draft/Finalized/Communicated Versions, baseline data, deterministic output, inert markup/prompt-like text, and foreign sentinels.

Coverage includes:

- shell isolation, explicit loopback launcher, canonical navigation and terminology;
- stable parent-route construction and Briefing lifecycle placement;
- definition ownership, revision conflicts, audits, invalid Scope/Workspace selection, and non-disclosure;
- deterministic bounded candidates and exclusion of pending, rejected, and foreign data;
- Manual input labeling, Draft editing, explicit refresh, stale-state rejection, and comparison baseline;
- preview no-write behavior, Finalize freezing, immutability, Open placement, and unchanged baseline;
- exact common output facts/content hash across formats and safe text presentation;
- communication preview/no-write, chronological/hash/revision failures, atomic baseline/audit success, `sent: false`, and History placement;
- context clearing, safe DOM construction, responsive/focus/dialog assertions, and legacy non-mount;
- full Phase 1–3 and legacy regression, syntax, build, security, dependency audit, whitespace, startup smoke, and live-runtime fingerprint gates.

## Explicit Phase 4 exclusions

Phase 4 does not include:

- production target-store selection, migration, reset, cutover, dual write, or legacy-ID translation;
- deletion or modification of legacy server, UI, Status Summary, or communication behavior solely for cleanup;
- hosting, LAN access, tunnels, reverse proxies, authentication, RBAC, tenancy, or multi-user behavior;
- Jira writes, message sending, background publishing, telemetry, analytics, or automatic external transmission;
- automatic Draft refresh, Finalize, communication, or baseline advancement;
- an AI provider or model call;
- Briefing deletion/archive without accepted schema support;
- Gantt, budget, resource, critical-path, or enterprise PPM behavior;
- Phase 5 work.

## Non-blocking backlog

- A future approved target-safe AI seam may offer bounded, explicitly requested Draft wording assistance.
- Multi-process target-store locking and hosted multi-user controls remain outside the local single-user boundary.
- Broader visual polish and richer DOM/browser automation can be considered without changing the accepted lifecycle.
- Legacy cleanup, migration decisions, and production cutover remain gated Phase 5 work.

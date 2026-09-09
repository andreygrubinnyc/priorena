# Briefing Activation and Presets

**Status:** Current merged source capability; schema-v6 production release pending

**Persisted model:** strict `schemaVersion: 6`; Briefing shape unchanged from schema v5

**API namespace:** existing `/api/v2/organizations/:organizationId/briefings`

**Application boundary:** single-user, local-only, loopback `127.0.0.1`

## Capability boundary

Briefing Activation makes the existing canonical Briefing lifecycle easier to
start and review. It does not add a new Briefing model, route, persistence
field, candidate source, output format, or lifecycle transition.

The capability adds only:

- three deterministic small-product starting presets;
- clearer definition-baseline readiness language;
- grouped candidate review by existing Briefing section;
- explicit section, all-candidate, clear, and baseline-difference selection
  controls;
- separate counts for direct current state and accepted Evidence.

No schema, seed, server route, Source, Evidence, current-state, output,
communication, startup, release, or runtime behavior changes.

## Preset contract

Presets are frozen public client constants. Each preset supplies only fields
already accepted by the schema-v6 Briefing definition:

- name;
- audience profile;
- Briefing type;
- preferred output formats;
- default sections;
- bounded drafting guidance.

The available presets are Weekly delivery update, Executive snapshot, and Team
coordination. Applying one changes only the visible definition form. It does not
select a Workspace or Initiative, create or update a definition, prepare
candidates, create a Draft, or write an Audit Event. The user reviews all
fields and submits the existing revision-aware definition form explicitly.

Presets never include customer names, recipients, private paths, Source text,
provider instructions, or external destinations.

## Candidate review model

The existing server remains authoritative for deterministic, Organization-
scoped candidate preparation and the 500-candidate limit. The client derives a
read-only review model from one already validated frozen Draft snapshot.

Candidates are grouped in the definition's section order. Every row continues
to show its exact title and bounded text, while provenance is translated into
one of these plain-language labels:

- Direct current state;
- Direct Follow-Up state;
- Direct Milestone state;
- Accepted Evidence.

Accepted Evidence never replaces or disguises direct current state. Pending or
rejected Findings and raw Source text remain outside Briefing candidates.

Selection helpers alter only checkboxes in the current form:

- Select all candidates;
- Clear selection;
- Select or clear one section;
- Select added and changed candidates when a communicated baseline exists.

No helper writes until the user presses Save Draft. A new Draft still begins
with zero selected facts. Refresh continues to preserve surviving explicit
selections, remove disappeared selections, disclose new candidates, and avoid
automatic selection.

## Baseline and readiness language

Only `Briefing.lastCommunicatedVersionId` establishes a baseline. Definition
cards say whether that baseline exists. Drafts without a communicated baseline
label candidates Available; they do not describe all facts as changes.

When a baseline exists, each current candidate is labeled Added, Changed, or
Unchanged from the frozen comparison. Removed facts appear only in the bounded
comparison count because they are no longer current candidate rows.

Baseline differences are review cues. They are explicitly not a risk score and
do not change Work Item current state, select facts, finalize a Version,
communicate a Version, or advance the baseline.

Readiness metrics count:

- available candidates;
- direct Work Item current-state candidates;
- accepted Evidence candidates;
- added and changed candidates when a baseline exists.

Counts may describe the same Draft from different dimensions. They do not rank
Workspaces, infer delivery health, or assert that a candidate belongs in the
finished Briefing.

## Lifecycle preservation

The established lifecycle remains unchanged:

```text
Definition submit -> Prepare candidates -> Create Draft with zero selections
-> Explicit selection and Save Draft -> Preview -> Explicit Finalize
-> Copy externally -> Explicit Mark as communicated
```

Finalize and Mark as communicated remain separate revision- and hash-bound
confirmations. Finalized remains Open. Only an explicit successful communication
record moves an immutable Version to History and advances the comparison
baseline. Priorena sends nothing.

## Security and privacy invariants

- Organization and selected Workspace/Initiative ownership remain validated by
  the existing server services.
- Presets contain fixed fictional-neutral product copy only.
- Candidate review uses only the already returned frozen Draft snapshot.
- Dynamic values continue to render through text nodes and safe control values.
- Candidate grouping and selection perform no network request and no write.
- Source content, private paths, arbitrary Source metadata, Proposed Change
  values, provider data, and foreign Organization records do not enter presets
  or the review helper.
- All lifecycle writes continue to require the current persisted revision and
  accepted preview/hash boundaries.

## Required verification

- Preset catalog is frozen, deterministic, schema-v6 compatible, and free of
  private or external-destination data.
- Unknown preset IDs fail closed.
- Candidate grouping follows definition section order and preserves candidate
  order within each section.
- Direct current state and accepted Evidence counts remain separate.
- No-baseline candidates are Available, not Added.
- Communicated-baseline candidates are classified Added, Changed, or Unchanged,
  with removed count disclosed separately.
- Baseline-difference selection includes only current added or changed IDs.
- Invalid candidate snapshots fail closed.
- UI copy states that presets and checkbox helpers do not save automatically.
- New Draft creation still supplies an empty selected-fact list.
- Existing Briefing lifecycle, isolation, immutability, output, communication,
  no-send, and full repository gates remain green.

## Explicit exclusions

This capability does not add automatic fact selection, automatic Draft refresh,
automatic Finalize, automatic communication, message sending, recipient
management, scheduling, AI drafting, provider or Jira calls, new output formats,
new candidate sources, Source parsing, change-detection persistence, schema
migration, seed changes, runtime access, private/live-data access, startup
operations, hosting, release, deployment, or merge behavior.

# Phase 5 legacy-retirement coverage

**Release boundary:** Organization → PM Workspace → Scope → Work Item

**Persistence:** strict `schemaVersion: 2` only
**Data transition:** clean cutover; no legacy record or identifier is migrated

This map is the deletion gate for the superseded application. It records the accepted target replacement for each removed area and preserves the safety intent of deleted tests without retaining obsolete behavior.

## Parity map

| Required area | Target replacement | Automated proof |
|---|---|---|
| Organization and Workspace selection | Stable-ID context resolution with synchronous clearing and late-response rejection | `test/target-server-api.test.js`, `test/target-phase4-shell.test.js` |
| Portfolio and Today | Organization-only Portfolio and Workspace-only Today projections | `test/target-server-api.test.js` |
| Scope and optional Jira mapping | Independent Scope lifecycle and zero-to-many mapping records | `test/target-model-schema.test.js`, `test/target-phase3-workflows.test.js` |
| Work Items and Unassigned | Explicit parents and `scopeId: null` | `test/target-model-schema.test.js`, `test/target-phase3-workflows.test.js`, `test/target-phase3-client.test.js` |
| Bulk preview and apply | Exact bounded previews, revision/hash validation, atomic apply | `test/target-phase3-workflows.test.js`, `test/target-phase3-client.test.js` |
| Follow-Up | Nested state on Work Item with explicit preview/apply | `test/target-model-schema.test.js`, `test/target-phase3-workflows.test.js` |
| Workspace/Scope Milestones | Nullable Scope applicability and canonical linked Work Item IDs | `test/target-model-schema.test.js`, `test/target-phase3-workflows.test.js` |
| Source Library and Capture | Parent-scoped Source capture and safe metadata reads | `test/target-phase3-capture.test.js`, `test/target-server-api.test.js` |
| Finding review | Separate pending/accepted/rejected review with bounded bulk actions | `test/target-phase3-capture.test.js` |
| Accepted Evidence | Exact Source/Finding provenance; no automatic current-state mutation | `test/target-model-schema.test.js`, `test/target-phase3-capture.test.js` |
| Proposed Changes | Separate preview, persistence, approval, and stale-safe apply | `test/target-phase3-capture.test.js` |
| Parent-scoped search | Bounded Workspace search with parent validation | `test/target-server-api.test.js` |
| Source-file access | Real-path containment, extension/size checks, final-symlink and ancestor-swap defenses | `test/target-server-api.test.js` |
| Organization export/backup | One bounded Organization projection with no paths or global settings | `test/target-server-api.test.js` |
| AI-context isolation | Pure, bounded, selected-Workspace context; no provider call | `test/target-server-api.test.js` |
| Canonical Briefing definitions | Organization-owned stable Workspace/Scope selections | `test/target-phase4-briefings.test.js` |
| Draft, Finalized, Communicated | Revision-aware immutable lifecycle and explicit state placement | `test/target-phase4-briefings.test.js`, `test/target-phase4-shell.test.js` |
| Teams-, Email-, Confluence-style outputs | Deterministic renderings of one frozen fact/content model | `test/target-phase4-briefings.test.js` |
| Explicit Mark Communicated | Records an external action, returns `sent: false`, and performs no send | `test/target-phase4-briefings.test.js` |
| Last-communicated baseline | Only successful explicit communication advances the baseline | `test/target-model-persistence.test.js`, `test/target-phase4-briefings.test.js` |
| Settings and Data/Privacy | Target-only settings surface; Workspace drafting settings remain isolated | `test/target-model-schema.test.js`, `test/target-phase4-shell.test.js` |
| Responsive, accessibility, content safety | Semantic shell, focus/mobile/reduced-motion rules, text-only untrusted rendering | `test/target-phase4-shell.test.js` |
| No automatic external action | No Jira write, provider execution, message send, auto-finalize, or auto-communicate path | `test/target-phase3-capture.test.js`, `test/target-phase4-briefings.test.js`, release legacy scan |

## Removed modules and replacement proof

| Superseded area | Why removed or not carried forward | Target replacement and proof |
|---|---|---|
| Root legacy server and mutable-name routes | Selected a name-keyed root model, normalized missing legacy collections, and exposed the old UI | `target-server/app.js`, `target-server/start.js`; server/API, startup, and hardening tests |
| Combined Project/Jira Epic domain | Made an external Epic the delivery-container identity and could synthesize a catch-all | Scope and Jira mapping services; Phase 1 schema plus Phase 3 workflow tests |
| Legacy external feed | Retained older feed compatibility and combined legacy association decisions | Target v3 import parser and separate proposal/apply services; Phase 3 capture tests |
| Legacy bulk Work Item domain | Used legacy relationship fields and root history | Target preview/apply workflows with revision, hash, Audit Event, archive, and recovery rules |
| Legacy Briefing domain/evidence modules | Used mutable Workspace names and parallel communication ownership | Organization-owned Briefing/Version services and Phase 4 lifecycle tests |
| Legacy root UI and helpers | Exposed Project-only selection, broad client aggregation, old communication entry points, and native-dialog code | `public/target/` plus target state modules and Phase 4 shell/client tests |
| Legacy demo fixture/session | Used the superseded root shape | Repository-safe clean seed and fictional multi-Organization target fixtures |

Behaviors intentionally not carried forward include mutable-name identity, combined Project/Epic ownership, catch-all Scope creation, global Workspace aggregation, old communication creation, v1/v2 feed input, legacy normalizers, dual reads/writes, and selective legacy-record restoration.

## Deleted-test accounting

| Deleted test file | Retired tests | Valid safety intent retained | Target replacement |
|---|---:|---|---|
| `test/briefing-domain.test.js` | 10 | Immutable finalized content, deterministic outputs, explicit communication and baseline | Phase 1 persistence and Phase 4 Briefing tests |
| `test/briefing-evidence.test.js` | 2 | Accepted Evidence, bounded deterministic candidates, exact parents | Phase 4 Briefing tests |
| `test/demo-session.test.js` | 4 | Fictional isolation and bounded temporary data | Clean-seed, fixture, and schema resource-bound tests |
| `test/external-feed-v3.test.js` | 1 | Exact matching, unreadable/malicious input rejection, separate approval | Phase 3 capture/import tests |
| `test/security.test.js` | 30 | Loopback, headers, method/body limits, file containment, non-disclosure, no external action | Target server API, Phase 3 capture, Phase 4 shell, and Phase 5 hardening tests |
| `test/work-item-bulk.test.js` | 4 | Preview exactness, stale protection, archive/recovery | Phase 3 workflow/client tests and persistence concurrency tests |
| `test/workspace-domain.test.js` | 3 | Avoid guessing external associations and reject orphan parents | Target schema, resolver, and import tests |

The seven deleted legacy suites contained 54 tests. Their assertions that mandated legacy identity, terminology, routes, compatibility input, or catch-all behavior are intentionally obsolete; all continuing safety intent is mapped above. Phase 5 adds 27 focused hardening and release-tool tests, producing a final suite of 213 tests from the 240-test Phase 4 baseline. No current runtime record or legacy ID is required by any replacement.

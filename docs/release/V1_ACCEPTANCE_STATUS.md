# Priorena v1 acceptance and scope-freeze status

**Status:** Feature-complete source candidate; schema-v6 production release pending

**Feature-freeze base:** `4d9d86c1f1d9a9aef3ef452204ae9ab6a38b1deb`

**Supported boundary:** single-user, local-only, loopback `127.0.0.1`

## Finite finish line

Priorena v1 has no remaining product-feature slice. The source closeout is
complete when this acceptance record, current schema-v6 release tooling, and
active documentation are merged and the exact merged revision passes all
required repository and GitHub checks.

The production release is a separate operational boundary. It is complete only
after the exact schema-v5 runtime is preserved through the controlled one-way
schema-v6 migration, the verified backup and release records exist, the exact
approved runtime is active on loopback, and read-only post-cutover acceptance
passes. Backup retention after acceptance is an operational obligation, not an
additional development phase.

## Source acceptance matrix

| V1 area | Durable implementation evidence | Automated evidence |
| --- | --- | --- |
| Strict persistence, Organization isolation, APIs, core workflows, UI, Briefings, and release hardening | PRs #10–#14 | Schema, persistence, API, workflow, Briefing, shell, hardening, security, and release-tool suites |
| Initiative, Workstream, Jira Epic mapping, structure setup, and empty-state UX | PRs #15–#18 | Workstream hierarchy, independent association, shell, and structure workflow suites |
| External Feed import review and post-import triage | PRs #19–#22 | Import review, client validation, apply, stale-state, and triage suites |
| Contribution gates and macOS startup/reboot resilience | PRs #23–#25 and #27 | Workflow-policy, security-gate, process-safety, startup-controller, and rehearsal suites |
| Evidence-to-current-state review | PR #26 | Evidence acceptance, Proposed Change preview/apply, stale revision, and provenance suites |
| Portfolio attention, Briefing presets, Source change review, and dependency context | PRs #28–#31 | Portfolio, Briefing activation, Source snapshot, and dependency-context suites |
| Schema-v6 Decisions and Risks | PRs #32–#34 | Migration-preservation, lifecycle/API, parent isolation, audit, and browser workflow suites |

The feature-freeze base passed 402 automated tests, the production validation
build, repository and workflow security gates, the synthetic release/rollback
rehearsal, and the dependency audit with zero reported vulnerabilities. Those
results apply only to that exact revision and documented deployment boundary.
The closeout revision must repeat the full gates and must not rely on the base
result.

## Source scope frozen for v1

The following are deliberately outside v1 and do not block completion:

- Decision and Risk projection into Search, Today, Portfolio, dependency
  context, Source parsing, Briefing facts, or optional AI context;
- privileged all-Organization product export;
- optional provider-backed Draft wording assistance;
- multi-user, hosted, LAN, tunnel, authentication, role, budget, resource
  capacity, Gantt, or enterprise dependency-planning behavior; and
- new automatic Jira, notification, communication, ranking, scoring, or state
  transition behavior.

Adding any item above requires a new product decision and a post-v1 roadmap. It
must not be inferred from source closeout or release authority.

## Remaining release-only gates

1. Resolve and privately record the exact merged release commit, schema-v5
   source fingerprint, schema-v6 candidate fingerprint, release and rollback
   checkouts, private paths, exact runtime/LaunchAgent state, process identity,
   port ownership, and rollback conditions.
2. Revalidate the exact merged commit with the complete source, dependency,
   build, security, and synthetic release gates.
3. Create and validate one exclusive whole-document schema-v6 candidate whose
   schema-v5 projection is exact and whose new Decision and Risk collections are
   empty.
4. Smoke the candidate outside the live runtime path and rehearse the exact old
   release rollback.
5. Under exact migration, runtime, LaunchAgent, and release authority, stop only
   the validated runtime, create and verify the timestamped schema-v5 backup,
   atomically install the candidate, activate the approved release, and perform
   read-only acceptance.
6. On any post-replacement failure, perform at most one checksum-verified
   rollback to the exact old release and stop.
7. Retain the verified pre-migration backup and private checksum record for 30
   days after successful release acceptance.

No private path, fingerprint, runtime value, Source content, process evidence,
or operational log belongs in this repository or a public pull request.

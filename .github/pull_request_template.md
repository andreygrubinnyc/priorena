## Authority and scope

- Authority summary: <!-- Describe the bounded repository authority. Do not paste private authority files or paths. -->
- Approved scope: <!-- List exact changed paths or another precise bounded scope. -->
- Prohibited or deferred scope: <!-- State the important exclusions. -->
- Starting base and feature branch: <!-- Use public repository identifiers only. -->

## Implementation summary

<!-- Explain the change and why it satisfies the authorized outcome. -->

## Effects and trust boundaries

| Review area | Effect and evidence |
| --- | --- |
| Security | <!-- New, preserved, or changed controls and review evidence. --> |
| Privacy | <!-- Data handling and disclosure effects. --> |
| Sanitization | <!-- Confirm public content is fictional, English, and free of private or operational values. --> |
| Schema | <!-- State whether schemas change. --> |
| Seed | <!-- State whether committed or private seeds change. --> |
| Trust boundaries | <!-- Identify any input, provider, network, or authority-boundary effect. --> |
| Runtime | <!-- State whether runtime behavior or operation changes. --> |
| Live data | <!-- State whether live/private data was accessed or changed. --> |

## Verification evidence

- Focused tests: <!-- Commands and exact results. -->
- Full test suite: <!-- Command and exact result. -->
- `npm run verify:commit`: <!-- Exact result for the staged snapshot. -->
- `npm audit --audit-level=moderate`: <!-- Registry-backed result; unavailable is not a pass. -->
- `npm run verify:push`: <!-- Exact result for the committed revision. -->
- High-scrutiny change: <!-- Identify security, build, or release-gate changes and their focused review, or write "None." -->

Use this wording when all required checks pass: “No validated security findings were discovered by the checks completed.” Do not claim that the software is vulnerability-free.

## Limitations and residual risks

<!-- Record known limitations, residual risks, and any unverified result. -->

## Merge and release boundary

- Merge requires separate explicit authority.
- Live release requires separate explicit authority.
- This pull request does not authorize runtime operations, live-data work, destructive operations, or external communication.

## Handoff

<!-- Keep every value public-safe. -->

```text
PHASE_RESULT: <result>
STATUS: <status>
BRANCH: <branch-or-none>
HEAD: <commit-or-none>
PR: <pull-request-or-none>
CHECKS: <checks-and-results>
NEXT_AUTHORITY: <required-authority-or-none>
```

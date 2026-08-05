# Priorena

Priorena is a local delivery-intelligence workspace for project managers. It helps a PM review evidence, understand what changed, decide what needs attention, and prepare consistent updates for Teams, leadership email, and Confluence—without replacing Jira or publishing anything automatically.

Repository: https://github.com/andreygrubinnyc/priorena

This repository is a sanitized public edition. It contains only application source, independently fictional demo data, synthetic tests, and self-hosted fonts. It does not contain operational workspace data, uploads, screenshots, credentials, private identifiers, or a connection to a live Jira instance.

## Why it exists

Delivery work rarely slows down because information is completely unavailable. It slows down because decisions are scattered across standups, Jira comments, planning notes, and follow-up conversations. Priorena turns that material into a review-first evidence queue and then into audience-specific briefings with explicit communication baselines.

The core workflow is:

1. Capture bounded text evidence from DSU, Sprint Planning, Backlog Refinement, or an externally generated structured feed.
2. Review every extracted finding before it becomes trusted evidence.
3. Associate work items with a Project only through an exact reviewed Jira Epic key or name.
4. Prepare a briefing from accepted evidence, detected changes, and clearly labeled Manual PM input.
5. Finalize one fact set and render consistent Teams, email, and Confluence-ready outputs.
6. Advance a stream’s comparison baseline only when the PM explicitly marks the briefing communicated.

## Product boundary

Priorena is intentionally a single-user local application:

- The server binds only to `127.0.0.1`.
- It is not approved for LAN access, tunnels, reverse proxies, hosted deployment, or multiple users.
- There is no authentication because loopback-only operation is the supported boundary; loopback is not a substitute for authentication in any broader deployment.
- Jira and approved source material remain authoritative for work-item facts.
- AI drafting is optional. Deterministic extraction and output fallbacks work without an API key.
- Original screenshots never enter Priorena. The app accepts only a strict, bounded `.json` or `.md` feed generated elsewhere.
- Nothing is sent, published, or marked communicated automatically.

## Try the fictional demo

Requirements:

- Node.js 24
- npm

### Start the application

```bash
npm install
cp .env.example .env
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Keep the terminal window running while you use Priorena. Stop the server with `Ctrl+C`; restart it after changing server code or `.env`.

Because `.env.example` enables Demo Mode, the browser automatically opens a fictional **Northstar Launch** starter project with five work items, six accepted evidence records, three milestones, and a guided walkthrough.

### Use the fictional demo

1. Start on **Today** for the guided delivery overview.
2. Use the sidebar to inspect **Work**, **Follow-Up**, and **Milestones**.
3. In **Work**, change a status or assignee and choose **Apply temporarily**.
4. In **Capture**, add fictional or already-sanitized text, then accept or reject the pending evidence.
5. Compare the fictional Teams, email, and Confluence drafts under **Communicate**.
6. Review the read-only demo boundary under **Settings**, or choose **Reset demo** to restore the original sample.

Use **Demo guide** in the header from any demo page for the quick tour, page guide, safety boundary, reset/exit behavior, and troubleshooting.

| Demo page | What it demonstrates | Behavior |
| --- | --- | --- |
| Today | Delivery status and attention signals | Guided, read-only overview |
| Work | Ownership and operating status | Temporary status and assignee edits |
| Follow-Up, Milestones, Portfolio | Planning and delivery context | Read-only examples |
| Capture | Bounded evidence intake and explicit review | Temporary fictional text only |
| Communicate, Teams Draft | Consistent channel-ready wording | Drafts are read-only and never sent |
| Settings | Runtime and isolation controls | Read-only explanation |

Demo Mode provides safe demo-only views for Today, Work, Follow-Up, Milestones, Capture, Portfolio, Communicate, Teams Draft, and Settings. Every page reads the same fictional in-memory session. The normal persistence-backed screens, provider integrations, uploads, and private workspace remain inaccessible while Demo Mode is active.

Choose **Exit Demo** to return to the separate normal workspace. It starts empty and does not inherit the fictional demo data. To use it, create a PM workspace in Settings and then add or import your own authorized local data.

The demo is independently fictional and temporary. Each browser session receives an isolated in-memory workspace. Demo state is erased on reset, exit, expiry, or server restart and never enters the normal persistence path.

To run without Demo Mode, remove `PRIORENA_DEMO_MODE=1` from `.env`.

### Start a normal local workspace

1. Disable Demo Mode in `.env` and restart the server.
2. Open **Settings** and create a PM workspace.
3. Add a Project for one Jira Epic delivery scope.
4. Add or import work items under **Work**.
5. Use row checkboxes for reviewed bulk changes, saved filter views, archive/restore, or protected deletion. Priorena previews each bulk change and keeps local change history.
6. Add milestones with a predefined status, and edit their title, date, status, or notes inline.
7. Capture authorized text evidence under **Capture**, then review pending findings. Source Library supports page selection and atomic deletion with a local recovery snapshot.
8. Use **Today** and **Follow-Up** to review delivery signals. Archived work stays out of operational views and communication drafts.
9. Prepare a reviewed briefing under **Communicate**.

Priorena does not connect to Jira, Teams, email, or Confluence automatically. It prepares local, reviewable records and drafts; you remain responsible for authoritative updates and publication.

### If something looks wrong

- If the browser cannot connect, confirm `npm start` is still running and open exactly `http://127.0.0.1:3000`.
- If Demo Mode does not appear, confirm `.env` contains `PRIORENA_DEMO_MODE=1`, then restart the server.
- If you exited the demo and see empty pages, that is expected: the normal workspace has separate local storage and receives no demo data.
- If port `3000` is already in use, stop the other local server or start Priorena with a different `PORT` value.

### Help and orientation

- **Demo guide** remains available throughout Demo Mode and focuses on the fictional showcase.
- The normal workspace **Help** screen covers first-time setup, navigation, daily flow, evidence review, AI boundaries, privacy, templates, records, and troubleshooting.
- Detailed normal-workspace topics are collapsed by default so users can open only the guidance they need.

## Screenshots

![Priorena fictional demo overview](showcase/priorena-demo-overview.png)

![Priorena sanitized evidence intake](showcase/priorena-demo-evidence-intake.png)

![Priorena review-first controls](showcase/priorena-demo-review-controls.png)

## Run the private local workspace

Without environment overrides, local state is created under the git-ignored `.priorena-data/` directory:

```text
.priorena-data/
├── pilot-data.json
├── backups/
└── uploads/
    └── transcripts/
```

Advanced users can retain the legacy compatibility variables `PMDS_DATA_FILE` and `PMDS_UPLOADS_DIR` to choose different private local paths. Never commit those files or use real workspace material in tests, issues, screenshots, or public examples.

## Optional AI drafting

AI is not required. If you explicitly enable a provider, copy `.env.example` to `.env` and set either `OPENAI_API_KEY` or `CLAUDE_API_KEY`. Relevant selected project text is then sent to that configured provider only for the requested drafting action.

Keep `.env` private. Use only an organization-approved provider and do not submit material you are not authorized to process.

## Technology

- Node.js and Express
- Vanilla JavaScript frontend
- Busboy for bounded multipart parsing
- Whole-file local JSON persistence with atomic replacement
- Self-hosted IBM Plex Sans and IBM Plex Mono
- Optional OpenAI or Anthropic drafting through fixed provider endpoints
- Deterministic local extraction and communication-output fallbacks

## Verification

```bash
npm test
```

The suite covers loopback request boundaries, security headers, bounded uploads and imports, rejected-file cleanup, review queues, atomic Source Library deletion, milestone validation, bulk work-item preview/apply/undo/delete behavior, archive boundaries, saved views, external-feed v1/v2/v3 compatibility, exact Jira-Epic association, typed work items, briefing lifecycle and baselines, output traceability, fictional demo isolation and expiry, export neutralization, AI throttling, and safe failure behavior.

The source snapshot used to prepare this public edition completed a repository-wide Codex Security review with no reportable findings. See [SECURITY_REVIEW_SUMMARY.md](SECURITY_REVIEW_SUMMARY.md) for the bounded verification record. That result applies only to the reviewed snapshot and the documented local-only deployment boundary; it is not a guarantee of future security.

### Secure development gates

Install the version-controlled Git hooks after cloning. `npm install` runs this automatically; it can also be requested explicitly:

```bash
npm run hooks:install
```

The fast pre-commit gate inspects the staged patch for prohibited private files, credentials, operational markers, unexpected binary files, merge artifacts, JavaScript syntax errors, and test regressions:

```bash
npm run verify:commit
```

The pre-push and CI gate scans the committed tree and additionally runs the production validation build and the npm vulnerability audit:

```bash
npm run verify:push
```

GitHub pull requests also run the security gate, dependency review, and CodeQL. Required checks and the protected `main` branch are the authoritative merge boundary. Do not bypass hooks with `--no-verify`; a check that cannot run is unverified, not passed.

## Repository map

```text
briefings/        Briefing validation, lifecycle, and evidence candidates
demo/             Independently fictional fixture and in-memory session store
public/           Browser application, styles, utilities, and self-hosted fonts
test/             Synthetic security and domain regression tests
scripts/security/ Version-controlled commit, push, syntax, build, and sanitization gates
work-items/       Bulk preview, update, history, undo, deletion, and saved-view rules
workspaces/       Project/Jira-Epic domain rules
external-feed.js  Strict external-feed parser and reconciliation logic
server.js         Loopback-only Express application and API routes
```

## Security and privacy

Read [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md) before changing deployment, persistence, uploads, provider behavior, or the user model.

Do not open security issues containing real workspace data, credentials, private transcripts, or screenshots. Report suspected vulnerabilities privately to the repository owner.

## Current limitations

- Single-user and local-only
- No live Jira, Teams, email, or Confluence connector
- No authentication or multi-tenant authorization
- Whole-file JSON storage is not appropriate for concurrent or hosted use
- Public hosting requires a new architecture, threat model, transactional storage, abuse controls, monitoring, and incident response

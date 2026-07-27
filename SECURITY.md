# Security policy

## Supported boundary

Priorena is supported only as a single-user local application bound to `127.0.0.1`.

Do not expose it through a LAN address, reverse proxy, tunnel, hosted service, or shared account. The application has no authentication because network exposure is outside the supported design. Any hosted or multi-user edition requires a separate threat model and controls for authentication, authorization, CSRF and sessions, tenant isolation, transactional storage, audit logging, secrets management, abuse prevention, monitoring, and incident response.

## Private local files

The following paths are git-ignored and must never be committed, attached to issues, or copied into public fixtures:

- `.env`
- `.priorena-data/`
- `pilot-data.json`
- `uploads/`

Use only synthetic fixtures in tests and documentation.

## Core invariants

- Bind only to loopback and validate loopback Host values before body parsing.
- Require same-origin mutation requests and reject cross-site Fetch Metadata.
- Keep request, upload, parser, record, output, AI, and session resources bounded.
- Treat uploaded, imported, persisted, and AI-produced content as untrusted.
- Preserve exact evidence provenance and require explicit review before trusted-state changes.
- Prevent request-selected paths from escaping managed storage roots.
- Escape every dynamic value for its HTML, attribute, CSV, or Markdown context.
- Keep AI credentials server-side and send data only through explicit optional actions to fixed provider endpoints.
- Keep Demo Mode fictional, temporary, in memory, and isolated from private persistence.
- Advance a briefing baseline only through explicit communication.

## Screenshot boundary

Priorena performs no OCR and never receives or stores original screenshots. A separately generated external feed is untrusted input and must pass strict schema validation, exact evidence linkage, explicit field decisions, and final stale-value checks.

## Reporting vulnerabilities

Report suspected vulnerabilities privately to the repository owner. Do not include credentials, operational workspace data, private transcripts, provider responses, or screenshots containing real project information.

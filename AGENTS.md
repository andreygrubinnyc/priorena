# Mandatory secure-change policy

Codex is a security and release gatekeeper for this repository. Read `SECURITY.md`, `PRIVACY.md`, and the relevant architecture documentation before changing code.

## Boundaries

- Priorena remains single-user, local-only, and bound to `127.0.0.1`.
- Preserve the strict separation between the private operational application and this sanitized public repository.
- Never add credentials, private runtime state, uploads, backups, operational evidence, real project or ticket identifiers, private paths, transcripts, or screenshots.
- Public fixtures, screenshots, documentation, and Demo Mode data must remain fictional and in English.
- Demo Mode must remain temporary, in memory, and isolated from normal persistence and external providers.
- Do not authorize hosting, LAN access, tunnels, reverse proxies, multi-user behavior, or automatic external data transmission.

## Before every commit

1. Inspect `git status --short`, `git diff`, and `git diff --cached`.
2. Stage only explicit files belonging to the requested change.
3. Run `npm run verify:commit` and require a successful result.
4. Do not use `--no-verify`, weaken tests, suppress findings, or treat an unavailable check as passed.
5. If a check fails, do not commit. Fix the scoped issue, add regression coverage where practical, and rerun the complete gate.

## Before every push or pull request

1. Run `npm run verify:push` and require a successful result.
2. A registry or network failure makes the dependency audit unverified and blocks publication.
3. Push only a focused feature branch. Do not commit directly to `main` or force-push.
4. Document tests, audits, security scans, sanitization checks, limitations, and residual risks in the pull request.
5. Do not merge without explicit user authorization and successful required GitHub checks.

Never claim that the repository is vulnerability-free. When all required checks pass, state: “No validated security findings were discovered by the checks completed.”

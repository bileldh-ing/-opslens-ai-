# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-22

### Added
- **Ingest API keys**: project-scoped keys (create / revoke in Settings), shown once, stored as SHA-256, last-used tracking.
- **HTTP log ingestion** `POST /api/v1/logs`: NDJSON, plain text, JSON arrays and OTLP logs JSON (`resourceLogs`), 5 MB / 120 req/min per key. Docs in `docs/ingest-api.md`.
- **Webhooks & Slack notifications** on `incident.created` and `incident.status_changed`: generic JSON (HMAC-SHA256 signed, timestamped) or Slack-compatible bodies, Test button, pause/resume, delivery log, SSRF guard. Docs in `docs/webhooks.md`; `npm run webhook:receiver` for local testing.
- **Quality page** (`/[org]/quality`): golden eval runs recorded from the UI, CLI and CI, per-case results, pass-rate history, investigation stats.
- **Incident export** as JSON (full record) or CSV (timeline), with formula-injection-safe CSV.
- **Installable PWA**: web manifest, maskable icons, apple-touch-icon, theme colour, service worker with offline fallback page.
- **Health probes**: `/api/health` (liveness, no dependencies) and `/api/ready` (database + Redis checks, 503 when unavailable).
- **Playwright E2E** suite against a seeded PGlite server; `npm run demo` for recordings.
- **CI/CD**: lint → typecheck → tests with coverage → evals → build → E2E (videos and report as artifacts); Postgres + Redis service job; Docker multi-arch build with Trivy scan, SBOM and provenance pushed to GHCR; CodeQL; Lighthouse CI budgets; tag-driven releases with generated notes and a standalone bundle; Dependabot.
- Production Dockerfile (standalone output, non-root, HEALTHCHECK) and a compose stack with Postgres (pgvector), Redis, migrate job, app and worker.
- SECURITY.md, CONTRIBUTING.md, CODEOWNERS, issue and PR templates.

### Changed
- Configuration is validated with zod at startup with a readable list of problems.
- Security headers on every response: CSP, HSTS (HTTPS), X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, COOP; `X-Powered-By` removed.
- Every request gets an `X-Request-Id` (kept from upstream when valid) and API errors are logged as structured JSON with it.
- Sign-in brute-force protection now counts failures only, across IP+account, IP and account windows; sign-ups are rate limited per IP.
- Audit log now covers sign-ins, exports, API keys, webhooks, eval runs and status transitions (with from/to and client IP).
- Consistent styled 404, error and global-error screens; empty states across incidents, remediations, keys, webhooks and evals.
- ESLint flat config (`eslint-config-next`) with `npm run lint`.

## [0.2.0] - 2026-10-21

### Added
- Zero-config mode: embedded Postgres 17 + pgvector (PGlite), inline jobs, deterministic triage analyst.
- Settings, data sources, incident status workflow, integration tests on PGlite, offline evals.

## [0.1.0] - 2026-10-20

### Added
- Multi-tenant SaaS workspace, incident intelligence, RAG investigation agent with verified citations, approval-gated remediation.

[1.0.0]: https://github.com/bileldh-ing/-opslens-ai-/compare/v0.2.0...v1.0.0
[0.2.0]: https://github.com/bileldh-ing/-opslens-ai-/releases/tag/v0.2.0

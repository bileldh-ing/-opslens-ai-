# Contributing to OpsLens AI

Thanks for helping! This guide gets you from clone to a merged PR.

## Setup

```bash
npm install
cp .env.example .env      # zero-config: embedded Postgres (PGlite) + offline AI
npm run setup             # migrate + seed the demo workspace
npm run dev               # http://localhost:3000  (demo@opslens.dev / opslens-demo-123)
```

Node 22+ is required. Docker is optional (`docker compose up` for Postgres + Redis + worker).

## Before you push

```bash
npm run lint
npm run typecheck
npm test                  # unit + integration (embedded Postgres + pgvector), serial
npm run eval              # golden investigation cases
npm run e2e               # Playwright (first time: npm run e2e:install)
```

`npm run verify` runs the first four in sequence. CI runs all of them plus a production build,
E2E against the built app, Postgres/Redis integration, CodeQL, Docker build + Trivy and Lighthouse.

## Conventions

- **Commits**: imperative, scoped subject lines (`Webhooks: sign payloads with HMAC`). Conventional-commit prefixes (`feat:`, `fix:`) are welcome; the release notes are generated from subjects.
- **Database changes**: edit `src/db/schema.ts`, then `npm run db:generate -- --name <change>` and commit the SQL in `drizzle/`. Never edit an applied migration.
- **Tenancy**: every query on tenant data must be scoped by `orgId` (directly or through `projects.orgId`). Add a test when you add a query path.
- **Security-sensitive actions** must call `audit()`.
- **Tests**: pure logic gets a unit test; anything touching SQL gets a PGlite integration test; user-visible flows get a Playwright spec.
- **UI**: Tailwind v4 tokens from `globals.css`; reuse `Card`, `Button`, `Badge`, `EmptyState`.

## Pull requests

Fill in the PR template, keep PRs focused, and make sure CI is green. A maintainer from
`CODEOWNERS` reviews every PR.

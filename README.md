# OpsLens AI — Intelligent Software Operations Platform

> Ask *"Why did our payment service start returning 500 errors after the last deployment?"* and get ranked, evidence-backed hypotheses, citations to the exact log lines and deploys, and a remediation plan that a human must approve.

OpsLens AI is a multi-tenant SaaS that helps engineering teams investigate production incidents using their own logs, deployments, documentation and incident history. It is built around existing LLMs: the engineering focus is on **grounding, safety, data modeling and production architecture**, not prompt tricks.

## Features

| Area | What it does |
|---|---|
| **SaaS workspace** | Organizations, projects, teams, email invitations, role-based access (owner/admin/member/viewer), plan limits, audit log, session auth with hashed tokens |
| **Incident intelligence** | Log ingestion (JSON, pino numeric levels, plain text) → error **fingerprinting** and grouping → automatic incident creation, severity inference, **deployment correlation**, timelines, investigation history |
| **AI investigation agent** | Vercel AI SDK tool-calling agent with full-text log search, error groups, deployments, **pgvector RAG** over docs/runbooks/postmortems and similar past incidents; streaming UI; **structured report** with calibrated confidence |
| **Anti-hallucination guardrail** | Every citation is checked against ids the tools actually returned. Unverifiable citations are dropped, confidence is discounted, and unsupported conclusions are downgraded to *inconclusive* |
| **Safe remediation** | Runbooks, read-only test queries, suggested fixes and draft patches are stored as `pending_approval`. Explicit state machine, admin-only approval, second reviewer required for high-risk changes, every decision audited |

## Architecture

```
Browser ──► Next.js 16 (App Router, RSC, server actions)
              │  ├─ /api/orgs/:org/projects/:p/investigate  → AI SDK streamText + tools ──► LLM provider
              │  ├─ /api/orgs/:org/projects/:p/ingest       → object storage → BullMQ job
              │  └─ /api/orgs/:org/remediations/:id/review  → approval state machine + audit
              ▼
        PostgreSQL + pgvector (Drizzle ORM)        Redis (rate limits, BullMQ)
              ▲                                           │
              └──────────── worker: parse → fingerprint → group → correlate → embed
```

**Tenancy & security.** Every query is scoped by org; tools are constructed per project so the model cannot reach another tenant's data. Non-members get a 404, not a 403. Session tokens are stored as SHA-256 hashes. Login is rate-limited and returns identical errors for unknown email/wrong password.

**Data model** (`src/db/schema.ts`): users, sessions, organizations, memberships, teams, invitations, projects, audit_logs, services, deployments, log_events (GIN full-text index), error_groups (unique fingerprint per project), incidents (HNSW vector index on summary embeddings), incident_events, documents, document_chunks (HNSW cosine), investigations, investigation_steps, remediations.

## Tech stack

Next.js 16.4 · React 19.3 · TypeScript · Tailwind CSS v4 · shadcn-style UI · Vercel AI SDK 7 · PostgreSQL 17 + pgvector · Drizzle ORM · Redis + BullMQ · Vitest · Docker · GitHub Actions

## Getting started

```bash
cp .env.example .env            # add OPENAI_API_KEY
docker compose up -d postgres redis
npm install
npm run db:push                  # create schema (needs the vector extension: CREATE EXTENSION vector;)
npm run db:seed                  # demo org "acme" with the payment-service 500s scenario
npm run worker &                 # background ingestion/indexing
npm run dev
```

Sign in as **demo@opslens.dev / opslens-demo-123** and open `/acme`.

## Testing & evaluation

- `npm test` — unit tests for parsing, fingerprinting, deployment correlation, severity, RBAC, plan limits, the remediation state machine and the citation guardrail.
- `npm run eval` — runs golden investigation cases against the real agent and grades **grounding**: correct status, top cause, required citation types, and that it **refuses to be confident when there's no data**.
- CI (GitHub Actions) runs typecheck, tests, schema push against a pgvector service container, and a production build on every push.

## Roadmap

- [ ] GitHub integration: read diffs of the suspected deploy and open draft PRs for approved patches
- [ ] OpenTelemetry ingestion endpoint and live tailing
- [ ] Stripe billing for plan upgrades
- [ ] Eval dashboard with historical scores per model
- [ ] Slack notifications for new incidents and approval requests

## License

MIT

# OpsLens AI

**Production incident investigation with evidence, not guesses.**

Ask *"Why did our payment service start returning 500 errors after the last deployment?"* and OpsLens pulls the logs, the deployments around the first error, your runbooks and similar past incidents, then returns ranked hypotheses with **verified citations**, **calibrated confidence**, and a remediation plan that **waits for human approval**.

OpsLens is a multi-tenant SaaS built around existing LLMs. The engineering work is in what surrounds the model: data modelling, retrieval, grounding guardrails, tenancy, approval workflows and the operational architecture.

[![CI](https://img.shields.io/badge/CI-GitHub_Actions-2088FF?logo=githubactions&logoColor=white)](.github/workflows/ci.yml)
![Next.js](https://img.shields.io/badge/Next.js-16.4-000?logo=nextdotjs)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Postgres](https://img.shields.io/badge/Postgres-17_+_pgvector-4169E1?logo=postgresql&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Try it in one minute (no Docker, no API key)

```bash
git clone https://github.com/bileldh-ing/-opslens-ai- && cd -- -opslens-ai-
npm install
cp .env.example .env
npm run setup        # migrates an embedded Postgres + pgvector and seeds the demo
npm run dev
```

Open http://localhost:3000, sign in as **demo@opslens.dev / opslens-demo-123**, open **Incidents**, then **Investigate with AI**.

Without a model key, OpsLens runs in **demo mode**: investigations are handled by a deterministic triage analyst and retrieval uses local hashing embeddings, so the full product works offline. Add `OPENAI_API_KEY` (or any OpenAI-compatible `AI_BASE_URL`, such as Ollama) to switch on the LLM agent.

## What it does

| Area | Highlights |
|---|---|
| **SaaS workspace** | Organizations, projects, teams, invitations with expiring single-use tokens, roles (owner/admin/member/viewer), plan limits enforced server-side, full audit log, session auth with hashed opaque tokens |
| **Incident intelligence** | Log ingestion (JSON lines, pino numeric levels, plain text) → normalisation → **error fingerprinting** → recurring error groups → automatic incidents with **severity inference** and **deployment correlation** → incident timeline and status workflow |
| **AI investigation agent** | AI SDK 7 tool-calling agent: full-text log search, error groups, deployments, **pgvector RAG** over runbooks/postmortems/code and similar past incidents. Tool calls stream to the UI as they happen; every step is persisted |
| **Grounding guardrail** | Every citation must reference an id a tool actually returned in this run. Unverifiable citations are dropped, confidence is discounted, and a conclusion left without evidence is downgraded to *inconclusive*. The model is told it may answer *insufficient data* |
| **Safe remediation** | Rollbacks, runbooks, read-only diagnostic queries and draft patches are stored as `pending_approval`. Explicit state machine, admin-only approval, a second reviewer for high-risk changes, every decision audited. Nothing executes automatically |
| **Evaluation** | Golden cases graded on grounding (status, top cause, required citation types, and *not* being confident when there is no data), runnable in CI |

## Architecture

```mermaid
flowchart LR
  U[Browser] -->|RSC, server actions| N[Next.js 16 App Router]
  N -->|/investigate stream| A[Investigation agent<br/>AI SDK tools]
  A -->|project-scoped tools| DB[(Postgres 17<br/>+ pgvector)]
  A -->|OpenAI-compatible| L[LLM provider]
  A -.no key.-> T[Deterministic triage]
  T --> DB
  N -->|/ingest, /documents| S[Object storage]
  S --> Q{REDIS_URL?}
  Q -->|yes| W[BullMQ worker]
  Q -->|no| I[Inline job]
  W & I -->|parse → fingerprint → group → correlate → embed| DB
  N -->|review| R[Approval state machine] --> DB
```

**One codebase, two runtimes.** `DATABASE_URL=postgres://…` uses node-postgres; `pglite://…` runs the same migrations on embedded Postgres 17 with pgvector compiled to WASM. Redis is likewise optional: with it, uploads go through BullMQ with retries and backoff; without it, jobs run inline and rate limits are in-process.

**Tenancy.** Every query is scoped by organization. Agent tools are constructed per project, so the model has no way to reach another tenant's rows, whatever it asks for. Non-members get a 404 rather than a 403.

**Data model** (`src/db/schema.ts`, migrations in `drizzle/`): users, sessions, organizations, memberships, teams, invitations, projects, audit_logs, services, deployments, log_events (GIN full-text index), error_groups (unique fingerprint per project), incidents (HNSW index on summary embeddings), incident_events, documents, document_chunks (HNSW cosine), investigations, investigation_steps, remediations.

## Design decisions

- **Citations are verified, not trusted.** The LLM is good at sounding sure. The guardrail in `src/server/ai/report.ts` turns *"cites a log line"* into a checkable property.
- **A rule-based analyst as baseline.** `src/server/ai/triage.ts` uses the same tools and output schema as the agent. It keeps the product usable offline and gives the eval harness something to beat.
- **Proposals, never actions.** Remediations are data with a lifecycle (`draft → pending_approval → approved/rejected → executed`) so that the AI cannot change production by itself.
- **Fingerprints over clustering.** Normalising ids, numbers, hashes and durations before hashing gives stable, explainable error groups without a model in the ingest path.

## Project structure

```
src/
  app/                 routes: landing, auth, /[org]/{overview,incidents,investigate,remediations,sources,audit,settings}
  app/api/             ingest, documents, investigate (streaming), remediation review
  server/ingest/       parse, fingerprint, correlate, chunk, pipeline
  server/ai/           agent, tools, triage, report (guardrail), embeddings, prompts, models
  server/jobs/         BullMQ queue, worker, shared handlers
  lib/                 auth, rbac, plans, audit, rate-limit, storage
  db/                  schema, client (pg or PGlite), migrator
drizzle/               SQL migrations
tests/                 unit tests + integration test on embedded Postgres
evals/                 golden investigation cases and runner
data/sample/           payment-service 500s scenario: logs, deployments, runbook, postmortem
```

## Testing

```bash
npm run typecheck
npm test          # unit tests + end-to-end integration test on embedded Postgres + pgvector
npm run eval      # golden investigation cases (LLM agent if a key is set, triage otherwise)
```

CI runs typecheck, tests and evals on every push, then applies migrations, seeds and builds against a real `pgvector/pgvector:pg17` service container.

## Running with Docker

```bash
docker compose up -d postgres redis
DATABASE_URL=postgres://opslens:opslens@localhost:5432/opslens REDIS_URL=redis://localhost:6379 npm run setup
docker compose --profile full up --build   # app + worker
```

## Roadmap

- [ ] GitHub integration: read the diff of the suspected deploy, open draft PRs for approved patches
- [ ] OpenTelemetry ingestion endpoint and live tail
- [ ] Stripe billing for plan upgrades
- [ ] Eval dashboard with scores per model over time
- [ ] Slack notifications for new incidents and approval requests

## License

MIT © Bilel Dhahri

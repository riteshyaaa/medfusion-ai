# MedScope AI

> **Medical disclaimer — read first.** MedScope AI is a research and education prototype. It is **not** a diagnostic device, not clinically validated, and not a substitute for professional evaluation. It cannot rule out serious conditions. Do not enter real patient data without your own governance.

## What it is

MedScope AI is a single-repo platform for **organizing health information and running structured, honest assessments** across five modules — skin analysis, symptom triage, report reading, cardiac risk (research-only), and case/patient management — with strict fail-closed safety rules: nothing is fabricated when a model is missing, unapproved, or fails a self-check.

## Features

- **Skin Analysis** — upload a photo; local screening rejects non-skin images instantly; consent-gated advanced AI (NVIDIA/Gemini/OpenAI vision) returns a structured assessment: clinical description, ranked differential diagnoses with varying match scores, and recommendations. Saved history shows your analyzed photos for records created since the image feature shipped (older records stay fully private; owner-scoped view, never publicly served). Optional classic CNN research pipeline (PAD-UFES-20 baseline, tested in this repo).
- **Symptom Assessment** — deterministic, rule-based triage with adaptive follow-up questions and negation-aware guidance; one optional consent-gated AI evaluation per assessment (urgent red flags bypass AI entirely and always win).
- **Report Analysis** — upload a text PDF, scanned PDF, PNG or JPEG medical report; local text extraction (+ OCR); every extracted finding is reviewed by you (confirm/correct/reject); optional consent-gated, invention-safe interpretation; trend matching across reports by identical label + unit; failed interpretations stay visible with error codes.
- **Cardiac Assessment (research-only)** — questionnaire built on a checksummed, reproduction-tested logistic-regression model (UCI Cleveland 1988); fail-closed serving (operator opt-in via env, pinned-fixture self-check per load); urgent-symptom safety screen; longitudinal history with version-aware comparison; consent-gated AI explanations; printable `.txt`/`.pdf` exports.
- **Patients, Cases & Workspace** — owner-scoped records, per-case consolidated workspace, draft reports with export; everything audited.
- **Safety engineering throughout** — cookie sessions (hashed server-side, rotated), bcrypt passwords, CSRF origin checks, rate limits, request IDs, private upload storage, consent + transfer gates on every AI call, never persisting rejected provider output, and uncalibrated scores always clearly labelled (never "probability of disease").

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind, React Query |
| API | Hono (TypeScript), middleware-based auth/validation/audit |
| Database | PostgreSQL 15+, Drizzle ORM (additive, repeatable migrations) |
| Contracts | OpenAPI 3.1 + Orval → generated React Query hooks & Zod schemas |
| AI providers | NVIDIA / Gemini / OpenAI adapters (allowlisted models, server-side keys) |
| ML pipelines | Python (`ml/skin/`, `ml/cardiac/`), checksummed artifacts in `models/registry/` |
| Tests | Node test runner; 99 passing API/unit tests, no live external calls |

## Quickstart

**Prerequisites:** Node.js ≥ 20.12, [pnpm](https://pnpm.io), PostgreSQL ≥ 15.

```bash
# 1. Install
pnpm install

# 2. Configure
cp .env.example .env        # then set DATABASE_URL (+ optional AI keys, see below)

# 3. Database (create role/db via psql as admin)
psql -c "CREATE ROLE medscope LOGIN PASSWORD 'set-a-local-password';"
psql -c "CREATE DATABASE medscope_ai OWNER medscope;"
pnpm db:migrate

# 4. Run (frontend on http://localhost:3000, API on http://127.0.0.1:3001)
pnpm dev                    # or: pnpm --filter @workspace/api-server start
pnpm --filter @workspace/skin-ai dev
```

Optional fictional seed (loopback-only, refuses production, requires confirmation):

```bash
DEV_SEED_CONFIRM=I_UNDERSTAND_FICTIONAL_DATA \
DEV_SEED_PASSWORD=choose-a-private-local-password \
pnpm db:seed:dev
```

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (required) |
| `PORT` / `API_PORT` | frontend / API ports (3000 / 3001) |
| `AI_DATA_SHARING_ENABLED` + `AI_HEALTH_DATA_TRANSFER_APPROVED` | both `true` required to allow any external AI processing |
| `AI_PROVIDER` | `gemini`, `openai`, or `nvidia` (default off) |
| `AI_MODEL`, per-provider `*_API_KEY` | model & credentials, keep server-side |
| `AI_SKIN_VISION_MODEL` | optional vision-model override (`meta/llama-3.2-11b-vision-instruct` = fastest, 120B default) |
| `AI_REQUEST_TIMEOUT_MS`, `AI_MAX_RETRIES` | 45000 / 0 recommended |
| `CARDIAC_RESEARCH_INFERENCE_ENABLED` | `true` ONLY to enable uncalibrated research cardiac scores; leaving it unset keeps serving honestly unavailable |
| `CORS_ORIGINS`, `RATE_LIMIT_*` | deployment limits |

## Commands & verification

```bash
pnpm run typecheck       # all packages
pnpm run build           # production builds (Vite + libs)
pnpm test                # API suite; needs a DEDICATED test DATABASE_URL, do not use real data
pnpm --filter @workspace/api-spec codegen   # regenerate clients after OpenAPI edits
pnpm db:generate         # new additive migration (review the SQL before applying)
```

Tests typecheck and run with no live provider, OCR, or network calls. Migrations are additive only; there is no reset, destructive push, or rollback — take backups before deploying.

## Project structure

```
├── artifacts/
│   ├── skin-ai/        # React frontend (Skin, Symptoms, Reports, Cardiac, Patients, Cases)
│   └── api-server/     # Hono API, gates, exports, tests
├── lib/
│   ├── api-spec/       # OpenAPI contract (source of truth)
│   ├── api-client-react/
│   ├── api-zod/        # generated clients (do not hand-edit)
│   └── db/             # Drizzle schema + migrations (drizzle/)
├── ml/
│   ├── skin/           # PAD-UFES-20 CPU CNN pipeline
│   └── cardiac/        # Cleveland logistic-regression pipeline (reproducible)
├── models/registry/    # checksummed model artifacts + self-check fixtures
├── scripts/            # dev-only seed + DB verification tool
└── docs/               # implementation checklist, project report, troubleshooting log
```

## Documentation

- [docs/implementation-checklist.md](docs/implementation-checklist.md) — phased build record with every gate's commands & results
- [docs/project-report.md](docs/project-report.md) — full report: objectives, evaluation evidence, limitations (viva-ready)
- [docs/problems-and-solutions.md](docs/problems-and-solutions.md) — real debugging journey: every problem and its fix
- [docs/research/](docs/research/) — dataset provenance, training baselines, accuracy progression, symptom-engine design
- [docs/providers.md](docs/providers.md) — verified provider adapters and their limits

## Known limitations

- Skin CNN: 58.1% six-class held-out accuracy, `research_only_not_approved`; serving stays fail-closed until a genuinely approved artifact exists.
- Cardiac model: 1988-cohort research baseline, uncalibrated scores; CV evidence is not clinical validation; serving needs explicit operator opt-in.
- AI explanations are educational, consent-gated, and never stored if the validator rejects them; they never alter numerical results.
- Single-host storage; in-memory per-process rate limits; no retention automation; no lint script or browser-automation suite.
- No LICENSE file yet — **all rights reserved** by default; choose a license explicitly before publishing.

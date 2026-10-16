# MedScope AI - Intelligent Health Assessment Platform

MedScope AI is a research and education prototype for organizing health information and structured assessments. It is not a clinically validated diagnostic device. It does not claim regulatory compliance or real-world diagnostic accuracy.

## Current implementation status

Phase 1 provides a working TypeScript/React frontend, Hono API server, PostgreSQL persistence through Drizzle, cookie-based authentication, owner-scoped records, private local image storage, and an honest unavailable-model response.

The dedicated Skin Analysis workflow validates and privately stores an uploaded image. No approved skin classifier is configured, so a normal application request to prediction returns HTTP 503 with model_unavailable. No disease result is fabricated. Automated tests can install a visibly simulated inference provider only when NODE_ENV=test.

Symptom Assessment saves user-entered information and returns conservative guidance from a small, transparent rule set. It is not a diagnosis or medical advice. Reports are server-assembled drafts from records owned by the signed-in account. PDF export, signatures, and a verified human-review workflow are not implemented. Model training and NVIDIA, Gemini, and OpenAI provider adapters have not started.

## Workspace layout

- artifacts/skin-ai: React, TypeScript, Vite frontend.
- artifacts/api-server: Hono HTTP API and API integration tests.
- lib/api-spec: OpenAPI contract and Orval code generation.
- lib/api-client-react: generated React Query client.
- lib/api-zod: generated Zod request and response schemas.
- lib/db: PostgreSQL schema, Drizzle configuration, and migrations.
- scripts: development-only seed command.
- docs/implementation-checklist.md: discovery notes and phased checklist.

The application is a modular monolith. The browser talks to the Vite same-origin /api proxy, which forwards requests to the Hono server.

## Local setup

Requirements: Node.js 20.12 or later, pnpm, and PostgreSQL 15 or later.

1. Install workspace dependencies and copy the environment template:

~~~powershell
pnpm install
Copy-Item .env.example .env
~~~

2. Create a local PostgreSQL role and an empty database using your PostgreSQL administrator account. Set a private password on your local machine; do not commit .env.

~~~sql
CREATE ROLE medscope LOGIN PASSWORD 'set-a-local-password';
CREATE DATABASE medscope_ai OWNER medscope;
~~~

3. Set DATABASE_URL in .env to the local database. The example is:

~~~text
postgresql://medscope:set-a-local-password@localhost:5432/medscope_ai
~~~

4. Apply the checked-in migration and start the API and frontend:

~~~powershell
pnpm db:migrate
pnpm dev
~~~

The frontend uses http://localhost:3000; the API listens on http://127.0.0.1:3001 by default. The API process remains available when no database is configured, but readiness returns HTTP 503 until PostgreSQL is reachable.

### Migrations and existing databases

pnpm db:generate creates a migration from the current Drizzle schema. Review and commit the generated SQL before applying it. pnpm db:migrate applies unapplied migrations and does not drop tables or records.

The first migration in this repository is a full schema baseline. Apply it to a clean database. Do not point it at an existing database until its schema has been compared and a deliberate baseline/adoption procedure has been prepared. No automatic database reset, destructive push, or migration rollback is provided. For recovery, take a database backup before deployment and restore it using the operator's PostgreSQL backup procedure.

### Fictional development seed

The seed creates one unprivileged fictional account, one fictional patient, and one fictional case. It only accepts a loopback database host, refuses NODE_ENV=production, never overwrites an existing account, and requires explicit confirmation and a private password.

~~~powershell
$env:DEV_SEED_CONFIRM = "I_UNDERSTAND_FICTIONAL_DATA"
$env:DEV_SEED_PASSWORD = "choose-a-private-local-password"
pnpm db:seed:dev
~~~

The seed account is developer@medscope.test. The seed password is not stored in the repository. Do not use real patient information for development or testing.

## Verification commands

API integration tests require a dedicated, migrated test database. Do not point them at a personal or production database. On PowerShell, after creating an empty test database:

~~~powershell
$env:DATABASE_URL = "postgresql://medscope_test:local-password@127.0.0.1:5432/medscope_test"
pnpm db:migrate
pnpm test
~~~

pnpm test typechecks the API tests and exercises health/readiness, registration/login/logout/session rotation, authorization, image validation and limits, model-unavailable behavior, a test-only simulated prediction, persistence, and frontend API-hook usage.

Other checks:

~~~powershell
pnpm run typecheck
pnpm run build
pnpm --filter @workspace/api-spec run codegen
~~~

There is no lint script configured. No browser automation suite is configured.

## API surface

Implemented routes are versioned under /api:

- GET /api/healthz: process health.
- GET /api/readyz: PostgreSQL readiness, approved-model state, and optional AI-provider configuration state.
- POST /api/auth/register, POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me: account and server-session lifecycle.
- POST /api/uploads, DELETE /api/uploads/{id}: validated image upload and owner-authorized deletion.
- POST /api/predict, GET /api/predictions, GET /api/predictions/{id}: prediction contract and owner-scoped history.
- POST /api/ai/explanations: optional provider-generated educational text for an owned, completed, approved prediction; requires per-request consent and server-side data-transfer approval.
- GET/POST/PATCH/DELETE /api/patients: patient records; delete archives.
- GET/POST/PATCH /api/cases: owner-scoped cases and status updates.
- GET/POST /api/symptom-assessments, GET /api/symptom-assessments/{id}: persisted rule-based assessments.
- GET/POST/PATCH /api/reviews: role-gated review records. Registration cannot grant privileged roles, and the product does not include a clinician identity-verification or review-assignment workflow.
- GET/POST/PATCH /api/reports: owner-scoped draft creation and archival.

Request validation errors use a consistent JSON error shape with a request ID. The API avoids returning stack traces. Request logs contain request IDs, methods, statuses, durations, and non-sensitive event metadata; they do not log image bytes, symptoms, passwords, session tokens, or report content.

## Authentication, ownership, uploads, and retention

Passwords are hashed with bcrypt. Session tokens are random, stored server-side as SHA-256 hashes, rotated at login, and sent only in HttpOnly, SameSite=Lax cookies; production cookies set Secure. State-changing browser requests are restricted to configured origins. The default registration role is user; request payloads cannot grant privileged roles.

Patient, case, upload, prediction, review, and report reads and mutations are scoped by server-side ownership or reviewer authorization. Patient deletion archives the record. Uploads accept JPEG, PNG, and WebP, validate decoded content and dimensions, normalize to JPEG, and use opaque storage keys in a private local directory. The API does not expose the storage key or provide a public media URL. The local storage provider is for development and a single application host; S3-compatible storage is not implemented.

There is no automatic data-retention job or account-wide deletion workflow. Owners can delete uploads that are not linked to predictions; linked media cannot be deleted through the upload route. Operators must define backups, retention, and storage cleanup before using non-fictional data. Do not serve the upload directory as static web content.

Rate limits are in-memory and apply per API process, so they do not coordinate across multiple server instances. Configure CORS origins for the actual deployment. The current model is unapproved, so the explanation route fails closed before any external provider call.

## Product and safety boundary

Skin Analysis is present as a dedicated module, but the classifier is unavailable until a later phase produces and verifies an artifact. Symptom guidance is rule-based and limited. Candidate labels from a test double are visibly marked simulated and hidden from normal score display. Raw model scores and calibrated dataset probabilities are distinct in the UI; no score is presented as an individual's chance of disease.

The platform does not claim clinical validation, improved patient outcomes, regulatory approval, or HIPAA/GDPR/DPDP compliance. It cannot rule out serious conditions and does not replace professional evaluation.

## Phased roadmap

- Phase 0: repository discovery and baseline - documented in the implementation checklist.
- Phase 1: application, API, authentication, PostgreSQL, storage, and frontend workflows - implemented and acceptance-tested in this repository state.
- Phase 2: PAD-UFES-20 v1 provenance, a reproducible CPU training pipeline, and a measured held-out baseline are documented. The dataset and model artifacts remain local and ignored; the verified model is marked research-only and is not approved for inference.
- Phase 3: optional server-side NVIDIA, Gemini, and OpenAI educational-explanation adapters - implemented with official endpoint/model allowlists, mocked HTTP tests, strict output validation, and consent/data-transfer gates. The route remains unavailable until an approved model exists.
- Phase 4: verified model inference integration - gated; the current artifact fails the approval-readiness check, so the API remains model-unavailable.
- Phase 5: further review, operational hardening, retention, and release-readiness work - pending.
- Future modalities remain separate task-specific research efforts; no radiology, oncology, neurology, or genomics model is implemented.

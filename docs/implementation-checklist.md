# MedScope AI implementation checklist

## Phase 0: repository discovery and baseline

Discovery was completed before implementation on 2026-10-15.

- Repository: `https://github.com/riteshyaaa/medfusion-ai.git`, branch `main`. The working tree was clean before this task.
- Workspace: pnpm, TypeScript 5.9, React 18/Vite, Hono API server, Drizzle ORM/PostgreSQL, OpenAPI 3.1, and Orval-generated React Query and Zod clients.
- Main paths: `artifacts/skin-ai`, `artifacts/api-server`, `lib/api-spec`, `lib/api-client-react`, `lib/api-zod`, and `lib/db`. A UI sandbox, integrations packages, attached assets, and two archived skin-ai bundles are also present. No existing files were removed.
- The server entry point imports the Hono application. Before changes, the OpenAPI client used `/api/...` while the Hono routes lacked that prefix, and Vite had no API proxy.
- Before changes, Skin Analysis sent a base64 data URL to `/predict`; the server returned `model_unavailable`. The upload route was unused by the page. Login used a hardcoded password and `sessionStorage`. Patients, cases, reports, dashboard values, and parts of symptom assessment used fixtures or dead links.
- The existing Drizzle schema already contained users/sessions, patients, cases, uploads, predictions, symptom assessments, reviews, reports, audit events, conversations, and messages. There were no migration files or migration scripts; prediction rows included an `image_base64` field.
- `.env` was absent and ignored by Git. No deployment manifests, CI workflow, test framework, or lint script were present at baseline. The documented API client workflow was `pnpm --filter @workspace/api-spec run codegen`.
- PostgreSQL was available locally, but the credentials for its existing service were unknown. Verification used a separate temporary PostgreSQL 17 cluster on port 55432 and dedicated disposable databases; the existing service and its records were not modified.

### Baseline commands

- `pnpm run typecheck` — passed.
- `pnpm run build` — passed; Vite warned that its generated JavaScript chunk was 587.58 kB, above the 500 kB warning threshold.
- Tests and lint — not available in the baseline.
- Database persistence — not verified in the baseline because migrations and configured credentials were absent.

## Phase 1 implementation checklist

- [x] Align API paths, server entry point, environment loading, frontend proxy, and cookie-based API calls.
- [x] Replace demo authentication with server sessions; protect UI routes and remove client-side session truth.
- [x] Add request IDs, bounded request/upload handling, validation, safe errors, rate limits, and origin checks for state-changing requests.
- [x] Validate and privately store image uploads; associate resources only with owner-authorized cases.
- [x] Make model unavailability explicit; do not return or persist fabricated disease results.
- [x] Add safe Drizzle migrations/setup instructions and owner-scoped service behavior; remove force-push database setup.
- [x] Replace mock Patients, Cases, Reports, dashboard metrics, and symptom flows with API-backed state and honest loading/empty/error states.
- [x] Add API, security, persistence, and frontend integration checks; verify against an isolated PostgreSQL database.
- [x] Regenerate API clients from OpenAPI and run typecheck, build, and test gates.

### Gate 1 verification — 2026-10-15

- `pnpm --filter @workspace/api-spec run codegen` — passed after updating the OpenAPI contract and generated React Query/Zod clients.
- `pnpm db:migrate` — applied the checked-in baseline and follow-up migration to a newly created isolated database (`medscope_phase1_gate_test`); run a second time to verify repeatability. No user database was migrated.
- `pnpm test` with `DATABASE_URL` set to that isolated database — passed: 2 tests, 0 failures. Coverage includes health/readiness, registration/login/logout and session rotation, non-privileged registration, CSRF origin rejection, user ownership checks, symptom persistence and guidance, image format/signature/size validation, upload ownership, model-unavailable behavior, test-only simulated prediction persistence/history, report/review scoping, and frontend API-hook usage.
- `pnpm run typecheck` — passed across libraries, API, frontend, and seed script.
- `pnpm run build` — passed across workspace packages and Vite. Vite still reports the 588.97 kB JavaScript bundle (176.19 kB gzip) as larger than its 500 kB warning threshold.
- `pnpm --filter @workspace/api-server start` — started successfully after correcting the start script to run the TypeScript entry point with `tsx`. Live `GET /api/healthz` returned 200; `GET /api/readyz` returned 200 with database connected and model unavailable.
- Vite frontend smoke on port 3054 — root returned 200 and `/api/healthz` proxied to the API with 200. Through that proxy, registration returned 201, patient/case creation each returned 201, and subsequent patient/case list reads contained those persisted records.
- The fictional development seed was run twice against its own loopback-only disposable database; verification found one user, one patient, and one case, with no duplicate rows.
- `webcmd doctor` failed its browser connectivity preflight twice (8-second browser-exec timeout), so no GUI browser result is claimed. The API/frontend HTTP smoke above is separate evidence. The repository still has no lint script or browser automation suite.

**Gate 1 decision:** Pass for the API, database, authentication/authorization, private uploads, model-unavailable behavior, and key frontend-to-API persistence flows. The browser GUI check remains an environment blocker; it is recorded above and does not replace the passing API/database and live proxy checks. The model remains unavailable by design. No dataset was researched or downloaded before this gate.

### Remaining Phase 1 limitations

- Local disk storage is private and appropriate for single-host development; S3-compatible storage is not implemented.
- Rate limits are per process and do not coordinate across multiple replicas.
- Retention automation and account-wide deletion are not implemented. Upload deletion is restricted when linked to predictions.
- Review routes require a privileged role, but clinician identity verification and assignment are not implemented.
- There is no lint script or automated browser suite. Production bundle-size warning remains.

## Phase 2: dataset provenance and Skin Analysis training

- [x] Research official dataset records, papers, dataset-specific licenses, access requirements, image/label counts, and identifier/subgroup limitations before download. The selection and screened alternatives are documented in [`research/datasets.md`](research/datasets.md) and [`research/research-register.md`](research/research-register.md).
- [x] Download PAD-UFES-20 v1 only after confirming its dataset record's CC BY 4.0 terms; record retrieval time, size, and archive SHA-256. Keep the archive, extracted images, model weights, and patient-linked split manifest in ignored local directories.
- [x] Add a separate CPU-capable Python package with pinned dependencies, Windows setup instructions, safe outer/nested ZIP extraction, metadata/image validation, label mapping, exact-duplicate handling, deterministic preprocessing, patient/lesion/hash-grouped splits, class-weighted training, early stopping, evaluation, and model manifest/checksum verification.
- [x] Test with generated synthetic pixels only; tests cover class/split checks, conflict-label duplicate exclusion, nested ZIP extraction, traversal rejection, deterministic preprocessing, model output shape, metric calculations, training smoke, artifact/checksum rejection, and archive provenance validation.
- [x] Validate the real PAD-UFES-20 v1 archive: all 2,298 metadata rows matched PNG files and source class counts. Exclude 24 rows from 12 exact-hash groups whose labels conflict; retain same-label duplicate groups and keep them within a split.
- [x] Train a CPU baseline and record held-out metrics, limitations, score semantics, subgroup summaries, and artifact identity in [`research/training-baseline.md`](research/training-baseline.md).

### Phase 2 commands and results

- `ml/skin/.venv/Scripts/python.exe -m unittest discover -s ml/skin/tests -v` — passed: 9 tests, 0 failures.
- `python -m medscope_skin download --accept-license` — completed after license review; 3,593,344,681 bytes, SHA-256 `e8c7e17bac1698c97e44d4096ec20ac1b91c135285c1446b7b2e7ebbc9be933c`.
- `python -m medscope_skin extract` — passed; validated and expanded the three nested image ZIP files into ignored `data/raw/`.
- `python -m medscope_skin validate` — passed; 2,298 source rows, 2,274 eligible rows after deterministic conflict-group exclusion, all six classes remain.
- `python -m medscope_skin train --run-id pad-ufes20-v1-cnn-baseline-20261015` — completed on CPU; best epoch 4, early stopped after epoch 7. Held-out test has 453 images. Accuracy 0.245, macro-F1 0.229, top-2 accuracy 0.506. Per-class metrics and limitations are in the training report.
- `python -m medscope_skin verify-manifest outputs/ml/skin/pad-ufes20-v1-cnn-baseline-20261015/manifest.json` — passed checksum, task/label/preprocessing checks, and safe checkpoint smoke test (finite `(1, 6)` output). Artifact SHA-256: `2b7b8036e104adca0db1ee7390f647bfc5f29026f1837170487e0f46c78390ea`.
- The same verification command with `--require-approved` — rejected as expected: `Model is not approved for inference.` The checkpoint is marked `research_only_not_approved`; its measured performance does not justify application activation.

**Gate 2 decision:** Pass for dataset provenance, reproducible training/evaluation, artifact integrity, and held-out report verification. The artifact is **not promoted or approved**. Phase 3 optional provider work may proceed; Phase 4 must retain fail-closed model-unavailable behavior unless a later task-specific readiness/promotion review supports activation.

## Phase 3: optional provider integrations

- [x] Verify current official provider APIs, model IDs, structured-output support, and data-retention terms before implementing adapters. The source register and limits are in [providers.md](providers.md).
- [x] Add server-side allowlisted adapters for OpenAI Responses, Gemini Interactions, and NVIDIA-hosted Chat Completions. Their only supported task is a short educational explanation of an already completed Skin Analysis classifier result.
- [x] Keep provider credentials server-side, default the provider to disabled, require explicit per-request consent and two server-side external-data gates, and send no patient identity, symptoms, or images.
- [x] Bound provider timeouts, retries, concurrency, and route rate; reject non-HTTPS overrides, prevent redirects, validate structured output locally, and redact provider response bodies/credentials from errors and logs.
- [x] Update OpenAPI and regenerate generated React Query/Zod clients. The API returns classifier output separately from ephemeral provider text and does not persist provider explanations.
- [x] Keep the route fail-closed while no approved model exists. No live provider credentials or external calls were used.

### Phase 3 commands and results

- **pnpm --filter @workspace/api-spec run codegen** — passed; OpenAPI converted to generated React Query and Zod clients.
- **pnpm --filter @workspace/api-server exec tsx --test test/providers.test.ts** — passed: 8 provider tests, 0 failures. Mocks covered all three API shapes, strict output validation, timeout, bounded 429 retries, provider outage, invalid credentials, redaction, invalid classifier input, response-size cap, and concurrency.
- **pnpm db:migrate** with a fresh PostgreSQL 17 database (**medscope_phase3_gate_test** on the disposable loopback-only cluster, port 55433) — passed on the clean database and passed a repeat run. Existing migrations required no schema changes for this phase.
- **pnpm test** with that isolated DATABASE_URL — passed: 10 tests, 0 failures. Includes API session/ownership/persistence tests and confirms unauthenticated, cross-user, no-consent, simulated, and unapproved-model explanation requests are rejected.
- **pnpm run typecheck** — passed across libraries, API server, frontend, and seed script.
- **pnpm run build** — passed across workspace packages and Vite. Existing large-bundle warning remains (588.97 kB JavaScript, 176.19 kB gzip).

**Gate 3 decision:** Pass for provider adapters, configuration, privacy gates, OpenAPI alignment, and mocked provider/API regression coverage. This does not enable provider calls: the production model check remains false and the current checkpoint is not approved. No external service was contacted.

## Phase 4: model inference integration

**Gate 4 status:** Blocked before model activation. The actual checkpoint passed checksum, task, label-order, preprocessing, and safe tensor-load verification, but **verify-manifest --require-approved** rejects it because its readiness state is **research_only_not_approved**. Its held-out performance and subgroup evidence are recorded in [research/training-baseline.md](research/training-baseline.md); no promotion decision has been made. The API returns **model_unavailable**, and the explanation route checks the approved-model condition before any provider call. Do not relabel or activate this checkpoint to pass the gate.

The safe interfaces, unavailable response, manifest verifier, and tests are in place. Do not proceed with production inference, display its scores, or begin Phase 5's inference-dependent release gate until a separately reviewed and genuinely approved artifact is available. Any later model tuning must leave the existing held-out test set untouched and use a fresh holdout for final evaluation.

## Later phase gates

- Phase 3 is complete; provider adapters support only documented educational explanations and remain gated off while there is no approved classifier.
- Phase 4 remains blocked by model promotion readiness. The current real checkpoint is verified but not approved, so it cannot serve user-facing inference.
- Phase 5 release hardening remains pending its earlier gates.
- This is an educational/research prototype. No clinical validation, regulatory compliance, or real-world diagnostic performance is claimed.

## Phase 6: multimodal report analysis and cardiac status

Implemented without adding any new model or fabricating output. The skin classifier and the cardiac module both remain unavailable by design.

### Checklist

- [x] Add `documents`, `document_findings`, and `document_interpretations` tables with a generated, applied Drizzle migration (`0002`).
- [x] Add a local text-extraction pipeline: PDF text layer via `pdfjs-dist`, embedded-image OCR for scanned PDFs, and OCR for uploaded photographs via `tesseract.js`. Text is produced and stored for verification; OCR output is explicitly flagged as error-prone.
- [x] Add a conservative finding extractor for lab results, vitals, qualitative serology/urinalysis, medications, and diagnosis/impression lines. Unreadable characters raise review warnings instead of being guessed. Fixed a real flag-parsing bug so values like `9.2 Low` map to value `9.2` + flag `low` rather than value `9.2 L` + unit `ow`.
- [x] Add owner-scoped document routes: upload with declared-type/signature validation and DICOM rejection, list, detail, download, reprocess, delete, per-finding confirm/correct/reject, and consent-gated interpretation.
- [x] Reuse the existing provider adapters for interpretation, sending only reviewed structured findings. Local validation rejects invented numbers/percentages, unknown findings, and diagnosis/treatment claims; rejected output is never stored.
- [x] Add a status-only cardiac module and route (`GET /api/cardiac/model-status`) that reports the model unavailable and documents the future feature contract (UCI Cleveland subset).
- [x] Add a per-case workspace route and a plain-text draft-report export route.
- [x] Extend OpenAPI, regenerate the React Query/Zod clients, add the Report Analysis and Cardiac pages, extend navigation/routes, and integrate the workspace into the case detail page.
- [x] Add focused unit tests (extraction, document type, interpretation validation) and an end-to-end document lifecycle integration test, plus updated readiness coverage.

### Phase 6 commands and results

- `pnpm --filter @workspace/api-spec run codegen` — passed; OpenAPI converted to generated clients after adding the document, cardiac, workspace, and export paths.
- `pnpm --filter @workspace/api-server test` (with `DATABASE_URL`) — passed: 19 tests, 0 failures. Includes 8 extraction/interpretation unit tests and a document lifecycle test covering upload type/signature rejection, OCR extraction through an injected test provider, per-finding correction, cross-user 404s, no-consent 400, disabled-transfer 503, provider-unavailable 503, successful interpretation with a test double, corrupt-PDF failure, reprocess, workspace composition, and report export.
- `pnpm run typecheck` — passed across libraries, API server, frontend, and seed script.
- `pnpm run build` — passed across workspace packages and Vite. The existing large-bundle warning remains.

**Gate 6 decision:** Pass for report upload/extraction/review, consent-gated interpretation, cardiac status honesty, case workspace, and report export, with local deterministic tests and no live provider, OCR-network, or model calls. No patient data is fabricated and no unavailable model is simulated outside `NODE_ENV=test`.

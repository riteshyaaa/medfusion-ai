# MedScope AI — Full Project Report

Final-year project report covering the complete build, from repository baseline to the Phase 7 cardiac assessment upgrade. Written for submission and viva review: every claim below is backed by a recorded command and result in `docs/implementation-checklist.md`, and every limitation is stated rather than hidden.

Repository: `https://github.com/riteshyaaa/medfusion-ai` (branch `main`).
Baseline discovery completed 2026-10-15; Phases 1–7 implemented and verified in this repository state.

---

## 1. Objectives

MedScope AI is a **medical-information research prototype**, deliberately not a diagnostic product. The project set out to demonstrate that a health tool can be built the honest way:

1. **Fail closed, never fabricate.** When a model is missing, unapproved, or fails a self-check, the system says so and serves nothing — it never invents a prediction.
2. **Separate three things that are easy to conflate:**
   - **Artifact integrity** — is the model file verifiable and contract-compatible?
   - **Operating permission** — has an operator explicitly enabled this model to serve? (`CARDIAC_RESEARCH_INFERENCE_ENABLED` for cardiac research serving.)
   - **Clinical approval** — has this model been reviewed and approved for real clinical use? This remains hard-coded `false` (`hasApprovedCardiacModel()`); nothing in the codebase can flip it from configuration.
3. **Present uncertainty honestly.** Raw model scores are labelled uncalibrated mathematical outputs, never "probability of disease". Thresholds are labelled engineering defaults, not clinical boundaries. Feature contributions are labelled mathematical weights, not causal evidence.
4. **Consent-gated AI, minimal payloads.** Any external AI provider call requires explicit per-request consent plus server-side data-transfer approval, sends no patient identifiers, and never persists rejected provider output.
5. **Human-safety edges beat models.** A deterministic urgent-symptom screen (e.g. chest pain with fainting) bypasses any model and cannot be overridden by a score.
6. **Reproducibility.** Models are checksummed; the training pipeline re-derives the committed artifact byte-for-byte; migrations are additive and verified repeatable on disposable databases.
7. **Provenance discipline.** Datasets are only downloaded after licence review; every dataset has a license, SHA-256 retrieval record, and documented subgroup/identifier limitations.

---

## 2. Architecture

A modular monolith with one OpenAPI contract driving generated clients:

| Component | Technology | Role |
|---|---|---|
| `artifacts/skin-ai` | React 18, TypeScript 5.9, Vite | Frontend (Skin Analysis, Symptom Assessment, Report Analysis, Cardiac Assessment, Patients, Cases, Reports) |
| `artifacts/api-server` | Hono (TypeScript) | HTTP API, gates, exports, integration tests |
| `lib/api-spec` | OpenAPI 3.1 | Single source of truth for the API contract |
| `lib/api-client-react` / `lib/api-zod` | Orval-generated | React Query hooks + Zod validation, regenerated after every contract change |
| `lib/db` | Drizzle ORM, PostgreSQL | Schema + additive migrations (`0002`–`0009`) |
| `ml/skin`, `ml/cardiac` | Python (pinned venv) | Reproducible training pipelines |
| `models/registry` | Checksummed artifacts | Skin CNN + cardiac logistic-regression bundles with manifests and self-check fixtures |

Flow: browser → Vite same-origin `/api` proxy → Hono → PostgreSQL; every route enforces owner-scoping, validation, rate limits, request IDs, and audit events.

---

## 3. What was built, phase by phase

### Phase 0 — Baseline discovery (2026-10-15)
Found a frontend demo with client-side fixtures, a `model_unavailable` placeholder endpoint, no migrations, no tests, no CI, and hardcoded auth. Documented in `docs/implementation-checklist.md`.

### Phase 1 — Application foundation
- Aligned API paths (`/api/...`), Vite proxy, cookie-based sessions; replaced client-side session truth with server sessions.
- Added request IDs, bounded request/upload handling, safe error handling, rate limits, CSRF origin checks.
- Private image-upload storage with format/signature/size validation and ownership checks.
- Drizzle migrations replacing the old force-push database setup; owner-scoped services.
- Honest `model_unavailable` behaviour — no fabricated results, ever.
- Verified on an isolated disposable database (`medscope_phase1_gate_test`); live proxy smoke test passed (registration, patient/case persistence).

### Phase 2 — Dataset provenance and first training run
- Selected PAD-UFES-20 v1 after licence review (CC BY 4.0); archive recorded at 3,593,344,681 bytes, SHA-256 `e8c7e17bac…`.
- CPU training pipeline with safe nested-ZIP extraction, conflict-label duplicate exclusion (24 rows excluded across 12 exact-hash groups), patient-grouped splits, deterministic preprocessing.
- Scratch-CNN held-out baseline: test accuracy **24.5%**, macro-F1 0.229 — recorded honestly and, because the artifact is `research_only_not_approved`, verification with `--require-approved` correctly rejected it.

### Skin-model accuracy work (intermediate iterations)
Documented in `docs/research/skin-accuracy-report.md` — a quantified progression from scratch CNN to transfer learning:

| Model | Transfer learning | Test accuracy | Test macro-F1 |
|---|---|---|---|
| Scratch compact CNN | No | 24.5% | 0.229 |
| MobileNetV2 frozen backbone | Yes (ImageNet) | 53.4% | 0.457 |
| **MobileNetV2 full fine-tune (deployed)** | Yes (ImageNet) | **58.1%** | **0.526** |

Top-2 accuracy of the final model: **84.1%**. Serving preserves the honesty line: uncalibrated confidence is hidden for screened-out/rejected images, ranking display is capped, and abstention behaviour is documented (e.g. at raw score ≥ 0.6, accuracy among accepted images rises to 69.8% on 64.2% coverage). The model is still not clinically approved.

### Phase 3 — Optional AI provider integrations
- Server-side allowlisted adapters for OpenAI, Gemini, and NVIDIA-hosted models; only documented educational-explanation tasks.
- Credentials server-side only; per-request consent + two server-side transfer gates; no identifiers/symptoms/images sent; timeouts, bounded retries, concurrency limit, output validation and redaction; fail-closed while no approved model exists. Verified with mocked-HTTP tests only — no external calls.

### Phase 4 — Inference integration (blocked gate)
The actual checkpoint passes checksum/task/label-order/preprocessing/tensor-load verification, but `--require-approved` rejects it, so the API stays `model_unavailable`. This is the discipline point of the project: the gate blocks a *real but unapproved* model rather than activating it.

### Symptom Assessment upgrade
Rebuilt as a **deterministic-first engine** (`docs/research/symptom-assessment.md`): adaptive follow-up questions, negation-aware rules, urgent inputs bypass the provider entirely, and one optional structured AI evaluation runs per assessment with per-request consent — recorded completed or failed, always alongside the rule-based guidance, and never replacing it.

### Phase 6 — Multimodal report analysis + cardiac status
- Local text extraction: PDF text layer (`pdfjs-dist`), OCR for scans/photos (`tesseract.js`) — OCR output explicitly flagged error-prone.
- Conservative finding extractor (labs, vitals, serology, medications, diagnoses) with review warnings instead of guesses; per-finding confirm/correct/reject by the user; consent-gated interpretation sending only reviewed findings; used findings only after review.
- Case workspace and plain-text report export.

### Phase 6.1 — Report Analysis correctness
- Locale-safe decimal parsing, thousands separators, scientific notation, inequality values kept verbatim (`<60`), multi-word negation, conservative flag derivation (never invents `normal`).
- Reprocessing preserves human review via normalized-label re-matching (migration `0008`, additive).
- Failed interpretations persisted with error codes + prompt version (`document-interpretation-v2`); narrative documents (e.g. radiology text) interpretable from ≥200 chars of text with a stricter invention validator.
- Trend comparison across documents by normalized label + identical unit only (no conversion); PDF export via a dependency-free writer.

### Phase 7 — Advanced Cardiac Assessment (final phase)
The largest upgrade; full detail in `docs/implementation-checklist.md` §Phase 7.

- **Research-serving gate** (`artifacts/api-server/src/cardiac.ts`): serving is disabled unless `CARDIAC_RESEARCH_INFERENCE_ENABLED` is exactly `"true"`; distinct truthful notices for disabled vs. artifact-unavailable; `researchServing` block reported fresh on the model-status route.
- **Serving self-check**: per load, `test-fixtures.json` checksum verification plus a pinned two-fixture inference replay through the real serving path with python-scale tolerance; any mismatch fails closed.
- **Trained cardiac baseline** (`ml/cardiac/train.py`): logistic regression on the UCI Cleveland subset (1988; 297 usable records, 13 features). Committed artifact `medicalscope-cardiac` bundle sha256 `3efde198…` is reproduced **byte-for-byte** by the training pipeline. Held-out val ROC-AUC 0.911; cross-validation evidence added this phase: mean ROC-AUC **0.920 ± 0.028**, mean sensitivity 0.811, per-fold false negatives [5,6,2,5,4].
- **Migration `0009`** (additive, verified twice on an isolated disposable database then dropped): `measurement_source`, `contextual_factors`, and the `cardiac_ai_explanations` table.
- **Safety-first workflow**: urgent-symptom checkboxes bypass the model entirely; questionnaire requires an exact-value review step; results dashboard separates model output, user-entered values, and AI text, and states threshold provenance, uncalibrated semantics, limitations, and the research-only notice.
- **Longitudinal history**: saved-input inspection, changed-input comparison — refused across incompatible model versions (enforced server-side) — and recorded-value trends without interpretation.
- **Consent-gated AI explanations** extending the existing provider stack: dedicated prompt + schema; provider failures persist as failed rows with error codes; explanations never alter the saved score.
- **Printable exports** (`.txt`/`.pdf`, owner-scoped, audited) containing score semantics, provenance, limitations, contextual info, urgent notice, and AI explanation labelled separately.
- **Tests at end of project: 97/97 passing**, including 13 cardiac unit tests (gate states, tampered-artifact rejection, pinned-fixture self-check) and integration tests covering gates, urgent bypass, ownership, failures, and exports.

---

## 4. Verification summary

Every phase ended with recorded gate commands; latest full-verification sweep (end of Phase 7):

| Check | Result |
|---|---|
| API test suite (`npx tsx --test test/*.test.ts`, isolated `DATABASE_URL`) | **97 tests, 0 failures** |
| Full workspace typecheck (`pnpm run typecheck`) | pass |
| Frontend typecheck + production build (`pnpm --filter @workspace/skin-ai …`) | pass (existing ~589 kB bundle-size warning remains) |
| OpenAPI → generated clients (orval codegen + Zod build) | clean |
| Migration `0009` on isolated DB (`scripts/cardiac-migration-verify.mjs`) | applied, re-applied, verified, dropped |
| Skin training unit tests | pass |
| Cardiac training reproduction | byte-for-byte identical bundle |
| Live provider / browser-automation / PDF pixel checks | **not claimed** — no such runs were performed; documented as environment limitations |

---

## 5. Limitations (full disclosure)

Product-level:
- No clinical validation, no regulatory approval, no HIPAA/GDPR/DPDP compliance claim, no differential diagnosis; nothing here replaces professional evaluation.
- Skin classifier: 58.1% six-class accuracy from ~2,300 smartphone images — plausible for small datasets but far below clinical use; confidence is uncalibrated; the model remains `research_only_not_approved` and inference stays unavailable until an authorized artifact exists.
- Cardiac model: 1988 Cleveland cohort; uncalibrated scores; threshold 0.5 is an engineering default; low test sensitivity for MIs (0.571) is documented rather than tuned away; CV evidence is not clinical validation.
- AI explanations: mock-provider-tested only; production text can be wrong and is labelled educational/does not alter assessments; consent text is detailed but not legally reviewed.
- Exports/PDF: content verified textually; no pixel-level PDF visual verification performed.
- Infrastructure: single-host private storage, in-memory per-process rate limits, no retention/deletion automation, no lint script or browser-automation suite, bundle-size warning outstanding.

Process-level:
- Verification is API/database/HTTP-based; no GUI browser GUI claim (a headless preflight was attempted once and failed its timeout — recorded, not hidden).
- Phase 5 (release hardening/incident process) remains open pending earlier gates.

---

## 6. Artifact identities

| Artifact | Identity |
|---|---|
| Skin checkpoint | SHA-256 `2b7b8036e104adca0db1ee7390f647bfc5f29026f1837170487e0f46c78390ea`, state `research_only_not_approved` |
| PAD-UFES-20 archive | 3,593,344,681 bytes, SHA-256 `e8c7e17bac1698c97e44d4096ec20ac1b91c135285c1446b7b2e7ebbc9be933c` |
| Cardiac bundle | SHA-256 prefix `3efde198…` (byte-for-byte reproducible via `ml/cardiac/train.py`) |
| Cardiac self-check fixtures | `test-fixtures.json`, checksum recorded in the bundle manifest, replayed in-server per load |
| Interpretation prompt | `document-interpretation-v2` |
| Explanation prompt | `cardiac-explanation-v1` |

---

## 7. Viva talking points

1. **Why is "fail closed" the design centre instead of a fallback?** A health tool that guesses when unsure is worse than one that says unavailable — every unavailable path in MedScope explains *why* it is unavailable and what would change that.
2. **How do you distinguish an honest score from a probability?** Calibration analysis (Brier 0.111, ECE 0.137) shows the raw logistic output is mis-calibrated — so it is never labelled a probability, and UI copy repeats that on every surface.

3. **What stops an AI provider from inventing medical numbers?** A validator that pins generated numbers to the supplied text, rejects unknown findings, rejects diagnosis/treatment claims, and never persists rejected output.

4. **Why is the cardiac model disabled by default even though the artifact is verified?** Artifact integrity, operator permission, and clinical approval are three different questions kept separate by construction; only integrity is ever automatic.

5. **How would you take this from research to (hypothetical) approval?** A separate evaluation cohort, calibration mapping, external review → artifact approval flip → only then does serving permission become relevant at all — the code path makes this ordering impossible to shortcut.

---

*Prepared from the complete implementation record in `docs/implementation-checklist.md`; all commands cited above were run and their outputs recorded during the project.*

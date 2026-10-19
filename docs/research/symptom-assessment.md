# Symptom Assessment Architecture

This document describes how symptom assessment works in MedScope AI after the
upgrade to a single-pipeline, deterministic-first assessment engine. It covers
what happens for each submission, what data is (and is not) sent to an external
AI provider, where the rule content comes from, and what the system can and
cannot do.

## Design goals

1. **Safety first, AI optional.** Urgency classification and safety guidance are
   computed deterministically by a transparent, versioned rule set on every
   submission — including emergency inputs — and never depend on, wait for, or
   get overwritten by an external AI model.
2. **One pipeline.** Submission, follow-up answers, and re-evaluation all go
   through one orchestrator and one persistence path. There is no second,
   parallel AI analysis route.
3. **Never fabricate.** A failed or unavailable AI evaluation is recorded and
   shown as failed, with an error code, while the deterministic assessment
   remains fully usable. The API never substitutes invented content.
4. **Consent and locality.** No PHI leaves the server without an explicit
   per-request consent flag AND both server-side approval switches
   (`AI_DATA_SHARING_ENABLED`, `AI_HEALTH_DATA_TRANSFER_APPROVED`).
5. **Deterministic urgency independence.** Urgent and emergency inputs skip the
   provider call entirely (`skipped_urgent`) and use the rule-derived
   `urgencyLevel`. A model output can never downgrade — or need to be trusted
   for — an urgent or emergency result.

## Request flow (POST /api/symptom-assessments)

```
request
  -> validate schema (CreateSymptomAssessmentRequest, rate-limited)
  -> normalizeSymptomAssessmentInput (input schema symptom-input-v2)
       trims/dedupes lists, canonicalizes selected symptoms against the
       classifier catalogue, drops whitespace-only tokens, preserves free-text
       (duration, notes) verbatim
  -> ownership check (caseId belongs to user)
  -> adaptive questionnaire validation
       every submitted questionnaireAnswers row is validated against the
       versioned catalogue (unknown/duplicate/auto-inferred question ids are
       rejected with 400); unknown answers are never treated as negative
  -> classifier warm-up ( awaited; cannot fail the request )
  -> assessSymptomGuidance (rule set symptom-rules-v2)
       curated entries + combo rules + questionnaire evidence tokens +
       questionnaire escalations -> urgencyLevel + red flags + guidance
  -> urgencyStateFor(urgencyLevel, classifier status)
       "needs_more_information" when routine but the local classifier did not
       classify; otherwise routine/urgent_guidance/emergency_guidance-style
       states
  -> assessment row persisted FIRST (always saved, independent of AI outcome)
  -> decideSymptomAiProcessing
       urgent | emergency  -> skipped_urgent (no provider call, ever)
       no consent          -> not_requested
       approvals off       -> unavailable (external_processing_disabled)
       provider unset/test -> unavailable (provider_unavailable)
       otherwise           -> attempt
  -> on attempt: single callNemotron("symptom evaluation",
       prompt version symptom-eval-v2) with one malformed-retry inside the
       provider layer, bounded by AI_REQUEST_TIMEOUT_MS / AI_MAX_RETRIES
       completed -> evaluation row + classification.aiAssessment snapshot
       failed    -> evaluation row (status failed, errorCode) + honest
                    classification.aiAssessment snapshot
  -> later GETs of the assessment or its evaluations re-read persisted data:
       no provider call on any later GET
```

The response always returns HTTP 201 with `assessment` and `urgencyState`, plus
`aiStatus` (`completed | failed | unavailable | skipped_urgent | not_requested`),
optional `aiErrorCode` / `aiMessage`, and the `evaluation` when one exists.

## Data actually sent to the AI provider

For a consented, non-urgent submission the provider receives a
symptom-description payload: primary symptom text, category, optional
onset/duration/severity/progression, associated and selected symptoms, medical
history / medications / allergies lists, the new structured fields (age group,
previous episodes, factors that help/worsen, optional additional notes), and a
compact questionnaire summary line (id=matched/answer triplets). The prompt
instructs the model to treat user text as data (not instructions), to limit
itself to the provided facts, to state insufficiency explicitly, and never to
assign urgency scores, citations, or a diagnosis. The model may propose
considerations for research reading only; urgency context is reported back to
the user as "educational context", while the displayed urgency decision
remains the rule-based one.

## Sources of the rule content

- `artifacts/api-server/src/symptom-guidance.ts` — curated symptom entries
  (aliases, base urgency, guidance, watch-for, seek-care-if), combo rules
  (e.g. chest pain + breathlessness -> emergency), severity/progression floors,
  and questionnaire escalation merging. Version:
  `SYMPTOM_RULE_SET_VERSION = "symptom-rules-v2"`.
- `artifacts/api-server/src/symptom-questions.ts` — versioned follow-up
  catalogue `symptom-followups-v1`; 16 questions with trigger/category
  matching, `yes/no/unknown` and choice (with "not sure") answers; selection
  (max 6, answers excluded), server-side validation, and application to
  evidence + escalations (escalations can only raise urgency; they never
  soften an emergency).
- The local symptom classifier (`symptom-classifier.ts`, Bernoulli
  naive-Bayes `symptom-bernoulli-nb`) contributes the completed/insufficient
  status used by `urgencyStateFor` and possible-condition associations, but it
  does not set urgency.

## Limitations

- The rule set is a curated, text-matching heuristic. Its alias vocabulary has
  been expanded with common everyday phrasings (for example "struggling to
  breathe", "coughing up blood", "want to die", "hurts to pee", "swollen
  ankles", "heavy chest"), and `aliasOverrides` maps conversational wordings
  onto catalogue aliases. Vocabulary outside the alias list is still not
  flagged; the set is a safety floor, not a diagnostic instrument.
- **Negation handling:** free-text matching is negation-aware. When a
  negation cue (`no`, `not`, `denies`, `never`, `without`, `can't`, …) appears
  within two words and the same clause before a matched phrase, that phrase is
  suppressed; clause boundaries reset at `but`/`however`/punctuation so a
  later real symptom is unaffected, and phrases that legitimately begin with
  "no" (for example "no urine since morning") are treated as symptoms, not
  negations. Negation applied after a phrase ("pain in chest now gone") is not
  interpreted — the safe direction is to err toward flagging.
- The AI evaluation is an educational explanation of the user's own report by
  an external general-purpose model. Bot boilerplate such as the disclaimer is
  no longer requested from the model (it was observed emitting unquoted prose
  in that field, which broke structured parsing); the application adds the
  disclaimer itself to the saved record. Remaining malformed output still
  surfaces honestly as a `failed` evaluation with an error code, after one
  built-in provider retry.
- Urgency labels are advisory and conservative-by-design, not a guarantee.
  Nothing in this flow replaces emergency services or a clinician.
- The follow-up questionnaire is additive: unanswered, "unknown", and
  "not sure" responses are never treated as negative findings.

## Versions in force

| Artifact | Version |
| --- | --- |
| Input normalization schema | `symptom-input-v2` |
| Follow-up question set | `symptom-followups-v1` |
| Guidance rule set | `symptom-rules-v2` |
| AI evaluation prompt | `symptom-eval-v3` |

## Tests

- `test/symptom-questions.test.ts` — catalogue_selection/validation/application.
- `test/symptom-guidance.test.ts` — urgency floors, escalations, evidence,
  urgency-state matrix.
- `test/symptom-assessment-service.test.ts` — normalization, AI decision
  matrix, version constants.
- `test/symptom-scenarios.test.ts` — table-driven synthetic scenarios
  (routine, ambiguous, incomplete, urgent combos, severity floor, emergency
  direct, conflicting input, questionnaire effects, warning preservation).
- `test/api.integration.test.ts` — end-to-end: routine flow, urgent skip
  (zero provider calls), provider failure -> 201 with failed evaluation
  persisted, completed flow, ownership (404 cross-account), reopen with no
  provider call, questionnaire validation 400s, follow-up endpoint auth.
- Live smoke: one real consented submission against NVIDIA NEMOTRON
  (`nvidia/nemotron-3.5-super-vl-120b-a12b`) verifying a completed evaluation
  is persisted with provider/model/prompt provenance, and one real urgent
  submission verifying `skipped_urgent` with zero provider calls.

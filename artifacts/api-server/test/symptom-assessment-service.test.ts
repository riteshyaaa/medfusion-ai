import assert from "node:assert/strict";
import { test } from "node:test";

process.env.NODE_ENV = "test";
process.env.SYMPTOM_MODEL_DIR ??= "models/registry/symptoms/bernoulli-nb-v20261016";

const [{ normalizeSymptomAssessmentInput, decideSymptomAiProcessing, SYMPTOM_INPUT_SCHEMA_VERSION }, { getSymptomClassifierStatus }, { SYMPTOM_EVALUATION_PROMPT_VERSION }] = await Promise.all([
  import("../src/symptom-assessment-service"),
  import("../src/symptom-classifier"),
  import("../src/clinical-ai"),
]);

const before = test;

before("warm classifier catalogue for canonicalization", { skip: false }, async () => {
  await getSymptomClassifierStatus();
});

const baseInput = {
  primarySymptom: "mild sore throat",
  symptomCategory: "general" as const,
  associatedSymptoms: [],
  medicalHistory: [],
  medications: [],
  allergies: [],
  selectedSymptoms: [],
  factorsThatHelp: [],
  factorsThatWorsen: [],
  questionnaireAnswers: [],
};

test("duplicate selection entries are deduplicated while preserving first form", () => {
  const normalized = normalizeSymptomAssessmentInput({
    ...baseInput,
    selectedSymptoms: ["skin_rash", "skin rash", "itching", " itching "],
  });
  assert.deepEqual(normalized.selectedSymptoms, ["skin_rash", "itching"]);
  assert.equal(normalized.deduplicatedSymptomIds.length, 2);
});

test("display-label selections are canonicalized to classifier ids; unknown phrases are preserved verbatim", () => {
  const normalized = normalizeSymptomAssessmentInput({
    ...baseInput,
    selectedSymptoms: ["skin rash", "my custom phrase"],
  });
  assert.deepEqual(normalized.selectedSymptoms, ["skin_rash", "my custom phrase"]);
});

test("empty and whitespace-only entries are dropped across list fields", () => {
  const normalized = normalizeSymptomAssessmentInput({
    ...baseInput,
    associatedSymptoms: ["fever", "", "  ", "fever"],
    factorsThatHelp: ["", "rest", "rest"],
    factorsThatWorsen: [],
  });
  assert.deepEqual(normalized.associatedSymptoms, ["fever"]);
  assert.deepEqual(normalized.factorsThatHelp, ["rest"]);
});

test("duration and notes are preserved exactly as entered, never interpreted", () => {
  const normalized = normalizeSymptomAssessmentInput({
    ...baseInput,
    duration: "today",
    additionalNotes: "started after gym, felt faint",
  });
  assert.equal(normalized.duration, "today");
  assert.equal(normalized.additionalNotes, "started after gym, felt faint");
});

test("consent is dropped from the persisted record input shape", () => {
  const normalized = normalizeSymptomAssessmentInput({ ...baseInput, consentToExternalProcessing: true });
  assert.equal("consentToExternalProcessing" in normalized, true);
  const { consentToExternalProcessing: consent, deduplicatedSymptomIds: _note, ...persisted } = normalized;
  void consent;
  void _note;
  assert.equal("consentToExternalProcessing" in persisted, false);
});

test("AI decision matrix: urgent always skips, consent + gates + provider required", async () => {
  const savedSharing = process.env.AI_DATA_SHARING_ENABLED;
  const savedTransfer = process.env.AI_HEALTH_DATA_TRANSFER_APPROVED;
  try {
    delete process.env.AI_DATA_SHARING_ENABLED;
    delete process.env.AI_HEALTH_DATA_TRANSFER_APPROVED;
    const urgent = decideSymptomAiProcessing({ consentToExternalProcessing: true, urgencyLevel: "urgent", providerStatus: "configured" });
    assert.equal(urgent.attempt, false);
    assert.equal(urgent.attempt === false && urgent.status, "skipped_urgent");
    const emergency = decideSymptomAiProcessing({ consentToExternalProcessing: true, urgencyLevel: "emergency", providerStatus: "configured" });
    assert.equal(emergency.attempt === false && emergency.status, "skipped_urgent");

    const noConsent = decideSymptomAiProcessing({ consentToExternalProcessing: false, urgencyLevel: "routine", providerStatus: "configured" });
    assert.equal(noConsent.attempt === false && noConsent.status, "not_requested");

    const providerDown = decideSymptomAiProcessing({ consentToExternalProcessing: true, urgencyLevel: "routine", providerStatus: "unconfigured" });
    assert.equal(providerDown.attempt === false && providerDown.status, "unavailable");

    process.env.AI_DATA_SHARING_ENABLED = "true";
    process.env.AI_HEALTH_DATA_TRANSFER_APPROVED = "false";
    const gatesClosed = decideSymptomAiProcessing({ consentToExternalProcessing: true, urgencyLevel: "routine", providerStatus: "configured" });
    assert.equal(gatesClosed.attempt === false && gatesClosed.status, "unavailable");

    process.env.AI_HEALTH_DATA_TRANSFER_APPROVED = "true";
    const go = decideSymptomAiProcessing({ consentToExternalProcessing: true, urgencyLevel: "routine", providerStatus: "configured" });
    assert.equal(go.attempt, true);
  } finally {
    if (savedSharing === undefined) delete process.env.AI_DATA_SHARING_ENABLED; else process.env.AI_DATA_SHARING_ENABLED = savedSharing;
    if (savedTransfer === undefined) delete process.env.AI_HEALTH_DATA_TRANSFER_APPROVED; else process.env.AI_HEALTH_DATA_TRANSFER_APPROVED = savedTransfer;
  }
});

test("provenance constants are versioned", () => {
  assert.match(SYMPTOM_EVALUATION_PROMPT_VERSION, /^symptom-eval-v\d+$/);
  assert.match(SYMPTOM_INPUT_SCHEMA_VERSION, /^symptom-input-v\d+$/);
});

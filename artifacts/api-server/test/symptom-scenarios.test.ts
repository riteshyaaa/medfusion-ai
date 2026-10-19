import assert from "node:assert/strict";
import { test } from "node:test";

import { assessSymptomGuidance, urgencyStateFor } from "../src/symptom-guidance";
import { applyFollowUpAnswers, type FollowUpEscalation } from "../src/symptom-questions";
import { normalizeSymptomAssessmentInput, type SymptomCategoryName } from "../src/symptom-assessment-service";
import { SYMPTOM_EVALUATION_PROMPT_VERSION, symptomEvaluationSchema } from "../src/clinical-ai";

interface GuidanceInput {
  primarySymptom: string;
  symptomCategory: SymptomCategoryName;
  severity?: "mild" | "moderate" | "severe";
  onset?: string;
  duration?: string;
  progression?: "improving" | "stable" | "worsening" | "fluctuating";
  associatedSymptoms: string[];
  selectedSymptoms: string[];
  followUpEvidence?: string[];
  followUpEscalations?: FollowUpEscalation[];
}

test("synthetic scenario matrix: rule urgency and red flags stay deterministic", async () => {
  const { FOLLOW_UP_QUESTION_SET_VERSION } = await import("../src/symptom-questions");
  assert.equal(FOLLOW_UP_QUESTION_SET_VERSION, "symptom-followups-v1");

  const caseInputs: Array<{
    name: string;
    normalize: GuidanceInput;
    questionnaire?: Array<{ questionId: string; answer: string }>;
    expectUrgency: "routine" | "urgent" | "emergency";
    expectFlagAtLeast: string[];
    expectClassifierDependentState?: "needs_more_information";
  }> = [
    {
      name: "routine_incomplete",
      normalize: { primarySymptom: "   ", symptomCategory: "other", associatedSymptoms: [], selectedSymptoms: [] },
      expectUrgency: "routine",
      expectFlagAtLeast: [],
    },
    {
      name: "ambiguous_other",
      normalize: { primarySymptom: "feeling off this week", symptomCategory: "other", associatedSymptoms: [], selectedSymptoms: [] },
      expectUrgency: "routine",
      expectFlagAtLeast: [],
    },
    {
      name: "routine_mild",
      normalize: { primarySymptom: "mild sore throat", symptomCategory: "respiratory", associatedSymptoms: [], selectedSymptoms: ["sore throat"] },
      expectUrgency: "routine",
      expectFlagAtLeast: [],
    },
    {
      name: "urgent_combo",
      normalize: { primarySymptom: "light fever", symptomCategory: "general", associatedSymptoms: ["skin rash"], selectedSymptoms: [] },
      expectUrgency: "urgent",
      expectFlagAtLeast: ["fever with rash"],
    },
    {
      name: "severity_severe_floors_to_urgent",
      normalize: { primarySymptom: "tiredness", symptomCategory: "other", severity: "severe", associatedSymptoms: [], selectedSymptoms: [] },
      expectUrgency: "urgent",
      expectFlagAtLeast: [],
    },
    {
      name: "emergency_direct",
      normalize: { primarySymptom: "heavy chest pain", symptomCategory: "cardiovascular", severity: "moderate", associatedSymptoms: [], selectedSymptoms: [] },
      expectUrgency: "emergency",
      expectFlagAtLeast: ["chest pain"],
    },
    {
      name: "conflicting_model_would_disagree_rules_win",
      normalize: { primarySymptom: "strong back pain", symptomCategory: "musculoskeletal", severity: "severe", associatedSymptoms: ["ongoing vomiting"], selectedSymptoms: [] },
      expectUrgency: "urgent",
      expectFlagAtLeast: [],
    },
    {
      name: "questionnaire_negative_evidence_does_not_raise",
      normalize: { primarySymptom: "light cough", symptomCategory: "respiratory", associatedSymptoms: [], selectedSymptoms: [] },
      questionnaire: [{ questionId: "cough_blood", answer: "no" }],
      expectUrgency: "routine",
      expectFlagAtLeast: [],
    },
    {
      name: "questionnaire_yes_evidence_matches_emergency_rule",
      normalize: { primarySymptom: "headache", symptomCategory: "neurological", associatedSymptoms: [], selectedSymptoms: [] },
      questionnaire: [{ questionId: "headache_worst_ever", answer: "yes" }],
      expectUrgency: "emergency",
      expectFlagAtLeast: ["severe headache"],
    },
    {
      name: "warning_preservation_escalation_cannot_upgrade_emergency_down_nor_routine_up_wrongly",
      normalize: {
        primarySymptom: "coughing blood",
        symptomCategory: "respiratory",
        associatedSymptoms: [],
        selectedSymptoms: [],
        followUpEscalations: [{ flagLabel: "coughing up blood", guidance: ["Seek urgent care now, but emergency care comes first for the reported bleeding."], urgency: "urgent" }],
      },
      expectUrgency: "emergency",
      expectFlagAtLeast: ["uncontrolled bleeding"],
    },
  ];

  for (const scenario of caseInputs) {
    const normalized = normalizeSymptomAssessmentInput({
      medicalHistory: [],
      medications: [],
      allergies: [],
      factorsThatHelp: [],
      factorsThatWorsen: [],
      questionnaireAnswers: scenario.questionnaire ?? [],
      ...scenario.normalize,
    });
    assert.ok(
      normalized.associatedSymptoms.every((s) => s.length > 0),
      `${scenario.name}: no whitespace-only tokens survive normalization`,
    );

    const evidence: string[] = [];
    const escalations: FollowUpEscalation[] = [];
    if (scenario.questionnaire) {
      const applied = applyFollowUpAnswers(scenario.questionnaire);
      evidence.push(...applied.evidence);
      escalations.push(...applied.escalations);
    }

    const guidance = assessSymptomGuidance({
      ...scenario.normalize,
      primarySymptom: normalized.primarySymptom,
      associatedSymptoms: normalized.associatedSymptoms,
      selectedSymptoms: normalized.selectedSymptoms,
      followUpEvidence: evidence,
      followUpEscalations: escalations,
    });

    assert.equal(guidance.urgencyLevel, scenario.expectUrgency, `${scenario.name}: urgency mismatch`);
    for (const flag of scenario.expectFlagAtLeast) {
      assert.ok(guidance.redFlagsTriggered.includes(flag), `${scenario.name}: red flag ${flag} missing`);
    }
    assert.ok(guidance.recommendations.length > 0, `${scenario.name}: recommendations never empty`);

    if (scenario.name === "routine_incomplete" || scenario.name === "ambiguous_other") {
      assert.equal(urgencyStateFor(guidance.urgencyLevel, "insufficient_input"), "needs_more_information", `${scenario.name}: classifier-pending state`);
    }
    if (guidance.urgencyLevel !== "emergency") {
      assert.match(
        guidance.recommendations[guidance.recommendations.length - 1] ?? "",
        /not a diagnosis|educational/i,
        `${scenario.name}: disclaimer preserved`,
      );
    }
  }
});

test("negation in the same clause suppresses the matched rule", () => {
  const denied = assessSymptomGuidance({
    primarySymptom: "no chest pain and no trouble breathing", symptomCategory: "cardiovascular", associatedSymptoms: [], selectedSymptoms: [],
  });
  assert.equal(denied.urgencyLevel, "routine", "negated phrases must not raise urgency");
  assert.deepEqual(denied.redFlagsTriggered, []);

  const deniedWithBut = assessSymptomGuidance({
    primarySymptom: "denies stiff neck, mild sore throat", symptomCategory: "other", associatedSymptoms: [], selectedSymptoms: [],
  });
  assert.equal(deniedWithBut.urgencyLevel, "routine");
  assert.ok(deniedWithBut.recommendations.length > 0);

  const stillSymptom = assessSymptomGuidance({
    primarySymptom: "no urine since yesterday morning", symptomCategory: "other", associatedSymptoms: [], selectedSymptoms: [],
  });
  assert.equal(stillSymptom.urgencyLevel, "urgent", "phrases that begin with 'no' are symptoms, not negations");

  const mixed = assessSymptomGuidance({
    primarySymptom: "no chest pain but short of breath", symptomCategory: "other", associatedSymptoms: [], selectedSymptoms: [],
  });
  assert.equal(mixed.urgencyLevel, "emergency", "breathlessness in the second clause still fires");
});

test("expanded vocabulary phrasings map to the right rules", () => {
  const cases: Array<{ text: string; urgency: "routine" | "urgent" | "emergency"; flag: string }> = [
    { text: "heaviness in chest since evening", urgency: "emergency", flag: "chest pain" },
    { text: "struggling to breathe", urgency: "emergency", flag: "breathlessness" },
    { text: "splitting headache", urgency: "emergency", flag: "severe headache" },
    { text: "want to die", urgency: "emergency", flag: "suicidal thoughts or self-harm" },
    { text: "coughing up blood", urgency: "emergency", flag: "uncontrolled bleeding" },
    { text: "hives all over my body", urgency: "emergency", flag: "severe allergic reaction" },
    { text: "heart beating fast after caffeine", urgency: "urgent", flag: "palpitations" },
    { text: "stomach cramps with puking", urgency: "urgent", flag: "vomiting with abdominal pain" },
    { text: "hurts to pee", urgency: "urgent", flag: "urinary symptoms" },
    { text: "swollen ankles", urgency: "urgent", flag: "leg swelling" },
    { text: "runny nose and scratchy throat", urgency: "routine", flag: "" },
    { text: "no energy since last week", urgency: "routine", flag: "" },
  ];
  for (const row of cases) {
    const guidance = assessSymptomGuidance({
      primarySymptom: row.text, symptomCategory: "other", associatedSymptoms: [], selectedSymptoms: [],
    });
    assert.equal(guidance.urgencyLevel, row.urgency, `${row.text}: urgency`);
    if (row.flag) {
      assert.ok(guidance.redFlagsTriggered.includes(row.flag) || guidance.recommendations.join(" ").includes(row.flag), `${row.text}: ${row.flag} surfaced`);
    }
  }
});

test("evaluation result schema accepts the persisted view shape", () => {
  assert.ok(SYMPTOM_EVALUATION_PROMPT_VERSION.startsWith("symptom-eval-v"));

  const sample = {
    summary: "Reported symptoms suggest a routine self-limited pattern.",
    reportedSymptoms: ["mild sore throat"],
    possibleConsiderations: [],
    supportingInformation: "Based on the provided symptom description only.",
    missingInformation: "Duration, temperature history, and swallowing difficulty.",
    urgencyContext: "Rule-based urgency says routine.",
    limitations: "General information only.",
    followUpQuestions: ["How long has the throat discomfort lasted?"],
  };
  const parsed = symptomEvaluationSchema.safeParse(sample);
  assert.equal(parsed.success, true, JSON.stringify(parsed.success ? [] : parsed.error.issues));
});

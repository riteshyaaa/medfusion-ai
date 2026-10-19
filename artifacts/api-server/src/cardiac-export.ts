// Plain-text and PDF rendering of a saved, research-only cardiac assessment.
// The output is a factual record of what was entered, what the research model
// returned, and the documented limitations. It deliberately avoids clinical
// report wording, conclusions, and approvals.

import { buildReportPdf } from "./report-export";
import type { cardiacAssessments } from "@workspace/db/schema";

export const CARDIAC_SUMMARY_HEADING = "MEDSCOPE AI — RESEARCH CARDIAC ASSESSMENT SUMMARY (NOT A CLINICAL DOCUMENT)";

export type OwnedCardiacAssessment = typeof cardiacAssessments.$inferSelect;

type ExplanationRow = {
  provider: string;
  model: string;
  promptVersion: string;
  status: "completed" | "failed";
  sections: Record<string, unknown> | null;
  comparison: { id: number | null; createdAt: Date; riskScore: number | null; modelVersion: string | null } | null;
};

const FEATURE_LABELS: Record<string, string> = {
  age: "Age (years)",
  sex: "Recorded sex",
  chestPainType: "Chest pain type",
  restingBloodPressure: "Resting blood pressure (mm Hg)",
  serumCholesterol: "Serum cholesterol (mg/dL)",
  fastingBloodSugarOver120: "Fasting blood sugar above 120 mg/dL",
  restingEcg: "Resting ECG result",
  maxHeartRate: "Maximum heart rate achieved (bpm)",
  exerciseAngina: "Exercise-induced angina",
  stDepression: "ST depression induced by exercise (mm)",
  stSlope: "Slope of peak exercise ST segment",
  majorVessels: "Number of major vessels colored by fluoroscopy",
  thalassemia: "Thalassemia test result",
};

const MEASUREMENT_SOURCE_LABELS: Record<string, string> = {
  self_measured: "Measured by the person submitting the record",
  patient_reported: "Patient-reported value (not verified against a device record)",
  imported_history: "Imported historical value",
  unspecified: "Source of the values was not specified",
};

function line(text = ""): string {
  return text;
}

function asText(value: unknown): string {
  if (Array.isArray(value)) return value.map((entry) => asText(entry)).join("; ");
  return typeof value === "string" ? value : String(value ?? "");
}

export function renderCardiacSummaryText(
  assessment: OwnedCardiacAssessment,
  explanations: ExplanationRow[] = [],
  caseNumber?: string | null,
): string {
  const rows: string[] = [];
  rows.push(line(CARDIAC_SUMMARY_HEADING));
  rows.push(line());
  rows.push(line(`This summary is generated from a saved research assessment (record #${assessment.id}). It contains a statistical research output, not a diagnosis, an approval, or clinical advice. No clinician has reviewed or signed this summary.`));
  rows.push(line());

  rows.push(line("RECORD"));
  rows.push(line(`- Assessment created: ${new Date(assessment.createdAt).toISOString()}`));
  rows.push(line(`- Assessment record: cardiac assessment #${assessment.id}`));
  if (caseNumber) rows.push(line(`- Associated case: ${caseNumber} (access is governed by the application's ownership permissions)`));
  rows.push(line());

  rows.push(line("MODEL IDENTITY AND RESEARCH STATUS"));
  rows.push(line(`- Model: ${assessment.modelId ?? "unknown"} (version ${assessment.modelVersion ?? "unknown"})`));
  rows.push(line(`- Serving status: ${assessment.status === "research_only" ? "research_only — explicitly NOT clinically validated or approved" : assessment.status}`));
  rows.push(line(`- Calibration status: uncalibrated — the score is a raw logistic output, not a probability of disease for any individual`));
  rows.push(line());

  rows.push(line("INPUTS USED BY THE RESEARCH MODEL"));
  for (const [key, value] of Object.entries(assessment.inputs ?? {})) {
    rows.push(line(`- ${FEATURE_LABELS[key] ?? key}: ${asText(value)}`));
  }
  rows.push(line(`- Source of the entered values: ${MEASUREMENT_SOURCE_LABELS[assessment.measurementSource] ?? assessment.measurementSource}`));
  rows.push(line());

  const contextual = assessment.contextualFactors ?? [];
  rows.push(line("CONTEXTUAL INFORMATION (RECORDED BUT NOT USED BY THE MODEL)"));
  if (contextual.length === 0) {
    rows.push(line("- None recorded."));
  } else {
    for (const entry of contextual) {
      rows.push(line(`- ${entry.factor}: ${entry.value}${entry.missing ? " (unanswered)" : ""}`));
    }
    rows.push(line("These contextual entries were NOT processed by the research model; the model consumed only the inputs listed above."));
  }
  rows.push(line());

  const urgent = (assessment.aiAssessment?.warningSigns ?? []).filter(Boolean);
  rows.push(line("URGENT-SYMPTOM SAFETY NOTICE"));
  if (urgent.length > 0) {
    rows.push(line(`- Urgent warning symptoms were recorded (${urgent.join(", ")}). The research model was NOT called for this record.`));
    rows.push(line("- Possible emergencies require immediate professional assessment. Contact local emergency services now; do not wait for any software result."));
  } else {
    rows.push(line("- No urgent warning symptoms were recorded at submission. This questionnaire cannot rule out a heart attack or any other emergency; concerning symptoms always require immediate professional assessment."));
  }
  rows.push(line());

  rows.push(line("RESEARCH MODEL OUTPUT"));
  if (assessment.status === "research_only" && typeof assessment.riskScore === "number") {
    rows.push(line(`- Returned score: ${assessment.riskScore} (uncalibrated logistic output; semantics: research benchmark score, not an individual risk probability)`));
    rows.push(line(`- Decision threshold used by the model build: ${assessment.threshold}`));
    rows.push(line("- Threshold provenance: engineering default of the research training pipeline; NOT a clinically meaningful boundary between any health states."));
    rows.push(line(`- Threshold comparison: ${assessment.aboveThreshold ? "above" : "below"} the default threshold; internal label: ${assessment.label}`));
    rows.push(line("- This label is a research classifier output. Do not treat it as a determination that you are healthy or diseased."));
    if ((assessment.topFactors ?? []).length > 0) {
      rows.push(line("- Largest weighted contributions in this record (mathematical weights from the model's standardised inputs; NOT causal evidence):"));
      for (const factor of assessment.topFactors ?? []) {
        rows.push(line(`  - ${factor.feature}: ${factor.contribution >= 0 ? "+" : ""}${factor.contribution.toFixed(4)} — ${factor.description}`));
      }
    }
  } else {
    rows.push(line(`- No score was served for this record (${assessment.status}).`));
    rows.push(line(`- ${assessment.notice}`));
  }
  rows.push(line());

  rows.push(line("DOCUMENTED MODEL AND DATASET LIMITATIONS"));
  for (const limitation of assessment.diagnosticLimitations ?? []) rows.push(line(`- ${limitation}`));
  rows.push(line());

  const completed = explanations.filter((row) => row.status === "completed");
  if (completed.length > 0) {
    rows.push(line("AI-GENERATED EXPLANATORY TEXT (SEPARATE FROM THE MODEL OUTPUT)"));
    for (const explanation of completed) {
      rows.push(line(`- Generated by provider ${explanation.provider} (${explanation.model}), prompt version ${explanation.promptVersion}. The following text was produced by a language model; it did not change the score, threshold, label, or inputs above and may itself be imperfect.`));
      const sections = explanation.sections ?? {};
      for (const key of Object.keys(sections)) {
        rows.push(line(`  [${key}] ${asText(sections[key])}`));
      }
      if (explanation.comparison) {
        rows.push(line(`  [comparison reference] compared with assessment #${explanation.comparison.id ?? "unknown"} dated ${new Date(explanation.comparison.createdAt).toISOString()}, score ${explanation.comparison.riskScore ?? "n/a"}, model version ${explanation.comparison.modelVersion ?? "unknown"}`));
      }
    }
  } else if (explanations.length > 0) {
    rows.push(line("AI-GENERATED EXPLANATORY TEXT"));
    rows.push(line("- An explanation was requested but never completed successfully for this record; none is included."));
  } else {
    rows.push(line("AI-GENERATED EXPLANATORY TEXT"));
    rows.push(line("- None generated."));
  }
  rows.push(line());

  rows.push(line(`Source record: cardiac assessment #${assessment.id}, saved in MedScope AI under the submitting user's account.`));
  rows.push(line("This document is not medical advice. Share it with a qualified healthcare professional rather than using it for decisions."));
  return rows.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

export function buildCardiacSummaryPdf(
  assessment: OwnedCardiacAssessment,
  explanations: ExplanationRow[] = [],
  caseNumber?: string | null,
): Buffer {
  return buildReportPdf(renderCardiacSummaryText(assessment, explanations, caseNumber));
}

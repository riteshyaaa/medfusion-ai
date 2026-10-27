// Temporary probe: run cardiac explanation + report interpretation repeatedly
// to measure 502 recurrence and see what retry policy fixes it.
import * as fs from "node:fs";
import { getClinicalAIProvider } from "../src/clinical-ai.js";
import { getDocumentInterpreter } from "../src/document-interpreter.js";
import { configuredProviderConfig } from "../src/ai-providers.js";

for (const line of fs.readFileSync("../../.env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const ai = getClinicalAIProvider(process.env);
console.log("model:", ai.model, "| maxRetries:", configuredProviderConfig(process.env).config?.maxRetries);

const cardiacExplanation = {
  assessment: {
    createdAt: new Date().toISOString(),
    modelIdentity: { modelId: null, modelVersion: null, status: "research_only", calibrationStatus: "uncalibrated" },
    inputs: { age: 34, sex: "male", systolicBloodPressure: 138, totalCholesterol: 224, hdlCholesterol: 44, smokingStatus: "never" },
    measurementSource: "manual_entry",
    contextualFactors: [],
    modelOutput: { riskScore: 0.21, aboveThreshold: false, label: "low_to_moderate", threshold: 0.225, topFactors: [
      { feature: "systolicBloodPressure", description: "Systolic blood pressure", contribution: 0.08, unit: "mmHg" },
      { feature: "totalCholesterol", description: "Total cholesterol", contribution: 0.05, unit: "mg/dL" }] },
    urgentSymptomsFlagged: [],
    documentedLimitations: ["1988 cohort baseline; not clinically validated"],
  },
  comparison: null,
};
for (let i = 1; i <= 3; i++) {
  const t0 = Date.now();
  try {
    await ai.provider.explainCardiacAssessment(cardiacExplanation);
    console.log(`cardiac explain ${i}: OK ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    console.log(`cardiac explain ${i}: FAILED ${((Date.now() - t0) / 1000).toFixed(1)}s ${String(e?.code ?? e).slice(0, 140)}`);
  }
}
const interp = getDocumentInterpreter(process.env);
for (let i = 1; i <= 3; i++) {
  const t0 = Date.now();
  try {
    await interp.interpreter.interpret({
      documentType: "laboratory report", pageCount: 1, extractionMethod: "image_ocr",
      findings: [
        { label: "Hemoglobin", valueText: "13.4", unit: "g/dL", referenceRange: "13.0-17.0", pageNumber: 1, sourceText: "Hemoglobin 13.4 g/dL" },
        { label: "Platelets", valueText: "250", unit: "10^3/uL", referenceRange: "150-400", pageNumber: 1, sourceText: "Platelets 250 x10^3/uL" }],
      narrativeText: "Routine complete blood count.",
    });
    console.log(`report interpret ${i}: OK ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    console.log(`report interpret ${i}: FAILED ${((Date.now() - t0) / 1000).toFixed(1)}s ${String(e?.code ?? e).slice(0, 140)}`);
  }
}

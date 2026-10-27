// Live probe for every provider-backed feature with the user's real
// configuration. Prints model, outcome, latency, and the exact error code
// so per-feature differences are visible (diagnose, not guess).
import * as fs from "node:fs";
import { getClinicalAIProvider } from "../src/clinical-ai.js";
import { getDocumentInterpreter } from "../src/document-interpreter.js";

for (const line of fs.readFileSync("../../.env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const runs = [];
async function probe(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    runs.push(`${name}: OK in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } catch (error) {
    runs.push(`${name}: FAILED after ${((Date.now() - t0) / 1000).toFixed(1)} s — ${error?.code ?? error?.name ?? ""} ${(error?.message ?? "").slice(0, 200)}`);
  }
}

const text = getClinicalAIProvider(process.env);
console.log(`text model: ${text.model}`);
const symptomInput = {
  primarySymptom: "persistent dry cough",
  symptomCategory: "respiratory",
  onset: "five days ago",
  duration: "ongoing",
  severity: "mild",
  progression: "stable",
  associatedSymptoms: ["mild fatigue"],
  selectedSymptoms: ["cough"],
  ageGroup: "adult_18_39",
};

await probe("analyzeSymptoms (text model)", () => text.provider.analyzeSymptoms(symptomInput));
await probe("analyzeCardiac (text model)", () => text.provider.analyzeCardiac({
  primarySymptom: "occasional palpitations",
  symptomCategory: "cardiovascular",
  ageGroup: "adult_18_39",
  associatedSymptoms: [],
  selectedSymptoms: ["palpitations"],
}));

const cardiacExplanation = {
  assessment: {
    createdAt: new Date().toISOString(),
    modelIdentity: { modelId: null, modelVersion: null, status: "research_only", calibrationStatus: "uncalibrated" },
    inputs: { age: 34, sex: "male", systolicBloodPressure: 138, totalCholesterol: 224, hdlCholesterol: 44, smokingStatus: "never" },
    measurementSource: "manual_entry",
    contextualFactors: [],
    modelOutput: {
      riskScore: 0.21,
      aboveThreshold: false,
      label: "low_to_moderate",
      threshold: 0.225,
      topFactors: [
        { feature: "systolicBloodPressure", description: "Systolic blood pressure", contribution: 0.08, unit: "mmHg" },
        { feature: "totalCholesterol", description: "Total cholesterol", contribution: 0.05, unit: "mg/dL" },
      ],
    },
    urgentSymptomsFlagged: [],
    documentedLimitations: ["1988 cohort baseline; not clinically validated"],
  },
  comparison: null,
};
await probe("explainCardiacAssessment (text model)", () => text.provider.explainCardiacAssessment(cardiacExplanation));

const sampleAssessment = {
  summary: "educational summary",
  reportedSymptoms: ["persistent dry cough for five days", "mild fatigue"],
  possibleConsiderations: [{ name: "post-viral cough", whyDiscussed: "fits a self-limited respiratory irritation" }],
  supportingInformation: "no fever reported",
  missingInformation: "temperature and smoking history unknown",
  urgencyContext: "no red flags reported",
  limitations: "not a diagnosis",
  followUpQuestions: ["Has there been any fever?"],
};
await probe("evaluateSymptoms (text model)", () => text.provider.evaluateSymptoms({
  urgencyLevel: "routine",
  redFlags: [],
  guidance: { advice: ["monitor symptoms"] },
  ...sampleAssessment,
}));

const interpreter = getDocumentInterpreter(process.env);
console.log(`interpreter model: ${interpreter.interpreter ? "(configured)" : interpreter.status}`);
await probe("documentInterpreter (text model)", () => interpreter.interpreter.interpret({
  documentType: "laboratory report",
  pageCount: 1,
  extractionMethod: "image_ocr",
  findings: [
    { label: "Hemoglobin", valueText: "13.4", unit: "g/dL", referenceRange: "13.0-17.0", pageNumber: 1, sourceText: "Hemoglobin 13.4 g/dL" },
    { label: "Platelets", valueText: "250", unit: "10^3/uL", referenceRange: "150-400", pageNumber: 1, sourceText: "Platelets 250 x10^3/uL" },
  ],
  narrativeText: "Routine complete blood count.",
}));

const vision = getClinicalAIProvider(process.env, { useVisionModel: true });
console.log(`vision model: ${vision.model}`);
const samples = ["6f9df510-21f2-49f8-a2de-2ddd82d07a1f.jpg", ...fs.readdirSync("../../uploads").filter((f) => f.endsWith(".jpg") && f !== "6f9df510-21f2-49f8-a2de-2ddd82d07a1f.jpg").sort(() => 0.5 - Math.random()).slice(0, 3)];
for (const [i, file] of samples.entries()) {
  await probe(`analyzeSkin ${file}`, () => vision.provider.analyzeSkin(
    "data:image/jpeg;base64," + fs.readFileSync(`../../uploads/${file}`).toString("base64"),
  ));
}

console.log("\n=== summary ===");
for (const line of runs) console.log(line);

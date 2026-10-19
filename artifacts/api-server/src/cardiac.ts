// Cardiac risk assessment contract and research-only classifier.
//
// A checksum-verified logistic-regression baseline trained on the UCI Cleveland
// cohort can serve clearly-labelled research scores. There is still no approved
// model, so `hasApprovedCardiacModel()` stays false and nothing here is a
// clinical risk assessment.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");

export type CardiacFeatureType = "numeric" | "categorical";

export type CardiacFeature = {
  name: string;
  type: CardiacFeatureType;
  unit: string | null;
  description: string;
  allowedValues?: string[];
  minimum?: number;
  maximum?: number;
};

export const CARDIAC_MODEL_CONTRACT = {
  task: "binary-heart-disease-risk-classification",
  dataset: {
    id: "UCI Heart Disease (Cleveland subset)",
    sourceUrl: "https://archive.ics.uci.edu/dataset/45/heart+disease",
    licenseNote: "UCI Machine Learning Repository terms; research-only use.",
    knownLimitations: [
      "Small historical cohort from 1988; not representative of current populations.",
      "Research metrics come from a small held-out split and are not clinical validation.",
      "Uncalibrated score; not an individual disease probability.",
    ],
  },
  features: [
    { name: "age", type: "numeric", unit: "years", description: "Age at assessment", minimum: 18, maximum: 120 },
    { name: "sex", type: "categorical", unit: null, description: "Recorded sex", allowedValues: ["male", "female"] },
    { name: "chestPainType", type: "categorical", unit: null, description: "Chest pain type", allowedValues: ["typical_angina", "atypical_angina", "non_anginal", "asymptomatic"] },
    { name: "restingBloodPressure", type: "numeric", unit: "mm Hg", description: "Resting blood pressure", minimum: 60, maximum: 250 },
    { name: "serumCholesterol", type: "numeric", unit: "mg/dL", description: "Serum cholesterol", minimum: 50, maximum: 700 },
    { name: "fastingBloodSugarOver120", type: "categorical", unit: null, description: "Fasting blood sugar above 120 mg/dL", allowedValues: ["yes", "no"] },
    { name: "restingEcg", type: "categorical", unit: null, description: "Resting electrocardiographic result", allowedValues: ["normal", "st_t_abnormality", "left_ventricular_hypertrophy"] },
    { name: "maxHeartRate", type: "numeric", unit: "bpm", description: "Maximum heart rate achieved", minimum: 50, maximum: 250 },
    { name: "exerciseAngina", type: "categorical", unit: null, description: "Exercise-induced angina", allowedValues: ["yes", "no"] },
    { name: "stDepression", type: "numeric", unit: "mm", description: "ST depression induced by exercise relative to rest", minimum: 0, maximum: 10 },
    { name: "stSlope", type: "categorical", unit: null, description: "Slope of the peak exercise ST segment", allowedValues: ["upsloping", "flat", "downsloping"] },
    { name: "majorVessels", type: "numeric", unit: "count", description: "Number of major vessels (0-3) colored by fluoroscopy", minimum: 0, maximum: 3 },
    { name: "thalassemia", type: "categorical", unit: null, description: "Thalassemia test result", allowedValues: ["normal", "fixed_defect", "reversible_defect"] },
  ] as CardiacFeature[],
  preprocessingNote: "The research artifact records dataset version, feature order, encodings, missing-value behavior (rows with missing ca/thal were dropped), and calibration status.",
} as const;

export type CardiacModelStatus = {
  available: true;
  mode: "research_only";
  modelId: string;
  modelVersion: string;
  readinessState: string;
  calibrationStatus: string;
  metrics: Record<string, unknown>;
  readinessNote: string;
  researchServing: CardiacResearchServingPolicy;
  contract: typeof CARDIAC_MODEL_CONTRACT;
};

export type CardiacInferenceStatus =
  | CardiacModelStatus
  | { available: false; status: "model_unavailable"; reason: string; researchServing: CardiacResearchServingPolicy; contract: typeof CARDIAC_MODEL_CONTRACT };

type CardiacBundle = {
  bundleType: string;
  classOrder: string[];
  columnOrder: string[];
  numericFeatures: Record<string, { mean: number; std: number }>;
  categoricalFeatures: Record<string, string[]>;
  coefficients: number[];
  intercept: number;
  decisionThreshold: number;
};

type CardiacManifest = {
  modelId: string;
  modelVersion: string;
  readinessState: string;
  artifact: { path: string; sha256: string };
  evaluation: Record<string, unknown>;
};

export function hasApprovedCardiacModel(): boolean {
  // Clinical approval requires independent evidence and governance that this
  // repository does not have. A checksum or an environment flag proves artifact
  // integrity and operator intent; neither is ever clinical approval.
  return false;
}

export const CARDIAC_RESEARCH_SERVING_ENV = "CARDIAC_RESEARCH_INFERENCE_ENABLED";

export type CardiacResearchServingPolicy = { enabled: boolean; reason: string };

export function cardiacResearchServingPolicy(env: NodeJS.ProcessEnv = process.env): CardiacResearchServingPolicy {
  if (env[CARDIAC_RESEARCH_SERVING_ENV] === "true") {
    return {
      enabled: true,
      reason: `Research serving is explicitly enabled by configuration (${CARDIAC_RESEARCH_SERVING_ENV}=true). Outputs remain clearly-labelled research scores, never clinical risk assessments.`,
    };
  }
  return {
    enabled: false,
    reason: `Research serving is disabled by default. An operator must explicitly set ${CARDIAC_RESEARCH_SERVING_ENV}=true to enable clearly-labelled research inference. This is a serving-permission decision, never clinical approval.`,
  };
}

export type CardiacAssessmentInput = {
  age: number;
  sex: string;
  chestPainType: string;
  restingBloodPressure: number;
  serumCholesterol: number;
  fastingBloodSugarOver120: string;
  restingEcg: string;
  maxHeartRate: number;
  exerciseAngina: string;
  stDepression: number;
  stSlope: string;
  majorVessels: number;
  thalassemia: string;
};

const FIELD_TO_FEATURE: Record<keyof CardiacAssessmentInput, string> = {
  age: "age",
  sex: "sex",
  chestPainType: "cp",
  restingBloodPressure: "trestbps",
  serumCholesterol: "chol",
  fastingBloodSugarOver120: "fbs",
  restingEcg: "restecg",
  maxHeartRate: "thalach",
  exerciseAngina: "exang",
  stDepression: "oldpeak",
  stSlope: "slope",
  majorVessels: "ca",
  thalassemia: "thal",
};

const NUMERIC_FIELDS = new Set(["age", "restingBloodPressure", "serumCholesterol", "maxHeartRate", "stDepression"]);
const CATEGORICAL_NUMERIC_FIELDS = new Set(["majorVessels"]);

export class CardiacFeatureError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.field = field;
  }
}

async function sha256File(pathname: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(pathname)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

function resolveArtifactDir(): string {
  return process.env.CARDIAC_MODEL_DIR
    ? path.resolve(repositoryRoot, process.env.CARDIAC_MODEL_DIR)
    : path.resolve(repositoryRoot, "models/registry/cardiac/logreg-v20261016");
}

let cache: {
  at: number;
  status: Omit<CardiacModelStatus, "researchServing"> | { available: false; status: "model_unavailable"; reason: string; contract: typeof CARDIAC_MODEL_CONTRACT };
} | null = null;
const STATUS_CACHE_TTL_MS = 30_000;

async function loadModel(): Promise<{ bundle: CardiacBundle; manifest: CardiacManifest }> {
  const artifactDir = resolveArtifactDir();
  const manifestRaw = await readFile(path.join(artifactDir, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestRaw) as CardiacManifest;
  if (manifest.artifact.path !== "bundle.json" || typeof manifest.artifact.sha256 !== "string" || manifest.artifact.sha256.length !== 64) {
    throw new Error("Cardiac manifest does not reference bundle.json with a checksum");
  }
  const actual = await sha256File(path.join(artifactDir, "bundle.json"));
  if (actual !== manifest.artifact.sha256) throw new Error("Cardiac bundle checksum does not match the manifest");
  const bundle = JSON.parse(await readFile(path.join(artifactDir, "bundle.json"), "utf8")) as CardiacBundle;
  if (bundle.bundleType !== "cardiac-risk-logistic-regression") throw new Error("Unknown cardiac bundle type");
  if (bundle.classOrder.length !== 2 || bundle.classOrder[1] !== "disease") throw new Error("Cardiac bundle class order is unsupported");
  if (bundle.coefficients.length !== bundle.columnOrder.length) throw new Error("Cardiac bundle coefficients do not match its column order");
  if (!Number.isFinite(bundle.intercept) || !Number.isFinite(bundle.decisionThreshold)) throw new Error("Cardiac bundle intercept/threshold invalid");
  const numericNames = Object.keys(bundle.numericFeatures);
  if (numericNames.length !== 5) throw new Error("Cardiac bundle must standardize exactly five numeric features");
  const selfCheck = (manifest as CardiacManifest & { selfCheck?: { fixturesFile?: string; sha256?: string; tolerance?: number } }).selfCheck;
  if (!selfCheck || selfCheck.fixturesFile !== "test-fixtures.json" || typeof selfCheck.sha256 !== "string" || selfCheck.sha256.length !== 64 || typeof selfCheck.tolerance !== "number" || !(selfCheck.tolerance > 0)) {
    throw new Error("Cardiac manifest lacks a usable inference self-check block");
  }
  const fixturesPath = path.join(artifactDir, selfCheck.fixturesFile);
  if (await sha256File(fixturesPath) !== selfCheck.sha256) throw new Error("Cardiac self-check fixtures checksum does not match the manifest");
  const fixtures = JSON.parse(await readFile(fixturesPath, "utf8")) as {
    highRiskSample?: { row?: Record<string, string | number>; riskScore?: number };
    lowRiskSample?: { row?: Record<string, string | number>; riskScore?: number };
  };
  for (const sample of [fixtures.highRiskSample, fixtures.lowRiskSample]) {
    if (!sample || typeof sample.row !== "object" || sample.row === null || typeof sample.riskScore !== "number" || !Number.isFinite(sample.riskScore)) {
      throw new Error("Cardiac self-check fixtures are malformed");
    }
    const selfCheckValues = vectorizeInput(bundle, sample.row as unknown as CardiacAssessmentInput);
    const reproduced = sigmoid(selfCheckValues.reduce((total, entry) => total + entry.coefficient * entry.value, bundle.intercept));
    if (!(Math.abs(reproduced - sample.riskScore) <= selfCheck.tolerance)) {
      throw new Error(`Cardiac inference self-check failed: reproduced ${reproduced} but the pinned fixture expects ${sample.riskScore}`);
    }
  }
  return { bundle, manifest };
}

export function resetCardiacCache(): void {
  cache = null;
}

export async function getCardiacInferenceStatus(): Promise<CardiacInferenceStatus> {
  // Research-serving permission is read fresh on every call so that an operator
  // toggling the configuration takes effect without waiting out the artifact
  // status cache. Artifact integrity stays cached.
  const researchServing = cardiacResearchServingPolicy();
  if (cache && Date.now() - cache.at < STATUS_CACHE_TTL_MS) return { ...cache.status, researchServing };
  let status: Omit<CardiacModelStatus, "researchServing"> | { available: false; status: "model_unavailable"; reason: string; contract: typeof CARDIAC_MODEL_CONTRACT };
  try {
    const { bundle, manifest } = await loadModel();
    status = {
      available: true,
      mode: "research_only",
      modelId: manifest.modelId,
      modelVersion: manifest.modelVersion,
      readinessState: manifest.readinessState,
      calibrationStatus: String((manifest.evaluation as { calibrationStatus?: string }).calibrationStatus ?? "uncalibrated"),
      metrics: (manifest.evaluation as { test?: unknown }) ?? {},
      readinessNote:
        "Checksum-verified research baseline on the UCI Cleveland cohort (1988, 297 usable records), with a pinned-fixture inference self-check. Scores are uncalibrated logistic outputs served beside the documented limitations; nothing here is clinically validated.",
      contract: CARDIAC_MODEL_CONTRACT,
    };
    void bundle;
  } catch (error) {
    status = {
      available: false,
      status: "model_unavailable",
      reason: `No verified cardiac research artifact is served: ${error instanceof Error ? error.message : String(error)}`,
      contract: CARDIAC_MODEL_CONTRACT,
    };
  }
  cache = { at: Date.now(), status };
  return { ...status, researchServing };
}

export function cardiacModelStatus(): Promise<CardiacInferenceStatus> {
  return getCardiacInferenceStatus();
}

export type CardiacFactor = { feature: string; description: string; contribution: number; unit: string | null };

export type CardiacAssessmentResult = {
  status: "research_only" | "model_unavailable";
  modelId: string | null;
  modelVersion: string | null;
  riskScore: number | null;
  aboveThreshold: boolean | null;
  label: string | null;
  threshold: number | null;
  topFactors: CardiacFactor[];
  notice: string;
  diagnosticLimitations: string[];
};

function sigmoid(value: number): number {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const flipped = Math.exp(value);
  return flipped / (1 + flipped);
}

function vectorizeInput(bundle: CardiacBundle, input: CardiacAssessmentInput): Array<{ column: string; value: number; coefficient: number }> {
  const numericInput: Record<string, number> = {
    age: input.age,
    restingBloodPressure: input.restingBloodPressure,
    serumCholesterol: input.serumCholesterol,
    maxHeartRate: input.maxHeartRate,
    stDepression: input.stDepression,
    majorVessels: input.majorVessels,
  };
  const values: Array<{ column: string; value: number; coefficient: number }> = [];
  for (const [field, datasetName] of Object.entries(FIELD_TO_FEATURE) as Array<[keyof CardiacAssessmentInput, string]>) {
    if (NUMERIC_FIELDS.has(field)) {
      const normalizer = bundle.numericFeatures[datasetName];
      if (!normalizer) throw new CardiacFeatureError(field, "Numeric feature configuration missing from the model bundle");
      values.push({
        column: `numeric:${datasetName}`,
        value: (numericInput[field] - normalizer.mean) / normalizer.std,
        coefficient: bundle.coefficients[bundle.columnOrder.indexOf(`numeric:${datasetName}`)],
      });
    } else {
      const value = CATEGORICAL_NUMERIC_FIELDS.has(field) ? String(numericInput[field]) : String(input[field]);
      if (CATEGORICAL_NUMERIC_FIELDS.has(field)) {
        if (value !== String(Math.round(Number(value)))) {
          throw new CardiacFeatureError(field, "Major vessels count must be a whole number");
        }
      }
      const allowedDataset = bundle.categoricalFeatures[datasetName];
      const allowedContract = CARDIAC_MODEL_CONTRACT.features.find((feature) => feature.name === field)?.allowedValues;
      if (!Array.isArray(allowedDataset) || allowedDataset.indexOf(value) === -1) {
        if (allowedDataset) {
          throw new CardiacFeatureError(field, `Unsupported value ${value}; expected one of ${allowedDataset.join(", ")}`);
        }
        if (allowedContract && allowedContract.indexOf(value) === -1) {
          throw new CardiacFeatureError(field, `Unsupported value ${value}; expected one of ${allowedContract.join(", ")}`);
        }
        throw new CardiacFeatureError(field, "Unsupported categorical value");
      }
      values.push({ column: `categorical:${datasetName}=${value}`, value: 1, coefficient: bundle.coefficients[bundle.columnOrder.indexOf(`categorical:${datasetName}=${value}`)] });
    }
  }
  return values;
}

function unavailableCardiacResult(notice: string): CardiacAssessmentResult {
  return {
    status: "model_unavailable",
    modelId: null,
    modelVersion: null,
    riskScore: null,
    aboveThreshold: null,
    label: null,
    threshold: null,
    topFactors: [],
    notice,
    diagnosticLimitations: [...CARDIAC_MODEL_CONTRACT.dataset.knownLimitations],
  };
}

export async function assessCardiacRisk(input: CardiacAssessmentInput): Promise<CardiacAssessmentResult> {
  const policy = cardiacResearchServingPolicy();
  if (!policy.enabled) {
    return unavailableCardiacResult(
      `No cardiac prediction was produced: research serving is disabled by configuration (${CARDIAC_RESEARCH_SERVING_ENV} is not set to "true"). This application does not serve research scores without explicit operator permission, and operator permission is never clinical approval.`,
    );
  }
  const status = await getCardiacInferenceStatus();
  if (!status.available) {
    return unavailableCardiacResult(`No cardiac prediction was produced: ${status.reason} Nothing is fabricated and no alternate model is substituted.`);
  }
  const { bundle, manifest } = await loadModel();
  if (Math.abs(input.majorVessels - Math.round(input.majorVessels)) > 1e-9) {
    throw new CardiacFeatureError("majorVessels", "Major vessels count must be a whole number");
  }
  if (Math.abs(input.stDepression * 10 - Math.round(input.stDepression * 10)) > 1e-9) {
    throw new CardiacFeatureError("stDepression", "ST depression must be recorded to one decimal place");
  }
  const featureDescriptions = new Map(CARDIAC_MODEL_CONTRACT.features.map((feature) => [feature.name, feature]));
  const values = vectorizeInput(bundle, input);
  const score = values.reduce((total, entry) => total + entry.coefficient * entry.value, bundle.intercept);
  const riskScore = sigmoid(score);
  const threshold = bundle.decisionThreshold;
  const contributions = values
    .map((entry) => {
      const datasetName = entry.column.startsWith("numeric:") ? entry.column.slice("numeric:".length) : entry.column.slice("categorical:".length, entry.column.indexOf("="));
      return {
        column: entry.column,
        contribution: entry.coefficient * entry.value,
        description: featureDescriptions.get(Object.entries(FIELD_TO_FEATURE).find(([, dataset]) => dataset === datasetName)?.[0] ?? "")?.description ?? entry.column,
        unit: featureDescriptions.get(Object.entries(FIELD_TO_FEATURE).find(([, dataset]) => dataset === datasetName)?.[0] ?? "")?.unit ?? null,
      };
    })
    .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution))
    .slice(0, 3)
    .map((entry) => ({ feature: entry.column, description: entry.description, contribution: entry.contribution, unit: entry.unit }));
  const limitationsFromManifest = ((manifest.evaluation as { knownLimitations?: string[] }).knownLimitations) ?? CARDIAC_MODEL_CONTRACT.dataset.knownLimitations;
  return {
    status: "research_only",
    modelId: manifest.modelId,
    modelVersion: manifest.modelVersion,
    riskScore,
    aboveThreshold: riskScore >= threshold,
    label: riskScore >= threshold ? "disease" : "no_disease",
    threshold,
    topFactors: contributions,
    notice:
      "Research-only score from a logistic baseline trained on the UCI Cleveland cohort (1988, 297 usable records). This is an uncalibrated score, not a probability of heart disease and not clinical advice.",
    diagnosticLimitations: Array.isArray(limitationsFromManifest) ? limitationsFromManifest : [...CARDIAC_MODEL_CONTRACT.dataset.knownLimitations],
  };
}

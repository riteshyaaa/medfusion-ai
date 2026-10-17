import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");

export type SymptomClassifierStatus =
  | {
      available: true;
      mode: "research_only";
      modelId: string;
      modelVersion: string;
      readinessState: string;
      calibrationStatus: string;
      classCount: number;
      catalogue: string[];
      readinessNote: string;
      datasetProvenance: { datasetId: string; sourceOrigin: string; licenseNote: string };
    }
  | { available: false; status: "unavailable"; reason: string };

type ClassifierBundle = {
  bundleType: string;
  alpha: number;
  features: string[];
  classes: string[];
  classLogPrior: Record<string, number>;
  presentLogProb: Record<string, number[]>;
  absentLogProb: Record<string, number[]>;
};

type SymptomManifest = {
  modelId: string;
  modelVersion: string;
  readinessState: string;
  calibrationStatus: string;
  datasetProvenance?: { datasetId?: string; sourceOrigin?: string; licenseNote?: string };
  evaluation?: { knownLimitations?: string[] };
};

export type RankedCondition = {
  condition: string;
  score: number;
  supportingSymptoms: string[];
  nonSupportingSymptoms: string[];
};

export type SymptomClassificationInput = {
  selectedSymptoms: string[];
};
export type SymptomClassification = {
  status: "completed" | "not_available" | "insufficient_input";
  modelId: string | null;
  modelVersion: string | null;
  notice: string;
  rankedConditions?: RankedCondition[];
  unmatchedSymptoms?: string[];
  diagnosticLimitations?: string[];
  aiAssessment?: {
    status: "completed" | "skipped_urgent";
    provider?: string;
    model?: string;
    summary?: string;
    possibleExplanations?: Array<{ explanation: string; whyItMayFit: string }>;
    uncertainty?: string;
    suggestedNextSteps?: string[];
    warningSigns: string[];
    notice: string;
  } | null;
};

const MAX_RANK_DISPLAY = 8;
const STATUS_CACHE_TTL_MS = 30_000;

let cache: { at: number; status: SymptomClassifierStatus } | null = null;
let bundle: ClassifierBundle | null = null;
let manifest: SymptomManifest | null = null;

function resolveArtifactDir(): string {
  return process.env.SYMPTOM_MODEL_DIR
    ? path.resolve(repositoryRoot, process.env.SYMPTOM_MODEL_DIR)
    : path.resolve(repositoryRoot, "models/registry/symptoms/bernoulli-nb-v20261016");
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

async function loadBundleModel(): Promise<{ bundle: ClassifierBundle; manifest: SymptomManifest }> {
  const artifactDir = resolveArtifactDir();
  const manifestRaw = await readFile(path.join(artifactDir, "manifest.json"), "utf8");
  const manifestValue = JSON.parse(manifestRaw) as SymptomManifest;
  const bundleRaw = await readFile(path.join(artifactDir, "bundle.json"), "utf8");
  const artifactManifest = JSON.parse(manifestRaw) as { artifact?: { path?: string; sha256?: string } };
  const artifactPath = artifactManifest.artifact?.path;
  const expectedSha = artifactManifest.artifact?.sha256;
  if (artifactPath !== "bundle.json" || typeof expectedSha !== "string") {
    throw new Error("Symptom classifier manifest does not reference bundle.json");
  }
  const actualSha = await sha256File(path.join(artifactDir, "bundle.json"));
  if (actualSha !== expectedSha) {
    throw new Error("Symptom classifier bundle checksum does not match the manifest");
  }
  const bundleValue = JSON.parse(bundleRaw) as ClassifierBundle;
  if (bundleValue.bundleType !== "symptom-classifier-bernoulli-nb") throw new Error("Unknown symptom classifier bundle type");
  if (!Array.isArray(bundleValue.features) || bundleValue.features.length < 2) throw new Error("Bundle features are invalid");
  if (!Array.isArray(bundleValue.classes) || bundleValue.classes.length < 2) throw new Error("Bundle classes are invalid");
  const length = bundleValue.features.length;
  for (const cls of bundleValue.classes) {
    const presentRow = bundleValue.presentLogProb[cls];
    const absentRow = bundleValue.absentLogProb[cls];
    if (!Array.isArray(presentRow) || presentRow.length !== length) throw new Error(`Bundle present log-probs are inconsistent for ${cls}`);
    if (!Array.isArray(absentRow) || absentRow.length !== length) throw new Error(`Bundle absent log-probs are inconsistent for ${cls}`);
    if (typeof bundleValue.classLogPrior[cls] !== "number" || !Number.isFinite(bundleValue.classLogPrior[cls])) throw new Error(`Bundle class prior invalid for ${cls}`);
    if (presentRow.some((value) => !Number.isFinite(value)) || absentRow.some((value) => !Number.isFinite(value))) throw new Error(`Bundle log-probs contain non-finite values for ${cls}`);
  }
  return { bundle: bundleValue, manifest: manifestValue };
}

export function resetSymptomClassifierCache(): void {
  cache = null;
  bundle = null;
  manifest = null;
}

export function getSymptomCatalogueIds(): string[] | null {
  return bundle ? [...bundle.features] : null;
}

export function getSymptomAssociation(featureIds: string[]): Array<{ condition: string; strength: number }> | null {
  if (!bundle) return null;
  const featureIndex = new Map(bundle.features.map((feature, index) => [feature, index]));
  const indices = featureIds
    .map((id) => featureIndex.get(id))
    .filter((value): value is number => value !== undefined);
  if (indices.length === 0) return null;
  const rows = bundle.classes.map((cls) => {
    let strength = 0;
    for (const index of indices) strength += bundle!.presentLogProb[cls][index] - bundle!.absentLogProb[cls][index];
    return { condition: cls, strength };
  });
  rows.sort((left, right) => right.strength - left.strength);
  return rows.filter((row) => row.strength > 0).slice(0, 8);
}

export async function getSymptomClassifierStatus(): Promise<SymptomClassifierStatus> {
  if (cache && Date.now() - cache.at < STATUS_CACHE_TTL_MS) return cache.status;
  let status: SymptomClassifierStatus;
  try {
    const loaded = await loadBundleModel();
    bundle = loaded.bundle;
    manifest = loaded.manifest;
    status = {
      available: true,
      mode: "research_only",
      modelId: loaded.manifest.modelId,
      modelVersion: loaded.manifest.modelVersion,
      readinessState: loaded.manifest.readinessState,
      calibrationStatus: loaded.manifest.calibrationStatus,
      classCount: loaded.bundle.classes.length,
      catalogue: loaded.bundle.features.map((feature) => feature.replace(/_/g, " ").replace(/\s+/g, " ").trim()),
      readinessNote:
        "Verified research-only symptom-to-condition baseline (uncalibrated posteriors). It ranks possible conditions; it cannot diagnose or rule anything out.",
      datasetProvenance: {
        datasetId: loaded.manifest.datasetProvenance?.datasetId ?? "unknown",
        sourceOrigin: loaded.manifest.datasetProvenance?.sourceOrigin ?? "unknown",
        licenseNote: loaded.manifest.datasetProvenance?.licenseNote ?? "",
      },
    };
  } catch (error) {
    bundle = null;
    manifest = null;
    status = { available: false, status: "unavailable", reason: `Symptom classifier unavailable: ${error instanceof Error ? error.message : String(error)}` };
  }
  cache = { at: Date.now(), status };
  return status;
}

export function classifySymptoms(input: SymptomClassificationInput): SymptomClassification {
  if (!bundle || !manifest) {
    return {
      status: "not_available",
      modelId: null,
      modelVersion: null,
      notice: "The optional research symptom classifier is not installed, so no condition ranking was produced. Urgency guidance below still applies.",
    };
  }
  const selected = [...new Set(input.selectedSymptoms.map((value) => value.trim()).filter(Boolean))];
  if (selected.length === 0) {
    return {
      status: "insufficient_input",
      modelId: manifest.modelId,
      modelVersion: manifest.modelVersion,
      notice: "No machine-readable symptoms were selected, so the optional research classifier produced no ranking.",
    };
  }
  const featureIndex = new Map(bundle.features.map((feature, index) => [feature, index]));
  const matchedIndices: Array<[string, number]> = [];
  const unmatched: string[] = [];
  for (const symptom of selected) {
    const index = featureIndex.get(symptom);
    if (index === undefined) unmatched.push(symptom);
    else matchedIndices.push([symptom, index]);
  }
  if (matchedIndices.length === 0) {
    return {
      status: "insufficient_input",
      modelId: manifest.modelId,
      modelVersion: manifest.modelVersion,
      notice: "No curated symptoms matched the classifier vocabulary, so no ranking was produced. All reported symptoms were recorded as free text.",
      unmatchedSymptoms: unmatched,
    };
  }
  let scores = bundle.classes.map((cls) => ({ cls, posterior: 0 }));
  const logProb = (cls: string, index: number, present: boolean): number => {
    const row = (present ? bundle!.presentLogProb : bundle!.absentLogProb)[cls];
    return row[index];
  };
  const matchedSet = new Set(matchedIndices.map(([, index]) => index));
  for (const cls of bundle.classes) {
    let total = bundle.classLogPrior[cls];
    for (const [, index] of matchedIndices) {
      total += logProb(cls, index, true);
    }
    for (let index = 0; index < bundle.features.length; index += 1) {
      if (matchedSet.has(index)) continue;
      total += logProb(cls, index, false);
    }
    const entry = scores.find((row) => row.cls === cls);
    if (entry) entry.posterior = total;
  }
  const peak = Math.max(...scores.map((row) => row.posterior));
  const exps = scores.map((row) => Math.exp(row.posterior - peak));
  const normalizer = exps.reduce((sum, value) => sum + value, 0);
  scores = scores.map((row, index) => ({ ...row, posterior: exps[index] / normalizer }));
  const ranked = [...scores].sort((left, right) => right.posterior - left.posterior).slice(0, MAX_RANK_DISPLAY);
  const rankedConditions: RankedCondition[] = ranked.map((row) => {
    const supporting: string[] = [];
    const nonSupporting: string[] = [];
    for (const [symptom, index] of matchedIndices) {
      const presentScore = bundle!.presentLogProb[row.cls][index];
      const absentScore = bundle!.absentLogProb[row.cls][index];
      (presentScore > absentScore ? supporting : nonSupporting).push(symptom);
    }
    return {
      condition: row.cls,
      score: row.posterior,
      supportingSymptoms: supporting,
      nonSupportingSymptoms: nonSupporting,
    };
  });
  return {
    status: "completed",
    modelId: manifest.modelId,
    modelVersion: manifest.modelVersion,
    notice:
      "Ranked possible conditions come from the MedScope statistical classifier trained on labelled symptom data. Scores are relative matches between your reported symptoms and each condition.",
    rankedConditions,
    unmatchedSymptoms: unmatched.length ? unmatched : undefined,
    diagnosticLimitations: manifest.evaluation?.knownLimitations,
  };
}

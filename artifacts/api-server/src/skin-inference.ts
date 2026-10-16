import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import type { InferenceProvider, PredictionOutput } from "./inference";
import { getSkinLabelKnowledge } from "./skin-classes";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");

export type SkinInferenceStatus =
  | {
      available: true;
      mode: "research_only" | "approved";
      modelId: string;
      modelVersion: string;
      readinessState: string;
      preprocessingVersion: string;
      calibrationStatus: string;
      labels: string[];
      readinessNote: string;
    }
  | { available: false; status: "unavailable"; reason: string };

type ResolvedSkinRuntime = {
  artifactDir: string;
  pythonExecutable: string;
  timeoutMs: number;
  enabled: boolean;
};

type ManifestSummary = {
  modelId: string;
  modelVersion: string;
  readinessState: string;
  preprocessingVersion: string;
  calibrationStatus: string;
  labels: string[];
  artifactPath: string;
  artifactSha256: string;
};

type RawSkinInferenceResult = {
  status: string;
  taskId?: string;
  modelId?: string;
  modelVersion?: string;
  preprocessingVersion?: string;
  readinessState?: string;
  calibrationStatus?: string;
  scoreSemantics?: string;
  labels?: string[];
  probabilities?: Record<string, unknown>;
  topLabel?: string;
  topScore?: unknown;
  top2Margin?: unknown;
  differentials?: unknown;
  qualityWarnings?: unknown;
};

export type SkinInferenceResult = {
  modelId: string;
  modelVersion: string;
  preprocessingVersion: string;
  readinessState: string;
  calibrationStatus: string;
  labels: string[];
  probabilities: Array<{ label: string; score: number }>;
  topLabel: string;
  topScore: number;
  top2Margin: number;
  qualityWarnings: string[];
};

let cachedStatus: { at: number; value: SkinInferenceStatus; summary: ManifestSummary | null } | null = null;
const STATUS_CACHE_TTL_MS = 30_000;

function envLimit(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function resolveSkinRuntime(): ResolvedSkinRuntime {
  const artifactDir = process.env.SKIN_MODEL_DIR
    ? path.resolve(repositoryRoot, process.env.SKIN_MODEL_DIR)
    : path.resolve(repositoryRoot, "outputs/ml/skin/pad-ufes20-v1-cnn-baseline-20261015");
  const pythonExecutable = process.env.SKIN_PYTHON
    ? path.resolve(repositoryRoot, process.env.SKIN_PYTHON)
    : path.resolve(repositoryRoot, "ml/skin/.venv/Scripts/python.exe");
  return {
    artifactDir,
    pythonExecutable,
    timeoutMs: envLimit("SKIN_INFER_TIMEOUT_MS", 60_000),
    enabled: process.env.SKIN_RESEARCH_INFERENCE_ENABLED !== "false",
  };
}

let testInferCommand: string[] | undefined;

export function setTestSkinInferCommand(command: string[] | undefined): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("A test skin infer command can only be installed in test mode");
  }
  testInferCommand = command;
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

async function loadManifestSummary(runtime: ResolvedSkinRuntime): Promise<ManifestSummary> {
  const manifestPath = path.join(runtime.artifactDir, "manifest.json");
  const raw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw) as Record<string, unknown>;
  const asString = (value: unknown, field: string): string => {
    if (typeof value !== "string" || value.length === 0) throw new Error(`Manifest field ${field} is not a usable string`);
    return value;
  };
  const labelsRaw = manifest["labels"];
  if (!Array.isArray(labelsRaw) || labelsRaw.length < 2 || !labelsRaw.every((label) => typeof label === "string")) {
    throw new Error("Manifest labels must be a non-trivial string array");
  }
  const artifact = manifest["artifact"] as { path?: unknown; sha256?: unknown } | undefined;
  const artifactPath = asString(artifact?.path, "artifact.path");
  const artifactSha256 = asString(artifact?.["sha256"], "artifact.sha256");
  const manifestSummary: ManifestSummary = {
    modelId: asString(manifest["modelId"], "modelId"),
    modelVersion: asString(manifest["modelVersion"], "modelVersion"),
    readinessState: asString(manifest["readinessState"], "readinessState"),
    preprocessingVersion: asString(manifest["preprocessingVersion"], "preprocessingVersion"),
    calibrationStatus: asString(manifest["calibrationStatus"], "calibrationStatus"),
    labels: labelsRaw as string[],
    artifactPath,
    artifactSha256,
  };
  await sha256File(path.join(runtime.artifactDir, artifactPath)).then((actual) => {
    if (actual !== artifactSha256) throw new Error("Skin model artifact checksum does not match the manifest");
  });
  return manifestSummary;
}

export async function getSkinInferenceStatus(): Promise<SkinInferenceStatus> {
  const runtime = resolveSkinRuntime();
  if (cachedStatus && Date.now() - cachedStatus.at < STATUS_CACHE_TTL_MS) return cachedStatus.value;
  let value: SkinInferenceStatus;
  let summary: ManifestSummary | null = null;
  try {
    if (!runtime.enabled) {
      value = { available: false, status: "unavailable", reason: "Research-only skin inference is disabled by configuration (SKIN_RESEARCH_INFERENCE_ENABLED=false)." };
    } else {
      summary = await loadManifestSummary(runtime);
      if (summary.readinessState === "approved") {
        value = {
          available: true,
          mode: "approved",
          modelId: summary.modelId,
          modelVersion: summary.modelVersion,
          readinessState: summary.readinessState,
          preprocessingVersion: summary.preprocessingVersion,
          calibrationStatus: summary.calibrationStatus,
          labels: summary.labels,
          readinessNote: "Approved model artifact verified by checksum.",
        };
      } else {
        value = {
          available: true,
          mode: "research_only",
          modelId: summary.modelId,
          modelVersion: summary.modelVersion,
          readinessState: summary.readinessState,
          preprocessingVersion: summary.preprocessingVersion,
          calibrationStatus: summary.calibrationStatus,
          labels: summary.labels,
          readinessNote:
            "Verified research-only baseline (checksum-checked), not clinically validated. Scores are raw model outputs, not diagnoses.",
        };
      }
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    const reason = err?.code === "ENOENT" ? "No skin model artifact is installed at the configured location." : `Skin inference could not be initialized: ${error instanceof Error ? error.message : String(error)}`;
    value = { available: false, status: "unavailable", reason };
  }
  cachedStatus = { at: Date.now(), value, summary };
  return value;
}

export function resetSkinInferenceCache(): void {
  cachedStatus = null;
}

export class SkinInferenceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function finiteNumber(label: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new SkinInferenceError("model_malformed_result", `${label} is not a finite number`);
  return value;
}

export function validateSkinInferenceResult(result: unknown, expectedLabels: string[]): SkinInferenceResult {
  if (typeof result !== "object" || result === null) throw new SkinInferenceError("model_malformed_result", "Inference output is not an object");
  const record = result as RawSkinInferenceResult;
  if (record.status !== "ok") {
    throw new SkinInferenceError("model_inference_failed", String(record.status));
  }
  if (!Array.isArray(record.labels) || record.labels.length !== expectedLabels.length || record.labels.some((label, index) => label !== expectedLabels[index])) {
    throw new SkinInferenceError("model_label_mismatch", "Inference output label order does not match the manifest");
  }
  const probabilities = record.probabilities;
  if (typeof probabilities !== "object" || probabilities === null) throw new SkinInferenceError("model_malformed_result", "Missing probabilities");
  const rows = record.labels.map((label) => ({
    label,
    score: finiteNumber(`probabilities.${label}`, (probabilities as Record<string, unknown>)[label]),
  }));
  if (rows.some((row) => row.score < 0 || row.score > 1)) throw new SkinInferenceError("model_malformed_result", "Scores outside [0, 1]");
  const sum = rows.reduce((total, row) => total + row.score, 0);
  if (Math.abs(sum - 1) > 0.005) throw new SkinInferenceError("model_malformed_result", "Scores do not sum to 1");
  const sorted = [...rows].sort((left, right) => right.score - left.score);
  if (record.topLabel !== sorted[0].label) throw new SkinInferenceError("model_malformed_result", "topLabel is not the highest-scoring label");
  const topScore = finiteNumber("topScore", record.topScore);
  if (Math.abs(topScore - sorted[0].score) > 1e-6) throw new SkinInferenceError("model_malformed_result", "topScore disagrees with the argmax score");
  const top2Margin = record.top2Margin === undefined ? topScore - sorted[1].score : finiteNumber("top2Margin", record.top2Margin);
  const differentials = record.differentials;
  if (!Array.isArray(differentials)) throw new SkinInferenceError("model_malformed_result", "Missing differentials");
  if (differentials.length !== sorted.length - 1) throw new SkinInferenceError("model_malformed_result", "Differentials must cover every non-top label exactly once");
  differentials.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null) throw new SkinInferenceError("model_malformed_result", "Invalid differential entry");
    const differential = entry as { disease?: unknown; confidence?: unknown };
    if (differential.disease !== sorted[index + 1].label) throw new SkinInferenceError("model_malformed_result", "Differential label order mismatch");
    if (typeof differential.confidence !== "number" || !Number.isFinite(differential.confidence) || Math.abs(differential.confidence - sorted[index + 1].score) > 1e-6) {
      throw new SkinInferenceError("model_malformed_result", "Differential score mismatch");
    }
  });
  const qualityWarnings = record.qualityWarnings;
  if (qualityWarnings !== undefined && (!Array.isArray(qualityWarnings) || qualityWarnings.some((warning) => typeof warning !== "string"))) {
    throw new SkinInferenceError("model_malformed_result", "qualityWarnings must be a string array");
  }
  return {
    modelId: String(record.modelId ?? ""),
    modelVersion: String(record.modelVersion ?? ""),
    preprocessingVersion: String(record.preprocessingVersion ?? ""),
    readinessState: String(record.readinessState ?? ""),
    calibrationStatus: String(record.calibrationStatus ?? ""),
    labels: record.labels,
    probabilities: rows,
    topLabel: record.topLabel as string,
    topScore,
    top2Margin,
    qualityWarnings: (qualityWarnings ?? []) as string[],
  };
}

async function spawnSkinInfer(image: Buffer, runtime: ResolvedSkinRuntime, manifest: ManifestSummary): Promise<SkinInferenceResult> {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "skin-infer-"));
  const imagePath = path.join(tempDirectory, "input-image");
  try {
    await writeFile(imagePath, image);
    const argv =
      testInferCommand ??
      [runtime.pythonExecutable, "-m", "medscope_skin", "infer", "--artifact-dir", runtime.artifactDir, "--image", imagePath];
    const { stdout, exitCode } = await new Promise<{ stdout: string; exitCode: number | null }>((resolvePromise, rejectPromise) => {
      const child = spawn(argv[0], argv.slice(1), { cwd: testInferCommand ? undefined : repositoryRoot, windowsHide: true });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        rejectPromise(new SkinInferenceError("model_timeout", "Skin inference timed out"));
      }, runtime.timeoutMs);
      child.stdout.on("data", (chunk) => {
        if (stdout.length < 1_000_000) stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        if (stderr.length < 100_000) stderr += String(chunk);
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        rejectPromise(new SkinInferenceError("model_launch_failed", `Could not launch skin inference: ${error.message}`));
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolvePromise({ stdout, exitCode: code });
        void stderr;
      });
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new SkinInferenceError("model_malformed_result", exitCode === 0 ? "Skin inference produced unparseable output" : "Skin inference failed with no structured error");
    }
    if (exitCode !== 0) {
      const payload = typeof parsed === "object" && parsed !== null ? (parsed as { error?: unknown; message?: unknown }) : undefined;
      if (payload && typeof payload.error === "string") {
        throw new SkinInferenceError(`model_${payload.error}`, String(payload.message ?? "Skin inference failed"));
      }
      throw new SkinInferenceError("model_inference_failed", "Skin inference exited with an error");
    }
    const validated = validateSkinInferenceResult(parsed, manifest.labels);
    if (validated.modelId !== manifest.modelId || validated.modelVersion !== manifest.modelVersion || validated.preprocessingVersion !== manifest.preprocessingVersion) {
      throw new SkinInferenceError("model_manifest_mismatch", "Inference output does not match the verified manifest identity");
    }
    return validated;
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

export function mapSkinResultToPredictionOutput(result: SkinInferenceResult): PredictionOutput {
  const knowledge = getSkinLabelKnowledge(result.topLabel);
  if (!knowledge) return mapSkinResultToGenericPrediction(result);
  const confidencePercent = (result.topScore * 100).toFixed(1);
  const runNotes = [
    result.top2Margin < 0.1 ? "Alternative candidates were close, so the ordering between the top two conditions is not decisive." : `The next closest condition scored ${(result.top2Margin * 100).toFixed(1)} percentage points lower.`,
    result.qualityWarnings.includes("source_resolution_below_preprocessing_size") ? "The uploaded image was lower resolution than the preprocessing target, which reduces accuracy." : undefined,
    "Image-based analysis cannot confirm a condition — in-person evaluation by a dermatologist is always recommended.",
  ].filter((note): note is string => Boolean(note));
  return {
    disease: knowledge.displayName,
    confidence: result.topScore,
    description: knowledge.clinicalDescription(confidencePercent),
    severity: knowledge.severity,
    recommendations: [...knowledge.recommendations, ...runNotes],
    differentialDiagnoses: result.probabilities
      .filter((row) => row.label !== result.topLabel)
      .map((row) => ({ disease: getSkinLabelKnowledge(row.label)?.shortName ?? row.label, confidence: row.score })),
    preprocessingSteps: [
      `Image Resizing (${result.preprocessingVersion.match(/(\d+)/)?.[1] ?? "160"}×${result.preprocessingVersion.match(/(\d+)/)?.[1] ?? "160"} center-fit)`,
      "Color Space Conversion (RGB)",
      "Pixel Normalization (dataset mean/std)",
    ],
    modelId: result.modelId,
    modelVersion: result.modelVersion,
    preprocessingVersion: result.preprocessingVersion,
    scoreSemantics: "raw_model_score",
  };
}

function mapSkinResultToGenericPrediction(result: SkinInferenceResult): PredictionOutput {
  return {
    disease: result.topLabel,
    confidence: result.topScore,
    description: `The AI model ranks ${result.topLabel} as the leading candidate at ${(result.topScore * 100).toFixed(1)}% confidence for this skin image.`,
    severity: "unassessed",
    recommendations: [
      `A dermatologist is best placed to assess what ${result.topLabel} means for you in person.`,
      ...result.probabilities.filter((row) => row.label !== result.topLabel).map((row) => `${getSkinLabelKnowledge(row.label)?.shortName ?? row.label} scored ${(row.score * 100).toFixed(1)}%.`),
    ],
    differentialDiagnoses: result.probabilities.filter((row) => row.label !== result.topLabel).map((row) => ({ disease: row.label, confidence: row.score })),
    preprocessingSteps: [`Preprocessing version: ${result.preprocessingVersion}`],
    modelId: result.modelId,
    modelVersion: result.modelVersion,
    preprocessingVersion: result.preprocessingVersion,
    scoreSemantics: "raw_model_score",
  };
}

export async function getResearchSkinInferenceProvider(): Promise<
  (InferenceProvider & { readonly mode: "research_only" | "approved" }) | undefined
> {
  const status = await getSkinInferenceStatus();
  if (!status.available) return undefined;
  const manifest = cachedStatus?.summary;
  if (!manifest) return undefined;
  return {
    mode: status.mode,
    async predict(image: Buffer): Promise<PredictionOutput> {
      const result = await spawnSkinInfer(image, resolveSkinRuntime(), manifest);
      return mapSkinResultToPredictionOutput(result);
    },
  };
}

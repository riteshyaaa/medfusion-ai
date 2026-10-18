import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.NODE_ENV = "test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const defaultArtifactDir = path.join(repoRoot, "outputs/ml/skin/pad-ufes20-v1-cnn-baseline-20261015");
const pythonExecutable = path.join(repoRoot, "ml/skin/.venv/Scripts/python.exe");
const artifactPresent = existsSync(path.join(defaultArtifactDir, "manifest.json")) && existsSync(path.join(defaultArtifactDir, "model.pt"));
const pythonPresent = existsSync(pythonExecutable);

const [
  skinInferenceModule,
] = await Promise.all([
  import("../src/skin-inference"),
]);

const { getSkinInferenceStatus, validateSkinInferenceResult, SkinInferenceError, setTestSkinInferCommand, resetSkinInferenceCache, mapSkinResultToPredictionOutput } = skinInferenceModule;

const validLabels = ["ACK", "BCC", "MEL", "NEV", "SCC", "SEK"];

function fixtureResult() {
  const probabilities: Record<string, number> = validLabels.reduce<Record<string, number>>((acc, label, index) => {
    acc[label] = index === 4 ? 0.5 : 0.1;
    return acc;
  }, {});
  return {
    status: "ok",
    modelId: "medscope-skin-pad-ufes-v1",
    modelVersion: "pad-ufes20-v1-cnn-baseline-20261015",
    preprocessingVersion: "pad-ufes-rgb-160-center-fit-v1",
    readinessState: "research_only_not_approved",
    calibrationStatus: "not_calibrated",
    scoreSemantics: "raw_model_score",
    labels: validLabels,
    probabilities,
    topLabel: "SCC",
    topScore: 0.5,
    top2Margin: 0.4,
    differentials: validLabels.filter((label) => label !== "SCC").map((label) => ({ disease: label, confidence: 0.1 })),
    qualityWarnings: [],
  };
}

after(() => {
  setTestSkinInferCommand(undefined);
});

test("validation rejects malformed model outputs", () => {
  const base = fixtureResult();

  assert.throws(() => validateSkinInferenceResult({ ...base, status: "error" }, validLabels), /error/);
  assert.throws(() => validateSkinInferenceResult({ ...base, topLabel: "ACK" }, validLabels), /argmax|highest-scoring label|disagrees with the argmax/);
  assert.throws(() => validateSkinInferenceResult({ ...base, topScore: 0.1 }, validLabels), /argmax|highest-scoring label|disagrees with the argmax/);
  assert.throws(() => validateSkinInferenceResult({ ...base, probabilities: { ...base.probabilities, MEL: Number.NaN } }, validLabels), /finite/);
  assert.throws(() => validateSkinInferenceResult({ ...base, probabilities: { ...base.probabilities, MEL: 1.5 }, topLabel: "MEL", topScore: 1.5, differentials: validLabels.filter((l) => l !== "MEL").map((label, index) => ({ disease: label, confidence: index === 0 ? 0.5 : 0.1 })) }, validLabels), /\[0, 1\]/);
  assert.throws(() => validateSkinInferenceResult({ ...base, differentials: [] }, validLabels), /Differentials/);
  assert.throws(() => validateSkinInferenceResult({ ...base, labels: ["A", "B", "C", "D", "E", "F"] }, validLabels), /label order/);
  assert.throws(() => validateSkinInferenceResult(null, validLabels), /not an object/);
  const parsed = validateSkinInferenceResult(base, validLabels);
  assert.equal(parsed.topLabel, "SCC");
  assert.equal(parsed.probabilities.length, 6);
  assert.ok(Math.abs(parsed.probabilities.reduce((sum, row) => sum + row.score, 0) - 1) < 1e-6);
});

test("mapped prediction output presents the leading class with clinical context", () => {
  const mapped = mapSkinResultToPredictionOutput(validateSkinInferenceResult({ ...fixtureResult(), topScore: 0.31, top2Margin: 0.172, probabilities: { ACK: 0.138, BCC: 0.138, MEL: 0.138, NEV: 0.138, SCC: 0.31, SEK: 0.138 }, differentials: ["ACK", "BCC", "MEL", "NEV", "SEK"].map((label) => ({ disease: label, confidence: 0.138 })) }, validLabels));
  assert.equal(mapped.disease, "Squamous Cell Carcinoma (SCC)");
  assert.equal(mapped.severity, "moderate");
  assert.match(mapped.description, /appears most consistent with squamous cell carcinoma/i);
  assert.match(mapped.description, /31\.0\% confidence/);
  assert.equal(mapped.scoreSemantics, "raw_model_score");
  assert.match(mapped.recommendations.join(" "), /dermatolog/);
  assert.ok(mapped.differentialDiagnoses.every((row) => row.disease.length > 3 && !/^(ACK|BCC|MEL|NEV|SCC|SEK)$/.test(row.disease)));
  assert.ok(mapped.preprocessingSteps.length >= 2);
});

test("benign classes map to mild severity and benign display names", () => {
  const probabilities = { ACK: 0.1, BCC: 0.1, MEL: 0.1, NEV: 0.55, SCC: 0.075, SEK: 0.075 };
  const mapped = mapSkinResultToPredictionOutput(validateSkinInferenceResult({ ...fixtureResult(), topLabel: "NEV", topScore: 0.55, top2Margin: 0.45, probabilities, differentials: [{ disease: "ACK", confidence: 0.1 }, { disease: "BCC", confidence: 0.1 }, { disease: "MEL", confidence: 0.1 }, { disease: "SCC", confidence: 0.075 }, { disease: "SEK", confidence: 0.075 }] }, validLabels));
  assert.equal(mapped.severity, "mild");
  assert.equal(mapped.disease, "Common Nevus (Mole)");
  assert.ok(mapped.differentialDiagnoses.some((row) => row.disease.includes("Seborrheic Keratosis")));
});

test("status reports unavailable when no artifact is installed", async () => {
  process.env.SKIN_MODEL_DIR = path.join(repoRoot, "outputs/ml/skin/definitely-not-installed");
  process.env.SKIN_RESEARCH_INFERENCE_ENABLED = "true";
  resetSkinInferenceCache();
  const status = await getSkinInferenceStatus();
  assert.equal(status.available, false);
  if (!status.available) assert.match(status.reason, /no skin model artifact|could not be initialized/i);
  delete process.env.SKIN_MODEL_DIR;
  resetSkinInferenceCache();
});

test("status reports unavailable when research inference is disabled", async () => {
  process.env.SKIN_RESEARCH_INFERENCE_ENABLED = "false";
  resetSkinInferenceCache();
  const status = await getSkinInferenceStatus();
  assert.equal(status.available, false);
  if (!status.available) assert.match(status.reason, /disabled by configuration/);
  process.env.SKIN_RESEARCH_INFERENCE_ENABLED = "true";
  resetSkinInferenceCache();
});

if (artifactPresent) test("status verifies the installed research artifact checksum", async () => {
  resetSkinInferenceCache();
  const status = await getSkinInferenceStatus();
  assert.equal(status.available, true);
  if (status.available) {
    assert.equal(status.mode, "research_only");
    assert.equal(status.modelId, "medscope-skin-pad-ufes-v1");
    assert.equal(status.modelVersion, "pad-ufes20-v1-cnn-baseline-20261015");
    assert.match(status.readinessNote, /not clinically validated/i);
  }
});

if (artifactPresent) test("provider refuses a spawned result that does not match the verified manifest identity", async () => {
  resetSkinInferenceCache();
  setTestSkinInferCommand(["node", "-e", `console.log(JSON.stringify(${JSON.stringify({ ...fixtureResult(), modelId: "spoofed-model" }).replace(/'/g, "\\'")}))`]);
  const { getResearchSkinInferenceProvider } = skinInferenceModule;
  const provider = await getResearchSkinInferenceProvider();
  assert.ok(provider);
  await assert.rejects(() => provider.predict(Buffer.from("x")), (error: unknown) => error instanceof SkinInferenceError && error.code === "model_manifest_mismatch");
  setTestSkinInferCommand(undefined);
});

if (artifactPresent && pythonPresent) test("spawned malformed JSON and failures surface as structured errors", async () => {
  resetSkinInferenceCache();
  setTestSkinInferCommand(["node", "-e", "console.log('definitely not json')"]);
  const { getResearchSkinInferenceProvider } = skinInferenceModule;
  const provider = await getResearchSkinInferenceProvider();
  assert.ok(provider);
  await assert.rejects(() => provider.predict(Buffer.from("x")), (error: unknown) => error instanceof SkinInferenceError && error.code === "model_malformed_result");
  setTestSkinInferCommand(["node", "-e", "console.log(JSON.stringify({status:'error',error:'artifact_missing',message:'gone'}));process.exit(2)"]);
  await assert.rejects(() => provider.predict(Buffer.from("x")), (error: unknown) => error instanceof SkinInferenceError && error.code === "model_artifact_missing");
  setTestSkinInferCommand(undefined);
});

if (artifactPresent && pythonPresent) test("inference timeout is enforced structurally", async () => {
  process.env.SKIN_INFER_TIMEOUT_MS = "400";
  resetSkinInferenceCache();
  setTestSkinInferCommand(["node", "-e", "setTimeout(()=>{console.log('{}')},5000)"]);
  const { getResearchSkinInferenceProvider } = skinInferenceModule;
  const provider = await getResearchSkinInferenceProvider();
  assert.ok(provider);
  await assert.rejects(() => provider.predict(Buffer.from("x")), (error: unknown) => error instanceof SkinInferenceError && error.code === "model_timeout");
  setTestSkinInferCommand(undefined);
  delete process.env.SKIN_INFER_TIMEOUT_MS;
  resetSkinInferenceCache();
});

if (artifactPresent && pythonPresent) test("real research checkpoint produces finite ranked probabilities for a valid image", async () => {
  before(async () => { resetSkinInferenceCache(); });
  const { default: sharp } = await import("sharp");
  // Brown skin background with a darker central lesion-like patch so the
  // screening stage classifies the image as skin with a present lesion.
  const base = sharp({ create: { width: 220, height: 200, channels: 3, background: { r: 120, g: 100, b: 90 } } });
  const lesionPatch = await sharp({ create: { width: 70, height: 70, channels: 3, background: { r: 60, g: 40, b: 30 } } }).png().toBuffer();
  const image = await base.composite([{ input: lesionPatch, left: 75, top: 65 }]).png().toBuffer();
  const status = await getSkinInferenceStatus();
  assert.equal(status.available, true);
  const { getResearchSkinInferenceProvider } = skinInferenceModule;
  const provider = await getResearchSkinInferenceProvider();
  assert.ok(provider);
  assert.equal(provider.mode, "research_only");
  const output = await provider.predict(image);
  assert.equal(output.modelId, "medscope-skin-pad-ufes-v1");
  assert.ok(validLabels.some((label) => output.disease.includes(label)));
  assert.ok(output.confidence > 0 && output.confidence <= 1);
  assert.ok(Number.isFinite(output.confidence));
  const shownNames = output.differentialDiagnoses.map((row) => row.disease).sort();
  const displayNames: Record<string, string> = { ACK: "Actinic Keratosis", BCC: "Basal Cell Carcinoma", MEL: "Melanoma", NEV: "Common Nevus", SCC: "Squamous Cell Carcinoma", SEK: "Seborrheic Keratosis" };
  const topLabelCode = /\(([A-Z]{3})\)$/.exec(output.disease)?.[1];
  assert.ok(topLabelCode && validLabels.includes(topLabelCode));
  assert.deepEqual(shownNames, validLabels
    .filter((label) => label !== topLabelCode)
    .map((label) => displayNames[label])
    .sort());
  assert.equal(output.scoreSemantics, "raw_model_score");
  assert.match(output.description, /appears most consistent with|the AI associates with|evaluat/i);
  before(async () => { resetSkinInferenceCache(); });
});

if (artifactPresent && pythonPresent) test("image screening flags uniform skin as normal and rejects non-skin colours", async () => {
  const { default: sharp } = await import("sharp");
  const { getResearchSkinInferenceProvider } = skinInferenceModule;
  const provider = await getResearchSkinInferenceProvider();
  assert.ok(provider);

  const flatSkin = await sharp({ create: { width: 220, height: 200, channels: 3, background: { r: 120, g: 100, b: 90 } } }).png().toBuffer();
  const normal = await provider.predict(flatSkin);
  assert.equal(normal.disease, "No visible skin abnormality");
  assert.equal(normal.differentialDiagnoses.length, 0);
  assert.equal(normal.severity, "unassessed");
  assert.equal(normal.confidence, 0.85);

  const notSkin = await sharp({ create: { width: 220, height: 200, channels: 3, background: { r: 40, g: 80, b: 220 } } }).png().toBuffer();
  const rejected = await provider.predict(notSkin);
  assert.equal(rejected.disease, "Not a valid skin image");
  assert.equal(rejected.confidence, 0.85);
  assert.equal(rejected.differentialDiagnoses.length, 0);
});

after(() => {
  delete process.env.SKIN_MODEL_DIR;
  process.env.SKIN_RESEARCH_INFERENCE_ENABLED = "true";
  resetSkinInferenceCache();
});

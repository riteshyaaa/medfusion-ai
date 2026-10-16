import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.NODE_ENV = "test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const [cardiacModule] = await Promise.all([
  import("../src/cardiac"),
]);

const {
  getCardiacInferenceStatus,
  assessCardiacRisk,
  CardiacFeatureError,
  hasApprovedCardiacModel,
  resetCardiacCache,
  CARDIAC_MODEL_CONTRACT,
} = cardiacModule;

const highRisk = {
  age: 58, sex: "male", chestPainType: "asymptomatic", restingBloodPressure: 140, serumCholesterol: 260,
  fastingBloodSugarOver120: "no", restingEcg: "st_t_abnormality", maxHeartRate: 130, exerciseAngina: "yes",
  stDepression: 3.2, stSlope: "flat", majorVessels: 2, thalassemia: "reversible_defect",
};
const lowRisk = {
  age: 40, sex: "female", chestPainType: "typical_angina", restingBloodPressure: 110, serumCholesterol: 180,
  fastingBloodSugarOver120: "no", restingEcg: "normal", maxHeartRate: 175, exerciseAngina: "no",
  stDepression: 0, stSlope: "upsloping", majorVessels: 0, thalassemia: "normal",
};

before(() => {
  delete process.env.CARDIAC_MODEL_DIR;
  resetCardiacCache();
});

test("approval gate stays closed even when a research artifact is served", () => {
  assert.equal(hasApprovedCardiacModel(), false);
});

test("verified bundle exposes a research-only status with held-out metrics", async () => {
  const status = await getCardiacInferenceStatus();
  assert.equal(status.available, true);
  if (status.available) {
    assert.equal(status.mode, "research_only");
    assert.equal(status.modelId, "medscope-cardiac-logreg-v1");
    assert.equal(status.modelVersion, "cardiac-logreg-20261016");
    assert.equal(status.calibrationStatus, "uncalibrated");
    const test = (status.metrics as { test?: { rocAuc?: number } }).test;
    assert.ok(typeof test?.rocAuc === "number" && test.rocAuc > 0.5);
    assert.match(status.readinessNote, /not clinically validated|uncalibrated/i);
  }
  assert.equal(CARDIAC_MODEL_CONTRACT.features.length, 13);
});

test("risk scoring matches the pinned python-scale fixtures", async () => {
  const high = await assessCardiacRisk(highRisk);
  assert.equal(high.status, "research_only");
  assert.equal(high.label, "disease");
  assert.equal(high.aboveThreshold, true);
  assert.ok(Math.abs((high.riskScore ?? 0) - 0.99709692) < 0.00005, `expected pinned high-risk ~0.99709692, got ${high.riskScore}`);
  assert.equal(high.topFactors.length, 3);
  assert.ok(high.topFactors.every((factor) => Number.isFinite(factor.contribution)));
  assert.match(high.notice, /not a probability of heart disease|not clinical advice/i);

  const low = await assessCardiacRisk(lowRisk);
  assert.equal(low.label, "no_disease");
  assert.ok(Math.abs((low.riskScore ?? 0) - 0.0028402) < 0.00005, `expected pinned low-risk ~0.0028402, got ${low.riskScore}`);
});

test("unsupported categorical values are rejected, never coerced", async () => {
  await assert.rejects(
    () => assessCardiacRisk({ ...lowRisk, chestPainType: "banana" as typeof lowRisk.chestPainType }),
    (error: unknown) => error instanceof CardiacFeatureError && error.field === "chestPainType",
  );
  await assert.rejects(
    () => assessCardiacRisk({ ...lowRisk, majorVessels: 1.5 }),
    (error: unknown) => error instanceof CardiacFeatureError && error.field === "majorVessels",
  );
  await assert.rejects(
    () => assessCardiacRisk({ ...lowRisk, stDepression: 2.25 }),
    (error: unknown) => error instanceof CardiacFeatureError && error.field === "stDepression",
  );
});

test("without an installed bundle the contract is returned but no score is served", async () => {
  process.env.CARDIAC_MODEL_DIR = path.join(repoRoot, "models/registry/cardiac/not-installed");
  resetCardiacCache();
  const result = await assessCardiacRisk(lowRisk);
  assert.equal(result.status, "model_unavailable");
  assert.equal(result.riskScore, null);
  assert.equal(result.label, null);
  assert.match(result.notice, /no approved cardiac model|nothing is served|no approved cardiac/i);
  resetCardiacCache();
  delete process.env.CARDIAC_MODEL_DIR;
  resetCardiacCache();
});

after(() => {
  delete process.env.CARDIAC_MODEL_DIR;
  resetCardiacCache();
});

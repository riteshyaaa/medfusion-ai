import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, test } from "node:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  cardiacResearchServingPolicy,
  CARDIAC_RESEARCH_SERVING_ENV,
  resetCardiacCache,
  CARDIAC_MODEL_CONTRACT,
} = cardiacModule;

const SERVING_ENV = CARDIAC_RESEARCH_SERVING_ENV;

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
  delete process.env[SERVING_ENV];
  resetCardiacCache();
});

test("approval gate stays closed even when a research artifact is served", () => {
  assert.equal(hasApprovedCardiacModel(), false);
});

test("research serving is disabled by default and only the exact opt-in enables it", () => {
  delete process.env[SERVING_ENV];
  assert.equal(cardiacResearchServingPolicy().enabled, false);
  assert.match(cardiacResearchServingPolicy().reason, /disabled by default/i);
  for (const value of ["1", "TRUE", "yes", "enabled", "false", ""]) {
    process.env[SERVING_ENV] = value;
    assert.equal(cardiacResearchServingPolicy().enabled, false, `value ${value} must not enable research serving`);
  }
  process.env[SERVING_ENV] = "true";
  assert.equal(cardiacResearchServingPolicy().enabled, true);
  delete process.env[SERVING_ENV];
});

test("without the opt-in the inference status reports a verified artifact but closed serving", async () => {
  const status = await getCardiacInferenceStatus();
  assert.equal(status.available, true);
  assert.equal(status.researchServing.enabled, false);
  assert.match(status.researchServing.reason, /disabled by default/i);
});

test("with the opt-in the inference status reports research serving enabled", async () => {
  process.env[SERVING_ENV] = "true";
  resetCardiacCache();
  const status = await getCardiacInferenceStatus();
  assert.equal(status.available, true);
  assert.equal(status.researchServing.enabled, true);
  assert.match(status.researchServing.reason, /research scores/i);
  delete process.env[SERVING_ENV];
  resetCardiacCache();
});

test("disabled research serving produces an honest unavailable result, never a score", async () => {
  delete process.env[SERVING_ENV];
  resetCardiacCache();
  const result = await assessCardiacRisk(lowRisk);
  assert.equal(result.status, "model_unavailable");
  assert.equal(result.riskScore, null);
  assert.equal(result.label, null);
  assert.equal(result.topFactors.length, 0);
  assert.match(result.notice, /disabled by configuration|CARDIAC_RESEARCH_INFERENCE_ENABLED/i);
  assert.ok(result.diagnosticLimitations.length > 0);
});

test("verified bundle exposes a research-only status with held-out metrics", async () => {
  process.env[SERVING_ENV] = "true";
  resetCardiacCache();
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
  process.env[SERVING_ENV] = "true";
  resetCardiacCache();
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

function writeTamperedArtifact(mutations: Record<string, (content: string) => string>): string {
  const dir = path.join(repoRoot, "models/registry/cardiac/tampered-test-artifact");
  const sourceDir = path.join(repoRoot, "models/registry/cardiac/logreg-v20261016");
  const files = ["bundle.json", "manifest.json", "test-fixtures.json"];
  mkdirSync(dir, { recursive: true });
  for (const file of files) {
    const mutate = mutations[file] ?? ((content: string) => content);
    writeFileSync(path.join(dir, file), mutate(readFileSync(path.join(sourceDir, file), "utf8")));
  }
  return dir;
}

function sha256Text(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

test("with research serving enabled, a missing artifact still refuses to score", async () => {
  process.env[SERVING_ENV] = "true";
  process.env.CARDIAC_MODEL_DIR = path.join(repoRoot, "models/registry/cardiac/not-installed");
  resetCardiacCache();
  const result = await assessCardiacRisk(lowRisk);
  assert.equal(result.status, "model_unavailable");
  assert.equal(result.riskScore, null);
  assert.equal(result.label, null);
  assert.match(result.notice, /no verified cardiac research artifact|no alternate model/i);
});

test("a bundle that fails its checksum is never served", async () => {
  process.env[SERVING_ENV] = "true";
  process.env.CARDIAC_MODEL_DIR = writeTamperedArtifact({
    "bundle.json": (content) => content.replace(/"intercept":\s*-?[\d.eE+]+/, (match) => `${match.slice(0, -1)}9`),
  });
  resetCardiacCache();
  const status = await getCardiacInferenceStatus();
  assert.equal(status.available, false);
  if (!status.available) assert.match(status.reason, /checksum does not match/i);
  resetCardiacCache();
});

test("a bundle with an incompatible feature contract fails closed", async () => {
  process.env[SERVING_ENV] = "true";
  const mutateBundle = (content: string) => content.replace('"categorical:sex=male",', "");
  process.env.CARDIAC_MODEL_DIR = writeTamperedArtifact({
    "bundle.json": mutateBundle,
    "manifest.json": (content) => {
      const tamperedBundleSha = sha256Text(mutateBundle(readFileSync(path.join(repoRoot, "models/registry/cardiac/logreg-v20261016/bundle.json"), "utf8")));
      return content.replace(/"sha256":\s*"[0-9a-f]{64}"/, `"sha256": "${tamperedBundleSha}"`);
    },
  });
  resetCardiacCache();
  const status = await getCardiacInferenceStatus();
  assert.equal(status.available, false);
  if (!status.available) assert.match(status.reason, /self-check failed|coefficients do not match/i);
  resetCardiacCache();
});

test("self-check failure (pinned fixtures no longer reproduce) fails closed", async () => {
  process.env[SERVING_ENV] = "true";
  const mutateFixtures = (content: string) => content.replace("0.9970969242581661", "0.123456789");
  process.env.CARDIAC_MODEL_DIR = writeTamperedArtifact({
    "test-fixtures.json": mutateFixtures,
    "manifest.json": (content) => {
      const fixturesSha = sha256Text(mutateFixtures(readFileSync(path.join(repoRoot, "models/registry/cardiac/logreg-v20261016/test-fixtures.json"), "utf8")));
      return content.replace(/("fixturesFile":\s*"test-fixtures.json",\s*\n\s*"sha256":\s*")[0-9a-f]{64}/, `$1${fixturesSha}`);
    },
  });
  resetCardiacCache();
  const status = await getCardiacInferenceStatus();
  assert.equal(status.available, false);
  if (!status.available) assert.match(status.reason, /self-check failed/i);
  resetCardiacCache();
});

test("without an installed bundle the contract is returned but no score is served", async () => {
  process.env[SERVING_ENV] = "true";
  process.env.CARDIAC_MODEL_DIR = path.join(repoRoot, "models/registry/cardiac/not-installed");
  resetCardiacCache();
  const result = await assessCardiacRisk(lowRisk);
  assert.equal(result.status, "model_unavailable");
  assert.equal(result.riskScore, null);
  assert.equal(result.label, null);
  assert.match(result.notice, /no verified cardiac research artifact/i);
  resetCardiacCache();
  delete process.env.CARDIAC_MODEL_DIR;
  resetCardiacCache();
});

after(() => {
  delete process.env.CARDIAC_MODEL_DIR;
  delete process.env[SERVING_ENV];
  resetCardiacCache();
  rmSync(path.join(repoRoot, "models/registry/cardiac/tampered-test-artifact"), { recursive: true, force: true });
});

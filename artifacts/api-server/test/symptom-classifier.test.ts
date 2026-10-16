import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.NODE_ENV = "test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const [symptomClassifierModule] = await Promise.all([
  import("../src/symptom-classifier"),
]);

const {
  getSymptomClassifierStatus,
  classifySymptoms,
  resetSymptomClassifierCache,
} = symptomClassifierModule;

test("verified symptom bundle exposes a research-only status and catalogue", async () => {
  process.env.SYMPTOM_MODEL_DIR = path.join(repoRoot, "models/registry/symptoms/bernoulli-nb-v20261016");
  resetSymptomClassifierCache();
  const status = await getSymptomClassifierStatus();
  assert.equal(status.available, true);
  if (status.available) {
    assert.equal(status.mode, "research_only");
    assert.equal(status.classCount, 41);
    assert.ok(status.catalogue.includes("itching"));
    assert.ok(status.catalogue.includes("skin rash"));
    assert.equal(status.catalogue.length, 132);
    assert.match(status.readinessNote, /not a diagnosis|cannot diagnose|ranks/i);
  }
});

test("classification matches the pinned python-output fixture and exposes supporting evidence", async () => {
  const outcome = classifySymptoms({ selectedSymptoms: ["itching", "skin_rash"] });
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.modelId, "medscope-symptoms-bernoulli-nb-v1");
  assert.ok(outcome.rankedConditions);
  if (outcome.rankedConditions) {
    const top = outcome.rankedConditions[0]!;
    assert.equal(top.condition, "Fungal infection");
    assert.ok(Math.abs(top.score - 0.915738) < 0.00005, `expected pinned posterior ~0.915738, got ${top.score}`);
    assert.ok(top.supportingSymptoms.includes("itching"));
    assert.ok(top.supportingSymptoms.includes("skin_rash"));
    assert.equal(top.nonSupportingSymptoms.length, 0);
  }
  assert.match(outcome.notice, /not diagnosis probabilities/i);

  const allergy = classifySymptoms({ selectedSymptoms: ["continuous_sneezing"] });
  assert.equal(allergy.rankedConditions?.[0]?.condition, "Allergy");
  assert.ok(Math.abs(allergy.rankedConditions[0]!.score - 0.994854) < 0.00005);
});

test("no symptoms or only unmatched free text yields an honest insufficient state", () => {
  const empty = classifySymptoms({ selectedSymptoms: [] });
  assert.equal(empty.status, "insufficient_input");
  assert.match(empty.notice, /no machine-readable symptoms/i);

  const unmatched = classifySymptoms({ selectedSymptoms: ["totally custom free text"] });
  assert.equal(unmatched.status, "insufficient_input");
  assert.deepEqual(unmatched.unmatchedSymptoms, ["totally custom free text"]);
});

test("mixed free text is kept, not fabricated into a match", () => {
  const mixed = classifySymptoms({ selectedSymptoms: ["itching", "custom patient phrase"] });
  assert.equal(mixed.status, "completed");
  assert.deepEqual(mixed.unmatchedSymptoms, ["custom patient phrase"]);
  assert.equal(mixed.rankedConditions?.length, 8);
  assert.ok(mixed.rankedConditions?.every((row) => row.score > 0 && row.score <= 1));
});

test("status reports unavailable when no bundle is installed", async () => {
  process.env.SYMPTOM_MODEL_DIR = path.join(repoRoot, "models/registry/symptoms/not-installed");
  resetSymptomClassifierCache();
  const status = await getSymptomClassifierStatus();
  assert.equal(status.available, false);
  resetSymptomClassifierCache();
  process.env.SYMPTOM_MODEL_DIR = path.join(repoRoot, "models/registry/symptoms/bernoulli-nb-v20261016");
  resetSymptomClassifierCache();
});

test("empty selection yields the prior-ish ranking without symptoms", () => {
  const outcome = classifySymptoms({ selectedSymptoms: [] });
  assert.equal(outcome.rankedConditions, undefined);
});

before(async () => {
  delete process.env.SYMPTOM_MODEL_DIR;
  resetSymptomClassifierCache();
});

after(() => {
  delete process.env.SYMPTOM_MODEL_DIR;
  resetSymptomClassifierCache();
});

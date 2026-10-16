import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.NODE_ENV = "test";

const [{ assessSymptomGuidance }, { getSymptomClassifierStatus }] = await Promise.all([
  import("../src/symptom-guidance"),
  import("../src/symptom-classifier"),
]);

function baseInput(overrides: Partial<Parameters<typeof assessSymptomGuidance>[0]> = {}): Parameters<typeof assessSymptomGuidance>[0] {
  return { primarySymptom: "nothing specific", symptomCategory: "general", ...overrides };
}

before(async () => {
  await getSymptomClassifierStatus();
});

test("emergency combination: chest pain with breathing difficulty", () => {
  const result = assessSymptomGuidance(baseInput(
    { primarySymptom: "chest pain since morning", symptomCategory: "cardiovascular", associatedSymptoms: ["shortness of breath"] },
  ));
  assert.equal(result.urgencyLevel, "emergency");
  assert.ok(result.redFlagsTriggered.some((flag) => flag === "chest pain"));
  assert.ok(result.redFlagsTriggered.some((flag) => flag.includes("chest pain together with breathing difficulty")));
  assert.match(result.recommendations[0], /emergency services/i);
  assert.ok(result.seekCareIf.length > 0 && result.watchFor.length > 0);
});

test("combination rule: fever with stiff neck and severe headache", () => {
  const result = assessSymptomGuidance(baseInput(
    { primarySymptom: "high fever", associatedSymptoms: ["stiff neck"], selectedSymptoms: [], severity: "severe" },
  ));
  // "high fever" + curated severe headache via selected? no — need explicit third element
  const withHeadache = assessSymptomGuidance(baseInput(
    { primarySymptom: "high fever", associatedSymptoms: ["stiff neck", "severe headache"] },
  ));
  assert.equal(withHeadache.urgencyLevel, "emergency");
  void result;
});

test("catalogue-driven combo: sweating plus chest pain", () => {
  const result = assessSymptomGuidance(baseInput(
    { primarySymptom: "chest pain", selectedSymptoms: ["sweating"] },
  ));
  assert.equal(result.urgencyLevel, "emergency");
  assert.ok(result.redFlagsTriggered.some((flag) => flag.includes("sweating")));
});

test("synonym phrases route into the knowledge base", () => {
  const result = assessSymptomGuidance(baseInput(
    { primarySymptom: "my tummy aches badly and I keep throwing up", severity: "moderate" },
  ));
  assert.equal(result.urgencyLevel, "urgent");
  assert.ok(result.recommendations.some((row) => row.toLowerCase().includes("sip small amounts")));
  assert.ok(result.recommendations.some((row) => row.toLowerCase().includes("rate the pain")));
});

test("guidance is symptom-specific, not generic boilerplate", () => {
  const headache = assessSymptomGuidance(baseInput({ primarySymptom: "headache" }));
  const vomiting = assessSymptomGuidance(baseInput({ primarySymptom: "vomiting" }));
  const cough = assessSymptomGuidance(baseInput({ primarySymptom: "a cough that started recently" }));
  const joined = (result: { recommendations: string[] }) => result.recommendations.join(" ").toLowerCase();
  assert.notEqual(joined(headache), joined(vomiting));
  assert.ok(joined(headache).includes("odd, quiet") || joined(headache).includes("quiet space") || joined(headache).includes("dim"));
  assert.ok(joined(vomiting).includes("sip"));
  assert.ok(joined(cough).includes("smoke-free") || joined(cough).includes("weeks"));
});

test("routine symptoms allow data-grounded possible conditions without a diagnosis claim", () => {
  const result = assessSymptomGuidance(baseInput(
    { primarySymptom: "continuous sneezing and runny nose", selectedSymptoms: ["continuous_sneezing", "runny_nose"] },
  ));
  assert.equal(result.urgencyLevel, "routine");
  assert.equal(result.possibleConditions.length > 0, true);
  assert.ok(result.possibleConditions.every((row) => /research association, not a diagnosis/.test(row.basis)));
  assert.ok(result.possibleConditions[0].name.length > 0);
});

test("suicidal ideation yields the emergency crisis path", () => {
  const result = assessSymptomGuidance(baseInput({ primarySymptom: "i have suicidal thoughts lately" }));
  assert.equal(result.urgencyLevel, "emergency");
  assert.ok(result.recommendations.some((row) => /crisis line/i.test(row)));
});

test("unknown free text still produces honest generic-safe guidance and no fabricated conditions", () => {
  const result = assessSymptomGuidance(baseInput({ primarySymptom: "some vague discomfort about my schedule" }));
  assert.equal(result.urgencyLevel, "routine");
  assert.equal(result.possibleConditions.length, 0);
  assert.match(result.disclaimer, /not a diagnosis/i);
});

test("fever with rash escalates to urgent via combination rule", () => {
  const result = assessSymptomGuidance(baseInput(
    { primarySymptom: "mild fever", associatedSymptoms: ["skin rash"] },
  ));
  assert.equal(result.urgencyLevel, "urgent");
  assert.ok(result.redFlagsTriggered.some((flag) => flag.includes("fever with rash")));
});

test("stroke pattern signs trigger emergency immediately", () => {
  const result = assessSymptomGuidance(baseInput({ primarySymptom: "face drooping and slurred speech since an hour" }));
  assert.equal(result.urgencyLevel, "emergency");
  assert.ok(result.recommendations.some((row) => /exact time the symptoms started/i.test(row)));
});

test("body fluid deficit: dehydration plus vomiting is urgent", () => {
  const result = assessSymptomGuidance(baseInput(
    { primarySymptom: "vomiting", associatedSymptoms: ["sunken eyes", "no urine"], selectedSymptoms: [" dehydration"] },
  ));
  assert.equal(result.urgencyLevel, "urgent");
});

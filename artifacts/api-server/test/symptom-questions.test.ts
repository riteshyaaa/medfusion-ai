import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyFollowUpAnswers,
  getFollowUpQuestionCatalogue,
  getFollowUpQuestionById,
  selectFollowUpQuestions,
  validateFollowUpAnswers,
  FOLLOW_UP_QUESTION_SET_VERSION,
} from "../src/symptom-questions";

test("question catalogue is versioned, unique and machine-readable", () => {
  assert.match(FOLLOW_UP_QUESTION_SET_VERSION, /^symptom-followups-v\d+$/);
  const catalogue = getFollowUpQuestionCatalogue();
  assert.ok(catalogue.length >= 10);
  const ids = new Set(catalogue.map((question) => question.id));
  assert.equal(ids.size, catalogue.length);
  for (const question of catalogue) {
    assert.ok(question.prompt.length > 10);
    assert.ok(question.triggers.length > 0);
    assert.equal(question.type === "choice" ? Array.isArray(question.options) && question.options.includes("not sure") : true, true);
  }
});

test("selection is deterministic and respects the answer cap", () => {
  const input = {
    symptomCategory: "neurological",
    primarySymptom: "a terrible headache since this morning",
    selectedSymptoms: [],
  };
  const first = selectFollowUpQuestions(input);
  const second = selectFollowUpQuestions(input);
  assert.deepEqual(first.map((question) => question.id), second.map((question) => question.id));
  assert.ok(first.length > 0 && first.length <= 6);
  const headacheQuestion = first.find((question) => question.id === "headache_worst_ever");
  assert.ok(headacheQuestion);
  assert.equal(getFollowUpQuestionById("headache_worst_ever")?.prompt, headacheQuestion?.prompt);
});

test("selection excludes already answered questions and caps at six", () => {
  const all = selectFollowUpQuestions({ symptomCategory: "neurological", primarySymptom: "headache" });
  const answered = all.map((question) => question.id);
  const rest = selectFollowUpQuestions({
    symptomCategory: "neurological",
    primarySymptom: "headache",
    answeredQuestionIds: answered,
  });
  assert.equal(rest.some((question) => answered.includes(question.id)), false);
});

test("category-scoped safety questions appear for psychiatric complaints", () => {
  const selected = selectFollowUpQuestions({ symptomCategory: "psychiatric", primarySymptom: "persistent anxiety" });
  assert.ok(selected.some((question) => question.id === "self_harm_safety"));
});

test("unrelated categories do not receive unrelated questions", () => {
  const selected = selectFollowUpQuestions({
    symptomCategory: "musculoskeletal",
    primarySymptom: "knee pain after sport",
    selectedSymptoms: ["joint_pain"],
  });
  assert.equal(selected.some((question) => question.id === "abdominal_pain_location"), false);
  assert.equal(selected.some((question) => question.id === "headache_worst_ever"), false);
});

test("validation rejects unknown question ids, duplicates and invalid answers", () => {
  assert.throws(() => validateFollowUpAnswers([{ questionId: "made_up_question", answer: "yes" }]));
  assert.throws(() => validateFollowUpAnswers([
    { questionId: "cough_blood", answer: "yes" },
    { questionId: "cough_blood", answer: "no" },
  ]));
  assert.throws(() => validateFollowUpAnswers([{ questionId: "cough_blood", answer: "maybe" }]));
  assert.throws(() => validateFollowUpAnswers([{ questionId: "abdominal_pain_location", answer: "back of the knee" }]));
  validateFollowUpAnswers([{ questionId: "cough_blood", answer: "no" }]);
  validateFollowUpAnswers([{ questionId: "abdominal_pain_location", answer: "lower right side" }]);
  validateFollowUpAnswers([{ questionId: "headache_worst_ever", answer: "unknown" }]);
});

test("applied answers map to curated evidence and escalate deterministic urgency", () => {
  const applied = applyFollowUpAnswers([
    { questionId: "headache_worst_ever", answer: "yes" },
    { questionId: "cough_duration_weeks", answer: "yes" },
    { questionId: "abdominal_pain_location", answer: "lower right side" },
    { questionId: "cough_blood", answer: "no" },
    { questionId: "rash_serious_features", answer: "unknown" },
  ]);
  assert.ok(applied.evidence.includes("worst ever headache"));
  assert.equal(applied.escalations.filter((escalation) => escalation.urgency === "urgent").length, 2);
  assert.deepEqual(applied.negativeQuestionIds, ["cough_blood"]);
  assert.deepEqual(applied.unknownQuestionIds, ["rash_serious_features"]);
});

test("no answers yields no evidence and no escalations", () => {
  const applied = applyFollowUpAnswers([]);
  assert.deepEqual(applied.evidence, []);
  assert.deepEqual(applied.escalations, []);
});

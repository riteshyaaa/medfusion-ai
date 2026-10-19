export const FOLLOW_UP_QUESTION_SET_VERSION = "symptom-followups-v1";

export const UNKNOWN_ANSWER = "unknown";
export const NOT_SURE_ANSWER = "not sure";

export type FollowUpEscalation = {
  urgency: "urgent" | "emergency";
  flagLabel: string;
  guidance: string[];
};

export type FollowUpQuestion = {
  id: string;
  prompt: string;
  type: "yes_no_unknown" | "choice";
  options?: string[];
  allowUnknown: true;
  triggers: string[];
  categories?: string[];
  evidenceOnYes?: string[];
  optionEvidence?: Record<string, string[]>;
  escalationOnYes?: FollowUpEscalation;
  escalationOnOption?: Record<string, FollowUpEscalation>;
};

export type FollowUpAnswer = { questionId: string; answer: string };

export const YES_ANSWER = "yes";
export const NO_ANSWER = "no";

const questionCatalogue: FollowUpQuestion[] = [
  {
    id: "headache_worst_ever",
    prompt: "Did this headache start suddenly and feel like the worst headache you have ever had?",
    type: "yes_no_unknown",
    allowUnknown: true,
    triggers: ["headache", "head pain", "migraine"],
    evidenceOnYes: ["worst ever headache"],
  },
  {
    id: "headache_neurological",
    prompt: "Have you noticed any new weakness, numbness, slurred speech, or vision change since it started?",
    type: "yes_no_unknown",
    allowUnknown: true,
    triggers: ["headache", "head pain", "migraine", "dizziness", "vertigo"],
    evidenceOnYes: ["slurred speech", "face drooping"],
  },
  {
    id: "headache_fever_neck",
    prompt: "Is there any fever or neck stiffness together with the headache?",
    type: "yes_no_unknown",
    allowUnknown: true,
    triggers: ["headache", "head pain", "migraine"],
    evidenceOnYes: ["fever", "stiff neck"],
  },
  {
    id: "head_injury",
    prompt: "Did you hit your head shortly before the headache began?",
    type: "yes_no_unknown",
    allowUnknown: true,
    triggers: ["headache", "head pain", "migraine"],
    escalationOnYes: {
      urgency: "urgent",
      flagLabel: "headache after a recent knock to the head",
      guidance: ["A headache following a knock to the head needs same-day in-person assessment, sooner if it worsens, brings vomiting, or makes you drowsy."],
    },
  },
  {
    id: "breathing_difficulty_now",
    prompt: "Do you have any difficulty breathing right now?",
    type: "yes_no_unknown",
    allowUnknown: true,
    triggers: ["cough", "fever", "chest pain", "cold symptoms", "runny nose", "sore throat", "sweating"],
    evidenceOnYes: ["breathing difficulty"],
  },
  {
    id: "cough_blood",
    prompt: "Have you coughed up any blood or rust-colored sputum?",
    type: "yes_no_unknown",
    allowUnknown: true,
    triggers: ["cough", "coughing", "phlegm"],
    evidenceOnYes: ["blood in sputum"],
  },
  {
    id: "cough_duration_weeks",
    prompt: "Has the cough lasted three weeks or longer?",
    type: "yes_no_unknown",
    allowUnknown: true,
    triggers: ["cough", "coughing", "weight loss"],
    escalationOnYes: {
      urgency: "urgent",
      flagLabel: "cough persisting beyond three weeks",
      guidance: ["A cough lasting three weeks or more always deserves an in-person review; bring the exact timeline and any weight change with you."],
    },
  },
  {
    id: "abdominal_pain_location",
    prompt: "Where is the abdominal pain strongest?",
    type: "choice",
    options: ["upper abdomen", "around the navel", "lower right side", "lower left side", "all over the abdomen", NOT_SURE_ANSWER],
    allowUnknown: true,
    triggers: ["abdominal pain", "belly pain", "stomach pain", "tummy pain"],
    escalationOnOption: {
      "lower right side": {
        urgency: "urgent",
        flagLabel: "abdominal pain localised to the lower right side",
        guidance: ["Pain settling in the lower right abdomen is a pattern doctors examine urgently; do not eat or drink until you have been seen."],
      },
    },
  },
  {
    id: "abdominal_blood_stool",
    prompt: "Have you noticed blood or a black color in your stools?",
    type: "yes_no_unknown",
    allowUnknown: true,
    triggers: ["abdominal pain", "diarrhoea", "diarrhea", "loose stools"],
    evidenceOnYes: ["bloody stool"],
  },
  {
    id: "vomit_blood",
    prompt: "Has the vomit contained blood or coffee-ground material?",
    type: "yes_no_unknown",
    allowUnknown: true,
    triggers: ["vomiting", "nausea", "throwing up", "being sick"],
    evidenceOnYes: ["vomiting blood"],
  },
  {
    id: "fever_duration",
    prompt: "How many days has the fever lasted so far?",
    type: "choice",
    options: ["less than three days", "three days or more", NOT_SURE_ANSWER],
    allowUnknown: true,
    triggers: ["fever", "cold symptoms", "runny nose", "cough"],
    escalationOnOption: {
      "three days or more": {
        urgency: "urgent",
        flagLabel: "fever persisting beyond three days",
        guidance: ["A fever still present after three days needs an in-person review with the temperature record you have been keeping."],
      },
    },
  },
  {
    id: "rash_serious_features",
    prompt: "Does the rash blister, hurt, or include bruise-like marks that do not fade when pressed?",
    type: "yes_no_unknown",
    allowUnknown: true,
    triggers: ["skin rash", "rash", "itching", "blisters", "red spots"],
    escalationOnYes: {
      urgency: "urgent",
      flagLabel: "blistering, painful, or bruise-like rash",
      guidance: ["A rash that blisters, hurts out of proportion, or leaves bruise-like marks needs same-day in-person review."],
    },
  },
  {
    id: "fainting_recent",
    prompt: "Have you fainted or nearly fainted while these symptoms were happening?",
    type: "yes_no_unknown",
    allowUnknown: true,
    triggers: ["dizziness", "palpitations", "chest pain", "sweating", "fainting"],
    evidenceOnYes: ["fainting"],
  },
  {
    id: "self_harm_safety",
    prompt: "Are you currently having any thoughts of harming yourself or ending your life?",
    type: "yes_no_unknown",
    allowUnknown: true,
    categories: ["psychiatric"],
    triggers: ["anxiety", "low mood", "tiredness", "widespread tiredness", "sad", "stress"],
    evidenceOnYes: ["suicidal"],
  },
  {
    id: "urinary_flank_fever",
    prompt: "Do you have fever, chills, or back/flank pain together with the urinary symptoms?",
    type: "yes_no_unknown",
    allowUnknown: true,
    triggers: ["urinary symptoms", "burning urination", "painful urination"],
    escalationOnYes: {
      urgency: "urgent",
      flagLabel: "urinary symptoms with fever or flank pain",
      guidance: ["Fever or flank pain with urinary symptoms suggests the infection may be spreading upward — same-day medical review."],
    },
  },
  {
    id: "leg_swelling_one_side",
    prompt: "Is one leg swollen, hot, or painful?",
    type: "yes_no_unknown",
    allowUnknown: true,
    triggers: ["leg swelling", "swollen legs", "swollen feet"],
    escalationOnYes: {
      urgency: "urgent",
      flagLabel: "one-sided hot painful leg swelling",
      guidance: ["One hot, painful, swollen leg is a pattern doctors check urgently for a clot — avoid long journeys until reviewed."],
    },
  },
  {
    id: "chest_pain_spread",
    prompt: "Does the chest pain spread to the jaw, neck, back, or left arm?",
    type: "yes_no_unknown",
    allowUnknown: true,
    triggers: ["chest pain", "chest tightness", "pressure in chest"],
    evidenceOnYes: ["pain spreading to arm"],
  },
];

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

export function getFollowUpQuestionCatalogue(): readonly FollowUpQuestion[] {
  return questionCatalogue;
}

export function getFollowUpQuestionById(id: string): FollowUpQuestion | undefined {
  return questionCatalogue.find((question) => question.id === id);
}

export type FollowUpSelectionInput = {
  symptomCategory: string;
  primarySymptom?: string;
  selectedSymptoms?: string[];
  associatedSymptoms?: string[];
  answeredQuestionIds?: string[];
  maximumQuestions?: number;
};

function questionIsApplicable(question: FollowUpQuestion, input: FollowUpSelectionInput, haystacks: string[]): boolean {
  if (question.categories?.includes(input.symptomCategory)) return true;
  return question.triggers.some((trigger) => haystacks.some((haystack) => haystack.includes(normalizeText(trigger))));
}

export function selectFollowUpQuestions(input: FollowUpSelectionInput): FollowUpQuestion[] {
  const maximum = input.maximumQuestions ?? 6;
  const haystacks = [
    input.primarySymptom ?? "",
    ...(input.selectedSymptoms ?? []),
    ...(input.associatedSymptoms ?? []),
  ].map(normalizeText).filter(Boolean);
  const answered = new Set(input.answeredQuestionIds ?? []);
  const selected: FollowUpQuestion[] = [];
  for (const question of questionCatalogue) {
    if (answered.has(question.id)) continue;
    if (!questionIsApplicable(question, input, haystacks)) continue;
    selected.push(question);
    if (selected.length >= maximum) break;
  }
  return selected;
}

export type AppliedFollowUpAnswers = {
  evidence: string[];
  escalations: FollowUpEscalation[];
  unknownQuestionIds: string[];
  notSureQuestionIds: string[];
  negativeQuestionIds: string[];
};

export function validateFollowUpAnswers(answers: FollowUpAnswer[]): void {
  const seenIds = new Set<string>();
  for (const row of answers) {
    const question = getFollowUpQuestionById(row.questionId);
    if (!question) throw new Error(`unknown_question:${row.questionId}`);
    if (seenIds.has(question.id)) throw new Error(`duplicate_question:${question.id}`);
    seenIds.add(question.id);
    const allowed = question.type === "yes_no_unknown"
      ? [YES_ANSWER, NO_ANSWER, UNKNOWN_ANSWER]
      : [...(question.options ?? []), UNKNOWN_ANSWER];
    if (!allowed.includes(row.answer.trim().toLowerCase())) throw new Error(`invalid_answer:${question.id}`);
  }
}

export function applyFollowUpAnswers(answers: FollowUpAnswer[]): AppliedFollowUpAnswers {
  const applied: AppliedFollowUpAnswers = {
    evidence: [],
    escalations: [],
    unknownQuestionIds: [],
    notSureQuestionIds: [],
    negativeQuestionIds: [],
  };
  for (const row of answers) {
    const question = getFollowUpQuestionById(row.questionId);
    if (!question) continue;
    const answer = row.answer.trim().toLowerCase();
    if (answer === UNKNOWN_ANSWER) applied.unknownQuestionIds.push(question.id);
    if (answer === NOT_SURE_ANSWER) applied.notSureQuestionIds.push(question.id);
    if (question.type === "yes_no_unknown" && answer === NO_ANSWER) applied.negativeQuestionIds.push(question.id);
    if (question.type === "yes_no_unknown" && answer === YES_ANSWER) {
      for (const token of question.evidenceOnYes ?? []) applied.evidence.push(token);
      if (question.escalationOnYes) applied.escalations.push(question.escalationOnYes);
    }
    if (question.type === "choice" && answer !== UNKNOWN_ANSWER && answer !== NOT_SURE_ANSWER) {
      for (const token of question.optionEvidence?.[answer] ?? []) applied.evidence.push(token);
      const escalation = question.escalationOnOption?.[answer];
      if (escalation) applied.escalations.push(escalation);
    }
  }
  return applied;
}

import { getSymptomAssociation, getSymptomCatalogueIds } from "./symptom-classifier";
import type { FollowUpEscalation } from "./symptom-questions";

export const SYMPTOM_RULE_SET_VERSION = "symptom-rules-v2";

export type SymptomGuidanceInput = {
  primarySymptom: string;
  symptomCategory: string;
  severity?: "mild" | "moderate" | "severe";
  progression?: "improving" | "stable" | "worsening" | "fluctuating";
  associatedSymptoms?: string[];
  selectedSymptoms?: string[];
  onset?: string;
  duration?: string;
  medicalHistory?: string[];
  medications?: string[];
  followUpEvidence?: string[];
  followUpEscalations?: FollowUpEscalation[];
};

export type PossibleCondition = { name: string; basis: string };
export type SymptomGuidance = {
  urgencyLevel: "emergency" | "urgent" | "routine";
  redFlagsTriggered: string[];
  recommendations: string[];
  watchFor: string[];
  seekCareIf: string[];
  possibleConditions: PossibleCondition[];
  disclaimer: string;
};

export type UrgencyState =
  | "routine_guidance"
  | "needs_more_information"
  | "urgent_guidance"
  | "emergency_guidance";

export const URGENCY_STATE_LABELS: Record<UrgencyState, string> = {
  routine_guidance: "Routine guidance",
  needs_more_information: "Needs more information",
  urgent_guidance: "Urgent — seek care promptly",
  emergency_guidance: "Emergency — seek care now",
};

export function urgencyStateFor(
  urgencyLevel: string,
  classificationStatus?: string | null,
): UrgencyState {
  if (urgencyLevel === "emergency") return "emergency_guidance";
  if (urgencyLevel === "urgent") return "urgent_guidance";
  if (classificationStatus && classificationStatus !== "completed") return "needs_more_information";
  return "routine_guidance";
}

type CuratedSymptom = {
  label: string;
  aliases: string[];
  baseUrgency: "emergency" | "urgent" | "routine";
  note?: string;
  guidance: string[];
  watchFor: string[];
  seekCareIf: string[];
};

type ComboRule = {
  label: string;
  requires: string[];
  requireCount: number;
  urgency: "emergency" | "urgent";
  guidance: string[];
};

const DISCLAIMER = "This guidance is generated from the information you entered. Consult a doctor if symptoms persist or worsen, or if anything feels serious.";

const curated: CuratedSymptom[] = [
  {
    label: "chest pain",
    aliases: ["chest_pain", "chest pain", "pressure in chest", "tight chest", "chest tightness", "pain in chest", "left arm pain", "left shoulder pain", "pain spreading to arm", "aching chest", "chest pressure feeling", "heaviness in chest", "chest discomfort", "arm pain", "pain in arm", "pain going towards arm", "jaw pain"],
    baseUrgency: "emergency",
    note: "Chest pain can come from the heart or lungs and must be assessed in person, quickly.",
    guidance: [
      "Stop any physical exertion and rest upright now; stay where someone can see you.",
      "Do not drive yourself anywhere. Have someone stay with you until staff or professionals take over.",
    ],
    watchFor: [
      "Pain spreading to the jaw, neck, back, or left arm",
      "Sweating, nausea, vomiting, or breathlessness alongside the pain",
      "Pain that worsens with breathing, or with a racing/irregular heartbeat",
    ],
    seekCareIf: ["chest pain is new, severe, lasting more than a few minutes, or comes with sweating, breathlessness, or faintness — call emergency services immediately"],
  },
  {
    label: "breathlessness",
    aliases: ["breathlessness", "shortness of breath", "difficulty breathing", "breathing difficulty", "hard to breathe", "can't catch breath", "wheezing", "gasping", "short of breath", "trouble breathing", "breathless", "panting", "struggling to breathe", "cannot breathe", "hardly breathing"],
    baseUrgency: "emergency",
    note: "Breathing difficulty can deteriorate quickly regardless of the underlying cause.",
    guidance: [
      "Sit upright, loosen tight clothing, and rest; keep the room ventilated and free of smoke or dust.",
      "If an inhaler has been prescribed for you, use it exactly as prescribed.",
    ],
    watchFor: [
      "Lips or fingertips turning blue or grey",
      "Speech becoming impossible or only word-by-word between breaths",
      "Chest sucking in between the ribs, especially in children",
    ],
    seekCareIf: ["breathing difficulty is severe, worsening, happening at rest, or combined with chest pain — treat as an emergency"],
  },
  {
    label: "high fever",
    aliases: ["high_fever", "high fever", "very high temperature", "temperature above 39", "temp above 39", "too much fever", "fever high", "burning fever", "high temperature", "fever of 102"],
    baseUrgency: "urgent",
    note: "Fevers this high need in-person assessment with a measured temperature.",
    guidance: [
      "Measure and record the temperature, then repeat every few hours while it stays elevated.",
      "Drink fluids steadily, rest, and dress lightly; use a fever reducer only as directed on its packaging or by your doctor.",
    ],
    watchFor: ["Fever persisting beyond three days", "Shaking chills, rash, stiff neck, or confusion alongside fever", "Markedly reduced urine output"],
    seekCareIf: ["fever stays above 39°C after fever reducers, lasts more than three days, or occurs with stiff neck, confusion, rash, or breathing trouble"],
  },
  {
    label: "fever (unspecified)",
    aliases: ["fever", "mild_fever", "temperature", "pyrexia", "hot body", "feeling feverish", "mild fever", "slight fever", "raised temperature", "feeling hot", "running temperature"],
    baseUrgency: "routine",
    guidance: [
      "Rest and keep fluids up; measure temperature twice daily to trend the fever.",
      "Note what time each day the temperature peaks — that pattern is useful information for any doctor you see.",
    ],
    watchFor: ["Fever climbing beyond three days or refusing to come down", "New rash, severe headache, or vomiting alongside fever"],
    seekCareIf: ["fever lasts more than three days, keeps rising, or comes with any warning symptom listed on this screen"],
  },
  {
    label: "severe headache",
    aliases: ["severe headache", "worst headache", "thunderclap headache", "unbearable headache", "worst ever headache", "splitting headache", "agonizing headache", "violent headache"],
    baseUrgency: "emergency",
    note: "A sudden, worst-ever headache is a warning pattern that must be assessed urgently.",
    guidance: ["Rest in a dark, quiet room; do not ignore it even if it eases a little.", "Avoid strenuous activity and driving until the cause has been assessed."],
    watchFor: ["Vomiting, neck stiffness, fever, or fainting alongside the headache", "Weakness, numbness, slurred speech, or vision changes", "Headache after a knock to the head"],
    seekCareIf: ["headache is the worst ever experienced, kicked in within seconds, or comes with neck stiffness or any listed warning"],
  },
  {
    label: "ordinary headache",
    aliases: ["headache", "head pain", "migraine", "aching head", "head paining", "throbbing head", "mild headache"],
    baseUrgency: "routine",
    guidance: [
      "Rest in a dim, quiet space, keep hydrated, and note what you ate, slept, and did before it started.",
      "Repeating headaches steadily increasing in intensity deserve a scheduled (non-emergency) medical review.",
    ],
    watchFor: ["Headache switching to a worst-ever or thunderclap pattern", "New numbness, weakness, speech problems, or vision loss"],
    seekCareIf: ["headache pattern changes from your usual, wakes you at night, or persists beyond roughly two weeks without a clear cause"],
  },
  {
    label: "stiff neck",
    aliases: ["stiff_neck", "stiff neck", "neck stiffness", "can't bend neck", "neck feels stiff", "cannot turn neck", "neck rigid"],
    baseUrgency: "emergency",
    note: "Combined with fever or headache this can signal a serious infection; with injury it still needs same-day assessment.",
    guidance: ["Do not force neck movement and avoid driving.", "Check whether moving the chin toward the chest is possible — difficulty doing this is important information to report."],
    watchFor: ["Fever or worsening headache with the neck stiffness", "Light hurting the eyes or increasing drowsiness"],
    seekCareIf: ["neck stiffness accompanies fever or headache — go to emergency care"],
  },
  {
    label: "fainting or loss of consciousness",
    aliases: ["fainting", "fainted", "passed out", "blacked out", "unconscious", "loss of consciousness", "blackouts", "coma", "syncope", "fainted away", "fell unconscious"],
    baseUrgency: "emergency",
    note: "Any witnessed or remembered loss of consciousness needs urgent evaluation of the cause in person.",
    guidance: ["Lie down and elevate the legs until fully stable; do not stand up quickly.", "Do not drive, climb, or operate machinery until a doctor has evaluated the cause."],
    watchFor: ["Chest pain, palpitations, or breathlessness around the faint", "Head injury during the fall"],
    seekCareIf: ["any fainting or blackout has occurred — arrange emergency or same-day assessment"],
  },
  {
    label: "stroke warning signs",
    aliases: ["face drooping", "face droop", "arm weakness", "weakness of one body side", "weakness_of_one_body_side", "slurred speech", "speech difficulty", "one side weakness", "half body weakness", "drooping face", "difficulty speaking", "trouble speaking", "garbled speech", "cannot lift arm", "one sided numbness", "half body numbness", "face dropping", "leg weakness"],
    baseUrgency: "emergency",
    note: "These are classic stroke warning signs; emergency treatment windows are measured in minutes.",
    guidance: ["Note the exact time the symptoms started — this determines what treatment is possible.", "Call emergency services regardless of whether symptoms improve; do not wait for them to pass."],
    watchFor: ["Sudden severe headache, dizziness, or loss of balance", "Vision loss in one or both eyes"],
    seekCareIf: ["any of these signs appeared suddenly — call emergency services immediately (do not wait for improvement)"],
  },
  {
    label: "suicidal thoughts or self-harm",
    aliases: ["suicidal", "suicide", "kill myself", "end my life", "self-harm", "self harm", "hurt myself", "no reason to live", "thoughts of suicide", "want to die", "end it all", "life is not worth living", "cutting myself", "harming myself"],
    baseUrgency: "emergency",
    note: "Emotional crises are medical emergencies and deserve an immediate human response.",
    guidance: [
      "Speak with someone you trust right now and stay with people, not alone, while these thoughts are active.",
      "Contact a local crisis line or emergency services, or go to the nearest emergency department.",
    ],
    watchFor: ["Plans or means being considered", "Withdrawal from everyone, or sudden calm after sustained distress"],
    seekCareIf: ["these thoughts are present now — use a crisis line, emergency services, or an emergency department today rather than waiting for any assessment"],
  },
  {
    label: "uncontrolled bleeding",
    aliases: ["uncontrolled bleeding", "bleeding heavily", "won't stop bleeding", "severe bleeding", "coughing blood", "blood in sputum", "vomiting blood", "stomach_bleeding", "bloody stool", "blood in motion", "coughing up blood", "coughing out blood", "blood in cough", "blood in phlegm", "bloody vomit", "vomiting out blood", "blood in stool", "bloody motions", "rectal bleeding", "haemorrhage", "hemorrhage"],
    baseUrgency: "emergency",
    note: "Active uncontrolled blood loss is a time-critical emergency.",
    guidance: ["Apply firm, continuous direct pressure with a clean cloth and do not lift it to look.", "Keep the injured part raised and still; avoid eating or drinking if surgery is possible."],
    watchFor: ["Dizziness, pallor, or racing heartbeat alongside bleeding", "Blood appearing in vomit, stool, or sputum"],
    seekCareIf: ["bleeding does not stop with several minutes of firm pressure, or blood is appearing in vomit/stool/phlegm — emergency care now"],
  },
  {
    label: "severe allergic reaction",
    aliases: ["anaphylaxis", "severe allergic reaction", "throat closing", "swollen throat", "whole body hives", "hives all over", "hives everywhere", "swelling of face", "face swelling", "tongue swelling", "throat swollen", "anaphylactic reaction"],
    baseUrgency: "emergency",
    note: "Anaphylaxis can close the airway within minutes; use adrenaline immediately if it has already been prescribed to you.",
    guidance: ["Use your prescribed adrenaline auto-injector immediately if available, then still seek emergency care.", "Lie down with legs raised if feeling faint; avoid food and drink until advised."],
    watchFor: ["Lip, tongue, or throat swelling", "Breathing becoming noisy, wheezy, or effortful", "Collapse or faintness"],
    seekCareIf: ["swelling of the tongue or throat, or noisy breathing — use adrenaline if prescribed and call emergency services immediately"],
  },
  {
    label: "sudden vision loss",
    aliases: ["sudden vision loss", "lost sight", "vision gone dark", "curtain over vision", "blurred_and_distorted_vision", "sudden blindness", "sight went dark", "vision blacked out", "cannot see suddenly"],
    baseUrgency: "emergency",
    note: "Sudden loss of sight is an emergency with a narrow treatment window.",
    guidance: ["Avoid rubbing or pressing the eyes.", "Arrange transport to an eye emergency department immediately."],
    watchFor: ["Flashes, new floaters, or a shadow spreading across vision"],
    seekCareIf: ["any sudden loss, partial loss, or dark shadow in vision — treat as an emergency today"],
  },
  {
    label: "vomiting",
    aliases: ["vomiting", "vomit", "throwing up", "being sick", "nausea", "nauseous", "queasy", "puking", "puke", "retching", "vomitted", "nauseous feeling", "sick feeling", "gagging feeling"],
    baseUrgency: "routine",
    guidance: [
      "Sip small amounts of oral rehydration solution or water steadily; large drinks will come straight back up.",
      "Avoid solid food for a few hours, then reintroduce bland items; stay upright after drinking.",
    ],
    watchFor: ["Vomit turning green, bloody, or coffee-colored", "Inability to keep fluids down for more than half a day", "Dehydration signs: dark urine, dizziness, dry mouth"],
    seekCareIf: ["vomiting lasts beyond 24 hours, blood appears, or fluids cannot be kept down — arrange prompt in-person care"],
  },
  {
    label: "diarrhoea",
    aliases: ["diarrhoea", "diarrhea", "loose motions", "loose stools", "watery stools", "frequent stools", "loose motion", "frequent loose motion", "watery motion", "loose motions with mucus"],
    baseUrgency: "routine",
    guidance: [
      "Prioritize oral rehydration solution after every loose stool; dehydration is the main risk, not the stool itself.",
      "Record how many loose stools occur per day and whether blood or mucus appears — clinicians will ask for this.",
    ],
    watchFor: ["No urine for over eight hours, or very dark scant urine", "Blood or black color in stools", "Fever above 39°C or severe abdominal pain with the diarrhoea"],
    seekCareIf: ["diarrhoea lasts beyond three days, contains blood, or comes with fever or dehydration signs — get assessed"],
  },
  {
    label: "abdominal pain",
    aliases: ["abdominal_pain", "abdominal pain", "belly_pain", "belly pain", "stomach_pain", "stomach pain", "tummy pain", "gut pain", "pain abdomen", "abdominal discomfort", "stomach cramps", "belly discomfort", "epigastric pain", "pain near navel", "pain in abdomen", "lower abdomen pain", "upper abdomen pain", "stomach aching"],
    baseUrgency: "urgent",
    note: "Abdominal pain overlaps with several urgent surgical conditions and deserves structured assessment.",
    guidance: [
      "Rate the pain 0-10 at its peak and note exactly where it sits (upper, lower, left, right, around the navel).",
      "Keep to bland food, no alcohol, and steady small sips of water while waiting for review.",
    ],
    watchFor: ["Pain localising to the lower right abdomen, radiating to the shoulder tip or back, or becoming constant", "No stool movements and no passing of wind for over a day, especially with vomiting", "Blood in stool, or a firm lump in the abdomen"],
    seekCareIf: ["pain is severe and constant, increasingly localised to one spot, or paired with fever and vomiting — in-person review, urgently if escalating"],
  },
  {
    label: "cough",
    aliases: ["cough", "coughing", "dry cough", "chesty cough", "phlegm", "mucoid_sputum", "throat_irritation", "throat irritation", "wet cough", "cough with phlegm", "persistent cough", "continuous cough", "cough continues", "coughing a lot"],
    baseUrgency: "routine",
    guidance: [
      "Warm fluids and a smoke-free room usually help a simple cough; honey soothes adults (never give honey to infants).",
      "Record roughly how many weeks the cough has lasted; duration matters as much as severity.",
    ],
    watchFor: ["Blood, rusty sputum, or progressively worse breathlessness with the cough", "Cough persisting past two or three weeks", "Weight loss or drenching night sweats appearing"],
    seekCareIf: ["cough persists beyond three weeks, brings up blood, or comes with chest pain or weight loss — promptly in-person, and sooner if breathless"],
  },
  {
    label: "cold symptoms",
    aliases: ["runny_nose", "runny nose", "sneezing", "continuous_sneezing", "congestion", "blocked nose", "sinus_pressure", "sore throat", "watering_from_eyes", "redness_of_eyes", "nasal congestion", "nose running", "scratchy throat", "throat pain", "throat hurts", "common cold", "cold and cough"],
    baseUrgency: "routine",
    guidance: [
      "Rest, fluids, saline nasal rinse, and steam help symptom control; this usually settles on its own within about a week.",
      "Cover sneezes and wash hands frequently — most adults get several of these a year.",
    ],
    watchFor: ["Fever beyond three days or returning after easing", "One-sided facial pain/pressure with discharge and fever", "Breathlessness, chest pain, or wheeze emerging"],
    seekCareIf: ["symptoms worsen after about a week, or fever/breathing difficulty appears — prompt in-person review"],
  },
  {
    label: "dehydration signs",
    aliases: ["dehydration", "sunken_eyes", "can't keep water down", "no urine", "dry mouth", "dizzy standing", "very thirsty", "extreme thirst", "not urinated all day", "low urine output"],
    baseUrgency: "urgent",
    note: "This suggests more than routine fluid loss — a clinician may need to treat with IV fluids.",
    guidance: ["Take small sips of oral rehydration solution every few minutes while awaiting assessment.", "Stop caffeine; avoid plain water alone — electrolyte solutions are the priority."],
    watchFor: ["Dizziness on standing, confusion, or drowsiness", "No urine for six hours or more"],
    seekCareIf: ["these signs are present — same-day in-person assessment"],
  },
  {
    label: "palpitations",
    aliases: ["fast_heart_rate", "heart racing", "palpitations", "heart pounding", "racing heart", "irregular heartbeat", "heart beating fast", "fluttering heart", "pulse racing", "skipped beats", "heartbeat irregular"],
    baseUrgency: "urgent",
    note: "A new sustained racing or irregular heartbeat deserves ECG-based assessment.",
    guidance: ["While resting comfortably, count heartbeats for exactly 60 seconds and record the number.", "Avoid caffeine, energy drinks, and stimulant decongestants until reviewed."],
    watchFor: ["Fainting or near-fainting with palpitations", "Chest pain or breathlessness with palpitations"],
    seekCareIf: ["palpitations come with fainting, chest pain, or breathlessness — same-day assessment"],
  },
  {
    label: "dizziness",
    aliases: ["dizziness", "dizzy", "light headed", "spinning_movements", "spinning movements", "vertigo", "loss of balance", "unsteadiness", "loss_of_balance", "feeling faint", "lightheadedness", "room spinning", "woozy", "balance is off"],
    baseUrgency: "urgent",
    guidance: [
      "Stand up slowly, sit before falling, and avoid ladders and driving until the cause is established.",
      "Note whether the room spins with head movement versus general light-headedness — clinicians separate these patterns.",
    ],
    watchFor: ["New ringing or hearing loss in one ear", "Weakness, double vision, or speech problems with dizziness (stroke pattern — escalate)"],
    seekCareIf: ["dizziness with any stroke-pattern symptom, severe headache, or repeated falls — urgent review"],
  },
  {
    label: "joint pain",
    aliases: ["joint_pain", "joint pain", "knee_pain", "knee pain", "swelling_joints", "swollen joints", "hip_joint_pain", "hip joint pain", "muscle_weakness", "joint hurts", "knee hurts", "muscle aches", "muscular pain", "swelling in joints"],
    baseUrgency: "routine",
    guidance: [
      "Rest the joint for two to three days, apply ice up to 15 minutes at a time, and keep gentle movement going.",
      "Record which joints hurt, one side or both, and the time of day — pattern matters for the range of possible causes.",
    ],
    watchFor: ["One joint that is hot, red, and severely swollen", "Fever or rash with the joint pain", "Inability to bear weight"],
    seekCareIf: ["a hot swollen single joint with fever — urgent; widespread pain persisting beyond a few weeks — scheduled review"],
  },
  {
    label: "skin rash",
    aliases: ["skin_rash", "skin rash", "rash", "red_spots_over_body", "red spots", "nodal_skin_eruptions", "itchy rash", "itching", "blisters", "hives", "urticaria", "spots on skin", "itchy skin", "skin eruption", "red patches", "raised spots", "rash spreading"],
    baseUrgency: "urgent",
    note: "A rash with fever should not be assessed from photographs alone — it needs in-person review.",
    guidance: [
      "Note where the rash started, its direction of spread, whether it is raised, and whether it itches or hurts.",
      "Fragrance-free moisturizers and gentle washing help itch; keep nails short and pat rather than scratch.",
    ],
    watchFor: ["Rash with fever, blistering, or skin painful out of proportion to its look", "Bruise-like marks that do not fade under gentle pressure — mention these immediately when seen"],
    seekCareIf: ["rash with fever, blistering, or rapidly spreading painful skin — same-day in-person review"],
  },
  {
    label: "widespread tiredness",
    aliases: ["fatigue", "malaise", "lethargy", "tiredness", "exhaustion", "weakness", "no energy", "low energy", "always tired", "feeling weak", "drowsy all day"],
    baseUrgency: "routine",
    guidance: [
      "Track sleep hours and quality, nutrition, hydration, and stress for a full week — patterns usually explain most episodes.",
      "Note any weight change, night symptoms, or new lumps and include them in any review appointment.",
    ],
    watchFor: ["Fatigue with weight loss, night sweats, or increasing breathlessness", "Fatigue combined with worsening mood"],
    seekCareIf: ["tiredness is severe, unrelieved by a restful week, or prevents normal functioning — scheduled medical review"],
  },
  {
    label: "back or neck pain",
    aliases: ["back_pain", "back pain", "lower back pain", "neck_pain", "neck pain", "backache", "pulled back", "stiff lower back", "lumbar pain", "pain in back"],
    baseUrgency: "routine",
    guidance: [
      "Stay gently active rather than on strict bed rest; heat packs and short walks usually speed recovery of mechanical pain.",
      "Avoid heavy lifting and full forward bends while acute; note whether pain travels down a leg and how far.",
    ],
    watchFor: ["New leg weakness or numbness between the legs", "Loss of control of urine or stool", "Fever, or unexplained weight loss, with back pain"],
    seekCareIf: ["leg weakness or urinary/bowel control changes — emergency; fever or relentless night pain — prompt review"],
  },
  {
    label: "mouth or throat sores",
    aliases: ["ulcers_on_tongue", "patches_in_throat", "patches in throat", "mouth ulcer", "tongue ulcer", "pain swallowing", "ulcer in mouth", "canker sore", "white patch in throat", "painful swallowing", "sore on tongue", "difficulty swallowing"],
    baseUrgency: "routine",
    guidance: [
      "Warm salt-water rinses, cool soft food, and steady fluids manage most mouth and throat soreness.",
      "Note whether ulcers are single or multiple, painful or painless, and any smoking or heavy alcohol context.",
    ],
    watchFor: ["An ulcer not healing beyond two or three weeks", "Swallowing solids becoming progressively harder", "White patches that do not scrape off"],
    seekCareIf: ["an ulcer or white patch persists beyond three weeks, or swallowing is deteriorating — scheduled review"],
  },
  {
    label: "urinary symptoms",
    aliases: ["burning_micturition", "burning urination", "painful urination", "polyuria", "frequent urination", "bladder_discomfort", "bloody urine", "dark_urine", "continuous_feel_of_urine", "hurts to pee", "burning pee", "blood in urine", "peeing blood", "flank pain", "bladder pain", "urine looks cloudy"],
    baseUrgency: "urgent",
    note: "Urinary infections can extend upward toward the kidneys; hydration and early review matter.",
    guidance: [
      "Drink steadily and note whether colour, frequency, or pain changes day by day.",
      "Record any fever alongside urinary symptoms, and any previous history of urinary infections.",
    ],
    watchFor: ["Back/flank pain, fever, chills with urinary symptoms", "Visible blood or cloudy sediment in urine", "Inability to pass urine despite the urge"],
    seekCareIf: ["fever or flank pain with urinary symptoms, cannot pass urine, or visible blood — prompt medical review"],
  },
  {
    label: "isolated itching",
    aliases: ["internal_itching", "dry skin", "itchy all over", "scratching constantly", "skin itchy"],
    baseUrgency: "routine",
    guidance: [
      "Switch to fragrance-free mild soaps and moisturize after washing; pat rather than scratch.",
      "Note any bedding, detergent, or fabric changes just before the itching started — a reversible contact cause is common.",
    ],
    watchFor: ["Widespread rash, yellowing of skin or eyes, weight loss, or night sweats starting with itch", "Itch worsening despite simple measures for two weeks"],
    seekCareIf: ["itch without rash persists beyond two weeks at increasing severity — scheduled review (liver, kidney, and blood causes are worth ruling out)"],
  },
  {
    label: "sweating",
    aliases: ["sweating", "sweat", "diaphoresis", "night sweat", "cold sweat", "perspiration", "sweating more than usual"],
    baseUrgency: "routine",
    guidance: [
      "Note when the sweating happens — with fever, at night, with chest pain, or with exertion — since the pattern is what matters.",
      "Keep the room cool and stay hydrated while it continues.",
    ],
    watchFor: ["Sweating occurring together with chest pain or breathlessness", "Drenching night sweats appearing for more than two weeks"],
    seekCareIf: ["sweating occurs with chest pain or breathlessness — treat as an emergency"],
  },
  {
    label: "leg swelling",
    aliases: ["swollen_legs", "swollen_legs feet", "leg swelling", "swollen feet", "swollen_extremeties", "swollen extremities", "swelling of stomach", "swollen ankles", "ankle swelling", "feet swelling", "one swollen leg", "swelling in legs"],
    baseUrgency: "urgent",
    note: "New swelling of legs or abdomen can reflect heart, kidney, or liver causes that need evidence from an examination.",
    guidance: [
      "Check and record whether both sides or one side is swelling; press a thumb on the shin for five seconds and note if a dent stays.",
      "Log morning-and-evening weight while symptoms continue — rapid day-to-day gain is meaningful for a doctor.",
    ],
    watchFor: ["Rapid weight gain or abdominal distension beginning with the swelling", "Breathlessness while lying flat, or reduced urine output", "One leg swollen, hot, and painful (possible clot — urgent)"],
    seekCareIf: ["one-sided hot painful swelling is urgent; swelling with breathlessness is an emergency; otherwise same-day/targeted review"],
  },
  {
    label: "unexplained weight loss",
    aliases: ["weight_loss", "weight loss", "losing weight without trying", "clothes loose", "losing weight lately", "lost weight without diet", "sudden weight drop"],
    baseUrgency: "routine",
    note: "Unintended weight loss is a symptom doctors take seriously and should always be explained.",
    guidance: [
      "Weigh at the same time daily and record values for two weeks to quantify the trend.",
      "Note appetite, digestion, mood, fever, and any long-standing cough — the accompanying pattern guides causes.",
    ],
    watchFor: ["Confirm the loss is genuinely unintended — unchanged diet and activity make it more significant", "Night sweats, persistent cough, fever, or new lumps appearing with the weight loss"],
    seekCareIf: ["weight loss is continuing without an explanation or exceeds a few kilograms — scheduled medical review"],
  },
];

const comboRules: ComboRule[] = [
  {
    label: "chest pain together with breathing difficulty",
    requires: ["chest pain", "breathlessness"],
    requireCount: 2,
    urgency: "emergency",
    guidance: ["Chest pain with breathing difficulty is treated as a possible cardiac emergency until proven otherwise — call emergency services now."],
  },
  {
    label: "chest pain together with sweating or vomiting",
    requires: ["chest pain", "vomiting", "sweating"],
    requireCount: 2,
    urgency: "emergency",
    guidance: ["Sweating or vomiting alongside chest pain is a cardiac warning combination — treat as an emergency."],
  },
  {
    label: "fever with stiff neck or severe headache",
    requires: ["high fever", "fever (unspecified)", "stiff neck", "severe headache"],
    requireCount: 3,
    urgency: "emergency",
    guidance: ["Fever combined with neck stiffness and/or severe headache defines a meningitis-type emergency pattern — immediate emergency assessment."],
  },
  {
    label: "fever with rash",
    requires: ["high fever", "fever (unspecified)", "skin rash"],
    requireCount: 2,
    urgency: "urgent",
    guidance: ["Fever with a rash covers several infections needing prompt in-person review; escalate to emergency if blistering or bruise-like marks appear."],
  },
  {
    label: "breathlessness with leg swelling",
    requires: ["breathlessness", "leg swelling"],
    requireCount: 2,
    urgency: "urgent",
    guidance: ["Breathlessness plus leg swelling is a heart/fluid pattern needing prompt same-day review; escalate immediately if breathing worsens."],
  },
  {
    label: "weight loss with persistent cough",
    requires: ["unexplained weight loss", "cough"],
    requireCount: 2,
    urgency: "urgent",
    guidance: ["Longstanding cough with weight loss (and/or night sweats) is a classic combination a doctor must evaluate — arrange a review within days and bring the exact duration since it began."],
  },
  {
    label: "vomiting with abdominal pain",
    requires: ["vomiting", "abdominal pain"],
    requireCount: 2,
    urgency: "urgent",
    guidance: ["Vomiting with persistent abdominal pain belongs in an in-person examination — arrange same-day care if severe."],
  },
  {
    label: "dehydration signs with vomiting or diarrhoea",
    requires: ["vomiting", "diarrhoea", "dehydration signs"],
    requireCount: 2,
    urgency: "urgent",
    guidance: ["Dehydration signs with ongoing vomiting or diarrhoea need in-person assessment — oral intake alone is often insufficient at this stage."],
  },
  {
    label: "dizziness with stroke-pattern symptoms",
    requires: ["dizziness", "stroke warning signs"],
    requireCount: 2,
    urgency: "emergency",
    guidance: ["Dizziness alongside one-sided weakness or speech changes is treated as a stroke pattern — emergency services now."],
  },
  {
    label: "urinary symptoms with fever",
    requires: ["urinary symptoms", "high fever", "fever (unspecified)"],
    requireCount: 2,
    urgency: "urgent",
    guidance: ["Fever climbing together with urinary symptoms suggests infection extending beyond the bladder — same-day review."],
  },
];

const aliasOverrides: Record<string, string[]> = {
  "running nose": ["runny nose"],
  "belly ache": ["abdominal pain"],
  "tummy ache": ["abdominal pain"],
  "stomach ache": ["abdominal pain"],
  "stomach upset": ["abdominal pain"],
  "temperature up and down": ["fever (unspecified)"],
  "feeling warm": ["fever (unspecified)"],
  "burning while passing urine": ["urinary symptoms"],
  "burning when peeing": ["urinary symptoms"],
  "peeing a lot": ["urinary symptoms"],
  "passing urine often": ["urinary symptoms"],
  "tight chest": ["chest pain"],
  "night sweats": ["widespread tiredness"],
  "drenching night sweats": ["widespread tiredness"],
};

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

const negationCueTokens = new Set([
  "no", "not", "none", "nope", "nor", "never", "without", "denies", "denied", "deny",
  "negative", "absent", "cannot", "cant", "can't", "hasn't", "hasnt", "haven't", "havnt",
  "didn't", "didnt", "don't", "dont", "doesn't", "doesnt", "isn't", "isnt", "wasn't", "wasnt",
]);

function negationSuppressesMatch(text: string, phraseFirstToken: string, phrasePrefix: string): boolean {
  if (phraseFirstToken === "no" || phraseFirstToken === "not" || phraseFirstToken === "none") {
    return false;
  }
  const matchStart = text.includes(phrasePrefix) ? text.indexOf(phrasePrefix) : -1;
  if (matchStart <= 0) return false;
  const clauseBefore = text.slice(0, matchStart).replace(/\b(but|however|although|while|whereas)\b/g, ",").replace(/[^a-z0-9 ]+/g, " ");
  const precedingTokens = clauseBefore.split(/\s+/).filter(Boolean).slice(-2);
  return precedingTokens.some((token) => negationCueTokens.has(token));
}

const curatedAliasIndex: Array<{ phrase: string; entry: CuratedSymptom }> = [];
for (const entry of curated) {
  for (const alias of entry.aliases) {
    curatedAliasIndex.push({ phrase: normalizeText(alias), entry });
    for (const [aliasFrom, aliasTargets] of Object.entries(aliasOverrides)) {
      if (aliasTargets.some((target) => normalizeText(target) === normalizeText(alias))) {
        curatedAliasIndex.push({ phrase: normalizeText(aliasFrom), entry });
      }
    }
  }
}

const catalogueDisplayToCurated: Map<string, CuratedSymptom> = (() => {
  const map = new Map<string, CuratedSymptom>();
  for (const entry of curated) {
    for (const alias of entry.aliases) {
      const normalized = normalizeText(alias);
      if (!map.has(normalized)) map.set(normalized, entry);
    }
  }
  return map;
})();

type MatchState = {
  entries: CuratedSymptom[];
  matchedCatalogueIds: string[];
};

function collectMatches(input: SymptomGuidanceInput): MatchState {
  const normalizedTexts = [
    input.primarySymptom,
    ...(input.associatedSymptoms ?? []),
    ...(input.medicalHistory ?? []),
    ...(input.selectedSymptoms ?? []),
    ...(input.followUpEvidence ?? []),
  ].map(normalizeText).filter(Boolean);

  const entries: CuratedSymptom[] = [];
  for (const { phrase, entry } of curatedAliasIndex) {
    if (entries.includes(entry)) continue;
    const matched = normalizedTexts.some((text) => {
      const hit = text.indexOf(phrase);
      if (hit < 0) return false;
      return !negationSuppressesMatch(text, phrase.split(" ")[0], phrase);
    });
    if (matched) entries.push(entry);
  }

  const catalogueIds = getSymptomCatalogueIds() ?? [];
  const matchedCatalogueIds: string[] = [];
  for (const id of catalogueIds) {
    const tokens = normalizeText(id).split(" ").filter((token) => token.length > 2);
    if (tokens.length === 0) continue;
    const found = normalizedTexts.some((text) => {
      const phrasePrefix = tokens.join(" ");
      const hit = text.indexOf(tokens[0]);
      if (hit < 0) return false;
      if (negationSuppressesMatch(text, tokens[0], phrasePrefix)) return false;
      if (text.includes(phrasePrefix)) return true;
      return tokens.every((token) => text.includes(token));
    });
    if (found) matchedCatalogueIds.push(id);
  }
  return { entries, matchedCatalogueIds };
}

function evaluateCombos(entries: CuratedSymptom[], matchedCatalogueIds: string[]): Array<{ rule: ComboRule }> {
  const labels = new Set(entries.map((entry) => entry.label));
  for (const id of matchedCatalogueIds) {
    const entry = catalogueDisplayToCurated.get(normalizeText(id));
    if (entry) labels.add(entry.label);
  }
  const fired: Array<{ rule: ComboRule }> = [];
  for (const rule of comboRules) {
    if (rule.requireCount === 0) continue;
    const matched = rule.requires.filter((requirement) => labels.has(requirement));
    if (matched.length >= rule.requireCount) fired.push({ rule });
  }
  return fired;
}

function assessUrgency(input: SymptomGuidanceInput, matched: MatchState, fired: Array<{ rule: ComboRule }>): SymptomGuidance["urgencyLevel"] {
  if (fired.some((row) => row.rule.urgency === "emergency")) return "emergency";
  const hasEmergencyEntry = matched.entries.some((entry) => entry.baseUrgency === "emergency");
  const hasUrgencyViaCatalogue = matched.matchedCatalogueIds.some((id) => {
    const entry = catalogueDisplayToCurated.get(normalizeText(id));
    return entry?.baseUrgency === "emergency";
  });
  if (hasEmergencyEntry || hasUrgencyViaCatalogue) return "emergency";

  const firedUrgent = fired.some((row) => row.rule.urgency === "urgent");
  const hasUrgentEntry = matched.entries.some((entry) => entry.baseUrgency === "urgent");
  const hasUrgentViaCatalogue = matched.matchedCatalogueIds.some((id) => {
    const entry = catalogueDisplayToCurated.get(normalizeText(id));
    return entry?.baseUrgency === "urgent";
  });
  const categoryRisk = ["cardiovascular", "respiratory", "neurological"].includes(input.symptomCategory);
  const escalationFloor = (input.followUpEscalations ?? []).reduce<"emergency" | "urgent" | null>((floor, escalation) => {
    if (escalation.urgency === "emergency") return "emergency";
    return floor ?? "urgent";
  }, null);
  if (escalationFloor === "emergency") return "emergency";
  if (firedUrgent || hasUrgentEntry || hasUrgentViaCatalogue || input.severity === "severe" || input.progression === "worsening" || (categoryRisk && input.severity === "moderate") || escalationFloor === "urgent") return "urgent";
  return "routine";
}

function possibleConditionsFromData(featureIds: string[]): PossibleCondition[] {
  if (featureIds.length === 0) return [];
  const associations = getSymptomAssociation(featureIds);
  if (!associations) return [];
  return associations.slice(0, 4).map((row) => ({
    name: row.condition,
    basis: "condition most associated with the reported symptoms in the labelled training dataset (research association, not a diagnosis)",
  }));
}

export function assessSymptomGuidance(input: SymptomGuidanceInput): SymptomGuidance {
  const matched = collectMatches(input);
  const fired = evaluateCombos(matched.entries, matched.matchedCatalogueIds);
  const urgency = assessUrgency(input, matched, fired);

  const primaryEntries: CuratedSymptom[] = [];
  const seen = new Set<string>();
  const pushEntry = (entry: CuratedSymptom) => {
    if (seen.has(entry.label) || primaryEntries.length >= 3) return;
    seen.add(entry.label);
    primaryEntries.push(entry);
  };
  for (const entry of matched.entries) pushEntry(entry);
  for (const id of matched.matchedCatalogueIds) {
    const entry = catalogueDisplayToCurated.get(normalizeText(id));
    if (entry) pushEntry(entry);
  }

  const recommendations: string[] = [];
  for (const escalation of [...(input.followUpEscalations ?? [])].reverse()) {
    for (const tip of escalation.guidance) {
      if (!recommendations.includes(tip)) recommendations.unshift(tip);
    }
  }
  if (urgency === "emergency") {
    recommendations.push("These inputs matched an emergency warning pattern. Contact local emergency services now or go to the nearest emergency department — do not wait for an appointment.");
  } else if (urgency === "urgent") {
    recommendations.push("Arrange in-person medical review promptly (today or soon, depending on how things evolve). The findings below describe urgency patterns, not a specific diagnosis.");
  } else {
    recommendations.push("Arrange scheduled professional assessment if symptoms persist, change, or concern you at any point.");
  }
  for (const entry of primaryEntries) {
    if (entry.note) recommendations.push(`About ${entry.label}: ${entry.note}`);
    for (const tip of entry.guidance) {
      if (!recommendations.includes(tip)) recommendations.push(tip);
      if (recommendations.length >= 14) break;
    }
    if (recommendations.length >= 14) break;
  }
  for (const row of [...fired].reverse()) {
    for (const tip of row.rule.guidance) {
      if (!recommendations.includes(tip)) recommendations.unshift(tip);
    }
  }
  recommendations.push("This comes from a transparent rule set applied to what you entered; it is not a diagnosis. The optional AI section on this page, if used, adds research exploration only and never replaces a clinician.");

  const redFlags: string[] = [];
  for (const entry of matched.entries) {
    if (entry.baseUrgency === "emergency") redFlags.push(entry.label);
  }
  for (const id of matched.matchedCatalogueIds) {
    const entry = catalogueDisplayToCurated.get(normalizeText(id));
    if (entry && entry.baseUrgency === "emergency" && !redFlags.includes(entry.label)) redFlags.push(entry.label);
  }
  for (const row of fired) redFlags.push(row.rule.label);
  for (const escalation of input.followUpEscalations ?? []) {
    if (!redFlags.includes(escalation.flagLabel)) redFlags.push(escalation.flagLabel);
  }

  const watchFor = primaryEntries.reduce<Array<string>>((list, entry) => {
    for (const item of entry.watchFor) {
      if (list.includes(item)) continue;
      list.push(item);
      if (list.length >= 6) return list;
    }
    return list;
  }, []);

  const seekCareIf = primaryEntries.reduce<Array<string>>((list, entry) => {
    for (const item of entry.seekCareIf) {
      if (!item || list.includes(item)) continue;
      list.push(item);
      if (list.length >= 6) return list;
    }
    return list;
  }, []);

  const possibleConditions = possibleConditionsFromData(matched.matchedCatalogueIds);

  return {
    urgencyLevel: urgency,
    redFlagsTriggered: [...new Set(redFlags)],
    recommendations,
    watchFor,
    seekCareIf: seekCareIf.length > 0 ? seekCareIf : ["any new chest pain, breathing difficulty, one-sided weakness, fainting, or uncontrolled bleeding — emergency care"],
    possibleConditions,
    disclaimer: DISCLAIMER,
  };
}

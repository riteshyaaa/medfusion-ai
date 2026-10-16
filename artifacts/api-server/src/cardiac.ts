// Cardiac risk assessment contract.
//
// No cardiac model artifact is present in this repository. There is no trained,
// verified, or approved heart-disease model, so the application must not produce
// a cardiac prediction. This module documents the exact contract a future model
// must satisfy and reports its availability honestly.

export type CardiacFeatureType = "numeric" | "categorical";

export type CardiacFeature = {
  name: string;
  type: CardiacFeatureType;
  unit: string | null;
  description: string;
  allowedValues?: string[];
  minimum?: number;
  maximum?: number;
};

export const CARDIAC_MODEL_CONTRACT = {
  task: "binary-heart-disease-risk-classification",
  dataset: {
    id: "UCI Heart Disease (Cleveland subset)",
    sourceUrl: "https://archive.ics.uci.edu/dataset/45/heart+disease",
    licenseNote: "UCI Machine Learning Repository terms; verify before any download.",
    knownLimitations: [
      "Small historical cohort from 1988; not representative of current populations.",
      "Substantial missing values in some fields; missing-value handling must be documented.",
      "A model trained on this data is research-only and cannot be presented as clinical risk.",
    ],
  },
  features: [
    { name: "age", type: "numeric", unit: "years", description: "Age at assessment", minimum: 18, maximum: 120 },
    { name: "sex", type: "categorical", unit: null, description: "Recorded sex", allowedValues: ["male", "female"] },
    { name: "chestPainType", type: "categorical", unit: null, description: "Chest pain type", allowedValues: ["typical_angina", "atypical_angina", "non_anginal", "asymptomatic"] },
    { name: "restingBloodPressure", type: "numeric", unit: "mm Hg", description: "Resting blood pressure", minimum: 60, maximum: 250 },
    { name: "serumCholesterol", type: "numeric", unit: "mg/dL", description: "Serum cholesterol", minimum: 50, maximum: 700 },
    { name: "fastingBloodSugarOver120", type: "categorical", unit: null, description: "Fasting blood sugar above 120 mg/dL", allowedValues: ["yes", "no"] },
    { name: "restingEcg", type: "categorical", unit: null, description: "Resting electrocardiographic result", allowedValues: ["normal", "st_t_abnormality", "left_ventricular_hypertrophy"] },
    { name: "maxHeartRate", type: "numeric", unit: "bpm", description: "Maximum heart rate achieved", minimum: 50, maximum: 250 },
    { name: "exerciseAngina", type: "categorical", unit: null, description: "Exercise-induced angina", allowedValues: ["yes", "no"] },
    { name: "stDepression", type: "numeric", unit: "mm", description: "ST depression induced by exercise relative to rest", minimum: 0, maximum: 10 },
    { name: "stSlope", type: "categorical", unit: null, description: "Slope of the peak exercise ST segment", allowedValues: ["upsloping", "flat", "downsloping"] },
    { name: "majorVessels", type: "numeric", unit: "count", description: "Number of major vessels (0-3) colored by fluoroscopy", minimum: 0, maximum: 3 },
    { name: "thalassemia", type: "categorical", unit: null, description: "Thalassemia test result", allowedValues: ["normal", "fixed_defect", "reversible_defect"] },
  ] as CardiacFeature[],
  preprocessingNote: "Any future model artifact must record dataset version, feature order, encodings, missing-value behavior, and calibration status, and be approved for inference before this application may serve a score.",
} as const;

export function hasApprovedCardiacModel(): boolean {
  return false;
}

export function cardiacModelStatus() {
  return {
    available: false as const,
    status: "model_unavailable" as const,
    reason: "No verified, approved cardiac risk model artifact is configured in this repository. No cardiac prediction can be produced.",
    contract: CARDIAC_MODEL_CONTRACT,
  };
}

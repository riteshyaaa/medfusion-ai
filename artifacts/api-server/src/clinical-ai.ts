import { z } from "zod";
import {
  AIProviderError,
  configuredProviderConfig,
  configuredVisionConfig,
  decodeStructuredProviderText,
  executeProviderStructuredRequest,
  type ProviderRequestOptions,
} from "./ai-providers";

const urgencySchema = z.enum(["routine", "prompt", "urgent", "emergency", "uncertain"]);
const severitySchema = z.enum(["mild", "moderate", "severe", "uncertain"]);

export const skinAIResultSchema = z.object({
  imageType: z.enum(["real_skin", "not_skin", "unclear"]).default("unclear"),
  visibleAbnormality: z.boolean().default(true),
  observations: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
  possibleConditions: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(1).max(300),
  }).strict()).max(5),
  uncertainty: z.string().trim().min(1).max(500),
  severity: severitySchema,
  urgency: urgencySchema,
  nextSteps: z.array(z.string().trim().min(1).max(300)).max(8),
  consultClinicianWhen: z.array(z.string().trim().min(1).max(300)).max(8),
}).strict();

export const symptomAIResultSchema = z.object({
  summary: z.string().trim().min(1).max(800),
  possibleExplanations: z.array(z.object({
    explanation: z.string().trim().min(1).max(180),
    whyItMayFit: z.string().trim().min(1).max(300),
  }).strict()).max(5),
  uncertainty: z.string().trim().min(1).max(500),
  suggestedNextSteps: z.array(z.string().trim().min(1).max(300)).max(8),
  warningSigns: z.array(z.string().trim().min(1).max(300)).max(8),
}).strict();

const evalFieldName = z.string().trim().min(1).max(600).regex(/^[^\u0000-\u001f\u007f]+$/);
export const symptomEvaluationSchema = z.object({
  summary: evalFieldName,
  reportedSymptoms: z.array(evalFieldName).min(1).max(12),
  possibleConsiderations: z.array(z.object({
    name: z.string().trim().min(2).max(120).regex(/^[^\u0000-\u001f\u007f]+$/),
    whyDiscussed: evalFieldName,
  }).strict()).min(0).max(5),
  supportingInformation: evalFieldName,
  missingInformation: evalFieldName,
  urgencyContext: evalFieldName,
  limitations: evalFieldName,
  followUpQuestions: z.array(z.string().trim().min(1).max(300).regex(/^[^\u0000-\u001f\u007f]+$/)).min(1).max(6),
  disclaimer: evalFieldName,
}).strict();
export type SymptomEvaluationResult = z.infer<typeof symptomEvaluationSchema>;

export const cardiacAIResultSchema = z.object({
  summary: z.string().trim().min(1).max(800),
  possibleExplanations: z.array(z.object({
    explanation: z.string().trim().min(1).max(180),
    whyItMayFit: z.string().trim().min(1).max(300),
  }).strict()).max(5),
  uncertainty: z.string().trim().min(1).max(500),
  suggestedNextSteps: z.array(z.string().trim().min(1).max(300)).max(8),
  warningSigns: z.array(z.string().trim().min(1).max(300)).max(8),
}).strict();

export type SkinAIResult = z.infer<typeof skinAIResultSchema>;
export type SymptomAIResult = z.infer<typeof symptomAIResultSchema>;
export type CardiacAIResult = z.infer<typeof cardiacAIResultSchema>;

export type AIAnalysisOutput<T> = {
  provider: "openai" | "gemini" | "nvidia" | "test";
  model: string;
  result: T;
};

const skinJsonSchema = {
  type: "object",
  properties: {
    imageType: { type: "string", enum: ["real_skin", "not_skin", "unclear"] },
    visibleAbnormality: { type: "boolean" },
    observations: { type: "array", items: { type: "string" } },
    possibleConditions: { type: "array", items: { type: "object", properties: { name: { type: "string" }, reason: { type: "string" } }, required: ["name", "reason"], additionalProperties: false } },
    uncertainty: { type: "string" },
    severity: { type: "string", enum: ["mild", "moderate", "severe", "uncertain"] },
    urgency: { type: "string", enum: ["routine", "prompt", "urgent", "emergency", "uncertain"] },
    nextSteps: { type: "array", items: { type: "string" } },
    consultClinicianWhen: { type: "array", items: { type: "string" } },
  },
  required: ["imageType", "visibleAbnormality", "observations", "possibleConditions", "uncertainty", "severity", "urgency", "nextSteps", "consultClinicianWhen"],
  additionalProperties: false,
};

const symptomJsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    possibleExplanations: { type: "array", items: { type: "object", properties: { explanation: { type: "string" }, whyItMayFit: { type: "string" } }, required: ["explanation", "whyItMayFit"], additionalProperties: false } },
    uncertainty: { type: "string" },
    suggestedNextSteps: { type: "array", items: { type: "string" } },
    warningSigns: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "possibleExplanations", "uncertainty", "suggestedNextSteps", "warningSigns"],
  additionalProperties: false,
};

const symptomEvaluationJsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    reportedSymptoms: { type: "array", items: { type: "string" } },
    possibleConsiderations: { type: "array", items: { type: "object", properties: { name: { type: "string" }, whyDiscussed: { type: "string" } }, required: ["name", "whyDiscussed"], additionalProperties: false } },
    supportingInformation: { type: "string" },
    missingInformation: { type: "string" },
    urgencyContext: { type: "string" },
    limitations: { type: "string" },
    followUpQuestions: { type: "array", items: { type: "string" } },
    disclaimer: { type: "string" },
  },
  required: ["summary", "reportedSymptoms", "possibleConsiderations", "supportingInformation", "missingInformation", "urgencyContext", "limitations", "followUpQuestions", "disclaimer"],
  additionalProperties: false,
};

const skinSystem = [
  "You are an experienced dermatology AI assistant analyzing a submitted skin image with the depth of a trained diagnostic model.",
  "First check the image itself: if it is a drawing, illustration, 3D render, object, screenshot, or anything that is not a genuine photograph of human skin, set imageType to not_skin.",
  "For a genuine skin photograph, assess like a clinician: skin tone and phototype, lesion color distribution, border regularity, symmetry, diameter, texture, surface changes, and surrounding skin.",
  "If no lesion, rash, irritation, or pigment change is visible, set visibleAbnormality to false and say the skin appears within normal limits.",
  "PossibleConditions are exactly four named conditions whose visible features best fit what you observe, ordered from the closest match first to progressively weaker matches, each with the visible feature overlap that supports it. Keep names precise (for example: Atopic dermatitis, Melanocytic nevus, Tinea corporis).",
  "Describe visible features using plain clinical wording; note where image quality limits the assessment. Do not infer identity, age, or ethnicity from the image.",
  "Do not provide confidence scores, probabilities, percentages, citations, or invented image-preprocessing claims.",
  "Use the phrase 'may fit' or 'commonly presents as' rather than asserting 'you have'. End the disclaimer field with one short line advising a doctor visit if symptoms persist.",
  "Return only the requested JSON object.",
].join(" ");

const symptomSystem = [
  "Provide detailed, medically informed context for self-reported symptoms, grounded in the supplied details.",
  "Use only supplied details. Explain which conditions classically present with this symptom pattern and why.",
  "Do not provide probabilities, confidence scores, percentages, or fabricated medical history.",
  "Mention uncertainty and appropriate professional evaluation. Do not downgrade server-supplied urgent guidance.",
  "Use the phrase 'may fit' or 'commonly presents as' rather than asserting 'you have'. End the disclaimer field with one short line advising a doctor visit if symptoms persist.",
  "Return only the requested JSON object.",
].join(" ");

const cardiacSystem = [
  "Provide cautious educational context for structured cardiac assessment inputs, not a diagnosis or clinical risk score.",
  "Never say that a person is safe or has a disease. Do not estimate risk, probabilities, or confidence scores.",
  "Do not interpret ECG waveforms or test files; only the structured values provided are available.",
  "Do not recommend medicines or doses. State uncertainty and encourage professional evaluation.",
  "Return only the requested JSON object.",
].join(" ");

const noDiagnosisPatterns = [
  // "If you have ..." phrasing is a legitimate caution, not a claim; direct assertions are not.
  /(?<!\bif\s)\byou\s+(?:(?:definitely|certainly|clearly|obviously)\s+)?have\b/i,
  /\bdiagnosed with\b/i,
  /\bthis confirms\b/i,
  /\bthe image proves\b/i,
  /\bno (?:heart|cardiac|serious) (?:problem|condition|risk)\b/i,
];

function validateClinicalText<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AIProviderError("provider_malformed_response");
  const texts = flattenStrings(parsed.data);
  for (const text of texts) {
    if (noDiagnosisPatterns.some((pattern) => pattern.test(text)) || /\b\d+(?:\.\d+)?\s?%|\b\d+(?:\.\d+)?\s+percent\b/i.test(text)) {
      throw new AIProviderError("provider_malformed_response");
    }
  }
  return parsed.data;
}

function flattenStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(flattenStrings);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(flattenStrings);
  return [];
}

function requestText(task: string, data: unknown): string {
  return JSON.stringify({ task, providedInformation: data });
}

export type SymptomAIInput = {
  primarySymptom: string;
  symptomCategory: string;
  onset?: string;
  duration?: string;
  severity?: string;
  progression?: string;
  associatedSymptoms: string[];
  selectedSymptoms: string[];
  medicalHistory?: string[];
  medications?: string[];
  allergies?: string[];
};

export type CardiacAIInput = Record<string, string | number | string[]>;

export interface ClinicalAIProvider {
  analyzeSkin(imageDataUrl: string): Promise<AIAnalysisOutput<SkinAIResult>>;
  analyzeSymptoms(input: SymptomAIInput): Promise<AIAnalysisOutput<SymptomAIResult>>;
  analyzeCardiac(input: CardiacAIInput): Promise<AIAnalysisOutput<CardiacAIResult>>;
  evaluateSymptoms(input: SymptomAIInput & { urgencyLevel: string; redFlags: string[]; guidance: Record<string, unknown> }): Promise<AIAnalysisOutput<SymptomEvaluationResult>>;
}

export function validateCardiacUrgencySymptoms(symptoms: string[]): string[] {
  const emergencyTerms = new Set([
    "current_chest_pain",
    "severe_shortness_of_breath",
    "fainting",
    "stroke_signs",
    "uncontrolled_bleeding",
    "severe_allergic_reaction",
  ]);
  return [...new Set(symptoms.filter((symptom) => emergencyTerms.has(symptom)))];
}

export function createClinicalAIProvider(
  config: Parameters<typeof executeProviderStructuredRequest>[0],
  options: ProviderRequestOptions = {},
): ClinicalAIProvider {
  const call = async <T>(
    schema: z.ZodType<T>,
    schemaName: string,
    jsonSchema: Record<string, unknown>,
    system: string,
    user: string,
    imageDataUrl?: string,
    maxOutputTokens = 3_000,
  ): Promise<AIAnalysisOutput<T>> => {
    const response = await executeProviderStructuredRequest(config, {
      system,
      user,
      schemaName,
      jsonSchema,
      maxOutputTokens,
      ...(imageDataUrl ? { imageDataUrl } : {}),
    }, options);
    const decoded = decodeStructuredProviderText(config, response);
    return { provider: config.provider, model: config.visionModel ?? config.model, result: validateClinicalText(schema, decoded) };
  };
  return {
    analyzeSkin(imageDataUrl) {
      if (!/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(imageDataUrl) || imageDataUrl.length > 5_000_000) {
        return Promise.reject(new AIProviderError("provider_request_rejected"));
      }
      return call(skinAIResultSchema,"medscope_skin_assessment", skinJsonSchema, skinSystem, "Analyze the attached skin image and return the structured JSON assessment. Analyze efficiently and output the JSON directly.", imageDataUrl, 3_200) as Promise<AIAnalysisOutput<SkinAIResult>>;
    },
    analyzeSymptoms(input) {
      return call(
        symptomAIResultSchema,
        "medscope_symptom_assessment",
        symptomJsonSchema,
        symptomSystem,
        requestText("Summarize the reported symptoms and provide non-diagnostic educational next steps.", input),
      );
    },
    analyzeCardiac(input) {
      return call(
        cardiacAIResultSchema,
        "medscope_cardiac_assessment",
        symptomJsonSchema,
        cardiacSystem,
        requestText("Explain these structured cardiac-assessment inputs for education only. No ECG or other test file was supplied.", input),
      );
    },
    evaluateSymptoms(input) {
      const { urgencyLevel, redFlags, guidance, ...rest } = input;
      const user = JSON.stringify({
        task: "Provide a structured educational interpretation of this saved symptom assessment. Cautious possibilities only; never diagnose, never prescribe, never invent numbers or history.",
        urgencyLevel,
        matchedUrgencyFlags: redFlags,
        deterministicRuleGuidance: guidance,
        assessment: rest,
      });
      return call(symptomEvaluationSchema, "medscope_symptom_evaluation", symptomEvaluationJsonSchema, symptomSystem, user);
    },
  };
}

let testProvider: ClinicalAIProvider | undefined;
export function setTestClinicalAIProvider(provider: ClinicalAIProvider | undefined): void {
  if (process.env.NODE_ENV !== "test") throw new Error("Test clinical AI providers may only be installed in test mode");
  testProvider = provider;
}

export function getClinicalAIProvider(
  env: NodeJS.ProcessEnv = process.env,
  options: ProviderRequestOptions & { useVisionModel?: boolean } = {},
): { status: "disabled" | "unconfigured" | "misconfigured" | "configured" | "test"; provider?: ClinicalAIProvider; model?: string } {
  if (testProvider) return { status: "test", provider: testProvider, model: "test-double" };
  const configured = options.useVisionModel ? configuredVisionConfig(env) : configuredProviderConfig(env);
  if (configured.status !== "configured" || !configured.config) return { status: configured.status };
  return {
    status: "configured",
    provider: createClinicalAIProvider(configured.config, options),
    model: configured.config.visionModel ?? configured.config.model,
  };
}

import { z } from "zod";
import {
  AIProviderError,
  configuredProviderConfig,
  decodeStructuredProviderText,
  executeProviderStructuredRequest,
  type ProviderRequestOptions,
} from "./ai-providers";

const urgencySchema = z.enum(["routine", "prompt", "urgent", "emergency", "uncertain"]);
const severitySchema = z.enum(["mild", "moderate", "severe", "uncertain"]);

export const skinAIResultSchema = z.object({
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
    observations: { type: "array", items: { type: "string" } },
    possibleConditions: { type: "array", items: { type: "object", properties: { name: { type: "string" }, reason: { type: "string" } }, required: ["name", "reason"], additionalProperties: false } },
    uncertainty: { type: "string" },
    severity: { type: "string", enum: ["mild", "moderate", "severe", "uncertain"] },
    urgency: { type: "string", enum: ["routine", "prompt", "urgent", "emergency", "uncertain"] },
    nextSteps: { type: "array", items: { type: "string" } },
    consultClinicianWhen: { type: "array", items: { type: "string" } },
  },
  required: ["observations", "possibleConditions", "uncertainty", "severity", "urgency", "nextSteps", "consultClinicianWhen"],
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

const skinSystem = [
  "You provide cautious educational observations about a skin image for a research prototype.",
  "Do not diagnose, identify a disease as certain, recommend medication, or claim the image proves someone is safe.",
  "Describe visible features only; image quality and lighting can limit interpretation. Do not infer identity, age, ethnicity, or other personal attributes.",
  "Give a short list of possible explanations only when appropriate, state uncertainty, and encourage clinician evaluation when warranted.",
  "Do not provide confidence scores, probabilities, percentages, citations, or invented image preprocessing claims.",
  "Return only the requested JSON object.",
].join(" ");

const symptomSystem = [
  "Provide cautious educational context for self-reported symptoms, not a diagnosis or medical advice.",
  "Use only supplied details. Do not state that the user has a condition, rule out a serious cause, or recommend medicines or doses.",
  "Do not provide probabilities, confidence scores, percentages, or fabricated medical history.",
  "Mention uncertainty and appropriate professional evaluation. Do not downgrade server-supplied urgent guidance.",
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
  /\byou (?:definitely |certainly )?have\b/i,
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
  if (config.provider !== "openai") {
    throw new AIProviderError("provider_request_rejected");
  }
  const call = async <T>(
    schema: z.ZodType<T>,
    schemaName: string,
    jsonSchema: Record<string, unknown>,
    system: string,
    user: string,
    imageDataUrl?: string,
  ): Promise<AIAnalysisOutput<T>> => {
    const response = await executeProviderStructuredRequest(config, {
      system,
      user,
      schemaName,
      jsonSchema,
      maxOutputTokens: 1_800,
      ...(imageDataUrl ? { imageDataUrl } : {}),
    }, options);
    const decoded = decodeStructuredProviderText(config, response);
    return { provider: config.provider, model: config.model, result: validateClinicalText(schema, decoded) };
  };
  return {
    analyzeSkin(imageDataUrl) {
      if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(imageDataUrl) || imageDataUrl.length > 5_000_000) {
        return Promise.reject(new AIProviderError("provider_request_rejected"));
      }
      return call(skinAIResultSchema, "medscope_skin_assessment", skinJsonSchema, skinSystem, "Assess the visible skin image for informational purposes only. Do not infer a diagnosis.", imageDataUrl);
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
  };
}

let testProvider: ClinicalAIProvider | undefined;
export function setTestClinicalAIProvider(provider: ClinicalAIProvider | undefined): void {
  if (process.env.NODE_ENV !== "test") throw new Error("Test clinical AI providers may only be installed in test mode");
  testProvider = provider;
}

export function getClinicalAIProvider(
  env: NodeJS.ProcessEnv = process.env,
  options: ProviderRequestOptions = {},
): { status: "disabled" | "unconfigured" | "misconfigured" | "configured" | "test"; provider?: ClinicalAIProvider; model?: string } {
  if (testProvider) return { status: "test", provider: testProvider, model: "test-double" };
  const configured = configuredProviderConfig(env);
  if (configured.status !== "configured") return { status: configured.status };
  if (configured.config?.provider !== "openai") return { status: "misconfigured" };
  return {
    status: "configured",
    provider: createClinicalAIProvider(configured.config, options),
    model: configured.config.model,
  };
}

import { z } from "zod";
import {
  AIProviderError,
  conformToSchema,
  configuredProviderConfig,
  decodeStructuredProviderText,
  executeProviderStructuredRequest,
  type AIProviderId,
  type ProviderRequestOptions,
} from "./ai-providers";

export type InterpretationFindingInput = {
  label: string;
  valueText: string | null;
  unit: string | null;
  referenceRange: string | null;
  pageNumber: number | null;
  sourceText: string;
};

export type DocumentInterpretationInput = {
  documentType: string;
  pageCount: number | null;
  extractionMethod: "pdf_text" | "pdf_embedded_image_ocr" | "image_ocr" | "none";
  findings: InterpretationFindingInput[];
  narrativeText?: string;
};

// Bumped whenever the interpretation prompt or validation rules change so that
// stored interpretations can be attributed to the version that produced them.
export const DOCUMENT_INTERPRETATION_PROMPT_VERSION = "document-interpretation-v2";

const interpretationSectionsSchema = z.object({
  documentType: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(2_000),
  findingsExplained: z.array(z.object({
    label: z.string().trim().min(1).max(120),
    valueText: z.string().trim().max(120).nullable(),
    unit: z.string().trim().max(60).nullable(),
    referenceRange: z.string().trim().max(120).nullable(),
    pageNumber: z.number().int().min(1).max(500).nullable(),
    explanation: z.string().trim().min(1).max(800),
  }).strict()).max(100),
  terminology: z.array(z.object({
    term: z.string().trim().min(1).max(120),
    plainLanguage: z.string().trim().min(1).max(400),
  }).strict()).max(40),
  inconsistencies: z.array(z.string().trim().min(1).max(400)).max(20),
  missingInformation: z.array(z.string().trim().min(1).max(400)).max(20),
  questionsForClinician: z.array(z.string().trim().min(1).max(400)).max(20),
  limitations: z.array(z.string().trim().min(1).max(400)).max(20),
}).strict();

export type DocumentInterpretationSections = z.infer<typeof interpretationSectionsSchema>;

export const documentInterpretationJsonSchema = {
  type: "object",
  properties: {
    documentType: { type: "string" },
    summary: { type: "string" },
    findingsExplained: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          valueText: { type: ["string", "null"] },
          unit: { type: ["string", "null"] },
          referenceRange: { type: ["string", "null"] },
          pageNumber: { type: ["integer", "null"] },
          explanation: { type: "string" },
        },
        required: ["label", "valueText", "unit", "referenceRange", "pageNumber", "explanation"],
        additionalProperties: false,
      },
    },
    terminology: {
      type: "array",
      items: {
        type: "object",
        properties: { term: { type: "string" }, plainLanguage: { type: "string" } },
        required: ["term", "plainLanguage"],
        additionalProperties: false,
      },
    },
    inconsistencies: { type: "array", items: { type: "string" } },
    missingInformation: { type: "array", items: { type: "string" } },
    questionsForClinician: { type: "array", items: { type: "string" } },
    limitations: { type: "array", items: { type: "string" } },
  },
  required: ["documentType", "summary", "findingsExplained", "terminology", "inconsistencies", "missingInformation", "questionsForClinician", "limitations"],
  additionalProperties: false,
};

const systemPrompt = [
  "You explain already-extracted medical report findings in plain language for a research prototype.",
  "You are not giving a diagnosis and must not tell a person what condition they have.",
  "Use only the supplied findings and, when present, the supplied narrativeText. Never add values, units, reference ranges, dates, percentages, or facts that are not present in the supplied data.",
  "Never invent laboratory results or reference intervals. If something is missing, list it under missingInformation instead.",
  "Quote the supplied valueText, unit, referenceRange, and pageNumber exactly as provided when referring to a finding.",
  "Do not fabricate citations. Do not recommend specific medications or doses. Suggest questions a clinician could clarify.",
  "Return only the JSON object required by the response schema.",
].join(" ");

function userPrompt(input: DocumentInterpretationInput): string {
  return JSON.stringify({
    task: "Explain these extracted findings as education. Distinguish extracted facts from your explanation.",
    documentTypeGuess: input.documentType,
    pageCount: input.pageCount,
    extractionMethod: input.extractionMethod,
    extractionQualityNote: input.extractionMethod === "pdf_text"
      ? "Text was extracted from the PDF text layer. Values may still contain document errors and require user confirmation."
      : "Text was produced by OCR and may contain recognition errors; treat every value as unverified until the user confirms it.",
    findings: input.findings.map((finding) => ({
      label: finding.label,
      valueText: finding.valueText,
      unit: finding.unit,
      referenceRange: finding.referenceRange,
      pageNumber: finding.pageNumber,
      sourceLine: finding.sourceText.slice(0, 240),
    })),
    narrativeText: input.narrativeText === undefined
      ? undefined
      : {
          characterLimitNote: "Plain extracted text from a document with no structured findings. Explain its content at a general educational level.",
          text: input.narrativeText.slice(0, 12_000),
        },
  });
}

export class InterpretationValidationError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "InterpretationValidationError";
  }
}

const FORBIDDEN_PATTERNS = [
  /\byou (?:definitely |certainly )?have\b/i,
  /\bdiagnosed with\b/i,
  /\bthis confirms\b/i,
  /\byou should take\b/i,
];

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function assertNoInventedNumbers(sections: DocumentInterpretationSections, findings: InterpretationFindingInput[], narrativeNumbers: string[] = []): void {
  const allowedStrings: string[] = [];
  for (const finding of findings) {
    for (const value of [finding.label, finding.valueText, finding.unit, finding.referenceRange]) {
      if (value) allowedStrings.push(value);
    }
    // Page numbers are extracted facts the model may legitimately cite.
    if (finding.pageNumber !== null && finding.pageNumber !== undefined) allowedStrings.push(String(finding.pageNumber));
  }
  const allowedNormalized = allowedStrings.map((value) => value.toLowerCase());
  const allowedTokens = new Set<string>();
  for (const value of allowedStrings) {
    for (const token of value.match(/\d+(?:[.,]\d+)?/g) ?? []) allowedTokens.add(token.replace(",", "."));
  }
  // Narrative documents have no structured findings; every number that appears
  // verbatim in the extracted narrative text is a legitimate fact to restate.
  for (const token of narrativeNumbers) allowedTokens.add(token);
  const freeTextFields: string[] = [
    sections.summary,
    ...sections.findingsExplained.map((entry) => entry.explanation),
    ...sections.terminology.map((entry) => entry.plainLanguage),
    ...sections.inconsistencies,
    ...sections.missingInformation,
    ...sections.questionsForClinician,
    ...sections.limitations,
  ];
  for (const field of freeTextFields) {
    for (const match of field.match(/\d+(?:[.,]\d+)?%?/g) ?? []) {
      const hasPercent = match.endsWith("%");
      const base = (hasPercent ? match.slice(0, -1) : match).replace(",", ".");
      if (!allowedTokens.has(base)) {
        throw new InterpretationValidationError(`generated text contains a number not present in the extracted findings: ${match}`);
      }
      if (hasPercent && !allowedNormalized.some((value) => value.includes(base) && value.includes("%"))) {
        throw new InterpretationValidationError(`generated text uses a percentage that is not present in the extracted findings: ${match}`);
      }
    }
  }
  for (const pattern of FORBIDDEN_PATTERNS) {
    for (const field of freeTextFields) {
      if (pattern.test(field)) throw new InterpretationValidationError("generated text makes a diagnosis or treatment claim");
    }
  }
}

function assertFindingsMatchInput(sections: DocumentInterpretationSections, findings: InterpretationFindingInput[]): void {
  const byLabel = new Map<string, InterpretationFindingInput[]>();
  for (const finding of findings) {
    const key = normalize(finding.label);
    const list = byLabel.get(key) ?? [];
    list.push(finding);
    byLabel.set(key, list);
  }
  for (const explained of sections.findingsExplained) {
    const candidates = byLabel.get(normalize(explained.label));
    if (!candidates || candidates.length === 0) {
      throw new InterpretationValidationError(`explained finding label is not present in the extracted findings: ${explained.label}`);
    }
    const valueKey = explained.valueText === null ? null : normalize(explained.valueText);
    const unitKey = explained.unit === null ? null : normalize(explained.unit);
    const rangeKey = explained.referenceRange === null ? null : normalize(explained.referenceRange);
    const match = candidates.some((candidate) =>
      (candidate.valueText === null ? null : normalize(candidate.valueText)) === valueKey
      && (candidate.unit === null ? null : normalize(candidate.unit)) === unitKey
      && (candidate.referenceRange === null ? null : normalize(candidate.referenceRange)) === rangeKey,
    );
    if (!match) {
      throw new InterpretationValidationError(`explained finding values do not match the extracted finding: ${explained.label}`);
    }
  }
}

export function validateInterpretationSections(decoded: unknown, findings: InterpretationFindingInput[], narrativeText?: string): DocumentInterpretationSections {
  const parsed = interpretationSectionsSchema.safeParse(decoded);
  if (!parsed.success) throw new InterpretationValidationError("provider output does not match the required schema");
  const narrativeNumbers = narrativeText
    ? [...new Set((narrativeText.match(/\d+(?:[.,]\d+)?/g) ?? []).map((token) => token.replace(",", ".")))]
    : [];
  assertFindingsMatchInput(parsed.data, findings);
  assertNoInventedNumbers(parsed.data, findings, narrativeNumbers);
  return parsed.data;
}

export type DocumentInterpretationResult = {
  provider: AIProviderId | "test";
  model: string;
  sections: DocumentInterpretationSections;
};

export interface DocumentInterpreter {
  interpret(input: DocumentInterpretationInput): Promise<DocumentInterpretationResult>;
}

let testDocumentInterpreter: DocumentInterpreter | undefined;

export function setTestDocumentInterpreter(interpreter: DocumentInterpreter | undefined): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("A test document interpreter can only be installed in test mode");
  }
  testDocumentInterpreter = interpreter;
}

export function createDocumentInterpreter(config: Parameters<typeof executeProviderStructuredRequest>[0], options: ProviderRequestOptions = {}): DocumentInterpreter {
  return {
    // The endpoint is nondeterministic at temperature 0 (shared free tier), and
    // both unreadable replies and anti-invention validation rejections can
    // disappear on a fresh sample. One extra attempt, like the clinical
    // provider's malformed-response retry; validation is still authoritative.
    async interpret(input) {
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const responsePayload = await executeProviderStructuredRequest(config, {
            system: systemPrompt,
            user: userPrompt(input),
            schemaName: "medscope_document_interpretation",
            jsonSchema: documentInterpretationJsonSchema,
            maxOutputTokens: 2_400,
          }, options);
          const decoded = decodeStructuredProviderText(config, responsePayload);
          const sections = validateInterpretationSections(conformToSchema(interpretationSectionsSchema, decoded), input.findings, input.narrativeText);
          return { provider: config.provider, model: config.model, sections };
        } catch (error) {
          lastError = error;
          const retryable = (error instanceof AIProviderError && error.code === "provider_malformed_response")
            || error instanceof InterpretationValidationError;
          if (!retryable) throw error;
        }
      }
      throw lastError;
    },
  };
}

export function getDocumentInterpreter(
  env: NodeJS.ProcessEnv = process.env,
  options: ProviderRequestOptions = {},
): { status: "disabled" | "unconfigured" | "misconfigured" | "configured" | "test"; interpreter?: DocumentInterpreter } {
  if (testDocumentInterpreter) return { status: "test", interpreter: testDocumentInterpreter };
  const configured = configuredProviderConfig(env);
  if (configured.status !== "configured") return { status: configured.status };
  return { status: "configured", interpreter: createDocumentInterpreter(configured.config!, options) };
}

export function externalHealthDataTransferEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AI_DATA_SHARING_ENABLED === "true" && env.AI_HEALTH_DATA_TRANSFER_APPROVED === "true";
}

export { AIProviderError };

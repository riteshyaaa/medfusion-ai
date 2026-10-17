import { z } from "zod";

export const aiProviders = ["nvidia", "gemini", "openai"] as const;
export type AIProviderId = (typeof aiProviders)[number];
export type AIProviderSetting = "none" | AIProviderId;

export type SkinCandidate = { label: string; score: number };
export type SkinExplanationInput = {
  modelId: string;
  modelVersion: string;
  scoreSemantics: "raw_model_score" | "calibrated_probability";
  candidates: SkinCandidate[];
};
export type SkinExplanation = {
  provider: AIProviderId;
  model: string;
  explanation: string;
};

type ProviderConfig = {
  provider: AIProviderId;
  model: string;
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  maxConcurrency: number;
  /** Optional image-capable model override selected from the verified vision allowlist. */
  visionModel?: string;
};

export type { ProviderConfig };

type ConfigState =
  | { status: "disabled" }
  | { status: "unconfigured" }
  | { status: "misconfigured" }
  | { status: "configured"; config: ProviderConfig };

const modelAllowlist: Record<AIProviderId, readonly string[]> = {
  nvidia: ["nvidia/nemotron-3-super-120b-a12b", "nvidia/nemotron-3.5-lightning-30b-a3b", "openai/gpt-oss-20b"],
  gemini: ["gemini-3.8-flash"],
  openai: ["gpt-5.2", "gpt-5.4", "gpt-5.4-mini", "gpt-5.5", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini", "o4-mini", "o3", "o3-mini"],
};
// Verified against the live NVIDIA endpoint: these models accept multimodal
// content arrays ({type:"image_url"} parts) on /v1/chat/completions.
const visionModelAllowlist: Partial<Record<AIProviderId, readonly string[]>> = {
  nvidia: ["nvidia/nemotron-3.5-super-vl-120b-a12b", "meta/llama-3.2-11b-vision-instruct", "meta/llama-3.2-90b-vision-instruct", "microsoft/phi-3-vision-128k-instruct"],
  gemini: ["gemini-3.8-flash"],
  openai: ["gpt-5.2", "gpt-5.4", "gpt-4.1", "gpt-4o", "o4-mini", "o3"],
};
const defaultVisionModels: Partial<Record<AIProviderId, string>> = {
  nvidia: "nvidia/nemotron-3.5-super-vl-120b-a12b",
  gemini: "gemini-3.8-flash",
  openai: "gpt-5.2",
};
const defaultModels: Record<AIProviderId, string> = {
  nvidia: "nvidia/nemotron-3-super-120b-a12b",
  gemini: "gemini-3.8-flash",
  openai: "gpt-5.2",
};
const defaultBaseUrls: Record<AIProviderId, string> = {
  nvidia: "https://integrate.api.nvidia.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1",
  openai: "https://api.openai.com/v1",
};
const apiKeyEnv: Record<AIProviderId, string> = {
  nvidia: "NVIDIA_API_KEY",
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
};
const providerNames: Record<AIProviderId, string> = {
  nvidia: "NVIDIA_BASE_URL",
  gemini: "GEMINI_BASE_URL",
  openai: "OPENAI_BASE_URL",
};

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  return Math.min(max, Math.max(min, Number(value)));
}

export function getProviderConfigState(env: NodeJS.ProcessEnv = process.env): ConfigState {
  const managedKey = (env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "").trim();
  const managedBase = (env.AI_INTEGRATIONS_OPENAI_BASE_URL ?? "").trim();
  if (managedKey || managedBase) {
    if (!managedKey || !managedBase) return { status: "unconfigured" };
    const model = (env.AI_MODEL ?? "").trim() || "gpt-5.2";
    if (!modelAllowlist.openai.includes(model)) return { status: "misconfigured" };
    let baseUrl: URL;
    try {
      baseUrl = new URL(managedBase);
    } catch {
      return { status: "misconfigured" };
    }
    if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
      return { status: "misconfigured" };
    }
    return {
      status: "configured",
      config: {
        provider: "openai",
        model,
        apiKey: managedKey,
        baseUrl: baseUrl.toString().replace(/\/$/, ""),
        timeoutMs: boundedInteger(env.AI_REQUEST_TIMEOUT_MS, 30_000, 25, 180_000),
        maxRetries: boundedInteger(env.AI_MAX_RETRIES, 1, 0, 2),
        maxConcurrency: boundedInteger(env.AI_MAX_CONCURRENCY, 2, 1, 8),
      },
    };
  }

  const selected = (env.AI_PROVIDER ?? "none").trim().toLowerCase();
  if (selected === "none") return { status: "disabled" };
  if (!(aiProviders as readonly string[]).includes(selected)) return { status: "misconfigured" };

  const provider = selected as AIProviderId;
  const model = (env.AI_MODEL ?? "").trim() || defaultModels[provider];
  if (!modelAllowlist[provider].includes(model)) return { status: "misconfigured" };

  const rawBaseUrl = (env[providerNames[provider]] ?? "").trim() || defaultBaseUrls[provider];
  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBaseUrl);
  } catch {
    return { status: "misconfigured" };
  }
  if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    return { status: "misconfigured" };
  }

  const apiKey = (env[apiKeyEnv[provider]] ?? "").trim();
  if (!apiKey) return { status: "unconfigured" };

  return {
    status: "configured",
    config: {
      provider,
      model,
      apiKey,
      baseUrl: baseUrl.toString().replace(/\/$/, ""),
      timeoutMs: boundedInteger(env.AI_REQUEST_TIMEOUT_MS, 15_000, 25, 180_000),
      maxRetries: boundedInteger(env.AI_MAX_RETRIES, 1, 0, 2),
      maxConcurrency: boundedInteger(env.AI_MAX_CONCURRENCY, 2, 1, 8),
    },
  };
}

export function getAIProviderStatus(env: NodeJS.ProcessEnv = process.env): ConfigState["status"] {
  return getProviderConfigState(env).status;
}

export function configuredProviderConfig(env: NodeJS.ProcessEnv = process.env): { status: ConfigState["status"]; config?: ProviderConfig } {
  const state = getProviderConfigState(env);
  return state.status === "configured" ? { status: state.status, config: state.config } : { status: state.status };
}

export function externalHealthDataTransferEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AI_DATA_SHARING_ENABLED === "true" && env.AI_HEALTH_DATA_TRANSFER_APPROVED === "true";
}

export type ProviderErrorCode = "provider_timeout" | "provider_rate_limited" | "provider_invalid_credentials" | "provider_unavailable" | "provider_malformed_response" | "provider_request_rejected";

export class AIProviderError extends Error {
  constructor(readonly code: ProviderErrorCode) {
    super(code);
    this.name = "AIProviderError";
  }
}

const explanationSchema = z.object({
  explanation: z.string().trim().min(1).max(1_200),
}).strict();
const explanationInputSchema = z.object({
  modelId: z.string().trim().min(1).max(100).regex(/^[^\u0000-\u001f\u007f]+$/),
  modelVersion: z.string().trim().min(1).max(100).regex(/^[^\u0000-\u001f\u007f]+$/),
  scoreSemantics: z.enum(["raw_model_score", "calibrated_probability"]),
  candidates: z.array(z.object({
    label: z.string().trim().min(1).max(120).regex(/^[^\u0000-\u001f\u007f]+$/),
    score: z.number().finite().min(0).max(1),
  }).strict()).min(1).max(8),
}).strict();

const explanationJsonSchema = {
  type: "object",
  properties: {
    explanation: { type: "string" },
  },
  required: ["explanation"],
  additionalProperties: false,
};
const MAX_PROVIDER_RESPONSE_BYTES = 128 * 1024;

const systemPrompt = [
  "Write a brief educational explanation of the supplied skin-classifier candidate labels.",
  "This is not a diagnosis. Do not recommend treatment or say a person has a condition.",
  "Use only the supplied labels. Do not add candidate conditions, scores, percentages, citations, or claims about an image or patient.",
  "Explain that the output is a model result and requires professional assessment.",
  "Return only the JSON object required by the response schema.",
].join(" ");

function requestPrompt(input: SkinExplanationInput): string {
  const scoreDescription = input.scoreSemantics === "raw_model_score"
    ? "The supplied values are uncalibrated raw model scores, not probabilities or individual disease likelihoods."
    : "The supplied values are calibrated model outputs on evaluation data, not an individual's real-world disease likelihood.";
  return JSON.stringify({
    task: "Explain these persisted skin classifier outputs for education only.",
    modelId: input.modelId,
    modelVersion: input.modelVersion,
    scoreDescription,
    candidates: input.candidates,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readProviderJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new AIProviderError("provider_malformed_response");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new AIProviderError("provider_malformed_response");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > MAX_PROVIDER_RESPONSE_BYTES) {
        await reader.cancel();
        throw new AIProviderError("provider_malformed_response");
      }
      chunks.push(result.value);
    }
  } catch (error) {
    if (error instanceof AIProviderError) throw error;
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new AIProviderError("provider_timeout");
    }
    throw new AIProviderError("provider_malformed_response");
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new AIProviderError("provider_malformed_response");
  }
}

function outputText(config: ProviderConfig, payload: unknown): string {
  if (!isRecord(payload)) throw new AIProviderError("provider_malformed_response");
  if (config.provider === "openai") {
    if (typeof payload.output_text === "string") return payload.output_text;
    if (Array.isArray(payload.output)) {
      for (const item of payload.output) {
        if (!isRecord(item) || item.type !== "message" || !Array.isArray(item.content)) continue;
        for (const part of item.content) {
          if (isRecord(part) && part.type === "output_text" && typeof part.text === "string") return part.text;
        }
      }
    }
  } else if (config.provider === "gemini") {
    if (payload.status !== "completed" || !Array.isArray(payload.steps)) throw new AIProviderError("provider_malformed_response");
    for (const step of payload.steps) {
      if (!isRecord(step) || step.type !== "model_output" || !Array.isArray(step.content)) continue;
      for (const part of step.content) {
        if (isRecord(part) && part.type === "text" && typeof part.text === "string") return part.text;
      }
    }
  } else if (Array.isArray(payload.choices)) {
    const choice = payload.choices[0];
    if (isRecord(choice) && isRecord(choice.message) && typeof choice.message.content === "string") {
      return choice.message.content;
    }
  }
  throw new AIProviderError("provider_malformed_response");
}

export type StructuredRequestOptions = {
  system: string;
  user: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  maxOutputTokens: number;
  imageDataUrl?: string;
};

export type ProviderRequestOptions = { fetchImpl?: typeof fetch; sleep?: (milliseconds: number) => Promise<void> };

// Image-capable variant of the provider config: same credentials/base URL,
// but the model must come from the verified vision allowlist. The override
// environment variable keeps one credential system while allowing an
// explicitly configured vision model.
export type VisionConfig = ProviderConfig & { readonly visionModel: string };
export function getVisionConfigState(env: NodeJS.ProcessEnv = process.env): ConfigState {
  const state = getProviderConfigState(env);
  if (state.status !== "configured") return state;
  const requested = (env.AI_SKIN_VISION_MODEL ?? "").trim();
  const visionModel = requested || (defaultVisionModels[state.config.provider] ?? "none");
  if (visionModel === "none") return { status: "misconfigured" };
  const allowlist = visionModelAllowlist[state.config.provider] ?? [];
  if (!allowlist.includes(visionModel)) return { status: "misconfigured" };
  const visionState: ConfigState = { status: "configured", config: { ...state.config, visionModel } };
  return visionState;
}

export function configuredVisionConfig(env: NodeJS.ProcessEnv = process.env): { status: ConfigState["status"]; config?: ProviderConfig } {
  const state = getVisionConfigState(env);
  return state.status === "configured" ? { status: state.status, config: state.config } : { status: state.status };
}

function requestFor(config: ProviderConfig, options: StructuredRequestOptions): { url: string; headers: HeadersInit; body: string } {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let path: string;
  let body: Record<string, unknown>;
  if (config.provider === "openai") {
    path = "/responses";
    headers.Authorization = "Bearer " + config.apiKey;
    body = {
      model: config.visionModel ?? config.model,
      store: false,
      max_output_tokens: options.maxOutputTokens,
      input: [
        { role: "system", content: [{ type: "input_text", text: options.system }] },
        {
          role: "user",
          content: [
            { type: "input_text", text: options.user },
            ...(options.imageDataUrl ? [{ type: "input_image", image_url: options.imageDataUrl, detail: "high" }] : []),
          ],
        },
      ],
      text: { format: { type: "json_schema", name: options.schemaName, strict: true, schema: options.jsonSchema } },
    };
  } else if (config.provider === "gemini") {
    path = "/interactions";
    headers["x-goog-api-key"] = config.apiKey;
    body = {
      model: config.visionModel ?? config.model,
      system_instruction: options.system,
      input: options.user,
      store: false,
      response_format: [{ type: "text", mime_type: "application/json", schema: options.jsonSchema }],
      generation_config: { max_output_tokens: options.maxOutputTokens },
    };
  } else {
    path = "/chat/completions";
    headers.Authorization = "Bearer " + config.apiKey;
    // NVIDIA Chat Completions hosted support for structured output was not
    // verified, so the required JSON shape is embedded in the prompt itself.
    const userText = `${options.user}\n\nReturn ONLY a JSON object (no markdown, no surrounding text) matching exactly this JSON schema:\n${JSON.stringify(options.jsonSchema)}`;
    body = {
      model: config.visionModel ?? config.model,
      messages: [
        { role: "system", content: options.system },
        { role: "user", content: options.imageDataUrl
          ? [
              { type: "text", text: userText },
              { type: "image_url", image_url: { url: options.imageDataUrl } },
            ]
          : userText },
      ],
      max_tokens: options.maxOutputTokens,
      temperature: 0,
    };
  }
  return { url: config.baseUrl + path, headers, body: JSON.stringify(body) };
}

class Semaphore {
  private active = 0;
  private waiting: Array<() => void> = [];
  constructor(private readonly maximum: number) {}
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.maximum) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try {
      return await work();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

const semaphoreByLimit = new Map<number, Semaphore>();
function semaphoreFor(maximum: number): Semaphore {
  let semaphore = semaphoreByLimit.get(maximum);
  if (!semaphore) {
    semaphore = new Semaphore(maximum);
    semaphoreByLimit.set(maximum, semaphore);
  }
  return semaphore;
}

async function executeStructuredRequest(
  config: ProviderConfig,
  request: { url: string; headers: HeadersInit; body: string },
  providerOptions: ProviderRequestOptions = {},
): Promise<unknown> {
  const fetchImpl = providerOptions.fetchImpl ?? fetch;
  const wait = providerOptions.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  return semaphoreFor(config.maxConcurrency).run(async () => {
    for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
      let response: Response;
      try {
        response = await fetchImpl(request.url, { method: "POST", headers: request.headers, body: request.body, redirect: "error", signal: AbortSignal.timeout(config.timeoutMs) });
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        if (attempt < config.maxRetries) {
          await wait(100 * (2 ** attempt));
          continue;
        }
        throw new AIProviderError(timedOut ? "provider_timeout" : "provider_unavailable");
      }
      if (response.ok) {
        return await readProviderJson(response);
      }
      if (response.status === 401 || response.status === 403) throw new AIProviderError("provider_invalid_credentials");
      if (response.status === 429) {
        if (attempt < config.maxRetries) {
          await wait(100 * (2 ** attempt));
          continue;
        }
        throw new AIProviderError("provider_rate_limited");
      }
      if (response.status >= 500) {
        if (attempt < config.maxRetries) {
          await wait(100 * (2 ** attempt));
          continue;
        }
        throw new AIProviderError("provider_unavailable");
      }
      throw new AIProviderError("provider_request_rejected");
    }
    throw new AIProviderError("provider_unavailable");
  });
}

export function decodeStructuredProviderText(config: ProviderConfig, responsePayload: unknown): unknown {
  const rawText = outputText(config, responsePayload);
  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    throw new AIProviderError("provider_malformed_response");
  }
}

export function executeProviderStructuredRequest(
  config: ProviderConfig,
  options: StructuredRequestOptions,
  providerOptions: ProviderRequestOptions = {},
): Promise<unknown> {
  return executeStructuredRequest(config, requestFor(config, options), providerOptions);
}

export type ExplanationProvider = { explain(input: SkinExplanationInput): Promise<SkinExplanation> };
export function createExplanationProvider(
  config: ProviderConfig,
  options: ProviderRequestOptions = {},
): ExplanationProvider {
  return {
    async explain(input) {
      const parsedInput = explanationInputSchema.safeParse(input);
      if (!parsedInput.success) throw new AIProviderError("provider_request_rejected");
      const responsePayload = await executeProviderStructuredRequest(config, {
        system: systemPrompt,
        user: requestPrompt(parsedInput.data),
        schemaName: "medscope_skin_explanation",
        jsonSchema: explanationJsonSchema,
        maxOutputTokens: 700,
      }, options);
      const decoded = decodeStructuredProviderText(config, responsePayload);
      const parsed = explanationSchema.safeParse(decoded);
      if (!parsed.success || /[\d%]/.test(parsed.data?.explanation ?? "")) {
        throw new AIProviderError("provider_malformed_response");
      }
      return { provider: config.provider, model: config.model, explanation: parsed.data.explanation };
    },
  };
}

export function configuredExplanationProvider(
  env: NodeJS.ProcessEnv = process.env,
  options: ProviderRequestOptions = {},
): { status: ConfigState["status"]; provider?: ExplanationProvider } {
  const state = getProviderConfigState(env);
  if (state.status !== "configured") return { status: state.status };
  return { status: state.status, provider: createExplanationProvider(state.config, options) };
}

export type SymptomConditionInput = {
  primarySymptom: string;
  symptomCategory: string;
  severity?: string;
  progression?: string;
  selectedSymptoms?: string[];
  redFlags?: string[];
  urgencyLevel?: string;
};
export type AIConditionSuggestion = { condition: string; rationale: string };
export type SymptomConditionAnalysis = {
  provider: AIProviderId;
  model: string;
  topConditions: AIConditionSuggestion[];
  note: string;
};

const symptomConditionSchema = z.object({
  topConditions: z.array(z.object({
    condition: z.string().trim().min(2).max(120).regex(/^[^\u0000-\u001f\u007f]+$/),
    rationale: z.string().trim().min(1).max(600).regex(/^[^\u0000-\u001f\u007f]+$/),
  }).strict()).min(1).max(3),
  note: z.string().trim().min(1).max(300).regex(/^[^\u0000-\u001f\u007f]+$/),
}).strict();

const symptomConditionJsonSchema = {
  type: "object",
  properties: {
    topConditions: {
      type: "array",
      items: {
        type: "object",
        properties: { condition: { type: "string" }, rationale: { type: "string" } },
        required: ["condition", "rationale"],
        additionalProperties: false,
      },
    },
    note: { type: "string" },
  },
  required: ["topConditions", "note"],
  additionalProperties: false,
};

const symptomConditionPrompt = [
  "You are helping a person explore what commonly causes the symptoms they described.",
  "List at most 3 generally recognized common conditions that are classically associated with the supplied symptom pattern, ranked from most to least typical.",
  "Explain briefly why each is commonly associated, using well-established medical knowledge.",
  "Hard rules: keep the tone informational; avoid asserting that the person has any condition; no treatment or medication advice; no percentages or invented statistics; only conditions already well known to the public.",
  "Fields must be plain text with no line breaks.",
  "Return only the JSON object required by the response schema.",
].join(" ");

const symptomClaimRe = /\b(diagnosed|diagnosis of|this confirms|definitely has|certainly has|as treatment|take [a-z]+ (?:dose|tablet|medic)|start [a-z]+ (?:dose|tablet)|should take|should stop taking|penicillin|antibiotic)\b/i;

function describeSymptoms(input: SymptomConditionInput): string {
  return JSON.stringify({
    task: "Suggest up to 3 generally common conditions classically associated with this symptom pattern, for education only.",
    courses: {
      conditionCount: 3,
      rationaleConstraint: "why this condition is classically associated with such symptoms; no diagnosis, no treatment, no numbers",
    },
    primarySymptom: input.primarySymptom,
    symptomCategory: input.symptomCategory,
    ...(input.severity ? { severity: input.severity } : {}),
    ...(input.progression ? { progression: input.progression } : {}),
    selectedCuratedSymptoms: input.selectedSymptoms ?? [],
    matchedUrgencyFlags: input.redFlags ?? [],
    urgencyLevel: input.urgencyLevel,
  });
}

export type SymptomConditionProvider = { analyze(input: SymptomConditionInput): Promise<SymptomConditionAnalysis> };
export function createSymptomConditionProvider(
  config: ProviderConfig,
  options: ProviderRequestOptions = {},
): SymptomConditionProvider {
  return {
    async analyze(input) {
      const responsePayload = await executeProviderStructuredRequest(config, {
        system: symptomConditionPrompt,
        user: describeSymptoms(input),
        schemaName: "medscope_symptom_condition_exploration",
        jsonSchema: symptomConditionJsonSchema,
        maxOutputTokens: 3_000,
      }, options);
      const decoded = decodeStructuredProviderText(config, responsePayload);
      const parsed = symptomConditionSchema.safeParse(decoded);
      if (!parsed.success) throw new AIProviderError("provider_malformed_response");
      const claimsDiagnosis = parsed.data.topConditions.some((row) => symptomClaimRe.test(row.rationale) || symptomClaimRe.test(row.condition))
        || /%|\bpercent\b/i.test(parsed.data.note)
        || parsed.data.topConditions.some((row) => /%|\bpercent\b/i.test(row.rationale));
      if (claimsDiagnosis) throw new AIProviderError("provider_malformed_response");
      const maxRows = parsed.data.topConditions.slice(0, 3).map((row) => ({
        condition: row.condition.replace(/\s+/g, " "),
        rationale: row.rationale.replace(/\s+/g, " "),
      }));
      if (maxRows.length === 0) throw new AIProviderError("provider_malformed_response");
      return {
        provider: config.provider,
        model: config.model,
        topConditions: maxRows,
        note: parsed.data.note.replace(/\s+/g, " "),
      };
    },
  };
}

export function configuredSymptomConditionProvider(
  env: NodeJS.ProcessEnv = process.env,
  options: ProviderRequestOptions = {},
): { status: ConfigState["status"]; provider?: SymptomConditionProvider } {
  const state = getProviderConfigState(env);
  if (state.status !== "configured") return { status: state.status };
  return { status: state.status, provider: createSymptomConditionProvider(state.config, options) };
}

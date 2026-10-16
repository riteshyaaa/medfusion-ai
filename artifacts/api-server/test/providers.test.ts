import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AIProviderError,
  configuredExplanationProvider,
  configuredSymptomConditionProvider,
  externalHealthDataTransferEnabled,
  getAIProviderStatus,
  getProviderConfigState,
  type AIProviderId,
  type SkinExplanationInput,
} from "../src/ai-providers";

const fakeInput: SkinExplanationInput = {
  modelId: "synthetic-model",
  modelVersion: "synthetic-version",
  scoreSemantics: "raw_model_score",
  candidates: [{ label: "synthetic label", score: 0.42 }],
};
const explanationText = "The listed labels are model candidates for education only; a professional must assess them.";
const validExplanation = JSON.stringify({ explanation: explanationText });

function envFor(provider: AIProviderId, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    AI_PROVIDER: provider,
    AI_MAX_RETRIES: "0",
    AI_REQUEST_TIMEOUT_MS: "2000",
    AI_MAX_CONCURRENCY: "2",
    ...extra,
  };
  if (provider === "openai") env.OPENAI_API_KEY = "unit-test-openai-key";
  if (provider === "gemini") env.GEMINI_API_KEY = "unit-test-gemini-key";
  if (provider === "nvidia") env.NVIDIA_API_KEY = "unit-test-nvidia-key";
  return env;
}

function rawResponse(provider: AIProviderId, text: string, status = 200): Response {
  if (status !== 200) return new Response(JSON.stringify({ error: { message: "provider private detail" } }), { status });
  const body = provider === "openai"
    ? { output: [{ type: "message", content: [{ type: "output_text", text }] }] }
    : provider === "gemini"
      ? { status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text }] }] }
      : { choices: [{ message: { content: text } }] };
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("provider adapters use the configured official API shape and validate structured output", async () => {
  const expected: Record<AIProviderId, { endpoint: string; model: string; secretHeader: string }> = {
    openai: { endpoint: "/responses", model: "gpt-5.5", secretHeader: "authorization" },
    gemini: { endpoint: "/interactions", model: "gemini-3.8-flash", secretHeader: "x-goog-api-key" },
    nvidia: { endpoint: "/chat/completions", model: "nvidia/nemotron-3-super-120b-a12b", secretHeader: "authorization" },
  };
  for (const providerId of ["openai", "gemini", "nvidia"] as const) {
    const env = envFor(providerId);
    let requestUrl = "";
    let requestHeaders = new Headers();
    let requestBody: Record<string, unknown> = {};
    const configured = configuredExplanationProvider(env, {
      fetchImpl: async (url, init) => {
        requestUrl = String(url);
        requestHeaders = new Headers(init?.headers);
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return rawResponse(providerId, validExplanation);
      },
    });
    assert.equal(configured.status, "configured");
    assert.ok(configured.provider);
    const result = await configured.provider.explain(fakeInput);
    assert.deepEqual(result, { provider: providerId, model: expected[providerId].model, explanation: explanationText });
    assert.ok(requestUrl.endsWith(expected[providerId].endpoint));
    assert.ok(requestHeaders.get(expected[providerId].secretHeader));
    assert.equal(requestBody.model, expected[providerId].model);
    assert.doesNotMatch(JSON.stringify(requestBody), /patient-100|person@example|image-bytes/);
    if (providerId === "openai") {
      assert.equal(requestBody.store, false);
      assert.equal((requestBody.text as { format: { type: string } }).format.type, "json_schema");
    } else if (providerId === "gemini") {
      assert.equal(requestBody.store, false);
      assert.ok(Array.isArray(requestBody.response_format));
      assert.equal(typeof requestBody.system_instruction, "string");
    } else {
      assert.equal("response_format" in requestBody, false);
    }
  }
});

test("provider configuration is off by default and rejects unallowlisted models and unsafe endpoints", () => {
  assert.equal(getAIProviderStatus({} as NodeJS.ProcessEnv), "disabled");
  assert.equal(getProviderConfigState({ AI_PROVIDER: "openai" } as NodeJS.ProcessEnv).status, "unconfigured");
  assert.equal(getProviderConfigState(envFor("openai", { AI_MODEL: "unapproved-model" })).status, "misconfigured");
  assert.equal(getProviderConfigState(envFor("openai", { OPENAI_BASE_URL: "http://127.0.0.1:3000" })).status, "misconfigured");
  assert.equal(externalHealthDataTransferEnabled({ AI_DATA_SHARING_ENABLED: "true" } as NodeJS.ProcessEnv), false);
  assert.equal(externalHealthDataTransferEnabled({ AI_DATA_SHARING_ENABLED: "true", AI_HEALTH_DATA_TRANSFER_APPROVED: "true" } as NodeJS.ProcessEnv), true);
});

test("timeouts return a safe error and never include credential or provider text", async () => {
  const configured = configuredExplanationProvider(envFor("openai", { AI_REQUEST_TIMEOUT_MS: "25" }), {
    fetchImpl: async (_url, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }),
  });
  assert.ok(configured.provider);
  await assert.rejects(
    configured.provider.explain(fakeInput),
    (error: unknown) => error instanceof AIProviderError
      && error.code === "provider_timeout"
      && !error.message.includes("unit-test-openai-key")
      && !error.message.includes("provider private detail"),
  );
});

test("429 retries are bounded and exhausted rate limits have a safe status", async () => {
  let calls = 0;
  const configured = configuredExplanationProvider(envFor("gemini", { AI_MAX_RETRIES: "1" }), {
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? rawResponse("gemini", "", 429) : rawResponse("gemini", validExplanation);
    },
    sleep: async () => {},
  });
  assert.ok(configured.provider);
  assert.equal((await configured.provider.explain(fakeInput)).explanation, explanationText);
  assert.equal(calls, 2);

  const exhausted = configuredExplanationProvider(envFor("gemini"), {
    fetchImpl: async () => rawResponse("gemini", "", 429),
  });
  assert.ok(exhausted.provider);
  await assert.rejects(exhausted.provider.explain(fakeInput), (error: unknown) => error instanceof AIProviderError && error.code === "provider_rate_limited");
});

test("provider outages and invalid credentials do not expose upstream response bodies", async () => {
  let outageCalls = 0;
  const outage = configuredExplanationProvider(envFor("nvidia", { AI_MAX_RETRIES: "1" }), {
    fetchImpl: async () => {
      outageCalls += 1;
      return rawResponse("nvidia", "", 503);
    },
    sleep: async () => {},
  });
  assert.ok(outage.provider);
  await assert.rejects(outage.provider.explain(fakeInput), (error: unknown) => error instanceof AIProviderError && error.code === "provider_unavailable");
  assert.equal(outageCalls, 2);

  const invalidCredentials = configuredExplanationProvider(envFor("openai"), {
    fetchImpl: async () => rawResponse("openai", "", 401),
  });
  assert.ok(invalidCredentials.provider);
  await assert.rejects(invalidCredentials.provider.explain(fakeInput), (error: unknown) => error instanceof AIProviderError
    && error.code === "provider_invalid_credentials"
    && !error.message.includes("unit-test-openai-key")
    && !error.message.includes("provider private detail"));
});

test("malformed and score-inventing provider output is rejected", async () => {
  const malformed = configuredExplanationProvider(envFor("openai"), {
    fetchImpl: async () => rawResponse("openai", "not-json"),
  });
  assert.ok(malformed.provider);
  await assert.rejects(malformed.provider.explain(fakeInput), (error: unknown) => error instanceof AIProviderError && error.code === "provider_malformed_response");

  const inventedNumber = configuredExplanationProvider(envFor("openai"), {
    fetchImpl: async () => rawResponse("openai", JSON.stringify({ explanation: "A patient has a 90% chance of disease." })),
  });
  assert.ok(inventedNumber.provider);
  await assert.rejects(inventedNumber.provider.explain(fakeInput), (error: unknown) => error instanceof AIProviderError && error.code === "provider_malformed_response");

  const oversized = configuredExplanationProvider(envFor("openai"), {
    fetchImpl: async () => new Response("x".repeat(129 * 1024), { status: 200 }),
  });
  assert.ok(oversized.provider);
  await assert.rejects(oversized.provider.explain(fakeInput), (error: unknown) => error instanceof AIProviderError && error.code === "provider_malformed_response");
});

test("invalid classifier inputs are rejected before an HTTP request", async () => {
  let calls = 0;
  const configured = configuredExplanationProvider(envFor("openai"), {
    fetchImpl: async () => {
      calls += 1;
      return rawResponse("openai", validExplanation);
    },
  });
  assert.ok(configured.provider);
  await assert.rejects(
    configured.provider.explain({ ...fakeInput, candidates: [{ label: "unsupported", score: Number.NaN }] }),
    (error: unknown) => error instanceof AIProviderError && error.code === "provider_request_rejected",
  );
  assert.equal(calls, 0);
});

test("provider concurrency stays within the configured bound", async () => {
  let active = 0;
  let maximumActive = 0;
  const configured = configuredExplanationProvider(envFor("nvidia", { AI_MAX_CONCURRENCY: "1" }), {
    fetchImpl: async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return rawResponse("nvidia", validExplanation);
    },
  });
  assert.ok(configured.provider);
  await Promise.all([configured.provider.explain(fakeInput), configured.provider.explain(fakeInput)]);
  assert.equal(maximumActive, 1);
});

test("symptom condition provider returns at most three validated suggestions", async () => {
  const valid = JSON.stringify({
    topConditions: [
      { condition: "Viral upper respiratory infection", rationale: "Runny nose and sneezing are classic features of the common cold." },
      { condition: "Seasonal allergy", rationale: "Repetitive sneezing and nasal discharge commonly occur with allergic rhinitis." },
      { condition: "Acute sinusitis", rationale: "Congestion with facial pressure is a typical presenting pattern." },
    ],
    note: "Educational exploration only. Professional assessment is required for any real concern.",
  });
  const provider = configuredSymptomConditionProvider(envFor("nvidia"), {
    fetchImpl: async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      assert.equal(request.model, "nvidia/nemotron-3-super-120b-a12b");
      assert.ok(String(request.messages[0].content).includes("never invent a probability"));
      return rawResponse("nvidia", valid);
    },
  });
  assert.ok(provider.provider);
  const result = await provider.provider.analyze({ primarySymptom: "runny nose and sneezing", symptomCategory: "respiratory", selectedSymptoms: ["runny nose", "sneezing"] });
  assert.equal(result.topConditions.length, 3);
  assert.equal(result.provider, "nvidia");
  assert.match(result.note, /Educational exploration only/);
});

test("symptom condition provider rejects fabricated numbers and diagnosis claims", async () => {
  const withNumbers = JSON.stringify({
    topConditions: [{ condition: "Common cold", rationale: "Typically affects 90% of adults annually." }],
    note: "Educational only.",
  });
  const numbers = configuredSymptomConditionProvider(envFor("nvidia"), { fetchImpl: async () => rawResponse("nvidia", withNumbers) });
  assert.ok(numbers.provider);
  await assert.rejects(numbers.provider.analyze({ primarySymptom: "sneezing", symptomCategory: "respiratory" }),
    (error: unknown) => error instanceof AIProviderError && error.code === "provider_malformed_response");

  const withClaim = JSON.stringify({
    topConditions: [{ condition: "Common cold", rationale: "You have a viral infection." }],
    note: "Educational only.",
  });
  const claims = configuredSymptomConditionProvider(envFor("nvidia"), { fetchImpl: async () => rawResponse("nvidia", withClaim) });
  assert.ok(claims.provider);
  await assert.rejects(claims.provider.analyze({ primarySymptom: "sneezing", symptomCategory: "respiratory" }),
    (error: unknown) => error instanceof AIProviderError && error.code === "provider_malformed_response");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";

process.env.NODE_ENV = "test";

const { skinAIResultSchema, symptomAIResultSchema } = await import("../src/clinical-ai");
const { conformToSchema } = await import("../src/ai-providers");
const { AIProviderError } = await import("../src/ai-providers");

const baseOk = {
  imageType: "real_skin",
  visibleAbnormality: true,
  description: "fits",
  observations: ["one"],
  possibleConditions: [],
  uncertainty: "uncertain",
  severity: "uncertain",
  urgency: "routine",
  nextSteps: [],
  consultClinicianWhen: [],
};

async function conformed(payload: Record<string, unknown>) {
  let attempts = 0;
  const provider = (await import("../src/clinical-ai")).createClinicalAIProvider({
    provider: "nvidia",
    model: "stub",
    apiKey: "stub",
    baseUrl: "https://stub.invalid/v1",
    timeoutMs: 25,
    maxRetries: 0,
    maxConcurrency: 1,
    visionModel: "stub-vl",
  }, {
    fetchImpl: (async () => {
      attempts += 1;
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: "stop" }],
      }), { status: 200 });
    }) as typeof fetch,
  });
  const out = await provider.analyzeSkin("data:image/jpeg;base64,aGVsbG8=");
  return { attempts, out };
}

test("conformance: extra observations above the schema cap are dropped, not fatal", async () => {
  const { out, attempts } = await conformed({ ...baseOk, observations: ["a", "b", "c", "d", "e", "f"] });
  console.log("DEBUG attempts=", attempts, "imageType=", (out.result as unknown as Record<string, unknown>).imageType, "providermodel=", out.provider, out.model);
  assert.deepEqual(out.result.observations, ["a", "b", "c", "d"]);
  assert.equal(attempts, 1, "the first response is reused; no retry round-trip is wasted");
});

test("conformance: extra consultClinicianWhen entries above the cap are dropped", async () => {
  const { out } = await conformed({ ...baseOk, consultClinicianWhen: ["1", "2", "3", "4", "5"] });
  assert.equal(out.result.consultClinicianWhen.length, 4);
});

test("conformance: overlong strings are clamped to schema caps", async () => {
  const { out } = await conformed({ ...baseOk, uncertainty: "x".repeat(500) });
  assert.equal(out.result.uncertainty.length, 240);
});

test("conformance: overlong array-item strings are clamped", async () => {
  const { out } = await conformed({ ...baseOk, observations: ["y".repeat(260)] });
  assert.equal(out.result.observations[0]?.length, 200);
});

test("conformance: unknown object keys invented by the model are pruned", async () => {
  const { out } = await conformed({ ...baseOk, inventedField: "noise", severity: "moderate" });
  assert.equal(out.result.severity, "moderate");
});

test("conformance: nested object item keys are pruned and caps enforced", async () => {
  const { out } = await conformed({
    ...baseOk,
    possibleConditions: [
      { name: "n", reason: "r", extra: "x" },
      { name: "n2", reason: "r2" },
      { name: "n3", reason: "r3" },
      { name: "n4", reason: "r4" },
    ],
  });
  assert.equal(out.result.possibleConditions.length, 3);
  assert.deepEqual(Object.keys(out.result.possibleConditions[0] as object), ["name", "reason"]);
});

test("genuinely unusable payloads still fail closed", async () => {
  await assert.rejects(conformed({ ...baseOk, imageType: "Banana" }), (error) => error instanceof AIProviderError);
});

test("genuinely unusable payloads fail closed even after two attempts", async () => {
  let attempts = 0;
  const provider = (await import("../src/clinical-ai")).createClinicalAIProvider({
    provider: "nvidia",
    model: "stub",
    apiKey: "stub",
    baseUrl: "https://stub.invalid/v1",
    timeoutMs: 25,
    maxRetries: 0,
    maxConcurrency: 1,
    visionModel: "stub-vl",
  }, {
    fetchImpl: (async () => {
      attempts += 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), { status: 200 });
    }) as typeof fetch,
  });
  await assert.rejects(provider.analyzeSkin("data:image/jpeg;base64,aGVsbG8="), (error) => error instanceof AIProviderError);
  assert.equal(attempts, 2, "the unreadable-response retry still applies");
});

test("conformance works for the symptom schema end to end at the raw level", async () => {
  const conformed = conformToSchema(symptomAIResultSchema, {
    summary: "s".repeat(900),
    possibleExplanations: Array.from({ length: 8 }, () => ({ explanation: "e", whyItMayFit: "w" })),
    uncertainty: "u",
    suggestedNextSteps: ["n"],
    warningSigns: ["w"],
    invented: true,
  }) as Record<string, unknown>;
  assert.equal((conformed.summary as string).length, 800);
  assert.equal((conformed.possibleExplanations as unknown[]).length, 5);
  assert.equal("invented" in conformed, false);
  const parsed = symptomAIResultSchema.safeParse(conformed);
  assert.equal(parsed.success, true);
});

test("conformance leaves conforming payloads untouched (skin schema)", async () => {
  const conformed = conformToSchema(skinAIResultSchema, baseOk) as Record<string, unknown>;
  const parsed = skinAIResultSchema.safeParse(conformed);
  assert.equal(parsed.success, true);
  assert.deepEqual(Object.keys(conformed), Object.keys(baseOk));
});

test("conformance: numeric fields sent as strings are coerced (document-page pattern)", async () => {
  const pageSchema = z.object({ pageNumber: z.number().int().min(1).max(500).nullable() }).strict();
  const conformedPage = conformToSchema(pageSchema, { pageNumber: "3" }) as Record<string, unknown>;
  assert.equal(conformedPage.pageNumber, 3);
  const parsedPage = pageSchema.safeParse(conformedPage);
  assert.equal(parsedPage.success, true);
  const rejectedSchema = z.object({ count: z.number() }).strict();
  const untouched = conformToSchema(rejectedSchema, { count: "abc" }) as Record<string, unknown>;
  assert.equal(untouched.count, "abc", "non-numeric strings stay untouched so validation still fails closed");
});

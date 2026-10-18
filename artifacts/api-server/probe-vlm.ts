import path from "node:path";
process.loadEnvFile(path.resolve("../../.env"));
import fs from "node:fs";
import { configuredVisionConfig } from "./src/ai-providers";
import { createClinicalAIProvider } from "./src/clinical-ai";

const requested = process.argv[2] ?? "meta/llama-3.2-11b-vision-instruct";
process.env.AI_SKIN_VISION_MODEL = requested;
const cfg = configuredVisionConfig(process.env);
if (cfg.status !== "configured" || !cfg.config) {
  console.log("vision config not usable:", cfg.status);
  process.exit(1);
}
const imageDataUrl = `data:image/png;base64,${fs.readFileSync(process.argv[3] ?? "verify-live.png").toString("base64")}`;
const provider = createClinicalAIProvider(cfg.config, {
  fetchImpl: async (url, init) => {
    const res = await fetch(url, init);
    const clone = res.clone();
    const payload = await clone.json().catch(() => null);
    const msg = payload?.choices?.[0]?.message ?? {};
    const usage = payload?.usage ?? {};
    console.log("raw http:", res.status, "| reasoning:", usage.completion_tokens_details?.reasoning_tokens, "| content:", String(msg.content ?? "").slice(0, 200));
    return res;
  },
});
const t0 = Date.now();
try {
  const r = await provider.analyzeSkin(imageDataUrl);
  console.log(`${requested}: OK in ${(Date.now() - t0) / 1000}s`);
  const first = r.result.possibleConditions?.[0];
  console.log("  imageType:", r.result.imageType, "| conditions:", (r.result.possibleConditions ?? []).map((c) => c.name).slice(0, 4));
  console.log("  obs[0]:", (r.result.observations ?? ["-"])[0]?.slice(0, 90));
} catch (error) {
  console.log(`${requested}: FAIL in ${(Date.now() - t0) / 1000}s: ${(error as Error).message}`);
}

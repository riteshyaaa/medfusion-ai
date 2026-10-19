import * as fs from "node:fs";
import sharp from "sharp";

for (const line of fs.readFileSync("../../.env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const svg = Buffer.from(
  `<svg width="512" height="512"><rect width="512" height="512" fill="#c99b7d"/><circle cx="256" cy="256" r="150" fill="#8b4a3c"/><circle cx="235" cy="245" r="36" fill="#3a1f18"/></svg>`,
);
const jpeg = await sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 150, g: 90, b: 70 } } })
  .composite([{ input: svg }]).jpeg({ quality: 85 }).toBuffer();
const dataUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
const base = (process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com").replace(/\/$/, "") + "/v1/chat/completions";

const candidates = [
  "openai/gpt-oss-20b",
  "meta/llama-3.2-11b-vision-instruct",
  "nvidia/nemotron-3.5-lightning-30b-a3b",
  "meta/llama-4-scout-17b-16e-instruct",
  "microsoft/phi-4-multimodal-instruct",
  "qwen/qwen2.5-vl-7b-instruct",
];

for (const model of candidates) {
  const body = {
    model,
    max_tokens: 700,
    temperature: 0.1,
    messages: [
      { role: "system", content: "You are a dermatology assistant. Return ONLY a JSON object (no markdown fences) with keys imageType (real_skin|not_skin|unclear), visibleAbnormality (boolean), description (a 120-word skin assessment), observations (array of 4 short strings)." },
      { role: "user", content: [
        { type: "text", text: "Analyze the attached skin image and return the structured JSON assessment. Output the JSON directly." },
        { type: "image_url", image_url: { url: dataUrl } },
      ] },
    ],
  };
  const t0 = Date.now();
  try {
    const res = await fetch(base, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    const ms = Date.now() - t0;
    const json = await res.json();
    const usage = json.usage ?? {};
    const text = json.choices?.[0]?.message?.content ?? "";
    const parsed = typeof text === "string" && /^\s*\{/.test(text);
    const toks = usage.completion_tokens || 0;
    console.log(`${model}: HTTP ${res.status} | ${ms} ms | out ${toks} tok (${Math.round((toks / ms) * 1000)} tok/s) | json-start=${parsed ? "yes" : "NO"} | ${JSON.stringify(text).slice(0, 120)}`);
  } catch (e) {
    console.log(`${model}: FAILED after ${Date.now() - t0} ms — ${e.cause?.message ?? e.message}`);
  }
}

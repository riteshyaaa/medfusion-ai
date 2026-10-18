import path from "node:path";
process.loadEnvFile(path.resolve("../../.env"));
import fs from "node:fs";

const apiKey = process.env.NVIDIA_API_KEY;
const body = {
  model: "nvidia/nemotron-3.5-super-vl-120b-a12b",
  messages: [
    { role: "system", content: "Return only a JSON object {\"ok\": true} and nothing else." },
    { role: "user", content: "Say ok." },
  ],
  max_completion_tokens: 2000,
  temperature: 0.2,
};
const variants: Array<Record<string, unknown>> = [
  { label: "baseline" },
  { label: "enable_thinking=false", chat_template_kwargs: { enable_thinking: false } },
  { label: "reasoning_effort=low", reasoning_effort: "low" },
];
for (const v of variants) {
  const t0 = Date.now();
  try {
    const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ ...body, ...("chat_template_kwargs" in v ? { chat_template_kwargs: v.chat_template_kwargs } : {}), ...("reasoning_effort" in v ? { reasoning_effort: v.reasoning_effort } : {}) }),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      console.log(`${v.label}: HTTP ${res.status} in ${(Date.now() - t0) / 1000}s:`, JSON.stringify(payload).slice(0, 160));
    } else {
      const msg = payload?.choices?.[0]?.message ?? {};
      const usage = payload?.usage ?? {};
      console.log(`${v.label}: OK in ${(Date.now() - t0) / 1000}s | reasoning=${usage.completion_tokens_details?.reasoning_tokens} | content=${String(msg.content ?? "").slice(0, 60)}`);
    }
  } catch (error) {
    console.log(`${v.label}: ERR in ${(Date.now() - t0) / 1000}s: ${(error as Error).message}`);
  }
}

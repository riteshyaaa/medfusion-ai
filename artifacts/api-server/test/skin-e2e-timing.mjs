import * as fs from "node:fs";
import sharp from "sharp";
import { getClinicalAIProvider } from "../src/clinical-ai.js";

for (const line of fs.readFileSync("../../.env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const svg = Buffer.from(
  `<svg width="512" height="512"><rect width="512" height="512" fill="#c99b7d"/><circle cx="256" cy="256" r="150" fill="#8b4a3c"/><circle cx="235" cy="245" r="40" fill="#3a1f18"/></svg>`,
);
const jpeg = await sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 150, g: 90, b: 70 } } })
  .composite([{ input: svg }]).jpeg({ quality: 85 }).toBuffer();
const dataUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;

const ai = getClinicalAIProvider(process.env, { useVisionModel: true });
const t0 = Date.now();
try {
  const out = await ai.provider.analyzeSkin(dataUrl);
  console.log(`OK in ${((Date.now() - t0) / 1000).toFixed(1)} s | conditions=${out.result.possibleConditions.length} observations=${out.result.observations.length} severity=${out.result.severity}`);
} catch (error) {
  console.log(`FAILED after ${((Date.now() - t0) / 1000).toFixed(1)} s — ${error?.code ?? ""} ${error?.message?.slice(0, 150)}`);
}

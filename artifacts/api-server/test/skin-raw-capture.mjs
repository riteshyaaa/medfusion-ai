// Capture the RAW provider response for images so we can see exactly why
// occasional skin analyses come back unreadable (truncation vs markdown
// fences vs shape drift). Uses the app's own provider stack verbatim.
import * as fs from "node:fs";
import { getClinicalAIProvider, skinAIResultSchema } from "../src/clinical-ai.js";

for (const line of fs.readFileSync("../../.env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const targets = process.argv.slice(2);
const files = targets.length ? targets : ["6f9df510-21f2-49f8-a2de-2ddd82d07a1f.jpg"];

globalThis.fetch = new Proxy(globalThis.fetch, {
  async apply(applyTarget, thisArg, argsList) {
    const response = await Reflect.apply(applyTarget, thisArg, argsList);
    if (!String(argsList[0]).includes("chat/completions")) return response;
    const cloned = response.clone();
    if (!response.ok) {
      console.log(`  [capture] HTTP ${cloned.status} ${(await cloned.text()).slice(0, 200)}`);
      return response;
    }
    const payload = await cloned.json();
    const choice = payload.choices?.[0] ?? {};
    const message = choice.message ?? {};
    const content = typeof message.content === "string" ? message.content : "";
    console.log(`  [capture] finish=${choice.finish_reason} usage=${JSON.stringify(payload.usage)} len=${content.length}`);
    console.log(`  [capture] head=${JSON.stringify(content.slice(0, 120))}`.slice(0, 140));
    console.log(`  [capture] tail=${JSON.stringify(content.slice(-120))}`.slice(0, 140));
    try {
      const decoded = JSON.parse(content);
      console.log("  [capture] parse: OK");
      const checked = skinAIResultSchema.safeParse(decoded);
      if (!checked.success) {
        for (const issue of checked.error.issues.slice(0, 6)) console.log("  [capture] zod:", issue.path.join("."), "-", issue.message);
      } else {
        console.log("  [capture] zod: OK");
      }
    } catch (error) {
      console.log(`  [capture] parse: FAILED (${String(error).slice(0, 120)})`);
      const first = content.indexOf("{");
      const last = content.lastIndexOf("}");
      if (first >= 0 && last > first) {
        try {
          JSON.parse(content.slice(first, last + 1));
          console.log("  [capture] brace-slice parse: OK — content has surrounding noise around the JSON object");
        } catch (error2) {
          console.log(`  [capture] brace-slice parse: FAILED (${String(error2).slice(0, 120)}) — content is truncated or drifting`);
        }
      }
    }
    return response;
  },
});

const vision = getClinicalAIProvider(process.env, { useVisionModel: true });
for (const file of files) {
  console.log(`\n=== ${file}`);
  try {
    const out = await vision.provider.analyzeSkin(
      "data:image/jpeg;base64," + fs.readFileSync(`../../uploads/${file}`).toString("base64"),
    );
    console.log(`  final: OK (${out.result.possibleConditions.length} conditions@${out.result.severity})`);
  } catch (error) {
    console.log(`  final: ${error?.code ?? error}`);
  }
}

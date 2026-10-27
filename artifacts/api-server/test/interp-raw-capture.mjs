// Capture the RAW provider response for document interpretation so we can
// see exactly what the model returns and which zod check rejects it.
import * as fs from "node:fs";
import { z } from "zod";
import { getDocumentInterpreter } from "../src/document-interpreter.js";

for (const line of fs.readFileSync("../../.env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

// Mirror of document-interpreter's zod schema (kept in sync for diagnosis).
const entry = z.object({
  label: z.string().trim().min(1).max(120),
  valueText: z.string().trim().max(120).nullable(),
  unit: z.string().trim().max(60).nullable(),
  referenceRange: z.string().trim().max(120).nullable(),
  pageNumber: z.number().int().min(1).max(500).nullable(),
  explanation: z.string().trim().min(1).max(800),
}).strict();
const schema = z.object({
  documentType: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(2000),
  findingsExplained: z.array(entry).max(100),
  terminology: z.array(z.object({ term: z.string().trim().min(1).max(120), plainLanguage: z.string().trim().min(1).max(400) }).strict()).max(100),
  inconsistencies: z.array(z.string().trim().min(1).max(400)).max(100),
  missingInformation: z.array(z.string().trim().min(1).max(400)).max(100),
  questionsForClinician: z.array(z.string().trim().min(1).max(400)).max(100),
  limitations: z.array(z.string().trim().min(1).max(400)).max(100),
}).strict();

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
    const content = payload.choices?.[0]?.message?.content ?? "";
    console.log(`  [capture] finish=${payload.choices?.[0]?.finish_reason} len=${content.length}`);
    try {
      const decoded = JSON.parse(content);
      const checked = schema.safeParse(decoded);
      if (!checked.success) for (const issue of checked.error.issues.slice(0, 8)) console.log("  [capture] zod:", issue.path.join("."), "-", issue.message);
      else console.log("  [capture] zod: OK");
    } catch (error) {
      console.log(`  [capture] parse FAILED ${String(error).slice(0, 120)}`);
    }
    return response;
  },
});

const interp = getDocumentInterpreter(process.env);
try {
  const out = await interp.interpreter.interpret({
    documentType: "laboratory report",
    pageCount: 1,
    extractionMethod: "image_ocr",
    findings: [
      { label: "Hemoglobin", valueText: "13.4", unit: "g/dL", referenceRange: "13.0-17.0", pageNumber: 1, sourceText: "Hemoglobin 13.4 g/dL" },
      { label: "Platelets", valueText: "250", unit: "10^3/uL", referenceRange: "150-400", pageNumber: 1, sourceText: "Platelets 250 x10^3/uL" },
    ],
    narrativeText: "Routine complete blood count.",
  });
  console.log(`final: OK (${out.sections.findingsExplained.length} findings Explained)`);
} catch (error) {
  console.log(`final: ${error?.name ?? error} ${error?.reason ?? ""}`);
}

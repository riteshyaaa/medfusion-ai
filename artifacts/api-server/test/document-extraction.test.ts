import assert from "node:assert/strict";
import { after, test } from "node:test";
import sharp from "sharp";
import {
  detectDocumentType,
  extractDocument,
  extractFindingsFromText,
  findingMatchKey,
  setTestOcrProvider,
} from "../src/document-extraction";
import {
  createDocumentInterpreter,
  InterpretationValidationError,
  validateInterpretationSections,
  type InterpretationFindingInput,
} from "../src/document-interpreter";

process.env.NODE_ENV = "test";

const options = { pageNumber: 1, confidence: null };

function findingByLabel(findings: ReturnType<typeof extractFindingsFromText>["findings"], label: string) {
  return findings.find((finding) => finding.label === label);
}

// Minimal single-page text PDF with a valid xref table, built dynamically so
// byte offsets stay correct. Parentheses in text are escaped for PDF syntax.
function buildTextPdf(lines: string[]): Buffer {
  const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const contentLines = lines.map((line, index) => `1 0 0 1 72 ${720 - index * 18} Tm (${escape(line)}) Tj`).join("\n");
  const content = `BT\n/F1 12 Tf\n${contentLines}\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const sampleLabText = [
  "Hemoglobin 13.5 g/dL (13.0 - 17.0)",
  "Hemoglobin 9.2 Low",
  "BP 120/80 mmHg",
  "HIV: Negative",
  "Diagnosis: Acute pharyngitis",
  "Amoxicillin 500 mg twice daily",
].join("\n");

test("extracted findings keep labels, values, units, ranges, and flags from the source text", () => {
  const { findings } = extractFindingsFromText(sampleLabText, options);

  const complete = findings.find((finding) => finding.label === "Hemoglobin" && finding.valueText === "13.5");
  assert.ok(complete, "expected the hemoglobin row to be extracted");
  assert.equal(complete.category, "lab_result");
  assert.equal(complete.numericValue, 13.5);
  assert.equal(complete.unit, "g/dL");
  assert.equal(complete.referenceRange, "13.0 - 17.0");
  assert.equal(complete.pageNumber, 1);

  assert.ok(findings.some((finding) => finding.label === "Hemoglobin" && finding.resultFlag === "low"));

  const bloodPressure = findings.find((finding) => finding.category === "vital_sign");
  assert.ok(bloodPressure);
  assert.equal(bloodPressure.valueText, "120/80 mmHg");
  assert.equal(bloodPressure.numericValue, null);

  const hiv = findingByLabel(findings, "HIV");
  assert.ok(hiv);
  assert.equal(hiv.valueText, "Negative");
  assert.equal(hiv.resultFlag, "normal");

  const diagnosis = findings.find((finding) => finding.category === "diagnosis");
  assert.ok(diagnosis);
  assert.equal(diagnosis.valueText, "Acute pharyngitis");

  const medication = findings.find((finding) => finding.category === "medication");
  assert.ok(medication);
  assert.equal(medication.label, "Amoxicillin");
  assert.equal(medication.valueText, "500 mg");
});

test("unreadable characters produce warnings instead of silent guesses", () => {
  const { findings, warnings } = extractFindingsFromText("Hemoglobin 13.5 g/dL (13.0 \uFFFD 17.0)", options);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.ambiguous, true);
  assert.ok(warnings.some((warning) => /unreadable/i.test(warning)));
});

test("document type detection stays a conservative heuristic", () => {
  const labFindings = extractFindingsFromText(sampleLabText, options).findings;
  assert.equal(detectDocumentType(sampleLabText, labFindings).documentType, "lab_report");

  const prescription = "Prescription\nTablet Metformin 500 mg once daily\nCapsule Omeprazole 20 mg twice daily";
  const { findings: prescriptionFindings } = extractFindingsFromText(prescription, options);
  const prescriptionType = detectDocumentType(prescription, prescriptionFindings);
  assert.equal(prescriptionType.documentType, "prescription");

  const radiology = "Chest X-ray report\nTechnique: PA view\nFindings: ultrasound correlation advised\nImpression: no acute abnormality";
  const radiologyType = detectDocumentType(radiology, []);
  assert.equal(radiologyType.documentType, "radiology_report");
  assert.ok(radiologyType.notes.some((note) => /no image analysis/i.test(note)));

  const short = detectDocumentType("hello", []);
  assert.equal(short.documentType, "unknown");
});

const interpreterFindings: InterpretationFindingInput[] = [
  {
    label: "Hemoglobin",
    valueText: "13.5",
    unit: "g/dL",
    referenceRange: "13.0 - 17.0",
    pageNumber: 1,
    sourceText: "Hemoglobin 13.5 g/dL (13.0 - 17.0)",
  },
];

function validSections(overrides: Record<string, unknown> = {}) {
  return {
    documentType: "lab_report",
    summary: "The report lists hemoglobin 13.5 g/dL. This explanation only restates extracted values.",
    findingsExplained: [
      {
        label: "Hemoglobin",
        valueText: "13.5",
        unit: "g/dL",
        referenceRange: "13.0 - 17.0",
        pageNumber: 1,
        explanation: "Hemoglobin measures the oxygen-carrying protein in red blood cells.",
      },
    ],
    terminology: [{ term: "Hemoglobin", plainLanguage: "A protein in red blood cells that carries oxygen." }],
    inconsistencies: [],
    missingInformation: [],
    questionsForClinician: ["Should this result be re-checked?"],
    limitations: ["This is an educational restatement, not a diagnosis."],
    ...overrides,
  };
}

test("interpretation validation accepts faithful restatements", () => {
  const sections = validateInterpretationSections(validSections(), interpreterFindings);
  assert.equal(sections.findingsExplained.length, 1);
});

test("interpretation validation rejects invented numbers, percentages, and diagnosis claims", () => {
  const invented = validSections({ summary: "Your cholesterol is 250 mg/dL." });
  assert.throws(
    () => validateInterpretationSections(invented, interpreterFindings),
    (error: unknown) => error instanceof InterpretationValidationError && /not present/.test(error.message),
  );

  const percent = validSections({ summary: "This result is 13.5%.", findingsExplained: [] });
  assert.throws(
    () => validateInterpretationSections(percent, interpreterFindings),
    (error: unknown) => error instanceof InterpretationValidationError && /percentage/.test(error.message),
  );

  const diagnosis = validSections({ summary: "You have anemia." });
  assert.throws(
    () => validateInterpretationSections(diagnosis, interpreterFindings),
    (error: unknown) => error instanceof InterpretationValidationError && /diagnosis or treatment/.test(error.message),
  );

  const mismatched = validSections({
    findingsExplained: [
      {
        label: "Hemoglobin",
        valueText: "999",
        unit: "g/dL",
        referenceRange: "13.0 - 17.0",
        pageNumber: 1,
        explanation: "No numbers here.",
      },
    ],
    summary: "Only restating.",
  });
  assert.throws(
    () => validateInterpretationSections(mismatched, interpreterFindings),
    (error: unknown) => error instanceof InterpretationValidationError && /do not match/.test(error.message),
  );

  const unknownLabel = validSections({
    findingsExplained: [
      {
        label: "Ferritin",
        valueText: null,
        unit: null,
        referenceRange: null,
        pageNumber: null,
        explanation: "No numbers here.",
      },
    ],
    summary: "Only restating.",
  });
  assert.throws(
    () => validateInterpretationSections(unknownLabel, interpreterFindings),
    (error: unknown) => error instanceof InterpretationValidationError && /not present/.test(error.message),
  );

  assert.throws(
    () => validateInterpretationSections({ documentType: "lab_report" }, interpreterFindings),
    (error: unknown) => error instanceof InterpretationValidationError && /required schema/.test(error.message),
  );
});

test("extractDocument runs OCR through the injected provider and stays honest about image handling", async () => {
  setTestOcrProvider({
    id: "test-ocr",
    recognize: async () => ({ text: "Hemoglobin 13.5 g/dL (13.0 - 17.0)", confidence: 0.98 }),
  });
  try {
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const outcome = await extractDocument({ bytes: png, mimeType: "image/png" }, { ...process.env });
    assert.equal(outcome.status, "extracted");
    assert.equal(outcome.method, "image_ocr");
    assert.equal(outcome.findings[0]?.label, "Hemoglobin");
    assert.equal(outcome.findings[0]?.confidence, 0.98);
    assert.ok(outcome.notes.some((note) => /not interpreted as X-rays/i.test(note)));
  } finally {
    setTestOcrProvider(undefined);
  }
});

test("extractDocument reports disabled OCR instead of pretending to read an image", async () => {
  const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#ffffff" } }).png().toBuffer();
  const outcome = await extractDocument({ bytes: png, mimeType: "image/png" }, { ...process.env, OCR_ENABLED: "false" });
  assert.equal(outcome.status, "ocr_unavailable");
  assert.equal(outcome.errorCode, "ocr_disabled");
  assert.equal(outcome.findings.length, 0);
});

test("extractDocument parses a text-layer PDF and notifies on corrupt PDFs", async () => {
  const pdf = buildTextPdf([
    "Hemoglobin 13.5 g/dL (13.0 - 17.0)",
    "BP 120/80 mmHg",
    "Diagnosis: Acute pharyngitis",
  ]);
  const outcome = await extractDocument({ bytes: pdf, mimeType: "application/pdf" }, { ...process.env });
  assert.equal(outcome.status, "extracted");
  assert.equal(outcome.method, "pdf_text");
  assert.equal(outcome.pageCount, 1);
  assert.ok(outcome.findings.some((finding) => finding.label === "Hemoglobin" && finding.numericValue === 13.5));
  assert.equal(outcome.findings[0]?.pageNumber, 1);

  const corrupt = await extractDocument({ bytes: Buffer.from("%PDF-1.4\nnot actually a pdf", "latin1"), mimeType: "application/pdf" }, { ...process.env });
  assert.equal(corrupt.status, "failed");
  assert.equal(corrupt.errorCode, "corrupt_pdf");

  const unsupported = await extractDocument({ bytes: Buffer.from("plain text"), mimeType: "text/plain" }, { ...process.env });
  assert.equal(unsupported.status, "unsupported");
  assert.equal(unsupported.errorCode, "unsupported_type");
});

test("numeric parsing handles locale decimals, thousands separators, scientific notation, and negatives", () => {
  const commaDecimal = extractFindingsFromText("Creatinine 0,8 mg/dL (0,7 - 1,3)", options);
  const finding = findingByLabel(commaDecimal.findings, "Creatinine");
  assert.ok(finding);
  assert.equal(finding.valueText, "0,8");
  assert.equal(finding.numericValue, 0.8);

  const thousands = extractFindingsFromText("Total leukocyte count 1,876 /uL", options);
  const wbc = findingByLabel(thousands.findings, "Total leukocyte count");
  assert.ok(wbc);
  assert.equal(wbc.numericValue, 1876);

  const dotThousands = extractFindingsFromText("Platelet count 1.87.625 /uL", options);
  const platelets = findingByLabel(dotThousands.findings, "Platelet count");
  assert.ok(platelets);
  assert.equal(platelets.numericValue, 187625);

  const scientific = extractFindingsFromText("Serum iron 8.6e-1 umol/L", options);
  const iron = findingByLabel(scientific.findings, "Serum iron");
  assert.ok(iron);
  assert.ok(Math.abs((iron.numericValue ?? 0) - 0.86) < 1e-9);

  const negative = extractFindingsFromText("C-reactive protein -0.4 mg/L", options);
  const crp = findingByLabel(negative.findings, "CRP");
  assert.ok(crp);
  assert.equal(crp.numericValue, -0.4);
});

test("inequality values are kept verbatim and compared against the reference range conservatively", () => {
  const high = extractFindingsFromText("Total cholesterol >250 mg/dL (<200)", options);
  const cholesterol = findingByLabel(high.findings, "Total cholesterol");
  assert.ok(cholesterol);
  assert.equal(cholesterol.valueText, ">250");
  assert.equal(cholesterol.resultFlag, "high");

  const low = extractFindingsFromText("Fasting glucose <60 mg/dL (70 - 100)", options);
  const glucose = findingByLabel(low.findings, "Fasting glucose");
  assert.ok(glucose);
  assert.equal(glucose.valueText, "<60");
  assert.equal(glucose.resultFlag, "low");

  const withoutRange = extractFindingsFromText("Total cholesterol >250 mg/dL", options);
  assert.equal(findingByLabel(withoutRange.findings, "Total cholesterol")?.resultFlag, "unknown");
});

test("qualitative results with multi-word negations map to conservative flags", () => {
  const notDetected = extractFindingsFromText("HIV: Not detected", options);
  const hiv = findingByLabel(notDetected.findings, "HIV");
  assert.ok(hiv);
  assert.equal(hiv.valueText, "Not detected");
  assert.equal(hiv.resultFlag, "normal");

  const detected = extractFindingsFromText("Urine protein: Present", options);
  const protein = findingByLabel(detected.findings, "Urine protein");
  assert.ok(protein);
  assert.equal(protein.valueText, "Present");
  assert.equal(protein.resultFlag, "abnormal");
});

test("in-range numeric values with a real range are not auto-marked normal", () => {
  const inRange = extractFindingsFromText("Hemoglobin 13.5 g/dL (13.0 - 17.0) without a flag word", options);
  const hemoglobin = findingByLabel(inRange.findings, "Hemoglobin");
  assert.ok(hemoglobin);
  assert.equal(hemoglobin.resultFlag, "unknown");

  const outOfRange = extractFindingsFromText("Hemoglobin 19.9 g/dL (13.0 - 17.0)", options);
  const elevated = findingByLabel(outOfRange.findings, "Hemoglobin");
  assert.ok(elevated);
  assert.equal(elevated.resultFlag, "high");
});

test("findingMatchKey produces stable comparison keys for reprocess and trend matching", () => {
  assert.equal(findingMatchKey("Hemoglobin"), findingMatchKey("hemoglobin"));
  assert.equal(findingMatchKey("LDL cholesterol (mg/dL)"), findingMatchKey("ldl cholesterol mg dl"));
  assert.notEqual(findingMatchKey("HDL cholesterol"), findingMatchKey("LDL cholesterol"));
});

after(() => {
  setTestOcrProvider(undefined);
});

function interpreterStub(payloads: unknown[]) {
  let calls = 0;
  const interpreter = createDocumentInterpreter({
    provider: "nvidia",
    model: "stub",
    apiKey: "stub",
    baseUrl: "https://stub.invalid/v1",
    timeoutMs: 25,
    maxRetries: 0,
    maxConcurrency: 1,
  }, {
    fetchImpl: (async () => {
      const payload = calls >= payloads.length ? payloads[payloads.length - 1] : payloads[calls];
      calls += 1;
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: "stop" }],
      }), { status: 200 });
    }) as typeof fetch,
  });
  return { interpreter, count: () => calls };
}

const interpretInput = {
  documentType: "lab_report",
  pageCount: 1,
  extractionMethod: "pdf_text" as const,
  findings: interpreterFindings,
};

test("document interpretation retries once on validation rejection, then succeeds", async () => {
  const { interpreter, count } = interpreterStub([
    validSections({ summary: "Your cholesterol is 250 mg/dL." }),
    validSections(),
  ]);
  const result = await interpreter.interpret(interpretInput);
  assert.equal(result.sections.findingsExplained.length, 1);
  assert.equal(count(), 2);
});

test("document interpretation still fails closed after two violating attempts", async () => {
  const { interpreter, count } = interpreterStub([
    validSections({ summary: "Your cholesterol is 250 mg/dL." }),
    validSections({ summary: "Your cholesterol is 300 mg/dL." }),
  ]);
  await assert.rejects(interpreter.interpret(interpretInput), InterpretationValidationError);
  assert.equal(count(), 2);
});

test("page-number references are not treated as invented numbers", async () => {
  const sections = validateInterpretationSections(
    validSections({ summary: "Hemoglobin 13.5 g/dL is shown on page 1 of the report." }),
    interpreterFindings,
  );
  assert.equal(sections.summary.includes("page 1"), true);
});

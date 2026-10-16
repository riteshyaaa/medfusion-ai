import path from "node:path";
import sharp from "sharp";

// ---------------------------------------------------------------------------
// OCR provider seam
//
// OCR is optional and configurable. The default provider uses tesseract.js
// (WASM). Tests can install an explicit test double only in NODE_ENV=test.
// When OCR is disabled or unavailable, scanned inputs fail with a clear status
// instead of inventing text.
// ---------------------------------------------------------------------------

export type OcrResult = { text: string; confidence: number | null };

export interface OcrProvider {
  readonly id: string;
  recognize(image: Buffer): Promise<OcrResult>;
}

let testOcrProvider: OcrProvider | undefined;

export function setTestOcrProvider(provider: OcrProvider | undefined): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("A test OCR provider can only be installed in test mode");
  }
  testOcrProvider = provider;
}

export type OcrStatus =
  | { status: "disabled"; reason: string }
  | { status: "configured"; providerId: string };

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  return Math.min(max, Math.max(min, Number(value)));
}

export function getOcrStatus(env: NodeJS.ProcessEnv = process.env): OcrStatus {
  if (testOcrProvider) return { status: "configured", providerId: testOcrProvider.id };
  if ((env.OCR_ENABLED ?? "true").trim().toLowerCase() === "false") {
    return { status: "disabled", reason: "OCR_ENABLED is false" };
  }
  return { status: "configured", providerId: "tesseract.js" };
}

let ocrQueue: Promise<unknown> = Promise.resolve();

function withOcrLock<T>(work: () => Promise<T>): Promise<T> {
  const run = ocrQueue.then(work, work);
  ocrQueue = run.catch(() => undefined);
  return run;
}

class OcrTimeoutError extends Error {
  constructor() {
    super("ocr_timeout");
    this.name = "OcrTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new OcrTimeoutError()), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

class TesseractOcrProvider implements OcrProvider {
  readonly id = "tesseract.js";
  constructor(
    private readonly language: string,
    private readonly cacheDir: string,
    private readonly timeoutMs: number,
  ) {}

  async recognize(image: Buffer): Promise<OcrResult> {
    const tesseract = await import("tesseract.js");
    const worker = await tesseract.createWorker(this.language, 1, { cachePath: this.cacheDir });
    try {
      const result = await withTimeout(worker.recognize(image), this.timeoutMs);
      const data = result.data as { text?: unknown; confidence?: unknown };
      const text = typeof data.text === "string" ? data.text : "";
      const confidence = typeof data.confidence === "number" ? Math.min(1, Math.max(0, data.confidence / 100)) : null;
      return { text, confidence };
    } finally {
      await worker.terminate().catch(() => undefined);
    }
  }
}

function activeOcrProvider(env: NodeJS.ProcessEnv): { provider: OcrProvider } | { reason: "ocr_disabled" | "ocr_unavailable" } {
  if (testOcrProvider) return { provider: testOcrProvider };
  if ((env.OCR_ENABLED ?? "true").trim().toLowerCase() === "false") return { reason: "ocr_disabled" };
  const cacheDir = path.resolve(env.OCR_CACHE_DIR ?? path.join(env.UPLOAD_DIR ?? "uploads", ".ocr-cache"));
  return { provider: new TesseractOcrProvider(env.OCR_LANG ?? "eng", cacheDir, boundedInteger(env.OCR_TIMEOUT_MS, 60_000, 1_000, 300_000)) };
}

// ---------------------------------------------------------------------------
// PDF handling
// ---------------------------------------------------------------------------

type PdfTextContent = { items: Array<{ str?: string; hasEOL?: boolean }> };
type PdfImageObject = { width: number; height: number; kind?: number; data?: Uint8Array | Uint8ClampedArray };
type PdfPageProxy = {
  getTextContent(): Promise<PdfTextContent>;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  objs: { get(name: string, callback?: (data: unknown) => void): unknown };
  cleanup(): void;
};
type PdfDocumentProxy = {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageProxy>;
  destroy(): Promise<void>;
};

type PdfLib = {
  getDocument(input: Record<string, unknown>): { promise: Promise<unknown> };
  OPS: Record<string, number>;
};

async function loadPdf(bytes: Buffer): Promise<{ document: PdfDocumentProxy; ops: Record<string, number> }> {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfLib;
  const document = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  }).promise as PdfDocumentProxy;
  return { document, ops: pdfjs.OPS };
}

export type PdfErrorCode = "corrupt_pdf" | "password_protected" | "pdf_too_large";

function classifyPdfError(error: unknown): PdfErrorCode {
  const name = (error as { name?: string })?.name ?? "";
  if (/Password/i.test(name) || /password/i.test((error as Error)?.message ?? "")) return "password_protected";
  return "corrupt_pdf";
}

function pageText(content: PdfTextContent): string {
  let text = "";
  for (const item of content.items) {
    if (typeof item.str !== "string") continue;
    text += item.str;
    text += item.hasEOL ? "\n" : " ";
  }
  return text.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
}

function isUsableImage(image: PdfImageObject): boolean {
  const data = image.data;
  return Number.isInteger(image.width) && Number.isInteger(image.height)
    && image.width > 0 && image.height > 0
    && (data instanceof Uint8Array || data instanceof Uint8ClampedArray)
    && data.length >= image.width * image.height
    && image.width >= 200 && image.height >= 200;
}

function resolvePdfObject(store: PdfPageProxy["objs"], name: string): Promise<unknown> {
  return new Promise((resolve) => {
    const immediate = store.get(name);
    if (immediate !== undefined && immediate !== null) {
      resolve(immediate);
      return;
    }
    store.get(name, (data: unknown) => resolve(data));
  });
}

function rawImageToJpeg(image: PdfImageObject): Promise<Buffer> {
  const width = image.width;
  const height = image.height;
  const channels = image.kind === 3 ? 4 : 3;
  if (image.kind !== 2 && image.kind !== 3) throw new Error("unsupported_pdf_image_kind");
  if (!image.data || image.data.length < width * height * channels) throw new Error("invalid_pdf_image_data");
  return sharp(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength), {
    raw: { width, height, channels },
    limitInputPixels: MAX_OCR_IMAGE_PIXELS,
  }).flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer();
}

const MAX_OCR_IMAGE_PIXELS = 30_000_000;
const MAX_OCR_PAGES = 10;
const MAX_EMBEDDED_IMAGES_PER_PAGE = 4;

async function extractPdfEmbeddedImages(document: PdfDocumentProxy, ops: Record<string, number>): Promise<Array<{ page: number; jpeg: Buffer }>> {
  const images: Array<{ page: number; jpeg: Buffer }> = [];
  const paintedImage = ops.paintImageXObject ?? -1;
  const paintedInline = ops.paintInlineImageXObject ?? -1;
  const pageLimit = Math.min(document.numPages, MAX_OCR_PAGES);
  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    try {
      const operatorList = await page.getOperatorList();
      let taken = 0;
      for (let index = 0; index < operatorList.fnArray.length && taken < MAX_EMBEDDED_IMAGES_PER_PAGE; index += 1) {
        const fn = operatorList.fnArray[index];
        let image: PdfImageObject | undefined;
        if (fn === paintedImage) {
          const name = operatorList.argsArray[index]?.[0];
          if (typeof name !== "string") continue;
          const object = await resolvePdfObject(page.objs, name);
          image = object as PdfImageObject | undefined;
        } else if (fn === paintedInline) {
          image = operatorList.argsArray[index]?.[0] as PdfImageObject | undefined;
        } else {
          continue;
        }
        if (!image || !isUsableImage(image)) continue;
        if (image.data && image.data.length > MAX_OCR_IMAGE_PIXELS * 4) continue;
        try {
          const jpeg = await rawImageToJpeg(image);
          images.push({ page: pageNumber, jpeg });
          taken += 1;
        } catch {
          // A single undecodable image must not fail the whole document.
        }
      }
    } finally {
      page.cleanup();
    }
  }
  return images;
}

// ---------------------------------------------------------------------------
// Finding extraction (conservative, candidate-only)
// ---------------------------------------------------------------------------

export type FindingCategory = "lab_result" | "vital_sign" | "medication" | "diagnosis" | "impression" | "other";
export type FindingFlag = "normal" | "high" | "low" | "abnormal" | "unknown";

export type ExtractionFinding = {
  pageNumber: number | null;
  category: FindingCategory;
  label: string;
  valueText: string | null;
  numericValue: number | null;
  unit: string | null;
  referenceRange: string | null;
  resultFlag: FindingFlag;
  confidence: number | null;
  sourceText: string;
  ambiguous: boolean;
};

const FLAG_WORDS: Array<{ flag: FindingFlag; pattern: RegExp }> = [
  { flag: "high", pattern: /^(?:h|high|elevated|increased|above normal)$/i },
  { flag: "low", pattern: /^(?:l|low|decreased|reduced|below normal)$/i },
  { flag: "abnormal", pattern: /^(?:a|abn|abnormal|borderline|positive|reactive)$/i },
  { flag: "normal", pattern: /^(?:n|norm|normal|negative|non[- ]?reactive)$/i },
];

const UNIT_PATTERN = /^(?:%|x?10\^?\d+(?:\.\d+)?\s*\/\s*[a-zµμ]+|cells?\/[µu]l|\/[µu]l|[a-zµμ%]{1,8}(?:\s*\/\s*[a-zµμ0-9^.]{1,8})?|mm\s*\/\s*hr|mmhg|bpm|fl|pg)$/i;

type Analyte = { label: string; pattern: RegExp; category: FindingCategory; valuePattern?: RegExp };

function words(...alternatives: string[]): RegExp {
  return new RegExp(`^(?:${alternatives.map((value) => value).join("|")})$`, "i");
}

const ANALYTES: Analyte[] = [
  { label: "Hemoglobin", pattern: words("hb", "haemoglobin", "hemoglobin", "haemoglobin \\(hb\\)", "hemoglobin \\(hb\\)"), category: "lab_result" },
  { label: "Total leukocyte count", pattern: words("wbc", "tlc", "total leukocyte count", "total leucocyte count", "white blood cell count", "white blood cells"), category: "lab_result" },
  { label: "RBC count", pattern: words("rbc", "red blood cell count", "red blood cells", "erythrocyte count"), category: "lab_result" },
  { label: "Platelet count", pattern: words("platelet count", "platelets", "plt", "platelet"), category: "lab_result" },
  { label: "Hematocrit", pattern: words("hct", "pcv", "hematocrit", "haematocrit", "packed cell volume"), category: "lab_result" },
  { label: "MCV", pattern: words("mcv", "mean corpuscular volume"), category: "lab_result" },
  { label: "MCH", pattern: words("mch", "mean corpuscular hemoglobin"), category: "lab_result" },
  { label: "MCHC", pattern: words("mchc", "mean corpuscular hemoglobin concentration"), category: "lab_result" },
  { label: "RDW", pattern: words("rdw", "red cell distribution width"), category: "lab_result" },
  { label: "Neutrophils", pattern: words("neutrophils", "neutrophil", "neutrophil %", "neutrophils %"), category: "lab_result" },
  { label: "Lymphocytes", pattern: words("lymphocytes", "lymphocyte", "lymphocyte %", "lymphocytes %"), category: "lab_result" },
  { label: "Eosinophils", pattern: words("eosinophils", "eosinophil"), category: "lab_result" },
  { label: "Monocytes", pattern: words("monocytes", "monocyte"), category: "lab_result" },
  { label: "Basophils", pattern: words("basophils", "basophil"), category: "lab_result" },
  { label: "ESR", pattern: words("esr", "erythrocyte sedimentation rate"), category: "lab_result" },
  { label: "CRP", pattern: words("crp", "c-reactive protein", "c reactive protein", "hs-crp"), category: "lab_result" },
  { label: "Fasting glucose", pattern: words("fasting glucose", "fasting blood sugar", "fbs", "fpg", "fasting plasma glucose"), category: "lab_result" },
  { label: "Random glucose", pattern: words("random glucose", "random blood sugar", "rbs", "postprandial glucose", "ppbs", "ppg"), category: "lab_result" },
  { label: "HbA1c", pattern: words("hba1c", "hb a1c", "glycated hemoglobin", "glycosylated hemoglobin"), category: "lab_result" },
  { label: "Creatinine", pattern: words("creatinine", "serum creatinine"), category: "lab_result" },
  { label: "Blood urea", pattern: words("urea", "blood urea", "bun", "blood urea nitrogen"), category: "lab_result" },
  { label: "eGFR", pattern: words("egfr", "estimated gfr", "gfr"), category: "lab_result" },
  { label: "Uric acid", pattern: words("uric acid", "serum uric acid"), category: "lab_result" },
  { label: "Sodium", pattern: words("sodium", "na\\+", "serum sodium"), category: "lab_result" },
  { label: "Potassium", pattern: words("potassium", "k\\+", "serum potassium"), category: "lab_result" },
  { label: "Chloride", pattern: words("chloride", "cl-"), category: "lab_result" },
  { label: "Calcium", pattern: words("calcium", "serum calcium"), category: "lab_result" },
  { label: "Total cholesterol", pattern: words("total cholesterol", "cholesterol total", "cholesterol - total", "cholesterol"), category: "lab_result" },
  { label: "LDL cholesterol", pattern: words("ldl", "ldl cholesterol", "ldl-c"), category: "lab_result" },
  { label: "HDL cholesterol", pattern: words("hdl", "hdl cholesterol", "hdl-c"), category: "lab_result" },
  { label: "Triglycerides", pattern: words("triglycerides", "triglyceride", "tg"), category: "lab_result" },
  { label: "ALT", pattern: words("alt", "sgpt", "alt \\(sgpt\\)"), category: "lab_result" },
  { label: "AST", pattern: words("ast", "sgot", "ast \\(sgot\\)"), category: "lab_result" },
  { label: "ALP", pattern: words("alp", "alkaline phosphatase"), category: "lab_result" },
  { label: "GGT", pattern: words("ggt", "gamma gt", "gamma-glutamyl transferase"), category: "lab_result" },
  { label: "Total bilirubin", pattern: words("total bilirubin", "bilirubin total", "bilirubin - total"), category: "lab_result" },
  { label: "Direct bilirubin", pattern: words("direct bilirubin", "bilirubin direct", "bilirubin - direct"), category: "lab_result" },
  { label: "Albumin", pattern: words("albumin", "serum albumin"), category: "lab_result" },
  { label: "Total protein", pattern: words("total protein", "protein total"), category: "lab_result" },
  { label: "TSH", pattern: words("tsh", "thyroid stimulating hormone"), category: "lab_result" },
  { label: "Free T3", pattern: words("free t3", "ft3"), category: "lab_result" },
  { label: "Free T4", pattern: words("free t4", "ft4"), category: "lab_result" },
  { label: "T3", pattern: words("t3", "triiodothyronine"), category: "lab_result" },
  { label: "T4", pattern: words("t4", "thyroxine"), category: "lab_result" },
  { label: "Vitamin D", pattern: words("vitamin d", "25-oh vitamin d", "vitamin d3"), category: "lab_result" },
  { label: "Vitamin B12", pattern: words("vitamin b12", "b12", "cobalamin"), category: "lab_result" },
  { label: "Ferritin", pattern: words("ferritin", "serum ferritin"), category: "lab_result" },
  { label: "Serum iron", pattern: words("iron", "serum iron"), category: "lab_result" },
  { label: "PSA", pattern: words("psa", "prostate specific antigen"), category: "lab_result" },
  { label: "Amylase", pattern: words("amylase"), category: "lab_result" },
  { label: "Lipase", pattern: words("lipase"), category: "lab_result" },
  { label: "LDH", pattern: words("ldh", "lactate dehydrogenase"), category: "lab_result" },
  { label: "Creatine kinase", pattern: words("cpk", "ck", "creatine kinase", "creatine phosphokinase"), category: "lab_result" },
  { label: "INR", pattern: words("inr"), category: "lab_result" },
  { label: "Prothrombin time", pattern: words("pt", "prothrombin time"), category: "lab_result" },
  { label: "HIV", pattern: words("hiv", "hiv 1/2", "hiv i/ii", "hiv antibody"), category: "lab_result" },
  { label: "HBsAg", pattern: words("hbsag", "hepatitis b surface antigen"), category: "lab_result" },
  { label: "Anti-HCV", pattern: words("anti-hcv", "hcv", "hepatitis c antibody"), category: "lab_result" },
  { label: "VDRL", pattern: words("vdrl", "rpr", "syphilis serology"), category: "lab_result" },
  { label: "Urine protein", pattern: words("urine protein", "protein - urine", "urine albumin", "albumin - urine"), category: "lab_result" },
  { label: "Urine glucose", pattern: words("urine glucose", "glucose - urine", "urine sugar"), category: "lab_result" },
  { label: "Blood pressure", pattern: words("bp", "blood pressure"), category: "vital_sign", valuePattern: /^\d{2,3}\s*\/\s*\d{2,3}/ },
  { label: "Pulse", pattern: words("pulse", "heart rate", "hr"), category: "vital_sign" },
  { label: "Temperature", pattern: words("temp", "temperature"), category: "vital_sign" },
  { label: "Oxygen saturation", pattern: words("spo2", "sp02", "o2 saturation", "oxygen saturation"), category: "vital_sign" },
  { label: "Respiratory rate", pattern: words("rr", "respiratory rate"), category: "vital_sign" },
];

const QUALITATIVE_VALUE = /^(?:positive|negative|non[- ]?reactive|reactive|trace|present|absent|normal|nil|not detected|detected)$/i;
const VALUE_PATTERN = /^(?:[<>]=?\s*)?\d+(?:[.,]\d+)?(?:\s*[*#])?/;
const BP_VALUE_PATTERN = /^\d{2,3}\s*\/\s*\d{2,3}\s*(?:mmhg)?/i;
const MEDICATION_PATTERN = /^([A-Za-z][A-Za-z0-9\-]{2,39})\s+(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|iu|units?)\b/i;
const DIAGNOSIS_LINE = /^(?:final\s+|provisional\s+|working\s+)?(diagnosis|impression|assessment|conclusion)\s*[:\-–]\s*(.{2,500})$/i;

function normalizeLine(line: string): { text: string; ambiguous: boolean } {
  const replaced = line.replace(/\uFFFD+/g, "\uFFFD");
  const ambiguous = replaced.includes("\uFFFD") || /[?]{2,}/.test(replaced);
  const text = replaced
    .replace(/^[\s\u2022*•]+/, "")
    .replace(/^\d{1,3}[.)]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  return { text, ambiguous };
}

function parseNumeric(value: string): number | null {
  const cleaned = value.replace(/^[<>]=?\s*/, "").replace(/[*#HhLl]$/, "").trim().replace(/,/g, ".");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function findReferenceRange(remainder: string): string | null {
  const labelled = remainder.match(/\bref(?:erence)?(?:\s*(?:range|interval|values?))?\s*[:=]?\s*([0-9][0-9.,\s\-–—<>]{1,30})/i)
    ?? remainder.match(/\b(?:normal|biological)\s*(?:range|values?|interval)?\s*[:=]?\s*([0-9][0-9.,\s\-–—<>]{1,30})/i);
  if (labelled?.[1]) return labelled[1].replace(/\s+/g, " ").trim();
  const parenthesized = remainder.match(/\(([^()]*\d[^()]*)\)/);
  if (parenthesized?.[1]) return parenthesized[1].replace(/\s+/g, " ").trim();
  const dashed = remainder.match(/(\d+(?:[.,]\d+)?\s*[-–—]\s*\d+(?:[.,]\d+)?)(?:\s*[a-z%µμ/^.]{0,10})?\s*$/i);
  if (dashed?.[1]) return dashed[1].replace(/\s+/g, " ").trim();
  return null;
}

function matchFlag(remainder: string): FindingFlag {
  const token = remainder.trim().replace(/^[*#]+/, "");
  for (const candidate of FLAG_WORDS) {
    if (candidate.pattern.test(token)) return candidate.flag;
  }
  return "unknown";
}

export type FindingExtractionOptions = { pageNumber: number | null; confidence: number | null };

export function extractFindingsFromText(text: string, options: FindingExtractionOptions): { findings: ExtractionFinding[]; warnings: string[] } {
  const findings: ExtractionFinding[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    if (findings.length >= 200) break;
    if (!/\d|[A-Za-z]/.test(rawLine)) continue;
    const { text: line, ambiguous } = normalizeLine(rawLine);
    if (line.length < 3 || line.length > 300) continue;

    const push = (finding: ExtractionFinding) => {
      const key = `${finding.category}|${finding.label}|${finding.sourceText}|${finding.pageNumber ?? ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      findings.push(finding);
    };

    const separatorIndex = line.search(/[:=]/);
    const head = separatorIndex >= 0 ? line.slice(0, separatorIndex).trim() : undefined;
    const remainderAfterSeparator = separatorIndex >= 0 ? line.slice(separatorIndex + 1).trim() : undefined;

    let matched = false;
    for (const analyte of ANALYTES) {
      const candidates: Array<{ head: string; rest: string }> = [];
      if (head !== undefined && remainderAfterSeparator !== undefined && analyte.pattern.test(head)) {
        candidates.push({ head, rest: remainderAfterSeparator });
      }
      if (candidates.length === 0) {
        const match = line.match(/^([A-Za-z][A-Za-z0-9 +()/%.\-]{0,60}?)\s+(.+)$/);
        if (match && analyte.pattern.test(match[1]!.trim())) {
          candidates.push({ head: match[1]!.trim(), rest: match[2]!.trim() });
        }
      }
      if (candidates.length === 0) continue;
      const { rest } = candidates[0]!;

      let valueText: string | null = null;
      let numericValue: number | null = null;
      let unit: string | null = null;
      let resultFlag: FindingFlag = "unknown";
      let leftover = rest;

      const bpMatch = analyte.category === "vital_sign" ? rest.match(BP_VALUE_PATTERN) : null;
      const valueMatch = bpMatch ?? matchValue(rest, analyte.valuePattern);
      if (valueMatch) {
        valueText = valueMatch[0].trim();
        numericValue = analyte.label === "Blood pressure" ? null : parseNumeric(valueText);
        leftover = rest.slice(valueMatch[0].length).trim();
        if (bpMatch) {
          const [systolic, diastolic] = valueText.split("/").map((part) => Number(part.replace(/[^\d.]/g, "")));
          if (Number.isFinite(systolic) && Number.isFinite(diastolic)) numericValue = null;
        }
        const unitMatch = leftover.match(/^([A-Za-zµμ%][A-Za-z0-9µμ%^./*-]{0,11})/);
        if (unitMatch && !FLAG_WORDS.some((candidate) => candidate.pattern.test(unitMatch[1]!))) {
          if (UNIT_PATTERN.test(unitMatch[1]!)) {
            unit = unitMatch[1]!;
            leftover = leftover.slice(unitMatch[0].length).trim();
          }
        }
        resultFlag = matchFlag(leftover.split(/\s+/)[0] ?? "");
      } else if (QUALITATIVE_VALUE.test(rest.split(/\s+/)[0] ?? "")) {
        const qualitative = rest.split(/\s+/)[0]!;
        valueText = qualitative;
        leftover = rest.slice(qualitative.length).trim();
        resultFlag = matchFlag(qualitative);
      }

      if (valueText === null) continue;
      const referenceRange = findReferenceRange(leftover);
      if (ambiguous) warnings.push(`Line on page ${options.pageNumber ?? "?"} contains unreadable characters; value requires confirmation.`);
      push({
        pageNumber: options.pageNumber,
        category: analyte.category,
        label: analyte.label,
        valueText,
        numericValue,
        unit,
        referenceRange,
        resultFlag,
        confidence: options.confidence,
        sourceText: rawLine.trim().slice(0, 300),
        ambiguous,
      });
      matched = true;
      break;
    }
    if (matched) continue;

    const diagnosis = line.match(DIAGNOSIS_LINE);
    if (diagnosis) {
      push({
        pageNumber: options.pageNumber,
        category: diagnosis[1]!.toLowerCase() === "impression" || diagnosis[1]!.toLowerCase() === "conclusion" ? "impression" : "diagnosis",
        label: diagnosis[1]!.replace(/\b\w/g, (letter) => letter.toUpperCase()),
        valueText: diagnosis[2]!.trim(),
        numericValue: null,
        unit: null,
        referenceRange: null,
        resultFlag: "unknown",
        confidence: options.confidence,
        sourceText: rawLine.trim().slice(0, 300),
        ambiguous,
      });
      continue;
    }

    const medication = line.match(MEDICATION_PATTERN);
    if (medication) {
      push({
        pageNumber: options.pageNumber,
        category: "medication",
        label: medication[1]!.trim(),
        valueText: `${medication[2]} ${medication[3]}`,
        numericValue: Number(medication[2]),
        unit: medication[3]!.toLowerCase(),
        referenceRange: null,
        resultFlag: "unknown",
        confidence: options.confidence,
        sourceText: rawLine.trim().slice(0, 300),
        ambiguous,
      });
    }
  }
  return { findings, warnings };
}

function matchValue(rest: string, valuePattern?: RegExp): RegExpMatchArray | null {
  if (valuePattern) return rest.match(valuePattern);
  return rest.match(VALUE_PATTERN);
}

// ---------------------------------------------------------------------------
// Document type detection
// ---------------------------------------------------------------------------

export type DocumentType = "lab_report" | "medical_summary" | "discharge_summary" | "prescription" | "radiology_report" | "other" | "unknown";

export function detectDocumentType(text: string, findings: ExtractionFinding[]): { documentType: DocumentType; notes: string[] } {
  const notes = ["Document type is a text-based heuristic estimate and should be confirmed by the user."];
  const lower = text.toLowerCase();
  const labFindings = findings.filter((finding) => finding.category === "lab_result").length;
  if (labFindings >= 2 || /(laborator|pathology|specimen|reference range|haemogram|hemogram|biochemistry)/.test(lower)) {
    return { documentType: "lab_report", notes };
  }
  if (/(discharge summary|date of discharge|discharging|hospital course|admitted (?:on|to)|admission date)/.test(lower)) {
    return { documentType: "discharge_summary", notes };
  }
  const radiologyMarkers = (lower.match(/x[- ]?ray|radiograph|ultrasound|sonograph|\bct\b|\bmri\b|radiology|radiologist/g) ?? []).length;
  if (radiologyMarkers >= 2 && /(technique|findings|impression)/.test(lower)) {
    notes.push("This appears to be a text radiology report. No image analysis is performed on uploaded documents.");
    return { documentType: "radiology_report", notes };
  }
  const prescriptionMarkers = (lower.match(/prescription|\brx\b|tablet|capsule|twice daily|once daily|\bbd\b|\btds\b|\bod\b|dosage/g) ?? []).length;
  if (prescriptionMarkers >= 3) return { documentType: "prescription", notes };
  if (/(medical summary|clinical summary|history of present illness|past medical history|review of systems|\bplan:)/.test(lower)) {
    return { documentType: "medical_summary", notes };
  }
  return { documentType: text.trim().length >= 40 ? "other" : "unknown", notes };
}

// ---------------------------------------------------------------------------
// Top-level extraction
// ---------------------------------------------------------------------------

export type ExtractionMethod = "pdf_text" | "pdf_embedded_image_ocr" | "image_ocr" | "none";
export type ExtractionStatus = "extracted" | "needs_review" | "ocr_unavailable" | "failed" | "unsupported";

export type ExtractionPage = { page: number; text: string; method: "text" | "ocr" };

export type ExtractionOutcome = {
  status: ExtractionStatus;
  method: ExtractionMethod;
  documentType: DocumentType;
  pageCount: number | null;
  pages: ExtractionPage[];
  findings: ExtractionFinding[];
  errorCode?: string;
  notes: string[];
};

const MAX_TEXT_CHARS_PER_PAGE = 20_000;
const MAX_TEXT_PAGES_STORED = 100;
const PDF_MAX_PAGES = 200;

function tooManyPagesOutcome(pageCount: number): ExtractionOutcome {
  return {
    status: "failed",
    method: "none",
    documentType: "unknown",
    pageCount,
    pages: [],
    findings: [],
    errorCode: "pdf_too_large",
    notes: [`The PDF has ${pageCount} pages; the supported limit is ${PDF_MAX_PAGES} pages.`],
  };
}

export async function extractDocument(input: { bytes: Buffer; mimeType: string }, env: NodeJS.ProcessEnv = process.env): Promise<ExtractionOutcome> {
  if (input.mimeType === "application/pdf") return extractPdfDocument(input.bytes, env);
  if (input.mimeType === "image/jpeg" || input.mimeType === "image/png") return extractImageDocument(input.bytes, env);
  return {
    status: "unsupported",
    method: "none",
    documentType: "unknown",
    pageCount: null,
    pages: [],
    findings: [],
    errorCode: "unsupported_type",
    notes: ["Only text-based PDF, scanned PDF, PNG, and JPEG documents are supported."],
  };
}

function finalize(pages: ExtractionPage[], method: ExtractionMethod, pageCount: number | null, notes: string[], statusOverride?: ExtractionStatus, errorCode?: string): ExtractionOutcome {
  const combinedText = pages.map((page) => page.text).join("\n");
  const { findings, warnings } = extractFindingsFromPages(pages);
  const { documentType, notes: typeNotes } = detectDocumentType(combinedText, findings);
  const hasAmbiguous = findings.some((finding) => finding.ambiguous);
  const status = statusOverride ?? (hasAmbiguous || warnings.some((warning) => /unreadable/i.test(warning)) ? "needs_review" : "extracted");
  const textPages: ExtractionPage[] = pages.slice(0, MAX_TEXT_PAGES_STORED).map((page) => ({ page: page.page, text: page.text.slice(0, MAX_TEXT_CHARS_PER_PAGE), method: page.method }));
  return {
    status,
    method,
    documentType,
    pageCount,
    pages: textPages,
    findings,
    ...(errorCode ? { errorCode } : {}),
    notes: [...notes, ...warnings, ...typeNotes],
  };
}

function extractFindingsFromPages(pages: ExtractionPage[]): { findings: ExtractionFinding[]; warnings: string[] } {
  const findings: ExtractionFinding[] = [];
  const warnings: string[] = [];
  for (const page of pages) {
    const result = extractFindingsFromText(page.text, { pageNumber: page.page, confidence: null });
    findings.push(...result.findings);
    warnings.push(...result.warnings);
  }
  return { findings, warnings };
}

async function extractPdfDocument(bytes: Buffer, env: NodeJS.ProcessEnv): Promise<ExtractionOutcome> {
  let document: PdfDocumentProxy | undefined;
  try {
    const loaded = await loadPdf(bytes);
    document = loaded.document;
    if (document.numPages > PDF_MAX_PAGES) return tooManyPagesOutcome(document.numPages);

    const textPages: ExtractionPage[] = [];
    let textCharacters = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const text = pageText(await page.getTextContent());
        textPages.push({ page: pageNumber, text, method: "text" });
        textCharacters += text.replace(/\s+/g, "").length;
      } finally {
        page.cleanup();
      }
    }
    const averageCharacters = textCharacters / Math.max(1, document.numPages);
    if (averageCharacters >= 20) {
      return finalize(textPages, "pdf_text", document.numPages, []);
    }

    const ocr = activeOcrProvider(env);
    if ("reason" in ocr) {
      return finalize(textPages.filter((page) => page.text.length > 0), "none", document.numPages, [
        "This PDF appears to be a scanned document without a text layer.",
        ocr.reason === "ocr_disabled" ? "OCR is disabled by configuration, so the scanned pages were not processed." : "No OCR provider is available.",
      ], "ocr_unavailable", ocr.reason);
    }

    const embedded = await extractPdfEmbeddedImages(document, loaded.ops);
    if (embedded.length === 0) {
      return finalize(textPages.filter((page) => page.text.length > 0), "none", document.numPages, [
        "This PDF has little or no text and no embedded page images that can be extracted for OCR.",
        "Upload individual page photographs (PNG/JPEG) for OCR, or a PDF with a text layer.",
      ], "ocr_unavailable", "no_extractable_images");
    }

    const ocrPages: ExtractionPage[] = [...textPages.filter((page) => page.text.length > 0)];
    const pageConfidence = new Map<number, number | null>();
    let ocrFailure: string | undefined;
    for (const image of embedded) {
      try {
        const result = await withOcrLock(() => ocr.provider.recognize(image.jpeg));
        pageConfidence.set(image.page, result.confidence);
        const existing = ocrPages.find((page) => page.page === image.page && page.method === "ocr");
        if (existing) existing.text += `\n${result.text}`;
        else ocrPages.push({ page: image.page, text: result.text, method: "ocr" });
      } catch (error) {
        ocrFailure = error instanceof OcrTimeoutError ? "ocr_timeout" : "ocr_failed";
      }
    }
    if (ocrPages.every((page) => page.method !== "ocr")) {
      return finalize(textPages.filter((page) => page.text.length > 0), "none", document.numPages, [
        "Page images were found, but OCR could not read them.",
      ], "failed", ocrFailure ?? "ocr_failed");
    }
    const outcome = finalize(ocrPages.sort((a, b) => a.page - b.page), "pdf_embedded_image_ocr", document.numPages, [
      "Text was produced by OCR from embedded page images and may contain recognition errors.",
      ...(ocrFailure ? [`Some pages failed OCR (${ocrFailure}); their content is missing.`] : []),
    ]);
    outcome.findings = outcome.findings.map((finding) => ({ ...finding, confidence: finding.pageNumber !== null ? pageConfidence.get(finding.pageNumber) ?? null : null }));
    if (outcome.status === "extracted" && embedded.length < document.numPages) {
      outcome.status = "needs_review";
    }
    return outcome;
  } catch (error) {
    return {
      status: "failed",
      method: "none",
      documentType: "unknown",
      pageCount: null,
      pages: [],
      findings: [],
      errorCode: classifyPdfError(error),
      notes: ["The PDF could not be parsed. It may be corrupt, password-protected, or not a PDF."],
    };
  } finally {
    await document?.destroy().catch(() => undefined);
  }
}

async function extractImageDocument(bytes: Buffer, env: NodeJS.ProcessEnv): Promise<ExtractionOutcome> {
  const ocr = activeOcrProvider(env);
  if ("reason" in ocr) {
    return finalize([], "none", null, [
      "The uploaded image requires OCR.",
      ocr.reason === "ocr_disabled" ? "OCR is disabled by configuration." : "No OCR provider is available.",
    ], "ocr_unavailable", ocr.reason);
  }
  try {
    const normalized = await sharp(bytes, { limitInputPixels: MAX_OCR_IMAGE_PIXELS, failOn: "error" }).rotate().jpeg({ quality: 92 }).toBuffer();
    const result = await withOcrLock(() => ocr.provider.recognize(normalized));
    const pages: ExtractionPage[] = [{ page: 1, text: result.text, method: "ocr" }];
    const outcome = finalize(pages, "image_ocr", 1, [
      "Text was produced by OCR from an image and may contain recognition errors.",
      "Uploaded images are treated as document photographs for text extraction. They are not interpreted as X-rays, scans, or other radiological images.",
    ]);
    outcome.findings = outcome.findings.map((finding) => ({ ...finding, confidence: result.confidence }));
    if (outcome.status === "extracted" && result.confidence !== null && result.confidence < 0.75) {
      outcome.status = "needs_review";
    }
    return outcome;
  } catch (error) {
    return {
      status: "failed",
      method: "none",
      documentType: "unknown",
      pageCount: null,
      pages: [],
      findings: [],
      errorCode: error instanceof OcrTimeoutError ? "ocr_timeout" : "ocr_failed",
      notes: ["OCR processing failed for this image."],
    };
  }
}

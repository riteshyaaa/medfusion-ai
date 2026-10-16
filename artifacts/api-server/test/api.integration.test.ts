import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

if (!process.env.DATABASE_URL) {
  throw new Error("Set DATABASE_URL to an isolated test database before running API integration tests.");
}

process.env.NODE_ENV = "test";
process.env.AI_PROVIDER = "none";
process.env.RATE_LIMIT_AUTH = "100";
process.env.RATE_LIMIT_UPLOAD = "100";
process.env.RATE_LIMIT_DOCUMENT = "100";
process.env.RATE_LIMIT_PREDICT = "100";
process.env.AI_RATE_LIMIT = "100";
const uploadDirectory = await mkdtemp(path.join(tmpdir(), "medscope-api-test-"));
process.env.UPLOAD_DIR = uploadDirectory;

const [
  { default: app },
  { db, pool },
  { users, reviews, predictions },
  { setTestInferenceProvider },
  { setTestOcrProvider },
  { setTestDocumentInterpreter },
] = await Promise.all([
  import("../src/app"),
  import("@workspace/db"),
  import("@workspace/db/schema"),
  import("../src/inference"),
  import("../src/document-extraction"),
  import("../src/document-interpreter"),
]);

const createdUserIds: number[] = [];

function cookieFrom(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie, "expected a session cookie");
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  return setCookie.split(";", 1)[0]!;
}

function jsonRequest(pathname: string, method: string, data?: unknown, cookie?: string, origin?: string) {
  const headers = new Headers();
  if (data !== undefined) headers.set("Content-Type", "application/json");
  if (cookie) headers.set("Cookie", cookie);
  if (origin) headers.set("Origin", origin);
  return app.request(`/api${pathname}`, {
    method,
    headers,
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
}

async function register(email: string, extra: Record<string, unknown> = {}) {
  const response = await jsonRequest("/auth/register", "POST", {
    email,
    password: "development-test-password",
    ...extra,
  });
  const body = await response.json() as { user: { id: number; role: string } };
  assert.equal(response.status, 201);
  createdUserIds.push(body.user.id);
  return { response, body, cookie: cookieFrom(response) };
}

async function upload(cookie: string, bytes: Buffer, contentType = "image/png", fileName = "fixture.png", caseId?: number) {
  const form = new FormData();
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  form.set("file", new Blob([arrayBuffer], { type: contentType }), fileName);
  if (caseId) form.set("caseId", String(caseId));
  return app.request("/api/uploads", { method: "POST", headers: { Cookie: cookie }, body: form });
}

async function uploadDocument(cookie: string, bytes: Buffer, contentType = "image/png", fileName = "document.png", caseId?: number) {
  const form = new FormData();
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  form.set("file", new Blob([arrayBuffer], { type: contentType }), fileName);
  if (caseId) form.set("caseId", String(caseId));
  return app.request("/api/documents", { method: "POST", headers: { Cookie: cookie }, body: form });
}

type DocumentView = {
  id: number;
  caseId: number | null;
  mimeType: string;
  pageCount: number | null;
  documentType: string;
  processingStatus: string;
  extractionMethod: string | null;
  extractionErrorCode: string | null;
  findingCount?: number;
  textPages?: Array<{ page: number; text: string; method: string }>;
  findings?: Array<{ id: number; label: string; valueText: string | null; unit: string | null; numericValue: number | null; resultFlag: string; status: string; correctedValueText: string | null }>;
  interpretations?: Array<{ id: number; provider: string; status: string; sections: { summary: string } }>;
};

async function waitForDocument(cookie: string, id: number, timeoutMs = 20_000): Promise<DocumentView> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await jsonRequest(`/documents/${id}`, "GET", undefined, cookie);
    assert.equal(response.status, 200);
    const document = (await response.json() as { document: DocumentView }).document;
    if (document.processingStatus !== "uploaded" && document.processingStatus !== "processing") return document;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`document ${id} did not finish processing in time`);
}

after(async () => {
  setTestInferenceProvider(undefined);
  setTestOcrProvider(undefined);
  setTestDocumentInterpreter(undefined);
  if (createdUserIds.length > 0) {
    await db.delete(users).where((await import("drizzle-orm")).inArray(users.id, createdUserIds));
  }
  await pool.end();
  await rm(uploadDirectory, { recursive: true, force: true });
});

test("API foundation persists data, enforces owner access, and fails closed without a model", async () => {
  const health = await app.request("/api/healthz");
  assert.equal(health.status, 200);
  assert.equal((await health.json() as { status: string }).status, "healthy");

  const readiness = await app.request("/api/readyz");
  assert.equal(readiness.status, 200);
  assert.deepEqual(await readiness.json(), {
    status: "ready",
    checks: {
      database: true,
      model: false,
      cardiacModel: false,
      aiProvider: "disabled",
      documentOcr: { status: "configured", providerId: "tesseract.js" },
    },
  });

  const unauthenticated = await jsonRequest("/patients", "GET");
  assert.equal(unauthenticated.status, 401);
  const authError = await unauthenticated.json() as { error: string; requestId: string; message: string };
  assert.equal(authError.error, "unauthorized");
  assert.ok(authError.requestId);
  assert.equal(unauthenticated.headers.get("x-request-id"), authError.requestId);

  const accountA = await register(`owner-a-${randomUUID()}@example.test`, { role: "admin" });
  assert.equal(accountA.body.user.role, "user", "registration must not accept a privileged role");
  const accountId = accountA.body.user.id;
  const originalCookie = accountA.cookie;

  const sessionInfo = await jsonRequest("/auth/me", "GET", undefined, originalCookie);
  assert.equal(sessionInfo.status, 200);
  const sessionBody = await sessionInfo.json() as { user: { id: number } };
  assert.equal(sessionBody.user.id, accountId);

  const failedLogin = await jsonRequest("/auth/login", "POST", {
    email: accountA.body.user.id ? `owner-a-${accountA.body.user.id}@example.test` : "invalid@example.test",
    password: "incorrect-password",
  });
  assert.equal(failedLogin.status, 401);

  const emailA = (await (await jsonRequest("/auth/me", "GET", undefined, originalCookie)).json() as { user: { email: string } }).user.email;
  const login = await jsonRequest("/auth/login", "POST", { email: emailA.toUpperCase(), password: "development-test-password" }, originalCookie);
  assert.equal(login.status, 200);
  const cookieA = cookieFrom(login);
  assert.notEqual(cookieA, originalCookie, "login rotates the existing session token");
  assert.equal((await jsonRequest("/auth/me", "GET", undefined, originalCookie)).status, 401, "rotated session is invalidated");

  const registerWithoutCookie = await jsonRequest("/patients", "POST", { firstName: "No", lastName: "Session" });
  assert.equal(registerWithoutCookie.status, 401);

  const patientResponse = await jsonRequest("/patients", "POST", {
    firstName: "Fictional",
    lastName: "Patient",
    dateOfBirth: "1990-01-02",
    notes: "Synthetic integration fixture",
  }, cookieA);
  assert.equal(patientResponse.status, 201);
  const patientId = (await patientResponse.json() as { patient: { id: number } }).patient.id;

  const caseResponse = await jsonRequest("/cases", "POST", {
    patientId,
    type: "skin_analysis",
    priority: "medium",
    chiefComplaint: "Synthetic test case only",
  }, cookieA);
  assert.equal(caseResponse.status, 201);
  const caseId = (await caseResponse.json() as { case: { id: number } }).case.id;

  const accountB = await register(`owner-b-${randomUUID()}@example.test`);
  const cookieB = accountB.cookie;
  const patientB = await jsonRequest(`/patients/${patientId}`, "GET", undefined, cookieB);
  assert.equal(patientB.status, 404);
  assert.equal((await jsonRequest(`/patients/${patientId}`, "PATCH", { firstName: "Changed" }, cookieB)).status, 404);
  assert.equal((await jsonRequest("/cases", "POST", { patientId, type: "follow_up" }, cookieB)).status, 404);
  assert.equal((await jsonRequest(`/cases/${caseId}`, "GET", undefined, cookieB)).status, 404);
  assert.equal((await jsonRequest(`/cases/${caseId}`, "PATCH", { status: "closed" }, cookieB)).status, 404);
  assert.equal((await jsonRequest("/uploads", "POST", undefined, cookieB, "https://attacker.example")).status, 403);

  const symptom = await jsonRequest("/symptom-assessments", "POST", {
    caseId,
    primarySymptom: "chest pain",
    symptomCategory: "cardiovascular",
    severity: "moderate",
  }, cookieA);
  assert.equal(symptom.status, 201);
  const symptomBody = await symptom.json() as { assessment: { id: number; urgencyLevel: string; guidance: { recommendations: string[] }; redFlagsTriggered: string[] } };
  assert.equal(symptomBody.assessment.urgencyLevel, "emergency");
  assert.ok(symptomBody.assessment.guidance.recommendations.length > 0);
  assert.ok(symptomBody.assessment.redFlagsTriggered.includes("chest pain"));
  const symptomId = symptomBody.assessment.id;
  assert.equal((await jsonRequest(`/symptom-assessments/${symptomId}`, "GET", undefined, cookieB)).status, 404);
  assert.equal((await (await jsonRequest("/symptom-assessments", "GET", undefined, cookieB)).json() as { total: number }).total, 0);
  assert.equal((await jsonRequest("/symptom-assessments", "POST", { caseId, primarySymptom: "test", symptomCategory: "general" }, cookieB)).status, 404);

  const png = await sharp({ create: { width: 3, height: 2, channels: 3, background: "#d9a78b" } }).png().toBuffer();
  const uploadResponse = await upload(cookieA, png, "image/png", "synthetic-fixture.png", caseId);
  assert.equal(uploadResponse.status, 201);
  const uploadBody = await uploadResponse.json() as { upload: { id: number; mimeType: string; width: number; height: number; storageKey?: string } };
  assert.equal(uploadBody.upload.mimeType, "image/jpeg", "uploads are normalized to JPEG and stripped of extra metadata");
  assert.equal(uploadBody.upload.width, 3);
  assert.equal(uploadBody.upload.height, 2);
  assert.equal("storageKey" in uploadBody.upload, false);
  const uploadId = uploadBody.upload.id;
  assert.equal((await upload(cookieB, png, "image/png", "foreign-case.png", caseId)).status, 404);
  assert.equal((await jsonRequest(`/uploads/${uploadId}`, "DELETE", undefined, cookieB)).status, 404);

  const forgedPng = await upload(cookieA, Buffer.from("not an image"), "image/png");
  assert.equal(forgedPng.status, 400);
  const disallowed = await upload(cookieA, Buffer.from("<svg/>"), "image/svg+xml", "unsafe.svg");
  assert.equal(disallowed.status, 415);
  const oversized = await upload(cookieA, Buffer.alloc(10 * 1024 * 1024 + 1), "image/png", "oversized.png");
  assert.equal(oversized.status, 413);

  const unavailable = await jsonRequest("/predict", "POST", { uploadId }, cookieA);
  assert.equal(unavailable.status, 503);
  const unavailableBody = await unavailable.json() as { error: string; message: string };
  assert.equal(unavailableBody.error, "model_unavailable");
  assert.match(unavailableBody.message, /no approved model/i);
  assert.equal((await (await jsonRequest("/predictions", "GET", undefined, cookieA)).json() as { total: number }).total, 0);
  assert.equal((await jsonRequest("/predict", "POST", { uploadId }, cookieB)).status, 404);

  setTestInferenceProvider({
    simulated: true,
    async predict() {
      return {
        disease: "synthetic test label",
        confidence: 0.73,
        description: "A visibly simulated test fixture, not a medical result.",
        severity: "unassessed",
        recommendations: ["No clinical action; integration test only."],
        differentialDiagnoses: [],
        preprocessingSteps: ["test fixture only"],
        modelId: "test-double",
        modelVersion: "test-only",
        preprocessingVersion: "test-only",
        scoreSemantics: "raw_model_score",
      };
    },
  });
  const simulatedPrediction = await jsonRequest("/predict", "POST", { uploadId }, cookieA);
  assert.equal(simulatedPrediction.status, 201);
  const prediction = await simulatedPrediction.json() as { id: number; status: string; scoreSemantics: string; userId?: number; imageBase64?: string };
  assert.equal(prediction.status, "simulated");
  assert.equal(prediction.scoreSemantics, "simulated");
  assert.equal("userId" in prediction, false);
  assert.equal("imageBase64" in prediction, false);
  const predictionId = prediction.id;
  const explanationUnauthenticated = await jsonRequest("/ai/explanations", "POST", {
    predictionId,
    consentToExternalProcessing: true,
  });
  assert.equal(explanationUnauthenticated.status, 401);
  const noConsent = await jsonRequest("/ai/explanations", "POST", {
    predictionId,
    consentToExternalProcessing: false,
  }, cookieA);
  assert.equal(noConsent.status, 400);
  assert.equal((await noConsent.json() as { error: string }).error, "external_data_consent_required");
  const simulatedExplanation = await jsonRequest("/ai/explanations", "POST", {
    predictionId,
    consentToExternalProcessing: true,
  }, cookieA);
  assert.equal(simulatedExplanation.status, 409);
  assert.equal((await simulatedExplanation.json() as { error: string }).error, "prediction_not_eligible");
  const foreignExplanation = await jsonRequest("/ai/explanations", "POST", {
    predictionId,
    consentToExternalProcessing: true,
  }, cookieB);
  assert.equal(foreignExplanation.status, 404);
  const historyA = await jsonRequest("/predictions", "GET", undefined, cookieA);
  const historyBody = await historyA.json() as { predictions: Array<{ id: number; status: string }>; total: number };
  assert.equal(historyBody.total, 1);
  assert.equal(historyBody.predictions[0]?.id, predictionId);
  assert.equal(historyBody.predictions[0]?.status, "simulated");
  assert.equal((await jsonRequest(`/predictions/${predictionId}`, "GET", undefined, cookieB)).status, 404);
  assert.equal((await (await jsonRequest("/predictions", "GET", undefined, cookieB)).json() as { total: number }).total, 0);

  const [unapprovedCompletedPrediction] = await db.insert(predictions).values({
    disease: "synthetic test label",
    confidence: 0.42,
    description: "Synthetic test record only.",
    severity: "unassessed",
    recommendations: [],
    differentialDiagnoses: [],
    preprocessingSteps: ["synthetic test fixture"],
    status: "completed",
    modelId: "test-only-unapproved",
    modelVersion: "test-only",
    scoreSemantics: "raw_model_score",
    preprocessingVersion: "test-only",
    uploadId,
    fileName: "synthetic-fixture.png",
    userId: accountId,
  }).returning();
  const blockedExternalExplanation = await jsonRequest("/ai/explanations", "POST", {
    predictionId: unapprovedCompletedPrediction!.id,
    consentToExternalProcessing: true,
  }, cookieA);
  assert.equal(blockedExternalExplanation.status, 503);
  assert.equal((await blockedExternalExplanation.json() as { error: string }).error, "model_unavailable");

  const [legacyPrediction] = await db.insert(predictions).values({
    disease: "unverified stored label",
    confidence: 0.99,
    description: "unverified stored description",
    severity: "severe",
    recommendations: ["unverified stored guidance"],
    differentialDiagnoses: [],
    preprocessingSteps: [],
    userId: accountId,
  }).returning();
  assert.equal(legacyPrediction!.status, "legacy_unverified");
  assert.equal(legacyPrediction!.scoreSemantics, "unverified");
  const legacyView = await jsonRequest(`/predictions/${legacyPrediction!.id}`, "GET", undefined, cookieA);
  const legacyBody = await legacyView.json() as { disease: string; confidence: number; description: string; severity: string; recommendations: string[]; scoreSemantics: string; status: string };
  assert.equal(legacyBody.disease, "Unverified legacy record");
  assert.equal(legacyBody.confidence, 0);
  assert.equal(legacyBody.severity, "unassessed");
  assert.equal(legacyBody.recommendations.length, 0);
  assert.equal(legacyBody.scoreSemantics, "unverified");
  assert.equal(legacyBody.status, "legacy_unverified");
  assert.doesNotMatch(legacyBody.description, /unverified stored description/);

  const reportCreate = await jsonRequest("/reports", "POST", {
    caseId,
    title: "Synthetic integration report",
    type: "comprehensive",
  }, cookieA);
  assert.equal(reportCreate.status, 201);
  const report = (await reportCreate.json() as { report: { id: number; status: string; content: { source: string } } }).report;
  assert.equal(report.status, "draft");
  assert.equal(report.content.source, "persisted_authorized_records");
  assert.equal((await jsonRequest("/reports", "POST", { caseId, title: "Not owned", type: "comprehensive" }, cookieB)).status, 404);
  assert.equal((await jsonRequest(`/reports/${report.id}`, "GET", undefined, cookieB)).status, 404);
  assert.equal((await jsonRequest(`/reports/${report.id}`, "PATCH", { status: "archived" }, cookieB)).status, 404);
  const archive = await jsonRequest(`/reports/${report.id}`, "PATCH", { status: "archived" }, cookieA);
  assert.equal(archive.status, 200);
  assert.equal((await archive.json() as { report: { status: string } }).report.status, "archived");

  const clinician = await register(`reviewer-${randomUUID()}@example.test`);
  await db.update(users).set({ role: "clinician" }).where((await import("drizzle-orm")).eq(users.id, clinician.body.user.id));
  const [review] = await db.insert(reviews).values({
    predictionId,
    reviewerId: clinician.body.user.id,
    status: "pending",
    originalOutput: { id: predictionId, status: "simulated" },
  }).returning();
  assert.equal((await jsonRequest(`/reviews/${review!.id}`, "GET", undefined, cookieB)).status, 404);
  assert.equal((await jsonRequest(`/reviews/${review!.id}`, "GET", undefined, cookieA)).status, 200);
  const reviewerCookie = clinician.cookie;
  const reviewUpdate = await jsonRequest(`/reviews/${review!.id}`, "PATCH", {
    status: "reviewed",
    originalOutput: { id: -1, status: "tampered" },
    rationale: "Synthetic test review",
  }, reviewerCookie);
  assert.equal(reviewUpdate.status, 200);
  const reviewBody = (await reviewUpdate.json() as { review: { status: string; originalOutput: { id: number; status: string } } }).review;
  assert.equal(reviewBody.status, "reviewed");
  assert.deepEqual(reviewBody.originalOutput, { id: predictionId, status: "simulated" }, "review update cannot mutate immutable original model output");

  const logout = await jsonRequest("/auth/logout", "POST", undefined, cookieA);
  assert.equal(logout.status, 200);
  assert.equal((await jsonRequest("/auth/me", "GET", undefined, cookieA)).status, 401);

  const unknownRoute = await app.request("/api/no-such-route");
  assert.equal(unknownRoute.status, 404);
  const notFoundBody = await unknownRoute.json() as { requestId: string };
  assert.equal(unknownRoute.headers.get("x-request-id"), notFoundBody.requestId);
});

test("document report analysis extracts, reviews findings, gates interpretation, and feeds the case workspace", async () => {
  const account = await register(`owner-doc-${randomUUID()}@example.test`);
  const cookie = account.cookie;
  const patientResponse = await jsonRequest("/patients", "POST", { firstName: "Document", lastName: "Fixture" }, cookie);
  assert.equal(patientResponse.status, 201);
  const patientId = (await patientResponse.json() as { patient: { id: number } }).patient.id;
  const caseResponse = await jsonRequest("/cases", "POST", { patientId, type: "skin_analysis" }, cookie);
  assert.equal(caseResponse.status, 201);
  const caseId = (await caseResponse.json() as { case: { id: number } }).case.id;
  const foreign = await register(`owner-doc-b-${randomUUID()}@example.test`);

  const unauthenticated = await app.request("/api/documents", { method: "POST" });
  assert.equal(unauthenticated.status, 401);
  const disallowed = await uploadDocument(cookie, Buffer.from("<svg/>"), "image/svg+xml", "unsafe.svg");
  assert.equal(disallowed.status, 415);
  const mismatch = await uploadDocument(cookie, Buffer.from("not a pdf at all"), "application/pdf", "fake.pdf");
  assert.equal(mismatch.status, 415);
  assert.equal((await uploadDocument(cookie, Buffer.from("x"), "image/png", "foreign.png", 999_999)).status, 404);

  setTestOcrProvider({
    id: "test-ocr",
    recognize: async () => ({
      text: [
        "Hemoglobin 13.5 g/dL (13.0 - 17.0)",
        "HIV: Negative",
        "Diagnosis: Acute pharyngitis",
      ].join("\n"),
      confidence: 0.98,
    }),
  });
  const png = await sharp({ create: { width: 24, height: 12, channels: 3, background: "#ffffff" } }).png().toBuffer();
  const created = await uploadDocument(cookie, png, "image/png", "lab-report.png", caseId);
  assert.equal(created.status, 201);
  const createdBody = await created.json() as { document: DocumentView };
  assert.equal(createdBody.document.mimeType, "image/jpeg", "uploaded document images are normalized to JPEG");
  assert.equal(createdBody.document.findingCount, 0);
  const documentId = createdBody.document.id;

  const document = await waitForDocument(cookie, documentId);
  assert.equal(document.processingStatus, "extracted");
  assert.equal(document.extractionMethod, "image_ocr");
  assert.equal(document.documentType, "lab_report");
  assert.equal(document.caseId, caseId);
  assert.ok((document.findingCount ?? 0) >= 3);
  const hemoglobin = document.findings!.find((finding) => finding.label === "Hemoglobin");
  assert.ok(hemoglobin);
  assert.equal(hemoglobin.numericValue, 13.5);
  assert.equal(hemoglobin.unit, "g/dL");
  assert.equal(document.textPages?.[0]?.method, "ocr");

  const list = await jsonRequest(`/documents?caseId=${caseId}&limit=10`, "GET", undefined, cookie);
  assert.equal(list.status, 200);
  const listBody = await list.json() as { documents: DocumentView[]; total: number };
  assert.equal(listBody.total, 1);
  assert.ok((listBody.documents[0]!.findingCount ?? 0) >= 3);
  assert.equal((await jsonRequest("/documents?status=nonsense", "GET", undefined, cookie)).status, 400);

  const file = await app.request(`/api/documents/${documentId}/file`, { headers: { Cookie: cookie } });
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("content-type"), "image/jpeg");
  assert.equal(file.headers.get("cache-control"), "private, no-store");
  assert.equal((await jsonRequest(`/documents/${documentId}`, "GET", undefined, foreign.cookie)).status, 404);
  assert.equal((await app.request(`/api/documents/${documentId}/file`, { headers: { Cookie: foreign.cookie } })).status, 404);

  const corrected = await jsonRequest(`/documents/${documentId}/findings/${hemoglobin.id}`, "PATCH", {
    status: "corrected",
    correctedValueText: "13.6",
  }, cookie);
  assert.equal(corrected.status, 200);
  const correctedBody = await corrected.json() as { finding: { status: string; correctedValueText: string; correctedAt: string } };
  assert.equal(correctedBody.finding.status, "corrected");
  assert.equal(correctedBody.finding.correctedValueText, "13.6");
  assert.ok(correctedBody.finding.correctedAt);
  assert.equal((await jsonRequest(`/documents/${documentId}/findings/${hemoglobin.id}`, "PATCH", { status: "corrected" }, cookie)).status, 400);
  assert.equal((await jsonRequest(`/documents/${documentId}/findings/${hemoglobin.id}`, "PATCH", { status: "confirmed" }, foreign.cookie)).status, 404);

  const noConsent = await jsonRequest(`/documents/${documentId}/interpretations`, "POST", { consentToExternalProcessing: false }, cookie);
  assert.equal(noConsent.status, 400);
  assert.equal((await noConsent.json() as { error: string }).error, "external_data_consent_required");
  assert.equal((await jsonRequest(`/documents/${documentId}/interpretations`, "POST", { consentToExternalProcessing: true }, foreign.cookie)).status, 404);
  const disabledTransfer = await jsonRequest(`/documents/${documentId}/interpretations`, "POST", { consentToExternalProcessing: true }, cookie);
  assert.equal(disabledTransfer.status, 503);
  assert.equal((await disabledTransfer.json() as { error: string }).error, "external_processing_disabled");

  process.env.AI_DATA_SHARING_ENABLED = "true";
  process.env.AI_HEALTH_DATA_TRANSFER_APPROVED = "true";
  try {
    const providerOff = await jsonRequest(`/documents/${documentId}/interpretations`, "POST", { consentToExternalProcessing: true }, cookie);
    assert.equal(providerOff.status, 503);
    assert.equal((await providerOff.json() as { error: string }).error, "provider_unavailable");

    setTestDocumentInterpreter({
      async interpret(input) {
        return {
          provider: "test",
          model: "test-double",
          sections: {
            documentType: input.documentType,
            summary: "Restates extracted findings only.",
            findingsExplained: [],
            terminology: [],
            inconsistencies: [],
            missingInformation: [],
            questionsForClinician: [],
            limitations: ["test fixture"],
          },
        };
      },
    });
    const interpreted = await jsonRequest(`/documents/${documentId}/interpretations`, "POST", { consentToExternalProcessing: true }, cookie);
    assert.equal(interpreted.status, 201);
    const interpretedBody = await interpreted.json() as { interpretation: { id: number; provider: string; status: string; sections: { summary: string } }; notice: string };
    assert.equal(interpretedBody.interpretation.provider, "test");
    assert.equal(interpretedBody.interpretation.status, "completed");
    assert.equal(interpretedBody.interpretation.sections.summary, "Restates extracted findings only.");
    assert.match(interpretedBody.notice, /not a diagnosis/i);
  } finally {
    setTestDocumentInterpreter(undefined);
    delete process.env.AI_DATA_SHARING_ENABLED;
    delete process.env.AI_HEALTH_DATA_TRANSFER_APPROVED;
  }

  const afterInterpretation = await jsonRequest(`/documents/${documentId}`, "GET", undefined, cookie);
  const afterInterpretationBody = await afterInterpretation.json() as { document: DocumentView };
  assert.equal(afterInterpretationBody.document.interpretations?.length, 1);

  const corrupt = await uploadDocument(cookie, Buffer.from("%PDF-1.4\nnot actually a pdf", "latin1"), "application/pdf", "corrupt.pdf", caseId);
  assert.equal(corrupt.status, 201);
  const corruptId = (await corrupt.json() as { document: DocumentView }).document.id;
  const corruptDocument = await waitForDocument(cookie, corruptId);
  assert.equal(corruptDocument.processingStatus, "failed");
  assert.equal(corruptDocument.extractionErrorCode, "corrupt_pdf");

  const reprocess = await jsonRequest(`/documents/${documentId}/reprocess`, "POST", undefined, cookie);
  assert.equal(reprocess.status, 200);
  const reprocessed = await waitForDocument(cookie, documentId);
  assert.equal(reprocessed.processingStatus, "extracted");
  assert.ok((reprocessed.findingCount ?? 0) >= 3, "reprocessing rebuilds extracted findings");

  const workspace = await jsonRequest(`/cases/${caseId}/workspace`, "GET", undefined, cookie);
  assert.equal(workspace.status, 200);
  const workspaceBody = await workspace.json() as {
    patient: { id: number } | null;
    uploads: unknown[];
    predictions: unknown[];
    documents: DocumentView[];
    reports: Array<{ id: number }>;
    limitations: string[];
  };
  assert.equal(workspaceBody.patient?.id, patientId);
  assert.equal(workspaceBody.documents.length, 2);
  assert.equal(workspaceBody.predictions.length, 0);
  assert.ok(workspaceBody.limitations.length > 0);
  assert.equal((await jsonRequest(`/cases/${caseId}/workspace`, "GET", undefined, foreign.cookie)).status, 404);

  const reportCreate = await jsonRequest("/reports", "POST", {
    caseId,
    title: "Document workspace report",
    type: "comprehensive",
  }, cookie);
  assert.equal(reportCreate.status, 201);
  const reportId = (await reportCreate.json() as { report: { id: number } }).report.id;
  const exportResponse = await app.request(`/api/reports/${reportId}/export`, { headers: { Cookie: cookie } });
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get("content-type") ?? "", /text\/plain/);
  const exportText = await exportResponse.text();
  assert.match(exportText, /MedScope AI draft report/);
  assert.match(exportText, /not a diagnosis/i);
  assert.equal((await app.request(`/api/reports/${reportId}/export`, { headers: { Cookie: foreign.cookie } })).status, 404);

  assert.equal((await jsonRequest(`/documents/${corruptId}`, "DELETE", undefined, cookie)).status, 204);
  assert.equal((await jsonRequest(`/documents/${corruptId}`, "GET", undefined, cookie)).status, 404);
});

test("record pages consume generated API hooks instead of mock arrays", async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const pages = await Promise.all([
    readFile(path.join(repoRoot, "artifacts/skin-ai/src/pages/home.tsx"), "utf8"),
    readFile(path.join(repoRoot, "artifacts/skin-ai/src/pages/patients.tsx"), "utf8"),
    readFile(path.join(repoRoot, "artifacts/skin-ai/src/pages/cases.tsx"), "utf8"),
    readFile(path.join(repoRoot, "artifacts/skin-ai/src/pages/reports.tsx"), "utf8"),
    readFile(path.join(repoRoot, "artifacts/skin-ai/src/pages/symptom-assessment.tsx"), "utf8"),
    readFile(path.join(repoRoot, "artifacts/skin-ai/src/pages/skin-analysis.tsx"), "utf8"),
  ]);
  assert.match(pages[0]!, /useListPatients/);
  assert.match(pages[1]!, /useListPatients/);
  assert.match(pages[2]!, /useListCases/);
  assert.match(pages[3]!, /useListReports/);
  assert.match(pages[4]!, /useListSymptomAssessments/);
  assert.match(pages[5]!, /uploadFile/);
  for (const page of pages) {
    assert.doesNotMatch(page, /mockPatients|fakePatients|demoPatients|mockCases|fakeCases|demoCases/);
  }
});

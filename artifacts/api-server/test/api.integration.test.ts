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
process.env.SKIN_RESEARCH_INFERENCE_ENABLED = "false";
const uploadDirectory = await mkdtemp(path.join(tmpdir(), "medscope-api-test-"));
process.env.UPLOAD_DIR = uploadDirectory;

const [
  { default: app },
  { db, pool },
  { users, reviews, predictions },
  { setTestInferenceProvider },
  { setTestOcrProvider },
  { setTestDocumentInterpreter },
  { cardiacModelStatus },
] = await Promise.all([
  import("../src/app"),
  import("@workspace/db"),
  import("@workspace/db/schema"),
  import("../src/inference"),
  import("../src/document-extraction"),
  import("../src/document-interpreter"),
  import("../src/cardiac"),
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
  const cardiacExpected = JSON.parse(JSON.stringify(await cardiacModelStatus())) as Record<string, unknown>;
  assert.deepEqual(await readiness.json(), {
    status: "ready",
    checks: {
      database: true,
      model: false,
      cardiacModel: false,
      aiProvider: "disabled",
      documentOcr: { status: "configured", providerId: "tesseract.js" },
      skinInference: { available: false, reason: "Research-only skin inference is disabled by configuration (SKIN_RESEARCH_INFERENCE_ENABLED=false).", status: "unavailable" },
      symptomClassifier: {
        available: true,
        classCount: 41,
        mode: "research_only",
        modelId: "medscope-symptoms-bernoulli-nb-v1",
        modelVersion: "symptom-bernoulli-nb-20261016",
      },
      cardiacInference: cardiacExpected,
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
  const persistedSymptom = await jsonRequest(`/symptom-assessments/${symptomId}`, "GET", undefined, cookieA);
  const persistedSymptomBody = await persistedSymptom.json() as { assessment: { classification: { status: string } | null } };
  assert.equal(persistedSymptomBody.assessment.classification?.status, "insufficient_input");

  const classification = await jsonRequest("/symptom-assessments", "POST", {
    primarySymptom: "itching and skin rash",
    symptomCategory: "skin",
    selectedSymptoms: ["itching", "skin_rash", "my custom phrase"],
  }, cookieA);
  assert.equal(classification.status, 201);
  const classificationBody = await classification.json() as { assessment: { id: number; classification: { status: string; modelId: string; rankedConditions: Array<{ condition: string; score: number; supportingSymptoms: string[] }>; unmatchedSymptoms: string[]; notice: string } } };
  assert.equal(classificationBody.assessment.classification.status, "completed");
  assert.equal(classificationBody.assessment.classification.modelId, "medscope-symptoms-bernoulli-nb-v1");
  assert.equal(classificationBody.assessment.classification.rankedConditions[0]?.condition, "Fungal infection");
  assert.ok(classificationBody.assessment.classification.rankedConditions[0]?.score > 0.9);
  assert.deepEqual(classificationBody.assessment.classification.unmatchedSymptoms, ["my custom phrase"]);
  assert.match(classificationBody.assessment.classification.notice, /statistical classifier/i);
  const classificationPersisted = await (await jsonRequest(`/symptom-assessments/${classificationBody.assessment.id}`, "GET", undefined, cookieA)).json() as { assessment: { classification: { status: string; rankedConditions: { length: number } } } };
  assert.equal(classificationPersisted.assessment.classification.status, "completed");
  assert.equal(classificationPersisted.assessment.classification.rankedConditions.length, 4);
  const catalogueStatus = await app.request("/api/symptoms/classifier-status");
  const catalogueBody = await catalogueStatus.json() as { available: boolean; catalogue?: string[]; mode?: string };
  assert.equal(catalogueBody.available, true);
  assert.equal(catalogueBody.mode, "research_only");
  assert.ok((catalogueBody.catalogue?.length ?? 0) === 132);
  assert.equal((await jsonRequest("/symptom-assessments", "POST", { caseId, primarySymptom: "test", symptomCategory: "general" }, cookieB)).status, 404);

  const cardiacStatus = await app.request("/api/cardiac/model-status");
  assert.equal(cardiacStatus.status, 200);
  const cardiacStatusBody = await cardiacStatus.json() as { available: boolean; mode?: string; modelId?: string; metrics?: { test?: { rocAuc?: number } } };
  assert.equal(cardiacStatusBody.available, true);
  assert.equal(cardiacStatusBody.mode, "research_only");
  assert.equal(cardiacStatusBody.modelId, "medscope-cardiac-logreg-v1");
  assert.ok(cardiacStatusBody.metrics && typeof cardiacStatusBody.metrics.test?.rocAuc === "number");

  const cardiac = await jsonRequest("/cardiac/assessments", "POST", {
    caseId,
    age: 58, sex: "male", chestPainType: "asymptomatic", restingBloodPressure: 140, serumCholesterol: 260,
    fastingBloodSugarOver120: "no", restingEcg: "st_t_abnormality", maxHeartRate: 130, exerciseAngina: "yes",
    stDepression: 3.2, stSlope: "flat", majorVessels: 2, thalassemia: "reversible_defect",
  }, cookieA);
  assert.equal(cardiac.status, 201);
  const cardiacBody = await cardiac.json() as { assessment: { id: number; status: string; riskScore: number; label: string; aboveThreshold: boolean; threshold: number; modelId: string; modelVersion: string; topFactors: unknown[]; notice: string; diagnosticLimitations: string[] } };
  assert.equal(cardiacBody.assessment.status, "research_only");
  assert.ok(Math.abs(cardiacBody.assessment.riskScore - 0.99709692) < 0.00005, `expected pinned high-risk ~0.99709692, got ${cardiacBody.assessment.riskScore}`);
  assert.equal(cardiacBody.assessment.label, "disease");
  assert.equal(cardiacBody.assessment.aboveThreshold, true);
  assert.equal(cardiacBody.assessment.threshold, 0.5);
  assert.equal(cardiacBody.assessment.modelId, "medscope-cardiac-logreg-v1");
  assert.equal(cardiacBody.assessment.modelVersion, "cardiac-logreg-20261016");
  assert.equal(cardiacBody.assessment.topFactors.length, 3);
  assert.match(cardiacBody.assessment.notice, /not a probability of heart disease/i);
  assert.ok(cardiacBody.assessment.diagnosticLimitations.length > 0);
  const cardiacId = cardiacBody.assessment.id;
  assert.equal((await jsonRequest(`/cardiac/assessments/${cardiacId}`, "GET", undefined, cookieB)).status, 404);
  const cardiacList = await jsonRequest("/cardiac/assessments", "GET", undefined, cookieA);
  assert.equal((await cardiacList.json() as { assessments: unknown[] }).assessments.length, 1);
  const cardiacInvalid = await jsonRequest("/cardiac/assessments", "POST", {
    caseId, age: 58, sex: "male", chestPainType: "asymptomatic", restingBloodPressure: 140, serumCholesterol: 260,
    fastingBloodSugarOver120: "no", restingEcg: "st_t_abnormality", maxHeartRate: 130, exerciseAngina: "yes",
    stDepression: 3.2, stSlope: "flat", majorVessels: 1.5, thalassemia: "reversible_defect",
  }, cookieA);
  assert.equal(cardiacInvalid.status, 400);
  const cardiacInvalidBody = await cardiacInvalid.json() as { error: string; field: string };
  assert.equal(cardiacInvalidBody.error, "invalid_feature_value");
  assert.equal(cardiacInvalidBody.field, "majorVessels");
  assert.equal((await (await jsonRequest("/cardiac/assessments", "GET", undefined, cookieB)).json() as { total: number }).total, 0);

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
  assert.match(unavailableBody.message, /no verified and enabled skin model/i);
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
  const reprocessedHemoglobin = reprocessed.findings!.filter((finding) => finding.label === "Hemoglobin");
  assert.equal(reprocessedHemoglobin.length, 1, "reprocess does not duplicate preserved findings");
  assert.equal(reprocessedHemoglobin[0]!.correctedValueText, "13.6", "reprocess preserves the user's corrected value");

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

test("document trends match conservatively, failed interpretations persist, and PDF export works", async () => {
  const account = await register(`owner-doc2-${randomUUID()}@example.test`);
  const cookie = account.cookie;
  const patientResponse = await jsonRequest("/patients", "POST", { firstName: "Trend", lastName: "Fixture" }, cookie);
  const patientId = (await patientResponse.json() as { patient: { id: number } }).patient.id;
  const caseId = (await (await jsonRequest("/cases", "POST", { patientId, type: "skin_analysis" }, cookie)).json() as { case: { id: number } }).case.id;

  setTestOcrProvider({
    id: "test-ocr-a",
    recognize: async () => ({ text: "Hemoglobin 9.2 g/dL (13.0 - 17.0)\nDiagnosis: Anemia evaluation", confidence: 0.98 }),
  });
  const png1 = await sharp({ create: { width: 24, height: 12, channels: 3, background: "#ffffff" } }).png().toBuffer();
  const created1 = await uploadDocument(cookie, png1, "image/png", "early.png");
  const document1Id = (await created1.json() as { document: DocumentView }).document.id;
  await waitForDocument(cookie, document1Id);

  setTestOcrProvider({
    id: "test-ocr-b",
    recognize: async () => ({ text: "Hemoglobin 11.1 g/dL (13.0 - 17.0)\nDiagnosis: Anemia evaluation", confidence: 0.98 }),
  });
  const png2 = await sharp({ create: { width: 24, height: 12, channels: 3, background: "#ffffff" } }).png().toBuffer();
  const created2 = await uploadDocument(cookie, png2, "image/png", "later.png");
  const document2Id = (await created2.json() as { document: DocumentView }).document.id;
  await waitForDocument(cookie, document2Id);

  const unauthorizedTrend = await app.request("/api/documents/trends?documentId=1&label=Hemoglobin");
  assert.equal(unauthorizedTrend.status, 401);

  let trend = await jsonRequest(`/documents/trends?documentId=${document1Id}&label=Hemoglobin&unit=g/dL`, "GET", undefined, cookie);
  assert.equal(trend.status, 200);
  let trendBody = await trend.json() as { series: Array<{ documentId: number; numericValue: number | null; unit: string | null; resultFlag: string }>; matchingStrategy: string };
  assert.ok(trendBody.matchingStrategy.includes("no unit conversion"));
  assert.equal(trendBody.series.length, 2, "two documents contain a matching normalized label");
  assert.equal(trendBody.series[0]!.documentId, document2Id, "trend series is ordered newest first");
  assert.equal(trendBody.series[0]!.numericValue, 11.1);
  assert.equal(trendBody.series[1]!.numericValue, 9.2);
  assert.equal(trendBody.series.every((entry) => entry.unit === "g/dL"), true);

  trend = await jsonRequest(`/documents/trends?documentId=${document1Id}&label=Hemoglobin&unit=mmol%2FL`, "GET", undefined, cookie);
  trendBody = await trend.json() as { series: Array<{ documentId: number; numericValue: number | null; unit: string | null; resultFlag: string }>; matchingStrategy: string };
  assert.equal(trendBody.series.length, 0, "different units are never merged into one series");

  process.env.AI_DATA_SHARING_ENABLED = "true";
  process.env.AI_HEALTH_DATA_TRANSFER_APPROVED = "true";
  try {
    setTestDocumentInterpreter({
      async interpret() {
        throw new Error("simulated provider outage");
      },
    });
    const failedInterpretation = await jsonRequest(`/documents/${document1Id}/interpretations`, "POST", { consentToExternalProcessing: true }, cookie);
    assert.equal(failedInterpretation.status, 503);
    const afterFailure = await jsonRequest(`/documents/${document1Id}`, "GET", undefined, cookie);
    const afterFailureBody = await afterFailure.json() as { document: { interpretations: Array<{ status: string; errorCode: string | null; promptVersion: string }> } };
    const failedRecord = afterFailureBody.document.interpretations.find((interpretation) => interpretation.status === "failed");
    assert.ok(failedRecord, "failed interpretation attempts are persisted");
    assert.equal(failedRecord!.errorCode, "provider_unavailable");
    assert.match(failedRecord!.promptVersion ?? "", /^document-interpretation-v/);
  } finally {
    setTestDocumentInterpreter(undefined);
    delete process.env.AI_DATA_SHARING_ENABLED;
    delete process.env.AI_HEALTH_DATA_TRANSFER_APPROVED;
  }

  const reportResponse = await jsonRequest("/reports", "POST", {
    caseId,
    title: "PDF export report",
    type: "comprehensive",
  }, cookie);
  assert.equal(reportResponse.status, 201);
  const reportId = (await reportResponse.json() as { report: { id: number } }).report.id;
  const pdfResponse = await app.request(`/api/reports/${reportId}/export.pdf`, { headers: { Cookie: cookie } });
  assert.equal(pdfResponse.status, 200);
  assert.equal(pdfResponse.headers.get("content-type"), "application/pdf");
  const pdfBytes = Buffer.from(await pdfResponse.arrayBuffer());
  assert.match(pdfBytes.subarray(0, 8).toString("latin1"), /^%PDF-1\.\d/);
  assert.ok(pdfBytes.length > 400, "PDF contains page and content objects");

  const foreign = await register(`owner-doc2-b-${randomUUID()}@example.test`);
  assert.equal((await jsonRequest(`/documents/trends?documentId=${document1Id}&label=Hemoglobin`, "GET", undefined, foreign.cookie)).status, 404);
  assert.equal((await app.request(`/api/reports/${reportId}/export.pdf`, { headers: { Cookie: foreign.cookie } })).status, 404);
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

test("saved symptom AI evaluations are consent-gated, owner-scoped, keep failed attempts, and preserve history on re-evaluate", async () => {
  const { setTestClinicalAIProvider } = await import("../src/clinical-ai");
  const { AIProviderError } = await import("../src/ai-providers");
  const owner = await register(`eval-owner-${randomUUID()}@example.test`, { role: "admin" });
  const cookieOwner = owner.cookie;
  const stranger = await register(`eval-stranger-${randomUUID()}@example.test`);

  const created = await jsonRequest("/symptom-assessments", "POST", { primarySymptom: "mild sore throat", symptomCategory: "respiratory" }, cookieOwner);
  assert.equal(created.status, 201);
  const assessmentId = (await created.json() as { assessment: { id: number; urgencyLevel: string; redFlagsTriggered: string[] } }).assessment.id;

  const noTransferGate = await jsonRequest(`/symptom-assessments/${assessmentId}/ai-evaluations`, "POST", { consentToExternalProcessing: true }, cookieOwner);
  assert.equal(noTransferGate.status, 403);
  assert.match((await noTransferGate.json() as { message: string }).message, /External analysis is disabled/i);
  const emptyList = await jsonRequest(`/symptom-assessments/${assessmentId}/ai-evaluations`, "GET", undefined, cookieOwner);
  assert.equal(emptyList.status, 200);
  assert.equal((await emptyList.json() as { evaluations: unknown[] }).evaluations.length, 0);
  assert.equal((await jsonRequest(`/symptom-assessments/${assessmentId}/ai-evaluations`, "GET", undefined, stranger.cookie)).status, 404);

  process.env.AI_DATA_SHARING_ENABLED = "true";
  process.env.AI_HEALTH_DATA_TRANSFER_APPROVED = "true";
  try {
    const noProvider = await jsonRequest(`/symptom-assessments/${assessmentId}/ai-evaluations`, "POST", { consentToExternalProcessing: true }, cookieOwner);
    assert.equal(noProvider.status, 503);

    const evaluationResult = {
      summary: "Reported mild sore throat as the principal symptom only.",
      reportedSymptoms: ["mild sore throat"],
      possibleConsiderations: [{ name: "Common viral throat irritation", whyDiscussed: "Sore throat without reported fever is a pattern commonly discussed in education for throat viruses." }],
      supportingInformation: "Only the principal symptom was reported.",
      missingInformation: "Duration, temperature, and swallowing difficulty were not reported.",
      urgencyContext: "Rule-based urgency routine; no emergency red flags were matched.",
      limitations: "Educational content only and never a diagnosis.",
      followUpQuestions: ["How many days has the throat discomfort lasted?"],
      disclaimer: "Educational information only, not a diagnosis.",
    };
    let providerBehavior: "ok" | "fail" = "ok";
    setTestClinicalAIProvider({
      async analyzeSkin() { throw new Error("not used"); },
      async analyzeSymptoms() { throw new Error("not used"); },
      async analyzeCardiac() { throw new Error("not used"); },
      async evaluateSymptoms(input) {
        assert.equal(input.primarySymptom, "mild sore throat");
        assert.equal(input.urgencyLevel, "routine");
        if (providerBehavior === "fail") throw new AIProviderError("provider_unavailable");
        return { provider: "test", model: "test-double", result: { ...evaluationResult } };
      },
    });

    const first = await jsonRequest(`/symptom-assessments/${assessmentId}/ai-evaluations`, "POST", { consentToExternalProcessing: true }, cookieOwner);
    assert.equal(first.status, 201);
    const firstBody = await first.json() as { evaluation: { id: number; provider: string; model: string; status: string; result: { summary: string; urgencyLevel: string; redFlagsTriggered: string[] } } };
    assert.equal(firstBody.evaluation.provider, "test");
    assert.equal(firstBody.evaluation.model, "test-double");
    assert.equal(firstBody.evaluation.status, "completed");
    assert.equal(firstBody.evaluation.result.summary, evaluationResult.summary);
    assert.equal(firstBody.evaluation.result.urgencyLevel, "routine");
    assert.deepEqual(firstBody.evaluation.result.redFlagsTriggered, []);
    const listAfterFirst = await jsonRequest(`/symptom-assessments/${assessmentId}/ai-evaluations`, "GET", undefined, cookieOwner);
    assert.deepEqual((await listAfterFirst.json() as { evaluations: Array<{ id: number; status: string }> }).evaluations.map((row) => row.id), [firstBody.evaluation.id]);

    const strangerRun = await jsonRequest(`/symptom-assessments/${assessmentId}/ai-evaluations/${firstBody.evaluation.id}/re-evaluate`, "POST", { consentToExternalProcessing: true }, stranger.cookie);
    assert.equal(strangerRun.status, 404);

    providerBehavior = "fail";
    const failed = await jsonRequest(`/symptom-assessments/${assessmentId}/ai-evaluations/${firstBody.evaluation.id}/re-evaluate`, "POST", { consentToExternalProcessing: true }, cookieOwner);
    assert.equal(failed.status, 502);
    assert.equal((await failed.json() as { message: string }).message.includes("temporarily unavailable"), true);
    const afterFailure = await jsonRequest(`/symptom-assessments/${assessmentId}/ai-evaluations`, "GET", undefined, cookieOwner);
    const rowsAfterFailure = (await afterFailure.json() as { evaluations: Array<{ id: number; status: string; errorCode: string | null }> }).evaluations;
    assert.deepEqual(rowsAfterFailure.map((row) => row.status), ["failed", "completed"]);
    assert.equal(rowsAfterFailure.find((row) => row.status === "failed")?.errorCode, "provider_unavailable");

    providerBehavior = "ok";
    const second = await jsonRequest(`/symptom-assessments/${assessmentId}/ai-evaluations/${firstBody.evaluation.id}/re-evaluate`, "POST", { consentToExternalProcessing: true }, cookieOwner);
    assert.equal(second.status, 201);
    const secondBody = await second.json() as { evaluation: { id: number; status: string; provider: string }; previousEvaluationId: number };
    assert.equal(secondBody.evaluation.status, "completed");
    assert.equal(secondBody.evaluation.provider, "test");
    assert.equal(secondBody.previousEvaluationId, firstBody.evaluation.id);
    const listFinal = await jsonRequest(`/symptom-assessments/${assessmentId}/ai-evaluations`, "GET", undefined, cookieOwner);
    const rowsFinal = (await listFinal.json() as { evaluations: Array<{ id: number; status: string }> }).evaluations;
    assert.deepEqual(rowsFinal.map((row) => [row.status, row.id]), [
      ["completed", secondBody.evaluation.id],
      ["failed", rowsAfterFailure.find((row) => row.status === "failed")?.id],
      ["completed", firstBody.evaluation.id],
    ]);
  } finally {
    setTestClinicalAIProvider(undefined);
    delete process.env.AI_DATA_SHARING_ENABLED;
    delete process.env.AI_HEALTH_DATA_TRANSFER_APPROVED;
  }
});

test("symptom submission runs one AI pipeline with urgent skip, honest failure preservation, reopen without provider calls, and warning preservation", async () => {
  const { setTestClinicalAIProvider } = await import("../src/clinical-ai");
  const { AIProviderError } = await import("../src/ai-providers");
  const owner = await register(`pipeline-owner-${randomUUID()}@example.test`);
  const cookieOwner = owner.cookie;
  const stranger = await register(`pipeline-stranger-${randomUUID()}@example.test`);

  process.env.AI_DATA_SHARING_ENABLED = "true";
  process.env.AI_HEALTH_DATA_TRANSFER_APPROVED = "true";
  let evaluationCalls = 0;
  let behavior: "reject_call" | "malformed" | "routine_ok" | "claim_safe" = "reject_call";
  setTestClinicalAIProvider({
    async analyzeSkin() { throw new Error("not used"); },
    async analyzeSymptoms() { throw new Error("not used"); },
    async analyzeCardiac() { throw new Error("not used"); },
    async evaluateSymptoms() {
      evaluationCalls += 1;
      if (behavior === "reject_call") throw new Error("provider must not be called for urgent inputs");
      if (behavior === "malformed") throw new AIProviderError("provider_malformed_response");
      if (behavior === "claim_safe") {
        return {
          provider: "test",
          model: "test-double",
          result: {
            summary: "Attempts to claim everything is routine.",
            reportedSymptoms: ["back pain"],
            possibleConsiderations: [],
            supportingInformation: "n/a",
            missingInformation: "n/a",
            urgencyContext: "This is safe routine guidance, no urgent care is needed at all.",
            limitations: "Educational only.",
            followUpQuestions: ["Do you have fever?"],
            disclaimer: "Educational information only, not a diagnosis.",
          },
        };
      }
      return {
        provider: "test",
        model: "test-double",
        result: {
          summary: "Reported mild sore throat with limited detail.",
          reportedSymptoms: ["mild sore throat"],
          possibleConsiderations: [{ name: "Viral throat irritation", whyDiscussed: "Sore throat without reported fever is commonly discussed as viral irritation." }],
          supportingInformation: "Self-reported sore throat only.",
          missingInformation: "Duration, temperature, and swallowing difficulty.",
          urgencyContext: "Rule-based urgency routine.",
          limitations: "Educational only.",
          followUpQuestions: ["How long has the throat discomfort lasted?"],
          disclaimer: "Educational information only, not a diagnosis.",
        },
      };
    },
  });
  try {
    const urgent = await jsonRequest("/symptom-assessments", "POST", {
      primarySymptom: "quite sharp back pain",
      symptomCategory: "musculoskeletal",
      severity: "severe",
      consentToExternalProcessing: true,
      questionnaireAnswers: [],
    }, cookieOwner);
    assert.equal(urgent.status, 201);
    const urgentBody = await urgent.json() as { assessment: { id: number; urgencyLevel: string; classification: { aiAssessment: { status: string } | null } }; aiStatus: string; urgencyState: string };
    assert.equal(urgentBody.assessment.urgencyLevel, "urgent");
    assert.equal(urgentBody.aiStatus, "skipped_urgent");
    assert.equal(urgentBody.urgencyState, "urgent_guidance");
    assert.equal(urgentBody.assessment.classification?.aiAssessment?.status, "skipped_urgent");
    assert.equal(evaluationCalls, 0);

    behavior = "malformed";
    const routineConsent = await jsonRequest("/symptom-assessments", "POST", {
      primarySymptom: "mild sore throat",
      symptomCategory: "respiratory",
      consentToExternalProcessing: true,
    }, cookieOwner);
    assert.equal(routineConsent.status, 201);
    const routineBody = await routineConsent.json() as { assessment: { id: number; urgencyLevel: string }; aiStatus: string; evaluation: { status: string; errorCode: string | null; promptVersion: string } };
    assert.equal(routineBody.aiStatus, "failed");
    assert.equal(routineBody.evaluation.status, "failed");
    assert.equal(routineBody.evaluation.errorCode, "provider_malformed_response");
    const routinePersisted = await (await jsonRequest(`/symptom-assessments/${routineBody.assessment.id}`, "GET", undefined, cookieOwner)).json() as { assessment: { urgencyLevel: string; guidance: { recommendations: string[] } } };
    assert.equal(routinePersisted.assessment.urgencyLevel, "routine");
    assert.ok(routinePersisted.assessment.guidance.recommendations.length > 0);

    behavior = "routine_ok";
    const completed = await jsonRequest("/symptom-assessments", "POST", {
      primarySymptom: "mild sore throat",
      symptomCategory: "respiratory",
      consentToExternalProcessing: true,
    }, cookieOwner);
    assert.equal(completed.status, 201);
    const completedBody = await completed.json() as { assessment: { id: number }; aiStatus: string; evaluation: { id: number; status: string; provider: string; model: string; result: { summary: string; urgencyLevel: string; redFlagsTriggered: string[] }; promptVersion: string }; urgencyState: string };
    assert.equal(completedBody.aiStatus, "completed");
    assert.equal(completedBody.evaluation.status, "completed");
    assert.equal(completedBody.evaluation.provider, "test");
    assert.equal(completedBody.evaluation.model, "test-double");
    assert.match(completedBody.evaluation.promptVersion, /^symptom-eval-v\d+$/);
    assert.ok(completedBody.evaluation.result.summary.length > 0);
    assert.equal(completedBody.evaluation.result.urgencyLevel, "routine");
    assert.equal(completedBody.urgencyState, "needs_more_information", "routine + classifier not completed = needs_more_information");
    const callsAfterCompleted = evaluationCalls;

    const reopened = await jsonRequest(`/symptom-assessments/${completedBody.assessment.id}`, "GET", undefined, cookieOwner);
    assert.equal(reopened.status, 200);
    const evaluationsReopen = await jsonRequest(`/symptom-assessments/${completedBody.assessment.id}/ai-evaluations`, "GET", undefined, cookieOwner);
    assert.equal(evaluationsReopen.status, 200);
    const evaluationsBody = await evaluationsReopen.json() as { evaluations: unknown[] };
    assert.equal(Array.isArray(evaluationsBody.evaluations), true);
    assert.equal((await jsonRequest(`/symptom-assessments/${completedBody.assessment.id}`, "GET", undefined, stranger.cookie)).status, 404);
    assert.equal((await jsonRequest(`/symptom-assessments/${completedBody.assessment.id}/ai-evaluations`, "GET", undefined, stranger.cookie)).status, 404);
    assert.equal(evaluationCalls, callsAfterCompleted, "reopening must not trigger any provider call");

    behavior = "claim_safe";
    const attemptingDowngrade = await jsonRequest(`/symptom-assessments/${completedBody.assessment.id}/ai-evaluations/${completedBody.evaluation.id}/re-evaluate`, "POST", { consentToExternalProcessing: true }, cookieOwner);
    assert.equal(attemptingDowngrade.status, 201);
    const downgradeBody = await attemptingDowngrade.json() as { evaluation: { result: { urgencyLevel: string; redFlagsTriggered: string[] } } };
    assert.equal(downgradeBody.evaluation.result.urgencyLevel, "routine");

    const urgentForDowngrade = await jsonRequest("/symptom-assessments", "POST", {
      primarySymptom: "ongoing stomach pain with vomiting",
      symptomCategory: "gastrointestinal",
      severity: "moderate",
    }, cookieOwner);
    assert.equal(urgentForDowngrade.status, 201);
    const urgentForDowngradeBody = await urgentForDowngrade.json() as { assessment: { id: number; urgencyLevel: string; redFlagsTriggered: string[] } };
    assert.equal(urgentForDowngradeBody.assessment.urgencyLevel, "urgent");
    assert.ok(urgentForDowngradeBody.assessment.redFlagsTriggered.length > 0);
    const noEvaluationYet = await jsonRequest(`/symptom-assessments/${urgentForDowngradeBody.assessment.id}/ai-evaluations`, "POST", { consentToExternalProcessing: true }, cookieOwner);
    assert.equal(noEvaluationYet.status, 201);
    const savedEvaluation = await noEvaluationYet.json() as { evaluation: { id: number; result: { urgencyLevel: string; redFlagsTriggered: string[] } } };
    assert.equal(savedEvaluation.evaluation.result.urgencyLevel, "urgent", "backend owns the urgency label");
    assert.deepEqual(savedEvaluation.evaluation.result.redFlagsTriggered, urgentForDowngradeBody.assessment.redFlagsTriggered, "deterministic red flags are preserved over model output");

    const invalidQuestionnaire = await jsonRequest("/symptom-assessments", "POST", {
      primarySymptom: "headache",
      symptomCategory: "neurological",
      questionnaireAnswers: [{ questionId: "not_a_real_question", answer: "yes" }],
    }, cookieOwner);
    assert.equal(invalidQuestionnaire.status, 400);
    const invalidAnswer = await jsonRequest("/symptom-assessments", "POST", {
      primarySymptom: "headache",
      symptomCategory: "neurological",
      questionnaireAnswers: [{ questionId: "cough_blood", answer: "maybe" }],
    }, cookieOwner);
    assert.equal(invalidAnswer.status, 400);

    const followUpUnauth = await app.request("/api/symptoms/follow-up-questions?category=neurological&primary=headache");
    assert.equal(followUpUnauth.status, 401);
    const followUp = await jsonRequest("/symptoms/follow-up-questions?category=neurological&primary=headache", "GET", undefined, cookieOwner);
    assert.equal(followUp.status, 200);
    const followUpBody = await followUp.json() as { questionSetVersion: string; questions: Array<{ id: string; type: string; allowUnknown: boolean }> };
    assert.match(followUpBody.questionSetVersion, /^symptom-followups-v\d+$/);
    assert.ok(followUpBody.questions.some((question) => question.id === "headache_worst_ever"));
    for (const question of followUpBody.questions) assert.equal(question.allowUnknown, true);
  } finally {
    setTestClinicalAIProvider(undefined);
    delete process.env.AI_DATA_SHARING_ENABLED;
    delete process.env.AI_HEALTH_DATA_TRANSFER_APPROVED;
  }
});


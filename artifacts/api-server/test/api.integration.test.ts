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
process.env.RATE_LIMIT_PREDICT = "100";
process.env.AI_RATE_LIMIT = "100";
const uploadDirectory = await mkdtemp(path.join(tmpdir(), "medscope-api-test-"));
process.env.UPLOAD_DIR = uploadDirectory;

const [{ default: app }, { db, pool }, { users, reviews, predictions }, { setTestInferenceProvider }] = await Promise.all([
  import("../src/app"),
  import("@workspace/db"),
  import("@workspace/db/schema"),
  import("../src/inference"),
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

after(async () => {
  setTestInferenceProvider(undefined);
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
  assert.deepEqual(await readiness.json(), { status: "ready", checks: { database: true, model: false, aiProvider: "disabled" } });

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

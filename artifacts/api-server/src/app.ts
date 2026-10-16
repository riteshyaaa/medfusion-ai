import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@workspace/db";
import { users, sessions, patients, cases, uploads, predictions, symptomAssessments, reviews, reports, auditEvents } from "@workspace/db/schema";
import { eq, desc, and, or, ilike, count, sql, inArray, isNull } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { getCookie, setCookie } from "hono/cookie";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { LocalPrivateStorage } from "./storage";
import { getTestInferenceProvider, hasApprovedSkinModel } from "./inference";
import { AIProviderError, configuredExplanationProvider, externalHealthDataTransferEnabled, getAIProviderStatus } from "./ai-providers";

type Variables = {
  user: typeof users.$inferSelect;
  sessionId: string;
  requestId: string;
};

const app = new Hono<{ Variables: Variables }>();
const SESSION_COOKIE_NAME = "session_id";
const SESSION_TTL_DAYS = 7;
const SESSION_TTL_SECONDS = SESSION_TTL_DAYS * 24 * 60 * 60;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_IMAGE_DIMENSION = 8_192;
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const uploadDir = process.env.UPLOAD_DIR
  ? path.resolve(repositoryRoot, process.env.UPLOAD_DIR)
  : path.resolve(repositoryRoot, "uploads");
const storage = new LocalPrivateStorage(uploadDir);

function envLimit(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function rateLimit(maximum: number, windowMs: number) {
  const requests = new Map<string, { count: number; resetsAt: number }>();
  return async (c: any, next: () => Promise<void>) => {
    const now = Date.now();
    const ip = c.env?.incoming?.socket?.remoteAddress || "unknown";
    const key = `${ip}:${c.req.path}`;
    let current = requests.get(key);
    if (!current || current.resetsAt <= now) {
      current = { count: 0, resetsAt: now + windowMs };
      requests.set(key, current);
    }
    current.count += 1;
    if (requests.size > 5_000) {
      for (const [entry, item] of requests) {
        if (item.resetsAt <= now) requests.delete(entry);
      }
    }
    if (current.count > maximum) {
      c.header("Retry-After", String(Math.max(1, Math.ceil((current.resetsAt - now) / 1_000))));
      return c.json({ error: "rate_limited", message: "Too many requests. Try again later.", requestId: c.get("requestId") }, 429);
    }
    await next();
  };
}

const jsonBody = <T extends z.ZodTypeAny>(schema: T) =>
  zValidator("json", schema, (result) => {
    if (!result.success) throw new HTTPException(400, { message: "Invalid request body" });
  });

function parseId(raw: string): number {
  if (!/^\d+$/.test(raw)) throw new HTTPException(400, { message: "Invalid resource identifier" });
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HTTPException(400, { message: "Invalid resource identifier" });
  return id;
}

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function parsePagination(query: Record<string, string>) {
  const parsed = paginationSchema.safeParse(query);
  if (!parsed.success) throw new HTTPException(400, { message: "Invalid pagination parameters" });
  return parsed.data;
}

app.use("*", async (c, next) => {
  c.set("requestId", randomUUID());
  const startedAt = Date.now();
  await next();
  c.header("X-Request-Id", c.get("requestId"));
  console.info(JSON.stringify({ requestId: c.get("requestId"), method: c.req.method, status: c.res.status, durationMs: Date.now() - startedAt }));
});
app.use("*", secureHeaders());
app.use("*", bodyLimit({ maxSize: 12 * 1024 * 1024, onError: (c) => c.json({ error: "request_too_large", message: "Request exceeds the allowed size.", requestId: c.get("requestId") }, 413) }));
app.use("*", cors({
  origin: (origin) => (origin && allowedOrigins.has(origin) ? origin : ""),
  credentials: true,
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "X-Request-Id"],
  exposeHeaders: ["X-Request-Id"],
}));
app.use("*", async (c, next) => {
  if (["POST", "PATCH", "PUT", "DELETE"].includes(c.req.method)) {
    const origin = c.req.header("origin");
    if (origin && !allowedOrigins.has(origin)) {
      throw new HTTPException(403, { message: "Request origin is not allowed" });
    }
  }
  await next();
});
app.use("/auth/*", rateLimit(envLimit("RATE_LIMIT_AUTH", 10), envLimit("RATE_LIMIT_AUTH_WINDOW_MS", 900_000)));
app.use("/uploads", rateLimit(envLimit("RATE_LIMIT_UPLOAD", 20), envLimit("RATE_LIMIT_UPLOAD_WINDOW_MS", 60_000)));
app.use("/predict", rateLimit(envLimit("RATE_LIMIT_PREDICT", 30), envLimit("RATE_LIMIT_PREDICT_WINDOW_MS", 60_000)));
app.use("/ai/explanations", rateLimit(envLimit("AI_RATE_LIMIT", 10), envLimit("AI_RATE_LIMIT_WINDOW_MS", 60_000)));

const userView = (user: typeof users.$inferSelect) => ({
  id: user.id,
  email: user.email,
  fullName: user.fullName ?? undefined,
  role: user.role,
  createdAt: user.createdAt,
});

const hashSessionToken = (token: string) => createHash("sha256").update(token).digest("hex");

async function createSession(c: any, userId: number): Promise<string> {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1_000);

  await db.insert(sessions).values({
    id: hashSessionToken(token),
    userId,
    expiresAt,
  });

  const previousToken = getCookie(c, SESSION_COOKIE_NAME);
  if (previousToken && previousToken.length <= 128) {
    await db.delete(sessions).where(eq(sessions.id, hashSessionToken(previousToken)));
  }

  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });
  
  return token;
}

async function validateSession(c: any): Promise<typeof users.$inferSelect | null> {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (!token || token.length > 128) return null;
  const session = await db.query.sessions.findFirst({ where: and(eq(sessions.id, hashSessionToken(token)), sql`${sessions.expiresAt} > NOW()`) });
  if (!session) return null;
  const [user] = await db.select().from(users).where(and(eq(users.id, session.userId), eq(users.isActive, true))).limit(1);
  if (!user) return null;
  c.set("user", user);
  c.set("sessionId", session.id);
  return user;
}

async function requireAuth(c: any, next: () => Promise<void>) {
  const user = await validateSession(c);
  if (!user) {
    throw new HTTPException(401, { message: "Authentication required" });
  }
  await next();
}

async function requireClinician(c: any, next: () => Promise<void>) {
  const user = c.get("user");
  if (!user || (user.role !== "clinician" && user.role !== "admin")) {
    throw new HTTPException(403, { message: "Clinician role required" });
  }
  await next();
}

async function logAudit(c: any, eventType: string, action: string, outcome: "success" | "failure" | "error", resourceType?: string, resourceId?: string, metadata?: Record<string, unknown>) {
  try {
    const user = c.get("user");
    await db.insert(auditEvents).values({
      userId: user?.id,
      eventType,
      resourceType,
      resourceId: resourceId?.toString(),
      action,
      outcome,
      ipAddress: c.env?.incoming?.socket?.remoteAddress,
      userAgent: c.req.header("user-agent")?.slice(0, 500),
      metadata,
    });
  } catch {
    console.error(JSON.stringify({ requestId: c.get("requestId"), event: "audit_write_failed", eventType, action }));
  }
}

const registerSchema = z.object({
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  password: z.string().min(10).max(200),
  fullName: z.string().trim().min(1).max(120).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

app.post("/auth/register", jsonBody(registerSchema), async (c) => {
  const { email, password, fullName } = c.req.valid("json");
  
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) {
    await logAudit(c, "auth", "register", "failure", undefined, undefined, { reason: "account_exists" });
    throw new HTTPException(409, { message: "Unable to create an account with those details" });
  }
  
  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db.insert(users).values({ email, passwordHash, fullName }).returning();
  
  await createSession(c, user.id);
  await logAudit(c, "auth", "register", "success", "user", user.id.toString());
  
  return c.json({ user: userView(user) }, 201);
});

app.post("/auth/login", jsonBody(loginSchema), async (c) => {
  const { email, password } = c.req.valid("json");
  
  const normalizedEmail = email.toLowerCase();
  const user = await db.query.users.findFirst({ where: eq(users.email, normalizedEmail) });
  if (!user || !user.isActive || !await bcrypt.compare(password, user.passwordHash)) {
    await logAudit(c, "auth", "login", "failure", undefined, undefined, { reason: "invalid_credentials" });
    throw new HTTPException(401, { message: "Email or password is incorrect" });
  }
  
  await createSession(c, user.id);
  await logAudit(c, "auth", "login", "success", "user", user.id.toString());
  
  return c.json({ user: userView(user) });
});

app.post("/auth/logout", requireAuth, async (c) => {
  const sessionId = c.get("sessionId");
  await db.delete(sessions).where(eq(sessions.id, sessionId));
  setCookie(c, SESSION_COOKIE_NAME, "", { maxAge: 0, httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" });
  await logAudit(c, "auth", "logout", "success");
  return c.json({ message: "Logged out successfully" });
});

app.get("/auth/me", async (c) => {
  const user = await validateSession(c);
  if (!user) {
    throw new HTTPException(401, { message: "Not authenticated" });
  }
  return c.json({ user: userView(user) });
});

app.get("/healthz", (c) => c.json({ status: "healthy" }));

app.get("/readyz", async (c) => {
  try {
    await db.execute(sql`SELECT 1`);
    return c.json({ status: "ready", checks: { database: true, model: hasApprovedSkinModel(), aiProvider: getAIProviderStatus() } });
  } catch {
    return c.json({ status: "not_ready", checks: { database: false, model: hasApprovedSkinModel(), aiProvider: getAIProviderStatus() } }, 503);
  }
});

const ALLOWED_MIME_FORMATS: Record<string, string> = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" };

app.post("/uploads", requireAuth, async (c) => {
  const user = c.get("user");
  const formData = await c.req.formData();
  const file = formData.get("file");
  const caseIdValue = formData.get("caseId");
  if (!file || !(file instanceof File)) {
    throw new HTTPException(400, { message: "A file is required" });
  }
  if (!ALLOWED_MIME_FORMATS[file.type]) {
    throw new HTTPException(415, { message: "Only JPEG, PNG, and WebP images are allowed" });
  }
  if (file.size <= 0) throw new HTTPException(400, { message: "The image file is empty" });
  if (file.size > MAX_FILE_SIZE) throw new HTTPException(413, { message: "Image exceeds the 10 MB limit" });

  let caseId: number | undefined;
  if (caseIdValue !== null) {
    const parsed = z.coerce.number().int().positive().safeParse(caseIdValue);
    if (!parsed.success) throw new HTTPException(400, { message: "Invalid case identifier" });
    caseId = parsed.data;
    const ownedCase = await db.query.cases.findFirst({ where: and(eq(cases.id, caseId), eq(cases.createdById, user.id)) });
    if (!ownedCase) throw new HTTPException(404, { message: "Case not found" });
  }

  const input = Buffer.from(await file.arrayBuffer());
  let metadata: sharp.Metadata;
  let normalized: Buffer;
  try {
    metadata = await sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error" }).metadata();
    if (metadata.format !== ALLOWED_MIME_FORMATS[file.type]) {
      throw new HTTPException(415, { message: "Image content does not match its declared format" });
    }
    if (!metadata.width || !metadata.height || metadata.width > MAX_IMAGE_DIMENSION || metadata.height > MAX_IMAGE_DIMENSION || metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
      throw new HTTPException(400, { message: "Image dimensions exceed the supported limit" });
    }
    normalized = await sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error" }).rotate().jpeg({ quality: 88 }).toBuffer();
    if (normalized.length > MAX_FILE_SIZE) {
      throw new HTTPException(413, { message: "Normalized image exceeds the 10 MB storage limit" });
    }
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(400, { message: "Image could not be decoded" });
  }

  const storageKey = `${randomUUID()}.jpg`;
  const safeFileName = file.name.replace(/[\\/\u0000-\u001f\u007f]/g, "_").slice(0, 180) || "image.jpg";
  await storage.put(storageKey, normalized);
  try {
    const [upload] = await db.insert(uploads).values({
      userId: user.id,
      caseId,
      storageKey,
      originalFileName: safeFileName,
      mimeType: "image/jpeg",
      sizeBytes: normalized.length,
      width: metadata.width,
      height: metadata.height,
      checksum: createHash("sha256").update(normalized).digest("hex"),
      metadata: { format: "jpeg", colorSpace: metadata.space, orientation: metadata.orientation },
    }).returning();
    await logAudit(c, "upload", "create", "success", "upload", upload.id.toString());
    return c.json({ upload: { id: upload.id, caseId: upload.caseId, originalFileName: upload.originalFileName, mimeType: upload.mimeType, sizeBytes: upload.sizeBytes, width: upload.width, height: upload.height, createdAt: upload.createdAt } }, 201);
  } catch (error) {
    await storage.delete(storageKey);
    throw error;
  }
});

const predictSchema = z.object({
  uploadId: z.number().int().positive(),
});

function predictionView(prediction: typeof predictions.$inferSelect) {
  const provenanceVerified = prediction.status !== "legacy_unverified" && prediction.scoreSemantics !== "unverified";
  return {
    id: prediction.id,
    disease: provenanceVerified ? prediction.disease : "Unverified legacy record",
    confidence: provenanceVerified ? prediction.confidence : 0,
    description: provenanceVerified ? prediction.description : "Model provenance was not recorded; stored output is suppressed.",
    severity: provenanceVerified ? prediction.severity : "unassessed",
    recommendations: provenanceVerified ? prediction.recommendations : [],
    differentialDiagnoses: provenanceVerified ? prediction.differentialDiagnoses : [],
    preprocessingSteps: provenanceVerified ? prediction.preprocessingSteps : [],
    modelId: prediction.modelId,
    modelVersion: prediction.modelVersion,
    scoreSemantics: prediction.scoreSemantics,
    preprocessingVersion: prediction.preprocessingVersion,
    status: prediction.status,
    fileName: prediction.fileName,
    createdAt: prediction.createdAt,
  };
}

app.delete("/uploads/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  const upload = await db.query.uploads.findFirst({ where: and(eq(uploads.id, id), eq(uploads.userId, user.id)) });
  if (!upload) throw new HTTPException(404, { message: "Upload not found" });
  const linkedPrediction = await db.query.predictions.findFirst({ where: eq(predictions.uploadId, id) });
  if (linkedPrediction) throw new HTTPException(409, { message: "Upload is linked to a saved prediction" });
  await storage.delete(upload.storageKey);
  await db.delete(uploads).where(and(eq(uploads.id, id), eq(uploads.userId, user.id)));
  await logAudit(c, "upload", "delete", "success", "upload", id.toString());
  return c.body(null, 204);
});

app.post("/predict", requireAuth, jsonBody(predictSchema), async (c) => {
  const user = c.get("user");
  const { uploadId } = c.req.valid("json");
  const upload = await db.query.uploads.findFirst({ where: and(eq(uploads.id, uploadId), eq(uploads.userId, user.id)) });
  if (!upload) throw new HTTPException(404, { message: "Upload not found" });

  const provider = getTestInferenceProvider();
  if (!provider) {
    await logAudit(c, "prediction", "create", "failure", "upload", upload.id.toString(), { reason: "model_unavailable" });
    throw new HTTPException(503, { message: "Skin analysis is unavailable because no approved model is configured" });
  }

  let output;
  try {
    output = await provider.predict(await storage.read(upload.storageKey));
  } catch {
    await logAudit(c, "prediction", "create", "error", "upload", upload.id.toString(), { reason: "inference_failed" });
    throw new HTTPException(500, { message: "Skin analysis could not be completed" });
  }
  const status = provider.simulated ? "simulated" : "completed";
  const [prediction] = await db.insert(predictions).values({
    disease: output.disease,
    confidence: output.confidence,
    description: output.description,
    severity: "unassessed",
    recommendations: output.recommendations,
    differentialDiagnoses: output.differentialDiagnoses,
    preprocessingSteps: output.preprocessingSteps,
    status,
    modelId: output.modelId,
    modelVersion: output.modelVersion,
    scoreSemantics: provider.simulated ? "simulated" : output.scoreSemantics,
    preprocessingVersion: output.preprocessingVersion,
    uploadId,
    fileName: upload.originalFileName,
    userId: user.id,
  }).returning();
  await logAudit(c, "prediction", "create", "success", "prediction", prediction.id.toString(), { status });
  return c.json(predictionView(prediction), 201);
});

app.get("/predictions", requireAuth, async (c) => {
  const user = c.get("user");
  const { page, limit } = parsePagination(c.req.query());
  const offset = (page - 1) * limit;
  
  const [preds, totalResult] = await Promise.all([
    db.query.predictions.findMany({
      where: eq(predictions.userId, user.id),
      orderBy: [desc(predictions.createdAt)],
      limit,
      offset,
    }),
    db.select({ count: count() }).from(predictions).where(eq(predictions.userId, user.id)),
  ]);
  
  return c.json({
    predictions: preds.map(predictionView),
    total: totalResult[0]?.count || 0,
    page,
    limit,
  });
});

app.get("/predictions/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  
  const pred = await db.query.predictions.findFirst({
    where: and(eq(predictions.id, id), eq(predictions.userId, user.id)),
  });
  
  if (!pred) {
    throw new HTTPException(404, { message: "Prediction not found" });
  }
  
  return c.json(predictionView(pred));
});

const explanationRequestSchema = z.object({
  predictionId: z.number().int().positive(),
  consentToExternalProcessing: z.boolean(),
});

function codedError(status: 400 | 409 | 429 | 503, code: string, message: string): HTTPException {
  const error = new HTTPException(status, { message }) as HTTPException & { apiCode?: string };
  error.apiCode = code;
  return error;
}

app.post("/ai/explanations", requireAuth, jsonBody(explanationRequestSchema), async (c) => {
  const user = c.get("user");
  const request = c.req.valid("json");
  if (!request.consentToExternalProcessing) {
    throw codedError(400, "external_data_consent_required", "Explicit consent is required before external processing.");
  }
  const prediction = await db.query.predictions.findFirst({
    where: and(eq(predictions.id, request.predictionId), eq(predictions.userId, user.id)),
  });
  if (!prediction) throw new HTTPException(404, { message: "Prediction not found" });
  if (prediction.status !== "completed" || !["raw_model_score", "calibrated_probability"].includes(prediction.scoreSemantics) || !prediction.modelId || !prediction.modelVersion) {
    throw codedError(409, "prediction_not_eligible", "Only verified, completed model outputs can receive an explanation.");
  }
  if (!hasApprovedSkinModel()) {
    await logAudit(c, "ai_explanation", "generate", "failure", undefined, undefined, { reason: "model_unavailable" });
    throw codedError(503, "model_unavailable", "No approved skin model is configured for this application.");
  }
  if (!externalHealthDataTransferEnabled()) {
    await logAudit(c, "ai_explanation", "generate", "failure", undefined, undefined, { reason: "external_processing_disabled" });
    throw codedError(503, "external_processing_disabled", "External health-data processing is disabled by server configuration.");
  }
  const configured = configuredExplanationProvider();
  if (!configured.provider) {
    await logAudit(c, "ai_explanation", "generate", "failure", undefined, undefined, { reason: "provider_unavailable" });
    throw codedError(503, "provider_unavailable", "The configured explanation provider is unavailable.");
  }
  try {
    const candidates = [
      { label: prediction.disease, score: prediction.confidence },
      ...prediction.differentialDiagnoses.map((candidate) => ({ label: candidate.disease, score: candidate.confidence })),
    ];
    const explanation = await configured.provider.explain({
      modelId: prediction.modelId,
      modelVersion: prediction.modelVersion,
      scoreSemantics: prediction.scoreSemantics as "raw_model_score" | "calibrated_probability",
      candidates,
    });
    await logAudit(c, "ai_explanation", "generate", "success", undefined, undefined, { provider: explanation.provider, providerModel: explanation.model });
    return c.json({
      prediction: predictionView(prediction),
      explanation: { provider: explanation.provider, model: explanation.model, text: explanation.explanation, generatedAt: new Date().toISOString() },
      notice: "Provider-generated educational text may be incomplete or inaccurate. It is not a diagnosis or treatment advice.",
      scoreNotice: prediction.scoreSemantics === "raw_model_score"
        ? "These are raw model scores, not calibrated probabilities or an individual's disease likelihood."
        : "These are calibrated model outputs on evaluation data, not an individual's real-world disease likelihood.",
    });
  } catch (error) {
    const code = error instanceof AIProviderError ? error.code : "provider_unavailable";
    const outcome = code === "provider_rate_limited" ? "failure" : "error";
    await logAudit(c, "ai_explanation", "generate", outcome, undefined, undefined, { reason: code });
    if (code === "provider_rate_limited") throw codedError(429, "provider_rate_limited", "The explanation provider is rate limited. Try again later.");
    throw codedError(503, "provider_unavailable", "The explanation provider could not complete this request.");
  }
});

const createPatientSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  dateOfBirth: z.string().date().optional(),
  sex: z.enum(["male", "female", "other"]).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().email().max(254).optional(),
  address: z.object({ street: z.string().max(200).optional(), city: z.string().max(100).optional(), state: z.string().max(100).optional(), postalCode: z.string().max(30).optional(), country: z.string().max(100).optional() }).optional(),
  medicalHistory: z.array(z.string().max(500)).max(50).default([]),
  allergies: z.array(z.string().max(300)).max(50).default([]),
  medications: z.array(z.string().max(300)).max(100).default([]),
  notes: z.string().max(5_000).optional(),
});

const updatePatientSchema = createPatientSchema.partial();

app.get("/patients", requireAuth, async (c) => {
  const user = c.get("user");
  const { page, limit } = parsePagination(c.req.query());
  const searchResult = z.string().trim().max(100).optional().safeParse(c.req.query("search"));
  if (!searchResult.success) throw new HTTPException(400, { message: "Invalid patient search" });
  const search = searchResult.data;
  const offset = (page - 1) * limit;
  
  let whereClause = and(eq(patients.userId, user.id), isNull(patients.archivedAt))!;
  if (search) {
    whereClause = and(whereClause, or(
      ilike(patients.firstName, `%${search}%`),
      ilike(patients.lastName, `%${search}%`),
      ilike(patients.email, `%${search}%`)
    ))!;
  }
  
  const [pts, totalResult] = await Promise.all([
    db.query.patients.findMany({ where: whereClause, orderBy: [desc(patients.createdAt)], limit, offset }),
    db.select({ count: count() }).from(patients).where(whereClause),
  ]);
  
  return c.json({ patients: pts, total: totalResult[0]?.count || 0, page, limit });
});

app.post("/patients", requireAuth, jsonBody(createPatientSchema), async (c) => {
  const user = c.get("user");
  const data = c.req.valid("json");
  
  const [patient] = await db.insert(patients).values({ ...data, userId: user.id }).returning();
  await logAudit(c, "patient", "create", "success", "patient", patient.id.toString());
  
  return c.json({ patient }, 201);
});

app.get("/patients/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  
  const patient = await db.query.patients.findFirst({ where: and(eq(patients.id, id), eq(patients.userId, user.id), isNull(patients.archivedAt)) });
  if (!patient) throw new HTTPException(404, { message: "Patient not found" });
  
  return c.json({ patient });
});

app.patch("/patients/:id", requireAuth, jsonBody(updatePatientSchema), async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  const data = c.req.valid("json");
  
  const [patient] = await db.update(patients).set({ ...data, updatedAt: new Date() }).where(and(eq(patients.id, id), eq(patients.userId, user.id), isNull(patients.archivedAt))).returning();
  if (!patient) throw new HTTPException(404, { message: "Patient not found" });
  
  await logAudit(c, "patient", "update", "success", "patient", patient.id.toString());
  return c.json({ patient });
});

app.delete("/patients/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  const [patient] = await db.update(patients).set({ archivedAt: new Date(), updatedAt: new Date() }).where(and(eq(patients.id, id), eq(patients.userId, user.id), isNull(patients.archivedAt))).returning({ id: patients.id });
  if (!patient) throw new HTTPException(404, { message: "Patient not found" });
  
  await logAudit(c, "patient", "archive", "success", "patient", id.toString());
  return c.body(null, 204);
});

const createCaseSchema = z.object({
  patientId: z.number().int().positive(),
  type: z.enum(["skin_analysis", "symptom_assessment", "follow_up", "consultation"]),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  chiefComplaint: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

const updateCaseSchema = z.object({
  status: z.enum(["open", "in_review", "closed", "on_hold"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  chiefComplaint: z.string().max(2_000).optional(),
  tags: z.array(z.string().max(100)).max(30).optional(),
});

app.get("/cases", requireAuth, async (c) => {
  const user = c.get("user");
  const { page, limit } = parsePagination(c.req.query());
  const filters = z.object({ status: z.enum(["open", "in_review", "closed", "on_hold"]).optional(), patientId: z.coerce.number().int().positive().optional() }).safeParse(c.req.query());
  if (!filters.success) throw new HTTPException(400, { message: "Invalid case filters" });
  const { status, patientId } = filters.data;
  const offset = (page - 1) * limit;
  
  let whereClause = eq(cases.createdById, user.id);
  if (status) whereClause = and(whereClause, eq(cases.status, status as typeof cases.status.enumValues[number]))!;
  if (patientId) whereClause = and(whereClause, eq(cases.patientId, patientId))!;
  
  const [cs, totalResult] = await Promise.all([
    db.query.cases.findMany({ where: whereClause, orderBy: [desc(cases.createdAt)], limit, offset }),
    db.select({ count: count() }).from(cases).where(whereClause),
  ]);
  
  return c.json({ cases: cs, total: totalResult[0]?.count || 0, page, limit });
});

app.post("/cases", requireAuth, jsonBody(createCaseSchema), async (c) => {
  const user = c.get("user");
  const data = c.req.valid("json");
  
  const patient = await db.query.patients.findFirst({ where: and(eq(patients.id, data.patientId), eq(patients.userId, user.id), isNull(patients.archivedAt)) });
  if (!patient) throw new HTTPException(404, { message: "Patient not found or access denied" });
  
  const caseNumber = `CS-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
  
  const [newCase] = await db.insert(cases).values({ ...data, createdById: user.id, caseNumber }).returning();
  await logAudit(c, "case", "create", "success", "case", newCase.id.toString(), { caseNumber });
  
  return c.json({ case: newCase }, 201);
});

app.get("/cases/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  
  const caseData = await db.query.cases.findFirst({ where: and(eq(cases.id, id), eq(cases.createdById, user.id)) });
  if (!caseData) throw new HTTPException(404, { message: "Case not found" });
  
  return c.json({ case: caseData });
});

app.patch("/cases/:id", requireAuth, jsonBody(updateCaseSchema), async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  const data = c.req.valid("json");
  
  const updateData: Record<string, unknown> = { ...data, updatedAt: new Date() };
  if (data.status === "closed") updateData.closedAt = new Date();
  if (data.status && data.status !== "closed") updateData.closedAt = null;
  
  const [updatedCase] = await db.update(cases).set(updateData).where(and(eq(cases.id, id), eq(cases.createdById, user.id))).returning();
  if (!updatedCase) throw new HTTPException(404, { message: "Case not found" });
  
  await logAudit(c, "case", "update", "success", "case", updatedCase.id.toString(), { changedFields: Object.keys(data) });
  return c.json({ case: updatedCase });
});

const createSymptomAssessmentSchema = z.object({
  caseId: z.number().int().positive().optional(),
  primarySymptom: z.string().trim().min(1).max(1_000),
  symptomCategory: z.enum(["skin", "general", "neurological", "cardiovascular", "respiratory", "gastrointestinal", "musculoskeletal", "psychiatric", "other"]),
  onset: z.string().max(200).optional(),
  duration: z.string().max(200).optional(),
  severity: z.enum(["mild", "moderate", "severe"]).optional(),
  progression: z.enum(["improving", "stable", "worsening", "fluctuating"]).optional(),
  associatedSymptoms: z.array(z.string().max(300)).max(30).default([]),
  medicalHistory: z.array(z.string().max(300)).max(50).default([]),
  medications: z.array(z.string().max(300)).max(100).default([]),
  allergies: z.array(z.string().max(300)).max(50).default([]),
});

const RED_FLAG_SYMPTOMS = [
  "chest pain", "difficulty breathing", "shortness of breath", "severe headache", "loss of consciousness",
  "fainting", "uncontrolled bleeding", "stroke", "face drooping", "arm weakness", "speech difficulty",
  "severe allergic reaction", "anaphylaxis", "high fever", "stiff neck", "sudden vision loss",
  "suicidal", "self-harm", "self harm"
];

function assessUrgency(data: z.infer<typeof createSymptomAssessmentSchema>): { urgency: "emergency" | "urgent" | "routine"; redFlags: string[]; guidance: { recommendations: string[]; disclaimer: string } } {
  const reportedText = [data.primarySymptom, ...data.associatedSymptoms].join(" ").toLowerCase();
  const triggeredFlags = RED_FLAG_SYMPTOMS.filter((flag) => reportedText.includes(flag));
  const higherRiskCategory = ["cardiovascular", "respiratory", "neurological"].includes(data.symptomCategory);
  const urgency: "emergency" | "urgent" | "routine" = triggeredFlags.length > 0
    ? "emergency"
    : higherRiskCategory || data.severity === "severe" || data.severity === "moderate" || data.progression === "worsening"
      ? "urgent"
      : "routine";
  const recommendations = urgency === "emergency"
    ? ["Your answers matched a listed warning symptom. Seek emergency medical care now or contact local emergency services."]
    : urgency === "urgent"
      ? ["Arrange prompt assessment by a qualified healthcare professional. This rule set cannot determine the cause or safely rule out urgent conditions."]
      : ["Arrange professional assessment if symptoms persist, change, or concern you. This rule set cannot determine the cause or rule out a serious condition."];
  recommendations.push("This result is generated by a small, transparent rule set from the information entered; it is not a diagnosis or medical advice.");
  return { urgency, redFlags: triggeredFlags, guidance: { recommendations, disclaimer: "Research and educational prototype; not clinically validated." } };
}

app.get("/symptom-assessments", requireAuth, async (c) => {
  const user = c.get("user");
  const { page, limit } = parsePagination(c.req.query());
  const offset = (page - 1) * limit;
  const [items, totalResult] = await Promise.all([
    db.query.symptomAssessments.findMany({ where: eq(symptomAssessments.userId, user.id), orderBy: [desc(symptomAssessments.createdAt)], limit, offset }),
    db.select({ count: count() }).from(symptomAssessments).where(eq(symptomAssessments.userId, user.id)),
  ]);
  return c.json({ assessments: items, total: totalResult[0]?.count || 0, page, limit });
});

app.post("/symptom-assessments", requireAuth, jsonBody(createSymptomAssessmentSchema), async (c) => {
  const user = c.get("user");
  const data = c.req.valid("json");
  
  if (data.caseId) {
    const caseData = await db.query.cases.findFirst({ where: and(eq(cases.id, data.caseId), eq(cases.createdById, user.id)) });
    if (!caseData) throw new HTTPException(404, { message: "Case not found" });
  }
  
  const { urgency, redFlags, guidance } = assessUrgency(data);
  
  const [assessment] = await db.insert(symptomAssessments).values({
    ...data,
    userId: user.id,
    redFlagsTriggered: redFlags,
    urgencyLevel: urgency,
    guidance,
  }).returning();
  
  await logAudit(c, "symptom_assessment", "create", "success", "symptom_assessment", assessment.id.toString(), { urgency });
  
  return c.json({ assessment }, 201);
});

app.get("/symptom-assessments/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  
  const assessment = await db.query.symptomAssessments.findFirst({ where: and(eq(symptomAssessments.id, id), eq(symptomAssessments.userId, user.id)) });
  if (!assessment) throw new HTTPException(404, { message: "Symptom assessment not found" });
  
  return c.json({ assessment });
});

const createReviewSchema = z.object({
  predictionId: z.number().int().positive(),
  status: z.enum(["pending", "reviewed", "accepted", "modified", "rejected", "needs_more_information"]),
  reviewedOutput: z.record(z.unknown()).optional(),
  rationale: z.string().trim().max(3_000).optional(),
});

const updateReviewSchema = z.object({
  status: z.enum(["pending", "reviewed", "accepted", "modified", "rejected", "needs_more_information"]).optional(),
  reviewedOutput: z.record(z.unknown()).optional(),
  rationale: z.string().trim().max(3_000).optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one review field is required");

app.post("/reviews", requireAuth, requireClinician, jsonBody(createReviewSchema), async (c) => {
  const user = c.get("user");
  const data = c.req.valid("json");
  
  const prediction = await db.query.predictions.findFirst({ where: and(eq(predictions.id, data.predictionId), eq(predictions.userId, user.id)) });
  if (!prediction) throw new HTTPException(404, { message: "Prediction not found" });
  
  const existing = await db.query.reviews.findFirst({ where: eq(reviews.predictionId, data.predictionId) });
  if (existing) throw new HTTPException(400, { message: "Review already exists for this prediction" });
  
  const [review] = await db.insert(reviews).values({
    ...data,
    reviewerId: user.id,
    originalOutput: predictionView(prediction),
    reviewedAt: ["reviewed", "accepted", "modified", "rejected"].includes(data.status) ? new Date() : null,
  }).returning();
  
  await logAudit(c, "review", "create", "success", "review", review.id.toString(), { predictionId: data.predictionId, status: data.status });
  return c.json({ review }, 201);
});

app.get("/reviews/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));

  const review = await db.query.reviews.findFirst({ where: eq(reviews.id, id) });
  if (!review) throw new HTTPException(404, { message: "Review not found" });

  const prediction = await db.query.predictions.findFirst({ where: eq(predictions.id, review.predictionId) });
  if (!prediction) throw new HTTPException(404, { message: "Prediction not found" });

  if (prediction.userId !== user.id && review.reviewerId !== user.id) throw new HTTPException(404, { message: "Review not found" });

  return c.json({ review, prediction: predictionView(prediction) });
});

app.patch("/reviews/:id", requireAuth, requireClinician, jsonBody(updateReviewSchema), async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  const data = c.req.valid("json");
  
  const updateData: Record<string, unknown> = { ...data };
  if (data.status && data.status !== "pending") {
    updateData.reviewedAt = new Date();
  }
  
  const [review] = await db.update(reviews).set(updateData).where(and(eq(reviews.id, id), eq(reviews.reviewerId, user.id))).returning();
  if (!review) throw new HTTPException(404, { message: "Review not found" });
  
  await logAudit(c, "review", "update", "success", "review", review.id.toString(), { status: data.status });
  return c.json({ review });
});

const createReportSchema = z.object({
  caseId: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  type: z.enum(["skin_analysis", "symptom_assessment", "comprehensive", "follow_up"]),
  predictionIds: z.array(z.number().int().positive()).max(100).default([]),
}).refine((value) => new Set(value.predictionIds).size === value.predictionIds.length, "Prediction identifiers must be unique");

const reportFilterSchema = z.object({
  status: z.enum(["draft", "finalized", "archived", "amended"]).optional(),
  caseId: z.coerce.number().int().positive().optional(),
});

const updateReportSchema = z.object({
  status: z.literal("archived"),
});

app.get("/reports", requireAuth, async (c) => {
  const user = c.get("user");
  const { page, limit } = parsePagination(c.req.query());
  const filters = reportFilterSchema.safeParse(c.req.query());
  if (!filters.success) throw new HTTPException(400, { message: "Invalid report filters" });
  const { status, caseId } = filters.data;
  const offset = (page - 1) * limit;
  
  let whereClause = eq(reports.authorId, user.id);
  if (status) whereClause = and(whereClause, eq(reports.status, status as typeof reports.status.enumValues[number]))!;
  if (caseId) whereClause = and(whereClause, eq(reports.caseId, caseId))!;
  
  const [rpts, totalResult] = await Promise.all([
    db.query.reports.findMany({ where: whereClause, orderBy: [desc(reports.createdAt)], limit, offset }),
    db.select({ count: count() }).from(reports).where(whereClause),
  ]);
  
  return c.json({ reports: rpts, total: totalResult[0]?.count || 0, page, limit });
});

app.post("/reports", requireAuth, jsonBody(createReportSchema), async (c) => {
  const user = c.get("user");
  const data = c.req.valid("json");
  
  const caseData = await db.query.cases.findFirst({ where: and(eq(cases.id, data.caseId), eq(cases.createdById, user.id)) });
  if (!caseData) throw new HTTPException(404, { message: "Case not found" });
  const patient = await db.query.patients.findFirst({ where: and(eq(patients.id, caseData.patientId), eq(patients.userId, user.id)) });
  if (!patient) throw new HTTPException(404, { message: "Case not found" });

  let modelOutputs: ReturnType<typeof predictionView>[] = [];
  if (data.predictionIds.length > 0) {
    const selected = await db.select({ prediction: predictions })
      .from(predictions)
      .innerJoin(uploads, eq(predictions.uploadId, uploads.id))
      .where(and(inArray(predictions.id, data.predictionIds), eq(predictions.userId, user.id), eq(uploads.userId, user.id), eq(uploads.caseId, data.caseId)));
    if (selected.length !== data.predictionIds.length) throw new HTTPException(404, { message: "One or more predictions are not available for this case" });
    modelOutputs = selected.map(({ prediction }) => predictionView(prediction));
  }

  const assessmentRows = await db.query.symptomAssessments.findMany({ where: and(eq(symptomAssessments.caseId, data.caseId), eq(symptomAssessments.userId, user.id)), orderBy: [desc(symptomAssessments.createdAt)] });
  const reportNumber = `RPT-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const content = {
    source: "persisted_authorized_records",
    generatedAt: new Date().toISOString(),
    case: { id: caseData.id, caseNumber: caseData.caseNumber, type: caseData.type, status: caseData.status, priority: caseData.priority, chiefComplaint: caseData.chiefComplaint },
    patient: { id: patient.id, name: `${patient.firstName} ${patient.lastName}` },
    symptomAssessments: assessmentRows,
    modelOutputs,
    limitations: ["Draft assembled from saved application records.", "Not a diagnosis or treatment recommendation.", "Requires review by an appropriately qualified professional before any clinical use."],
  };
  const [report] = await db.insert(reports).values({ ...data, content, authorId: user.id, reportNumber, status: "draft" }).returning();
  await logAudit(c, "report", "create", "success", "report", report.id.toString());
  
  return c.json({ report }, 201);
});

app.get("/reports/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  
  const report = await db.query.reports.findFirst({ where: and(eq(reports.id, id), eq(reports.authorId, user.id)) });
  if (!report) throw new HTTPException(404, { message: "Report not found" });
  return c.json({ report });
});

app.patch("/reports/:id", requireAuth, jsonBody(updateReportSchema), async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  const data = c.req.valid("json");
  const [report] = await db.update(reports).set({ status: data.status, updatedAt: new Date() }).where(and(eq(reports.id, id), eq(reports.authorId, user.id), eq(reports.status, "draft"))).returning();
  if (!report) throw new HTTPException(404, { message: "Report not found" });
  await logAudit(c, "report", "archive", "success", "report", report.id.toString());
  return c.json({ report });
});

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    const error = (err as HTTPException & { apiCode?: string }).apiCode ?? (err.status === 401 ? "unauthorized" : err.status === 403 ? "forbidden" : err.status === 404 ? "not_found" : err.status === 409 ? "conflict" : err.status === 413 ? "request_too_large" : err.status === 415 ? "unsupported_media_type" : err.status === 429 ? "rate_limited" : err.status === 503 ? "model_unavailable" : "request_failed");
    return c.json({ error, message: err.message, requestId: c.get("requestId") }, err.status);
  }
  console.error(JSON.stringify({ requestId: c.get("requestId"), error: "unhandled_request_error" }));
  return c.json({ error: "internal_error", message: "An unexpected error occurred", requestId: c.get("requestId") }, 500);
});

app.notFound((c) => c.json({ error: "not_found", message: "Route not found", requestId: c.get("requestId") }, 404));

const root = new Hono();
root.route("/api", app);
root.notFound((c) => {
  const requestId = (c as any).get("requestId") as string | undefined ?? randomUUID();
  c.header("X-Request-Id", requestId);
  return c.json({ error: "not_found", message: "Route not found", requestId }, 404);
});

export default root;

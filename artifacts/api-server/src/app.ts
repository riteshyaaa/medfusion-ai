import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@workspace/db";
import { users, sessions, patients, cases, uploads, predictions, symptomAssessments, reviews, reports, auditEvents } from "@workspace/db/schema";
import { eq, desc, and, or, ilike, count, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { getCookie, setCookie } from "hono/cookie";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import path from "path";
import fs from "fs/promises";
import sharp from "sharp";

type Bindings = {
  DATABASE_URL: string;
  SESSION_SECRET: string;
  UPLOAD_DIR: string;
  CORS_ORIGINS: string;
  RATE_LIMIT_AUTH: string;
  RATE_LIMIT_AUTH_WINDOW_MS: string;
  RATE_LIMIT_UPLOAD: string;
  RATE_LIMIT_UPLOAD_WINDOW_MS: string;
  RATE_LIMIT_PREDICT: string;
  RATE_LIMIT_PREDICT_WINDOW_MS: string;
};

type Variables = {
  user: typeof users.$inferSelect;
  sessionId: string;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use("*", logger());
app.use("*", secureHeaders());
app.use("*", cors({
  origin: (origin, c) => {
    const allowedOrigins = c.env.CORS_ORIGINS?.split(",") || ["http://localhost:3000", "http://localhost:5173"];
    if (!origin || allowedOrigins.includes(origin)) {
      return origin;
    }
    return allowedOrigins[0];
  },
  credentials: true,
}));


const SESSION_COOKIE_NAME = "session_id";
const SESSION_TTL_DAYS = 30;

async function createSession(c: any, userId: number): Promise<string> {
  const sessionId = uuidv4();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  
  await db.insert(sessions).values({
    id: sessionId,
    userId,
    expiresAt,
  });
  
  setCookie(c, SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
    path: "/",
  });
  
  return sessionId;
}

async function validateSession(c: any): Promise<typeof users.$inferSelect | null> {
  const sessionId = getCookie(c, SESSION_COOKIE_NAME);
  if (!sessionId) return null;

  const session = await db.query.sessions.findFirst({
    where: and(eq(sessions.id, sessionId), sql`${sessions.expiresAt} > NOW()`),
    with: {
      user: {
        columns: {
          id: true,
          email: true,
          passwordHash: true,
          fullName: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!session?.user) {
    return null;
  }

  c.set("user", session.user);
  c.set("sessionId", sessionId);
  return session.user;
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
  const user = c.get("user");
  await db.insert(auditEvents).values({
    userId: user?.id,
    eventType,
    resourceType,
    resourceId: resourceId?.toString(),
    action,
    outcome,
    ipAddress: c.req.header("x-forwarded-for") || c.req.header("x-real-ip"),
    userAgent: c.req.header("user-agent"),
    metadata,
  });
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

app.post("/auth/register", zValidator("json", registerSchema), async (c) => {
  const { email, password, fullName } = c.req.valid("json");
  
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) {
    await logAudit(c, "auth", "register", "failure", undefined, undefined, { email, reason: "email_exists" });
    throw new HTTPException(409, { message: "Email already registered" });
  }
  
  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db.insert(users).values({ email, passwordHash, fullName }).returning();
  
  await createSession(c, user.id);
  await logAudit(c, "auth", "register", "success", "user", user.id.toString());
  
  return c.json({ user: { ...user, passwordHash: undefined }, sessionId: getCookie(c, SESSION_COOKIE_NAME) }, 201);
});

app.post("/auth/login", zValidator("json", loginSchema), async (c) => {
  const { email, password } = c.req.valid("json");
  
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user || !await bcrypt.compare(password, user.passwordHash)) {
    await logAudit(c, "auth", "login", "failure", undefined, undefined, { email, reason: "invalid_credentials" });
    throw new HTTPException(401, { message: "Invalid credentials" });
  }
  
  if (!user.isActive) {
    await logAudit(c, "auth", "login", "failure", "user", user.id.toString(), { reason: "account_inactive" });
    throw new HTTPException(401, { message: "Account is inactive" });
  }
  
  await createSession(c, user.id);
  await logAudit(c, "auth", "login", "success", "user", user.id.toString());
  
  return c.json({ user: { ...user, passwordHash: undefined }, sessionId: getCookie(c, SESSION_COOKIE_NAME) });
});

app.post("/auth/logout", async (c) => {
  const sessionId = getCookie(c, SESSION_COOKIE_NAME);
  if (sessionId) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    setCookie(c, SESSION_COOKIE_NAME, "", { maxAge: 0, path: "/" });
  }
  await logAudit(c, "auth", "logout", "success");
  return c.json({ message: "Logged out successfully" });
});

app.get("/auth/me", async (c) => {
  const user = await validateSession(c);
  if (!user) {
    throw new HTTPException(401, { message: "Not authenticated" });
  }
  return c.json({ user: { ...user, passwordHash: undefined } });
});

app.get("/healthz", (c) => c.json({ status: "healthy" }));

app.get("/readyz", async (c) => {
  try {
    await db.execute(sql`SELECT 1`);
    return c.json({ status: "ready", checks: { database: true, model: false } });
  } catch {
    return c.json({ status: "not_ready", checks: { database: false, model: false } }, 503);
  }
});

const uploadDir = process.env.UPLOAD_DIR || "./uploads";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

async function validateImageFile(file: File): Promise<{ valid: boolean; error?: string; metadata?: { width: number; height: number; format: string } }> {
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return { valid: false, error: "Unsupported file type. Allowed: JPEG, PNG, WebP" };
  }
  
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: `File too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB` };
  }
  
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return { valid: false, error: "Invalid file extension" };
  }
  
  try {
    const metadata = await sharp(buffer).metadata();
    if (!metadata.width || !metadata.height) {
      return { valid: false, error: "Invalid image dimensions" };
    }
    return { valid: true, metadata: { width: metadata.width, height: metadata.height, format: metadata.format || "unknown" } };
  } catch {
    return { valid: false, error: "Invalid or corrupted image file" };
  }
}

app.post("/uploads", requireAuth, async (c) => {
  const user = c.get("user");
  const formData = await c.req.formData();
  const file = formData.get("file") as File;
  const caseId = formData.get("caseId") ? parseInt(formData.get("caseId") as string, 10) : undefined;
  
  if (!file || !(file instanceof File)) {
    await logAudit(c, "upload", "upload", "failure", undefined, undefined, { reason: "no_file" });
    throw new HTTPException(400, { message: "No file provided" });
  }
  
  const validation = await validateImageFile(file);
  if (!validation.valid) {
    await logAudit(c, "upload", "upload", "failure", undefined, undefined, { reason: validation.error });
    throw new HTTPException(400, { message: validation.error });
  }
  
  const storageKey = `${user.id}/${uuidv4()}${path.extname(file.name).toLowerCase()}`;
  const fullPath = path.join(uploadDir, storageKey);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(fullPath, buffer);
  
  const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
  
  const [upload] = await db.insert(uploads).values({
    userId: user.id,
    caseId,
    storageKey,
    originalFileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    width: validation.metadata?.width,
    height: validation.metadata?.height,
    checksum,
    metadata: { format: validation.metadata?.format },
  }).returning();
  
  await logAudit(c, "upload", "upload", "success", "upload", upload.id.toString(), { fileName: file.name, size: file.size });
  
  return c.json({ upload }, 201);
});

const predictSchema = z.object({
  imageBase64: z.string().min(1),
  imageUrl: z.string().url().optional(),
  fileName: z.string().optional(),
});

app.post("/predict", requireAuth, zValidator("json", predictSchema), async (c) => {
  const { imageBase64 } = c.req.valid("json");

  if (!imageBase64 || !imageBase64.startsWith("data:image/")) {
    throw new HTTPException(400, { message: "Invalid image data. Must be base64 data URL." });
  }
  
  await logAudit(c, "prediction", "predict", "failure", undefined, undefined, { reason: "model_unavailable" });
  
  return c.json({
    error: "model_unavailable",
    message: "Skin analysis model is not currently available. Please try again later."
  }, 503);
});

app.get("/predictions", requireAuth, async (c) => {
  const user = c.get("user");
  const page = parseInt(c.req.query("page") || "1", 10);
  const limit = Math.min(parseInt(c.req.query("limit") || "20", 10), 100);
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
    predictions: preds,
    total: totalResult[0]?.count || 0,
    page,
    limit,
  });
});

app.get("/predictions/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = parseInt(c.req.param("id"), 10);
  
  const pred = await db.query.predictions.findFirst({
    where: and(eq(predictions.id, id), eq(predictions.userId, user.id)),
  });
  
  if (!pred) {
    throw new HTTPException(404, { message: "Prediction not found" });
  }
  
  return c.json(pred);
});

const createPatientSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dateOfBirth: z.string().date().optional(),
  sex: z.enum(["male", "female", "other"]).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z.object({ street: z.string().optional(), city: z.string().optional(), state: z.string().optional(), postalCode: z.string().optional(), country: z.string().optional() }).optional(),
  medicalHistory: z.array(z.string()).default([]),
  allergies: z.array(z.string()).default([]),
  medications: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

const updatePatientSchema = createPatientSchema.partial();

app.get("/patients", requireAuth, async (c) => {
  const user = c.get("user");
  const page = parseInt(c.req.query("page") || "1", 10);
  const limit = Math.min(parseInt(c.req.query("limit") || "20", 10), 100);
  const search = c.req.query("search");
  const offset = (page - 1) * limit;
  
  let whereClause = eq(patients.userId, user.id);
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

app.post("/patients", requireAuth, zValidator("json", createPatientSchema), async (c) => {
  const user = c.get("user");
  const data = c.req.valid("json");
  
  const [patient] = await db.insert(patients).values({ ...data, userId: user.id }).returning();
  await logAudit(c, "patient", "create", "success", "patient", patient.id.toString());
  
  return c.json({ patient }, 201);
});

app.get("/patients/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = parseInt(c.req.param("id"), 10);
  
  const patient = await db.query.patients.findFirst({ where: and(eq(patients.id, id), eq(patients.userId, user.id)) });
  if (!patient) throw new HTTPException(404, { message: "Patient not found" });
  
  return c.json({ patient });
});

app.patch("/patients/:id", requireAuth, zValidator("json", updatePatientSchema), async (c) => {
  const user = c.get("user");
  const id = parseInt(c.req.param("id"), 10);
  const data = c.req.valid("json");
  
  const [patient] = await db.update(patients).set({ ...data, updatedAt: new Date() }).where(and(eq(patients.id, id), eq(patients.userId, user.id))).returning();
  if (!patient) throw new HTTPException(404, { message: "Patient not found" });
  
  await logAudit(c, "patient", "update", "success", "patient", patient.id.toString());
  return c.json({ patient });
});

app.delete("/patients/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = parseInt(c.req.param("id"), 10);
  
  const result = await db.delete(patients).where(and(eq(patients.id, id), eq(patients.userId, user.id))).returning({ id: patients.id });
  if (!result.length) throw new HTTPException(404, { message: "Patient not found" });
  
  await logAudit(c, "patient", "delete", "success", "patient", id.toString());
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
  assignedToId: z.number().int().positive().optional(),
  chiefComplaint: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

app.get("/cases", requireAuth, async (c) => {
  const user = c.get("user");
  const page = parseInt(c.req.query("page") || "1", 10);
  const limit = Math.min(parseInt(c.req.query("limit") || "20", 10), 100);
  const status = c.req.query("status");
  const patientId = c.req.query("patientId") ? parseInt(c.req.query("patientId")!, 10) : undefined;
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

app.post("/cases", requireAuth, zValidator("json", createCaseSchema), async (c) => {
  const user = c.get("user");
  const data = c.req.valid("json");
  
  const patient = await db.query.patients.findFirst({ where: and(eq(patients.id, data.patientId), eq(patients.userId, user.id)) });
  if (!patient) throw new HTTPException(404, { message: "Patient not found or access denied" });
  
  const caseCount = await db.select({ count: count() }).from(cases).where(eq(cases.createdById, user.id));
  const caseNumber = `CS-${new Date().getFullYear()}-${String((caseCount[0]?.count || 0) + 1).padStart(3, "0")}`;
  
  const [newCase] = await db.insert(cases).values({ ...data, createdById: user.id, caseNumber }).returning();
  await logAudit(c, "case", "create", "success", "case", newCase.id.toString(), { caseNumber });
  
  return c.json({ case: newCase }, 201);
});

app.get("/cases/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = parseInt(c.req.param("id"), 10);
  
  const caseData = await db.query.cases.findFirst({ where: and(eq(cases.id, id), eq(cases.createdById, user.id)) });
  if (!caseData) throw new HTTPException(404, { message: "Case not found" });
  
  return c.json({ case: caseData });
});

app.patch("/cases/:id", requireAuth, zValidator("json", updateCaseSchema), async (c) => {
  const user = c.get("user");
  const id = parseInt(c.req.param("id"), 10);
  const data = c.req.valid("json");
  
  const updateData: Record<string, unknown> = { ...data, updatedAt: new Date() };
  if (data.status === "closed" && !updateData.closedAt) {
    updateData.closedAt = new Date();
  }
  
  const [updatedCase] = await db.update(cases).set(updateData).where(and(eq(cases.id, id), eq(cases.createdById, user.id))).returning();
  if (!updatedCase) throw new HTTPException(404, { message: "Case not found" });
  
  await logAudit(c, "case", "update", "success", "case", updatedCase.id.toString(), data);
  return c.json({ case: updatedCase });
});

const createSymptomAssessmentSchema = z.object({
  caseId: z.number().int().positive().optional(),
  primarySymptom: z.string().min(1),
  symptomCategory: z.enum(["skin", "general", "neurological", "cardiovascular", "respiratory", "gastrointestinal", "musculoskeletal", "psychiatric", "other"]),
  onset: z.string().optional(),
  duration: z.string().optional(),
  severity: z.enum(["mild", "moderate", "severe"]).optional(),
  progression: z.enum(["improving", "stable", "worsening", "fluctuating"]).optional(),
  associatedSymptoms: z.array(z.string()).default([]),
  medicalHistory: z.array(z.string()).default([]),
  medications: z.array(z.string()).default([]),
  allergies: z.array(z.string()).default([]),
});

const RED_FLAG_SYMPTOMS = [
  "chest pain", "difficulty breathing", "shortness of breath", "severe headache", "loss of consciousness",
  "fainting", "uncontrolled bleeding", "stroke", "face drooping", "arm weakness", "speech difficulty",
  "severe allergic reaction", "anaphylaxis", "high fever", "stiff neck", "sudden vision loss",
  "suicidal", "self-harm", "self harm"
];

function assessUrgency(symptom: string, category: string, severity?: string): { urgency: "emergency" | "urgent" | "routine" | "self_care"; redFlags: string[]; guidance: { recommendations: string[]; disclaimer: string } } {
  const lowerSymptom = symptom.toLowerCase();
  const triggeredFlags = RED_FLAG_SYMPTOMS.filter(flag => lowerSymptom.includes(flag));
  
  let urgency: "emergency" | "urgent" | "routine" | "self_care" = "routine";
  if (triggeredFlags.length > 0) urgency = "emergency";
  else if (severity === "severe" || category === "cardiovascular" || category === "neurological") urgency = "urgent";
  else if (severity === "moderate") urgency = "urgent";
  else urgency = "self_care";
  
  const recommendations = [
    "This assessment is for educational purposes only and does not constitute medical advice.",
    "Always consult a qualified healthcare professional for proper evaluation and diagnosis.",
  ];
  
  if (urgency === "emergency") {
    recommendations.unshift("SEEK IMMEDIATE MEDICAL ATTENTION. Call emergency services (911 in US) or go to the nearest emergency department.");
  } else if (urgency === "urgent") {
    recommendations.unshift("Seek medical attention within 24 hours. Contact your healthcare provider or visit an urgent care clinic.");
  } else {
    recommendations.unshift("Monitor your symptoms. If they worsen or persist, consult a healthcare professional.");
  }
  
  return { urgency, redFlags: triggeredFlags, guidance: { recommendations, disclaimer: "This is a research prototype for educational purposes only." } };
}

app.post("/symptom-assessments", requireAuth, zValidator("json", createSymptomAssessmentSchema), async (c) => {
  const user = c.get("user");
  const data = c.req.valid("json");
  
  if (data.caseId) {
    const caseData = await db.query.cases.findFirst({ where: and(eq(cases.id, data.caseId), eq(cases.createdById, user.id)) });
    if (!caseData) throw new HTTPException(404, { message: "Case not found" });
  }
  
  const { urgency, redFlags, guidance } = assessUrgency(data.primarySymptom, data.symptomCategory, data.severity);
  
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
  const id = parseInt(c.req.param("id"), 10);
  
  const assessment = await db.query.symptomAssessments.findFirst({ where: and(eq(symptomAssessments.id, id), eq(symptomAssessments.userId, user.id)) });
  if (!assessment) throw new HTTPException(404, { message: "Symptom assessment not found" });
  
  return c.json({ assessment });
});

const createReviewSchema = z.object({
  predictionId: z.number().int().positive(),
  status: z.enum(["pending", "reviewed", "accepted", "modified", "rejected", "needs_more_information"]),
  reviewedOutput: z.record(z.unknown()).optional(),
  rationale: z.string().optional(),
});

const updateReviewSchema = z.object({
  status: z.enum(["pending", "reviewed", "accepted", "modified", "rejected", "needs_more_information"]).optional(),
  reviewedOutput: z.record(z.unknown()).optional(),
  rationale: z.string().optional(),
});

app.post("/reviews", requireAuth, requireClinician, zValidator("json", createReviewSchema), async (c) => {
  const user = c.get("user");
  const data = c.req.valid("json");
  
  const prediction = await db.query.predictions.findFirst({ where: eq(predictions.id, data.predictionId) });
  if (!prediction) throw new HTTPException(404, { message: "Prediction not found" });
  
  const existing = await db.query.reviews.findFirst({ where: eq(reviews.predictionId, data.predictionId) });
  if (existing) throw new HTTPException(400, { message: "Review already exists for this prediction" });
  
  const [review] = await db.insert(reviews).values({
    ...data,
    reviewerId: user.id,
    originalOutput: prediction as unknown as Record<string, unknown>,
    reviewedAt: ["reviewed", "accepted", "modified", "rejected"].includes(data.status) ? new Date() : null,
  }).returning();
  
  await logAudit(c, "review", "create", "success", "review", review.id.toString(), { predictionId: data.predictionId, status: data.status });
  return c.json({ review }, 201);
});

app.get("/reviews/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = parseInt(c.req.param("id"), 10);

  const review = await db.query.reviews.findFirst({ where: eq(reviews.id, id) });
  if (!review) throw new HTTPException(404, { message: "Review not found" });

  const prediction = await db.query.predictions.findFirst({ where: eq(predictions.id, review.predictionId) });
  if (!prediction) throw new HTTPException(404, { message: "Prediction not found" });

  if (prediction.userId !== user.id && user.role !== "clinician" && user.role !== "admin") {
    throw new HTTPException(403, { message: "Access denied" });
  }

  return c.json({ review, prediction });
});

app.patch("/reviews/:id", requireAuth, requireClinician, zValidator("json", updateReviewSchema), async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const data = c.req.valid("json");
  
  const updateData: Record<string, unknown> = { ...data };
  if (data.status && ["reviewed", "accepted", "modified", "rejected"].includes(data.status)) {
    updateData.reviewedAt = new Date();
  }
  
  const [review] = await db.update(reviews).set(updateData).where(eq(reviews.id, id)).returning();
  if (!review) throw new HTTPException(404, { message: "Review not found" });
  
  await logAudit(c, "review", "update", "success", "review", review.id.toString(), data);
  return c.json({ review });
});

const createReportSchema = z.object({
  caseId: z.number().int().positive(),
  title: z.string().min(1),
  type: z.enum(["skin_analysis", "symptom_assessment", "comprehensive", "follow_up"]),
  content: z.record(z.unknown()),
  predictionIds: z.array(z.number().int().positive()).default([]),
});

const updateReportSchema = z.object({
  status: z.enum(["draft", "finalized", "archived", "amended"]).optional(),
  content: z.record(z.unknown()).optional(),
  predictionIds: z.array(z.number().int().positive()).optional(),
});

app.get("/reports", requireAuth, async (c) => {
  const user = c.get("user");
  const page = parseInt(c.req.query("page") || "1", 10);
  const limit = Math.min(parseInt(c.req.query("limit") || "20", 10), 100);
  const status = c.req.query("status");
  const caseId = c.req.query("caseId") ? parseInt(c.req.query("caseId")!, 10) : undefined;
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

app.post("/reports", requireAuth, zValidator("json", createReportSchema), async (c) => {
  const user = c.get("user");
  const data = c.req.valid("json");
  
  const caseData = await db.query.cases.findFirst({ where: and(eq(cases.id, data.caseId), eq(cases.createdById, user.id)) });
  if (!caseData) throw new HTTPException(404, { message: "Case not found or access denied" });
  
  const reportCount = await db.select({ count: count() }).from(reports).where(eq(reports.authorId, user.id));
  const reportNumber = `RPT-${new Date().getFullYear()}-${String((reportCount[0]?.count || 0) + 1).padStart(3, "0")}`;
  
  const [report] = await db.insert(reports).values({ ...data, authorId: user.id, reportNumber }).returning();
  await logAudit(c, "report", "create", "success", "report", report.id.toString(), { reportNumber });
  
  return c.json({ report }, 201);
});

app.get("/reports/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = parseInt(c.req.param("id"), 10);
  
  const report = await db.query.reports.findFirst({ where: eq(reports.id, id) });
  if (!report) throw new HTTPException(404, { message: "Report not found" });
  
  if (report.authorId !== user.id && user.role !== "clinician" && user.role !== "admin") {
    throw new HTTPException(403, { message: "Access denied" });
  }
  
  return c.json({ report });
});

app.patch("/reports/:id", requireAuth, zValidator("json", updateReportSchema), async (c) => {
  const user = c.get("user");
  const id = parseInt(c.req.param("id"), 10);
  const data = c.req.valid("json");
  
  const updateData: Record<string, unknown> = { ...data, updatedAt: new Date() };
  if (data.status === "finalized" && !updateData.finalizedAt) {
    updateData.finalizedAt = new Date();
  }
  if (data.status === "finalized") {
    updateData.reviewedAt = new Date();
  }
  
  const [report] = await db.update(reports).set(updateData).where(eq(reports.id, id)).returning();
  if (!report) throw new HTTPException(404, { message: "Report not found" });
  
  if (report.authorId !== user.id && user.role !== "clinician" && user.role !== "admin") {
    throw new HTTPException(403, { message: "Access denied" });
  }
  
  await logAudit(c, "report", "update", "success", "report", report.id.toString(), data);
  return c.json({ report });
});

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message, message: err.message }, err.status);
  }
  console.error("Unhandled error:", err);
  return c.json({ error: "internal_error", message: "An unexpected error occurred" }, 500);
});

app.notFound((c) => c.json({ error: "not_found", message: "Route not found" }, 404));

export default app;

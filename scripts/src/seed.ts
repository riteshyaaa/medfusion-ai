import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { cases, patients, users } from "@workspace/db/schema";

const seedEmail = "developer@medscope.test";
const seedName = "Fictional development seed account";
const seedPatientMarker = "Fictional development seed record; not a real person.";
const allowedHosts = new Set(["localhost", "127.0.0.1", "::1"]);

async function seed() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The development seed cannot run when NODE_ENV is production.");
  }
  if (process.env.DEV_SEED_CONFIRM !== "I_UNDERSTAND_FICTIONAL_DATA") {
    throw new Error("Set DEV_SEED_CONFIRM=I_UNDERSTAND_FICTIONAL_DATA to seed fictional development records.");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  if (!process.env.DEV_SEED_PASSWORD || process.env.DEV_SEED_PASSWORD.length < 10) {
    throw new Error("Set DEV_SEED_PASSWORD to a private value of at least 10 characters.");
  }

  const databaseUrl = new URL(process.env.DATABASE_URL);
  if (!allowedHosts.has(databaseUrl.hostname)) {
    throw new Error("The development seed only permits a local PostgreSQL host.");
  }

  const insertedUsers = await db.insert(users).values({
    email: seedEmail,
    fullName: seedName,
    passwordHash: await bcrypt.hash(process.env.DEV_SEED_PASSWORD, 12),
  }).onConflictDoNothing({ target: users.email }).returning();
  let user: typeof users.$inferSelect | undefined = insertedUsers[0];

  if (!user) {
    user = await db.query.users.findFirst({ where: eq(users.email, seedEmail) });
  }
  if (!user || user.fullName !== seedName || user.role !== "user") {
    throw new Error("The seed account already exists but is not the expected unprivileged seed account; no records were changed.");
  }

  let patient = await db.query.patients.findFirst({
    where: and(eq(patients.userId, user.id), eq(patients.firstName, "Fictional"), eq(patients.lastName, "Patient"), eq(patients.notes, seedPatientMarker)),
  });
  if (!patient) {
    [patient] = await db.insert(patients).values({
      userId: user.id,
      firstName: "Fictional",
      lastName: "Patient",
      dateOfBirth: "1990-01-01",
      notes: seedPatientMarker,
    }).returning();
  }

  const caseNumber = "DEV-FICTIONAL-SEED";
  let caseRecord = await db.query.cases.findFirst({ where: eq(cases.caseNumber, caseNumber) });
  if (!caseRecord) {
    [caseRecord] = await db.insert(cases).values({
      caseNumber,
      patientId: patient.id,
      createdById: user.id,
      type: "follow_up",
      chiefComplaint: "Fictional local development record; no clinical inference is attached.",
      tags: ["fictional-seed"],
    }).returning();
  } else if (caseRecord.createdById !== user.id || caseRecord.patientId !== patient.id) {
    throw new Error("The fictional seed case number is already used by another account; no records were changed.");
  }

  process.stdout.write(`Fictional development seed is ready: ${seedEmail}, patient #${patient.id}, case ${caseNumber}.\n`);
}

try {
  await seed();
} finally {
  await pool.end();
}

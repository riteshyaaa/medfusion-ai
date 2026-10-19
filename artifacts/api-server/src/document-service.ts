import { db } from "@workspace/db";
import { documents, documentFindings, auditEvents } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { extractDocument, findingMatchKey } from "./document-extraction";
import type { PrivateStorage } from "./storage";

export type DocumentProcessingDependencies = {
  storage: PrivateStorage;
  env?: NodeJS.ProcessEnv;
};

const MAX_CONCURRENT_JOBS = 2;
const STALE_PROCESSING_MS = 10 * 60_000;
let activeJobs = 0;
const waitingJobs: Array<() => void> = [];

export function scheduleDocumentProcessing(documentId: number, dependencies: DocumentProcessingDependencies): void {
  const run = () => {
    activeJobs += 1;
    void processDocument(documentId, dependencies)
      .catch((error) => {
        console.error(JSON.stringify({ event: "document_processing_unhandled", documentId, errorType: error instanceof Error ? error.name : "unknown" }));
      })
      .finally(() => {
        activeJobs -= 1;
        waitingJobs.shift()?.();
      });
  };
  if (activeJobs >= MAX_CONCURRENT_JOBS) waitingJobs.push(run);
  else run();
}

async function recordDocumentAudit(document: typeof documents.$inferSelect, action: string, outcome: "success" | "failure" | "error", metadata?: Record<string, unknown>): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      userId: document.userId,
      eventType: "document",
      resourceType: "document",
      resourceId: document.id.toString(),
      action,
      outcome,
      metadata,
    });
  } catch {
    console.error(JSON.stringify({ event: "audit_write_failed", eventType: "document", action, documentId: document.id }));
  }
}

function isStaleProcessing(document: typeof documents.$inferSelect, now: Date): boolean {
  return now.getTime() - document.updatedAt.getTime() > STALE_PROCESSING_MS;
}

type ReviewedFinding = typeof documentFindings.$inferSelect;

/**
 * Reprocess must never destroy human review. Findings the user has confirmed
 * or corrected are matched against the fresh extraction via a normalized label
 * key; matched findings keep their review status and corrected values. Fresh
 * duplicate rows for a preserved analyte are skipped instead of overwriting
 * that review.
 */
function preservedReviewKeys(existing: ReviewedFinding[], freshLabels: string[]): Set<string> {
  const freshKeys = new Set(freshLabels);
  const preserved = new Set<string>();
  for (const finding of existing) {
    if (finding.status !== "confirmed" && finding.status !== "corrected") continue;
    const candidates = [finding.normalizedLabel, findingMatchKey(finding.label)];
    if (finding.correctedLabel) candidates.push(findingMatchKey(finding.correctedLabel));
    for (const key of candidates) {
      if (key && freshKeys.has(key)) {
        preserved.add(key);
        break;
      }
    }
  }
  return preserved;
}

export async function processDocument(documentId: number, dependencies: DocumentProcessingDependencies): Promise<void> {
  const document = await db.query.documents.findFirst({ where: eq(documents.id, documentId) });
  if (!document) return;
  const now = new Date();
  if (document.processingStatus === "processing" && !isStaleProcessing(document, now)) return;

  await db.update(documents).set({ processingStatus: "processing", updatedAt: now }).where(eq(documents.id, documentId));

  try {
    const bytes = await dependencies.storage.read(document.storageKey);
    const outcome = await extractDocument({ bytes, mimeType: document.mimeType }, dependencies.env ?? process.env);
    const existing = await db.query.documentFindings.findMany({ where: eq(documentFindings.documentId, documentId), orderBy: [documentFindings.id] });
    const preservedKeys = preservedReviewKeys(existing, outcome.findings.map((finding) => findingMatchKey(finding.label)));

    const insertedKeys = new Set<string>();
    const freshToInsert: Array<typeof documentFindings.$inferInsert> = [];
    for (const finding of outcome.findings) {
      const key = findingMatchKey(finding.label);
      if (preservedKeys.has(key) || insertedKeys.has(key)) continue;
      insertedKeys.add(key);
      freshToInsert.push({
        documentId,
        pageNumber: finding.pageNumber,
        category: finding.category,
        label: finding.label,
        valueText: finding.valueText,
        numericValue: finding.numericValue,
        unit: finding.unit,
        referenceRange: finding.referenceRange,
        resultFlag: finding.resultFlag,
        confidence: finding.confidence,
        ambiguous: finding.ambiguous,
        normalizedLabel: key,
        sourceText: finding.sourceText,
        status: "candidate",
        correctedValueText: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    await db.transaction(async (tx) => {
      // Unreviewed candidate rows are always reproducible from the raw text,
      // so they are replaced wholesale. Reviewed findings are kept untouched.
      const reviewedRows = existing.filter((finding) => finding.status !== "candidate");
      await tx.delete(documentFindings).where(eq(documentFindings.documentId, documentId));
      if (reviewedRows.length > 0) await tx.insert(documentFindings).values(reviewedRows.map((finding) => ({ ...finding })));
      if (freshToInsert.length > 0) await tx.insert(documentFindings).values(freshToInsert);
      await tx.update(documents).set({
        processingStatus: outcome.status,
        extractionMethod: outcome.method,
        documentType: outcome.documentType,
        documentTypeSource: "heuristic",
        pageCount: outcome.pageCount,
        extractionErrorCode: outcome.errorCode ?? null,
        textPages: outcome.pages,
        metadata: { importWarnings: outcome.notes },
        extractedAt: now,
        updatedAt: now,
      }).where(eq(documents.id, documentId));
    });
    await recordDocumentAudit(document, "extract", outcome.status === "failed" ? "failure" : "success", {
      status: outcome.status,
      method: outcome.method,
      documentType: outcome.documentType,
      findingCount: outcome.findings.length,
      preservedFindings: preservedKeys.size,
    });
  } catch (error) {
    await db.update(documents).set({
      processingStatus: "failed",
      extractionErrorCode: "processing_error",
      extractedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(documents.id, documentId));
    await recordDocumentAudit(document, "extract", "error", { reason: "processing_error" });
    console.error(JSON.stringify({ event: "document_processing_failed", documentId, errorType: error instanceof Error ? error.name : "unknown" }));
  }
}

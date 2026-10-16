import { db } from "@workspace/db";
import { documents, documentFindings, auditEvents } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { extractDocument } from "./document-extraction";
import type { PrivateStorage } from "./storage";

export type DocumentProcessingDependencies = {
  storage: PrivateStorage;
  env?: NodeJS.ProcessEnv;
};

const MAX_CONCURRENT_JOBS = 2;
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

export async function processDocument(documentId: number, dependencies: DocumentProcessingDependencies): Promise<void> {
  const document = await db.query.documents.findFirst({ where: eq(documents.id, documentId) });
  if (!document || document.processingStatus === "processing") return;

  await db.update(documents).set({ processingStatus: "processing", updatedAt: new Date() }).where(eq(documents.id, documentId));

  try {
    const bytes = await dependencies.storage.read(document.storageKey);
    const outcome = await extractDocument({ bytes, mimeType: document.mimeType }, dependencies.env ?? process.env);
    await db.transaction(async (tx) => {
      await tx.delete(documentFindings).where(eq(documentFindings.documentId, documentId));
      if (outcome.findings.length > 0) {
        await tx.insert(documentFindings).values(outcome.findings.map((finding) => ({
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
          sourceText: finding.sourceText,
        })));
      }
      await tx.update(documents).set({
        processingStatus: outcome.status,
        extractionMethod: outcome.method,
        documentType: outcome.documentType,
        documentTypeSource: "heuristic",
        pageCount: outcome.pageCount,
        extractionErrorCode: outcome.errorCode ?? null,
        textPages: outcome.pages,
        metadata: { importWarnings: outcome.notes },
        extractedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(documents.id, documentId));
    });
    await recordDocumentAudit(document, "extract", outcome.status === "failed" ? "failure" : "success", {
      status: outcome.status,
      method: outcome.method,
      documentType: outcome.documentType,
      findingCount: outcome.findings.length,
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

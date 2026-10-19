import { ChangeEvent, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  downloadDocument,
  useDeleteDocument,
  useGetDocument,
  useInterpretDocument,
  useListCases,
  useListDocuments,
  useReprocessDocument,
  useUpdateDocumentFinding,
  useUploadDocument,
} from "@workspace/api-client-react";
import type { Document, DocumentFinding } from "@workspace/api-client-react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  PencilLine,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Layout } from "@/components/layout";
import { useToast } from "@/hooks/use-toast";

const statusStyles: Record<string, string> = {
  uploaded: "bg-slate-100 text-slate-700",
  processing: "bg-blue-100 text-blue-800",
  extracted: "bg-emerald-100 text-emerald-800",
  needs_review: "bg-amber-100 text-amber-800",
  ocr_unavailable: "bg-purple-100 text-purple-800",
  failed: "bg-red-100 text-red-800",
  unsupported: "bg-red-100 text-red-800",
};

const findingStatusStyles: Record<string, string> = {
  candidate: "bg-slate-100 text-slate-700",
  confirmed: "bg-emerald-100 text-emerald-800",
  corrected: "bg-blue-100 text-blue-800",
  rejected: "bg-red-100 text-red-700",
};

function statusLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isProcessing(document: Pick<Document, "processingStatus">) {
  return document.processingStatus === "uploaded" || document.processingStatus === "processing";
}

type CorrectionDraft = { label: string; valueText: string; unit: string; referenceRange: string };

export default function ReportAnalysis() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [caseId, setCaseId] = useState("");
  const [consent, setConsent] = useState(false);
  const [correction, setCorrection] = useState<{ findingId: number; draft: CorrectionDraft } | null>(null);

  const documentsQuery = useListDocuments({ page: 1, limit: 50 }, {
    query: {
      refetchInterval: (query) => {
        const items = query.state.data?.documents ?? [];
        return items.some((document) => document.processingStatus === "uploaded" || document.processingStatus === "processing") ? 2_000 : false;
      },
    },
  });
  const casesQuery = useListCases({ page: 1, limit: 100 });
  const documents = documentsQuery.data?.documents ?? [];
  const anythingProcessing = documents.some(isProcessing);

  const detailQuery = useGetDocument(selectedId ?? 0, {
    query: {
      enabled: selectedId !== null,
      refetchInterval: (query) => {
        const status = query.state.data?.document.processingStatus;
        return status === "uploaded" || status === "processing" ? 1_500 : false;
      },
    },
  });
  const detail = detailQuery.data?.document;
  const detailProcessing = detail ? isProcessing(detail) : false;

  const uploadDocument = useUploadDocument({
    mutation: {
      onSuccess: async (response) => {
        setSelectedId(response.document.id);
        await queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
        toast({
          title: "Document uploaded",
          description: "Text extraction is running. Findings appear here when processing finishes.",
        });
      },
      onError: (error) => {
        const data = (error as { data?: { message?: string } }).data;
        toast({ title: "Upload rejected", description: data?.message ?? "The document could not be stored.", variant: "destructive" });
      },
    },
  });

  const deleteDocument = useDeleteDocument({
    mutation: {
      onSuccess: async (_data, variables) => {
        if (selectedId === variables.id) setSelectedId(null);
        await queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
        toast({ title: "Document deleted", description: "The stored file, extracted text, and findings were removed." });
      },
      onError: () => toast({ title: "Delete failed", description: "The document could not be deleted. Retry.", variant: "destructive" }),
    },
  });

  const reprocessDocument = useReprocessDocument({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
        await detailQuery.refetch();
        toast({ title: "Reprocessing started", description: "Existing findings were cleared and extraction is running again." });
      },
      onError: () => toast({ title: "Reprocess failed", description: "Processing may already be in progress.", variant: "destructive" }),
    },
  });

  const updateFinding = useUpdateDocumentFinding({
    mutation: {
      onSuccess: async () => {
        setCorrection(null);
        await detailQuery.refetch();
      },
      onError: () => toast({ title: "Update failed", description: "The finding could not be updated. Retry.", variant: "destructive" }),
    },
  });

  const interpretDocument = useInterpretDocument({
    mutation: {
      onSuccess: async (response) => {
        await detailQuery.refetch();
        toast({ title: "Explanation generated", description: response.notice });
      },
      onError: (error) => {
        const data = (error as { data?: { error?: string; message?: string } }).data;
        const descriptions: Record<string, string> = {
          external_data_consent_required: "Explicit consent is required before findings are sent anywhere.",
          external_processing_disabled: "External health-data processing is disabled on this server.",
          provider_unavailable: "No interpretation provider is configured, or it could not complete the request.",
          provider_malformed_response: "The provider response failed safety validation and was discarded.",
          provider_rate_limited: "The provider is rate limited. Try again later.",
          no_findings: "This document has no extracted findings to explain.",
          document_not_eligible: "The document must finish extraction before it can be explained.",
        };
        toast({
          title: "Explanation not generated",
          description: data?.error ? descriptions[data.error] ?? data.message ?? "The request failed." : data?.message ?? "The request failed.",
          variant: "destructive",
        });
      },
    },
  });

  const upload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    uploadDocument.mutate({ data: { file, ...(caseId ? { caseId: Number(caseId) } : {}) } });
  };

  const download = async (document: Document) => {
    try {
      const blob = await downloadDocument(document.id);
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = document.originalFileName;
      anchor.rel = "noopener";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Download failed", description: "The stored file could not be retrieved.", variant: "destructive" });
    }
  };

  const startCorrection = (finding: DocumentFinding) => {
    setCorrection({
      findingId: finding.id,
      draft: {
        label: finding.correctedLabel ?? finding.label,
        valueText: finding.correctedValueText ?? finding.valueText ?? "",
        unit: finding.correctedUnit ?? finding.unit ?? "",
        referenceRange: finding.correctedReferenceRange ?? finding.referenceRange ?? "",
      },
    });
  };

  const saveCorrection = () => {
    if (!detail || !correction) return;
    const { draft } = correction;
    updateFinding.mutate({
      id: detail.id,
      findingId: correction.findingId,
      data: {
        status: "corrected",
        correctedLabel: draft.label.trim() || undefined,
        correctedValueText: draft.valueText.trim() || undefined,
        correctedUnit: draft.unit.trim() || undefined,
        correctedReferenceRange: draft.referenceRange.trim() || undefined,
      },
    });
  };

  const latestInterpretation = useMemo(() => detail?.interpretations?.[0], [detail]);

  return (
    <Layout>
      <div className="max-w-7xl mx-auto pt-8 pb-20">
        <Link href="/" className="inline-flex items-center gap-2 text-slate-500 hover:text-primary font-medium mb-6">
          <ArrowLeft className="w-4 h-4" />Back to Overview
        </Link>

        <div className="mb-8">
          <h1 className="text-4xl md:text-5xl font-display font-extrabold text-slate-900 tracking-tight">Report Analysis</h1>
          <p className="text-slate-600 mt-2 max-w-3xl">
            Upload a medical report (text PDF, scanned PDF, PNG, or JPEG). The server extracts text — using OCR when needed — pulls out
            measurements as findings, and lets you confirm or correct every value. Nothing is treated as a result until you review it.
          </p>
        </div>

        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <h2 className="font-semibold">Extraction can misread values</h2>
            <p className="mt-1 text-sm">
              OCR and text parsing are not perfect. Confirm or correct each finding before relying on it, and never use this prototype for
              an emergency. DICOM and other medical imaging formats are not accepted.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[380px,1fr] gap-6 items-start">
          <div className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <UploadCloud className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Upload a document</h2>
              </div>
              <label className="space-y-1 text-sm font-medium block">
                Linked case (optional)
                <select value={caseId} onChange={(event) => setCaseId(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">No case</option>
                  {(casesQuery.data?.cases ?? []).map((item) => (
                    <option key={item.id} value={item.id}>{item.caseNumber}</option>
                  ))}
                </select>
              </label>
              <label className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 p-6 text-center transition-colors hover:border-primary/60 hover:bg-slate-50 ${uploadDocument.isPending ? "pointer-events-none opacity-60" : ""}`}>
                <input type="file" accept=".pdf,image/png,image/jpeg" className="sr-only" onChange={upload} disabled={uploadDocument.isPending} aria-label="Upload a medical report document" />
                <UploadCloud className="mb-2 h-8 w-8 text-primary" />
                <span className="text-sm font-medium">{uploadDocument.isPending ? "Uploading…" : "Choose a PDF, PNG, or JPEG"}</span>
                <span className="mt-1 text-xs text-slate-500">Up to 20 MB. Text-layer PDFs are read directly; scans and photos use OCR.</span>
              </label>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 p-5">
                <div className="flex items-center gap-2"><FileText className="h-5 w-5 text-primary" /><h2 className="font-semibold">Your documents</h2></div>
                {anythingProcessing && <span className="text-xs text-slate-500 animate-pulse">Processing…</span>}
              </div>
              {documentsQuery.isLoading && <p role="status" className="p-5 text-sm text-slate-500">Loading documents…</p>}
              {documentsQuery.isError && (
                <div className="p-5">
                  <p role="alert" className="text-sm text-slate-600">Documents could not be loaded.</p>
                  <Button variant="outline" className="mt-2" onClick={() => void documentsQuery.refetch()}>Retry</Button>
                </div>
              )}
              {!documentsQuery.isLoading && !documentsQuery.isError && documents.length === 0 && (
                <p className="p-5 text-sm text-slate-500">No documents yet. Upload one to begin.</p>
              )}
              <ul className="divide-y divide-slate-100">
                {documents.map((document) => (
                  <li key={document.id}>
                    <button
                      type="button"
                      onClick={() => { setSelectedId(document.id); setCorrection(null); setConsent(false); }}
                      className={`w-full px-5 py-4 text-left transition-colors hover:bg-slate-50 ${selectedId === document.id ? "bg-primary/5" : ""}`}
                      aria-pressed={selectedId === document.id}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-slate-900">{document.originalFileName}</span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusStyles[document.processingStatus] ?? "bg-slate-100 text-slate-700"}`}>
                          {statusLabel(document.processingStatus)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {statusLabel(document.documentType)} · {document.findingCount} findings · {new Date(document.createdAt).toLocaleString()}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <div className="space-y-6">
            {selectedId === null && (
              <section className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">
                <FileText className="mx-auto mb-3 h-10 w-10 text-slate-300" />
                Select a document to review its extracted findings, or upload a new one.
              </section>
            )}

            {selectedId !== null && detailQuery.isLoading && <p role="status" className="p-10 text-center text-slate-500">Loading document…</p>}
            {selectedId !== null && detailQuery.isError && (
              <section className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
                <h2 className="text-xl font-semibold">Document unavailable</h2>
                <p className="mt-2 text-sm text-slate-600">It may have been deleted, or it may not belong to your account.</p>
              </section>
            )}

            {detail && (
              <>
                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-semibold text-slate-900">{detail.originalFileName}</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {statusLabel(detail.documentType)} · {detail.pageCount ?? "?"} page(s) · extraction: {detail.extractionMethod ? statusLabel(detail.extractionMethod) : "not available"}
                      </p>
                      <span className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-semibold ${statusStyles[detail.processingStatus] ?? "bg-slate-100 text-slate-700"}`}>
                        {statusLabel(detail.processingStatus)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => void download(detail)}>Download original</Button>
                      <Button variant="outline" size="sm" className="gap-1" onClick={() => reprocessDocument.mutate({ id: detail.id })} disabled={reprocessDocument.isPending || detailProcessing}>
                        <RefreshCw className={`h-4 w-4 ${detailProcessing ? "animate-spin" : ""}`} />Reprocess
                      </Button>
                      <Button variant="outline" size="sm" className="gap-1 text-red-600 hover:text-red-700" onClick={() => { if (window.confirm("Delete this document and all extracted findings?")) deleteDocument.mutate({ id: detail.id }); }} disabled={deleteDocument.isPending}>
                        <Trash2 className="h-4 w-4" />Delete
                      </Button>
                    </div>
                  </div>
                  {detailProcessing && <p className="mt-4 text-sm text-blue-700" role="status">Extraction is running. This panel refreshes automatically when it finishes — reopen or refresh shortly.</p>}
                  {detail.extractionErrorCode && (
                    <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                      Extraction problem: {statusLabel(detail.extractionErrorCode)}. You can reprocess the document or upload clearer pages.
                    </p>
                  )}
                  {Array.isArray(detail.metadata?.extractionNotes) && (detail.metadata.extractionNotes as string[]).length > 0 && (
                    <ul className="mt-4 list-disc space-y-1 rounded-lg bg-slate-50 p-3 pl-7 text-xs text-slate-600">
                      {(detail.metadata.extractionNotes as string[]).map((note, index) => <li key={index}>{note}</li>)}
                    </ul>
                  )}
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                  <div className="flex items-center gap-2 border-b border-slate-200 p-5">
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                    <h2 className="font-semibold">Extracted findings</h2>
                    <span className="ml-auto text-xs text-slate-500">Confirm, correct, or reject each row before interpreting</span>
                  </div>
                  {(detail.findings ?? []).length === 0 && <p className="p-6 text-sm text-slate-500">No findings were extracted from this document.</p>}
                  {(detail.findings ?? []).length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[860px]">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-500">Page</th>
                            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-500">Category</th>
                            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-500">Finding</th>
                            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-500">Reference</th>
                            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-500">Flag</th>
                            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-500">Status</th>
                            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-500">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(detail.findings ?? []).filter((finding) => finding.status !== "rejected").map((finding) => {
                            const showCorrection = finding.status === "corrected";
                            const inEdit = correction?.findingId === finding.id;
                            return (
                              <tr key={finding.id} className={`align-top ${inEdit ? "bg-blue-50/60" : ""}`}>
                                <td className="px-4 py-3 text-sm text-slate-600">{finding.pageNumber ?? "—"}</td>
                                <td className="px-4 py-3 text-sm text-slate-600">{statusLabel(finding.category)}</td>
                                <td className="px-4 py-3 text-sm">
                                  {inEdit ? (
                                    <div className="grid gap-2 sm:grid-cols-2">
                                      <Input value={correction.draft.label} onChange={(event) => setCorrection({ ...correction, draft: { ...correction.draft, label: event.target.value } })} aria-label="Corrected label" placeholder="Label" className="h-8" />
                                      <Input value={correction.draft.valueText} onChange={(event) => setCorrection({ ...correction, draft: { ...correction.draft, valueText: event.target.value } })} aria-label="Corrected value" placeholder="Value" className="h-8" />
                                      <Input value={correction.draft.unit} onChange={(event) => setCorrection({ ...correction, draft: { ...correction.draft, unit: event.target.value } })} aria-label="Corrected unit" placeholder="Unit" className="h-8" />
                                      <Input value={correction.draft.referenceRange} onChange={(event) => setCorrection({ ...correction, draft: { ...correction.draft, referenceRange: event.target.value } })} aria-label="Corrected reference range" placeholder="Reference range" className="h-8" />
                                    </div>
                                  ) : (
                                    <>
                                      <p className="font-medium text-slate-900">{showCorrection ? finding.correctedLabel ?? finding.label : finding.label}</p>
                                      <p className="text-slate-600">
                                        {showCorrection ? finding.correctedValueText ?? finding.valueText ?? "—" : finding.valueText ?? "—"}
                                        {(() => {
                                          const unit = showCorrection ? finding.correctedUnit ?? finding.unit : finding.unit;
                                          return unit ? <span className="ml-1 text-slate-400">{unit}</span> : null;
                                        })()}
                                      </p>
                                      {finding.sourceText && <p className="mt-1 max-w-xs truncate text-xs text-slate-400" title={finding.sourceText}>&ldquo;{finding.sourceText}&rdquo;</p>}
                                    </>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-sm text-slate-600">{showCorrection ? finding.correctedReferenceRange ?? finding.referenceRange ?? "—" : finding.referenceRange ?? "—"}</td>
                                <td className="px-4 py-3 text-sm">
                                  {finding.resultFlag && finding.resultFlag !== "unknown" ? (
                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize">{finding.resultFlag}</span>
                                  ) : "—"}
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${findingStatusStyles[finding.status] ?? "bg-slate-100 text-slate-700"}`}>
                                    {statusLabel(finding.status)}
                                  </span>
                                  {finding.ambiguous && <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800" title="Some characters in this row were unreadable during extraction">unreadable?</span>}
                                </td>
                                <td className="px-4 py-3">
                                  {inEdit ? (
                                    <div className="flex gap-2">
                                      <Button size="sm" onClick={saveCorrection} disabled={updateFinding.isPending || !correction.draft.label.trim()}>Save</Button>
                                      <Button size="sm" variant="ghost" onClick={() => setCorrection(null)}>Cancel</Button>
                                    </div>
                                  ) : (
                                    <div className="flex flex-wrap gap-2">
                                      <Button size="sm" variant="outline" className="gap-1" onClick={() => updateFinding.mutate({ id: detail.id, findingId: finding.id, data: { status: "confirmed" } })} disabled={updateFinding.isPending || finding.status === "confirmed"}>
                                        <CheckCircle2 className="h-3.5 w-3.5" />Confirm
                                      </Button>
                                      <Button size="sm" variant="outline" className="gap-1" onClick={() => startCorrection(finding)} disabled={updateFinding.isPending}>
                                        <PencilLine className="h-3.5 w-3.5" />Correct
                                      </Button>
                                      <Button size="sm" variant="ghost" className="gap-1 text-red-600 hover:text-red-700" onClick={() => updateFinding.mutate({ id: detail.id, findingId: finding.id, data: { status: "rejected" } })} disabled={updateFinding.isPending}>
                                        <XCircle className="h-3.5 w-3.5" />Reject
                                      </Button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {(detail.findings ?? []).some((finding) => finding.status === "rejected") && (
                    <p className="border-t border-slate-100 p-4 text-xs text-slate-500">
                      Rejected findings are hidden from the table and excluded from interpretation.
                    </p>
                  )}
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center gap-2 mb-4">
                    <Sparkles className="h-5 w-5 text-primary" />
                    <h2 className="font-semibold">Smart explanation</h2>
                  </div>
                  <p className="text-sm text-slate-600">
                    Optional. When enabled, only the structured findings above — never the document file or extracted page images — are sent to the
                    configured provider, which returns a plain-language explanation. Server-side safety rules reject any output that invents numbers or
                    makes diagnosis claims, and rejected output is discarded.
                  </p>
                  <label className="mt-4 flex items-start gap-3 text-sm">
                    <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1 h-4 w-4" />
                    <span>I consent to sending the extracted findings above for external processing to generate an explanation.</span>
                  </label>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <Button
                      className="gap-2"
                      onClick={() => interpretDocument.mutate({ id: detail.id, data: { consentToExternalProcessing: true } })}
                      disabled={!consent || interpretDocument.isPending || detailProcessing || ((detail.findings ?? []).filter((finding) => finding.status !== "rejected").length === 0 && (detail.textPages ?? []).length === 0)}
                    >
                      <Sparkles className="h-4 w-4" />
                      {interpretDocument.isPending ? "Generating…" : "Generate explanation"}
                    </Button>
                    <span className="text-xs text-slate-500">Requires consent, extracted findings, and an enabled provider on the server.</span>
                  </div>

                  {(() => {
                    const interpretations = detail?.interpretations ?? [];
                    const failed = interpretations.filter((entry) => entry.status === "failed");
                    if (failed.length === 0) return null;
                    const attemptWord = failed.length === 1 ? "attempt" : failed.length + " attempts";
                    return (
                      <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-5">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-red-800">The last {attemptWord} failed before any output was produced.</p>
                            <p className="mt-1 text-xs text-red-700">
                              {failed.map((entry) => (entry.errorCode ?? "unknown_error").replace(/_/g, " ")).join(", ")} — nothing was saved from the failed provider responses.
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => interpretDocument.mutate({ id: detail.id, data: { consentToExternalProcessing: consent } })}
                            disabled={!consent || interpretDocument.isPending || detailProcessing}
                          >
                            Retry
                          </Button>
                        </div>
                      </div>
                    );
                  })()}
                  {latestInterpretation && (
                    <article className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
                      <h3 className="font-semibold text-slate-900">{statusLabel(String(latestInterpretation.sections?.documentType ?? detail.documentType))}</h3>
                      <p className="mt-2 text-sm text-slate-700">{String(latestInterpretation.sections?.summary ?? "")}</p>
                      {Array.isArray(latestInterpretation.sections?.findingsExplained) && (latestInterpretation.sections.findingsExplained as Array<{ label: string; explanation: string }>).length > 0 && (
                        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
                          {(latestInterpretation.sections.findingsExplained as Array<{ label: string; explanation: string }>).map((entry, index) => (
                            <li key={index}><span className="font-medium">{entry.label}:</span> {entry.explanation}</li>
                          ))}
                        </ul>
                      )}
                      {Array.isArray(latestInterpretation.sections?.terminology) && (latestInterpretation.sections.terminology as Array<{ term: string; plainLanguage: string }>).length > 0 && (
                        <div className="mt-3">
                          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Terminology</h4>
                          <ul className="mt-1 space-y-1 text-sm text-slate-700">
                            {(latestInterpretation.sections.terminology as Array<{ term: string; plainLanguage: string }>).map((entry, index) => (
                              <li key={index}><span className="font-medium">{entry.term}:</span> {entry.plainLanguage}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {(["inconsistencies", "missingInformation", "questionsForClinician", "limitations"] as const).map((key) => {
                        const values = latestInterpretation.sections?.[key];
                        if (!Array.isArray(values) || values.length === 0) return null;
                        const labels: Record<string, string> = {
                          inconsistencies: "Possible inconsistencies",
                          missingInformation: "Missing information",
                          questionsForClinician: "Questions for a clinician",
                          limitations: "Limitations of this explanation",
                        };
                        return (
                          <div key={key} className="mt-3">
                            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{labels[key]}</h4>
                            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                              {(values as string[]).map((entry, index) => <li key={index}>{entry}</li>)}
                            </ul>
                          </div>
                        );
                      })}
                      <p className="mt-4 text-xs text-slate-500">
                        This explanation restates the values extracted from the document. Verify important values against the original report.
                      </p>
                    </article>
                  )}
                </section>

                {(detail.textPages ?? []).length > 0 && (
                  <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <ShieldCheck className="h-5 w-5 text-primary" />
                      <h2 className="font-semibold">Extracted text (for verification)</h2>
                    </div>
                    <div className="space-y-3">
                      {(detail.textPages ?? []).map((page) => (
                        <details key={`${page.page}-${page.method}`} className="rounded-lg border border-slate-200">
                          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                            Page {page.page} · {page.method === "ocr" ? "OCR text (may contain recognition errors)" : "PDF text layer"}
                          </summary>
                          <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">{page.text}</pre>
                        </details>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

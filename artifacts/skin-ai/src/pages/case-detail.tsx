import { Link, useRoute } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useGetCase, useGetCaseWorkspace, useGetPatient, useUpdateCase } from "@workspace/api-client-react";
import type { CaseStatus } from "@workspace/api-client-react";
import { ArrowLeft, CalendarClock, ClipboardList, FileText, HeartPulse, ImageIcon, ScrollText, Sparkles, Stethoscope, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Layout } from "@/components/layout";
import { AIEvaluationModal, type AIEvaluationModalAssessment } from "@/components/ai-evaluation-modal";
import { useState } from "react";

function title(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function timestamp(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "—";
}

export default function CaseDetail() {
  const [evaluationFor, setEvaluationFor] = useState<AIEvaluationModalAssessment | null>(null);
  const [, params] = useRoute("/cases/:id");
  const id = Number(params?.id);
  const validId = Number.isSafeInteger(id) && id > 0;
  const caseQuery = useGetCase(id, { query: { enabled: validId } });
  const caseRecord = caseQuery.data?.case;
  const patientQuery = useGetPatient(caseRecord?.patientId ?? 0, { query: { enabled: Boolean(caseRecord?.patientId) } });
  const workspaceQuery = useGetCaseWorkspace(id, { query: { enabled: validId } });
  const workspace = workspaceQuery.data;
  const queryClient = useQueryClient();
  const updateCase = useUpdateCase({ mutation: { onSuccess: async () => {
    await queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
    await caseQuery.refetch();
  } } });

  return (
    <Layout>
      <div className="max-w-5xl mx-auto pt-8 pb-20">
        <Link href="/cases" className="inline-flex items-center gap-2 text-slate-500 hover:text-primary font-medium mb-6"><ArrowLeft className="w-4 h-4" />Back to cases</Link>
        {caseQuery.isLoading && <p role="status" className="p-10 text-center text-slate-500">Loading case…</p>}
        {(caseQuery.isError || !validId) && <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center"><h1 className="text-2xl font-bold">Case unavailable</h1><p className="text-slate-600 mt-2">This case may not exist or may not belong to your account.</p><Button variant="outline" onClick={() => void caseQuery.refetch()} className="mt-4">Retry</Button></div>}
        {caseRecord && (
          <>
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
              <div><p className="font-mono text-primary font-semibold">{caseRecord.caseNumber}</p><h1 className="text-3xl font-display font-bold text-slate-900">Case details</h1><p className="text-slate-600 mt-1">{title(caseRecord.type)}</p></div>
              <label className="text-sm font-medium">Case status<select aria-label="Update case status" value={caseRecord.status} disabled={updateCase.isPending} onChange={(event) => updateCase.mutate({ id, data: { status: event.target.value as CaseStatus } })} className="ml-3 rounded-md border border-slate-200 bg-white px-3 py-2"><option value="open">Open</option><option value="in_review">In review</option><option value="on_hold">On hold</option><option value="closed">Closed</option></select></label>
            </div>
            {updateCase.isError && <p role="alert" className="mb-4 text-sm text-destructive">The status update failed. Refresh and retry.</p>}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <section className="rounded-2xl border border-slate-200 bg-white p-6"><div className="flex items-center gap-2 mb-4"><FileText className="w-5 h-5 text-primary" /><h2 className="font-semibold">Case information</h2></div><dl className="space-y-3 text-sm"><div><dt className="text-slate-500">Status</dt><dd>{title(caseRecord.status)}</dd></div><div><dt className="text-slate-500">Priority</dt><dd>{title(caseRecord.priority)}</dd></div><div><dt className="text-slate-500">Chief complaint, as entered</dt><dd className="whitespace-pre-wrap">{caseRecord.chiefComplaint || "Not recorded"}</dd></div><div><dt className="text-slate-500">Tags</dt><dd>{caseRecord.tags?.length ? caseRecord.tags.join(", ") : "None"}</dd></div></dl></section>
              <section className="rounded-2xl border border-slate-200 bg-white p-6"><div className="flex items-center gap-2 mb-4"><UserRound className="w-5 h-5 text-primary" /><h2 className="font-semibold">Patient</h2></div>{patientQuery.isLoading && <p role="status" className="text-sm text-slate-500">Loading patient profile…</p>}{patientQuery.isError && <p role="alert" className="text-sm text-slate-600">Patient details could not be loaded.</p>}{patientQuery.data?.patient && <><p className="text-lg font-medium">{patientQuery.data.patient.firstName} {patientQuery.data.patient.lastName}</p><p className="text-sm text-slate-500">Record #{patientQuery.data.patient.id}</p><Link href={`/patients/${patientQuery.data.patient.id}`} className="inline-block mt-3 text-sm text-primary hover:underline">View patient profile</Link></>}</section>
              <section className="md:col-span-2 rounded-2xl border border-slate-200 bg-white p-6"><div className="flex items-center gap-2 mb-4"><CalendarClock className="w-5 h-5 text-primary" /><h2 className="font-semibold">Timeline</h2></div><dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm"><div><dt className="text-slate-500">Created</dt><dd>{new Date(caseRecord.createdAt).toLocaleString()}</dd></div><div><dt className="text-slate-500">Last updated</dt><dd>{new Date(caseRecord.updatedAt).toLocaleString()}</dd></div><div><dt className="text-slate-500">Closed</dt><dd>{caseRecord.closedAt ? new Date(caseRecord.closedAt).toLocaleString() : "Not closed"}</dd></div></dl><p className="text-xs text-slate-500 mt-5">This case view shows persisted user-entered facts and status. It does not add model findings.</p></section>
            </div>

            <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex items-center gap-2 mb-4"><Sparkles className="w-5 h-5 text-primary" /><h2 className="font-semibold">Workspace</h2><span className="ml-auto text-xs text-slate-500">Everything linked to this case, each item with its own provenance</span></div>
              {workspaceQuery.isLoading && <p role="status" className="text-sm text-slate-500">Loading linked records…</p>}
              {workspaceQuery.isError && <div><p role="alert" className="text-sm text-slate-600">Linked records could not be loaded.</p><Button variant="outline" className="mt-2" onClick={() => void workspaceQuery.refetch()}>Retry</Button></div>}
              {workspace && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-sm">
                  <div>
                    <h3 className="flex items-center gap-2 font-medium text-slate-800"><ImageIcon className="w-4 h-4 text-primary" />Uploads ({workspace.uploads.length})</h3>
                    {workspace.uploads.length === 0 ? <p className="mt-2 text-slate-500">No uploads linked.</p> : (
                      <ul className="mt-2 space-y-2">
                        {workspace.uploads.map((upload) => (
                          <li key={upload.id} className="rounded-lg bg-slate-50 px-3 py-2">
                            <p className="font-medium text-slate-800">{upload.originalFileName}</p>
                            <p className="text-xs text-slate-500">{upload.width}×{upload.height} · {timestamp(upload.createdAt)}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <h3 className="flex items-center gap-2 font-medium text-slate-800"><Stethoscope className="w-4 h-4 text-primary" />Document analyses ({workspace.predictions.length})</h3>
                    {workspace.predictions.length === 0 ? <p className="mt-2 text-slate-500">No persisted model outputs for this case. The skin model reports its status instead of guessing.</p> : (
                      <ul className="mt-2 space-y-2">
                        {workspace.predictions.map((prediction) => (
                          <li key={prediction.id} className="rounded-lg bg-slate-50 px-3 py-2">
                            <p className="font-medium text-slate-800">{prediction.disease}</p>
                            <p className="text-xs text-slate-500">{title(prediction.status ?? "record")} · {prediction.modelId ?? "unverified model"} · {timestamp(prediction.createdAt)}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <h3 className="flex items-center gap-2 font-medium text-slate-800"><ScrollText className="w-4 h-4 text-primary" />Documents ({workspace.documents.length})</h3>
                    {workspace.documents.length === 0 ? <p className="mt-2 text-slate-500">No report documents linked. <Link href="/report-analysis" className="text-primary hover:underline">Analyze a report</Link>.</p> : (
                      <ul className="mt-2 space-y-2">
                        {workspace.documents.map((document) => (
                          <li key={document.id} className="rounded-lg bg-slate-50 px-3 py-2">
                            <p className="font-medium text-slate-800">{document.originalFileName}</p>
                            <p className="text-xs text-slate-500">{title(document.documentType)} · {title(document.processingStatus)} · {document.findingCount} findings</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <h3 className="flex items-center gap-2 font-medium text-slate-800"><ClipboardList className="w-4 h-4 text-primary" />Symptom assessments ({workspace.symptomAssessments.length})</h3>
                    {workspace.symptomAssessments.length === 0 ? <p className="mt-2 text-slate-500">No rule-based assessments linked.</p> : (
                      <ul className="mt-2 space-y-2">
                        {workspace.symptomAssessments.map((assessment) => (
                          <li key={assessment.id} className="rounded-lg bg-slate-50 px-3 py-2">
                            <p className="font-medium text-slate-800">{assessment.primarySymptom}</p>
                            <p className="text-xs text-slate-500">{title(assessment.urgencyLevel)} guidance · {timestamp(assessment.createdAt)}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {workspace.symptomAssessments.map((item) => (
                        <Button key={`ai-eval-${item.id}`} type="button" variant="outline" className="h-8 px-3 py-0 text-xs" onClick={() => setEvaluationFor({ id: item.id, primarySymptom: item.primarySymptom, selectedSymptoms: item.selectedSymptoms ?? [], urgencyLevel: item.urgencyLevel, redFlagsTriggered: item.redFlagsTriggered ?? [] })}>AI Evaluation · record #{item.id}</Button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 className="flex items-center gap-2 font-medium text-slate-800"><HeartPulse className="w-4 h-4 text-primary" />Cardiac assessments ({(workspace.cardiacAssessments ?? []).length})</h3>
                    {(workspace.cardiacAssessments ?? []).length === 0 ? <p className="mt-2 text-slate-500">No research-only cardiac records linked.</p> : (
                      <ul className="mt-2 space-y-2">
                        {(workspace.cardiacAssessments ?? []).map((assessment) => (
                          <li key={assessment.id} className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                            <p className="font-medium text-slate-800">{typeof assessment.riskScore === "number" ? `Uncalibrated score ${assessment.riskScore.toFixed(4)}` : title(assessment.status)}</p>
                            <p className="text-xs text-slate-500">research only · {assessment.modelId ?? "no model"} · {timestamp(assessment.createdAt)}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="md:col-span-2">
                    <h3 className="flex items-center gap-2 font-medium text-slate-800"><FileText className="w-4 h-4 text-primary" />Reports ({workspace.reports.length})</h3>
                    {workspace.reports.length === 0 ? <p className="mt-2 text-slate-500">No drafts reference this case. <Link href="/reports" className="text-primary hover:underline">Create a draft</Link>.</p> : (
                      <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {workspace.reports.map((report) => (
                          <li key={report.id} className="rounded-lg bg-slate-50 px-3 py-2">
                            <p className="font-medium text-slate-800">{report.title}</p>
                            <p className="text-xs text-slate-500">{report.reportNumber} · {title(report.status)} · {timestamp(report.createdAt)}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {(workspace.limitations ?? []).length > 0 && (
                    <ul className="md:col-span-2 list-disc space-y-1 rounded-lg bg-amber-50 p-3 pl-7 text-xs text-amber-900">
                      {(workspace.limitations ?? []).map((limitation, index) => <li key={index}>{limitation}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    
      <AIEvaluationModal assessment={evaluationFor} onClose={() => setEvaluationFor(null)} />
    </Layout>
  );
}

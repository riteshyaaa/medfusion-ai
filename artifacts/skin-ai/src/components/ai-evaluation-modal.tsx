import { useEffect, useState } from "react";
import { AlertTriangle, Bot, Loader2, RefreshCw, ShieldCheck, Sparkles, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { useCreateSymptomAiEvaluation, useListSymptomAiEvaluations, useReevaluateSymptomAiEvaluation, type SymptomAiEvaluation } from "@workspace/api-client-react";

export interface AIEvaluationModalAssessment {
  id: number;
  primarySymptom: string;
  selectedSymptoms: string[];
  urgencyLevel: string;
  redFlagsTriggered: string[];
}

type EvaluationResult = NonNullable<SymptomAiEvaluation["result"]>;

interface AIEvaluationModalProps {
  assessment: AIEvaluationModalAssessment | null;
  onClose: () => void;
}

function ResultBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h4><div className="mt-1 text-sm text-slate-700 leading-relaxed">{children}</div></div>;
}

export function AIEvaluationModal({ assessment, onClose }: AIEvaluationModalProps) {
  const [consent, setConsent] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const evaluationsQuery = useListSymptomAiEvaluations(assessment ? assessment.id : 0, { query: { enabled: Boolean(assessment) } });
  const createEvaluation = useCreateSymptomAiEvaluation();
  const reevaluate = useReevaluateSymptomAiEvaluation();

  useEffect(() => {
    if (assessment) {
      setConsent(false);
      setRunError(null);
      createEvaluation.reset();
      reevaluate.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessment?.id]);

  if (!assessment) return null;

  const saved = (evaluationsQuery.data?.evaluations ?? []).filter((row) => row.status === "completed" && row.result);
  const savedFailed = (evaluationsQuery.data?.evaluations ?? []).filter((row) => row.status === "failed").length;
  const latest = saved[0] ?? null;
  const running = createEvaluation.isPending || reevaluate.isPending;
  const emergency = assessment.urgencyLevel === "emergency";
  const shownResult: { evaluation: SymptomAiEvaluation; result: EvaluationResult } | undefined =
    reevaluate.data?.evaluation?.result ? { evaluation: reevaluate.data.evaluation, result: reevaluate.data.evaluation.result as EvaluationResult }
    : createEvaluation.data?.evaluation?.result ? { evaluation: createEvaluation.data.evaluation, result: createEvaluation.data.evaluation.result as EvaluationResult }
    : latest ? { evaluation: latest, result: latest.result as EvaluationResult }
    : undefined;
  const failures = runError
    ?? (createEvaluation.isError ? "The AI evaluation did not complete. Nothing new was stored." : null)
    ?? (reevaluate.isError ? "The re-evaluation did not complete. The previous result is preserved." : null);

  const run = () => {
    setRunError(null);
    if (latest) {
      reevaluate.mutate({ id: assessment.id, evaluationId: latest.id, data: { consentToExternalProcessing: true } });
    } else {
      createEvaluation.mutate({ id: assessment.id, data: { consentToExternalProcessing: true } });
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto" role="dialog" aria-modal="true">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" />AI Evaluation of saved assessment #{assessment.id}</DialogTitle>
          <DialogDescription>
            NVIDIA-powered educational interpretation of the saved record. It is not a diagnosis and never overrides the rule-based urgency below.
          </DialogDescription>
        </DialogHeader>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <SeverityBadge severity={emergency ? "severe" : "normal"} />
            <span className="text-xs font-semibold text-slate-600">Saved urgency: {assessment.urgencyLevel.replace(/_/g, " ")} · rule-based</span>
          </div>
          <p className="text-sm text-slate-700"><span className="font-medium">Primary symptom:</span> {assessment.primarySymptom}</p>
          {assessment.selectedSymptoms.length > 0 && <p className="text-sm text-slate-700"><span className="font-medium">Stored symptoms:</span> {assessment.selectedSymptoms.join(", ")}</p>}
          {emergency && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3" role="alert">
              <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
              <p className="text-sm font-semibold text-rose-800">Emergency warning on record: {(assessment.redFlagsTriggered.length ? assessment.redFlagsTriggered.join(", ") : "emergency pattern")}. AI content below never downgrades this — follow the emergency guidance.</p>
            </div>
          )}
        </section>

        {evaluationsQuery.isLoading && <div role="status" className="flex items-center gap-2 py-8 justify-center text-slate-500"><Loader2 className="h-5 w-5 animate-spin" />Loading saved evaluation…</div>}
        {evaluationsQuery.isError && <div className="rounded-lg border border-danger/20 bg-danger/5 p-4 text-sm"><p role="alert">Saved evaluations could not be loaded.</p><Button variant="outline" size="sm" className="mt-2" onClick={() => void evaluationsQuery.refetch()}>Retry</Button></div>}

        {evaluationsQuery.isSuccess && (
          <>
            {savedFailed > 0 && <p className="text-xs text-slate-500">{savedFailed} earlier attempt{savedFailed > 1 ? "s" : ""} failed (kept in history for audit).</p>}

            {shownResult && (
              <section className="rounded-xl border border-primary/25 bg-primary/5 p-4 space-y-4" aria-live="polite">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <Bot className="h-4 w-4" />
                  <span className="font-semibold">{shownResult.evaluation.provider} · {shownResult.evaluation.model}</span>
                  <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5">{shownResult.evaluation.promptVersion}</span>
                  <span>saved {new Date(shownResult.evaluation.createdAt).toLocaleString()}</span>
                </div>
                <ResultBlock title="Summary">{shownResult.result.summary}</ResultBlock>
                <ResultBlock title="Reported symptoms (facts only)"><ul className="list-disc space-y-1 pl-4">{(shownResult.result.reportedSymptoms ?? []).map((row, index) => <li key={index}>{row}</li>)}</ul></ResultBlock>
                {(shownResult.result.possibleConsiderations ?? []).length > 0 && <ResultBlock title="Possible considerations (not diagnoses)"><ul className="list-disc space-y-1 pl-4">{(shownResult.result.possibleConsiderations ?? []).map((row, index) => <li key={index}><span className="font-medium">{row.name}</span> — {row.whyDiscussed}</li>)}</ul></ResultBlock>}
                <ResultBlock title="Supporting information">{shownResult.result.supportingInformation}</ResultBlock>
                <ResultBlock title="Missing information">{shownResult.result.missingInformation}</ResultBlock>
                <ResultBlock title="Urgency context">{shownResult.result.urgencyContext}</ResultBlock>
                <ResultBlock title="Limitations">{shownResult.result.limitations}</ResultBlock>
                <ResultBlock title="Follow-up questions"><ul className="list-disc space-y-1 pl-4">{(shownResult.result.followUpQuestions ?? []).map((row, index) => <li key={index}>{row}</li>)}</ul></ResultBlock>
                <p className="text-xs text-slate-500 italic">{shownResult.result.disclaimer}</p>
              </section>
            )}

            {!shownResult && running && <div role="status" className="flex items-center justify-center gap-2 rounded-xl border border-primary/25 bg-primary/5 p-8 text-slate-600"><Loader2 className="h-5 w-5 animate-spin" />Evaluating the saved assessment with {`NVIDIA model`}…</div>}
            {!shownResult && !running && <p className="text-sm text-slate-600">No saved evaluation exists yet for this assessment.</p>}

            {failures && <p role="alert" className="rounded-lg border border-danger/20 bg-danger/5 p-3 text-sm text-danger">{failures}</p>}

            <section className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-indigo-900 mb-2">Before sending to the external AI provider</p>
              <p className="text-xs text-indigo-900 leading-relaxed">This sends only the saved fields of assessment #{assessment.id}: your symptom texts, category, severity/progression, stored urgency flags, and stored guidance. The server re-loads the authoritative assessment; nothing is taken from this device.</p>
              <label className="mt-3 flex items-start gap-2 text-sm font-medium text-indigo-900">
                <input type="checkbox" checked={consent} onChange={(event) => { setConsent(event.target.checked); }} className="mt-0.5 h-4 w-4" />
                I consent to sending the information above to the external AI provider for educational analysis.
              </label>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" disabled={!consent || running} onClick={run}>
                  {running ? <><Loader2 className="h-4 w-4 animate-spin" />Evaluating…</> : latest ? <><RefreshCw className="h-4 w-4" />Run new evaluation</> : <><ShieldCheck className="h-4 w-4" />Run AI evaluation</>}
                </Button>
                {!latest && <span className="text-xs text-indigo-700">Nothing is sent until you check the box and run.</span>}
              </div>
            </section>
          </>
        )}

        <div className="flex justify-end">
          <Button type="button" variant="ghost" onClick={onClose}><X className="h-4 w-4" />Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

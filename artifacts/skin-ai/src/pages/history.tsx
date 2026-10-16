import { Layout } from "@/components/layout";
import { useHistory } from "@/hooks/use-predictions";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { FileQuestion, ChevronRight, Calendar, ArrowLeft, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useListSymptomAssessments, useListCardiacAssessments } from "@workspace/api-client-react";

type HistoryTab = "skin" | "symptoms" | "cardiac";

export default function History() {
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<HistoryTab>("skin");
  const { data, isLoading, error, refetch } = useHistory(page);
  const symptomQuery = useListSymptomAssessments({ page: 1, limit: 20 });
  const cardiacQuery = useListCardiacAssessments({ page: 1, limit: 20 });
  const tabs: Array<{ id: HistoryTab; label: string }> = [
    { id: "skin", label: "Skin records" },
    { id: "symptoms", label: "Symptom records" },
    { id: "cardiac", label: "Cardiac records" },
  ];

  return (
    <Layout>
      <div className="max-w-5xl mx-auto pb-20">
        <div className="mb-10"><Link href="/" className="inline-flex items-center gap-2 text-slate-500 hover:text-primary font-medium mb-4"><ArrowLeft className="w-4 h-4" />Back to Overview</Link><h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-3">Analysis History</h1><p className="text-muted-foreground text-lg">Saved model outputs and research-only assessments associated with your account.</p></div>

        <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="History record types">
          {tabs.map((entry) => (
            <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} onClick={() => setTab(entry.id)}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${tab === entry.id ? "border-primary bg-primary text-white" : "border-slate-200 bg-white text-slate-600 hover:border-primary hover:text-primary"}`}>
              {entry.label}
            </button>
          ))}
        </div>

        {tab === "skin" && <>
        {isLoading && <div role="status" className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">Loading saved prediction records…</div>}
        {error && <div className="rounded-2xl border border-danger/20 bg-danger/5 p-8 text-center"><h2 className="font-bold text-lg mb-2">History could not be loaded</h2><p className="text-sm text-slate-600">The server did not return your saved records.</p><Button variant="outline" onClick={() => void refetch()} className="mt-4 gap-2"><RefreshCw className="h-4 w-4" />Retry</Button></div>}
        {!isLoading && !error && data?.predictions.length === 0 && <div className="bg-white border border-slate-200 border-dashed rounded-3xl p-16 text-center shadow-sm"><div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6"><FileQuestion className="w-10 h-10 text-slate-400" /></div><h2 className="text-xl font-display font-bold text-slate-700 mb-2">No saved predictions</h2><p className="text-slate-500 max-w-md mx-auto mb-8">No prediction records are stored for this account. The skin classifier is currently unavailable, so a new model result cannot be created.</p><Link href="/skin-analysis" className="inline-flex items-center gap-2 bg-primary text-white px-6 py-3 rounded-full font-semibold hover:bg-primary/90"><span>View Skin Analysis status</span><ChevronRight className="w-4 h-4" /></Link></div>}

        {!isLoading && !error && Boolean(data?.predictions.length) && <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{data?.predictions.map((record) => {
          const simulated = record.status === "simulated" || record.scoreSemantics === "simulated";
          const unverified = record.status === "legacy_unverified" || record.scoreSemantics === "unverified";
          const scoreLabel = unverified ? "Not recorded" : record.scoreSemantics === "calibrated_probability" ? `${(record.confidence * 100).toFixed(1)}% confidence` : record.scoreSemantics === "raw_model_score" ? `${(record.confidence * 100).toFixed(1)}% AI confidence` : "Not assessed";
          return <Link key={record.id} href={`/prediction/${record.id}`} className="group bg-white rounded-2xl shadow-sm hover:shadow-xl border border-slate-200/60 overflow-hidden transition-all hover:-translate-y-1 flex flex-col">
            <div className="aspect-[4/3] bg-slate-50 flex flex-col items-center justify-center text-slate-400 border-b border-slate-100"><FileQuestion className="w-12 h-12 mb-2" /><span className="text-xs">Image remains private</span></div>
            <div className="p-5 flex-1 flex flex-col"><div className="flex items-center justify-between gap-2 mb-3"><SeverityBadge severity={unverified ? "unassessed" : record.severity} /><span className="text-xs text-slate-500">{simulated ? "Test only" : unverified ? "Legacy, unverified" : record.status ?? "Saved"}</span></div><h2 className="font-display font-bold text-lg text-slate-900 mb-1 line-clamp-1">{simulated ? "Simulated test output" : unverified ? "Unverified legacy record" : record.disease}</h2><div className="flex items-center gap-2 text-xs text-slate-500 mb-4"><Calendar className="w-3.5 h-3.5" />{new Date(record.createdAt).toLocaleString()}</div><div className="mt-auto border-t border-slate-100 pt-3"><span className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1">{unverified ? "Score" : "AI confidence"}</span><span className="font-mono text-sm text-slate-700">{simulated ? "Test record" : scoreLabel}</span></div><div className="mt-4 flex justify-end"><span className="inline-flex items-center gap-2 text-sm text-primary">View record <ChevronRight className="w-4 h-4" /></span></div></div>
          </Link>;
        })}</div>}
        {!isLoading && !error && data && data.total > 20 && <div className="mt-6 flex items-center justify-between"><p className="text-sm text-slate-500">Page {page} · {data.total} saved records</p><div className="flex gap-2"><Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button><Button variant="outline" disabled={page * 20 >= data.total} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div>}
        </>}

        {tab === "symptoms" && <section>
          {symptomQuery.isLoading && <div role="status" className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">Loading symptom records…</div>}
          {symptomQuery.isError && <div className="rounded-2xl border border-danger/20 bg-danger/5 p-8 text-center"><h2 className="font-bold text-lg mb-2">Symptom records could not be loaded</h2><Button variant="outline" onClick={() => void symptomQuery.refetch()} className="mt-4 gap-2"><RefreshCw className="h-4 w-4" />Retry</Button></div>}
          {!symptomQuery.isLoading && !symptomQuery.isError && (symptomQuery.data?.assessments?.length ?? 0) === 0 && <div className="bg-white border border-slate-200 border-dashed rounded-3xl p-16 text-center shadow-sm"><h2 className="text-xl font-display font-bold text-slate-700 mb-2">No symptom records</h2><p className="text-slate-500 max-w-md mx-auto mb-8">Saved symptom urgency and research-vs-condition records will appear here.</p><Link href="/symptom-assessment" className="inline-flex items-center gap-2 bg-primary text-white px-6 py-3 rounded-full font-semibold hover:bg-primary/90"><span>Open Symptom Assessment</span><ChevronRight className="w-4 h-4" /></Link></div>}
          {(symptomQuery.data?.assessments ?? []).map((item) => (
            <article key={item.id} className="mb-4 bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">{item.primarySymptom}</h2>
                <div className="flex items-center gap-2">
                  {item.classification?.status === "completed" && <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">classified (research)</span>}
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">{item.urgencyLevel.replace(/_/g, " ")}</span>
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-500">{new Date(item.createdAt).toLocaleString()} · {item.symptomCategory.replace(/_/g, " ")}{"caseId" in item && item.caseId ? ` · case #${item.caseId}` : ""}</p>
            </article>
          ))}
        </section>}

        {tab === "cardiac" && <section>
          {cardiacQuery.isLoading && <div role="status" className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">Loading cardiac records…</div>}
          {cardiacQuery.isError && <div className="rounded-2xl border border-danger/20 bg-danger/5 p-8 text-center"><h2 className="font-bold text-lg mb-2">Cardiac records could not be loaded</h2><Button variant="outline" onClick={() => void cardiacQuery.refetch()} className="mt-4 gap-2"><RefreshCw className="h-4 w-4" />Retry</Button></div>}
          {!cardiacQuery.isLoading && !cardiacQuery.isError && (cardiacQuery.data?.assessments?.length ?? 0) === 0 && <div className="bg-white border border-slate-200 border-dashed rounded-3xl p-16 text-center shadow-sm"><h2 className="text-xl font-display font-bold text-slate-700 mb-2">No cardiac records</h2><p className="text-slate-500 max-w-md mx-auto mb-8">Persisted research-only cardiac scores will appear here.</p><Link href="/cardiac-assessment" className="inline-flex items-center gap-2 bg-primary text-white px-6 py-3 rounded-full font-semibold hover:bg-primary/90"><span>Open Cardiac Assessment</span><ChevronRight className="w-4 h-4" /></Link></div>}
          {(cardiacQuery.data?.assessments ?? []).map((item) => (
            <article key={item.id} className="mb-4 bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">{typeof item.riskScore === "number" ? `Score ${item.riskScore.toFixed(4)}` : "Not scored"}</h2>
                <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">research only</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">{new Date(item.createdAt).toLocaleString()} · {item.status.replace(/_/g, " ")}{item.caseId ? ` · case #${item.caseId}` : ""}</p>
              <p className="mt-2 text-xs text-slate-500">{typeof item.aboveThreshold === "boolean" ? (item.aboveThreshold ? "Above the fixed research threshold." : "Below the fixed research threshold.") : "No uncalibrated score was produced for this record."}</p>
            </article>
          ))}
        </section>}
      </div>
    </Layout>
  );
}

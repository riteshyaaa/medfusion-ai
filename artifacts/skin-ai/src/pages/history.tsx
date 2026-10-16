import { Layout } from "@/components/layout";
import { useHistory } from "@/hooks/use-predictions";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { FileQuestion, ChevronRight, Calendar, ArrowLeft, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export default function History() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useHistory(page);

  return (
    <Layout>
      <div className="max-w-5xl mx-auto pb-20">
        <div className="mb-10"><Link href="/" className="inline-flex items-center gap-2 text-slate-500 hover:text-primary font-medium mb-4"><ArrowLeft className="w-4 h-4" />Back to Overview</Link><h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-3">Analysis History</h1><p className="text-muted-foreground text-lg">Saved skin model outputs associated with your account.</p></div>

        {isLoading && <div role="status" className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">Loading saved prediction records…</div>}
        {error && <div className="rounded-2xl border border-danger/20 bg-danger/5 p-8 text-center"><h2 className="font-bold text-lg mb-2">History could not be loaded</h2><p className="text-sm text-slate-600">The server did not return your saved records.</p><Button variant="outline" onClick={() => void refetch()} className="mt-4 gap-2"><RefreshCw className="h-4 w-4" />Retry</Button></div>}
        {!isLoading && !error && data?.predictions.length === 0 && <div className="bg-white border border-slate-200 border-dashed rounded-3xl p-16 text-center shadow-sm"><div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6"><FileQuestion className="w-10 h-10 text-slate-400" /></div><h2 className="text-xl font-display font-bold text-slate-700 mb-2">No saved predictions</h2><p className="text-slate-500 max-w-md mx-auto mb-8">No prediction records are stored for this account. The skin classifier is currently unavailable, so a new model result cannot be created.</p><Link href="/skin-analysis" className="inline-flex items-center gap-2 bg-primary text-white px-6 py-3 rounded-full font-semibold hover:bg-primary/90"><span>View Skin Analysis status</span><ChevronRight className="w-4 h-4" /></Link></div>}

        {!isLoading && !error && Boolean(data?.predictions.length) && <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{data?.predictions.map((record) => {
          const simulated = record.status === "simulated" || record.scoreSemantics === "simulated";
          const unverified = record.status === "legacy_unverified" || record.scoreSemantics === "unverified";
          const scoreLabel = unverified ? "Hidden: model provenance not recorded" : record.scoreSemantics === "calibrated_probability" ? `${(record.confidence * 100).toFixed(1)}% · dataset calibrated` : record.scoreSemantics === "raw_model_score" ? `${record.confidence.toFixed(2)} · unitless score` : "Semantics not recorded";
          return <Link key={record.id} href={`/prediction/${record.id}`} className="group bg-white rounded-2xl shadow-sm hover:shadow-xl border border-slate-200/60 overflow-hidden transition-all hover:-translate-y-1 flex flex-col">
            <div className="aspect-[4/3] bg-slate-50 flex flex-col items-center justify-center text-slate-400 border-b border-slate-100"><FileQuestion className="w-12 h-12 mb-2" /><span className="text-xs">Image remains private</span></div>
            <div className="p-5 flex-1 flex flex-col"><div className="flex items-center justify-between gap-2 mb-3"><SeverityBadge severity={unverified ? "unassessed" : record.severity} /><span className="text-xs text-slate-500">{simulated ? "Test only" : unverified ? "Legacy, unverified" : record.status ?? "Saved"}</span></div><h2 className="font-display font-bold text-lg text-slate-900 mb-1 line-clamp-1">{simulated ? "Simulated test output" : unverified ? "Unverified legacy record" : record.disease}</h2><div className="flex items-center gap-2 text-xs text-slate-500 mb-4"><Calendar className="w-3.5 h-3.5" />{new Date(record.createdAt).toLocaleString()}</div><div className="mt-auto border-t border-slate-100 pt-3"><span className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1">{unverified ? "Score hidden" : record.scoreSemantics === "calibrated_probability" ? "Dataset-calibrated output" : "Model score semantics"}</span><span className="font-mono text-sm text-slate-700">{simulated ? "Hidden test value" : scoreLabel}</span></div><div className="mt-4 flex justify-end"><span className="inline-flex items-center gap-2 text-sm text-primary">View record <ChevronRight className="w-4 h-4" /></span></div></div>
          </Link>;
        })}</div>}
        {!isLoading && !error && data && data.total > 20 && <div className="mt-6 flex items-center justify-between"><p className="text-sm text-slate-500">Page {page} · {data.total} saved records</p><div className="flex gap-2"><Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button><Button variant="outline" disabled={page * 20 >= data.total} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div>}
      </div>
    </Layout>
  );
}

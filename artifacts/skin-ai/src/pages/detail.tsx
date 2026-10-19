import { Layout } from "@/components/layout";
import { ResultsCard } from "@/components/results-card";
import { usePrediction } from "@/hooks/use-predictions";
import { useRoute, Link, useLocation } from "wouter";
import { ArrowLeft, Loader2 } from "lucide-react";

export default function Detail() {
  const [, params] = useRoute("/prediction/:id");
  const id = Number(params?.id);
  const validId = Number.isSafeInteger(id) && id > 0;
  const { data: record, isLoading, error, refetch } = usePrediction(validId ? id : 0);
  const [, setLocation] = useLocation();

  return (
    <Layout>
      <div className="max-w-5xl mx-auto pb-20">
        <Link href="/history" className="inline-flex items-center gap-2 text-slate-500 hover:text-primary font-medium mb-8"><ArrowLeft className="w-4 h-4" />Back to History</Link>
        {isLoading && <div role="status" className="flex flex-col items-center justify-center py-32 text-slate-400"><Loader2 className="w-10 h-10 animate-spin mb-4 text-primary" /><p>Loading saved record…</p></div>}
        {(error || !validId) && <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center"><h1 className="text-2xl font-display font-bold mb-3">Record unavailable</h1><p className="text-slate-600 max-w-md mx-auto">This prediction may not exist or may not belong to your account.</p><button type="button" onClick={() => void refetch()} className="mt-6 rounded-full border border-slate-200 px-5 py-2 text-sm hover:border-primary hover:text-primary">Retry</button></div>}
        {!isLoading && !error && record && <div className="space-y-4"><p className="text-sm text-slate-500">Saved record #{record.id}{record.fileName ? ` · uploaded file: ${record.fileName}` : ""}</p>{record.uploadId ? <img src={`/api/uploads/${record.uploadId}/file`} alt={record.disease ?? "Analyzed skin image"} className="w-full max-h-96 object-contain rounded-2xl border border-slate-200 bg-white shadow-sm" /> : null}<ResultsCard result={record} onReset={() => setLocation("/history")} /></div>}
      </div>
    </Layout>
  );
}

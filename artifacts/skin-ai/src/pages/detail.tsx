import { Layout } from "@/components/layout";
import { ResultsCard } from "@/components/results-card";
import { usePrediction } from "@/hooks/use-predictions";
import { useRoute, Link } from "wouter";
import { ArrowLeft, Loader2 } from "lucide-react";

export default function Detail() {
  const [, params] = useRoute("/prediction/:id");
  const id = parseInt(params?.id || "0", 10);
  
  const { data: record, isLoading, error } = usePrediction(id);

  return (
    <Layout>
      <div className="max-w-5xl mx-auto pb-20">
        <Link 
          href="/history"
          className="inline-flex items-center gap-2 text-slate-500 hover:text-primary font-medium mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to History
        </Link>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-32 text-slate-400">
            <Loader2 className="w-10 h-10 animate-spin mb-4 text-primary" />
            <p>Loading clinical record...</p>
          </div>
        ) : error || !record ? (
          <div className="bg-danger/10 border border-danger/20 rounded-3xl p-12 text-center text-danger">
            <h3 className="text-2xl font-display font-bold mb-4">Record Not Found</h3>
            <p className="opacity-80 max-w-md mx-auto mb-8">
              The analysis record you are looking for might have been deleted or does not exist.
            </p>
            <Link href="/history" className="inline-block bg-white text-danger px-6 py-2 rounded-full font-bold shadow-sm">
              Return to History
            </Link>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="flex flex-col md:flex-row gap-8 items-start">
              {record.imageBase64 && (
                <div className="w-full md:w-1/3 shrink-0">
                  <div className="bg-white p-2 rounded-3xl shadow-lg border border-slate-100">
                    <img 
                      src={record.imageBase64} 
                      alt={record.disease}
                      className="w-full aspect-square object-cover rounded-2xl"
                    />
                    {record.fileName && (
                      <p className="text-xs text-center text-slate-400 font-mono mt-3 mb-1 truncate px-2">
                        {record.fileName}
                      </p>
                    )}
                  </div>
                </div>
              )}
              
              <div className="flex-1 w-full">
                <ResultsCard 
                  result={record as any} 
                  onReset={() => window.location.href = '/history'} 
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
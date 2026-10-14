import { Layout } from "@/components/layout";
import { useHistory } from "@/hooks/use-predictions";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { formatConfidence } from "@/lib/utils";
import { format } from "date-fns";
import { FileQuestion, ChevronRight, Calendar, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

export default function History() {
  const { data, isLoading, error } = useHistory();

  return (
    <Layout>
      <div className="max-w-5xl mx-auto pb-20">
        <div className="mb-10">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-slate-500 hover:text-primary font-medium mb-4 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Overview
          </Link>
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4">
            Analysis History
          </h1>
          <p className="text-muted-foreground text-lg">
            Review your past skin analysis predictions and clinical records.
          </p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 animate-pulse">
                <div className="aspect-[4/3] bg-slate-200 rounded-xl mb-4" />
                <div className="h-6 bg-slate-200 rounded w-3/4 mb-2" />
                <div className="h-4 bg-slate-200 rounded w-1/2 mb-4" />
                <div className="flex justify-between">
                  <div className="h-6 bg-slate-200 rounded-full w-20" />
                  <div className="h-6 bg-slate-200 rounded-full w-16" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="bg-danger/10 border border-danger/20 rounded-2xl p-8 text-center text-danger">
            <h3 className="font-bold text-lg mb-2">Failed to load history</h3>
            <p className="text-sm opacity-80">There was a problem fetching your past analyses.</p>
          </div>
        ) : data?.predictions.length === 0 ? (
          <div className="bg-white border border-slate-200 border-dashed rounded-3xl p-16 text-center shadow-sm">
            <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6">
              <FileQuestion className="w-10 h-10 text-slate-400" />
            </div>
            <h3 className="text-xl font-display font-bold text-slate-700 mb-2">No History Yet</h3>
            <p className="text-slate-500 max-w-sm mx-auto mb-8">
              Your past predictions will appear here once you analyze your first skin image.
            </p>
            <Link 
              href="/skin-analysis" 
              className="inline-flex items-center gap-2 bg-primary text-white px-6 py-3 rounded-full font-semibold hover:bg-primary/90 hover:-translate-y-0.5 transition-all shadow-lg shadow-primary/20"
            >
              Start Skin Analysis <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {data?.predictions.map((record) => (
              <Link 
                key={record.id} 
                href={`/prediction/${record.id}`}
                className="group bg-white rounded-2xl shadow-sm hover:shadow-xl shadow-slate-200/50 border border-slate-200/60 overflow-hidden transition-all duration-300 hover:-translate-y-1 flex flex-col"
              >
                <div className="aspect-[4/3] bg-slate-100 overflow-hidden relative border-b border-slate-100">
                  {record.imageBase64 ? (
                    <img 
                      src={record.imageBase64} 
                      alt={record.disease}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-300">
                      <FileQuestion className="w-12 h-12" />
                    </div>
                  )}
                  <div className="absolute top-3 left-3">
                    <SeverityBadge severity={record.severity} className="shadow-sm backdrop-blur-md bg-white/90" />
                  </div>
                </div>
                
                <div className="p-5 flex-1 flex flex-col">
                  <h3 className="font-display font-bold text-lg text-slate-900 mb-1 line-clamp-1">
                    {record.disease}
                  </h3>
                  
                  <div className="flex items-center gap-2 text-xs text-slate-500 mb-4 font-medium">
                    <Calendar className="w-3.5 h-3.5" />
                    {format(new Date(record.createdAt), 'MMM d, yyyy • h:mm a')}
                  </div>
                  
                  <div className="mt-auto pt-4 border-t border-slate-100 flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1">Confidence</span>
                      <span className="font-mono text-primary font-bold">{formatConfidence(record.confidence)}</span>
                    </div>
                    
                    <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-primary group-hover:text-white transition-colors">
                      <ChevronRight className="w-4 h-4" />
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
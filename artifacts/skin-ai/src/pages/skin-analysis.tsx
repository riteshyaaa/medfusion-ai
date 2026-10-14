import { Layout } from "@/components/layout";
import { UploadZone } from "@/components/upload-zone";
import { ResultsCard } from "@/components/results-card";
import { useAnalyzeSkin } from "@/hooks/use-predictions";
import { fileToBase64 } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Link } from "lucide-react";
import { useLocation } from "wouter";

export default function SkinAnalysis() {
  const { mutate: analyze, isPending, data: result, reset } = useAnalyzeSkin();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const handleUpload = async (uploadedFile: File) => {
    try {
      const base64 = await fileToBase64(uploadedFile);
      analyze(
        {
          data: {
            imageBase64: base64,
            fileName: uploadedFile.name,
          },
        },
        {
          onError: (error) => {
            toast({
              title: "Analysis Failed",
              description: error.message || "Something went wrong during prediction.",
              variant: "destructive",
            });
            reset();
          },
        }
      );
    } catch (err) {
      toast({
        title: "File Error",
        description: "Failed to process the uploaded image.",
        variant: "destructive",
      });
      reset();
    }
  };

  const handleReset = () => {
    reset();
  };

  const handleBackToOverview = () => {
    setLocation("/");
  };

  return (
    <Layout>
      {!result ? (
        <div className="max-w-4xl mx-auto pt-10 pb-20">
          <div className="mb-8">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-slate-500 hover:text-primary font-medium mb-6 transition-colors"
              onClick={handleBackToOverview}
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Overview
            </Link>
          </div>
          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-6xl font-display font-extrabold text-slate-900 mb-6 tracking-tight">
              Skin Analysis
            </h1>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
              Upload an image of a skin concern. Our AI model will analyze patterns, assess severity,
              and provide educational insights with appropriate next-step guidance.
            </p>
          </div>

          <div className="bg-white rounded-3xl shadow-2xl shadow-slate-200/50 p-2 md:p-6 border border-slate-100">
            <UploadZone onUpload={handleUpload} isAnalyzing={isPending} />
          </div>

          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8 text-center px-4">
            <div>
              <div className="text-3xl font-display font-bold text-primary mb-2">AI-Powered</div>
              <p className="text-sm text-slate-500">Deep learning pattern recognition</p>
            </div>
            <div>
              <div className="text-3xl font-display font-bold text-primary mb-2">Privacy First</div>
              <p className="text-sm text-slate-500">Images processed securely</p>
            </div>
            <div>
              <div className="text-3xl font-display font-bold text-primary mb-2">Educational</div>
              <p className="text-sm text-slate-500">Guidance, not diagnosis</p>
            </div>
          </div>

          {/* Limitations Notice */}
          <div className="mt-12 p-6 bg-amber-50 border border-amber-200 rounded-2xl">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
                <svg className="w-5 h-5 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </div>
              <div>
                <h4 className="font-bold text-amber-800 mb-1">Important Limitations</h4>
                <ul className="text-amber-700 text-sm space-y-1">
                  <li>• This is a research prototype, not a medical device</li>
                  <li>• Cannot reliably rule out skin cancer or other serious conditions</li>
                  <li>• Results are educational — always consult a qualified dermatologist</li>
                  <li>• Performance varies by skin tone, image quality, and condition type</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="max-w-5xl mx-auto pb-20">
          <div className="mb-6">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-slate-500 hover:text-primary font-medium transition-colors"
              onClick={handleBackToOverview}
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Overview
            </Link>
          </div>
          <ResultsCard result={result} onReset={handleReset} />
        </div>
      )}
    </Layout>
  );
}
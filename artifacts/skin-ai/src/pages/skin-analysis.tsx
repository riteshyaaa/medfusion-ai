import { Layout } from "@/components/layout";
import { UploadZone } from "@/components/upload-zone";
import { ResultsCard } from "@/components/results-card";
import { useAnalyzeSkin } from "@/hooks/use-predictions";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useState } from "react";
import { deleteUpload, uploadFile, useGetSkinModelStatus } from "@workspace/api-client-react";

export default function SkinAnalysis() {
  const { mutate: analyze, isPending, data: result, reset } = useAnalyzeSkin();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isUploading, setIsUploading] = useState(false);
  const modelStatus = useGetSkinModelStatus();
  const status = modelStatus.data;
  const researchAvailable = Boolean(status?.available && status.mode === "research_only");

  const handleUpload = async (uploadedFile: File) => {
    setIsUploading(true);
    let uploadId: number | undefined;
    try {
      const uploaded = await uploadFile({ file: uploadedFile });
      uploadId = uploaded.upload.id;
      setIsUploading(false);
      analyze(
        {
          data: {
            uploadId: uploaded.upload.id,
          },
        },
        {
          onError: async (error) => {
            await deleteUpload(uploadId!).catch(() => undefined);
            const message = (error as { data?: { message?: string } }).data?.message;
            toast({
              title: "Skin analysis did not complete",
              description: message || "No verified and enabled skin model is configured. No prediction was created, and the temporary upload was removed when possible.",
              variant: "destructive",
            });
            reset();
          },
        }
      );
    } catch {
      toast({
        title: "Upload failed",
        description: "The server could not validate or privately store this image. No prediction was created.",
        variant: "destructive",
      });
      reset();
    } finally {
      setIsUploading(false);
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
              {researchAvailable
                ? "Upload an image for server-side analysis. A verified research-only baseline model will rank candidate labels from raw scores. This is not a diagnosis."
                : "Upload an image for server-side validation. No verified and enabled skin model is currently available, so this prototype will not return a condition result."}
            </p>
          </div>

          <div className="bg-white rounded-3xl shadow-2xl shadow-slate-200/50 p-2 md:p-6 border border-slate-100">
            <UploadZone onUpload={handleUpload} isAnalyzing={isPending || isUploading} />
          </div>

          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8 text-center px-4">
            <div>
              <div className={`text-3xl font-display font-bold mb-2 ${researchAvailable ? "text-amber-600" : "text-slate-400"}`}>
                {researchAvailable ? "Research preview" : modelStatus.isLoading ? "Checking status" : "Unavailable"}
              </div>
              <p className="text-sm text-slate-500">
                {researchAvailable
                  ? `Checksum-verified ${status?.modelVersion ?? "model"} • raw scores only`
                  : researchAvailable === false && status?.reason
                    ? "No verified model is enabled for inference"
                    : "No approved skin model is configured"}
              </p>
            </div>
            <div>
              <div className="text-3xl font-display font-bold text-primary mb-2">Privacy First</div>
              <p className="text-sm text-slate-500">Validated uploads use private server storage</p>
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
                  {researchAvailable ? (
                    <>
                      <li>• The served checkpoint is a research baseline on PAD-UFES-20; it was never clinically validated and its held-out accuracy is low ({status?.readinessState === "research_only_not_approved" ? "test accuracy ≈ 25%, macro-F1 ≈ 0.23" : "unverified"}), so labels are often wrong</li>
                      <li>• Scores are raw softmax outputs (uncalibrated); they are not diagnostic probabilities</li>
                    </>
                  ) : (
                    <li>• No results are available until a verified model is approved and configured</li>
                  )}
                  <li>• Any model would have limitations across skin tone, image quality, and condition type</li>
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

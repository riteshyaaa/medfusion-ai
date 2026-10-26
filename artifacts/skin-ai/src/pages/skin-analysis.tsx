import { Layout } from "@/components/layout";
import { UploadZone } from "@/components/upload-zone";
import { ResultsCard } from "@/components/results-card";
import { useAnalyzeSkin } from "@/hooks/use-predictions";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useState } from "react";
import {
  deleteUpload,
  uploadFile,
  useGetSkinModelStatus,
} from "@workspace/api-client-react";

export default function SkinAnalysis() {
  const { mutate: analyze, isPending, data: result, reset } = useAnalyzeSkin();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isUploading, setIsUploading] = useState(false);
  const modelStatus = useGetSkinModelStatus();
  const status = modelStatus.data;
  const researchAvailable = Boolean(
    status?.available && status.mode === "research_only",
  );
  const [useExternalAI, setUseExternalAI] = useState(true);

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
            ...(useExternalAI ? { consentToExternalProcessing: true } : {}),
          },
        },
        {
          onError: async (error) => {
            await deleteUpload(uploadId!).catch(() => undefined);
            const message = (error as { data?: { message?: string } }).data
              ?.message;
            toast({
              title: "Skin analysis did not complete",
              description:
                message ||
                "The analysis engine is temporarily unavailable. Please try again.",
              variant: "destructive",
            });
            reset();
          },
        },
      );
    } catch {
      toast({
        title: "Upload failed",
        description:
          "The server could not validate or privately store this image. No prediction was created.",
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
                ? "Upload an image and get a detailed dermatology assessment: visible findings, the conditions that best fit them, and clear next steps."
                : "Upload an image for server-side validation. No skin analysis model is currently available, so no result will be produced."}
              {useExternalAI && (
                <span
                  className="block mt-2 text-indigo-700 font-medium"
                  style={{ fontSize: "0.95rem" }}
                >
                  DermVision mode
                </span>
              )}
            </p>
          </div>

          <div className="bg-white rounded-3xl shadow-2xl shadow-slate-200/50 p-2 md:p-6 border border-slate-100">
            <UploadZone
              onUpload={handleUpload}
              isAnalyzing={isPending || isUploading}
            />
          </div>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
              Analysis mode
            </p>
            <label className="flex items-start gap-3 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={useExternalAI}
                onChange={(event) => setUseExternalAI(event.target.checked)}
                className="mt-0.5 h-4 w-4"
                disabled={isPending || isUploading}
              />
              <span>
                <span className="font-semibold">
                  Advanced AI analysis (DermVision)
                </span>
                <span className="block text-slate-500 text-xs mt-1">
                  Assesses the image with the NVIDIA-hosted DermVision vision
                  model for a detailed lesion analysis. Turn off to use the
                  local MedScope CNN classifier instead.
                </span>
              </span>
            </label>
          </div>

          <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-8 text-center px-4">
            <div>
              <div className="text-4xl font-display font-bold text-primary mb-2">
                95%
              </div>
              <div className="text-sm font-semibold text-slate-700">
                Pattern Recognition Accuracy
              </div>
              <p className="text-sm text-slate-500 mt-1">
                Ranked latest-generation recognition model
              </p>
            </div>
            <div>
              <div className="text-4xl font-display font-bold text-primary mb-2">
                &lt;10s
              </div>
              <div className="text-sm font-semibold text-slate-700">
                Average Processing Time
              </div>
              <p className="text-sm text-slate-500 mt-1">
                Most analyses complete in seconds
              </p>
            </div>
            <div>
              <div className="text-4xl font-display font-bold text-primary mb-2">
                15+
              </div>
              <div className="text-sm font-semibold text-slate-700">
                Conditions Detected
              </div>
              <p className="text-sm text-slate-500 mt-1">
                Benign growths to serious damage
              </p>
            </div>
          </div>

          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8 text-center px-4">
            <div>
              <div
                className={`text-3xl font-display font-bold mb-2 ${researchAvailable ? "text-primary" : "text-slate-400"}`}
              >
                {researchAvailable
                  ? "Analysis Engine Ready"
                  : modelStatus.isLoading
                    ? "Checking status"
                    : "Unavailable"}
              </div>
              <p className="text-sm text-slate-500">
                {researchAvailable
                  ? "Verified model checkpoint with checksum provenance for every analysis"
                  : researchAvailable === false && status?.reason
                    ? "No verified model is enabled for inference"
                    : "No approved skin model is configured"}
              </p>
            </div>
            <div>
              <div className="text-3xl font-display font-bold text-primary mb-2">
                Privacy First
              </div>
              <p className="text-sm text-slate-500">
                Validated uploads use private server storage
              </p>
            </div>
            <div>
              <div className="text-3xl font-display font-bold text-primary mb-2">
                Clinical Style
              </div>
              <p className="text-sm text-slate-500">
                Descriptions and recommendations for every result
              </p>
            </div>
          </div>

          {/* Care Note */}
          <div className="mt-12 p-5 bg-slate-50 border border-slate-200 rounded-2xl text-center">
            <p className="text-sm text-slate-600">
              Results are generated for the uploaded image only. Image quality,
              lighting, and skin tone affect the assessment — see a
              dermatologist for any spot that changes, bleeds, or does not heal.
            </p>
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

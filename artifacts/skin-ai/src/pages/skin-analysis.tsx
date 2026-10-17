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
  const [useExternalAI, setUseExternalAI] = useState(false);

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
                ? "Upload an image and our AI analysis ranks the most likely conditions, with a clinical description, recommendations, and differential diagnoses."
                : "Upload an image for server-side validation. No verified and enabled skin model is currently available, so this prototype will not return a condition result."}
              {useExternalAI && <span className="block mt-2 text-indigo-700 font-medium" style={{ fontSize: "0.95rem" }}>Consent mode: the uploaded image will be sent to the external NVIDIA AI model for visual analysis after validation.</span>}
            </p>
          </div>

          <div className="bg-white rounded-3xl shadow-2xl shadow-slate-200/50 p-2 md:p-6 border border-slate-100">
            <UploadZone onUpload={handleUpload} isAnalyzing={isPending || isUploading} />
          </div>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Analysis mode</p>
            <label className="flex items-start gap-3 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={useExternalAI}
                onChange={(event) => setUseExternalAI(event.target.checked)}
                className="mt-0.5 h-4 w-4"
                disabled={isPending || isUploading}
              />
              <span>
                <span className="font-semibold">NVIDIA-powered AI-assisted skin-image analysis</span>
                <span className="block text-slate-500 text-xs mt-1">
                  Sends the prepared image to the external NVIDIA vision model you consent to use, for observations and possible conditions to discuss with a clinician. This is an AI image conversation, not a clinically validated diagnostic classifier. Requires explicit consent below; the checkbox must be ticked before the image leaves the platform. The separate scheduled model analysis (uncalibrated local model) stays available either way.
                </span>
              </span>
            </label>
          </div>

          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8 text-center px-4">
            <div>
              <div className={`text-3xl font-display font-bold mb-2 ${researchAvailable ? "text-primary" : "text-slate-400"}`}>
                {researchAvailable ? "AI Model Ready" : modelStatus.isLoading ? "Checking status" : "Unavailable"}
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
                <div className="text-3xl font-display font-bold text-primary mb-2">Privacy First</div>
                <p className="text-sm text-slate-500">Validated uploads use private server storage</p>
              </div>
              <div>
                <div className="text-3xl font-display font-bold text-primary mb-2">Clinical Style</div>
                <p className="text-sm text-slate-500">Descriptions and recommendations for every result</p>
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
                <h4 className="font-bold text-amber-800 mb-1">Good to know</h4>
                <ul className="text-amber-700 text-sm space-y-1">
                  <li>• This is an AI-assisted analysis for personal reference, not a medical diagnosis</li>
                  {researchAvailable && <li>• The ranking reflects one image; results depend on image quality, lighting, and skin tone</li>}
                  <li>• For any spot you are concerned about — especially one that changes, bleeds, or doesn't heal — please see a dermatologist</li>
                  {!researchAvailable && <li>• Results will appear here once a model is configured</li>}
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

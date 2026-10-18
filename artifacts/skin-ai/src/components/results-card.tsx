import { motion } from "framer-motion";
import { ActivitySquare, ChevronRight, Flame, Layers, ListChecks, Stethoscope } from "lucide-react";
import { SeverityBadge } from "./ui/severity-badge";

type DisplayResult = {
  id: number;
  disease: string;
  confidence: number;
  description: string;
  severity: string;
  recommendations: string[];
  differentialDiagnoses: Array<{ disease: string; confidence: number }>;
  preprocessingSteps: string[];
  modelId?: string | null;
  modelVersion?: string | null;
  scoreSemantics?: string;
  preprocessingVersion?: string | null;
  status?: string;
  aiAssessment?: {
    provider?: string;
    model?: string;
    observations?: string[];
    possibleConditions?: Array<{ name: string; reason: string }>;
    uncertainty?: string;
    urgency?: string;
    nextSteps?: string[];
    consultClinicianWhen?: string[];
  } | null;
  createdAt: string;
};

interface ResultsCardProps {
  result: DisplayResult;
  onReset: () => void;
}

const percent = (value: number) => (Number.isFinite(value) ? (value * 100).toFixed(1) : "0.0");

export function ResultsCard({ result, onReset }: ResultsCardProps) {
  const simulated = result.status === "simulated" || result.scoreSemantics === "simulated";
  const unverified = result.status === "legacy_unverified" || result.scoreSemantics === "unverified";
  const aiInformational = result.status === "ai_informational" && Boolean(result.aiAssessment);
  const aiResult = aiInformational ? result.aiAssessment : undefined;
  const confidencePercent = percent(result.confidence);
  const maxDifferential = Math.max(0.001, ...result.differentialDiagnoses.map((row) => row.confidence));

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-200/60 overflow-hidden">
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 p-8 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/20 rounded-full blur-[80px] -translate-y-1/2 translate-x-1/2" />
        <div className="relative z-10 flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-[240px]">
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <SeverityBadge severity={simulated || unverified ? "unassessed" : result.severity} />
                <span className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/20 px-3 py-1 text-xs font-semibold text-white/90">
                  <><Flame className="h-3.5 w-3.5" />Analysis Complete</>
                </span>
            </div>
            <h2 className="text-3xl md:text-4xl font-display font-bold text-teal-300">{simulated ? "Simulated test output" : unverified ? "Unverified legacy record" : result.disease}</h2>
            {simulated && <p className="mt-2 text-sm text-amber-200">This record was created by an explicit test double. Its values are not a real analysis.</p>}
            {unverified && <p className="mt-2 text-sm text-amber-200">Model provenance was not recorded for this legacy row, so its output is hidden.</p>}
            
          </div>
          {(simulated || unverified) ? (
            <div className="rounded-2xl bg-white/10 border border-white/20 px-6 py-4">
              <p className="text-xs uppercase tracking-wider text-white/60 font-bold">Record status</p>
              <p className="text-sm text-white/80 mt-1">{simulated ? "Simulated fixture, not a real model output." : "Provenance was not recorded; stored output is suppressed."}</p>
            </div>
          ) : result.disease === "Not a valid skin image" ? (
            <div className="rounded-2xl bg-white/10 border border-white/20 px-6 py-4">
              <p className="text-xs uppercase tracking-wider text-white/60 font-bold">Image rejected</p>
              <p className="text-sm text-white/80 mt-1">No confidence score applies — the image is not a usable skin photograph. Re-upload a close-up skin image.</p>
            </div>
          ) : (
            <div className="flex items-center gap-4 rounded-2xl bg-white/10 border border-white/20 px-6 py-4">
              <div className="relative grid place-items-center">
                <svg viewBox="0 0 72 72" className="h-20 w-20 -rotate-90">
                  <circle cx="36" cy="36" r="30" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="8" />
                  <motion.circle
                    cx="36" cy="36" r="30" fill="none" stroke="#5eead4" strokeWidth="8" strokeLinecap="round"
                    initial={{ strokeDashoffset: 188.5 }} animate={{ strokeDashoffset: 188.5 * (1 - result.confidence) }}
                    strokeDasharray={188.5}
                  />
                </svg>
                <span className="absolute text-lg font-bold">{confidencePercent}%</span>
              </div>
              <div><p className="text-xs uppercase tracking-wider text-white/60 font-bold">AI Confidence Score</p><p className="text-sm text-white/80 mt-1">Leading candidate among {1 + result.differentialDiagnoses.length} conditions</p></div>
              {aiResult?.urgency === "emergency" && <p className="text-sm font-semibold text-amber-200">Urgent pattern flagged: seek care immediately.</p>}
            </div>
          )}
        </div>
      </div>

      <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-10">
        <div className="space-y-8">
          <section>
            <div className="flex items-center gap-2 text-primary font-bold mb-3"><Stethoscope className="w-5 h-5" /><h3>Clinical Description</h3></div>
            <p className="text-slate-600 leading-relaxed">{simulated ? "A visibly simulated test fixture, not a medical result." : unverified ? "Stored output is suppressed because model provenance was not recorded." : result.description}</p>
          </section>

          <section>
            <div className="flex items-center gap-2 text-primary font-bold mb-4"><ListChecks className="w-5 h-5" /><h3>Recommendations</h3></div>
            {!simulated && !unverified && <ul className="space-y-3">{result.recommendations.map((recommendation, index) => <motion.li key={index} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.08 * index }} className="flex items-start gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100"><ChevronRight className="w-5 h-5 text-primary shrink-0 mt-0.5" /><span className="text-slate-700 text-sm">{recommendation}</span></motion.li>)}</ul>}
          </section>

          {aiInformational && aiResult && (
            <>
              <section>
                <div className="flex items-center gap-2 text-primary font-bold mb-3"><Stethoscope className="w-5 h-5" /><h3>Visual findings</h3></div>
                <ul className="space-y-2">{(aiResult.observations ?? []).map((row, index) => <li key={index} className="flex items-start gap-2 text-slate-700 text-sm"><ChevronRight className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />{row}</li>)}</ul>
                {aiResult.uncertainty && <p className="mt-2 text-xs text-slate-500">Image quality note: {aiResult.uncertainty}</p>}
              </section>
              <section>
                <div className="flex items-center gap-2 text-primary font-bold mb-3"><ListChecks className="w-5 h-5" /><h3>When to consult a clinician</h3></div>
                <ul className="space-y-2">{(aiResult.consultClinicianWhen ?? []).map((row, index) => <li key={index} className="flex items-start gap-2 text-slate-700 text-sm"><ChevronRight className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />{row}</li>)}</ul>
              </section>
            </>
          )}
        </div>

        <div className="space-y-8">
          <section className="bg-slate-50 rounded-2xl p-6 border border-slate-200/60">
            <h3 className="font-bold text-foreground mb-4">Differential Diagnoses</h3>
            {simulated || unverified ? <p className="text-sm text-slate-500">{simulated ? "Hidden for this simulated record." : "Hidden because model provenance was not recorded."}</p> : result.differentialDiagnoses.length === 0 ? <p className="text-sm text-slate-500">No additional candidate conditions were returned.</p> : (
              <ul className="space-y-3">{result.differentialDiagnoses.map((candidate, index) => (
                <li key={index} className="text-sm">
                  <div className="flex items-center justify-between gap-3 mb-1"><span className="text-slate-700 font-medium">{candidate.disease}</span><span className="font-mono text-slate-500">{percent(candidate.confidence)}%</span></div>
                  <div className="h-2 rounded-full bg-slate-200 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary" style={{ width: `${Math.max(4, (candidate.confidence / maxDifferential) * 100)}%` }} /></div>
                </li>
              ))}</ul>
            )}
          </section>

          <section>
            <div className="flex items-center gap-2 text-slate-500 font-bold mb-3 text-sm uppercase tracking-wider"><Layers className="w-4 h-4" /><h3>Pipeline Data</h3></div>
            <div className="flex flex-wrap gap-2">{result.preprocessingSteps.map((step, index) => <span key={index} className="px-3 py-1.5 bg-slate-100 text-slate-600 text-xs font-mono rounded-lg border border-slate-200">{step}</span>)}</div>
          </section>

          <section className="bg-slate-50 rounded-2xl p-6 border border-slate-200/60">
            <div className="flex items-center gap-2 text-slate-500 font-bold mb-3 text-sm uppercase tracking-wider"><ActivitySquare className="w-4 h-4" /><h3>Model provenance</h3></div>
            <dl className="space-y-2 text-sm text-slate-600">
              {simulated && <p>Test double record</p>}
              {!simulated && <>
                <div className="flex justify-between gap-4"><dt>Model</dt><dd className="font-mono">{result.modelId ?? "Not reported"}</dd></div>
                <div className="flex justify-between gap-4"><dt>Model version</dt><dd className="font-mono">{result.modelVersion ?? "Not reported"}</dd></div>
              </>}
              {result.preprocessingVersion != null && <div className="flex justify-between gap-4"><dt>Preprocessing</dt><dd className="font-mono">{result.preprocessingVersion}</dd></div>}
              <div className="flex justify-between gap-4"><dt>Saved</dt><dd className="font-mono">{new Date(result.createdAt).toLocaleString()}</dd></div>
            </dl>
          </section>
        </div>
      </div>

      <div className="px-8 pb-2"><details className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"><summary className="cursor-pointer text-xs font-semibold text-slate-500">About this result</summary><p className="mt-2 text-xs text-slate-500 leading-relaxed">This assessment was produced from the uploaded image alone. Photographic conditions such as lighting, distance, and skin tone affect what the model can see — confirm anything concerning with a dermatologist.</p></details></div>

      <div className="p-6 bg-slate-50 border-t border-slate-100 text-center"><button type="button" onClick={onReset} className="px-8 py-3 rounded-xl font-semibold bg-white text-slate-700 border-2 border-slate-200 hover:border-primary hover:text-primary shadow-sm hover:shadow-md transition-all">Return to analysis</button></div>
    </motion.div>
  );
}

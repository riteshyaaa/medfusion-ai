import { motion } from "framer-motion";
import { ChevronRight, ActivitySquare, Cpu, AlertTriangle, Info } from "lucide-react";
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
  createdAt: string;
};

interface ResultsCardProps {
  result: DisplayResult;
  onReset: () => void;
}

export function ResultsCard({ result, onReset }: ResultsCardProps) {
  const simulated = result.status === "simulated" || result.scoreSemantics === "simulated";
  const unverified = result.status === "legacy_unverified" || result.scoreSemantics === "unverified";
  const calibrated = result.scoreSemantics === "calibrated_probability";
  const rawScore = Number.isFinite(result.confidence) ? result.confidence.toFixed(2) : "Not reported";

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-200/60 overflow-hidden">
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-8 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/20 rounded-full blur-[80px] -translate-y-1/2 translate-x-1/2" />
        <div className="relative z-10">
          <div className="flex flex-wrap items-center gap-3 mb-4"><SeverityBadge severity={unverified ? "unassessed" : result.severity} /><span className="text-slate-300 text-sm">{simulated ? "Simulated test output" : unverified ? "Legacy record not verified" : "Persisted model output"}</span></div>
          <h2 className="text-3xl md:text-4xl font-display font-bold mb-5 text-teal-300">{simulated ? "SIMULATED TEST OUTPUT" : unverified ? "UNVERIFIED LEGACY RECORD" : `Model output: ${result.disease}`}</h2>
          {simulated ? <p className="text-sm font-semibold text-amber-200">This record was created by an explicit test double. It is not a model prediction and its values are hidden.</p> : unverified ? <p className="text-sm font-semibold text-amber-200">Model provenance was not recorded for this legacy row. Its label, score, and stored guidance are hidden.</p> : <div className="max-w-xl"><p className="text-sm text-slate-100">{calibrated ? `Dataset-calibrated output: ${(result.confidence * 100).toFixed(1)}%. This does not establish an individual's real-world disease likelihood.` : `Raw model score: ${rawScore} (unitless, not a probability).`}</p><p className="mt-1 text-xs text-slate-400">The model output is a candidate label, not a confirmed diagnosis.</p></div>}
        </div>
      </div>

      <div className="bg-amber-50 border-b border-amber-200 px-8 py-4"><div className="flex items-start gap-3"><AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" /><div className="text-sm text-amber-900"><p className="font-semibold mb-1">Research and education prototype — not a diagnosis</p><p>This output cannot reliably rule out serious conditions, including skin cancer. A displayed score describes only the recorded model output and does not establish an individual's disease likelihood. Seek professional evaluation for health concerns.</p></div></div></div>

      <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-10">
        <div className="space-y-8">
          <section><div className="flex items-center gap-2 text-primary font-bold mb-3"><ActivitySquare className="w-5 h-5" /><h3>Recorded output notes</h3></div><p className="text-slate-600 leading-relaxed">{unverified ? "Not shown because model provenance was not recorded." : result.description}</p></section>
          <section><div className="flex items-center gap-2 text-primary font-bold mb-4"><Info className="w-5 h-5" /><h3>Educational guidance returned with this output</h3></div>{unverified ? <p className="text-sm text-slate-500">Stored guidance is hidden for this unverified legacy record.</p> : <ul className="space-y-3">{result.recommendations.map((recommendation, index) => <motion.li key={index} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 * index }} className="flex items-start gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100"><ChevronRight className="w-5 h-5 text-primary shrink-0 mt-0.5" /><span className="text-slate-700 text-sm">{recommendation}</span></motion.li>)}</ul>}</section>
        </div>

        <div className="space-y-8">
          <section className="bg-slate-50 rounded-2xl p-6 border border-slate-200/60"><h3 className="font-bold text-foreground mb-4">Candidate labels returned by the model</h3>{unverified ? <p className="text-sm text-slate-500">Candidate labels are hidden because model provenance was not recorded.</p> : result.differentialDiagnoses.length === 0 ? <p className="text-sm text-slate-500">No additional candidate labels were returned.</p> : <ul className="space-y-3">{result.differentialDiagnoses.map((candidate, index) => <li key={index} className="flex items-center justify-between gap-3 text-sm"><span className="text-slate-700 font-medium">{simulated ? "Hidden test label" : candidate.disease}</span><span className="text-slate-500 font-mono">{simulated ? "Hidden" : calibrated ? `${(candidate.confidence * 100).toFixed(1)}%` : candidate.confidence.toFixed(2)}</span></li>)}</ul>}{!simulated && !unverified && <p className="mt-3 text-xs text-slate-500">{calibrated ? "Dataset-calibrated scores; not an individual's real-world likelihood." : "Raw model scores are unitless and are not probabilities."}</p>}</section>

          <section><div className="flex items-center gap-2 text-slate-500 font-bold mb-3 text-sm uppercase tracking-wider"><Cpu className="w-4 h-4" /><h3>Preprocessing steps</h3></div><div className="flex flex-wrap gap-2">{unverified ? <span className="text-sm text-slate-500">Not shown for an unverified legacy record.</span> : result.preprocessingSteps.length ? result.preprocessingSteps.map((step, index) => <span key={index} className="px-2.5 py-1 bg-slate-100 text-slate-600 text-xs font-mono rounded-md border border-slate-200">{step}</span>) : <span className="text-sm text-slate-500">Not reported</span>}</div></section>

          <section className="bg-slate-50 rounded-2xl p-6 border border-slate-200/60"><div className="flex items-center gap-2 text-slate-500 font-bold mb-3 text-sm uppercase tracking-wider"><Info className="w-4 h-4" /><h3>Model provenance</h3></div><dl className="space-y-2 text-sm text-slate-600"><div className="flex justify-between gap-4"><dt>Task</dt><dd className="font-mono">Skin image classification</dd></div><div className="flex justify-between gap-4"><dt>Model ID</dt><dd className="font-mono">{simulated ? "Test double" : result.modelId ?? "Not reported"}</dd></div><div className="flex justify-between gap-4"><dt>Model version</dt><dd className="font-mono">{simulated ? "Test only" : result.modelVersion ?? "Not reported"}</dd></div>{result.preprocessingVersion && <div className="flex justify-between gap-4"><dt>Preprocessing version</dt><dd className="font-mono">{result.preprocessingVersion}</dd></div>}<div className="flex justify-between gap-4"><dt>Saved</dt><dd className="font-mono">{new Date(result.createdAt).toLocaleString()}</dd></div></dl></section>
        </div>
      </div>

      <div className="p-6 bg-slate-50 border-t border-slate-100 text-center"><button type="button" onClick={onReset} className="px-8 py-3 rounded-xl font-semibold bg-white text-slate-700 border-2 border-slate-200 hover:border-primary hover:text-primary shadow-sm hover:shadow-md transition-all">Return to analysis</button></div>
    </motion.div>
  );
}

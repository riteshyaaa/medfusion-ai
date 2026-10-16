import { FormEvent, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateCardiacAssessment, useGetCardiacModelStatus, useListCases, useListCardiacAssessments } from "@workspace/api-client-react";
import { Activity, AlertTriangle, ArrowLeft, HeartPulse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Layout } from "@/components/layout";

type CardiacContract = {
  task?: string;
  dataset?: { id?: string; sourceUrl?: string; licenseNote?: string; knownLimitations?: string[] };
  features?: Array<{ name: string; type: string; unit: string | null; description: string; allowedValues?: string[]; minimum?: number; maximum?: number }>;
  preprocessingNote?: string;
};

type CardiacFeatureInput = { name: string; className: string; values: string[]; labels: string[] };

const CONTENT_FEATURES: CardiacFeatureInput[] = [
  { name: "sex", className: "select", values: ["male", "female"], labels: ["Male", "Female"] },
  { name: "chestPainType", className: "select", values: ["typical_angina", "atypical_angina", "non_anginal", "asymptomatic"], labels: ["Typical angina", "Atypical angina", "Non-anginal pain", "Asymptomatic"] },
  { name: "fastingBloodSugarOver120", className: "select", values: ["yes", "no"], labels: ["Over 120 mg/dl", "At or under 120 mg/dl"] },
  { name: "restingEcg", className: "select", values: ["normal", "st_t_abnormality", "left_ventricular_hypertrophy"], labels: ["Normal", "ST/T abnormality", "Left ventricular hypertrophy"] },
  { name: "exerciseAngina", className: "select", values: ["yes", "no"], labels: ["Yes", "No"] },
  { name: "stSlope", className: "select", values: ["upsloping", "flat", "downsloping"], labels: ["Upsloping", "Flat", "Downsloping"] },
  { name: "thalassemia", className: "select", values: ["normal", "fixed_defect", "reversible_defect"], labels: ["Normal", "Fixed defect", "Reversible defect"] },
];
const DESCRIPTION_FEATURES = [
  { name: "age", minimum: 18, maximum: 120, unit: "years" },
  { name: "restingBloodPressure", minimum: 60, maximum: 250, unit: "mm Hg" },
  { name: "serumCholesterol", minimum: 50, maximum: 700, unit: "mg/dl" },
  { name: "maxHeartRate", minimum: 50, maximum: 250, unit: "beats/min" },
  { name: "stDepression", minimum: 0, maximum: 10, unit: "mm" },
  { name: "majorVessels", minimum: 0, maximum: 3, unit: "vessels" },
];

export default function CardiacAssessment() {
  const statusQuery = useGetCardiacModelStatus();
  const status = statusQuery.data;
  const contract = (status?.contract ?? {}) as CardiacContract;
  const featureContract = useMemo(() => {
    const map = new Map<string, { name: string; unit: string | null; description: string; allowedValues?: string[]; minimum?: number; maximum?: number }>();
    for (const feature of contract.features ?? []) map.set(feature.name, feature);
    return map;
  }, [contract]);
  const available = status?.available === true;

  const featureValue = (name: string) => {
    const defaults: Record<string, string | number> = {
      age: 45, sex: "female", chestPainType: "typical_angina", restingBloodPressure: 120, serumCholesterol: 200,
      fastingBloodSugarOver120: "no", restingEcg: "normal", maxHeartRate: 150, exerciseAngina: "no",
      stDepression: 0, stSlope: "upsloping", majorVessels: 0, thalassemia: "normal",
    };
    return defaults[name];
  };
  const [form, setForm] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const feature of [...CONTENT_FEATURES, ...DESCRIPTION_FEATURES]) initial[feature.name] = String(featureValue(feature.name));
    return initial;
  });
  const [caseId, setCaseId] = useState("");
  const queryClient = useQueryClient();
  const casesQuery = useListCases({ page: 1, limit: 100 });
  const assessmentsQuery = useListCardiacAssessments({ page: 1, limit: 10 });

  const createAssessment = useCreateCardiacAssessment({ mutation: {
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/cardiac/assessments"] });
    },
  } });

  const featurePlaceholder = (feature: { name: string; unit: string | null; description: string }) => `${feature.description}${feature.unit ? ` (${feature.unit})` : ""}`;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!available) return;
    createAssessment.mutate({ data: {
      ...(caseId ? { caseId: Number(caseId) } : {}),
      age: Number(form.age), sex: form.sex as "male" | "female", chestPainType: form.chestPainType as "typical_angina" | "atypical_angina" | "non_anginal" | "asymptomatic",
      restingBloodPressure: Number(form.restingBloodPressure), serumCholesterol: Number(form.serumCholesterol),
      fastingBloodSugarOver120: form.fastingBloodSugarOver120 as "yes" | "no",
      restingEcg: form.restingEcg as "normal" | "st_t_abnormality" | "left_ventricular_hypertrophy",
      maxHeartRate: Number(form.maxHeartRate), exerciseAngina: form.exerciseAngina as "yes" | "no",
      stDepression: Number(form.stDepression), stSlope: form.stSlope as "upsloping" | "flat" | "downsloping",
      majorVessels: Number(form.majorVessels), thalassemia: form.thalassemia as "normal" | "fixed_defect" | "reversible_defect",
    } });
  };

  const latest = createAssessment.data?.assessment;
  const previous = (assessmentsQuery.data?.assessments ?? []).filter((item) => item.id !== latest?.id);
  const recordFeatureName = (name: string) => featureContract.get(name)?.description ?? name.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()).trim();

  return (
    <Layout>
      <div className="max-w-5xl mx-auto pt-8 pb-20">
        <Link href="/" className="inline-flex items-center gap-2 text-slate-500 hover:text-primary font-medium mb-6">
          <ArrowLeft className="w-4 h-4" />Back to Overview
        </Link>

        <div className="mb-8">
          <h1 className="text-4xl md:text-5xl font-display font-extrabold text-slate-900 tracking-tight">Cardiac Assessment</h1>
          <p className="text-slate-600 mt-2 max-w-3xl">
            {available
              ? "Enter structured heart-risk inputs and see an uncalibrated research-only score from the held-out Cleveland-style logistic baseline. The score is not a probability of disease and not clinical advice."
              : "This module has no installed cardiac model. It refuses to score inputs rather than guessing."}
          </p>
        </div>

        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><h2 className="font-semibold">Urgent symptoms</h2><p className="mt-1 text-sm">Chest pain, shortness of breath, or other possible heart symptoms can be life-threatening. Contact local emergency services immediately rather than waiting for any software result.</p></div></div>

        {statusQuery.isLoading && <p role="status" className="p-10 text-center text-slate-500">Checking cardiac model availability…</p>}
        {statusQuery.isError && (
          <section className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
            <h2 className="text-xl font-semibold">Status unavailable</h2>
            <p className="mt-2 text-sm text-slate-600">The cardiac model status could not be loaded. Retry shortly.</p>
            <Button className="mt-4" onClick={() => void statusQuery.refetch()}>Retry</Button>
          </section>
        )}

        {status && available && (
          <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-5" >
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold flex-1">Structured inputs</h2>
              <span className="rounded-full bg-amber-200 px-3 py-0.5 text-xs font-bold text-amber-900">Research-only · uncalibrated</span>
            </div>
            <p className="text-xs text-slate-500">
              Model {status.modelId} ({status.modelVersion}) · calibration status {status.calibrationStatus}. {status.readinessNote}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {DESCRIPTION_FEATURES.map((entry) => {
                const description = featureContract.get(entry.name);
                return (
                  <label key={entry.name} className="space-y-1 text-sm font-medium">
                    <span className="block">{recordFeatureName(entry.name)}</span>
                    <Input type="number" step={entry.name === "stDepression" ? 0.1 : 1} value={form[entry.name]} onChange={(event) => setForm((current) => ({ ...current, [entry.name]: event.target.value }))} min={entry.minimum} max={entry.maximum} placeholder={description ? featurePlaceholder(description) : undefined} required />
                  </label>
                );
              })}
              {CONTENT_FEATURES.map((entry) => {
                const description = featureContract.get(entry.name);
                return (
                  <label key={entry.name} className="space-y-1 text-sm font-medium">
                    <span className="block">{recordFeatureName(entry.name)}</span>
                    <select value={form[entry.name]} onChange={(event) => setForm((current) => ({ ...current, [entry.name]: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                      {entry.values.map((value, index) => <option key={value} value={value}>{entry.labels[index]}</option>)}
                    </select>
                    {description && <span className="block text-xs font-normal text-slate-500">{description.description}</span>}
                  </label>
                );
              })}
              <label className="space-y-1 text-sm font-medium md:col-span-2">Linked case (optional)
                <select value={caseId} onChange={(event) => setCaseId(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">No case</option>
                  {(casesQuery.data?.cases ?? []).map((item) => <option key={item.id} value={item.id}>{item.caseNumber}</option>)}
                </select>
              </label>
            </div>
            {casesQuery.isError && <p role="status" className="text-sm text-slate-500">Cases could not be loaded; you can still save without linking one.</p>}
            {createAssessment.isError && <p role="alert" className="text-sm text-destructive">Assessment was not scored. Check each field against the allowed range and retry.</p>}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={createAssessment.isPending}>{createAssessment.isPending ? "Scoring inputs…" : "Score inputs"}</Button>
              <Button type="button" variant="ghost" onClick={() => { const reset: Record<string, string> = {}; for (const feature of [...CONTENT_FEATURES, ...DESCRIPTION_FEATURES]) reset[feature.name] = String(featureValue(feature.name)); setForm(reset); createAssessment.reset(); }}>Reset defaults</Button>
            </div>
          </form>
        )}

        {status && !available && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <HeartPulse className="h-5 w-5 text-primary" />
              <h2 className="font-semibold">Why there is no result</h2>
            </div>
            <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
              <li>No verified cardiac model artifact is installed, so no score is served.</li>
              <li>Entering numbers would not change that — the application does not fabricate model output.</li>
              <li>The contract below documents what a future model must satisfy before it is enabled.</li>
            </ul>
          </section>
        )}

        {status && available && latest && (
          <section className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-6" aria-live="polite">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-amber-900">Research-only risk score · record #{latest.id}</h2>
              <span className="rounded-full bg-amber-200 px-3 py-0.5 text-xs font-bold text-amber-900">Uncalibrated</span>
            </div>
            {typeof latest.riskScore === "number" ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="rounded-xl bg-white p-5 border border-amber-200">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Model output</p>
                  <p className="mt-1 font-mono text-3xl text-slate-900">{latest.riskScore.toFixed(4)}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    Uncalibrated logistic score {latest.aboveThreshold ? "above" : "below"} the fixed research threshold {latest.threshold ?? "—"}. You may have {latest.label}. The number is not a probability of disease.
                  </p>
                </div>
                <div className="rounded-xl bg-white p-5 border border-amber-200">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Largest weighted contributions</p>
                  <ul className="mt-2 space-y-2 text-sm">
                    {latest.topFactors?.map((factor) => (
                      <li key={factor.feature}>
                        <span className="font-medium">{factor.description}</span>
                        <span className={`ml-1 font-mono text-xs ${factor.contribution >= 0 ? "text-red-700" : "text-emerald-700"}`}>
                          {factor.contribution >= 0 ? "+" : ""}{factor.contribution.toFixed(3)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-slate-500">Contributions are weights from the standardised inputs; they are not absolute or prognostic effects.</p>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm">No score was produced for this record because the cardiac baseline is unavailable. Nothing was fabricated.</p>
            )}
            <p className="mt-4 text-sm text-amber-900">{latest.notice}</p>
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold text-amber-900">Documented baseline limitations</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-900">
                {(latest.diagnosticLimitations ?? []).map((limitation, index) => <li key={index}>{limitation}</li>)}
              </ul>
            </details>
          </section>
        )}

        <section className="mt-10 rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center gap-2 p-5 border-b border-slate-200"><Activity className="h-5 w-5 text-primary" /><h2 className="font-semibold">Saved assessments</h2></div>
          {assessmentsQuery.isLoading && <p role="status" className="p-6 text-sm text-slate-500">Loading saved assessments…</p>}
          {assessmentsQuery.isError && <div className="p-6"><p role="alert" className="text-sm text-slate-600">Saved assessments could not be loaded.</p><Button variant="outline" className="mt-2" onClick={() => void assessmentsQuery.refetch()}>Retry</Button></div>}
          {!assessmentsQuery.isLoading && !assessmentsQuery.isError && previous.length === 0 && !latest && <p className="p-6 text-sm text-slate-500">No saved assessments yet.</p>}
          {[...(latest ? [latest] : []), ...previous].map((item) => (
            <article key={item.id} className="border-b last:border-b-0 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-medium">
                  {typeof item.riskScore === "number" ? `Score ${item.riskScore.toFixed(4)}` : "Not scored"}
                  {item.aboveThreshold ? " · above threshold" : ""}
                </h3>
                <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">research only</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">{new Date(item.createdAt).toLocaleString()} · {item.status.replace(/_/g, " ")}</p>
            </article>
          ))}
        </section>

        {status && (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">{available ? "The deployed baseline" : "Future model contract"}{contract.dataset?.id ? ` · ${contract.dataset.id}` : ""}</h2>
              </div>
              {available && (status.metrics as { test?: { rocAuc?: number } } | undefined)?.test?.rocAuc !== undefined && (
                <span className="text-xs text-slate-500">held-out ROC-AUC {((status.metrics as { test?: { rocAuc?: number } }).test?.rocAuc ?? 0).toFixed(3)}</span>
              )}
            </div>
            {contract.task && <p className="mb-4 text-sm text-slate-600">Task: {contract.task.replace(/-/g, " ")}</p>}
            {Array.isArray(contract.features) && contract.features.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px]">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-500">Input</th>
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-500">Type</th>
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-500">Range / values</th>
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-500">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {contract.features.map((feature) => (
                      <tr key={feature.name}>
                        <td className="px-4 py-3 text-sm font-medium text-slate-900">{feature.name}</td>
                        <td className="px-4 py-3 text-sm text-slate-600">{feature.type}{feature.unit ? ` (${feature.unit})` : ""}</td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {feature.allowedValues?.length
                            ? feature.allowedValues.join(", ")
                            : feature.minimum !== undefined && feature.maximum !== undefined
                              ? `${feature.minimum}–${feature.maximum}`
                              : "—"}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">{feature.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {contract.dataset?.knownLimitations && contract.dataset.knownLimitations.length > 0 && (
              <div className="mt-5 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
                <h3 className="font-semibold">Known limitations of the dataset that trained {available ? "the deployed baseline" : "this contract references"}</h3>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {contract.dataset.knownLimitations.map((limitation, index) => <li key={index}>{limitation}</li>)}
                </ul>
              </div>
            )}
            {contract.preprocessingNote && <p className="mt-4 text-xs text-slate-500">{contract.preprocessingNote}</p>}
            {contract.dataset?.sourceUrl && (
              <p className="mt-2 text-xs text-slate-500">
                Dataset reference: <a className="text-primary hover:underline" href={contract.dataset.sourceUrl} target="_blank" rel="noreferrer noopener">{contract.dataset.sourceUrl}</a>
              </p>
            )}
          </section>
        )}
        <p className="mt-6 text-sm text-slate-500">The score reflects a statistical relation learned in one historical dataset: it is not parity with any risk calculator presented up front, and this tool shall never be treated as medical advice.</p>
      </div>
    </Layout>
  );
}

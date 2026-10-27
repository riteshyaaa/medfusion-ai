import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, ArrowLeft, ArrowRight, BrainCircuit, Clock, Download, FileText,
  HeartPulse, Info, RefreshCw, Scale, ShieldAlert, Stethoscope,
} from "lucide-react";
import {
  useCreateCardiacAssessment, useGetCardiacModelStatus, useListCases, useListCardiacAssessments,
  useGetCardiacAssessment, useListCardiacAiExplanations, useCreateCardiacAiExplanation,
  exportCardiacAssessmentText, exportCardiacAssessmentPdf,
  type CardiacAssessment, type CreateCardiacAssessmentRequest,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Layout } from "@/components/layout";

type CardiacContract = {
  task?: string;
  dataset?: { id?: string; sourceUrl?: string; licenseNote?: string; knownLimitations?: string[] };
  features?: Array<{ name: string; type: string; unit: string | null; description: string; allowedValues?: string[]; minimum?: number; maximum?: number }>;
  preprocessingNote?: string;
};

type CardiacFeatureInput = { name: string; className: string; values: string[]; labels: string[]; help?: string };

const CONTENT_FEATURES: CardiacFeatureInput[] = [
  { name: "sex", className: "select", values: ["male", "female"], labels: ["Male", "Female"] },
  { name: "chestPainType", className: "select", values: ["typical_angina", "atypical_angina", "non_anginal", "asymptomatic"], labels: ["Typical angina", "Atypical angina", "Non-anginal pain", "Asymptomatic"], help: "How chest discomfort presented: typical angina, atypical angina, non-anginal pain, or no chest symptoms (asymptomatic)." },
  { name: "fastingBloodSugarOver120", className: "select", values: ["yes", "no"], labels: ["Over 120 mg/dl", "At or under 120 mg/dl"], help: "Whether fasting blood sugar was recorded above 120 mg/dl." },
  { name: "restingEcg", className: "select", values: ["normal", "st_t_abnormality", "left_ventricular_hypertrophy"], labels: ["Normal", "ST/T abnormality", "Left ventricular hypertrophy"], help: "Resting electrocardiographic result category." },
  { name: "exerciseAngina", className: "select", values: ["yes", "no"], labels: ["Yes", "No"], help: "Whether chest discomfort was brought on by exercise." },
  { name: "stSlope", className: "select", values: ["upsloping", "flat", "downsloping"], labels: ["Upsloping", "Flat", "Downsloping"], help: "Shape (slope) of the ST segment at peak exercise, from an exercise ECG." },
  { name: "thalassemia", className: "select", values: ["normal", "fixed_defect", "reversible_defect"], labels: ["Normal", "Fixed defect", "Reversible defect"], help: "Result of a thallium stress test: normal, fixed defect, or reversible defect." },
];
const DESCRIPTION_FEATURES = [
  { name: "age", minimum: 18, maximum: 120, unit: "years" },
  { name: "restingBloodPressure", minimum: 60, maximum: 250, unit: "mm Hg" },
  { name: "serumCholesterol", minimum: 50, maximum: 700, unit: "mg/dl" },
  { name: "maxHeartRate", minimum: 50, maximum: 250, unit: "beats/min" },
  { name: "stDepression", minimum: 0, maximum: 10, unit: "mm" },
  { name: "majorVessels", minimum: 0, maximum: 3, unit: "vessels" },
];
const NUMERIC_HELP: Record<string, string> = {
  majorVessels: " counted by fluoroscopy (a heart-catheterisation imaging test)",
};
const URGENT_SYMPTOM_OPTIONS = [
  { value: "current_chest_pain", label: "Current chest pain or pressure" },
  { value: "severe_shortness_of_breath", label: "Severe shortness of breath right now" },
  { value: "fainting", label: "Fainting or blackouts" },
  { value: "stroke_signs", label: "Sudden weakness in the face/limb, one-sided numbness, difficulty speaking" },
  { value: "uncontrolled_bleeding", label: "Uncontrolled bleeding" },
  { value: "severe_allergic_reaction", label: "Severe allergic reaction" },
];
const CONTEXTUAL_FACTORS = [
  { value: "family_history_early_heart_disease", label: "Family history of early heart disease" },
  { value: "smoking_status", label: "Smoking status" },
  { value: "diabetes_diagnosis", label: "Diabetes diagnosis" },
  { value: "blood_pressure_treatment", label: "Blood-pressure medication use" },
  { value: "cholesterol_medication", label: "Cholesterol medication use" },
  { value: "physical_activity", label: "Typical physical activity" },
];
const MEASUREMENT_SOURCES = [
  { value: "self_measured", label: "Measured by me (device readings I took)" },
  { value: "patient_reported", label: "Patient-reported (from memory or conversation)" },
  { value: "imported_history", label: "Imported historical values (from past records)" },
  { value: "unspecified", label: "Not specified" },
];

const ALL_FIELDS = [...DESCRIPTION_FEATURES.map((feature) => feature.name), ...CONTENT_FEATURES.map((feature) => feature.name)];

function fieldDescription(name: string, contract: Map<string, { description: string; unit: string | null }>) {
  const record = contract.get(name);
  const fallback = name.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()).trim();
  return record?.description ? record.description + (record.unit ? ` (${record.unit})` : "") : fallback;
}

function formatValue(name: string, value: string) {
  return CONTENT_FEATURES.find((entry) => entry.name === name)?.labels[
    CONTENT_FEATURES.find((entry) => entry.name === name)!.values.indexOf(value)
  ] ?? `${value}${CONTENT_FEATURES.find((entry) => entry.name === name) ? "" : ""}`;
}

type TrendPoint = { createdAt: string; value: number };

function trendFor(records: CardiacAssessment[], fieldName: string): TrendPoint[] {
  return records
    .filter((record) => {
      const raw = (record.inputs as Record<string, unknown>)[fieldName];
      return typeof raw === "number" || (typeof raw === "string" && raw !== "");
    })
    .map((record) => ({ createdAt: record.createdAt, value: Number((record.inputs as Record<string, unknown>)[fieldName]) }))
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
}

function Sparkline({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) return null;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 220;
  const height = 36;
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${((width - 8) * index) / (points.length - 1) + 4},${height - ((point.value - min) / span) * (height - 8) - 4}`).join(" ");
  return (
    <svg width={width} height={height} role="img" aria-label={`Trend of ${points.length} recorded values from ${min} to ${max}`} className="mt-1">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" className="text-primary" />
    </svg>
  );
}

export default function CardiacAssessment() {
  const statusQuery = useGetCardiacModelStatus();
  const status = statusQuery.data;
  const contract = (status?.contract ?? {}) as CardiacContract;
  const featureContract = useMemo(() => {
    const map = new Map<string, { description: string; unit: string | null }>();
    for (const feature of contract.features ?? []) map.set(feature.name, feature);
    return map;
  }, [contract]);
  const artifactAvailable = status?.available === true;
  const researchServingEnabled = artifactAvailable && status.researchServing?.enabled === true;
  const searchParams = useSearch();

  const [form, setForm] = useState<Record<string, string>>({});
  const [caseId, setCaseId] = useState("");
  const [measurementSource, setMeasurementSource] = useState("self_measured");
  const [currentSymptoms, setCurrentSymptoms] = useState<string[]>([]);
  const [contextual, setContextual] = useState<Record<string, string>>({});
  const [showReview, setShowReview] = useState(false);
  const [openAssessmentId, setOpenAssessmentId] = useState<number | null>(null);
  const [compareLeft, setCompareLeft] = useState<number | null>(null);
  const [compareRight, setCompareRight] = useState<number | null>(null);
  const [consentGiven, setConsentGiven] = useState(false);
  const queryClient = useQueryClient();
  const casesQuery = useListCases({ page: 1, limit: 100 });
  const assessmentsQuery = useListCardiacAssessments({ page: 1, limit: 50 });

  // History cards link here with ?record=<id>: auto-open that saved record
  // (result, inputs, exports, and saved AI explanations are rendered below it).
  useEffect(() => {
    const record = Number(new URLSearchParams(searchParams && searchParams.startsWith("?") ? searchParams.slice(1) : searchParams ?? "").get("record"));
    if (Number.isSafeInteger(record) && record > 0) setOpenAssessmentId(record);
  }, [searchParams]);

  const history = assessmentsQuery.data?.assessments ?? [];
  const latest = history.find((item) => item.status === "research_only" && typeof item.riskScore === "number") ?? null;
  const detailQuery = useGetCardiacAssessment(openAssessmentId!, { query: { enabled: openAssessmentId !== null } });
  // The AI summary always belongs to the record the user is actually looking
  // at: an explicitly opened record wins over the newest one.
  const explainTargetId = openAssessmentId ?? latest?.id ?? null;
  const explanationsQuery = useListCardiacAiExplanations(explainTargetId!, { query: { enabled: explainTargetId !== null } });

  const createAssessment = useCreateCardiacAssessment({ mutation: {
    onSuccess: async (data) => {
      setShowReview(false);
      setOpenAssessmentId(data.assessment.id);
      await queryClient.invalidateQueries({ queryKey: ["/api/cardiac/assessments"] });
    },
  } });

  const explainAssessment = useCreateCardiacAiExplanation({ mutation: {
    onSuccess: async (data) => {
      // Invalidate the explanations list for THIS record, otherwise the new
      // summary only appears after navigation and the button looks broken,
      // which invites a duplicate generation.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/cardiac/assessments"] }),
        queryClient.invalidateQueries({ queryKey: [`/api/cardiac/assessments/${data.explanation.assessmentId}/ai-explanations`] }),
      ]);
    },
  } });

  const formReady = ALL_FIELDS.every((name) => form[name] !== undefined && form[name] !== "");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!researchServingEnabled || !formReady) return;
    const payload: CreateCardiacAssessmentRequest = {
      ...(caseId ? { caseId: Number(caseId) } : {}),
      age: Number(form.age), sex: form.sex as CreateCardiacAssessmentRequest["sex"],
      chestPainType: form.chestPainType as CreateCardiacAssessmentRequest["chestPainType"],
      restingBloodPressure: Number(form.restingBloodPressure), serumCholesterol: Number(form.serumCholesterol),
      fastingBloodSugarOver120: form.fastingBloodSugarOver120 as CreateCardiacAssessmentRequest["fastingBloodSugarOver120"],
      restingEcg: form.restingEcg as CreateCardiacAssessmentRequest["restingEcg"],
      maxHeartRate: Number(form.maxHeartRate), exerciseAngina: form.exerciseAngina as CreateCardiacAssessmentRequest["exerciseAngina"],
      stDepression: Number(form.stDepression), stSlope: form.stSlope as CreateCardiacAssessmentRequest["stSlope"],
      majorVessels: Number(form.majorVessels), thalassemia: form.thalassemia as CreateCardiacAssessmentRequest["thalassemia"],
      currentSymptoms: currentSymptoms as CreateCardiacAssessmentRequest["currentSymptoms"],
      measurementSource: measurementSource as CreateCardiacAssessmentRequest["measurementSource"],
      contextualFactors: CONTEXTUAL_FACTORS.filter((factor) => contextual[factor.value]?.trim()).map((factor) => ({ factor: factor.value as "family_history_early_heart_disease" | "smoking_status" | "diabetes_diagnosis" | "blood_pressure_treatment" | "cholesterol_medication" | "physical_activity", value: contextual[factor.value].trim() })),
    };
    createAssessment.mutate({ data: payload });
  };

  const downloadExport = async (assessment: { id: number }, format: "txt" | "pdf") => {
    const blob = format === "pdf" ? await exportCardiacAssessmentPdf(assessment.id) : new Blob([await exportCardiacAssessmentText(assessment.id)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cardiac-assessment-${assessment.id}.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const compareA = compareLeft !== null ? history.find((item) => item.id === compareLeft) ?? null : null;
  const compareB = compareRight !== null ? history.find((item) => item.id === compareRight) ?? null : null;
  const scoreComparable = compareA && compareB && compareA.modelVersion === compareB.modelVersion && compareA.status === "research_only" && compareB.status === "research_only";
  const bloodPressureTrend = trendFor(history, "restingBloodPressure");
  const cholesterolTrend = trendFor(history, "serumCholesterol");
  const maxHeartRateTrend = trendFor(history, "maxHeartRate");

  const reviewRows = useMemo(() => ALL_FIELDS.map((name) => ({
    name,
    description: fieldDescription(name, featureContract),
    value: form[name] === undefined ? "— unanswered —" : formatValue(name, form[name]),
  })), [form, featureContract]);

  const explanations = explanationsQuery.data?.explanations ?? [];

  return (
    <Layout>
      <div className="max-w-5xl mx-auto pt-8 pb-20">
        <Link href="/" className="inline-flex items-center gap-2 text-slate-500 hover:text-primary font-medium mb-6">
          <ArrowLeft className="w-4 h-4" />Back to Overview
        </Link>

        <div className="mb-6">
          <h1 className="text-4xl md:text-5xl font-display font-extrabold text-slate-900 tracking-tight">Cardiac Assessment</h1>
          <p className="text-slate-600 mt-2 max-w-3xl">
            A structured, research-only cardiac-risk workflow: a safety screen, a questionnaire that is reviewed before submission, an uncalibrated research score with provenance, longitudinal history with input-aware comparison, and optional consent-gated AI explanations.
          </p>
          {artifactAvailable && (
            <p className="mt-2 text-xs text-slate-500 max-w-3xl">
              Model {status.modelId} ({status.modelVersion}) · calibration status {status.calibrationStatus} · {status.researchServing?.enabled ? "research serving enabled by operator configuration" : "research serving disabled by configuration — scores are refused until an operator opts in"}
            </p>
          )}
        </div>

        {statusQuery.isLoading && <p role="status" className="p-10 text-center text-slate-500">Checking cardiac model availability…</p>}
        {statusQuery.isError && (
          <section className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
            <h2 className="text-xl font-semibold">Status unavailable</h2>
            <p className="mt-2 text-sm text-slate-600">The cardiac model status could not be loaded. Retry shortly.</p>
            <Button className="mt-4" onClick={() => void statusQuery.refetch()}><RefreshCw className="h-4 w-4" />Retry</Button>
          </section>
        )}

        {!statusQuery.isLoading && !statusQuery.isError && (
          <>
            <section className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900" aria-labelledby="cardiac-safety-heading">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
                <div className="w-full">
                  <h2 id="cardiac-safety-heading" className="font-semibold">Safety screen — this comes first and always outranks a score</h2>
                  <p className="mt-1 text-sm">Possible emergencies require immediate professional assessment. Do not wait for any software result. This questionnaire cannot rule out a heart attack or any other emergency regardless of the score produced later. If any of the items below apply, contact local emergency services immediately; applying them also stops the research model from being called at all.</p>
                  <fieldset className="mt-4 space-y-2">
                    <legend className="text-sm font-semibold">Do you currently have any of these symptoms?</legend>
                    {URGENT_SYMPTOM_OPTIONS.map((option) => (
                      <label key={option.value} className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={currentSymptoms.includes(option.value)}
                          onChange={(event) => setCurrentSymptoms((current) => event.target.checked ? [...current, option.value] : current.filter((value) => value !== option.value))}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </fieldset>
                  {currentSymptoms.length > 0 && (
                    <p role="alert" className="mt-3 rounded-lg bg-red-100 p-3 text-sm font-semibold">
                      You marked a possible emergency symptom. Stop here and seek in-person help now. This application will not produce a software score for this submission.
                    </p>
                  )}
                </div>
              </div>
            </section>

            {status && !researchServingEnabled && (
              <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" aria-labelledby="cardiac-unavailable-heading">
                <div className="flex items-center gap-2 mb-3">
                  <HeartPulse className="h-5 w-5 text-primary" />
                  <h2 id="cardiac-unavailable-heading" className="font-semibold">Why there is no score</h2>
                </div>
                <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
                  {!artifactAvailable && <li>No verified cardiac model artifact is installed, so no score is served. {status.status === "model_unavailable" ? status.reason : null}</li>}
                  {artifactAvailable && <li>A verified research artifact exists, but research serving is disabled by operator configuration ({status.researchServing?.reason}).</li>}
                  <li>Entering numbers would not change that — the application does not fabricate model output, and permission to serve research scores is separate from the artifact itself.</li>
                  <li>The safety screen above remains fully usable: concerning symptoms always warrant immediate professional care.</li>
                  <li>The contract below documents what a future model must satisfy before it is enabled.</li>
                </ul>
              </section>
            )}

            {status && researchServingEnabled && !currentSymptoms.length && (
              <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold flex-1">Risk-factor questionnaire</h2>
                  <span className="rounded-full bg-primary/10 px-3 py-0.5 text-xs font-bold text-primary">Model score</span>
                </div>
                <p className="text-xs text-slate-500">The research model reads exactly the thirteen fields below. {status.readinessNote}</p>

                <fieldset className="space-y-4">
                  <legend className="text-sm font-semibold">Assessment context</legend>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="space-y-1 text-sm font-medium">
                      <span className="block">Linked case (optional)</span>
                      <select value={caseId} onChange={(event) => setCaseId(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                        <option value="">No case</option>
                        {(casesQuery.data?.cases ?? []).map((item) => <option key={item.id} value={item.id}>{item.caseNumber}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1 text-sm font-medium">
                      <span className="block">Where do these values come from?</span>
                      <select value={measurementSource} onChange={(event) => setMeasurementSource(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                        {MEASUREMENT_SOURCES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                      </select>
                      <span className="block text-xs font-normal text-slate-500">Recorded with the assessment so future readers know whether the values were measured, reported, or imported.</span>
                    </label>
                  </div>
                </fieldset>

                <fieldset className="space-y-4">
                  <legend className="text-sm font-semibold">Measured and recorded values</legend>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {DESCRIPTION_FEATURES.map((entry) => {
                      const description = featureContract.get(entry.name);
                      return (
                        <label key={entry.name} className="space-y-1 text-sm font-medium">
                          <span className="block">{fieldDescription(entry.name, featureContract)}</span>
                          <Input
                            type="number"
                            step={entry.name === "stDepression" ? 0.1 : 1}
                            value={form[entry.name] ?? ""}
                            onChange={(event) => setForm((current) => ({ ...current, [entry.name]: event.target.value }))}
                            min={entry.minimum} max={entry.maximum}
                            required
                            aria-describedby={`help-${entry.name}`}
                          />
                          <span id={`help-${entry.name}`} className="block text-xs font-normal text-slate-500">
                            {description?.description ?? entry.name}{NUMERIC_HELP[entry.name] ?? ""} — valid range {entry.minimum}–{entry.maximum} {entry.unit}
                          </span>
                        </label>
                      );
                    })}
                    {CONTENT_FEATURES.map((entry) => {
                      const description = featureContract.get(entry.name);
                      return (
                        <label key={entry.name} className="space-y-1 text-sm font-medium">
                          <span className="block">{fieldDescription(entry.name, featureContract)}</span>
                          <select value={form[entry.name] ?? ""} onChange={(event) => setForm((current) => ({ ...current, [entry.name]: event.target.value }))} required className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                            <option value="" disabled>Select…</option>
                            {entry.values.map((value, index) => <option key={value} value={value}>{entry.labels[index]}</option>)}
                          </select>
                          <span className="block text-xs font-normal text-slate-500">{entry.help ?? description?.description}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                <fieldset className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <legend className="text-sm font-semibold">Contextual cardiovascular history <span className="text-xs font-normal text-slate-500">(recorded on the assessment but NOT used by the current model)</span></legend>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {CONTEXTUAL_FACTORS.map((factor) => (
                      <label key={factor.value} className="space-y-1 text-sm font-medium">
                        <span className="block">{factor.label}</span>
                        <Input
                          type="text"
                          value={contextual[factor.value] ?? ""}
                          onChange={(event) => setContextual((current) => ({ ...current, [factor.value]: event.target.value }))}
                          maxLength={160}
                          placeholder="Optional — leave empty if unanswered"
                        />
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500">The unscored model cannot see this information; nothing here quantitatively changes the score. It is saved so that a clinician reviewing the record has the full picture.</p>
                </fieldset>

                {casesQuery.isError && <p role="status" className="text-sm text-slate-500">Cases could not be loaded; you can still save without linking one.</p>}
                {createAssessment.isError && (
                  <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    Assessment was not scored. Check each field against its allowed range and category list, then retry. {createAssessment.error instanceof Error ? createAssessment.error.message : null}
                  </p>
                )}

                {!showReview && (
                  <p className="text-sm text-slate-600 flex items-start gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Next step: an exact review of the values you are about to submit. Nothing has been saved or scored yet.</p>
                )}

                {showReview && (
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-4" aria-label="Review of values about to be submitted">
                    <h3 className="font-semibold text-primary flex items-center gap-2"><Stethoscope className="h-4 w-4" />Review — the exact values about to be submitted</h3>
                    <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-1 text-sm md:grid-cols-2">
                      {reviewRows.map((row) => (
                        <div key={row.name} className="flex justify-between gap-3 border-b border-primary/10 py-1">
                          <dt className="text-slate-600">{row.description}</dt>
                          <dd className="font-mono text-right text-slate-900">{row.value}</dd>
                        </div>
                      ))}
                    </dl>
                    {currentSymptoms.length > 0 && <p className="mt-2 text-sm text-red-700">Urgent symptom screen selected: {currentSymptoms.map((value) => URGENT_SYMPTOM_OPTIONS.find((option) => option.value === value)?.label).join(", ")}. The model will be skipped and the safety notice saved instead.</p>}
                    <p className="mt-2 text-xs text-slate-500">Source of values: {MEASUREMENT_SOURCES.find((entry) => entry.value === measurementSource)?.label}{caseId ? ` · Linked case ${caseId}` : " · No linked case"}.</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button type="button" variant="outline" onClick={() => setShowReview(false)}>Back to editing</Button>
                      <Button type="submit" disabled={createAssessment.isPending}>{createAssessment.isPending ? "Scoring inputs…" : "Confirm and submit for research scoring"}</Button>
                    </div>
                  </div>
                )}

                {!showReview && (
                  <div className="flex flex-wrap items-center gap-3">
                    <Button type="button" disabled={!formReady} onClick={() => setShowReview(true)} className="inline-flex items-center gap-2">
                      Review before submitting<ArrowRight className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => { setForm({}); setCurrentSymptoms([]); setContextual({}); setShowReview(false); createAssessment.reset(); }}>Clear all values</Button>
                  </div>
                )}
              </form>
            )}

            {status && researchServingEnabled && currentSymptoms.length > 0 && (
              <section className="mb-6 rounded-2xl border border-red-200 bg-red-100 p-6" role="alert">
                <h2 className="font-semibold text-red-900">Emergency guidance shown instead of a score</h2>
                <p className="mt-2 text-sm text-red-900">You reported symptoms that may be an emergency. The research score is deliberately unavailable here — software never overrides or delays emergency care. Contact local emergency services now.</p>
              </section>
            )}
          </>
        )}

        {researchServingEnabled && latest && (
          <section className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-6" aria-live="polite" aria-labelledby="cardiac-result-heading">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="cardiac-result-heading" className="text-lg font-bold text-amber-900">Research result dashboard · assessment #{latest.id}</h2>
              <span className="rounded-full bg-amber-200 px-3 py-0.5 text-xs font-bold text-amber-900">Research only — uncalibrated</span>
            </div>
            <p className="mt-1 text-xs text-amber-900">{new Date(latest.createdAt).toLocaleString()} · model {latest.modelId} ({latest.modelVersion})</p>
            {typeof latest.riskScore === "number" ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="rounded-xl bg-white p-5 border border-amber-200">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Model output and semantics</p>
                  <p className="mt-1 font-mono text-3xl text-slate-900">{latest.riskScore.toFixed(4)}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    An <strong>uncalibrated logistic score</strong> — not a probability of heart disease for any individual. {latest.aboveThreshold ? "Above" : "Below"} the model build's default decision threshold of {latest.threshold}.
                  </p>
                  <p className="mt-2 text-xs text-slate-500">Threshold provenance: an engineering default from the research training pipeline, chosen without clinical input. It is not a medically meaningful boundary between health states.</p>
                </div>
                <div className="rounded-xl bg-white p-5 border border-amber-200">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Largest weighted contributions (not causal evidence)</p>
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
                  <p className="mt-2 text-xs text-slate-500">These are mathematical weights from the model's standardised inputs. They describe the model's computation, not biological causes.</p>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm">No score was produced for this record. {latest.notice}</p>
            )}
            <p className="mt-3 text-sm text-amber-900">{latest.notice}</p>
            <p className="mt-2 text-xs text-amber-900 italic">Statistical model output, the values you entered, and any AI-generated explanatory text below are three different things and are always kept separate in this interface and in the saved record.</p>
            <details className="mt-3" open>
              <summary className="cursor-pointer text-xs font-semibold text-amber-900">Inputs used and documented limitations</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-900">
                {(latest.diagnosticLimitations ?? []).map((limitation, index) => <li key={index}>{limitation}</li>)}
              </ul>
            </details>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void downloadExport(latest, "txt")} className="inline-flex items-center gap-2"><FileText className="h-3.5 w-3.5" />Export summary .txt</Button>
              <Button variant="outline" size="sm" onClick={() => void downloadExport(latest, "pdf")} className="inline-flex items-center gap-2"><Download className="h-3.5 w-3.5" />Export summary .pdf</Button>
            </div>
          </section>
        )}

        {researchServingEnabled && latest && (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" aria-labelledby="cardiac-ai-heading">
            <div className="flex items-center gap-2 mb-4"><BrainCircuit className="h-5 w-5 text-primary" /><h2 id="cardiac-ai-heading" className="font-semibold">AI explanation (optional, consent-gated)</h2></div>
            <div className="rounded-xl bg-slate-50 p-4 text-sm">
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5" checked={consentGiven} onChange={(event) => setConsentGiven(event.target.checked)} />
                <span>I understand that generating an explanation sends this assessment's research score, its model contributions, and the thirteen saved inputs to an external AI provider for educational wording, and I explicitly consent to that transfer. The explanation cannot change the saved score, threshold, label, or inputs.</span>
              </label>
              <p className="mt-2 text-xs text-slate-500">The explanation is written by a language model, kept fully separate from the numerical result, and may itself be imperfect. Provider failures never affect the saved assessment.</p>
              <Button
                className="mt-3"
                size="sm"
                disabled={!consentGiven || explainAssessment.isPending || explainTargetId === null || (openAssessmentId ? detailQuery.data?.assessment.status : latest?.status) !== "research_only"}
                onClick={() => explainAssessment.mutate({ id: explainTargetId!, data: { consentToExternalProcessing: true } })}
              >
                {explainAssessment.isPending ? "Generating explanation…" : "Generate AI explanation"}
              </Button>
              {explainAssessment.isError && <p role="alert" className="mt-3 text-sm text-destructive">The explanation failed; the research result is unchanged and may be retried. {explainAssessment.error instanceof Error ? explainAssessment.error.message : null}</p>}
            </div>
            {explanationsQuery.isLoading && <p role="status" className="mt-4 text-sm text-slate-500">Loading saved explanations…</p>}
            {explanations.length > 0 && (
              <ul className="mt-4 space-y-3">
                {explanations.map((explanation) => (
                  <li key={explanation.id} className={`rounded-xl border p-4 text-sm ${explanation.status === "completed" ? "border-slate-200" : "border-destructive/30 bg-destructive/5"}`}>
                    {explanation.status === "failed" ? (
                      <p role="alert" className="text-destructive">Explanation attempt failed{explanation.errorCode ? ` (${explanation.errorCode})` : null}. Nothing about the assessment was changed. Retry below if you wish.</p>
                    ) : (
                      <>
                        <p className="text-xs text-slate-500">Provider {explanation.provider} · model {explanation.model} · prompt {explanation.promptVersion} · {new Date(explanation.createdAt).toLocaleString()}{(explanation as { comparedAssessmentId?: number | null }).comparedAssessmentId ? ` · compared with assessment #${(explanation as { comparedAssessmentId?: number | null }).comparedAssessmentId}` : null}</p>
                        {explanation.sections && (
                          <div className="mt-2 space-y-2">
                            {typeof explanation.sections.scoreMeaning === "string" && <p><span className="font-semibold">What the score is: </span>{explanation.sections.scoreMeaning}</p>}
                            {Array.isArray(explanation.sections.contributionInsights) && explanation.sections.contributionInsights.map((insight) => (
                              "topic" in (insight as Record<string, unknown>) ? (
                                <p key={(insight as { topic: string }).topic}><span className="font-semibold">{(insight as { topic: string }).topic}: </span>{(insight as { explanation: string }).explanation}</p>
                              ) : null
                            ))}
                            {typeof explanation.sections.modelBoundaries === "string" && <p><span className="font-semibold">What the model cannot infer: </span>{explanation.sections.modelBoundaries}</p>}
                            {typeof explanation.sections.missingInformation === "string" && <p><span className="font-semibold">Missing / unanswered: </span>{explanation.sections.missingInformation}</p>}
                            {typeof explanation.sections.comparisonContext === "string" && <p><span className="font-semibold">Comparison: </span>{explanation.sections.comparisonContext}</p>}
                            {Array.isArray(explanation.sections.questionsForProvider) && explanation.sections.questionsForProvider.length > 0 && (
                              <p><span className="font-semibold">Questions to bring to a professional: </span>{(explanation.sections.questionsForProvider as string[]).join(" ")}</p>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="mt-10 rounded-2xl border border-slate-200 bg-white overflow-hidden" aria-labelledby="cardiac-history-heading">
          <div className="flex items-center gap-2 p-5 border-b border-slate-200"><Clock className="h-5 w-5 text-primary" /><h2 id="cardiac-history-heading" className="font-semibold">Longitudinal history</h2></div>

          {researchServingEnabled && history.length >= 2 && (
            <div className="border-b border-slate-100 p-5 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2"><Scale className="h-4 w-4 text-primary" />Compare two saved assessments</h3>
              <p className="text-xs text-slate-500">Recallable measurements differ between models; scores are only shown side by side when both records come from the same model version. Normal biological variation is never interpreted here as improvement or deterioration.</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="text-sm font-medium space-y-1"><span className="block">Record A</span>
                  <select value={compareLeft ?? ""} onChange={(event) => setCompareLeft(event.target.value ? Number(event.target.value) : null)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                    <option value="">Select…</option>
                    {history.map((item) => <option key={item.id} value={item.id}>#{item.id} · {new Date(item.createdAt).toLocaleDateString()} · {item.modelVersion ?? item.status}</option>)}
                  </select>
                </label>
                <label className="text-sm font-medium space-y-1"><span className="block">Record B</span>
                  <select value={compareRight ?? ""} onChange={(event) => setCompareRight(event.target.value ? Number(event.target.value) : null)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                    <option value="">Select…</option>
                    {history.map((item) => <option key={item.id} value={item.id}>#{item.id} · {new Date(item.createdAt).toLocaleDateString()} · {item.modelVersion ?? item.status}</option>)}
                  </select>
                </label>
              </div>
              {compareA && compareB && (
                scoreComparable ? (
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50"><tr><th className="px-3 py-2 text-left text-xs font-bold text-slate-500 uppercase">Recorded input</th><th className="px-3 py-2 text-left text-xs font-bold text-slate-500 uppercase">Record A</th><th className="px-3 py-2 text-left text-xs font-bold text-slate-500 uppercase">Record B</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {Object.keys(compareA.inputs ?? {}).map((name) => {
                        const valueA = String((compareA.inputs as Record<string, unknown>)[name] ?? "—");
                        const valueB = String((compareB.inputs as Record<string, unknown>)[name] ?? "—");
                        return (
                          <tr key={name} className={valueA !== valueB ? "bg-amber-50/60" : ""}>
                            <td className="px-3 py-2 text-slate-600">{fieldDescription(name, featureContract)}</td>
                            <td className="px-3 py-2 font-mono">{valueA}{valueA !== valueB ? <span className="ml-1 text-xs text-amber-700">changed</span> : null}</td>
                            <td className="px-3 py-2 font-mono">{valueB}</td>
                          </tr>
                        );
                      })}
                      <tr className="bg-slate-50">
                        <td className="px-3 py-2 font-semibold text-slate-700">Research score (same model {compareA.modelVersion})</td>
                        <td className="px-3 py-2 font-mono">{compareA.riskScore != null ? compareA.riskScore.toFixed(4) : "not scored"}</td>
                        <td className="px-3 py-2 font-mono">{compareB.riskScore != null ? compareB.riskScore.toFixed(4) : "not scored"}</td>
                      </tr>
                    </tbody>
                  </table>
                ) : (
                  <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">These two records cannot have their scores compared directly (different model versions or one without a research score). The saved inputs are still shown with each record below.</p>
                )
              )}
            </div>
          )}

          <div className="p-5 space-y-4 md:hidden">
            {trendFor(history, "restingBloodPressure").length >= 2 && <p className="text-xs text-slate-500">Trend charts are available on wider screens.</p>}
          </div>
          {history.length >= 2 && (
            <div className="hidden md:grid grid-cols-1 lg:grid-cols-3 gap-6 border-b border-slate-100 p-5">
              {[
                { label: "Recorded resting blood pressure (mm Hg)", points: bloodPressureTrend },
                { label: "Recorded cholesterol (mg/dl)", points: cholesterolTrend },
                { label: "Recorded max heart rate (beats/min)", points: maxHeartRateTrend },
              ].map((trend) => (
                <div key={trend.label} className="text-sm text-slate-600">
                  <p className="font-medium text-slate-700">{trend.label}</p>
                  <Sparkline points={trend.points} />
                  <p className="text-xs text-slate-500">Recorded values only: {trend.points.length >= 2 ? `${trend.points[0].value} → ${trend.points[trend.points.length - 1].value}` : "fewer than two records"}. No interpretation is implied.</p>
                </div>
              ))}
            </div>
          )}

          {assessmentsQuery.isLoading && <p role="status" className="p-6 text-sm text-slate-500">Loading saved assessments…</p>}
          {assessmentsQuery.isError && <div className="p-6"><p role="alert" className="text-sm text-slate-600">Saved assessments could not be loaded.</p><Button variant="outline" className="mt-2" onClick={() => void assessmentsQuery.refetch()}>Retry</Button></div>}
          {history.length === 0 && <p className="p-6 text-sm text-slate-500">No saved assessments yet.</p>}
          {history.map((item) => (
            <article key={item.id} className="border-b last:border-b-0 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-medium">
                    {typeof item.riskScore === "number" ? `Score ${item.riskScore.toFixed(4)}` : "No score served"}
                    {typeof item.riskScore === "number" && item.aboveThreshold ? " · above default threshold" : ""}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {new Date(item.createdAt).toLocaleString()} · record #{item.id} · {item.status.replace(/_/g, " ")}
                    {item.measurementSource && item.measurementSource !== "unspecified" ? ` · values: ${MEASUREMENT_SOURCES.find((entry) => entry.value === item.measurementSource)?.label.toLowerCase()}` : " · values source: not specified"}
                    {item.contextualFactors && item.contextualFactors.length > 0 ? (() => { const count = item.contextualFactors.length; return ` · ${count} contextual entr${count === 1 ? "y" : "ies"} (not model inputs)`; })() : ""}                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.status === "research_only" && <Button variant="outline" size="sm" onClick={() => void downloadExport(item, "pdf")} className="inline-flex items-center gap-1"><Download className="h-3.5 w-3.5" />.pdf</Button>}
                  <Button variant="outline" size="sm" onClick={() => setOpenAssessmentId(item.id === openAssessmentId ? null : item.id)}>{item.id === openAssessmentId ? "Hide inputs" : "Open record"}</Button>
                </div>
              </div>
              {openAssessmentId === item.id && (
                detailQuery.isLoading ? <p role="status" className="mt-3 text-sm text-slate-500">Loading saved inputs…</p>
                  : detailQuery.isError ? <p role="alert" className="mt-3 text-sm text-destructive">The saved record could not be loaded.</p>
                    : detailQuery.data && (
                      <div className="mt-3 rounded-xl bg-slate-50 p-4 text-sm">
                        <p className="text-xs text-slate-500 mb-2">Saved model inputs (exactly what the research model consumed, plus the urgent-symptom screen):</p>
                        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
                          {Object.entries((detailQuery.data.assessment.inputs as Record<string, unknown>) ?? {}).map(([name, value]) => (
                            <div key={name} className="flex justify-between gap-3 border-b border-slate-200/60 py-0.5">
                              <dt className="text-slate-600">{fieldDescription(name, featureContract) || name}</dt>
                              <dd className="font-mono text-slate-900">{String(value)}</dd>
                            </div>
                          ))}
                        </dl>
                        {detailQuery.data.assessment.notice && <p className="mt-2 text-xs text-slate-500">{detailQuery.data.assessment.notice}</p>}
                      </div>
                    )
              )}
            </article>
          ))}
        </section>

        {status && (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">{artifactAvailable ? "The deployed baseline" : "Future model contract"}{contract.dataset?.id ? ` · ${contract.dataset.id}` : ""}</h2>
              </div>
              {artifactAvailable && (status.metrics as { test?: { rocAuc?: number } } | undefined)?.test?.rocAuc !== undefined && (
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
                <h3 className="font-semibold">Known limitations of the dataset that trained {artifactAvailable ? "the deployed baseline" : "this contract references"}</h3>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {contract.dataset.knownLimitations.map((limitation, index) => <li key={index}>{limitation}</li>)}
                </ul>
              </div>
            )}
            <p className="mt-4 text-xs text-slate-500"><AlertTriangle className="mr-1 inline h-3 w-3" />This research model does not assess: blood-pressure or other measurement trends over time, medications and their effects, objective imaging such as ECG traces or angiography, family history, smoking or diabetes context, or anything outside the thirteen recorded fields above.</p>
            {contract.dataset?.sourceUrl && (
              <p className="mt-2 text-xs text-slate-500">
                Dataset reference: <a className="text-primary hover:underline" href={contract.dataset.sourceUrl} target="_blank" rel="noreferrer noopener">{contract.dataset.sourceUrl}</a>
              </p>
            )}
          </section>
        )}
        <p className="mt-6 text-sm text-slate-500">Every score in this module reflects a statistical relation learned in one historical research dataset. History views summarise recorded values without interpretation, and this tool shall never be treated as medical advice.</p>
      </div>
    </Layout>
  );
}

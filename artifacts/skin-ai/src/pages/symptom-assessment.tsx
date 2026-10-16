import { FormEvent, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateSymptomAssessment, useListCases, useListSymptomAssessments } from "@workspace/api-client-react";
import { AlertTriangle, ArrowLeft, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Layout } from "@/components/layout";

const categories = ["skin", "general", "neurological", "cardiovascular", "respiratory", "gastrointestinal", "musculoskeletal", "psychiatric", "other"] as const;
const urgencyStyle: Record<string, string> = {
  emergency: "border-red-300 bg-red-50 text-red-900",
  urgent: "border-amber-300 bg-amber-50 text-amber-900",
  routine: "border-blue-200 bg-blue-50 text-blue-900",
  self_care: "border-slate-200 bg-slate-50 text-slate-800",
};

const quickStarters: Array<{ label: string; category: (typeof categories)[number] }> = [
  { label: "Rash or skin change", category: "skin" },
  { label: "Chest pain", category: "cardiovascular" },
  { label: "Shortness of breath", category: "respiratory" },
  { label: "Headache", category: "neurological" },
  { label: "Fever", category: "general" },
  { label: "Abdominal pain", category: "gastrointestinal" },
  { label: "Joint pain", category: "musculoskeletal" },
  { label: "Anxiety or low mood", category: "psychiatric" },
];

export default function SymptomAssessment() {
  const [primarySymptom, setPrimarySymptom] = useState("");
  const [category, setCategory] = useState<(typeof categories)[number]>("general");
  const [onset, setOnset] = useState("");
  const [duration, setDuration] = useState("");
  const [severity, setSeverity] = useState("");
  const [progression, setProgression] = useState("");
  const [associated, setAssociated] = useState("");
  const [caseId, setCaseId] = useState("");
  const queryClient = useQueryClient();
  const assessmentsQuery = useListSymptomAssessments({ page: 1, limit: 10 });
  const casesQuery = useListCases({ page: 1, limit: 100 });
  const createAssessment = useCreateSymptomAssessment({ mutation: {
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/symptom-assessments"] });
      setPrimarySymptom("");
      setAssociated("");
    },
  } });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createAssessment.mutate({ data: {
      primarySymptom: primarySymptom.trim(),
      symptomCategory: category,
      ...(onset.trim() ? { onset: onset.trim() } : {}),
      ...(duration.trim() ? { duration: duration.trim() } : {}),
      ...(severity ? { severity } : {}),
      ...(progression ? { progression } : {}),
      ...(caseId ? { caseId: Number(caseId) } : {}),
      associatedSymptoms: associated.split(",").map((item) => item.trim()).filter(Boolean),
    } });
  };

  const latest = createAssessment.data?.assessment;
  const previous = (assessmentsQuery.data?.assessments ?? []).filter((item) => item.id !== latest?.id);

  return (
    <Layout>
      <div className="max-w-5xl mx-auto pt-8 pb-20">
        <Link href="/" className="inline-flex items-center gap-2 text-slate-500 hover:text-primary font-medium mb-6"><ArrowLeft className="w-4 h-4" />Back to Overview</Link>
        <div className="mb-8"><h1 className="text-4xl md:text-5xl font-display font-extrabold text-slate-900 tracking-tight">Symptom Assessment</h1><p className="text-slate-600 mt-2 max-w-2xl">Record symptoms and receive conservative guidance from a small, transparent rule set. This does not diagnose or rule out illness.</p></div>

        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><h2 className="font-semibold">Urgent symptoms</h2><p className="mt-1 text-sm">If you believe you may be experiencing a medical emergency, contact local emergency services or seek immediate care now. Do not wait for or rely on this assessment.</p></div></div>

        <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
          <div>
            <p className="text-sm font-medium">Common starting points</p>
            <p className="mt-1 text-xs text-slate-500">These only fill in suggested wording and a category. They are not a list of recognized conditions and do not select any diagnosis.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {quickStarters.map((starter) => (
                <button
                  key={starter.label}
                  type="button"
                  onClick={() => { setPrimarySymptom(starter.label); setCategory(starter.category); }}
                  aria-pressed={primarySymptom === starter.label && category === starter.category}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${primarySymptom === starter.label && category === starter.category ? "border-primary bg-primary text-white" : "border-slate-200 bg-white text-slate-600 hover:border-primary hover:text-primary"}`}
                >
                  {starter.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1 text-sm font-medium md:col-span-2">Primary symptom<textarea value={primarySymptom} onChange={(event) => setPrimarySymptom(event.target.value)} required maxLength={1_000} rows={3} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="Describe what you are experiencing" /></label>
            <label className="space-y-1 text-sm font-medium">Category<select value={category} onChange={(event) => setCategory(event.target.value as (typeof categories)[number])} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">{categories.map((value) => <option key={value} value={value}>{value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())}</option>)}</select></label>
            <label className="space-y-1 text-sm font-medium">Linked case (optional)<select value={caseId} onChange={(event) => setCaseId(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">No case</option>{(casesQuery.data?.cases ?? []).map((item) => <option key={item.id} value={item.id}>{item.caseNumber}</option>)}</select></label>
            <label className="space-y-1 text-sm font-medium">Onset<Input value={onset} onChange={(event) => setOnset(event.target.value)} maxLength={200} placeholder="When it began" /></label>
            <label className="space-y-1 text-sm font-medium">Duration<Input value={duration} onChange={(event) => setDuration(event.target.value)} maxLength={200} placeholder="How long it has lasted" /></label>
            <label className="space-y-1 text-sm font-medium">Reported severity<select value={severity} onChange={(event) => setSeverity(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Not recorded</option><option value="mild">Mild</option><option value="moderate">Moderate</option><option value="severe">Severe</option></select></label>
            <label className="space-y-1 text-sm font-medium">Progression<select value={progression} onChange={(event) => setProgression(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Not recorded</option><option value="improving">Improving</option><option value="stable">Stable</option><option value="worsening">Worsening</option><option value="fluctuating">Fluctuating</option></select></label>
            <label className="space-y-1 text-sm font-medium md:col-span-2">Other reported symptoms (comma-separated)<Input value={associated} onChange={(event) => setAssociated(event.target.value)} maxLength={2_000} placeholder="Optional" /></label>
          </div>
          {casesQuery.isError && <p role="status" className="text-sm text-slate-500">Cases could not be loaded; you can still save without linking one.</p>}
          {createAssessment.isError && <p role="alert" className="text-sm text-destructive">Assessment was not saved. Check the fields and retry.</p>}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={createAssessment.isPending || primarySymptom.trim().length < 3}>{createAssessment.isPending ? "Saving assessment…" : "Save and assess"}</Button>
            <Button type="button" variant="ghost" onClick={() => { setPrimarySymptom(""); setAssociated(""); setOnset(""); setDuration(""); setSeverity(""); setProgression(""); setCategory("general"); setCaseId(""); createAssessment.reset(); }}>Clear form</Button>
            <span className="text-xs text-slate-500">At least 3 characters are required. Your text is stored exactly as entered.</span>
          </div>
        </form>

        {latest && <section className={`mt-6 rounded-2xl border p-6 ${urgencyStyle[latest.urgencyLevel] ?? urgencyStyle.routine}`} aria-live="polite"><p className="text-xs font-semibold uppercase tracking-wide">Persisted rule-based result · record #{latest.id}</p><h2 className="mt-1 text-2xl font-bold">{latest.urgencyLevel.replace(/_/g, " ").toUpperCase()} guidance</h2><p className="mt-2 text-sm">This is a rule-based urgency level, not a disease prediction. No condition is named or scored. It reflects only the terms and fields you entered.</p><ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{(latest.guidance.recommendations ?? []).map((recommendation, index) => <li key={index}>{recommendation}</li>)}</ul>{latest.redFlagsTriggered?.length ? <p className="mt-3 text-sm font-medium">Matched warning terms in your text: {latest.redFlagsTriggered.join(", ")}</p> : <p className="mt-3 text-sm">No warning terms were matched in your text.</p>}
          <dl className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div><dt className="opacity-70">Primary symptom, as entered</dt><dd className="font-medium">{latest.primarySymptom}</dd></div>
            <div><dt className="opacity-70">Category</dt><dd className="font-medium">{latest.symptomCategory.replace(/_/g, " ")}</dd></div>
            <div><dt className="opacity-70">Reported severity</dt><dd className="font-medium">{latest.severity ? latest.severity.replace(/_/g, " ") : "Not recorded"}</dd></div>
            <div><dt className="opacity-70">Onset</dt><dd className="font-medium">{latest.onset || "Not recorded"}</dd></div>
            <div><dt className="opacity-70">Duration</dt><dd className="font-medium">{latest.duration || "Not recorded"}</dd></div>
            <div><dt className="opacity-70">Progression</dt><dd className="font-medium">{latest.progression ? latest.progression.replace(/_/g, " ") : "Not recorded"}</dd></div>
            {latest.associatedSymptoms?.length ? <div className="col-span-2 sm:col-span-3"><dt className="opacity-70">Other reported symptoms</dt><dd className="font-medium">{latest.associatedSymptoms.join(", ")}</dd></div> : null}
          </dl>
          <p className="mt-4 text-xs">{latest.guidance.disclaimer}</p></section>}

        <section className="mt-10 rounded-2xl border border-slate-200 bg-white overflow-hidden"><div className="flex items-center gap-2 p-5 border-b border-slate-200"><ClipboardList className="h-5 w-5 text-primary" /><h2 className="font-semibold">Saved assessments</h2></div>
          {assessmentsQuery.isLoading && <p role="status" className="p-6 text-sm text-slate-500">Loading saved assessments…</p>}
          {assessmentsQuery.isError && <div className="p-6"><p role="alert" className="text-sm text-slate-600">Saved assessments could not be loaded.</p><Button variant="outline" className="mt-2" onClick={() => void assessmentsQuery.refetch()}>Retry</Button></div>}
          {!assessmentsQuery.isLoading && !assessmentsQuery.isError && previous.length === 0 && !latest && <p className="p-6 text-sm text-slate-500">No saved assessments yet.</p>}
          {[...(latest ? [latest] : []), ...previous].map((item) => <article key={item.id} className="border-b last:border-b-0 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-medium">{item.primarySymptom}</h3><span className={`rounded-full border px-3 py-1 text-xs font-semibold ${urgencyStyle[item.urgencyLevel] ?? urgencyStyle.routine}`}>{item.urgencyLevel.replace(/_/g, " ")}</span></div><p className="mt-1 text-xs text-slate-500">{new Date(item.createdAt).toLocaleString()} · {item.symptomCategory.replace(/_/g, " ")}</p></article>)}
        </section>
        <p className="mt-6 text-sm text-slate-500">The rules are not clinical guidelines and may miss important context. They do not provide medical advice or a reliable risk estimate.</p>
      </div>
    </Layout>
  );
}

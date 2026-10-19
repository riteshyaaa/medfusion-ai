import { FormEvent, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateSymptomAssessment, useCreateSymptomAiEvaluation, useGetSymptomClassifierStatus, useListCases, useListSymptomAssessments, useListSymptomFollowUpQuestions, type SymptomAssessment } from "@workspace/api-client-react";
import { AIEvaluationModal, type AIEvaluationModalAssessment } from "@/components/ai-evaluation-modal";
import { AlertTriangle, ArrowLeft, ClipboardList, Loader2, Search, X } from "lucide-react";
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
const urgencyStateLabel: Record<string, string> = {
  routine_guidance: "Routine guidance",
  needs_more_information: "Needs more information",
  urgent_guidance: "Urgent — seek care promptly",
  emergency_guidance: "Emergency — seek care now",
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

type SavedAssessment = SymptomAssessment;

export default function SymptomAssessment() {
  const [primarySymptom, setPrimarySymptom] = useState("");
  const [category, setCategory] = useState<(typeof categories)[number]>("general");
  const [onset, setOnset] = useState("");
  const [duration, setDuration] = useState("");
  const [severity, setSeverity] = useState("");
  const [progression, setProgression] = useState("");
  const [associated, setAssociated] = useState("");
  const [caseId, setCaseId] = useState("");
  const [symptomSearch, setSymptomSearch] = useState("");
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);
  const [ageGroup, setAgeGroup] = useState("");
  const [factorsThatHelp, setFactorsThatHelp] = useState("");
  const [factorsThatWorsen, setFactorsThatWorsen] = useState("");
  const [previousEpisodes, setPreviousEpisodes] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [aiConsent, setAiConsent] = useState(false);
  const [evaluationFor, setEvaluationFor] = useState<AIEvaluationModalAssessment | null>(null);
  const queryClient = useQueryClient();
  const assessmentsQuery = useListSymptomAssessments({ page: 1, limit: 10 });
  const casesQuery = useListCases({ page: 1, limit: 100 });
  const classifierStatusQuery = useGetSymptomClassifierStatus();
  const classifierStatus = classifierStatusQuery.data;
  const catalogue = classifierStatus?.available ? classifierStatus.catalogue : undefined;
  const catalogueLookup = useMemo(() => {
    if (!catalogue) return new Map<string, string>();
    return new Map(catalogue.map((display) => [display, display.replace(/ /g, "_").replace(/\s+/g, "_").toLowerCase()]));
  }, [catalogue]);
  const idToDisplay = useMemo(() => new Map([...(catalogueLookup || []).entries()].map(([display, id]) => [id, display])), [catalogueLookup]);
  const filteredCatalogue = useMemo(() => {
    if (!catalogue) return [];
    const query = symptomSearch.trim().toLowerCase();
    if (!query) return catalogue.slice(0, 60);
    return catalogue.filter((display) => display.includes(query) || catalogueLookup.get(display)?.includes(query)).slice(0, 60);
  }, [catalogue, catalogueLookup, symptomSearch]);

  const followUpQuery = useListSymptomFollowUpQuestions({
    category,
    ...(primarySymptom.trim().length >= 3 ? { primary: primarySymptom.trim() } : {}),
    ...(selectedSymptoms.length > 0 ? { symptoms: selectedSymptoms.join(",") } : {}),
  }, {
    query: {
      enabled: primarySymptom.trim().length >= 3 || selectedSymptoms.length > 0,
      refetchOnWindowFocus: false,
    },
  });
  const openQuestions = (followUpQuery.data?.questions ?? []).filter((question) => !(question.id in answers));

  const createAssessment = useCreateSymptomAssessment({ mutation: {
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/symptom-assessments"] });
      setPrimarySymptom("");
      setAssociated("");
      setAiConsent(false);
      setAnswers({});
    },
  } });
  const retryEvaluation = useCreateSymptomAiEvaluation();

  const toggleSymptom = (display: string) => {
    const id = catalogueLookup.get(display);
    if (!id) return;
    setSelectedSymptoms((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };

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
      selectedSymptoms,
      ...(ageGroup ? { ageGroup: ageGroup as SymptomAssessment["ageGroup"] } : {}),
      factorsThatHelp: factorsThatHelp.split(",").map((item) => item.trim()).filter(Boolean),
      factorsThatWorsen: factorsThatWorsen.split(",").map((item) => item.trim()).filter(Boolean),
      ...(previousEpisodes ? { previousEpisodes: previousEpisodes as SymptomAssessment["previousEpisodes"] } : {}),
      ...(additionalNotes.trim() ? { additionalNotes: additionalNotes.trim() } : {}),
      questionnaireAnswers: Object.entries(answers).map(([questionId, answer]) => ({ questionId, answer })),
      consentToExternalProcessing: aiConsent,
    } });
  };

  const loadAssessment = (item: SavedAssessment) => {
    setPrimarySymptom(item.primarySymptom);
    if ((categories as readonly string[]).includes(item.symptomCategory)) setCategory(item.symptomCategory as (typeof categories)[number]);
    setOnset(item.onset ?? "");
    setDuration(item.duration ?? "");
    setSeverity(item.severity ?? "");
    setProgression(item.progression ?? "");
    setAssociated((item.associatedSymptoms ?? []).join(", "));
    setCaseId("caseId" in item && item.caseId ? String(item.caseId) : "");
    setSelectedSymptoms(item.selectedSymptoms ?? []);
    const record = item as SavedAssessment & { questionnaireAnswers?: Array<{ questionId: string; answer: string }> };
    setAnswers(Object.fromEntries((record.questionnaireAnswers ?? []).map((row) => [row.questionId, row.answer])));
    createAssessment.reset();
    retryEvaluation.reset();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const latest = createAssessment.data?.assessment;
  const latestOutcome = createAssessment.data;
  const previous = (assessmentsQuery.data?.assessments ?? []).filter((item) => item.id !== latest?.id);
  const classification = latest?.classification;
  const shownEvaluation = retryEvaluation.data?.evaluation ?? createAssessment.data?.evaluation;
  const evaluationRetryPending = retryEvaluation.isPending;

  return (
    <Layout>
      <div className="max-w-5xl mx-auto pt-8 pb-20">
        <Link href="/" className="inline-flex items-center gap-2 text-slate-500 hover:text-primary font-medium mb-6"><ArrowLeft className="w-4 h-4" />Back to Overview</Link>
        <div className="mb-8"><h1 className="text-4xl md:text-5xl font-display font-extrabold text-slate-900 tracking-tight">Symptom Assessment</h1><p className="text-slate-600 mt-2 max-w-2xl">Describe your symptoms, answer the follow-up questions that apply, and receive deterministic safety guidance plus an optional structured AI evaluation saved to your record.</p></div>

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

          {catalogue && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium flex-1">Possible-condition catalogue ({catalogue.length} symptoms)</p>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">Condition ranking</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">Selecting these symptoms gives the classifier more to work with, producing a sharper ranking. Urgency rules come from the rule set only.</p>
              <div className="mt-3 relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input value={symptomSearch} onChange={(event) => setSymptomSearch(event.target.value)} placeholder={`Search the ${catalogue.length} curated symptoms…`} className="pl-9" maxLength={100} />
              </div>
              {selectedSymptoms.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedSymptoms.map((id) => (
                    <button key={id} type="button" onClick={() => setSelectedSymptoms((current) => current.filter((value) => value !== id))} className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-900 hover:border-emerald-500">
                      {idToDisplay.get(id) ?? id}
                      <X className="h-3 w-3" />
                    </button>
                  ))}
                  <button type="button" onClick={() => setSelectedSymptoms([])} className="text-xs text-slate-500 underline hover:text-slate-700">Clear selection</button>
                </div>
              )}
              {filteredCatalogue.length > 0 && (
                <div className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap gap-1.5">
                    {(filteredCatalogue as string[]).map((display) => {
                      const id = catalogueLookup.get(display);
                      if (!id) return null;
                      const active = selectedSymptoms.includes(id);
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => toggleSymptom(display)}
                          aria-pressed={active}
                          className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${active ? "border-emerald-500 bg-emerald-100 text-emerald-900" : "border-slate-200 bg-white text-slate-600 hover:border-primary hover:text-primary"}`}
                        >
                          {display}
                        </button>
                      );
                    })}
                  </div>
                  {symptomSearch.trim() === "" && catalogue.length > 60 && <p className="mt-2 text-xs text-slate-400">Showing the first 60 — use the search box to find more.</p>}
                  {filteredCatalogue.length === 0 && <p className="mt-2 text-xs text-slate-400">No catalogue entry matches “{symptomSearch.trim()}”. You can still record it as free text below; unmatched symptoms will never be counted as classifier evidence.</p>}
                </div>
              )}
              {classifierStatusQuery.isError && <p role="status" className="mt-2 text-xs text-slate-500">The classifier catalogue could not be loaded; the rest of the form still works.</p>}
              <p className="mt-2 text-xs text-slate-500">Selected symptoms are stored with the assessment and feed the ranking engine.</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1 text-sm font-medium md:col-span-2">Primary symptom<textarea value={primarySymptom} onChange={(event) => setPrimarySymptom(event.target.value)} required maxLength={1_000} rows={3} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="Describe what you are experiencing" /></label>
            <label className="space-y-1 text-sm font-medium">Category<select value={category} onChange={(event) => setCategory(event.target.value as (typeof categories)[number])} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">{categories.map((value) => <option key={value} value={value}>{value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())}</option>)}</select></label>
            <label className="space-y-1 text-sm font-medium">Age group (optional)<select value={ageGroup} onChange={(event) => setAgeGroup(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Prefer not to say</option><option value="child">Child</option><option value="adolescent">Adolescent</option><option value="adult">Adult</option><option value="older_adult">Older adult</option><option value="unknown">Not sure</option></select></label>
            <label className="space-y-1 text-sm font-medium">Linked case (optional)<select value={caseId} onChange={(event) => setCaseId(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">No case</option>{(casesQuery.data?.cases ?? []).map((item) => <option key={item.id} value={item.id}>{item.caseNumber}</option>)}</select></label>
            <label className="space-y-1 text-sm font-medium">Previous episodes (optional)<select value={previousEpisodes} onChange={(event) => setPreviousEpisodes(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Not recorded</option><option value="first_episode">First episode</option><option value="recurrent">Has happened before</option><option value="unknown">Not sure</option></select></label>
            <label className="space-y-1 text-sm font-medium">Onset<Input value={onset} onChange={(event) => setOnset(event.target.value)} maxLength={200} placeholder="When it began" /></label>
            <label className="space-y-1 text-sm font-medium">Duration<Input value={duration} onChange={(event) => setDuration(event.target.value)} maxLength={200} placeholder="How long it has lasted — kept exactly as you word it" /></label>
            <label className="space-y-1 text-sm font-medium">Reported severity<select value={severity} onChange={(event) => setSeverity(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Not recorded</option><option value="mild">Mild</option><option value="moderate">Moderate</option><option value="severe">Severe</option></select></label>
            <label className="space-y-1 text-sm font-medium">Progression<select value={progression} onChange={(event) => setProgression(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Not recorded</option><option value="improving">Improving</option><option value="stable">Stable</option><option value="worsening">Worsening</option><option value="fluctuating">Fluctuating</option></select></label>
            <label className="space-y-1 text-sm font-medium md:col-span-2">Other reported symptoms (comma-separated free text)<Input value={associated} onChange={(event) => setAssociated(event.target.value)} maxLength={2_000} placeholder="Optional — kept as text, never fed to the classifier as a match" /></label>
            <label className="space-y-1 text-sm font-medium md:col-span-2">What makes it better or worse (optional, comma-separated)<Input value={factorsThatHelp} onChange={(event) => setFactorsThatHelp(event.target.value)} maxLength={2_000} placeholder="e.g. rest, paracetamol" /></label>
            <label className="space-y-1 text-sm font-medium md:col-span-2">Worsened by (optional, comma-separated)<Input value={factorsThatWorsen} onChange={(event) => setFactorsThatWorsen(event.target.value)} maxLength={2_000} placeholder="e.g. walking, lying flat, certain foods" /></label>
            <label className="space-y-1 text-sm font-medium md:col-span-2">Additional notes (optional)<textarea value={additionalNotes} onChange={(event) => setAdditionalNotes(event.target.value)} maxLength={2_000} rows={2} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="Anything else you consider relevant" /></label>
          </div>

          {(followUpQuery.isLoading || openQuestions.length > 0) && (
            <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-sky-900">Follow-up questions for this pattern (v{followUpQuery.data?.questionSetVersion ?? "…"})</p>
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">{openQuestions.length} still needed</span>
              </div>
              <p className="mt-1 text-xs text-sky-900/80">Answers never replace the safety rules — a “yes” can raise urgency immediately. “Not sure” is always allowed and is stored as unknown, not as a no.</p>
              {followUpQuery.isLoading && <p role="status" className="mt-3 flex items-center gap-2 text-sm text-sky-900"><Loader2 className="h-4 w-4 animate-spin" />Loading relevant questions…</p>}
              {followUpQuery.isError && <p role="status" className="mt-3 text-sm text-sky-900">Questions could not be loaded; you can still submit the assessment.</p>}
              <div className="mt-3 space-y-3">
                {openQuestions.map((question) => (
                  <div key={question.id} className="rounded-lg border border-sky-200 bg-white p-3">
                    <p className="text-sm font-medium text-slate-800">{question.prompt}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(question.type === "choice" ? (question.options ?? []) : ["yes", "no", "not sure"]).map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setAnswers((current) => ({ ...current, [question.id]: option }))}
                          aria-pressed={answers[question.id] === option}
                          className={`rounded-full border px-3 py-1 text-xs transition-colors ${answers[question.id] === option ? "border-sky-600 bg-sky-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-sky-500 hover:text-sky-700"}`}
                        >
                          {option === "not sure" ? "Not sure" : option.charAt(0).toUpperCase() + option.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {openQuestions.length === 0 && !followUpQuery.isLoading && <p className="mt-3 text-xs text-sky-900">All suggested follow-up questions answered — you can submit now.</p>}
            </div>
          )}
          {followUpQuery.data && openQuestions.length === 0 && (followUpQuery.data.questions?.length ?? 0) > 0 && (
            <p className="text-xs text-slate-500">All {followUpQuery.data.questions?.length} suggested follow-up questions answered.</p>
          )}

          <label className="flex items-start gap-2 text-sm font-medium">
            <input type="checkbox" checked={aiConsent} onChange={(event) => setAiConsent(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
            <span>Also ask the external AI engine for a structured educational evaluation, consented server-side. It adds context only; the deterministic guidance above and below always outranks it.</span>
          </label>
          {casesQuery.isError && <p role="status" className="text-sm text-slate-500">Cases could not be loaded; you can still save without linking one.</p>}
          {createAssessment.isError && <p role="alert" className="text-sm text-destructive">Assessment was not saved. Check the fields and retry.</p>}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={createAssessment.isPending || primarySymptom.trim().length < 3}>{createAssessment.isPending ? "Saving and assessing…" : "Save and assess"}</Button>
            <Button type="button" variant="ghost" onClick={() => { setPrimarySymptom(""); setAssociated(""); setOnset(""); setDuration(""); setSeverity(""); setProgression(""); setCategory("general"); setCaseId(""); setSelectedSymptoms([]); setSymptomSearch(""); setAgeGroup(""); setFactorsThatHelp(""); setFactorsThatWorsen(""); setPreviousEpisodes(""); setAdditionalNotes(""); setAnswers({}); setAiConsent(false); createAssessment.reset(); retryEvaluation.reset(); }}>Clear form</Button>
            <span className="text-xs text-slate-500">At least 3 characters are required. Your text is stored exactly as entered.</span>
          </div>
        </form>

        {latest && <section className={`mt-6 rounded-2xl border p-6 ${urgencyStyle[latest.urgencyLevel] ?? urgencyStyle.routine}`} aria-live="polite"><div className="flex flex-wrap items-center gap-2"><p className="text-xs font-semibold uppercase tracking-wide">Persisted rule-based result · record #{latest.id}</p><span className="rounded-full bg-white/70 px-3 py-1 text-xs font-semibold">{urgencyStateLabel[createAssessment.data?.urgencyState ?? ""] ?? "Guidance"}</span></div><h2 className="mt-1 text-2xl font-bold">{latest.urgencyLevel.replace(/_/g, " ").toUpperCase()} guidance</h2><p className="mt-2 text-sm">This is a rule-based urgency level, not a disease prediction. It reflects only the terms and fields you entered.</p><ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{(latest.guidance.recommendations ?? []).map((recommendation, index) => <li key={index}>{recommendation}</li>)}</ul>{latest.redFlagsTriggered?.length ? <p className="mt-3 text-sm font-medium">Matched warning terms in your text: {latest.redFlagsTriggered.join(", ")}</p> : <p className="mt-3 text-sm">No warning terms were matched in your text.</p>}
          <dl className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div><dt className="opacity-70">Primary symptom, as entered</dt><dd className="font-medium">{latest.primarySymptom}</dd></div>
            <div><dt className="opacity-70">Category</dt><dd className="font-medium">{latest.symptomCategory.replace(/_/g, " ")}</dd></div>
            <div><dt className="opacity-70">Reported severity</dt><dd className="font-medium">{latest.severity ? latest.severity.replace(/_/g, " ") : "Not recorded"}</dd></div>
            <div><dt className="opacity-70">Onset</dt><dd className="font-medium">{latest.onset || "Not recorded"}</dd></div>
            <div><dt className="opacity-70">Duration</dt><dd className="font-medium">{latest.duration || "Not recorded"}</dd></div>
            <div><dt className="opacity-70">Progression</dt><dd className="font-medium">{latest.progression ? latest.progression.replace(/_/g, " ") : "Not recorded"}</dd></div>
            {latest.associatedSymptoms?.length ? <div className="col-span-2 sm:col-span-3"><dt className="opacity-70">Other reported symptoms (free text)</dt><dd className="font-medium">{latest.associatedSymptoms.join(", ")}</dd></div> : null}
            {latest.selectedSymptoms?.length ? <div className="col-span-2 sm:col-span-3"><dt className="opacity-70">Catalogue symptoms selected for the classifier</dt><dd className="font-medium">{latest.selectedSymptoms.map((id) => idToDisplay.get(id) ?? id).join(", ")}</dd></div> : null}
          </dl>
          {latest.guidance?.watchFor?.length ? <div className="mt-4 rounded-xl bg-white/60 border border-slate-200 p-4"><p className="text-xs font-semibold uppercase tracking-wide">Watch for (deterioration signals)</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{latest.guidance.watchFor.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}
          {latest.guidance?.seekCareIf?.length ? <div className="mt-3 rounded-xl bg-white/60 border border-slate-200 p-4"><p className="text-xs font-semibold uppercase tracking-wide">Seek in-person care if</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{latest.guidance.seekCareIf.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}
          {latest.guidance?.possibleConditions?.length ? <div className="mt-3 rounded-xl bg-white/60 border border-slate-200 p-4"><p className="text-xs font-semibold uppercase tracking-wide">Conditions classically associated with this pattern</p><p className="mt-1 text-xs text-slate-500">From the classifier training data. The full ranking is below.</p><ol className="mt-2 list-disc space-y-1 pl-5 text-sm">{latest.guidance.possibleConditions.map((row, index) => <li key={index}><span className="font-medium">{row.name}</span></li>)}</ol></div> : null}
          <p className="mt-4 text-xs">{latest.guidance.disclaimer}</p></section>}

        {latest && classification && (
          <section className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-6" aria-live="polite">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-amber-900">Which conditions match what you selected</h2>
              <span className="rounded-full bg-primary/10 px-3 py-0.5 text-xs font-bold text-primary">Research ranking</span>
            </div>
            <p className="mt-2 text-sm text-amber-900">{classification.notice}</p>
            {classification.status === "completed" && classification.rankedConditions && (
              <>
                <ol className="mt-4 space-y-2">
                  {classification.rankedConditions.map((row, index) => (
                    <li key={row.condition} className="rounded-lg bg-white/70 p-3 border border-amber-200">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-800">{index + 1}. {row.condition}</span>
                        <span className="font-mono text-xs text-slate-600" title="Uncalibrated posterior: not a probability of disease">score {row.score.toFixed(4)}</span>
                      </div>
                      {(row.supportingSymptoms?.length ?? 0) > 0 && <p className="mt-1 text-xs text-emerald-800">Most consistent with your selections: {(row.supportingSymptoms ?? []).map((id) => idToDisplay.get(id) ?? id).join(", ")}</p>}
                      {(row.nonSupportingSymptoms?.length ?? 0) > 0 && <p className="mt-0.5 text-xs text-slate-500">Not typically associated with this condition: {(row.nonSupportingSymptoms ?? []).map((id) => idToDisplay.get(id) ?? id).join(", ")}</p>}
                    </li>
                  ))}
                </ol>
                {classification.unmatchedSymptoms?.length ? <p className="mt-3 text-sm">Your free text was kept out of the ranking: {classification.unmatchedSymptoms.join(", ")}</p> : null}
                <details className="mt-4">
                  <summary className="cursor-pointer text-xs font-semibold text-amber-900">Documented classifier limitations</summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-900">
                    {(classification.diagnosticLimitations ?? []).map((limitation, index) => <li key={index}>{limitation}</li>)}
                  </ul>
                </details>
              </>
            )}
            {classification.status !== "completed" && <p className="mt-3 text-sm">No ranked conditions were produced for this record {classification.status === "insufficient_input" ? "because no catalogue symptom matched the classifier vocabulary" : "because the classifier is not installed"}. The urgency guidance above still applies.</p>}
          </section>
        )}

        {latest && shownEvaluation?.status === "failed" && (
          <section className="mt-6 rounded-2xl border border-orange-300 bg-orange-50 p-6" aria-live="polite">
            <h2 className="text-lg font-bold text-orange-900">AI evaluation could not complete</h2>
            <p role="alert" className="mt-2 text-sm text-orange-900">{latestOutcome?.aiMessage ?? "The analysis engine did not return a usable evaluation."}</p>
            <p className="mt-1 text-sm">Your assessment #{latest.id} and the rule-based guidance were saved unchanged. Nothing was fabricated to fill the gap.</p>
            {retryEvaluation.isError && <p role="alert" className="mt-2 text-sm text-destructive">The retry also failed. The saved assessment is unchanged; you can try again later.</p>}
            <Button type="button" variant="outline" size="sm" className="mt-3" disabled={evaluationRetryPending} onClick={() => retryEvaluation.mutate({ id: latest.id, data: { consentToExternalProcessing: true } })}>
              {evaluationRetryPending ? "Retrying evaluation…" : "Retry AI evaluation"}
            </Button>
          </section>
        )}

        {latest && shownEvaluation?.status === "completed" && shownEvaluation.result && typeof shownEvaluation.result === "object" && (
          <section className="mt-6 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-6" aria-live="polite">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-indigo-900">AI assessment interpretation</h2>
              <span className="rounded-full bg-indigo-200 px-3 py-0.5 text-xs font-bold text-indigo-900">Educational only</span>
            </div>
            <p className="mt-1 text-xs text-indigo-800">Provider {shownEvaluation.provider} · model {shownEvaluation.model} · prompt v{shownEvaluation.promptVersion} · saved {new Date(shownEvaluation.createdAt).toLocaleString()}</p>
            <div className="mt-4 space-y-4">
              {(() => {
                const result = shownEvaluation.result as Record<string, unknown>;
                return (
                  <>
                    {typeof result.summary === "string" && <div><p className="text-xs font-semibold uppercase tracking-wide text-indigo-900">Summary of what you reported</p><p className="mt-1 text-sm text-slate-700">{result.summary}</p></div>}
                    {Array.isArray(result.reportedSymptoms) && <div><p className="text-xs font-semibold uppercase tracking-wide text-indigo-900">Reported symptoms as understood</p><p className="mt-1 text-sm text-slate-700">{(result.reportedSymptoms as string[]).join("; ")}</p></div>}
                    {Array.isArray(result.possibleConsiderations) && result.possibleConsiderations.length > 0 && (
                      <div><p className="text-xs font-semibold uppercase tracking-wide text-indigo-900">Patterns this may fit (not a diagnosis)</p>
                        <ol className="mt-2 space-y-2">
                          {(result.possibleConsiderations as Array<{ name: string; whyDiscussed: string }>).map((row) => (
                            <li key={row.name} className="rounded-lg bg-white p-3 border border-indigo-200"><p className="text-sm font-semibold text-slate-800">{row.name}</p><p className="mt-1 text-sm text-slate-600">{row.whyDiscussed}</p></li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {typeof result.supportingInformation === "string" && <div><p className="text-xs font-semibold uppercase tracking-wide text-indigo-900">Supporting information</p><p className="mt-1 text-sm text-slate-700">{result.supportingInformation}</p></div>}
                    {typeof result.missingInformation === "string" && <div><p className="text-xs font-semibold uppercase tracking-wide text-indigo-900">Missing information</p><p className="mt-1 text-sm text-slate-700">{result.missingInformation}</p></div>}
                    {typeof result.urgencyContext === "string" && <div><p className="text-xs font-semibold uppercase tracking-wide text-indigo-900">Urgency context (AI view — the rule-based card above stays authoritative)</p><p className="mt-1 text-sm text-slate-700">{result.urgencyContext}</p></div>}
                    {Array.isArray(result.followUpQuestions) && result.followUpQuestions.length > 0 && <div><p className="text-xs font-semibold uppercase tracking-wide text-indigo-900">Questions a clinician may explore next</p><ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">{(result.followUpQuestions as string[]).map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
                    {typeof result.limitations === "string" && <div><p className="text-xs font-semibold uppercase tracking-wide text-indigo-900">Limitations</p><p className="mt-1 text-sm text-slate-700">{result.limitations}</p></div>}
                    <p className="text-xs italic text-indigo-900">{String(result.disclaimer ?? "Educational information only, not a diagnosis.")}</p>
                  </>
                );
              })()}
            </div>
          </section>
        )}

        {latest && !shownEvaluation && createAssessment.data?.aiStatus === "skipped_urgent" && (
          <section className="mt-6 rounded-2xl border border-slate-300 bg-slate-50 p-6" aria-live="polite">
            <h2 className="text-lg font-bold text-slate-900">AI evaluation skipped for urgency</h2>
            <p className="mt-2 text-sm text-slate-700">{createAssessment.data?.aiMessage ?? "Urgent guidance was returned immediately without waiting for the AI engine."}</p>
            <p className="mt-1 text-sm text-slate-600">The choice is still yours: you can run the optional AI evaluation on this saved record whenever you want.</p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setEvaluationFor({ id: latest.id, primarySymptom: latest.primarySymptom, selectedSymptoms: latest.selectedSymptoms ?? [], urgencyLevel: latest.urgencyLevel, redFlagsTriggered: latest.redFlagsTriggered ?? [] })}>
              Run AI evaluation (optional)
            </Button>
          </section>
        )}

        {latest && !shownEvaluation && (createAssessment.data?.aiStatus === "unavailable") && (
          <section className="mt-6 rounded-2xl border border-slate-300 bg-slate-50 p-6" aria-live="polite">
            <h2 className="text-lg font-bold text-slate-900">AI evaluation unavailable</h2>
            <p role="status" className="mt-2 text-sm text-slate-700">{createAssessment.data?.aiMessage ?? "The AI engine did not run for this record."}</p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setEvaluationFor({ id: latest.id, primarySymptom: latest.primarySymptom, selectedSymptoms: latest.selectedSymptoms ?? [], urgencyLevel: latest.urgencyLevel, redFlagsTriggered: latest.redFlagsTriggered ?? [] })}>
              Run AI evaluation (optional)
            </Button>
          </section>
        )}

        {latest && !shownEvaluation && createAssessment.data?.aiStatus === "not_requested" && (
          <section className="mt-6 rounded-2xl border border-slate-300 bg-slate-50 p-6" aria-live="polite">
            <h2 className="text-lg font-bold text-slate-900">Optional AI evaluation — your choice</h2>
            <p className="mt-2 text-sm text-slate-700">No AI evaluation was run for assessment #{latest.id}. The rule-based assessment above is complete and saved; nothing external was contacted.</p>
            <p className="mt-1 text-sm text-slate-600">You can still request a consented, educational AI interpretation of this assessment at any time — or leave it as rules-only.</p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setEvaluationFor({ id: latest.id, primarySymptom: latest.primarySymptom, selectedSymptoms: latest.selectedSymptoms ?? [], urgencyLevel: latest.urgencyLevel, redFlagsTriggered: latest.redFlagsTriggered ?? [] })}>
              Run AI evaluation (optional)
            </Button>
          </section>
        )}

        <section className="mt-10 rounded-2xl border border-slate-200 bg-white overflow-hidden"><div className="flex items-center gap-2 p-5 border-b border-slate-200"><ClipboardList className="h-5 w-5 text-primary" /><h2 className="font-semibold">Saved assessments</h2></div>
          {assessmentsQuery.isLoading && <p role="status" className="p-6 text-sm text-slate-500">Loading saved assessments…</p>}
          {assessmentsQuery.isError && <div className="p-6"><p role="alert" className="text-sm text-slate-600">Saved assessments could not be loaded.</p><Button variant="outline" className="mt-2" onClick={() => void assessmentsQuery.refetch()}>Retry</Button></div>}
          {!assessmentsQuery.isLoading && !assessmentsQuery.isError && previous.length === 0 && !latest && <p className="p-6 text-sm text-slate-500">No saved assessments yet.</p>}
          {[...(latest ? [latest] : []), ...previous].map((item) => <article key={item.id} className="border-b last:border-b-0 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-medium">{item.primarySymptom}</h3><div className="flex items-center gap-2"><span className={`rounded-full border px-3 py-1 text-xs font-semibold ${urgencyStyle[item.urgencyLevel] ?? urgencyStyle.routine}`}>{item.urgencyLevel.replace(/_/g, " ")}</span>{item.classification?.status === "completed" && <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">classified</span>}<Button type="button" variant="outline" className="h-7 px-2 py-0 text-xs" onClick={() => setEvaluationFor({ id: item.id, primarySymptom: item.primarySymptom, selectedSymptoms: item.selectedSymptoms ?? [], urgencyLevel: item.urgencyLevel, redFlagsTriggered: item.redFlagsTriggered ?? [] })}>Detailed Evaluation</Button><Button type="button" variant="outline" className="h-7 px-2 py-0 text-xs" onClick={() => loadAssessment(item)}>Load &amp; edit</Button></div></div><p className="mt-1 text-xs text-slate-500">{new Date(item.createdAt).toLocaleString()} · {item.symptomCategory.replace(/_/g, " ")}</p></article>)}
        </section>
        <p className="mt-6 text-sm text-slate-500">Guidance is generated from the details you enter and structured rules — never a diagnosis. For any persistent or worsening symptom, consult a doctor.</p>
      </div>

      <AIEvaluationModal assessment={evaluationFor} onClose={() => setEvaluationFor(null)} />
    </Layout>
  );
}

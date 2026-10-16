import { FormEvent, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateCase, useListCases, useListPatients, useUpdateCase } from "@workspace/api-client-react";
import type { CaseStatus } from "@workspace/api-client-react";
import { ArrowLeft, Clock, FileText, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Layout } from "@/components/layout";

const filters = [
  { label: "All", value: "all" },
  { label: "Open", value: "open" },
  { label: "In review", value: "in_review" },
  { label: "On hold", value: "on_hold" },
  { label: "Closed", value: "closed" },
] as const;

function title(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function Cases() {
  const [filter, setFilter] = useState<(typeof filters)[number]["value"]>("all");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [patientId, setPatientId] = useState("");
  const [type, setType] = useState("skin_analysis");
  const [priority, setPriority] = useState("medium");
  const [chiefComplaint, setChiefComplaint] = useState("");
  const queryClient = useQueryClient();
  const casesQuery = useListCases({ page: 1, limit: 100, ...(filter === "all" ? {} : { status: filter }) });
  const patientsQuery = useListPatients({ page: 1, limit: 100 });
  const createCase = useCreateCase({ mutation: {
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      setShowForm(false);
      setPatientId("");
      setChiefComplaint("");
    },
  } });
  const updateCase = useUpdateCase({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/cases"] }) } });
  const patientsById = useMemo(() => new Map((patientsQuery.data?.patients ?? []).map((patient) => [patient.id, patient])), [patientsQuery.data]);
  const cases = (casesQuery.data?.cases ?? []).filter((item) => {
    const patient = patientsById.get(item.patientId);
    const text = `${item.caseNumber} ${item.chiefComplaint ?? ""} ${patient?.firstName ?? ""} ${patient?.lastName ?? ""}`.toLowerCase();
    return text.includes(search.toLowerCase());
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createCase.mutate({ data: {
      patientId: Number(patientId),
      type: type as "skin_analysis" | "symptom_assessment" | "follow_up" | "consultation",
      priority: priority as "low" | "medium" | "high" | "urgent",
      ...(chiefComplaint.trim() ? { chiefComplaint: chiefComplaint.trim() } : {}),
    } });
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto pt-10 pb-20">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <Link href="/" className="inline-flex items-center gap-2 text-slate-500 hover:text-primary font-medium mb-4"><ArrowLeft className="w-4 h-4" />Back to Overview</Link>
            <h1 className="text-4xl md:text-5xl font-display font-extrabold text-slate-900 tracking-tight">Case Management</h1>
            <p className="text-slate-600 mt-2">Cases and status updates stored under your account</p>
          </div>
          <Button onClick={() => setShowForm((value) => !value)} className="gap-2"><Plus className="w-5 h-5" />{showForm ? "Close form" : "Create case"}</Button>
        </div>

        {showForm && (
          <form onSubmit={submit} className="mb-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <label className="space-y-1 text-sm font-medium">Patient<select required value={patientId} onChange={(event) => setPatientId(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Choose a patient</option>{(patientsQuery.data?.patients ?? []).map((patient) => <option key={patient.id} value={patient.id}>{patient.firstName} {patient.lastName}</option>)}</select></label>
            <label className="space-y-1 text-sm font-medium">Case type<select value={type} onChange={(event) => setType(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="skin_analysis">Skin Analysis</option><option value="symptom_assessment">Symptom Assessment</option><option value="follow_up">Follow-up</option><option value="consultation">Consultation</option></select></label>
            <label className="space-y-1 text-sm font-medium">Priority<select value={priority} onChange={(event) => setPriority(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
            <label className="space-y-1 text-sm font-medium lg:col-span-1">Chief complaint (optional)<Input value={chiefComplaint} onChange={(event) => setChiefComplaint(event.target.value)} maxLength={2_000} /></label>
            <div className="flex items-end"><Button type="submit" className="w-full" disabled={createCase.isPending || !patientId || patientsQuery.isLoading}>{createCase.isPending ? "Saving…" : "Save case"}</Button></div>
            {patientsQuery.isError && <p className="sm:col-span-2 lg:col-span-5 text-sm text-destructive">Patients could not be loaded. Retry before creating a case.</p>}
            {!patientsQuery.isLoading && !patientsQuery.isError && (patientsQuery.data?.patients.length ?? 0) === 0 && <p className="sm:col-span-2 lg:col-span-5 text-sm text-slate-600">Create a patient record before creating a case.</p>}
            {createCase.isError && <p role="alert" className="sm:col-span-2 lg:col-span-5 text-sm text-destructive">The case could not be saved. Check that the selected patient is available and retry.</p>}
          </form>
        )}

        <div className="flex flex-wrap gap-2 mb-6" role="group" aria-label="Filter cases by status">
          {filters.map((item) => <button key={item.value} type="button" onClick={() => setFilter(item.value)} aria-pressed={filter === item.value} className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${filter === item.value ? "bg-primary text-white" : "bg-white text-slate-600 border border-slate-200 hover:border-primary hover:text-primary"}`}>{item.label}</button>)}
        </div>

        <section className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden" aria-labelledby="case-list-title">
          <div className="p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div><h2 id="case-list-title" className="font-display font-bold text-lg text-slate-900">Cases</h2>{!casesQuery.isLoading && !casesQuery.isError && <p className="text-sm text-slate-500 mt-1">{casesQuery.data?.total ?? 0} matching cases</p>}</div>
            <div className="relative w-full sm:w-72"><Search className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" /><Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search cases" placeholder="Search cases…" className="pl-10 bg-slate-50" /></div>
          </div>
          {casesQuery.isLoading && <p role="status" className="p-10 text-center text-slate-500">Loading cases…</p>}
          {casesQuery.isError && <div className="p-10 text-center"><p role="alert" className="text-slate-600">Cases could not be loaded.</p><Button variant="outline" onClick={() => void casesQuery.refetch()} className="mt-3">Retry</Button></div>}
          {!casesQuery.isLoading && !casesQuery.isError && cases.length === 0 && <div className="p-12 text-center"><FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" /><h3 className="font-semibold">{search ? "No matching cases" : "No cases yet"}</h3><p className="text-sm text-slate-500 mt-1">Create a case from one of your patient records.</p></div>}
          {!casesQuery.isLoading && !casesQuery.isError && cases.length > 0 && (
            <div className="overflow-x-auto"><table className="w-full min-w-[900px]">
              <thead className="bg-slate-50"><tr><th className="px-5 py-4 text-left text-xs font-bold text-slate-500 uppercase">Case</th><th className="px-5 py-4 text-left text-xs font-bold text-slate-500 uppercase">Patient</th><th className="px-5 py-4 text-left text-xs font-bold text-slate-500 uppercase">Type</th><th className="px-5 py-4 text-left text-xs font-bold text-slate-500 uppercase">Status</th><th className="px-5 py-4 text-left text-xs font-bold text-slate-500 uppercase">Priority</th><th className="px-5 py-4 text-left text-xs font-bold text-slate-500 uppercase">Created</th><th className="px-5 py-4 text-left text-xs font-bold text-slate-500 uppercase">Details</th></tr></thead>
              <tbody className="divide-y divide-slate-200">{cases.map((item) => <tr key={item.id} className="hover:bg-slate-50">
                <td className="px-5 py-4"><p className="font-mono font-semibold text-primary">{item.caseNumber}</p><p className="max-w-48 truncate text-xs text-slate-500">{item.chiefComplaint || "No complaint recorded"}</p></td>
                <td className="px-5 py-4 text-slate-700">{patientsById.get(item.patientId) ? `${patientsById.get(item.patientId)?.firstName} ${patientsById.get(item.patientId)?.lastName}` : `Patient #${item.patientId}`}</td>
                <td className="px-5 py-4 text-slate-600">{title(item.type)}</td>
                <td className="px-5 py-4"><label className="sr-only" htmlFor={`status-${item.id}`}>Status for {item.caseNumber}</label><select id={`status-${item.id}`} value={item.status} disabled={updateCase.isPending} onChange={(event) => updateCase.mutate({ id: item.id, data: { status: event.target.value as CaseStatus } })} className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"><option value="open">Open</option><option value="in_review">In review</option><option value="on_hold">On hold</option><option value="closed">Closed</option></select></td>
                <td className="px-5 py-4 text-slate-600">{title(item.priority)}</td>
                <td className="px-5 py-4 text-slate-600">{new Date(item.createdAt).toLocaleDateString()}</td>
                <td className="px-5 py-4"><Link href={`/cases/${item.id}`} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-primary hover:bg-primary/5"><Clock className="w-4 h-4" />View</Link></td>
              </tr>)}</tbody>
            </table></div>
          )}
          {updateCase.isError && <p role="alert" className="border-t border-slate-200 p-4 text-sm text-destructive">The status update failed. Refresh the case list and retry.</p>}
        </section>
      </div>
    </Layout>
  );
}

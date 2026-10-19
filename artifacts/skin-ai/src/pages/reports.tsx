import { FormEvent, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateReport, exportReport, exportReportPdf, useListCases, useListPatients, useListReports, useUpdateReport } from "@workspace/api-client-react";
import type { ListReportsStatus } from "@workspace/api-client-react";
import { ArrowLeft, Archive, FileText, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Layout } from "@/components/layout";

const statuses = ["all", "draft", "finalized", "archived", "amended"] as const;
const reportTypes = ["skin_analysis", "symptom_assessment", "comprehensive", "follow_up"] as const;

function title(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function Reports() {
  const [status, setStatus] = useState<(typeof statuses)[number]>("all");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [caseId, setCaseId] = useState("");
  const [reportTitle, setReportTitle] = useState("");
  const [type, setType] = useState<(typeof reportTypes)[number]>("comprehensive");
  const queryClient = useQueryClient();
  const reportsQuery = useListReports({ page: 1, limit: 100, ...(status === "all" ? {} : { status: status as ListReportsStatus }) });
  const casesQuery = useListCases({ page: 1, limit: 100 });
  const patientsQuery = useListPatients({ page: 1, limit: 100 });
  const createReport = useCreateReport({ mutation: {
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
      setReportTitle("");
      setCaseId("");
      setShowForm(false);
    },
  } });
  const updateReport = useUpdateReport({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/reports"] }) } });
  const caseById = useMemo(() => new Map((casesQuery.data?.cases ?? []).map((item) => [item.id, item])), [casesQuery.data]);
  const patientById = useMemo(() => new Map((patientsQuery.data?.patients ?? []).map((item) => [item.id, item])), [patientsQuery.data]);
  const reports = (reportsQuery.data?.reports ?? []).filter((report) => {
    const caseItem = caseById.get(report.caseId);
    return `${report.reportNumber} ${report.title} ${caseItem?.caseNumber ?? ""}`.toLowerCase().includes(search.toLowerCase());
  });


  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createReport.mutate({ data: { caseId: Number(caseId), title: reportTitle.trim(), type } });
  };

  const downloadExport = async (report: { id: number; reportNumber: string }, format: "txt" | "pdf") => {
    try {
      const blob = format === "pdf" ? await exportReportPdf(report.id) : new Blob([await exportReport(report.id)], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `${report.reportNumber}.${format}`;
      anchor.rel = "noopener";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      window.alert("The export could not be generated. Retry.");
    }
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto pt-10 pb-20">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div><Link href="/" className="inline-flex items-center gap-2 text-slate-500 hover:text-primary font-medium mb-4"><ArrowLeft className="w-4 h-4" />Back to Overview</Link><h1 className="text-4xl md:text-5xl font-display font-extrabold text-slate-900 tracking-tight">Reports</h1><p className="text-slate-600 mt-2">Drafts are assembled only from records you own. They are not signed or clinically reviewed.</p></div>
          <Button onClick={() => setShowForm((value) => !value)} className="gap-2"><Plus className="w-5 h-5" />{showForm ? "Close form" : "Create draft"}</Button>
        </div>

        {showForm && <form onSubmit={submit} className="mb-8 grid grid-cols-1 sm:grid-cols-3 gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <label className="space-y-1 text-sm font-medium">Case<select value={caseId} onChange={(event) => setCaseId(event.target.value)} required className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Choose a case</option>{(casesQuery.data?.cases ?? []).map((item) => { const patient = patientById.get(item.patientId); return <option key={item.id} value={item.id}>{item.caseNumber} · {patient ? `${patient.firstName} ${patient.lastName}` : "Patient record"}</option>; })}</select></label>
          <label className="space-y-1 text-sm font-medium">Title<Input value={reportTitle} onChange={(event) => setReportTitle(event.target.value)} required maxLength={200} placeholder="Report title" /></label>
          <label className="space-y-1 text-sm font-medium">Report type<select value={type} onChange={(event) => setType(event.target.value as (typeof reportTypes)[number])} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">{reportTypes.map((item) => <option key={item} value={item}>{title(item)}</option>)}</select></label>
          <p className="sm:col-span-3 text-sm text-slate-500">The server builds the draft from the selected case, its patient record, saved symptom assessments, and explicitly linked predictions. It does not accept free-form generated clinical findings.</p>
          {casesQuery.isError && <p role="status" className="sm:col-span-3 text-sm text-slate-600">Cases could not be loaded. Retry before creating a report.</p>}
          {createReport.isError && <p role="alert" className="sm:col-span-3 text-sm text-destructive">The draft could not be saved. Check that the selected case belongs to your account and retry.</p>}
          <div className="sm:col-span-3"><Button type="submit" disabled={createReport.isPending || !caseId || !reportTitle.trim()}>{createReport.isPending ? "Saving draftâ¦" : "Save draft"}</Button></div>
        </form>}

        <div className="flex flex-wrap gap-2 mb-6" role="group" aria-label="Filter reports by status">{statuses.map((value) => <button key={value} type="button" onClick={() => setStatus(value)} aria-pressed={status === value} className={`px-4 py-2 rounded-full text-sm font-medium capitalize ${status === value ? "bg-primary text-white" : "bg-white border border-slate-200 text-slate-600 hover:border-primary hover:text-primary"}`}>{value === "all" ? "All" : title(value)}</button>)}</div>

        <section className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden" aria-labelledby="reports-title">
          <div className="p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"><div><h2 id="reports-title" className="font-display font-bold text-lg text-slate-900">Saved reports</h2>{!reportsQuery.isLoading && !reportsQuery.isError && <p className="mt-1 text-sm text-slate-500">{reportsQuery.data?.total ?? 0} reports in this view</p>}</div><Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search reports" placeholder="Search reportsâ¦" className="w-full sm:w-72 bg-slate-50" />
          </div>
          {reportsQuery.isLoading && <p role="status" className="p-10 text-center text-slate-500">Loading reportsâ¦</p>}
          {reportsQuery.isError && <div className="p-10 text-center"><p role="alert" className="text-slate-600">Reports could not be loaded.</p><Button variant="outline" className="mt-3" onClick={() => void reportsQuery.refetch()}>Retry</Button></div>}
          {!reportsQuery.isLoading && !reportsQuery.isError && reports.length === 0 && <div className="p-12 text-center"><FileText className="w-10 h-10 mx-auto mb-3 text-slate-300" /><h3 className="font-semibold">{search ? "No matching reports" : "No reports in this view"}</h3><p className="mt-1 text-sm text-slate-500">Create a draft from an existing case. All content remains clearly marked as a draft.</p></div>}
          {!reportsQuery.isLoading && !reportsQuery.isError && reports.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[850px]"><thead className="bg-slate-50"><tr><th className="px-5 py-4 text-left text-xs font-bold text-slate-500 uppercase">Report</th><th className="px-5 py-4 text-left text-xs font-bold text-slate-500 uppercase">Case / Patient</th><th className="px-5 py-4 text-left text-xs font-bold text-slate-500 uppercase">Type</th><th className="px-5 py-4 text-left text-xs font-bold text-slate-500 uppercase">Status</th><th className="px-5 py-4 text-left text-xs font-bold text-slate-500 uppercase">Created</th><th className="px-5 py-4 text-left text-xs font-bold text-slate-500 uppercase">Actions</th></tr></thead><tbody className="divide-y divide-slate-200">{reports.map((report) => { const caseItem = caseById.get(report.caseId); const patient = caseItem ? patientById.get(caseItem.patientId) : undefined; return <tr key={report.id} className="align-top hover:bg-slate-50"><td className="px-5 py-4"><p className="font-mono text-sm font-semibold text-primary">{report.reportNumber}</p><p className="font-medium text-slate-900">{report.title}</p></td><td className="px-5 py-4 text-sm text-slate-600">{caseItem?.caseNumber ?? `Case #${report.caseId}`}<span className="block text-xs">{patient ? `${patient.firstName} ${patient.lastName}` : "Patient record"}</span></td><td className="px-5 py-4 text-sm text-slate-600">{title(report.type)}</td><td className="px-5 py-4"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium">{title(report.status)}</span></td><td className="px-5 py-4 text-sm text-slate-600">{new Date(report.createdAt).toLocaleDateString()}</td><td className="px-5 py-4"><details><summary className="cursor-pointer text-sm text-primary">View saved content</summary><pre className="mt-3 max-h-72 max-w-md overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs">{JSON.stringify(report.content, null, 2)}</pre></details>{report.status === "draft" && <span className="mt-3 flex gap-2"><Button variant="outline" size="sm" onClick={() => void downloadExport(report, "txt")} >Export .txt</Button><Button variant="outline" size="sm" onClick={() => void downloadExport(report, "pdf")} >Export .pdf</Button><Button variant="outline" size="sm" disabled={updateReport.isPending} onClick={() => updateReport.mutate({ id: report.id, data: { status: "archived" } })}><Archive className="h-3.5 w-3.5" />Archive</Button></span>}</td></tr>; })}</tbody></table></div>}
          {updateReport.isError && <p role="alert" className="border-t border-slate-200 p-4 text-sm text-destructive">The report status could not be updated.</p>}
        </section>

        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900"><strong>Draft only.</strong> Exports (plain text and server-generated PDF) contain the same unreviewed draft content. Digital signatures and human clinical review are not implemented, and a draft does not represent a reviewed medical conclusion.</div>
      </div>
    </Layout>
  );
}

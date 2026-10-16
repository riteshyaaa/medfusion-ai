import { Link, useRoute } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useGetCase, useGetPatient, useUpdateCase } from "@workspace/api-client-react";
import type { CaseStatus } from "@workspace/api-client-react";
import { ArrowLeft, CalendarClock, FileText, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Layout } from "@/components/layout";

function title(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function CaseDetail() {
  const [, params] = useRoute("/cases/:id");
  const id = Number(params?.id);
  const validId = Number.isSafeInteger(id) && id > 0;
  const caseQuery = useGetCase(id, { query: { enabled: validId } });
  const caseRecord = caseQuery.data?.case;
  const patientQuery = useGetPatient(caseRecord?.patientId ?? 0, { query: { enabled: Boolean(caseRecord?.patientId) } });
  const queryClient = useQueryClient();
  const updateCase = useUpdateCase({ mutation: { onSuccess: async () => {
    await queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
    await caseQuery.refetch();
  } } });

  return (
    <Layout>
      <div className="max-w-5xl mx-auto pt-8 pb-20">
        <Link href="/cases" className="inline-flex items-center gap-2 text-slate-500 hover:text-primary font-medium mb-6"><ArrowLeft className="w-4 h-4" />Back to cases</Link>
        {caseQuery.isLoading && <p role="status" className="p-10 text-center text-slate-500">Loading case…</p>}
        {(caseQuery.isError || !validId) && <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center"><h1 className="text-2xl font-bold">Case unavailable</h1><p className="text-slate-600 mt-2">This case may not exist or may not belong to your account.</p><Button variant="outline" onClick={() => void caseQuery.refetch()} className="mt-4">Retry</Button></div>}
        {caseRecord && (
          <>
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
              <div><p className="font-mono text-primary font-semibold">{caseRecord.caseNumber}</p><h1 className="text-3xl font-display font-bold text-slate-900">Case details</h1><p className="text-slate-600 mt-1">{title(caseRecord.type)}</p></div>
              <label className="text-sm font-medium">Case status<select aria-label="Update case status" value={caseRecord.status} disabled={updateCase.isPending} onChange={(event) => updateCase.mutate({ id, data: { status: event.target.value as CaseStatus } })} className="ml-3 rounded-md border border-slate-200 bg-white px-3 py-2"><option value="open">Open</option><option value="in_review">In review</option><option value="on_hold">On hold</option><option value="closed">Closed</option></select></label>
            </div>
            {updateCase.isError && <p role="alert" className="mb-4 text-sm text-destructive">The status update failed. Refresh and retry.</p>}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <section className="rounded-2xl border border-slate-200 bg-white p-6"><div className="flex items-center gap-2 mb-4"><FileText className="w-5 h-5 text-primary" /><h2 className="font-semibold">Case information</h2></div><dl className="space-y-3 text-sm"><div><dt className="text-slate-500">Status</dt><dd>{title(caseRecord.status)}</dd></div><div><dt className="text-slate-500">Priority</dt><dd>{title(caseRecord.priority)}</dd></div><div><dt className="text-slate-500">Chief complaint, as entered</dt><dd className="whitespace-pre-wrap">{caseRecord.chiefComplaint || "Not recorded"}</dd></div><div><dt className="text-slate-500">Tags</dt><dd>{caseRecord.tags?.length ? caseRecord.tags.join(", ") : "None"}</dd></div></dl></section>
              <section className="rounded-2xl border border-slate-200 bg-white p-6"><div className="flex items-center gap-2 mb-4"><UserRound className="w-5 h-5 text-primary" /><h2 className="font-semibold">Patient</h2></div>{patientQuery.isLoading && <p role="status" className="text-sm text-slate-500">Loading patient profile…</p>}{patientQuery.isError && <p role="alert" className="text-sm text-slate-600">Patient details could not be loaded.</p>}{patientQuery.data?.patient && <><p className="text-lg font-medium">{patientQuery.data.patient.firstName} {patientQuery.data.patient.lastName}</p><p className="text-sm text-slate-500">Record #{patientQuery.data.patient.id}</p><Link href={`/patients/${patientQuery.data.patient.id}`} className="inline-block mt-3 text-sm text-primary hover:underline">View patient profile</Link></>}</section>
              <section className="md:col-span-2 rounded-2xl border border-slate-200 bg-white p-6"><div className="flex items-center gap-2 mb-4"><CalendarClock className="w-5 h-5 text-primary" /><h2 className="font-semibold">Timeline</h2></div><dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm"><div><dt className="text-slate-500">Created</dt><dd>{new Date(caseRecord.createdAt).toLocaleString()}</dd></div><div><dt className="text-slate-500">Last updated</dt><dd>{new Date(caseRecord.updatedAt).toLocaleString()}</dd></div><div><dt className="text-slate-500">Closed</dt><dd>{caseRecord.closedAt ? new Date(caseRecord.closedAt).toLocaleString() : "Not closed"}</dd></div></dl><p className="text-xs text-slate-500 mt-5">This case view shows persisted user-entered facts and status. It does not add model findings.</p></section>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

import { FormEvent, useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useGetPatient, useListCases, useUpdatePatient } from "@workspace/api-client-react";
import { ArrowLeft, FileText, Save, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Layout } from "@/components/layout";

export default function PatientDetail() {
  const [, params] = useRoute("/patients/:id");
  const id = Number(params?.id);
  const validId = Number.isSafeInteger(id) && id > 0;
  const queryClient = useQueryClient();
  const patientQuery = useGetPatient(id, { query: { enabled: validId } });
  const casesQuery = useListCases({ page: 1, limit: 100, patientId: id }, { query: { enabled: validId } });
  const patient = patientQuery.data?.patient;
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const updatePatient = useUpdatePatient({ mutation: {
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/patients"] });
      await patientQuery.refetch();
      setEditing(false);
    },
  } });

  useEffect(() => {
    if (!patient) return;
    setFirstName(patient.firstName);
    setLastName(patient.lastName);
    setPhone(patient.phone ?? "");
    setEmail(patient.email ?? "");
    setNotes(patient.notes ?? "");
  }, [patient]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updatePatient.mutate({ id, data: { firstName: firstName.trim(), lastName: lastName.trim(), ...(phone.trim() ? { phone: phone.trim() } : {}), ...(email.trim() ? { email: email.trim() } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) } });
  };

  return (
    <Layout>
      <div className="max-w-5xl mx-auto pt-8 pb-20">
        <Link href="/patients" className="inline-flex items-center gap-2 text-slate-500 hover:text-primary font-medium mb-6"><ArrowLeft className="w-4 h-4" />Back to patients</Link>
        {patientQuery.isLoading && <p role="status" className="p-10 text-center text-slate-500">Loading patient record…</p>}
        {(patientQuery.isError || !validId) && <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center"><h1 className="text-2xl font-bold">Patient record unavailable</h1><p className="text-slate-600 mt-2">This record may not exist or may not belong to your account.</p><Button variant="outline" onClick={() => void patientQuery.refetch()} className="mt-4">Retry</Button></div>}
        {patient && (
          <>
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
              <div><div className="flex items-center gap-3"><div className="w-12 h-12 rounded-xl bg-primary/10 grid place-items-center"><UserRound className="w-6 h-6 text-primary" /></div><div><h1 className="text-3xl font-display font-bold text-slate-900">{patient.firstName} {patient.lastName}</h1><p className="text-sm text-slate-500">Patient record #{patient.id}</p></div></div></div>
              <Button variant="outline" onClick={() => setEditing((value) => !value)}>{editing ? "Cancel edit" : "Edit profile"}</Button>
            </div>

            {editing ? (
              <form onSubmit={submit} className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-2xl border border-slate-200 bg-white p-6">
                <label className="space-y-1 text-sm font-medium">First name<Input value={firstName} onChange={(event) => setFirstName(event.target.value)} required maxLength={100} /></label>
                <label className="space-y-1 text-sm font-medium">Last name<Input value={lastName} onChange={(event) => setLastName(event.target.value)} required maxLength={100} /></label>
                <label className="space-y-1 text-sm font-medium">Phone<Input value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={40} /></label>
                <label className="space-y-1 text-sm font-medium">Email<Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} /></label>
                <label className="sm:col-span-2 space-y-1 text-sm font-medium">Notes<Input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={5_000} /></label>
                {updatePatient.isError && <p role="alert" className="sm:col-span-2 text-sm text-destructive">The patient record was not updated. Check the entered values and retry.</p>}
                <div className="sm:col-span-2"><Button type="submit" disabled={updatePatient.isPending} className="gap-2"><Save className="w-4 h-4" />{updatePatient.isPending ? "Saving…" : "Save changes"}</Button></div>
              </form>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
                <section className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="font-semibold text-slate-900 mb-4">Profile information</h2><dl className="space-y-3 text-sm"><div><dt className="text-slate-500">Date of birth</dt><dd className="text-slate-900">{patient.dateOfBirth ? new Date(patient.dateOfBirth).toLocaleDateString() : "Not recorded"}</dd></div><div><dt className="text-slate-500">Sex</dt><dd className="text-slate-900">{patient.sex ?? "Not recorded"}</dd></div><div><dt className="text-slate-500">Phone</dt><dd className="text-slate-900">{patient.phone || "Not recorded"}</dd></div><div><dt className="text-slate-500">Email</dt><dd className="text-slate-900">{patient.email || "Not recorded"}</dd></div></dl></section>
                <section className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="font-semibold text-slate-900 mb-4">User-reported information</h2><dl className="space-y-3 text-sm"><div><dt className="text-slate-500">Medical history</dt><dd className="text-slate-900">{patient.medicalHistory?.length ? patient.medicalHistory.join(", ") : "None recorded"}</dd></div><div><dt className="text-slate-500">Allergies</dt><dd className="text-slate-900">{patient.allergies?.length ? patient.allergies.join(", ") : "None recorded"}</dd></div><div><dt className="text-slate-500">Medications</dt><dd className="text-slate-900">{patient.medications?.length ? patient.medications.join(", ") : "None recorded"}</dd></div><div><dt className="text-slate-500">Notes</dt><dd className="text-slate-900 whitespace-pre-wrap">{patient.notes || "None recorded"}</dd></div></dl></section>
              </div>
            )}

            <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden"><div className="p-5 border-b border-slate-200"><h2 className="font-semibold text-slate-900">Cases for this patient</h2></div>
              {casesQuery.isLoading && <p role="status" className="p-6 text-slate-500">Loading cases…</p>}
              {casesQuery.isError && <div className="p-6"><p role="alert" className="text-sm text-slate-600">Cases could not be loaded.</p><Button variant="outline" onClick={() => void casesQuery.refetch()} className="mt-2">Retry</Button></div>}
              {!casesQuery.isLoading && !casesQuery.isError && (casesQuery.data?.cases.length ?? 0) === 0 && <p className="p-6 text-sm text-slate-500">No cases are linked to this patient record.</p>}
              {(casesQuery.data?.cases ?? []).map((caseItem) => <Link key={caseItem.id} href={`/cases/${caseItem.id}`} className="flex items-center justify-between gap-4 p-5 border-b last:border-b-0 hover:bg-slate-50"><span><span className="block font-mono text-sm text-primary">{caseItem.caseNumber}</span><span className="block text-xs text-slate-500">{caseItem.type.replace(/_/g, " ")} · {caseItem.status.replace(/_/g, " ")}</span></span><FileText className="w-4 h-4 text-slate-400" /></Link>)}
            </section>
          </>
        )}
      </div>
    </Layout>
  );
}

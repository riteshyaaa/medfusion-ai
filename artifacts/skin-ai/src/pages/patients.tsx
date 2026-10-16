import { FormEvent, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useCreatePatient, useListPatients } from "@workspace/api-client-react";
import { ArrowLeft, FileText, Plus, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Layout } from "@/components/layout";

export default function Patients() {
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [sex, setSex] = useState("");
  const queryClient = useQueryClient();
  const patientsQuery = useListPatients({ page: 1, limit: 100, search: search.trim() || undefined });
  const createPatient = useCreatePatient({ mutation: {
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/patients"] });
      setFirstName("");
      setLastName("");
      setDateOfBirth("");
      setSex("");
      setShowForm(false);
    },
  } });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createPatient.mutate({ data: {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      ...(dateOfBirth ? { dateOfBirth } : {}),
      ...(sex ? { sex: sex as "male" | "female" | "other" } : {}),
    } });
  };

  const patients = patientsQuery.data?.patients ?? [];

  return (
    <Layout>
      <div className="max-w-7xl mx-auto pt-10 pb-20">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <Link href="/" className="inline-flex items-center gap-2 text-slate-500 hover:text-primary font-medium mb-4 transition-colors">
              <ArrowLeft className="w-4 h-4" />Back to Overview
            </Link>
            <h1 className="text-4xl md:text-5xl font-display font-extrabold text-slate-900 tracking-tight">Patient Management</h1>
            <p className="text-slate-600 mt-2">Private profiles owned by your account</p>
          </div>
          <Button onClick={() => setShowForm((value) => !value)} className="gap-2">
            <Plus className="w-5 h-5" />{showForm ? "Close form" : "Add patient"}
          </Button>
        </div>

        {showForm && (
          <form onSubmit={submit} className="mb-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <label className="space-y-1 text-sm font-medium">First name<Input value={firstName} onChange={(event) => setFirstName(event.target.value)} required maxLength={100} autoComplete="given-name" /></label>
            <label className="space-y-1 text-sm font-medium">Last name<Input value={lastName} onChange={(event) => setLastName(event.target.value)} required maxLength={100} autoComplete="family-name" /></label>
            <label className="space-y-1 text-sm font-medium">Date of birth<Input type="date" value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} /></label>
            <label className="space-y-1 text-sm font-medium">Sex (optional)<select value={sex} onChange={(event) => setSex(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Not recorded</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></label>
            <div className="flex items-end"><Button type="submit" disabled={createPatient.isPending || !firstName.trim() || !lastName.trim()} className="w-full">{createPatient.isPending ? "Saving…" : "Save patient"}</Button></div>
            {createPatient.isError && <p role="alert" className="sm:col-span-2 lg:col-span-5 text-sm text-destructive">Patient could not be saved. Check the fields and retry.</p>}
          </form>
        )}

        <section className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden" aria-labelledby="patient-list-title">
          <div className="p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 id="patient-list-title" className="font-display font-bold text-lg text-slate-900">Patient records</h2>
              {!patientsQuery.isLoading && !patientsQuery.isError && <p className="text-sm text-slate-500 mt-1">{patientsQuery.data?.total ?? 0} records</p>}
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} type="search" aria-label="Search patients" placeholder="Search patients…" className="pl-10 bg-slate-50" />
            </div>
          </div>

          {patientsQuery.isLoading ? <p role="status" className="p-10 text-center text-slate-500">Loading patient records…</p> : null}
          {patientsQuery.isError && <div className="p-10 text-center"><p role="alert" className="text-slate-600">Patient records could not be loaded.</p><Button variant="outline" onClick={() => void patientsQuery.refetch()} className="mt-3">Retry</Button></div>}
          {!patientsQuery.isLoading && !patientsQuery.isError && patients.length === 0 && (
            <div className="p-12 text-center">
              <Users className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <h3 className="font-semibold text-slate-900">{search ? "No matching patients" : "No patient records yet"}</h3>
              <p className="text-sm text-slate-500 mt-1">{search ? "Try another search." : "Add a record to begin a case workflow. Use fictional data for local development."}</p>
            </div>
          )}
          {!patientsQuery.isLoading && !patientsQuery.isError && patients.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead className="bg-slate-50"><tr>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase">Patient</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase">Date of birth / Sex</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase">User-reported history</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase">Created</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase">Details</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-200">
                  {patients.map((patient) => (
                    <tr key={patient.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center"><Users className="w-5 h-5 text-primary" /></div><div><p className="font-medium text-slate-900">{patient.firstName} {patient.lastName}</p><p className="text-sm text-slate-500">Record #{patient.id}</p></div></div></td>
                      <td className="px-6 py-4 text-slate-600">{patient.dateOfBirth ? new Date(patient.dateOfBirth).toLocaleDateString() : "Not recorded"}<span className="block text-sm">{patient.sex ?? "Sex not recorded"}</span></td>
                      <td className="px-6 py-4 text-slate-600">{patient.medicalHistory?.length ? patient.medicalHistory.join(", ") : "None recorded"}</td>
                      <td className="px-6 py-4 text-slate-600">{new Date(patient.createdAt).toLocaleDateString()}</td>
                      <td className="px-6 py-4"><Link href={`/patients/${patient.id}`} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-primary hover:bg-primary/5"><FileText className="w-4 h-4" />View</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
}

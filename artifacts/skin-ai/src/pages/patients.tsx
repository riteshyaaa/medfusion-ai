import { Layout } from "@/components/layout";
import { Link } from "wouter";
import { ArrowLeft, Users, Plus, Search, FileText, Calendar, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

const mockPatients = [
  { id: 1, name: "Sarah Johnson", age: 34, gender: "Female", lastVisit: "2024-01-15", conditions: ["Atopic Dermatitis", "Acne"], status: "Active" },
  { id: 2, name: "Michael Chen", age: 52, gender: "Male", lastVisit: "2024-01-10", conditions: ["Psoriasis"], status: "Active" },
  { id: 3, name: "Emma Rodriguez", age: 28, gender: "Female", lastVisit: "2024-01-08", conditions: ["Contact Dermatitis"], status: "Review" },
  { id: 4, name: "James Wilson", age: 45, gender: "Male", lastVisit: "2024-01-05", conditions: ["Seborrheic Keratosis"], status: "Active" },
];

export default function Patients() {
  return (
    <Layout>
      <div className="max-w-7xl mx-auto pt-10 pb-20">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-slate-500 hover:text-primary font-medium mb-4 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Overview
            </Link>
            <h1 className="text-4xl md:text-5xl font-display font-extrabold text-slate-900 tracking-tight">
              Patient Management
            </h1>
            <p className="text-slate-600 mt-2">Secure patient profiles with access-controlled health information</p>
          </div>
          <button className="inline-flex items-center gap-2 bg-primary text-white px-6 py-3 rounded-xl font-semibold hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20">
            <Plus className="w-5 h-5" />
            Add Patient
          </button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200/60">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500 font-medium">Total Patients</p>
                <p className="text-3xl font-display font-bold text-slate-900">24</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <Users className="w-6 h-6 text-blue-500" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200/60">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500 font-medium">Active Cases</p>
                <p className="text-3xl font-display font-bold text-slate-900">18</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center">
                <FileText className="w-6 h-6 text-green-500" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200/60">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500 font-medium">Pending Review</p>
                <p className="text-3xl font-display font-bold text-slate-900">3</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center">
                <Shield className="w-6 h-6 text-amber-500" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200/60">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500 font-medium">This Month</p>
                <p className="text-3xl font-display font-bold text-slate-900">7</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center">
                <Calendar className="w-6 h-6 text-purple-500" />
              </div>
            </div>
          </div>
        </div>

        {/* Patient Table */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden">
          <div className="p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <h2 className="font-display font-bold text-lg text-slate-900">Patient List</h2>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search patients..."
                  className="pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm w-64 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                />
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Patient</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Age / Gender</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Conditions</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Last Visit</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {mockPatients.map((patient) => (
                  <tr key={patient.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <Users className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium text-slate-900">{patient.name}</p>
                          <p className="text-sm text-slate-500">ID: {patient.id.toString().padStart(6, "0")}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-600">
                      {patient.age} / {patient.gender}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {patient.conditions.map((condition) => (
                          <span key={condition} className="px-2 py-1 bg-slate-100 text-slate-700 text-xs rounded-full">
                            {condition}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-600">{patient.lastVisit}</td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-2.5 py-1 rounded-full text-xs font-medium",
                        patient.status === "Active" && "bg-green-100 text-green-700",
                        patient.status === "Review" && "bg-amber-100 text-amber-700",
                      )}>
                        {patient.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/patients/${patient.id}`}
                          className="p-2 text-slate-500 hover:text-primary hover:bg-slate-100 rounded-lg transition-colors"
                          title="View Details"
                        >
                          <FileText className="w-4 h-4" />
                        </Link>
                        <button className="p-2 text-slate-500 hover:text-primary hover:bg-slate-100 rounded-lg transition-colors" title="Edit">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-4 border-t border-slate-200 flex items-center justify-between">
            <p className="text-sm text-slate-500">Showing 4 of 24 patients</p>
            <div className="flex gap-2">
              <button className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-500 hover:bg-slate-50 transition-colors" disabled>Previous</button>
              <button className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-500 hover:bg-slate-50 transition-colors">Next</button>
            </div>
          </div>
        </div>

        {/* Coming Soon Notice */}
        <div className="mt-8 p-6 bg-slate-50 border border-slate-200 rounded-2xl text-center">
          <Shield className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="font-display font-bold text-slate-900 mb-2">Module Under Development</h3>
          <p className="text-slate-600 max-w-2xl mx-auto">
            Patient management with full CRUD operations, access control, audit trails, and integration
            with case management is being implemented. The UI structure is ready; backend APIs and
            database migrations are in progress.
          </p>
        </div>
      </div>
    </Layout>
  );
}
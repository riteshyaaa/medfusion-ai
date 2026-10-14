import { Layout } from "@/components/layout";
import { Link } from "wouter";
import { ArrowLeft, FileText, Plus, Search, Clock, AlertCircle, CheckCircle, MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";

const caseStatuses = [
  { label: "All", value: "all" },
  { label: "Open", value: "open" },
  { label: "In Review", value: "in_review" },
  { label: "Closed", value: "closed" },
];

const mockCases = [
  { id: "CS-2024-001", patient: "Sarah Johnson", type: "Skin Analysis", status: "In Review", createdAt: "2024-01-15", updatedAt: "2024-01-16", priority: "High" },
  { id: "CS-2024-002", patient: "Michael Chen", type: "Symptom Assessment", status: "Open", createdAt: "2024-01-14", updatedAt: "2024-01-14", priority: "Medium" },
  { id: "CS-2024-003", patient: "Emma Rodriguez", type: "Skin Analysis", status: "Closed", createdAt: "2024-01-12", updatedAt: "2024-01-15", priority: "Low" },
  { id: "CS-2024-004", patient: "James Wilson", type: "Follow-up", status: "Open", createdAt: "2024-01-10", updatedAt: "2024-01-10", priority: "Medium" },
  { id: "CS-2024-005", patient: "Lisa Anderson", type: "Skin Analysis", status: "In Review", createdAt: "2024-01-09", updatedAt: "2024-01-11", priority: "High" },
];

export default function Cases() {
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
              Case Management
            </h1>
            <p className="text-slate-600 mt-2">Track clinical cases with timelines, observations, and prediction records</p>
          </div>
          <button className="inline-flex items-center gap-2 bg-primary text-white px-6 py-3 rounded-xl font-semibold hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20">
            <Plus className="w-5 h-5" />
            Create Case
          </button>
        </div>

        {/* Status Filter */}
        <div className="flex flex-wrap gap-2 mb-6">
          {caseStatuses.map((status) => (
            <button
              key={status.value}
              className={cn(
                "px-4 py-2 rounded-full text-sm font-medium transition-all",
                status.value === "all"
                  ? "bg-primary text-white shadow-sm"
                  : "bg-white text-slate-600 border border-slate-200 hover:border-primary hover:text-primary"
              )}
            >
              {status.label}
            </button>
          ))}
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200/60">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500 font-medium">Total Cases</p>
                <p className="text-3xl font-display font-bold text-slate-900">42</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <FileText className="w-6 h-6 text-blue-500" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200/60">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500 font-medium">Open</p>
                <p className="text-3xl font-display font-bold text-slate-900">15</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-green-500" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200/60">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500 font-medium">In Review</p>
                <p className="text-3xl font-display font-bold text-slate-900">8</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center">
                <Clock className="w-6 h-6 text-amber-500" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200/60">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500 font-medium">High Priority</p>
                <p className="text-3xl font-display font-bold text-slate-900">5</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-red-500" />
              </div>
            </div>
          </div>
        </div>

        {/* Cases Table */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden">
          <div className="p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <h2 className="font-display font-bold text-lg text-slate-900">Cases</h2>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search cases..."
                  className="pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm w-64 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                />
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Case ID</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Patient</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Type</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Priority</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Created</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Updated</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {mockCases.map((caseItem) => (
                  <tr key={caseItem.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-mono text-sm font-medium text-slate-900">{caseItem.id}</td>
                    <td className="px-6 py-4 text-slate-600">{caseItem.patient}</td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 bg-slate-100 text-slate-700 text-xs rounded-full">{caseItem.type}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-2.5 py-1 rounded-full text-xs font-medium",
                        caseItem.status === "Open" && "bg-blue-100 text-blue-700",
                        caseItem.status === "In Review" && "bg-amber-100 text-amber-700",
                        caseItem.status === "Closed" && "bg-green-100 text-green-700",
                      )}>
                        {caseItem.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-2.5 py-1 rounded-full text-xs font-medium",
                        caseItem.priority === "High" && "bg-red-100 text-red-700",
                        caseItem.priority === "Medium" && "bg-amber-100 text-amber-700",
                        caseItem.priority === "Low" && "bg-green-100 text-green-700",
                      )}>
                        {caseItem.priority}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-600">{caseItem.createdAt}</td>
                    <td className="px-6 py-4 text-slate-600">{caseItem.updatedAt}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/cases/${caseItem.id}`}
                          className="p-2 text-slate-500 hover:text-primary hover:bg-slate-100 rounded-lg transition-colors"
                          title="View Case"
                        >
                          <FileText className="w-4 h-4" />
                        </Link>
                        <button className="p-2 text-slate-500 hover:text-primary hover:bg-slate-100 rounded-lg transition-colors" title="More">
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-4 border-t border-slate-200 flex items-center justify-between">
            <p className="text-sm text-slate-500">Showing 5 of 42 cases</p>
            <div className="flex gap-2">
              <button className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-500 hover:bg-slate-50 transition-colors" disabled>Previous</button>
              <button className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-500 hover:bg-slate-50 transition-colors">Next</button>
            </div>
          </div>
        </div>

        {/* Coming Soon Notice */}
        <div className="mt-8 p-6 bg-slate-50 border border-slate-200 rounded-2xl text-center">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="font-display font-bold text-slate-900 mb-2">Module Under Development</h3>
          <p className="text-slate-600 max-w-2xl mx-auto">
            Case management with full lifecycle tracking, timeline views, observation recording,
            media attachments, prediction linking, and review workflow integration is being implemented.
            The UI structure is ready; backend APIs and database migrations are in progress.
          </p>
        </div>
      </div>
    </Layout>
  );
}
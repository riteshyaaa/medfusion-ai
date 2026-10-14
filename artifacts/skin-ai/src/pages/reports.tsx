import { Layout } from "@/components/layout";
import { Link } from "wouter";
import { ArrowLeft, FileText, Download, Search, Calendar, Eye, AlertTriangle, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const reportStatuses = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Finalized", value: "finalized" },
  { label: "Archived", value: "archived" },
];

const mockReports = [
  { id: "RPT-2024-001", caseId: "CS-2024-001", patient: "Sarah Johnson", type: "Skin Analysis Report", status: "Draft", createdAt: "2024-01-15", reviewedBy: null },
  { id: "RPT-2024-002", caseId: "CS-2024-003", patient: "Emma Rodriguez", type: "Skin Analysis Report", status: "Finalized", createdAt: "2024-01-12", reviewedBy: "Dr. A. Patel" },
  { id: "RPT-2024-003", caseId: "CS-2024-005", patient: "Lisa Anderson", type: "Comprehensive Assessment", status: "Draft", createdAt: "2024-01-11", reviewedBy: null },
  { id: "RPT-2024-004", caseId: "CS-2024-002", patient: "Michael Chen", type: "Symptom Assessment Summary", status: "Archived", createdAt: "2024-01-10", reviewedBy: "Dr. M. Chen" },
];

export default function Reports() {
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
              Reports
            </h1>
            <p className="text-slate-600 mt-2">Generate and manage draft reports from persisted clinical records</p>
          </div>
          <button className="inline-flex items-center gap-2 bg-primary text-white px-6 py-3 rounded-xl font-semibold hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20">
            <FileText className="w-5 h-5" />
            Generate Report
          </button>
        </div>

        {/* Status Filter */}
        <div className="flex flex-wrap gap-2 mb-6">
          {reportStatuses.map((status) => (
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
                <p className="text-sm text-slate-500 font-medium">Total Reports</p>
                <p className="text-3xl font-display font-bold text-slate-900">28</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <FileText className="w-6 h-6 text-blue-500" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200/60">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500 font-medium">Drafts</p>
                <p className="text-3xl font-display font-bold text-slate-900">12</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-amber-500" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200/60">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500 font-medium">Finalized</p>
                <p className="text-3xl font-display font-bold text-slate-900">14</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-green-500" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200/60">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500 font-medium">This Month</p>
                <p className="text-3xl font-display font-bold text-slate-900">6</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center">
                <Calendar className="w-6 h-6 text-purple-500" />
              </div>
            </div>
          </div>
        </div>

        {/* Reports Table */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden">
          <div className="p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <h2 className="font-display font-bold text-lg text-slate-900">Reports</h2>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search reports..."
                  className="pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm w-64 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                />
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Report ID</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Case</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Patient</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Type</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Created</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Reviewed By</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {mockReports.map((report) => (
                  <tr key={report.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-mono text-sm font-medium text-slate-900">{report.id}</td>
                    <td className="px-6 py-4 font-mono text-sm text-slate-600">{report.caseId}</td>
                    <td className="px-6 py-4 text-slate-600">{report.patient}</td>
                    <td className="px-6 py-4 text-slate-600">{report.type}</td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-2.5 py-1 rounded-full text-xs font-medium",
                        report.status === "Draft" && "bg-amber-100 text-amber-700",
                        report.status === "Finalized" && "bg-green-100 text-green-700",
                        report.status === "Archived" && "bg-slate-100 text-slate-700",
                      )}>
                        {report.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-600">{report.createdAt}</td>
                    <td className="px-6 py-4 text-slate-600">{report.reviewedBy || "—"}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button className="p-2 text-slate-500 hover:text-primary hover:bg-slate-100 rounded-lg transition-colors" title="Preview">
                          <Eye className="w-4 h-4" />
                        </button>
                        <button className="p-2 text-slate-500 hover:text-primary hover:bg-slate-100 rounded-lg transition-colors" title="Download PDF">
                          <Download className="w-4 h-4" />
                        </button>
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
            <p className="text-sm text-slate-500">Showing 4 of 28 reports</p>
            <div className="flex gap-2">
              <button className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-500 hover:bg-slate-50 transition-colors" disabled>Previous</button>
              <button className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-500 hover:bg-slate-50 transition-colors">Next</button>
            </div>
          </div>
        </div>

        {/* Report Template Preview */}
        <div className="mt-8">
          <h2 className="text-2xl font-display font-bold text-slate-900 mb-4">Report Template Preview</h2>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden">
            <div className="p-6 border-b border-slate-200 bg-slate-50">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-display font-bold text-slate-900">Skin Analysis Report Template</h3>
                  <p className="text-sm text-slate-500">Standard template for dermatological image analysis reports</p>
                </div>
                <span className="px-3 py-1 bg-amber-100 text-amber-700 text-xs font-medium rounded-full">DRAFT TEMPLATE</span>
              </div>
            </div>
            <div className="p-6 max-h-96 overflow-y-auto">
              <div className="prose prose-slate max-w-none">
                <div className="text-center mb-8 pb-6 border-b border-slate-200">
                  <h1 className="text-2xl font-bold text-slate-900 mb-2">MedScope AI — Clinical Report</h1>
                  <p className="text-slate-600">Skin Analysis Assessment</p>
                </div>
                
                <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
                  <div><span className="font-medium text-slate-500">Report ID:</span> <span className="font-mono">RPT-XXXXXX</span></div>
                  <div><span className="font-medium text-slate-500">Case ID:</span> <span className="font-mono">CS-XXXXXX</span></div>
                  <div><span className="font-medium text-slate-500">Patient:</span> [Patient Name]</div>
                  <div><span className="font-medium text-slate-500">Date:</span> [ISO Date]</div>
                  <div><span className="font-medium text-slate-500">Model:</span> [Model ID/Version]</div>
                  <div><span className="font-medium text-slate-500">Status:</span> <span className="text-amber-600 font-medium">DRAFT — NOT A CONFIRMED DIAGNOSIS</span></div>
                </div>

                <h4 className="font-bold text-slate-900 mb-2 border-t border-slate-200 pt-4">1. Image Information</h4>
                <p className="text-slate-600 text-sm mb-4">Uploaded image: [filename] • Dimensions: [WxH] • Preprocessing: [steps]</p>

                <h4 className="font-bold text-slate-900 mb-2">2. Model Output</h4>
                <div className="bg-slate-50 p-4 rounded-xl mb-4 text-sm">
                  <p><span className="font-medium">Primary Prediction:</span> [Disease Name]</p>
                  <p><span className="font-medium">Confidence:</span> [Score]% (uncalibrated model score)</p>
                  <p><span className="font-medium">Severity:</span> [Mild/Moderate/Severe/Normal]</p>
                  <p><span className="font-medium">Differential Diagnoses:</span> [List with scores]</p>
                </div>

                <h4 className="font-bold text-slate-900 mb-2">3. Clinical Context</h4>
                <p className="text-slate-600 text-sm mb-4">[User-provided symptoms, history, and observations]</p>

                <h4 className="font-bold text-slate-900 mb-2">4. Educational Information</h4>
                <p className="text-slate-600 text-sm mb-4">[Condition description and general guidance]</p>

                <h4 className="font-bold text-slate-900 mb-2">5. Limitations & Disclaimer</h4>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 text-sm">
                  <ul className="space-y-1 text-amber-800">
                    <li>• This report is generated by an AI research prototype for educational purposes only</li>
                    <li>• The underlying model has not been clinically validated for diagnostic use</li>
                    <li>• Image-based analysis cannot reliably rule out skin cancer or other serious conditions</li>
                    <li>• Confidence scores are uncalibrated model outputs, not clinical probabilities</li>
                    <li>• Always consult a qualified dermatologist for medical evaluation</li>
                  </ul>
                </div>

                <h4 className="font-bold text-slate-900 mb-2">6. Review Status</h4>
                <p className="text-slate-600 text-sm mb-4">Reviewer: [Name] • Date: [Date] • Decision: [Accepted/Modified/Rejected/Needs More Info]</p>
                <p className="text-slate-600 text-sm">Rationale: [Reviewer comments]</p>
              </div>
            </div>
            <div className="p-6 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
              <button className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
                Generate Draft Report
              </button>
            </div>
          </div>
        </div>

        {/* Coming Soon Notice */}
        <div className="mt-8 p-6 bg-slate-50 border border-slate-200 rounded-2xl text-center">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="font-display font-bold text-slate-900 mb-2">Module Under Development</h3>
          <p className="text-slate-600 max-w-2xl mx-auto">
            Report generation with template system, PDF export, review workflow integration,
            digital signatures, and audit trails is being implemented. The template structure
            and UI are ready; backend report generation and export functionality are in progress.
          </p>
        </div>
      </div>
    </Layout>
  );
}
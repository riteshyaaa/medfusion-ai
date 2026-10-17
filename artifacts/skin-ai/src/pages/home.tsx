import { Layout } from "@/components/layout";
import { Link } from "wouter";
import { Stethoscope, Activity, Users, FileText, History, ClipboardList, ArrowRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useListCases, useListPatients, useListReports, useListSymptomAssessments, useGetPredictionHistory } from "@workspace/api-client-react";

const features = [
  {
    icon: Stethoscope,
    title: "Skin Analysis",
    description: "Skin Analysis accepts private image uploads. An approved classification model is not configured yet, so no condition result is available.",
    href: "/skin-analysis",
    color: "bg-teal-500",
    iconBg: "bg-teal-500/10",
  },
  {
    icon: Activity,
    title: "Symptom Assessment",
    description: "Symptom intake with urgency guidance and AI condition exploration.",
    href: "/symptom-assessment",
    color: "bg-blue-500",
    iconBg: "bg-blue-500/10",
  },
  {
    icon: Users,
    title: "Patient Management",
    description: "Create and manage patient profiles with secure, access-controlled health information.",
    href: "/patients",
    color: "bg-indigo-500",
    iconBg: "bg-indigo-500/10",
  },
  {
    icon: FileText,
    title: "Case Management",
    description: "Track clinical cases with timelines, observations, associated media, and prediction records.",
    href: "/cases",
    color: "bg-purple-500",
    iconBg: "bg-purple-500/10",
  },
  {
    icon: History,
    title: "History & Records",
    description: "Review prediction records that were saved by an available inference provider.",
    href: "/history",
    color: "bg-orange-500",
    iconBg: "bg-orange-500/10",
  },
  {
    icon: ClipboardList,
    title: "Reports",
    description: "Generate draft reports from persisted records with model provenance and review status.",
    href: "/reports",
    color: "bg-rose-500",
    iconBg: "bg-rose-500/10",
  },
];

export default function Home() {
  const patients = useListPatients({ page: 1, limit: 1 });
  const cases = useListCases({ page: 1, limit: 1, status: "open" });
  const predictions = useGetPredictionHistory({ page: 1, limit: 1 });
  const assessments = useListSymptomAssessments({ page: 1, limit: 1 });
  const reports = useListReports({ page: 1, limit: 1, status: "draft" });
  const metrics = [
    { label: "Patient records", query: patients, count: patients.data?.total },
    { label: "Open cases", query: cases, count: cases.data?.total },
    { label: "Saved predictions", query: predictions, count: predictions.data?.total },
    { label: "Symptom assessments", query: assessments, count: assessments.data?.total },
    { label: "Draft reports", query: reports, count: reports.data?.total },
  ];
  const hasMetricError = metrics.some((metric) => metric.query.isError);

  return (
    <Layout>
      <div className="max-w-7xl mx-auto pt-10 pb-20 px-4 sm:px-6 lg:px-8">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-medium mb-6">
            Advanced AI Health Analysis
          </div>
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-display font-extrabold text-slate-900 mb-6 tracking-tight">
            MedScope<span className="text-primary"> AI</span>
          </h1>
          <p className="text-xl md:text-2xl text-slate-600 max-w-3xl mx-auto leading-relaxed mb-8">
            Analyze skin images, symptoms, and heart-health indicators with advanced AI models in one organized workspace
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/skin-analysis"
              className="inline-flex items-center gap-2 bg-primary text-white px-8 py-4 rounded-xl font-semibold text-lg hover:bg-primary/90 hover:-translate-y-0.5 transition-all shadow-lg shadow-primary/20"
            >
              Start Skin Analysis
              <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="/symptom-assessment"
              className="inline-flex items-center gap-2 bg-white text-slate-700 border-2 border-slate-200 px-8 py-4 rounded-xl font-semibold text-lg hover:border-primary hover:text-primary hover:bg-slate-50 transition-all shadow-sm"
            >
              Try Symptom Assessment
            </Link>
          </div>
        </div>

        <section className="mb-16" aria-labelledby="dashboard-metrics-title">
          <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
            <div><h2 id="dashboard-metrics-title" className="text-2xl font-display font-bold text-slate-900">Your workspace</h2><p className="text-sm text-slate-500 mt-1">Counts from records saved to your account.</p></div>
            {hasMetricError && <Button variant="outline" size="sm" onClick={() => void Promise.all(metrics.map((metric) => metric.query.refetch()))} className="gap-2"><RefreshCw className="h-4 w-4" />Retry metrics</Button>}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {metrics.map((metric) => <div key={metric.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">{metric.label}</p><p className="mt-2 text-3xl font-display font-bold text-slate-900" aria-live="polite">{metric.query.isLoading ? "…" : metric.query.isError ? "Unavailable" : metric.count ?? 0}</p></div>)}
          </div>
          {hasMetricError && <p role="status" className="mt-3 text-sm text-slate-500">Some counts could not be loaded. Retry without changing or losing saved records.</p>}
        </section>

        {/* Features Grid */}
        <div className="mb-16">
          <h2 className="text-3xl md:text-4xl font-display font-bold text-center text-slate-900 mb-4">
            Platform Capabilities
          </h2>
          <p className="text-center text-slate-600 max-w-2xl mx-auto mb-12">
            Available workflows use records saved to your account. Model-dependent features stay unavailable until a verified provider is configured.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature) => (
              <Link
                key={feature.title}
                href={feature.href}
                className={cn(
                  "group bg-white rounded-2xl p-6 shadow-sm border border-slate-200/60",
                  "hover:shadow-xl hover:border-primary/50 hover:-translate-y-1 transition-all duration-300",
                  "flex flex-col h-full"
                )}
              >
                <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center mb-4", feature.iconBg)}>
                  <feature.icon className={cn("w-6 h-6", feature.color.replace("bg-", "text-"))} />
                </div>
                <h3 className="font-display font-bold text-lg text-slate-900 mb-2">{feature.title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed flex-1 mb-4">{feature.description}</p>
                <div className="inline-flex items-center gap-1 text-sm font-medium text-primary group-hover:gap-2 transition-all">
                  <span>Explore</span>
                  <ArrowRight className="w-4 h-4" />
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Disclaimer */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 md:p-8">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                <Activity className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="font-display font-bold text-slate-900 mb-1">Note</h3>
                <p className="text-slate-600 text-sm">
                  MedScope AI assessments are generated from the image and details you provide. They are informational
                  outputs — for any medical concern, confirm with a qualified healthcare professional.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-500 shrink-0 mt-4 md:mt-0">
              <span className="px-3 py-1 bg-white border border-slate-200 rounded-full font-mono">v1.0.0</span>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

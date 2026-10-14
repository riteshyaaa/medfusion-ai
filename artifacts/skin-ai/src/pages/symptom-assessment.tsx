import { Layout } from "@/components/layout";
import { Link } from "wouter";
import { ArrowLeft, Brain, AlertTriangle, HeartPulse, Stethoscope } from "lucide-react";

const symptomCategories = [
  {
    id: "skin",
    title: "Skin Symptoms",
    description: "Rash, lesions, discoloration, itching, swelling",
    icon: HeartPulse,
    color: "bg-rose-500",
    iconBg: "bg-rose-500/10",
  },
  {
    id: "general",
    title: "General Symptoms",
    description: "Fever, fatigue, pain, weight changes, appetite",
    icon: Stethoscope,
    color: "bg-blue-500",
    iconBg: "bg-blue-500/10",
  },
  {
    id: "neurological",
    title: "Neurological",
    description: "Headache, dizziness, numbness, vision changes",
    icon: Brain,
    color: "bg-purple-500",
    iconBg: "bg-purple-500/10",
  },
  {
    id: "urgent",
    title: "Urgent Concerns",
    description: "Chest pain, breathing difficulty, severe bleeding",
    icon: AlertTriangle,
    color: "bg-red-500",
    iconBg: "bg-red-500/10",
  },
];

const redFlagSymptoms = [
  "Chest pain or pressure",
  "Difficulty breathing or shortness of breath",
  "Sudden severe headache",
  "Loss of consciousness or fainting",
  "Uncontrolled bleeding",
  "Signs of stroke (face drooping, arm weakness, speech difficulty)",
  "Severe allergic reaction (swelling, difficulty breathing)",
  "High fever with stiff neck",
  "Sudden vision loss",
  "Suicidal thoughts or self-harm ideation",
];

export default function SymptomAssessment() {
  return (
    <Layout>
      <div className="max-w-4xl mx-auto pt-10 pb-20">
        <div className="mb-8">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-slate-500 hover:text-primary font-medium mb-6 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Overview
          </Link>
        </div>

        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-6xl font-display font-extrabold text-slate-900 mb-6 tracking-tight">
            Symptom Assessment
          </h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
            Provide structured symptom information to receive conservative educational guidance
            and appropriate urgency recommendations. This is not a diagnostic tool.
          </p>
        </div>

        {/* Red Flag Warning */}
        <div className="mb-8 p-6 bg-red-50 border border-red-200 rounded-2xl">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <h3 className="font-bold text-red-800 mb-2">Seek Immediate Medical Attention If You Experience:</h3>
              <ul className="text-red-700 text-sm space-y-1 grid grid-cols-1 md:grid-cols-2 gap-2">
                {redFlagSymptoms.map((symptom, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-red-500">•</span>
                    <span>{symptom}</span>
                  </li>
                ))}
              </ul>
              <p className="text-red-700 text-sm mt-4 font-medium">
                Call emergency services (911 in US) or go to the nearest emergency department.
                Do not complete this assessment for life-threatening symptoms.
              </p>
            </div>
          </div>
        </div>

        {/* Assessment Categories */}
        <div className="mb-12">
          <h2 className="text-2xl font-display font-bold text-slate-900 mb-6 text-center">
            Select Symptom Category
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {symptomCategories.map((category) => (
              <Link
                key={category.id}
                href={`/symptom-assessment/${category.id}`}
                className="group bg-white rounded-2xl p-6 shadow-sm border border-slate-200/60 hover:shadow-xl hover:border-primary/50 hover:-translate-y-1 transition-all duration-300 flex flex-col h-full"
              >
                <div className={cn("w-14 h-14 rounded-xl flex items-center justify-center mb-4", category.iconBg)}>
                  <category.icon className={cn("w-7 h-7", category.color.replace("bg-", "text-"))} />
                </div>
                <h3 className="font-display font-bold text-lg text-slate-900 mb-2">{category.title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed flex-1 mb-4">{category.description}</p>
                <div className="inline-flex items-center gap-1 text-sm font-medium text-primary group-hover:gap-2 transition-all">
                  <span>Begin Assessment</span>
                  <ArrowLeft className="w-4 h-4" />
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* How it works */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 md:p-8">
          <h3 className="font-display font-bold text-slate-900 mb-4 text-center">How Symptom Assessment Works</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
            <div className="p-4">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <Stethoscope className="w-6 h-6 text-primary" />
              </div>
              <h4 className="font-bold text-slate-900 mb-2">Structured Intake</h4>
              <p className="text-slate-600 text-sm">Answer relevant questions about your symptoms, onset, duration, and severity.</p>
            </div>
            <div className="p-4">
              <div className="w-12 h-12 rounded-xl bg-teal-500/10 flex items-center justify-center mx-auto mb-3">
                <Brain className="w-6 h-6 text-teal-500" />
              </div>
              <h4 className="font-bold text-slate-900 mb-2">Rule-Based Guidance</h4>
              <p className="text-slate-600 text-sm">Receive conservative educational information based on established clinical guidelines.</p>
            </div>
            <div className="p-4">
              <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center mx-auto mb-3">
                <AlertTriangle className="w-6 h-6 text-amber-500" />
              </div>
              <h4 className="font-bold text-slate-900 mb-2">Urgency Recommendations</h4>
              <p className="text-slate-600 text-sm">Get appropriate next-step guidance including when to seek professional care.</p>
            </div>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="mt-8 p-6 bg-amber-50 border border-amber-200 rounded-2xl">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
              <svg className="w-5 h-5 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <h4 className="font-bold text-amber-800 mb-1">Educational Purpose Only</h4>
              <p className="text-amber-700 text-sm">
                This assessment provides general health information and does not constitute medical advice,
                diagnosis, or treatment. It cannot replace evaluation by a qualified healthcare professional.
                The system uses rule-based logic, not AI diagnosis. Always consult a clinician for medical concerns.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(" ");
}
import { Layout } from "@/components/layout";
import { Link } from "wouter";
import { ShieldAlert } from "lucide-react";

export default function NotFound() {
  return (
    <Layout>
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mb-8 text-slate-400">
          <ShieldAlert className="w-12 h-12" />
        </div>
        <h1 className="text-4xl md:text-5xl font-display font-bold text-slate-900 mb-4">
          404 - Page Not Found
        </h1>
        <p className="text-lg text-slate-500 max-w-md mx-auto mb-8">
          The requested clinical view could not be found. Please check the URL or return to the dashboard.
        </p>
        <Link 
          href="/"
          className="bg-primary text-white px-8 py-3 rounded-full font-semibold hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20"
        >
          Return to Dashboard
        </Link>
      </div>
    </Layout>
  );
}

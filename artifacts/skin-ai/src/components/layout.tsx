import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Activity, History, ShieldAlert, FileText, FileSearch, HeartPulse, Stethoscope, LogOut } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLogout } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const logout = useLogout({ mutation: {
    onSuccess: () => {
      queryClient.clear();
      setLocation("/login");
    },
    onError: () => toast({ title: "Sign out failed", description: "The server could not invalidate this session. Retry in a moment.", variant: "destructive" }),
  } });

  const navItems = [
    { href: "/", label: "Overview", icon: Activity },
    { href: "/skin-analysis", label: "Skin Analysis", icon: Stethoscope },
    { href: "/symptom-assessment", label: "Symptom Assessment", icon: Activity },
    { href: "/report-analysis", label: "Report Analysis", icon: FileSearch },
    { href: "/cardiac-assessment", label: "Cardiac", icon: HeartPulse },
    { href: "/patients", label: "Patients", icon: History },
    { href: "/cases", label: "Cases", icon: FileText },
    { href: "/history", label: "History", icon: History },
    { href: "/reports", label: "Reports", icon: FileText },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background relative overflow-hidden">
      {/* Background Decor */}
      <div className="fixed inset-0 z-0 pointer-events-none opacity-[0.03]">
        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-primary rounded-full blur-[120px] -translate-y-1/2 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-info rounded-full blur-[100px] translate-y-1/3 -translate-x-1/4" />
      </div>

      {/* Top Disclaimer Banner */}
      <div className="bg-primary/10 border-b border-primary/20 text-primary-foreground py-2 px-4 z-20">
        <div className="max-w-7xl mx-auto flex items-center justify-center gap-2 text-xs font-medium text-primary">
          <ShieldAlert className="w-4 h-4" />
          <span>
            For educational and research purposes only. Always consult a qualified
            healthcare professional for medical advice, diagnosis, or treatment.
          </span>
        </div>
      </div>

      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-border/50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-info flex items-center justify-center shadow-lg shadow-primary/20">
                <Stethoscope className="w-6 h-6 text-white" />
              </div>
              <span className="font-display font-bold text-2xl tracking-tight text-foreground">
                MedScope<span className="text-primary"> AI</span>
              </span>
            </div>

            <nav aria-label="Main navigation" className="flex gap-1 bg-slate-100/50 p-1 rounded-full border border-slate-200/50">
              {navItems.map((item) => {
                const isActive = location === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ease-out",
                      isActive
                        ? "bg-white text-primary shadow-sm ring-1 ring-black/5"
                        : "text-muted-foreground hover:text-foreground hover:bg-white/50",
                    )}
                  >
                    <item.icon
                      className={cn(
                        "w-4 h-4",
                        isActive ? "text-primary" : "opacity-70",
                      )}
                    />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <button type="button" onClick={() => logout.mutate()} disabled={logout.isPending} className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:border-primary hover:text-primary disabled:opacity-50" aria-label="Sign out">
              <LogOut className="w-4 h-4" />
              <span className="hidden lg:inline">{logout.isPending ? "Signing out…" : "Sign out"}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 z-10">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 bg-white/50 backdrop-blur-md py-8 z-10 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 opacity-50 grayscale">
            <Stethoscope className="w-5 h-5" />
            <span className="font-display font-bold text-lg">MedScope AI</span>
          </div>
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} MedScope AI. All rights reserved.
          </p>
          <p className="text-xs text-muted-foreground">Research prototype • not for independent diagnosis</p>
        </div>
      </footer>
    </div>
  );
}

import { useState, FormEvent } from "react";
import { useLocation } from "wouter";
import { Stethoscope, Lock, ShieldAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const DEMO_PASSWORD = "medscope123";

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);

    setTimeout(() => {
      if (password === DEMO_PASSWORD) {
        try {
          sessionStorage.setItem("medscope_authenticated", "true");
        } catch {
          // ignore storage errors
        }
        toast({
          title: "Welcome to MedScope AI",
          description: "Authentication successful. Redirecting to dashboard...",
        });
        setLocation("/");
      } else {
        toast({
          variant: "destructive",
          title: "Authentication failed",
          description: "The password you entered is incorrect.",
        });
        setIsSubmitting(false);
      }
    }, 600);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background relative overflow-hidden">
      {/* Background Decor */}
      <div className="fixed inset-0 z-0 pointer-events-none opacity-[0.04]">
        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-primary rounded-full blur-[120px] -translate-y-1/2 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-info rounded-full blur-[100px] translate-y-1/3 -translate-x-1/4" />
      </div>

      {/* Top Disclaimer Banner */}
      <div className="bg-primary/10 border-b border-primary/20 py-2 px-4 z-20">
        <div className="max-w-7xl mx-auto flex items-center justify-center gap-2 text-xs font-medium text-primary">
          <ShieldAlert className="w-4 h-4" />
          <span>
            For educational and research purposes only. Always consult a qualified
            healthcare professional for medical advice, diagnosis, or treatment.
          </span>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center p-4 relative z-10">
        <div className="w-full max-w-md">
          {/* Card */}
          <div className="bg-white/90 backdrop-blur-xl border border-border/60 rounded-2xl shadow-2xl shadow-primary/10 p-8 sm:p-10">
            {/* Logo & Title */}
            <div className="flex items-start gap-4 mb-8">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-info flex items-center justify-center shadow-lg shadow-primary/30 shrink-0">
                <Stethoscope className="w-7 h-7 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="font-display font-bold text-2xl sm:text-[1.6rem] leading-tight tracking-tight text-foreground">
                  MedScope<span className="text-primary"> AI</span>
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Intelligent Health Assessment Platform
                </p>
              </div>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-6">
              <input
                type="text"
                name="username"
                autoComplete="username"
                value="admin"
                readOnly
                hidden
              />
              <div className="space-y-2">
                <label
                  htmlFor="password"
                  className="text-xs font-semibold tracking-wider text-muted-foreground uppercase"
                >
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter dashboard password"
                    className="pl-10 h-12 bg-secondary/40 border-border/60 focus-visible:ring-primary text-base"
                    autoComplete="current-password"
                    disabled={isSubmitting}
                    data-testid="input-password"
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={isSubmitting || password.length === 0}
                className="w-full h-12 text-base font-semibold bg-gradient-to-r from-primary to-info hover:opacity-95 shadow-lg shadow-primary/25 transition-all"
                data-testid="button-login"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Authenticating...
                  </>
                ) : (
                  "Login"
                )}
              </Button>

              <p className="text-center text-xs text-muted-foreground">
                Demo password:{" "}
                <span className="font-mono font-semibold text-primary">
                  {DEMO_PASSWORD}
                </span>
              </p>
            </form>
          </div>

          {/* Footer */}
          <p className="text-center text-xs text-muted-foreground mt-6">
            MedScope AI — Research Prototype
          </p>
        </div>
      </div>
    </div>
  );
}
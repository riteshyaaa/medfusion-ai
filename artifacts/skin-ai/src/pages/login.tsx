import { FormEvent, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getGetCurrentUserQueryKey, login, register } from "@workspace/api-client-react";
import { Stethoscope, Lock, ShieldAlert, Loader2, Mail, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

function safeMessage(error: unknown): string {
  const message = (error as { data?: { message?: unknown } } | null)?.data?.message;
  return typeof message === "string" ? message : "The account could not be verified. Check your details and try again.";
}

export default function Login() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [formError, setFormError] = useState<string | null>(null);

  const auth = useMutation({
    mutationFn: () => mode === "register"
      ? register({ email, password, ...(fullName.trim() ? { fullName: fullName.trim() } : {}) })
      : login({ email, password }),
    onSuccess: async (result) => {
      queryClient.setQueryData(getGetCurrentUserQueryKey(), { user: result.user });
      await queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
      toast({ title: mode === "register" ? "Account created" : "Signed in", description: "Your session is active on this device." });
      setLocation("/");
    },
    onError: (error) => setFormError(safeMessage(error)),
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    auth.mutate();
  };

  return (
    <div className="min-h-screen flex flex-col bg-background relative overflow-hidden">
      <div className="fixed inset-0 z-0 pointer-events-none opacity-[0.04]">
        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-primary rounded-full blur-[120px] -translate-y-1/2 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-info rounded-full blur-[100px] translate-y-1/3 -translate-x-1/4" />
      </div>

      <div className="bg-primary/10 border-b border-primary/20 py-2 px-4 z-20">
        <div className="max-w-7xl mx-auto flex items-center justify-center gap-2 text-xs font-medium text-primary">
          <ShieldAlert className="w-4 h-4" />
          <span>See a qualified healthcare professional for medical care.</span>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-4 relative z-10">
        <div className="w-full max-w-md">
          <div className="bg-white/90 backdrop-blur-xl border border-border/60 rounded-2xl shadow-2xl shadow-primary/10 p-8 sm:p-10">
            <div className="flex items-start gap-4 mb-8">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-info flex items-center justify-center shadow-lg shadow-primary/30 shrink-0">
                <Stethoscope className="w-7 h-7 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="font-display font-bold text-2xl tracking-tight text-foreground">MedScope<span className="text-primary"> AI</span></h1>
                <p className="text-sm text-muted-foreground mt-1">Intelligent Health Assessment Platform</p>
              </div>
            </div>

            <h2 className="text-xl font-semibold mb-1">{mode === "register" ? "Create your account" : "Sign in"}</h2>
            <p className="text-sm text-muted-foreground mb-6">Accounts start with standard access. Privileged roles are not self-assigned.</p>
            <form onSubmit={handleSubmit} className="space-y-5">
              {mode === "register" && (
                <div className="space-y-2">
                  <label htmlFor="fullName" className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Name (optional)</label>
                  <div className="relative">
                    <UserRound className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <Input id="fullName" value={fullName} onChange={(event) => setFullName(event.target.value)} className="pl-10 h-12" autoComplete="name" maxLength={120} disabled={auth.isPending} />
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <label htmlFor="email" className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Email</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <Input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className="pl-10 h-12" autoComplete="email" required maxLength={254} disabled={auth.isPending} />
                </div>
              </div>
              <div className="space-y-2">
                <label htmlFor="password" className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Password</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <Input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "register" ? "At least 10 characters" : "Enter your password"} className="pl-10 h-12" autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={mode === "register" ? 10 : 1} maxLength={200} required disabled={auth.isPending} data-testid="input-password" />
                </div>
              </div>

              {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
              <Button type="submit" disabled={auth.isPending || !email || !password} className="w-full h-12 text-base font-semibold bg-gradient-to-r from-primary to-info hover:opacity-95 shadow-lg shadow-primary/25 transition-all" data-testid="button-login">
                {auth.isPending ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Working…</> : mode === "register" ? "Create account" : "Sign in"}
              </Button>
            </form>
            <p className="text-center text-sm text-muted-foreground mt-6">
              {mode === "register" ? "Already have an account? " : "New to MedScope AI? "}
              <button type="button" className="font-semibold text-primary hover:underline" onClick={() => { setFormError(null); setMode(mode === "register" ? "login" : "register"); }}>
                {mode === "register" ? "Sign in" : "Create an account"}
              </button>
            </p>
          </div>

          <p className="text-center text-xs text-muted-foreground mt-6">MedScope AI — Advanced Health Analysis</p>
        </div>
      </div>
    </div>
  );
}

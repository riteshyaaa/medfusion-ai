import { Switch, Route, Redirect, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useGetCurrentUser } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import Home from "@/pages/home";
import SkinAnalysis from "@/pages/skin-analysis";
import SymptomAssessment from "@/pages/symptom-assessment";
import ReportAnalysis from "@/pages/report-analysis";
import CardiacAssessment from "@/pages/cardiac-assessment";
import Patients from "@/pages/patients";
import Cases from "@/pages/cases";
import History from "@/pages/history";
import Reports from "@/pages/reports";
import Detail from "@/pages/detail";
import PatientDetail from "@/pages/patient-detail";
import CaseDetail from "@/pages/case-detail";
import Login from "@/pages/login";
import NotFound from "@/pages/not-found";
import { Button } from "@/components/ui/button";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function AuthenticatedRoutes() {
  const { isLoading, isError, error, refetch } = useGetCurrentUser({ query: { retry: false } });
  const status = (error as { status?: number } | null)?.status;

  if (isLoading) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground" role="status">Checking your session…</div>;
  }
  if (status === 401) return <Redirect to="/login" />;
  if (isError) {
    return (
      <main className="min-h-screen grid place-items-center p-6">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-semibold">MedScope AI is unavailable</h1>
          <p className="text-muted-foreground">The application could not reach its API. Check that the API server and database are running, then retry.</p>
          <Button onClick={() => void refetch()}>Retry connection</Button>
        </div>
      </main>
    );
  }

  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/skin-analysis" component={SkinAnalysis} />
      <Route path="/symptom-assessment" component={SymptomAssessment} />
      <Route path="/report-analysis" component={ReportAnalysis} />
      <Route path="/cardiac-assessment" component={CardiacAssessment} />
      <Route path="/patients" component={Patients} />
      <Route path="/patients/:id" component={PatientDetail} />
      <Route path="/cases" component={Cases} />
      <Route path="/cases/:id" component={CaseDetail} />
      <Route path="/history" component={History} />
      <Route path="/reports" component={Reports} />
      <Route path="/prediction/:id" component={Detail} />
      <Route component={NotFound} />
    </Switch>
  );
}

function Router() {
  const [location] = useLocation();
  if (location === "/login") return <Login />;
  return <AuthenticatedRoutes />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

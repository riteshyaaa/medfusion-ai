import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import Home from "@/pages/home";
import SkinAnalysis from "@/pages/skin-analysis";
import SymptomAssessment from "@/pages/symptom-assessment";
import Patients from "@/pages/patients";
import Cases from "@/pages/cases";
import History from "@/pages/history";
import Reports from "@/pages/reports";
import Detail from "@/pages/detail";
import Login from "@/pages/login";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/" component={Home} />
      <Route path="/skin-analysis" component={SkinAnalysis} />
      <Route path="/symptom-assessment" component={SymptomAssessment} />
      <Route path="/patients" component={Patients} />
      <Route path="/cases" component={Cases} />
      <Route path="/history" component={History} />
      <Route path="/reports" component={Reports} />
      <Route path="/prediction/:id" component={Detail} />
      <Route component={NotFound} />
    </Switch>
  );
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
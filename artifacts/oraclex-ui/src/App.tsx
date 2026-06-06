import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";
import Emails from "@/pages/Emails";
import RelayPool from "@/pages/RelayPool";
import Subscribers from "@/pages/Subscribers";
import Webhooks from "@/pages/Webhooks";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000 } },
});

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/emails" component={Emails} />
      <Route path="/relay-pool" component={RelayPool} />
      <Route path="/subscribers" component={Subscribers} />
      <Route path="/webhooks" component={Webhooks} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <AppRouter />
      </WouterRouter>
    </QueryClientProvider>
  );
}

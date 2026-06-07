import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LiveToastProvider } from "@/components/LiveToast";
import { AuthProvider, useAuth } from "@/lib/authContext";
import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";
import Emails from "@/pages/Emails";
import RelayPool from "@/pages/RelayPool";
import Subscribers from "@/pages/Subscribers";
import Webhooks from "@/pages/Webhooks";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import VerifyEmail from "@/pages/VerifyEmail";
import ApiKeys from "@/pages/ApiKeys";
import Docs from "@/pages/Docs";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 8_000 } },
});

function ProtectedRoute({ component: C }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <div className="min-h-screen bg-black" />;
  if (!user) return <Redirect to="/login" />;
  return <C />;
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      {/* Auth pages */}
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      <Route path="/verify" component={VerifyEmail} />
      {/* Dashboard pages — accessible without auth (test key still works) */}
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/emails" component={Emails} />
      <Route path="/relay-pool" component={RelayPool} />
      <Route path="/subscribers" component={Subscribers} />
      <Route path="/webhooks" component={Webhooks} />
      <Route path="/docs" component={Docs} />
      {/* Protected pages — require JWT login */}
      <Route path="/dashboard/api-keys">
        {() => <ProtectedRoute component={ApiKeys} />}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <AuthProvider>
          <LiveToastProvider>
            <AppRouter />
          </LiveToastProvider>
        </AuthProvider>
      </WouterRouter>
    </QueryClientProvider>
  );
}

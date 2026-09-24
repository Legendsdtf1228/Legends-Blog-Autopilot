import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';
import { ConsoleShell } from '@/components/console-ui';
import {
  ActivityPage,
  CalendarPage,
  DashboardPage,
  KnowledgePage,
  NotFoundPage,
  PipelineDetailPage,
  PipelinePage,
  QuestionsPage,
  ResearchPage,
  SettingsPage,
} from '@/pages/console-pages';

const queryClient = new QueryClient();

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <ConsoleShell>
        <Switch>
          <Route path="/" component={DashboardPage} />
          <Route path="/pipeline" component={PipelinePage} />
          <Route path="/pipeline/:id" component={PipelineDetailPage} />
          <Route path="/research" component={ResearchPage} />
          <Route path="/knowledge" component={KnowledgePage} />
          <Route path="/questions" component={QuestionsPage} />
          <Route path="/calendar" component={CalendarPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route path="/activity" component={ActivityPage} />
          <Route component={NotFoundPage} />
        </Switch>
      </ConsoleShell>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

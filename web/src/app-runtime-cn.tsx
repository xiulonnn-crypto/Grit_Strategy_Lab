import { startTransition, useEffect, useState } from 'react';
import { ApiClientProvider } from './lib/demoStoreContext';
import {
  AppRouteProvider,
  navigateTo,
  parseAppHash,
  type AppRoute,
} from './lib/appRouteContext';
import { BacktestSubmitPage } from './pages/backtest-submit-page-cn';
import { CompositionDashboardPage } from './pages/composition-dashboard-page';
import { CompositionDetailPage } from './pages/composition-detail-page';
import { CompositionWorkbenchPage } from './pages/composition-workbench-page';
import { CreationSessionPage } from './pages/creation-session-page';
import { CreationTemplatePage } from './pages/creation-template-page';
import { LegInventoryPage } from './pages/leg-inventory-page';
import {
  OptimizationConfigPage,
  OptimizationJobsIndexPage,
  OptimizationResultsPage,
  OptimizationStrategySelectPage,
} from './pages/optimization-lab-page';
import { RunDetailPage } from './pages/run-detail-page';
import { RunsIndexPage } from './pages/runs-index-page';
import { SnapshotsPage } from './pages/snapshots-page';
import { StrategyDetailPage } from './pages/strategy-detail-page';
import { WorkspacePage } from './pages/workspace-page-lane-b';
import { ShellFrameCn } from './shell-frame-cn';

function AppShell(): JSX.Element {
  /*
    [hash route]
      -> [route meta]
      -> [shell frame]
      -> [page-local view model]
      -> [real API page]
  */
  const [route, setRoute] = useState<AppRoute>(() => parseAppHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => {
      startTransition(() => {
        setRoute(parseAppHash(window.location.hash));
      });
    };

    window.addEventListener('hashchange', onHashChange);
    if (!window.location.hash) {
      navigateTo('/workspace');
    }

    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return (
    <AppRouteProvider navigate={navigateTo} route={route}>
      <ShellFrameCn route={route}>
        {route.kind === 'workspace' ? <WorkspacePage /> : null}
        {route.kind === 'composition-dashboard' ? <CompositionDashboardPage /> : null}
        {route.kind === 'leg-inventory' ? <LegInventoryPage /> : null}
        {route.kind === 'composition-workbench' ? <CompositionWorkbenchPage /> : null}
        {route.kind === 'composition-detail' ? (
          <CompositionDetailPage compositionId={route.compositionId} />
        ) : null}
        {route.kind === 'creation-template' ? <CreationTemplatePage /> : null}
        {route.kind === 'creation-session' ? <CreationSessionPage sessionId={route.sessionId} /> : null}
        {route.kind === 'strategy-detail' ? <StrategyDetailPage strategyId={route.strategyId} /> : null}
        {route.kind === 'backtest' ? (
          <BacktestSubmitPage strategyId={route.strategyId} sourceRunId={route.sourceRunId} />
        ) : null}
        {route.kind === 'runs-index' ? <RunsIndexPage /> : null}
        {route.kind === 'run' ? <RunDetailPage runId={route.runId} /> : null}
        {route.kind === 'snapshots' ? <SnapshotsPage /> : null}
        {route.kind === 'optimization-index' ? <OptimizationJobsIndexPage /> : null}
        {route.kind === 'optimization-select' ? (
          <OptimizationStrategySelectPage
            entryPoint={route.entryPoint}
            sourceRunId={route.sourceRunId}
            strategyId={route.strategyId}
          />
        ) : null}
        {route.kind === 'optimization-config' ? (
          <OptimizationConfigPage
            entryPoint={route.entryPoint}
            sourceRunId={route.sourceRunId}
            strategyId={route.strategyId}
          />
        ) : null}
        {route.kind === 'optimization' ? <OptimizationResultsPage jobId={route.jobId} /> : null}
      </ShellFrameCn>
    </AppRouteProvider>
  );
}

export default function AppRuntimeCn(): JSX.Element {
  return (
    <ApiClientProvider>
      <AppShell />
    </ApiClientProvider>
  );
}

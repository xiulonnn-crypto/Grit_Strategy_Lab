import { startTransition, useEffect, useState } from 'react';
import {
  AppRouteProvider,
  navigateTo,
  parseAppHash,
  type AppRoute,
} from './lib/appRouteContext';
import { ApiClientProvider } from './lib/demoStoreContext';
import { BacktestSubmitPage } from './pages/backtest-submit-page';
import { CreationSessionPage } from './pages/creation-session-page';
import { CreationTemplatePage } from './pages/creation-template-page';
import { ManualLabPage } from './pages/manual-lab-page';
import { RunDetailPage } from './pages/run-detail-page';
import { WorkspacePage } from './pages/workspace-page';

function AppShell(): JSX.Element {
  /*
    Routing Flow:
    [Workspace] --(New)--> [Template Select] --(Create)--> [Session:ID]
        |                                                       |
        |                                                       v
        +----------------------(Run Detail)<--(Submit)--[Backtest:New]
                                                                ^
                                                                |
                                                      (Materialize)
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

  const creationActive = route.kind === 'creation-template' || route.kind === 'creation-session';

  return (
    <AppRouteProvider navigate={navigateTo} route={route}>
      <div className="app-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Grit Strategy Lab</p>
            <h1>Baseline Restore</h1>
          </div>
          <nav className="topnav">
            <a className={route.kind === 'workspace' ? 'topnav-link-active' : undefined} href="#/workspace">
              Workspace
            </a>
            <a className={creationActive ? 'topnav-link-active' : undefined} href="#/creation/new">
              Creation
            </a>
          </nav>
        </header>

        <main className="page-shell">
          {route.kind === 'workspace' ? <WorkspacePage /> : null}
          {route.kind === 'creation-template' ? <CreationTemplatePage /> : null}
          {route.kind === 'creation-session' ? <CreationSessionPage sessionId={route.sessionId} /> : null}
          {route.kind === 'backtest' ? <BacktestSubmitPage strategyId={route.strategyId} /> : null}
          {route.kind === 'run' ? <RunDetailPage runId={route.runId} /> : null}
          {route.kind === 'optimization' ? <ManualLabPage jobId={route.jobId} /> : null}
        </main>
      </div>
    </AppRouteProvider>
  );
}

export default function AppRuntime(): JSX.Element {
  return (
    <ApiClientProvider>
      <AppShell />
    </ApiClientProvider>
  );
}

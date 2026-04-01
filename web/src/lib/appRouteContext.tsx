import { createContext, useContext, type ReactNode } from 'react';

export type AppRoute =
  | { kind: 'workspace' }
  | { kind: 'creation-template' }
  | { kind: 'creation-session'; sessionId: string }
  | { kind: 'strategy-detail'; strategyId: string }
  | { kind: 'backtest'; strategyId: string; sourceRunId?: string }
  | { kind: 'runs-index' }
  | { kind: 'run'; runId: string }
  | { kind: 'snapshots' }
  | { kind: 'optimization'; jobId: string };

type AppRouteContextValue = {
  route: AppRoute;
  navigate: (path: string) => void;
};

const AppRouteContext = createContext<AppRouteContextValue | null>(null);

export function parseAppHash(hash: string): AppRoute {
  const clean = hash.replace(/^#/, '') || '/workspace';
  const [path, queryString = ''] = clean.split('?');
  const searchParams = new URLSearchParams(queryString);
  if (path === '/' || path === '/workspace') {
    return { kind: 'workspace' };
  }
  if (path === '/creation/new') {
    return { kind: 'creation-template' };
  }
  const creationSessionMatch = path.match(/^\/creation\/sessions\/([^/]+)$/);
  if (creationSessionMatch) {
    return { kind: 'creation-session', sessionId: decodeURIComponent(creationSessionMatch[1]) };
  }
  const strategyDetailMatch = path.match(/^\/strategies\/([^/]+)$/);
  if (strategyDetailMatch) {
    return { kind: 'strategy-detail', strategyId: decodeURIComponent(strategyDetailMatch[1]) };
  }
  const backtestMatch = path.match(/^\/strategies\/([^/]+)\/backtest-runs\/new$/);
  if (backtestMatch) {
    const sourceRunId = searchParams.get('source_run_id');
    return {
      kind: 'backtest',
      strategyId: decodeURIComponent(backtestMatch[1]),
      sourceRunId: sourceRunId ? decodeURIComponent(sourceRunId) : undefined,
    };
  }
  if (path === '/runs') {
    return { kind: 'runs-index' };
  }
  const runMatch = path.match(/^\/runs\/([^/]+)$/);
  if (runMatch) {
    return { kind: 'run', runId: decodeURIComponent(runMatch[1]) };
  }
  if (path === '/snapshots') {
    return { kind: 'snapshots' };
  }
  const optimizationMatch = path.match(/^\/optimization-jobs\/([^/]+)$/);
  if (optimizationMatch) {
    return { kind: 'optimization', jobId: decodeURIComponent(optimizationMatch[1]) };
  }
  return { kind: 'workspace' };
}

export function navigateTo(path: string): void {
  window.location.hash = path;
}

export function AppRouteProvider({
  children,
  navigate,
  route,
}: {
  children: ReactNode;
  navigate: (path: string) => void;
  route: AppRoute;
}): JSX.Element {
  return <AppRouteContext.Provider value={{ route, navigate }}>{children}</AppRouteContext.Provider>;
}

export function useAppRoute(): AppRouteContextValue {
  const value = useContext(AppRouteContext);
  if (!value) {
    throw new Error('useAppRoute must be used inside AppRouteProvider.');
  }
  return value;
}

import { createContext, useContext, type ReactNode } from 'react';

export type AppRoute =
  | { kind: 'workspace' }
  | { kind: 'creation-template' }
  | { kind: 'creation-session'; sessionId: string }
  | { kind: 'backtest'; strategyId: string }
  | { kind: 'run'; runId: string }
  | { kind: 'optimization'; jobId: string };

type AppRouteContextValue = {
  route: AppRoute;
  navigate: (path: string) => void;
};

const AppRouteContext = createContext<AppRouteContextValue | null>(null);

export function parseAppHash(hash: string): AppRoute {
  const clean = hash.replace(/^#/, '') || '/workspace';
  if (clean === '/' || clean === '/workspace') {
    return { kind: 'workspace' };
  }
  if (clean === '/creation/new') {
    return { kind: 'creation-template' };
  }
  const creationSessionMatch = clean.match(/^\/creation\/sessions\/([^/]+)$/);
  if (creationSessionMatch) {
    return { kind: 'creation-session', sessionId: decodeURIComponent(creationSessionMatch[1]) };
  }
  const backtestMatch = clean.match(/^\/strategies\/([^/]+)\/backtest-runs\/new$/);
  if (backtestMatch) {
    return { kind: 'backtest', strategyId: decodeURIComponent(backtestMatch[1]) };
  }
  const runMatch = clean.match(/^\/runs\/([^/]+)$/);
  if (runMatch) {
    return { kind: 'run', runId: decodeURIComponent(runMatch[1]) };
  }
  const optimizationMatch = clean.match(/^\/optimization-jobs\/([^/]+)$/);
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

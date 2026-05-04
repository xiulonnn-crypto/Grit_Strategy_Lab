import { createContext, useContext, type ReactNode } from 'react';

export type AppRoute =
  | { kind: 'workspace' }
  | { kind: 'composition-dashboard' }
  | { kind: 'composition-list'; status?: string; decision?: string; evidenceGrade?: string }
  | { kind: 'composition-backtest-runs'; scenario?: string; evidenceGrade?: string }
  | { kind: 'composition-lab'; status?: string; compositionId?: string; method?: string; gate?: string }
  | { kind: 'leg-inventory' }
  | { kind: 'composition-workbench'; compositionId?: string; addLeg?: string }
  | { kind: 'composition-detail'; compositionId: string }
  | { kind: 'composition-backtest-new'; compositionId: string }
  | {
      kind: 'composition-backtest-result';
      compositionId: string;
      runId: string;
      tab?: 'diagnosis' | 'orders' | 'evidence';
      eventId?: string;
      orderId?: string;
    }
  | { kind: 'composition-allocation-config'; compositionId: string }
  | { kind: 'composition-allocation-result'; compositionId: string; jobId: string }
  | { kind: 'creation-template' }
  | { kind: 'asset-allocation-config'; sessionId?: string }
  | { kind: 'creation-session'; sessionId: string }
  | { kind: 'strategy-detail'; strategyId: string }
  | { kind: 'backtest'; strategyId: string; sourceRunId?: string; periodYears?: number }
  | { kind: 'runs-index' }
  | { kind: 'run'; runId: string }
  | { kind: 'snapshots'; tab?: 'equity' | 'bond'; target?: string }
  | { kind: 'pit-data'; section?: string }
  | { kind: 'factor-library'; source?: string; tag?: string; status?: string }
  | { kind: 'factor-detail'; factorId: string }
  | { kind: 'factor-editor'; factorId?: string }
  | { kind: 'factor-sandbox' }
  | { kind: 'factor-quarantine' }
  | { kind: 'optimization-index' }
  | { kind: 'optimization-select'; strategyId?: string; sourceRunId?: string; entryPoint?: string }
  | { kind: 'optimization-config'; strategyId: string; sourceRunId?: string; entryPoint?: string }
  | { kind: 'optimization'; jobId: string };

type AppRouteContextValue = {
  route: AppRoute;
  navigate: (path: string) => void;
};

const AppRouteContext = createContext<AppRouteContextValue | null>(null);

function parseBacktestPeriodYears(value: string | null): number | undefined {
  const parsed = Number(value);
  return [10, 20, 30].includes(parsed) ? parsed : undefined;
}

function parseCompositionBacktestTab(value: string | null): 'diagnosis' | 'orders' | 'evidence' | undefined {
  return value === 'diagnosis' || value === 'orders' || value === 'evidence' ? value : undefined;
}

export function parseAppHash(hash: string): AppRoute {
  const clean = hash.replace(/^#/, '') || '/workspace';
  const [path, queryString = ''] = clean.split('?');
  const searchParams = new URLSearchParams(queryString);
  if (path === '/' || path === '/workspace') {
    return { kind: 'workspace' };
  }
  if (path === '/compositions') {
    return { kind: 'composition-dashboard' };
  }
  if (path === '/compositions/list') {
    const status = searchParams.get('status');
    const decision = searchParams.get('decision');
    const evidenceGrade = searchParams.get('grade') ?? searchParams.get('evidence_grade');
    return {
      kind: 'composition-list',
      status: status ? decodeURIComponent(status) : undefined,
      decision: decision ? decodeURIComponent(decision) : undefined,
      evidenceGrade: evidenceGrade ? decodeURIComponent(evidenceGrade) : undefined,
    };
  }
  if (path === '/compositions/backtest-runs') {
    const scenario = searchParams.get('scenario');
    const evidenceGrade = searchParams.get('grade') ?? searchParams.get('evidence_grade');
    return {
      kind: 'composition-backtest-runs',
      scenario: scenario ? decodeURIComponent(scenario) : undefined,
      evidenceGrade: evidenceGrade ? decodeURIComponent(evidenceGrade) : undefined,
    };
  }
  if (path === '/compositions/lab') {
    const status = searchParams.get('status');
    const compositionId = searchParams.get('composition_id');
    const method = searchParams.get('method');
    const gate = searchParams.get('gate');
    return {
      kind: 'composition-lab',
      status: status ? decodeURIComponent(status) : undefined,
      compositionId: compositionId ? decodeURIComponent(compositionId) : undefined,
      method: method ? decodeURIComponent(method) : undefined,
      gate: gate ? decodeURIComponent(gate) : undefined,
    };
  }
  if (path === '/legs') {
    return { kind: 'leg-inventory' };
  }
  if (path === '/compositions/workbench') {
    const compositionId = searchParams.get('composition_id');
    const addLeg = searchParams.get('add_leg');
    return {
      kind: 'composition-workbench',
      compositionId: compositionId ? decodeURIComponent(compositionId) : undefined,
      addLeg: addLeg ? decodeURIComponent(addLeg) : undefined,
    };
  }
  if (path === '/compositions/detail') {
    return { kind: 'composition-dashboard' };
  }
  const compositionBacktestNewMatch = path.match(/^\/compositions\/([^/]+)\/backtest-runs\/new$/);
  if (compositionBacktestNewMatch) {
    return {
      kind: 'composition-backtest-new',
      compositionId: decodeURIComponent(compositionBacktestNewMatch[1]),
    };
  }
  const compositionBacktestResultMatch = path.match(/^\/compositions\/([^/]+)\/backtest-runs\/([^/]+)$/);
  if (compositionBacktestResultMatch) {
    const eventId = searchParams.get('event_id');
    const orderId = searchParams.get('order_id');
    return {
      kind: 'composition-backtest-result',
      compositionId: decodeURIComponent(compositionBacktestResultMatch[1]),
      runId: decodeURIComponent(compositionBacktestResultMatch[2]),
      tab: parseCompositionBacktestTab(searchParams.get('tab')),
      eventId: eventId ? decodeURIComponent(eventId) : undefined,
      orderId: orderId ? decodeURIComponent(orderId) : undefined,
    };
  }
  const compositionAllocationConfigMatch = path.match(/^\/compositions\/([^/]+)\/allocation-lab$/);
  if (compositionAllocationConfigMatch) {
    return {
      kind: 'composition-allocation-config',
      compositionId: decodeURIComponent(compositionAllocationConfigMatch[1]),
    };
  }
  const compositionAllocationResultMatch = path.match(/^\/compositions\/([^/]+)\/allocation-jobs\/([^/]+)$/);
  if (compositionAllocationResultMatch) {
    return {
      kind: 'composition-allocation-result',
      compositionId: decodeURIComponent(compositionAllocationResultMatch[1]),
      jobId: decodeURIComponent(compositionAllocationResultMatch[2]),
    };
  }
  const compositionDetailMatch = path.match(/^\/compositions\/([^/]+)$/);
  if (compositionDetailMatch) {
    return { kind: 'composition-detail', compositionId: decodeURIComponent(compositionDetailMatch[1]) };
  }
  if (path === '/strategies' || path === '/creation/new') {
    return { kind: 'creation-template' };
  }
  if (path === '/creation/asset-allocation/new') {
    const sessionId = searchParams.get('session_id');
    return {
      kind: 'asset-allocation-config',
      sessionId: sessionId ? decodeURIComponent(sessionId) : undefined,
    };
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
    const periodYears = parseBacktestPeriodYears(searchParams.get('period_years'));
    return {
      kind: 'backtest',
      strategyId: decodeURIComponent(backtestMatch[1]),
      sourceRunId: sourceRunId ? decodeURIComponent(sourceRunId) : undefined,
      periodYears,
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
    const tab = searchParams.get('tab');
    const target = searchParams.get('target');
    return {
      kind: 'snapshots',
      tab: tab === 'bond' ? 'bond' : 'equity',
      target: target ? decodeURIComponent(target) : undefined,
    };
  }
  if (path === '/pit-data') {
    const section = searchParams.get('section');
    return { kind: 'pit-data', section: section ? decodeURIComponent(section) : undefined };
  }
  if (path === '/factors') {
    return {
      kind: 'factor-library',
      source: searchParams.get('source') ? decodeURIComponent(searchParams.get('source') ?? '') : undefined,
      tag: searchParams.get('tag') ? decodeURIComponent(searchParams.get('tag') ?? '') : undefined,
      status: searchParams.get('status') ? decodeURIComponent(searchParams.get('status') ?? '') : undefined,
    };
  }
  if (path === '/factors/new') {
    return { kind: 'factor-editor' };
  }
  if (path === '/factors/sandbox') {
    return { kind: 'factor-sandbox' };
  }
  if (path === '/factors/quarantine') {
    return { kind: 'factor-quarantine' };
  }
  const factorDetailMatch = path.match(/^\/factors\/([^/]+)$/);
  if (factorDetailMatch) {
    return { kind: 'factor-detail', factorId: decodeURIComponent(factorDetailMatch[1]) };
  }
  if (path === '/optimization-jobs') {
    return { kind: 'optimization-index' };
  }
  if (path === '/optimization-jobs/new') {
    const strategyId = searchParams.get('strategy_id');
    const sourceRunId = searchParams.get('source_run_id');
    const entryPoint = searchParams.get('entry_point');
    return {
      kind: 'optimization-select',
      strategyId: strategyId ? decodeURIComponent(strategyId) : undefined,
      sourceRunId: sourceRunId ? decodeURIComponent(sourceRunId) : undefined,
      entryPoint: entryPoint ? decodeURIComponent(entryPoint) : undefined,
    };
  }
  if (path === '/optimization-jobs/new/config') {
    const strategyId = searchParams.get('strategy_id');
    if (!strategyId) {
      return { kind: 'optimization-select' };
    }
    const sourceRunId = searchParams.get('source_run_id');
    const entryPoint = searchParams.get('entry_point');
    return {
      kind: 'optimization-config',
      strategyId: decodeURIComponent(strategyId),
      sourceRunId: sourceRunId ? decodeURIComponent(sourceRunId) : undefined,
      entryPoint: entryPoint ? decodeURIComponent(entryPoint) : undefined,
    };
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

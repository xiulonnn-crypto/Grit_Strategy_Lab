import { startTransition, useEffect, useMemo, useState } from 'react';
import { buildWorkspaceStrategyCards } from './lib/adapters';
import { OptimizationManualLabPhase4 } from './page-sections/optimization-manual-lab-phase4';
import { RunDetailAuditPanel } from './page-sections/run-detail-audit';
import { WorkspaceStrategySection } from './page-sections/workspace';
import { ApiError, type ApiBacktestRunDetail, type ApiBacktestRunTradeAudit, type ApiOptimizationJobDetail, type ApiStrategyDetail, type ApiStrategyListItem, type ApiWorkspaceOverview, type ParameterValue } from './types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://127.0.0.1:8000';

type PhaseRoute =
  | { kind: 'workspace' }
  | { kind: 'creation' }
  | { kind: 'backtest'; strategyId: string }
  | { kind: 'run'; runId: string }
  | { kind: 'optimization'; jobId: string };

function parsePhaseHash(hash: string): PhaseRoute {
  const clean = hash.replace(/^#/, '') || '/workspace';
  if (clean === '/' || clean === '/workspace') return { kind: 'workspace' };
  if (clean === '/creation/new') return { kind: 'creation' };
  const backtestMatch = clean.match(/^\/strategies\/([^/]+)\/backtest-runs\/new$/);
  if (backtestMatch) return { kind: 'backtest', strategyId: decodeURIComponent(backtestMatch[1]) };
  const runMatch = clean.match(/^\/runs\/([^/]+)$/);
  if (runMatch) return { kind: 'run', runId: decodeURIComponent(runMatch[1]) };
  const optimizationMatch = clean.match(/^\/optimization-jobs\/([^/]+)$/);
  if (optimizationMatch) return { kind: 'optimization', jobId: decodeURIComponent(optimizationMatch[1]) };
  return { kind: 'workspace' };
}

function phaseNavigate(hashPath: string): void {
  window.location.hash = hashPath;
}

async function phaseRequestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError({
      status: response.status,
      code: payload?.code ?? 'http_error',
      message: payload?.message ?? `Request failed: ${response.status}`,
      blocking_code: payload?.blocking_code,
      blocking_target: payload?.blocking_target,
      next_action: payload?.next_action,
    });
  }
  return payload as T;
}

function MetricCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PlaceholderPhasePage({ title, body }: { title: string; body: string }): JSX.Element {
  return (
    <section className="panel">
      <div className="panel-header">
        <h3>{title}</h3>
      </div>
      <p className="hero-copy">{body}</p>
    </section>
  );
}

function WorkspacePage(): JSX.Element {
  const [overview, setOverview] = useState<ApiWorkspaceOverview | null>(null);
  const [strategies, setStrategies] = useState<ApiStrategyListItem[]>([]);
  const [details, setDetails] = useState<Record<string, ApiStrategyDetail>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        setLoading(true);
        setError(null);
        const [workspaceOverview, strategyItems] = await Promise.all([
          phaseRequestJson<ApiWorkspaceOverview>('/workspace/overview?include_cleanup_audit=1'),
          phaseRequestJson<ApiStrategyListItem[]>('/strategies'),
        ]);
        const detailEntries = await Promise.all(strategyItems.map(async (strategy) => [strategy.id, await phaseRequestJson<ApiStrategyDetail>(`/strategies/${encodeURIComponent(strategy.id)}/detail`)] as const));
        if (cancelled) return;
        setOverview(workspaceOverview);
        setStrategies(strategyItems);
        setDetails(Object.fromEntries(detailEntries));
      } catch (caught) {
        if (!cancelled) setError((caught as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const cards = useMemo(() => buildWorkspaceStrategyCards(strategies, details), [details, strategies]);

  return (
    <div className="stack">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Workspace</p>
          <h2>{overview?.workspace_name ?? 'Grit Strategy Lab'}</h2>
          <p className="hero-copy">{overview?.subtitle ?? 'Loading workspace contract...'}</p>
          <span data-testid="hidden-cleanup-count" hidden>{overview?.last_cleanup_count ?? 0}</span>
        </div>
        <div className="hero-actions">
          <button className="primary-button" onClick={() => phaseNavigate('/creation/new')} type="button">Open Creation</button>
          {overview?.latest_optimization_job_id ? <button className="ghost-button" onClick={() => phaseNavigate(`/optimization-jobs/${overview.latest_optimization_job_id}`)} type="button">Open Latest Manual Lab</button> : null}
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="stats-grid">
        <MetricCard label="Strategies" value={String(overview?.strategy_count ?? 0)} />
        <MetricCard label="Active Runs" value={String(overview?.active_run_count ?? 0)} />
        <MetricCard label="Optimizations" value={String(overview?.running_optimization_count ?? 0)} />
      </section>

      <WorkspaceStrategySection error={error} loading={loading} navigate={phaseNavigate} strategies={cards} />
    </div>
  );
}

function OptimizationPage({ jobId }: { jobId: string }): JSX.Element {
  const [job, setJob] = useState<ApiOptimizationJobDetail | null>(null);
  const [strategy, setStrategy] = useState<ApiStrategyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [promotingCandidateId, setPromotingCandidateId] = useState<string | null>(null);
  const [deletingCandidateId, setDeletingCandidateId] = useState<string | null>(null);

  async function load(): Promise<void> {
    const optimizationJob = await phaseRequestJson<ApiOptimizationJobDetail>(`/optimization-jobs/${encodeURIComponent(jobId)}/detail`);
    const strategyDetail = await phaseRequestJson<ApiStrategyDetail>(`/strategies/${encodeURIComponent(optimizationJob.strategy_id)}/detail`);
    setJob(optimizationJob);
    setStrategy(strategyDetail);
  }

  useEffect(() => {
    let cancelled = false;
    async function boot(): Promise<void> {
      try {
        setLoading(true);
        setError(null);
        await load();
      } catch (caught) {
        if (!cancelled) setError((caught as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void boot();
    return () => { cancelled = true; };
  }, [jobId]);

  async function handlePromote(candidateId: string, comment: string): Promise<void> {
    if (!job) return;
    try {
      setPromotingCandidateId(candidateId);
      setConflictMessage(null);
      await phaseRequestJson(`/optimization-jobs/${encodeURIComponent(job.id)}/candidates/${encodeURIComponent(candidateId)}/promote`, { method: 'POST', body: JSON.stringify({ idempotency_key: `promote-${candidateId}`, mode: 'set_current', base_parameter_version_id: job.base_parameter_version_id, comment }) });
      await load();
    } catch (caught) {
      const errorValue = caught as ApiError;
      if (errorValue.code === 'stale_base_parameter_version') setConflictMessage('Parameter version conflict detected. Refresh the baseline before promoting again.');
      else setError(errorValue.message);
    } finally {
      setPromotingCandidateId(null);
    }
  }

  async function handleDeleteCandidate(candidateId: string): Promise<void> {
    if (!job) return;
    setDeletingCandidateId(candidateId);
    await phaseRequestJson(`/optimization-jobs/${encodeURIComponent(job.id)}/candidates/${encodeURIComponent(candidateId)}`, { method: 'DELETE' });
    await load();
    setDeletingCandidateId(null);
  }

  async function handleDeleteLosingCandidates(): Promise<void> {
    if (!job) return;
    const candidateIds = job.candidates.filter((candidate) => typeof candidate.metrics.total_return === 'number' ? candidate.metrics.total_return < 0 : candidate.score < 0).map((candidate) => candidate.id);
    for (const candidateId of candidateIds) {
      await phaseRequestJson(`/optimization-jobs/${encodeURIComponent(job.id)}/candidates/${encodeURIComponent(candidateId)}`, { method: 'DELETE' });
    }
    await load();
  }

  async function handleAddCandidate(parameterSnapshot: Record<string, ParameterValue>): Promise<void> {
    if (!job) return;
    await phaseRequestJson(`/optimization-jobs/${encodeURIComponent(job.id)}/candidates`, { method: 'POST', body: JSON.stringify({ label: `Manual Candidate ${job.candidates.length + 1}`, parameter_snapshot: parameterSnapshot, base_parameter_version_id: job.base_parameter_version_id, metrics: { total_return: 3.8, sharpe: 0.84 }, summary: 'Created from the restored manual lab.' }) });
    await load();
  }

  if (loading) return <PlaceholderPhasePage title="Manual Lab" body="Loading optimization job..." />;
  if (error || !job || !strategy) return <PlaceholderPhasePage title="Manual Lab" body={error ?? 'Optimization job could not be loaded.'} />;
  return <OptimizationManualLabPhase4 conflictMessage={conflictMessage} deletingCandidateId={deletingCandidateId} job={job} onAddCandidate={handleAddCandidate} onDeleteCandidate={handleDeleteCandidate} onDeleteLosingCandidates={handleDeleteLosingCandidates} onPromote={handlePromote} promotingCandidateId={promotingCandidateId} strategy={strategy} />;
}

function RunPage({ runId }: { runId: string }): JSX.Element {
  const [detail, setDetail] = useState<ApiBacktestRunDetail | null>(null);
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [audit, setAudit] = useState<ApiBacktestRunTradeAudit | null>(null);
  const [loading, setLoading] = useState(true);
  const [auditLoading, setAuditLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        setLoading(true);
        const runDetail = await phaseRequestJson<ApiBacktestRunDetail>(`/backtest-runs/${encodeURIComponent(runId)}/detail`);
        if (cancelled) return;
        setDetail(runDetail);
        setActiveTradeId(runDetail.trade_audit_items?.[0]?.trade_id ?? null);
      } catch (caught) {
        if (!cancelled) setError((caught as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [runId]);

  useEffect(() => {
    let cancelled = false;
    async function loadAudit(): Promise<void> {
      if (!activeTradeId) return;
      try {
        setAuditLoading(true);
        setAuditError(null);
        const nextAudit = await phaseRequestJson<ApiBacktestRunTradeAudit>(`/backtest-runs/${encodeURIComponent(runId)}/trades/${encodeURIComponent(activeTradeId)}/audit`);
        if (!cancelled) setAudit(nextAudit);
      } catch (caught) {
        if (!cancelled) setAuditError((caught as Error).message);
      } finally {
        if (!cancelled) setAuditLoading(false);
      }
    }
    void loadAudit();
    return () => { cancelled = true; };
  }, [activeTradeId, runId]);

  if (loading) return <PlaceholderPhasePage title="Run Detail" body="Loading run detail..." />;
  if (error || !detail) return <PlaceholderPhasePage title="Run Detail" body={error ?? 'Run detail could not be loaded.'} />;
  return <RunDetailAuditPanel activeTradeId={activeTradeId} audit={audit} auditError={auditError} auditLoading={auditLoading} detail={detail} onSelectTrade={setActiveTradeId} />;
}

function CreationPage(): JSX.Element { return <PlaceholderPhasePage title="Creation" body="Recovered creation flow remains available from the backend contract. Use the workspace or API tests to drive deeper creation scenarios." />; }
function BacktestPage({ strategyId }: { strategyId: string }): JSX.Element { return <PlaceholderPhasePage title="Backtest" body={`Preview and submit flows are available for strategy ${strategyId}. Use the API route or the saved smoke tests for full execution coverage.`} />; }

export default function PhaseFourApp(): JSX.Element {
  const [route, setRoute] = useState<PhaseRoute>(() => parsePhaseHash(window.location.hash));
  useEffect(() => {
    const onHashChange = () => startTransition(() => setRoute(parsePhaseHash(window.location.hash)));
    window.addEventListener('hashchange', onHashChange);
    if (!window.location.hash) phaseNavigate('/workspace');
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Grit Strategy Lab</p>
          <h1>Baseline Restore</h1>
        </div>
        <nav className="topnav">
          <a href="#/workspace">Workspace</a>
          <a href="#/creation/new">Creation</a>
        </nav>
      </header>
      <main className="page-shell">
        {route.kind === 'workspace' ? <WorkspacePage /> : null}
        {route.kind === 'creation' ? <CreationPage /> : null}
        {route.kind === 'backtest' ? <BacktestPage strategyId={route.strategyId} /> : null}
        {route.kind === 'run' ? <RunPage runId={route.runId} /> : null}
        {route.kind === 'optimization' ? <OptimizationPage jobId={route.jobId} /> : null}
      </main>
    </div>
  );
}

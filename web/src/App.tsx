import { startTransition, useEffect, useMemo, useState } from 'react';
import { buildWorkspaceStrategyCards } from './lib/adapters';
import { OptimizationManualLab } from './page-sections/optimization-manual-lab';
import { WorkspaceStrategySection } from './page-sections/workspace';
import { ApiError, type ApiOptimizationJobDetail, type ApiStrategyDetail, type ApiStrategyListItem, type ApiWorkspaceOverview, type ParameterValue } from './types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://127.0.0.1:8000';

type PhaseRoute =
  | { kind: 'workspace' }
  | { kind: 'creation' }
  | { kind: 'backtest'; strategyId: string }
  | { kind: 'run'; runId: string }
  | { kind: 'optimization'; jobId: string };

function parsePhaseHash(hash: string): PhaseRoute {
  const clean = hash.replace(/^#/, '') || '/workspace';
  if (clean === '/' || clean === '/workspace') {
    return { kind: 'workspace' };
  }
  if (clean === '/creation/new') {
    return { kind: 'creation' };
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

function phaseNavigate(hashPath: string): void {
  window.location.hash = hashPath;
}

async function phaseRequestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
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

function PhaseWorkspacePage(): JSX.Element {
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
          phaseRequestJson<ApiWorkspaceOverview>('/workspace/overview'),
          phaseRequestJson<ApiStrategyListItem[]>('/strategies'),
        ]);
        const detailEntries = await Promise.all(
          strategyItems.map(async (strategy) => [
            strategy.id,
            await phaseRequestJson<ApiStrategyDetail>(`/strategies/${encodeURIComponent(strategy.id)}/detail`),
          ] as const),
        );
        if (cancelled) {
          return;
        }
        setOverview(workspaceOverview);
        setStrategies(strategyItems);
        setDetails(Object.fromEntries(detailEntries));
      } catch (caught) {
        if (!cancelled) {
          setError((caught as Error).message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const cards = useMemo(() => buildWorkspaceStrategyCards(strategies, details), [details, strategies]);

  return (
    <div className="stack">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Workspace</p>
          <h2>{overview?.workspace_name ?? 'Grit Strategy Lab'}</h2>
          <p className="hero-copy">{overview?.subtitle ?? 'Loading workspace contract...'}</p>
        </div>
        <div className="hero-actions">
          <button className="primary-button" onClick={() => phaseNavigate('/creation/new')} type="button">
            Open Creation
          </button>
          {overview?.latest_optimization_job_id ? (
            <button className="ghost-button" onClick={() => phaseNavigate(`/optimization-jobs/${overview.latest_optimization_job_id}`)} type="button">
              Open Latest Manual Lab
            </button>
          ) : null}
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

function PhaseOptimizationPage({ jobId }: { jobId: string }): JSX.Element {
  const [job, setJob] = useState<ApiOptimizationJobDetail | null>(null);
  const [strategy, setStrategy] = useState<ApiStrategyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [promotingCandidateId, setPromotingCandidateId] = useState<string | null>(null);

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
        if (!cancelled) {
          setError((caught as Error).message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  async function handlePromote(candidateId: string): Promise<void> {
    if (!job) {
      return;
    }
    try {
      setPromotingCandidateId(candidateId);
      setConflictMessage(null);
      await phaseRequestJson(`/optimization-jobs/${encodeURIComponent(job.id)}/candidates/${encodeURIComponent(candidateId)}/promote`, {
        method: 'POST',
        body: JSON.stringify({
          idempotency_key: `promote-${candidateId}`,
          mode: 'set_current',
          base_parameter_version_id: job.base_parameter_version_id,
        }),
      });
      await load();
    } catch (caught) {
      const errorValue = caught as ApiError;
      if (errorValue.code === 'stale_base_parameter_version') {
        setConflictMessage('Parameter version conflict detected. Refresh the baseline before promoting again.');
      } else {
        setError(errorValue.message);
      }
    } finally {
      setPromotingCandidateId(null);
    }
  }

  async function handleAddCandidate(parameterSnapshot: Record<string, ParameterValue>): Promise<void> {
    if (!job) {
      return;
    }
    await phaseRequestJson(`/optimization-jobs/${encodeURIComponent(job.id)}/candidates`, {
      method: 'POST',
      body: JSON.stringify({
        label: `Manual Candidate ${job.candidates.length + 1}`,
        parameter_snapshot: parameterSnapshot,
        base_parameter_version_id: job.base_parameter_version_id,
        metrics: {},
        summary: 'Created from the restored manual lab.',
      }),
    });
    await load();
  }

  if (loading) {
    return <PlaceholderPhasePage title="Manual Lab" body="Loading optimization job..." />;
  }
  if (error || !job || !strategy) {
    return <PlaceholderPhasePage title="Manual Lab" body={error ?? 'Optimization job could not be loaded.'} />;
  }
  return (
    <OptimizationManualLab
      conflictMessage={conflictMessage}
      job={job}
      onAddCandidate={handleAddCandidate}
      onPromote={handlePromote}
      promotingCandidateId={promotingCandidateId}
      strategy={strategy}
    />
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

function PhaseThreeApp(): JSX.Element {
  const [route, setRoute] = useState<PhaseRoute>(() => parsePhaseHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => {
      startTransition(() => {
        setRoute(parsePhaseHash(window.location.hash));
      });
    };
    window.addEventListener('hashchange', onHashChange);
    if (!window.location.hash) {
      phaseNavigate('/workspace');
    }
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
        {route.kind === 'workspace' ? <PhaseWorkspacePage /> : null}
        {route.kind === 'creation' ? <CreationPage /> : null}
        {route.kind === 'backtest' ? <BacktestPage strategyId={route.strategyId} /> : null}
        {route.kind === 'run' ? <RunDetailPage runId={route.runId} /> : null}
        {route.kind === 'optimization' ? <PhaseOptimizationPage jobId={route.jobId} /> : null}
      </main>
    </div>
  );
}

type Route =
  | { kind: 'workspace' }
  | { kind: 'creation' }
  | { kind: 'backtest'; strategyId: string }
  | { kind: 'run'; runId: string };

type SessionPayload = {
  id: string;
  status: string;
  top_level: {
    strategy_type: string;
    universe_name: string;
    rebalance_frequency: string | null;
  };
  confirmation_fields: {
    top_level: Array<{ key: string; label: string; value: unknown; source: string }>;
    parameters: Array<{ key: string; label: string; value: unknown; source: string }>;
  };
  pending_inputs: Array<{ key: string; label: string; message: string }>;
};

type StrategyPayload = {
  id: string;
  name: string;
  strategy_type: string;
  universe_name: string;
  latest_run_id?: string | null;
  parameters: Record<string, unknown>;
};

type RunPayload = {
  id: string;
  status: string;
  metrics: Record<string, number>;
  chart_series: Array<{ trade_date: string; equity: number; benchmark: number; drawdown: number; is_oos: boolean }>;
  monthly_returns: Array<{ month: string; return_pct: number | null; segment: string }>;
  trades: Array<{ trade_date: string; symbol: string; action: string; price: number; segment: string }>;
  preview?: { warnings?: string[] };
};

type WorkspacePayload = {
  strategy_count: number;
  completed_run_count: number;
  strategies: StrategyPayload[];
  recent_runs: Array<{ id: string; strategy_id: string; status: string; created_at: string }>;
};

function parseHash(hash: string): Route {
  const clean = hash.replace(/^#/, '') || '/workspace';
  if (clean === '/' || clean === '/workspace') {
    return { kind: 'workspace' };
  }
  if (clean === '/creation/new') {
    return { kind: 'creation' };
  }
  const backtestMatch = clean.match(/^\/strategies\/([^/]+)\/backtest-runs\/new$/);
  if (backtestMatch) {
    return { kind: 'backtest', strategyId: decodeURIComponent(backtestMatch[1]) };
  }
  const runMatch = clean.match(/^\/runs\/([^/]+)$/);
  if (runMatch) {
    return { kind: 'run', runId: decodeURIComponent(runMatch[1]) };
  }
  return { kind: 'workspace' };
}

function go(hashPath: string) {
  window.location.hash = hashPath;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(payload?.message ?? `Request failed: ${response.status}`);
  }
  return payload as T;
}

function App() {
  return <PhaseThreeApp />;
}

function WorkspacePage() {
  const [data, setData] = useState<WorkspacePayload | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setError(null);
      const payload = await apiFetch<WorkspacePayload>('/workspace/overview');
      setData(payload);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function refreshSnapshots() {
    try {
      setRefreshing(true);
      setError(null);
      await apiFetch('/admin/snapshot-refresh-jobs', { method: 'POST', body: JSON.stringify({}) });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="stack">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Vertical Slice</p>
          <h2>Workspace -&gt; Creation -&gt; Snapshot -&gt; Backtest -&gt; Run Detail</h2>
          <p className="hero-copy">这个恢复版只保留最近完整可运行基线，优先保证主流程稳定可走通。</p>
        </div>
        <div className="hero-actions">
          <button className="primary-button" onClick={() => go('/creation/new')}>
            新建策略
          </button>
          <button className="ghost-button" disabled={refreshing} onClick={() => void refreshSnapshots()}>
            {refreshing ? '刷新中...' : '刷新本地快照'}
          </button>
        </div>
      </section>

      {error ? <ErrorBanner message={error} /> : null}

      <section className="stats-grid">
        <MetricCard label="策略数" value={String(data?.strategy_count ?? 0)} />
        <MetricCard label="最近完成回测" value={String(data?.completed_run_count ?? 0)} />
        <MetricCard label="API Base" value={API_BASE.replace(/^https?:\/\//, '')} />
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Strategies</h3>
          <button className="text-button" onClick={() => void load()}>
            重新加载
          </button>
        </div>
        <div className="card-grid">
          {(data?.strategies ?? []).map((strategy) => (
            <article className="strategy-card" key={strategy.id}>
              <p className="eyebrow">{strategy.strategy_type}</p>
              <h4>{strategy.name}</h4>
              <p>{strategy.universe_name || '未指定标的'}</p>
              <div className="card-actions">
                <a href={`#/strategies/${strategy.id}/backtest-runs/new`}>提交回测</a>
                {strategy.latest_run_id ? <a href={`#/runs/${strategy.latest_run_id}`}>最近运行</a> : null}
              </div>
            </article>
          ))}
          {!data?.strategies?.length ? <p className="empty-state">当前还没有 materialized strategy，先去 Creation 页面生成一条。</p> : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Recent Runs</h3>
        </div>
        <div className="run-list">
          {(data?.recent_runs ?? []).map((run) => (
            <a className="run-row" href={`#/runs/${run.id}`} key={run.id}>
              <span>{run.id}</span>
              <span>{run.status}</span>
              <span>{run.created_at}</span>
            </a>
          ))}
          {!data?.recent_runs?.length ? <p className="empty-state">还没有正式回测运行。</p> : null}
        </div>
      </section>
    </div>
  );
}

function CreationPage() {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [draft, setDraft] = useState('纳指网格策略 目标QQQ，本金100000，初始买入10%，后续每跌2%买入5%，每涨5%卖出5%');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        setBusy(true);
        const created = await apiFetch<SessionPayload>('/strategy-creation-sessions', {
          method: 'POST',
          body: JSON.stringify({}),
        });
        if (!cancelled) {
          setSession(created);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  async function sendPrompt() {
    if (!session) {
      return;
    }
    try {
      setBusy(true);
      setError(null);
      const updated = await apiFetch<SessionPayload>(`/strategy-creation-sessions/${session.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: draft }),
      });
      setSession(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function prepare() {
    if (!session) {
      return;
    }
    try {
      setBusy(true);
      setError(null);
      const updated = await apiFetch<SessionPayload>(`/strategy-creation-sessions/${session.id}/prepare-confirmation`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setSession(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function materialize() {
    if (!session) {
      return;
    }
    try {
      setBusy(true);
      setError(null);
      const strategy = await apiFetch<StrategyPayload>(`/strategy-creation-sessions/${session.id}/materialize`, {
        method: 'POST',
        body: JSON.stringify({ idempotency_key: `materialize-${session.id}` }),
      });
      go(`/strategies/${strategy.id}/backtest-runs/new`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-header">
          <h2>Conversation Draft</h2>
          <span className="status-chip">{session?.status ?? 'BOOTSTRAPPING'}</span>
        </div>
        <textarea className="prompt-box" value={draft} onChange={(event) => setDraft(event.target.value)} />
        <div className="hero-actions">
          <button className="primary-button" disabled={busy || !session} onClick={() => void sendPrompt()}>
            解析消息
          </button>
          <button className="ghost-button" disabled={busy || !session} onClick={() => void prepare()}>
            准备确认
          </button>
          <button className="ghost-button" disabled={busy || !session} onClick={() => void materialize()}>
            Materialize
          </button>
        </div>
        {error ? <ErrorBanner message={error} /> : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Top Level</h3>
        </div>
        <div className="kv-grid">
          <KeyValue label="策略类型" value={session?.top_level.strategy_type ?? '-'} />
          <KeyValue label="标的" value={session?.top_level.universe_name ?? '-'} />
          <KeyValue label="调仓频率" value={session?.top_level.rebalance_frequency ?? '-'} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Confirmation Parameters</h3>
        </div>
        <div className="parameter-list">
          {(session?.confirmation_fields.parameters ?? []).map((field) => (
            <div className="parameter-row" key={field.key}>
              <span>{field.label}</span>
              <strong>{field.value === null || field.value === undefined || field.value === '' ? '-' : String(field.value)}</strong>
              <small>{field.source}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Pending Inputs</h3>
        </div>
        {session?.pending_inputs?.length ? (
          <div className="parameter-list">
            {session.pending_inputs.map((item) => (
              <div className="parameter-row" key={item.key}>
                <span>{item.label}</span>
                <strong>{item.key}</strong>
                <small>{item.message}</small>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-state">当前 confirmation draft 已经完整。</p>
        )}
      </section>
    </div>
  );
}

function BacktestPage({ strategyId }: { strategyId: string }) {
  const [strategy, setStrategy] = useState<StrategyPayload | null>(null);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [startDate, setStartDate] = useState('2024-03-01');
  const [endDate, setEndDate] = useState('2025-03-31');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const payload = await apiFetch<StrategyPayload>(`/strategies/${strategyId}/detail`);
        if (!cancelled) {
          setStrategy(payload);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [strategyId]);

  async function refreshSnapshots() {
    try {
      setBusy(true);
      setError(null);
      await apiFetch('/admin/snapshot-refresh-jobs', { method: 'POST', body: JSON.stringify({}) });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    try {
      setBusy(true);
      setError(null);
      const payload = await apiFetch<Record<string, unknown>>(`/strategies/${strategyId}/backtest-runs/preview`, {
        method: 'POST',
        body: JSON.stringify({ start_date: startDate, end_date: endDate }),
      });
      setPreview(payload);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    try {
      setBusy(true);
      setError(null);
      const payload = await apiFetch<{ id: string }>(`/strategies/${strategyId}/backtest-runs`, {
        method: 'POST',
        body: JSON.stringify({ idempotency_key: `run-${strategyId}`, start_date: startDate, end_date: endDate }),
      });
      go(`/runs/${payload.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-header">
          <h2>{strategy?.name ?? strategyId}</h2>
          <span className="status-chip">{strategy?.strategy_type ?? 'LOADING'}</span>
        </div>
        <div className="kv-grid">
          <KeyValue label="标的范围" value={strategy?.universe_name ?? '-'} />
          <KeyValue label="开始日期" value={startDate} />
          <KeyValue label="结束日期" value={endDate} />
        </div>
        <div className="date-row">
          <label>
            <span>Start</span>
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </label>
          <label>
            <span>End</span>
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </label>
        </div>
        <div className="hero-actions">
          <button className="ghost-button" disabled={busy} onClick={() => void refreshSnapshots()}>
            刷新快照
          </button>
          <button className="primary-button" disabled={busy} onClick={() => void runPreview()}>
            预览回测
          </button>
          <button className="ghost-button" disabled={busy} onClick={() => void submit()}>
            提交正式运行
          </button>
        </div>
        {error ? <ErrorBanner message={error} /> : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Preview Contract</h3>
        </div>
        {preview ? (
          <div className="kv-grid">
            <KeyValue label="Effective Date" value={String(preview.effective_date ?? '-')} />
            <KeyValue label="OOS Start" value={String(preview.oos_start_date ?? '-')} />
            <KeyValue label="Coverage Ratio" value={String(preview.coverage_ratio ?? '-')} />
            <KeyValue label="Blind Test Zone" value={String((preview.blind_test_zone as { oos_start_date?: string } | undefined)?.oos_start_date ?? '-')} />
          </div>
        ) : (
          <p className="empty-state">先点击“预览回测”生成 preview contract。</p>
        )}
      </section>
    </div>
  );
}

function RunDetailPage({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const detail = await apiFetch<RunPayload>(`/backtest-runs/${runId}/detail`);
        if (!cancelled) {
          setRun(detail);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-header">
          <h2>Run Detail</h2>
          <span className="status-chip">{run?.status ?? 'LOADING'}</span>
        </div>
        {error ? <ErrorBanner message={error} /> : null}
        <div className="stats-grid">
          <MetricCard label="CAGR" value={formatMetric(run?.metrics?.cagr)} />
          <MetricCard label="Sharpe" value={formatMetric(run?.metrics?.sharpe)} />
          <MetricCard label="Max DD" value={formatMetric(run?.metrics?.max_drawdown)} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Equity Curve</h3>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Equity</th>
                <th>Benchmark</th>
                <th>Drawdown</th>
                <th>Segment</th>
              </tr>
            </thead>
            <tbody>
              {(run?.chart_series ?? []).slice(-12).map((point) => (
                <tr key={point.trade_date}>
                  <td>{point.trade_date}</td>
                  <td>{point.equity.toFixed(2)}</td>
                  <td>{point.benchmark.toFixed(2)}</td>
                  <td>{point.drawdown.toFixed(2)}%</td>
                  <td>{point.is_oos ? 'OOS' : 'IS'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Monthly Returns</h3>
        </div>
        <div className="parameter-list">
          {(run?.monthly_returns ?? []).map((item) => (
            <div className="parameter-row" key={item.month}>
              <span>{item.month}</span>
              <strong>{item.return_pct === null ? '-' : `${item.return_pct.toFixed(2)}%`}</strong>
              <small>{item.segment}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Trades</h3>
        </div>
        <div className="parameter-list">
          {(run?.trades ?? []).slice(0, 20).map((trade) => (
            <div className="parameter-row" key={`${trade.trade_date}-${trade.symbol}-${trade.action}`}>
              <span>{trade.trade_date}</span>
              <strong>{trade.symbol} / {trade.action}</strong>
              <small>{trade.segment}</small>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="kv-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return <div className="error-banner">{message}</div>;
}

function formatMetric(value: unknown) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }
  return value.toFixed(4);
}

export default App;

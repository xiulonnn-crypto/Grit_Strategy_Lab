import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApiClient } from '../lib/demoStoreContext';
import { formatDateTime } from '../lib/format';
import type {
  ApiFactorFactoryOverview,
  ApiFactorFactoryRun,
  ApiFactorMiningCandidate,
  ApiFactorMiningJob,
  ApiFactorMiningJobCreatePayload,
  ApiFactorQuarantineCandidate,
} from '../types';
import './factor-phase2-pages.css';

type FactorySection = 'overview' | 'sandbox' | 'quarantine';
type BusyAction = 'start' | 'pause' | 'run-now' | 'cancel' | 'intake' | 'run-quarantine' | 'publish' | null;
type AnyRecord = Record<string, unknown>;

export type FactorFactoryPageProps = {
  initialSection?: FactorySection;
};

const DEFAULT_REQUEST: ApiFactorMiningJobCreatePayload = {
  universe: 'SP500',
  start_date: '2018-01-01',
  end_date: '2024-12-31',
  operators: ['return', 'rank', 'zscore', 'winsorize'],
  candidate_count: 250,
  random_seed: 42,
  min_rank_ic: 0.03,
  max_depth: 4,
};

function isRecord(value: unknown): value is AnyRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): AnyRecord {
  return isRecord(value) ? value : {};
}

function asList<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function text(value: unknown, fallback = '未生成'): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function numeric(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: unknown, digits = 2): string {
  const parsed = numeric(value);
  return parsed === null ? '未生成' : parsed.toFixed(digits);
}

function formatPct(value: unknown, digits = 1): string {
  const parsed = numeric(value);
  if (parsed === null) return '未生成';
  const scaled = Math.abs(parsed) <= 1 ? parsed * 100 : parsed;
  return `${scaled.toFixed(digits)}%`;
}

function formatShortDate(value: unknown): string {
  const raw = text(value, '');
  if (!raw) return '未记录';
  const datePart = raw.includes('T') ? raw.split('T')[0] : raw.slice(0, 10);
  return datePart || '未记录';
}

function statusToken(value: unknown): string {
  return text(value, '').trim().toUpperCase();
}

function chipTone(value: unknown): 'good' | 'warn' | 'bad' | 'info' {
  const status = statusToken(value);
  if (['ACTIVE', 'COMPLETED', 'PASSED', 'ELIGIBLE', 'PUBLISHED'].includes(status)) return 'good';
  if (['REJECTED', 'BLOCKED', 'FAILED'].includes(status)) return 'bad';
  if (['RUNNING', 'QUEUED', 'DIAGNOSTIC_ONLY'].includes(status)) return 'info';
  return 'warn';
}

function chipClass(value: unknown): string {
  return `factor-phase2-chip factor-phase2-chip--${chipTone(value)}`;
}

function statusLabel(value: unknown): string {
  const status = statusToken(value);
  const labels: Record<string, string> = {
    ACTIVE: '每日自动化已启用',
    PAUSED: '每日自动化已暂停',
    QUEUED: '排队中',
    RUNNING: '运行中',
    CANCEL_REQUESTED: '取消中',
    CANCELLED: '已取消',
    COMPLETED: '已完成',
    FAILED: '失败',
    PENDING: '待检疫',
    PASSED: '已通过',
    REJECTED: '已拒绝',
    NEEDS_REVIEW: '待复核',
    PUBLISHED: '已发布',
    ELIGIBLE: '可发布',
    BLOCKED: '阻断',
    MANUAL_REVIEW_REQUIRED: '需人工裁决',
    DIAGNOSTIC_ONLY: '诊断证据',
  };
  return labels[status] ?? text(value);
}

function timezoneLabel(value: unknown): string {
  const raw = text(value, 'Asia/Hong_Kong');
  if (raw === 'Asia/Hong_Kong' || raw === 'GMT+8' || raw === 'UTC+8') return 'GMT+8';
  return raw;
}

function requestFromOverview(overview: ApiFactorFactoryOverview | null): ApiFactorMiningJobCreatePayload {
  const request = overview?.profile?.request ?? overview?.latest_run?.request ?? DEFAULT_REQUEST;
  return {
    universe: text(request.universe, DEFAULT_REQUEST.universe),
    start_date: text(request.start_date, DEFAULT_REQUEST.start_date),
    end_date: text(request.end_date, DEFAULT_REQUEST.end_date),
    operators: Array.isArray(request.operators) && request.operators.length
      ? request.operators.map(String)
      : DEFAULT_REQUEST.operators,
    candidate_count: numeric(request.candidate_count) ?? DEFAULT_REQUEST.candidate_count,
    random_seed: numeric(request.random_seed) ?? DEFAULT_REQUEST.random_seed,
    min_rank_ic: numeric(request.min_rank_ic) ?? DEFAULT_REQUEST.min_rank_ic,
    max_depth: numeric(request.max_depth) ?? DEFAULT_REQUEST.max_depth,
  };
}

function runDateLabel(run: ApiFactorFactoryRun): string {
  const trigger = statusToken(run.trigger) === 'DAILY' ? '每日自动化' : '立即运行';
  return `${trigger} · ${run.run_date || '未记录日期'}`;
}

function miningCandidates(jobs: ApiFactorMiningJob[]): Array<ApiFactorMiningCandidate & { sourceJobId: string }> {
  return jobs.flatMap((job) => (job.top_candidates ?? []).map((candidate) => ({
    ...candidate,
    sourceJobId: job.id,
  })));
}

function candidateKey(candidate: ApiFactorMiningCandidate): string {
  return text(candidate.id || candidate.expression, 'candidate');
}

function candidateResidualSummary(candidate: ApiFactorMiningCandidate | ApiFactorQuarantineCandidate | null): AnyRecord {
  if (!candidate) return {};
  const miningResidual = asRecord((candidate as ApiFactorMiningCandidate).auto_residual_summary);
  if (Object.keys(miningResidual).length) return miningResidual;
  const metrics = asRecord((candidate as ApiFactorQuarantineCandidate).candidate_metrics);
  const metricResidual = asRecord(metrics.auto_residual_summary);
  if (Object.keys(metricResidual).length) return metricResidual;
  const latestRun = asRecord((candidate as ApiFactorQuarantineCandidate).latest_run);
  const orthogonal = asRecord(latestRun.orthogonal);
  return asRecord(orthogonal.auto_residual);
}

function candidateDrawdownRatio(candidate: ApiFactorMiningCandidate | ApiFactorQuarantineCandidate | null): number | null {
  if (!candidate) return null;
  const miningRatio = numeric((candidate as ApiFactorMiningCandidate).drawdown_vs_benchmark_ratio);
  if (miningRatio !== null) return miningRatio;
  const metrics = asRecord((candidate as ApiFactorQuarantineCandidate).candidate_metrics);
  const metricRatio = numeric(metrics.drawdown_vs_benchmark_ratio);
  if (metricRatio !== null) return metricRatio;
  const latestRun = asRecord((candidate as ApiFactorQuarantineCandidate).latest_run);
  const stability = asRecord(latestRun.stability);
  return numeric(stability.drawdown_vs_benchmark_ratio);
}

function pitGateMode(candidate: ApiFactorQuarantineCandidate | null, overview: ApiFactorFactoryOverview | null): string {
  if (!candidate) return text(overview?.gate_policy?.pit_gate_mode, 'DIAGNOSTIC_ONLY');
  const gate = asRecord(candidate.gate_summary);
  const pit = asRecord(candidate.pit_evidence);
  return text(gate.pit_gate_mode ?? pit.gate_mode ?? overview?.gate_policy?.pit_gate_mode, 'DIAGNOSTIC_ONLY');
}

function candidateOutputDate(candidate: ApiFactorQuarantineCandidate): string {
  const latestRun = asRecord(candidate.latest_run);
  return formatShortDate(
    candidate.published_at ??
    latestRun.completed_at ??
    candidate.updated_at ??
    candidate.created_at,
  );
}

function candidateMetricLine(candidate: ApiFactorQuarantineCandidate): string {
  const metrics = asRecord(candidate.candidate_metrics);
  return [
    `输出 ${candidateOutputDate(candidate)}`,
    `Rank IC ${formatNumber(metrics.rank_ic, 3)}`,
    `IR ${formatNumber(metrics.ir, 2)}`,
    `覆盖 ${formatPct(metrics.coverage)}`,
  ].join(' · ');
}

function candidateReviewReason(candidate: ApiFactorQuarantineCandidate): string {
  if (statusToken(candidate.status) !== 'NEEDS_REVIEW') return '';
  const latestRun = asRecord(candidate.latest_run);
  const latestSummary = asRecord(latestRun.summary);
  const publish = asRecord(candidate.publish_eligibility);
  const pit = asRecord(candidate.pit_evidence);
  const warnings = asList<unknown>(latestSummary.diagnostic_warnings ?? pit.warnings ?? pit.diagnostic_warnings)
    .map(String)
    .filter(Boolean);
  return text(
    candidate.rejected_reason ??
    publish.reason ??
    latestSummary.publish_reason ??
    warnings[0],
    '需人工复核门禁原因',
  );
}

function sortedQuarantineCandidates(items: ApiFactorQuarantineCandidate[]): ApiFactorQuarantineCandidate[] {
  return [...items].sort((left, right) => text(right.updated_at).localeCompare(text(left.updated_at)));
}

export default function FactorFactoryPage({ initialSection = 'overview' }: FactorFactoryPageProps): JSX.Element {
  const api = useApiClient();
  const [overview, setOverview] = useState<ApiFactorFactoryOverview | null>(null);
  const [section, setSection] = useState<FactorySection>(initialSection);
  const [selectedMiningId, setSelectedMiningId] = useState('');
  const [selectedQuarantineId, setSelectedQuarantineId] = useState('');
  const [loading, setLoading] = useState(Boolean(api.getFactorFactoryOverview));
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadOverview = useCallback(async (): Promise<void> => {
    if (!api.getFactorFactoryOverview) {
      setOverview(null);
      setError('因子工厂 API 尚未接入，无法加载自动化状态。');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const payload = await api.getFactorFactoryOverview();
      setOverview(payload);
      setError(null);
    } catch (err) {
      setOverview(null);
      setError(err instanceof Error ? err.message : '因子工厂概览加载失败。');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const jobs = useMemo(() => asList<ApiFactorMiningJob>(overview?.mining?.items), [overview]);
  const candidates = useMemo(() => miningCandidates(jobs), [jobs]);
  const quarantineCandidates = useMemo(
    () => sortedQuarantineCandidates(asList<ApiFactorQuarantineCandidate>(overview?.quarantine?.items)),
    [overview],
  );
  const selectedMining = useMemo(
    () => candidates.find((candidate) => candidateKey(candidate) === selectedMiningId) ?? candidates[0] ?? null,
    [candidates, selectedMiningId],
  );
  const selectedQuarantine = useMemo(
    () => quarantineCandidates.find((candidate) => candidate.id === selectedQuarantineId) ?? quarantineCandidates[0] ?? null,
    [quarantineCandidates, selectedQuarantineId],
  );
  const activeRun = overview?.active_run ?? null;
  const latestRun = overview?.latest_run ?? null;
  const funnel = overview?.funnel;
  const profile = overview?.profile;
  const gatePolicy = overview?.gate_policy ?? profile?.gate_policy;
  const publishableCandidates = quarantineCandidates.filter((candidate) => (
    statusToken(candidate.status) === 'PASSED' && statusToken(candidate.publish_status) === 'ELIGIBLE'
  ));
  const residualSummary = candidateResidualSummary(selectedQuarantine ?? selectedMining);
  const drawdownRatio = candidateDrawdownRatio(selectedQuarantine ?? selectedMining);
  const drawdownLimit = numeric(gatePolicy?.max_drawdown_relative_to_benchmark) ?? 1.5;
  const pitMode = pitGateMode(selectedQuarantine, overview);
  const diagnosticWarnings = asList<string>(asRecord(selectedQuarantine?.latest_run).diagnostic_warnings)
    .map(String)
    .concat(asList<string>(selectedQuarantine?.pit_evidence?.diagnostic_warnings).map(String));

  const withBusy = async (action: BusyAction, task: () => Promise<void>): Promise<void> => {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败。');
    } finally {
      setBusy(null);
    }
  };

  const startAutomation = (): void => {
    void withBusy('start', async () => {
      if (!api.startFactorFactoryAutomation) throw new Error('启动自动化 API 尚未接入。');
      const payload = await api.startFactorFactoryAutomation({
        timezone: profile?.timezone ?? 'Asia/Hong_Kong',
        schedule_time: '14:00',
        request: requestFromOverview(overview),
        gate_policy: gatePolicy,
      });
      setOverview(payload);
      setNotice('每日自动化已启动；GMT+8 14:00 运行，并自动送检与执行检疫。');
    });
  };

  const pauseAutomation = (): void => {
    void withBusy('pause', async () => {
      if (!api.pauseFactorFactoryAutomation) throw new Error('暂停自动化 API 尚未接入。');
      const payload = await api.pauseFactorFactoryAutomation();
      setOverview(payload);
      setNotice('每日自动化已暂停；已存在的历史 run 不会被删除。');
    });
  };

  const runNow = (): void => {
    void withBusy('run-now', async () => {
      if (!api.runFactorFactoryNow) throw new Error('立即运行 API 尚未接入。');
      const payload = await api.runFactorFactoryNow({
        request: requestFromOverview(overview),
        gate_policy: gatePolicy,
      });
      setOverview(payload);
      setNotice('已创建一次性工厂 run；每日自动化状态保持不变。');
    });
  };

  const cancelRun = (run: ApiFactorFactoryRun | null): void => {
    if (!run) return;
    void withBusy('cancel', async () => {
      if (!api.cancelFactorFactoryRun) throw new Error('取消工厂 run API 尚未接入。');
      await api.cancelFactorFactoryRun(run.id);
      await loadOverview();
      setNotice('工厂 run 已发出取消请求。');
    });
  };

  const sendToQuarantine = (candidate: (ApiFactorMiningCandidate & { sourceJobId?: string }) | null): void => {
    if (!candidate) return;
    void withBusy('intake', async () => {
      if (!api.factorQuarantineIntake) throw new Error('检疫接收 API 尚未接入。');
      await api.factorQuarantineIntake({
        mining_job_id: candidate.sourceJobId,
        candidate_ids: [candidate.id],
      });
      await loadOverview();
      setSection('quarantine');
      setNotice('候选已进入 D2 检疫队列。');
    });
  };

  const runQuarantine = (candidate: ApiFactorQuarantineCandidate | null): void => {
    if (!candidate) return;
    void withBusy('run-quarantine', async () => {
      if (!api.runFactorQuarantineCandidate) throw new Error('检疫执行 API 尚未接入。');
      await api.runFactorQuarantineCandidate(candidate.id, { reason: 'factor_factory_workbench' });
      await loadOverview();
      setNotice('检疫已完成，PIT 证据按诊断项写入。');
    });
  };

  const publishCandidate = (candidate: ApiFactorQuarantineCandidate | null): void => {
    if (!candidate) return;
    void withBusy('publish', async () => {
      if (!api.publishFactorQuarantineCandidate) throw new Error('发布 API 尚未接入。');
      await api.publishFactorQuarantineCandidate(candidate.id, { operator: 'system_rule' });
      await loadOverview();
      setNotice('候选已发布到正式因子库，并记录发布审计。');
    });
  };

  const activeSectionClass = (value: FactorySection): string =>
    `factor-factory-tab${section === value ? ' is-active' : ''}`;

  return (
    <main
      className="factor-phase2-page factor-factory-page"
      data-page-root="factor-factory"
      data-initial-section={initialSection}
    >
      <section className="factor-phase2-hero factor-factory-hero">
        <div>
          <p className="factor-phase2-hero__eyebrow">Closed-loop Factor Factory</p>
          <h1>因子工厂</h1>
          <p>
            挖掘沙盒与检疫工作台已合并为一条闭环流水线。启动自动化代表每日
            GMT+8 14:00 自动运行；立即运行只创建一次性 run，不改变每日状态。
          </p>
        </div>
        <div className="factor-phase2-actions">
          <button
            className="factor-phase2-button factor-phase2-button--primary"
            disabled={busy !== null || loading}
            type="button"
            onClick={startAutomation}
          >
            {busy === 'start' ? '启动中...' : '启动自动化'}
          </button>
          <button
            className="factor-phase2-button"
            disabled={busy !== null || loading}
            type="button"
            onClick={pauseAutomation}
          >
            {busy === 'pause' ? '暂停中...' : '暂停自动化'}
          </button>
          <button
            className="factor-phase2-button"
            disabled={busy !== null || loading}
            type="button"
            onClick={runNow}
          >
            {busy === 'run-now' ? '运行中...' : '立即运行'}
          </button>
        </div>
      </section>

      <section className="factor-factory-status-strip" aria-label="因子工厂状态">
        <span className={chipClass(profile?.status ?? 'PAUSED')}>{statusLabel(profile?.status ?? 'PAUSED')}</span>
        <span>每日时间：{timezoneLabel(profile?.timezone)} {profile?.schedule_time ?? '14:00'}</span>
        <span>下次计划：{profile?.next_run_at ? formatDateTime(profile.next_run_at) : '等待启动'}</span>
        <span className={chipClass(pitMode)}>PIT 门禁：{statusLabel(pitMode)}，不阻断发布</span>
      </section>

      {error ? <div className="factor-phase2-empty factor-phase2-empty--danger">{error}</div> : null}
      {notice ? <div className="factor-phase2-empty factor-factory-notice">{notice}</div> : null}

      <section className="factor-factory-tabs" aria-label="因子工厂分区">
        <button className={activeSectionClass('overview')} type="button" onClick={() => setSection('overview')}>工厂总览</button>
        <button className={activeSectionClass('sandbox')} type="button" onClick={() => setSection('sandbox')}>挖掘队列</button>
        <button className={activeSectionClass('quarantine')} type="button" onClick={() => setSection('quarantine')}>检疫与发布</button>
      </section>

      <section className="factor-phase2-metrics factor-factory-funnel" aria-label="因子漏斗">
        {[
          ['挖掘候选', funnel?.mined_candidates ?? 0, '来自 sandbox top candidate projection'],
          ['已送检', funnel?.quarantine_candidates ?? 0, 'D2 检疫队列'],
          ['检疫通过', funnel?.passed ?? 0, 'PASSED + ELIGIBLE 才可发布'],
          ['已发布', funnel?.published ?? 0, '正式因子库 AUTO_MINED'],
        ].map(([label, value, hint]) => (
          <div className="factor-phase2-metric" key={String(label)}>
            <p className="factor-phase2-metric__label">{label}</p>
            <p className="factor-phase2-metric__value">{value}</p>
            <p className="factor-phase2-metric__hint">{hint}</p>
          </div>
        ))}
      </section>

      <section className="factor-factory-workbench">
        <article className="factor-phase2-panel factor-factory-runs" data-factory-section="overview">
          <div className="factor-phase2-panel__header">
            <div>
              <p className="factor-phase2-panel__eyebrow">Automation</p>
              <h2>自动化 run</h2>
            </div>
            <span className={chipClass(activeRun?.status ?? latestRun?.status ?? 'PAUSED')}>
              {activeRun ? statusLabel(activeRun.status) : latestRun ? statusLabel(latestRun.status) : '未启动'}
            </span>
          </div>
          <div className="factor-phase2-panel__body">
            {loading ? <div className="factor-phase2-empty">正在读取工厂状态...</div> : null}
            {!loading && !overview ? <div className="factor-phase2-empty">没有可用工厂状态。</div> : null}
            {latestRun ? (
              <div className="factor-phase2-row">
                <div className="factor-phase2-row__top">
                  <h3>{runDateLabel(latestRun)}</h3>
                  <span className={chipClass(latestRun.status)}>{statusLabel(latestRun.status)}</span>
                </div>
                <p>{latestRun.id}</p>
                <div className="factor-phase2-stat-grid">
                  <div className="factor-phase2-stat">
                    <b>{latestRun.mining_job_id ?? '未生成'}</b>
                    <span>挖掘任务</span>
                  </div>
                  <div className="factor-phase2-stat">
                    <b>{text(latestRun.summary?.top_candidate_count, '0')}</b>
                    <span>候选摘要</span>
                  </div>
                  <div className="factor-phase2-stat">
                    <b>{formatNumber(latestRun.summary?.drawdown_threshold ?? drawdownLimit, 1)}x</b>
                    <span>回撤上限</span>
                  </div>
                </div>
                <button
                  className="factor-phase2-button factor-phase2-button--small"
                  disabled={busy !== null || !['QUEUED', 'RUNNING'].includes(statusToken(latestRun.status))}
                  type="button"
                  onClick={() => cancelRun(latestRun)}
                >
                  {busy === 'cancel' ? '取消中...' : '取消 run'}
                </button>
              </div>
            ) : null}
            {overview?.runs?.length ? (
              <ul className="factor-phase2-list factor-factory-run-list">
                {overview.runs.slice(0, 4).map((run) => (
                  <li className="factor-phase2-row" key={run.id}>
                    <div className="factor-phase2-row__top">
                      <strong>{runDateLabel(run)}</strong>
                      <span className={chipClass(run.status)}>{statusLabel(run.status)}</span>
                    </div>
                    <p>{run.id}</p>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </article>

        <article className="factor-phase2-panel" data-factory-section="sandbox">
          <div className="factor-phase2-panel__header">
            <div>
              <p className="factor-phase2-panel__eyebrow">D1 Sandbox</p>
              <h2>挖掘队列</h2>
            </div>
            <span className="factor-phase2-chip factor-phase2-chip--info">{jobs.length} 个任务</span>
          </div>
          <div className="factor-phase2-panel__body">
            {!jobs.length ? <div className="factor-phase2-empty">运行时没有挖掘任务；可点击立即运行创建一次性 run。</div> : null}
            <ul className="factor-phase2-list">
              {jobs.slice(0, 5).map((job) => (
                <li className="factor-phase2-row" key={job.id}>
                  <div className="factor-phase2-row__top">
                    <h3>{job.id}</h3>
                    <span className={chipClass(job.status)}>{statusLabel(job.status)}</span>
                  </div>
                  <div className="factor-phase2-progress" aria-label={`${job.id} 进度`}>
                    <span style={{ width: `${Math.max(0, Math.min(100, numeric(job.progress?.percent) ?? 0))}%` }} />
                  </div>
                  <p>
                    {text(job.request?.universe)} · {text(job.request?.start_date)} 至 {text(job.request?.end_date)}
                    {' · '}目标 {text(job.request?.candidate_count)} 个
                  </p>
                </li>
              ))}
            </ul>
            <div className="factor-factory-candidate-list">
              <h3>候选摘要</h3>
              {!candidates.length ? <div className="factor-phase2-empty">没有 top candidate projection；不会展示静态样例。</div> : null}
              {candidates.slice(0, 6).map((candidate) => {
                const key = candidateKey(candidate);
                return (
                  <button
                    className={`factor-factory-candidate${selectedMining && candidateKey(selectedMining) === key ? ' is-active' : ''}`}
                    key={`${candidate.sourceJobId}-${key}`}
                    type="button"
                    onClick={() => {
                      setSelectedMiningId(key);
                      setSection('sandbox');
                    }}
                  >
                    <span>
                      <strong>{candidate.expression}</strong>
                      <small>
                        Fitness {formatNumber(candidate.fitness_score ?? candidate.score, 3)}
                        {' · '}Rank IC {formatNumber(candidate.rank_ic, 3)}
                        {' · '}Style Corr {formatNumber(candidate.max_style_correlation, 2)}
                      </small>
                    </span>
                    <i>{formatPct(candidate.coverage)}</i>
                  </button>
                );
              })}
              <button
                className="factor-phase2-button factor-phase2-button--primary"
                disabled={busy !== null || !selectedMining}
                type="button"
                onClick={() => sendToQuarantine(selectedMining)}
              >
                {busy === 'intake' ? '送检中...' : '送入检疫'}
              </button>
            </div>
          </div>
        </article>

        <article className="factor-phase2-panel" data-factory-section="quarantine">
          <div className="factor-phase2-panel__header">
            <div>
              <p className="factor-phase2-panel__eyebrow">D2 Gate</p>
              <h2>检疫与发布</h2>
            </div>
            <span className="factor-phase2-chip factor-phase2-chip--good">{publishableCandidates.length} 个可发布</span>
          </div>
          <div className="factor-phase2-panel__body">
            {!quarantineCandidates.length ? <div className="factor-phase2-empty">检疫队列为空；请先从挖掘候选送检。</div> : null}
            <ul className="factor-phase2-list">
              {quarantineCandidates.slice(0, 7).map((candidate) => (
                <li className="factor-phase2-row" key={candidate.id}>
                  <button
                    className={`factor-factory-candidate${selectedQuarantine?.id === candidate.id ? ' is-active' : ''}`}
                    type="button"
                    onClick={() => {
                      setSelectedQuarantineId(candidate.id);
                      setSection('quarantine');
                    }}
                  >
                    <span>
                      <strong>{candidate.expression}</strong>
                      <small>{candidateMetricLine(candidate)}</small>
                    </span>
                    <span className="factor-factory-candidate-status">
                      <i className={chipClass(candidate.status)}>{statusLabel(candidate.status)}</i>
                      {candidateReviewReason(candidate) ? <small>{candidateReviewReason(candidate)}</small> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="factor-phase2-actions factor-factory-local-actions">
              <button
                className="factor-phase2-button"
                disabled={busy !== null || !selectedQuarantine}
                type="button"
                onClick={() => runQuarantine(selectedQuarantine)}
              >
                {busy === 'run-quarantine' ? '检疫中...' : '执行检疫'}
              </button>
              <button
                className="factor-phase2-button factor-phase2-button--primary"
                disabled={
                  busy !== null ||
                  !selectedQuarantine ||
                  statusToken(selectedQuarantine.status) !== 'PASSED' ||
                  statusToken(selectedQuarantine.publish_status) !== 'ELIGIBLE'
                }
                type="button"
                onClick={() => publishCandidate(selectedQuarantine)}
              >
                {busy === 'publish' ? '发布中...' : '发布因子'}
              </button>
            </div>
          </div>
        </article>
      </section>

      <section className="factor-factory-gate-grid" aria-label="检疫闸门详情">
        <article className="factor-phase2-panel">
          <div className="factor-phase2-panel__header">
            <div>
              <p className="factor-phase2-panel__eyebrow">Auto-Residual</p>
              <h2>残差信号复核</h2>
            </div>
            <span className={chipClass(residualSummary.status ?? (Object.keys(residualSummary).length ? 'PASSED' : 'PENDING'))}>
              {Object.keys(residualSummary).length ? '已生成' : '待生成'}
            </span>
          </div>
          <div className="factor-phase2-panel__body">
            <div className="factor-phase2-gate factor-phase2-gate--good">
              <span className="factor-phase2-gate__status" />
              <div>
                <b>{text(residualSummary.residual_expression ?? residualSummary.expression)}</b>
                <span>风格相关性高于 0.3 时自动残差化，再跑 IS/OOS 与回撤门槛。</span>
              </div>
            </div>
            <div className="factor-quarantine-report">
              <div><span>控制因子</span><strong>{text(residualSummary.control_factor_id ?? residualSummary.control_factor)}</strong></div>
              <div><span>残差 Rank IC</span><strong>{formatNumber(residualSummary.residual_rank_ic ?? residualSummary.rank_ic, 3)}</strong></div>
              <div><span>相关惩罚</span><strong>{formatNumber((selectedMining as ApiFactorMiningCandidate | null)?.correlation_penalty ?? selectedQuarantine?.candidate_metrics?.correlation_penalty, 3)}</strong></div>
            </div>
          </div>
        </article>

        <article className="factor-phase2-panel">
          <div className="factor-phase2-panel__header">
            <div>
              <p className="factor-phase2-panel__eyebrow">Drawdown Gate</p>
              <h2>回撤硬约束</h2>
            </div>
            <span className={chipClass(drawdownRatio === null ? 'PENDING' : drawdownRatio < drawdownLimit ? 'PASSED' : 'BLOCKED')}>
              {drawdownRatio === null ? '待生成' : drawdownRatio < drawdownLimit ? '通过' : '阻断'}
            </span>
          </div>
          <div className="factor-phase2-panel__body">
            <div className={`factor-phase2-gate factor-phase2-gate--${
              drawdownRatio === null ? 'warn' : drawdownRatio < drawdownLimit ? 'good' : 'bad'
            }`}>
              <span className="factor-phase2-gate__status" />
              <div>
                <b>{drawdownRatio === null ? '待生成' : `${formatNumber(drawdownRatio, 2)}x`}</b>
                <span>最大回撤相对基准必须小于 {drawdownLimit.toFixed(1)}x。</span>
              </div>
            </div>
            <div className="factor-quarantine-report">
              <div><span>候选最大回撤</span><strong>{formatPct((selectedMining as ApiFactorMiningCandidate | null)?.max_drawdown_pct ?? selectedQuarantine?.candidate_metrics?.max_drawdown_pct)}</strong></div>
              <div><span>基准最大回撤</span><strong>{formatPct((selectedMining as ApiFactorMiningCandidate | null)?.benchmark_max_drawdown_pct ?? selectedQuarantine?.candidate_metrics?.benchmark_max_drawdown_pct)}</strong></div>
              <div><span>硬阈值</span><strong>{drawdownLimit.toFixed(1)}x</strong></div>
            </div>
          </div>
        </article>

        <article className="factor-phase2-panel">
          <div className="factor-phase2-panel__header">
            <div>
              <p className="factor-phase2-panel__eyebrow">PIT Evidence</p>
              <h2>PIT 诊断与发布审计</h2>
            </div>
            <span className={chipClass(pitMode)}>{statusLabel(pitMode)}</span>
          </div>
          <div className="factor-phase2-panel__body">
            <div className="factor-phase2-gate factor-phase2-gate--warn">
              <span className="factor-phase2-gate__status" />
              <div>
                <b>PIT 非 Full Ready 不阻断发布</b>
                <span>它会进入诊断状态、因子级别、发布审计与风险提示；泄露、OOS 衰减、逻辑重复、残差信号失败和回撤超限仍是硬拒绝。</span>
              </div>
            </div>
            {diagnosticWarnings.length ? (
              <ul className="factor-phase2-list">
                {diagnosticWarnings.slice(0, 4).map((warning) => (
                  <li className="factor-phase2-row" key={warning}>{warning}</li>
                ))}
              </ul>
            ) : (
              <div className="factor-phase2-empty">当前候选没有 PIT 诊断警告。</div>
            )}
            {selectedQuarantine?.target_factor_id ? (
              <div className="factor-phase2-empty factor-factory-notice">
                发布审计目标：{selectedQuarantine.target_factor_id}
              </div>
            ) : null}
          </div>
        </article>
      </section>
    </main>
  );
}

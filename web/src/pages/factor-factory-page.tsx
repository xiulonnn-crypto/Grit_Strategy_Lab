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
  generation_mode: 'HYBRID_COMPOSITION',
  source_factor_ids: [
    's_mom_6m_rank',
    's_qlty_roe_ltm_raw',
    's_vol_252d_rank',
    's_val_cfp_ltm_raw',
    's_size_cur_log',
    's_vol_downside_252d_rank',
    's_liq_amihud_20d_rank',
  ],
  recipe_families: [
    'style_blend',
    'risk_adjusted',
    'value_anchor',
    'divergence',
    'residual_neutralized',
    'ts_denoise',
  ],
  exploration_budget: 24,
  composition_policy: {
    mode: 'template_plus_exploration',
    publish_boundary: 'manual_after_quarantine',
    auto_intake_to_quarantine: true,
  },
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

function generationModeLabel(value: unknown): string {
  const mode = text(value, 'PRICE_OPERATOR').toUpperCase();
  if (mode === 'HYBRID_COMPOSITION') return '二次组合';
  return '价格算子';
}

function recipeFamilyLabel(value: unknown): string {
  const family = text(value, '').toLowerCase();
  const labels: Record<string, string> = {
    style_blend: '风格复合',
    risk_adjusted: '风险调节',
    value_anchor: '估值锚定',
    divergence: '背离惩罚',
    residual_neutralized: '残差中性化',
    ts_denoise: '时序降噪',
    pairwise_cross_family: '跨风格探索',
  };
  return labels[family] ?? text(value, '组合模板');
}

function sourceFactorList(candidate: ApiFactorMiningCandidate): string[] {
  return asList<unknown>(candidate.source_factor_ids).map(String).filter(Boolean);
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
    generation_mode: text(request.generation_mode, DEFAULT_REQUEST.generation_mode ?? 'HYBRID_COMPOSITION'),
    source_factor_ids: Array.isArray(request.source_factor_ids) && request.source_factor_ids.length
      ? request.source_factor_ids.map(String)
      : DEFAULT_REQUEST.source_factor_ids,
    recipe_families: Array.isArray(request.recipe_families) && request.recipe_families.length
      ? request.recipe_families.map(String)
      : DEFAULT_REQUEST.recipe_families,
    exploration_budget: numeric(request.exploration_budget) ?? DEFAULT_REQUEST.exploration_budget,
    composition_policy: isRecord(request.composition_policy)
      ? request.composition_policy
      : DEFAULT_REQUEST.composition_policy,
  };
}

function runDateLabel(run: ApiFactorFactoryRun): string {
  const trigger = statusToken(run.trigger) === 'DAILY' ? '每日批次' : '临时批次';
  return `${trigger} · ${run.run_date || '未记录日期'}`;
}

function miningJobWorkDate(
  job: ApiFactorMiningJob,
  runs: Array<ApiFactorFactoryRun | null | undefined>,
): string {
  const factoryRun = runs.find(
    (run): run is ApiFactorFactoryRun =>
      Boolean(run && (run.mining_job_id === job.id || run.mining_job?.id === job.id)),
  );
  return formatShortDate(factoryRun?.run_date ?? job.created_at);
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

function candidateSourceId(candidate: ApiFactorMiningCandidate): string {
  const record = asRecord(candidate);
  return text(record.candidate_id ?? candidate.id ?? candidate.expression, 'candidate');
}

function quarantinedMiningKeys(items: ApiFactorQuarantineCandidate[]): Set<string> {
  const keys = new Set<string>();
  items.forEach((candidate) => {
    const sourceJobId = text(candidate.source_mining_job_id, '');
    const miningCandidateId = text(candidate.mining_candidate_id, '');
    const expression = text(candidate.expression, '');
    if (sourceJobId && miningCandidateId) keys.add(`${sourceJobId}::id::${miningCandidateId}`);
    if (sourceJobId && expression) keys.add(`${sourceJobId}::expr::${expression}`);
  });
  return keys;
}

function isAlreadyQuarantined(
  candidate: ApiFactorMiningCandidate & { sourceJobId?: string },
  keys: Set<string>,
): boolean {
  const sourceJobId = text(candidate.sourceJobId, '');
  const candidateId = candidateSourceId(candidate);
  const expression = text(candidate.expression, '');
  return Boolean(
    sourceJobId &&
    ((candidateId && keys.has(`${sourceJobId}::id::${candidateId}`)) ||
      (expression && keys.has(`${sourceJobId}::expr::${expression}`))),
  );
}

function localizeQuarantineReason(reason: unknown, options: { omitPitDiagnostic?: boolean } = {}): string {
  let value = text(reason, '').trim();
  if (!value) return '';
  const replacements: Array<[string, string]> = [
    [
      'PIT is not Full Ready; recorded as diagnostic evidence only.',
      options.omitPitDiagnostic ? '' : 'PIT 全量就绪缺口仅作为诊断证据，不阻断发布。',
    ],
    ['Rank IC > 0.8; possible leakage or anti-time-travel failure.', 'Rank IC > 0.8，疑似泄露或反时间旅行校验失败。'],
    ['IS Rank IC / Newey-West IR / coverage failed admission thresholds.', 'IS Rank IC、Newey-West IR 或覆盖率未达到准入阈值。'],
    ['OOS rank IC or OOS/IS ratio failed admission thresholds.', 'OOS Rank IC 或 OOS/IS 比例未达到准入阈值。'],
    ['Turnover = 0; possible static signal or leakage.', '换手率为 0，疑似静态信号或泄露。'],
    ['Style/logical correlation remains above 0.3 after residual testing.', '残差化后风格/逻辑相关性仍高于 0.3。'],
    ['Auto-Residual failed IS/OOS validation.', 'Auto-Residual 未通过 IS/OOS 校验。'],
    ['Max drawdown relative to benchmark is >= 1.5x.', '最大回撤相对基准超过 1.5x。'],
    ['Expression is logically duplicated by an existing factor.', '表达式与已有因子逻辑重复。'],
    ['D2 gates passed; PIT is diagnostic-only.', 'D2 检疫通过；PIT 全量就绪缺口仅作为诊断证据。'],
  ];
  replacements.forEach(([source, target]) => {
    value = value.split(source).join(target);
  });
  return value
    .split(/[;；]+/)
    .map((segment) => segment.trim().replace(/[.。]+$/, ''))
    .filter(Boolean)
    .join('；');
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

function candidateDecisionReason(candidate: ApiFactorQuarantineCandidate): string {
  const status = statusToken(candidate.status);
  if (status !== 'NEEDS_REVIEW' && status !== 'REJECTED') return '';
  const latestRun = asRecord(candidate.latest_run);
  const latestSummary = asRecord(latestRun.summary);
  const publish = asRecord(candidate.publish_eligibility);
  const pit = asRecord(candidate.pit_evidence);
  const warnings = asList<unknown>(latestSummary.diagnostic_warnings ?? pit.warnings ?? pit.diagnostic_warnings)
    .map(String)
    .filter(Boolean);
  const reason = text(
    candidate.rejected_reason ??
    publish.reason ??
    latestSummary.publish_reason ??
    warnings[0],
    '',
  );
  return text(
    localizeQuarantineReason(reason, { omitPitDiagnostic: status === 'REJECTED' }),
    status === 'REJECTED' ? '检疫未返回硬阻断原因。' : '需人工复核门禁原因',
  );
}

function candidateDecisionReasonLabel(candidate: ApiFactorQuarantineCandidate): string {
  return statusToken(candidate.status) === 'REJECTED' ? '拒绝原因' : '复核原因';
}

function isPublishableCandidate(candidate: ApiFactorQuarantineCandidate): boolean {
  return statusToken(candidate.status) === 'PASSED' && statusToken(candidate.publish_status) === 'ELIGIBLE';
}

function quarantineCandidateSortRank(candidate: ApiFactorQuarantineCandidate): number {
  if (isPublishableCandidate(candidate)) return 0;
  const status = statusToken(candidate.status);
  if (['NEEDS_REVIEW', 'PENDING', 'RUNNING', 'QUEUED'].includes(status)) return 1;
  if (status === 'REJECTED') return 2;
  if (status === 'PUBLISHED') return 3;
  return 4;
}

function sortedQuarantineCandidates(items: ApiFactorQuarantineCandidate[]): ApiFactorQuarantineCandidate[] {
  return [...items].sort((left, right) => {
    const priorityDelta = quarantineCandidateSortRank(left) - quarantineCandidateSortRank(right);
    if (priorityDelta !== 0) return priorityDelta;
    return text(right.updated_at).localeCompare(text(left.updated_at));
  });
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

  const activeRun = overview?.active_run ?? null;
  const latestRun = overview?.latest_run ?? null;
  const currentRun = activeRun ?? latestRun;
  const currentMiningJobId = text(currentRun?.mining_job_id, '');
  const jobs = useMemo(() => {
    const allJobs = asList<ApiFactorMiningJob>(overview?.mining?.items);
    if (!currentMiningJobId) return allJobs;
    const matched = allJobs.filter((job) => job.id === currentMiningJobId);
    if (matched.length) return matched;
    return currentRun?.mining_job ? [currentRun.mining_job] : [];
  }, [currentMiningJobId, currentRun, overview]);
  const minedCandidates = useMemo(() => miningCandidates(jobs), [jobs]);
  const quarantineCandidates = useMemo(
    () => {
      const items = sortedQuarantineCandidates(asList<ApiFactorQuarantineCandidate>(overview?.quarantine?.items));
      if (!currentMiningJobId) return items;
      return items.filter((candidate) => candidate.source_mining_job_id === currentMiningJobId);
    },
    [currentMiningJobId, overview],
  );
  const quarantinedKeys = useMemo(() => quarantinedMiningKeys(quarantineCandidates), [quarantineCandidates]);
  const candidates = useMemo(
    () => minedCandidates.filter((candidate) => !isAlreadyQuarantined(candidate, quarantinedKeys)),
    [minedCandidates, quarantinedKeys],
  );
  const selectedMining = useMemo(
    () => candidates.find((candidate) => candidateKey(candidate) === selectedMiningId) ?? candidates[0] ?? null,
    [candidates, selectedMiningId],
  );
  const selectedQuarantine = useMemo(
    () => quarantineCandidates.find((candidate) => candidate.id === selectedQuarantineId) ?? quarantineCandidates[0] ?? null,
    [quarantineCandidates, selectedQuarantineId],
  );
  const profile = overview?.profile;
  const gatePolicy = overview?.gate_policy ?? profile?.gate_policy;
  const publishableCandidates = quarantineCandidates.filter(isPublishableCandidate);
  const currentRunFunnel = {
    mined_candidates: minedCandidates.length,
    quarantine_candidates: quarantineCandidates.length,
    passed: publishableCandidates.length,
    published: quarantineCandidates.filter((candidate) => statusToken(candidate.status) === 'PUBLISHED').length,
  };
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
      setNotice('已创建临时挖掘批次；每日自动化状态保持不变。');
    });
  };

  const cancelRun = (run: ApiFactorFactoryRun | null): void => {
    if (!run) return;
    void withBusy('cancel', async () => {
      if (!api.cancelFactorFactoryRun) throw new Error('取消工厂批次 API 尚未接入。');
      await api.cancelFactorFactoryRun(run.id);
      await loadOverview();
      setNotice('工厂批次已发出取消请求。');
    });
  };

  const sendToQuarantine = (candidate: (ApiFactorMiningCandidate & { sourceJobId?: string }) | null): void => {
    if (!candidate) return;
    void withBusy('intake', async () => {
      if (!api.factorQuarantineIntake) throw new Error('检疫接收 API 尚未接入。');
      if (!api.runFactorQuarantineCandidate) throw new Error('检疫执行 API 尚未接入。');
      const intake = await api.factorQuarantineIntake({
        mining_job_id: candidate.sourceJobId,
        candidate_ids: [candidate.id],
      });
      const intaked = asList<ApiFactorQuarantineCandidate>(intake.items);
      if (!intaked.length) {
        throw new Error('检疫接收未返回候选，请检查当前挖掘任务与候选 ID。');
      }
      const completed = await Promise.all(
        intaked.map((item) => api.runFactorQuarantineCandidate!(
          item.id,
          { reason: 'factor_factory_workbench_intake' },
        )),
      );
      const selected = completed[0] ?? intaked[0];
      setSelectedQuarantineId(selected.id);
      await loadOverview();
      setSection('quarantine');
      setNotice(`已送入 D2 检疫并执行 ${completed.length} 个候选；通过后可一键发布。`);
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
          <p className="factor-phase2-hero__eyebrow">闭环因子工厂</p>
          <h1>因子工厂</h1>
          <p>
            挖掘沙盒与检疫发布已合并为一条投研治理流水线。启动自动化后，每日
            GMT+8 14:00 生成新挖掘批次，候选因子自动送入检疫；用户只需确认通过项并发布。
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
        <span className="factor-phase2-chip factor-phase2-chip--info">
          {generationModeLabel(profile?.request?.generation_mode)} · 自动送检，人工发布
        </span>
        <span>每日计划：{timezoneLabel(profile?.timezone)} {profile?.schedule_time ?? '14:00'}</span>
        <span>下次批次：{profile?.next_run_at ? formatDateTime(profile.next_run_at) : '等待启动'}</span>
        <span className={chipClass(pitMode)}>10Y 因子准入：{statusLabel(pitMode)}；PIT 全量就绪缺口仅进入审计与风险提示</span>
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
          ['挖掘候选', currentRunFunnel.mined_candidates, '当前批次的候选因子池'],
          ['已送检', currentRunFunnel.quarantine_candidates, '已进入 D2 检疫的候选因子'],
          ['检疫通过', currentRunFunnel.passed, '通过检疫且具备发布资格'],
          ['已发布', currentRunFunnel.published, '已入库的自动挖掘因子'],
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
              <p className="factor-phase2-panel__eyebrow">自动化批次</p>
              <h2>工厂批次</h2>
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
                  {busy === 'cancel' ? '取消中...' : '取消批次'}
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
              <p className="factor-phase2-panel__eyebrow">D1 挖掘沙盒</p>
              <h2>挖掘队列</h2>
            </div>
            <span className="factor-phase2-chip factor-phase2-chip--info">{jobs.length} 个任务</span>
          </div>
          <div className="factor-phase2-panel__body">
            {!jobs.length ? <div className="factor-phase2-empty">运行时没有挖掘任务；可点击立即运行创建临时挖掘批次。</div> : null}
            <ul className="factor-phase2-list">
              {jobs.slice(0, 5).map((job) => {
                const workDate = miningJobWorkDate(job, [currentRun, latestRun, ...(overview?.runs ?? [])]);
                return (
                  <li className="factor-phase2-row" key={job.id}>
                    <div className="factor-phase2-row__top">
                      <h3>{job.id}</h3>
                      <span className={chipClass(job.status)}>{statusLabel(job.status)}</span>
                    </div>
                    <p>
                      {generationModeLabel(job.request?.generation_mode)}
                      {' · '}
                      {(job.request?.recipe_families ?? []).slice(0, 3).map(recipeFamilyLabel).join(' / ') || '默认模板'}
                      {' · 自动送检，人工发布'}
                    </p>
                    <div className="factor-phase2-progress" aria-label={`${job.id} 进度`}>
                      <span style={{ width: `${Math.max(0, Math.min(100, numeric(job.progress?.percent) ?? 0))}%` }} />
                    </div>
                    <p>
                      <span data-ui="factor-factory-mining-job-work-date">工作日期 {workDate}</span>
                      {' · '}
                      {text(job.request?.universe)} · {text(job.request?.start_date)} 至 {text(job.request?.end_date)}
                      {' · '}目标 {text(job.request?.candidate_count)} 个
                    </p>
                  </li>
                );
              })}
            </ul>
            <div className="factor-factory-candidate-list">
              <h3>候选摘要</h3>
              {!candidates.length ? <div className="factor-phase2-empty">当前批次候选已全部进入检疫队列，请在右侧查看检疫结果。</div> : null}
              {candidates.slice(0, 6).map((candidate) => {
                const key = candidateKey(candidate);
                const sourceFactors = sourceFactorList(candidate);
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
                        {recipeFamilyLabel(candidate.recipe_family)}
                        {candidate.recipe_kind ? ` · ${text(candidate.recipe_kind)}` : ''}
                        {candidate.orthogonality_intent ? ` · ${text(candidate.orthogonality_intent)}` : ''}
                      </small>
                      {sourceFactors.length ? (
                        <small>父因子 {sourceFactors.join(' / ')}</small>
                      ) : null}
                      <small>
                        适应度 {formatNumber(candidate.fitness_score ?? candidate.score, 3)}
                        {' · '}Rank IC {formatNumber(candidate.rank_ic, 3)}
                        {' · '}风格相关 {formatNumber(candidate.max_style_correlation, 2)}
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
              <p className="factor-phase2-panel__eyebrow">D2 检疫门禁</p>
              <h2>检疫与发布</h2>
            </div>
            <span className="factor-phase2-chip factor-phase2-chip--good">{publishableCandidates.length} 个可发布</span>
          </div>
          <div className="factor-phase2-panel__body">
            {!quarantineCandidates.length ? <div className="factor-phase2-empty">检疫队列为空；请先从挖掘候选送检。</div> : null}
            <ul className="factor-phase2-list">
              {quarantineCandidates.slice(0, 7).map((candidate) => {
                const decisionReason = candidateDecisionReason(candidate);
                return (
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
                        {decisionReason ? (
                          <small className="factor-factory-candidate-reason">
                            <b>{candidateDecisionReasonLabel(candidate)}</b>
                            {decisionReason}
                          </small>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
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

      <section className="factor-factory-gate-grid factor-factory-gate-grid--single" aria-label="检疫闸门详情">
        <article className="factor-phase2-panel">
          <div className="factor-phase2-panel__header">
            <div>
              <p className="factor-phase2-panel__eyebrow">PIT 证据链</p>
              <h2>PIT 诊断与发布审计</h2>
            </div>
            <span className={chipClass(pitMode)}>{statusLabel(pitMode)}</span>
          </div>
          <div className="factor-phase2-panel__body">
            <div className="factor-phase2-gate factor-phase2-gate--warn">
              <span className="factor-phase2-gate__status" />
              <div>
                <b>10Y 准入通过可送检/发布</b>
                <span>PIT 全量就绪缺口会进入诊断状态、因子级别、发布审计与风险提示；泄露、OOS 衰减、逻辑重复、残差信号失败和回撤超限仍是硬拒绝。</span>
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

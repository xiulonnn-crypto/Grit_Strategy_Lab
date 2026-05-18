import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApiClient } from '../lib/demoStoreContext';
import { formatDateTime } from '../lib/format';
import type {
  ApiFactorAdmissionReportRow,
  ApiFactorFactoryOverview,
  ApiFactorFactoryRun,
  ApiFactorFactoryTaskRow,
  ApiFactorMiningJobCreatePayload,
  ApiFactorOperatorChainStep,
  ApiFactorQuarantineCandidate,
  ApiFactorQuarantineResultRow,
  ApiFactorScoringCandidate,
  ApiPublishableFactorRow,
} from '../types';
import './factor-phase2-pages.css';

type FactorySection = 'overview' | 'sandbox' | 'quarantine';
type BusyAction = 'start' | 'pause' | 'run-now' | 'send' | 'publish' | 'search' | null;
type AnyRecord = Record<string, unknown>;

export type FactorFactoryPageProps = {
  initialSection?: FactorySection;
};

const DEFAULT_REQUEST: ApiFactorMiningJobCreatePayload = {
  universe: 'SP500',
  start_date: '2018-01-01',
  end_date: '2024-12-31',
  operators: ['return', 'winsorize', 'neutralize', 'zscore', 'rank'],
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

const L2_OPERATOR_CHAIN: ApiFactorOperatorChainStep[] = [
  { code: 'RAW', label: 'Raw' },
  { code: 'MAD', label: 'Winsorize' },
  { code: 'N', label: 'Neutralize' },
  { code: 'Z', label: 'Z-Score' },
  { code: 'R', label: 'Rank' },
];

function isRecord(value: unknown): value is AnyRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asList<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function record(value: unknown): AnyRecord {
  return isRecord(value) ? value : {};
}

function text(value: unknown, fallback = '未生成'): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function numeric(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pct(value: unknown, digits = 1): string {
  const parsed = numeric(value, NaN);
  if (!Number.isFinite(parsed)) return '未生成';
  const scaled = Math.abs(parsed) <= 1 ? parsed * 100 : parsed;
  return `${scaled.toFixed(digits)}%`;
}

function decimal(value: unknown, digits = 3): string {
  const parsed = numeric(value, NaN);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : '未生成';
}

function shortDate(value: unknown): string {
  const raw = text(value, '');
  if (!raw) return '未记录';
  return raw.includes('T') ? raw.split('T')[0] : raw.slice(0, 10);
}

function statusToken(value: unknown): string {
  return text(value, '').trim().toUpperCase();
}

function timestampValue(value: unknown): number {
  const parsed = Date.parse(text(value, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function taskSortTime(row: ApiFactorFactoryTaskRow): string {
  const raw = record(row);
  return text(raw.completed_at ?? raw.updated_at ?? raw.started_at ?? raw.task_date, '');
}

function sortByTimeDesc<T>(items: T[], getTime: (item: T) => unknown): T[] {
  return [...items].sort((left, right) => {
    const delta = timestampValue(getTime(right)) - timestampValue(getTime(left));
    if (delta !== 0) return delta;
    return text((right as AnyRecord).id ?? (right as AnyRecord).candidate_id, '')
      .localeCompare(text((left as AnyRecord).id ?? (left as AnyRecord).candidate_id, ''));
  });
}

function candidateEventTime(candidate: ApiFactorQuarantineCandidate | undefined | null): string {
  if (!candidate) return '';
  const latestRun = record(candidate.latest_run);
  return text(
    latestRun.completed_at
      ?? latestRun.created_at
      ?? (candidate as AnyRecord).last_quarantine_at
      ?? candidate.updated_at
      ?? candidate.created_at,
    '',
  );
}

function displayScore(value: unknown): string {
  const parsed = numeric(value, NaN);
  if (!Number.isFinite(parsed)) return 'N/A';
  return Math.abs(parsed) <= 1 ? String(Math.round(parsed * 100)) : parsed.toFixed(0);
}

function chipTone(value: unknown): 'good' | 'warn' | 'bad' | 'info' {
  const status = statusToken(value);
  if (['ACTIVE', 'COMPLETED', 'PASSED', 'PASS', 'ELIGIBLE', 'PUBLISHED', '已完成'].includes(status)) return 'good';
  if (['REJECTED', 'BLOCKED', 'FAILED', 'FAIL'].includes(status)) return 'bad';
  if (['RUNNING', 'QUEUED', '进行中'].includes(status)) return 'info';
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
    QUEUED: '待开始',
    RUNNING: '进行中',
    CANCEL_REQUESTED: '取消中',
    CANCELLED: '已取消',
    COMPLETED: '已完成',
    FAILED: '失败',
    PENDING: 'WARN',
    PASSED: 'PASS',
    REJECTED: 'FAIL',
    NEEDS_REVIEW: 'WARN',
    PUBLISHED: 'PASS',
    ELIGIBLE: '可发布',
    BLOCKED: '阻断',
    MANUAL_REVIEW_REQUIRED: '需人工裁决',
    DIAGNOSTIC_ONLY: '诊断证据',
  };
  return labels[status] ?? text(value);
}

function targetLayer(candidate: ApiFactorQuarantineCandidate | ApiFactorScoringCandidate | ApiPublishableFactorRow): string {
  return text((candidate as { target_layer?: unknown }).target_layer, 'L2');
}

function displayLayerText(value: unknown, fallback = '未生成'): string {
  return text(value, fallback).replace(/\bL([1-3])\b/g, 'F$1');
}

function displayTargetLayer(value: unknown): string {
  return displayLayerText(text(value, 'L2'));
}

function requestFromOverview(overview: ApiFactorFactoryOverview | null): ApiFactorMiningJobCreatePayload {
  const request = overview?.profile?.request ?? overview?.latest_run?.request ?? DEFAULT_REQUEST;
  return {
    ...DEFAULT_REQUEST,
    ...request,
    operators: Array.isArray(request.operators) && request.operators.length ? request.operators.map(String) : DEFAULT_REQUEST.operators,
    source_factor_ids: Array.isArray(request.source_factor_ids) && request.source_factor_ids.length
      ? request.source_factor_ids.map(String)
      : DEFAULT_REQUEST.source_factor_ids,
    recipe_families: Array.isArray(request.recipe_families) && request.recipe_families.length
      ? request.recipe_families.map(String)
      : DEFAULT_REQUEST.recipe_families,
    composition_policy: isRecord(request.composition_policy)
      ? request.composition_policy
      : DEFAULT_REQUEST.composition_policy,
  };
}

function buildTaskRows(overview: ApiFactorFactoryOverview | null): ApiFactorFactoryTaskRow[] {
  const rows = asList<ApiFactorFactoryTaskRow>(overview?.task_rows);
  if (rows.length) return sortByTimeDesc(rows, taskSortTime);
  const run = overview?.latest_run;
  const date = shortDate(run?.run_date ?? new Date().toISOString());
  const count = asList(record(run?.mining_job).top_candidates).length;
  const status = run ? statusLabel(run.status) : '待开始';
  return sortByTimeDesc([
    {
      id: `${date}-mining`,
      task_date: date,
      kind: 'mining',
      title: `${date} PIT 原子信号挖掘`,
      summary: 'PIT 原始字段可留在 F1；Return/MA/Std 等算子候选进入 F2 Raw Signal。',
      status,
      target_layer: 'L2',
      current_candidate_count: count,
      delivered_candidate_count: status === '已完成' ? count : null,
      expected_candidate_count: numeric(overview?.profile?.request?.candidate_count, DEFAULT_REQUEST.candidate_count),
    },
    {
      id: `${date}-refinement`,
      task_date: date,
      kind: 'refinement',
      title: `${date} Raw 标准链改造`,
      summary: 'Raw -> Winsorize -> Neutralize -> Z-Score -> Rank。',
      status,
      target_layer: 'L2',
      operator_chain: L2_OPERATOR_CHAIN,
      current_candidate_count: 0,
      delivered_candidate_count: 0,
    },
    {
      id: `${date}-composition`,
      task_date: date,
      kind: 'composition',
      title: `${date} F3 组合因子生成`,
      summary: '风格复合、风险调节、估值锚定、背离惩罚、残差/中性化、时序降噪。',
      status,
      target_layer: 'L3',
      current_candidate_count: 0,
      delivered_candidate_count: 0,
      parent_factor_ids: overview?.profile?.request?.source_factor_ids ?? [],
    },
  ], taskSortTime);
}

function scoringFromCandidate(candidate: ApiFactorQuarantineCandidate): ApiFactorScoringCandidate {
  const submittedAt = candidateEventTime(candidate) || text(candidate.created_at, '');
  const detail = isRecord(candidate.scoring_detail) ? candidate.scoring_detail as ApiFactorScoringCandidate : null;
  if (detail) return {
    ...detail,
    candidate_id: candidate.id,
    display_id: candidate.expression,
    target_layer: targetLayer(candidate),
    submitted_at: submittedAt,
    quarantine_candidate_id: candidate.id,
    quarantine_result: candidate.quarantine_result,
  };
  const metrics = record(candidate.candidate_metrics);
  return {
    candidate_id: candidate.id,
    display_id: candidate.expression,
    target_layer: targetLayer(candidate),
    submitted_at: submittedAt,
    score: numeric(metrics.fitness_score ?? metrics.score ?? metrics.rank_ic, 0),
    status: text(candidate.quarantine_result, 'WARN'),
    collapsed_by_default: true,
    detail_modal_enabled: true,
    predictive_power: {
      rank_ic: metrics.rank_ic,
      rank_icir: metrics.ir,
      monotonicity_score: metrics.monotonicity_score,
    },
    stability_turnover: {
      turnover_rate_weekly: metrics.turnover,
    },
    risk_orthogonality: {
      style_corr: metrics.max_style_correlation,
      max_drawdown: metrics.max_drawdown_pct,
    },
    data_health: {
      coverage: metrics.coverage,
      missing_data_ratio: metrics.missing_data_ratio,
    },
  };
}

function quarantineRowFromCandidate(candidate: ApiFactorQuarantineCandidate): ApiFactorQuarantineResultRow {
  return {
    candidate_id: candidate.id,
    submitted_at: candidateEventTime(candidate) || text(candidate.created_at, ''),
    factor_name: candidate.expression,
    target_layer: targetLayer(candidate),
    quarantine_result: text(candidate.quarantine_result, statusToken(candidate.status) === 'REJECTED' ? 'FAIL' : 'WARN'),
    reason_summary: text(candidate.reason_summary ?? candidate.rejected_reason ?? candidate.publish_eligibility?.reason, '等待检疫或人工复核。'),
    detail_modal_enabled: true,
  };
}

function publishableFromCandidate(candidate: ApiFactorQuarantineCandidate): ApiPublishableFactorRow | null {
  if (statusToken(candidate.status) !== 'PASSED' || statusToken(candidate.publish_status) !== 'ELIGIBLE') return null;
  return {
    candidate_id: candidate.id,
    factor_id: text(candidate.target_factor_id ?? candidate.id),
    factor_name: candidate.expression,
    target_layer: targetLayer(candidate) as ApiPublishableFactorRow['target_layer'],
    score: numeric(record(candidate.scoring_detail).score ?? record(candidate.candidate_metrics).score, 0),
    quarantine_status: 'PASS',
    parent_factor_ids: asList<string>(record(candidate.candidate_metrics).source_factor_ids).map(String),
    operator_chain: candidate.operator_chain ?? [],
    composition_methods: candidate.composition_methods ?? [],
    investment_logic: candidate.investment_logic,
    detail_modal_enabled: true,
  };
}

function metricPairs(detail: ApiFactorScoringCandidate | undefined): Array<[string, unknown, string]> {
  const predictive = record(detail?.predictive_power);
  const stability = record(detail?.stability_turnover);
  const risk = record(detail?.risk_orthogonality);
  const health = record(detail?.data_health);
  if (String(detail?.target_layer ?? '').toUpperCase() === 'L1') {
    return [
      ['PIT 准入审计', displayLayerText(detail?.gate_basis, 'PIT 准入审计'), '通过'],
      ['数据覆盖率', health.coverage, '覆盖充分'],
      ['缺失率', health.missing_data_ratio, '仅作数据质量校准'],
      ['水源角色', text(detail?.factor_id ?? detail?.name, 'F1 原始因子'), '不参与 RankIC 优选'],
    ];
  }
  return [
    ['RankIC', predictive.rank_ic, '> 0.025'],
    ['RankICIR', predictive.rank_icir, '> 1.5'],
    ['单调性', predictive.monotonicity_score, 'Q1-Q5 稳定'],
    ['自相关', stability.autocorrelation, '稳定性'],
    ['IC Decay T+1', stability.ic_decay_t1, '预测衰减'],
    ['IC Decay T+5', stability.ic_decay_t5, '预测衰减'],
    ['IC Decay T+21', stability.ic_decay_t21, '预测衰减'],
    ['Turnover_Rate', stability.turnover_rate_weekly, '< 20% 单周'],
    ['Style_Corr', risk.style_corr, '< 0.3'],
    ['Specific IC', risk.specific_ic, '增量信息'],
    ['Incremental IR', risk.incremental_ir, '> 0.05'],
    ['Max_Drawdown', risk.max_drawdown, '< 15%'],
    ['Coverage', health.coverage, '> 95%'],
    ['Missing Data Ratio', health.missing_data_ratio, '< 1%'],
  ];
}

function chainLabel(chain: ApiFactorOperatorChainStep[] | undefined): string {
  const labels = asList<ApiFactorOperatorChainStep>(chain).map((step) => step.label || step.code).filter(Boolean);
  return labels.length ? labels.join(' -> ') : '未记录';
}

export default function FactorFactoryPage({ initialSection: _initialSection = 'overview' }: FactorFactoryPageProps): JSX.Element {
  const api = useApiClient();
  const [overview, setOverview] = useState<ApiFactorFactoryOverview | null>(null);
  const [loading, setLoading] = useState(Boolean(api.getFactorFactoryOverview));
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detailCandidateId, setDetailCandidateId] = useState<string | null>(null);
  const [filters, setFilters] = useState({ date: '', factorName: '', result: 'ALL' });
  const [autoFilterDate, setAutoFilterDate] = useState('');
  const [searchedRows, setSearchedRows] = useState<ApiFactorQuarantineResultRow[] | null>(null);

  const loadOverview = useCallback(async (): Promise<void> => {
    if (!api.getFactorFactoryOverview) {
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

  const quarantineCandidates = useMemo(
    () => asList<ApiFactorQuarantineCandidate>(overview?.quarantine?.items),
    [overview],
  );
  const taskRows = useMemo(() => buildTaskRows(overview), [overview]);
  const quarantineCandidateById = useMemo(() => {
    const entries = quarantineCandidates.map((candidate) => [text(candidate.id, ''), candidate] as const);
    return new Map(entries.filter(([id]) => Boolean(id)));
  }, [quarantineCandidates]);
  const scoringCandidates = useMemo<ApiFactorScoringCandidate[]>(() => {
    const direct = asList<ApiFactorScoringCandidate>(overview?.scoring_candidates);
    const rows: ApiFactorScoringCandidate[] = direct.map((candidate): ApiFactorScoringCandidate => {
        const quarantineId = text(candidate.quarantine_candidate_id ?? candidate.candidate_id, '');
        const source = quarantineCandidateById.get(quarantineId);
        return {
          ...candidate,
          quarantine_candidate_id: quarantineId || candidate.quarantine_candidate_id,
          submitted_at: candidateEventTime(source) || text(candidate.submitted_at, ''),
        };
      });
    return sortByTimeDesc(rows, (candidate) => candidate.submitted_at);
  }, [overview, quarantineCandidateById]);
  const quarantineRows = useMemo(() => {
    const direct = asList<ApiFactorQuarantineResultRow>(overview?.quarantine_result_rows);
    const rows = direct.length
      ? direct.map((row) => {
        const source = quarantineCandidateById.get(text(row.candidate_id, ''));
        return {
          ...row,
          submitted_at: candidateEventTime(source) || text(row.submitted_at, ''),
        };
      })
      : quarantineCandidates.map(quarantineRowFromCandidate);
    return sortByTimeDesc(rows, (row) => row.submitted_at);
  }, [overview, quarantineCandidates, quarantineCandidateById]);
  const publishableFactors = useMemo(() => {
    const direct = asList<ApiPublishableFactorRow>(overview?.publishable_factors);
    if (direct.length) return direct;
    return quarantineCandidates.map(publishableFromCandidate).filter((item): item is ApiPublishableFactorRow => Boolean(item));
  }, [overview, quarantineCandidates]);
  const renderedQuarantineRows = searchedRows ?? quarantineRows;
  const latestSubmittedDate = shortDate(scoringCandidates[0]?.submitted_at ?? quarantineRows[0]?.submitted_at ?? '');
  const detailCandidate = quarantineCandidates.find((candidate) => candidate.id === detailCandidateId) ?? null;
  const detailScoring = detailCandidate ? scoringFromCandidate(detailCandidate) : undefined;
  const detailReport = asList<ApiFactorAdmissionReportRow>(detailCandidate?.admission_report);
  const latestRun = overview?.latest_run ?? null;

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(latestSubmittedDate)) return;
    setFilters((current) => {
      if (current.date && current.date !== autoFilterDate) return current;
      if (current.date === latestSubmittedDate) return current;
      return { ...current, date: latestSubmittedDate };
    });
    setAutoFilterDate(latestSubmittedDate);
  }, [autoFilterDate, latestSubmittedDate]);

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
        timezone: overview?.profile?.timezone ?? 'Asia/Hong_Kong',
        schedule_time: '14:00',
        request: requestFromOverview(overview),
        gate_policy: overview?.gate_policy ?? overview?.profile?.gate_policy,
      });
      setOverview(payload);
      setNotice('每日自动化已启动；GMT+8 14:00 运行，并自动送检与执行检疫。');
    });
  };

  const pauseAutomation = (): void => {
    void withBusy('pause', async () => {
      if (!api.pauseFactorFactoryAutomation) throw new Error('暂停自动化 API 尚未接入。');
      setOverview(await api.pauseFactorFactoryAutomation());
      setNotice('每日自动化已暂停；已存在的历史 run 不会被删除。');
    });
  };

  const runNow = (): void => {
    void withBusy('run-now', async () => {
      if (!api.runFactorFactoryNow) throw new Error('立即运行 API 尚未接入。');
      const payload = await api.runFactorFactoryNow({
        request: requestFromOverview(overview),
        gate_policy: overview?.gate_policy ?? overview?.profile?.gate_policy,
        pipeline_scope: 'B1_B2_B3_B4',
      });
      setOverview(payload);
      setNotice('已创建临时 B1-B4 批次；每日自动化状态保持不变。');
    });
  };

  const sendAllToQuarantine = (): void => {
    void withBusy('send', async () => {
      if (!api.factorQuarantineIntake) throw new Error('检疫接收 API 尚未接入。');
      if (!api.runFactorQuarantineCandidate) throw new Error('检疫执行 API 尚未接入。');
      const miningJobId = text(latestRun?.mining_job_id, '');
      const intake = await api.factorQuarantineIntake({ mining_job_id: miningJobId || undefined });
      const items = asList<ApiFactorQuarantineCandidate>(intake.items);
      await Promise.all(items.map((item) => api.runFactorQuarantineCandidate!(
        item.id,
        { reason: 'factor_factory_bulk_send_to_quarantine' },
      )));
      await loadOverview();
      setNotice(`一键送检已完成：${items.length} 个候选进入检疫并执行准入检测。`);
    });
  };

  const publishAll = (): void => {
    void withBusy('publish', async () => {
      if (!api.publishFactorQuarantineCandidate) throw new Error('发布 API 尚未接入。');
      const ids = publishableFactors.map((item) => text(item.candidate_id, '')).filter(Boolean);
      await ids.reduce(
        (chain, id) => chain.then(() => api.publishFactorQuarantineCandidate!(id, { operator: 'system_rule' })),
        Promise.resolve<unknown>(undefined),
      );
      await loadOverview();
      setNotice(`一键发布已完成：${ids.length} 个因子写入 F2/F3 发布审计。`);
    });
  };

  const searchQuarantine = (): void => {
    void withBusy('search', async () => {
      if (api.listFactorQuarantineCandidates) {
        const payload = await api.listFactorQuarantineCandidates({
          date: filters.date || undefined,
          factor_name: filters.factorName || undefined,
          result: filters.result,
        });
        setSearchedRows(sortByTimeDesc(payload.items.map(quarantineRowFromCandidate), (row) => row.submitted_at));
      } else {
        setSearchedRows(null);
      }
    });
  };

  return (
    <main
      className="factor-phase2-page factor-factory-page factor-factory-b1b4-page"
      data-page-root="factor-factory"
      data-initial-section={_initialSection}
    >
      <section className="factor-phase2-hero factor-factory-hero">
        <div>
          <p className="factor-phase2-hero__eyebrow">闭环因子工厂</p>
          <h1>因子任务生产台</h1>
          <p>
            按 B1 挖掘、B2 改造、B3 组合、B4 检疫发布组织因子生产；候选先完成打分送检，
            再由检疫准入报告决定是否一键发布到 F2 或 F3。
          </p>
        </div>
        <div className="factor-phase2-actions">
          <button className="factor-phase2-button factor-phase2-button--primary" disabled={busy !== null || loading} type="button" onClick={startAutomation}>
            {busy === 'start' ? '启动中...' : '启动自动化'}
          </button>
          <button className="factor-phase2-button" disabled={busy !== null || loading} type="button" onClick={pauseAutomation}>
            {busy === 'pause' ? '暂停中...' : '暂停自动化'}
          </button>
          <button className="factor-phase2-button" disabled={busy !== null || loading} type="button" onClick={runNow}>
            {busy === 'run-now' ? '运行中...' : '立即运行'}
          </button>
        </div>
      </section>

      <section className="factor-factory-status-strip" aria-label="因子工厂状态">
        <span className={chipClass(overview?.profile?.status ?? 'PAUSED')}>{statusLabel(overview?.profile?.status ?? 'PAUSED')}</span>
        <span>每日计划：GMT+8 14:00</span>
        <span>检疫与发布</span>
        <span>下次批次：{overview?.profile?.next_run_at ? formatDateTime(overview.profile.next_run_at) : '等待启动'}</span>
        <span>立即运行：不改变自动化状态</span>
        <span className={chipClass('DIAGNOSTIC_ONLY')}>PIT 非 Full Ready 仅进入诊断/风险提示</span>
      </section>

      {error ? <div className="factor-phase2-empty factor-phase2-empty--danger">{error}</div> : null}
      {notice ? <div className="factor-phase2-empty factor-factory-notice">{notice}</div> : null}

      {publishableFactors.length > 0 ? (
        <section className="factor-phase2-panel factor-factory-publish-queue" aria-label="可发布因子名单">
          <div className="factor-phase2-panel__header">
            <div>
              <p className="factor-phase2-panel__eyebrow">B4 发布准入</p>
              <h2>可发布因子名单</h2>
            </div>
            <button className="factor-phase2-button factor-phase2-button--primary" disabled={busy !== null} type="button" onClick={publishAll}>
              {busy === 'publish' ? '发布中...' : '一键发布'}
            </button>
          </div>
          <div className="factor-factory-publish-list">
            {publishableFactors.map((item) => (
              <article className="factor-factory-publish-card" key={text(item.candidate_id ?? item.factor_id)}>
                <div>
                  <span className={chipClass(item.quarantine_status)}>{item.quarantine_status}</span>
                  <span className="factor-phase2-chip factor-phase2-chip--info">{displayTargetLayer(item.target_layer)}</span>
                </div>
                <strong>{text(item.factor_name ?? item.factor_id)}</strong>
                <small>
                  {item.target_layer === 'L3'
                    ? `组合逻辑：${asList<{ label?: string }>(item.composition_methods).map((method) => method.label).filter(Boolean).join(' / ') || '未记录'}`
                    : `算子链：${chainLabel(item.operator_chain)}`}
                </small>
                <button className="factor-phase2-button factor-phase2-button--small" type="button" onClick={() => setDetailCandidateId(text(item.candidate_id, ''))}>
                  详情
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="factor-phase2-metrics factor-factory-funnel" aria-label="因子工厂摘要">
        {[
          ['任务池', taskRows.length, 'B1/B2/B3 任务'],
          ['候选交付', numeric(overview?.task_summary?.delivered_candidates, scoringCandidates.length), '最终交付候选因子数'],
          ['已送检', numeric(overview?.task_summary?.submitted_to_quarantine, quarantineRows.length), '进入 B3 检疫'],
          ['发布准入', publishableFactors.length, 'F2/F3 可发布'],
          ['历史拒绝', numeric(overview?.task_summary?.rejected_history_count, quarantineRows.filter((row) => row.quarantine_result === 'FAIL').length), '可检索原因'],
          ['硬阻断', numeric(overview?.task_summary?.hard_blocked_count, 0), '不可发布'],
        ].map(([label, value, hint]) => (
          <div className="factor-phase2-metric" key={String(label)}>
            <p className="factor-phase2-metric__label">{label}</p>
            <p className="factor-phase2-metric__value">{value}</p>
            <p className="factor-phase2-metric__hint">{hint}</p>
          </div>
        ))}
      </section>

      <section className="factor-factory-workbench factor-factory-workbench--b1b4">
        <article className="factor-phase2-panel factor-factory-fixed-panel" data-factory-section="tasks">
          <div className="factor-phase2-panel__header">
            <div>
              <p className="factor-phase2-panel__eyebrow">B1 因子任务</p>
              <h2>因子任务</h2>
            </div>
            <span className="factor-phase2-chip factor-phase2-chip--info">{taskRows.length} 类任务</span>
          </div>
          <div className="factor-phase2-panel__body factor-factory-scroll-body">
            <div className="factor-factory-task-family-tabs" aria-label="因子任务类型">
              <article className="factor-factory-family-tab is-active">
                <strong>因子挖掘类</strong>
                <small>F1 仅保留原始字段；出现 Return/MA/Std 等算子即作为 F2 Raw Signal 送检。</small>
              </article>
              <article className="factor-factory-family-tab">
                <strong>因子改造类</strong>
                <small>基于 F1 执行 MAD、残差/中性化、ZScore、TsRank/Rank 算子链。</small>
              </article>
              <article className="factor-factory-family-tab">
                <strong>因子组合类</strong>
                <small>从已准入 F2 或豁免来源构建 F3 组合候选。</small>
              </article>
            </div>
            {taskRows.map((task) => (
              <article className="factor-factory-task-card" key={task.id}>
                <div className="factor-phase2-row__top">
                  <div>
                    <h3>{displayLayerText(task.title)}</h3>
                    <small>{displayLayerText(task.summary)}</small>
                  </div>
                  <span className={chipClass(task.status)}>{task.status}</span>
                </div>
                <div className="factor-factory-task-meta" aria-label="任务交付摘要">
                  <span>{displayTargetLayer(task.target_layer)}</span>
                  <span>{task.current_candidate_count ?? 0} 当前候选</span>
                  <strong>{task.delivered_candidate_count ?? task.current_candidate_count ?? 0} 交付候选</strong>
                </div>
              </article>
            ))}
          </div>
        </article>

        <article className="factor-phase2-panel factor-factory-fixed-panel" data-factory-section="scoring">
          <div className="factor-phase2-panel__header">
            <div>
              <p className="factor-phase2-panel__eyebrow">B2 因子打分</p>
              <h2>因子打分</h2>
            </div>
            <span className="factor-phase2-chip factor-phase2-chip--info">默认收起</span>
          </div>
          <div className="factor-phase2-panel__body factor-factory-scroll-body factor-factory-panel-with-footer">
            {!scoringCandidates.length ? <div className="factor-phase2-empty">暂无待送检候选；已送检因子已移至 B3 因子检疫列表。</div> : null}
            {scoringCandidates.map((candidate) => (
              <article className="factor-factory-score-card is-collapsed" key={candidate.candidate_id}>
                <div className="factor-factory-score-card__head">
                  <div>
                    <strong>{candidate.display_id}</strong>
                    <small>{shortDate(candidate.submitted_at)} · {displayTargetLayer(candidate.target_layer)} · 分数 {displayScore(candidate.score)}</small>
                  </div>
                  <b>{displayScore(candidate.score)}</b>
                </div>
                <div className="factor-factory-score-card__chips">
                  <span className={chipClass(candidate.status ?? candidate.quarantine_result)}>{candidate.status ?? candidate.quarantine_result ?? 'WARN'}</span>
                  <span className="factor-phase2-chip factor-phase2-chip--info">
                    {candidate.target_layer === 'L1'
                      ? displayLayerText(candidate.gate_basis, 'PIT 准入审计')
                      : `RankIC ${decimal(record(candidate.predictive_power).rank_ic)}`}
                  </span>
                  <span className="factor-phase2-chip factor-phase2-chip--info">Coverage {pct(record(candidate.data_health).coverage)}</span>
                </div>
                <button className="factor-phase2-button factor-phase2-button--small" type="button" onClick={() => setDetailCandidateId(text(candidate.quarantine_candidate_id ?? candidate.candidate_id, ''))}>
                  详情
                </button>
              </article>
            ))}
          </div>
          <div className="factor-factory-panel-action-bar">
            <button className="factor-phase2-button factor-phase2-button--primary" disabled={busy !== null || loading || scoringCandidates.length === 0} type="button" onClick={sendAllToQuarantine}>
              {busy === 'send' ? '送检中...' : '一键送检'}
            </button>
          </div>
        </article>

        <article className="factor-phase2-panel factor-factory-fixed-panel" data-factory-section="quarantine">
          <div className="factor-phase2-panel__header">
            <div>
              <p className="factor-phase2-panel__eyebrow">B3 因子检疫</p>
              <h2>因子检疫</h2>
            </div>
            <span className="factor-phase2-chip factor-phase2-chip--info">显示 {renderedQuarantineRows.length}/{quarantineRows.length}</span>
          </div>
          <div className="factor-phase2-panel__body factor-factory-scroll-body">
            <div className="factor-factory-filter-row" aria-label="历史检疫筛选">
              <label>
                日期
                <input type="date" value={filters.date} onChange={(event) => setFilters((current) => ({ ...current, date: event.target.value }))} />
              </label>
              <label>
                因子名
                <input type="text" value={filters.factorName} onChange={(event) => setFilters((current) => ({ ...current, factorName: event.target.value }))} />
              </label>
              <label>
                结果
                <select value={filters.result} onChange={(event) => setFilters((current) => ({ ...current, result: event.target.value }))}>
                  <option value="ALL">全部结果</option>
                  <option value="PASS">PASS</option>
                  <option value="WARN">WARN</option>
                  <option value="FAIL">FAIL</option>
                </select>
              </label>
              <button className="factor-phase2-button factor-phase2-button--small" disabled={busy !== null} type="button" onClick={searchQuarantine}>
                查询
              </button>
            </div>
            <div className="factor-factory-result-table" role="table" aria-label="因子检疫结果列表">
              <div className="factor-factory-result-row factor-factory-result-row--head" role="row">
                <span role="columnheader">日期</span>
                <span role="columnheader">因子名</span>
                <span role="columnheader">结果</span>
                <span role="columnheader">原因</span>
                <span role="columnheader">操作</span>
              </div>
              {!renderedQuarantineRows.length ? <div className="factor-phase2-empty">没有匹配的检疫历史记录。</div> : null}
              {renderedQuarantineRows.map((row) => (
                <div className="factor-factory-result-row" role="row" key={row.candidate_id}>
                  <span role="cell">{shortDate(row.submitted_at)}</span>
                  <span role="cell">{row.factor_name}</span>
                  <span role="cell"><i className={chipClass(row.quarantine_result)}>{row.quarantine_result}</i></span>
                  <span role="cell">{displayLayerText(row.reason_summary)}</span>
                  <span role="cell">
                    <button className="factor-phase2-button factor-phase2-button--small" type="button" onClick={() => setDetailCandidateId(row.candidate_id)}>
                      详情
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </article>
      </section>

      <section className="factor-factory-admission-rules" aria-label="发布准入规则">
        <article>
          <h3>F2 改造库</h3>
          <p>改造因子检疫通过后发布入 F2，必须保留 TRANSFORMED_FROM 血缘和 Raw {'->'} Winsorize {'->'} Neutralize {'->'} Z-Score {'->'} Rank。</p>
        </article>
        <article>
          <h3>F3 组合库</h3>
          <p>组合因子检疫通过后发布入 F3，必须保留父因子、投资逻辑、组合手段和相关性/正交性审计。</p>
        </article>
        <article>
          <h3>历史检疫</h3>
          <p>历史拒绝因子与原因可搜索，失败项不可发布，WARN 项需要带限制条件进入审计。</p>
        </article>
        <article>
          <h3>F1 原始数据</h3>
          <p>F1 仅限 Close、Open、Volume、MarketCap、Sector 等未经算子的事实字段；出现 Return、MA、Std 等算子即进入 F2 Raw Signal，并保留 WNZT 缺失与同族冗余提示。</p>
        </article>
      </section>

      {detailCandidate ? (
        <div className="factor-detail-modal-backdrop" role="presentation" onClick={() => setDetailCandidateId(null)}>
          <section className="factor-detail-modal" role="dialog" aria-modal="true" aria-labelledby="factor-detail-title" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <p className="factor-phase2-panel__eyebrow">{shortDate(candidateEventTime(detailCandidate))} · {displayTargetLayer(targetLayer(detailCandidate))}</p>
                <h2 id="factor-detail-title">{detailCandidate.expression}</h2>
              </div>
              <span className={chipClass(detailCandidate.quarantine_result)}>{detailCandidate.quarantine_result ?? statusLabel(detailCandidate.status)}</span>
              <button className="factor-phase2-button factor-phase2-button--small" type="button" onClick={() => setDetailCandidateId(null)}>关闭</button>
            </header>
            <div className="factor-detail-modal__body">
              <section>
                <h3>因子打分明细</h3>
                <div className="factor-detail-metric-grid">
                  {metricPairs(detailScoring).map(([name, value, threshold]) => {
                    const percentMetric = /Coverage|Turnover|Drawdown|Missing|覆盖率|缺失率/.test(name);
                    const parsedValue = numeric(value, NaN);
                    const displayValue = percentMetric
                      ? pct(value)
                      : Number.isFinite(parsedValue)
                        ? decimal(value)
                        : text(value, '未生成');
                    return (
                      <div className="factor-phase2-stat" key={name}>
                        <b>{displayValue}</b>
                        <span>{name} · {threshold}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="factor-detail-chip-row">
                  {asList<ApiFactorOperatorChainStep>(detailCandidate.operator_chain).map((step) => (
                    <span className="factor-phase2-chip factor-phase2-chip--info" key={step.code}>{step.label}</span>
                  ))}
                  {asList<{ key?: string; label?: string }>(detailCandidate.composition_methods).map((method) => (
                    <span className="factor-phase2-chip factor-phase2-chip--info" key={method.key ?? method.label}>{method.label}</span>
                  ))}
                </div>
              </section>
              <section>
                <h3>因子检疫明细</h3>
                <div className="factor-factory-report-table" role="table" aria-label="准入报告">
                  <div className="factor-factory-report-row factor-factory-report-row--head" role="row">
                    <span role="columnheader">检测项</span>
                    <span role="columnheader">结果</span>
                    <span role="columnheader">状态</span>
                    <span role="columnheader">Agent D 建议</span>
                  </div>
                  {detailReport.map((row) => (
                    <div className="factor-factory-report-row" role="row" key={row.check}>
                      <span role="cell">{displayLayerText(row.check)}</span>
                      <span role="cell">{displayLayerText(row.value_label ?? text(row.value))}</span>
                      <span role="cell"><i className={chipClass(row.status)}>{row.status}</i></span>
                      <span role="cell">{displayLayerText(row.agent_d_advice)}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

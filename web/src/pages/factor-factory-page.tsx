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
  ApiFactorFactoryOperatorConfigResponse,
  ApiOperatorConfigDraft,
  ApiOperatorConfigSnapshot,
  ApiPublishableFactorRow,
} from '../types';
import './factor-phase2-pages.css';

type FactorySection = 'overview' | 'sandbox' | 'quarantine';
type BusyAction = 'start' | 'pause' | 'run-now' | 'send' | 'publish' | 'search' | null;
type AnyRecord = Record<string, unknown>;
type QuarantineFilters = { date: string; factorName: string; result: string };
type FactorFactoryMetricCard = {
  key: string;
  label: string;
  value: number | string;
  hint: string;
  tooltip: string;
};

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

function filterQuarantineRows(
  rows: ApiFactorQuarantineResultRow[],
  filters: QuarantineFilters,
): ApiFactorQuarantineResultRow[] {
  const date = filters.date.trim();
  const factorName = filters.factorName.trim().toLowerCase();
  const result = statusToken(filters.result || 'ALL');
  return rows.filter((row) => {
    if (date && shortDate(row.submitted_at) !== date) return false;
    if (factorName) {
      const haystack = [
        row.factor_name,
        row.candidate_id,
        row.reason_summary,
      ].map((value) => text(value, '').toLowerCase()).join(' ');
      if (!haystack.includes(factorName)) return false;
    }
    if (result && result !== 'ALL' && statusToken(row.quarantine_result) !== result) return false;
    return true;
  });
}

function filterQuarantineRowsByDate(
  rows: ApiFactorQuarantineResultRow[],
  date: string,
): ApiFactorQuarantineResultRow[] {
  const normalizedDate = date.trim();
  if (!normalizedDate) return rows;
  return rows.filter((row) => shortDate(row.submitted_at) === normalizedDate);
}

function countQuarantineRowsByResult(
  rows: ApiFactorQuarantineResultRow[],
  result: string,
): number {
  const normalizedResult = statusToken(result);
  return rows.filter((row) => statusToken(row.quarantine_result) === normalizedResult).length;
}

function taskKind(row: ApiFactorFactoryTaskRow): string {
  return statusToken(row.kind).toLowerCase();
}

function targetLayerToken(value: unknown): string {
  return statusToken(value).replace(/^F/, 'L');
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
  if (['已完成', 'PASS', 'PASSED', 'ELIGIBLE', 'PUBLISHED'].includes(status)) return 'good';
  if (['待开始', '运行中', 'QUEUED', 'RUNNING'].includes(status)) return 'info';
  if (['失败', '阻断', 'REJECTED', 'BLOCKED', 'FAILED', 'FAIL'].includes(status)) return 'bad';
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
  const readableLabels: Record<string, string> = {
    ACTIVE: '自动运行',
    PAUSED: '已暂停',
    QUEUED: '待开始',
    RUNNING: '运行中',
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
    MANUAL_REVIEW_REQUIRED: '人工复核',
    DIAGNOSTIC_ONLY: '诊断模式',
  };
  return readableLabels[status] ?? labels[status] ?? text(value);
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

const DEFAULT_OPERATOR_CONFIG_DRAFT: ApiOperatorConfigDraft = {
  enabled_operators: ['TS_Return', 'TS_Rank', 'TS_Corr'],
  window_space: [3, 5, 10, 21, 63, 126, 252],
  default_depth: 2,
  daily_formula_budget: 10000,
  compute_backend: 'pandas_bottleneck',
  min_periods_policy: 'TS 默认 min_periods=n；TS_Return 需要 n+1 个有效观测，不足输出 NaN。',
  blocked_field_policy: '排除 DATA_SOURCE_BLOCKED 字段；缺失 L1 保持 NaN。',
  governance_protocol: {
    wnzt_standard_flow: true,
    winsorize_enabled: true,
    neutralize_enabled: true,
    zscore_enabled: true,
    ts_smooth_enabled: true,
    orthogonalization_enabled: false,
    turnover_filter_enabled: false,
  },
  notes: 'Phase 0 默认草稿',
  f1_catalog_snapshot_id: null,
  created_by: 'ui',
};

type FactoryConfigTab = 'operators' | 'governance' | 'gates' | 'evidence' | 'snapshots';

const FACTORY_CONFIG_TABS: Array<{ key: FactoryConfigTab; label: string }> = [
  { key: 'operators', label: '算子注册' },
  { key: 'governance', label: '治理协议' },
  { key: 'gates', label: '准入闸门' },
  { key: 'evidence', label: 'WNZT 证据与检疫裁决' },
  { key: 'snapshots', label: '配置快照' },
];

function cloneGovernanceProtocol(source: ApiOperatorConfigDraft['governance_protocol']): NonNullable<ApiOperatorConfigDraft['governance_protocol']> {
  const defaults = DEFAULT_OPERATOR_CONFIG_DRAFT.governance_protocol ?? {};
  return {
    wnzt_standard_flow: source?.wnzt_standard_flow ?? defaults.wnzt_standard_flow ?? true,
    winsorize_enabled: source?.winsorize_enabled ?? defaults.winsorize_enabled ?? true,
    neutralize_enabled: source?.neutralize_enabled ?? defaults.neutralize_enabled ?? true,
    zscore_enabled: source?.zscore_enabled ?? defaults.zscore_enabled ?? true,
    ts_smooth_enabled: source?.ts_smooth_enabled ?? defaults.ts_smooth_enabled ?? true,
    orthogonalization_enabled: source?.orthogonalization_enabled ?? defaults.orthogonalization_enabled ?? false,
    turnover_filter_enabled: source?.turnover_filter_enabled ?? defaults.turnover_filter_enabled ?? false,
  };
}

function cloneOperatorDraft(source: ApiOperatorConfigDraft | undefined | null): ApiOperatorConfigDraft {
  const draft = source ?? DEFAULT_OPERATOR_CONFIG_DRAFT;
  return {
    enabled_operators: Array.isArray(draft.enabled_operators) ? [...draft.enabled_operators] : [...DEFAULT_OPERATOR_CONFIG_DRAFT.enabled_operators],
    window_space: Array.isArray(draft.window_space) ? draft.window_space.map((value) => Number(value)).filter(Number.isFinite) : [...DEFAULT_OPERATOR_CONFIG_DRAFT.window_space],
    default_depth: numeric(draft.default_depth, DEFAULT_OPERATOR_CONFIG_DRAFT.default_depth),
    daily_formula_budget: numeric(draft.daily_formula_budget, DEFAULT_OPERATOR_CONFIG_DRAFT.daily_formula_budget),
    compute_backend: text(draft.compute_backend, DEFAULT_OPERATOR_CONFIG_DRAFT.compute_backend),
    min_periods_policy: text(draft.min_periods_policy, DEFAULT_OPERATOR_CONFIG_DRAFT.min_periods_policy),
    blocked_field_policy: text(draft.blocked_field_policy, DEFAULT_OPERATOR_CONFIG_DRAFT.blocked_field_policy),
    governance_protocol: cloneGovernanceProtocol(draft.governance_protocol),
    notes: text(draft.notes, ''),
    f1_catalog_snapshot_id: draft.f1_catalog_snapshot_id ?? null,
    created_by: text(draft.created_by, 'ui'),
  };
}

function snapshotLabel(snapshot: ApiOperatorConfigSnapshot | null | undefined): string {
  if (!snapshot?.snapshot_id) return '未生成';
  return snapshot.generated_at ? `${snapshot.snapshot_id} · ${formatDateTime(snapshot.generated_at)}` : snapshot.snapshot_id;
}

function normalizeWindowText(value: string): number[] {
  return value
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
}

type OperatorRegistryDisplayRow = {
  ids: string[];
  title: string;
  code: string;
  description: string;
  chips: string[];
};

const OPERATOR_REGISTRY_SECTIONS: Array<{
  key: string;
  title: string;
  status: string;
  statusTone: 'success' | 'blue';
  rows: OperatorRegistryDisplayRow[];
}> = [
  {
    key: 'ts',
    title: 'TS 时间序列类',
    status: '3 个启用',
    statusTone: 'success',
    rows: [
      {
        ids: ['TS_Return'],
        title: 'TS_Return',
        code: 'x_t / x_{t-n} - 1',
        description: 'n 日收益变动，输出标的 × 日期矩阵。',
        chips: ['n: 3-252', 'min=n'],
      },
      {
        ids: ['TS_Rank'],
        title: 'TS_Rank',
        code: 'rank(x_t, window=n)',
        description: '当前值在自身历史窗口中的分位。',
        chips: ['n: 5-252', 'min=ceil(n·0.6)'],
      },
      {
        ids: ['TS_Mean'],
        title: 'TS_Mean',
        code: 'mean(x, n)',
        description: '窗口均值，用于趋势平滑。',
        chips: ['n: 3-252', 'min=ceil(n·0.8)'],
      },
      {
        ids: ['TS_Max', 'TS_Min', 'TS_Delta'],
        title: 'TS_Max / TS_Min / TS_Delta',
        code: 'extreme_delta(x, n)',
        description: '窗口极值与端点变化，用于位置和突破诊断。',
        chips: ['n: 3-252', 'min=ceil(n·0.8)'],
      },
      {
        ids: ['TS_Std', 'TS_Skew', 'TS_Kurt'],
        title: 'TS_Std / TS_Skew / TS_Kurt',
        code: 'moment(x, n)',
        description: '波动、偏度与峰度，Phase 0 登记不启用。',
        chips: ['n: 21-252', 'min=ceil(n·0.8)'],
      },
    ],
  },
  {
    key: 'cross',
    title: 'CS / 多元 / 非线性 / 技术类',
    status: '16 个登记',
    statusTone: 'blue',
    rows: [
      {
        ids: ['TS_Corr'],
        title: 'TS_Corr',
        code: 'corr(x, y, n)',
        description: '两个 F1 字段的滚动相关。',
        chips: ['输入: x,y', 'min=ceil(n·0.8)'],
      },
      {
        ids: ['TS_Cov'],
        title: 'TS_Cov',
        code: 'cov(x, y, n)',
        description: '两个 F1 字段的滚动协方差。',
        chips: ['输入: x,y', 'min=ceil(n·0.8)'],
      },
      {
        ids: ['CS_Rank', 'CS_ZScore', 'CS_Scale', 'CS_Neutral'],
        title: 'CS_Rank / CS_ZScore / CS_Scale / CS_Neutral',
        code: 'cross_section(x)',
        description: '横截面排序、标准化和中性化。',
        chips: ['按交易日', 'min_symbols=30'],
      },
      {
        ids: ['Reg_Slope', 'Reg_Resid'],
        title: 'Reg_Slope / Reg_Resid',
        code: 'ols(y ~ x, n)',
        description: '滚动回归斜率与残差。',
        chips: ['n: 21-252', 'min=ceil(n·0.8)'],
      },
      {
        ids: ['Sign', 'Abs', 'Log', 'If_Then_Else', 'Signed_Power'],
        title: 'Sign / Abs / Log / Signed_Power',
        code: 'nonlinear(x)',
        description: '符号、尺度和尾部变换，先做输入域校验。',
        chips: ['无窗口', 'domain check'],
      },
      {
        ids: ['Decay_Linear', 'High_Day', 'Sum_Out_Of'],
        title: 'Decay_Linear / High_Day / Sum_Out_Of',
        code: 'technical(x, n)',
        description: '衰减、高点距离和条件计数。',
        chips: ['n: 3-252', 'min rule'],
      },
    ],
  },
];

function FactorFactoryConfigModal({
  payload,
  draft,
  loading,
  saving,
  error,
  notice,
  dirty,
  onDraftChange,
  onClose,
  onReload,
  onSave,
  onSnapshot,
}: {
  payload: ApiFactorFactoryOperatorConfigResponse | null;
  draft: ApiOperatorConfigDraft | null;
  loading: boolean;
  saving: 'save' | 'snapshot' | null;
  error: string | null;
  notice: string | null;
  dirty: boolean;
  onDraftChange: (draft: ApiOperatorConfigDraft) => void;
  onClose: () => void;
  onReload: () => void;
  onSave: () => void;
  onSnapshot: () => void;
}): JSX.Element {
  const registryItems = payload?.registry_items ?? [];
  const activeDraft = draft ?? cloneOperatorDraft(payload?.draft);
  const enabled = new Set(activeDraft.enabled_operators);
  const operatorTotal = Math.max(
    25,
    registryItems.length,
    payload?.latest_operator_config_snapshot?.operator_count ?? 0,
    activeDraft.enabled_operators.length,
  );
  const [activeTab, setActiveTab] = useState<FactoryConfigTab>('operators');
  const [operatorGroupFilter, setOperatorGroupFilter] = useState('all');
  const [operatorSearch, setOperatorSearch] = useState('');
  const protocol = cloneGovernanceProtocol(activeDraft.governance_protocol);
  const otClosed = !protocol.orthogonalization_enabled && !protocol.turnover_filter_enabled;
  const enabledOperatorSummary = activeDraft.enabled_operators.join('、') || '待启用';
  const windowSpaceText = `[${activeDraft.window_space.join(',')}]`;
  const normalizedOperatorSearch = operatorSearch.trim().toLowerCase();
  const operatorGroupOptions = [
    { value: 'all', label: '全部' },
    ...OPERATOR_REGISTRY_SECTIONS.map((section) => ({ value: section.key, label: section.title })),
  ];
  const filteredOperatorSections = OPERATOR_REGISTRY_SECTIONS
    .filter((section) => operatorGroupFilter === 'all' || section.key === operatorGroupFilter)
    .map((section) => ({
      ...section,
      rows: section.rows.filter((row) => {
        if (!normalizedOperatorSearch) return true;
        const haystack = [row.title, row.code, row.description, ...row.ids, ...row.chips].join(' ').toLowerCase();
        return haystack.includes(normalizedOperatorSearch);
      }),
    }))
    .filter((section) => section.rows.length > 0);

  const updateDraft = (patch: Partial<ApiOperatorConfigDraft>): void => {
    onDraftChange({ ...activeDraft, ...patch });
  };

  const updateProtocol = (patch: Partial<NonNullable<ApiOperatorConfigDraft['governance_protocol']>>): void => {
    updateDraft({ governance_protocol: { ...protocol, ...patch } });
  };

  const toggleOperator = (operatorIds: string[]): void => {
    const next = new Set(activeDraft.enabled_operators);
    const allEnabled = operatorIds.every((operatorId) => next.has(operatorId));
    operatorIds.forEach((operatorId) => {
      if (allEnabled) next.delete(operatorId);
      else next.add(operatorId);
    });
    updateDraft({ enabled_operators: Array.from(next).sort() });
  };

  const renderOperatorRegistryRow = (row: OperatorRegistryDisplayRow): JSX.Element => {
    const enabledCount = row.ids.filter((operatorId) => enabled.has(operatorId)).length;
    const rowEnabled = enabledCount === row.ids.length;
    const rowPartlyEnabled = enabledCount > 0 && !rowEnabled;
    const statusLabel = rowEnabled ? '启用' : rowPartlyEnabled ? '部分启用' : '禁用';
    const statusClass = rowEnabled ? 'is-enabled' : rowPartlyEnabled ? 'is-partial' : 'is-disabled';
    return (
      <article className={`operator-row ${statusClass}`} key={row.title} role="row">
        <button
          aria-label={`${rowEnabled ? '停用' : '启用'} ${row.title}`}
          aria-pressed={rowEnabled}
          className={`operator-toggle ${rowEnabled ? 'is-on' : ''}`}
          onClick={() => toggleOperator(row.ids)}
          type="button"
        >
          <span />
        </button>
        <div className="op-name">
          <strong>{row.title}</strong>
          <code>{row.code}</code>
        </div>
        <div className="op-desc">{row.description}</div>
        <div className="window-chips">
          {row.chips.map((chip) => <span className="window-chip" key={chip}>{chip}</span>)}
        </div>
        <span className={`operator-status-pill ${statusClass}`}>{statusLabel}</span>
      </article>
    );
  };

  const operatorTab = (
    <>
      <section className="factor-config-kpis" aria-label="配置摘要">
        <article>
          <span>启用算子</span>
          <strong>{activeDraft.enabled_operators.length} / {operatorTotal}</strong>
          <p>{enabledOperatorSummary}</p>
        </article>
        <article>
          <span>挖掘深度</span>
          <strong>{activeDraft.default_depth}</strong>
          <p>范围 1-3，Phase 0 默认 2</p>
        </article>
        <article>
          <span>窗口空间</span>
          <strong>{activeDraft.window_space.length} 档</strong>
          <p className="mono">{windowSpaceText}</p>
        </article>
        <article>
          <span>每日公式预算</span>
          <strong>{activeDraft.daily_formula_budget.toLocaleString('en-US')}</strong>
          <p>{activeDraft.compute_backend}</p>
        </article>
      </section>

      <section className="factor-config-operator-table" aria-label="算子注册表">
        <div className="factor-config-operator-table__head">
          <div>
            <h3>算子注册表</h3>
            <p>25 个核心算子，默认启用 3 个。RankIC/IR/OOS 不参与 F1 准入，仅在 F2/F3 诊断中使用。</p>
          </div>
        </div>
        <div className="operator-toolbar" aria-label="核心算子库工具条">
          <div className="panel-title">
            <strong>核心算子库</strong>
            <div className="muted">定义、含义、输入、输出、窗口与 min_periods</div>
          </div>
          <div className="filter-row">
            <label className="field operator-filter-field">
              <span>分组：</span>
              <select aria-label="算子分组筛选" value={operatorGroupFilter} onChange={(event) => setOperatorGroupFilter(event.target.value)}>
                {operatorGroupOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="field search-field">
              <span className="sr-only">搜索算子或定义</span>
              <input
                aria-label="搜索算子或定义"
                onChange={(event) => setOperatorSearch(event.target.value)}
                placeholder="搜索算子或定义"
                type="search"
                value={operatorSearch}
              />
            </label>
          </div>
        </div>
        {filteredOperatorSections.map((section) => (
          <section className="operator-section" key={section.key} aria-label={section.title}>
            <header>
              <strong>{section.title}</strong>
              <span className={`operator-pill operator-pill--${section.statusTone}`}>{section.status}</span>
            </header>
            {section.rows.map(renderOperatorRegistryRow)}
          </section>
        ))}
        {!filteredOperatorSections.length ? (
          <div className="operator-empty" role="status">未匹配到算子，请调整分组或搜索条件。</div>
        ) : null}
      </section>
    </>
  );

  const governanceTab = (
    <>
      <div className="factor-phase2-row__top">
        <div>
          <h3>WNZT 标准流</h3>
          <small>Raw_F2 必须完成四段主干治理后，才进入 Refined F2 与检疫。</small>
        </div>
        <span className="factor-phase2-chip factor-phase2-chip--good">必选</span>
      </div>
      <section className="wnzt-strip factor-config-wnzt-strip" aria-label="WNZT 标准治理流">
        <article className="wnzt-step"><b>W</b><span>去极值并记录裁剪率</span></article>
        <article className="wnzt-step"><b>N</b><span>行业 / 市值 / 风格中性化</span></article>
        <article className="wnzt-step"><b>Z</b><span>截面标准化</span></article>
        <article className="wnzt-step"><b>T</b><span>时序平滑与换手约束</span></article>
      </section>
      <section className="optional-governance" aria-label="O/T 可选配置">
        <article className="optional-governance__item">
          <b>O 正交化</b>
          <button
            aria-pressed={Boolean(protocol.orthogonalization_enabled)}
            className="factor-phase2-button factor-phase2-button--small"
            type="button"
            onClick={() => updateProtocol({ orthogonalization_enabled: !protocol.orthogonalization_enabled })}
          >
            {protocol.orthogonalization_enabled ? '已开启' : '默认关闭'}
          </button>
        </article>
        <article className="optional-governance__item">
          <b>T 扩展滤波</b>
          <button
            aria-pressed={Boolean(protocol.turnover_filter_enabled)}
            className="factor-phase2-button factor-phase2-button--small"
            type="button"
            onClick={() => updateProtocol({ turnover_filter_enabled: !protocol.turnover_filter_enabled })}
          >
            {protocol.turnover_filter_enabled ? '已开启' : '默认关闭'}
          </button>
        </article>
      </section>
      <section className="factor-config-protocol-note">
        <h3>产物流</h3>
        <p>F1 经算子展开为 Raw_F2；Raw_F2 完成 WNZT 标准治理后生成 Refined F2。O/T 不是主干门槛，默认关闭，仅在配置快照中显式启用。</p>
      </section>
    </>
  );

  const gateTab = (
    <>
      <div className="factor-phase2-row__top">
        <div>
          <h3>发布准入闸门</h3>
          <small>检疫裁决只处理 Raw_F2 / Refined F2；F1 原始库不设 IC 门槛。</small>
        </div>
        <span className="factor-phase2-chip factor-phase2-chip--info">检疫策略</span>
      </div>
      <section className="decision-grid" aria-label="准入闸门指标">
        <article className="decision-card"><h3>RankIC</h3><strong>&gt; 0.03</strong><p>仅用于 F2/F3 候选初筛。</p></article>
        <article className="decision-card"><h3>IC_IR</h3><strong>&gt; 1.50</strong><p>Newey-West 修正后评估。</p></article>
        <article className="decision-card"><h3>OOS/IS</h3><strong>&gt; 0.70</strong><p>样本外崩盘自动阻断。</p></article>
        <article className="decision-card"><h3>P-value</h3><strong>&lt; 0.05</strong><p>显著性不足不得发布。</p></article>
        <article className="decision-card"><h3>S 级相关</h3><strong>&lt; 0.70</strong><p>同族拥挤超阈值自动废弃。</p></article>
        <article className="decision-card"><h3>容量与回撤</h3><strong>PASS</strong><p>容量、拥挤度和回撤共同约束。</p></article>
      </section>
    </>
  );

  const evidenceTab = (
    <>
      <div className="factor-phase2-row__top">
        <div>
          <h3 className="mono">f2_ts_rank_return_close_21_63</h3>
          <small>Raw_F2 来源：TS_Rank(TS_Return(Close, 21), 63) · WNZT 治理候选</small>
        </div>
        <span className="factor-phase2-chip factor-phase2-chip--good">PASSED + ELIGIBLE</span>
      </div>
      <section className="evidence-grid" aria-label="WNZT 证据">
        <article className="evidence-step"><strong>W 去极值</strong><span>1% / 99% 分位裁剪，裁剪率 1.8%，覆盖率 97.4%。</span><span className="factor-phase2-chip factor-phase2-chip--good">PASS</span></article>
        <article className="evidence-step"><strong>N 中性化</strong><span>行业 + 市值残差化，最大风格相关 0.18。</span><span className="factor-phase2-chip factor-phase2-chip--good">PASS</span></article>
        <article className="evidence-step"><strong>Z 标准化</strong><span>截面均值 0.00，标准差 1.00，异常日 0。</span><span className="factor-phase2-chip factor-phase2-chip--good">PASS</span></article>
        <article className="evidence-step"><strong>T 平滑</strong><span>3 日 EWMA，换手下降 22%，信号毛刺可控。</span><span className="factor-phase2-chip factor-phase2-chip--good">PASS</span></article>
        <article className="evidence-step"><strong>O 正交化</strong><span>可选扩展项，默认不剔除同族或既有风格成分。</span><span className="factor-phase2-chip">{protocol.orthogonalization_enabled ? '已开启' : '默认关闭'}</span></article>
        <article className="evidence-step"><strong>T 扩展滤波</strong><span>可选扩展项，默认不追加高阶平滑或额外换手惩罚。</span><span className="factor-phase2-chip">{protocol.turnover_filter_enabled ? '已开启' : '默认关闭'}</span></article>
      </section>
      <section className="decision-grid" aria-label="检疫裁决指标">
        <article className="decision-card"><h3>RankIC</h3><strong>0.047</strong><p>高于初筛门槛 0.03。</p></article>
        <article className="decision-card"><h3>IC_IR</h3><strong>1.72</strong><p>Newey-West 修正后通过。</p></article>
        <article className="decision-card"><h3>OOS/IS</h3><strong>0.81</strong><p>未触发样本外崩盘熔断。</p></article>
        <article className="decision-card"><h3>P-value</h3><strong>0.018</strong><p>显著性通过。</p></article>
        <article className="decision-card"><h3>S 级相关</h3><strong>0.41</strong><p>低于自动废弃阈值 0.70。</p></article>
        <article className="decision-card"><h3>容量与回撤</h3><strong>PASS</strong><p>容量、拥挤度和回撤均通过。</p></article>
      </section>
    </>
  );

  const snapshotTab = (
    <>
      <div className="factor-phase2-row__top">
        <div>
          <h3>配置快照</h3>
          <small>保存草稿不影响当前 run；生成快照后，下一次自动任务引用新版本。</small>
        </div>
        <span className={`factor-phase2-chip ${dirty ? 'factor-phase2-chip--warn' : 'factor-phase2-chip--good'}`}>
          {dirty ? '草稿已变更' : '草稿已同步'}
        </span>
      </div>
      <section className="factor-config-snapshot-list" aria-label="配置快照字段">
        <div><dt>F1 catalog snapshot</dt><dd>{payload?.latest_f1_catalog_snapshot?.snapshot_id ?? activeDraft.f1_catalog_snapshot_id ?? '未生成'}</dd></div>
        <div><dt>operator_config_snapshot</dt><dd>{snapshotLabel(payload?.latest_operator_config_snapshot)}</dd></div>
        <div><dt>enabled_operators</dt><dd>{activeDraft.enabled_operators.join('、')}</dd></div>
        <div><dt>window_space</dt><dd>[{activeDraft.window_space.join(', ')}]</dd></div>
        <div><dt>default_depth</dt><dd>{activeDraft.default_depth}</dd></div>
        <div><dt>daily_formula_budget</dt><dd>{activeDraft.daily_formula_budget.toLocaleString('en-US')}</dd></div>
        <div><dt>compute_backend</dt><dd>{activeDraft.compute_backend}</dd></div>
        <div><dt>O/T 扩展</dt><dd>{otClosed ? '默认关闭' : '已显式启用'}</dd></div>
      </section>
    </>
  );

  const mainByTab: Record<FactoryConfigTab, JSX.Element> = {
    operators: operatorTab,
    governance: governanceTab,
    gates: gateTab,
    evidence: evidenceTab,
    snapshots: snapshotTab,
  };

  return (
    <div className="factor-detail-modal-backdrop factor-config-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="factor-detail-modal factor-config-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="factor-config-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="factor-phase2-panel__eyebrow">工厂配置</p>
            <h2 id="factor-config-title">因子工厂配置</h2>
            <span className="factor-config-subtitle">算子预算、治理协议、准入闸门和快照版本在此统一维护。</span>
          </div>
          <div className="factor-config-header-actions">
            <span className={`factor-phase2-chip ${dirty ? 'factor-phase2-chip--warn' : 'factor-phase2-chip--good'}`}>
              {dirty ? '草稿已变更' : '草稿已同步'}
            </span>
            <button
              className="factor-phase2-button factor-phase2-button--small"
              type="button"
              onClick={() => onDraftChange(cloneOperatorDraft(payload?.defaults ?? DEFAULT_OPERATOR_CONFIG_DRAFT))}
            >
              重置为默认
            </button>
            <button className="factor-phase2-button factor-phase2-button--small factor-config-close-button" type="button" onClick={onClose}>关闭</button>
          </div>
        </header>

        <div className="factor-config-modal__body">
          <nav className="factor-config-tabs" aria-label="工厂配置标签">
            {FACTORY_CONFIG_TABS.map((tab) => (
              <button
                aria-selected={activeTab === tab.key}
                className={`factor-config-tab ${activeTab === tab.key ? 'is-active' : ''}`}
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                role="tab"
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <main className="factor-config-main">
            {loading ? <div className="factor-phase2-empty">正在加载配置草稿...</div> : null}
            {error ? <div className="factor-phase2-empty factor-phase2-empty--danger">{error}</div> : null}
            {notice ? <div className="factor-phase2-empty factor-phase2-empty--success">{notice}</div> : null}
            {mainByTab[activeTab]}
          </main>

          <aside className="factor-config-side" aria-label="运行快照摘要">
            <section>
              <h3>引用快照</h3>
              <dl>
                <div><dt>F1 目录</dt><dd>{payload?.latest_f1_catalog_snapshot?.snapshot_id ?? activeDraft.f1_catalog_snapshot_id ?? '未生成'}</dd></div>
                <div><dt>算子配置</dt><dd>{payload?.latest_operator_config_snapshot?.snapshot_id ?? 'op_cfg_draft'}</dd></div>
                <div><dt>运行时区</dt><dd>Asia/Hong_Kong</dd></div>
              </dl>
            </section>
            <section>
              <h3>准入规则</h3>
              <div className="rule-list">
                <span>字段须来自 F1 可调用或审慎可调用状态。</span>
                <span>历史不足输出 NaN，并记录 min_periods。</span>
                <span>DATA_SOURCE_BLOCKED 不参与表达式展开。</span>
                <span>RankIC/IR 不阻止 F1 进入候选池。</span>
              </div>
            </section>
            <section>
              <h3>运行预算</h3>
              <dl>
                <div><dt>表达式上限</dt><dd>50,000</dd></div>
                <div><dt>单批并发</dt><dd>8 workers</dd></div>
                <div><dt>超时阈值</dt><dd>45 min</dd></div>
              </dl>
            </section>
          </aside>
        </div>

        <footer className="factor-config-modal__footer">
          <span>保存后冻结为运行快照；草稿不影响已排队任务。</span>
          <div>
            <button className="factor-phase2-button" type="button" onClick={onClose}>取消</button>
            <button className="factor-phase2-button" disabled={saving !== null || loading} type="button" onClick={onSave}>
              {saving === 'save' ? '保存中...' : '保存草稿'}
            </button>
            <button className="factor-phase2-button factor-phase2-button--primary" disabled={saving !== null || loading} type="button" onClick={onSnapshot}>
              {saving === 'snapshot' ? '生成中...' : '生成配置快照'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

export default function FactorFactoryPage({ initialSection: _initialSection = 'overview' }: FactorFactoryPageProps): JSX.Element {
  const api = useApiClient();
  const [overview, setOverview] = useState<ApiFactorFactoryOverview | null>(null);
  const [loading, setLoading] = useState(Boolean(api.getFactorFactoryOverview));
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detailCandidateId, setDetailCandidateId] = useState<string | null>(null);
  const [filters, setFilters] = useState<QuarantineFilters>({ date: '', factorName: '', result: 'ALL' });
  const [autoFilterDate, setAutoFilterDate] = useState('');
  const [searchedRows, setSearchedRows] = useState<ApiFactorQuarantineResultRow[] | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [configPayload, setConfigPayload] = useState<ApiFactorFactoryOperatorConfigResponse | null>(null);
  const [configDraft, setConfigDraft] = useState<ApiOperatorConfigDraft | null>(null);
  const [configBaseline, setConfigBaseline] = useState<ApiOperatorConfigDraft | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState<'save' | 'snapshot' | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configNotice, setConfigNotice] = useState<string | null>(null);

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

  const loadOperatorConfig = useCallback(async (): Promise<void> => {
    setConfigLoading(true);
    setConfigError(null);
    try {
      let payload = overview?.operator_config ?? null;
      if (api.getFactorFactoryOperatorConfig) {
        payload = await api.getFactorFactoryOperatorConfig();
      }
      if (!payload) {
        payload = {
          profile_id: 'default',
          draft: cloneOperatorDraft(null),
          registry_items: [],
          latest_f1_catalog_snapshot: null,
          latest_operator_config_snapshot: null,
          defaults: cloneOperatorDraft(null),
        };
      }
      const nextDraft = cloneOperatorDraft(payload.draft);
      setConfigPayload(payload);
      setConfigDraft(nextDraft);
      setConfigBaseline(cloneOperatorDraft(nextDraft));
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : '算子配置加载失败。');
    } finally {
      setConfigLoading(false);
    }
  }, [api, overview?.operator_config]);

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
  const dateScopedQuarantineRows = useMemo(
    () => filterQuarantineRowsByDate(quarantineRows, filters.date),
    [filters.date, quarantineRows],
  );
  const dateScopedCandidateIds = useMemo(
    () => new Set(dateScopedQuarantineRows.map((row) => text(row.candidate_id, '')).filter(Boolean)),
    [dateScopedQuarantineRows],
  );
  const visibleTaskRows = useMemo(() => {
    if (!filters.date) return taskRows;
    const dateScopedL2Count = dateScopedQuarantineRows.filter((row) => targetLayerToken(row.target_layer) === 'L2').length;
    const dateScopedL3Count = dateScopedQuarantineRows.filter((row) => targetLayerToken(row.target_layer) === 'L3').length;
    const hasCompositionTask = taskRows.some((task) => taskKind(task) === 'composition');
    return taskRows.map((task) => {
      const kind = taskKind(task);
      if (kind === 'refinement') {
        const refinementCount = hasCompositionTask ? dateScopedL2Count : dateScopedQuarantineRows.length;
        return {
          ...task,
          current_candidate_count: refinementCount,
          delivered_candidate_count: refinementCount,
        };
      }
      if (kind === 'composition') {
        return {
          ...task,
          current_candidate_count: dateScopedL3Count,
          delivered_candidate_count: dateScopedL3Count,
        };
      }
      if (kind === 'quarantine') {
        return {
          ...task,
          current_candidate_count: dateScopedQuarantineRows.length,
          delivered_candidate_count: dateScopedQuarantineRows.length,
        };
      }
      return task;
    });
  }, [dateScopedQuarantineRows, filters.date, taskRows]);
  const renderedQuarantineRows = useMemo(
    () => filterQuarantineRows(searchedRows ?? quarantineRows, filters),
    [filters, quarantineRows, searchedRows],
  );
  const latestSubmittedDate = shortDate(scoringCandidates[0]?.submitted_at ?? quarantineRows[0]?.submitted_at ?? '');
  const metricDateLabel = filters.date || '全部日期';
  const metricQuarantinePassCount = countQuarantineRowsByResult(dateScopedQuarantineRows, 'PASS');
  const metricQuarantineFailCount = countQuarantineRowsByResult(dateScopedQuarantineRows, 'FAIL');
  const metricPublishableCount = filters.date
    ? publishableFactors.filter((item) => dateScopedCandidateIds.has(text(item.candidate_id ?? item.factor_id, ''))).length
    : publishableFactors.length;
  const metricCards: FactorFactoryMetricCard[] = [
    {
      key: 'yesterday_formula_count',
      label: '昨日公式量',
      value: numeric(overview?.monitor_summary?.yesterday_formula_count, 0),
      hint: 'OperatorEngine 公式预算',
      tooltip: '上一轮 OperatorEngine 在去重后实际生成的公式数量，用来观察搜索预算与候选供给是否足够。',
    },
    {
      key: 'initial_screen_pass',
      label: '初筛通过',
      value: numeric(overview?.monitor_summary?.initial_screen_pass_count, scoringCandidates.length),
      hint: `${metricDateLabel} Raw_F2 初筛出口`,
      tooltip: '通过 B2 初筛的 Raw_F2 候选数，处在送检之前；去重、重复表达式或治理拦截后，可能少于检疫接收数。',
    },
    {
      key: 'quarantine_pass',
      label: '检疫通过',
      value: metricQuarantinePassCount,
      hint: `${metricDateLabel} PASS / PUBLISHED`,
      tooltip: '当前日期发布准入建议中，检疫裁决为 PASS 或已发布边界内可继续推进的候选数量。',
    },
    {
      key: 's_grade_promotion',
      label: 'S 级晋升',
      value: metricPublishableCount,
      hint: `${metricDateLabel} 发布准入 ELIGIBLE`,
      tooltip: '当前日期候选中已经满足发布准入条件、可进入人工发布确认的 S 级候选数量。',
    },
    {
      key: 'alpha_concentration',
      label: 'Alpha 浓度',
      value: decimal(overview?.monitor_summary?.alpha_concentration),
      hint: 'S 级相关性峰值',
      tooltip: '候选与已有 S 级或高置信因子的相关性峰值，用来提示 Alpha 是否过度集中或重复。',
    },
    {
      key: 'failure_candidate',
      label: '失败候选',
      value: metricQuarantineFailCount,
      hint: `${metricDateLabel} FAIL`,
      tooltip: '当前日期发布准入建议中检疫裁决为 FAIL 的候选数量；阻断原因分布用于解释失败来源，不再作为候选数量展示。',
    },
  ];
  const detailCandidate = quarantineCandidates.find((candidate) => candidate.id === detailCandidateId) ?? null;
  const detailScoring = detailCandidate ? scoringFromCandidate(detailCandidate) : undefined;
  const detailReport = asList<ApiFactorAdmissionReportRow>(detailCandidate?.admission_report);
  const latestRun = overview?.latest_run ?? null;
  const latestConfigSnapshotId = overview?.operator_config?.latest_operator_config_snapshot?.snapshot_id
    ?? configPayload?.latest_operator_config_snapshot?.snapshot_id
    ?? undefined;
  const latestF1SnapshotId = overview?.operator_config?.latest_f1_catalog_snapshot?.snapshot_id
    ?? configPayload?.latest_f1_catalog_snapshot?.snapshot_id
    ?? undefined;
  const configDirty = Boolean(
    configDraft
    && configBaseline
    && JSON.stringify(configDraft) !== JSON.stringify(configBaseline),
  );

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(latestSubmittedDate)) return;
    setSearchedRows(null);
    setFilters((current) => {
      if (current.date && current.date !== autoFilterDate) return current;
      if (current.date === latestSubmittedDate) return current;
      return { ...current, date: latestSubmittedDate };
    });
    setAutoFilterDate(latestSubmittedDate);
  }, [autoFilterDate, latestSubmittedDate]);

  const updateFilters = useCallback((patch: Partial<QuarantineFilters>): void => {
    setSearchedRows(null);
    setFilters((current) => ({ ...current, ...patch }));
  }, []);

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

  const openOperatorConfig = (): void => {
    setConfigOpen(true);
    setConfigNotice(null);
    void loadOperatorConfig();
  };

  const closeOperatorConfig = (): void => {
    if (
      configDirty
      && typeof window !== 'undefined'
      && !window.confirm('配置草稿尚未保存，确认关闭弹层？')
    ) {
      return;
    }
    setConfigOpen(false);
  };

  const saveOperatorConfig = (): void => {
    void (async () => {
      if (!configDraft) return;
      if (!api.saveFactorFactoryOperatorConfig) {
        setConfigError('保存草稿 API 尚未接入。');
        return;
      }
      setConfigSaving('save');
      setConfigError(null);
      setConfigNotice(null);
      try {
        const payload = await api.saveFactorFactoryOperatorConfig(configDraft);
        const nextDraft = cloneOperatorDraft(payload.draft);
        setConfigPayload(payload);
        setConfigDraft(nextDraft);
        setConfigBaseline(cloneOperatorDraft(nextDraft));
        setConfigNotice('草稿已保存；后续 run 仍需引用不可变快照。');
        await loadOverview();
      } catch (err) {
        setConfigError(err instanceof Error ? err.message : '配置草稿保存失败。');
      } finally {
        setConfigSaving(null);
      }
    })();
  };

  const snapshotOperatorConfig = (): void => {
    void (async () => {
      if (!configDraft) return;
      if (!api.createFactorFactoryOperatorConfigSnapshot) {
        setConfigError('生成配置快照 API 尚未接入。');
        return;
      }
      setConfigSaving('snapshot');
      setConfigError(null);
      setConfigNotice(null);
      try {
        const snapshot = await api.createFactorFactoryOperatorConfigSnapshot({
          ...configDraft,
          f1_catalog_snapshot_id: configPayload?.latest_f1_catalog_snapshot?.snapshot_id ?? configDraft.f1_catalog_snapshot_id ?? null,
        });
        setConfigNotice(`已生成配置快照 ${snapshot.snapshot_id}；新 run 将引用该快照。`);
        await loadOverview();
        await loadOperatorConfig();
      } catch (err) {
        setConfigError(err instanceof Error ? err.message : '配置快照生成失败。');
      } finally {
        setConfigSaving(null);
      }
    })();
  };

  const startAutomation = (): void => {
    void withBusy('start', async () => {
      if (!api.startFactorFactoryAutomation) throw new Error('启动自动化 API 尚未接入。');
      const payload = await api.startFactorFactoryAutomation({
        timezone: overview?.profile?.timezone ?? 'Asia/Hong_Kong',
        schedule_time: '14:00',
        request: requestFromOverview(overview),
        gate_policy: overview?.gate_policy ?? overview?.profile?.gate_policy,
        operator_config_snapshot_id: latestConfigSnapshotId,
        f1_catalog_snapshot_id: latestF1SnapshotId,
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
        operator_config_snapshot_id: latestConfigSnapshotId,
        f1_catalog_snapshot_id: latestF1SnapshotId,
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
          <button className="factor-phase2-button" disabled={loading} type="button" onClick={openOperatorConfig}>
            工厂配置
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

      <section className="factor-phase2-metrics factor-factory-funnel" aria-label="因子工厂基础监视器">
        {metricCards.map((card) => (
          <div className="factor-phase2-metric" data-metric-key={card.key} key={card.key} title={card.tooltip}>
            <p className="factor-phase2-metric__label">
              <span>{card.label}</span>
              <span
                aria-label={`${card.label}：${card.tooltip}`}
                className="factor-factory-metric-tooltip"
                data-tooltip={card.tooltip}
                tabIndex={0}
                title={card.tooltip}
              >
                ?
              </span>
            </p>
            <p className="factor-phase2-metric__value">{card.value}</p>
            <p className="factor-phase2-metric__hint">{card.hint}</p>
          </div>
        ))}
      </section>

      <section className="factor-phase2-metrics factor-factory-funnel" hidden aria-hidden="true">
        {[
          ['昨日公式量', numeric(overview?.monitor_summary?.yesterday_formula_count, 0), 'OperatorEngine 公式预算'],
          ['初筛通过', numeric(overview?.monitor_summary?.initial_screen_pass_count, scoringCandidates.length), 'Raw_F2 候选预览'],
          ['检疫通过', numeric(overview?.monitor_summary?.quarantine_pass_count, quarantineRows.filter((row) => row.quarantine_result === 'PASS').length), 'PASS / PUBLISHED'],
          ['S 级晋升', numeric(overview?.monitor_summary?.s_grade_promotion_count, publishableFactors.length), '发布准入 ELIGIBLE'],
          ['Alpha 浓度', decimal(overview?.monitor_summary?.alpha_concentration), 'S 级相关性峰值'],
          ['失败原因', Object.keys(record(overview?.monitor_summary?.failure_reason_distribution)).length, '阻断原因分布'],
        ].map(([label, value, hint]) => (
          <div className="factor-phase2-metric" key={String(label)}>
            <p className="factor-phase2-metric__label">{label}</p>
            <p className="factor-phase2-metric__value">{value}</p>
            <p className="factor-phase2-metric__hint">{hint}</p>
          </div>
        ))}
      </section>

      <section className="factor-phase2-metrics factor-factory-funnel factor-factory-funnel--legacy" aria-hidden="true">
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
            <span className="factor-phase2-chip factor-phase2-chip--info">{visibleTaskRows.length} 类任务</span>
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
            {visibleTaskRows.map((task) => (
              <article className="factor-factory-task-card" data-task-kind={task.kind} key={task.id}>
                <div className="factor-phase2-row__top">
                  <div>
                    <h3>{displayLayerText(task.title)}</h3>
                    <small>{displayLayerText(task.summary)}</small>
                  </div>
                  <span className={chipClass(task.status)}>{task.status}</span>
                </div>
                {asList<string>(task.flow).length ? (
                  <div className="factor-factory-task-flow" aria-label="任务流">
                    {asList<string>(task.flow).map((step, index) => (
                      <span key={`${task.id}-${step}`}>
                        {index > 0 ? <b aria-hidden="true">→</b> : null}
                        <em>{step}</em>
                      </span>
                    ))}
                  </div>
                ) : null}
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
              <p className="factor-phase2-panel__eyebrow">B2 候选评分</p>
              <h2>治理候选</h2>
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
                    <small>WNZT 4/4 · {shortDate(candidate.submitted_at)} · {displayTargetLayer(candidate.target_layer)}</small>
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
              <p className="factor-phase2-panel__eyebrow">B3 检疫建议</p>
              <h2>发布准入建议</h2>
            </div>
            <span className="factor-phase2-chip factor-phase2-chip--info">显示 {renderedQuarantineRows.length}/{quarantineRows.length}</span>
          </div>
          <div className="factor-phase2-panel__body factor-factory-scroll-body">
            <div className="factor-factory-filter-row" aria-label="历史检疫筛选">
              <label>
                日期
                <input type="date" value={filters.date} onChange={(event) => updateFilters({ date: event.target.value })} />
              </label>
              <label>
                因子名
                <input type="text" value={filters.factorName} onChange={(event) => updateFilters({ factorName: event.target.value })} />
              </label>
              <label>
                裁决
                <select value={filters.result} onChange={(event) => updateFilters({ result: event.target.value })}>
                  <option value="ALL">全部裁决</option>
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
                <span role="columnheader">裁决</span>
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

      {configOpen ? (
        <FactorFactoryConfigModal
          payload={configPayload}
          draft={configDraft}
          loading={configLoading}
          saving={configSaving}
          error={configError}
          notice={configNotice}
          dirty={configDirty}
          onDraftChange={setConfigDraft}
          onClose={closeOperatorConfig}
          onReload={() => void loadOperatorConfig()}
          onSave={saveOperatorConfig}
          onSnapshot={snapshotOperatorConfig}
        />
      ) : null}

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

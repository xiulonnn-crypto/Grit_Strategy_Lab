import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './factor-phase2-pages.css';

type FactorDirection = 'HIGH_IS_GOOD' | 'LOW_IS_GOOD';

export type FactorModelOption = {
  id: string;
  displayName: string;
  family: string;
  categoryLabel?: string;
  factorLevelLabel?: string;
  market?: string | null;
  tierLevel?: string | null;
  factorLevel?: string | null;
  opCompleted?: string[];
  rankIcLabel?: string;
  irLabel?: string;
  rankIc?: number | null;
  ir?: number | null;
  sourceLabel: string;
  diagnosticStatus: string;
  lifecycleStatus?: string | null;
  uiState?: string | null;
  uiStateLabel?: string | null;
  isOnline?: boolean;
  pitCoveragePct: number;
  defaultWeight: number;
  defaultDirection: FactorDirection;
};

export type FactorModelSelection = {
  factorId: string;
  weightPct: number;
  direction: FactorDirection;
};

export type FactorModelNeutralizationConfig = {
  enabled: boolean;
  taxonomy: string;
  level: string;
  method: string;
};

export type FactorModelPreviewPayload = {
  strategyType?: 'MULTI_FACTOR' | 'COMPOSITE_FACTOR';
  modelName: string;
  factors: FactorModelSelection[];
  neutralization: FactorModelNeutralizationConfig;
  rebalanceFrequency: string;
  topN: number;
  universeFilter?: {
    minAdvUsd: number;
    advWindow: '20D' | '60D';
    excludeHalted: boolean;
    excludeOtcPink: boolean;
    excludeLuldPaused: boolean;
    delistingWindowDays: number;
    sectorOverrides: Record<string, boolean>;
  };
  weightMapping?: {
    method: 'equal_top_k' | 'score_proportional' | 'risk_heuristic';
    sectorCapPct: number;
    maxPositionPct: number;
    minTargetWeightPct: number;
    capRedistributionMode: 'cash' | 'proportional_refill';
  };
  rebalanceLogic?: {
    frequency: 'daily' | 'weekly' | 'monthly';
    calendarRule: string;
    exitRankPercentile: number;
    minTradeNotionalUsd: number;
  };
  executionConstraints?: {
    notionalUsd: number;
    commissionBps: number;
    stampTaxBps: number;
    baseSlippageBps: number;
    impactBeta: number;
    maxImpactBps: number;
  };
};

export type FactorModelPreviewWeight = {
  factorId: string;
  weightPct: number;
  normalizedWeightPct: number;
  direction: FactorDirection;
  diagnosticStatus?: string;
};

export type FactorModelScorePoint = {
  symbol: string;
  score: number;
  coveragePct: number;
};

export type FactorModelNeutralizationPreview = {
  enabled: boolean;
  method: string;
  status: string;
  blockers: string[];
  industryField?: string | null;
  taxonomy?: string | null;
  coveredSymbolCount?: number | null;
  missingSymbolCount?: number | null;
  sourceNames?: string[];
};

export type FactorModelRiskItem = {
  code: string;
  severity?: string;
  message: string;
  label?: string;
  category?: string;
  factor_id?: string;
};

export type FactorModelStrategyCreationRisk = {
  can_create?: boolean;
  warning_count?: number;
  blocked_count?: number;
  warnings?: FactorModelRiskItem[];
  hard_blockers?: FactorModelRiskItem[];
  summary_label?: string;
  summary?: string;
  eligibility?: Record<string, unknown>;
  diagnostic_summary?: Record<string, unknown>;
  sector_cap_forecast?: Record<string, unknown>;
  cost_forecast?: Record<string, unknown>;
};

export type FactorModelPreview = {
  status: string;
  coveragePct: number;
  factorCount: number;
  readyFactorCount: number;
  universeSymbolCount: number;
  turnoverPct: number;
  scoreSpread: number;
  scorePreview: FactorModelScorePoint[];
  normalizedWeights: FactorModelPreviewWeight[];
  pitBlockers: string[];
  neutralizationStatus: FactorModelNeutralizationPreview;
  warnings: string[];
  strategyCreationRisk?: FactorModelStrategyCreationRisk;
  strategy_creation_risk?: FactorModelStrategyCreationRisk;
  diagnosticSummary?: Record<string, unknown> | null;
  sectorCapForecast?: Record<string, unknown> | null;
  costForecast?: Record<string, unknown> | null;
};

export type FactorModelCreateResponse = {
  strategy_id: string;
  parameter_version_id?: string;
};

export type FactorModelBuilderApi = {
  previewFactorModel?: (payload: FactorModelPreviewPayload) => Promise<FactorModelPreview>;
  createFactorModel?: (payload: FactorModelPreviewPayload) => Promise<FactorModelCreateResponse>;
};

export type FactorModelBuilderPageProps = {
  api?: FactorModelBuilderApi;
  autoPreviewDelayMs?: number;
  factors?: FactorModelOption[];
  initialPrefill?: {
    source?: string;
    strategyType?: 'MULTI_FACTOR' | 'COMPOSITE_FACTOR';
    factorIds: string[];
    weights: number[];
    directions: string[];
    modelName?: string;
  };
  useDefaultFallback?: boolean;
  defaultSelectAll?: boolean;
  onCreated?: (strategyId: string) => void;
};

const DEFAULT_MODEL_NAME = '多因子核心模型';
const FACTOR_ORDER = [
  's_mom_12m1m_rank',
  's_val_ep_ltm_raw',
  's_qlty_fcfy_ttm_raw',
  's_vol_252d_rank',
  's_size_cur_log',
] as const;

const DEFAULT_COMPOSITE_UNIVERSE_FILTER: NonNullable<FactorModelPreviewPayload['universeFilter']> = {
  minAdvUsd: 5_000_000,
  advWindow: '20D',
  excludeHalted: true,
  excludeOtcPink: true,
  excludeLuldPaused: true,
  delistingWindowDays: 30,
  sectorOverrides: {
    utilities: false,
    realEstate: false,
  },
};

const DEFAULT_COMPOSITE_WEIGHT_MAPPING: NonNullable<FactorModelPreviewPayload['weightMapping']> = {
  method: 'equal_top_k',
  sectorCapPct: 20,
  maxPositionPct: 2,
  minTargetWeightPct: 0.25,
  capRedistributionMode: 'cash',
};

const DEFAULT_COMPOSITE_REBALANCE_LOGIC: NonNullable<FactorModelPreviewPayload['rebalanceLogic']> = {
  frequency: 'monthly',
  calendarRule: 'first_trading_day',
  exitRankPercentile: 20,
  minTradeNotionalUsd: 10_000,
};

const DEFAULT_COMPOSITE_EXECUTION_CONSTRAINTS: NonNullable<FactorModelPreviewPayload['executionConstraints']> = {
  notionalUsd: 10_000_000,
  commissionBps: 1.5,
  stampTaxBps: 0,
  baseSlippageBps: 2.5,
  impactBeta: 0.65,
  maxImpactBps: 75,
};

const FACTOR_DESIGN: Record<string, { displayName: string; family: string; weightPct: number; direction: FactorDirection }> = {
  s_mom_12m1m_rank: {
    displayName: '截面动量排名 (12-1m) [Rank]',
    family: '动量',
    weightPct: 30,
    direction: 'HIGH_IS_GOOD',
  },
  s_val_ep_ltm_raw: {
    displayName: '盈利收益率 (LTM) [Raw]',
    family: '估值',
    weightPct: 20,
    direction: 'HIGH_IS_GOOD',
  },
  s_qlty_fcfy_ttm_raw: {
    displayName: '自由现金流收益率 (LTM) [Raw]',
    family: '质量',
    weightPct: 20,
    direction: 'HIGH_IS_GOOD',
  },
  s_vol_252d_rank: {
    displayName: '波动率排名 (252d) [Rank]',
    family: '低波',
    weightPct: 15,
    direction: 'LOW_IS_GOOD',
  },
  s_size_cur_log: {
    displayName: '对数市值 (当前) [Raw]',
    family: '规模',
    weightPct: 15,
    direction: 'LOW_IS_GOOD',
  },
};

const DEFAULT_FACTORS: FactorModelOption[] = FACTOR_ORDER.map((id) => {
  const design = FACTOR_DESIGN[id];
  return {
    id,
    displayName: design.displayName,
    family: design.family,
    sourceLabel: '系统默认',
    diagnosticStatus: '可诊断',
    pitCoveragePct: 94,
    defaultWeight: design.weightPct,
    defaultDirection: design.direction,
  };
});

const FACTOR_MODEL_LEVELS = [
  { key: 'S', title: '顶级', score: 5 },
  { key: 'A', title: '优秀', score: 4 },
  { key: 'B', title: '合格', score: 3 },
  { key: 'C', title: '微弱', score: 2 },
  { key: 'D', title: '噪声', score: 1 },
] as const;
type FactorModelLevelScore = (typeof FACTOR_MODEL_LEVELS)[number]['score'];
const FACTOR_MODEL_LEVEL_BY_SCORE = new Map(FACTOR_MODEL_LEVELS.map((level) => [level.score, level]));
const INVALID_FACTOR_DIAGNOSTIC_STATES = new Set(['FAILED', 'INVALID', 'DECAYED']);

const REBALANCE_OPTIONS = [
  { value: 'monthly', label: '每月', summary: '每月复核一次多因子组合权重。' },
  { value: 'quarterly', label: '每季度', summary: '每季度复核一次，降低调仓干扰。' },
  { value: 'semiannual', label: '每半年', summary: '每半年复核一次，适合低换手组合。' },
  { value: 'yearly', label: '每年', summary: '每年复核一次，强调长期持仓稳定性。' },
  { value: 'never', label: '从不', summary: '创建后不按固定周期触发再平衡。' },
] as const;

function defaultTopNForFactorCount(factorCount: number): number {
  return Math.max(Math.min(factorCount * 2, 10), 5);
}

function pct(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

function recordNumber(record: Record<string, unknown> | null | undefined, key: string, fallback = 0): number {
  const value = record?.[key];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function recordString(record: Record<string, unknown> | null | undefined, key: string, fallback = ''): string {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function designFactor(factor: FactorModelOption): FactorModelOption {
  const design = FACTOR_DESIGN[factor.id];
  if (!design) return factor;
  return {
    ...factor,
    displayName: factor.displayName || design.displayName,
    family: factor.family || design.family,
    categoryLabel: factor.categoryLabel || factor.family || design.family,
    defaultWeight: Number.isFinite(factor.defaultWeight) ? factor.defaultWeight : design.weightPct,
    defaultDirection: factor.defaultDirection || design.direction,
  };
}

function factorMetricTags(factor: FactorModelOption): Array<{ key: string; label: string }> {
  const category = factor.categoryLabel || factor.family || '自定义';
  return [
    { key: 'category', label: category },
    { key: 'level', label: factorLevelLabel(factor) },
    { key: 'rank-ic', label: factor.rankIcLabel || 'Rank IC 待诊断' },
    { key: 'ir', label: factor.irLabel || 'IR 待诊断' },
  ];
}

function FactorMetricTags({ factor, context }: { factor: FactorModelOption; context: string }): JSX.Element {
  return (
    <div className="factor-model-card-tags" aria-label={`${factor.displayName}${context}标签`}>
      {factorMetricTags(factor).map((tag) => (
        <span className={`factor-model-metric-chip factor-model-metric-chip--${tag.key}`} key={`${factor.id}-${tag.key}`}>
          {tag.label}
        </span>
      ))}
    </div>
  );
}

function finiteMetric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function irValue(factor: FactorModelOption): number | null {
  const directValue = finiteMetric(factor.ir);
  if (directValue !== null) return directValue;
  const labelMatch = factor.irLabel?.match(/-?\d+(?:\.\d+)?/);
  return labelMatch ? finiteMetric(labelMatch[0]) : null;
}

function metricLevelScore(value: number, metric: 'rank_ic' | 'ir'): number {
  if (metric === 'rank_ic') {
    if (value > 0.03) return 5;
    if (value >= 0.02) return 4;
    if (value >= 0.01) return 3;
    if (value >= 0.005) return 2;
    return 1;
  }
  if (value > 2.0) return 5;
  if (value >= 1.0) return 4;
  if (value >= 0.5) return 3;
  if (value >= 0.2) return 2;
  return 1;
}

function factorLevelLabel(factor: FactorModelOption): string {
  if (factor.factorLevelLabel) return factor.factorLevelLabel;
  const rankIc = finiteMetric(factor.rankIc);
  const ir = irValue(factor);
  if (rankIc === null || ir === null) return '因子级别 未评级';
  const score = Math.min(
    metricLevelScore(Math.abs(rankIc), 'rank_ic'),
    metricLevelScore(Math.abs(ir), 'ir'),
  ) as FactorModelLevelScore;
  const level = FACTOR_MODEL_LEVEL_BY_SCORE.get(score);
  return level ? `因子级别 ${level.key}${level.title}` : '因子级别 未评级';
}

function isSelectableModelFactor(factor: FactorModelOption): boolean {
  if (factor.isOnline === false) return false;
  const diagnostic = String(factor.diagnosticStatus ?? '').trim().toUpperCase();
  const lifecycle = String(factor.lifecycleStatus ?? '').trim().toUpperCase();
  const uiState = String(factor.uiState ?? '').trim().toLowerCase();
  return (
    !INVALID_FACTOR_DIAGNOSTIC_STATES.has(diagnostic) &&
    lifecycle !== 'DECAYED' &&
    uiState !== 'decayed'
  );
}

function isCompositeModelFactor(factor: FactorModelOption): boolean {
  const market = String(factor.market ?? '').trim().toUpperCase();
  const tier = String(factor.tierLevel ?? '').trim().toUpperCase();
  const level = String(factor.factorLevel ?? '').trim().toUpperCase();
  const diagnostic = String(factor.diagnosticStatus ?? '').trim().toUpperCase();
  const completed = new Set((factor.opCompleted ?? []).map((item) => String(item).trim().toUpperCase()));
  return (
    market === 'US' &&
    (tier === 'F3' || tier === 'L3') &&
    (level === 'S' || level === 'A') &&
    diagnostic === 'COMPLETED' &&
    ['W', 'N', 'Z', 'T'].every((code) => completed.has(code))
  );
}

function factorOrderIndex(factor: FactorModelOption): number {
  const index = FACTOR_ORDER.indexOf(factor.id as (typeof FACTOR_ORDER)[number]);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function compareFactorsByAbsIr(left: FactorModelOption, right: FactorModelOption): number {
  const leftIr = irValue(left);
  const rightIr = irValue(right);
  const leftScore = leftIr === null ? Number.NEGATIVE_INFINITY : Math.abs(leftIr);
  const rightScore = rightIr === null ? Number.NEGATIVE_INFINITY : Math.abs(rightIr);
  if (leftScore !== rightScore) return rightScore - leftScore;
  const orderDiff = factorOrderIndex(left) - factorOrderIndex(right);
  if (orderDiff !== 0) return orderDiff;
  return left.displayName.localeCompare(right.displayName, 'zh-Hans-CN');
}

function modelBasket(factors: FactorModelOption[], useDefaultFallback = true): FactorModelOption[] {
  const sourceFactors = factors.length ? factors : useDefaultFallback ? DEFAULT_FACTORS : [];
  return sourceFactors.filter(isSelectableModelFactor).map(designFactor).sort(compareFactorsByAbsIr);
}

function normalizeSelections(factors: FactorModelOption[], useDefaultFallback = true): FactorModelSelection[] {
  const basket = modelBasket(factors, useDefaultFallback);
  const draftSelections = basket.map((factor) => ({
    factorId: factor.id,
    weightPct: factor.defaultWeight,
    direction: factor.defaultDirection,
  }));
  const totalWeight = draftSelections.reduce((total, selection) => total + selection.weightPct, 0);
  if (Math.round(totalWeight) === 100) {
    return draftSelections;
  }
  const equalWeight = basket.length ? 100 / basket.length : 0;
  return draftSelections.map((selection) => ({
    ...selection,
    weightPct: Number(equalWeight.toFixed(2)),
  }));
}

function normalizePrefillDirection(value: string | undefined, fallback: FactorDirection): FactorDirection {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'LOW_IS_GOOD' || normalized === 'LOW_IS_BETTER') return 'LOW_IS_GOOD';
  if (normalized === 'HIGH_IS_GOOD' || normalized === 'HIGH_IS_BETTER') return 'HIGH_IS_GOOD';
  return fallback;
}

function localizePreviewStatus(status: string): string {
  if (status === 'READY') return '通过';
  if (status === 'BLOCKED') return '阻断';
  if (status === 'LOCAL_PENDING_API_PREVIEW') return '本地校验';
  return status || '待预览';
}

function blockerLabel(blocker: string): string {
  const normalized = blocker.trim();
  if (!normalized) return '未知门禁阻塞';
  if (normalized === 'MISSING_INDUSTRY_PIT') return '行业 PIT 字段缺失';
  if (normalized === 'PIT_BLOCKED') return 'PIT 证据不足';
  if (normalized === 'FUTURE_FUNCTION') return '未来函数';
  if (normalized === 'UNREPLAYABLE_FIELD') return '不可回放字段';
  if (normalized === 'CURRENT_ONLY_DATA') return '当前态数据';
  if (normalized === 'UNSAFE_EXPRESSION') return '不安全表达式';
  if (normalized === 'MISSING_AVAILABLE_AT') return '缺少 available_at';
  if (normalized === 'HIGH_CORRELATION') return '高相关提示';
  if (normalized === 'LOCAL_API_UNAVAILABLE') return '预览接口不可用';
  return normalized.replaceAll('_', ' ');
}

function localizeRiskText(value: string): string {
  return value
    .replaceAll('unsafe expression', '不安全表达式')
    .replaceAll('current-only 数据', '当前态数据')
    .replaceAll('READY', '通过')
    .replaceAll('BLOCKED', '阻断')
    .replaceAll('MULTI_FACTOR', '多因子策略');
}

function riskItemLabel(item: FactorModelRiskItem): string {
  return localizeRiskText(item.label || item.message || blockerLabel(item.code));
}

function previewStrategyRisk(preview: FactorModelPreview): FactorModelStrategyCreationRisk | null {
  return preview.strategyCreationRisk ?? preview.strategy_creation_risk ?? null;
}

function buildLocalPreview(
  selectedFactors: FactorModelOption[],
  selectedSelections: FactorModelSelection[],
  neutralizationEnabled: boolean,
  previewError: string | null,
): FactorModelPreview {
  const weightBase = selectedSelections.reduce((total, selection) => total + Math.abs(selection.weightPct), 0);
  const lowPitFactors = selectedFactors.filter((factor) => factor.pitCoveragePct < 80);
  const coveragePct = selectedFactors.length ? Math.min(...selectedFactors.map((factor) => factor.pitCoveragePct)) : 0;
  const localHardBlockers: FactorModelRiskItem[] = [
    ...lowPitFactors.map((factor) => ({
      code: 'PIT_BLOCKED',
      severity: 'blocker',
      label: `${factor.displayName} PIT 覆盖不足`,
      message: `${factor.displayName} PIT 覆盖不足`,
      factor_id: factor.id,
    })),
    ...(previewError ? [{
      code: 'LOCAL_API_UNAVAILABLE',
      severity: 'blocker',
      label: '预览接口不可用',
      message: previewError,
    }] : []),
  ];
  return {
    status: lowPitFactors.length || previewError ? 'BLOCKED' : 'LOCAL_PENDING_API_PREVIEW',
    coveragePct,
    factorCount: selectedSelections.length,
    readyFactorCount: selectedSelections.length - lowPitFactors.length,
    universeSymbolCount: 0,
    turnoverPct: 0,
    scoreSpread: 0,
    scorePreview: [],
    normalizedWeights: selectedSelections.map((selection) => ({
      factorId: selection.factorId,
      weightPct: selection.weightPct,
      normalizedWeightPct: weightBase > 0 ? (Math.abs(selection.weightPct) / weightBase) * 100 : 0,
      direction: selection.direction,
    })),
    pitBlockers: [
      ...lowPitFactors.map((factor) => `${factor.displayName} PIT 覆盖不足`),
      ...(previewError ? ['LOCAL_API_UNAVAILABLE'] : []),
    ],
    neutralizationStatus: {
      enabled: neutralizationEnabled,
      method: 'industry',
      status: previewError ? 'NOT_EXECUTED_PREVIEW_API_UNAVAILABLE' : 'LOCAL_PENDING_API_PREVIEW',
      blockers: previewError ? ['LOCAL_API_UNAVAILABLE'] : [],
    },
    warnings: previewError ? [previewError] : [],
    strategyCreationRisk: {
      can_create: localHardBlockers.length === 0 && !previewError,
      warning_count: 0,
      blocked_count: localHardBlockers.length,
      warnings: [],
      hard_blockers: localHardBlockers,
      summary_label: localHardBlockers.length ? '存在硬阻断' : '等待预览接口确认风险',
    },
  };
}

function previewTone(status: string, blockers: string[]): 'good' | 'warn' | 'bad' {
  if (status === 'READY' && blockers.length === 0) return 'good';
  if (blockers.length > 0 || status === 'BLOCKED') return 'bad';
  return 'warn';
}

function coverageAdvice(value: number, pending: boolean): string {
  if (pending) return '等待预览结果后评估样本有效性。';
  if (value >= 90) return '覆盖稳健，可进入门禁复核。';
  if (value >= 80) return '覆盖可用，建议检查低覆盖因子。';
  return '覆盖偏低，先补齐 PIT 样本。';
}

function turnoverAdvice(value: number, pending: boolean): string {
  if (pending) return '等待预览结果后评估调仓压力。';
  if (value <= 15) return '换手温和，成本压力可控。';
  if (value <= 30) return '换手适中，建议复核成本假设。';
  return '换手偏高，建议降低高频信号权重。';
}

function scoreSpreadAdvice(value: number, pending: boolean): string {
  if (pending) return '等待预览结果后评估分层能力。';
  if (value >= 1) return '分层清晰，可继续检查尾部风险。';
  if (value >= 0.4) return '分层可用，建议观察边际样本。';
  return '分层偏弱，建议调整权重或方向。';
}

export function FactorModelBuilderPage({
  api,
  autoPreviewDelayMs = 0,
  factors = DEFAULT_FACTORS,
  initialPrefill,
  useDefaultFallback = true,
  defaultSelectAll = true,
  onCreated,
}: FactorModelBuilderPageProps): JSX.Element {
  const isCompositeMode = initialPrefill?.strategyType === 'COMPOSITE_FACTOR';
  const basketFactors = useMemo(() => {
    const basket = modelBasket(factors, useDefaultFallback);
    return isCompositeMode ? basket.filter(isCompositeModelFactor) : basket;
  }, [factors, isCompositeMode, useDefaultFallback]);
  const [modelName, setModelName] = useState(isCompositeMode ? '组合因子策略' : DEFAULT_MODEL_NAME);
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    defaultSelectAll ? basketFactors.map((factor) => factor.id) : [],
  );
  const [selections, setSelections] = useState<FactorModelSelection[]>(() => normalizeSelections(factors, useDefaultFallback));
  const [neutralizationEnabled, setNeutralizationEnabled] = useState(false);
  const [rebalanceFrequency, setRebalanceFrequency] = useState('monthly');
  const [topN, setTopN] = useState(() => (isCompositeMode ? 50 : defaultTopNForFactorCount(basketFactors.length)));
  const [universeFilter, setUniverseFilter] = useState(DEFAULT_COMPOSITE_UNIVERSE_FILTER);
  const [weightMapping, setWeightMapping] = useState(DEFAULT_COMPOSITE_WEIGHT_MAPPING);
  const [rebalanceLogic, setRebalanceLogic] = useState(DEFAULT_COMPOSITE_REBALANCE_LOGIC);
  const [executionConstraints, setExecutionConstraints] = useState(DEFAULT_COMPOSITE_EXECUTION_CONSTRAINTS);
  const [preview, setPreview] = useState<FactorModelPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const previewRequestSeq = useRef(0);
  const prefillAppliedRef = useRef('');

  const selectedFactors = useMemo(
    () => basketFactors.filter((factor) => selectedIds.includes(factor.id)),
    [basketFactors, selectedIds],
  );
  const selectedSelections = useMemo(
    () => selections.filter((selection) => selectedIds.includes(selection.factorId)),
    [selectedIds, selections],
  );
  const weightTotal = selectedSelections.reduce((total, selection) => total + selection.weightPct, 0);
  const effectiveWeightTotal = isCompositeMode && selectedFactors.length ? 100 : weightTotal;
  const minPitCoverage = selectedFactors.length
    ? Math.min(...selectedFactors.map((factor) => factor.pitCoveragePct))
    : 0;
  const weightBlocked = Math.round(effectiveWeightTotal) !== 100;
  const modelNameBlocked = modelName.trim().length === 0;
  const topNBlocked = !Number.isInteger(topN) || topN < 1 || topN > 500;
  const topNValidationMessage = '持仓数量必须是 1 到 500 的整数。';

  const neutralization: FactorModelNeutralizationConfig = useMemo(() => ({
    enabled: neutralizationEnabled,
    taxonomy: 'GICS',
    level: 'Level 1',
    method: 'ZScore 后残差化',
  }), [neutralizationEnabled]);

  const payload: FactorModelPreviewPayload = useMemo(() => ({
    strategyType: isCompositeMode ? 'COMPOSITE_FACTOR' : 'MULTI_FACTOR',
    modelName: modelName.trim(),
    factors: isCompositeMode ? selectedSelections.slice(0, 1).map((selection) => ({ ...selection, weightPct: 100 })) : selectedSelections,
    neutralization,
    rebalanceFrequency: isCompositeMode ? rebalanceLogic.frequency : rebalanceFrequency,
    topN,
    ...(isCompositeMode ? {
      universeFilter,
      weightMapping,
      rebalanceLogic,
      executionConstraints,
    } : {}),
  }), [executionConstraints, isCompositeMode, modelName, neutralization, rebalanceFrequency, rebalanceLogic, selectedSelections, topN, universeFilter, weightMapping]);
  const payloadKey = useMemo(() => JSON.stringify(payload), [payload]);
  const prefillKey = useMemo(() => JSON.stringify(initialPrefill ?? null), [initialPrefill]);
  const localPreview = useMemo(
    () => buildLocalPreview(selectedFactors, selectedSelections, neutralizationEnabled, previewError),
    [neutralizationEnabled, previewError, selectedFactors, selectedSelections],
  );
  const activePreview = preview ?? localPreview;
  const neutralizationBlockers = activePreview.neutralizationStatus.blockers;
  const strategyRisk = previewStrategyRisk(activePreview);
  const explicitStrategyRisk = strategyRisk !== null;
  const strategyHardBlockers = strategyRisk?.hard_blockers ?? [];
  const strategyWarnings = [
    ...(strategyRisk?.warnings ?? []),
    ...(!strategyRisk ? activePreview.warnings.map((warning) => ({
      code: 'PREVIEW_WARNING',
      severity: 'warning',
      label: warning,
      message: warning,
    })) : []),
  ];
  const explicitPitHardBlocked = strategyHardBlockers.some((item) => {
    const code = String(item.code ?? '').toUpperCase();
    return code.includes('PIT') || code.includes('PRICE_10Y') || code.includes('UNIVERSE_10Y');
  });
  const pitBlocked = explicitStrategyRisk
    ? explicitPitHardBlocked
    : activePreview.pitBlockers.length > 0 || minPitCoverage < 80;
  const neutralizationBlocked =
    neutralizationEnabled &&
    (neutralizationBlockers.length > 0 || activePreview.neutralizationStatus.status.startsWith('NOT_EXECUTED'));
  const legacyPreviewBlocked =
    Boolean(previewError) ||
    activePreview.status === 'BLOCKED' ||
    pitBlocked ||
    neutralizationBlocked;
  const policyHardBlocked =
    strategyHardBlockers.length > 0 ||
    (strategyRisk?.can_create === false && strategyHardBlockers.length === 0) ||
    (!explicitStrategyRisk && legacyPreviewBlocked);
  const previewBlocked =
    activePreview.status === 'LOCAL_PENDING_API_PREVIEW' ||
    policyHardBlocked;
  const canCreate =
    Boolean(api?.createFactorModel) &&
    !modelNameBlocked &&
    selectedFactors.length > 0 &&
    !topNBlocked &&
    !weightBlocked &&
    !previewBlocked &&
    !isCreating &&
    !isPreviewing;
  const toggleFactor = (factor: FactorModelOption): void => {
    setSelectedIds((current) => {
      if (isCompositeMode) {
        return current.includes(factor.id) ? [] : [factor.id];
      }
      if (current.includes(factor.id)) {
        return current.filter((id) => id !== factor.id);
      }
      return [...current, factor.id];
    });
  };

  useEffect(() => {
    if (!initialPrefill?.factorIds.length) return;
    const availableIds = new Set(basketFactors.map((factor) => factor.id));
    const nextIds = initialPrefill.factorIds.filter((factorId) => availableIds.has(factorId));
    if (!nextIds.length) return;
    const effectiveNextIds = isCompositeMode ? nextIds.slice(0, 1) : nextIds;
    const appliedKey = `${prefillKey}:${effectiveNextIds.join('|')}`;
    if (prefillAppliedRef.current === appliedKey) return;
    prefillAppliedRef.current = appliedKey;
    setSelectedIds(effectiveNextIds);
    setSelections((current) => {
      const currentById = new Map(current.map((selection) => [selection.factorId, selection]));
      return basketFactors.map((factor) => {
        const prefillIndex = initialPrefill.factorIds.indexOf(factor.id);
        const existing = currentById.get(factor.id);
        const defaultSelection = existing ?? {
          factorId: factor.id,
          weightPct: factor.defaultWeight,
          direction: factor.defaultDirection,
        };
        if (prefillIndex === -1) return defaultSelection;
        const weight = initialPrefill.weights[prefillIndex];
        return {
          factorId: factor.id,
          weightPct: isCompositeMode ? 100 : Number.isFinite(weight) ? Math.max(0, Math.min(100, Number(weight))) : defaultSelection.weightPct,
          direction: normalizePrefillDirection(initialPrefill.directions[prefillIndex], defaultSelection.direction),
        };
      });
    });
    if (initialPrefill.modelName) {
      setModelName(initialPrefill.modelName);
    }
    setNotice('治理任务已代入因子与建议权重，当前仍为待审查草稿。');
  }, [basketFactors, initialPrefill, isCompositeMode, prefillKey]);

  const updateWeight = (factorId: string, rawValue: string): void => {
    const value = Math.max(0, Math.min(100, Number(rawValue) || 0));
    setSelections((current) =>
      current.map((selection) =>
        selection.factorId === factorId ? { ...selection, weightPct: value } : selection,
      ),
    );
  };

  const updateTopN = (rawValue: string): void => {
    if (rawValue.trim().length === 0) {
      setTopN(0);
      return;
    }
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      setTopN(0);
      return;
    }
    setTopN(Math.max(0, Math.min(500, Math.trunc(value))));
  };

  const runPreview = useCallback(async (announce = true): Promise<void> => {
    const requestSeq = previewRequestSeq.current + 1;
    previewRequestSeq.current = requestSeq;
    setIsPreviewing(true);
    setPreviewError(null);
    if (topNBlocked) {
      if (previewRequestSeq.current === requestSeq) {
        setPreview(buildLocalPreview(selectedFactors, selectedSelections, neutralizationEnabled, topNValidationMessage));
        setPreviewError(topNValidationMessage);
        setIsPreviewing(false);
        if (announce) setNotice(topNValidationMessage);
      }
      return;
    }
    if (selectedFactors.length === 0 || selectedSelections.length === 0) {
      if (previewRequestSeq.current === requestSeq) {
        setPreview(buildLocalPreview(selectedFactors, selectedSelections, neutralizationEnabled, null));
        setIsPreviewing(false);
        if (announce) setNotice('暂无可预览因子。');
      }
      return;
    }
    if (!api?.previewFactorModel) {
      if (previewRequestSeq.current === requestSeq) {
        setPreview(buildLocalPreview(selectedFactors, selectedSelections, neutralizationEnabled, null));
        setIsPreviewing(false);
        if (announce) setNotice('已完成本地权重与 PIT 校验；未连接打分预览接口。');
      }
      return;
    }
    try {
      const response = await api.previewFactorModel(payload);
      if (previewRequestSeq.current !== requestSeq) return;
      setPreview(response);
      if (announce) setNotice('已通过预览接口刷新多因子打分和门禁状态。');
    } catch {
      if (previewRequestSeq.current !== requestSeq) return;
      const message = '预览接口不可用，当前不能物化策略。';
      setPreviewError(message);
      setPreview(buildLocalPreview(selectedFactors, selectedSelections, neutralizationEnabled, message));
      if (announce) setNotice(message);
    } finally {
      if (previewRequestSeq.current === requestSeq) {
        setIsPreviewing(false);
      }
    }
  }, [api, neutralizationEnabled, payload, selectedFactors, selectedSelections, topNBlocked, topNValidationMessage]);

  useEffect(() => {
    setPreview(null);
    if (autoPreviewDelayMs > 0) {
      const timer = window.setTimeout(() => {
        void runPreview(false);
      }, autoPreviewDelayMs);
      return () => window.clearTimeout(timer);
    }
    void runPreview(false);
    return undefined;
  }, [autoPreviewDelayMs, payloadKey, runPreview]);

  const saveDraft = (): void => {
    setNotice('草稿已保存。');
  };

  const createModel = async (): Promise<void> => {
    if (!api?.createFactorModel) {
      setNotice('创建接口不可用，当前不能物化策略。');
      return;
    }
    if (!canCreate) return;
    setIsCreating(true);
    try {
      const response = await api.createFactorModel(payload);
      setNotice(`已创建多因子策略：${response.strategy_id}`);
      if (onCreated) {
        onCreated(response.strategy_id);
      } else if (typeof window !== 'undefined') {
        window.location.hash = `#/strategies/${response.strategy_id}`;
      }
    } finally {
      setIsCreating(false);
    }
  };

  const neutralizationPitValue = neutralizationBlockers.length
    ? neutralizationBlockers.map(blockerLabel).join('、')
    : activePreview.neutralizationStatus.enabled
      ? '可用'
      : '未启用';
  const policyBlockers = Array.from(
    new Set([
      ...(strategyHardBlockers.length ? strategyHardBlockers.map(riskItemLabel) : []),
      ...(!explicitStrategyRisk ? activePreview.pitBlockers.map(blockerLabel) : []),
      ...(!explicitStrategyRisk ? neutralizationBlockers.map(blockerLabel) : []),
      ...(strategyRisk?.can_create === false && strategyHardBlockers.length === 0 ? ['策略创建风险策略阻断'] : []),
      ...(previewError ? ['预览接口不可用'] : []),
    ]),
  ).filter(Boolean);
  const inputBlockers = Array.from(
    new Set([
      ...(modelNameBlocked ? ['策略名称未填写'] : []),
      ...(topNBlocked ? [topNValidationMessage] : []),
      ...(weightBlocked ? [`权重合计为 ${pct(effectiveWeightTotal, 0)}`] : []),
    ]),
  ).filter(Boolean);
  const warningLabels = Array.from(new Set(strategyWarnings.map(riskItemLabel).filter(Boolean)));
  const strategyRiskLabel =
    typeof strategyRisk?.summary_label === 'string' && strategyRisk.summary_label.trim()
      ? strategyRisk.summary_label
      : null;
  const strategyRiskSummary =
    typeof strategyRisk?.summary === 'string' && strategyRisk.summary.trim()
      ? strategyRisk.summary
      : null;
  const riskSummaryTone: 'good' | 'warn' | 'bad' = policyBlockers.length || inputBlockers.length
    ? 'bad'
    : warningLabels.length
      ? 'warn'
      : 'good';
  const pitSoftenedForAdmission =
    explicitStrategyRisk &&
    strategyRisk?.blocked_count === 0 &&
    strategyRiskLabel === '低风险准入' &&
    activePreview.pitBlockers.length > 0;
  const pitGateValue = pitBlocked ? (pitSoftenedForAdmission ? '低风险提示' : '阻断') : '通过';
  const pitGateTone: 'good' | 'warn' | 'bad' = pitBlocked ? (pitSoftenedForAdmission ? 'warn' : 'bad') : 'good';
  const admissionPricePitValue = pitSoftenedForAdmission ? '低风险提示' : pitBlocked ? '阻断' : '10Y通过';
  const admissionPricePitTone: 'good' | 'warn' | 'bad' = pitSoftenedForAdmission ? 'warn' : pitBlocked ? 'bad' : 'good';
  const selectedRebalanceOption =
    REBALANCE_OPTIONS.find((option) => option.value === rebalanceFrequency) ?? REBALANCE_OPTIONS[0];
  const gateRows: Array<{ label: string; value: string; tone: 'good' | 'warn' | 'bad' }> = [
    { label: '基础面 available_at 校验', value: pitGateValue, tone: pitGateTone },
    { label: '价格与 Universe PIT(10Y)', value: admissionPricePitValue, tone: admissionPricePitTone },
    { label: '行业 PIT 状态', value: neutralizationPitValue, tone: neutralizationBlocked ? 'bad' : 'good' },
    { label: '压力场景覆盖', value: explicitStrategyRisk ? '审计提示' : '等待 API', tone: warningLabels.length ? 'warn' : 'good' },
    { label: '策略名称', value: modelNameBlocked ? '待填写' : '已填写', tone: modelNameBlocked ? 'bad' : 'good' },
    { label: '持仓数量', value: topNBlocked ? '无效' : String(topN), tone: topNBlocked ? 'bad' : 'good' },
    { label: '权重合计', value: pct(effectiveWeightTotal, 0), tone: weightBlocked ? 'bad' : 'good' },
    { label: '再平衡配置', value: selectedRebalanceOption.label, tone: 'good' },
    { label: '预览状态', value: localizePreviewStatus(activePreview.status), tone: previewTone(activePreview.status, policyBlockers) },
    {
      label: '实盘准入',
      value: policyBlockers.length ? '阻断' : strategyRiskLabel ?? (warningLabels.length ? '风险提示' : '低风险'),
      tone: riskSummaryTone,
    },
    { label: '策略类型', value: '多因子策略', tone: 'good' },
  ];
  const riskTitle = policyBlockers.length
    ? '存在硬阻断'
    : inputBlockers.length
      ? '创建信息待补'
    : warningLabels.length
      ? strategyRiskLabel ?? '可创建，需确认风险'
      : '可创建，无新增风险';
  const riskCopy = policyBlockers.length
    ? `不能创建：${policyBlockers.join('；')}。`
    : inputBlockers.length
      ? `当前阻塞：${inputBlockers.join('；')}。`
    : strategyRiskSummary
      ? strategyRiskSummary
    : warningLabels.length
      ? `可创建但需提示：${warningLabels.join('；')}。`
      : activePreview.status === 'READY'
        ? `预览接口返回通过：${activePreview.readyFactorCount}/${activePreview.factorCount} 个因子可用，覆盖 ${pct(activePreview.coveragePct)}。`
        : '等待预览接口返回 PIT、权重、中性化与打分样本。';
  const scorePending = isPreviewing && !preview;
  const scoreCards = [
    { label: '有效覆盖率', value: scorePending ? '读取中' : pct(activePreview.coveragePct), note: coverageAdvice(activePreview.coveragePct, scorePending) },
    { label: '预估换手', value: scorePending ? '读取中' : pct(activePreview.turnoverPct), note: turnoverAdvice(activePreview.turnoverPct, scorePending) },
    { label: '得分分布跨度', value: scorePending ? '读取中' : activePreview.scoreSpread.toFixed(2), note: scoreSpreadAdvice(activePreview.scoreSpread, scorePending) },
  ];
  const scoreBars = activePreview.scorePreview.slice(0, 10);
  const scoreValues = scoreBars.map((item) => item.score);
  const minScore = scoreValues.length ? Math.min(...scoreValues) : 0;
  const maxScore = scoreValues.length ? Math.max(...scoreValues) : 0;
  const scoreSpan = Math.max(maxScore - minScore, 0.0001);
  const compositeDiagnostic = (activePreview.diagnosticSummary ?? strategyRisk?.diagnostic_summary ?? {}) as Record<string, unknown>;
  const compositeSectorForecast = (activePreview.sectorCapForecast ?? strategyRisk?.sector_cap_forecast ?? {}) as Record<string, unknown>;
  const compositeCostForecast = (activePreview.costForecast ?? strategyRisk?.cost_forecast ?? {}) as Record<string, unknown>;
  const compositeEligibility = (strategyRisk?.eligibility ?? {}) as Record<string, unknown>;
  const compositeCompletedOps = new Set(
    Array.isArray(compositeEligibility.completed_ops) ? compositeEligibility.completed_ops.map(String) : [],
  );
  const compositeMissingOps = new Set(
    Array.isArray(compositeEligibility.missing_ops) ? compositeEligibility.missing_ops.map(String) : [],
  );
  const weakSectors = Array.isArray(compositeDiagnostic.weak_sectors)
    ? compositeDiagnostic.weak_sectors.slice(0, 3).filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    : [];

  if (isCompositeMode) {
    const selectedCompositeFactor = selectedFactors[0] ?? null;
    const createBlockedCopy = policyBlockers.length || inputBlockers.length
      ? [...policyBlockers, ...inputBlockers].slice(0, 3).join('；')
      : '准入、权重与成本参数已完成预检。';
    return (
      <main className="factor-phase2-page factor-model-builder-page factor-model-builder-page--composite" data-page-root="factor-model-builder">
        <section className="factor-phase2-hero" aria-labelledby="composite-factor-title">
          <div>
            <p className="factor-phase2-hero__eyebrow">COMPOSITE_FACTOR / 美股 L3 因子策略</p>
            <h1 id="composite-factor-title">组合因子策略创建</h1>
            <p>以一个已完成 WNZT、S/A 级、L3 美股因子为信号源，配置股票池、权重映射、再平衡和实盘约束后直接进入回测与优化。</p>
          </div>
          <div className="factor-phase2-actions" aria-label="组合因子策略操作">
            <button className="factor-phase2-button" type="button" onClick={saveDraft}>保存草稿</button>
            <button className="factor-phase2-button" type="button" disabled={isPreviewing} onClick={() => void runPreview()}>
              {isPreviewing ? '预检中' : '刷新预检'}
            </button>
            <button className="factor-phase2-button factor-phase2-button--primary" type="button" disabled={!canCreate} onClick={() => void createModel()}>
              创建回测
            </button>
          </div>
        </section>

        <section className="factor-phase2-workbench factor-phase2-workbench--model composite-builder-grid" aria-label="组合因子策略配置">
          <section className="factor-phase2-panel composite-source-panel" aria-labelledby="composite-factor-source">
            <div className="factor-phase2-panel__header">
              <div>
                <h2 id="composite-factor-source">因子来源</h2>
                <p>仅支持 WNZT 完成、S/A 级、L3 的美股因子，单因子权重固定为 100%。</p>
              </div>
            </div>
            <div className="factor-phase2-panel__body">
              <label className="factor-model-name-control">
                <span>策略名称</span>
                <input aria-label="策略名称" maxLength={80} onChange={(event) => setModelName(event.target.value)} type="text" value={modelName} />
              </label>
              <div className="factor-phase2-list factor-model-selector-list composite-factor-list">
                {!basketFactors.length ? (
                  <div className="factor-phase2-empty">暂无可配置候选。仅显示已完成 WNZT、S/A 级、L3 的美股因子。</div>
                ) : null}
                {basketFactors.map((factor) => {
                  const isSelected = selectedIds.includes(factor.id);
                  return (
                    <div className={`factor-pick${isSelected ? '' : ' factor-pick--inactive'}`} key={factor.id}>
                      <input aria-label={`选择${factor.displayName}`} checked={isSelected} onChange={() => toggleFactor(factor)} type="checkbox" />
                      <div>
                        <strong>{factor.displayName}</strong>
                        <span className="factor-id">{factor.id}</span>
                        <FactorMetricTags factor={factor} context="因子准入" />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="locked-weight">
                <span>因子权重</span>
                <strong>100%</strong>
              </div>
              <article className="diagnostic-card">
                <div>
                  <span>Diagnostic Summary</span>
                  <strong>{selectedCompositeFactor?.displayName ?? '请选择一个合格因子'}</strong>
                </div>
                <dl className="diagnostic-kpis">
                  <div><dt>Rank IC</dt><dd>{recordNumber(compositeDiagnostic, 'rank_ic', 0).toFixed(3)}</dd></div>
                  <div><dt>IR</dt><dd>{recordNumber(compositeDiagnostic, 'ir', 0).toFixed(2)}</dd></div>
                  <div><dt>覆盖率</dt><dd>{pct(recordNumber(compositeDiagnostic, 'coverage', 0) * (recordNumber(compositeDiagnostic, 'coverage', 0) <= 1 ? 100 : 1), 1)}</dd></div>
                </dl>
                <div className="diagnostic-weak-list">
                  {weakSectors.length ? weakSectors.map((sector, index) => (
                    <span key={`${recordString(sector, 'group', `weak-${index}`)}-${index}`}>
                      {recordString(sector, 'group', recordString(sector, 'sector', '弱势分组'))}: {recordNumber(sector, 'mean_return', 0).toFixed(3)}
                    </span>
                  )) : <span>等待预检返回行业诊断。</span>}
                </div>
              </article>
            </div>
          </section>

          <section className="factor-phase2-panel composite-steps-panel" aria-labelledby="composite-config-flow">
            <div className="factor-phase2-panel__header">
              <div>
                <h2 id="composite-config-flow">配置流程</h2>
                <p>先定义不可交易边界，再把因子分数转成目标仓位，并估算换手与交易成本。</p>
              </div>
            </div>
            <div className="factor-phase2-panel__body composite-step-stack">
              <article className="composite-step-card" aria-label="股票池过滤">
                <header><span>01</span><strong>股票池过滤</strong></header>
                <div className="control-grid control-grid--two">
                  <label><span>成交额门槛 ADV</span><input aria-label="成交额门槛 ADV" type="number" value={universeFilter.minAdvUsd} onChange={(event) => setUniverseFilter((current) => ({ ...current, minAdvUsd: Number(event.target.value) || 0 }))} /></label>
                  <label><span>统计周期</span><select aria-label="ADV 统计周期" value={universeFilter.advWindow} onChange={(event) => setUniverseFilter((current) => ({ ...current, advWindow: event.target.value as '20D' | '60D' }))}><option value="20D">20D</option><option value="60D">60D</option></select></label>
                  <label><span>退市窗口</span><input aria-label="退市窗口" type="number" value={universeFilter.delistingWindowDays} onChange={(event) => setUniverseFilter((current) => ({ ...current, delistingWindowDays: Number(event.target.value) || 0 }))} /></label>
                  <label><span>行业干预</span><select aria-label="行业干预" value={universeFilter.sectorOverrides.utilities ? 'utilities' : universeFilter.sectorOverrides.realEstate ? 'realEstate' : 'none'} onChange={(event) => setUniverseFilter((current) => ({ ...current, sectorOverrides: { utilities: event.target.value === 'utilities', realEstate: event.target.value === 'realEstate' } }))}><option value="none">不调整</option><option value="utilities">公用事业保守降权</option><option value="realEstate">房地产压力检查</option></select></label>
                </div>
                <div className="check-row">
                  <label><input type="checkbox" checked={universeFilter.excludeHalted} onChange={(event) => setUniverseFilter((current) => ({ ...current, excludeHalted: event.target.checked }))} />停牌</label>
                  <label><input type="checkbox" checked={universeFilter.excludeOtcPink} onChange={(event) => setUniverseFilter((current) => ({ ...current, excludeOtcPink: event.target.checked }))} />OTC/Pink</label>
                  <label><input type="checkbox" checked={universeFilter.excludeLuldPaused} onChange={(event) => setUniverseFilter((current) => ({ ...current, excludeLuldPaused: event.target.checked }))} />LULD 暂停</label>
                  <label><input type="checkbox" checked={universeFilter.delistingWindowDays > 0} onChange={(event) => setUniverseFilter((current) => ({ ...current, delistingWindowDays: event.target.checked ? 30 : 0 }))} />退市窗口</label>
                </div>
              </article>

              <article className="composite-step-card" aria-label="权重映射">
                <header><span>02</span><strong>权重映射</strong></header>
                <div className="segmented-control" role="group" aria-label="映射模式">
                  {[
                    ['equal_top_k', '等权 Top-K'],
                    ['score_proportional', '分值比例法'],
                    ['risk_heuristic', '风险优化启发式'],
                  ].map(([value, label]) => (
                    <button key={value} className={weightMapping.method === value ? 'is-active' : ''} type="button" onClick={() => setWeightMapping((current) => ({ ...current, method: value as typeof weightMapping.method }))}>{label}</button>
                  ))}
                </div>
                <div className="control-grid control-grid--four">
                  <label><span>Top-N</span><input aria-label="Top-N" type="number" value={topN} onChange={(event) => updateTopN(event.target.value)} /></label>
                  <label><span>行业上限 %</span><input aria-label="行业硬上限" type="number" value={weightMapping.sectorCapPct} onChange={(event) => setWeightMapping((current) => ({ ...current, sectorCapPct: Number(event.target.value) || 0 }))} /></label>
                  <label><span>个股上限 %</span><input aria-label="个股权重上限" type="number" value={weightMapping.maxPositionPct} onChange={(event) => setWeightMapping((current) => ({ ...current, maxPositionPct: Number(event.target.value) || 0 }))} /></label>
                  <label><span>最小权重 %</span><input aria-label="最小目标权重" type="number" value={weightMapping.minTargetWeightPct} onChange={(event) => setWeightMapping((current) => ({ ...current, minTargetWeightPct: Number(event.target.value) || 0 }))} /></label>
                </div>
                <div className="allocation-switch">
                  <span>裁断权重重分配</span>
                  <button type="button" className={weightMapping.capRedistributionMode === 'cash' ? 'is-active' : ''} onClick={() => setWeightMapping((current) => ({ ...current, capRedistributionMode: 'cash' }))}>保持现金</button>
                  <button type="button" className={weightMapping.capRedistributionMode === 'proportional_refill' ? 'is-active' : ''} onClick={() => setWeightMapping((current) => ({ ...current, capRedistributionMode: 'proportional_refill' }))}>按比例回填</button>
                </div>
              </article>

              <article className="composite-step-card" aria-label="再平衡逻辑">
                <header><span>03</span><strong>再平衡逻辑</strong></header>
                <div className="control-grid control-grid--four">
                  <label><span>调仓频率</span><select aria-label="调仓频率" value={rebalanceLogic.frequency} onChange={(event) => setRebalanceLogic((current) => ({ ...current, frequency: event.target.value as typeof rebalanceLogic.frequency }))}><option value="daily">每日</option><option value="weekly">每周</option><option value="monthly">每月</option></select></label>
                  <label><span>日历规则</span><select aria-label="调仓日历规则" value={rebalanceLogic.calendarRule} onChange={(event) => setRebalanceLogic((current) => ({ ...current, calendarRule: event.target.value }))}><option value="first_trading_day">首个交易日</option><option value="last_trading_day">最后交易日</option><option value="monday">周一</option></select></label>
                  <label><span>退出阈值 %</span><input aria-label="排名退出阈值" type="number" value={rebalanceLogic.exitRankPercentile} onChange={(event) => setRebalanceLogic((current) => ({ ...current, exitRankPercentile: Number(event.target.value) || 0 }))} /></label>
                  <label><span>最小交易额</span><input aria-label="最小交易金额" type="number" value={rebalanceLogic.minTradeNotionalUsd} onChange={(event) => setRebalanceLogic((current) => ({ ...current, minTradeNotionalUsd: Number(event.target.value) || 0 }))} /></label>
                </div>
              </article>

              <article className="composite-step-card" aria-label="实盘约束">
                <header><span>04</span><strong>实盘约束</strong></header>
                <div className="control-grid control-grid--three">
                  <label><span>初始本金</span><input aria-label="初始本金" type="number" value={executionConstraints.notionalUsd} onChange={(event) => setExecutionConstraints((current) => ({ ...current, notionalUsd: Number(event.target.value) || 0 }))} /></label>
                  <label><span>佣金 bps</span><input aria-label="佣金 bps" type="number" value={executionConstraints.commissionBps} onChange={(event) => setExecutionConstraints((current) => ({ ...current, commissionBps: Number(event.target.value) || 0 }))} /></label>
                  <label><span>印花税 bps</span><input aria-label="印花税 bps" type="number" value={executionConstraints.stampTaxBps} onChange={(event) => setExecutionConstraints((current) => ({ ...current, stampTaxBps: Number(event.target.value) || 0 }))} /></label>
                  <label><span>基础滑点 bps</span><input aria-label="基础滑点 bps" type="number" value={executionConstraints.baseSlippageBps} onChange={(event) => setExecutionConstraints((current) => ({ ...current, baseSlippageBps: Number(event.target.value) || 0 }))} /></label>
                  <label><span>冲击系数</span><input aria-label="冲击系数" type="number" value={executionConstraints.impactBeta} onChange={(event) => setExecutionConstraints((current) => ({ ...current, impactBeta: Number(event.target.value) || 0 }))} /></label>
                  <label><span>最大冲击 bps</span><input aria-label="最大冲击 bps" type="number" value={executionConstraints.maxImpactBps} onChange={(event) => setExecutionConstraints((current) => ({ ...current, maxImpactBps: Number(event.target.value) || 0 }))} /></label>
                </div>
              </article>
            </div>
          </section>

          <section className="factor-phase2-panel composite-validator-panel" aria-labelledby="composite-validator">
            <div className="factor-phase2-panel__header">
              <div>
                <h2 id="composite-validator">策略创建风险</h2>
                <p>根据当前配置实时校验准入、行业裁断和交易成本。</p>
              </div>
            </div>
            <div className="factor-phase2-panel__body">
              <div className={`strategy-risk-module strategy-risk-module--${riskSummaryTone}`}>
                <span className={`factor-phase2-chip factor-phase2-chip--${riskSummaryTone}`}>{riskTitle}</span>
                <p>{createBlockedCopy}</p>
              </div>
              <div className="wznt-strip" aria-label="WNZT 准入检查">
                {['W', 'N', 'Z', 'T'].map((code) => (
                  <span className={compositeCompletedOps.has(code) && !compositeMissingOps.has(code) ? 'is-active' : 'is-missing'} key={code}>{code}</span>
                ))}
              </div>
              <div className="risk-kpi-grid">
                <div><span>裁断权重</span><strong>{pct(recordNumber(compositeSectorForecast, 'cut_weight_pct', 0), 1)}</strong></div>
                <div><span>残余现金</span><strong>{pct(recordNumber(compositeSectorForecast, 'residual_cash_pct', 0), 1)}</strong></div>
                <div><span>满仓率</span><strong>{pct(recordNumber(compositeSectorForecast, 'invested_pct', 0), 1)}</strong></div>
                <div><span>平均滑点</span><strong>{recordNumber(compositeCostForecast, 'average_slippage_bps', 0).toFixed(1)} bps</strong></div>
              </div>
              <div className="strategy-risk-list strategy-risk-list--warning">
                <strong>美股执行过滤</strong>
                <span>停牌、OTC/Pink、LULD 暂停与退市窗口均纳入预检。</span>
              </div>
              <button className="factor-phase2-button factor-phase2-button--primary factor-model-submit" disabled={!canCreate} type="button" onClick={() => void createModel()}>
                创建回测
              </button>
            </div>
          </section>
        </section>

        <p className="sr-only" role="status">{notice ?? ''}</p>
      </main>
    );
  }

  return (
    <main className="factor-phase2-page factor-model-builder-page" data-page-root="factor-model-builder">
      <section className="factor-phase2-hero" aria-labelledby="factor-model-title">
        <div>
          <p className="factor-phase2-hero__eyebrow">多因子策略</p>
          <h1 id="factor-model-title">多因子策略创建</h1>
          <p>
            从系统默认因子和已验证人工因子中选择信号，配置权重、方向和行业中性化，零写入预览覆盖率、打分分布和换手，再物化为可回测策略。
          </p>
        </div>
        <div className="factor-phase2-actions" aria-label="多因子策略创建操作">
          <button className="factor-phase2-button" type="button" onClick={saveDraft}>
            保存草稿
          </button>
          <button className="factor-phase2-button" type="button" disabled={isPreviewing} onClick={() => void runPreview()}>
            {isPreviewing ? '预览中' : '预览打分'}
          </button>
          <button
            className="factor-phase2-button factor-phase2-button--primary"
            type="button"
            disabled={!canCreate}
            onClick={() => void createModel()}
          >
            创建可回测策略
          </button>
        </div>
      </section>

      {initialPrefill?.factorIds.length ? (
        <section className="factor-model-prefill-banner" aria-label="治理任务代入提示">
          <div>
            <strong>治理任务已代入</strong>
            <span>
              已选 {selectedIds.length} 个因子与建议权重，进入创建页后仍需预览、门禁和人工确认。
            </span>
          </div>
          <span className="factor-phase2-chip factor-phase2-chip--info">草稿 / 待审查</span>
        </section>
      ) : null}

      <section className="factor-phase2-workbench factor-phase2-workbench--model" aria-label="多因子模型工作台">
        <section className="factor-phase2-panel" aria-labelledby="factor-model-select">
          <div className="factor-phase2-panel__header">
            <div>
              <h2 id="factor-model-select">选择因子</h2>
              <p>只允许可诊断或沙盒可跑的因子参与预览。</p>
            </div>
          </div>
          <div className="factor-phase2-panel__body">
            <label className="factor-model-name-control">
              <span>策略名称</span>
              <input
                aria-label="策略名称"
                maxLength={80}
                onChange={(event) => setModelName(event.target.value)}
                placeholder="输入策略名称"
                type="text"
                value={modelName}
              />
            </label>
            <div className="factor-phase2-list factor-model-selector-list">
              {basketFactors.length === 0 ? (
                <div className="factor-empty-state">因子接口未返回可用因子，当前无法创建策略。</div>
              ) : null}
              {basketFactors.map((factor) => {
                const isSelected = selectedIds.includes(factor.id);
                return (
                  <div className={`factor-pick${isSelected ? '' : ' factor-pick--inactive'}`} key={factor.id}>
                    <input
                      aria-label={`选择${factor.displayName}`}
                      checked={isSelected}
                      onChange={() => toggleFactor(factor)}
                      type="checkbox"
                    />
                    <div>
                      <strong>{factor.displayName}</strong>
                      <span className="factor-id">{factor.id}</span>
                      <FactorMetricTags factor={factor} context="选择卡片" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="factor-phase2-panel" aria-labelledby="factor-model-preview">
          <div className="factor-phase2-panel__header">
            <div>
              <h2 id="factor-model-preview">权重与打分预览</h2>
              <p>MAD/Winsorize、ZScore、方向调整和行业中性化统一由表达式引擎执行。</p>
            </div>
            <span className="factor-phase2-chip factor-phase2-chip--good">零写入预览</span>
          </div>
          <div className="factor-phase2-panel__body">
            <div className="score-grid">
              {scoreCards.map((card) => (
                <div className="score-card" key={card.label}>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                  <small>{card.note}</small>
                </div>
              ))}
            </div>
            <div className="factor-model-weight-controls" aria-label="已选择因子权重操作条">
              {selectedFactors.map((factor) => {
                const selection = selectedSelections.find((item) => item.factorId === factor.id);
                const weight = selection?.weightPct ?? factor.defaultWeight;
                return (
                  <div className="factor-model-weight-row" key={factor.id}>
                    <div className="factor-model-weight-row__meta">
                      <div className="factor-model-weight-row__title">
                        <strong>{factor.displayName}</strong>
                        <span className="factor-id">{factor.id}</span>
                      </div>
                      <FactorMetricTags factor={factor} context="权重卡片" />
                    </div>
                    <div className="factor-weight-control factor-weight-control--preview">
                      <label htmlFor={`factor-weight-${factor.id}`}>权重</label>
                      <input
                        aria-label={`${factor.displayName}权重滑块`}
                        id={`factor-weight-${factor.id}`}
                        max="100"
                        min="0"
                        onChange={(event) => updateWeight(factor.id, event.target.value)}
                        step="1"
                        type="range"
                        value={weight}
                      />
                      <input
                        aria-label={`${factor.displayName}权重`}
                        inputMode="numeric"
                        max="100"
                        min="0"
                        onChange={(event) => updateWeight(factor.id, event.target.value)}
                        type="number"
                        value={weight}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="factor-model-governance-row" aria-label="再平衡与行业中性化配置">
              <div className="factor-model-rebalance-control" role="group" aria-labelledby="factor-model-rebalance-label">
                <div className="factor-model-rebalance-control__header">
                  <span id="factor-model-rebalance-label">再平衡配置</span>
                  <small>{selectedRebalanceOption.summary}</small>
                </div>
                <div className="factor-model-rebalance-options">
                  {REBALANCE_OPTIONS.map((option) => (
                    <label
                      className={`factor-model-rebalance-option${option.value === rebalanceFrequency ? ' factor-model-rebalance-option--active' : ''}`}
                      key={option.value}
                    >
                      <input
                        checked={option.value === rebalanceFrequency}
                        name="factor-model-rebalance-frequency"
                        onChange={() => setRebalanceFrequency(option.value)}
                        type="radio"
                        value={option.value}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="factor-model-top-n-control">
                <div className="factor-model-rebalance-control__header">
                  <span>持仓数量</span>
                  <small>每次调仓后保留的目标持仓数。</small>
                </div>
                <div className="factor-model-top-n-fields">
                  <label htmlFor="factor-model-top-n-input">持仓数量</label>
                  <input
                    aria-label="持仓数量"
                    id="factor-model-top-n-input"
                    inputMode="numeric"
                    max="500"
                    min="1"
                    onChange={(event) => updateTopN(event.target.value)}
                    step="1"
                    type="number"
                    value={topN > 0 ? topN : ''}
                  />
                </div>
                <div className="factor-model-top-n-summary">
                  <span>当前设置</span>
                  <strong>{topNBlocked ? '无效' : `${topN} 个标的`}</strong>
                </div>
              </div>
              <div className="neutral-block">
                <div className="neutral-title">
                  <div>
                    <strong>启用行业中性化</strong>
                    <span className="factor-id">GICS · PIT 行业字段</span>
                  </div>
                  <button
                    aria-label={neutralizationEnabled ? '关闭行业中性化' : '启用行业中性化'}
                    aria-pressed={neutralizationEnabled}
                    className={`switch${neutralizationEnabled ? '' : ' switch--off'}`}
                    onClick={() => setNeutralizationEnabled((current) => !current)}
                    type="button"
                  >
                    <span className="sr-only">{neutralizationEnabled ? '行业中性化已启用' : '行业中性化已关闭'}</span>
                  </button>
                </div>
                <div className="neutral-grid">
                  <div className="neutral-card">
                    <strong>覆盖</strong>
                    <span>{neutralizationPitValue === '可用' ? '行业 PIT 可用' : neutralizationPitValue}</span>
                  </div>
                  <div className="neutral-card">
                    <strong>阶段</strong>
                    <span>{neutralizationBlocked ? `未执行：${neutralizationPitValue}` : neutralizationEnabled ? '打分前行业残差化' : '保留原始截面分'}</span>
                  </div>
                  <div className="neutral-card">
                    <strong>缺口</strong>
                    <span>{activePreview.warnings[0] ?? (neutralizationEnabled ? '无缺口，允许物化' : '未启用，无需行业 PIT')}</span>
                  </div>
                </div>
              </div>
            </div>
            <svg viewBox="0 0 680 150" width="100%" height="150" role="img" aria-label="多因子得分分布">
              <rect x="0" y="0" width="680" height="150" rx="14" fill="#f9fafb" />
              <line x1="36" y1="118" x2="650" y2="118" stroke="#d7e1e5" />
              {scoreBars.length ? scoreBars.map((point, index) => {
                const height = 24 + ((point.score - minScore) / scoreSpan) * 68;
                const x = 70 + index * 48;
                const y = 118 - height;
                const fill = index < 2 ? '#dbeafe' : index < 4 ? '#9dd6cf' : index < 7 ? '#1f877b' : '#bfdbfe';
                return <rect key={`${point.symbol}-${index}`} x={x} y={y} width="38" height={height} rx="5" fill={fill} />;
              }) : (
                <text x="236" y="78" fill="#64748b" fontSize="13" fontWeight="600">等待预览接口返回样本</text>
              )}
              <text x="70" y="138" fill="#64748b" fontSize="12">{scoreBars[0]?.symbol ?? '低分'}</text>
              <text x="408" y="138" fill="#64748b" fontSize="12">{scoreBars[scoreBars.length - 1]?.symbol ?? '高分'}</text>
              <text x="244" y="20" fill="#176b61" fontSize="13" fontWeight="700">
                {scoreBars.length ? `样本 ${scoreBars.length} 个 · 分布跨度 ${activePreview.scoreSpread.toFixed(2)}` : '零写入打分样本'}
              </text>
            </svg>
          </div>
        </section>

        <section className="factor-phase2-panel" aria-labelledby="factor-model-gates">
          <div className="factor-phase2-panel__header">
            <div>
              <h2 id="factor-model-gates">策略创建风险</h2>
              <p>区分风险提示与硬阻断；高相关只提示，PIT 与表达式问题才阻断。</p>
            </div>
          </div>
          <div className="factor-phase2-panel__body">
            <div className="audit-list">
              {gateRows.map((row) => (
                <div className="audit-row" key={row.label}>
                  <span>{row.label}</span>
                  <span className={`factor-phase2-chip factor-phase2-chip--${row.tone}`}>{row.value}</span>
                </div>
              ))}
            </div>
            <div className={`strategy-risk-module strategy-risk-module--${riskSummaryTone}`} aria-label="策略创建风险模块">
              <div className="strategy-risk-summary">
                <span className={`factor-phase2-chip factor-phase2-chip--${riskSummaryTone}`}>{riskTitle}</span>
                <p>{riskCopy}</p>
              </div>
              {policyBlockers.length ? (
                <div className="strategy-risk-list" aria-label="硬阻断">
                  <strong>硬阻断</strong>
                  {policyBlockers.slice(0, 4).map((blocker) => <span key={blocker}>{blocker}</span>)}
                </div>
              ) : null}
              {warningLabels.length ? (
                <div className="strategy-risk-list strategy-risk-list--warning" aria-label="风险提示">
                  <strong>风险提示</strong>
                  {warningLabels.slice(0, 4).map((warning) => <span key={warning}>{warning}</span>)}
                </div>
              ) : null}
              {!policyBlockers.length && !warningLabels.length ? (
                <div className="strategy-risk-list strategy-risk-list--clear">
                  <strong>创建口径</strong>
                  <span>当前没有高相关、诊断过期或硬阻断；创建后进入既有回测链路。</span>
                </div>
              ) : null}
            </div>
            <button
              className="factor-phase2-button factor-phase2-button--primary factor-model-submit"
              disabled={!canCreate}
              type="button"
              onClick={() => void createModel()}
            >
              创建可回测策略
            </button>
          </div>
        </section>
      </section>

      <p className="sr-only" role="status">{notice ?? ''}</p>
    </main>
  );
}

export default FactorModelBuilderPage;

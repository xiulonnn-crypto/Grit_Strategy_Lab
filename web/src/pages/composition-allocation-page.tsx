import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { formatBenchmarkLabel } from '../lib/compose-display';
import { useApiClient } from '../lib/demoStoreContext';
import type { ApiCompositionAllocationJob } from '../types';
import './composition-allocation-page.css';

type AllocationIntentKey = 'min-vol' | 'risk-parity' | 'max-sharpe' | 'expert';
type AllocationObjectiveKey = Exclude<AllocationIntentKey, 'expert'>;
type ConstraintChipKey = 'cash' | 'turnover' | 'volatility' | 'data-gate';
type TurnoverBand = 'low' | 'medium' | 'high';
type HistoryPreset = '3y' | '5y' | '10y' | 'custom';
type SelectorTone = 'good' | 'neutral' | 'warn' | 'cost';

type AllocationLeg = {
  id: string;
  name: string;
  role: string;
  legKind: string;
  sourceRefId: string;
  sourceRefType: string | null;
  displayName: string;
  ordering: number;
  config: Record<string, unknown>;
  currentWeight: number;
  minWeight: number;
  maxWeight: number;
  locked: boolean;
  expectedReturn: number;
  riskContribution: number;
};

type AllocationLegConstraint = {
  locked: boolean;
  maxWeight: number;
  minWeight: number;
};

type AllocationModel = {
  compositionName: string;
  benchmarkLabel: string;
  dataQualityLabel: string;
  updatedLabel: string;
  currentMetrics: AllocationCurrentMetrics;
  legs: AllocationLeg[];
  stressScenarios: AllocationStressScenario[];
};

type AllocationCurrentMetrics = {
  annualReturn: number;
  volatility: number;
  sharpe: number;
  maxDrawdown: number;
  enb: number;
  trackingError: number;
  migrationCostBps: number;
  liquidityPressurePct: number;
  recoveryDays: number;
  defensiveAlpha: number;
};

type AllocationBenchmarkMetrics = AllocationCurrentMetrics & {
  label: string;
};

type AllocationStressScenario = {
  benchmarkDrawdown: number | null;
  currentDrawdown: number;
  period: string;
  source: string;
  title: string;
};

type AllocationCandidate = {
  id: string;
  label: string;
  intentKey: AllocationObjectiveKey;
  objectiveKey: AllocationObjectiveKey;
  rank: number;
  annualReturn: number;
  volatility: number;
  sharpe: number;
  netSharpe: number;
  enb: number;
  trackingError: number;
  maxDrawdown: number;
  recoveryDays: number;
  defensiveAlpha: number;
  liquidityPressurePct: number;
  turnover: number;
  migrationCostBps: number;
  stress: string;
  verdict: string;
  sourceEvidence: string;
  canPromote?: boolean;
  executionLimited?: boolean;
  promotionReadiness?: AllocationPromotionReadiness | null;
  violation?: string;
  weights: Array<{ legId: string; weight: number; risk: number }>;
};

type AllocationPromotionReadiness = {
  status: string;
  evidenceGrade: string | null;
  blockers: string[];
  policyViolationCount: number;
};

type FrontierPoint = {
  id: string;
  label: string;
  annualReturn: number;
  volatility: number;
  left: number;
  top: number;
  type?: 'current' | 'benchmark' | 'min-vol' | 'max-sharpe' | 'risk-parity';
  weights: Array<{ legId: string; weight: number }>;
};

const INTENTS: Array<{
  key: AllocationIntentKey;
  label: string;
  meta: string;
  body: string;
  badge: string;
}> = [
  {
    key: 'min-vol',
    label: '波动最小',
    meta: '低波动优先 + 历史收益',
    body: '优先压低组合波动和尾部回撤，适合防守稳健目标。',
    badge: '防守',
  },
  {
    key: 'risk-parity',
    label: '风险平价',
    meta: '风险预算均衡',
    body: '让每条腿承担更接近的风险贡献，不展示预期收益列。',
    badge: '均衡',
  },
  {
    key: 'max-sharpe',
    label: '收益最大',
    meta: '夏普最大化 + 历史收益',
    body: '在约束内追求更高扣费后夏普，并显性展示换手摩擦。',
    badge: '进攻',
  },
  {
    key: 'expert',
    label: '专家模式',
    meta: '均值方差 / 贝莱克-利特曼 / 手动覆盖',
    body: '展开收益假设、协方差模型、半衰期和估计窗口。',
    badge: '专家',
  },
];

const HISTORY_PRESETS: Array<{ key: HistoryPreset; label: string }> = [
  { key: '3y', label: '3年' },
  { key: '5y', label: '5年' },
  { key: '10y', label: '10年' },
  { key: 'custom', label: '自定义' },
];

const TURNOVER_BANDS: Array<{ key: TurnoverBand; label: string; value: number }> = [
  { key: 'low', label: '低', value: 10 },
  { key: 'medium', label: '中', value: 18 },
  { key: 'high', label: '高', value: 30 },
];

const OBJECTIVE_OPTIONS: Array<{ key: AllocationObjectiveKey; label: string }> = [
  { key: 'min-vol', label: '最小波动' },
  { key: 'risk-parity', label: '风险平价' },
  { key: 'max-sharpe', label: '最大夏普' },
];

const INTENT_REQUEST_VALUES: Record<AllocationIntentKey, string> = {
  expert: 'risk_parity',
  'max-sharpe': 'max_sharpe',
  'min-vol': 'min_vol',
  'risk-parity': 'risk_parity',
};

function historyWindowYears(preset: HistoryPreset): number | null {
  if (preset === 'custom') {
    return null;
  }
  return Number(preset.replace('y', ''));
}

function turnoverPct(band: TurnoverBand): number {
  return TURNOVER_BANDS.find((item) => item.key === band)?.value ?? 18;
}

const DEFAULT_MODEL: AllocationModel = {
  compositionName: '全天候研究组合',
  benchmarkLabel: '60/40 参考组合',
  dataQualityLabel: '收益流已对齐',
  updatedLabel: '本地配置草稿',
  currentMetrics: {
    annualReturn: 0,
    volatility: 0,
    sharpe: 0,
    maxDrawdown: 0,
    enb: 0,
    trackingError: 0,
    migrationCostBps: 0,
    liquidityPressurePct: 0,
    recoveryDays: 0,
    defensiveAlpha: 0,
  },
  stressScenarios: [],
  legs: [
    {
      id: 'alpha-core',
      name: '阿尔法核心策略',
      role: '策略腿',
      legKind: 'strategy',
      sourceRefId: 'alpha-core',
      sourceRefType: 'strategy',
      displayName: '阿尔法核心策略',
      ordering: 0,
      config: {},
      currentWeight: 38,
      minWeight: 20,
      maxWeight: 45,
      locked: false,
      expectedReturn: 11.8,
      riskContribution: 42,
    },
    {
      id: 'qqq-grid',
      name: 'QQQ 网格策略',
      role: '策略腿',
      legKind: 'strategy',
      sourceRefId: 'qqq-grid',
      sourceRefType: 'strategy',
      displayName: 'QQQ 网格策略',
      ordering: 1,
      config: {},
      currentWeight: 22,
      minWeight: 10,
      maxWeight: 30,
      locked: false,
      expectedReturn: 13.4,
      riskContribution: 31,
    },
    {
      id: 'tbill',
      name: '美国3个月短期国债',
      role: '资产腿',
      legKind: 'asset',
      sourceRefId: 'tbill',
      sourceRefType: 'asset',
      displayName: '美国3个月短期国债',
      ordering: 2,
      config: {},
      currentWeight: 30,
      minWeight: 20,
      maxWeight: 45,
      locked: true,
      expectedReturn: 4.7,
      riskContribution: 20,
    },
    {
      id: 'cash',
      name: '现金安全垫',
      role: '现金腿',
      legKind: 'cash',
      sourceRefId: 'cash',
      sourceRefType: 'cash',
      displayName: '现金安全垫',
      ordering: 3,
      config: {},
      currentWeight: 10,
      minWeight: 10,
      maxWeight: 10,
      locked: true,
      expectedReturn: 3.1,
      riskContribution: 7,
    },
  ],
};

const DEFAULT_BENCHMARK_METRICS: AllocationBenchmarkMetrics = {
  annualReturn: 8.7,
  defensiveAlpha: 0,
  enb: 0,
  label: '基准组合',
  liquidityPressurePct: 0,
  maxDrawdown: -10.4,
  migrationCostBps: 0,
  recoveryDays: 0,
  sharpe: 0,
  trackingError: 0,
  volatility: 10.4,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizePromotionReadiness(value: unknown): AllocationPromotionReadiness | null {
  if (!isRecord(value)) {
    return null;
  }
  const rawBlockers = Array.isArray(value.blockers) ? value.blockers : [];
  const rawPolicyViolations = Array.isArray(value.policy_violations) ? value.policy_violations : [];
  return {
    status: asString(value.status, ''),
    evidenceGrade: typeof value.evidence_grade === 'string' ? value.evidence_grade.trim().toUpperCase() : null,
    blockers: rawBlockers.map((item) => String(item)).filter(Boolean),
    policyViolationCount: rawPolicyViolations.length,
  };
}

function promotionReadinessBlockedReason(readiness: AllocationPromotionReadiness | null | undefined): string | null {
  if (!readiness) {
    return null;
  }
  const blockers = new Set(readiness.blockers);
  const blocked = readiness.status === 'blocked' || blockers.size > 0;
  if (!blocked) {
    return null;
  }
  if (blockers.has('evidence_grade_c') || readiness.evidenceGrade === 'C') {
    return '存在未关闭的失效问题，晋升门禁已暂停。';
  }
  if (blockers.has('constraint_violations') || readiness.policyViolationCount > 0) {
    return '存在约束违反，请先调整候选约束。';
  }
  return '晋升门禁未通过，暂不能生成草稿版本。';
}

function formatPct(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`;
}

function formatSignedPct(value: number, digits = 1): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

function formatSignedPoints(value: number, digits = 1): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}pt`;
}

function formatLegName(value: string): string {
  const text = value.trim();
  if (/^alpha\s*core$/i.test(text)) {
    return '阿尔法核心策略';
  }
  if (/^qqq\s*grid$/i.test(text)) {
    return 'QQQ 网格策略';
  }
  if (/^t-?bill$/i.test(text) || /ust\s*t-?bill/i.test(text)) {
    return '美国3个月短期国债';
  }
  if (/^cash$/i.test(text)) {
    return '现金安全垫';
  }
  return text;
}

function getAdjustableMinWeight(leg: AllocationLeg): number {
  return Math.max(0, Math.round(leg.currentWeight * 0.45));
}

function getAdjustableMaxWeight(leg: AllocationLeg): number {
  return Math.min(70, Math.max(leg.currentWeight + 8, Math.round(leg.currentWeight * 1.35)));
}

function clampWeightBound(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function defaultLegConstraint(leg: AllocationLeg): AllocationLegConstraint {
  return {
    locked: leg.locked,
    maxWeight: leg.maxWeight,
    minWeight: leg.minWeight,
  };
}

function defaultUnlockedLegConstraint(leg: AllocationLeg): AllocationLegConstraint {
  return {
    locked: false,
    maxWeight: getAdjustableMaxWeight(leg),
    minWeight: getAdjustableMinWeight(leg),
  };
}

function applyLegConstraint(leg: AllocationLeg, constraint?: AllocationLegConstraint): AllocationLeg {
  if (!constraint) {
    return leg;
  }
  if (constraint.locked) {
    const lockWeight = clampWeightBound(constraint.minWeight);
    return {
      ...leg,
      locked: true,
      maxWeight: lockWeight,
      minWeight: lockWeight,
    };
  }
  return {
    ...leg,
    locked: false,
    maxWeight: clampWeightBound(constraint.maxWeight),
    minWeight: clampWeightBound(constraint.minWeight),
  };
}

function getLockedConstraintWeight(leg: AllocationLeg): number {
  return clampWeightBound(leg.minWeight);
}

function formatDataQualityLabel(value: string): string {
  switch (value.toLowerCase()) {
    case 'verified':
      return '收益流已验证';
    case 'limited':
      return '覆盖有限';
    case 'fallback':
      return '含代理估算';
    case 'missing':
      return '待补齐';
    default:
      return value;
  }
}

function readKpi(rawDetail: unknown, key: string, fallback: number): number {
  if (!isRecord(rawDetail) || !Array.isArray(rawDetail.kpis)) {
    return fallback;
  }
  const item = rawDetail.kpis.filter(isRecord).find((candidate) => asString(candidate.key, '') === key);
  return item ? asNumber(item.value, fallback) : fallback;
}

function normalizeDrawdownMetric(value: unknown, fallback: number): number {
  const numericValue = asNumber(value, fallback);
  if (numericValue === 0) {
    return 0;
  }
  return -Math.abs(numericValue);
}

function effectiveAssetCount(weights: number[]): number {
  const positiveWeights = weights.map((value) => Math.max(0, value));
  const total = positiveWeights.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return 0;
  }
  const concentration = positiveWeights.reduce((sum, value) => {
    const share = value / total;
    return sum + share * share;
  }, 0);
  return concentration > 0 ? Number((1 / concentration).toFixed(1)) : 0;
}

function buildCurrentMetrics(rawDetail: unknown, legs: AllocationLeg[]): AllocationCurrentMetrics {
  return {
    annualReturn: readKpi(rawDetail, 'annualized_return', DEFAULT_MODEL.currentMetrics.annualReturn),
    volatility: readKpi(rawDetail, 'volatility', DEFAULT_MODEL.currentMetrics.volatility),
    sharpe: readKpi(rawDetail, 'sharpe', DEFAULT_MODEL.currentMetrics.sharpe),
    maxDrawdown: normalizeDrawdownMetric(
      readKpi(rawDetail, 'max_drawdown', Math.abs(DEFAULT_MODEL.currentMetrics.maxDrawdown)),
      DEFAULT_MODEL.currentMetrics.maxDrawdown,
    ),
    enb: effectiveAssetCount(legs.map((leg) => leg.currentWeight)),
    trackingError: DEFAULT_MODEL.currentMetrics.trackingError,
    migrationCostBps: DEFAULT_MODEL.currentMetrics.migrationCostBps,
    liquidityPressurePct: DEFAULT_MODEL.currentMetrics.liquidityPressurePct,
    recoveryDays: DEFAULT_MODEL.currentMetrics.recoveryDays,
    defensiveAlpha: DEFAULT_MODEL.currentMetrics.defensiveAlpha,
  };
}

function normalizeLegs(rawDetail: unknown): AllocationLeg[] {
  if (!isRecord(rawDetail) || !Array.isArray(rawDetail.normalized_legs)) {
    return DEFAULT_MODEL.legs;
  }

  const normalized = rawDetail.normalized_legs
    .filter(isRecord)
    .map((leg, index): AllocationLeg => {
      const weight = asNumber(leg.weight_pct, DEFAULT_MODEL.legs[index]?.currentWeight ?? 0);
      const name = formatLegName(asString(leg.display_name, DEFAULT_MODEL.legs[index]?.name ?? `资产腿 ${index + 1}`));
      const kind = asString(leg.leg_kind, 'asset');
      const legId = asString(leg.id, `leg-${index + 1}`);
      const locked = Boolean(leg.weight_locked);
      const defaultLeg = DEFAULT_MODEL.legs[index] ?? DEFAULT_MODEL.legs[0];
      const role = kind === 'cash' ? '现金腿' : kind === 'strategy' ? '策略腿' : '资产腿';
      return {
        id: legId,
        name,
        role,
        legKind: kind,
        sourceRefId: asString(leg.source_ref_id, legId),
        sourceRefType: typeof leg.source_ref_type === 'string' ? leg.source_ref_type : kind,
        displayName: name,
        ordering: asNumber(leg.ordering, index),
        config: isRecord(leg.config) ? leg.config : {},
        currentWeight: weight,
        minWeight: locked ? weight : Math.max(0, Math.round(weight * 0.45)),
        maxWeight: locked ? weight : Math.min(70, Math.max(weight + 8, Math.round(weight * 1.35))),
        locked,
        expectedReturn: defaultLeg.expectedReturn,
        riskContribution: Math.max(5, Math.min(76, asNumber(leg.contribution_pct, defaultLeg.riskContribution))),
      };
    });

  return normalized.length >= 2 ? normalized : DEFAULT_MODEL.legs;
}

function rowDateValue(row: Record<string, unknown>): string {
  return asString(row.date, asString(row.label, ''));
}

function rowMonthIndex(row: Record<string, unknown>): number | null {
  const match = rowDateValue(row).match(/^(\d{4})-(\d{2})/);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 12 + Number(match[2]);
}

function periodReturns(
  rows: unknown,
  key: 'benchmark_return_pct' | 'net_return_pct' | 'portfolio_return_pct',
  startDate: string,
  endDate: string,
): number[] {
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows
    .filter(isRecord)
    .filter((row) => {
      const dateValue = rowDateValue(row);
      return dateValue >= startDate && dateValue <= endDate;
    })
    .map((row) => {
      const rawValue = key === 'net_return_pct'
        ? row.net_return_pct ?? row.portfolio_return_pct
        : row[key];
      return asNumber(rawValue, Number.NaN);
    })
    .filter(Number.isFinite)
    .map((value) => value / 100);
}

function maxDrawdownFromReturns(periodReturnValues: number[]): number | null {
  if (periodReturnValues.length === 0) {
    return null;
  }
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const value of periodReturnValues) {
    equity *= 1 + value;
    peak = Math.max(peak, equity);
    if (peak > 0) {
      maxDrawdown = Math.min(maxDrawdown, equity / peak - 1);
    }
  }
  return Number((maxDrawdown * 100).toFixed(4));
}

function worstRollingWindow(rows: unknown, windowSize: number): { endDate: string; startDate: string; value: number } | null {
  if (!Array.isArray(rows) || rows.length < windowSize) {
    return null;
  }
  const normalizedRows = rows.filter(isRecord).sort((left, right) => rowDateValue(left).localeCompare(rowDateValue(right)));
  let worst: { endDate: string; startDate: string; value: number } | null = null;
  for (let index = 0; index <= normalizedRows.length - windowSize; index += 1) {
    const slice = normalizedRows.slice(index, index + windowSize);
    const months = slice.map(rowMonthIndex);
    if (months.some((month) => month === null) || months.some((month, offset) => month !== months[0]! + offset)) {
      continue;
    }
    const returns = slice
      .map((row) => asNumber(row.net_return_pct ?? row.portfolio_return_pct, Number.NaN))
      .filter(Number.isFinite)
      .map((value) => value / 100);
    if (returns.length !== windowSize) {
      continue;
    }
    const drawdown = maxDrawdownFromReturns(returns);
    if (drawdown === null) {
      continue;
    }
    if (!worst || drawdown < worst.value) {
      worst = {
        endDate: rowDateValue(slice[slice.length - 1]!),
        startDate: rowDateValue(slice[0]!),
        value: drawdown,
      };
    }
  }
  return worst;
}

function formatPeriod(startDate: string, endDate: string): string {
  const start = startDate.slice(0, 7);
  const end = endDate.slice(0, 7);
  return start && end ? `${start} 至 ${end}` : '运行时窗口';
}

function scrollAllocationPageToTop(): void {
  const userAgent = window.navigator.userAgent.toLowerCase();
  if (userAgent.includes('jsdom')) {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    return;
  }
  window.scrollTo({ left: 0, top: 0, behavior: 'auto' });
}

function buildStressScenarios(rawDetail: unknown): AllocationStressScenario[] {
  if (!isRecord(rawDetail)) {
    return [];
  }
  const returnsPreview = rawDetail.returns_preview;
  const benchmarkSeries = rawDetail.benchmark_series;
  const scenarioSpecs = [
    {
      endDate: '2020-05-31',
      startDate: '2020-02-01',
      title: '2020 疫情冲击 (实际窗口)',
    },
    {
      endDate: '2022-10-31',
      startDate: '2022-01-01',
      title: '2022 紧缩熊市 (实际窗口)',
    },
  ];
  const scenarios = scenarioSpecs
    .map((spec): AllocationStressScenario | null => {
      const currentDrawdown = maxDrawdownFromReturns(
        periodReturns(returnsPreview, 'net_return_pct', spec.startDate, spec.endDate),
      );
      if (currentDrawdown === null) {
        return null;
      }
      const benchmarkDrawdown = maxDrawdownFromReturns(
        periodReturns(benchmarkSeries, 'benchmark_return_pct', spec.startDate, spec.endDate),
      );
      return {
        benchmarkDrawdown,
        currentDrawdown,
        period: formatPeriod(spec.startDate, spec.endDate),
        source: '当前与基准来自组合真实收益窗口；候选按运行时候选峰值回撤比例投影。',
        title: spec.title,
      };
    })
    .filter((item): item is AllocationStressScenario => item !== null);
  const worstWindow = worstRollingWindow(returnsPreview, 3);
  if (worstWindow) {
    const benchmarkDrawdown = maxDrawdownFromReturns(
      periodReturns(benchmarkSeries, 'benchmark_return_pct', worstWindow.startDate, worstWindow.endDate),
    );
    scenarios.unshift({
      benchmarkDrawdown,
      currentDrawdown: worstWindow.value,
      period: formatPeriod(worstWindow.startDate, worstWindow.endDate),
      source: '当前与基准来自组合真实收益窗口；候选按运行时候选峰值回撤比例投影。',
      title: '历史最差三个月 (实际窗口)',
    });
  }
  return scenarios.slice(0, 3);
}

function normalizeComposition(rawDetail: unknown): AllocationModel {
  if (!isRecord(rawDetail)) {
    return DEFAULT_MODEL;
  }

  const benchmark = isRecord(rawDetail.benchmark_definition)
    ? formatBenchmarkLabel(asString(rawDetail.benchmark_definition.label, DEFAULT_MODEL.benchmarkLabel))
    : DEFAULT_MODEL.benchmarkLabel;
  const quality = isRecord(rawDetail.return_quality_summary)
    ? asString(rawDetail.return_quality_summary.status, DEFAULT_MODEL.dataQualityLabel)
    : DEFAULT_MODEL.dataQualityLabel;
  const legs = normalizeLegs(rawDetail);

  return {
    compositionName: asString(rawDetail.name, DEFAULT_MODEL.compositionName),
    benchmarkLabel: benchmark,
    dataQualityLabel: formatDataQualityLabel(quality),
    updatedLabel: asString(rawDetail.updated_at, DEFAULT_MODEL.updatedLabel).slice(0, 10),
    currentMetrics: buildCurrentMetrics(rawDetail, legs),
    legs,
    stressScenarios: buildStressScenarios(rawDetail),
  };
}

function buildCovarianceRows(legs: AllocationLeg[]): Array<{ row: AllocationLeg; cells: Array<{ leg: AllocationLeg; value: number }> }> {
  return legs.map((row, rowIndex) => ({
    row,
    cells: legs.map((leg, cellIndex) => {
      if (rowIndex === cellIndex) {
        return { leg, value: 1 };
      }
      const bothGrowth = row.role === '策略腿' && leg.role === '策略腿';
      const hasCash = row.role === '现金腿' || leg.role === '现金腿';
      const hasDefensive = row.name.toLowerCase().includes('bill') || leg.name.toLowerCase().includes('bill');
      const value = hasCash ? 0.02 : hasDefensive ? -0.14 + (rowIndex + cellIndex) * 0.02 : bothGrowth ? 0.86 : 0.24;
      return { leg, value: Number(value.toFixed(2)) };
    }),
  }));
}

function buildCandidateWeights(
  legs: AllocationLeg[],
  mode: AllocationObjectiveKey,
  variant = 0,
): Array<{ legId: string; weight: number; risk: number }> {
  const total = Math.max(1, legs.reduce((sum, leg) => sum + leg.currentWeight, 0));
  const draft = legs.map((leg, index) => {
    const current = (leg.currentWeight / total) * 100;
    const defensiveBump = leg.name.toLowerCase().includes('bill') || leg.role === '现金腿' ? 8 - variant : -4 + variant;
    const parityBump = leg.role === '策略腿' ? -2 + variant : 4 - variant;
    const sharpeBump = leg.role === '策略腿' ? 6 - variant : -6 + variant;
    const bump = mode === 'min-vol' ? defensiveBump : mode === 'risk-parity' ? parityBump : mode === 'max-sharpe' ? sharpeBump : 0;
    const weight = Math.max(5, Math.min(60, current + bump));
    return {
      legId: leg.id,
      rawWeight: weight,
      risk: Number(Math.max(5, Math.min(76, leg.riskContribution + (mode === 'max-sharpe' && index === 0 ? 18 : 0))).toFixed(1)),
    };
  });
  const draftTotal = Math.max(1, draft.reduce((sum, item) => sum + item.rawWeight, 0));
  return draft.map((item) => ({
    legId: item.legId,
    risk: item.risk,
    weight: Number(((item.rawWeight / draftTotal) * 100).toFixed(1)),
  }));
}

function buildCandidates(legs: AllocationLeg[]): AllocationCandidate[] {
  const specs: Array<
    Omit<AllocationCandidate, 'weights'> & { variant: number }
  > = [
    {
      id: 'min-vol-1',
      label: '最小波动一号',
      intentKey: 'min-vol',
      objectiveKey: 'min-vol',
      rank: 1,
      annualReturn: 10.8,
      volatility: 6.9,
      sharpe: 1.18,
      netSharpe: 1.15,
      enb: 3.0,
      trackingError: 3.1,
      maxDrawdown: -3.1,
      recoveryDays: 34,
      defensiveAlpha: 2.1,
      liquidityPressurePct: 7.6,
      turnover: 22,
      migrationCostBps: 15,
      stress: '2020 疫情冲击回撤 -3.1% · 修复 34 天',
      verdict: '波动约束最稳，调仓摩擦可接受。',
      sourceEvidence: '来源：有效前沿左上迁移点、2020 压力窗口、腿级权重审计。',
      variant: 0,
    },
    {
      id: 'min-vol-2',
      label: '低换手防守',
      intentKey: 'min-vol',
      objectiveKey: 'min-vol',
      rank: 2,
      annualReturn: 10.5,
      volatility: 7.1,
      sharpe: 1.16,
      netSharpe: 1.14,
      enb: 3.1,
      trackingError: 2.8,
      maxDrawdown: -3.3,
      recoveryDays: 39,
      defensiveAlpha: 1.8,
      liquidityPressurePct: 5.2,
      turnover: 16,
      migrationCostBps: 10,
      stress: '2022 紧缩熊市回撤 -3.3% · 修复 39 天',
      verdict: '降低换手优先，防守收益略低。',
      sourceEvidence: '来源：换手预算约束、有效资产数、成本归因。',
      variant: 1,
    },
    {
      id: 'min-vol-3',
      label: '回撤压缩',
      intentKey: 'min-vol',
      objectiveKey: 'min-vol',
      rank: 3,
      annualReturn: 10.2,
      volatility: 6.7,
      sharpe: 1.14,
      netSharpe: 1.11,
      enb: 3.3,
      trackingError: 3.6,
      maxDrawdown: -2.9,
      recoveryDays: 31,
      defensiveAlpha: 2.4,
      liquidityPressurePct: 8.4,
      turnover: 25,
      migrationCostBps: 16,
      stress: '2008 金融危机回撤 -2.9% · 修复 31 天',
      verdict: '回撤保护最强，收益让渡更明显。',
      sourceEvidence: '来源：历史压力样本、现金缓冲约束、候选排名。',
      variant: 2,
    },
    {
      id: 'risk-parity-1',
      label: '风险平价一号',
      intentKey: 'risk-parity',
      objectiveKey: 'risk-parity',
      rank: 1,
      annualReturn: 11.4,
      volatility: 7.8,
      sharpe: 1.24,
      netSharpe: 1.21,
      enb: 3.2,
      trackingError: 4.1,
      maxDrawdown: -3.6,
      recoveryDays: 42,
      defensiveAlpha: 1.7,
      liquidityPressurePct: 6.9,
      turnover: 18,
      migrationCostBps: 12,
      stress: '2020 疫情冲击回撤 -3.6% · 修复 42 天',
      verdict: '收益风险改善足以覆盖摩擦。',
      sourceEvidence: '来源：风险贡献均衡、有效资产数、调仓成本归因。',
      variant: 0,
    },
    {
      id: 'risk-parity-2',
      label: '均衡分散',
      intentKey: 'risk-parity',
      objectiveKey: 'risk-parity',
      rank: 2,
      annualReturn: 11.1,
      volatility: 7.5,
      sharpe: 1.22,
      netSharpe: 1.19,
      enb: 3.5,
      trackingError: 3.7,
      maxDrawdown: -3.4,
      recoveryDays: 40,
      defensiveAlpha: 1.5,
      liquidityPressurePct: 7.1,
      turnover: 20,
      migrationCostBps: 13,
      stress: '2022 紧缩熊市回撤 -3.4% · 修复 40 天',
      verdict: '分散度最佳，收益略低于一号候选。',
      sourceEvidence: '来源：有效资产数、风险贡献矩阵、压力窗口。',
      variant: 1,
    },
    {
      id: 'risk-parity-3',
      label: '现金缓冲平价',
      intentKey: 'risk-parity',
      objectiveKey: 'risk-parity',
      rank: 3,
      annualReturn: 10.9,
      volatility: 7.2,
      sharpe: 1.20,
      netSharpe: 1.17,
      enb: 3.4,
      trackingError: 3.3,
      maxDrawdown: -3.2,
      recoveryDays: 38,
      defensiveAlpha: 1.6,
      liquidityPressurePct: 5.8,
      turnover: 17,
      migrationCostBps: 11,
      stress: '2008 金融危机回撤 -3.2% · 修复 38 天',
      verdict: '保留现金缓冲，跟踪误差更低。',
      sourceEvidence: '来源：现金下限约束、风险平价候选盘。',
      variant: 2,
    },
    {
      id: 'max-sharpe-1',
      label: '最大夏普一号',
      intentKey: 'max-sharpe',
      objectiveKey: 'max-sharpe',
      rank: 1,
      annualReturn: 13.2,
      volatility: 10.4,
      sharpe: 1.31,
      netSharpe: 1.25,
      enb: 1.3,
      trackingError: 7.2,
      maxDrawdown: -6.8,
      recoveryDays: 76,
      defensiveAlpha: 0.4,
      liquidityPressurePct: 18.4,
      turnover: 36,
      migrationCostBps: 28,
      stress: '2020 疫情冲击回撤 -6.8% · 修复 76 天',
      verdict: '收益效率最高，但执行约束触发预警。',
      sourceEvidence: '来源：最大夏普目标、ADV 占比、压力回撤审计。',
      executionLimited: true,
      violation: '流动性压力超过 15%，需交易台复核后再晋升。',
      variant: 0,
    },
    {
      id: 'max-sharpe-2',
      label: '收益增强',
      intentKey: 'max-sharpe',
      objectiveKey: 'max-sharpe',
      rank: 2,
      annualReturn: 12.8,
      volatility: 9.8,
      sharpe: 1.28,
      netSharpe: 1.23,
      enb: 2.1,
      trackingError: 6.4,
      maxDrawdown: -5.9,
      recoveryDays: 68,
      defensiveAlpha: 0.8,
      liquidityPressurePct: 13.7,
      turnover: 31,
      migrationCostBps: 22,
      stress: '2022 紧缩熊市回撤 -5.9% · 修复 68 天',
      verdict: '收益增强明显，分散度仍偏低。',
      sourceEvidence: '来源：收益目标排序、跟踪误差、腿级流动性估算。',
      variant: 1,
    },
    {
      id: 'max-sharpe-3',
      label: '温和夏普',
      intentKey: 'max-sharpe',
      objectiveKey: 'max-sharpe',
      rank: 3,
      annualReturn: 12.3,
      volatility: 9.1,
      sharpe: 1.26,
      netSharpe: 1.22,
      enb: 2.6,
      trackingError: 5.6,
      maxDrawdown: -5.1,
      recoveryDays: 61,
      defensiveAlpha: 1.0,
      liquidityPressurePct: 11.9,
      turnover: 27,
      migrationCostBps: 19,
      stress: '2008 金融危机回撤 -5.1% · 修复 61 天',
      verdict: '夏普改善保留，执行约束相对温和。',
      sourceEvidence: '来源：候选筛选、回撤修复、摩擦成本归因。',
      variant: 2,
    },
  ];

  return specs.map(({ variant, ...candidate }) => ({
    ...candidate,
    weights: buildCandidateWeights(legs, candidate.objectiveKey, variant),
  }));
}

function buildFrontierPoints(
  legs: AllocationLeg[],
  currentMetrics: AllocationCurrentMetrics = DEFAULT_MODEL.currentMetrics,
): FrontierPoint[] {
  const baseWeights = legs.map((leg) => ({ legId: leg.id, weight: leg.currentWeight }));
  return [
    { id: 'frontier-01', label: '前沿 01', annualReturn: 9.8, volatility: 6.2, left: 22, top: 67, weights: baseWeights },
    { id: 'frontier-02', label: '前沿 02', annualReturn: 10.4, volatility: 6.8, left: 31, top: 58, weights: baseWeights },
    { id: 'frontier-custom', label: '自定义候选', annualReturn: 11.8, volatility: 8.3, left: 45, top: 43, weights: buildCandidateWeights(legs, 'risk-parity').map((item) => ({ legId: item.legId, weight: item.weight })) },
    { id: 'frontier-04', label: '前沿 04', annualReturn: 12.4, volatility: 9.4, left: 58, top: 35, weights: buildCandidateWeights(legs, 'max-sharpe').map((item) => ({ legId: item.legId, weight: item.weight })) },
    { id: 'current', label: '当前组合', annualReturn: currentMetrics.annualReturn, volatility: currentMetrics.volatility, left: 52, top: 53, type: 'current', weights: baseWeights },
    { id: 'benchmark', label: '基准组合', annualReturn: 8.7, volatility: 10.4, left: 68, top: 69, type: 'benchmark', weights: baseWeights },
    { id: 'min-vol', label: '最小波动', annualReturn: 10.8, volatility: 6.9, left: 34, top: 52, type: 'min-vol', weights: buildCandidateWeights(legs, 'min-vol').map((item) => ({ legId: item.legId, weight: item.weight })) },
    { id: 'max-sharpe', label: '夏普最大化', annualReturn: 13.2, volatility: 10.4, left: 74, top: 28, type: 'max-sharpe', weights: buildCandidateWeights(legs, 'max-sharpe').map((item) => ({ legId: item.legId, weight: item.weight })) },
    { id: 'risk-parity', label: '风险平价', annualReturn: 11.4, volatility: 7.8, left: 46, top: 40, type: 'risk-parity', weights: buildCandidateWeights(legs, 'risk-parity').map((item) => ({ legId: item.legId, weight: item.weight })) },
  ];
}

function objectiveFromCandidateIdentity(id: string, label: string): AllocationObjectiveKey {
  const text = `${id} ${label}`.toLowerCase().replace(/_/g, '-');
  if (text.includes('risk-parity') || text.includes('risk parity') || text.includes('风险平价')) {
    return 'risk-parity';
  }
  if (text.includes('max-sharpe') || text.includes('max sharpe') || text.includes('最大夏普')) {
    return 'max-sharpe';
  }
  return 'min-vol';
}

function displayCandidateLabel(id: string, label: string, objective: AllocationObjectiveKey): string {
  if (id === 'current') {
    return '当前组合';
  }
  if (id === 'benchmark') {
    return '基准组合';
  }
  if (objective === 'risk-parity') {
    return '风险平价预览';
  }
  if (objective === 'max-sharpe') {
    return '最大夏普预览';
  }
  if (label.includes('低换手')) {
    return '低换手防守';
  }
  return '最小波动预览';
}

function rankCandidatesForObjective(
  candidates: AllocationCandidate[],
  objective: AllocationObjectiveKey,
): AllocationCandidate[] {
  return [...candidates].sort((left, right) => {
    const leftPrimary = left.objectiveKey === objective ? 0 : 1;
    const rightPrimary = right.objectiveKey === objective ? 0 : 1;
    if (leftPrimary !== rightPrimary) {
      return leftPrimary - rightPrimary;
    }
    if (objective === 'max-sharpe') {
      return right.netSharpe - left.netSharpe || right.sharpe - left.sharpe;
    }
    if (objective === 'risk-parity') {
      return right.enb - left.enb || left.migrationCostBps - right.migrationCostBps;
    }
    return left.volatility - right.volatility || left.maxDrawdown - right.maxDrawdown;
  });
}

function jobWeightsForCandidate(
  rawWeights: unknown,
  legs: AllocationLeg[],
): Array<{ legId: string; weight: number; risk: number }> {
  const weightRecord = isRecord(rawWeights) ? rawWeights : {};
  const rows = legs.map((leg) => {
    const rawValue =
      weightRecord[leg.id]
      ?? weightRecord[leg.sourceRefId]
      ?? weightRecord[leg.displayName]
      ?? weightRecord[leg.name];
    return {
      legId: leg.id,
      rawWeight: asNumber(rawValue, leg.currentWeight),
      risk: leg.riskContribution,
    };
  });
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.rawWeight), 0);
  const scale = total > 0 && total <= 1.5 ? 100 : 1;
  return rows.map((row) => ({
    legId: row.legId,
    risk: row.risk,
    weight: Number((Math.max(0, row.rawWeight) * scale).toFixed(1)),
  }));
}

function currentMetricsFromJob(job: ApiCompositionAllocationJob | null, model: AllocationModel): AllocationCurrentMetrics {
  if (!job) {
    return model.currentMetrics;
  }
  const currentCandidate = job.candidates.find((candidate) => {
    const id = isRecord(candidate) ? asString(candidate.id, '') : '';
    return id === 'current';
  });
  const currentPoint = job.frontier_points.find((point) => isRecord(point) && asString(point.id, '') === 'current');
  const metrics = isRecord(currentCandidate) && isRecord(currentCandidate.metrics) ? currentCandidate.metrics : {};
  const point = isRecord(currentPoint) ? currentPoint : {};
  const maxDrawdownFallback = Math.abs(model.currentMetrics.maxDrawdown);
  return {
    ...model.currentMetrics,
    annualReturn: asNumber(metrics.annualized_return, asNumber(point.return_pct, model.currentMetrics.annualReturn)),
    volatility: asNumber(metrics.volatility, asNumber(point.risk_pct, model.currentMetrics.volatility)),
    sharpe: asNumber(metrics.sharpe, model.currentMetrics.sharpe),
    maxDrawdown: normalizeDrawdownMetric(metrics.max_drawdown, -maxDrawdownFallback),
    enb: effectiveAssetCount(model.legs.map((leg) => leg.currentWeight)),
  };
}

function benchmarkMetricsFromJob(job: ApiCompositionAllocationJob | null, model: AllocationModel): AllocationBenchmarkMetrics {
  if (!job) {
    return {
      ...DEFAULT_BENCHMARK_METRICS,
      label: model.benchmarkLabel || DEFAULT_BENCHMARK_METRICS.label,
    };
  }
  const benchmarkCandidate = job.candidates.find((candidate) => {
    const id = isRecord(candidate) ? asString(candidate.id, '') : '';
    return id === 'benchmark';
  });
  const benchmarkPoint = job.frontier_points.find((point) => isRecord(point) && asString(point.id, '') === 'benchmark');
  const metrics = isRecord(benchmarkCandidate) && isRecord(benchmarkCandidate.metrics) ? benchmarkCandidate.metrics : {};
  const point = isRecord(benchmarkPoint) ? benchmarkPoint : {};
  return {
    ...DEFAULT_BENCHMARK_METRICS,
    annualReturn: asNumber(metrics.annualized_return, asNumber(point.return_pct, DEFAULT_BENCHMARK_METRICS.annualReturn)),
    label: asString(
      isRecord(benchmarkCandidate) ? benchmarkCandidate.label : undefined,
      model.benchmarkLabel || DEFAULT_BENCHMARK_METRICS.label,
    ),
    maxDrawdown: normalizeDrawdownMetric(metrics.max_drawdown, DEFAULT_BENCHMARK_METRICS.maxDrawdown),
    sharpe: asNumber(metrics.sharpe, DEFAULT_BENCHMARK_METRICS.sharpe),
    volatility: asNumber(metrics.volatility, asNumber(point.risk_pct, DEFAULT_BENCHMARK_METRICS.volatility)),
  };
}

function buildCandidatesFromJob(job: ApiCompositionAllocationJob | null, model: AllocationModel): AllocationCandidate[] {
  if (!job || !Array.isArray(job.candidates) || job.candidates.length === 0) {
    return buildCandidates(model.legs);
  }
  const currentMetrics = currentMetricsFromJob(job, model);
  const frontierById = new Map(
    job.frontier_points.filter(isRecord).map((point) => [asString(point.id, ''), point]),
  );
  const objectiveRanks: Record<AllocationObjectiveKey, number> = {
    'max-sharpe': 0,
    'min-vol': 0,
    'risk-parity': 0,
  };
  const candidates = job.candidates
    .filter(isRecord)
    .filter((candidate) => !['current', 'benchmark'].includes(asString(candidate.id, '')))
    .map((candidate, index): AllocationCandidate => {
      const id = asString(candidate.id, `candidate-${index + 1}`);
      const rawLabel = asString(candidate.label, id);
      const objective = objectiveFromCandidateIdentity(id, rawLabel);
      objectiveRanks[objective] += 1;
      const metrics = isRecord(candidate.metrics) ? candidate.metrics : {};
      const point = frontierById.get(id) ?? {};
      const annualReturn = asNumber(metrics.annualized_return, asNumber(point.return_pct, currentMetrics.annualReturn));
      const volatility = asNumber(metrics.volatility, asNumber(point.risk_pct, currentMetrics.volatility));
      const sharpe = asNumber(metrics.sharpe, currentMetrics.sharpe);
      const turnover = asNumber(metrics.estimated_turnover_pct, asNumber(metrics.turnover_pct, 0));
      const migrationCostBps = Math.round(asNumber(metrics.migration_cost_bps, turnover * 0.75));
      const maxDrawdown = normalizeDrawdownMetric(metrics.max_drawdown, currentMetrics.maxDrawdown);
      const label = displayCandidateLabel(id, rawLabel, objective);
      const constraintViolations = Array.isArray(candidate.constraint_violations) ? candidate.constraint_violations : [];
      const allowedActions = Array.isArray(candidate.allowed_actions) ? candidate.allowed_actions.map((item) => String(item)) : [];
      const readiness = normalizePromotionReadiness(candidate.promotion_readiness);
      const readinessBlockedReason = promotionReadinessBlockedReason(readiness);
      return {
        id,
        label,
        intentKey: objective,
        objectiveKey: objective,
        rank: objectiveRanks[objective],
        annualReturn,
        volatility,
        sharpe,
        netSharpe: asNumber(metrics.net_sharpe, Number(Math.max(0, sharpe - migrationCostBps / 100).toFixed(2))),
        enb: effectiveAssetCount(Object.values(isRecord(candidate.weights) ? candidate.weights : {}).map((value) => asNumber(value, 0))),
        trackingError: asNumber(metrics.tracking_error_pct, Math.abs(volatility - currentMetrics.volatility)),
        maxDrawdown,
        recoveryDays: Math.round(asNumber(metrics.recovery_days, Math.max(18, Math.abs(maxDrawdown) * 5))),
        defensiveAlpha: Number((annualReturn - currentMetrics.annualReturn).toFixed(1)),
        liquidityPressurePct: asNumber(metrics.liquidity_pressure_pct, Math.max(0, turnover / 2)),
        turnover,
        migrationCostBps,
        stress: `压力窗口回撤 ${formatPct(maxDrawdown, 1)}`,
        verdict: '运行时优化任务返回的候选，指标已绑定当前组合真值。',
        sourceEvidence: '来源：allocation job 当前候选、有效前沿点和组合明细 KPI。',
        canPromote: allowedActions.length > 0 ? allowedActions.includes('promote_candidate') : undefined,
        executionLimited: constraintViolations.length > 0 || Boolean(readinessBlockedReason),
        promotionReadiness: readiness,
        violation: constraintViolations.length > 0
          ? '存在约束提示，请复核后晋升。'
          : readinessBlockedReason
            ? readinessBlockedReason
          : undefined,
        weights: jobWeightsForCandidate(candidate.weights, model.legs),
      };
    });
  return candidates.length > 0 ? candidates : buildCandidates(model.legs);
}

function buildFrontierPointsFromJob(
  job: ApiCompositionAllocationJob | null,
  candidates: AllocationCandidate[],
  currentMetrics: AllocationCurrentMetrics,
  legs: AllocationLeg[],
): FrontierPoint[] {
  const baseWeights = legs.map((leg) => ({ legId: leg.id, weight: leg.currentWeight }));
  const rawPoints = job?.frontier_points.filter(isRecord) ?? [];
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const points = rawPoints.length > 0
      ? rawPoints.map((point) => {
          const id = asString(point.id, '');
          const candidate = candidateById.get(id);
          const objective: FrontierPoint['type'] = id === 'current' ? 'current' : id === 'benchmark' ? 'benchmark' : candidate?.objectiveKey;
          const fallbackLabel =
            id === 'current'
              ? '当前组合'
              : id === 'benchmark'
                ? '基准组合'
                : displayCandidateLabel(id, asString(point.label, id), objectiveFromCandidateIdentity(id, asString(point.label, id)));
          return {
            id,
            label: candidate?.label ?? fallbackLabel,
            annualReturn: asNumber(point.return_pct, candidate?.annualReturn ?? currentMetrics.annualReturn),
            volatility: asNumber(point.risk_pct, candidate?.volatility ?? currentMetrics.volatility),
            type: objective,
          weights: candidate?.weights.map((weight) => ({ legId: weight.legId, weight: weight.weight })) ?? baseWeights,
        };
      })
    : [
        {
          id: 'current',
          label: '当前组合',
          annualReturn: currentMetrics.annualReturn,
          volatility: currentMetrics.volatility,
          type: 'current' as const,
          weights: baseWeights,
        },
        ...candidates.map((candidate) => ({
          id: candidate.id,
          label: candidate.label,
          annualReturn: candidate.annualReturn,
          volatility: candidate.volatility,
          type: candidate.objectiveKey,
          weights: candidate.weights.map((weight) => ({ legId: weight.legId, weight: weight.weight })),
        })),
      ];
  const returns = points.map((point) => point.annualReturn);
  const risks = points.map((point) => point.volatility);
  const minReturn = Math.min(...returns);
  const maxReturn = Math.max(...returns);
  const minRisk = Math.min(...risks);
  const maxRisk = Math.max(...risks);
  return points.map((point) => {
    const riskRange = Math.max(0.1, maxRisk - minRisk);
    const returnRange = Math.max(0.1, maxReturn - minReturn);
    return {
      ...point,
      left: Number((24 + ((point.volatility - minRisk) / riskRange) * 52).toFixed(1)),
      top: Number((72 - ((point.annualReturn - minReturn) / returnRange) * 46).toFixed(1)),
    };
  });
}

type FrontierBoundary = {
  linePath: string;
  unreachablePolygonPoints: string;
};

function toChartCoordinate(value: number): number {
  return Number(Math.max(0, Math.min(100, value)).toFixed(1));
}

function buildFrontierBoundary(points: FrontierPoint[]): FrontierBoundary {
  const candidatePoints = points.filter((point) => (
    point.type === 'min-vol'
    || point.type === 'risk-parity'
    || point.type === 'max-sharpe'
  ));
  const sourcePoints = (candidatePoints.length > 0 ? candidatePoints : points)
    .filter((point) => Number.isFinite(point.left) && Number.isFinite(point.top))
    .sort((left, right) => left.left - right.left || left.top - right.top);

  if (sourcePoints.length === 0) {
    const fallback = [
      { x: 18, y: 70 },
      { x: 45, y: 44 },
      { x: 82, y: 30 },
    ];
    return {
      linePath: fallback.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' '),
      unreachablePolygonPoints: `0,0 100,0 100,${fallback[fallback.length - 1]!.y} ${fallback
        .slice()
        .reverse()
        .map((point) => `${point.x},${point.y}`)
        .join(' ')} 0,${fallback[0]!.y}`,
    };
  }

  const riskBuckets: Array<{ x: number; y: number }> = [];
  for (const point of sourcePoints) {
    const lastBucket = riskBuckets[riskBuckets.length - 1];
    if (lastBucket && Math.abs(lastBucket.x - point.left) < 0.8) {
      lastBucket.x = toChartCoordinate((lastBucket.x + point.left) / 2);
      lastBucket.y = Math.min(lastBucket.y, point.top);
    } else {
      riskBuckets.push({
        x: toChartCoordinate(point.left),
        y: toChartCoordinate(point.top),
      });
    }
  }

  const efficientPoints: Array<{ x: number; y: number }> = [];
  let bestTop = Number.POSITIVE_INFINITY;
  for (const point of riskBuckets) {
    if (point.y < bestTop - 0.2) {
      efficientPoints.push(point);
      bestTop = point.y;
    }
  }

  const boundaryPoints = efficientPoints.length > 0 ? efficientPoints : [riskBuckets[0]!];
  const firstPoint = boundaryPoints[0]!;
  const lastPoint = boundaryPoints[boundaryPoints.length - 1]!;
  const visualPoints = boundaryPoints.length === 1
    ? [
        {
          x: toChartCoordinate(firstPoint.x - 16),
          y: toChartCoordinate(firstPoint.y + 24),
        },
        firstPoint,
        {
          x: toChartCoordinate(Math.max(firstPoint.x + 42, 74)),
          y: toChartCoordinate(firstPoint.y - 4),
        },
      ]
    : [
        {
          x: toChartCoordinate(firstPoint.x - 10),
          y: toChartCoordinate(firstPoint.y + 14),
        },
        ...boundaryPoints,
        {
          x: toChartCoordinate(lastPoint.x + 10),
          y: toChartCoordinate(lastPoint.y - 4),
        },
      ];
  const linePath = visualPoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const reversedBoundary = visualPoints
    .slice()
    .reverse()
    .map((point) => `${point.x},${point.y}`)
    .join(' ');
  return {
    linePath,
    unreachablePolygonPoints: `0,0 100,0 100,${visualPoints[visualPoints.length - 1]!.y} ${reversedBoundary} 0,${visualPoints[0]!.y}`,
  };
}

function useAllocationModel(compositionId: string): {
  model: AllocationModel;
  loading: boolean;
  warning: string | null;
} {
  const api = useApiClient();
  const [rawDetail, setRawDetail] = useState<unknown | null>(null);
  const [loading, setLoading] = useState(true);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      if (!api.getCompositionDetail) {
        setLoading(false);
        setWarning('组合详情接口未接入，已使用本地配置草稿。');
        return;
      }
      try {
        setLoading(true);
        setWarning(null);
        const detail = await api.getCompositionDetail(compositionId);
        if (!cancelled) {
          setRawDetail(detail);
        }
      } catch (caught) {
        if (!cancelled) {
          setWarning(`组合详情读取失败，已使用本地配置草稿：${(caught as Error).message}`);
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
  }, [api, compositionId]);

  return {
    model: useMemo(() => normalizeComposition(rawDetail), [rawDetail]),
    loading,
    warning,
  };
}

function useAllocationJob(compositionId: string, jobId: string): {
  job: ApiCompositionAllocationJob | null;
  loading: boolean;
  warning: string | null;
} {
  const api = useApiClient();
  const [job, setJob] = useState<ApiCompositionAllocationJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      if (!api.getCompositionAllocationJob) {
        setLoading(false);
        setWarning('组合优化任务接口未接入，当前使用本地候选回退。');
        return;
      }
      try {
        setLoading(true);
        setWarning(null);
        const response = await api.getCompositionAllocationJob(compositionId, jobId);
        if (!cancelled) {
          setJob(response);
        }
      } catch (caught) {
        if (!cancelled) {
          setWarning(`组合优化任务加载失败，当前使用本地候选回退：${(caught as Error).message}`);
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
  }, [api, compositionId, jobId]);

  return { job, loading, warning };
}

function PageHero({
  compositionId,
  jobId,
  model,
  mode,
}: {
  compositionId: string;
  jobId?: string;
  model: AllocationModel;
  mode: 'config' | 'result';
}): JSX.Element {
  return (
    <section className="composition-allocation-hero" aria-label="组合实验室头部">
      <div className="composition-allocation-hero__copy">
        <p className="composition-allocation-eyebrow">组合资产配置</p>
        <h1>{mode === 'config' ? '组合优化实验室' : '组合优化结果'}</h1>
        <p>
          {mode === 'config'
            ? '用投资意图、风险边界和约束预检生成组合候选，专业参数按需展开。'
            : '先判断候选是否匹配目标，再核对有效前沿、压力表现、扣费后夏普和迁移成本。'}
        </p>
        <div className="composition-allocation-chip-row">
          <span className="composition-allocation-chip composition-allocation-chip--accent">资产配置</span>
          <span className="composition-allocation-chip">{model.compositionName}</span>
          <span className="composition-allocation-chip composition-allocation-chip--blue">
            基准：{model.benchmarkLabel}
          </span>
        </div>
      </div>
      {mode === 'config' ? (
        <div className="composition-allocation-route-card">
          <span>当前工作流</span>
          <strong>组合优化配置</strong>
          <small>{model.dataQualityLabel} · {model.updatedLabel}</small>
        </div>
      ) : null}
    </section>
  );
}

function StatusBanner({ loading, warning }: { loading: boolean; warning: string | null }): JSX.Element | null {
  if (!loading && !warning) {
    return null;
  }
  return (
    <div className={warning ? 'composition-allocation-banner composition-allocation-banner--warning' : 'composition-allocation-banner'}>
      {warning ?? '正在载入组合腿部与基准信息。'}
    </div>
  );
}

function IntentSelector({
  intent,
  onIntentChange,
}: {
  intent: AllocationIntentKey;
  onIntentChange: (intent: AllocationIntentKey) => void;
}): JSX.Element {
  return (
    <section className="composition-allocation-panel composition-allocation-panel--span-2">
      <div className="composition-allocation-panel__header">
        <div>
          <h2>1. 选择你的目标</h2>
          <p>默认只暴露投研意图，后台由父合同映射算法和数据来源。</p>
        </div>
        <span className="composition-allocation-status composition-allocation-status--good">
          当前意图：{INTENTS.find((item) => item.key === intent)?.label}
        </span>
      </div>
      <div className="composition-allocation-intents" role="list">
        {INTENTS.map((item) => (
          <button
            className={
              item.key === intent
                ? 'composition-allocation-intent-card composition-allocation-intent-card--active'
                : 'composition-allocation-intent-card'
            }
            key={item.key}
            onClick={() => onIntentChange(item.key)}
            type="button"
          >
            <span>{item.badge}</span>
            <strong>{item.label}</strong>
            <em>{item.meta}</em>
            <p>{item.body}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

function RiskBoundaryPanel({
  historyPreset,
  onHistoryPresetChange,
  onRiskTargetChange,
  onTurnoverChange,
  riskTarget,
  turnover,
}: {
  historyPreset: HistoryPreset;
  onHistoryPresetChange: (preset: HistoryPreset) => void;
  onRiskTargetChange: (value: number) => void;
  onTurnoverChange: (band: TurnoverBand) => void;
  riskTarget: number;
  turnover: TurnoverBand;
}): JSX.Element {
  const turnoverValue = TURNOVER_BANDS.find((item) => item.key === turnover)?.value ?? 18;
  return (
    <section className="composition-allocation-panel">
      <div className="composition-allocation-panel__header">
        <div>
          <h2>2. 风险偏好与边界</h2>
          <p>滑块表达目标波动率，常用窗口和换手档位保持一眼可读。</p>
        </div>
        <span className="composition-allocation-status composition-allocation-status--good">{riskTarget}% ± 2%</span>
      </div>
      <label className="composition-allocation-slider">
        <span>目标波动率</span>
        <input
          aria-label="目标波动率"
          max={10}
          min={6}
          onChange={(event) => onRiskTargetChange(Number(event.target.value))}
          step={0.5}
          type="range"
          value={riskTarget}
        />
        <strong>{riskTarget}%</strong>
      </label>
      <div className="composition-allocation-segments" aria-label="历史回溯窗口">
        <span>历史回溯窗口</span>
        {HISTORY_PRESETS.map((item) => (
          <button
            className={historyPreset === item.key ? 'is-active' : ''}
            key={item.key}
            onClick={() => onHistoryPresetChange(item.key)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="composition-allocation-segments" aria-label="最大换手率">
        <span>最大换手率</span>
        {TURNOVER_BANDS.map((item) => (
          <button
            className={turnover === item.key ? 'is-active' : ''}
            key={item.key}
            onClick={() => onTurnoverChange(item.key)}
            type="button"
          >
            {item.label} {item.value}%
          </button>
        ))}
      </div>
      <div className="composition-allocation-summary-line">
        <span>预检摘要</span>
        <strong>目标波动 {riskTarget}% · {historyPreset === '10y' ? '10年窗口' : '自定义窗口'} · 换手 {turnoverValue}%</strong>
      </div>
    </section>
  );
}

function ConstraintPanel({
  activeConstraint,
  legs,
  onConstraintSelect,
  riskTarget,
  turnover,
}: {
  activeConstraint: ConstraintChipKey | null;
  legs: AllocationLeg[];
  onConstraintSelect: (constraint: ConstraintChipKey) => void;
  riskTarget: number;
  turnover: TurnoverBand;
}): JSX.Element {
  const cashLeg = legs.find((leg) => leg.role === '现金腿');
  const lockedCash = cashLeg ? getLockedConstraintWeight(cashLeg) : 10;
  const turnoverValue = TURNOVER_BANDS.find((item) => item.key === turnover)?.value ?? 18;
  const candidateCount = turnover === 'low' ? 28 : turnover === 'high' ? 64 : 48;
  const selectedFeedback =
    activeConstraint === 'cash'
      ? {
          body: '已定位到现金腿约束行，可直接解锁后用滑块或数字输入调整上下界。',
          title: '现金权重',
        }
      : activeConstraint === 'turnover'
        ? {
            body: '可回到风险边界里的换手档位切换，候选数会随换手预算同步变化。',
            title: '单次调仓上限',
          }
        : activeConstraint === 'volatility'
          ? {
              body: '可拖动目标波动率滑块，预检摘要会同步重算目标风险带。',
              title: '目标波动',
            }
          : activeConstraint === 'data-gate'
            ? {
                body: '代理数据门禁作为硬性预检保留，候选生成前会继续暴露来源质量。',
                title: '代理数据门禁',
              }
            : null;

  return (
    <section className="composition-allocation-panel">
      <div className="composition-allocation-panel__header">
        <div>
          <h2>3. 约束预检</h2>
          <p>常用限制以可点击 chip 呈现，资产上下界在微调表内直接编辑。</p>
        </div>
        <span className="composition-allocation-status composition-allocation-status--good">
          可生成 {candidateCount} 个候选方案
        </span>
      </div>
      <div className="composition-allocation-constraint-chips">
        <button
          aria-pressed={activeConstraint === 'cash'}
          className={activeConstraint === 'cash' ? 'is-active' : ''}
          onClick={() => onConstraintSelect('cash')}
          type="button"
        >
          现金 {formatPct(lockedCash)} · 点击修改
        </button>
        <button
          aria-pressed={activeConstraint === 'turnover'}
          className={activeConstraint === 'turnover' ? 'is-active' : ''}
          onClick={() => onConstraintSelect('turnover')}
          type="button"
        >
          单次调仓上限 {turnoverValue}% · 点击修改
        </button>
        <button
          aria-pressed={activeConstraint === 'volatility'}
          className={activeConstraint === 'volatility' ? 'is-active' : ''}
          onClick={() => onConstraintSelect('volatility')}
          type="button"
        >
          目标波动 {riskTarget}% ± 2%
        </button>
        <button
          aria-pressed={activeConstraint === 'data-gate'}
          className={activeConstraint === 'data-gate' ? 'is-active' : ''}
          onClick={() => onConstraintSelect('data-gate')}
          type="button"
        >
          代理数据门禁开启
        </button>
      </div>
      {selectedFeedback ? (
        <div
          className="composition-allocation-popover composition-allocation-popover--precheck"
          data-ui="allocation-precheck-feedback"
          role="status"
        >
          <span className="composition-allocation-status composition-allocation-status--info">约束预检反馈</span>
          <strong>已选约束标签：{selectedFeedback.title}</strong>
          <p>{selectedFeedback.body}</p>
        </div>
      ) : null}
    </section>
  );
}

function BoundControl({
  disabled,
  label,
  legName,
  max,
  min,
  onBlur,
  onChange,
  onFocus,
  value,
}: {
  disabled: boolean;
  label: '权重上限' | '权重下限';
  legName: string;
  max: number;
  min: number;
  onBlur: (value: number) => void;
  onChange: (value: number) => void;
  onFocus: () => void;
  value: number;
}): JSX.Element {
  return (
    <label className="composition-allocation-bound-control">
      <span>{label}</span>
      <div className="composition-allocation-bound-control__inputs">
        <input
          aria-label={`${legName} ${label}滑块`}
          disabled={disabled}
          max={max}
          min={min}
          onBlur={(event) => onBlur(Number(event.currentTarget.value))}
          onChange={(event) => onChange(Number(event.target.value))}
          onFocus={onFocus}
          step="1"
          type="range"
          value={value}
        />
        <input
          aria-label={`${legName} ${label}输入`}
          disabled={disabled}
          max={max}
          min={min}
          onBlur={(event) => onBlur(Number(event.currentTarget.value))}
          onChange={(event) => onChange(Number(event.target.value))}
          onFocus={onFocus}
          step="1"
          type="number"
          value={value}
        />
      </div>
    </label>
  );
}

function AssetAdjustmentPanel({
  activeLegId,
  expertMode,
  legs,
  onBoundBlur,
  onBoundChange,
  onLockChange,
  onSelectLeg,
}: {
  activeLegId: string;
  expertMode: boolean;
  legs: AllocationLeg[];
  onBoundBlur: (legId: string, bound: 'max' | 'min', value: number) => void;
  onBoundChange: (legId: string, bound: 'max' | 'min', value: number) => void;
  onLockChange: (legId: string, locked: boolean, configuredBounds?: Pick<AllocationLegConstraint, 'maxWeight' | 'minWeight'>) => void;
  onSelectLeg: (legId: string) => void;
}): JSX.Element {
  const displayedLegs = [...legs].sort((left, right) => {
    const weightDelta = right.currentWeight - left.currentWeight;
    return weightDelta !== 0 ? weightDelta : left.ordering - right.ordering;
  });

  return (
    <section className="composition-allocation-panel composition-allocation-panel--span-2">
      <div className="composition-allocation-panel__header">
        <div>
          <h2>资产微调</h2>
          <p>直接调整每条腿的权重上下界；若上下界一致则按该配置锁定，否则按当前权重锁定。</p>
        </div>
      </div>
      <div className="composition-allocation-table-shell">
        <table className="composition-allocation-table">
          <thead>
            <tr>
              <th>资产腿</th>
              <th>当前权重</th>
              <th>权重下限</th>
              <th>权重上限</th>
              <th>锁定状态</th>
            </tr>
          </thead>
          <tbody>
            {displayedLegs.map((leg) => (
              <tr className={activeLegId === leg.id ? 'is-active' : ''} key={leg.id}>
                <td>
                  <strong>{leg.name}</strong>
                  <span>{leg.role}</span>
                </td>
                <td>
                  <strong>{formatPct(leg.currentWeight)}</strong>
                  <span>当前组合权重</span>
                </td>
                <td className="composition-allocation-bound-cell">
                  <BoundControl
                    disabled={leg.locked}
                    label="权重下限"
                    legName={leg.name}
                    max={100}
                    min={0}
                    onBlur={(value) => onBoundBlur(leg.id, 'min', value)}
                    onChange={(value) => onBoundChange(leg.id, 'min', value)}
                    onFocus={() => onSelectLeg(leg.id)}
                    value={leg.minWeight}
                  />
                </td>
                <td className="composition-allocation-bound-cell">
                  <BoundControl
                    disabled={leg.locked}
                    label="权重上限"
                    legName={leg.name}
                    max={100}
                    min={0}
                    onBlur={(value) => onBoundBlur(leg.id, 'max', value)}
                    onChange={(value) => onBoundChange(leg.id, 'max', value)}
                    onFocus={() => onSelectLeg(leg.id)}
                    value={leg.maxWeight}
                  />
                </td>
                <td className="composition-allocation-lock-cell">
                  <div className="composition-allocation-lock-control">
                    <button
                      aria-label={`${leg.locked ? '解锁' : '锁定'} ${leg.name}`}
                      aria-pressed={leg.locked}
                      className={leg.locked ? 'composition-allocation-lock-button is-locked' : 'composition-allocation-lock-button'}
                      onClick={(event) => {
                        const row = event.currentTarget.closest('tr');
                        const boundInputs = row
                          ? Array.from(row.querySelectorAll<HTMLInputElement>('input[type="number"]'))
                          : [];
                        onLockChange(leg.id, !leg.locked, {
                          maxWeight: clampWeightBound(Number(boundInputs[1]?.value ?? leg.maxWeight)),
                          minWeight: clampWeightBound(Number(boundInputs[0]?.value ?? leg.minWeight)),
                        });
                      }}
                      type="button"
                    >
                      {leg.locked ? '解锁' : '锁定'}
                    </button>
                    <span>{leg.locked ? `固定 ${formatPct(getLockedConstraintWeight(leg))}` : `${formatPct(leg.minWeight)} - ${formatPct(leg.maxWeight)}`}</span>
                    {expertMode ? <span>预期年化收益 {formatPct(leg.expectedReturn, 1)}</span> : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EvidenceRail({
  expertMode,
  legs,
  onExpertOpen,
}: {
  expertMode: boolean;
  legs: AllocationLeg[];
  onExpertOpen: () => void;
}): JSX.Element {
  const lockedWeight = legs.filter((leg) => leg.locked).reduce((sum, leg) => sum + getLockedConstraintWeight(leg), 0);
  const residual = Math.max(0, 100 - lockedWeight);
  const covarianceRows = buildCovarianceRows(legs);
  return (
    <aside className="composition-allocation-rail">
      <section className="composition-allocation-panel">
        <div className="composition-allocation-panel__header composition-allocation-panel__header--compact">
          <div>
            <h2>算法设置</h2>
            <p>默认折叠，专家模式展开后编辑底层参数。</p>
          </div>
          <button className="composition-allocation-ghost-button" onClick={onExpertOpen} type="button">
            打开设置
          </button>
        </div>
        <div className="composition-allocation-setting-summary">
          <span>数据来源 <strong>历史收益序列</strong></span>
          <span>协方差模型 <strong>收缩协方差</strong></span>
          <span>高级项 <strong>{expertMode ? '已展开' : '已折叠'}</strong></span>
        </div>
        {expertMode ? (
          <div className="composition-allocation-expert-settings" data-ui="allocation-expert-settings">
            <label>
              均值方差模型
              <select aria-label="均值方差模型" defaultValue="min_vol">
                <option value="min_vol">最小波动</option>
                <option value="max_sharpe">夏普最大化</option>
                <option value="manual">手动覆盖</option>
              </select>
            </label>
            <label>
              协方差模型
              <select aria-label="协方差模型" defaultValue="ledoit_wolf">
                <option value="sample">样本协方差</option>
                <option value="ledoit_wolf">收缩协方差</option>
                <option value="constant_correlation">常相关收缩</option>
              </select>
            </label>
            <label>
              半衰期
              <input aria-label="半衰期" defaultValue="36 月" />
            </label>
            <label>
              估计窗口
              <input aria-label="估计窗口" defaultValue="120 月" />
            </label>
            <label>
              贝莱克-利特曼观点
              <input aria-label="贝莱克-利特曼观点" defaultValue="保持默认市场隐含收益" />
            </label>
            <button className="composition-allocation-link-button" type="button">
              基于历史填充预期年化收益
            </button>
          </div>
        ) : (
          <p className="composition-allocation-muted">
            专家展开项：手动覆盖、贝莱克-利特曼观点、半衰期、估计窗口和协方差收缩参数。
          </p>
        )}
      </section>

      <section className="composition-allocation-panel">
        <span className="composition-allocation-status composition-allocation-status--info">剩余预算</span>
        <strong className="composition-allocation-large-number">剩余 {formatPct(residual)} 权重可优化</strong>
        <p>
          锁定腿保持政策约束，算法主要在开放腿之间分配剩余预算，并保留现金缓冲。
        </p>
      </section>

      <section className="composition-allocation-panel">
        <div className="composition-allocation-panel__header">
          <div>
            <h2>协方差热力图</h2>
            <p>过去 120 个月相关性，保留专业证据但不抢占主配置视线。</p>
          </div>
        </div>
        <div className="composition-allocation-heatmap" aria-label="协方差热力图">
          <span />
          {legs.map((leg) => (
            <span className="composition-allocation-heatmap__axis" key={`x-${leg.id}`}>{leg.name}</span>
          ))}
          {covarianceRows.map(({ row, cells }) => (
            <div className="composition-allocation-heatmap__row" key={row.id}>
              <span className="composition-allocation-heatmap__axis">{row.name}</span>
              {cells.map((cell) => (
                <span
                  className={
                    cell.value >= 0.7
                      ? 'composition-allocation-heatmap__cell composition-allocation-heatmap__cell--hot'
                      : cell.value < 0
                        ? 'composition-allocation-heatmap__cell composition-allocation-heatmap__cell--cool'
                        : 'composition-allocation-heatmap__cell'
                  }
                  key={`${row.id}-${cell.leg.id}`}
                >
                  {cell.value.toFixed(2)}
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}

function FrontierChart({
  currentPointId,
  onPointClick,
  onPointHover,
  points,
  selectedPointId,
}: {
  currentPointId?: string;
  onPointClick?: (point: FrontierPoint) => void;
  onPointHover?: (point: FrontierPoint) => void;
  points: FrontierPoint[];
  selectedPointId?: string;
}): JSX.Element {
  const frontierBoundary = useMemo(() => buildFrontierBoundary(points), [points]);
  return (
    <div className="composition-allocation-frontier" data-ui="allocation-frontier">
      <span className="composition-allocation-frontier__axis composition-allocation-frontier__axis--y">预期收益</span>
      <span className="composition-allocation-frontier__axis composition-allocation-frontier__axis--x">年化波动</span>
      <svg
        aria-hidden="true"
        className="composition-allocation-frontier__svg"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
      >
        <polygon
          className="composition-allocation-frontier__unreachable"
          points={frontierBoundary.unreachablePolygonPoints}
        />
        <path className="composition-allocation-frontier__curve-line" d={frontierBoundary.linePath} />
      </svg>
      <span className="composition-allocation-frontier__unreachable-label">上方不可达到</span>
      <div className={`composition-allocation-frontier__vector composition-allocation-frontier__vector--${selectedPointId ?? 'min-vol'}`}>
        <span>向边界靠近：降波动 / 提收益</span>
      </div>
      {points.map((point) => {
        const isSpecial = Boolean(point.type);
        const isCandidatePoint = point.type === 'min-vol' || point.type === 'risk-parity' || point.type === 'max-sharpe';
        const className = [
          'composition-allocation-frontier__point',
          isSpecial ? `composition-allocation-frontier__point--${point.type}` : '',
          selectedPointId === point.id ? 'is-selected' : '',
          currentPointId === point.id ? 'is-current-hover' : '',
          isCandidatePoint && selectedPointId !== point.id ? 'is-dimmed' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <button
            aria-label={`${point.label}前沿点`}
            className={className}
            key={point.id}
            onClick={() => onPointClick?.(point)}
            onMouseEnter={() => onPointHover?.(point)}
            onFocus={() => onPointHover?.(point)}
            style={{ left: `${point.left}%`, top: `${point.top}%` }}
            type="button"
          >
            {point.type === 'current' ? '★' : null}
          </button>
        );
      })}
      <div className="composition-allocation-frontier__legend">
        <span>★ 当前组合</span>
        <span>红色空心点 基准组合</span>
        <span>实心高亮 所选方案</span>
        <span>绿色有效前沿</span>
      </div>
    </div>
  );
}

function FrontierPreviewPanel({ legs }: { legs: AllocationLeg[] }): JSX.Element {
  const points = buildFrontierPoints(legs);
  return (
    <section className="composition-allocation-panel">
      <div className="composition-allocation-panel__header">
        <div>
          <h2>候选点分布预览</h2>
          <p>有效前沿预览包含基准组合点，避免只和当前组合比较。</p>
        </div>
      </div>
      <FrontierChart points={points} />
    </section>
  );
}

export function CompositionAllocationConfigPage({
  compositionId,
}: {
  compositionId: string;
}): JSX.Element {
  const api = useApiClient();
  const { loading, model, warning } = useAllocationModel(compositionId);
  const [intent, setIntent] = useState<AllocationIntentKey>('min-vol');
  const [riskTarget, setRiskTarget] = useState(8);
  const [historyPreset, setHistoryPreset] = useState<HistoryPreset>('10y');
  const [turnover, setTurnover] = useState<TurnoverBand>('medium');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [activeConstraint, setActiveConstraint] = useState<ConstraintChipKey | null>(null);
  const [activeLegId, setActiveLegId] = useState<string>('');
  const [legConstraints, setLegConstraints] = useState<Record<string, AllocationLegConstraint>>({});
  const expertMode = intent === 'expert';
  const adjustedLegs = useMemo(
    () => model.legs.map((leg) => applyLegConstraint(leg, legConstraints[leg.id])),
    [legConstraints, model.legs],
  );

  function selectLeg(legId: string): void {
    setActiveLegId(legId);
  }

  function updateLegConstraint(
    legId: string,
    updater: (constraint: AllocationLegConstraint, sourceLeg: AllocationLeg) => AllocationLegConstraint,
  ): void {
    const sourceLeg = model.legs.find((leg) => leg.id === legId);
    if (!sourceLeg) {
      return;
    }
    setActiveLegId(legId);
    setLegConstraints((current) => {
      const currentConstraint = current[legId] ?? defaultLegConstraint(sourceLeg);
      const nextConstraint = updater(currentConstraint, sourceLeg);
      return {
        ...current,
        [legId]: nextConstraint,
      };
    });
  }

  function handleBoundChange(legId: string, bound: 'max' | 'min', value: number): void {
    updateLegConstraint(legId, (constraint) => {
      const nextValue = clampWeightBound(value);
      if (bound === 'min') {
        return {
          ...constraint,
          locked: false,
          minWeight: nextValue,
        };
      }
      return {
        ...constraint,
        locked: false,
        maxWeight: nextValue,
      };
    });
  }

  function handleBoundBlur(legId: string, bound: 'max' | 'min', value: number): void {
    updateLegConstraint(legId, (constraint) => {
      if (constraint.locked) {
        return constraint;
      }
      const currentValue = clampWeightBound(value);
      const minWeight = bound === 'min' ? currentValue : clampWeightBound(constraint.minWeight);
      const maxWeight = bound === 'max' ? currentValue : clampWeightBound(constraint.maxWeight);
      if (minWeight <= maxWeight) {
        return {
          ...constraint,
          maxWeight,
          minWeight,
        };
      }
      return bound === 'min'
        ? {
            ...constraint,
            maxWeight: minWeight,
            minWeight,
          }
        : {
            ...constraint,
            maxWeight,
            minWeight: maxWeight,
          };
    });
  }

  function handleLockChange(
    legId: string,
    locked: boolean,
    configuredBounds?: Pick<AllocationLegConstraint, 'maxWeight' | 'minWeight'>,
  ): void {
    updateLegConstraint(legId, (constraint, sourceLeg) => {
      if (!locked) {
        return defaultUnlockedLegConstraint(sourceLeg);
      }
      const activeBounds = configuredBounds ?? constraint;
      const minWeight = clampWeightBound(activeBounds.minWeight);
      const maxWeight = clampWeightBound(activeBounds.maxWeight);
      const lockWeight = minWeight === maxWeight ? minWeight : sourceLeg.currentWeight;
      return {
        locked: true,
        maxWeight: lockWeight,
        minWeight: lockWeight,
      };
    });
  }

  function handleConstraintSelect(nextConstraint: ConstraintChipKey): void {
    setActiveConstraint(nextConstraint);
    if (nextConstraint === 'cash') {
      const cashLeg = model.legs.find((leg) => leg.role === '现金腿');
      if (cashLeg) {
        selectLeg(cashLeg.id);
      }
    }
  }

  async function handleGenerateCandidates(): Promise<void> {
    if (!api.createCompositionAllocationJob) {
      setSubmitError('组合资产配置任务接口尚未接入，无法生成候选方案。');
      return;
    }

    try {
      setSubmitting(true);
      setSubmitError(null);
      const response = await api.createCompositionAllocationJob(compositionId, {
        constraints: {
          legs: adjustedLegs.map((leg) => ({
            current_weight_pct: leg.currentWeight,
            id: leg.id,
            locked: leg.locked,
            max_weight_pct: leg.maxWeight,
            min_weight_pct: leg.minWeight,
          })),
        },
        covariance_model: expertMode ? 'ledoit_wolf' : null,
        history_window_years: historyWindowYears(historyPreset),
        idempotency_key: [
          'composition-allocation',
          compositionId,
          model.updatedLabel,
          intent,
          riskTarget,
          historyPreset,
          turnover,
          adjustedLegs
            .map((leg) => `${leg.id}:${leg.locked ? 'locked' : 'open'}:${leg.minWeight}-${leg.maxWeight}`)
            .join(','),
        ].join(':'),
        intent: INTENT_REQUEST_VALUES[intent],
        lookback_window: historyPreset,
        max_turnover_bucket: turnover,
        max_turnover_pct: turnoverPct(turnover),
        notes: 'allocation_lab_config_submit',
        return_source: 'historical',
        target_volatility_pct: riskTarget,
        volatility_band_pct: 2,
      });
      const jobId = response.job_id ?? response.id;
      if (!jobId) {
        throw new Error('响应缺少 allocation job id');
      }
      navigateTo(`/compositions/${encodeURIComponent(compositionId)}/allocation-jobs/${encodeURIComponent(jobId)}`);
    } catch (caught) {
      setSubmitError(`生成候选方案失败：${(caught as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      className="composition-allocation-page"
      data-page-root="composition-allocation-config"
      data-route-root="compositions"
    >
      <PageHero compositionId={compositionId} mode="config" model={model} />
      <StatusBanner loading={loading} warning={warning} />
      <div className="composition-allocation-layout">
        <div className="composition-allocation-main">
          <IntentSelector intent={intent} onIntentChange={setIntent} />
          <RiskBoundaryPanel
            historyPreset={historyPreset}
            onHistoryPresetChange={setHistoryPreset}
            onRiskTargetChange={setRiskTarget}
            onTurnoverChange={setTurnover}
            riskTarget={riskTarget}
            turnover={turnover}
          />
          <ConstraintPanel
            activeConstraint={activeConstraint}
            legs={adjustedLegs}
            onConstraintSelect={handleConstraintSelect}
            riskTarget={riskTarget}
            turnover={turnover}
          />
          <AssetAdjustmentPanel
            activeLegId={activeLegId}
            expertMode={expertMode}
            legs={adjustedLegs}
            onBoundBlur={handleBoundBlur}
            onBoundChange={handleBoundChange}
            onLockChange={handleLockChange}
            onSelectLeg={selectLeg}
          />
          {submitError ? (
            <div className="composition-allocation-banner composition-allocation-banner--warning" role="alert">
              {submitError}
            </div>
          ) : null}
          <div className="composition-allocation-actions">
            <button className="composition-allocation-ghost-button" type="button">保存为模板</button>
            <button className="composition-allocation-ghost-button" type="button">复核约束</button>
            <button
              className="composition-allocation-primary-button"
              disabled={loading || submitting}
              onClick={handleGenerateCandidates}
              type="button"
            >
              {submitting ? '生成中' : '开始生成候选方案'}
            </button>
          </div>
        </div>
        <EvidenceRail expertMode={expertMode} legs={adjustedLegs} onExpertOpen={() => setIntent('expert')} />
        <FrontierPreviewPanel legs={adjustedLegs} />
      </div>
    </main>
  );
}

function CandidateBars({
  candidate,
  legs,
}: {
  candidate: AllocationCandidate;
  legs: AllocationLeg[];
}): JSX.Element {
  return (
    <div className="composition-allocation-weight-bars">
      {candidate.weights.map((weight) => {
        const leg = legs.find((item) => item.id === weight.legId);
        return (
          <div className="composition-allocation-weight-row composition-allocation-weight-row--dual" key={weight.legId}>
            <span>{leg?.name ?? weight.legId}</span>
            <div className="composition-allocation-dual-track">
              <i className="composition-allocation-dual-track__risk" style={{ width: `${weight.risk}%` }} />
              <i className="composition-allocation-dual-track__weight" style={{ width: `${weight.weight}%` }} />
            </div>
            <strong>{formatPct(weight.weight, 1)} / {formatPct(weight.risk, 1)}</strong>
          </div>
        );
      })}
    </div>
  );
}

function HoverSnapshot({
  legs,
  point,
}: {
  legs: AllocationLeg[];
  point: FrontierPoint;
}): JSX.Element {
  return (
    <aside className="composition-allocation-hover-card" data-ui="frontier-weight-snapshot">
      <span className="composition-allocation-status composition-allocation-status--info">前沿点权重快照</span>
      <strong>
        {point.label} · {formatPct(point.volatility, 1)} 波动 / {formatPct(point.annualReturn, 1)} 收益
      </strong>
      <div className="composition-allocation-weight-bars">
        {point.weights.map((weight) => {
          const leg = legs.find((item) => item.id === weight.legId);
          return (
            <div className="composition-allocation-weight-row" key={weight.legId}>
              <span>{leg?.name ?? weight.legId}</span>
              <div className="composition-allocation-bar">
                <i style={{ width: `${Math.min(100, weight.weight)}%` }} />
              </div>
              <strong>{formatPct(weight.weight, 1)}</strong>
            </div>
          );
        })}
      </div>
      <p>权重快照用于核对迁移方向，不作为晋升入口。</p>
    </aside>
  );
}

function objectiveLabel(objective: AllocationObjectiveKey): string {
  return OBJECTIVE_OPTIONS.find((item) => item.key === objective)?.label ?? '最小波动';
}

function DeltaSummaryPanel({
  candidate,
  currentMetrics,
}: {
  candidate: AllocationCandidate;
  currentMetrics: AllocationCurrentMetrics;
}): JSX.Element {
  const sharpeDelta = candidate.sharpe - currentMetrics.sharpe;
  const volatilityDelta = candidate.volatility - currentMetrics.volatility;
  const drawdownDelta = candidate.maxDrawdown - currentMetrics.maxDrawdown;
  return (
    <section className="composition-allocation-delta-summary" data-ui="allocation-delta-summary">
      <article>
        <span>夏普增量</span>
        <strong>{sharpeDelta >= 0 ? '+' : ''}{sharpeDelta.toFixed(2)}</strong>
        <small>{candidate.label}</small>
      </article>
      <article>
        <span>波动优化</span>
        <strong>{formatSignedPct(volatilityDelta, 1)}</strong>
        <small>当前 {formatPct(currentMetrics.volatility, 1)} → {formatPct(candidate.volatility, 1)}</small>
      </article>
      <article>
        <span>回撤改善</span>
        <strong>{formatSignedPct(drawdownDelta, 1)}</strong>
        <small>压力窗口最大回撤</small>
      </article>
      <article>
        <span>调仓摩擦</span>
        <strong>{candidate.migrationCostBps} 个基点</strong>
        <small>{candidate.liquidityPressurePct >= 15 ? '执行受限' : '执行可控'}</small>
      </article>
    </section>
  );
}

function RelativePerformancePanel({ candidate }: { candidate: AllocationCandidate }): JSX.Element {
  const endValue = Math.max(0.6, candidate.defensiveAlpha + 0.4);
  return (
    <section className="composition-allocation-panel" data-ui="allocation-relative-performance">
      <div className="composition-allocation-panel__header">
        <div>
          <h2>相对表现 · 提议方案 / 当前组合 - 1</h2>
          <p>累积超额收益曲线，灰区标记压力环境。</p>
        </div>
        <span className="composition-allocation-status composition-allocation-status--good">
          期末 +{endValue.toFixed(1)}%
        </span>
      </div>
      <div className="composition-allocation-relative-chart" aria-label="相对表现曲线">
        <span className="composition-allocation-relative-chart__zero">0</span>
        <span className="composition-allocation-relative-chart__shade composition-allocation-relative-chart__shade--left">
          2020 疫情冲击
        </span>
        <span className="composition-allocation-relative-chart__shade composition-allocation-relative-chart__shade--right">
          2022 紧缩熊市
        </span>
        <svg viewBox="0 0 420 180" role="img" aria-label={`${candidate.label} 相对表现`}>
          <polyline
            fill="none"
            points="12,118 74,112 136,102 198,82 260,86 322,66 408,52"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="5"
          />
          <circle cx="408" cy="52" r="6" />
        </svg>
      </div>
    </section>
  );
}

function StressTestPanel({
  benchmarkMetrics,
  candidate,
  currentMetrics,
  scenarios,
}: {
  benchmarkMetrics: AllocationBenchmarkMetrics;
  candidate: AllocationCandidate;
  currentMetrics: AllocationCurrentMetrics;
  scenarios: AllocationStressScenario[];
}): JSX.Element {
  const formatStressPct = (value: number): string => `${value.toFixed(2)}%`;
  const buildDefensivePremium = (
    currentDrawdown: number,
    candidateDrawdown: number,
    currentRecoveryDays: number,
    candidateRecoveryDays: number,
  ): number => {
    const drawdownImprovement = Math.abs(currentDrawdown) - Math.abs(candidateDrawdown);
    const recoveryImprovement = (currentRecoveryDays - candidateRecoveryDays) / 30;
    const sharpeImprovement = candidate.netSharpe - currentMetrics.sharpe;
    return Number((drawdownImprovement + recoveryImprovement + sharpeImprovement).toFixed(1));
  };
  const liveScenarios = scenarios.length > 0
    ? scenarios
    : [
        {
          benchmarkDrawdown: benchmarkMetrics.maxDrawdown,
          currentDrawdown: currentMetrics.maxDrawdown,
          period: '运行时聚合窗口',
          source: '当前缺少逐月窗口，暂用 allocation job 聚合峰值回撤。',
          title: '运行时峰值回撤',
        },
      ];
  const candidateScale = Math.max(0.25, Math.min(1.85, Math.abs(candidate.maxDrawdown) / Math.max(0.1, Math.abs(currentMetrics.maxDrawdown))));
  const scenarioRows = liveScenarios.map((scenario, index) => {
    const currentDrawdown = scenario.currentDrawdown;
    const candidateDrawdown = Number((currentDrawdown * candidateScale).toFixed(4));
    const benchmarkDrawdown = scenario.benchmarkDrawdown ?? benchmarkMetrics.maxDrawdown;
    const currentRecoveryDays = Math.max(18, Math.round(Math.abs(currentDrawdown) * 9) + index * 8);
    const candidateRecoveryDays = Math.max(18, Math.round(currentRecoveryDays * candidateScale) + index * 4);
    const defensivePremium = buildDefensivePremium(
      currentDrawdown,
      candidateDrawdown,
      currentRecoveryDays,
      candidateRecoveryDays,
    );
    return {
      ...scenario,
      benchmarkDrawdown,
      candidateDrawdown,
      currentDrawdown,
      currentRecoveryDays,
      candidateRecoveryDays,
      defensivePremium,
      defensiveTone: defensivePremium > 0.05 ? 'good' : defensivePremium < -0.05 ? 'warn' : 'neutral',
      candidateDrawdownTone: Math.abs(candidateDrawdown) > Math.abs(currentDrawdown) + 0.05 ? 'warn' : 'good',
    };
  });
  const maxScenarioDrawdown = Math.max(
    1,
    ...scenarioRows.flatMap((scenario) => [
      Math.abs(scenario.currentDrawdown),
      Math.abs(scenario.benchmarkDrawdown),
      Math.abs(scenario.candidateDrawdown),
    ]),
  );
  const barWidth = (drawdown: number): string => `${Math.max(18, Math.min(92, (Math.abs(drawdown) / maxScenarioDrawdown) * 88))}%`;

  return (
    <section className="composition-allocation-panel composition-allocation-stress-panel" data-ui="allocation-stress-test">
      <div className="composition-allocation-panel__header">
        <div>
          <h2>极端行情压力测试</h2>
          <p>最大回撤、修复周期与防御溢价。</p>
        </div>
        <span className="composition-allocation-status composition-allocation-status--info">3 场景</span>
      </div>
      <div className="composition-allocation-stress-grid">
        {scenarioRows.map((scenario) => (
          <article key={scenario.title}>
            <div>
              <h3>{scenario.title}</h3>
              <span className="composition-allocation-stress-period">{scenario.period}</span>
            </div>
            <div className="composition-allocation-stress-bars" aria-label={`${scenario.title} 压测回撤对比`}>
              <div className="composition-allocation-stress-bar-row">
                <span>当前</span>
                <div className="composition-allocation-stress-track">
                  <i className="composition-allocation-stress-track__current" style={{ width: barWidth(scenario.currentDrawdown) }} />
                </div>
                <strong>{formatStressPct(scenario.currentDrawdown)}</strong>
              </div>
              <div className="composition-allocation-stress-bar-row">
                <span>基准</span>
                <div className="composition-allocation-stress-track">
                  <i className="composition-allocation-stress-track__benchmark" style={{ width: barWidth(scenario.benchmarkDrawdown) }} />
                </div>
                <strong>{formatStressPct(scenario.benchmarkDrawdown)}</strong>
              </div>
              <div className="composition-allocation-stress-bar-row">
                <span>{candidate.label}</span>
                <div className="composition-allocation-stress-track">
                  <i
                    className={`composition-allocation-stress-track__candidate composition-allocation-stress-track__candidate--${scenario.candidateDrawdownTone}`}
                    style={{ width: barWidth(scenario.candidateDrawdown) }}
                  />
                </div>
                <strong>{formatStressPct(scenario.candidateDrawdown)}</strong>
              </div>
            </div>
            <div className="composition-allocation-stress-kpis">
              <div>
                <span>修复周期</span>
                <strong>{scenario.currentRecoveryDays}d {'->'} {scenario.candidateRecoveryDays}d</strong>
              </div>
              <div className={`composition-allocation-stress-kpi--${scenario.defensiveTone}`}>
                <span>防御溢价</span>
                <strong>{formatSignedPoints(scenario.defensivePremium)}</strong>
              </div>
            </div>
            <p className="composition-allocation-stress-source">{scenario.source}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function CandidateSelectorPanel({
  benchmarkMetrics,
  candidatePool,
  candidates,
  currentMetrics,
  objective,
  onObjectiveChange,
  onSelectCandidate,
  selectedCandidateId,
}: {
  benchmarkMetrics: AllocationBenchmarkMetrics;
  candidatePool: AllocationCandidate[];
  candidates: AllocationCandidate[];
  currentMetrics: AllocationCurrentMetrics;
  objective: AllocationObjectiveKey;
  onObjectiveChange: (objective: AllocationObjectiveKey) => void;
  onSelectCandidate: (candidateId: string) => void;
  selectedCandidateId: string;
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const selectorCell = (children: ReactNode, tone: SelectorTone = 'good') => (
    <span className={`composition-allocation-selector-value composition-allocation-selector-value--${tone}`}>
      {children}
    </span>
  );
  const rows: Array<{
    benchmark: ReactNode;
    benchmarkTone?: SelectorTone;
    key: string;
    current: string;
    tone?: SelectorTone;
    cellTone?: (candidate: AllocationCandidate) => SelectorTone;
    renderCandidate: (candidate: AllocationCandidate, tone: SelectorTone) => JSX.Element;
  }> = [
    {
      key: '年化收益率',
      benchmark: selectorCell(
        <>
          {formatPct(benchmarkMetrics.annualReturn, 1)}
          <small>{formatSignedPct(benchmarkMetrics.annualReturn - currentMetrics.annualReturn, 1)}</small>
        </>,
        'neutral',
      ),
      benchmarkTone: 'neutral',
      current: formatPct(currentMetrics.annualReturn, 1),
      tone: 'neutral',
      renderCandidate: (candidate, tone) => selectorCell(
        <>
          {formatPct(candidate.annualReturn, 1)}
          <small>{formatSignedPct(candidate.annualReturn - currentMetrics.annualReturn, 1)}</small>
        </>,
        tone,
      ),
    },
    {
      key: '年化夏普',
      benchmark: selectorCell(
        <>
          {benchmarkMetrics.sharpe.toFixed(2)}
          <small>
            {benchmarkMetrics.sharpe - currentMetrics.sharpe >= 0 ? '+' : ''}
            {(benchmarkMetrics.sharpe - currentMetrics.sharpe).toFixed(2)}
          </small>
        </>,
        benchmarkMetrics.sharpe + 0.005 < currentMetrics.sharpe ? 'warn' : 'good',
      ),
      benchmarkTone: benchmarkMetrics.sharpe + 0.005 < currentMetrics.sharpe ? 'warn' : 'good',
      current: currentMetrics.sharpe.toFixed(2),
      tone: 'good',
      cellTone: (candidate) => (candidate.sharpe + 0.005 < currentMetrics.sharpe ? 'warn' : 'good'),
      renderCandidate: (candidate, tone) => selectorCell(
        <>
          {candidate.sharpe.toFixed(2)}
          <small>{candidate.sharpe - currentMetrics.sharpe >= 0 ? '+' : ''}{(candidate.sharpe - currentMetrics.sharpe).toFixed(2)}</small>
        </>,
        tone,
      ),
    },
    {
      key: '年化波动',
      benchmark: selectorCell(
        <>
          {formatPct(benchmarkMetrics.volatility, 1)}
          <small>{formatSignedPct(benchmarkMetrics.volatility - currentMetrics.volatility, 1)}</small>
        </>,
        benchmarkMetrics.volatility > currentMetrics.volatility + 0.05 ? 'warn' : 'good',
      ),
      benchmarkTone: benchmarkMetrics.volatility > currentMetrics.volatility + 0.05 ? 'warn' : 'good',
      current: formatPct(currentMetrics.volatility, 1),
      tone: 'good',
      cellTone: (candidate) => (candidate.volatility > currentMetrics.volatility + 0.05 ? 'warn' : 'good'),
      renderCandidate: (candidate, tone) => selectorCell(
        <>
          {formatPct(candidate.volatility, 1)}
          <small>{formatSignedPct(candidate.volatility - currentMetrics.volatility, 1)}</small>
        </>,
        tone,
      ),
    },
    {
      key: '峰值回撤',
      benchmark: selectorCell(
        <>
          {formatPct(benchmarkMetrics.maxDrawdown, 1)}
          <small>
            {benchmarkMetrics.maxDrawdown - currentMetrics.maxDrawdown >= 0
              ? `改善 ${(benchmarkMetrics.maxDrawdown - currentMetrics.maxDrawdown).toFixed(1)}pt`
              : formatSignedPct(benchmarkMetrics.maxDrawdown - currentMetrics.maxDrawdown, 1)}
          </small>
        </>,
        benchmarkMetrics.maxDrawdown < currentMetrics.maxDrawdown - 0.05 ? 'warn' : 'good',
      ),
      benchmarkTone: benchmarkMetrics.maxDrawdown < currentMetrics.maxDrawdown - 0.05 ? 'warn' : 'good',
      current: formatPct(currentMetrics.maxDrawdown, 1),
      tone: 'good',
      cellTone: (candidate) => (candidate.maxDrawdown < currentMetrics.maxDrawdown - 0.05 ? 'warn' : 'good'),
      renderCandidate: (candidate, tone) => selectorCell(
        <>
          {formatPct(candidate.maxDrawdown, 1)}
          <small>
            {candidate.maxDrawdown - currentMetrics.maxDrawdown >= 0
              ? `改善 ${(candidate.maxDrawdown - currentMetrics.maxDrawdown).toFixed(1)}pt`
              : formatSignedPct(candidate.maxDrawdown - currentMetrics.maxDrawdown, 1)}
          </small>
        </>,
        tone,
      ),
    },
    {
      key: '有效资产数',
      benchmark: selectorCell('基准权重', 'neutral'),
      benchmarkTone: 'neutral',
      current: currentMetrics.enb.toFixed(1),
      tone: 'good',
      cellTone: (candidate) => (candidate.enb < Math.max(2.5, currentMetrics.enb) ? 'warn' : 'good'),
      renderCandidate: (candidate, tone) => selectorCell(
        <>
          {candidate.enb.toFixed(1)}
          <small>{candidate.enb - currentMetrics.enb >= 0 ? '+' : ''}{(candidate.enb - currentMetrics.enb).toFixed(1)}</small>
        </>,
        tone,
      ),
    },
    {
      key: '跟踪误差',
      benchmark: selectorCell('对照项', 'neutral'),
      benchmarkTone: 'neutral',
      current: '0.0%',
      tone: 'neutral',
      renderCandidate: (candidate, tone) => selectorCell(formatPct(candidate.trackingError, 1), tone),
    },
    {
      key: '预估摩擦成本',
      benchmark: selectorCell('-', 'cost'),
      benchmarkTone: 'cost',
      current: '-',
      tone: 'cost',
      cellTone: (candidate) => (candidate.migrationCostBps >= 15 ? 'warn' : 'cost'),
      renderCandidate: (candidate, tone) => selectorCell(`${candidate.migrationCostBps} bps`, tone),
    },
  ];

  return (
    <section className="composition-allocation-panel composition-allocation-panel--span-2" data-ui="allocation-candidate-selector">
      <div className="composition-allocation-panel__header">
        <div>
          <h2>候选选择器 · 多维度选拔赛</h2>
          <p>{candidatePool.length} 候选池 · 固定对比当前组合与基准组合，当前展示：按{objectiveLabel(objective)}排序的前三名。</p>
        </div>
        <div className="composition-allocation-selector-actions">
          <div className="composition-allocation-selector-dropdown">
            <button
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              className="composition-allocation-selector-button"
              onClick={() => setMenuOpen((value) => !value)}
              type="button"
            >
              选择目标
            </button>
            {menuOpen ? (
            <div className="composition-allocation-selector-menu" aria-label="目标选择" role="menu">
              {OBJECTIVE_OPTIONS.map((item) => (
                <button
                  aria-checked={objective === item.key}
                  className={objective === item.key ? 'is-active' : ''}
                  key={item.key}
                  onClick={() => {
                    onObjectiveChange(item.key);
                    setMenuOpen(false);
                  }}
                  role="menuitemradio"
                  type="button"
                >
                  <span>{item.label}</span>
                  <strong>{objective === item.key ? '✓' : ''}</strong>
                </button>
              ))}
            </div>
            ) : null}
          </div>
          <span className="composition-allocation-status composition-allocation-status--good">
            已选：{objectiveLabel(objective)}
          </span>
        </div>
      </div>
      <div className="composition-allocation-table-shell composition-allocation-selector-table">
        <table className="composition-allocation-table">
          <thead>
            <tr>
              <th>维度</th>
              <th>当前组合</th>
              <th>
                <span className="composition-allocation-rank-label">
                  基准组合
                  <small>{benchmarkMetrics.label}</small>
                </span>
              </th>
              {candidates.map((candidate, index) => (
                <th key={candidate.id}>
                  <span className="composition-allocation-rank-label">
                    第 {index + 1} 名
                    <small>{candidate.label}</small>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className={row.tone ? `composition-allocation-selector-row--${row.tone}` : undefined} key={row.key}>
                <td>{row.key}</td>
                <td>{row.current}</td>
                <td className={`composition-allocation-selector-cell--${row.benchmarkTone ?? row.tone ?? 'neutral'}`}>
                  {row.benchmark}
                </td>
                {candidates.map((candidate) => {
                  const tone = row.cellTone?.(candidate) ?? row.tone ?? 'good';
                  return (
                    <td className={`composition-allocation-selector-cell--${tone}`} key={`${row.key}-${candidate.id}`}>
                      {row.renderCandidate(candidate, tone)}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="composition-allocation-selector-row--action">
              <td>决策动作</td>
              <td aria-label="当前组合不提供决策动作" />
              <td aria-label="基准组合只用于对比" />
              {candidates.map((candidate) => (
                <td key={`action-${candidate.id}`}>
                  <button
                    className={selectedCandidateId === candidate.id ? 'composition-allocation-primary-button' : 'composition-allocation-ghost-button'}
                    onClick={() => onSelectCandidate(candidate.id)}
                    type="button"
                  >
                    查看方案
                  </button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ExecutionDecisionPanel({
  candidate,
  disabledReason,
  legs,
  onOpenPromotion,
  promotionSuccess,
}: {
  candidate: AllocationCandidate;
  disabledReason: string | null;
  legs: AllocationLeg[];
  onOpenPromotion: () => void;
  promotionSuccess: string | null;
}): JSX.Element {
  const statusLabel = disabledReason ? '门禁阻断' : candidate.executionLimited ? '执行受限' : '可晋升';
  return (
    <aside className="composition-allocation-panel composition-allocation-decision-card" data-ui="allocation-decision-card">
      <div className="composition-allocation-panel__header">
        <div>
          <h2>执行决策</h2>
          <p>{objectiveLabel(candidate.objectiveKey)} · 排名 {candidate.rank}</p>
        </div>
        <span className={candidate.executionLimited ? 'composition-allocation-status composition-allocation-status--warning' : 'composition-allocation-status composition-allocation-status--good'}>
          {statusLabel}
        </span>
      </div>
      <article className="composition-allocation-candidate composition-allocation-candidate--best">
        <div className="composition-allocation-candidate__topline">
          <div>
            <strong>{candidate.label}</strong>
            <span className="composition-allocation-badge">已符合{objectiveLabel(candidate.objectiveKey)}意图</span>
          </div>
          <span className={candidate.enb < 2.5 ? 'composition-allocation-enb composition-allocation-enb--warning' : 'composition-allocation-enb'}>
            有效资产数 {candidate.enb.toFixed(1)}
          </span>
        </div>
        <CandidateBars candidate={candidate} legs={legs} />
        <div className="composition-allocation-metric-strip">
          <span>扣费后夏普 {candidate.netSharpe.toFixed(2)}</span>
          <span>摩擦 {candidate.migrationCostBps} 个基点</span>
          <span>流动性压力 {candidate.liquidityPressurePct.toFixed(1)}%</span>
        </div>
        <p className={candidate.executionLimited ? 'composition-allocation-warning-copy' : ''}>{candidate.verdict}</p>
        {candidate.violation && candidate.violation !== disabledReason ? <div className="composition-allocation-violation">{candidate.violation}</div> : null}
        {disabledReason ? <div className="composition-allocation-violation">{disabledReason}</div> : null}
        {promotionSuccess ? <div className="composition-allocation-action-state" role="status">{promotionSuccess}</div> : null}
        <button
          className="composition-allocation-primary-button composition-allocation-decision-card__primary"
          disabled={Boolean(disabledReason)}
          onClick={onOpenPromotion}
          type="button"
        >
          生成草稿版本
        </button>
      </article>
    </aside>
  );
}

function AuditDisclosure({ candidate }: { candidate: AllocationCandidate }): JSX.Element {
  return (
    <section className="composition-allocation-panel composition-allocation-audit" data-ui="allocation-audit">
      <div className="composition-allocation-audit__summary">
        <div>
          <h2>审计结论：证据有限，已显式提示</h2>
          <p>替代数据、来源签名、调仓摩擦可追溯。</p>
        </div>
      </div>
      <div className="composition-allocation-audit__grid">
        <div className="composition-allocation-evidence-box">
          <strong>候选来源</strong>
          <span>{candidate.label} · 换手 {formatPct(candidate.turnover, 1)} · 摩擦 {candidate.migrationCostBps} bps。</span>
          <strong>执行判断</strong>
          <span>{candidate.executionLimited ? '需交易台复核，暂缓自动晋升。' : '执行窗口可控，可进入决策卡确认。'}</span>
        </div>
        <div className="composition-allocation-evidence-box">
          <strong>收益质量</strong>
          <span>{candidate.sourceEvidence}</span>
          <strong>来源签名</strong>
          <span>冻结来源为决策基准；漂移仅作提示项。</span>
          <strong>允许替换</strong>
          <span>候选、指标、成本绑定实时接口。</span>
        </div>
      </div>
    </section>
  );
}

function buildPromotionPayload(legs: AllocationLeg[], candidate: AllocationCandidate): Record<string, unknown> {
  return {
    legs: legs.map((leg) => {
      const target = candidate.weights.find((item) => item.legId === leg.id);
      return {
        config: leg.config,
        display_name: leg.displayName,
        leg_kind: leg.legKind,
        ordering: leg.ordering,
        source_ref_id: leg.sourceRefId,
        source_ref_type: leg.sourceRefType,
        weight_locked: leg.locked,
        weight_pct: target?.weight ?? leg.currentWeight,
      };
    }),
  };
}

function buildPromotionChangeRows(legs: AllocationLeg[], candidate: AllocationCandidate): string[] {
  const rows = legs
    .map((leg) => {
      const target = candidate.weights.find((item) => item.legId === leg.id);
      const nextWeight = target?.weight ?? leg.currentWeight;
      if (Math.abs(nextWeight - leg.currentWeight) < 0.05) {
        return null;
      }
      return `${leg.displayName || leg.name} 权重：${leg.currentWeight.toFixed(1)}% -> ${nextWeight.toFixed(1)}%`;
    })
    .filter((item): item is string => Boolean(item));
  rows.push(`候选方案：${candidate.label}`);
  rows.push(`迁移成本：${candidate.migrationCostBps} bps，预估换手：${candidate.turnover.toFixed(1)}%`);
  return rows;
}

function PromotionDialog({
  candidate,
  error,
  legs,
  onCancel,
  onConfirm,
  onReasonChange,
  reason,
  submitting,
}: {
  candidate: AllocationCandidate;
  error: string | null;
  legs: AllocationLeg[];
  onCancel: () => void;
  onConfirm: () => void;
  onReasonChange: (value: string) => void;
  reason: string;
  submitting: boolean;
}): JSX.Element {
  const changes = buildPromotionChangeRows(legs, candidate);
  return (
    <div className="composition-allocation-dialog-backdrop" role="presentation">
      <section
        aria-labelledby="allocation-promotion-dialog-title"
        aria-modal="true"
        className="composition-allocation-dialog"
        role="dialog"
      >
        <div className="composition-allocation-panel__header">
          <div>
            <h2 id="allocation-promotion-dialog-title">确认生成草稿版本</h2>
            <p>{candidate.label} · {candidate.sourceEvidence}</p>
          </div>
        </div>
        <div className="composition-allocation-dialog__grid">
          <span>预估摩擦 <strong>{candidate.migrationCostBps} 个基点</strong></span>
          <span>流动性压力 <strong>{candidate.liquidityPressurePct.toFixed(1)}%</strong></span>
          <span>修复周期 <strong>{candidate.recoveryDays} 天</strong></span>
        </div>
        <div className="composition-allocation-dialog__changes">
          {changes.map((change) => (
            <span key={change}>{change}</span>
          ))}
        </div>
        <CandidateBars candidate={candidate} legs={legs} />
        <label className="composition-allocation-dialog__reason">
          <span>升级理由</span>
          <textarea
            aria-label="升级理由"
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder="例如：采用配置实验室候选，降低组合风险暴露。"
            value={reason}
          />
        </label>
        {error ? <div className="composition-allocation-violation" role="alert">{error}</div> : null}
        <div className="composition-allocation-actions">
          <button className="composition-allocation-ghost-button" onClick={onCancel} type="button">
            取消
          </button>
          <button className="composition-allocation-primary-button" disabled={submitting || !reason.trim()} onClick={onConfirm} type="button">
            {submitting ? '提交中' : '确认生成草稿'}
          </button>
        </div>
      </section>
    </div>
  );
}

export function CompositionAllocationResultPage({
  compositionId,
  intent = 'min-vol',
  jobId,
}: {
  compositionId: string;
  intent?: AllocationIntentKey;
  jobId: string;
}): JSX.Element {
  const api = useApiClient();
  const pageRef = useRef<HTMLElement | null>(null);
  const { loading, model, warning } = useAllocationModel(compositionId);
  const allocationJob = useAllocationJob(compositionId, jobId);
  const currentMetrics = useMemo(() => currentMetricsFromJob(allocationJob.job, model), [allocationJob.job, model]);
  const benchmarkMetrics = useMemo(() => benchmarkMetricsFromJob(allocationJob.job, model), [allocationJob.job, model]);
  const candidates = useMemo(() => buildCandidatesFromJob(allocationJob.job, model), [allocationJob.job, model]);
  const frontierPoints = useMemo(
    () => buildFrontierPointsFromJob(allocationJob.job, candidates, currentMetrics, model.legs),
    [allocationJob.job, candidates, currentMetrics, model.legs],
  );
  const [hoveredPoint, setHoveredPoint] = useState<FrontierPoint>(frontierPoints[0]);
  const initialObjective: AllocationObjectiveKey = intent === 'expert' ? 'min-vol' : intent;
  const [selectedObjective, setSelectedObjective] = useState<AllocationObjectiveKey>(initialObjective);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>('');
  const [promotionDialogOpen, setPromotionDialogOpen] = useState(false);
  const [promotionSubmitting, setPromotionSubmitting] = useState(false);
  const [promotionError, setPromotionError] = useState<string | null>(null);
  const [promotionSuccess, setPromotionSuccess] = useState<string | null>(null);
  const [promotionReason, setPromotionReason] = useState('');

  useEffect(() => {
    scrollAllocationPageToTop();
    pageRef.current?.focus({ preventScroll: true });
  }, [compositionId, jobId]);

  useEffect(() => {
    setHoveredPoint(frontierPoints[0]);
  }, [frontierPoints]);

  useEffect(() => {
    setSelectedObjective(initialObjective);
  }, [initialObjective]);

  const objectiveCandidates = useMemo(
    () => rankCandidatesForObjective(candidates, selectedObjective).slice(0, 3),
    [candidates, selectedObjective],
  );

  useEffect(() => {
    if (!objectiveCandidates.some((candidate) => candidate.id === selectedCandidateId)) {
      setSelectedCandidateId(objectiveCandidates[0]?.id ?? candidates[0]?.id ?? '');
    }
  }, [candidates, objectiveCandidates, selectedCandidateId]);

  const selectedCandidate =
    candidates.find((candidate) => candidate.id === selectedCandidateId)
    ?? objectiveCandidates[0]
    ?? candidates[0]
    ?? buildCandidates(DEFAULT_MODEL.legs)[0]!;
  const selectedPointId = selectedCandidate?.id ?? selectedObjective;
  const selectedPoint = frontierPoints.find((point) => point.id === selectedPointId) ?? frontierPoints[0];
  const promotionReadinessReason = promotionReadinessBlockedReason(selectedCandidate?.promotionReadiness);
  const promotionDisabledReason = !api.promoteCompositionAllocationCandidateToDraft
    ? '候选晋升接口未接入，暂不能生成草稿版本。'
    : selectedCandidate?.canPromote === false
      ? '该候选不是可晋升方案。'
      : promotionReadinessReason
        ? promotionReadinessReason
        : selectedCandidate?.executionLimited
          ? '该候选触发执行受限，请先完成交易台流动性复核。'
          : null;

  useEffect(() => {
    if (selectedPoint) {
      setHoveredPoint(selectedPoint);
    }
  }, [selectedPoint]);

  function handleObjectiveChange(nextObjective: AllocationObjectiveKey): void {
    setSelectedObjective(nextObjective);
    const nextCandidate = rankCandidatesForObjective(candidates, nextObjective)[0];
    setSelectedCandidateId(nextCandidate?.id ?? '');
    setPromotionDialogOpen(false);
    setPromotionError(null);
    setPromotionSuccess(null);
    setPromotionReason('');
  }

  function handleSelectCandidate(candidateId: string): void {
    setSelectedCandidateId(candidateId);
    setPromotionDialogOpen(false);
    setPromotionError(null);
    setPromotionSuccess(null);
    setPromotionReason('');
  }

  async function handleConfirmPromotion(): Promise<void> {
    if (!selectedCandidate || !api.promoteCompositionAllocationCandidateToDraft) {
      return;
    }
    try {
      setPromotionSubmitting(true);
      setPromotionError(null);
      const draftVersion = await api.promoteCompositionAllocationCandidateToDraft(compositionId, jobId, selectedCandidate.id, {
        decision_note: promotionReason.trim(),
      });
      setPromotionDialogOpen(false);
      setPromotionReason('');
      setPromotionSuccess(`已生成草稿版本 v${draftVersion.version_number}：${selectedCandidate.label}`);
    } catch (caught) {
      setPromotionError(`生成草稿版本失败：${(caught as Error).message}`);
    } finally {
      setPromotionSubmitting(false);
    }
  }

  return (
    <main
      className="composition-allocation-page"
      data-page-root="composition-allocation-result"
      data-route-root="compositions"
      ref={pageRef}
      tabIndex={-1}
    >
      <PageHero compositionId={compositionId} jobId={jobId} mode="result" model={model} />
      <StatusBanner loading={loading || allocationJob.loading} warning={warning ?? allocationJob.warning} />
      <CandidateSelectorPanel
        benchmarkMetrics={benchmarkMetrics}
        candidatePool={candidates}
        candidates={objectiveCandidates}
        currentMetrics={currentMetrics}
        objective={selectedObjective}
        onObjectiveChange={handleObjectiveChange}
        onSelectCandidate={handleSelectCandidate}
        selectedCandidateId={selectedCandidate.id}
      />
      <div className="composition-allocation-results-grid">
        <div className="composition-allocation-evidence-stack">
          <section className="composition-allocation-panel composition-allocation-panel--frontier">
            <div className="composition-allocation-panel__header">
              <div>
                <h2>有效前沿 · 迁移向量</h2>
                <p>左上迁移：风险降低的同时收益提升。</p>
              </div>
              <span className="composition-allocation-status composition-allocation-status--good">
                当前目标：{objectiveLabel(selectedCandidate.objectiveKey)}
              </span>
            </div>
            <FrontierChart
              currentPointId={selectedPointId}
              onPointClick={(point) => {
                setHoveredPoint(point);
                const pointCandidate = candidates.find((candidate) => candidate.id === point.id);
                if (pointCandidate) {
                  setSelectedObjective(pointCandidate.objectiveKey);
                  handleSelectCandidate(pointCandidate.id);
                } else if (point.type === 'min-vol' || point.type === 'risk-parity' || point.type === 'max-sharpe') {
                  handleObjectiveChange(point.type);
                }
              }}
              onPointHover={setHoveredPoint}
              points={frontierPoints}
              selectedPointId={selectedPointId}
            />
            <div className="composition-allocation-phase-strip">
              <span><strong>当前组合</strong>收益 {formatPct(currentMetrics.annualReturn, 1)} / 波动 {formatPct(currentMetrics.volatility, 1)}</span>
              <span><strong>基准组合</strong>收益 {formatPct(benchmarkMetrics.annualReturn, 1)} / 波动 {formatPct(benchmarkMetrics.volatility, 1)}</span>
              <span className="is-active"><strong>所选方案：{selectedCandidate.label}</strong> 收益 {formatPct(selectedCandidate.annualReturn, 1)} / 波动 {formatPct(selectedCandidate.volatility, 1)}</span>
            </div>
            <HoverSnapshot legs={model.legs} point={selectedPoint} />
          </section>
          <RelativePerformancePanel candidate={selectedCandidate} />
        </div>
        <ExecutionDecisionPanel
          candidate={selectedCandidate}
          disabledReason={promotionDisabledReason}
          legs={model.legs}
          onOpenPromotion={() => {
            setPromotionDialogOpen(true);
            setPromotionError(null);
            setPromotionReason('');
          }}
          promotionSuccess={promotionSuccess}
        />
      </div>
      <StressTestPanel
        benchmarkMetrics={benchmarkMetrics}
        candidate={selectedCandidate}
        currentMetrics={currentMetrics}
        scenarios={model.stressScenarios}
      />
      <AuditDisclosure candidate={selectedCandidate} />
      {promotionDialogOpen ? (
        <PromotionDialog
          candidate={selectedCandidate}
          error={promotionError}
          legs={model.legs}
          onCancel={() => setPromotionDialogOpen(false)}
          onConfirm={() => {
            void handleConfirmPromotion();
          }}
          onReasonChange={setPromotionReason}
          reason={promotionReason}
          submitting={promotionSubmitting}
        />
      ) : null}
    </main>
  );
}

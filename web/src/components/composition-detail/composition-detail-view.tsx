import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useMemo,
  useState,
} from 'react';
import { navigateTo } from '../../lib/appRouteContext';
import { formatDateTime } from '../../lib/format';
import {
  cleanDisplayText,
  formatBenchmarkLabel,
  formatComposePercent,
  formatCompositionStatusLabel,
  formatCompositionHeroCopy,
  formatCompositionName,
  formatLegProofLabel,
  formatLegDisplayName,
  formatLegReferenceSummary,
  normalizePercentLike,
} from '../../lib/compose-display';
import {
  diagnosisTone,
  primaryCompositionDiagnosis,
} from '../../lib/composition-diagnostics';
import { LegDetailDrawer } from '../legs/leg-inventory-view';
import type {
  ApiCompositionCorrelationCell,
  ApiCompositionDetail,
  ApiCompositionKpi,
  ApiCompositionPreviewLeg,
  ApiCompositionRiskContribution,
  ApiCompositionSourceIntegrity,
  ApiCompositionSourceFreeze,
  ApiCompositionStatus,
  ApiLegInventoryRow,
} from '../../types';
import './composition-detail.css';
import '../legs/leg-inventory.css';

type CorrelationMode = 'current' | 'stress';

type CompositionDetailViewProps = {
  detail: ApiCompositionDetail | null;
  loading?: boolean;
  error?: string | null;
  approvedPreview?: boolean;
  savingStatus?: boolean;
  writeError?: string | null;
  onStatusChange?: (status: ApiCompositionStatus) => Promise<void> | void;
};

type DetailKpiCard = {
  key: string;
  label: string;
  value: string;
  tone: string;
  detail: string;
  tooltip?: string;
  trendText?: string;
  trendTone?: 'better' | 'worse' | 'neutral';
  compareItems?: Array<{ label: string; value: string }>;
  accent?: boolean;
};

type AnnualizedCostBreakdown = {
  maintenance: number;
  slippage: number;
  cashBuffer: number;
  rebalance: number;
  total: number;
};

type ExecutionHistoryRow = {
  key: string;
  runId: string;
  dateLabel: string;
  versionLabel: string;
  periodLabel: string;
  annualizedLabel: string;
  sharpeLabel: string;
};

type VersionEvolutionRow = {
  key: string;
  title: string;
  detail: string;
  meta: string;
  versionAfter: number;
};

type ExposureDrilldownRow = {
  key: string;
  source: string;
  layer: string;
  detail: string;
  tone: 'good' | 'info' | 'warn';
};

function getToneClassName(tone?: string | null): string {
  switch (String(tone || '').toLowerCase()) {
    case 'positive':
    case 'success':
    case 'good':
      return 'composition-detail-kpi-card__insight composition-detail-kpi-card__insight--positive';
    case 'warning':
    case 'warm':
    case 'watch':
      return 'composition-detail-kpi-card__insight composition-detail-kpi-card__insight--warning';
    case 'critical':
    case 'danger':
      return 'composition-detail-kpi-card__insight composition-detail-kpi-card__insight--critical';
    case 'blue':
      return 'composition-detail-kpi-card__insight composition-detail-kpi-card__insight--blue';
    default:
      return 'composition-detail-kpi-card__insight composition-detail-kpi-card__insight--neutral';
  }
}

function formatPercentCardValue(
  value?: number | null,
  options?: { signed?: boolean; forceNegative?: boolean },
): string {
  const normalized = normalizePercentLike(value);
  const signedValue = options?.forceNegative ? -Math.abs(normalized) : normalized;
  const percent = signedValue * 100;
  const absPercent = Math.abs(percent);
  const precision = absPercent >= 10 || absPercent === 0 ? 0 : 1;
  const body = `${percent.toFixed(precision)}%`;
  return options?.signed && percent > 0 ? `+${body}` : body;
}

function formatChartPercentValue(value?: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '暂无';
  }
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(2)}%`;
}

function parseMetricNumber(value?: string | number | null): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const parsed = Number(value.replace(/[%+,bps\s]/gi, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function findKpi(detail: ApiCompositionDetail, key: string): ApiCompositionKpi | null {
  return detail.kpis.find((item) => item.key === key) ?? null;
}

function findKpiNumber(detail: ApiCompositionDetail, key: string): number | null {
  return parseMetricNumber(findKpi(detail, key)?.value);
}

function findKpiText(detail: ApiCompositionDetail, key: string): string | null {
  const value = findKpi(detail, key)?.value;
  return typeof value === 'string' ? getDisplayText(value, '') : null;
}

function getLatestCumulativeReturn(detail: ApiCompositionDetail): number | null {
  const latest = detail.returns_preview[detail.returns_preview.length - 1];
  return typeof latest?.cumulative_return_pct === 'number' ? latest.cumulative_return_pct : null;
}

function getLatestBenchmarkCumulativeReturn(detail: ApiCompositionDetail): number | null {
  const latest = detail.benchmark_series[detail.benchmark_series.length - 1];
  return typeof latest?.cumulative_return_pct === 'number' ? latest.cumulative_return_pct : null;
}

function getLatestSpreadPct(detail: ApiCompositionDetail): number | null {
  const latest = detail.spread_series[detail.spread_series.length - 1];
  if (typeof latest?.spread_pct === 'number') {
    return latest.spread_pct;
  }
  const portfolio = getLatestCumulativeReturn(detail);
  const benchmark = getLatestBenchmarkCumulativeReturn(detail);
  return portfolio !== null && benchmark !== null ? portfolio - benchmark : null;
}

function getReturnWindowYears(detail: ApiCompositionDetail): number {
  const datedPoints = detail.returns_preview.filter((point) => point.date);
  const firstDate = datedPoints[0]?.date ? new Date(datedPoints[0].date).getTime() : Number.NaN;
  const lastDate = datedPoints[datedPoints.length - 1]?.date
    ? new Date(datedPoints[datedPoints.length - 1].date as string).getTime()
    : Number.NaN;
  if (Number.isFinite(firstDate) && Number.isFinite(lastDate) && lastDate > firstDate) {
    return Math.max((lastDate - firstDate) / (1000 * 60 * 60 * 24 * 365.25), 1 / 12);
  }
  return Math.max(detail.returns_preview.length / 12, 1 / 12);
}

function annualizeCumulativePercent(value: number | null, years: number): number | null {
  if (value === null || years <= 0) {
    return null;
  }
  const totalReturn = normalizePercentLike(value);
  if (totalReturn <= -1) {
    return null;
  }
  return (1 + totalReturn) ** (1 / years) - 1;
}

function getBenchmarkMonthlyReturns(detail: ApiCompositionDetail): number[] {
  return detail.benchmark_series
    .map((point) => normalizePercentLike(point.benchmark_return_pct))
    .filter((value) => Number.isFinite(value));
}

function calculateAnnualizedVolatility(returns: number[]): number | null {
  if (returns.length < 2) {
    return null;
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(12);
}

function calculateAnnualizedSharpe(returns: number[]): number | null {
  const volatility = calculateAnnualizedVolatility(returns);
  if (!volatility) {
    return null;
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  return (mean * 12) / volatility;
}

function calculateAnnualizedSortino(returns: number[]): number | null {
  if (returns.length < 2) {
    return null;
  }
  const downside = returns.filter((value) => value < 0);
  if (!downside.length) {
    return null;
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const downsideVariance = downside.reduce((sum, value) => sum + value ** 2, 0) / downside.length;
  const downsideDeviation = Math.sqrt(downsideVariance) * Math.sqrt(12);
  return downsideDeviation ? (mean * 12) / downsideDeviation : null;
}

function calculateBenchmarkDrawdown(detail: ApiCompositionDetail): number | null {
  if (!detail.benchmark_series.length) {
    return null;
  }
  let peak = Number.NEGATIVE_INFINITY;
  let maxDrawdown = 0;
  detail.benchmark_series.forEach((point) => {
    const value = 1 + normalizePercentLike(point.cumulative_return_pct);
    if (!Number.isFinite(value)) {
      return;
    }
    peak = Math.max(peak, value);
    const drawdown = peak ? value / peak - 1 : 0;
    maxDrawdown = Math.min(maxDrawdown, drawdown);
  });
  return maxDrawdown;
}

function getKpiPercentDecimal(detail: ApiCompositionDetail, key: string, fallback?: number | null): number | null {
  const numeric = findKpiNumber(detail, key);
  const value = numeric ?? fallback;
  return typeof value === 'number' && Number.isFinite(value) ? normalizePercentLike(value) : null;
}

function getKpiNumberValue(detail: ApiCompositionDetail, key: string): number | null {
  const value = findKpiNumber(detail, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatSignedPercentDelta(value: number | null): string {
  return value === null ? '暂无' : formatPercentCardValue(value, { signed: true });
}

function formatSignedRatioDelta(value: number | null): string {
  if (value === null) {
    return '暂无';
  }
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(2)}`;
}

function getBenchmarkPercentTrend(
  key: string,
  strategy: number | null,
  benchmark: number | null,
): { trendText: string; trendTone: 'better' | 'worse' | 'neutral' } {
  if (strategy === null || benchmark === null) {
    return { trendText: '较基准 暂无', trendTone: 'neutral' };
  }
  return {
    trendText: `较基准 ${formatSignedPercentDelta(strategy - benchmark)}`,
    trendTone: resolveBenchmarkTrendTone(key, strategy, benchmark),
  };
}

function getBenchmarkRatioTrend(
  key: string,
  strategy: number | null,
  benchmark: number | null,
): { trendText: string; trendTone: 'better' | 'worse' | 'neutral' } {
  if (strategy === null || benchmark === null) {
    return { trendText: '较基准 暂无', trendTone: 'neutral' };
  }
  return {
    trendText: `较基准 ${formatSignedRatioDelta(strategy - benchmark)}`,
    trendTone: resolveBenchmarkTrendTone(key, strategy, benchmark),
  };
}

function resolveBenchmarkTrendTone(
  key: string,
  strategy: number | null,
  benchmark: number | null,
): 'better' | 'worse' | 'neutral' {
  if (strategy === null || benchmark === null) {
    return 'neutral';
  }
  if (key === 'volatility' || key === 'max_drawdown') {
    return Math.abs(strategy) <= Math.abs(benchmark) ? 'better' : 'worse';
  }
  return strategy >= benchmark ? 'better' : 'worse';
}

function getCompareGridClassName(count: number): string {
  if (count <= 1) {
    return 'composition-detail-kpi-card__compare composition-detail-kpi-card__compare--single';
  }
  if (count === 2) {
    return 'composition-detail-kpi-card__compare composition-detail-kpi-card__compare--double';
  }
  return 'composition-detail-kpi-card__compare composition-detail-kpi-card__compare--triple';
}

function getCashWeightPct(detail: ApiCompositionDetail): number {
  return detail.normalized_legs
    .filter((leg) => String(leg.leg_kind ?? '').toLowerCase() === 'cash')
    .reduce((total, leg) => total + (Number.isFinite(leg.weight_pct) ? leg.weight_pct : 0), 0);
}

function averageReturnPointPct(detail: ApiCompositionDetail, key: keyof ApiCompositionDetail['returns_preview'][number]): number | null {
  const values = detail.returns_preview
    .map((point) => point[key])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!values.length) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function annualizedPctPointDrag(detail: ApiCompositionDetail, key: keyof ApiCompositionDetail['returns_preview'][number]): number | null {
  const monthlyPct = averageReturnPointPct(detail, key);
  return monthlyPct === null ? null : (monthlyPct * 12) / 100;
}

function getAnnualizedCostBreakdown(detail: ApiCompositionDetail): AnnualizedCostBreakdown {
  const maintenance =
    annualizedPctPointDrag(detail, 'maintenance_cost_drag_pct')
    ?? detail.maintenance_cost_summary.expense_ratio_bps / 10000;
  const slippage =
    annualizedPctPointDrag(detail, 'slippage_drag_pct')
    ?? detail.maintenance_cost_summary.trade_cost_bps / 10000;
  const rebalance =
    annualizedPctPointDrag(detail, 'rebalance_cost_drag_pct')
    ?? detail.maintenance_cost_summary.turnover_budget_bps / 10000;
  const cashBuffer =
    annualizedPctPointDrag(detail, 'cash_buffer_drag_pct')
    ?? normalizePercentLike(getCashWeightPct(detail)) * 0.02;
  const total = annualizedPctPointDrag(detail, 'total_cost_drag_pct') ?? maintenance + slippage + rebalance + cashBuffer;
  return { maintenance, slippage, cashBuffer, rebalance, total };
}

function getEstimatedNetAnnualized(
  detail: ApiCompositionDetail,
  grossAnnualized: number | null,
  returnYears: number,
): { value: number | null; totalLoss: number; grossAnnualized: number | null } {
  const costBreakdown = getAnnualizedCostBreakdown(detail);
  const latestNetReturn = detail.returns_preview[detail.returns_preview.length - 1]?.cumulative_net_return_pct;
  const netFromSeries =
    typeof latestNetReturn === 'number' && Number.isFinite(latestNetReturn)
      ? annualizeCumulativePercent(latestNetReturn, returnYears)
      : null;
  const value = grossAnnualized !== null ? grossAnnualized - costBreakdown.total : netFromSeries;
  return { value, totalLoss: costBreakdown.total, grossAnnualized };
}

function getDateTimeForReturnPoint(detail: ApiCompositionDetail, index: number): number | null {
  const rawDate = detail.returns_preview[index]?.date;
  if (!rawDate) {
    return null;
  }
  const timestamp = new Date(rawDate).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getApproximateRecoveryDays(detail: ApiCompositionDetail, fromIndex: number, toIndex: number): number {
  const fromTime = getDateTimeForReturnPoint(detail, fromIndex);
  const toTime = getDateTimeForReturnPoint(detail, toIndex);
  if (fromTime !== null && toTime !== null && toTime >= fromTime) {
    return Math.max(0, Math.round((toTime - fromTime) / (1000 * 60 * 60 * 24)));
  }
  return Math.max(0, Math.round((toIndex - fromIndex) * 30));
}

function getMaxDrawdownRecoveryDays(detail: ApiCompositionDetail): number | null {
  const values = detail.returns_preview.map((point) => point.cumulative_return_pct);
  if (values.length < 2) {
    return null;
  }
  let peak = values[0];
  let peakIndex = 0;
  let troughIndex = 0;
  let troughPeakIndex = 0;
  let maxDrawdown = 0;
  values.forEach((value, index) => {
    if (value > peak) {
      peak = value;
      peakIndex = index;
    }
    const drawdown = value - peak;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
      troughIndex = index;
      troughPeakIndex = peakIndex;
    }
  });
  if (maxDrawdown >= 0) {
    return 0;
  }
  const recoveryThreshold = values[troughPeakIndex];
  const recoveryIndex = values.findIndex((value, index) => index > troughIndex && value >= recoveryThreshold);
  return getApproximateRecoveryDays(detail, troughIndex, recoveryIndex >= 0 ? recoveryIndex : values.length - 1);
}

function getPortfolioVolatilityPct(detail: ApiCompositionDetail): number | null {
  const explicit = findKpiNumber(detail, 'volatility');
  if (explicit !== null) {
    return explicit;
  }
  const totalWeight = detail.risk_contribution_preview.reduce((total, item) => total + item.weight_pct, 0);
  if (totalWeight <= 0) {
    return null;
  }
  return detail.risk_contribution_preview.reduce(
    (total, item) => total + item.volatility_pct * (item.weight_pct / totalWeight),
    0,
  );
}

function formatRatioCardValue(detail: ApiCompositionDetail, key: string): string {
  const text = findKpiText(detail, key);
  if (text) {
    return text;
  }
  const numeric = findKpiNumber(detail, key);
  return numeric === null ? '暂无' : numeric.toFixed(2);
}

function formatKpiPercentCardValue(
  detail: ApiCompositionDetail,
  key: string,
  fallback?: number | null,
  options?: { signed?: boolean; forceNegative?: boolean },
): string {
  const text = findKpiText(detail, key);
  if (text) {
    return text;
  }
  const numeric = findKpiNumber(detail, key);
  return formatPercentCardValue(numeric ?? fallback, options);
}

function getKpiDetailText(detail: ApiCompositionDetail, key: string, fallback: string): string {
  const source = findKpi(detail, key)?.detail;
  const text = typeof source === 'string' ? getDisplayText(source, '') : '';
  return /[\u3400-\u9fff]/.test(text) ? text : fallback;
}

function findFirstKpiText(detail: ApiCompositionDetail, keys: string[]): string | null {
  for (const key of keys) {
    const text = findKpiText(detail, key);
    if (text) {
      return text;
    }
  }
  return null;
}

function findFirstKpiNumber(detail: ApiCompositionDetail, keys: string[]): number | null {
  for (const key of keys) {
    const value = findKpiNumber(detail, key);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function formatRatioValue(value: number | null): string {
  return value === null ? '待补' : value.toFixed(2);
}

function getLargestRiskDeviation(detail: ApiCompositionDetail): {
  value: number | null;
  label: string;
  tone: 'better' | 'worse' | 'neutral';
} {
  const rows = detail.risk_contribution_preview
    .map((item) => ({
      value: item.contribution_pct - item.weight_pct,
      label: item.label,
    }))
    .filter((item) => Number.isFinite(item.value));
  if (!rows.length) {
    return { value: null, label: '风险预算待补', tone: 'neutral' };
  }
  const largest = rows.reduce((current, item) =>
    Math.abs(item.value) > Math.abs(current.value) ? item : current,
  );
  return {
    value: largest.value,
    label: `${getDisplayText(largest.label)} ${largest.value >= 0 ? '高于权重' : '低于权重'}`,
    tone: Math.abs(largest.value) >= 8 ? 'worse' : 'better',
  };
}

function getMaxStressCorrelation(detail: ApiCompositionDetail): number | null {
  const values = detail.correlation_matrix
    .filter((cell) => cell.x_key !== cell.y_key)
    .map((cell) => getStressCorrelation(cell.correlation))
    .filter((value) => Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}

function getMaxCurrentCorrelation(detail: ApiCompositionDetail): number | null {
  const values = detail.correlation_matrix
    .filter((cell) => cell.x_key !== cell.y_key)
    .map((cell) => cell.correlation)
    .filter((value) => Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}

function correlationRiskText(value: number | null): string {
  if (value === null) {
    return '压力窗待补';
  }
  if (value >= 0.7) {
    return '压力上升';
  }
  return '压力可控';
}

function getReturnQualityDetail(detail: ApiCompositionDetail): string {
  const quality = detail.return_quality_summary;
  if (!quality) {
    return '收益质量等待运行态补齐。';
  }
  if (quality.fallback_used) {
    return `存在代理覆盖或临时补值，状态标签会说明是否需要处理。`;
  }
  return `对齐 ${quality.aligned_points} 点。`;
}

function getDiagnosisChipClassName(detail: ApiCompositionDetail): string {
  const tone = diagnosisTone(primaryCompositionDiagnosis(detail));
  if (tone === 'danger') {
    return 'status-chip status-chip--danger';
  }
  if (tone === 'warning') {
    return 'status-chip status-chip--warning';
  }
  if (tone === 'good') {
    return 'status-chip status-chip--success';
  }
  return 'status-chip status-chip--soft';
}

function buildDetailKpiCards(detail: ApiCompositionDetail): DetailKpiCard[] {
  const returnYears = getReturnWindowYears(detail);
  const benchmarkReturns = getBenchmarkMonthlyReturns(detail);
  const portfolioTotalReturn = getLatestCumulativeReturn(detail);
  const benchmarkTotalReturn = getLatestBenchmarkCumulativeReturn(detail);
  const totalExcessReturn =
    portfolioTotalReturn !== null && benchmarkTotalReturn !== null
      ? portfolioTotalReturn - benchmarkTotalReturn
      : getLatestSpreadPct(detail);
  const portfolioAnnualized = getKpiPercentDecimal(
    detail,
    'annualized_return',
    annualizeCumulativePercent(portfolioTotalReturn, returnYears),
  );
  const benchmarkAnnualized = annualizeCumulativePercent(benchmarkTotalReturn, returnYears);
  const benchmarkVolatility = calculateAnnualizedVolatility(benchmarkReturns);
  const benchmarkDrawdown = calculateBenchmarkDrawdown(detail);
  const netAnnualized = getEstimatedNetAnnualized(detail, portfolioAnnualized, returnYears);
  const recoveryDays = getMaxDrawdownRecoveryDays(detail);
  const portfolioVolatility = getKpiPercentDecimal(detail, 'volatility', getPortfolioVolatilityPct(detail));
  const portfolioDrawdownRaw = getKpiPercentDecimal(detail, 'max_drawdown');
  const portfolioDrawdown = portfolioDrawdownRaw === null ? null : -Math.abs(portfolioDrawdownRaw);
  const portfolioSharpe = getKpiNumberValue(detail, 'sharpe');
  const portfolioSortino = getKpiNumberValue(detail, 'sortino');
  const drawdownTrend = getBenchmarkPercentTrend('max_drawdown', portfolioDrawdown, benchmarkDrawdown);
  const betaNumber = findFirstKpiNumber(detail, ['beta_exposure', 'beta', 'portfolio_beta']);
  const betaText = findFirstKpiText(detail, ['beta_exposure', 'beta', 'portfolio_beta']);
  const riskDeviation = getLargestRiskDeviation(detail);
  const stressCorrelation = getMaxStressCorrelation(detail);
  const currentCorrelation = getMaxCurrentCorrelation(detail);
  const quality = detail.return_quality_summary;
  const netCumulativeReturn = detail.returns_preview[detail.returns_preview.length - 1]?.cumulative_net_return_pct;
  const netReturnValue =
    typeof netCumulativeReturn === 'number' && Number.isFinite(netCumulativeReturn)
      ? netCumulativeReturn
      : netAnnualized.value;
  const alphaContributor = [...detail.risk_contribution_preview].sort(
    (left, right) => (right.return_contribution_pct ?? 0) - (left.return_contribution_pct ?? 0),
  )[0];

  return [
    {
      key: 'alpha_contribution',
      label: 'α贡献',
      value: totalExcessReturn === null ? '待补' : formatPercentCardValue(totalExcessReturn, { signed: true }),
      detail: alphaContributor ? `${getDisplayText(alphaContributor.label)} 贡献 ${formatFixedPercent(alphaContributor.return_contribution_pct ?? 0)}` : '等待归因样本补齐。',
      trendText: totalExcessReturn === null ? '基准待补' : `相对基准 ${formatSignedPercentDelta(totalExcessReturn)}`,
      trendTone: resolveBenchmarkTrendTone(
        'total_return',
        portfolioTotalReturn === null ? null : normalizePercentLike(portfolioTotalReturn),
        benchmarkTotalReturn === null ? null : normalizePercentLike(benchmarkTotalReturn),
      ),
      compareItems: [
        { label: '组合', value: formatPercentCardValue(portfolioTotalReturn, { signed: true }) },
        { label: '基准', value: formatPercentCardValue(benchmarkTotalReturn, { signed: true }) },
      ],
      tone: 'positive',
      accent: true,
    },
    {
      key: 'beta_exposure',
      label: 'β暴露',
      value: betaText ?? formatRatioValue(betaNumber),
      detail: betaNumber === null && !betaText ? '等待运行态β指标。' : '相对基准的方向性暴露。',
      trendText: benchmarkVolatility === null || portfolioVolatility === null ? '波动待补' : `波动比 ${formatRatioValue(portfolioVolatility / benchmarkVolatility)}`,
      trendTone: betaNumber !== null && betaNumber <= 0.85 ? 'better' : 'neutral',
      compareItems: [
        { label: '组合波动', value: formatPercentCardValue(portfolioVolatility) },
        { label: '基准波动', value: formatPercentCardValue(benchmarkVolatility) },
      ],
      tone: 'blue',
    },
    {
      key: 'risk_contribution_deviation',
      label: '风险贡献偏离',
      value: riskDeviation.value === null ? '待补' : formatPercentCardValue(riskDeviation.value, { signed: true }),
      detail: riskDeviation.label,
      trendText: '按腿权重校验',
      trendTone: riskDeviation.tone,
      compareItems: [
        { label: '最大风险腿', value: riskDeviation.label },
      ],
      tone: riskDeviation.tone === 'worse' ? 'warning' : 'positive',
    },
    {
      key: 'correlation_stress',
      label: '相关性压力',
      value: stressCorrelation === null ? '待补' : stressCorrelation.toFixed(2),
      detail: stressCorrelation !== null && stressCorrelation >= 0.7 ? '压力窗同涨同跌上升。' : '压力相关性仍可控。',
      trendText: correlationRiskText(stressCorrelation),
      trendTone: stressCorrelation !== null && stressCorrelation >= 0.7 ? 'worse' : 'better',
      compareItems: [
        { label: '常态最高', value: formatRatioValue(currentCorrelation) },
      ],
      tone: stressCorrelation !== null && stressCorrelation >= 0.7 ? 'warning' : 'blue',
    },
    {
      key: 'net_return',
      label: '净收益',
      value: formatPercentCardValue(netReturnValue, { signed: true }),
      detail: '扣除成本与现金拖累。',
      tooltip: '净收益优先读取累计净收益；缺失时回退为预估净年化。',
      trendText: benchmarkAnnualized === null ? '基准待补' : `年化 ${formatPercentCardValue(portfolioAnnualized)}`,
      trendTone: netReturnValue !== null && netReturnValue >= 0 ? 'better' : 'worse',
      compareItems: [
        { label: '总损耗', value: formatPercentCardValue(netAnnualized.totalLoss) },
        { label: '毛年化', value: formatPercentCardValue(netAnnualized.grossAnnualized) },
      ],
      tone: netReturnValue !== null && netReturnValue >= 0 ? 'positive' : 'warning',
    },
    {
      key: 'max_drawdown',
      label: '最大回撤',
      value: formatKpiPercentCardValue(detail, 'max_drawdown', null, { forceNegative: true }),
      detail: getKpiDetailText(detail, 'max_drawdown', '低于基准回撤即为防守有效。'),
      trendText: drawdownTrend.trendText,
      trendTone: drawdownTrend.trendTone,
      compareItems: [
        { label: '基准', value: formatPercentCardValue(benchmarkDrawdown) },
        { label: '恢复时长', value: recoveryDays === null ? '待补' : `${recoveryDays} 天` },
      ],
      tone: findKpi(detail, 'max_drawdown')?.tone ?? 'warning',
    },
    {
      key: 'return_quality',
      label: '收益质量',
      value: quality ? `${Math.round(quality.coverage_pct)}%` : '待补',
      detail: getReturnQualityDetail(detail),
      tooltip: '收益质量来自组合收益、基准与腿收益流的对齐覆盖率；如使用代理或补值，以状态标签判定是否需要处理。',
      trendText: quality?.fallback_used ? '状态标签判定' : '收益对齐',
      trendTone: quality?.fallback_used ? 'worse' : 'better',
      compareItems: [
        { label: '夏普', value: portfolioSharpe === null ? '待补' : portfolioSharpe.toFixed(2) },
        { label: '索提诺', value: portfolioSortino === null ? '待补' : portfolioSortino.toFixed(2) },
      ],
      tone: quality?.fallback_used ? 'warning' : 'positive',
    },
  ];
}

function getPoint(index: number, total: number, value: number, min: number, max: number, width: number, height: number, padding = 18): { x: number; y: number } {
  const range = max - min || 1;
  const x = padding + (index / Math.max(total - 1, 1)) * (width - padding * 2);
  const y = height - padding - ((value - min) / range) * (height - padding * 2);
  return { x, y };
}

function buildLinePath(values: number[], width: number, height: number, min?: number, max?: number): string {
  if (!values.length) {
    return '';
  }
  const domainMin = min ?? Math.min(...values);
  const domainMax = max ?? Math.max(...values);
  return values
    .map((value, index) => {
      const point = getPoint(index, values.length, value, domainMin, domainMax, width, height);
      return `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    })
    .join(' ');
}

function buildAreaPath(values: number[], width: number, height: number, baselineValue: number, min: number, max: number): string {
  if (!values.length) {
    return '';
  }
  const line = buildLinePath(values, width, height, min, max);
  const start = getPoint(0, values.length, baselineValue, min, max, width, height);
  const end = getPoint(values.length - 1, values.length, baselineValue, min, max, width, height);
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} ${line.slice(1)} L ${end.x.toFixed(2)} ${end.y.toFixed(2)} Z`;
}

function buildDrawdownBandArea(values: number[], width: number, height: number, zeroAxisY: number): string {
  if (!values.length) {
    return '';
  }
  const padding = 18;
  const baselineY = Math.min(height - 40, Math.max(56, zeroAxisY));
  const bandHeight = Math.max(18, height - padding - baselineY);
  const maxDepth = Math.max(...values.map((value) => Math.abs(Math.min(value, 0))), 0.01);
  const points = values.map((value, index) => {
    const x = padding + (index / Math.max(values.length - 1, 1)) * (width - padding * 2);
    const depth = Math.abs(Math.min(value, 0)) / maxDepth;
    const y = baselineY + depth * bandHeight;
    return { x, y };
  });
  const first = points[0];
  const last = points[points.length - 1];
  return [
    `M ${first.x.toFixed(2)} ${baselineY.toFixed(2)}`,
    ...points.map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`),
    `L ${last.x.toFixed(2)} ${baselineY.toFixed(2)}`,
    'Z',
  ].join(' ');
}

function getRebalanceChartMarkers(detail: ApiCompositionDetail): Array<{ index: number; label: string; key: string }> {
  const rawMarkers = [
    ...detail.rebalance_markers.map((marker) => ({
      index: marker.index,
      label: marker.label,
      date: marker.date,
      key: `marker-${marker.label}-${marker.index}`,
    })),
    ...(detail.rebalance_events ?? []).map((event) => ({
      index: event.index,
      label: event.label,
      date: event.date,
      key: `event-${event.label}-${event.index}`,
    })),
  ];
  const used = new Set<number>();
  return rawMarkers
    .map((marker) => {
      let index = Number.isInteger(marker.index) ? marker.index : -1;
      if ((index < 0 || index >= detail.returns_preview.length) && marker.date) {
        index = detail.returns_preview.findIndex((point) => point.date === marker.date);
      }
      return { ...marker, index };
    })
    .filter((marker) => marker.index >= 0 && marker.index < detail.returns_preview.length)
    .filter((marker) => {
      if (used.has(marker.index)) {
        return false;
      }
      used.add(marker.index);
      return true;
    })
    .map((marker) => ({
      index: marker.index,
      label: marker.label || '再平衡点',
      key: marker.key,
    }));
}

function getCostDragSeries(detail: ApiCompositionDetail): number[] {
  let cumulativeDrag = 0;
  return detail.returns_preview.map((point) => {
    if (typeof point.cumulative_net_return_pct === 'number' && Number.isFinite(point.cumulative_net_return_pct)) {
      return point.cumulative_net_return_pct;
    }
    const drag = typeof point.total_cost_drag_pct === 'number' && Number.isFinite(point.total_cost_drag_pct)
      ? point.total_cost_drag_pct
      : 0;
    cumulativeDrag += Math.max(0, drag);
    return point.cumulative_return_pct - cumulativeDrag;
  });
}

function formatShortDate(value?: string | null): string {
  const text = getDisplayText(value, '');
  if (!text) {
    return '日期待补';
  }
  const date = new Date(text);
  if (Number.isFinite(date.getTime())) {
    return date.toISOString().slice(0, 10);
  }
  return text.slice(0, 10);
}

function getRecordString(source: Record<string, unknown> | undefined, keys: string[]): string | null {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function getRecordNumber(source: Record<string, unknown> | undefined, keys: string[]): number | null {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value.replace(/[^\d.-]/g, ''));
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function looksLikeRunId(value?: string | null): boolean {
  const text = getDisplayText(value, '');
  return /(?:^|[_:-])(run|bt|backtest)[_:-]?/i.test(text) || /^(run|bt|backtest)[-_]/i.test(text);
}

function extractRunId(value?: string | null): string | null {
  const text = getDisplayText(value, '');
  if (!text) {
    return null;
  }
  const match = text.match(/\b(?:run|bt|backtest)[_-][A-Za-z0-9][A-Za-z0-9_-]*/i);
  if (match) {
    return match[0];
  }
  return looksLikeRunId(text) ? text : null;
}

function getBacktestRunIdFromRecord(source: Record<string, unknown> | undefined): string | null {
  return (
    getRecordString(source, ['composition_run_id', 'backtest_run_id', 'source_run_id', 'latest_run_id', 'run_id'])
    ?? extractRunId(getRecordString(source, ['proof_label', 'source_label', 'evidence_label']))
  );
}

function getCompositionVersionLabel(detail: ApiCompositionDetail): string {
  const detailVersion = getRecordString(detail as unknown as Record<string, unknown>, [
    'current_composition_version_label',
    'current_version_label',
    'composition_version_label',
  ]);
  if (detailVersion) {
    return detailVersion;
  }
  const heroVersion = getRecordString(detail.hero_summary as unknown as Record<string, unknown>, [
    'current_composition_version_label',
    'current_version_label',
    'composition_version_label',
    'version_label',
  ]);
  if (heroVersion) {
    return heroVersion;
  }
  const latestVersion = (detail.audit_trail ?? [])
    .filter((item) => /^(updated|patched|structure_patch)$/i.test(item.action))
    .map((item) => {
      const itemRecord = item as unknown as Record<string, unknown>;
      return getAuditVersionNumberOrNull(item.version_after ?? itemRecord.versionAfter);
    })
    .filter((value): value is number => value !== null)
    .reduce((maxVersion, value) => Math.max(maxVersion, value), 1);
  return `当前配置版本 v${latestVersion}`;
}

function getCurrentRulingLabel(detail: ApiCompositionDetail, driftCount: number): string {
  const verdict = getDisplayText(detail.composition_score.verdict, '');
  const normalized = verdict.toLowerCase();
  if (driftCount > 0) {
    return '保持并观察';
  }
  if (/(strong|good|stable|良好|稳定|通过|可继续)/i.test(normalized)) {
    return '可继续持有';
  }
  if (/(watch|warning|复核|观察|漂移)/i.test(normalized)) {
    return '保持并观察';
  }
  if (/(blocked|failed|risk|阻断|失败|风险)/i.test(normalized)) {
    return '暂停并复核';
  }
  return verdict || '等待裁决';
}

function getExecutionHistoryRows(detail: ApiCompositionDetail): ExecutionHistoryRow[] {
  const rows: ExecutionHistoryRow[] = [];
  const annualizedLabel =
    findFirstKpiText(detail, ['annualized_return', 'net_annualized_return'])
    ?? formatPercentCardValue(annualizeCumulativePercent(getLatestCumulativeReturn(detail), getReturnWindowYears(detail)));
  const sharpeLabel = formatRatioCardValue(detail, 'sharpe');
  const fallbackPeriod = `${Math.max(1, Math.round(getReturnWindowYears(detail)))}Y`;
  detail.source_evidence.forEach((evidence) => {
    const runId =
      getBacktestRunIdFromRecord(evidence.snapshot)
      ?? (looksLikeRunId(evidence.freeze_ref_id) ? evidence.freeze_ref_id : null)
      ?? extractRunId(getRecordString(evidence.snapshot, ['proof_label']));
    if (!runId || rows.some((row) => row.runId === runId)) {
      return;
    }
    const periodYears = getRecordNumber(evidence.snapshot, ['period_years', 'window_years', 'backtest_years']);
    rows.push({
      key: `${evidence.id}-${runId}`,
      runId,
      dateLabel: formatShortDate(evidence.captured_at),
      versionLabel:
        getRecordString(evidence.snapshot, ['composition_version_label', 'composition_version', 'version_label'])
        ?? getCompositionVersionLabel(detail),
      periodLabel: periodYears ? `${periodYears}Y` : fallbackPeriod,
      annualizedLabel,
      sharpeLabel,
    });
  });
  detail.normalized_legs.forEach((leg) => {
    const snapshot = leg.config as Record<string, unknown> | undefined;
    const runId =
      getBacktestRunIdFromRecord(snapshot)
      ?? extractRunId(leg.proof_label);
    if (!runId || rows.some((row) => row.runId === runId)) {
      return;
    }
    rows.push({
      key: `${leg.id}-${runId}`,
      runId,
      dateLabel: formatShortDate(detail.updated_at),
      versionLabel: leg.version_label ?? getCompositionVersionLabel(detail),
      periodLabel: fallbackPeriod,
      annualizedLabel,
      sharpeLabel,
    });
  });
  return rows.slice(0, 3);
}

function getCompositionRunHashPath(compositionId: string, runId: string, tab?: 'orders'): string {
  const base = `/compositions/${encodeURIComponent(compositionId)}/backtest-runs/${encodeURIComponent(runId)}`;
  return tab ? `#${base}?tab=${tab}` : `#${base}`;
}

function getPrimaryBacktestRunId(detail: ApiCompositionDetail, executionHistoryRows: ExecutionHistoryRow[]): string | null {
  const strategyLegRuns = detail.normalized_legs
    .filter((leg) => String(leg.leg_kind ?? '').toLowerCase() === 'strategy')
    .map((leg) => ({
      ordering: Number.isFinite(Number(leg.ordering)) ? Number(leg.ordering) : 0,
      runId: getBacktestRunIdFromRecord(leg.config as Record<string, unknown> | undefined),
      weightPct: Number.isFinite(Number(leg.weight_pct)) ? Number(leg.weight_pct) : 0,
    }))
    .filter((item): item is { ordering: number; runId: string; weightPct: number } => Boolean(item.runId))
    .sort((left, right) => right.weightPct - left.weightPct || left.ordering - right.ordering);

  return strategyLegRuns[0]?.runId ?? executionHistoryRows[0]?.runId ?? null;
}

function getCompositionRevisionNumber(detail: ApiCompositionDetail): number {
  const revisionCandidates = detail.source_evidence
    .flatMap((item) => [
      getRecordNumber(item.snapshot, ['revision', 'composition_revision', 'version_revision']),
      getRecordNumber(item.snapshot, ['freeze_generation']),
    ])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return Math.max(1, Math.round(Math.max(...revisionCandidates, 1)));
}

function getWeightChangeSummary(detail: ApiCompositionDetail): string {
  return detail.normalized_legs
    .slice()
    .sort((left, right) => right.weight_pct - left.weight_pct || left.ordering - right.ordering)
    .map((leg) => `${formatLegDisplayName(leg)} ${formatCompactPercent(leg.weight_pct, 0)}`)
    .join(' / ');
}

function getVersionChangeSummary(
  detail: ApiCompositionDetail,
  item?: NonNullable<ApiCompositionDetail['audit_trail']>[number],
): string {
  const explicitSummary = cleanDisplayText(item?.change_summary);
  const reason = cleanDisplayText(item?.reason);
  if (explicitSummary || reason) {
    return [
      explicitSummary ? `参数变化：${explicitSummary}` : null,
      reason ? `升级理由：${reason}` : null,
    ].filter(Boolean).join('；');
  }
  const action = String(item?.action ?? '').toLowerCase();
  const weightSummary = getWeightChangeSummary(detail);
  const rebalanceLabel = getCadenceLabel(detail.rebalance_frequency);
  const costLabel = `${detail.maintenance_cost_summary.total_estimated_bps.toFixed(0)} bps`;
  if (action === 'created') {
    return `初始配置：${weightSummary}；再平衡频次：${rebalanceLabel}；成本规则：${costLabel}`;
  }
  if (/^(updated|patched|structure_patch)$/i.test(action)) {
    return `权重变化：${weightSummary}；再平衡频次：${rebalanceLabel}；成本规则：${costLabel}`;
  }
  return `配置复核：${weightSummary}；再平衡频次：${rebalanceLabel}；维护成本：${costLabel}`;
}

function getAuditVersionNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.round(value));
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(1, Math.round(parsed));
    }
  }
  return fallback;
}

function getAuditVersionNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.round(value));
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(1, Math.round(parsed)) : null;
  }
  return null;
}

function getVersionEvolutionRows(detail: ApiCompositionDetail): VersionEvolutionRow[] {
  const versionEvents = (detail.audit_trail ?? [])
    .filter((item) => /^(updated|patched|structure_patch)$/i.test(item.action))
    .map((item) => {
      const itemRecord = item as unknown as Record<string, unknown>;
      const toVersion = getAuditVersionNumberOrNull(item.version_after ?? itemRecord.versionAfter);
      const fromVersion = getAuditVersionNumberOrNull(item.version_before ?? itemRecord.versionBefore);
      return toVersion !== null && fromVersion !== null ? { fromVersion, item, toVersion } : null;
    })
    .filter((item): item is {
      fromVersion: number;
      item: NonNullable<ApiCompositionDetail['audit_trail']>[number];
      toVersion: number;
    } => item !== null)
    .sort((left, right) => new Date(left.item.at).getTime() - new Date(right.item.at).getTime())
    .slice(-4);

  if (versionEvents.length) {
    return versionEvents
      .map(({ fromVersion, item, toVersion }) => {
        return {
          key: item.id,
          title: `v${fromVersion} -> v${toVersion}`,
          detail: getVersionChangeSummary(detail, item),
          meta: `变更后 v${toVersion} · ${formatShortDate(item.at)}`,
          versionAfter: toVersion,
        };
      })
      .sort((left, right) => right.versionAfter - left.versionAfter);
  }

  const capturedAt = detail.source_evidence[0]?.captured_at ?? detail.updated_at;
  const currentVersionNumber = getAuditVersionNumberOrNull(
    getRecordObject(detail).current_composition_version_number,
  );
  const currentVersionLabel = getCompositionVersionLabel(detail);
  if (currentVersionNumber !== null && currentVersionNumber > 1) {
    return [
      {
        key: `${detail.id}-current-version`,
        title: currentVersionLabel,
        detail: '当前保存配置已生成版本记录；配置变化仍按保存时的权重、频次与成本口径复核。',
        meta: `变更后 v${currentVersionNumber} · ${formatShortDate(capturedAt)}`,
        versionAfter: currentVersionNumber,
      },
    ];
  }
  return [
    {
      key: `${detail.id}-current-version`,
      title: '当前配置版本 v1',
      detail: '暂无新的参数变化记录；只有保存时配置发生变化并填写升级理由，才会写入版本记录。',
      meta: `变更后 v1 · ${formatShortDate(capturedAt)}`,
      versionAfter: 1,
    },
  ];
}

function getRecordObject(source: unknown): Record<string, unknown> {
  return source && typeof source === 'object' && !Array.isArray(source) ? (source as Record<string, unknown>) : {};
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function getReferenceCountFromSummary(value?: string | null): number {
  const text = cleanDisplayText(value) ?? '';
  if (/not used|尚未/i.test(text)) {
    return 0;
  }
  const match = text.match(/(\d+)/);
  return match ? Number(match[1]) : 1;
}

function getSourceIntegrityForLeg(
  detail: ApiCompositionDetail,
  leg: ApiCompositionPreviewLeg,
  evidence?: ApiCompositionSourceFreeze | null,
): ApiCompositionSourceIntegrity {
  const config = getRecordObject(leg.config);
  const configIntegrity = getRecordObject(config.source_integrity);
  const topLevel = detail.source_integrity?.find((item) => item.leg_id === leg.id);
  return {
    leg_id: leg.id,
    display_name:
      topLevel?.display_name
      ?? getRecordString(configIntegrity, ['display_name'])
      ?? getDisplayText(leg.display_name),
    source_ref_id:
      topLevel?.source_ref_id
      ?? getRecordString(configIntegrity, ['source_ref_id'])
      ?? evidence?.freeze_ref_id
      ?? leg.source_ref_id,
    freeze_hash:
      topLevel?.freeze_hash
      ?? getRecordString(configIntegrity, ['freeze_hash'])
      ?? evidence?.freeze_hash
      ?? null,
    signature_status:
      topLevel?.signature_status
      ?? getRecordString(configIntegrity, ['signature_status'])
      ?? evidence?.signature_status
      ?? 'verified',
    drift_status:
      topLevel?.drift_status
      ?? getRecordString(configIntegrity, ['drift_status'])
      ?? evidence?.drift_status
      ?? 'current',
    current_ref_id:
      topLevel?.current_ref_id
      ?? getRecordString(configIntegrity, ['current_ref_id'])
      ?? evidence?.current_ref_id
      ?? leg.source_ref_id,
    checked_at:
      topLevel?.checked_at
      ?? getRecordString(configIntegrity, ['checked_at'])
      ?? evidence?.captured_at
      ?? null,
    alerts:
      topLevel?.alerts?.length
        ? topLevel.alerts
        : getStringArray(configIntegrity.alerts).length
          ? getStringArray(configIntegrity.alerts)
          : evidence?.alerts ?? [],
  };
}

function buildLegInventoryRowFromComposition(
  detail: ApiCompositionDetail,
  leg: ApiCompositionPreviewLeg,
): ApiLegInventoryRow {
  const config = getRecordObject(leg.config);
  const summary = getRecordObject(config.summary);
  const metrics = getRecordObject(config.metrics);
  const evidence = detail.source_evidence.find((item) => item.leg_id === leg.id) ?? null;
  const evidenceSnapshot = getRecordObject(evidence?.snapshot);
  const risk = detail.risk_contribution_preview.find((item) => item.leg_id === leg.id);
  const sourceIntegrity = getSourceIntegrityForLeg(detail, leg, evidence);
  const assetKind =
    getRecordString(config, ['asset_kind'])
    ?? (leg.attribute_tags.some((tag) => /bond|fixed/i.test(tag)) ? 'bond_fixed_income' : leg.leg_kind);
  const drawerConfig = {
    ...config,
    asset_kind: assetKind,
    source_snapshot_id:
      getRecordString(config, ['source_snapshot_id', 'snapshot_ref'])
      ?? getRecordString(evidenceSnapshot, ['source_snapshot_id', 'snapshot_ref', 'id'])
      ?? undefined,
    source_integrity: sourceIntegrity,
    metrics: {
      ...metrics,
      annualized_return:
        getRecordNumber(metrics, ['annualized_return', 'cagr', 'annualized_return_pct'])
        ?? getRecordNumber(config, ['annualized_return', 'cagr', 'annualized_return_pct']),
      max_drawdown:
        getRecordNumber(metrics, ['max_drawdown', 'max_drawdown_pct'])
        ?? getRecordNumber(config, ['max_drawdown', 'max_drawdown_pct']),
      sharpe:
        getRecordNumber(metrics, ['sharpe', 'oos_sharpe', 'out_of_sample_sharpe'])
        ?? getRecordNumber(config, ['sharpe', 'oos_sharpe', 'out_of_sample_sharpe']),
      volatility_pct: risk?.volatility_pct,
      annualized_volatility_pct: risk?.volatility_pct,
      weight_pct: leg.weight_pct,
    },
    summary: {
      ...summary,
      ...evidenceSnapshot,
      notes: getNarrativeText(leg.reference_summary, '该腿随组合配置冻结，用于复核来源、权重和版本口径。'),
      weight_pct: leg.weight_pct,
      target_weight_pct: leg.weight_pct,
      rebalance_frequency: detail.rebalance_frequency,
      version_label: leg.version_label,
      updated_at: detail.updated_at,
    },
  };
  const hasNewVersion = !['current', 'verified'].includes(String(sourceIntegrity.drift_status ?? '').toLowerCase());
  return {
    id: leg.id,
    leg_type: leg.leg_kind,
    name: formatLegDisplayName(leg),
    version_label: leg.version_label,
    proof_label: leg.proof_label,
    reference_count: getReferenceCountFromSummary(leg.reference_summary),
    reference_summary: formatLegReferenceSummary(leg.reference_summary),
    status: leg.status,
    status_label: leg.status_label,
    has_new_version: hasNewVersion,
    is_orphan: false,
    attribute_tags: leg.attribute_tags,
    allowed_actions: [],
    source_ref_id: leg.source_ref_id,
    source_ref_type: leg.source_ref_type,
    source_integrity: sourceIntegrity,
    freeze_hash: sourceIntegrity.freeze_hash,
    signature_status: sourceIntegrity.signature_status,
    drift_status: sourceIntegrity.drift_status,
    current_ref_id: sourceIntegrity.current_ref_id,
    alerts: sourceIntegrity.alerts,
    config: drawerConfig,
  };
}

function isMatchingLegSelection(row: ApiLegInventoryRow, selectedLegId: string, detail: ApiCompositionDetail): boolean {
  if (row.id === selectedLegId || row.source_ref_id === selectedLegId || row.current_ref_id === selectedLegId) {
    return true;
  }
  const evidence = detail.source_evidence.find((item) => (
    item.leg_id === selectedLegId
    || item.freeze_ref_id === selectedLegId
    || item.current_ref_id === selectedLegId
  ));
  if (!evidence) {
    return false;
  }
  return [evidence.leg_id, evidence.freeze_ref_id, evidence.current_ref_id].some(
    (value) => Boolean(value && (value === row.id || value === row.source_ref_id || value === row.current_ref_id)),
  );
}

function navigateToCompositionLegSource(row: ApiLegInventoryRow): void {
  const config = getRecordObject(row.config);
  const snapshotId = getRecordString(config, ['source_snapshot_id', 'snapshot_ref', 'id']);
  if (!snapshotId) {
    return;
  }
  const tab = String(config.asset_kind ?? '').toLowerCase().includes('bond') ? 'tab=bond&' : '';
  navigateTo(`/snapshots?${tab}source_snapshot_id=${encodeURIComponent(snapshotId)}`);
}

async function ignoreCompositionLegArchive(_row?: ApiLegInventoryRow): Promise<void> {
  return undefined;
}

function ignoreCompositionLegMutation(_row?: ApiLegInventoryRow): void {
  return undefined;
}

function ignoreCompositionLegVersionCopy(_source?: ApiLegInventoryRow, _target?: ApiLegInventoryRow): void {
  return undefined;
}

function getExposureDrilldownRows(detail: ApiCompositionDetail): ExposureDrilldownRow[] {
  return detail.normalized_legs.slice(0, 4).map((leg) => {
    const kind = String(leg.leg_kind ?? '').toLowerCase();
    if (kind === 'strategy') {
      return {
        key: leg.id,
        source: formatLegDisplayName(leg),
        layer: '代理暴露',
        detail: formatLegReferenceSummary(leg.reference_summary) || '按策略回测持仓或基准映射穿透。',
        tone: 'info',
      };
    }
    if (kind === 'cash') {
      return {
        key: leg.id,
        source: formatLegDisplayName(leg),
        layer: '现金规则',
        detail: formatLegReferenceSummary(leg.reference_summary) || '现金缓冲与成本吸收规则。',
        tone: 'good',
      };
    }
    return {
      key: leg.id,
      source: formatLegDisplayName(leg),
      layer: '物理持仓',
      detail: formatLegReferenceSummary(leg.reference_summary) || '运行态资产来源已冻结。',
      tone: 'good',
    };
  });
}

function getRiskContributionsInLegOrder(detail: ApiCompositionDetail): ApiCompositionRiskContribution[] {
  const byLegId = new Map(detail.risk_contribution_preview.map((item) => [item.leg_id, item]));
  const ordered = detail.normalized_legs
    .map((leg) => byLegId.get(leg.id))
    .filter((item): item is ApiCompositionRiskContribution => Boolean(item));
  const remaining = detail.risk_contribution_preview.filter((item) => !ordered.includes(item));
  return [...ordered, ...remaining].slice(0, 4);
}

function buildMatrixKey(left: string, right: string): string {
  return [left, right].sort().join('::');
}

function getCorrelationClassName(value: number): string {
  if (value >= 0.7) {
    return 'composition-detail-matrix-cell composition-detail-matrix-cell--high';
  }
  if (value <= -0.2) {
    return 'composition-detail-matrix-cell composition-detail-matrix-cell--inverse';
  }
  if (Math.abs(value) <= 0.25) {
    return 'composition-detail-matrix-cell composition-detail-matrix-cell--low';
  }
  return 'composition-detail-matrix-cell composition-detail-matrix-cell--mid';
}

function getEvidenceKindLabel(value: string): string {
  switch (value) {
    case 'strategy_projection':
      return '策略投影冻结';
    case 'asset_snapshot':
    case 'asset_definition':
      return '资产快照冻结';
    case 'cash_definition':
      return '现金规则冻结';
    default:
      return '来源冻结';
  }
}

function getSnapshotString(evidence: ApiCompositionSourceFreeze, key: string): string | null {
  const value = evidence.snapshot?.[key];
  return typeof value === 'string' ? value : null;
}

function getEvidenceLegKind(evidence: ApiCompositionSourceFreeze): string {
  return String(getSnapshotString(evidence, 'leg_kind') ?? '').toLowerCase();
}

function getEvidenceStatusLabel(evidence: ApiCompositionSourceFreeze): string {
  const kind = getEvidenceLegKind(evidence);
  if (kind === 'asset') {
    return '可信';
  }
  if (kind === 'cash' || kind === 'strategy') {
    return '已冻结';
  }
  return '稳定';
}

function getLegTypeLabel(value?: string | null): string {
  switch (String(value ?? '').toLowerCase()) {
    case 'strategy':
      return '策略腿';
    case 'asset':
      return '资产腿';
    case 'cash':
      return '现金腿';
    default:
      return '来源腿';
  }
}

function getIntegrityStatusLabel(value?: string | null): string {
  switch (String(value ?? '').toLowerCase()) {
    case 'verified':
    case 'valid':
    case 'signed':
      return '指纹有效';
    case 'current':
      return '版本一致';
    case 'drifted':
    case 'version_drift':
      return '有新版本，待更新';
    case 'stale':
      return '有新版本，待更新';
    case 'missing':
      return '证据缺失';
    default:
      return '待确认';
  }
}

function getAuditActionLabel(value?: string | null): string {
  switch (String(value ?? '').toLowerCase()) {
    case 'created':
      return '创建组合';
    case 'updated':
    case 'patched':
    case 'structure_patch':
      return '结构调整';
    case 'status_changed':
      return '状态切换';
    case 'status':
      return '状态检查';
    case 'rebalance_check':
      return '再平衡检查';
    case 'source_freeze':
    case 'source_frozen':
      return '来源冻结';
    case 'source_drift_checked':
      return '漂移检查';
    case 'snapshot_refresh_checked':
      return '快照影响检查';
    default:
      return cleanDisplayText(value)?.replace(/_/g, ' ') ?? '审计事件';
  }
}

function getAuditActorLabel(value?: string | null): string {
  switch (String(value ?? '').toLowerCase()) {
    case 'system':
      return '系统';
    case 'operator':
      return '操作员';
    case 'user':
      return '用户';
    default:
      return cleanDisplayText(value)?.replace(/_/g, ' ') ?? '系统';
  }
}

function getAuditSummaryText(value?: string | null): string {
  const text = cleanDisplayText(value);
  if (!text) {
    return '已记录审计事件。';
  }
  const sourceFreezeMatch = text.match(/^Captured\s+(\d+)\s+source freeze signatures\.?$/i);
  if (sourceFreezeMatch) {
    return `已捕获 ${sourceFreezeMatch[1]} 个配置指纹。`;
  }
  const rebalanceMatch = text.match(/^Simulated\s+(\d+)\s+rebalance events without mutating frozen sources\.?$/i);
  if (rebalanceMatch) {
    return `已模拟 ${rebalanceMatch[1]} 次再平衡事件，未改写冻结来源。`;
  }
  if (/^Composition record created with normalized legs and cost policy\.?$/i.test(text)) {
    return '组合记录已创建，腿结构与成本规则已归一化。';
  }
  if (/^Composition structure, weights, benchmark, or cost policy was patched and revalidated\.?$/i.test(text)) {
    return '配置、权重、基准与成本规则已复核。';
  }
  if (/^Composition status is ACTIVE; drift warnings remain advisory\.?$/i.test(text)) {
    return '组合状态为运行中；漂移提示仅作提醒。';
  }
  const snapshotRefreshMatch = text.match(
    /^Checked bond snapshot refresh job\s+(.+?)\s+against frozen source signatures;\s+no saved composition source evidence was rewritten\.?$/i,
  );
  if (snapshotRefreshMatch) {
    return `已复核债券快照刷新任务 ${snapshotRefreshMatch[1]}，冻结证据未改写。`;
  }
  return text;
}

function getSourceAlertText(value?: string | null): string {
  const text = cleanDisplayText(value);
  if (!text) {
    return '冻结口径已验证。';
  }
  if (/^Current source version differs from the frozen source signature\.?$/i.test(text)) {
    return '当前版本偏离冻结指纹。';
  }
  if (/来源版本已漂移，?建议重新检查。?/i.test(text)) {
    return '当前版本偏离冻结指纹。';
  }
  return text;
}

function getEvidenceHashLabel(hash: string): string {
  const text = getDisplayText(hash, '');
  return text ? text.slice(0, 10).toUpperCase() : '----';
}

function getEvidenceVersionLabel(value?: string | null): string | null {
  const text = getDisplayText(value, '');
  if (!text) {
    return null;
  }
  if (/^target_buffer$/i.test(text)) {
    return '目标缓冲';
  }
  return text;
}

function getEvidenceReference(evidence: ApiCompositionSourceFreeze): string {
  const legKind = getEvidenceLegKind(evidence);
  const displayName = formatLegDisplayName({
    leg_kind: legKind,
    display_name: getSnapshotString(evidence, 'display_name') ?? evidence.display_name,
  });
  const version = getEvidenceVersionLabel(getSnapshotString(evidence, 'version_label'));
  const proof = getSnapshotString(evidence, 'proof_label');
  const proofLabel = formatLegProofLabel(proof, {
    leg_kind: legKind,
    display_name: getSnapshotString(evidence, 'display_name') ?? evidence.display_name,
  });
  return [displayName, version, proofLabel].filter(Boolean).join(' · ');
}

function getEvidenceCurrentLabel(
  evidence: ApiCompositionSourceFreeze,
  integrity?: ApiCompositionSourceIntegrity,
): string {
  const version = getEvidenceVersionLabel(getSnapshotString(evidence, 'version_label'));
  if (version) {
    return `当前 ${version}`;
  }
  const currentRef = integrity?.current_ref_id ?? evidence.current_ref_id ?? evidence.freeze_ref_id;
  return `引用 ${getEvidenceHashLabel(currentRef)}`;
}

function getEvidenceDetail(evidence: ApiCompositionSourceFreeze): string {
  const kind = getEvidenceLegKind(evidence);
  if (kind === 'strategy') {
    return '回测、参数版本与冻结时间可以连起来复核。';
  }
  if (kind === 'asset') {
    return '关键字段已连同快照 ID 一起冻结，避免后续重刷后口径漂移。';
  }
  if (kind === 'cash') {
    return '现金腿阈值、再平衡条件与成本吸收规则已固化。';
  }
  return '来源标识、捕获时间与哈希摘要已纳入当前组合复核。';
}

function getCadenceLabel(value?: string | null): string {
  switch (String(value || '').toLowerCase()) {
    case 'monthly':
      return '月度再平衡';
    case 'quarterly':
      return '季度再平衡';
    case 'semiannual':
      return '半年再平衡';
    case 'annual':
      return '年度再平衡';
    default:
      return '维护节奏待确认';
  }
}

function getStatusWriteActions(status: string): Array<{ label: string; nextStatus: ApiCompositionStatus }> {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'ACTIVE') {
    return [
      { label: '归档', nextStatus: 'ARCHIVED' },
      { label: '恢复草稿', nextStatus: 'DRAFT' },
    ];
  }
  if (normalized === 'ARCHIVED') {
    return [
      { label: '恢复草稿', nextStatus: 'DRAFT' },
      { label: '激活', nextStatus: 'ACTIVE' },
    ];
  }
  return [
    { label: '激活', nextStatus: 'ACTIVE' },
    { label: '归档', nextStatus: 'ARCHIVED' },
  ];
}

function getIntervalDays(value?: string | null): number {
  switch (String(value || '').toLowerCase()) {
    case 'monthly':
      return 30;
    case 'quarterly':
      return 90;
    case 'semiannual':
      return 182;
    case 'annual':
      return 365;
    default:
      return 90;
  }
}

function getDaysSince(value: string): number {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) {
    return 0;
  }
  const current = Date.now();
  return Math.max(0, Math.floor((current - then) / (1000 * 60 * 60 * 24)));
}

function getStressCorrelation(value: number): number {
  if (value >= 0) {
    return Math.min(1, value * 0.65 + 0.25);
  }
  return Number((value * 0.55).toFixed(2));
}

function getDisplayText(value?: string | null, fallback = '待确认'): string {
  return cleanDisplayText(value) ?? fallback;
}

function getNarrativeText(value?: string | null, fallback = '待确认'): string {
  const text = cleanDisplayText(value);
  if (!text) {
    return fallback;
  }
  if (/^cadence modeled as quarterly\.?$/i.test(text)) {
    return '当前按季度再平衡节奏建模。';
  }
  if (
    /^phase 1 analytics are deterministic placeholders when live composition analytics are unavailable\.?$/i.test(
      text,
    )
  ) {
    return '当实时组合分析暂不可用时，这里先展示第一阶段的确定性占位分析。';
  }
  if (
    /^scenario outputs are deterministic phase 1 approximations built from sleeve mix and cadence\.?$/i.test(
      text,
    )
  ) {
    return '情景输出当前采用第一阶段近似值，基于腿结构配比与再平衡节奏推导。';
  }
  return text;
}

function formatKpiDetail(kpi: ApiCompositionKpi): string {
  return getDisplayText(kpi.detail, '维持当前组合口径。');
}

function getScenarioLabel(value: unknown, fallback: string): string {
  return getDisplayText(typeof value === 'string' ? value : null, fallback);
}

function getScenarioDrawdown(value: unknown): string {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return formatComposePercent(numeric, { forceNegative: true });
}

function buildCorrelationLookup(cells: ApiCompositionCorrelationCell[], mode: CorrelationMode): Map<string, number> {
  return new Map(
    cells.map((cell) => [
      buildMatrixKey(cell.x_key, cell.y_key),
      mode === 'stress' ? getStressCorrelation(cell.correlation) : cell.correlation,
    ]),
  );
}

function getHighCorrelationPairs(detail: ApiCompositionDetail, mode: CorrelationMode): Array<{ key: string; label: string; value: number }> {
  const labelLookup = new Map(
    detail.normalized_legs.map((leg) => [
      leg.id,
      formatLegDisplayName({
        leg_kind: leg.leg_kind,
        display_name: leg.display_name,
        source_ref_id: leg.source_ref_id,
        config: leg.config,
      }),
    ]),
  );
  return detail.correlation_matrix
    .filter((cell) => cell.x_key !== cell.y_key)
    .map((cell) => {
      const value = mode === 'stress' ? getStressCorrelation(cell.correlation) : cell.correlation;
      return {
        key: buildMatrixKey(cell.x_key, cell.y_key),
        label: `${labelLookup.get(cell.x_key) ?? cell.x_key} / ${labelLookup.get(cell.y_key) ?? cell.y_key}`,
        value,
      };
    })
    .filter((item) => item.value >= 0.7)
    .filter((item, index, source) => source.findIndex((candidate) => candidate.key === item.key) === index)
    .sort((left, right) => right.value - left.value)
    .slice(0, 4);
}

function getRiskFlag(item: ApiCompositionRiskContribution): string {
  if (item.contribution_pct >= item.weight_pct * 1.35) {
    return '风险占用偏高';
  }
  if (item.contribution_pct <= Math.max(item.weight_pct * 0.7, 1)) {
    return '风险效率较高';
  }
  return '权重与风险接近';
}

function getRiskTrackTone(item: ApiCompositionRiskContribution): 'high' | 'medium' | 'low' {
  if (item.contribution_pct >= item.weight_pct * 1.25) {
    return 'high';
  }
  if (item.contribution_pct <= Math.max(item.weight_pct * 0.75, 1)) {
    return 'low';
  }
  return 'medium';
}

function getRiskTrackWidth(item: ApiCompositionRiskContribution): string {
  const returnContribution = Math.max(0, item.return_contribution_pct ?? 0);
  const dominant = Math.max(item.contribution_pct, returnContribution, item.weight_pct, 6);
  return `${Math.min(dominant, 100)}%`;
}

function formatCompactPercent(value: number, precision = 1): string {
  if (!Number.isFinite(value)) {
    return '0%';
  }
  const rounded = Number(value.toFixed(precision));
  return Number.isInteger(rounded) ? `${rounded.toFixed(0)}%` : `${rounded.toFixed(precision)}%`;
}

function formatFixedPercent(value: number, precision = 1): string {
  return Number.isFinite(value) ? `${value.toFixed(precision)}%` : '0.0%';
}

function getSnapshotNumber(source: Record<string, unknown> | undefined, key: string): number | null {
  const value = source?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getEvidenceWeightPct(
  evidence: ApiCompositionSourceFreeze,
  legWeightById: Map<string, number>,
): number {
  const snapshotWeight = getSnapshotNumber(evidence.snapshot, 'weight_pct');
  if (snapshotWeight !== null) {
    return snapshotWeight;
  }
  return legWeightById.get(evidence.leg_id) ?? 0;
}

function sortByWeightDesc<T>(items: T[], getWeight: (item: T) => number): T[] {
  return [...items].sort((left, right) => getWeight(right) - getWeight(left));
}

function getScenarioTone(value: unknown): string {
  return typeof value === 'string' ? value : 'neutral';
}

function getScenarioCases(detail: ApiCompositionDetail): Array<{
  key: string;
  label: string;
  expectedDrawdownPct: number | null;
  body: string;
  tag: string;
  tone: string;
}> {
  const rawCases = Array.isArray(detail.scenario_summary.cases) ? detail.scenario_summary.cases : [];
  const mappedCases = rawCases
    .map((item, index) => {
      const record = typeof item === 'object' && item !== null ? item : {};
      const drawdownValue = (record as { expected_drawdown_pct?: unknown }).expected_drawdown_pct;
      const expectedDrawdownPct =
        typeof drawdownValue === 'number' && Number.isFinite(drawdownValue) ? drawdownValue : null;
      return {
        key: getDisplayText(
          typeof (record as { key?: unknown }).key === 'string' ? (record as { key: string }).key : null,
          `scenario-${index}`,
        ),
        label: getScenarioLabel((record as { label?: unknown }).label, `情景 ${index + 1}`),
        expectedDrawdownPct,
        body: getNarrativeText(
          typeof (record as { body?: unknown }).body === 'string' ? (record as { body: string }).body : null,
          '基于当前权益曲线、相关性与现金缓冲生成的压力复核。',
        ),
        tag: getDisplayText(
          typeof (record as { tag?: unknown }).tag === 'string' ? (record as { tag: string }).tag : null,
          expectedDrawdownPct === null ? '情景待补充' : `预计回撤 ${getScenarioDrawdown(expectedDrawdownPct)}`,
        ),
        tone: getScenarioTone((record as { tone?: unknown }).tone),
      };
    })
    .filter((item) => item.label);
  if (mappedCases.length) {
    return mappedCases.slice(0, 3);
  }
  return [
    {
      key: 'base-case',
      label: getScenarioLabel(detail.scenario_summary.base_case.label, '基准情景'),
      expectedDrawdownPct:
        typeof detail.scenario_summary.base_case.expected_drawdown_pct === 'number'
        && Number.isFinite(detail.scenario_summary.base_case.expected_drawdown_pct)
          ? detail.scenario_summary.base_case.expected_drawdown_pct
          : null,
      body: '基于当前组合历史路径生成的基础压力复核。',
      tag: '基础情景',
      tone: 'accent',
    },
    {
      key: 'stress-case',
      label: getScenarioLabel(detail.scenario_summary.stress_case.label, '压力情景'),
      expectedDrawdownPct:
        typeof detail.scenario_summary.stress_case.expected_drawdown_pct === 'number'
        && Number.isFinite(detail.scenario_summary.stress_case.expected_drawdown_pct)
          ? detail.scenario_summary.stress_case.expected_drawdown_pct
          : null,
      body: '重点复核集中相关性与风险预算放大时的组合承压。',
      tag: '压力情景',
      tone: 'warning',
    },
  ];
}

function getScatterPoint(
  item: ApiCompositionRiskContribution,
  volatilityRange: { min: number; max: number },
  contributionRange: { min: number; max: number },
): { x: number; y: number } {
  const width = 360;
  const height = 260;
  const padding = 28;
  const xRange = volatilityRange.max - volatilityRange.min || 1;
  const yRange = contributionRange.max - contributionRange.min || 1;
  const x = padding + ((item.volatility_pct - volatilityRange.min) / xRange) * (width - padding * 2);
  const y =
    height -
    padding -
    ((item.contribution_pct - contributionRange.min) / yRange) * (height - padding * 2);
  return { x, y };
}

function getDrawerRows(evidence: ApiCompositionSourceFreeze): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ['冻结类型', getEvidenceKindLabel(evidence.freeze_ref_type)],
    ['冻结标识', evidence.freeze_ref_id],
    ['哈希摘要', evidence.freeze_hash],
    ['捕获时间', formatDateTime(evidence.captured_at)],
  ];
  Object.entries(evidence.snapshot ?? {}).forEach(([key, value]) => {
    rows.push([key.replace(/_/g, ' '), getDisplayText(String(value))]);
  });
  return rows;
}

const approvedKpis = [
  { label: '总收益', value: '+18.4%', detail: '最近 10 年，含再平衡后真实路径', tone: 'accent' },
  { label: '年化', value: '9.8%', detail: '超基准 2.1%', tone: 'neutral' },
  { label: '波动', value: '6.2%', detail: '低于纯风险资产', tone: 'neutral' },
  { label: '最大回撤', value: '-4.8%', detail: '恢复期 73 个交易日', tone: 'neutral' },
  { label: '现金占比', value: '20%', detail: '用于换手缓冲', tone: 'neutral' },
  { label: '夏普比率（Sharpe）', value: '1.21', detail: '收益效率高于 60/40', tone: 'neutral' },
  { label: '索提诺比率（Sortino）', value: '1.68', detail: '下行保护更稳定', tone: 'neutral' },
];

const approvedSources = [
  {
    id: 'strategy',
    title: '策略腿来源',
    status: '已冻结',
    ref: 'BT-240321 · 参数版本 P-20260418',
    hash: '6F3A',
    detail: '最近一次验证通过，回测、参数版本与冻结时间可以连起来复核。',
  },
  {
    id: 'bond',
    title: '债券腿来源',
    status: '可信',
    ref: 'Bond-UST10Y-20260421 · 净价 / 全价 / 到期收益率（YTM） / 应计利息',
    hash: '2C91',
    detail: '关键字段已连同快照 ID 一起冻结，避免后续重刷后口径漂移。',
  },
  {
    id: 'etf',
    title: 'ETF 篮子来源',
    status: '稳定',
    ref: 'Basket-ETF-Core-20260421 · 权重快照',
    hash: '91AD',
    detail: 'ETF 权重篮子与历史窗口一并冻结，可回看当时的构成和样本边界。',
  },
  {
    id: 'cash',
    title: '现金腿来源',
    status: '已冻结',
    ref: 'Cash-Rule-Quarterly-001 · 维护规则版本',
    hash: '7DB4',
    detail: '现金腿阈值、再平衡条件与成本吸收规则已固化，不依赖临时手工判断。',
  },
];

const approvedRiskRows = [
  {
    label: '宏观轮动策略',
    weight: 32,
    legType: '策略腿',
    statusTone: 'success',
    returnContribution: 38,
    riskContribution: 60,
    riskNote: '明显高于权重占比',
    trackTone: 'high',
    chips: [
      { label: '近期表现优', tone: 'accent' },
      { label: '与 ETF 高相关', tone: 'warning' },
    ],
    linkAfter: true,
  },
  {
    label: '核心 ETF 篮子',
    weight: 24,
    legType: '资产腿',
    statusTone: 'neutral',
    returnContribution: 17,
    riskContribution: 23,
    riskNote: '与策略腿联动偏高',
    trackTone: 'medium',
    chips: [
      { label: '月度权重重建', tone: 'neutral' },
      { label: '对冲价值偏弱', tone: 'warning' },
    ],
  },
  {
    label: '10Y 国债稳定腿',
    weight: 24,
    legType: '资产腿',
    statusTone: 'neutral',
    returnContribution: 21,
    riskContribution: 12,
    riskNote: '明显低于权重占比',
    trackTone: 'low',
    chips: [
      { label: '稳定器', tone: 'accent' },
      { label: '到期收益率（YTM）/ 久期（Duration） 已冻结', tone: 'neutral' },
    ],
  },
  {
    label: '现金缓冲规则',
    weight: 20,
    legType: '现金腿',
    statusTone: 'neutral',
    returnContribution: 6,
    riskContribution: 5,
    riskNote: '主要吸收调仓成本',
    trackTone: 'low',
    chips: [
      { label: '换手缓冲', tone: 'neutral' },
      { label: '成本吸收', tone: 'neutral' },
    ],
  },
];

const approvedCurrentMatrix = [
  ['1.00', '0.29', '0.74', '-0.06'],
  ['0.29', '1.00', '0.18', '0.24'],
  ['0.74', '0.18', '1.00', '0.05'],
  ['-0.06', '0.24', '0.05', '1.00'],
];
const approvedStressMatrix = [
  ['1.00', '0.42', '0.88', '0.02'],
  ['0.42', '1.00', '0.31', '0.28'],
  ['0.88', '0.31', '1.00', '0.12'],
  ['0.02', '0.28', '0.12', '1.00'],
];

function getApprovedMatrixTone(value: string): string {
  const numeric = Number(value);
  if (numeric >= 0.7) {
    return 'tone-hot';
  }
  if (numeric >= 0.25) {
    return 'tone-b';
  }
  if (numeric < 0) {
    return 'tone-c';
  }
  return numeric === 1 ? 'tone-a' : 'tone-d';
}

function getApprovedChipClassName(tone: string): string {
  if (tone === 'accent') {
    return 'chip chip--accent';
  }
  if (tone === 'warning') {
    return 'chip chip--warning';
  }
  if (tone === 'danger') {
    return 'chip chip--danger';
  }
  return 'chip';
}

function ApprovedCompositionDetailPreview(): JSX.Element {
  const [performanceMode, setPerformanceMode] = useState<'cumulative' | 'excess' | 'rebalance' | 'drawdown'>('cumulative');
  const [correlationMode, setCorrelationMode] = useState<CorrelationMode>('current');
  const [selectedSource, setSelectedSource] = useState<(typeof approvedSources)[number] | null>(null);
  const matrix = correlationMode === 'stress' ? approvedStressMatrix : approvedCurrentMatrix;
  const sourceIntegrity: ApiCompositionSourceIntegrity[] = [];
  const driftCount = 0;

  return (
    <div
      className="composition-detail-page composition-detail-approved stack"
      data-page-root="composition-detail"
      data-route-root="compositions"
    >
      <section className="composition-detail-hero composition-detail-approved-hero">
        <div className="composition-detail-hero__copy">
          <h1>平衡收益组合</h1>
          <p>4 条腿、季度再平衡、来源已冻结。收益路径、风险归因与来源快照共同刻画组合当前的持有质量。</p>
          <div className="composition-detail-hero__chips">
            <span className="status-chip status-chip--success">冻结来源快照</span>
            <span className="status-chip status-chip--soft">季度再平衡</span>
            <span className="status-chip status-chip--soft">来源 4 / 4 稳定</span>
            <span className="status-chip status-chip--soft">可追溯维护成本</span>
          </div>
        </div>
        <div className="composition-detail-hero__actions">
          <button className="ghost-button" type="button">复制组合</button>
          <button className="ghost-button" type="button">重新平衡</button>
          <button
            className="primary-button"
            onClick={() => navigateTo('/compositions/workbench?composition_id=detail')}
            type="button"
          >
            编辑组合
          </button>
        </div>
      </section>

      <section className="panel composition-detail-kpi-panel composition-detail-approved-kpi-panel">
        <div className="composition-detail-kpi-grid">
          {approvedKpis.map((kpi) => (
            <article
              className={kpi.tone === 'accent' ? 'composition-detail-kpi-card composition-detail-kpi-card--accent' : 'composition-detail-kpi-card'}
              key={kpi.label}
            >
              <div className="composition-detail-kpi-card__head">
                <span>{kpi.label}</span>
              </div>
              <strong>{kpi.value}</strong>
              <p>{kpi.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="composition-detail-main-grid">
        <div className="composition-detail-main-column">
          <section className="panel composition-detail-panel composition-detail-approved-performance">
            <div className="panel-header composition-detail-panel__header composition-detail-approved-performance-header">
              <div>
                <h2>权益曲线</h2>
                <p className="composition-detail-panel__copy">
                  在同一视图核对组合收益、基准偏离、回撤区间与再平衡影响，评估组合表现的稳定性。
                </p>
              </div>
              <div className="composition-detail-approved-panel-actions">
                <span className="chip chip--accent">最近 10 年</span>
                <span className="chip">基准：60/40 经典组合</span>
              </div>
            </div>

            <div className="composition-detail-approved-detail-toolbar">
              <div className="composition-detail-approved-chip-row">
                {[
                  ['cumulative', '累计收益', 'accent'],
                  ['excess', '超额收益', 'neutral'],
                  ['rebalance', '再平衡点', 'neutral'],
                  ['drawdown', '回撤阴影', 'danger'],
                ].map(([mode, label, tone]) => (
                  <button
                    aria-pressed={performanceMode === mode}
                    className={performanceMode === mode ? getApprovedChipClassName(tone) : 'chip'}
                    key={mode}
                    onClick={() => setPerformanceMode(mode as typeof performanceMode)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="composition-detail-approved-detail-inline-note">
                累计收益与超额收益共用同一套时间轴；再平衡点用于复核当次调仓成本与现金缓冲效果。
              </span>
            </div>

            <div className="composition-detail-chart-frame composition-detail-approved-chart-frame">
              <svg aria-label="组合累计收益图" className="composition-detail-approved-chart" viewBox="0 0 1000 320" preserveAspectRatio="xMidYMid meet">
                <defs>
                  <linearGradient id="approvedReturnFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="rgba(31, 135, 123, 0.18)" />
                    <stop offset="100%" stopColor="rgba(31, 135, 123, 0)" />
                  </linearGradient>
                  <linearGradient id="approvedDrawdownFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="rgba(196, 92, 79, 0.16)" />
                    <stop offset="100%" stopColor="rgba(196, 92, 79, 0)" />
                  </linearGradient>
                </defs>
                <path d="M0 266 L126 266 L252 258 L378 250 L504 256 L632 248 L758 240 L884 246 L1000 238 L1000 320 L0 320 Z" fill="url(#approvedDrawdownFill)" />
                <path d="M0 238 L142 230 L284 216 L426 188 L568 160 L710 126 L852 96 L1000 74 L1000 320 L0 320 Z" fill="url(#approvedReturnFill)" />
                <polyline fill="none" stroke="#4c78c7" strokeDasharray="10 8" strokeWidth="4" points="0,244 142,240 284,234 426,222 568,208 710,194 852,184 1000,178" />
                <polyline fill="none" stroke="#1f877b" strokeWidth="5" points="0,238 142,230 284,216 426,188 568,160 710,126 852,96 1000,74" />
                <line x1="284" y1="112" x2="284" y2="286" stroke="rgba(31, 135, 123, 0.22)" strokeDasharray="4 6" />
                <line x1="710" y1="112" x2="710" y2="286" stroke="rgba(31, 135, 123, 0.22)" strokeDasharray="4 6" />
                <circle cx="284" cy="216" r="7" fill="#ffffff" stroke="#1f877b" strokeWidth="4" />
                <circle cx="710" cy="126" r="7" fill="#ffffff" stroke="#1f877b" strokeWidth="4" />
                <rect x="342" y="66" rx="14" ry="14" width="190" height="58" fill="#ffffff" stroke="rgba(229, 231, 235, 0.96)" />
                <text x="362" y="90" fill="#111827" fontSize="14" fontWeight="700">2025-03 再平衡</text>
                <text x="362" y="112" fill="#64748b" fontSize="12">现金腿吸收调仓损耗 12 bps</text>
              </svg>
            </div>

            <article className="composition-detail-approved-mini-chart">
              <div className="composition-detail-approved-mini-chart-meta">
                <strong>超额收益</strong>
                <span>组合 - 60/40 基准。正区间越稳，说明这套腿结构在该阶段贡献了真实超额收益（α）。</span>
              </div>
              <svg viewBox="0 0 1000 60" preserveAspectRatio="xMidYMid meet">
                <line x1="0" y1="30" x2="1000" y2="30" stroke="rgba(148, 163, 184, 0.42)" strokeDasharray="4 6" />
                <polyline fill="none" stroke="#4c78c7" strokeWidth="4" points="0,40 142,39 284,37 426,31 568,22 710,16 852,12 1000,9" />
              </svg>
            </article>

            <div className="composition-detail-approved-bottom-tabs">
              <span className="chip chip--accent">组合实线</span>
              <span className="chip chip--asset">60/40 基准虚线</span>
              <span className="chip">再平衡点</span>
              <span className="chip chip--danger">回撤阴影</span>
            </div>

            <article className="composition-detail-approved-rebalance-card">
              <strong>再平衡点</strong>
              <span>
                2025-03 与 2025-09 为再平衡窗口；点位信息用于复核当次调仓损耗、现金缓冲吸收比例与仓位变化。
              </span>
            </article>
          </section>

          <div className="composition-detail-approved-analysis-grid">
            <section className="panel composition-detail-panel">
              <div className="panel-header composition-detail-panel__header">
                <div>
                  <h2>风险与归因</h2>
                  <p className="composition-detail-panel__copy">
                    从收益贡献、风险贡献与效率分布三个维度判断各腿对组合的真实作用。
                  </p>
                </div>
              </div>

              <article className="composition-detail-approved-scatter-shell">
                <div className="composition-detail-approved-scatter-meta">
                  <strong>风险收益散点</strong>
                  <span>横轴看波动贡献，纵轴看收益贡献。右上角是高效率腿，右下角是“白占仓位”的低效腿。</span>
                </div>
                <svg className="composition-detail-approved-scatter" viewBox="0 0 520 220" preserveAspectRatio="xMidYMid meet">
                  <line x1="62" y1="182" x2="476" y2="182" stroke="rgba(148, 163, 184, 0.42)" />
                  <line x1="62" y1="24" x2="62" y2="182" stroke="rgba(148, 163, 184, 0.42)" />
                  <line x1="62" y1="100" x2="476" y2="100" stroke="rgba(148, 163, 184, 0.24)" strokeDasharray="4 6" />
                  <circle cx="314" cy="64" r="11" fill="#1f877b" />
                  <text x="332" y="60" fill="#111827" fontSize="13" fontWeight="700">宏观策略</text>
                  <circle cx="394" cy="136" r="11" fill="#c45c4f" />
                  <text x="412" y="132" fill="#111827" fontSize="13" fontWeight="700">ETF 篮子</text>
                  <circle cx="224" cy="84" r="11" fill="#4c78c7" />
                  <text x="242" y="80" fill="#111827" fontSize="13" fontWeight="700">10Y 国债</text>
                  <circle cx="116" cy="152" r="11" fill="#d7b47d" />
                  <text x="134" y="148" fill="#111827" fontSize="13" fontWeight="700">现金腿</text>
                </svg>
                <div className="composition-detail-approved-chip-row">
                  <span className="chip chip--accent">高效率腿：宏观策略 / 10Y 国债</span>
                  <span className="chip chip--warning">效率偏低：ETF 篮子</span>
                </div>
              </article>

              <div className="composition-detail-approved-snapshot-list">
                {approvedRiskRows.map((item) => (
                  <div className="composition-detail-approved-risk-block" key={item.label}>
                    <article className="composition-detail-approved-snapshot-card">
                      <div className="composition-detail-approved-snapshot-head">
                        <strong>{item.label} · {item.weight}%</strong>
                        <span className={item.statusTone === 'success' ? 'status-chip status-chip--success' : 'status-chip'}>{item.legType}</span>
                      </div>
                      <div className="composition-detail-approved-structure-meta">
                        <div className="composition-detail-approved-weight-subrow">
                          <span>收益贡献 {item.returnContribution}%</span>
                          <span>权重 {item.weight}%</span>
                        </div>
                        <div className="composition-detail-approved-risk-row">
                          <span>风险贡献 {item.riskContribution}%</span>
                          <span>{item.riskNote}</span>
                        </div>
                        <div className={`composition-detail-approved-risk-track composition-detail-approved-risk-track--${item.trackTone}`}>
                          <span style={{ width: item.trackTone === 'medium' ? '48%' : item.trackTone === 'low' ? item.label.includes('现金') ? '14%' : '26%' : '60%' }} />
                        </div>
                        <div className="composition-detail-approved-chip-row">
                          {item.chips.map((chip) => (
                            <span className={getApprovedChipClassName(chip.tone)} key={chip.label}>{chip.label}</span>
                          ))}
                        </div>
                      </div>
                    </article>
                    {item.linkAfter ? (
                      <div className="composition-detail-approved-leg-link">
                        <span className="composition-detail-approved-leg-link__line" />
                        <span className="composition-detail-approved-leg-link__chip">高相关预警</span>
                        <span className="composition-detail-approved-leg-link__line" />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>

            <section className="panel composition-detail-panel">
              <div className="panel-header composition-detail-panel__header">
                <div>
                  <h2>相关性矩阵</h2>
                  <p className="composition-detail-panel__copy">
                    常态相关性先告诉你“平时像不像在分散”，压力相关性再揭示极端时期会不会一起失效。
                  </p>
                </div>
              </div>
              <div className="composition-detail-approved-chip-row">
                <button
                  className={correlationMode === 'current' ? 'chip chip--accent' : 'chip'}
                  onClick={() => setCorrelationMode('current')}
                  type="button"
                >
                  常态相关性
                </button>
                <button
                  className={correlationMode === 'stress' ? 'chip chip--accent' : 'chip'}
                  onClick={() => setCorrelationMode('stress')}
                  type="button"
                >
                  极端行情相关性
                </button>
                <span className="chip chip--danger">高相关预警</span>
              </div>
              <div className="composition-detail-approved-matrix-wrap">
                <div className="composition-detail-approved-heatmap" aria-label="相关性热力矩阵">
                  {matrix.flat().map((value, index) => (
                    <span className={getApprovedMatrixTone(value)} key={`${value}-${index}`}>
                      {value}
                    </span>
                  ))}
                </div>
                <article className="composition-detail-approved-matrix-hover-card">
                  <strong>压力切换</strong>
                  <span>
                    切到极端行情相关性后，策略腿 × ETF 腿会从 {approvedCurrentMatrix[0][2]} 升至 {approvedStressMatrix[0][2]}。
                  </span>
                  <svg viewBox="0 0 150 88" preserveAspectRatio="none">
                    <path d="M14 70 C44 58, 78 36, 136 18" fill="none" stroke="#c45c4f" strokeWidth="2.5" />
                    <circle cx="18" cy="68" r="4" fill="#c45c4f" />
                    <circle cx="48" cy="58" r="4" fill="#c45c4f" />
                    <circle cx="82" cy="40" r="4" fill="#c45c4f" />
                    <circle cx="120" cy="24" r="4" fill="#c45c4f" />
                  </svg>
                </article>
              </div>
              <article className="composition-detail-approved-matrix-note-card">
                <strong>高相关预警</strong>
                <span>
                  当矩阵中出现大于 0.70 的正相关时，组合结构区会在对应两条腿之间拉出淡红连线，提醒研究员不要被表面上的“多腿数量”误导。
                </span>
              </article>
            </section>
          </div>

          <section className="panel composition-detail-panel composition-detail-approved-scenario-panel">
            <div className="panel-header composition-detail-panel__header">
              <div>
                <h2>情景分析</h2>
                <p className="composition-detail-panel__copy">
                  把底部留白让给决策型问题：如果极端历史重演，这个组合预计会怎么跌、多久修复、哪条腿会先失效。
                </p>
              </div>
            </div>
            <div className="composition-detail-scenario-grid composition-detail-approved-scenario-grid">
              {[
                ['2008 金融危机重演', '预计组合跌幅约 -11.6%，主要压力集中在策略腿与 ETF 腿同步回撤阶段，10Y 国债与现金腿承担主要缓冲。', '恢复期约 7.5 个月', 'warning'],
                ['2020 流动性危机重演', '预计组合跌幅约 -8.2%，现金腿先吸收换手冲击，组合整体修复速度快于纯风险资产篮子。', '恢复期约 4.2 个月', 'accent'],
                ['2022 加息冲击重演', '预计组合跌幅约 -6.4%，压力主要来自策略腿与 ETF 腿相关性抬升，债券腿的稳定作用低于常态期。', '需切到压力相关性复核', 'danger'],
              ].map(([title, body, tag, tone]) => (
                <article className="composition-detail-scenario-card composition-detail-approved-scenario-card" key={title}>
                  <strong>{title}</strong>
                  <span>{body}</span>
                  <div className="composition-detail-approved-chip-row">
                    <span className={getApprovedChipClassName(tone)}>{tag}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>

        <aside className="composition-detail-rail">
          <section className="panel composition-detail-panel composition-detail-rail-panel">
            <div className="panel-header composition-detail-panel__header">
              <div>
                <h2>来源快照</h2>
              </div>
            </div>
            <div className="composition-detail-evidence-list">
              {approvedSources.map((source) => (
                <button
                  className={selectedSource?.id === source.id ? 'composition-detail-evidence-card composition-detail-approved-source-card is-active' : 'composition-detail-evidence-card composition-detail-approved-source-card'}
                  key={source.id}
                  onClick={() => setSelectedSource(source)}
                  type="button"
                >
                  <div className="composition-detail-evidence-card__head">
                    <strong>{source.title}</strong>
                    <span className={source.id === 'strategy' || source.id === 'bond' ? 'status-chip status-chip--success' : 'status-chip'}>{source.status}</span>
                  </div>
                  <div className="composition-detail-approved-source-line">
                    <span>{source.ref}</span>
                    <span className="composition-detail-shield">配置指纹 {source.hash}</span>
                  </div>
                  <span className="composition-detail-approved-source-detail">{source.detail}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel composition-detail-panel composition-detail-rail-panel">
            <div className="panel-header composition-detail-panel__header">
              <div>
                <h2>再平衡与成本</h2>
              </div>
            </div>
            <article className="composition-detail-cost-card">
              <div className="composition-detail-risk-card__head">
                <strong>距离下一个再平衡窗口</strong>
                <span>11 天</span>
              </div>
              <div className="composition-detail-progress">
                <span style={{ width: '68%' }} />
              </div>
              <p>季度窗口前仍保留 11 天。当前现金腿缓冲仍足够，暂不需要为降低换手而提前动作。</p>
            </article>
            <article className="composition-detail-note-card">
              预计成本 12 bps。最近一次再平衡中，现金腿实际吸收了约 7 bps 的换手冲击。
            </article>
            <article className="composition-detail-note-card">
              当前组合结构成立，但策略腿与 ETF 腿相关性偏高。进入窗口前应先复核压力相关性。
            </article>
          </section>

        </aside>
      </div>

      {selectedSource ? (
        <div
          className="composition-detail-drawer-shell"
          onClick={() => setSelectedSource(null)}
          role="presentation"
        >
          <aside
            aria-label="来源快照详情"
            className="composition-detail-drawer"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="composition-detail-drawer__header">
              <div>
                <p className="page-heading__eyebrow">来源快照</p>
                <h2>{selectedSource.title}</h2>
                <p>{selectedSource.ref}</p>
              </div>
              <button className="ghost-button" onClick={() => setSelectedSource(null)} type="button">
                关闭
              </button>
            </div>
            <div className="composition-detail-drawer__summary">
              <span className="composition-detail-shield">配置指纹 {selectedSource.hash}</span>
              <span>{selectedSource.status}</span>
              <span>{selectedSource.id}</span>
            </div>
            <p>{selectedSource.detail}</p>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

export function CompositionDetailView({
  detail,
  loading,
  error,
  approvedPreview,
  savingStatus = false,
  writeError = null,
  onStatusChange,
}: CompositionDetailViewProps): JSX.Element {
  const [correlationMode, setCorrelationMode] = useState<CorrelationMode>('current');
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [selectedLegId, setSelectedLegId] = useState<string | null>(null);
  const [hoveredReturnIndex, setHoveredReturnIndex] = useState<number | null>(null);

  if (approvedPreview) {
    return <ApprovedCompositionDetailPreview />;
  }

  const selectedEvidence = detail
    ? detail.source_evidence.find((item) => item.id === selectedEvidenceId) ?? null
    : null;
  const legDetailRows = detail ? detail.normalized_legs.map((leg) => buildLegInventoryRowFromComposition(detail, leg)) : [];
  const selectedLegRow = selectedLegId
    ? legDetailRows.find((row) => detail && isMatchingLegSelection(row, selectedLegId, detail)) ?? null
    : null;
  const approvedChartWidth = 1000;
  const approvedChartHeight = 320;
  const cumulativeSeries = detail ? detail.returns_preview.map((item) => item.cumulative_return_pct) : [];
  const benchmarkSeries = detail ? detail.benchmark_series.map((item) => item.cumulative_return_pct) : [];
  const spreadSeries = detail ? detail.spread_series.map((item) => item.spread_pct) : [];
  const costDragSeries = detail ? getCostDragSeries(detail) : [];
  const drawdownSeries = useMemo(() => {
    let peak = Number.NEGATIVE_INFINITY;
    return cumulativeSeries.map((value) => {
      peak = Math.max(peak, value);
      return value - peak;
    });
  }, [cumulativeSeries]);
  const cumulativeMin = Math.min(...[0, ...cumulativeSeries, ...benchmarkSeries, ...costDragSeries]);
  const cumulativeMax = Math.max(...[0, ...cumulativeSeries, ...benchmarkSeries, ...costDragSeries, 0.01]);
  const chartZeroAxisY = Math.min(
    approvedChartHeight - 40,
    Math.max(
      40,
      getPoint(
        0,
        Math.max(cumulativeSeries.length, 1),
        0,
        cumulativeMin,
        cumulativeMax,
        approvedChartWidth,
        approvedChartHeight,
      ).y,
    ),
  );
  const cumulativePath = buildLinePath(
    cumulativeSeries,
    approvedChartWidth,
    approvedChartHeight,
    cumulativeMin,
    cumulativeMax,
  );
  const benchmarkPath = buildLinePath(
    benchmarkSeries,
    approvedChartWidth,
    approvedChartHeight,
    cumulativeMin,
    cumulativeMax,
  );
  const costDragPath = buildLinePath(
    costDragSeries,
    approvedChartWidth,
    approvedChartHeight,
    cumulativeMin,
    cumulativeMax,
  );
  const drawdownArea = buildDrawdownBandArea(drawdownSeries, approvedChartWidth, approvedChartHeight, chartZeroAxisY);
  const drawdownBandArea = drawdownArea;
  const versionChartMarkers =
    detail
      ? getRebalanceChartMarkers(detail).map((marker) => {
          const markerValue = cumulativeSeries[marker.index] ?? 0;
          const point = getPoint(
            marker.index,
            cumulativeSeries.length,
            markerValue,
            cumulativeMin,
            cumulativeMax,
            approvedChartWidth,
            approvedChartHeight,
          );
          return { ...marker, point };
        })
      : [];
  const safeHoveredReturnIndex =
    hoveredReturnIndex !== null && hoveredReturnIndex >= 0 && hoveredReturnIndex < cumulativeSeries.length
      ? hoveredReturnIndex
      : null;
  const hoveredChartPoint =
    safeHoveredReturnIndex !== null
      ? getPoint(
          safeHoveredReturnIndex,
          cumulativeSeries.length,
          cumulativeSeries[safeHoveredReturnIndex],
          cumulativeMin,
          cumulativeMax,
          approvedChartWidth,
          approvedChartHeight,
        )
      : null;
  const hoveredReturnPoint =
    detail && safeHoveredReturnIndex !== null ? detail.returns_preview[safeHoveredReturnIndex] : null;
  const hoveredBenchmarkPoint =
    detail && safeHoveredReturnIndex !== null ? detail.benchmark_series[safeHoveredReturnIndex] : null;
  const hoveredSpreadPoint =
    detail && safeHoveredReturnIndex !== null ? detail.spread_series[safeHoveredReturnIndex] : null;
  const hoveredCostDragValue = safeHoveredReturnIndex !== null ? costDragSeries[safeHoveredReturnIndex] : null;
  const hoveredReturnLabel = safeHoveredReturnIndex !== null ? `收益节点 ${safeHoveredReturnIndex + 1}` : '收益节点';
  const tooltipWidth = 180;
  const tooltipHeight = 96;
  const tooltipX = hoveredChartPoint
    ? Math.min(approvedChartWidth - tooltipWidth - 16, Math.max(16, hoveredChartPoint.x + 14))
    : 0;
  const tooltipY = hoveredChartPoint
    ? Math.max(16, Math.min(approvedChartHeight - tooltipHeight - 16, hoveredChartPoint.y - tooltipHeight - 12))
    : 0;
  const handleReturnChartPointerMove = (
    event: ReactMouseEvent<SVGSVGElement> | ReactPointerEvent<SVGSVGElement>,
  ): void => {
    if (!cumulativeSeries.length) {
      setHoveredReturnIndex(null);
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const width = bounds.width || approvedChartWidth;
    const clientX = Number.isFinite(event.clientX) ? event.clientX : bounds.left + width / 2;
    const relativeX = Math.min(width, Math.max(0, clientX - bounds.left));
    const nextIndex = Math.round((relativeX / Math.max(width, 1)) * Math.max(cumulativeSeries.length - 1, 0));
    setHoveredReturnIndex(nextIndex);
  };

  const correlationLookup = useMemo(
    () => buildCorrelationLookup(detail?.correlation_matrix ?? [], correlationMode),
    [detail?.correlation_matrix, correlationMode],
  );
  const highCorrelationPairs = useMemo(
    () => (detail ? getHighCorrelationPairs(detail, correlationMode) : []),
    [detail, correlationMode],
  );
  const elapsedDays = detail ? getDaysSince(detail.updated_at) : 0;
  const cadenceDays = getIntervalDays(detail?.rebalance_frequency);
  const rebalanceProgress = Math.min(100, Math.round((elapsedDays / cadenceDays) * 100));
  const rebalanceRemaining = Math.max(0, cadenceDays - elapsedDays);
  if (loading) {
    return (
      <div className="composition-detail-page stack" data-page-root="composition-detail" data-route-root="compositions">
        <section className="page-heading">
          <p className="page-heading__eyebrow">组合详情</p>
          <h1>加载组合详情中…</h1>
          <p>正在拉取权益曲线、风险归因与来源冻结证据。</p>
        </section>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="composition-detail-page stack" data-page-root="composition-detail" data-route-root="compositions">
        <section className="page-heading">
          <p className="page-heading__eyebrow">组合详情</p>
          <h1>组合详情</h1>
          <p>这里用于集中查看收益、风险、来源冻结与维护判断。</p>
        </section>
        <div className="error-banner" role="alert">
          {error || '当前组合不存在。'}
        </div>
      </div>
    );
  }

  const legDisplayNameById = new Map(
    detail.normalized_legs.map((leg) => [
      leg.id,
      formatLegDisplayName({
        leg_kind: leg.leg_kind,
        display_name: leg.display_name,
        source_ref_id: leg.source_ref_id,
        config: leg.config,
      }),
    ]),
  );
  const legWeightById = new Map(detail.normalized_legs.map((leg) => [leg.id, leg.weight_pct]));
  const legTypeLabelById = new Map(detail.normalized_legs.map((leg) => [leg.id, getLegTypeLabel(leg.leg_kind)]));
  const alignedRiskContributions = getRiskContributionsInLegOrder(detail);
  const sortedSourceEvidence = sortByWeightDesc(
    detail.source_evidence,
    (item) => getEvidenceWeightPct(item, legWeightById),
  );
  const stableSourceCount = detail.normalized_legs.filter((leg) =>
    ['READY', 'ACTIVE'].includes(String(leg.status ?? '').toUpperCase()),
  ).length;
  const sourceIntegrity = detail.source_integrity ?? [];
  const sourceIntegrityByLegId = new Map(sourceIntegrity.map((item) => [item.leg_id, item]));
  const auditTrail = detail.audit_trail ?? [];
  const driftCount = sourceIntegrity.filter((item) =>
    !['current', 'verified'].includes(String(item.drift_status ?? '').toLowerCase()),
  ).length;
  const heroTitle = formatCompositionName({
    name: detail.hero_summary.title || detail.name,
    benchmarkLabel: detail.hero_summary.benchmark_label ?? detail.benchmark_definition?.label,
    status: detail.status,
  });
  const heroCopy = formatCompositionHeroCopy({
    description: detail.description,
    legCount: detail.hero_summary.leg_count,
    rebalanceFrequency: detail.rebalance_frequency,
  });
  const detailKpis = buildDetailKpiCards(detail);
  const primaryDiagnosis = primaryCompositionDiagnosis(detail);
  const compositionVersionLabel = getCompositionVersionLabel(detail);
  const currentRulingLabel = getCurrentRulingLabel(detail, driftCount);
  const executionHistoryRows = getExecutionHistoryRows(detail);
  const primaryBacktestRunId = getPrimaryBacktestRunId(detail, executionHistoryRows);
  const primaryBacktestPath = primaryBacktestRunId
    ? `/compositions/${encodeURIComponent(detail.id)}/backtest-runs/${encodeURIComponent(primaryBacktestRunId)}`
    : `/compositions/${encodeURIComponent(detail.id)}/backtest-runs/new`;
  const versionEvolutionRows = getVersionEvolutionRows(detail);
  const exposureDrilldownRows = getExposureDrilldownRows(detail);
  const benchmarkLabel = formatBenchmarkLabel(
    detail.benchmark_definition?.label ?? detail.hero_summary.benchmark_label,
  );
  return (
    <div
      className="composition-detail-page composition-detail-approved stack"
      data-page-root="composition-detail"
      data-route-root="compositions"
    >
      <section className="composition-detail-hero">
        <div className="composition-detail-hero__copy">
          <h1>{heroTitle}</h1>
          <p>{heroCopy}</p>
          <div className="composition-detail-hero__chips">
            <span className="status-chip status-chip--soft">{compositionVersionLabel}</span>
            <span className="status-chip status-chip--success">{formatCompositionStatusLabel(detail.status, detail.status_label)}</span>
            <span className={getDiagnosisChipClassName(detail)}>状态标签：{primaryDiagnosis.diagnosis_label}</span>
            <span className="status-chip status-chip--soft">当前裁决：{currentRulingLabel}</span>
            <span className="status-chip status-chip--soft">{benchmarkLabel}</span>
            <span className="status-chip status-chip--soft">来源 {stableSourceCount} / {detail.hero_summary.leg_count} 稳定</span>
            <button
              className="composition-detail-version-switch"
              onClick={() => navigateTo(`/compositions/workbench?composition_id=${encodeURIComponent(detail.id)}&intent=version-switch`)}
              type="button"
            >
              切换版本
            </button>
          </div>
        </div>
        <div className="composition-detail-hero__actions">
          <button
            className="primary-button"
            onClick={() => navigateTo(`/compositions/workbench?composition_id=${encodeURIComponent(detail.id)}&intent=rebalance`)}
            type="button"
          >
            修改组合
          </button>
          <button
            className="ghost-button"
            onClick={() => navigateTo(primaryBacktestPath)}
            type="button"
          >
            查看回测
          </button>
          <button
            className="ghost-button"
            onClick={() => navigateTo(`/compositions/${encodeURIComponent(detail.id)}/allocation-lab`)}
            type="button"
          >
            配置实验室
          </button>
        </div>
      </section>

      {writeError ? <div className="error-banner" role="alert">{writeError}</div> : null}

      <section className="panel composition-detail-panel composition-detail-kpi-panel">
        <div className="composition-detail-kpi-grid">
          {detailKpis.map((kpi) => (
            <article
              className={kpi.accent ? 'composition-detail-kpi-card composition-detail-kpi-card--accent' : 'composition-detail-kpi-card'}
              data-kpi-key={kpi.key}
              key={kpi.key}
            >
              <div className="composition-detail-kpi-card__head">
                <span>{kpi.label}</span>
                {kpi.tooltip ? (
                  <button
                    aria-label={`${kpi.label}指标说明`}
                    className="composition-detail-kpi-card__tooltip"
                    data-tooltip={kpi.tooltip}
                    title={kpi.tooltip}
                    type="button"
                  >
                    ?
                  </button>
                ) : null}
              </div>
              <div className="composition-detail-kpi-card__core">
                <strong>{kpi.value}</strong>
                {kpi.trendText ? (
                  <span className={`composition-detail-kpi-card__trend composition-detail-kpi-card__trend--${kpi.trendTone ?? 'neutral'}`}>
                    {kpi.trendText}
                  </span>
                ) : null}
              </div>
              {kpi.compareItems?.length ? (
                <div className={getCompareGridClassName(kpi.compareItems.length)}>
                  {kpi.compareItems.map((item) => (
                    <div className="composition-detail-kpi-card__compare-item" key={`${kpi.key}-${item.label}`}>
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                  ))}
                </div>
              ) : null}
              {kpi.detail ? <p className={getToneClassName(kpi.tone)}>{kpi.detail}</p> : null}
            </article>
          ))}
        </div>
      </section>

      <div className="composition-detail-approved-layout">
        <div className="composition-detail-main-stack">
          <section className="panel composition-detail-panel composition-detail-approved-performance">
            <div className="panel-header composition-detail-panel__header composition-detail-approved-performance-header">
              <div>
                <h2>权益曲线</h2>
                <p className="composition-detail-panel__copy">
                  净值、基准、成本拖累与回撤带同屏校验，用于判断当前持有结论。
                </p>
              </div>
              <div className="composition-detail-approved-panel-actions">
                <span className="chip chip--accent">{currentRulingLabel}</span>
              </div>
            </div>
            <div className="composition-detail-chart-frame composition-detail-approved-chart-frame">
              <svg
                aria-label="权益曲线"
                className="composition-detail-approved-chart"
                data-ui="composition-return-chart"
                onMouseLeave={() => setHoveredReturnIndex(null)}
                onMouseMove={handleReturnChartPointerMove}
                onPointerLeave={() => setHoveredReturnIndex(null)}
                onPointerMove={handleReturnChartPointerMove}
                preserveAspectRatio="xMidYMid meet"
                viewBox="0 0 1000 320"
              >
                <line className="composition-detail-grid-line" x1="24" x2="976" y1={chartZeroAxisY} y2={chartZeroAxisY} />
                {drawdownBandArea ? (
                  <path className="composition-detail-drawdown-area" d={drawdownBandArea} data-ui="composition-drawdown-band" />
                ) : null}
                {benchmarkPath ? <path className="composition-detail-benchmark-path" d={benchmarkPath} data-ui="composition-benchmark-line" /> : null}
                {costDragPath ? <path className="composition-detail-cost-drag-path" d={costDragPath} data-ui="composition-cost-drag-line" /> : null}
                {cumulativePath ? <path className="composition-detail-performance-path" d={cumulativePath} data-ui="composition-portfolio-line" /> : null}
                {versionChartMarkers.map((marker) => (
                  <g
                    className="composition-detail-rebalance-marker composition-detail-version-marker"
                    data-ui="composition-version-marker"
                    key={marker.key}
                  >
                    <title>再平衡节点</title>
                    <line
                      className="composition-detail-rebalance-marker__line"
                      x1={marker.point.x}
                      x2={marker.point.x}
                      y1="34"
                      y2={chartZeroAxisY}
                    />
                    <circle
                      className="composition-detail-rebalance-marker__dot"
                      cx={marker.point.x}
                      cy={marker.point.y}
                      r="5"
                    />
                  </g>
                ))}
                {hoveredChartPoint && hoveredReturnPoint ? (
                  <g className="composition-detail-approved-tooltip" data-ui="composition-return-tooltip" pointerEvents="none">
                    <line
                      className="composition-detail-hover-line"
                      x1={hoveredChartPoint.x}
                      x2={hoveredChartPoint.x}
                      y1="24"
                      y2={chartZeroAxisY}
                    />
                    <circle className="composition-detail-hover-dot" cx={hoveredChartPoint.x} cy={hoveredChartPoint.y} r="5" />
                    <g transform={`translate(${tooltipX.toFixed(2)} ${tooltipY.toFixed(2)})`}>
                      <rect width={tooltipWidth} height={tooltipHeight} rx="12" />
                      <text x="12" y="21">{hoveredReturnLabel}</text>
                      <text x="12" y="40">组合 {formatChartPercentValue(hoveredReturnPoint.cumulative_return_pct)}</text>
                      <text x="12" y="56">基准 {formatChartPercentValue(hoveredBenchmarkPoint?.cumulative_return_pct)}</text>
                      <text x="12" y="72">成本后 {formatChartPercentValue(hoveredCostDragValue)}</text>
                      <text x="12" y="88">超额 {formatChartPercentValue(hoveredSpreadPoint?.spread_pct)}</text>
                    </g>
                  </g>
                ) : null}
              </svg>
            </div>
            <div className="composition-detail-approved-bottom-tabs">
              <span className="chip chip--accent">组合净值</span>
              <span className="chip chip--asset">{benchmarkLabel} 虚线</span>
              <span className="chip chip--warning">成本拖累</span>
              <span className="chip">版本节点</span>
              <span className="chip chip--danger">回撤阴影</span>
            </div>
            <article className="composition-detail-approved-rebalance-card">
              <strong>当前裁决：{currentRulingLabel}</strong>
              <span>节点信息用于复核版本变化、调仓损耗、现金缓冲吸收比例与仓位变化。</span>
            </article>
          </section>

          <div className="composition-detail-approved-analysis-grid">
            <article className="panel composition-detail-panel composition-detail-exposure-drilldown" data-ui="composition-exposure-drilldown">
              <div className="panel-header composition-detail-panel__header">
                <div>
                  <h2>敞口穿透分析</h2>
                  <p className="composition-detail-panel__copy">物理持仓、代理暴露与现金规则分层展示。</p>
                </div>
              </div>
              <div className="composition-detail-exposure-list">
                {exposureDrilldownRows.map((item) => (
                  <article className="composition-detail-exposure-row" key={item.key}>
                    <strong>{item.source}</strong>
                    <span className={`status-chip status-chip--${item.tone === 'warn' ? 'warning' : item.tone === 'good' ? 'success' : 'soft'}`}>
                      {item.layer}
                    </span>
                    <p>{item.detail}</p>
                  </article>
                ))}
              </div>
            </article>

            <section className="panel composition-detail-panel" data-ui="risk-contribution-explanation">
              <div className="panel-header composition-detail-panel__header">
                <div>
                  <h2>风险归因</h2>
                  <p className="composition-detail-panel__copy">用收益贡献、协方差和久期暴露解释风险预算。</p>
                </div>
              </div>
              <div className="composition-detail-approved-snapshot-list">
                {alignedRiskContributions.map((item) => (
                  <article className="composition-detail-approved-snapshot-card" key={item.leg_id}>
                    <div className="composition-detail-approved-snapshot-head">
                      <strong>{legDisplayNameById.get(item.leg_id) ?? getDisplayText(item.label)}</strong>
                      <span className="status-chip status-chip--soft">{legTypeLabelById.get(item.leg_id) ?? '组合腿'}</span>
                    </div>
                    <div className="composition-detail-approved-risk-summary">
                      <span>{`权重 ${formatCompactPercent(item.weight_pct, 0)}`}</span>
                      <span>{`收益占比 ${formatFixedPercent(item.return_contribution_pct ?? 0)}`}</span>
                      <span>{`风险占比 ${formatFixedPercent(item.contribution_pct)}`}</span>
                    </div>
                    <div className={`composition-detail-approved-risk-track composition-detail-approved-risk-track--${getRiskTrackTone(item)}`}>
                      <span style={{ width: getRiskTrackWidth(item) }} />
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <section className="composition-detail-approved-maintenance-grid" data-ui="composition-maintenance-grid">
            <article className="panel composition-detail-panel composition-detail-version-evolution" data-ui="composition-version-evolution">
              <div className="panel-header composition-detail-panel__header">
                <div>
                  <h2>配置版本记录</h2>
                  <p className="composition-detail-panel__copy">按变更后版本倒序展示，卡片内保留权重、频次与成本口径。</p>
                </div>
              </div>
              <div className="composition-detail-compact-timeline">
                {versionEvolutionRows.map((item) => (
                  <article
                    className="composition-detail-compact-timeline__item"
                    data-version-after={item.versionAfter}
                    key={item.key}
                  >
                    <strong>{item.title}</strong>
                    <span>{item.detail}</span>
                    <small>{item.meta}</small>
                  </article>
                ))}
              </div>
            </article>

            <section className="panel composition-detail-panel">
              <div className="panel-header composition-detail-panel__header">
                <div>
                  <h2>相关性矩阵</h2>
                  <p className="composition-detail-panel__copy">常态相关性看分散度，压力相关性看同步风险。</p>
                </div>
              </div>
              <div className="composition-detail-correlation-toolbar">
                <div className="composition-detail-approved-chip-row" role="tablist" aria-label="相关性模式">
                  {([
                    ['current', '常态相关性'],
                    ['stress', '压力相关性'],
                  ] as Array<[CorrelationMode, string]>).map(([mode, label]) => (
                    <button
                      aria-selected={correlationMode === mode}
                      className={correlationMode === mode ? 'chip chip--accent' : 'chip'}
                      key={mode}
                      onClick={() => setCorrelationMode(mode)}
                      role="tab"
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div
                className="composition-detail-approved-heatmap composition-detail-correlation-matrix"
                aria-label="相关性热力矩阵"
                style={{ gridTemplateColumns: `92px repeat(${Math.max(detail.normalized_legs.length, 1)}, minmax(0, 1fr))` }}
              >
                <span aria-hidden="true" className="composition-detail-correlation-axis composition-detail-correlation-axis--corner" />
                {detail.normalized_legs.map((column) => (
                  <span
                    className="composition-detail-correlation-axis composition-detail-correlation-axis--column"
                    key={`column-${column.id}`}
                    title={legDisplayNameById.get(column.id) ?? getDisplayText(column.display_name)}
                  >
                    {legDisplayNameById.get(column.id) ?? getDisplayText(column.display_name)}
                  </span>
                ))}
                {detail.normalized_legs.flatMap((row) => [
                  <span
                    className="composition-detail-correlation-axis composition-detail-correlation-axis--row"
                    key={`row-${row.id}`}
                    title={legDisplayNameById.get(row.id) ?? getDisplayText(row.display_name)}
                  >
                    {legDisplayNameById.get(row.id) ?? getDisplayText(row.display_name)}
                  </span>,
                  ...detail.normalized_legs.map((column) => {
                    const value = correlationLookup.get(buildMatrixKey(row.id, column.id)) ?? 0;
                    const text = value.toFixed(2);
                    return (
                      <span className={`${getApprovedMatrixTone(text)} composition-detail-correlation-cell`} key={`${row.id}::${column.id}`}>
                        {text}
                      </span>
                    );
                  }),
                ])}
              </div>
            </section>
          </section>
        </div>

        <aside className="composition-detail-rail">
          <section
            className="panel composition-detail-panel composition-detail-rail-panel composition-detail-source-signature"
            aria-label="配置指纹"
            data-ui="source-signature-rail"
          >
            <div className="panel-header composition-detail-panel__header">
              <div>
                <h2>配置指纹</h2>
                <p className="composition-detail-panel__copy">冻结证据与当前版本对照，仅提示漂移。</p>
              </div>
              <span className={driftCount ? 'status-chip status-chip--warning' : 'status-chip status-chip--success'}>
                {driftCount ? `${driftCount} 个漂移` : '已冻结'}
              </span>
            </div>
            {driftCount ? (
              <article className="composition-detail-alert-card composition-detail-source-drift-alert" data-ui="source-drift-alert">
                <strong>发现配置漂移</strong>
                <span>详情仍按冻结证据读取；采用当前版本需重新生成配置。</span>
              </article>
            ) : null}
            <div className="composition-detail-evidence-list">
              {sortedSourceEvidence.map((evidence) => {
                const integrity = sourceIntegrityByLegId.get(evidence.leg_id);
                return (
                  <button
                    className={`composition-detail-evidence-card composition-detail-approved-source-card${selectedLegId === evidence.leg_id ? ' is-active' : ''}`}
                    key={evidence.id}
                    onClick={() => {
                      setSelectedEvidenceId(null);
                      setSelectedLegId(evidence.leg_id);
                    }}
                    type="button"
                  >
                    <div className="composition-detail-approved-snapshot-head">
                      <strong>{legDisplayNameById.get(evidence.leg_id) ?? formatLegDisplayName({ display_name: evidence.display_name })}</strong>
                      <span className="status-chip status-chip--soft">{legTypeLabelById.get(evidence.leg_id) ?? getLegTypeLabel(getEvidenceLegKind(evidence))}</span>
                    </div>
                    <span className="composition-detail-shield">配置指纹 {getEvidenceHashLabel(evidence.freeze_hash)}</span>
                    <div className="composition-detail-approved-source-line">
                      <span>{getIntegrityStatusLabel(integrity?.drift_status ?? evidence.drift_status)}</span>
                      <span>{getEvidenceCurrentLabel(evidence, integrity)}</span>
                    </div>
                    <small>{getSourceAlertText((integrity?.alerts ?? evidence.alerts ?? [])[0])}</small>
                  </button>
                );
              })}
            </div>
          </section>

          <section
            className="panel composition-detail-panel composition-detail-rail-panel composition-detail-execution-history"
            aria-label="组合回测历史"
            data-ui="composition-execution-history"
          >
            <div className="panel-header composition-detail-panel__header">
              <div>
                <h2>组合回测历史</h2>
                <p className="composition-detail-panel__copy">记录版本、周期、年化与夏普，并直达回测和订单。</p>
              </div>
            </div>
            <div className="composition-detail-execution-list">
              {executionHistoryRows.length ? (
                executionHistoryRows.map((row) => (
                  <article className="composition-detail-execution-row" key={row.key}>
                    <div>
                      <strong>{row.dateLabel} · {row.versionLabel}</strong>
                      <span>{`${row.periodLabel} / 年化 ${row.annualizedLabel} / 夏普 ${row.sharpeLabel}`}</span>
                    </div>
                    <div className="composition-detail-execution-actions">
                      <a href={getCompositionRunHashPath(detail.id, row.runId)}>回测记录</a>
                      <a href={getCompositionRunHashPath(detail.id, row.runId, 'orders')}>订单日志</a>
                    </div>
                  </article>
                ))
              ) : (
                <article className="composition-detail-execution-row composition-detail-execution-row--empty">
                  <div>
                    <strong>尚未绑定组合回测记录</strong>
                    <span>保存后的组合回测会在这里显示 `10Y / 年化 / 夏普` 摘要。</span>
                  </div>
                </article>
              )}
            </div>
          </section>

          <section className="panel composition-detail-panel composition-detail-rail-panel" aria-label="再平衡与成本">
            <div className="panel-header composition-detail-panel__header">
              <div>
                <h2>再平衡与成本</h2>
                <p className="composition-detail-panel__copy">合并窗口、成本与维护判断，保留一屏内可扫读。</p>
              </div>
            </div>
            <div className="composition-detail-cost-compact" data-ui="composition-rebalance-cost-compact">
              <article className="composition-detail-cost-card composition-detail-cost-card--compact">
                <div className="composition-detail-cost-list">
                  <strong>距离下一个再平衡窗口</strong>
                  <span>{rebalanceRemaining} 天</span>
                </div>
                <div className="composition-detail-progress">
                  <span style={{ width: `${rebalanceProgress}%` }} />
                </div>
                <div className="composition-detail-cost-mini-grid">
                  <span>
                    <small>预计成本</small>
                    <strong>{detail.maintenance_cost_summary.total_estimated_bps.toFixed(0)} bps</strong>
                  </span>
                  <span>
                    <small>频次</small>
                    <strong>{getCadenceLabel(detail.rebalance_frequency)}</strong>
                  </span>
                  <span className="composition-detail-cost-mini-grid__wide">
                    <small>维护判断</small>
                    <strong>{currentRulingLabel}</strong>
                  </span>
                </div>
                <p>
                  {highCorrelationPairs.length
                    ? '存在高相关腿组合，窗口前先复核压力相关性与换手预算。'
                    : getNarrativeText(detail.maintenance_cost_summary.notes[0], '现金缓冲吸收窗口前后的换手冲击，当前结构可继续观察。')}
                </p>
              </article>
            </div>
          </section>

          <section
            className="panel composition-detail-panel composition-detail-rail-panel composition-detail-audit-trail"
            aria-label="操作日志"
            data-ui="composition-audit-trail"
          >
            <div className="panel-header composition-detail-panel__header">
              <div>
                <h2>操作日志</h2>
                <p className="composition-detail-panel__copy">记录创建、结构调整、状态切换与来源检查，便于机构用户回看责任链。</p>
              </div>
            </div>
            <div className="composition-detail-audit-list">
              {auditTrail.length ? (
                auditTrail.slice(0, 4).map((item) => (
                  <article className="composition-detail-audit-card" key={item.id}>
                    <strong>{getAuditActionLabel(item.action)}</strong>
                    <span>{formatDateTime(item.at)} · {getAuditActorLabel(item.actor)}</span>
                    <p>{getAuditSummaryText(item.summary)}</p>
                    {item.hash_after ? <small>配置指纹 {getEvidenceHashLabel(item.hash_after)}</small> : null}
                  </article>
                ))
              ) : (
                <article className="composition-detail-audit-card">
                  <strong>暂无操作记录</strong>
                  <span>保存或检查来源后会自动写入操作日志。</span>
                </article>
              )}
            </div>
          </section>
        </aside>
      </div>

      {selectedEvidence ? (
        <div className="composition-detail-drawer-shell" onClick={() => setSelectedEvidenceId(null)} role="presentation">
          <aside
            aria-label="来源冻结详情"
            className="composition-detail-drawer"
            data-ui="source-evidence-drawer"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="composition-detail-drawer__header">
              <div>
                <p className="page-heading__eyebrow">来源冻结</p>
                <h2>{legDisplayNameById.get(selectedEvidence.leg_id) ?? formatLegDisplayName({ display_name: selectedEvidence.display_name })}</h2>
                <p>{getEvidenceKindLabel(selectedEvidence.freeze_ref_type)}</p>
              </div>
              <button className="ghost-button" onClick={() => setSelectedEvidenceId(null)} type="button">关闭</button>
            </div>
            <div className="composition-detail-drawer__summary">
              <span className="composition-detail-shield">配置指纹 {getEvidenceHashLabel(selectedEvidence.freeze_hash)}</span>
              <span>{formatDateTime(selectedEvidence.captured_at)}</span>
              <span>{getEvidenceStatusLabel(selectedEvidence)}</span>
              {selectedEvidence.current_ref_id ? <span>当前来源 {selectedEvidence.current_ref_id}</span> : null}
            </div>
            <div className="composition-detail-drawer__grid">
              {getDrawerRows(selectedEvidence).map(([label, value]) => (
                <div className="composition-detail-drawer__cell" key={`${label}-${value}`}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </aside>
        </div>
      ) : null}
      {selectedLegRow ? (
        <LegDetailDrawer
          hideMutatingActions
          onArchiveCandidate={ignoreCompositionLegArchive}
          onClose={() => setSelectedLegId(null)}
          onCopyCandidate={ignoreCompositionLegMutation}
          onNavigateToSource={navigateToCompositionLegSource}
          onRequestCopyNewVersion={ignoreCompositionLegVersionCopy}
          row={selectedLegRow}
        />
      ) : null}
    </div>
  );
}

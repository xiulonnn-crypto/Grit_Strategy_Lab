import { useMemo, useRef, useState } from 'react';
import { formatShortDate } from '../lib/format';
import type { ApiBacktestRunDetail, ApiBacktestChartPoint } from '../types';

type ViewWindow = 'all' | '1y' | '3y';
type RunDetailTab = 'diagnostics' | 'trades' | 'evidence' | 'properties';
type TrendDirection = 'up' | 'down' | 'flat';
type InsightTone = 'teal' | 'blue' | 'warm' | 'gray' | 'positive' | 'warning' | 'neutral' | 'critical';

type RunDetailOverviewProps = {
  detail: ApiBacktestRunDetail;
  windowRange: ViewWindow;
  activeTab: RunDetailTab;
  onWindowRangeChange: (windowRange: ViewWindow) => void;
  onTabChange: (tab: RunDetailTab) => void;
};

type ApiRunDetailKpiCard = {
  key: string;
  label: string;
  primary_text: string;
  trend_direction?: TrendDirection;
  trend_text?: string;
  compare_text?: string;
  insight_text?: string;
  insight_tone?: InsightTone;
  state?: string;
};

type ApiRunDetailDecisionItem = {
  title?: string;
  body?: string;
  tone?: 'green' | 'orange' | 'blue' | 'neutral';
  label?: string;
  description?: string;
};

type ApiRunDetailDecisionRail = {
  score?: number;
  label?: string;
  items?: ApiRunDetailDecisionItem[];
};

type RunDetailAnalysis = {
  subtitle?: string;
  kpi_cards?: ApiRunDetailKpiCard[];
  decision_rail?: ApiRunDetailDecisionRail;
};

type Bounds = {
  min: number;
  max: number;
};

type ChartPadding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

function formatSmartPercent(value: number | null | undefined, digits = 1): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  const normalized = Math.abs(value) > 1 ? value : value * 100;
  return `${normalized >= 0 ? '+' : ''}${normalized.toFixed(digits)}%`;
}

function formatRatioPercent(value: number | null | undefined, digits = 1): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  const normalized = value * 100;
  return `${normalized >= 0 ? '+' : ''}${normalized.toFixed(digits)}%`;
}

function formatSmartNumber(value: number | null | undefined, digits = 2): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  return value.toFixed(digits);
}

function formatSmartInteger(value: number | null | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  return Math.round(value).toLocaleString('zh-HK');
}

function getAnalysis(detail: ApiBacktestRunDetail): RunDetailAnalysis | undefined {
  return (detail as ApiBacktestRunDetail & { analysis?: RunDetailAnalysis }).analysis;
}

function latestMetric(points: Array<Record<string, unknown>> | undefined, key: string): number | null {
  if (!points?.length) {
    return null;
  }
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const value = points[index]?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function calculateSharpe(points: ApiBacktestChartPoint[], selector: (point: ApiBacktestChartPoint) => number): number | null {
  if (points.length < 2) {
    return null;
  }
  const returns: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = selector(points[index - 1]);
    const current = selector(points[index]);
    if (!previous || !current || !Number.isFinite(previous) || !Number.isFinite(current)) {
      continue;
    }
    returns.push(current / previous - 1);
  }
  if (!returns.length) {
    return null;
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  const stdev = Math.sqrt(variance);
  if (!stdev) {
    return null;
  }
  return (mean / stdev) * Math.sqrt(252);
}

function calculateTotalReturn(points: ApiBacktestChartPoint[], selector: (point: ApiBacktestChartPoint) => number): number | null {
  if (points.length < 2) {
    return null;
  }
  const first = selector(points[0]);
  const last = selector(points[points.length - 1]);
  if (!first || !last || !Number.isFinite(first) || !Number.isFinite(last)) {
    return null;
  }
  return last / first - 1;
}

function calculateWindowReturn(
  points: ApiBacktestChartPoint[],
  selector: (point: ApiBacktestChartPoint) => number,
  window: number,
): number | null {
  if (points.length <= window) {
    return null;
  }
  const previous = selector(points[points.length - window - 1]);
  const current = selector(points[points.length - 1]);
  if (!previous || !current || !Number.isFinite(previous) || !Number.isFinite(current)) {
    return null;
  }
  return current / previous - 1;
}

function calculateWindowSharpe(
  points: ApiBacktestChartPoint[],
  selector: (point: ApiBacktestChartPoint) => number,
  window: number,
): number | null {
  if (points.length <= window) {
    return null;
  }
  return calculateSharpe(points.slice(points.length - window - 1), selector);
}

function calculateDrawdown(points: number[]): number | null {
  if (!points.length) {
    return null;
  }
  let peak = points[0];
  let maxDrawdown = 0;
  for (const value of points) {
    peak = Math.max(peak, value);
    const drawdown = peak ? value / peak - 1 : 0;
    maxDrawdown = Math.min(maxDrawdown, drawdown);
  }
  return maxDrawdown;
}

function buildFallbackKpis(detail: ApiBacktestRunDetail): ApiRunDetailKpiCard[] {
  const chartSeries = detail.chart_series ?? [];
  const strategyTotalReturn = calculateTotalReturn(chartSeries, (point) => point.equity);
  const benchmarkTotalReturn = calculateTotalReturn(chartSeries, (point) => point.benchmark);
  const strategySharpe = calculateSharpe(chartSeries, (point) => point.equity);
  const benchmarkSharpe = calculateSharpe(chartSeries, (point) => point.benchmark);
  const rollingWindow = 252;
  const latestRollingReturn = calculateWindowReturn(chartSeries, (point) => point.equity, rollingWindow);
  const benchmarkRollingReturn = calculateWindowReturn(chartSeries, (point) => point.benchmark, rollingWindow);
  const latestRollingSharpe = calculateWindowSharpe(chartSeries, (point) => point.equity, rollingWindow);
  const benchmarkDrawdown = calculateDrawdown(chartSeries.map((point) => point.benchmark));
  const tradeItems = detail.trades?.length
    ? detail.trades
    : detail.trade_details?.length
      ? detail.trade_details
      : detail.trade_audit_items ?? [];
  const isTradesCount = tradeItems.filter((item) => item.segment === 'IS').length;
  const oosTradesCount = tradeItems.filter((item) => item.segment === 'OOS').length;

  return [
    {
      key: 'total_return',
      label: '总收益',
      primary_text: formatRatioPercent(strategyTotalReturn),
      trend_direction:
        typeof strategyTotalReturn === 'number' && typeof benchmarkTotalReturn === 'number'
          ? strategyTotalReturn >= benchmarkTotalReturn
            ? 'up'
            : 'down'
          : 'flat',
      trend_text:
        typeof strategyTotalReturn === 'number' && typeof benchmarkTotalReturn === 'number'
          ? `差值: ${formatRatioPercent(strategyTotalReturn - benchmarkTotalReturn)}`
          : '暂无基准',
      compare_text: `基准: ${formatRatioPercent(benchmarkTotalReturn)}`,
      insight_text: '收益稳定，建议继续核查 Beta 暴露是否偏高。',
      insight_tone: 'teal',
    },
    {
      key: 'sharpe',
      label: '夏普比率',
      primary_text: formatSmartNumber(strategySharpe),
      trend_direction:
        typeof strategySharpe === 'number' && typeof benchmarkSharpe === 'number'
          ? strategySharpe >= benchmarkSharpe
            ? 'up'
            : 'down'
          : 'flat',
      trend_text:
        typeof strategySharpe === 'number' && typeof benchmarkSharpe === 'number'
          ? `差值: ${formatSmartNumber(strategySharpe - benchmarkSharpe)}`
          : '暂无基准',
      compare_text: `基准: ${formatSmartNumber(benchmarkSharpe)}`,
      insight_text: '若波动偏大，可尝试增加低相关性过滤因子。',
      insight_tone: 'blue',
    },
    {
      key: 'max_drawdown',
      label: '最大回撤',
      primary_text: formatRatioPercent(detail.metrics.max_drawdown),
      trend_direction:
        typeof detail.metrics.max_drawdown === 'number' && typeof benchmarkDrawdown === 'number'
          ? Math.abs(detail.metrics.max_drawdown) <= Math.abs(benchmarkDrawdown)
            ? 'down'
            : 'up'
          : 'flat',
      trend_text:
        typeof detail.metrics.max_drawdown === 'number' && typeof benchmarkDrawdown === 'number'
          ? `差值: ${formatRatioPercent(detail.metrics.max_drawdown - benchmarkDrawdown)}`
          : '暂无基准',
      compare_text: `基准: ${formatRatioPercent(benchmarkDrawdown)}`,
      insight_text: '若回撤放大，优先核查平仓逻辑与止损设置。',
      insight_tone: 'warm',
    },
    {
      key: 'rolling_return',
      label: '最新 252 日滚动收益',
      primary_text: formatSmartPercent(latestRollingReturn),
      trend_direction: 'flat',
      trend_text: latestRollingSharpe === null ? '样本不足' : `Sharpe ${formatSmartNumber(latestRollingSharpe)}`,
      compare_text:
        benchmarkRollingReturn === null ? '基准: 样本窗口不足' : `基准: ${formatSmartPercent(benchmarkRollingReturn)}`,
      insight_text: '窗口偏短时，应延长样本区间再做稳健判断。',
      insight_tone: 'gray',
      state: latestRollingReturn === null ? 'insufficient_data' : 'ok',
    },
    {
      key: 'trade_count',
      label: '交易数',
      primary_text: formatSmartInteger(detail.trades_count),
      trend_direction: oosTradesCount < 20 ? 'down' : 'flat',
      trend_text: `测试集 ${oosTradesCount} 笔`,
      compare_text: `训练集 ${isTradesCount} | 测试集 ${oosTradesCount}`,
      insight_text: oosTradesCount < 20 ? '样本量偏小，警惕随机性导致的过拟合。' : '样本量基本可读，建议结合证据页继续下钻。',
      insight_tone: oosTradesCount < 20 ? 'warm' : 'teal',
    },
  ];
}

function buildFallbackDecisionRail(detail: ApiBacktestRunDetail): ApiRunDetailDecisionRail {
  const score = Math.max(0, Math.min(100, Math.round((detail.metrics.sharpe ?? 0) * 20 + 50)));
  return {
    score,
    label: '综合判断',
    items: [
      {
        title: '结果判断',
        body: typeof detail.metrics.total_return === 'number' ? `当前累计收益为 ${formatRatioPercent(detail.metrics.total_return)}，仍需结合测试集稳定性判断是否可延续。` : '当前收益信号有限，需先补齐核心数据。',
        tone: 'green',
      },
      {
        title: '风险判断',
        body: typeof detail.metrics.max_drawdown === 'number' ? `最大回撤为 ${formatRatioPercent(detail.metrics.max_drawdown)}，请重点检查最近一段回撤修复节奏。` : '当前缺少完整风控判断信息。',
        tone: 'blue',
      },
      {
        title: '下一步动作',
        body: '优先查看测试集交易与证据链，再决定是否进入下一轮调参。',
        tone: 'orange',
      },
    ],
  };
}

function buildFallbackDecisionRailFromCurves(detail: ApiBacktestRunDetail): ApiRunDetailDecisionRail {
  const chartSeries = detail.chart_series ?? [];
  const strategyTotalReturn = calculateTotalReturn(chartSeries, (point) => point.equity) ?? detail.metrics.total_return ?? 0;
  const benchmarkTotalReturn = calculateTotalReturn(chartSeries, (point) => point.benchmark) ?? 0;
  const strategySharpe = calculateSharpe(chartSeries, (point) => point.equity) ?? detail.metrics.sharpe ?? 0;
  const strategyDrawdown = calculateDrawdown(chartSeries.map((point) => point.equity)) ?? detail.metrics.max_drawdown ?? 0;
  const score = Math.max(0, Math.min(100, Math.round(strategySharpe * 20 + 50)));

  return {
    score,
    label: '综合判断',
    items: [
      {
        title: '结果判断',
        body:
          chartSeries.length > 1
            ? `当前累计收益为 ${formatRatioPercent(strategyTotalReturn)}，基准为 ${formatRatioPercent(benchmarkTotalReturn)}，请结合测试集稳定性判断是否继续放大。`
            : '当前样本不足，建议先补齐净值曲线后再判断累计收益质量。',
        tone: 'green',
      },
      {
        title: '风险判断',
        body:
          chartSeries.length > 1
            ? `当前最大回撤为 ${formatRatioPercent(strategyDrawdown)}，请重点检查最近一段回撤修复节奏。`
            : '当前样本不足，建议补齐曲线后再检查回撤与波动表现。',
        tone: 'blue',
      },
      {
        title: '下一步动作',
        body: '优先查看测试集交易与证据链，再决定是否进入下一轮调参。',
        tone: 'orange',
      },
    ],
  };
}

function filterSeries(detail: ApiBacktestRunDetail, windowRange: ViewWindow): ApiBacktestChartPoint[] {
  const series = detail.chart_series ?? [];
  if (!series.length || windowRange === 'all') {
    return series;
  }
  const limit = windowRange === '1y' ? 252 : 756;
  return series.slice(Math.max(0, series.length - limit));
}

function normalizeCurve(points: number[]): number[] {
  if (!points.length) {
    return [];
  }
  const base = points[0] || 1;
  return points.map((point) => (point / base) * 100);
}

function resolvePadding(padding: number | ChartPadding): ChartPadding {
  if (typeof padding === 'number') {
    return { top: padding, right: padding, bottom: padding, left: padding };
  }
  return padding;
}

function getBounds(seriesList: number[][]): Bounds {
  const values = seriesList.flat().filter((value) => Number.isFinite(value));
  if (!values.length) {
    return { min: 0, max: 1 };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return { min: min - 1, max: max + 1 };
  }
  return { min, max };
}

function getXCoordinate(index: number, pointCount: number, width: number, padding: number | ChartPadding): number {
  const resolvedPadding = resolvePadding(padding);
  const usableWidth = width - resolvedPadding.left - resolvedPadding.right;
  return resolvedPadding.left + (usableWidth * (pointCount === 1 ? 0 : index)) / Math.max(pointCount - 1, 1);
}

function getYCoordinate(value: number, height: number, padding: number | ChartPadding, bounds: Bounds): number {
  const resolvedPadding = resolvePadding(padding);
  const usableHeight = height - resolvedPadding.top - resolvedPadding.bottom;
  return resolvedPadding.top + ((bounds.max - value) / Math.max(bounds.max - bounds.min, 1)) * usableHeight;
}

function getPath(points: number[], width: number, height: number, padding: number | ChartPadding, bounds: Bounds): string {
  if (!points.length) {
    return '';
  }
  return points
    .map((point, index) => {
      const x = getXCoordinate(index, points.length, width, padding);
      const y = getYCoordinate(point, height, padding, bounds);
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

function getAreaPath(points: number[], width: number, height: number, padding: number | ChartPadding, bounds: Bounds): string {
  if (!points.length) {
    return '';
  }
  const resolvedPadding = resolvePadding(padding);
  const line = getPath(points, width, height, padding, bounds);
  const firstX = resolvedPadding.left;
  const lastX = width - resolvedPadding.right;
  const baseY = height - resolvedPadding.bottom;
  return `${line} L ${lastX.toFixed(2)} ${baseY.toFixed(2)} L ${firstX.toFixed(2)} ${baseY.toFixed(2)} Z`;
}

function buildAxisTicks(bounds: Bounds, count = 5): number[] {
  if (count <= 1) {
    return [bounds.max];
  }
  const range = bounds.max - bounds.min;
  return Array.from({ length: count }, (_, index) => bounds.max - (range * index) / (count - 1));
}

function buildDateTicks(series: ApiBacktestChartPoint[], count = 4): Array<{ index: number; label: string }> {
  if (!series.length) {
    return [];
  }
  const candidates = Array.from({ length: count }, (_, tickIndex) =>
    Math.round(((series.length - 1) * tickIndex) / Math.max(count - 1, 1)),
  );
  return [...new Set(candidates)].map((index) => ({
    index,
    label: formatShortDate(series[index]?.trade_date ?? ''),
  }));
}

function formatAxisLabel(value: number): string {
  const relative = value - 100;
  return `${relative >= 0 ? '+' : ''}${relative.toFixed(Math.abs(relative) >= 10 ? 0 : 1)}%`;
}

function normalizeInsightTone(tone: InsightTone | undefined): InsightTone {
  if (!tone) {
    return 'gray';
  }

  switch (tone) {
    case 'positive':
    case 'warning':
    case 'neutral':
    case 'critical':
    case 'teal':
    case 'blue':
    case 'warm':
    case 'gray':
      return tone;
    default:
      return 'gray';
  }
}

export function RunDetailOverviewSection({
  detail,
  windowRange,
  activeTab,
  onWindowRangeChange,
  onTabChange,
}: RunDetailOverviewProps): JSX.Element {
  const analysis = getAnalysis(detail);
  const kpiCards = analysis?.kpi_cards?.length ? analysis.kpi_cards : buildFallbackKpis(detail);
  const decisionRail = analysis?.decision_rail?.items?.length
    ? analysis.decision_rail
    : buildFallbackDecisionRailFromCurves(detail);
  const subtitle = analysis?.subtitle ?? '主图保留训练集与测试集切换关系，先判断，再决定是否继续下钻。';
  const series = useMemo(() => filterSeries(detail, windowRange), [detail, windowRange]);
  const equityValues = useMemo(() => normalizeCurve(series.map((point) => point.equity)), [series]);
  const benchmarkValues = useMemo(() => normalizeCurve(series.map((point) => point.benchmark)), [series]);
  const bounds = useMemo(() => getBounds([equityValues, benchmarkValues]), [equityValues, benchmarkValues]);
  const axisTicks = useMemo(() => buildAxisTicks(bounds), [bounds]);
  const dateTicks = useMemo(() => buildDateTicks(series), [series]);
  const oosStartIndex = useMemo(() => series.findIndex((point) => point.is_oos), [series]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const fullscreenRef = useRef<HTMLElement | null>(null);
  const chartWidth = 960;
  const chartHeight = 360;
  const chartPadding: ChartPadding = { top: 28, right: 28, bottom: 44, left: 64 };
  const activeIndex = hoveredIndex === null ? Math.max(series.length - 1, 0) : Math.min(hoveredIndex, Math.max(series.length - 1, 0));
  const hoveredPoint = series[activeIndex];
  const hoveredEquity = equityValues[activeIndex];
  const hoveredBenchmark = benchmarkValues[activeIndex];
  const tooltipX = hoveredPoint ? getXCoordinate(activeIndex, series.length, chartWidth, chartPadding) : chartPadding.left;
  const tooltipY = hoveredPoint ? getYCoordinate(hoveredEquity ?? 100, chartHeight, chartPadding, bounds) : chartPadding.top;

  async function handleFullscreen(): Promise<void> {
    const container = fullscreenRef.current;
    if (!container || typeof container.requestFullscreen !== 'function') {
      return;
    }
    if (document.fullscreenElement === container) {
      await document.exitFullscreen();
      return;
    }
    await container.requestFullscreen();
  }

  const tabs: Array<{ key: RunDetailTab; label: string }> = [
    { key: 'diagnostics', label: '诊断' },
    { key: 'trades', label: '交易' },
    { key: 'evidence', label: '证据' },
    { key: 'properties', label: '配置' },
  ];

  return (
    <div className="run-detail-overview-stack">
      <section className="panel run-detail-kpi-panel">
        <div className="run-detail-kpi-grid run-detail-kpi-grid--five">
          {kpiCards.slice(0, 5).map((card) => {
            const trendDirection = card.trend_direction ?? 'flat';
            const insightTone = normalizeInsightTone(card.insight_tone);
            const trendArrow = trendDirection === 'up' ? '↑' : trendDirection === 'down' ? '↓' : '→';
            return (
              <article className="run-detail-kpi-card" key={card.key}>
                <div className="run-detail-kpi-card__head">
                  <span className="run-detail-kpi-card__label">{card.label}</span>
                  <button aria-label={`${card.label} 指标说明`} className="run-detail-kpi-card__hint" type="button">
                    ?
                  </button>
                </div>
                <div className="run-detail-kpi-card__core">
                  <strong>{card.primary_text}</strong>
                  <span className={`run-detail-kpi-card__trend run-detail-kpi-card__trend--${trendDirection}`}>
                    <span aria-hidden="true">{trendArrow}</span>
                    {card.trend_text ?? '暂无变化'}
                  </span>
                </div>
                <div className="run-detail-kpi-card__compare">{card.compare_text ?? '暂无对比'}</div>
                <div className={`run-detail-kpi-card__insight run-detail-kpi-card__insight--${insightTone}`}>
                  {card.insight_text ?? '暂无优化建议'}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="run-detail-main-grid">
        <section className="panel run-detail-curve-card run-detail-curve-card--overview" ref={fullscreenRef}>
          <div className="panel-header">
            <div>
              <h3>业绩曲线</h3>
              <p className="run-detail-section-copy">{subtitle}</p>
            </div>
            <div className="run-detail-window-switcher" role="tablist" aria-label="绩效区间筛选">
              {([
                ['all', '全部'],
                ['1y', '最近1年'],
                ['3y', '最近3年'],
              ] as const).map(([value, label]) => (
                <button
                  aria-pressed={windowRange === value}
                  className={windowRange === value ? 'ghost-button ghost-button--active' : 'ghost-button'}
                  key={value}
                  onClick={() => onWindowRangeChange(value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="run-detail-chart-copy">
            <span>
              训练集 {series[0] ? formatShortDate(series[0].trade_date) : '—'} 至{' '}
              {series[oosStartIndex > 0 ? oosStartIndex - 1 : Math.max(series.length - 1, 0)] ? formatShortDate(series[oosStartIndex > 0 ? oosStartIndex - 1 : Math.max(series.length - 1, 0)].trade_date) : '—'}
            </span>
            <span className="run-detail-chart-copy--accent">
              {oosStartIndex >= 0 && series[oosStartIndex]
                ? `测试集 ${formatShortDate(series[oosStartIndex].trade_date)} 至 ${formatShortDate(series[series.length - 1]?.trade_date ?? series[oosStartIndex].trade_date)}`
                : '无测试集分区'}
            </span>
          </div>

          <div className="run-detail-chart-frame run-detail-chart-frame--interactive">
            {series.length ? (
              <>
                <svg className="run-detail-line-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none" role="img" aria-label="业绩曲线">
                  <defs>
                    <linearGradient id="run-detail-equity-fill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="rgba(31, 135, 123, 0.18)" />
                      <stop offset="100%" stopColor="rgba(31, 135, 123, 0.02)" />
                    </linearGradient>
                    <clipPath id="run-detail-chart-clip">
                      <rect
                        height={chartHeight - chartPadding.top - chartPadding.bottom}
                        width={chartWidth - chartPadding.left - chartPadding.right}
                        x={chartPadding.left}
                        y={chartPadding.top}
                      />
                    </clipPath>
                  </defs>
                  {axisTicks.map((tick) => {
                    const y = getYCoordinate(tick, chartHeight, chartPadding, bounds);
                    return (
                      <g key={`overview-y-${tick.toFixed(2)}`}>
                        <line className="run-detail-chart-grid-line" x1={chartPadding.left} x2={chartWidth - chartPadding.right} y1={y} y2={y} />
                        <text className="run-detail-chart-axis-label" textAnchor="end" x={chartPadding.left - 10} y={y + 4}>
                          {formatAxisLabel(tick)}
                        </text>
                      </g>
                    );
                  })}
                  {dateTicks.map((tick, tickIndex) => {
                    const x = getXCoordinate(tick.index, series.length, chartWidth, chartPadding);
                    const textAnchor = tickIndex === 0 ? 'start' : tickIndex === dateTicks.length - 1 ? 'end' : 'middle';
                    return (
                      <g key={`overview-x-${tick.index}`}>
                        <line className="run-detail-chart-grid-line run-detail-chart-grid-line--vertical" x1={x} x2={x} y1={chartPadding.top} y2={chartHeight - chartPadding.bottom} />
                        <text className="run-detail-chart-axis-label run-detail-chart-axis-label--x" textAnchor={textAnchor} x={x} y={chartHeight - 12}>
                          {tick.label}
                        </text>
                      </g>
                    );
                  })}
                  <g clipPath="url(#run-detail-chart-clip)">
                    {oosStartIndex >= 0 ? (
                      <>
                        <rect
                          className="run-detail-chart-test-fill"
                          height={chartHeight - chartPadding.top - chartPadding.bottom}
                          width={chartWidth - chartPadding.right - getXCoordinate(oosStartIndex, series.length, chartWidth, chartPadding)}
                          x={getXCoordinate(oosStartIndex, series.length, chartWidth, chartPadding)}
                          y={chartPadding.top}
                        />
                        <line
                          className="run-detail-chart-phase-rail"
                          x1={getXCoordinate(oosStartIndex, series.length, chartWidth, chartPadding)}
                          x2={getXCoordinate(oosStartIndex, series.length, chartWidth, chartPadding)}
                          y1={chartPadding.top}
                          y2={chartHeight - chartPadding.bottom}
                        />
                      </>
                    ) : null}
                    <path className="run-detail-area-path" d={getAreaPath(equityValues, chartWidth, chartHeight, chartPadding, bounds)} fill="url(#run-detail-equity-fill)" />
                    <path className="run-detail-benchmark-path" d={getPath(benchmarkValues, chartWidth, chartHeight, chartPadding, bounds)} />
                    <path className="run-detail-equity-path" d={getPath(equityValues, chartWidth, chartHeight, chartPadding, bounds)} />
                    {hoveredPoint ? (
                      <>
                        <line
                          className="run-detail-chart-hover-rail"
                          x1={tooltipX}
                          x2={tooltipX}
                          y1={chartPadding.top}
                          y2={chartHeight - chartPadding.bottom}
                        />
                        <circle className="run-detail-chart-hover-point" cx={tooltipX} cy={getYCoordinate(hoveredEquity, chartHeight, chartPadding, bounds)} r={4.5} />
                      </>
                    ) : null}
                  </g>
                  {oosStartIndex >= 0 ? (
                    <g>
                      <rect
                        className="run-detail-chart-phase-pill"
                        height="28"
                        rx="14"
                        width="84"
                        x={Math.max(chartPadding.left + 8, Math.min(getXCoordinate(oosStartIndex, series.length, chartWidth, chartPadding) - 42, chartWidth - chartPadding.right - 84))}
                        y={10}
                      />
                      <text
                        className="run-detail-chart-phase-label"
                        textAnchor="middle"
                        x={Math.max(chartPadding.left + 50, Math.min(getXCoordinate(oosStartIndex, series.length, chartWidth, chartPadding), chartWidth - chartPadding.right - 42))}
                        y={29}
                      >
                        测试集
                      </text>
                    </g>
                  ) : null}
                  <rect
                    fill="transparent"
                    height={chartHeight - chartPadding.top - chartPadding.bottom}
                    onMouseLeave={() => setHoveredIndex(null)}
                    onMouseMove={(event) => {
                      const target = event.currentTarget;
                      const rect = target.getBoundingClientRect();
                      const offsetX = event.clientX - rect.left;
                      const ratio = Math.max(0, Math.min(1, offsetX / Math.max(rect.width, 1)));
                      setHoveredIndex(Math.round(ratio * Math.max(series.length - 1, 0)));
                    }}
                    width={chartWidth - chartPadding.left - chartPadding.right}
                    x={chartPadding.left}
                    y={chartPadding.top}
                  />
                </svg>

                {hoveredPoint ? (
                  <div
                    className="run-detail-chart-tooltip"
                    style={{
                      left: `${Math.max(18, Math.min(((tooltipX / chartWidth) * 100), 82))}%`,
                      top: `${Math.max(16, ((tooltipY / chartHeight) * 100) - 8)}%`,
                    }}
                  >
                    <strong>{formatShortDate(hoveredPoint.trade_date)}</strong>
                    <div className="run-detail-chart-tooltip__row">
                      <span className="run-detail-chart-tooltip__dot run-detail-chart-tooltip__dot--strategy" />
                      <span>策略曲线</span>
                      <b>{formatAxisLabel(hoveredEquity)}</b>
                    </div>
                    <div className="run-detail-chart-tooltip__row">
                      <span className="run-detail-chart-tooltip__dot run-detail-chart-tooltip__dot--benchmark" />
                      <span>基准曲线</span>
                      <b>{formatAxisLabel(hoveredBenchmark)}</b>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="empty-state">暂无业绩曲线数据。</p>
            )}
          </div>

          <div className="run-detail-chart-legend-row">
            <div className="legend">
              <span className="legend-item">
                <span className="legend-dot legend-dot--strategy" />
                策略曲线
              </span>
              <span className="legend-item">
                <span className="legend-dot legend-dot--benchmark" />
                基准曲线
              </span>
              <span className="legend-item">
                <span className="legend-band" />
                测试集
              </span>
            </div>
            <button aria-label="全屏查看业绩曲线" className="fullscreen-btn" onClick={() => void handleFullscreen()} type="button">
              <svg aria-hidden="true" className="fullscreen-btn__icon" viewBox="0 0 12 12">
                <path d="M1 4V1H4" />
                <path d="M8 1H11V4" />
                <path d="M11 8V11H8" />
                <path d="M4 11H1V8" />
              </svg>
              全屏
            </button>
          </div>
        </section>

        <aside className="panel run-detail-decision-rail">
          <div className="panel-header">
            <div>
              <h3>决策侧栏</h3>
            </div>
          </div>
          <div className="run-detail-decision-score">
            <span className="run-detail-decision-score__label">{decisionRail.label ?? '综合判断'}</span>
            <strong>{Math.round(decisionRail.score ?? 0)} / 100</strong>
            <div className="run-detail-decision-score__bar">
              <span style={{ width: `${Math.max(0, Math.min(100, decisionRail.score ?? 0))}%` }} />
            </div>
          </div>
          <div className="run-detail-decision-list">
            {(decisionRail.items ?? []).slice(0, 3).map((item, index) => (
              <article
                className={`run-detail-decision-item run-detail-decision-item--${item.tone ?? (index === 0 ? 'green' : index === 2 ? 'orange' : 'blue')}`}
                key={`${item.title ?? item.label ?? 'item'}-${index}`}
              >
                <span className="run-detail-decision-item__index">{index + 1}</span>
                <div>
                  <strong>{item.title ?? item.label ?? `结论 ${index + 1}`}</strong>
                  <p>{item.body ?? item.description ?? '暂无说明。'}</p>
                </div>
              </article>
            ))}
          </div>
        </aside>
      </section>

      <section className="panel run-detail-tabs-panel">
        <div className="run-detail-tab-strip" role="tablist" aria-label="回测详情标签">
          {tabs.map((tab) => (
            <button
              aria-selected={activeTab === tab.key}
              className={activeTab === tab.key ? 'run-detail-tab run-detail-tab--active' : 'run-detail-tab'}
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              role="tab"
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

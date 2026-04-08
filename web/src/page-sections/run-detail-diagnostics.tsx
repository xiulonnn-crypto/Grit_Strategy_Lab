import { useMemo, useRef, useState } from 'react';
import type { CSSProperties, FocusEvent, MouseEvent as ReactMouseEvent } from 'react';
import { formatShortDate } from '../lib/format';
import { RunDetailOverviewSection } from './run-detail-overview';
import type { ApiBacktestChartPoint, ApiBacktestRunDetail } from '../types';

type ViewWindow = 'all' | '1y' | '3y';
type DrawdownWindow = 'all' | '1y';

type RunDetailDiagnosticsProps = {
  detail: ApiBacktestRunDetail;
  windowRange?: ViewWindow;
  onWindowRangeChange?: (windowRange: ViewWindow) => void;
  displayMode?: 'legacy' | 'tab';
};

type MonthlyCell = {
  month: string;
  value: number | null;
  segment?: string;
};

type MonthlyRow = {
  year: string;
  cells: MonthlyCell[];
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

type HeatmapTooltip = {
  label: string;
  value: string;
  left: number;
  top: number;
} | null;

const MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

function normalizePercentValue(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }
  return Math.abs(value) > 1 ? value : value * 100;
}

function formatSmartPercent(value: number | null | undefined, digits = 1): string {
  const normalized = normalizePercentValue(value);
  if (normalized === null) {
    return '—';
  }
  return `${normalized >= 0 ? '+' : ''}${normalized.toFixed(digits)}%`;
}

function formatSmartNumber(value: number | null | undefined, digits = 2): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  return value.toFixed(digits);
}

function formatPercentPoints(value: number | null | undefined, digits = 1): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

function toPercentPointValue(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }
  return value;
}

function segmentLabel(value: string | null | undefined): string {
  if (value === 'OOS') {
    return '测试集';
  }
  if (value === 'IS') {
    return '训练集';
  }
  return value ?? '未知';
}

function formatMonthLabel(month: string): string {
  const [year, monthIndex] = month.split('-');
  return `${year}年${Number(monthIndex)}月`;
}

function normalizeSeries(points: number[], fallbackBase: number): number[] {
  if (!points.length) {
    return [];
  }

  const base = points[0] || fallbackBase;
  return points.map((point) => (point / base) * 100);
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

function resolvePadding(padding: number | ChartPadding): ChartPadding {
  if (typeof padding === 'number') {
    return { top: padding, right: padding, bottom: padding, left: padding };
  }
  return padding;
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

function buildTicks(bounds: Bounds, count = 4): number[] {
  if (count <= 1) {
    return [bounds.max];
  }

  const range = bounds.max - bounds.min;
  return Array.from({ length: count }, (_, index) => bounds.max - (range * index) / (count - 1));
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

function buildMonthlyRows(detail: ApiBacktestRunDetail): MonthlyRow[] {
  const rowMap = new Map<string, MonthlyCell[]>();

  for (const entry of detail.monthly_returns ?? []) {
    const [year, monthIndexRaw] = entry.month.split('-');
    const monthIndex = Number(monthIndexRaw) - 1;
    if (!year || monthIndex < 0 || monthIndex > 11) {
      continue;
    }

    const row =
      rowMap.get(year) ??
      Array.from({ length: 12 }, (_, index): MonthlyCell => ({
        month: `${year}-${String(index + 1).padStart(2, '0')}`,
        value: null,
      }));

    row[monthIndex] = {
      month: entry.month,
      value: typeof entry.return_pct === 'number' && Number.isFinite(entry.return_pct) ? entry.return_pct : null,
      segment: entry.segment,
    };
    rowMap.set(year, row);
  }

  return [...rowMap.entries()]
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([year, cells]) => ({ year, cells }));
}

function filterDrawdownSeries(series: ApiBacktestChartPoint[] | undefined, drawdownWindow: DrawdownWindow): ApiBacktestChartPoint[] {
  if (!series?.length || drawdownWindow === 'all') {
    return series ?? [];
  }
  return series.slice(Math.max(0, series.length - 252));
}

function buildRollingSeries(
  rollingMetrics: ApiBacktestRunDetail['rolling_metrics'],
): { returnSeries: number[]; sharpeSeries: number[] } {
  const metrics = rollingMetrics ?? [];
  const returnSeries = normalizeSeries(
    metrics.map((point) => (typeof point.trailing_252_return === 'number' ? point.trailing_252_return + 100 : 100)),
    100,
  );
  const sharpeSeries = normalizeSeries(
    metrics.map((point) => (typeof point.trailing_252_sharpe === 'number' ? point.trailing_252_sharpe + 10 : 10)),
    10,
  );
  return { returnSeries, sharpeSeries };
}

function buildHeatCellStyle(value: number | null, maxAbs: number): CSSProperties {
  if (value === null) {
    return {};
  }

  const normalized = Math.min(Math.abs(value) / Math.max(maxAbs, 1), 1);
  const alpha = 0.18 + normalized * 0.42;
  const borderAlpha = 0.12 + normalized * 0.18;

  if (value >= 0) {
    return {
      backgroundColor: `rgba(31, 135, 123, ${alpha.toFixed(3)})`,
      borderColor: `rgba(31, 135, 123, ${borderAlpha.toFixed(3)})`,
    };
  }

  return {
    backgroundColor: `rgba(222, 127, 112, ${alpha.toFixed(3)})`,
    borderColor: `rgba(222, 127, 112, ${borderAlpha.toFixed(3)})`,
  };
}

function buildRangeCaption(series: ApiBacktestChartPoint[] | undefined): string {
  if (!series?.length) {
    return '暂无区间';
  }
  return `${formatShortDate(series[0].trade_date)} - ${formatShortDate(series[series.length - 1].trade_date)}`;
}

function renderDrawdownChart(series: ApiBacktestChartPoint[], windowLabel: string): JSX.Element {
  const drawdownSeries = series
    .map((point) => ({
      tradeDate: point.trade_date,
      drawdown: toPercentPointValue(point.drawdown),
    }))
    .filter((point): point is { tradeDate: string; drawdown: number } => point.drawdown !== null);

  if (!drawdownSeries.length) {
    return <p className="empty-state">暂无回撤曲线数据。</p>;
  }

  const width = 420;
  const height = 216;
  const padding: ChartPadding = { top: 16, right: 16, bottom: 28, left: 16 };
  const values = drawdownSeries.map((point) => point.drawdown);
  const bounds = getBounds([values]);
  const minIndex = values.reduce((currentMin, value, index) => (value < values[currentMin] ? index : currentMin), 0);
  const minPoint = drawdownSeries[minIndex];
  const minX = getXCoordinate(minIndex, drawdownSeries.length, width, padding);
  const minY = getYCoordinate(minPoint.drawdown, height, padding, bounds);
  const labelWidth = 88;
  const labelX = Math.max(20, Math.min(minX - labelWidth / 2, width - 20 - labelWidth));
  const labelY = Math.max(8, minY - 28);
  const dateTicks = [
    { index: 0, label: formatShortDate(drawdownSeries[0].tradeDate), anchor: 'start' as const },
    {
      index: Math.round((drawdownSeries.length - 1) / 2),
      label: formatShortDate(drawdownSeries[Math.round((drawdownSeries.length - 1) / 2)].tradeDate),
      anchor: 'middle' as const,
    },
    {
      index: drawdownSeries.length - 1,
      label: formatShortDate(drawdownSeries[drawdownSeries.length - 1].tradeDate),
      anchor: 'end' as const,
    },
  ];

  return (
    <div className="run-detail-diagnostics-shell run-detail-diagnostics-shell--chart">
      <svg
        className="run-detail-diagnostics-chart run-detail-diagnostics-chart--drawdown"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`回撤曲线 ${windowLabel}`}
      >
        <defs>
          <linearGradient id="run-detail-drawdown-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(222, 127, 112, 0.24)" />
            <stop offset="100%" stopColor="rgba(222, 127, 112, 0.04)" />
          </linearGradient>
        </defs>
        {buildTicks(bounds).map((tick) => {
          const y = getYCoordinate(tick, height, padding, bounds);
          return (
            <line
              className="run-detail-diagnostics-grid-line"
              key={`drawdown-grid-${tick.toFixed(2)}`}
              x1={padding.left}
              x2={width - padding.right}
              y1={y}
              y2={y}
            />
          );
        })}
        <path className="run-detail-diagnostics-area run-detail-diagnostics-area--drawdown" d={getAreaPath(values, width, height, padding, bounds)} />
        <path className="run-detail-diagnostics-line run-detail-diagnostics-line--drawdown" d={getPath(values, width, height, padding, bounds)} />
        <circle className="run-detail-diagnostics-extreme-point" cx={minX} cy={minY} r="4" />
        <line className="run-detail-diagnostics-extreme-guide" x1={minX} x2={minX} y1={minY} y2={labelY + 24} />
        <rect className="run-detail-diagnostics-extreme-pill" x={labelX} y={labelY} width={labelWidth} height="22" rx="11" />
        <text className="run-detail-diagnostics-extreme-text" x={labelX + labelWidth / 2} y={labelY + 14} textAnchor="middle">
          最低 {formatPercentPoints(minPoint.drawdown)}
        </text>
        {dateTicks.map((tick) => {
          const x = getXCoordinate(tick.index, drawdownSeries.length, width, padding);
          return (
            <text className="run-detail-diagnostics-axis-label" key={`${tick.index}-${tick.label}`} textAnchor={tick.anchor} x={x} y={height - 8}>
              {tick.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function renderMonthlyHeatmap(
  detail: ApiBacktestRunDetail,
  heatmapTooltip: HeatmapTooltip,
  onHeatCellEnter: (event: ReactMouseEvent<HTMLButtonElement>, monthLabel: string, value: number) => void,
  onHeatCellMove: (event: ReactMouseEvent<HTMLButtonElement>, monthLabel: string, value: number) => void,
  onHeatCellFocus: (event: FocusEvent<HTMLButtonElement>, monthLabel: string, value: number) => void,
  onHeatCellLeave: () => void,
): JSX.Element {
  const monthlyRows = buildMonthlyRows(detail);
  if (!monthlyRows.length) {
    return <p className="empty-state">暂无月度收益矩阵。</p>;
  }

  const values = monthlyRows.flatMap((row) => row.cells.map((cell) => cell.value).filter((value): value is number => value !== null));
  const maxAbs = values.length ? Math.max(...values.map((value) => Math.abs(value))) : 1;

  return (
    <div className="run-detail-diagnostics-shell run-detail-diagnostics-shell--heatmap">
      <div className="run-detail-heatmap">
        <div className="run-detail-heatmap__header">
          <span className="run-detail-heatmap__spacer" />
          {MONTH_LABELS.map((label) => (
            <span className="run-detail-heatmap__month" key={label}>
              {label}
            </span>
          ))}
        </div>
        <div className="run-detail-heatmap__body">
          {monthlyRows.map((row) => (
            <div className="run-detail-heatmap__row" key={row.year}>
              <span className="run-detail-heatmap__year">{row.year}</span>
              {row.cells.map((cell) => (
                <button
                  className={`run-detail-heat-cell ${cell.value === null ? 'run-detail-heat-cell--empty' : ''} ${cell.segment === 'OOS' ? 'run-detail-heat-cell--test' : ''}`}
                  key={cell.month}
                  onBlur={onHeatCellLeave}
                  onFocus={(event) => {
                    if (cell.value !== null) {
                      onHeatCellFocus(event, formatMonthLabel(cell.month), cell.value);
                    }
                  }}
                  onMouseEnter={(event) => {
                    if (cell.value !== null) {
                      onHeatCellEnter(event, formatMonthLabel(cell.month), cell.value);
                    }
                  }}
                  onMouseLeave={onHeatCellLeave}
                  onMouseMove={(event) => {
                    if (cell.value !== null) {
                      onHeatCellMove(event, formatMonthLabel(cell.month), cell.value);
                    }
                  }}
                  style={buildHeatCellStyle(cell.value, maxAbs)}
                  title={cell.value === null ? `${formatMonthLabel(cell.month)} 暂无数据` : `${formatMonthLabel(cell.month)} ${formatPercentPoints(cell.value)}`}
                  type="button"
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      {heatmapTooltip ? (
        <div
          className="run-detail-heatmap-tooltip"
          style={{
            left: `${heatmapTooltip.left}px`,
            top: `${heatmapTooltip.top}px`,
          }}
        >
          <strong>{heatmapTooltip.label}</strong>
          <span>{heatmapTooltip.value}</span>
        </div>
      ) : null}
    </div>
  );
}

function renderDrawdownEvents(detail: ApiBacktestRunDetail): JSX.Element {
  const drawdownEvents = [...(detail.drawdown_events ?? [])]
    .sort((left, right) => {
      const leftValue = Math.abs(toPercentPointValue(left.drawdown_pct) ?? 0);
      const rightValue = Math.abs(toPercentPointValue(right.drawdown_pct) ?? 0);
      return rightValue - leftValue;
    })
    .slice(0, 3);

  if (!drawdownEvents.length) {
    return <p className="empty-state">暂无回撤事件。</p>;
  }

  return (
    <div className="run-detail-diagnostics-events">
      {drawdownEvents.map((event) => (
        <article className="run-detail-diagnostics-event" key={`${event.start_date}-${event.trough_date}`}>
          <div className="run-detail-diagnostics-event__content">
            <div className="run-detail-diagnostics-event__title-row">
              <strong>
                {formatShortDate(event.start_date)} - {formatShortDate(event.trough_date)}
              </strong>
              <span className="status-chip status-chip--soft">{segmentLabel(event.segment)}</span>
            </div>
            <p>{event.recovery_date ? `修复至 ${formatShortDate(event.recovery_date)}` : '尚未完成修复'}</p>
          </div>
          <span className="run-detail-diagnostics-event__loss">{formatPercentPoints(event.drawdown_pct)}</span>
        </article>
      ))}
    </div>
  );
}

function renderRollingChart(detail: ApiBacktestRunDetail): JSX.Element {
  const rollingMetrics = detail.rolling_metrics ?? [];
  if (!rollingMetrics.length) {
    return <p className="empty-state">暂无滚动指标。</p>;
  }

  const { returnSeries, sharpeSeries } = buildRollingSeries(rollingMetrics);
  const bounds = getBounds([returnSeries, sharpeSeries]);
  const latestRollingReturn = latestMetric(rollingMetrics, 'trailing_252_return');
  const latestRollingSharpe = latestMetric(rollingMetrics, 'trailing_252_sharpe');
  const width = 420;
  const height = 176;
  const padding: ChartPadding = { top: 18, right: 18, bottom: 22, left: 18 };

  return (
    <div className="run-detail-diagnostics-shell run-detail-diagnostics-shell--chart">
      <svg className="run-detail-diagnostics-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="滚动收益与夏普">
        {buildTicks(bounds).map((tick) => {
          const y = getYCoordinate(tick, height, padding, bounds);
          return (
            <line
              className="run-detail-diagnostics-grid-line"
              key={`rolling-grid-${tick.toFixed(2)}`}
              x1={padding.left}
              x2={width - padding.right}
              y1={y}
              y2={y}
            />
          );
        })}
        <path className="run-detail-diagnostics-line run-detail-diagnostics-line--strategy" d={getPath(returnSeries, width, height, padding, bounds)} />
        <path className="run-detail-diagnostics-line run-detail-diagnostics-line--benchmark" d={getPath(sharpeSeries, width, height, padding, bounds)} />
      </svg>
      <div className="run-detail-diagnostics-note">
        <div>收益 {formatSmartPercent(latestRollingReturn)}</div>
        <div>夏普 {formatSmartNumber(latestRollingSharpe)}</div>
      </div>
    </div>
  );
}

export function RunDetailDiagnostics({
  detail,
  windowRange = 'all',
  onWindowRangeChange,
  displayMode,
}: RunDetailDiagnosticsProps): JSX.Element {
  const resolvedDisplayMode = displayMode ?? (typeof onWindowRangeChange === 'function' ? 'legacy' : 'tab');
  const [drawdownWindow, setDrawdownWindow] = useState<DrawdownWindow>('all');
  const [heatmapTooltip, setHeatmapTooltip] = useState<HeatmapTooltip>(null);
  const heatmapShellRef = useRef<HTMLDivElement | null>(null);
  const filteredDrawdownSeries = useMemo(
    () => filterDrawdownSeries(detail.chart_series, drawdownWindow),
    [detail.chart_series, drawdownWindow],
  );
  const diagnosticsRange = buildRangeCaption(filteredDrawdownSeries);

  function setHeatmapTooltipPosition(monthLabel: string, value: number, clientX: number, clientY: number): void {
    const shell = heatmapShellRef.current;
    if (!shell) {
      return;
    }

    const shellRect = shell.getBoundingClientRect();
    const left = Math.max(68, Math.min(clientX - shellRect.left, shellRect.width - 68));
    const top = Math.max(56, clientY - shellRect.top - 14);
    setHeatmapTooltip({
      label: monthLabel,
      value: formatPercentPoints(value),
      left,
      top,
    });
  }

  function updateHeatmapTooltip(event: ReactMouseEvent<HTMLButtonElement>, monthLabel: string, value: number): void {
    setHeatmapTooltipPosition(monthLabel, value, event.clientX, event.clientY);
  }

  function updateHeatmapTooltipFromFocus(event: FocusEvent<HTMLButtonElement>, monthLabel: string, value: number): void {
    const rect = event.currentTarget.getBoundingClientRect();
    setHeatmapTooltipPosition(monthLabel, value, rect.left + rect.width / 2, rect.top);
  }

  return (
    <div className="run-detail-diagnostics-tab">
      {resolvedDisplayMode === 'legacy' ? (
        <RunDetailOverviewSection
          activeTab="diagnostics"
          detail={detail}
          onTabChange={() => {}}
          onWindowRangeChange={onWindowRangeChange ?? (() => {})}
          windowRange={windowRange}
        />
      ) : null}

      <div className="run-detail-diagnostics-grid">
        <section className="panel run-detail-diagnostics-panel run-detail-diagnostics-panel--drawdown">
          <p className="eyebrow">风险趋势</p>
          <div className="run-detail-diagnostics-panel__head">
            <div>
              <h3>回撤曲线</h3>
              <p className="run-detail-section-copy">按同一回测区间查看最大回撤扩张与修复节奏。</p>
            </div>
            <div className="run-detail-diagnostics-panel__actions">
              <div className="run-detail-window-switcher" role="tablist" aria-label="回撤曲线区间">
                <button
                  aria-pressed={drawdownWindow === 'all'}
                  className={drawdownWindow === 'all' ? 'ghost-button ghost-button--active' : 'ghost-button'}
                  onClick={() => setDrawdownWindow('all')}
                  type="button"
                >
                  全部
                </button>
                <button
                  aria-pressed={drawdownWindow === '1y'}
                  className={drawdownWindow === '1y' ? 'ghost-button ghost-button--active' : 'ghost-button'}
                  onClick={() => setDrawdownWindow('1y')}
                  type="button"
                >
                  最近1年
                </button>
              </div>
              <span className="run-detail-diagnostics-range">{diagnosticsRange}</span>
            </div>
          </div>
          {renderDrawdownChart(filteredDrawdownSeries, drawdownWindow === 'all' ? '全部' : '最近1年')}
        </section>

        <section className="panel run-detail-diagnostics-panel run-detail-diagnostics-panel--monthly">
          <p className="eyebrow">月度分布</p>
          <div className="run-detail-diagnostics-panel__head">
            <div>
              <h3>月度收益矩阵</h3>
              <p className="run-detail-section-copy">按月份查看收益分布，快速识别不同年份里的正负收益密度。</p>
            </div>
          </div>
          <div ref={heatmapShellRef}>
            {renderMonthlyHeatmap(
              detail,
              heatmapTooltip,
              updateHeatmapTooltip,
              updateHeatmapTooltip,
              updateHeatmapTooltipFromFocus,
              () => setHeatmapTooltip(null),
            )}
          </div>
        </section>

        <section className="panel run-detail-diagnostics-panel run-detail-diagnostics-panel--events">
          <p className="eyebrow">重点回撤</p>
          <div className="run-detail-diagnostics-panel__head">
            <div>
              <h3>重点回撤事件</h3>
              <p className="run-detail-section-copy">按回撤幅度排序，优先查看最伤净值的几段下行。</p>
            </div>
          </div>
          {renderDrawdownEvents(detail)}
        </section>

        <section className="panel run-detail-diagnostics-panel run-detail-diagnostics-panel--rolling">
          <p className="eyebrow">滚动指标</p>
          <div className="run-detail-diagnostics-panel__head">
            <div>
              <h3>滚动收益 / 夏普</h3>
              <p className="run-detail-section-copy">把阶段收益与风险回报放在同一视图，判断稳定性是否延续。</p>
            </div>
          </div>
          {renderRollingChart(detail)}
        </section>
      </div>
    </div>
  );
}

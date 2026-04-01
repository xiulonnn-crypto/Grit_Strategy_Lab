import { formatPercent, formatShortDate } from '../lib/format';
import type { ApiBacktestRunDetail } from '../types';

type ViewWindow = 'all' | '1y' | '3y';

type RunDetailDiagnosticsProps = {
  detail: ApiBacktestRunDetail;
  windowRange: ViewWindow;
  onWindowRangeChange: (windowRange: ViewWindow) => void;
};

type MonthlyCell = {
  value: number | null;
  segment?: string;
};

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  return value.toFixed(digits);
}

function formatPercentOrDash(value: number | null | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  return formatPercent(value);
}

function formatSeriesRange(series: ApiBacktestRunDetail['chart_series']): string {
  if (!series?.length) {
    return '暂无区间';
  }
  const start = series[0]?.trade_date;
  const end = series[series.length - 1]?.trade_date;
  if (!start || !end) {
    return '暂无区间';
  }
  return `${formatShortDate(start)} - ${formatShortDate(end)}`;
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

function filterSeries(detail: ApiBacktestRunDetail, windowRange: ViewWindow) {
  const series = detail.chart_series ?? [];
  if (!series.length || windowRange === 'all') {
    return series;
  }
  const limit = windowRange === '1y' ? 252 : 756;
  return series.slice(Math.max(0, series.length - limit));
}

function getPath(points: number[], width: number, height: number, padding: number): string {
  if (!points.length) {
    return '';
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;
  return points
    .map((point, index) => {
      const x = padding + (usableWidth * (points.length === 1 ? 0 : index)) / (points.length - 1 || 1);
      const y = padding + ((max - point) / range) * usableHeight;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

function getAreaPath(points: number[], width: number, height: number, padding: number): string {
  if (!points.length) {
    return '';
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;
  const line = points
    .map((point, index) => {
      const x = padding + (usableWidth * (points.length === 1 ? 0 : index)) / (points.length - 1 || 1);
      const y = padding + ((max - point) / range) * usableHeight;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
  const lastX = padding + usableWidth;
  const firstX = padding;
  const baseY = height - padding;
  const firstY = padding + ((max - points[0]) / range) * usableHeight;
  return `${line} L ${lastX.toFixed(2)} ${baseY.toFixed(2)} L ${firstX.toFixed(2)} ${baseY.toFixed(2)} L ${firstX.toFixed(2)} ${firstY.toFixed(2)} Z`;
}

function buildMonthlyMatrix(detail: ApiBacktestRunDetail): Array<{
  year: string;
  cells: MonthlyCell[];
  total: number | null;
}> {
  const map = new Map<string, MonthlyCell[]>();
  for (const entry of detail.monthly_returns ?? []) {
    const [year, month] = entry.month.split('-');
    if (!year || !month) {
      continue;
    }
    const row = map.get(year) ?? Array.from({ length: 12 }, (): MonthlyCell => ({ value: null }));
    row[Number(month) - 1] = { value: entry.return_pct, segment: entry.segment };
    map.set(year, row);
  }

  return [...map.entries()]
    .sort(([left], [right]) => Number(right) - Number(left))
    .map(([year, cells]) => {
      const numericValues = cells
        .map((cell) => cell.value)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      const total = numericValues.length ? numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length : null;
      return { year, cells, total };
    });
}

function valueClassName(value: number | null): string {
  if (value === null) {
    return 'neutral';
  }
  return value >= 0 ? 'positive' : 'negative';
}

function RunStatCard({
  label,
  value,
}: {
  label: string;
  value: string;
}): JSX.Element {
  return (
    <article className="metric-card run-detail-stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

export function RunDetailDiagnostics({
  detail,
  windowRange,
  onWindowRangeChange,
}: RunDetailDiagnosticsProps): JSX.Element {
  const series = filterSeries(detail, windowRange);
  const equityValues = series.map((point) => point.equity);
  const benchmarkValues = series.map((point) => point.benchmark);
  const drawdownValues = series.map((point) => point.drawdown);
  const seriesHasOos = series.some((point) => point.is_oos);
  const curveWidth = 960;
  const curveHeight = 280;
  const padding = 18;
  const monthlyRows = buildMonthlyMatrix(detail);
  const rollingMetrics = detail.rolling_metrics ?? [];
  const latestRollingReturn = latestMetric(rollingMetrics, 'trailing_252_return');
  const latestRollingSharpe = latestMetric(rollingMetrics, 'trailing_252_sharpe');
  const latestRisk = (detail.risk_metrics ?? {}) as Record<string, number>;
  const returnDisplay = latestRollingReturn ?? latestRisk['latest_252_return'] ?? null;
  const sharpeDisplay = latestRollingSharpe ?? latestRisk['latest_252_sharpe'] ?? null;
  const runRange = formatSeriesRange(series);
  const oosLabel = detail.oos_start_date ? `样本外起点 ${formatShortDate(detail.oos_start_date)}` : '样本外起点未提供';

  return (
    <div className="run-detail-diagnostics">
      <section className="panel run-detail-kpi-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">风险摘要</p>
            <h3>核心绩效与风险指标</h3>
          </div>
        </div>
        <div className="run-detail-kpi-grid">
          <RunStatCard label="总收益" value={formatPercent(detail.metrics.total_return)} />
          <RunStatCard label="夏普比率" value={formatNumber(detail.metrics.sharpe, 2)} />
          <RunStatCard label="最大回撤" value={formatPercent(detail.metrics.max_drawdown)} />
          <RunStatCard label="最新 252 日滚动收益" value={formatPercentOrDash(returnDisplay)} />
          <RunStatCard label="最新 252 日滚动 Sharpe" value={formatNumber(sharpeDisplay, 2)} />
          <RunStatCard label="交易数" value={typeof detail.trades_count === 'number' ? detail.trades_count.toLocaleString('zh-HK') : '—'} />
        </div>
      </section>

      <section className="panel run-detail-curve-card run-detail-curve-card--primary">
        <div className="panel-header">
          <div>
            <p className="eyebrow">主绩效曲线</p>
            <h3>策略净值 / 基准净值</h3>
            <p className="run-detail-section-copy">主图只比较策略净值与基准净值，样本外观察区直接保留在图上。</p>
          </div>
          <div className="run-detail-curve-tools">
            <div className="run-detail-window-switcher" role="tablist" aria-label="曲线时间窗口">
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
        </div>
        {series.length ? (
          <>
            <div className="run-detail-chart-copy">
              <span>历史训练 {runRange}</span>
              <span className={seriesHasOos ? 'run-detail-chart-copy--accent' : ''}>{oosLabel}</span>
            </div>
            <div className="run-detail-chart-frame">
              <div className="run-detail-chart-legend" aria-hidden="true">
                <span>策略净值</span>
                <span>基准净值</span>
              </div>
              <svg className="run-detail-line-chart" viewBox={`0 0 ${curveWidth} ${curveHeight}`} preserveAspectRatio="none" role="img" aria-label="主绩效曲线">
                <defs>
                  <linearGradient id="equity-fill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="rgba(13, 123, 116, 0.35)" />
                    <stop offset="100%" stopColor="rgba(13, 123, 116, 0.02)" />
                  </linearGradient>
                </defs>
                <path className="run-detail-area-path" d={getAreaPath(equityValues, curveWidth, curveHeight, padding)} />
                <path className="run-detail-benchmark-path" d={getPath(benchmarkValues, curveWidth, curveHeight, padding)} />
                <path className="run-detail-equity-path" d={getPath(equityValues, curveWidth, curveHeight, padding)} />
              </svg>
            </div>
            <p className="run-detail-chart-note">样本外区段会保留在曲线中，便于快速检查训练与真实区间的分界。</p>
          </>
        ) : (
          <p className="empty-state">暂无主绩效曲线数据。</p>
        )}
      </section>

      <section className="run-detail-main-grid">
        <section className="panel run-detail-drawdown-card run-detail-drawdown-card--chart">
          <div className="panel-header">
            <div>
              <p className="eyebrow">水下图</p>
              <h3>回撤深度曲线</h3>
              <p className="run-detail-section-copy">回撤深度与主图联动，帮助快速定位最深的回撤阶段。</p>
            </div>
          </div>
          {drawdownValues.length ? (
            <svg className="run-detail-mini-chart run-detail-mini-chart--large" viewBox="0 0 760 220" preserveAspectRatio="none" role="img" aria-label="水下曲线">
              <path className="run-detail-drawdown-fill" d={getAreaPath(drawdownValues, 760, 220, 14)} />
              <path className="run-detail-drawdown-line" d={getPath(drawdownValues, 760, 220, 14)} />
            </svg>
          ) : (
            <p className="empty-state">暂无水下曲线数据。</p>
          )}
        </section>

        <section className="panel run-detail-drawdown-card">
          <div className="panel-header">
            <div>
              <p className="eyebrow">最大回撤区间</p>
              <h3>Top 5 回撤事件</h3>
              <p className="run-detail-section-copy">把最深的回撤作为主曲线的补充解释，直接看恢复速度和区段归属。</p>
            </div>
          </div>
          {detail.drawdown_events?.length ? (
            <div className="run-detail-event-list">
              {[...detail.drawdown_events]
                .sort((left, right) => left.drawdown_pct - right.drawdown_pct)
                .slice(0, 5)
                .map((event) => (
                  <article className="run-detail-event-card" key={`${event.start_date}-${event.trough_date}`}>
                    <div className="run-detail-event-card__row">
                      <strong>{formatShortDate(event.start_date)} - {formatShortDate(event.trough_date)}</strong>
                      <span className="status-chip status-chip--soft">{event.segment}</span>
                    </div>
                    <div className="run-detail-event-card__row">
                      <strong>{formatPercent(event.drawdown_pct)}</strong>
                      <span>{event.recovery_date ? `恢复于 ${formatShortDate(event.recovery_date)}` : '尚未恢复'}</span>
                    </div>
                    <p>{event.status === 'open' ? '当前仍处于回撤中。' : '回撤已恢复，作为对照样本保留。'}</p>
                  </article>
                ))}
            </div>
          ) : (
            <p className="empty-state">暂无回撤事件。</p>
          )}
        </section>
      </section>

      <section className="run-detail-bottom-grid">
        <section className="panel run-detail-monthly-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">月度收益矩阵</p>
              <h3>按月聚合收益</h3>
              <p className="run-detail-section-copy">适合快速扫描年份间的波动结构和全年累积表现。</p>
            </div>
          </div>
          {monthlyRows.length ? (
            <div className="run-detail-monthly-table-shell">
              <table className="run-detail-monthly-table">
                <thead>
                  <tr>
                    <th>年份</th>
                    {Array.from({ length: 12 }, (_, index) => (
                      <th key={`month-${index + 1}`}>{index + 1}月</th>
                    ))}
                    <th>全年</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyRows.map((row) => (
                    <tr key={row.year}>
                      <th>{row.year}</th>
                      {row.cells.map((cell, index) => (
                        <td className={valueClassName(cell.value)} key={`${row.year}-${index}`}>
                          {cell.value === null ? '—' : formatPercent(cell.value)}
                          {cell.segment ? <small>{cell.segment}</small> : null}
                        </td>
                      ))}
                      <td className={valueClassName(row.total)}>{row.total === null ? '—' : formatPercent(row.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty-state">暂无月度收益矩阵。</p>
          )}
        </section>

        <section className="panel run-detail-rolling-card">
          <div className="panel-header">
            <div>
              <p className="eyebrow">滚动指标</p>
              <h3>Trailing 252 日收益与 Sharpe</h3>
              <p className="run-detail-section-copy">把近期质量单独收敛成一个紧凑卡片，方便跟月度矩阵一起看。</p>
            </div>
          </div>
          {rollingMetrics.length ? (
            <>
              <svg className="run-detail-rolling-chart" viewBox="0 0 360 160" preserveAspectRatio="none" role="img" aria-label="滚动指标曲线">
                <path
                  className="run-detail-rolling-return-line"
                  d={getPath(
                    rollingMetrics.map((point) => (typeof point.trailing_252_return === 'number' ? point.trailing_252_return : 0)),
                    360,
                    160,
                    14,
                  )}
                />
                <path
                  className="run-detail-rolling-sharpe-line"
                  d={getPath(
                    rollingMetrics.map((point) => (typeof point.trailing_252_sharpe === 'number' ? point.trailing_252_sharpe : 0)),
                    360,
                    160,
                    14,
                  )}
                />
              </svg>
              <div className="run-detail-rolling-legend">
                <span>trailing 252 日滚动收益</span>
                <span>trailing 252 日滚动 Sharpe</span>
              </div>
              <div className="run-detail-rolling-summary">
                <article className="metric-card">
                  <span>最新 252 日滚动收益</span>
                  <strong>{formatPercentOrDash(returnDisplay)}</strong>
                </article>
                <article className="metric-card">
                  <span>最新 252 日滚动 Sharpe</span>
                  <strong>{formatNumber(sharpeDisplay, 2)}</strong>
                </article>
              </div>
            </>
          ) : (
            <p className="empty-state">暂无滚动指标。</p>
          )}
        </section>
      </section>
    </div>
  );
}

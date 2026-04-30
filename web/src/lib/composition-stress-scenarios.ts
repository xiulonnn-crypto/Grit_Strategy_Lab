export type CompositionStressTone = 'good' | 'warning' | 'danger' | 'info' | 'neutral';

export type CompositionStressScenario = {
  id: string;
  title: string;
  period: string;
  portfolioDrawdown: number;
  benchmarkLabel: string;
  benchmarkDrawdown: number | null;
  recoveryDays: number | null;
  benchmarkRecoveryDays: number | null;
  defensiveDelta: number | null;
  source: string;
  status: string;
  tone: CompositionStressTone;
  start?: string | null;
  end?: string | null;
};

type ReturnSeriesPoint = {
  date: string;
  valuePct: number;
};

type WindowDrawdown = {
  drawdownPct: number;
  recoveryDays: number | null;
  startDate: string;
  endDate: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readText(value: unknown, fallback = ''): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace('%', '').trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function dateValueFromRow(row: Record<string, unknown>): string {
  return readText(row.date, readText(row.label));
}

function monthIndexFromDate(value: string): number | null {
  const match = value.match(/^(\d{4})-(\d{2})/);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return Number(match[1]) * 12 + Number(match[2]);
}

function daysBetweenDates(startDate: string, endDate: string): number | null {
  const start = new Date(`${startDate.slice(0, 10)}T00:00:00Z`).getTime();
  const end = new Date(`${endDate.slice(0, 10)}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function returnValueFromRow(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = readNumber(row[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function normalizeReturnSeries(rows: unknown, keys: string[]): ReturnSeriesPoint[] {
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows
    .map((item): ReturnSeriesPoint | null => {
      if (!isRecord(item)) {
        return null;
      }
      const date = dateValueFromRow(item);
      const valuePct = returnValueFromRow(item, keys);
      return date && valuePct !== null ? { date, valuePct } : null;
    })
    .filter((item): item is ReturnSeriesPoint => item !== null)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function maxDrawdownForWindow(series: ReturnSeriesPoint[], startDate: string, endDate: string): WindowDrawdown | null {
  const rows = series.filter((point) => point.date >= startDate);
  if (!rows.some((point) => point.date <= endDate)) {
    return null;
  }

  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  let peakAtTrough = 1;
  let troughIndex = -1;
  const curve: Array<{ date: string; equity: number }> = [];

  rows.forEach((point, index) => {
    equity *= 1 + point.valuePct / 100;
    curve.push({ date: point.date, equity });
    if (point.date > endDate) {
      return;
    }
    peak = Math.max(peak, equity);
    const drawdown = peak > 0 ? equity / peak - 1 : 0;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
      peakAtTrough = peak;
      troughIndex = index;
    }
  });

  let recoveryDays: number | null = null;
  if (troughIndex >= 0) {
    for (let index = troughIndex + 1; index < curve.length; index += 1) {
      if (curve[index]!.equity >= peakAtTrough - 0.000001) {
        recoveryDays = daysBetweenDates(curve[troughIndex]!.date, curve[index]!.date);
        break;
      }
    }
  }

  return {
    drawdownPct: Number((maxDrawdown * 100).toFixed(4)),
    recoveryDays,
    startDate,
    endDate,
  };
}

function worstRollingWindow(series: ReturnSeriesPoint[], windowSize: number): WindowDrawdown | null {
  if (series.length < windowSize) {
    return null;
  }
  let worst: WindowDrawdown | null = null;
  for (let index = 0; index <= series.length - windowSize; index += 1) {
    const slice = series.slice(index, index + windowSize);
    const months = slice.map((point) => monthIndexFromDate(point.date));
    if (months.some((month) => month === null) || months.some((month, offset) => month !== months[0]! + offset)) {
      continue;
    }
    const drawdown = maxDrawdownForWindow(series, slice[0]!.date, slice[slice.length - 1]!.date);
    if (drawdown && (!worst || drawdown.drawdownPct < worst.drawdownPct)) {
      worst = drawdown;
    }
  }
  return worst;
}

function formatStressPeriod(startDate: string, endDate: string): string {
  const start = startDate.slice(0, 7);
  const end = endDate.slice(0, 7);
  return start && end ? `${start} 至 ${end}` : '运行时窗口';
}

export function stressToneFromDelta(value: number | null): CompositionStressTone {
  if (value === null) {
    return 'neutral';
  }
  if (value >= 2) {
    return 'good';
  }
  if (value <= -1) {
    return 'danger';
  }
  return 'warning';
}

function buildStressScenarioFromWindow({
  benchmarkLabel,
  benchmarkSeries,
  id,
  source,
  title,
  window,
}: {
  benchmarkLabel: string;
  benchmarkSeries: ReturnSeriesPoint[];
  id: string;
  source: string;
  title: string;
  window: WindowDrawdown;
}): CompositionStressScenario {
  const benchmarkWindow = maxDrawdownForWindow(benchmarkSeries, window.startDate, window.endDate);
  const benchmarkDrawdown = benchmarkWindow?.drawdownPct ?? null;
  const defensiveDelta = benchmarkDrawdown === null
    ? null
    : Number((Math.abs(benchmarkDrawdown) - Math.abs(window.drawdownPct)).toFixed(1));
  return {
    benchmarkDrawdown,
    benchmarkLabel,
    benchmarkRecoveryDays: benchmarkWindow?.recoveryDays ?? null,
    defensiveDelta,
    end: window.endDate,
    id,
    period: formatStressPeriod(window.startDate, window.endDate),
    portfolioDrawdown: window.drawdownPct,
    recoveryDays: window.recoveryDays,
    source,
    start: window.startDate,
    status: '实际窗口',
    title,
    tone: stressToneFromDelta(defensiveDelta),
  };
}

export function buildCompositionStressScenarios({
  benchmarkLabel,
  benchmarkSeries,
  returnsPreview,
}: {
  benchmarkLabel?: string | null;
  benchmarkSeries: unknown;
  returnsPreview: unknown;
}): CompositionStressScenario[] {
  const portfolioSeries = normalizeReturnSeries(returnsPreview, ['net_return_pct', 'portfolio_return_pct']);
  if (portfolioSeries.length === 0) {
    return [];
  }
  const normalizedBenchmarkSeries = normalizeReturnSeries(benchmarkSeries, ['benchmark_return_pct']);
  const label = readText(benchmarkLabel, '基准');
  const scenarios: CompositionStressScenario[] = [];
  const worstWindow = worstRollingWindow(portfolioSeries, 3);
  if (worstWindow) {
    scenarios.push(buildStressScenarioFromWindow({
      benchmarkLabel: label,
      benchmarkSeries: normalizedBenchmarkSeries,
      id: 'worst-3m',
      source: '来自本次组合回测收益序列的滚动三个月最差窗口。',
      title: '历史最差三个月',
      window: worstWindow,
    }));
  }

  [
    {
      endDate: '2020-05-31',
      id: 'covid-2020',
      source: '来自本次组合回测与基准序列，按 2020 疫情冲击窗口计算。',
      startDate: '2020-02-01',
      title: '2020 疫情冲击',
    },
    {
      endDate: '2022-10-31',
      id: 'rate-shock-2022',
      source: '来自本次组合回测与基准序列，按 2022 紧缩熊市窗口计算。',
      startDate: '2022-01-01',
      title: '2022 紧缩熊市',
    },
  ].forEach((spec) => {
    const window = maxDrawdownForWindow(portfolioSeries, spec.startDate, spec.endDate);
    if (!window) {
      return;
    }
    scenarios.push(buildStressScenarioFromWindow({
      benchmarkLabel: label,
      benchmarkSeries: normalizedBenchmarkSeries,
      id: spec.id,
      source: spec.source,
      title: spec.title,
      window,
    }));
  });

  return scenarios.slice(0, 3);
}

export function selectWorstCompositionStressScenario(
  scenarios: CompositionStressScenario[],
): CompositionStressScenario | null {
  return scenarios.reduce<CompositionStressScenario | null>(
    (worst, scenario) => (!worst || scenario.portfolioDrawdown < worst.portfolioDrawdown ? scenario : worst),
    null,
  );
}

import { useEffect, useState } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { useApiClient } from '../lib/demoStoreContext';
import { ApiError, type ApiBacktestRunDetail, type ApiStrategyDetail } from '../types';
import './creation-backtest.css';

type RunPrefill = {
  startDate: string | null;
  endDate: string | null;
  parameterVersionId: string | null;
  datasetSnapshotId: string | null;
  universeSnapshotId: string | null;
};

const TEXT = {
  loading: '正在加载策略',
  eyebrow: '真实执行',
  description: '确认回测区间、参数版本和快照状态，再生成正式回测。',
  backToStrategy: '返回策略',
  submit: '提交回测',
  parameterTitle: '提交参数',
  panelTitle: '提交前确认',
  panelCopy: '请先检查回测时间窗、提交所用参数版本，以及当前快照是否已经就绪。',
  rangeEyebrow: '回测区间',
  rangeTitle: '确认时间窗',
  rangeCopy: '先确认本次正式回测的开始和结束日期，再决定是否沿用快捷区间。',
  versionEyebrow: '参数版本',
  versionTitle: '确认策略版本',
  versionCopy: '这里展示当前准备提交的策略名称、参数版本、股票池以及再平衡设置。',
  snapshotEyebrow: '快照状态',
  snapshotTitle: '确认快照状态',
  snapshotCopy: '提交前请确认数据集与股票池快照是否可用，单标的策略不需要额外股票池快照。',
  startDate: '开始日期',
  endDate: '结束日期',
  lastTenYears: '最近10年',
  lastTwentyYears: '最近20年',
  lastThirtyYears: '最近30年',
  invalidDates: '开始日期必须早于或等于结束日期。',
  missingDates: '请先选择开始日期和结束日期。',
  sourceRunLoadFailed: '来源回测加载失败，已退回策略当前版本。',
  strategyName: '策略名称',
  parameterVersion: '参数版本',
  universeName: '股票池',
  rebalance: '再平衡',
  datasetSnapshot: '数据集快照',
  universeSnapshot: '股票池快照',
  sourceRun: '来源回测',
  submitState: '提交状态',
  readyToSubmit: '可提交',
  waitingConfirm: '待确认',
  refreshNeeded: '待刷新',
  singleSymbolDirect: '不适用（单标的）',
} as const;

const DEFAULT_START_DATE = '2016-03-24';
const DEFAULT_END_DATE = '2026-03-24';

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function readSnapshotValue(snapshot: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!snapshot) {
    return null;
  }
  for (const key of keys) {
    const value = readString(snapshot[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function isDirectSymbolUniverse(
  strategy: Pick<ApiStrategyDetail, 'strategy_type' | 'universe_name' | 'benchmark_symbol'> | null,
): boolean {
  if (!strategy) {
    return false;
  }
  const universeName = (strategy.universe_name ?? '').trim().toUpperCase();
  if (universeName) {
    if (['SP500', 'S&P500', 'SP-500', 'NASDAQ100', 'NASDAQ-100', 'NDX100', 'NDX-100'].includes(universeName)) {
      return false;
    }
    if (/^[A-Z0-9.]+$/.test(universeName)) {
      return true;
    }
  }
  const benchmarkSymbol = (strategy.benchmark_symbol ?? '').trim().toUpperCase();
  return strategy.strategy_type === 'GRID' && /^[A-Z0-9.]+$/.test(benchmarkSymbol || 'QQQ');
}

function readRunPrefill(detail: ApiBacktestRunDetail): RunPrefill {
  const chartSeries = detail.chart_series ?? [];
  const firstTradeDate = chartSeries[0]?.trade_date ?? null;
  const lastTradeDate = chartSeries[chartSeries.length - 1]?.trade_date ?? null;
  const snapshotSummary = detail.snapshot_summary ?? detail.preview?.snapshot_summary;
  const effectiveDate = readString(detail.effective_date);
  return {
    startDate: firstTradeDate ?? readString(detail.preview?.effective_start_date) ?? effectiveDate,
    endDate: lastTradeDate ?? readString(detail.preview?.effective_end_date) ?? effectiveDate,
    parameterVersionId:
      readString(detail.parameter_version_id) ?? readString(detail.preview?.parameter_version_id),
    datasetSnapshotId: readSnapshotValue(snapshotSummary, ['dataset_snapshot_id', 'datasetSnapshotId']),
    universeSnapshotId: readSnapshotValue(snapshotSummary, ['universe_snapshot_id', 'universeSnapshotId']),
  };
}

function KeyValue({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="kv-item creation-kv-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function BacktestSubmitPageCn({
  strategyId,
  sourceRunId,
}: {
  strategyId: string;
  sourceRunId?: string | null;
}): JSX.Element {
  const api = useApiClient();
  const [strategy, setStrategy] = useState<ApiStrategyDetail | null>(null);
  const [sourceRunDetail, setSourceRunDetail] = useState<ApiBacktestRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [sourceRunError, setSourceRunError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [startDate, setStartDate] = useState(DEFAULT_START_DATE);
  const [endDate, setEndDate] = useState(DEFAULT_END_DATE);

  useEffect(() => {
    let cancelled = false;

    async function loadStrategy(): Promise<void> {
      try {
        setLoading(true);
        setError(null);
        const payload = await api.getStrategyDetail(strategyId);
        if (!cancelled) {
          setStrategy(payload);
        }
      } catch (caught) {
        if (!cancelled) {
          setError((caught as Error).message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadStrategy();
    return () => {
      cancelled = true;
    };
  }, [api, strategyId]);

  useEffect(() => {
    if (!sourceRunId) {
      setSourceRunDetail(null);
      setSourceRunError(null);
      return;
    }
    const requestedSourceRunId: string = sourceRunId;

    let cancelled = false;

    async function loadSourceRun(): Promise<void> {
      try {
        const payload = await api.getBacktestRunDetail(requestedSourceRunId);
        if (cancelled) {
          return;
        }
        setSourceRunDetail(payload);
        const prefill = readRunPrefill(payload);
        if (prefill.startDate) {
          setStartDate(prefill.startDate);
        }
        if (prefill.endDate) {
          setEndDate(prefill.endDate);
        }
        setSourceRunError(null);
      } catch (caught) {
        if (!cancelled) {
          setSourceRunError((caught as Error).message);
          setSourceRunDetail(null);
        }
      }
    }

    void loadSourceRun();
    return () => {
      cancelled = true;
    };
  }, [api, sourceRunId]);

  const sourcePrefill = sourceRunDetail ? readRunPrefill(sourceRunDetail) : null;
  const directSymbolUniverse = isDirectSymbolUniverse(strategy);
  const effectiveParameterVersionId =
    sourcePrefill?.parameterVersionId ?? strategy?.current_parameter_version_id ?? null;
  const effectiveDatasetSnapshotId =
    sourcePrefill?.datasetSnapshotId ?? strategy?.dataset_snapshot_id ?? null;
  const effectiveUniverseSnapshotId =
    directSymbolUniverse ? null : sourcePrefill?.universeSnapshotId ?? strategy?.universe_snapshot_id ?? null;
  const submitState = strategy?.allowed_actions?.includes('backtest')
    ? TEXT.readyToSubmit
    : TEXT.waitingConfirm;

  function applyPreset(years: number): void {
    const end = new Date(DEFAULT_END_DATE);
    const start = new Date(end);
    start.setFullYear(end.getFullYear() - years);
    setStartDate(formatDate(start));
    setEndDate(DEFAULT_END_DATE);
  }

  function validateDates(): boolean {
    if (!startDate || !endDate) {
      setError(TEXT.missingDates);
      return false;
    }
    if (startDate > endDate) {
      setError(TEXT.invalidDates);
      return false;
    }
    return true;
  }

  async function submit(): Promise<void> {
    if (!validateDates()) {
      return;
    }

    try {
      setBusy(true);
      setError(null);
      const payload = await api.submitBacktestRun(strategyId, {
        idempotency_key: `run-${strategyId}`,
        start_date: startDate,
        end_date: endDate,
        parameter_version_id: effectiveParameterVersionId ?? undefined,
        dataset_snapshot_id: effectiveDatasetSnapshotId ?? undefined,
        universe_snapshot_id: effectiveUniverseSnapshotId ?? undefined,
        is_permanent: false,
        ...(sourceRunId ? { source_run_id: sourceRunId } : {}),
      });
      navigateTo(`/runs/${payload.id}`);
    } catch (caught) {
      const errorValue = caught as ApiError;
      setError(errorValue.blocking_code ? `${errorValue.message} (${errorValue.blocking_code})` : errorValue.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <section className="panel backtest-submit-page">
        <div className="panel-header">
          <h2>{TEXT.parameterTitle}</h2>
        </div>
        <p className="hero-copy">
          {TEXT.loading} {strategyId}...
        </p>
      </section>
    );
  }

  return (
    <div className="stack creation-shell backtest-submit-page">
      <section className="panel backtest-hero">
        <div className="backtest-hero__copy">
          <p className="eyebrow">{TEXT.eyebrow}</p>
          <h1>{strategy?.name ?? strategyId}</h1>
          <p className="hero-copy">{TEXT.description}</p>
        </div>
        <div className="backtest-hero__actions">
          <button className="ghost-button" onClick={() => navigateTo(`/strategies/${strategyId}`)} type="button">
            {TEXT.backToStrategy}
          </button>
          <button className="primary-button" disabled={busy} onClick={() => void submit()} type="button">
            {TEXT.submit}
          </button>
        </div>
      </section>

      {sourceRunError ? <div className="error-banner">{TEXT.sourceRunLoadFailed} {sourceRunError}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      <section className="panel backtest-submit-panel backtest-submit-panel--stack">
        <div className="panel-header">
          <div>
            <p className="eyebrow">{TEXT.parameterTitle}</p>
            <h3>{TEXT.panelTitle}</h3>
            <p className="hero-copy creation-panel-copy">{TEXT.panelCopy}</p>
          </div>
        </div>

        <div className="backtest-submit-sections">
          <section className="creation-subpanel backtest-submit-section">
            <div className="field-group__header">
              <div>
                <p className="eyebrow">{TEXT.rangeEyebrow}</p>
                <h4>{TEXT.rangeTitle}</h4>
              </div>
            </div>
            <p className="creation-step-card__copy">{TEXT.rangeCopy}</p>
            <div className="creation-date-grid">
              <label className="date-field">
                <span>{TEXT.startDate}</span>
                <input
                  aria-label={TEXT.startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  type="date"
                  value={startDate}
                />
              </label>
              <label className="date-field">
                <span>{TEXT.endDate}</span>
                <input
                  aria-label={TEXT.endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  type="date"
                  value={endDate}
                />
              </label>
            </div>
            <div className="chip-row">
              <button className="ghost-button" onClick={() => applyPreset(10)} type="button">
                {TEXT.lastTenYears}
              </button>
              <button className="ghost-button" onClick={() => applyPreset(20)} type="button">
                {TEXT.lastTwentyYears}
              </button>
              <button className="ghost-button" onClick={() => applyPreset(30)} type="button">
                {TEXT.lastThirtyYears}
              </button>
            </div>
          </section>

          <section className="creation-subpanel backtest-submit-section">
            <div className="field-group__header">
              <div>
                <p className="eyebrow">{TEXT.versionEyebrow}</p>
                <h4>{TEXT.versionTitle}</h4>
              </div>
            </div>
            <p className="creation-step-card__copy">{TEXT.versionCopy}</p>
            <div className="kv-grid backtest-submit-kv-grid">
              <KeyValue label={TEXT.strategyName} value={strategy?.name ?? strategyId} />
              <KeyValue label={TEXT.parameterVersion} value={effectiveParameterVersionId ?? '-'} />
              <KeyValue label={TEXT.universeName} value={strategy?.universe_name ?? '-'} />
              <KeyValue label={TEXT.rebalance} value={strategy?.rebalance_frequency ?? '-'} />
            </div>
          </section>

          <section className="creation-subpanel backtest-submit-section">
            <div className="field-group__header">
              <div>
                <p className="eyebrow">{TEXT.snapshotEyebrow}</p>
                <h4>{TEXT.snapshotTitle}</h4>
              </div>
            </div>
            <p className="creation-step-card__copy">{TEXT.snapshotCopy}</p>
            <div className="kv-grid backtest-submit-kv-grid">
              <KeyValue label={TEXT.datasetSnapshot} value={effectiveDatasetSnapshotId ?? TEXT.refreshNeeded} />
              <KeyValue label={TEXT.universeSnapshot} value={effectiveUniverseSnapshotId ?? TEXT.singleSymbolDirect} />
              <KeyValue label={TEXT.sourceRun} value={sourceRunId ?? '-'} />
              <KeyValue label={TEXT.submitState} value={submitState} />
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

export { BacktestSubmitPageCn as BacktestSubmitPage };

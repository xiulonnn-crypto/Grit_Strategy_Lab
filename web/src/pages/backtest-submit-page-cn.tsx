import { useEffect, useMemo, useState } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { useApiClient } from '../lib/demoStoreContext';
import { ApiError, type ApiBacktestRunDetail, type ApiBacktestSubmissionPreview, type ApiStrategyDetail } from '../types';
import './creation-backtest.css';

type RunPrefill = {
  startDate: string | null;
  endDate: string | null;
  parameterVersionId: string | null;
  datasetSnapshotId: string | null;
  universeSnapshotId: string | null;
};

const TEXT = {
  loading: '正在加载策略...',
  backToStrategy: '返回策略',
  refreshSnapshots: '刷新快照',
  preview: '预览发起',
  submit: '提交回测',
  parameterTitle: '提交参数',
  summaryTitle: '提交摘要',
  startDate: '开始日期',
  endDate: '结束日期',
  lastTenYears: '最近10年',
  lastTwentyYears: '最近20年',
  lastThirtyYears: '最近30年',
  invalidDates: '开始日期必须早于或等于结束日期。',
  missingDates: '请先选择开始日期和结束日期。',
  noPreview: '尚未生成预览，请先运行一次预览。',
  previewWarnings: '预览警告',
  previewMetrics: '预览指标',
  previewSnapshot: '快照摘要',
  parameterVersion: '参数版本',
  datasetSnapshot: '数据集快照',
  universeSnapshot: '股票池快照',
  sourceRunLoadFailed: '来源回测读取失败，已回退到当前策略默认参数。',
} as const;

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '-';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  return String(value);
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
    <div className="kv-item">
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
  const [preview, setPreview] = useState<ApiBacktestSubmissionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [sourceRunError, setSourceRunError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [startDate, setStartDate] = useState('2016-03-24');
  const [endDate, setEndDate] = useState('2026-03-24');

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

    let cancelled = false;

    async function loadSourceRun(): Promise<void> {
      try {
        const payload = await api.getBacktestRunDetail(sourceRunId);
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
  const effectiveParameterVersionId = sourcePrefill?.parameterVersionId ?? strategy?.current_parameter_version_id ?? null;
  const effectiveDatasetSnapshotId = sourcePrefill?.datasetSnapshotId ?? strategy?.dataset_snapshot_id ?? null;
  const effectiveUniverseSnapshotId = sourcePrefill?.universeSnapshotId ?? strategy?.universe_snapshot_id ?? null;

  function applyPreset(years: number): void {
    const end = new Date();
    const start = new Date(end);
    start.setFullYear(end.getFullYear() - years);
    setStartDate(formatDate(start));
    setEndDate(formatDate(end));
  }

  function validateDates(missingMessage: string): boolean {
    if (!startDate || !endDate) {
      setError(missingMessage);
      return false;
    }
    if (startDate > endDate) {
      setError(TEXT.invalidDates);
      return false;
    }
    return true;
  }

  async function refreshSnapshots(): Promise<void> {
    try {
      setBusy(true);
      setError(null);
      await api.refreshSnapshots();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runPreview(): Promise<void> {
    if (!validateDates(TEXT.missingDates)) {
      return;
    }

    try {
      setBusy(true);
      setError(null);
      const payload = await api.previewBacktestRun(strategyId, {
        start_date: startDate,
        end_date: endDate,
        parameter_version_id: effectiveParameterVersionId ?? undefined,
        dataset_snapshot_id: effectiveDatasetSnapshotId ?? undefined,
        universe_snapshot_id: effectiveUniverseSnapshotId ?? undefined,
        ...(sourceRunId ? { source_run_id: sourceRunId } : {}),
      });
      setPreview(payload);
    } catch (caught) {
      const errorValue = caught as ApiError;
      setError(errorValue.blocking_code ? `${errorValue.message} (${errorValue.blocking_code})` : errorValue.message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(): Promise<void> {
    if (!validateDates(TEXT.missingDates)) {
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

  const previewMetrics = useMemo(() => Object.entries(preview?.metrics ?? {}), [preview]);
  const previewSnapshots = useMemo(() => Object.entries(preview?.snapshot_summary ?? {}), [preview]);

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
      <section className="panel creation-hero">
        <div className="creation-hero__copy">
          <p className="eyebrow">真实执行</p>
          <h2>{strategy?.name ?? strategyId}</h2>
          <p className="hero-copy">为 {strategy?.name ?? strategyId} 生成正式回测预览，并保留本次相关的快照信息。</p>
        </div>
        <div className="hero-actions">
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

      <div className="creation-session-grid">
        <section className="panel creation-session-main">
          <div className="panel-header">
            <div>
              <h3>{TEXT.parameterTitle}</h3>
              <p className="hero-copy creation-panel-copy">先确认回测区间、参数版本与快照状态，再预览或提交。</p>
            </div>
          </div>

          <div className="kv-grid">
            <KeyValue label="股票池" value={strategy?.universe_name ?? '-'} />
            <KeyValue label={TEXT.parameterVersion} value={effectiveParameterVersionId ?? '-'} />
            <KeyValue label={TEXT.datasetSnapshot} value={effectiveDatasetSnapshotId ?? '-'} />
            <KeyValue label={TEXT.universeSnapshot} value={effectiveUniverseSnapshotId ?? '-'} />
            <KeyValue label="再平衡" value={strategy?.rebalance_frequency ?? '-'} />
            <KeyValue label="动作" value={strategy?.allowed_actions?.includes('backtest') ? '可提交' : '待确认'} />
          </div>

          <div className="creation-date-grid">
            <label>
              <span>{TEXT.startDate}</span>
              <input aria-label={TEXT.startDate} onChange={(event) => setStartDate(event.target.value)} type="date" value={startDate} />
            </label>
            <label>
              <span>{TEXT.endDate}</span>
              <input aria-label={TEXT.endDate} onChange={(event) => setEndDate(event.target.value)} type="date" value={endDate} />
            </label>
          </div>

          <div className="hero-actions">
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

          <div className="hero-actions">
            <button className="ghost-button" disabled={busy} onClick={() => void refreshSnapshots()} type="button">
              {TEXT.refreshSnapshots}
            </button>
            <button className="primary-button" disabled={busy} onClick={() => void runPreview()} type="button">
              {TEXT.preview}
            </button>
          </div>
        </section>

        <aside className="creation-session-sidebar">
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">{TEXT.summaryTitle}</p>
                <h3>提交前要先看的信息</h3>
              </div>
            </div>

            {preview ? (
              <div className="creation-preview-stack">
                <div className="kv-grid">
                  <KeyValue label="生效开始" value={formatValue(preview.effective_start_date ?? preview.effective_date)} />
                  <KeyValue label="生效结束" value={formatValue(preview.effective_end_date)} />
                  <KeyValue label="样本外切点" value={formatValue(preview.oos_start_date)} />
                  <KeyValue label="数据区间" value={formatValue(preview.data_segment_type)} />
                </div>

                <section className="creation-preview-group">
                  <h4>{TEXT.previewWarnings}</h4>
                  {preview.warnings?.length ? (
                    <div className="parameter-list">
                      {preview.warnings.map((warning, index) => (
                        <div className="parameter-row creation-parameter-row" key={`${warning}-${index}`}>
                          <strong>{TEXT.previewWarnings}</strong>
                          <span>{warning}</span>
                          <small>预览</small>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="empty-state">未返回预览警告。</p>
                  )}
                </section>

                <section className="creation-preview-group">
                  <h4>{TEXT.previewMetrics}</h4>
                  {previewMetrics.length ? (
                    <div className="kv-grid">
                      {previewMetrics.map(([key, value]) => (
                        <KeyValue key={key} label={key} value={formatValue(value)} />
                      ))}
                    </div>
                  ) : (
                    <p className="empty-state">暂无预览指标。</p>
                  )}
                </section>

                <section className="creation-preview-group">
                  <h4>{TEXT.previewSnapshot}</h4>
                  {previewSnapshots.length ? (
                    <div className="parameter-list">
                      {previewSnapshots.map(([key, value]) => (
                        <div className="parameter-row creation-parameter-row" key={key}>
                          <span>{key}</span>
                          <strong>{formatValue(value)}</strong>
                          <small>{TEXT.previewSnapshot}</small>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="empty-state">暂无快照摘要。</p>
                  )}
                </section>
              </div>
            ) : (
              <p className="empty-state">尚未生成预览，请先运行一次预览。</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

export { BacktestSubmitPageCn as BacktestSubmitPage };

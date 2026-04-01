import { useEffect, useMemo, useState } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { useApiClient } from '../lib/demoStoreContext';
import { formatPercent } from '../lib/format';
import { ApiError, type ApiBacktestSubmissionPreview, type ApiStrategyDetail } from '../types';
import './creation-backtest.css';

type PreviewMetric = {
  key: string;
  label: string;
  value: string;
};

const TEXT = {
  loading: '正在加载策略...',
  eyebrow: '真实执行',
  title: '真实回测提交',
  description: '为策略生成正式回测预览，并保留本次相关的快照信息。',
  backToStrategy: '返回策略',
  submit: '提交回测',
  preview: '预览发起',
  refreshSnapshots: '刷新快照',
  submitTitle: '提交参数',
  summaryTitle: '提交摘要',
  backtestHint: '先确认回测区间、参数版本与快照状态，再预览或提交。',
  startDate: '开始日期',
  endDate: '结束日期',
  parameterVersion: '参数版本',
  datasetSnapshot: '数据集快照',
  universeSnapshot: '股票池快照',
  previewWarnings: '预览警告',
  previewMetrics: '预览指标',
  previewSnapshot: '快照摘要',
  previewEmpty: '请先生成预览。',
  invalidRange: '开始日期必须不晚于结束日期。',
  missingDates: '请先选择开始日期和结束日期。',
} as const;

function KeyValue({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="kv-item creation-kv-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function translateMetricLabel(key: string): string {
  const map: Record<string, string> = {
    total_return: '累计收益',
    annual_return: '年化收益',
    sharpe: '夏普比率',
    max_drawdown: '最大回撤',
    win_rate: '胜率',
    coverage_ratio: '覆盖率',
    coverage_days: '覆盖天数',
    trades_count: '交易笔数',
  };
  return map[key] ?? key.replace(/_/g, ' ');
}

function formatMetricValue(key: string, value: unknown): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }
  if (key.includes('return') || key.includes('drawdown') || key.includes('rate')) {
    return formatPercent(value);
  }
  if (key.includes('sharpe') || key.includes('ratio')) {
    return value.toFixed(2);
  }
  return value >= 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}

function summarizePreviewValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '-';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => summarizePreviewValue(item)).join('，');
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .slice(0, 4)
      .map(([key, nextValue]) => `${translateMetricLabel(key)}: ${summarizePreviewValue(nextValue)}`)
      .join('；');
  }
  return String(value);
}

function shiftYears(date: Date, years: number): string {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() - years);
  return next.toISOString().slice(0, 10);
}

export function BacktestSubmitPage({ strategyId }: { strategyId: string }): JSX.Element {
  const api = useApiClient();
  const [strategy, setStrategy] = useState<ApiStrategyDetail | null>(null);
  const [preview, setPreview] = useState<ApiBacktestSubmissionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [startDate, setStartDate] = useState<string>('2016-03-24');
  const [endDate, setEndDate] = useState<string>('2026-03-24');

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
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

    void load();
    return () => {
      cancelled = true;
    };
  }, [api, strategyId]);

  const previewMetrics = useMemo<PreviewMetric[]>(() => {
    if (!preview?.metrics) {
      return [];
    }
    return Object.entries(preview.metrics)
      .slice(0, 6)
      .map(([key, value]) => ({
        key,
        label: translateMetricLabel(key),
        value: formatMetricValue(key, value),
      }));
  }, [preview]);

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
    if (!startDate || !endDate) {
      setError(TEXT.missingDates);
      return;
    }
    if (startDate > endDate) {
      setError(TEXT.invalidRange);
      return;
    }

    try {
      setBusy(true);
      setError(null);
      const payload = await api.previewBacktestRun(strategyId, {
        start_date: startDate,
        end_date: endDate,
        parameter_version_id: strategy?.current_parameter_version_id ?? undefined,
        dataset_snapshot_id: strategy?.dataset_snapshot_id ?? undefined,
        universe_snapshot_id: strategy?.universe_snapshot_id ?? undefined,
      });
      setPreview(payload);
    } catch (caught) {
      const errorValue = caught as ApiError;
      setError(
        errorValue.blocking_code
          ? `${errorValue.message} (${errorValue.blocking_code})`
          : errorValue.message,
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(): Promise<void> {
    if (!startDate || !endDate) {
      setError(TEXT.missingDates);
      return;
    }
    if (startDate > endDate) {
      setError(TEXT.invalidRange);
      return;
    }

    try {
      setBusy(true);
      setError(null);
      const payload = await api.submitBacktestRun(strategyId, {
        idempotency_key: `run-${strategyId}`,
        start_date: startDate,
        end_date: endDate,
        parameter_version_id: strategy?.current_parameter_version_id ?? undefined,
        dataset_snapshot_id: strategy?.dataset_snapshot_id ?? undefined,
        universe_snapshot_id: strategy?.universe_snapshot_id ?? undefined,
      });
      navigateTo(`/runs/${payload.id}`);
    } catch (caught) {
      const errorValue = caught as ApiError;
      setError(
        errorValue.blocking_code
          ? `${errorValue.message} (${errorValue.blocking_code})`
          : errorValue.message,
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <section className="panel backtest-submit-page">
        <div className="panel-header">
          <h2>{TEXT.title}</h2>
        </div>
        <p className="hero-copy">{TEXT.loading}</p>
      </section>
    );
  }

  return (
    <div className="stack creation-shell backtest-submit-page">
      <section className="backtest-hero panel">
        <div className="backtest-hero__copy">
          <p className="eyebrow">{TEXT.eyebrow}</p>
          <h2>{strategy?.name ?? strategyId}</h2>
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

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="creation-grid">
        <section className="panel backtest-submit-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">{TEXT.submitTitle}</p>
              <h3>验证回测区间</h3>
            </div>
          </div>

          <p className="hero-copy">{TEXT.backtestHint}</p>

          <div className="summary-grid">
            <KeyValue label={TEXT.startDate} value={startDate} />
            <KeyValue label={TEXT.endDate} value={endDate} />
            <KeyValue label={TEXT.parameterVersion} value={String(strategy?.current_parameter_version_id ?? '-')} />
            <KeyValue label={TEXT.datasetSnapshot} value={String(strategy?.dataset_snapshot_id ?? '-')} />
            <KeyValue label={TEXT.universeSnapshot} value={String(strategy?.universe_snapshot_id ?? '-')} />
            <KeyValue label="动作" value={strategy?.allowed_actions?.includes('backtest') ? '可提交' : '待确认'} />
          </div>

          <div className="date-row backtest-date-row">
            <label className="date-field">
              <span>{TEXT.startDate}</span>
              <input onChange={(event) => setStartDate(event.target.value)} type="date" value={startDate} />
            </label>
            <label className="date-field">
              <span>{TEXT.endDate}</span>
              <input onChange={(event) => setEndDate(event.target.value)} type="date" value={endDate} />
            </label>
          </div>

          <div className="chip-row">
            <button
              className="ghost-button"
              disabled={busy}
              onClick={() => {
                setStartDate(shiftYears(new Date('2026-03-24'), 10));
                setEndDate('2026-03-24');
              }}
              type="button"
            >
              最近10年
            </button>
            <button
              className="ghost-button"
              disabled={busy}
              onClick={() => {
                setStartDate(shiftYears(new Date('2026-03-24'), 20));
                setEndDate('2026-03-24');
              }}
              type="button"
            >
              最近20年
            </button>
            <button
              className="ghost-button"
              disabled={busy}
              onClick={() => {
                setStartDate(shiftYears(new Date('2026-03-24'), 30));
                setEndDate('2026-03-24');
              }}
              type="button"
            >
              最近30年
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

        <section className="panel backtest-summary-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">{TEXT.summaryTitle}</p>
              <h3>提交前要先看的信息</h3>
            </div>
          </div>

          {preview ? (
            <div className="creation-summary-stack">
              <div className="summary-grid">
                <KeyValue label="有效开始" value={String(preview.effective_start_date ?? '-')} />
                <KeyValue label="有效结束" value={String(preview.effective_end_date ?? '-')} />
                <KeyValue label="数据分段" value={String(preview.data_segment_type ?? '-')} />
                <KeyValue label="OOS" value={String(preview.oos_start_date ?? '-')} />
              </div>

              {preview.snapshot_summary || preview.parameter_snapshot || preview.environment_summary ? (
                <section className="creation-subpanel">
                  <div className="panel-header">
                    <div>
                      <p className="eyebrow">{TEXT.previewSnapshot}</p>
                      <h4>提交前的快照信息</h4>
                    </div>
                  </div>
                  <div className="info-list">
                    <article className="info-card">
                      <strong>数据集快照</strong>
                      <p>{summarizePreviewValue(preview.snapshot_summary ?? '-')}</p>
                    </article>
                    <article className="info-card">
                      <strong>参数快照</strong>
                      <p>{summarizePreviewValue(preview.parameter_snapshot ?? '-')}</p>
                    </article>
                    <article className="info-card">
                      <strong>环境快照</strong>
                      <p>{summarizePreviewValue(preview.environment_summary ?? '-')}</p>
                    </article>
                  </div>
                </section>
              ) : null}

              {preview.warnings?.length ? (
                <section className="creation-subpanel">
                  <div className="panel-header">
                    <div>
                      <p className="eyebrow">{TEXT.previewWarnings}</p>
                      <h4>预览警告</h4>
                    </div>
                  </div>
                  <div className="info-list">
                    {preview.warnings.map((warning, index) => (
                      <article className="info-card" key={`${warning}-${index}`}>
                        <strong>{warning}</strong>
                        <p>请在提交前再检查一次。</p>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="creation-subpanel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">{TEXT.previewMetrics}</p>
                    <h4>预览指标</h4>
                  </div>
                </div>
                {previewMetrics.length ? (
                  <div className="info-list">
                    {previewMetrics.map((metric) => (
                      <article className="info-card" key={metric.key}>
                        <strong>{metric.label}</strong>
                        <p>{metric.value}</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="empty-state">{TEXT.previewEmpty}</p>
                )}
              </section>
            </div>
          ) : (
            <p className="empty-state">{TEXT.previewEmpty}</p>
          )}
        </section>
      </div>
    </div>
  );
}

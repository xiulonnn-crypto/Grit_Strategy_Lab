import { useEffect, useState } from 'react';
import { RunDetailAuditPanel } from '../page-sections/run-detail-audit';
import { formatShortDate } from '../lib/format';
import { useApiClient } from '../lib/demoStoreContext';
import type { ApiBacktestRunDetail, ApiBacktestRunTradeAudit } from '../types';

function MetricCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function formatMetric(value: unknown): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }
  return value.toFixed(4);
}

function formatRunRange(detail: ApiBacktestRunDetail): string {
  const chartSeries = detail.chart_series ?? [];
  if (!chartSeries.length) {
    return 'Range unavailable';
  }

  const first = chartSeries[0]?.trade_date;
  const last = chartSeries[chartSeries.length - 1]?.trade_date;
  if (!first || !last) {
    return 'Range unavailable';
  }

  return `${formatShortDate(first)} to ${formatShortDate(last)}`;
}

export function RunDetailPage({ runId }: { runId: string }): JSX.Element {
  const api = useApiClient();
  const [detail, setDetail] = useState<ApiBacktestRunDetail | null>(null);
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [audit, setAudit] = useState<ApiBacktestRunTradeAudit | null>(null);
  const [loading, setLoading] = useState(true);
  const [auditLoading, setAuditLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        setLoading(true);
        setError(null);
        const runDetail = await api.getBacktestRunDetail(runId);
        if (cancelled) {
          return;
        }

        setDetail(runDetail);
        setActiveTradeId(runDetail.trade_audit_items?.[0]?.trade_id ?? null);
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
  }, [api, runId]);

  useEffect(() => {
    let cancelled = false;

    async function loadAudit(): Promise<void> {
      if (!activeTradeId) {
        setAudit(null);
        return;
      }

      try {
        setAuditLoading(true);
        setAuditError(null);
        const nextAudit = await api.getBacktestTradeAudit(runId, activeTradeId);
        if (!cancelled) {
          setAudit(nextAudit);
        }
      } catch (caught) {
        if (!cancelled) {
          setAuditError((caught as Error).message);
        }
      } finally {
        if (!cancelled) {
          setAuditLoading(false);
        }
      }
    }

    void loadAudit();
    return () => {
      cancelled = true;
    };
  }, [activeTradeId, api, runId]);

  if (loading) {
    return (
      <section className="panel">
        <div className="panel-header">
          <h3>Run Detail</h3>
        </div>
        <p className="hero-copy">Loading run detail...</p>
      </section>
    );
  }

  if (error || !detail) {
    return (
      <section className="panel">
        <div className="panel-header">
          <h3>Run Detail</h3>
        </div>
        <p className="hero-copy">{error ?? 'Run detail could not be loaded.'}</p>
      </section>
    );
  }

  return (
    <div className="stack">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Run Detail</p>
          <h2>Run {detail.id}</h2>
          <p className="hero-copy">
            Range {formatRunRange(detail)} · Segment {detail.data_segment_type ?? 'FULL'} · Permanent{' '}
            {detail.is_permanent ? 'yes' : 'no'}
          </p>
        </div>
        <div className="hero-actions">
          <span className="status-chip">Return {formatMetric(detail.metrics.total_return)}</span>
          <span className="status-chip">Sharpe {formatMetric(detail.metrics.sharpe)}</span>
          <span className="status-chip">Max DD {formatMetric(detail.metrics.max_drawdown)}</span>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Run Detail</h2>
          <span className="status-chip">{detail.status}</span>
        </div>
        <div className="stats-grid">
          <MetricCard label="CAGR" value={formatMetric(detail.metrics.cagr)} />
          <MetricCard label="Sharpe" value={formatMetric(detail.metrics.sharpe)} />
          <MetricCard label="Max DD" value={formatMetric(detail.metrics.max_drawdown)} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Main Curve</p>
            <h3>Equity curve</h3>
          </div>
          <span className="status-chip">{detail.data_segment_type ?? 'FULL'}</span>
        </div>
        {detail.chart_series?.length ? (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Equity</th>
                  <th>Benchmark</th>
                  <th>Drawdown</th>
                  <th>Segment</th>
                </tr>
              </thead>
              <tbody>
                {detail.chart_series.slice(-12).map((point) => (
                  <tr key={point.trade_date}>
                    <td>{point.trade_date}</td>
                    <td>{point.equity.toFixed(2)}</td>
                    <td>{point.benchmark.toFixed(2)}</td>
                    <td>{point.drawdown.toFixed(2)}%</td>
                    <td>{point.is_oos ? 'OOS' : 'IS'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">No chart series was returned for this run.</p>
        )}
      </section>

      {detail.trade_audit_items?.length ? (
        <RunDetailAuditPanel
          activeTradeId={activeTradeId}
          audit={audit}
          auditError={auditError}
          auditLoading={auditLoading}
          detail={detail}
          onSelectTrade={setActiveTradeId}
        />
      ) : (
        <section className="panel">
          <div className="panel-header">
            <h3>Trade Audit</h3>
          </div>
          <p className="empty-state">This run has no trade audit episodes yet.</p>
        </section>
      )}
    </div>
  );
}

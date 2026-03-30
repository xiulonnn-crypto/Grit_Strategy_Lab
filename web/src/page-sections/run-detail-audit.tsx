import { formatDateTime, formatPercent, formatShortDate } from '../lib/format';
import type { ApiBacktestRunDetail, ApiBacktestRunTradeAudit } from '../types';

type RunDetailAuditPanelProps = {
  detail: ApiBacktestRunDetail;
  activeTradeId: string | null;
  audit: ApiBacktestRunTradeAudit | null;
  auditLoading?: boolean;
  auditError?: string | null;
  onSelectTrade: (tradeId: string) => void;
};

export function RunDetailAuditPanel({
  detail,
  activeTradeId,
  audit,
  auditLoading,
  auditError,
  onSelectTrade,
}: RunDetailAuditPanelProps): JSX.Element {
  const auditItems = detail.trade_audit_items ?? [];

  return (
    <div className="stack">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Interactive Trade Audit</p>
          <h2>Run {detail.id}</h2>
          <p className="hero-copy">
            Status {detail.status} · Segment {detail.data_segment_type ?? 'FULL'} · Permanent{' '}
            {detail.is_permanent ? 'yes' : 'no'}
          </p>
        </div>
        <div className="hero-actions">
          <span className="status-chip">Sharpe {detail.metrics.sharpe?.toFixed(2) ?? 'n/a'}</span>
          <span className="status-chip">Return {detail.metrics.total_return?.toFixed(1) ?? 'n/a'}%</span>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Chart Table Sync</p>
            <h3>{audit ? `${audit.symbol} episode` : 'Select a trade episode'}</h3>
          </div>
          {audit ? <span className="status-chip">{audit.segment}</span> : null}
        </div>

        {auditError ? <div className="error-banner">{auditError}</div> : null}

        {audit ? (
          <div className="audit-chart-shell" data-testid="trade-audit-chart">
            <div
              className={`audit-chart-band ${audit.chart_band.color === 'green' ? 'audit-chart-band-positive' : 'audit-chart-band-negative'}`}
              data-testid="trade-chart-band"
            >
              {audit.chart_band.color === 'green' ? 'Trend captured' : 'Chopped in noise'} ·{' '}
              {formatPercent(audit.chart_band.pnl_pct)}
            </div>
            <div className="audit-price-grid">
              {audit.price_series.map((point) => {
                const marker =
                  point.date === audit.entry_marker.date
                    ? 'Entry'
                    : point.date === audit.exit_marker.date
                      ? 'Exit'
                      : '';
                return (
                  <div
                    className={`audit-price-point ${point.date === audit.entry_marker.date || point.date === audit.exit_marker.date ? 'audit-price-point-active' : ''}`}
                    key={`${audit.trade_id}-${point.date}`}
                  >
                    <strong>{formatShortDate(point.date)}</strong>
                    <span>{point.close.toFixed(2)}</span>
                    {marker ? <small>{marker}</small> : null}
                  </div>
                );
              })}
            </div>
            <div className="audit-summary-grid">
              <div className="kv-item">
                <span>Opened</span>
                <strong>{formatDateTime(audit.opened_at)}</strong>
              </div>
              <div className="kv-item">
                <span>Closed</span>
                <strong>{formatDateTime(audit.closed_at)}</strong>
              </div>
              <div className="kv-item">
                <span>MFE / MAE</span>
                <strong>
                  {formatPercent(audit.max_favorable_excursion_pct)} /{' '}
                  {formatPercent(audit.max_adverse_excursion_pct)}
                </strong>
              </div>
            </div>
          </div>
        ) : (
          <p className="empty-state">{auditLoading ? 'Loading trade audit...' : 'No trade audit selected.'}</p>
        )}
      </section>

      <section className="panel audit-detail-grid">
        <div>
          <div className="panel-header">
            <h3>Trade Episodes</h3>
          </div>
          <div className="audit-row-list">
            {auditItems.map((item) => (
              <button
                className={`audit-row-button ${item.trade_id === activeTradeId ? 'audit-row-button-active' : ''}`}
                key={item.trade_id}
                onClick={() => onSelectTrade(item.trade_id)}
                type="button"
              >
                <strong>{item.symbol}</strong>
                <span>{formatPercent(item.pnl_pct)}</span>
                <small>{item.commentary}</small>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="panel-header">
            <h3>Trigger Snapshot</h3>
          </div>
          {audit ? (
            <div className="parameter-list">
              {Object.entries(audit.trigger_snapshot).map(([key, value]) => (
                <div className="parameter-row" key={`${audit.trade_id}-${key}`}>
                  <strong>{key}</strong>
                  <span>{String(value)}</span>
                  <small>{audit.symbol}</small>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-state">Trigger snapshot appears after you select an episode.</p>
          )}
        </div>

        <div>
          <div className="panel-header">
            <h3>Risk Evaluation</h3>
          </div>
          {audit ? (
            <div className="parameter-list">
              <div className="parameter-row">
                <strong>MFE / MAE Ratio</strong>
                <span>{audit.risk_evaluation.mfe_mae_ratio.toFixed(2)}</span>
                <small>Efficiency</small>
              </div>
              <div className="parameter-row">
                <strong>Slippage Cost</strong>
                <span>{formatPercent(audit.risk_evaluation.slippage_cost_pct)}</span>
                <small>Execution drag</small>
              </div>
              <div className="parameter-row">
                <strong>Commentary</strong>
                <span>{audit.risk_evaluation.commentary}</span>
                <small>Risk note</small>
              </div>
            </div>
          ) : (
            <p className="empty-state">Risk evaluation appears after you select an episode.</p>
          )}
        </div>
      </section>
    </div>
  );
}

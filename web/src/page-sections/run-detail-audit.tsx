import { formatDateTime, formatShortDate } from '../lib/format';
import type { ApiBacktestRunDetail, ApiBacktestRunTradeAudit } from '../types';

type RunDetailAuditPanelProps = {
  detail: ApiBacktestRunDetail;
  activeTradeId: string | null;
  audit: ApiBacktestRunTradeAudit | null;
  auditLoading?: boolean;
  auditError?: string | null;
  onSelectTrade: (tradeId: string) => void;
};

type PricePoint = {
  date: string;
  close: number;
};

function formatSmartPercent(value: number | null | undefined, digits = 1): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  const normalized = Math.abs(value) > 1 ? value : value * 100;
  return `${normalized >= 0 ? '+' : ''}${normalized.toFixed(digits)}%`;
}

function formatValue(value: unknown): string {
  if (value === null || typeof value === 'undefined') {
    return '—';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toLocaleString('zh-HK') : value.toFixed(2);
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function buildPricePath(priceSeries: PricePoint[], width: number, height: number): string {
  if (!priceSeries.length) {
    return '';
  }
  const prices = priceSeries.map((point) => point.close);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const horizontalPadding = 18;
  const verticalPadding = 16;
  return priceSeries
    .map((point, index) => {
      const x =
        horizontalPadding +
        ((width - horizontalPadding * 2) * (priceSeries.length === 1 ? 0 : index)) / Math.max(priceSeries.length - 1, 1);
      const y =
        verticalPadding +
        ((height - verticalPadding * 2) * ((max - point.close) / Math.max(max - min, 1))) /
          1;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

function KeyValueCard({
  title,
  value,
}: {
  title: string;
  value: Record<string, unknown> | undefined;
}): JSX.Element {
  const entries = Object.entries(value ?? {});
  return (
    <section className="run-detail-property-card">
      <div className="panel-header">
        <div>
          <h4>{title}</h4>
        </div>
      </div>
      {entries.length ? (
        <div className="run-detail-kv-grid">
          {entries.map(([key, nextValue]) => (
            <div className="run-detail-kv-row" key={`${title}-${key}`}>
              <span>{key}</span>
              <strong>{formatValue(nextValue)}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-state">暂无数据。</p>
      )}
    </section>
  );
}

export function RunDetailAuditPanel({
  detail,
  activeTradeId,
  audit,
  auditLoading,
  auditError,
  onSelectTrade,
}: RunDetailAuditPanelProps): JSX.Element {
  const auditItems = detail.trade_audit_items ?? [];
  const snapshotSummary = detail.snapshot_summary ?? detail.preview?.snapshot_summary ?? undefined;
  const parameterSnapshot = detail.parameter_snapshot ?? detail.preview?.parameter_snapshot ?? undefined;
  const environmentSummary = detail.environment_summary ?? detail.preview?.environment_summary ?? undefined;
  const priceSeries = (audit?.price_series ?? []).map((point) => ({
    date: point.date,
    close: point.close,
  }));

  return (
    <div className="run-detail-tab-panel run-detail-evidence-layout">
      <section className="panel run-detail-evidence-list-panel">
        <div className="panel-header">
          <div>
            <h3>交易证据列表</h3>
            <p className="run-detail-section-copy">选择一笔成交后，右侧同步展示证据卡与触发快照。</p>
          </div>
          <span className="status-chip status-chip--soft">{auditItems.length} 笔</span>
        </div>

        {auditError ? <div className="error-banner">{auditError}</div> : null}

        {auditItems.length ? (
          <div className="run-detail-audit-list">
            {auditItems.map((item) => (
              <button
                className={`run-detail-audit-row ${item.trade_id === activeTradeId ? 'run-detail-audit-row--active' : ''}`}
                key={item.trade_id}
                onClick={() => onSelectTrade(item.trade_id)}
                type="button"
              >
                <div className="run-detail-audit-row__row">
                  <strong>{item.symbol}</strong>
                  <span>{item.segment === 'OOS' ? '测试集' : item.segment === 'IS' ? '训练集' : item.segment}</span>
                </div>
                <div className="run-detail-audit-row__row">
                  <strong>{formatSmartPercent(item.pnl_pct)}</strong>
                  <span>
                    {formatShortDate(item.opened_at)} - {formatShortDate(item.closed_at)}
                  </span>
                </div>
                <small>{item.commentary}</small>
              </button>
            ))}
          </div>
        ) : (
          <p className="empty-state">暂无证据列表。</p>
        )}
      </section>

      <section className="panel run-detail-evidence-detail-panel">
        <div className="panel-header">
          <div>
            <h3>{audit ? `${audit.symbol} 证据卡` : '证据卡'}</h3>
            <p className="run-detail-section-copy">用于解释入场、出场、滑点与风险评价，不抢首屏主报告层级。</p>
          </div>
          {audit ? <span className="status-chip status-chip--soft">{audit.segment === 'OOS' ? '测试集' : audit.segment === 'IS' ? '训练集' : audit.segment}</span> : null}
        </div>

        {auditLoading ? <p className="empty-state">正在加载证据轨迹…</p> : null}

        {!auditLoading && !audit ? <p className="empty-state">请选择一条交易证据。</p> : null}

        {audit ? (
          <div className="run-detail-evidence-detail-stack">
            <div className="run-detail-evidence-summary">
              <div className="run-detail-kv-grid">
                <div className="run-detail-kv-row">
                  <span>开仓时间</span>
                  <strong>{formatDateTime(audit.opened_at)}</strong>
                </div>
                <div className="run-detail-kv-row">
                  <span>平仓时间</span>
                  <strong>{formatDateTime(audit.closed_at)}</strong>
                </div>
                <div className="run-detail-kv-row">
                  <span>净盈亏</span>
                  <strong>{formatSmartPercent(audit.pnl_pct)}</strong>
                </div>
                <div className="run-detail-kv-row">
                  <span>滑点成本</span>
                  <strong>{formatSmartPercent(audit.slippage_cost_pct)}</strong>
                </div>
              </div>
              <p className="run-detail-audit-copy">{audit.commentary}</p>
            </div>

            <div className="run-detail-evidence-price-shell">
              <div className="run-detail-evidence-price-head">
                <strong>价格轨迹</strong>
                <span>
                  {priceSeries.length ? `${formatShortDate(priceSeries[0].date)} - ${formatShortDate(priceSeries[priceSeries.length - 1].date)}` : '暂无区间'}
                </span>
              </div>
              {priceSeries.length ? (
                <svg className="run-detail-mini-chart" viewBox="0 0 360 150" preserveAspectRatio="none" role="img" aria-label="价格轨迹">
                  <defs>
                    <linearGradient id="evidence-price-fill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="rgba(31, 135, 123, 0.16)" />
                      <stop offset="100%" stopColor="rgba(31, 135, 123, 0.02)" />
                    </linearGradient>
                  </defs>
                  <path className="run-detail-audit-price-path" d={buildPricePath(priceSeries, 360, 150)} />
                </svg>
              ) : (
                <p className="empty-state">暂无价格轨迹。</p>
              )}
            </div>

            <KeyValueCard title="触发快照" value={audit.trigger_snapshot as Record<string, unknown>} />
          </div>
        ) : null}
      </section>

      <section className="panel run-detail-evidence-snapshot-panel">
        <div className="panel-header">
          <div>
            <h3>配置与环境快照</h3>
            <p className="run-detail-section-copy">保留当前回测上下文，便于解释成交证据是否受参数或数据集影响。</p>
          </div>
        </div>
        <div className="run-detail-properties-grid run-detail-properties-grid--stacked">
          <KeyValueCard title="数据快照摘要" value={snapshotSummary} />
          <KeyValueCard title="参数快照" value={parameterSnapshot} />
          <KeyValueCard title="环境摘要" value={environmentSummary} />
        </div>
      </section>
    </div>
  );
}

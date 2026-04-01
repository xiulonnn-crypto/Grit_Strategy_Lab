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

function renderEntries(title: string, value: Record<string, unknown> | undefined): JSX.Element {
  const entries = Object.entries(value ?? {});
  return (
    <section className="run-detail-snapshot-card">
      <div className="panel-header">
        <div>
          <h4>{title}</h4>
          <p className="run-detail-section-copy">保留当前回测的关键配置证据，便于下钻到单笔交易。</p>
        </div>
      </div>
      {entries.length ? (
        <div className="run-detail-kv-grid">
          {entries.map(([key, nextValue]) => (
            <div className="run-detail-kv-row" key={`${title}-${key}`}>
              <span>{key}</span>
              <strong>{typeof nextValue === 'object' && nextValue !== null ? JSON.stringify(nextValue) : String(nextValue)}</strong>
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

  return (
    <div className="run-detail-evidence-grid">
      <section className="panel run-detail-evidence-rail">
        <div className="panel-header">
          <div>
            <p className="eyebrow">证据轨迹</p>
            <h3>交易明细与证据链</h3>
            <p className="run-detail-section-copy">这里保持为次级分析区，不抢主报告的视觉层级，但仍能快速定位交易证据。</p>
          </div>
          <span className="status-chip">{auditItems.length} 条</span>
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
                  <span>{item.segment}</span>
                </div>
                <div className="run-detail-audit-row__row">
                  <strong>{formatPercent(item.pnl_pct)}</strong>
                  <span>
                    {formatShortDate(item.opened_at)} - {formatShortDate(item.closed_at)}
                  </span>
                </div>
                <small>{item.commentary}</small>
              </button>
            ))}
          </div>
        ) : (
          <p className="empty-state">暂无证据轨迹。</p>
        )}

        {audit ? (
          <article className="run-detail-audit-summary">
            <div className="panel-header">
              <div>
                <h4>{audit.symbol} 证据卡</h4>
                <p className="run-detail-section-copy">单笔证据卡用于解释入场、出场与滑点影响，不作为首屏核心信息。</p>
              </div>
              <span className="status-chip status-chip--soft">{audit.segment}</span>
            </div>
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
                <strong>{formatPercent(audit.pnl_pct)}</strong>
              </div>
              <div className="run-detail-kv-row">
                <span>滑点成本</span>
                <strong>{formatPercent(audit.slippage_cost_pct)}</strong>
              </div>
            </div>
            <p className="run-detail-audit-copy">{audit.commentary}</p>
          </article>
        ) : (
          <p className="empty-state">{auditLoading ? '正在加载证据轨迹…' : '请选择一条证据轨迹。'}</p>
        )}
      </section>

      <section className="panel run-detail-snapshot-stack">
        <div className="panel-header">
          <div>
            <p className="eyebrow">配置快照</p>
            <h3>存储与环境证据</h3>
          </div>
        </div>
        {renderEntries('数据快照摘要', snapshotSummary)}
        {renderEntries('参数快照', parameterSnapshot)}
        {renderEntries('环境摘要', environmentSummary)}
        {audit ? renderEntries('触发快照', audit.trigger_snapshot as Record<string, unknown>) : null}
      </section>
    </div>
  );
}

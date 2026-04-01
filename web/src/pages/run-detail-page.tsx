import { useEffect, useState } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { formatCurrency, formatPercent, formatShortDate } from '../lib/format';
import { useApiClient } from '../lib/demoStoreContext';
import { RunDetailAuditPanel } from '../page-sections/run-detail-audit';
import { RunDetailDiagnostics } from '../page-sections/run-detail-diagnostics';
import type {
  ApiBacktestRunDetail,
  ApiBacktestRunTradeAudit,
  ApiBacktestRunTradePage,
} from '../types';
import './run-detail-page.css';

type ViewWindow = 'all' | '1y' | '3y';
type TradeSegment = 'all' | 'IS' | 'OOS';

const TRADE_SEGMENT_OPTIONS: Array<{ value: TradeSegment; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'IS', label: '训练段' },
  { value: 'OOS', label: '样本外' },
];

const TRADE_PAGE_SIZE = 12;

function formatRunRange(detail: ApiBacktestRunDetail): string {
  const series = detail.chart_series ?? [];
  if (!series.length) {
    return '暂无区间';
  }

  const start = series[0]?.trade_date;
  const end = series[series.length - 1]?.trade_date;
  if (!start || !end) {
    return '暂无区间';
  }

  return `${formatShortDate(start)} - ${formatShortDate(end)}`;
}

function formatTradeSide(side: string): string {
  const normalized = side.toUpperCase();
  if (normalized === 'BUY') {
    return '买入';
  }
  if (normalized === 'SELL') {
    return '卖出';
  }
  return side;
}

function formatTradeMoney(value: number | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  return formatCurrency(value);
}

function formatTradeQuantity(value: number | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  return value.toLocaleString('zh-HK');
}

function formatRunStatus(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.includes('complete') || normalized.includes('done') || normalized.includes('success')) {
    return '已完成';
  }
  if (normalized.includes('running') || normalized.includes('pending') || normalized.includes('queued')) {
    return '进行中';
  }
  if (normalized.includes('fail') || normalized.includes('error')) {
    return '失败';
  }
  return value;
}

function readRecordString(record: Record<string, unknown> | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.length ? value : null;
}

function getStrategyTitle(detail: ApiBacktestRunDetail): string {
  return (
    detail.strategy_name ??
    readRecordString(detail.parameter_snapshot as Record<string, unknown> | undefined, 'strategy_name') ??
    readRecordString(detail.parameter_snapshot as Record<string, unknown> | undefined, 'objective') ??
    detail.id
  );
}

function getRunWindow(detail: ApiBacktestRunDetail): { startDate: string | null; endDate: string | null } {
  const series = detail.chart_series ?? [];
  const firstTradeDate = series[0]?.trade_date ?? null;
  const lastTradeDate = series[series.length - 1]?.trade_date ?? null;
  return {
    startDate: detail.preview?.effective_start_date ?? firstTradeDate ?? detail.effective_date ?? null,
    endDate: detail.preview?.effective_end_date ?? lastTradeDate ?? detail.completed_at?.slice(0, 10) ?? null,
  };
}

function buildCopyPayload(detail: ApiBacktestRunDetail): Record<string, unknown> {
  const runWindow = getRunWindow(detail);
  return {
    run_id: detail.id,
    strategy_id: detail.strategy_id ?? null,
    start_date: runWindow.startDate,
    end_date: runWindow.endDate,
    data_segment_type: detail.data_segment_type ?? detail.preview?.data_segment_type ?? null,
    parameter_version_id: detail.parameter_version_id ?? detail.preview?.parameter_version_id ?? null,
    oos_start_date: detail.oos_start_date ?? null,
    snapshot_summary: detail.snapshot_summary ?? detail.preview?.snapshot_summary ?? null,
    parameter_snapshot: detail.parameter_snapshot ?? detail.preview?.parameter_snapshot ?? null,
  };
}

async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error('浏览器不支持剪贴板复制。');
  }
}

export function RunDetailPage({ runId }: { runId: string }): JSX.Element {
  const api = useApiClient();
  const [detail, setDetail] = useState<ApiBacktestRunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [windowRange, setWindowRange] = useState<ViewWindow>('all');
  const [showTrades, setShowTrades] = useState(false);
  const [tradeSegment, setTradeSegment] = useState<TradeSegment>('all');
  const [tradePage, setTradePage] = useState(1);
  const [trades, setTrades] = useState<ApiBacktestRunTradePage | null>(null);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [tradesError, setTradesError] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const [audit, setAudit] = useState<ApiBacktestRunTradeAudit | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [copyBusy, setCopyBusy] = useState(false);
  const [optimizationBusy, setOptimizationBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadDetail(): Promise<void> {
      try {
        setDetailLoading(true);
        setDetailError(null);
        const payload = await api.getBacktestRunDetail(runId);
        if (cancelled) {
          return;
        }
        setDetail(payload);
        setSelectedTradeId((current) => current ?? payload.trade_audit_items?.[0]?.trade_id ?? null);
      } catch (caught) {
        if (!cancelled) {
          setDetailError((caught as Error).message);
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    }

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [api, runId]);

  useEffect(() => {
    if (!showTrades) {
      return;
    }

    let cancelled = false;

    async function loadTrades(): Promise<void> {
      try {
        setTradesLoading(true);
        setTradesError(null);
        const payload = await api.getBacktestRunTrades(runId, {
          page: tradePage,
          page_size: TRADE_PAGE_SIZE,
          segment: tradeSegment,
        });
        if (!cancelled) {
          setTrades(payload);
        }
      } catch (caught) {
        if (!cancelled) {
          setTradesError((caught as Error).message);
        }
      } finally {
        if (!cancelled) {
          setTradesLoading(false);
        }
      }
    }

    void loadTrades();
    return () => {
      cancelled = true;
    };
  }, [api, runId, showTrades, tradePage, tradeSegment]);

  useEffect(() => {
    if (!showEvidence) {
      setAudit(null);
      setAuditError(null);
      return;
    }

    if (!selectedTradeId) {
      setAudit(null);
      setAuditError(null);
      return;
    }

    const tradeId = selectedTradeId;
    let cancelled = false;

    async function loadAudit(): Promise<void> {
      try {
        setAuditLoading(true);
        setAuditError(null);
        const payload = await api.getBacktestTradeAudit(runId, tradeId);
        if (!cancelled) {
          setAudit(payload);
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
  }, [api, runId, selectedTradeId, showEvidence]);

  useEffect(() => {
    if (!showEvidence || selectedTradeId) {
      return;
    }
    const firstTradeId = detail?.trade_audit_items?.[0]?.trade_id ?? null;
    if (firstTradeId) {
      setSelectedTradeId(firstTradeId);
    }
  }, [detail, selectedTradeId, showEvidence]);

  useEffect(() => {
    if (!actionNotice) {
      return;
    }
    const timer = window.setTimeout(() => setActionNotice(null), 3500);
    return () => window.clearTimeout(timer);
  }, [actionNotice]);

  async function handleCopyConfiguration(): Promise<void> {
    if (!detail) {
      return;
    }

    try {
      setCopyBusy(true);
      setActionNotice(null);
      await copyToClipboard(JSON.stringify(buildCopyPayload(detail), null, 2));
      setActionNotice('已复制配置 JSON。');
    } catch (caught) {
      setActionNotice(`复制失败：${(caught as Error).message}`);
    } finally {
      setCopyBusy(false);
    }
  }

  function handleRerunBacktest(): void {
    if (!detail?.strategy_id) {
      return;
    }
    setActionNotice(null);
    navigateTo(
      `/strategies/${encodeURIComponent(detail.strategy_id)}/backtest-runs/new?source_run_id=${encodeURIComponent(detail.id)}`,
    );
  }

  async function handleCreateOptimization(): Promise<void> {
    if (!detail?.strategy_id) {
      return;
    }

    try {
      setOptimizationBusy(true);
      setActionNotice(null);
      const job = await api.createOptimizationJob(detail.strategy_id);
      navigateTo(`/optimization-jobs/${job.id}`);
    } catch (caught) {
      setActionNotice(`启动优化失败：${(caught as Error).message}`);
    } finally {
      setOptimizationBusy(false);
    }
  }

  if (detailLoading) {
    return (
      <section className="panel">
        <div className="panel-header">
          <h3>运行详情</h3>
        </div>
        <p className="hero-copy">正在加载回测详情…</p>
      </section>
    );
  }

  if (detailError || !detail) {
    return (
      <section className="panel">
        <div className="panel-header">
          <h3>运行详情</h3>
        </div>
        <p className="hero-copy">{detailError ?? '回测详情暂时无法加载。'}</p>
      </section>
    );
  }

  const strategyName = getStrategyTitle(detail);
  const runStatus = formatRunStatus(detail.status);
  const runWindow = getRunWindow(detail);
  const canRerun = Boolean(detail.strategy_id);
  const canOptimize = Boolean(detail.strategy_id);

  return (
    <div className="stack run-detail-page">
      <section className="panel run-detail-hero">
        <div className="run-detail-hero__copy">
          <p className="eyebrow">回测详情</p>
          <div className="run-detail-hero__title-row">
            <h2>{strategyName}</h2>
            <div className="run-detail-hero__meta">
              <span className="status-chip run-detail-hero__tag">{runStatus}</span>
              {detail.is_permanent ? <span className="status-chip run-detail-hero__tag">永久回测</span> : null}
              <span className="status-chip run-detail-hero__tag">回测号 {detail.id}</span>
              {detail.parameter_version_id ? <span className="status-chip run-detail-hero__tag">参数版本 {detail.parameter_version_id}</span> : null}
              {detail.source_run_id ? <span className="status-chip run-detail-hero__tag">来源 {detail.source_run_id}</span> : null}
              {detail.oos_start_date ? <span className="status-chip run-detail-hero__tag">样本外起点 {formatShortDate(detail.oos_start_date)}</span> : null}
              {runWindow.startDate && runWindow.endDate ? (
                <span className="status-chip run-detail-hero__tag">回测区间 {formatShortDate(runWindow.startDate)} - {formatShortDate(runWindow.endDate)}</span>
              ) : null}
              {!runWindow.startDate && !runWindow.endDate && formatRunRange(detail) !== '暂无区间' ? (
                <span className="status-chip run-detail-hero__tag">回测区间 {formatRunRange(detail)}</span>
              ) : null}
            </div>
          </div>
          {actionNotice ? (
            <p className="hero-copy" aria-live="polite">
              {actionNotice}
            </p>
          ) : null}
        </div>
        <div className="hero-actions">
          <button
            className="ghost-button"
            disabled={copyBusy}
            onClick={() => void handleCopyConfiguration()}
            type="button"
          >
            复制配置
          </button>
          <button
            className="ghost-button"
            disabled={!canRerun}
            onClick={handleRerunBacktest}
            type="button"
          >
            重跑回测
          </button>
          <button
            className="primary-button"
            disabled={!canOptimize || optimizationBusy}
            onClick={() => void handleCreateOptimization()}
            type="button"
          >
            启动优化
          </button>
        </div>
      </section>

      <RunDetailDiagnostics detail={detail} onWindowRangeChange={setWindowRange} windowRange={windowRange} />

      <section className="panel run-detail-trades-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">交易明细</p>
            <h3>真实 /backtest-runs/{runId}/trades</h3>
          </div>
          <button
            className={showTrades ? 'ghost-button ghost-button--active' : 'ghost-button'}
            onClick={() => {
              setShowTrades((current) => !current);
              setTradePage(1);
            }}
            type="button"
          >
            {showTrades ? '收起' : '展开'}
          </button>
        </div>

        {!showTrades ? <p className="empty-state">点击展开查看成交明细。</p> : null}

        {showTrades ? (
          <>
            <div className="run-detail-trade-segment-switcher" role="tablist" aria-label="成交区段">
              {TRADE_SEGMENT_OPTIONS.map((option) => (
                <button
                  aria-pressed={tradeSegment === option.value}
                  className={tradeSegment === option.value ? 'ghost-button ghost-button--active' : 'ghost-button'}
                  key={option.value}
                  onClick={() => {
                    setTradeSegment(option.value);
                    setTradePage(1);
                  }}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
            {tradesError ? <div className="error-banner">{tradesError}</div> : null}
            {tradesLoading ? <p className="empty-state">正在加载成交明细…</p> : null}
            {trades?.items.length ? (
              <>
                <div className="run-detail-trade-table-shell">
                  <table className="run-detail-trade-table">
                    <thead>
                      <tr>
                        <th>日期</th>
                        <th>标的</th>
                        <th>方向</th>
                        <th>数量</th>
                        <th>价格</th>
                        <th>名义金额</th>
                        <th>盈亏</th>
                        <th>区段</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trades.items.map((trade) => (
                        <tr key={`${trade.trade_time}-${trade.symbol}-${trade.side}-${trade.quantity}`}>
                          <td>{formatShortDate(trade.trade_time)}</td>
                          <td>{trade.symbol}</td>
                          <td>{formatTradeSide(trade.side)}</td>
                          <td>{formatTradeQuantity(trade.quantity)}</td>
                          <td>{formatTradeMoney(trade.price)}</td>
                          <td>{formatTradeMoney(trade.net_amount)}</td>
                          <td>{typeof trade.pnl_contribution === 'number' ? formatPercent(trade.pnl_contribution) : '—'}</td>
                          <td>{trade.segment ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="run-detail-trade-pagination">
                  <span>
                    第 {trades.page} / {trades.total_pages ?? Math.max(1, Math.ceil(trades.total / trades.page_size || 1))} 页 · 共{' '}
                    {trades.total.toLocaleString('zh-HK')} 笔
                  </span>
                  <div className="hero-actions">
                    <button
                      className="ghost-button"
                      disabled={tradePage <= 1 || tradesLoading}
                      onClick={() => setTradePage((current) => Math.max(1, current - 1))}
                      type="button"
                    >
                      上一页
                    </button>
                    <button
                      className="ghost-button"
                      disabled={tradePage >= (trades.total_pages ?? 1) || tradesLoading}
                      onClick={() => setTradePage((current) => current + 1)}
                      type="button"
                    >
                      下一页
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <p className="empty-state">暂无成交明细。</p>
            )}
          </>
        ) : null}
      </section>

      <section className="panel run-detail-audit-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">证据轨迹</p>
            <h3>交易明细与证据链</h3>
          </div>
          <button
            className={showEvidence ? 'ghost-button ghost-button--active' : 'ghost-button'}
            disabled={!detail.trade_audit_items?.length}
            onClick={() => setShowEvidence((current) => !current)}
            type="button"
          >
            {showEvidence ? '收起' : '展开'}
          </button>
        </div>

        {!showEvidence ? <p className="empty-state">点击展开查看证据轨迹。</p> : null}

        {showEvidence ? (
          <RunDetailAuditPanel
            activeTradeId={selectedTradeId}
            audit={audit}
            auditError={auditError}
            auditLoading={auditLoading}
            detail={detail}
            onSelectTrade={setSelectedTradeId}
          />
        ) : null}
      </section>
    </div>
  );
}

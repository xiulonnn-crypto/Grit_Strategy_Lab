import { useEffect, useState } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { formatCurrency, formatPercent, formatShortDate } from '../lib/format';
import {
  buildCopyPayload,
  formatRunStatusLabel,
  getDefaultTradeId,
  getStrategyTitle,
  TRADE_PAGE_SIZE,
  TRADE_SEGMENT_OPTIONS,
  type RunDetailTab,
  type TradeSegment,
  type ViewWindow,
} from '../lib/run-detail-view-model';
import { useApiClient } from '../lib/demoStoreContext';
import { RunDetailAuditPanel } from '../page-sections/run-detail-audit';
import { RunDetailDiagnostics } from '../page-sections/run-detail-diagnostics';
import { RunDetailOverviewSection } from '../page-sections/run-detail-overview';
import { RunDetailPropertiesPanel } from '../page-sections/run-detail-properties';
import type {
  ApiBacktestRunDetail,
  ApiBacktestRunTradeAudit,
  ApiBacktestRunTradePage,
} from '../types';
import './run-detail-page.css';

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
    throw new Error('复制失败，请手动复制。');
  }
}

export function RunDetailPage({ runId }: { runId: string }): JSX.Element {
  const api = useApiClient();
  const [detail, setDetail] = useState<ApiBacktestRunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [windowRange, setWindowRange] = useState<ViewWindow>('all');
  const [activeTab, setActiveTab] = useState<RunDetailTab>('diagnostics');
  const [tradeSegment, setTradeSegment] = useState<TradeSegment>('all');
  const [tradePage, setTradePage] = useState(1);
  const [trades, setTrades] = useState<ApiBacktestRunTradePage | null>(null);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [tradesError, setTradesError] = useState<string | null>(null);
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
        setSelectedTradeId((current) => current ?? getDefaultTradeId(payload));
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
    setActiveTab('diagnostics');
    setTradeSegment('all');
    setTradePage(1);
    setTrades(null);
    setTradesError(null);
    setSelectedTradeId(null);
    setAudit(null);
    setAuditError(null);
  }, [runId]);

  useEffect(() => {
    if (activeTab !== 'trades') {
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
  }, [activeTab, api, runId, tradePage, tradeSegment]);

  useEffect(() => {
    if (activeTab !== 'evidence') {
      setAudit(null);
      setAuditError(null);
      return;
    }

    if (!selectedTradeId) {
      setAudit(null);
      setAuditError(null);
      return;
    }

    let cancelled = false;

    async function loadAudit(): Promise<void> {
      try {
        setAuditLoading(true);
        setAuditError(null);
        const payload = await api.getBacktestTradeAudit(runId, selectedTradeId);
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
  }, [activeTab, api, runId, selectedTradeId]);

  useEffect(() => {
    if (activeTab !== 'evidence' || selectedTradeId) {
      return;
    }
    const firstTradeId = detail ? getDefaultTradeId(detail) : null;
    if (firstTradeId) {
      setSelectedTradeId(firstTradeId);
    }
  }, [activeTab, detail, selectedTradeId]);

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
          <h3>回测详情</h3>
        </div>
        <p className="hero-copy">正在加载回测详情…</p>
      </section>
    );
  }

  if (detailError || !detail) {
    return (
      <section className="panel">
        <div className="panel-header">
          <h3>回测详情</h3>
        </div>
        <p className="hero-copy">{detailError ?? '回测详情暂时不可用。'}</p>
      </section>
    );
  }

  const strategyName = getStrategyTitle(detail);
  const runStatus = formatRunStatusLabel(detail.status);
  const canRerun = Boolean(detail.strategy_id);
  const canOptimize = Boolean(detail.strategy_id);
  const heroSubtitle =
    actionNotice ??
    detail.analysis?.subtitle ??
    '查看本次回测的关键结果、交易证据与配置上下文。';

  function renderTradesTab(): JSX.Element {
    return (
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
                    <th>时间</th>
                    <th>标的</th>
                    <th>方向</th>
                    <th>数量</th>
                    <th>价格</th>
                    <th>净金额</th>
                    <th>收益贡献</th>
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
                第 {trades.page} / {trades.total_pages ?? Math.max(1, Math.ceil(trades.total / trades.page_size || 1))} 页，共{' '}
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
    );
  }

  function renderEvidenceTab(): JSX.Element {
    return (
      <RunDetailAuditPanel
        activeTradeId={selectedTradeId}
        audit={audit}
        auditError={auditError}
        auditLoading={auditLoading}
        detail={detail}
        onSelectTrade={setSelectedTradeId}
      />
    );
  }

  return (
    <div className="stack run-detail-page">
      <section className="panel run-detail-hero">
        <div className="run-detail-hero__copy">
          <div className="run-detail-hero__title-row">
            <h2>{strategyName}</h2>
            <div className="run-detail-hero__meta">
              <span className="status-chip run-detail-hero__tag">{runStatus}</span>
              {detail.is_permanent ? <span className="status-chip run-detail-hero__tag">永久回测</span> : null}
              <span className="status-chip run-detail-hero__tag">回测号 {detail.id}</span>
              {detail.source_run_id ? <span className="status-chip run-detail-hero__tag">来源 {detail.source_run_id}</span> : null}
            </div>
          </div>
          <p className="hero-copy" aria-live={actionNotice ? 'polite' : undefined}>
            {heroSubtitle}
          </p>
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

      <RunDetailOverviewSection
        activeTab={activeTab}
        detail={detail}
        onTabChange={setActiveTab}
        onWindowRangeChange={setWindowRange}
        windowRange={windowRange}
      />

      <section className="panel run-detail-trades-panel">
        {activeTab === 'diagnostics' ? (
          <RunDetailDiagnostics
            detail={detail}
            displayMode="tab"
            onWindowRangeChange={setWindowRange}
            windowRange={windowRange}
          />
        ) : null}
        {activeTab === 'trades' ? renderTradesTab() : null}
        {activeTab === 'evidence' ? renderEvidenceTab() : null}
        {activeTab === 'properties' ? <RunDetailPropertiesPanel detail={detail} /> : null}
      </section>
    </div>
  );
}

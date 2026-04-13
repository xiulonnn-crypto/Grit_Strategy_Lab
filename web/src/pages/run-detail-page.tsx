import { useEffect, useState } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { formatCompactDate, formatCurrency } from '../lib/format';
import { buildOptimizationConfigPath } from '../lib/optimization-routes';
import {
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
  ApiBacktestTradeItem,
  ApiBacktestRunTradeAudit,
  ApiBacktestRunTradePage,
} from '../types';
import './run-detail-page.css';

const RUN_DETAIL_POLL_INTERVAL_MS = 2000;
const SAVE_CONFIRM_DIALOG = {
  eyebrow: '保存回测',
  title: '保存回测',
  copy: '确认后该回测会转为永久回测，不再按临时回测自动清理。',
  cancel: '取消',
  confirm: '确认',
  pending: '保存中...',
  success: '已保存为永久回测。',
  errorPrefix: '保存回测失败：',
  runIdLabel: '回测号',
  strategyLabel: '策略',
} as const;

function isBacktestRunInProgress(status: string | null | undefined): boolean {
  const normalized = String(status ?? '').toUpperCase();
  return normalized === 'QUEUED' || normalized === 'RUNNING';
}

function hasRunDetailContext(detail: ApiBacktestRunDetail | null): boolean {
  if (!detail) {
    return false;
  }
  return (
    'request' in detail &&
    'environment_summary' in detail &&
    'trade_audit_items' in detail &&
    ('snapshot_summary' in detail || 'preview' in detail)
  );
}

function mergeRunDetail(
  current: ApiBacktestRunDetail | null,
  payload: ApiBacktestRunDetail,
): ApiBacktestRunDetail {
  return current ? { ...current, ...payload } : payload;
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

type NormalizedTradeRow = {
  date: string;
  symbol: string;
  side: string;
  quantity?: number;
  price?: number;
  netAmount?: number;
  pnlAmount?: number;
  pnlContribution?: number;
  segment?: string;
};

type TradeIdentityShape = Partial<ApiBacktestTradeItem> & {
  symbol?: string;
  trade_date?: string;
  action?: string;
  side?: string;
  price?: number;
  weight_before?: number;
  weight_after?: number;
};

function getTradeDate(trade: TradeIdentityShape): string {
  return (
    trade.trade_time ??
    trade.fill_time ??
    trade.fill_date ??
    trade.trade_date ??
    trade.signal_time ??
    trade.signal_date ??
    ''
  );
}

function getTradeSide(trade: TradeIdentityShape): string {
  return trade.side ?? trade.action ?? trade.direction_semantic ?? '';
}

function getTradePrice(trade: TradeIdentityShape): number | undefined {
  if (typeof trade.price === 'number') {
    return trade.price;
  }
  if (typeof trade.fill_price_raw === 'number') {
    return trade.fill_price_raw;
  }
  if (typeof trade.fill_price_adj === 'number') {
    return trade.fill_price_adj;
  }
  return undefined;
}

function buildTradeIdentity(trade: TradeIdentityShape): string {
  return [
    getTradeDate(trade),
    String(trade.symbol ?? '').toUpperCase(),
    getTradeSide(trade).toUpperCase(),
    typeof trade.price === 'number' ? trade.price.toFixed(6) : String(getTradePrice(trade) ?? ''),
    typeof trade.weight_before === 'number' ? trade.weight_before.toFixed(6) : '',
    typeof trade.weight_after === 'number' ? trade.weight_after.toFixed(6) : '',
  ].join('|');
}

function lookupEquityAtTradeDate(detail: ApiBacktestRunDetail, tradeDate: string): number | undefined {
  const normalizedDate = tradeDate.slice(0, 10);
  if (!normalizedDate) {
    return undefined;
  }

  const series = detail.chart_series ?? [];
  const exact = series.find((point) => point.trade_date === normalizedDate);
  if (exact && typeof exact.equity === 'number' && Number.isFinite(exact.equity)) {
    return exact.equity;
  }

  const earlier = [...series]
    .reverse()
    .find((point) => point.trade_date <= normalizedDate && typeof point.equity === 'number' && Number.isFinite(point.equity));
  if (earlier) {
    return earlier.equity;
  }

  const later = series.find((point) => point.trade_date >= normalizedDate && typeof point.equity === 'number' && Number.isFinite(point.equity));
  return later?.equity;
}

function buildTradePnlAmountMap(detail: ApiBacktestRunDetail): Map<string, number> {
  const ledger = new Map<string, number>();
  const openPositions = new Map<string, { quantity: number; avgPrice: number }>();
  const sourceTrades = detail.trades ?? [];

  for (const trade of sourceTrades) {
    const date = getTradeDate(trade);
    const side = getTradeSide(trade).toUpperCase();
    const price = getTradePrice(trade);
    const weightDelta =
      typeof trade.weight_before === 'number' && typeof trade.weight_after === 'number'
        ? Math.abs(trade.weight_after - trade.weight_before)
        : undefined;
    const estimatedEquity = date ? lookupEquityAtTradeDate(detail, date) : undefined;
    const tradedNotional =
      typeof weightDelta === 'number' && typeof estimatedEquity === 'number' ? estimatedEquity * weightDelta : undefined;
    const quantity =
      typeof tradedNotional === 'number' && typeof price === 'number' && price > 0 ? tradedNotional / price : undefined;
    const symbol = String(trade.symbol ?? '').toUpperCase();
    const existing = openPositions.get(symbol) ?? { quantity: 0, avgPrice: 0 };

    if (side === 'BUY' && typeof quantity === 'number' && quantity > 0 && typeof price === 'number' && price > 0) {
      const nextQuantity = existing.quantity + quantity;
      const totalCost = existing.quantity * existing.avgPrice + quantity * price;
      openPositions.set(symbol, {
        quantity: nextQuantity,
        avgPrice: nextQuantity > 0 ? totalCost / nextQuantity : 0,
      });
      continue;
    }

    if (side === 'SELL' && typeof quantity === 'number' && quantity > 0 && existing.quantity > 0 && existing.avgPrice > 0 && typeof price === 'number') {
      ledger.set(buildTradeIdentity(trade), (price - existing.avgPrice) * quantity);
      const remaining = Math.max(existing.quantity - quantity, 0);
      openPositions.set(symbol, {
        quantity: remaining,
        avgPrice: remaining > 0 ? existing.avgPrice : 0,
      });
    }
  }

  return ledger;
}

function normalizeTradeRow(
  detail: ApiBacktestRunDetail,
  trade: ApiBacktestTradeItem,
  pnlAmountLedger: Map<string, number>,
): NormalizedTradeRow {
  const date = getTradeDate(trade);
  const side = getTradeSide(trade) || '—';
  const price = getTradePrice(trade);
  const weightDelta =
    typeof trade.weight_before === 'number' && typeof trade.weight_after === 'number'
      ? Math.abs(trade.weight_after - trade.weight_before)
      : undefined;
  const estimatedEquity = date ? lookupEquityAtTradeDate(detail, date) : undefined;
  const derivedNetAmount =
    typeof weightDelta === 'number' && typeof estimatedEquity === 'number'
      ? estimatedEquity * weightDelta
      : undefined;
  const quantity =
    typeof trade.quantity === 'number'
      ? trade.quantity
      : typeof derivedNetAmount === 'number' && typeof price === 'number' && price > 0
        ? derivedNetAmount / price
        : undefined;
  const netAmount =
    typeof trade.net_amount === 'number'
      ? trade.net_amount
      : typeof derivedNetAmount === 'number'
        ? derivedNetAmount
      : quantity !== undefined && price !== undefined
        ? quantity * price
        : undefined;

  return {
    date,
    symbol: trade.symbol,
    side,
    quantity,
    price,
    netAmount,
    pnlAmount:
      typeof trade.pnl_amount === 'number' ? trade.pnl_amount : pnlAmountLedger.get(buildTradeIdentity(trade)),
    pnlContribution: typeof trade.pnl_contribution === 'number' ? trade.pnl_contribution : undefined,
    segment: trade.segment,
  };
}

function formatTradeMoney(value: number | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  return formatCurrency(value);
}

function formatSignedTradeMoney(value: number | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  if (value > 0) {
    return `+${formatCurrency(value)}`;
  }
  return formatCurrency(value);
}

function formatTradeQuantity(value: number | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  return value.toLocaleString('zh-HK', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  });
}

function formatTradePercent(value: number | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  const normalized = Math.abs(value) > 1 ? value : value * 100;
  return `${normalized >= 0 ? '+' : ''}${normalized.toFixed(1)}%`;
}

function formatTradeSegment(value: string | undefined): string {
  const normalized = String(value ?? '').toUpperCase();
  if (normalized === 'IS') {
    return '训练集';
  }
  if (normalized === 'OOS') {
    return '测试集';
  }
  return value && value.length ? value : '—';
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
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [saveDialogError, setSaveDialogError] = useState<string | null>(null);
  const [optimizationBusy, setOptimizationBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadDetail(): Promise<void> {
      try {
        setDetailLoading(true);
        setDetailError(null);
        const payload = await api.getBacktestRunDetail(runId, { view: 'initial' });
        if (cancelled) {
          return;
        }
        setDetail((current) => mergeRunDetail(current, payload));
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
    if (!detail || !isBacktestRunInProgress(detail.status)) {
      return;
    }

    let cancelled = false;
    let inFlight = false;
    const timer = window.setInterval(() => {
      if (inFlight) {
        return;
      }
      inFlight = true;
      void (async () => {
        try {
          const payload = await api.getBacktestRunDetail(runId, { view: 'initial' });
          if (cancelled) {
            return;
          }
          setDetail((current) => mergeRunDetail(current, payload));
          setSelectedTradeId((current) => current ?? getDefaultTradeId(payload));
          setDetailError(null);
        } catch {
        } finally {
          inFlight = false;
        }
      })();
    }, RUN_DETAIL_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api, detail?.status, runId]);

  useEffect(() => {
    if (!detail || (activeTab !== 'properties' && activeTab !== 'evidence') || hasRunDetailContext(detail)) {
      return;
    }

    let cancelled = false;

    async function loadContext(): Promise<void> {
      try {
        setContextLoading(true);
        setContextError(null);
        const payload = await api.getBacktestRunDetail(runId, { view: 'context' });
        if (cancelled) {
          return;
        }
        setDetail((current) => mergeRunDetail(current, payload));
        setSelectedTradeId((current) => current ?? getDefaultTradeId(payload));
      } catch (caught) {
        if (!cancelled) {
          setContextError((caught as Error).message);
        }
      } finally {
        if (!cancelled) {
          setContextLoading(false);
        }
      }
    }

    void loadContext();
    return () => {
      cancelled = true;
    };
  }, [activeTab, api, detail, runId]);

  useEffect(() => {
    setActiveTab('diagnostics');
    setTradeSegment('all');
    setTradePage(1);
    setDetail(null);
    setDetailError(null);
    setTrades(null);
    setTradesError(null);
    setSelectedTradeId(null);
    setAudit(null);
    setAuditError(null);
    setContextLoading(false);
    setContextError(null);
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
  }, [activeTab, api, runId, tradePage, tradeSegment, detail?.status]);

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
    const tradeId: string = selectedTradeId;

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

  function openSaveConfirm(): void {
    if (!detail || detail.is_permanent) {
      return;
    }
    setSaveDialogError(null);
    setSaveConfirmOpen(true);
  }

  function closeSaveConfirm(): void {
    if (saveBusy) {
      return;
    }
    setSaveDialogError(null);
    setSaveConfirmOpen(false);
  }

  async function handleSaveRun(): Promise<void> {
    if (!detail) {
      return;
    }
    if (detail.is_permanent) {
      return;
    }

    try {
      setSaveBusy(true);
      setActionNotice(null);
      setSaveDialogError(null);
      const payload = await api.saveBacktestRun(detail.id);
      setDetail(payload);
      setSaveConfirmOpen(false);
      setActionNotice(SAVE_CONFIRM_DIALOG.success);
    } catch (caught) {
      setSaveDialogError(`${SAVE_CONFIRM_DIALOG.errorPrefix}${(caught as Error).message}`);
    } finally {
      setSaveBusy(false);
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

  function handleCreateOptimization(): void {
    if (!detail?.strategy_id) {
      return;
    }

    try {
      setActionNotice(null);
      navigateTo(
        buildOptimizationConfigPath({
          strategyId: detail.strategy_id,
          sourceRunId: detail.id,
          entryPoint: 'run_detail',
        }),
      );
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

  const resolvedDetail = detail;
  const tradePageData = trades ?? { items: [], page: 1, page_size: 50, total: 0, total_pages: 1 };
  const strategyName = getStrategyTitle(resolvedDetail);
  const runStatus = formatRunStatusLabel(resolvedDetail.status);
  const runInProgress = isBacktestRunInProgress(resolvedDetail.status);
  const canRerun = Boolean(resolvedDetail.strategy_id) && !runInProgress;
  const canOptimize = Boolean(resolvedDetail.strategy_id) && !runInProgress;
  const detailContextReady = hasRunDetailContext(resolvedDetail);
  const heroSubtitle =
    actionNotice ??
    (runInProgress
      ? '回测正在执行，页面会自动刷新；你可以先查看已锁定的区间与配置。'
      : resolvedDetail.analysis?.subtitle ?? '查看本次回测的关键结果、交易证据与配置上下文。');

  const tradePnlAmountLedger = buildTradePnlAmountMap(resolvedDetail);

  function renderTradesTab(): JSX.Element {
    const tradeRows = tradePageData.items.map((trade) => normalizeTradeRow(resolvedDetail, trade, tradePnlAmountLedger));

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

        {tradeRows.length ? (
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
                    <th>收益</th>
                    <th>收益贡献</th>
                    <th>区段</th>
                  </tr>
                </thead>
                <tbody>
                  {tradeRows.map((trade) => (
                    <tr key={`${trade.date}-${trade.symbol}-${trade.side}-${trade.quantity ?? 'na'}`}>
                      <td>{formatCompactDate(trade.date)}</td>
                      <td>{trade.symbol}</td>
                      <td>{formatTradeSide(trade.side)}</td>
                      <td>{formatTradeQuantity(trade.quantity)}</td>
                      <td>{formatTradeMoney(trade.price)}</td>
                      <td>{formatTradeMoney(trade.netAmount)}</td>
                      <td>{formatSignedTradeMoney(trade.pnlAmount)}</td>
                      <td>{formatTradePercent(trade.pnlContribution)}</td>
                      <td>{formatTradeSegment(trade.segment)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="run-detail-trade-pagination">
              <span>
                第 {tradePageData.page} / {tradePageData.total_pages ?? Math.max(1, Math.ceil(tradePageData.total / tradePageData.page_size || 1))} 页，共{' '}
                {tradePageData.total.toLocaleString('zh-HK')} 笔
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
                  disabled={tradePage >= (tradePageData.total_pages ?? 1) || tradesLoading}
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
        detail={resolvedDetail}
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
              <span
                className={`status-chip run-detail-hero__tag ${
                  detail.is_permanent ? 'run-detail-hero__tag--permanent' : 'run-detail-hero__tag--temporary'
                }`}
              >
                {detail.is_permanent ? '永久回测' : '临时回测'}
              </span>
              <span className="status-chip run-detail-hero__tag">回测号 {detail.id}</span>
            </div>
          </div>
          <p className="hero-copy" aria-live={actionNotice ? 'polite' : undefined}>
            {heroSubtitle}
          </p>
        </div>
        <div className="hero-actions">
          {!detail.is_permanent ? (
            <button
              className="ghost-button"
              disabled={saveBusy}
              onClick={openSaveConfirm}
              type="button"
            >
              保存回测
            </button>
          ) : null}
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
        {activeTab === 'evidence'
          ? detailContextReady
            ? renderEvidenceTab()
            : contextLoading
              ? <p className="empty-state">正在加载证据上下文…</p>
              : contextError
                ? <div className="error-banner">{contextError}</div>
                : <p className="empty-state">证据上下文暂时不可用。</p>
          : null}
        {activeTab === 'properties'
          ? detailContextReady
            ? <RunDetailPropertiesPanel detail={detail} />
            : contextLoading
              ? <p className="empty-state">正在加载配置上下文…</p>
              : contextError
                ? <div className="error-banner">{contextError}</div>
                : <p className="empty-state">配置上下文暂时不可用。</p>
          : null}
      </section>

      {saveConfirmOpen ? (
        <div
          aria-label={SAVE_CONFIRM_DIALOG.title}
          aria-modal="true"
          className="modal-shell"
          onClick={closeSaveConfirm}
          role="dialog"
        >
          <div className="modal-card run-detail-save-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <div>
                <p className="eyebrow">{SAVE_CONFIRM_DIALOG.eyebrow}</p>
                <h3>{SAVE_CONFIRM_DIALOG.title}</h3>
                <p className="creation-panel-copy">{SAVE_CONFIRM_DIALOG.copy}</p>
              </div>
            </div>
            <div className="run-detail-save-modal__summary">
              <div>
                <span className="run-detail-save-modal__label">{SAVE_CONFIRM_DIALOG.runIdLabel}</span>
                <strong>{detail.id}</strong>
              </div>
              <div>
                <span className="run-detail-save-modal__label">{SAVE_CONFIRM_DIALOG.strategyLabel}</span>
                <strong>{strategyName}</strong>
              </div>
            </div>
            {saveDialogError ? <div className="error-banner">{saveDialogError}</div> : null}
            <div className="modal-card__footer">
              <button className="ghost-button" disabled={saveBusy} onClick={closeSaveConfirm} type="button">
                {SAVE_CONFIRM_DIALOG.cancel}
              </button>
              <button className="primary-button" disabled={saveBusy} onClick={() => void handleSaveRun()} type="button">
                {saveBusy ? SAVE_CONFIRM_DIALOG.pending : SAVE_CONFIRM_DIALOG.confirm}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

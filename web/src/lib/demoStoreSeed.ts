import type {
  ApiBacktestRunDetail,
  ApiBacktestRunTradeAudit,
  ApiOptimizationJobDetail,
} from '../types';
import { clone, createCandidate, createStrategy, nowIso, type DemoState } from './demoStoreShared';

function makePriceSeries(symbol: string, anchorDate: string, prices: number[]): ApiBacktestRunTradeAudit['price_series'] {
  return prices.map((price, index) => {
    const day = new Date(anchorDate);
    day.setUTCDate(day.getUTCDate() + index);
    const close = Number(price.toFixed(2));
    return {
      date: day.toISOString().slice(0, 10),
      open: Number((close - 0.8).toFixed(2)),
      high: Number((close + 1.1).toFixed(2)),
      low: Number((close - 1.4).toFixed(2)),
      close,
      adj_close: close,
      volume: 1_000_000 + index * 80_000 + symbol.length * 10_000,
    };
  });
}

function makeTradeAudit(
  tradeId: string,
  symbol: string,
  segment: string,
  openedAt: string,
  closedAt: string,
  pnlPct: number,
  prices: number[],
  triggerSnapshot: Record<string, import('../types').ParameterValue>,
): ApiBacktestRunTradeAudit {
  const priceSeries = makePriceSeries(symbol, openedAt.slice(0, 10), prices);
  const entryPrice = priceSeries[1]?.close ?? priceSeries[0]?.close ?? 0;
  const exitPrice = priceSeries[priceSeries.length - 2]?.close ?? priceSeries[priceSeries.length - 1]?.close ?? 0;
  const mfe = pnlPct >= 0 ? pnlPct + 2.1 : 1.1;
  const mae = pnlPct >= 0 ? -1.7 : -4.6;
  const commentary =
    pnlPct >= 0
      ? 'Trend capture stayed aligned with the recovered signal stack.'
      : 'Exit lagged the reversal and gave back too much open profit.';
  return {
    trade_id: tradeId,
    symbol,
    segment,
    opened_at: openedAt,
    closed_at: closedAt,
    pnl_pct: pnlPct,
    max_favorable_excursion_pct: Number(mfe.toFixed(2)),
    max_adverse_excursion_pct: Number(mae.toFixed(2)),
    slippage_cost_pct: Number((Math.abs(pnlPct) * 0.08 + 0.12).toFixed(2)),
    commentary,
    price_series: priceSeries,
    trigger_snapshot: triggerSnapshot,
    risk_evaluation: {
      max_favorable_excursion_pct: Number(mfe.toFixed(2)),
      max_adverse_excursion_pct: Number(mae.toFixed(2)),
      mfe_mae_ratio: Number((Math.abs(mfe / Math.min(mae, -0.5))).toFixed(2)),
      slippage_cost_pct: Number((Math.abs(pnlPct) * 0.08 + 0.12).toFixed(2)),
      commentary,
    },
    entry_marker: { date: priceSeries[1]?.date ?? openedAt.slice(0, 10), price: entryPrice },
    exit_marker: { date: priceSeries[priceSeries.length - 2]?.date ?? closedAt.slice(0, 10), price: exitPrice },
    chart_band: { start_date: openedAt, end_date: closedAt, color: pnlPct >= 0 ? 'green' : 'red', pnl_pct: pnlPct },
  };
}

export function createInitialState(): DemoState {
  const qualityMomentum = createStrategy({ id: 'strat-001', name: 'Quality Momentum', latest_optimization_job_id: 'opt-001' });
  const lowVolRotation = createStrategy({
    id: 'strat-002',
    name: 'Low Vol Rotation',
    latest_optimization_job_id: null,
    latest_run_id: null,
    parameters: { lookback_months: 3, skip_recent_months: 1, top_n: 2, weighting_method: 'risk_parity', max_position_pct: 20 },
    current_parameter_version_id: 'strat-002-v1',
    current_parameter_version: 1,
  });

  const candidates = [
    createCandidate(qualityMomentum, { id: 'trial-001', label: 'Risk Dialed In', summary: 'Tighter breadth with a slightly more patient lookback.', parameter_snapshot: { ...qualityMomentum.parameters, top_n: 6, max_position_pct: 12 }, metrics: { total_return: 14.6, sharpe: 1.31 }, score: 1.34 }, 1),
    createCandidate(qualityMomentum, { id: 'trial-002', label: 'Volatility Cushion', summary: 'More selective entry with extra skip window.', parameter_snapshot: { ...qualityMomentum.parameters, lookback_months: 9, skip_recent_months: 2 }, metrics: { total_return: 11.2, sharpe: 1.24 }, score: 1.28 }, 2),
    createCandidate(qualityMomentum, { id: 'trial-003', label: 'Aggressive Breakout', summary: 'Wider basket that captured more upside but with thinner conviction.', parameter_snapshot: { ...qualityMomentum.parameters, top_n: 9, weighting_method: 'volatility_adjusted' }, metrics: { total_return: 5.1, sharpe: 0.92 }, score: 1.11 }, 3),
    createCandidate(qualityMomentum, { id: 'trial-004', label: 'Overfit Reversal', summary: 'Negative OOS behavior, should be cleaned from the lab.', parameter_snapshot: { ...qualityMomentum.parameters, lookback_months: 2, top_n: 12 }, metrics: { total_return: -4.2, sharpe: -0.18 }, score: -0.22 }, 4),
  ];
  const optimizationJob: ApiOptimizationJobDetail = {
    id: 'opt-001',
    strategy_id: qualityMomentum.id,
    status: 'COMPLETED',
    request: { objective: 'sharpe', base_parameter_version_id: qualityMomentum.current_parameter_version_id },
    summary: { objective: 'sharpe', candidate_count: candidates.length, baseline_parameter_version_id: qualityMomentum.current_parameter_version_id },
    result: { best_candidate_id: candidates[0].id, baseline_parameter_version_id: qualityMomentum.current_parameter_version_id },
    candidates,
    base_parameter_version_id: qualityMomentum.current_parameter_version_id,
    created_at: nowIso(),
    updated_at: nowIso(),
    completed_at: nowIso(),
  };

  const qqqAudit = makeTradeAudit('trade-001', 'QQQ', 'IS', '2025-01-06T09:30:00Z', '2025-01-17T16:00:00Z', 8.4, [402, 405, 408, 411, 414, 416, 418], { momentum_rank: 3, lookback_return_pct: 12.8, portfolio_volatility_pct: 18.4, execution_policy: 'T_CLOSE_TO_T1_OPEN' });
  const aaplAudit = makeTradeAudit('trade-002', 'AAPL', 'OOS', '2025-02-03T09:30:00Z', '2025-02-10T16:00:00Z', -2.1, [188, 190, 187, 185, 184, 183, 186], { momentum_rank: 17, lookback_return_pct: 3.1, portfolio_volatility_pct: 22.6, execution_policy: 'T_CLOSE_TO_T1_OPEN' });
  const run: ApiBacktestRunDetail = {
    id: 'bt-001',
    strategy_id: qualityMomentum.id,
    status: 'COMPLETED_WITH_WARNINGS',
    metrics: { total_return: 18.4, sharpe: 1.18, max_drawdown: -6.4 },
    chart_series: [{ trade_date: '2025-01-02', equity: 100, benchmark: 100, drawdown: 0, is_oos: false }, { trade_date: '2025-01-10', equity: 106, benchmark: 102, drawdown: -1.2, is_oos: false }, { trade_date: '2025-02-06', equity: 111, benchmark: 104, drawdown: -3.4, is_oos: true }, { trade_date: '2025-02-28', equity: 118.4, benchmark: 108.1, drawdown: -2.6, is_oos: true }],
    monthly_returns: [{ month: '2025-01', return_pct: 6.2, segment: 'IS' }, { month: '2025-02', return_pct: 4.7, segment: 'OOS' }],
    trade_details: [{ trade_date: '2025-01-06', symbol: 'QQQ', side: 'BUY', quantity: 100, price: 405, notional: 40500, pnl_pct: 8.4, signal: 'Momentum breakout' }, { trade_date: '2025-02-03', symbol: 'AAPL', side: 'BUY', quantity: 80, price: 190, notional: 15200, pnl_pct: -2.1, signal: 'Weak quality follow-through' }],
    configuration: { oos_start_date: '2025-02-01', execution_policy: 'T_CLOSE_TO_T1_OPEN' },
    parameter_snapshot: qualityMomentum.parameters ?? {},
    snapshot_summary: { dataset_snapshot_id: 'dataset-20250330', universe_snapshot_id: 'universe-20250330' },
    data_segment_type: 'FULL',
    parameter_version_id: qualityMomentum.current_parameter_version_id,
    request: { start_date: '2025-01-02', end_date: '2025-02-28', fee_bps: 5, slippage_bps: 5, execution_policy: 'T_CLOSE_TO_T1_OPEN' },
    is_permanent: true,
    source_run_id: null,
    trade_audit_items: [clone({ trade_id: qqqAudit.trade_id, symbol: qqqAudit.symbol, segment: qqqAudit.segment, opened_at: qqqAudit.opened_at, closed_at: qqqAudit.closed_at, pnl_pct: qqqAudit.pnl_pct, max_favorable_excursion_pct: qqqAudit.max_favorable_excursion_pct, max_adverse_excursion_pct: qqqAudit.max_adverse_excursion_pct, slippage_cost_pct: qqqAudit.slippage_cost_pct, commentary: qqqAudit.commentary }), clone({ trade_id: aaplAudit.trade_id, symbol: aaplAudit.symbol, segment: aaplAudit.segment, opened_at: aaplAudit.opened_at, closed_at: aaplAudit.closed_at, pnl_pct: aaplAudit.pnl_pct, max_favorable_excursion_pct: aaplAudit.max_favorable_excursion_pct, max_adverse_excursion_pct: aaplAudit.max_adverse_excursion_pct, slippage_cost_pct: aaplAudit.slippage_cost_pct, commentary: aaplAudit.commentary })],
    trade_audit: [qqqAudit, aaplAudit],
  };

  return {
    strategies: [qualityMomentum, lowVolRotation],
    optimizationJobs: [optimizationJob],
    sessions: [],
    runs: [run],
    tradeAudits: { 'bt-001': { [qqqAudit.trade_id]: qqqAudit, [aaplAudit.trade_id]: aaplAudit } },
    promoteConflicts: new Set<string>(),
  };
}

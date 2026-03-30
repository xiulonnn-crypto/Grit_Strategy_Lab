import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RunDetailAuditPanel } from './page-sections/run-detail-audit';
import type { ApiBacktestRunDetail, ApiBacktestRunTradeAudit } from './types';

const audits: Record<string, ApiBacktestRunTradeAudit> = {
  'trade-001': {
    trade_id: 'trade-001',
    symbol: 'QQQ',
    segment: 'IS',
    opened_at: '2025-01-06T09:30:00Z',
    closed_at: '2025-01-17T16:00:00Z',
    pnl_pct: 8.4,
    max_favorable_excursion_pct: 10.5,
    max_adverse_excursion_pct: -1.7,
    slippage_cost_pct: 0.42,
    commentary: 'Trend capture stayed aligned with the recovered signal stack.',
    price_series: [
      { date: '2025-01-06', open: 402, high: 404, low: 401, close: 403, adj_close: 403, volume: 1000000 },
      { date: '2025-01-07', open: 404, high: 406, low: 403, close: 405, adj_close: 405, volume: 1100000 },
      { date: '2025-01-08', open: 407, high: 409, low: 406, close: 408, adj_close: 408, volume: 1120000 },
    ],
    trigger_snapshot: { momentum_rank: 3, lookback_return_pct: 12.8, execution_policy: 'T_CLOSE_TO_T1_OPEN' },
    risk_evaluation: { max_favorable_excursion_pct: 10.5, max_adverse_excursion_pct: -1.7, mfe_mae_ratio: 6.18, slippage_cost_pct: 0.42, commentary: 'Trend capture stayed aligned with the recovered signal stack.' },
    entry_marker: { date: '2025-01-07', price: 405 },
    exit_marker: { date: '2025-01-08', price: 408 },
    chart_band: { start_date: '2025-01-06T09:30:00Z', end_date: '2025-01-17T16:00:00Z', color: 'green', pnl_pct: 8.4 },
  },
  'trade-002': {
    trade_id: 'trade-002',
    symbol: 'AAPL',
    segment: 'OOS',
    opened_at: '2025-02-03T09:30:00Z',
    closed_at: '2025-02-10T16:00:00Z',
    pnl_pct: -2.1,
    max_favorable_excursion_pct: 1.1,
    max_adverse_excursion_pct: -4.6,
    slippage_cost_pct: 0.29,
    commentary: 'Exit lagged the reversal and gave back too much open profit.',
    price_series: [
      { date: '2025-02-03', open: 188, high: 190, low: 187, close: 189, adj_close: 189, volume: 1000000 },
      { date: '2025-02-04', open: 190, high: 191, low: 186, close: 187, adj_close: 187, volume: 1120000 },
      { date: '2025-02-05', open: 186, high: 188, low: 183, close: 184, adj_close: 184, volume: 1200000 },
    ],
    trigger_snapshot: { momentum_rank: 17, lookback_return_pct: 3.1, execution_policy: 'T_CLOSE_TO_T1_OPEN' },
    risk_evaluation: { max_favorable_excursion_pct: 1.1, max_adverse_excursion_pct: -4.6, mfe_mae_ratio: 0.24, slippage_cost_pct: 0.29, commentary: 'Exit lagged the reversal and gave back too much open profit.' },
    entry_marker: { date: '2025-02-04', price: 187 },
    exit_marker: { date: '2025-02-05', price: 184 },
    chart_band: { start_date: '2025-02-03T09:30:00Z', end_date: '2025-02-10T16:00:00Z', color: 'red', pnl_pct: -2.1 },
  },
};

const detail: ApiBacktestRunDetail = {
  id: 'bt-001',
  status: 'COMPLETED_WITH_WARNINGS',
  metrics: { total_return: 18.4, sharpe: 1.18, max_drawdown: -6.4 },
  data_segment_type: 'FULL',
  is_permanent: true,
  trade_audit_items: Object.values(audits).map((audit) => ({
    trade_id: audit.trade_id,
    symbol: audit.symbol,
    segment: audit.segment,
    opened_at: audit.opened_at,
    closed_at: audit.closed_at,
    pnl_pct: audit.pnl_pct,
    max_favorable_excursion_pct: audit.max_favorable_excursion_pct,
    max_adverse_excursion_pct: audit.max_adverse_excursion_pct,
    slippage_cost_pct: audit.slippage_cost_pct,
    commentary: audit.commentary,
  })),
};

function Harness(): JSX.Element {
  const [activeTradeId, setActiveTradeId] = useState('trade-001');
  return (
    <RunDetailAuditPanel
      activeTradeId={activeTradeId}
      audit={audits[activeTradeId]}
      detail={detail}
      onSelectTrade={setActiveTradeId}
    />
  );
}

describe('RunDetailAuditPanel', () => {
  it('syncs the selected trade row with the chart band and trigger snapshot', () => {
    render(<Harness />);

    expect(screen.getByText('QQQ episode')).toBeInTheDocument();
    expect(screen.getByTestId('trade-chart-band')).toHaveTextContent('Trend captured');
    expect(screen.getByText('momentum_rank')).toBeInTheDocument();
    expect(screen.getByText('12.8')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /AAPL/i }));

    expect(screen.getByText('AAPL episode')).toBeInTheDocument();
    expect(screen.getByTestId('trade-chart-band')).toHaveTextContent('Chopped in noise');
    expect(screen.getByText('3.1')).toBeInTheDocument();
    expect(screen.getAllByText('Exit lagged the reversal and gave back too much open profit.').length).toBeGreaterThan(0);
  });
});

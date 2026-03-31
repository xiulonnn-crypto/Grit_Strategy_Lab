import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunDetailPage } from './pages/run-detail-page';
import type { ApiBacktestRunDetail, ApiBacktestRunTradeAudit } from './types';

type FakeApi = {
  getBacktestRunDetail: ReturnType<typeof vi.fn>;
  getBacktestTradeAudit: ReturnType<typeof vi.fn>;
};

const fakeApi = vi.hoisted(() => ({
  getBacktestRunDetail: vi.fn(),
  getBacktestTradeAudit: vi.fn(),
})) as FakeApi;

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

const audit: ApiBacktestRunTradeAudit = {
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
  risk_evaluation: {
    max_favorable_excursion_pct: 10.5,
    max_adverse_excursion_pct: -1.7,
    mfe_mae_ratio: 6.18,
    slippage_cost_pct: 0.42,
    commentary: 'Trend capture stayed aligned with the recovered signal stack.',
  },
  entry_marker: { date: '2025-01-07', price: 405 },
  exit_marker: { date: '2025-01-08', price: 408 },
  chart_band: { start_date: '2025-01-06T09:30:00Z', end_date: '2025-01-17T16:00:00Z', color: 'green', pnl_pct: 8.4 },
};

const auditTwo: ApiBacktestRunTradeAudit = {
  ...audit,
  trade_id: 'trade-002',
  symbol: 'AAPL',
  segment: 'OOS',
  pnl_pct: -2.1,
  commentary: 'Exit lagged the reversal and gave back too much open profit.',
  chart_band: { start_date: '2025-02-03T09:30:00Z', end_date: '2025-02-10T16:00:00Z', color: 'red', pnl_pct: -2.1 },
};

const detail: ApiBacktestRunDetail = {
  id: 'bt-001',
  status: 'COMPLETED_WITH_WARNINGS',
  metrics: { total_return: 18.4, sharpe: 1.18, max_drawdown: -6.4 },
  chart_series: [
    { trade_date: '2025-01-02', equity: 100, benchmark: 100, drawdown: 0, is_oos: false },
    { trade_date: '2025-01-10', equity: 106, benchmark: 102, drawdown: -1.2, is_oos: false },
    { trade_date: '2025-02-06', equity: 111, benchmark: 104, drawdown: -3.4, is_oos: true },
    { trade_date: '2025-02-28', equity: 118.4, benchmark: 108.1, drawdown: -2.6, is_oos: true },
  ],
  monthly_returns: [
    { month: '2025-01', return_pct: 6.2, segment: 'IS' },
    { month: '2025-02', return_pct: 4.7, segment: 'OOS' },
  ],
  data_segment_type: 'FULL',
  is_permanent: true,
  trade_audit_items: [
    {
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
    },
  ],
};

beforeEach(() => {
  fakeApi.getBacktestRunDetail.mockReset();
  fakeApi.getBacktestTradeAudit.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('RunDetailPage', () => {
  it('wraps the audit panel in a run shell with range and curve cues', async () => {
    fakeApi.getBacktestRunDetail.mockResolvedValue(detail);
    fakeApi.getBacktestTradeAudit.mockImplementation(async (_runId: string, tradeId: string) =>
      tradeId === 'trade-001' ? audit : auditTwo,
    );

    await act(async () => {
      render(<RunDetailPage runId="bt-001" />);
    });

    expect(await screen.findByText('Run bt-001')).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('Range') && content.includes('Segment FULL'))).toBeInTheDocument();
    expect(screen.getByText('Main Curve')).toBeInTheDocument();
    expect(screen.getByText('Return 18.4000')).toBeInTheDocument();
    expect(screen.getByTestId('trade-audit-chart')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /AAPL/i }));

    await waitFor(() => expect(screen.getByText('AAPL episode')).toBeInTheDocument());
    expect(screen.getByTestId('trade-chart-band')).toHaveTextContent('Chopped in noise');
  });

  it('shows an empty state when the run has no curve or audit episodes', async () => {
    fakeApi.getBacktestRunDetail.mockResolvedValue({
      ...detail,
      chart_series: [],
      trade_audit_items: [],
    } satisfies ApiBacktestRunDetail);

    await act(async () => {
      render(<RunDetailPage runId="bt-empty" />);
    });

    expect(await screen.findByText('No chart series was returned for this run.')).toBeInTheDocument();
    expect(screen.getByText('This run has no trade audit episodes yet.')).toBeInTheDocument();
  });
});

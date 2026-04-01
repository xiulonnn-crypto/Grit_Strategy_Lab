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
    opened_at: '2026-03-23T09:30:00Z',
    closed_at: '2026-03-23T16:00:00Z',
    pnl_pct: 3.2,
    max_favorable_excursion_pct: 4.1,
    max_adverse_excursion_pct: -0.7,
    slippage_cost_pct: 0.18,
    commentary: '均线回归继续围绕基线展开。',
    price_series: [
      { date: '2026-03-23', open: 590, high: 594, low: 588, close: 593, adj_close: 593, volume: 1_000_000 },
    ],
    trigger_snapshot: { execution_policy: 'T_CLOSE_TO_T1_OPEN', signal: 'mean_reversion', threshold: 2 },
    risk_evaluation: {
      max_favorable_excursion_pct: 4.1,
      max_adverse_excursion_pct: -0.7,
      mfe_mae_ratio: 5.86,
      slippage_cost_pct: 0.18,
      commentary: '均线回归继续围绕基线展开。',
    },
    entry_marker: { date: '2026-03-23', price: 591 },
    exit_marker: { date: '2026-03-23', price: 593 },
    chart_band: { start_date: '2026-03-23T09:30:00Z', end_date: '2026-03-23T16:00:00Z', color: 'green', pnl_pct: 3.2 },
  },
  'trade-002': {
    trade_id: 'trade-002',
    symbol: 'AAPL',
    segment: 'OOS',
    opened_at: '2026-03-24T09:30:00Z',
    closed_at: '2026-03-24T16:00:00Z',
    pnl_pct: -1.4,
    max_favorable_excursion_pct: 0.8,
    max_adverse_excursion_pct: -2.4,
    slippage_cost_pct: 0.22,
    commentary: '样本外回撤略高，但仍保持在阈值范围内。',
    price_series: [
      { date: '2026-03-24', open: 189, high: 190, low: 185, close: 186, adj_close: 186, volume: 1_100_000 },
    ],
    trigger_snapshot: { execution_policy: 'T_CLOSE_TO_T1_OPEN', signal: 'mean_reversion', threshold: 3 },
    risk_evaluation: {
      max_favorable_excursion_pct: 0.8,
      max_adverse_excursion_pct: -2.4,
      mfe_mae_ratio: 0.33,
      slippage_cost_pct: 0.22,
      commentary: '样本外回撤略高，但仍保持在阈值范围内。',
    },
    entry_marker: { date: '2026-03-24', price: 189 },
    exit_marker: { date: '2026-03-24', price: 186 },
    chart_band: { start_date: '2026-03-24T09:30:00Z', end_date: '2026-03-24T16:00:00Z', color: 'red', pnl_pct: -1.4 },
  },
};

const detail: ApiBacktestRunDetail = {
  id: 'bt-9.6802970000',
  strategy_name: '美股质量动量',
  status: 'COMPLETED',
  metrics: { total_return: 232.3, sharpe: 0.85, max_drawdown: -24.9 },
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
  snapshot_summary: {
    dataset_snapshot_id: 'ds-001',
    universe_snapshot_id: 'un-001',
    execution_policy: 'T_CLOSE_TO_T1_OPEN',
  },
  parameter_snapshot: {
    strategy_type: 'quality_momentum',
    objective: '美股质量动量',
  },
  environment_summary: {
    runtime: 'local',
    mode: 'production',
  },
  preview: {
    snapshot_summary: {
      dataset_snapshot_id: 'ds-preview',
      universe_snapshot_id: 'un-preview',
      execution_policy: 'T_CLOSE_TO_T1_OPEN',
    },
    parameter_snapshot: {
      strategy_type: 'quality_momentum',
      objective: '美股质量动量',
    },
    environment_summary: {
      runtime: 'preview',
      mode: 'sandbox',
    },
  },
  data_segment_type: 'FULL',
  is_permanent: true,
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
  it('syncs the selected trade row with the evidence card and configuration snapshot', () => {
    render(<Harness />);

    expect(screen.getByText('QQQ 证据卡')).toBeInTheDocument();
    expect(screen.getByText('数据快照摘要')).toBeInTheDocument();
    expect(screen.getByText('参数快照')).toBeInTheDocument();
    expect(screen.getByText('环境摘要')).toBeInTheDocument();
    expect(screen.getByText('ds-001')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /AAPL/i }));

    expect(screen.getByText('AAPL 证据卡')).toBeInTheDocument();
    expect(screen.getAllByText('样本外回撤略高，但仍保持在阈值范围内。').length).toBeGreaterThan(0);
    expect(screen.queryByText('trade-002')).not.toBeInTheDocument();
  });
});

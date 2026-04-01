import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RunDetailAuditPanel } from './run-detail-audit';
import type { ApiBacktestRunDetail } from '../types';

const detail: ApiBacktestRunDetail = {
  id: 'bt-preview',
  status: 'COMPLETED',
  metrics: { total_return: 15, sharpe: 1.2, max_drawdown: -4.5 },
  trade_audit_items: [
    {
      trade_id: 'trade-preview',
      symbol: 'QQQ',
      segment: 'IS',
      opened_at: '2026-03-23T09:30:00Z',
      closed_at: '2026-03-23T16:00:00Z',
      pnl_pct: 1.6,
      max_favorable_excursion_pct: 2.3,
      max_adverse_excursion_pct: -0.4,
      slippage_cost_pct: 0.12,
      commentary: 'Preview evidence route.',
    },
  ],
  preview: {
    snapshot_summary: { dataset_snapshot_id: 'ds-preview', universe_snapshot_id: 'un-preview' },
    parameter_snapshot: { objective: 'preview', strategy_type: 'demo' },
    environment_summary: { runtime: 'preview', mode: 'sandbox' },
  },
  data_segment_type: 'FULL',
  is_permanent: true,
};

describe('RunDetailAuditPanel evidence fold-in', () => {
  it('renders preview-backed snapshot evidence even before trade audit data arrives', () => {
    render(
      <RunDetailAuditPanel
        activeTradeId="trade-preview"
        audit={null}
        auditLoading
        detail={detail}
        onSelectTrade={() => undefined}
      />,
    );

    expect(screen.getByText('正在加载证据轨迹…')).toBeInTheDocument();
    expect(screen.getByText('数据快照摘要')).toBeInTheDocument();
    expect(screen.getByText('ds-preview')).toBeInTheDocument();
    expect(screen.getByText('参数快照')).toBeInTheDocument();
    expect(screen.getByText('runtime')).toBeInTheDocument();
  });
});

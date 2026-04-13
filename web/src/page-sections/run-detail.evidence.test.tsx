import { cleanup, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RunDetailAuditPanel } from './run-detail-audit';
import type { ApiBacktestRunDetail } from '../types';

const LOADING_COPY = '\u6b63\u5728\u52a0\u8f7d\u8bc1\u636e\u8f68\u8ff9\u2026';
const TRADE_EVIDENCE_LIST = '\u4ea4\u6613\u8bc1\u636e\u5217\u8868';
const PROFIT_DESC = '\u6536\u76ca\u5012\u5e8f';

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

describe('RunDetailAuditPanel evidence panel', () => {
  it('keeps the trade list interactive while audit details are still loading', () => {
    cleanup();

    render(
      <RunDetailAuditPanel
        activeTradeId="trade-preview"
        audit={null}
        auditLoading
        detail={detail}
        onSelectTrade={() => undefined}
      />,
    );

    expect(screen.getByText(LOADING_COPY)).toBeInTheDocument();
    expect(screen.getByText(TRADE_EVIDENCE_LIST)).toBeInTheDocument();
    expect(screen.getByDisplayValue(PROFIT_DESC)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /QQQ/i })).toBeInTheDocument();
    expect(screen.queryByText('配置与环境快照')).not.toBeInTheDocument();
  });
});

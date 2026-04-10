import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RunDetailAuditPanel } from './run-detail-audit';
import type { ApiBacktestRunDetail } from '../types';

const LOADING_COPY = '\u6b63\u5728\u52a0\u8f7d\u8bc1\u636e\u8f68\u8ff9\u2026';
const SNAPSHOT_SUMMARY = '\u6570\u636e\u5feb\u7167\u6458\u8981';
const PARAMETER_SNAPSHOT = '\u53c2\u6570\u5feb\u7167';
const RUNTIME_LABEL = '\u8fd0\u884c\u73af\u5883';
const PREVIEW_VALUE = '\u9884\u89c8';

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

    expect(screen.getByText(LOADING_COPY)).toBeInTheDocument();
    expect(screen.getAllByText(SNAPSHOT_SUMMARY).length).toBeGreaterThan(0);
    expect(screen.getByText('ds-preview')).toBeInTheDocument();
    expect(screen.getAllByText(PARAMETER_SNAPSHOT).length).toBeGreaterThan(0);
    expect(screen.getAllByText(RUNTIME_LABEL).length).toBeGreaterThan(0);
    expect(screen.getAllByText(PREVIEW_VALUE).length).toBeGreaterThan(0);
  });
});

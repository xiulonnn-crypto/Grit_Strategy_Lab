import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { BacktestRunDetail } from '../types';
import { RunDetailEvidencePanel } from './run-detail-evidence';

function makeDetail(overrides: Partial<BacktestRunDetail> = {}): BacktestRunDetail {
  return {
    id: 'bt-001',
    strategyId: 'str-001',
    strategyName: '美股质量动量',
    status: 'COMPLETED',
    startedAt: '2025-01-01T09:30:00Z',
    completedAt: '2025-01-01T16:00:00Z',
    totalReturn: 0.25,
    sharpe: 1.4,
    maxDrawdown: -0.08,
    warnings: 1,
    allowedActions: [],
    executionStage: 'SIMULATING',
    progressPct: 85,
    evidenceRail: [{ title: 'Signal Audit', detail: 'Signals are aligned with the stored configuration.', severity: 'success' }],
    metrics: [{ label: 'Total Return', value: '25.0%' }],
    chartSeries: [{ date: '2025-01-01', equity: 100, benchmark: 100, drawdown: 0, isOos: false }],
    tradeDetails: [],
    notes: ['Reviewed by research and compliance.'],
    legacyDemoRun: false,
    configuration: {
      parameterVersionId: 'pv-002',
      parameterVersion: 2,
      datasetSnapshotId: 'ds-001',
      universeSnapshotId: 'un-001',
      executionPolicy: 'T_CLOSE_TO_T1_OPEN',
      feeBps: 5,
      slippageBps: 5,
      universeSymbols: ['QQQ', 'AAPL'],
      benchmarkSymbol: 'QQQ',
      effectiveStartDate: '2024-01-01',
      effectiveEndDate: '2025-01-01',
    },
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('RunDetailEvidencePanel', () => {
  it('opens the evidence tags with click, focus, and keyboard access', () => {
    const navigate = vi.fn();
    render(<RunDetailEvidencePanel detail={makeDetail()} isMobile={true} navigate={navigate} translateExecutionStage={(stage) => stage ?? 'n/a'} />);

    const policyButton = screen.getByRole('button', { name: '执行策略: T_CLOSE_TO_T1_OPEN' });
    fireEvent.focus(policyButton);
    expect(screen.getByText('信号在 T 日收盘生成，成交发生在 T+1 开盘，并且不允许同一根 K 线内直接成交。')).toBeInTheDocument();

    fireEvent.keyDown(policyButton, { key: 'Escape' });
    expect(screen.queryByText('信号在 T 日收盘生成，成交发生在 T+1 开盘，并且不允许同一根 K 线内直接成交。')).not.toBeInTheDocument();

    const datasetButton = screen.getByRole('button', { name: '数据集快照: ds-001' });
    fireEvent.click(datasetButton);
    expect(screen.getByText('数据集快照使用这次回测落库时绑定的快照记录。快照编号：ds-001。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开快照页' }));
    expect(navigate).toHaveBeenCalledWith('/snapshots');
  });

  it('falls back safely for unknown execution policy codes', () => {
    render(<RunDetailEvidencePanel detail={makeDetail({ configuration: { ...makeDetail().configuration!, executionPolicy: 'CUSTOM_POLICY' } })} isMobile={false} navigate={() => undefined} translateExecutionStage={(stage) => stage ?? 'n/a'} />);

    fireEvent.click(screen.getByRole('button', { name: '执行策略: CUSTOM_POLICY' }));
    expect(screen.getByText('CUSTOM_POLICY')).toBeInTheDocument();
    expect(screen.getByText('当前执行策略代码未内置说明，页面按原始值展示：CUSTOM_POLICY。')).toBeInTheDocument();
  });

  it('keeps the empty state when configuration is missing', () => {
    render(<RunDetailEvidencePanel detail={makeDetail({ configuration: undefined })} isMobile={false} navigate={() => undefined} translateExecutionStage={(stage) => stage ?? 'n/a'} />);

    expect(screen.getByText('暂无配置快照')).toBeInTheDocument();
    expect(screen.getByText('这次回测没有存储的配置快照。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /数据集快照/i })).not.toBeInTheDocument();
  });
});

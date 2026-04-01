import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BacktestSubmitPage } from './pages/backtest-submit-page-cn';
import { ApiError } from './types';

type FakeApi = {
  getStrategyDetail: ReturnType<typeof vi.fn>;
  getBacktestRunDetail: ReturnType<typeof vi.fn>;
  previewBacktestRun: ReturnType<typeof vi.fn>;
  submitBacktestRun: ReturnType<typeof vi.fn>;
  refreshSnapshots: ReturnType<typeof vi.fn>;
};

const fakeApi = vi.hoisted<FakeApi>(() => ({
  getStrategyDetail: vi.fn(),
  getBacktestRunDetail: vi.fn(),
  previewBacktestRun: vi.fn(),
  submitBacktestRun: vi.fn(),
  refreshSnapshots: vi.fn(),
}));

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

beforeEach(() => {
  fakeApi.getStrategyDetail.mockReset();
  fakeApi.getBacktestRunDetail.mockReset();
  fakeApi.previewBacktestRun.mockReset();
  fakeApi.submitBacktestRun.mockReset();
  fakeApi.refreshSnapshots.mockReset();
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('回测提交页', () => {
  it('能刷新快照、预览并提交真实回测', async () => {
    fakeApi.getStrategyDetail.mockResolvedValue({
      id: 'strat-001',
      name: 'QQQ 均值回归策略',
      strategy_type: 'MEAN_REVERSION',
      universe_name: 'QQQ',
      current_parameter_version: 'v2',
      current_parameter_version_id: 'pv-002',
      dataset_snapshot_id: 'ds-001',
      universe_snapshot_id: 'un-001',
      allowed_actions: ['backtest'],
      parameter_history: [],
    });
    fakeApi.refreshSnapshots.mockResolvedValue(undefined);
    fakeApi.previewBacktestRun.mockResolvedValue({
      effective_start_date: '2016-03-24',
      effective_end_date: '2026-03-24',
      data_segment_type: 'FULL',
      oos_start_date: '2024-03-21',
      warnings: ['快照覆盖率略低，建议先刷新。'],
      metrics: {
        total_return: 0.374,
        sharpe: 0.91,
        max_drawdown: -0.26,
      },
    });
    fakeApi.submitBacktestRun.mockResolvedValue({ id: 'bt-001' });

    await act(async () => {
      render(<BacktestSubmitPage strategyId='strat-001' />);
    });

    expect(await screen.findByText('提交参数')).toBeInTheDocument();
    expect(screen.getByText('QQQ 均值回归策略')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '刷新快照' }));
    await waitFor(() => expect(fakeApi.refreshSnapshots).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: '预览发起' }));

    expect(await screen.findByText('快照覆盖率略低，建议先刷新。')).toBeInTheDocument();
    expect(screen.getAllByText('2016-03-24').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2026-03-24').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '提交回测' }));

    await waitFor(() =>
      expect(fakeApi.submitBacktestRun).toHaveBeenCalledWith('strat-001', {
        idempotency_key: 'run-strat-001',
        start_date: '2016-03-24',
        end_date: '2026-03-24',
        parameter_version_id: 'pv-002',
        dataset_snapshot_id: 'ds-001',
        universe_snapshot_id: 'un-001',
      }),
    );
    expect(window.location.hash).toBe('#/runs/bt-001');
  });

  it('会拦住非法日期范围', async () => {
    fakeApi.getStrategyDetail.mockResolvedValue({
      id: 'strat-001',
      name: 'QQQ 均值回归策略',
      strategy_type: 'MEAN_REVERSION',
      universe_name: 'QQQ',
      current_parameter_version: 'v2',
      current_parameter_version_id: 'pv-002',
      dataset_snapshot_id: 'ds-001',
      universe_snapshot_id: 'un-001',
      allowed_actions: ['backtest'],
      parameter_history: [],
    });

    await act(async () => {
      render(<BacktestSubmitPage strategyId='strat-001' />);
    });

    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2025-04-01' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2025-03-01' } });
    fireEvent.click(screen.getByRole('button', { name: '预览发起' }));

    expect(await screen.findByText('开始日期必须早于或等于结束日期。')).toBeInTheDocument();
    expect(fakeApi.previewBacktestRun).not.toHaveBeenCalled();
  });

  it('会把后端的阻塞预览错误展示出来', async () => {
    fakeApi.getStrategyDetail.mockResolvedValue({
      id: 'strat-001',
      name: 'QQQ 均值回归策略',
      strategy_type: 'MEAN_REVERSION',
      universe_name: 'QQQ',
      current_parameter_version: 'v2',
      current_parameter_version_id: 'pv-002',
      dataset_snapshot_id: 'ds-001',
      universe_snapshot_id: 'un-001',
      allowed_actions: ['backtest'],
      parameter_history: [],
    });
    fakeApi.previewBacktestRun.mockRejectedValue(
      new ApiError({
        status: 409,
        code: 'snapshot_blocked',
        message: '请先刷新快照后再预览。',
        blocking_code: 'snapshot_blocking',
      }),
    );

    await act(async () => {
      render(<BacktestSubmitPage strategyId='strat-001' />);
    });

    fireEvent.click(screen.getByRole('button', { name: '预览发起' }));

    expect(await screen.findByText('请先刷新快照后再预览。 (snapshot_blocking)')).toBeInTheDocument();
  });

  it('会用来源回测预填参数并在预览和提交时带上 source_run_id', async () => {
    fakeApi.getStrategyDetail.mockResolvedValue({
      id: 'strat-001',
      name: 'QQQ 均值回归策略',
      strategy_type: 'MEAN_REVERSION',
      universe_name: 'QQQ',
      current_parameter_version: 'v2',
      current_parameter_version_id: 'pv-002',
      dataset_snapshot_id: 'ds-001',
      universe_snapshot_id: 'un-001',
      allowed_actions: ['backtest'],
      parameter_history: [],
    });
    fakeApi.getBacktestRunDetail.mockResolvedValue({
      id: 'bt-seed',
      strategy_id: 'strat-001',
      strategy_name: 'QQQ 均值回归策略',
      status: 'COMPLETED',
      metrics: { total_return: 0.12, sharpe: 0.82, max_drawdown: -0.15 },
      chart_series: [
        { trade_date: '2024-01-02', equity: 100, benchmark: 100, drawdown: 0, is_oos: false },
        { trade_date: '2025-03-28', equity: 112, benchmark: 106, drawdown: -0.15, is_oos: true },
      ],
      snapshot_summary: {
        dataset_snapshot_id: 'ds-seed',
        universe_snapshot_id: 'un-seed',
      },
      parameter_version_id: 'pv-seed',
    });
    fakeApi.previewBacktestRun.mockResolvedValue({
      effective_start_date: '2024-01-02',
      effective_end_date: '2025-03-28',
      data_segment_type: 'FULL',
      warnings: [],
      metrics: {},
    });
    fakeApi.submitBacktestRun.mockResolvedValue({ id: 'bt-777' });

    await act(async () => {
      render(<BacktestSubmitPage strategyId="strat-001" sourceRunId="bt-seed" />);
    });

    expect(await screen.findByDisplayValue('2024-01-02')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('2025-03-28')).toBeInTheDocument();
    expect(screen.getByText('pv-seed')).toBeInTheDocument();
    expect(screen.getByText('ds-seed')).toBeInTheDocument();
    expect(screen.getByText('un-seed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '预览发起' }));
    await waitFor(() =>
      expect(fakeApi.previewBacktestRun).toHaveBeenCalledWith('strat-001', {
        start_date: '2024-01-02',
        end_date: '2025-03-28',
        parameter_version_id: 'pv-seed',
        dataset_snapshot_id: 'ds-seed',
        universe_snapshot_id: 'un-seed',
        source_run_id: 'bt-seed',
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: '提交回测' }));
    await waitFor(() =>
      expect(fakeApi.submitBacktestRun).toHaveBeenCalledWith('strat-001', {
        idempotency_key: 'run-strat-001',
        start_date: '2024-01-02',
        end_date: '2025-03-28',
        parameter_version_id: 'pv-seed',
        dataset_snapshot_id: 'ds-seed',
        universe_snapshot_id: 'un-seed',
        source_run_id: 'bt-seed',
      }),
    );
    expect(window.location.hash).toBe('#/runs/bt-777');
  });
});

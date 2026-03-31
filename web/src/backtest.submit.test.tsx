import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BacktestSubmitPage } from './pages/backtest-submit-page';
import { ApiError } from './types';

type FakeApi = {
  getStrategyDetail: ReturnType<typeof vi.fn>;
  previewBacktestRun: ReturnType<typeof vi.fn>;
  submitBacktestRun: ReturnType<typeof vi.fn>;
  refreshSnapshots: ReturnType<typeof vi.fn>;
};

const fakeApi = vi.hoisted<FakeApi>(() => ({
  getStrategyDetail: vi.fn(),
  previewBacktestRun: vi.fn(),
  submitBacktestRun: vi.fn(),
  refreshSnapshots: vi.fn(),
}));

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

beforeEach(() => {
  fakeApi.getStrategyDetail.mockReset();
  fakeApi.previewBacktestRun.mockReset();
  fakeApi.submitBacktestRun.mockReset();
  fakeApi.refreshSnapshots.mockReset();
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('Backtest submit page', () => {
  it('previews and submits a run through the restored route', async () => {
    fakeApi.getStrategyDetail.mockResolvedValue({
      id: 'strat-001',
      name: 'Quality Momentum',
      strategy_type: 'MOMENTUM',
      universe_name: 'QQQ',
      parameter_history: [],
    });
    fakeApi.previewBacktestRun.mockResolvedValue({
      effective_start_date: '2024-01-02',
      effective_end_date: '2025-01-31',
      data_segment_type: 'FULL',
      warnings: ['Coverage is slightly below the preferred threshold.'],
    });
    fakeApi.submitBacktestRun.mockResolvedValue({ id: 'bt-001' });

    await act(async () => {
      render(<BacktestSubmitPage strategyId="strat-001" />);
    });

    expect(await screen.findByText('Quality Momentum')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Preview run' }));

    expect(await screen.findByText('Coverage is slightly below the preferred threshold.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

    await waitFor(() =>
      expect(fakeApi.submitBacktestRun).toHaveBeenCalledWith('strat-001', {
        idempotency_key: 'run-strat-001',
        start_date: '2024-03-01',
        end_date: '2025-03-31',
      }),
    );
    expect(window.location.hash).toBe('#/runs/bt-001');
  });

  it('blocks preview when the date range is invalid', async () => {
    fakeApi.getStrategyDetail.mockResolvedValue({
      id: 'strat-001',
      name: 'Quality Momentum',
      strategy_type: 'MOMENTUM',
      universe_name: 'QQQ',
      parameter_history: [],
    });

    await act(async () => {
      render(<BacktestSubmitPage strategyId="strat-001" />);
    });

    expect(await screen.findByText('Quality Momentum')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2025-04-01' } });
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2025-03-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview run' }));

    expect(await screen.findByText('Start date must be earlier than or equal to end date.')).toBeInTheDocument();
    expect(fakeApi.previewBacktestRun).not.toHaveBeenCalled();
  });

  it('surfaces blocking preview errors from the backend', async () => {
    fakeApi.getStrategyDetail.mockResolvedValue({
      id: 'strat-001',
      name: 'Quality Momentum',
      strategy_type: 'MOMENTUM',
      universe_name: 'QQQ',
      parameter_history: [],
    });
    fakeApi.previewBacktestRun.mockRejectedValue(
      new ApiError({
        status: 409,
        code: 'snapshot_blocked',
        message: 'Refresh snapshots before previewing this run.',
        blocking_code: 'snapshot_blocking',
      }),
    );

    await act(async () => {
      render(<BacktestSubmitPage strategyId="strat-001" />);
    });

    expect(await screen.findByText('Quality Momentum')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Preview run' }));

    expect(
      await screen.findByText('Refresh snapshots before previewing this run. (snapshot_blocking)'),
    ).toBeInTheDocument();
  });
});

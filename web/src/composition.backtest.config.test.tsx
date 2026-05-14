import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompositionBacktestConfigPage } from './pages/composition-backtest-config-page';
import type { ApiCompositionDetail } from './types';

type FakeApi = {
  createCompositionBacktestRun?: ReturnType<typeof vi.fn>;
  getCompositionDetail?: ReturnType<typeof vi.fn>;
};

const fakeApi = vi.hoisted<FakeApi>(() => ({
  createCompositionBacktestRun: vi.fn(),
  getCompositionDetail: vi.fn(),
}));

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

vi.mock('./lib/appRouteContext', () => ({
  navigateTo: vi.fn(),
}));

const detail = {
  id: 'composition-target',
  name: '多因子均衡组合A',
  description: 'Regression composition',
  status: 'ACTIVE',
  status_label: 'ACTIVE',
  updated_at: '2026-05-11T09:24:27Z',
  rebalance_frequency: 'quarterly',
  return_quality_summary: { coverage_pct: 100 },
  source_integrity: [],
  normalized_legs: [
    {
      id: 'leg-a',
      leg_kind: 'strategy',
      display_name: '多因子核心模型',
      source_ref_id: 'strategy_leg::strat::v1',
      source_ref_type: 'strategy',
      weight_pct: 60,
      weight_locked: false,
      ordering: 1,
      config: {},
    },
  ],
} as unknown as ApiCompositionDetail;

beforeEach(() => {
  fakeApi.getCompositionDetail = vi.fn().mockResolvedValue(detail);
  fakeApi.createCompositionBacktestRun = vi.fn().mockResolvedValue({ run_id: 'comp-run-30y' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CompositionBacktestConfigPage', () => {
  it('submits the selected preset period with the matching horizon years', async () => {
    await act(async () => {
      render(<CompositionBacktestConfigPage compositionId="composition-target" />);
    });

    await screen.findByText('多因子均衡组合A');
    fireEvent.click(screen.getByText('30Y').closest('button')!);
    fireEvent.click(document.querySelector('.primary-button')!);

    await waitFor(() => expect(fakeApi.createCompositionBacktestRun).toHaveBeenCalledWith(
      'composition-target',
      expect.objectContaining({
        period: '30Y',
        horizon_years: 30,
      }),
    ));
  });
});

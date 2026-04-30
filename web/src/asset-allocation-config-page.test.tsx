import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetAllocationConfigPage } from './pages/asset-allocation-config-page';
import type { ApiSnapshotOverview, ApiStrategyCreationSession } from './types';

type FakeApi = {
  createCreationSession: ReturnType<typeof vi.fn>;
  getCreationSession: ReturnType<typeof vi.fn>;
  getSnapshotOverview: ReturnType<typeof vi.fn>;
  materializeStrategy: ReturnType<typeof vi.fn>;
  recommendAssetAllocationWeights: ReturnType<typeof vi.fn>;
  updateConfirmation: ReturnType<typeof vi.fn>;
};

const fakeApi = vi.hoisted<FakeApi>(() => ({
  createCreationSession: vi.fn(),
  getCreationSession: vi.fn(),
  getSnapshotOverview: vi.fn(),
  materializeStrategy: vi.fn(),
  recommendAssetAllocationWeights: vi.fn(),
  updateConfirmation: vi.fn(),
}));

vi.mock('./lib/demoStoreContext', () => ({ useApiClient: () => fakeApi }));

const legacyDefaultSession: ApiStrategyCreationSession = {
  id: 'cs-allocation',
  status: 'NEEDS_INPUT',
  revision: 1,
  top_level: {
    strategy_type: 'ASSET_ALLOCATION',
    universe_name: 'Global Allocation',
    rebalance_frequency: 'quarterly',
  },
  messages: [],
  pending_inputs: [],
  manual_conflicts: [],
  confirmation_fields: {
    top_level: [
      { key: 'strategy_type', label: '策略类型', value: 'ASSET_ALLOCATION', source: 'system_default' },
      { key: 'universe_name', label: '股票池', value: 'Global Allocation', source: 'system_default' },
      { key: 'rebalance_frequency', label: '再平衡频次', value: 'quarterly', source: 'system_default' },
    ],
    parameters: [
      { key: 'strategy_name', label: '策略名称', value: '全球资产配置策略', source: 'system_default' },
      { key: 'strategy_description', label: '策略说明', value: '多资产风险预算、目标权重、再平衡与成本假设。', source: 'system_default' },
      { key: 'benchmark_symbol', label: '基准', value: 'SPY', source: 'system_default' },
      {
        key: 'allocation_assets',
        label: '资产清单',
        value: [
          { symbol: 'SPY', display_name: 'S&P 500 ETF', asset_class: 'Equity' },
          { symbol: 'QQQ', display_name: 'Nasdaq 100 ETF', asset_class: 'Growth Equity' },
          { symbol: 'TLT', display_name: '20Y Treasury ETF', asset_class: 'Treasury' },
          { symbol: 'GLD', display_name: 'Gold ETF', asset_class: 'Commodity' },
        ],
        source: 'system_default',
      },
      { key: 'allocation_weight__SPY_pct', label: 'SPY权重(%)', value: 35, source: 'system_default' },
      { key: 'allocation_weight__QQQ_pct', label: 'QQQ权重(%)', value: 25, source: 'system_default' },
      { key: 'allocation_weight__TLT_pct', label: 'TLT权重(%)', value: 25, source: 'system_default' },
      { key: 'allocation_weight__GLD_pct', label: 'GLD权重(%)', value: 15, source: 'system_default' },
    ],
  },
};

const snapshotOverview = {
  overall_status: 'INCOMPLETE',
  last_refreshed_at: '2026-04-30T05:16:00Z',
  dataset_snapshots: [
    {
      id: 'ds-price',
      name: '股票价格数据',
      status: 'READY',
      metadata: {
        selected_latest_symbols: ['AAPL', 'MSFT', 'NVDA'],
        benchmark_etf_coverage: {
          ready_count: 2,
          total_count: 2,
          missing_symbols: [],
          symbols: [
            { symbol: 'SPY', status: 'READY', start_date: '1996-01-02', end_date: '2026-04-27', trade_days: 7628 },
            { symbol: 'QQQ', status: 'READY', start_date: '1999-03-10', end_date: '2026-04-27', trade_days: 6824 },
          ],
        },
      },
    },
  ],
  universe_snapshots: [],
  bond_fixed_income: {
    global_pulse: { headline: '', status: 'PENDING', updated_at: null },
    pillar_groups: [],
    curve_preview: [],
    audit_matrix: [],
    raw_registry: [],
    eligible_sources: [],
    eligible_instruments: [
      {
        id: 'bond-ust-cmt-10y',
        label: 'UST CMT 10Y',
        instrument_type: 'BOND',
        asset_type: 'UST',
        source: 'bond_fixed_income',
        status: 'COMPOSABLE',
        symbol: 'UST10Y',
        missing_fields: [],
        inferred_fields: {},
        field_status: {},
      },
    ],
    scheduler: [],
    selected_source_summary: null,
    system_diagnostics: [],
  },
} as unknown as ApiSnapshotOverview;

beforeEach(() => {
  fakeApi.createCreationSession.mockReset();
  fakeApi.getCreationSession.mockReset();
  fakeApi.getSnapshotOverview.mockReset();
  fakeApi.materializeStrategy.mockReset();
  fakeApi.recommendAssetAllocationWeights.mockReset();
  fakeApi.updateConfirmation.mockReset();
  fakeApi.getCreationSession.mockResolvedValue(legacyDefaultSession);
  fakeApi.getSnapshotOverview.mockResolvedValue(snapshotOverview);
});

afterEach(() => {
  cleanup();
});

describe('asset allocation config page', () => {
  it('starts with an empty basket and removes the hero status card', async () => {
    render(<AssetAllocationConfigPage sessionId="cs-allocation" />);

    expect(await screen.findByRole('heading', { level: 1, name: '资产配置策略配置' })).toBeInTheDocument();
    expect(screen.queryByText('参数状态')).toBeNull();
    expect(screen.queryByRole('button', { name: '移除' })).toBeNull();
    expect(screen.getByText('合计 0.0%')).toBeInTheDocument();
  });

  it('adds symbols from snapshot search and limits benchmark to benchmark coverage', async () => {
    render(<AssetAllocationConfigPage sessionId="cs-allocation" />);

    const benchmark = (await screen.findByLabelText('基准')) as HTMLSelectElement;
    expect(benchmark.tagName).toBe('SELECT');
    expect([...benchmark.options].map((option) => option.value)).toEqual(['SPY', 'QQQ']);

    const symbolSearch = screen.getByRole('combobox', { name: '新增标的代码' });
    expect(symbolSearch).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('option', { name: /AAPL/ })).toBeNull();

    const assetClassInput = screen.getByLabelText('新增资产类别') as HTMLInputElement;
    fireEvent.change(symbolSearch, { target: { value: 'apl' } });
    fireEvent.click(await screen.findByRole('option', { name: /AAPL/ }));
    expect(symbolSearch).toHaveAttribute('aria-expanded', 'false');
    expect(assetClassInput.value).toBe('股票');
    fireEvent.click(screen.getByRole('button', { name: '添加标的' }));

    expect(screen.getAllByText('AAPL').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('AAPL display name')).toBeNull();
    expect(screen.queryByText('TLT')).toBeNull();
    expect(screen.getByText('目标权重(%)')).toBeInTheDocument();
    const targetWeight = screen.getByLabelText('AAPL target weight') as HTMLInputElement;
    expect(targetWeight.type).toBe('number');
    expect(targetWeight.value).toBe('0.0');
    fireEvent.change(targetWeight, { target: { value: '12' } });
    expect(targetWeight.value).toBe('12');
    fireEvent.blur(targetWeight);
    expect(targetWeight.value).toBe('12.0');
  });

  it('defaults fixed-income snapshot symbols to bond asset class', async () => {
    render(<AssetAllocationConfigPage sessionId="cs-allocation" />);

    await screen.findByLabelText('基准');
    const symbolSearch = screen.getByRole('combobox', { name: '新增标的代码' });
    const assetClassInput = screen.getByLabelText('新增资产类别') as HTMLInputElement;

    fireEvent.change(symbolSearch, { target: { value: 'ust' } });
    fireEvent.click(await screen.findByRole('option', { name: /UST10Y/ }));

    expect(assetClassInput.value).toBe('债券');
  });
});

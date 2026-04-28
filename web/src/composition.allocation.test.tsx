import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CompositionAllocationConfigPage,
  CompositionAllocationResultPage,
} from './pages/composition-allocation-page';

type FakeApi = {
  getCompositionDetail?: ReturnType<typeof vi.fn>;
};

const fakeApi = vi.hoisted<FakeApi>(() => ({
  getCompositionDetail: vi.fn(),
}));

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

const detail = {
  id: 'comp-001',
  name: '全天候研究组合',
  updated_at: '2026-04-28T00:00:00.000Z',
  benchmark_definition: { label: '60/40 基准' },
  return_quality_summary: { status: 'verified' },
  normalized_legs: [
    {
      id: 'alpha-core',
      leg_kind: 'strategy',
      display_name: 'Alpha Core',
      weight_pct: 38,
      weight_locked: false,
    },
    {
      id: 'qqq-grid',
      leg_kind: 'strategy',
      display_name: 'QQQ Grid',
      weight_pct: 22,
      weight_locked: false,
    },
    {
      id: 'tbill',
      leg_kind: 'asset',
      display_name: 'T-Bill',
      weight_pct: 30,
      weight_locked: true,
    },
    {
      id: 'cash',
      leg_kind: 'cash',
      display_name: 'Cash',
      weight_pct: 10,
      weight_locked: true,
    },
  ],
};

describe('Composition allocation split UI', () => {
  beforeEach(() => {
    fakeApi.getCompositionDetail = vi.fn().mockResolvedValue(detail);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the config split page with intent navigation, risk controls, chips, and progressive expert settings', async () => {
    await act(async () => {
      render(<CompositionAllocationConfigPage compositionId="comp-001" />);
    });

    expect(await screen.findByRole('heading', { level: 1, name: '组合优化实验室' })).toBeInTheDocument();
    expect(fakeApi.getCompositionDetail).toHaveBeenCalledWith('comp-001');
    expect(screen.getByRole('button', { name: /波动最小/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /风险平价/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /收益最大/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /专家模式/ })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: '目标波动率' })).toHaveValue('8');
    expect(screen.getByRole('button', { name: '10年' })).toHaveClass('is-active');
    expect(screen.getByRole('button', { name: '中 18%' })).toHaveClass('is-active');
    expect(screen.getByRole('button', { name: /Cash 10%/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /代理数据门禁开启/ })).toBeInTheDocument();
    expect(screen.getByText('剩余 60% 权重可优化')).toBeInTheDocument();
    expect(screen.getByLabelText('协方差热力图')).toBeInTheDocument();
    expect(screen.queryByLabelText('MVO 模式')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('slider', { name: '目标波动率' }), { target: { value: '9' } });
    expect(screen.getByText('9% ± 2%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /专家模式/ }));
    expect(screen.getByLabelText('MVO 模式')).toBeInTheDocument();
    expect(screen.getByLabelText('协方差模型')).toBeInTheDocument();
    expect(screen.getByLabelText('半衰期')).toBeInTheDocument();
    expect(screen.getByText('基于历史填充预期年化收益')).toBeInTheDocument();
  });

  it('keeps asset adjustment simplified until a leg micro-tune entry is opened', async () => {
    await act(async () => {
      render(<CompositionAllocationConfigPage compositionId="comp-001" />);
    });

    await screen.findByRole('heading', { level: 2, name: '资产微调' });
    expect(screen.getByRole('columnheader', { name: '资产腿' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '当前权重' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '优化自由度' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '微调入口' })).toBeInTheDocument();
    expect(document.querySelector('[data-ui="allocation-constraint-popover"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '微调 Alpha Core' }));
    expect(screen.getByText('约束气泡')).toBeInTheDocument();
    const popover = document.querySelector<HTMLElement>('[data-ui="allocation-constraint-popover"]');
    expect(popover).not.toBeNull();
    expect(within(popover!).getByText(/下限/)).toBeInTheDocument();
    expect(within(popover!).getByText(/上限/)).toBeInTheDocument();
  });

  it('renders result evidence and creates a custom candidate from a clicked frontier point', async () => {
    await act(async () => {
      render(<CompositionAllocationResultPage compositionId="comp-001" jobId="alloc-001" />);
    });

    expect(await screen.findByRole('heading', { level: 1, name: '组合优化结果' })).toBeInTheDocument();
    expect(screen.getByText(/Current 与 Benchmark 同屏对照/)).toBeInTheDocument();
    expect(screen.getAllByText(/最符合你的目标/).length).toBeGreaterThan(0);
    expect(screen.getByText(/ENB 3.0/)).toBeInTheDocument();
    expect(screen.getByText(/扣费后 Sharpe 1.15/)).toBeInTheDocument();
    expect(screen.getByText(/2020 疫情回撤 -3.1%/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Incremental Backtest/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '迁移成本归因' })).toBeInTheDocument();
    expect(screen.getByText(/8 bps 来自 Alpha 调减冲击成本/)).toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByLabelText('自定义候选 frontier point'));
    await waitFor(() => expect(screen.getByText(/自定义候选 · 8.3% 波动/)).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('自定义候选 frontier point'));
    expect(screen.getByText('自定义候选 · 曲线点击生成')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存为实验候选' })).toBeInTheDocument();
    expect(screen.getByText(/风险略集中/)).toBeInTheDocument();
  });
});

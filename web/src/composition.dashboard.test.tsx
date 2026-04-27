import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompositionDashboardPage } from './pages/composition-dashboard-page';
import type { ApiCompositionListItem } from './types';

type FakeApi = {
  listCompositions?: ReturnType<typeof vi.fn>;
  updateComposition?: ReturnType<typeof vi.fn>;
};

const fakeApi = vi.hoisted<FakeApi>(() => ({
  listCompositions: vi.fn(),
  updateComposition: vi.fn(),
}));

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

const compositions: ApiCompositionListItem[] = [
  {
    id: 'comp-balanced',
    name: '平衡收益组合',
    status: 'ACTIVE',
    composition_score: 82.4,
    leg_count: 4,
    rebalance_frequency: 'quarterly',
    benchmark_label: 'S&P 500',
    annualized_return: 0.118,
    sharpe: 1.12,
    max_drawdown: -0.076,
    updated_at: '2026-04-20T02:30:00.000Z',
    latest_activity_label: '最近一次完成季度复核',
    allowed_actions: ['open_composition_workbench'],
  },
  {
    id: 'comp-growth',
    name: '成长增强组合',
    status: 'ACTIVE',
    composition_score: 76.1,
    leg_count: 3,
    rebalance_frequency: 'monthly',
    benchmark_label: 'NASDAQ 100',
    annualized_return: 0.153,
    sharpe: 1.28,
    max_drawdown: -0.112,
    updated_at: '2026-04-19T04:15:00.000Z',
    latest_activity_label: '最近一次完成来源检查',
    allowed_actions: ['open_composition_workbench'],
  },
  {
    id: 'comp-draft',
    name: '固定收益防守草稿',
    status: 'DRAFT',
    composition_score: 64.8,
    leg_count: 2,
    rebalance_frequency: 'semiannual',
    benchmark_label: 'Bloomberg Agg',
    annualized_return: 0.064,
    sharpe: 0.72,
    max_drawdown: -0.041,
    updated_at: '2026-04-18T09:45:00.000Z',
    latest_activity_label: '草稿仍待补齐现金腿说明',
    allowed_actions: ['open_composition_workbench'],
  },
  {
    id: 'comp-income',
    name: '信用缓冲现金腿',
    status: 'ACTIVE',
    composition_score: 71.6,
    leg_count: 3,
    rebalance_frequency: 'quarterly',
    benchmark_label: null,
    annualized_return: 0.071,
    sharpe: 0.88,
    max_drawdown: -0.052,
    updated_at: '2026-04-17T12:00:00.000Z',
    latest_activity_label: '资产腿来源补齐',
    allowed_actions: ['open_composition_workbench'],
  },
  {
    id: 'comp-archived',
    name: 'Archived Hidden Composition',
    status: 'ARCHIVED',
    composition_score: 55.2,
    leg_count: 2,
    rebalance_frequency: 'monthly',
    benchmark_label: 'MSCI World',
    annualized_return: 0.031,
    sharpe: 0.34,
    max_drawdown: -0.094,
    updated_at: '2026-04-16T08:00:00.000Z',
    latest_activity_label: 'Archived entry',
    allowed_actions: ['open_composition_workbench'],
  },
];

beforeEach(() => {
  fakeApi.listCompositions = vi.fn().mockResolvedValue(compositions);
  fakeApi.updateComposition = vi.fn().mockResolvedValue({ ...compositions[0], status: 'ARCHIVED' });
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.location.hash = '';
});

describe('composition dashboard page', () => {
  it('renders the approved dashboard structure and exposes stable route selectors', async () => {
    await act(async () => {
      render(<CompositionDashboardPage />);
    });

    expect(await screen.findByRole('heading', { level: 1, name: '组合仪表板' })).toBeInTheDocument();

    const root = document.querySelector(
      '.composition-dashboard-page[data-route-root="compositions"][data-page-root="composition-dashboard"]',
    );
    expect(root).not.toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: '我的组合' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '待处理动作' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '最近活动' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '组合观察' })).toBeInTheDocument();
    expect(screen.getAllByText('平衡收益组合').length).toBeGreaterThan(0);
    expect(screen.getAllByText('成长增强组合').length).toBeGreaterThan(0);
    expect(screen.getAllByText('固定收益防守草稿').length).toBeGreaterThan(0);
    expect(screen.queryByText('Archived Hidden Composition')).toBeNull();
    expect(document.querySelectorAll('.composition-dashboard-card')).toHaveLength(2);
    expect(document.querySelectorAll('.composition-dashboard-task')).toHaveLength(3);
    expect(document.querySelectorAll('.composition-dashboard-activity')).toHaveLength(4);
    expect(screen.queryByText('策略工作台')).toBeNull();
    expect(screen.getByText('冻结来源覆盖')).toBeInTheDocument();

    const observation = screen.getByRole('heading', { level: 2, name: '组合观察' }).closest('section');
    expect(observation).not.toBeNull();
    expect(within(observation as HTMLElement).getByText('最高年化')).toBeInTheDocument();
    expect(within(observation as HTMLElement).getByText('+15.3%')).toBeInTheDocument();
    expect(within(observation as HTMLElement).getAllByText('成长增强组合').length).toBeGreaterThan(0);
    expect(within(observation as HTMLElement).getByText('平均评分')).toBeInTheDocument();
    expect(within(observation as HTMLElement).queryByText('最近 90 日')).toBeNull();
    expect(within(observation as HTMLElement).queryByText('正式组合收益流')).toBeNull();
    expect(within(observation as HTMLElement).queryByText('基准虚线')).toBeNull();
    expect(within(observation as HTMLElement).queryByText('ETF 腿相关性略升')).toBeNull();
    expect(observation?.querySelector('.composition-dashboard-observation__chart')).toBeNull();

    const balancedCardTitle = screen.getAllByRole('heading', {
      level: 3,
      name: '平衡收益组合',
    })[0];
    const balancedCard = balancedCardTitle.closest('.composition-dashboard-card');
    expect(balancedCard).not.toBeNull();
    expect(within(balancedCard as HTMLElement).queryByText('波动')).toBeNull();
    expect(within(balancedCard as HTMLElement).getByText('夏普')).toBeInTheDocument();
    expect(within(balancedCard as HTMLElement).getByText('1.12')).toBeInTheDocument();
    fireEvent.click(within(balancedCard as HTMLElement).getByRole('button', { name: '查看详情' }));
    await waitFor(() => expect(window.location.hash).toBe('#/compositions/comp-balanced'));

    fireEvent.click(within(balancedCard as HTMLElement).getByRole('button', { name: '进入工作台' }));
    await waitFor(() =>
      expect(window.location.hash).toBe('#/compositions/workbench?composition_id=comp-balanced'),
    );
  });

  it('shows a graceful integration error when the runtime client has not been wired yet', async () => {
    fakeApi.listCompositions = undefined;

    render(<CompositionDashboardPage />);

    expect(
      await screen.findByText('当前运行时还未接入组合列表接口，请等待主线程完成路由与 HTTP 客户端集成。'),
    ).toBeInTheDocument();
  });

  it('writes composition status changes through the runtime PATCH contract', async () => {
    await act(async () => {
      render(<CompositionDashboardPage />);
    });

    await waitFor(() =>
      expect(
        document.querySelector('.composition-dashboard-page[data-route-root="compositions"][data-page-root="composition-dashboard"]'),
      ).not.toBeNull(),
    );
    const balancedCard = document.querySelector('.composition-dashboard-card') as HTMLElement;
    expect(balancedCard).not.toBeNull();

    fireEvent.click(within(balancedCard).getByRole('button', { name: '归档' }));

    const dialog = await screen.findByRole('dialog', { name: '确认归档组合' });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认归档' }));

    await waitFor(() =>
      expect(fakeApi.updateComposition).toHaveBeenCalledWith('comp-balanced', { status: 'ARCHIVED' }),
    );
    await waitFor(() => expect(fakeApi.listCompositions).toHaveBeenCalledTimes(2));
  });

  it('requires confirmation before archiving a composition', async () => {
    await act(async () => {
      render(<CompositionDashboardPage />);
    });

    const balancedCard = document.querySelector('.composition-dashboard-card') as HTMLElement;
    expect(balancedCard).not.toBeNull();

    fireEvent.click(within(balancedCard).getByRole('button', { name: '归档' }));

    expect(fakeApi.updateComposition).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: '确认归档组合' });
    expect(within(dialog).getByText('comp-balanced')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '确认归档组合' })).toBeNull());
    expect(fakeApi.updateComposition).not.toHaveBeenCalled();
  });
});

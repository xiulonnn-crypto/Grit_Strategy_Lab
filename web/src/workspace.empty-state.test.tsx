import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspacePage } from './pages/workspace-page-lane-b';
import { ShellFrameCn } from './shell-frame-cn';

type FakeApi = {
  getWorkspaceOverview: ReturnType<typeof vi.fn>;
  listStrategies: ReturnType<typeof vi.fn>;
  getStrategyDetail: ReturnType<typeof vi.fn>;
  listBacktestRuns: ReturnType<typeof vi.fn>;
  getBacktestRunDetail: ReturnType<typeof vi.fn>;
};

const fakeApi = vi.hoisted<FakeApi>(() => ({
  getWorkspaceOverview: vi.fn(),
  listStrategies: vi.fn(),
  getStrategyDetail: vi.fn(),
  listBacktestRuns: vi.fn(),
  getBacktestRunDetail: vi.fn(),
}));

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

beforeEach(() => {
  fakeApi.getWorkspaceOverview.mockResolvedValue({
    workspace_name: 'Grit 策略实验室',
    subtitle: '创建、回测和优化的统一工作台。',
    strategy_count: 0,
    active_run_count: 0,
    running_optimization_count: 0,
    latest_strategy_id: null,
    latest_backtest_run_id: null,
    latest_optimization_job_id: null,
    top_momentum_warning: '空库模式。',
    quick_actions: [],
  });
  fakeApi.listStrategies.mockResolvedValue([]);
  fakeApi.getStrategyDetail.mockResolvedValue(null);
  fakeApi.listBacktestRuns.mockResolvedValue([]);
  fakeApi.getBacktestRunDetail.mockResolvedValue(null);
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('workspace empty state', () => {
  it('shows a Chinese blank-state CTA when the workspace has no strategies', async () => {
    let container: HTMLElement | null = null;
    await act(async () => {
      ({ container } = render(
        <ShellFrameCn route={{ kind: 'workspace' }}>
          <WorkspacePage />
        </ShellFrameCn>,
      ));
    });

    expect(container!.querySelector('.page-heading')).toBeNull();
    expect(await screen.findByRole('heading', { name: '工作台健康度', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('当前研究工作台的核心状态与风险提示。')).toBeInTheDocument();
    expect(screen.queryByText('创建、回测和优化的统一工作台。')).not.toBeInTheDocument();
    expect(screen.queryByText('空库模式。')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '数据快照' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '创建第一个策略' })).toBeInTheDocument();
    expect(await screen.findByText('当前数据库还没有可用策略，先进入创建流程把主链路打通。')).toBeInTheDocument();
    expect(await screen.findByText('暂无最近回测。先 materialize 一个策略再填充历史。')).toBeInTheDocument();
    expect(screen.getAllByText('策略看板').length).toBeGreaterThan(0);
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });
});
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
  listOptimizationJobs: ReturnType<typeof vi.fn>;
};

const fakeApi = vi.hoisted<FakeApi>(() => ({
  getWorkspaceOverview: vi.fn(),
  listStrategies: vi.fn(),
  getStrategyDetail: vi.fn(),
  listBacktestRuns: vi.fn(),
  getBacktestRunDetail: vi.fn(),
  listOptimizationJobs: vi.fn(),
}));

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

const WORKSPACE_TITLE = '\u5de5\u4f5c\u53f0\u5065\u5eb7\u5ea6';
const WORKSPACE_COPY = '\u603b\u89c8\u7b56\u7565\u89c4\u6a21\u3001\u6d3b\u8dc3\u56de\u6d4b\u4e0e\u4f18\u5316\u8fdb\u5ea6\uff0c\u76f4\u8fbe\u6700\u65b0\u4efb\u52a1\u3002';
const SNAPSHOTS_BUTTON = '\u6570\u636e\u5feb\u7167';
const CREATE_FIRST_STRATEGY = '\u521b\u5efa\u7b2c\u4e00\u4e2a\u7b56\u7565';
const EMPTY_COPY =
  '\u5f53\u524d\u8fd8\u6ca1\u6709\u53ef\u7528\u7b56\u7565\uff0c\u5148\u521b\u5efa\u4e00\u4e2a\u7b56\u7565\uff0c\u628a\u56de\u6d4b\u4e0e\u4f18\u5316\u4e3b\u94fe\u8def\u8dd1\u901a\u3002';
const EMPTY_RUNS_COPY = '\u6682\u65e0\u6700\u8fd1\u56de\u6d4b\u6216\u4f18\u5316\u4efb\u52a1\u3002';

beforeEach(() => {
  fakeApi.getWorkspaceOverview.mockResolvedValue({
    workspace_name: 'Grit \u7b56\u7565\u5b9e\u9a8c\u5ba4',
    subtitle: '\u521b\u5efa\u3001\u56de\u6d4b\u548c\u4f18\u5316\u90fd\u5728\u540c\u4e00\u6761\u4e3b\u94fe\u8def\u91cc\u5b8c\u6210\u3002',
    strategy_count: 0,
    active_run_count: 0,
    running_optimization_count: 0,
    latest_strategy_id: null,
    latest_backtest_run_id: null,
    latest_optimization_job_id: null,
    top_momentum_warning: null,
    quick_actions: [],
  });
  fakeApi.listStrategies.mockResolvedValue([]);
  fakeApi.getStrategyDetail.mockResolvedValue(null);
  fakeApi.listBacktestRuns.mockResolvedValue([]);
  fakeApi.getBacktestRunDetail.mockResolvedValue(null);
  fakeApi.listOptimizationJobs.mockResolvedValue([]);
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
    expect(await screen.findByRole('heading', { name: WORKSPACE_TITLE, level: 2 })).toBeInTheDocument();
    expect(screen.getByText(WORKSPACE_COPY)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: SNAPSHOTS_BUTTON })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: CREATE_FIRST_STRATEGY })).toBeInTheDocument();
    expect(await screen.findByText(EMPTY_COPY)).toBeInTheDocument();
    expect(await screen.findByText(EMPTY_RUNS_COPY)).toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });
});

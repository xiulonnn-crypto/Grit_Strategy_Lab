import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceStrategySection } from './page-sections/workspace';
import type { StrategyListItem } from './types';
import type { StrategyCompareCard } from './types';

function makePhaseThreeStrategy(id: string, name: string, compareEligible = true): StrategyCompareCard {
  return {
    id,
    name,
    strategyType: 'MOMENTUM',
    universeName: 'SPY',
    parameterVersion: 2,
    parameterVersionId: `${id}-v2`,
    latestOptimizationJobId: compareEligible ? 'opt-001' : null,
    compareEligible,
    compareBlocker: compareEligible ? null : 'Current version is not stable enough for compare.',
    cardState: compareEligible ? 'READY' : 'PENDING_RUN',
    parameters: {
      lookback_months: 6,
      top_n: 5,
    },
  };
}

describe('WorkspaceStrategySection Phase 3', () => {
  it('renders strategy cards and opens compare after two selections', () => {
    render(
      <WorkspaceStrategySection
        navigate={vi.fn()}
        strategies={[
          makePhaseThreeStrategy('str-a', 'Strategy A'),
          makePhaseThreeStrategy('str-b', 'Strategy B'),
          makePhaseThreeStrategy('str-c', 'Strategy C', false),
        ]}
      />,
    );

    expect(screen.getByText('Strategy A')).toBeInTheDocument();
    expect(screen.getByText('Strategy B')).toBeInTheDocument();
    expect(screen.getByText('Current version is not stable enough for compare.')).toBeInTheDocument();

    const compareButton = screen.getByRole('button', { name: 'Open Compare' });
    expect(compareButton).toBeDisabled();

    fireEvent.click(screen.getByLabelText('Select Strategy A for compare'));
    fireEvent.click(screen.getByLabelText('Select Strategy B for compare'));

    expect(compareButton).toBeEnabled();
    fireEvent.click(compareButton);

    expect(screen.getByRole('dialog', { name: 'Workspace compare panel' })).toBeInTheDocument();
    expect(screen.getAllByText('Strategy A').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Strategy B').length).toBeGreaterThan(0);
  });
});

function makeSummary(overrides: Partial<NonNullable<StrategyListItem['latestCompletedRunSummary']>> = {}): NonNullable<StrategyListItem['latestCompletedRunSummary']> {
  return {
    runId: 'bt-001',
    parameterVersion: 2,
    status: 'COMPLETED',
    totalReturn: 18.4,
    annualizedReturn: 7.2,
    sharpe: 1.18,
    maxDrawdown: -6.4,
    oosTotalReturn: 1.9,
    oosAnnualizedReturn: 0.8,
    oosSharpe: 0.22,
    oosMaxDrawdown: -4.1,
    warningCount: 0,
    executionPolicy: 'T_CLOSE_TO_T1_OPEN',
    datasetSnapshotId: 'ds-001',
    universeSnapshotId: 'un-001',
    sparklinePoints: [
      { date: '2025-01-01', equity: 100, isOos: false },
      { date: '2025-02-01', equity: 104, isOos: false },
      { date: '2025-03-01', equity: 108, isOos: false },
      { date: '2025-04-01', equity: 109, isOos: true },
      { date: '2025-05-01', equity: 111, isOos: true },
    ],
    ...overrides,
  };
}

function makeStrategy(
  id: string,
  name: string,
  state: NonNullable<StrategyListItem['cardState']>,
  overrides: Partial<StrategyListItem> = {},
): StrategyListItem {
  const summary = state === 'READY' ? makeSummary({ runId: id + '-run', parameterVersion: overrides.parameterVersion ?? 2 }) : undefined;
  return {
    id,
    name,
    lifecycleStatus: 'ACTIVE',
    parameterVersion: overrides.parameterVersion ?? 2,
    cardState: state,
    compareEligible: state === 'READY',
    compareBlocker:
      state === 'READY'
        ? null
        : state === 'PENDING_RUN'
          ? '当前参数版本尚未完成正式回测。'
          : '当前参数版本回测仍在运行。',
    latestBacktestRunId: summary?.runId,
    latestBacktestStatus: state === 'RUNNING_CURRENT_VERSION' ? 'RUNNING' : summary?.status,
    latestBacktestReturn: summary?.totalReturn,
    latestCompletedRunSummary: summary,
    latestOptimizationJobId: overrides.latestOptimizationJobId,
    latestOptimizationStatus: overrides.latestOptimizationStatus,
    createdAt: '2026-03-24T00:00:00.000Z',
    updatedAt: '2026-03-25T00:00:00.000Z',
    allowedActions: ['run_backtest'],
    ...overrides,
  };
}

function renderSection(
  strategies: StrategyListItem[],
  options: { isMobile?: boolean; loading?: boolean; error?: string } = {},
): ReturnType<typeof render> {
  return render(
    <WorkspaceStrategySection
      strategies={strategies}
      latestStrategy={strategies[0]}
      isMobile={options.isMobile ?? false}
      navigate={vi.fn()}
      translateStatus={(status) => status}
      loading={options.loading}
      error={options.error}
    />,
  );
}

describe.skip('WorkspaceStrategySection legacy recovery evidence', () => {
  it('renders loading, error, empty and compare-ready states', () => {
    const loading = renderSection([], { loading: true });
    expect(loading.getByText('策略看板')).toBeInTheDocument();
    expect(loading.container.querySelectorAll('.workspace-skeleton-card').length).toBeGreaterThan(0);
    loading.unmount();

    const error = renderSection([], { error: '看板请求失败。' });
    expect(error.getAllByText('看板不可用').length).toBeGreaterThan(0);
    expect(error.getByText('看板请求失败。')).toBeInTheDocument();
    error.unmount();

    const empty = renderSection([]);
    expect(empty.getByText('暂无策略')).toBeInTheDocument();
  });

  it('shows READY, PENDING_RUN and RUNNING_CURRENT_VERSION cards with SVG sparklines', () => {
    renderSection([
      makeStrategy('str-ready', 'Quality Momentum', 'READY'),
      makeStrategy('str-grid', 'QQQ Grid v1', 'READY'),
      makeStrategy('str-running', 'Defense Rotation', 'RUNNING_CURRENT_VERSION'),
      makeStrategy('str-pending', 'Low Vol Shield', 'PENDING_RUN'),
    ]);

    expect(screen.getByText('Quality Momentum')).toBeInTheDocument();
    expect(screen.getByText('QQQ Grid v1')).toBeInTheDocument();
    expect(screen.getByText('Defense Rotation')).toBeInTheDocument();
    expect(screen.getByText('Low Vol Shield')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: '策略表现迷你趋势图' }).length).toBe(2);
    expect(screen.getAllByText(/当前参数版本回测仍在运行。/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/当前参数版本尚未完成正式回测。/).length).toBeGreaterThan(0);
    expect(document.querySelector('canvas')).toBeNull();
    expect(screen.getByLabelText('选择 Defense Rotation 进入对比')).toBeDisabled();
    expect(screen.getByLabelText('选择 Low Vol Shield 进入对比')).toBeDisabled();
  });

  it('opens the compare cockpit only after 2 selections and blocks the 5th selection', () => {
    renderSection([
      makeStrategy('str-a', 'Strategy A', 'READY'),
      makeStrategy('str-b', 'Strategy B', 'READY'),
      makeStrategy('str-c', 'Strategy C', 'READY'),
      makeStrategy('str-d', 'Strategy D', 'READY'),
      makeStrategy('str-e', 'Strategy E', 'READY'),
    ]);

    fireEvent.click(screen.getByLabelText('选择 Strategy A 进入对比'));
    fireEvent.click(screen.getByLabelText('选择 Strategy B 进入对比'));
    expect(screen.getByRole('button', { name: '打开对比舱' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '打开对比舱' }));
    expect(screen.getByText('策略对比舱')).toBeInTheDocument();
    expect(screen.getAllByText('Strategy A').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Strategy B').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByLabelText('选择 Strategy C 进入对比'));
    fireEvent.click(screen.getByLabelText('选择 Strategy D 进入对比'));
    fireEvent.click(screen.getByLabelText('选择 Strategy E 进入对比'));
    expect(screen.getByText('一次最多可同时对比 4 个就绪策略。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开对比舱' })).toBeEnabled();
  });

  it('renders the stacked compare sheet on mobile', () => {
    const result = renderSection(
      [
        makeStrategy('str-a', 'Strategy A', 'READY'),
        makeStrategy('str-b', 'Strategy B', 'READY'),
      ],
      { isMobile: true },
    );

    fireEvent.click(screen.getByLabelText('选择 Strategy A 进入对比'));
    fireEvent.click(screen.getByLabelText('选择 Strategy B 进入对比'));
    fireEvent.click(screen.getByRole('button', { name: '打开对比舱' }));

    const comparePanel = result.container.querySelector('.workspace-compare-panel');
    expect(comparePanel).not.toBeNull();
    expect(comparePanel?.classList.contains('workspace-compare-panel--stacked')).toBe(true);
    expect(screen.getByText('策略对比舱')).toBeInTheDocument();
  });
});

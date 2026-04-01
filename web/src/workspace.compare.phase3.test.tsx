import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceStrategySection } from './page-sections/workspace-lane-b';
import type { WorkspaceStrategyCardVM } from './lib/workspace-adapters';

function makeStrategy(id: string, name: string, compareEligible = true): WorkspaceStrategyCardVM {
  return {
    id,
    name,
    strategyType: 'MOMENTUM',
    universeName: 'SPY',
    parameterVersion: 2,
    parameterVersionId: `${id}-v2`,
    latestOptimizationJobId: compareEligible ? 'opt-001' : null,
    latestRunId: compareEligible ? `${id}-run` : null,
    compareEligible,
    compareBlocker: compareEligible ? null : '当前参数版本还没有正式回测，暂时不能加入对比。',
    cardState: compareEligible ? 'READY' : 'PENDING_RUN',
    parameters: {
      lookback_months: 6,
      top_n: 5,
    },
    summary: {
      totalReturn: '+18.4%',
      annualizedReturn: '+11.2%',
      sharpe: '1.18',
      maxDrawdown: '-6.4%',
      oosTotalReturn: '+5.4%',
      oosSharpe: '0.67',
    },
    auxiliaryCopy: compareEligible ? '当前参数版本已可加入对比。' : '当前参数版本还没有正式回测，暂时不能加入对比。',
  };
}

describe('WorkspaceStrategySection Phase 3', () => {
  it('reveals compare controls only after two selections', () => {
    render(
      <WorkspaceStrategySection
        latestStrategyId="str-a"
        navigate={vi.fn()}
        strategies={[
          makeStrategy('str-a', '策略 A'),
          makeStrategy('str-b', '策略 B'),
          makeStrategy('str-c', '策略 C', false),
        ]}
      />,
    );

    expect(screen.getByText('策略 A')).toBeInTheDocument();
    expect(screen.getByText('策略 B')).toBeInTheDocument();
    expect(screen.getByText('当前参数版本还没有正式回测，暂时不能加入对比。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开对比' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('选择 策略 A 进行对比'));
    fireEvent.click(screen.getByLabelText('选择 策略 B 进行对比'));

    const compareButton = screen.getByRole('button', { name: '打开对比' });
    fireEvent.click(compareButton);

    expect(screen.getByRole('dialog', { name: '策略对比' })).toBeInTheDocument();
    expect(screen.getAllByText('策略 A').length).toBeGreaterThan(0);
    expect(screen.getAllByText('策略 B').length).toBeGreaterThan(0);
  });
});
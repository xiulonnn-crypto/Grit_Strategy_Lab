import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorkspaceStrategySection } from './page-sections/workspace-lane-b';
import type { WorkspaceStrategyCardVM } from './lib/workspace-adapters';

function makeStrategy(id: string, name: string, compareEligible = true): WorkspaceStrategyCardVM {
  return {
    id,
    name,
    strategyType: 'MOMENTUM',
    universeName: 'QQQ',
    parameterVersion: 2,
    parameterVersionId: `${id}-v2`,
    latestOptimizationJobId: compareEligible ? 'opt-001' : null,
    latestRunId: `${id}-run`,
    compareEligible,
    compareBlocker: compareEligible ? null : '当前版本还没有正式回测，暂时不能加入对比。',
    cardState: compareEligible ? 'READY' : 'PENDING_RUN',
    parameters: { lookback_days: 126, top_n: 20 },
    sparklinePoints: [
      { date: '2026-03-01', equity: 100, isOos: false },
      { date: '2026-03-02', equity: 104, isOos: false },
      { date: '2026-03-03', equity: 109, isOos: true },
    ],
    summary: {
      totalReturn: '+18.4%',
      annualizedReturn: '+11.2%',
      sharpe: '1.18',
      maxDrawdown: '-6.4%',
      oosTotalReturn: '+5.4%',
      oosSharpe: '0.67',
    },
  };
}

describe('WorkspaceStrategySection', () => {
  it('only shows compare entry after two selections and blocks the fifth strategy', () => {
    render(
      <WorkspaceStrategySection
        latestStrategyId="str-a"
        navigate={() => undefined}
        strategies={[
          makeStrategy('str-a', '策略一'),
          makeStrategy('str-b', '策略二'),
          makeStrategy('str-c', '策略三'),
          makeStrategy('str-d', '策略四'),
          makeStrategy('str-e', '策略五'),
        ]}
      />,
    );

    expect(screen.queryByRole('button', { name: /打开对比舱/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('选择 策略一 进行对比'));
    fireEvent.click(screen.getByLabelText('选择 策略二 进行对比'));

    const openCompareButton = screen.getByRole('button', { name: /打开对比舱/ });
    fireEvent.click(openCompareButton);

    expect(screen.getByRole('region', { name: /对比选择/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /策略对比舱/ })).toBeInTheDocument();
    expect(screen.getAllByText('策略一').length).toBeGreaterThan(0);
    expect(screen.getAllByText('策略二').length).toBeGreaterThan(0);
    expect(screen.getAllByText('累计收益').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByLabelText('选择 策略三 进行对比'));
    fireEvent.click(screen.getByLabelText('选择 策略四 进行对比'));
    expect(screen.getByLabelText('选择 策略五 进行对比')).toBeDisabled();
  });
});

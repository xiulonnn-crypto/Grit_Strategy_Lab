import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceStrategySection } from './page-sections/workspace-lane-b';
import type { WorkspaceStrategyCardVM } from './lib/workspace-adapters';

const OPEN_COMPARE = /\u6253\u5f00\u5bf9\u6bd4/;
const COMPARE_DIALOG = /\u7b56\u7565\u5bf9\u6bd4/;

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
    compareBlocker: compareEligible ? null : 'Not ready for compare yet.',
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
    auxiliaryCopy: compareEligible ? 'Ready for compare.' : 'Not ready for compare yet.',
  };
}

describe('WorkspaceStrategySection Phase 3', () => {
  afterEach(() => {
    cleanup();
  });

  it('reveals compare controls only after two selections', () => {
    const { container } = render(
      <WorkspaceStrategySection
        latestStrategyId="str-a"
        navigate={vi.fn()}
        strategies={[
          makeStrategy('str-a', 'Strategy A'),
          makeStrategy('str-b', 'Strategy B'),
          makeStrategy('str-c', 'Strategy C', false),
        ]}
      />,
    );

    expect(screen.getByText('Strategy A')).toBeInTheDocument();
    expect(screen.getByText('Strategy B')).toBeInTheDocument();
    expect(screen.getByText('Not ready for compare yet.')).toBeInTheDocument();
    expect(container.querySelector('.workspace-compare-dock')).toBeNull();

    fireEvent.click(screen.getByLabelText(/\u9009\u62e9 Strategy A \u8fdb\u884c\u5bf9\u6bd4/));
    expect(container.querySelector('.workspace-compare-dock')).not.toBeNull();
    fireEvent.click(screen.getByLabelText(/\u9009\u62e9 Strategy B \u8fdb\u884c\u5bf9\u6bd4/));

    const compareButton = screen.getByRole('button', { name: OPEN_COMPARE });
    fireEvent.click(compareButton);

    expect(screen.getByRole('region', { name: COMPARE_DIALOG })).toBeInTheDocument();
    expect(screen.getAllByText('Strategy A').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Strategy B').length).toBeGreaterThan(0);
  });
});

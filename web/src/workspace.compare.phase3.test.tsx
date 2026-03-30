import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceStrategySection } from './page-sections/workspace';
import type { StrategyCompareCard } from './types';

function makeStrategy(id: string, name: string, compareEligible = true): StrategyCompareCard {
  return {
    id,
    name,
    strategyType: 'MOMENTUM',
    universeName: 'SPY',
    parameterVersion: 2,
    parameterVersionId: `${id}-v2`,
    latestOptimizationJobId: compareEligible ? 'opt-001' : null,
    compareEligible,
    compareBlocker: compareEligible ? null : 'Run the current parameter version before compare.',
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
          makeStrategy('str-a', 'Strategy A'),
          makeStrategy('str-b', 'Strategy B'),
          makeStrategy('str-c', 'Strategy C', false),
        ]}
      />,
    );

    expect(screen.getByText('Strategy A')).toBeInTheDocument();
    expect(screen.getByText('Strategy B')).toBeInTheDocument();
    expect(screen.getByText('Run the current parameter version before compare.')).toBeInTheDocument();

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

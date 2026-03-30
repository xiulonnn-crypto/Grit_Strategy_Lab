import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OptimizationManualLabPhase4 } from './page-sections/optimization-manual-lab-phase4';
import { OptimizationCandidateCard } from './page-sections/optimization-candidate-card';
import type { ApiOptimizationCandidate, ApiOptimizationJobDetail, ApiStrategyDetail, ParameterValue } from './types';

function buildBaseline(): Record<string, ParameterValue> {
  const parameters: Record<string, ParameterValue> = {};
  for (let index = 1; index <= 50; index += 1) {
    parameters[`param_${index}`] = index;
  }
  return parameters;
}

afterEach(() => {
  cleanup();
});

describe('OptimizationManualLab diff rendering', () => {
  it('renders only changed parameter rows', () => {
    const baseline = buildBaseline();
    const candidate: ApiOptimizationCandidate = {
      id: 'trial-200',
      label: 'Diff Only Candidate',
      status: 'SUCCEEDED',
      rank: 2,
      score: 1.21,
      summary: 'Only two params should render.',
      parameter_snapshot: {
        ...baseline,
        param_4: 404,
        param_19: 919,
      },
      parameter_delta: {
        param_4: 404,
        param_19: 919,
      },
      metrics: { sharpe: 1.21 },
      base_parameter_version_id: 'strat-001-v2',
    };

    render(
      <OptimizationCandidateCard
        baselineParameters={baseline}
        candidate={candidate}
        onPromote={vi.fn()}
      />,
    );

    expect(screen.getByText('param_4')).toBeInTheDocument();
    expect(screen.getByText('param_19')).toBeInTheDocument();
    expect(screen.queryByText('param_5')).toBeNull();
    expect(screen.queryByText('param_20')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Promote Current Version' }));
  });

  it('opens top-3 compare and collects a revision note before promote', async () => {
    const strategy: ApiStrategyDetail = {
      id: 'strat-001',
      name: 'Quality Momentum',
      strategy_type: 'MOMENTUM',
      universe_name: 'SPY',
      current_parameter_version: 2,
      current_parameter_version_id: 'strat-001-v2',
      parameters: {
        lookback_months: 6,
        top_n: 5,
        max_position_pct: 15,
      },
      parameter_history: [],
    };
    const candidates: ApiOptimizationCandidate[] = [
      {
        id: 'trial-001',
        label: 'Candidate 1',
        status: 'SUCCEEDED',
        rank: 1,
        score: 1.4,
        summary: 'Lead candidate',
        parameter_snapshot: { ...strategy.parameters, top_n: 6 },
        parameter_delta: { top_n: 6 },
        metrics: { total_return: 12.4 },
      },
      {
        id: 'trial-002',
        label: 'Candidate 2',
        status: 'SUCCEEDED',
        rank: 2,
        score: 1.2,
        summary: 'Runner up',
        parameter_snapshot: { ...strategy.parameters, lookback_months: 9 },
        parameter_delta: { lookback_months: 9 },
        metrics: { total_return: 9.1 },
      },
      {
        id: 'trial-003',
        label: 'Candidate 3',
        status: 'SUCCEEDED',
        rank: 3,
        score: 1.1,
        summary: 'High beta',
        parameter_snapshot: { ...strategy.parameters, max_position_pct: 12 },
        parameter_delta: { max_position_pct: 12 },
        metrics: { total_return: 4.5 },
      },
      {
        id: 'trial-004',
        label: 'Candidate 4',
        status: 'SUCCEEDED',
        rank: 4,
        score: -0.2,
        summary: 'Losing candidate',
        parameter_snapshot: { ...strategy.parameters, top_n: 12 },
        parameter_delta: { top_n: 12 },
        metrics: { total_return: -1.5 },
      },
    ];
    const job: ApiOptimizationJobDetail = {
      id: 'opt-001',
      strategy_id: strategy.id,
      status: 'COMPLETED',
      request: { objective: 'sharpe', base_parameter_version_id: 'strat-001-v2' },
      summary: { objective: 'sharpe', candidate_count: candidates.length, baseline_parameter_version_id: 'strat-001-v2' },
      result: { best_candidate_id: 'trial-001', baseline_parameter_version_id: 'strat-001-v2' },
      candidates,
      base_parameter_version_id: 'strat-001-v2',
    };
    const onPromote = vi.fn().mockResolvedValue(undefined);
    const onDeleteLosingCandidates = vi.fn().mockResolvedValue(undefined);

    render(
      <OptimizationManualLabPhase4
        conflictMessage={null}
        job={job}
        onAddCandidate={vi.fn()}
        onDeleteCandidate={vi.fn().mockResolvedValue(undefined)}
        onDeleteLosingCandidates={onDeleteLosingCandidates}
        onPromote={onPromote}
        promotingCandidateId={null}
        strategy={strategy}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Compare Top 3/i }));
    const compareDialog = screen.getByRole('dialog', { name: 'Top 3 compare panel' });
    expect(compareDialog).toBeInTheDocument();
    expect(compareDialog).toHaveTextContent('Candidate 3');
    expect(compareDialog).not.toHaveTextContent('Candidate 4');

    fireEvent.click(screen.getByRole('button', { name: /Delete Losing Candidates/i }));
    expect(onDeleteLosingCandidates).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getAllByRole('button', { name: 'Promote Current Version' })[0]);
    fireEvent.change(screen.getByLabelText('Revision Note'), { target: { value: 'Tighten breadth after volatility break.' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Promote with Note' }));
    });

    expect(onPromote).toHaveBeenCalledWith('trial-001', 'Tighten breadth after volatility break.');
  });
});

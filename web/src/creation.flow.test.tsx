import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreationSessionPage } from './pages/creation-session-page';
import { CreationTemplatePage } from './pages/creation-template-page';

type FakeApi = {
  createCreationSession: ReturnType<typeof vi.fn>;
  getCreationSession: ReturnType<typeof vi.fn>;
  appendCreationMessage: ReturnType<typeof vi.fn>;
  prepareConfirmation: ReturnType<typeof vi.fn>;
  updateConfirmation: ReturnType<typeof vi.fn>;
  materializeStrategy: ReturnType<typeof vi.fn>;
};

const fakeApi = vi.hoisted<FakeApi>(() => ({
  createCreationSession: vi.fn(),
  getCreationSession: vi.fn(),
  appendCreationMessage: vi.fn(),
  prepareConfirmation: vi.fn(),
  updateConfirmation: vi.fn(),
  materializeStrategy: vi.fn(),
}));

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

beforeEach(() => {
  fakeApi.createCreationSession.mockReset();
  fakeApi.getCreationSession.mockReset();
  fakeApi.appendCreationMessage.mockReset();
  fakeApi.prepareConfirmation.mockReset();
  fakeApi.updateConfirmation.mockReset();
  fakeApi.materializeStrategy.mockReset();
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('Creation flow', () => {
  it('creates a session from the template page and navigates to the session route', async () => {
    fakeApi.createCreationSession.mockResolvedValue({ id: 'cs-001' });

    await act(async () => {
      render(<CreationTemplatePage />);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Start Session' })[0]);

    await waitFor(() =>
      expect(fakeApi.createCreationSession).toHaveBeenCalledWith({ strategy_type: 'MOMENTUM' }),
    );
    expect(window.location.hash).toBe('#/creation/sessions/cs-001');
  });

  it('loads, prepares, patches, and materializes a session', async () => {
    fakeApi.getCreationSession.mockResolvedValue({
      id: 'cs-001',
      status: 'DRAFTING',
      revision: 1,
      messages: [],
      top_level: { strategy_type: 'MOMENTUM', universe_name: 'QQQ', rebalance_frequency: 'WEEKLY' },
      pending_inputs: [],
      manual_conflicts: [],
      confirmation_fields: { top_level: [], parameters: [] },
    });
    fakeApi.appendCreationMessage.mockResolvedValue({
      id: 'cs-001',
      status: 'NEEDS_INPUT',
      revision: 1,
      messages: [{ role: 'user', content: 'Update the lookback window.' }],
      top_level: { strategy_type: 'MOMENTUM', universe_name: 'QQQ', rebalance_frequency: 'WEEKLY' },
      pending_inputs: [{ key: 'lookback_months', label: 'Lookback', message: 'Confirm the lookback window.' }],
      manual_conflicts: [],
      confirmation_fields: { top_level: [], parameters: [] },
    });
    fakeApi.prepareConfirmation.mockResolvedValue({
      id: 'cs-001',
      status: 'READY_FOR_CONFIRMATION',
      revision: 2,
      messages: [{ role: 'user', content: 'Update the lookback window.' }],
      top_level: { strategy_type: 'MOMENTUM', universe_name: 'QQQ', rebalance_frequency: 'WEEKLY' },
      pending_inputs: [],
      manual_conflicts: [],
      confirmation_fields: {
        top_level: [],
        parameters: [{ key: 'top_n', label: 'Top N', value: 10, source: 'assistant' }],
      },
    });
    fakeApi.updateConfirmation.mockResolvedValue({
      id: 'cs-001',
      status: 'READY_FOR_CONFIRMATION',
      revision: 3,
      messages: [{ role: 'user', content: 'Update the lookback window.' }],
      top_level: { strategy_type: 'MOMENTUM', universe_name: 'QQQ', rebalance_frequency: 'WEEKLY' },
      pending_inputs: [],
      manual_conflicts: [],
      confirmation_fields: {
        top_level: [],
        parameters: [{ key: 'top_n', label: 'Top N', value: 12, source: 'manual' }],
      },
    });
    fakeApi.materializeStrategy.mockResolvedValue({ id: 'strat-001' });

    await act(async () => {
      render(<CreationSessionPage sessionId="cs-001" />);
    });

    expect(await screen.findByText('Conversation Draft')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Creation prompt'), {
      target: { value: 'Update the lookback window.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() =>
      expect(fakeApi.appendCreationMessage).toHaveBeenCalledWith(
        'cs-001',
        'Update the lookback window.',
        1,
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Prepare confirmation' }));

    expect(await screen.findByLabelText('Top N')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Top N'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply confirmation edits' }));

    await waitFor(() =>
      expect(fakeApi.updateConfirmation).toHaveBeenCalledWith('cs-001', {
        revision: 2,
        parameters: { top_n: 12 },
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Materialize' }));

    await waitFor(() =>
      expect(fakeApi.materializeStrategy).toHaveBeenCalledWith('cs-001', 'materialize-cs-001', 3),
    );
    expect(window.location.hash).toBe('#/strategies/strat-001/backtest-runs/new');
  });
});

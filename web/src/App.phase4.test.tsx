import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from './phase4-app';
import { installMockApiServer, setMockPromoteConflict } from './testApiMock';

let mockServer: ReturnType<typeof installMockApiServer> | null = null;

async function renderApp(hash: string): Promise<void> {
  await act(async () => {
    window.location.hash = hash;
    render(<App />);
  });
}

beforeEach(() => {
  mockServer = installMockApiServer();
});

afterEach(() => {
  mockServer?.restore();
  mockServer = null;
  cleanup();
  window.location.hash = '';
});

describe('App Phase 4 routes', () => {
  it('requests workspace overview with cleanup audit enabled', async () => {
    await renderApp('#/workspace');

    expect(await screen.findByText('Creation, backtest, and optimization workspace for local strategy recovery.')).toBeInTheDocument();
    expect(screen.getByTestId('hidden-cleanup-count')).toHaveTextContent('3');
    expect(
      mockServer?.fetchSpy.mock.calls.some(([input]) =>
        String(input).includes('/workspace/overview?include_cleanup_audit=1'),
      ),
    ).toBe(true);
  });

  it('deletes losing candidates and forwards revision note comments during promote', async () => {
    await renderApp('#/optimization-jobs/opt-001');

    expect(await screen.findByText('Overfit Reversal')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Delete Losing Candidates/i }));
    await waitFor(() => expect(screen.queryByText('Overfit Reversal')).toBeNull());

    fireEvent.click(screen.getAllByRole('button', { name: 'Promote Current Version' })[0]);
    fireEvent.change(screen.getByLabelText('Revision Note'), { target: { value: 'Adjusted stop discipline for the new volatility regime.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Promote with Note' }));

    await waitFor(() =>
      expect(
        mockServer?.fetchSpy.mock.calls.some(([, init]) =>
          String(init?.body ?? '').includes('"comment":"Adjusted stop discipline for the new volatility regime."'),
        ),
      ).toBe(true),
    );
  });

  it('keeps stale-base conflict messaging intact after the revision-note flow', async () => {
    setMockPromoteConflict('opt-001', 'trial-001');
    await renderApp('#/optimization-jobs/opt-001');

    fireEvent.click((await screen.findAllByRole('button', { name: 'Promote Current Version' }))[0]);
    fireEvent.change(screen.getByLabelText('Revision Note'), { target: { value: 'Should be blocked.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Promote with Note' }));

    expect(await screen.findByText('Parameter version conflict detected. Refresh the baseline before promoting again.')).toBeInTheDocument();
  });
});

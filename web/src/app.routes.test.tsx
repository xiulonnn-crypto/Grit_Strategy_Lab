import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from './app-runtime';
import { installMockApiServer } from './testApiMock';

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

describe('App runtime routes', () => {
  it('defaults to workspace when no hash is present', async () => {
    await renderApp('');

    expect(
      await screen.findByText('Creation, backtest, and optimization workspace for local strategy recovery.'),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe('#/workspace');
  });

  it('creates a session route from the template page', async () => {
    await renderApp('#/creation/new');

    fireEvent.click(await screen.findByRole('button', { name: 'Start Session' }));

    expect(await screen.findByText('Conversation Draft')).toBeInTheDocument();
    expect(window.location.hash).toMatch(/^#\/creation\/sessions\/cs-/);
  });

  it('submits from backtest into the run detail route', async () => {
    await renderApp('#/strategies/strat-001/backtest-runs/new');

    expect(await screen.findByText('Quality Momentum')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Submit run' }));

    await waitFor(() => expect(window.location.hash).toBe('#/runs/bt-001'));
    expect(await screen.findByText('Run bt-001')).toBeInTheDocument();
  });

  it('loads the optimization manual lab route inside the unified shell', async () => {
    await renderApp('#/optimization-jobs/opt-001');

    expect(await screen.findByText('Quality Momentum')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Delete Losing Candidates/i })).toBeInTheDocument();
  });
});

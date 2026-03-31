import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from './app-runtime';
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

describe('App Phase 3 routes', () => {
  it('renders the restored workspace contract', async () => {
    await renderApp('#/workspace');

    expect((await screen.findAllByText('Grit Strategy Lab')).length).toBeGreaterThan(0);
    expect(await screen.findByText('Creation, backtest, and optimization workspace for local strategy recovery.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Open Latest Manual Lab' })).toBeInTheDocument();
  });

  it('shows stale-base conflict UI without optimistic promote state', async () => {
    setMockPromoteConflict('opt-001', 'trial-001');
    await renderApp('#/optimization-jobs/opt-001');

    const [promoteButton] = await screen.findAllByRole('button', { name: 'Promote Current Version' });
    fireEvent.click(promoteButton);

    expect(await screen.findByText('Parameter version conflict detected. Refresh the baseline before promoting again.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Promote Current Version' }).length).toBeGreaterThan(0);
  });
});

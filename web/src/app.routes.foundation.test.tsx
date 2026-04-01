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

    await waitFor(() => expect(window.location.hash).toBe('#/workspace'));
    expect(document.querySelector('.workspace-page')).not.toBeNull();
  });

  it('creates a session route from the template page and shows the page-owned strategy header', async () => {
    await renderApp('#/creation/new');

    expect(document.querySelector('.creation-template-page')).not.toBeNull();
    fireEvent.click((await screen.findAllByRole('button'))[0]);

    await waitFor(() => expect(window.location.hash).toMatch(/^#\/creation\/sessions\/cs-/));
    expect(document.querySelector('.creation-session-page')).not.toBeNull();
    expect(await screen.findByRole('heading', { name: '策略创建', level: 2 })).toBeInTheDocument();
  });

  it('renders the strategy detail page on the formal route', async () => {
    await renderApp('#/strategies/strat-001');

    expect(document.querySelector('.strategy-detail-page')).not.toBeNull();
    expect((await screen.findAllByText('Quality Momentum')).length).toBeGreaterThan(0);
    expect((await screen.findAllByRole('button', { name: '运行回测' })).length).toBeGreaterThan(0);
  });

  it('submits from backtest into the run detail route', async () => {
    await renderApp('#/strategies/strat-001/backtest-runs/new');

    expect(document.querySelector('.backtest-submit-page')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '提交回测' }));

    await waitFor(() => expect(window.location.hash).toBe('#/runs/bt-001'));
    expect((await screen.findAllByText(/bt-001/)).length).toBeGreaterThan(0);
  });

  it('loads the optimization manual lab route inside the unified shell', async () => {
    await renderApp('#/optimization-jobs/opt-001');

    expect(await screen.findByRole('button', { name: /Delete Losing Candidates/i })).toBeInTheDocument();
  });

  it('renders the runs index page on the formal route', async () => {
    await renderApp('#/runs');

    expect(document.querySelector('.runs-index-page')).not.toBeNull();
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('renders the snapshots page on the formal route', async () => {
    await renderApp('#/snapshots');

    expect(document.querySelector('.snapshots-page')).not.toBeNull();
    expect(await screen.findByRole('button')).toBeInTheDocument();
  });
});

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from './app-runtime';
import { installMockApiServer } from './testApiMock';

let mockServer: ReturnType<typeof installMockApiServer> | null = null;

async function renderApp(): Promise<void> {
  await act(async () => {
    window.location.hash = '#/workspace';
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

describe('workspace dashboard', () => {
  it('renders the workbench shell, compare cockpit, and recent backtests', async () => {
    await renderApp();

    expect(await screen.findByRole('heading', { name: 'Grit Strategy Lab', level: 2 })).toBeInTheDocument();
    expect(await screen.findByText('Stable Current-Version Strategies')).toBeInTheDocument();
    expect(await screen.findByText('Latest runs')).toBeInTheDocument();
    expect((await screen.findAllByText('Quality Momentum')).length).toBeGreaterThan(0);
    expect(await screen.findByText('bt-001')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Open Compare' })).toBeInTheDocument();
    expect(screen.getByText(/Return/)).toBeInTheDocument();
  });
});

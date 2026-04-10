import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

describe('App optimization routes', () => {
  it('renders the restored workspace contract', async () => {
    await renderApp('#/workspace');

    expect(await screen.findByText('Grit 策略实验室')).toBeInTheDocument();
    expect(await screen.findByText('工作台')).toBeInTheDocument();
    expect(await screen.findByText('优化实验室')).toBeInTheDocument();
    expect(document.querySelector('.workspace-page')).not.toBeNull();
  });

  it('shows stale-base conflict UI without optimistic promote state', async () => {
    setMockPromoteConflict('opt-001', 'trial-001');
    await renderApp('#/optimization-jobs/opt-001');

    const promoteButton = document.querySelector('.optimization-hero-actions .primary-button') as HTMLButtonElement | null;
    expect(promoteButton).toBeTruthy();
    fireEvent.click(promoteButton!);

    expect(await screen.findByText('The strategy has moved to a newer parameter version.')).toBeInTheDocument();
    expect(document.querySelectorAll('.optimization-hero-actions .primary-button').length).toBeGreaterThan(0);
  });
});

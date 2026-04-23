import { act, cleanup, render, screen } from '@testing-library/react';
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

    expect(await screen.findByText('Grit Strategy Lab')).toBeInTheDocument();
    expect(await screen.findByText('策略工作台')).toBeInTheDocument();
    expect(await screen.findByText('优化实验室')).toBeInTheDocument();
    expect(document.querySelector('.workspace-page')).not.toBeNull();
  });

  it('keeps the optimization detail route stable while promote conflict returns the stale-base contract', async () => {
    setMockPromoteConflict('opt-001', 'trial-001');
    await renderApp('#/optimization-jobs/opt-001');

    const response = await fetch('/optimization-jobs/opt-001/candidates/trial-001/promote', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'promote-trial-001',
      },
      body: JSON.stringify({
        mode: 'set_current',
        comment: '测试冲突返回',
      }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        code: 'stale_base_parameter_version',
        message: 'The strategy has moved to a newer parameter version.',
      }),
    );
    expect(document.querySelectorAll('.optimization-hero-actions .primary-button').length).toBeGreaterThan(0);
  });
});

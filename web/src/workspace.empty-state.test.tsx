import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './app-runtime';

let fetchSpy: { mockRestore: () => void } | null = null;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const requestUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(requestUrl, 'http://localhost');

    if (url.pathname === '/workspace/overview') {
      return json({
        workspace_name: 'Grit Strategy Lab',
        subtitle: 'Creation, backtest, and optimization workspace for local strategy recovery.',
        strategy_count: 0,
        active_run_count: 0,
        running_optimization_count: 0,
        latest_strategy_id: null,
        latest_backtest_run_id: null,
        latest_optimization_job_id: null,
        top_momentum_warning: 'Empty workspace.',
        quick_actions: [],
      });
    }

    if (url.pathname === '/strategies') {
      return json([]);
    }

    if (url.pathname === '/backtest-runs') {
      return json([]);
    }

    return json({ status: 404, code: 'not_found', message: `No mock handler for ${url.pathname}` }, 404);
  });
});

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = null;
  cleanup();
  window.location.hash = '';
});

describe('workspace empty state', () => {
  it('shows a blank-state CTA when the workspace has no strategies', async () => {
    await act(async () => {
      window.location.hash = '#/workspace';
      render(<App />);
    });

    expect(await screen.findByText('Create the first strategy')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create First Strategy' })).toBeInTheDocument();
    expect(await screen.findByText('Latest runs')).toBeInTheDocument();
    expect(await screen.findByText('No recent backtests yet. Materialize a strategy to populate the run history.')).toBeInTheDocument();
  });
});

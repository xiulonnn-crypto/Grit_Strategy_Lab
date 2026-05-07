import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './app-runtime';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deferredResponse(): { promise: Promise<Response>; resolve: (response: Response) => void } {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function fetchPath(input: RequestInfo | URL): string {
  const raw = input instanceof Request ? input.url : String(input);
  return new URL(raw, 'http://localhost').pathname;
}

async function renderStrategiesRoute(): Promise<void> {
  await act(async () => {
    window.location.hash = '#/strategies';
    render(<App />);
  });
}

afterEach(() => {
  cleanup();
  window.location.hash = '';
  vi.restoreAllMocks();
});

describe('strategy library batch loading', () => {
  it('waits for strategies and backtest runs before rendering the table once', async () => {
    const libraryResponse = deferredResponse();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = fetchPath(input);
      if (path === '/strategy-library') {
        return libraryResponse.promise;
      }
      return jsonResponse({});
    });

    await renderStrategiesRoute();

    await waitFor(() => {
      expect(fetchSpy.mock.calls.some(([input]) => fetchPath(input) === '/strategy-library')).toBe(true);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await act(async () => {
      libraryResponse.resolve(
        jsonResponse({
          strategies: [
            {
              id: 'strat-batch',
              name: 'Batch Render Strategy',
              description: 'batch render regression row',
              strategy_type: 'MOMENTUM',
              universe_name: 'S&P 500',
              lifecycle_status: 'ACTIVE',
              current_parameter_version: 1,
              current_parameter_version_id: 'strat-batch-v1',
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-02T00:00:00Z',
              parameters: {},
            },
          ],
          runs: [
            {
              id: 'run-batch-10y',
              strategy_id: 'strat-batch',
              strategy_name: 'Batch Render Strategy',
              status: 'COMPLETED',
              start_date: '2016-03-24',
              end_date: '2026-03-24',
              created_at: '2026-01-02T00:00:00Z',
              updated_at: '2026-01-03T00:00:00Z',
              completed_at: '2026-01-03T00:00:00Z',
              metrics: { annualized_return: 0.12, sharpe: 1.4 },
              warnings: [],
              preview: {
                effective_start_date: '2016-03-24',
                effective_end_date: '2026-03-24',
                parameter_version_id: 'strat-batch-v1',
              },
              parameter_version_id: 'strat-batch-v1',
              is_permanent: false,
            },
          ],
        }),
      );
    });

    expect(await screen.findByRole('table')).toBeInTheDocument();
    const fetchedPaths = fetchSpy.mock.calls.map(([input]) => fetchPath(input));
    expect(fetchedPaths).not.toContain('/strategies');
    expect(fetchedPaths).not.toContain('/backtest-runs');
  });
});

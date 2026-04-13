import { act, cleanup, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from './lib/demoStoreContext';
import { AppRouteProvider, navigateTo, parseAppHash } from './lib/appRouteContext';
import { CreationSessionPage } from './pages/creation-session-page';
import { OptimizationConfigPage } from './pages/optimization-lab-page';
import { RunDetailPage } from './pages/run-detail-page';
import { RunsIndexPage } from './pages/runs-index-page';
import { StrategyDetailPage } from './pages/strategy-detail-page';
import { WorkspacePage } from './pages/workspace-page-lane-b';
import { ShellFrameCn } from './shell-frame-cn';

const LIVE_TEST_TIMEOUT = 20_000;
const LIVE_QUERY_TIMEOUT = 15_000;
const liveApiEnabled = process.env.LIVE_API_SMOKE === '1';
const describeLiveApi = liveApiEnabled ? describe : describe.skip;

const LIVE_API_BASE = process.env.LIVE_API_BASE ?? 'http://127.0.0.1:8000';
const CREATION_SESSION_NAME = 'Codex GRID Draft';
const DETAIL_STRATEGY_NAME = 'Codex GRID Strategy';
const OPTIMIZATION_STRATEGY_NAME = 'Codex MOM Strategy';

function requiredLiveEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required live smoke environment variable: ${name}`);
  }
  return value;
}

const LIVE_CREATION_SESSION_ID = requiredLiveEnv('LIVE_CREATION_SESSION_ID');
const LIVE_STRATEGY_ID = requiredLiveEnv('LIVE_STRATEGY_ID');
const LIVE_OPTIMIZATION_STRATEGY_ID = requiredLiveEnv('LIVE_OPTIMIZATION_STRATEGY_ID');
const LIVE_RUN_ID = requiredLiveEnv('LIVE_RUN_ID');

let originalFetch: typeof fetch | undefined;

beforeAll(() => {
  vi.stubEnv('VITE_API_BASE_URL', LIVE_API_BASE);
  originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    const normalizedUrl = rawUrl.startsWith('/')
      ? `${LIVE_API_BASE}${rawUrl}`
      : rawUrl.replace('http://localhost:8000', LIVE_API_BASE);

    if (typeof input === 'string' || input instanceof URL) {
      return originalFetch!(normalizedUrl, init);
    }

    return originalFetch!(new Request(normalizedUrl, input), init);
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

afterAll(() => {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
  }
  vi.unstubAllEnvs();
});

async function renderLiveRoute(hash: string, page: JSX.Element) {
  window.location.hash = hash;
  const route = parseAppHash(window.location.hash);

  let rendered: ReturnType<typeof render> | null = null;
  await act(async () => {
    rendered = render(
      <ApiClientProvider>
        <AppRouteProvider navigate={navigateTo} route={route}>
          <ShellFrameCn route={route}>{page}</ShellFrameCn>
        </AppRouteProvider>
      </ApiClientProvider>,
    );
  });

  return rendered!;
}

function expectNoFetchFailure(): void {
  expect(screen.queryByText(/fetch failed/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/failed to fetch/i)).not.toBeInTheDocument();
}

describeLiveApi('live api acceptance', () => {
  it(
    'hydrates workspace data against the staged local API',
    async () => {
      const { container } = await renderLiveRoute('#/workspace', <WorkspacePage />);

      expect(container.querySelector('.workspace-page__content')).not.toBeNull();
      expect(
        await screen.findByText(DETAIL_STRATEGY_NAME, {}, { timeout: LIVE_QUERY_TIMEOUT }),
      ).toBeInTheDocument();
      expect(
        await screen.findByText(LIVE_RUN_ID, {}, { timeout: LIVE_QUERY_TIMEOUT }),
      ).toBeInTheDocument();
      expectNoFetchFailure();
    },
    LIVE_TEST_TIMEOUT,
  );

  it(
    'hydrates strategy detail data against the staged local API',
    async () => {
      const { container } = await renderLiveRoute(
        `#/strategies/${LIVE_STRATEGY_ID}`,
        <StrategyDetailPage strategyId={LIVE_STRATEGY_ID} />,
      );

      expect(container.querySelector('.strategy-detail-page')).not.toBeNull();
      expect(
        await screen.findByRole(
          'heading',
          { level: 1, name: DETAIL_STRATEGY_NAME },
          { timeout: LIVE_QUERY_TIMEOUT },
        ),
      ).toBeInTheDocument();
      expect(container.querySelector('.strategy-detail-history-table')).not.toBeNull();
      expectNoFetchFailure();
    },
    LIVE_TEST_TIMEOUT,
  );

  it(
    'hydrates creation session data against the staged local API',
    async () => {
      const { container } = await renderLiveRoute(
        `#/creation/sessions/${LIVE_CREATION_SESSION_ID}`,
        <CreationSessionPage sessionId={LIVE_CREATION_SESSION_ID} />,
      );

      expect(container.querySelector('.creation-session-page')).not.toBeNull();
      expect(
        await screen.findByRole(
          'heading',
          { level: 1, name: CREATION_SESSION_NAME },
          { timeout: LIVE_QUERY_TIMEOUT },
        ),
      ).toBeInTheDocument();
      expect(container.querySelectorAll('.creation-step-chip').length).toBeGreaterThan(0);
      expectNoFetchFailure();
    },
    LIVE_TEST_TIMEOUT,
  );

  it(
    'hydrates runs index data against the staged local API',
    async () => {
      const { container } = await renderLiveRoute('#/runs', <RunsIndexPage />);

      expect(container.querySelector('.runs-index-table')).not.toBeNull();
      expect(
        await screen.findByText(LIVE_RUN_ID, {}, { timeout: LIVE_QUERY_TIMEOUT }),
      ).toBeInTheDocument();
      expectNoFetchFailure();
    },
    LIVE_TEST_TIMEOUT,
  );

  it(
    'hydrates run detail data against the staged local API',
    async () => {
      const { container } = await renderLiveRoute(
        `#/runs/${LIVE_RUN_ID}`,
        <RunDetailPage runId={LIVE_RUN_ID} />,
      );

      expect(container.querySelector('.run-detail-page')).not.toBeNull();
      expect(
        await screen.findByText(DETAIL_STRATEGY_NAME, {}, { timeout: LIVE_QUERY_TIMEOUT }),
      ).toBeInTheDocument();
      expect(container.querySelector('.run-detail-curve-card--overview')).not.toBeNull();
      expectNoFetchFailure();
    },
    LIVE_TEST_TIMEOUT,
  );

  it(
    'hydrates optimization config data against the staged local API',
    async () => {
      await renderLiveRoute(
        `#/optimization-jobs/new/config?strategy_id=${LIVE_OPTIMIZATION_STRATEGY_ID}`,
        <OptimizationConfigPage strategyId={LIVE_OPTIMIZATION_STRATEGY_ID} />,
      );

      expect(
        await screen.findByRole(
          'heading',
          { level: 1, name: OPTIMIZATION_STRATEGY_NAME },
          { timeout: LIVE_QUERY_TIMEOUT },
        ),
      ).toBeInTheDocument();
      expect(
        await screen.findByDisplayValue('20', {}, { timeout: LIVE_QUERY_TIMEOUT }),
      ).toBeInTheDocument();
      expectNoFetchFailure();
    },
    LIVE_TEST_TIMEOUT,
  );
});

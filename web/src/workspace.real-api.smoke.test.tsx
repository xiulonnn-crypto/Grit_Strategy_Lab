import {
  act,
  cleanup,
  render,
  screen,
  waitForElementToBeRemoved,
} from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from './lib/demoStoreContext';
import { AppRouteProvider, navigateTo, parseAppHash } from './lib/appRouteContext';
import { CreationSessionPage } from './pages/creation-session-page';
import { RunDetailPage } from './pages/run-detail-page';
import { RunsIndexPage } from './pages/runs-index-page';
import { SnapshotsPage } from './pages/snapshots-page';
import { StrategyDetailPage } from './pages/strategy-detail-page';
import { WorkspacePage } from './pages/workspace-page-lane-b';
import { ShellFrameCn } from './shell-frame-cn';

const LIVE_TEST_TIMEOUT = 20_000;
const LIVE_QUERY_TIMEOUT = 15_000;
const LIVE_API_BASE = 'http://127.0.0.1:8000';

const liveApiEnabled = process.env.LIVE_API_SMOKE === '1';
const describeLiveApi = liveApiEnabled ? describe : describe.skip;
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

async function renderLiveRoute(hash: string, page: JSX.Element): Promise<void> {
  window.location.hash = hash;
  const route = parseAppHash(window.location.hash);

  await act(async () => {
    render(
      <ApiClientProvider>
        <AppRouteProvider navigate={navigateTo} route={route}>
          <ShellFrameCn route={route}>{page}</ShellFrameCn>
        </AppRouteProvider>
      </ApiClientProvider>,
    );
  });
}

async function waitForLoadingTextToDisappear(text: string): Promise<void> {
  const loadingNode = screen.queryByText(text);
  if (loadingNode) {
    await waitForElementToBeRemoved(loadingNode, {
      timeout: LIVE_QUERY_TIMEOUT,
    });
  }
}

function expectNoFetchFailure(): void {
  expect(screen.queryByText(/fetch failed/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/failed to fetch/i)).not.toBeInTheDocument();
}

describeLiveApi('live api acceptance', () => {
  it(
    'hydrates workspace data against the live local API',
    async () => {
      await renderLiveRoute('#/workspace', <WorkspacePage />);

      expect(
        await screen.findByText('工作台健康度', {}, { timeout: LIVE_QUERY_TIMEOUT }),
      ).toBeInTheDocument();
      expect(
        (await screen.findAllByText('Draft GRID', {}, { timeout: LIVE_QUERY_TIMEOUT })).length,
      ).toBeGreaterThan(0);
      expect(screen.getAllByText('run_403158bf649b').length).toBeGreaterThan(0);
      expectNoFetchFailure();
    },
    LIVE_TEST_TIMEOUT,
  );

  it(
    'hydrates strategy detail data against the live local API',
    async () => {
      await renderLiveRoute(
        '#/strategies/strat_c475a93c1a9e',
        <StrategyDetailPage strategyId="strat_c475a93c1a9e" />,
      );

      expect(
        await screen.findByText('当前参数版本', {}, { timeout: LIVE_QUERY_TIMEOUT }),
      ).toBeInTheDocument();
      expect(screen.getAllByText('Draft GRID').length).toBeGreaterThan(0);
      expectNoFetchFailure();
    },
    LIVE_TEST_TIMEOUT,
  );

  it(
    'hydrates snapshots data against the live local API',
    async () => {
      await renderLiveRoute('#/snapshots', <SnapshotsPage />);

      await waitForLoadingTextToDisappear('正在加载快照状态...');
      expect(
        await screen.findByRole(
          'heading',
          { name: '快照总览', level: 1 },
          { timeout: LIVE_QUERY_TIMEOUT },
        ),
      ).toBeInTheDocument();
      expect(
        await screen.findByRole(
          'button',
          { name: '刷新快照' },
          { timeout: LIVE_QUERY_TIMEOUT },
        ),
      ).toBeInTheDocument();
      expect(
        await screen.findByText('公司行为数据', {}, { timeout: LIVE_QUERY_TIMEOUT }),
      ).toBeInTheDocument();
      expect(
        await screen.findByText('标普500', {}, { timeout: LIVE_QUERY_TIMEOUT }),
      ).toBeInTheDocument();
      expectNoFetchFailure();
    },
    LIVE_TEST_TIMEOUT,
  );

  it(
    'hydrates creation session data against the live local API',
    async () => {
      await renderLiveRoute(
        '#/creation/sessions/cs_75cee435a6ec',
        <CreationSessionPage sessionId="cs_75cee435a6ec" />,
      );

      expect(
        await screen.findByText('对话', {}, { timeout: LIVE_QUERY_TIMEOUT }),
      ).toBeInTheDocument();
      expectNoFetchFailure();
    },
    LIVE_TEST_TIMEOUT,
  );

  it(
    'hydrates runs index data against the live local API',
    async () => {
      await renderLiveRoute('#/runs', <RunsIndexPage />);

      expect(
        await screen.findByRole(
          'heading',
          { name: '回测列表', level: 2 },
          { timeout: LIVE_QUERY_TIMEOUT },
        ),
      ).toBeInTheDocument();
      expect(
        await screen.findByText('run_403158bf649b', {}, { timeout: LIVE_QUERY_TIMEOUT }),
      ).toBeInTheDocument();
      expectNoFetchFailure();
    },
    LIVE_TEST_TIMEOUT,
  );

  it(
    'hydrates run detail data against the live local API',
    async () => {
      await renderLiveRoute(
        '#/runs/run_403158bf649b',
        <RunDetailPage runId="run_403158bf649b" />,
      );

      expect(
        await screen.findByText('运行概览', {}, { timeout: LIVE_QUERY_TIMEOUT }),
      ).toBeInTheDocument();
      expect(screen.getAllByText('run_403158bf649b').length).toBeGreaterThan(0);
      expectNoFetchFailure();
    },
    LIVE_TEST_TIMEOUT,
  );
});

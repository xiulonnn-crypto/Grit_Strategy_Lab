import type {
  ApiBacktestRunListItem,
  ApiOptimizationJobListItem,
  ApiStrategyListItem,
  ApiWorkspaceOverview,
  DemoApi,
} from '../types';
import {
  demoApi,
  exportDemoStoreSnapshot,
  restoreDemoStoreSnapshot,
  type DemoStoreSnapshot,
} from './demoStorePhase4';

const STORAGE_KEY = 'grit-strategy-lab:static-demo:v1';
const GIST_ID_KEY = 'grit-strategy-lab:static-demo:gist-id';
const GIST_FILE_NAME = 'grit-strategy-lab-static-demo.json';

export type StaticDemoCloudStatus = {
  connected: boolean;
  gistId: string | null;
  syncing: boolean;
  error: string | null;
};

type StaticDemoCloudConnect = {
  token: string;
  gistId?: string | null;
};

type StaticWorkspaceSeed = {
  overview: ApiWorkspaceOverview;
  strategy_library: {
    strategies: ApiStrategyListItem[];
    runs: ApiBacktestRunListItem[];
  };
  optimization_jobs: ApiOptimizationJobListItem[];
  strategy_details?: Record<string, unknown>;
  backtest_run_details?: Record<string, unknown>;
  optimization_job_details?: Record<string, unknown>;
};

let githubToken: string | null = null;
let cloudStatus: StaticDemoCloudStatus = {
  connected: false,
  gistId: null,
  syncing: false,
  error: null,
};
const cloudListeners = new Set<() => void>();
let workspaceSeedPromise: Promise<StaticWorkspaceSeed | null> | null = null;

export function isStaticDemoMode(): boolean {
  return import.meta.env.VITE_STATIC_DEMO === 'true';
}

export function isStaticDemoSyncPanelRequested(): boolean {
  return isStaticDemoMode() && new URLSearchParams(window.location.search).has('demo-sync');
}

async function loadWorkspaceSeed(): Promise<StaticWorkspaceSeed | null> {
  if (!isStaticDemoMode() || typeof window === 'undefined') return null;
  if (!workspaceSeedPromise) {
    workspaceSeedPromise = fetch(`${import.meta.env.BASE_URL}workspace-seed.json`)
      .then(async (response) => (response.ok ? ((await response.json()) as StaticWorkspaceSeed) : null))
      .catch(() => null);
  }
  return workspaceSeedPromise;
}

async function getSeededWorkspaceResult(property: PropertyKey, args: unknown[]): Promise<{ matched: boolean; value?: unknown }> {
  const seed = await loadWorkspaceSeed();
  if (!seed) return { matched: false };
  switch (property) {
    case 'getWorkspaceOverview':
      return { matched: true, value: structuredClone(seed.overview) };
    case 'getStrategyLibrary':
      return { matched: true, value: structuredClone(seed.strategy_library) };
    case 'listStrategies':
      return { matched: true, value: structuredClone(seed.strategy_library.strategies) };
    case 'listBacktestRuns': {
      const [query] = args as [{ limit?: number; status?: string } | undefined];
      const rows = query?.status
        ? seed.strategy_library.runs.filter((row) => row.status === query.status)
        : seed.strategy_library.runs;
      return { matched: true, value: structuredClone(query?.limit ? rows.slice(0, query.limit) : rows) };
    }
    case 'listOptimizationJobs':
      return { matched: true, value: structuredClone(seed.optimization_jobs) };
    case 'getStrategyDetail': {
      const [id] = args as [string];
      const value = seed.strategy_details?.[id];
      return value === undefined ? { matched: false } : { matched: true, value: structuredClone(value) };
    }
    case 'getBacktestRunDetail': {
      const [id] = args as [string];
      const value = seed.backtest_run_details?.[id];
      return value === undefined ? { matched: false } : { matched: true, value: structuredClone(value) };
    }
    case 'getOptimizationJobDetail': {
      const [id] = args as [string];
      const value = seed.optimization_job_details?.[id];
      return value === undefined ? { matched: false } : { matched: true, value: structuredClone(value) };
    }
    default:
      return { matched: false };
  }
}

function loadSnapshot(): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    restoreDemoStoreSnapshot(JSON.parse(raw) as DemoStoreSnapshot);
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

function saveSnapshot(): void {
  if (typeof window === 'undefined') return;
  try {
    const snapshot = exportDemoStoreSnapshot();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    void syncSnapshotToGitHub(snapshot);
  } catch {
    // A full or unavailable browser storage must not block the interactive demo.
  }
}

function publishCloudStatus(): void {
  cloudListeners.forEach((listener) => listener());
}

function setCloudStatus(next: Partial<StaticDemoCloudStatus>): void {
  cloudStatus = { ...cloudStatus, ...next };
  publishCloudStatus();
}

function gistHeaders(token: string): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function githubJson<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: gistHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`GitHub Gist 同步失败（${response.status}）。请检查 token 是否拥有 Gist 权限。`);
  }
  return (await response.json()) as T;
}

type GitHubGist = {
  id: string;
  files: Record<string, { content?: string }>;
};

async function syncSnapshotToGitHub(snapshot: DemoStoreSnapshot): Promise<void> {
  if (!githubToken || !cloudStatus.gistId || cloudStatus.syncing) return;
  setCloudStatus({ syncing: true, error: null });
  try {
    await githubJson<GitHubGist>(`/gists/${encodeURIComponent(cloudStatus.gistId)}`, githubToken, {
      method: 'PATCH',
      body: JSON.stringify({
        files: { [GIST_FILE_NAME]: { content: JSON.stringify(snapshot) } },
      }),
    });
    setCloudStatus({ syncing: false, error: null });
  } catch (error) {
    setCloudStatus({ syncing: false, error: error instanceof Error ? error.message : 'GitHub Gist 同步失败。' });
  }
}

export function getStaticDemoCloudStatus(): StaticDemoCloudStatus {
  if (typeof window !== 'undefined' && !cloudStatus.gistId) {
    cloudStatus = { ...cloudStatus, gistId: window.localStorage.getItem(GIST_ID_KEY) };
  }
  return cloudStatus;
}

export function subscribeStaticDemoCloudStatus(listener: () => void): () => void {
  cloudListeners.add(listener);
  return () => cloudListeners.delete(listener);
}

export async function connectStaticDemoCloud({ token, gistId }: StaticDemoCloudConnect): Promise<void> {
  const normalizedToken = token.trim();
  if (!normalizedToken) throw new Error('请输入 GitHub token。');
  githubToken = normalizedToken;
  setCloudStatus({ syncing: true, error: null });
  try {
    const savedGistId = gistId?.trim() || (typeof window !== 'undefined' ? window.localStorage.getItem(GIST_ID_KEY) : null);
    if (savedGistId) {
      const gist = await githubJson<GitHubGist>(`/gists/${encodeURIComponent(savedGistId)}`, normalizedToken);
      const content = gist.files[GIST_FILE_NAME]?.content;
      if (content) {
        restoreDemoStoreSnapshot(JSON.parse(content) as DemoStoreSnapshot);
        saveSnapshot();
      }
      if (typeof window !== 'undefined') window.localStorage.setItem(GIST_ID_KEY, gist.id);
      setCloudStatus({ connected: true, gistId: gist.id, syncing: false, error: null });
      return;
    }

    const snapshot = exportDemoStoreSnapshot();
    const gist = await githubJson<GitHubGist>('/gists', normalizedToken, {
      method: 'POST',
      body: JSON.stringify({
        description: 'Grit Strategy Lab static demo state',
        public: false,
        files: { [GIST_FILE_NAME]: { content: JSON.stringify(snapshot) } },
      }),
    });
    if (typeof window !== 'undefined') window.localStorage.setItem(GIST_ID_KEY, gist.id);
    setCloudStatus({ connected: true, gistId: gist.id, syncing: false, error: null });
  } catch (error) {
    githubToken = null;
    setCloudStatus({ connected: false, syncing: false, error: error instanceof Error ? error.message : 'GitHub Gist 连接失败。' });
    throw error;
  }
}

export function resetStaticDemo(): void {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(GIST_ID_KEY);
  }
  githubToken = null;
  cloudStatus = { connected: false, gistId: null, syncing: false, error: null };
  publishCloudStatus();
}

export function createStaticDemoApi(): DemoApi {
  loadSnapshot();
  return new Proxy(demoApi, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        const seeded = await getSeededWorkspaceResult(property, args);
        let result = seeded.matched ? seeded.value : undefined;
        if (!seeded.matched) {
          try {
            result = await value.apply(target, args);
          } catch (error) {
            const fallbackId =
              property === 'getStrategyDetail' ? 'strat-001' : property === 'getBacktestRunDetail' ? 'bt-001' : property === 'getOptimizationJobDetail' ? 'opt-001' : null;
            if (!fallbackId) throw error;
            result = await value.apply(target, [fallbackId, ...args.slice(1)]);
          }
        }
        saveSnapshot();
        return result;
      };
    },
  }) as DemoApi;
}

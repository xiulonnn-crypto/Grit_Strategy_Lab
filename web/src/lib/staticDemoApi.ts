import type { DemoApi } from '../types';
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

let githubToken: string | null = null;
let cloudStatus: StaticDemoCloudStatus = {
  connected: false,
  gistId: null,
  syncing: false,
  error: null,
};
const cloudListeners = new Set<() => void>();

export function isStaticDemoMode(): boolean {
  return import.meta.env.VITE_STATIC_DEMO === 'true';
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
      return (...args: unknown[]) =>
        Promise.resolve(value.apply(target, args)).then((result) => {
          saveSnapshot();
          return result;
        });
    },
  }) as DemoApi;
}

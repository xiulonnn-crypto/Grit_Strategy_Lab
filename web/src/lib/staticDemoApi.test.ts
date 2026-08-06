import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDemoStore } from './demoStorePhase4';
import {
  connectStaticDemoCloud,
  createStaticDemoApi,
  getStaticDemoCloudStatus,
  resetStaticDemo,
} from './staticDemoApi';

describe('static demo API persistence', () => {
  beforeEach(() => {
    resetStaticDemo();
    resetDemoStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetStaticDemo();
    resetDemoStore();
  });

  it('restores an interaction-created session after a fresh in-memory store', async () => {
    const firstVisit = createStaticDemoApi();
    const created = await firstVisit.createCreationSession({ mode: 'CREATE' });

    resetDemoStore();

    const reloadedVisit = createStaticDemoApi();
    await expect(reloadedVisit.getCreationSession(created.id)).resolves.toMatchObject({
      id: created.id,
      mode: 'CREATE',
    });
  });

  it('creates a private GitHub Gist and syncs later interactions without storing the token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'gist-123', files: {} }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'gist-123', files: {} }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await connectStaticDemoCloud({ token: 'github_pat_example' });
    await createStaticDemoApi().createCreationSession({ mode: 'CREATE' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getStaticDemoCloudStatus()).toMatchObject({ connected: true, gistId: 'gist-123', error: null });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.github.com/gists',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.github.com/gists/gist-123',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(window.localStorage.getItem('grit-strategy-lab:static-demo:v1')).not.toContain('github_pat_example');
  });
});

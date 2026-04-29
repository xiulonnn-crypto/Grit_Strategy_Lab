import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from './app-runtime';
import { installMockApiServer } from './testApiMock';

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

describe('App runtime routes', () => {
  it('defaults to workspace when no hash is present', async () => {
    await renderApp('');

    await waitFor(() => expect(window.location.hash).toBe('#/workspace'));
    expect(document.querySelector('.workspace-page')).not.toBeNull();
  });

  it('creates a session route from the template page and shows the page-owned strategy header', async () => {
    await renderApp('#/strategies');

    expect(document.querySelector('.creation-template-page')).not.toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: '新建策略' }));
    fireEvent.click(await screen.findByRole('button', { name: '创建动量策略' }));

    await waitFor(() => expect(window.location.hash).toMatch(/^#\/creation\/sessions\/cs-/));
    await waitFor(() => expect(document.querySelector('.creation-session-page')).not.toBeNull());
  });

  it('keeps the retired strategy-library alias readable', async () => {
    await renderApp('#/creation/new');

    expect(document.querySelector('.creation-template-page')).not.toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: '策略库' })).toBeInTheDocument();
  });

  it('renders the strategy detail page on the formal route', async () => {
    await renderApp('#/strategies/strat-001');

    expect(document.querySelector('.strategy-detail-page')).not.toBeNull();
    expect((await screen.findAllByText('Quality Momentum')).length).toBeGreaterThan(0);
  });

  it('renders the composition dashboard route inside the unified shell', async () => {
    await renderApp('#/compositions');

    expect(document.querySelector('.composition-dashboard-page')).not.toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: '组合仪表板' })).toBeInTheDocument();
  });

  it('keeps the retired composition detail preview alias out of production routing', async () => {
    await renderApp('#/compositions/detail');

    await waitFor(() => expect(document.querySelector('.composition-dashboard-page')).not.toBeNull());
    expect(document.querySelector('.composition-detail-page')).toBeNull();
  });

  it('renders the leg inventory route inside the unified shell', async () => {
    await renderApp('#/legs');

    expect(document.querySelector('.leg-inventory-page')).not.toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: '策略资产库' })).toBeInTheDocument();
  });

  it('renders the composition workbench route inside the unified shell', async () => {
    await renderApp('#/compositions/workbench?composition_id=comp-001&add_leg=asset-leg-001');

    expect(document.querySelector('.composition-workbench-page')).not.toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: '全天候研究组合' })).toBeInTheDocument();
  });

  it('renders the composition detail route inside the unified shell', async () => {
    await renderApp('#/compositions/comp-001');

    expect(document.querySelector('.composition-detail-page')).not.toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: '全天候研究组合' })).toBeInTheDocument();
  });

  it('renders the composition backtest config route inside the unified shell', async () => {
    await renderApp('#/compositions/comp-001/backtest-runs/new');

    expect(document.querySelector('.composition-backtest-config-page')).not.toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: '稳定性配置' })).toBeInTheDocument();
  });

  it('renders the composition backtest result route with the production tabs', async () => {
    await renderApp('#/compositions/comp-001/backtest-runs/comp-run-001?tab=orders');

    expect(document.querySelector('.composition-backtest-result-page')).not.toBeNull();
    expect(await screen.findByRole('tab', { name: /订单/, selected: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重跑回测' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '启动优化' })).toBeInTheDocument();
  });

  it('renders the composition allocation split routes inside the unified shell', async () => {
    await renderApp('#/compositions/comp-001/allocation-lab');

    expect(document.querySelector('[data-page-root="composition-allocation-config"]')).not.toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: '组合优化实验室' })).toBeInTheDocument();

    cleanup();
    await renderApp('#/compositions/comp-001/allocation-jobs/alloc-001');

    expect(document.querySelector('[data-page-root="composition-allocation-result"]')).not.toBeNull();
    expect(await screen.findByRole('heading', { level: 2, name: '候选选择器 · 多维度选拔赛' })).toBeInTheDocument();
    expect(document.querySelector('[data-ui="allocation-candidate-selector"]')).not.toBeNull();
    expect(document.querySelector('[data-ui="allocation-delta-summary"]')).toBeNull();
    expect(screen.queryByText('目标对齐')).not.toBeInTheDocument();
  });

  it('submits from backtest into the run detail route', async () => {
    await renderApp('#/strategies/strat-001/backtest-runs/new');

    expect(document.querySelector('.backtest-submit-page')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /回测|submit/i }));

    await waitFor(() => expect(window.location.hash).toBe('#/runs/bt-001'));
    expect((await screen.findAllByText(/bt-001/)).length).toBeGreaterThan(0);
  });

  it('loads the optimization jobs index route inside the unified shell', async () => {
    await renderApp('#/optimization-jobs');

    expect(document.querySelector('.optimization-lab-page')).not.toBeNull();
    expect(document.querySelector('.optimization-steps')).toBeNull();
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('loads the optimization strategy-select route inside the unified shell', async () => {
    await renderApp('#/optimization-jobs/new?strategy_id=strat-001');

    expect(document.querySelector('.optimization-lab-page')).not.toBeNull();
    expect(document.querySelector('.optimization-steps')).not.toBeNull();
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('loads the optimization config route inside the unified shell', async () => {
    await renderApp('#/optimization-jobs/new/config?strategy_id=strat-001&source_run_id=bt-001&entry_point=run_detail');

    expect(document.querySelector('.optimization-config-grid')).not.toBeNull();
    expect((await screen.findAllByRole('spinbutton')).length).toBeGreaterThan(0);
  });

  it('loads the optimization results route inside the unified shell', async () => {
    await renderApp('#/optimization-jobs/opt-001');

    expect(document.querySelector('.optimization-lab-panel--hero')).not.toBeNull();
    await waitFor(() =>
      expect(
        document.querySelector('.optimization-results-grid') ??
          document.querySelector('.optimization-results-empty'),
      ).not.toBeNull(),
    );
  });

  it('renders the runs index page on the formal route', async () => {
    await renderApp('#/runs');

    expect(document.querySelector('[data-page-root="runs-index"], .runs-index-page')).not.toBeNull();
    const strategyLibraryTab = await screen.findByRole('tab', { name: /策略库视图/ });
    expect(strategyLibraryTab).toHaveClass('is-active');
    expect(document.querySelector('.runs-evidence-shell .runs-evidence-board')).not.toBeNull();
  });

  it('renders the snapshots page on the formal route', async () => {
    await renderApp('#/snapshots?tab=bond');

    expect(document.querySelector('.snapshots-page')).not.toBeNull();
    expect(await screen.findByRole('button', { name: '刷新债券快照' })).toBeInTheDocument();
  });
});

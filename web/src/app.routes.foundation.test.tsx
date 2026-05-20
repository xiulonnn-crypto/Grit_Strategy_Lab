import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './app-runtime';
import { buildRouteChunkReloadUrl, isRouteChunkLoadError } from './app-runtime-cn';
import { previewFactorDiagnosticsForLibrary } from './pages/factors-page';
import { installMockApiServer } from './testApiMock';

let mockServer: ReturnType<typeof installMockApiServer> | null = null;

const ROUTE_ROOT_SELECTOR = [
  '.workspace-page',
  '.creation-template-page',
  '.asset-allocation-page',
  '.strategy-detail-page',
  '.composition-dashboard-page',
  '[data-page-root="composition-global-list"]',
  '[data-page-root="composition-global-backtest-runs"]',
  '[data-page-root="composition-global-lab"]',
  '.leg-inventory-page',
  '.composition-workbench-page',
  '.composition-detail-page',
  '.composition-backtest-config-page',
  '.composition-backtest-result-page',
  '[data-page-root="composition-allocation-config"]',
  '[data-page-root="composition-allocation-result"]',
  '.backtest-submit-page',
  '.optimization-lab-page',
  '.optimization-config-grid',
  '[data-page-root="runs-index"]',
  '.runs-index-page',
  '.snapshots-page',
  '[data-page-root="pit-cleaning-center"]',
  '[data-page-root="factor-library"]',
  '[data-page-root="factor-detail"]',
  '[data-page-root="factor-editor"]',
  '[data-page-root="factor-factory"]',
].join(', ');

async function renderApp(hash: string): Promise<void> {
  await act(async () => {
    window.location.hash = hash;
    render(<App />);
  });
  await waitFor(() => expect(document.querySelector(ROUTE_ROOT_SELECTOR)).not.toBeNull());
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
  it('recognizes stale lazy route chunks and builds a cache-busting document reload URL', () => {
    expect(isRouteChunkLoadError(new TypeError('Failed to fetch dynamically imported module'))).toBe(true);
    expect(isRouteChunkLoadError(new Error('ordinary render failure'))).toBe(false);

    const reloadUrl = buildRouteChunkReloadUrl(
      new URL('http://127.0.0.1:4173/#/factor-models/new'),
      177777,
    );

    expect(reloadUrl).toBe('http://127.0.0.1:4173/?v=route-reload-177777#/factor-models/new');
  });

  it('fills factor library diagnostics one by one when batch preview is unavailable', async () => {
    const previewFactorDiagnostics = vi.fn()
      .mockRejectedValueOnce(new Error('batch preview unavailable'))
      .mockResolvedValueOnce({
        mode: 'BATCH',
        status: 'PREVIEW',
        items: [{
          factor_id: 's_mom_6m_rank',
          latest_diagnostic_summary: { status: 'PREVIEW', rank_ic: 0.0283, ir: 1.17 },
          batch_diagnostic_summary: { status: 'PREVIEW', rank_ic: 0.0283, ir: 1.17 },
        }],
      })
      .mockRejectedValueOnce(new Error('unsupported expression'));

    const preview = await previewFactorDiagnosticsForLibrary(previewFactorDiagnostics, [
      's_mom_6m_rank',
      'bad_factor',
    ]);

    expect(previewFactorDiagnostics).toHaveBeenNthCalledWith(1, expect.objectContaining({
      batch: true,
      factor_ids: ['s_mom_6m_rank', 'bad_factor'],
      diagnostic_mode: 'SANDBOX',
    }));
    expect(previewFactorDiagnostics).toHaveBeenNthCalledWith(2, expect.objectContaining({
      factor_ids: ['s_mom_6m_rank'],
    }));
    expect(previewFactorDiagnostics).toHaveBeenNthCalledWith(3, expect.objectContaining({
      factor_ids: ['bad_factor'],
    }));
    expect(preview?.status).toBe('PREVIEW');
    expect(preview?.items).toHaveLength(1);
    expect(preview?.items?.[0]?.factor_id).toBe('s_mom_6m_rank');
  });

  it('defers factor governance overview until the queue modal is opened', async () => {
    await renderApp('#/factors');

    const requestedPaths = () => (mockServer?.fetchSpy.mock.calls ?? []).map(([input]) => {
      const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost');
      return `${url.pathname}${url.search}`;
    });

    expect(requestedPaths().some((path) => path === '/factors' || path.startsWith('/factors?'))).toBe(true);
    expect(requestedPaths()).not.toContain('/factor-governance/overview');

    fireEvent.click(document.querySelector<HTMLButtonElement>('.factor-governance-trigger')!);

    await waitFor(() => expect(requestedPaths()).toContain('/factor-governance/overview'));
  });

  it('posts factor descriptions and renders them on the factor detail subtitle only', async () => {
    await renderApp('#/factors/new');

    const description = '逻辑：用测试描述验证因子经济含义。作用：在列表与详情页展示为因子描述。';
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('.factor-field input:not([readonly])'));
    const textareas = Array.from(document.querySelectorAll<HTMLTextAreaElement>('.factor-field textarea'));

    fireEvent.change(inputs[0], { target: { value: '描述字段回归因子' } });
    fireEvent.change(inputs[1], { target: { value: 'desc_payload' } });
    fireEvent.change(inputs[2], { target: { value: '21d' } });
    fireEvent.change(textareas[0], { target: { value: 'Return(Close,21)' } });
    fireEvent.change(textareas[1], { target: { value: description } });
    fireEvent.click(document.querySelector<HTMLButtonElement>('.factor-btn--primary')!);

    await waitFor(() => {
      expect(window.location.hash).toBe('#/factors/m_mom_desc_payload_21d_rank');
    });

    const createCall = mockServer?.fetchSpy.mock.calls.find(([input, init]) => (
      String(input).endsWith('/factors') && (init as RequestInit | undefined)?.method === 'POST'
    ));
    expect(createCall).toBeTruthy();
    expect(JSON.parse(String((createCall?.[1] as RequestInit).body))).toMatchObject({
      description,
      descriptor: {
        source_prefix: 'm',
        category: 'mom',
        metric: 'desc_payload',
        window: '21d',
        operator: 'rank',
      },
    });

    const detailSubtitle = await waitFor(() => {
      const node = document.querySelector('.factor-detail-subtitle');
      expect(node).not.toBeNull();
      expect(node?.textContent).toContain(description);
      return node;
    });
    expect(detailSubtitle?.textContent).toContain('因子描述');
    expect(screen.getByRole('button', { name: '点击诊断' })).toBeEnabled();
    expect(screen.getByText('尚未生成诊断报告')).toBeInTheDocument();
    expect(document.querySelector('.factor-detail-metrics')).toBeNull();

    await act(async () => {
      window.location.hash = '#/factors';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    await waitFor(() => expect(document.querySelector('[data-page-root="factor-library"]')).not.toBeNull());
    expect(document.querySelector('.factor-row-description')).toBeNull();
    expect(document.body.textContent).not.toContain(description);
  });

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

  it('renders the asset allocation strategy config route inside the unified shell', async () => {
    await renderApp('#/creation/asset-allocation/new');

    await waitFor(() =>
      expect(document.querySelector('.asset-allocation-page')).not.toBeNull(),
    );
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/creation\/asset-allocation\/new\?session_id=cs-/));
    expect(screen.getByRole('heading', { level: 1, name: '资产配置策略配置' })).toBeInTheDocument();
    expect(document.querySelector('.optimization-steps')).toBeNull();
  });

  it('renders the strategy detail page on the formal route', async () => {
    await renderApp('#/strategies/strat-001');

    expect(document.querySelector('.strategy-detail-page')).not.toBeNull();
    expect((await screen.findAllByText('Quality Momentum')).length).toBeGreaterThan(0);
  });

  it('renders the composition dashboard route inside the unified shell', async () => {
    await renderApp('#/compositions');

    expect(document.querySelector('.composition-dashboard-page')).not.toBeNull();
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: '组合仪表板' })).toBeInTheDocument(),
    );
  });

  it('renders composition v2 global routes before the dynamic detail route', async () => {
    await renderApp('#/compositions/list');

    expect(document.querySelector('[data-page-root="composition-global-list"]')).not.toBeNull();
    expect(document.querySelector('.composition-detail-page')).toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: '组合列表' })).toBeInTheDocument();

    cleanup();
    await renderApp('#/compositions/backtest-runs?scenario=2022');

    expect(document.querySelector('[data-page-root="composition-global-backtest-runs"]')).not.toBeNull();
    expect(document.querySelector('.composition-detail-page')).toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: '组合回测列表' })).toBeInTheDocument();

    cleanup();
    await renderApp('#/compositions/lab?status=promotion_ready');

    expect(document.querySelector('[data-page-root="composition-global-lab"]')).not.toBeNull();
    expect(document.querySelector('.composition-detail-page')).toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: '组合实验室' })).toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole('button', { name: /回测|submit/i }));

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

  it('highlights a targeted equity snapshot from a route query', async () => {
    await renderApp('#/snapshots?tab=equity&target=ds-price');

    expect(await screen.findByRole('heading', { level: 1, name: '数据快照治理台' })).toBeInTheDocument();
    await waitFor(() =>
      expect(document.querySelector('[data-snapshot-id="ds-price"]')).toHaveClass('dense-row--highlight'),
    );
  });


  it('renders the PIT cleaning center and factor library routes', async () => {
    await renderApp('#/pit-data');
    expect(screen.queryByRole('button', { name: /跳转数据快照/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/链接源：#\/snapshots\?tab=equity/)).not.toBeInTheDocument();
    expect(document.querySelector('[data-page-root="pit-cleaning-center"]')).not.toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: 'PIT 清洗中心' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新检查 PIT 门禁' })).toBeInTheDocument();
    expect(screen.getByLabelText('四层 PIT 准入卡')).toBeInTheDocument();
    expect(screen.getByText('L1 基础行情')).toBeInTheDocument();
    expect(screen.getByText('L2 财务截面')).toBeInTheDocument();
    expect(screen.getByText('L3 分析师与情绪')).toBeInTheDocument();
    expect(screen.getByText('L4 宏观与衍生品')).toBeInTheDocument();
    expect(screen.getAllByText('部分可用').length).toBeGreaterThan(0);
    expect(screen.getAllByText('卖空样本').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/卖空样本已可用/).length).toBeGreaterThan(0);
    expect(screen.queryByText('数据运维指令')).not.toBeInTheDocument();
    expect(screen.getByText('PIT 门禁摘要')).toBeInTheDocument();
    expect(screen.getByText('因子诊断准入矩阵')).toBeInTheDocument();
    expect(screen.queryByText(/consensus_sample_gate|short_volume_gate|price_replay_gate/)).not.toBeInTheDocument();
    expect(screen.getByText('覆盖率下钻')).toBeInTheDocument();
    expect(screen.getByText('点时异常核查与规则工作站')).toBeInTheDocument();
    expect(screen.getByText('门禁行动列表')).toBeInTheDocument();
    expect(document.getElementById('coverage-gap')).not.toBeNull();
    expect(screen.queryByText(/Price-only/i)).not.toBeInTheDocument();
  });

  it('renders the factor detail and editor routes', async () => {
    await renderApp('#/factors/momentum_12m_1m');

    expect(document.querySelector('[data-page-root="factor-detail"]')).not.toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: 'Rank-12-1月截面动量 (排序)诊断报告' })).toBeInTheDocument();
    const verifyButton = screen.getByRole('button', { name: '重新诊断' });
    expect(verifyButton).toHaveClass('factor-detail-action-btn', 'factor-detail-action-btn--primary');
    expect(screen.getByRole('link', { name: '生成投委会 PDF' })).toHaveClass('factor-detail-action-btn');
    expect(screen.getByText('分层收益与 IC 走势')).toBeInTheDocument();
    expect(screen.getByText('风险提示')).toBeInTheDocument();
    expect(screen.getByText('换手率与衰减')).toBeInTheDocument();
    expect(screen.getByLabelText('换手率与衰减计算口径')).toBeInTheDocument();
    expect(screen.getByLabelText('分层收益与 IC 走势计算口径')).toBeInTheDocument();
    expect(screen.getByText('审计足迹')).toBeInTheDocument();

    cleanup();
    await renderApp('#/factors/new');

    expect(document.querySelector('[data-page-root="factor-editor"]')).not.toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: '因子编辑器' })).toBeInTheDocument();
    expect(screen.getByText('5 年样本内 IC 预览')).toBeInTheDocument();
    expect(screen.getByText('m_mom_short_5d_rank')).toBeInTheDocument();
    expect(document.querySelector('[data-tooltip*="时间序列排序"]')).not.toBeNull();

    cleanup();
    await renderApp('#/factors/quarantine');

    expect(document.querySelector('[data-page-root="factor-factory"]')).not.toBeNull();
    expect(document.querySelector('[data-initial-section="quarantine"]')).not.toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: '因子任务生产台' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '启动自动化' })).toBeInTheDocument();
    expect(screen.getAllByText('检疫与发布').length).toBeGreaterThanOrEqual(1);
    return;

    expect(document.querySelector('[data-page-root="factor-quarantine"]')).not.toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: '检疫工作台' })).toBeInTheDocument();
    expect(screen.getAllByText('候选队列').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('检疫报告').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('发布审计').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('拒绝样本库')).toBeInTheDocument();
  });

  it('keeps factor heatmap row accent confined to the factor column', () => {
    const css = readFileSync('src/pages/factors-page.css', 'utf8');

    expect(css).toMatch(/\.factor-table tr\.is-correlation-highlight td\s*\{[^}]*background:\s*#f5fbf8;[^}]*\}/s);
    expect(css).not.toMatch(/\.factor-table tr\.is-correlation-highlight td\s*\{[^}]*box-shadow:/s);
    expect(css).toMatch(
      /\.factor-table tr\.is-correlation-highlight td:first-child\s*\{[^}]*box-shadow:\s*inset 3px 0 0 var\(--gsl-color-primary, #1f877b\);[^}]*\}/s,
    );
  });

  it('limits the PIT universe history anchors to three visible rows with vertical scrolling', () => {
    const css = readFileSync('src/pages/factors-page.css', 'utf8');

    expect(css).toMatch(/\.factor-universe-chart\s*\{[^}]*grid-auto-rows:\s*180px;[^}]*\}/s);
    expect(css).toMatch(
      /\.factor-universe-chart\s*\{[^}]*max-height:\s*calc\(180px \* 3 \+ 12px \* 2 \+ 32px\);[^}]*\}/s,
    );
    expect(css).toMatch(/\.factor-universe-chart\s*\{[^}]*overflow-y:\s*auto;[^}]*\}/s);
  });

  it('keeps the PIT cleaning center density aligned to the approved UI draft', () => {
    const source = readFileSync('src/pages/factors-page.tsx', 'utf8');
    const css = readFileSync('src/pages/factors-page.css', 'utf8');

    expect(source).toMatch(/const PIT_COVERAGE_PREVIEW_LIMIT = 3;/);
    expect(source).toMatch(/visibleCoverageGapBuckets\s*=\s*coverageGapBuckets\.slice\(0,\s*PIT_COVERAGE_PREVIEW_LIMIT\)/);
    expect(source).toMatch(/details:\s*compactPitCardDetails\(layer\)/);
    expect(source).toMatch(/compactPitSubmoduleTitle\(submodule\)/);
    expect(source).toMatch(/compactPitSubmoduleStatus\(submodule\.status\)/);
    expect(source).toMatch(/summary:\s*compactDiagnosticSummary\(group\)/);
    expect(source).not.toContain('<strong>数据运维指令</strong>');
    expect(css).toMatch(
      /\.factor-page\[data-page-root="pit-cleaning-center"\]\s+\.pit-layer-card p\s*\{[^}]*-webkit-line-clamp:\s*2;[^}]*\}/s,
    );
    expect(css).toMatch(
      /\.factor-page\[data-page-root="pit-cleaning-center"\]\s+\.factor-card-grid--pit\s+\.pit-layer-card\s*\{[^}]*grid-template-rows:\s*auto auto auto minmax\(32px,\s*1fr\);[^}]*height:\s*100%;[^}]*\}/s,
    );
    expect(css).toMatch(
      /\.factor-page\[data-page-root="pit-cleaning-center"\]\s+\.pit-layer-card__detail-row\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*\}/s,
    );
    expect(css).toMatch(
      /\.pit-layer-card__submodules\s*\{[^}]*align-self:\s*end;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[^}]*grid-auto-rows:\s*32px;[^}]*gap:\s*6px;[^}]*margin-top:\s*auto;[^}]*\}/s,
    );
    expect(css).toMatch(
      /\.pit-submodule-pill\s*\{[^}]*height:\s*32px;[^}]*\}/s,
    );
    expect(css).toMatch(
      /\.factor-card-grid--pit\s+\.pit-layer-card\s+\.pit-submodule-pill strong\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*16px;[^}]*\}/s,
    );
    expect(css).toMatch(
      /\.factor-page\[data-page-root="pit-cleaning-center"\]\s+\.factor-waiver-banner\s*\{[^}]*padding:\s*16px 18px;[^}]*\}/s,
    );
  });
});

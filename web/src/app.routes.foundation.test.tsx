import { readFileSync } from 'node:fs';
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
    expect(await screen.findByRole('heading', { level: 1, name: '组合仪表板' })).toBeInTheDocument();
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

  it('highlights a targeted equity snapshot from a route query', async () => {
    await renderApp('#/snapshots?tab=equity&target=ds-price');

    expect(await screen.findByRole('heading', { level: 1, name: '数据快照' })).toBeInTheDocument();
    await waitFor(() =>
      expect(document.querySelector('[data-snapshot-id="ds-price"]')).toHaveClass('snapshots-row-card--highlight'),
    );
    expect(screen.getByRole('button', { name: '数据集快照' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders the PIT cleaning center and factor library routes', async () => {
    await renderApp('#/pit-data');

    expect(await screen.findByText('survivorship bias free')).toBeInTheDocument();
    expect(document.querySelector('[data-page-root="pit-cleaning-center"]')).not.toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: 'PIT 清洗中心' })).toBeInTheDocument();
    expect(screen.getByText('点时样本池')).toBeInTheDocument();
    expect(screen.getByText(/缺失 416 个 symbol/)).toBeInTheDocument();
    expect(screen.getByText('数据运维指令 (Ops Guidance)')).toBeInTheDocument();
    expect(screen.getByText('Full Ready 免费源修复队列')).toBeInTheDocument();
    expect(screen.getByText('拒绝伪 Ready 规则')).toBeInTheDocument();
    expect(screen.getByText(/免费源对 symbol 全部返回/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重启 Identity Scraper' }));
    expect(screen.getByRole('dialog', { name: 'Identity Scraper 运维指令' })).toBeInTheDocument();
    expect(screen.getByText('ops://identity-scraper/restart')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '执行重启任务' }));
    expect(await screen.findByText(/Identity Scraper 已执行/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭运维指令' }));
    expect(screen.getByRole('button', { name: '下钻分析' })).toBeInTheDocument();
    expect(screen.getByText('MAD 中位数偏差')).toBeInTheDocument();
    expect(screen.getByText('3σ 标准差')).toBeInTheDocument();
    expect(screen.getByText('点时样本池历史锚点')).toBeInTheDocument();
    expect(screen.getAllByText(/复权因子/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'PRICE_SNAPSHOT_NOT_READY' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '下钻分析' }));
    expect(screen.getByText('覆盖率缺口清单')).toBeInTheDocument();
    expect(screen.getAllByText('市值权重占比 (MCap Weight %)').length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/身份未解析 时间轴分布图/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ABGX' }));
    expect(screen.getByRole('dialog', { name: /ABGX 身份映射覆盖/ })).toBeInTheDocument();
    expect(screen.getByText('历史 Ticker 路径')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '建立 Mapping Overwrite' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.getByText('历史核心缺口仍保持阻塞证据。', { exact: false })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '一键忽略非核心标的' }));
    expect(await screen.findByText('Limited Ready 研究态豁免已启用')).toBeInTheDocument();
    expect(screen.getByText(/潜在 IC 扰动/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '撤销豁免' }));
    expect(screen.getByText('确认撤销研究态豁免')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'PRICE_SNAPSHOT_NOT_READY' }));
    await waitFor(() => expect(window.location.hash).toBe('#/snapshots?tab=equity&target=ds-price'));

    cleanup();
    await renderApp('#/factors');

    expect(document.querySelector('[data-page-root="factor-library"]')).not.toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: '因子库' })).toBeInTheDocument();
    expect(screen.getAllByText('12-1月截面动量排名').length).toBeGreaterThan(0);
    expect(screen.getAllByText('s_mom_12m1m_rank').length).toBeGreaterThan(0);
    expect(screen.getAllByText('s_val_ep_ltm_raw').length).toBeGreaterThan(0);
    expect(screen.getAllByText('门禁通过').length).toBeGreaterThanOrEqual(5);
    const toolbarFilters = document.querySelector('.factor-toolbar__filters');
    expect(toolbarFilters).not.toBeNull();
    expect(toolbarFilters?.querySelectorAll('select')).toHaveLength(3);
    expect(document.querySelector('.factor-diagnostic-cell__metrics')).not.toBeNull();
    expect(document.querySelector('tbody tr:first-child .factor-pill')?.textContent).toContain('已完成');
    expect(screen.getByRole('button', { name: '最近更新排序' })).toHaveClass('is-active');
    expect(document.querySelector('tbody tr:first-child .factor-link')?.textContent).toContain('252日年化波动率排名');
    expect(screen.getByLabelText('最近诊断指标解释')).toBeInTheDocument();
    expect(screen.getByText(/Rank IC: 因子排序与未来收益排序的相关性/)).toBeInTheDocument();
    expect(screen.getByLabelText('252日年化波动率排名 公式')).toBeInTheDocument();
    expect(document.querySelector('.factor-table .factor-formula')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '最近诊断排序' }));
    expect(document.querySelector('tbody tr:first-child .factor-link')?.textContent).toContain('12-1月截面动量排名');
    expect(screen.getByText('相关性热力图')).toBeInTheDocument();
    expect(screen.getByText('语义聚类 · Pearson / Rank Correlation')).toBeInTheDocument();
    expect(screen.getByLabelText('仅显示高相关对')).toBeInTheDocument();
    expect(document.querySelector('.factor-correlation__group[data-category="mom"]')).not.toBeNull();
    expect(document.querySelector('.factor-sparkline__zero')).not.toBeNull();
    expect(document.querySelector('.factor-sparkline__area--positive')).not.toBeNull();
    expect(screen.queryByText(/Rank IC: 基础字段缺失/)).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /选中相关性因子 12-1月截面动量排名/ })[0]);
    expect(document.querySelector('[data-correlation-highlight="true"]')).not.toBeNull();
    fireEvent.click(screen.getByLabelText('仅显示高相关对'));
    expect(screen.getByLabelText('仅显示高相关对')).toBeChecked();
    const compareChecks = screen.getAllByLabelText('比对');
    fireEvent.click(compareChecks[0]);
    fireEvent.click(compareChecks[1]);
    expect(screen.getAllByText('因子表现对比图').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/多头超额/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText('12-1月截面动量排名 公式')).toBeInTheDocument();
  });

  it('renders the factor detail and editor routes', async () => {
    await renderApp('#/factors/momentum_12m_1m');

    expect(document.querySelector('[data-page-root="factor-detail"]')).not.toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: '12-1月截面动量排名诊断报告' })).toBeInTheDocument();
    const verifyButton = screen.getByRole('button', { name: '保存为已验证' });
    expect(verifyButton).toHaveClass('factor-detail-action-btn', 'factor-detail-action-btn--primary');
    expect(screen.getByRole('link', { name: '生成投委会 PDF' })).toHaveClass('factor-detail-action-btn');
    expect(screen.getByText('分层收益与 IC 走势')).toBeInTheDocument();
    expect(screen.getByText('风险提示')).toBeInTheDocument();
    expect(screen.getByText('换手率与衰减')).toBeInTheDocument();
    expect(screen.getByText('合规足迹')).toBeInTheDocument();

    cleanup();
    await renderApp('#/factors/new');

    expect(document.querySelector('[data-page-root="factor-editor"]')).not.toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: '因子编辑器' })).toBeInTheDocument();
    expect(screen.getByText('5 年样本内 IC 预览')).toBeInTheDocument();
    expect(screen.getByText('m_mom_short_5d_rank')).toBeInTheDocument();
    expect(document.querySelector('[data-tooltip*="时间序列排序"]')).not.toBeNull();
  });

  it('keeps factor heatmap row accent confined to the factor column', () => {
    const css = readFileSync('src/pages/factors-page.css', 'utf8');

    expect(css).toMatch(/\.factor-table tr\.is-correlation-highlight td\s*\{[^}]*background:\s*#f5fbf8;[^}]*\}/s);
    expect(css).not.toMatch(/\.factor-table tr\.is-correlation-highlight td\s*\{[^}]*box-shadow:/s);
    expect(css).toMatch(
      /\.factor-table tr\.is-correlation-highlight td:first-child\s*\{[^}]*box-shadow:\s*inset 3px 0 0 var\(--gsl-color-primary, #1f877b\);[^}]*\}/s,
    );
  });
});

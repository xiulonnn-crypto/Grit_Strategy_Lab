import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from './app-runtime';
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
  '[data-page-root="factor-quarantine"]',
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

    expect(await screen.findByRole('heading', { level: 1, name: '数据快照' })).toBeInTheDocument();
    await waitFor(() =>
      expect(document.querySelector('[data-snapshot-id="ds-price"]')).toHaveClass('snapshots-row-card--highlight'),
    );
    expect(screen.getByRole('button', { name: '数据集快照' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders the PIT cleaning center and factor library routes', async () => {
    await renderApp('#/pit-data');

    expect(document.querySelector('[data-page-root="pit-cleaning-center"]')).not.toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: 'PIT 清洗中心' })).toBeInTheDocument();
    expect(screen.getByText('点时样本池')).toBeInTheDocument();
    expect(screen.getByText(/缺失 416 个标的/)).toBeInTheDocument();
    expect(screen.getByText('数据运维指令')).toBeInTheDocument();
    expect(screen.queryByText('Full Ready 免费源修复队列')).not.toBeInTheDocument();
    expect(screen.queryByText('补源优先级与证据层')).not.toBeInTheDocument();
    expect(screen.queryByText('外部缓存与精修就绪度')).not.toBeInTheDocument();
    expect(screen.queryByText('Zero-event 候选')).not.toBeInTheDocument();
    expect(screen.queryByText(/Price-only 来源不能单独升级 Full Ready/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重启身份修复任务' }));
    expect(screen.getByRole('dialog', { name: '身份修复任务' })).toBeInTheDocument();
    expect(screen.getByText('任务动作')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '执行重启任务' }));
    expect(await screen.findByText(/身份修复任务已执行/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭任务面板' }));
    expect(screen.getByRole('button', { name: '下钻分析' })).toBeInTheDocument();
    expect(screen.getByText('MAD 中位数偏差')).toBeInTheDocument();
    expect(screen.getByText('3σ 标准差')).toBeInTheDocument();
    expect(screen.getByText('阈值预演')).toBeInTheDocument();
    expect(screen.getByText('点时样本池年度锚点')).toBeInTheDocument();
    expect(screen.getByLabelText('样本池历史成员数量变化图')).toHaveAttribute('data-visible-row-limit', '3');
    expect(screen.getAllByText(/复权因子/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'PRICE_SNAPSHOT_NOT_READY' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '下钻分析' }));
    expect(screen.getByText('覆盖率缺口清单')).toBeInTheDocument();
    expect(screen.getAllByText('市值权重占比').length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/身份未解析 时间轴分布图/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ABGX' }));
    expect(screen.getByRole('dialog', { name: /ABGX 身份映射覆盖/ })).toBeInTheDocument();
    expect(screen.getByText('历史代码路径')).toBeInTheDocument();
    expect(screen.getByText(/身份映射覆盖 · ABGX/)).toBeInTheDocument();
    expect(screen.getByLabelText('标准代码')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '建立映射覆盖' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.getByText('历史核心缺口仍保持阻塞证据。', { exact: false })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '一键忽略非核心标的' }));
    expect(await screen.findByText('研究豁免已启用')).toBeInTheDocument();
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
    expect(screen.getByText('诊断状态')).toBeInTheDocument();
    expect(screen.getByText('阻断 / 风险')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '因子级别排序' })).toBeInTheDocument();
    expect(screen.getAllByText(/无阻断|风险提示/).length).toBeGreaterThanOrEqual(5);
    const toolbarFilters = document.querySelector('.factor-toolbar__filters');
    expect(toolbarFilters).not.toBeNull();
    expect(toolbarFilters?.querySelectorAll('select')).toHaveLength(4);
    expect(document.querySelector('.factor-diagnostic-cell__metrics')).not.toBeNull();
    expect(document.querySelector('.factor-level-cell')).not.toBeNull();
    expect(screen.getAllByText('B').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('因子级别名词解释')).toBeInTheDocument();
    expect(screen.getByText(/先取绝对值/)).toBeInTheDocument();
    expect(screen.getByText(/S 顶级印钞机: Rank IC > 0.03, IR > 2.0/)).toBeInTheDocument();
    expect(document.querySelector('tbody tr:first-child .factor-diagnostic-state__button')?.textContent).toMatch(/稳健|待校准|失效|沙箱/);
    expect(screen.getByRole('button', { name: '最近更新排序' })).toHaveClass('is-active');
    expect(document.querySelector('tbody tr:first-child .factor-link')?.textContent).toContain('252日年化波动率排名');
    expect(screen.getByLabelText('最近诊断指标解释')).toBeInTheDocument();
    expect(screen.getByText(/Rank IC: 因子排序与未来收益排序的相关性/)).toBeInTheDocument();
    expect(screen.getByLabelText('252日年化波动率排名 公式')).toBeInTheDocument();
    expect(document.querySelector('.factor-table .factor-formula')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '最近诊断排序' }));
    expect(document.querySelector('tbody tr:first-child .factor-link')?.textContent).toContain('12-1月截面动量排名');
    fireEvent.click(screen.getByRole('button', { name: '因子级别排序' }));
    expect(screen.getByRole('button', { name: '因子级别排序' })).toHaveClass('is-active');
    fireEvent.change(screen.getByLabelText('因子级别'), { target: { value: 'D' } });
    expect(document.querySelectorAll('.factor-table tbody tr')).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('因子级别'), { target: { value: 'B' } });
    expect(document.querySelectorAll('.factor-table tbody tr').length).toBeGreaterThan(0);
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
});

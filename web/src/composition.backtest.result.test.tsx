import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

type FakeApi = {
  createCompositionBacktestRun?: ReturnType<typeof vi.fn>;
  getCompositionBacktestOrders?: ReturnType<typeof vi.fn>;
  getCompositionBacktestRun?: ReturnType<typeof vi.fn>;
};

const fakeApi = vi.hoisted<FakeApi>(() => ({}));
const { navigateToMock } = vi.hoisted(() => ({
  navigateToMock: vi.fn(),
}));

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

vi.mock('./lib/appRouteContext', () => ({
  navigateTo: navigateToMock,
}));

import {
  CompositionBacktestResultPage,
  normalizeCompositionBacktestResult,
  type CompositionBacktestResult,
  type ExportFormat,
} from './pages/composition-backtest-result-page';

afterEach(() => {
  cleanup();
  fakeApi.createCompositionBacktestRun = undefined;
  fakeApi.getCompositionBacktestOrders = undefined;
  fakeApi.getCompositionBacktestRun = undefined;
  navigateToMock.mockReset();
  vi.clearAllMocks();
});

function makeRuntimeBacktestRun(runId: string) {
  return {
    id: runId,
    run_id: runId,
    composition_id: 'comp-001',
    status: 'COMPLETED_WITH_WARNINGS',
    created_at: '2026-04-30T00:00:00.000Z',
    completed_at: '2026-04-30T00:00:01.000Z',
    request: {
      horizon_years: 10,
      period: '10Y',
      rebalance_frequency: 'quarterly',
    },
    summary: {
      annualized_return: 12.4,
      composition_name: 'QQQ网格&标普动量平衡',
      horizon_years: 10,
      max_drawdown: -8.2,
      order_count: 0,
      quality_label: 'verified_from_composition_detail_preview',
      sharpe: 1.32,
    },
    diagnostics: {
      metric_matrix: [{ annualized_return: 12.4, max_drawdown: -8.2, sharpe: 1.32 }],
      stability_verdict: '10Y stable',
      top_holdings: [],
    },
    returns_preview: makeStressReturnPreview(),
    benchmark_series: makeStressBenchmarkSeries(),
    risk_contribution_preview: [],
    rebalance_events: [],
    return_quality_summary: { fallback_used: false, notes: [] },
    source_integrity: [],
    audit_trail: [],
    order_summary: {},
    evidence: { algorithm_spec: {} },
    warnings: [],
  };
}

const emptyOrderPage = {
  evidence_label: '',
  filters: {},
  generated_from: 'composition_rebalance_events',
  items: [],
  page: 1,
  page_size: 500,
  quality_label: 'verified',
  total: 0,
};

function makeStressReturnPreview() {
  return [
    { label: '2020-02', date: '2020-02-28', portfolio_return_pct: -2, net_return_pct: -2, cumulative_return_pct: -2 },
    { label: '2020-03', date: '2020-03-31', portfolio_return_pct: -5, net_return_pct: -5, cumulative_return_pct: -6.9 },
    { label: '2020-04', date: '2020-04-30', portfolio_return_pct: 4, net_return_pct: 4, cumulative_return_pct: -3.18 },
    { label: '2020-05', date: '2020-05-31', portfolio_return_pct: 6, net_return_pct: 6, cumulative_return_pct: 2.63 },
    { label: '2022-01', date: '2022-01-31', portfolio_return_pct: -3, net_return_pct: -3, cumulative_return_pct: -0.45 },
    { label: '2022-02', date: '2022-02-28', portfolio_return_pct: -4, net_return_pct: -4, cumulative_return_pct: -4.43 },
    { label: '2022-03', date: '2022-03-31', portfolio_return_pct: 2, net_return_pct: 2, cumulative_return_pct: -2.52 },
    { label: '2025-01', date: '2025-01-31', portfolio_return_pct: -4, net_return_pct: -4, cumulative_return_pct: 7.6 },
    { label: '2025-02', date: '2025-02-28', portfolio_return_pct: -5, net_return_pct: -5, cumulative_return_pct: 2.22 },
    { label: '2025-03', date: '2025-03-31', portfolio_return_pct: -6, net_return_pct: -6, cumulative_return_pct: -3.91 },
  ];
}

function makeStressBenchmarkSeries() {
  return [
    { label: '2020-02', date: '2020-02-28', benchmark_return_pct: -6, cumulative_return_pct: -6 },
    { label: '2020-03', date: '2020-03-31', benchmark_return_pct: -12, cumulative_return_pct: -17.28 },
    { label: '2020-04', date: '2020-04-30', benchmark_return_pct: 7, cumulative_return_pct: -11.49 },
    { label: '2020-05', date: '2020-05-31', benchmark_return_pct: 10, cumulative_return_pct: -2.34 },
    { label: '2022-01', date: '2022-01-31', benchmark_return_pct: -7, cumulative_return_pct: -9.18 },
    { label: '2022-02', date: '2022-02-28', benchmark_return_pct: -8, cumulative_return_pct: -16.44 },
    { label: '2022-03', date: '2022-03-31', benchmark_return_pct: 3, cumulative_return_pct: -13.93 },
    { label: '2025-01', date: '2025-01-31', benchmark_return_pct: -8, cumulative_return_pct: 4.2 },
    { label: '2025-02', date: '2025-02-28', benchmark_return_pct: -7, cumulative_return_pct: -3.09 },
    { label: '2025-03', date: '2025-03-31', benchmark_return_pct: -6, cumulative_return_pct: -8.9 },
  ];
}

describe('CompositionBacktestResultPage', () => {
  it('uses the live detail title, reruns with toast state, and opens composition allocation config by default', async () => {
    let resolveRerun!: (value: ReturnType<typeof makeRuntimeBacktestRun>) => void;
    const rerunPromise = new Promise<ReturnType<typeof makeRuntimeBacktestRun>>((resolve) => {
      resolveRerun = resolve;
    });
    fakeApi.getCompositionBacktestRun = vi.fn().mockResolvedValue(makeRuntimeBacktestRun('run-live'));
    fakeApi.getCompositionBacktestOrders = vi.fn().mockResolvedValue(emptyOrderPage);
    fakeApi.createCompositionBacktestRun = vi.fn().mockReturnValue(rerunPromise);

    render(<CompositionBacktestResultPage compositionId="comp-001" runId="run-live" />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'QQQ网格&标普动量平衡 · 回测详情' }),
    ).toBeInTheDocument();
    const stressPanel = document.querySelector<HTMLElement>('[data-ui="backtest-stress-test"]');
    expect(stressPanel).not.toBeNull();
    expect(within(stressPanel!).getByRole('heading', { level: 2, name: '压力窗口 · 极端行情压力测试' })).toBeInTheDocument();
    expect(within(stressPanel!).getByText('历史最差三个月')).toBeInTheDocument();
    expect(within(stressPanel!).getByText('2020 疫情冲击')).toBeInTheDocument();
    expect(within(stressPanel!).getByText('2022 紧缩熊市')).toBeInTheDocument();
    expect(within(stressPanel!).getByText('-14.27%')).toBeInTheDocument();
    expect(within(stressPanel!).getAllByText('相对抗跌')).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: '启动优化' }));
    expect(navigateToMock).toHaveBeenCalledWith('/compositions/comp-001/allocation-lab');

    fireEvent.click(screen.getByRole('button', { name: '重跑回测' }));
    expect(await screen.findByRole('status')).toHaveTextContent('回测中');
    expect(screen.getByRole('button', { name: '回测中' })).toBeDisabled();
    expect(fakeApi.createCompositionBacktestRun).toHaveBeenCalledWith(
      'comp-001',
      expect.objectContaining({
        horizon_years: 10,
        idempotency_key: expect.stringContaining('composition-backtest-rerun:comp-001:run-live:'),
        period: '10Y',
      }),
    );

    resolveRerun(makeRuntimeBacktestRun('run-rerun'));
    expect(await screen.findByRole('status')).toHaveTextContent('回测结束');
    expect(navigateToMock).toHaveBeenCalledWith('/compositions/comp-001/backtest-runs/run-rerun');
  });

  it('renders the A3 diagnosis surface with top actions and production copy', () => {
    const rerun = vi.fn();
    const optimize = vi.fn();

    render(
      <CompositionBacktestResultPage
        compositionId="comp-sleeve"
        onRerunBacktest={rerun}
        onStartOptimization={optimize}
        runId="run-a3"
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: '组合回测结果' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重跑回测' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '启动优化' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重跑回测' }));
    fireEvent.click(screen.getByRole('button', { name: '启动优化' }));
    expect(rerun).toHaveBeenCalledWith('comp-sleeve', 'run-a3');
    expect(optimize).toHaveBeenCalledWith('comp-sleeve', 'run-a3');

    expect(screen.getByRole('tab', { name: /诊断/, selected: true })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /订单/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /证据/ })).toBeInTheDocument();
    expect(screen.getByText('稳定性裁决：10Y 稳定，20Y 需复核')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '核心指标' })).toBeInTheDocument();
    expect(screen.getByLabelText('核心回测指标')).toHaveTextContent('年化收益');
    expect(screen.getByLabelText('核心回测指标')).toHaveTextContent('最大回撤');
    expect(screen.getByRole('heading', { level: 2, name: '绩效指标矩阵' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Sleeve 贡献归因' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '敞口热力图' })).toBeInTheDocument();
    expect(screen.getAllByText(/压力窗口/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/修复周期/).length).toBeGreaterThan(0);
    expect(screen.getByText('数据置信度')).toBeInTheDocument();
    expect(screen.getAllByText(/效率/).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 2, name: 'Top 5 穿透风险' })).toBeInTheDocument();
    expect(screen.getAllByText(/NVDA/).length).toBeGreaterThan(0);
    expect(screen.getByText(/20Y 指标含 SPY 代理覆盖说明/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('高保真稿');
    expect(document.body.textContent).not.toContain('静态设计稿');
    expect(document.body.textContent).not.toContain('不直接连接运行时');
    expect(document.body.textContent).not.toContain('Route Intent');
    expect(document.body.textContent).not.toContain('当前路径');
    expect(document.body.textContent).not.toContain('10Y / 年化');
  });

  it('compresses long exposure evidence into a semantic heatmap tooltip', () => {
    render(
      <CompositionBacktestResultPage
        compositionId="comp-sleeve"
        data={{
          diagnosis: {
            exposure_heatmap: [
              {
                key: 'exposure-live',
                period: '2022-Q1',
                alpha_pct: 28,
                qqq_pct: 14,
                tbill_pct: 46,
                cash_pct: 12,
                detail: 'Simulated from quarterly cadence using aligned leg return streams.',
              },
            ],
          },
        }}
        runId="run-a3"
      />,
    );

    expect(screen.getByText('定期平衡')).toBeInTheDocument();
    expect(screen.getByLabelText('敞口热力图审计说明')).toHaveAttribute(
      'title',
      '按季度节奏和已对齐的腿收益流模拟。',
    );
    expect(document.body.textContent).not.toContain('季度再平衡 (模拟)');
    expect(document.body.textContent).not.toContain('Simulated from quarterly cadence using aligned leg return streams.');
  });

  it('jumps from diagnosis to orders, supports event view, netting dialog, export, and ledger filters', () => {
    const exportLedger = vi.fn((_format: ExportFormat, _result: CompositionBacktestResult) => undefined);
    const { container } = render(
      <CompositionBacktestResultPage
        compositionId="comp-sleeve"
        onExportLedger={exportLedger}
        runId="run-a3"
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: '查看订单明细' })[1]);
    expect(screen.getByRole('tab', { name: /订单/, selected: true })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '调仓事件' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '穿透订单' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '调仓效率' })).toBeInTheDocument();
    expect(container.querySelector('tr.is-highlighted')?.textContent).toContain('QQQ');

    fireEvent.click(screen.getByRole('button', { name: '内部对冲 42%' }));
    const dialog = screen.getByRole('dialog', { name: '内部对冲明细' });
    expect(within(dialog).getByText('原始卖出需求')).toBeInTheDocument();
    expect(within(dialog).getByText('原始买入需求')).toBeInTheDocument();
    expect(within(dialog).getByText('内部撮合数量')).toBeInTheDocument();
    expect(within(dialog).getByText('最终外部成交数量')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));

    fireEvent.click(screen.getByRole('button', { name: '导出全量明细' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Excel' }));
    expect(exportLedger).toHaveBeenCalledTimes(1);
    expect(exportLedger.mock.calls[0][0]).toBe('excel');

    fireEvent.click(screen.getByRole('button', { name: '查看全量流水' }));
    expect(screen.getByRole('heading', { level: 2, name: '全量流水' })).toBeInTheDocument();
    const ledgerTable = container.querySelector('.composition-backtest-ledger-table') as HTMLTableElement;
    expect(ledgerTable).toBeTruthy();
    expect(within(ledgerTable).getByText('时间')).toBeInTheDocument();
    expect(within(ledgerTable).getByText('标的')).toBeInTheDocument();
    expect(within(ledgerTable).getByText('方向')).toBeInTheDocument();
    expect(within(ledgerTable).getByText('数量')).toBeInTheDocument();
    expect(within(ledgerTable).getByText('成交价')).toBeInTheDocument();
    expect(within(ledgerTable).getByText('滑点(bps)')).toBeInTheDocument();
    expect(within(ledgerTable).getByText('手续费($)')).toBeInTheDocument();
    expect(within(ledgerTable).getByText('来源腿')).toBeInTheDocument();
    expect(within(ledgerTable).getByText('触发原因')).toBeInTheDocument();

    const sourceFilterGroup = screen.getByRole('group', { name: '来源腿过滤' });
    const symbolFilterGroup = screen.getByRole('group', { name: '标的过滤' });
    expect(
      sourceFilterGroup.compareDocumentPosition(symbolFilterGroup) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const ledgerBody = ledgerTable.querySelector('tbody') as HTMLTableSectionElement;
    expect(within(ledgerBody).getAllByText('QQQ').length).toBeGreaterThan(0);
    expect(within(ledgerBody).getByText('NVDA')).toBeInTheDocument();

    fireEvent.click(within(sourceFilterGroup).getByRole('button', { name: 'Alpha Core' }));
    expect(within(symbolFilterGroup).getByRole('button', { name: 'NVDA' })).toBeInTheDocument();
    expect(within(symbolFilterGroup).getByRole('button', { name: 'MSFT' })).toBeInTheDocument();
    expect(within(symbolFilterGroup).queryByRole('button', { name: 'QQQ' })).not.toBeInTheDocument();
    expect(within(ledgerBody).getByText('NVDA')).toBeInTheDocument();
    expect(within(ledgerBody).getByText('MSFT')).toBeInTheDocument();
    expect(within(ledgerBody).queryByText('QQQ')).not.toBeInTheDocument();

    fireEvent.click(within(symbolFilterGroup).getByRole('button', { name: 'NVDA' }));
    expect(within(ledgerBody).getByText('NVDA')).toBeInTheDocument();
    expect(within(ledgerBody).queryByText('MSFT')).not.toBeInTheDocument();
  });

  it('renders evidence sections and accepts a broad local data shape without central types', () => {
    const custom = {
      title: '机构组合回测',
      status_chips: [{ label: '已完成' }],
      diagnosis: {
        stability_ruling: '稳定性裁决：10Y 通过',
        performance_matrix: [
          {
            key: 'custom-return',
            label: '年化收益',
            ten_year: '9.1%',
            twenty_year: '8.0%',
            thirty_year: '不足',
            conclusion: '样本稳定。',
          },
        ],
      },
      orders: {
        rebalance_events: [
          {
            id: 'custom-event',
            title: '2026-03-31 定期再平衡',
            total_amount: '$20K',
            friction_cost: '3 bps',
            trigger_reason: '季度再平衡',
            effectiveness: '+0.2pt',
          },
        ],
      },
      evidence: {
        cards: [
          { id: 'config', title: 'Frozen Config', body: '组合 v2.0 已冻结。', tone: 'good' },
          { id: 'footprint', title: 'Data Footprint', body: '价格序列已锁定。', tone: 'info' },
          { id: 'proxy', title: 'Proxy Logs', body: '无关键代理缺口。', tone: 'neutral' },
          { id: 'algo', title: 'Algorithm Spec', body: '季度再平衡。', tone: 'neutral' },
        ],
        proxy_logs: [{ id: 'proxy-row', period: '2020', missing_sleeve: '无', proxy: '无', correlation: '1.00', usage: '记录' }],
        audit_trail: [{ id: 'audit-row', title: '算法锁定', body: '参数已冻结。' }],
      },
    };

    const normalized = normalizeCompositionBacktestResult(custom, { compositionId: 'comp-custom', runId: 'run-custom' });
    expect(normalized.title).toBe('机构组合回测');
    expect(normalized.events[0].title).toBe('2026-03-31 定期再平衡');

    render(
      <CompositionBacktestResultPage
        compositionId="comp-custom"
        data={custom}
        initialTab="evidence"
        runId="run-custom"
      />,
    );

    expect(screen.getByRole('tab', { name: /证据/, selected: true })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: '机构组合回测' })).toBeInTheDocument();
    expect(screen.getByText('配置冻结')).toBeInTheDocument();
    expect(screen.getByText('数据足迹')).toBeInTheDocument();
    expect(screen.getAllByText('代理日志').length).toBeGreaterThan(0);
    expect(screen.getByText('算法规则')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '审计轨迹' })).toBeInTheDocument();
    expect(screen.getByText('算法锁定')).toBeInTheDocument();
  });

  it('does not refill explicit runtime empty arrays with example order data', () => {
    const normalized = normalizeCompositionBacktestResult(
      {
        title: '真实组合回测',
        diagnosis: {
          stability_ruling: '真实数据待补齐',
          performance_matrix: [],
          sleeve_contributions: [],
          exposure_heatmap: [],
          stress_scenarios: [],
          top_holdings: [],
          insights: [],
        },
        orders: {
          events: [],
          full_ledger: [],
          rebalance_efficiency: [],
        },
        evidence: {
          cards: [],
          proxy_logs: [],
          audit_trail: [],
        },
      },
      { compositionId: 'comp-empty', runId: 'run-empty' },
    );

    expect(normalized.events).toEqual([]);
    expect(normalized.ledgerRows).toEqual([]);
    expect(normalized.efficiencyRows).toEqual([]);
    expect(normalized.concentrationTop5).toEqual([]);
    expect(normalized.stressScenarios).toEqual([]);
    expect(JSON.stringify(normalized)).not.toContain('NVDA');
    expect(JSON.stringify(normalized)).not.toContain('order-2024-qqq');
  });
});

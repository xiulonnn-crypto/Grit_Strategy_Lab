import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CompositionBacktestResultPage,
  normalizeCompositionBacktestResult,
  type CompositionBacktestResult,
  type ExportFormat,
} from './pages/composition-backtest-result-page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CompositionBacktestResultPage', () => {
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
    expect(screen.getByRole('heading', { level: 2, name: '绩效指标矩阵' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Sleeve 贡献归因' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Exposure Heatmap' })).toBeInTheDocument();
    expect(screen.getByText(/Stress Period Zoom/)).toBeInTheDocument();
    expect(screen.getByText(/Time to Recovery/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Top 5 穿透风险' })).toBeInTheDocument();
    expect(screen.getAllByText(/NVDA/).length).toBeGreaterThan(0);
    expect(screen.getByText(/20Y 指标含 SPY 代理覆盖说明/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('高保真稿');
    expect(document.body.textContent).not.toContain('静态设计稿');
    expect(document.body.textContent).not.toContain('不直接连接运行时');
    expect(document.body.textContent).not.toContain('Route Intent');
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
    expect(screen.getByRole('heading', { level: 2, name: 'Rebalance Events' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Look-through Orders' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Rebalance Efficiency' })).toBeInTheDocument();
    expect(container.querySelector('tr.is-highlighted')?.textContent).toContain('QQQ');

    fireEvent.click(screen.getByRole('button', { name: '内部对冲 42%' }));
    const dialog = screen.getByRole('dialog', { name: 'Internal Netting 明细' });
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
    expect(screen.getByRole('heading', { level: 2, name: 'Full Ledger' })).toBeInTheDocument();
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

    const ledgerBody = ledgerTable.querySelector('tbody') as HTMLTableSectionElement;
    expect(within(ledgerBody).getAllByText('QQQ').length).toBeGreaterThan(0);
    expect(within(ledgerBody).queryByText('NVDA')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'NVDA' }));
    expect(within(ledgerBody).getByText('NVDA')).toBeInTheDocument();
    expect(within(ledgerBody).queryByText('QQQ')).not.toBeInTheDocument();
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
    expect(screen.getByText('Frozen Config')).toBeInTheDocument();
    expect(screen.getByText('Data Footprint')).toBeInTheDocument();
    expect(screen.getAllByText('Proxy Logs').length).toBeGreaterThan(0);
    expect(screen.getByText('Algorithm Spec')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Audit Trail' })).toBeInTheDocument();
    expect(screen.getByText('算法锁定')).toBeInTheDocument();
  });
});

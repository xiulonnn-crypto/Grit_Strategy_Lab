import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiStrategyDetail } from './types';

let StrategyDetailPage: typeof import('./pages/strategy-detail-page').StrategyDetailPage;

const HISTORY_OPEN_LABEL = '\u67e5\u770b\u53c2\u6570';
const HISTORY_DETAIL_TITLE = '\u7248\u672c\u53c2\u6570\u660e\u7ec6';
const HISTORY_RESTORE_LABEL = '\u56de\u6eda';
const RESTORE_DIALOG_TITLE = '\u786e\u8ba4\u56de\u6eda\u53c2\u6570\u7248\u672c';
const DECISION_NOTE_LABEL = '\u51b3\u7b56\u8bf4\u660e';
const CLOSE_LABEL = '\u5173\u95ed';

const fakeApi = vi.hoisted(() => ({
  createCreationSession: vi.fn(),
  listBacktestRuns: vi.fn(),
  getStrategyDetail: vi.fn(),
  getBacktestRunDetail: vi.fn(),
  restoreStrategyParameterVersion: vi.fn(),
})) as {
  createCreationSession: ReturnType<typeof vi.fn>;
  listBacktestRuns: ReturnType<typeof vi.fn>;
  getStrategyDetail: ReturnType<typeof vi.fn>;
  getBacktestRunDetail: ReturnType<typeof vi.fn>;
  restoreStrategyParameterVersion: ReturnType<typeof vi.fn>;
};

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

const strategy: ApiStrategyDetail = {
  id: 'strat-001',
  name: 'Strategy Alpha',
  description: 'Mean reversion strategy on QQQ.',
  strategy_type: 'MEAN_REVERSION',
  universe_name: 'QQQ',
  benchmark_symbol: 'QQQ',
  rebalance_frequency: 'never',
  lifecycle_status: 'ACTIVE',
  current_parameter_version: 2,
  current_parameter_version_id: 'pv-002',
  latest_successful_run_id: 'run-001',
  latest_run_id: 'run-001',
  latest_optimization_job_id: 'opt-001',
  dataset_snapshot_id: 'ds-001',
  universe_snapshot_id: null,
  created_at: '2026-03-23T08:44:00Z',
  updated_at: '2026-03-27T16:20:00Z',
  parameters: {
    strategy_description: 'Mean reversion strategy on QQQ.',
    trading_logic: 'Buy 5% when RSI(6) < 30 and sell 5% when RSI(6) > 80.',
    benchmark_symbol: 'QQQ',
    observation_timeframe: 'daily',
    weighting_method: 'equal_weight',
    hold_rank_threshold: 120,
    rebalance_anchor_dates: '每年01月第1个交易日；07月第1个交易日',
    bollinger_period: 20,
    rsi_period: 6,
    atr_period: 14,
    take_profit_atr: 1.5,
    stop_loss_atr: 1,
    long_entry_size_pct: 5,
    short_entry_size_pct: 5,
  },
  parameter_history: [
    {
      version_number: 2,
      parameter_version_id: 'pv-002',
      revision: 2,
      created_at: '2026-03-23T08:44:00Z',
      parameters: { bollinger_period: 20, rsi_period: 6 },
      comment: 'Promoted after tuning the current settings.',
      change_summary: 'RSI 周期 8→6\n布林周期 18→20',
      decision_note: '保留更短 RSI 周期，因为最近两次样本外窗口回撤更低。',
      source: {
        kind: 'optimization',
        job_id: 'opt-001',
        candidate_id: 'cand-002',
        run_id: 'run-001',
        source_parameter_version_id: 'pv-002',
      },
      alternative_versions: [
        { parameter_version_id: 'pv-001', label: '保守基线' },
      ],
      rollbackable: true,
    },
    {
      version_number: 1,
      parameter_version_id: 'pv-001',
      revision: 1,
      created_at: '2026-03-20T08:44:00Z',
      parameters: { observation_timeframe: 'daily', rsi_period: 8 },
      comment: 'Initial import.',
      change_summary: '初始导入参数。',
      decision_note: '作为人工确认的原始基线，适合在新版本异常时恢复。',
      source: {
        kind: 'optimization_candidate',
        job_id: 'opt-000',
        run_id: 'run-000',
        candidate_id: 'cand-007',
        source_parameter_version_id: 'pv-000',
      },
      alternative_versions: [
        { parameter_version_id: 'pv-000', label: '导入前版本' },
        { parameter_version_id: 'pv-002', label: 'pv-002' },
      ],
      rollbackable: true,
    },
  ],
  confirmation_fields: { top_level: [], parameters: [] },
  allowed_actions: ['run_backtest', 'open_optimization', 'edit_parameters'],
};

const recentRuns = [
  {
    id: 'run-001',
    strategy_id: 'strat-001',
    strategy_name: 'Strategy Alpha',
    status: 'COMPLETED',
    start_date: '2025-01-01',
    end_date: '2026-03-27',
    completed_at: '2026-03-27T17:20:00Z',
    parameter_version_id: 'pv-002',
    metrics: {
      total_return: 0.126,
      annualized_return: 0.094,
      sharpe: 1.14,
      max_drawdown: -0.082,
    },
  },
  {
    id: 'run-000',
    strategy_id: 'strat-001',
    strategy_name: 'Strategy Alpha',
    status: 'COMPLETED_WITH_WARNINGS',
    start_date: '2024-01-01',
    end_date: '2025-12-31',
    completed_at: '2026-03-20T17:20:00Z',
    parameter_version_id: 'pv-001',
    metrics: {
      total_return: -0.031,
      annualized_return: -0.021,
      sharpe: 0.44,
      max_drawdown: -0.11,
    },
  },
] as const;

const DYNAMIC_DCA_LOGIC =
  '读取QQQ滚动10年PE(TTM)百分位：极度高估>90%乘0.5x；温和高估70%-90%乘0.8x；合理区间30%-70%乘1.0x；低估区间10%-30%乘1.5x；极度低估<10%乘2.0x';

beforeEach(() => {
  vi.resetModules();
  fakeApi.createCreationSession.mockReset();
  fakeApi.listBacktestRuns.mockReset();
  fakeApi.getStrategyDetail.mockReset();
  fakeApi.getBacktestRunDetail.mockReset();
  fakeApi.restoreStrategyParameterVersion.mockReset();
  fakeApi.createCreationSession.mockResolvedValue({ id: 'cs-revision-001' });
  fakeApi.listBacktestRuns.mockResolvedValue(recentRuns);
  fakeApi.getStrategyDetail.mockResolvedValue(strategy);
  fakeApi.getBacktestRunDetail.mockResolvedValue(recentRuns[0]);
  fakeApi.restoreStrategyParameterVersion.mockResolvedValue(strategy);
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('StrategyDetailPage', () => {
  it('renders multi-factor current parameters with canonical Chinese factor names', async () => {
    fakeApi.getStrategyDetail.mockResolvedValue({
      ...strategy,
      id: 'strat-mf-001',
      name: '多因子策略',
      strategy_type: 'MULTI_FACTOR',
      rebalance_frequency: 'quarterly',
      parameters: {
        strategy_type: 'MULTI_FACTOR',
        rebalance_frequency: 'quarterly',
        factor_ids: ['a_mom_ret_126d_z', 's_alpha_ffblend_cur_rank'],
        weights: {
          a_mom_ret_126d_z: 80,
          s_alpha_ffblend_cur_rank: 20,
        },
        directions: {
          a_mom_ret_126d_z: 'HIGH_IS_BETTER',
          s_alpha_ffblend_cur_rank: 'HIGH_IS_BETTER',
        },
        neutralization: {
          enabled: true,
          method: 'industry',
          execution_status: 'EXECUTED',
        },
        scoring_method: 'zscore_weighted',
        strategy_creation_risk: { warning_count: 7 },
        factor_weight__a_mom_ret_126d_z_pct: 80,
        factor_weight__s_alpha_ffblend_cur_rank_pct: 20,
        neutralization_method: 'industry',
        top_n: 50,
        holding_count: 50,
      },
      parameter_history: [
        {
          version_number: 1,
          parameter_version_id: 'pv-mf-001',
          revision: 1,
          created_at: '2026-05-12T08:44:00Z',
          parameters: {
            factor_ids: ['a_mom_ret_126d_z', 's_alpha_ffblend_cur_rank'],
            weights: {
              a_mom_ret_126d_z: 80,
              s_alpha_ffblend_cur_rank: 20,
            },
            directions: {
              a_mom_ret_126d_z: 'HIGH_IS_BETTER',
              s_alpha_ffblend_cur_rank: 'HIGH_IS_BETTER',
            },
            neutralization: {
              enabled: true,
              method: 'industry',
              execution_status: 'EXECUTED',
            },
            factor_weight__a_mom_ret_126d_z_pct: 80,
            factor_weight__s_alpha_ffblend_cur_rank_pct: 20,
            strategy_creation_risk: { warning_count: 7 },
          },
          comment: 'Initial import.',
          change_summary:
            'factor weight  a mom ret 126d z pct 82→80\nfactor weight  s alpha ffblend cur rank pct 18→20\nweights 已配置→已配置\nneutralization method 空→industry\nscoring method 空→zscore_weighted\nholding count 空→50',
          decision_note: '多因子模型创建',
          rollbackable: false,
        },
      ],
    } satisfies ApiStrategyDetail);
    ({ StrategyDetailPage } = await import('./pages/strategy-detail-page'));

    render(<StrategyDetailPage strategyId="strat-mf-001" />);

    expect(await screen.findByText('多因子策略')).toBeInTheDocument();
    expect(screen.getAllByText(/ZScore-126日收益率 \(精炼\)/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/GSL-多因子全能动力/).length).toBeGreaterThan(0);
    expect(screen.getByText('再平衡')).toBeInTheDocument();
    expect(screen.getAllByText('每季度').length).toBeGreaterThan(0);
    expect(screen.getByText('因子权重 · ZScore-126日收益率 (精炼)')).toBeInTheDocument();
    expect(screen.getByText('因子权重 · GSL-多因子全能动力')).toBeInTheDocument();
    expect(screen.getByText('因子权重 · ZScore-126日收益率 (精炼) 82→80')).toBeInTheDocument();
    expect(screen.getByText('因子权重 · GSL-多因子全能动力 18→20')).toBeInTheDocument();
    expect(screen.getByText('权重方案 已配置→已配置')).toBeInTheDocument();
    expect(screen.getByText('中性化方法 空→行业中性')).toBeInTheDocument();
    expect(screen.getByText('打分方法 空→标准化加权')).toBeInTheDocument();
    expect(screen.getByText('实际持仓数量 空→50')).toBeInTheDocument();
    expect(screen.getByText('标准化加权')).toBeInTheDocument();
    expect(screen.getByText(/已执行/)).toBeInTheDocument();
    expect(screen.getAllByText('持仓数量').length).toBeGreaterThan(0);
    expect(screen.getByText('实际持仓数量')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('a_mom_ret_126d_z');
    expect(document.body.textContent).not.toContain('s_alpha_ffblend_cur_rank');
    expect(document.body.textContent).not.toContain('factor_weight__');
    expect(document.body.textContent).not.toContain('factor weight');
    expect(document.body.textContent).not.toContain('neutralization method');
    expect(document.body.textContent).not.toContain('zscore_weighted');
    expect(document.body.textContent).not.toContain('Z-Score 加权');
    expect(document.body.textContent).not.toContain('strategy creation risk');
    expect(document.body.textContent).not.toContain('EXECUTED');

    fireEvent.click(screen.getByRole('button', { name: HISTORY_OPEN_LABEL }));
    const dialog = await screen.findByRole('dialog', { name: HISTORY_DETAIL_TITLE });
    expect(dialog.textContent).toContain('因子权重 · ZScore-126日收益率 (精炼)');
    expect(dialog.textContent).toContain('因子权重 · GSL-多因子全能动力');
    expect(dialog.textContent).toContain('权重方案 已配置→已配置');
    expect(dialog.textContent).toContain('中性化方法 空→行业中性');
    expect(dialog.textContent).toContain('打分方法 空→标准化加权');
    expect(dialog.textContent).toContain('标准化加权');
    expect(dialog.textContent).toContain('已执行');
    expect(dialog.textContent).not.toContain('a_mom_ret_126d_z');
    expect(dialog.textContent).not.toContain('s_alpha_ffblend_cur_rank');
    expect(dialog.textContent).not.toContain('factor_weight__');
    expect(dialog.textContent).not.toContain('factor weight');
    expect(dialog.textContent).not.toContain('neutralization method');
    expect(dialog.textContent).not.toContain('zscore_weighted');
    expect(dialog.textContent).not.toContain('Z-Score 加权');
    expect(dialog.textContent).not.toContain('EXECUTED');
  });

  it('renders the detail layout, opens a revision session, shows recent runs on a timeline, and opens the latest optimization result', async () => {
    ({ StrategyDetailPage } = await import('./pages/strategy-detail-page'));
    const { container } = render(<StrategyDetailPage strategyId="strat-001" />);

    await waitFor(() => expect(fakeApi.getStrategyDetail).toHaveBeenCalledWith('strat-001'));
    expect(container.querySelector('.strategy-detail-page')).not.toBeNull();
    expect(container.querySelector('.strategy-detail-history-table')).not.toBeNull();
    expect(container.querySelector('.strategy-detail-parameter-card--logic')).not.toBeNull();
    expect(container.querySelector('.workspace-recent-runs__timeline')).not.toBeNull();
    expect(container.querySelector('.strategy-detail-hero__meta')).toBeNull();
    const summary = container.querySelector('.strategy-detail-hero__summary');
    expect(summary).not.toBeNull();
    expect(summary?.textContent).toContain('QQQ');
    expect(summary?.textContent).toContain('RSI(6)');
    expect(summary?.textContent).toContain('5%');
    expect(screen.getByText('权重方式')).toBeInTheDocument();
    expect(screen.getByText('等权')).toBeInTheDocument();
    expect(screen.getByText('保留排名阈值')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.queryByText('120%')).not.toBeInTheDocument();
    expect(screen.getByText('调仓锚点')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '版本' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '变更摘要' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '决策说明' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '操作（查看参数、回滚）' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '参数版本编号' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '更新时间' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '来源' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '回滚状态' })).not.toBeInTheDocument();
    expect(screen.getByText('RSI 周期 8→6')).toBeInTheDocument();
    expect(screen.getByText('布林周期 18→20')).toBeInTheDocument();
    expect(screen.getByText('初始导入参数。')).toBeInTheDocument();
    expect(screen.queryByText('当前版本')).not.toBeInTheDocument();
    expect(screen.queryByText('可回滚')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '修订' })).not.toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.getByText('v1')).toBeInTheDocument();
    expect(screen.queryByText('pv-002')).not.toBeInTheDocument();
    expect(screen.queryByText('pv-001')).not.toBeInTheDocument();
    expect(await screen.findByText('2025/01/01 - 2026/03/27')).toBeInTheDocument();
    expect(screen.getByText('2026/03/27')).toBeInTheDocument();
    expect(screen.getByText('年化 +9.4%')).toBeInTheDocument();
    expect(screen.getByText('夏普 1.14')).toBeInTheDocument();
    expect(screen.getByText('回撤 -8.2%')).toBeInTheDocument();
    expect(screen.queryByText('总收益 +12.6%')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '返回工作台' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: HISTORY_RESTORE_LABEL })).toHaveLength(1);

    const historyButtons = await screen.findAllByRole('button', { name: HISTORY_OPEN_LABEL });
    fireEvent.click(historyButtons[1]);

    const dialog = await screen.findByRole('dialog', { name: HISTORY_DETAIL_TITLE });
    expect(dialog.textContent).not.toContain('pv-001');
    expect(within(dialog).getByRole('heading', { name: 'v1' })).toBeInTheDocument();
    expect(dialog.textContent).not.toContain('RSI 周期 8→6');
    expect(dialog.textContent).toContain('作为人工确认的原始基线，适合在新版本异常时恢复。');
    expect(dialog.textContent).toContain('优化作业');
    expect(dialog.textContent).toContain('opt-000');
    expect(dialog.textContent).toContain('run-000');
    expect(dialog.textContent).toContain('cand-007');
    expect(dialog.textContent).toContain('pv-000');
    expect(dialog.textContent).toContain('替代版本');
    expect(dialog.textContent).toContain('导入前版本');
    expect(dialog.textContent).toContain('日线');

    fireEvent.click(within(dialog).getByRole('button', { name: CLOSE_LABEL }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: HISTORY_DETAIL_TITLE })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: '运行回测' }));
    await waitFor(() => expect(window.location.hash).toBe('#/strategies/strat-001/backtest-runs/new'));

    fireEvent.click(screen.getByRole('button', { name: '修改策略' }));
    await waitFor(() =>
      expect(fakeApi.createCreationSession).toHaveBeenCalledWith({
        strategy_type: 'MEAN_REVERSION',
        mode: 'REVISION',
        base_strategy_id: 'strat-001',
        base_parameter_version_id: 'pv-002',
      }),
    );
    await waitFor(() => expect(window.location.hash).toBe('#/creation/sessions/cs-revision-001'));

    fireEvent.click(screen.getByRole('button', { name: '打开优化' }));
    await waitFor(() => expect(window.location.hash).toBe('#/optimization-jobs/opt-001'));
  });

  it('restores a rollbackable historical parameter version after decision-note confirmation', async () => {
    ({ StrategyDetailPage } = await import('./pages/strategy-detail-page'));
    const restoredStrategy: ApiStrategyDetail = {
      ...strategy,
      current_parameter_version: 3,
      current_parameter_version_id: 'pv-003',
      parameter_history: [
        {
          version_number: 3,
          parameter_version_id: 'pv-003',
          revision: 3,
          created_at: '2026-03-28T08:44:00Z',
          parameters: { observation_timeframe: 'daily', rsi_period: 8 },
          comment: 'Restored from pv-001.',
          change_summary: '已恢复到初始基线。',
          decision_note: '恢复初始基线，等待新优化重跑。',
          source: {
            kind: 'restore',
            source_parameter_version_id: 'pv-001',
            base_parameter_version_id: 'pv-002',
          },
          alternative_versions: [{ parameter_version_id: 'pv-002', label: '回滚前版本' }],
          rollbackable: false,
        },
        ...strategy.parameter_history,
      ],
    };
    fakeApi.restoreStrategyParameterVersion.mockResolvedValueOnce(restoredStrategy);

    render(<StrategyDetailPage strategyId="strat-001" />);
    await waitFor(() => expect(fakeApi.getStrategyDetail).toHaveBeenCalledWith('strat-001'));

    fireEvent.click(screen.getByRole('button', { name: HISTORY_RESTORE_LABEL }));
    const dialog = await screen.findByRole('dialog', { name: RESTORE_DIALOG_TITLE });
    expect(dialog.textContent).toContain('目标版本');
    expect(dialog.textContent).toContain('v1');
    expect(dialog.textContent).toContain('当前基准');
    expect(dialog.textContent).toContain('v2');
    expect(dialog.textContent).not.toContain('pv-001');
    expect(dialog.textContent).not.toContain('pv-002');
    expect(dialog.textContent).not.toContain('候选摘要');

    fireEvent.change(within(dialog).getByLabelText(DECISION_NOTE_LABEL), {
      target: { value: '恢复初始基线，等待新优化重跑。' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认回滚' }));

    await waitFor(() => expect(fakeApi.restoreStrategyParameterVersion).toHaveBeenCalledTimes(1));
    expect(fakeApi.restoreStrategyParameterVersion).toHaveBeenCalledWith(
      'strat-001',
      'pv-001',
      expect.objectContaining({
        base_parameter_version_id: 'pv-002',
        decision_note: '恢复初始基线，等待新优化重跑。',
      }),
    );
    expect(fakeApi.restoreStrategyParameterVersion.mock.calls[0][2].idempotency_key).toMatch(/^restore-strat-001-pv-001-/);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: RESTORE_DIALOG_TITLE })).toBeNull());
    expect(screen.getByText('已恢复到初始基线。')).toBeInTheDocument();
  });

  it('renders missing or garbled parameter-history decision notes as dashes', async () => {
    ({ StrategyDetailPage } = await import('./pages/strategy-detail-page'));
    fakeApi.getStrategyDetail.mockResolvedValue({
      ...strategy,
      parameter_history: [
        {
          ...strategy.parameter_history[0],
          decision_note: '????????????',
        },
        {
          ...strategy.parameter_history[1],
          decision_note: '未记录决策说明。',
        },
      ],
    });

    const { container } = render(<StrategyDetailPage strategyId="strat-001" />);
    await waitFor(() => expect(fakeApi.getStrategyDetail).toHaveBeenCalledWith('strat-001'));

    const decisionCells = Array.from(container.querySelectorAll('.strategy-detail-history-table__decision')).map((cell) => cell.textContent);
    expect(decisionCells).toEqual(['-', '-']);
    expect(container.textContent).not.toContain('????????????');
    expect(container.textContent).not.toContain('未记录决策说明。');

    const historyButtons = await screen.findAllByRole('button', { name: HISTORY_OPEN_LABEL });
    fireEvent.click(historyButtons[0]);

    const dialog = await screen.findByRole('dialog', { name: HISTORY_DETAIL_TITLE });
    expect(within(dialog).getByText('-')).toBeInTheDocument();
    expect(dialog.textContent).not.toContain('????????????');
    expect(dialog.textContent).not.toContain('未记录决策说明。');
  });

  it('keeps the parameter history summary column readable inside the two-column strategy layout', () => {
    const css = readFileSync('src/pages/strategy-detail-page.css', 'utf8');

    expect(css).toMatch(
      /\.strategy-detail-history-table th:nth-child\(1\),\s*\.strategy-detail-history-table td:nth-child\(1\)\s*\{[^}]*width:\s*92px;/s,
    );
    expect(css).toMatch(
      /\.strategy-detail-history-table th:nth-child\(2\),\s*\.strategy-detail-history-table td:nth-child\(2\)\s*\{[^}]*width:\s*238px;/s,
    );
    expect(css).toMatch(
      /\.strategy-detail-history-table th:nth-child\(3\),\s*\.strategy-detail-history-table td:nth-child\(3\)\s*\{[^}]*width:\s*120px;/s,
    );
    expect(css).toMatch(
      /\.strategy-detail-history-table th:nth-child\(4\),\s*\.strategy-detail-history-table td:nth-child\(4\)\s*\{[^}]*width:\s*108px;/s,
    );
    expect(css).not.toMatch(/\.strategy-detail-history-table__version\s*\{[^}]*display:\s*grid;/s);
    expect(css).toMatch(/\.strategy-detail-history-table__version-stack\s*\{[^}]*display:\s*grid;[^}]*gap:\s*4px;/s);
    expect(css).toMatch(/\.strategy-detail-history-table__summary\s*\{[^}]*font-size:\s*0\.92rem;[^}]*line-height:\s*1\.5;/s);
    expect(css).toMatch(/\.strategy-detail-multiline-text\s*\{[^}]*gap:\s*3px;/s);
  });

  it('opens the config step when no latest optimization job exists', async () => {
    ({ StrategyDetailPage } = await import('./pages/strategy-detail-page'));
    fakeApi.getStrategyDetail.mockResolvedValue({
      ...strategy,
      latest_optimization_job_id: null,
    });

    const { container } = render(<StrategyDetailPage strategyId="strat-001" />);
    await waitFor(() => expect(container.querySelector('.strategy-detail-page')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: '打开优化' }));
    await waitFor(() =>
      expect(window.location.hash).toBe('#/optimization-jobs/new/config?strategy_id=strat-001&entry_point=strategy_detail'),
    );
  });

  it('summarizes dynamic buy-and-hold strategies and renders the extracted logic cards', async () => {
    ({ StrategyDetailPage } = await import('./pages/strategy-detail-page'));
    fakeApi.getStrategyDetail.mockResolvedValue({
      ...strategy,
      name: 'QQQ 动态定投策略',
      description: '',
      strategy_type: 'BUY_AND_HOLD',
      universe_name: 'QQQ',
      benchmark_symbol: 'QQQ',
      latest_optimization_job_id: null,
      parameters: {
        strategy_description: `围绕QQQ执行月度定投，每期基准买入1000USD，按每月第一个交易日执行，${DYNAMIC_DCA_LOGIC}。`,
        benchmark_symbol: 'QQQ',
        contribution_amount: 1000,
        investment_frequency: 'monthly',
        contribution_anchor: '每月第一个交易日',
        dynamic_investment_logic: DYNAMIC_DCA_LOGIC,
        dynamic_investment_proxy_key: 'nasdaq100',
        dynamic_investment_metric_key: 'pe_ttm_percentile_10y',
        dynamic_investment_rules: [{ min_percentile: 90, max_percentile: 100, multiplier: 0.5 }],
      },
      parameter_history: [
        {
          version_number: 1,
          parameter_version_id: 'pv-dca-001',
          revision: 1,
          created_at: '2026-04-24T08:44:00Z',
          parameters: {
            contribution_amount: 1000,
            investment_frequency: 'monthly',
          },
          comment: 'Initial import.',
        },
      ],
    });

    const { container } = render(<StrategyDetailPage strategyId="strat-001" />);

    await waitFor(() => expect(container.querySelector('.strategy-detail-page')).not.toBeNull());
    const summary = container.querySelector('.strategy-detail-hero__summary');
    expect(summary?.textContent).toContain('QQQ');
    expect(summary?.textContent).toContain('每月基准定投 1,000 美元');
    expect(summary?.textContent).toContain('按每月第一个交易日执行');
    expect(summary?.textContent).toContain('按估值区间动态调整投入倍率');
    expect(screen.getByText('定投执行锚点')).toBeInTheDocument();
    expect(screen.getByText('每月第一个交易日')).toBeInTheDocument();
    expect(screen.getByText('动态定投逻辑')).toBeInTheDocument();
    expect(screen.getByText(DYNAMIC_DCA_LOGIC)).toBeInTheDocument();
    expect(screen.queryByText('dynamic_investment_proxy_key')).not.toBeInTheDocument();
    expect(screen.queryByText('dynamic_investment_metric_key')).not.toBeInTheDocument();
    expect(screen.queryByText('dynamic_investment_rules')).not.toBeInTheDocument();
  });
});

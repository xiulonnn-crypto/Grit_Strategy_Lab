import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreationSessionPage } from './pages/creation-session-page';
import { CreationTemplatePage } from './pages/creation-template-page';
import type { ApiStrategyCreationSession } from './types';

type FakeApi = {
  appendCreationMessage: ReturnType<typeof vi.fn>;
  createCreationSession: ReturnType<typeof vi.fn>;
  getCreationSession: ReturnType<typeof vi.fn>;
  materializeStrategy: ReturnType<typeof vi.fn>;
  prepareConfirmation: ReturnType<typeof vi.fn>;
  updateConfirmation: ReturnType<typeof vi.fn>;
};

const fakeApi = vi.hoisted<FakeApi>(() => ({
  appendCreationMessage: vi.fn(),
  createCreationSession: vi.fn(),
  getCreationSession: vi.fn(),
  materializeStrategy: vi.fn(),
  prepareConfirmation: vi.fn(),
  updateConfirmation: vi.fn(),
}));

vi.mock('./lib/demoStoreContext', () => ({ useApiClient: () => fakeApi }));

const GRID_PROMPT = '本金10000，初始买入QQQ20%仓位，每下跌5%买入10%，每上涨10%卖出10%';
const GRID_DESCRIPTION = '本金10000，围绕QQQ执行网格交易，初始仓位20%，每下跌5%买入10%，每上涨10%卖出10%。';

function buildGridSession({
  revision = 1,
  ready = false,
  messages,
  includeAllFields = true,
}: {
  revision?: number;
  ready?: boolean;
  messages?: ApiStrategyCreationSession['messages'];
  includeAllFields?: boolean;
} = {}): ApiStrategyCreationSession {
  const baseParameters = [
    { key: 'strategy_name', label: '策略名称', value: 'QQQ 网格交易策略', source: 'system_inference' },
    { key: 'strategy_description', label: '策略描述', value: GRID_DESCRIPTION, source: 'system_inference' },
    { key: 'benchmark_symbol', label: '基准', value: 'SPY', source: 'system_default' },
    { key: 'initial_position', label: '初始仓位(%)', value: 20, source: 'user_input' },
    { key: 'grid_interval', label: '下跌间距(%)', value: 5, source: 'user_input' },
    { key: 'buy_size_pct', label: '下跌买入仓位(%)', value: 10, source: 'user_input' },
    { key: 'sell_step_pct', label: '上涨间距(%)', value: 10, source: 'user_input' },
    { key: 'sell_size_pct', label: '上涨卖出仓位(%)', value: 10, source: 'user_input' },
    {
      key: 'max_stop_loss_pct',
      label: '最大止损仓位(%)',
      value: ready ? -4 : '',
      source: ready ? 'manual_override' : 'system_default',
    },
    { key: 'capital', label: '本金', value: 10000, source: 'user_input' },
  ];

  return {
    id: 'cs-001',
    status: ready ? 'READY_FOR_CONFIRMATION' : 'NEEDS_INPUT',
    revision,
    top_level: {
      strategy_type: 'GRID',
      universe_name: 'QQQ',
      rebalance_frequency: 'never',
    },
    messages:
      messages ??
      [
        {
          id: 'msg-001',
          role: 'user',
          content: GRID_PROMPT,
          created_at: '2026-04-02 12:42',
          extracted_tags: [
            { key: 'strategy_name', label: '策略名称', value: 'QQQ 网格交易策略', status: 'synced' },
            { key: 'strategy_description', label: '策略描述', value: GRID_DESCRIPTION, status: 'synced' },
            { key: 'universe_name', label: '股票池', value: 'QQQ', status: 'synced' },
            { key: 'initial_position', label: '初始仓位(%)', value: '20', status: 'synced' },
            { key: 'grid_interval', label: '下跌间距(%)', value: '5', status: 'synced' },
            { key: 'buy_size_pct', label: '下跌买入仓位(%)', value: '10', status: 'synced' },
            { key: 'sell_step_pct', label: '上涨间距(%)', value: '10', status: 'synced' },
            { key: 'sell_size_pct', label: '上涨卖出仓位(%)', value: '10', status: 'synced' },
          ],
        },
      ],
    pending_inputs: ready
      ? []
      : [{ key: 'max_stop_loss_pct', label: '最大止损仓位(%)', message: '请补充最大止损仓位(%)' }],
    manual_conflicts: [],
    confirmation_fields: {
      top_level: [
        { key: 'strategy_type', label: '策略类型', value: 'GRID', source: 'user_input' },
        { key: 'universe_name', label: '股票池', value: 'QQQ', source: 'user_input' },
        { key: 'rebalance_frequency', label: '再平衡频次', value: 'never', source: 'system_default' },
      ],
      parameters: includeAllFields
        ? baseParameters
        : baseParameters.filter(
            (field) =>
              !['strategy_name', 'strategy_description', 'benchmark_symbol', 'max_stop_loss_pct'].includes(field.key),
          ),
    },
  };
}

function buildRevisionGridSession(): ApiStrategyCreationSession {
  return {
    ...buildGridSession({ revision: 2, ready: true }),
    mode: 'REVISION',
    base_strategy_id: 'strat-001',
    base_parameter_version_id: 'pv-002',
  };
}

function buildDraftGridSession(): ApiStrategyCreationSession {
  return {
    id: 'cs-001',
    status: 'NEEDS_INPUT',
    revision: 1,
    top_level: {
      strategy_type: 'GRID',
      universe_name: '',
      rebalance_frequency: 'never',
    },
    messages: [],
    pending_inputs: [
      { key: 'universe_name', label: '股票池', message: '请补充股票池' },
      { key: 'initial_position', label: '初始仓位(%)', message: '请补充初始仓位(%)' },
      { key: 'strategy_description', label: '策略描述', message: '请补充策略描述' },
      { key: 'max_stop_loss_pct', label: '最大止损仓位(%)', message: '请补充最大止损仓位(%)' },
    ],
    manual_conflicts: [],
    confirmation_fields: {
      top_level: [
        { key: 'strategy_type', label: '策略类型', value: 'GRID', source: 'system_default' },
        { key: 'universe_name', label: '股票池', value: '', source: 'system_default' },
        { key: 'rebalance_frequency', label: '再平衡频次', value: 'never', source: 'system_default' },
      ],
      parameters: [
        { key: 'strategy_name', label: '策略名称', value: '网格交易策略', source: 'system_default' },
        { key: 'strategy_description', label: '策略描述', value: '', source: 'system_default' },
        { key: 'benchmark_symbol', label: '基准', value: 'SPY', source: 'system_default' },
        { key: 'initial_position', label: '初始仓位(%)', value: '', source: 'system_default' },
        { key: 'grid_interval', label: '下跌间距(%)', value: '', source: 'system_default' },
        { key: 'buy_size_pct', label: '下跌买入仓位(%)', value: '', source: 'system_default' },
        { key: 'sell_step_pct', label: '上涨间距(%)', value: '', source: 'system_default' },
        { key: 'sell_size_pct', label: '上涨卖出仓位(%)', value: '', source: 'system_default' },
        { key: 'max_stop_loss_pct', label: '最大止损仓位(%)', value: '', source: 'system_default' },
      ],
    },
  };
}

function buildDcaSession(): ApiStrategyCreationSession {
  return {
    id: 'cs-dca',
    status: 'READY_FOR_CONFIRMATION',
    revision: 1,
    top_level: {
      strategy_type: 'BUY_AND_HOLD',
      universe_name: 'QQQ',
      rebalance_frequency: 'never',
    },
    messages: [
      {
        id: 'msg-dca-001',
        role: 'user',
        content: 'QQQ月度定投策略\n每月第一个交易日买入QQQ1000USD',
        created_at: '2026-04-08 09:24',
        extracted_tags: [
          { key: 'strategy_name', label: '策略名称', value: 'QQQ 月度定投策略', status: 'synced' },
          { key: 'strategy_description', label: '策略描述', value: '围绕QQQ执行月度定投，每期买入1000USD，按每期首个交易日执行。', status: 'synced' },
          { key: 'universe_name', label: '股票池', value: 'QQQ', status: 'synced' },
          { key: 'contribution_amount', label: '定投金额(USD)', value: '1000', status: 'synced' },
          { key: 'investment_frequency', label: '定投频率', value: 'monthly', status: 'synced' },
        ],
      },
    ],
    pending_inputs: [],
    manual_conflicts: [],
    confirmation_fields: {
      top_level: [
        { key: 'strategy_type', label: '策略类型', value: 'BUY_AND_HOLD', source: 'user_input' },
        { key: 'universe_name', label: '股票池', value: 'QQQ', source: 'user_input' },
        { key: 'rebalance_frequency', label: '再平衡频次', value: 'never', source: 'system_default' },
      ],
      parameters: [
        { key: 'strategy_name', label: '策略名称', value: 'QQQ 月度定投策略', source: 'system_inference' },
        { key: 'strategy_description', label: '策略描述', value: '围绕QQQ执行月度定投，每期买入1000USD，按每期首个交易日执行。', source: 'system_inference' },
        { key: 'benchmark_symbol', label: '基准', value: 'QQQ', source: 'system_inference' },
        { key: 'contribution_amount', label: '定投金额(USD)', value: 1000, source: 'user_input' },
        { key: 'investment_frequency', label: '定投频率', value: 'monthly', source: 'user_input' },
      ],
    },
  };
}

function buildMeanReversionSession(): ApiStrategyCreationSession {
  return {
    id: 'cs-mr',
    status: 'READY_FOR_CONFIRMATION',
    revision: 1,
    top_level: {
      strategy_type: 'MEAN_REVERSION',
      universe_name: 'QQQ',
      rebalance_frequency: 'never',
    },
    messages: [
      {
        id: 'msg-mr-001',
        role: 'user',
        content:
          'QQQ均值回归策略 观察QQQ日线，通过 20 日布林带 + 6 周期 RSI 识别超买超卖，结合 14 周期 ATR 动态止损止盈 1、开仓：当前空仓且收盘价 跌破布林带下轨且RSI(6) ＜ 30时买入5%，当前空仓且收盘价 突破布林带上轨且RSI(6) > 80时卖出5% 2、盈利达到 1.5 倍 ATR时止盈，亏损达到 1 倍 ATR止损 初始100000刀',
        created_at: '2026-04-10 14:18',
        extracted_tags: [
          { key: 'strategy_name', label: '策略名称', value: 'QQQ均值回归策略', status: 'synced' },
          { key: 'universe_name', label: '股票池', value: 'QQQ', status: 'synced' },
          { key: 'observation_timeframe', label: '观察周期', value: 'daily', status: 'synced' },
          { key: 'bollinger_period', label: '布林带周期', value: '20', status: 'synced' },
          { key: 'rsi_period', label: 'RSI周期', value: '6', status: 'synced' },
          { key: 'rsi_buy_threshold', label: 'RSI超卖阈值', value: '30', status: 'synced' },
          { key: 'rsi_sell_threshold', label: 'RSI超买阈值', value: '80', status: 'synced' },
          { key: 'atr_period', label: 'ATR周期', value: '14', status: 'synced' },
          { key: 'take_profit_atr', label: '止盈倍数(ATR)', value: '1.5', status: 'synced' },
          { key: 'stop_loss_atr', label: '止损倍数(ATR)', value: '1', status: 'synced' },
          { key: 'long_entry_size_pct', label: '买入仓位(%)', value: '5', status: 'synced' },
          { key: 'short_entry_size_pct', label: '卖出仓位(%)', value: '5', status: 'synced' },
          { key: 'capital', label: '初始资金(USD)', value: '100000', status: 'synced' },
        ],
      },
    ],
    pending_inputs: [],
    manual_conflicts: [],
    confirmation_fields: {
      top_level: [
        { key: 'strategy_type', label: '策略类型', value: 'MEAN_REVERSION', source: 'system_default' },
        { key: 'universe_name', label: '股票池', value: 'QQQ', source: 'user_input' },
        { key: 'rebalance_frequency', label: '再平衡频次', value: 'never', source: 'system_default' },
      ],
      parameters: [
        { key: 'strategy_name', label: '策略名称', value: 'QQQ均值回归策略', source: 'user_input' },
        {
          key: 'strategy_description',
          label: '策略描述',
          value:
            '观察QQQ日线，执行均值回归交易，使用20日布林带、RSI(6)、ATR(14)识别超买超卖与动态风控，空仓时跌破布林带下轨且RSI(6)<30买入5%；空仓时突破布林带上轨且RSI(6)>80卖出5%，1.5倍ATR止盈，1倍ATR止损。',
          source: 'system_inference',
        },
        { key: 'benchmark_symbol', label: '基准', value: 'QQQ', source: 'system_inference' },
        { key: 'observation_timeframe', label: '观察周期', value: 'daily', source: 'user_input' },
        {
          key: 'trading_logic',
          label: '交易逻辑',
          value:
            '观察QQQ日线；使用20日布林带 + RSI(6)识别超买超卖；结合ATR(14)动态止盈止损；空仓时跌破布林带下轨且RSI(6)<30买入5%；空仓时突破布林带上轨且RSI(6)>80卖出5%；1.5倍ATR止盈，1倍ATR止损',
          source: 'system_inference',
        },
        { key: 'bollinger_period', label: '布林带周期', value: 20, source: 'user_input' },
        { key: 'rsi_period', label: 'RSI周期', value: 6, source: 'user_input' },
        { key: 'rsi_buy_threshold', label: 'RSI超卖阈值', value: 30, source: 'user_input' },
        { key: 'rsi_sell_threshold', label: 'RSI超买阈值', value: 80, source: 'user_input' },
        { key: 'atr_period', label: 'ATR周期', value: 14, source: 'user_input' },
        { key: 'take_profit_atr', label: '止盈倍数(ATR)', value: 1.5, source: 'user_input' },
        { key: 'stop_loss_atr', label: '止损倍数(ATR)', value: 1, source: 'user_input' },
        { key: 'long_entry_size_pct', label: '买入仓位(%)', value: 5, source: 'user_input' },
        { key: 'short_entry_size_pct', label: '卖出仓位(%)', value: 5, source: 'user_input' },
        { key: 'capital', label: '初始资金(USD)', value: 100000, source: 'user_input' },
      ],
    },
  };
}

function buildMomentumSession(): ApiStrategyCreationSession {
  return {
    id: 'cs-mom',
    status: 'READY_FOR_CONFIRMATION',
    revision: 1,
    top_level: {
      strategy_type: 'MOMENTUM',
      universe_name: '标普500成分股',
      rebalance_frequency: 'semiannual',
    },
    messages: [
      {
        id: 'msg-mom-001',
        role: 'user',
        content:
          '标普动量策略\n每年1月第1个交易日和7月第一个交易日（每半年1次）\n取标普成分股，前12个月-前1个月的总收益率排行前100名，买入或保留持仓；若不在前120名，移除持仓\n持仓比例按数量均分仓位\n初始100000刀',
        created_at: '2026-04-09 15:30',
        extracted_tags: [
          { key: 'strategy_name', label: '策略名称', value: '标普动量策略', status: 'synced' },
          { key: 'top_n', label: '买入排名阈值', value: '100', status: 'synced' },
          { key: 'hold_rank_threshold', label: '保留排名阈值', value: '120', status: 'synced' },
          { key: 'weighting_method', label: '权重方法', value: 'equal_weight', status: 'synced' },
        ],
      },
    ],
    pending_inputs: [],
    manual_conflicts: [],
    confirmation_fields: {
      top_level: [
        { key: 'strategy_type', label: '策略类型', value: 'MOMENTUM', source: 'user_input' },
        { key: 'universe_name', label: '股票池', value: '标普500成分股', source: 'user_input' },
        { key: 'rebalance_frequency', label: '调仓频率', value: 'semiannual', source: 'user_input' },
      ],
      parameters: [
        { key: 'strategy_name', label: '策略名称', value: '标普动量策略', source: 'user_input' },
        { key: 'strategy_description', label: '策略描述', value: '在标普500成分股内做横截面动量轮动，每半年按每年01月第1个交易日；07月第1个交易日调仓，按前12个月剔除最近1个月收益排序，买入或保留前100名，跌出前120名移除，持仓按数量等权分配，初始资金100000USD。', source: 'system_inference' },
        { key: 'benchmark_symbol', label: '基准', value: 'SPY', source: 'system_inference' },
        { key: 'capital', label: '初始资金(USD)', value: 100000, source: 'user_input' },
        { key: 'lookback_months', label: '动量回看(月)', value: 12, source: 'user_input' },
        { key: 'skip_recent_months', label: '跳过最近(月)', value: 1, source: 'user_input' },
        { key: 'top_n', label: '买入排名阈值', value: 100, source: 'user_input' },
        { key: 'hold_rank_threshold', label: '保留排名阈值', value: 120, source: 'user_input' },
        { key: 'weighting_method', label: '权重方法', value: 'equal_weight', source: 'user_input' },
        { key: 'rebalance_anchor_dates', label: '调仓锚点', value: '每年01月第1个交易日；07月第1个交易日', source: 'user_input' },
      ],
    },
  };
}

beforeEach(() => {
  fakeApi.appendCreationMessage.mockReset();
  fakeApi.createCreationSession.mockReset();
  fakeApi.getCreationSession.mockReset();
  fakeApi.materializeStrategy.mockReset();
  fakeApi.prepareConfirmation.mockReset();
  fakeApi.updateConfirmation.mockReset();
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('creation flow', () => {
  it('creates a creation session from the template page', async () => {
    fakeApi.createCreationSession.mockResolvedValue({ id: 'cs-001' });

    render(<CreationTemplatePage />);
    fireEvent.click(screen.getAllByRole('button')[0]);

    await waitFor(() =>
      expect(fakeApi.createCreationSession).toHaveBeenCalledWith({ strategy_type: 'MOMENTUM' }),
    );
    expect(window.location.hash).toBe('#/creation/sessions/cs-001');
  });

  it('removes open-confirmation button and refreshes grid fields from sent message', async () => {
    fakeApi.getCreationSession.mockResolvedValue(buildDraftGridSession());
    fakeApi.appendCreationMessage.mockResolvedValue(buildGridSession({ revision: 2 }));

    render(<CreationSessionPage sessionId="cs-001" />);

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('网格交易策略');
    expect(screen.queryByRole('button', { name: '打开确认稿' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('消息'), { target: { value: GRID_PROMPT } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));

    await waitFor(() =>
      expect(fakeApi.appendCreationMessage).toHaveBeenCalledWith('cs-001', GRID_PROMPT, 1),
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('QQQ 网格交易策略'),
    );

    expect(screen.getByLabelText('策略名称')).toHaveValue('QQQ 网格交易策略');
    expect(screen.getByLabelText('策略描述')).toHaveValue(GRID_DESCRIPTION);
    expect(screen.getByLabelText('股票池')).toHaveValue('QQQ');
    expect(screen.getByLabelText('策略名称').closest('label')).toHaveTextContent('系统推断');
    expect(screen.getByLabelText('策略描述').closest('label')).toHaveTextContent('系统推断');
    expect(screen.getByLabelText('股票池').closest('label')).toHaveTextContent('用户输入');
    expect(screen.getByText('策略名称：QQQ 网格交易策略')).toBeInTheDocument();
    expect(screen.getByText('股票池：QQQ')).toBeInTheDocument();

    fireEvent.click(screen.getByText('选股规则').closest('button')!);

    expect(await screen.findByLabelText('初始仓位(%)')).toHaveValue('20');
    expect(screen.getByLabelText('初始仓位(%)').closest('label')).toHaveTextContent('用户输入');
    expect(screen.getByText('初始仓位(%)：20')).toBeInTheDocument();

    fireEvent.click(screen.getAllByText('风控 / 再平衡')[0].closest('button')!);
    expect(await screen.findByRole('combobox', { name: '再平衡频次' })).toHaveValue('never');
  });

  it('hydrates missing initial fields for legacy grid sessions', async () => {
    fakeApi.getCreationSession.mockResolvedValue(buildGridSession({ includeAllFields: false }));

    render(<CreationSessionPage sessionId="cs-001" />);

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('QQQ');
    expect(screen.getByLabelText('策略名称')).toHaveValue('QQQ 网格交易策略');
    expect(screen.getByLabelText('策略描述')).toHaveValue('');
    expect(screen.getByRole('combobox', { name: '基准' })).toHaveValue('SPY');

    fireEvent.click(screen.getAllByText('风控 / 再平衡')[0].closest('button')!);

    expect(await screen.findByLabelText('最大止损仓位(%)')).toHaveValue('');
    expect(screen.getByRole('combobox', { name: '再平衡频次' })).toHaveValue('never');
  });

  it('renders buy-and-hold sessions with 定投 fields instead of the generic form', async () => {
    fakeApi.getCreationSession.mockResolvedValue(buildDcaSession());

    render(<CreationSessionPage sessionId="cs-dca" />);

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('QQQ 月度定投策略');
    expect(screen.getByLabelText('策略类型')).toHaveTextContent('定投');
    expect(screen.getByLabelText('策略名称')).toHaveValue('QQQ 月度定投策略');
    expect(screen.getByLabelText('策略描述')).toHaveValue('围绕QQQ执行月度定投，每期买入1000USD，按每期首个交易日执行。');
    expect(screen.getByLabelText('股票池')).toHaveValue('QQQ');
    expect(screen.getByRole('combobox', { name: '基准' })).toHaveValue('QQQ');

    fireEvent.click(screen.getByText('选股规则').closest('button')!);

    expect(await screen.findByLabelText('定投金额(USD)')).toHaveValue('1000');
    expect(screen.getByRole('combobox', { name: '定投频率' })).toHaveValue('monthly');
    expect(screen.queryByLabelText('初始仓位(%)')).not.toBeInTheDocument();
  });

  it('renders mean-reversion sessions with the mean-reversion parameter groups', async () => {
    fakeApi.getCreationSession.mockResolvedValue(buildMeanReversionSession());

    render(<CreationSessionPage sessionId="cs-mr" />);

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('QQQ均值回归策略');
    expect(screen.getByLabelText('策略类型')).toHaveTextContent('均值回归');
    expect(screen.getByLabelText('策略名称')).toHaveValue('QQQ均值回归策略');
    expect(screen.getByRole('combobox', { name: '基准' })).toHaveValue('QQQ');

    fireEvent.click(screen.getByText('选股规则').closest('button')!);

    expect(await screen.findByRole('combobox', { name: '观察周期' })).toHaveValue('daily');
    expect((screen.getByLabelText('交易逻辑') as HTMLTextAreaElement).value).toContain('观察QQQ日线');
    expect(screen.getByLabelText('布林带周期')).toHaveValue('20');
    expect(screen.getByLabelText('RSI周期')).toHaveValue('6');
    expect(screen.getByLabelText('RSI超卖阈值')).toHaveValue('30');
    expect(screen.getByLabelText('RSI超买阈值')).toHaveValue('80');

    fireEvent.click(screen.getByText('风控 / 再平衡').closest('button')!);

    expect(await screen.findByLabelText('ATR周期')).toHaveValue('14');
    expect(screen.getByLabelText('止盈倍数(ATR)')).toHaveValue('1.5');
    expect(screen.getByLabelText('止损倍数(ATR)')).toHaveValue('1');
    expect(screen.getByRole('combobox', { name: '再平衡频次' })).toHaveValue('never');

    fireEvent.click(screen.getByText('其他参数').closest('button')!);

    expect(await screen.findByLabelText('初始资金(USD)')).toHaveValue('100000');
    expect(screen.queryByLabelText('定投金额(USD)')).not.toBeInTheDocument();
  });

  it('renders momentum sessions with the momentum-specific parameter groups', async () => {
    fakeApi.getCreationSession.mockResolvedValue(buildMomentumSession());

    render(<CreationSessionPage sessionId="cs-mom" />);

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('标普动量策略');
    expect(screen.getByLabelText('策略类型')).toHaveTextContent('动量 / 趋势跟随');
    expect(screen.getByLabelText('策略名称')).toHaveValue('标普动量策略');
    expect(screen.getByLabelText('股票池')).toHaveValue('标普500成分股');
    expect(screen.getByRole('combobox', { name: '基准' })).toHaveValue('SPY');
    expect(screen.getByLabelText('初始资金(USD)')).toHaveValue('100000');

    fireEvent.click(screen.getByText('选股规则').closest('button')!);

    expect(await screen.findByLabelText('动量回看(月)')).toHaveValue('12');
    expect(screen.getByLabelText('跳过最近(月)')).toHaveValue('1');
    expect(screen.getByLabelText('买入排名阈值')).toHaveValue('100');
    expect(screen.getByLabelText('保留排名阈值')).toHaveValue('120');
    expect(screen.getByRole('combobox', { name: '权重方法' })).toHaveValue('equal_weight');
  });

  it('deduplicates strategy type rows and keeps completion text in step tabs only', async () => {
    const duplicateSession = buildGridSession({ ready: true });
    duplicateSession.confirmation_fields!.parameters = [
      { key: 'strategy_type', label: '蝑蝐餃?', value: 'GRID', source: 'manual_override' },
      ...duplicateSession.confirmation_fields!.parameters,
    ];
    fakeApi.getCreationSession.mockResolvedValue(duplicateSession);

    render(<CreationSessionPage sessionId="cs-001" />);

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('QQQ');
    expect(screen.getAllByLabelText('策略类型')).toHaveLength(1);
    expect(screen.getAllByRole('button').filter((button) => button.textContent?.includes('已完成'))).toHaveLength(4);
  });

  it('autosaves grid edits and materializes after completion', async () => {
    fakeApi.getCreationSession.mockResolvedValue(buildGridSession());
    fakeApi.updateConfirmation.mockResolvedValue(buildGridSession({ revision: 2, ready: true }));
    fakeApi.materializeStrategy.mockResolvedValue({ id: 'strat-001' });

    render(<CreationSessionPage sessionId="cs-001" />);

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('QQQ 网格交易策略');

    fireEvent.click(screen.getAllByText('风控 / 再平衡')[0].closest('button')!);
    const stopLossInput = await screen.findByLabelText('最大止损仓位(%)');
    fireEvent.change(stopLossInput, { target: { value: '-4' } });
    fireEvent.blur(stopLossInput);

    await waitFor(() => expect(fakeApi.updateConfirmation).toHaveBeenCalledTimes(1));
    const [, payload] = fakeApi.updateConfirmation.mock.calls[0];
    expect(payload.core).toMatchObject({
      strategy_type: 'GRID',
      universe_name: 'QQQ',
      rebalance_frequency: 'never',
    });
    expect(payload.logic).toMatchObject({
      initial_position: 20,
      grid_interval: 5,
      buy_size_pct: 10,
      sell_step_pct: 10,
      sell_size_pct: 10,
      max_stop_loss_pct: -4,
    });
    expect(payload.parameters).toMatchObject({
      strategy_name: 'QQQ 网格交易策略',
      strategy_description: GRID_DESCRIPTION,
      benchmark_symbol: 'SPY',
      capital: 10000,
    });

    expect(await screen.findByRole('button', { name: '生成策略' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '生成策略' }));

    await waitFor(() =>
      expect(fakeApi.materializeStrategy).toHaveBeenCalledWith('cs-001', 'materialize-cs-001', 2),
    );
    expect(window.location.hash).toBe('#/strategies/strat-001/backtest-runs/new');
  });

  it('shows 保存新版本 for revision sessions and returns to strategy detail after saving', async () => {
    fakeApi.getCreationSession.mockResolvedValue(buildRevisionGridSession());
    fakeApi.materializeStrategy.mockResolvedValue({ id: 'strat-001' });

    render(<CreationSessionPage sessionId="cs-001" />);

    expect(await screen.findByRole('button', { name: '保存新版本' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存新版本' }));

    await waitFor(() =>
      expect(fakeApi.materializeStrategy).toHaveBeenCalledWith('cs-001', 'materialize-cs-001', 2),
    );
    expect(window.location.hash).toBe('#/strategies/strat-001');
  });

  it('prevents primary action when autosave fails', async () => {
    fakeApi.getCreationSession.mockResolvedValue(buildGridSession({ revision: 3, ready: true }));
    fakeApi.updateConfirmation.mockRejectedValue(new Error('保存失败，请重试'));

    render(<CreationSessionPage sessionId="cs-001" />);

    expect(await screen.findByRole('button', { name: '生成策略' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('策略描述'), {
      target: { value: '更新后的网格策略描述' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成确认稿' }));

    await waitFor(() => expect(fakeApi.updateConfirmation).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('保存失败，请重试')).toBeInTheDocument();
    expect(fakeApi.prepareConfirmation).not.toHaveBeenCalled();
    expect(fakeApi.materializeStrategy).not.toHaveBeenCalled();
  });
});

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

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

function buildIncompleteSession(revision = 1): ApiStrategyCreationSession {
  return {
    id: 'cs-001',
    status: 'NEEDS_INPUT',
    revision,
    messages: [
      {
        role: 'system',
        content: '请补充股票池、回看窗口、回归阈值和风险预算。',
        created_at: '2026-03-27 15:32',
      },
      {
        role: 'user',
        content: '策略围绕 QQQ 做均值回归，回撤控制需要更严格。',
        created_at: '2026-03-27 15:33',
      },
    ],
    top_level: {
      strategy_type: 'MEAN_REVERSION',
      universe_name: 'QQQ',
      rebalance_frequency: 'MONTHLY',
    },
    pending_inputs: [
      { key: 'window_size', label: '窗口大小', message: '请补充窗口大小。' },
    ],
    manual_conflicts: [
      { key: 'risk_budget', label: '风险预算', message: '请确认单笔亏损上限。' },
    ],
    confirmation_fields: {
      top_level: [
        { key: 'strategy_type', label: '策略类型', value: 'MEAN_REVERSION', source: 'assistant' },
      ],
      parameters: [
        { key: 'strategy_name', label: '策略名称', value: '', source: 'assistant' },
        { key: 'window_size', label: '窗口大小', value: '', source: 'assistant' },
        { key: 'risk_budget', label: '风险预算', value: '', source: 'manual' },
        {
          key: 'notes',
          label: '说明',
          value: '系统建议先围绕均值回归补充条件。',
          source: 'assistant',
        },
      ],
    },
  };
}

function buildReadySession(revision = 2): ApiStrategyCreationSession {
  return {
    id: 'cs-001',
    status: 'READY_TO_MATERIALIZE',
    revision,
    messages: [
      {
        role: 'system',
        content: '请补充股票池、回看窗口、回归阈值和风险预算。',
        created_at: '2026-03-27 15:32',
      },
      {
        role: 'user',
        content:
          'QQQ 均值回归策略，中枢 MA50，窗口 50，单笔亏损达到 -4% 即退出。',
        created_at: '2026-03-27 15:34',
      },
    ],
    top_level: {
      strategy_type: 'MEAN_REVERSION',
      universe_name: 'QQQ',
      rebalance_frequency: 'MONTHLY',
    },
    pending_inputs: [],
    manual_conflicts: [],
    confirmation_fields: {
      top_level: [
        { key: 'strategy_type', label: '策略类型', value: 'MEAN_REVERSION', source: 'assistant' },
      ],
      parameters: [
        {
          key: 'strategy_name',
          label: '策略名称',
          value: 'QQQ 均值回归策略',
          source: 'assistant',
        },
        { key: 'window_size', label: '窗口大小', value: 50, source: 'manual' },
        {
          key: 'risk_budget',
          label: '风险预算',
          value: '单笔亏损达到-4%',
          source: 'manual',
        },
        {
          key: 'notes',
          label: '说明',
          value: '系统建议先围绕均值回归补充条件。',
          source: 'assistant',
        },
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

describe('策略创建流程', () => {
  it('从模板页创建会话后会跳转到新会话路由', async () => {
    fakeApi.createCreationSession.mockResolvedValue({ id: 'cs-001' });

    render(<CreationTemplatePage />);

    fireEvent.click(screen.getAllByRole('button')[0]);

    await waitFor(() =>
      expect(fakeApi.createCreationSession).toHaveBeenCalledWith({ strategy_type: 'MOMENTUM' }),
    );
    expect(window.location.hash).toBe('#/creation/sessions/cs-001');
  });

  it('未完成草稿时顶部主按钮保持生成确认稿，并会调用 prepareConfirmation', async () => {
    fakeApi.getCreationSession.mockResolvedValue(buildIncompleteSession());
    fakeApi.prepareConfirmation.mockResolvedValue(buildIncompleteSession(2));

    render(<CreationSessionPage sessionId="cs-001" />);

    expect(await screen.findByRole('heading', { name: 'QQQ 均值回归策略' })).toBeInTheDocument();
    expect(screen.queryByText('草稿需要补充信息')).not.toBeInTheDocument();
    expect(screen.queryByText('请发送消息描述你的策略')).not.toBeInTheDocument();
    expect(screen.getByText('请说明你策略的交易逻辑、关键参数阈值。')).toBeInTheDocument();
    expect(screen.queryByText('由当前策略草稿驱动的模拟 LLM 对话。')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成确认稿' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '生成确认稿' }));

    await waitFor(() => expect(fakeApi.prepareConfirmation).toHaveBeenCalledWith('cs-001'));
    expect(fakeApi.materializeStrategy).not.toHaveBeenCalled();
  });

  it('字段失焦会自动保存，全部完成后主按钮切换为生成策略', async () => {
    fakeApi.getCreationSession.mockResolvedValue(buildIncompleteSession());
    fakeApi.updateConfirmation.mockResolvedValue(buildReadySession(2));
    fakeApi.materializeStrategy.mockResolvedValue({ id: 'strat-001' });

    render(<CreationSessionPage sessionId="cs-001" />);

    expect(await screen.findByRole('heading', { name: 'QQQ 均值回归策略' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '应用确认稿' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /基础配置/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /选股规则/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /风控 \/ 再平衡/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /其他参数/ })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('请说明...')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /选股规则/ }));
    const windowInput = await screen.findByLabelText('窗口大小');
    fireEvent.change(windowInput, { target: { value: '50' } });
    fireEvent.blur(windowInput);

    await waitFor(() =>
      expect(fakeApi.updateConfirmation).toHaveBeenCalledWith('cs-001', {
        revision: 1,
        core: { strategy_type: 'MEAN_REVERSION' },
        logic: { risk_budget: null, window_size: 50 },
        parameters: {
          strategy_name: null,
          notes: '系统建议先围绕均值回归补充条件。',
        },
      }),
    );

    expect(await screen.findByRole('button', { name: '生成策略' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '生成策略' }));

    await waitFor(() =>
      expect(fakeApi.materializeStrategy).toHaveBeenCalledWith(
        'cs-001',
        'materialize-cs-001',
        2,
      ),
    );
    expect(window.location.hash).toBe('#/strategies/strat-001/backtest-runs/new');
  });

  it('自动保存失败时会保留本地输入并阻止继续生成策略', async () => {
    fakeApi.getCreationSession.mockResolvedValue(buildReadySession(3));
    fakeApi.updateConfirmation.mockRejectedValue(new Error('保存失败：网络抖动'));

    render(<CreationSessionPage sessionId="cs-001" />);

    expect(await screen.findByRole('button', { name: '生成策略' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('策略名称'), {
      target: { value: 'QQQ 均值回归策略 V2' },
    });

    expect(await screen.findByRole('button', { name: '生成确认稿' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '生成确认稿' }));

    await waitFor(() => expect(fakeApi.updateConfirmation).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('保存失败：网络抖动')).toBeInTheDocument();
    expect(screen.getAllByText('保存失败').length).toBeGreaterThan(0);
    expect(fakeApi.prepareConfirmation).not.toHaveBeenCalled();
    expect(fakeApi.materializeStrategy).not.toHaveBeenCalled();
  });
});

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CompositionBacktestRunsIndexPage,
  CompositionLabIndexPage,
  CompositionListIndexPage,
} from './pages/composition-global-index-page';
import type {
  ApiCompositionGlobalAllocationJobListItem,
  ApiCompositionGlobalBacktestRunListItem,
  ApiCompositionListItem,
  ApiCompositionStatusDiagnosis,
} from './types';

type FakeApi = {
  listCompositions?: ReturnType<typeof vi.fn>;
  listCompositionBacktestRuns?: ReturnType<typeof vi.fn>;
  listCompositionAllocationJobs?: ReturnType<typeof vi.fn>;
  refreshCompositionDiagnostics?: ReturnType<typeof vi.fn>;
  refreshCompositionSourceFreezes?: ReturnType<typeof vi.fn>;
  confirmCompositionProxy?: ReturnType<typeof vi.fn>;
};

const fakeApi = vi.hoisted<FakeApi>(() => ({
  listCompositions: vi.fn(),
  listCompositionBacktestRuns: vi.fn(),
  listCompositionAllocationJobs: vi.fn(),
  refreshCompositionDiagnostics: vi.fn(),
  refreshCompositionSourceFreezes: vi.fn(),
  confirmCompositionProxy: vi.fn(),
}));

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

const stableDiagnosis: ApiCompositionStatusDiagnosis = {
  status: '稳健',
  issue_type: '证据链完整',
  diagnosis_type: 'evidence_chain_complete',
  diagnosis_label: '稳健：证据链完整',
  frontend_explanation: '当前组合的收益、来源和冻结记录都可以追溯。',
  action: '查看详情或继续回测/配置实验。',
  resolution_criteria: '无需处理。',
  actions: [],
};

const proxyDiagnosis: ApiCompositionStatusDiagnosis = {
  status: '待校准',
  issue_type: '代理覆盖待确认',
  diagnosis_type: 'proxy_confirmation_required',
  diagnosis_label: '待校准：代理覆盖待确认',
  frontend_explanation: '当前使用了代理历史，但系统没有找到已登记代理关系，也没有本组合确认记录。',
  action: '确认代理关系，或替换来源。',
  resolution_criteria: '保存确认后，同一代理方案不再提醒。',
  actions: [
    { label: '确认代理关系', action_key: 'confirm_proxy_coverage', action_kind: 'execute' },
    { label: '替换来源', action_key: 'open_composition_workbench', action_kind: 'open_new_tab', route: '/compositions/workbench?composition_id=cmp-002' },
  ],
  proxy_context: [
    {
      leg_id: 'leg-qqq',
      target_symbol: 'QQQ',
      proxy_symbol: '未登记代理',
      horizon_label: '2015-07:2025-06',
      proxy_signature: 'proxy::QQQ::UNREGISTERED::test',
      proxy_source: 'unconfirmed',
      coverage_window: { start: '2015-07', end: '2025-06' },
      explanation: '当前使用了代理历史，但没有找到系统登记或本组合确认记录。',
    },
  ],
};

const sampleDurationDiagnosis: ApiCompositionStatusDiagnosis = {
  status: '待校准',
  issue_type: '收益样本窗口不足',
  diagnosis_type: 'return_sample_window_short',
  diagnosis_label: '待校准：收益样本窗口不足',
  frontend_explanation: '当前组合可对齐的月度收益样本只有 72 个月（约 6 年），低于 10 年验证门槛 120 个月。',
  action: '回组合工作台替换或补齐更长历史来源；短窗口回测只用于复核，不是补足样本。',
  resolution_criteria: '组合月度收益样本达到 120 个月以上；短窗口回测只能作为待校准复核，不会关闭该状态。',
  actions: [
    {
      label: '调整来源样本',
      action_key: 'open_composition_workbench',
      action_kind: 'open_new_tab',
      route: '/compositions/workbench?composition_id=cmp-short',
    },
    {
      label: '按短样本配置回测',
      action_key: 'open_backtest_config',
      action_kind: 'open_new_tab',
      route: '/compositions/cmp-short/backtest-runs/new',
    },
  ],
};

const failedDiagnosis: ApiCompositionStatusDiagnosis = {
  status: '失效',
  issue_type: '异常降级补值',
  diagnosis_type: 'abnormal_fallback',
  diagnosis_label: '失效：异常降级补值',
  frontend_explanation: '当前不是计划内代理，而是临时估算或异常补值。',
  action: '修复数据来源或更换成分。',
  resolution_criteria: '不再依赖异常估算。',
  actions: [{ label: '刷新诊断', action_key: 'refresh_diagnostics', action_kind: 'execute' }],
  system_disposition: '存在未关闭的失效问题，晋升门禁已暂停。',
};

const sourceLogicDriftDiagnosis: ApiCompositionStatusDiagnosis = {
  status: '待校准',
  issue_type: '逻辑一致性漂移',
  diagnosis_type: 'source_logic_drift',
  diagnosis_label: '待校准：逻辑一致性漂移',
  frontend_explanation: '当前来源内容和保存时冻结记录不一致。',
  action: '先查看来源证据；确认当前来源正确后重新冻结，否则回工作台回滚或替换来源。',
  resolution_criteria: '当前来源指纹已重新冻结，或组合已回滚到冻结记录。',
  actions: [
    { label: '确认并重新冻结来源指纹', action_key: 'refresh_source_freezes', action_kind: 'execute' },
    {
      label: '查看来源证据',
      action_key: 'inspect_source_evidence',
      action_kind: 'open_new_tab',
      route: '/compositions/composition_630718a64821',
    },
    {
      label: '打开组合工作台',
      action_key: 'open_composition_workbench',
      action_kind: 'open_new_tab',
      route: '/compositions/workbench?composition_id=composition_630718a64821',
    },
  ],
};

const compositions: ApiCompositionListItem[] = [
  {
    id: 'cmp-001',
    name: '全天候研究组合',
    status: 'ACTIVE',
    composition_score: 84,
    leg_count: 4,
    rebalance_frequency: '季度再平衡',
    benchmark_label: '60/40',
    version_label: 'v6',
    version_status_label: '冻结版本',
    evidence_grade: 'A',
    evidence_label: '稳健：证据链完整',
    primary_diagnosis: stableDiagnosis,
    diagnoses: [stableDiagnosis],
    latest_backtest_label: '10Y 稳定',
    latest_backtest_detail: '最大回撤 -9.4%',
    backtest_period_coverage: [
      { period: '10Y', status: 'covered', run_id: 'comp-run-001', label: '10Y 已覆盖' },
      { period: '20Y', status: 'missing', label: '20Y 待补齐' },
      { period: '30Y', status: 'missing', label: '30Y 待补齐' },
    ],
    allocation_lab_label: 'Risk Parity',
    allocation_lab_detail: '候选可晋升',
    pending_decision_count: 1,
    promotion_candidate_count: 1,
    annualized_return: 0.082,
    sharpe: 1.21,
    max_drawdown: -0.094,
    updated_at: '2026-04-30T08:00:00.000Z',
    latest_activity_label: '候选等待晋升审查',
    allowed_actions: ['open_composition_workbench'],
    source_integrity: [],
  },
  {
    id: 'cmp-002',
    name: 'QQQ网格&标普动量平衡',
    status: 'ACTIVE',
    composition_score: 73,
    leg_count: 3,
    rebalance_frequency: '月度再平衡',
    benchmark_label: 'QQQ',
    version_label: 'v5',
    version_status_label: '冻结版本',
    evidence_grade: 'B',
    evidence_label: '待校准：代理覆盖待确认',
    primary_diagnosis: proxyDiagnosis,
    diagnoses: [proxyDiagnosis],
    backtest_period_coverage: [
      { period: '10Y', status: 'covered', run_id: 'comp-run-002', label: '10Y 已覆盖' },
      { period: '20Y', status: 'missing', label: '20Y 待补齐' },
      { period: '30Y', status: 'missing', label: '30Y 待补齐' },
    ],
    annualized_return: 0.114,
    sharpe: 1.06,
    max_drawdown: -0.168,
    updated_at: '2026-04-29T08:00:00.000Z',
    latest_activity_label: '2022 压力窗口需复盘',
    allowed_actions: ['open_composition_workbench'],
    has_new_version: true,
    source_integrity: [
      {
        leg_id: 'leg-qqq',
        display_name: 'QQQ 防守腿',
        source_ref_id: 'strategy_leg::strat-qqq::v3',
        freeze_hash: 'hash-v3',
        signature_status: 'stale',
        drift_status: 'version_drift',
        current_ref_id: 'strategy_leg::strat-qqq::v3',
        checked_at: '2026-04-30T08:00:00.000Z',
        alerts: ['Current source version differs from the frozen source signature.'],
      },
    ],
  },
  {
    id: 'cmp-003',
    name: '纳指防守增强',
    status: 'DRAFT',
    composition_score: 71,
    leg_count: 3,
    rebalance_frequency: '月度再平衡',
    benchmark_label: 'QQQ',
    version_label: 'v2',
    version_status_label: '草稿版本',
    evidence_grade: 'C',
    evidence_label: '失效：异常降级补值',
    primary_diagnosis: failedDiagnosis,
    diagnoses: [failedDiagnosis],
    backtest_period_coverage: [
      { period: '10Y', status: 'missing', label: '10Y 待补齐' },
      { period: '20Y', status: 'missing', label: '20Y 待补齐' },
      { period: '30Y', status: 'missing', label: '30Y 待补齐' },
    ],
    annualized_return: 0.094,
    sharpe: 0.94,
    max_drawdown: -0.184,
    updated_at: '2026-04-28T08:00:00.000Z',
    latest_activity_label: '检测到策略腿新版本',
    allowed_actions: ['open_composition_workbench'],
    has_new_version: true,
    source_integrity: [
      {
        leg_id: 'leg-ndx',
        display_name: '纳指增强腿',
        source_ref_id: 'strategy_leg::strat-ndx::v2',
        freeze_hash: 'hash-v2',
        signature_status: 'stale',
        drift_status: 'version_drift',
        current_ref_id: 'strategy_leg::strat-ndx::v3',
        checked_at: '2026-04-30T08:00:00.000Z',
        alerts: ['Detected newer parameter version.'],
      },
    ],
  },
];

const backtestRuns: ApiCompositionGlobalBacktestRunListItem[] = [
  {
    id: 'comp-run-001',
    run_id: 'comp_run_81f2',
    composition_id: 'cmp-001',
    composition_name: '全天候研究组合',
    composition_version_label: 'v6 frozen',
    status: 'COMPLETED',
    verdict_label: '10Y 稳定',
    verdict_detail: 'Sharpe 1.21 · 回撤 -9.4%',
    scenario_id: 'worst-3m',
    scenario_label: '历史最差三个月',
    scenario_detail: '2018-10 至 2018-12 · 组合回撤 -12.9% · 基准组合 -17.0% · 相对抗跌 +4.0pt',
    scenario_status_label: '实际窗口',
    scenario_drawdown: -12.94,
    scenario_benchmark_drawdown: -16.97,
    scenario_recovery_days: 120,
    scenario_benchmark_recovery_days: 120,
    scenario_defensive_delta: 4.0,
    scenario_source: '来自本次组合回测收益序列的滚动三个月最差窗口。',
    order_count: 362,
    order_evidence_label: 'CSV/XLSX',
    risk_budget_label: '预算稳定',
    evidence_grade: 'A',
    primary_diagnosis: stableDiagnosis,
    diagnoses: [stableDiagnosis],
    completed_at: '2026-04-30T08:00:00.000Z',
  },
  {
    id: 'comp-run-002',
    run_id: 'comp_run_rate_2022',
    composition_id: 'cmp-002',
    composition_name: 'QQQ网格&标普动量平衡',
    composition_version_label: 'v5 frozen',
    status: 'COMPLETED_WITH_WARNINGS',
    verdict_label: 'proxy evidence required',
    verdict_detail: 'proxy_from_composition_detail_preview',
    scenario_id: 'rate-shock-2022',
    scenario_label: '2022 紧缩熊市',
    scenario_detail: '2022-01 至 2022-10 · 组合回撤 -18.2% · 基准组合 -14.0% · 相对抗跌 -4.2pt',
    scenario_status_label: '实际窗口',
    scenario_drawdown: -18.2,
    scenario_benchmark_drawdown: -14.0,
    scenario_recovery_days: null,
    scenario_benchmark_recovery_days: 92,
    scenario_defensive_delta: -4.2,
    scenario_source: '来自本次组合回测与基准序列，按 2022 紧缩熊市窗口计算。',
    order_count: 118,
    order_evidence_label: 'Derived from full-window composition rebalance events and source return streams; these are model instructions, not broker fills.',
    risk_budget_label: '2022-09',
    evidence_grade: 'C',
    primary_diagnosis: proxyDiagnosis,
    diagnoses: [proxyDiagnosis],
    completed_at: '2026-04-29T08:00:00.000Z',
  },
];

const allocationJobs: ApiCompositionGlobalAllocationJobListItem[] = [
  {
    id: 'alloc-001',
    job_id: 'alloc_job_54b2',
    composition_id: 'cmp-001',
    composition_name: '全天候研究组合',
    composition_version_label: 'v6 frozen',
    status: 'COMPLETED',
    method_key: 'risk_parity',
    method_label: 'risk_parity',
    method_detail: 'Allocation candidates were derived deterministically from the saved composition preview.',
    best_candidate_label: 'Risk Parity preview',
    candidate_count: 4,
    promotion_ready_count: 1,
    promotion_gate_label: '可通过',
    migration_cost_bps: 14,
    annualized_return_delta: 0.014,
    sharpe_delta: 0.08,
    max_drawdown_delta: -0.018,
    enb: 3.8,
    evidence_grade: 'A',
    evidence_label: 'heuristic_from_composition_detail_preview',
    primary_diagnosis: stableDiagnosis,
    diagnoses: [stableDiagnosis],
    policy_violation_count: 0,
    completed_at: '2026-04-30T08:00:00.000Z',
  },
  {
    id: 'alloc-002',
    job_id: 'alloc_job_blocked',
    composition_id: 'cmp-002',
    composition_name: 'QQQ网格&标普动量平衡',
    composition_version_label: 'v5 frozen',
    status: 'COMPLETED',
    method_key: 'min_vol',
    method_label: 'min_vol',
    method_detail: 'heuristic_from_composition_detail_preview',
    best_candidate_label: 'min_vol',
    candidate_count: 3,
    promotion_ready_count: 0,
    promotion_gate_label: '门禁阻断',
    migration_cost_bps: 4,
    annualized_return_delta: 0.006,
    sharpe_delta: 0.03,
    max_drawdown_delta: -0.011,
    enb: 2.4,
    evidence_grade: 'C',
    evidence_label: 'heuristic_from_composition_detail_preview',
    primary_diagnosis: failedDiagnosis,
    diagnoses: [failedDiagnosis],
    policy_violation_count: 1,
    completed_at: '2026-04-29T08:00:00.000Z',
  },
];

beforeEach(() => {
  fakeApi.listCompositions = vi.fn().mockResolvedValue(compositions);
  fakeApi.listCompositionBacktestRuns = vi.fn().mockResolvedValue(backtestRuns);
  fakeApi.listCompositionAllocationJobs = vi.fn().mockResolvedValue(allocationJobs);
  fakeApi.refreshCompositionDiagnostics = vi.fn().mockResolvedValue(compositions[0]);
  fakeApi.refreshCompositionSourceFreezes = vi.fn().mockResolvedValue(compositions[0]);
  fakeApi.confirmCompositionProxy = vi.fn().mockResolvedValue(compositions[1]);
  window.location.hash = '';
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.location.hash = '';
  window.localStorage.clear();
});

describe('composition v2 global index pages', () => {
  it('renders the composition list with compact hero, metrics, table and decision rail', async () => {
    await act(async () => {
      render(<CompositionListIndexPage />);
    });

    const root = document.querySelector('[data-page-root="composition-global-list"]');
    expect(root).not.toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: '组合列表' })).toBeInTheDocument();
    expect(screen.getByText('可运行组合')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: '组合列表' });
    expect(table).toBeInTheDocument();
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      '组合',
      '状态标签',
      '10Y年化/夏普/回撤',
      '周期完整度',
      '待决策',
      '操作',
    ]);
    expect(screen.getByRole('heading', { level: 2, name: '待决策事项' })).toBeInTheDocument();
    expect(screen.getAllByText('稳健：证据链完整').length).toBeGreaterThan(0);
    expect(screen.getByText('配置 v5')).toBeInTheDocument();
    const qqqRow = within(table).getByText('QQQ网格&标普动量平衡').closest('tr');
    expect(qqqRow).not.toBeNull();
    expect(qqqRow).toHaveTextContent('+11.4%');
    expect(qqqRow).toHaveTextContent('1.06');
    expect(qqqRow).toHaveTextContent('-16.8%');
    expect(qqqRow).toHaveTextContent('10Y 已覆盖');
    expect(qqqRow).toHaveTextContent('20Y 待补齐');
    expect(qqqRow).toHaveTextContent('30Y 待补齐');
    expect(qqqRow).not.toHaveTextContent('正式版本');
    expect(screen.queryByText('来源复核')).toBeNull();
    expect(screen.getAllByText('版本更新').length).toBeGreaterThan(0);
    expect(screen.queryByText('版本漂移')).toBeNull();
    expect(screen.queryByText(/127\.0\.0\.1:8000/)).toBeNull();
    expect(screen.queryByText(/Stepper|mock|placeholder/i)).toBeNull();
  });

  it('opens the status label dialog with three plain-language sections and confirms proxy coverage', async () => {
    await act(async () => {
      render(<CompositionListIndexPage />);
    });

    const table = screen.getByRole('table', { name: '组合列表' });
    const qqqRow = within(table).getByText('QQQ网格&标普动量平衡').closest('tr')!;
    fireEvent.click(within(qqqRow).getByRole('button', { name: '待校准：代理覆盖待确认' }));

    expect(screen.getByRole('dialog', { name: '代理覆盖待确认状态标签' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '前台判定说明' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '动作' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '解决判定' })).toBeInTheDocument();
    expect(screen.getByText('保存确认后，同一代理方案不再提醒。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '确认代理关系' }));
    await waitFor(() => expect(fakeApi.confirmCompositionProxy).toHaveBeenCalledWith(
      'cmp-002',
      expect.objectContaining({
        proxy_signature: 'proxy::QQQ::UNREGISTERED::test',
        target_symbol: 'QQQ',
      }),
    ));
  });

  it('explains the short return-sample diagnosis and opens actions in the current page', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    try {
      fakeApi.listCompositions = vi.fn().mockResolvedValue([
        {
          ...compositions[0],
          id: 'cmp-short',
          name: '标普动量均衡组合',
          primary_diagnosis: sampleDurationDiagnosis,
          diagnoses: [sampleDurationDiagnosis],
        },
      ]);

      await act(async () => {
        render(<CompositionListIndexPage />);
      });

      const table = screen.getByRole('table', { name: '组合列表' });
      const row = within(table).getByText('标普动量均衡组合').closest('tr')!;
      fireEvent.click(within(row).getByRole('button', { name: '待校准：收益样本窗口不足' }));

      expect(screen.getByRole('dialog', { name: '收益样本窗口不足状态标签' })).toBeInTheDocument();
      expect(screen.getByText(/月度收益样本只有 72 个月/)).toBeInTheDocument();
      expect(screen.getByText(/短窗口回测只能作为待校准复核/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '调整来源样本' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '按短样本配置回测' }));

      expect(window.location.hash).toBe('#/compositions/cmp-short/backtest-runs/new');
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      openSpy.mockRestore();
    }
  });

  it('executes source fingerprint re-freeze from the status label dialog', async () => {
    const driftedComposition = {
      ...compositions[0],
      id: 'composition_630718a64821',
      name: 'QQQ网格&标普动量平衡',
      primary_diagnosis: sourceLogicDriftDiagnosis,
      diagnoses: [sourceLogicDriftDiagnosis],
    };
    const refrozenComposition = {
      ...driftedComposition,
      primary_diagnosis: stableDiagnosis,
      diagnoses: [stableDiagnosis],
    };
    fakeApi.listCompositions = vi.fn()
      .mockResolvedValueOnce([driftedComposition])
      .mockResolvedValue([refrozenComposition]);
    fakeApi.refreshCompositionSourceFreezes = vi.fn().mockResolvedValue(refrozenComposition);

    await act(async () => {
      render(<CompositionListIndexPage />);
    });

    const table = screen.getByRole('table', { name: '组合列表' });
    const row = within(table).getByText('QQQ网格&标普动量平衡').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: '待校准：逻辑一致性漂移' }));
    fireEvent.click(screen.getByRole('button', { name: '确认并重新冻结来源指纹' }));

    await waitFor(() => expect(fakeApi.refreshCompositionSourceFreezes).toHaveBeenCalledWith(
      'composition_630718a64821',
      expect.objectContaining({
        reason: '先查看来源证据；确认当前来源正确后重新冻结，否则回工作台回滚或替换来源。',
      }),
    ));
    expect(screen.getByText('来源指纹已重新冻结；状态标签已重新计算。')).toBeInTheDocument();
    let dialog: HTMLElement | null = null;
    await waitFor(() => {
      dialog = screen.getByRole('dialog', { name: '证据链完整状态标签' });
      expect(dialog).toBeInTheDocument();
    });
    expect(within(dialog!).getByText('稳健：证据链完整')).toBeInTheDocument();
    expect(within(dialog!).getByText('当前无需处理。')).toBeInTheDocument();
    expect(within(dialog!).queryByRole('button', { name: '确认并重新冻结来源指纹' })).toBeNull();
  });

  it('filters composition rows and saves the selected list view', async () => {
    await act(async () => {
      render(<CompositionListIndexPage />);
    });

    const table = screen.getByRole('table', { name: '组合列表' });
    expect(await within(table).findByText('全天候研究组合')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('状态筛选'), { target: { value: 'DRAFT' } });

    expect(within(table).queryByText('全天候研究组合')).toBeNull();
    expect(within(table).queryByText('QQQ网格&标普动量平衡')).toBeNull();
    expect(within(table).getByText('纳指防守增强')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/compositions/list?status=DRAFT');

    fireEvent.click(screen.getByRole('button', { name: '保存视图' }));
    expect(window.localStorage.getItem('grit.compositionList.savedView')).toContain('"status":"DRAFT"');
    expect(screen.getByText('已保存')).toBeInTheDocument();
  });

  it('renders the global composition backtest list and routes row actions to the result page', async () => {
    await act(async () => {
      render(<CompositionBacktestRunsIndexPage />);
    });

    expect(await screen.findByRole('heading', { level: 1, name: '组合回测列表' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: '组合回测列表' })).toBeInTheDocument();
    expect(screen.getByText('集中查看组合回测、压力窗口与状态标签。')).toBeInTheDocument();
    expect(screen.getByText('按组合版本快照查看运行结果。')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '压力窗口' })).toBeInTheDocument();
    expect(screen.getByText('选择窗口查看回撤与修复表现。')).toBeInTheDocument();
    expect(screen.getAllByText('历史最差三个月').length).toBeGreaterThan(0);

    const table = screen.getByRole('table', { name: '组合回测列表' });
    fireEvent.click(within(table).getAllByRole('button', { name: '查看' })[0]);
    expect(window.location.hash).toBe('#/compositions/cmp-001/backtest-runs/comp_run_81f2');
  });

  it('opens status label actions from global backtest rows', async () => {
    await act(async () => {
      render(<CompositionBacktestRunsIndexPage />);
    });

    const table = screen.getByRole('table', { name: '组合回测列表' });
    const qqqRow = within(table).getByText('QQQ网格&标普动量平衡').closest('tr')!;
    fireEvent.click(within(qqqRow).getByRole('button', { name: '待校准：代理覆盖待确认' }));

    expect(screen.getByRole('dialog', { name: '代理覆盖待确认状态标签' })).toBeInTheDocument();
    expect(screen.getByText('确认代理关系，或替换来源。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认代理关系' }));

    await waitFor(() => expect(fakeApi.confirmCompositionProxy).toHaveBeenCalledWith(
      'cmp-002',
      expect.objectContaining({ proxy_signature: 'proxy::QQQ::UNREGISTERED::test' }),
    ));
  });

  it('filters global backtest rows, localizes headers, and updates the pressure scenario rail', async () => {
    window.location.hash = '#/compositions/backtest-runs?scenario=历史最差三个月';
    await act(async () => {
      render(<CompositionBacktestRunsIndexPage />);
    });

    const table = screen.getByRole('table', { name: '组合回测列表' });
    expect(within(table).getByText('全天候研究组合')).toBeInTheDocument();
    expect(within(table).queryByText('QQQ网格&标普动量平衡')).toBeNull();
    expect(screen.queryByLabelText('当前压力窗口')).toBeNull();
    expect(screen.getByText('点击压力窗口查看该组合的极端行情表现。')).toBeInTheDocument();
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      '组合名',
      '时间周期',
      '状态标签',
      '压力窗口',
      '年化收益',
      '夏普',
      '回撤',
      '操作',
    ]);

    fireEvent.change(screen.getByLabelText('压力窗口筛选'), { target: { value: '2022 紧缩熊市' } });
    expect(within(table).queryByText('全天候研究组合')).toBeNull();
    expect(within(table).getByText('QQQ网格&标普动量平衡')).toBeInTheDocument();
    expect(within(table).getByText('待校准：代理覆盖待确认')).toBeInTheDocument();
    expect(within(table).queryByText(/proxy evidence required/)).toBeNull();
    expect(window.location.hash).toBe('#/compositions/backtest-runs?scenario=2022+%E7%B4%A7%E7%BC%A9%E7%86%8A%E5%B8%82');

    fireEvent.change(screen.getByLabelText('压力窗口筛选'), { target: { value: '历史最差三个月' } });
    const scenarioButton = screen.getByRole('button', { name: '查看 历史最差三个月压力场景' });
    expect(scenarioButton).not.toHaveTextContent('修复 组合 120d');
    fireEvent.click(scenarioButton);
    expect(screen.getByLabelText('当前压力窗口')).toHaveTextContent('历史最差三个月');
    expect(screen.getByLabelText('当前压力窗口')).toHaveTextContent('全天候研究组合');
    expect(screen.getByLabelText('当前压力窗口')).toHaveTextContent('2018-10 至 2018-12');
    expect(screen.getByLabelText('当前压力窗口')).toHaveTextContent('窗口回撤');
    expect(screen.getByLabelText('当前压力窗口')).toHaveTextContent('-12.9%');
    expect(screen.getByLabelText('当前压力窗口')).toHaveTextContent('基准回撤');
    expect(screen.getByLabelText('当前压力窗口')).toHaveTextContent('-17.0%');
    expect(screen.getByLabelText('当前压力窗口')).toHaveTextContent('相对抗跌');
    expect(screen.getByLabelText('当前压力窗口')).toHaveTextContent('+4.0pt');
    const rail = screen.getByRole('heading', { level: 2, name: '压力窗口' }).closest('aside')!;
    expect(within(rail).queryByRole('button', { name: '查看 历史最差三个月压力场景' })).toBeNull();
    expect(within(table).queryByText('QQQ网格&标普动量平衡')).toBeNull();
    expect(within(table).getByText('全天候研究组合')).toBeInTheDocument();
  });

  it('renders the lab as a job list and keeps promotion gated through draft creation', async () => {
    await act(async () => {
      render(<CompositionLabIndexPage />);
    });

    expect(await screen.findByRole('heading', { level: 1, name: '组合实验室' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: '组合实验室作业列表' });
    expect(table).toBeInTheDocument();
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      '任务',
      '优化方法',
      '预期绩效',
      '状态标签门禁',
      '迁移成本',
      '操作',
    ]);
    const firstRow = within(table).getByText('全天候研究组合').closest('tr');
    expect(firstRow).not.toBeNull();
    expect(firstRow!).toHaveTextContent('配置 v6 frozen');
    expect(firstRow!).toHaveTextContent('风险平价');
    expect(firstRow!).toHaveTextContent('Δ年化 +1.4%');
    expect(firstRow!).toHaveTextContent('Δ夏普 +0.08');
    expect(firstRow!).toHaveTextContent('Δ回撤 -1.8%');
    expect(firstRow!).toHaveTextContent('最佳 风险平价');
    expect(screen.getByRole('heading', { level: 2, name: '晋升审查' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成草稿版本' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '生成草稿版本' }));
    expect(window.location.hash).toBe('#/compositions/cmp-001/allocation-jobs/alloc_job_54b2');
    fireEvent.click(screen.getByRole('button', { name: '创建决策包' }));
    expect(window.location.hash).toBe('#/compositions/cmp-001/allocation-jobs/alloc_job_54b2?intent=decision-packet');
    expect(screen.queryByText('保存为正式版本')).toBeNull();
    expect(screen.queryByText('heuristic_from_composition_detail_preview')).toBeNull();
    expect(screen.queryByText(/Allocation candidates were derived/i)).toBeNull();
    expect(screen.queryByText(/Risk Parity preview/i)).toBeNull();
    expect(screen.queryByText(/Stepper|mock|placeholder/i)).toBeNull();
  });

  it('filters allocation lab rows through real controls and keeps the filter in the URL', async () => {
    await act(async () => {
      render(<CompositionLabIndexPage />);
    });

    const table = screen.getByRole('table', { name: '组合实验室作业列表' });
    expect(await within(table).findByText('全天候研究组合')).toBeInTheDocument();
    expect(within(table).getByText('QQQ网格&标普动量平衡')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('状态筛选'), { target: { value: 'blocked' } });

    expect(within(table).queryByText('全天候研究组合')).toBeNull();
    expect(within(table).getByText('QQQ网格&标普动量平衡')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/compositions/lab?status=blocked');

    fireEvent.change(screen.getByLabelText('优化方法筛选'), { target: { value: 'min_vol' } });
    expect(within(table).getByText('QQQ网格&标普动量平衡')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/compositions/lab?status=blocked&method=min_vol');

    fireEvent.click(screen.getByRole('button', { name: '重置筛选' }));
    expect(within(table).getByText('全天候研究组合')).toBeInTheDocument();
    expect(within(table).getByText('QQQ网格&标普动量平衡')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/compositions/lab');
  });

  it('opens status label actions from allocation lab rows', async () => {
    await act(async () => {
      render(<CompositionLabIndexPage />);
    });

    const table = screen.getByRole('table', { name: '组合实验室作业列表' });
    const qqqRow = within(table).getByText('QQQ网格&标普动量平衡').closest('tr')!;
    fireEvent.click(within(qqqRow).getByRole('button', { name: '失效：异常降级补值' }));

    expect(screen.getByRole('dialog', { name: '异常降级补值状态标签' })).toBeInTheDocument();
    expect(screen.getByText('修复数据来源或更换成分。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '刷新诊断' }));

    await waitFor(() => expect(fakeApi.refreshCompositionDiagnostics).toHaveBeenCalledWith('cmp-002'));
  });
});

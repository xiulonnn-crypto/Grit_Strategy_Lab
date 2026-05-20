import {
  ApiError,
  type ApiBacktestRunDeleteResult,
  type ApiBacktestRunDetail,
  type ApiBacktestRunListItem,
  type ApiBacktestTradeAudit,
  type ApiBacktestRunTradePage,
  type ApiBacktestSubmissionPreview,
  type ApiConfirmationUpdateRequest,
  type ApiFactorCreatePayload,
  type ApiFactorDetail,
  type ApiFactorDiagnosticPayload,
  type ApiFactorDiagnosticPreview,
  type ApiFactorDiagnosticPreviewPayload,
  type ApiFactorDiagnosticRunResponse,
  type ApiFactorFactoryAutomationPayload,
  type ApiFactorFactoryOverview,
  type ApiFactorFactoryRun,
  type ApiFactorFactoryRunNowPayload,
  type ApiFactorGovernanceExecuteResponse,
  type ApiFactorGovernanceOverview,
  type ApiFactorListItem,
  type ApiFactorListResponse,
  type ApiFactorMiningJob,
  type ApiFactorMiningJobCreatePayload,
  type ApiFactorMiningJobListResponse,
  type ApiFactorModelCreatePayload,
  type ApiFactorModelPreviewPayload,
  type ApiFactorModelPreviewResponse,
  type ApiFactorQuarantineCandidate,
  type ApiFactorQuarantineCandidateListResponse,
  type ApiFactorQuarantineIntakePayload,
  type ApiFactorQuarantinePublishPayload,
  type ApiFactorQuarantinePublishResponse,
  type ApiFactorQuarantineRunPayload,
  type ApiOptimizationCandidate,
  type ApiOptimizationJobDetail,
  type ApiOptimizationJobListItem,
  type ApiPitDataOverview,
  type ApiPitIdentityOverridePayload,
  type ApiPitIdentityScraperRestartResponse,
  type ApiPitResearchWaiverPayload,
  type ApiSnapshotOverview,
  type ApiStrategyCreationSession,
  type ApiStrategyDetail,
  type ApiStrategyListItem,
  type ApiWorkspaceOverview,
  type BacktestRunDetailRequest,
  type CreateCandidatePayload,
  type DemoApi,
  type ParameterValue,
  type PromoteMode,
} from '../types';
import { buildParameterDiffRows } from './adapters';
import { applyOptimizationJobConstraintUpdate } from './optimization-demo';

type DemoState = {
  strategies: ApiStrategyDetail[];
  optimizationJobs: ApiOptimizationJobDetail[];
  sessions: ApiStrategyCreationSession[];
  runs: ApiBacktestRunDetail[];
  promoteConflicts: Set<string>;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function nowIso(): string {
  return new Date('2026-03-30T09:00:00.000Z').toISOString();
}

function nextId(prefix: string): string {
  return `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
}

function createStrategy(overrides: Partial<ApiStrategyDetail>): ApiStrategyDetail {
  const id = overrides.id ?? nextId('strat');
  const parameterVersion = overrides.current_parameter_version ?? 2;
  return {
    id,
    name: overrides.name ?? 'Quality Momentum',
    description: overrides.description ?? 'Recovered strategy detail',
    strategy_type: overrides.strategy_type ?? 'MOMENTUM',
    universe_name: overrides.universe_name ?? 'SPY',
    rebalance_frequency: overrides.rebalance_frequency ?? 'monthly',
    lifecycle_status: overrides.lifecycle_status ?? 'ACTIVE',
    latest_run_id: overrides.latest_run_id ?? 'bt-001',
    latest_optimization_job_id: overrides.latest_optimization_job_id ?? 'opt-001',
    current_parameter_version: parameterVersion,
    current_parameter_version_id: overrides.current_parameter_version_id ?? `${id}-v${parameterVersion}`,
    parameters: overrides.parameters ?? {
      lookback_months: 6,
      skip_recent_months: 1,
      top_n: 5,
      weighting_method: 'equal_weight',
    },
    parameter_history: overrides.parameter_history ?? [
      {
        version_number: parameterVersion,
        parameter_version_id: overrides.current_parameter_version_id ?? `${id}-v${parameterVersion}`,
        revision: parameterVersion,
        created_at: nowIso(),
        parameters: overrides.parameters ?? {
          lookback_months: 6,
          skip_recent_months: 1,
          top_n: 5,
          weighting_method: 'equal_weight',
        },
      },
    ],
    confirmation_fields: overrides.confirmation_fields ?? { top_level: [], parameters: [] },
    allowed_actions: overrides.allowed_actions ?? ['run_backtest', 'open_optimization'],
    benchmark_symbol: overrides.benchmark_symbol ?? 'SPY',
  };
}

function createCandidate(
  strategy: ApiStrategyDetail,
  overrides: Partial<ApiOptimizationCandidate> = {},
  rank = 1,
): ApiOptimizationCandidate {
  const snapshot = overrides.parameter_snapshot ?? {
    ...strategy.parameters,
    top_n: Number(strategy.parameters?.top_n ?? 5) + rank,
  };
  return {
    id: overrides.id ?? nextId('trial'),
    label: overrides.label ?? `候选方案 ${rank}`,
    summary: overrides.summary ?? '已恢复优化候选方案。',
    status: overrides.status ?? 'SUCCEEDED',
    rank,
    score: overrides.score ?? 0.67 + rank / 100,
    parameter_snapshot: snapshot,
    parameter_delta: overrides.parameter_delta ?? Object.fromEntries(buildParameterDiffRows(strategy.parameters ?? {}, snapshot).map((row) => [row.key, row.nextValue ?? null])),
    metrics: overrides.metrics ?? { sharpe: 1.1 + rank / 10 },
    base_parameter_version_id: overrides.base_parameter_version_id ?? strategy.current_parameter_version_id ?? null,
  };
}

function createInitialState(): DemoState {
  const strategies = [
    createStrategy({
      id: 'strat-001',
      name: 'Quality Momentum',
      latest_optimization_job_id: 'opt-001',
    }),
    createStrategy({
      id: 'strat-002',
      name: 'Low Vol Rotation',
      latest_optimization_job_id: null,
      parameters: {
        lookback_months: 3,
        skip_recent_months: 1,
        top_n: 2,
        weighting_method: 'risk_parity',
      },
    }),
  ];
  const optimizationJobs: ApiOptimizationJobDetail[] = [
    {
      id: 'opt-001',
      strategy_id: 'strat-001',
      status: 'COMPLETED',
      request: {
        objective: 'sharpe',
        base_parameter_version_id: strategies[0].current_parameter_version_id,
      },
      summary: {
        objective: 'sharpe',
        candidate_count: 2,
        baseline_parameter_version_id: strategies[0].current_parameter_version_id,
      },
      result: {
        best_candidate_id: 'trial-001',
        baseline_parameter_version_id: strategies[0].current_parameter_version_id,
      },
      candidates: [
        createCandidate(strategies[0], { id: 'trial-001', label: '基线 + 1' }, 1),
        createCandidate(
          strategies[0],
          {
            id: 'trial-002',
            label: '差异示例候选',
            parameter_snapshot: {
              ...strategies[0].parameters,
              top_n: 8,
              lookback_months: 12,
            },
          },
          2,
        ),
      ],
      base_parameter_version_id: strategies[0].current_parameter_version_id,
      created_at: nowIso(),
      updated_at: nowIso(),
      completed_at: nowIso(),
    },
  ];

  return {
    strategies,
    optimizationJobs,
    sessions: [],
    runs: [
      {
        id: 'bt-001',
        strategy_id: 'strat-001',
        status: 'COMPLETED_WITH_WARNINGS',
        metrics: { total_return: 18.4, sharpe: 1.18, max_drawdown: -6.4 },
        chart_series: [],
        monthly_returns: [],
        trade_details: [],
        configuration: { oos_start_date: '2025-01-01' },
        parameter_snapshot: strategies[0].parameters ?? {},
        analysis: {
          subtitle: '测试集仍然跑赢基准，但近期回撤修复偏慢，建议优先检查样本外交易。',
          kpi_cards: [
            {
              key: 'total_return',
              label: '总收益',
              primary_text: '+18.4%',
              trend_direction: 'up',
              trend_text: '↑ 跑赢基准 6.1%',
              compare_text: '基准: +12.3% | 差值: +6.1%',
              insight_text: '收益稳定，建议检查 Beta 暴露是否过高。',
              insight_tone: 'positive',
              state: 'healthy',
            },
            {
              key: 'sharpe',
              label: '夏普比率',
              primary_text: '1.18',
              trend_direction: 'up',
              trend_text: '↑ 高于基准 0.42',
              compare_text: '基准: 0.76 | 差值: +0.42',
              insight_text: '风险回报领先，但仍要确认样本外一致性。',
              insight_tone: 'positive',
              state: 'healthy',
            },
            {
              key: 'max_drawdown',
              label: '最大回撤',
              primary_text: '-6.4%',
              trend_direction: 'up',
              trend_text: '↓ 优于基准 4.2%',
              compare_text: '基准: -10.6% | 差值: +4.2%',
              insight_text: '风控优于基准，但要继续观察回撤修复节奏。',
              insight_tone: 'neutral',
              state: 'watch',
            },
            {
              key: 'rolling_252_return',
              label: '最新 252 日滚动收益',
              primary_text: '+9.8%',
              trend_direction: 'up',
              trend_text: '↑ 高于基准 2.5%',
              compare_text: '基准: +7.3% | 差值: +2.5%',
              insight_text: '建议延长回测窗口，确认近期优势不是偶发样本。',
              insight_tone: 'warning',
              state: 'watch',
            },
            {
              key: 'trade_count',
              label: '交易数',
              primary_text: '24',
              trend_direction: 'flat',
              trend_text: '训练集 18 / 测试集 6',
              compare_text: '训练集: 18 | 测试集: 6',
              insight_text: '测试集样本偏少，需警惕过拟合。',
              insight_tone: 'warning',
              state: 'watch',
            },
          ],
          decision_rail: {
            score: 67,
            summary: '测试集收益仍成立，但优先级应放在核查样本外交易质量。',
            items: [
              {
                key: 'result',
                title: '结果判断',
                body: '测试集仍跑赢基准，方向没有被破坏。',
                tone: 'positive',
              },
              {
                key: 'risk',
                title: '风险判断',
                body: '回撤修复速度偏慢，需要结合成交明细确认衰退位置。',
                tone: 'warning',
              },
              {
                key: 'next_action',
                title: '下一步动作',
                body: '先看测试集交易，再决定是否进入下一轮参数寻优。',
                tone: 'neutral',
              },
            ],
          },
        },
      },
    ],
    promoteConflicts: new Set<string>(),
  };
}

function createSnapshotOverview(refreshedAt = '2026-04-01T07:48:00Z'): ApiSnapshotOverview {
  return {
    overall_status: 'READY',
    last_refreshed_at: refreshedAt,
    dataset_snapshots: [
      {
        id: 'dataset-corporate-actions',
        name: '公司行为数据',
        status: 'READY',
        as_of: refreshedAt,
        freshness_label: '刚刚刷新',
        start_date: '1996-01-01',
        end_date: '2026-04-01',
        row_count: 182430,
        source: 'Yahoo',
        fallback_source: 'fallback unavailable',
        blocker: null,
      },
      {
        id: 'dataset-price-bars',
        name: '股票价格数据',
        status: 'READY',
        as_of: refreshedAt,
        freshness_label: '刚刚刷新',
        start_date: '1996-01-01',
        end_date: '2026-04-01',
        row_count: 4320,
        source: 'Yahoo',
        fallback_source: 'fallback unavailable',
        blocker: null,
      },
    ],
    universe_snapshots: [
      {
        id: 'universe-sp500',
        name: '标普500',
        status: 'READY',
        as_of: refreshedAt,
        freshness_label: '刚刚刷新',
        window_start: '1996-01-01',
        window_end: '2026-04-01',
        anchor_schedule: '01-01 / 07-01',
        member_count: 500,
        source: 'Yahoo',
        fallback_source: '本地冷备',
        blocker: null,
      },
      {
        id: 'universe-nasdaq100',
        name: '纳指100',
        status: 'READY',
        as_of: refreshedAt,
        freshness_label: '刚刚刷新',
        window_start: '1996-01-01',
        window_end: '2026-04-01',
        anchor_schedule: '01-01 / 07-01',
        member_count: 100,
        source: 'Yahoo',
        fallback_source: '本地冷备',
        blocker: null,
      },
    ],
    latest_job: {
      id: 'snap-job-20260401',
      status: 'COMPLETED',
      started_at: '2026-04-01T07:30:00Z',
      completed_at: refreshedAt,
      summary: {
        dataset_snapshot_count: 2,
        universe_snapshot_count: 2,
      },
      warnings: [],
      errors: [],
    },
    blocking_code: null,
    blocking_target: null,
    message: '这里会集中展示价格数据、公司行为和股票池的最新状态。',
    allowed_actions: ['refresh_snapshots'],
    data_layer_readiness: [
      {
        layer_id: 'l1_market_data',
        title_cn: 'L1 基础行情',
        status: 'READY',
        summary: 'OHLCV、基准 ETF 与刷新链路均已就绪。',
        metrics: [
          { label: '价格快照', value: '2/2', detail: 'ds-price / ds-corporate-actions' },
          { label: '基准覆盖', value: '2/2', detail: 'SPY、QQQ 可回放' },
        ],
        updated_at: refreshedAt,
        provider_keys: ['yahoo'],
        linked_targets: ['ds-price', 'ds-corporate-actions'],
      },
      {
        layer_id: 'l2_fundamental_data',
        title_cn: 'L2 财务截面',
        status: 'WARNING',
        summary: '财务截面可接入，但发布日与恒等式校验仍待补齐。',
        metrics: [
          { label: '财报快照', value: '待接入', detail: 'FMP 10-K / 10-Q' },
          { label: 'PIT 对齐', value: '待校验', detail: 'publish_date / available_at' },
        ],
        updated_at: refreshedAt,
        provider_keys: ['FMP_API_KEY'],
        linked_targets: ['ds-fundamentals'],
      },
      {
        layer_id: 'l3_sentiment_data',
        title_cn: 'L3 分析师与情绪',
        status: 'WARNING',
        summary: '一致预期与卖空链路尚未形成稳定覆盖。',
        metrics: [
          { label: '一致预期', value: '样本不足', detail: '分析师样本数低于 3' },
          { label: '卖空链路', value: '待校验', detail: '短卖成交占比仍需巡检' },
        ],
        updated_at: refreshedAt,
        provider_keys: ['ALPHAVANTAGE_API_KEY', 'FINRA'],
        linked_targets: ['analyst-consensus', 'short-volume'],
      },
      {
        layer_id: 'l4_macro_derivatives',
        title_cn: 'L4 宏观与衍生品',
        status: 'CALIBRATING',
        summary: '宏观序列可纳入，但利率 Beta 与 IV Skew 仍在校准。',
        metrics: [
          { label: 'FRED 利率', value: '可接入', detail: '10Y Yield / CPI' },
          { label: 'IV Skew', value: '待接入', detail: 'ThetaData 期权面板' },
        ],
        updated_at: refreshedAt,
        provider_keys: ['FRED_API_KEY', 'THETADATA'],
        linked_targets: ['fred-10y', 'iv-skew'],
      },
    ],
    snapshot_quality_alerts: [
      {
        code: 'FUNDAMENTAL_BALANCE_CHECK_PENDING',
        severity: 'warning',
        title_cn: '财报恒等式待校验',
        detail_cn: '资产、负债与权益恒等式尚未完成逐项核验。',
        source_layer: 'l2_fundamental_data',
        blocking: false,
        target: 'ds-fundamentals',
      },
      {
        code: 'CONSENSUS_BLIND_SPOT',
        severity: 'warning',
        title_cn: '情绪样本仍有盲区',
        detail_cn: '一致预期样本数低于 3 时，分析师修正因子仅允许观察。',
        source_layer: 'l3_sentiment_data',
        blocking: false,
        target: 'analyst-consensus',
      },
      {
        code: 'SHORT_VOLUME_JUMP_REVIEW',
        severity: 'warning',
        title_cn: '卖空成交需巡检',
        detail_cn: '短卖成交占比若出现异常跳变，应触发人工复核。',
        source_layer: 'l3_sentiment_data',
        blocking: false,
        target: 'short-volume',
      },
      {
        code: 'RATE_BETA_CALIBRATING',
        severity: 'info',
        title_cn: '利率 Beta 校准中',
        detail_cn: '宏观回归链路已预留，但滚动回归仍未完成定标。',
        source_layer: 'l4_macro_derivatives',
        blocking: false,
        target: 'fred-10y',
      },
    ],
    factor_dimension_readiness: [
      {
        dimension_id: 'price_liquidity',
        title_cn: '价格与流动性',
        status: 'READY',
        supported_factors: ['12-1 动量', '6m 动量', '波动率', '规模'],
        blockers: [],
        linked_layers: ['l1_market_data'],
      },
      {
        dimension_id: 'quality_valuation',
        title_cn: '质量与估值',
        status: 'WARNING',
        supported_factors: ['Accruals', 'F-Score', 'ROE', 'FCFY'],
        blockers: ['财务发布日未完成 PIT 校验'],
        linked_layers: ['l2_fundamental_data'],
      },
      {
        dimension_id: 'sentiment_micro',
        title_cn: '情绪与微观结构',
        status: 'WARNING',
        supported_factors: ['分析师修正', '超额换手', '空头回补'],
        blockers: ['一致预期样本数不足', '卖空成交链路待巡检'],
        linked_layers: ['l3_sentiment_data'],
      },
      {
        dimension_id: 'macro_derivatives',
        title_cn: '宏观与衍生品',
        status: 'CALIBRATING',
        supported_factors: ['利率敏感度', '通胀 Beta', 'IV Skew'],
        blockers: ['滚动回归尚在校准', '期权面板尚未接入'],
        linked_layers: ['l4_macro_derivatives'],
      },
    ],
    bond_fixed_income: {
      global_pulse: {
        status: 'READY',
        headline: '债券快照治理已纳入统一快照总览。',
        updated_at: refreshedAt,
        cards: [
          { id: 'health', label: '就绪比例', status: 'READY', value: '4/4', detail: '债券主清单已完成日终更新' },
          { id: 'coverage', label: '影子字段覆盖率', status: 'READY', value: '96%', detail: 'Dirty Price / Accrued / Duration / YTM' },
          { id: 'source', label: '来源健康度', status: 'READY', value: 'FMP / Polygon', detail: '主链路稳定' },
        ],
      },
      pillar_groups: [
        {
          id: 'ust',
          label: '利率债 (UST)',
          status: 'READY',
          items: [
            { id: 'ust-2y', label: '2Y', status: 'READY', value: '4.01%', detail: 'Accrued / Duration 已齐备' },
            { id: 'ust-10y', label: '10Y', status: 'READY', value: '4.22%', detail: '全价与净价同步' },
            { id: 'ust-30y', label: '30Y', status: 'READY', value: '4.48%', detail: '曲线点位可用于审计' },
          ],
        },
      ],
      curve_preview: [
        { tenor_label: '2Y', yield_pct: 4.01, spread_bps: 0 },
        { tenor_label: '10Y', yield_pct: 4.22, spread_bps: 21 },
        { tenor_label: '30Y', yield_pct: 4.48, spread_bps: 47 },
      ],
      audit_matrix: [
        { id: 'bond-ust-10y', label: 'UST 10Y', owner: 'FMP', status: 'READY', cadence_label: '日终', evidence: 'Dirty / Accrued / Duration / YTM' },
      ],
      raw_registry: [
        { id: 'bond-ust-10y', label: 'UST 10Y EOD', status: 'READY', source: 'FMP', snapshot_ref: 'bond_fixed_income.ust_10y', updated_at: refreshedAt, notes: ['可用于镜像生成资产腿'] },
      ],
      eligible_sources: [
        {
          id: 'bond-source-fmp',
          label: 'FMP Treasury EOD',
          source: 'FMP',
          status: 'READY',
          access_tier: 'runtime',
          instrument_types: ['BOND'],
          coverage_notes: ['clean/full price', 'accrued interest', 'YTM', 'duration'],
          updated_at: refreshedAt,
        },
      ],
      eligible_instruments: [
        {
          id: 'bond-ust-10y',
          label: 'UST 10Y EOD',
          instrument_type: 'BOND',
          source: 'FMP',
          status: 'READY',
          symbol: 'UST10Y',
          currency: 'USD',
          snapshot_date: '2026-04-01',
          clean_price: 99.64,
          net_price: 99.64,
          dirty_price: 101.18,
          full_price: 101.18,
          accrued_interest: 1.54,
          ytm_pct: 4.22,
          duration: 8.4,
          convexity: 0.76,
          snapshot_ref: 'bond_fixed_income.ust_10y',
          refresh_status: 'READY',
          missing_fields: [],
          inferred_fields: {},
          field_status: {
            clean_price: 'actual',
            full_price: 'actual',
            accrued_interest: 'actual',
            ytm_pct: 'actual',
            duration: 'actual',
            convexity: 'actual',
          },
          updated_at: refreshedAt,
        },
      ],
      scheduler: {
        status: 'READY',
        cadence_label: '日终刷新',
        next_action: '下次刷新 18:05 HKT',
        last_job_id: 'snap-job-20260401',
      },
      selected_source_summary: {
        primary_source: 'FMP',
        fallback_source: 'Polygon',
        selection_reason: '固定收益快照优先使用日终预计算 YTM / Duration。',
      },
      system_diagnostics: {
        blocking_code: null,
        blocking_target: null,
        refresh_job_status: 'COMPLETED',
        memory: {},
        notes: ['债券治理页签使用总览扩展字段，不单独新开快照 API。'],
      },
    },
  };
}

function createPitDataOverview(): ApiPitDataOverview {
  return {
    dataset_snapshot_id: 'ds-price',
    fundamental_snapshot_id: 'ds-fundamentals',
    universe_snapshot_id: 'un-sp500',
    as_of_date: '2026-04-01',
    cleaning_version: 'snapshot-derived-v1',
    overall_status: 'READY',
    adjusted_price_status: 'READY',
    universe_status: 'READY',
    outlier_cleaning_status: 'READY',
    corporate_action_status: 'INCOMPLETE',
    fundamental_status: 'READY',
    coverage: {
      covered_symbol_count: 458,
      total_symbol_count: 502,
      coverage_pct: 91.24,
      price_bar_rows: 4320,
      universe_member_rows: 30622,
    },
    fundamental_coverage: {
      covered_symbol_count: 458,
      total_symbol_count: 502,
      coverage_pct: 91.24,
      fundamental_point_rows: 5496,
      coverage_rows: 458,
      available_fields: ['capex', 'enterprise_value', 'ltm_earnings', 'market_cap', 'operating_cash_flow', 'total_shares'],
      missing_fields: [],
      source_snapshot_status: 'READY',
    },
    blocking_items: [],
    sample_securities: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META'],
    quality_events: [
      {
        id: 'pit-q-001',
        severity: 'INFO',
        event_type: 'ADJUSTED_PRICE_CHECK',
        title: '复权轨迹已校验',
        message: '样例证券除权除息日前后价格轨迹一致。',
        target_date: '2026-04-01',
      },
    ],
    factor_diagnostics_enabled: true,
    verified_diagnostics_enabled: true,
    sandbox_diagnostics_enabled: true,
    pit_layer_readiness: [
      {
        layer_id: 'l1_market_data',
        title_cn: 'L1 基础行情',
        status: 'READY',
        summary: '价格回放、样本池与复权链路均已通过。',
        pit_alignment: '支持价格型因子回放与 10Y 诊断窗口。',
        blockers: [],
        available_at_health: null,
      },
      {
        layer_id: 'l2_fundamental_data',
        title_cn: 'L2 财务截面',
        status: 'READY',
        summary: '财务字段与 available_at 对齐满足 PIT 计算要求。',
        pit_alignment: '可支撑质量、估值与财务稳健性因子。',
        blockers: [],
        available_at_health: {
          status: 'healthy',
          sampled_row_count: 24,
          missing_available_at_count: 0,
        },
      },
      {
        layer_id: 'l3_sentiment_data',
        title_cn: 'L3 分析师与情绪',
        status: 'PARTIAL_READY',
        summary: '卖空样本已可用于情绪与微观结构研究，一致预期仍在观察。',
        pit_alignment: '一致预期与卖空样本按子模块独立回放，不再整层停用。',
        blockers: ['一致预期样本仍需补齐'],
        available_at_health: null,
        submodules: [
          {
            id: 'analyst_consensus',
            title_cn: '分析师一致预期',
            status: 'OBSERVATION',
            usable: true,
            summary_cn: '样本不足，先作为观察证据。',
            linked_targets: ['ds-analyst-consensus'],
            metrics: { point_rows: 2, required_points: 3 },
            blockers: ['一致预期样本不足'],
          },
          {
            id: 'short_volume',
            title_cn: '卖空成交样本',
            status: 'READY',
            usable: true,
            summary_cn: '可用于 short-volume 与微观结构因子研究。',
            linked_targets: ['ds-short-volume'],
            metrics: { point_rows: 256 },
            blockers: [],
          },
        ],
      },
      {
        layer_id: 'l4_macro_derivatives',
        title_cn: 'L4 宏观与衍生品',
        status: 'PARTIAL_READY',
        summary: '宏观与期权特征源已可用，正式 IC 诊断仍需价格回放门禁。',
        pit_alignment: '宏观与衍生品因子先作为 feature source 暴露。',
        blockers: [],
        available_at_health: null,
        submodules: [
          {
            id: 'macro_rates',
            title_cn: '宏观利率序列',
            status: 'READY',
            usable: true,
            summary_cn: '可用于利率敏感度和宏观 Beta 特征。',
            linked_targets: ['ds-macro-rates'],
            metrics: { covered_series: 10, required_series: 10 },
            blockers: [],
          },
          {
            id: 'option_skew',
            title_cn: '期权偏度链路',
            status: 'READY',
            usable: true,
            summary_cn: '可用于 IV Skew 衍生品风险偏度特征。',
            linked_targets: ['ds-option-skew'],
            metrics: { point_rows: 75 },
            blockers: [],
          },
        ],
      },
    ],
    factor_diagnostic_readiness: [
      {
        group_id: 'price',
        title_cn: '价格型',
        status: 'VERIFIED',
        factors: ['12-1 动量', '6m 动量', '252d 波动率', '规模'],
        rationale_cn: '价格、样本池与复权序列齐备，可直接进入正式诊断。',
        linked_snapshot_checks: ['price_replay_gate', 'universe_history_gate'],
      },
      {
        group_id: 'quality_valuation',
        title_cn: '质量/估值型',
        status: 'VERIFIED',
        factors: ['Accruals', 'F-Score', 'ROE', 'FCFY'],
        rationale_cn: '财务字段与 available_at 对齐满足 PIT 门禁。',
        linked_snapshot_checks: ['fundamental_publish_gate', 'fundamental_balance_check'],
      },
      {
        group_id: 'sentiment_micro',
        title_cn: '情绪/微观型',
        status: 'PARTIAL_READY',
        factors: ['分析师修正', '空头回补', '超额换手'],
        rationale_cn: '卖空样本已可用，可先开放情绪与微观结构研究；一致预期仍观察。',
        linked_snapshot_checks: ['consensus_sample_gate', 'short_volume_gate'],
        required_checks: ['consensus_sample_gate', 'short_volume_gate'],
        satisfied_checks: ['short_volume_gate'],
        blocked_checks: ['consensus_sample_gate'],
        upstream_capabilities: [
          {
            capability_id: 'factor.sentiment_micro',
            factor_groups: ['sentiment_micro'],
            mode: 'PARTIAL_READY',
            allowed_actions: ['research_preview', 'run_sandbox_diagnostics'],
            required_checks: ['consensus_sample_gate', 'short_volume_gate'],
            satisfied_checks: ['short_volume_gate'],
            blocked_checks: ['consensus_sample_gate'],
            summary_cn: '卖空样本可先支持 short-volume 因子研究。',
          },
        ],
      },
      {
        group_id: 'macro_derivatives',
        title_cn: '宏观/衍生品型',
        status: 'PARTIAL_READY',
        factors: ['利率敏感度', '通胀 Beta', 'IV Skew'],
        rationale_cn: '宏观序列与期权偏度可作为特征源，正式诊断仍按 L1 价格回放检查。',
        linked_snapshot_checks: ['rate_beta_calibration', 'iv_skew_feed'],
        required_checks: ['rate_beta_calibration', 'iv_skew_feed', 'price_replay_gate'],
        satisfied_checks: ['rate_beta_calibration', 'iv_skew_feed'],
        blocked_checks: [],
      },
    ],
    pit_quality_alerts: [
      {
        code: 'RATE_BETA_CALIBRATING',
        severity: 'LOW',
        title_cn: '利率 Beta 校准中',
        detail_cn: '宏观回归链路可运行，但滚动参数仍需校准。',
        hard_blocking: false,
        linked_factor_groups: ['macro_derivatives'],
      },
    ],
    snapshot_layer_linkage: [
      {
        check_id: 'price_replay_gate',
        check_title_cn: '价格回放可用',
        source_layer: 'L1 基础行情',
        target_factor_groups: ['价格型', '宏观/衍生品型'],
        result_status: 'READY',
      },
      {
        check_id: 'universe_history_gate',
        check_title_cn: '样本池历史锚点通过',
        source_layer: 'L1 基础行情',
        target_factor_groups: ['价格型', '宏观/衍生品型'],
        result_status: 'READY',
      },
      {
        check_id: 'fundamental_publish_gate',
        check_title_cn: '发布日与 available_at 对齐',
        source_layer: 'L2 财务截面',
        target_factor_groups: ['质量/估值型'],
        result_status: 'READY',
      },
      {
        check_id: 'fundamental_balance_check',
        check_title_cn: '财报恒等式检查',
        source_layer: 'L2 财务截面',
        target_factor_groups: ['质量/估值型'],
        result_status: 'READY',
      },
      {
        check_id: 'consensus_sample_gate',
        check_title_cn: '一致预期样本门槛',
        source_layer: 'L3 分析师与情绪',
        target_factor_groups: ['情绪/微观型'],
        result_status: 'OBSERVATION',
        hard_blocking: false,
        capability_mode: 'PARTIAL_READY',
      },
      {
        check_id: 'short_volume_gate',
        check_title_cn: '卖空成交样本',
        source_layer: 'L3 分析师与情绪',
        target_factor_groups: ['情绪/微观型'],
        result_status: 'READY',
        hard_blocking: false,
        capability_mode: 'PARTIAL_READY',
      },
      {
        check_id: 'rate_beta_calibration',
        check_title_cn: '利率 Beta 校准',
        source_layer: 'L4 宏观与衍生品',
        target_factor_groups: ['宏观/衍生品型'],
        result_status: 'READY',
        hard_blocking: false,
        capability_mode: 'PARTIAL_READY',
      },
    ],
    diagnostic_windows: {
      sandbox: {
        mode: 'SANDBOX',
        enabled: true,
        start_date: '2023-04-01',
        end_date: '2026-04-01',
        label: 'Sandbox 近 3 年预览',
      },
      verified: {
        mode: 'VERIFIED',
        enabled: true,
        start_date: '2016-04-01',
        end_date: '2026-04-01',
        label: 'Verified 10 年 PIT 门禁',
        missing_windows: [],
      },
    },
    gate_fix_target: '#/pit-data',
    source: { derived_from_snapshot: true },
  };
}

function createFactorDiagnosticSummary(factorId: string): ApiFactorListItem['latest_diagnostic_summary'] {
  return {
    run_id: `fdiag-${factorId}`,
    factor_id: factorId,
    status: 'COMPLETED',
    dataset_snapshot_id: 'ds-price',
    fundamental_snapshot_id: 'ds-fundamentals',
    universe_snapshot_id: 'un-sp500',
    cleaning_version: 'snapshot-derived-v1',
    ic: 0.041,
    rank_ic: 0.063,
    ir: 0.88,
    coverage: 91.4,
    group_returns: [
      { group: '第1组', mean_return: 0.041, sample_count: 101 },
      { group: '第2组', mean_return: 0.025, sample_count: 100 },
      { group: '第3组', mean_return: 0.012, sample_count: 100 },
      { group: '第4组', mean_return: -0.004, sample_count: 100 },
      { group: '第5组', mean_return: -0.018, sample_count: 101 },
    ],
    ic_series: Array.from({ length: 12 }, (_, index) => ({
      date: `2025-${String(index + 1).padStart(2, '0')}-28`,
      rank_ic: Number((0.04 + Math.sin(index / 2) * 0.035).toFixed(4)),
      ic: Number((0.03 + Math.cos(index / 3) * 0.025).toFixed(4)),
      symbol_count: 430,
    })),
    evidence_heatmap: [
      { window: '10年', bucket: '样本内', value: 0.071, state: '通过' },
      { window: '10年', bucket: '样本外', value: 0.054, state: '通过' },
      { window: '20年', bucket: '样本内', value: 0.052, state: '通过' },
      { window: '20年', bucket: '压力', value: -0.024, state: '缺口' },
    ],
    turnover_decay: {
      half_life_days: 126,
      annual_turnover_pct: 185,
      impact_cost_bps: 18,
      financing_cost_bps: 32,
    },
    stress_scenarios: [
      { id: 'dotcom-crisis-2000', name: '2000 互联网危机', start_date: '2000-03-01', end_date: '2002-10-31', data_kind: '历史压力场景/可代理', coverage_source: 'historical_or_proxy', blocks_factor_admission: false, status: '需要复核', rank_ic: -0.06 },
      { id: 'gfc-2008', name: '2008 金融危机', start_date: '2008-09-01', end_date: '2009-03-31', data_kind: '历史压力场景/可代理', coverage_source: 'historical_or_proxy', blocks_factor_admission: false, status: '需要复核', rank_ic: -0.08 },
      { id: 'bear-market-2022', name: '2022 熊市/加息冲击', start_date: '2022-01-03', end_date: '2022-10-14', data_kind: '真实 PIT 样本', coverage_source: 'pit_price_window', blocks_factor_admission: false, status: '观察', rank_ic: 0.02 },
    ],
    risk_flags: ['市场风格切换时需关注动量崩溃。'],
    compliance_trail: {
      factor_logic: 'Close(t-21) / Close(t-252) - 1',
      dataset_snapshot_id: 'ds-price',
      fundamental_snapshot_id: 'ds-fundamentals',
      universe_snapshot_id: 'un-sp500',
      cleaning_version: 'snapshot-derived-v1',
      diagnosed_at: '2026-04-30T10:20:00Z',
    },
  };
}

const demoFactorUpdatedAt: Record<string, string> = {
  s_vol_252d_rank: '2026-05-04T09:40:00Z',
  s_mom_12m1m_rank: '2026-05-03T16:15:00Z',
  s_val_bp_latest_raw: '2026-05-03T09:05:00Z',
  s_val_ep_ltm_raw: '2026-05-02T11:30:00Z',
  s_qlty_roe_ltm_raw: '2026-05-02T08:35:00Z',
  s_qlty_fcfy_ttm_raw: '2026-05-01T15:05:00Z',
  s_size_cur_log: '2026-04-30T10:20:00Z',
};

const factorFamilyLabels: Record<string, string> = {
  val: '估值',
  mom: '动量',
  qlty: '质量',
  vol: '风险',
  size: '规模',
  alpha: '其他',
  beta: '风险',
  inv: '质量',
  liq: '情绪',
};

function isFactorOffline(factor: ApiFactorListItem): boolean {
  const lifecycle = String(factor.lifecycle_status ?? '').toUpperCase();
  return lifecycle === 'DEPRECATED' || lifecycle === 'PRUNED' || Boolean(factor.offline_at);
}

function demoFactorTierLevel(factor: Pick<ApiFactorListItem, 'id' | 'expression' | 'descriptor' | 'source'>): 'F1' | 'F2' | 'F3' {
  const category = String(factor.descriptor?.category ?? '').toLowerCase();
  const expression = String(factor.expression ?? '');
  if (category === 'alpha' || factor.id.includes('_alpha_') || /ffblend|blend|composite/i.test(expression)) return 'F3';
  if (factor.descriptor?.operator === 'raw' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(expression.trim())) return 'F1';
  return 'F2';
}

function demoFactorLifecycle(factor: ApiFactorListItem): 'sandbox' | 'online' | 'offline' | 'to_be_verified' | 'archived' {
  if (
    factor.lifecycle === 'sandbox' ||
    factor.lifecycle === 'online' ||
    factor.lifecycle === 'offline' ||
    factor.lifecycle === 'to_be_verified' ||
    factor.lifecycle === 'archived'
  ) {
    return factor.lifecycle;
  }
  if (isFactorOffline(factor)) return 'archived';
  if (['BLOCKED_DATA', 'BLOCKED_PIT', 'FAILED'].includes(String(factor.diagnostic_status ?? '').toUpperCase())) return 'to_be_verified';
  if (factor.lifecycle_status === 'DRAFT' && factor.source !== 'SYSTEM_SEED') return 'sandbox';
  return 'online';
}

function demoFactorOpStatus(factor: ApiFactorListItem): ApiFactorListItem['op_status'] {
  const expression = String(factor.expression ?? '').toLowerCase();
  const operator = String(factor.descriptor?.operator ?? '').toLowerCase();
  const lights = [
    { code: 'W', key: 'winsorize', label: '去极值', active: /winsor|mad/.test(expression), status: 'missing' },
    { code: 'N', key: 'neutralize', label: '中性化', active: /neutral|residual|beta/.test(expression), status: 'missing' },
    { code: 'Z', key: 'zscore', label: '标准化', active: operator === 'z' || /zscore|z_score/.test(expression), status: 'missing' },
    { code: 'T', key: 'tsrank', label: '时序排名', active: operator === 'rank' || /rank|tsrank/.test(expression), status: 'missing' },
  ].map((item) => ({ ...item, status: item.active ? 'done' : 'missing' }));
  return {
    lights,
    completed: lights.filter((item) => item.active).map((item) => item.code),
    missing: lights.filter((item) => !item.active).map((item) => item.code),
    summary: lights.filter((item) => item.active).map((item) => `${item.code} ${item.label}`).join(' / ') || '原始字段',
  };
}

function withDemoFactorGovernanceProjection(factor: ApiFactorListItem): ApiFactorListItem {
  const tier = factor.tier_level ?? demoFactorTierLevel(factor);
  const lifecycle = demoFactorLifecycle(factor);
  const level = factor.factor_level ?? (lifecycle === 'archived' ? 'D' : (factor.latest_diagnostic_summary ? 'A' : tier === 'F1' ? 'B' : 'C'));
  return {
    ...factor,
    tier_level: tier,
    tier_label: factor.tier_label ?? (tier === 'F1' ? 'F1 原始' : tier === 'F3' ? 'F3 组合' : 'F2 改造'),
    tier_projection: factor.tier_projection ?? {
      key: tier,
      label: tier === 'F1' ? 'F1 原始' : tier === 'F3' ? 'F3 组合' : 'F2 改造',
      description: tier === 'F1' ? '直接映射 API 或数据库的原始字段' : tier === 'F3' ? '多因子融合后的最终信号' : '单因子提纯后的改造结果',
    },
    lifecycle,
    lifecycle_label: factor.lifecycle_label ?? (lifecycle === 'sandbox' ? '沙箱' : lifecycle === 'to_be_verified' ? '待校准' : lifecycle === 'archived' ? '已归档' : '线上'),
    lifecycle_projection: factor.lifecycle_projection ?? {
      key: lifecycle,
      label: lifecycle === 'sandbox' ? '沙箱' : lifecycle === 'to_be_verified' ? '待校准' : lifecycle === 'archived' ? '已归档' : '线上',
      description: '因子库一期治理生命周期投影',
    },
    factor_level: level,
    factor_level_label: factor.factor_level_label ?? `${level}${level === 'S' ? '顶级' : level === 'A' ? '优秀' : level === 'B' ? '合格' : level === 'C' ? '微弱' : '噪声'}`,
    factor_level_projection: factor.factor_level_projection ?? {
      key: level,
      label: `${level}${level === 'S' ? '顶级' : level === 'A' ? '优秀' : level === 'B' ? '合格' : level === 'C' ? '微弱' : '噪声'}`,
      description: '按 IC/IR、覆盖率、稳定性与阻断状态综合评级',
    },
    op_status: factor.op_status ?? demoFactorOpStatus(factor),
    lineage_summary: factor.lineage_summary ?? {
      has_lineage: true,
      parent_count: tier === 'F3' ? 4 : Math.max(1, factor.data_requirements.length),
      parent_ids: tier === 'F3'
        ? ['s_mom_12m1m_rank', 's_val_ep_ltm_raw', 's_qlty_roe_ltm_raw', 's_size_cur_log']
        : factor.data_requirements.slice(0, 4),
      root_source: tier === 'F3' ? 's_mom_12m1m_rank' : factor.data_requirements[0] ?? factor.expression,
      relation_types: [tier === 'F3' ? 'COMPOSED_FROM' : tier === 'F1' ? 'DIRECT_SOURCE' : 'DERIVED_FROM'],
    },
    quality_view: factor.quality_view ?? {
      rank_ic: factor.latest_diagnostic_summary?.rank_ic ?? null,
      ir: factor.latest_diagnostic_summary?.ir ?? null,
      coverage: factor.latest_diagnostic_summary?.coverage ?? null,
      decay_days: 21,
      decay_label: '21日',
      sparkline: factor.ic_sparkline,
      sparkline_window: factor.ic_sparkline_window,
    },
  };
}

function createFactorListItems(): ApiFactorListItem[] {
  const factors: Array<Omit<ApiFactorListItem, 'ic_sparkline' | 'ic_sparkline_window' | 'readiness_blockers' | 'gate_fix_target'>> = [
    {
      id: 's_mom_12m1m_rank',
      name: 'Rank-12-1月截面动量 (排序)',
      market: 'US',
      universe: 'SP500',
      source: 'SYSTEM_SEED',
      lifecycle_status: 'VERIFIED',
      diagnostic_status: 'READY_TO_DIAGNOSE',
      direction: 'HIGH_IS_BETTER',
      frequency: 'DAILY',
      expression: 'Close(t-21) / Close(t-252) - 1',
      descriptor: { source_prefix: 's', category: 'mom', metric: '', window: '12m1m', operator: 'rank', schema_version: 'factor_descriptor_v1', canonical_id: 's_mom_12m1m_rank' },
      tags: ['默认因子', '动量', '价格可诊断'],
      data_requirements: ['adj_close', 'price_history', 'returns'],
      institutional_note: '趋势延续因子在单边市中较强，市场拐点需要监控动量崩溃。',
      latest_diagnostic_summary: createFactorDiagnosticSummary('s_mom_12m1m_rank'),
      last_diagnostic_run_id: 'fdiag-s_mom_12m1m_rank',
    },
    {
      id: 's_val_ep_ltm_raw',
      name: '盈利收益率 (LTM) (原始)',
      market: 'US',
      universe: 'SP500',
      source: 'SYSTEM_SEED',
      lifecycle_status: 'VERIFIED',
      diagnostic_status: 'READY_TO_DIAGNOSE',
      direction: 'HIGH_IS_BETTER',
      frequency: 'DAILY',
      expression: 'LtmEarnings / MarketCap',
      descriptor: { source_prefix: 's', category: 'val', metric: 'ep', window: 'ltm', operator: 'raw', schema_version: 'factor_descriptor_v1', canonical_id: 's_val_ep_ltm_raw' },
      tags: ['默认因子', '估值', '基础面可诊断'],
      data_requirements: ['ltm_earnings', 'market_cap'],
      institutional_note: '估值因子长周期稳健，但成长股牛市中可能经历较长回撤。',
      latest_diagnostic_summary: createFactorDiagnosticSummary('s_val_ep_ltm_raw'),
      last_diagnostic_run_id: 'fdiag-s_val_ep_ltm_raw',
    },
    {
      id: 's_val_bp_latest_raw',
      name: '账面市值比 (最新) (原始)',
      market: 'US',
      universe: 'SP500',
      source: 'SYSTEM_SEED',
      lifecycle_status: 'VERIFIED',
      diagnostic_status: 'READY_TO_DIAGNOSE',
      direction: 'HIGH_IS_BETTER',
      frequency: 'DAILY',
      expression: 'BookValueEquity / MarketCap',
      descriptor: { source_prefix: 's', category: 'val', metric: 'bp', window: 'latest', operator: 'raw', schema_version: 'factor_descriptor_v1', canonical_id: 's_val_bp_latest_raw' },
      tags: ['默认因子', '估值', '基础面可诊断'],
      data_requirements: ['book_value_equity', 'market_cap', 'shares_outstanding'],
      institutional_note: '账面市值比适合补充盈利口径，需结合行业资产结构观察。',
      latest_diagnostic_summary: createFactorDiagnosticSummary('s_val_bp_latest_raw'),
      last_diagnostic_run_id: 'fdiag-s_val_bp_latest_raw',
    },
    {
      id: 's_vol_252d_rank',
      name: 'Rank-252日波动率 (排序)',
      market: 'US',
      universe: 'SP500',
      source: 'SYSTEM_SEED',
      lifecycle_status: 'VERIFIED',
      diagnostic_status: 'READY_TO_DIAGNOSE',
      direction: 'LOW_IS_BETTER',
      frequency: 'DAILY',
      expression: 'Std(Return(Close, 1), 252)',
      descriptor: { source_prefix: 's', category: 'vol', metric: '', window: '252d', operator: 'rank', schema_version: 'factor_descriptor_v1', canonical_id: 's_vol_252d_rank' },
      tags: ['默认因子', '低波动', '价格可诊断'],
      data_requirements: ['adj_close', 'price_history', 'returns'],
      institutional_note: '低波动策略适合强调风险调整收益和回撤控制的资金。',
      latest_diagnostic_summary: createFactorDiagnosticSummary('s_vol_252d_rank'),
      last_diagnostic_run_id: 'fdiag-s_vol_252d_rank',
    },
    {
      id: 's_qlty_roe_ltm_raw',
      name: '净资产收益率 (LTM) (原始)',
      market: 'US',
      universe: 'SP500',
      source: 'SYSTEM_SEED',
      lifecycle_status: 'VERIFIED',
      diagnostic_status: 'READY_TO_DIAGNOSE',
      direction: 'HIGH_IS_BETTER',
      frequency: 'DAILY',
      expression: 'LtmEarnings / BookValueEquity',
      descriptor: { source_prefix: 's', category: 'qlty', metric: 'roe', window: 'ltm', operator: 'raw', schema_version: 'factor_descriptor_v1', canonical_id: 's_qlty_roe_ltm_raw' },
      tags: ['默认因子', '质量', '基础面可诊断'],
      data_requirements: ['ltm_earnings', 'book_value_equity'],
      institutional_note: 'ROE 用于衡量资本效率，需避免未来财报或当前快照穿越。',
      latest_diagnostic_summary: createFactorDiagnosticSummary('s_qlty_roe_ltm_raw'),
      last_diagnostic_run_id: 'fdiag-s_qlty_roe_ltm_raw',
    },
    {
      id: 's_size_cur_log',
      name: '对数市值 (当前) (原始)',
      market: 'US',
      universe: 'SP500',
      source: 'SYSTEM_SEED',
      lifecycle_status: 'VERIFIED',
      diagnostic_status: 'READY_TO_DIAGNOSE',
      direction: 'LOW_IS_BETTER',
      frequency: 'DAILY',
      expression: 'Log(MarketCap)',
      descriptor: { source_prefix: 's', category: 'size', metric: '', window: 'cur', operator: 'log', schema_version: 'factor_descriptor_v1', canonical_id: 's_size_cur_log' },
      tags: ['默认因子', '规模', '基础面可诊断'],
      data_requirements: ['market_cap', 'shares_outstanding'],
      institutional_note: '小市值溢价需要同时关注流动性枯竭和成交容量风险。',
      latest_diagnostic_summary: createFactorDiagnosticSummary('s_size_cur_log'),
      last_diagnostic_run_id: 'fdiag-s_size_cur_log',
    },
    {
      id: 's_qlty_fcfy_ttm_raw',
      name: '自由现金流收益率 (TTM) (原始)',
      market: 'US',
      universe: 'SP500',
      source: 'SYSTEM_SEED',
      lifecycle_status: 'VERIFIED',
      diagnostic_status: 'READY_TO_DIAGNOSE',
      direction: 'HIGH_IS_BETTER',
      frequency: 'DAILY',
      expression: '(OperatingCashFlowLTM - CapexLTM) / EnterpriseValue',
      descriptor: { source_prefix: 's', category: 'qlty', metric: 'fcfy', window: 'ttm', operator: 'raw', schema_version: 'factor_descriptor_v1', canonical_id: 's_qlty_fcfy_ttm_raw' },
      tags: ['默认因子', '质量', '基础面可诊断'],
      data_requirements: ['operating_cash_flow_ltm', 'capex_ltm', 'enterprise_value'],
      institutional_note: '质量因子偏防守，在震荡或下跌市场通常提供下行保护。',
      latest_diagnostic_summary: createFactorDiagnosticSummary('s_qlty_fcfy_ttm_raw'),
      last_diagnostic_run_id: 'fdiag-s_qlty_fcfy_ttm_raw',
    },
  ];
  return factors.map((factor, index) => {
    const blocked = factor.diagnostic_status === 'BLOCKED_DATA';
    const sparkline = factor.latest_diagnostic_summary?.ic_series?.length
      ? factor.latest_diagnostic_summary.ic_series.map((point) => ({
          date: point.date,
          value: Number(point.rank_ic ?? point.ic ?? 0),
        }))
      : Array.from({ length: 12 }, (_, cursor) => ({
          date: `T-${12 - cursor}`,
          value: Number((0.01 + Math.sin((cursor + index) / 2) * 0.025).toFixed(4)),
        }));
    const diagnosticGapSummary = blocked
      ? {
          rank_ic: `Rank IC: 基础字段缺失 (${factor.data_requirements.join(', ')})`,
          coverage: `覆盖: ${factor.data_requirements.join(', ')} 待补`,
          next_action: '去 PIT 清洗中心补基础字段',
        }
      : factor.latest_diagnostic_summary
        ? {}
        : {
            rank_ic: 'Rank IC: 尚未提交诊断',
            coverage: '覆盖: 等待首次诊断',
            next_action: '提交 Verified 诊断',
          };
    return withDemoFactorGovernanceProjection({
      ...factor,
      factor_family: factorFamilyLabels[factor.descriptor?.category ?? ''] ?? '自定义',
      formula_version: 'seed-v2',
      pit_coverage: {
        required_fields: factor.data_requirements,
        missing_fields: [],
        available_at_gate: true,
      },
      coverage_loss: 0,
      created_at: '2026-04-30T10:00:00Z',
      updated_at: demoFactorUpdatedAt[factor.id] ?? '2026-04-30T10:00:00Z',
      readiness_blockers: blocked
        ? [
            {
              code: 'FACTOR_DATA_REQUIREMENT_MISSING',
              message: '一期尚未接入该因子所需的个股基本面 PIT 字段。',
              missing_fields: factor.data_requirements,
              fix_hash: '#/pit-data?section=fundamental-requirements',
            },
          ]
        : [],
      ic_sparkline: sparkline,
      ic_sparkline_window: '最近12期',
      gate_fix_target: blocked ? '#/pit-data?section=fundamental-requirements' : '#/pit-data',
      diagnostic_gap_summary: diagnosticGapSummary,
    });
  });
}

function createFactorGovernanceOverview(items = createFactorListItems()): ApiFactorGovernanceOverview {
  const reviewFactor = items.find((item) => item.strategy_creation_risk?.warning_count);
  const autoFactor = items.find((item) => item.source === 'AUTO_MINED') ?? reviewFactor ?? items[0];
  const factorIds = [
    autoFactor?.id ?? 's_mom_12m1m_rank',
    's_val_ep_ltm_raw',
    's_vol_252d_rank',
  ].filter((item, index, array) => item && array.indexOf(item) === index);
  const modelSuggestionFactorIds = factorIds.slice(0, 1);
  const modelSuggestionBaseName = String(autoFactor?.name ?? autoFactor?.id ?? 'Auto-Mined').trim();
  const modelSuggestionName = modelSuggestionBaseName.endsWith('\u56e0\u5b50\u7b56\u7565')
    ? modelSuggestionBaseName
    : modelSuggestionBaseName.endsWith('\u56e0\u5b50')
      ? `${modelSuggestionBaseName}\u7b56\u7565`
      : `${modelSuggestionBaseName}\u56e0\u5b50\u7b56\u7565`;
  return {
    as_of: nowIso(),
    queue_count: 7,
    actions: [
      {
        id: 'gq-deprecate-demo',
        kind: 'DEPRECATE',
        command: 'DEPRECATE',
        label: '强制下线',
        title: '低效噪声因子满足强制下线条件',
        detail: 'Grade D、20 个交易日低效且 Q1/Q5 严重倒挂，确认后标记为已强制下线。',
        factor_ids: ['s_mom_12m1m_rank'],
        affected_factor_ids: ['s_mom_12m1m_rank'],
        offline_reason: '强制下线：Grade D、低效 20 个交易日且分组收益倒挂。',
        offline_detail: { grade: 'D', rank_ic: 0.002, ir: 0.12, group_inverted: true },
        severity: 'danger',
      },
      {
        id: 'gq-prune-demo',
        kind: 'PRUNE',
        command: 'PRUNE',
        label: '冗余裁剪',
        title: 'BP 因子与 EP 因子同簇高相关',
        detail: '同簇相关性超过 0.90，保留 IR/覆盖率更优的 MVP 因子。',
        factor_ids: ['s_val_bp_latest_raw'],
        affected_factor_ids: ['s_val_bp_latest_raw'],
        keep_factor_id: 's_val_ep_ltm_raw',
        offline_reason: '冗余裁剪：同簇高相关且弱于盈利收益率 (LTM) (原始)',
        offline_detail: {
          keep_factor_id: 's_val_ep_ltm_raw',
          correlation: 0.93,
          comparison: {
            candidate: { factor_id: 's_val_bp_latest_raw', factor_name: '账面市值比 (最新) (原始)' },
            mvp: { factor_id: 's_val_ep_ltm_raw', factor_name: '盈利收益率 (LTM) (原始)' },
          },
        },
        severity: 'warning',
      },
      {
        id: 'gq-review-demo',
        kind: 'REVIEW',
        label: '待复核',
        title: '估值同簇待复核',
        detail: '估值因子出现同簇重叠，进入组合前请复核相关性和权重集中度。',
        factor_ids: ['s_val_ep_ltm_raw'],
        severity: 'warning',
      },
      {
        id: 'gq-decay-demo',
        kind: 'DECAYED',
        label: '退化观察',
        title: '短窗动量表现退化观察',
        detail: '最近 OOS Rank IC 低于发布基线，暂不建议升权。',
        factor_ids: ['s_mom_12m1m_rank'],
        severity: 'danger',
      },
      {
        id: 'gq-watch-demo',
        kind: 'WATCH',
        label: '观察',
        title: '低波因子拥挤度观察',
        detail: '引用密度上升但尚未触发阻断，保持 WATCH 状态。',
        factor_ids: ['s_vol_252d_rank'],
        severity: 'info',
      },
      {
        id: 'gq-optimize-downside-demo',
        kind: 'FACTOR_OPTIMIZATION',
        command: 'PUBLISH_OPTIMIZED_FACTOR',
        label: '因子优化',
        title: '下行波动率代理（252日） 生成反向因子待入库',
        detail: '分组收益连续倒挂，已生成反向下行风险 Alpha 并再次诊断为 Grade B，等待确认入库。',
        factor_ids: ['s_vol_downside_252d_rank'],
        affected_factor_ids: ['s_vol_downside_252d_rank'],
        severity: 'info',
        optimized_factor: {
          id: 's_alpha_vol_downsiderev_std_rk',
          name: '反向下行风险 Alpha (精炼)',
          expression: 'DownsideStd(Return(Close, 1), 252)',
          direction: 'HIGH_IS_BETTER',
          grade: 'B',
          confirmable: true,
          diagnostic_summary: { rank_ic: 0.024, ir: 0.82, coverage: 96.4 },
        },
      },
      {
        id: 'gq-model-demo',
        kind: 'FACTOR_MODEL_SUGGESTION',
        label: '策略创建建议',
        title: modelSuggestionName,
        detail: '该 L3 组合因子已达到 S/A 级，且当前线上多因子策略尚未引用；建议以该因子 100% 权重生成待审查策略草稿。',
        factor_ids: modelSuggestionFactorIds,
        suggested_weights: modelSuggestionFactorIds.map((factorId) => ({
          factor_id: factorId,
          weight_pct: 100,
          direction: factorId.includes('vol') ? 'LOW_IS_GOOD' : 'HIGH_IS_GOOD',
        })),
        severity: 'info',
        target: {
          route: '#/factor-models/new',
          query: {
            source: 'governance_queue',
            factorIds: modelSuggestionFactorIds[0] ?? '',
            weights: '100',
            directions: (modelSuggestionFactorIds[0] ?? '').includes('vol') ? 'LOW_IS_GOOD' : 'HIGH_IS_GOOD',
            modelName: modelSuggestionName,
          },
        },
      },
    ],
    summary: { deprecate_count: 1, prune_count: 1, review_count: 1, decayed_count: 1, crowded_count: 1, suggestion_count: 1, optimization_count: 1 },
  };
}

function createFactorQuarantineCandidates(): ApiFactorQuarantineCandidateListResponse {
  return {
    items: [
      {
        id: 'fq_demo_mom_001',
        mining_candidate_id: 'cand_demo_mom_001',
        source_mining_job_id: 'fmj_demo_001',
        expression: 'Rank(Close(t-21) / Close(t-252) - 1)',
        status: 'PASSED',
        publish_status: 'ELIGIBLE',
        gate_summary: { pit: 'Full Ready', is: '通过', oos: '通过', orthogonal: '通过', dedupe: '未命中重复表达式' },
        cluster_id: 'cluster_demo_mom',
        candidate_metrics: { rank_ic: 0.041, ir: 0.72, coverage: 91.2 },
        failure_samples: [],
        pit_evidence: { status: 'READY', dataset_snapshot_id: 'ds-price', universe_snapshot_id: 'un-sp500' },
        publish_eligibility: { status: 'ELIGIBLE', reason: '通过 D2 检疫，允许自动发布。' },
        target_factor_id: null,
        created_at: nowIso(),
        updated_at: nowIso(),
      },
    ],
    summary: { total: 1, passed_count: 1, needs_review_count: 0, published_count: 0 },
  };
}

function createFactorDetail(id: string): ApiFactorDetail {
  const aliases: Record<string, string> = {
    momentum_12m_1m: 's_mom_12m1m_rank',
    value_ep_ltm: 's_val_ep_ltm_raw',
    value_bp_latest: 's_val_bp_latest_raw',
    quality_roe_ltm: 's_qlty_roe_ltm_raw',
    lowvol_realized_252d: 's_vol_252d_rank',
    size_log_market_cap: 's_size_cur_log',
    quality_fcf_yield: 's_qlty_fcfy_ttm_raw',
  };
  const factors = createFactorListItems();
  const factor = factors.find((item) => item.id === (aliases[id] ?? id));
  if (!factor) {
    throw new ApiError({ status: 404, code: 'factor_not_found', message: `因子 ${id} 不存在。` });
  }
  return {
    ...factor,
    versions: [
      {
        id: `${factor.id}-v1`,
        version: 1,
        expression: factor.expression,
        status: 'ACTIVE',
        metadata: { source: factor.source },
        created_at: '2026-04-30T10:00:00Z',
      },
    ],
    correlation_cluster: {
      anchor_factor_id: factor.id,
      top_n: 4,
      method: '最近诊断 Rank IC 序列相关；无诊断时使用公式族先验占位。',
      nodes: factors
        .filter((item) => item.id !== factor.id)
        .slice(0, 4)
        .map((item, index) => ({
          factor_id: item.id,
          name: item.name,
          source: item.source,
          correlation: Number((0.72 - index * 0.11).toFixed(2)),
          risk_label: item.diagnostic_status === 'BLOCKED_DATA' ? '基础数据待补' : '可复核',
        })),
    },
  };
}

function createDemoMiningJob(
  payload: ApiFactorMiningJobCreatePayload,
  status: ApiFactorMiningJob['status'] = 'COMPLETED',
): ApiFactorMiningJob {
  const evaluated = status === 'CANCELLED' ? Math.min(240, payload.candidate_count) : payload.candidate_count;
  const failed = status === 'CANCELLED' ? 2 : Math.max(1, Math.floor(payload.candidate_count * 0.01));
  return {
    id: status === 'CANCELLED' ? 'fm-demo-cancelled' : 'fm-demo-1000',
    status,
    request: payload,
    progress: {
      total_candidates: payload.candidate_count,
      evaluated_candidates: evaluated,
      failed_candidates: failed,
      throughput_per_second: 48.5,
      percent: payload.candidate_count > 0 ? Number(((evaluated / payload.candidate_count) * 100).toFixed(1)) : 0,
    },
    top_candidates: [
      {
        id: 'cand-demo-rank-001',
        expression: 's_mom_6m_rank * s_qlty_roe_ltm_raw',
        score: 0.061,
        rank_ic: 0.061,
        turnover: 0.32,
        coverage: 0.96,
        depth: 3,
        fitness_score: 0.054,
        max_style_correlation: 0.24,
        correlation_penalty: 0,
        max_drawdown_pct: 0.18,
        benchmark_max_drawdown_pct: 0.16,
        drawdown_vs_benchmark_ratio: 1.12,
        auto_residual_summary: null,
        source_factor_ids: ['s_mom_6m_rank', 's_qlty_roe_ltm_raw'],
        recipe_kind: 'template',
        recipe_family: 'style_blend',
        orthogonality_intent: 'quality_driven_momentum',
        composition_metadata: { label: 'Quality-Driven Momentum', publish_boundary: 'manual_after_quarantine' },
        risk_flags: ['候选不会直接进入正式因子库'],
      },
      {
        id: 'cand-demo-rank-002',
        expression: 's_mom_6m_rank / s_vol_252d_rank',
        score: 0.048,
        rank_ic: 0.048,
        turnover: 0.21,
        coverage: 0.91,
        depth: 2,
        fitness_score: 0.031,
        max_style_correlation: 0.52,
        correlation_penalty: 0.22,
        max_drawdown_pct: 0.2,
        benchmark_max_drawdown_pct: 0.16,
        drawdown_vs_benchmark_ratio: 1.25,
        auto_residual_summary: {
          residual_expression: 'ZScore(Residual(s_mom_6m_rank, by="s_vol_252d_raw"))',
          control_factor_id: 's_vol_252d_raw',
          residual_rank_ic: 0.043,
        },
        source_factor_ids: ['s_mom_6m_rank', 's_vol_252d_rank'],
        recipe_kind: 'template',
        recipe_family: 'risk_adjusted',
        orthogonality_intent: 'risk_adjusted_momentum',
        composition_metadata: { label: 'Risk-Adjusted Momentum', publish_boundary: 'manual_after_quarantine' },
        risk_flags: ['规模因子需复核容量约束'],
      },
      {
        id: 'cand-demo-rank-003',
        expression: 'ZScore(Std(Return(Close, 1), 63)) * -1',
        score: 0.039,
        rank_ic: 0.039,
        turnover: 0.28,
        coverage: 0.98,
        depth: 4,
        fitness_score: 0.028,
        max_style_correlation: 0.29,
        correlation_penalty: 0,
        max_drawdown_pct: 0.24,
        benchmark_max_drawdown_pct: 0.16,
        drawdown_vs_benchmark_ratio: 1.5,
        auto_residual_summary: null,
        risk_flags: [],
      },
    ],
    failed_samples: [
      { expression: 'Return(Close, -5)', reason: '拒绝未来引用 t+N。' },
      { expression: 'eval(Close)', reason: '拒绝未授权执行算子。' },
    ],
    created_at: nowIso(),
    updated_at: nowIso(),
    completed_at: status === 'COMPLETED' || status === 'CANCELLED' ? nowIso() : null,
  };
}

function createDemoFactorFactoryOverview(
  profileStatus: 'ACTIVE' | 'PAUSED' = 'PAUSED',
  trigger: 'DAILY' | 'MANUAL' = 'DAILY',
  runStatus: ApiFactorFactoryRun['status'] = 'COMPLETED',
): ApiFactorFactoryOverview {
  const request: ApiFactorMiningJobCreatePayload = {
    universe: 'SP500',
    start_date: '2020-01-01',
    end_date: '2025-12-31',
    operators: ['Return', 'Std', 'Rank', 'ZScore', 'Winsorize'],
    candidate_count: 40,
    random_seed: 42,
    min_rank_ic: 0.03,
    max_depth: 4,
    generation_mode: 'HYBRID_COMPOSITION',
    source_factor_ids: [
      's_mom_6m_rank',
      's_qlty_roe_ltm_raw',
      's_vol_252d_rank',
      's_val_cfp_ltm_raw',
      's_size_cur_log',
      's_vol_downside_252d_rank',
      's_liq_amihud_20d_rank',
    ],
    recipe_families: [
      'style_blend',
      'risk_adjusted',
      'value_anchor',
      'divergence',
      'residual_neutralized',
      'ts_denoise',
    ],
    exploration_budget: 24,
    composition_policy: {
      mode: 'template_plus_exploration',
      publish_boundary: 'manual_after_quarantine',
      auto_intake_to_quarantine: true,
    },
  };
  const gatePolicy = {
    pit_gate_mode: 'DIAGNOSTIC_ONLY' as const,
    max_style_correlation: 0.3,
    residual_enabled: true,
    max_drawdown_relative_to_benchmark: 1.5,
    min_oos_to_is_ratio: 0.5,
  };
  const miningJob = createDemoMiningJob(request, runStatus === 'CANCELLED' ? 'CANCELLED' : 'COMPLETED');
  const quarantine = createFactorQuarantineCandidates();
  const run: ApiFactorFactoryRun = {
    id: trigger === 'DAILY' ? 'ffr_demo_daily' : 'ffr_demo_manual',
    profile_id: 'default',
    run_date: '2026-05-08',
    trigger,
    status: runStatus,
    request,
    gate_policy: gatePolicy,
    config_signature: 'demo-factory',
    mining_job_id: miningJob.id,
    mining_job: miningJob,
    summary: {
      trigger,
      daily_automation: trigger === 'DAILY',
      pit_gate_mode: 'DIAGNOSTIC_ONLY',
      residual_enabled: true,
      drawdown_threshold: 1.5,
      top_candidate_count: miningJob.top_candidates.length,
      funnel: {
        mined_candidates: miningJob.top_candidates.length,
        quarantine_candidates: quarantine.items.length,
      },
    },
    started_at: nowIso(),
    completed_at: runStatus === 'COMPLETED' || runStatus === 'CANCELLED' ? nowIso() : null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const passed = quarantine.items.filter((item) => item.status === 'PASSED').length;
  const published = quarantine.items.filter((item) => item.status === 'PUBLISHED').length;
  return {
    profile: {
      id: 'default',
      status: profileStatus,
      timezone: 'Asia/Hong_Kong',
      schedule_time: '14:00',
      request,
      gate_policy: gatePolicy,
      created_at: nowIso(),
      updated_at: nowIso(),
      last_run_date: profileStatus === 'ACTIVE' ? '2026-05-08' : null,
      next_run_at: '2026-05-08T14:00:00+08:00',
    },
    active_run: runStatus === 'RUNNING' || runStatus === 'QUEUED' ? run : null,
    latest_run: run,
    runs: [run],
    funnel: {
      mined_candidates: miningJob.top_candidates.length,
      quarantine_candidates: quarantine.items.length,
      passed,
      review_or_observation: quarantine.items.filter((item) => item.status === 'NEEDS_REVIEW').length,
      rejected: quarantine.items.filter((item) => item.status === 'REJECTED').length,
      published,
    },
    mining: {
      items: [miningJob],
      summary: {
        total: 1,
        completed_count: runStatus === 'COMPLETED' ? 1 : 0,
        running_count: runStatus === 'RUNNING' ? 1 : 0,
        total_candidates: miningJob.progress.total_candidates,
      },
    },
    quarantine,
    gate_policy: gatePolicy,
  };
}

function createDemoFactorModelPreview(payload: ApiFactorModelPreviewPayload): ApiFactorModelPreviewResponse {
  const totalWeight = payload.components.reduce((total, item) => total + Math.abs(Number(item.weight ?? 0)), 0) || 1;
  const neutralizationBlocked = payload.neutralization.enabled;
  const isComposite = payload.strategy_type === 'COMPOSITE_FACTOR';
  const compositeRisk = isComposite ? {
    can_create: true,
    warning_count: 0,
    blocked_count: 0,
    warnings: [],
    hard_blockers: [],
    summary_label: '可创建',
    summary: '组合因子策略准入检查通过。',
    eligibility: { completed_ops: ['W', 'N', 'Z', 'T'], missing_ops: [] },
    diagnostic_summary: { status: 'COMPLETED', rank_ic: 0.061, ir: 1.34, coverage: 0.92, weak_sectors: [{ group: 'Utilities', mean_return: -0.018 }] },
    sector_cap_forecast: { cut_weight_pct: 11.4, residual_cash_pct: payload.weight_mapping?.cap_redistribution_mode === 'proportional_refill' ? 0 : 0.6, invested_pct: payload.weight_mapping?.cap_redistribution_mode === 'proportional_refill' ? 100 : 99.4 },
    cost_forecast: { average_slippage_bps: 6.8, fixed_cost_bps: 1.5, impact_beta: 0.65, max_impact_bps: 75 },
  } : undefined;
  return {
    strategy_type: isComposite ? 'COMPOSITE_FACTOR' : 'MULTI_FACTOR',
    status: neutralizationBlocked ? 'BLOCKED' : 'READY',
    normalized_weights: payload.components.map((component) => ({
      ...component,
      normalized_weight: Number((Math.abs(component.weight) / totalWeight).toFixed(4)),
    })),
    coverage: {
      estimated_factor_coverage: 0.914,
      min_factor_coverage: 0.846,
      pit_snapshot_refs: {
        dataset_snapshot_id: 'ds-price',
        fundamental_snapshot_id: 'ds-fundamentals',
        universe_snapshot_id: 'un-sp500',
      },
    },
    score_preview: [
      { symbol: 'MSFT', score: 1.42, rank: 1 },
      { symbol: 'AAPL', score: 1.16, rank: 2 },
      { symbol: 'NVDA', score: 0.94, rank: 3 },
      { symbol: 'JNJ', score: -0.62, rank: 497 },
    ],
    estimated_turnover: 0.36,
    pit_blockers: [],
    neutralization_status: neutralizationBlocked
      ? {
          enabled: true,
          method: payload.neutralization.method,
          status: 'NOT_EXECUTED_MISSING_INDUSTRY_PIT',
          blockers: ['MISSING_INDUSTRY_PIT'],
        }
      : {
          enabled: false,
          method: payload.neutralization.method,
          status: 'DISABLED',
          blockers: [],
        },
    strategy_creation_risk: compositeRisk,
    diagnostic_summary: compositeRisk?.diagnostic_summary,
    sector_cap_forecast: compositeRisk?.sector_cap_forecast,
    cost_forecast: compositeRisk?.cost_forecast,
    warnings: neutralizationBlocked ? ['行业 PIT 覆盖缺失，第一步只返回 blocker，不展示已执行。'] : [],
  };
}

function createDemoFactorModelStrategy(payload: ApiFactorModelCreatePayload): ApiStrategyDetail {
  const preview = createDemoFactorModelPreview(payload);
  const strategyType = payload.strategy_type ?? 'MULTI_FACTOR';
  if (preview.status === 'BLOCKED') {
    throw new ApiError({
      status: 400,
      code: 'factor_model_blocked',
      message: '多因子模型存在 PIT 或行业中性化 blocker，不能物化为策略。',
    });
  }
  const id = nextId('strat-mf');
  const parameterVersionId = `${id}-v1`;
  const parameters: Record<string, ParameterValue> = {
    strategy_type: strategyType,
    factor_model_type: strategyType,
    factor_ids: payload.components.map((component) => component.factor_id),
    weights: Object.fromEntries(payload.components.map((component) => [component.factor_id, component.weight])),
    directions: Object.fromEntries(payload.components.map((component) => [component.factor_id, component.direction])),
    neutralization: payload.neutralization,
    top_n: payload.top_n ?? (strategyType === 'COMPOSITE_FACTOR' ? 50 : 8),
    scoring_method: payload.scoring_method,
    rebalance_frequency: payload.rebalance_frequency,
    pit_snapshot_refs: preview.coverage ?? null,
    universe_filter: payload.universe_filter ?? null,
    weight_mapping: payload.weight_mapping ?? null,
    rebalance_logic: payload.rebalance_logic ?? null,
    execution_constraints: payload.execution_constraints ?? null,
    strategy_creation_risk: preview.strategy_creation_risk ?? null,
    diagnostic_summary: preview.diagnostic_summary ?? null,
    sector_cap_forecast: preview.sector_cap_forecast ?? null,
    cost_forecast: preview.cost_forecast ?? null,
  };
  const strategy = createStrategy({
    id,
    name: payload.name ?? '多因子核心模型',
    description: payload.description ?? '由因子库多因子构建器创建的可回测策略。',
    strategy_type: strategyType,
    universe_name: payload.universe,
    rebalance_frequency: payload.rebalance_frequency,
    latest_run_id: null,
    latest_optimization_job_id: null,
    current_parameter_version: 1,
    current_parameter_version_id: parameterVersionId,
    parameters,
    parameter_history: [
      {
        version_number: 1,
        parameter_version_id: parameterVersionId,
        revision: 1,
        created_at: nowIso(),
        comment: '多因子模型创建。',
        parameters,
      },
    ],
  });
  state.strategies.unshift(strategy);
  return strategy;
}

let state = createInitialState();

function findStrategy(id: string): ApiStrategyDetail {
  const strategy = state.strategies.find((item) => item.id === id);
  if (!strategy) {
    throw new ApiError({ status: 404, code: 'strategy_not_found', message: `Strategy ${id} was not found.` });
  }
  return strategy;
}

function findJob(id: string): ApiOptimizationJobDetail {
  const job = state.optimizationJobs.find((item) => item.id === id);
  if (!job) {
    throw new ApiError({ status: 404, code: 'optimization_job_not_found', message: `Optimization job ${id} was not found.` });
  }
  return job;
}

function promoteConflictKey(jobId: string, candidateId: string): string {
  return `${jobId}:${candidateId}`;
}

export function resetDemoStore(): void {
  state = createInitialState();
}

export function setPromoteConflict(jobId: string, candidateId: string): void {
  state.promoteConflicts.add(promoteConflictKey(jobId, candidateId));
}

export const demoApi: DemoApi = {
  async getWorkspaceOverview(_includeCleanupAudit = false, _signal?: AbortSignal): Promise<ApiWorkspaceOverview> {
    return clone({
      workspace_name: 'Grit Strategy Lab',
      subtitle: 'Creation, backtest, and optimization workspace for local strategy recovery.',
      strategy_count: state.strategies.length,
      active_run_count: 0,
      running_optimization_count: 0,
      latest_strategy_id: state.strategies[0]?.id ?? null,
      latest_backtest_run_id: state.runs[0]?.id ?? null,
      latest_optimization_job_id: state.optimizationJobs[0]?.id ?? null,
      top_momentum_warning: 'Refresh snapshots before trusting any newly materialized momentum strategy.',
      quick_actions: ['open_creation', 'start_backtest', 'open_optimization'],
    });
  },

  async listStrategies(_signal?: AbortSignal): Promise<ApiStrategyListItem[]> {
    return clone(state.strategies);
  },

  async getStrategyDetail(id: string): Promise<ApiStrategyDetail> {
    return clone(findStrategy(id));
  },

  async getCreationSession(id: string): Promise<ApiStrategyCreationSession> {
    const existing = state.sessions.find((session) => session.id === id);
    if (existing) {
      return clone(existing);
    }
    throw new ApiError({ status: 404, code: 'session_not_found', message: `Session ${id} was not found.` });
  },

  async createCreationSession(payload): Promise<ApiStrategyCreationSession> {
    const session: ApiStrategyCreationSession = {
      id: nextId('cs'),
      status: 'DRAFTING',
      revision: 1,
      messages: [],
      mode: 'CREATE',
      ...payload,
    };
    state.sessions.unshift(session);
    return clone(session);
  },

  async appendCreationMessage(id: string, content: string): Promise<ApiStrategyCreationSession> {
    const session = await this.getCreationSession(id);
    const updated = {
      ...session,
      messages: [...(session.messages ?? []), { content }],
      status: 'NEEDS_INPUT',
    };
    state.sessions = state.sessions.map((item) => (item.id === id ? updated : item));
    return clone(updated);
  },

  async prepareConfirmation(id: string): Promise<ApiStrategyCreationSession> {
    return this.getCreationSession(id);
  },

  async updateConfirmation(id: string, payload: ApiConfirmationUpdateRequest): Promise<ApiStrategyCreationSession> {
    const session = await this.getCreationSession(id);
    const updated = { ...session, revision: payload.revision + 1 };
    state.sessions = state.sessions.map((item) => (item.id === id ? updated : item));
    return clone(updated);
  },

  async materializeStrategy(id: string): Promise<ApiStrategyDetail> {
    return this.getStrategyDetail('strat-001');
  },

  async listBacktestRuns(params, _signal?: AbortSignal): Promise<ApiBacktestRunListItem[]> {
    const limit = params?.limit ?? state.runs.length;
    return clone(
      state.runs.slice(0, limit).map((run) => ({
        id: run.id,
        strategy_id: run.strategy_id ?? 'strat-001',
        status: run.status,
        created_at: nowIso(),
      })),
    );
  },

  async getBacktestRunDetail(
    id: string,
    _options?: BacktestRunDetailRequest | AbortSignal,
  ): Promise<ApiBacktestRunDetail> {
    const run = state.runs.find((item) => item.id === id);
    if (!run) {
      throw new ApiError({ status: 404, code: 'run_not_found', message: `Run ${id} was not found.` });
    }
    return clone(run);
  },

  async saveBacktestRun(id: string): Promise<ApiBacktestRunDetail> {
    const run = state.runs.find((item) => item.id === id);
    if (!run) {
      throw new ApiError({ status: 404, code: 'run_not_found', message: `Run ${id} was not found.` });
    }
    run.is_permanent = true;
    return clone(run);
  },

  async deleteBacktestRun(id: string): Promise<ApiBacktestRunDeleteResult> {
    const run = state.runs.find((item) => item.id === id);
    if (!run) {
      throw new ApiError({ status: 404, code: 'run_not_found', message: `Run ${id} was not found.` });
    }
    if (run.status === 'QUEUED' || run.status === 'RUNNING') {
      throw new ApiError({ status: 409, code: 'backtest_run_delete_active', message: '进行中的回测暂不支持删除。' });
    }
    state.runs = state.runs.filter((item) => item.id !== id);
    return { id, deleted_at: nowIso(), deleted_reason: 'manual_delete' };
  },

  async getBacktestRunTrades(): Promise<ApiBacktestRunTradePage> {
    return { items: [], page: 1, page_size: 50, total: 0, total_pages: 1 };
  },

  async getBacktestTradeAudit(): Promise<ApiBacktestTradeAudit> {
    return {
      trade_id: 'trade-001',
      symbol: 'QQQ',
      segment: 'IS',
      opened_at: '2024-04-01T09:30:00Z',
      closed_at: '2024-04-08T16:00:00Z',
      pnl_pct: 2.4,
      max_favorable_excursion_pct: 3.1,
      max_adverse_excursion_pct: -1.2,
      slippage_cost_pct: 0.12,
      commentary: 'Recovered audit sample.',
      price_series: [
        {
          date: '2024-04-01',
          open: 100,
          high: 102,
          low: 99,
          close: 101,
          adj_close: 101,
          volume: 1000000,
        },
        {
          date: '2024-04-08',
          open: 102,
          high: 104,
          low: 101,
          close: 103,
          adj_close: 103,
          volume: 1100000,
        },
      ],
      trigger_snapshot: { lookback_months: 6, top_n: 5 },
      risk_evaluation: {
        max_favorable_excursion_pct: 3.1,
        max_adverse_excursion_pct: -1.2,
        mfe_mae_ratio: 2.58,
        slippage_cost_pct: 0.12,
        commentary: 'Risk stayed within the expected band.',
      },
      entry_marker: { date: '2024-04-01', price: 101 },
      exit_marker: { date: '2024-04-08', price: 103 },
      chart_band: {
        start_date: '2024-04-01',
        end_date: '2024-04-08',
        color: 'green',
        pnl_pct: 2.4,
      },
    };
  },

  async previewBacktestRun(): Promise<ApiBacktestSubmissionPreview> {
    return { warnings: [], effective_start_date: '2024-01-02', effective_end_date: '2025-01-31', data_segment_type: 'FULL' };
  },

  async submitBacktestRun(): Promise<ApiBacktestRunDetail> {
    return clone(state.runs[0]);
  },

  async cloneBacktestRun(): Promise<ApiBacktestRunDetail> {
    return clone(state.runs[0]);
  },

  async resumeBacktestRun(id: string, _idempotencyKey: string): Promise<ApiBacktestRunDetail> {
    const run = state.runs.find((item) => item.id === id);
    if (!run) {
      throw new ApiError({ status: 404, code: 'run_not_found', message: `Run ${id} was not found.` });
    }
    if (run.status === 'INTERRUPTED') {
      run.status = 'RUNNING';
      run.resume_ready = false;
      run.interrupted_reason = null;
      run.current_stage = '断点恢复中';
      run.latest_update = '已继续回测，正在从断点恢复。';
      run.updated_at = nowIso();
    }
    return clone(run);
  },

  async getOptimizationJobDetail(
    id: string,
    _params?: { matchingLimit?: number },
  ): Promise<ApiOptimizationJobDetail> {
    return clone(findJob(id));
  },

  async updateOptimizationJobConstraints(jobId, payload): Promise<ApiOptimizationJobDetail> {
    const job = findJob(jobId);
    if (!['COMPLETED', 'PARTIALLY_FAILED', 'FAILED'].includes(String(job.status).toUpperCase())) {
      throw new ApiError({
        status: 409,
        code: 'optimization_job_not_terminal',
        message: '只有已结束的优化任务才能重新过滤约束条件。',
      });
    }
    const updated = applyOptimizationJobConstraintUpdate(
      job,
      payload,
      findStrategy(job.strategy_id),
      nowIso(),
    );
    return clone(updated);
  },

  async saveOptimizationFilteredResult(jobId, payload): Promise<ApiOptimizationJobDetail> {
    const job = findJob(jobId);
    if (!['COMPLETED', 'PARTIALLY_FAILED', 'FAILED'].includes(String(job.status).toUpperCase())) {
      throw new ApiError({
        status: 409,
        code: 'optimization_job_not_terminal',
        message: 'Only completed optimization jobs can be saved as a filtered result.',
      });
    }
    const strategy = findStrategy(job.strategy_id);
    const savedAt = nowIso();
    const filtered = applyOptimizationJobConstraintUpdate(
      job,
      payload,
      strategy,
      savedAt,
    );
    const saved: ApiOptimizationJobDetail = {
      ...filtered,
      id: nextId('opt'),
      status: 'COMPLETED',
      request: {
        ...filtered.request,
        source_optimization_job_id: jobId,
        entry_point: 'saved_refilter_result',
      },
      summary: {
        ...filtered.summary,
        status: 'COMPLETED',
        progress_pct: 100,
        current_stage: 'Result ready',
        latest_update: '已另存过滤结果。',
      },
      result: {
        ...filtered.result,
        status: 'COMPLETED',
        progress_pct: 100,
        current_stage: 'Result ready',
        latest_update: '已另存过滤结果。',
      },
      created_at: savedAt,
      updated_at: savedAt,
      completed_at: savedAt,
    };
    state.optimizationJobs.unshift(saved);
    strategy.latest_optimization_job_id = saved.id;
    return clone(saved);
  },

  async listOptimizationJobs(): Promise<ApiOptimizationJobListItem[]> {
    return clone(
      state.optimizationJobs.map((job) => ({
        id: job.id,
        strategy_id: job.strategy_id,
        strategy_name: findStrategy(job.strategy_id).name,
        status: job.status,
        entry_point: (job.summary.entry_point as string | null | undefined) ?? null,
        validation_mode: (job.summary.validation_mode as string | null | undefined) ?? null,
        source_run_id: (job.summary.source_run_id as string | null | undefined) ?? null,
        budget_combinations:
          typeof job.summary.budget_combinations === 'number' ? job.summary.budget_combinations : null,
        completed_combinations:
          typeof job.summary.completed_combinations === 'number' ? job.summary.completed_combinations : null,
        progress_pct: typeof job.summary.progress_pct === 'number' ? job.summary.progress_pct : null,
        current_stage: (job.summary.current_stage as string | null | undefined) ?? null,
        latest_update: (job.summary.latest_update as string | null | undefined) ?? null,
        estimated_remaining_minutes:
          typeof job.summary.estimated_remaining_minutes === 'number'
            ? job.summary.estimated_remaining_minutes
            : null,
        estimated_completed_at: (job.summary.estimated_completed_at as string | null | undefined) ?? null,
        best_candidate_id: (job.result.best_candidate_id as string | null | undefined) ?? null,
        best_candidate_label: (job.result.best_candidate_label as string | null | undefined) ?? null,
        base_parameter_version_id: job.base_parameter_version_id ?? null,
        created_at: job.created_at ?? null,
        updated_at: job.updated_at ?? null,
        completed_at: job.completed_at ?? null,
        resume_ready: typeof job.resume_ready === 'boolean' ? job.resume_ready : undefined,
        persisted_trial_count:
          typeof job.persisted_trial_count === 'number' ? job.persisted_trial_count : null,
        next_trial_index: typeof job.next_trial_index === 'number' ? job.next_trial_index : null,
        interrupted_reason: job.interrupted_reason ?? null,
        best_metrics_summary: job.best_metrics_summary ?? null,
      })),
    );
  },

  async deleteOptimizationJob(id: string) {
    const job = findJob(id);
    const deletedAt = nowIso();
    state.optimizationJobs = state.optimizationJobs.filter((item) => item.id !== id);
    const strategy = findStrategy(job.strategy_id);
    strategy.latest_optimization_job_id =
      state.optimizationJobs.find((item) => item.strategy_id === strategy.id)?.id ?? null;
    return {
      id,
      deleted_at: deletedAt,
      deleted_reason: 'user_deleted',
    };
  },

  async createOptimizationJob(strategyId: string): Promise<ApiOptimizationJobDetail> {
    const strategy = findStrategy(strategyId);
    const job: ApiOptimizationJobDetail = {
      id: nextId('opt'),
      strategy_id: strategyId,
      status: 'COMPLETED',
      request: {
        objective: 'sharpe',
        base_parameter_version_id: strategy.current_parameter_version_id,
      },
      summary: {
        objective: 'sharpe',
        candidate_count: 1,
        baseline_parameter_version_id: strategy.current_parameter_version_id,
      },
      result: {
        best_candidate_id: null,
        baseline_parameter_version_id: strategy.current_parameter_version_id,
      },
      candidates: [createCandidate(strategy, {}, 1)],
      base_parameter_version_id: strategy.current_parameter_version_id,
      created_at: nowIso(),
      updated_at: nowIso(),
      completed_at: nowIso(),
    };
    job.result.best_candidate_id = job.candidates[0].id;
    state.optimizationJobs.unshift(job);
    strategy.latest_optimization_job_id = job.id;
    return clone(job);
  },

  async resumeOptimizationJob(jobId: string): Promise<ApiOptimizationJobDetail> {
    const job = findJob(jobId);
    job.status = 'QUEUED';
    job.summary = {
      ...job.summary,
      status: 'QUEUED',
      resume_ready: false,
      latest_update: '优化任务已继续执行。',
    };
    job.result = {
      ...job.result,
      status: 'QUEUED',
      latest_update: '优化任务已继续执行。',
    };
    job.updated_at = nowIso();
    return clone(job);
  },

  async createOptimizationCandidate(jobId: string, payload: CreateCandidatePayload): Promise<ApiOptimizationJobDetail> {
    const job = findJob(jobId);
    const strategy = findStrategy(job.strategy_id);
    const candidate = createCandidate(
      strategy,
      {
        label: payload.label ?? `Manual Candidate ${job.candidates.length + 1}`,
        summary: payload.summary,
        parameter_snapshot: payload.parameter_snapshot,
        metrics: payload.metrics ?? {},
        base_parameter_version_id: payload.base_parameter_version_id ?? job.base_parameter_version_id ?? null,
      },
      job.candidates.length + 1,
    );
    job.candidates.push(candidate);
    job.summary.candidate_count = job.candidates.length;
    job.updated_at = nowIso();
    return clone(job);
  },

  async promoteOptimizationCandidate(jobId: string, trialId: string, mode: PromoteMode): Promise<ApiOptimizationJobDetail> {
    const job = findJob(jobId);
    const strategy = findStrategy(job.strategy_id);
    const candidate = job.candidates.find((item) => item.id === trialId);
    if (!candidate) {
      throw new ApiError({ status: 404, code: 'optimization_candidate_not_found', message: `Candidate ${trialId} was not found.` });
    }
    const conflictKey = promoteConflictKey(jobId, trialId);
    if (state.promoteConflicts.has(conflictKey)) {
      throw new ApiError({
        status: 409,
        code: 'stale_base_parameter_version',
        message: 'The strategy has moved to a newer parameter version.',
        blocking_code: 'stale_base_parameter_version',
        blocking_target: { type: 'strategy', id: strategy.id },
        next_action: 'refresh_strategy_detail',
      });
    }
    if (mode === 'set_current') {
      strategy.parameters = clone(candidate.parameter_snapshot);
      strategy.current_parameter_version = (strategy.current_parameter_version ?? 1) + 1;
      strategy.current_parameter_version_id = `${strategy.id}-v${strategy.current_parameter_version}`;
    }
    return clone(job);
  },

  async deleteOptimizationCandidate(jobId: string, trialId: string): Promise<ApiOptimizationJobDetail> {
    const job = findJob(jobId);
    job.candidates = job.candidates.filter((candidate) => candidate.id !== trialId);
    job.summary.candidate_count = job.candidates.length;
    job.updated_at = nowIso();
    return clone(job);
  },

  async getSnapshotOverview(): Promise<ApiSnapshotOverview> {
    return createSnapshotOverview();
  },

  async refreshSnapshots(): Promise<ApiSnapshotOverview> {
    return createSnapshotOverview('2026-04-01T10:00:00Z');
  },

  async getPitDataOverview(): Promise<ApiPitDataOverview> {
    return clone(createPitDataOverview());
  },

  async createPitResearchWaiver(_payload?: ApiPitResearchWaiverPayload): Promise<ApiPitDataOverview> {
    return clone({
      ...createPitDataOverview(),
      overall_status: 'LIMITED_READY',
      factor_diagnostics_enabled: true,
      verified_diagnostics_enabled: false,
      limited_diagnostics_enabled: true,
      research_waiver: {
        id: 'pitw-demo',
        status: 'ACTIVE',
        dataset_snapshot_id: 'ds-price',
        universe_snapshot_id: 'un-sp500',
        ignored_symbols: ['ATVI', 'SIVB', 'TWTR'],
        ignored_symbol_count: 3,
        reason: '研究阶段临时忽略非核心缺失标的，晋升仍要求 Full Ready。',
        created_at: nowIso(),
        created_by: 'researcher',
        promotion_eligible: false,
        mode: 'LIMITED_READY',
      },
    });
  },

  async revokePitResearchWaiver(_id: string): Promise<ApiPitDataOverview> {
    return clone(createPitDataOverview());
  },

  async applyPitIdentityOverride(_payload: ApiPitIdentityOverridePayload): Promise<ApiPitDataOverview> {
    return clone(createPitDataOverview());
  },

  async restartPitIdentityScraper(): Promise<ApiPitIdentityScraperRestartResponse> {
    const pitData = clone(createPitDataOverview());
    return {
      job_id: `demo_identity_${Date.now()}`,
      status: 'COMPLETED',
      message: 'Identity Scraper 已执行：解析成功 0 项，未解析 0 项。',
      started_at: nowIso(),
      completed_at: nowIso(),
      attempted_count: 0,
      resolved_count: 0,
      failed_count: 0,
      pending_before: pitData.ops_guidance?.identity_pending_count ?? 0,
      pending_after: pitData.ops_guidance?.identity_pending_count ?? 0,
      resolved_symbols: [],
      failed_symbols: [],
      pit_data: pitData,
    };
  },

  async listFactors(params): Promise<ApiFactorListResponse> {
    let items = createFactorListItems();
    if (params?.source) {
      items = items.filter((item) => item.source === params.source);
    }
    if (params?.tag) {
      items = items.filter((item) => item.tags.includes(params.tag ?? ''));
    }
    if (params?.market) {
      items = items.filter((item) => item.market === params.market);
    }
    if (params?.status) {
      items = items.filter(
        (item) => item.lifecycle_status === params.status || item.diagnostic_status === params.status,
      );
    }
    const lifecycleBase = items;
    const onlineItems = lifecycleBase.filter((item) => demoFactorLifecycle(item) === 'online');
    const sandboxItems = lifecycleBase.filter((item) => demoFactorLifecycle(item) === 'sandbox');
    const toBeVerifiedItems = lifecycleBase.filter((item) => demoFactorLifecycle(item) === 'to_be_verified');
    const archivedItems = lifecycleBase.filter((item) => demoFactorLifecycle(item) === 'archived');
    const lifecycle = String(params?.lifecycle ?? 'online').toLowerCase();
    if (lifecycle === 'offline' || lifecycle === 'archived') {
      items = archivedItems;
    } else if (lifecycle === 'sandbox') {
      items = sandboxItems;
    } else if (lifecycle === 'to_be_verified') {
      items = toBeVerifiedItems;
    } else if (lifecycle === 'all') {
      items = lifecycleBase;
    } else {
      items = onlineItems;
    }
    return clone({
      items,
      summary: {
        total: items.length,
        all_count: lifecycleBase.length,
        online_count: onlineItems.length,
        offline_count: archivedItems.length,
        archived_count: archivedItems.length,
        lifecycle_sandbox_count: sandboxItems.length,
        to_be_verified_count: toBeVerifiedItems.length,
        f1_count: lifecycleBase.filter((item) => item.tier_level === 'F1').length,
        f2_count: lifecycleBase.filter((item) => item.tier_level === 'F2').length,
        f3_count: lifecycleBase.filter((item) => item.tier_level === 'F3').length,
        deprecated_count: archivedItems.filter((item) => item.lifecycle_status === 'DEPRECATED').length,
        pruned_count: archivedItems.filter((item) => item.lifecycle_status === 'PRUNED').length,
        system_seed_count: items.filter((item) => item.source === 'SYSTEM_SEED').length,
        ready_to_diagnose_count: items.filter((item) => item.diagnostic_status === 'READY_TO_DIAGNOSE').length,
        sandbox_ready_count: items.filter((item) => item.diagnostic_status === 'SANDBOX_READY').length,
        blocked_data_count: items.filter((item) => item.diagnostic_status === 'BLOCKED_DATA').length,
        pit_status: 'READY',
        governance_queue_count: createFactorGovernanceOverview(items).queue_count,
        strategy_usage_factor_count: 3,
        strategy_usage_factor_ids: ['s_mom_12m1m_rank', 's_val_ep_ltm_raw', 's_vol_252d_rank'],
      },
    });
  },

  async getFactorGovernanceOverview(): Promise<ApiFactorGovernanceOverview> {
    return clone(createFactorGovernanceOverview());
  },

  async executeFactorGovernanceAction(actionId, payload): Promise<ApiFactorGovernanceExecuteResponse> {
    const command = String(payload.command ?? '').toUpperCase();
    const offlineAt = nowIso();
    const factorIds = Array.from(
      new Set([...(payload.factor_ids ?? []), payload.factor_id ?? ''].map(String).filter((item) => item.length > 0)),
    );
    if (command === 'PUBLISH_OPTIMIZED_FACTOR') {
      const created = createFactorListItems().find((item) => item.id === 's_vol_downside_252d_rank');
      const createdFactor = created
        ? {
            ...created,
            id: 's_alpha_vol_downsiderev_std_rk',
            name: '反向下行风险 Alpha (精炼)',
            source: 'MANUAL' as const,
            lifecycle_status: 'VERIFIED' as const,
            diagnostic_status: 'COMPLETED' as const,
            direction: 'HIGH_IS_BETTER' as const,
            expression: 'DownsideStd(Return(Close, 1), 252)',
            tags: ['manual', 'governance_optimized', 'reverse_factor'],
          }
        : null;
      return clone({
        status: 'EXECUTED',
        action_id: actionId,
        command,
        affected_factor_ids: factorIds,
        keep_factor_id: null,
        offline_at: offlineAt,
        executed_at: offlineAt,
        reason: payload.reason,
        created_factor_id: createdFactor?.id,
        created_factor: createdFactor ?? undefined,
        items: createdFactor ? [createdFactor] : [],
        governance_overview: createFactorGovernanceOverview(),
      });
    }
    const items = createFactorListItems()
      .filter((item) => factorIds.includes(item.id))
      .map((item) => ({
        ...item,
        lifecycle_status: command === 'PRUNE' ? 'PRUNED' as const : 'DEPRECATED' as const,
        offline_command: command,
        offline_reason: payload.reason,
        offline_at: offlineAt,
        offline_detail: payload.detail ?? {},
      }));
    return clone({
      status: 'EXECUTED',
      action_id: actionId,
      command,
      affected_factor_ids: factorIds,
      keep_factor_id: payload.keep_factor_id ?? null,
      offline_at: offlineAt,
      reason: payload.reason,
      items,
      governance_overview: createFactorGovernanceOverview(),
    });
  },

  async listFactorQuarantineCandidates(): Promise<ApiFactorQuarantineCandidateListResponse> {
    return clone(createFactorQuarantineCandidates());
  },

  async factorQuarantineIntake(
    _payload?: ApiFactorQuarantineIntakePayload,
  ): Promise<{ items: ApiFactorQuarantineCandidate[]; summary: Record<string, unknown> }> {
    const response = createFactorQuarantineCandidates();
    return clone({
      items: response.items.map((item) => ({
        ...item,
        status: 'PENDING',
        publish_status: 'BLOCKED',
        publish_eligibility: { status: 'BLOCKED', reason: '已从沙盒进入检疫队列，等待运行 D2 门禁。' },
      })),
      summary: {
        intake_count: response.items.length,
        source_mining_job_id: 'fmj_demo_001',
        sandbox_candidates_persisted_to_factor_definitions: false,
      },
    });
  },

  async runFactorQuarantineCandidate(
    candidateId: string,
    _payload?: ApiFactorQuarantineRunPayload,
  ): Promise<ApiFactorQuarantineCandidate> {
    const candidate = createFactorQuarantineCandidates().items.find((item) => item.id === candidateId)
      ?? createFactorQuarantineCandidates().items[0];
    return clone({
      ...candidate,
      status: 'PASSED',
      publish_status: 'ELIGIBLE',
      publish_eligibility: { status: 'ELIGIBLE', reason: '通过 D2 检疫，允许自动发布。' },
      latest_run: { status: 'PASSED', completed_at: nowIso() },
    });
  },

  async publishFactorQuarantineCandidate(
    candidateId: string,
    _payload?: ApiFactorQuarantinePublishPayload,
  ): Promise<ApiFactorQuarantinePublishResponse> {
    const candidate = createFactorQuarantineCandidates().items.find((item) => item.id === candidateId)
      ?? createFactorQuarantineCandidates().items[0];
    return clone({
      candidate: {
        ...candidate,
        status: 'PUBLISHED',
        publish_status: 'PUBLISHED',
        target_factor_id: 'auto_demo_mom_001',
        published_at: nowIso(),
      },
    });
  },

  async createFactor(payload: ApiFactorCreatePayload): Promise<ApiFactorDetail> {
    const descriptorMetric = payload.descriptor.metric ?? '';
    const id = [
      payload.descriptor.source_prefix,
      payload.descriptor.category,
      descriptorMetric,
      payload.descriptor.window,
      payload.descriptor.operator,
    ].filter(Boolean).join('_');
    const base = createFactorDetail('s_mom_12m1m_rank');
    const createdAt = nowIso();
    return clone({
      ...base,
      id,
      name: payload.name,
      created_at: createdAt,
      updated_at: createdAt,
      source: 'MANUAL',
      lifecycle_status: 'DRAFT',
      diagnostic_status: 'READY_TO_DIAGNOSE',
      direction: payload.direction,
      frequency: payload.frequency,
      expression: payload.expression,
      descriptor: { ...payload.descriptor, metric: descriptorMetric, schema_version: 'factor_descriptor_v1', canonical_id: id },
      tags: payload.tags,
      data_requirements: ['adj_close', 'price_history', 'returns'],
      description: payload.description ?? null,
      institutional_note: '人工因子需要通过 PIT 诊断后才能进入已验证状态。',
      latest_diagnostic_summary: null,
      diagnostic_gap_summary: {
        rank_ic: 'Rank IC: 尚未提交诊断',
        coverage: '覆盖: 等待首次诊断',
        next_action: '提交 Verified 诊断',
      },
      last_diagnostic_run_id: null,
      versions: [
        {
          id: `${id}-v1`,
          version: 1,
          expression: payload.expression,
          status: 'ACTIVE',
          metadata: { source: 'MANUAL' },
          created_at: createdAt,
        },
      ],
    });
  },

  async getFactor(id: string): Promise<ApiFactorDetail> {
    return clone(createFactorDetail(id));
  },

  async runFactorDiagnostics(
    id: string,
    payload: ApiFactorDiagnosticPayload,
  ): Promise<ApiFactorDiagnosticRunResponse> {
    const factor = createFactorDetail(id);
    if (factor.diagnostic_status === 'BLOCKED_DATA') {
      throw new ApiError({
        status: 400,
        code: 'factor_data_blocked',
        message: '因子基础数据待补，不能触发正式诊断。',
      });
    }
    const runId = nextId('fdiag-demo');
    return clone({
      run_id: runId,
      summary: {
        ...(factor.latest_diagnostic_summary ?? createFactorDiagnosticSummary(id)),
        run_id: runId,
        factor_id: id,
        dataset_snapshot_id: payload.dataset_snapshot_id,
        fundamental_snapshot_id: 'ds-fundamentals',
        universe_snapshot_id: payload.universe_snapshot_id,
        diagnostic_mode: payload.diagnostic_mode ?? 'VERIFIED',
        status: 'COMPLETED',
        admission: {
          mode: payload.diagnostic_mode ?? 'VERIFIED',
          label: payload.diagnostic_mode === 'SANDBOX' ? 'Sandbox 预览' : 'Verified 正式诊断',
        },
      },
    });
  },

  async previewFactorDiagnostics(
    payload: ApiFactorDiagnosticPreviewPayload,
  ): Promise<ApiFactorDiagnosticPreview> {
    return clone({
      status: 'PREVIEW',
      lookback_years: payload.lookback_years ?? 5,
      expression: payload.expression,
      rank_ic_preview: Array.from({ length: 12 }, (_, index) => ({
        date: `2025-${String(index + 1).padStart(2, '0')}-28`,
        rank_ic: Number((0.032 + Math.sin(index / 2) * 0.021).toFixed(4)),
      })),
      distribution: {
        skew: 0.18,
        kurtosis: 2.7,
        normality_label: '接近正态',
      },
      risk_flags: [],
      message: '5 年样本内 IC 预览只用于缩短试错，不替代正式 PIT 诊断。',
    });
  },

  async listFactorMiningJobs(): Promise<ApiFactorMiningJobListResponse> {
    const job = createDemoMiningJob({
      universe: 'SP500',
      start_date: '2020-01-01',
      end_date: '2025-12-31',
      operators: ['Return', 'Std', 'Rank', 'ZScore', 'Winsorize'],
      candidate_count: 1000,
      random_seed: 42,
      min_rank_ic: 0.02,
      max_depth: 4,
    });
    return clone({
      items: [job],
      summary: {
        total: 1,
        completed_count: 1,
        running_count: 0,
        total_candidates: job.progress.total_candidates,
      },
    });
  },

  async createFactorMiningJob(payload: ApiFactorMiningJobCreatePayload): Promise<ApiFactorMiningJob> {
    return clone(createDemoMiningJob(payload));
  },

  async getFactorMiningJob(id: string): Promise<ApiFactorMiningJob> {
    const payload: ApiFactorMiningJobCreatePayload = {
      universe: 'SP500',
      start_date: '2020-01-01',
      end_date: '2025-12-31',
      operators: ['Return', 'Std', 'Rank', 'ZScore', 'Winsorize'],
      candidate_count: 1000,
      random_seed: 42,
      min_rank_ic: 0.02,
      max_depth: 4,
    };
    return clone({ ...createDemoMiningJob(payload), id });
  },

  async cancelFactorMiningJob(id: string): Promise<ApiFactorMiningJob> {
    return clone({
      ...createDemoMiningJob(
        {
          universe: 'SP500',
          start_date: '2020-01-01',
          end_date: '2025-12-31',
          operators: ['Return', 'Std', 'Rank'],
          candidate_count: 1000,
          random_seed: 42,
          min_rank_ic: 0.02,
          max_depth: 4,
        },
        'CANCELLED',
      ),
      id,
    });
  },

  async getFactorFactoryOverview(): Promise<ApiFactorFactoryOverview> {
    return clone(createDemoFactorFactoryOverview());
  },

  async startFactorFactoryAutomation(
    _payload?: ApiFactorFactoryAutomationPayload,
  ): Promise<ApiFactorFactoryOverview> {
    return clone(createDemoFactorFactoryOverview('ACTIVE', 'DAILY', 'COMPLETED'));
  },

  async pauseFactorFactoryAutomation(): Promise<ApiFactorFactoryOverview> {
    return clone(createDemoFactorFactoryOverview('PAUSED', 'DAILY', 'COMPLETED'));
  },

  async runFactorFactoryNow(
    _payload?: ApiFactorFactoryRunNowPayload,
  ): Promise<ApiFactorFactoryOverview> {
    return clone(createDemoFactorFactoryOverview('PAUSED', 'MANUAL', 'COMPLETED'));
  },

  async cancelFactorFactoryRun(id: string): Promise<ApiFactorFactoryRun> {
    const overview = createDemoFactorFactoryOverview('ACTIVE', 'DAILY', 'CANCELLED');
    return clone({ ...overview.latest_run!, id, status: 'CANCELLED' });
  },

  async previewFactorModel(payload: ApiFactorModelPreviewPayload): Promise<ApiFactorModelPreviewResponse> {
    return clone(createDemoFactorModelPreview(payload));
  },

  async createFactorModel(payload: ApiFactorModelCreatePayload): Promise<ApiStrategyDetail> {
    return clone(createDemoFactorModelStrategy(payload));
  },
};

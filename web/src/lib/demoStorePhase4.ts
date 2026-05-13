import {
  ApiAssetLeg,
  type ApiAssetLegCreatePayload,
  type ApiAssetLegUpdatePayload,
  ApiError,
  type ApiBacktestRunDeleteResult,
  type ApiBacktestRunDetail,
  type ApiBacktestRunListItem,
  type ApiBacktestRunTradeAudit,
  type ApiBacktestRunTradePage,
  type ApiBacktestSubmissionPreview,
  type ApiBondSnapshotEligibleInstrument,
  ApiCashLeg,
  type ApiCashLegCreatePayload,
  type ApiCashLegUpdatePayload,
  type ApiConfirmationUpdateRequest,
  type ApiCompositionCreatePayload,
  type ApiCompositionDetail,
  type ApiCompositionLegInput,
  type ApiCompositionListItem,
  type ApiCompositionPreview,
  type ApiCompositionPreviewPayload,
  type ApiCompositionPreviewLeg,
  type ApiCompositionStatus,
  type ApiCompositionUpdatePayload,
  type ApiLegInventory,
  type ApiLegInventoryFilterItem,
  type ApiLegInventoryRow,
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
  type ApiFactorQuarantineCandidateListResponse,
  type ApiOptimizationCandidate,
  type ApiOptimizationJobCreatePayload,
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
import { createInitialState } from './demoStoreSeed';
import { clone, createCandidate, createStrategy, nextId, nowIso } from './demoStoreShared';
import {
  applyOptimizationJobConstraintUpdate,
  buildOptimizationJobListItem,
  hydrateOptimizationJob,
} from './optimization-demo';

let state = createInitialState();
let demoPitWaiver:
  | NonNullable<ApiPitDataOverview['research_waiver']>
  | null = null;

function findStrategy(id: string): ApiStrategyDetail {
  const strategy = state.strategies.find((item) => item.id === id);
  if (!strategy) {
    throw new ApiError({ status: 404, code: 'strategy_not_found', message: `Strategy ${id} was not found.` });
  }
  return strategy;
}

function findRun(id: string): ApiBacktestRunDetail {
  const run = state.runs.find((item) => item.id === id);
  if (!run) {
    throw new ApiError({ status: 404, code: 'run_not_found', message: `Run ${id} was not found.` });
  }
  return run;
}

function findSourceRun(id: string | null | undefined): ApiBacktestRunDetail | null {
  if (!id) {
    return null;
  }
  return state.runs.find((item) => item.id === id) ?? null;
}

function getOptimizationSourceRun(job: ApiOptimizationJobDetail): ApiBacktestRunDetail | null {
  const sourceRunId =
    typeof job.request?.source_run_id === 'string'
      ? job.request.source_run_id
      : typeof job.summary?.source_run_id === 'string'
        ? job.summary.source_run_id
        : null;
  return findSourceRun(sourceRunId);
}

function parseStrategyLegInventoryId(value: string): { strategyId: string; parameterVersionId: string } | null {
  const parts = value.split('::');
  if (parts.length !== 3 || parts[0] !== 'strategy_leg' || !parts[1] || !parts[2]) {
    return null;
  }
  return { strategyId: parts[1], parameterVersionId: parts[2] };
}

function strategyLegInventoryId(strategyId: string, parameterVersionId: string): string {
  return `strategy_leg::${strategyId}::${parameterVersionId}`;
}

function referenceCountForLeg(sourceRefId: string): number {
  return state.compositions.reduce(
    (count, composition) =>
      String(composition.status ?? '').toUpperCase() === 'ARCHIVED'
        ? count
        :
      count +
      composition.normalized_legs.filter((leg) => leg.source_ref_id === sourceRefId).length,
    0,
  );
}

function referenceSummary(count: number): string {
  if (count <= 0) {
    return '未被组合引用';
  }
  if (count === 1) {
    return '1 个组合引用';
  }
  return `${count} 个组合引用`;
}

function readRunMetric(metrics: Record<string, number> | undefined, keys: string[]): number | null {
  if (!metrics) {
    return null;
  }
  for (const key of keys) {
    const value = metrics[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function normalizeMetricPercentPoint(value: number | null): number {
  if (value === null) {
    return 0;
  }
  return Math.abs(value) <= 1 ? value * 100 : value;
}

function buildStrategyLegRows(): ApiLegInventoryRow[] {
  return state.strategies.flatMap((strategy) =>
    strategy.parameter_history.map((versionEntry) => {
      const versionId =
        versionEntry.parameter_version_id ??
        `${strategy.id}-v${versionEntry.version_number ?? strategy.current_parameter_version ?? 1}`;
      const rowId = strategyLegInventoryId(strategy.id, versionId);
      const latestRun =
        typeof strategy.latest_run_id === 'string'
          ? state.runs.find((run) => run.id === strategy.latest_run_id)
          : null;
      const hasNewVersion =
        Boolean(strategy.current_parameter_version_id) &&
        strategy.current_parameter_version_id !== versionId;
      const needsRun = !latestRun || latestRun.parameter_version_id !== versionId;
      const referenceCount = referenceCountForLeg(rowId);
      const tags = ['strategy', String(strategy.strategy_type ?? 'general').toLowerCase()];
      if (needsRun) tags.push('low_correlation');
      if (hasNewVersion) tags.push('pending_update');
      return {
        id: rowId,
        leg_type: 'strategy',
        name: strategy.name,
        version_label: `v${versionEntry.version_number ?? 1}`,
        proof_label: latestRun?.id ?? '待补回测',
        reference_count: referenceCount,
        reference_summary: referenceSummary(referenceCount),
        status: needsRun ? 'NEEDS_RUN' : hasNewVersion ? 'STALE' : 'READY',
        status_label: needsRun ? '待回测' : hasNewVersion ? '有新版本' : '稳定',
        has_new_version: hasNewVersion,
        is_orphan: referenceCount === 0,
        attribute_tags: tags,
        allowed_actions: needsRun
          ? ['run_backtest', 'open_strategy_detail', 'open_composition_workbench']
          : ['open_strategy_detail', 'open_composition_workbench'],
        source_ref_id: rowId,
        source_ref_type: 'strategy_projection',
        config: {
          strategy_id: strategy.id,
          parameter_version_id: versionId,
          strategy_type: strategy.strategy_type,
          rebalance_frequency: strategy.rebalance_frequency,
          latest_run_id: latestRun?.id ?? null,
          run_id: latestRun?.id ?? null,
          metrics: latestRun?.metrics ?? null,
          annualized_return_pct: normalizeMetricPercentPoint(
            readRunMetric(latestRun?.metrics, ['annualized_return', 'cagr', 'oos_annualized_return', 'total_return']),
          ),
          max_drawdown_pct: Math.abs(
            normalizeMetricPercentPoint(readRunMetric(latestRun?.metrics, ['max_drawdown_pct', 'max_drawdown', 'oos_max_drawdown'])),
          ),
          oos_sharpe: readRunMetric(latestRun?.metrics, ['oos_sharpe', 'out_of_sample_sharpe', 'sharpe']) ?? 0,
        },
      } satisfies ApiLegInventoryRow;
    }),
  );
}

function buildAssetLegRows(): ApiLegInventoryRow[] {
  return state.assetLegs
    .filter((leg) => String(leg.status ?? '').toUpperCase() !== 'ARCHIVED')
    .map((leg) => {
    const referenceCount = referenceCountForLeg(leg.id);
    return {
      id: leg.id,
      leg_type: 'asset',
      name: leg.name,
      version_label: leg.symbol,
      proof_label: leg.source_snapshot_id,
      reference_count: referenceCount,
      reference_summary: referenceSummary(referenceCount),
      status: leg.status,
      status_label: leg.status === 'ACTIVE' ? '稳定' : leg.status,
      has_new_version: false,
      is_orphan: referenceCount === 0,
      attribute_tags: leg.attribute_tags,
      allowed_actions: leg.allowed_actions,
      source_ref_id: leg.id,
      source_ref_type: 'asset_definition',
      config: {
        symbol: leg.symbol,
        asset_kind: leg.asset_kind,
        freeze_mode: leg.freeze_mode,
        source_snapshot_id: leg.source_snapshot_id,
        source_provider: leg.source_provider ?? null,
        summary: leg.summary ?? {},
      },
    } satisfies ApiLegInventoryRow;
    });
}

function buildCashLegRows(): ApiLegInventoryRow[] {
  return state.cashLegs
    .filter((leg) => String(leg.status ?? '').toUpperCase() !== 'ARCHIVED')
    .map((leg) => {
    const referenceCount = referenceCountForLeg(leg.id);
    return {
      id: leg.id,
      leg_type: 'cash',
      name: leg.name,
      version_label: leg.cash_rule_kind,
      proof_label: leg.yield_source ?? leg.freeze_mode,
      reference_count: referenceCount,
      reference_summary: referenceSummary(referenceCount),
      status: leg.status,
      status_label: leg.status === 'ACTIVE' ? '稳定' : leg.status,
      has_new_version: false,
      is_orphan: referenceCount === 0,
      attribute_tags: leg.attribute_tags,
      allowed_actions: leg.allowed_actions,
      source_ref_id: leg.id,
      source_ref_type: 'cash_definition',
      config: {
        buffer_bps: leg.buffer_bps,
        cash_rule_kind: leg.cash_rule_kind,
        yield_source: leg.yield_source ?? null,
        freeze_mode: leg.freeze_mode,
        summary: leg.summary ?? {},
      },
    } satisfies ApiLegInventoryRow;
    });
}

function buildLegInventory(): ApiLegInventory {
  const rows = [...buildAssetLegRows(), ...buildCashLegRows()];
  const counts = {
    all: rows.length,
    strategy: rows.filter((row) => row.leg_type === 'strategy').length,
    asset: rows.filter((row) => row.leg_type === 'asset').length,
    cash: rows.filter((row) => row.leg_type === 'cash').length,
  };
  const statusCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  rows.forEach((row) => {
    statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);
    row.attribute_tags.forEach((tag) => tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1));
  });
  const toFilterItems = (entries: Iterable<[string, number]>): ApiLegInventoryFilterItem[] =>
    [...entries].map(([value, count]) => ({ value, count, label: value }));
  return {
    counts,
    filters: {
      statuses: toFilterItems(statusCounts.entries()),
      attribute_tags: toFilterItems(tagCounts.entries()),
    },
    rows,
  };
}

function resolvePreviewLeg(input: ApiCompositionLegInput, ordering: number): ApiCompositionPreviewLeg {
  if (input.leg_kind === 'strategy') {
    const strategyRef = parseStrategyLegInventoryId(input.source_ref_id);
    const strategy = strategyRef ? state.strategies.find((item) => item.id === strategyRef.strategyId) : null;
    return {
      id: input.source_ref_id,
      leg_kind: 'strategy',
      source_ref_id: input.source_ref_id,
      source_ref_type: input.source_ref_type ?? 'strategy_projection',
      display_name: input.display_name ?? strategy?.name ?? '策略腿',
      weight_pct: input.weight_pct,
      weight_locked: Boolean(input.weight_locked),
      ordering,
      version_label: strategyRef ? strategyRef.parameterVersionId.split('-').at(-1) ?? 'v1' : 'v1',
      proof_label: strategy?.latest_run_id ?? '待补回测',
      status: strategy?.latest_run_id ? 'READY' : 'NEEDS_RUN',
      status_label: strategy?.latest_run_id ? '可用' : '待回测',
      attribute_tags: ['strategy', String(strategy?.strategy_type ?? 'general').toLowerCase()],
      reference_summary: referenceSummary(referenceCountForLeg(input.source_ref_id)),
      config: input.config ?? {},
      allowed_actions: ['open_strategy_detail', 'open_composition_workbench'],
    };
  }
  if (input.leg_kind === 'asset') {
    const asset = state.assetLegs.find((item) => item.id === input.source_ref_id);
    return {
      id: input.source_ref_id,
      leg_kind: 'asset',
      source_ref_id: input.source_ref_id,
      source_ref_type: input.source_ref_type ?? 'asset_definition',
      display_name: input.display_name ?? asset?.name ?? '资产腿',
      weight_pct: input.weight_pct,
      weight_locked: Boolean(input.weight_locked),
      ordering,
      version_label: asset?.symbol ?? null,
      proof_label: asset?.source_snapshot_id ?? null,
      status: asset?.status ?? 'ACTIVE',
      status_label: '已入库',
      attribute_tags: asset?.attribute_tags ?? ['asset'],
      reference_summary: referenceSummary(referenceCountForLeg(input.source_ref_id)),
      config: input.config ?? {},
      allowed_actions: asset?.allowed_actions ?? ['edit_leg_definition', 'open_composition_workbench'],
    };
  }
  const cash = state.cashLegs.find((item) => item.id === input.source_ref_id);
  return {
    id: input.source_ref_id,
    leg_kind: 'cash',
    source_ref_id: input.source_ref_id,
    source_ref_type: input.source_ref_type ?? 'cash_definition',
    display_name: input.display_name ?? cash?.name ?? '现金腿',
    weight_pct: input.weight_pct,
    weight_locked: Boolean(input.weight_locked),
    ordering,
    version_label: cash?.cash_rule_kind ?? null,
    proof_label: cash?.yield_source ?? cash?.freeze_mode ?? null,
    status: cash?.status ?? 'ACTIVE',
    status_label: '已入库',
    attribute_tags: cash?.attribute_tags ?? ['cash'],
    reference_summary: referenceSummary(referenceCountForLeg(input.source_ref_id)),
    config: input.config ?? {},
    allowed_actions: cash?.allowed_actions ?? ['edit_leg_definition', 'open_composition_workbench'],
  };
}

function buildCompositionPreview(payload: ApiCompositionPreviewPayload): ApiCompositionPreview {
  const normalizedLegs = (payload.legs ?? []).map((leg, index) => resolvePreviewLeg(leg, index + 1));
  const totalWeight = normalizedLegs.reduce((sum, leg) => sum + leg.weight_pct, 0);
  const lockedWeight = normalizedLegs.reduce(
    (sum, leg) => sum + (leg.weight_locked ? leg.weight_pct : 0),
    0,
  );
  const benchmarkBase = [100, 101.4, 102.6, 101.8, 103.3, 104.5];
  const portfolioBase = [100, 101.8, 103.5, 103.1, 105.5, 107.4];
  const labels = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04'];
  const returns_preview = labels.map((label, index) => ({
    label,
    date: `${label}-28`.replace('2025-11', '2025-11-30').replace('2025-12', '2025-12-31').replace('2026-01', '2026-01-31').replace('2026-02', '2026-02-28').replace('2026-03', '2026-03-31').replace('2026-04', '2026-04-30'),
    portfolio_return_pct: index === 0 ? 1.2 : Number((portfolioBase[index] - portfolioBase[index - 1]).toFixed(2)),
    cumulative_return_pct: Number((portfolioBase[index] - 100).toFixed(2)),
  }));
  const benchmark_series = labels.map((label, index) => ({
    label,
    date: returns_preview[index]?.date,
    benchmark_return_pct: index === 0 ? 0.9 : Number((benchmarkBase[index] - benchmarkBase[index - 1]).toFixed(2)),
    cumulative_return_pct: Number((benchmarkBase[index] - 100).toFixed(2)),
  }));
  const spread_series = labels.map((label, index) => ({
    label,
    date: returns_preview[index]?.date,
    spread_pct: Number(
      (returns_preview[index].cumulative_return_pct - benchmark_series[index].cumulative_return_pct).toFixed(2),
    ),
  }));
  const correlation_matrix = normalizedLegs.flatMap((left, leftIndex) =>
    normalizedLegs
      .slice(leftIndex)
      .map((right, rightIndex) => ({
        x_key: left.id,
        y_key: right.id,
        correlation:
          left.id === right.id
            ? 1
            : Number((0.42 - (leftIndex + rightIndex) * 0.11).toFixed(2)),
      })),
  );
  const risk_contribution_preview = normalizedLegs.map((leg, index) => ({
    leg_id: leg.id,
    label: leg.display_name,
    weight_pct: leg.weight_pct,
    volatility_pct: Number((Math.max(1.2, 18 - index * 4.1)).toFixed(2)),
    contribution_pct: Number((leg.weight_pct * (1.25 - index * 0.12)).toFixed(2)),
  }));
  const tradeCost = payload.cost_policy?.trade_cost_bps ?? 8;
  const turnoverBudget = payload.cost_policy?.turnover_budget_bps ?? 12;
  const expenseRatio = payload.cost_policy?.expense_ratio_bps ?? 18;
  const score = Math.max(58, Math.min(92, 70 + normalizedLegs.length * 3 + (totalWeight === 100 ? 4 : -6)));
  return {
    weight_summary: {
      total_weight_pct: Number(totalWeight.toFixed(2)),
      target_weight_pct: 100,
      residual_weight_pct: Number((100 - totalWeight).toFixed(2)),
      locked_weight_pct: Number(lockedWeight.toFixed(2)),
      unlocked_weight_pct: Number((totalWeight - lockedWeight).toFixed(2)),
      within_tolerance: Math.abs(totalWeight - 100) <= 0.25,
    },
    normalized_legs: normalizedLegs,
    returns_preview,
    benchmark_series,
    spread_series,
    correlation_matrix,
    risk_contribution_preview,
    maintenance_cost_summary: {
      expense_ratio_bps: expenseRatio,
      turnover_budget_bps: turnoverBudget,
      trade_cost_bps: tradeCost,
      total_estimated_bps: expenseRatio + turnoverBudget + tradeCost,
      notes: ['按季度维护成本估算', '现金腿承担调仓缓冲'],
    },
    rebalance_summary: {
      rebalance_frequency: payload.rebalance_frequency ?? 'quarterly',
      cadence_label: payload.rebalance_frequency === 'monthly' ? '每月再平衡' : '季度再平衡',
      checks_per_year: payload.rebalance_frequency === 'monthly' ? 12 : 4,
      operating_tempo_label: '以维护窗口驱动',
    },
    composition_score: {
      score,
      verdict: score >= 80 ? '成立' : '观察',
      factors: [
        { key: 'diversification', label: '分散度', score: 84, detail: '策略、资产与现金腿形成基础分散。', tone: 'positive' },
        { key: 'evidence', label: '来源可信度', score: 79, detail: '核心来源均可追溯到快照或回测。', tone: 'positive' },
        { key: 'cost', label: '成本控制', score: 73, detail: '再平衡维护成本仍需跟踪。', tone: 'warning' },
        { key: 'alpha', label: '收益增强', score: 80, detail: '相对基准保留超额空间。', tone: 'positive' },
      ],
    },
    warnings: totalWeight < 99.75 || totalWeight > 100.25 ? ['权重未完全对齐到 100%。'] : [],
    advisories: ['相关性预览仅用于一期装配验证。'],
  };
}

function buildCompositionDetailFromPayload(
  id: string,
  payload: ApiCompositionCreatePayload,
  status: ApiCompositionStatus,
  createdAt: string,
  updatedAt: string,
): ApiCompositionDetail {
  const preview = buildCompositionPreview(payload);
  const benchmark = payload.benchmark_definition ?? { label: '60/40 基准', symbol: '6040' };
  return {
    id,
    name: payload.name ?? '未命名组合',
    description: payload.description ?? null,
    status,
    status_label: status === 'ACTIVE' ? '运行中' : status === 'ARCHIVED' ? '已归档' : '草稿',
    created_at: createdAt,
    updated_at: updatedAt,
    benchmark_definition: benchmark,
    rebalance_frequency: payload.rebalance_frequency ?? 'quarterly',
    cost_policy: payload.cost_policy ?? {
      expense_ratio_bps: 18,
      turnover_budget_bps: 12,
      trade_cost_bps: 8,
    },
    hero_summary: {
      title: payload.name ?? '未命名组合',
      subtitle: payload.description ?? '由策略腿、资产腿与现金腿组装而成。',
      status,
      status_label: status === 'ACTIVE' ? '运行中' : status === 'ARCHIVED' ? '已归档' : '草稿',
      benchmark_label: benchmark.label ?? benchmark.symbol ?? '基准',
      leg_count: preview.normalized_legs.length,
      composition_score: preview.composition_score.score,
      updated_at: updatedAt,
    },
    kpis: [
      { key: 'annualized_return', label: '年化收益', value: 9.8, unit: '%', tone: 'positive', detail: '超基准 2.1%' },
      { key: 'max_drawdown', label: '最大回撤', value: -7.4, unit: '%', tone: 'warning', detail: '恢复期 41 天' },
      { key: 'sharpe', label: '夏普比率', value: 1.24, tone: 'positive', detail: '风险收益平衡稳定' },
      { key: 'sortino', label: '索提诺比率', value: 1.61, tone: 'positive', detail: '下行波动受控' },
      { key: 'rebalance_cost', label: '再平衡成本', value: preview.maintenance_cost_summary.trade_cost_bps, unit: 'bps', tone: 'neutral', detail: '单次窗口估算' },
      { key: 'legs', label: '腿数量', value: preview.normalized_legs.length, tone: 'neutral', detail: '已完成结构归一' },
      { key: 'composition_score', label: '成立性评分', value: preview.composition_score.score, tone: 'positive', detail: '基于最近 24 个月快照估算' },
    ],
    weight_summary: preview.weight_summary,
    normalized_legs: preview.normalized_legs,
    returns_preview: preview.returns_preview,
    benchmark_series: preview.benchmark_series,
    spread_series: preview.spread_series,
    rebalance_markers: [
      { label: '季度再平衡', date: preview.returns_preview[2]?.date ?? null, index: 2 },
      { label: '季度再平衡', date: preview.returns_preview[5]?.date ?? null, index: 5 },
    ],
    correlation_matrix: preview.correlation_matrix,
    risk_contribution_preview: preview.risk_contribution_preview,
    maintenance_cost_summary: preview.maintenance_cost_summary,
    scenario_summary: {
      base_case: { label: '常态波动', expected_drawdown_pct: -7.4 },
      stress_case: { label: '加息压力期', expected_drawdown_pct: -11.2 },
      dispersion_note: '债券腿与策略腿的压力相关性需要持续跟踪。',
    },
    source_evidence: preview.normalized_legs.map((leg, index) => ({
      id: `freeze-${id}-${index + 1}`,
      leg_id: leg.id,
      display_name: leg.display_name,
      freeze_ref_type: leg.source_ref_type,
      freeze_ref_id: leg.source_ref_id,
      freeze_hash: `hash-${index + 1}`,
      captured_at: updatedAt,
      snapshot: { proof_label: leg.proof_label, config: leg.config },
    })),
    composition_score: preview.composition_score,
    latest_activity_label: `${updatedAt.slice(0, 10)} 更新`,
    deep_link_actions: [
      'open_composition_workbench',
      'open_leg_inventory',
      'inspect_source_evidence',
      'refresh_snapshots',
    ],
  };
}

function normalizeCompositionStatus(value?: string | null): ApiCompositionStatus {
  const normalized = String(value || '').toUpperCase();
  if (normalized === 'ACTIVE' || normalized === 'ARCHIVED') {
    return normalized;
  }
  return 'DRAFT';
}

function buildBondFixedIncomeOverview(
  base: Pick<
    ApiSnapshotOverview,
    'overall_status' | 'last_refreshed_at' | 'latest_job' | 'blocking_code' | 'blocking_target'
  >,
) {
  const updatedAt = base.last_refreshed_at ?? null;
  const bondRows: ApiBondSnapshotEligibleInstrument[] = [
    {
      id: 'bond-ust-cmt-2y',
      label: 'UST CMT 2Y',
      instrument_type: 'BOND',
      asset_type: 'UST',
      tenor_label: '2Y',
      audit_profile: 'UST_CMT_2Y',
      source: 'bond_fixed_income',
      status: 'WATCH',
      symbol: 'UST2Y',
      currency: 'USD',
      snapshot_date: '2026-04-23',
      ytm_pct: 1.0,
      duration: 1.9,
      effective_duration: 1.9,
      snapshot_ref: 'bond-ust-cmt-2y',
      refresh_status: 'READY',
      missing_fields: [],
      inferred_fields: {},
      field_status: { ytm_pct: 'READY' },
      audit_alerts: ['UST_CMT_2Y/10Y spread 365 bps is outside the -100..300 bps audit band.'],
      audit_notes: ['UST_CMT_2Y/10Y spread 365 bps; audit band -100..300 bps.'],
      updated_at: updatedAt,
    },
    {
      id: 'bond-ust-cmt-10y',
      label: 'UST CMT 10Y',
      instrument_type: 'BOND',
      asset_type: 'UST',
      tenor_label: '10Y',
      audit_profile: 'UST_CMT_10Y',
      source: 'bond_fixed_income',
      status: 'WATCH',
      symbol: 'UST10Y',
      currency: 'USD',
      snapshot_date: '2026-04-23',
      ytm_pct: 4.65,
      duration: 8.3,
      effective_duration: 8.3,
      snapshot_ref: 'bond-ust-cmt-10y',
      refresh_status: 'READY',
      missing_fields: [],
      inferred_fields: {},
      field_status: { ytm_pct: 'READY' },
      audit_alerts: ['UST_CMT_2Y/10Y spread 365 bps is outside the -100..300 bps audit band.'],
      audit_notes: ['UST_CMT_2Y/10Y spread 365 bps; audit band -100..300 bps.'],
      updated_at: updatedAt,
    },
    {
      id: 'bond-ust-cmt-30y',
      label: 'UST CMT 30Y',
      instrument_type: 'BOND',
      asset_type: 'UST',
      tenor_label: '30Y',
      audit_profile: 'UST_CMT_30Y',
      source: 'bond_fixed_income',
      status: 'READY',
      symbol: 'UST30Y',
      currency: 'USD',
      snapshot_date: '2026-04-23',
      ytm_pct: 4.8,
      duration: 17.8,
      effective_duration: 17.8,
      snapshot_ref: 'bond-ust-cmt-30y',
      refresh_status: 'READY',
      missing_fields: [],
      inferred_fields: {},
      field_status: { ytm_pct: 'READY' },
      audit_alerts: [],
      audit_notes: [],
      updated_at: updatedAt,
    },
    {
      id: 'bond-ust-bill-13w',
      label: 'UST T-Bill 13W',
      instrument_type: 'T_BILL',
      asset_type: 'T_BILL',
      tenor_label: '13W',
      audit_profile: 'UST_BILL_3M',
      source: 'bond_fixed_income',
      status: 'READY',
      symbol: 'TBILL13W',
      currency: 'USD',
      snapshot_date: '2026-04-23',
      maturity_date: '2026-07-23',
      clean_price: 98.75,
      net_price: 98.75,
      dirty_price: 98.75,
      full_price: 98.75,
      accrued_interest: null,
      discount_rate_pct: 5.18,
      ytm_pct: 5.21,
      duration: 0.24,
      effective_duration: 0.24,
      snapshot_ref: 'bond-ust-bill-13w',
      refresh_status: 'READY',
      missing_fields: ['accrued_interest'],
      inferred_fields: {},
      field_status: { accrued_interest: 'WAIVED', discount_rate_pct: 'READY' },
      audit_alerts: [],
      audit_notes: ['Accrued interest is waived for the UST_BILL_3M audit profile.'],
      updated_at: updatedAt,
    },
    {
      id: 'bond-tips-5y',
      label: 'TIPS 5Y',
      instrument_type: 'TIPS',
      asset_type: 'TIPS',
      tenor_label: '5Y',
      audit_profile: 'TIPS_5Y',
      source: 'bond_fixed_income',
      status: 'READY',
      symbol: 'TIPS5Y',
      currency: 'USD',
      snapshot_date: '2026-04-23',
      ytm_pct: 3.94,
      real_yield_pct: 1.82,
      inflation_factor: 1.0312,
      breakeven_inflation_bps: 212,
      duration: 4.7,
      effective_duration: 4.7,
      snapshot_ref: 'bond-tips-5y',
      refresh_status: 'READY',
      missing_fields: [],
      inferred_fields: {},
      field_status: { real_yield_pct: 'READY', breakeven_inflation_bps: 'READY' },
      audit_alerts: [],
      audit_notes: [],
      updated_at: updatedAt,
    },
    {
      id: 'bond-tips-10y',
      label: 'TIPS 10Y',
      instrument_type: 'TIPS',
      asset_type: 'TIPS',
      tenor_label: '10Y',
      audit_profile: 'TIPS_10Y',
      source: 'bond_fixed_income',
      status: 'READY',
      symbol: 'TIPS10Y',
      currency: 'USD',
      snapshot_date: '2026-04-23',
      ytm_pct: 4.05,
      real_yield_pct: 2.03,
      inflation_factor: 1.0425,
      breakeven_inflation_bps: 262,
      duration: 7.9,
      effective_duration: 7.9,
      snapshot_ref: 'bond-tips-10y',
      refresh_status: 'READY',
      missing_fields: [],
      inferred_fields: {},
      field_status: { real_yield_pct: 'READY', breakeven_inflation_bps: 'READY' },
      audit_alerts: [],
      audit_notes: [],
      updated_at: updatedAt,
    },
    {
      id: 'bond-lqd-watch',
      label: 'LQD Investment Grade ETF',
      instrument_type: 'ETF',
      asset_type: 'BOND_ETF',
      tenor_label: 'ETF',
      audit_profile: 'LQD',
      source: 'bond_fixed_income',
      status: 'WATCH',
      symbol: 'LQD',
      currency: 'USD',
      snapshot_date: '2026-04-23',
      sec_yield_30d_pct: 4.73,
      credit_quality: 'A-',
      tracking_error_bps: null,
      tracking_status: 'WATCH',
      snapshot_ref: 'bond-lqd-watch',
      refresh_status: 'READY',
      missing_fields: ['tracking_error_bps'],
      inferred_fields: {},
      field_status: { tracking_error_bps: 'MISSING' },
      audit_alerts: ['Published tracking_error_bps is required for BOND_ETF readiness.'],
      audit_notes: ['Official tracking-error evidence pending.'],
      updated_at: updatedAt,
    },
  ];
  return {
    global_pulse: {
      status: base.overall_status === 'READY' ? 'READY' : 'PARTIAL',
      headline: '债券快照与影子字段已纳入统一快照治理视图。',
      updated_at: base.last_refreshed_at ?? null,
      cards: [
        { id: 'health', label: '就绪比例', status: 'WATCH', value: '4/7', detail: 'READY / WATCH 已拆分显示' },
        { id: 'coverage', label: '影子字段覆盖率', status: 'READY', value: '94%', detail: 'Dirty Price / Accrued / Duration / YTM' },
        { id: 'source', label: '来源健康度', status: 'READY', value: 'FMP / Polygon', detail: '主来源链路可用' },
      ],
    },
    pillar_groups: [
      {
        id: 'ust',
        label: '利率债 (UST)',
        status: 'READY',
        items: [
          { id: 'ust-2y', label: '2Y', status: 'READY', value: '4.01%', detail: 'Accrued / Duration 已齐备' },
          { id: 'ust-10y', label: '10Y', status: 'READY', value: '4.20%', detail: '10Y-2Y 利差 19 bps' },
          { id: 'ust-30y', label: '30Y', status: 'PARTIAL', value: '4.36%', detail: '待复核凸性字段' },
        ],
      },
      {
        id: 'tips',
        label: '抗通胀债 (TIPS)',
        status: 'READY',
        items: [
          { id: 'tips-5y', label: '5Y TIPS', status: 'READY', value: '1.98%', detail: 'Real Yield 抓取成功' },
          { id: 'tips-10y', label: '10Y TIPS', status: 'READY', value: '2.08%', detail: '可用于实际利率对冲' },
        ],
      },
      {
        id: 'ig',
        label: '投资级信用债 (IG)',
        status: 'PARTIAL',
        items: [
          { id: 'ig-aa', label: 'AA Bucket', status: 'PARTIAL', value: '5.02%', detail: '缺少部分应计利息' },
          { id: 'ig-aaa', label: 'AAA Bucket', status: 'READY', value: '4.81%', detail: 'Carry 字段齐备' },
        ],
      },
    ],
    curve_preview: [
      { tenor_label: '2Y', yield_pct: 4.01, spread_bps: 0 },
      { tenor_label: '5Y', yield_pct: 4.05, spread_bps: 4 },
      { tenor_label: '10Y', yield_pct: 4.2, spread_bps: 19 },
      { tenor_label: '30Y', yield_pct: 4.36, spread_bps: 35 },
    ],
    audit_matrix: [
      { id: 'bond-ust-2y', label: 'Bond-UST2Y', owner: 'FMP', status: 'READY', cadence_label: 'EOD', evidence: 'Dirty / Accrued / Duration / YTM' },
      { id: 'bond-ust-10y', label: 'Bond-UST10Y', owner: 'FMP', status: 'READY', cadence_label: 'EOD', evidence: '影子字段齐全' },
      { id: 'bond-ig-aa', label: 'Bond-IG-AA', owner: 'Polygon', status: 'PARTIAL', cadence_label: 'EOD', evidence: 'Accrued 缺失，可算法推演' },
    ],
    raw_registry: bondRows.map((row) => ({
      id: `registry-${row.id}`,
      label: row.label,
      status: row.status,
      source: row.source,
      snapshot_ref: row.snapshot_ref,
      updated_at: row.updated_at,
      notes: row.audit_notes ?? [],
    })),
    eligible_sources: [
      {
        id: 'bond-source-runtime',
        label: 'Runtime bond fixed-income snapshots',
        source: 'bond_fixed_income',
        status: 'WATCH',
        access_tier: 'runtime',
        instrument_types: ['BOND', 'T_BILL', 'TIPS', 'ETF'],
        coverage_notes: ['7 runtime bond rows', 'LQD remains WATCH until published tracking_error_bps lands'],
        updated_at: updatedAt,
      },
    ],
    eligible_instruments: bondRows,
    scheduler: {
      status: 'READY',
      cadence_label: '日终刷新',
      next_action: '刷新债券快照',
      last_job_id: base.latest_job?.id ?? null,
    },
    selected_source_summary: {
      primary_source: 'FMP',
      fallback_source: 'Polygon',
      selection_reason: '优先复用已有快照总览，再按固定收益字段补强。',
    },
    system_diagnostics: {
      blocking_code: base.blocking_code ?? null,
      blocking_target: base.blocking_target ?? null,
      refresh_job_status: base.latest_job?.status ?? null,
      memory: { ready_ratio: '75%', latency: '15m' },
      notes: ['IG 债存在应计利息缺口', '曲线形态相对昨日平稳'],
    },
  };
}

function sortOptimizationJobs(): void {
  state.optimizationJobs = [...state.optimizationJobs].sort((left, right) => {
    const leftTime = Date.parse(left.updated_at ?? left.completed_at ?? left.created_at ?? '');
    const rightTime = Date.parse(right.updated_at ?? right.completed_at ?? right.created_at ?? '');
    return rightTime - leftTime;
  });
}

function syncOptimizationJob(job: ApiOptimizationJobDetail): ApiOptimizationJobDetail {
  const strategy = findStrategy(job.strategy_id);
  const normalized = hydrateOptimizationJob(strategy, job, getOptimizationSourceRun(job));
  const index = state.optimizationJobs.findIndex((item) => item.id === job.id);
  if (index >= 0) {
    state.optimizationJobs[index] = normalized;
  }
  return normalized;
}

function findJob(id: string): ApiOptimizationJobDetail {
  const job = state.optimizationJobs.find((item) => item.id === id);
  if (!job) {
    throw new ApiError({ status: 404, code: 'optimization_job_not_found', message: `Optimization job ${id} was not found.` });
  }
  return syncOptimizationJob(job);
}

function recalculateJob(job: ApiOptimizationJobDetail): ApiOptimizationJobDetail {
  job.updated_at = nowIso();
  const normalized = syncOptimizationJob(job);
  sortOptimizationJobs();
  return normalized;
}

function isOptimizationInFlight(status: string | null | undefined): boolean {
  return ['QUEUED', 'RUNNING'].includes(String(status ?? '').toUpperCase());
}

function estimateCompletedAt(remainingMinutes: number | null): string | null {
  if (remainingMinutes === null) {
    return null;
  }
  if (remainingMinutes <= 0) {
    return nowIso();
  }
  return new Date(Date.now() + remainingMinutes * 60_000).toISOString();
}

function buildDemoOptimizationProgressPlan(): Array<{
  status: ApiOptimizationJobDetail['status'];
  progressPct: number;
  candidateCount: number;
  currentStage: string;
  estimatedRemainingMinutes: number | null;
  latestUpdate: string | ((candidate: ApiOptimizationCandidate | undefined) => string);
}> {
  return [
    {
      status: 'QUEUED',
      progressPct: 0,
      candidateCount: 0,
      currentStage: '任务已创建',
      estimatedRemainingMinutes: null,
      latestUpdate: '优化任务已创建，正在准备搜索队列。',
    },
    {
      status: 'RUNNING',
      progressPct: 16,
      candidateCount: 0,
      currentStage: '首轮搜索',
      estimatedRemainingMinutes: null,
      latestUpdate: '正在收集首轮组合表现，结果中心会自动刷新。',
    },
    {
      status: 'RUNNING',
      progressPct: 44,
      candidateCount: 1,
      currentStage: '候选生成',
      estimatedRemainingMinutes: 18,
      latestUpdate: (candidate) => `首个候选 ${candidate?.label ?? '已生成'} 已进入稳定性检查。`,
    },
    {
      status: 'RUNNING',
      progressPct: 68,
      candidateCount: 2,
      currentStage: '稳定性验证',
      estimatedRemainingMinutes: 11,
      latestUpdate: (candidate) => `正在扩大验证窗口，当前首位候选为 ${candidate?.label ?? '待更新'}。`,
    },
    {
      status: 'RUNNING',
      progressPct: 88,
      candidateCount: 3,
      currentStage: '热区扫描',
      estimatedRemainingMinutes: 5,
      latestUpdate: '参数热区和多窗口验证即将完成。',
    },
    {
      status: 'COMPLETED',
      progressPct: 100,
      candidateCount: 4,
      currentStage: '优化完成',
      estimatedRemainingMinutes: 0,
      latestUpdate: (candidate) => `优化已完成，当前首选为 ${candidate?.label ?? '最新候选'}。`,
    },
  ];
}

function countCompletedCombinations(budgetCombinations: number, progressPct: number, minimum = 0): number {
  if (budgetCombinations <= 0) {
    return 0;
  }
  const estimated = Math.round((budgetCombinations * Math.max(progressPct, 0)) / 100);
  const floor = progressPct > 0 ? 1 : 0;
  return Math.min(budgetCombinations, Math.max(minimum, floor, estimated));
}

function advanceOptimizationJob(job: ApiOptimizationJobDetail): ApiOptimizationJobDetail {
  if (!isOptimizationInFlight(job.status)) {
    return syncOptimizationJob(job);
  }

  const stagePlan = buildDemoOptimizationProgressPlan();
  const currentStageIndex =
    typeof job.summary?.mock_progress_stage === 'number' && Number.isFinite(job.summary.mock_progress_stage)
      ? job.summary.mock_progress_stage
      : 0;
  const nextStageIndex = Math.min(currentStageIndex + 1, stagePlan.length - 1);
  const nextStage = stagePlan[nextStageIndex];
  const strategy = findStrategy(job.strategy_id);
  const sourceRun = getOptimizationSourceRun(job);
  const allCandidates = hydrateOptimizationJob(strategy, { ...clone(job), status: 'COMPLETED' }, sourceRun).candidates;
  const publishedCandidates = allCandidates.slice(0, nextStage.candidateCount);
  const budgetCombinations =
    typeof job.request?.budget_combinations === 'number'
      ? job.request.budget_combinations
      : typeof job.summary?.budget_combinations === 'number'
        ? job.summary.budget_combinations
        : 42;
  const leadingCandidate = publishedCandidates[0];
  const latestUpdate =
    typeof nextStage.latestUpdate === 'function'
      ? nextStage.latestUpdate(leadingCandidate)
      : nextStage.latestUpdate;
  const estimatedRemainingMinutes = nextStage.estimatedRemainingMinutes;
  const estimatedCompletedAt = estimateCompletedAt(estimatedRemainingMinutes);

  job.status = nextStage.status;
  job.candidates = publishedCandidates;
  job.updated_at = nowIso();
  job.completed_at = nextStage.status === 'COMPLETED' ? nowIso() : null;
  job.summary = {
    ...job.summary,
    mock_progress_stage: nextStageIndex,
    budget_combinations: budgetCombinations,
    completed_combinations: countCompletedCombinations(
      budgetCombinations,
      nextStage.progressPct,
      publishedCandidates.length,
    ),
    current_stage: nextStage.currentStage,
    latest_update: latestUpdate,
    latest_candidate_label: leadingCandidate?.label ?? null,
    progress_pct: nextStage.progressPct,
    estimated_remaining_minutes: estimatedRemainingMinutes,
    estimated_completed_at: estimatedCompletedAt,
  };
  job.result = {
    ...job.result,
    best_candidate_id: leadingCandidate?.id ?? null,
    best_candidate_label: leadingCandidate?.label ?? null,
    headline:
      leadingCandidate?.title ??
      (nextStage.status === 'COMPLETED' ? '优化结果已就绪' : '优化进行中'),
    summary: latestUpdate,
    status: nextStage.status,
    progress_pct: nextStage.progressPct,
    current_stage: nextStage.currentStage,
    latest_update: latestUpdate,
  };

  return recalculateJob(job);
}

function resumeOptimizationJob(job: ApiOptimizationJobDetail): ApiOptimizationJobDetail {
  if (job.status !== 'INTERRUPTED') {
    return syncOptimizationJob(job);
  }

  job.status = 'RUNNING';
  job.updated_at = nowIso();
  job.summary = {
    ...job.summary,
    status: 'RUNNING',
    current_stage: job.summary.current_stage ?? '断点恢复中',
    latest_update: '已继续优化，正在从断点恢复。',
    resume_ready: false,
    estimated_remaining_minutes: 12,
    estimated_completed_at: estimateCompletedAt(12),
  };
  job.result = {
    ...job.result,
    status: 'RUNNING',
    current_stage: job.summary.current_stage ?? job.result.current_stage ?? '断点恢复中',
    latest_update: '已继续优化，正在从断点恢复。',
  };
  return recalculateJob(job);
}

function promoteConflictKey(jobId: string, candidateId: string): string {
  return `${jobId}:${candidateId}`;
}

function toRunListItem(run: ApiBacktestRunDetail): ApiBacktestRunListItem {
  return {
    id: run.id,
    strategy_id: run.strategy_id ?? 'strat-001',
    strategy_name: run.strategy_name,
    status: run.status,
    created_at: run.created_at ?? nowIso(),
    updated_at: run.updated_at ?? run.completed_at ?? nowIso(),
    completed_at: run.completed_at ?? null,
    metrics: clone(run.metrics ?? {}),
    warnings: clone(run.warnings ?? []),
    preview: run.preview ? clone(run.preview) : undefined,
    data_segment_type: run.data_segment_type,
    parameter_version_id: run.parameter_version_id ?? null,
    is_permanent: run.is_permanent,
    source_run_id: run.source_run_id ?? null,
    trades_count: run.trades_count,
  };
}

function buildSnapshotOverview(
  refreshedAt = '2026-04-01T07:48:00Z',
  mode: 'incremental' | 'repair' | 'full' = 'incremental',
): ApiSnapshotOverview {
  const overviewBase = {
    overall_status: 'INCOMPLETE',
    last_refreshed_at: refreshedAt,
    dataset_snapshots: [
      {
        id: 'ds-corporate-actions',
        name: '公司行为快照',
        status: 'INCOMPLETE',
        as_of: refreshedAt,
        freshness_label: '最新数据可用',
        start_date: '1996-01-01',
        end_date: '2026-04-01',
        row_count: 182430,
        source: 'tiingo',
        fallback_source: 'alpha_vantage',
        blocker: {
          code: 'CORPORATE_ACTIONS_INCOMPLETE',
          message: '公司行为快照仍有缺口，正式回测前需要先补齐。',
        },
      },
      {
        id: 'ds-price',
        name: '价格条快照',
        status: 'READY',
        as_of: refreshedAt,
        freshness_label: '最新数据可用',
        start_date: '1996-01-01',
        end_date: '2026-04-01',
        row_count: 4320,
        source: 'yahoo',
        fallback_source: 'sec_edgar',
        blocker: null,
        metadata: {
          selected_latest_symbols: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'AMD', 'AVGO'],
          benchmark_etf_coverage: {
            ready_count: 2,
            total_count: 2,
            missing_symbols: [],
            symbols: [
              { symbol: 'SPY', status: 'READY', start_date: '1996-01-02', end_date: '2026-04-01', trade_days: 7610 },
              { symbol: 'QQQ', status: 'READY', start_date: '1999-03-10', end_date: '2026-04-01', trade_days: 6806 },
            ],
          },
        },
      },
    ],
    universe_snapshots: [
      {
        id: 'un-sp500',
        name: 'SP500',
        status: 'INCOMPLETE',
        as_of: refreshedAt,
        freshness_label: '历史锚点待补齐 (38/61)',
        window_start: '1996-01-01',
        window_end: '2026-04-01',
        anchor_schedule: '01-01 / 07-01',
        member_count: 502,
        source: 'official_announcement',
        fallback_source: 'wikipedia_revision_history',
        blocker: {
          code: 'UNIVERSE_HISTORY_INCOMPLETE',
          message: '指数成员历史仍有缺口，正式回测会继续受限。',
        },
      },
      {
        id: 'un-ndx100',
        name: 'NASDAQ100',
        status: 'INCOMPLETE',
        as_of: refreshedAt,
        freshness_label: '历史锚点待补齐 (14/61)',
        window_start: '1996-01-01',
        window_end: '2026-04-01',
        anchor_schedule: '01-01 / 07-01',
        member_count: 101,
        source: 'nasdaq_official_annual_changes',
        fallback_source: 'wikipedia_revision_history',
        blocker: {
          code: 'UNIVERSE_HISTORY_INCOMPLETE',
          message: 'NASDAQ100 历史锚点仍在补齐中。',
        },
      },
    ],
    latest_job: {
      id: 'snap-job-20260401',
      status: 'COMPLETED',
      started_at: '2026-04-01T07:30:00Z',
      completed_at: refreshedAt,
      request: {
        mode,
        targets: ['price', 'corporate', 'valuations', 'universes'],
      },
      summary: {
        dataset_snapshot_count: 2,
        universe_snapshot_count: 2,
        status: 'INCOMPLETE',
        mode,
      },
      warnings: [],
      errors: [],
    },
    blocking_code: 'CORPORATE_ACTIONS_INCOMPLETE',
    blocking_target: 'ds-corporate-actions',
    message: '部分快照仍待补齐，正式回测前请先完成刷新。',
    allowed_actions: ['refresh_snapshots'],
    data_layer_readiness: [
      {
        layer_id: 'l1_market_data',
        title_cn: 'L1 基础行情',
        status: 'READY',
        summary: '价格快照与基准覆盖可用，支持 stock tab 监控。',
        metrics: [
          { label: '价格快照', value: '1/1', detail: 'ds-price 已刷新' },
          { label: '复权链路', value: '待修复', detail: 'corporate actions 仍有缺口' },
        ],
        updated_at: refreshedAt,
        provider_keys: ['tiingo', 'alpha_vantage'],
        linked_targets: ['ds-price', 'ds-corporate-actions'],
      },
      {
        layer_id: 'l2_fundamental_data',
        title_cn: 'L2 财务截面',
        status: 'WARNING',
        summary: '财务截面未正式接入，本期仅点亮治理告警。',
        metrics: [
          { label: '财报快照', value: '待接入', detail: 'FMP 10-K / 10-Q' },
          { label: '发布日对齐', value: '待校验', detail: 'publish_date / available_at' },
        ],
        updated_at: refreshedAt,
        provider_keys: ['FMP_API_KEY'],
        linked_targets: ['ds-fundamentals'],
      },
      {
        layer_id: 'l3_sentiment_data',
        title_cn: 'L3 分析师与情绪',
        status: 'WARNING',
        summary: '情绪链路仍处于盲区监控阶段。',
        metrics: [
          { label: '一致预期', value: 'N<3', detail: '分析师样本不足' },
          { label: '短卖成交', value: '待巡检', detail: '异常跳变需核查' },
        ],
        updated_at: refreshedAt,
        provider_keys: ['ALPHAVANTAGE_API_KEY', 'FINRA'],
        linked_targets: ['analyst-consensus', 'short-volume'],
      },
      {
        layer_id: 'l4_macro_derivatives',
        title_cn: 'L4 宏观与衍生品',
        status: 'CALIBRATING',
        summary: '宏观序列可接入，但利率 Beta 与 IV Skew 尚未定标。',
        metrics: [
          { label: '宏观序列', value: '可接入', detail: 'FRED 10Y / CPI' },
          { label: '期权面板', value: '待接入', detail: 'ThetaData' },
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
        detail_cn: '财务截面接入前需先补齐资产负债恒等式核验。',
        source_layer: 'l2_fundamental_data',
        blocking: false,
        target: 'ds-fundamentals',
      },
      {
        code: 'CONSENSUS_BLIND_SPOT',
        severity: 'warning',
        title_cn: '情绪盲区待修复',
        detail_cn: '分析师样本数不足时，不允许将修正信号晋升为正式因子。',
        source_layer: 'l3_sentiment_data',
        blocking: false,
        target: 'analyst-consensus',
      },
      {
        code: 'SHORT_VOLUME_JUMP_REVIEW',
        severity: 'warning',
        title_cn: '卖空成交需巡检',
        detail_cn: '短卖成交占比若出现异常跳变，应转入核查。',
        source_layer: 'l3_sentiment_data',
        blocking: false,
        target: 'short-volume',
      },
      {
        code: 'RATE_BETA_CALIBRATING',
        severity: 'info',
        title_cn: '利率 Beta 校准中',
        detail_cn: '宏观链路已预留，但回归参数尚未完成稳定校准。',
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
        blockers: ['财务发布日尚未接入 PIT'],
        linked_layers: ['l2_fundamental_data'],
      },
      {
        dimension_id: 'sentiment_micro',
        title_cn: '情绪与微观结构',
        status: 'WARNING',
        supported_factors: ['分析师修正', '超额换手', '空头回补'],
        blockers: ['一致预期样本不足', '卖空链路待巡检'],
        linked_layers: ['l3_sentiment_data'],
      },
      {
        dimension_id: 'macro_derivatives',
        title_cn: '宏观与衍生品',
        status: 'CALIBRATING',
        supported_factors: ['利率敏感度', '通胀 Beta', 'IV Skew'],
        blockers: ['滚动回归尚未定标', '期权面板未接入'],
        linked_layers: ['l4_macro_derivatives'],
      },
    ],
  };
  return {
    ...overviewBase,
    bond_fixed_income: buildBondFixedIncomeOverview(overviewBase),
  };
}

const demoFactorSummaries: Record<string, ApiFactorListItem['latest_diagnostic_summary']> = {
  s_mom_12m1m_rank: {
    run_id: 'fdiag-demo-momentum',
    factor_id: 's_mom_12m1m_rank',
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
      { window: '10年', bucket: '压力', value: -0.012, state: '缺口' },
      { window: '20年', bucket: '样本内', value: 0.052, state: '通过' },
      { window: '20年', bucket: '样本外', value: 0.037, state: '预警' },
      { window: '20年', bucket: '压力', value: -0.024, state: '缺口' },
      { window: '30年', bucket: '样本内', value: 0.044, state: '通过' },
      { window: '30年', bucket: '样本外', value: 0.029, state: '预警' },
      { window: '30年', bucket: '压力', value: -0.035, state: '缺口' },
      { window: '30年', bucket: '漂移', value: 0.018, state: '预警' },
    ],
    turnover_decay: {
      half_life_days: 126,
      annual_turnover_pct: 185,
      impact_cost_bps: 18,
      financing_cost_bps: 32,
      slippage_bps: 6,
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
      operator: 'researcher',
    },
  },
  s_vol_252d_rank: {
    run_id: 'fdiag-demo-lowvol',
    factor_id: 's_vol_252d_rank',
    status: 'COMPLETED',
    dataset_snapshot_id: 'ds-price',
    fundamental_snapshot_id: 'ds-fundamentals',
    universe_snapshot_id: 'un-sp500',
    cleaning_version: 'snapshot-derived-v1',
    ic: 0.026,
    rank_ic: 0.044,
    ir: 0.62,
    coverage: 89.6,
    group_returns: [
      { group: '第1组', mean_return: 0.029, sample_count: 101 },
      { group: '第2组', mean_return: 0.018, sample_count: 100 },
      { group: '第3组', mean_return: 0.011, sample_count: 100 },
      { group: '第4组', mean_return: 0.003, sample_count: 100 },
      { group: '第5组', mean_return: -0.009, sample_count: 101 },
    ],
    ic_series: Array.from({ length: 12 }, (_, index) => ({
      date: `2025-${String(index + 1).padStart(2, '0')}-28`,
      rank_ic: Number((0.035 + Math.cos(index / 2.2) * 0.018).toFixed(4)),
      symbol_count: 420,
    })),
    evidence_heatmap: [],
    turnover_decay: { half_life_days: 252, annual_turnover_pct: 72, impact_cost_bps: 9 },
    stress_scenarios: [],
    risk_flags: ['低波动因子需同步监控拥挤度。'],
  },
};

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

function buildPitDataOverview(): ApiPitDataOverview {
  const limitedReady = Boolean(demoPitWaiver);
  return {
    dataset_snapshot_id: 'ds-price',
    fundamental_snapshot_id: 'ds-fundamentals',
    universe_snapshot_id: 'un-sp500',
    as_of_date: '2026-04-01',
    cleaning_version: 'snapshot-derived-v1',
    overall_status: limitedReady ? 'LIMITED_READY' : 'BLOCKED',
    adjusted_price_status: 'BLOCKED',
    universe_status: 'READY',
    outlier_cleaning_status: 'READY',
    corporate_action_status: 'INCOMPLETE',
    fundamental_status: 'READY',
    coverage: {
      covered_symbol_count: 808,
      total_symbol_count: 1224,
      coverage_pct: 66.01,
      price_bar_rows: 4661816,
      universe_member_rows: 30550,
      raw_universe_member_rows: 30550,
    },
    fundamental_coverage: {
      covered_symbol_count: 808,
      total_symbol_count: 1224,
      coverage_pct: 66.01,
      fundamental_point_rows: 9696,
      coverage_rows: 808,
      available_fields: ['capex', 'enterprise_value', 'ltm_earnings', 'market_cap', 'operating_cash_flow', 'total_shares'],
      missing_fields: [],
      source_snapshot_status: 'READY',
    },
    blocking_items: [
      {
        code: 'PRICE_SNAPSHOT_NOT_READY',
        message: '复权价格快照未就绪，因子诊断不能执行。',
        target: 'ds-price',
        fix_hash: '#/snapshots?tab=equity&target=ds-price',
      },
    ],
    status_reasons: {
      adjusted_price: {
        status: 'BLOCKED',
        cause: 'IDENTITY_MAPPING_GAP',
        description: '缺失 416 个 symbol，其中身份映射解析挂起 416 项。',
      },
      universe: {
        status: 'READY',
        cause: 'PASSED',
        description: '历史样本池有 61 个原始锚点，年度展示 6 个锚点，最近锚点约 502 个成员。',
      },
      outlier_cleaning: {
        status: 'BLOCKED',
        cause: 'CLEANING_RULE_PENDING',
        description: '清洗版本尚未正式确认；MAD 预览会剔除 1.2% 样本，需判断是价格突变还是规则过严。',
      },
      factor_admission: {
        status: limitedReady ? 'LIMITED_READY' : 'SANDBOX_READY',
        cause: limitedReady ? 'LIMITED_READY_ONLY' : 'SANDBOX_ONLY',
        description: limitedReady
          ? 'Limited Ready 仅允许研究诊断；晋升仍要求 Full Ready。'
          : '完整 PIT 待补，当前只允许最近窗口 Sandbox 预览。',
      },
    },
    ops_guidance: {
      headline: '当前核心成员价格缺口为 0，实盘准入风险低；身份映射解析挂起 416 项，建议运维重启 Identity Scraper 任务。',
      severity: 'WARNING',
      live_ready_risk: 'LOW',
      identity_pending_count: 416,
      current_core_missing_count: 0,
      historical_lifecycle_missing_count: 199,
      actions: [
        { label: '重启 Identity Scraper', target: 'ops://identity-scraper/restart', priority: 'HIGH' },
        { label: '刷新价格快照', target: '#/snapshots?tab=equity&target=ds-price', priority: 'MEDIUM' },
      ],
    },
    sample_securities: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'AVGO', 'COST'],
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
    coverage_gap: {
      missing_symbol_count: 416,
      missing_share_pct: 33.99,
      covered_symbol_count: 808,
      total_symbol_count: 1224,
      default_ignored_symbols: ['ATVI', 'SIVB', 'TWTR', 'XLNX', 'YHOO'],
      default_ignored_count: 5,
      evidence_source: 'dataset_snapshots.metadata.missing_symbols + universe_membership_snapshots',
      recommendation: '优先修复当前核心成员与历史生命周期缺口；非核心缺口只允许研究态豁免。',
      identity_resolved_count: 301,
      buckets: [
        {
          id: 'historical_core_missing',
          label: '历史核心成员缺价格',
          count: 199,
          share_pct: 47.84,
          mcap_weight_pct: 0.5,
          symbols: ['AAL', 'ABNB', 'ALGN', 'CZR', 'ETSY', 'HWM'],
          sample_symbols: ['AAL', 'ABNB', 'ALGN', 'CZR', 'ETSY', 'HWM'],
          temporal_distribution: [
            { date: '2008-01-01', missing_count: 86, member_count: 500, share_pct: 17.2 },
            { date: '2016-01-01', missing_count: 42, member_count: 505, share_pct: 8.32 },
            { date: '2024-01-01', missing_count: 8, member_count: 505, share_pct: 1.58, is_recent_window: true },
          ],
          symbol_details: [
            {
              symbol: 'AAL',
              identity_status: 'RESOLVED',
              canonical_symbol: 'AAL',
              mcap_weight_pct: 0.08,
              ticker_path: [{ date: '2015-01-01', symbol: 'AAL', source: 'historical_universe_first_seen', label: '历史样本池首次出现' }],
            },
          ],
          evidence: '这些 symbol 出现在历史 S&P 500 锚点中，但价格覆盖未达快照门禁。',
          recommendation: '优先补齐历史价格或 ticker 生命周期映射，不建议默认豁免。',
          action_label: '补齐价格快照',
          action_target: '#/snapshots?tab=equity&target=ds-price',
        },
        {
          id: 'identity_unresolved',
          label: '身份未解析',
          count: 115,
          share_pct: 27.64,
          mcap_weight_pct: 8.7,
          symbols: ['ABGX', 'ABK', 'BF.B', 'BRK.B', 'GEV', 'KVUE'],
          sample_symbols: ['ABGX', 'ABK', 'BF.B', 'BRK.B', 'GEV', 'KVUE'],
          temporal_distribution: [
            { date: '2008-01-01', missing_count: 62, member_count: 500, share_pct: 12.4 },
            { date: '2020-01-01', missing_count: 18, member_count: 504, share_pct: 3.57 },
            { date: '2025-01-01', missing_count: 7, member_count: 503, share_pct: 1.39, is_recent_window: true },
          ],
          symbol_details: ['ABGX', 'ABK', 'BF.B', 'BRK.B'].map((symbol) => ({
            symbol,
            identity_status: 'UNRESOLVED',
            canonical_symbol: symbol,
            mcap_weight_pct: symbol === 'ABK' ? 1.42 : 0.18,
            ticker_path: [
              { date: '2004-01-01', symbol, source: 'historical_universe_first_seen', label: '历史样本池首次出现' },
              { date: '2008-07-01', symbol, source: 'historical_universe_last_seen', label: '历史样本池最后出现' },
            ],
            mapping_action: {
              label: '建立 Mapping Overwrite',
              endpoint: '/pit-data/identity-overrides',
              method: 'POST',
            },
          })),
          evidence: '本地身份缓存没有对应记录，可能需要 ticker 生命周期或 delisting 映射。',
          recommendation: '补齐 symbol identity 后再判断是否属于核心历史样本。',
          action_label: '查看缺口清单',
          action_target: '#/pit-data?section=coverage-gap',
        },
        {
          id: 'non_core_missing',
          label: '当前非成员/非核心',
          count: 102,
          share_pct: 24.52,
          mcap_weight_pct: 0.35,
          symbols: ['ATVI', 'SIVB', 'TWTR', 'XLNX', 'YHOO'],
          sample_symbols: ['ATVI', 'SIVB', 'TWTR', 'XLNX', 'YHOO'],
          temporal_distribution: [
            { date: '2020-01-01', missing_count: 22, member_count: 504, share_pct: 4.37 },
            { date: '2023-01-01', missing_count: 11, member_count: 505, share_pct: 2.18, is_recent_window: true },
          ],
          symbol_details: [],
          evidence: '不在最新点时样本池中，默认只允许研究阶段临时忽略。',
          recommendation: '可以创建 Limited Ready 豁免继续研究，但晋升必须回到 Full Ready。',
          action_label: '创建研究态豁免',
          action_target: '#/pit-data?section=coverage-gap',
        },
      ],
    },
    full_ready_repair_plan: {
      status: 'NEEDS_REPAIR',
      target_status: 'FULL_READY',
      remaining_symbol_count: 416,
      queue_total_count: 416,
      queue_sample: [
        {
          symbol: 'AAL',
          bucket: 'historical_lifecycle_missing',
          priority: 30,
          status: 'NEEDS_FREE_SOURCE_REPAIR',
          repair_targets: ['price', 'corporate_actions'],
          alias_candidates: ['AAL'],
          price_providers: ['yahoo', 'stooq', 'alpha_vantage', 'tiingo', 'fmp', 'openbb_yfinance'],
          corporate_action_providers: ['yahoo', 'tiingo', 'alpha_vantage', 'fmp', 'sec_edgar'],
          membership_providers: ['fmp_historical_constituent', 'github_sp500_historical_components'],
          provider_priority: ['tiingo', 'fmp', 'stooq', 'kaggle_huge_stock_market_dataset', 'fmp_historical_constituent', 'sec_edgar', 'polygon'],
          next_provider: 'tiingo',
          required_evidence: ['可审计 EOD OHLCV 入库记录', '公司行动事件，或明确 zero-event certificate'],
          trust_blocker: '公司行动门禁未闭合，price-only 来源不能证明无分红/拆股事件。',
          evidence: 'Full Ready 需要可审计价格行和公司行为证明，研究态豁免不计入正式门禁。',
        },
        {
          symbol: 'ABGX',
          bucket: 'identity_unresolved',
          priority: 50,
          status: 'NEEDS_IDENTITY_ALIAS',
          repair_targets: ['price', 'identity'],
          alias_candidates: ['ABGX'],
          price_providers: ['yahoo', 'stooq', 'alpha_vantage', 'tiingo', 'fmp', 'openbb_yfinance'],
          corporate_action_providers: [],
          identity_providers: ['tiingo_symbology', 'fmp', 'sec_edgar', 'alpha_vantage'],
          provider_priority: ['tiingo', 'fmp', 'stooq', 'kaggle_huge_stock_market_dataset', 'tiingo_symbology', 'sec_edgar', 'polygon'],
          next_provider: 'tiingo',
          required_evidence: ['可审计 EOD OHLCV 入库记录', '稳定身份映射：canonical ticker / CIK / 有效期'],
          trust_blocker: '身份/生命周期未闭合，SEC/CIK 或 FMP/Tiingo alias 证据缺失。',
          evidence: '先补 ticker 生命周期，再重跑免费源价格修复。',
        },
        {
          symbol: 'ATVI',
          bucket: 'non_core_missing',
          priority: 70,
          status: 'NEEDS_FREE_SOURCE_REPAIR',
          repair_targets: ['price'],
          alias_candidates: ['ATVI'],
          price_providers: ['yahoo', 'stooq', 'alpha_vantage', 'tiingo', 'fmp', 'openbb_yfinance'],
          corporate_action_providers: [],
          provider_priority: ['tiingo', 'fmp', 'stooq', 'kaggle_huge_stock_market_dataset', 'polygon'],
          next_provider: 'tiingo',
          required_evidence: ['可审计 EOD OHLCV 入库记录'],
          trust_blocker: '价格缺口未闭合；Stooq/Kaggle 只能补价格，不能单独升级 Full Ready。',
          evidence: '非核心缺口也必须补齐或证明不可恢复，不能靠 waiver 进入 Full Ready。',
        },
      ],
      bucket_counts: {
        historical_lifecycle_missing: 199,
        identity_unresolved: 115,
        non_core_missing: 102,
      },
      provider_cooldowns: [
        {
          provider: 'alpha_vantage',
          target: 'price',
          next_retry_at: '2026-05-05T00:00:00Z',
          quota_limited: true,
          reason: 'free-tier quota or pacing limit exceeded',
        },
      ],
      provider_cooldown_count: 1,
      next_retry_at: '2026-05-05T00:00:00Z',
      zero_event_certificates: [
        {
          symbol: 'AAL',
          cik: '0000006201',
          member_exit_date: '2013-12-09',
          membership_exit_date: '2013-12-09',
          price_action_negative_result: {
            provider_priority: ['tiingo', 'fmp', 'alpha_vantage', 'sec_edgar'],
            status: 'needs_negative_confirmation',
          },
          conclusion: 'ZERO_EVENT_CANDIDATE',
          unrecoverable_reason: '仅当 Tiingo/FMP/Alpha Vantage/SEC 证据都无法返回正式事件，且身份生命周期已确权时，才可晋升为 zero-event certificate。',
        },
      ],
      zero_event_certificate_count: 1,
      waiver_blocks_full_ready: limitedReady,
      free_source_policy: 'Yahoo/Stooq/Alpha Vantage/Tiingo/FMP/OpenBB/SEC EDGAR 可修复证据，但不能合成或豁免 Full Ready。',
      recommendation: '继续按优先级运行免费源修复队列；若队列最终落入不可恢复缺口，应输出 rejection report，而不是把 PIT 伪装为 READY。',
      rejection_criteria: [
        '免费源对 symbol 全部返回 404/empty 且没有历史身份或公司行为证据时，必须保留阻塞。',
        '只有明确的 zero-event certificate 才能把公司行为缺失计为已覆盖，抓取失败不能当作无事件。',
        '研究态 waiver、synthetic_seed 或当前成分股兜底不能让 Full Ready 变绿。',
      ],
    },
    data_trust_summary: {
      generated_at: '2026-05-05T09:00:00Z',
      status: 'needs_configuration',
      layers: [
        {
          id: 'price_primary_chain',
          label: '价格主链',
          role: '可审计 EOD OHLCV',
          status: 'missing_credentials',
          provider_ids: ['tiingo', 'yahoo', 'fmp'],
          preferred_provider: 'tiingo',
          evidence_scope: ['EOD OHLCV', 'adjusted close'],
          missing_env_vars: ['TIINGO_API_TOKEN'],
          provider_count: 3,
          usable_provider_count: 1,
          full_ready_gate: '价格缺口必须由可审计 provider 入库，price-only 源不能替代公司行动或身份门禁。',
          limitations: ['Price-only 来源不能单独升级 Full Ready。'],
        },
        {
          id: 'membership_history',
          label: '成分股历史',
          role: 'PIT 成员 in/out 日期',
          status: 'missing_credentials',
          provider_ids: ['fmp_historical_constituent', 'github_sp500_historical_components'],
          preferred_provider: 'fmp_historical_constituent',
          evidence_scope: ['historical constituents', 'in/out dates'],
          missing_env_vars: ['FMP_API_KEY'],
          provider_count: 2,
          usable_provider_count: 0,
          full_ready_gate: 'membership-only 源只能通过样本池历史门禁，不能单独升级 Full Ready。',
        },
        {
          id: 'delisted_identity',
          label: '退市 / 身份',
          role: 'ticker 生命周期和 CIK',
          status: 'missing_credentials',
          provider_ids: ['sec_edgar', 'tiingo_symbology', 'fmp'],
          preferred_provider: 'sec_edgar',
          evidence_scope: ['CIK', 'delisting metadata'],
          missing_env_vars: ['SEC_USER_AGENT'],
          provider_count: 3,
          usable_provider_count: 0,
          full_ready_gate: 'identity-only 源不能补 OHLCV；用于证明标的身份和不可恢复缺口上下文。',
        },
        {
          id: 'long_history_patch',
          label: '长周期补丁',
          role: '70/80/90 年代价格补丁',
          status: 'registered',
          provider_ids: ['stooq', 'kaggle_huge_stock_market_dataset'],
          preferred_provider: 'stooq',
          evidence_scope: ['long-horizon OHLCV'],
          missing_env_vars: [],
          provider_count: 2,
          usable_provider_count: 0,
          full_ready_gate: 'price-only，只能修复价格缺口，不能单独通过公司行动或身份门禁。',
          limitations: ['Price-only 来源不能单独升级 Full Ready。'],
        },
        {
          id: 'precision_repair',
          label: '精修来源',
          role: '关键缺口付费精修',
          status: 'missing_credentials',
          provider_ids: ['polygon'],
          preferred_provider: 'polygon',
          evidence_scope: ['precision price repair', 'corporate actions'],
          missing_env_vars: ['POLYGON_API_KEY'],
          provider_count: 1,
          usable_provider_count: 0,
          full_ready_gate: '用于免费链无法闭合的关键缺口，仍不暴露密钥值。',
        },
      ],
      full_ready_rules: [
        'FULL_READY 必须同时具备可审计价格、PIT 成员历史、公司行动或 zero-event certificate、稳定身份映射。',
      ],
    },
    external_source_readiness: {
      generated_at: '2026-05-05T09:00:00Z',
      cache_dir: 'C:\\tmp\\grit-pit-bulk-cache',
      security_policy: {
        credential_status_only: true,
        secret_persistence: 'disabled',
      },
      kaggle_auth_status: {
        credential_status: 'missing',
        configured: false,
        accepted_methods: ['KAGGLE_API_TOKEN', '~/.kaggle/access_token', 'legacy ~/.kaggle/kaggle.json'],
        secret_persistence: 'disabled',
      },
      kaggle_cache_manifest: {
        cache_dir: 'C:\\tmp\\grit-pit-bulk-cache',
        status: 'MISSING',
        manifest_count: 0,
        datasets: [],
        recommendations: [
          {
            dataset_id: 'borismarjanovic/price-volume-data-for-all-us-stocks-etfs',
            label: 'Huge Stock Market Dataset',
            pit_mode: 'price_only',
          },
        ],
        search_terms: ['survivorship bias free', 'delisted', 'US stock market historical data delisted', 'EOD historical data stocks'],
      },
      matrix_coverage_status: {
        status: 'MISSING',
        source_count: 0,
        latest_source_url: null,
        latest_revision_id: null,
        effective_start: null,
        effective_end: null,
        member_event_count: 0,
        recommendations: [
          {
            provider_id: 'github_sp500_historical_components',
            label: 'fja05680/sp500',
          },
        ],
        requirement: 'Matrix decides historical membership only; it does not replace price evidence.',
      },
      parquet_catalog_status: {
        status: 'MISSING',
        duckdb_catalog: 'C:\\tmp\\grit-pit-bulk-cache\\catalog\\gsl_pit_bulk.duckdb',
        catalog_exists: false,
        normalized_dir: 'C:\\tmp\\grit-pit-bulk-cache\\normalized',
        parquet_file_count: 0,
        manifest_catalog_count: 0,
        partitioning: 'symbol_prefix + year',
      },
      polygon_status: {
        credential_status: 'missing',
        configured: false,
        required_env_vars: ['POLYGON_API_KEY'],
        secret_persistence: 'disabled',
      },
      critical_polygon_candidates: [
        {
          symbol: 'AAL',
          bucket: 'historical_lifecycle_missing',
          repair_targets: ['price', 'corporate_actions'],
          priority: 30,
          reason: 'historical core missing with corporate action blocker',
        },
      ],
      remaining_blockers_by_source: {
        matrix: { status: 'MISSING', blocked_targets: ['historical_membership'] },
        kaggle_bulk: { status: 'MISSING', blocked_targets: ['price'] },
        polygon_precision: { status: 'MISSING_CREDENTIAL', blocked_targets: ['corporate_actions'] },
      },
      source_recommendations: {
        search_terms: ['survivorship bias free', 'delisted', 'US stock market historical data delisted', 'EOD historical data stocks'],
      },
    },
    cleaning_rule_previews: [
      {
        id: 'mad',
        method: 'MAD',
        label: 'MAD 中位数偏差',
        description: '适合厚尾收益分布，优先降低极端点对阈值的影响。',
        status: 'READY',
        excluded_count: 154,
        excluded_pct: 1.2,
        sample_size: 12840,
        threshold_label: 'MAD 3.0x，阈值 -0.0820 至 0.0875',
        sample_points: [
          { symbol: 'NVDA', date: '2025-04-10', value: 0.1092 },
          { symbol: 'META', date: '2024-02-02', value: -0.0918 },
        ],
      },
      {
        id: 'sigma',
        method: 'SIGMA',
        label: '3σ 标准差',
        description: '适合近似正态的价格收益序列，剔除比例通常更保守。',
        status: 'READY',
        excluded_count: 64,
        excluded_pct: 0.5,
        sample_size: 12840,
        threshold_label: '3σ，阈值 -0.1164 至 0.1211',
        sample_points: [
          { symbol: 'NVDA', date: '2025-04-10', value: 0.1092 },
        ],
      },
      {
        id: 'industry',
        method: 'INDUSTRY',
        label: '分行业阈值',
        description: '需要行业映射和行业内横截面样本，本期仅展示不可预览状态。',
        status: 'UNAVAILABLE',
        excluded_count: 0,
        excluded_pct: 0,
        sample_size: 12840,
        threshold_label: '行业映射待接入',
        sample_points: [],
      },
    ],
    universe_history_series: [
      { date: '1996-01-01', member_count: 487 },
      { date: '2000-01-01', member_count: 500 },
      { date: '2008-01-01', member_count: 500 },
      { date: '2016-01-01', member_count: 505 },
      { date: '2020-01-01', member_count: 504 },
      { date: '2026-01-01', member_count: 502, is_latest: true },
    ],
    adjustment_trace: {
      symbol: 'AAPL',
      factor_min: 0.242188,
      factor_max: 0.251946,
      events: [{ date: '2025-08-11', type: 'DIVIDEND', label: '现金股息' }],
      points: [
        { date: '2025-01-02', close: 242.34, adjusted_close: 58.68, adjustment_factor: 0.242139 },
        { date: '2025-03-03', close: 238.01, adjusted_close: 57.85, adjustment_factor: 0.243056 },
        { date: '2025-05-01', close: 215.24, adjusted_close: 52.92, adjustment_factor: 0.245866 },
        { date: '2025-08-11', close: 227.18, adjusted_close: 56.91, adjustment_factor: 0.250507 },
        { date: '2025-10-01', close: 254.63, adjusted_close: 64.13, adjustment_factor: 0.251849 },
        { date: '2026-01-02', close: 265.9, adjusted_close: 66.98, adjustment_factor: 0.2519 },
      ],
    },
    research_waiver: demoPitWaiver,
    factor_diagnostics_enabled: limitedReady,
    verified_diagnostics_enabled: false,
    limited_diagnostics_enabled: limitedReady,
    sandbox_diagnostics_enabled: true,
    pit_layer_readiness: [
      {
        layer_id: 'l1_market_data',
        title_cn: 'L1 基础行情',
        status: 'BLOCKED',
        summary: '价格快照存在身份映射缺口，PIT 回放尚未放行。',
        pit_alignment: '价格型与宏观型因子需先修复 replay gate。',
        blockers: ['价格快照未完成身份修复'],
        available_at_health: null,
      },
      {
        layer_id: 'l2_fundamental_data',
        title_cn: 'L2 财务截面',
        status: 'WARNING',
        summary: '财务字段可用，但发布日与 available_at 仍需持续校验。',
        pit_alignment: '质量与估值因子可进入观察或有限验证。',
        blockers: ['需补齐 publish_date / available_at 审核'],
        available_at_health: {
          status: 'healthy',
          sampled_row_count: 64,
          missing_available_at_count: 0,
        },
      },
      {
        layer_id: 'l3_sentiment_data',
        title_cn: 'L3 分析师与情绪',
        status: 'DISABLED',
        summary: '情绪链路尚未形成 PIT 回放能力。',
        pit_alignment: '仅保留逻辑映射，不开放正式诊断。',
        blockers: ['一致预期与卖空时序未入库'],
        available_at_health: null,
      },
      {
        layer_id: 'l4_macro_derivatives',
        title_cn: 'L4 宏观与衍生品',
        status: 'CALIBRATING',
        summary: '宏观回归已预留，但 Beta 与 IV Skew 仍在校准。',
        pit_alignment: '宏观与衍生品因子先进入沙箱观察。',
        blockers: [],
        available_at_health: null,
      },
    ],
    factor_diagnostic_readiness: [
      {
        group_id: 'price',
        title_cn: '价格型',
        status: 'BLOCKED',
        factors: ['12-1 动量', '6m 动量', '252d 波动率', '规模'],
        rationale_cn: '价格 replay gate 尚未通过，价格型因子暂不放行。',
        linked_snapshot_checks: ['price_replay_gate', 'universe_history_gate'],
      },
      {
        group_id: 'quality_valuation',
        title_cn: '质量/估值型',
        status: limitedReady ? 'SANDBOX' : 'BLOCKED',
        factors: ['Accruals', 'F-Score', 'ROE', 'FCFY'],
        rationale_cn: limitedReady
          ? '研究豁免生效后可进入观察，但不得洗白为正式验证。'
          : '财务链路仍需等待 PIT 门禁完全通过。',
        linked_snapshot_checks: ['fundamental_publish_gate', 'fundamental_balance_check'],
      },
      {
        group_id: 'sentiment_micro',
        title_cn: '情绪/微观型',
        status: 'DISABLED',
        factors: ['分析师修正', '空头回补', '超额换手'],
        rationale_cn: '本期未纳入正式 PIT 数据链路，维持停用。',
        linked_snapshot_checks: ['consensus_sample_gate', 'short_volume_gate'],
      },
      {
        group_id: 'macro_derivatives',
        title_cn: '宏观/衍生品型',
        status: 'SANDBOX',
        factors: ['利率敏感度', '通胀 Beta', 'IV Skew'],
        rationale_cn: '价格回放未全绿前仅允许沙箱观察，宏观回归同时处于校准中。',
        linked_snapshot_checks: ['rate_beta_calibration', 'iv_skew_feed'],
      },
    ],
    pit_quality_alerts: [
      {
        code: 'NON_REPLAYABLE_FIELD',
        severity: 'HIGH',
        title_cn: '价格 replay gate 未通过',
        detail_cn: '价格快照仍有身份映射缺口，价格型因子无法进入正式诊断。',
        hard_blocking: true,
        linked_factor_groups: ['price', 'macro_derivatives'],
      },
      ...(limitedReady
        ? [
            {
              code: 'RESEARCH_WAIVER_OBSERVATION',
              severity: 'MEDIUM',
              title_cn: '研究豁免仅允许观察',
              detail_cn: '研究豁免可保留观察窗口，但不得自动晋升为已验证。',
              hard_blocking: false,
              linked_factor_groups: ['quality_valuation', 'macro_derivatives'],
            },
          ]
        : []),
      {
        code: 'RATE_BETA_CALIBRATING',
        severity: 'LOW',
        title_cn: '利率 Beta 校准中',
        detail_cn: '宏观回归链路可运行，但滚动参数仍需继续校准。',
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
        result_status: 'BLOCKED',
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
        result_status: 'WARNING',
      },
      {
        check_id: 'fundamental_balance_check',
        check_title_cn: '财报恒等式检查',
        source_layer: 'L2 财务截面',
        target_factor_groups: ['质量/估值型'],
        result_status: 'WARNING',
      },
      {
        check_id: 'consensus_sample_gate',
        check_title_cn: '一致预期样本门槛',
        source_layer: 'L3 分析师与情绪',
        target_factor_groups: ['情绪/微观型'],
        result_status: 'DISABLED',
      },
      {
        check_id: 'rate_beta_calibration',
        check_title_cn: '利率 Beta 校准',
        source_layer: 'L4 宏观与衍生品',
        target_factor_groups: ['宏观/衍生品型'],
        result_status: 'CALIBRATING',
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
        enabled: false,
        start_date: '2016-04-01',
        end_date: '2026-04-01',
        label: 'Verified 10 年 PIT 门禁',
        missing_windows: [
          {
            kind: 'price_status',
            label: '价格快照状态 INCOMPLETE',
            start_date: '2016-04-01',
            end_date: '2026-04-01',
          },
        ],
      },
    },
    gate_fix_target: '#/snapshots?tab=equity&target=ds-price',
    source: { derived_from_snapshot: true },
  };
}

function isFactorOffline(factor: ApiFactorListItem): boolean {
  const lifecycle = String(factor.lifecycle_status ?? '').toUpperCase();
  return lifecycle === 'DEPRECATED' || lifecycle === 'PRUNED' || Boolean(factor.offline_at);
}

function buildDemoFactors(): ApiFactorListItem[] {
  const seedFactors: Array<Omit<ApiFactorListItem, 'ic_sparkline' | 'ic_sparkline_window' | 'readiness_blockers' | 'gate_fix_target'>> = [
    {
      id: 's_mom_12m1m_rank',
      name: '12-1月截面动量排名',
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
      institutional_note: '趋势延续因子在单边市中较强，但市场拐点可能出现动量崩溃。',
      latest_diagnostic_summary: demoFactorSummaries.s_mom_12m1m_rank,
      last_diagnostic_run_id: 'fdiag-demo-momentum',
    },
    {
      id: 's_vol_252d_rank',
      name: '252日年化波动率排名',
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
      latest_diagnostic_summary: demoFactorSummaries.s_vol_252d_rank,
      last_diagnostic_run_id: 'fdiag-demo-lowvol',
    },
    {
      id: 's_val_ep_ltm_raw',
      name: '滚动市盈率倒数 (LTM)',
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
      latest_diagnostic_summary: demoFactorSummaries.s_mom_12m1m_rank,
    },
    {
      id: 's_val_bp_latest_raw',
      name: '最新账面市值比',
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
      latest_diagnostic_summary: demoFactorSummaries.s_mom_12m1m_rank,
    },
    {
      id: 's_qlty_fcfy_ttm_raw',
      name: '自由现金流收益率 (TTM)',
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
      latest_diagnostic_summary: demoFactorSummaries.s_mom_12m1m_rank,
    },
    {
      id: 's_qlty_roe_ltm_raw',
      name: 'LTM 净资产收益率',
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
      latest_diagnostic_summary: demoFactorSummaries.s_mom_12m1m_rank,
    },
    {
      id: 's_size_cur_log',
      name: '即时对数总市值',
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
      latest_diagnostic_summary: demoFactorSummaries.s_vol_252d_rank,
    },
  ];
  return seedFactors.map((factor, index) => {
    const sparkline = factor.latest_diagnostic_summary?.ic_series?.length
      ? factor.latest_diagnostic_summary.ic_series.map((point) => ({
          date: point.date,
          value: Number(point.rank_ic ?? point.ic ?? 0),
        }))
      : Array.from({ length: 12 }, (_, cursor) => ({
          date: `T-${12 - cursor}`,
          value: Number((0.01 + Math.sin((cursor + index) / 2) * 0.025).toFixed(4)),
        }));
    const blocked = factor.diagnostic_status === 'BLOCKED_DATA';
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
    return {
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
    };
  });
}

function buildFactorGovernanceOverview(items = buildDemoFactors()): ApiFactorGovernanceOverview {
  const reviewFactor = items.find((item) => item.strategy_creation_risk?.warning_count);
  const autoFactor = items.find((item) => item.source === 'AUTO_MINED') ?? reviewFactor ?? items[0];
  const factorIds = [
    autoFactor?.id ?? 's_mom_12m1m_rank',
    's_val_ep_ltm_raw',
    's_vol_252d_rank',
  ].filter((item, index, array) => item && array.indexOf(item) === index);
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
        offline_reason: '冗余裁剪：同簇高相关且弱于滚动市盈率倒数 (LTM)',
        offline_detail: {
          keep_factor_id: 's_val_ep_ltm_raw',
          correlation: 0.93,
          comparison: {
            candidate: { factor_id: 's_val_bp_latest_raw', factor_name: '最新账面市值比' },
            mvp: { factor_id: 's_val_ep_ltm_raw', factor_name: '滚动市盈率倒数 (LTM)' },
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
        detail: '分组收益连续倒挂，已生成反向下行波动率代理并再次诊断为 Grade B，等待确认入库。',
        factor_ids: ['s_vol_downside_252d_rank'],
        affected_factor_ids: ['s_vol_downside_252d_rank'],
        severity: 'info',
        optimized_factor: {
          id: 'm_vol_downsiderev_252d_rank',
          name: '反向下行波动率代理（252日）',
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
        title: '多因子策略草稿建议',
        detail: '自动发布因子已放入低相关候选篮子，建议权重不超过 20%，进入创建页后仍需预检。',
        factor_ids: factorIds,
        suggested_weights: factorIds.map((factorId, index) => ({
          factor_id: factorId,
          weight_pct: index === 0 ? 20 : 15,
          direction: factorId.includes('vol') ? 'LOW_IS_GOOD' : 'HIGH_IS_GOOD',
        })),
        severity: 'info',
        target: {
          route: '#/factor-models/new',
          query: {
            source: 'governance_queue',
            factorIds: factorIds.join(','),
            weights: factorIds.map((_, index) => (index === 0 ? '20' : '15')).join(','),
            directions: factorIds.map((factorId) => (factorId.includes('vol') ? 'LOW_IS_GOOD' : 'HIGH_IS_GOOD')).join(','),
            modelName: '自动挖掘因子待审查组合',
          },
        },
      },
    ],
    summary: { deprecate_count: 1, prune_count: 1, review_count: 1, decayed_count: 1, crowded_count: 1, suggestion_count: 1, optimization_count: 1 },
  };
}

function buildFactorQuarantineCandidates(): ApiFactorQuarantineCandidateListResponse {
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

function buildFactorDetail(id: string): ApiFactorDetail {
  const aliases: Record<string, string> = {
    momentum_12m_1m: 's_mom_12m1m_rank',
    value_ep_ltm: 's_val_ep_ltm_raw',
    value_bp_latest: 's_val_bp_latest_raw',
    quality_roe_ltm: 's_qlty_roe_ltm_raw',
    lowvol_realized_252d: 's_vol_252d_rank',
    size_log_market_cap: 's_size_cur_log',
    quality_fcf_yield: 's_qlty_fcfy_ttm_raw',
  };
  const factor = buildDemoFactors().find((item) => item.id === (aliases[id] ?? id)) ?? buildDemoFactors()[0];
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
      nodes: buildDemoFactors()
        .filter((item) => item.id !== factor.id)
        .slice(0, 4)
        .map((item, index) => ({
          factor_id: item.id,
          name: item.name,
          source: item.source,
          correlation: [0.84, 0.72, 0.58, 0.41][index] ?? 0.38,
          risk_label: index < 2 ? '高相关' : '可观察',
        })),
    },
  };
}

function buildDemoMiningJob(
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
        expression: 'ZScore(Winsorize(Return(Close, 21)))',
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
        risk_flags: ['候选不会直接进入正式因子库'],
      },
      {
        id: 'cand-demo-rank-002',
        expression: 'Rank(Log(MarketCap)) * -1',
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

function buildDemoFactorFactoryOverview(
  profileStatus: 'ACTIVE' | 'PAUSED' = 'PAUSED',
  trigger: 'DAILY' | 'MANUAL' = 'DAILY',
  runStatus: ApiFactorFactoryRun['status'] = 'COMPLETED',
): ApiFactorFactoryOverview {
  const request: ApiFactorMiningJobCreatePayload = {
    universe: 'SP500',
    start_date: '2020-01-01',
    end_date: '2025-12-31',
    operators: ['Return', 'Std', 'Rank', 'ZScore', 'Winsorize'],
    candidate_count: 1000,
    random_seed: 42,
    min_rank_ic: 0.03,
    max_depth: 4,
  };
  const gatePolicy = {
    pit_gate_mode: 'DIAGNOSTIC_ONLY' as const,
    max_style_correlation: 0.3,
    residual_enabled: true,
    max_drawdown_relative_to_benchmark: 1.5,
    min_oos_to_is_ratio: 0.5,
  };
  const miningJob = buildDemoMiningJob(request, runStatus === 'CANCELLED' ? 'CANCELLED' : 'COMPLETED');
  const quarantine = buildFactorQuarantineCandidates();
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
      passed: quarantine.items.filter((item) => item.status === 'PASSED').length,
      review_or_observation: quarantine.items.filter((item) => item.status === 'NEEDS_REVIEW').length,
      rejected: quarantine.items.filter((item) => item.status === 'REJECTED').length,
      published: quarantine.items.filter((item) => item.status === 'PUBLISHED').length,
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

function buildDemoFactorModelPreview(payload: ApiFactorModelPreviewPayload): ApiFactorModelPreviewResponse {
  const totalWeight = payload.components.reduce((total, item) => total + Math.abs(Number(item.weight ?? 0)), 0) || 1;
  const neutralizationBlocked = payload.neutralization.enabled;
  return {
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
    warnings: neutralizationBlocked ? ['行业 PIT 覆盖缺失，第一步只返回 blocker，不展示已执行。'] : [],
  };
}

function buildDemoFactorModelStrategy(payload: ApiFactorModelCreatePayload): ApiStrategyDetail {
  const preview = buildDemoFactorModelPreview(payload);
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
    factor_ids: payload.components.map((component) => component.factor_id),
    weights: Object.fromEntries(payload.components.map((component) => [component.factor_id, component.weight])),
    directions: Object.fromEntries(payload.components.map((component) => [component.factor_id, component.direction])),
    neutralization: payload.neutralization,
    scoring_method: payload.scoring_method,
    rebalance_frequency: payload.rebalance_frequency,
    pit_snapshot_refs: preview.coverage,
  };
  const strategy = createStrategy({
    id,
    name: payload.name ?? '多因子核心模型',
    description: payload.description ?? '由因子库多因子构建器创建的可回测策略。',
    strategy_type: 'MULTI_FACTOR',
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

export function resetDemoStore(): void {
  state = createInitialState();
}

export function setPromoteConflict(jobId: string, candidateId: string): void {
  state.promoteConflicts.add(promoteConflictKey(jobId, candidateId));
}

export function getLosingCandidateIds(jobId: string): string[] {
  return findJob(jobId)
    .candidates.filter((candidate) =>
      typeof candidate.metrics.total_return === 'number' ? candidate.metrics.total_return < 0 : candidate.score < 0,
    )
    .map((candidate) => candidate.id);
}

export const demoApi: DemoApi = {
  async getWorkspaceOverview(includeCleanupAudit = false, _signal?: AbortSignal): Promise<ApiWorkspaceOverview> {
    state.optimizationJobs.forEach((job) => {
      syncOptimizationJob(job);
    });
    sortOptimizationJobs();

    const overview: ApiWorkspaceOverview = {
      workspace_name: 'Grit Strategy Lab',
      subtitle: 'Creation, backtest, and optimization workspace for local strategy recovery.',
      strategy_count: state.strategies.length,
      active_run_count: 1,
      running_optimization_count: state.optimizationJobs.filter((job) => ['QUEUED', 'RUNNING'].includes(job.status)).length,
      latest_strategy_id: state.strategies[0]?.id ?? null,
      latest_backtest_run_id: state.runs[0]?.id ?? null,
      latest_optimization_job_id: state.optimizationJobs[0]?.id ?? null,
      top_momentum_warning: 'Refresh snapshots before trusting any newly materialized momentum strategy.',
      quick_actions: ['open_creation', 'start_backtest', 'open_optimization'],
    };

    if (includeCleanupAudit) {
      overview.last_cleanup_count = 3;
    }
    return clone(overview);
  },
  async listStrategies(_signal?: AbortSignal): Promise<ApiStrategyListItem[]> {
    return clone(state.strategies);
  },
  async getStrategyDetail(id: string): Promise<ApiStrategyDetail> {
    return clone(findStrategy(id));
  },
  async restoreStrategyParameterVersion(strategyId, parameterVersionId, payload): Promise<ApiStrategyDetail> {
    const strategy = findStrategy(strategyId);
    const target = strategy.parameter_history.find((entry) => entry.parameter_version_id === parameterVersionId);
    if (!target || !target.parameters || parameterVersionId === strategy.current_parameter_version_id) {
      throw new ApiError({ status: 400, code: 'parameter_version_not_restorable', message: 'Parameter version is not restorable.' });
    }
    const expectedBase = payload.base_parameter_version_id ?? strategy.current_parameter_version_id;
    if (expectedBase && expectedBase !== strategy.current_parameter_version_id) {
      throw new ApiError({
        status: 409,
        code: 'stale_base_parameter_version',
        message: 'The strategy has moved to a newer parameter version.',
        blocking_code: 'stale_base_parameter_version',
        blocking_target: { type: 'strategy', id: strategy.id },
        next_action: 'refresh_strategy_detail',
      });
    }
    const previousVersion = strategy.current_parameter_version ?? 1;
    strategy.current_parameter_version = previousVersion + 1;
    strategy.current_parameter_version_id = `${strategy.id}-v${strategy.current_parameter_version}`;
    strategy.parameters = clone(target.parameters);
    strategy.parameter_history = [
      {
        version_number: strategy.current_parameter_version,
        parameter_version_id: strategy.current_parameter_version_id,
        revision: previousVersion,
        created_at: nowIso(),
        comment: payload.decision_note ?? `回滚至 v${target.version_number}`,
        decision_note: payload.decision_note ?? '',
        change_summary: `回滚至 v${target.version_number}`,
        source: {
          kind: 'version_restore',
          source_parameter_version_id: target.parameter_version_id,
          source_version_number: target.version_number,
          base_parameter_version_id: expectedBase,
        },
        alternative_versions: [
          {
            parameter_version_id: expectedBase,
            version_number: previousVersion,
            label: `回滚前当前版本 v${previousVersion}`,
          },
        ],
        rollbackable: false,
        parameters: clone(target.parameters),
      },
      ...strategy.parameter_history.map((entry) => ({
        ...entry,
        rollbackable: entry.parameter_version_id !== strategy.current_parameter_version_id,
      })),
    ];
    return clone(strategy);
  },
  async getCreationSession(id: string): Promise<ApiStrategyCreationSession> {
    const existing = state.sessions.find((session) => session.id === id);
    if (!existing) {
      throw new ApiError({ status: 404, code: 'session_not_found', message: `Session ${id} was not found.` });
    }
    return clone(existing);
  },
  async createCreationSession(payload): Promise<ApiStrategyCreationSession> {
    const session: ApiStrategyCreationSession = {
      id: nextId('cs'),
      status: 'DRAFTING',
      revision: 1,
      messages: [],
      mode: 'CREATE',
      base_strategy_id: null,
      base_parameter_version_id: null,
      ...payload,
    };
    state.sessions.unshift(session);
    return clone(session);
  },
  async appendCreationMessage(id: string, content: string, revision = 1): Promise<ApiStrategyCreationSession> {
    const session = await this.getCreationSession(id);
    const updated = {
      ...session,
      revision: Math.max(session.revision ?? 1, revision + 1),
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
    const updated = { ...session, revision: payload.revision + 1, status: 'READY_TO_MATERIALIZE' };
    state.sessions = state.sessions.map((item) => (item.id === id ? updated : item));
    return clone(updated);
  },
  async materializeStrategy(): Promise<ApiStrategyDetail> {
    return clone(state.strategies[0]);
  },
  async listBacktestRuns(params, _signal?: AbortSignal): Promise<ApiBacktestRunListItem[]> {
    const filtered = params?.status ? state.runs.filter((run) => run.status === params.status) : state.runs;
    const limit = params?.limit ?? filtered.length;
    return clone(filtered.slice(0, limit).map(toRunListItem));
  },
  async getBacktestRunDetail(
    id: string,
    _options?: BacktestRunDetailRequest | AbortSignal,
  ): Promise<ApiBacktestRunDetail> {
    return clone(findRun(id));
  },
  async saveBacktestRun(id: string): Promise<ApiBacktestRunDetail> {
    const run = findRun(id);
    run.is_permanent = true;
    return clone(run);
  },
  async deleteBacktestRun(id: string): Promise<ApiBacktestRunDeleteResult> {
    const run = findRun(id);
    if (run.status === 'QUEUED' || run.status === 'RUNNING') {
      throw new ApiError({ status: 409, code: 'backtest_run_delete_active', message: '进行中的回测暂不支持删除。' });
    }
    state.runs = state.runs.filter((item) => item.id !== id);
    return { id, deleted_at: nowIso(), deleted_reason: 'manual_delete' };
  },
  async getBacktestRunTrades(id: string, params): Promise<ApiBacktestRunTradePage> {
    const run = findRun(id);
    const page = Math.max(1, params?.page ?? 1);
    const pageSize = Math.max(1, params?.page_size ?? 50);
    const segment = (params?.segment ?? 'all').toUpperCase();
    const allRows = (run.trade_audit_items ?? [])
      .filter((item) => segment === 'ALL' || item.segment === segment)
      .map((item) => ({
        trade_time: item.opened_at,
        symbol: item.symbol,
        side: item.pnl_pct >= 0 ? 'BUY' : 'SELL',
        quantity: 1,
        price: item.pnl_pct,
        segment: item.segment,
      }));
    const start = (page - 1) * pageSize;
    return {
      items: clone(allRows.slice(start, start + pageSize)),
      page,
      page_size: pageSize,
      total: allRows.length,
      total_pages: Math.max(1, Math.ceil(allRows.length / pageSize)),
    };
  },
  async getBacktestTradeAudit(runId: string, tradeId: string): Promise<ApiBacktestRunTradeAudit> {
    const tradeAudit = state.tradeAudits[runId]?.[tradeId];
    if (!tradeAudit) {
      throw new ApiError({ status: 404, code: 'trade_audit_not_found', message: `Trade audit ${tradeId} was not found.` });
    }
    return clone(tradeAudit);
  },
  async previewBacktestRun(): Promise<ApiBacktestSubmissionPreview> {
    return {
      warnings: [],
      effective_start_date: '2025-01-02',
      effective_end_date: '2025-02-28',
      data_segment_type: 'FULL',
    };
  },
  async submitBacktestRun(): Promise<ApiBacktestRunDetail> {
    return clone(state.runs[0]);
  },
  async cloneBacktestRun(id: string): Promise<ApiBacktestRunDetail> {
    const source = findRun(id);
    const cloneRun: ApiBacktestRunDetail = {
      ...clone(source),
      id: nextId('bt'),
      status: 'COMPLETED',
      is_permanent: false,
      source_run_id: source.id,
    };
    state.runs.unshift(cloneRun);
    return clone(cloneRun);
  },
  async resumeBacktestRun(id: string, _idempotencyKey: string): Promise<ApiBacktestRunDetail> {
    const run = findRun(id);
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
  async listOptimizationJobs(): Promise<ApiOptimizationJobListItem[]> {
    state.optimizationJobs.forEach((job) => {
      if (isOptimizationInFlight(job.status)) {
        advanceOptimizationJob(job);
        return;
      }
      syncOptimizationJob(job);
    });
    sortOptimizationJobs();
    return clone(
      state.optimizationJobs.map((job) => buildOptimizationJobListItem(findStrategy(job.strategy_id), job)),
    );
  },
  async getOptimizationJobDetail(
    id: string,
    _params?: { matchingLimit?: number },
  ): Promise<ApiOptimizationJobDetail> {
    const job = findJob(id);
    return clone(isOptimizationInFlight(job.status) ? advanceOptimizationJob(job) : job);
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
      getOptimizationSourceRun(job),
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
      getOptimizationSourceRun(job),
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
    const normalized = syncOptimizationJob(saved);
    sortOptimizationJobs();
    return clone(normalized);
  },
  async deleteOptimizationJob(id: string) {
    const job = findJob(id);
    const deletedAt = nowIso();
    state.optimizationJobs = state.optimizationJobs.filter((item) => item.id !== id);
    sortOptimizationJobs();
    const strategy = findStrategy(job.strategy_id);
    strategy.latest_optimization_job_id =
      state.optimizationJobs.find((item) => item.strategy_id === strategy.id)?.id ?? null;
    return {
      id,
      deleted_at: deletedAt,
      deleted_reason: 'user_deleted',
    };
  },
  async createOptimizationJob(strategyId: string, payload?: ApiOptimizationJobCreatePayload): Promise<ApiOptimizationJobDetail> {
    const strategy = findStrategy(strategyId);
    const job: ApiOptimizationJobDetail = {
      id: nextId('opt'),
      strategy_id: strategyId,
      status: 'QUEUED',
      request: {
        objective: payload?.objective ?? 'sharpe',
        base_parameter_version_id: payload?.base_parameter_version_id ?? strategy.current_parameter_version_id ?? null,
        source_run_id: payload?.source_run_id ?? null,
        entry_point: payload?.entry_point ?? (payload?.source_run_id ? 'run_detail' : 'lab_menu'),
        validation_mode: payload?.validation_mode ?? 'walk_forward',
        budget_combinations: payload?.budget_combinations ?? 42,
        search_space: clone(payload?.search_space ?? []),
      },
      summary: {
        objective: payload?.objective ?? 'sharpe',
        candidate_count: 0,
        baseline_parameter_version_id: payload?.base_parameter_version_id ?? strategy.current_parameter_version_id ?? null,
        budget_combinations: payload?.budget_combinations ?? 42,
        completed_combinations: 0,
        progress_pct: 0,
        current_stage: '任务已创建',
        latest_update: '优化任务已创建，正在准备搜索队列。',
        estimated_remaining_minutes: null,
        estimated_completed_at: null,
        mock_progress_stage: 0,
      },
      result: {
        best_candidate_id: null,
        baseline_parameter_version_id: payload?.base_parameter_version_id ?? strategy.current_parameter_version_id ?? null,
        headline: '优化进行中',
        summary: '优化任务已创建，正在准备搜索队列。',
        status: 'QUEUED',
        progress_pct: 0,
        current_stage: '任务已创建',
        latest_update: '优化任务已创建，正在准备搜索队列。',
      },
      candidates: [],
      base_parameter_version_id: payload?.base_parameter_version_id ?? strategy.current_parameter_version_id ?? null,
      created_at: nowIso(),
      updated_at: nowIso(),
      completed_at: null,
    };
    state.optimizationJobs.unshift(job);
    strategy.latest_optimization_job_id = job.id;
    return clone(recalculateJob(job));
  },
  async resumeOptimizationJob(jobId: string): Promise<ApiOptimizationJobDetail> {
    const job = findJob(jobId);
    const resumed = resumeOptimizationJob(job);
    return clone(resumed);
  },
  async createOptimizationCandidate(jobId: string, payload: CreateCandidatePayload): Promise<ApiOptimizationJobDetail> {
    const job = findJob(jobId);
    const strategy = findStrategy(job.strategy_id);
    const nextRank = job.candidates.length + 1;
    job.candidates.push(
      createCandidate(
        strategy,
        {
          label: payload.label ?? `候选 ${nextRank}`,
          summary: payload.summary ?? '新增候选已进入当前任务，可继续比较稳定性和参数热区。',
          parameter_snapshot: payload.parameter_snapshot,
          metrics: payload.metrics ?? { total_return: 3.8, sharpe: 0.84 },
          base_parameter_version_id: payload.base_parameter_version_id ?? job.base_parameter_version_id ?? null,
          score:
            typeof payload.metrics?.total_return === 'number'
              ? Number((payload.metrics.total_return / 10).toFixed(2))
              : 0.5,
        },
        nextRank,
      ),
    );
    return clone(recalculateJob(job));
  },
  async promoteOptimizationCandidate(jobId: string, trialId: string, mode: PromoteMode, _idempotencyKey: string, comment?: string): Promise<ApiOptimizationJobDetail> {
    const job = findJob(jobId);
    const strategy = findStrategy(job.strategy_id);
    const candidate = job.candidates.find((item) => item.id === trialId);
    if (!candidate) {
      throw new ApiError({ status: 404, code: 'optimization_candidate_not_found', message: `Candidate ${trialId} was not found.` });
    }
    if (state.promoteConflicts.has(promoteConflictKey(jobId, trialId))) {
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
      strategy.latest_optimization_job_id = job.id;
      strategy.parameter_history = [
        {
          version_number: strategy.current_parameter_version,
          parameter_version_id: strategy.current_parameter_version_id,
          revision: strategy.current_parameter_version,
          created_at: nowIso(),
          comment: comment ?? null,
          parameters: clone(candidate.parameter_snapshot),
        },
        ...strategy.parameter_history,
      ];
    }

    return clone(recalculateJob(job));
  },
  async deleteOptimizationCandidate(jobId: string, trialId: string): Promise<ApiOptimizationJobDetail> {
    const job = findJob(jobId);
    job.candidates = job.candidates.filter((candidate) => candidate.id !== trialId);
    return clone(recalculateJob(job));
  },
  async getLegInventory(): Promise<ApiLegInventory> {
    return clone(buildLegInventory());
  },
  async createAssetLeg(payload: ApiAssetLegCreatePayload): Promise<ApiAssetLeg> {
    const now = nowIso();
    const created: ApiAssetLeg = {
      id: nextId('asset-leg'),
      name: payload.name,
      symbol: payload.symbol.toUpperCase(),
      asset_kind: payload.asset_kind,
      source_snapshot_id: payload.source_snapshot_id,
      source_provider: payload.source_provider ?? null,
      freeze_mode: payload.freeze_mode,
      notes: payload.notes ?? null,
      summary: clone(payload.summary ?? {}),
      status: 'ACTIVE',
      eligibility_summary: {
        snapshot_ref: payload.source_snapshot_id,
        freeze_mode: payload.freeze_mode,
        reference_count: 0,
      },
      attribute_tags: ['asset', payload.asset_kind.toLowerCase()],
      allowed_actions: ['edit_leg_definition', 'open_composition_workbench'],
      created_at: now,
      updated_at: now,
    };
    state.assetLegs.unshift(created);
    return clone(created);
  },
  async updateAssetLeg(id: string, payload: ApiAssetLegUpdatePayload): Promise<ApiAssetLeg> {
    const existing = state.assetLegs.find((leg) => leg.id === id);
    if (!existing) {
      throw new ApiError({ status: 404, code: 'not_found', message: `asset leg not found: ${id}` });
    }
    if ('status' in payload && payload.status === 'ARCHIVED') {
      const archived: ApiAssetLeg = {
        ...existing,
        status: 'ARCHIVED',
        updated_at: nowIso(),
      };
      state.assetLegs = state.assetLegs.filter((leg) => leg.id !== id);
      return clone(archived);
    }
    const editablePayload = payload as ApiAssetLegCreatePayload;
    const updated: ApiAssetLeg = {
      ...existing,
      name: editablePayload.name,
      symbol: editablePayload.symbol.toUpperCase(),
      asset_kind: editablePayload.asset_kind,
      source_snapshot_id: editablePayload.source_snapshot_id,
      source_provider: editablePayload.source_provider ?? null,
      freeze_mode: editablePayload.freeze_mode,
      notes: editablePayload.notes ?? null,
      summary: clone(editablePayload.summary ?? {}),
      eligibility_summary: {
        ...existing.eligibility_summary,
        snapshot_ref: editablePayload.source_snapshot_id,
        freeze_mode: editablePayload.freeze_mode,
      },
      attribute_tags: ['asset', editablePayload.asset_kind.toLowerCase()],
      updated_at: nowIso(),
    };
    Object.assign(existing, updated);
    return clone(existing);
  },
  async createCashLeg(payload: ApiCashLegCreatePayload): Promise<ApiCashLeg> {
    const now = nowIso();
    const created: ApiCashLeg = {
      id: nextId('cash-leg'),
      name: payload.name,
      cash_rule_kind: payload.cash_rule_kind,
      buffer_bps: payload.buffer_bps ?? 0,
      yield_source: payload.yield_source ?? null,
      freeze_mode: payload.freeze_mode,
      notes: payload.notes ?? null,
      summary: clone(payload.summary ?? {}),
      status: 'ACTIVE',
      attribute_tags: ['cash', payload.cash_rule_kind.toLowerCase()],
      allowed_actions: ['edit_leg_definition', 'open_composition_workbench'],
      created_at: now,
      updated_at: now,
    };
    state.cashLegs.unshift(created);
    return clone(created);
  },
  async updateCashLeg(id: string, payload: ApiCashLegUpdatePayload): Promise<ApiCashLeg> {
    const existing = state.cashLegs.find((leg) => leg.id === id);
    if (!existing) {
      throw new ApiError({ status: 404, code: 'not_found', message: `cash leg not found: ${id}` });
    }
    if ('status' in payload && payload.status === 'ARCHIVED') {
      const archived: ApiCashLeg = {
        ...existing,
        status: 'ARCHIVED',
        updated_at: nowIso(),
      };
      state.cashLegs = state.cashLegs.filter((leg) => leg.id !== id);
      return clone(archived);
    }
    const editablePayload = payload as ApiCashLegCreatePayload;
    const updated: ApiCashLeg = {
      ...existing,
      name: editablePayload.name,
      cash_rule_kind: editablePayload.cash_rule_kind,
      buffer_bps: editablePayload.buffer_bps ?? 0,
      yield_source: editablePayload.yield_source ?? null,
      freeze_mode: editablePayload.freeze_mode,
      notes: editablePayload.notes ?? null,
      summary: clone(editablePayload.summary ?? {}),
      attribute_tags: ['cash', editablePayload.cash_rule_kind.toLowerCase()],
      updated_at: nowIso(),
    };
    Object.assign(existing, updated);
    return clone(existing);
  },
  async listCompositions(): Promise<ApiCompositionListItem[]> {
    return clone(
      state.compositions
        .filter((composition) => String(composition.status ?? '').toUpperCase() !== 'ARCHIVED')
        .map((composition) => ({
        id: composition.id,
        name: composition.name,
        status: composition.status,
        composition_score: composition.composition_score.score,
        leg_count: composition.normalized_legs.length,
        rebalance_frequency: composition.rebalance_frequency ?? null,
        benchmark_label:
          composition.benchmark_definition?.label ??
          composition.benchmark_definition?.symbol ??
          null,
        annualized_return: Number(composition.kpis.find((item) => item.key === 'annualized_return')?.value ?? 0),
        sharpe: Number(composition.kpis.find((item) => item.key === 'sharpe')?.value ?? 0),
        max_drawdown: Number(composition.kpis.find((item) => item.key === 'max_drawdown')?.value ?? 0),
        updated_at: composition.updated_at,
        latest_activity_label: composition.latest_activity_label,
        allowed_actions: ['open_composition_workbench', 'inspect_source_evidence'],
      })),
    );
  },
  async getCompositionDetail(id: string): Promise<ApiCompositionDetail> {
    const composition = state.compositions.find((item) => item.id === id);
    if (!composition) {
      throw new ApiError({ status: 404, code: 'composition_not_found', message: `Composition ${id} was not found.` });
    }
    return clone(composition);
  },
  async previewComposition(payload: ApiCompositionPreviewPayload): Promise<ApiCompositionPreview> {
    return clone(buildCompositionPreview(payload));
  },
  async createComposition(payload: ApiCompositionCreatePayload): Promise<ApiCompositionDetail> {
    const now = nowIso();
    const created = buildCompositionDetailFromPayload(
      nextId('comp'),
      payload,
      payload.status ?? 'DRAFT',
      now,
      now,
    );
    state.compositions.unshift(created);
    return clone(created);
  },
  async updateComposition(id: string, payload: ApiCompositionUpdatePayload): Promise<ApiCompositionDetail> {
    const existing = state.compositions.find((item) => item.id === id);
    if (!existing) {
      throw new ApiError({ status: 404, code: 'composition_not_found', message: `Composition ${id} was not found.` });
    }
    const updated = buildCompositionDetailFromPayload(
      id,
      {
        name: payload.name ?? existing.name,
        description: payload.description ?? existing.description ?? undefined,
        benchmark_definition: payload.benchmark_definition ?? existing.benchmark_definition,
        rebalance_frequency: payload.rebalance_frequency ?? existing.rebalance_frequency,
        cost_policy: payload.cost_policy ?? existing.cost_policy,
        legs:
          payload.legs ??
          existing.normalized_legs.map((leg) => ({
            leg_kind: leg.leg_kind,
            source_ref_id: leg.source_ref_id,
            source_ref_type: leg.source_ref_type,
            display_name: leg.display_name,
            weight_pct: leg.weight_pct,
            weight_locked: leg.weight_locked,
            ordering: leg.ordering,
            config: leg.config,
          })),
        status: normalizeCompositionStatus(payload.status ?? existing.status),
      },
      normalizeCompositionStatus(payload.status ?? existing.status),
      existing.created_at,
      nowIso(),
    );
    state.compositions = state.compositions.map((item) => (item.id === id ? updated : item));
    return clone(updated);
  },
  async getSnapshotOverview(): Promise<ApiSnapshotOverview> {
    return buildSnapshotOverview();
  },
  async refreshSnapshots(payload): Promise<ApiSnapshotOverview> {
    return buildSnapshotOverview('2026-04-01T10:00:00Z', payload?.mode ?? 'incremental');
  },
  async getPitDataOverview(): Promise<ApiPitDataOverview> {
    return buildPitDataOverview();
  },
  async createPitResearchWaiver(payload?: ApiPitResearchWaiverPayload): Promise<ApiPitDataOverview> {
    const overview = buildPitDataOverview();
    const ignoredSymbols = payload?.ignored_symbols?.length
      ? payload.ignored_symbols
      : overview.coverage_gap?.default_ignored_symbols ?? [];
    const normalizedIgnoredSymbols = ignoredSymbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean);
    demoPitWaiver = {
      id: `pitw-demo-${Date.now()}`,
      status: 'ACTIVE',
      dataset_snapshot_id: payload?.dataset_snapshot_id ?? overview.dataset_snapshot_id,
      universe_snapshot_id: payload?.universe_snapshot_id ?? overview.universe_snapshot_id,
      ignored_symbols: normalizedIgnoredSymbols,
      ignored_symbol_count: normalizedIgnoredSymbols.length,
      reason: payload?.reason ?? '研究阶段临时忽略非核心缺失标的，晋升仍要求 Full Ready。',
      created_at: nowIso(),
      created_by: payload?.created_by ?? 'researcher',
      promotion_eligible: false,
      mode: 'LIMITED_READY',
      impact_estimate: {
        ignored_symbol_count: normalizedIgnoredSymbols.length,
        ignored_missing_share_pct: 24.52,
        mcap_weight_pct: 0.35,
        estimated_ic_delta_abs: 0.0039,
        risk_level: 'LOW',
        affected_buckets: ['当前非成员/非核心'],
        method: 'missing_share_plus_mcap_weight_proxy',
        note: '基于缺口数量占比和可用市值权重估算潜在 IC 扰动；正式晋升仍需 Full Ready 后复算。',
      },
    };
    return buildPitDataOverview();
  },
  async revokePitResearchWaiver(id: string): Promise<ApiPitDataOverview> {
    if (demoPitWaiver?.id === id) {
      demoPitWaiver = null;
    }
    return buildPitDataOverview();
  },
  async applyPitIdentityOverride(_payload: ApiPitIdentityOverridePayload): Promise<ApiPitDataOverview> {
    return buildPitDataOverview();
  },
  async restartPitIdentityScraper(): Promise<ApiPitIdentityScraperRestartResponse> {
    const pitData = buildPitDataOverview();
    return {
      job_id: `demo_identity_${Date.now()}`,
      status: 'COMPLETED',
      message: 'Identity Scraper 已执行：解析成功 12 项，未解析 404 项。',
      started_at: nowIso(),
      completed_at: nowIso(),
      attempted_count: pitData.ops_guidance?.identity_pending_count ?? 0,
      resolved_count: 12,
      failed_count: Math.max(0, (pitData.ops_guidance?.identity_pending_count ?? 0) - 12),
      pending_before: pitData.ops_guidance?.identity_pending_count ?? 0,
      pending_after: Math.max(0, (pitData.ops_guidance?.identity_pending_count ?? 0) - 12),
      resolved_symbols: ['ABGX', 'ABK'],
      failed_symbols: [],
      pit_data: pitData,
    };
  },
  async listFactors(params): Promise<ApiFactorListResponse> {
    let items = buildDemoFactors();
    if (params?.source) {
      items = items.filter((item) => item.source === params.source);
    }
    if (params?.tag) {
      items = items.filter((item) => item.tags.includes(String(params.tag)));
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
    const onlineItems = lifecycleBase.filter((item) => !isFactorOffline(item));
    const offlineItems = lifecycleBase.filter((item) => isFactorOffline(item));
    const lifecycle = String(params?.lifecycle ?? 'online').toLowerCase();
    if (lifecycle === 'offline') {
      items = offlineItems;
    } else if (lifecycle === 'all') {
      items = lifecycleBase;
    } else {
      items = onlineItems;
    }
    return {
      items,
      summary: {
        total: items.length,
        all_count: lifecycleBase.length,
        online_count: onlineItems.length,
        offline_count: offlineItems.length,
        deprecated_count: offlineItems.filter((item) => item.lifecycle_status === 'DEPRECATED').length,
        pruned_count: offlineItems.filter((item) => item.lifecycle_status === 'PRUNED').length,
        system_seed_count: items.filter((item) => item.source === 'SYSTEM_SEED').length,
        ready_to_diagnose_count: items.filter((item) => item.diagnostic_status === 'READY_TO_DIAGNOSE').length,
        sandbox_ready_count: items.filter((item) => item.diagnostic_status === 'SANDBOX_READY').length,
        blocked_data_count: items.filter((item) => item.diagnostic_status === 'BLOCKED_DATA').length,
        governance_queue_count: buildFactorGovernanceOverview(items).queue_count,
        strategy_usage_factor_count: 3,
        strategy_usage_factor_ids: ['s_mom_12m1m_rank', 's_val_ep_ltm_raw', 's_vol_252d_rank'],
        pit_status: 'READY',
      },
    };
  },
  async getFactorGovernanceOverview(): Promise<ApiFactorGovernanceOverview> {
    return clone(buildFactorGovernanceOverview());
  },
  async executeFactorGovernanceAction(actionId, payload): Promise<ApiFactorGovernanceExecuteResponse> {
    const command = String(payload.command ?? '').toUpperCase();
    const offlineAt = nowIso();
    const factorIds = Array.from(
      new Set([...(payload.factor_ids ?? []), payload.factor_id ?? ''].map(String).filter((item) => item.length > 0)),
    );
    if (command === 'PUBLISH_OPTIMIZED_FACTOR') {
      const created = buildDemoFactors().find((item) => item.id === 's_vol_downside_252d_rank');
      const createdFactor = created
        ? {
            ...created,
            id: 'm_vol_downsiderev_252d_rank',
            name: '反向下行波动率代理（252日）',
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
        governance_overview: buildFactorGovernanceOverview(),
      });
    }
    const items = buildDemoFactors()
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
      governance_overview: buildFactorGovernanceOverview(),
    });
  },
  async listFactorQuarantineCandidates(): Promise<ApiFactorQuarantineCandidateListResponse> {
    return clone(buildFactorQuarantineCandidates());
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
    const createdAt = nowIso();
    return {
      ...buildFactorDetail('s_mom_12m1m_rank'),
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
      institutional_note: '人工因子，需通过 PIT 诊断后才能进入已验证状态。',
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
      correlation_cluster: buildFactorDetail('s_mom_12m1m_rank').correlation_cluster,
    };
  },
  async getFactor(id: string): Promise<ApiFactorDetail> {
    return buildFactorDetail(id);
  },
  async runFactorDiagnostics(id: string, payload: ApiFactorDiagnosticPayload): Promise<ApiFactorDiagnosticRunResponse> {
    const factor = buildFactorDetail(id);
    if (factor.diagnostic_status === 'BLOCKED_DATA') {
      throw new ApiError({
        status: 400,
        code: 'factor_data_blocked',
        message: '因子基础数据待补，不能触发正式诊断。',
      });
    }
    const runId = `fdiag-demo-${Date.now().toString(36)}`;
    return {
      run_id: runId,
      summary: {
        ...(factor.latest_diagnostic_summary ?? demoFactorSummaries.s_mom_12m1m_rank),
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
    };
  },
  async previewFactorDiagnostics(payload: ApiFactorDiagnosticPreviewPayload): Promise<ApiFactorDiagnosticPreview> {
    return {
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
    };
  },
  async listFactorMiningJobs(): Promise<ApiFactorMiningJobListResponse> {
    const job = buildDemoMiningJob({
      universe: 'SP500',
      start_date: '2020-01-01',
      end_date: '2025-12-31',
      operators: ['Return', 'Std', 'Rank', 'ZScore', 'Winsorize'],
      candidate_count: 1000,
      random_seed: 42,
      min_rank_ic: 0.02,
      max_depth: 4,
    });
    return {
      items: [job],
      summary: {
        total: 1,
        completed_count: 1,
        running_count: 0,
        total_candidates: job.progress.total_candidates,
      },
    };
  },
  async createFactorMiningJob(payload: ApiFactorMiningJobCreatePayload): Promise<ApiFactorMiningJob> {
    return buildDemoMiningJob(payload);
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
    return { ...buildDemoMiningJob(payload), id };
  },
  async cancelFactorMiningJob(id: string): Promise<ApiFactorMiningJob> {
    return {
      ...buildDemoMiningJob(
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
    };
  },
  async getFactorFactoryOverview(): Promise<ApiFactorFactoryOverview> {
    return buildDemoFactorFactoryOverview();
  },
  async startFactorFactoryAutomation(
    _payload?: ApiFactorFactoryAutomationPayload,
  ): Promise<ApiFactorFactoryOverview> {
    return buildDemoFactorFactoryOverview('ACTIVE', 'DAILY', 'COMPLETED');
  },
  async pauseFactorFactoryAutomation(): Promise<ApiFactorFactoryOverview> {
    return buildDemoFactorFactoryOverview('PAUSED', 'DAILY', 'COMPLETED');
  },
  async runFactorFactoryNow(
    _payload?: ApiFactorFactoryRunNowPayload,
  ): Promise<ApiFactorFactoryOverview> {
    return buildDemoFactorFactoryOverview('PAUSED', 'MANUAL', 'COMPLETED');
  },
  async cancelFactorFactoryRun(id: string): Promise<ApiFactorFactoryRun> {
    const overview = buildDemoFactorFactoryOverview('ACTIVE', 'DAILY', 'CANCELLED');
    return { ...overview.latest_run!, id, status: 'CANCELLED' };
  },
  async previewFactorModel(payload: ApiFactorModelPreviewPayload): Promise<ApiFactorModelPreviewResponse> {
    return buildDemoFactorModelPreview(payload);
  },
  async createFactorModel(payload: ApiFactorModelCreatePayload): Promise<ApiStrategyDetail> {
    return buildDemoFactorModelStrategy(payload);
  },
};

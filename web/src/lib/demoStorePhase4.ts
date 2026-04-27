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
  type ApiOptimizationCandidate,
  type ApiOptimizationJobCreatePayload,
  type ApiOptimizationJobDetail,
  type ApiOptimizationJobListItem,
  type ApiSnapshotOverview,
  type ApiStrategyCreationSession,
  type ApiStrategyDetail,
  type ApiStrategyListItem,
  type ApiWorkspaceOverview,
  type BacktestRunDetailRequest,
  type CreateCandidatePayload,
  type DemoApi,
  type PromoteMode,
} from '../types';
import { createInitialState } from './demoStoreSeed';
import { clone, createCandidate, nextId, nowIso } from './demoStoreShared';
import {
  applyOptimizationJobConstraintUpdate,
  buildOptimizationJobListItem,
  hydrateOptimizationJob,
} from './optimization-demo';

let state = createInitialState();

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
      audit_alerts: ['Official tracking_error_bps is required for BOND_ETF readiness.'],
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
        coverage_notes: ['7 runtime bond rows', 'LQD remains WATCH until official tracking_error_bps lands'],
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
  };
  return {
    ...overviewBase,
    bond_fixed_income: buildBondFixedIncomeOverview(overviewBase),
  };
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
  async getOptimizationJobDetail(id: string): Promise<ApiOptimizationJobDetail> {
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
    state.optimizationJobs = state.optimizationJobs.map((item) => (item.id === jobId ? updated : item));
    sortOptimizationJobs();
    return clone(updated);
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
};

import React from "react";
import {
  readFileSync,
} from "node:fs";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApiBacktestRunDetail,
  ApiOptimizationCandidate,
  ApiOptimizationConstraintPresetKey,
  ApiOptimizationJobCreatePayload,
  ApiOptimizationJobDetail,
  ApiOptimizationJobListItem,
  ApiOptimizationSearchSpaceField,
  ApiStrategyDetail,
  ApiWorkspaceOverview,
  BacktestRunDetailRequest,
  DemoApi,
} from "./types";
import {
  hydrateOptimizationJob,
  buildOptimizationJobListItem,
} from "./lib/optimization-demo";

let currentApi: DemoApi;

vi.mock("./lib/demoStoreContext", async () => {
  const ReactModule = await import("react");
  const { createContext, useContext } = ReactModule;

  const ApiClientContext = createContext<DemoApi | null>(null);

  function ApiClientProvider({
    children,
  }: {
    children: React.ReactNode;
  }): React.ReactElement {
    return ReactModule.createElement(
      ApiClientContext.Provider,
      { value: currentApi },
      children,
    );
  }

  function useApiClient(): DemoApi {
    const api = useContext(ApiClientContext);
    if (!api) {
      throw new Error("useApiClient 必须在 ApiClientProvider 内使用。");
    }
    return api;
  }

  return {
    ApiClientProvider,
    DemoStoreProvider: ApiClientProvider,
    useApiClient,
    useDemoApi: useApiClient,
  };
});

import App from "./app-runtime";
import { createStrategy, nowIso } from "./lib/demoStoreShared";

type OptimizationJobState = {
  job: ApiOptimizationJobDetail;
  phase: number;
};

const MISSING_MATCHING_COMBINATION_COUNT_ERROR =
  "优化结果缺少 matching_combination_count，无法确认符合约束条件的组合总数。";

function formatVersionedStrategyName(
  name: string,
  version: number | undefined,
): string {
  const trimmed = name.trim();
  let cursor = trimmed.length;
  while (cursor > 0 && /\d/.test(trimmed[cursor - 1] ?? "")) {
    cursor -= 1;
  }
  const baseName =
    cursor > 0 &&
    cursor < trimmed.length &&
    trimmed[cursor - 1]?.toLowerCase() === "v"
      ? trimmed.slice(0, cursor - 1).trimEnd()
      : trimmed;
  if (
    typeof version !== "number" ||
    !Number.isFinite(version) ||
    version <= 1
  ) {
    return baseName;
  }
  return `${baseName}v${Math.round(version)}`;
}

function makeSearchSpace(): ApiOptimizationSearchSpaceField[] {
  return [
    {
      key: "lookback_months",
      label: "回看(月)",
      mode: "range",
      current: 6,
      start: 6,
      end: 12,
      step: 1,
      tag: "主搜索维度",
    },
    {
      key: "skip_recent_months",
      label: "跳过最近(月)",
      mode: "range",
      current: 1,
      start: 1,
      end: 4,
      step: 1,
      tag: "辅助搜索维度",
    },
    {
      key: "top_n",
      label: "买入排名阈值",
      mode: "range",
      current: 10,
      start: 10,
      end: 100,
      step: 10,
      tag: "辅助搜索维度",
    },
    {
      key: "hold_rank_threshold",
      label: "保留排名阈值",
      mode: "range",
      current: 120,
      start: 110,
      end: 130,
      step: 10,
      tag: "辅助搜索维度",
    },
    {
      key: "weighting_method",
      label: "加权方式",
      mode: "fixed",
      current: "equal_weight",
      value: "equal_weight",
      start: "equal_weight",
      end: "equal_weight",
      step: 1,
      tag: "锁定参数",
    },
  ];
}

const defaultConstraintPayload = {
  constraint_preset_key: "balanced" as const,
  constraint_label: "平衡型",
  constraints: [
    {
      key: "max_drawdown_pct",
      label: "最大回撤",
      category: "risk" as const,
      operator: "<=" as const,
      value: 15,
      baseline_value: 15,
      unit: "%",
      source: "preset" as const,
    },
    {
      key: "out_of_sample_sharpe",
      label: "样本外夏普",
      category: "return" as const,
      operator: ">=" as const,
      value: 0.9,
      baseline_value: 0.9,
      unit: "",
      source: "preset" as const,
    },
    {
      key: "annualized_return",
      label: "年化收益率",
      category: "return" as const,
      operator: ">=" as const,
      value: 12,
      baseline_value: 12,
      unit: "%",
      source: "preset" as const,
    },
    {
      key: "stability",
      label: "稳定度",
      category: "stability" as const,
      operator: ">=" as const,
      value: 75,
      baseline_value: 75,
      unit: "分",
      source: "preset" as const,
    },
    {
      key: "return_sharpe",
      label: "收益夏普",
      category: "return" as const,
      operator: ">=" as const,
      value: 1.1,
      baseline_value: 1.1,
      unit: "",
      source: "preset" as const,
    },
  ],
};

type OptimizationObjective =
  | "return_sharpe"
  | "annualized_return"
  | "composite_score";

type OptimizationTestApi = DemoApi & {
  __requestedRunDetailViews?: string[];
};

type OptimizationConstraintUpdatePayloadForTest = {
  objective?: string | null;
  constraint_preset_key?: ApiOptimizationConstraintPresetKey | null;
  constraint_label?: string | null;
  constraints?: ApiOptimizationJobDetail["summary"]["constraints"];
};

type OptimizationCandidateRecord = ApiOptimizationJobDetail["candidates"][number];

function readOptimizationMetricNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normalizeOptimizationConstraintMetricValue(
  constraintKey: string,
  value: number,
): number {
  switch (constraintKey) {
    case "annualized_return":
      return Math.abs(value) <= 1.5 ? value * 100 : value;
    case "max_drawdown_pct":
      return Math.abs(value) <= 1.5 ? Math.abs(value * 100) : Math.abs(value);
    case "turnover":
      return Math.abs(value) <= 1.5 ? value * 100 : value;
    default:
      return value;
  }
}

function getOptimizationConstraintMetricValue(
  candidate: ApiOptimizationJobDetail["candidates"][number],
  constraintKey: string,
): number | null {
  const metrics = candidate.metrics ?? {};
  const rawValue =
    constraintKey === "annualized_return"
      ? readOptimizationMetricNumber(metrics.annualized_return ?? metrics.cagr)
      : constraintKey === "return_sharpe"
        ? readOptimizationMetricNumber(metrics.return_sharpe ?? metrics.sharpe)
        : constraintKey === "out_of_sample_sharpe"
          ? readOptimizationMetricNumber(
              metrics.out_of_sample_sharpe ?? metrics.oos_sharpe,
            )
          : constraintKey === "max_drawdown_pct"
            ? readOptimizationMetricNumber(metrics.max_drawdown_pct) ??
              (typeof metrics.max_drawdown === "number"
                ? metrics.max_drawdown * 100
                : null)
            : constraintKey === "turnover"
              ? readOptimizationMetricNumber(
                  metrics.turnover_pct ?? metrics.turnover,
                )
              : constraintKey === "stability"
                ? readOptimizationMetricNumber(metrics.stability)
                : readOptimizationMetricNumber(metrics[constraintKey]);
  return typeof rawValue === "number"
    ? normalizeOptimizationConstraintMetricValue(constraintKey, rawValue)
    : null;
}

function normalizeOptimizationObjectiveForTest(
  objective?: string | null,
): OptimizationObjective {
  const normalized = String(objective ?? "").trim().toLowerCase();
  if (normalized === "annualized_return" || normalized === "cagr") {
    return "annualized_return";
  }
  if (normalized === "composite_score" || normalized === "score") {
    return "composite_score";
  }
  return "return_sharpe";
}

function getOptimizationObjectiveMetricValueForTest(
  candidate: OptimizationCandidateRecord,
  objective: OptimizationObjective,
): number {
  if (objective === "annualized_return") {
    return readOptimizationMetricNumber(
      candidate.metrics?.annualized_return ?? candidate.metrics?.cagr,
    ) ?? 0;
  }
  if (objective === "composite_score") {
    return typeof candidate.score === "number" ? candidate.score : 0;
  }
  return (
    readOptimizationMetricNumber(
      candidate.metrics?.return_sharpe ?? candidate.metrics?.sharpe,
    ) ?? 0
  );
}

function rerankOptimizationCandidatesForTest(
  candidates: ApiOptimizationJobDetail["candidates"],
  objective: OptimizationObjective,
): ApiOptimizationJobDetail["candidates"] {
  return [...candidates]
    .sort((left, right) => {
      const primaryDelta =
        getOptimizationObjectiveMetricValueForTest(right, objective) -
        getOptimizationObjectiveMetricValueForTest(left, objective);
      if (Math.abs(primaryDelta) > 1e-9) {
        return primaryDelta;
      }
      const rankDelta = (left.rank ?? Number.MAX_SAFE_INTEGER) -
        (right.rank ?? Number.MAX_SAFE_INTEGER);
      if (rankDelta !== 0) {
        return rankDelta;
      }
      return String(left.id ?? "").localeCompare(String(right.id ?? ""));
    })
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
    }));
}

function buildBestMetricsSummaryFromCandidate(
  previous: ApiOptimizationJobDetail["summary"]["best_metrics_summary"],
  candidate: OptimizationCandidateRecord | null,
): ApiOptimizationJobDetail["summary"]["best_metrics_summary"] {
  if (!candidate) {
    return previous ?? null;
  }
  return {
    ...(previous ?? {}),
    trial_index:
      typeof candidate.rank === "number"
        ? candidate.rank
        : previous?.trial_index ?? 0,
    label: candidate.label,
    status: candidate.status,
    parameter_snapshot: structuredClone(candidate.parameter_snapshot ?? {}),
    metrics: structuredClone(candidate.metrics ?? {}),
    score: typeof candidate.score === "number" ? candidate.score : 0,
  };
}

function applyConstraintUpdateToJob(
  job: ApiOptimizationJobDetail,
  payload: OptimizationConstraintUpdatePayloadForTest,
): ApiOptimizationJobDetail {
  const nextObjective = normalizeOptimizationObjectiveForTest(
    payload.objective ?? job.summary.objective ?? job.request.objective,
  );
  const nextConstraintPresetKey =
    payload.constraint_preset_key ??
    job.summary.constraint_preset_key ??
    job.request.constraint_preset_key ??
    "balanced";
  const nextConstraintLabel =
    payload.constraint_label ??
    job.summary.constraint_label ??
    job.request.constraint_label ??
    "平衡型";
  const nextConstraints = structuredClone(
    payload.constraints ?? job.summary.constraints ?? job.request.constraints ?? [],
  );
  const rerankedCandidates = rerankOptimizationCandidatesForTest(
    job.candidates,
    nextObjective,
  );
  const bestCandidate = rerankedCandidates[0] ?? null;

  return syncMatchingCombinationCount({
    ...job,
    updated_at: nowIso(),
    request: {
      ...job.request,
      objective: nextObjective,
      constraint_preset_key: nextConstraintPresetKey,
      constraint_label: nextConstraintLabel,
      constraints: structuredClone(nextConstraints),
    },
    summary: {
      ...job.summary,
      objective: nextObjective,
      constraint_preset_key: nextConstraintPresetKey,
      constraint_label: nextConstraintLabel,
      constraints: structuredClone(nextConstraints),
      best_metrics_summary: buildBestMetricsSummaryFromCandidate(
        job.summary.best_metrics_summary,
        bestCandidate,
      ),
    },
    result: {
      ...job.result,
      constraint_preset_key: nextConstraintPresetKey,
      constraint_label: nextConstraintLabel,
      constraints: structuredClone(nextConstraints),
      best_candidate_id: bestCandidate?.id ?? null,
      best_candidate_label: bestCandidate?.label ?? null,
    },
    candidates: rerankedCandidates,
  });
}

function countMatchingCombinationCandidates(
  candidates: ApiOptimizationJobDetail["candidates"],
  constraints:
    | ApiOptimizationJobDetail["summary"]["constraints"]
    | ApiOptimizationJobDetail["request"]["constraints"],
): number {
  const optimizationCandidates = candidates.filter(
    (candidate) =>
      candidate.label !== "当前组合" &&
      candidate.title !== "当前组合" &&
      candidate.summary !== "当前基准",
  );
  const activeConstraints = constraints ?? [];
  if (!activeConstraints.length) {
    return optimizationCandidates.length;
  }
  return optimizationCandidates.filter((candidate) =>
    activeConstraints.every((constraint) => {
      const metricValue = getOptimizationConstraintMetricValue(
        candidate,
        constraint.key,
      );
      if (metricValue === null) {
        return false;
      }
      return constraint.operator === ">="
        ? metricValue >= constraint.value
        : metricValue <= constraint.value;
    }),
  ).length;
}

function syncMatchingCombinationCount(
  job: ApiOptimizationJobDetail,
): ApiOptimizationJobDetail {
  const status = String(job.status ?? "").toUpperCase();
  if (["QUEUED", "RUNNING", "INTERRUPTED"].includes(status)) {
    return job;
  }
  const count = countMatchingCombinationCandidates(
    job.matching_combinations ?? job.candidates,
    job.summary.constraints ?? job.request.constraints,
  );
  job.summary.matching_combination_count = count;
  job.matching_combination_count = count;
  return job;
}

function setMatchingCombinations(
  job: ApiOptimizationJobDetail,
  combinations: ApiOptimizationCandidate[],
): ApiOptimizationJobDetail {
  const sanitizedCombinations = combinations.filter(
    (candidate) =>
      candidate.label !== "当前组合" &&
      candidate.title !== "当前组合" &&
      candidate.summary !== "当前基准",
  );
  job.matching_combinations = structuredClone(sanitizedCombinations);
  job.summary.matching_combination_count = sanitizedCombinations.length;
  job.matching_combination_count = sanitizedCombinations.length;
  return job;
}

function createStrategyFixture(): ApiStrategyDetail {
  return createStrategy({
    id: "strat-001",
    name: "标普动量策略",
    description: "用于验证优化实验室前端恢复流程的测试策略。",
    latest_run_id: "bt-001",
    latest_optimization_job_id: "opt-interrupted",
    current_parameter_version: 1,
    current_parameter_version_id: "strat-001-v1",
    universe_name: "SP500",
    strategy_type: "MOMENTUM",
    parameters: {
      lookback_months: 6,
      skip_recent_months: 1,
      top_n: 10,
      hold_rank_threshold: 120,
      weighting_method: "equal_weight",
    },
    latest_completed_run_summary: {
      run_id: "bt-001",
      parameter_version: 1,
      parameter_version_id: "strat-001-v1",
      status: "COMPLETED",
      total_return: 0.18,
      annualized_return: 0.124,
      sharpe: 1.18,
      max_drawdown: -0.064,
      oos_total_return: 0.09,
      oos_annualized_return: 0.098,
      oos_sharpe: 0.87,
      oos_max_drawdown: -0.052,
      warning_count: 0,
      execution_policy: "T_CLOSE_TO_T1_OPEN",
      dataset_snapshot_id: "ds-001",
      universe_snapshot_id: "un-001",
      completed_at: nowIso(),
      sparkline_points: [],
    },
  });
}

function createRunFixture(strategy: ApiStrategyDetail): ApiBacktestRunDetail {
  return {
    id: "bt-001",
    strategy_id: strategy.id,
    strategy_name: strategy.name,
    status: "COMPLETED",
    metrics: {
      total_return: 0.18,
      total_return_pct: 18,
      annualized_return: 0.124,
      sharpe: 1.18,
      out_of_sample_sharpe: 0.87,
      max_drawdown: -0.064,
      max_drawdown_pct: -6.4,
      turnover: 0.013,
      turnover_pct: 0.013,
    },
    warnings: [],
    chart_series: [],
    monthly_returns: [],
    trade_details: [],
    configuration: { oos_start_date: "2025-02-01" },
    parameter_snapshot: strategy.parameters ?? {},
    snapshot_summary: {
      dataset_snapshot_id: "ds-001",
      universe_snapshot_id: "un-001",
    },
    data_segment_type: "FULL",
    parameter_version_id: strategy.current_parameter_version_id,
    request: {
      start_date: "2025-01-02",
      end_date: "2025-02-28",
      execution_policy: "T_CLOSE_TO_T1_OPEN",
    },
    is_permanent: false,
    source_run_id: null,
    trade_audit_items: [],
    trade_audit: [],
    analysis: {
      subtitle: "测试集仍在领先基准。",
      kpi_cards: [],
      decision_rail: { score: 67, summary: "测试集仍在领先基准。", items: [] },
    },
  };
}

function createBestMetricsSummary(): NonNullable<
  ApiOptimizationJobDetail["summary"]["best_metrics_summary"]
> {
  return {
    trial_index: 1,
    label: "稳定策略中心",
    status: "SUCCEEDED",
    parameter_snapshot: {
      lookback_months: 6,
      skip_recent_months: 1,
      top_n: 10,
      hold_rank_threshold: 120,
      weighting_method: "equal_weight",
    },
    metrics: {
      annualized_return: 0.138,
      return_sharpe: 1.14,
      out_of_sample_sharpe: 0.98,
      max_drawdown_pct: -12.4,
      stability: 82,
    },
    score: 1.043,
    error_message: null,
    started_at: "2026-03-31T04:42:00.000Z",
    completed_at: "2026-03-31T04:44:00.000Z",
  };
}

function createCompletedJob(
  strategy: ApiStrategyDetail,
  run: ApiBacktestRunDetail,
  jobId: string,
): ApiOptimizationJobDetail {
  const base: ApiOptimizationJobDetail = {
    id: jobId,
    strategy_id: strategy.id,
    status: "COMPLETED",
    request: {
      objective: "return_sharpe",
      base_parameter_version_id: strategy.current_parameter_version_id,
      source_run_id: run.id,
      entry_point: "run_detail",
      validation_mode: "walk_forward",
      budget_combinations: 70,
      search_space: makeSearchSpace(),
      ...defaultConstraintPayload,
    },
    summary: {
      objective: "return_sharpe",
      candidate_count: 0,
      baseline_parameter_version_id: strategy.current_parameter_version_id,
      entry_point: "run_detail",
      validation_mode: "walk_forward",
      source_run_id: run.id,
      budget_combinations: 70,
      completed_combinations: 70,
      progress_pct: 100,
      current_stage: "优化完成",
      latest_update: "优化任务已完成。",
      estimated_remaining_minutes: 0,
      estimated_completed_at: "2026-03-31T04:58:00.000Z",
      search_space: makeSearchSpace(),
      status: "COMPLETED",
      best_metrics_summary: createBestMetricsSummary(),
      ...defaultConstraintPayload,
    },
    result: {
      best_candidate_id: null,
      best_candidate_label: null,
      baseline_parameter_version_id: strategy.current_parameter_version_id,
      headline: "优化结果已就绪",
      summary: "优化任务已完成。",
      status: "COMPLETED",
      progress_pct: 100,
      current_stage: "优化完成",
      latest_update: "优化任务已完成。",
    },
    candidates: [],
    base_parameter_version_id: strategy.current_parameter_version_id,
    created_at: nowIso(),
    updated_at: nowIso(),
    completed_at: nowIso(),
  };

  return syncMatchingCombinationCount(hydrateOptimizationJob(strategy, base, run));
}

function createInterruptedJob(
  strategy: ApiStrategyDetail,
  run: ApiBacktestRunDetail,
  jobId: string,
): ApiOptimizationJobDetail {
  const base: ApiOptimizationJobDetail = {
    id: jobId,
    strategy_id: strategy.id,
    status: "INTERRUPTED",
    request: {
      objective: "return_sharpe",
      base_parameter_version_id: strategy.current_parameter_version_id,
      source_run_id: run.id,
      entry_point: "run_detail",
      validation_mode: "walk_forward",
      budget_combinations: 70,
      search_space: makeSearchSpace(),
      ...defaultConstraintPayload,
    },
    summary: {
      objective: "return_sharpe",
      candidate_count: 0,
      baseline_parameter_version_id: strategy.current_parameter_version_id,
      entry_point: "run_detail",
      validation_mode: "walk_forward",
      source_run_id: run.id,
      budget_combinations: 70,
      completed_combinations: 11,
      progress_pct: 16,
      current_stage: "已中断",
      latest_update: "已保存 11 组结果，点击继续优化可从第 12 组恢复。",
      estimated_remaining_minutes: 14,
      estimated_completed_at: "2026-03-31T05:14:00.000Z",
      search_space: makeSearchSpace(),
      status: "INTERRUPTED",
      resume_ready: true,
      persisted_trial_count: 11,
      next_trial_index: 12,
      interrupted_reason: "服务重启",
      best_metrics_summary: createBestMetricsSummary(),
      ...defaultConstraintPayload,
    },
    result: {
      best_candidate_id: null,
      best_candidate_label: null,
      baseline_parameter_version_id: strategy.current_parameter_version_id,
      headline: "优化已中断",
      summary: "已保存 11 组结果，点击继续优化可从第 12 组恢复。",
      status: "INTERRUPTED",
      progress_pct: 16,
      current_stage: "已中断",
      latest_update: "已保存 11 组结果，点击继续优化可从第 12 组恢复。",
    },
    candidates: [],
    base_parameter_version_id: strategy.current_parameter_version_id,
    created_at: nowIso(),
    updated_at: nowIso(),
    completed_at: null,
    resume_ready: true,
    persisted_trial_count: 11,
    next_trial_index: 12,
    interrupted_reason: "服务重启",
    best_metrics_summary: createBestMetricsSummary(),
  };

  return hydrateOptimizationJob(strategy, base, run);
}

function createEmptyCompletedJob(
  strategy: ApiStrategyDetail,
  run: ApiBacktestRunDetail,
  jobId: string,
): ApiOptimizationJobDetail {
  const base: ApiOptimizationJobDetail = {
    id: jobId,
    strategy_id: strategy.id,
    status: "COMPLETED",
    request: {
      objective: "return_sharpe",
      base_parameter_version_id: strategy.current_parameter_version_id,
      source_run_id: run.id,
      entry_point: "run_detail",
      validation_mode: "walk_forward",
      budget_combinations: 20,
      search_space: makeSearchSpace(),
      ...defaultConstraintPayload,
    },
    summary: {
      objective: "return_sharpe",
      candidate_count: 0,
      baseline_parameter_version_id: strategy.current_parameter_version_id,
      entry_point: "run_detail",
      validation_mode: "walk_forward",
      source_run_id: run.id,
      budget_combinations: 20,
      completed_combinations: 20,
      progress_pct: 100,
      current_stage: "优化完成",
      latest_update: "优化任务已完成，但尚未形成可展示候选。",
      search_space: makeSearchSpace(),
      status: "COMPLETED",
      ...defaultConstraintPayload,
    },
    result: {
      best_candidate_id: null,
      best_candidate_label: null,
      baseline_parameter_version_id: strategy.current_parameter_version_id,
      headline: "优化结果已就绪",
      summary: "优化任务已完成，但尚未形成可展示候选。",
      status: "COMPLETED",
      progress_pct: 100,
      current_stage: "优化完成",
      latest_update: "优化任务已完成，但尚未形成可展示候选。",
    },
    candidates: [],
    base_parameter_version_id: strategy.current_parameter_version_id,
    created_at: nowIso(),
    updated_at: nowIso(),
    completed_at: nowIso(),
  };

  return syncMatchingCombinationCount(base);
}

function createOptimizationTestApi(): DemoApi {
  const strategy = createStrategyFixture();
  const run = createRunFixture(strategy);
  const jobs = new Map<string, OptimizationJobState>([
    [
      "opt-001",
      { job: createCompletedJob(strategy, run, "opt-001"), phase: 0 },
    ],
    [
      "opt-interrupted",
      { job: createInterruptedJob(strategy, run, "opt-interrupted"), phase: 0 },
    ],
    [
      "opt-empty",
      { job: createEmptyCompletedJob(strategy, run, "opt-empty"), phase: 0 },
    ],
  ]);
  let createdJobCounter = 0;

  function cloneJob(job: ApiOptimizationJobDetail): ApiOptimizationJobDetail {
    return structuredClone(job);
  }

  function buildQueuedJob(
    jobId: string,
    payload: Partial<ApiOptimizationJobDetail["request"]> = {},
  ): OptimizationJobState {
    const queued: ApiOptimizationJobDetail = {
      id: jobId,
      strategy_id: strategy.id,
      status: "QUEUED",
      request: {
        objective: "return_sharpe",
        base_parameter_version_id: strategy.current_parameter_version_id,
        source_run_id: run.id,
        entry_point: "run_detail",
        validation_mode: "walk_forward",
        budget_combinations: 70,
        search_space: makeSearchSpace(),
        ...defaultConstraintPayload,
        ...payload,
      },
      summary: {
        objective: "return_sharpe",
        candidate_count: 0,
        baseline_parameter_version_id: strategy.current_parameter_version_id,
        entry_point: "run_detail",
        validation_mode: "walk_forward",
        source_run_id: run.id,
        budget_combinations: 70,
        completed_combinations: 0,
        progress_pct: 0,
        current_stage: "任务已创建",
        latest_update: "优化任务已创建，正在准备搜索队列。",
        estimated_remaining_minutes: null,
        estimated_completed_at: null,
        search_space: makeSearchSpace(),
        status: "QUEUED",
        ...defaultConstraintPayload,
      },
      result: {
        best_candidate_id: null,
        best_candidate_label: null,
        baseline_parameter_version_id: strategy.current_parameter_version_id,
        headline: "优化进行中",
        summary: "优化任务已创建，正在准备搜索队列。",
        status: "QUEUED",
        progress_pct: 0,
        current_stage: "任务已创建",
        latest_update: "优化任务已创建，正在准备搜索队列。",
      },
      candidates: [],
      base_parameter_version_id: strategy.current_parameter_version_id,
      created_at: nowIso(),
      updated_at: nowIso(),
      completed_at: null,
    };

    return { job: queued, phase: 0 };
  }

  function materializeCompletedJob(
    job: ApiOptimizationJobDetail,
  ): ApiOptimizationJobDetail {
    const completed = createCompletedJob(strategy, run, job.id);
    return {
      ...completed,
      request: {
        ...completed.request,
        ...job.request,
        search_space: job.request.search_space?.length
          ? structuredClone(job.request.search_space)
          : completed.request.search_space,
      },
      summary: {
        ...completed.summary,
        ...job.summary,
        completed_combinations:
          job.request.budget_combinations ??
          completed.summary.completed_combinations,
        progress_pct: 100,
        current_stage: "优化完成",
        latest_update: "优化任务已完成。",
        status: "COMPLETED",
      },
      result: {
        ...completed.result,
        ...job.result,
        status: "COMPLETED",
        progress_pct: 100,
        current_stage: "优化完成",
        latest_update: "优化任务已完成。",
      },
      created_at: job.created_at ?? completed.created_at,
      updated_at: nowIso(),
      completed_at: nowIso(),
    };
  }

  function advanceJob(state: OptimizationJobState): ApiOptimizationJobDetail {
    const job = state.job;
    const status = String(job.status ?? "").toUpperCase();
    if (status === "INTERRUPTED" || status === "COMPLETED") {
      return cloneJob(job);
    }

    if (status === "QUEUED") {
      if (state.phase === 0) {
        state.phase = 1;
        return cloneJob(job);
      }
      if (state.phase === 1) {
        state.phase = 2;
        job.status = "RUNNING";
        job.updated_at = nowIso();
        job.summary = {
          ...job.summary,
          status: "RUNNING",
          progress_pct: 16,
          current_stage: "首轮搜索",
          latest_update: "正在收集首轮组合表现，结果中心会自动刷新。",
          completed_combinations: 11,
          latest_candidate_label: "候选方案 1",
        };
        job.result = {
          ...job.result,
          status: "RUNNING",
          progress_pct: 16,
          current_stage: "首轮搜索",
          latest_update: "正在收集首轮组合表现，结果中心会自动刷新。",
          summary: "正在收集首轮组合表现，结果中心会自动刷新。",
        };
        return cloneJob(job);
      }
      state.job = materializeCompletedJob(job);
      state.phase = 3;
      return cloneJob(state.job);
    }

    if (status === "RUNNING") {
      if (state.phase === 0) {
        state.phase = 1;
        return cloneJob(job);
      }
      state.job = materializeCompletedJob(job);
      state.phase = 2;
      return cloneJob(state.job);
    }

    return cloneJob(job);
  }

  function findJob(jobId: string): OptimizationJobState {
    const job = jobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }
    return job;
  }

  function updateStrategyForPromotion(
    jobId: string,
    applyVersionPromotion = false,
  ): void {
    strategy.latest_optimization_job_id = jobId;
    if (applyVersionPromotion) {
      strategy.current_parameter_version =
        (strategy.current_parameter_version ?? 1) + 1;
      strategy.current_parameter_version_id = `${strategy.id}-v${strategy.current_parameter_version}`;
      strategy.name = formatVersionedStrategyName(
        strategy.name,
        strategy.current_parameter_version,
      );
    }
  }

  function syncLatestOptimizationJob(): void {
    const orderedJobs = [...jobs.values()].sort((left, right) => {
      const leftTime = Date.parse(
        left.job.updated_at ??
          left.job.completed_at ??
          left.job.created_at ??
          "",
      );
      const rightTime = Date.parse(
        right.job.updated_at ??
          right.job.completed_at ??
          right.job.created_at ??
          "",
      );
      return rightTime - leftTime;
    });
    strategy.latest_optimization_job_id = orderedJobs[0]?.job.id ?? null;
  }

  return {
    async getWorkspaceOverview(): Promise<ApiWorkspaceOverview> {
      const orderedJobs = [...jobs.values()].sort((left, right) => {
        const leftTime = Date.parse(
          left.job.updated_at ??
            left.job.completed_at ??
            left.job.created_at ??
            "",
        );
        const rightTime = Date.parse(
          right.job.updated_at ??
            right.job.completed_at ??
            right.job.created_at ??
            "",
        );
        return rightTime - leftTime;
      });
      return {
        workspace_name: "Grit Strategy Lab",
        subtitle: "优化实验室前端测试",
        strategy_count: 1,
        active_run_count: 1,
        running_optimization_count: orderedJobs.filter((item) =>
          ["QUEUED", "RUNNING"].includes(String(item.job.status)),
        ).length,
        latest_strategy_id: strategy.id,
        latest_backtest_run_id: run.id,
        latest_optimization_job_id: orderedJobs[0]?.job.id ?? null,
        top_momentum_warning: "测试环境提示",
        quick_actions: ["open_optimization"],
      };
    },
    async listStrategies(): Promise<ApiStrategyDetail[]> {
      return [structuredClone(strategy)];
    },
    async getStrategyDetail(id: string): Promise<ApiStrategyDetail> {
      if (id !== strategy.id) {
        throw new Error(`Strategy ${id} not found`);
      }
      return structuredClone(strategy);
    },
    async getCreationSession(): Promise<never> {
      throw new Error("not implemented");
    },
    async createCreationSession(): Promise<never> {
      throw new Error("not implemented");
    },
    async appendCreationMessage(): Promise<never> {
      throw new Error("not implemented");
    },
    async prepareConfirmation(): Promise<never> {
      throw new Error("not implemented");
    },
    async updateConfirmation(): Promise<never> {
      throw new Error("not implemented");
    },
    async materializeStrategy(): Promise<never> {
      throw new Error("not implemented");
    },
    async listBacktestRuns(): Promise<never> {
      throw new Error("not implemented");
    },
    async getBacktestRunDetail(id: string): Promise<ApiBacktestRunDetail> {
      if (id !== run.id) {
        throw new Error(`Run ${id} not found`);
      }
      return structuredClone(run);
    },
    async saveBacktestRun(): Promise<ApiBacktestRunDetail> {
      return structuredClone(run);
    },
    async deleteBacktestRun(): Promise<{
      id: string;
      deleted_at: string;
      deleted_reason: string;
    }> {
      return {
        id: run.id,
        deleted_at: nowIso(),
        deleted_reason: "user_deleted",
      };
    },
    async getBacktestRunTrades(): Promise<never> {
      throw new Error("not implemented");
    },
    async getBacktestTradeAudit(): Promise<never> {
      throw new Error("not implemented");
    },
    async previewBacktestRun(): Promise<never> {
      throw new Error("not implemented");
    },
    async submitBacktestRun(): Promise<never> {
      throw new Error("not implemented");
    },
    async cloneBacktestRun(): Promise<never> {
      throw new Error("not implemented");
    },
    async resumeBacktestRun(id: string): Promise<ApiBacktestRunDetail> {
      if (id !== run.id) {
        throw new Error(`Run ${id} not found`);
      }
      return structuredClone(run);
    },
    async listOptimizationJobs(): Promise<ApiOptimizationJobListItem[]> {
      return [...jobs.values()]
        .map(({ job }) => buildOptimizationJobListItem(strategy, job))
        .sort((left, right) => {
          const leftTime = Date.parse(
            left.updated_at ?? left.completed_at ?? left.created_at ?? "",
          );
          const rightTime = Date.parse(
            right.updated_at ?? right.completed_at ?? right.created_at ?? "",
          );
          return rightTime - leftTime;
        });
    },
    async getOptimizationJobDetail(
      jobId: string,
    ): Promise<ApiOptimizationJobDetail> {
      return advanceJob(findJob(jobId));
    },
    async updateOptimizationJobConstraints(
      jobId: string,
      payload,
    ): Promise<ApiOptimizationJobDetail> {
      const state = findJob(jobId);
      if (String(state.job.status).toUpperCase() !== "COMPLETED") {
        throw new Error("Only completed optimization jobs can be re-filtered.");
      }
      return cloneJob(applyConstraintUpdateToJob(state.job, payload));
    },
    async saveOptimizationFilteredResult(
      jobId: string,
      payload,
    ): Promise<ApiOptimizationJobDetail> {
      const state = findJob(jobId);
      if (String(state.job.status).toUpperCase() !== "COMPLETED") {
        throw new Error("Only completed optimization jobs can be saved as a filtered result.");
      }
      createdJobCounter += 1;
      const savedJobId = `opt-saved-${createdJobCounter}`;
      const savedJob = {
        ...applyConstraintUpdateToJob(state.job, payload),
        id: savedJobId,
        created_at: nowIso(),
        updated_at: nowIso(),
        completed_at: nowIso(),
      };
      savedJob.request = {
        ...savedJob.request,
        source_optimization_job_id: jobId,
        entry_point: "saved_refilter_result",
      };
      jobs.set(savedJobId, {
        job: savedJob,
        phase: 0,
      });
      syncLatestOptimizationJob();
      return cloneJob(savedJob);
    },
    async deleteOptimizationJob(jobId: string) {
      findJob(jobId);
      jobs.delete(jobId);
      syncLatestOptimizationJob();
      return {
        id: jobId,
        deleted_at: nowIso(),
        deleted_reason: "user_deleted",
      };
    },
    async createOptimizationJob(
      strategyId: string,
      payload?: ApiOptimizationJobCreatePayload,
    ): Promise<ApiOptimizationJobDetail> {
      if (strategyId !== strategy.id) {
        throw new Error(`Strategy ${strategyId} not found`);
      }
      createdJobCounter += 1;
      const jobId = `opt-created-${createdJobCounter}`;
      const state = buildQueuedJob(jobId, payload);
      jobs.set(jobId, state);
      updateStrategyForPromotion(jobId);
      return cloneJob(state.job);
    },
    async resumeOptimizationJob(
      jobId: string,
    ): Promise<ApiOptimizationJobDetail> {
      const state = findJob(jobId);
      if (String(state.job.status).toUpperCase() !== "INTERRUPTED") {
        return cloneJob(state.job);
      }
      state.phase = 0;
      state.job = {
        ...state.job,
        status: "RUNNING",
        updated_at: nowIso(),
        summary: {
          ...state.job.summary,
          status: "RUNNING",
          latest_update: "已继续优化，正在从断点恢复。",
          current_stage: "断点恢复中",
          resume_ready: false,
        },
        result: {
          ...state.job.result,
          status: "RUNNING",
          latest_update: "已继续优化，正在从断点恢复。",
          current_stage: "断点恢复中",
        },
      };
      return cloneJob(state.job);
    },
    async createOptimizationCandidate(): Promise<never> {
      throw new Error("not implemented");
    },
    async promoteOptimizationCandidate(
      jobId: string,
    ): Promise<ApiOptimizationJobDetail> {
      const state = findJob(jobId);
      updateStrategyForPromotion(jobId, true);
      return cloneJob(state.job);
    },
    async deleteOptimizationCandidate(): Promise<never> {
      throw new Error("not implemented");
    },
    async getSnapshotOverview(): Promise<never> {
      throw new Error("not implemented");
    },
    async refreshSnapshots(): Promise<never> {
      throw new Error("not implemented");
    },
    async getPitDataOverview(): Promise<never> {
      throw new Error("因子测试接口未接入。");
    },
    async createPitResearchWaiver(): Promise<never> {
      throw new Error("因子测试接口未接入。");
    },
    async revokePitResearchWaiver(): Promise<never> {
      throw new Error("因子测试接口未接入。");
    },
    async applyPitIdentityOverride(): Promise<never> {
      throw new Error("因子测试接口未接入。");
    },
    async restartPitIdentityScraper(): Promise<never> {
      throw new Error("因子测试接口未接入。");
    },
    async listFactors(): Promise<never> {
      throw new Error("因子测试接口未接入。");
    },
    async createFactor(): Promise<never> {
      throw new Error("因子测试接口未接入。");
    },
    async getFactor(): Promise<never> {
      throw new Error("因子测试接口未接入。");
    },
    async runFactorDiagnostics(): Promise<never> {
      throw new Error("因子测试接口未接入。");
    },
    async previewFactorDiagnostics(): Promise<never> {
      throw new Error("因子测试接口未接入。");
    },
    async listFactorMiningJobs(): Promise<never> {
      throw new Error("因子测试接口未接入。");
    },
    async createFactorMiningJob(): Promise<never> {
      throw new Error("因子测试接口未接入。");
    },
    async getFactorMiningJob(): Promise<never> {
      throw new Error("因子测试接口未接入。");
    },
    async cancelFactorMiningJob(): Promise<never> {
      throw new Error("因子测试接口未接入。");
    },
    async previewFactorModel(): Promise<never> {
      throw new Error("因子测试接口未接入。");
    },
    async createFactorModel(): Promise<never> {
      throw new Error("因子测试接口未接入。");
    },
  };
}

function createZeroPassConstraintApi(): DemoApi {
  const api = createOptimizationTestApi();
  const originalGetOptimizationJobDetail =
    api.getOptimizationJobDetail.bind(api);
  let currentJob: ApiOptimizationJobDetail | null = null;

  async function ensureJob(jobId: string): Promise<ApiOptimizationJobDetail> {
    if (jobId !== "opt-001") {
      return originalGetOptimizationJobDetail(jobId);
    }
    if (!currentJob) {
      currentJob = await originalGetOptimizationJobDetail(jobId);
      const zeroPassConstraints = defaultConstraintPayload.constraints.map(
        (constraint) => {
          if (constraint.key === "max_drawdown_pct") {
            return {
              ...constraint,
              value: 5,
              baseline_value: 5,
            };
          }
          if (constraint.key === "stability") {
            return {
              ...constraint,
              value: 90,
              baseline_value: 90,
            };
          }
          return structuredClone(constraint);
        },
      );
      currentJob.request.constraint_preset_key = "defensive";
      currentJob.request.constraint_label = "稳健型（自定义）";
      currentJob.request.constraints = structuredClone(zeroPassConstraints);
      currentJob.summary.constraint_preset_key = "defensive";
      currentJob.summary.constraint_label = "稳健型（自定义）";
      currentJob.summary.constraints = structuredClone(zeroPassConstraints);
      currentJob.result.constraint_preset_key = "defensive";
      currentJob.result.constraint_label = "稳健型（自定义）";
      currentJob.result.constraints = structuredClone(zeroPassConstraints);
      currentJob.candidates = currentJob.candidates.map((candidate, index) => ({
        ...candidate,
        title: index === 0 ? "放宽后通过 1" : `暂未通过 ${index + 1}`,
        label: index === 0 ? "放宽后通过 1" : `暂未通过 ${index + 1}`,
        metrics: {
          ...candidate.metrics,
          annualized_return: 0.132 - index * 0.004,
          return_sharpe: index === 0 ? 1.12 : 1.07 - index * 0.03,
          out_of_sample_sharpe: index === 0 ? 0.92 : 0.88 - index * 0.05,
          max_drawdown_pct: -11.5 - index * 2.1,
          stability: 72 - index * 4,
          turnover: 8.6 + index * 0.4,
        },
      }));
      currentJob.result.best_candidate_id = currentJob.candidates[0]?.id ?? null;
      currentJob.result.best_candidate_label =
        currentJob.candidates[0]?.label ?? null;
      syncMatchingCombinationCount(currentJob);
    }
    return currentJob;
  }

  api.getOptimizationJobDetail = async (
    jobId: string,
  ): Promise<ApiOptimizationJobDetail> =>
    structuredClone(await ensureJob(jobId));

  api.updateOptimizationJobConstraints = async (
    jobId,
    payload,
  ): Promise<ApiOptimizationJobDetail> => {
    const job = await ensureJob(jobId);
    return structuredClone(applyConstraintUpdateToJob(job, payload));
  };

  return api;
}

function createBaselineOnlyPassApi(): OptimizationTestApi {
  const api = createOptimizationTestApi();
  const originalGetStrategyDetail = api.getStrategyDetail.bind(api);
  const originalGetBacktestRunDetail = api.getBacktestRunDetail.bind(api);
  const originalGetOptimizationJobDetail =
    api.getOptimizationJobDetail.bind(api);
  let currentJob: ApiOptimizationJobDetail | null = null;
  const requestedRunDetailViews: string[] = [];

  api.getStrategyDetail = async (id: string): Promise<ApiStrategyDetail> => {
    const strategy = await originalGetStrategyDetail(id);
    strategy.latest_completed_run_summary = {
      ...strategy.latest_completed_run_summary!,
      total_return: 39.163376141826205,
      annualized_return: 0.4767919577553905,
      sharpe: 1.3246162781781354,
      max_drawdown: -0.3953207278994667,
      oos_sharpe: 1.6475544195554235,
    };
    return strategy;
  };

  api.getBacktestRunDetail = async (
    id: string,
    request?: { view?: string } | AbortSignal,
  ): Promise<ApiBacktestRunDetail> => {
    const run = await originalGetBacktestRunDetail(id);
    const requestedView =
      request && typeof request === "object" && "view" in request
        ? request.view ?? "full"
        : "full";
    requestedRunDetailViews.push(String(requestedView));
    run.metrics = {
      ...run.metrics,
      total_return: 39.163376141826205,
      total_return_pct: 3916.3376141826205,
      annualized_return: 0.4767919577553905,
      return_sharpe: 1.3246162781781354,
      sharpe: 1.3246162781781354,
      out_of_sample_sharpe: 1.6475544195554235,
      oos_sharpe: 1.6475544195554235,
      max_drawdown: -0.3953207278994667,
      max_drawdown_pct: -39.53207278994667,
      turnover: 0.013,
      turnover_pct: 0.013,
    };
    run.consistency_score = {
      score: 0.4563299041838,
      positive_day_share: 0.5534,
    };
    if (requestedView === "metrics") {
      delete (run as Partial<ApiBacktestRunDetail>).consistency_score;
      delete (run as Partial<ApiBacktestRunDetail>).chart_series;
    }
    return run;
  };

  async function ensureJob(jobId: string): Promise<ApiOptimizationJobDetail> {
    if (jobId !== "opt-001") {
      return originalGetOptimizationJobDetail(jobId);
    }
    if (!currentJob) {
      currentJob = await originalGetOptimizationJobDetail(jobId);
      const currentComboFriendlyConstraints = [
        {
          key: "max_drawdown_pct",
          label: "最大回撤",
          category: "risk" as const,
          operator: "<=" as const,
          value: 50,
          baseline_value: 50,
          unit: "%",
          source: "manual" as const,
        },
        {
          key: "out_of_sample_sharpe",
          label: "样本外夏普",
          category: "stability" as const,
          operator: ">=" as const,
          value: 0.99,
          baseline_value: 0.99,
          unit: "",
          source: "manual" as const,
        },
        {
          key: "annualized_return",
          label: "年化收益率",
          category: "return" as const,
          operator: ">=" as const,
          value: 9.9,
          baseline_value: 9.9,
          unit: "%",
          source: "manual" as const,
        },
        {
          key: "stability",
          label: "稳定度",
          category: "stability" as const,
          operator: ">=" as const,
          value: 3,
          baseline_value: 3,
          unit: "pts",
          source: "manual" as const,
        },
        {
          key: "return_sharpe",
          label: "收益夏普",
          category: "return" as const,
          operator: ">=" as const,
          value: 0.1,
          baseline_value: 0.1,
          unit: "",
          source: "manual" as const,
        },
      ];
      currentJob.request.constraint_preset_key = "defensive";
      currentJob.request.constraint_label = "稳健型（自定义）";
      currentJob.request.constraints = structuredClone(currentComboFriendlyConstraints);
      currentJob.summary.constraint_preset_key = "defensive";
      currentJob.summary.constraint_label = "稳健型（自定义）";
      currentJob.summary.constraints = structuredClone(currentComboFriendlyConstraints);
      currentJob.result.constraint_preset_key = "defensive";
      currentJob.result.constraint_label = "稳健型（自定义）";
      currentJob.result.constraints = structuredClone(currentComboFriendlyConstraints);
      currentJob.candidates = currentJob.candidates.map((candidate, index) => ({
        ...candidate,
        title: `未通过 ${index + 1}`,
        label: `未通过 ${index + 1}`,
        metrics: {
          ...candidate.metrics,
          annualized_return: 0.11 - index * 0.004,
          return_sharpe: 0.92 - index * 0.03,
          out_of_sample_sharpe: 0.88 - index * 0.04,
          max_drawdown_pct: -55 - index * 3,
          stability: 2 - index,
          turnover: 72 + index * 4,
        },
      }));
      syncMatchingCombinationCount(currentJob);
    }
    return currentJob;
  }

  api.getOptimizationJobDetail = async (
    jobId: string,
  ): Promise<ApiOptimizationJobDetail> =>
    structuredClone(await ensureJob(jobId));

  api.updateOptimizationJobConstraints = async (
    jobId,
    payload,
  ): Promise<ApiOptimizationJobDetail> => {
    const job = await ensureJob(jobId);
    return structuredClone(applyConstraintUpdateToJob(job, payload));
  };

  return Object.assign(api, {
    __requestedRunDetailViews: requestedRunDetailViews,
  }) as OptimizationTestApi;
}

function createFullMatchingCombinationRefilterApi(): DemoApi {
  const api = createOptimizationTestApi();
  const originalGetOptimizationJobDetail =
    api.getOptimizationJobDetail.bind(api);
  let currentJob: ApiOptimizationJobDetail | null = null;

  async function ensureJob(jobId: string): Promise<ApiOptimizationJobDetail> {
    if (jobId !== "opt-001") {
      return originalGetOptimizationJobDetail(jobId);
    }
    if (!currentJob) {
      currentJob = await originalGetOptimizationJobDetail(jobId);
      const liveLikeConstraints = defaultConstraintPayload.constraints.map(
        (constraint) => {
          if (constraint.key === "max_drawdown_pct") {
            return {
              ...constraint,
              value: 25,
              baseline_value: 25,
              source: "manual" as const,
            };
          }
          return {
            ...constraint,
            value: 0,
            baseline_value: 0,
            source: "manual" as const,
          };
        },
      );
      currentJob.request.constraint_preset_key = "balanced";
      currentJob.request.constraint_label = "平衡型（自定义）";
      currentJob.request.constraints = structuredClone(liveLikeConstraints);
      currentJob.summary.constraint_preset_key = "balanced";
      currentJob.summary.constraint_label = "平衡型（自定义）";
      currentJob.summary.constraints = structuredClone(liveLikeConstraints);
      currentJob.result.constraint_preset_key = "balanced";
      currentJob.result.constraint_label = "平衡型（自定义）";
      currentJob.result.constraints = structuredClone(liveLikeConstraints);
      currentJob.candidates = currentJob.candidates.map((candidate, index) => ({
        ...candidate,
        title: `当前候选 ${index + 1}`,
        label: `当前候选 ${index + 1}`,
        summary: `当前候选 ${index + 1}`,
        metrics: {
          ...candidate.metrics,
          annualized_return: 0.11 - index * 0.004,
          return_sharpe: 0.92 - index * 0.03,
          out_of_sample_sharpe: 0.88 - index * 0.04,
          max_drawdown_pct: -8 - index * 0.6,
          stability: 10 + index,
        },
      }));

      const seedCandidate = currentJob.candidates[0];
      if (!seedCandidate) {
        throw new Error("missing seed candidate");
      }
      const combinations = Array.from({ length: 30 }, (_, index) => {
        const drawdownPct =
          index < 15 ? (index % 3 === 0 ? -2 : -1.9) : -4.5 - index * 0.1;
        return {
          ...structuredClone(seedCandidate),
          id: `trial-tight-${index + 1}`,
          label: `Trial ${2002 + index}`,
          title: `Trial ${2002 + index}`,
          rank: index + 1,
          summary: `最大回撤 ${drawdownPct.toFixed(1)}%`,
          metrics: {
            ...seedCandidate.metrics,
            annualized_return: Number((0.018 - index * 0.0002).toFixed(4)),
            return_sharpe: Number((0.16 - index * 0.0015).toFixed(3)),
            out_of_sample_sharpe: Number((0.84 - index * 0.001).toFixed(3)),
            max_drawdown_pct: Number(drawdownPct.toFixed(1)),
            stability: 12 + (index % 4),
          },
          analysis: {},
        };
      });

      currentJob = setMatchingCombinations(currentJob, combinations);
      currentJob.summary.matching_combination_source = "all_trials";
      currentJob.matching_combination_source = "all_trials";
    }
    return currentJob;
  }

  api.getOptimizationJobDetail = async (
    jobId: string,
  ): Promise<ApiOptimizationJobDetail> =>
    structuredClone(await ensureJob(jobId));

  api.updateOptimizationJobConstraints = async (
    jobId,
    payload,
  ): Promise<ApiOptimizationJobDetail> => {
    const job = await ensureJob(jobId);
    const preview = applyConstraintUpdateToJob(job, payload);
    preview.summary.matching_combination_source = "all_trials";
    preview.matching_combination_source = "all_trials";
    return structuredClone(preview);
  };

  return api;
}

function createObjectiveSortingApi(): DemoApi {
  const api = createOptimizationTestApi();
  const originalGetOptimizationJobDetail =
    api.getOptimizationJobDetail.bind(api);
  let currentJob: ApiOptimizationJobDetail | null = null;

  const keepPassingObjectiveCandidates = (
    job: ApiOptimizationJobDetail,
  ): ApiOptimizationJobDetail =>
    setMatchingCombinations(
      job,
      job.candidates.filter((candidate) =>
        ["夏普第一", "收益第一", "得分第一"].includes(candidate.label ?? ""),
      ),
    );

  async function ensureJob(jobId: string): Promise<ApiOptimizationJobDetail> {
    if (jobId !== "opt-001") {
      return originalGetOptimizationJobDetail(jobId);
    }
    if (!currentJob) {
      currentJob = await originalGetOptimizationJobDetail(jobId);
      currentJob.request.objective = "return_sharpe";
      currentJob.summary.objective = "return_sharpe";
      currentJob.candidates = currentJob.candidates.map((candidate, index) => {
        if (
          candidate.label === "当前组合" ||
          candidate.title === "当前组合" ||
          candidate.summary === "当前基准"
        ) {
          return candidate;
        }
        if (index === 0) {
          return {
            ...candidate,
            label: "夏普第一",
            title: "夏普第一",
            score: 96,
            metrics: {
              ...candidate.metrics,
              annualized_return: 0.12,
              return_sharpe: 1.4,
              out_of_sample_sharpe: 0.96,
              max_drawdown_pct: -14.0,
              stability: 81,
            },
          };
        }
        if (index === 1) {
          return {
            ...candidate,
            label: "收益第一",
            title: "收益第一",
            score: 94,
            metrics: {
              ...candidate.metrics,
              annualized_return: 0.16,
              return_sharpe: 1.15,
              out_of_sample_sharpe: 0.95,
              max_drawdown_pct: -13.6,
              stability: 82,
            },
          };
        }
        if (index === 2) {
          return {
            ...candidate,
            label: "得分第一",
            title: "得分第一",
            score: 99,
            metrics: {
              ...candidate.metrics,
              annualized_return: 0.13,
              return_sharpe: 1.18,
              out_of_sample_sharpe: 0.97,
              max_drawdown_pct: -12.9,
              stability: 84,
            },
          };
        }
        return {
          ...candidate,
          label: `未通过 ${index + 1}`,
          title: `未通过 ${index + 1}`,
          score: 88 - index,
          metrics: {
            ...candidate.metrics,
            annualized_return: 0.07,
            return_sharpe: 0.88,
            out_of_sample_sharpe: 0.74,
            max_drawdown_pct: -26.0,
            stability: 60,
          },
        };
      });
      currentJob = applyConstraintUpdateToJob(currentJob, {
        objective: "return_sharpe",
      });
      currentJob = keepPassingObjectiveCandidates(currentJob);
    }
    return currentJob;
  }

  api.getOptimizationJobDetail = async (
    jobId: string,
  ): Promise<ApiOptimizationJobDetail> =>
    structuredClone(await ensureJob(jobId));

  api.updateOptimizationJobConstraints = async (
    jobId,
    payload,
  ): Promise<ApiOptimizationJobDetail> => {
    const job = await ensureJob(jobId);
    return structuredClone(
      keepPassingObjectiveCandidates(applyConstraintUpdateToJob(job, payload)),
    );
  };

  return api;
}

function createLargeCombinationModalApi(): DemoApi {
  const api = createOptimizationTestApi();
  const originalGetOptimizationJobDetail =
    api.getOptimizationJobDetail.bind(api);
  let currentJob: ApiOptimizationJobDetail | null = null;

  async function ensureJob(jobId: string): Promise<ApiOptimizationJobDetail> {
    if (jobId !== "opt-001") {
      return originalGetOptimizationJobDetail(jobId);
    }
    if (!currentJob) {
      currentJob = await originalGetOptimizationJobDetail(jobId);
      const baselineCandidate = currentJob.candidates[0];
      if (!baselineCandidate) {
        throw new Error("missing baseline candidate");
      }
      const combinations = Array.from({ length: 145 }, (_, index) => ({
        ...structuredClone(baselineCandidate),
        id: `combo-${index + 1}`,
        label: `组合 ${String(index + 1).padStart(3, "0")}`,
        title: `组合 ${String(index + 1).padStart(3, "0")}`,
        rank: index + 1,
        score: Number((98 - index * 0.11).toFixed(3)),
        metrics: {
          ...baselineCandidate.metrics,
          annualized_return: Number((0.18 - index * 0.0006).toFixed(4)),
          return_sharpe: Number((1.8 - index * 0.008).toFixed(3)),
          out_of_sample_sharpe: Number((1.2 - index * 0.004).toFixed(3)),
          max_drawdown_pct: Number((-8.5 - index * 0.12).toFixed(1)),
          stability: 92 - (index % 18),
        },
        parameter_snapshot: {
          ...baselineCandidate.parameter_snapshot,
          lookback_months: 6 + (index % 12),
          skip_recent_months: 1 + (index % 4),
          top_n: 10 + (index % 9) * 10,
          hold_rank_threshold: 110 + (index % 3) * 10,
        },
      }));
      currentJob = setMatchingCombinations(currentJob, combinations);
    }
    return currentJob;
  }

  api.getOptimizationJobDetail = async (
    jobId: string,
  ): Promise<ApiOptimizationJobDetail> =>
    structuredClone(await ensureJob(jobId));

  return api;
}

async function renderApp(hash: string): Promise<HTMLElement> {
  let container: HTMLElement | null = null;
  await act(async () => {
    window.location.hash = hash;
    ({ container } = render(<App />));
  });
  return container!;
}

beforeEach(() => {
  currentApi = createOptimizationTestApi();
});

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("optimization module flow", () => {
  it("navigates from jobs to select, config, and results", async () => {
    const container = await renderApp("#/optimization-jobs");

    await waitFor(() =>
      expect(container.querySelector(".optimization-lab-page")).not.toBeNull(),
    );
    expect(container.querySelector(".optimization-steps")).toBeNull();

    const createButton = container.querySelector(
      ".optimization-lab-panel--header .primary-button",
    ) as HTMLButtonElement | null;
    expect(createButton).toBeTruthy();
    fireEvent.click(createButton!);

    await waitFor(() =>
      expect(window.location.hash).toBe("#/optimization-jobs/new"),
    );

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-lab-panel__heading h2"),
      ).toBeTruthy(),
    );
    const selectButton = container.querySelector(
      "tbody tr:first-child td:last-child button",
    ) as HTMLButtonElement | null;
    expect(selectButton).toBeTruthy();
    fireEvent.click(selectButton!);

    await waitFor(() =>
      expect(window.location.hash).toMatch(
        /^#\/optimization-jobs\/new\/config\?strategy_id=strat-001/,
      ),
    );
    await waitFor(() =>
      expect(
        container.querySelector(".optimization-config-grid"),
      ).not.toBeNull(),
    );

    const startButton = container.querySelector(
      ".optimization-hero-actions .primary-button",
    ) as HTMLButtonElement | null;
    expect(startButton).toBeTruthy();
    fireEvent.click(startButton!);

    await waitFor(() =>
      expect(window.location.hash).toMatch(
        /^#\/optimization-jobs\/opt-created-/,
      ),
    );
    await waitFor(() =>
      expect(
        container.querySelector(".optimization-progress-panel"),
      ).not.toBeNull(),
    );
    expect(container.querySelector(".optimization-results-grid")).toBeNull();
    expect(container.textContent).toContain("等待首批样本");
    await waitFor(
      () =>
        expect(
          container.querySelector(".optimization-results-grid"),
        ).not.toBeNull(),
      { timeout: 4000 },
    );
  });

  it("renders select page from latest run summary without fetching run detail", async () => {
    const selectApi = createOptimizationTestApi();
    const originalListStrategies = selectApi.listStrategies.bind(selectApi);
    selectApi.listStrategies = async () => {
      const strategies = await originalListStrategies();
      return strategies.map((strategy) => ({
        ...strategy,
        latest_completed_run_summary: {
          run_id: "bt-001",
          parameter_version: 1,
          parameter_version_id: "strat-001-v1",
          status: "COMPLETED",
          total_return: 0.18,
          annualized_return: 0.124,
          sharpe: 1.18,
          max_drawdown: -0.064,
          oos_total_return: 0.09,
          oos_annualized_return: 0.098,
          oos_sharpe: 0.87,
          oos_max_drawdown: -0.052,
          warning_count: 0,
          execution_policy: "T_CLOSE_TO_T1_OPEN",
          dataset_snapshot_id: "ds-001",
          universe_snapshot_id: "un-001",
          completed_at: nowIso(),
          sparkline_points: [],
        },
      }));
    };
    selectApi.getBacktestRunDetail = async (): Promise<ApiBacktestRunDetail> => {
      throw new Error("select page should not fetch run detail");
    };
    currentApi = selectApi;

    const container = await renderApp("#/optimization-jobs/new");

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-lab-panel__heading h2"),
      ).toBeTruthy(),
    );

    expect(container.textContent).toContain("标普动量策略");
    expect(container.textContent).toContain("1.18");
    expect(container.textContent).toContain("-6.4%");
    expect(container.textContent).toContain("+18.0%");
    expect(container.textContent).not.toContain(
      "select page should not fetch run detail",
    );
  });

  it("removes the entry column and deletes a job after modal confirmation", async () => {
    const container = await renderApp("#/optimization-jobs");

    await waitFor(() =>
      expect(container.querySelector(".optimization-lab-table")).not.toBeNull(),
    );
    const headerTexts = Array.from(container.querySelectorAll("thead th")).map(
      (cell) => cell.textContent?.trim(),
    );
    expect(headerTexts).not.toContain("入口");
    expect(headerTexts).toContain("操作");

    const targetRow = Array.from(container.querySelectorAll("tbody tr")).find(
      (row) => row.textContent?.includes("opt-001"),
    );
    expect(targetRow).toBeTruthy();

    const deleteButton = targetRow?.querySelector(
      ".optimization-jobs-table__delete",
    ) as HTMLButtonElement | null;
    expect(deleteButton).toBeTruthy();
    fireEvent.click(deleteButton!);

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-jobs-delete-dialog"),
      ).not.toBeNull(),
    );
    expect(container.textContent).toContain("删除优化任务");
    expect(container.textContent).toContain("确认删除任务 opt-001 吗？");

    const confirmButton = container.querySelector(
      ".optimization-jobs-delete-dialog .optimization-jobs-delete-dialog__confirm",
    ) as HTMLButtonElement | null;
    expect(confirmButton).toBeTruthy();
    fireEvent.click(confirmButton!);

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-jobs-delete-dialog"),
      ).toBeNull(),
    );
    expect(container.textContent).not.toContain("opt-001");
  });

  it("renders the strategy version tag next to the strategy name on the jobs list", async () => {
    const container = await renderApp("#/optimization-jobs");

    await waitFor(() =>
      expect(container.querySelector(".optimization-lab-table")).not.toBeNull(),
    );

    const targetRow = Array.from(container.querySelectorAll("tbody tr")).find(
      (row) => row.textContent?.includes("opt-001"),
    );
    expect(targetRow).toBeTruthy();

    const strategyCell = targetRow?.querySelector("td:nth-child(2)");
    expect(strategyCell?.textContent).toContain("标普动量策略");
    expect(
      strategyCell?.querySelector(".optimization-jobs-table__strategy-version")
        ?.textContent,
    ).toBe("v1");
  });

  it("shows interrupted progress and a continue button without rendering result grids", async () => {
    const container = await renderApp("#/optimization-jobs/opt-interrupted");

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-progress-panel"),
      ).not.toBeNull(),
    );
    expect(container.querySelector(".optimization-results-grid")).toBeNull();
    expect(
      container.querySelector(".optimization-results-bottom-grid"),
    ).toBeNull();
    expect(container.querySelector(".optimization-shelf-grid")).toBeNull();
    expect(container.textContent).toContain("优化已中断");
    expect(container.textContent).toContain("继续优化");
    expect(container.textContent).toContain("14 分钟");
  });

  it("applies roomier spacing inside the in-progress panel", async () => {
    const container = await renderApp("#/optimization-jobs/opt-interrupted");

    const progressPanel = await waitFor(() => {
      const element = container.querySelector(".optimization-progress-panel") as HTMLElement | null;
      expect(element).not.toBeNull();
      return element!;
    });
    const metricTile = progressPanel.querySelector(
      ".optimization-metric-tile",
    ) as HTMLElement | null;
    const metricValue = metricTile?.querySelector("strong") as HTMLElement | null;
    const summaryRows = progressPanel.querySelectorAll(
      ".optimization-summary-row",
    );
    const middleSummaryRow = summaryRows[1] as HTMLElement | undefined;
    const summaryValue = middleSummaryRow?.querySelector(
      "strong",
    ) as HTMLElement | null;

    expect(metricTile).toBeTruthy();
    expect(metricValue).toBeTruthy();
    expect(middleSummaryRow).toBeTruthy();
    expect(summaryValue).toBeTruthy();

    expect(getComputedStyle(progressPanel).gap).toBe("22px");
    expect(getComputedStyle(metricTile!).paddingTop).toBe("16px");
    expect(getComputedStyle(metricTile!).gap).toBe("10px");
    expect(
      getComputedStyle(metricValue!).whiteSpace || metricValue!.style.whiteSpace,
    ).toBe("normal");
    expect(
      getComputedStyle(metricValue!).overflowWrap || metricValue!.style.overflowWrap,
    ).toBe("anywhere");
    expect(getComputedStyle(middleSummaryRow!).display).toBe("grid");
    expect(getComputedStyle(middleSummaryRow!).paddingTop).toBe("14px");
    expect(getComputedStyle(summaryValue!).textAlign).toBe("left");
    expect(getComputedStyle(summaryValue!).lineHeight).not.toBe("normal");
  });

  it("continues an interrupted job and resumes polling until completion", async () => {
    const container = await renderApp("#/optimization-jobs/opt-interrupted");

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-progress-panel"),
      ).not.toBeNull(),
    );
    const continueButton = container.querySelector(
      ".optimization-hero-actions .primary-button",
    ) as HTMLButtonElement | null;
    expect(continueButton).toBeTruthy();
    fireEvent.click(continueButton!);

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-progress-panel"),
      ).not.toBeNull(),
    );
    expect(container.querySelector(".optimization-results-grid")).toBeNull();

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-results-grid"),
      ).not.toBeNull(),
      { timeout: 4000 },
    );
    expect(container.querySelector(".optimization-progress-panel")).toBeNull();
    expect(
      container.querySelectorAll(".optimization-results-grid tbody tr").length,
    ).toBeGreaterThan(0);
    expect(
      Array.from(
        container.querySelectorAll(".optimization-hero-actions button"),
      ).map((button) => button.textContent?.trim()),
    ).toEqual(expect.arrayContaining(["继续调参", "晋升当前版本"]));
  });

  it("syncs the stability center and shelf when selecting a different candidate", async () => {
    const multiCandidateApi = createOptimizationTestApi();
    const originalGetOptimizationJobDetail =
      multiCandidateApi.getOptimizationJobDetail.bind(multiCandidateApi);
    multiCandidateApi.getOptimizationJobDetail = async (jobId: string) => {
      const job = await originalGetOptimizationJobDetail(jobId);
      const decorateCandidate = (
        candidate: ApiOptimizationCandidate,
        index: number,
      ): ApiOptimizationCandidate => ({
        ...candidate,
        title: `合规候选 ${index + 1}`,
        label: `合规候选 ${index + 1}`,
        metrics: {
          ...candidate.metrics,
          annualized_return: 0.142 + index * 0.006,
          return_sharpe: 1.14 + index * 0.03,
          out_of_sample_sharpe: 0.95 + index * 0.02,
          max_drawdown_pct: -12.4 - index * 0.8,
          stability: 76 + index * 2,
          turnover: 8.4 + index * 0.2,
        },
      });
      job.candidates = job.candidates.map(decorateCandidate);
      job.matching_combinations = job.matching_combinations?.map(
        decorateCandidate,
      );
      job.summary.matching_combination_count = 23;
      job.matching_combination_count = 23;
      job.result.best_candidate_id = job.candidates[0]?.id ?? null;
      job.result.best_candidate_label = job.candidates[0]?.label ?? null;
      return job;
    };
    currentApi = multiCandidateApi;

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-results-grid"),
      ).not.toBeNull(),
    );
    const title = container.querySelector(
      ".optimization-lab-panel--hero h1",
    ) as HTMLHeadingElement | null;
    expect(title).toBeTruthy();
    expect(title?.textContent).toContain("参数优化：");
    const subtitle = container.querySelector(
      ".optimization-lab-panel--hero p:not(.optimization-lab-eyebrow)",
    ) as HTMLParagraphElement | null;
    expect(subtitle?.textContent).toContain("优化组合共 70个，耗时 0分钟");
    const parameterSummary = container.querySelector(
      ".optimization-parameter-summary",
    ) as HTMLElement | null;
    expect(parameterSummary).toBeTruthy();
    expect(
      parameterSummary?.querySelectorAll(
        ".optimization-parameter-summary__line",
      ).length,
    ).toBeGreaterThan(0);
    expect(parameterSummary?.textContent).not.toContain("equal_weight");
    expect(
      container.querySelector(".optimization-parameter-chip-list"),
    ).toBeTruthy();
    expect(container.querySelector(".optimization-check-list")).toBeNull();
    expect(
      container.querySelectorAll(".optimization-heatmap-cell").length,
    ).toBeGreaterThan(1);
    expect(container.textContent).toContain("窗口 A 为样本外起始验证窗口");
    expect(container.textContent).toContain("年化收益率");
    expect(container.textContent).toContain("综合评价");
    expect(container.textContent).toContain(
      "符合约束条件的组合共23个，以下按 收益夏普 Max 输出当前候选版本排序。",
    );
    expect(container.textContent).toContain("按不同市场窗口复核策略表现");
    expect(container.textContent).toContain("训练早段 至 训练早段");
    expect(
      (
        container.querySelector(
          "#optimization-results-objective",
        ) as HTMLSelectElement | null
      )?.value,
    ).toBe("return_sharpe");
    expect(
      container.querySelector(".optimization-mini-metric-strip"),
    ).toBeNull();
    expect(
      container.querySelector(
        ".optimization-results-card--rail .optimization-lab-panel__heading .status-chip",
      ),
    ).toBeNull();
    expect(
      container.querySelector(
        ".optimization-results-card--rail .optimization-evaluation-panel__headline span",
      ),
    ).toBeTruthy();
    const initialMetricRowText = container.querySelector(
      ".optimization-metric-row",
    )?.textContent;
    const initialActiveShelfCard = container.querySelector(
      ".optimization-shelf-card--active",
    ) as HTMLButtonElement | null;
    const initialActiveShelfText = initialActiveShelfCard?.textContent;
    const chips = container.querySelector(
      ".optimization-meta-chips",
    ) as HTMLElement | null;
    expect(chips?.textContent).toContain("任务编号：");
    expect(chips?.textContent).toContain(
      "参数组合：回看(月)6-12；跳过最近(月)1-4；买入排名阈值10-100；保留排名阈值110-130",
    );
    expect(chips?.textContent).not.toContain("平衡型");
    expect(chips?.textContent).not.toContain("策略：");
    expect(chips?.textContent).not.toContain("参数优化：");

    const rows = container.querySelectorAll(
      ".optimization-results-grid tbody tr",
    );
    expect(rows).toHaveLength(4);
    const baselineRow = rows[rows.length - 1] as HTMLTableRowElement;
    expect(baselineRow.textContent).toContain("当前组合");
    expect(baselineRow.children[1]?.querySelector("span")).toBeNull();
    fireEvent.click(rows[1] as HTMLTableRowElement);

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-metric-row")?.textContent,
      ).not.toBe(initialMetricRowText),
    );
    const activeShelfCard = container.querySelector(
      ".optimization-shelf-card--active",
    ) as HTMLButtonElement | null;
    expect(activeShelfCard).toBeTruthy();
    expect(activeShelfCard?.textContent).not.toBe(initialActiveShelfText);
  });

  it("uses active execution seconds for the completed-job hero duration", async () => {
    const api = createOptimizationTestApi();
    const originalGetOptimizationJobDetail =
      api.getOptimizationJobDetail.bind(api);
    api.getOptimizationJobDetail = async (jobId: string) => {
      const job = await originalGetOptimizationJobDetail(jobId);
      job.created_at = "2026-05-15T08:00:00.000Z";
      job.updated_at = "2026-05-18T08:00:00.000Z";
      job.completed_at = "2026-05-18T08:00:00.000Z";
      job.summary.active_execution_seconds = 125;
      job.result.active_execution_seconds = 125;
      return job;
    };
    currentApi = api;

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-results-grid"),
      ).not.toBeNull(),
    );
    const subtitle = container.querySelector(
      ".optimization-lab-panel--hero p:not(.optimization-lab-eyebrow)",
    ) as HTMLParagraphElement | null;
    expect(subtitle?.textContent).toContain("优化组合共 70个，耗时 2分钟");
    expect(subtitle?.textContent).not.toContain("4320分钟");
  });

  it("shows discrete observation timeframe values in parameter combination summaries", async () => {
    const observationTimeframeApi = createOptimizationTestApi();
    const originalGetOptimizationJobDetail =
      observationTimeframeApi.getOptimizationJobDetail.bind(
        observationTimeframeApi,
      );
    observationTimeframeApi.getOptimizationJobDetail = async (
      jobId: string,
    ) => {
      const job = await originalGetOptimizationJobDetail(jobId);
      const observationField: ApiOptimizationSearchSpaceField = {
        key: "observation_timeframe",
        label: "观察周期",
        mode: "discrete",
        current: "daily",
        value: "daily",
        values: ["daily", "weekly", "monthly"],
        tag: "主搜索维度",
      };
      const searchSpace = [
        observationField,
        ...(job.request.search_space ?? []),
      ];
      job.request.search_space = structuredClone(searchSpace);
      job.summary.search_space = structuredClone(searchSpace);
      const candidateTemplate = job.candidates[0];
      if (!candidateTemplate) {
        throw new Error("missing optimization candidate template");
      }
      const observationCandidates = ["daily", "weekly", "monthly"].map(
        (timeframe, index) => ({
          ...structuredClone(candidateTemplate),
          id: `obs-${index + 1}`,
          rank: index + 1,
          title: `观察周期候选 ${index + 1}`,
          label: `观察周期候选 ${index + 1}`,
          parameter_snapshot: {
            ...candidateTemplate.parameter_snapshot,
            observation_timeframe: timeframe,
          },
        }),
      );
      job.candidates = observationCandidates;
      job.result.best_candidate_id = job.candidates[0]?.id ?? null;
      job.result.best_candidate_label = job.candidates[0]?.label ?? null;
      setMatchingCombinations(job, observationCandidates);
      return job;
    };
    currentApi = observationTimeframeApi;

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-results-grid"),
      ).not.toBeNull(),
    );
    const chips = container.querySelector(
      ".optimization-meta-chips",
    ) as HTMLElement | null;
    expect(chips?.textContent).toContain(
      "参数组合：观察周期每日/每周/每月；回看(月)6-12；跳过最近(月)1-4；买入排名阈值10-100；保留排名阈值110-130",
    );
    expect(container.textContent).toContain("观察周期：每日");
    expect(container.textContent).toContain("观察周期：每周");
    expect(container.textContent).toContain("观察周期：每月");

    const openButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("查看全部组合"),
    ) as HTMLButtonElement | undefined;
    expect(openButton).toBeTruthy();

    fireEvent.click(openButton!);

    const dialog = await waitFor(() => {
      const element = container.querySelector(
        ".optimization-all-combinations-dialog",
      ) as HTMLElement | null;
      expect(element).not.toBeNull();
      return element!;
    });
    expect(dialog.textContent).toContain("观察周期 每日");
    expect(dialog.textContent).toContain("观察周期 每周");
    expect(dialog.textContent).toContain("观察周期 每月");
  });

  it("reuses the candidate scoring model for the current combination baseline", async () => {
    const baselineApi = createBaselineOnlyPassApi();
    currentApi = baselineApi;

    const container = await renderApp("#/optimization-jobs/opt-001");

    const rows = await waitFor(() => {
      const elements = container.querySelectorAll(".optimization-results-grid tbody tr");
      expect(elements.length).toBeGreaterThan(0);
      return elements;
    });
    const baselineRow = rows[rows.length - 1] as HTMLTableRowElement;
    fireEvent.click(baselineRow);

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-evaluation-panel__headline strong")
          ?.textContent,
      ).toContain("综合得分 99.949"),
    );

    expect(container.querySelector(".optimization-metric-row")?.textContent).toContain(
      "稳定度46",
    );
    expect(baselineApi.__requestedRunDetailViews).toContain("initial");
  });

  it("renders quick-filter constraints in the corrected order for legacy-saved jobs", async () => {
    const legacyOrderApi = createOptimizationTestApi();
    const originalGetOptimizationJobDetail =
      legacyOrderApi.getOptimizationJobDetail.bind(legacyOrderApi);

    legacyOrderApi.getOptimizationJobDetail = async (
      jobId: string,
    ): Promise<ApiOptimizationJobDetail> => {
      const job = await originalGetOptimizationJobDetail(jobId);
      const legacyConstraintKeys = [
        "max_drawdown_pct",
        "out_of_sample_sharpe",
        "annualized_return",
        "stability",
        "return_sharpe",
      ] as const;
      const constraintByKey = new Map(
        (job.summary.constraints ?? []).map((constraint) => [
          constraint.key,
          constraint,
        ]),
      );
      const legacyConstraints = legacyConstraintKeys
        .map((key) => constraintByKey.get(key))
        .filter(
          (
            constraint,
          ): constraint is NonNullable<ApiOptimizationJobDetail["summary"]["constraints"]>[number] =>
            Boolean(constraint),
        )
        .map((constraint) => structuredClone(constraint));

      job.request.constraints = structuredClone(legacyConstraints);
      job.summary.constraints = structuredClone(legacyConstraints);
      job.result.constraints = structuredClone(legacyConstraints);
      return job;
    };

    currentApi = legacyOrderApi;

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(
        container.querySelector("#optimization-results-constraint-return_sharpe"),
      ).not.toBeNull(),
    );

    const labels = Array.from(
      container.querySelectorAll(
        ".optimization-results-constraint-pill:not(.optimization-results-constraint-pill--objective) .optimization-results-constraint-pill__label",
      ),
    )
      .map((label) => label.textContent?.trim())
      .filter((label): label is string => Boolean(label));

    expect(labels).toEqual([
      "最大回撤",
      "收益夏普",
      "年化收益率",
      "稳定度",
      "样本外夏普",
    ]);
  });

  it("keeps cleared quick-filter inputs blank instead of coercing them to 0", async () => {
    currentApi = createOptimizationTestApi();

    const container = await renderApp("#/optimization-jobs/opt-001");

    const returnSharpeInput = await waitFor(() => {
      const element = container.querySelector(
        "#optimization-results-constraint-return_sharpe",
      ) as HTMLInputElement | null;
      expect(element).not.toBeNull();
      return element!;
    });
    const initialValue = returnSharpeInput.value;

    fireEvent.focus(returnSharpeInput);
    fireEvent.change(returnSharpeInput, { target: { value: "" } });

    expect(returnSharpeInput.value).toBe("");
    expect(returnSharpeInput.value).not.toBe("0");

    fireEvent.blur(returnSharpeInput);

    await waitFor(() => expect(returnSharpeInput.value).toBe(initialValue));
  });

  it("re-ranks candidates by annualized return when re-filtering", async () => {
    currentApi = createObjectiveSortingApi();

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(container.querySelector(".optimization-results-grid")).not.toBeNull(),
    );

    const objectiveSelect = container.querySelector(
      "#optimization-results-objective",
    ) as HTMLSelectElement | null;
    const firstCandidateLabel = () =>
      (
        container.querySelector(
          ".optimization-results-grid tbody tr:first-child",
        ) as HTMLTableRowElement | null
      )?.textContent ?? "";
    const refilterButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("重新过滤")) as
      | HTMLButtonElement
      | undefined;

    expect(objectiveSelect?.value).toBe("return_sharpe");
    expect(firstCandidateLabel()).toContain("夏普第一");
    expect(refilterButton).toBeTruthy();

    fireEvent.change(objectiveSelect!, {
      target: { value: "annualized_return" },
    });
    fireEvent.click(refilterButton!);

    await waitFor(() => {
      expect(objectiveSelect?.value).toBe("annualized_return");
      expect(firstCandidateLabel()).toContain("收益第一");
      expect(container.textContent).toContain(
        "符合约束条件的组合共3个，以下按 年化收益率 Max 输出当前候选版本排序。",
      );
    });
  });

  it("keeps the source snapshot unchanged until saving the re-filtered result as a new job", async () => {
    const saveApi = createObjectiveSortingApi();
    const sourceBefore = await saveApi.getOptimizationJobDetail("opt-001");
    const originalSaveFilteredResult =
      saveApi.saveOptimizationFilteredResult.bind(saveApi);
    let savedSourceJobId: string | null = null;
    const savedPayloadRef: {
      current: OptimizationConstraintUpdatePayloadForTest | null;
    } = { current: null };

    saveApi.saveOptimizationFilteredResult = async (jobId, payload) => {
      savedSourceJobId = jobId;
      savedPayloadRef.current = structuredClone(payload);
      return originalSaveFilteredResult(jobId, payload);
    };
    currentApi = saveApi;

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(container.querySelector(".optimization-results-grid")).not.toBeNull(),
    );

    const objectiveSelect = container.querySelector(
      "#optimization-results-objective",
    ) as HTMLSelectElement | null;
    const refilterButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("重新过滤")) as
      | HTMLButtonElement
      | undefined;
    const firstCandidateLabel = () =>
      (
        container.querySelector(
          ".optimization-results-grid tbody tr:first-child",
        ) as HTMLTableRowElement | null
      )?.textContent ?? "";

    expect(container.textContent).not.toContain("保存新结果");

    fireEvent.change(objectiveSelect!, {
      target: { value: "annualized_return" },
    });
    fireEvent.click(refilterButton!);

    await waitFor(() => {
      expect(firstCandidateLabel()).toContain("收益第一");
      expect(container.textContent).toContain("保存新结果");
    });

    const sourceAfterPreview = await saveApi.getOptimizationJobDetail("opt-001");
    expect(sourceAfterPreview.request.objective).toBe(
      sourceBefore.request.objective,
    );
    expect(sourceAfterPreview.summary.objective).toBe(
      sourceBefore.summary.objective,
    );

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("保存新结果"),
    ) as HTMLButtonElement | undefined;
    expect(saveButton).toBeTruthy();
    fireEvent.click(saveButton!);

    await waitFor(() => expect(savedSourceJobId).toBe("opt-001"));
    expect(savedPayloadRef.current?.objective).toBe("annualized_return");
    await waitFor(() =>
      expect(window.location.hash).toMatch(/^#\/optimization-jobs\/opt-saved-/),
    );
    expect(window.location.hash).not.toBe("#/optimization-jobs/opt-001");
  });

  it("keeps the candidate list stable until re-filtering returns", async () => {
    const delayedApi = createObjectiveSortingApi();
    const originalUpdateConstraints =
      delayedApi.updateOptimizationJobConstraints.bind(delayedApi);
    let releaseRefilter:
      | (() => Promise<ApiOptimizationJobDetail>)
      | null = null;

    delayedApi.updateOptimizationJobConstraints = (...args) =>
      new Promise<ApiOptimizationJobDetail>((resolve, reject) => {
        releaseRefilter = async () => {
          try {
            const result = await originalUpdateConstraints(...args);
            resolve(result);
            return result;
          } catch (error) {
            reject(error);
            throw error;
          }
        };
      });

    currentApi = delayedApi;

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(container.querySelector(".optimization-results-grid")).not.toBeNull(),
    );

    const objectiveSelect = container.querySelector(
      "#optimization-results-objective",
    ) as HTMLSelectElement | null;
    const firstCandidateLabel = () =>
      (
        container.querySelector(
          ".optimization-results-grid tbody tr:first-child",
        ) as HTMLTableRowElement | null
      )?.textContent ?? "";
    const refilterButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("重新过滤")) as
      | HTMLButtonElement
      | undefined;

    expect(objectiveSelect?.value).toBe("return_sharpe");
    expect(firstCandidateLabel()).toContain("夏普第一");
    expect(refilterButton).toBeTruthy();

    fireEvent.change(objectiveSelect!, {
      target: { value: "annualized_return" },
    });
    fireEvent.click(refilterButton!);

    await waitFor(() =>
      expect(refilterButton?.textContent).toContain("重新过滤中..."),
    );
    expect(firstCandidateLabel()).toContain("夏普第一");
    expect(releaseRefilter).toBeTypeOf("function");

    await act(async () => {
      await releaseRefilter?.();
    });

    await waitFor(() => {
      expect(objectiveSelect?.value).toBe("annualized_return");
      expect(firstCandidateLabel()).toContain("收益第一");
    });
  });

  it("re-ranks candidates by composite score when re-filtering", async () => {
    currentApi = createObjectiveSortingApi();

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(container.querySelector(".optimization-results-grid")).not.toBeNull(),
    );

    const objectiveSelect = container.querySelector(
      "#optimization-results-objective",
    ) as HTMLSelectElement | null;
    const firstCandidateLabel = () =>
      (
        container.querySelector(
          ".optimization-results-grid tbody tr:first-child",
        ) as HTMLTableRowElement | null
      )?.textContent ?? "";
    const refilterButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("重新过滤")) as
      | HTMLButtonElement
      | undefined;

    expect(objectiveSelect?.value).toBe("return_sharpe");
    expect(firstCandidateLabel()).toContain("夏普第一");
    expect(refilterButton).toBeTruthy();

    fireEvent.change(objectiveSelect!, {
      target: { value: "composite_score" },
    });
    fireEvent.click(refilterButton!);

    await waitFor(() => {
      expect(objectiveSelect?.value).toBe("composite_score");
      expect(firstCandidateLabel()).toContain("得分第一");
      expect(container.textContent).toContain(
        "符合约束条件的组合共3个，以下按 综合得分 Max 输出当前候选版本排序。",
      );
    });
  });

  it("prefers all matching combinations over the current candidate subset in the results center", async () => {
    const allCombinationApi = createOptimizationTestApi();
    const originalGetOptimizationJobDetail =
      allCombinationApi.getOptimizationJobDetail.bind(allCombinationApi);
    const originalGetBacktestRunDetail =
      allCombinationApi.getBacktestRunDetail.bind(allCombinationApi);
    const requestedRunIds: string[] = [];

    allCombinationApi.getBacktestRunDetail = async (
      id: string,
      request?: BacktestRunDetailRequest | AbortSignal,
    ): Promise<ApiBacktestRunDetail> => {
      requestedRunIds.push(id);
      if (id === "run-missing") {
        throw new Error("Run run-missing not found");
      }
      return originalGetBacktestRunDetail(id, request);
    };

    allCombinationApi.getOptimizationJobDetail = async (
      jobId: string,
    ): Promise<ApiOptimizationJobDetail> => {
      const job = await originalGetOptimizationJobDetail(jobId);
      if (jobId !== "opt-001") {
        return job;
      }

      job.request.source_run_id = "run-missing";
      job.summary.source_run_id = "run-missing";
      job.candidates = job.candidates.map((candidate, index) => {
        if (index === 0) {
          return {
            ...candidate,
            id: "current-pass-1",
            label: "当前候选 1",
            title: "当前候选 1",
            summary: "当前候选 1",
            metrics: {
              ...candidate.metrics,
              annualized_return: 0.121,
              return_sharpe: 1.22,
              out_of_sample_sharpe: 0.95,
              max_drawdown_pct: -12.2,
              stability: 81,
            },
          };
        }
        return {
          ...candidate,
          id: `current-fail-${index + 1}`,
          label: `未通过 ${index + 1}`,
          title: `未通过 ${index + 1}`,
          summary: `未通过 ${index + 1}`,
          metrics: {
            ...candidate.metrics,
            annualized_return: 0.07,
            return_sharpe: 0.86,
            out_of_sample_sharpe: 0.74,
            max_drawdown_pct: -26.0,
            stability: 62,
          },
        };
      });

      const seedCandidate = job.candidates[0];
      if (!seedCandidate) {
        throw new Error("missing seed candidate");
      }

      setMatchingCombinations(job, [
        {
          ...structuredClone(seedCandidate),
          id: "all-match-1",
          label: "筛出组合 1",
          title: "筛出组合 1",
          rank: 1,
        },
        {
          ...structuredClone(seedCandidate),
          id: "all-match-2",
          label: "筛出组合 2",
          title: "筛出组合 2",
          rank: 2,
          parameter_snapshot: {
            ...structuredClone(seedCandidate.parameter_snapshot ?? {}),
            observation_timeframe: "weekly",
          },
        },
        {
          ...structuredClone(seedCandidate),
          id: "all-match-3",
          label: "筛出组合 3",
          title: "筛出组合 3",
          rank: 3,
          parameter_snapshot: {
            ...structuredClone(seedCandidate.parameter_snapshot ?? {}),
            observation_timeframe: "monthly",
          },
        },
        {
          ...structuredClone(seedCandidate),
          id: "all-match-4",
          label: "筛出组合 4",
          title: "筛出组合 4",
          rank: 4,
          parameter_snapshot: {
            ...structuredClone(seedCandidate.parameter_snapshot ?? {}),
            observation_timeframe: "quarterly",
          },
        },
        {
          ...structuredClone(seedCandidate),
          id: "all-match-5",
          label: "筛出组合 5",
          title: "筛出组合 5",
          rank: 5,
          parameter_snapshot: {
            ...structuredClone(seedCandidate.parameter_snapshot ?? {}),
            observation_timeframe: "yearly",
          },
        },
      ]);
      job.summary.matching_combination_source = "all_trials";
      job.matching_combination_source = "all_trials";
      return job;
    };

    currentApi = allCombinationApi;

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-results-grid"),
      ).not.toBeNull(),
    );

    const resultRows = container.querySelectorAll(
      ".optimization-results-card .optimization-lab-table tbody tr",
    );

    expect(container.textContent).toContain(
      "符合约束条件的组合共5个",
    );
    expect(container.textContent).toContain("筛出组合 1");
    expect(container.textContent).toContain("筛出组合 2");
    expect(container.textContent).toContain("筛出组合 3");
    expect(container.textContent).not.toContain("筛出组合 4");
    expect(container.textContent).not.toContain("筛出组合 5");
    expect(resultRows[resultRows.length - 1]?.textContent).toContain("当前组合");
    expect(resultRows).toHaveLength(4);
    expect(requestedRunIds).toEqual(["run-missing", "bt-001"]);

    const openButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("查看全部组合"),
    ) as HTMLButtonElement | undefined;
    expect(openButton).toBeTruthy();

    fireEvent.click(openButton!);

    const dialog = await waitFor(() => {
      const element = container.querySelector(
        ".optimization-all-combinations-dialog",
      ) as HTMLElement | null;
      expect(element).not.toBeNull();
      return element!;
    });
    expect(dialog.textContent).toContain("筛出组合 4");
    expect(dialog.textContent).toContain("筛出组合 5");
  });

  it("opens the all-combinations modal and sorts rows by the selected metric", async () => {
    currentApi = createObjectiveSortingApi();

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(container.querySelector(".optimization-results-grid")).not.toBeNull(),
    );

    const openButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("查看全部组合"),
    ) as HTMLButtonElement | undefined;
    expect(openButton).toBeTruthy();

    fireEvent.click(openButton!);

    const dialog = await waitFor(() => {
      const element = container.querySelector(
        ".optimization-all-combinations-dialog",
      ) as HTMLElement | null;
      expect(element).not.toBeNull();
      return element!;
    });
    const firstCandidateLabel = () =>
      (
        dialog.querySelector(
          "tbody tr:first-child .optimization-all-combinations-dialog__candidate-label",
        ) as HTMLElement | null
      )?.textContent ?? "";

    expect(firstCandidateLabel()).toContain("夏普第一");

    const annualizedSortButton = Array.from(
      dialog.querySelectorAll(".optimization-table-sort-button"),
    ).find((button) => button.textContent?.includes("年化收益率")) as
      | HTMLButtonElement
      | undefined;
    expect(annualizedSortButton).toBeTruthy();

    fireEvent.click(annualizedSortButton!);

    await waitFor(() => {
      expect(firstCandidateLabel()).toContain("收益第一");
    });
  });

  it("paginates all matching combinations in 100-row pages", async () => {
    currentApi = createLargeCombinationModalApi();

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(container.querySelector(".optimization-results-grid")).not.toBeNull(),
    );

    const openButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("查看全部组合"),
    ) as HTMLButtonElement | undefined;
    expect(openButton).toBeTruthy();

    fireEvent.click(openButton!);

    const dialog = await waitFor(() => {
      const element = container.querySelector(
        ".optimization-all-combinations-dialog",
      ) as HTMLElement | null;
      expect(element).not.toBeNull();
      return element!;
    });

    expect(dialog.querySelectorAll("tbody tr")).toHaveLength(100);
    expect(dialog.textContent).toContain("第 1 / 2 页");
    expect(
      dialog.querySelector(
        "tbody tr:first-child .optimization-all-combinations-dialog__candidate-label",
      )?.textContent,
    ).toContain("组合 001");

    const nextPageButton = Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("下一页"),
    ) as HTMLButtonElement | undefined;
    expect(nextPageButton).toBeTruthy();

    fireEvent.click(nextPageButton!);

    await waitFor(() => {
      expect(dialog.querySelectorAll("tbody tr")).toHaveLength(45);
      expect(dialog.textContent).toContain("第 2 / 2 页");
      expect(
        dialog.querySelector(
          "tbody tr:first-child .optimization-all-combinations-dialog__candidate-label",
        )?.textContent,
      ).toContain("组合 101");
    });
  });

  it("hydrates preview-only matching combinations before paginating and sorting the modal", async () => {
    const previewOnlyApi = createLargeCombinationModalApi();
    const originalGetOptimizationJobDetail =
      previewOnlyApi.getOptimizationJobDetail.bind(previewOnlyApi);
    previewOnlyApi.getOptimizationJobDetail = async (jobId, params) => {
      const job = await originalGetOptimizationJobDetail(jobId, params);
      if (jobId !== "opt-001") {
        return job;
      }
      const fullCombinations = job.matching_combinations ?? [];
      const fullCount =
        job.summary.matching_combination_count ??
        job.matching_combination_count ??
        fullCombinations.length;
      if (typeof params?.matchingLimit === "number") {
        job.matching_combinations = fullCombinations.slice(0, 4);
        job.summary.matching_combinations = structuredClone(
          job.matching_combinations,
        );
      }
      job.summary.matching_combination_count = fullCount;
      job.matching_combination_count = fullCount;
      job.summary.matching_combination_source = "all_trials";
      job.matching_combination_source = "all_trials";
      return job;
    };
    currentApi = previewOnlyApi;

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(container.textContent).toContain("符合约束条件的组合共145个"),
    );
    expect(container.textContent).toContain("组合 001");
    expect(container.textContent).not.toContain("组合 004");
    expect(container.textContent).not.toContain("组合 005");

    const openButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("查看全部组合"),
    ) as HTMLButtonElement | undefined;
    expect(openButton).toBeTruthy();

    fireEvent.click(openButton!);

    const dialog = await waitFor(() => {
      const element = container.querySelector(
        ".optimization-all-combinations-dialog",
      ) as HTMLElement | null;
      expect(element).not.toBeNull();
      return element!;
    });

    await waitFor(() => {
      expect(dialog.querySelectorAll("tbody tr")).toHaveLength(100);
      expect(dialog.textContent).toContain("第 1 / 2 页 · 1-100 / 145");
    });

    const firstCandidateLabel = () =>
      (
        dialog.querySelector(
          "tbody tr:first-child .optimization-all-combinations-dialog__candidate-label",
        ) as HTMLElement | null
      )?.textContent ?? "";
    expect(firstCandidateLabel()).toContain("组合 001");

    const annualizedSortButton = Array.from(
      dialog.querySelectorAll(".optimization-table-sort-button"),
    ).find((button) => button.textContent?.includes("年化收益率")) as
      | HTMLButtonElement
      | undefined;
    expect(annualizedSortButton).toBeTruthy();

    fireEvent.click(annualizedSortButton!);
    fireEvent.click(annualizedSortButton!);

    await waitFor(() => {
      expect(firstCandidateLabel()).toContain("组合 145");
      expect(
        dialog
          .querySelector("th:nth-child(2)")
          ?.getAttribute("aria-sort"),
      ).toBe("ascending");
    });
  });

  it("keeps the candidate panel visually distinct when raw objective ties cluster together", async () => {
    const api = createOptimizationTestApi() as OptimizationTestApi;
    const originalGetOptimizationJobDetail =
      api.getOptimizationJobDetail.bind(api);

    api.getOptimizationJobDetail = async (
      jobId: string,
    ): Promise<ApiOptimizationJobDetail> => {
      const job = await originalGetOptimizationJobDetail(jobId);
      if (jobId !== "opt-001") {
        return job;
      }
      const easyConstraints = [
        {
          key: "return_sharpe",
          label: "收益夏普",
          category: "return" as const,
          operator: ">=" as const,
          value: -100,
          baseline_value: -100,
          unit: "",
          source: "manual" as const,
        },
      ];
      const baseCandidate = job.candidates[0]!;
      const makeCombination = (
        id: string,
        rank: number,
        topN: number,
        annualizedReturn: number,
        returnSharpe: number,
        outOfSampleSharpe: number,
        maxDrawdownPct: number,
        stability: number,
      ): ApiOptimizationCandidate => ({
        ...structuredClone(baseCandidate),
        id,
        rank,
        label: `候选 ${rank}`,
        title: `候选 ${rank}`,
        parameter_snapshot: {
          ...structuredClone(baseCandidate.parameter_snapshot),
          top_n: topN,
        },
        metrics: {
          ...structuredClone(baseCandidate.metrics),
          annualized_return: annualizedReturn,
          return_sharpe: returnSharpe,
          out_of_sample_sharpe: outOfSampleSharpe,
          max_drawdown_pct: maxDrawdownPct,
          stability,
        },
        score: returnSharpe,
      });

      job.request.constraints = structuredClone(easyConstraints);
      job.summary.constraints = structuredClone(easyConstraints);
      job.result.constraints = structuredClone(easyConstraints);
      job.matching_combinations = [
        makeCombination("trial_10", 1, 50, 0.294265, 0.906057, 1.18747, -67.1, 44),
        makeCombination("trial_11", 2, 55, 0.294264, 0.906056, 1.18746, -67.1, 44),
        makeCombination("trial_12", 3, 60, 0.294263, 0.906055, 1.18745, -67.1, 44),
        makeCombination("trial_30", 4, 10, 0.2835, 0.884, 1.1603, -67.4, 44),
        makeCombination("trial_50", 5, 20, 0.2728, 0.8618, 1.133, -67.6, 43),
      ];
      job.candidates = structuredClone(job.matching_combinations.slice(0, 3));
      job.summary.matching_combinations = structuredClone(job.matching_combinations);
      job.summary.matching_combination_count = job.matching_combinations.length;
      job.matching_combination_count = job.matching_combinations.length;
      job.summary.matching_combination_source = "all_trials";
      job.matching_combination_source = "all_trials";
      return job;
    };
    currentApi = api;

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(container.textContent).toContain("符合约束条件的组合共5个"),
    );
    const rows = Array.from(
      container.querySelectorAll(".optimization-lab-table tbody tr"),
    ).slice(0, 3);
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("买入排名阈值：50");
    expect(rows[1].textContent).toContain("买入排名阈值：10");
    expect(rows[2].textContent).toContain("买入排名阈值：20");
    expect(rows.map((row) => row.textContent).join("\n")).not.toContain(
      "买入排名阈值：55",
    );

    const openButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("查看全部组合"),
    ) as HTMLButtonElement | undefined;
    expect(openButton).toBeTruthy();

    fireEvent.click(openButton!);

    const dialog = await waitFor(() => {
      const element = container.querySelector(
        ".optimization-all-combinations-dialog",
      ) as HTMLElement | null;
      expect(element).not.toBeNull();
      return element!;
    });
    const modalRows = Array.from(dialog.querySelectorAll("tbody tr")).slice(
      0,
      3,
    );
    expect(modalRows).toHaveLength(3);
    expect(modalRows[0].textContent).toContain("买入排名阈值 50");
    expect(modalRows[1].textContent).toContain("买入排名阈值 10");
    expect(modalRows[2].textContent).toContain("买入排名阈值 20");
    expect(modalRows.map((row) => row.textContent).join("\n")).not.toContain(
      "买入排名阈值 55",
    );
  });

  it("marks legacy candidate-only totals as saved candidates instead of full combinations", async () => {
    const api = createOptimizationTestApi() as OptimizationTestApi;
    const originalGetOptimizationJobDetail =
      api.getOptimizationJobDetail.bind(api);
    api.getOptimizationJobDetail = async (
      jobId: string,
    ): Promise<ApiOptimizationJobDetail> => {
      const job = await originalGetOptimizationJobDetail(jobId);
      if (jobId !== "opt-001") {
        return job;
      }
      const candidateOnlyMatches = structuredClone(
        (job.matching_combinations?.length
          ? job.matching_combinations
          : job.candidates
        ).slice(0, 2),
      );
      job.matching_combinations = candidateOnlyMatches;
      job.summary.matching_combination_count = candidateOnlyMatches.length;
      job.matching_combination_count = candidateOnlyMatches.length;
      job.summary.matching_combination_source = "persisted_candidates";
      job.matching_combination_source = "persisted_candidates";
      return job;
    };
    currentApi = api;

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(container.querySelector(".optimization-results-grid")).not.toBeNull(),
    );

    expect(container.textContent).toContain("当前仅基于已保存候选识别到");
    expect(container.textContent).toContain("缺少全量 trial 明细");

    const openButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("查看已保存候选"),
    ) as HTMLButtonElement | undefined;
    expect(openButton).toBeTruthy();

    fireEvent.click(openButton!);

    const dialog = await waitFor(() => {
      const element = container.querySelector(
        ".optimization-all-combinations-dialog",
      ) as HTMLElement | null;
      expect(element).not.toBeNull();
      return element!;
    });

    expect(dialog.textContent).toContain("已保存的符合约束候选");
    expect(dialog.textContent).toContain("当前仅有 2 组已保存候选可供查看");
  });

  it("keeps the all-combinations dialog wide, scrollable, and footer-sticky", async () => {
    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(container.querySelector(".optimization-results-grid")).not.toBeNull(),
    );

    const openButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("查看全部组合"),
    ) as HTMLButtonElement | undefined;
    expect(openButton).toBeTruthy();

    fireEvent.click(openButton!);

    const dialog = await waitFor(() => {
      const element = container.querySelector(
        ".optimization-all-combinations-dialog",
      ) as HTMLElement | null;
      expect(element).not.toBeNull();
      return element!;
    });
    const tableShell = dialog.querySelector(
      ".optimization-all-combinations-dialog__table-shell",
    ) as HTMLElement | null;
    const table = dialog.querySelector(
      ".optimization-all-combinations-dialog__table",
    ) as HTMLElement | null;
    const footer = dialog.querySelector(
      ".optimization-all-combinations-dialog__footer",
    ) as HTMLElement | null;
    const closeButton = footer?.querySelector(
      ".primary-button",
    ) as HTMLButtonElement | null;
    const cssSource = readFileSync("src/pages/optimization-lab-page.css", "utf8");

    expect(tableShell).toBeTruthy();
    expect(table).toBeTruthy();
    expect(footer).toBeTruthy();
    expect(closeButton).toBeTruthy();
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(cssSource).toContain(".modal-card.optimization-all-combinations-dialog {");
    expect(cssSource).toContain("width: min(1360px, calc(100vw - 32px));");
    expect(cssSource).toContain("overflow-x: hidden;");
    expect(cssSource).toContain("overflow-y: auto;");
    expect(cssSource).toContain("overscroll-behavior: contain;");
    expect(cssSource).toContain("max-height: min(56vh, 560px);");
    expect(cssSource).toContain("min-width: 1024px;");
    expect(cssSource).toContain(
      ".modal-card__footer.optimization-all-combinations-dialog__footer {",
    );
    expect(cssSource).toContain("position: sticky;");
    expect(cssSource).toContain("bottom: 0;");

    Object.defineProperty(tableShell!, "scrollHeight", {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(tableShell!, "clientHeight", {
      configurable: true,
      value: 320,
    });
    Object.defineProperty(tableShell!, "scrollWidth", {
      configurable: true,
      value: 1024,
    });
    Object.defineProperty(tableShell!, "clientWidth", {
      configurable: true,
      value: 1024,
    });

    tableShell!.scrollTop = 0;
    tableShell!.scrollLeft = 0;

    fireEvent.wheel(dialog, { deltaY: 140 });
    expect(tableShell!.scrollTop).toBe(140);
    expect(fireEvent.wheel(tableShell!, { deltaY: 140 })).toBe(true);

    fireEvent.click(closeButton!);

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-all-combinations-dialog"),
      ).toBeNull(),
    );
    expect(document.body.style.overflow).toBe("");
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("expands constraint chips and only keeps compliant candidates in the results center", async () => {
    const constrainedApi = createOptimizationTestApi();
    const originalGetOptimizationJobDetail =
      constrainedApi.getOptimizationJobDetail.bind(constrainedApi);
    constrainedApi.getOptimizationJobDetail = async (jobId: string) => {
      const job = await originalGetOptimizationJobDetail(jobId);
      const strictConstraints = [
        {
          key: "max_drawdown_pct",
          label: "最大回撤",
          category: "risk" as const,
          operator: "<=" as const,
          value: 15,
          baseline_value: 15,
          unit: "%",
          source: "preset" as const,
        },
        {
          key: "stability",
          label: "稳定度",
          category: "stability" as const,
          operator: ">=" as const,
          value: 70,
          baseline_value: 70,
          unit: "pts",
          source: "preset" as const,
        },
        {
          key: "return_sharpe",
          label: "收益夏普",
          category: "return" as const,
          operator: ">=" as const,
          value: 1.1,
          baseline_value: 1.1,
          unit: "",
          source: "preset" as const,
        },
      ];
      const constrainedCandidates = job.candidates.map((candidate, index) => {
        if (index === 0) {
          return {
            ...candidate,
            title: "约束通过 1",
            label: "约束通过 1",
            metrics: {
              ...candidate.metrics,
              annualized_return: 0.154,
              return_sharpe: 1.23,
              out_of_sample_sharpe: 1.01,
              max_drawdown_pct: -12.4,
              stability: 81,
              turnover: 8.4,
            },
          };
        }
        if (index === 1) {
          return {
            ...candidate,
            title: "回撤过大",
            label: "回撤过大",
            metrics: {
              ...candidate.metrics,
              annualized_return: 0.162,
              return_sharpe: 1.28,
              out_of_sample_sharpe: 1.08,
              max_drawdown_pct: -21.6,
              stability: 83,
              turnover: 7.2,
            },
          };
        }
        if (index === 2) {
          return {
            ...candidate,
            title: "稳定度不足",
            label: "稳定度不足",
            metrics: {
              ...candidate.metrics,
              annualized_return: 0.149,
              return_sharpe: 1.18,
              out_of_sample_sharpe: 0.96,
              max_drawdown_pct: -14.2,
              stability: 64,
              turnover: 8.9,
            },
          };
        }
        return {
          ...candidate,
          title: "夏普不足",
          label: "夏普不足",
          metrics: {
            ...candidate.metrics,
            annualized_return: 0.142,
            return_sharpe: 1.04,
            out_of_sample_sharpe: 0.92,
            max_drawdown_pct: -13.1,
            stability: 76,
            turnover: 8.1,
          },
        };
      });
      job.request.constraint_preset_key = "defensive";
      job.request.constraint_label = "稳健型（自定义）";
      job.request.constraints = structuredClone(strictConstraints);
      job.summary.constraint_preset_key = "defensive";
      job.summary.constraint_label = "稳健型（自定义）";
      job.summary.constraints = structuredClone(strictConstraints);
      job.result.constraint_preset_key = "defensive";
      job.result.constraint_label = "稳健型（自定义）";
      job.result.constraints = structuredClone(strictConstraints);
      job.candidates = constrainedCandidates;
      syncMatchingCombinationCount(job);
      job.result.best_candidate_id = constrainedCandidates[1]?.id ?? null;
      job.result.best_candidate_label = constrainedCandidates[1]?.label ?? null;
      return job;
    };
    currentApi = constrainedApi;

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-results-grid"),
      ).not.toBeNull(),
    );
    const chips = container.querySelector(
      ".optimization-meta-chips",
    ) as HTMLElement | null;
    const refilterButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("重新过滤"),
    ) as HTMLButtonElement | undefined;
    expect(chips).toBeTruthy();
    expect(chips?.textContent).not.toContain("稳健型（自定义）");
    expect(chips?.textContent).not.toContain("最大回撤 ≤ 15.0%");
    expect(chips?.textContent).not.toContain("符合约束：1/5");
    expect(container.textContent).toContain("约束条件");
    expect(container.textContent).not.toContain("当前启用 3 项约束");
    expect(refilterButton).toBeTruthy();
    expect(refilterButton).toHaveClass("ghost-button");
    expect(refilterButton).not.toHaveClass("primary-button");

    expect(container.textContent).toContain("约束通过 1");
    expect(container.textContent).not.toContain("回撤过大");
    expect(container.textContent).not.toContain("稳定度不足");
    expect(container.textContent).not.toContain("夏普不足");
  });

  it("sanitizes legacy turnover constraints out of the result constraint bar", async () => {
    const legacyConstraintApi = createOptimizationTestApi();
    const originalGetOptimizationJobDetail =
      legacyConstraintApi.getOptimizationJobDetail.bind(legacyConstraintApi);
    legacyConstraintApi.getOptimizationJobDetail = async (jobId: string) => {
      const job = await originalGetOptimizationJobDetail(jobId);
      const legacyConstraints = [
        ...structuredClone(defaultConstraintPayload.constraints.slice(0, 4)),
        {
          key: "turnover",
          label: "换手率",
          category: "risk" as const,
          operator: "<=" as const,
          value: 12,
          baseline_value: 12,
          unit: "%",
          source: "manual" as const,
        },
        structuredClone(defaultConstraintPayload.constraints[4]),
      ];
      job.request.constraint_label = "平衡型（自定义）";
      job.request.constraints = structuredClone(legacyConstraints);
      job.summary.constraint_label = "平衡型（自定义）";
      job.summary.constraints = structuredClone(legacyConstraints);
      job.result.constraint_label = "平衡型（自定义）";
      job.result.constraints = structuredClone(legacyConstraints);
      return job;
    };
    currentApi = legacyConstraintApi;

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-results-constraint-bar"),
      ).not.toBeNull(),
    );

    expect(container.textContent).not.toContain("当前启用 5 项约束");
    expect(
      container.querySelector("#optimization-results-constraint-turnover"),
    ).toBeNull();
    expect(container.textContent).not.toContain("换手率");
  });

  it("keeps the quick filter bar available when no candidate version passes and still preserves the baseline row", async () => {
    currentApi = createZeroPassConstraintApi();

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(container.textContent).toContain("当前约束下暂无候选版本通过过滤"),
    );
    expect(
      container.querySelector(".optimization-results-constraint-bar"),
    ).not.toBeNull();
    expect(container.querySelector(".optimization-results-grid")).not.toBeNull();
    expect(container.querySelector(".optimization-shelf-grid")).not.toBeNull();
    expect(container.textContent).toContain("已过滤 4 个候选版本");
    expect(container.textContent).toContain("当前基准");
    expect(container.textContent).not.toContain("当前启用 5 项约束");
    expect(
      (
        container.querySelector(
          ".optimization-lab-panel--hero h1 + p",
        ) as HTMLParagraphElement | null
      )?.textContent,
    ).toContain("优化组合共 70个，耗时 0分钟");
  });

  it("supports loosening quick filters and re-filtering to surface new matching candidates", async () => {
    currentApi = createZeroPassConstraintApi();

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(container.textContent).toContain("当前约束下暂无候选版本通过过滤"),
    );

    const maxDrawdownInput = container.querySelector(
      "#optimization-results-constraint-max_drawdown_pct",
    ) as HTMLInputElement | null;
    const stabilityInput = container.querySelector(
      "#optimization-results-constraint-stability",
    ) as HTMLInputElement | null;
    const refilterButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("重新过滤")) as
      | HTMLButtonElement
      | undefined;

    expect(maxDrawdownInput).toBeTruthy();
    expect(stabilityInput).toBeTruthy();
    expect(refilterButton).toBeTruthy();

    fireEvent.change(maxDrawdownInput!, { target: { value: "15" } });
    fireEvent.change(stabilityInput!, { target: { value: "70" } });
    fireEvent.click(refilterButton!);

    await waitFor(() =>
      expect(container.textContent).toContain("放宽后通过 1"),
    );
    expect(container.textContent).not.toContain(
      "当前约束下暂无候选版本通过过滤",
    );
    expect(container.textContent).toContain(
      "符合约束条件的组合共1个，以下按 收益夏普 Max 输出当前候选版本排序。",
    );
  });

  it("re-filters against full matching combinations when persisted candidates would create a false zero", async () => {
    const fullMatchingApi = createFullMatchingCombinationRefilterApi();
    let saveCalled = false;
    const originalUpdateConstraints =
      fullMatchingApi.updateOptimizationJobConstraints.bind(fullMatchingApi);
    fullMatchingApi.updateOptimizationJobConstraints = async (...args) => {
      saveCalled = true;
      return originalUpdateConstraints(...args);
    };
    currentApi = fullMatchingApi;

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(container.textContent).toContain(
        "符合约束条件的组合共30个，以下按 收益夏普 Max 输出当前候选版本排序。",
      ),
    );

    const maxDrawdownInput = container.querySelector(
      "#optimization-results-constraint-max_drawdown_pct",
    ) as HTMLInputElement | null;
    const refilterButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("重新过滤")) as
      | HTMLButtonElement
      | undefined;

    expect(maxDrawdownInput).toBeTruthy();
    expect(refilterButton).toBeTruthy();

    fireEvent.change(maxDrawdownInput!, { target: { value: "2" } });
    fireEvent.click(refilterButton!);

    await waitFor(() => expect(saveCalled).toBe(true));
    await waitFor(() =>
      expect(container.textContent).toContain(
        "符合约束条件的组合共15个，以下按 收益夏普 Max 输出当前候选版本排序。",
      ),
    );
    expect(container.textContent).toContain("候选 1");
    expect(container.textContent).not.toContain(
      "无符合条件的组合，请放宽约束条件再试。",
    );
    expect(container.textContent).not.toContain(
      "当前约束下暂无候选版本通过过滤",
    );
  });

  it("keeps the current filter state when the all-combinations modal hydrates full detail", async () => {
    const fullMatchingApi = createFullMatchingCombinationRefilterApi();
    const originalGetOptimizationJobDetail =
      fullMatchingApi.getOptimizationJobDetail.bind(fullMatchingApi);
    fullMatchingApi.getOptimizationJobDetail = async (jobId, params) => {
      const job = await originalGetOptimizationJobDetail(jobId, params);
      const matchingCombinations = job.matching_combinations ?? [];
      if (typeof params?.matchingLimit === "number") {
        const fullCount =
          job.summary.matching_combination_count ??
          job.matching_combination_count ??
          matchingCombinations.length;
        job.matching_combinations = matchingCombinations.slice(
          0,
          Math.max(0, Math.trunc(params.matchingLimit)),
        );
        job.summary.matching_combination_count = fullCount;
        job.matching_combination_count = fullCount;
      }
      return job;
    };
    const originalUpdateOptimizationJobConstraints =
      fullMatchingApi.updateOptimizationJobConstraints.bind(fullMatchingApi);
    fullMatchingApi.updateOptimizationJobConstraints = async (jobId, payload) => {
      const job = await originalUpdateOptimizationJobConstraints(jobId, payload);
      const matchingCombinations = job.matching_combinations ?? [];
      job.matching_combinations = matchingCombinations.slice(0, 3);
      return job;
    };
    currentApi = fullMatchingApi;

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(container.textContent).toContain(
        "符合约束条件的组合共30个，以下按 收益夏普 Max 输出当前候选版本排序。",
      ),
    );

    const maxDrawdownInput = container.querySelector(
      "#optimization-results-constraint-max_drawdown_pct",
    ) as HTMLInputElement | null;
    const refilterButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("重新过滤")) as
      | HTMLButtonElement
      | undefined;

    expect(maxDrawdownInput).toBeTruthy();
    expect(refilterButton).toBeTruthy();

    fireEvent.change(maxDrawdownInput!, { target: { value: "2" } });
    await waitFor(() =>
      expect(container.textContent).toContain(
        "已修改约束条件，点击“重新过滤”后应用。",
      ),
    );
    fireEvent.click(refilterButton!);

    await waitFor(() =>
      expect(container.textContent).toContain(
        "符合约束条件的组合共15个，以下按 收益夏普 Max 输出当前候选版本排序。",
      ),
    );

    const openButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("查看全部组合"),
    ) as HTMLButtonElement | undefined;
    expect(openButton).toBeTruthy();

    fireEvent.click(openButton!);

    const dialog = await waitFor(() => {
      const element = container.querySelector(
        ".optimization-all-combinations-dialog",
      ) as HTMLElement | null;
      expect(element).not.toBeNull();
      return element!;
    });

    await waitFor(() => {
      expect(dialog.textContent).toContain("共 15 组");
      expect(dialog.querySelectorAll("tbody tr")).toHaveLength(15);
      expect(maxDrawdownInput?.value).toBe("2");
    });
  });

  it("shows a toast and keeps the current result state when refiltering would remove every combination", async () => {
    const zeroTotalApi = createBaselineOnlyPassApi();
    let saveCalled = false;
    const originalUpdateConstraints =
      zeroTotalApi.updateOptimizationJobConstraints.bind(zeroTotalApi);
    zeroTotalApi.updateOptimizationJobConstraints = async (...args) => {
      saveCalled = true;
      return originalUpdateConstraints(...args);
    };
    currentApi = zeroTotalApi;

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(container.textContent).toContain(
        "符合约束条件的组合共0个，以下按 收益夏普 Max 输出当前候选版本排序。",
      ),
    );

    const heroCopy = container.querySelector(
      ".optimization-lab-panel--hero h1 + p",
    ) as HTMLParagraphElement | null;
    const initialHeroCopy = heroCopy?.textContent;
    const maxDrawdownInput = container.querySelector(
      "#optimization-results-constraint-max_drawdown_pct",
    ) as HTMLInputElement | null;
    const stabilityInput = container.querySelector(
      "#optimization-results-constraint-stability",
    ) as HTMLInputElement | null;
    const refilterButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("重新过滤")) as
      | HTMLButtonElement
      | undefined;

    expect(maxDrawdownInput).toBeTruthy();
    expect(stabilityInput).toBeTruthy();
    expect(refilterButton).toBeTruthy();

    fireEvent.change(maxDrawdownInput!, { target: { value: "10" } });
    fireEvent.change(stabilityInput!, { target: { value: "90" } });
    fireEvent.click(refilterButton!);

    const toast = await waitFor(() => {
      const element = container.querySelector(
        ".optimization-results-toast",
      ) as HTMLDivElement | null;
      expect(element).not.toBeNull();
      return element!;
    });

    await waitFor(() =>
      expect(container.textContent).toContain(
        "无符合条件的组合，请放宽约束条件再试。",
      ),
    );
    expect(toast.className).toContain("error-banner");
    expect(saveCalled).toBe(false);
    expect(container.textContent).toContain(
      "符合约束条件的组合共0个，以下按 收益夏普 Max 输出当前候选版本排序。",
    );
    expect(container.textContent).toContain("当前组合");
    expect(heroCopy?.textContent).toBe(initialHeroCopy);
  });

  it("offers a one-click quick-filter relaxation when no candidate currently passes", async () => {
    currentApi = createZeroPassConstraintApi();

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(container.textContent).toContain("当前约束下暂无候选版本通过过滤"),
    );

    const relaxButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("一键放宽到有结果")) as
      | HTMLButtonElement
      | undefined;

    expect(relaxButton).toBeTruthy();
    fireEvent.click(relaxButton!);

    await waitFor(() =>
      expect(container.textContent).toContain("放宽后通过 1"),
    );
    expect(container.textContent).not.toContain(
      "当前约束下暂无候选版本通过过滤",
    );
    expect(container.textContent).toContain("放宽后通过 1");
    expect(
      (
        container.querySelector(
          "#optimization-results-constraint-max_drawdown_pct",
        ) as HTMLInputElement | null
      )?.value,
    ).toBe("12");
    expect(
      (
        container.querySelector(
          "#optimization-results-constraint-stability",
        ) as HTMLInputElement | null
      )?.value,
    ).toBe("72");
  });

  it("applies quick filters locally even when previewing the thresholds fails", async () => {
    const flakyApi = createZeroPassConstraintApi();
    flakyApi.updateOptimizationJobConstraints = async () => {
      throw new Error("405 Method Not Allowed");
    };
    currentApi = flakyApi;

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(container.textContent).toContain("当前约束下暂无候选版本通过过滤"),
    );

    const maxDrawdownInput = container.querySelector(
      "#optimization-results-constraint-max_drawdown_pct",
    ) as HTMLInputElement | null;
    const stabilityInput = container.querySelector(
      "#optimization-results-constraint-stability",
    ) as HTMLInputElement | null;
    const refilterButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("重新过滤")) as
      | HTMLButtonElement
      | undefined;

    expect(maxDrawdownInput).toBeTruthy();
    expect(stabilityInput).toBeTruthy();
    expect(refilterButton).toBeTruthy();

    fireEvent.change(maxDrawdownInput!, { target: { value: "15" } });
    fireEvent.change(stabilityInput!, { target: { value: "70" } });
    fireEvent.click(refilterButton!);

    await waitFor(() => expect(container.textContent).toContain("放宽后通过 1"));
    expect(container.textContent).not.toContain(
      "当前约束下暂无候选版本通过过滤",
    );
    await waitFor(() =>
      expect(container.textContent).toContain(
        "后端未返回本次过滤快照：405 Method Not Allowed",
      ),
    );
    expect(container.textContent).not.toContain("保存新结果");
  });

  it("shows a fatal error when a terminal optimization detail response omits matching_combination_count", async () => {
    const brokenApi = createOptimizationTestApi();
    const originalGetOptimizationJobDetail =
      brokenApi.getOptimizationJobDetail.bind(brokenApi);
    brokenApi.getOptimizationJobDetail = async (jobId: string) => {
      const job = await originalGetOptimizationJobDetail(jobId);
      delete job.summary.matching_combination_count;
      delete job.matching_combination_count;
      return job;
    };
    currentApi = brokenApi;

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(container.textContent).toContain(
        MISSING_MATCHING_COMBINATION_COUNT_ERROR,
      ),
    );
    expect(container.querySelector(".optimization-results-grid")).toBeNull();
  });

  it("shows a fatal error instead of falling back to local-only notice when refilter response omits matching_combination_count", async () => {
    const brokenApi = createZeroPassConstraintApi();
    const originalUpdateConstraints =
      brokenApi.updateOptimizationJobConstraints.bind(brokenApi);
    brokenApi.updateOptimizationJobConstraints = async (...args) => {
      const job = await originalUpdateConstraints(...args);
      delete job.summary.matching_combination_count;
      delete job.matching_combination_count;
      return job;
    };
    currentApi = brokenApi;

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(container.textContent).toContain("当前约束下暂无候选版本通过过滤"),
    );

    const maxDrawdownInput = container.querySelector(
      "#optimization-results-constraint-max_drawdown_pct",
    ) as HTMLInputElement | null;
    const stabilityInput = container.querySelector(
      "#optimization-results-constraint-stability",
    ) as HTMLInputElement | null;
    const refilterButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("重新过滤")) as
      | HTMLButtonElement
      | undefined;

    expect(maxDrawdownInput).toBeTruthy();
    expect(stabilityInput).toBeTruthy();
    expect(refilterButton).toBeTruthy();

    fireEvent.change(maxDrawdownInput!, { target: { value: "15" } });
    fireEvent.change(stabilityInput!, { target: { value: "70" } });
    fireEvent.click(refilterButton!);

    await waitFor(() =>
      expect(container.textContent).toContain(
        MISSING_MATCHING_COMBINATION_COUNT_ERROR,
      ),
    );
    expect(container.textContent).not.toContain("后端未保存本次约束设置");
    expect(container.querySelector(".optimization-results-grid")).toBeNull();
  });

  it("counts the current combination as passing when it satisfies the active filters", async () => {
    currentApi = createBaselineOnlyPassApi();

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(container.textContent).toContain(
        "符合约束条件的组合共0个，以下按 收益夏普 Max 输出当前候选版本排序。",
      ),
    );
    expect(container.textContent).toContain("当前组合");
    expect(container.textContent).not.toContain("组合5 当前策略组合");
    expect(container.textContent).not.toContain(
      "当前约束下暂无候选版本通过过滤",
    );
  });

  it("shows the one-click relaxation when only the current combination passes", async () => {
    currentApi = createBaselineOnlyPassApi();

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(container.textContent).toContain(
        "符合约束条件的组合共0个，以下按 收益夏普 Max 输出当前候选版本排序。",
      ),
    );

    const relaxButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("一键放宽到有结果")) as
      | HTMLButtonElement
      | undefined;

    expect(relaxButton).toBeTruthy();
    fireEvent.click(relaxButton!);

    await waitFor(() =>
      expect(container.textContent).toContain(
        "符合约束条件的组合共1个，以下按 收益夏普 Max 输出当前候选版本排序。",
      ),
    );
    expect(container.textContent).toContain("未通过 1");
    expect(
      (
        container.querySelector(
          "#optimization-results-constraint-max_drawdown_pct",
        ) as HTMLInputElement | null
      )?.value,
    ).toBe("55");
    expect(
      (
        container.querySelector(
          "#optimization-results-constraint-stability",
        ) as HTMLInputElement | null
      )?.value,
    ).toBe("2");
  });

  it("keeps hero action buttons wrapped with consistent sizing instead of vertical text columns", async () => {
    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-results-grid"),
      ).not.toBeNull(),
    );
    const heroPanel = container.querySelector(
      ".optimization-lab-panel--hero",
    ) as HTMLElement | null;
    const actions = container.querySelector(
      ".optimization-hero-actions",
    ) as HTMLElement | null;
    const buttons = Array.from(
      container.querySelectorAll(".optimization-hero-actions button"),
    ) as HTMLButtonElement[];

    expect(heroPanel).toBeTruthy();
    expect(actions).toBeTruthy();
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    expect(getComputedStyle(heroPanel!).flexWrap).toBe("wrap");
    expect(getComputedStyle(actions!).flexWrap).toBe("wrap");
    buttons.forEach((button) => {
      expect(getComputedStyle(button).whiteSpace).toBe("nowrap");
      expect(getComputedStyle(button).minWidth).toBe("124px");
    });
  });

  it("updates the hero strategy name with the promoted version after promoting the current candidate", async () => {
    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-results-grid"),
      ).not.toBeNull(),
    );
    const promoteButton = Array.from(
      container.querySelectorAll(".optimization-hero-actions button"),
    ).find((button) => button.textContent?.includes("晋升当前版本")) as
      | HTMLButtonElement
      | undefined;
    expect(promoteButton).toBeTruthy();

    fireEvent.click(promoteButton!);

    let promotionDialog: HTMLElement | null = null;
    await waitFor(() => {
      promotionDialog = container.querySelector(
        '[role="dialog"][aria-label="确认晋升当前版本"]',
      ) as HTMLElement | null;
      expect(promotionDialog).not.toBeNull();
    });
    expect(promotionDialog!.textContent).toContain("候选摘要");
    expect(promotionDialog!.textContent).toContain("参数差异");
    expect(promotionDialog!.textContent).toContain("来源任务与回测");
    expect(promotionDialog!.textContent).toContain("来源回测");
    expect(promotionDialog!.textContent).toContain("bt-001");
    expect(promotionDialog!.textContent).toContain("备选候选");
    expect(container.textContent).not.toContain(
      "已完成版本晋升，标普动量策略 当前版本已更新为 v2。",
    );

    const confirmButton = Array.from(
      promotionDialog!.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("确认晋升")) as
      | HTMLButtonElement
      | undefined;
    const noteInput = promotionDialog!.querySelector(
      "#promotion-decision-note",
    ) as HTMLTextAreaElement | null;
    expect(confirmButton).toBeTruthy();
    expect(confirmButton!.disabled).toBe(true);
    expect(noteInput).toBeTruthy();

    fireEvent.change(noteInput!, {
      target: { value: "样本外窗口稳定，回撤仍在晋升护栏内。" },
    });
    await waitFor(() => expect(confirmButton!.disabled).toBe(false));
    fireEvent.click(confirmButton!);

    await waitFor(() =>
      expect(
        (
          container.querySelector(
            ".optimization-lab-panel--hero h1",
          ) as HTMLHeadingElement | null
        )?.textContent,
      ).toContain("参数优化：标普动量策略"),
    );
    expect(
      (
        container.querySelector(
          ".optimization-lab-panel--hero .optimization-lab-panel__hero-version",
        ) as HTMLElement | null
      )?.textContent,
    ).toBe("v1");
    await waitFor(() =>
      expect(container.textContent).toContain(
        "已完成版本晋升，标普动量策略 当前版本已更新为 v2。",
      ),
    );
  });

  it("promotes an older optimization job against the currently loaded strategy version", async () => {
    const staleJobApi = createOptimizationTestApi();
    const originalGetOptimizationJobDetail =
      staleJobApi.getOptimizationJobDetail.bind(staleJobApi);
    const originalGetStrategyDetail = staleJobApi.getStrategyDetail.bind(staleJobApi);
    const originalPromoteOptimizationCandidate =
      staleJobApi.promoteOptimizationCandidate.bind(staleJobApi);
    const staleBaseParameterVersionId = "strat-001-v1";
    const currentParameterVersionId = "strat-001-v2";
    let requestedBaseParameterVersionId: string | null | undefined;
    let requestedMode: string | undefined;
    let requestedIdempotencyKey: string | undefined;
    let requestedComment: string | undefined;

    staleJobApi.getOptimizationJobDetail = async (
      jobId: string,
    ): Promise<ApiOptimizationJobDetail> => {
      const job = await originalGetOptimizationJobDetail(jobId);
      if (jobId !== "opt-001") {
        return job;
      }
      job.request.base_parameter_version_id = staleBaseParameterVersionId;
      job.summary.baseline_parameter_version_id = staleBaseParameterVersionId;
      job.result.baseline_parameter_version_id = staleBaseParameterVersionId;
      job.base_parameter_version_id = staleBaseParameterVersionId;
      job.candidates = job.candidates.map((candidate) => ({
        ...candidate,
        base_parameter_version_id: staleBaseParameterVersionId,
      }));
      job.matching_combinations = job.matching_combinations?.map(
        (candidate) => ({
          ...candidate,
          base_parameter_version_id: staleBaseParameterVersionId,
        }),
      );
      return job;
    };
    staleJobApi.getStrategyDetail = async (
      id: string,
    ): Promise<ApiStrategyDetail> => {
      const strategy = await originalGetStrategyDetail(id);
      return {
        ...strategy,
        current_parameter_version: 2,
        current_parameter_version_id: currentParameterVersionId,
        parameter_history: [
          {
            version_number: 2,
            parameter_version_id: currentParameterVersionId,
            revision: 2,
            created_at: nowIso(),
            comment: "已存在的人工修订",
            parameters: {
              ...strategy.parameters,
              top_n: 8,
            },
          },
          ...(strategy.parameter_history ?? []),
        ],
      };
    };
    staleJobApi.promoteOptimizationCandidate = async (
      jobId,
      trialId,
      mode,
      idempotencyKey,
      comment,
      baseParameterVersionId,
    ): Promise<ApiOptimizationJobDetail> => {
      requestedMode = mode;
      requestedIdempotencyKey = idempotencyKey;
      requestedComment = comment;
      requestedBaseParameterVersionId = baseParameterVersionId;
      if (baseParameterVersionId !== currentParameterVersionId) {
        throw new Error("The strategy has moved to a newer parameter version.");
      }
      return originalPromoteOptimizationCandidate(
        jobId,
        trialId,
        mode,
        idempotencyKey,
        comment,
      );
    };
    currentApi = staleJobApi;

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-results-grid"),
      ).not.toBeNull(),
    );
    const promoteButton = Array.from(
      container.querySelectorAll(".optimization-hero-actions button"),
    ).find((button) => button.textContent?.includes("晋升当前版本")) as
      | HTMLButtonElement
      | undefined;

    fireEvent.click(promoteButton!);

    let promotionDialog: HTMLElement | null = null;
    await waitFor(() => {
      promotionDialog = container.querySelector(
        '[role="dialog"][aria-label="确认晋升当前版本"]',
      ) as HTMLElement | null;
      expect(promotionDialog).not.toBeNull();
    });
    expect(requestedBaseParameterVersionId).toBeUndefined();
    expect(promotionDialog!.textContent).toContain("提交基线");
    expect(promotionDialog!.textContent).toContain("v2");

    const noteInput = promotionDialog!.querySelector(
      "#promotion-decision-note",
    ) as HTMLTextAreaElement | null;
    const confirmButton = Array.from(
      promotionDialog!.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("确认晋升")) as
      | HTMLButtonElement
      | undefined;
    expect(noteInput).toBeTruthy();
    expect(confirmButton).toBeTruthy();

    fireEvent.change(noteInput!, {
      target: { value: "沿用当前版本基线，晋升样本外更稳的候选。" },
    });
    await waitFor(() => expect(confirmButton!.disabled).toBe(false));
    fireEvent.click(confirmButton!);

    await waitFor(() =>
      expect(requestedBaseParameterVersionId).toBe(currentParameterVersionId),
    );
    expect(requestedMode).toBe("set_current");
    expect(requestedIdempotencyKey).toContain("promote-opt-001-");
    expect(requestedComment).toBe("沿用当前版本基线，晋升样本外更稳的候选。");
    expect(container.textContent).not.toContain(
      "The strategy has moved to a newer parameter version.",
    );
  });

  it("localizes legacy english evaluation copy from the optimization detail payload", async () => {
    const englishApi = createOptimizationTestApi();
    const originalGetOptimizationJobDetail =
      englishApi.getOptimizationJobDetail.bind(englishApi);
    englishApi.getOptimizationJobDetail = async (jobId: string) => {
      const job = await originalGetOptimizationJobDetail(jobId);
      const firstCandidate = job.candidates[0];
      if (firstCandidate?.analysis) {
        firstCandidate.analysis.stability_summary =
          "This candidate already meets the core promotion guardrails. Use the validation windows to confirm the edge persists across different market regimes.";
        firstCandidate.analysis.stability_checks = [
          {
            key: "annualized_return",
            label: "Annualized Return",
            value: 32.9,
            verdict: "pass",
            detail:
              "Annualized return is strong enough to support promotion review.",
          },
        ];
      }
      return job;
    };
    currentApi = englishApi;

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-results-grid"),
      ).not.toBeNull(),
    );
    expect(container.textContent).toContain(
      "该候选已满足核心晋升护栏，建议结合多窗口验证确认优势在不同市场阶段中的延续性。",
    );
    expect(container.textContent).not.toContain(
      "This candidate already meets the core promotion guardrails",
    );
    expect(container.textContent).not.toContain(
      "Annualized return is strong enough to support promotion review.",
    );
  });

  it("localizes best candidate labels to chinese in the candidate table", async () => {
    const bestCandidateApi = createOptimizationTestApi();
    const originalGetOptimizationJobDetail =
      bestCandidateApi.getOptimizationJobDetail.bind(bestCandidateApi);
    bestCandidateApi.getOptimizationJobDetail = async (jobId: string) => {
      const job = await originalGetOptimizationJobDetail(jobId);
      const firstCandidate = job.candidates[0];
      if (firstCandidate) {
        firstCandidate.title = "Best candidate";
        firstCandidate.label = "Best candidate";
      }
      job.result.best_candidate_label = "Best candidate";
      return job;
    };
    currentApi = bestCandidateApi;

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-results-grid"),
      ).not.toBeNull(),
    );
    expect(container.textContent).toContain("最佳候选");
    expect(container.textContent).not.toContain("Best candidate");
  });

  it("uses chinese candidate version names and localized shelf copy for full matching combinations", async () => {
    const liveLikeApi = createOptimizationTestApi();
    const originalGetOptimizationJobDetail =
      liveLikeApi.getOptimizationJobDetail.bind(liveLikeApi);
    liveLikeApi.getOptimizationJobDetail = async (jobId: string) => {
      const job = await originalGetOptimizationJobDetail(jobId);
      if (jobId !== "opt-001") {
        return job;
      }
      const seedCandidate = job.candidates[0];
      if (!seedCandidate) {
        throw new Error("missing optimization candidate template");
      }
      const liveLikeMatches = [
        {
          ...structuredClone(seedCandidate),
          id: "trial_2402",
          label: "Trial 2402",
          title: "Trial 2402",
          rank: 1,
          summary:
            "观察周期=daily / 布林带周期=20; sharpe 0.15; oos 0.87; max drawdown -2.0%",
          parameter_snapshot: {
            ...structuredClone(seedCandidate.parameter_snapshot ?? {}),
            observation_timeframe: "daily",
          },
          analysis: {},
        },
        {
          ...structuredClone(seedCandidate),
          id: "trial_4902",
          label: "Trial 4902",
          title: "Trial 4902",
          rank: 2,
          summary:
            "观察周期=weekly / 布林带周期=20; sharpe 0.15; oos 0.87; max drawdown -2.0%",
          parameter_snapshot: {
            ...structuredClone(seedCandidate.parameter_snapshot ?? {}),
            observation_timeframe: "weekly",
          },
          analysis: {},
        },
        {
          ...structuredClone(seedCandidate),
          id: "trial_7402",
          label: "Trial 7402",
          title: "Trial 7402",
          rank: 3,
          summary:
            "观察周期=monthly / 布林带周期=20; sharpe 0.15; oos 0.87; max drawdown -2.0%",
          parameter_snapshot: {
            ...structuredClone(seedCandidate.parameter_snapshot ?? {}),
            observation_timeframe: "monthly",
          },
          analysis: {},
        },
      ];
      setMatchingCombinations(job, liveLikeMatches);
      job.summary.matching_combination_source = "all_trials";
      job.matching_combination_source = "all_trials";
      return job;
    };
    currentApi = liveLikeApi;

    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-results-grid"),
      ).not.toBeNull(),
    );

    const candidateNames = Array.from(
      container.querySelectorAll(
        ".optimization-results-card .optimization-lab-table tbody tr td:nth-child(2) strong",
      ),
    )
      .map((element) => element.textContent?.trim())
      .filter((text): text is string => Boolean(text));
    const candidateShelfCards = Array.from(
      container.querySelectorAll(".optimization-shelf-card"),
    );
    const firstCandidateShelfCard = candidateShelfCards.find((card) =>
      card.textContent?.includes("候选 1"),
    );

    expect(candidateNames).toEqual(
      expect.arrayContaining(["候选 1", "候选 2", "候选 3"]),
    );
    expect(container.textContent).not.toContain("Trial 2402");
    expect(firstCandidateShelfCard?.textContent).toContain("候选 1");
    expect(firstCandidateShelfCard?.textContent).toContain("观察周期=每日");
    expect(firstCandidateShelfCard?.textContent).toContain("收益夏普 0.15");
    expect(firstCandidateShelfCard?.textContent).toContain("样本外 0.87");
    expect(firstCandidateShelfCard?.textContent).toContain("最大回撤 -2.0%");
    expect(firstCandidateShelfCard?.textContent).not.toContain("daily");
    expect(firstCandidateShelfCard?.textContent).not.toContain("sharpe");
    expect(firstCandidateShelfCard?.textContent).not.toContain("oos");
    expect(firstCandidateShelfCard?.textContent).not.toContain("max drawdown");
  });

  it("switches the heatmap between annualized return, sharpe, and drawdown values", async () => {
    const container = await renderApp("#/optimization-jobs/opt-001");

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-heatmap-toggle"),
      ).not.toBeNull(),
    );
    const metricButtons = container.querySelectorAll(
      ".optimization-heatmap-toggle__option",
    );
    expect(metricButtons).toHaveLength(3);
    expect(metricButtons[0]?.getAttribute("aria-checked")).toBe("true");

    const firstCell = container.querySelector(
      ".optimization-heatmap-cell",
    ) as HTMLElement | null;
    expect(firstCell).toBeTruthy();
    const annualizedText = firstCell?.textContent;
    expect(annualizedText).toContain("%");

    const sharpeButton = Array.from(metricButtons).find((button) =>
      button.textContent?.includes("收益夏普"),
    ) as HTMLButtonElement;
    fireEvent.click(sharpeButton);
    await waitFor(() =>
      expect(firstCell?.textContent).not.toBe(annualizedText),
    );

    const drawdownButton = Array.from(metricButtons).find((button) =>
      button.textContent?.includes("最大回撤"),
    ) as HTMLButtonElement;
    fireEvent.click(drawdownButton);
    await waitFor(() => expect(firstCell?.textContent).toContain("%"));
  });

  it("hides terminal result modules when there is no real candidate data", async () => {
    const container = await renderApp("#/optimization-jobs/opt-empty");

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-progress-panel"),
      ).toBeNull(),
    );
    expect(container.querySelector(".optimization-results-grid")).toBeNull();
    expect(
      container.querySelector(".optimization-results-bottom-grid"),
    ).toBeNull();
    expect(container.querySelector(".optimization-shelf-grid")).toBeNull();
  });

  it("locks fixed search fields and recalculates budget combinations when the range changes", async () => {
    const container = await renderApp(
      "#/optimization-jobs/new/config?strategy_id=strat-001",
    );

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-config-grid"),
      ).not.toBeNull(),
    );

    const budgetCard = Array.from(
      container.querySelectorAll(".optimization-config-summary-card"),
    ).find((card) => card.textContent?.includes("预计组合")) as
      | HTMLElement
      | undefined;
    expect(budgetCard).toBeTruthy();
    const budgetValue = budgetCard!.querySelector(
      "strong",
    ) as HTMLElement | null;
    expect(budgetValue).toBeTruthy();
    const initialBudget = Number(budgetValue!.textContent);
    expect(initialBudget).toBeGreaterThan(0);

    const firstRow = container.querySelector(
      ".optimization-lab-table-shell--form tbody tr",
    ) as HTMLTableRowElement | null;
    expect(firstRow).toBeTruthy();

    const currentValue = firstRow!.children[1]?.textContent?.trim() ?? "";
    const modeSelect = firstRow!.querySelector(
      "select",
    ) as HTMLSelectElement | null;
    const rowInputs = firstRow!.querySelectorAll("input");
    const startInput = rowInputs[0] as HTMLInputElement;
    const endInput = rowInputs[1] as HTMLInputElement;
    const stepInput = rowInputs[2] as HTMLInputElement;

    fireEvent.change(endInput, { target: { value: "10" } });
    await waitFor(() =>
      expect(Number(budgetValue!.textContent)).toBeGreaterThan(initialBudget),
    );
    const expandedBudget = Number(budgetValue!.textContent);

    fireEvent.change(modeSelect!, { target: { value: "fixed" } });
    await waitFor(() => {
      expect(startInput.value).toBe(currentValue);
      expect(endInput.value).toBe(currentValue);
      expect(startInput.disabled).toBe(true);
      expect(endInput.disabled).toBe(true);
      expect(stepInput.disabled).toBe(true);
    });
    expect(Number(budgetValue!.textContent)).toBeLessThan(expandedBudget);
  });

  it("applies the default 100% sum constraint to multi-factor weights", async () => {
    const api = createOptimizationTestApi();
    const multiFactorStrategy: ApiStrategyDetail = {
      ...createStrategyFixture(),
      id: "strat-mf-001",
      name: "多因子策略",
      strategy_type: "MULTI_FACTOR",
      universe_name: "SP500",
      rebalance_frequency: "monthly",
      parameters: {
        strategy_type: "MULTI_FACTOR",
        factor_ids: ["s_mom_12m1m_rank", "s_val_ep_ltm_raw"],
        weights: {
          s_mom_12m1m_rank: 0.6,
          s_val_ep_ltm_raw: 0.4,
        },
        neutralization: { enabled: false, method: "industry" },
        scoring_method: "zscore_weighted",
        rebalance_frequency: "monthly",
      },
      multi_factor_profile: {
        components: [
          {
            factor_id: "s_mom_12m1m_rank",
            name: "s_mom_12m1m_rank",
            weight: 0.6,
            normalized_weight: 0.6,
          },
          {
            factor_id: "s_val_ep_ltm_raw",
            name: "s_val_ep_ltm_raw",
            weight: 0.4,
            normalized_weight: 0.4,
          },
        ],
        neutralization: {
          enabled: false,
          method: "industry",
          execution_status: "DISABLED",
        },
        scoring_method: "zscore_weighted",
        rebalance_frequency: "monthly",
      },
    };
    api.listStrategies = async () => [structuredClone(multiFactorStrategy)];
    api.getStrategyDetail = async (id: string) => {
      if (id !== multiFactorStrategy.id) {
        throw new Error(`Strategy ${id} not found`);
      }
      return structuredClone(multiFactorStrategy);
    };
    currentApi = api;

    const container = await renderApp(
      "#/optimization-jobs/new/config?strategy_id=strat-mf-001",
    );

    await waitFor(() =>
      expect(container.querySelector(".optimization-config-grid")).not.toBeNull(),
    );
    expect(container.textContent).toContain("因子权重 · 12-1月截面动量排名");
    expect(container.textContent).toContain("因子权重 · 滚动市盈率倒数 (LTM)");
    expect(container.textContent).toContain("持仓数量");
    expect(container.textContent).toContain("中性化方法");
    expect(container.textContent).not.toContain("是否启用行业中性化");
    expect(container.textContent).toContain("默认约束：权重合计 100%");

    const budgetCard = Array.from(
      container.querySelectorAll(".optimization-config-summary-card"),
    ).find((card) => card.textContent?.includes("有效组合")) as
      | HTMLElement
      | undefined;
    expect(budgetCard?.querySelector("strong")?.textContent).toBe("45");
  });

  it("keeps search range inputs editable while the user clears or types a minus sign", async () => {
    const container = await renderApp(
      "#/optimization-jobs/new/config?strategy_id=strat-001",
    );

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-config-grid"),
      ).not.toBeNull(),
    );

    const firstRow = container.querySelector(
      ".optimization-lab-table-shell--form tbody tr",
    ) as HTMLTableRowElement | null;
    expect(firstRow).toBeTruthy();

    const startInput = firstRow!.querySelectorAll(
      "input",
    )[0] as HTMLInputElement;
    expect(startInput).toBeTruthy();

    fireEvent.change(startInput, { target: { value: "" } });
    expect(startInput.value).toBe("");

    fireEvent.change(startInput, { target: { value: "-" } });
    expect(startInput.value).toBe("-");

    fireEvent.change(startInput, { target: { value: "-2" } });
    expect(startInput.value).toBe("-2");
  });
});

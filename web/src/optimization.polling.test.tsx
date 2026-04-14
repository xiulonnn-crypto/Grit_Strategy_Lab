// @vitest-environment jsdom

import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApiBacktestRunDetail,
  ApiOptimizationJobDetail,
  ApiStrategyDetail,
  DemoApi,
} from "./types";

let currentApi: DemoApi;

vi.mock("./lib/appRouteContext", () => ({
  navigateTo: vi.fn(),
}));

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
      throw new Error("useApiClient must be used inside ApiClientProvider");
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

import { ApiClientProvider } from "./lib/demoStoreContext";
import { OptimizationResultsPage } from "./pages/optimization-lab-page";

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
      key: "turnover",
      label: "换手率",
      category: "risk" as const,
      operator: "<=" as const,
      value: 120,
      baseline_value: 120,
      unit: "%",
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

function createRunningJob(): ApiOptimizationJobDetail {
  return {
    id: "opt-poll-001",
    strategy_id: "strat-001",
    status: "RUNNING",
    request: {
      objective: "sharpe",
      base_parameter_version_id: "strat-001-v1",
      source_run_id: "bt-001",
      entry_point: "run_detail",
      validation_mode: "walk_forward",
      budget_combinations: 70,
      search_space: [],
      ...defaultConstraintPayload,
    },
    summary: {
      objective: "sharpe",
      candidate_count: 0,
      baseline_parameter_version_id: "strat-001-v1",
      entry_point: "run_detail",
      validation_mode: "walk_forward",
      source_run_id: "bt-001",
      budget_combinations: 70,
      completed_combinations: 11,
      progress_pct: 16,
      current_stage: "Running trial 12/70",
      latest_update: "Completed 11/70 trials.",
      estimated_remaining_minutes: 14,
      estimated_completed_at: "2026-03-31T05:14:00.000Z",
      status: "RUNNING",
      resume_ready: false,
      persisted_trial_count: 11,
      next_trial_index: 12,
      interrupted_reason: null,
      latest_candidate_label: "Trial 1",
      best_metrics_summary: null,
      ...defaultConstraintPayload,
    },
    result: {
      best_candidate_id: null,
      best_candidate_label: null,
      baseline_parameter_version_id: "strat-001-v1",
      headline: "Optimization in progress",
      summary: "Completed 11/70 trials.",
      status: "RUNNING",
      progress_pct: 16,
      current_stage: "Running trial 12/70",
      latest_update: "Completed 11/70 trials.",
    },
    candidates: [],
    base_parameter_version_id: "strat-001-v1",
    created_at: "2026-03-31T04:30:00.000Z",
    updated_at: "2026-03-31T04:44:00.000Z",
    completed_at: null,
    resume_ready: false,
    persisted_trial_count: 11,
    next_trial_index: 12,
    interrupted_reason: null,
    best_metrics_summary: null,
  };
}

function createStrategy(): ApiStrategyDetail {
  return {
    id: "strat-001",
    name: "Momentum Strategy",
    description: "Polling test strategy",
    strategy_type: "MOMENTUM",
    universe_name: "SP500",
    parameter_history: [],
    current_parameter_version: 1,
    current_parameter_version_id: "strat-001-v1",
    latest_run_id: "bt-001",
    latest_successful_run_id: "bt-001",
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
      completed_at: "2026-03-30T04:44:00.000Z",
      sparkline_points: [],
    },
    parameters: { lookback_months: 6, top_n: 10 },
  };
}

function createRun(): ApiBacktestRunDetail {
  return {
    id: "bt-001",
    strategy_id: "strat-001",
    strategy_name: "Momentum Strategy",
    status: "COMPLETED",
    metrics: {
      total_return: 0.18,
      total_return_pct: 18,
      annualized_return: 0.124,
      sharpe: 1.18,
      out_of_sample_sharpe: 0.87,
      max_drawdown: -0.064,
      max_drawdown_pct: -6.4,
    },
    warnings: [],
    chart_series: [],
    monthly_returns: [],
    trade_details: [],
    configuration: {},
    parameter_snapshot: { lookback_months: 6, top_n: 10 },
    snapshot_summary: {
      dataset_snapshot_id: "ds-001",
      universe_snapshot_id: "un-001",
    },
    data_segment_type: "FULL",
    parameter_version_id: "strat-001-v1",
    request: {},
    is_permanent: false,
    source_run_id: null,
    trade_audit_items: [],
    trade_audit: [],
    analysis: {
      subtitle: "Backtest summary",
      kpi_cards: [],
      decision_rail: { score: 67, summary: "Backtest summary", items: [] },
    },
  };
}

beforeEach(() => {
  currentApi = {
    getOptimizationJobDetail: vi.fn().mockResolvedValue(createRunningJob()),
    getStrategyDetail: vi.fn().mockResolvedValue(createStrategy()),
    getBacktestRunDetail: vi.fn().mockResolvedValue(createRun()),
  } as unknown as DemoApi;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("optimization polling", () => {
  it("avoids overlapping detail requests while a poll is still in flight", async () => {
    vi.useFakeTimers();
    const runningJob = createRunningJob();
    let resolveRefresh: ((value: ApiOptimizationJobDetail) => void) | null =
      null;
    const pendingRefresh = new Promise<ApiOptimizationJobDetail>((resolve) => {
      resolveRefresh = resolve;
    });

    currentApi = {
      ...currentApi,
      getOptimizationJobDetail: vi
        .fn()
        .mockResolvedValueOnce(runningJob)
        .mockImplementation(() => pendingRefresh),
    } as DemoApi;

    await act(async () => {
      render(
        <ApiClientProvider>
          <OptimizationResultsPage jobId="opt-poll-001" />
        </ApiClientProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      (currentApi.getOptimizationJobDetail as ReturnType<typeof vi.fn>).mock
        .calls.length,
    ).toBe(1);

    await act(async () => {
      vi.advanceTimersByTime(220);
      await Promise.resolve();
    });

    expect(
      (currentApi.getOptimizationJobDetail as ReturnType<typeof vi.fn>).mock
        .calls.length,
    ).toBe(2);

    await act(async () => {
      resolveRefresh?.(runningJob);
      await Promise.resolve();
    });
  });
});

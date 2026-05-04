// @vitest-environment jsdom

import React from "react";
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
  ApiOptimizationJobDetail,
  ApiStrategyDetail,
  DemoApi,
} from "./types";

let currentApi: DemoApi;
const { navigateToMock } = vi.hoisted(() => ({
  navigateToMock: vi.fn(),
}));

vi.mock("./lib/appRouteContext", () => ({
  navigateTo: navigateToMock,
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

function createInterruptedJob(): ApiOptimizationJobDetail {
  return {
    id: "opt-paused-001",
    strategy_id: "strat-001",
    status: "INTERRUPTED",
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
      current_stage: "Interrupted at 11/70",
      latest_update:
        "Progress preserved at 11/70. Click Continue Optimization to resume.",
      estimated_remaining_minutes: 14,
      estimated_completed_at: "2026-03-31T05:14:00.000Z",
      status: "INTERRUPTED",
      resume_ready: true,
      persisted_trial_count: 11,
      next_trial_index: 12,
      interrupted_reason: "budget_remaining",
      latest_candidate_label: "Trial 1",
      best_metrics_summary: null,
      ...defaultConstraintPayload,
    },
    result: {
      best_candidate_id: null,
      best_candidate_label: null,
      baseline_parameter_version_id: "strat-001-v1",
      headline: "Optimization interrupted",
      summary:
        "Progress preserved at 11/70. Click Continue Optimization to resume.",
      status: "INTERRUPTED",
      progress_pct: 16,
      current_stage: "Interrupted at 11/70",
      latest_update:
        "Progress preserved at 11/70. Click Continue Optimization to resume.",
    },
    candidates: [],
    base_parameter_version_id: "strat-001-v1",
    created_at: "2026-03-31T04:30:00.000Z",
    updated_at: "2026-03-31T04:44:00.000Z",
    completed_at: null,
    resume_ready: true,
    persisted_trial_count: 11,
    next_trial_index: 12,
    interrupted_reason: "budget_remaining",
    best_metrics_summary: null,
  };
}

function createStrategy(): ApiStrategyDetail {
  return {
    id: "strat-001",
    name: "标普动量策略",
    description: "策略说明",
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
    strategy_name: "策略回测",
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
      subtitle: "分析摘要",
      kpi_cards: [],
      decision_rail: { score: 67, summary: "分析摘要", items: [] },
    },
  };
}

function setDocumentVisibilityState(isVisible: boolean): () => void {
  const previousHiddenDescriptor = Object.getOwnPropertyDescriptor(
    document,
    "hidden",
  );
  const previousVisibilityDescriptor = Object.getOwnPropertyDescriptor(
    document,
    "visibilityState",
  );

  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => !isVisible,
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (isVisible ? "visible" : "hidden"),
  });

  return () => {
    if (previousHiddenDescriptor) {
      Object.defineProperty(document, "hidden", previousHiddenDescriptor);
    } else {
      // @ts-expect-error - test environment cleanup fallback when no prior property exists
      delete (document as Document & { hidden: boolean }).hidden;
    }
    if (previousVisibilityDescriptor) {
      Object.defineProperty(document, "visibilityState", previousVisibilityDescriptor);
    } else {
      // @ts-expect-error - test environment cleanup fallback when no prior property exists
      delete (document as Document & { visibilityState: string }).visibilityState;
    }
  };
}

async function renderPage(): Promise<HTMLElement> {
  let container: HTMLElement | null = null;
  await act(async () => {
    ({ container } = render(
      <ApiClientProvider>
        <OptimizationResultsPage jobId="opt-paused-001" />
      </ApiClientProvider>,
    ));
  });
  return container!;
}

beforeEach(() => {
  const pausedJob = createInterruptedJob();
  currentApi = {
    getOptimizationJobDetail: vi.fn().mockResolvedValue(pausedJob),
    getStrategyDetail: vi.fn().mockResolvedValue(createStrategy()),
    getBacktestRunDetail: vi.fn().mockResolvedValue(createRun()),
    resumeOptimizationJob: vi.fn().mockResolvedValue({
      ...pausedJob,
      status: "QUEUED",
      summary: {
        ...pausedJob.summary,
        status: "QUEUED",
        resume_ready: false,
        interrupted_reason: null,
        current_stage: "Preparing trial 12/70",
        latest_update: "Resuming optimization from trial 12.",
      },
      result: {
        ...pausedJob.result,
        status: "QUEUED",
        current_stage: "Preparing trial 12/70",
        latest_update: "Resuming optimization from trial 12.",
      },
    }),
  } as unknown as DemoApi;
  navigateToMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("optimization results progress state", () => {
  it("renders paused jobs inside the optimization in-progress panel and supports resume", async () => {
    const container = await renderPage();

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-progress-panel"),
      ).not.toBeNull(),
    );
    expect(container.querySelector(".optimization-results-grid")).toBeNull();

    const continueButton = container.querySelector(
      ".optimization-hero-actions .primary-button",
    ) as HTMLButtonElement | null;
    expect(continueButton).toBeTruthy();

    fireEvent.click(continueButton!);

    await waitFor(() =>
      expect(
        (currentApi.resumeOptimizationJob as ReturnType<typeof vi.fn>).mock
          .calls.length,
      ).toBe(1),
    );
    expect(
      (currentApi.resumeOptimizationJob as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0],
    ).toBe("opt-paused-001");
    expect(
      (currentApi.resumeOptimizationJob as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[1],
    ).toBe("resume-opt-paused-001-12");
    expect(container.textContent).toContain("准备试验 12/70");
    expect(container.textContent).toContain("正在从第 12 组继续优化。");
    expect(container.textContent).not.toContain("Preparing trial 12/70");
    expect(container.textContent).not.toContain(
      "Resuming optimization from trial 12.",
    );
    expect(
      container.querySelector(".optimization-inline-notice")?.textContent,
    ).toContain("已继续优化");
  });

  it("translates running progress updates into Chinese", async () => {
    const runningJob = createInterruptedJob();
    runningJob.status = "RUNNING";
    runningJob.summary = {
      ...runningJob.summary,
      status: "RUNNING",
      resume_ready: false,
      interrupted_reason: null,
      budget_combinations: 5700,
      completed_combinations: 1419,
      persisted_trial_count: 1419,
      next_trial_index: 1420,
      current_stage: "Running trial 1420/5700",
      latest_update: "Completed 1419/5700 trials.",
    };
    runningJob.result = {
      ...runningJob.result,
      status: "RUNNING",
      progress_pct: 25,
      current_stage: "Running trial 1420/5700",
      latest_update: "Completed 1419/5700 trials.",
    };
    runningJob.resume_ready = false;
    runningJob.persisted_trial_count = 1419;
    runningJob.next_trial_index = 1420;
    runningJob.interrupted_reason = null;

    currentApi = {
      ...currentApi,
      getOptimizationJobDetail: vi.fn().mockResolvedValue(runningJob),
    } as DemoApi;

    const container = await renderPage();

    await waitFor(() =>
      expect(
        container.querySelector(".optimization-progress-panel"),
      ).not.toBeNull(),
    );
    expect(container.textContent).toContain("正在评估第 1420/5700 组");
    expect(container.textContent).toContain("已完成 1419/5700 组试验。");
    expect(container.textContent).not.toContain("Running trial 1420/5700");
    expect(container.textContent).not.toContain("Completed 1419/5700 trials.");
  });

  it("does not show a resumed notice when the job remains interrupted", async () => {
    const pausedJob = createInterruptedJob();
    currentApi = {
      ...currentApi,
      getOptimizationJobDetail: vi.fn().mockResolvedValue(pausedJob),
      resumeOptimizationJob: vi.fn().mockResolvedValue(pausedJob),
    } as DemoApi;

    const container = await renderPage();

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
        (currentApi.resumeOptimizationJob as ReturnType<typeof vi.fn>).mock
          .calls.length,
      ).toBe(1),
    );
    expect(container.querySelector(".optimization-inline-notice")).toBeNull();
    expect(container.querySelector(".error-banner")?.textContent).toContain(
      "继续优化未启动",
    );
  });

  it("stops polling when the page is hidden and refreshes immediately when visible again", async () => {
    const restoreVisibility = setDocumentVisibilityState(true);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const runningJob = createInterruptedJob();
    runningJob.status = "RUNNING";
    runningJob.summary = {
      ...runningJob.summary,
      status: "RUNNING",
      resume_ready: false,
      interrupted_reason: null,
      completed_combinations: 11,
      persisted_trial_count: 11,
      next_trial_index: 12,
      current_stage: "Running trial 12/70",
      latest_update: "Completed 11/70 trials.",
      budget_combinations: 70,
    };
    runningJob.result = {
      ...runningJob.result,
      status: "RUNNING",
      progress_pct: 16,
      current_stage: "Running trial 12/70",
      latest_update: "Completed 11/70 trials.",
      headline: "Optimization in progress",
      summary: "Completed 11/70 trials.",
    };
    currentApi = {
      ...currentApi,
      getOptimizationJobDetail: vi.fn().mockResolvedValue(runningJob),
    };

    await renderPage();

    const getOptimizationJobDetail = currentApi
      .getOptimizationJobDetail as ReturnType<typeof vi.fn>;
    await Promise.resolve();
    const initialCallCount = getOptimizationJobDetail.mock.calls.length;
    expect(initialCallCount).toBeGreaterThan(0);

    await act(async () => {
      vi.advanceTimersByTime(2200);
      await Promise.resolve();
    });
    const callAfterSchedule = getOptimizationJobDetail.mock.calls.length;
    expect(callAfterSchedule).toBeGreaterThan(initialCallCount);

    const restoreHidden = setDocumentVisibilityState(false);
    await act(async () => {
      fireEvent(document, new Event("visibilitychange"));
      await Promise.resolve();
      await Promise.resolve();
    });
    const callAfterHidden = getOptimizationJobDetail.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(10000);
      await Promise.resolve();
    });
    expect(getOptimizationJobDetail.mock.calls.length).toBe(callAfterHidden);

    const restoreVisible = setDocumentVisibilityState(true);
    act(() => {
      fireEvent(document, new Event("visibilitychange"));
    });
    await Promise.resolve();
    expect(getOptimizationJobDetail.mock.calls.length).toBe(callAfterHidden + 1);
    restoreHidden();
    restoreVisible();
    restoreVisibility();
  });
});

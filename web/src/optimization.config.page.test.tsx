import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApiBacktestRunDetail,
  ApiOptimizationJobCreatePayload,
  ApiStrategyDetail,
} from "./types";

let OptimizationConfigPage: typeof import("./pages/optimization-lab-page").OptimizationConfigPage;
const optimizationLabPageCss = readFileSync(
  "./src/pages/optimization-lab-page.css",
  "utf8",
);

const fakeApi = vi.hoisted(() => ({
  createOptimizationJob: vi.fn(),
  getBacktestRunDetail: vi.fn(),
  getStrategyDetail: vi.fn(),
})) as {
  createOptimizationJob: ReturnType<typeof vi.fn>;
  getBacktestRunDetail: ReturnType<typeof vi.fn>;
  getStrategyDetail: ReturnType<typeof vi.fn>;
};

vi.mock("./lib/demoStoreContext", () => ({
  useApiClient: () => fakeApi,
}));

const strategyDetail: ApiStrategyDetail = {
  id: "strat-mean-001",
  name: "QQQ均值回归策略",
  description: "使用布林带、RSI 和仓位规则执行均值回归。",
  strategy_type: "MEAN_REVERSION",
  universe_name: "QQQ",
  benchmark_symbol: "QQQ",
  rebalance_frequency: "never",
  lifecycle_status: "ACTIVE",
  latest_run_id: "run-seed",
  latest_successful_run_id: "run-seed",
  latest_optimization_job_id: null,
  current_parameter_version: 2,
  current_parameter_version_id: "strat-mean-001-v2",
  dataset_snapshot_id: "ds-price",
  universe_snapshot_id: null,
  created_at: "2026-04-10T08:00:00Z",
  updated_at: "2026-04-10T09:00:00Z",
  parameters: {
    strategy_name: "QQQ均值回归策略",
    strategy_description: "使用布林带、RSI 和仓位规则执行均值回归。",
    benchmark_symbol: "QQQ",
    observation_timeframe: "daily",
    trading_logic: "跌破下轨且 RSI 超卖时买入，突破上轨且 RSI 超买时卖出。",
    bollinger_period: 20,
    rsi_period: 6,
    rsi_buy_threshold: 30,
    rsi_sell_threshold: 80,
    atr_period: 14,
    take_profit_atr: 1.5,
    stop_loss_atr: 1,
    long_entry_size_pct: 5,
    short_entry_size_pct: 5,
  },
  parameter_history: [],
  confirmation_fields: {
    top_level: [
      {
        key: "strategy_type",
        label: "策略类型",
        value: "MEAN_REVERSION",
        source: "user_input",
      },
      {
        key: "universe_name",
        label: "股票池",
        value: "QQQ",
        source: "user_input",
      },
      {
        key: "rebalance_frequency",
        label: "再平衡频次",
        value: "never",
        source: "system_default",
      },
    ],
    parameters: [
      {
        key: "strategy_name",
        label: "策略名称",
        value: "QQQ均值回归策略",
        source: "user_input",
      },
      {
        key: "strategy_description",
        label: "策略描述",
        value: "使用布林带、RSI 和仓位规则执行均值回归。",
        source: "system_inference",
      },
      {
        key: "benchmark_symbol",
        label: "基准",
        value: "QQQ",
        source: "system_inference",
      },
      {
        key: "observation_timeframe",
        label: "观察周期",
        value: "daily",
        source: "user_input",
      },
      {
        key: "trading_logic",
        label: "交易逻辑",
        value: "跌破下轨且 RSI 超卖时买入，突破上轨且 RSI 超买时卖出。",
        source: "system_inference",
      },
      {
        key: "bollinger_period",
        label: "布林带周期",
        value: 20,
        source: "user_input",
      },
      { key: "rsi_period", label: "RSI周期", value: 6, source: "user_input" },
      {
        key: "rsi_buy_threshold",
        label: "RSI超卖阈值",
        value: 30,
        source: "user_input",
      },
      {
        key: "rsi_sell_threshold",
        label: "RSI超买阈值",
        value: 80,
        source: "user_input",
      },
      { key: "atr_period", label: "ATR周期", value: 14, source: "user_input" },
      {
        key: "take_profit_atr",
        label: "止盈倍数(ATR)",
        value: 1.5,
        source: "user_input",
      },
      {
        key: "stop_loss_atr",
        label: "止损倍数(ATR)",
        value: 1,
        source: "user_input",
      },
      {
        key: "long_entry_size_pct",
        label: "买入仓位(%)",
        value: 5,
        source: "user_input",
      },
      {
        key: "short_entry_size_pct",
        label: "卖出仓位(%)",
        value: 5,
        source: "user_input",
      },
    ],
  },
  allowed_actions: ["open_optimization"],
};

const sourceRunDetail: ApiBacktestRunDetail = {
  id: "run-seed",
  strategy_id: "strat-mean-001",
  status: "COMPLETED",
  metrics: {},
  parameter_snapshot: {
    ...strategyDetail.parameters,
    long_entry_size_pct: 10,
    short_entry_size_pct: 10,
  },
};

const momentumStrategyDetail: ApiStrategyDetail = {
  id: "strat-momentum-001",
  name: "标普动量策略",
  description: "按回看区间筛选强势股票，并按设定频率调仓。",
  strategy_type: "MOMENTUM",
  universe_name: "SP500",
  benchmark_symbol: "SPY",
  rebalance_frequency: "semiannual",
  lifecycle_status: "ACTIVE",
  latest_run_id: "run-momentum-seed",
  latest_successful_run_id: "run-momentum-seed",
  latest_optimization_job_id: null,
  current_parameter_version: 3,
  current_parameter_version_id: "strat-momentum-001-v3",
  dataset_snapshot_id: "ds-momentum",
  universe_snapshot_id: null,
  created_at: "2026-04-10T08:00:00Z",
  updated_at: "2026-04-10T09:00:00Z",
  parameters: {
    strategy_name: "标普动量策略",
    strategy_description: "按回看区间筛选强势股票，并按设定频率调仓。",
    benchmark_symbol: "SPY",
    lookback_months: 12,
    skip_recent_months: 1,
    top_n: 20,
    hold_rank_threshold: 120,
    weighting_method: "equal_weight",
  },
  parameter_history: [],
  confirmation_fields: {
    top_level: [
      {
        key: "strategy_type",
        label: "策略类型",
        value: "MOMENTUM",
        source: "user_input",
      },
      {
        key: "universe_name",
        label: "股票池",
        value: "SP500",
        source: "user_input",
      },
      {
        key: "rebalance_frequency",
        label: "调仓频率",
        value: "semiannual",
        source: "system_default",
      },
    ],
    parameters: [
      {
        key: "strategy_name",
        label: "策略名称",
        value: "标普动量策略",
        source: "user_input",
      },
      {
        key: "strategy_description",
        label: "策略描述",
        value: "按回看区间筛选强势股票，并按设定频率调仓。",
        source: "system_inference",
      },
      {
        key: "benchmark_symbol",
        label: "基准",
        value: "SPY",
        source: "system_inference",
      },
      {
        key: "lookback_months",
        label: "回看(月)",
        value: 12,
        source: "user_input",
      },
      {
        key: "skip_recent_months",
        label: "跳过最近(月)",
        value: 1,
        source: "user_input",
      },
      {
        key: "top_n",
        label: "买入排名阈值",
        value: 20,
        source: "user_input",
      },
      {
        key: "hold_rank_threshold",
        label: "保留排名阈值",
        value: 120,
        source: "user_input",
      },
      {
        key: "weighting_method",
        label: "权重方法",
        value: "equal_weight",
        source: "user_input",
      },
    ],
  },
  allowed_actions: ["open_optimization"],
};

const momentumSourceRunDetail: ApiBacktestRunDetail = {
  id: "run-momentum-seed",
  strategy_id: "strat-momentum-001",
  status: "COMPLETED",
  metrics: {},
  parameter_snapshot: {
    ...momentumStrategyDetail.parameters,
    top_n: 25,
  },
};

const staleGridStrategyDetail: ApiStrategyDetail = {
  id: "strat-grid-001",
  name: "SPY网格交易策略",
  description: "围绕 SPY 做网格交易。",
  strategy_type: "GRID",
  universe_name: "SPY",
  benchmark_symbol: "SPY",
  rebalance_frequency: "never",
  lifecycle_status: "ACTIVE",
  latest_run_id: "run-grid-latest",
  latest_successful_run_id: "run-grid-latest",
  latest_optimization_job_id: null,
  current_parameter_version: 2,
  current_parameter_version_id: "strat-grid-001-v2",
  dataset_snapshot_id: "ds-grid",
  universe_snapshot_id: null,
  created_at: "2026-04-10T08:00:00Z",
  updated_at: "2026-04-10T09:00:00Z",
  parameters: {
    strategy_name: "SPY网格交易策略",
    strategy_description: "围绕 SPY 做网格交易。",
    benchmark_symbol: "SPY",
    initial_position: 40,
    grid_interval: 2,
    buy_size_pct: 20,
    sell_step_pct: 6,
    sell_size_pct: 20,
    max_stop_loss_pct: -60,
    capital: 10000,
    strategy_type: "GRID",
    universe_name: "SPY",
    rebalance_frequency: "never",
  },
  parameter_history: [],
  confirmation_fields: {
    top_level: [
      {
        key: "strategy_type",
        label: "策略类型",
        value: "GRID",
        source: "user_input",
      },
      {
        key: "universe_name",
        label: "股票池",
        value: "SPY",
        source: "user_input",
      },
      {
        key: "rebalance_frequency",
        label: "再平衡频次",
        value: "never",
        source: "system_default",
      },
    ],
    parameters: [
      {
        key: "strategy_name",
        label: "策略名称",
        value: "SPY网格交易策略",
        source: "user_input",
      },
      {
        key: "strategy_description",
        label: "策略描述",
        value: "围绕 SPY 做网格交易。",
        source: "system_inference",
      },
      {
        key: "benchmark_symbol",
        label: "基准",
        value: "SPY",
        source: "system_inference",
      },
      {
        key: "initial_position",
        label: "初始仓位(%)",
        value: 20,
        source: "user_input",
      },
      {
        key: "grid_interval",
        label: "网格间距(%)",
        value: 2,
        source: "user_input",
      },
      {
        key: "buy_size_pct",
        label: "买入仓位(%)",
        value: 10,
        source: "user_input",
      },
      {
        key: "sell_step_pct",
        label: "卖出梯度(%)",
        value: 5,
        source: "user_input",
      },
      {
        key: "sell_size_pct",
        label: "卖出仓位(%)",
        value: 5,
        source: "user_input",
      },
    ],
  },
  allowed_actions: ["open_optimization"],
};

beforeEach(async () => {
  vi.resetModules();
  fakeApi.createOptimizationJob.mockReset();
  fakeApi.getBacktestRunDetail.mockReset();
  fakeApi.getStrategyDetail.mockReset();
  fakeApi.createOptimizationJob.mockResolvedValue({ id: "opt-001" });
  fakeApi.getStrategyDetail.mockResolvedValue(strategyDetail);
  fakeApi.getBacktestRunDetail.mockResolvedValue(sourceRunDetail);
  ({ OptimizationConfigPage } = await import("./pages/optimization-lab-page"));
});

afterEach(() => {
  cleanup();
});

describe("OptimizationConfigPage", () => {
  it("renders the constraint panel alongside the parameter range table", async () => {
    render(
      <OptimizationConfigPage
        strategyId="strat-mean-001"
        sourceRunId="run-seed"
        entryPoint="run_detail"
      />,
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "QQQ均值回归策略" }),
    ).toBeInTheDocument();
    expect(screen.getByText("参数范围")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "约束条件" }),
    ).toBeInTheDocument();
    expect(screen.getByText("观察周期")).toBeInTheDocument();
    expect(screen.getByText("布林带周期")).toBeInTheDocument();
    expect(screen.getByText("RSI周期")).toBeInTheDocument();
    expect(
      document.querySelector(".optimization-constraint-panel"),
    ).not.toBeNull();
    expect(
      screen.getByRole("option", { name: "滚动前瞻验证" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "收益夏普 Max" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "年化收益率 Max" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "综合得分 Max" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("标签")).not.toBeInTheDocument();
  });

  it("renders observation timeframe as a discrete multi-select and sends selected values", async () => {
    render(
      <OptimizationConfigPage
        strategyId="strat-mean-001"
        sourceRunId="run-seed"
        entryPoint="run_detail"
      />,
    );

    await screen.findByRole("heading", { level: 1, name: "QQQ均值回归策略" });

    const timeframeTrigger = screen.getByRole("button", {
      name: "观察周期 可选值",
    });
    expect(timeframeTrigger).toHaveTextContent("每日");

    fireEvent.click(timeframeTrigger);

    const timeframeListbox = await screen.findByRole("listbox", {
      name: "观察周期 可选值",
    });
    const timeframeOptions = within(timeframeListbox).getAllByRole("checkbox");

    expect(
      timeframeOptions.map(
        (option) =>
          (option as HTMLInputElement).nextElementSibling?.textContent?.trim(),
      ),
    ).toEqual([
      "每日",
      "每周",
      "每月",
    ]);
    expect(
      timeframeOptions
        .filter((option) => (option as HTMLInputElement).checked)
        .map(
          (option) =>
            (option as HTMLInputElement).nextElementSibling?.textContent?.trim(),
        ),
    ).toEqual(["每日"]);
    fireEvent.click(within(timeframeListbox).getByLabelText("每周"));
    fireEvent.click(within(timeframeListbox).getByLabelText("每月"));

    fireEvent.click(screen.getByRole("button", { name: "启动优化" }));

    await waitFor(() =>
      expect(fakeApi.createOptimizationJob).toHaveBeenCalledTimes(1),
    );
    const payload = fakeApi.createOptimizationJob.mock
      .calls[0]?.[1] as ApiOptimizationJobCreatePayload;
    const observationField = payload.search_space?.find(
      (field) => field.key === "observation_timeframe",
    );

    expect(observationField).toMatchObject({
      key: "observation_timeframe",
      label: "观察周期",
      mode: "discrete",
      current: "daily",
      value: "daily",
      values: ["daily", "weekly", "monthly"],
    });
  });

  it("renders momentum rebalance frequency as a discrete multi-select and sends selected values", async () => {
    fakeApi.getStrategyDetail.mockResolvedValue(momentumStrategyDetail);
    fakeApi.getBacktestRunDetail.mockResolvedValue(momentumSourceRunDetail);

    render(
      <OptimizationConfigPage
        strategyId="strat-momentum-001"
        sourceRunId="run-momentum-seed"
        entryPoint="strategy_detail"
      />,
    );

    await screen.findByRole("heading", { level: 1, name: "标普动量策略" });

    const rebalanceTrigger = screen.getByRole("button", {
      name: "调仓频率 可选值",
    });
    expect(rebalanceTrigger).toHaveTextContent("每半年");

    fireEvent.click(rebalanceTrigger);

    const rebalanceListbox = await screen.findByRole("listbox", {
      name: "调仓频率 可选值",
    });
    const rebalanceOptions = within(rebalanceListbox).getAllByRole("checkbox");

    expect(
      rebalanceOptions.map(
        (option) =>
          (option as HTMLInputElement).nextElementSibling?.textContent?.trim(),
      ),
    ).toEqual(["每月", "每季度", "每半年", "每年"]);
    expect(
      rebalanceOptions
        .filter((option) => (option as HTMLInputElement).checked)
        .map((option) => (option as HTMLInputElement).value),
    ).toEqual(["semiannual"]);

    fireEvent.click(within(rebalanceListbox).getByLabelText("每月"));
    fireEvent.click(within(rebalanceListbox).getByLabelText("每季度"));
    fireEvent.click(within(rebalanceListbox).getByLabelText("每年"));

    fireEvent.click(screen.getByRole("button", { name: "启动优化" }));

    await waitFor(() =>
      expect(fakeApi.createOptimizationJob).toHaveBeenCalledTimes(1),
    );
    const payload = fakeApi.createOptimizationJob.mock
      .calls[0]?.[1] as ApiOptimizationJobCreatePayload;
    const rebalanceField = payload.search_space?.find(
      (field) => field.key === "rebalance_frequency",
    );

    expect(rebalanceField).toMatchObject({
      key: "rebalance_frequency",
      label: "调仓频率",
      mode: "discrete",
      current: "semiannual",
      value: "monthly",
      values: ["monthly", "quarterly", "semiannual", "yearly"],
    });
  });

  it("prefers current strategy parameters over stale confirmation fields for lab-entry jobs", async () => {
    fakeApi.getStrategyDetail.mockResolvedValue(staleGridStrategyDetail);

    render(
      <OptimizationConfigPage
        strategyId="strat-grid-001"
        entryPoint="lab_menu"
      />,
    );

    await screen.findByRole("heading", { level: 1, name: "SPY网格交易策略" });

    const initialPositionRow = screen
      .getByText("初始仓位(%)")
      .closest("tr") as HTMLTableRowElement | null;
    expect(initialPositionRow).toBeTruthy();
    expect(within(initialPositionRow!).getByText("40")).toBeInTheDocument();
    expect(within(initialPositionRow!).queryByText("20")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "启动优化" }));

    await waitFor(() =>
      expect(fakeApi.createOptimizationJob).toHaveBeenCalledTimes(1),
    );
    const payload = fakeApi.createOptimizationJob.mock
      .calls[0]?.[1] as ApiOptimizationJobCreatePayload;
    const initialPositionField = payload.search_space?.find(
      (field) => field.key === "initial_position",
    );
    const buySizeField = payload.search_space?.find(
      (field) => field.key === "buy_size_pct",
    );

    expect(payload.base_parameter_version_id).toBe("strat-grid-001-v2");
    expect(initialPositionField).toMatchObject({ current: 40 });
    expect(buySizeField).toMatchObject({ current: 20 });
  });

  it("sends constraint fields with the optimization payload", async () => {
    render(
      <OptimizationConfigPage
        strategyId="strat-mean-001"
        sourceRunId="run-seed"
        entryPoint="run_detail"
      />,
    );

    await screen.findByRole("heading", { level: 1, name: "QQQ均值回归策略" });
    fireEvent.click(screen.getByRole("button", { name: "启动优化" }));

    await waitFor(() =>
      expect(fakeApi.createOptimizationJob).toHaveBeenCalledTimes(1),
    );
    const payload = fakeApi.createOptimizationJob.mock
      .calls[0]?.[1] as ApiOptimizationJobCreatePayload;

    expect(payload.objective).toBe("return_sharpe");
    expect(payload.constraint_preset_key).toBe("balanced");
    expect(payload.constraint_label).toBe("平衡型");
    expect(Array.isArray(payload.constraints)).toBe(true);
    expect(payload.constraints).toHaveLength(5);
    expect(payload.constraints?.some((item) => item.key === "turnover")).toBe(
      false,
    );
  });

  it("resets validation mode, range fields, and constraint thresholds together", async () => {
    const { container } = render(
      <OptimizationConfigPage
        strategyId="strat-mean-001"
        sourceRunId="run-seed"
        entryPoint="run_detail"
      />,
    );

    await screen.findByRole("heading", { level: 1, name: "QQQ均值回归策略" });

    const firstEditableRow = Array.from(
      container.querySelectorAll(
        ".optimization-lab-table-shell--form tbody tr",
      ),
    ).find((row) => row.querySelector("input:not([disabled])")) as
      | HTMLTableRowElement
      | undefined;
    expect(firstEditableRow).toBeTruthy();
    const rowInputs = firstEditableRow!.querySelectorAll("input");
    const endInput = rowInputs[1] as HTMLInputElement;
    const originalEndValue = endInput.value;
    fireEvent.change(endInput, { target: { value: "14" } });

    const constraintInput = screen.getByLabelText(
      "最大回撤 阈值",
    ) as HTMLInputElement;
    const originalConstraintValue = constraintInput.value;
    fireEvent.change(constraintInput, { target: { value: "17" } });

    const validationSelect = container.querySelector(
      "select:not([aria-label])",
    ) as HTMLSelectElement | null;
    expect(validationSelect).toBeTruthy();
    fireEvent.change(validationSelect!, {
      target: { value: "single_oos" },
    });

    fireEvent.click(screen.getByRole("button", { name: "恢复预设" }));

    await waitFor(() => {
      expect(validationSelect!.value).toBe("walk_forward");
      expect(endInput.value).toBe(originalEndValue);
      expect(constraintInput.value).toBe(originalConstraintValue);
    });
  });

  it("keeps the parameter range table inside the available panel width", async () => {
    const { container } = render(
      <OptimizationConfigPage
        strategyId="strat-mean-001"
        sourceRunId="run-seed"
        entryPoint="run_detail"
      />,
    );

    await screen.findByRole("heading", { level: 1, name: "QQQ均值回归策略" });

    const tableShell = container.querySelector(
      ".optimization-lab-table-shell--form",
    ) as HTMLDivElement | null;
    const table = tableShell?.querySelector(
      ".optimization-lab-table",
    ) as HTMLTableElement | null;
    const firstRowLabel = table?.querySelector("tbody td") as
      | HTMLTableCellElement
      | null;

    expect(tableShell).toBeTruthy();
    expect(table).toBeTruthy();
    expect(firstRowLabel).toBeTruthy();
    expect(optimizationLabPageCss).toMatch(
      /\.optimization-lab-table-shell--form\s*\{[^}]*overflow-x:\s*hidden;/s,
    );
    expect(optimizationLabPageCss).toMatch(
      /\.optimization-lab-table-shell--form\s+\.optimization-lab-table\s*\{[^}]*min-width:\s*0;[^}]*table-layout:\s*fixed;/s,
    );
    expect(optimizationLabPageCss).toMatch(
      /\.optimization-lab-table-shell--form\s+\.optimization-lab-table\s+th,\s*\.optimization-lab-table-shell--form\s+\.optimization-lab-table\s+td\s*\{[^}]*white-space:\s*normal;/s,
    );
  });

  it("renders each hard guard as a single readable rule line", async () => {
    const { container } = render(
      <OptimizationConfigPage
        strategyId="strat-mean-001"
        sourceRunId="run-seed"
        entryPoint="run_detail"
      />,
    );

    await screen.findByRole("heading", { level: 1, name: "QQQ均值回归策略" });

    const firstCard = container.querySelector(
      ".optimization-constraint-card",
    ) as HTMLElement | null;
    const topline = firstCard?.querySelector(
      ".optimization-constraint-card__topline",
    ) as HTMLDivElement | null;
    const rule = firstCard?.querySelector(
      ".optimization-constraint-card__rule",
    ) as HTMLLabelElement | null;
    const ruleLabel = firstCard?.querySelector(
      ".optimization-constraint-card__rule-label",
    ) as HTMLSpanElement | null;
    const ruleOperator = firstCard?.querySelector(
      ".optimization-constraint-card__rule-operator",
    ) as HTMLSpanElement | null;
    const ruleInput = screen.getByLabelText(
      "最大回撤 阈值",
    ) as HTMLInputElement;
    const ruleUnit = firstCard?.querySelector(
      ".optimization-constraint-card__rule-unit",
    ) as HTMLSpanElement | null;
    const badges = firstCard?.querySelector(
      ".optimization-constraint-card__badges",
    ) as HTMLDivElement | null;
    const baselineChip = firstCard?.querySelector(
      ".optimization-constraint-card__badge--baseline",
    ) as HTMLSpanElement | null;
    const verdictChip = firstCard?.querySelector(
      ".optimization-constraint-card__verdict",
    ) as HTMLSpanElement | null;

    expect(firstCard).toBeTruthy();
    expect(topline).toBeTruthy();
    expect(rule).toBeTruthy();
    expect(ruleLabel?.textContent).toBe("最大回撤");
    expect(ruleOperator?.textContent).toBe("≤");
    expect(ruleInput.value).toBe("25");
    expect(ruleUnit?.textContent).toBe("%");
    expect(badges).toBeTruthy();
    expect(baselineChip).toBeTruthy();
    expect(verdictChip).toBeNull();
    expect(firstCard?.textContent).not.toContain("当前判定");
    expect(firstCard?.textContent).not.toContain("阈值");
    expect(optimizationLabPageCss).toMatch(
      /\.optimization-constraint-card__rule\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*nowrap;/s,
    );
    expect(optimizationLabPageCss).toMatch(
      /\.optimization-constraint-card__rule-input\s*\{[^}]*text-align:\s*right;/s,
    );
    expect(optimizationLabPageCss).toMatch(
      /\.optimization-constraint-card__badges\s*\{[^}]*display:\s*grid;/s,
    );
    expect(optimizationLabPageCss).toMatch(
      /\.optimization-constraint-card__rule-label\s*\{[^}]*white-space:\s*nowrap;/s,
    );
  });
});

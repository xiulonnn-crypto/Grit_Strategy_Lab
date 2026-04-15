import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
    expect(screen.queryByText("标签")).not.toBeInTheDocument();
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

    expect(payload.constraint_preset_key).toBe("balanced");
    expect(payload.constraint_label).toBe("平衡型");
    expect(Array.isArray(payload.constraints)).toBe(true);
    expect(payload.constraints).toHaveLength(6);
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

  it("uses wrapped hard-guard badges instead of overflow-prone inline chips", async () => {
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
    const operator = firstCard?.querySelector(
      ".optimization-constraint-card__operator",
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
    expect(operator).toBeTruthy();
    expect(badges).toBeTruthy();
    expect(baselineChip).toBeTruthy();
    expect(verdictChip).toBeTruthy();
    expect(optimizationLabPageCss).toMatch(
      /\.optimization-constraint-card__topline\s*\{[^}]*flex-wrap:\s*wrap;/s,
    );
    expect(optimizationLabPageCss).toMatch(
      /\.optimization-constraint-card__category,\s*\.optimization-constraint-card__operator\s*\{[^}]*white-space:\s*normal;/s,
    );
    expect(optimizationLabPageCss).toMatch(
      /\.optimization-constraint-card__badges\s*\{[^}]*display:\s*grid;/s,
    );
    expect(optimizationLabPageCss).toMatch(
      /\.optimization-constraint-card__badge\s*\{[^}]*width:\s*100%;[^}]*overflow-wrap:\s*anywhere;/s,
    );
    expect(optimizationLabPageCss).toMatch(
      /\.optimization-constraint-card__verdict\s*\{[^}]*white-space:\s*normal;/s,
    );
  });
});

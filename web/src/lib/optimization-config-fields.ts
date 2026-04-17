import type { ApiStrategyDetail, ParameterValue, StrategyType } from "../types";

type OptimizationFieldControl = "text" | "select" | "multiselect";

type OptimizationFieldOption = {
  value: string;
  label: string;
};

type OptimizationFieldDefinition = {
  key: string;
  label: string;
  control: OptimizationFieldControl;
  options?: OptimizationFieldOption[];
};

export type OptimizationParameterSeed = {
  key: string;
  label: string;
  control: OptimizationFieldControl;
  value: ParameterValue;
  options?: OptimizationFieldOption[];
};

export const OBSERVATION_TIMEFRAME_OPTIONS: OptimizationFieldOption[] = [
  { value: "daily", label: "每日" },
  { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月" },
];

export const MOMENTUM_REBALANCE_FREQUENCY_OPTIONS: OptimizationFieldOption[] = [
  { value: "monthly", label: "每月" },
  { value: "quarterly", label: "每季度" },
  { value: "semiannual", label: "每半年" },
  { value: "yearly", label: "每年" },
];

const OPTIMIZATION_SELECTION_FIELDS: Partial<
  Record<StrategyType, OptimizationFieldDefinition[]>
> = {
  GRID: [
    { key: "initial_position", label: "初始仓位(%)", control: "text" },
    { key: "grid_interval", label: "网格间距(%)", control: "text" },
    { key: "buy_size_pct", label: "买入仓位(%)", control: "text" },
    { key: "sell_step_pct", label: "卖出梯度(%)", control: "text" },
    { key: "sell_size_pct", label: "卖出仓位(%)", control: "text" },
  ],
  BUY_AND_HOLD: [
    { key: "contribution_amount", label: "定投金额(USD)", control: "text" },
    { key: "investment_frequency", label: "定投频率", control: "select" },
  ],
  MOMENTUM: [
    { key: "lookback_months", label: "回看(月)", control: "text" },
    { key: "skip_recent_months", label: "跳过最近(月)", control: "text" },
    { key: "top_n", label: "买入排名阈值", control: "text" },
    { key: "hold_rank_threshold", label: "保留排名阈值", control: "text" },
    {
      key: "rebalance_frequency",
      label: "调仓频率",
      control: "multiselect",
      options: MOMENTUM_REBALANCE_FREQUENCY_OPTIONS,
    },
    { key: "weighting_method", label: "权重方法", control: "select" },
  ],
  MEAN_REVERSION: [
    {
      key: "observation_timeframe",
      label: "观察周期",
      control: "multiselect",
      options: OBSERVATION_TIMEFRAME_OPTIONS,
    },
    { key: "bollinger_period", label: "布林带周期", control: "text" },
    { key: "rsi_period", label: "RSI周期", control: "text" },
    { key: "rsi_buy_threshold", label: "RSI超卖阈值", control: "text" },
    { key: "rsi_sell_threshold", label: "RSI超买阈值", control: "text" },
    { key: "long_entry_size_pct", label: "买入仓位(%)", control: "text" },
    { key: "short_entry_size_pct", label: "卖出仓位(%)", control: "text" },
  ],
};

function hasParameterValue(value: ParameterValue | undefined): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return true;
}

function readParameterValue(value: unknown): ParameterValue | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return undefined;
}

function readStrategyFieldValue(
  strategy: ApiStrategyDetail,
  key: string,
): ParameterValue | undefined {
  return readParameterValue((strategy as Record<string, unknown>)[key]);
}

export function collectOptimizationParameterSeeds(
  strategy: ApiStrategyDetail,
  parameterSnapshot?: Record<string, ParameterValue> | null,
): OptimizationParameterSeed[] {
  const configuredFields = OPTIMIZATION_SELECTION_FIELDS[strategy.strategy_type] ?? [];
  if (!configuredFields.length) {
    return [];
  }

  const topLevelEntries = new Map(
    (strategy.confirmation_fields?.top_level ?? []).map((entry) => [
      entry.key,
      entry,
    ] as const),
  );
  const parameterEntries = new Map(
    (strategy.confirmation_fields?.parameters ?? []).map((entry) => [
      entry.key,
      entry,
    ] as const),
  );

  return configuredFields
    .map((field) => {
      const parameterEntry = parameterEntries.get(field.key);
      const topLevelEntry = topLevelEntries.get(field.key);
      const currentStrategyValue = readParameterValue(strategy.parameters?.[field.key]);
      const value =
        parameterSnapshot?.[field.key] ??
        currentStrategyValue ??
        readParameterValue(parameterEntry?.value) ??
        readParameterValue(topLevelEntry?.value) ??
        readStrategyFieldValue(strategy, field.key);
      const labelSource =
        parameterEntry?.label && parameterEntry.label.trim()
          ? parameterEntry.label
          : topLevelEntry?.label && topLevelEntry.label.trim()
            ? topLevelEntry.label
            : field.label;
      return {
        key: field.key,
        label: labelSource,
        control: field.control,
        value: value ?? null,
        options: field.options,
      } satisfies OptimizationParameterSeed;
    })
    .filter((field) => hasParameterValue(field.value));
}

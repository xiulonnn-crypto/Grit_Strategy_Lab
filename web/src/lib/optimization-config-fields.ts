import type { ApiStrategyDetail, ParameterValue, StrategyType } from "../types";
import { formatFactorDisplayName } from "./factor-display";

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

export const ALLOCATION_REBALANCE_FREQUENCY_OPTIONS: OptimizationFieldOption[] = [
  { value: "monthly", label: "月度" },
  { value: "quarterly", label: "季度" },
  { value: "semiannual", label: "半年" },
  { value: "yearly", label: "年度" },
];

export const MULTI_FACTOR_SCORING_METHOD_OPTIONS: OptimizationFieldOption[] = [
  { value: "zscore_weighted", label: "Z-Score 加权" },
  { value: "rank_weighted", label: "Rank 加权" },
];

export const MULTI_FACTOR_NEUTRALIZATION_METHOD_OPTIONS: OptimizationFieldOption[] = [
  { value: "industry", label: "行业中性" },
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
  ASSET_ALLOCATION: [
    {
      key: "rebalance_frequency",
      label: "再平衡频率",
      control: "multiselect",
      options: ALLOCATION_REBALANCE_FREQUENCY_OPTIONS,
    },
    { key: "rebalance_threshold_pct", label: "偏离阈值(%)", control: "text" },
    { key: "fee_bps", label: "交易费(bps)", control: "text" },
    { key: "slippage_bps", label: "滑点(bps)", control: "text" },
  ],
  MULTI_FACTOR: [
    {
      key: "scoring_method",
      label: "打分方法",
      control: "multiselect",
      options: MULTI_FACTOR_SCORING_METHOD_OPTIONS,
    },
    {
      key: "rebalance_frequency",
      label: "再平衡频率",
      control: "multiselect",
      options: ALLOCATION_REBALANCE_FREQUENCY_OPTIONS,
    },
    {
      key: "neutralization_method",
      label: "中性化方法",
      control: "multiselect",
      options: MULTI_FACTOR_NEUTRALIZATION_METHOD_OPTIONS,
    },
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

function readAllocationAssets(
  strategy: ApiStrategyDetail,
  parameterSnapshot?: Record<string, ParameterValue> | null,
): Array<{ symbol: string; displayName?: string | null }> {
  const rawAssets = parameterSnapshot?.allocation_assets ?? strategy.parameters?.allocation_assets;
  if (!Array.isArray(rawAssets)) {
    return [];
  }
  return rawAssets
    .map((asset) => {
      if (!asset || typeof asset !== "object") {
        return null;
      }
      const record = asset as Record<string, unknown>;
      const symbol = typeof record.symbol === "string" ? record.symbol.trim().toUpperCase() : "";
      if (!symbol) {
        return null;
      }
      return {
        symbol,
        displayName: typeof record.display_name === "string" ? record.display_name : null,
      };
    })
    .filter((asset): asset is { symbol: string; displayName: string | null } => asset !== null);
}

function readFactorWeightSeeds(
  strategy: ApiStrategyDetail,
  parameterSnapshot?: Record<string, ParameterValue> | null,
): OptimizationParameterSeed[] {
  const weights = strategy.parameters?.weights;
  if (!weights || typeof weights !== "object" || Array.isArray(weights)) {
    return [];
  }
  const numericEntries = Object.entries(weights as Record<string, unknown>)
    .map(([factorId, rawWeight]) => {
      const numeric = typeof rawWeight === "number" ? rawWeight : Number(rawWeight);
      return Number.isFinite(numeric) ? { factorId, numeric } : null;
    })
    .filter((entry): entry is { factorId: string; numeric: number } => entry !== null);
  const totalAbsWeight = numericEntries.reduce((total, entry) => total + Math.abs(entry.numeric), 0);
  const decimalScale = totalAbsWeight > 0 && totalAbsWeight <= 1.000001;
  const components = strategy.multi_factor_profile?.components ?? [];
  const componentNames = new Map(
    components.map((component) => [component.factor_id, component.name ?? component.factor_id] as const),
  );
  return numericEntries
    .map(({ factorId, numeric }) => {
      const key = `factor_weight__${factorId}_pct`;
      const snapshotValue = parameterSnapshot?.[key];
      const currentPct = decimalScale ? Math.abs(numeric) * 100 : Math.abs(numeric);
      const seed: OptimizationParameterSeed = {
        key,
        label: `因子权重 · ${formatFactorDisplayName(factorId, componentNames.get(factorId))}`,
        control: "text" as const,
        value: typeof snapshotValue === "number" ? snapshotValue : Number(currentPct.toFixed(2)),
      };
      return seed;
    })
    .filter((field): field is OptimizationParameterSeed => field !== null && hasParameterValue(field.value));
}

function readMultiFactorConfiguredValue(
  strategy: ApiStrategyDetail,
  key: string,
  parameterSnapshot?: Record<string, ParameterValue> | null,
): ParameterValue | undefined {
  if (parameterSnapshot?.[key] !== undefined) {
    return parameterSnapshot[key];
  }
  const neutralization = strategy.parameters?.neutralization;
  const neutralizationRecord =
    neutralization && typeof neutralization === "object" && !Array.isArray(neutralization)
      ? (neutralization as Record<string, unknown>)
      : {};
  if (key === "neutralization_method") {
    return typeof neutralizationRecord.method === "string" ? neutralizationRecord.method : "industry";
  }
  return readParameterValue(strategy.parameters?.[key]);
}

export function collectOptimizationParameterSeeds(
  strategy: ApiStrategyDetail,
  parameterSnapshot?: Record<string, ParameterValue> | null,
): OptimizationParameterSeed[] {
  const configuredFields = OPTIMIZATION_SELECTION_FIELDS[strategy.strategy_type] ?? [];
  if (!configuredFields.length && strategy.strategy_type !== "ASSET_ALLOCATION") {
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

  const configuredSeeds = configuredFields
    .map((field) => {
      const parameterEntry = parameterEntries.get(field.key);
      const topLevelEntry = topLevelEntries.get(field.key);
      const currentStrategyValue =
        strategy.strategy_type === "MULTI_FACTOR"
          ? readMultiFactorConfiguredValue(strategy, field.key, parameterSnapshot)
          : readParameterValue(strategy.parameters?.[field.key]);
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

  if (strategy.strategy_type === "MULTI_FACTOR") {
    return [...readFactorWeightSeeds(strategy, parameterSnapshot), ...configuredSeeds];
  }

  if (strategy.strategy_type !== "ASSET_ALLOCATION") {
    return configuredSeeds;
  }

  const allocationSeeds = readAllocationAssets(strategy, parameterSnapshot)
    .map((asset) => {
      const key = `allocation_weight__${asset.symbol}_pct`;
      const value = parameterSnapshot?.[key] ?? strategy.parameters?.[key] ?? null;
      return {
        key,
        label: `${asset.symbol} 权重(%)`,
        control: "text" as const,
        value,
      } satisfies OptimizationParameterSeed;
    })
    .filter((field) => hasParameterValue(field.value));

  return [...allocationSeeds, ...configuredSeeds];
}

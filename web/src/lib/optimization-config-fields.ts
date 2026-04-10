import type { ApiStrategyDetail, ParameterValue, StrategyType } from '../types';

type OptimizationFieldControl = 'text' | 'select';

type OptimizationFieldDefinition = {
  key: string;
  label: string;
  control: OptimizationFieldControl;
};

export type OptimizationParameterSeed = {
  key: string;
  label: string;
  control: OptimizationFieldControl;
  value: ParameterValue;
};

const OPTIMIZATION_SELECTION_FIELDS: Partial<Record<StrategyType, OptimizationFieldDefinition[]>> = {
  GRID: [
    { key: 'initial_position', label: '初始仓位(%)', control: 'text' },
    { key: 'grid_interval', label: '网格间距(%)', control: 'text' },
    { key: 'buy_size_pct', label: '买入仓位(%)', control: 'text' },
    { key: 'sell_step_pct', label: '卖出间距(%)', control: 'text' },
    { key: 'sell_size_pct', label: '卖出仓位(%)', control: 'text' },
  ],
  BUY_AND_HOLD: [
    { key: 'contribution_amount', label: '定投金额(USD)', control: 'text' },
    { key: 'investment_frequency', label: '定投频率', control: 'select' },
  ],
  MOMENTUM: [
    { key: 'lookback_months', label: '动量回看(月)', control: 'text' },
    { key: 'skip_recent_months', label: '跳过最近(月)', control: 'text' },
    { key: 'top_n', label: '买入排名阈值', control: 'text' },
    { key: 'hold_rank_threshold', label: '保留排名阈值', control: 'text' },
    { key: 'weighting_method', label: '权重方法', control: 'select' },
  ],
  MEAN_REVERSION: [
    { key: 'observation_timeframe', label: '观察周期', control: 'select' },
    { key: 'bollinger_period', label: '布林带周期', control: 'text' },
    { key: 'rsi_period', label: 'RSI周期', control: 'text' },
    { key: 'rsi_buy_threshold', label: 'RSI超卖阈值', control: 'text' },
    { key: 'rsi_sell_threshold', label: 'RSI超买阈值', control: 'text' },
    { key: 'long_entry_size_pct', label: '买入仓位(%)', control: 'text' },
    { key: 'short_entry_size_pct', label: '卖出仓位(%)', control: 'text' },
  ],
};

function hasParameterValue(value: ParameterValue | undefined): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  return true;
}

function readParameterValue(value: unknown): ParameterValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return undefined;
}

export function collectOptimizationParameterSeeds(
  strategy: ApiStrategyDetail,
  parameterSnapshot?: Record<string, ParameterValue> | null,
): OptimizationParameterSeed[] {
  const configuredFields = OPTIMIZATION_SELECTION_FIELDS[strategy.strategy_type] ?? [];
  if (!configuredFields.length) {
    return [];
  }

  const confirmationEntries = new Map(
    (strategy.confirmation_fields?.parameters ?? []).map((entry) => [entry.key, entry] as const),
  );

  return configuredFields
    .map((field) => {
      const confirmationEntry = confirmationEntries.get(field.key);
      const value =
        parameterSnapshot?.[field.key] ??
        readParameterValue(confirmationEntry?.value) ??
        strategy.parameters?.[field.key];
      const label =
        typeof confirmationEntry?.label === 'string' && confirmationEntry.label.trim()
          ? confirmationEntry.label
          : field.label;
      return {
        key: field.key,
        label,
        control: field.control,
        value: value ?? null,
      } satisfies OptimizationParameterSeed;
    })
    .filter((field) => hasParameterValue(field.value));
}

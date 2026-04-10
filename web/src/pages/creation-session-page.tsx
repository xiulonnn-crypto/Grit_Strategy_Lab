import { useEffect, useMemo, useRef, useState } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { useApiClient } from '../lib/demoStoreContext';
import {
  ApiError,
  type ApiConfirmationUpdateRequest,
  type ApiStrategyCreationSession,
  type ParameterValue,
  type StrategyType,
} from '../types';
import './creation-backtest.css';

type StepKey = 'basic' | 'selection' | 'risk' | 'other';
type FieldBucket = 'core' | 'logic' | 'parameters';
type SaveState = 'synced' | 'unsaved' | 'saving' | 'error';
type FieldControl = 'text' | 'textarea' | 'select' | 'readonly';
type FieldOption = { value: string; label: string };
type EditableField = {
  key: string; label: string; source: string; value: unknown; bucket: FieldBucket; step: StepKey;
  isTopLevel: boolean; required: boolean; control: FieldControl; order: number; showKey: boolean;
  placeholder?: string; options?: FieldOption[];
};
type ReminderChip = { id: string; key: string; label: string; message: string; step: StepKey; tone: 'warning' | 'info' };
type StepViewModel = {
  key: StepKey; title: string; description: string; fields: EditableField[]; reminders: ReminderChip[];
  requiredCount: number; filledRequiredCount: number; isComplete: boolean;
};

const TEXT = {
  eyebrow: '策略创建', loadingTitle: '策略创建', loadingCopy: '正在加载策略创建会话，请稍候。', defaultDraft: '',
  errorFallback: '加载策略创建会话失败，请稍后重试。',
  titleCopy: '先在对话里用自然语言描述策略，系统会自动提取策略参数，可以在右侧表单中手动补充后再确认提交',
  backToWorkspace: '返回工作台', sendMessage: '发送消息',
  prepare: '生成确认稿', materialize: '生成策略', materializeRevision: '保存新版本', chatTitle: '对话',
  chatPromptCard: '请说明你策略的交易逻辑、关键参数阈值。', formTitle: '动态表单控制台',
  formCopy: '左侧对话提取参数，右侧按步骤补齐与覆盖。', promptLabel: '消息', promptPlaceholder: '请说明...',
  stepBasic: '基础配置', stepSelection: '选股规则', stepRisk: '风控 / 再平衡', stepOther: '其他参数',
  stepBasicCopy: '策略类型、名称、描述、股票池和基准。', stepSelectionCopy: '初始仓位与网格买卖规则参数。',
  stepRiskCopy: '最大止损仓位和再平衡节奏。', stepOtherCopy: '其他补充参数，不影响当前主流程。',
  stepComplete: '已完成', stepPending: '待处理', stepEmpty: '当前步骤暂无字段，可以继续补充对话描述。',
  stepReminders: '待处理项', saveSynced: '已同步', saveUnsaved: '待同步', saveSaving: '保存中',
  saveError: '保存失败', saveErrorBanner: '自动保存失败，请稍后重试。', coverageLabel: '当前参数覆盖率',
  stepSummaryLabel: '步骤完成', roleSystem: '系统', roleUser: '用户', roleAssistant: '助手',
  staleBase: '当前策略参数版本已经更新，请先刷新策略详情，再重新生成确认稿或提交策略。',
} as const;

const STEP_ORDER: StepKey[] = ['basic', 'selection', 'risk', 'other'];
const STEP_META: Record<StepKey, { title: string; description: string }> = {
  basic: { title: TEXT.stepBasic, description: TEXT.stepBasicCopy },
  selection: { title: TEXT.stepSelection, description: TEXT.stepSelectionCopy },
  risk: { title: TEXT.stepRisk, description: TEXT.stepRiskCopy },
  other: { title: TEXT.stepOther, description: TEXT.stepOtherCopy },
};
const STRATEGY_LABELS: Record<StrategyType, string> = {
  GENERAL: '通用', GRID: '网格', MOMENTUM: '动量 / 趋势跟随', MEAN_REVERSION: '均值回归', BUY_AND_HOLD: '定投',
};
const BENCHMARK_OPTIONS: FieldOption[] = [
  { value: 'SPY', label: '标普500指数' }, { value: 'QQQ', label: '纳斯达克100指数' },
];
const ETF_BENCHMARK_OPTIONS: FieldOption[] = [
  { value: 'SPY', label: '标普 SPY' },
  { value: 'QQQ', label: '纳指 QQQ' },
];
const REBALANCE_OPTIONS: FieldOption[] = [
  { value: 'never', label: '从不' }, { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' }, { value: 'daily', label: '每天' },
];
const INVESTMENT_FREQUENCY_OPTIONS: FieldOption[] = [
  { value: 'monthly', label: '每月' },
  { value: 'weekly', label: '每周' },
  { value: 'daily', label: '每天' },
  { value: 'quarterly', label: '每季' },
  { value: 'yearly', label: '每年' },
];
const OBSERVATION_TIMEFRAME_OPTIONS: FieldOption[] = [
  { value: 'daily', label: '日线' },
  { value: 'weekly', label: '周线' },
  { value: 'hourly', label: '小时线' },
];
const MOMENTUM_REBALANCE_OPTIONS: FieldOption[] = [
  { value: 'monthly', label: '每月' },
  { value: 'quarterly', label: '每季度' },
  { value: 'semiannual', label: '每半年' },
  { value: 'yearly', label: '每年' },
];
const MOMENTUM_WEIGHTING_OPTIONS: FieldOption[] = [
  { value: 'equal_weight', label: '等权' },
  { value: 'score_weighted', label: '按动量分数加权' },
];
type FieldConfigMap = Record<string, Omit<EditableField, 'source' | 'value' | 'isTopLevel'>>;
const GRID_FIELDS: Record<string, Omit<EditableField, 'source' | 'value' | 'isTopLevel'>> = {
  strategy_type: { key: 'strategy_type', label: '策略类型', bucket: 'core', step: 'basic', required: true, control: 'readonly', order: 10, showKey: false },
  strategy_name: { key: 'strategy_name', label: '策略名称', bucket: 'parameters', step: 'basic', required: true, control: 'text', order: 20, showKey: false, placeholder: '例如 QQQ 网格交易策略' },
  strategy_description: { key: 'strategy_description', label: '策略描述', bucket: 'parameters', step: 'basic', required: true, control: 'textarea', order: 30, showKey: false, placeholder: '简要描述策略目标、标的和执行规则' },
  universe_name: { key: 'universe_name', label: '股票池', bucket: 'core', step: 'basic', required: true, control: 'text', order: 40, showKey: false, placeholder: '例如 QQQ' },
  benchmark_symbol: { key: 'benchmark_symbol', label: '基准', bucket: 'parameters', step: 'basic', required: true, control: 'select', order: 50, showKey: false, options: BENCHMARK_OPTIONS },
  initial_position: { key: 'initial_position', label: '初始仓位(%)', bucket: 'logic', step: 'selection', required: true, control: 'text', order: 60, showKey: false, placeholder: '例如 10' },
  grid_interval: { key: 'grid_interval', label: '下跌间距(%)', bucket: 'logic', step: 'selection', required: true, control: 'text', order: 70, showKey: false, placeholder: '例如 5' },
  buy_size_pct: { key: 'buy_size_pct', label: '下跌买入仓位(%)', bucket: 'logic', step: 'selection', required: true, control: 'text', order: 80, showKey: false, placeholder: '例如 10' },
  sell_step_pct: { key: 'sell_step_pct', label: '上涨间距(%)', bucket: 'logic', step: 'selection', required: true, control: 'text', order: 90, showKey: false, placeholder: '例如 10' },
  sell_size_pct: { key: 'sell_size_pct', label: '上涨卖出仓位(%)', bucket: 'logic', step: 'selection', required: true, control: 'text', order: 100, showKey: false, placeholder: '例如 5' },
  max_stop_loss_pct: { key: 'max_stop_loss_pct', label: '最大止损仓位(%)', bucket: 'logic', step: 'risk', required: true, control: 'text', order: 110, showKey: false, placeholder: '例如 -4' },
  rebalance_frequency: { key: 'rebalance_frequency', label: '再平衡频次', bucket: 'core', step: 'risk', required: true, control: 'select', order: 120, showKey: false, options: REBALANCE_OPTIONS },
  capital: { key: 'capital', label: '本金', bucket: 'parameters', step: 'other', required: false, control: 'text', order: 130, showKey: false, placeholder: '例如 100000' },
};
const BUY_AND_HOLD_FIELDS: FieldConfigMap = {
  strategy_type: { key: 'strategy_type', label: '策略类型', bucket: 'core', step: 'basic', required: true, control: 'readonly', order: 10, showKey: false },
  strategy_name: { key: 'strategy_name', label: '策略名称', bucket: 'parameters', step: 'basic', required: true, control: 'text', order: 20, showKey: false, placeholder: '例如 QQQ 月度定投策略' },
  strategy_description: { key: 'strategy_description', label: '策略描述', bucket: 'parameters', step: 'basic', required: true, control: 'textarea', order: 30, showKey: false, placeholder: '简要描述定投对象、频率和执行方式' },
  universe_name: { key: 'universe_name', label: '股票池', bucket: 'core', step: 'basic', required: true, control: 'text', order: 40, showKey: false, placeholder: '例如 QQQ' },
  benchmark_symbol: { key: 'benchmark_symbol', label: '基准', bucket: 'parameters', step: 'basic', required: true, control: 'select', order: 50, showKey: false, options: BENCHMARK_OPTIONS },
  contribution_amount: { key: 'contribution_amount', label: '定投金额(USD)', bucket: 'logic', step: 'selection', required: true, control: 'text', order: 60, showKey: false, placeholder: '例如 1000' },
  investment_frequency: { key: 'investment_frequency', label: '定投频率', bucket: 'logic', step: 'selection', required: true, control: 'select', order: 70, showKey: false, options: INVESTMENT_FREQUENCY_OPTIONS },
  rebalance_frequency: { key: 'rebalance_frequency', label: '再平衡频次', bucket: 'core', step: 'risk', required: true, control: 'select', order: 80, showKey: false, options: REBALANCE_OPTIONS },
};
const MOMENTUM_FIELDS: FieldConfigMap = {
  strategy_type: { key: 'strategy_type', label: '策略类型', bucket: 'core', step: 'basic', required: true, control: 'readonly', order: 10, showKey: false },
  strategy_name: { key: 'strategy_name', label: '策略名称', bucket: 'parameters', step: 'basic', required: true, control: 'text', order: 20, showKey: false, placeholder: '例如 标普动量策略' },
  strategy_description: { key: 'strategy_description', label: '策略描述', bucket: 'parameters', step: 'basic', required: true, control: 'textarea', order: 30, showKey: false, placeholder: '简要描述调仓频率、股票池和持仓规则' },
  universe_name: { key: 'universe_name', label: '股票池', bucket: 'core', step: 'basic', required: true, control: 'text', order: 40, showKey: false, placeholder: '例如 标普500成分股' },
  benchmark_symbol: { key: 'benchmark_symbol', label: '基准', bucket: 'parameters', step: 'basic', required: true, control: 'select', order: 50, showKey: false, options: BENCHMARK_OPTIONS },
  capital: { key: 'capital', label: '初始资金(USD)', bucket: 'parameters', step: 'basic', required: true, control: 'text', order: 60, showKey: false, placeholder: '例如 100000' },
  lookback_months: { key: 'lookback_months', label: '动量回看(月)', bucket: 'logic', step: 'selection', required: true, control: 'text', order: 70, showKey: false, placeholder: '例如 12' },
  skip_recent_months: { key: 'skip_recent_months', label: '跳过最近(月)', bucket: 'logic', step: 'selection', required: true, control: 'text', order: 80, showKey: false, placeholder: '例如 1' },
  top_n: { key: 'top_n', label: '买入排名阈值', bucket: 'logic', step: 'selection', required: true, control: 'text', order: 90, showKey: false, placeholder: '例如 100' },
  hold_rank_threshold: { key: 'hold_rank_threshold', label: '保留排名阈值', bucket: 'logic', step: 'selection', required: true, control: 'text', order: 100, showKey: false, placeholder: '例如 120' },
  weighting_method: { key: 'weighting_method', label: '权重方法', bucket: 'logic', step: 'selection', required: true, control: 'select', order: 110, showKey: false, options: MOMENTUM_WEIGHTING_OPTIONS },
  rebalance_frequency: { key: 'rebalance_frequency', label: '调仓频率', bucket: 'core', step: 'risk', required: true, control: 'select', order: 120, showKey: false, options: MOMENTUM_REBALANCE_OPTIONS },
  rebalance_anchor_dates: { key: 'rebalance_anchor_dates', label: '调仓锚点', bucket: 'logic', step: 'risk', required: true, control: 'textarea', order: 130, showKey: false, placeholder: '例如 每年01月第1个交易日；07月第1个交易日' },
};
const MEAN_REVERSION_FIELDS: FieldConfigMap = {
  strategy_type: { key: 'strategy_type', label: '策略类型', bucket: 'core', step: 'basic', required: true, control: 'readonly', order: 10, showKey: false },
  strategy_name: { key: 'strategy_name', label: '策略名称', bucket: 'parameters', step: 'basic', required: true, control: 'text', order: 20, showKey: false, placeholder: '例如 QQQ 均值回归策略' },
  strategy_description: { key: 'strategy_description', label: '策略描述', bucket: 'parameters', step: 'basic', required: true, control: 'textarea', order: 30, showKey: false, placeholder: '简要描述均值回归信号、开仓条件和ATR风控规则' },
  universe_name: { key: 'universe_name', label: '股票池', bucket: 'core', step: 'basic', required: true, control: 'text', order: 40, showKey: false, placeholder: '例如 QQQ' },
  benchmark_symbol: { key: 'benchmark_symbol', label: '基准', bucket: 'parameters', step: 'basic', required: true, control: 'select', order: 50, showKey: false, options: BENCHMARK_OPTIONS },
  observation_timeframe: { key: 'observation_timeframe', label: '观察周期', bucket: 'logic', step: 'selection', required: true, control: 'select', order: 60, showKey: false, options: OBSERVATION_TIMEFRAME_OPTIONS },
  trading_logic: { key: 'trading_logic', label: '交易逻辑', bucket: 'logic', step: 'selection', required: true, control: 'textarea', order: 70, showKey: false, placeholder: '例如 跌破下轨且RSI超卖买入，突破上轨且RSI超买卖出' },
  bollinger_period: { key: 'bollinger_period', label: '布林带周期', bucket: 'logic', step: 'selection', required: true, control: 'text', order: 80, showKey: false, placeholder: '例如 20' },
  rsi_period: { key: 'rsi_period', label: 'RSI周期', bucket: 'logic', step: 'selection', required: true, control: 'text', order: 90, showKey: false, placeholder: '例如 6' },
  rsi_buy_threshold: { key: 'rsi_buy_threshold', label: 'RSI超卖阈值', bucket: 'logic', step: 'selection', required: true, control: 'text', order: 100, showKey: false, placeholder: '例如 30' },
  rsi_sell_threshold: { key: 'rsi_sell_threshold', label: 'RSI超买阈值', bucket: 'logic', step: 'selection', required: true, control: 'text', order: 110, showKey: false, placeholder: '例如 80' },
  long_entry_size_pct: { key: 'long_entry_size_pct', label: '买入仓位(%)', bucket: 'logic', step: 'selection', required: true, control: 'text', order: 120, showKey: false, placeholder: '例如 5' },
  short_entry_size_pct: { key: 'short_entry_size_pct', label: '卖出仓位(%)', bucket: 'logic', step: 'selection', required: true, control: 'text', order: 130, showKey: false, placeholder: '例如 5' },
  atr_period: { key: 'atr_period', label: 'ATR周期', bucket: 'logic', step: 'risk', required: true, control: 'text', order: 140, showKey: false, placeholder: '例如 14' },
  take_profit_atr: { key: 'take_profit_atr', label: '止盈倍数(ATR)', bucket: 'logic', step: 'risk', required: true, control: 'text', order: 150, showKey: false, placeholder: '例如 1.5' },
  stop_loss_atr: { key: 'stop_loss_atr', label: '止损倍数(ATR)', bucket: 'logic', step: 'risk', required: true, control: 'text', order: 160, showKey: false, placeholder: '例如 1' },
  rebalance_frequency: { key: 'rebalance_frequency', label: '再平衡频次', bucket: 'core', step: 'risk', required: true, control: 'select', order: 170, showKey: false, options: REBALANCE_OPTIONS },
  capital: { key: 'capital', label: '初始资金(USD)', bucket: 'parameters', step: 'other', required: false, control: 'text', order: 180, showKey: false, placeholder: '例如 100000' },
};

const CONFIGURED_FIELDS: Partial<Record<StrategyType, FieldConfigMap>> = {
  GRID: GRID_FIELDS,
  BUY_AND_HOLD: BUY_AND_HOLD_FIELDS,
  MOMENTUM: MOMENTUM_FIELDS,
  MEAN_REVERSION: MEAN_REVERSION_FIELDS,
};
const CONFIGURED_TOP_LEVEL_KEYS = new Set(['strategy_type', 'universe_name', 'rebalance_frequency']);
const MEAN_REVERSION_LEGACY_KEYS = new Set(['deviation_threshold', 'window_size', 'mean_target', 'risk_budget']);
const ETF_BENCHMARK_VALUES = new Set(['SPY', 'QQQ']);
const normalizeFieldValue = (value: unknown): string => value === null || value === undefined ? '' : String(value);
const normalizeSearchText = (value: string): string => value.replace(/\s+/g, '').toLowerCase();
const isFilled = (value: string): boolean => value.trim().length > 0;
const strategyTypeLabel = (type?: StrategyType | null): string => (type ? STRATEGY_LABELS[type] ?? type : '策略');
const isLongFormKey = (key: string, label: string): boolean => /(note|description|objective|goal|prompt|comment|memo|desc)/.test(normalizeSearchText(`${key} ${label}`));
const configuredFieldsForType = (strategyType?: StrategyType | null): FieldConfigMap | undefined => strategyType ? CONFIGURED_FIELDS[strategyType] : undefined;
function toParameterValue(value: string): ParameterValue {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}
function findFieldValue(session: ApiStrategyCreationSession | null, key: string): string {
  const entries = session?.confirmation_fields ? [...(session.confirmation_fields.top_level ?? []), ...(session.confirmation_fields.parameters ?? [])] : [];
  return normalizeFieldValue(entries.find((field) => field.key === key)?.value).trim();
}
function deriveStrategyTitle(session: ApiStrategyCreationSession | null): string {
  const strategyName = findFieldValue(session, 'strategy_name');
  if (strategyName) return strategyName;
  const universeName = normalizeFieldValue(session?.top_level?.universe_name).trim();
  const typeLabel = strategyTypeLabel(session?.top_level?.strategy_type ?? undefined);
  if (universeName) return `${universeName} ${typeLabel}策略`;
  return session?.top_level?.strategy_type ? `${typeLabel}策略` : TEXT.loadingTitle;
}
function genericStep(key: string, label: string, isTopLevel: boolean): StepKey {
  if (isTopLevel) return key === 'rebalance_frequency' ? 'risk' : 'basic';
  const haystack = normalizeSearchText(`${key} ${label}`);
  if (/(name|universe|benchmark|objective|symbol|ticker|stock|target|pool)/.test(haystack)) return 'basic';
  if (/(threshold|window|lookback|entry|exit|mean|grid|ma|signal|logic|bound|rule)/.test(haystack)) return 'selection';
  if (/(risk|drawdown|stop|max|rebalance|weight|turnover|volatility|budget|loss|position)/.test(haystack)) return 'risk';
  return 'other';
}
function resolveField(strategyType: StrategyType | null | undefined, key: string, label: string, isTopLevel: boolean): EditableField {
  const configured = configuredFieldsForType(strategyType)?.[key];
  if (configured) {
    return {
      ...configured,
      options: key === 'benchmark_symbol' ? ETF_BENCHMARK_OPTIONS : configured.options,
      source: '',
      value: '',
      isTopLevel,
    };
  }
  const step = genericStep(key, label, isTopLevel);
  return {
    key, label, source: '', value: '', isTopLevel, step, required: false, control: isLongFormKey(key, label) ? 'textarea' : 'text',
    bucket: isTopLevel ? 'core' : step === 'selection' || step === 'risk' ? 'logic' : 'parameters', order: 900, showKey: true,
  };
}
function defaultConfiguredFieldValue(session: ApiStrategyCreationSession, key: string): unknown {
  const strategyType = session.top_level?.strategy_type;
  const universeName = normalizeFieldValue(session.top_level?.universe_name).trim();
  switch (strategyType) {
    case 'GRID':
      switch (key) {
        case 'strategy_type':
          return session.top_level?.strategy_type ?? 'GRID';
        case 'strategy_name':
          return universeName ? `${universeName} 网格交易策略` : deriveStrategyTitle(session);
        case 'strategy_description':
          return '';
        case 'universe_name':
          return universeName;
        case 'benchmark_symbol':
          return 'SPY';
        case 'rebalance_frequency':
          return normalizeFieldValue(session.top_level?.rebalance_frequency).trim() || 'never';
        default:
          return '';
      }
    case 'MOMENTUM':
      switch (key) {
        case 'strategy_type':
          return session.top_level?.strategy_type ?? 'MOMENTUM';
        case 'strategy_name':
          if (findFieldValue(session, 'strategy_name')) return findFieldValue(session, 'strategy_name');
          return universeName ? `${universeName} 动量策略` : deriveStrategyTitle(session);
        case 'strategy_description':
          return '';
        case 'universe_name':
          return universeName;
        case 'benchmark_symbol':
          return universeName.includes('纳指') || universeName.includes('纳斯达克') ? 'QQQ' : 'SPY';
        case 'capital':
        case 'lookback_months':
        case 'skip_recent_months':
        case 'top_n':
        case 'hold_rank_threshold':
          return '';
        case 'weighting_method':
          return 'equal_weight';
        case 'rebalance_frequency':
          return normalizeFieldValue(session.top_level?.rebalance_frequency).trim() || 'semiannual';
        case 'rebalance_anchor_dates':
          return '';
        default:
          return '';
      }
    case 'BUY_AND_HOLD':
      switch (key) {
        case 'strategy_type':
          return session.top_level?.strategy_type ?? 'BUY_AND_HOLD';
        case 'strategy_name':
          return universeName ? `${universeName} 月度定投策略` : deriveStrategyTitle(session);
        case 'strategy_description':
          return '';
        case 'universe_name':
          return universeName;
        case 'benchmark_symbol':
          return ETF_BENCHMARK_VALUES.has(universeName.toUpperCase()) ? universeName.toUpperCase() : 'SPY';
        case 'contribution_amount':
          return '';
        case 'investment_frequency':
          return 'monthly';
        case 'rebalance_frequency':
          return normalizeFieldValue(session.top_level?.rebalance_frequency).trim() || 'never';
        default:
          return '';
      }
    case 'MEAN_REVERSION':
      switch (key) {
        case 'strategy_type':
          return session.top_level?.strategy_type ?? 'MEAN_REVERSION';
        case 'strategy_name':
          return universeName ? `${universeName} 均值回归策略` : deriveStrategyTitle(session);
        case 'strategy_description':
          return '';
        case 'universe_name':
          return universeName;
        case 'benchmark_symbol':
          return ETF_BENCHMARK_VALUES.has(universeName.toUpperCase()) ? universeName.toUpperCase() : 'SPY';
        case 'observation_timeframe':
          return '';
        case 'trading_logic':
        case 'bollinger_period':
        case 'rsi_period':
        case 'rsi_buy_threshold':
        case 'rsi_sell_threshold':
        case 'atr_period':
        case 'take_profit_atr':
        case 'stop_loss_atr':
        case 'long_entry_size_pct':
        case 'short_entry_size_pct':
        case 'capital':
          return '';
        case 'rebalance_frequency':
          return normalizeFieldValue(session.top_level?.rebalance_frequency).trim() || 'never';
        default:
          return '';
      }
    default:
      return '';
  }
}
function defaultConfiguredFieldSource(session: ApiStrategyCreationSession, key: string): string {
  const universeName = normalizeFieldValue(session.top_level?.universe_name).trim().toUpperCase();
  if (key === 'strategy_type' || key === 'rebalance_frequency' || key === 'investment_frequency') return 'system_default';
  if (key === 'benchmark_symbol') return ETF_BENCHMARK_VALUES.has(universeName) ? 'system_inference' : 'system_default';
  if (key === 'strategy_name' && normalizeFieldValue(session.top_level?.universe_name).trim()) return 'system_inference';
  if (key === 'universe_name' && normalizeFieldValue(session.top_level?.universe_name).trim()) return 'user_input';
  return 'system_default';
}
function injectMissingConfiguredFields(session: ApiStrategyCreationSession, fields: EditableField[]): EditableField[] {
  const configuredFields = configuredFieldsForType(session.top_level?.strategy_type);
  if (!configuredFields) return fields;
  const hydratedFields = [...fields];
  const existingKeys = new Set(hydratedFields.map((field) => field.key));
  Object.entries(configuredFields).forEach(([key, configured]) => {
    if (existingKeys.has(key)) return;
    hydratedFields.push({
      ...configured,
      options: key === 'benchmark_symbol' ? ETF_BENCHMARK_OPTIONS : configured.options,
      isTopLevel: CONFIGURED_TOP_LEVEL_KEYS.has(key),
      source: defaultConfiguredFieldSource(session, key),
      value: defaultConfiguredFieldValue(session, key),
    });
  });
  return hydratedFields;
}
function collectEditableFields(session: ApiStrategyCreationSession | null): EditableField[] {
  if (!session) return [];
  const type = session.top_level?.strategy_type ?? null;
  const confirmationFields = session.confirmation_fields ?? { top_level: [], parameters: [] };
  const top = (confirmationFields.top_level ?? []).map((field) => ({ ...resolveField(type, field.key, field.label, true), source: field.source, value: field.value }));
  const topLevelKeys = new Set(top.map((field) => field.key));
  const params = (confirmationFields.parameters ?? [])
    .filter((field) => !topLevelKeys.has(field.key))
    .filter((field) => type !== 'MEAN_REVERSION' || !MEAN_REVERSION_LEGACY_KEYS.has(field.key))
    .map((field) => ({ ...resolveField(type, field.key, field.label, false), source: field.source, value: field.value }));
  const hydratedFields = configuredFieldsForType(type) ? injectMissingConfiguredFields(session, [...top, ...params]) : [...top, ...params];
  return hydratedFields.sort((a, b) => STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step) || a.order - b.order || a.key.localeCompare(b.key));
}
const buildValueMap = (fields: EditableField[]): Record<string, string> => Object.fromEntries(fields.map((field) => [field.key, normalizeFieldValue(field.value)]));
function buildReminderChips(session: ApiStrategyCreationSession | null): ReminderChip[] {
  if (!session) return [];
  const type = session.top_level?.strategy_type ?? null;
  const pending = (session.pending_inputs ?? []).map((item) => ({ id: `pending-${item.key}`, key: item.key, label: resolveField(type, item.key, item.label, item.key === 'universe_name').label, message: item.message, step: resolveField(type, item.key, item.label, item.key === 'universe_name').step, tone: 'warning' as const }));
  const conflicts = (session.manual_conflicts ?? []).map((item) => ({ id: `conflict-${item.key}`, key: item.key, label: resolveField(type, item.key, item.label, item.key === 'universe_name').label, message: item.message, step: resolveField(type, item.key, item.label, item.key === 'universe_name').step, tone: 'warning' as const }));
  return [...pending, ...conflicts];
}
function buildStepViews(fields: EditableField[], values: Record<string, string>, reminders: ReminderChip[]): StepViewModel[] {
  return STEP_ORDER.map((step) => {
    const stepFields = fields.filter((field) => field.step === step);
    const stepReminders = reminders.filter((reminder) => reminder.step === step);
    const requiredFields = stepFields.filter((field) => field.required);
    const filledRequiredCount = requiredFields.filter((field) => isFilled(values[field.key] ?? '')).length;
    return {
      key: step, title: STEP_META[step].title, description: STEP_META[step].description, fields: stepFields, reminders: stepReminders,
      requiredCount: requiredFields.length, filledRequiredCount, isComplete: stepReminders.length === 0 && (requiredFields.length === 0 || filledRequiredCount === requiredFields.length),
    };
  });
}
function buildPayload(fields: EditableField[], values: Record<string, string>, revision: number): ApiConfirmationUpdateRequest {
  const payload: ApiConfirmationUpdateRequest = { revision, core: {}, logic: {}, parameters: {} };
  fields.forEach((field) => {
    const value = toParameterValue(values[field.key] ?? '');
    if (field.bucket === 'core') payload.core![field.key] = value;
    else if (field.bucket === 'logic') payload.logic![field.key] = value;
    else payload.parameters![field.key] = value;
  });
  return payload;
}
const sameValues = (fields: EditableField[], left: Record<string, string>, right: Record<string, string>): boolean => fields.every((field) => (left[field.key] ?? '') === (right[field.key] ?? ''));
const firstIncompleteStep = (steps: StepViewModel[]): StepKey => steps.find((step) => !step.isComplete)?.key ?? 'basic';
function sourceLabel(source: string): string {
  if (source === 'manual_override' || source === 'manual') return '人工修正';
  if (source === 'system_default') return '系统默认';
  if (source === 'system_inference' || source === 'assistant' || source === 'system') return '系统推断';
  if (source === 'user_input') return '用户输入';
  return '已同步';
}
const roleLabel = (role?: string | null): string => role === 'user' ? TEXT.roleUser : role === 'assistant' ? TEXT.roleAssistant : TEXT.roleSystem;
function parseConversationTimestamp(value?: string | null): Date | null {
  if (!value?.trim()) return null;
  const normalized = value.includes('T') ? value.trim() : value.trim().replace(' ', 'T');
  const withTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}+08:00`;
  const parsed = new Date(withTimezone);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function formatConversationTimestamp(value?: string | null): string {
  const parsed = parseConversationTimestamp(value);
  return parsed ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Hong_Kong' }).format(parsed) : value?.trim() ?? '';
}
function fieldOptions(field: Pick<EditableField, 'key' | 'options'>): FieldOption[] {
  if (field.key === 'benchmark_symbol') return ETF_BENCHMARK_OPTIONS;
  return field.options ?? [];
}
function displayValue(field: Pick<EditableField, 'key' | 'options'>, value: string): string {
  if (field.key === 'strategy_type') return strategyTypeLabel(value as StrategyType);
  return fieldOptions(field).find((option) => option.value === value)?.label ?? value;
}
const tagStatusLabel = (status: 'synced' | 'manual_override_preserved'): string => status === 'manual_override_preserved' ? '已人工修正' : '已同步';

export function CreationSessionPage({ sessionId }: { sessionId: string }): JSX.Element {
  const api = useApiClient();
  const [session, setSession] = useState<ApiStrategyCreationSession | null>(null);
  const [draft, setDraft] = useState(TEXT.defaultDraft);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('synced');
  const [editableValues, setEditableValues] = useState<Record<string, string>>({});
  const [syncedValues, setSyncedValues] = useState<Record<string, string>>({});
  const [activeStep, setActiveStep] = useState<StepKey>('basic');
  const sessionRef = useRef<ApiStrategyCreationSession | null>(null);
  const editableValuesRef = useRef<Record<string, string>>({});
  const syncedValuesRef = useRef<Record<string, string>>({});
  const savePromiseRef = useRef<Promise<ApiStrategyCreationSession | null> | null>(null);
  const editableFields = useMemo(() => collectEditableFields(session), [session]);
  const reminderChips = useMemo(() => buildReminderChips(session), [session]);
  const stepViews = useMemo(() => buildStepViews(editableFields, editableValues, reminderChips), [editableFields, editableValues, reminderChips]);
  const derivedTitle = useMemo(() => deriveStrategyTitle(session), [session]);
  const activeStepView = stepViews.find((step) => step.key === activeStep) ?? stepViews.find((step) => step.key === firstIncompleteStep(stepViews)) ?? stepViews[0];
  const hasUnsavedChanges = useMemo(() => !sameValues(editableFields, editableValues, syncedValues), [editableFields, editableValues, syncedValues]);
  const requiredFields = editableFields.filter((field) => field.required);
  const filledRequiredCount = requiredFields.filter((field) => isFilled(editableValues[field.key] ?? '')).length;
  const coverageRatio = requiredFields.length ? Math.round((filledRequiredCount / requiredFields.length) * 100) : 100;
  const completedStepCount = stepViews.filter((step) => step.isComplete).length;
  const canMaterialize = Boolean(session?.revision) && stepViews.every((step) => step.isComplete) && !hasUnsavedChanges && saveState === 'synced';
  const primaryActionLabel =
    canMaterialize
      ? session?.mode === 'REVISION'
        ? TEXT.materializeRevision
        : TEXT.materialize
      : TEXT.prepare;
  const guidanceTimestamp = formatConversationTimestamp(session?.messages?.find((message) => message.created_at)?.created_at ?? new Date().toISOString());

  function syncState(nextSession: ApiStrategyCreationSession, options?: { preserveActiveStep?: boolean }): void {
    const nextFields = collectEditableFields(nextSession);
    const nextValues = buildValueMap(nextFields);
    const nextSteps = buildStepViews(nextFields, nextValues, buildReminderChips(nextSession));
    sessionRef.current = nextSession;
    editableValuesRef.current = nextValues;
    syncedValuesRef.current = nextValues;
    setSession(nextSession);
    setEditableValues(nextValues);
    setSyncedValues(nextValues);
    setSaveState('synced');
    setSaveError(null);
    setActiveStep((current) => options?.preserveActiveStep && STEP_ORDER.includes(current) ? current : firstIncompleteStep(nextSteps));
  }

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        setLoading(true); setError(null);
        const nextSession = await api.getCreationSession(sessionId);
        if (!cancelled) syncState(nextSession);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : TEXT.errorFallback);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [api, sessionId]);

  async function persistEditsIfNeeded(): Promise<ApiStrategyCreationSession | null> {
    if (savePromiseRef.current) return savePromiseRef.current;
    const currentSession = sessionRef.current;
    if (!currentSession) return null;
    const currentFields = collectEditableFields(currentSession);
    if (sameValues(currentFields, editableValuesRef.current, syncedValuesRef.current)) return currentSession;
    if (typeof currentSession.revision !== 'number') { setSaveState('error'); setSaveError(TEXT.saveErrorBanner); return null; }
    setSaveState('saving'); setSaveError(null);
    const savePromise = (async () => {
      try {
        const updated = await api.updateConfirmation(currentSession.id, buildPayload(currentFields, editableValuesRef.current, currentSession.revision));
        syncState(updated, { preserveActiveStep: true });
        return updated;
      } catch (caught) {
        setSaveState('error');
        setSaveError(caught instanceof Error ? caught.message : TEXT.saveErrorBanner);
        return null;
      } finally {
        savePromiseRef.current = null;
      }
    })();
    savePromiseRef.current = savePromise;
    return savePromise;
  }

  async function sendPrompt(): Promise<void> {
    if (!draft.trim()) { setError('请输入策略描述后再发送。'); return; }
    if (!sessionRef.current) return;
    try {
      setBusyAction(true); setError(null);
      const updated = await api.appendCreationMessage(sessionRef.current.id, draft.trim(), sessionRef.current.revision);
      syncState(updated, { preserveActiveStep: true }); setDraft('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : TEXT.errorFallback);
    } finally {
      setBusyAction(false);
    }
  }
  async function openConfirmation(): Promise<void> {
    const currentSession = await persistEditsIfNeeded();
    if (!currentSession) return;
    try {
      setBusyAction(true); setError(null);
      syncState(await api.prepareConfirmation(currentSession.id), { preserveActiveStep: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : TEXT.errorFallback);
    } finally {
      setBusyAction(false);
    }
  }
  async function materialize(sessionToUse: ApiStrategyCreationSession): Promise<void> {
    try {
      setBusyAction(true); setError(null);
      const strategy = await api.materializeStrategy(sessionToUse.id, `materialize-${sessionToUse.id}`, sessionToUse.revision);
      navigateTo(sessionToUse.mode === 'REVISION' ? `/strategies/${strategy.id}` : `/strategies/${strategy.id}/backtest-runs/new`);
    } catch (caught) {
      const errorValue = caught as ApiError | undefined;
      setError(errorValue?.code === 'stale_base_parameter_version' ? TEXT.staleBase : errorValue?.message ?? TEXT.errorFallback);
    } finally {
      setBusyAction(false);
    }
  }
  async function handlePrimaryAction(): Promise<void> {
    const currentSession = await persistEditsIfNeeded();
    if (!currentSession) return;
    const ready = buildStepViews(collectEditableFields(currentSession), buildValueMap(collectEditableFields(currentSession)), buildReminderChips(currentSession)).every((step) => step.isComplete);
    if (ready && currentSession.revision) { await materialize(currentSession); return; }
    await openConfirmation();
  }
  async function handleStepChange(step: StepKey): Promise<void> {
    if (step === activeStep) return;
    const persisted = await persistEditsIfNeeded();
    if (hasUnsavedChanges && !persisted) return;
    setActiveStep(step);
  }
  function handleFieldChange(key: string, nextValue: string): void {
    editableValuesRef.current = { ...editableValuesRef.current, [key]: nextValue };
    setEditableValues(editableValuesRef.current);
    setSaveState('unsaved');
    setSaveError(null);
  }

  if (loading) return <section className="panel creation-session-page"><div className="panel-header"><h2>{TEXT.loadingTitle}</h2></div><p className="hero-copy">{TEXT.loadingCopy}</p></section>;
  if (!session) return <section className="panel creation-session-page"><div className="error-banner">{error ?? TEXT.errorFallback}</div></section>;

  return (
    <div className="stack creation-shell creation-session-page">
      <section className="creation-title-card">
        <div className="creation-title-card__copy">
          <p className="eyebrow">{TEXT.eyebrow}</p>
          <h1 className="creation-title-card__title">{derivedTitle}</h1>
          <p className="hero-copy">{TEXT.titleCopy}</p>
        </div>
        <div className="creation-session-hero__actions">
          <button className="ghost-button" onClick={() => navigateTo('/workspace')} type="button">{TEXT.backToWorkspace}</button>
          <button className="primary-button" disabled={busyAction || saveState === 'saving'} onClick={() => void handlePrimaryAction()} type="button">{primaryActionLabel}</button>
        </div>
      </section>
      {error ? <div className="error-banner">{error}</div> : null}
      <div className="creation-session-grid">
        <section className="panel creation-session-main">
          <div className="panel-header"><div><h3>{TEXT.chatTitle}</h3></div></div>
          <div className="creation-message-list">
            <article className="creation-message-card creation-message-card--system">
              <strong>{TEXT.roleSystem}</strong><p>{TEXT.chatPromptCard}</p><small>{guidanceTimestamp}</small>
            </article>
            {session.messages?.map((message, index) => {
              const role = message.role === 'user' ? 'user' : message.role === 'assistant' ? 'assistant' : 'system';
              return (
                <article className={`creation-message-card creation-message-card--${role === 'user' ? 'user' : 'system'}`} key={message.id ?? `${role}-${index}`}>
                  <strong>{roleLabel(message.role)}</strong>
                  <p>{message.content}</p>
                  {role === 'user' && message.extracted_tags?.length ? (
                    <div className="creation-message-tags" aria-label="参数提取标签">
                      {message.extracted_tags.map((tag) => (
                        <span className={`creation-message-tag creation-message-tag--${tag.status}`} key={`${message.id ?? index}-${tag.key}-${tag.status}`}>
                          <span>{`${tag.label}：${displayValue(resolveField(session.top_level?.strategy_type ?? null, tag.key, tag.label, CONFIGURED_TOP_LEVEL_KEYS.has(tag.key)), tag.value)}`}</span>
                          <span>{tagStatusLabel(tag.status)}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <small>{formatConversationTimestamp(message.created_at) || '刚刚'}</small>
                </article>
              );
            })}
          </div>
          <div className="creation-composer">
            <div className="panel-header"><h3>{TEXT.promptLabel}</h3></div>
            <textarea aria-label={TEXT.promptLabel} className="prompt-box" disabled={busyAction} onChange={(event) => setDraft(event.target.value)} placeholder={TEXT.promptPlaceholder} value={draft} />
            <div className="hero-actions creation-form-actions">
              <button className="primary-button" disabled={busyAction || saveState === 'saving'} onClick={() => void sendPrompt()} type="button">{TEXT.sendMessage}</button>
            </div>
          </div>
        </section>
        <aside className="creation-session-sidebar">
          <section className="panel creation-step-card creation-step-card--active">
            <div className="creation-step-card__header"><div><h3 className="creation-step-card__title">{TEXT.formTitle}</h3><p className="creation-step-card__copy">{TEXT.formCopy}</p></div></div>
            <div className="creation-step-chip-row">
              {stepViews.map((step) => {
                const statusClass = step.isComplete ? 'creation-step-chip--success' : 'creation-step-chip--warning';
                const activeClass = step.key === activeStep ? 'creation-step-chip--active' : '';
                return (
                  <button className={`creation-step-chip ${statusClass} ${activeClass}`.trim()} key={step.key} onClick={() => void handleStepChange(step.key)} type="button">
                    <span>{step.title}</span><span>{step.isComplete ? TEXT.stepComplete : TEXT.stepPending}</span>
                  </button>
                );
              })}
            </div>
            {activeStepView ? (
              <div className="creation-step-panel">
                <div className="creation-step-panel__header">
                  <div><h4 className="creation-step-card__title">{activeStepView.title}</h4><p className="creation-step-card__copy">{activeStepView.description}</p></div>
                </div>
                {activeStepView.reminders.length ? <div className="creation-warning-chips" aria-label={TEXT.stepReminders}>{activeStepView.reminders.map((reminder) => <span className={`creation-warning-chip creation-warning-chip--${reminder.tone}`} key={reminder.id} title={reminder.message}>{reminder.label}</span>)}</div> : null}
                <div className="creation-step-card__body">
                  {activeStepView.fields.length ? activeStepView.fields.map((field) => {
                    const fieldValue = editableValues[field.key] ?? '';
                    const disabled = busyAction || saveState === 'saving';
                    return (
                      <label className="creation-form-group" key={field.key}>
                        <div className="creation-step-card__header">
                          <div><h4>{field.label}</h4>{field.showKey ? <p className="creation-step-card__copy">{field.key}</p> : null}</div>
                          <span className="status-chip status-chip--soft">{sourceLabel(field.source)}</span>
                        </div>
                        {field.control === 'readonly' ? <div aria-label={field.label} className="creation-inline-input creation-inline-display">{displayValue(field, fieldValue)}</div> : null}
                        {field.control === 'select' ? (
                          <select aria-label={field.label} className="creation-inline-input creation-inline-select" disabled={disabled} onBlur={() => void persistEditsIfNeeded()} onChange={(event) => handleFieldChange(field.key, event.target.value)} value={fieldValue}>
                            <option value="">请选择</option>{(field.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                        ) : null}
                        {field.control === 'textarea' ? <textarea aria-label={field.label} className="creation-inline-input" disabled={disabled} onBlur={() => void persistEditsIfNeeded()} onChange={(event) => handleFieldChange(field.key, event.target.value)} placeholder={field.placeholder} rows={4} value={fieldValue} /> : null}
                        {field.control === 'text' ? <input aria-label={field.label} className="creation-inline-input" disabled={disabled} onBlur={() => void persistEditsIfNeeded()} onChange={(event) => handleFieldChange(field.key, event.target.value)} placeholder={field.placeholder} type="text" value={fieldValue} /> : null}
                      </label>
                    );
                  }) : <p className="creation-step-card__empty">{TEXT.stepEmpty}</p>}
                </div>
                <div className="creation-save-bar">
                  <span className={`creation-save-status ${saveState === 'saving' ? 'creation-save-status--saving' : saveState === 'unsaved' ? 'creation-save-status--unsaved' : saveState === 'error' ? 'creation-save-status--error' : 'creation-step-chip--success'}`}>{saveState === 'saving' ? TEXT.saveSaving : saveState === 'unsaved' ? TEXT.saveUnsaved : saveState === 'error' ? TEXT.saveError : TEXT.saveSynced}</span>
                  <span className="creation-step-card__copy">{TEXT.coverageLabel} {coverageRatio}% ({filledRequiredCount}/{requiredFields.length || 0})</span>
                  <span className="creation-step-card__copy">{TEXT.stepSummaryLabel} {completedStepCount}/{stepViews.length}</span>
                </div>
                {saveError ? <div className="error-banner">{saveError}</div> : null}
              </div>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}

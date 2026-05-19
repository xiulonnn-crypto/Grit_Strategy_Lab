import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { useApiClient } from '../lib/demoStoreContext';
import { formatDateTime, formatPercent, formatRatio } from '../lib/format';
import {
  factorIdFromWeightKey,
  formatFactorDisplayName,
  formatFactorList,
  formatFactorWeightLabel,
  type FactorDisplayNameLookup,
} from '../lib/factor-display';
import { buildOptimizationConfigPath } from '../lib/optimization-routes';
import { formatParameterLabel as formatSharedParameterLabel, formatParameterValue as formatSharedParameterValue } from '../lib/adapters';
import { formatStrategyVersionTag, getStrategyDisplayName } from '../lib/strategy-version';
import type { ApiBacktestRunListItem, ApiStrategyDetail, ParameterValue, ParameterVersionRestorePayload } from '../types';
import './creation-backtest.css';
import '../page-sections/workspace-recent-runs-lane-b.css';
import './strategy-detail-page.css';

const FIRST_SCREEN_DEFER_MS = import.meta.env.MODE === 'test' ? 0 : 80;

const TEXT = {
  eyebrow: '策略详情',
  title: '策略详情',
  loading: '正在加载策略详情...',
  loadError: '策略详情加载失败。',
  runBacktest: '运行回测',
  editStrategy: '修改策略',
  openOptimization: '打开优化',
  parameterTitle: '当前参数',
  parameterCopy: '这里展示当前版本真正参与执行的策略参数，交易逻辑会固定排在首位，其他参数按类别平铺展示。',
  historyTitle: '参数历史',
  historyCopy: '按版本查看参数迭代记录，帮助快速回看每次调整的时间、说明和字段规模。',
  historyOpenDetail: '查看参数',
  historyDetailTitle: '版本参数明细',
  historyDetailClose: '关闭',
  historyDetailEmpty: '该版本没有可展示的参数。',
  historyDetailChangeSummary: '变更摘要',
  historyDetailDecisionNote: '决策说明',
  historyDetailSource: '来源信息',
  historyDetailAlternatives: '替代版本',
  historyDetailParameters: '参数',
  historyDetailNoSource: '来源信息待补充。',
  historyDetailNoAlternatives: '没有替代版本记录。',
  historyChangeSummaryFallback: '暂无变更摘要。',
  historyDecisionNoteFallback: '-',
  historySourceFallback: '来源待补充',
  historyRollbackCurrent: '当前版本',
  historyRollbackable: '可回滚',
  historyNotRollbackable: '不可回滚',
  historyRollbackUnknown: '未标记',
  historyRestore: '回滚',
  restoreTitle: '确认回滚参数版本',
  restoreCopy: '回滚会基于当前版本创建恢复请求，并保留完整参数历史。',
  restoreDecisionNoteLabel: '决策说明',
  restoreDecisionNotePlaceholder: '说明为什么恢复到这个版本，例如风险回撤更稳定或当前版本不适合继续使用。',
  restoreCancel: '取消',
  restoreConfirm: '确认回滚',
  restoreInFlight: '正在回滚...',
  restoreNoteRequired: '请填写决策说明后再确认回滚。',
  restoreApiMissing: '当前 API client 尚未接入版本回滚，请稍后重试。',
  restoreError: '回滚失败，请稍后重试。',
  recentRunTitle: '最近回测',
  recentRunCopy: '按时间轴查看最近回测记录，并同步展示每次回测对应的策略参数版本。',
  emptyParameters: '当前没有可展示的参数。',
  emptyHistory: '暂时没有参数历史。',
  emptyRun: '暂无最近回测',
  latestRunStatus: '运行状态',
  annualizedReturn: '年化',
  sharpe: '夏普',
  drawdown: '回撤',
  tradeCount: '交易笔数',
  historyFallbackComment: '该版本没有额外备注。',
  editError: '打开策略修改页失败，请稍后重试。',
  recentRunRangeFallback: '回测区间待补充',
  recentRunVersionFallback: '版本待补充',
} as const;

const DYNAMIC_BUY_AND_HOLD_RUNTIME_WARNING =
  '当前回测引擎尚未接入动态定投所需的估值/基本面时间序列，dynamic_investment_logic 未执行；结果暂按固定金额定投计算。';

const PARAMETER_LABELS: Record<string, string> = {
  strategy_name: '策略名称',
  strategy_description: '策略描述',
  strategy_type: '策略类型',
  universe_name: '股票池',
  benchmark_symbol: '基准',
  rebalance_frequency: '再平衡',
  trading_logic: '交易逻辑',
  observation_timeframe: '观察周期',
  bollinger_period: '布林带周期',
  rsi_period: 'RSI 周期',
  rsi_buy_threshold: 'RSI 买入阈值',
  rsi_sell_threshold: 'RSI 卖出阈值',
  atr_period: 'ATR 周期',
  take_profit_atr: '止盈倍数',
  stop_loss_atr: '止损倍数',
  long_entry_size_pct: '买入仓位',
  short_entry_size_pct: '卖出仓位',
  capital: '初始资金',
  contribution_amount: '每期投入',
  investment_frequency: '投入频次',
  contribution_anchor: '定投执行锚点',
  dynamic_investment_logic: '动态定投逻辑',
  factor_ids: '因子篮子',
  weights: '权重方案',
  directions: '方向设置',
  neutralization: '行业中性化',
  neutralization_method: '中性化方法',
  pit_snapshot_refs: 'PIT 快照',
  dataset_snapshot_id: '数据集快照',
  fundamental_snapshot_id: '基本面快照',
  universe_snapshot_id: '股票池快照',
  preview: '多因子预检',
  scoring_method: '打分方法',
  allocation_assets: '配置标的',
  investment_mode: '配置类型',
  rebalance_enabled: '再平衡开关',
  rebalance_threshold_pct: '偏离阈值',
  cost_model_enabled: '成本模拟',
  fee_bps: '交易费',
  slippage_bps: '滑点',
  expense_ratio_bps: '持有成本',
  lookback_months: '回看月数',
  skip_recent_months: '跳过最近月数',
  hold_rank_threshold: '保留排名阈值',
  top_n: '持仓数量',
  weighting_method: '权重方式',
  rebalance_anchor_dates: '调仓锚点',
  max_position_pct: '单票上限',
  holding_count: '实际持仓数量',
  lookback_days: '回看天数',
  signal_lookback_days: '信号观察天数',
  initial_position: '初始仓位',
  grid_interval: '下跌间距',
  buy_size_pct: '下跌买入仓位',
  sell_step_pct: '上涨间距',
  sell_size_pct: '上涨卖出仓位',
  max_stop_loss_pct: '最大止损仓位',
};

const PARAMETER_ORDER: Record<string, number> = {
  strategy_name: -60,
  strategy_description: -50,
  strategy_type: -40,
  universe_name: -30,
  benchmark_symbol: -20,
  rebalance_frequency: -10,
  observation_timeframe: 10,
  bollinger_period: 20,
  rsi_period: 30,
  rsi_buy_threshold: 40,
  rsi_sell_threshold: 50,
  atr_period: 60,
  take_profit_atr: 70,
  stop_loss_atr: 80,
  long_entry_size_pct: 90,
  short_entry_size_pct: 100,
  contribution_amount: 110,
  investment_frequency: 120,
  contribution_anchor: 125,
  dynamic_investment_logic: 126,
  allocation_assets: 127,
  investment_mode: 128,
  rebalance_enabled: 129,
  rebalance_threshold_pct: 130,
  cost_model_enabled: 131,
  fee_bps: 132,
  slippage_bps: 133,
  expense_ratio_bps: 134,
  lookback_months: 130,
  skip_recent_months: 140,
  top_n: 150,
  holding_count: 160,
  lookback_days: 170,
  signal_lookback_days: 180,
  weighting_method: 190,
  factor_ids: 191,
  weights: 192,
  directions: 193,
  neutralization: 194,
  neutralization_method: 195,
  pit_snapshot_refs: 195,
  scoring_method: 196,
  max_position_pct: 200,
  initial_position: 210,
  grid_interval: 220,
  buy_size_pct: 230,
  sell_step_pct: 240,
  sell_size_pct: 250,
  max_stop_loss_pct: 260,
  capital: 270,
};

const HIDDEN_PARAMETER_KEYS = new Set([
  'strategy_name',
  'strategy_description',
  'strategy_type',
  'universe_name',
  'benchmark_symbol',
  'deviation_threshold',
  'window_size',
  'mean_target',
  'risk_budget',
  'trading_logic',
  'dynamic_investment_proxy_key',
  'dynamic_investment_metric_key',
  'dynamic_investment_rules',
  'preview',
  'strategy_creation_risk',
  'multi_factor_precheck',
]);

const HIDDEN_HISTORY_PARAMETER_KEYS = new Set([
  'deviation_threshold',
  'window_size',
  'mean_target',
  'risk_budget',
  'strategy_description',
  'dynamic_investment_proxy_key',
  'dynamic_investment_metric_key',
  'dynamic_investment_rules',
  'preview',
  'strategy_creation_risk',
  'multi_factor_precheck',
]);

const HISTORY_COMMENT_LABELS: Record<string, string> = {
  'Initial import.': '初始导入。',
  'Promoted after tuning the current settings.': '调优当前设置后晋升为正式版本。',
};

const HISTORY_DECISION_NOTE_PLACEHOLDERS = new Set(['未记录决策说明。']);

type ParameterCardItem = {
  key: string;
  label: string;
  value: string;
};

type BaseParameterHistoryEntry = ApiStrategyDetail['parameter_history'][number];
type HistorySourceValue = string | Record<string, unknown> | null | undefined;
type HistoryAlternativeVersionValue = string | Record<string, unknown>;

type EnrichedParameterHistoryEntry = Omit<BaseParameterHistoryEntry, 'source' | 'alternative_versions'> & {
  change_summary?: string | null;
  decision_note?: string | null;
  source?: HistorySourceValue;
  alternative_versions?: HistoryAlternativeVersionValue[] | null;
  rollbackable?: boolean | null;
};

type HistorySourceDisplay = {
  label: string;
  fields: Array<{ key: string; label: string; value: string }>;
};

type AlternativeVersionDisplay = {
  key: string;
  label: string;
  id: string | null;
  summary: string | null;
};

function strategyTypeLabel(value: string): string {
  const map: Record<string, string> = {
    MOMENTUM: '动量 / 趋势跟随',
    GRID: '网格交易',
    MEAN_REVERSION: '均值回归',
    BUY_AND_HOLD: '定投 / 持有',
    ASSET_ALLOCATION: '资产配置型',
    MULTI_FACTOR: '多因子',
    GENERAL: '通用策略',
  };
  return map[value] ?? value;
}

function strategyStatusLabel(value: string): string {
  const lowered = String(value ?? '').toLowerCase();
  if (lowered.includes('complete') || lowered.includes('done') || lowered.includes('success') || lowered === 'active') {
    return '已完成';
  }
  if (lowered.includes('pending') || lowered.includes('queued') || lowered.includes('running')) {
    return '进行中';
  }
  if (lowered.includes('fail') || lowered.includes('error')) {
    return '失败';
  }
  return value || '-';
}

function benchmarkLabel(value: string | null | undefined): string {
  const normalized = String(value ?? '').toUpperCase();
  if (normalized === 'SPY') return '标普 SPY';
  if (normalized === 'QQQ') return '纳指 QQQ';
  return normalized || '-';
}

function rebalanceLabel(value: string | null | undefined): string {
  const normalized = String(value ?? '').toLowerCase();
  const map: Record<string, string> = {
    never: '从不',
    daily: '每日',
    weekly: '每周',
    monthly: '每月',
    quarterly: '每季度',
    semiannual: '每半年',
    yearly: '每年',
    monthly_first_trading_day: '每月首个交易日',
  };
  return map[normalized] ?? (value ? String(value) : '-');
}

function timeframeLabel(value: string): string {
  const map: Record<string, string> = {
    daily: '日线',
    weekly: '周线',
    monthly: '月线',
    hourly: '小时线',
  };
  return map[value.toLowerCase()] ?? value;
}

function parameterOrder(key: string): number {
  return factorIdFromWeightKey(key) ? (PARAMETER_ORDER.weights ?? 192) + 1 : (PARAMETER_ORDER[key] ?? 999);
}

function rememberFactorDisplayName(lookup: FactorDisplayNameLookup, factorId: unknown, name: unknown): void {
  if (typeof factorId !== 'string' || !factorId.trim() || typeof name !== 'string' || !name.trim()) {
    return;
  }
  lookup[factorId.trim()] = name.trim();
}

function collectFactorDisplayNames(value: unknown, lookup: FactorDisplayNameLookup): void {
  if (!value || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectFactorDisplayNames(item, lookup));
    return;
  }

  const record = value as Record<string, unknown>;
  rememberFactorDisplayName(lookup, record.factor_id, record.name ?? record.factor_name ?? record.display_name ?? record.label);
  Object.values(record).forEach((item) => collectFactorDisplayNames(item, lookup));
}

function buildFactorDisplayNames(
  strategy: ApiStrategyDetail | null,
  historyEntry?: EnrichedParameterHistoryEntry | null,
): FactorDisplayNameLookup {
  const lookup: FactorDisplayNameLookup = {};
  collectFactorDisplayNames(strategy?.parameters, lookup);
  collectFactorDisplayNames(strategy?.multi_factor_profile, lookup);
  collectFactorDisplayNames(historyEntry?.parameters, lookup);
  return lookup;
}

function parameterLabel(key: string, factorNames: FactorDisplayNameLookup = {}): string {
  const factorWeightLabel = formatFactorWeightLabel(key, factorNames[factorIdFromWeightKey(key) ?? '']);
  if (factorWeightLabel) {
    return factorWeightLabel;
  }
  if (PARAMETER_LABELS[key]) {
    return PARAMETER_LABELS[key];
  }
  const sharedLabel = formatSharedParameterLabel(key);
  return sharedLabel !== key ? sharedLabel : key.replace(/_/g, ' ');
}

function neutralizationStatusLabel(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  const map: Record<string, string> = {
    EXECUTED: '已执行',
    READY: '已就绪',
    NOT_EXECUTED: '未执行',
    NOT_EXECUTED_MISSING_INDUSTRY_PIT: '未执行：缺少 PIT 行业字段',
    LOCAL_PENDING_API_PREVIEW: '等待预检',
  };
  return map[normalized] ?? '状态待确认';
}

function scoringMethodLabel(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim().toLowerCase();
  const map: Record<string, string> = {
    zscore_weighted: '标准化加权',
    rank_weighted: '排名加权',
  };
  return map[normalized] ?? formatSharedParameterValue(String(value ?? ''), 'scoring_method');
}

function historyCommentLabel(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return TEXT.historyFallbackComment;
  }
  return HISTORY_COMMENT_LABELS[normalized] ?? normalized;
}

function readDisplayText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? '是' : '否';
  }
  return null;
}

function truncateText(value: string, maxLength = 68): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength).trimEnd()}...`;
}

function formatHistorySummaryLine(line: string, factorNames: FactorDisplayNameLookup): string {
  return line
    .replace(/\bfactor[_\s]+weight[_\s]+([a-z0-9]+(?:[_\s]+[a-z0-9]+)*)[_\s]+pct\b/gi, (_match, rawFactorId: string) => {
      const factorId = rawFactorId.trim().toLowerCase().replace(/[_\s]+/g, '_');
      return formatFactorWeightLabel(`factor_weight__${factorId}_pct`, factorNames[factorId]) ?? `因子权重 · ${formatFactorDisplayName(factorId, factorNames[factorId])}`;
    })
    .replace(/\bfactor[_\s]+ids\b/gi, '因子篮子')
    .replace(/\bneutralization[_\s]+method\b/gi, '中性化方法')
    .replace(/\bscoring[_\s]+method\b/gi, '打分方法')
    .replace(/\brebalance[_\s]+frequency\b/gi, '再平衡频率')
    .replace(/\bholding[_\s]+count\b/gi, '实际持仓数量')
    .replace(/\btop[_\s]+n\b/gi, '持仓数量')
    .replace(/\bweights\b/gi, '权重方案')
    .replace(/\bdirections\b/gi, '方向设置')
    .replace(/\bindustry\b/gi, '行业中性')
    .replace(/\bzscore_weighted\b/gi, '标准化加权')
    .replace(/\brank_weighted\b/gi, '排名加权')
    .replace(/\bsemiannual\b/gi, '每半年')
    .replace(/\bquarterly\b/gi, '每季度')
    .replace(/\bmonthly\b/gi, '每月')
    .replace(/\byearly\b/gi, '每年');
}

function formatHistorySummaryText(value: string, factorNames: FactorDisplayNameLookup): string {
  return value
    .split(/\r?\n/)
    .map((line) => formatHistorySummaryLine(line, factorNames))
    .join('\n');
}

function historyChangeSummary(entry: EnrichedParameterHistoryEntry, factorNames: FactorDisplayNameLookup = {}): string {
  const summary = readDisplayText(entry.change_summary);
  if (summary) {
    return formatHistorySummaryText(summary, factorNames);
  }
  const comment = readDisplayText(entry.comment);
  return comment ? historyCommentLabel(comment) : TEXT.historyChangeSummaryFallback;
}

function historyDecisionNote(entry: EnrichedParameterHistoryEntry): string {
  const decisionNote = readDisplayText(entry.decision_note);
  if (!decisionNote || HISTORY_DECISION_NOTE_PLACEHOLDERS.has(decisionNote) || /^[?？]+$/.test(decisionNote)) {
    return TEXT.historyDecisionNoteFallback;
  }
  return decisionNote;
}

function historyDecisionNoteSummary(entry: EnrichedParameterHistoryEntry): string {
  return truncateText(historyDecisionNote(entry));
}

function parameterVersionDisplayLabel(value: string | null | undefined): string | null {
  const raw = readDisplayText(value);
  if (!raw) {
    return null;
  }
  return formatStrategyVersionTag(raw) ?? raw;
}

function historyVersionLabel(entry: EnrichedParameterHistoryEntry | null | undefined): string {
  if (typeof entry?.version_number === 'number') {
    return `v${entry.version_number}`;
  }
  return parameterVersionDisplayLabel(entry?.parameter_version_id) ?? TEXT.recentRunVersionFallback;
}

function currentHistoryVersionLabel(strategy: ApiStrategyDetail, rows: EnrichedParameterHistoryEntry[]): string {
  const currentEntry = rows.find((entry) => isCurrentHistoryEntry(entry, strategy));
  if (currentEntry) {
    return historyVersionLabel(currentEntry);
  }
  if (typeof strategy.current_parameter_version === 'number') {
    return `v${strategy.current_parameter_version}`;
  }
  return parameterVersionDisplayLabel(strategy.current_parameter_version_id) ?? '-';
}

function renderMultilineText(value: string) {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) {
    return value;
  }
  return (
    <span className="strategy-detail-multiline-text">
      {lines.map((line, index) => (
        <span className="strategy-detail-multiline-text__line" key={`${line}-${index}`}>
          {line}
        </span>
      ))}
    </span>
  );
}

function sourceTypeLabel(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim().toLowerCase();
  const map: Record<string, string> = {
    initial: '初始版本',
    import: '初始导入',
    manual: '人工修订',
    revision: '人工修订',
    restore: '版本回滚',
    rollback: '版本回滚',
    backtest: '回测结果',
    run: '回测结果',
    optimization: '优化候选',
    optimization_job: '优化作业',
    optimization_candidate: '优化候选',
    optimization_promotion: '优化晋升',
    candidate: '优化候选',
    parameter_version: '参数版本',
  };
  return map[normalized] ?? (value ? String(value) : TEXT.historySourceFallback);
}

function sourceFieldLabel(key: string): string {
  const map: Record<string, string> = {
    type: '来源类型',
    source_type: '来源类型',
    kind: '来源类型',
    job_id: '优化作业',
    optimization_job_id: '优化作业',
    run_id: '回测',
    backtest_run_id: '回测',
    candidate_id: '候选',
    optimization_candidate_id: '候选',
    version_id: '来源版本',
    parameter_version_id: '参数版本',
    source_parameter_version_id: '来源参数版本',
    base_parameter_version_id: '基准参数版本',
    candidate_label: '候选标签',
  };
  return map[key] ?? key.replace(/_/g, ' ');
}

function sourceFieldRank(key: string): number {
  const order: Record<string, number> = {
    type: 10,
    source_type: 10,
    kind: 10,
    optimization_job_id: 20,
    job_id: 20,
    candidate_id: 30,
    optimization_candidate_id: 30,
    run_id: 40,
    backtest_run_id: 40,
    parameter_version_id: 50,
    source_parameter_version_id: 50,
    version_id: 60,
    base_parameter_version_id: 70,
  };
  return order[key] ?? 999;
}

function normalizeHistorySource(source: HistorySourceValue): HistorySourceDisplay {
  if (typeof source === 'string') {
    const label = sourceTypeLabel(source);
    return { label, fields: [{ key: 'source_type', label: '来源类型', value: label }] };
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return { label: TEXT.historySourceFallback, fields: [] };
  }

  const label =
    readDisplayText(source.label) ??
    readDisplayText(source.source_label) ??
    sourceTypeLabel(readDisplayText(source.source_type) ?? readDisplayText(source.type) ?? readDisplayText(source.kind));

  const fields = Object.entries(source)
    .filter(([key]) => !['label', 'source_label'].includes(key))
    .map(([key, value]) => {
      const rawValue = readDisplayText(value);
      if (!rawValue) {
        return null;
      }
      const displayValue = ['type', 'source_type', 'kind'].includes(key)
        ? sourceTypeLabel(rawValue)
        : key.includes('parameter_version_id')
          ? parameterVersionDisplayLabel(rawValue) ?? rawValue
          : rawValue;
      return { key, label: sourceFieldLabel(key), value: displayValue };
    })
    .filter((field): field is { key: string; label: string; value: string } => Boolean(field))
    .sort((left, right) => sourceFieldRank(left.key) - sourceFieldRank(right.key));

  return { label, fields };
}

function normalizeAlternativeVersions(
  versions: HistoryAlternativeVersionValue[] | null | undefined,
): AlternativeVersionDisplay[] {
  if (!Array.isArray(versions)) {
    return [];
  }
  return versions.map((item, index) => {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      return {
        key: trimmed || `alternative-${index}`,
        label: (formatStrategyVersionTag(trimmed) ?? trimmed) || `替代版本 ${index + 1}`,
        id: parameterVersionDisplayLabel(trimmed),
        summary: null,
      };
    }

    const record = item as Record<string, unknown>;
    const id =
      readDisplayText(record.parameter_version_id) ??
      readDisplayText(record.version_id) ??
      readDisplayText(record.id);
    const versionNumber = readDisplayText(record.version_number);
    const label =
      readDisplayText(record.label) ??
      readDisplayText(record.name) ??
      (id ? formatStrategyVersionTag(id) ?? id : null) ??
      (versionNumber ? `v${versionNumber}` : `替代版本 ${index + 1}`);
    const summary =
      readDisplayText(record.reason) ??
      readDisplayText(record.summary) ??
      readDisplayText(record.change_summary) ??
      readDisplayText(record.decision_note);

    return {
      key: id ?? label ?? `alternative-${index}`,
      label,
      id: parameterVersionDisplayLabel(id),
      summary,
    };
  });
}

function isCurrentHistoryEntry(entry: EnrichedParameterHistoryEntry, strategy: ApiStrategyDetail): boolean {
  if (entry.parameter_version_id && strategy.current_parameter_version_id) {
    return entry.parameter_version_id === strategy.current_parameter_version_id;
  }
  return (
    typeof entry.version_number === 'number' &&
    typeof strategy.current_parameter_version === 'number' &&
    entry.version_number === strategy.current_parameter_version
  );
}

function canRestoreHistoryEntry(entry: EnrichedParameterHistoryEntry, strategy: ApiStrategyDetail): boolean {
  return entry.rollbackable === true && !isCurrentHistoryEntry(entry, strategy);
}

function rollbackStateLabel(entry: EnrichedParameterHistoryEntry, strategy: ApiStrategyDetail): string {
  if (isCurrentHistoryEntry(entry, strategy)) {
    return TEXT.historyRollbackCurrent;
  }
  if (entry.rollbackable === true) {
    return TEXT.historyRollbackable;
  }
  if (entry.rollbackable === false) {
    return TEXT.historyNotRollbackable;
  }
  return TEXT.historyRollbackUnknown;
}

function rollbackStateTone(entry: EnrichedParameterHistoryEntry, strategy: ApiStrategyDetail): string {
  if (isCurrentHistoryEntry(entry, strategy)) {
    return 'current';
  }
  if (entry.rollbackable === true) {
    return 'enabled';
  }
  if (entry.rollbackable === false) {
    return 'disabled';
  }
  return 'unknown';
}

function makeRestoreIdempotencyKey(strategyId: string, parameterVersionId: string): string {
  const randomPart =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `restore-${strategyId}-${parameterVersionId}-${randomPart}`;
}

function hasParameterValue(value: ParameterValue | undefined): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function formatWeightRecord(record: Record<string, unknown>, factorNames: FactorDisplayNameLookup): string {
  const entries = Object.entries(record)
    .map(([factorId, weight]) => {
      const numeric = typeof weight === 'number' ? weight : Number(weight);
      return Number.isFinite(numeric) ? { factorId, numeric } : null;
    })
    .filter((item): item is { factorId: string; numeric: number } => Boolean(item));
  const totalAbsWeight = entries.reduce((total, entry) => total + Math.abs(entry.numeric), 0);
  const decimalScale = totalAbsWeight > 0 && totalAbsWeight <= 1.000001;
  return entries.length
    ? entries
        .map(({ factorId, numeric }) => {
          const pctValue = decimalScale ? numeric * 100 : numeric;
          return `${formatFactorDisplayName(factorId, factorNames[factorId])} ${Number(pctValue.toFixed(2))}%`;
        })
        .join('；')
    : '-';
}

function formatParameterValue(
  key: string,
  value: ParameterValue,
  factorNames: FactorDisplayNameLookup = {},
): string {
  if (value === null || value === undefined || value === '') return '-';
  if (key === 'strategy_type') return strategyTypeLabel(String(value));
  if (key === 'benchmark_symbol') return benchmarkLabel(String(value));
  if (key === 'scoring_method') return scoringMethodLabel(String(value));
  if (key === 'rebalance_frequency' || key === 'investment_frequency') return rebalanceLabel(String(value));
  if (key === 'observation_timeframe') return timeframeLabel(String(value));
  if (typeof value === 'number') {
    if (key.endsWith('_pct') || ['rsi_buy_threshold', 'rsi_sell_threshold', 'deviation_threshold'].includes(key)) {
      return `${value}%`;
    }
    if (key.endsWith('_atr')) return `${value} ATR`;
    if (key === 'capital' || key === 'contribution_amount') return `${value.toLocaleString('zh-HK')} 美元`;
    return String(value);
  }
  if (typeof value === 'boolean') {
    return formatSharedParameterValue(value, key);
  }
  if (typeof value === 'string') {
    return formatSharedParameterValue(value, key);
  }
  if (Array.isArray(value) && key === 'allocation_assets') {
    const symbols = value
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        const symbol = (item as Record<string, unknown>).symbol;
        return typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
      })
      .filter(Boolean);
    return symbols.length ? symbols.join(' / ') : '-';
  }
  if (Array.isArray(value)) {
    if (key === 'factor_ids') {
      return value.length ? formatFactorList(value, factorNames) : '-';
    }
    return value.length ? `${value.length} 项配置` : '-';
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (key === 'weights') {
      return formatWeightRecord(record, factorNames);
    }
    if (key === 'directions') {
      const entries = Object.entries(record)
        .map(([factorId, direction]) => `${formatFactorDisplayName(factorId, factorNames[factorId])} ${formatSharedParameterValue(String(direction ?? ''), 'direction')}`)
        .filter((item) => item.trim().length > 0);
      return entries.length ? entries.join('；') : '-';
    }
    if (key === 'neutralization') {
      const enabled = Boolean(record.enabled);
      const method = formatSharedParameterValue(String(record.method ?? 'industry'), 'neutralization_method');
      const status = neutralizationStatusLabel(
        typeof record.execution_status === 'string'
          ? record.execution_status
          : typeof record.status === 'string'
            ? record.status
            : null,
      );
      return `${enabled ? '启用' : '未启用'} · ${method}${status ? ` · ${status}` : ''}`;
    }
    if (key === 'pit_snapshot_refs') {
      const entries = Object.entries(record)
        .map(([snapshotKey, snapshotValue]) => `${parameterLabel(snapshotKey)} ${String(snapshotValue ?? '-')}`)
        .filter((item) => item.trim().length > 0);
      return entries.length ? entries.join('；') : '-';
    }
    return formatSharedParameterValue(value, key);
  }
  return formatSharedParameterValue(value, key);
}

function formatRunMetric(key: string, value: unknown): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  if (key.includes('sharpe') || key.includes('ratio')) return formatRatio(value);
  if (key.includes('return') || key.includes('drawdown') || key.includes('rate')) return formatPercent(value);
  return value.toLocaleString('en-US');
}

function formatRunCardDate(value: string | null | undefined): string {
  if (!value) return '-';
  const isoDateMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDateMatch) {
    return `${isoDateMatch[1]}/${isoDateMatch[2]}/${isoDateMatch[3]}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

function runStatusTone(status: string): 'positive' | 'warning' | 'negative' {
  const lowered = String(status ?? '').toLowerCase();
  if (lowered.includes('fail') || lowered.includes('error')) return 'negative';
  if (lowered.includes('warning')) return 'warning';
  return 'positive';
}

function runVersionTag(value: string | null | undefined): string {
  return formatStrategyVersionTag(value) ?? TEXT.recentRunVersionFallback;
}

function runRangeLabel(run: ApiBacktestRunListItem): string {
  if (run.start_date && run.end_date) {
    return `${formatRunCardDate(run.start_date)} - ${formatRunCardDate(run.end_date)}`;
  }
  return TEXT.recentRunRangeFallback;
}

function readStringParameter(value: ParameterValue | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function readNumberParameter(value: ParameterValue | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed && /^-?\d+(?:\.\d+)?$/.test(trimmed)) {
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
}

function rebalanceSummaryLabel(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const map: Record<string, string> = {
    never: '不主动再平衡',
    daily: '按日调仓',
    weekly: '按周调仓',
    monthly: '按月调仓',
    quarterly: '按季度调仓',
    semiannual: '每半年调仓',
    yearly: '按年调仓',
    monthly_first_trading_day: '每月首个交易日调仓',
  };
  return map[normalized] ?? `按 ${value} 调仓`;
}

function ensureSentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '基于当前参数执行策略。';
  }
  return /[。！？.!?]$/.test(trimmed) ? trimmed : `${trimmed}。`;
}

function buildStrategySummary(strategy: ApiStrategyDetail): string {
  const parameters = strategy.parameters ?? {};
  const universe =
    strategy.universe_name?.trim() ||
    readStringParameter(parameters.universe_name) ||
    '当前股票池';
  const rawBenchmark =
    strategy.benchmark_symbol?.trim() ||
    readStringParameter(parameters.benchmark_symbol);
  const benchmark = rawBenchmark ? benchmarkLabel(rawBenchmark) : null;
  const includeBenchmark = Boolean(
    benchmark &&
      benchmark !== '-' &&
      rawBenchmark &&
      !universe.toUpperCase().includes(rawBenchmark.toUpperCase()) &&
      !universe.includes(benchmark),
  );
  const rebalance = rebalanceSummaryLabel(
    strategy.rebalance_frequency ?? readStringParameter(parameters.rebalance_frequency),
  );
  const weightingMethod = readStringParameter(parameters.weighting_method);
  const weightingLabel =
    weightingMethod && weightingMethod !== '-'
      ? formatSharedParameterValue(weightingMethod, 'weighting_method')
      : null;

  const parts: string[] = [];

  if (strategy.strategy_type === 'MOMENTUM') {
    const lookbackMonths = readNumberParameter(parameters.lookback_months);
    const skipRecentMonths = readNumberParameter(parameters.skip_recent_months);
    const topN = readNumberParameter(parameters.top_n);
    const holdRankThreshold = readNumberParameter(parameters.hold_rank_threshold);

    if (lookbackMonths !== null) {
      parts.push(
        skipRecentMonths !== null && skipRecentMonths > 0
          ? `按过去 ${lookbackMonths} 个月剔除最近 ${skipRecentMonths} 个月的收益做动量排序`
          : `按过去 ${lookbackMonths} 个月收益做动量排序`,
      );
    } else {
      parts.push('执行动量轮动');
    }

    if (topN !== null) {
      if (holdRankThreshold !== null && holdRankThreshold >= topN) {
        parts.push(`持有前 ${topN} 名，跌出前 ${holdRankThreshold} 名时调出`);
      } else {
        parts.push(`持有前 ${topN} 名`);
      }
    } else if (holdRankThreshold !== null) {
      parts.push(`以排名前 ${holdRankThreshold} 名作为持仓阈值`);
    }
  } else if (strategy.strategy_type === 'MEAN_REVERSION') {
    const timeframe = readStringParameter(parameters.observation_timeframe);
    const bollingerPeriod = readNumberParameter(parameters.bollinger_period);
    const rsiPeriod = readNumberParameter(parameters.rsi_period);
    const rsiBuyThreshold = readNumberParameter(parameters.rsi_buy_threshold);
    const rsiSellThreshold = readNumberParameter(parameters.rsi_sell_threshold);
    const longEntrySize = readNumberParameter(parameters.long_entry_size_pct);
    const shortEntrySize = readNumberParameter(parameters.short_entry_size_pct);

    parts.push(`基于${timeframe ? timeframeLabel(timeframe) : '当前'}信号做均值回归交易`);

    if (bollingerPeriod !== null && rsiPeriod !== null) {
      parts.push(`结合 ${bollingerPeriod} 期布林带与 RSI(${rsiPeriod}) 判断偏离`);
    } else if (rsiPeriod !== null) {
      parts.push(`使用 RSI(${rsiPeriod}) 识别偏离`);
    } else if (bollingerPeriod !== null) {
      parts.push(`使用 ${bollingerPeriod} 期布林带识别偏离`);
    }

    if (rsiBuyThreshold !== null && rsiSellThreshold !== null) {
      parts.push(`RSI 低于 ${rsiBuyThreshold} 时分批买入，高于 ${rsiSellThreshold} 时分批减仓`);
    }

    if (longEntrySize !== null || shortEntrySize !== null) {
      if (longEntrySize !== null && shortEntrySize !== null && longEntrySize === shortEntrySize) {
        parts.push(`每次按 ${longEntrySize}% 仓位进出`);
      } else {
        if (longEntrySize !== null) {
          parts.push(`买入仓位 ${longEntrySize}%`);
        }
        if (shortEntrySize !== null) {
          parts.push(`卖出仓位 ${shortEntrySize}%`);
        }
      }
    }
  } else if (strategy.strategy_type === 'GRID') {
    const gridInterval = readNumberParameter(parameters.grid_interval);
    const initialPosition = readNumberParameter(parameters.initial_position);
    const buySize = readNumberParameter(parameters.buy_size_pct);
    const sellStep = readNumberParameter(parameters.sell_step_pct);
    const sellSize = readNumberParameter(parameters.sell_size_pct);
    const maxStopLoss = readNumberParameter(parameters.max_stop_loss_pct);

    parts.push(
      gridInterval !== null ? `按 ${gridInterval}% 网格间距分批交易` : '按网格规则分批交易',
    );

    if (initialPosition !== null) {
      parts.push(`初始仓位 ${initialPosition}%`);
    }
    if (gridInterval !== null && buySize !== null) {
      parts.push(`每下跌 ${gridInterval}% 加仓 ${buySize}%`);
    } else if (buySize !== null) {
      parts.push(`每次加仓 ${buySize}%`);
    }
    if (sellStep !== null && sellSize !== null) {
      parts.push(`每上涨 ${sellStep}% 减仓 ${sellSize}%`);
    } else if (sellSize !== null) {
      parts.push(`每次减仓 ${sellSize}%`);
    }
    if (maxStopLoss !== null) {
      parts.push(`最大止损 ${maxStopLoss}%`);
    }
  } else if (strategy.strategy_type === 'BUY_AND_HOLD') {
    const contributionAmount = readNumberParameter(parameters.contribution_amount);
    const investmentFrequency = readStringParameter(parameters.investment_frequency);
    const contributionAnchor = readStringParameter(parameters.contribution_anchor);
    const dynamicInvestmentLogic = readStringParameter(parameters.dynamic_investment_logic);

    parts.push('长期持有核心资产');
    if (contributionAmount !== null && investmentFrequency) {
      parts.push(
        `${rebalanceLabel(investmentFrequency)}${dynamicInvestmentLogic ? '基准定投' : '定投'} ${contributionAmount.toLocaleString('zh-HK')} 美元`,
      );
    } else if (contributionAmount !== null) {
      parts.push(`${dynamicInvestmentLogic ? '基准投入' : '投入'} ${contributionAmount.toLocaleString('zh-HK')} 美元`);
    }
    if (contributionAnchor) {
      parts.push(`按${contributionAnchor}执行`);
    }
    if (dynamicInvestmentLogic) {
      parts.push('按估值区间动态调整投入倍率');
    }
  } else if (strategy.strategy_type === 'ASSET_ALLOCATION') {
    const allocationAssets = Array.isArray(parameters.allocation_assets)
      ? parameters.allocation_assets
          .map((item) => {
            if (!item || typeof item !== 'object') return '';
            const symbol = (item as Record<string, unknown>).symbol;
            return typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
          })
          .filter(Boolean)
      : [];
    const mode = readStringParameter(parameters.investment_mode);
    const costEnabled = parameters.cost_model_enabled === true;
    parts.push(
      allocationAssets.length
        ? `${allocationAssets.join('/')} 目标权重配置`
        : '多资产目标权重配置',
    );
    parts.push(mode === 'dca' ? '定投执行' : 'All-in 建仓');
    if (costEnabled) {
      parts.push('纳入成本模拟');
    }
  } else if (strategy.strategy_type === 'MULTI_FACTOR') {
    const factorCount = strategy.multi_factor_profile?.components.length ?? (Array.isArray(parameters.factor_ids) ? parameters.factor_ids.length : 0);
    const scoringMethod = readStringParameter(parameters.scoring_method);
    const neutralization =
      strategy.multi_factor_profile?.neutralization ??
      (parameters.neutralization && typeof parameters.neutralization === 'object' && !Array.isArray(parameters.neutralization)
        ? parameters.neutralization as Record<string, unknown>
        : null);
    parts.push(factorCount ? `组合 ${factorCount} 个因子形成综合评分` : '按因子篮子形成综合评分');
    if (scoringMethod) {
      parts.push(`使用${scoringMethodLabel(scoringMethod)}打分`);
    }
    if (neutralization) {
      const enabled = Boolean(neutralization.enabled);
      const blocker = typeof neutralization.blocker_reason === 'string' ? neutralization.blocker_reason : null;
      parts.push(enabled && !blocker ? '启用行业中性化门禁' : blocker ? '行业中性化等待 PIT 行业字段' : '未启用行业中性化');
    }
  } else {
    parts.push(`执行${strategyTypeLabel(strategy.strategy_type)}策略`);
  }

  if (weightingLabel && weightingLabel !== '-') {
    parts.push(`按${weightingLabel}配置`);
  }
  if (rebalance) {
    parts.push(rebalance);
  }
  if (includeBenchmark && benchmark) {
    parts.push(`基准为${benchmark}`);
  }

  const filteredParts = parts
    .map((part) => part.trim())
    .filter((part, index, allParts) => part.length > 0 && allParts.indexOf(part) === index);

  if (filteredParts.length) {
    const [firstPart, ...restParts] = filteredParts;
    return ensureSentence(`在${universe}中${[firstPart, ...restParts].join('，')}`);
  }

  const fallbackDescription =
    readStringParameter(parameters.strategy_description) ??
    (typeof strategy.description === 'string' ? strategy.description.trim() : null);
  if (fallbackDescription) {
    return ensureSentence(fallbackDescription);
  }

  return ensureSentence(`在${universe}中执行当前策略`);
}

export function StrategyDetailPage({ strategyId }: { strategyId: string }): JSX.Element {
  const api = useApiClient();
  const [strategy, setStrategy] = useState<ApiStrategyDetail | null>(null);
  const [recentRuns, setRecentRuns] = useState<ApiBacktestRunListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [openingRevision, setOpeningRevision] = useState(false);
  const [recentRunsLoading, setRecentRunsLoading] = useState(true);
  const [recentRunsError, setRecentRunsError] = useState<string | null>(null);
  const [restoreTargetId, setRestoreTargetId] = useState<string | null>(null);
  const [restoreDecisionNote, setRestoreDecisionNote] = useState('');
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoringVersion, setRestoringVersion] = useState(false);

  const canOpenOptimization = Boolean(strategy);
  const canEditStrategy = strategy ? (strategy.allowed_actions?.includes('edit_parameters') ?? true) : false;
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);

  function handleOpenOptimization(): void {
    if (!strategy) {
      return;
    }
    if (strategy.latest_optimization_job_id) {
      navigateTo(`/optimization-jobs/${strategy.latest_optimization_job_id}`);
      return;
    }
    navigateTo(
      buildOptimizationConfigPath({
        strategyId: strategy.id,
        entryPoint: 'strategy_detail',
      }),
    );
  }

  async function handleEditStrategy(): Promise<void> {
    if (!strategy || openingRevision) {
      return;
    }
    try {
      setOpeningRevision(true);
      setActionError(null);
      if (strategy.strategy_type === 'MULTI_FACTOR' || strategy.strategy_type === 'COMPOSITE_FACTOR') {
        navigateTo('/factor-models/new');
        return;
      }
      const session = await api.createCreationSession({
        strategy_type: strategy.strategy_type,
        mode: 'REVISION',
        base_strategy_id: strategy.id,
        base_parameter_version_id: strategy.current_parameter_version_id ?? null,
      });
      navigateTo(`/creation/sessions/${session.id}`);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : TEXT.editError);
    } finally {
      setOpeningRevision(false);
    }
  }

  function handleOpenRestore(entry: EnrichedParameterHistoryEntry): void {
    setRestoreTargetId(entry.parameter_version_id);
    setRestoreDecisionNote('');
    setRestoreError(null);
  }

  function handleCloseRestore(): void {
    if (restoringVersion) {
      return;
    }
    setRestoreTargetId(null);
    setRestoreDecisionNote('');
    setRestoreError(null);
  }

  async function handleConfirmRestore(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!strategy || !restoreTargetEntry || restoringVersion) {
      return;
    }

    const decisionNote = restoreDecisionNote.trim();
    if (!decisionNote) {
      setRestoreError(TEXT.restoreNoteRequired);
      return;
    }

    const restoreStrategyParameterVersion = api.restoreStrategyParameterVersion;
    if (typeof restoreStrategyParameterVersion !== 'function') {
      setRestoreError(TEXT.restoreApiMissing);
      return;
    }

    try {
      setRestoringVersion(true);
      setRestoreError(null);
      const payload: ParameterVersionRestorePayload = {
        idempotency_key: makeRestoreIdempotencyKey(strategy.id, restoreTargetEntry.parameter_version_id),
        base_parameter_version_id: strategy.current_parameter_version_id ?? null,
        decision_note: decisionNote,
      };
      const restored = await restoreStrategyParameterVersion(strategy.id, restoreTargetEntry.parameter_version_id, payload);
      setStrategy(restored);
      setSelectedHistoryId(null);
      setRestoreTargetId(null);
      setRestoreDecisionNote('');
    } catch (caught) {
      setRestoreError(caught instanceof Error ? caught.message : TEXT.restoreError);
    } finally {
      setRestoringVersion(false);
    }
  }

  const strategySummary = useMemo(() => (strategy ? buildStrategySummary(strategy) : ''), [strategy]);
  const factorDisplayNames = useMemo(() => buildFactorDisplayNames(strategy), [strategy]);
  const tradingLogic = useMemo(() => {
    const value = strategy?.parameters?.trading_logic;
    return typeof value === 'string' && value.trim() ? value : null;
  }, [strategy]);

  const parameterCards = useMemo<ParameterCardItem[]>(() => {
    const parameters = strategy?.parameters ?? {};
    return Object.entries(parameters)
      .filter(([key, value]) => !HIDDEN_PARAMETER_KEYS.has(key) && hasParameterValue(value))
      .sort((left, right) => parameterOrder(left[0]) - parameterOrder(right[0]))
      .map(([key, value]) => ({
        key,
        label: parameterLabel(key, factorDisplayNames),
        value: formatParameterValue(key, value, factorDisplayNames),
      }));
  }, [factorDisplayNames, strategy]);

  const parameterHistoryRows = useMemo<EnrichedParameterHistoryEntry[]>(
    () => (strategy?.parameter_history ?? []) as EnrichedParameterHistoryEntry[],
    [strategy],
  );

  const selectedHistoryEntry = useMemo(
    () => parameterHistoryRows.find((entry) => entry.parameter_version_id === selectedHistoryId) ?? null,
    [parameterHistoryRows, selectedHistoryId],
  );

  const restoreTargetEntry = useMemo(
    () => parameterHistoryRows.find((entry) => entry.parameter_version_id === restoreTargetId) ?? null,
    [parameterHistoryRows, restoreTargetId],
  );

  const currentHistoryLabel = useMemo(
    () => (strategy ? currentHistoryVersionLabel(strategy, parameterHistoryRows) : '-'),
    [parameterHistoryRows, strategy],
  );

  const selectedHistorySource = useMemo(
    () => normalizeHistorySource(selectedHistoryEntry?.source),
    [selectedHistoryEntry],
  );

  const selectedAlternativeVersions = useMemo(
    () => normalizeAlternativeVersions(selectedHistoryEntry?.alternative_versions),
    [selectedHistoryEntry],
  );

  const selectedHistoryLogic = useMemo(() => {
    const value = selectedHistoryEntry?.parameters?.trading_logic;
    return typeof value === 'string' && value.trim() ? value : null;
  }, [selectedHistoryEntry]);
  const selectedHistoryFactorDisplayNames = useMemo(
    () => buildFactorDisplayNames(strategy, selectedHistoryEntry),
    [selectedHistoryEntry, strategy],
  );

  const selectedHistoryCards = useMemo<ParameterCardItem[]>(() => {
    const parameters = selectedHistoryEntry?.parameters ?? {};
    return Object.entries(parameters)
      .filter(([key, value]) => !HIDDEN_HISTORY_PARAMETER_KEYS.has(key) && key !== 'trading_logic' && hasParameterValue(value))
      .sort((left, right) => parameterOrder(left[0]) - parameterOrder(right[0]))
      .map(([key, value]) => ({
        key,
        label: parameterLabel(key, selectedHistoryFactorDisplayNames),
        value: formatParameterValue(key, value, selectedHistoryFactorDisplayNames),
      }));
  }, [selectedHistoryEntry, selectedHistoryFactorDisplayNames]);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        setLoading(true);
        setError(null);
        const payload = await api.getStrategyDetail(strategyId);
        if (!cancelled) setStrategy(payload);
      } catch (caught) {
        if (!cancelled) setError((caught as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [api, strategyId]);

  useEffect(() => {
    let cancelled = false;

    async function loadRecentRuns(): Promise<void> {
      try {
        setRecentRunsLoading(true);
        setRecentRunsError(null);
        await new Promise((resolve) => window.setTimeout(resolve, FIRST_SCREEN_DEFER_MS));
        if (cancelled) {
          return;
        }
        const payload = await api.listBacktestRuns({ limit: 24 });
        if (cancelled) {
          return;
        }
        const filtered = payload
          .filter((item) => item.strategy_id === strategyId)
          .sort((left, right) => {
            const leftTime = new Date(left.completed_at ?? left.updated_at ?? left.created_at ?? 0).getTime();
            const rightTime = new Date(right.completed_at ?? right.updated_at ?? right.created_at ?? 0).getTime();
            return rightTime - leftTime;
          })
          .slice(0, 6);
        setRecentRuns(filtered);
      } catch (caught) {
        if (!cancelled) {
          setRecentRuns([]);
          setRecentRunsError(caught instanceof Error ? caught.message : TEXT.emptyRun);
        }
      } finally {
        if (!cancelled) {
          setRecentRunsLoading(false);
        }
      }
    }

    void loadRecentRuns();
    return () => {
      cancelled = true;
    };
  }, [api, strategyId]);

  if (loading) {
    return (
      <section className="panel strategy-detail-page">
        <div className="panel-header">
          <h2>{TEXT.title}</h2>
        </div>
        <p className="hero-copy">{TEXT.loading}</p>
      </section>
    );
  }

  if (error || !strategy) {
    return (
      <section className="panel strategy-detail-page">
        <div className="panel-header">
          <h2>{TEXT.title}</h2>
        </div>
        <p className="hero-copy">{error ?? TEXT.loadError}</p>
      </section>
    );
  }

  return (
    <div className="stack strategy-detail-page">
      <section className="strategy-detail-hero panel">
        <div className="strategy-detail-hero__copy">
          <p className="eyebrow">{TEXT.eyebrow}</p>
          <div className="strategy-detail-hero__title-row">
            <h1 className="strategy-detail-hero__title">{getStrategyDisplayName(strategy.name, strategy.id)}</h1>
            {formatStrategyVersionTag(strategy.current_parameter_version_id) ? (
              <span aria-hidden="true" className="status-chip status-chip--soft strategy-detail-hero__version">
                {formatStrategyVersionTag(strategy.current_parameter_version_id)}
              </span>
            ) : null}
          </div>
          <p className="strategy-detail-hero__summary">{strategySummary}</p>
        </div>
        <div className="strategy-detail-hero__actions">
          <button
            className="primary-button"
            disabled={!canEditStrategy || openingRevision}
            onClick={() => void handleEditStrategy()}
            type="button"
          >
            {TEXT.editStrategy}
          </button>
          <button className="ghost-button" onClick={() => navigateTo(`/strategies/${strategy.id}/backtest-runs/new`)} type="button">
            {TEXT.runBacktest}
          </button>
          <button
            className="ghost-button"
            disabled={!canOpenOptimization}
            onClick={handleOpenOptimization}
            type="button"
          >
            {TEXT.openOptimization}
          </button>
        </div>
      </section>

      {actionError ? <div className="error-banner">{actionError}</div> : null}

      <div className="strategy-detail-main-grid">
        <div className="strategy-detail-content-stack">
          <section className="panel strategy-detail-parameters-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">{TEXT.parameterTitle}</p>
                <h3>{TEXT.parameterTitle}</h3>
                <p className="creation-panel-copy">{TEXT.parameterCopy}</p>
              </div>
            </div>
            {tradingLogic || parameterCards.length ? (
              <div className="strategy-detail-parameter-grid">
                {tradingLogic ? (
                  <article className="strategy-detail-parameter-card strategy-detail-parameter-card--logic">
                    <span>{parameterLabel('trading_logic')}</span>
                    <strong>{tradingLogic}</strong>
                  </article>
                ) : null}
                {parameterCards.map((parameter) => (
                  <article className="strategy-detail-parameter-card" key={parameter.key}>
                    <span>{parameter.label}</span>
                    <strong>{parameter.value}</strong>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-state">{TEXT.emptyParameters}</p>
            )}
          </section>

          <section className="panel strategy-detail-history-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">{TEXT.historyTitle}</p>
                <h3>{TEXT.historyTitle}</h3>
                <p className="creation-panel-copy">{TEXT.historyCopy}</p>
              </div>
            </div>
            {parameterHistoryRows.length ? (
              <div className="table-shell strategy-detail-history-table-shell">
                <table className="strategy-detail-history-table">
                  <thead>
                    <tr>
                      <th>版本</th>
                      <th>变更摘要</th>
                      <th>决策说明</th>
                      <th>操作（查看参数、回滚）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parameterHistoryRows.map((entry) => {
                      const canRestore = canRestoreHistoryEntry(entry, strategy);
                      return (
                        <tr key={entry.parameter_version_id}>
                          <td className="strategy-detail-history-table__version">
                            <div className="strategy-detail-history-table__version-stack">
                              <strong>{historyVersionLabel(entry)}</strong>
                              <span>{entry.created_at ? formatDateTime(entry.created_at) : '-'}</span>
                            </div>
                          </td>
                          <td className="strategy-detail-history-table__summary">{renderMultilineText(historyChangeSummary(entry, factorDisplayNames))}</td>
                          <td className="strategy-detail-history-table__decision">{historyDecisionNoteSummary(entry)}</td>
                          <td>
                            <div className="strategy-detail-history-table__actions">
                              <button className="text-button" onClick={() => setSelectedHistoryId(entry.parameter_version_id)} type="button">
                                {TEXT.historyOpenDetail}
                              </button>
                              {canRestore ? (
                                <button
                                  className="text-button strategy-detail-history-table__restore-button"
                                  onClick={() => handleOpenRestore(entry)}
                                  type="button"
                                >
                                  {TEXT.historyRestore}
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-state">{TEXT.emptyHistory}</p>
            )}
          </section>
        </div>

        <aside className="strategy-detail-sidebar">
          <section className="panel strategy-detail-side-panel strategy-detail-side-panel--recent-run">
            <div className="panel-header">
              <div>
                <p className="eyebrow">{TEXT.recentRunTitle}</p>
                <h3>{TEXT.recentRunTitle}</h3>
                <p className="creation-panel-copy">{TEXT.recentRunCopy}</p>
              </div>
            </div>
            {recentRunsLoading ? (
              <ol className="workspace-recent-runs__timeline strategy-detail-run-timeline" aria-label={TEXT.recentRunTitle}>
                {Array.from({ length: 3 }, (_, index) => (
                  <li className="workspace-recent-runs__item workspace-recent-runs__item--skeleton" key={index}>
                    <div className="workspace-recent-runs__card workspace-recent-runs__card--skeleton" />
                  </li>
                ))}
              </ol>
            ) : recentRuns.length ? (
              <ol className="workspace-recent-runs__timeline strategy-detail-run-timeline" aria-label={TEXT.recentRunTitle}>
                {recentRuns.map((run) => {
                  const tone = runStatusTone(run.status);
                  const versionTag = runVersionTag(run.parameter_version_id);
                  return (
                    <li className={`workspace-recent-runs__item workspace-recent-runs__item--${tone}`} key={run.id}>
                      <span className={`workspace-recent-runs__rail-dot workspace-recent-runs__rail-dot--${tone}`} aria-hidden="true" />
                      <button
                        className="workspace-recent-runs__card gsl-card strategy-detail-run-card"
                        onClick={() => navigateTo(`/runs/${run.id}`)}
                        type="button"
                      >
                        <div className="workspace-recent-runs__row-top">
                          <div className="workspace-recent-runs__identity">
                            <span className="workspace-recent-runs__run-id">{run.id}</span>
                          </div>
                          <span className={`workspace-recent-runs__status workspace-recent-runs__status--${tone}`}>
                            {strategyStatusLabel(run.status)}
                          </span>
                        </div>
                        <div className="workspace-recent-runs__strategy-row">
                          <h4 className="workspace-recent-runs__strategy">{getStrategyDisplayName(strategy.name, strategy.id)}</h4>
                          {versionTag ? <span className="workspace-recent-runs__version">{versionTag}</span> : null}
                        </div>
                        <p className="workspace-recent-runs__period">{runRangeLabel(run)}</p>
                        <div className="workspace-recent-runs__badge-row">
                          <div className="workspace-recent-runs__badges">
                            <span
                              className={`workspace-recent-runs__badge workspace-recent-runs__badge--${
                                Number(run.metrics?.annualized_return ?? 0) >= 0 ? 'positive' : 'negative'
                              }`}
                            >
                              {TEXT.annualizedReturn} {formatRunMetric('annualized_return', run.metrics?.annualized_return)}
                            </span>
                            <span className="workspace-recent-runs__badge workspace-recent-runs__badge--neutral">
                              {TEXT.sharpe} {formatRunMetric('sharpe', run.metrics?.sharpe)}
                            </span>
                            <span className="workspace-recent-runs__badge workspace-recent-runs__badge--negative">
                              {TEXT.drawdown} {formatRunMetric('max_drawdown', run.metrics?.max_drawdown)}
                            </span>
                          </div>
                          <span className="workspace-recent-runs__completed">
                            {formatRunCardDate(run.completed_at)}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ol>
            ) : recentRunsError ? (
              <p className="empty-state">{recentRunsError}</p>
            ) : (
              <p className="empty-state">{TEXT.emptyRun}</p>
            )}
          </section>
        </aside>
      </div>

      {selectedHistoryEntry ? (
        <div
          aria-label={TEXT.historyDetailTitle}
          aria-modal="true"
          className="modal-shell"
          onClick={() => setSelectedHistoryId(null)}
          role="dialog"
        >
          <div className="modal-card strategy-detail-history-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <div>
                <p className="eyebrow">{TEXT.historyDetailTitle}</p>
                <h3>{historyVersionLabel(selectedHistoryEntry)}</h3>
                <p className="creation-panel-copy">
                  创建时间: {selectedHistoryEntry.created_at ? formatDateTime(selectedHistoryEntry.created_at) : '-'}，字段数:{' '}
                  {Object.keys(selectedHistoryEntry.parameters ?? {}).length}
                </p>
              </div>
            </div>
            <div className="strategy-detail-history-modal__meta">
              <span className="status-chip status-chip--soft">修订 {selectedHistoryEntry.revision}</span>
              <span className="status-chip status-chip--soft">{selectedHistorySource.label}</span>
              <span
                className={`strategy-detail-history-table__state strategy-detail-history-table__state--${rollbackStateTone(
                  selectedHistoryEntry,
                  strategy,
                )}`}
              >
                {rollbackStateLabel(selectedHistoryEntry, strategy)}
              </span>
            </div>
            <section className="strategy-detail-history-modal__section">
              <h4>{TEXT.historyDetailChangeSummary}</h4>
              <p>{renderMultilineText(historyChangeSummary(selectedHistoryEntry, selectedHistoryFactorDisplayNames))}</p>
            </section>
            <section className="strategy-detail-history-modal__section">
              <h4>{TEXT.historyDetailDecisionNote}</h4>
              <p>{historyDecisionNote(selectedHistoryEntry)}</p>
            </section>
            <section className="strategy-detail-history-modal__section">
              <h4>{TEXT.historyDetailSource}</h4>
              {selectedHistorySource.fields.length ? (
                <div className="strategy-detail-history-modal__source-grid">
                  {selectedHistorySource.fields.map((field) => (
                    <article className="strategy-detail-history-modal__source-card" key={`${selectedHistoryEntry.parameter_version_id}-${field.key}`}>
                      <span>{field.label}</span>
                      <strong>{field.value}</strong>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="empty-state">{TEXT.historyDetailNoSource}</p>
              )}
            </section>
            <section className="strategy-detail-history-modal__section">
              <h4>{TEXT.historyDetailAlternatives}</h4>
              {selectedAlternativeVersions.length ? (
                <div className="strategy-detail-history-modal__alternative-list">
                  {selectedAlternativeVersions.map((version) => (
                    <article className="strategy-detail-history-modal__alternative-card" key={version.key}>
                      <strong>{version.label}</strong>
                      {version.id ? <span>{version.id}</span> : null}
                      {version.summary ? <p>{version.summary}</p> : null}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="empty-state">{TEXT.historyDetailNoAlternatives}</p>
              )}
            </section>
            <section className="strategy-detail-history-modal__section strategy-detail-history-modal__section--parameters">
              <h4>{TEXT.historyDetailParameters}</h4>
              {selectedHistoryLogic || selectedHistoryCards.length ? (
                <div className="strategy-detail-parameter-grid strategy-detail-parameter-grid--history">
                  {selectedHistoryLogic ? (
                    <article className="strategy-detail-parameter-card strategy-detail-parameter-card--logic">
                      <span>{parameterLabel('trading_logic')}</span>
                      <strong>{selectedHistoryLogic}</strong>
                    </article>
                  ) : null}
                  {selectedHistoryCards.map((parameter) => (
                    <article className="strategy-detail-parameter-card" key={`${selectedHistoryEntry.parameter_version_id}-${parameter.key}`}>
                      <span>{parameter.label}</span>
                      <strong>{parameter.value}</strong>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="empty-state">{TEXT.historyDetailEmpty}</p>
              )}
            </section>
            <div className="modal-card__footer">
              <button className="ghost-button" onClick={() => setSelectedHistoryId(null)} type="button">
                {TEXT.historyDetailClose}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {restoreTargetEntry ? (
        <div
          aria-label={TEXT.restoreTitle}
          aria-modal="true"
          className="modal-shell"
          onClick={handleCloseRestore}
          role="dialog"
        >
          <form
            className="modal-card strategy-detail-restore-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => void handleConfirmRestore(event)}
          >
            <div className="panel-header">
              <div>
                <p className="eyebrow">{TEXT.restoreTitle}</p>
                <h3>{TEXT.restoreTitle}</h3>
                <p className="creation-panel-copy">{TEXT.restoreCopy}</p>
              </div>
            </div>
            <div className="strategy-detail-restore-modal__target">
              <span>目标版本</span>
              <strong>{historyVersionLabel(restoreTargetEntry)}</strong>
              <span>当前基准</span>
              <strong>{currentHistoryLabel}</strong>
            </div>
            <p className="strategy-detail-restore-modal__summary">{renderMultilineText(historyChangeSummary(restoreTargetEntry, factorDisplayNames))}</p>
            <label className="strategy-detail-restore-modal__field">
              <span>{TEXT.restoreDecisionNoteLabel}</span>
              <textarea
                disabled={restoringVersion}
                onChange={(event) => setRestoreDecisionNote(event.currentTarget.value)}
                placeholder={TEXT.restoreDecisionNotePlaceholder}
                required
                rows={5}
                value={restoreDecisionNote}
              />
            </label>
            {restoreError ? <div className="error-banner">{restoreError}</div> : null}
            <div className="modal-card__footer">
              <button className="ghost-button" disabled={restoringVersion} onClick={handleCloseRestore} type="button">
                {TEXT.restoreCancel}
              </button>
              <button className="primary-button" disabled={restoringVersion || !restoreDecisionNote.trim()} type="submit">
                {restoringVersion ? TEXT.restoreInFlight : TEXT.restoreConfirm}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

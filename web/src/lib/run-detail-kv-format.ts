import { formatParameterLabel, formatParameterValue } from './adapters';

const SYMBOL_PREVIEW_LIMIT = 10;

const RUN_DETAIL_KV_LABELS: Record<string, string> = {
  allocation_assets: '配置标的',
  benchmark_id: '基准标的',
  benchmark_symbol: '基准',
  benchmark_trade_days: '基准交易日数',
  blocking: '是否阻塞',
  blocking_code: '阻塞代码',
  blocking_target: '阻塞对象',
  corporate_actions_status: '公司行为状态',
  coverage_days: '覆盖天数',
  coverage_ratio: '覆盖率',
  data_segment_type: '数据区段',
  dataset_snapshot_id: '数据集快照',
  entry_weight_after: '入场后权重',
  effective_date: '生效起点',
  end_date: '结束日期',
  execution_policy: '执行策略',
  cost_model_enabled: '成本模拟开关',
  expense_ratio_bps: '管理费率(BPS)',
  fee_bps: '手续费(BPS)',
  hold_rank_threshold: '保留排名阈值',
  idempotency_key: '幂等键',
  investment_mode: '投资方式',
  is_permanent: '永久回测',
  latest_trade_date: '最新交易日',
  lookback_days: '回看天数',
  max_adverse_excursion_pct: '最大不利偏移(%)',
  max_favorable_excursion_pct: '最大有利偏移(%)',
  max_position_pct: '单标的上限(%)',
  message: '说明',
  mfe_mae_ratio: 'MFE/MAE 比值',
  mode: '运行模式',
  objective: '策略目标',
  oos_start_date: '测试集起点',
  parameter_version_id: '参数版本',
  price_dataset_status: '价格数据状态',
  rebalance: '再平衡',
  rebalance_enabled: '再平衡开关',
  rebalance_frequency: '调仓频率',
  rebalance_threshold_pct: '偏离阈值(%)',
  reason: '触发原因',
  request_kind: '请求类型',
  requested_end_date: '请求结束',
  requested_start_date: '请求开始',
  row_count: '数据行数',
  runtime: '运行环境',
  signal: '触发信号',
  signal_effective_date: '信号生效起点',
  signal_score: '信号分数',
  simulate_warning: '模拟告警',
  slippage_bps: '滑点(BPS)',
  slippage_cost_pct: '滑点成本(%)',
  source_run_id: '来源回测',
  start_date: '开始日期',
  status: '状态',
  first_order_date: '首笔订单',
  supporting_dataset_snapshot_id: '支撑数据快照',
  symbol_count: '标的数量',
  symbols: '标的列表',
  template_key: '策略模板',
  threshold: '阈值',
  universe_name: '股票池',
  universe_size: '股票池规模',
  universe_snapshot_id: '股票池快照',
  universe_status: '股票池状态',
  valuation_dataset_snapshot_id: '估值数据快照',
  valuation_dataset_status: '估值数据状态',
  valuation_latest_observation_date: '最新估值观察日',
  valuation_proxy_key: '估值代理',
};

const RUN_DETAIL_VALUE_LABELS: Record<string, string> = {
  ASSET_ALLOCATION: '资产配置',
  COMPLETED: '已完成',
  FAILED: '失败',
  FULL: '全量',
  INCOMPLETE: '不完整',
  NOT_REQUIRED: '无需',
  OOS: '测试集',
  READY: '已就绪',
  RUNNING: '运行中',
  STALE: '过期',
  T_CLOSE_TO_T1_OPEN: 'T日收盘信号，T+1开盘成交',
  all_in: '一次性建仓',
  asset_allocation: '资产配置',
  dca: '定投建仓',
  momentum: '动量',
  'momentum:semiannual': '动量：每半年调仓',
  monthly: '每月',
  official: '正式回测',
  quarterly: '每季度',
  local: '本地',
  preview: '预览',
  sandbox: '沙盒',
  semiannual: '每半年',
  yearly: '每年',
  production: '生产',
};

const ASSET_CLASS_LABELS: Record<string, string> = {
  Commodity: '商品',
  Equity: '权益',
  'Growth Equity': '成长权益',
  Treasury: '美国国债',
};

const RUN_DETAIL_MESSAGE_LABELS: Record<string, string> = {
  'Price snapshot is still incomplete. The run can proceed using the currently available symbols.':
    '价格快照仍未完整，但可基于当前可用标的继续运行回测。',
};

const RUN_DETAIL_COMMENTARY_LABELS: Record<string, string> = {
  'Captured profit, but the path included meaningful give-back before exit.':
    '交易最终获利，但离场前回吐幅度较明显。',
  'Heat outweighed follow-through before the position could recover.':
    '仓位承受的回撤大于后续延续力度，恢复前就已失去优势。',
  'Held the favorable move without taking deep heat.':
    '持仓期间延续了有利走势，且未经历明显回撤。',
  'Recovered audit sample.': '已恢复的交易证据样本。',
  'Risk stayed within the expected band.': '风险保持在预期区间内。',
  'Trade was chopped before a decisive extension developed.':
    '趋势尚未形成明确延伸前，仓位已被震荡洗出。',
  'Trade was marginal and execution costs consumed a visible share of the edge.':
    '这笔交易优势较薄，执行成本吞噬了可观的边际收益。',
};

function formatPrimitiveValue(value: string | number | boolean): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toLocaleString('zh-HK') : value.toFixed(2);
  }
  if (typeof value === 'boolean') {
    return value ? '是' : '否';
  }
  return value;
}

function isSymbolsKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  return normalized === 'symbols' || normalized.endsWith('_symbols');
}

function allocationWeightSymbol(key: string): string | null {
  const match = key.match(/^allocation_weight__(.+)_pct$/);
  return match?.[1]?.trim().toUpperCase() || null;
}

function formatAssetClass(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return ASSET_CLASS_LABELS[normalized] ?? normalized;
}

function formatAllocationAssets(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const rendered = value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return String(item ?? '').trim();
      }
      const record = item as Record<string, unknown>;
      const symbol = String(record.symbol ?? '').trim().toUpperCase();
      const displayName = String(record.display_name ?? record.displayName ?? record.name ?? '').trim();
      const assetClass = formatAssetClass(record.asset_class ?? record.assetClass);
      const descriptors = [displayName, assetClass].filter((part) => part.length > 0);
      return symbol ? `${symbol}${descriptors.length ? `（${descriptors.join('，')}）` : ''}` : descriptors.join('，');
    })
    .filter((item) => item.length > 0);
  return rendered.length ? rendered.join(', ') : '—';
}

function formatStringValue(key: string, value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return '—';
  }

  if (RUN_DETAIL_MESSAGE_LABELS[normalized]) {
    return RUN_DETAIL_MESSAGE_LABELS[normalized];
  }

  if (RUN_DETAIL_VALUE_LABELS[normalized]) {
    return RUN_DETAIL_VALUE_LABELS[normalized];
  }

  if (key in RUN_DETAIL_KV_LABELS || key.includes('_')) {
    return formatParameterValue(normalized, key);
  }

  return normalized;
}

export function formatRunDetailKvLabel(key: string): string {
  const allocationSymbol = allocationWeightSymbol(key);
  if (allocationSymbol) {
    return `${allocationSymbol} 目标权重(%)`;
  }
  return RUN_DETAIL_KV_LABELS[key] ?? formatParameterLabel(key);
}

export function formatRunDetailCommentary(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '—';
  }
  return RUN_DETAIL_COMMENTARY_LABELS[normalized] ?? normalized;
}

function formatSymbolsPreview(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const symbols = value
    .map((item) => (typeof item === 'string' ? item.trim() : String(item ?? '').trim()))
    .filter((item) => item.length > 0);

  if (!symbols.length) {
    return '—';
  }

  const preview = symbols.slice(0, SYMBOL_PREVIEW_LIMIT).join(', ');
  return symbols.length > SYMBOL_PREVIEW_LIMIT ? `${preview} ...` : preview;
}

export function formatRunDetailKvValue(key: string, value: unknown): string {
  if (value === null || typeof value === 'undefined') {
    return '—';
  }

  if (isSymbolsKey(key)) {
    const symbolsPreview = formatSymbolsPreview(value);
    if (symbolsPreview) {
      return symbolsPreview;
    }
  }

  if (key === 'allocation_assets') {
    const allocationAssets = formatAllocationAssets(value);
    if (allocationAssets) {
      return allocationAssets;
    }
  }

  if (Array.isArray(value)) {
    const isPrimitiveArray = value.every(
      (item) => item === null || ['string', 'number', 'boolean'].includes(typeof item),
    );
    if (!isPrimitiveArray) {
      return JSON.stringify(value);
    }
    const rendered = value
      .filter((item): item is string | number | boolean => item !== null)
      .map((item) => formatPrimitiveValue(item));
    return rendered.length ? rendered.join(', ') : '—';
  }

  if (typeof value === 'number') {
    return formatPrimitiveValue(value);
  }

  if (typeof value === 'boolean') {
    return formatPrimitiveValue(value);
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return formatStringValue(key, String(value));
}

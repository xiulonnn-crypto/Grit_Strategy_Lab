import { formatPercent } from './format';

const UTF8_DECODER = new TextDecoder('utf-8');

const KPI_LABELS: Record<string, string> = {
  composition_score: '成立性评分',
  annualized_return: '年化收益',
  max_drawdown: '最大回撤',
  volatility: '波动率',
  beta_exposure: 'β暴露',
  leg_count: '腿数',
  locked_weight: '锁定权重',
  residual_weight: '残余权重',
  estimated_cost: '维护成本',
  cash_buffer: '现金缓冲',
  sharpe: '夏普比率',
  sortino: '索提诺比率',
  tracking_spread: '超额收益',
};

const FACTOR_LABELS: Record<string, string> = {
  weight_discipline: '权重纪律',
  diversification: '分散度',
  evidence: '来源可信度',
  cost: '成本控制',
};

const STRATEGY_TYPE_LABELS: Record<string, string> = {
  GRID: '网格',
  MEAN_REVERSION: '均值回归',
  MOMENTUM: '动量',
  BUY_AND_HOLD: '长持',
  ASSET_ALLOCATION: '资产配置',
  GENERAL: '研究',
};

function hasLatin1Garble(text: string): boolean {
  return /[\u0080-\u00ff]/.test(text);
}

export function repairMojibakeText(value?: string | null): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!hasLatin1Garble(value)) {
    return value;
  }
  try {
    const bytes = Uint8Array.from(Array.from(value), (char) => char.charCodeAt(0) & 0xff);
    const decoded = UTF8_DECODER.decode(bytes).replace(/\u0000/g, '');
    return /[\u3400-\u9fff]/.test(decoded) ? decoded : value;
  } catch {
    return value;
  }
}

export function cleanDisplayText(value?: string | null): string | null {
  const repaired = repairMojibakeText(value);
  if (repaired === null || repaired === undefined) {
    return null;
  }
  const normalized = repaired
    .replace(/Â·/g, '·')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || null;
}

export function isPlaceholderText(value?: string | null): boolean {
  const text = cleanDisplayText(value);
  if (!text) {
    return true;
  }
  if (/^[?？\uFFFD.\-_/:\s]+$/.test(text)) {
    return true;
  }
  return /[?？]{2,}/.test(text);
}

export function normalizePercentLike(value?: number | null): number {
  const normalized = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.abs(normalized) > 1 ? normalized / 100 : normalized;
}

export function formatComposePercent(
  value?: number | null,
  options?: { forceNegative?: boolean },
): string {
  const normalized = normalizePercentLike(value);
  const signed = options?.forceNegative ? -Math.abs(normalized) : normalized;
  return formatPercent(signed);
}

export function formatRebalanceCadence(value?: string | null): string {
  switch (String(value ?? '').toLowerCase()) {
    case 'monthly':
      return '月度再平衡';
    case 'quarterly':
      return '季度再平衡';
    case 'semiannual':
      return '半年再平衡';
    case 'annual':
      return '年度再平衡';
    case 'never':
      return '不自动再平衡';
    default:
      return '维护节奏待确认';
  }
}

export function formatBenchmarkLabel(value?: string | null): string {
  const text = cleanDisplayText(value);
  if (!text || isPlaceholderText(text)) {
    return '60/40 参考组合';
  }
  if (/^nasdaq\s*100$/i.test(text) || /^ndx\s*100$/i.test(text)) {
    return 'Nasdaq 100';
  }
  if (/^s&p\s*500$/i.test(text)) {
    return 'S&P 500';
  }
  if (/70\s*\/\s*30/i.test(text)) {
    return '基准组合(70/30)';
  }
  if (/60\/40/.test(text)) {
    return '60/40 参考组合';
  }
  if (/cash\s*\/\s*bond\s*smoke/i.test(text)) {
    return '现金 / 债券烟测基准';
  }
  return text;
}

function formatRuntimeSmokeLabel(value?: string | null): string | null {
  const text = cleanDisplayText(value);
  if (!text || isPlaceholderText(text) || !/live smoke/i.test(text)) {
    return null;
  }
  if (/^phase\s*1\.1\s+live\s+smoke\s+composition$/i.test(text)) {
    return 'Phase 1.1 线上烟测组合';
  }
  if (/^phase\s*1\.1\s+live\s+smoke\s+bond\s+snapshot\s+asset$/i.test(text)) {
    return 'Phase 1.1 线上烟测债券快照资产腿';
  }
  if (/^phase\s*1\.1\s+live\s+smoke\s+bond\s+leg$/i.test(text)) {
    return 'Phase 1.1 线上烟测债券腿';
  }
  if (/^phase\s*1\.1\s+live\s+smoke\s+cash\s+leg$/i.test(text)) {
    return 'Phase 1.1 线上烟测现金腿';
  }
  return text.replace(/live\s+smoke/gi, '线上烟测');
}

export function formatCompositionStatusLabel(
  status?: string | null,
  fallback?: string | null,
): string {
  switch (String(status ?? fallback ?? '').toUpperCase()) {
    case 'ACTIVE':
      return '运行稳定';
    case 'DRAFT':
      return '待保存';
    case 'ARCHIVED':
      return '已归档';
    case 'READY':
      return '稳定';
    case 'STALE':
      return '有新版本';
    case 'NEEDS_RUN':
      return '待验证';
    case 'WARNING':
    case 'WATCH':
      return '观察';
    default: {
      const text = cleanDisplayText(fallback);
      if (text && !isPlaceholderText(text) && !/^(active|ready|draft|archived)$/i.test(text)) {
        return text;
      }
      return '观察';
    }
  }
}

export function formatCompositionName(input: {
  name?: string | null;
  benchmarkLabel?: string | null;
  status?: string | null;
}): string {
  const runtimeLabel = formatRuntimeSmokeLabel(input.name);
  if (runtimeLabel) {
    return runtimeLabel;
  }
  const text = cleanDisplayText(input.name);
  if (text && !isPlaceholderText(text)) {
    return text;
  }
  const benchmark = formatBenchmarkLabel(input.benchmarkLabel);
  if (/s&p\s*500/i.test(benchmark) || /标普/i.test(benchmark)) {
    return '平衡收益组合';
  }
  if (/nasdaq/i.test(benchmark) || /纳指/i.test(benchmark)) {
    return '质量收益组合';
  }
  if (/60\/40/.test(benchmark)) {
    return '宏观稳健组合';
  }
  if (String(input.status ?? '').toUpperCase() === 'DRAFT') {
    return '待保存组合';
  }
  return '组合复核视图';
}

export function formatCompositionActivityLabel(value?: string | null): string {
  const text = cleanDisplayText(value);
  if (!text || isPlaceholderText(text)) {
    return '组合更新 · 刚刚同步';
  }
  const updatedMatch = text.match(/^updated\s+(\d{4}-\d{2}-\d{2})$/i);
  if (updatedMatch) {
    return `更新 ${updatedMatch[1]}`;
  }
  return text;
}

export function formatCompositionDescription(value?: string | null): string | null {
  const text = cleanDisplayText(value);
  if (!text || isPlaceholderText(text)) {
    return null;
  }
  if (/compose review seeded/i.test(text)) {
    return '由策略腿、资产腿与现金腿共同构成的正式组合。';
  }
  if (/created through the real runtime api to verify compose pages/i.test(text)) {
    return '通过真实运行时接口创建，用于验证组合页面、来源冻结与维护节奏。';
  }
  return text;
}

export function formatCompositionHeroCopy(input: {
  description?: string | null;
  legCount?: number | null;
  rebalanceFrequency?: string | null;
}): string {
  const description = formatCompositionDescription(input.description);
  if (description) {
    return description;
  }
  const legCount =
    typeof input.legCount === 'number' && Number.isFinite(input.legCount) ? input.legCount : 0;
  const cadence = formatRebalanceCadence(input.rebalanceFrequency);
  return `${legCount} 条腿、${cadence}、来源已冻结。收益路径、风险归因与来源快照共同刻画组合当前的持有质量。`;
}

function formatStrategyTypeLabel(value?: string | null): string {
  return STRATEGY_TYPE_LABELS[String(value ?? '').toUpperCase()] ?? '策略';
}

type LegLike = {
  leg_kind?: string | null;
  display_name?: string | null;
  name?: string | null;
  source_ref_id?: string | null;
  config?: Record<string, unknown> | null;
};

export function formatLegDisplayName(leg: LegLike): string {
  const runtimeLabel = formatRuntimeSmokeLabel(leg.display_name ?? leg.name);
  if (runtimeLabel) {
    return runtimeLabel;
  }
  const displayName = cleanDisplayText(leg.display_name ?? leg.name);
  if (displayName && !isPlaceholderText(displayName)) {
    return displayName;
  }
  const config = leg.config ?? {};
  if (leg.leg_kind === 'strategy') {
    const universeName = cleanDisplayText(
      typeof config.universe_name === 'string' ? config.universe_name : null,
    );
    const strategyType = formatStrategyTypeLabel(
      typeof config.strategy_type === 'string' ? config.strategy_type : null,
    );
    if (universeName) {
      return `${universeName}${strategyType}策略`;
    }
    return `${strategyType}策略腿`;
  }
  if (leg.leg_kind === 'asset') {
    const symbol = cleanDisplayText(typeof config.symbol === 'string' ? config.symbol : null);
    const assetKind = String(config.asset_kind ?? '').toUpperCase();
    if (assetKind === 'BOND') {
      if (symbol === 'IEF') {
        return '10Y 国债稳定腿';
      }
      return symbol ? `${symbol} 债券腿` : '债券资产腿';
    }
    return symbol ? `${symbol} 资产腿` : '资产腿';
  }
  if (leg.leg_kind === 'cash') {
    const ruleKind = String(config.cash_rule_kind ?? '').toUpperCase();
    if (ruleKind === 'TARGET_BUFFER') {
      return '现金缓冲规则';
    }
    return '现金维护规则';
  }
  return cleanDisplayText(leg.source_ref_id) ?? '来源腿';
}

export function formatLegReferenceSummary(
  value?: string | null,
  referenceCount?: number | null,
): string {
  const count =
    typeof referenceCount === 'number' && Number.isFinite(referenceCount) ? referenceCount : null;
  if (count !== null) {
    if (count <= 0) {
      return '尚未进入已保存组合';
    }
    if (count === 1) {
      return '已被 1 个已保存组合引用';
    }
    return `已被 ${count} 个已保存组合引用`;
  }

  const text = cleanDisplayText(value);
  if (!text || isPlaceholderText(text)) {
    return '尚未进入已保存组合';
  }
  const notUsedMatch = text.match(/^not used in saved compositions yet$/i);
  if (notUsedMatch) {
    return '尚未进入已保存组合';
  }
  const usedMatch = text.match(/^used in (\d+) saved composition/i);
  if (usedMatch) {
    return Number(usedMatch[1]) === 1
      ? '已被 1 个已保存组合引用'
      : `已被 ${usedMatch[1]} 个已保存组合引用`;
  }
  return text;
}

export function formatLegProofLabel(value?: string | null, leg?: LegLike): string {
  const text = cleanDisplayText(value);
  if (text && !isPlaceholderText(text)) {
    const latestRunMatch = text.match(/^latest eligible run\s+(.+)$/i);
    if (latestRunMatch) {
      return `最新合格回测 ${latestRunMatch[1]}`;
    }
    if (/^no eligible completed run yet$/i.test(text)) {
      return leg?.leg_kind === 'strategy' ? '暂无合格回测证明' : '尚无可用证明';
    }
    if (/^updated\s+\d{4}-\d{2}-\d{2}$/i.test(text)) {
      return formatCompositionActivityLabel(text);
    }
    if (/^phase1[_\s-]+live[_\s-]+smoke[_\s-]+cash$/i.test(text)) {
      return 'Phase 1 线上烟测现金';
    }
    if (/^phase1[_\s-]+live[_\s-]+smoke$/i.test(text)) {
      return 'Phase 1 线上烟测';
    }
    if (/^ds-price$/i.test(text)) {
      return '价格数据源';
    }
    if (leg?.leg_kind === 'asset' && /^ds-/.test(text)) {
      return `来源快照 ${text}`;
    }
    if (leg?.leg_kind === 'cash' && /^compose_review_cash_proxy$/i.test(text)) {
      return '现金收益代理';
    }
    return text;
  }

  if (leg?.leg_kind === 'asset') {
    const snapshotId =
      leg.config && typeof leg.config.source_snapshot_id === 'string'
        ? leg.config.source_snapshot_id
        : null;
    return snapshotId ? `来源快照 ${snapshotId}` : '待补来源快照';
  }
  if (leg?.leg_kind === 'cash') {
    return '现金规则待确认';
  }
  return '待补回测证明';
}

export function formatTagLabel(tag: string): string {
  const normalizedTag = (cleanDisplayText(tag) ?? tag)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  tag = normalizedTag || tag;

  if (tag === 'newer_version_available') {
    return '有新版本';
  }
  if (tag === 'needs_run') {
    return '待验证';
  }
  if (tag === 'strategy') {
    return '策略腿';
  }
  if (tag === 'asset') {
    return '资产腿';
  }
  if (tag === 'cash') {
    return '现金腿';
  }
  if (tag === 'mean_reversion') {
    return '均值回归';
  }
  if (tag === 'momentum') {
    return '动量';
  }
  if (tag === 'buy_and_hold') {
    return '买入持有';
  }
  if (tag === 'grid') {
    return '网格';
  }
  if (tag === 'low_correlation') {
    return '低相关';
  }
  if (tag === 'equity_index') {
    return '股票指数';
  }
  if (tag === 'bond_government') {
    return '国债';
  }
  if (tag === 'duration_carry') {
    return '久期票息';
  }
  if (tag === 'defensive') {
    return '防御';
  }
  if (tag === 'target_buffer') {
    return '目标缓冲';
  }
  if (tag === 'bond') {
    return '债券';
  }
  if (tag === 'notes') {
    return '维护说明';
  }
  if (tag.startsWith('version:')) {
    return tag.replace('version:', '');
  }
  if (tag.startsWith('rebalance:')) {
    return `再平衡 ${tag.replace('rebalance:', '') === 'never' ? '关闭' : tag.replace('rebalance:', '')}`;
  }
  if (tag.startsWith('freeze:')) {
    const freezeMode = tag.replace('freeze:', '');
    if (freezeMode === 'snapshot_locked') {
      return '快照冻结';
    }
    if (freezeMode === 'manual') {
      return '手动冻结';
    }
    return `冻结 ${freezeMode}`;
  }
  if (tag.startsWith('snapshot:')) {
    return `快照 ${tag.replace('snapshot:', '')}`;
  }
  if (tag.startsWith('yield:')) {
    return '现金收益代理';
  }
  if (tag.startsWith('provider:')) {
    const provider = tag.replace('provider:', '');
    return provider === 'compose_review_seed' ? '设计稿样本' : `来源 ${provider}`;
  }
  return (cleanDisplayText(tag) ?? tag).replace(/_/g, ' ');
}

export function formatCompositionKpiLabel(key: string, fallbackLabel: string): string {
  return KPI_LABELS[key] ?? cleanDisplayText(fallbackLabel) ?? key;
}

export function formatCompositionVerdict(value?: string | null): string {
  const text = cleanDisplayText(value);
  switch (String(text ?? '').toLowerCase()) {
    case 'strong':
      return '可保存正式组合';
    case 'stable':
      return '结构稳定';
    case 'watch':
      return '继续复核';
    default:
      return text ?? '等待预演结果';
  }
}

export function formatCompositionFactorLabel(key: string, fallbackLabel: string): string {
  return FACTOR_LABELS[key] ?? cleanDisplayText(fallbackLabel) ?? key;
}

export function formatCompositionFactorDetail(key: string, fallbackDetail?: string | null): string {
  const detail = cleanDisplayText(fallbackDetail);
  if (detail && /[一-龥]/.test(detail)) {
    return detail;
  }
  switch (key) {
    case 'weight_discipline':
      return '总权重闭合越稳定，正式保存后的维护风险越低。';
    case 'diversification':
      return '策略腿、资产腿与现金腿分工越清晰，组合集中度越可控。';
    case 'evidence':
      return '来源冻结、快照证据与回测证明越完整，持有可信度越高。';
    case 'cost':
      return '维护成本越可控，组合越适合进入正式持有。';
    default:
      return detail ?? '等待预演结果返回更多解释。';
  }
}

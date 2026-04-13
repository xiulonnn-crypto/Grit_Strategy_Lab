import { formatCompactDate } from './format';
import type { ApiBacktestRunDetail, ApiBacktestTradeAuditItem } from '../types';

export type ViewWindow = 'all' | '1y' | '3y';
export type TradeSegment = 'all' | 'IS' | 'OOS';
export type RunDetailTab = 'diagnostics' | 'trades' | 'evidence' | 'properties';
export type TradeAuditSort = 'time_asc' | 'time_desc' | 'pnl_asc' | 'pnl_desc';

export type RunDetailPropertyEntry = {
  key: string;
  label: string;
  value: string;
};

export type RunDetailPropertySection = {
  key: string;
  title: string;
  description: string;
  entries: RunDetailPropertyEntry[];
};

export const TRADE_PAGE_SIZE = 12;

export const RUN_DETAIL_TAB_OPTIONS: Array<{ value: RunDetailTab; label: string }> = [
  { value: 'diagnostics', label: '诊断' },
  { value: 'trades', label: '交易' },
  { value: 'evidence', label: '证据' },
  { value: 'properties', label: '配置' },
];

export const TRADE_SEGMENT_OPTIONS: Array<{ value: TradeSegment; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'IS', label: '训练集' },
  { value: 'OOS', label: '测试集' },
];

export const DEFAULT_EVIDENCE_SORT: TradeAuditSort = 'pnl_desc';

export const EVIDENCE_SORT_OPTIONS: Array<{ value: TradeAuditSort; label: string }> = [
  { value: 'time_asc', label: '时间正序' },
  { value: 'time_desc', label: '时间倒序' },
  { value: 'pnl_asc', label: '收益正序' },
  { value: 'pnl_desc', label: '收益倒序' },
];

function readRecordString(record: Record<string, unknown> | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.length ? value : null;
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '—';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function buildEntries(record: Record<string, unknown> | undefined): RunDetailPropertyEntry[] {
  return Object.entries(record ?? {}).map(([key, value]) => ({
    key,
    label: key,
    value: stringifyValue(value),
  }));
}

export function formatRunStatusLabel(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.includes('complete') || normalized.includes('done') || normalized.includes('success')) {
    return '已完成';
  }
  if (normalized.includes('running') || normalized.includes('pending') || normalized.includes('queued')) {
    return '运行中';
  }
  if (normalized.includes('fail') || normalized.includes('error')) {
    return '失败';
  }
  return value;
}

export function getStrategyTitle(detail: ApiBacktestRunDetail): string {
  return (
    detail.strategy_name ??
    readRecordString(detail.parameter_snapshot as Record<string, unknown> | undefined, 'strategy_name') ??
    readRecordString(detail.parameter_snapshot as Record<string, unknown> | undefined, 'objective') ??
    detail.id
  );
}

export function getRunWindow(detail: ApiBacktestRunDetail): { startDate: string | null; endDate: string | null } {
  const series = detail.chart_series ?? [];
  const firstTradeDate = series[0]?.trade_date ?? null;
  const lastTradeDate = series[series.length - 1]?.trade_date ?? null;
  return {
    startDate: detail.preview?.effective_start_date ?? firstTradeDate ?? detail.effective_date ?? null,
    endDate: detail.preview?.effective_end_date ?? lastTradeDate ?? detail.completed_at?.slice(0, 10) ?? null,
  };
}

export function formatRunRange(detail: ApiBacktestRunDetail): string {
  const series = detail.chart_series ?? [];
  if (!series.length) {
    return '暂无区间';
  }
  const start = series[0]?.trade_date;
  const end = series[series.length - 1]?.trade_date;
  if (!start || !end) {
    return '暂无区间';
  }
  return `${formatCompactDate(start)} - ${formatCompactDate(end)}`;
}

export function buildCopyPayload(detail: ApiBacktestRunDetail): Record<string, unknown> {
  const runWindow = getRunWindow(detail);
  return {
    run_id: detail.id,
    strategy_id: detail.strategy_id ?? null,
    start_date: runWindow.startDate,
    end_date: runWindow.endDate,
    data_segment_type: detail.data_segment_type ?? detail.preview?.data_segment_type ?? null,
    parameter_version_id: detail.parameter_version_id ?? detail.preview?.parameter_version_id ?? null,
    oos_start_date: detail.oos_start_date ?? null,
    snapshot_summary: detail.snapshot_summary ?? detail.preview?.snapshot_summary ?? null,
    parameter_snapshot: detail.parameter_snapshot ?? detail.preview?.parameter_snapshot ?? null,
  };
}

function getAuditSortTimestamp(item: ApiBacktestTradeAuditItem): number {
  const normalized =
    Date.parse(item.closed_at ?? '') ||
    Date.parse(item.opened_at ?? '') ||
    Date.parse(item.closed_at?.slice(0, 10) ?? '') ||
    Date.parse(item.opened_at?.slice(0, 10) ?? '');
  return Number.isFinite(normalized) ? normalized : 0;
}

function getAuditSortPnl(item: ApiBacktestTradeAuditItem): number {
  return typeof item.pnl_pct === 'number' && Number.isFinite(item.pnl_pct) ? item.pnl_pct : 0;
}

function compareTradeAuditItems(
  left: ApiBacktestTradeAuditItem,
  right: ApiBacktestTradeAuditItem,
  sort: TradeAuditSort,
): number {
  const pnlDelta = getAuditSortPnl(left) - getAuditSortPnl(right);
  const timeDelta = getAuditSortTimestamp(left) - getAuditSortTimestamp(right);

  if (sort === 'time_asc') {
    return timeDelta || pnlDelta || left.symbol.localeCompare(right.symbol) || left.trade_id.localeCompare(right.trade_id);
  }
  if (sort === 'time_desc') {
    return -timeDelta || -pnlDelta || left.symbol.localeCompare(right.symbol) || left.trade_id.localeCompare(right.trade_id);
  }
  if (sort === 'pnl_asc') {
    return pnlDelta || timeDelta || left.symbol.localeCompare(right.symbol) || left.trade_id.localeCompare(right.trade_id);
  }
  return -pnlDelta || -timeDelta || left.symbol.localeCompare(right.symbol) || left.trade_id.localeCompare(right.trade_id);
}

export function sortTradeAuditItems(
  items: ApiBacktestTradeAuditItem[] | undefined,
  sort: TradeAuditSort = DEFAULT_EVIDENCE_SORT,
): ApiBacktestTradeAuditItem[] {
  return [...(items ?? [])].sort((left, right) => compareTradeAuditItems(left, right, sort));
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> | undefined {
  const entries = Object.entries(record).filter(([, value]) => value !== null && typeof value !== 'undefined');
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function getRunDetailParameterSnapshot(detail: ApiBacktestRunDetail): Record<string, unknown> | undefined {
  const parameterSnapshot = (detail.parameter_snapshot ?? detail.preview?.parameter_snapshot ?? undefined) as
    | Record<string, unknown>
    | undefined;
  const configuration =
    detail.configuration && typeof detail.configuration === 'object'
      ? (detail.configuration as Record<string, unknown>)
      : undefined;
  const derivedContext = compactRecord({
    data_segment_type: detail.data_segment_type ?? detail.preview?.data_segment_type,
    oos_start_date: detail.oos_start_date ?? undefined,
    parameter_version_id: detail.parameter_version_id ?? detail.preview?.parameter_version_id,
  });
  const merged = {
    ...(derivedContext ?? {}),
    ...(configuration ?? {}),
    ...(parameterSnapshot ?? {}),
  };
  return Object.keys(merged).length ? merged : undefined;
}

export function getDefaultTradeId(
  detail: ApiBacktestRunDetail,
  sort: TradeAuditSort = DEFAULT_EVIDENCE_SORT,
): string | null {
  return sortTradeAuditItems(detail.trade_audit_items, sort)[0]?.trade_id ?? null;
}

export function buildRunDetailPropertySections(detail: ApiBacktestRunDetail): RunDetailPropertySection[] {
  return [
    {
      key: 'request',
      title: '回测请求',
      description: '保留本次运行的提交参数，方便和配置版本对照。',
      entries: buildEntries(detail.request),
    },
    {
      key: 'parameter_snapshot',
      title: '参数快照',
      description: '当前回测锁定的参数值快照。',
      entries: buildEntries(getRunDetailParameterSnapshot(detail)),
    },
    {
      key: 'snapshot_summary',
      title: '数据快照摘要',
      description: '记录数据源与快照依赖，便于追溯样本口径。',
      entries: buildEntries(detail.snapshot_summary),
    },
    {
      key: 'environment_summary',
      title: '环境摘要',
      description: '保留执行环境与运行上下文。',
      entries: buildEntries(detail.environment_summary),
    },
  ];
}

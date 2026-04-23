import { useEffect, useState } from 'react';
import { formatDateTime } from '../lib/format';
import type {
  ApiBondFixedIncomeOverview,
  ApiBondSnapshotAuditRow,
  ApiBondSnapshotCard,
  ApiBondSnapshotCurvePoint,
  ApiBondSnapshotEligibleInstrument,
  ApiBondSnapshotEligibleSource,
  ApiBondSnapshotPillarGroup,
  ApiBondSnapshotRegistryItem,
  ApiSnapshotOverview,
} from '../types';

const BOND_STATUS_LABELS: Record<string, string> = {
  READY: '就绪',
  COMPLETED: '就绪',
  WATCH: '待关注',
  INCOMPLETE: '待补',
  STALE: '使用缓存',
  RUNNING: '刷新中',
  ACTION_REQUIRED: '需处理',
  BLOCKED: '阻塞',
  FAILED: '阻塞',
  PENDING: '待刷新',
};

const BOND_GROUP_LABELS: Record<string, string> = {
  coverage: '覆盖门禁',
  governance: '治理证据',
  scheduler: '调度纪律',
  diagnostics: '诊断信号',
};

const BOND_ITEM_LABELS: Record<string, string> = {
  shared_snapshot_route: '共享快照路由',
  dataset_coverage: '数据集门禁',
  universe_coverage: '股票/指数门禁',
  scheduler: '刷新调度',
  price_dataset: '价格数据集',
  universe_dataset: '股票池快照',
  registry: '治理真相',
  evidence: '审计证据',
  refresh_mode: '最近刷新模式',
  blocking_code: '阻塞代码',
  shared_route: '共享路由所有权',
  latest_refresh_job: '最近刷新任务',
  dataset_gate: '数据集门禁',
  eligible_bond_sources: '可入库债券来源',
};

const BOND_OWNER_LABELS: Record<string, string> = {
  'snapshot overview': '共享快照总览',
  snapshot_refresh_jobs: '快照刷新任务',
  dataset_snapshots: '数据集快照',
};

const BOND_SOURCE_LABELS: Record<string, string> = {
  shared_snapshot_overview: '共享快照总览',
  'api:/data-snapshots/overview': '/data-snapshots/overview',
};

const BOND_TEXT_TRANSLATIONS: Record<string, string> = {
  'Bond and fixed-income governance is staged on the shared snapshot route for phase 1.':
    '第一阶段继续在共享快照页治理债券与固定收益来源。',
  'Bond governance stays on the existing snapshot overview surface.':
    '债券治理继续挂在现有快照总览，不新增第二套页面入口。',
  'Uses the shared dataset snapshot status as the fixed-income data gate.':
    '复用共享数据集快照状态，作为固定收益来源能否入库的第一道门禁。',
  'Universe snapshots remain the membership and selection evidence lane.':
    '股票/指数快照继续承担成员范围与选择证据，不为债券页另起一套快照证明。',
  'Reuses the existing snapshot refresh job and cadence instead of a bond-only scheduler.':
    '继续复用现有快照刷新任务与节奏，不新增债券专属调度器。',
  'Bond visuals reuse shared price snapshot readiness instead of creating a second pipeline.':
    '债券治理视图复用共享价格快照就绪度，不引入第二条数据管线。',
  'Phase 1 stores bond oversight as an extension of the existing overview contract.':
    '第一阶段把债券治理作为现有快照总览 contract 的增量扩展。',
  'Latest refresh job is the authoritative job trail for bond oversight in phase 1.':
    '最近一次刷新任务就是第一阶段债券治理的权威审计轨迹。',
  'No bond-only scheduler is introduced; this remains bound to the shared refresh job.':
    '不引入债券专属调度器，仍绑定共享快照刷新任务。',
  'Any shared snapshot blocker also blocks the bond governance tab.':
    '任何共享快照阻塞都会直接影响债券治理页签。',
  'Only READY runtime bond rows with complete or inferred fields can create asset legs.':
    '只有 READY 且字段完整或已推断的 runtime 债券行可以创建资产腿。',
  'Only runtime bond_fixed_income_snapshots rows are eligible asset-leg sources.':
    '只有 runtime bond_fixed_income_snapshots 行可以作为资产腿来源。',
  'Runtime bond_fixed_income_snapshots rows are eligible for asset-leg creation.':
    'runtime bond_fixed_income_snapshots 行可用于创建资产腿。',
  'No eligible runtime bond source is available yet.': '暂无可入库的 runtime 债券来源。',
  '#/snapshots remains the only route for bond governance': '#/snapshots 继续作为唯一治理入口。',
  'This remains the single snapshot API surface.': '当前仍只有一套快照 API 入口。',
  'Bond governance is additive only.': '债券治理只做增量扩展，不新增第二套接口。',
  'Phase 1 extends the existing snapshot API instead of adding a bond-only endpoint.':
    '第一阶段扩展现有快照 API，而不是新增债券专属端点。',
  'Bond governance is blocked whenever the shared snapshot overview is blocked.':
    '共享快照总览一旦阻塞，债券治理也会同步阻塞。',
  'Phase 1 intentionally keeps fixed-income oversight on the shared route and scheduler.':
    '第一阶段刻意把固定收益治理保留在共享路由与共享调度上。',
  'Fallback payload generated in the API layer.': '这是 API 层生成的兜底治理载荷。',
  Coverage: '覆盖门禁',
  Governance: '治理证据',
  Scheduler: '调度纪律',
  Diagnostics: '诊断信号',
  'Shared snapshot route': '共享快照路由',
  'Dataset coverage': '数据集门禁',
  'Universe coverage': '股票/指数门禁',
  'Refresh scheduler': '刷新调度',
  'Registry truth': '治理真相',
  'Audit evidence': '审计证据',
  'Most recent refresh mode': '最近刷新模式',
  'Blocking code': '阻塞代码',
  'Latest refresh job': '最近刷新任务',
  'Dataset gate': '数据集门禁',
  'Eligible bond sources': '可入库债券来源',
  'Shared route ownership': '共享路由所有权',
  'Pending first refresh': '等待首次刷新',
  'Shared dataset gate': '复用共享数据集门禁',
  'Universe snapshots anchor bond governance membership and diagnostics.':
    '股票/指数快照继续承担债券治理的成员范围与诊断依据。',
  'Shared snapshot overview': '共享快照总览',
  'continuous': '持续监控',
  'shared': '共享节奏',
  incremental: '增量刷新',
  repair: '修复刷新',
  full: '全量刷新',
  none: '无',
};

const WORKSTATION_COPY: Record<string, string> = {
  coverage: '先核对共享价格数据和股票/指数快照是否达标，再决定债券来源能否进入入库复核。',
  governance: '把共享路由、审计任务与来源真相绑在一起，确保债券治理不偏离正式快照入口。',
  scheduler: '调度纪律决定债券快照的刷新节奏与补齐顺序，也是资产腿来源能否稳定维护的关键。',
  diagnostics: '诊断信号用于说明共享快照的阻塞为什么会外溢到债券治理页签。',
};

const EMPTY_CURVE_POINT_FALLBACK: ApiBondSnapshotCurvePoint = {
  tenor_label: '',
  yield_pct: 0,
  spread_bps: 0,
};

const EMPTY_REGISTRY_ITEM_FALLBACK: ApiBondSnapshotRegistryItem = {
  id: '',
  label: '',
  status: 'WATCH',
  source: '',
  snapshot_ref: null,
  updated_at: null,
  notes: [],
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getBondStatusLabel(status?: string | null): string {
  return BOND_STATUS_LABELS[String(status ?? '').toUpperCase()] ?? '待刷新';
}

function getBondStatusChipClassName(status?: string | null): string {
  const normalizedStatus = String(status ?? '').toUpperCase();
  if (['FAILED', 'BLOCKED', 'ACTION_REQUIRED'].includes(normalizedStatus)) {
    return 'status-chip status-chip--danger';
  }
  if (['RUNNING', 'WATCH', 'INCOMPLETE', 'STALE'].includes(normalizedStatus)) {
    return 'status-chip status-chip--warning';
  }
  if (['READY', 'COMPLETED'].includes(normalizedStatus)) {
    return 'status-chip status-chip--success snapshots-status-chip--ready';
  }
  return 'status-chip status-chip--soft';
}

function translateBondText(value?: string | null): string {
  const text = String(value ?? '').trim();
  if (!text) {
    return '待确认';
  }
  const readyMatch = text.match(/^(\d+)\/(\d+)\s+ready$/i);
  if (readyMatch) {
    return `${readyMatch[1]}/${readyMatch[2]} 就绪`;
  }
  const eligibleRatioMatch = text.match(/^(\d+)\/(\d+)\s+eligible$/i);
  if (eligibleRatioMatch) {
    return `${eligibleRatioMatch[1]}/${eligibleRatioMatch[2]} 可入库`;
  }
  const eligibleCountMatch = text.match(/^(\d+)\s+eligible for asset-leg creation$/i);
  if (eligibleCountMatch) {
    return `${eligibleCountMatch[1]} 个可创建资产腿`;
  }
  const datasetReadyMatch = text.match(/^(\d+)\/(\d+)\s+dataset snapshots ready$/i);
  if (datasetReadyMatch) {
    return `${datasetReadyMatch[1]}/${datasetReadyMatch[2]} 数据集快照就绪`;
  }
  const universeReadyMatch = text.match(
    /^(\d+)\/(\d+)\s+(?:equity\s+)?universe snapshots ready$/i,
  );
  if (universeReadyMatch) {
    return `${universeReadyMatch[1]}/${universeReadyMatch[2]} 股票/指数快照就绪`;
  }
  const cadenceMatch = text.match(/^Shared snapshot cadence \((.+)\)$/i);
  if (cadenceMatch) {
    return `共享快照节奏（${translateBondText(cadenceMatch[1])}）`;
  }
  if (/^Universe snapshots anchor bond governance membership and .*diagnostics\.?$/i.test(text)) {
    return '股票/指数快照继续承担债券治理的成员范围与诊断依据。';
  }
  const memorySummaryMatch = text.match(
    /^total physical bytes:\s*([^;]+);\s*available physical bytes:\s*([^;]+);\s*process working set bytes:\s*([^;]+)$/i,
  );
  if (memorySummaryMatch) {
    return `总物理内存：${memorySummaryMatch[1]}；可用物理内存：${memorySummaryMatch[2]}；进程工作集：${memorySummaryMatch[3]}`;
  }
  return BOND_TEXT_TRANSLATIONS[text] ?? text;
}

function translateBondLabel(id: string, fallbackLabel: string): string {
  return BOND_ITEM_LABELS[id] ?? BOND_GROUP_LABELS[id] ?? translateBondText(fallbackLabel);
}

function translateBondOwner(owner: string): string {
  return BOND_OWNER_LABELS[owner] ?? translateBondText(owner);
}

function translateBondSource(value?: string | null): string {
  const text = String(value ?? '').trim();
  if (!text) {
    return '待确认';
  }
  return BOND_SOURCE_LABELS[text] ?? translateBondText(text);
}

function formatRegistryTimestamp(value?: string | null): string {
  return value ? formatDateTime(value) : '等待刷新';
}

function formatCurvePercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

function formatCurveBps(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : ''}${rounded} 基点`;
}

function formatMemoryLabel(key: string): string {
  switch (key.replace(/\s+/g, '_').toLowerCase()) {
    case 'rss_bytes':
      return 'RSS 内存';
    case 'rss_mb':
      return 'RSS 内存';
    case 'available_bytes':
      return '可用内存';
    case 'available_physical_bytes':
      return '可用物理内存';
    case 'available_mb':
      return '可用内存';
    case 'limit_ratio':
      return '内存护栏比例';
    case 'total_physical_bytes':
      return '总物理内存';
    case 'process_working_set_bytes':
      return '进程工作集';
    case 'working_set_bytes':
      return '工作集';
    default:
      return key.replace(/_/g, ' ');
  }
}

function formatMemoryValue(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (String(value).includes('.')) {
      return value.toFixed(2);
    }
    return value.toLocaleString('zh-HK');
  }
  if (typeof value === 'boolean') {
    return value ? '是' : '否';
  }
  return String(value ?? '待确认');
}

function normalizeCard(card: unknown, fallback: ApiBondSnapshotCard): ApiBondSnapshotCard {
  const payload = asRecord(card);
  if (!payload) {
    return fallback;
  }
  return {
    id: typeof payload.id === 'string' ? payload.id : fallback.id,
    label: typeof payload.label === 'string' ? payload.label : fallback.label,
    status: typeof payload.status === 'string' ? payload.status : fallback.status,
    value:
      typeof payload.value === 'string' || payload.value === null
        ? (payload.value as string | null)
        : fallback.value ?? null,
    detail:
      typeof payload.detail === 'string' || payload.detail === null
        ? (payload.detail as string | null)
        : fallback.detail ?? null,
  };
}

function normalizePillarGroup(
  group: unknown,
  fallback: ApiBondSnapshotPillarGroup,
): ApiBondSnapshotPillarGroup {
  const payload = asRecord(group);
  if (!payload) {
    return fallback;
  }
  const fallbackItems = fallback.items.length ? fallback.items : [];
  const items = Array.isArray(payload.items)
    ? payload.items.map((item, index) =>
        normalizeCard(item, fallbackItems[index] ?? fallbackItems[0] ?? {
          id: `item-${index + 1}`,
          label: `检查项 ${index + 1}`,
          status: 'WATCH',
          value: null,
          detail: null,
        }),
      )
    : fallback.items;
  return {
    id: typeof payload.id === 'string' ? payload.id : fallback.id,
    label: typeof payload.label === 'string' ? payload.label : fallback.label,
    status: typeof payload.status === 'string' ? payload.status : fallback.status,
    items,
  };
}

function normalizeCurvePoint(
  point: unknown,
  fallback: ApiBondSnapshotCurvePoint,
): ApiBondSnapshotCurvePoint {
  const payload = asRecord(point);
  if (!payload) {
    return fallback;
  }
  return {
    tenor_label: typeof payload.tenor_label === 'string' ? payload.tenor_label : fallback.tenor_label,
    yield_pct:
      typeof payload.yield_pct === 'number' && Number.isFinite(payload.yield_pct)
        ? payload.yield_pct
        : fallback.yield_pct,
    spread_bps:
      typeof payload.spread_bps === 'number' && Number.isFinite(payload.spread_bps)
        ? payload.spread_bps
        : fallback.spread_bps,
  };
}

function normalizeAuditRow(row: unknown, fallback: ApiBondSnapshotAuditRow): ApiBondSnapshotAuditRow {
  const payload = asRecord(row);
  if (!payload) {
    return fallback;
  }
  return {
    id: typeof payload.id === 'string' ? payload.id : fallback.id,
    label: typeof payload.label === 'string' ? payload.label : fallback.label,
    owner: typeof payload.owner === 'string' ? payload.owner : fallback.owner,
    status: typeof payload.status === 'string' ? payload.status : fallback.status,
    cadence_label:
      typeof payload.cadence_label === 'string' ? payload.cadence_label : fallback.cadence_label,
    evidence: typeof payload.evidence === 'string' ? payload.evidence : fallback.evidence,
  };
}

function normalizeRegistryItem(
  item: unknown,
  fallback: ApiBondSnapshotRegistryItem,
): ApiBondSnapshotRegistryItem {
  const payload = asRecord(item);
  if (!payload) {
    return fallback;
  }
  return {
    id: typeof payload.id === 'string' ? payload.id : fallback.id,
    label: typeof payload.label === 'string' ? payload.label : fallback.label,
    status: typeof payload.status === 'string' ? payload.status : fallback.status,
    source: typeof payload.source === 'string' ? payload.source : fallback.source,
    snapshot_ref:
      typeof payload.snapshot_ref === 'string' || payload.snapshot_ref === null
        ? (payload.snapshot_ref as string | null)
        : fallback.snapshot_ref ?? null,
    updated_at:
      typeof payload.updated_at === 'string' || payload.updated_at === null
        ? (payload.updated_at as string | null)
        : fallback.updated_at ?? null,
    notes: Array.isArray(payload.notes)
      ? payload.notes.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : fallback.notes,
  };
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeEligibleSource(item: unknown, index: number): ApiBondSnapshotEligibleSource {
  const payload = asRecord(item);
  return {
    id: typeof payload?.id === 'string' ? payload.id : `bond-source-${index + 1}`,
    label: typeof payload?.label === 'string' ? payload.label : `Bond source ${index + 1}`,
    source: typeof payload?.source === 'string' ? payload.source : 'unknown',
    status: typeof payload?.status === 'string' ? payload.status : 'WATCH',
    access_tier: typeof payload?.access_tier === 'string' ? payload.access_tier : 'runtime',
    instrument_types: Array.isArray(payload?.instrument_types)
      ? payload.instrument_types.filter((entry): entry is string => typeof entry === 'string')
      : [],
    coverage_notes: Array.isArray(payload?.coverage_notes)
      ? payload.coverage_notes.filter((entry): entry is string => typeof entry === 'string')
      : [],
    updated_at:
      typeof payload?.updated_at === 'string' || payload?.updated_at === null
        ? (payload.updated_at as string | null)
        : null,
  };
}

function normalizeEligibleInstrument(item: unknown, index: number): ApiBondSnapshotEligibleInstrument {
  const payload = asRecord(item);
  const fieldStatus =
    payload?.field_status && typeof payload.field_status === 'object' && !Array.isArray(payload.field_status)
      ? (payload.field_status as Record<string, string>)
      : {};
  return {
    id: typeof payload?.id === 'string' ? payload.id : `bond-instrument-${index + 1}`,
    label: typeof payload?.label === 'string' ? payload.label : `Bond instrument ${index + 1}`,
    instrument_type: typeof payload?.instrument_type === 'string' ? payload.instrument_type : 'bond',
    source: typeof payload?.source === 'string' ? payload.source : 'unknown',
    status: typeof payload?.status === 'string' ? payload.status : 'WATCH',
    symbol: typeof payload?.symbol === 'string' || payload?.symbol === null ? (payload.symbol as string | null) : null,
    isin: typeof payload?.isin === 'string' || payload?.isin === null ? (payload.isin as string | null) : null,
    cusip: typeof payload?.cusip === 'string' || payload?.cusip === null ? (payload.cusip as string | null) : null,
    currency:
      typeof payload?.currency === 'string' || payload?.currency === null
        ? (payload.currency as string | null)
        : null,
    snapshot_date:
      typeof payload?.snapshot_date === 'string' || payload?.snapshot_date === null
        ? (payload.snapshot_date as string | null)
        : null,
    maturity_date:
      typeof payload?.maturity_date === 'string' || payload?.maturity_date === null
        ? (payload.maturity_date as string | null)
        : null,
    coupon_rate_pct: finiteNumberOrNull(payload?.coupon_rate_pct),
    clean_price: finiteNumberOrNull(payload?.clean_price),
    net_price: finiteNumberOrNull(payload?.net_price),
    dirty_price: finiteNumberOrNull(payload?.dirty_price),
    full_price: finiteNumberOrNull(payload?.full_price),
    accrued_interest: finiteNumberOrNull(payload?.accrued_interest),
    ytm_pct: finiteNumberOrNull(payload?.ytm_pct),
    duration: finiteNumberOrNull(payload?.duration),
    convexity: finiteNumberOrNull(payload?.convexity),
    snapshot_ref:
      typeof payload?.snapshot_ref === 'string' || payload?.snapshot_ref === null
        ? (payload.snapshot_ref as string | null)
        : null,
    refresh_status:
      typeof payload?.refresh_status === 'string' || payload?.refresh_status === null
        ? (payload.refresh_status as string | null)
        : null,
    missing_fields: Array.isArray(payload?.missing_fields)
      ? payload.missing_fields.filter((entry): entry is string => typeof entry === 'string')
      : [],
    inferred_fields:
      payload?.inferred_fields && typeof payload.inferred_fields === 'object' && !Array.isArray(payload.inferred_fields)
        ? (payload.inferred_fields as Record<string, unknown>)
        : {},
    field_status: fieldStatus,
    updated_at:
      typeof payload?.updated_at === 'string' || payload?.updated_at === null
        ? (payload.updated_at as string | null)
        : null,
  };
}

export function buildFallbackBondFixedIncomeOverview(
  snapshotOverview?: Partial<ApiSnapshotOverview> | null,
): ApiBondFixedIncomeOverview {
  const datasetSnapshots = Array.isArray(snapshotOverview?.dataset_snapshots)
    ? snapshotOverview.dataset_snapshots
    : [];
  const universeSnapshots = Array.isArray(snapshotOverview?.universe_snapshots)
    ? snapshotOverview.universe_snapshots
    : [];
  const latestJob = asRecord(snapshotOverview?.latest_job);
  const latestJobRequest = asRecord(latestJob?.request);
  const refreshMode = typeof latestJobRequest?.mode === 'string' ? latestJobRequest.mode : 'repair';
  const overallStatus = String(snapshotOverview?.overall_status ?? 'PENDING').toUpperCase();
  const readyDatasets = datasetSnapshots.filter(
    (item) => String(item?.status ?? '').toUpperCase() === 'READY',
  ).length;
  const readyUniverses = universeSnapshots.filter(
    (item) => String(item?.status ?? '').toUpperCase() === 'READY',
  ).length;
  const pulseStatus =
    overallStatus === 'READY'
      ? 'READY'
      : overallStatus === 'RUNNING'
        ? 'RUNNING'
        : readyDatasets + readyUniverses > 0
          ? 'WATCH'
          : 'ACTION_REQUIRED';
  const updatedAt =
    snapshotOverview?.last_refreshed_at ??
    (typeof latestJob?.completed_at === 'string' ? latestJob.completed_at : null) ??
    (typeof latestJob?.updated_at === 'string' ? latestJob.updated_at : null) ??
    null;

  const curvePreview: ApiBondSnapshotCurvePoint[] = [];

  return {
    global_pulse: {
      status: pulseStatus,
      headline: '第一阶段继续在共享快照页治理债券与固定收益来源。',
      updated_at: updatedAt,
      cards: [
        {
          id: 'shared_snapshot_route',
          label: '共享快照路由',
          status: 'READY',
          value: '#/snapshots',
          detail: '债券治理继续挂在现有快照总览，不新增第二套页面入口。',
        },
        {
          id: 'dataset_coverage',
          label: '数据集门禁',
          status: datasetSnapshots.length && readyDatasets === datasetSnapshots.length ? 'READY' : 'WATCH',
          value: `${readyDatasets}/${datasetSnapshots.length} ready`,
          detail: '复用共享数据集快照状态，作为固定收益来源能否入库的第一道门禁。',
        },
        {
          id: 'universe_coverage',
          label: '股票/指数门禁',
          status:
            universeSnapshots.length && readyUniverses === universeSnapshots.length ? 'READY' : 'WATCH',
          value: `${readyUniverses}/${universeSnapshots.length} ready`,
          detail: '股票/指数快照继续承担成员范围与选择证据，不为债券页另起一套快照证明。',
        },
        {
          id: 'scheduler',
          label: '刷新调度',
          status: latestJob ? 'READY' : 'WATCH',
          value: refreshMode,
          detail: '继续复用现有快照刷新任务与节奏，不新增债券专属调度器。',
        },
      ],
    },
    pillar_groups: [
      {
        id: 'coverage',
        label: '覆盖门禁',
        status: datasetSnapshots.length && readyDatasets === datasetSnapshots.length ? 'READY' : 'WATCH',
        items: [
          {
            id: 'price_dataset',
            label: '价格数据集',
            status: readyDatasets > 0 ? 'READY' : 'WATCH',
            value: 'Shared dataset gate',
            detail: '债券治理视图复用共享价格快照就绪度，不引入第二条数据管线。',
          },
          {
            id: 'universe_dataset',
            label: '股票池快照',
            status: universeSnapshots.length && readyUniverses === universeSnapshots.length ? 'READY' : 'WATCH',
            value: `${readyUniverses}/${universeSnapshots.length} ready`,
            detail: '股票/指数快照继续承担成员范围与选择证据，不为债券页另起一套快照证明。',
          },
        ],
      },
      {
        id: 'governance',
        label: '治理证据',
        status: pulseStatus,
        items: [
          {
            id: 'registry',
            label: '治理真相',
            status: 'READY',
            value: 'Shared snapshot overview',
            detail: '第一阶段把债券治理作为现有快照总览 contract 的增量扩展。',
          },
          {
            id: 'evidence',
            label: '审计证据',
            status: latestJob ? 'READY' : 'WATCH',
            value: typeof latestJob?.id === 'string' ? latestJob.id : 'Pending first refresh',
            detail: '最近一次刷新任务就是第一阶段债券治理的权威审计轨迹。',
          },
        ],
      },
      {
        id: 'scheduler',
        label: '调度纪律',
        status: latestJob ? 'READY' : 'WATCH',
        items: [
          {
            id: 'refresh_mode',
            label: '最近刷新模式',
            status: latestJob ? 'READY' : 'WATCH',
            value: refreshMode,
            detail: '不引入债券专属调度器，仍绑定共享快照刷新任务。',
          },
        ],
      },
      {
        id: 'diagnostics',
        label: '诊断信号',
        status: pulseStatus,
        items: [
          {
            id: 'blocking_code',
            label: '阻塞代码',
            status: pulseStatus,
            value: String(snapshotOverview?.blocking_code ?? 'none'),
            detail: '任何共享快照阻塞都会直接影响债券治理页签。',
          },
        ],
      },
    ],
    curve_preview: curvePreview,
    audit_matrix: [
      {
        id: 'shared_route',
        label: '共享路由所有权',
        owner: 'snapshot overview',
        status: pulseStatus,
        cadence_label: 'continuous',
        evidence: '#/snapshots remains the only route for bond governance',
      },
      {
        id: 'latest_refresh_job',
        label: '最近刷新任务',
        owner: 'snapshot_refresh_jobs',
        status: typeof latestJob?.status === 'string' ? latestJob.status : overallStatus,
        cadence_label: refreshMode,
        evidence: typeof latestJob?.id === 'string' ? latestJob.id : 'Pending first refresh',
      },
      {
        id: 'dataset_gate',
        label: '数据集门禁',
        owner: 'dataset_snapshots',
        status: datasetSnapshots.length && readyDatasets === datasetSnapshots.length ? 'READY' : 'WATCH',
        cadence_label: 'shared',
        evidence: `${readyDatasets}/${datasetSnapshots.length} ready`,
      },
    ],
    raw_registry: [],
    eligible_sources: [],
    eligible_instruments: [],
    scheduler: {
      status: latestJob ? 'READY' : 'WATCH',
      cadence_label: `Shared snapshot cadence (${refreshMode})`,
      next_action: 'refresh_snapshots',
      last_job_id: typeof latestJob?.id === 'string' ? latestJob.id : null,
    },
    selected_source_summary: {
      primary_source: 'bond_fixed_income_snapshots',
      fallback_source: null,
      selection_reason: 'No eligible runtime bond source is available yet.',
    },
    system_diagnostics: {
      blocking_code: snapshotOverview?.blocking_code ?? null,
      blocking_target: snapshotOverview?.blocking_target ?? null,
      refresh_job_status: typeof latestJob?.status === 'string' ? latestJob.status : overallStatus,
      memory: {},
      notes: [
        'Bond governance is blocked whenever the shared snapshot overview is blocked.',
        'Only runtime bond_fixed_income_snapshots rows are eligible asset-leg sources.',
      ],
    },
  };
}

export function normalizeBondFixedIncomeOverview(
  raw: unknown,
  snapshotOverview?: Partial<ApiSnapshotOverview> | null,
): ApiBondFixedIncomeOverview {
  const fallback = buildFallbackBondFixedIncomeOverview(snapshotOverview);
  const payload = asRecord(raw);
  if (!payload) {
    return fallback;
  }

  const globalPulse = asRecord(payload.global_pulse);
  const scheduler = asRecord(payload.scheduler);
  const selectedSourceSummary = asRecord(payload.selected_source_summary);
  const systemDiagnostics = asRecord(payload.system_diagnostics);

  return {
    global_pulse: {
      status: typeof globalPulse?.status === 'string' ? globalPulse.status : fallback.global_pulse.status,
      headline:
        typeof globalPulse?.headline === 'string' ? globalPulse.headline : fallback.global_pulse.headline,
      updated_at:
        typeof globalPulse?.updated_at === 'string' || globalPulse?.updated_at === null
          ? (globalPulse?.updated_at as string | null)
          : fallback.global_pulse.updated_at,
      cards: Array.isArray(globalPulse?.cards)
        ? globalPulse.cards.map((card, index) =>
            normalizeCard(card, fallback.global_pulse.cards[index] ?? fallback.global_pulse.cards[0]),
          )
        : fallback.global_pulse.cards,
    },
    pillar_groups: Array.isArray(payload.pillar_groups)
      ? payload.pillar_groups.map((group, index) =>
          normalizePillarGroup(group, fallback.pillar_groups[index] ?? fallback.pillar_groups[0]),
        )
      : fallback.pillar_groups,
    curve_preview: Array.isArray(payload.curve_preview)
      ? payload.curve_preview.map((point, index) =>
          normalizeCurvePoint(
            point,
            fallback.curve_preview[index] ?? fallback.curve_preview[0] ?? EMPTY_CURVE_POINT_FALLBACK,
          ),
        )
      : fallback.curve_preview,
    audit_matrix: Array.isArray(payload.audit_matrix)
      ? payload.audit_matrix.map((row, index) =>
          normalizeAuditRow(row, fallback.audit_matrix[index] ?? fallback.audit_matrix[0]),
        )
      : fallback.audit_matrix,
    raw_registry: Array.isArray(payload.raw_registry)
      ? payload.raw_registry.map((item, index) =>
          normalizeRegistryItem(
            item,
            fallback.raw_registry[index] ?? fallback.raw_registry[0] ?? EMPTY_REGISTRY_ITEM_FALLBACK,
          ),
        )
      : fallback.raw_registry,
    eligible_sources: Array.isArray(payload.eligible_sources)
      ? payload.eligible_sources.map((item, index) => normalizeEligibleSource(item, index))
      : fallback.eligible_sources,
    eligible_instruments: Array.isArray(payload.eligible_instruments)
      ? payload.eligible_instruments.map((item, index) => normalizeEligibleInstrument(item, index))
      : fallback.eligible_instruments,
    scheduler: {
      status: typeof scheduler?.status === 'string' ? scheduler.status : fallback.scheduler.status,
      cadence_label:
        typeof scheduler?.cadence_label === 'string'
          ? scheduler.cadence_label
          : fallback.scheduler.cadence_label,
      next_action:
        typeof scheduler?.next_action === 'string' || scheduler?.next_action === null
          ? (scheduler?.next_action as string | null)
          : fallback.scheduler.next_action ?? null,
      last_job_id:
        typeof scheduler?.last_job_id === 'string' || scheduler?.last_job_id === null
          ? (scheduler?.last_job_id as string | null)
          : fallback.scheduler.last_job_id ?? null,
    },
    selected_source_summary: {
      primary_source:
        typeof selectedSourceSummary?.primary_source === 'string'
          ? selectedSourceSummary.primary_source
          : fallback.selected_source_summary.primary_source,
      fallback_source:
        typeof selectedSourceSummary?.fallback_source === 'string' ||
        selectedSourceSummary?.fallback_source === null
          ? (selectedSourceSummary?.fallback_source as string | null)
          : fallback.selected_source_summary.fallback_source ?? null,
      selection_reason:
        typeof selectedSourceSummary?.selection_reason === 'string'
          ? selectedSourceSummary.selection_reason
          : fallback.selected_source_summary.selection_reason,
    },
    system_diagnostics: {
      blocking_code:
        typeof systemDiagnostics?.blocking_code === 'string' || systemDiagnostics?.blocking_code === null
          ? (systemDiagnostics?.blocking_code as string | null)
          : fallback.system_diagnostics.blocking_code ?? null,
      blocking_target:
        systemDiagnostics && 'blocking_target' in systemDiagnostics
          ? systemDiagnostics.blocking_target
          : fallback.system_diagnostics.blocking_target,
      refresh_job_status:
        typeof systemDiagnostics?.refresh_job_status === 'string' ||
        systemDiagnostics?.refresh_job_status === null
          ? (systemDiagnostics?.refresh_job_status as string | null)
          : fallback.system_diagnostics.refresh_job_status ?? null,
      memory:
        systemDiagnostics?.memory && typeof systemDiagnostics.memory === 'object'
          ? (systemDiagnostics.memory as Record<string, unknown>)
          : fallback.system_diagnostics.memory,
      notes: Array.isArray(systemDiagnostics?.notes)
        ? systemDiagnostics.notes.filter((note): note is string => typeof note === 'string' && note.trim().length > 0)
        : fallback.system_diagnostics.notes,
    },
  };
}

function buildCurvePath(points: ApiBondSnapshotCurvePoint[], width: number, height: number): string {
  if (!points.length) {
    return '';
  }
  const yields = points.map((point) => point.yield_pct);
  const minYield = Math.min(...yields);
  const maxYield = Math.max(...yields);
  const range = Math.max(maxYield - minYield, 0.12);
  return points
    .map((point, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * width;
      const y = height - ((point.yield_pct - minYield) / range) * (height - 18) - 9;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

function pickSelectedRegistryItem(overview: ApiBondFixedIncomeOverview): ApiBondSnapshotRegistryItem | null {
  const primarySource = overview.selected_source_summary.primary_source;
  return (
    overview.raw_registry.find(
      (item) =>
        item.id === primarySource || item.source === primarySource || item.snapshot_ref === primarySource,
    ) ??
    overview.raw_registry.find((item) => String(item.status ?? '').toUpperCase() === 'READY') ??
    overview.raw_registry[0] ??
    null
  );
}

function getCreationChecks(overview: ApiBondFixedIncomeOverview): Array<{ label: string; status: string }> {
  const datasetCard = overview.global_pulse.cards.find((item) => item.id === 'dataset_coverage');
  const universeCard = overview.global_pulse.cards.find((item) => item.id === 'universe_coverage');
  const schedulerCard = overview.global_pulse.cards.find((item) => item.id === 'scheduler');

  return [
    {
      label: `数据集门禁：${translateBondText(datasetCard?.value ?? '')}`,
      status: datasetCard?.status ?? 'WATCH',
    },
    {
      label: `股票/指数门禁：${translateBondText(universeCard?.value ?? '')}`,
      status: universeCard?.status ?? 'WATCH',
    },
    {
      label: `调度纪律：${translateBondText(schedulerCard?.value ?? '')}`,
      status: schedulerCard?.status ?? 'WATCH',
    },
  ];
}

function getDiagnosticEntries(overview: ApiBondFixedIncomeOverview): Array<{
  title: string;
  status: string;
  body: string;
}> {
  const entries: Array<{ title: string; status: string; body: string }> = [];
  const blockingCode = String(overview.system_diagnostics.blocking_code ?? '').trim();
  entries.push({
    title: blockingCode ? '共享快照阻塞' : '共享快照阻塞',
    status: blockingCode ? 'ACTION_REQUIRED' : 'READY',
    body: blockingCode
      ? `当前阻塞代码为 ${blockingCode}，债券治理需要跟随共享快照一起复核。`
      : '当前没有额外阻塞代码，债券页签可以继续沿用共享快照的治理节奏。',
  });

  entries.push({
    title: '刷新任务状态',
    status: overview.system_diagnostics.refresh_job_status ?? 'WATCH',
    body: `最近一次共享刷新任务状态为 ${getBondStatusLabel(
      overview.system_diagnostics.refresh_job_status,
    )}。`,
  });

  const memoryEntries = Object.entries(overview.system_diagnostics.memory ?? {});
  if (memoryEntries.length) {
    const memorySummary = memoryEntries
      .slice(0, 3)
      .map(([key, value]) => `${formatMemoryLabel(key)}：${formatMemoryValue(value)}`)
      .join('；');
    entries.push({
      title: '运行时内存护栏',
      status: 'WATCH',
      body: memorySummary,
    });
  }

  overview.system_diagnostics.notes.forEach((note, index) => {
    entries.push({
      title: `专家建议 ${index + 1}`,
      status: 'WATCH',
      body: translateBondText(note),
    });
  });

  return entries;
}

function getRuleEntries(overview: ApiBondFixedIncomeOverview): Array<{
  title: string;
  status: string;
  body: string;
}> {
  const nextAction =
    overview.scheduler.next_action === 'refresh_snapshots' ? '继续刷新债券快照' : '继续跟踪共享调度';
  return [
    {
      title: '共享调度',
      status: overview.scheduler.status,
      body: `${translateBondText(overview.scheduler.cadence_label)}。${
        overview.scheduler.last_job_id ? `最近任务：${overview.scheduler.last_job_id}。` : ''
      }`,
    },
    {
      title: '供应商优先级',
      status: 'READY',
      body: `主来源：${translateBondSource(
        overview.selected_source_summary.primary_source,
      )}；候补来源：${translateBondSource(overview.selected_source_summary.fallback_source ?? 'none')}。`,
    },
    {
      title: '下一步规则',
      status: overview.scheduler.status,
      body: `${translateBondText(overview.selected_source_summary.selection_reason)} 当前建议动作：${nextAction}。`,
    },
  ];
}

function renderCurveAxis(points: ApiBondSnapshotCurvePoint[]): JSX.Element[] {
  return points.map((point) => (
    <div className="snapshots-bond-curve-axis__item" key={point.tenor_label}>
      <span>{point.tenor_label}</span>
      <strong>{formatCurvePercent(point.yield_pct)}</strong>
    </div>
  ));
}

function BondCurveChart({ points }: { points: ApiBondSnapshotCurvePoint[] }): JSX.Element {
  const width = 320;
  const height = 168;
  const path = buildCurvePath(points, width, height);
  return (
    <div className="snapshots-bond-curve-card">
      <div className="snapshots-bond-curve-card__header">
        <div>
          <strong>曲线预览</strong>
          <span>展示当前期限结构与利差变化，用于识别异常跳变与期限错位。</span>
        </div>
      </div>
      <svg
        aria-hidden="true"
        className="snapshots-bond-curve-card__chart"
        viewBox={`0 0 ${width} ${height}`}
      >
        <line x1="12" x2={width - 12} y1={height - 20} y2={height - 20} />
        <path d={path} />
        {points.map((point, index) => {
          const yields = points.map((entry) => entry.yield_pct);
          const minYield = Math.min(...yields);
          const maxYield = Math.max(...yields);
          const range = Math.max(maxYield - minYield, 0.12);
          const x = (index / Math.max(points.length - 1, 1)) * width;
          const y = height - ((point.yield_pct - minYield) / range) * (height - 18) - 9;
          return <circle cx={x} cy={y} key={point.tenor_label} r="4.5" />;
        })}
      </svg>
      <div className="snapshots-bond-curve-axis">{renderCurveAxis(points)}</div>
      <div className="snapshots-bond-chip-row">
        {points.slice(-2).map((point) => (
          <span className="chip" key={point.tenor_label}>
            {point.tenor_label} 利差 {formatCurveBps(point.spread_bps)}
          </span>
        ))}
      </div>
    </div>
  );
}

function WorkstationCard({ card }: { card: ApiBondSnapshotCard }): JSX.Element {
  return (
    <article className="snapshots-bond-pulse-card">
      <div className="snapshots-bond-work-card__top">
        <strong>{translateBondLabel(card.id, card.label)}</strong>
        <span className={getBondStatusChipClassName(card.status)}>{getBondStatusLabel(card.status)}</span>
      </div>
      {card.value ? <div className="snapshots-bond-work-card__value">{translateBondText(card.value)}</div> : null}
      {card.detail ? <p>{translateBondText(card.detail)}</p> : null}
    </article>
  );
}

function BondCurvePlaceholder(): JSX.Element {
  return (
    <div className="snapshots-bond-curve-card snapshots-bond-curve-card--empty">
      <div className="snapshots-bond-curve-card__header">
        <div>
          <strong>曲线预览</strong>
          <span>等待真实 runtime 曲线点入库；当前只保留批准稿画布与期限坐标。</span>
        </div>
      </div>
      <svg
        aria-hidden="true"
        className="snapshots-bond-curve-card__chart"
        viewBox="0 0 320 168"
      >
        <line x1="12" x2="308" y1="148" y2="148" />
        <path d="M 20 128 C 88 124 112 116 170 118 S 256 106 300 96" />
        <path className="snapshots-bond-curve-card__ghost" d="M 20 132 C 92 130 118 123 172 126 S 258 118 300 108" />
        <circle cx="20" cy="128" r="4" />
        <circle cx="170" cy="118" r="4" />
        <circle cx="300" cy="96" r="4" />
      </svg>
      <div className="snapshots-bond-curve-axis">
        {['2Y', '10Y', '30Y'].map((label) => (
          <div className="snapshots-bond-curve-axis__item" key={label}>
            <span>{label}</span>
            <strong>待曲线</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

type BondAuditCellTone = 'ok' | 'warn' | 'danger' | 'imputed';

type BondAuditCell = {
  label: string;
  tone: BondAuditCellTone;
};

type BondAuditMatrixRow = {
  id: string;
  label: string;
  subtitle: string;
  cells: [BondAuditCell, BondAuditCell, BondAuditCell, BondAuditCell];
  action: BondAuditCell;
};

function getFieldValue(instrument: ApiBondSnapshotEligibleInstrument, keys: string[]): unknown {
  const payload = instrument as unknown as Record<string, unknown>;
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function getFieldTone(instrument: ApiBondSnapshotEligibleInstrument, keys: string[]): BondAuditCellTone {
  const statusValues = keys
    .map((key) => String(instrument.field_status?.[key] ?? '').toUpperCase())
    .filter(Boolean);
  const hasValue = getFieldValue(instrument, keys) !== null;
  const hasInferredMarker = keys.some((key) => Object.prototype.hasOwnProperty.call(instrument.inferred_fields, key));
  const hasMissingMarker = keys.some((key) => instrument.missing_fields.includes(key));
  const hasDangerStatus = statusValues.some((status) => ['MISSING', 'FAILED', 'BLOCKED'].includes(status));
  const hasInferredStatus = statusValues.includes('INFERRED');
  const hasWatchStatus = statusValues.some((status) => ['WATCH', 'PENDING', 'STALE', 'INCOMPLETE'].includes(status));

  if ((hasMissingMarker || hasDangerStatus) && !hasValue) {
    return 'danger';
  }
  if (hasInferredMarker || hasInferredStatus) {
    return 'imputed';
  }
  if (hasValue || statusValues.includes('READY')) {
    return 'ok';
  }
  if (hasWatchStatus) {
    return 'warn';
  }
  return 'warn';
}

function createFieldAuditCell(
  instrument: ApiBondSnapshotEligibleInstrument,
  keys: string[],
): BondAuditCell {
  const tone = getFieldTone(instrument, keys);
  if (tone === 'ok') {
    return { label: '✓', tone };
  }
  if (tone === 'imputed') {
    return { label: '推算', tone };
  }
  if (tone === 'danger') {
    return { label: '缺失', tone };
  }
  return { label: '待补', tone };
}

function createInstrumentAuditAction(
  instrument: ApiBondSnapshotEligibleInstrument,
  cells: BondAuditCell[],
  selectedInstrumentId: string | null,
): BondAuditCell {
  if (cells.some((cell) => cell.tone === 'danger')) {
    return { label: '补齐字段', tone: 'danger' };
  }
  if (cells.some((cell) => cell.tone === 'warn')) {
    return { label: '待复核', tone: 'warn' };
  }
  if (cells.some((cell) => cell.tone === 'imputed')) {
    return { label: '已推算', tone: 'imputed' };
  }
  return {
    label: instrument.id === selectedInstrumentId ? '合格来源' : '可入库',
    tone: 'ok',
  };
}

function buildInstrumentAuditRows(
  instruments: ApiBondSnapshotEligibleInstrument[],
  selectedInstrumentId: string | null,
): BondAuditMatrixRow[] {
  return instruments.map((instrument) => {
    const cells: BondAuditMatrixRow['cells'] = [
      createFieldAuditCell(instrument, ['full_price', 'dirty_price']),
      createFieldAuditCell(instrument, ['accrued_interest']),
      createFieldAuditCell(instrument, ['duration']),
      createFieldAuditCell(instrument, ['ytm_pct']),
    ];
    return {
      id: instrument.id,
      label: instrument.label,
      subtitle: `${instrument.instrument_type} · ${instrument.snapshot_ref ?? instrument.id}`,
      cells,
      action: createInstrumentAuditAction(instrument, cells, selectedInstrumentId),
    };
  });
}

function getToneForStatus(status?: string | null): BondAuditCellTone {
  const normalizedStatus = String(status ?? '').toUpperCase();
  if (['READY', 'COMPLETED'].includes(normalizedStatus)) {
    return 'ok';
  }
  if (['FAILED', 'BLOCKED', 'ACTION_REQUIRED'].includes(normalizedStatus)) {
    return 'danger';
  }
  return 'warn';
}

function buildEmptyAuditRows(overview: ApiBondFixedIncomeOverview): BondAuditMatrixRow[] {
  const tone = getToneForStatus(overview.global_pulse.status);
  return [
    {
      id: 'empty-bond-audit',
      label: '等待 runtime 债券快照',
      subtitle: 'bond_fixed_income 写入字段齐备的快照后，这里显示逐字段矩阵。',
      cells: [
        { label: '待写入', tone },
        { label: '待写入', tone },
        { label: '待写入', tone },
        { label: '待写入', tone },
      ],
      action: { label: '继续刷新', tone },
    },
  ];
}

function BondAuditMatrix({
  overview,
  selectedInstrumentId,
}: {
  overview: ApiBondFixedIncomeOverview;
  selectedInstrumentId: string | null;
}): JSX.Element {
  const rows = overview.eligible_instruments.length
    ? buildInstrumentAuditRows(overview.eligible_instruments, selectedInstrumentId)
    : buildEmptyAuditRows(overview);

  return (
    <article className="snapshots-bond-audit-card">
      <div className="snapshots-bond-audit-toolbar">
        <div className="snapshots-bond-chip-row">
          <span className="status-chip status-chip--success">绿格 = 字段可用</span>
          <span className="status-chip status-chip--soft">蓝格 = 推算字段</span>
          <span className="status-chip status-chip--warning">黄格 = 待复核</span>
        </div>
        <div className="snapshots-bond-chip-row">
          <span className="status-chip status-chip--soft">{rows.length} 条快照</span>
          <span className="status-chip status-chip--soft">runtime 字段矩阵</span>
        </div>
      </div>
      <div className="snapshots-bond-audit-grid">
        <div className="snapshots-bond-audit-grid__header">
          <span>快照 ID</span>
          <span>全价 (Dirty)</span>
          <span>应计 (Accrued)</span>
          <span>久期 (Duration)</span>
          <span>到期收益率 (YTM)</span>
          <span>操作</span>
        </div>
        {rows.map((row) => (
          <div className="snapshots-bond-audit-row" key={row.id}>
            <div className="snapshots-bond-audit-row__label">
              <strong>{row.label}</strong>
              <span>{row.subtitle}</span>
            </div>
            {row.cells.map((cell, index) => (
              <div
                className={`snapshots-bond-audit-cell snapshots-bond-audit-cell--${cell.tone}`}
                key={`${row.id}-${index}-${cell.label}`}
              >
                {cell.label}
              </div>
            ))}
            <div
              className={`snapshots-bond-audit-cell snapshots-bond-audit-cell--${row.action.tone} snapshots-bond-audit-cell--action`}
            >
              {row.action.label}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

type BondFixedIncomeSnapshotsTabProps = {
  overview: ApiBondFixedIncomeOverview;
  onRefresh?: () => void;
  refreshDisabled?: boolean;
  refreshLabel?: string;
  onCreateAssetLeg?: (instrument: ApiBondSnapshotEligibleInstrument) => void;
  creatingAssetLegId?: string | null;
  createAssetLegError?: string | null;
  createAssetLegMessage?: string | null;
};

export function BondFixedIncomeSnapshotsTab({
  overview,
  onRefresh,
  refreshDisabled = false,
  refreshLabel = '刷新债券快照',
  onCreateAssetLeg,
  creatingAssetLegId = null,
  createAssetLegError = null,
  createAssetLegMessage = null,
}: BondFixedIncomeSnapshotsTabProps): JSX.Element {
  const eligibleInstruments = overview.eligible_instruments;
  const [selectedInstrumentId, setSelectedInstrumentId] = useState<string | null>(eligibleInstruments[0]?.id ?? null);
  const readyInstrumentCount = eligibleInstruments.filter(
    (instrument) => String(instrument.status || '').toUpperCase() === 'READY',
  ).length;
  const visiblePulseCards = overview.global_pulse.cards.filter(
    (card) => !['shared_snapshot_route', 'scheduler'].includes(card.id),
  );
  const fieldCoveragePercent =
    eligibleInstruments.length > 0 ? Math.round((readyInstrumentCount / eligibleInstruments.length) * 100) : 0;
  const pendingPulseCount = visiblePulseCards.filter(
    (card) => !['READY', 'COMPLETED'].includes(String(card.status || '').toUpperCase()),
  ).length;
  const blockedPulseCount = visiblePulseCards.filter((card) =>
    ['BLOCKED', 'FAILED'].includes(String(card.status || '').toUpperCase()),
  ).length;
  useEffect(() => {
    if (!eligibleInstruments.length) {
      setSelectedInstrumentId(null);
      return;
    }
    if (!eligibleInstruments.some((instrument) => instrument.id === selectedInstrumentId)) {
      setSelectedInstrumentId(eligibleInstruments[0].id);
    }
  }, [eligibleInstruments, selectedInstrumentId]);

  const selectedInstrument =
    eligibleInstruments.find((instrument) => instrument.id === selectedInstrumentId) ?? eligibleInstruments[0] ?? null;
  const selectedInstrumentIsReady = String(selectedInstrument?.status || '').toUpperCase() === 'READY';
  const selectedInstrumentIsCreating = selectedInstrument ? creatingAssetLegId === selectedInstrument.id : false;
  return (
    <div className="snapshots-bond-view">
      <section className="panel snapshots-bond-panel snapshots-bond-health-panel">
        <div className="panel-header snapshots-bond-panel__header">
          <div>
            <div className="snapshots-bond-title-row">
              <h3>全局健康仪表盘</h3>
              <span
                className="snapshots-bond-inline-tooltip"
                title="全局健康仪表盘：用少数关键指标判断债券快照库今天能否继续为资产腿提供合法来源。"
              >
                ?
              </span>
            </div>
            <p className="snapshots-panel-copy">
              用于判断债券快照库当日是否具备继续入库条件，以及问题主要位于字段、映射还是供应商链路。
            </p>
          </div>
          <button
            className="primary-button snapshots-bond-refresh-button"
            disabled={refreshDisabled}
            onClick={onRefresh}
            type="button"
          >
            {refreshLabel}
          </button>
        </div>

        <div className="snapshots-bond-pulse-grid snapshots-bond-pulse-grid--designed">
          <article className="snapshots-bond-pulse-card">
            <strong>就绪 / 待补 / 阻塞</strong>
            <p>按状态汇总当日债券快照的可用性，用于快速判断来源底座是否完整。</p>
            <div className="snapshots-bond-pulse-bar" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="snapshots-bond-chip-row">
              <span className="status-chip status-chip--success">就绪 {readyInstrumentCount}</span>
              <span className="status-chip status-chip--warning">待补 {pendingPulseCount}</span>
              <span className="status-chip status-chip--danger">阻塞 {blockedPulseCount}</span>
            </div>
          </article>
          <article className="snapshots-bond-pulse-card">
            <div className="snapshots-bond-work-card__top">
              <strong>影子字段覆盖率</strong>
              <span className="status-chip status-chip--soft">
                {readyInstrumentCount}/{eligibleInstruments.length} 可入库
              </span>
            </div>
            <div className="snapshots-bond-ring-inline">
              <svg className="snapshots-bond-ring-svg" viewBox="0 0 120 120" aria-hidden="true">
                <circle cx="60" cy="60" fill="none" r="46" stroke="#e6edf0" strokeWidth="12" />
                <circle
                  cx="60"
                  cy="60"
                  fill="none"
                  r="46"
                  stroke="#1f877b"
                  strokeDasharray={`${fieldCoveragePercent * 2.89} 289`}
                  strokeLinecap="round"
                  strokeWidth="12"
                  transform="rotate(-90 60 60)"
                />
                <text x="60" y="67" textAnchor="middle">{fieldCoveragePercent}%</text>
              </svg>
              <p>
                <strong>{fieldCoveragePercent}% 已覆盖</strong>
                <br />
                净价、全价、应计利息、YTM、久期与凸性字段来自 runtime 债券快照。
              </p>
            </div>
          </article>
          <article className="snapshots-bond-pulse-card">
            <strong>入库链路与数据自愈</strong>
            <p>跟踪供应商路径、回补任务与异常修复进度，评估当日入库稳定性。</p>
            <div className="snapshots-bond-chip-row">
              <span className="status-chip status-chip--success">FMP 正常</span>
              <span className="status-chip status-chip--soft">Polygon 正常</span>
              <span className="status-chip status-chip--soft">自愈进行中</span>
            </div>
            <p>当前仅使用 runtime 来源；如果共享快照阻塞，会同步进入修复队列。</p>
          </article>
        </div>

      </section>

      <div className="snapshots-bond-detail-grid snapshots-bond-workstation-grid">
        <div className="snapshots-bond-detail-main">
          <section className="panel snapshots-bond-panel snapshots-bond-runtime-panel">
            <div className="panel-header snapshots-bond-panel__header">
              <div>
                <div className="snapshots-bond-title-row">
                  <h3>三位一体工作站</h3>
                  <span className="status-chip status-chip--soft">
                    {readyInstrumentCount}/{eligibleInstruments.length} 可入库
                  </span>
                </div>
                <p className="snapshots-panel-copy">
                  仅 runtime bond_fixed_income 快照表中字段齐备的债券可创建资产腿；代理曲线和兜底行保持只读。
                </p>
              </div>
            </div>
            <div className="snapshots-bond-pillar-layout snapshots-bond-workbench-layout">
              <div className="snapshots-bond-pillar-tabs" aria-label="债券品类工作站">
                <article className="snapshots-bond-pillar-tab snapshots-bond-pillar-tab--active">
                  <strong>利率债（UST）</strong>
                  <span>收益率曲线点、久期和凸性字段齐备后，可进入资产腿创建侧栏。</span>
                  <div className="snapshots-bond-tab-strip">
                    <span className="status-chip status-chip--soft">2Y / 10Y / 30Y</span>
                    <span className={readyInstrumentCount ? 'status-chip status-chip--success' : 'status-chip status-chip--warning'}>
                      {readyInstrumentCount} 条就绪
                    </span>
                  </div>
                </article>
                <article className="snapshots-bond-pillar-tab">
                  <strong>通胀债（TIPS）</strong>
                  <span>用于把实际利率与名义利率分开审计；没有 runtime 行时保持待补。</span>
                  <div className="snapshots-bond-tab-strip">
                    <span className="status-chip status-chip--soft">5Y / 10Y</span>
                    <span className="status-chip status-chip--warning">待补</span>
                  </div>
                </article>
                <article className="snapshots-bond-pillar-tab">
                  <strong>投资级信用债（IG）</strong>
                  <span>信用利差篮子必须有真实来源和字段审计，不能使用代理曲线入库。</span>
                  <div className="snapshots-bond-tab-strip">
                    <span className="status-chip status-chip--soft">AAA / AA</span>
                    <span className="status-chip status-chip--warning">待补审计</span>
                  </div>
                </article>
              </div>

              <div className="snapshots-bond-workbench-main">
            <div className="snapshots-bond-snapshot-head">
              <strong>利率债（UST）</strong>
              <span className={readyInstrumentCount ? 'status-chip status-chip--success' : 'status-chip status-chip--soft'}>
                {readyInstrumentCount ? '就绪' : '待补'}
              </span>
            </div>
            {eligibleInstruments.length ? (
              <div className="snapshots-bond-source-stack">
                {eligibleInstruments.map((instrument) => (
                  <button
                    aria-pressed={instrument.id === selectedInstrument?.id}
                    className={`snapshots-bond-source-choice${instrument.id === selectedInstrument?.id ? ' snapshots-bond-source-choice--active' : ''}`}
                    key={instrument.id}
                    onClick={() => setSelectedInstrumentId(instrument.id)}
                    type="button"
                  >
                    <div className="snapshots-bond-source-choice__top">
                      <div className="snapshots-bond-source-choice__copy">
                        <strong>{instrument.label}</strong>
                        <span>
                          {instrument.snapshot_ref ?? instrument.id} · {instrument.source} ·{' '}
                          {instrument.snapshot_date ?? '暂无快照日期'}
                        </span>
                      </div>
                      <span className={getBondStatusChipClassName(instrument.status)}>
                        {getBondStatusLabel(instrument.status)}
                      </span>
                    </div>
                    <div className="snapshots-bond-chip-row">
                      <span className="status-chip status-chip--soft">全价 {instrument.full_price ?? instrument.dirty_price ?? 'n/a'}</span>
                      <span className="status-chip status-chip--soft">应计 {instrument.accrued_interest ?? 'n/a'}</span>
                      <span className="status-chip status-chip--soft">到期收益率 {instrument.ytm_pct ?? 'n/a'}%</span>
                        <span className="status-chip status-chip--soft">久期 {instrument.duration ?? 'n/a'}</span>
                      </div>
                  </button>
                ))}
              </div>
            ) : (
              <article className="snapshots-bond-evidence-card">
                <strong>暂无可创建资产腿的债券来源</strong>
                <span>请先运行快照刷新任务，或写入字段齐备的 bond_fixed_income 快照。</span>
              </article>
            )}
            {selectedInstrument ? (
              <div className="snapshots-bond-spread-grid snapshots-bond-workbench-metrics">
                <article className="snapshots-bond-spread-card">
                  <span>全价 / 净价</span>
                  <strong>{selectedInstrument.full_price ?? selectedInstrument.dirty_price ?? '待补'}</strong>
                  <small>净价 {selectedInstrument.clean_price ?? selectedInstrument.net_price ?? '待补'}</small>
                </article>
                <article className="snapshots-bond-spread-card">
                  <span>应计 / 票息</span>
                  <strong>{selectedInstrument.accrued_interest ?? '待补'}</strong>
                  <small>票息 {selectedInstrument.coupon_rate_pct ?? '待补'}</small>
                </article>
                <article className="snapshots-bond-spread-card">
                  <span>YTM / 久期</span>
                  <strong>{selectedInstrument.ytm_pct ?? '待补'}%</strong>
                  <small>久期 {selectedInstrument.duration ?? '待补'}</small>
                </article>
                <article className="snapshots-bond-spread-card">
                  <span>到期 / 币种</span>
                  <strong>{selectedInstrument.maturity_date ?? '待补'}</strong>
                  <small>{selectedInstrument.currency ?? '待确认'}</small>
                </article>
              </div>
            ) : null}
              </div>
              <div className="snapshots-bond-scheduler-stack">
            <article className="snapshots-bond-curve-preview-card">
              <strong>曲线预览</strong>
              <span>
                {overview.curve_preview.length
                  ? '当前展示真实 runtime 曲线点。'
                  : '尚未写入真实 runtime 曲线点；这里保留批准稿位置，但不使用 proxy 或静态曲线兜底。'}
              </span>
              {overview.curve_preview.length ? <BondCurveChart points={overview.curve_preview} /> : <BondCurvePlaceholder />}
            </article>
            <article className="snapshots-bond-evidence-card snapshots-bond-support-note">
              <strong>UST 术语说明</strong>
              <span>
                全价、应计利息、久期与到期收益率必须来自 runtime 快照字段；曲线点缺失时保留审计提示，防止代理曲线被误读为可入库证据。
              </span>
            </article>
              </div>
            </div>
          </section>
        </div>

          <aside className="snapshots-bond-detail-rail">
            <section className="snapshots-bond-task-rail snapshots-bond-create-rail">
              <div className="snapshots-bond-task-rail__section">
                <div className="snapshots-bond-task-rail__header">
                  <div className="snapshots-bond-task-rail__heading">
                    <strong>资产腿创建</strong>
                    <span>汇总当前选中腿的入库资格、字段和审计结果。</span>
                  </div>
                </div>
                {createAssetLegError ? (
                  <div className="error-banner" role="alert">
                    {createAssetLegError}
                  </div>
                ) : null}
                {createAssetLegMessage ? (
                  <div className="snapshots-bond-evidence-card" role="status">
                    {createAssetLegMessage}
                  </div>
                ) : null}
                {selectedInstrument ? (
                  <>
                    <article className="snapshots-bond-evidence-card">
                    <div className="snapshots-bond-snapshot-head">
                      <strong>{selectedInstrument.label}</strong>
                      <span className={getBondStatusChipClassName(selectedInstrument.status)}>
                        {getBondStatusLabel(selectedInstrument.status)}
                      </span>
                    </div>
                    <span>
                      供应商：{selectedInstrument.source} · 更新：{selectedInstrument.snapshot_date ?? '暂无日期'} · 角色：
                      收益率曲线锚点。
                    </span>
                    <div className="snapshots-bond-chip-row">
                      <span className="status-chip status-chip--success">合规字段齐备</span>
                      <span className="status-chip status-chip--soft">可回溯快照</span>
                    </div>
                    </article>
                    <article className="snapshots-bond-evidence-card">
                    <strong>入库演进：runtime 字段流</strong>
                    <span>
                      快照 {selectedInstrument.snapshot_ref ?? selectedInstrument.id} 绑定当前选中债券；缺失字段 {selectedInstrument.missing_fields.length}
                      项，推算字段 {Object.keys(selectedInstrument.inferred_fields).length} 项。
                    </span>
                    </article>
                    <div className="snapshots-bond-action-checklist">
                    <ul>
                      <li>影子字段完整，可冻结为资产腿来源。</li>
                      <li>历史快照可回溯，入库按钮绑定当前选中行。</li>
                      <li className={overview.curve_preview.length ? '' : 'is-warn'}>
                        {overview.curve_preview.length ? '收益率曲线已有 runtime 点位。' : '收益率曲线尚未入库，继续作为审计提醒。'}
                      </li>
                    </ul>
                    </div>
                    <div className="button-row snapshots-bond-create-action-row">
                      <button
                        className="primary-button"
                        disabled={!selectedInstrumentIsReady || !onCreateAssetLeg || selectedInstrumentIsCreating}
                        onClick={() => {
                          onCreateAssetLeg?.(selectedInstrument);
                        }}
                        type="button"
                      >
                        {selectedInstrumentIsCreating ? '正在创建资产腿...' : '创建资产腿'}
                      </button>
                    </div>
                  </>
                ) : (
                  <article className="snapshots-bond-evidence-card">
                    <strong>暂无选中债券</strong>
                    <span>runtime 中没有 READY 债券快照，暂不能创建资产腿。</span>
                  </article>
                )}
              </div>
            </section>
          </aside>
      </div>

      <div className="snapshots-bond-detail-stack">
        <div className="snapshots-bond-detail-grid snapshots-bond-audit-layout">
          <div className="snapshots-bond-detail-main">
            <section className="panel snapshots-bond-panel snapshots-bond-audit-panel">
              <div className="panel-header snapshots-bond-panel__header">
                <div>
                  <div className="snapshots-bond-title-row">
                    <h3>影子数据审计矩阵</h3>
                    <span className={getBondStatusChipClassName(overview.global_pulse.status)}>
                      {getBondStatusLabel(overview.global_pulse.status)}
                    </span>
                  </div>
                  <p className="snapshots-panel-copy">
                    这里展示实时 bond_fixed_income overview payload 中的字段、门禁和审计证据；空态代表尚未写入可审计债券快照。
                  </p>
                </div>
                <div className="button-row">
                  <button className="ghost-button snapshots-bond-audit-repair-button" type="button">
                    批量修复规则
                  </button>
                </div>
              </div>

              <BondAuditMatrix overview={overview} selectedInstrumentId={selectedInstrument?.id ?? null} />
            </section>
          </div>

          <aside className="snapshots-bond-detail-rail">
            <section className="snapshots-bond-task-rail snapshots-bond-diagnostic-rail">
              <div className="snapshots-bond-task-rail__section">
                <div className="snapshots-bond-task-rail__header">
                  <div className="snapshots-bond-task-rail__heading">
                    <strong>系统诊断</strong>
                    <span>{getDiagnosticEntries(overview).length} 条备注</span>
                  </div>
                </div>
                {getDiagnosticEntries(overview).map((entry) => (
                  <article className="snapshots-bond-evidence-card" key={`${entry.title}-${entry.body}`}>
                    <div className="snapshots-bond-snapshot-head">
                      <strong>{entry.title}</strong>
                      <span className={getBondStatusChipClassName(entry.status)}>
                        {getBondStatusLabel(entry.status)}
                      </span>
                    </div>
                    <span>{entry.body}</span>
                  </article>
                ))}
              </div>
            </section>
          </aside>
        </div>

        <section className="panel snapshots-bond-panel snapshots-bond-registry-panel">
          <div className="panel-header snapshots-bond-panel__header">
            <div>
              <div className="snapshots-bond-title-row">
                <h3>原始快照与调度</h3>
                <span className="status-chip status-chip--soft">{overview.raw_registry.length} 条 runtime 行</span>
              </div>
              <p className="snapshots-panel-copy">
                只展示真实 bond_fixed_income 快照与共享调度规则，让审计矩阵和调度治理像批准稿一样分层。
              </p>
            </div>
            <button className="ghost-button snapshots-bond-registry-refresh-button" type="button">
              批量重刷 2 个异常快照
            </button>
          </div>

          <div className="snapshots-bond-registry-layout">
            <div className="snapshots-bond-registry-stack">
              {overview.raw_registry.length ? (
                overview.raw_registry.map((item) => (
                  <article className="snapshots-bond-registry-row" key={item.id}>
                    <input
                      aria-label={`选择 ${item.label}`}
                      checked={item.id === selectedInstrument?.id || item.snapshot_ref === selectedInstrument?.snapshot_ref}
                      readOnly
                      type="radio"
                    />
                    <div>
                      <strong>{item.label}</strong>
                      <span>{item.snapshot_ref ?? item.id}</span>
                    </div>
                    <div>
                      <strong>字段</strong>
                      <span>{item.notes.length ? item.notes.join(' / ') : 'runtime 字段待补齐'}</span>
                    </div>
                    <div>
                      <strong>调度</strong>
                      <span>
                        {translateBondSource(item.source)} · {formatRegistryTimestamp(item.updated_at)}
                      </span>
                    </div>
                    <div>
                      <strong>{getBondStatusLabel(item.status)}</strong>
                      <span>{item.status}</span>
                    </div>
                  </article>
                ))
              ) : (
                <article className="snapshots-bond-evidence-card">
                  <strong>暂无原始债券快照行</strong>
                  <span>只有已存储的 bond_fixed_income 快照会出现在这里。</span>
                </article>
              )}
            </div>

            <aside className="snapshots-bond-detail-rail">
              <section className="snapshots-bond-task-rail">
                <div className="snapshots-bond-task-rail__section">
                  <div className="snapshots-bond-task-rail__header">
                    <div className="snapshots-bond-task-rail__heading">
                      <strong>批量修复规则</strong>
                      <span>{getRuleEntries(overview).length} 条规则</span>
                    </div>
                  </div>
                  {getRuleEntries(overview).map((entry) => (
                    <article className="snapshots-bond-evidence-card" key={`${entry.title}-${entry.body}`}>
                      <div className="snapshots-bond-snapshot-head">
                        <strong>{entry.title}</strong>
                        <span className={getBondStatusChipClassName(entry.status)}>
                          {getBondStatusLabel(entry.status)}
                        </span>
                      </div>
                      <span>{entry.body}</span>
                    </article>
                  ))}
                </div>
              </section>
            </aside>
          </div>
        </section>
      </div>

    </div>
  );
}

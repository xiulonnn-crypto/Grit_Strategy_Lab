import { useEffect, useState } from 'react';
import { formatDateTime } from '../lib/format';
import type {
  ApiBondFixedIncomeOverview,
  ApiBondSnapshotAuditRow,
  ApiBondSnapshotCard,
  ApiBondSnapshotCurvePoint,
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
};

const BOND_OWNER_LABELS: Record<string, string> = {
  'snapshot overview': '共享快照总览',
  snapshot_refresh_jobs: '快照刷新任务',
  dataset_snapshots: '数据集快照',
};

const BOND_SOURCE_LABELS: Record<string, string> = {
  shared_snapshot_overview: '共享快照总览',
  deterministic_phase1_seed: '第一阶段曲线样本',
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
  '#/snapshots remains the only route for bond governance': '#/snapshots 继续作为唯一治理入口。',
  'This remains the single snapshot API surface.': '当前仍只有一套快照 API 入口。',
  'Bond governance is additive only.': '债券治理只做增量扩展，不新增第二套接口。',
  'Synthetic until a dedicated fixed-income dataset is approved.':
    '在专门的固定收益数据集获批前，这里先使用确定性样本曲线。',
  'Phase 1 extends the existing snapshot API instead of adding a bond-only endpoint.':
    '第一阶段扩展现有快照 API，而不是新增债券专属端点。',
  'Bond governance is blocked whenever the shared snapshot overview is blocked.':
    '共享快照总览一旦阻塞，债券治理也会同步阻塞。',
  'Phase 1 intentionally keeps fixed-income oversight on the shared route and scheduler.':
    '第一阶段刻意把固定收益治理保留在共享路由与共享调度上。',
  'Fallback payload generated in the API layer.': '这是 API 层生成的兜底治理载荷。',
  'Phase 1 curve proxy': '第一阶段曲线样本',
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

  const curvePreview: ApiBondSnapshotCurvePoint[] = [
    { tenor_label: '2Y', yield_pct: 4.18, spread_bps: 0 },
    { tenor_label: '5Y', yield_pct: 4.06, spread_bps: -12 },
    { tenor_label: '10Y', yield_pct: 4.12, spread_bps: -6 },
    { tenor_label: '30Y', yield_pct: 4.33, spread_bps: 15 },
  ];

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
    raw_registry: [
      {
        id: 'shared_snapshot_overview',
        label: 'Shared snapshot overview',
        status: pulseStatus,
        source: 'api:/data-snapshots/overview',
        snapshot_ref: 'data_snapshots',
        updated_at: updatedAt,
        notes: ['This remains the single snapshot API surface.', 'Bond governance is additive only.'],
      },
      {
        id: 'phase1_curve_proxy',
        label: 'Phase 1 curve proxy',
        status: 'READY',
        source: 'deterministic_phase1_seed',
        snapshot_ref: 'bond_fixed_income.curve_preview',
        updated_at: updatedAt,
        notes: ['Synthetic until a dedicated fixed-income dataset is approved.'],
      },
    ],
    scheduler: {
      status: latestJob ? 'READY' : 'WATCH',
      cadence_label: `Shared snapshot cadence (${refreshMode})`,
      next_action: 'refresh_snapshots',
      last_job_id: typeof latestJob?.id === 'string' ? latestJob.id : null,
    },
    selected_source_summary: {
      primary_source: 'shared_snapshot_overview',
      fallback_source: 'deterministic_phase1_seed',
      selection_reason: 'Phase 1 extends the existing snapshot API instead of adding a bond-only endpoint.',
    },
    system_diagnostics: {
      blocking_code: snapshotOverview?.blocking_code ?? null,
      blocking_target: snapshotOverview?.blocking_target ?? null,
      refresh_job_status: typeof latestJob?.status === 'string' ? latestJob.status : overallStatus,
      memory: {},
      notes: [
        'Bond governance is blocked whenever the shared snapshot overview is blocked.',
        'Phase 1 intentionally keeps fixed-income oversight on the shared route and scheduler.',
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
          normalizeCurvePoint(point, fallback.curve_preview[index] ?? fallback.curve_preview[0]),
        )
      : fallback.curve_preview,
    audit_matrix: Array.isArray(payload.audit_matrix)
      ? payload.audit_matrix.map((row, index) =>
          normalizeAuditRow(row, fallback.audit_matrix[index] ?? fallback.audit_matrix[0]),
        )
      : fallback.audit_matrix,
    raw_registry: Array.isArray(payload.raw_registry)
      ? payload.raw_registry.map((item, index) =>
          normalizeRegistryItem(item, fallback.raw_registry[index] ?? fallback.raw_registry[0]),
        )
      : fallback.raw_registry,
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
    <article className="snapshots-bond-work-card">
      <div className="snapshots-bond-work-card__top">
        <strong>{translateBondLabel(card.id, card.label)}</strong>
        <span className={getBondStatusChipClassName(card.status)}>{getBondStatusLabel(card.status)}</span>
      </div>
      {card.value ? <div className="snapshots-bond-work-card__value">{translateBondText(card.value)}</div> : null}
      {card.detail ? <p>{translateBondText(card.detail)}</p> : null}
    </article>
  );
}

type BondFixedIncomeSnapshotsTabProps = {
  overview: ApiBondFixedIncomeOverview;
  onRefresh?: () => void;
  refreshDisabled?: boolean;
  refreshLabel?: string;
};

export function BondFixedIncomeSnapshotsTab({
  onRefresh,
  refreshDisabled = false,
  refreshLabel = '刷新债券快照',
}: BondFixedIncomeSnapshotsTabProps): JSX.Element {
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
            <span>按状态汇总当日债券快照的可用性，用于快速判断来源底座是否完整。</span>
            <div className="snapshots-bond-pulse-bar" aria-label="就绪 68%，待补 22%，阻塞 10%">
              <span />
              <span />
              <span />
            </div>
            <div className="snapshots-bond-chip-row">
              <span className="status-chip status-chip--success">就绪 9</span>
              <span className="status-chip status-chip--warning">待补 3</span>
              <span className="status-chip status-chip--danger">阻塞 1</span>
            </div>
          </article>

          <article className="snapshots-bond-pulse-card">
            <strong>影子字段覆盖率</strong>
            <div className="snapshots-bond-ring-inline">
              <svg className="snapshots-bond-ring-svg" viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(229, 231, 235, 0.96)" strokeWidth="10" />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke="#1f877b"
                  strokeDasharray="263.9"
                  strokeDashoffset="15.8"
                  strokeLinecap="round"
                  strokeWidth="10"
                  transform="rotate(-90 50 50)"
                />
                <text x="50" y="54" textAnchor="middle" fontSize="18" fontWeight="800" fill="#111827">
                  94%
                </text>
              </svg>
              <div>
                <strong>94% 已覆盖</strong>
                <span>
                  全价、久期和到期收益率（YTM）已经稳定；当前缺口主要集中在 IG 的应计历史与部分 TIPS
                  的映射一致性。
                </span>
              </div>
            </div>
          </article>

          <article className="snapshots-bond-pulse-card">
            <strong>入库链路与数据自愈</strong>
            <span>跟踪供应商链路、回补任务与异常修复进度，评估当日入库稳定性。</span>
            <div className="snapshots-bond-chip-row">
              <span className="status-chip status-chip--success">FMP 正常</span>
              <span className="status-chip status-chip--soft">Polygon 正常</span>
              <span className="status-chip status-chip--soft">自愈进行中</span>
            </div>
            <span>下次自动回补：02:30 香港时间（HKT）。当前正在重试 IG 的应计利息历史补齐。</span>
          </article>
        </div>
      </section>

      <div className="snapshots-bond-detail-stack">
        <div className="snapshots-bond-detail-grid">
          <div className="snapshots-bond-detail-main">
            <section className="panel snapshots-bond-panel">
              <div className="panel-header snapshots-bond-panel__header">
                <div>
                  <div className="snapshots-bond-title-row">
                    <h3>三位一体工作站</h3>
                    <span
                      className="snapshots-bond-inline-tooltip"
                      title="三位一体工作站：把利率债、抗通胀债、投资级信用债三类基石放进同一套治理工作区，用来观察曲线、利差与字段完备度。"
                    >
                      ?
                    </span>
                  </div>
                  <p className="snapshots-panel-copy">
                    以利率债、抗通胀债和投资级信用债三类基石观察曲线、利差与字段完备度。
                  </p>
                </div>
              </div>

              <div className="snapshots-bond-pillar-layout">
                <div className="snapshots-bond-pillar-tabs" role="tablist" aria-label="债券治理工作站">
                  <article className="snapshots-bond-pillar-tab snapshots-bond-pillar-tab--active">
                    <strong>利率债（UST）</strong>
                    <span>收益率曲线锚点。当前是最稳定、最适合直接生成资产腿的一组债券来源。</span>
                    <div className="snapshots-bond-chip-row">
                      <span className="status-chip status-chip--success">2Y / 10Y / 30Y</span>
                      <span className="status-chip status-chip--soft">3 条就绪</span>
                    </div>
                  </article>
                  <article className="snapshots-bond-pillar-tab">
                    <strong>抗通胀债（TIPS）</strong>
                    <span>用于把实际利率视角引入配置。核心缺口不是价格，而是真实收益率映射的一致性。</span>
                    <div className="snapshots-bond-chip-row">
                      <span className="status-chip status-chip--soft">5Y / 10Y</span>
                      <span className="status-chip status-chip--warning">1 条待补</span>
                    </div>
                  </article>
                  <article className="snapshots-bond-pillar-tab">
                    <strong>投资级信用债（IG）</strong>
                    <span>收益增强与防御替代来源。当前主要风险是应计历史仍有缺口，不宜直接镜像入库。</span>
                    <div className="snapshots-bond-chip-row">
                      <span className="status-chip status-chip--soft">AAA / AA</span>
                      <span className="status-chip status-chip--danger">待补应计</span>
                    </div>
                  </article>
                </div>

                <div className="snapshots-bond-registry-stack">
                  <article className="snapshots-bond-audit-card">
                    <div className="snapshots-bond-snapshot-head">
                      <strong>利率债（UST）</strong>
                      <span className="status-chip status-chip--success">就绪</span>
                    </div>
                    <span>
                      作为收益率曲线基准，UST 是正式组合里最常用的债券腿来源。当前优先展示 UST
                      的期限快照、利差状态与字段完备度。
                    </span>
                    <div className="snapshots-bond-tab-strip">
                      <span className="snapshots-bond-pill-status">
                        <span className="snapshots-bond-pill-status__dot" />
                        2Y 就绪
                      </span>
                      <span className="snapshots-bond-pill-status">
                        <span className="snapshots-bond-pill-status__dot" />
                        10Y 就绪
                      </span>
                      <span className="snapshots-bond-pill-status">
                        <span className="snapshots-bond-pill-status__dot snapshots-bond-pill-status__dot--warn" />
                        30Y 缺应计
                      </span>
                    </div>
                    <div className="snapshots-bond-spread-grid">
                      <article className="snapshots-bond-spread-card">
                        <span>10Y-2Y 利差（Spread）</span>
                        <strong>+50 基点</strong>
                        <small>昨日基线：+44 基点。若单日跳变超过 15 基点，优先检查 2Y 或 10Y 的估值点位。</small>
                      </article>
                      <article className="snapshots-bond-spread-card snapshots-bond-spread-card--warn">
                        <span>30Y-10Y 利差（Spread）</span>
                        <strong>+30 基点</strong>
                        <small>昨日基线：+28 基点。当前略陡，但 30Y 的应计回补仍需复核。</small>
                      </article>
                    </div>
                    <div className="snapshots-bond-chip-row">
                      <span className="status-chip status-chip--success">[全价]</span>
                      <span className="status-chip status-chip--soft">[应计]</span>
                      <span className="status-chip status-chip--soft">[久期]</span>
                      <span className="status-chip status-chip--soft">[收益率]</span>
                      <span className="status-chip status-chip--soft">[凸性]</span>
                    </div>
                    <div className="snapshots-bond-source-stack">
                      <article className="snapshots-bond-source-choice snapshots-bond-source-choice--active">
                        <div className="snapshots-bond-source-choice__top">
                          <div className="snapshots-bond-source-choice__copy">
                            <strong>Bond-UST10Y-EOD-20260421</strong>
                            <span>当前选中快照。10Y 是全球资产定价锚点，也是配置工作台里最常用的中枢久期来源。</span>
                          </div>
                          <span className="status-chip status-chip--success">就绪</span>
                        </div>
                        <div className="snapshots-bond-chip-row">
                          <span className="status-chip status-chip--success">全价 101.8</span>
                          <span className="status-chip status-chip--soft">应计 0.42</span>
                          <span className="status-chip status-chip--soft">到期收益率（YTM）4.3%</span>
                          <span className="status-chip status-chip--soft">久期 8.6</span>
                        </div>
                      </article>
                      <article className="snapshots-bond-source-choice">
                        <div className="snapshots-bond-source-choice__top">
                          <div className="snapshots-bond-source-choice__copy">
                            <strong>Bond-UST2Y-EOD-20260421</strong>
                            <span>前端久期端点。主要用于曲线陡峭度和流动性状态判断。</span>
                          </div>
                          <span className="status-chip status-chip--success">就绪</span>
                        </div>
                        <div className="snapshots-bond-chip-row">
                          <span className="status-chip status-chip--soft">到期收益率（YTM）3.8%</span>
                          <span className="status-chip status-chip--soft">久期 1.9</span>
                          <span className="status-chip status-chip--soft">应计完整</span>
                        </div>
                      </article>
                      <article className="snapshots-bond-source-choice">
                        <div className="snapshots-bond-source-choice__top">
                          <div className="snapshots-bond-source-choice__copy">
                            <strong>Bond-UST30Y-EOD-20260421</strong>
                            <span>长端久期尾部。当前价格与到期收益率（YTM）正常，但应计利息仍在回补。</span>
                          </div>
                          <span className="status-chip status-chip--warning">待补</span>
                        </div>
                        <div className="snapshots-bond-chip-row">
                          <span className="status-chip status-chip--soft">到期收益率（YTM）4.6%</span>
                          <span className="status-chip status-chip--soft">久期 16.9</span>
                          <span className="status-chip status-chip--warning">应计待补</span>
                        </div>
                      </article>
                    </div>
                  </article>
                </div>

                <div className="snapshots-bond-scheduler-stack">
                  <article className="snapshots-bond-curve-preview-card">
                    <strong>曲线预览</strong>
                    <span>展示当日与昨日收益率曲线差异，用于识别异常跳变与期限结构扭曲。</span>
                    <svg viewBox="0 0 260 120" preserveAspectRatio="none" aria-hidden="true">
                      <path
                        d="M20 94 L130 61 L240 48"
                        fill="none"
                        stroke="#b0bac7"
                        strokeDasharray="6 6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                      />
                      <path
                        d="M20 90 L130 54 L240 38"
                        fill="none"
                        stroke="#1f877b"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="4"
                      />
                      <circle cx="20" cy="90" r="5" fill="#1f877b" />
                      <circle cx="130" cy="54" r="5" fill="#1f877b" />
                      <circle cx="240" cy="38" r="5" fill="#d68c2f" />
                      <line x1="20" y1="100" x2="240" y2="100" stroke="rgba(148, 163, 184, 0.42)" strokeWidth="1" />
                    </svg>
                    <div className="snapshots-bond-chip-row">
                      <span className="status-chip status-chip--success">今日曲线</span>
                      <span className="status-chip status-chip--soft">昨日基准线</span>
                      <span className="status-chip status-chip--soft">10Y-2Y +50 基点</span>
                    </div>
                    <span className="snapshots-bond-curve-anomaly">
                      曲线异常偏移：建议去审计矩阵复核 30Y 应计与 10Y 估值点。
                    </span>
                  </article>
                  <article className="snapshots-bond-scheduler-card">
                    <strong>UST 术语说明</strong>
                    <span>
                      UST 类别下必须同时具备全价、应计利息、久期与到期收益率（YTM）。30Y
                      还要显式标出是否完成长端应计历史补齐，防止曲线尾部被误读。
                    </span>
                    <div className="snapshots-bond-chip-row">
                      <span className="status-chip status-chip--success">流动性锚点</span>
                      <span className="status-chip status-chip--soft">曲线基准</span>
                      <span className="status-chip status-chip--soft">风险预算底座</span>
                    </div>
                  </article>
                </div>
              </div>
            </section>
          </div>

          <aside className="snapshots-bond-detail-rail">
            <section className="snapshots-bond-task-rail">
              <div className="snapshots-bond-task-rail__section">
                <div className="snapshots-bond-task-rail__header">
                  <div className="snapshots-bond-task-rail__heading">
                    <strong>资产腿创建</strong>
                    <span>汇总当前选中快照的入库资格、收益流预演与校验结果，支持生成资产腿前的最后复核。</span>
                  </div>
                  <span
                    className="snapshots-bond-inline-tooltip"
                    title="入库预演：在正式生成资产腿前，先预演该快照最近一段时间的全价收益流，确认应计利息是否已让曲线平滑。"
                  >
                    ?
                  </span>
                </div>
                <article className="snapshots-bond-evidence-card">
                  <div className="snapshots-bond-snapshot-head">
                    <strong>Bond-UST10Y-EOD-20260421</strong>
                    <span className="status-chip status-chip--success">已选中</span>
                  </div>
                  <span>
                    供应商：FMP · 更新：日终刷新 (EOD) ·
                    角色：收益率曲线锚点。当前是最适合直接纳入资产腿清单的债券快照。
                  </span>
                </article>
                <article className="snapshots-bond-mini-spark">
                  <div className="snapshots-bond-mini-spark__meta">
                    <strong>入库预演：近 30 天全价收益流</strong>
                    <span className="status-chip status-chip--success">含利息累计</span>
                  </div>
                  <span>近 30 天全价收益流用于核对应计利息并入后的路径平滑度。</span>
                  <svg viewBox="0 0 280 92" preserveAspectRatio="none" aria-hidden="true">
                    <polyline
                      fill="none"
                      points="0,70 40,68 80,72 120,64 160,66 200,58 240,60 280,54"
                      stroke="#b8c2ce"
                      strokeDasharray="5 4"
                      strokeWidth="2"
                    />
                    <polyline
                      fill="none"
                      points="0,72 40,69 80,66 120,60 160,56 200,48 240,44 280,38"
                      stroke="#1f877b"
                      strokeWidth="3.5"
                    />
                  </svg>
                  <div className="snapshots-bond-chip-row">
                    <span className="status-chip status-chip--success">全价收益流（含利息）</span>
                    <span className="status-chip status-chip--soft">对照：未并入应计</span>
                  </div>
                </article>
                <div className="snapshots-bond-action-checklist">
                  <ul>
                    <li>影子字段完整，可冻结进入资产腿</li>
                    <li>历史长度超过 3 年，可支撑资产配置回测</li>
                    <li className="is-warn">30Y 仍在回补，但不影响当前 10Y 入库</li>
                  </ul>
                </div>
                <div className="button-row">
                  <a className="ghost-button" href="#/legs">
                    返回策略资产库
                  </a>
                </div>
              </div>
            </section>
          </aside>
        </div>

        <div className="snapshots-bond-detail-grid">
          <div className="snapshots-bond-detail-main">
            <section className="panel snapshots-bond-panel">
              <div className="panel-header snapshots-bond-panel__header">
                <div>
                  <div className="snapshots-bond-title-row">
                    <h3>影子数据审计矩阵</h3>
                    <span
                      className="snapshots-bond-inline-tooltip"
                      title="影子数据审计矩阵：逐行暴露债券快照是否具备全价、应计、久期与收益率字段，并提供算法推演或批量修复入口。"
                    >
                      ?
                    </span>
                  </div>
                  <p className="snapshots-panel-copy">
                    逐行显示快照字段完备度、算法推演结果与修复入口，便于定位影响入库的关键缺口。
                  </p>
                </div>
                <div className="button-row">
                  <button className="ghost-button" type="button">
                    批量修复规则
                  </button>
                </div>
              </div>

              <article className="snapshots-bond-audit-card">
                <div className="snapshots-bond-audit-toolbar">
                  <div className="snapshots-bond-chip-row">
                    <span className="status-chip status-chip--success">红格 = 缺失</span>
                    <span className="status-chip status-chip--soft">蓝格 = 推算 (Imputed)</span>
                    <span className="status-chip status-chip--warning">黄格 = 待复核</span>
                  </div>
                  <div className="snapshots-bond-chip-row">
                    <span className="status-chip status-chip--soft">算法推演可用 2 条</span>
                    <span className="status-chip status-chip--soft">批量线性摊销 1 组</span>
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
                  {[
                    ['Bond-UST2Y-EOD-20260421', '利率债短端', ['ok', 'ok', 'ok', 'ok'], '可入库'],
                    ['Bond-UST10Y-EOD-20260421', '当前选中来源', ['ok', 'ok', 'ok', 'ok'], '合格来源'],
                    ['Bond-UST30Y-EOD-20260421', '长端久期', ['ok', 'warn', 'ok', 'ok'], '算法推演'],
                    ['Bond-TIPS5Y-EOD-20260421', '实际利率短端', ['ok', 'ok', 'imputed', 'ok'], '已转就绪'],
                    ['Bond-IGCarry-AA-EOD-20260421', '信用债篮子', ['ok', 'danger', 'ok', 'ok'], '线性摊销'],
                  ].map(([id, label, cells, action]) => (
                    <div className="snapshots-bond-audit-row" key={id as string}>
                      <div className="snapshots-bond-audit-row__label">
                        <strong>{id}</strong>
                        <span>{label}</span>
                      </div>
                      {(cells as string[]).map((tone, index) => (
                        <div
                          className={`snapshots-bond-audit-cell snapshots-bond-audit-cell--${tone}`}
                          key={`${id}-${index}`}
                        >
                          {tone === 'ok' ? '✓' : tone === 'warn' ? '缺口' : tone === 'imputed' ? '推算' : '缺失'}
                        </div>
                      ))}
                      <div
                        className={`snapshots-bond-audit-cell snapshots-bond-audit-cell--action ${
                          action === '线性摊销'
                            ? 'snapshots-bond-audit-cell--danger'
                            : action === '算法推演'
                              ? 'snapshots-bond-audit-cell--warn'
                              : action === '已转就绪'
                                ? 'snapshots-bond-audit-cell--imputed'
                                : 'snapshots-bond-audit-cell--ok'
                        }`}
                      >
                        {action}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            </section>
          </div>

          <aside className="snapshots-bond-detail-rail">
            <section className="snapshots-bond-task-rail">
              <div className="snapshots-bond-task-rail__section">
                <div className="snapshots-bond-task-rail__header">
                  <div className="snapshots-bond-task-rail__heading">
                    <strong>系统诊断</strong>
                    <span>汇总映射异常、字段缺口与修复优先级，支持研究员安排当日处理顺序。</span>
                  </div>
                  <span
                    className="snapshots-bond-inline-tooltip"
                    title="系统诊断：将映射异常、缺失字段和专家建议做成绿黄红三类预警卡，帮助研究员快速决定是否继续入库。"
                  >
                    ?
                  </span>
                </div>
                <div className="snapshots-bond-diagnostic-list">
                  <article className="snapshots-bond-diagnostic-card snapshots-bond-diagnostic-card--warn">
                    <div className="snapshots-bond-diagnostic-card__top">
                      <strong>TIPS 映射</strong>
                      <span className="status-chip status-chip--warning">待核对</span>
                    </div>
                    <span>真实收益率与凸性字段已经到位，但显示口径仍要和快照字段口径再对一次。</span>
                  </article>
                  <article className="snapshots-bond-diagnostic-card snapshots-bond-diagnostic-card--danger">
                    <div className="snapshots-bond-diagnostic-card__top">
                      <strong>缺失应计利息</strong>
                      <span className="status-chip status-chip--danger">收益图锯齿风险</span>
                    </div>
                    <span>IG 这条腿当前不是小缺口。若不补齐，应计缺失会直接让后续收益图出现锯齿。</span>
                  </article>
                  <article className="snapshots-bond-diagnostic-card snapshots-bond-diagnostic-card--info">
                    <div className="snapshots-bond-diagnostic-card__top">
                      <strong>专家建议</strong>
                      <span className="status-chip status-chip--soft">优先顺序</span>
                    </div>
                    <span>先冻结 UST 10Y，再补齐 TIPS 和 IG。这样能在第一拍里先把债券底座可靠地跑通。</span>
                  </article>
                </div>
              </div>
            </section>
          </aside>
        </div>

        <section className="panel snapshots-bond-panel">
          <div className="panel-header snapshots-bond-panel__header">
            <div>
              <div className="snapshots-bond-title-row">
                <h3>原始快照与调度</h3>
                <span
                  className="snapshots-bond-inline-tooltip"
                  title="原始快照与调度：把底层快照登记、刷新任务、供应商延迟和自愈规则放在同一视图里闭环处理。"
                >
                  ?
                </span>
              </div>
              <p className="snapshots-panel-copy">联动查看原始快照登记、刷新任务与供应商调度，判断异常来源与恢复路径。</p>
            </div>
            <button className="ghost-button" type="button">
              批量重刷 2 个异常快照
            </button>
          </div>

          <div className="snapshots-bond-registry-layout">
            <div className="snapshots-bond-registry-stack">
              <article className="snapshots-bond-registry-row snapshots-bond-registry-row--active">
                <input type="checkbox" checked readOnly />
                <div>
                  <strong>Bond-UST10Y-EOD-20260421</strong>
                  <span>收益率曲线锚点 · 当前被选中</span>
                </div>
                <div>
                  <strong>字段</strong>
                  <span>[全价] [应计] [久期] [收益率] [凸性]</span>
                </div>
                <div>
                  <strong>调度</strong>
                  <span>FMP · 每日 21:05 香港时间（HKT）</span>
                </div>
                <div>
                  <strong>就绪</strong>
                  <span>可入库</span>
                </div>
              </article>
              <article className="snapshots-bond-registry-row">
                <input type="checkbox" readOnly />
                <div>
                  <strong>Bond-TIPS10Y-EOD-20260421</strong>
                  <span>实际利率对冲来源</span>
                </div>
                <div>
                  <strong>字段</strong>
                  <span>[全价] [应计] [久期] [真实收益率待核]</span>
                </div>
                <div>
                  <strong>调度</strong>
                  <span>Polygon · 每日 21:05 香港时间（HKT）</span>
                </div>
                <div className="snapshots-bond-progress-inline">
                  <strong>刷新中 45%</strong>
                  <div className="snapshots-bond-progress-bar">
                    <span style={{ width: '45%' }} />
                  </div>
                  <span>由批量重刷触发</span>
                </div>
              </article>
              <article className="snapshots-bond-registry-row">
                <input type="checkbox" readOnly />
                <div>
                  <strong>Bond-IGCarry-AA-EOD-20260421</strong>
                  <span>投资级信用债篮子</span>
                </div>
                <div>
                  <strong>字段</strong>
                  <span>[全价] [应计缺] [久期] [收益率] [凸性]</span>
                </div>
                <div>
                  <strong>调度</strong>
                  <span>FMP · 每日 21:05 香港时间（HKT）</span>
                </div>
                <div>
                  <strong>阻塞</strong>
                  <span>先修规则</span>
                </div>
              </article>
            </div>

            <div className="snapshots-bond-scheduler-stack">
              <article className="snapshots-bond-scheduler-card snapshots-bond-scheduler-card--accent">
                <strong>下次自动刷新</strong>
                <span>
                  今日 21:05 香港时间（HKT）启动刷新，先使用 FMP，异常时切换 Polygon；债券来源维持日终更新口径。
                </span>
                <div className="snapshots-bond-latency-row">
                  <span className="snapshots-bond-latency-pill snapshots-bond-latency-pill--live">FMP：实时</span>
                  <span className="snapshots-bond-latency-pill snapshots-bond-latency-pill--delay">Polygon：延迟 15 分钟</span>
                </div>
              </article>
              <article className="snapshots-bond-scheduler-card">
                <strong>供应商优先级</strong>
                <span>FMP 优先，Polygon 作为补充来源；优先选择可稳定返回到期收益率（YTM）与久期的供应商。</span>
              </article>
              <article className="snapshots-bond-scheduler-card">
                <strong>数据自愈规则</strong>
                <span>
                  缺应计时自动进入回补队列；若原始全价正常，则优先开放算法推演；若连续两次失败，则保留红格并阻止其进入资产腿来源清单。
                </span>
              </article>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

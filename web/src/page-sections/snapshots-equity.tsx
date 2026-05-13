import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { formatDateTime } from '../lib/format';
import type {
  ApiDataTrustLayer,
  ApiDatasetSnapshot,
  ApiDatasetSnapshotMetadata,
  ApiSnapshotOverview,
  ApiUniverseSnapshot,
} from '../types';

type EquitySnapshotsTabProps = {
  overview: ApiSnapshotOverview | null;
  onRefresh: () => void;
  refreshDisabled: boolean;
  refreshLabel: string;
  highlightTarget?: string;
};

type EquityFilter = 'all' | 'pending' | 'dataset' | 'universe';

type EquityRuntimeRow = {
  id: string;
  title: string;
  summary: string;
  fields: string;
  schedule: string;
  status: string;
  statusLabel: string;
  note: string;
  filter: Exclude<EquityFilter, 'all' | 'pending'>;
  available?: boolean;
  updatedAt?: string | null;
  sourceLabel?: string;
};

type BenchmarkEtfCoverageSummary = {
  ready: number;
  total: number;
  symbols: string[];
  missingSymbols: string[];
};

type CoverageChangeRow = {
  id: string;
  label: string;
  status: string;
  currentCoverage: string;
  change: string;
  remaining: string;
  source: string;
};

type SnapshotOverviewReadinessExtension = {
  data_layer_readiness?: unknown;
  snapshot_quality_alerts?: unknown;
  factor_dimension_readiness?: unknown;
};

type SnapshotLayerKey = 'l1' | 'l2' | 'l3' | 'l4';

type SnapshotLayerReadinessRecord = {
  layer_id?: string | null;
  title_cn?: string | null;
  status?: string | null;
  summary?: string | null;
  metrics?: unknown;
  updated_at?: string | null;
  provider_keys?: unknown;
  blockers?: unknown;
  linked_dimensions?: unknown;
  target?: string | null;
  legacy_context?: string | null;
  provider_hint?: string | null;
};

type SnapshotQualityAlertRecord = {
  code?: string | null;
  severity?: string | null;
  title_cn?: string | null;
  detail_cn?: string | null;
  source_layer?: string | null;
  blocking?: boolean | null;
  target?: string | null;
};

type FactorDimensionReadinessRecord = {
  dimension_id?: string | null;
  title_cn?: string | null;
  status?: string | null;
  supported_factors?: unknown;
  blockers?: unknown;
  linked_layers?: unknown;
  summary?: string | null;
  rationale_cn?: string | null;
  linked_snapshot_checks?: unknown;
};

type SnapshotMetricItem = {
  label: string;
  value: string;
};

type SnapshotLayerDisplay = {
  key: SnapshotLayerKey;
  layerId: string;
  title: string;
  status: string;
  statusLabel: string;
  statusTone: 'accent' | 'warning' | 'danger' | 'neutral' | 'info';
  summary: string;
  primaryMetric: SnapshotMetricItem;
  supportingMetrics: SnapshotMetricItem[];
  coverageLabel: string;
  updatedLabel: string;
  repairLabel: string;
  dimensionLabels: string[];
  providerLabel: string;
  providerKeys: string[];
  blockers: string[];
  target?: string;
  legacyContext: string;
};

type SnapshotQualityAlertDisplay = {
  code: string;
  severity: string;
  severityLabel: string;
  title: string;
  detail: string;
  sourceLabel: string;
  hardBlocking: boolean;
  target?: string;
};

type FactorDimensionDisplay = {
  id: string;
  title: string;
  status: string;
  statusLabel: string;
  statusTone: 'accent' | 'warning' | 'danger' | 'neutral' | 'info';
  summary: string;
  factors: string[];
  blockers: string[];
  linkedLayerTitles: string[];
};

type SnapshotLayerFallbackContext = {
  datasetCoverage: { covered: number; total: number };
  readyDatasetCount: number;
  datasetSnapshotCount: number;
  benchmarkCoverage: BenchmarkEtfCoverageSummary;
  availableBasketCount: number;
  basketCount: number;
  totalUniverseMembers: number;
  pendingCount: number;
  lastRefresh: string | null;
  basketReady: boolean;
};

const EQUITY_FILTERS: Array<{ id: EquityFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'pending', label: '仅看待补' },
  { id: 'dataset', label: '数据集快照' },
  { id: 'universe', label: '股票池快照' },
];

const TRUST_CREDENTIAL_DRAFT_STORAGE_KEY = 'gsl.snapshots.trustCredentialDrafts.v1';
const SNAPSHOT_CREDENTIAL_RESTART_REASON = 'snapshot provider credentials updated';

const COVERAGE_CHANGE_DATASET_LABELS: Record<string, string> = {
  'ds-price': '股票价格数据',
  'ds-corporate-actions': '公司行为数据',
  'ds-index-valuations': '指数估值数据',
};

const SNAPSHOT_LAYER_ORDER: SnapshotLayerKey[] = ['l1', 'l2', 'l3', 'l4'];

const SNAPSHOT_LAYER_COPY: Record<
  SnapshotLayerKey,
  {
    title: string;
    summary: string;
    coverageFallback: string;
    repairFallback: string;
    providerFallback: string;
    dimensions: string[];
    legacyContext: string;
    target: string;
    emptyStatus: string;
  }
> = {
  l1: {
    title: 'L1 基础行情',
    summary: '覆盖开高低收量、基准 ETF 与权益篮子的基础行情底座。',
    coverageFallback: '等待价格覆盖率',
    repairFallback: '按价格与成分股快照待补项处理',
    providerFallback: '以股票价格主链与公开补丁为主',
    dimensions: ['价格型', '基准对照'],
    legacyContext: '承接旧口径中的股票快照、指数与基准、权益篮子基础行情。',
    target: 'ds-price',
    emptyStatus: 'WARNING',
  },
  l2: {
    title: 'L2 财务截面',
    summary: '监控财报字段、发布日期对齐与点时可回放性。',
    coverageFallback: '等待财务截面契约',
    repairFallback: '待补 Publish Date、available_at 与恒等式校验',
    providerFallback: '待接入财务源与字段映射',
    dimensions: ['财务稳健性', '应计质量'],
    legacyContext: '承接后续 F-Score、应计质量、经营杠杆等财务因子入口。',
    target: 'ds-fundamentals',
    emptyStatus: 'DISABLED',
  },
  l3: {
    title: 'L3 分析师与情绪',
    summary: '监控一致预期、卖空与换手异常，判断情绪类因子是否可用。',
    coverageFallback: '等待情绪快照契约',
    repairFallback: '待补分析师样本数、卖空与换手稳定性',
    providerFallback: '待接入一致预期与卖空来源',
    dimensions: ['一致预期修正', '流动性偏差'],
    legacyContext: '承接分析师修正、非流动性溢价与情绪类异常监控。',
    target: 'ds-analyst-consensus',
    emptyStatus: 'DISABLED',
  },
  l4: {
    title: 'L4 宏观与衍生品',
    summary: '监控利率、宏观因子与期权偏度的计算就绪状态。',
    coverageFallback: '等待宏观与衍生品契约',
    repairFallback: '待补 FRED / 期权偏度与滚动回归校准',
    providerFallback: '待接入宏观序列与期权样本',
    dimensions: ['利率敏感度', '宏观暴露'],
    legacyContext: '承接利率 Beta、商品暴露与隐含波动偏度的治理入口。',
    target: 'macro-rate-beta',
    emptyStatus: 'DISABLED',
  },
};

function asSnapshotOverviewReadiness(
  overview: ApiSnapshotOverview | null,
): (ApiSnapshotOverview & SnapshotOverviewReadinessExtension) | null {
  return overview as (ApiSnapshotOverview & SnapshotOverviewReadinessExtension) | null;
}

function readRecordArray<T extends Record<string, unknown>>(value: unknown): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is T => Boolean(item) && typeof item === 'object');
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function localizeSnapshotTitle(id?: string | null, fallback?: string | null): string {
  const normalized = String(id ?? '').trim().toLowerCase();
  switch (normalized) {
    case 'ds-price':
      return '股票价格数据';
    case 'ds-corporate-actions':
      return '公司行为数据';
    case 'ds-index-valuations':
      return '指数估值数据';
    case 'ds-fundamentals':
      return '财务截面数据';
    case 'ds-analyst-consensus':
      return '一致预期数据';
    case 'ds-short-volume':
      return '卖空成交数据';
    case 'un-sp500':
      return '标普500';
    case 'un-ndx100':
      return '纳指100';
    default:
      return String(fallback ?? id ?? '').trim() || '未命名快照';
  }
}

function localizeMetricLabel(label: string): string {
  const normalized = label.trim().toLowerCase();
  switch (normalized) {
    case 'coverage':
    case 'covered':
    case 'coverage_pct':
      return '分层覆盖';
    case 'updated_at':
    case 'last_updated':
    case 'recent_time':
      return '最近时间';
    case 'repair':
    case 'pending':
    case 'blockers':
      return '待修复';
    case 'provider':
    case 'source':
      return '数据源';
    case 'credentials':
    case 'provider_keys':
      return '凭据';
    case 'landed_rows':
    case 'ingested_rows':
      return '入库';
    default:
      return label.trim() || '指标';
  }
}

function localizeFactorLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'f-score':
      return 'F-Score 财务稳健性';
    case 'accruals':
      return '应计质量';
    case 'operating leverage':
      return '经营杠杆';
    case 'analyst revision':
      return '一致预期修正';
    case 'illiquidity':
      return '非流动性溢价';
    case 'short interest':
      return '卖空拥挤度';
    case 'iv skew':
      return '隐含波动偏度';
    case 'rate duration':
      return '利率敏感度';
    case 'commodity beta':
      return '大宗商品 Beta';
    default:
      return value.trim();
  }
}

function normalizeSnapshotLayerKey(value?: string | null): SnapshotLayerKey | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === 'l1' || normalized.includes('market') || normalized.includes('price')) {
    return 'l1';
  }
  if (normalized === 'l2' || normalized.includes('fundamental') || normalized.includes('fmp') || normalized.includes('财务')) {
    return 'l2';
  }
  if (normalized === 'l3' || normalized.includes('sentiment') || normalized.includes('analyst') || normalized.includes('short')) {
    return 'l3';
  }
  if (normalized === 'l4' || normalized.includes('macro') || normalized.includes('derivative') || normalized.includes('theta') || normalized.includes('fred')) {
    return 'l4';
  }
  return null;
}

function layerKeyToTitle(layerKey: SnapshotLayerKey): string {
  return SNAPSHOT_LAYER_COPY[layerKey].title;
}

function statusTone(status?: string | null): SnapshotLayerDisplay['statusTone'] {
  switch (normalizeStatus(status)) {
    case 'OBSERVATION':
      return 'warning'; /*
      return '?弦?航?;
    */ case 'READY':
    case 'COMPLETED':
    case 'VERIFIED':
      return 'accent';
    case 'BLOCKED':
    case 'FAILED':
      return 'danger';
    case 'CALIBRATING':
    case 'SANDBOX':
      return 'info';
    case 'WARNING':
    case 'INCOMPLETE':
      return 'warning';
    case 'DISABLED':
      return 'neutral';
    default:
      return 'warning';
  }
}

function getFactorStatusLabel(status?: string | null): string {
  switch (normalizeStatus(status)) {
    case 'VERIFIED':
      return '已验证';
    case 'SANDBOX':
      return '沙箱观察';
    case 'BLOCKED':
      return '阻断';
    case 'DISABLED':
      return '未接入';
    case 'CALIBRATING':
      return '校准中';
    case 'READY':
    case 'COMPLETED':
      return '已就绪';
    case 'WARNING':
    case 'INCOMPLETE':
      return '需复核';
    default:
      return '待补齐';
  }
}

function getAlertSeverityLabel(severity?: string | null, hardBlocking?: boolean | null): string {
  if (hardBlocking) {
    return '硬阻断';
  }
  switch (String(severity ?? '').trim().toLowerCase()) {
    case 'danger':
    case 'error':
      return '高优先级';
    case 'info':
      return '观察项';
    default:
      return '需复核';
  }
}

function formatUnknownMetricValue(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toLocaleString('zh-HK');
  }
  if (typeof value === 'boolean') {
    return value ? '是' : '否';
  }
  if (value === null || value === undefined) {
    return '暂无';
  }
  return String(value).trim() || '暂无';
}

function readMetricItems(value: unknown): SnapshotMetricItem[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }
        const record = entry as Record<string, unknown>;
        const label = record.label ?? record.title_cn ?? record.key;
        const metricValue = record.value ?? record.metric_value ?? record.summary;
        if (!label || metricValue === undefined) {
          return null;
        }
        return {
          label: localizeMetricLabel(String(label)),
          value: formatUnknownMetricValue(metricValue),
        };
      })
      .filter((entry): entry is SnapshotMetricItem => Boolean(entry));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([label, metricValue]) => ({
        label: localizeMetricLabel(label),
        value: formatUnknownMetricValue(metricValue),
      }))
      .filter((entry) => entry.value !== '暂无');
  }
  return [];
}

function compactDateTimeLabel(value?: string | null): string {
  if (!value) {
    return '暂无';
  }
  return formatDateTime(value);
}

function normalizeStatus(status?: string | null): string {
  return String(status ?? 'PENDING').toUpperCase();
}

function isReadyStatus(status?: string | null): boolean {
  return ['READY', 'COMPLETED'].includes(normalizeStatus(status));
}

function isPendingStatus(status?: string | null): boolean {
  return !isReadyStatus(status);
}

function getStatusLabel(status?: string | null): string {
  switch (normalizeStatus(status)) {
    case 'READY':
    case 'COMPLETED':
      return '就绪';
    case 'VERIFIED':
      return '已验证';
    case 'WARNING':
      return '需复核';
    case 'RUNNING':
      return '刷新中';
    case 'STALE':
      return '需复核';
    case 'CALIBRATING':
      return '校准中';
    case 'INCOMPLETE':
      return '待补';
    case 'DISABLED':
      return '未接入';
    case 'SANDBOX':
      return '沙箱观察';
    case 'FAILED':
    case 'BLOCKED':
      return '阻塞';
    default:
      return '待刷新';
  }
}

function getTrustStatusLabel(status?: string | null): string {
  switch (String(status ?? '').toLowerCase()) {
    case 'usable':
      return '可用';
    case 'enabled':
      return '已启用';
    case 'missing_credentials':
      return '缺凭据';
    case 'blocked':
      return '阻塞';
    case 'registered':
      return '已登记';
    default:
      return '待配置';
  }
}

function trustStatusChipClassName(status?: string | null): string {
  const normalized = String(status ?? '').toLowerCase();
  if (normalized === 'usable' || normalized === 'enabled') {
    return 'status-chip status-chip--success';
  }
  if (normalized === 'missing_credentials' || normalized === 'blocked') {
    return 'status-chip status-chip--warning';
  }
  return 'status-chip status-chip--soft';
}

type TrustLayerDisplayCopy = {
  label: string;
  role: string;
  scope: string;
  boundary: string;
  actionFallback: string;
};

const TRUST_LAYER_DISPLAY_COPY: Record<string, TrustLayerDisplayCopy> = {
  price_primary_chain: {
    label: '价格主链',
    role: '复权日线与价格缺口修复',
    scope: '开高低收量、复权收盘、缺口补价',
    boundary: '不能替代成员历史、公司行动或身份确权。',
    actionFallback: '优先补齐 Tiingo；用于价格缺口第一轮修复。',
  },
  membership_history: {
    label: '成分股历史',
    role: '指数成员进出日期',
    scope: '历史成分、生效日、退出日',
    boundary: '只证明样本池，不能补价格或公司行动。',
    actionFallback: '优先补齐 FMP 历史成分；用于点时样本池门禁。',
  },
  delisted_identity: {
    label: '退市与身份',
    role: 'Ticker 生命周期与 CIK 确权',
    scope: 'CIK、退市身份、标准代码映射',
    boundary: '不提供价格，也不能把停止申报直接等同破产。',
    actionFallback: '补齐 SEC User-Agent 或身份源后生成生命周期证据。',
  },
  corporate_actions_zero_event: {
    label: '公司行动',
    role: '分红拆股与零事件证书',
    scope: '分红、拆股、无事件证明上下文',
    boundary: '公司行动缺口必须由事件源或零事件证书关闭。',
    actionFallback: '优先使用 Tiingo/Alpha Vantage；必要时用身份与价格结果交叉确证。',
  },
  long_history_patch: {
    label: '长周期补价',
    role: '老旧与退市价格补丁',
    scope: '长周期日线、退市价格候选、本地缓存',
    boundary: '仅修复价格缺口，不能单独通过正式就绪门禁。',
    actionFallback: '优先离线缓存；需要在线 Stooq 时显式开启本机开关。',
  },
  precision_repair: {
    label: '关键精修',
    role: '付费源关键缺口补证',
    scope: '高精度价格、公司行动、身份交叉验证',
    boundary: '只用于免费链无法闭合的关键标的。',
    actionFallback: '配置 Polygon 后用于关键缺口精修，不作为默认免费链。',
  },
};

function trustLayerDisplayCopy(layer: ApiDataTrustLayer): TrustLayerDisplayCopy {
  return (
    TRUST_LAYER_DISPLAY_COPY[String(layer.id ?? '')] ?? {
      label: layer.label || '证据层',
      role: layer.role || '数据源可用性与证据边界',
      scope: '覆盖范围、最近尝试、凭据状态',
      boundary: '需结合价格、成员历史、公司行动和身份映射判断。',
      actionFallback: '查看最近尝试与缺失凭据后再决定修复动作。',
    }
  );
}

function trustLayerProviderLine(layer: ApiDataTrustLayer, usableCount: number, providerCount: number): string {
  const preferredProvider = formatEquitySourceLabel(layer.preferred_provider || layer.provider_ids?.[0]);
  const providerIds =
    Array.isArray(layer.provider_ids) && layer.provider_ids.length
      ? layer.provider_ids
      : Array.isArray(layer.registered_provider_ids)
        ? layer.registered_provider_ids
        : [];
  const providerChain = providerIds
    .map((providerId) => formatEquitySourceLabel(providerId))
    .filter((label) => label.length > 0)
    .join(' → ');
  if (providerChain && providerChain !== preferredProvider) {
    return `优先级：${providerChain} · 可用 ${usableCount}/${providerCount}`;
  }
  return `主源：${preferredProvider} · 可用 ${usableCount}/${providerCount}`;
}

function trustLayerActionLine(layer: ApiDataTrustLayer, missingEnv: string[], display: TrustLayerDisplayCopy): string {
  if (missingEnv.length) {
    return `待配置：${missingEnv.join('、')}`;
  }
  const operatorAction = typeof layer.operator_action === 'string' ? layer.operator_action.trim() : '';
  if (operatorAction) {
    return operatorAction;
  }
  return display.actionFallback;
}

function readCredentialDraftsFromSession(): Record<string, string> {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const raw = window.sessionStorage.getItem(TRUST_CREDENTIAL_DRAFT_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([envName, value]) => envName && typeof value === 'string')
        .map(([envName, value]) => [envName, value as string]),
    );
  } catch {
    return {};
  }
}

function writeCredentialDraftsToSession(drafts: Record<string, string>): void {
  if (typeof window === 'undefined') {
    return;
  }
  const cleaned = Object.fromEntries(
    Object.entries(drafts)
      .map(([envName, value]) => [envName, String(value ?? '').trim()] as const)
      .filter(([envName, value]) => envName && value),
  );
  try {
    if (Object.keys(cleaned).length) {
      window.sessionStorage.setItem(TRUST_CREDENTIAL_DRAFT_STORAGE_KEY, JSON.stringify(cleaned));
    } else {
      window.sessionStorage.removeItem(TRUST_CREDENTIAL_DRAFT_STORAGE_KEY);
    }
  } catch {
    // Browser storage can be disabled; keep the in-memory draft for the current render.
  }
}

function credentialInputType(envName: string): 'password' | 'text' {
  return envName === 'SEC_USER_AGENT' ? 'text' : 'password';
}

function credentialPlaceholder(envName: string): string {
  if (envName === 'SEC_USER_AGENT') {
    return '例如 GSL local ops contact@example.com';
  }
  if (envName === 'GRIT_ENABLE_STOOQ_ONLINE') {
    return '1';
  }
  return `输入 ${envName}`;
}

function quotePowerShellEnvValue(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildPowerShellPersistCredentialCommands(envName: string, value: string): string[] {
  const quotedEnvName = quotePowerShellEnvValue(envName);
  const quotedValue = quotePowerShellEnvValue(value);
  return [
    `[Environment]::SetEnvironmentVariable(${quotedEnvName}, ${quotedValue}, 'User')`,
    `[Environment]::SetEnvironmentVariable(${quotedEnvName}, ${quotedValue}, 'Process')`,
  ];
}

async function writeTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Restricted local browsers can reject navigator.clipboard even after a user click.
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand?.('copy') === true;
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

function statusChipClassName(status?: string | null): string {
  switch (statusTone(status)) {
    case 'danger':
      return 'status-chip status-chip--danger';
    case 'accent':
      return 'status-chip status-chip--success';
    case 'info':
      return 'status-chip status-chip--info';
    case 'neutral':
      return 'status-chip status-chip--soft';
    default:
      return 'status-chip status-chip--warning';
  }
}

function metricCardClassName(tone: SnapshotLayerDisplay['statusTone']): string {
  switch (tone) {
    case 'danger':
      return 'metric-card metric-card--danger';
    case 'accent':
      return 'metric-card metric-card--accent';
    case 'info':
      return 'metric-card metric-card--info';
    case 'neutral':
      return 'metric-card metric-card--neutral';
    default:
      return 'metric-card metric-card--warning';
  }
}

function alertCardClassName(alert: SnapshotQualityAlertDisplay): string {
  if (alert.hardBlocking) {
    return 'snapshots-alert-card snapshots-alert-card--danger';
  }
  if (alert.severity === 'info') {
    return 'snapshots-alert-card snapshots-alert-card--info';
  }
  return 'snapshots-alert-card snapshots-alert-card--warning';
}

function formatCount(value?: number | null): string {
  return typeof value === 'number' ? value.toLocaleString('zh-HK') : '0';
}

function formatPercent(ready: number, total: number): string {
  if (total <= 0) {
    return '0%';
  }
  const value = (ready / total) * 100;
  return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)}%`;
}

function formatReadyPercent(ready: number, total: number): string {
  return `${formatPercent(ready, total)} 就绪`;
}

function formatCoveragePercent(covered: number, total: number): string {
  return `${formatPercent(covered, total)} 覆盖`;
}

function formatAvailablePercent(ready: number, total: number): string {
  return `${formatPercent(ready, total)} 可用`;
}

function formatMarketRefreshTime(value?: string | null): string {
  if (!value) {
    return '暂无';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '暂无';
  }
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/New_York',
  }).format(date);
}

function formatEquitySourceLabel(value?: string | null): string {
  const text = String(value ?? '').trim();
  switch (text.toLowerCase()) {
    case 'mixed_sources':
      return '多来源汇总';
    case 'official_announcement':
      return '官方公告';
    case 'wikipedia_revision_history':
      return '历史修订记录';
    case 'nasdaq_official_annual_changes':
      return '纳斯达克年度成分记录';
    case 'sec_edgar':
      return 'SEC EDGAR / CIK';
    case 'alpha_vantage':
      return 'Alpha Vantage';
    case 'tiingo':
      return 'Tiingo';
    case 'fmp':
      return 'Financial Modeling Prep';
    case 'finnhub':
      return 'Finnhub 身份校验';
    case 'fmp_historical_constituent':
      return 'FMP 历史成分';
    case 'stooq':
      return 'Stooq 长周期价格';
    case 'nasdaq_wiki':
      return 'Nasdaq WIKI 历史价格';
    case 'kaggle_huge_stock_market_dataset':
      return 'Kaggle 批量价格';
    case 'kaggle_delisted_bulk_archive':
      return 'Kaggle 退市价格';
    case 'polygon':
      return 'Polygon 精修';
    case 'tiingo_symbology':
      return 'Tiingo 身份映射';
    case 'openbb_yfinance':
      return 'OpenBB Yahoo 行情';
    case 'openbb_tiingo':
      return 'OpenBB Tiingo 行情';
    case 'openbb_alpha_vantage':
      return 'OpenBB Alpha Vantage 修复';
    case 'openbb_fmp':
      return 'OpenBB FMP 行情';
    case 'openbb_index_constituents':
      return 'OpenBB 当前成分校验';
    case 'yahoo':
    case 'yfinance':
      return 'Yahoo';
    case 'manual':
    case 'manual_override':
      return '人工补录';
    default:
      return text ? text.replace(/_/g, ' ') : '未声明';
  }
}

function getMetadata(item: ApiDatasetSnapshot | ApiUniverseSnapshot): Record<string, unknown> {
  return item.metadata && typeof item.metadata === 'object'
    ? (item.metadata as Record<string, unknown>)
    : {};
}

function getNumber(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getStringList(metadata: Record<string, unknown>, key: string): string[] {
  const value = metadata[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

function getCoverageCounts(item: ApiDatasetSnapshot): { covered: number; total: number } | null {
  const metadata = getMetadata(item);
  const covered = getNumber(metadata, 'covered_symbol_count');
  const total = getNumber(metadata, 'total_symbol_count');
  if (covered === null || total === null || total <= 0) {
    return null;
  }
  return { covered, total };
}

function getBenchmarkEtfCoverage(datasetSnapshots: ApiDatasetSnapshot[]): BenchmarkEtfCoverageSummary {
  const priceSnapshot = datasetSnapshots.find((item) => item.id === 'ds-price');
  const metadata = (priceSnapshot?.metadata ?? {}) as ApiDatasetSnapshotMetadata;
  const coverage = metadata.benchmark_etf_coverage;
  const rawSymbols = Array.isArray(coverage?.symbols) ? coverage.symbols : [];
  const symbolRows = rawSymbols
    .map((item) => ({
      symbol: String(item?.symbol ?? '').trim().toUpperCase(),
      status: normalizeStatus(item?.status),
    }))
    .filter((item) => item.symbol.length > 0);
  const total =
    typeof coverage?.total_count === 'number' && Number.isFinite(coverage.total_count)
      ? coverage.total_count
      : symbolRows.length;
  const ready =
    typeof coverage?.ready_count === 'number' && Number.isFinite(coverage.ready_count)
      ? coverage.ready_count
      : symbolRows.filter((item) => isReadyStatus(item.status)).length;
  const missingSymbols = Array.isArray(coverage?.missing_symbols)
    ? coverage.missing_symbols.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : symbolRows.filter((item) => !isReadyStatus(item.status)).map((item) => item.symbol);

  return {
    ready,
    total,
    symbols: symbolRows.map((item) => item.symbol),
    missingSymbols,
  };
}

function getRefreshStats(overview: ApiSnapshotOverview | null): Record<string, unknown> {
  const summary = overview?.latest_job?.summary;
  if (!summary || typeof summary !== 'object') {
    return {};
  }
  const refreshStats = (summary as Record<string, unknown>).refresh_stats;
  return refreshStats && typeof refreshStats === 'object' ? (refreshStats as Record<string, unknown>) : {};
}

function getNestedRecord(source: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = source[key];
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function getDatasetRefreshStat(
  refreshStats: Record<string, unknown>,
  snapshotId: string,
): Record<string, unknown> | null {
  const datasets = getNestedRecord(refreshStats, 'datasets');
  const item = datasets?.[snapshotId];
  return item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
}

function getPositiveCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function formatDatasetRefreshDelta(
  stat: Record<string, unknown> | null,
  label: string,
): string | null {
  const rows = getPositiveCount(stat?.updated_row_count);
  const symbols = getPositiveCount(stat?.updated_symbol_count);
  if (!rows && !symbols) {
    return null;
  }
  if (rows && symbols) {
    return `${label} ${rows.toLocaleString('zh-HK')} 行 / ${symbols.toLocaleString('zh-HK')} 标的`;
  }
  if (rows) {
    return `${label} ${rows.toLocaleString('zh-HK')} 行`;
  }
  return `${label} ${symbols?.toLocaleString('zh-HK')} 标的`;
}

function formatRefreshChange(stat: Record<string, unknown> | null): string {
  const rows = getPositiveCount(stat?.updated_row_count);
  const symbols = getPositiveCount(stat?.updated_symbol_count);
  if (!rows && !symbols) {
    return '本次未新增';
  }
  if (rows && symbols) {
    return `${rows.toLocaleString('zh-HK')} 行 / ${symbols.toLocaleString('zh-HK')} 标的`;
  }
  if (rows) {
    return `${rows.toLocaleString('zh-HK')} 行`;
  }
  return `${symbols?.toLocaleString('zh-HK')} 标的`;
}

function summarizeTopProviders(providerSummary: unknown, fallbackSource?: string | null): string {
  const summary = providerSummary && typeof providerSummary === 'object'
    ? (providerSummary as Record<string, unknown>)
    : null;
  const providers = summary?.providers && typeof summary.providers === 'object'
    ? (summary.providers as Record<string, Record<string, unknown>>)
    : null;
  const landed = Object.entries(providers ?? {})
    .map(([providerId, item]) => ({
      providerId,
      rows: getPositiveCount(item?.landed_row_count) ?? 0,
      symbols: getPositiveCount(item?.landed_symbol_count) ?? 0,
      quotaLimited: Boolean(item?.quota_limited),
    }))
    .filter((item) => item.rows > 0 || item.symbols > 0)
    .sort((left, right) => right.rows - left.rows || right.symbols - left.symbols)
    .slice(0, 2);

  if (landed.length) {
    return landed
      .map((item) => {
        const detail = item.rows > 0
          ? `${item.rows.toLocaleString('zh-HK')} 行`
          : `${item.symbols.toLocaleString('zh-HK')} 标的`;
        return `${formatEquitySourceLabel(item.providerId)} ${detail}${item.quotaLimited ? '，配额受限' : ''}`;
      })
      .join('；');
  }
  return fallbackSource ? formatEquitySourceLabel(fallbackSource) : '暂无新增入库来源';
}

function formatDatasetCoverage(item: ApiDatasetSnapshot): string {
  const counts = getCoverageCounts(item);
  if (counts) {
    return `${formatCount(counts.covered)} / ${formatCount(counts.total)} 标的`;
  }
  const metadata = getMetadata(item);
  const proxyKeys = getStringList(metadata, 'proxy_keys');
  if (proxyKeys.length) {
    return `${formatCount(proxyKeys.length)} 个代理 / ${formatCount(item.row_count ?? 0)} 条观测`;
  }
  return `${formatCount(item.row_count ?? 0)} 行`;
}

function formatDatasetRemaining(item: ApiDatasetSnapshot): string {
  const counts = getCoverageCounts(item);
  if (!counts) {
    return item.status === 'READY' ? '无待补' : '等待刷新';
  }
  const missing = Math.max(0, counts.total - counts.covered);
  if (!missing) {
    return '无待补';
  }
  if (item.id === 'ds-corporate-actions') {
    const metadata = getMetadata(item);
    const formalEvents = getNumber(metadata, 'formal_event_symbol_count');
    const noEvents = getNumber(metadata, 'complete_no_events_symbol_count');
    const parts = [
      formalEvents !== null ? `正式事件 ${formatCount(formalEvents)}` : null,
      noEvents !== null ? `无事件确认 ${formatCount(noEvents)}` : null,
    ].filter(Boolean);
    return `${formatCount(missing)} 标的待补${parts.length ? `；${parts.join(' / ')}` : ''}`;
  }
  return `${formatCount(missing)} 标的待补`;
}

function formatUniverseCoverage(item: ApiUniverseSnapshot): string {
  const metadata = getMetadata(item);
  const historical = getNumber(metadata, 'historical_anchor_count');
  const anchors = getNumber(metadata, 'anchor_count');
  if (historical !== null && anchors !== null && anchors > 0) {
    return `${formatCount(historical)} / ${formatCount(anchors)} 历史锚点`;
  }
  return `${formatCount(item.member_count ?? 0)} 成分`;
}

function formatUniverseChange(stat: Record<string, unknown> | null): string {
  const anchorDelta = getPositiveCount(stat?.historical_anchor_delta);
  const rows = getPositiveCount(stat?.updated_row_count);
  if (anchorDelta && rows) {
    return `${anchorDelta.toLocaleString('zh-HK')} 个锚点 / ${rows.toLocaleString('zh-HK')} 行`;
  }
  if (anchorDelta) {
    return `${anchorDelta.toLocaleString('zh-HK')} 个锚点`;
  }
  if (rows) {
    return `${rows.toLocaleString('zh-HK')} 行`;
  }
  return '本次未新增';
}

function formatUniverseRemaining(item: ApiUniverseSnapshot): string {
  const metadata = getMetadata(item);
  const historical = getNumber(metadata, 'historical_anchor_count');
  const anchors = getNumber(metadata, 'anchor_count');
  if (historical !== null && anchors !== null && anchors > 0) {
    const missing = Math.max(0, anchors - historical);
    return missing ? `${formatCount(missing)} 个历史锚点待补` : '无待补';
  }
  return item.status === 'READY' ? '无待补' : '等待刷新';
}

function buildCoverageChangeRows(overview: ApiSnapshotOverview | null): CoverageChangeRow[] {
  const refreshStats = getRefreshStats(overview);
  const datasetOrder = ['ds-price', 'ds-corporate-actions', 'ds-index-valuations'];
  const universeOrder = ['un-sp500', 'un-ndx100'];
  const datasetRows = datasetOrder
    .map((snapshotId) => {
      const item = overview?.dataset_snapshots.find((candidate) => candidate.id === snapshotId);
      if (!item) return null;
      const stat = getDatasetRefreshStat(refreshStats, snapshotId);
      return {
        id: item.id,
        label: COVERAGE_CHANGE_DATASET_LABELS[item.id] ?? localizeSnapshotTitle(item.id, item.name),
        status: getStatusLabel(item.status),
        currentCoverage: formatDatasetCoverage(item),
        change: formatRefreshChange(stat),
        remaining: formatDatasetRemaining(item),
        source: summarizeTopProviders(
          stat?.provider_summary ?? item.metadata?.provider_summary,
          item.source || item.fallback_source,
        ),
      };
    })
    .filter((item): item is CoverageChangeRow => Boolean(item));

  const universes = getNestedRecord(refreshStats, 'universes');
  const universeRows = universeOrder
    .map((snapshotId) => {
      const item = overview?.universe_snapshots.find((candidate) => candidate.id === snapshotId);
      if (!item) return null;
      const stat = universes?.[snapshotId] && typeof universes[snapshotId] === 'object'
        ? (universes[snapshotId] as Record<string, unknown>)
        : null;
      return {
        id: item.id,
        label: `${localizeSnapshotTitle(item.id, item.name)}股票池`,
        status: getStatusLabel(item.status),
        currentCoverage: formatUniverseCoverage(item),
        change: formatUniverseChange(stat),
        remaining: formatUniverseRemaining(item),
        source: summarizeTopProviders(
          stat?.provider_summary ?? item.metadata?.provider_summary,
          item.source || item.fallback_source,
        ),
      };
    })
    .filter((item): item is CoverageChangeRow => Boolean(item));

  return [...datasetRows, ...universeRows];
}

function formatLatestRefreshDelta(overview: ApiSnapshotOverview | null): string {
  const refreshStats = getRefreshStats(overview);
  const parts = [
    formatDatasetRefreshDelta(getDatasetRefreshStat(refreshStats, 'ds-price'), '股票价格数据'),
    formatDatasetRefreshDelta(getDatasetRefreshStat(refreshStats, 'ds-corporate-actions'), '公司行为数据'),
    formatDatasetRefreshDelta(getDatasetRefreshStat(refreshStats, 'ds-index-valuations'), '指数估值数据'),
  ].filter((item): item is string => Boolean(item));

  return parts.length ? `本次新增 ${parts.join(' · ')}` : '本次新增 0 行';
}

function translateSnapshotNote(raw?: string | null): string | null {
  const text = String(raw ?? '').trim();
  if (!text) {
    return null;
  }
  if (
    text.startsWith('Corporate action data is partially available') ||
    text.startsWith('Corporate action snapshot is still incomplete')
  ) {
    return '公司行为数据已部分可用，仍有少量公司事件待继续补齐。';
  }
  if (text.startsWith('Price snapshot is still incomplete')) {
    return '股票价格数据已部分可用，仍有少量股票待继续补齐。';
  }
  if (text.startsWith('Universe history is partially available')) {
    return '股票池历史成分已部分可用，仍有部分历史锚点待继续补齐。';
  }
  if (text.startsWith('Historical anchors are complete')) {
    return '历史锚点已完整，可继续作为股票池基准。';
  }
  if (text.startsWith('runtime snapshot repository')) {
    return '来自当前快照仓库';
  }
  if (text.startsWith('runtime universe snapshot repository')) {
    return '来自当前股票池快照仓库';
  }
  return text;
}

function describeDataset(item: ApiDatasetSnapshot): EquityRuntimeRow {
  const metadata = getMetadata(item);
  const covered = getNumber(metadata, 'covered_symbol_count');
  const total = getNumber(metadata, 'total_symbol_count');
  const missing = getStringList(metadata, 'missing_symbols');
  const coverage =
    covered !== null && total !== null && total > 0
      ? `${formatCount(covered)} / ${formatCount(total)} 覆盖`
      : `${formatCount(item.row_count)} 行`;
  const note = item.blocker?.message
    ? translateSnapshotNote(item.blocker.message) ?? item.blocker.message
    : missing.length
      ? `仍有 ${formatCount(missing.length)} 个 symbol 待补`
      : translateSnapshotNote(item.freshness_label) ?? item.freshness_label ?? '来自当前快照仓库';

  return {
    id: item.id,
    title: localizeSnapshotTitle(item.id, item.name),
    summary: `${item.id} · ${coverage}`,
    fields: `窗口 ${item.start_date ?? '未知'} 至 ${item.end_date ?? '未知'}`,
    schedule: `来源 ${formatEquitySourceLabel(item.source || item.fallback_source)}`,
    status: item.status,
    statusLabel: getStatusLabel(item.status),
    note,
    filter: 'dataset',
    available: isReadyStatus(item.status),
    updatedAt: item.as_of ?? null,
    sourceLabel: formatEquitySourceLabel(item.source || item.fallback_source),
  };
}

function describeUniverse(item: ApiUniverseSnapshot): EquityRuntimeRow {
  const metadata = getMetadata(item);
  const historical = getNumber(metadata, 'historical_anchor_count');
  const anchors = getNumber(metadata, 'anchor_count');
  const missingAnchors = getStringList(metadata, 'official_seed_missing_anchors');
  const hasConstituentMembers = (item.member_count ?? 0) > 0;
  const coverage =
    historical !== null && anchors !== null && anchors > 0
      ? `${formatCount(historical)} / ${formatCount(anchors)} 锚点`
      : `${formatCount(item.member_count)} 成分`;
  const note = item.blocker?.message
    ? translateSnapshotNote(item.blocker.message) ?? item.blocker.message
    : missingAnchors.length
      ? `仍有 ${formatCount(missingAnchors.length)} 个历史锚点待补`
      : translateSnapshotNote(item.freshness_label) ?? item.freshness_label ?? '来自当前股票池快照仓库';

  return {
    id: item.id,
    title: localizeSnapshotTitle(item.id, item.name),
    summary: `${item.id} · ${coverage}`,
    fields: `窗口 ${item.window_start ?? '未知'} 至 ${item.window_end ?? '未知'}`,
    schedule: `来源 ${formatEquitySourceLabel(item.source || item.fallback_source)}`,
    status: item.status,
    statusLabel: getStatusLabel(item.status),
    note,
    filter: 'universe',
    available: hasConstituentMembers || isReadyStatus(item.status),
    updatedAt: item.as_of ?? null,
    sourceLabel: formatEquitySourceLabel(item.source || item.fallback_source),
  };
}

function shouldShowRow(row: EquityRuntimeRow, activeFilter: EquityFilter): boolean {
  if (activeFilter === 'all') {
    return true;
  }
  if (activeFilter === 'pending') {
    return isPendingStatus(row.status);
  }
  return row.filter === activeFilter;
}

function filterButtonClassName(filter: EquityFilter, activeFilter: EquityFilter): string {
  return `filter-chip ${filter === activeFilter ? 'filter-chip--active' : ''}`.trim();
}

function isEquityBasketRow(row: EquityRuntimeRow): boolean {
  const searchable = `${row.id} ${row.title} ${row.summary}`.toLowerCase();
  return searchable.includes('basket') || searchable.includes('theme') || searchable.includes('etf') || searchable.includes('篮子');
}

function buildFallbackLayerMetrics(
  layerKey: SnapshotLayerKey,
  overview: ApiSnapshotOverview | null,
  context: SnapshotLayerFallbackContext,
): SnapshotMetricItem[] {
  const copy = SNAPSHOT_LAYER_COPY[layerKey];
  if (layerKey === 'l1') {
    const coverage =
      context.datasetCoverage.total > 0
        ? `${formatCoveragePercent(context.datasetCoverage.covered, context.datasetCoverage.total)}`
        : formatReadyPercent(context.readyDatasetCount, context.datasetSnapshotCount);
    return [
      { label: '分层覆盖', value: coverage },
      { label: '最近时间', value: compactDateTimeLabel(context.lastRefresh) },
      { label: '入库与待修复', value: context.pendingCount ? `${context.pendingCount} 项待修复` : '入库稳定' },
      {
        label: '数据源与凭据',
        value: overview?.dataset_snapshots[0]?.source
          ? formatEquitySourceLabel(overview.dataset_snapshots[0].source)
          : copy.providerFallback,
      },
    ];
  }
  return [
    { label: '分层覆盖', value: copy.coverageFallback },
    { label: '最近时间', value: compactDateTimeLabel(context.lastRefresh) },
    { label: '入库与待修复', value: copy.repairFallback },
    { label: '数据源与凭据', value: copy.providerFallback },
  ];
}

function buildSnapshotLayerDisplays(
  overview: ApiSnapshotOverview | null,
  context: SnapshotLayerFallbackContext,
): SnapshotLayerDisplay[] {
  const extension = asSnapshotOverviewReadiness(overview);
  const rawItems = readRecordArray<SnapshotLayerReadinessRecord>(extension?.data_layer_readiness);
  const rawByLayer = new Map<SnapshotLayerKey, SnapshotLayerReadinessRecord>();
  rawItems.forEach((item) => {
    const layerKey = normalizeSnapshotLayerKey(item.layer_id);
    if (layerKey) {
      rawByLayer.set(layerKey, item);
    }
  });

  return SNAPSHOT_LAYER_ORDER.map((layerKey) => {
    const fallback = SNAPSHOT_LAYER_COPY[layerKey];
    const rawItem = rawByLayer.get(layerKey);
    const metrics = rawItem ? readMetricItems(rawItem.metrics).slice(0, 4) : [];
    const fallbackMetrics = buildFallbackLayerMetrics(layerKey, overview, context);
    const mergedMetrics = metrics.length ? metrics : fallbackMetrics;
    const primaryMetric = mergedMetrics[0] ?? { label: '状态', value: getStatusLabel(rawItem?.status ?? fallback.emptyStatus) };
    const supportingMetrics = mergedMetrics.slice(1, 4);
    const providerKeys = readStringArray(rawItem?.provider_keys);
    const blockers = readStringArray(rawItem?.blockers);
    const dimensionLabels = readStringArray(rawItem?.linked_dimensions).map(localizeFactorLabel);
    const status = rawItem?.status ?? fallback.emptyStatus;
    const providerLabel = providerKeys.length
      ? `待配置 ${providerKeys.join('、')}`
      : rawItem?.provider_hint?.trim() || fallback.providerFallback;

    return {
      key: layerKey,
      layerId: rawItem?.layer_id ?? layerKey,
      title: rawItem?.title_cn?.trim() || fallback.title,
      status,
      statusLabel: getStatusLabel(status),
      statusTone: statusTone(status),
      summary: rawItem?.summary?.trim() || fallback.summary,
      primaryMetric,
      supportingMetrics,
      coverageLabel:
        mergedMetrics.find((metric) => metric.label.includes('覆盖'))?.value ?? fallback.coverageFallback,
      updatedLabel:
        compactDateTimeLabel(rawItem?.updated_at ?? context.lastRefresh),
      repairLabel:
        blockers[0] ??
        mergedMetrics.find((metric) => metric.label.includes('待修复') || metric.label.includes('阻断'))?.value ??
        fallback.repairFallback,
      dimensionLabels: dimensionLabels.length ? dimensionLabels : fallback.dimensions,
      providerLabel,
      providerKeys,
      blockers,
      target: rawItem?.target ?? fallback.target,
      legacyContext: rawItem?.legacy_context?.trim() || fallback.legacyContext,
    };
  });
}

function buildSnapshotAlertDisplays(
  overview: ApiSnapshotOverview | null,
  rows: EquityRuntimeRow[],
): SnapshotQualityAlertDisplay[] {
  const extension = asSnapshotOverviewReadiness(overview);
  const rawAlerts = readRecordArray<SnapshotQualityAlertRecord>(extension?.snapshot_quality_alerts);
  if (rawAlerts.length) {
    return rawAlerts.map((alert, index) => {
      const severity = String(alert.severity ?? '').trim().toLowerCase();
      const layerKey = normalizeSnapshotLayerKey(alert.source_layer);
      return {
        code: alert.code?.trim() || `alert-${index + 1}`,
        severity,
        severityLabel: getAlertSeverityLabel(severity, alert.blocking),
        title: alert.title_cn?.trim() || '异常告警',
        detail: alert.detail_cn?.trim() || '请复核该层级快照的最新异常。',
        sourceLabel: layerKey ? layerKeyToTitle(layerKey) : '治理异常',
        hardBlocking: Boolean(alert.blocking),
        target: alert.target ?? undefined,
      };
    });
  }

  return rows
    .filter((row) => isPendingStatus(row.status))
    .slice(0, 4)
    .map((row, index) => {
      const normalized = normalizeStatus(row.status);
      const hardBlocking = normalized === 'BLOCKED' || normalized === 'FAILED';
      return {
        code: `${row.id || 'row'}-${index + 1}`,
        severity: hardBlocking ? 'danger' : 'warning',
        severityLabel: hardBlocking ? '硬阻断' : '需复核',
        title: `${row.title}待修复`,
        detail: row.note,
        sourceLabel: row.filter === 'dataset' ? 'L1 基础行情' : '股票池快照',
        hardBlocking,
        target: row.id,
      };
    });
}

function buildFactorDimensionDisplays(
  overview: ApiSnapshotOverview | null,
  layerDisplays: SnapshotLayerDisplay[],
): FactorDimensionDisplay[] {
  const extension = asSnapshotOverviewReadiness(overview);
  const rawDimensions = readRecordArray<FactorDimensionReadinessRecord>(extension?.factor_dimension_readiness);
  const layerTitleMap = new Map(layerDisplays.map((item) => [item.key, item.title]));

  if (rawDimensions.length) {
    return rawDimensions.map((item, index) => {
      const status = item.status ?? 'WARNING';
      const linkedLayerTitles = readStringArray(item.linked_layers)
        .map(normalizeSnapshotLayerKey)
        .filter((value): value is SnapshotLayerKey => Boolean(value))
        .map((value) => layerTitleMap.get(value) ?? layerKeyToTitle(value));
      const blockers = readStringArray(item.blockers);
      const factors = readStringArray(item.supported_factors).map(localizeFactorLabel);
      return {
        id: item.dimension_id?.trim() || `dimension-${index + 1}`,
        title: item.title_cn?.trim() || '因子维度',
        status,
        statusLabel: getFactorStatusLabel(status),
        statusTone: statusTone(status),
        summary:
          item.summary?.trim() ||
          item.rationale_cn?.trim() ||
          blockers[0] ||
          '等待上游契约补齐后再进入正式因子计算。',
        factors,
        blockers,
        linkedLayerTitles,
      };
    });
  }

  const findLayer = (layerKey: SnapshotLayerKey) => layerDisplays.find((item) => item.key === layerKey);
  const l2 = findLayer('l2');
  const l3 = findLayer('l3');
  const l4 = findLayer('l4');
  return [
    {
      id: 'quality',
      title: '财务稳健性',
      status: l2?.status ?? 'DISABLED',
      statusLabel: getFactorStatusLabel(l2?.status ?? 'DISABLED'),
      statusTone: statusTone(l2?.status ?? 'DISABLED'),
      summary: l2?.repairLabel ?? '待补财务截面契约。',
      factors: ['F-Score 财务稳健性', '应计质量', '经营杠杆'],
      blockers: l2?.blockers.length ? l2.blockers : ['待补 Publish Date 与 available_at'],
      linkedLayerTitles: l2 ? [l2.title] : ['L2 财务截面'],
    },
    {
      id: 'sentiment',
      title: '分析师与情绪',
      status: l3?.status ?? 'DISABLED',
      statusLabel: getFactorStatusLabel(l3?.status ?? 'DISABLED'),
      statusTone: statusTone(l3?.status ?? 'DISABLED'),
      summary: l3?.repairLabel ?? '待补分析师与卖空契约。',
      factors: ['一致预期修正', '非流动性溢价'],
      blockers: l3?.blockers.length ? l3.blockers : ['待补分析师样本与卖空来源'],
      linkedLayerTitles: l3 ? [l3.title] : ['L3 分析师与情绪'],
    },
    {
      id: 'micro',
      title: '微观结构',
      status: l4?.status ?? 'DISABLED',
      statusLabel: getFactorStatusLabel(l4?.status ?? 'DISABLED'),
      statusTone: statusTone(l4?.status ?? 'DISABLED'),
      summary: l4?.repairLabel ?? '待补期权与卖空横截面。',
      factors: ['卖空拥挤度', '隐含波动偏度'],
      blockers: l4?.blockers.length ? l4.blockers : ['待补期权偏度与卖空样本'],
      linkedLayerTitles: l4 ? [l4.title] : ['L4 宏观与衍生品'],
    },
    {
      id: 'macro',
      title: '宏观敏感度',
      status: l4?.status ?? 'DISABLED',
      statusLabel: getFactorStatusLabel(l4?.status ?? 'DISABLED'),
      statusTone: statusTone(l4?.status ?? 'DISABLED'),
      summary: l4?.summary ?? '待补利率与商品暴露契约。',
      factors: ['利率敏感度', '大宗商品 Beta'],
      blockers: l4?.blockers.length ? l4.blockers : ['待补 FRED 序列与滚动回归校准'],
      linkedLayerTitles: l4 ? [l4.title] : ['L4 宏观与衍生品'],
    },
  ];
}

function snapshotDatasetLabelForLayer(layer: SnapshotLayerDisplay): string {
  switch (layer.key) {
    case 'l1':
      return 'ds-price';
    case 'l2':
      return 'ds-fundamentals';
    case 'l3':
      return layer.target === 'ds-short-volume'
        ? 'ds-short-volume'
        : 'ds-analyst-consensus / ds-short-volume';
    case 'l4':
      return 'ds-macro-rates / ds-option-skew';
    default:
      return layer.target || layer.layerId.toUpperCase();
  }
}

function rawSnapshotFactorLabel(row: EquityRuntimeRow): string {
  const normalized = row.id.trim().toLowerCase();
  switch (normalized) {
    case 'ds-price':
      return '收益率 / 波动率 / Amihud';
    case 'ds-fundamentals':
      return 'F-Score / Accruals / 经营杠杆';
    case 'ds-analyst-consensus':
      return '分析师一致预期';
    case 'ds-short-volume':
      return '卖空成交比 / 冷门股筛选';
    case 'un-sp500':
    case 'un-ndx100':
      return '样本池锚点 / PIT 准入';
    default:
      return row.filter === 'dataset' ? '分层治理校验' : '历史样本池锚点';
  }
}

function rawSnapshotNextStep(row: EquityRuntimeRow): string {
  const normalized = row.id.trim().toLowerCase();
  if (normalized === 'ds-fundamentals') {
    return '补齐 available_at';
  }
  if (normalized === 'ds-analyst-consensus') {
    return '纳入情绪盲区核查';
  }
  if (normalized === 'ds-short-volume') {
    return '加入异常核查';
  }
  if (normalized === 'un-sp500' || normalized === 'un-ndx100') {
    return '校验历史锚点';
  }
  return isPendingStatus(row.status) ? row.note : '接入 PIT 映射';
}

function rawSnapshotActionLabel(row: EquityRuntimeRow): string {
  const normalized = row.id.trim().toLowerCase();
  if (normalized === 'ds-price') {
    return '查看 PIT 映射';
  }
  if (normalized === 'ds-fundamentals') {
    return '查看财务对齐';
  }
  if (normalized === 'ds-analyst-consensus') {
    return '查看情绪盲区';
  }
  if (normalized === 'ds-short-volume') {
    return '查看异常核查';
  }
  if (normalized === 'un-sp500' || normalized === 'un-ndx100') {
    return '查看样本池锚点';
  }
  return '查看明细';
}

function buildSnapshotRestartCommand(): string {
  return `powershell -ExecutionPolicy Bypass -File .\\QuickStart-Grit.ps1 -ForceRestart -RestartReason ${quotePowerShellEnvValue(
    SNAPSHOT_CREDENTIAL_RESTART_REASON,
  )}`;
}

function snapshotEvidenceTitle(layer: SnapshotLayerDisplay): string {
  switch (layer.key) {
    case 'l1':
      return '价格主链';
    case 'l2':
      return '基础面发布链';
    case 'l3':
      return '情绪与微观结构';
    case 'l4':
      return '宏观与衍生品精修';
    default:
      return layer.title;
  }
}

function snapshotEvidenceDescription(layer: SnapshotLayerDisplay): string {
  switch (layer.key) {
    case 'l1':
      return '用于 OHLCV、前复权收盘与缺口补价，不替代成员历史或身份确权。';
    case 'l2':
      return '用于发布日、available_at 与财务字段完整度判断，是质量因子能否晋升的关键证据。';
    case 'l3':
      return '用于一致预期和卖空事件，只能证明情绪偏差，不替代价格 PIT 与正式回放。';
    case 'l4':
      return '宏观序列可回归，隐含波动率偏度需待期权历史链闭环后才进入正式门禁。';
    default:
      return layer.summary;
  }
}

function snapshotCredentialDescription(key: string): string {
  switch (key) {
    case 'FMP_API_KEY':
      return '基础面明细与发布日链路';
    case 'ALPHAVANTAGE_API_KEY':
      return '分析师一致预期与修订链路';
    case 'FRED_API_KEY':
      return '利率、CPI 与商品宏观序列';
    case 'THETADATA_USERNAME / PASSWORD':
      return '历史隐含波动率曲面与隐波偏度';
    default:
      return '数据源凭据';
  }
}

type SnapshotWorkbenchDisplayRow = {
  key: string;
  title: string;
  summary: string;
  status: string;
  statusLabel: string;
  stats: string[];
};

type SnapshotAnomalyDisplayRow = {
  code: string;
  title: string;
  detail: string;
  status: string;
  statusLabel: string;
  stats: string[];
  target?: string;
};

type SnapshotMatrixDisplayRow = {
  id: string;
  title: string;
  summary: string;
  status: string;
  statusLabel: string;
};

type SnapshotLedgerDisplayRow = {
  id: string;
  description: string;
  status: string;
  statusLabel: string;
  updatedAt: string;
  keyCheck: string;
  factorLabel: string;
  nextStep: string;
  sourceLabel: string;
  actionLabel: string;
  actionTarget?: string;
};

type SnapshotEvidenceDisplayRow = {
  id: string;
  title: string;
  description: string;
  status: string;
  statusLabel: string;
};

function buildSnapshotWorkbenchRows(layerDisplays: SnapshotLayerDisplay[]): SnapshotWorkbenchDisplayRow[] {
  return layerDisplays.map((layer) => ({
    key: layer.key,
    title: layer.title,
    summary: layer.summary,
    status: layer.status,
    statusLabel: layer.statusLabel,
    stats: [
      `${layer.primaryMetric.label} ${layer.primaryMetric.value}`,
      ...layer.supportingMetrics
        .filter((metric) => metric.value !== layer.updatedLabel)
        .slice(0, 2)
        .map((metric) => `${metric.label} ${metric.value}`),
      layer.providerLabel,
    ].filter(Boolean),
  }));
}

function buildSnapshotAnomalyRows(alerts: SnapshotQualityAlertDisplay[]): SnapshotAnomalyDisplayRow[] {
  return alerts.map((alert) => ({
    code: alert.code,
    title: alert.title,
    detail: alert.detail,
    status: alert.hardBlocking ? 'BLOCKED' : alert.severity.toUpperCase(),
    statusLabel: alert.severityLabel,
    stats: [alert.sourceLabel].filter(Boolean),
    target: alert.target,
  }));
}

function buildSnapshotMatrixRows(dimensions: FactorDimensionDisplay[]): SnapshotMatrixDisplayRow[] {
  return dimensions.map((dimension) => ({
    id: dimension.id,
    title: dimension.title,
    summary: dimension.summary,
    status: dimension.status,
    statusLabel: dimension.statusLabel,
  }));
}

function buildSnapshotLedgerRows(rows: EquityRuntimeRow[]): SnapshotLedgerDisplayRow[] {
  return rows.map((row) => ({
    id: row.id,
    description: `${row.summary} · ${row.note}`,
    status: row.status,
    statusLabel: row.statusLabel,
    updatedAt: compactDateTimeLabel(row.updatedAt),
    keyCheck: row.fields,
    factorLabel: rawSnapshotFactorLabel(row),
    nextStep: rawSnapshotNextStep(row),
    sourceLabel: row.sourceLabel || row.schedule,
    actionLabel: rawSnapshotActionLabel(row),
    actionTarget: row.id,
  }));
}

function buildSnapshotEvidenceRows(layerDisplays: SnapshotLayerDisplay[]): SnapshotEvidenceDisplayRow[] {
  return layerDisplays.map((layer) => ({
    id: `evidence-${layer.key}`,
    title: snapshotEvidenceTitle(layer),
    description: `${snapshotEvidenceDescription(layer)} ${layer.providerLabel}`,
    status: layer.status,
    statusLabel: layer.statusLabel,
  }));
}

function DataTrustLayerPanel({ layers }: { layers: ApiDataTrustLayer[] }): JSX.Element | null {
  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, string>>(() =>
    readCredentialDraftsFromSession(),
  );
  const [credentialNotices, setCredentialNotices] = useState<Record<string, string>>({});
  const missingCredentialOptions = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    layers.forEach((layer) => {
      (layer.missing_env_vars ?? []).forEach((envName) => {
        if (!seen.has(envName)) {
          seen.add(envName);
          ordered.push(envName);
        }
      });
    });
    return ordered;
  }, [layers]);
  const [selectedCredential, setSelectedCredential] = useState('');
  const missingCredentialKey = missingCredentialOptions.join('\u0000');
  useEffect(() => {
    setCredentialDrafts((current) => {
      const allowed = new Set(missingCredentialOptions);
      const filtered = Object.fromEntries(Object.entries(current).filter(([envName]) => allowed.has(envName)));
      const currentKeys = Object.keys(current).sort().join('\u0000');
      const filteredKeys = Object.keys(filtered).sort().join('\u0000');
      return currentKeys === filteredKeys ? current : filtered;
    });
  }, [missingCredentialKey, missingCredentialOptions]);
  useEffect(() => {
    writeCredentialDraftsToSession(credentialDrafts);
  }, [credentialDrafts]);
  useEffect(() => {
    if (!missingCredentialOptions.length) {
      if (selectedCredential) {
        setSelectedCredential('');
      }
      return;
    }
    if (!selectedCredential || !missingCredentialOptions.includes(selectedCredential)) {
      setSelectedCredential(missingCredentialOptions[0]);
    }
  }, [missingCredentialKey, missingCredentialOptions, selectedCredential]);
  if (!layers.length) {
    return null;
  }
  const visibleLayers = layers.slice(0, 6);
  const activeCredential = missingCredentialOptions.includes(selectedCredential)
    ? selectedCredential
    : missingCredentialOptions[0] ?? '';
  const updateCredentialDraft = (envName: string, value: string): void => {
    setCredentialDrafts((current) => ({ ...current, [envName]: value }));
    setCredentialNotices((current) => ({
      ...current,
      [envName]: '已暂存到当前浏览器标签页；刷新不会清空，关闭标签页或清空暂存即删除。',
    }));
  };
  const clearCredentialDrafts = (): void => {
    setCredentialDrafts({});
    setCredentialNotices(
      Object.fromEntries(missingCredentialOptions.map((envName) => [envName, '已清空本标签页暂存草稿。'])),
    );
  };
  const buildQuickStartCredentialCommand = (activeEnvName: string): string => {
    const credentialPairs = missingCredentialOptions
      .map((envName) => [envName, String(credentialDrafts[envName] ?? '').trim()] as const)
      .filter(([, value]) => value);
    if (!credentialPairs.some(([envName]) => envName === activeEnvName)) {
      const activeValue = String(credentialDrafts[activeEnvName] ?? '').trim();
      if (activeValue) {
        credentialPairs.push([activeEnvName, activeValue]);
      }
    }
    const envCommands = credentialPairs.flatMap(([envName, value]) =>
      buildPowerShellPersistCredentialCommands(envName, value),
    );
    const restartCommand = `powershell -ExecutionPolicy Bypass -File .\\QuickStart-Grit.ps1 -ForceRestart -RestartReason ${quotePowerShellEnvValue(SNAPSHOT_CREDENTIAL_RESTART_REASON)}`;
    return [...envCommands, restartCommand].join('\n');
  };
  const copyCredentialCommand = async (envName: string): Promise<void> => {
    const value = String(credentialDrafts[envName] ?? '').trim();
    if (!value) {
      setCredentialNotices((current) => ({ ...current, [envName]: '请先输入本机配置值，再复制持久化启动命令。' }));
      return;
    }
    const command = buildQuickStartCredentialCommand(envName);
    if (await writeTextToClipboard(command)) {
      setCredentialNotices((current) => ({
        ...current,
        [envName]: '已复制用户环境持久化+受保护强制重启命令；粘贴执行一次后，当前 QuickStart 会重新读取配置。',
      }));
      return;
    }
    setCredentialNotices((current) => ({
      ...current,
      [envName]: '复制失败；请手动写入 Windows 用户环境或 QuickStart-Grit.local.ps1 后重启。',
    }));
  };
  return (
      <section className="factor-panel factor-full-ready-plan snapshots-data-trust-layer" data-section="data-trust-summary">
        <div className="factor-section-title">
          <span>补源优先级与证据层</span>
          <span className="factor-muted">价格主链 → 成分历史 → 长周期补价 → 身份确权 → 关键精修</span>
        </div>
        <p className="factor-muted">
          按证据用途分层展示补源顺序、可证明范围和门禁边界；缺 key 只影响对应补源，不代表全部数据不可用。
        </p>
        <div className="factor-trust-layer-grid">
          {visibleLayers.map((layer) => {
            const usableCount = layer.usable_provider_count ?? layer.usable_provider_ids?.length ?? 0;
            const providerCount = layer.provider_count ?? layer.registered_provider_ids?.length ?? layer.provider_ids?.length ?? 0;
            const missingEnv = layer.missing_env_vars ?? [];
            const display = trustLayerDisplayCopy(layer);
            return (
              <article className="factor-trust-layer-card" key={layer.id}>
                <div>
                  <strong>{display.label}</strong>
                  <span className={trustStatusChipClassName(layer.status)}>{getTrustStatusLabel(layer.status)}</span>
                </div>
                <p>{display.role}</p>
                <small>{trustLayerProviderLine(layer, usableCount, providerCount)}</small>
                <small>证据：{display.scope}</small>
                <small>边界：{display.boundary}</small>
                <small>{trustLayerActionLine(layer, missingEnv, display)}</small>
              </article>
            );
          })}
        </div>
      {missingCredentialOptions.length ? (
        <div className="snapshots-trust-credential-panel">
          <div className="factor-section-title snapshots-trust-credential-title">
            <span>当前缺少的 API_KEY</span>
            <span className="factor-muted">{missingCredentialOptions.length} 项待配置</span>
          </div>
          <p className="factor-muted">
            先选择需要补齐的本机配置，再输入值并复制 PowerShell 用户环境持久化+重启命令；输入值仅保存在当前浏览器标签页，不提交后端、不落库。
          </p>
          <p className="factor-muted snapshots-trust-restart-note">
            复制命令会同时写入 Windows 用户环境和当前 PowerShell 进程；当前后端仍需重启后才会读取新值。
          </p>
          <div className="snapshots-trust-credential-form">
            <label htmlFor="snapshots-missing-api-key-select">选择缺少的 API_KEY</label>
            <select
              aria-label="选择缺少的 API_KEY"
              id="snapshots-missing-api-key-select"
              onChange={(event) => setSelectedCredential(event.target.value)}
              value={activeCredential}
            >
              {missingCredentialOptions.map((envName) => (
                <option key={envName} value={envName}>
                  {envName}
                </option>
              ))}
            </select>
            {activeCredential ? (
              <div className="snapshots-trust-input">
                <label htmlFor={`snapshots-trust-selected-${activeCredential}`}>{activeCredential}</label>
                <div className="snapshots-trust-input__row">
                  <input
                    aria-label={`输入 ${activeCredential} 凭据`}
                    autoComplete="off"
                    id={`snapshots-trust-selected-${activeCredential}`}
                    onChange={(event) => updateCredentialDraft(activeCredential, event.target.value)}
                    placeholder={credentialPlaceholder(activeCredential)}
                    type={credentialInputType(activeCredential)}
                    value={credentialDrafts[activeCredential] ?? ''}
                  />
                  <button
                    className="ghost-button snapshots-trust-copy-button"
                    onClick={() => void copyCredentialCommand(activeCredential)}
                    type="button"
                  >
                    生成 {activeCredential} 凭据命令
                  </button>
                </div>
                <small>
                  {credentialNotices[activeCredential] || '复制命令会带上当前已输入的全部 key，写入 Windows 用户环境，并通过受保护 QuickStart 强制重启当前本地服务。'}
                </small>
              </div>
            ) : null}
            <button className="ghost-button snapshots-trust-copy-button" onClick={clearCredentialDrafts} type="button">
              清空本标签页暂存
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function EquitySnapshotsTab({
  overview,
  onRefresh,
  refreshDisabled,
  refreshLabel,
  highlightTarget,
}: EquitySnapshotsTabProps): JSX.Element {
  const [activeFilter, setActiveFilter] = useState<EquityFilter>('all');
  const [isCoverageModalOpen, setIsCoverageModalOpen] = useState(false);
  const datasetSnapshots = overview?.dataset_snapshots ?? [];
  const universeSnapshots = overview?.universe_snapshots ?? [];
  const rows = useMemo(
    () => [
      ...datasetSnapshots.map(describeDataset),
      ...universeSnapshots.map(describeUniverse),
    ],
    [datasetSnapshots, universeSnapshots],
  );
  const visibleRows = rows.filter((row) => shouldShowRow(row, activeFilter));
  useLayoutEffect(() => {
    if (!highlightTarget) return;
    const matched = rows.find((row) => row.id === highlightTarget);
    if (matched) {
      setActiveFilter(matched.filter);
    }
    window.requestAnimationFrame(() => {
      const target = document.getElementById('equity-runtime-snapshot-list');
      target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    });
  }, [highlightTarget, rows]);
  const readyDatasetCount = datasetSnapshots.filter((item) => isReadyStatus(item.status)).length;
  const pendingCount = rows.filter((row) => isPendingStatus(row.status)).length;
  const basketRows = rows.filter((row) => row.filter === 'universe' || isEquityBasketRow(row));
  const availableBasketCount = basketRows.filter((row) => row.available ?? isReadyStatus(row.status)).length;
  const basketReady = basketRows.length > 0 && availableBasketCount === basketRows.length;
  const benchmarkCoverage = getBenchmarkEtfCoverage(datasetSnapshots);
  const totalUniverseMembers = universeSnapshots.reduce((total, item) => total + (item.member_count ?? 0), 0);
  const datasetCoverage = datasetSnapshots.reduce(
    (accumulator, item) => {
      const counts = getCoverageCounts(item);
      if (!counts) {
        return accumulator;
      }
      return {
        covered: accumulator.covered + counts.covered,
        total: accumulator.total + counts.total,
      };
    },
    { covered: 0, total: 0 },
  );
  const refreshDeltaLabel = formatLatestRefreshDelta(overview);
  const coverageChangeRows = useMemo(() => buildCoverageChangeRows(overview), [overview]);
  const lastRefresh =
    overview?.last_refreshed_at ??
    overview?.latest_job?.completed_at ??
    overview?.latest_job?.updated_at ??
    null;
  const layerDisplays = useMemo(
    () =>
      buildSnapshotLayerDisplays(overview, {
        datasetCoverage,
        readyDatasetCount,
        datasetSnapshotCount: datasetSnapshots.length,
        benchmarkCoverage,
        availableBasketCount,
        basketCount: basketRows.length,
        totalUniverseMembers,
        pendingCount,
        lastRefresh,
        basketReady,
      }),
    [
      overview,
      datasetCoverage,
      readyDatasetCount,
      datasetSnapshots.length,
      benchmarkCoverage,
      availableBasketCount,
      basketRows.length,
      totalUniverseMembers,
      pendingCount,
      lastRefresh,
      basketReady,
    ],
  );
  const qualityAlerts = useMemo(() => buildSnapshotAlertDisplays(overview, rows), [overview, rows]);
  const factorDimensions = useMemo(
    () => buildFactorDimensionDisplays(overview, layerDisplays),
    [overview, layerDisplays],
  );
  const workbenchRows = useMemo(() => buildSnapshotWorkbenchRows(layerDisplays), [layerDisplays]);
  const anomalyRows = useMemo(() => buildSnapshotAnomalyRows(qualityAlerts), [qualityAlerts]);
  const matrixRows = useMemo(() => buildSnapshotMatrixRows(factorDimensions), [factorDimensions]);
  const ledgerRows = useMemo(() => buildSnapshotLedgerRows(rows), [rows]);
  const evidenceRows = useMemo(() => buildSnapshotEvidenceRows(layerDisplays), [layerDisplays]);
  const trustLayers = overview?.data_trust_summary?.layers ?? [];
  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, string>>(() =>
    readCredentialDraftsFromSession(),
  );
  const [credentialNotices, setCredentialNotices] = useState<Record<string, string>>({});
  const missingCredentialOptions = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    trustLayers.forEach((layer) => {
      (layer.missing_env_vars ?? []).forEach((envName) => {
        if (!seen.has(envName)) {
          seen.add(envName);
          ordered.push(envName);
        }
      });
    });
    return ordered;
  }, [trustLayers]);
  const [selectedCredential, setSelectedCredential] = useState('');
  const missingCredentialKey = missingCredentialOptions.join('\u0000');
  useEffect(() => {
    setCredentialDrafts((current) => {
      const allowed = new Set(missingCredentialOptions);
      const filtered = Object.fromEntries(Object.entries(current).filter(([envName]) => allowed.has(envName)));
      const currentKeys = Object.keys(current).sort().join('\u0000');
      const filteredKeys = Object.keys(filtered).sort().join('\u0000');
      return currentKeys === filteredKeys ? current : filtered;
    });
  }, [missingCredentialKey, missingCredentialOptions]);
  useEffect(() => {
    writeCredentialDraftsToSession(credentialDrafts);
  }, [credentialDrafts]);
  useEffect(() => {
    if (!missingCredentialOptions.length) {
      if (selectedCredential) {
        setSelectedCredential('');
      }
      return;
    }
    if (!selectedCredential || !missingCredentialOptions.includes(selectedCredential)) {
      setSelectedCredential(missingCredentialOptions[0]);
    }
  }, [missingCredentialKey, missingCredentialOptions, selectedCredential]);
  const activeCredential = missingCredentialOptions.includes(selectedCredential)
    ? selectedCredential
    : missingCredentialOptions[0] ?? '';
  const [restartCommandNotice, setRestartCommandNotice] = useState<string | null>(null);
  const credentialStatusRows = useMemo(
    () => {
      const missingEnv = new Set(
        trustLayers.flatMap((layer) => layer.missing_env_vars ?? []),
      );
      const providerKeys = Array.from(
        new Set(layerDisplays.flatMap((layer) => layer.providerKeys).filter((key) => key.trim().length > 0)),
      );
      return providerKeys.map((key) => ({
        id: key,
        note: snapshotCredentialDescription(key),
        statusLabel: missingEnv.has(key) ? '待补' : '已配置',
        statusTone: missingEnv.has(key) ? ('warning' as const) : ('success' as const),
      }));
    },
    [layerDisplays, trustLayers],
  );
  const dataSourceStatusRows = useMemo(
    () =>
      trustLayers.length
        ? trustLayers.slice(0, 4).map((layer) => {
          const usableCount = layer.usable_provider_count ?? layer.usable_provider_ids?.length ?? 0;
          const providerCount = layer.provider_count ?? layer.registered_provider_ids?.length ?? layer.provider_ids?.length ?? 0;
          const display = trustLayerDisplayCopy(layer);
          const missingEnv = layer.missing_env_vars ?? [];
          return {
            id: layer.id,
            title: display.label,
            note: trustLayerProviderLine(layer, usableCount, providerCount),
            status: layer.status,
            statusLabel: getTrustStatusLabel(layer.status),
            action: missingEnv.length
              ? `待配置 ${missingEnv.join(' / ')}，配置后强制重启刷新。`
              : usableCount > 0
                ? '已接入数据源，按层级策略参与刷新。'
                : '暂无可用凭据，需先补齐 API 配置。',
          };
        })
        : layerDisplays.map((layer) => ({
          id: layer.layerId,
          title: layer.title,
          note: layer.providerLabel,
          status: layer.status,
          statusLabel: layer.statusLabel,
          action: layer.legacyContext,
        })),
    [layerDisplays, trustLayers],
  );
function jumpToTarget(target?: string): void {
    if (!target) {
      window.requestAnimationFrame(() => {
        const fallback = document.getElementById('equity-runtime-snapshot-list');
        fallback?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      });
      return;
    }
    const matched = rows.find((row) => row.id === target);
    if (matched) {
      setActiveFilter(matched.filter);
    }
    window.requestAnimationFrame(() => {
      const anchor =
        document.querySelector<HTMLElement>(`[data-snapshot-id="${target}"]`) ??
        document.getElementById('equity-runtime-snapshot-list');
      anchor?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    });
  }

  async function copyRestartCommand(): Promise<void> {
    const command = buildSnapshotRestartCommand();
    if (await writeTextToClipboard(command)) {
      setRestartCommandNotice('已复制设置并重启命令；更新本机凭据后执行一次即可让 QuickStart 重新读取。');
      return;
    }
    setRestartCommandNotice(`复制失败，请手动执行：${command}`);
  }

  const updateCredentialDraft = (envName: string, value: string): void => {
    setCredentialDrafts((current) => ({ ...current, [envName]: value }));
    setCredentialNotices((current) => ({
      ...current,
      [envName]: '已暂存当前输入，复制命令后再写入本机环境。',
    }));
  };
  const clearCredentialDrafts = (): void => {
    setCredentialDrafts({});
    setCredentialNotices(
      Object.fromEntries(missingCredentialOptions.map((envName) => [envName, '已清空本标签页暂存草稿。'])),
    );
  };
  const buildQuickStartCredentialCommand = (activeEnvName: string): string => {
    const credentialPairs = missingCredentialOptions
      .map((envName) => [envName, String(credentialDrafts[envName] ?? '').trim()] as const)
      .filter(([, value]) => value);
    if (!credentialPairs.some(([envName]) => envName === activeEnvName)) {
      const activeValue = String(credentialDrafts[activeEnvName] ?? '').trim();
      if (activeValue) {
        credentialPairs.push([activeEnvName, activeValue]);
      }
    }
    const envCommands = credentialPairs.flatMap(([envName, value]) =>
      buildPowerShellPersistCredentialCommands(envName, value),
    );
    const restartCommand = `powershell -ExecutionPolicy Bypass -File .\\QuickStart-Grit.ps1 -ForceRestart -RestartReason ${quotePowerShellEnvValue(SNAPSHOT_CREDENTIAL_RESTART_REASON)}`;
    return [...envCommands, restartCommand].join('\n');
  };
  const copyCredentialCommand = async (envName: string): Promise<void> => {
    const value = String(credentialDrafts[envName] ?? '').trim();
    if (!value) {
      setCredentialNotices((current) => ({ ...current, [envName]: '请输入 API key 后再复制配置命令。' }));
      return;
    }
    const command = buildQuickStartCredentialCommand(envName);
    if (await writeTextToClipboard(command)) {
      setCredentialNotices((current) => ({
        ...current,
        [envName]: '已复制 API 配置与受保护重启命令。',
      }));
      return;
    }
    setCredentialNotices((current) => ({
      ...current,
      [envName]: '复制失败，请手动执行生成的 PowerShell 配置命令。',
    }));
  };

  return (
    <div className="snapshots-equity-view">
      <section className="panel snapshots-equity-overview snapshots-global-dashboard-panel">
        <div className="panel-header">
          <div>
            <h2>健康仪表盘</h2>
            <p className="panel-note">
              保留线上股票 tab 的总览模块，用 L1-L4 取代原有前四张健康卡，继续回答当日研究、回测对照与组合引用是否具备数据基础。
            </p>
          </div>
          <button
            className="primary-button"
            disabled={refreshDisabled}
            onClick={onRefresh}
            type="button"
          >
            {refreshLabel}
          </button>
        </div>
        <div className="metric-grid">
          {layerDisplays.map((layer) => (
            <article className={metricCardClassName(layer.statusTone)} key={layer.layerId}>
              <span>{layer.title}</span>
              <strong>{layer.statusLabel}</strong>
              <small>{`${layer.primaryMetric.label} ${layer.primaryMetric.value} · ${layer.summary}`}</small>
            </article>
          ))}
          <article className="metric-card metric-card--neutral">
            <span>最新刷新</span>
            <strong>{compactDateTimeLabel(lastRefresh)}</strong>
            <small>
              {refreshDeltaLabel}
              <button
                className="snapshots-coverage-detail-link"
                onClick={() => {
                  setIsCoverageModalOpen(true);
                }}
                type="button"
              >
                查看明细
              </button>
            </small>
          </article>
        </div>
      </section>

      {isCoverageModalOpen ? (
        <div
          className="snapshots-coverage-modal-backdrop"
          onClick={() => {
            setIsCoverageModalOpen(false);
          }}
          >
            <section
              aria-labelledby="snapshots-coverage-modal-title"
              aria-modal="true"
              className="snapshots-coverage-modal"
            onClick={(event) => {
              event.stopPropagation();
            }}
            role="dialog"
            >
              <div className="snapshots-coverage-modal__header">
                <div>
                  <p className="eyebrow">刷新明细</p>
                  <h2 id="snapshots-coverage-modal-title">L1-L4 覆盖与刷新明细</h2>
                  <p>
                    以本次刷新任务为口径，按数据层展示当前覆盖、本次入库、待处理缺口与受影响因子，便于从仪表盘直接下钻。
                  </p>
                </div>
                <button
                  className="ghost-button snapshots-coverage-modal__close"
                onClick={() => {
                  setIsCoverageModalOpen(false);
                }}
                type="button"
              >
                关闭
                </button>
              </div>
              {layerDisplays.length ? (
                <div className="snapshots-coverage-table-wrap">
                  <table className="snapshots-coverage-table">
                    <thead>
                      <tr>
                        <th scope="col">层级</th>
                        <th scope="col">对应快照</th>
                        <th scope="col">当前覆盖</th>
                        <th scope="col">本次入库</th>
                        <th scope="col">待处理</th>
                        <th scope="col">影响因子 / 说明</th>
                      </tr>
                    </thead>
                    <tbody>
                      {layerDisplays.map((layer) => (
                        <tr key={`modal-${layer.layerId}`}>
                          <td>{layer.title}</td>
                          <td>{snapshotDatasetLabelForLayer(layer)}</td>
                          <td>{layer.coverageLabel}</td>
                          <td>{layer.primaryMetric.value}</td>
                          <td>{layer.repairLabel}</td>
                          <td>{`${layer.dimensionLabels.join('、')} · ${layer.summary}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="drawer-callout">暂无分层明细。请先刷新快照或等待契约返回。</div>
              )}
            </section>
          </div>
      ) : null}

      <section className="workbench-grid">
        <article className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <h2>数据层级工作站</h2>
              <p>按因子计算链路拆分数据层，集中查看覆盖、时效与准入状态。</p>
            </div>
            <span className="status-chip status-chip--soft">L1 → L4</span>
          </div>
          <div className="layer-stack">
            {workbenchRows.map((row) => (
              <article className="layer-row" key={row.key}>
                <div className="layer-row__top">
                  <div className="layer-row__title">
                    <strong>{row.title}</strong>
                    <span>{row.summary}</span>
                  </div>
                  <span className={statusChipClassName(row.status)}>{row.statusLabel}</span>
                </div>
                <div className="layer-row__stats">
                  {row.stats.map((stat) => (
                    <span className="small-stat" key={`${row.key}-${stat}`}>
                      {stat}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <h2>异常核查</h2>
              <p>聚焦会改变因子可计算性的关键异常，区分阻断、观察与校准事项。</p>
            </div>
            <span className="status-chip status-chip--warning">
              {`${anomalyRows.length} 条待处理`}
            </span>
          </div>
          <div className="alert-stack">
            {anomalyRows.length ? (
              anomalyRows.map((alert) => (
                <article className={alertCardClassName({
                  code: alert.code,
                  severity: alert.status.toLowerCase(),
                  severityLabel: alert.statusLabel,
                  title: alert.title,
                  detail: alert.detail,
                  sourceLabel: '',
                  hardBlocking: alert.status === 'BLOCKED',
                  target: alert.target,
                })} key={alert.code}>
                  <div className="alert-card__top">
                    <div className="alert-card__title">
                      <strong>{alert.title}</strong>
                      <span>{alert.detail}</span>
                    </div>
                    <span className={statusChipClassName(alert.status)}>{alert.statusLabel}</span>
                  </div>
                  <div className="layer-row__stats">
                    {alert.stats.map((stat) => (
                      <span className="small-stat" key={`${alert.code}-${stat}`}>
                        {stat}
                      </span>
                    ))}
                    <button
                      className="link-btn"
                      onClick={() => {
                        jumpToTarget(alert.target);
                      }}
                      type="button"
                    >
                      定位台账
                    </button>
                  </div>
                </article>
              ))
            ) : (
              qualityAlerts.map((alert) => (
                <article className={alertCardClassName(alert)} key={alert.code}>
                  <div className="alert-card__top">
                    <div className="alert-card__title">
                      <strong>{alert.title}</strong>
                      <span>{alert.detail}</span>
                    </div>
                    <span className={statusChipClassName(alert.hardBlocking ? 'BLOCKED' : alert.severity)}>
                      {alert.severityLabel}
                    </span>
                  </div>
                  <div className="layer-row__stats">
                    <span className="small-stat">{alert.sourceLabel}</span>
                    <button
                      className="link-btn"
                      onClick={() => {
                        jumpToTarget(alert.target);
                      }}
                      type="button"
                    >
                      定位台账
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <h2>因子维度就绪矩阵</h2>
              <p>按数据层映射因子族准入状态，直接连接 PIT 与因子工厂。</p>
            </div>
            <span className="status-chip status-chip--soft">逻辑映射</span>
          </div>
          <div className="matrix-rows">
            {matrixRows.map((dimension) => (
              <div className="matrix-row" key={dimension.id}>
                <div className="matrix-row__copy">
                  <strong>{dimension.title}</strong>
                  <span>{dimension.summary}</span>
                </div>
                <span className={statusChipClassName(dimension.status)}>{dimension.statusLabel}</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="panel" id="equity-runtime-snapshot-list">
        <div className="panel-header">
          <div className="panel-title">
            <h2>原始快照清单</h2>
            <p>保留原始快照台账，并同步标注关键校验、可用因子与后续动作。</p>
          </div>
          <span className="status-chip status-chip--soft">目标行可高亮</span>
        </div>
        {ledgerRows.length ? (
          <div className="dense-table">
            {ledgerRows.map((row) => {
              const highlight = row.id === highlightTarget || row.id === 'ds-fundamentals';
              return (
                <article
                  className={`dense-row ${highlight ? 'dense-row--highlight' : ''}`}
                  data-snapshot-id={row.id}
                  key={row.id}
                >
                  <div className="dense-row__top">
                    <div className="dense-row__copy">
                      <strong>{row.id}</strong>
                      <p>{row.description}</p>
                    </div>
                    <span className={statusChipClassName(row.status)}>{row.statusLabel}</span>
                  </div>
                  <dl className="dense-meta-grid">
                    <div className="dense-meta">
                      <dt>最新刷新</dt>
                      <dd>{row.updatedAt}</dd>
                    </div>
                    <div className="dense-meta">
                      <dt>关键校验</dt>
                      <dd>{row.keyCheck}</dd>
                    </div>
                    <div className="dense-meta">
                      <dt>可点亮因子</dt>
                      <dd>{row.factorLabel}</dd>
                    </div>
                    <div className="dense-meta">
                      <dt>下一步</dt>
                      <dd>{row.nextStep}</dd>
                    </div>
                  </dl>
                  <div className="dense-row__footer">
                    <span className="divider-note">
                      {`来源：${row.sourceLabel}`}
                    </span>
                    <button
                      className="link-btn"
                      onClick={() => {
                        jumpToTarget(row.actionTarget);
                      }}
                      type="button"
                    >
                      {row.actionLabel}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="drawer-callout">
            当前筛选下没有快照记录。请先触发刷新，或检查本地市场数据仓库是否有入库数据。
          </div>
        )}
      </section>

      <section className="evidence-grid">
        <article className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <h3>数据源证据层</h3>
              <p>归集 provider 边界、字段口径与证据用途，供快照侧统一溯源。</p>
            </div>
            <span className="status-chip status-chip--soft">来源证据</span>
          </div>
          <div className="evidence-stack">
            {evidenceRows.map((row) => (
              <article className="evidence-card" key={row.id}>
                <div className="evidence-card__top">
                  <div className="evidence-card__title">
                    <strong>{row.title}</strong>
                    <span>{row.description}</span>
                  </div>
                  <span className={statusChipClassName(row.status)}>
                    {row.statusLabel}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <h3>凭据与重启入口</h3>
              <p>统一管理新增数据源凭据与重启动作，不将运维输入散落到 PIT 页面。</p>
            </div>
            <span className="status-chip status-chip--soft">会话草稿</span>
          </div>
          <div className="credential-list">
            {dataSourceStatusRows.map((row) => (
              <div className="credential-row" key={row.id}>
                <div>
                  <strong>{row.title}</strong>
                  <span>{row.note}</span>
                  <span>{row.action}</span>
                </div>
                <span
                  className={trustStatusChipClassName(row.status)}
                >
                  {row.statusLabel}
                </span>
              </div>
            ))}
            {credentialStatusRows.map((row) => (
              <div className="credential-row credential-row--api-key" key={`api-${row.id}`}>
                <div>
                  <strong>{row.id}</strong>
                  <span>{row.note}</span>
                </div>
                <span
                  className={
                    row.statusTone === 'success'
                      ? 'status-chip status-chip--success'
                      : 'status-chip status-chip--warning'
                  }
                >
                  {row.statusLabel}
                </span>
              </div>
            ))}
          </div>
          {missingCredentialOptions.length ? (
            <div className="snapshots-trust-credential-panel snapshots-trust-credential-panel--compact">
              <div className="snapshots-trust-credential-form">
                <label htmlFor="snapshots-equity-api-key-select">选择待配置 API_KEY</label>
                <select
                  aria-label="选择待配置 API_KEY"
                  id="snapshots-equity-api-key-select"
                  onChange={(event) => setSelectedCredential(event.target.value)}
                  value={activeCredential}
                >
                  {missingCredentialOptions.map((envName) => (
                    <option key={envName} value={envName}>
                      {envName}
                    </option>
                  ))}
                </select>
                {activeCredential ? (
                  <div className="snapshots-trust-input">
                    <label htmlFor={`snapshots-equity-api-key-${activeCredential}`}>{activeCredential}</label>
                    <div className="snapshots-trust-input__row">
                      <input
                        aria-label={`输入 ${activeCredential} 凭据`}
                        autoComplete="off"
                        id={`snapshots-equity-api-key-${activeCredential}`}
                        onChange={(event) => updateCredentialDraft(activeCredential, event.target.value)}
                        placeholder={credentialPlaceholder(activeCredential)}
                        type={credentialInputType(activeCredential)}
                        value={credentialDrafts[activeCredential] ?? ''}
                      />
                      <button
                        className="ghost-button snapshots-trust-copy-button"
                        onClick={() => void copyCredentialCommand(activeCredential)}
                        type="button"
                      >
                        生成 {activeCredential} 凭据命令
                      </button>
                    </div>
                    <small>
                      {credentialNotices[activeCredential] ||
                        '配置命令会写入 Windows 用户环境，并通过受保护 QuickStart 强制重启当前本地服务。'}
                    </small>
                  </div>
                ) : null}
                <button className="ghost-button snapshots-trust-copy-button" onClick={clearCredentialDrafts} type="button">
                  清空暂存草稿
                </button>
              </div>
            </div>
          ) : null}
          <div className="list-actions">
            <span className="divider-note">
              {restartCommandNotice ||
                '修改凭据后需要重启 QuickStart 或 backend，才会进入下一轮快照刷新。'}
            </span>
            <button className="primary-button" onClick={() => void copyRestartCommand()} type="button">
              复制设置并重启命令
            </button>
          </div>
        </article>
      </section>
    </div>
  );
}

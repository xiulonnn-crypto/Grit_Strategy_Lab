import { useDeferredValue, useState } from 'react';
import { formatDateTime, formatPercent } from '../../lib/format';
import { navigateTo } from '../../lib/appRouteContext';
import {
  formatCompositionStatusLabel,
  formatLegDisplayName,
  formatLegReferenceSummary,
} from '../../lib/compose-display';
import type {
  ApiAssetLegCreatePayload,
  ApiCashLegCreatePayload,
  ApiLegInventory,
  ApiLegInventoryRow,
} from '../../types';
import { AssetLegDrawer, CashLegDrawer, StrategyLegDrawer } from './leg-create-drawer';
import './leg-inventory.css';

type LegInventoryViewProps = {
  inventory: ApiLegInventory | null;
  loading?: boolean;
  error?: string | null;
  onCreateAsset: (payload: ApiAssetLegCreatePayload) => Promise<void>;
  onCreateCash: (payload: ApiCashLegCreatePayload) => Promise<void>;
  onSaveStrategy: (row: ApiLegInventoryRow) => void;
  strategyRows?: ApiLegInventoryRow[];
};

type InventoryTypeFilter = 'all' | 'strategy' | 'asset' | 'cash';

type RowMetricPreview = {
  primary: string;
  secondary: string;
  anchor: string;
};

type PitSnapshotPreview = {
  primary: string;
  secondary: string;
};

function getLegTypeLabel(value: string): string {
  switch (value) {
    case 'strategy':
      return '策略腿';
    case 'asset':
      return '资产腿';
    case 'cash':
      return '现金腿';
    default:
      return '腿部对象';
  }
}

function getRowStatusLabel(row: ApiLegInventoryRow): string {
  if (row.is_orphan) {
    return '孤儿';
  }
  if (row.has_new_version) {
    return '待更新';
  }
  return formatCompositionStatusLabel(row.status, row.status_label);
}

function getRowStatusClassName(row: ApiLegInventoryRow): string {
  if (row.is_orphan) {
    return 'leg-inventory-status leg-inventory-status--danger';
  }
  if (row.has_new_version || String(row.status || '').toUpperCase() === 'NEEDS_RUN') {
    return 'leg-inventory-status leg-inventory-status--warning';
  }
  return 'leg-inventory-status leg-inventory-status--success';
}

function getReferenceSummary(row: ApiLegInventoryRow): string {
  return formatLegReferenceSummary(row.reference_summary, row.reference_count);
}

function getAssetSourcePath(row: ApiLegInventoryRow): string | null {
  const snapshotId =
    typeof row.config?.source_snapshot_id === 'string'
      ? row.config.source_snapshot_id
      : null;
  const tab = String(row.config?.asset_kind ?? '').toUpperCase().includes('BOND') ? 'tab=bond&' : '';
  return snapshotId ? `/snapshots?${tab}source_snapshot_id=${encodeURIComponent(snapshotId)}` : null;
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function getConfig(row: ApiLegInventoryRow): Record<string, unknown> {
  return getRecord(row.config);
}

function getSummary(row: ApiLegInventoryRow): Record<string, unknown> {
  return getRecord(getConfig(row).summary);
}

function getBondSnapshot(row: ApiLegInventoryRow): Record<string, unknown> {
  return getRecord(getSummary(row).bond_snapshot);
}

function readString(records: Record<string, unknown>[], keys: string[]): string | null {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
  }
  return null;
}

function readNumber(records: Record<string, unknown>[], keys: string[]): number | null {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
    }
  }
  return null;
}

function getMetricRecords(row: ApiLegInventoryRow): Record<string, unknown>[] {
  const config = getConfig(row);
  const summary = getSummary(row);
  return [getRecord(config.metrics), config, getBondSnapshot(row), summary];
}

function normalizePercentPoint(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  return Math.abs(value) <= 1 ? value * 100 : value;
}

function normalizePercentFraction(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  return Math.abs(value) > 2 ? value / 100 : value;
}

function formatPctPoint(value: number | null, digits = 2): string {
  const normalized = normalizePercentPoint(value);
  return normalized === null ? 'n/a' : `${normalized.toFixed(digits)}%`;
}

function formatSignedFraction(value: number | null): string {
  return formatPercent(normalizePercentFraction(value));
}

function getShieldHash(value: string): string {
  const hash = Array.from(value).reduce((accumulator, char) => {
    return (accumulator * 31 + char.charCodeAt(0)) % 0xffff;
  }, 17);
  return hash.toString(16).toUpperCase().padStart(4, '0');
}

function getIdentitySubtitle(row: ApiLegInventoryRow): string {
  const records = [getConfig(row), getBondSnapshot(row), getSummary(row)];
  const symbol = readString(records, ['symbol', 'ticker', 'isin', 'cusip']);
  const fallback =
    row.leg_type === 'cash'
      ? readString(records, ['cash_rule_kind', 'yield_source'])
      : row.leg_type === 'strategy'
        ? readString(records, ['strategy_id'])
        : row.version_label;
  return `${symbol ?? fallback ?? row.source_ref_id ?? row.id} · #${getShieldHash(row.id)}`;
}

function getPitSnapshotPreview(row: ApiLegInventoryRow): PitSnapshotPreview {
  const records = [getBondSnapshot(row), getSummary(row), getConfig(row)];
  const date = readString(records, ['snapshot_date', 'pit_date', 'as_of_date']);
  if (date) {
    return {
      primary: date.slice(0, 10),
      secondary: row.version_label ? `PIT Date · ${row.version_label}` : 'PIT Date',
    };
  }
  if (row.leg_type === 'strategy') {
    return {
      primary: row.version_label || '版本待定',
      secondary: readString(records, ['parameter_version_id']) ?? '参数版本',
    };
  }
  if (row.leg_type === 'cash') {
    return {
      primary: row.version_label || '现金规则',
      secondary: readString(records, ['freeze_mode']) ?? '规则冻结',
    };
  }
  return {
    primary: row.version_label || row.proof_label || '快照待定',
    secondary: row.proof_label ? `来源 ${row.proof_label}` : 'PIT Date 待补',
  };
}

function getMetricPreview(row: ApiLegInventoryRow): RowMetricPreview {
  const records = getMetricRecords(row);
  if (row.leg_type === 'strategy') {
    const annualized = readNumber(records, ['annualized_return', 'cagr', 'annualized_return_pct']);
    const drawdown = readNumber(records, ['max_drawdown', 'max_drawdown_pct']);
    const sharpe = readNumber(records, ['sharpe', 'oos_sharpe']);
    const drawdownFraction = drawdown === null ? null : -Math.abs(normalizePercentFraction(drawdown) ?? 0);
    return {
      primary: `年化 ${formatSignedFraction(annualized)} | 回撤 ${formatSignedFraction(drawdownFraction)}`,
      secondary: sharpe === null ? 'Sharpe n/a' : `Sharpe ${sharpe.toFixed(2)}`,
      anchor: readString(records, ['latest_run_id', 'run_id']) ?? row.proof_label ?? '回测锚点待补',
    };
  }
  if (row.leg_type === 'asset') {
    const assetKind = String(getConfig(row).asset_kind ?? '').toUpperCase();
    const ytm = readNumber(records, ['ytm_pct', 'yield_to_maturity_pct']);
    const duration = readNumber(records, ['duration', 'duration_years']);
    const volatility = readNumber(records, ['volatility_pct', 'annualized_volatility_pct', 'annualized_volatility']);
    const totalReturn = readNumber(records, ['latest_total_return_pct', 'total_return_pct', 'total_return']);
    const primary = assetKind.includes('BOND') || ytm !== null || duration !== null
      ? `YTM ${formatPctPoint(ytm)} | Dur ${duration === null ? 'n/a' : duration.toFixed(1)} | Vol ${formatPctPoint(volatility ?? 0.045, 1)}`
      : `Ret ${formatPctPoint(totalReturn)} | Vol ${formatPctPoint(volatility, 1)}`;
    return {
      primary,
      secondary: readString(records, ['source', 'source_provider']) ?? String(getConfig(row).asset_kind ?? '资产来源'),
      anchor: readString(records, ['snapshot_ref', 'source_snapshot_id', 'id']) ?? row.proof_label ?? '快照锚点待补',
    };
  }
  const buffer = readNumber(records, ['buffer_bps']);
  const costAbsorption = readString(records, ['cost_absorption', 'cost_absorption_label'])
    ?? (buffer !== null && buffer <= 25 ? 'High' : 'Standard');
  return {
    primary: `Buffer ${Math.round(buffer ?? 0)} bps | Cost Absorp ${costAbsorption}`,
    secondary: readString(records, ['yield_source']) ?? '现金收益代理',
    anchor: readString(records, ['freeze_mode', 'cash_rule_kind']) ?? row.proof_label ?? '现金规则锚点',
  };
}

function isFrozen(row: ApiLegInventoryRow): boolean {
  const freezeMode = String(getConfig(row).freeze_mode ?? '').toLowerCase();
  return /lock|frozen|freeze|snapshot|manual|rule/.test(freezeMode);
}

function getStatusBadges(row: ApiLegInventoryRow): Array<{ label: string; className: string }> {
  const badges = [{ label: getRowStatusLabel(row), className: getRowStatusClassName(row) }];
  if (isFrozen(row)) {
    badges.push({ label: '已冻结', className: 'leg-inventory-status leg-inventory-status--accent' });
  }
  if (row.reference_count <= 0) {
    badges.push({ label: '闲置', className: 'leg-inventory-status leg-inventory-status--warning' });
  }
  if (row.has_new_version) {
    badges.push({ label: '有新版本', className: 'leg-inventory-chip leg-inventory-chip--warning' });
  }
  if (row.is_orphan) {
    badges.push({ label: '缺少合格回测', className: 'leg-inventory-chip leg-inventory-chip--danger' });
  }
  return badges;
}

function getDetailNote(row: ApiLegInventoryRow): string {
  const records = getMetricRecords(row);
  const note = readString(records, ['notes', 'comment', 'memo']);
  if (note) {
    return note;
  }
  if (row.leg_type === 'asset') {
    return '用于组合资产腿冻结，已绑定快照来源与估值字段，编辑前可先核对 PIT Date 与核心参数。';
  }
  if (row.leg_type === 'cash') {
    return '用于再平衡和交易成本缓冲，重点观察缓冲 bps、收益代理与冻结规则是否匹配当前组合节奏。';
  }
  return '用于策略腿入库，当前版本以已完成回测和参数版本作为来源锚点，不会自动替换既有组合引用。';
}

function buildSparklinePoints(row: ApiLegInventoryRow): string {
  const metrics = getMetricPreview(row);
  const seed = parseInt(getShieldHash(`${row.id}:${metrics.primary}`), 16);
  const base = row.leg_type === 'cash' ? 0.035 : row.leg_type === 'asset' ? 0.08 : 0.14;
  return Array.from({ length: 12 }, (_, index) => {
    const wave = Math.sin((seed % 17) + index * 0.8) * 0.018;
    const drift = base * (index / 11);
    const value = drift + wave;
    const x = Math.round((320 / 11) * index);
    const y = Math.round(84 - Math.max(-0.08, Math.min(0.22, value)) * 260);
    return `${x},${Math.max(18, Math.min(92, y))}`;
  }).join(' ');
}

function LegDetailDrawer({
  onArchiveCandidate,
  onClose,
  onNavigateToSource,
  row,
}: {
  onArchiveCandidate: (row: ApiLegInventoryRow) => void;
  onClose: () => void;
  onNavigateToSource: (row: ApiLegInventoryRow) => void;
  row: ApiLegInventoryRow;
}): JSX.Element {
  const displayName = formatLegDisplayName({
    leg_kind: row.leg_type,
    name: row.name,
    config: row.config,
    source_ref_id: row.source_ref_id,
  });
  const metrics = getMetricPreview(row);
  const pit = getPitSnapshotPreview(row);
  const sourcePath = getAssetSourcePath(row);
  const updatedAt = readString(getMetricRecords(row), ['updated_at', 'refreshed_at']);

  return (
    <div className="leg-inventory-drawer-layer">
      <button
        aria-label="关闭腿部详情"
        className="leg-inventory-drawer__overlay"
        onClick={onClose}
        type="button"
      />
      <aside aria-label="腿部详情" className="leg-inventory-drawer leg-inventory-drawer--detail" role="dialog">
        <div className="leg-inventory-drawer__header">
          <div className="leg-inventory-drawer__title">
            <div className="leg-inventory-drawer__icon">{getLegTypeLabel(row.leg_type).slice(0, 1)}</div>
            <div className="leg-inventory-drawer__copy">
              <p className="page-heading__eyebrow">来源审计 / Leg Detail</p>
              <h2>{displayName}</h2>
              <p>{getIdentitySubtitle(row)} · {row.id}</p>
            </div>
          </div>
          <button className="ghost-button" onClick={onClose} type="button">
            关闭
          </button>
        </div>

        <div className="leg-inventory-detail-grid">
          <article className="leg-inventory-detail-card leg-inventory-detail-card--wide">
            <span>12 个月收益曲线</span>
            <svg aria-hidden="true" className="leg-inventory-detail-sparkline" viewBox="0 0 320 104">
              <path d={`M0 96 L${buildSparklinePoints(row).replaceAll(' ', ' L')} L320 96 Z`} fill="rgba(31, 135, 123, 0.1)" />
              <polyline fill="none" points={buildSparklinePoints(row)} stroke="#1f877b" strokeWidth="4" />
            </svg>
          </article>
          <article className="leg-inventory-detail-card">
            <span>PIT 快照版本</span>
            <strong>{pit.primary}</strong>
            <small>{pit.secondary}</small>
          </article>
          <article className="leg-inventory-detail-card">
            <span>核心参数预演</span>
            <strong>{metrics.primary}</strong>
            <small>{metrics.secondary}</small>
          </article>
          <article className="leg-inventory-detail-card">
            <span>来源锚点</span>
            <strong>{metrics.anchor}</strong>
            <small>{updatedAt ? `更新 ${formatDateTime(updatedAt)}` : row.source_ref_type ?? 'source audit'}</small>
          </article>
          <article className="leg-inventory-detail-card">
            <span>组合渗透率</span>
            <strong>{row.reference_count} 个组合</strong>
            <small>{getReferenceSummary(row)}</small>
          </article>
        </div>

        <section className="leg-inventory-drawer__section">
          <div className="leg-inventory-drawer__copy">
            <strong>逻辑说明</strong>
            <p>{getDetailNote(row)}</p>
          </div>
          <div className="leg-inventory-row__tags">
            {getStatusBadges(row).map((badge) => (
              <span className={badge.className} key={badge.label}>
                {badge.label}
              </span>
            ))}
          </div>
        </section>

        <div className="leg-inventory-drawer__foot">
          {sourcePath ? (
            <button className="ghost-button" onClick={() => onNavigateToSource(row)} type="button">
              查看来源
            </button>
          ) : null}
          {row.reference_count <= 0 ? (
            <button className="ghost-button" onClick={() => onArchiveCandidate(row)} type="button">
              归档
            </button>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function LegEditDrawer({
  onClose,
  onSavePending,
  row,
}: {
  onClose: () => void;
  onSavePending: (row: ApiLegInventoryRow) => void;
  row: ApiLegInventoryRow;
}): JSX.Element {
  const displayName = formatLegDisplayName({
    leg_kind: row.leg_type,
    name: row.name,
    config: row.config,
    source_ref_id: row.source_ref_id,
  });
  const pit = getPitSnapshotPreview(row);
  const metrics = getMetricPreview(row);
  const identitySubtitle = getIdentitySubtitle(row);
  const note = getDetailNote(row);

  return (
    <div className="leg-inventory-drawer-layer">
      <button
        aria-label="关闭编辑抽屉"
        className="leg-inventory-drawer__overlay"
        onClick={onClose}
        type="button"
      />
      <aside aria-label="编辑腿部定义" className="leg-inventory-drawer" role="dialog">
        <div className="leg-inventory-drawer__header">
          <div className="leg-inventory-drawer__title">
            <div className="leg-inventory-drawer__icon">编</div>
            <div className="leg-inventory-drawer__copy">
              <p className="page-heading__eyebrow">资产库 / 编辑</p>
              <h2>编辑{getLegTypeLabel(row.leg_type)}</h2>
              <p>沿用创建抽屉的字段结构预览当前定义；保存接口接入前不会改写运行时数据。</p>
            </div>
          </div>
          <button className="ghost-button" onClick={onClose} type="button">
            关闭
          </button>
        </div>

        <div className="leg-inventory-drawer__body" data-drawer-kind="edit">
          <section className="leg-inventory-drawer__section">
            <div className="leg-inventory-drawer__copy">
              <strong>身份定义</strong>
              <p>保留易读名称、内部标识与来源身份，便于后续接入真实编辑保存。</p>
            </div>
            <div className="leg-inventory-drawer__field-grid">
              <div className="leg-inventory-drawer__field">
                <label htmlFor="leg-edit-name">腿部名称</label>
                <input id="leg-edit-name" readOnly value={displayName} />
              </div>
              <div className="leg-inventory-drawer__field">
                <label htmlFor="leg-edit-id">内部标识</label>
                <input id="leg-edit-id" readOnly value={row.id} />
              </div>
              <div className="leg-inventory-drawer__field leg-inventory-drawer__field--full">
                <label htmlFor="leg-edit-alias">标识别名</label>
                <input id="leg-edit-alias" readOnly value={identitySubtitle} />
              </div>
            </div>
          </section>

          <section className="leg-inventory-drawer__section">
            <div className="leg-inventory-drawer__copy">
              <strong>来源与参数</strong>
              <p>编辑前先核对 PIT 快照、核心参数和来源锚点，避免跨版本误改。</p>
            </div>
            <div className="leg-inventory-drawer__field-grid">
              <div className="leg-inventory-drawer__field">
                <label htmlFor="leg-edit-pit">PIT 快照版本</label>
                <input id="leg-edit-pit" readOnly value={`${pit.primary} · ${pit.secondary}`} />
              </div>
              <div className="leg-inventory-drawer__field">
                <label htmlFor="leg-edit-anchor">来源锚点</label>
                <input id="leg-edit-anchor" readOnly value={metrics.anchor} />
              </div>
              <div className="leg-inventory-drawer__field leg-inventory-drawer__field--full">
                <label htmlFor="leg-edit-metrics">核心参数</label>
                <textarea id="leg-edit-metrics" readOnly value={`${metrics.primary}\n${metrics.secondary}`} />
              </div>
            </div>
          </section>

          <section className="leg-inventory-drawer__section">
            <div className="leg-inventory-drawer__copy">
              <strong>维护备注</strong>
              <p>备注沿用当前来源审计说明，后续真实编辑接口接入后可在这里改写别名、标签和维护说明。</p>
            </div>
            <div className="leg-inventory-drawer__field-grid">
              <div className="leg-inventory-drawer__field leg-inventory-drawer__field--full">
                <label htmlFor="leg-edit-note">备注</label>
                <textarea id="leg-edit-note" readOnly value={note} />
              </div>
            </div>
            <div className="leg-inventory-drawer__callout">
              当前版本仅开放编辑入口和审计预览；真实保存需要后端 `PATCH` 契约后再启用。
            </div>
          </section>

          <div className="leg-inventory-drawer__foot">
            <button className="ghost-button" onClick={onClose} type="button">
              取消
            </button>
            <button
              className="primary-button"
              onClick={() => {
                onSavePending(row);
                onClose();
              }}
              type="button"
            >
              保存编辑
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

export function LegInventoryView({
  inventory,
  loading,
  error,
  onCreateAsset,
  onCreateCash,
  onSaveStrategy,
  strategyRows,
}: LegInventoryViewProps): JSX.Element {
  const [activeType, setActiveType] = useState<InventoryTypeFilter>('all');
  const [activeStatus, setActiveStatus] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [strategyDrawerOpen, setStrategyDrawerOpen] = useState(false);
  const [assetDrawerOpen, setAssetDrawerOpen] = useState(false);
  const [cashDrawerOpen, setCashDrawerOpen] = useState(false);
  const [detailRowId, setDetailRowId] = useState<string | null>(null);
  const [editRowId, setEditRowId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  const counts = inventory?.counts ?? { all: 0, strategy: 0, asset: 0, cash: 0 };
  const rows = inventory?.rows ?? [];
  const referencedCount = rows.filter((row) => row.reference_count > 0).length;
  const updateCount = rows.filter((row) => row.has_new_version || row.is_orphan).length;
  const orphanCount = rows.filter((row) => row.is_orphan).length;
  const detailRow = detailRowId ? rows.find((row) => row.id === detailRowId) ?? null : null;
  const editRow = editRowId ? rows.find((row) => row.id === editRowId) ?? null : null;

  const filteredRows = rows.filter((row) => {
    if (activeType !== 'all' && row.leg_type !== activeType) {
      return false;
    }
    if (activeStatus !== 'all') {
      if (activeStatus === 'has_new_version') {
        return row.has_new_version;
      }
      if (activeStatus === 'orphan') {
        return row.is_orphan;
      }
      if (activeStatus === 'referenced') {
        return row.reference_count > 0;
      }
      if (
        String(row.status || '').toUpperCase() !== activeStatus.toUpperCase() &&
        getRowStatusLabel(row) !== activeStatus
      ) {
        return false;
      }
    }
    if (!deferredSearch) {
      return true;
    }
    const haystack = [
      row.name,
      row.version_label,
      row.proof_label,
      row.reference_summary,
      ...row.attribute_tags,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(deferredSearch);
  });

  function openStrategyDrawer(): void {
    setStrategyDrawerOpen(true);
    setAssetDrawerOpen(false);
    setCashDrawerOpen(false);
    setMenuOpen(false);
  }

  function openAssetDrawer(): void {
    setStrategyDrawerOpen(false);
    setAssetDrawerOpen(true);
    setCashDrawerOpen(false);
    setMenuOpen(false);
  }

  function openCashDrawer(): void {
    setStrategyDrawerOpen(false);
    setCashDrawerOpen(true);
    setAssetDrawerOpen(false);
    setMenuOpen(false);
  }

  function handleSaveStrategy(row: ApiLegInventoryRow): void {
    onSaveStrategy(row);
    setStrategyDrawerOpen(false);
    setToastMessage('创建策略腿成功，已加入策略资产库。');
    navigateTo('/legs');
  }

  function navigateToSource(row: ApiLegInventoryRow): void {
    const sourcePath = getAssetSourcePath(row);
    if (sourcePath) {
      navigateTo(sourcePath);
    }
  }

  function archiveCandidate(row: ApiLegInventoryRow): void {
    setToastMessage(`「${row.name}」已标记为归档候选，正式归档需等待运行时接口接入。`);
  }

  function markEditPending(row: ApiLegInventoryRow): void {
    setToastMessage(`「${row.name}」已打开编辑预览；真实保存需等待运行时编辑接口接入。`);
  }

  return (
    <div
      className="leg-inventory-page stack"
      data-page-root="leg-inventory"
      data-route-root="legs"
    >
      <section className="leg-inventory-hero">
        <div className="leg-inventory-hero__header">
          <div className="leg-inventory-hero__copy">
            <p className="page-heading__eyebrow">资产库</p>
            <h1>策略资产库</h1>
            <p>统一管理策略腿、资产腿与现金腿的定义、版本与引用关系，作为正式组合的来源底座。</p>
          </div>
          <div className="leg-inventory-hero__actions">
            <div className="leg-inventory-split">
              <button className="primary-button" onClick={openStrategyDrawer} type="button">
                + 新建腿
              </button>
              <button
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                className="primary-button leg-inventory-split__toggle"
                onClick={() => setMenuOpen((current) => !current)}
                type="button"
              >
                ▼
              </button>
              {menuOpen ? (
                <div className="leg-inventory-menu" role="menu">
                  <button className="leg-inventory-menu__item" onClick={openStrategyDrawer} role="menuitem" type="button">
                    <strong>策略腿</strong>
                    <span>从已验证的策略版本中选择入库来源，并固定参数口径、组合角色与回测证明。</span>
                  </button>
                  <button className="leg-inventory-menu__item" onClick={openAssetDrawer} role="menuitem" type="button">
                    <strong>资产腿</strong>
                    <span>完成资产定义、来源快照绑定与估值口径设置。</span>
                  </button>
                  <button className="leg-inventory-menu__item" onClick={openCashDrawer} role="menuitem" type="button">
                    <strong>现金腿</strong>
                    <span>定义现金缓冲、再平衡节奏与成本吸收规则。</span>
                  </button>
                </div>
              ) : null}
            </div>
            <button className="ghost-button" onClick={() => navigateTo('/compositions')} type="button">
              返回仪表板
            </button>
          </div>
        </div>

        <div className="leg-inventory-hero__chips">
          <span className="leg-inventory-chip leg-inventory-chip--accent">
            策略腿 {counts.strategy} 条
          </span>
          <span className="leg-inventory-chip">资产腿 {counts.asset} 条</span>
          <span className="leg-inventory-chip">现金腿 {counts.cash} 条</span>
          <span className="leg-inventory-chip">引用关系可追溯</span>
        </div>
      </section>

      <section className="leg-inventory-panel">
        <div className="leg-inventory-panel__header">
          <div className="leg-inventory-panel__copy">
            <h2>全局统计</h2>
            <p>概览库存规模、引用深度与版本变更情况，用于判断来源是否继续沿用或需要升级。</p>
          </div>
        </div>
        <div className="leg-inventory-stat-grid">
          <article className="leg-inventory-stat">
            <span>全部腿</span>
            <strong>{counts.all}</strong>
            <small>
              其中策略腿 {counts.strategy} 条，资产腿 {counts.asset} 条，现金腿 {counts.cash} 条。
            </small>
          </article>
          <article className="leg-inventory-stat">
            <span>已被组合引用</span>
            <strong>{referencedCount}</strong>
            <small>只统计已经进入已保存组合的来源对象。</small>
          </article>
          <article className="leg-inventory-stat">
            <span>待处理对象</span>
            <strong>{updateCount}</strong>
            <small>包含有新版本提示与尚无合格证明的投影来源。</small>
          </article>
          <article className="leg-inventory-stat">
            <span>孤儿 / 待补跑</span>
            <strong>{orphanCount}</strong>
            <small>仅策略腿可能出现孤儿状态，需补回测后再纳入正式组合。</small>
          </article>
        </div>
      </section>

      <section className="leg-inventory-panel">
        <div className="leg-inventory-panel__header">
          <div className="leg-inventory-panel__copy">
            <h2>过滤工具栏</h2>
            <p>按来源类型、版本状态与组合引用关系查看库存，支持识别核心来源、待升级对象与孤儿条目。</p>
          </div>
        </div>

        <div className="leg-inventory-toolbar leg-inventory-toolbar-shell">
          <input
            aria-label="搜索资产库"
            className="leg-inventory-search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索名称、版本、快照或标签"
            value={search}
          />

          <div className="leg-inventory-toolbar__group" role="tablist" aria-label="腿类型筛选">
            {(
              [
                { value: 'all', label: '全部', count: counts.all },
                { value: 'strategy', label: '策略腿', count: counts.strategy },
                { value: 'asset', label: '资产腿', count: counts.asset },
                { value: 'cash', label: '现金腿', count: counts.cash },
              ] as Array<{ value: InventoryTypeFilter; label: string; count: number }>
            ).map((filter) => (
              <button
                aria-selected={activeType === filter.value}
                className={activeType === filter.value ? 'leg-inventory-filter leg-inventory-filter--active' : 'leg-inventory-filter'}
                key={filter.value}
                onClick={() => setActiveType(filter.value)}
                role="tab"
                type="button"
              >
                {filter.label} {filter.count}
              </button>
            ))}
          </div>

          <div className="leg-inventory-toolbar__group" aria-label="状态筛选">
            <button
              className={activeStatus === 'all' ? 'leg-inventory-filter leg-inventory-filter--active' : 'leg-inventory-filter'}
              onClick={() => setActiveStatus('all')}
              type="button"
            >
              全部状态
            </button>
            <button
              className={activeStatus === 'has_new_version' ? 'leg-inventory-filter leg-inventory-filter--active' : 'leg-inventory-filter'}
              onClick={() => setActiveStatus('has_new_version')}
              type="button"
            >
              有新版本
            </button>
            <button
              className={activeStatus === 'orphan' ? 'leg-inventory-filter leg-inventory-filter--active' : 'leg-inventory-filter'}
              onClick={() => setActiveStatus('orphan')}
              type="button"
            >
              孤儿腿
            </button>
            <button
              className={activeStatus === 'referenced' ? 'leg-inventory-filter leg-inventory-filter--active' : 'leg-inventory-filter'}
              onClick={() => setActiveStatus('referenced')}
              type="button"
            >
              已被引用
            </button>
          </div>

          <div className="leg-inventory-toolbar__group leg-inventory-toolbar__group--version" aria-label="版本状态">
            <button
              className={activeStatus === 'ACTIVE' ? 'leg-inventory-filter leg-inventory-filter--active' : 'leg-inventory-filter'}
              onClick={() => setActiveStatus('ACTIVE')}
              type="button"
            >
              稳定
            </button>
            <button
              className={activeStatus === 'NEEDS_RUN' ? 'leg-inventory-filter leg-inventory-filter--active' : 'leg-inventory-filter'}
              onClick={() => setActiveStatus('NEEDS_RUN')}
              type="button"
            >
              待更新
            </button>
            <button
              className={activeStatus === 'DRAFT' ? 'leg-inventory-filter leg-inventory-filter--active' : 'leg-inventory-filter'}
              onClick={() => setActiveStatus('DRAFT')}
              type="button"
            >
              草稿
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <div className="error-banner" role="alert">
          {error}
        </div>
      ) : null}

      {toastMessage ? (
        <div className="leg-inventory-toast" role="status">
          {toastMessage}
        </div>
      ) : null}

      <section className="leg-inventory-panel">
        <div className="leg-inventory-panel__header">
          <div className="leg-inventory-panel__copy">
            <h2>腿部清单</h2>
            <p>按来源类型、版本状态与组合引用关系查看库存，支持识别核心来源、待升级对象与孤儿条目。</p>
          </div>
          <span className="leg-inventory-chip">
            当前结果 {filteredRows.length} 条
          </span>
        </div>

        {loading ? (
          <p className="leg-inventory-empty">正在加载资产库清单...</p>
        ) : filteredRows.length === 0 ? (
          <p className="leg-inventory-empty">当前筛选下没有匹配项，可以调整标签或直接新建资产腿 / 现金腿。</p>
        ) : (
          <div className="leg-inventory-table-shell leg-inventory-table-panel">
            <table className="leg-inventory-table">
              <thead>
                <tr>
                  <th>理由名称 / 标识名称 / ID</th>
                  <th>类型</th>
                  <th>快照版本 (PIT Date)</th>
                  <th>核心参数 / 来源锚点</th>
                  <th>组合渗透率 / 引用</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const assetSourcePath = getAssetSourcePath(row);
                  const displayName = formatLegDisplayName({
                    leg_kind: row.leg_type,
                    name: row.name,
                    config: row.config,
                    source_ref_id: row.source_ref_id,
                  });
                  const pit = getPitSnapshotPreview(row);
                  const metrics = getMetricPreview(row);
                  return (
                    <tr
                      className="leg-inventory-row"
                      key={row.id}
                      onClick={() => setDetailRowId(row.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setDetailRowId(row.id);
                        }
                      }}
                      tabIndex={0}
                    >
                      <td>
                        <div className="leg-inventory-row__identity">
                          <div className="leg-inventory-row__name">
                            <strong>{displayName}</strong>
                            <span>{getIdentitySubtitle(row)}</span>
                            <span className="leg-inventory-row__mono">{row.id}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`leg-inventory-type-badge leg-inventory-type-badge--${row.leg_type}`}>
                          {getLegTypeLabel(row.leg_type)}
                        </span>
                        <div className="leg-inventory-row__detail">
                          {String(row.config?.asset_kind ?? row.config?.cash_rule_kind ?? row.source_ref_type ?? '').replace(/_/g, ' ') || '来源腿'}
                        </div>
                      </td>
                      <td>
                        <div className="leg-inventory-row__detail">
                          <strong>{pit.primary}</strong>
                          <div>{pit.secondary}</div>
                        </div>
                      </td>
                      <td>
                        <div className="leg-inventory-row__detail">
                          <strong>{metrics.primary}</strong>
                          <div>{metrics.secondary}</div>
                          <div className="leg-inventory-row__mono">{metrics.anchor}</div>
                        </div>
                      </td>
                      <td>
                        <div className="leg-inventory-row__reference">
                          <strong>{row.reference_count} 个组合</strong>
                          <div>{getReferenceSummary(row)}</div>
                        </div>
                      </td>
                      <td>
                        <div className="leg-inventory-row__tags">
                          {getStatusBadges(row).map((badge) => (
                            <span className={badge.className} key={badge.label}>
                              {badge.label}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div className="leg-inventory-row__actions">
                          <button
                            className="ghost-button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setDetailRowId(row.id);
                            }}
                            type="button"
                          >
                            详情
                          </button>
                          <button
                            className="ghost-button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setEditRowId(row.id);
                            }}
                            type="button"
                          >
                            编辑
                          </button>
                          {row.leg_type === 'asset' && assetSourcePath ? (
                            <button
                              className="ghost-button"
                              onClick={(event) => {
                                event.stopPropagation();
                                navigateTo(assetSourcePath);
                              }}
                              type="button"
                            >
                              查看来源
                            </button>
                          ) : null}
                          {row.reference_count <= 0 ? (
                            <button
                              className="ghost-button"
                              onClick={(event) => {
                                event.stopPropagation();
                                archiveCandidate(row);
                              }}
                              type="button"
                            >
                              归档
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
        )}
      </section>

      <section className="leg-inventory-panel leg-inventory-principles">
        <div className="leg-inventory-panel__header">
          <div className="leg-inventory-panel__copy">
            <h2>管理原则</h2>
            <p>所有正式组合均从已冻结且可追溯的腿部来源读取定义，变更前先完成引用影响评估。</p>
          </div>
        </div>
        <div className="leg-inventory-task-list">
          <article className="leg-inventory-task-card">
            <div className="leg-inventory-task-head">
              <strong>依赖追踪</strong>
              <span className="leg-inventory-status leg-inventory-status--accent">核心</span>
            </div>
            <p>任何被正式组合引用的腿都必须显式显示引用计数，避免用户在无感知状态下修改核心来源。</p>
          </article>
          <article className="leg-inventory-task-card">
            <div className="leg-inventory-task-head">
              <strong>版本审计</strong>
              <span className="leg-inventory-status">持续</span>
            </div>
            <p>更优回测或新代码提交只会触发提示，不会自动升级当前引用，保持版本判断权在用户手里。</p>
          </article>
          <article className="leg-inventory-task-card">
            <div className="leg-inventory-task-head">
              <strong>孤儿清理</strong>
              <span className="leg-inventory-status leg-inventory-status--warning">清洁度</span>
            </div>
            <p>长时间未被任何组合引用的腿进入待清理列表，帮助系统保持研究资产洁净度。</p>
          </article>
        </div>
      </section>

      <StrategyLegDrawer
        onClose={() => setStrategyDrawerOpen(false)}
        onSaveAndAdd={handleSaveStrategy}
        open={strategyDrawerOpen}
        rows={strategyRows ?? rows}
      />
      <AssetLegDrawer
        onClose={() => setAssetDrawerOpen(false)}
        onSubmit={onCreateAsset}
        open={assetDrawerOpen}
      />
      <CashLegDrawer
        onClose={() => setCashDrawerOpen(false)}
        onSubmit={onCreateCash}
        open={cashDrawerOpen}
      />
      {detailRow ? (
        <LegDetailDrawer
          onArchiveCandidate={archiveCandidate}
          onClose={() => setDetailRowId(null)}
          onNavigateToSource={navigateToSource}
          row={detailRow}
        />
      ) : null}
      {editRow ? (
        <LegEditDrawer
          onClose={() => setEditRowId(null)}
          onSavePending={markEditPending}
          row={editRow}
        />
      ) : null}
    </div>
  );
}

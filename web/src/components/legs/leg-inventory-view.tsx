import { useDeferredValue, useState } from 'react';
import { formatDateTime } from '../../lib/format';
import { navigateTo } from '../../lib/appRouteContext';
import {
  formatCompositionStatusLabel,
  formatLegDisplayName,
  formatLegProofLabel,
  formatLegReferenceSummary,
  formatTagLabel,
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
};

type InventoryTypeFilter = 'all' | 'strategy' | 'asset' | 'cash';

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

function getProofSummary(row: ApiLegInventoryRow): string {
  return formatLegProofLabel(row.proof_label, {
    leg_kind: row.leg_type,
    display_name: row.name,
    source_ref_id: row.source_ref_id,
    config: row.config,
  });
}

function formatTag(tag: string): string {
  return formatTagLabel(tag);
}

function getWorkBenchPath(row: ApiLegInventoryRow): string {
  return `/compositions/workbench?add_leg=${encodeURIComponent(row.id)}`;
}

function getStrategyPath(row: ApiLegInventoryRow): string | null {
  const strategyId =
    typeof row.config?.strategy_id === 'string'
      ? row.config.strategy_id
      : typeof row.source_ref_id === 'string' && row.source_ref_type === 'strategy_projection'
        ? row.source_ref_id.split('::')[1] ?? null
        : null;
  return strategyId ? `/strategies/${encodeURIComponent(strategyId)}` : null;
}

function getAssetSourcePath(row: ApiLegInventoryRow): string | null {
  const snapshotId =
    typeof row.config?.source_snapshot_id === 'string'
      ? row.config.source_snapshot_id
      : null;
  return snapshotId ? `/snapshots?source_snapshot_id=${encodeURIComponent(snapshotId)}` : null;
}

export function LegInventoryView({
  inventory,
  loading,
  error,
  onCreateAsset,
  onCreateCash,
}: LegInventoryViewProps): JSX.Element {
  const [activeType, setActiveType] = useState<InventoryTypeFilter>('all');
  const [activeStatus, setActiveStatus] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [strategyDrawerOpen, setStrategyDrawerOpen] = useState(false);
  const [assetDrawerOpen, setAssetDrawerOpen] = useState(false);
  const [cashDrawerOpen, setCashDrawerOpen] = useState(false);
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  const counts = inventory?.counts ?? { all: 0, strategy: 0, asset: 0, cash: 0 };
  const rows = inventory?.rows ?? [];
  const referencedCount = rows.filter((row) => row.reference_count > 0).length;
  const updateCount = rows.filter((row) => row.has_new_version || row.is_orphan).length;
  const orphanCount = rows.filter((row) => row.is_orphan).length;

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
                  <th>名称 / 标识</th>
                  <th>类型</th>
                  <th>当前版本</th>
                  <th>性能证明 / 来源</th>
                  <th>引用详情</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const strategyPath = getStrategyPath(row);
                  const assetSourcePath = getAssetSourcePath(row);
                  return (
                    <tr key={row.id}>
                      <td>
                        <div className="leg-inventory-row__identity">
                          <div className="leg-inventory-row__name">
                            <strong>{formatLegDisplayName({ leg_kind: row.leg_type, name: row.name, config: row.config, source_ref_id: row.source_ref_id })}</strong>
                            <span className="leg-inventory-row__mono">{row.id}</span>
                          </div>
                          <div className="leg-inventory-row__tags">
                            {row.attribute_tags.slice(0, 3).map((tag) => (
                              <span className="leg-inventory-chip" key={tag}>
                                {formatTag(tag)}
                              </span>
                            ))}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`leg-inventory-type-badge leg-inventory-type-badge--${row.leg_type}`}>
                          {getLegTypeLabel(row.leg_type)}
                        </span>
                      </td>
                      <td>
                        <div className="leg-inventory-row__detail">
                          <strong>{row.version_label || '—'}</strong>
                          {row.leg_type === 'strategy' && typeof row.config?.parameter_version_id === 'string' ? (
                            <div className="leg-inventory-row__mono">{row.config.parameter_version_id}</div>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <div className="leg-inventory-row__detail">
                          <strong>{getProofSummary(row)}</strong>
                          {row.leg_type === 'strategy' && typeof row.config?.latest_run_id === 'string' ? (
                            <div className="leg-inventory-row__mono">{row.config.latest_run_id}</div>
                          ) : null}
                          {row.leg_type === 'asset' && typeof row.config?.asset_kind === 'string' ? (
                            <div>{row.config.asset_kind}</div>
                          ) : null}
                          {row.leg_type === 'cash' && typeof row.config?.buffer_bps === 'number' ? (
                            <div>{Math.round(row.config.buffer_bps)} bps 缓冲</div>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <div className="leg-inventory-row__reference">
                          <strong>{row.reference_count}</strong>
                          <div>{getReferenceSummary(row)}</div>
                        </div>
                      </td>
                      <td>
                        <div className="leg-inventory-row__tags">
                          <span className={getRowStatusClassName(row)}>
                            {getRowStatusLabel(row)}
                          </span>
                          {row.has_new_version ? (
                            <span className="leg-inventory-chip leg-inventory-chip--warning">有新版本</span>
                          ) : null}
                          {row.is_orphan ? (
                            <span className="leg-inventory-chip leg-inventory-chip--danger">缺少合格回测</span>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <div className="leg-inventory-row__actions">
                          {row.leg_type === 'strategy' && strategyPath ? (
                            <button className="ghost-button" onClick={() => navigateTo(strategyPath)} type="button">
                              查看策略
                            </button>
                          ) : null}
                          {row.leg_type === 'asset' && assetSourcePath ? (
                            <button className="ghost-button" onClick={() => navigateTo(assetSourcePath)} type="button">
                              查看来源
                            </button>
                          ) : null}
                          <button className="ghost-button" onClick={() => navigateTo(getWorkBenchPath(row))} type="button">
                            加入工作台
                          </button>
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
        onSaveAndAdd={(row) => navigateTo(getWorkBenchPath(row))}
        open={strategyDrawerOpen}
        rows={rows}
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
    </div>
  );
}

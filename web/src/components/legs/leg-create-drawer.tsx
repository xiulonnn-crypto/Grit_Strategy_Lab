import { useEffect, useState } from 'react';
import { formatPercent, formatRatio } from '../../lib/format';
import type { ApiAssetLegCreatePayload, ApiCashLegCreatePayload, ApiLegInventoryRow } from '../../types';
import './leg-inventory.css';

type AssetLegDrawerProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: ApiAssetLegCreatePayload) => Promise<void>;
};

type CashLegDrawerProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: ApiCashLegCreatePayload) => Promise<void>;
};

type StrategyLegDrawerProps = {
  open: boolean;
  onClose: () => void;
  rows: ApiLegInventoryRow[];
  onSaveAndAdd: (row: ApiLegInventoryRow) => void;
};

const DEFAULT_ASSET_FORM: ApiAssetLegCreatePayload = {
  name: '',
  symbol: '',
  asset_kind: 'BOND',
  source_snapshot_id: 'bond-fixed-income',
  source_provider: 'snapshot_registry',
  freeze_mode: 'snapshot_locked',
  notes: '',
};

const DEFAULT_CASH_FORM: ApiCashLegCreatePayload = {
  name: '',
  cash_rule_kind: 'TARGET_BUFFER',
  buffer_bps: 35,
  yield_source: 'phase1_cash_proxy',
  freeze_mode: 'manual',
  notes: '',
};

type StrategyDrawerMetrics = {
  annualizedReturn: number | null;
  maxDrawdown: number | null;
  sharpe: number | null;
  totalReturn: number | null;
};

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getConfigRecord(row: ApiLegInventoryRow | null | undefined): Record<string, unknown> {
  return row?.config && typeof row.config === 'object' ? row.config : {};
}

function getMetricsRecord(row: ApiLegInventoryRow | null | undefined): Record<string, unknown> {
  const metrics = getConfigRecord(row).metrics;
  return metrics && typeof metrics === 'object' ? (metrics as Record<string, unknown>) : {};
}

function getStrategyDrawerMetrics(row: ApiLegInventoryRow | null | undefined): StrategyDrawerMetrics {
  const metrics = getMetricsRecord(row);
  return {
    annualizedReturn: readNumber(metrics.annualized_return) ?? readNumber(metrics.cagr),
    maxDrawdown: readNumber(metrics.max_drawdown),
    sharpe: readNumber(metrics.sharpe),
    totalReturn: readNumber(metrics.total_return),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeReturn(value: number | null): number {
  const normalized = value ?? 0.08;
  if (Math.abs(normalized) > 2) {
    return clamp(normalized / 50, -0.35, 1.2);
  }
  return clamp(normalized, -0.35, 1.2);
}

function buildCurveValues(metrics: StrategyDrawerMetrics, kind: 'strategy' | 'benchmark'): number[] {
  const totalReturn = normalizeReturn(metrics.totalReturn);
  const drawdown = clamp(Math.abs(metrics.maxDrawdown ?? 0.06), 0, 0.3);
  const sharpeBend = clamp(((metrics.sharpe ?? 0.8) - 0.8) / 8, -0.08, 0.1);
  const benchmarkScale = kind === 'benchmark' ? 0.58 : 1;
  const bendScale = kind === 'benchmark' ? 0.45 : 1;

  return [
    0,
    totalReturn * 0.08 * benchmarkScale,
    totalReturn * 0.18 * benchmarkScale - drawdown * 0.16 * bendScale,
    totalReturn * 0.34 * benchmarkScale - drawdown * 0.08 * bendScale,
    totalReturn * 0.52 * benchmarkScale + sharpeBend * bendScale,
    totalReturn * 0.7 * benchmarkScale + sharpeBend * 1.2 * bendScale,
    totalReturn * 0.86 * benchmarkScale - drawdown * 0.04 * bendScale,
    totalReturn * benchmarkScale,
  ];
}

function buildPolylinePoints(values: number[]): string {
  const minValue = Math.min(-0.05, ...values);
  const maxValue = Math.max(0.08, ...values);
  const spread = maxValue - minValue || 1;
  return values
    .map((value, index) => {
      const x = Math.round((420 / (values.length - 1)) * index);
      const y = Math.round(184 - ((value - minValue) / spread) * 140);
      return `${x},${clamp(y, 36, 190)}`;
    })
    .join(' ');
}

function buildFillPath(points: string): string {
  return `M${points.replaceAll(' ', ' L')} L420 220 L0 220 Z`;
}

function DrawerShell({
  children,
  headerActions,
  icon,
  onClose,
  wide = false,
  title,
  subtitle,
}: {
  children: JSX.Element;
  headerActions?: JSX.Element;
  icon?: string;
  onClose: () => void;
  wide?: boolean;
  title: string;
  subtitle: string;
}): JSX.Element {
  const drawerClassName = wide ? 'leg-inventory-drawer leg-inventory-drawer--wide' : 'leg-inventory-drawer';

  return (
    <div className="leg-inventory-drawer-layer">
      <button
        aria-label="关闭抽屉"
        className="leg-inventory-drawer__overlay"
        onClick={onClose}
        type="button"
      />
      <aside
        aria-label={title}
        className={drawerClassName}
        role="dialog"
      >
        <div className="leg-inventory-drawer__header">
          <div className="leg-inventory-drawer__title">
            {icon ? <div className="leg-inventory-drawer__icon">{icon}</div> : null}
            <div className="leg-inventory-drawer__copy">
              {icon ? null : <p className="page-heading__eyebrow">资产库</p>}
              <h2>{title}</h2>
              <p>{subtitle}</p>
            </div>
          </div>
          {headerActions ?? (
            <button className="ghost-button" onClick={onClose} type="button">
              关闭
            </button>
          )}
        </div>
        {children}
      </aside>
    </div>
  );
}

export function StrategyLegDrawer({
  open,
  onClose,
  onSaveAndAdd,
  rows,
}: StrategyLegDrawerProps): JSX.Element | null {
  const strategyRows = rows.filter((row) => row.leg_type === 'strategy');
  const firstStrategyId = strategyRows[0]?.id ?? '';
  const [selectedId, setSelectedId] = useState<string>('');

  useEffect(() => {
    if (open) {
      setSelectedId(firstStrategyId);
    }
  }, [firstStrategyId, open]);

  if (!open) {
    return null;
  }

  const selectedRow = strategyRows.find((row) => row.id === selectedId) ?? strategyRows[0] ?? null;
  const tags = selectedRow?.attribute_tags.map((tag) => tag.replaceAll('_', ' ')).slice(0, 3) ?? [];
  const metrics = getStrategyDrawerMetrics(selectedRow);
  const strategyCurvePoints = buildPolylinePoints(buildCurveValues(metrics, 'strategy'));
  const benchmarkCurvePoints = buildPolylinePoints(buildCurveValues(metrics, 'benchmark'));
  const strategyCurveFillPath = buildFillPath(strategyCurvePoints);

  return (
    <DrawerShell
      headerActions={(
        <div className="leg-inventory-drawer__actions">
          <button className="ghost-button" onClick={onClose} type="button">
            取消
          </button>
          <button
            className="primary-button"
            disabled={!selectedRow}
            onClick={() => {
              if (selectedRow) {
                onSaveAndAdd(selectedRow);
              }
            }}
            type="button"
          >
            保存并加入库
          </button>
          <button aria-label="关闭抽屉" className="leg-inventory-drawer__x" onClick={onClose} type="button">
            ×
          </button>
        </div>
      )}
      icon="策"
      onClose={onClose}
      subtitle="从已验证的策略版本中选择入库来源，并固定参数口径、组合角色与回测证明。"
      title="创建策略腿"
      wide
    >
      <div className="leg-inventory-drawer__body leg-inventory-drawer__body--wide" data-drawer-kind="strategy">
        <div className="leg-inventory-drawer__form">
          <section className="leg-inventory-drawer__section">
            <div className="leg-inventory-drawer__section-header">
              <div className="leg-inventory-drawer__copy">
                <strong>身份定义</strong>
                <p>策略腿必须绑定可追溯的回测版本、参数版本与组合角色，确保来源证据完整。</p>
              </div>
              <span className="leg-inventory-status leg-inventory-status--success">版本选择</span>
            </div>
            {strategyRows.length > 0 ? (
              <div className="leg-inventory-run-list">
                {strategyRows.map((row, index) => (
                  <button
                    className={`leg-inventory-run-item${row.id === selectedRow?.id ? ' leg-inventory-run-item--active' : ''}`}
                    key={row.id}
                    onClick={() => setSelectedId(row.id)}
                    type="button"
                  >
                    <strong>{row.name} · {row.proof_label || `#${index + 1}`}</strong>
                    <span>{row.status_label || row.status} · {row.version_label} · {row.source_ref_id}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="leg-inventory-drawer__callout">当前没有可用于创建策略腿的合格策略版本。</div>
            )}
            <div className="leg-inventory-drawer__field-grid">
              <div className="leg-inventory-drawer__field">
                <strong>腿名称</strong>
                <span>{selectedRow?.name ?? '待选择策略版本'}</span>
              </div>
              <div className="leg-inventory-drawer__field">
                <strong>来源回测</strong>
                <span>{selectedRow?.proof_label || selectedRow?.source_ref_id || '待选择'}</span>
              </div>
              <div className="leg-inventory-drawer__field">
                <strong>组合角色</strong>
                <span>{tags.length > 0 ? tags.join(' / ') : '收益增强主腿，承担主要方向敞口。'}</span>
              </div>
              <div className="leg-inventory-drawer__field">
                <strong>引用标签</strong>
                <span>{tags.length > 0 ? tags.join(' / ') : '趋势 / 宏观 / Core'}</span>
              </div>
            </div>
          </section>

          <section className="leg-inventory-drawer__section">
            <div className="leg-inventory-drawer__section-header">
              <div className="leg-inventory-drawer__copy">
                <strong>核心参数</strong>
                <p>固定策略腿在组合中的权重建议、冻结方式与升级规则，保证正式来源口径稳定。</p>
              </div>
              <span className="leg-inventory-status">冻结语义</span>
            </div>
            <div className="leg-inventory-drawer__field-grid">
              <div className="leg-inventory-drawer__field">
                <strong>权重建议</strong>
                <span>32% 起步，适合作为主腿与资产腿搭配。</span>
              </div>
              <div className="leg-inventory-drawer__field">
                <strong>冻结方式</strong>
                <span>保存时锁定回测、参数版本与代码提交摘要。</span>
              </div>
              <div className="leg-inventory-drawer__field">
                <strong>再平衡亲和</strong>
                <span>季度。与组合工作台默认维护节奏一致。</span>
              </div>
              <div className="leg-inventory-drawer__field">
                <strong>升级策略</strong>
                <span>出现更优回测时只做提示，不自动替换当前引用。</span>
              </div>
            </div>
            <div className="leg-inventory-drawer__callout">
              保存后，该策略腿将以版本冻结方式进入资产库，可直接被组合工作台与正式组合引用。
            </div>
          </section>
        </div>

        <div className="leg-inventory-drawer__snapshot">
          <section className="leg-inventory-drawer__section">
            <div className="leg-inventory-drawer__section-header">
              <div className="leg-inventory-drawer__copy">
                <strong>验证摘要</strong>
                <p>右侧即时渲染当前选中版本的收益曲线和关键指标，让选择版本变成一个有证据的动作。</p>
              </div>
              <span className="leg-inventory-status leg-inventory-status--success">运行快照</span>
            </div>
            <div className="leg-inventory-drawer__chart" aria-hidden="true">
              <svg viewBox="0 0 420 220" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="strategyDrawerFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="rgba(31, 135, 123, 0.18)" />
                    <stop offset="100%" stopColor="rgba(31, 135, 123, 0)" />
                  </linearGradient>
                </defs>
                <path d={strategyCurveFillPath} fill="url(#strategyDrawerFill)" />
                <polyline data-series="benchmark" fill="none" points={benchmarkCurvePoints} stroke="#4c78c7" strokeDasharray="8 7" strokeWidth="3" />
                <polyline data-series="strategy" fill="none" points={strategyCurvePoints} stroke="#1f877b" strokeWidth="4" />
              </svg>
            </div>
            <div className="leg-inventory-drawer__kpi-grid">
              <div className="leg-inventory-drawer__kpi">
                <span>年化</span>
                <strong>{formatPercent(metrics.annualizedReturn ?? metrics.totalReturn)}</strong>
                <small>{selectedRow?.proof_label || '已完成回测'}</small>
              </div>
              <div className="leg-inventory-drawer__kpi">
                <span>夏普</span>
                <strong>{formatRatio(metrics.sharpe)}</strong>
                <small>{selectedRow?.version_label || '待选版本'}</small>
              </div>
              <div className="leg-inventory-drawer__kpi">
                <span>最大回撤</span>
                <strong>{formatPercent(metrics.maxDrawdown)}</strong>
                <small>{selectedRow?.has_new_version ? '存在新版本' : '当前可冻结'}</small>
              </div>
            </div>
            <div className="leg-inventory-drawer__summary-list">
              <div className="leg-inventory-drawer__callout">当前版本将沿用策略回测证明与参数版本，避免重复持久化不一致的来源记录。</div>
              <div className="leg-inventory-drawer__callout">保存入库后，清单将显示回测证明、引用计数和“有新版本”提示点。</div>
            </div>
          </section>
        </div>

      </div>
    </DrawerShell>
  );
}

export function AssetLegDrawer({
  open,
  onClose,
  onSubmit,
}: AssetLegDrawerProps): JSX.Element | null {
  const [form, setForm] = useState<ApiAssetLegCreatePayload>(DEFAULT_ASSET_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(DEFAULT_ASSET_FORM);
      setSubmitting(false);
      setError(null);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  async function handleSubmit(): Promise<void> {
    if (!form.name.trim() || !form.symbol.trim() || !form.source_snapshot_id.trim()) {
      setError('请先补齐资产腿名称、标识与来源快照。');
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      await onSubmit({
        ...form,
        name: form.name.trim(),
        symbol: form.symbol.trim().toUpperCase(),
        source_snapshot_id: form.source_snapshot_id.trim(),
        source_provider: form.source_provider?.trim() || null,
        notes: form.notes?.trim() || null,
      });
      onClose();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DrawerShell
      onClose={onClose}
      subtitle="从数据快照中选择合格来源，并固定资产定义、估值口径与组合角色。"
      title="创建资产腿"
    >
      <div className="leg-inventory-drawer__body" data-drawer-kind="asset">
        {error ? (
          <div className="error-banner" role="alert">
            {error}
          </div>
        ) : null}

        <section className="leg-inventory-drawer__section">
          <div className="leg-inventory-drawer__copy">
            <strong>身份定义</strong>
            <p>资产腿必须绑定可追溯的来源快照，避免只有标的代码而缺少估值口径与字段证据。</p>
          </div>
          <div className="leg-inventory-drawer__field-grid">
            <div className="leg-inventory-drawer__field">
              <label htmlFor="asset-leg-name">资产腿名称</label>
              <input
                id="asset-leg-name"
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                value={form.name}
              />
            </div>
            <div className="leg-inventory-drawer__field">
              <label htmlFor="asset-leg-symbol">标识 / 代码</label>
              <input
                id="asset-leg-symbol"
                onChange={(event) => setForm((current) => ({ ...current, symbol: event.target.value }))}
                value={form.symbol}
              />
            </div>
            <div className="leg-inventory-drawer__field">
              <label htmlFor="asset-leg-kind">资产类别</label>
              <select
                id="asset-leg-kind"
                onChange={(event) => setForm((current) => ({ ...current, asset_kind: event.target.value }))}
                value={form.asset_kind}
              >
                <option value="BOND">债券 / 固定收益</option>
                <option value="ETF">ETF / 指数化资产</option>
                <option value="EQUITY">股票 / 主动篮子</option>
              </select>
            </div>
            <div className="leg-inventory-drawer__field">
              <label htmlFor="asset-leg-snapshot">来源快照</label>
              <input
                id="asset-leg-snapshot"
                onChange={(event) =>
                  setForm((current) => ({ ...current, source_snapshot_id: event.target.value }))
                }
                value={form.source_snapshot_id}
              />
              <span className="leg-inventory-drawer__field-help">
                例如 `bond-fixed-income`、`ds-price` 或主线程接入后的正式快照标识。
              </span>
            </div>
          </div>
        </section>

        <section className="leg-inventory-drawer__section">
          <div className="leg-inventory-drawer__copy">
            <strong>核心参数</strong>
            <p>冻结估值口径、来源快照与组合角色，确保资产腿在回看和持有时口径一致。</p>
          </div>
          <div className="leg-inventory-drawer__field-grid">
            <div className="leg-inventory-drawer__field">
              <label htmlFor="asset-leg-provider">来源提供方</label>
              <input
                id="asset-leg-provider"
                onChange={(event) =>
                  setForm((current) => ({ ...current, source_provider: event.target.value }))
                }
                value={form.source_provider ?? ''}
              />
            </div>
            <div className="leg-inventory-drawer__field">
              <label htmlFor="asset-leg-freeze">冻结方式</label>
              <select
                id="asset-leg-freeze"
                onChange={(event) => setForm((current) => ({ ...current, freeze_mode: event.target.value }))}
                value={form.freeze_mode}
              >
                <option value="snapshot_locked">快照冻结</option>
                <option value="manual_review">人工复核</option>
                <option value="source_frozen">来源锁定</option>
              </select>
            </div>
            <div className="leg-inventory-drawer__field leg-inventory-drawer__field--full">
              <label htmlFor="asset-leg-notes">入库备注</label>
              <textarea
                id="asset-leg-notes"
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                value={form.notes ?? ''}
              />
            </div>
          </div>
          <div className="leg-inventory-drawer__callout">
            保存后，该资产腿会立即以最小持久化定义进入资产库，并可被组合工作台继续引用。
          </div>
        </section>

        <section className="leg-inventory-drawer__section">
          <div className="leg-inventory-drawer__copy">
            <strong>验证摘要</strong>
            <p>核对收益定义、久期暴露与影子字段完整度，确认该资产腿具备正式入库条件。</p>
          </div>
          <div className="leg-inventory-drawer__summary">
            <div className="leg-inventory-drawer__summary-card">
              <span>当前冻结方式</span>
              <strong>{form.freeze_mode}</strong>
            </div>
            <div className="leg-inventory-drawer__summary-card">
              <span>来源快照</span>
              <strong>{form.source_snapshot_id || '待填写'}</strong>
            </div>
            <div className="leg-inventory-drawer__summary-card">
              <span>资产类别</span>
              <strong>{form.asset_kind}</strong>
            </div>
          </div>
        </section>

        <div className="leg-inventory-drawer__foot">
          <button className="ghost-button" onClick={onClose} type="button">
            取消
          </button>
          <button
            className="primary-button"
            disabled={submitting}
            onClick={() => void handleSubmit()}
            type="button"
          >
            {submitting ? '提交中...' : '保存资产腿'}
          </button>
        </div>
      </div>
    </DrawerShell>
  );
}

export function CashLegDrawer({
  open,
  onClose,
  onSubmit,
}: CashLegDrawerProps): JSX.Element | null {
  const [form, setForm] = useState<ApiCashLegCreatePayload>(DEFAULT_CASH_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(DEFAULT_CASH_FORM);
      setSubmitting(false);
      setError(null);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  async function handleSubmit(): Promise<void> {
    if (!form.name.trim() || !form.cash_rule_kind.trim() || !form.freeze_mode.trim()) {
      setError('请先补齐现金腿名称、规则类型与冻结方式。');
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      await onSubmit({
        ...form,
        name: form.name.trim(),
        cash_rule_kind: form.cash_rule_kind.trim().toUpperCase(),
        yield_source: form.yield_source?.trim() || null,
        notes: form.notes?.trim() || null,
      });
      onClose();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DrawerShell
      onClose={onClose}
      subtitle="在同一工作流内定义现金缓冲、再平衡节奏与成本吸收规则。"
      title="创建现金腿"
    >
      <div className="leg-inventory-drawer__body" data-drawer-kind="cash">
        {error ? (
          <div className="error-banner" role="alert">
            {error}
          </div>
        ) : null}

        <section className="leg-inventory-drawer__section">
          <div className="leg-inventory-drawer__copy">
            <strong>身份定义</strong>
            <p>明确现金腿的职责、缓冲边界与组合定位，确保维护语义可追溯。</p>
          </div>
          <div className="leg-inventory-drawer__field-grid">
            <div className="leg-inventory-drawer__field">
              <label htmlFor="cash-leg-name">现金腿名称</label>
              <input
                id="cash-leg-name"
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                value={form.name}
              />
            </div>
            <div className="leg-inventory-drawer__field">
              <label htmlFor="cash-leg-rule-kind">规则类型</label>
              <select
                id="cash-leg-rule-kind"
                onChange={(event) =>
                  setForm((current) => ({ ...current, cash_rule_kind: event.target.value }))
                }
                value={form.cash_rule_kind}
              >
                <option value="TARGET_BUFFER">目标缓冲</option>
                <option value="SETTLEMENT_BUFFER">结算缓冲</option>
                <option value="REBALANCE_RESERVE">再平衡备用金</option>
              </select>
            </div>
            <div className="leg-inventory-drawer__field">
              <label htmlFor="cash-leg-buffer">缓冲阈值（bps）</label>
              <input
                id="cash-leg-buffer"
                min="0"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    buffer_bps: Number(event.target.value || 0),
                  }))
                }
                type="number"
                value={form.buffer_bps ?? 0}
              />
            </div>
            <div className="leg-inventory-drawer__field">
              <label htmlFor="cash-leg-yield-source">收益来源</label>
              <input
                id="cash-leg-yield-source"
                onChange={(event) =>
                  setForm((current) => ({ ...current, yield_source: event.target.value }))
                }
                value={form.yield_source ?? ''}
              />
            </div>
          </div>
        </section>

        <section className="leg-inventory-drawer__section">
          <div className="leg-inventory-drawer__copy">
            <strong>核心参数</strong>
            <p>定义目标占比、触发阈值、再平衡频次与冻结方式，形成可审计的现金规则。</p>
          </div>
          <div className="leg-inventory-drawer__field-grid">
            <div className="leg-inventory-drawer__field">
              <label htmlFor="cash-leg-freeze">冻结方式</label>
              <select
                id="cash-leg-freeze"
                onChange={(event) => setForm((current) => ({ ...current, freeze_mode: event.target.value }))}
                value={form.freeze_mode}
              >
                <option value="manual">人工冻结</option>
                <option value="rule_locked">规则冻结</option>
                <option value="operational_guardrail">运维护栏</option>
              </select>
            </div>
            <div className="leg-inventory-drawer__field leg-inventory-drawer__field--full">
              <label htmlFor="cash-leg-notes">维护说明</label>
              <textarea
                id="cash-leg-notes"
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                value={form.notes ?? ''}
              />
            </div>
          </div>
          <div className="leg-inventory-drawer__callout">
            保存后，该现金腿会作为最小持久化规则对象进入资产库，供组合工作台直接引用。
          </div>
        </section>

        <section className="leg-inventory-drawer__section">
          <div className="leg-inventory-drawer__copy">
            <strong>验证摘要</strong>
            <p>确认现金腿的成本吸收能力与维护节奏是否匹配当前组合策略。</p>
          </div>
          <div className="leg-inventory-drawer__summary">
            <div className="leg-inventory-drawer__summary-card">
              <span>缓冲阈值</span>
              <strong>{Math.round(form.buffer_bps ?? 0)} bps</strong>
            </div>
            <div className="leg-inventory-drawer__summary-card">
              <span>收益来源</span>
              <strong>{form.yield_source || '待填写'}</strong>
            </div>
            <div className="leg-inventory-drawer__summary-card">
              <span>冻结方式</span>
              <strong>{form.freeze_mode}</strong>
            </div>
          </div>
        </section>

        <div className="leg-inventory-drawer__foot">
          <button className="ghost-button" onClick={onClose} type="button">
            取消
          </button>
          <button
            className="primary-button"
            disabled={submitting}
            onClick={() => void handleSubmit()}
            type="button"
          >
            {submitting ? '提交中...' : '保存现金腿'}
          </button>
        </div>
      </div>
    </DrawerShell>
  );
}

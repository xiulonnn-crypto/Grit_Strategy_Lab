import { useEffect, useState } from 'react';
import type { ApiAssetLegCreatePayload, ApiCashLegCreatePayload } from '../../types';
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

function DrawerShell({
  children,
  onClose,
  title,
  subtitle,
}: {
  children: JSX.Element;
  onClose: () => void;
  title: string;
  subtitle: string;
}): JSX.Element {
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
        className="leg-inventory-drawer"
        role="dialog"
      >
        <div className="leg-inventory-drawer__header">
          <div className="leg-inventory-drawer__copy">
            <p className="page-heading__eyebrow">资产库</p>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button className="ghost-button" onClick={onClose} type="button">
            关闭
          </button>
        </div>
        {children}
      </aside>
    </div>
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

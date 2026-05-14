import { useEffect, useRef, useState } from 'react';
import { CompositionWorkbenchView } from '../components/composition-workbench/composition-workbench-view';
import { navigateTo, useAppRoute } from '../lib/appRouteContext';
import {
  formatBenchmarkLabel,
  formatCompositionDescription,
  formatCompositionName,
  formatCompositionStatusLabel,
} from '../lib/compose-display';
import { useApiClient } from '../lib/demoStoreContext';
import {
  buildCompositionReferenceCounts,
  buildStrategyCandidateRows,
  canUpgradeStrategyLegVersions,
  materializeSavedStrategyRows,
  mergeInventoryWithSavedStrategies,
  readSavedStrategyLegEdits,
  readSavedStrategyLegFreezes,
  readSavedStrategyLegIds,
  upgradeStrategyLegVersions,
} from '../lib/saved-strategy-leg-inventory';
import type {
  ApiCompositionCreatePayload,
  ApiCompositionDetail,
  ApiCompositionLegInput,
  ApiCompositionPreview,
  ApiCompositionPreviewPayload,
  ApiCompositionUpdatePayload,
  ApiLegInventory,
  ApiLegInventoryRow,
} from '../types';

const DEFAULT_BENCHMARK = '60/40 参考组合';
const DEFAULT_DESCRIPTION = '以策略腿、资产腿与现金腿构建可复核的正式组合。';
const FIRST_SCREEN_DEFER_MS = import.meta.env.MODE === 'test' ? 0 : 80;
const STARTER_WEIGHT_PRESETS: Record<number, number[]> = {
  1: [100],
  2: [60, 40],
  3: [40, 35, 25],
  4: [32, 24, 24, 20],
};

function buildDraftLegFromRow(row: ApiLegInventoryRow): ApiCompositionLegInput {
  return {
    leg_kind: row.leg_type,
    source_ref_id: row.source_ref_id ?? row.id,
    source_ref_type: row.source_ref_type ?? `${row.leg_type}_definition`,
    display_name: row.name,
    weight_pct: 0,
    weight_locked: false,
    ordering: 0,
    config: row.config,
  };
}

function roundWeight(value: number): number {
  return Math.max(0, Math.min(100, Number(value.toFixed(1))));
}

function distributeWeight(total: number, count: number): number[] {
  if (count <= 0) {
    return [];
  }
  const perWeight = total / count;
  const weights = Array.from({ length: count }, () => roundWeight(perWeight));
  const roundedTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const delta = roundWeight(total - roundedTotal);
  if (weights.length) {
    weights[weights.length - 1] = roundWeight(weights[weights.length - 1] + delta);
  }
  return weights;
}

function rebalanceUnlockedWeights(legs: ApiCompositionLegInput[]): ApiCompositionLegInput[] {
  const lockedWeight = legs.reduce(
    (total, leg) => total + (leg.weight_locked ? roundWeight(leg.weight_pct) : 0),
    0,
  );
  const unlockedIndexes = legs.flatMap((leg, index) => (leg.weight_locked ? [] : [index]));
  if (!unlockedIndexes.length) {
    return legs;
  }
  const available = Math.max(0, 100 - lockedWeight);
  const distribution = distributeWeight(available, unlockedIndexes.length);
  return legs.map((leg, index) => {
    const unlockedIndex = unlockedIndexes.indexOf(index);
    if (unlockedIndex === -1) {
      return leg;
    }
    return {
      ...leg,
      weight_pct: distribution[unlockedIndex] ?? 0,
    };
  });
}

function findInventoryRow(inventory: ApiLegInventory | null, sourceId?: string): ApiLegInventoryRow | null {
  if (!inventory || !sourceId) {
    return null;
  }
  return (
    inventory.rows.find((row) => row.id === sourceId) ??
    inventory.rows.find((row) => row.source_ref_id === sourceId) ??
    null
  );
}

function getRowConfig(row: ApiLegInventoryRow): Record<string, unknown> {
  return row.config ?? {};
}

function getConfigNumber(row: ApiLegInventoryRow, key: string): number {
  const value = getRowConfig(row)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function getConfigString(row: ApiLegInventoryRow, key: string): string | null {
  const value = getRowConfig(row)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getStrategyFamilyKey(row: ApiLegInventoryRow): string {
  return getConfigString(row, 'strategy_id') ?? row.source_ref_id ?? row.id;
}

function getStrategyStarterPriority(row: ApiLegInventoryRow): number {
  const statusPriority = row.status === 'READY' ? 4 : row.status === 'ACTIVE' ? 3 : row.status === 'STALE' ? 2 : 0;
  const runPriority = getConfigString(row, 'latest_run_id') ? 1 : 0;
  const returnPriority = getConfigNumber(row, 'annualized_return_pct');
  const sharpePriority = getConfigNumber(row, 'oos_sharpe');
  const versionPriority = getConfigNumber(row, 'parameter_version');
  return (
    statusPriority * 100000 +
    runPriority * 10000 +
    Math.max(returnPriority, 0) * 100 +
    Math.max(sharpePriority, 0) * 10 +
    versionPriority
  );
}

function selectStarterStrategies(rows: ApiLegInventoryRow[]): ApiLegInventoryRow[] {
  const selected: ApiLegInventoryRow[] = [];
  const seenFamilies = new Set<string>();
  const candidates = rows
    .filter((row) => row.leg_type === 'strategy')
    .filter((row) => row.status !== 'NEEDS_RUN')
    .filter((row) => !row.attribute_tags.includes('needs_run'))
    .sort((left, right) => getStrategyStarterPriority(right) - getStrategyStarterPriority(left));

  candidates.forEach((row) => {
    if (selected.length >= 2) {
      return;
    }
    const familyKey = getStrategyFamilyKey(row);
    if (seenFamilies.has(familyKey)) {
      return;
    }
    seenFamilies.add(familyKey);
    selected.push(row);
  });

  return selected;
}

function buildStarterLegsFromInventory(inventory: ApiLegInventory): ApiCompositionLegInput[] {
  const starterRows = [
    ...selectStarterStrategies(inventory.rows),
    inventory.rows.find((row) => row.leg_type === 'asset') ?? null,
    inventory.rows.find((row) => row.leg_type === 'cash') ?? null,
  ].filter((row): row is ApiLegInventoryRow => row !== null);

  const weights = STARTER_WEIGHT_PRESETS[starterRows.length] ?? distributeWeight(100, starterRows.length);
  return starterRows.map((row, index) => ({
    ...buildDraftLegFromRow(row),
    ordering: index,
    weight_locked: row.leg_type === 'asset',
    weight_pct: weights[index] ?? 0,
  }));
}

function buildPreviewPayload(params: {
  compositionName: string;
  description: string;
  benchmarkLabel: string;
  rebalanceFrequency: string;
  selectedLegs: ApiCompositionLegInput[];
}): ApiCompositionPreviewPayload {
  return {
    name: params.compositionName || '未命名组合',
    description: params.description || DEFAULT_DESCRIPTION,
    benchmark_definition: {
      label: params.benchmarkLabel || DEFAULT_BENCHMARK,
      symbol: params.benchmarkLabel || DEFAULT_BENCHMARK,
      source: 'phase1_compose',
    },
    rebalance_frequency: params.rebalanceFrequency || 'quarterly',
    legs: params.selectedLegs.map((leg, index) => ({
      ...leg,
      ordering: index + 1,
      weight_pct: roundWeight(leg.weight_pct),
    })),
  };
}

function buildDraftLegsFromDetail(detail: ApiCompositionDetail): ApiCompositionLegInput[] {
  return detail.normalized_legs.map((leg, index) => ({
    leg_kind: leg.leg_kind,
    source_ref_id: leg.source_ref_id,
    source_ref_type: leg.source_ref_type,
    display_name: leg.display_name,
    weight_pct: leg.weight_pct,
    weight_locked: leg.weight_locked,
    ordering: leg.ordering ?? index,
    config: leg.config,
  }));
}

type PendingVersionSave = {
  intent: 'DRAFT' | 'ACTIVE';
  payload: ApiCompositionCreatePayload;
  changes: string[];
  upgradedLegs: ApiCompositionLegInput[];
};

function normalizeVersionText(value?: string | null): string {
  return String(value ?? '').trim();
}

function getLegDiffKey(leg: ApiCompositionLegInput): string {
  return `${leg.leg_kind}|${leg.source_ref_id}`;
}

function buildVersionChangeList(
  baseDetail: ApiCompositionDetail | null,
  payload: ApiCompositionPreviewPayload,
): string[] {
  if (!baseDetail) {
    return ['当前组合配置将写入新的保存版本。'];
  }
  const changes: string[] = [];
  if (normalizeVersionText(baseDetail.name) !== normalizeVersionText(payload.name)) {
    changes.push(`名称：${baseDetail.name || '-'} -> ${payload.name || '-'}`);
  }
  if (normalizeVersionText(baseDetail.description) !== normalizeVersionText(payload.description)) {
    changes.push('描述已更新');
  }
  const baseBenchmark = normalizeVersionText(baseDetail.benchmark_definition?.label ?? baseDetail.benchmark_definition?.symbol);
  const nextBenchmark = normalizeVersionText(payload.benchmark_definition?.label ?? payload.benchmark_definition?.symbol);
  if (baseBenchmark !== nextBenchmark) {
    changes.push(`基准：${baseBenchmark || '-'} -> ${nextBenchmark || '-'}`);
  }
  if (normalizeVersionText(baseDetail.rebalance_frequency) !== normalizeVersionText(payload.rebalance_frequency)) {
    changes.push(`再平衡频次：${baseDetail.rebalance_frequency || '-'} -> ${payload.rebalance_frequency || '-'}`);
  }
  const baseCosts = baseDetail.cost_policy;
  const nextCosts = payload.cost_policy;
  if (nextCosts && (
    baseCosts.expense_ratio_bps !== nextCosts?.expense_ratio_bps ||
    baseCosts.turnover_budget_bps !== nextCosts?.turnover_budget_bps ||
    baseCosts.trade_cost_bps !== nextCosts?.trade_cost_bps
  )) {
    changes.push('成本规则已更新');
  }
  const baseLegs = new Map(buildDraftLegsFromDetail(baseDetail).map((leg) => [getLegDiffKey(leg), leg]));
  const nextLegs = new Map(payload.legs.map((leg) => [getLegDiffKey(leg), leg]));
  payload.legs.forEach((leg) => {
    const key = getLegDiffKey(leg);
    const previous = baseLegs.get(key);
    if (!previous) {
      changes.push(`新增腿：${leg.display_name || leg.source_ref_id}`);
      return;
    }
    if (Math.abs(previous.weight_pct - leg.weight_pct) >= 0.05) {
      changes.push(`${leg.display_name || leg.source_ref_id} 权重：${previous.weight_pct.toFixed(1)}% -> ${leg.weight_pct.toFixed(1)}%`);
    }
    if (Boolean(previous.weight_locked) !== Boolean(leg.weight_locked)) {
      changes.push(`${leg.display_name || leg.source_ref_id} 锁定状态已更新`);
    }
  });
  baseLegs.forEach((leg, key) => {
    if (!nextLegs.has(key)) {
      changes.push(`移除腿：${leg.display_name || leg.source_ref_id}`);
    }
  });
  return changes;
}

export function CompositionWorkbenchPage(): JSX.Element {
  const api = useApiClient();
  const { route } = useAppRoute();
  const routeCompositionId =
    route.kind === 'composition-workbench' ? route.compositionId : undefined;
  const routeAddLeg = route.kind === 'composition-workbench' ? route.addLeg : undefined;
  const addLegAppliedRef = useRef<string | null>(null);
  const starterAppliedRef = useRef(false);
  const initialPreviewRequestedRef = useRef(false);

  const [inventory, setInventory] = useState<ApiLegInventory | null>(null);
  const [preview, setPreview] = useState<ApiCompositionPreview | null>(null);
  const [compositionId, setCompositionId] = useState<string | null>(routeCompositionId ?? null);
  const [compositionName, setCompositionName] = useState('');
  const [description, setDescription] = useState(DEFAULT_DESCRIPTION);
  const [benchmarkLabel, setBenchmarkLabel] = useState(DEFAULT_BENCHMARK);
  const [rebalanceFrequency, setRebalanceFrequency] = useState('quarterly');
  const [selectedLegs, setSelectedLegs] = useState<ApiCompositionLegInput[]>([]);
  const [loadedDetail, setLoadedDetail] = useState<ApiCompositionDetail | null>(null);
  const [pendingVersionSave, setPendingVersionSave] = useState<PendingVersionSave | null>(null);
  const [versionReason, setVersionReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      if (!api.getLegInventory || !api.previewComposition || !api.createComposition || !api.updateComposition) {
        if (!cancelled) {
          setError('当前运行时尚未接入组合工作台所需接口，请先完成主线程 runtime wiring。');
          setLoading(false);
        }
        return;
      }

      try {
        if (!cancelled) {
          setLoading(true);
          setError(null);
        }
        const [inventoryResponse, detail] = await Promise.all([
          api.getLegInventory(),
          routeCompositionId && api.getCompositionDetail
            ? api.getCompositionDetail(routeCompositionId)
            : Promise.resolve<ApiCompositionDetail | null>(null),
        ]);
        const applyLoadedState = (nextInventory: ApiLegInventory) => {
          setInventory(nextInventory);
          setLoadedDetail(detail);
          if (detail) {
            setCompositionId(detail.id);
            setCompositionName(
              formatCompositionName({
                name: detail.name,
                benchmarkLabel:
                  detail.benchmark_definition?.label ?? detail.benchmark_definition?.symbol ?? null,
                status: detail.status,
              }),
            );
            setDescription(formatCompositionDescription(detail.description) ?? DEFAULT_DESCRIPTION);
            setBenchmarkLabel(
              formatBenchmarkLabel(
                detail.benchmark_definition?.label ?? detail.benchmark_definition?.symbol ?? null,
              ),
            );
            setRebalanceFrequency(detail.rebalance_frequency || 'quarterly');
            setSelectedLegs(buildDraftLegsFromDetail(detail));
          }
        };
        let enrichedInventory = inventoryResponse;
        const savedStrategyIds = readSavedStrategyLegIds();
        const detailStrategyIds =
          detail?.normalized_legs
            .filter((leg) => leg.leg_kind === 'strategy')
            .map((leg) => String(leg.source_ref_id ?? '').trim())
            .filter((sourceRefId) => sourceRefId.startsWith('strategy_leg::')) ?? [];
        const strategyIdsToMaterialize = [...new Set([...savedStrategyIds, ...detailStrategyIds])];
        const shouldDeferStarterUntilSavedStrategies =
          !detail && !routeAddLeg && savedStrategyIds.length > 0;
        if (!cancelled && !shouldDeferStarterUntilSavedStrategies) {
          applyLoadedState(inventoryResponse);
          setLoading(false);
        }
        if (strategyIdsToMaterialize.length > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, FIRST_SCREEN_DEFER_MS));
          try {
            const compositionDetailsPromise =
              api.listCompositions && api.getCompositionDetail
                ? api
                    .listCompositions()
                    .then((items) =>
                      Promise.all(
                        items
                          .filter((item) => String(item.status ?? '').toUpperCase() !== 'ARCHIVED')
                          .map((item) => api.getCompositionDetail!(item.id)),
                      ),
                    )
                    .catch(() => [])
                : Promise.resolve([]);
            const [strategies, runs, compositionDetails] = await Promise.all([
              api.listStrategies(),
              api.listBacktestRuns({ limit: 100 }),
              compositionDetailsPromise,
            ]);
            enrichedInventory =
              mergeInventoryWithSavedStrategies(
                inventoryResponse,
                materializeSavedStrategyRows(
                  strategyIdsToMaterialize,
                  buildStrategyCandidateRows(
                    strategies,
                    runs,
                    buildCompositionReferenceCounts(compositionDetails),
                  ),
                  [],
                  readSavedStrategyLegEdits(),
                  readSavedStrategyLegFreezes(),
                ),
              ) ?? inventoryResponse;
          } catch {
            // Saved strategy legs are additive; the base inventory should still render if they cannot be rehydrated.
            enrichedInventory = inventoryResponse;
          }
        }
        if (cancelled) {
          return;
        }
        applyLoadedState(enrichedInventory);
      } catch (caught) {
        if (!cancelled) {
          setError(`加载组合工作台失败：${(caught as Error).message}`);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [api, routeCompositionId]);

  useEffect(() => {
    if (!inventory || !routeAddLeg || addLegAppliedRef.current === routeAddLeg) {
      return;
    }
    const row = findInventoryRow(inventory, routeAddLeg);
    if (!row) {
      addLegAppliedRef.current = routeAddLeg;
      return;
    }
    addLegAppliedRef.current = routeAddLeg;
    setSelectedLegs((current) => {
      if (current.some((leg) => leg.source_ref_id === (row.source_ref_id ?? row.id))) {
        return current;
      }
      const appended = [...current, buildDraftLegFromRow(row)].map((leg, index) => ({
        ...leg,
        ordering: index,
      }));
      return rebalanceUnlockedWeights(appended);
    });
  }, [inventory, routeAddLeg]);

  useEffect(() => {
    if (starterAppliedRef.current || !inventory || routeCompositionId || routeAddLeg) {
      return;
    }
    starterAppliedRef.current = true;
    setSelectedLegs((current) => {
      if (current.length) {
        return current;
      }
      return buildStarterLegsFromInventory(inventory);
    });
  }, [inventory, routeAddLeg, routeCompositionId]);

  useEffect(() => {
    const previewComposition = api.previewComposition;
    if (!previewComposition) {
      return;
    }
    if (!selectedLegs.length) {
      setPreview(null);
      return;
    }

    let cancelled = false;
    const delayMs = initialPreviewRequestedRef.current ? 120 : FIRST_SCREEN_DEFER_MS;
    const timer = window.setTimeout(async () => {
      initialPreviewRequestedRef.current = true;
      try {
        if (!cancelled) {
          setPreviewLoading(true);
        }
        const response = await previewComposition(
          buildPreviewPayload({
            compositionName,
            description,
            benchmarkLabel,
            rebalanceFrequency,
            selectedLegs,
          }),
        );
        if (!cancelled) {
          setPreview(response);
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(`刷新组合预演失败：${(caught as Error).message}`);
        }
      } finally {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      }
    }, delayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [api, benchmarkLabel, compositionName, description, rebalanceFrequency, selectedLegs]);

  function handleAddLeg(row: ApiLegInventoryRow): void {
    setSelectedLegs((current) => {
      const sourceRefId = row.source_ref_id ?? row.id;
      if (current.some((leg) => leg.source_ref_id === sourceRefId)) {
        return current;
      }
      const appended = [...current, buildDraftLegFromRow(row)].map((leg, index) => ({
        ...leg,
        ordering: index,
      }));
      return rebalanceUnlockedWeights(appended);
    });
  }

  function handleRemoveLeg(sourceRefId: string): void {
    setSelectedLegs((current) => {
      const next = current
        .filter((leg) => leg.source_ref_id !== sourceRefId)
        .map((leg, index) => ({ ...leg, ordering: index }));
      return rebalanceUnlockedWeights(next);
    });
  }

  function handleWeightChange(sourceRefId: string, nextWeight: number): void {
    setSelectedLegs((current) =>
      current.map((leg) =>
        leg.source_ref_id === sourceRefId
          ? { ...leg, weight_pct: roundWeight(nextWeight) }
          : leg,
      ),
    );
  }

  function handleToggleLock(sourceRefId: string): void {
    setSelectedLegs((current) =>
      current.map((leg) =>
        leg.source_ref_id === sourceRefId
          ? { ...leg, weight_locked: !leg.weight_locked }
          : leg,
      ),
    );
  }

  async function handlePersist(intent: 'DRAFT' | 'ACTIVE'): Promise<void> {
    if (!api.createComposition || !api.updateComposition) {
      setError('当前运行时尚未接入组合保存接口。');
      return;
    }
    const inventoryRows = inventory?.rows ?? [];
    const shouldUpgradeStrategyVersions =
      intent === 'ACTIVE' && canUpgradeStrategyLegVersions(selectedLegs, inventoryRows);
    const legsToPersist = shouldUpgradeStrategyVersions
      ? upgradeStrategyLegVersions(selectedLegs, inventoryRows)
      : selectedLegs;
    const payload = {
      ...buildPreviewPayload({
        compositionName,
        description,
        benchmarkLabel,
        rebalanceFrequency,
        selectedLegs: legsToPersist,
      }),
      status: intent,
    };
    if (compositionId) {
      const changes = buildVersionChangeList(loadedDetail, payload);
      const statusChanged = loadedDetail ? loadedDetail.status !== intent : false;
      if (!changes.length) {
        if (statusChanged) {
          await commitPersist({ intent, payload, changes, upgradedLegs: legsToPersist });
        } else {
          setError('当前组合参数没有变化，未生成新的配置版本。');
        }
        return;
      }
      setVersionReason('');
      setPendingVersionSave({ intent, payload, changes, upgradedLegs: legsToPersist });
      return;
    }
    await commitPersist({ intent, payload, changes: [], upgradedLegs: legsToPersist });
    return;
  }

  async function commitPersist(save: PendingVersionSave): Promise<void> {
    if (!api.createComposition || !api.updateComposition) {
      setError('当前运行时尚未接入组合保存接口。');
      return;
    }
    const reason = versionReason.trim();
    if (compositionId && save.changes.length && !reason) {
      setError('请填写升级理由后再确认版本。');
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const updatePayload = compositionId && save.changes.length
        ? {
            ...save.payload,
            version_reason: reason,
            version_change_summary: save.changes.join('；'),
            version_source: 'manual_save',
          }
        : save.payload;
      const saved = compositionId
        ? await api.updateComposition(compositionId, updatePayload)
        : await api.createComposition(save.payload);
      if (save.upgradedLegs !== selectedLegs) {
        setSelectedLegs(save.upgradedLegs);
      }
      setCompositionId(saved.id);
      setLoadedDetail(saved);
      setPendingVersionSave(null);
      setVersionReason('');
      navigateTo(`/compositions/${encodeURIComponent(saved.id)}`);
    } catch (caught) {
      setError(`保存组合失败：${(caught as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <CompositionWorkbenchView
        benchmarkLabel={benchmarkLabel}
        compositionName={compositionName}
        description={description}
        error={error}
        inventory={inventory}
        loading={loading}
        statusLabel={formatCompositionStatusLabel('DRAFT')}
        onAddLeg={handleAddLeg}
        onBenchmarkLabelChange={setBenchmarkLabel}
        onCompositionNameChange={setCompositionName}
        onDescriptionChange={setDescription}
        onPersist={handlePersist}
        onRebalanceFrequencyChange={setRebalanceFrequency}
        onRemoveLeg={handleRemoveLeg}
        onToggleLock={handleToggleLock}
        onWeightChange={handleWeightChange}
        preview={preview}
        previewLoading={previewLoading}
        rebalanceFrequency={rebalanceFrequency}
        saving={saving}
        selectedLegs={selectedLegs}
      />
      {pendingVersionSave ? (
        <div className="composition-workbench-version-dialog-backdrop" role="presentation">
          <section
            aria-labelledby="composition-version-dialog-title"
            aria-modal="true"
            className="composition-workbench-version-dialog"
            role="dialog"
          >
            <div className="composition-workbench-version-dialog__header">
              <div>
                <p className="eyebrow">配置升级确认</p>
                <h2 id="composition-version-dialog-title">确认升级组合版本</h2>
                <p>保存会生成新的配置版本，请核对参数变化并填写升级理由。</p>
              </div>
            </div>
            <div className="composition-workbench-version-dialog__changes">
              {pendingVersionSave.changes.map((change) => (
                <span key={change}>{change}</span>
              ))}
            </div>
            <label className="composition-workbench-version-dialog__reason">
              <span>升级理由</span>
              <textarea
                aria-label="升级理由"
                onChange={(event) => setVersionReason(event.target.value)}
                placeholder="例如：降低策略腿集中度，采用配置实验室建议。"
                value={versionReason}
              />
            </label>
            <div className="composition-workbench-version-dialog__actions">
              <button
                className="ghost-button"
                onClick={() => {
                  setPendingVersionSave(null);
                  setVersionReason('');
                }}
                type="button"
              >
                取消
              </button>
              <button
                className="primary-button"
                disabled={!versionReason.trim() || saving}
                onClick={() => {
                  void commitPersist(pendingVersionSave);
                }}
                type="button"
              >
                {saving ? '保存中…' : '确认升级版本'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

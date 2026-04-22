import { useEffect, useRef, useState } from 'react';
import { CompositionWorkbenchView } from '../components/composition-workbench/composition-workbench-view';
import { navigateTo, useAppRoute } from '../lib/appRouteContext';
import {
  formatBenchmarkLabel,
  formatCompositionDescription,
  formatCompositionName,
} from '../lib/compose-display';
import { useApiClient } from '../lib/demoStoreContext';
import type {
  ApiCompositionDetail,
  ApiCompositionLegInput,
  ApiCompositionPreview,
  ApiCompositionPreviewPayload,
  ApiLegInventory,
  ApiLegInventoryRow,
} from '../types';

const DEFAULT_BENCHMARK = '60/40 参考组合';
const DEFAULT_DESCRIPTION = '以策略腿、资产腿与现金腿构建可复核的正式组合。';

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

export function CompositionWorkbenchPage(): JSX.Element {
  const api = useApiClient();
  const { route } = useAppRoute();
  const routeCompositionId =
    route.kind === 'composition-workbench' ? route.compositionId : undefined;
  const routeAddLeg = route.kind === 'composition-workbench' ? route.addLeg : undefined;
  const addLegAppliedRef = useRef<string | null>(null);

  const [inventory, setInventory] = useState<ApiLegInventory | null>(null);
  const [preview, setPreview] = useState<ApiCompositionPreview | null>(null);
  const [compositionId, setCompositionId] = useState<string | null>(routeCompositionId ?? null);
  const [compositionName, setCompositionName] = useState('');
  const [description, setDescription] = useState(DEFAULT_DESCRIPTION);
  const [benchmarkLabel, setBenchmarkLabel] = useState(DEFAULT_BENCHMARK);
  const [rebalanceFrequency, setRebalanceFrequency] = useState('quarterly');
  const [selectedLegs, setSelectedLegs] = useState<ApiCompositionLegInput[]>([]);
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
        const inventoryResponse = await api.getLegInventory();
        if (cancelled) {
          return;
        }
        setInventory(inventoryResponse);

        if (routeCompositionId && api.getCompositionDetail) {
          const detail = await api.getCompositionDetail(routeCompositionId);
          if (cancelled) {
            return;
          }
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
    const previewComposition = api.previewComposition;
    if (!previewComposition) {
      return;
    }
    if (!selectedLegs.length) {
      setPreview(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
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
    }, 120);

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
    try {
      setSaving(true);
      setError(null);
      const payload = {
        ...buildPreviewPayload({
          compositionName,
          description,
          benchmarkLabel,
          rebalanceFrequency,
          selectedLegs,
        }),
        status: intent,
      };
      const saved = compositionId
        ? await api.updateComposition(compositionId, payload)
        : await api.createComposition(payload);
      setCompositionId(saved.id);
      navigateTo(`/compositions/${encodeURIComponent(saved.id)}`);
    } catch (caught) {
      setError(`保存组合失败：${(caught as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <CompositionWorkbenchView
      benchmarkLabel={benchmarkLabel}
      compositionName={compositionName}
      description={description}
      error={error}
      inventory={inventory}
      loading={loading}
      modeLabel={compositionId ? `编辑组合 ${compositionId}` : '新建组合'}
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
  );
}

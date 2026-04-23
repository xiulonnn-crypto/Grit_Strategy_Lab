import { useEffect, useMemo, useState } from 'react';
import { LegInventoryView } from '../components/legs/leg-inventory-view';
import { useApiClient } from '../lib/demoStoreContext';
import type {
  ApiAssetLegCreatePayload,
  ApiBacktestRunListItem,
  ApiCashLegCreatePayload,
  ApiLegInventory,
  ApiLegInventoryRow,
  ApiStrategyListItem,
} from '../types';

const ELIGIBLE_STRATEGY_RUN_STATUSES = new Set(['COMPLETED', 'COMPLETED_WITH_WARNINGS']);
const SAVED_STRATEGY_LEG_STORAGE_KEY = 'grit.legInventory.savedStrategyLegIds.v1';

function readSavedStrategyLegIds(): string[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(SAVED_STRATEGY_LEG_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return [...new Set(parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))];
  } catch {
    return [];
  }
}

function writeSavedStrategyLegIds(ids: string[]): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(SAVED_STRATEGY_LEG_STORAGE_KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    // Losing the preference is safer than blocking the save flow.
  }
}

function materializeSavedStrategyRows(
  ids: string[],
  strategyRows: ApiLegInventoryRow[],
  currentRows: ApiLegInventoryRow[] = [],
): ApiLegInventoryRow[] {
  const byId = new Map([...currentRows, ...strategyRows].map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}

function getRunSortTime(run: ApiBacktestRunListItem): number {
  const timestamp = run.completed_at ?? run.updated_at ?? run.created_at ?? '';
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getStrategyVersionLabel(strategy: ApiStrategyListItem | undefined, parameterVersionId: string): string {
  if (strategy?.current_parameter_version_id === parameterVersionId && strategy.current_parameter_version) {
    return `v${strategy.current_parameter_version}`;
  }
  const match = parameterVersionId.match(/(?:^|-)v(\d+)$/i);
  return match ? `v${match[1]}` : parameterVersionId;
}

function buildStrategyCandidateRows(
  strategies: ApiStrategyListItem[],
  runs: ApiBacktestRunListItem[],
): ApiLegInventoryRow[] {
  const strategyById = new Map(strategies.map((strategy) => [strategy.id, strategy]));
  const latestRunByStrategy = new Map<string, ApiBacktestRunListItem>();

  runs
    .filter((run) => ELIGIBLE_STRATEGY_RUN_STATUSES.has(String(run.status ?? '').toUpperCase()))
    .filter((run) => Boolean(run.strategy_id && run.parameter_version_id))
    .sort((left, right) => getRunSortTime(right) - getRunSortTime(left))
    .forEach((run) => {
      if (!latestRunByStrategy.has(run.strategy_id)) {
        latestRunByStrategy.set(run.strategy_id, run);
      }
    });

  return Array.from(latestRunByStrategy.values()).map((run): ApiLegInventoryRow => {
    const strategy = strategyById.get(run.strategy_id);
    const parameterVersionId = run.parameter_version_id as string;
    const rowId = `strategy_leg::${run.strategy_id}::${parameterVersionId}`;
    const tags = [
      'strategy',
      strategy?.strategy_type?.toLowerCase(),
      strategy?.universe_name ? `universe:${strategy.universe_name}` : null,
      strategy?.benchmark_symbol ? `benchmark:${strategy.benchmark_symbol}` : null,
    ].filter((tag): tag is string => Boolean(tag));

    return {
      id: rowId,
      leg_type: 'strategy',
      name: strategy?.name ?? run.strategy_name ?? run.strategy_id,
      version_label: getStrategyVersionLabel(strategy, parameterVersionId),
      proof_label: run.id,
      reference_count: 0,
      reference_summary: 'Not used in saved compositions yet',
      status: 'ACTIVE',
      status_label: run.status === 'COMPLETED_WITH_WARNINGS' ? '已完成，有警告' : '已完成回测',
      has_new_version:
        Boolean(strategy?.current_parameter_version_id) &&
        strategy?.current_parameter_version_id !== parameterVersionId,
      is_orphan: false,
      attribute_tags: tags,
      allowed_actions: ['open_strategy_detail', 'open_composition_workbench'],
      source_ref_id: rowId,
      source_ref_type: 'strategy_projection',
      config: {
        strategy_id: run.strategy_id,
        parameter_version_id: parameterVersionId,
        latest_run_id: run.id,
        run_id: run.id,
        metrics: run.metrics ?? null,
        start_date: run.start_date ?? null,
        end_date: run.end_date ?? null,
        trades_count: run.trades_count ?? null,
        rebalance_frequency: strategy?.rebalance_frequency ?? null,
      },
    };
  });
}

function buildInventoryFilterItems(
  rows: ApiLegInventoryRow[],
  readValue: (row: ApiLegInventoryRow) => string | null | undefined,
  readLabel?: (row: ApiLegInventoryRow) => string | null | undefined,
): ApiLegInventory['filters']['statuses'] {
  const counts = new Map<string, number>();
  const labels = new Map<string, string>();
  rows.forEach((row) => {
    const value = readValue(row);
    if (!value) {
      return;
    }
    counts.set(value, (counts.get(value) ?? 0) + 1);
    labels.set(value, readLabel?.(row) || value);
  });
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([value, count]) => ({ value, label: labels.get(value) ?? value, count }));
}

function mergeInventoryWithSavedStrategies(
  inventory: ApiLegInventory | null,
  savedStrategyRows: ApiLegInventoryRow[],
): ApiLegInventory | null {
  if (!inventory || savedStrategyRows.length === 0) {
    return inventory;
  }
  const savedIds = new Set(savedStrategyRows.map((row) => row.id));
  const rows = [
    ...savedStrategyRows,
    ...inventory.rows.filter((row) => !savedIds.has(row.id)),
  ];
  return {
    ...inventory,
    counts: {
      all: rows.length,
      strategy: rows.filter((row) => row.leg_type === 'strategy').length,
      asset: rows.filter((row) => row.leg_type === 'asset').length,
      cash: rows.filter((row) => row.leg_type === 'cash').length,
    },
    filters: {
      statuses: buildInventoryFilterItems(rows, (row) => row.status, (row) => row.status_label),
      attribute_tags: buildInventoryFilterItems(
        rows.flatMap((row) =>
          row.attribute_tags.map((tag) => ({
            ...row,
            status: tag,
            status_label: tag,
          })),
        ),
        (row) => row.status,
        (row) => row.status_label,
      ),
    },
    rows,
  };
}

export function LegInventoryPage(): JSX.Element {
  const api = useApiClient();
  const [inventory, setInventory] = useState<ApiLegInventory | null>(null);
  const [strategyCandidates, setStrategyCandidates] = useState<ApiLegInventoryRow[]>([]);
  const [savedStrategyRows, setSavedStrategyRows] = useState<ApiLegInventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const displayedInventory = useMemo(
    () => mergeInventoryWithSavedStrategies(inventory, savedStrategyRows),
    [inventory, savedStrategyRows],
  );

  async function loadInventory(): Promise<void> {
    if (!api.getLegInventory) {
      setError('当前运行时还未接入资产库接口，请等待主线程完成 runtime wiring。');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const response = await api.getLegInventory();
      setInventory(response);
      const [strategies, runs] = await Promise.all([
        api.listStrategies(),
        api.listBacktestRuns({ limit: 100 }),
      ]);
      const candidateRows = buildStrategyCandidateRows(strategies, runs);
      setStrategyCandidates(candidateRows);
      setSavedStrategyRows((currentRows) =>
        materializeSavedStrategyRows(readSavedStrategyLegIds(), candidateRows, currentRows),
      );
    } catch (caught) {
      setError(`加载资产库失败：${(caught as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadInventory();
  }, [api]);

  async function handleCreateAsset(payload: ApiAssetLegCreatePayload): Promise<void> {
    if (!api.createAssetLeg) {
      throw new Error('当前运行时还未接入资产腿创建接口。');
    }
    await api.createAssetLeg(payload);
    await loadInventory();
  }

  async function handleCreateCash(payload: ApiCashLegCreatePayload): Promise<void> {
    if (!api.createCashLeg) {
      throw new Error('当前运行时还未接入现金腿创建接口。');
    }
    await api.createCashLeg(payload);
    await loadInventory();
  }

  function handleSaveStrategy(row: ApiLegInventoryRow): void {
    setSavedStrategyRows((current) => {
      const nextRows = [
        row,
        ...current.filter((item) => item.id !== row.id),
      ];
      writeSavedStrategyLegIds(nextRows.map((item) => item.id));
      return nextRows;
    });
  }

  return (
    <LegInventoryView
      error={error}
      inventory={displayedInventory}
      loading={loading}
      onCreateAsset={handleCreateAsset}
      onCreateCash={handleCreateCash}
      onSaveStrategy={handleSaveStrategy}
      strategyRows={strategyCandidates}
    />
  );
}

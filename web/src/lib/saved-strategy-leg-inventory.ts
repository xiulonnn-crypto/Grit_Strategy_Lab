import type {
  ApiBacktestRunListItem,
  ApiCompositionDetail,
  ApiLegInventory,
  ApiLegInventoryRow,
  ApiStrategyListItem,
} from '../types';

const ELIGIBLE_STRATEGY_RUN_STATUSES = new Set(['COMPLETED', 'COMPLETED_WITH_WARNINGS']);
export const SAVED_STRATEGY_LEG_STORAGE_KEY = 'grit.legInventory.savedStrategyLegIds.v1';
export const SAVED_STRATEGY_LEG_EDIT_STORAGE_KEY = 'grit.legInventory.savedStrategyLegEdits.v1';

export type SavedStrategyLegEditPayload = {
  name: string;
  freeze_mode: string;
  notes: string | null;
  summary: Record<string, unknown>;
};

export type SavedStrategyLegEditStore = Record<string, SavedStrategyLegEditPayload>;
export type StrategyLegReferenceCounts = Map<string, number> | Record<string, number>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readMetricNumber(
  metrics: ApiBacktestRunListItem['metrics'] | undefined,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const value = metrics?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function toPercentMetric(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  const percent = Math.abs(value) <= 1 ? value * 100 : value;
  return Number(percent.toFixed(2));
}

function getReferenceCount(
  referenceCounts: StrategyLegReferenceCounts | undefined,
  rowId: string,
): number {
  if (!referenceCounts) {
    return 0;
  }
  if (referenceCounts instanceof Map) {
    return referenceCounts.get(rowId) ?? 0;
  }
  const value = referenceCounts[rowId];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function buildReferenceSummary(referenceCount: number): string {
  if (referenceCount <= 0) {
    return 'Not used in saved compositions yet';
  }
  return referenceCount === 1
    ? 'Used in 1 saved composition'
    : `Used in ${referenceCount} saved compositions`;
}

export function buildCompositionReferenceCounts(
  compositionDetails: ApiCompositionDetail[],
): Map<string, number> {
  const counts = new Map<string, number>();
  compositionDetails
    .filter((detail) => String(detail.status ?? '').toUpperCase() !== 'ARCHIVED')
    .forEach((detail) => {
      detail.normalized_legs.forEach((leg) => {
        const sourceRefId = String(leg.source_ref_id ?? '').trim();
        if (sourceRefId) {
          counts.set(sourceRefId, (counts.get(sourceRefId) ?? 0) + 1);
        }
      });
    });
  return counts;
}

export function readSavedStrategyLegIds(): string[] {
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

export function writeSavedStrategyLegIds(ids: string[]): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(SAVED_STRATEGY_LEG_STORAGE_KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    // Losing the preference is safer than blocking the save flow.
  }
}

export function readSavedStrategyLegEdits(): SavedStrategyLegEditStore {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(SAVED_STRATEGY_LEG_EDIT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).flatMap(([id, value]) => {
        const record = asRecord(value);
        const name = typeof record.name === 'string' ? record.name : '';
        const freezeMode = typeof record.freeze_mode === 'string' ? record.freeze_mode : '';
        const notes = typeof record.notes === 'string' ? record.notes : null;
        const summary = asRecord(record.summary);
        if (!id || (!name && !freezeMode && notes === null && Object.keys(summary).length === 0)) {
          return [];
        }
        return [[id, { name, freeze_mode: freezeMode, notes, summary }]];
      }),
    );
  } catch {
    return {};
  }
}

export function writeSavedStrategyLegEdits(edits: SavedStrategyLegEditStore): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(SAVED_STRATEGY_LEG_EDIT_STORAGE_KEY, JSON.stringify(edits));
  } catch {
    // Losing the local override is safer than blocking the edit flow.
  }
}

export function applyStrategyLegEdit(
  row: ApiLegInventoryRow,
  edit?: SavedStrategyLegEditPayload,
): ApiLegInventoryRow {
  if (!edit) {
    return row;
  }
  const config = asRecord(row.config);
  const summary = {
    ...asRecord(config.summary),
    ...edit.summary,
  };
  if (edit.notes && edit.notes.trim()) {
    summary.notes = edit.notes.trim();
  } else if (edit.notes === null) {
    delete summary.notes;
  }
  return {
    ...row,
    name: edit.name.trim() || row.name,
    config: {
      ...config,
      freeze_mode: edit.freeze_mode.trim() || config.freeze_mode,
      summary,
    },
  };
}

function getRunSortTime(run: ApiBacktestRunListItem): number {
  const timestamp = run.completed_at ?? run.updated_at ?? run.created_at ?? '';
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getStrategyVersionLabel(
  strategy: ApiStrategyListItem | undefined,
  parameterVersionId: string,
): string {
  if (strategy?.current_parameter_version_id === parameterVersionId && strategy.current_parameter_version) {
    return `v${strategy.current_parameter_version}`;
  }
  const match = parameterVersionId.match(/(?:^|-)v(\d+)$/i);
  return match ? `v${match[1]}` : parameterVersionId;
}

export function buildStrategyLegDefaultName(row: ApiLegInventoryRow): string {
  const versionLabel = String(row.version_label ?? '').trim();
  if (!versionLabel || row.name.endsWith(`-${versionLabel}`)) {
    return row.name;
  }
  return `${row.name}-${versionLabel}`;
}

export function buildStrategyCandidateRows(
  strategies: ApiStrategyListItem[],
  runs: ApiBacktestRunListItem[],
  referenceCounts?: StrategyLegReferenceCounts,
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
    const referenceCount = getReferenceCount(referenceCounts, rowId);
    const annualizedReturnPct = toPercentMetric(
      readMetricNumber(run.metrics, 'annualized_return', 'cagr', 'oos_annualized_return'),
    );
    const maxDrawdownPct = toPercentMetric(
      readMetricNumber(run.metrics, 'max_drawdown_pct', 'max_drawdown', 'oos_max_drawdown'),
    );
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
      reference_count: referenceCount,
      reference_summary: buildReferenceSummary(referenceCount),
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
        annualized_return_pct: annualizedReturnPct ?? 0,
        max_drawdown_pct: Math.abs(maxDrawdownPct ?? 0),
        oos_sharpe: readMetricNumber(run.metrics, 'oos_sharpe', 'out_of_sample_sharpe', 'sharpe') ?? 0,
        start_date: run.start_date ?? null,
        end_date: run.end_date ?? null,
        trades_count: run.trades_count ?? null,
        rebalance_frequency: strategy?.rebalance_frequency ?? null,
      },
    };
  });
}

export function materializeSavedStrategyRows(
  ids: string[],
  strategyRows: ApiLegInventoryRow[],
  currentRows: ApiLegInventoryRow[] = [],
  edits: SavedStrategyLegEditStore = {},
): ApiLegInventoryRow[] {
  const byId = new Map([...currentRows, ...strategyRows].map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [applyStrategyLegEdit({ ...row, name: buildStrategyLegDefaultName(row) }, edits[id])] : [];
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

export function mergeInventoryWithSavedStrategies(
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

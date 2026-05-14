import type {
  ApiBacktestRunListItem,
  ApiCompositionDetail,
  ApiCompositionLegInput,
  ApiCompositionSourceIntegrity,
  ApiLegInventory,
  ApiLegInventoryRow,
  ApiStrategyListItem,
} from '../types';

const ELIGIBLE_STRATEGY_RUN_STATUSES = new Set(['COMPLETED', 'COMPLETED_WITH_WARNINGS']);
export const SAVED_STRATEGY_LEG_STORAGE_KEY = 'grit.legInventory.savedStrategyLegIds.v1';
export const SAVED_STRATEGY_LEG_EDIT_STORAGE_KEY = 'grit.legInventory.savedStrategyLegEdits.v1';
export const SAVED_STRATEGY_LEG_FREEZE_STORAGE_KEY = 'grit.legInventory.savedStrategyLegFreezes.v1';

export type SavedStrategyLegEditPayload = {
  name: string;
  freeze_mode: string;
  notes: string | null;
  summary: Record<string, unknown>;
};

export type SavedStrategyLegEditStore = Record<string, SavedStrategyLegEditPayload>;
export type SavedStrategyLegFreezePayload = {
  saved_at: string;
  frozen_row: ApiLegInventoryRow;
};
export type SavedStrategyLegFreezeStore = Record<string, SavedStrategyLegFreezePayload>;
export type StrategyLegReferenceCounts = Map<string, number> | Record<string, number>;
const NEWER_STRATEGY_RUN_ALERT = 'A newer completed run exists for the same strategy version and backtest period.';

const FROZEN_STRATEGY_RUN_CONFIG_KEYS = new Set([
  'latest_run_id',
  'run_id',
  'is_permanent',
  'metrics',
  'annualized_return_pct',
  'max_drawdown_pct',
  'oos_sharpe',
  'start_date',
  'end_date',
  'effective_date',
  'oos_start_date',
  'trades_count',
  'created_at',
  'updated_at',
  'completed_at',
  'run_created_at',
  'run_updated_at',
  'run_completed_at',
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readStringFromRecord(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
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

function normalizeSavedFreeze(id: string, value: unknown): SavedStrategyLegFreezePayload | null {
  const record = asRecord(value);
  const frozenRow = asRecord(record.frozen_row);
  const rowId = readStringFromRecord(frozenRow, 'id') ?? id;
  if (!rowId || readStringFromRecord(frozenRow, 'leg_type') !== 'strategy') {
    return null;
  }
  const savedAt =
    readStringFromRecord(record, 'saved_at') ??
    readStringFromRecord(frozenRow, 'created_at') ??
    new Date(0).toISOString();
  return {
    saved_at: savedAt,
    frozen_row: {
      ...(frozenRow as Partial<ApiLegInventoryRow>),
      id: rowId,
      leg_type: 'strategy',
      name: readStringFromRecord(frozenRow, 'name') ?? rowId,
      reference_count: typeof frozenRow.reference_count === 'number' ? frozenRow.reference_count : 0,
      reference_summary:
        readStringFromRecord(frozenRow, 'reference_summary') ?? buildReferenceSummary(0),
      status: readStringFromRecord(frozenRow, 'status') ?? 'READY',
      status_label: readStringFromRecord(frozenRow, 'status_label') ?? 'Ready',
      has_new_version: Boolean(frozenRow.has_new_version),
      has_new_parameters: Boolean(frozenRow.has_new_parameters),
      is_orphan: Boolean(frozenRow.is_orphan),
      attribute_tags: readStringArray(frozenRow.attribute_tags),
      allowed_actions: readStringArray(frozenRow.allowed_actions),
      config: asRecord(frozenRow.config),
      created_at: savedAt,
      updated_at: readStringFromRecord(frozenRow, 'updated_at') ?? savedAt,
    } as ApiLegInventoryRow,
  };
}

export function readSavedStrategyLegFreezes(): SavedStrategyLegFreezeStore {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(SAVED_STRATEGY_LEG_FREEZE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).flatMap(([id, value]) => {
        const normalized = normalizeSavedFreeze(id, value);
        return normalized ? [[id, normalized]] : [];
      }),
    );
  } catch {
    return {};
  }
}

export function writeSavedStrategyLegFreezes(freezes: SavedStrategyLegFreezeStore): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(SAVED_STRATEGY_LEG_FREEZE_STORAGE_KEY, JSON.stringify(freezes));
  } catch {
    // Losing the source freeze should not block the route; the ID preference still keeps the row recoverable.
  }
}

export function buildSavedStrategyLegFreeze(
  row: ApiLegInventoryRow,
  savedAt = new Date().toISOString(),
): SavedStrategyLegFreezePayload {
  const frozenRow = cloneJson({
    ...row,
    created_at: savedAt,
    updated_at: row.updated_at ?? savedAt,
  });
  return {
    saved_at: savedAt,
    frozen_row: frozenRow,
  };
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

function getStrategyVersionNumber(
  strategy: ApiStrategyListItem | undefined,
  parameterVersionId: string,
): number | null {
  if (strategy?.current_parameter_version_id === parameterVersionId) {
    const currentVersion = strategy.current_parameter_version;
    if (typeof currentVersion === 'number' && Number.isFinite(currentVersion)) {
      return currentVersion;
    }
  }
  const match = parameterVersionId.match(/(?:^|-)v(\d+)$/i);
  return match ? Number(match[1]) : null;
}

function getStrategyIdFromParameterVersionId(parameterVersionId: string): string | null {
  const match = parameterVersionId.match(/^(.+)-v\d+$/i);
  return match?.[1] ?? null;
}

function normalizeWindowValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function getStrategyRunPeriodKey(
  strategyId: string,
  parameterVersionId: string,
  startDate: string | null,
  endDate: string | null,
): string {
  return `${strategyId}::${parameterVersionId}::${startDate ?? 'start:unknown'}::${endDate ?? 'end:unknown'}`;
}

function getRunSelectionKey(run: ApiBacktestRunListItem): string {
  return getStrategyRunPeriodKey(
    run.strategy_id,
    String(run.parameter_version_id ?? ''),
    normalizeWindowValue(run.start_date),
    normalizeWindowValue(run.end_date),
  );
}

function getRowRunId(row: ApiLegInventoryRow): string | null {
  const config = asRecord(row.config);
  return readStringFromRecord(config, 'run_id') ?? readStringFromRecord(config, 'latest_run_id');
}

function buildStrategySourceRefId(
  strategyId: string,
  parameterVersionId: string,
  runId?: string | null,
): string {
  const normalizedRunId = String(runId ?? '').trim();
  if (normalizedRunId) {
    return `strategy_leg::${parameterVersionId}::${normalizedRunId}`;
  }
  return `strategy_leg::${strategyId}::${parameterVersionId}`;
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
  const latestRunByStrategyVersion = new Map<string, ApiBacktestRunListItem>();
  const latestRunByStrategyPeriod = new Map<string, ApiBacktestRunListItem>();
  const eligibleRuns = runs
    .filter((run) => ELIGIBLE_STRATEGY_RUN_STATUSES.has(String(run.status ?? '').toUpperCase()))
    .filter((run) => Boolean(run.strategy_id && run.parameter_version_id))
    .sort((left, right) => getRunSortTime(right) - getRunSortTime(left));

  eligibleRuns.forEach((run) => {
    const key = `${run.strategy_id}::${run.parameter_version_id}`;
    if (!latestRunByStrategyVersion.has(key)) {
      latestRunByStrategyVersion.set(key, run);
    }
    const periodKey = getRunSelectionKey(run);
    if (!latestRunByStrategyPeriod.has(periodKey)) {
      latestRunByStrategyPeriod.set(periodKey, run);
    }
  });

  const selectedRunsById = new Map<string, ApiBacktestRunListItem>();
  Array.from(latestRunByStrategyPeriod.values()).forEach((run) => {
    selectedRunsById.set(run.id, run);
  });
  eligibleRuns.forEach((run) => {
    const parameterVersionId = run.parameter_version_id as string;
    const rowId = buildStrategySourceRefId(run.strategy_id, parameterVersionId, run.id);
    const legacyRowId = buildStrategySourceRefId(run.strategy_id, parameterVersionId);
    if (getReferenceCount(referenceCounts, rowId) > 0 || getReferenceCount(referenceCounts, legacyRowId) > 0) {
      selectedRunsById.set(run.id, run);
    }
  });

  return Array.from(selectedRunsById.values()).map((run): ApiLegInventoryRow => {
    const strategy = strategyById.get(run.strategy_id);
    const parameterVersionId = run.parameter_version_id as string;
    const rowId = buildStrategySourceRefId(run.strategy_id, parameterVersionId, run.id);
    const legacyRowId = buildStrategySourceRefId(run.strategy_id, parameterVersionId);
    const referenceCount =
      getReferenceCount(referenceCounts, rowId) || getReferenceCount(referenceCounts, legacyRowId);
    const hasNewVersion =
      Boolean(strategy?.current_parameter_version_id) &&
      strategy?.current_parameter_version_id !== parameterVersionId;
    const currentRun = strategy?.current_parameter_version_id
      ? latestRunByStrategyPeriod.get(
          getStrategyRunPeriodKey(
            run.strategy_id,
            strategy.current_parameter_version_id,
            normalizeWindowValue(run.start_date),
            normalizeWindowValue(run.end_date),
          ),
        ) ?? latestRunByStrategyVersion.get(`${run.strategy_id}::${strategy.current_parameter_version_id}`)
      : null;
    const currentRefId = strategy?.current_parameter_version_id
      ? buildStrategySourceRefId(
          run.strategy_id,
          strategy.current_parameter_version_id,
          currentRun?.id ?? null,
        )
      : rowId;
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
      `version:${getStrategyVersionLabel(strategy, parameterVersionId)}`,
      hasNewVersion ? 'newer_version_available' : null,
    ].filter((tag): tag is string => Boolean(tag));
    const sourceIntegrity = {
      leg_id: rowId,
      display_name: strategy?.name ?? run.strategy_name ?? run.strategy_id,
      source_ref_id: rowId,
      freeze_hash: null,
      signature_status: hasNewVersion ? 'stale' : 'verified',
      drift_status: hasNewVersion ? 'drifted' : 'current',
      has_new_parameters: false,
      current_ref_id: currentRefId,
      checked_at: run.completed_at ?? run.updated_at ?? run.created_at ?? null,
      alerts: hasNewVersion
        ? ['A newer parameter version exists; saved compositions keep the frozen version.']
        : [],
    };

    return {
      id: rowId,
      leg_type: 'strategy',
      name: strategy?.name ?? run.strategy_name ?? run.strategy_id,
      version_label: getStrategyVersionLabel(strategy, parameterVersionId),
      proof_label: run.id,
      reference_count: referenceCount,
      reference_summary: buildReferenceSummary(referenceCount),
      status: hasNewVersion ? 'STALE' : 'READY',
      status_label: hasNewVersion
        ? 'Newer version available'
        : run.status === 'COMPLETED_WITH_WARNINGS'
          ? 'Completed with warnings'
          : 'Ready',
      has_new_version: hasNewVersion,
      has_new_parameters: false,
      is_orphan: false,
      attribute_tags: tags,
      allowed_actions: [
        'open_strategy_detail',
        'open_composition_workbench',
        ...(hasNewVersion ? ['copy_new_version'] : []),
      ],
      source_ref_id: rowId,
      source_ref_type: 'strategy_projection',
      source_integrity: sourceIntegrity,
      signature_status: sourceIntegrity.signature_status,
      drift_status: sourceIntegrity.drift_status,
      current_ref_id: sourceIntegrity.current_ref_id,
      alerts: sourceIntegrity.alerts,
      config: {
        strategy_id: run.strategy_id,
        parameter_version_id: parameterVersionId,
        parameter_version: getStrategyVersionNumber(strategy, parameterVersionId),
        latest_run_id: run.id,
        run_id: run.id,
        is_permanent: run.is_permanent ?? false,
        created_at: run.created_at ?? null,
        updated_at: run.updated_at ?? null,
        completed_at: run.completed_at ?? null,
        run_created_at: run.created_at ?? null,
        run_updated_at: run.updated_at ?? null,
        run_completed_at: run.completed_at ?? null,
        metrics: run.metrics ?? null,
        annualized_return_pct: annualizedReturnPct ?? 0,
        max_drawdown_pct: Math.abs(maxDrawdownPct ?? 0),
        oos_sharpe: readMetricNumber(run.metrics, 'oos_sharpe', 'out_of_sample_sharpe', 'sharpe') ?? 0,
        start_date: run.start_date ?? null,
        end_date: run.end_date ?? null,
        effective_date: run.effective_date ?? null,
        oos_start_date: run.oos_start_date ?? null,
        trades_count: run.trades_count ?? null,
        rebalance_frequency: strategy?.rebalance_frequency ?? null,
        source_integrity: sourceIntegrity,
      },
      created_at: run.created_at ?? run.completed_at ?? run.updated_at ?? null,
      updated_at: run.completed_at ?? run.updated_at ?? run.created_at ?? null,
    };
  });
}

function pickFrozenRunConfig(frozenConfig: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(frozenConfig).filter(([key]) => FROZEN_STRATEGY_RUN_CONFIG_KEYS.has(key)),
  );
}

function buildFrozenMetricFallback(frozenConfig: Record<string, unknown>): Record<string, unknown> | null {
  const metricKeys = ['annualized_return_pct', 'max_drawdown_pct', 'oos_sharpe'] as const;
  const metrics = Object.fromEntries(
    metricKeys
      .map((key) => [key, frozenConfig[key]] as const)
      .filter(([, value]) => typeof value === 'number' && Number.isFinite(value)),
  );
  return Object.keys(metrics).length > 0 ? metrics : null;
}

function getRowSourceIntegrity(row: ApiLegInventoryRow): Record<string, unknown> {
  const config = asRecord(row.config);
  return asRecord(row.source_integrity ?? config.source_integrity);
}

function mergeFrozenSourceIntegrity(
  currentRow: ApiLegInventoryRow,
  frozenRow: ApiLegInventoryRow,
): ApiCompositionSourceIntegrity {
  const currentIntegrity = getRowSourceIntegrity(currentRow);
  const frozenIntegrity = getRowSourceIntegrity(frozenRow);
  const shouldUseCurrentStatus =
    currentRow.has_new_version || currentRow.has_new_parameters || currentRow.is_orphan;
  const alerts = shouldUseCurrentStatus
    ? readStringArray(currentIntegrity.alerts)
    : readStringArray(frozenIntegrity.alerts);
  const mergedIntegrity = {
    ...currentIntegrity,
    ...frozenIntegrity,
  };
  const signatureStatus = shouldUseCurrentStatus
    ? currentIntegrity.signature_status ?? currentRow.signature_status
    : frozenIntegrity.signature_status ?? currentIntegrity.signature_status;
  const driftStatus = shouldUseCurrentStatus
    ? currentIntegrity.drift_status ?? currentRow.drift_status
    : frozenIntegrity.drift_status ?? currentIntegrity.drift_status;
  const currentRefId = shouldUseCurrentStatus
    ? currentIntegrity.current_ref_id ?? currentRow.current_ref_id
    : frozenIntegrity.current_ref_id ?? currentIntegrity.current_ref_id;
  const checkedAt = shouldUseCurrentStatus
    ? currentIntegrity.checked_at ?? frozenIntegrity.checked_at
    : frozenIntegrity.checked_at ?? currentIntegrity.checked_at;
  return {
    ...mergedIntegrity,
    leg_id: readStringFromRecord(mergedIntegrity, 'leg_id') ?? frozenRow.id,
    display_name: readStringFromRecord(mergedIntegrity, 'display_name') ?? frozenRow.name ?? currentRow.name,
    source_ref_id:
      readStringFromRecord(mergedIntegrity, 'source_ref_id') ??
      frozenRow.source_ref_id ??
      currentRow.source_ref_id ??
      frozenRow.id,
    freeze_hash:
      readStringFromRecord(mergedIntegrity, 'freeze_hash') ?? frozenRow.freeze_hash ?? currentRow.freeze_hash ?? null,
    signature_status: typeof signatureStatus === 'string' && signatureStatus.trim() ? signatureStatus : 'verified',
    drift_status: typeof driftStatus === 'string' && driftStatus.trim() ? driftStatus : 'current',
    has_new_parameters: shouldUseCurrentStatus
      ? Boolean(currentIntegrity.has_new_parameters ?? currentRow.has_new_parameters)
      : Boolean(
          frozenIntegrity.has_new_parameters ??
            currentIntegrity.has_new_parameters ??
            currentRow.has_new_parameters,
        ),
    current_ref_id: typeof currentRefId === 'string' && currentRefId.trim() ? currentRefId : null,
    checked_at: typeof checkedAt === 'string' && checkedAt.trim() ? checkedAt : null,
    alerts,
  };
}

function markRowWithNewParameters(
  row: ApiLegInventoryRow,
  target: ApiLegInventoryRow,
): ApiLegInventoryRow {
  const currentIntegrity = getRowSourceIntegrity(row);
  const nextAlerts = Array.from(
    new Set([...readStringArray(currentIntegrity.alerts), ...readStringArray(row.alerts), NEWER_STRATEGY_RUN_ALERT]),
  );
  const nextIntegrity: ApiCompositionSourceIntegrity = {
    ...currentIntegrity,
    leg_id: readStringFromRecord(currentIntegrity, 'leg_id') ?? row.id,
    display_name: readStringFromRecord(currentIntegrity, 'display_name') ?? row.name,
    source_ref_id: readStringFromRecord(currentIntegrity, 'source_ref_id') ?? row.source_ref_id ?? row.id,
    freeze_hash: readStringFromRecord(currentIntegrity, 'freeze_hash') ?? row.freeze_hash ?? null,
    signature_status: 'stale',
    drift_status: 'drifted',
    has_new_parameters: true,
    current_ref_id: target.source_ref_id ?? target.id,
    checked_at:
      readStringFromRecord(asRecord(target.config), 'run_completed_at') ??
      target.updated_at ??
      readStringFromRecord(currentIntegrity, 'checked_at') ??
      null,
    alerts: nextAlerts,
  };
  const attributeTags = row.attribute_tags.includes('newer_parameters_available')
    ? row.attribute_tags
    : [...row.attribute_tags, 'newer_parameters_available'];
  return {
    ...row,
    has_new_parameters: true,
    status: row.status === 'ARCHIVED' ? row.status : 'STALE',
    status_label: row.status === 'ARCHIVED' ? row.status_label : 'Newer run available',
    attribute_tags: attributeTags,
    source_integrity: nextIntegrity,
    signature_status: nextIntegrity.signature_status,
    drift_status: nextIntegrity.drift_status,
    current_ref_id: nextIntegrity.current_ref_id,
    alerts: nextAlerts,
    config: {
      ...asRecord(row.config),
      source_integrity: nextIntegrity,
    },
  };
}

function findSamePeriodUpdateTarget(
  row: ApiLegInventoryRow,
  candidates: ApiLegInventoryRow[],
): ApiLegInventoryRow | null {
  if (row.leg_type !== 'strategy' || row.has_new_version || row.is_orphan) {
    return null;
  }
  const sourceSignature = getStrategyPeriodSignatureForRow(row);
  if (!sourceSignature?.startDate || !sourceSignature.endDate) {
    return null;
  }
  const sourceRunId = sourceSignature.runId;
  const sourceSortTime = getStrategyRowSortTime(row);
  return (
    candidates
      .filter((candidate) => {
        if (candidate.leg_type !== 'strategy' || hasStrategyPendingUpdate(candidate)) {
          return false;
        }
        if (!sameStrategyPeriod(row, candidate)) {
          return false;
        }
        const candidateRunId = getStrategyPeriodSignatureForRow(candidate)?.runId ?? getRowRunId(candidate);
        return Boolean(
          candidateRunId &&
            candidateRunId !== sourceRunId &&
            getStrategyRowSortTime(candidate) > sourceSortTime,
        );
      })
      .sort((left, right) => getStrategyRowSortTime(right) - getStrategyRowSortTime(left))[0] ?? null
  );
}

function applyStrategyLegFreeze(
  currentRow: ApiLegInventoryRow,
  freeze?: SavedStrategyLegFreezePayload,
): ApiLegInventoryRow {
  if (!freeze) {
    return currentRow;
  }
  const frozenRow = freeze.frozen_row;
  const currentConfig = asRecord(currentRow.config);
  const frozenConfig = asRecord(frozenRow.config);
  const sourceIntegrity = mergeFrozenSourceIntegrity(currentRow, frozenRow);
  const frozenSourceRefId =
    (typeof frozenRow.source_ref_id === 'string' && frozenRow.source_ref_id.trim())
      ? frozenRow.source_ref_id
      : frozenRow.id;
  const frozenRunConfig = pickFrozenRunConfig(frozenConfig);
  const config: Record<string, unknown> = {
    ...currentConfig,
    ...frozenRunConfig,
    source_integrity: sourceIntegrity,
    saved_strategy_source_frozen_at: freeze.saved_at,
  };
  if (!('metrics' in frozenRunConfig)) {
    const frozenMetricFallback = buildFrozenMetricFallback(frozenConfig);
    if (frozenMetricFallback) {
      config.metrics = frozenMetricFallback;
    }
  }
  return {
    ...currentRow,
    id: frozenRow.id || currentRow.id,
    name: frozenRow.name || currentRow.name,
    version_label: frozenRow.version_label ?? currentRow.version_label,
    proof_label: frozenRow.proof_label ?? currentRow.proof_label,
    reference_count:
      typeof frozenRow.reference_count === 'number'
        ? frozenRow.reference_count
        : currentRow.reference_count,
    reference_summary: frozenRow.reference_summary ?? currentRow.reference_summary,
    source_ref_id: frozenSourceRefId || currentRow.source_ref_id,
    source_ref_type: frozenRow.source_ref_type ?? currentRow.source_ref_type,
    source_integrity: sourceIntegrity,
    freeze_hash: typeof sourceIntegrity.freeze_hash === 'string' ? sourceIntegrity.freeze_hash : currentRow.freeze_hash,
    signature_status:
      typeof sourceIntegrity.signature_status === 'string'
        ? sourceIntegrity.signature_status
        : currentRow.signature_status,
    drift_status:
      typeof sourceIntegrity.drift_status === 'string' ? sourceIntegrity.drift_status : currentRow.drift_status,
    current_ref_id:
      typeof sourceIntegrity.current_ref_id === 'string' ? sourceIntegrity.current_ref_id : currentRow.current_ref_id,
    alerts: readStringArray(sourceIntegrity.alerts),
    config,
    created_at: frozenRow.created_at ?? freeze.saved_at ?? currentRow.created_at,
    updated_at: frozenRow.updated_at ?? freeze.saved_at ?? currentRow.updated_at,
  };
}

function freezeSourceMatchesRow(freeze: SavedStrategyLegFreezePayload, row: ApiLegInventoryRow): boolean {
  const frozenSourceRefId =
    freeze.frozen_row.source_ref_id && typeof freeze.frozen_row.source_ref_id === 'string'
      ? freeze.frozen_row.source_ref_id
      : freeze.frozen_row.id;
  return frozenSourceRefId === row.id || frozenSourceRefId === row.source_ref_id;
}

export function materializeSavedStrategyRows(
  ids: string[],
  strategyRows: ApiLegInventoryRow[],
  currentRows: ApiLegInventoryRow[] = [],
  edits: SavedStrategyLegEditStore = {},
  freezes: SavedStrategyLegFreezeStore = {},
): ApiLegInventoryRow[] {
  const byId = new Map([...currentRows, ...strategyRows].map((row) => [row.id, row]));
  const rowSourceMatches = (
    row: ApiLegInventoryRow,
    parsed: { strategyId: string; parameterVersionId: string; runId: string | null },
  ): boolean => {
    if (row.leg_type !== 'strategy') {
      return false;
    }
    const rowParsed = parseStrategySourceRefId(String(row.source_ref_id ?? row.id));
    const config = asRecord(row.config);
    const rowStrategyId =
      (typeof config.strategy_id === 'string' && config.strategy_id.trim()) ||
      rowParsed?.strategyId ||
      null;
    const rowParameterVersionId =
      (typeof config.parameter_version_id === 'string' && config.parameter_version_id.trim()) ||
      rowParsed?.parameterVersionId ||
      null;
    return rowStrategyId === parsed.strategyId && rowParameterVersionId === parsed.parameterVersionId;
  };
  const rowSourceScore = (
    row: ApiLegInventoryRow,
    id: string,
    parsed: { strategyId: string; parameterVersionId: string; runId: string | null },
    frozenReference?: ApiLegInventoryRow,
  ): number => {
    const rowSourceRefId = String(row.source_ref_id ?? row.id);
    const rowParsed = parseStrategySourceRefId(rowSourceRefId);
    const config = asRecord(row.config);
    const configRunId = readStringFromRecord(config, 'run_id') ?? readStringFromRecord(config, 'latest_run_id');
    const runId = rowParsed?.runId ?? configRunId;
    let score = 0;
    if (row.reference_count > 0) {
      score += 1000;
    }
    if (rowSourceRefId === id || row.id === id) {
      score += 100;
    }
    if (parsed.runId && runId === parsed.runId) {
      score += 50;
    }
    if (frozenReference && sameStrategyPeriod(row, frozenReference)) {
      score += 500;
    }
    if (config.is_permanent === true) {
      score += 20;
    }
    return score;
  };
  const findEquivalentStrategyRow = (
    id: string,
    frozenReference?: ApiLegInventoryRow,
  ): ApiLegInventoryRow | undefined => {
    const parsed = parseStrategySourceRefId(id);
    if (!parsed) {
      return undefined;
    }
    return [...currentRows, ...strategyRows]
      .filter((row) => rowSourceMatches(row, parsed))
      .sort((left, right) => rowSourceScore(right, id, parsed, frozenReference) - rowSourceScore(left, id, parsed, frozenReference))[0];
  };
  return ids.flatMap((id) => {
    const freeze = freezes[id];
    const authoritativeRow = findEquivalentStrategyRow(id, freeze?.frozen_row);
    const row = authoritativeRow ?? byId.get(id) ?? freeze?.frozen_row;
    if (!row) {
      return [];
    }
    const effectiveFreeze =
      authoritativeRow && authoritativeRow.reference_count > 0 && freeze && !freezeSourceMatchesRow(freeze, authoritativeRow)
        ? undefined
        : freeze;
    const candidatePool = [...currentRows, ...strategyRows].filter(
      (candidate, index, collection) => collection.findIndex((item) => item.id === candidate.id) === index,
    );
    const frozenReference = effectiveFreeze?.frozen_row;
    const samePeriodUpdateTarget =
      frozenReference &&
      sameStrategyPeriod(frozenReference, row) &&
      getStrategyRowSortTime(row) > getStrategyRowSortTime(frozenReference)
        ? row
        : findSamePeriodUpdateTarget(frozenReference ?? row, candidatePool);
    const rowWithLatestPeriodRun =
      samePeriodUpdateTarget && !hasStrategyPendingUpdate(row)
        ? markRowWithNewParameters(row, samePeriodUpdateTarget)
        : row;
    const frozenRow = applyStrategyLegFreeze(rowWithLatestPeriodRun, effectiveFreeze);
    return [applyStrategyLegEdit({ ...frozenRow, name: buildStrategyLegDefaultName(frozenRow) }, edits[id])];
  });
}

function parseStrategySourceRefId(
  sourceRefId: string,
): { strategyId: string; parameterVersionId: string; runId: string | null } | null {
  const match = sourceRefId.match(/^strategy_leg::(.+)::(.+)$/);
  if (!match) {
    return null;
  }
  const inferredStrategyId = getStrategyIdFromParameterVersionId(match[1]);
  if (inferredStrategyId) {
    return {
      strategyId: inferredStrategyId,
      parameterVersionId: match[1],
      runId: match[2],
    };
  }
  return {
    strategyId: match[1],
    parameterVersionId: match[2],
    runId: null,
  };
}

function getStrategyPeriodSignatureForRow(row: ApiLegInventoryRow): {
  strategyId: string | null;
  parameterVersionId: string | null;
  runId: string | null;
  startDate: string | null;
  endDate: string | null;
} | null {
  if (row.leg_type !== 'strategy') {
    return null;
  }
  const parsed = parseStrategySourceRefId(String(row.source_ref_id ?? row.id));
  const config = asRecord(row.config);
  const strategyId = readStringFromRecord(config, 'strategy_id') ?? parsed?.strategyId ?? null;
  const parameterVersionId =
    readStringFromRecord(config, 'parameter_version_id') ?? parsed?.parameterVersionId ?? null;
  if (!strategyId || !parameterVersionId) {
    return null;
  }
  return {
    strategyId,
    parameterVersionId,
    runId: parsed?.runId ?? getRowRunId(row),
    startDate: normalizeWindowValue(config.start_date),
    endDate: normalizeWindowValue(config.end_date),
  };
}

function sameStrategyPeriod(left: ApiLegInventoryRow, right: ApiLegInventoryRow): boolean {
  const leftSignature = getStrategyPeriodSignatureForRow(left);
  const rightSignature = getStrategyPeriodSignatureForRow(right);
  if (!leftSignature || !rightSignature) {
    return false;
  }
  return (
    leftSignature.strategyId === rightSignature.strategyId &&
    leftSignature.parameterVersionId === rightSignature.parameterVersionId &&
    Boolean(leftSignature.startDate) &&
    Boolean(leftSignature.endDate) &&
    leftSignature.startDate === rightSignature.startDate &&
    leftSignature.endDate === rightSignature.endDate
  );
}

function getStrategyRowSortTime(row: ApiLegInventoryRow): number {
  const config = asRecord(row.config);
  const timestamp =
    readStringFromRecord(config, 'run_completed_at') ??
    readStringFromRecord(config, 'completed_at') ??
    row.updated_at ??
    row.created_at ??
    '';
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasStrategyPendingUpdate(row: ApiLegInventoryRow | null | undefined): boolean {
  return Boolean(row?.has_new_version || row?.has_new_parameters);
}

function getStrategyIdFromLeg(leg: ApiCompositionLegInput): string | null {
  const config = asRecord(leg.config);
  const strategyId = config.strategy_id;
  if (typeof strategyId === 'string' && strategyId.trim()) {
    return strategyId.trim();
  }
  return parseStrategySourceRefId(String(leg.source_ref_id ?? ''))?.strategyId ?? null;
}

function getStrategyIdFromRow(row: ApiLegInventoryRow): string | null {
  const config = asRecord(row.config);
  const strategyId = config.strategy_id;
  if (typeof strategyId === 'string' && strategyId.trim()) {
    return strategyId.trim();
  }
  return parseStrategySourceRefId(String(row.source_ref_id ?? row.id))?.strategyId ?? null;
}

function getInventorySourceRefId(row: ApiLegInventoryRow): string {
  return String(row.source_ref_id ?? row.id);
}

function findInventoryRowForLeg(
  leg: ApiCompositionLegInput,
  inventoryRows: ApiLegInventoryRow[],
): ApiLegInventoryRow | null {
  const sourceRefId = String(leg.source_ref_id ?? '');
  return inventoryRows.find((row) => row.id === sourceRefId || row.source_ref_id === sourceRefId) ?? null;
}

function findLatestStrategyRowForLeg(
  leg: ApiCompositionLegInput,
  inventoryRows: ApiLegInventoryRow[],
): ApiLegInventoryRow | null {
  const strategyId = getStrategyIdFromLeg(leg);
  const currentRow = findInventoryRowForLeg(leg, inventoryRows);
  if (!strategyId) {
    return null;
  }
  return (
    inventoryRows.find((row) => {
      if (row.leg_type !== 'strategy' || hasStrategyPendingUpdate(row)) {
        return false;
      }
      if (row.status === 'NEEDS_RUN' || row.attribute_tags.includes('needs_run')) {
        return false;
      }
      if (getStrategyIdFromRow(row) !== strategyId) {
        return false;
      }
      if (currentRow?.has_new_parameters) {
        return sameStrategyPeriod(currentRow, row);
      }
      return true;
    }) ?? null
  );
}

export function canUpgradeStrategyLegVersions(
  legs: ApiCompositionLegInput[],
  inventoryRows: ApiLegInventoryRow[],
): boolean {
  const staleStrategyLegs = legs.filter((leg) => {
    if (leg.leg_kind !== 'strategy') {
      return false;
    }
    return hasStrategyPendingUpdate(findInventoryRowForLeg(leg, inventoryRows));
  });
  if (staleStrategyLegs.length === 0) {
    return false;
  }
  return staleStrategyLegs.every((leg) => {
    const latestRow = findLatestStrategyRowForLeg(leg, inventoryRows);
    return Boolean(latestRow && getInventorySourceRefId(latestRow) !== String(leg.source_ref_id ?? ''));
  });
}

export function upgradeStrategyLegVersions(
  legs: ApiCompositionLegInput[],
  inventoryRows: ApiLegInventoryRow[],
): ApiCompositionLegInput[] {
  if (!canUpgradeStrategyLegVersions(legs, inventoryRows)) {
    return legs;
  }
  return legs.map((leg) => {
    if (leg.leg_kind !== 'strategy') {
      return leg;
    }
    const currentRow = findInventoryRowForLeg(leg, inventoryRows);
    if (!hasStrategyPendingUpdate(currentRow)) {
      return leg;
    }
    const latestRow = findLatestStrategyRowForLeg(leg, inventoryRows);
    if (!latestRow) {
      return leg;
    }
    return {
      ...leg,
      source_ref_id: getInventorySourceRefId(latestRow),
      source_ref_type: latestRow.source_ref_type ?? leg.source_ref_type,
      display_name: buildStrategyLegDefaultName(latestRow),
      config: latestRow.config,
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

import { useEffect, useMemo, useState } from 'react';
import { LegInventoryView } from '../components/legs/leg-inventory-view';
import { useApiClient } from '../lib/demoStoreContext';
import {
  applyStrategyLegEdit,
  buildSavedStrategyLegFreeze,
  buildStrategyCandidateRows,
  buildStrategyLegDefaultName,
  materializeSavedStrategyRows,
  mergeInventoryWithSavedStrategies,
  readSavedStrategyLegEdits,
  readSavedStrategyLegFreezes,
  readSavedStrategyLegIds,
  writeSavedStrategyLegEdits,
  writeSavedStrategyLegFreezes,
  writeSavedStrategyLegIds,
  type SavedStrategyLegEditPayload as StrategyLegEditPayload,
} from '../lib/saved-strategy-leg-inventory';
import type {
  ApiAssetLegCreatePayload,
  ApiBacktestRunDetail,
  ApiAssetLegUpdatePayload,
  ApiBondSnapshotEligibleInstrument,
  ApiCashLegCreatePayload,
  ApiCashLegUpdatePayload,
  ApiLegInventory,
  ApiLegInventoryRow,
} from '../types';

const FIRST_SCREEN_DEFER_MS = import.meta.env.MODE === 'test' ? 0 : 80;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readStringValue(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readFocusSourceRefIdFromHash(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const hash = String(window.location.hash ?? '');
  const queryIndex = hash.indexOf('?');
  if (queryIndex < 0) {
    return null;
  }
  const query = hash.slice(queryIndex + 1);
  const sourceRefId = new URLSearchParams(query).get('source_ref_id');
  return sourceRefId?.trim() ? sourceRefId.trim() : null;
}

function applySavedRunToStrategyRow(
  row: ApiLegInventoryRow,
  detail: ApiBacktestRunDetail,
): ApiLegInventoryRow {
  const config = asRecord(row.config);
  const savedRunId =
    detail.id ||
    readStringValue(config, 'run_id') ||
    readStringValue(config, 'latest_run_id') ||
    row.proof_label ||
    null;
  return {
    ...row,
    proof_label: savedRunId ?? row.proof_label,
    config: {
      ...config,
      latest_run_id: savedRunId ?? readStringValue(config, 'latest_run_id'),
      run_id: savedRunId ?? readStringValue(config, 'run_id'),
      is_permanent: detail.is_permanent ?? true,
      created_at: detail.created_at ?? config.created_at ?? null,
      updated_at: detail.updated_at ?? config.updated_at ?? null,
      completed_at: detail.completed_at ?? config.completed_at ?? null,
      run_created_at: detail.created_at ?? config.run_created_at ?? null,
      run_updated_at: detail.updated_at ?? config.run_updated_at ?? null,
      run_completed_at: detail.completed_at ?? config.run_completed_at ?? null,
    },
    updated_at: detail.updated_at ?? row.updated_at,
  };
}

export function LegInventoryPage(): JSX.Element {
  const api = useApiClient();
  const [inventory, setInventory] = useState<ApiLegInventory | null>(null);
  const [bondSourceInstruments, setBondSourceInstruments] = useState<ApiBondSnapshotEligibleInstrument[]>([]);
  const [strategyCandidates, setStrategyCandidates] = useState<ApiLegInventoryRow[]>([]);
  const [savedStrategyRows, setSavedStrategyRows] = useState<ApiLegInventoryRow[]>([]);
  const [focusSourceRefId, setFocusSourceRefId] = useState<string | null>(() => readFocusSourceRefIdFromHash());
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
      const savedIds = readSavedStrategyLegIds();
      const savedEdits = readSavedStrategyLegEdits();
      const savedFreezes = readSavedStrategyLegFreezes();
      setInventory(response);
      setSavedStrategyRows((currentRows) =>
        materializeSavedStrategyRows(savedIds, [], response.rows, savedEdits, savedFreezes),
      );
      setLoading(false);
      await new Promise((resolve) => window.setTimeout(resolve, FIRST_SCREEN_DEFER_MS));
      const snapshotOverviewPromise = api.getSnapshotOverview
        ? api.getSnapshotOverview().catch(() => null)
        : Promise.resolve(null);
      const [strategies, runs, snapshotOverview] = await Promise.all([
        api.listStrategies(),
        api.listBacktestRuns({ limit: 100 }),
        snapshotOverviewPromise,
      ]);
      setBondSourceInstruments(snapshotOverview?.bond_fixed_income?.eligible_instruments ?? []);
      const candidateRows = buildStrategyCandidateRows(
        strategies,
        runs,
        response.strategy_reference_counts,
      );
      setStrategyCandidates(candidateRows);
      setSavedStrategyRows(() =>
        materializeSavedStrategyRows(savedIds, candidateRows, response.rows, savedEdits, savedFreezes),
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

  useEffect(() => {
    const syncFocusSourceRefId = (): void => {
      setFocusSourceRefId(readFocusSourceRefIdFromHash());
    };
    window.addEventListener('hashchange', syncFocusSourceRefId);
    return () => window.removeEventListener('hashchange', syncFocusSourceRefId);
  }, []);

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

  async function handleUpdateAsset(id: string, payload: ApiAssetLegUpdatePayload): Promise<void> {
    if (!api.updateAssetLeg) {
      throw new Error('Asset leg update API is not available.');
    }
    await api.updateAssetLeg(id, payload);
    await loadInventory();
  }

  async function handleUpdateCash(id: string, payload: ApiCashLegUpdatePayload): Promise<void> {
    if (!api.updateCashLeg) {
      throw new Error('Cash leg update API is not available.');
    }
    await api.updateCashLeg(id, payload);
    await loadInventory();
  }

  async function handleArchiveCandidate(row: ApiLegInventoryRow): Promise<void> {
    if (row.leg_type === 'strategy') {
      const remainingIds = readSavedStrategyLegIds().filter((savedId) => savedId !== row.id);
      const savedEdits = readSavedStrategyLegEdits();
      const savedFreezes = readSavedStrategyLegFreezes();
      delete savedEdits[row.id];
      delete savedFreezes[row.id];
      writeSavedStrategyLegIds(remainingIds);
      writeSavedStrategyLegEdits(savedEdits);
      writeSavedStrategyLegFreezes(savedFreezes);
      setSavedStrategyRows((current) => current.filter((item) => item.id !== row.id));
      return;
    }
    if (row.leg_type === 'asset') {
      if (!api.updateAssetLeg) {
        throw new Error('Asset leg update API is not available.');
      }
      await api.updateAssetLeg(row.id, { status: 'ARCHIVED' });
      await loadInventory();
      return;
    }
    if (!api.updateCashLeg) {
      throw new Error('Cash leg update API is not available.');
    }
    await api.updateCashLeg(row.id, { status: 'ARCHIVED' });
    await loadInventory();
  }

  async function handleSaveStrategy(row: ApiLegInventoryRow): Promise<void> {
    const savedEdits = readSavedStrategyLegEdits();
    const editedRow = applyStrategyLegEdit({ ...row, name: buildStrategyLegDefaultName(row) }, savedEdits[row.id]);
    const config = asRecord(editedRow.config);
    const sourceRunId = readStringValue(config, 'run_id') ?? readStringValue(config, 'latest_run_id');
    const permanentRow =
      sourceRunId && config.is_permanent !== true
        ? applySavedRunToStrategyRow(editedRow, await api.saveBacktestRun(sourceRunId))
        : editedRow;
    const freeze = buildSavedStrategyLegFreeze(permanentRow);
    const rowToSave = freeze.frozen_row;
    const savedFreezes = readSavedStrategyLegFreezes();
    savedFreezes[rowToSave.id] = freeze;
    writeSavedStrategyLegFreezes(savedFreezes);
    setSavedStrategyRows((current) => {
      const nextRows = [
        rowToSave,
        ...current.filter((item) => item.id !== rowToSave.id),
      ];
      writeSavedStrategyLegIds(nextRows.map((item) => item.id));
      return nextRows;
    });
  }

  async function handleUpdateStrategy(id: string, payload: StrategyLegEditPayload): Promise<void> {
    const savedEdits = {
      ...readSavedStrategyLegEdits(),
      [id]: payload,
    };
    writeSavedStrategyLegEdits(savedEdits);
    setSavedStrategyRows((current) =>
      current.map((row) => (row.id === id ? applyStrategyLegEdit(row, payload) : row)),
    );
  }

  return (
    <LegInventoryView
      error={error}
      inventory={displayedInventory}
      loading={loading}
      onCreateAsset={handleCreateAsset}
      onCreateCash={handleCreateCash}
      onSaveStrategy={handleSaveStrategy}
      onUpdateAsset={handleUpdateAsset}
      onUpdateCash={handleUpdateCash}
      onUpdateStrategy={handleUpdateStrategy}
      onArchiveCandidate={handleArchiveCandidate}
      bondSourceInstruments={bondSourceInstruments}
      focusSourceRefId={focusSourceRefId}
      strategyRows={strategyCandidates}
    />
  );
}

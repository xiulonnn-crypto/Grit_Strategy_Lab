import { useEffect, useMemo, useState } from 'react';
import { LegInventoryView } from '../components/legs/leg-inventory-view';
import { useApiClient } from '../lib/demoStoreContext';
import {
  applyStrategyLegEdit,
  buildCompositionReferenceCounts,
  buildStrategyCandidateRows,
  buildStrategyLegDefaultName,
  materializeSavedStrategyRows,
  mergeInventoryWithSavedStrategies,
  readSavedStrategyLegEdits,
  readSavedStrategyLegIds,
  writeSavedStrategyLegEdits,
  writeSavedStrategyLegIds,
  type SavedStrategyLegEditPayload as StrategyLegEditPayload,
} from '../lib/saved-strategy-leg-inventory';
import type {
  ApiAssetLegCreatePayload,
  ApiAssetLegUpdatePayload,
  ApiBondSnapshotEligibleInstrument,
  ApiCashLegCreatePayload,
  ApiCashLegUpdatePayload,
  ApiLegInventory,
  ApiLegInventoryRow,
} from '../types';

export function LegInventoryPage(): JSX.Element {
  const api = useApiClient();
  const [inventory, setInventory] = useState<ApiLegInventory | null>(null);
  const [bondSourceInstruments, setBondSourceInstruments] = useState<ApiBondSnapshotEligibleInstrument[]>([]);
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
      const snapshotOverviewPromise = api.getSnapshotOverview
        ? api.getSnapshotOverview().catch(() => null)
        : Promise.resolve(null);
      const [strategies, runs, compositionDetails, snapshotOverview] = await Promise.all([
        api.listStrategies(),
        api.listBacktestRuns({ limit: 100 }),
        compositionDetailsPromise,
        snapshotOverviewPromise,
      ]);
      setBondSourceInstruments(snapshotOverview?.bond_fixed_income?.eligible_instruments ?? []);
      const candidateRows = buildStrategyCandidateRows(
        strategies,
        runs,
        buildCompositionReferenceCounts(compositionDetails),
      );
      setStrategyCandidates(candidateRows);
      const savedIds = readSavedStrategyLegIds();
      const savedEdits = readSavedStrategyLegEdits();
      setSavedStrategyRows((currentRows) =>
        materializeSavedStrategyRows(savedIds, candidateRows, currentRows, savedEdits),
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
      delete savedEdits[row.id];
      writeSavedStrategyLegIds(remainingIds);
      writeSavedStrategyLegEdits(savedEdits);
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

  function handleSaveStrategy(row: ApiLegInventoryRow): void {
    const savedEdits = readSavedStrategyLegEdits();
    const rowToSave = applyStrategyLegEdit({ ...row, name: buildStrategyLegDefaultName(row) }, savedEdits[row.id]);
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
      strategyRows={strategyCandidates}
    />
  );
}

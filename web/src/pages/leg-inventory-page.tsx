import { useEffect, useState } from 'react';
import { LegInventoryView } from '../components/legs/leg-inventory-view';
import { useApiClient } from '../lib/demoStoreContext';
import type {
  ApiAssetLegCreatePayload,
  ApiCashLegCreatePayload,
  ApiLegInventory,
} from '../types';

export function LegInventoryPage(): JSX.Element {
  const api = useApiClient();
  const [inventory, setInventory] = useState<ApiLegInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <LegInventoryView
      error={error}
      inventory={inventory}
      loading={loading}
      onCreateAsset={handleCreateAsset}
      onCreateCash={handleCreateCash}
    />
  );
}

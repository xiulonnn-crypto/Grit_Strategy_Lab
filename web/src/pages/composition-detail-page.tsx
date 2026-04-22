import { useEffect, useState } from 'react';
import { CompositionDetailView } from '../components/composition-detail/composition-detail-view';
import { useApiClient } from '../lib/demoStoreContext';
import type { ApiCompositionDetail } from '../types';

export function CompositionDetailPage({
  compositionId,
}: {
  compositionId: string;
}): JSX.Element {
  const api = useApiClient();
  const [detail, setDetail] = useState<ApiCompositionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      if (!api.getCompositionDetail) {
        if (!cancelled) {
          setError('当前运行时尚未接入组合详情接口，请先完成主线程 runtime wiring。');
          setLoading(false);
        }
        return;
      }

      try {
        if (!cancelled) {
          setLoading(true);
          setError(null);
        }
        const response = await api.getCompositionDetail(compositionId);
        if (!cancelled) {
          setDetail(response);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(`加载组合详情失败：${(caught as Error).message}`);
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
  }, [api, compositionId]);

  return <CompositionDetailView detail={detail} error={error} loading={loading} />;
}

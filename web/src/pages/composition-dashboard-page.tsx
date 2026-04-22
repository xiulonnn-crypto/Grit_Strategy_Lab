import { useEffect, useState } from 'react';
import { CompositionDashboardView } from '../components/composition-dashboard/composition-dashboard-view';
import { useApiClient } from '../lib/demoStoreContext';
import type { ApiCompositionListItem } from '../types';

export function CompositionDashboardPage(): JSX.Element {
  const api = useApiClient();
  const [compositions, setCompositions] = useState<ApiCompositionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      if (!api.listCompositions) {
        if (!cancelled) {
          setError('当前运行时还未接入组合列表接口，请等待主线程完成路由与 HTTP 客户端集成。');
          setLoading(false);
        }
        return;
      }

      try {
        if (!cancelled) {
          setLoading(true);
          setError(null);
        }
        const response = await api.listCompositions();
        if (!cancelled) {
          setCompositions(response);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(`加载组合仪表板失败：${(caught as Error).message}`);
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
  }, [api]);

  return (
    <CompositionDashboardView
      compositions={compositions}
      error={error}
      loading={loading}
    />
  );
}

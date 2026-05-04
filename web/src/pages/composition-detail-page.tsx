import { useEffect, useState } from 'react';
import { CompositionDetailView } from '../components/composition-detail/composition-detail-view';
import { useApiClient } from '../lib/demoStoreContext';
import type {
  ApiCompositionDetail,
  ApiCompositionStatus,
  ApiCompositionStatusAction,
  ApiCompositionStatusDiagnosis,
} from '../types';

export function CompositionDetailPage({
  compositionId,
}: {
  compositionId: string;
}): JSX.Element {
  const isApprovedPreviewRoute = compositionId === 'detail';
  const api = useApiClient();
  const [detail, setDetail] = useState<ApiCompositionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      if (isApprovedPreviewRoute) {
        if (!cancelled) {
          setDetail(null);
          setError(null);
          setLoading(false);
        }
        return;
      }

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
          setWriteError(null);
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
  }, [api, compositionId, isApprovedPreviewRoute]);

  async function handleStatusChange(status: ApiCompositionStatus): Promise<void> {
    if (!api.updateComposition) {
      setWriteError('Composition status writes require the runtime HTTP client.');
      return;
    }
    try {
      setSavingStatus(true);
      setWriteError(null);
      const response = await api.updateComposition(compositionId, { status });
      setDetail(response);
    } catch (caught) {
      setWriteError(`Composition status save failed: ${(caught as Error).message}`);
    } finally {
      setSavingStatus(false);
    }
  }

  async function handleDiagnosisAction(
    action: ApiCompositionStatusAction,
    diagnosis: ApiCompositionStatusDiagnosis,
  ): Promise<ApiCompositionDetail> {
    setWriteError(null);
    if (action.action_key === 'refresh_source_freezes') {
      if (!api.refreshCompositionSourceFreezes) {
        throw new Error('当前运行环境不支持在线重新冻结来源指纹。');
      }
      const response = await api.refreshCompositionSourceFreezes(compositionId, {
        confirmed_by: 'operator',
        reason: diagnosis.action,
      });
      setDetail(response);
      return response;
    }
    if (action.action_key === 'refresh_return_quality' || action.action_key === 'refresh_diagnostics') {
      if (!api.refreshCompositionDiagnostics) {
        throw new Error('当前运行环境不支持在线刷新诊断。');
      }
      const response = await api.refreshCompositionDiagnostics(compositionId);
      setDetail(response);
      return response;
    }
    throw new Error('该动作需要在对应页面完成。');
  }

  if (isApprovedPreviewRoute) {
    return <CompositionDetailView detail={null} approvedPreview error={null} loading={false} />;
  }

  return (
    <CompositionDetailView
      detail={detail}
      error={error}
      loading={loading}
      onDiagnosisAction={handleDiagnosisAction}
      onStatusChange={handleStatusChange}
      savingStatus={savingStatus}
      writeError={writeError}
    />
  );
}

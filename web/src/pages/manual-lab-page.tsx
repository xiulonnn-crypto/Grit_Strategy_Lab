import { useEffect, useState } from 'react';
import { OptimizationManualLabPhase4 } from '../page-sections/optimization-manual-lab-phase4';
import { useApiClient } from '../lib/demoStoreContext';
import type { ApiOptimizationJobDetail, ApiStrategyDetail, ParameterValue } from '../types';

const TEXT = {
  loading: '正在加载优化实验室…',
  error: '优化实验室暂时无法加载。',
} as const;

export function ManualLabPage({ jobId }: { jobId: string }): JSX.Element {
  const api = useApiClient();
  const [job, setJob] = useState<ApiOptimizationJobDetail | null>(null);
  const [strategy, setStrategy] = useState<ApiStrategyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [promotingCandidateId, setPromotingCandidateId] = useState<string | null>(null);
  const [deletingCandidateId, setDeletingCandidateId] = useState<string | null>(null);

  async function load(): Promise<void> {
    const optimizationJob = await api.getOptimizationJobDetail(jobId);
    const strategyDetail = await api.getStrategyDetail(optimizationJob.strategy_id);
    setJob(optimizationJob);
    setStrategy(strategyDetail);
  }

  useEffect(() => {
    let cancelled = false;

    async function boot(): Promise<void> {
      try {
        setLoading(true);
        setError(null);
        await load();
      } catch (caught) {
        if (!cancelled) {
          setError((caught as Error).message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [api, jobId]);

  async function handlePromote(candidateId: string, comment: string): Promise<void> {
    if (!job) {
      return;
    }

    try {
      setPromotingCandidateId(candidateId);
      setConflictMessage(null);
      await api.promoteOptimizationCandidate(
        job.id,
        candidateId,
        'set_current',
        `promote-${candidateId}`,
        comment,
      );
      await load();
    } catch (caught) {
      const errorValue = caught as Error & { code?: string };
      if (errorValue.code === 'stale_base_parameter_version') {
        setConflictMessage('参数版本冲突，请先刷新基线后再重新晋升。');
      } else {
        setError(errorValue.message);
      }
    } finally {
      setPromotingCandidateId(null);
    }
  }

  async function handleDeleteCandidate(candidateId: string): Promise<void> {
    if (!job) {
      return;
    }

    try {
      setDeletingCandidateId(candidateId);
      setError(null);
      await api.deleteOptimizationCandidate(job.id, candidateId);
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setDeletingCandidateId(null);
    }
  }

  async function handleDeleteLosingCandidates(): Promise<void> {
    if (!job) {
      return;
    }

    try {
      setError(null);
      const losingCandidateIds = job.candidates
        .filter((candidate) => {
          const totalReturn = candidate.metrics.total_return;
          return typeof totalReturn === 'number' ? totalReturn < 0 : candidate.score < 0;
        })
        .map((candidate) => candidate.id);

      for (const candidateId of losingCandidateIds) {
        await api.deleteOptimizationCandidate(job.id, candidateId);
      }

      await load();
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function handleAddCandidate(parameterSnapshot: Record<string, ParameterValue>): Promise<void> {
    if (!job) {
      return;
    }

    try {
      setError(null);
      await api.createOptimizationCandidate(job.id, {
        label: `Manual Candidate ${job.candidates.length + 1}`,
        parameter_snapshot: parameterSnapshot,
        base_parameter_version_id: job.base_parameter_version_id ?? undefined,
      });
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  if (loading) {
    return (
      <section className="panel">
        <div className="panel-header">
          <h3>优化实验室</h3>
        </div>
        <p className="hero-copy">{TEXT.loading}</p>
      </section>
    );
  }

  if (error || !job || !strategy) {
    return (
      <section className="panel">
        <div className="panel-header">
          <h3>优化实验室</h3>
        </div>
        <p className="hero-copy">{error ?? TEXT.error}</p>
      </section>
    );
  }

  return (
    <OptimizationManualLabPhase4
      conflictMessage={conflictMessage}
      deletingCandidateId={deletingCandidateId}
      job={job}
      onAddCandidate={handleAddCandidate}
      onDeleteCandidate={handleDeleteCandidate}
      onDeleteLosingCandidates={handleDeleteLosingCandidates}
      onPromote={handlePromote}
      promotingCandidateId={promotingCandidateId}
      strategy={strategy}
    />
  );
}

import type { ApiOptimizationJobDetail, ApiStrategyDetail, ParameterValue } from '../types';
import { OptimizationCandidateCard } from './optimization-candidate-card';

type OptimizationManualLabProps = {
  job: ApiOptimizationJobDetail;
  strategy: ApiStrategyDetail;
  conflictMessage: string | null;
  promotingCandidateId: string | null;
  onPromote: (candidateId: string) => void;
  onAddCandidate: (parameterSnapshot: Record<string, ParameterValue>) => void;
};

export function OptimizationManualLab({
  job,
  strategy,
  conflictMessage,
  promotingCandidateId,
  onPromote,
  onAddCandidate,
}: OptimizationManualLabProps): JSX.Element {
  return (
    <div className="stack">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Manual Lab</p>
          <h2>{strategy.name}</h2>
          <p className="hero-copy">
            Base version: {job.base_parameter_version_id ?? strategy.current_parameter_version_id ?? 'unknown'} ·
            Candidates: {job.summary.candidate_count}
          </p>
        </div>
        <div className="hero-actions">
          <button
            className="ghost-button"
            onClick={() =>
              onAddCandidate({
                ...(strategy.parameters ?? {}),
                top_n: Number(strategy.parameters?.top_n ?? 5) + 2,
              })
            }
            type="button"
          >
            Add Manual Candidate
          </button>
        </div>
      </section>

      {conflictMessage ? <div className="error-banner">{conflictMessage}</div> : null}

      <section className="panel">
        <div className="panel-header">
          <h3>Candidate Differences Only</h3>
        </div>
        <div className="candidate-grid">
          {job.candidates.map((candidate) => (
            <OptimizationCandidateCard
              baselineParameters={strategy.parameters ?? {}}
              candidate={candidate}
              key={candidate.id}
              onPromote={onPromote}
              promoting={promotingCandidateId === candidate.id}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

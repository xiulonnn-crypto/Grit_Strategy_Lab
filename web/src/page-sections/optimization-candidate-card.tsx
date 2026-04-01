import { buildParameterDiffRows, formatParameterValue } from '../lib/adapters';
import type { ApiOptimizationCandidate, ParameterValue } from '../types';

type OptimizationCandidateCardProps = {
  baselineParameters: Record<string, ParameterValue>;
  candidate: ApiOptimizationCandidate;
  onPromote: (candidateId: string) => void;
  onDelete?: (candidateId: string) => void;
  promoting?: boolean;
  deleting?: boolean;
};

export function OptimizationCandidateCard({
  baselineParameters,
  candidate,
  onPromote,
  onDelete,
  promoting,
  deleting,
}: OptimizationCandidateCardProps): JSX.Element {
  const diffRows = buildParameterDiffRows(baselineParameters, candidate.parameter_snapshot);
  const totalReturn = candidate.metrics.total_return;

  return (
    <article className="candidate-card">
      <div className="candidate-card-header">
        <div>
          <p className="eyebrow">Candidate {candidate.rank}</p>
          <h4>{candidate.label}</h4>
        </div>
        <div className="candidate-score">
          <span>Score</span>
          <strong>{candidate.score.toFixed(2)}</strong>
        </div>
      </div>

      {candidate.summary ? <p className="workspace-card-copy">{candidate.summary}</p> : null}
      <div className="candidate-meta-row">
        <span>Total Return</span>
        <strong>{typeof totalReturn === 'number' ? `${totalReturn.toFixed(1)}%` : 'n/a'}</strong>
      </div>

      <div className="candidate-diff-list">
        {diffRows.map((row) => (
          <div className="candidate-diff-row" key={row.key}>
            <span>{row.key}</span>
            <strong>
              {formatParameterValue(row.previousValue)}
              {' -> '}
              {formatParameterValue(row.nextValue)}
            </strong>
          </div>
        ))}
        {diffRows.length === 0 ? <p className="empty-state">No parameter differences.</p> : null}
      </div>

      <div className="card-actions">
        <button className="primary-button" disabled={promoting} onClick={() => onPromote(candidate.id)} type="button">
          {promoting ? 'Promoting...' : 'Promote Current Version'}
        </button>
        {onDelete ? (
          <button className="ghost-button" disabled={deleting} onClick={() => onDelete(candidate.id)} type="button">
            {deleting ? 'Deleting...' : 'Delete Candidate'}
          </button>
        ) : null}
      </div>
    </article>
  );
}

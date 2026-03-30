import { useMemo, useState } from 'react';
import { buildParameterDiffRows } from '../lib/adapters';
import type { ApiOptimizationJobDetail, ApiStrategyDetail, ParameterValue } from '../types';
import { OptimizationCandidateCard } from './optimization-candidate-card';

type OptimizationManualLabProps = {
  job: ApiOptimizationJobDetail;
  strategy: ApiStrategyDetail;
  conflictMessage: string | null;
  promotingCandidateId: string | null;
  deletingCandidateId?: string | null;
  onPromote: (candidateId: string, comment: string) => Promise<void>;
  onAddCandidate: (parameterSnapshot: Record<string, ParameterValue>) => void;
  onDeleteCandidate: (candidateId: string) => Promise<void>;
  onDeleteLosingCandidates: () => Promise<void>;
};

export function OptimizationManualLabPhase4({
  job,
  strategy,
  conflictMessage,
  promotingCandidateId,
  deletingCandidateId,
  onPromote,
  onAddCandidate,
  onDeleteCandidate,
  onDeleteLosingCandidates,
}: OptimizationManualLabProps): JSX.Element {
  const [compareOpen, setCompareOpen] = useState(false);
  const [noteCandidateId, setNoteCandidateId] = useState<string | null>(null);
  const [revisionNote, setRevisionNote] = useState('');
  const topThree = useMemo(() => [...job.candidates].sort((left, right) => left.rank - right.rank).slice(0, 3), [job.candidates]);
  const losingCount = job.candidates.filter((candidate) => {
    const totalReturn = candidate.metrics.total_return;
    return typeof totalReturn === 'number' ? totalReturn < 0 : candidate.score < 0;
  }).length;

  async function submitPromoteNote(): Promise<void> {
    if (!noteCandidateId) {
      return;
    }
    await onPromote(noteCandidateId, revisionNote.trim());
    setNoteCandidateId(null);
    setRevisionNote('');
  }

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
                max_position_pct: Number(strategy.parameters?.max_position_pct ?? 15) - 1,
              })
            }
            type="button"
          >
            Add Manual Candidate
          </button>
          <button className="ghost-button" onClick={() => void onDeleteLosingCandidates()} type="button">
            Delete Losing Candidates {losingCount ? `(${losingCount})` : ''}
          </button>
          <button className="ghost-button" onClick={() => setCompareOpen(true)} type="button">
            Compare Top 3
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
              deleting={deletingCandidateId === candidate.id}
              key={candidate.id}
              onDelete={(candidateId) => void onDeleteCandidate(candidateId)}
              onPromote={(candidateId) => setNoteCandidateId(candidateId)}
              promoting={promotingCandidateId === candidate.id}
            />
          ))}
        </div>
      </section>

      {compareOpen ? (
        <section aria-label="Top 3 compare panel" className="workspace-compare-panel" role="dialog">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Rank Ordered Compare</p>
              <h3>Baseline + Top 3</h3>
            </div>
            <button className="text-button" onClick={() => setCompareOpen(false)} type="button">
              Close
            </button>
          </div>
          <div className="compare-grid">
            <section className="compare-column">
              <h4>Baseline</h4>
              <p>Version {strategy.current_parameter_version ?? 'n/a'}</p>
              <div className="candidate-diff-list">
                {Object.entries(strategy.parameters ?? {}).map(([key, value]) => (
                  <div className="candidate-diff-row" key={`baseline-${key}`}>
                    <span>{key}</span>
                    <strong>{String(value)}</strong>
                  </div>
                ))}
              </div>
            </section>
            {topThree.map((candidate) => (
              <section className="compare-column" key={`compare-${candidate.id}`}>
                <h4>{candidate.label}</h4>
                <p>Rank {candidate.rank}</p>
                <div className="candidate-diff-list">
                  {buildParameterDiffRows(strategy.parameters ?? {}, candidate).map((row) => (
                    <div className="candidate-diff-row" key={`${candidate.id}-${row.key}`}>
                      <span>{row.key}</span>
                      <strong>{String(row.nextValue)}</strong>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      ) : null}

      {noteCandidateId ? (
        <div className="modal-shell" role="dialog" aria-label="Revision note modal">
          <div className="modal-card">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Atomic Promote</p>
                <h3>Revision Note</h3>
              </div>
              <button className="text-button" onClick={() => setNoteCandidateId(null)} type="button">
                Cancel
              </button>
            </div>
            <textarea
              aria-label="Revision Note"
              className="prompt-box"
              onChange={(event) => setRevisionNote(event.target.value)}
              placeholder="Explain why this candidate should become the current version."
              value={revisionNote}
            />
            <div className="hero-actions">
              <button className="primary-button" onClick={() => void submitPromoteNote()} type="button">
                Promote with Note
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

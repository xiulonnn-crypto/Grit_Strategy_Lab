import { useMemo, useState } from 'react';
import { buildParameterDiffRows, formatParameterLabel, formatParameterValue } from '../lib/adapters';
import type { ApiOptimizationJobDetail, ApiStrategyDetail, ParameterValue } from '../types';
import { formatOptimizationCandidateLabel, OptimizationCandidateCard } from './optimization-candidate-card';

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

const TEXT = {
  heroEyebrow: '手动优化实验室',
  baseVersion: '基线版本',
  unknown: '未知',
  candidateCount: '候选数量',
  addManualCandidate: '新增手动候选',
  deleteLosingCandidates: '删除亏损候选',
  compareTop3: '对比前 3 名',
  candidateDiffOnly: '候选差异',
  noCandidates: '当前优化任务还没有可用候选。',
  compareDialogLabel: '前 3 名对比面板',
  compareEyebrow: '排名对比',
  compareTitle: '基线与前 3 名对比',
  close: '关闭',
  baseline: '基线',
  version: '版本',
  rank: '排名',
  noteDialogLabel: '晋升备注弹窗',
  promoteEyebrow: '原子晋升',
  noteTitle: '晋升备注',
  cancel: '取消',
  noteInputLabel: '晋升备注',
  notePlaceholder: '请说明为什么要将该候选晋升为当前版本。',
  promoteWithNote: '附备注晋升',
} as const;

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
  const strategyDisplayName =
    typeof strategy.parameters?.strategy_name === 'string' && strategy.parameters.strategy_name.trim()
      ? strategy.parameters.strategy_name.trim()
      : strategy.name;
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
    <div className="stack optimization-page">
      <section className="hero-card optimization-page__hero">
        <div>
          <p className="eyebrow">{TEXT.heroEyebrow}</p>
          <h2>{strategyDisplayName}</h2>
          <p className="hero-copy">
            {TEXT.baseVersion}：{job.base_parameter_version_id ?? strategy.current_parameter_version_id ?? TEXT.unknown}
            {' · '}
            {TEXT.candidateCount}：{job.summary.candidate_count}
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
            {TEXT.addManualCandidate}
          </button>
          <button className="ghost-button" onClick={() => void onDeleteLosingCandidates()} type="button">
            {TEXT.deleteLosingCandidates} {losingCount ? `(${losingCount})` : ''}
          </button>
          <button className="ghost-button" onClick={() => setCompareOpen(true)} type="button">
            {TEXT.compareTop3}
          </button>
        </div>
      </section>

      {conflictMessage ? <div className="error-banner">{conflictMessage}</div> : null}

      <section className="panel optimization-page__candidate-panel">
        <div className="panel-header">
          <h3>{TEXT.candidateDiffOnly}</h3>
        </div>
        {job.candidates.length ? (
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
        ) : (
          <p className="empty-state">{TEXT.noCandidates}</p>
        )}
      </section>

      {compareOpen ? (
        <section aria-label={TEXT.compareDialogLabel} className="workspace-compare-panel optimization-page__compare-panel" role="dialog">
          <div className="panel-header">
            <div>
              <p className="eyebrow">{TEXT.compareEyebrow}</p>
              <h3>{TEXT.compareTitle}</h3>
            </div>
            <button className="text-button" onClick={() => setCompareOpen(false)} type="button">
              {TEXT.close}
            </button>
          </div>
          <div className="compare-grid">
            <section className="compare-column">
              <h4>{TEXT.baseline}</h4>
              <p>
                {TEXT.version} {strategy.current_parameter_version ?? TEXT.unknown}
              </p>
              <div className="candidate-diff-list">
                {Object.entries(strategy.parameters ?? {}).map(([key, value]) => (
                  <div className="candidate-diff-row" key={`baseline-${key}`}>
                    <span>{formatParameterLabel(key)}</span>
                    <strong>{formatParameterValue(value, key)}</strong>
                  </div>
                ))}
              </div>
            </section>
            {topThree.map((candidate) => (
              <section className="compare-column" key={`compare-${candidate.id}`}>
                <h4>{formatOptimizationCandidateLabel(candidate.label, candidate.rank)}</h4>
                <p>
                  {TEXT.rank} {candidate.rank}
                </p>
                <div className="candidate-diff-list">
                  {buildParameterDiffRows(strategy.parameters ?? {}, candidate.parameter_snapshot).map((row) => (
                    <div className="candidate-diff-row" key={`${candidate.id}-${row.key}`}>
                      <span>{formatParameterLabel(row.key)}</span>
                      <strong>{formatParameterValue(row.nextValue, row.key)}</strong>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      ) : null}

      {noteCandidateId ? (
        <div className="modal-shell" role="dialog" aria-label={TEXT.noteDialogLabel}>
          <div className="modal-card optimization-page__note-modal">
            <div className="panel-header">
              <div>
                <p className="eyebrow">{TEXT.promoteEyebrow}</p>
                <h3>{TEXT.noteTitle}</h3>
              </div>
              <button className="text-button" onClick={() => setNoteCandidateId(null)} type="button">
                {TEXT.cancel}
              </button>
            </div>
            <textarea
              aria-label={TEXT.noteInputLabel}
              className="prompt-box"
              onChange={(event) => setRevisionNote(event.target.value)}
              placeholder={TEXT.notePlaceholder}
              value={revisionNote}
            />
            <div className="hero-actions">
              <button className="primary-button" onClick={() => void submitPromoteNote()} type="button">
                {TEXT.promoteWithNote}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

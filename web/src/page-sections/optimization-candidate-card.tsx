import { buildParameterDiffRows, formatParameterLabel, formatParameterValue } from '../lib/adapters';
import type { ApiOptimizationCandidate, ParameterValue } from '../types';

type OptimizationCandidateCardProps = {
  baselineParameters: Record<string, ParameterValue>;
  candidate: ApiOptimizationCandidate;
  onPromote: (candidateId: string) => void;
  onDelete?: (candidateId: string) => void;
  promoting?: boolean;
  deleting?: boolean;
};

const TEXT = {
  candidateRank: '候选方案',
  score: '评分',
  totalReturn: '总收益',
  notAvailable: '暂无',
  noDiff: '当前参数与基线一致。',
  promoting: '晋升中…',
  promote: '晋升为当前版本',
  deleting: '删除中…',
  delete: '删除候选',
} as const;

const LABEL_TRANSLATIONS: Record<string, string> = {
  'Aggressive Breakout': '进攻突破版',
  'Diff Only Candidate': '差异示例候选',
  'Overfit Reversal': '过拟合反转版',
  'Quality Momentum': '质量动量',
  'Risk Dialed In': '风险收敛版',
  'Volatility Cushion': '波动缓冲版',
};

const SUMMARY_TRANSLATIONS: Record<string, string> = {
  'Created directly from the recovered manual lab.': '已根据当前实验室参数新建候选。',
  'High beta': '高贝塔方案。',
  'Lead candidate': '当前领先候选。',
  'Losing candidate': '当前亏损候选。',
  'More selective entry with extra skip window.': '提高筛选强度，并增加跳过最近月份。',
  'Negative OOS behavior, should be cleaned from the lab.': '样本外表现转弱，建议从实验室中清理。',
  'Only two params should render.': '这里只展示两项参数变更。',
  'Runner up': '当前第二候选。',
  'Tighter breadth with a slightly more patient lookback.': '收紧持仓广度，并适度拉长回看窗口。',
  'Wider basket that captured more upside but with thinner conviction.': '扩大持仓篮子以增强上行捕捉，但信号置信度更薄。',
};

export function formatOptimizationCandidateLabel(label: string | null | undefined, rank?: number | null): string {
  const value = String(label ?? '').trim();
  if (!value) {
    return typeof rank === 'number' ? `${TEXT.candidateRank} ${rank}` : TEXT.candidateRank;
  }

  const candidateMatch = value.match(/^candidate\s+(\d+)$/i);
  if (candidateMatch) {
    return `${TEXT.candidateRank} ${candidateMatch[1]}`;
  }

  const manualCandidateMatch = value.match(/^manual\s+candidate\s+(\d+)$/i);
  if (manualCandidateMatch) {
    return `手动候选 ${manualCandidateMatch[1]}`;
  }

  const baselineMatch = value.match(/^baseline\s*\+\s*(\d+)$/i);
  if (baselineMatch) {
    return `基线 + ${baselineMatch[1]}`;
  }

  return LABEL_TRANSLATIONS[value] ?? value;
}

export function formatOptimizationCandidateSummary(summary: string | null | undefined): string | null {
  const value = String(summary ?? '').trim();
  if (!value) {
    return null;
  }
  return SUMMARY_TRANSLATIONS[value] ?? value;
}

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
  const summary = formatOptimizationCandidateSummary(candidate.summary);

  return (
    <article className="candidate-card">
      <div className="candidate-card-header">
        <div>
          <p className="eyebrow">
            {TEXT.candidateRank} {candidate.rank}
          </p>
          <h4>{formatOptimizationCandidateLabel(candidate.label, candidate.rank)}</h4>
        </div>
        <div className="candidate-score">
          <span>{TEXT.score}</span>
          <strong>{candidate.score.toFixed(2)}</strong>
        </div>
      </div>

      {summary ? <p className="workspace-card-copy">{summary}</p> : null}
      <div className="candidate-meta-row">
        <span>{TEXT.totalReturn}</span>
        <strong>{typeof totalReturn === 'number' ? `${totalReturn.toFixed(1)}%` : TEXT.notAvailable}</strong>
      </div>

      <div className="candidate-diff-list">
        {diffRows.map((row) => (
          <div className="candidate-diff-row" key={row.key}>
            <span>{formatParameterLabel(row.key)}</span>
            <strong>
              {formatParameterValue(row.previousValue, row.key)}
              {' → '}
              {formatParameterValue(row.nextValue, row.key)}
            </strong>
          </div>
        ))}
        {diffRows.length === 0 ? <p className="empty-state">{TEXT.noDiff}</p> : null}
      </div>

      <div className="card-actions">
        <button className="primary-button" disabled={promoting} onClick={() => onPromote(candidate.id)} type="button">
          {promoting ? TEXT.promoting : TEXT.promote}
        </button>
        {onDelete ? (
          <button className="ghost-button" disabled={deleting} onClick={() => onDelete(candidate.id)} type="button">
            {deleting ? TEXT.deleting : TEXT.delete}
          </button>
        ) : null}
      </div>
    </article>
  );
}

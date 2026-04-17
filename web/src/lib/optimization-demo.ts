import type {
  ApiBacktestRunDetail,
  ApiOptimizationCandidate,
  ApiOptimizationConstraint,
  ApiOptimizationHeatmap,
  ApiOptimizationJobCreatePayload,
  ApiOptimizationJobConstraintUpdatePayload,
  ApiOptimizationJobDetail,
  ApiOptimizationJobListItem,
  ApiOptimizationSearchSpaceField,
  ApiOptimizationStabilityCheck,
  ApiOptimizationTrialSummary,
  ApiOptimizationValidationWindow,
  ApiStrategyDetail,
  ParameterValue,
} from '../types';
import { buildDelta, clone, createCandidate } from './demoStoreShared';

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function readMetricNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

const SUPPORTED_OPTIMIZATION_CONSTRAINT_KEYS = new Set([
  'max_drawdown_pct',
  'out_of_sample_sharpe',
  'annualized_return',
  'stability',
  'return_sharpe',
]);

function sanitizeOptimizationConstraints(
  constraints: ApiOptimizationConstraint[] | undefined,
): ApiOptimizationConstraint[] | undefined {
  if (!Array.isArray(constraints)) {
    return constraints;
  }
  return constraints.filter((constraint) =>
    SUPPORTED_OPTIMIZATION_CONSTRAINT_KEYS.has(constraint.key),
  );
}

function normalizeObjective(objective?: string | null): 'return_sharpe' | 'annualized_return' | 'composite_score' {
  const normalized = String(objective ?? '').trim().toLowerCase();
  if (
    normalized === 'annualized_return' ||
    normalized === 'cagr' ||
    normalized === 'return'
  ) {
    return 'annualized_return';
  }
  if (normalized === 'composite_score' || normalized === 'score') {
    return 'composite_score';
  }
  return 'return_sharpe';
}

function normalizeConstraintMetricValue(
  constraintKey: string,
  value: number,
): number {
  switch (constraintKey) {
    case 'annualized_return':
      return Math.abs(value) <= 1.5 ? value * 100 : value;
    case 'max_drawdown_pct':
      return Math.abs(value) <= 1.5 ? Math.abs(value * 100) : Math.abs(value);
    case 'turnover':
      return Math.abs(value) <= 1.5 ? value * 100 : value;
    default:
      return value;
  }
}

function getCandidateConstraintMetricValue(
  candidate: Pick<ApiOptimizationCandidate, 'metrics'>,
  constraintKey: string,
): number | null {
  const metrics = candidate.metrics ?? {};
  const rawValue =
    constraintKey === 'annualized_return'
      ? readMetricNumber(metrics.annualized_return ?? metrics.cagr)
      : constraintKey === 'return_sharpe'
        ? readMetricNumber(metrics.return_sharpe ?? metrics.sharpe)
        : constraintKey === 'out_of_sample_sharpe'
          ? readMetricNumber(metrics.out_of_sample_sharpe ?? metrics.oos_sharpe)
          : constraintKey === 'max_drawdown_pct'
            ? readMetricNumber(metrics.max_drawdown_pct) ??
              (typeof metrics.max_drawdown === 'number' ? metrics.max_drawdown * 100 : null)
            : constraintKey === 'turnover'
              ? readMetricNumber(metrics.turnover_pct ?? metrics.turnover)
              : constraintKey === 'stability'
                ? readMetricNumber(metrics.stability)
                : readMetricNumber(metrics[constraintKey]);
  return typeof rawValue === 'number'
    ? normalizeConstraintMetricValue(constraintKey, rawValue)
    : null;
}

function countMatchingCombinationCandidates(
  candidates: ApiOptimizationCandidate[],
  constraints: ApiOptimizationConstraint[] | undefined,
): number {
  const activeConstraints = constraints ?? [];
  if (!activeConstraints.length) {
    return candidates.length;
  }
  return candidates.filter((candidate) =>
    activeConstraints.every((constraint) => {
      const metricValue = getCandidateConstraintMetricValue(candidate, constraint.key);
      if (metricValue === null) {
        return false;
      }
      return constraint.operator === '>='
        ? metricValue >= constraint.value
        : metricValue <= constraint.value;
    }),
  ).length;
}

function humanizeKey(key: string): string {
  const labels: Record<string, string> = {
    lookback_months: '回看月数',
    lookback_days: '回看天数',
    top_n: '持仓数量',
    max_position_pct: '最大单仓',
    skip_recent_months: '跳过近月',
    weighting_method: '权重方法',
    hold_rank_threshold: '持有阈值',
    grid_interval: '网格间距',
  };
  return labels[key] ?? key.replace(/_/g, ' ');
}

function cloneSearchSpace(fields: ApiOptimizationSearchSpaceField[] | undefined): ApiOptimizationSearchSpaceField[] {
  return (fields ?? []).map((field) => ({ ...field }));
}

export function buildOptimizationSearchSpace(
  strategy: ApiStrategyDetail,
  requestedFields?: ApiOptimizationSearchSpaceField[],
): ApiOptimizationSearchSpaceField[] {
  if (requestedFields?.length) {
    return requestedFields.map((field) => ({
      ...field,
      label: field.label || humanizeKey(field.key),
      current:
        field.current ??
        field.value ??
        strategy.parameters?.[field.key] ??
        null,
      tag: field.tag ?? (field.mode === 'range' ? '主搜索维度' : '锁定参数'),
    }));
  }

  const entries = Object.entries(strategy.parameters ?? {});
  const numericEntries = entries.filter(([, value]) => typeof value === 'number').slice(0, 2);
  const fixedEntries = entries
    .filter(([key]) => !numericEntries.some(([numericKey]) => numericKey === key))
    .slice(0, 2);

  const fields: ApiOptimizationSearchSpaceField[] = numericEntries.map(([key, value], index) => {
    const numericValue = Number(value);
    const step = Number.isInteger(numericValue) ? 1 : 0.5;
    return {
      key,
      label: humanizeKey(key),
      mode: 'range',
      current: numericValue,
      start: Math.max(1, numericValue - (index + 2) * step),
      end: numericValue + (index + 2) * step,
      step,
      tag: index === 0 ? '主搜索维度' : '辅助搜索维度',
    };
  });

  fixedEntries.forEach(([key, value]) => {
    fields.push({
      key,
      label: humanizeKey(key),
      mode: 'fixed',
      current: value,
      value,
      start: value,
      end: value,
      step: 1,
      tag: '锁定参数',
    });
  });

  return fields;
}

function buildOptimizationHeatmap(
  searchSpace: ApiOptimizationSearchSpaceField[],
  parameterSnapshot: Record<string, ParameterValue>,
  metrics: Record<string, number>,
): ApiOptimizationHeatmap {
  const rangeEntries = searchSpace.filter((entry) => entry.mode === 'range');
  const xEntry = rangeEntries[0];
  const yEntry = rangeEntries[1] ?? rangeEntries[0];
  const xCenter = asNumber(parameterSnapshot[xEntry?.key ?? ''] ?? xEntry?.current, asNumber(xEntry?.current, 0));
  const yCenter = asNumber(parameterSnapshot[yEntry?.key ?? ''] ?? yEntry?.current, asNumber(yEntry?.current, 0));
  const xStep = Math.max(asNumber(xEntry?.step, 1), 1);
  const yStep = Math.max(asNumber(yEntry?.step, 1), 1);
  const xValues = [xCenter - xStep, xCenter, xCenter + xStep].map((value) => Number(value.toFixed(2)));
  const yValues = [yCenter - yStep, yCenter, yCenter + yStep].map((value) => Number(value.toFixed(2)));
  const centerAnnualizedReturn = asNumber(metrics.annualized_return ?? metrics.cagr, 0);
  const centerReturnSharpe = asNumber(metrics.return_sharpe ?? metrics.sharpe, 0);
  const centerMaxDrawdownPct = asNumber(metrics.max_drawdown_pct, 0);
  const centerScore = asNumber(metrics.return_sharpe ?? metrics.sharpe, 0);
  const cells = yValues.flatMap((y, rowIndex) =>
    xValues.map((x, columnIndex) => {
      const distance = Math.abs(rowIndex - 1) + Math.abs(columnIndex - 1);
      const score = Number((centerScore - distance * 0.07).toFixed(2));
      return {
        x,
        y,
        score,
        metrics: {
          annualized_return: Number((centerAnnualizedReturn - distance * 0.008).toFixed(4)),
          return_sharpe: Number((centerReturnSharpe - distance * 0.07).toFixed(2)),
          max_drawdown_pct: Number((centerMaxDrawdownPct - distance * 1.8).toFixed(1)),
        },
        is_candidate: distance === 0,
        tone: (score >= centerScore - 0.02 ? 'hot' : score >= centerScore - 0.12 ? 'warm' : 'cool') as
          | 'hot'
          | 'warm'
          | 'cool',
      };
    }),
  );

  return {
    x_key: xEntry?.key ?? null,
    y_key: yEntry?.key ?? null,
    x_label: xEntry?.label ?? xEntry?.key ?? '横轴',
    y_label: yEntry?.label ?? yEntry?.key ?? '纵轴',
    x_values: xValues,
    y_values: yValues,
    cells,
  };
}

function buildStabilityChecks(metrics: Record<string, number>): ApiOptimizationStabilityCheck[] {
  const annualizedReturn = asNumber(metrics.annualized_return ?? metrics.cagr, 0);
  const returnSharpe = asNumber(metrics.return_sharpe ?? metrics.sharpe, 0);
  const outOfSampleSharpe = asNumber(metrics.out_of_sample_sharpe, 0);
  const maxDrawdownPct = asNumber(metrics.max_drawdown_pct, 0);
  const stability = asNumber(metrics.stability, 0);

  return [
    {
      key: 'annualized_return',
      label: '年化收益率',
      value: Number((annualizedReturn * 100).toFixed(1)),
      verdict: annualizedReturn >= 0.1 ? 'pass' : annualizedReturn >= 0.06 ? 'watch' : 'risk',
      detail:
        annualizedReturn >= 0.1
          ? '年化收益率已进入晋升阈值，可作为首要筛选指标。'
          : annualizedReturn >= 0.06
            ? '年化收益率已进入观察区，需要继续结合样本外表现复核。'
            : '年化收益率仍偏弱，暂不建议直接晋升。',
    },
    {
      key: 'return_sharpe',
      label: '收益夏普',
      value: Number(returnSharpe.toFixed(2)),
      verdict: returnSharpe >= 1 ? 'pass' : 'watch',
      detail: returnSharpe >= 1 ? '收益效率已达到主观察线。' : '收益效率仍需要继续抬升。',
    },
    {
      key: 'out_of_sample_sharpe',
      label: '样本外夏普',
      value: Number(outOfSampleSharpe.toFixed(2)),
      verdict: outOfSampleSharpe >= 0.9 ? 'pass' : 'watch',
      detail: outOfSampleSharpe >= 0.9 ? '样本外稳定性可接受。' : '样本外稳定性还要继续观察。',
    },
    {
      key: 'max_drawdown_pct',
      label: '最大回撤',
      value: Number(maxDrawdownPct.toFixed(1)),
      verdict: maxDrawdownPct >= -30 ? 'pass' : 'risk',
      detail: maxDrawdownPct >= -30 ? '回撤仍在护栏范围内。' : '回撤已经超过本轮护栏。',
    },
    {
      key: 'stability',
      label: '稳定性',
      value: Number(stability.toFixed(0)),
      verdict: stability >= 80 ? 'pass' : stability >= 60 ? 'watch' : 'risk',
      detail:
        stability >= 80
          ? '参数热区连续，适合进入晋升判断。'
          : stability >= 60
            ? '热区尚可，但还需要继续压测。'
            : '热区离散，建议回到配置页继续收边界。',
    },
  ];
}

function resolveOptimizationVerdict(metrics: Record<string, number>): 'pass' | 'watch' | 'risk' {
  const annualizedReturn = asNumber(metrics.annualized_return ?? metrics.cagr, 0);
  const returnSharpe = asNumber(metrics.return_sharpe ?? metrics.sharpe, 0);
  const outOfSampleSharpe = asNumber(metrics.out_of_sample_sharpe, 0);
  const maxDrawdownPct = asNumber(metrics.max_drawdown_pct, 0);
  const stability = asNumber(metrics.stability, 0);

  if (
    annualizedReturn >= 0.1 &&
    returnSharpe >= 1 &&
    outOfSampleSharpe >= 0.8 &&
    maxDrawdownPct >= -25 &&
    stability >= 70
  ) {
    return 'pass';
  }
  if (
    annualizedReturn >= 0.06 &&
    returnSharpe >= 0.6 &&
    outOfSampleSharpe >= 0.4 &&
    maxDrawdownPct >= -35 &&
    stability >= 50
  ) {
    return 'watch';
  }
  return 'risk';
}

function buildValidationWindows(metrics: Record<string, number>): ApiOptimizationValidationWindow[] {
  const annualizedReturn = asNumber(metrics.annualized_return ?? metrics.cagr, 0);
  const returnSharpe = asNumber(metrics.return_sharpe ?? metrics.sharpe, 0);
  const outOfSampleSharpe = asNumber(metrics.out_of_sample_sharpe, 0);
  const maxDrawdownPct = asNumber(metrics.max_drawdown_pct, 0);
  const stability = asNumber(metrics.stability, 0);

  const windows = [
    {
      label: '窗口 A',
      period_label: '训练早段 至 训练早段',
      annualized_return: Number((annualizedReturn - 0.012).toFixed(4)),
      return_sharpe: Number((returnSharpe - 0.04).toFixed(2)),
      out_of_sample_sharpe: Number((outOfSampleSharpe - 0.03).toFixed(2)),
      max_drawdown_pct: Number((maxDrawdownPct - 1.2).toFixed(1)),
      stability: Math.max(0, Number((stability - 4).toFixed(0))),
    },
    {
      label: '窗口 B',
      period_label: '训练中段 至 训练中段',
      annualized_return: Number(annualizedReturn.toFixed(4)),
      return_sharpe: Number(returnSharpe.toFixed(2)),
      out_of_sample_sharpe: Number(outOfSampleSharpe.toFixed(2)),
      max_drawdown_pct: Number(maxDrawdownPct.toFixed(1)),
      stability: Number(stability.toFixed(0)),
    },
    {
      label: '窗口 C',
      period_label: '训练尾段 至 训练尾段',
      annualized_return: Number((annualizedReturn - 0.019).toFixed(4)),
      return_sharpe: Number((returnSharpe - 0.09).toFixed(2)),
      out_of_sample_sharpe: Number((outOfSampleSharpe - 0.08).toFixed(2)),
      max_drawdown_pct: Number((maxDrawdownPct - 1.8).toFixed(1)),
      stability: Math.max(0, Number((stability - 9).toFixed(0))),
    },
  ];

  return windows.map((windowMetrics) => ({
    ...windowMetrics,
    verdict: resolveOptimizationVerdict({
      annualized_return: windowMetrics.annualized_return,
      return_sharpe: windowMetrics.return_sharpe,
      out_of_sample_sharpe: windowMetrics.out_of_sample_sharpe,
      max_drawdown_pct: windowMetrics.max_drawdown_pct,
      stability: windowMetrics.stability,
    }),
  }));
}

function resolveCandidatePresentation(rank: number): {
  title: string;
  label: string;
  summary: string;
  thesis: string;
} {
  const profiles = [
    {
      title: '稳定策略中心',
      label: '稳定策略中心',
      summary: '收益与样本外表现平衡，适合作为当前首选候选。',
      thesis: '当前候选在收益效率、样本外稳定性和热区连续性之间保持了更均衡的表现。',
    },
    {
      title: '稳态晋升候选',
      label: '稳态晋升候选',
      summary: '样本外约束更稳，适合作为次优晋升备选。',
      thesis: '候选更偏向稳态验证，适合在风险偏好更低的场景下使用。',
    },
    {
      title: '收益扩张探索',
      label: '收益扩张探索',
      summary: '收益上限更高，但样本外和稳定性需要继续观察。',
      thesis: '候选在收益端更激进，但样本外表现和回撤护栏还不够稳。',
    },
    {
      title: '边界回退样本',
      label: '边界回退样本',
      summary: '收益没有形成稳定热区，建议回到配置页收窄边界。',
      thesis: '候选已逼近风险边界，当前不适合直接进入晋升流程。',
    },
  ];
  return profiles[Math.min(rank - 1, profiles.length - 1)];
}

function resolveStatusLabel(candidate: ApiOptimizationCandidate): string {
  const verdict = resolveOptimizationVerdict(candidate.metrics);
  if (verdict === 'pass') {
    return '可晋升';
  }
  if (verdict === 'watch') {
    return '继续观察';
  }
  return '需回退';
}

function isOptimizationTerminalStatus(status: string): boolean {
  return ['COMPLETED', 'PARTIALLY_FAILED', 'FAILED'].includes(status);
}

function hydrateCandidate(
  strategy: ApiStrategyDetail,
  searchSpace: ApiOptimizationSearchSpaceField[],
  candidate: ApiOptimizationCandidate,
  rank: number,
): ApiOptimizationCandidate {
  const presentation = resolveCandidatePresentation(rank);
  const title = candidate.title ?? presentation.title;
  const summary = candidate.summary ?? presentation.summary;
  const statusLabel = candidate.status_label ?? resolveStatusLabel(candidate);
  const metrics = {
    ...candidate.metrics,
    return_sharpe: asNumber(candidate.metrics.return_sharpe ?? candidate.metrics.sharpe, 0),
    out_of_sample_sharpe: asNumber(candidate.metrics.out_of_sample_sharpe, 0),
    max_drawdown_pct: asNumber(candidate.metrics.max_drawdown_pct, 0),
    stability: asNumber(candidate.metrics.stability, 0),
  };

  return {
    ...candidate,
    rank,
    title,
    label: candidate.label || presentation.label,
    summary,
    parameter_delta:
      Object.keys(candidate.parameter_delta ?? {}).length > 0
        ? clone(candidate.parameter_delta)
        : buildDelta(strategy.parameters ?? {}, candidate.parameter_snapshot ?? {}),
    metrics,
    status_label: statusLabel,
    analysis: {
      title,
      thesis: candidate.analysis?.thesis ?? presentation.thesis,
      shelf_copy: candidate.analysis?.shelf_copy ?? summary,
      stability_verdict: statusLabel,
      stability_summary:
        candidate.analysis?.stability_summary ??
        (statusLabel === '可晋升'
          ? '当前候选已经通过主护栏检查，可以进入版本晋升判断。'
          : statusLabel === '继续观察'
            ? '当前候选已进入观察区，建议继续比较热区和多窗口结果。'
            : '当前候选触碰风险边界，建议返回配置页继续收边界。'),
      stability_checks:
        candidate.analysis?.stability_checks?.length
          ? clone(candidate.analysis.stability_checks)
          : buildStabilityChecks(metrics),
      validation_windows:
        candidate.analysis?.validation_windows?.length
          ? clone(candidate.analysis.validation_windows)
          : buildValidationWindows(metrics),
      heatmap:
        candidate.analysis?.heatmap ??
        buildOptimizationHeatmap(searchSpace, candidate.parameter_snapshot ?? {}, metrics),
    },
  };
}

function scoreOptimizationMetrics(metrics: Record<string, number>, objective?: string | null): number {
  const normalizedObjective = normalizeObjective(objective);
  const annualizedReturnPct = asNumber(metrics.annualized_return ?? metrics.cagr, 0) * 100;
  const returnSharpe = asNumber(metrics.return_sharpe ?? metrics.sharpe, 0);
  const outOfSampleSharpe = asNumber(metrics.out_of_sample_sharpe, 0);
  const totalReturnPct =
    typeof metrics.total_return_pct === 'number'
      ? metrics.total_return_pct
      : asNumber(metrics.total_return, 0) * 100;
  const stability = asNumber(metrics.stability, 0);
  const drawdownPenalty = Math.abs(asNumber(metrics.max_drawdown_pct, 0));

  if (normalizedObjective === 'annualized_return') {
    return Number(
      (
        annualizedReturnPct * 0.05 +
        totalReturnPct * 0.01 +
        outOfSampleSharpe * 0.15 +
        stability / 1000 -
        drawdownPenalty / 200
      ).toFixed(3),
    );
  }

  if (normalizedObjective === 'composite_score') {
    return Number(
      (
        returnSharpe * 0.26 +
        outOfSampleSharpe * 0.24 +
        annualizedReturnPct * 0.1 +
        totalReturnPct * 0.002 +
        stability / 110 -
        drawdownPenalty / 28
      ).toFixed(3),
    );
  }

  return Number(
    (
      returnSharpe * 0.4 +
      outOfSampleSharpe * 0.25 +
      annualizedReturnPct * 0.03 +
      totalReturnPct * 0.002 +
      stability / 1000 -
      drawdownPenalty / 200
    ).toFixed(3),
  );
}

function buildOptimizationTrialSummary(candidate: ApiOptimizationCandidate | undefined | null): ApiOptimizationTrialSummary | undefined {
  if (!candidate) {
    return undefined;
  }

  return {
    trial_index: candidate.rank,
    label: candidate.label,
    status: candidate.status,
    parameter_snapshot: clone(candidate.parameter_snapshot ?? {}),
    metrics: clone(candidate.metrics ?? {}),
    score: asNumber(candidate.score, 0),
    error_message: null,
    started_at: null,
    completed_at: null,
  };
}

function getObjectiveMetricValue(
  candidate: ApiOptimizationCandidate,
  objective: ReturnType<typeof normalizeObjective>,
): number {
  if (objective === 'annualized_return') {
    return readMetricNumber(candidate.metrics?.annualized_return ?? candidate.metrics?.cagr) ?? 0;
  }
  if (objective === 'composite_score') {
    return typeof candidate.score === 'number' ? candidate.score : 0;
  }
  return readMetricNumber(candidate.metrics?.return_sharpe ?? candidate.metrics?.sharpe) ?? 0;
}

function rerankOptimizationCandidates(
  candidates: ApiOptimizationCandidate[],
  objective: ReturnType<typeof normalizeObjective>,
): ApiOptimizationCandidate[] {
  return [...candidates]
    .sort((left, right) => {
      const primaryDelta =
        getObjectiveMetricValue(right, objective) - getObjectiveMetricValue(left, objective);
      if (Math.abs(primaryDelta) > 1e-9) {
        return primaryDelta;
      }
      const rankDelta =
        (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER);
      if (rankDelta !== 0) {
        return rankDelta;
      }
      return String(left.id ?? '').localeCompare(String(right.id ?? ''));
    })
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
    }));
}

export function applyOptimizationJobConstraintUpdate(
  job: ApiOptimizationJobDetail,
  payload: ApiOptimizationJobConstraintUpdatePayload,
  strategy: ApiStrategyDetail,
  updatedAt: string,
  sourceRun?: ApiBacktestRunDetail | null,
): ApiOptimizationJobDetail {
  const nextObjective = normalizeObjective(
    payload.objective ?? job.summary.objective ?? job.request.objective,
  );
  const nextConstraintPresetKey =
    payload.constraint_preset_key ??
    job.summary.constraint_preset_key ??
    job.request.constraint_preset_key ??
    'balanced';
  const nextConstraintLabel =
    payload.constraint_label ??
    job.summary.constraint_label ??
    job.request.constraint_label ??
    '平衡型';
  const nextConstraints =
    sanitizeOptimizationConstraints(
      clone(payload.constraints ?? job.summary.constraints ?? job.request.constraints ?? []),
    ) ?? [];
  const rerankedCandidates = rerankOptimizationCandidates(job.candidates, nextObjective);
  const matchingCombinations = rerankedCandidates.filter((candidate) =>
    nextConstraints.every((constraint) => {
      const metricValue = getCandidateConstraintMetricValue(candidate, constraint.key);
      if (metricValue === null) {
        return false;
      }
      return constraint.operator === '>='
        ? metricValue >= constraint.value
        : metricValue <= constraint.value;
    }),
  );
  const matchingCombinationCount = matchingCombinations.length;
  const bestCandidate = rerankedCandidates[0] ?? null;

  return hydrateOptimizationJob(
    strategy,
    {
      ...job,
      updated_at: updatedAt,
      request: {
        ...job.request,
        objective: nextObjective,
        constraint_preset_key: nextConstraintPresetKey,
        constraint_label: nextConstraintLabel,
        constraints: clone(nextConstraints),
      },
      summary: {
        ...job.summary,
        objective: nextObjective,
        constraint_preset_key: nextConstraintPresetKey,
        constraint_label: nextConstraintLabel,
        constraints: clone(nextConstraints),
        best_metrics_summary: buildOptimizationTrialSummary(bestCandidate) ?? null,
        matching_combination_count: matchingCombinationCount,
      },
      result: {
        ...job.result,
        constraint_preset_key: nextConstraintPresetKey,
        constraint_label: nextConstraintLabel,
        constraints: clone(nextConstraints),
        best_candidate_id: bestCandidate?.id ?? null,
        best_candidate_label: bestCandidate?.label ?? null,
      },
      candidates: rerankedCandidates,
      matching_combination_count: matchingCombinationCount,
      matching_combinations: clone(matchingCombinations),
      best_metrics_summary: buildOptimizationTrialSummary(bestCandidate) ?? null,
    },
    sourceRun,
  );
}

function buildGeneratedCandidates(
  strategy: ApiStrategyDetail,
  payload: ApiOptimizationJobCreatePayload,
  searchSpace: ApiOptimizationSearchSpaceField[],
  sourceRun?: ApiBacktestRunDetail | null,
): ApiOptimizationCandidate[] {
  const strategyParameters = clone(strategy.parameters ?? {});
  const rangeEntries = searchSpace.filter((entry) => entry.mode === 'range');
  const baseReturn = asNumber(sourceRun?.metrics?.total_return, 0.16) * 100;
  const baseAnnualizedReturn = asNumber(
    sourceRun?.metrics?.annualized_return,
    Math.max(asNumber(sourceRun?.metrics?.total_return, 0.16) * 0.65, 0.08),
  );
  const baseSharpe = asNumber(sourceRun?.metrics?.sharpe, 0.92);
  const baseDrawdown = Math.abs(asNumber(sourceRun?.metrics?.max_drawdown, 0.3)) * 100 || 30;

  function applyAdjustments(adjustments: number[]): Record<string, ParameterValue> {
    const snapshot = clone(strategyParameters);
    adjustments.forEach((delta, index) => {
      const entry = rangeEntries[index];
      if (!entry?.key) {
        return;
      }
      const currentValue = snapshot[entry.key] ?? entry.current ?? entry.value;
      if (typeof currentValue !== 'number') {
        return;
      }
      const step = asNumber(entry.step, 1);
      const start = asNumber(entry.start, currentValue);
      const end = asNumber(entry.end, currentValue);
      const nextValue = Math.max(start, Math.min(end, currentValue + delta * step));
      snapshot[entry.key] = Number.isInteger(currentValue) ? Math.round(nextValue) : Number(nextValue.toFixed(2));
    });
    return snapshot;
  }

  const profiles = [
    {
      adjustments: [-1, -1],
      metrics: {
        annualized_return_pct: Number(((baseAnnualizedReturn + 0.038) * 100).toFixed(1)),
        return_sharpe: Number((baseSharpe + 0.24).toFixed(2)),
        out_of_sample_sharpe: Number((baseSharpe + 0.08).toFixed(2)),
        max_drawdown_pct: Number((-(baseDrawdown - 4.8)).toFixed(1)),
        stability: 82,
        turnover: 9.4,
        total_return_pct: Number((baseReturn + 5.6).toFixed(1)),
      },
    },
    {
      adjustments: [0, 0],
      metrics: {
        annualized_return_pct: Number(((baseAnnualizedReturn + 0.028) * 100).toFixed(1)),
        return_sharpe: Number((baseSharpe + 0.18).toFixed(2)),
        out_of_sample_sharpe: Number((baseSharpe + 0.12).toFixed(2)),
        max_drawdown_pct: Number((-(baseDrawdown - 6.2)).toFixed(1)),
        stability: 88,
        turnover: 8.1,
        total_return_pct: Number((baseReturn + 4.1).toFixed(1)),
      },
    },
    {
      adjustments: [-2, -2],
      metrics: {
        annualized_return_pct: Number(((baseAnnualizedReturn + 0.016) * 100).toFixed(1)),
        return_sharpe: Number((baseSharpe + 0.28).toFixed(2)),
        out_of_sample_sharpe: Number((baseSharpe - 0.03).toFixed(2)),
        max_drawdown_pct: Number((-(baseDrawdown - 1.4)).toFixed(1)),
        stability: 64,
        turnover: 11.6,
        total_return_pct: Number((baseReturn + 7.2).toFixed(1)),
      },
    },
    {
      adjustments: [-3, -3],
      metrics: {
        annualized_return_pct: Number((Math.max((baseAnnualizedReturn - 0.01) * 100, 3)).toFixed(1)),
        return_sharpe: Number((baseSharpe + 0.33).toFixed(2)),
        out_of_sample_sharpe: Number((baseSharpe - 0.21).toFixed(2)),
        max_drawdown_pct: Number((-(baseDrawdown + 3.6)).toFixed(1)),
        stability: 43,
        turnover: 15.4,
        total_return_pct: Number((baseReturn + 8.8).toFixed(1)),
      },
    },
  ];

  return profiles.map((profile, index) => {
    const rank = index + 1;
    const presentation = resolveCandidatePresentation(rank);
    const metrics = {
      ...profile.metrics,
      annualized_return: Number((profile.metrics.annualized_return_pct / 100).toFixed(4)),
      cagr: Number((profile.metrics.annualized_return_pct / 100).toFixed(4)),
      sharpe: profile.metrics.return_sharpe,
      total_return: Number((profile.metrics.total_return_pct / 100).toFixed(4)),
      max_drawdown: Number((profile.metrics.max_drawdown_pct / 100).toFixed(4)),
    };
    const parameterSnapshot = applyAdjustments(profile.adjustments);
    const score = scoreOptimizationMetrics(
      metrics,
      normalizeObjective(payload.objective ?? 'return_sharpe'),
    );

    const candidate = createCandidate(
      strategy,
      {
        label: presentation.label,
        title: presentation.title,
        summary: presentation.summary,
        status: 'SUCCEEDED',
        score,
        parameter_snapshot: parameterSnapshot,
        metrics,
        base_parameter_version_id: payload.base_parameter_version_id ?? strategy.current_parameter_version_id ?? null,
      },
      rank,
    );

    return hydrateCandidate(strategy, searchSpace, candidate, rank);
  });
}

export function hydrateOptimizationJob(
  strategy: ApiStrategyDetail,
  job: ApiOptimizationJobDetail,
  sourceRun?: ApiBacktestRunDetail | null,
): ApiOptimizationJobDetail {
  const status = job.status || 'COMPLETED';
  const searchSpace = buildOptimizationSearchSpace(
    strategy,
    job.request.search_space ?? job.summary.search_space,
  );
  const request: ApiOptimizationJobDetail['request'] = {
    ...job.request,
    objective: normalizeObjective(job.request.objective as string | undefined),
    base_parameter_version_id:
      (job.request.base_parameter_version_id as string | null | undefined) ??
      job.base_parameter_version_id ??
      strategy.current_parameter_version_id ??
      null,
    source_run_id: (job.request.source_run_id as string | null | undefined) ?? sourceRun?.id ?? null,
    entry_point: (job.request.entry_point as string | null | undefined) ?? 'lab_menu',
    validation_mode: (job.request.validation_mode as string | null | undefined) ?? 'walk_forward',
    budget_combinations: asNumber(job.request.budget_combinations ?? job.summary.budget_combinations, 42),
    search_space: cloneSearchSpace(searchSpace),
    constraints: sanitizeOptimizationConstraints(job.request.constraints),
  };
  const shouldGenerateCandidates = job.candidates.length > 0 || isOptimizationTerminalStatus(status);
  const generatedCandidates =
    job.candidates.length > 0
      ? [...job.candidates]
          .sort((left, right) => left.rank - right.rank || right.score - left.score)
          .map((candidate, index) => hydrateCandidate(strategy, searchSpace, candidate, index + 1))
      : shouldGenerateCandidates
        ? buildGeneratedCandidates(strategy, request, searchSpace, sourceRun)
        : [];

  const bestCandidate = generatedCandidates[0] ?? null;
  const summary: ApiOptimizationJobDetail['summary'] = {
    ...job.summary,
    objective: normalizeObjective(
      (job.summary.objective as string | undefined) ??
        (request.objective as string | undefined),
    ),
    candidate_count: generatedCandidates.length,
    baseline_parameter_version_id:
      (job.summary.baseline_parameter_version_id as string | null | undefined) ??
      (request.base_parameter_version_id as string | null | undefined) ??
      null,
    entry_point: (job.summary.entry_point as string | null | undefined) ?? (request.entry_point as string | null | undefined) ?? 'lab_menu',
    validation_mode:
      (job.summary.validation_mode as string | null | undefined) ??
      (request.validation_mode as string | null | undefined) ??
      'walk_forward',
    source_run_id:
      (job.summary.source_run_id as string | null | undefined) ??
      (request.source_run_id as string | null | undefined) ??
      null,
    budget_combinations: asNumber(job.summary.budget_combinations ?? request.budget_combinations, 42),
    completed_combinations: asNumber(
      job.summary.completed_combinations ??
        (isOptimizationTerminalStatus(status) ? request.budget_combinations : 0),
      isOptimizationTerminalStatus(status) ? asNumber(request.budget_combinations, 42) : 0,
    ),
    search_space: cloneSearchSpace(searchSpace),
    resume_ready: typeof job.summary.resume_ready === 'boolean' ? job.summary.resume_ready : undefined,
    persisted_trial_count:
      typeof job.summary.persisted_trial_count === 'number' ? job.summary.persisted_trial_count : undefined,
    next_trial_index: typeof job.summary.next_trial_index === 'number' ? job.summary.next_trial_index : undefined,
    interrupted_reason:
      typeof job.summary.interrupted_reason === 'string' ? job.summary.interrupted_reason : undefined,
    best_metrics_summary:
      job.summary.best_metrics_summary && typeof job.summary.best_metrics_summary === 'object'
        ? clone(job.summary.best_metrics_summary as ApiOptimizationTrialSummary)
        : undefined,
    estimated_remaining_minutes:
      typeof job.summary.estimated_remaining_minutes === 'number' ? job.summary.estimated_remaining_minutes : undefined,
    estimated_completed_at:
      typeof job.summary.estimated_completed_at === 'string' ? job.summary.estimated_completed_at : undefined,
    constraints: sanitizeOptimizationConstraints(job.summary.constraints ?? request.constraints),
    matching_combination_source:
      typeof job.summary.matching_combination_source === 'string'
        ? job.summary.matching_combination_source
        : typeof job.matching_combination_source === 'string'
          ? job.matching_combination_source
          : undefined,
  };
  summary.status = (job.summary.status as string | undefined) ?? status;
  summary.progress_pct = asNumber(job.summary.progress_pct, isOptimizationTerminalStatus(status) ? 100 : 0);
  summary.current_stage =
    (job.summary.current_stage as string | undefined) ?? (isOptimizationTerminalStatus(status) ? '优化完成' : '正在准备');
  summary.latest_update =
    (job.summary.latest_update as string | undefined) ??
    (isOptimizationTerminalStatus(status) ? '优化任务已完成。' : '优化任务已创建，正在准备搜索队列。');
  if (typeof job.summary.latest_candidate_label === 'string') {
    summary.latest_candidate_label = job.summary.latest_candidate_label;
  }
  if (!summary.best_metrics_summary) {
    summary.best_metrics_summary =
      buildOptimizationTrialSummary(bestCandidate) ??
      (job.best_metrics_summary ? clone(job.best_metrics_summary as ApiOptimizationTrialSummary) : undefined);
  }
  if (isOptimizationTerminalStatus(status)) {
    const providedMatchingCombinationCount =
      typeof job.summary.matching_combination_count === 'number' &&
      Number.isFinite(job.summary.matching_combination_count)
        ? job.summary.matching_combination_count
        : typeof job.matching_combination_count === 'number' &&
            Number.isFinite(job.matching_combination_count)
          ? job.matching_combination_count
          : null;
    summary.matching_combination_count =
      providedMatchingCombinationCount ??
      countMatchingCombinationCandidates(
        generatedCandidates,
        (summary.constraints ?? request.constraints) as ApiOptimizationConstraint[] | undefined,
      );
  }
  const result: ApiOptimizationJobDetail['result'] = {
    ...job.result,
    best_candidate_id: bestCandidate?.id ?? null,
    best_candidate_label: bestCandidate?.label ?? null,
    baseline_parameter_version_id:
      (job.result.baseline_parameter_version_id as string | null | undefined) ??
      (request.base_parameter_version_id as string | null | undefined) ??
      null,
    headline: (job.result.headline as string | null | undefined) ?? bestCandidate?.title ?? null,
    summary: (job.result.summary as string | null | undefined) ?? bestCandidate?.summary ?? null,
    stability_verdict:
      (job.result.stability_verdict as string | null | undefined) ??
      bestCandidate?.analysis?.stability_verdict ??
      null,
    constraints: sanitizeOptimizationConstraints(
      (job.result.constraints as ApiOptimizationConstraint[] | undefined) ??
        summary.constraints ??
        request.constraints,
    ),
  };
  result.status = (job.result.status as string | undefined) ?? status;
  result.progress_pct = asNumber(
    job.result.progress_pct,
    asNumber(summary.progress_pct, isOptimizationTerminalStatus(status) ? 100 : 0),
  );
  result.current_stage =
    (job.result.current_stage as string | undefined) ?? (summary.current_stage as string | undefined) ?? null;
  result.latest_update =
    (job.result.latest_update as string | undefined) ?? (summary.latest_update as string | undefined) ?? null;

  const completedAt =
    job.completed_at ??
    (['COMPLETED', 'PARTIALLY_FAILED', 'FAILED'].includes(status)
      ? job.updated_at ?? job.created_at ?? null
      : null);

  return {
    ...job,
    status,
    request,
    summary,
    result,
    candidates: generatedCandidates,
    base_parameter_version_id:
      (request.base_parameter_version_id as string | null | undefined) ??
      strategy.current_parameter_version_id ??
      null,
    matching_combination_count: summary.matching_combination_count ?? null,
    matching_combination_source: summary.matching_combination_source ?? null,
    best_metrics_summary: summary.best_metrics_summary ?? null,
    updated_at: job.updated_at ?? job.completed_at ?? job.created_at ?? undefined,
    completed_at: completedAt,
  };
}

export function buildOptimizationJobListItem(
  strategy: ApiStrategyDetail,
  job: ApiOptimizationJobDetail,
): ApiOptimizationJobListItem {
  return {
    id: job.id,
    strategy_id: job.strategy_id,
    strategy_name: strategy.name,
    status: job.status,
    entry_point: typeof job.summary.entry_point === 'string' ? job.summary.entry_point : typeof job.request.entry_point === 'string' ? job.request.entry_point : null,
    validation_mode:
      typeof job.summary.validation_mode === 'string'
        ? job.summary.validation_mode
        : typeof job.request.validation_mode === 'string'
          ? job.request.validation_mode
          : null,
    source_run_id:
      typeof job.summary.source_run_id === 'string'
        ? job.summary.source_run_id
        : typeof job.request.source_run_id === 'string'
          ? job.request.source_run_id
          : null,
    budget_combinations: asNumber(job.summary.budget_combinations ?? job.request.budget_combinations, 42),
    completed_combinations: asNumber(
      job.summary.completed_combinations ?? job.summary.budget_combinations ?? job.request.budget_combinations,
      42,
    ),
    progress_pct: asNumber(job.summary.progress_pct, isOptimizationTerminalStatus(job.status) ? 100 : 0),
    current_stage: typeof job.summary.current_stage === 'string' ? job.summary.current_stage : null,
    latest_update: typeof job.summary.latest_update === 'string' ? job.summary.latest_update : null,
    estimated_remaining_minutes:
      typeof job.summary.estimated_remaining_minutes === 'number' ? job.summary.estimated_remaining_minutes : null,
    estimated_completed_at:
      typeof job.summary.estimated_completed_at === 'string' ? job.summary.estimated_completed_at : null,
    best_candidate_id:
      typeof job.result.best_candidate_id === 'string'
        ? job.result.best_candidate_id
        : job.candidates[0]?.id ?? null,
    best_candidate_label:
      typeof job.result.best_candidate_label === 'string'
        ? job.result.best_candidate_label
        : job.candidates[0]?.label ?? null,
    base_parameter_version_id:
      typeof job.base_parameter_version_id === 'string'
        ? job.base_parameter_version_id
        : typeof job.request.base_parameter_version_id === 'string'
          ? job.request.base_parameter_version_id
          : null,
    created_at: job.created_at ?? null,
    updated_at: job.updated_at ?? null,
    completed_at: job.completed_at ?? null,
    resume_ready: typeof job.summary.resume_ready === 'boolean' ? job.summary.resume_ready : undefined,
    persisted_trial_count:
      typeof job.summary.persisted_trial_count === 'number' ? job.summary.persisted_trial_count : undefined,
    next_trial_index: typeof job.summary.next_trial_index === 'number' ? job.summary.next_trial_index : undefined,
    interrupted_reason:
      typeof job.summary.interrupted_reason === 'string' ? job.summary.interrupted_reason : undefined,
    best_metrics_summary:
      job.summary.best_metrics_summary && typeof job.summary.best_metrics_summary === 'object'
        ? clone(job.summary.best_metrics_summary as ApiOptimizationTrialSummary)
        : buildOptimizationTrialSummary(job.candidates[0]),
  };
}

import type {
  ApiBacktestRunDetail,
  ApiOptimizationCandidate,
  ApiOptimizationHeatmap,
  ApiOptimizationJobCreatePayload,
  ApiOptimizationJobDetail,
  ApiOptimizationJobListItem,
  ApiOptimizationSearchSpaceField,
  ApiOptimizationStabilityCheck,
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
  centerScore: number,
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
  const cells = yValues.flatMap((y, rowIndex) =>
    xValues.map((x, columnIndex) => {
      const distance = Math.abs(rowIndex - 1) + Math.abs(columnIndex - 1);
      const score = Number((centerScore - distance * 0.07).toFixed(2));
      return {
        x,
        y,
        score,
        is_candidate: distance === 0,
        tone: score >= centerScore - 0.02 ? 'hot' : score >= centerScore - 0.12 ? 'warm' : 'cool',
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
  const returnSharpe = asNumber(metrics.return_sharpe ?? metrics.sharpe, 0);
  const outOfSampleSharpe = asNumber(metrics.out_of_sample_sharpe, 0);
  const maxDrawdownPct = asNumber(metrics.max_drawdown_pct, 0);
  const stability = asNumber(metrics.stability, 0);

  return [
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

function buildValidationWindows(
  metrics: Record<string, number>,
  statusLabel: string,
): ApiOptimizationValidationWindow[] {
  const returnSharpe = asNumber(metrics.return_sharpe ?? metrics.sharpe, 0);
  const outOfSampleSharpe = asNumber(metrics.out_of_sample_sharpe, 0);
  const maxDrawdownPct = asNumber(metrics.max_drawdown_pct, 0);
  const stability = asNumber(metrics.stability, 0);
  const bestVerdict = statusLabel === '可晋升' ? 'pass' : statusLabel === '继续观察' ? 'watch' : 'risk';

  return [
    {
      label: '窗口 A',
      return_sharpe: Number((returnSharpe - 0.04).toFixed(2)),
      out_of_sample_sharpe: Number((outOfSampleSharpe - 0.03).toFixed(2)),
      max_drawdown_pct: Number((maxDrawdownPct - 1.2).toFixed(1)),
      stability: Math.max(0, Number((stability - 4).toFixed(0))),
      verdict: bestVerdict === 'pass' ? 'pass' : 'watch',
    },
    {
      label: '窗口 B',
      return_sharpe: Number(returnSharpe.toFixed(2)),
      out_of_sample_sharpe: Number(outOfSampleSharpe.toFixed(2)),
      max_drawdown_pct: Number(maxDrawdownPct.toFixed(1)),
      stability: Number(stability.toFixed(0)),
      verdict: bestVerdict,
    },
    {
      label: '窗口 C',
      return_sharpe: Number((returnSharpe - 0.09).toFixed(2)),
      out_of_sample_sharpe: Number((outOfSampleSharpe - 0.08).toFixed(2)),
      max_drawdown_pct: Number((maxDrawdownPct - 1.8).toFixed(1)),
      stability: Math.max(0, Number((stability - 9).toFixed(0))),
      verdict: bestVerdict === 'risk' ? 'risk' : 'watch',
    },
  ];
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
  const outOfSampleSharpe = asNumber(candidate.metrics.out_of_sample_sharpe, 0);
  const stability = asNumber(candidate.metrics.stability, 0);
  const drawdown = asNumber(candidate.metrics.max_drawdown_pct, 0);
  if (outOfSampleSharpe >= 0.9 && stability >= 80 && drawdown >= -30) {
    return '可晋升';
  }
  if (stability >= 60 && drawdown >= -32) {
    return '继续观察';
  }
  return '需回退';
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
          : buildValidationWindows(metrics, statusLabel),
      heatmap:
        candidate.analysis?.heatmap ??
        buildOptimizationHeatmap(searchSpace, candidate.parameter_snapshot ?? {}, asNumber(metrics.return_sharpe, 0)),
    },
  };
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
      sharpe: profile.metrics.return_sharpe,
      total_return: Number((profile.metrics.total_return_pct / 100).toFixed(4)),
    };
    const parameterSnapshot = applyAdjustments(profile.adjustments);
    const score = Number(
      (
        asNumber(metrics.return_sharpe) * 0.55 +
        asNumber(metrics.out_of_sample_sharpe) * 0.35 +
        asNumber(metrics.stability) / 1000 -
        Math.abs(asNumber(metrics.max_drawdown_pct)) / 1000
      ).toFixed(3),
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
    objective: (job.request.objective as string | undefined) ?? 'sharpe',
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
  };
  const shouldGenerateCandidates = job.candidates.length > 0 || !['QUEUED', 'RUNNING'].includes(status);
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
    objective: (job.summary.objective as string | undefined) ?? (request.objective as string | undefined) ?? 'sharpe',
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
      job.summary.completed_combinations ?? (status === 'COMPLETED' ? request.budget_combinations : 0),
      status === 'COMPLETED' ? asNumber(request.budget_combinations, 42) : 0,
    ),
    search_space: cloneSearchSpace(searchSpace),
  };
  summary.status = (job.summary.status as string | undefined) ?? status;
  summary.progress_pct = asNumber(job.summary.progress_pct, status === 'COMPLETED' ? 100 : 0);
  summary.current_stage =
    (job.summary.current_stage as string | undefined) ?? (status === 'COMPLETED' ? '优化完成' : '正在准备');
  summary.latest_update =
    (job.summary.latest_update as string | undefined) ??
    (status === 'COMPLETED' ? '优化任务已完成。' : '优化任务已创建，正在准备搜索队列。');
  if (typeof job.summary.latest_candidate_label === 'string') {
    summary.latest_candidate_label = job.summary.latest_candidate_label;
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
  };
  result.status = (job.result.status as string | undefined) ?? status;
  result.progress_pct = asNumber(job.result.progress_pct, asNumber(summary.progress_pct, status === 'COMPLETED' ? 100 : 0));
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
    updated_at: job.updated_at ?? job.completed_at ?? job.created_at ?? null ?? undefined,
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
  };
}

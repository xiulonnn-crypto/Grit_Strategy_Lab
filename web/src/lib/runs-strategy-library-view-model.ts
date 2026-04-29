import type {
  ApiBacktestRunListItem,
  ApiStrategyDetail,
  BacktestRunStatus,
} from "../types";

export type EvidencePeriod = "10Y" | "20Y" | "30Y" | "CUSTOM";

export type StrategyEvidenceStatus =
  | "MATURE"
  | "DRIFT"
  | "BROKEN"
  | "FAILED_REVIEW";

export type EvidenceMetrics = {
  totalReturn: number | null;
  annualizedReturn: number | null;
  sharpe: number | null;
  maxDrawdown: number | null;
};

export type RunEvidenceNode = {
  id: string;
  strategyId: string;
  strategyName: string;
  versionId: string;
  versionTag: string;
  period: EvidencePeriod;
  status: BacktestRunStatus | string;
  startDate: string | null;
  endDate: string | null;
  completedAt: string | null;
  metrics: EvidenceMetrics;
  warningCount: number;
  isTemporary: boolean;
  sourceRunId: string | null;
  raw: ApiBacktestRunListItem;
};

export type VersionEvidenceNode = {
  id: string;
  strategyId: string;
  strategyName: string;
  versionTag: string;
  versionNumber: number | null;
  summary: string;
  decisionNote: string | null;
  status: StrategyEvidenceStatus;
  statusLabel: string;
  periods: EvidencePeriod[];
  missingPeriods: EvidencePeriod[];
  runs: RunEvidenceNode[];
  persistentRuns: RunEvidenceNode[];
  periodRuns: Partial<Record<EvidencePeriod, RunEvidenceNode>>;
  hasTemporaryRuns: boolean;
  hasFailedRuns: boolean;
  hasWarnings: boolean;
  hasCustomEvidence: boolean;
  sourceRunId: string | null;
  latestCompletedAt: string | null;
  metrics: EvidenceMetrics;
  evidenceHeat: number;
  isLatest: boolean;
};

export type StrategyEvidenceGroup = {
  strategyId: string;
  strategyName: string;
  status: StrategyEvidenceStatus;
  statusLabel: string;
  versions: VersionEvidenceNode[];
  periods: EvidencePeriod[];
  missingPeriods: EvidencePeriod[];
  hasTemporaryRuns: boolean;
  hasFailedRuns: boolean;
  hasWarnings: boolean;
  latestCompletedAt: string | null;
  metrics: EvidenceMetrics;
  evidenceHeat: number;
};

export type SmartEvidenceTask = {
  id: string;
  title: string;
  description: string;
  strategyId: string;
  strategyName: string;
  versionId: string;
  versionTag: string;
  missingPeriods: EvidencePeriod[];
  sourceRunId: string | null;
  targetPeriod: EvidencePeriod;
  startDate: string;
  endDate: string;
  periodLabel: string;
  tone: "green" | "amber" | "red" | "blue";
};

type StrategyLookup = Map<string, ApiStrategyDetail>;

const REQUIRED_PERIODS: EvidencePeriod[] = ["10Y", "20Y", "30Y"];
const TARGET_TASK_PERIODS: EvidencePeriod[] = ["20Y", "30Y"];

export const STRATEGY_EVIDENCE_STATUS_LABELS: Record<StrategyEvidenceStatus, string> = {
  MATURE: "路径成熟",
  DRIFT: "存在漂移",
  BROKEN: "证据断裂",
  FAILED_REVIEW: "失败需复核",
};

function isPermanentRun(run: ApiBacktestRunListItem): boolean {
  return run.is_permanent !== false;
}

function isSuccessfulStatus(status: BacktestRunStatus | string): boolean {
  return status === "COMPLETED" || status === "COMPLETED_WITH_WARNINGS";
}

function readStartDate(run: ApiBacktestRunListItem): string | null {
  return run.start_date ?? run.preview?.effective_start_date ?? null;
}

function readEndDate(run: ApiBacktestRunListItem): string | null {
  return run.end_date ?? run.preview?.effective_end_date ?? null;
}

function readMetric(
  metrics: ApiBacktestRunListItem["metrics"],
  keys: string[],
): number | null {
  const values = metrics as Record<string, unknown> | undefined;
  if (!values) {
    return null;
  }
  for (const key of keys) {
    const value = values[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function readRunMetrics(run: ApiBacktestRunListItem): EvidenceMetrics {
  return {
    totalReturn: readMetric(run.metrics, ["total_return", "total_return_pct"]),
    annualizedReturn: readMetric(run.metrics, ["annualized_return", "annual_return", "cagr"]),
    sharpe: readMetric(run.metrics, ["sharpe", "return_sharpe", "oos_sharpe"]),
    maxDrawdown: readMetric(run.metrics, ["max_drawdown", "max_drawdown_pct"]),
  };
}

function emptyMetrics(): EvidenceMetrics {
  return {
    totalReturn: null,
    annualizedReturn: null,
    sharpe: null,
    maxDrawdown: null,
  };
}

function buildStrategyLookup(strategies?: ApiStrategyDetail[]): StrategyLookup {
  return new Map((strategies ?? []).map((strategy) => [strategy.id, strategy]));
}

function resolveStrategyName(
  run: ApiBacktestRunListItem,
  strategies: StrategyLookup,
): string {
  return (
    run.strategy_name ??
    strategies.get(run.strategy_id)?.name ??
    run.strategy_id
  );
}

function resolveVersionId(run: ApiBacktestRunListItem): string {
  return (
    run.parameter_version_id ??
    run.preview?.parameter_version_id ??
    "unversioned"
  );
}

function versionSortValue(versionId: string): number {
  const match = versionId.match(/(?:^|[-_])v?(\d+)$/i);
  return match ? Number(match[1]) : -1;
}

function resolveVersionMeta(strategy: ApiStrategyDetail | undefined, versionId: string) {
  const entry = strategy?.parameter_history?.find(
    (item) => item.parameter_version_id === versionId,
  );
  const versionNumber = entry?.version_number ?? null;
  const versionTag = versionNumber ? `v${versionNumber}` : versionSortValue(versionId) > 0 ? `v${versionSortValue(versionId)}` : versionId;
  return {
    versionNumber,
    versionTag,
    summary: entry?.change_summary?.trim() || entry?.comment?.trim() || "该版本暂无演进说明。",
    decisionNote: entry?.decision_note?.trim() || null,
  };
}

function compareNullableIsoDesc(left: string | null, right: string | null): number {
  if (left === right) {
    return 0;
  }
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }
  return right.localeCompare(left);
}

function compareRunEvidence(left: RunEvidenceNode, right: RunEvidenceNode): number {
  return (
    compareNullableIsoDesc(left.completedAt, right.completedAt) ||
    compareNullableIsoDesc(left.endDate, right.endDate) ||
    left.id.localeCompare(right.id)
  );
}

function uniquePeriods(runs: RunEvidenceNode[]): EvidencePeriod[] {
  const periods = new Set<EvidencePeriod>();
  for (const run of runs) {
    periods.add(run.period);
  }
  return REQUIRED_PERIODS.filter((period) => periods.has(period)).concat(
    periods.has("CUSTOM") ? ["CUSTOM"] : [],
  );
}

function statusRank(status: StrategyEvidenceStatus): number {
  return {
    FAILED_REVIEW: 0,
    BROKEN: 1,
    DRIFT: 2,
    MATURE: 3,
  }[status];
}

function worstStatus(
  statuses: StrategyEvidenceStatus[],
): StrategyEvidenceStatus {
  return statuses.reduce<StrategyEvidenceStatus>(
    (worst, status) => (statusRank(status) < statusRank(worst) ? status : worst),
    "MATURE",
  );
}

function chooseSourceRun(runs: RunEvidenceNode[]): string | null {
  const permanent = runs.find((run) => !run.isTemporary);
  const completed = runs.find((run) => isSuccessfulStatus(run.status));
  return permanent?.id ?? completed?.id ?? runs[0]?.id ?? null;
}

function choosePeriodRun(runs: RunEvidenceNode[]): RunEvidenceNode {
  return [...runs].sort((left, right) => {
    const leftCompleted = left.status === "COMPLETED" ? 0 : 1;
    const rightCompleted = right.status === "COMPLETED" ? 0 : 1;
    return leftCompleted - rightCompleted || compareRunEvidence(left, right);
  })[0];
}

function chooseRepresentativeRun(runs: RunEvidenceNode[]): RunEvidenceNode | null {
  const candidates = runs.filter((run) => isSuccessfulStatus(run.status));
  if (!candidates.length) {
    return runs[0] ?? null;
  }
  return [...candidates].sort((left, right) => {
    const leftSharpe = left.metrics.sharpe ?? Number.NEGATIVE_INFINITY;
    const rightSharpe = right.metrics.sharpe ?? Number.NEGATIVE_INFINITY;
    return rightSharpe - leftSharpe || compareRunEvidence(left, right);
  })[0];
}

function hasUncoveredFailedRun(runs: RunEvidenceNode[]): boolean {
  const successfulByPeriod = new Map<EvidencePeriod, RunEvidenceNode[]>();
  for (const run of runs) {
    if (isSuccessfulStatus(run.status)) {
      successfulByPeriod.set(run.period, [...(successfulByPeriod.get(run.period) ?? []), run]);
    }
  }
  return runs.some((run) => {
    if (run.status !== "FAILED") {
      return false;
    }
    const failedTime = run.completedAt ? Date.parse(run.completedAt) : 0;
    return !(successfulByPeriod.get(run.period) ?? []).some((success) => {
      const successTime = success.completedAt ? Date.parse(success.completedAt) : 0;
      return successTime >= failedTime;
    });
  });
}

function hasSharpeDrift(runs: RunEvidenceNode[]): boolean {
  const values = runs
    .filter((run) => REQUIRED_PERIODS.includes(run.period))
    .map((run) => run.metrics.sharpe)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length < 2) {
    return false;
  }
  return Math.max(...values) - Math.min(...values) > 0.35;
}

function inferVersionStatus(
  persistentRuns: RunEvidenceNode[],
  periods: EvidencePeriod[],
): StrategyEvidenceStatus {
  const evidenceRuns = persistentRuns.filter((run) => isSuccessfulStatus(run.status));
  const missingPeriods = REQUIRED_PERIODS.filter((period) => !periods.includes(period));
  if (hasUncoveredFailedRun(persistentRuns)) {
    return "FAILED_REVIEW";
  }
  if (evidenceRuns.length === 0) {
    return "BROKEN";
  }
  const hasReviewSignal = evidenceRuns.some(
    (run) => run.status === "COMPLETED_WITH_WARNINGS" || run.warningCount > 0,
  );
  if (hasReviewSignal || hasSharpeDrift(evidenceRuns)) {
    return "DRIFT";
  }
  if (missingPeriods.length > 0) {
    return "BROKEN";
  }
  return "MATURE";
}

function calculateEvidenceHeat(periods: EvidencePeriod[], status: StrategyEvidenceStatus): number {
  const base = REQUIRED_PERIODS.filter((period) => periods.includes(period)).length / REQUIRED_PERIODS.length;
  if (status === "FAILED_REVIEW") {
    return Math.max(0.18, base - 0.35);
  }
  if (status === "DRIFT") {
    return Math.max(0.34, base - 0.14);
  }
  return base;
}

function periodYears(period: EvidencePeriod): number {
  return period === "30Y" ? 30 : period === "20Y" ? 20 : 10;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildTargetRange(source: RunEvidenceNode | null, period: EvidencePeriod): { startDate: string; endDate: string } {
  const end = source?.endDate && !Number.isNaN(Date.parse(source.endDate))
    ? new Date(source.endDate)
    : new Date("2026-03-24");
  const start = new Date(end);
  start.setFullYear(end.getFullYear() - periodYears(period));
  return { startDate: formatDate(start), endDate: formatDate(end) };
}

export function inferEvidencePeriod(
  run: Pick<ApiBacktestRunListItem, "start_date" | "end_date" | "preview">,
): EvidencePeriod {
  const start = readStartDate(run as ApiBacktestRunListItem);
  const end = readEndDate(run as ApiBacktestRunListItem);
  if (!start || !end) {
    return "CUSTOM";
  }
  const startTime = Date.parse(start);
  const endTime = Date.parse(end);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    return "CUSTOM";
  }
  const years = (endTime - startTime) / (365.25 * 24 * 60 * 60 * 1000);
  if (years >= 9 && years <= 11) {
    return "10Y";
  }
  if (years >= 19 && years <= 21) {
    return "20Y";
  }
  if (years >= 29) {
    return "30Y";
  }
  return "CUSTOM";
}

export function buildStrategyEvidenceGroups(
  runs: ApiBacktestRunListItem[],
  strategies?: ApiStrategyDetail[],
): StrategyEvidenceGroup[] {
  const strategyLookup = buildStrategyLookup(strategies);
  const grouped = new Map<string, Map<string, RunEvidenceNode[]>>();

  for (const run of runs) {
    const strategyId = run.strategy_id;
    const strategy = strategyLookup.get(strategyId);
    const versionId = resolveVersionId(run);
    const meta = resolveVersionMeta(strategy, versionId);
    const strategyName = resolveStrategyName(run, strategyLookup);
    const node: RunEvidenceNode = {
      id: run.id,
      strategyId,
      strategyName,
      versionId,
      versionTag: meta.versionTag,
      period: inferEvidencePeriod(run),
      status: run.status,
      startDate: readStartDate(run),
      endDate: readEndDate(run),
      completedAt: run.completed_at ?? null,
      metrics: readRunMetrics(run),
      warningCount: run.warnings?.length ?? 0,
      isTemporary: !isPermanentRun(run),
      sourceRunId: run.source_run_id ?? null,
      raw: run,
    };
    if (!grouped.has(strategyId)) {
      grouped.set(strategyId, new Map());
    }
    const versions = grouped.get(strategyId);
    if (!versions?.has(versionId)) {
      versions?.set(versionId, []);
    }
    versions?.get(versionId)?.push(node);
  }

  return [...grouped.entries()]
    .map(([strategyId, versionMap]) => {
      const strategy = strategyLookup.get(strategyId);
      const versions = [...versionMap.entries()]
        .map(([versionId, versionRuns]) => {
          const sortedRuns = [...versionRuns].sort(compareRunEvidence);
          const meta = resolveVersionMeta(strategy, versionId);
          const persistentRuns = sortedRuns.filter((run) => !run.isTemporary);
          const completedPersistentRuns = persistentRuns.filter((run) => isSuccessfulStatus(run.status));
          const periods = uniquePeriods(completedPersistentRuns);
          const missingPeriods = REQUIRED_PERIODS.filter((period) => !periods.includes(period));
          const periodRuns = REQUIRED_PERIODS.reduce<
            Partial<Record<EvidencePeriod, RunEvidenceNode>>
          >((result, period) => {
            const candidates = completedPersistentRuns.filter(
              (run) => run.period === period,
            );
            if (candidates.length > 0) {
              result[period] = choosePeriodRun(candidates);
            }
            return result;
          }, {});
          const status = inferVersionStatus(persistentRuns, periods);
          const representative = chooseRepresentativeRun(completedPersistentRuns.length ? completedPersistentRuns : persistentRuns);
          const isLatest =
            strategy?.current_parameter_version_id === versionId ||
            meta.versionNumber === strategy?.current_parameter_version;
          return {
            id: versionId,
            strategyId,
            strategyName:
              sortedRuns[0]?.strategyName ??
              strategy?.name ??
              strategyId,
            versionTag: meta.versionTag,
            versionNumber: meta.versionNumber,
            summary: meta.summary,
            decisionNote: meta.decisionNote,
            status,
            statusLabel: STRATEGY_EVIDENCE_STATUS_LABELS[status],
            periods,
            missingPeriods,
            runs: sortedRuns,
            persistentRuns,
            periodRuns,
            hasTemporaryRuns: sortedRuns.some((run) => run.isTemporary),
            hasFailedRuns: persistentRuns.some((run) => run.status === "FAILED"),
            hasWarnings: persistentRuns.some((run) => run.warningCount > 0),
            hasCustomEvidence: periods.includes("CUSTOM"),
            sourceRunId: chooseSourceRun(persistentRuns.length ? persistentRuns : sortedRuns),
            latestCompletedAt: sortedRuns[0]?.completedAt ?? null,
            metrics: representative?.metrics ?? emptyMetrics(),
            evidenceHeat: calculateEvidenceHeat(periods, status),
            isLatest,
          } satisfies VersionEvidenceNode;
        })
        .sort((left, right) => {
          if (left.isLatest !== right.isLatest) {
            return left.isLatest ? -1 : 1;
          }
          return (
            compareNullableIsoDesc(left.latestCompletedAt, right.latestCompletedAt) ||
            versionSortValue(right.id) - versionSortValue(left.id) ||
            left.id.localeCompare(right.id)
          );
        });
      const allPersistentRuns = versions.flatMap((version) => version.persistentRuns);
      const completedPersistentRuns = allPersistentRuns.filter((run) => isSuccessfulStatus(run.status));
      const strategyPeriods = uniquePeriods(completedPersistentRuns);
      const status = worstStatus(versions.map((version) => version.status));
      const representative = chooseRepresentativeRun(completedPersistentRuns.length ? completedPersistentRuns : allPersistentRuns);
      const latestCompletedAt =
        versions
          .map((version) => version.latestCompletedAt)
          .sort(compareNullableIsoDesc)[0] ?? null;
      return {
        strategyId,
        strategyName:
          versions[0]?.strategyName ??
          strategy?.name ??
          strategyId,
        status,
        statusLabel: STRATEGY_EVIDENCE_STATUS_LABELS[status],
        versions,
        periods: strategyPeriods,
        missingPeriods: REQUIRED_PERIODS.filter(
          (period) => !strategyPeriods.includes(period),
        ),
        hasTemporaryRuns: versions.some((version) => version.hasTemporaryRuns),
        hasFailedRuns: versions.some((version) => version.hasFailedRuns),
        hasWarnings: versions.some((version) => version.hasWarnings),
        latestCompletedAt,
        metrics: representative?.metrics ?? emptyMetrics(),
        evidenceHeat: calculateEvidenceHeat(strategyPeriods, status),
      } satisfies StrategyEvidenceGroup;
    })
    .sort((left, right) => {
      return (
        compareNullableIsoDesc(left.latestCompletedAt, right.latestCompletedAt) ||
        left.strategyName.localeCompare(right.strategyName) ||
        left.strategyId.localeCompare(right.strategyId)
      );
    });
}

export function buildSmartEvidenceTasks(
  groups: StrategyEvidenceGroup[],
): SmartEvidenceTask[] {
  return groups.flatMap((group) =>
    group.versions.flatMap((version) =>
      TARGET_TASK_PERIODS
        .filter((period) => version.missingPeriods.includes(period))
        .map((targetPeriod) => {
          const sourceRun =
            (version.sourceRunId ? version.runs.find((run) => run.id === version.sourceRunId) : null) ??
            version.runs[0] ??
            null;
          const range = buildTargetRange(sourceRun, targetPeriod);
          return {
            id: `${group.strategyId}:${version.id}:${targetPeriod}`,
            title: `证据断裂 ${group.strategyName} ${version.versionTag}`,
            description: `缺失 ${targetPeriod} 长周期回测，需补齐永久证据。`,
            strategyId: group.strategyId,
            strategyName: group.strategyName,
            versionId: version.id,
            versionTag: version.versionTag,
            missingPeriods: version.missingPeriods.filter((period) =>
              TARGET_TASK_PERIODS.includes(period),
            ),
            sourceRunId: version.sourceRunId,
            targetPeriod,
            startDate: range.startDate,
            endDate: range.endDate,
            periodLabel: targetPeriod,
            tone: targetPeriod === "30Y" ? "amber" : "blue",
          } satisfies SmartEvidenceTask;
        }),
    ),
  );
}

export function formatMetricValue(
  value: number | null | undefined,
  options: { percent?: boolean; decimals?: number; signed?: boolean } = {},
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }
  const decimals = options.decimals ?? (options.percent ? 1 : 2);
  const normalized = options.percent && Math.abs(value) <= 1 ? value * 100 : value;
  const prefix = options.signed && normalized > 0 ? "+" : "";
  return `${prefix}${normalized.toFixed(decimals)}${options.percent ? "%" : ""}`;
}

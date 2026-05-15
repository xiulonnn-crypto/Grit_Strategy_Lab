import { useEffect, useMemo, useState } from 'react';
import {
  diagnosisNeedsAction,
  diagnosisTone,
  normalizedDiagnosisActions,
  primaryCompositionDiagnosis,
  statusFilterFromDiagnosis,
} from '../lib/composition-diagnostics';
import { useApiClient } from '../lib/demoStoreContext';
import type {
  ApiCompositionGlobalAllocationJobListItem,
  ApiCompositionGlobalBacktestRunListItem,
  ApiCompositionListItem,
  ApiCompositionProxyConfirmationPayload,
  ApiCompositionProxyContext,
  ApiCompositionSourceIntegrity,
  ApiCompositionStatusAction,
  ApiCompositionStatusDiagnosis,
} from '../types';
import './composition-global-index-page.css';

const FIRST_SCREEN_DEFER_MS = import.meta.env.MODE === 'test' ? 0 : 80;

type Tone = 'good' | 'info' | 'warning' | 'danger' | 'neutral';

type Metric = {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
  ariaLabel?: string;
  onSelect?: () => void;
};

type PageStatus = {
  loading: boolean;
  error: string | null;
};

type CompositionDiagnosisTarget = {
  id?: string | null;
  composition_id?: string | null;
  name?: string | null;
  composition_name?: string | null;
  primary_diagnosis?: ApiCompositionStatusDiagnosis | null;
  diagnoses?: ApiCompositionStatusDiagnosis[];
  evidence_grade?: string | null;
};

type CompositionListFilterState = {
  status: 'all' | 'ACTIVE' | 'DRAFT';
  evidenceGrade: 'all' | 'A' | 'B' | 'C';
  decision: 'all' | 'pending' | 'version_update';
};

type BacktestRunFilterState = {
  compositionId: string;
  status: string;
  scenario: string;
  evidenceGrade: 'all' | 'A' | 'B' | 'C';
};

type AllocationLabFilterState = {
  compositionId: string;
  method: string;
  status: 'all' | 'reference' | 'review' | 'blocked';
  gate: 'all' | 'reference' | 'review' | 'blocked';
};

type ToolbarFilter =
  | {
      key: string;
      label: string;
      value: string;
      options: Array<{ label: string; value: string }>;
    }
  | {
      label: string;
      value: string;
      key?: never;
      options?: never;
    };

const COMPOSITION_LIST_VIEW_STORAGE_KEY = 'grit.compositionList.savedView';
const COMPOSITION_LAB_VIEW_STORAGE_KEY = 'grit.compositionLab.savedView';

const DEFAULT_COMPOSITION_LIST_FILTERS: CompositionListFilterState = {
  status: 'all',
  evidenceGrade: 'all',
  decision: 'all',
};

const DEFAULT_BACKTEST_RUN_FILTERS: BacktestRunFilterState = {
  compositionId: 'all',
  status: 'all',
  scenario: 'all',
  evidenceGrade: 'all',
};

const DEFAULT_ALLOCATION_LAB_FILTERS: AllocationLabFilterState = {
  compositionId: 'all',
  method: 'all',
  status: 'all',
  gate: 'all',
};

const DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function goTo(path: string): void {
  window.location.hash = path;
}

function openActionRoute(route?: string | null): 'current_page' | 'new_tab' | 'none' {
  const normalized = String(route ?? '').trim();
  if (!normalized) {
    return 'none';
  }
  if (!/^https?:\/\//i.test(normalized)) {
    goTo(normalized.startsWith('/') ? normalized : `/${normalized}`);
    return 'current_page';
  }
  const url = normalized;
  window.open(url, '_blank', 'noopener,noreferrer');
  return 'new_tab';
}

function compositionIdFromDiagnosisTarget(item: CompositionDiagnosisTarget): string {
  return String(item.composition_id ?? item.id ?? '').trim();
}

function formatDate(value?: string | null): string {
  if (!value) {
    return '待记录';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '待记录';
  }
  return DATE_FORMATTER.format(date);
}

function formatRunTime(value?: string | null): string {
  if (!value) {
    return '时间待确认';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '时间待确认';
  }
  return DATE_TIME_FORMATTER.format(date);
}

function runTimeValue(row: Pick<ApiCompositionGlobalBacktestRunListItem, 'completed_at' | 'created_at'>): number {
  const value = row.completed_at ?? row.created_at;
  if (!value) {
    return 0;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function activityLabel(value?: string | null): string {
  const label = String(value ?? '').trim();
  if (!label) {
    return '最近更新';
  }
  if (label === 'Updated recently') {
    return '最近更新';
  }
  return label.replace(/^Updated\s+(\d{4}-\d{2}-\d{2})$/, '更新 $1');
}

function rebalanceFrequencyLabel(value?: string | null): string {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'monthly') {
    return '月度再平衡';
  }
  if (normalized === 'quarterly') {
    return '季度再平衡';
  }
  if (normalized === 'semiannual' || normalized === 'semi_annually') {
    return '半年再平衡';
  }
  if (normalized === 'annual' || normalized === 'yearly') {
    return '年度再平衡';
  }
  return value ? String(value) : '再平衡待设定';
}

function formatNumber(value?: number | null, fallback = '0'): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }
  return String(value);
}

function formatBps(value?: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '暂无';
  }
  return `${value.toFixed(0)} bps`;
}

function formatRatioAsPercent(value?: number | null, options: { forceNegative?: boolean; signed?: boolean } = {}): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '暂无';
  }
  const scaled = Math.abs(value) <= 1 ? value * 100 : value;
  const absolute = Math.abs(scaled);
  if (options.forceNegative) {
    return `-${absolute.toFixed(1)}%`;
  }
  const prefix = options.signed && scaled > 0 ? '+' : '';
  return `${prefix}${scaled.toFixed(1)}%`;
}

function formatSharpe(value?: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '暂无';
  }
  return value.toFixed(2);
}

function formatCompositionMetricWindow(item: ApiCompositionListItem): string | null {
  const quality = item.return_quality_summary;
  const start = quality?.alignment_window_start;
  const end = quality?.alignment_window_end;
  if (!start || !end) {
    return null;
  }
  return `组合指标窗口 ${start} - ${end}`;
}

function formatSignedDecimal(value?: number | null, digits = 2): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '暂无';
  }
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(digits)}`;
}

function formatStressPoints(value?: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '暂无';
  }
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(1)}pt`;
}

function formatRecoveryDays(value?: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '未修复';
  }
  return `${value}d`;
}

function formatScenarioRecovery(row: ApiCompositionGlobalBacktestRunListItem): string {
  if (typeof row.scenario_recovery_days !== 'number' && typeof row.scenario_benchmark_recovery_days !== 'number') {
    return '暂无';
  }
  return `组合 ${formatRecoveryDays(row.scenario_recovery_days)} / 基准 ${formatRecoveryDays(row.scenario_benchmark_recovery_days)}`;
}

function scenarioPeriodLabel(row: ApiCompositionGlobalBacktestRunListItem): string {
  const [period] = String(row.scenario_detail ?? '').split(' · ');
  return period?.trim() || backtestPeriodLabel(row);
}

function normalizeAllocationMethodKey(value?: string | null): string {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return 'unknown';
  }
  const normalized = raw.toLowerCase().replace(/[\s-]+/g, '_');
  if (['risk_parity', 'riskparity'].includes(normalized) || normalized.startsWith('risk_parity')) {
    return 'risk_parity';
  }
  if (['min_vol', 'minimum_volatility', 'min_volatility', 'minimum_variance'].includes(normalized) || normalized.startsWith('min_vol')) {
    return 'min_vol';
  }
  if (['max_sharpe', 'maximum_sharpe'].includes(normalized) || normalized.startsWith('max_sharpe')) {
    return 'max_sharpe';
  }
  if (['mvo', 'mean_variance', 'mean_variance_optimization'].includes(normalized)) {
    return 'mean_variance';
  }
  if (['black_litterman', 'black-litterman'].includes(normalized)) {
    return 'black_litterman';
  }
  return normalized;
}

function allocationMethodLabel(value?: string | null): string {
  const key = normalizeAllocationMethodKey(value);
  if (key === 'risk_parity') return '风险平价';
  if (key === 'min_vol') return '最小波动';
  if (key === 'max_sharpe') return '最大夏普';
  if (key === 'mean_variance') return '均值方差';
  if (key === 'black_litterman') return 'Black-Litterman';
  if (key === 'current') return '当前组合';
  if (key === 'benchmark') return '基准组合';
  return value ? String(value) : '方法待确认';
}

function allocationDetailLabel(value?: string | null): string {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return '运行记录待补齐';
  }
  const normalized = raw.toLowerCase();
  if (normalized === 'heuristic_from_composition_detail_preview') {
    return '来自组合详情预演';
  }
  if (normalized === 'allocation candidates were derived deterministically from the saved composition preview.') {
    return '确定性候选生成';
  }
  if (normalized === 'derived from full-window composition rebalance events and source return streams; these are model instructions, not broker fills.') {
    return '来自完整窗口组合再平衡事件和来源收益流；这是模型调仓指令，不是券商成交回报。';
  }
  if (normalized === 'current saved allocation.') {
    return '当前已保存配置。';
  }
  if (normalized === 'benchmark reference portfolio for comparison only.') {
    return '仅用于对比的基准组合。';
  }
  if (normalized.includes('inverse realized volatility')) {
    return '按实现波动率倒数分配风险预算';
  }
  if (normalized.includes('away from the highest risk contribution')) {
    return '从最高风险贡献腿移出少量权重。';
  }
  if (normalized.includes('toward the highest return contribution')) {
    return '向最高收益贡献腿增加少量权重。';
  }
  return raw;
}

function normalizeEvidenceGrade(value?: string | null): string | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized || null;
}

function evidenceLabel(value?: string | null, label?: string | null): string {
  const raw = String(label ?? value ?? '').trim();
  const normalized = raw.toLowerCase();
  if (normalized === 'heuristic_from_composition_detail_preview') {
    return '稳健：证据链完整';
  }
  if (normalized === 'proxy_from_composition_detail_preview') {
    return '待校准：代理覆盖待确认';
  }
  if (label) {
    return label;
  }
  const grade = normalizeEvidenceGrade(value);
  if (grade === 'A') {
    return '稳健：证据链完整';
  }
  if (grade === 'B') {
    return '待校准：需要确认或补充判断';
  }
  if (grade === 'C') {
    return '失效：当前不能作为正式决策依据';
  }
  return '待校准：审计元数据真空';
}

function statusTone(value?: string | null): Tone {
  const normalized = String(value ?? '').toLowerCase();
  if (['active', 'completed', 'succeeded', 'ready', 'pass'].includes(normalized)) {
    return 'good';
  }
  if (['running', 'queued', 'draft', 'review', 'watch', 'completed_with_warnings', 'reference'].includes(normalized)) {
    return 'warning';
  }
  if (['failed', 'blocked', 'rejected', 'policy_violation'].includes(normalized)) {
    return 'danger';
  }
  return 'info';
}

function scenarioStatusLabel(value?: string | null): string {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'pass') {
    return '通过';
  }
  if (normalized === 'review' || normalized === 'watch') {
    return '待校准';
  }
  if (normalized === 'risk' || normalized === 'failed') {
    return '需处理';
  }
  return value ? String(value) : '待定位';
}

function hasVersionDrift(integrity: ApiCompositionSourceIntegrity[] = []): boolean {
  return integrity.some((item) => {
    const drift = String(item.drift_status ?? '').toLowerCase();
    const signature = String(item.signature_status ?? '').toLowerCase();
    return ['drifted', 'version_drift', 'stale'].includes(drift) || signature === 'stale';
  });
}

function isStrategySourceRef(value?: string | null): boolean {
  return String(value ?? '').startsWith('strategy_leg::');
}

function hasStrategyVersionUpdate(integrity: ApiCompositionSourceIntegrity[] = []): boolean {
  return integrity.some((item) => {
    const sourceRefId = String(item.source_ref_id ?? '').trim();
    const currentRefId = String(item.current_ref_id ?? '').trim();
    const alerts = (item.alerts ?? []).map((alert) => String(alert).toLowerCase());
    return (
      isStrategySourceRef(sourceRefId) &&
      ((Boolean(currentRefId) && currentRefId !== sourceRefId) ||
        alerts.some((alert) => alert.includes('newer parameter version') || alert.includes('新版本')))
    );
  });
}

function hasVersionUpdate(item: ApiCompositionListItem): boolean {
  const integrity = item.source_integrity ?? [];
  return hasStrategyVersionUpdate(integrity) || (Boolean(item.has_new_version) && integrity.length === 0);
}

function needsSourceReview(item: ApiCompositionListItem): boolean {
  return hasVersionDrift(item.source_integrity) || diagnosisNeedsAction(primaryCompositionDiagnosis(item));
}

function compositionDecisionActionCount(item: ApiCompositionListItem): number {
  let total = 0;
  if (hasVersionUpdate(item)) {
    total += 1;
  }
  if (needsSourceReview(item)) {
    total += 1;
  }
  return total;
}

function compositionNeedsDecision(item: ApiCompositionListItem): boolean {
  return compositionDecisionActionCount(item) > 0;
}

function decisionLabel(item: ApiCompositionListItem): string {
  const diagnosis = primaryCompositionDiagnosis(item);
  if (diagnosisNeedsAction(diagnosis)) {
    return diagnosis.diagnosis_label;
  }
  if (hasVersionUpdate(item)) {
    return '版本更新';
  }
  if (hasVersionDrift(item.source_integrity)) {
    return '来源复核';
  }
  return '无';
}

function decisionTone(item: ApiCompositionListItem): Tone {
  const diagnosis = primaryCompositionDiagnosis(item);
  if (diagnosisNeedsAction(diagnosis)) {
    return diagnosisTone(diagnosis) as Tone;
  }
  if (hasVersionUpdate(item) || hasVersionDrift(item.source_integrity)) {
    return 'warning';
  }
  return 'neutral';
}

function decisionSummary(item: ApiCompositionListItem): string {
  const diagnosis = primaryCompositionDiagnosis(item);
  if (diagnosisNeedsAction(diagnosis)) {
    return diagnosis.action || diagnosis.frontend_explanation;
  }
  if (hasVersionUpdate(item)) {
    return '策略腿出现新版本，需要决定保留冻结来源还是吸收新版本。';
  }
  if (hasVersionDrift(item.source_integrity)) {
    return '来源冻结与当前来源出现差异，需要复核后再关闭提醒。';
  }
  return activityLabel(item.latest_activity_label);
}

function formatCompositionVersionTag(value?: string | null): string {
  const label = String(value ?? '').trim();
  if (!label) {
    return '版本待定';
  }
  return /^v\d+/i.test(label) ? `配置 ${label}` : label;
}

function normalizeCompositionListFilters(value: Partial<CompositionListFilterState>): CompositionListFilterState {
  return {
    status: value.status === 'ACTIVE' || value.status === 'DRAFT' ? value.status : 'all',
    evidenceGrade: value.evidenceGrade === 'A' || value.evidenceGrade === 'B' || value.evidenceGrade === 'C' ? value.evidenceGrade : 'all',
    decision:
      value.decision === 'pending' || value.decision === 'version_update'
        ? value.decision
        : 'all',
  };
}

function readCompositionListFiltersFromHash(): { filters: CompositionListFilterState; hasQuery: boolean } {
  const [, queryString = ''] = String(window.location.hash ?? '').split('?');
  const params = new URLSearchParams(queryString);
  return {
    filters: normalizeCompositionListFilters({
      status: params.get('status') as CompositionListFilterState['status'],
      evidenceGrade: (params.get('grade') ?? params.get('evidence_grade')) as CompositionListFilterState['evidenceGrade'],
      decision: params.get('decision') as CompositionListFilterState['decision'],
    }),
    hasQuery: params.has('status') || params.has('grade') || params.has('evidence_grade') || params.has('decision'),
  };
}

function readSavedCompositionListFilters(): CompositionListFilterState | null {
  try {
    const raw = window.localStorage?.getItem(COMPOSITION_LIST_VIEW_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return normalizeCompositionListFilters(JSON.parse(raw) as Partial<CompositionListFilterState>);
  } catch {
    return null;
  }
}

function writeCompositionListHash(filters: CompositionListFilterState): void {
  const params = new URLSearchParams();
  if (filters.status !== 'all') {
    params.set('status', filters.status);
  }
  if (filters.evidenceGrade !== 'all') {
    params.set('grade', filters.evidenceGrade);
  }
  if (filters.decision !== 'all') {
    params.set('decision', filters.decision);
  }
  const path = `/compositions/list${params.toString() ? `?${params.toString()}` : ''}`;
  if (window.location.hash !== `#${path}`) {
    goTo(path);
  }
}

function initialCompositionListFilters(): CompositionListFilterState {
  const parsed = readCompositionListFiltersFromHash();
  if (parsed.hasQuery) {
    return parsed.filters;
  }
  return readSavedCompositionListFilters() ?? DEFAULT_COMPOSITION_LIST_FILTERS;
}

function filterCompositions(
  rows: ApiCompositionListItem[],
  filters: CompositionListFilterState,
): ApiCompositionListItem[] {
  return rows.filter((item) => {
    if (filters.status !== 'all' && String(item.status ?? '').toUpperCase() !== filters.status) {
      return false;
    }
    if (filters.evidenceGrade !== 'all' && statusFilterFromDiagnosis(primaryCompositionDiagnosis(item)) !== filters.evidenceGrade) {
      return false;
    }
    if (filters.decision === 'pending' && !compositionNeedsDecision(item)) {
      return false;
    }
    if (filters.decision === 'version_update' && !hasVersionUpdate(item)) {
      return false;
    }
    return true;
  });
}

function periodCoverageItems(item: ApiCompositionListItem): Array<{ period: string; label: string; covered: boolean }> {
  const coverageByPeriod = new Map(
    (item.backtest_period_coverage ?? []).map((entry) => [String(entry.period ?? '').toUpperCase(), entry]),
  );
  return ['10Y', '20Y', '30Y'].map((period) => {
    const entry = coverageByPeriod.get(period);
    const covered = String(entry?.status ?? '').toLowerCase() === 'covered';
    return {
      period,
      covered,
      label: entry?.label ?? `${period} ${covered ? '已覆盖' : '待补齐'}`,
    };
  });
}

function PeriodCoverageCell({ item }: { item: ApiCompositionListItem }): JSX.Element {
  return (
    <span className="composition-global-index__periods">
      {periodCoverageItems(item).map((entry) => (
        <span
          className={
            entry.covered
              ? 'composition-global-index__period-pill composition-global-index__period-pill--ready'
              : 'composition-global-index__period-pill'
          }
          key={entry.period}
        >
          {entry.label}
        </span>
      ))}
    </span>
  );
}

function normalizeBacktestRunFilters(value: Partial<BacktestRunFilterState>): BacktestRunFilterState {
  return {
    compositionId: value.compositionId && value.compositionId !== 'all' ? String(value.compositionId) : 'all',
    status: value.status && value.status !== 'all' ? String(value.status).toUpperCase() : 'all',
    scenario: value.scenario && value.scenario !== 'all' ? String(value.scenario) : 'all',
    evidenceGrade: value.evidenceGrade === 'A' || value.evidenceGrade === 'B' || value.evidenceGrade === 'C' ? value.evidenceGrade : 'all',
  };
}

function readBacktestRunFiltersFromHash(): BacktestRunFilterState {
  const [, queryString = ''] = String(window.location.hash ?? '').split('?');
  const params = new URLSearchParams(queryString);
  return normalizeBacktestRunFilters({
    compositionId: params.get('composition_id') ?? undefined,
    status: params.get('status') ?? undefined,
    scenario: params.get('scenario') ?? undefined,
    evidenceGrade: (params.get('grade') ?? params.get('evidence_grade')) as BacktestRunFilterState['evidenceGrade'],
  });
}

function writeBacktestRunHash(filters: BacktestRunFilterState): void {
  const normalized = normalizeBacktestRunFilters(filters);
  const params = new URLSearchParams();
  if (normalized.compositionId !== 'all') {
    params.set('composition_id', normalized.compositionId);
  }
  if (normalized.status !== 'all') {
    params.set('status', normalized.status);
  }
  if (normalized.scenario !== 'all') {
    params.set('scenario', normalized.scenario);
  }
  if (normalized.evidenceGrade !== 'all') {
    params.set('grade', normalized.evidenceGrade);
  }
  const path = `/compositions/backtest-runs${params.toString() ? `?${params.toString()}` : ''}`;
  if (window.location.hash !== `#${path}`) {
    goTo(path);
  }
}

function backtestScenarioValue(row: ApiCompositionGlobalBacktestRunListItem): string {
  return String(row.scenario_label || row.scenario_id || '未定位压力窗口');
}

function backtestRunStableId(row: ApiCompositionGlobalBacktestRunListItem): string {
  return row.run_id ?? row.id;
}

function backtestPeriodLabel(row: ApiCompositionGlobalBacktestRunListItem): string {
  return row.time_period_label || '时间周期待确认';
}

function backtestRowMatchesScenario(row: ApiCompositionGlobalBacktestRunListItem, scenario: string): boolean {
  const wanted = String(scenario ?? '').trim().toLowerCase();
  if (!wanted || wanted === 'all') {
    return true;
  }
  const scenarioLabel = backtestScenarioValue(row).toLowerCase();
  const scenarioId = String(row.scenario_id ?? '').trim().toLowerCase();
  return scenarioLabel === wanted || scenarioId === wanted || scenarioLabel.includes(wanted);
}

function filterBacktestRuns(
  rows: ApiCompositionGlobalBacktestRunListItem[],
  filters: BacktestRunFilterState,
): ApiCompositionGlobalBacktestRunListItem[] {
  return rows.filter((row) => {
    if (filters.compositionId !== 'all' && row.composition_id !== filters.compositionId) {
      return false;
    }
    if (filters.status !== 'all' && String(row.status ?? '').toUpperCase() !== filters.status) {
      return false;
    }
    if (filters.evidenceGrade !== 'all' && statusFilterFromDiagnosis(primaryCompositionDiagnosis(row)) !== filters.evidenceGrade) {
      return false;
    }
    if (!backtestRowMatchesScenario(row, filters.scenario)) {
      return false;
    }
    return true;
  });
}

function sortBacktestRunsByRunTimeDesc(rows: ApiCompositionGlobalBacktestRunListItem[]): ApiCompositionGlobalBacktestRunListItem[] {
  return [...rows].sort((left, right) => runTimeValue(right) - runTimeValue(left));
}

function allocationJobGateStatus(row: ApiCompositionGlobalAllocationJobListItem): 'reference' | 'review' | 'blocked' {
  const explicit = String(row.gate_status ?? '').trim().toLowerCase();
  if (explicit === 'reference' || explicit === 'pass' || explicit === 'ready') {
    return 'reference';
  }
  if (explicit === 'blocked') {
    return 'blocked';
  }
  const gateLabel = String(row.promotion_gate_label ?? '').trim().toLowerCase();
  const blocked = (row.policy_violation_count ?? 0) > 0 || gateLabel.includes('阻断') || gateLabel.includes('blocked');
  if (blocked) {
    return 'blocked';
  }
  return 'reference';
}

function allocationJobStatus(row: ApiCompositionGlobalAllocationJobListItem): AllocationLabFilterState['status'] {
  const gateStatus = allocationJobGateStatus(row);
  if (gateStatus === 'blocked') {
    return 'blocked';
  }
  return gateStatus === 'reference' ? 'reference' : 'review';
}

function allocationJobMethodValue(row: ApiCompositionGlobalAllocationJobListItem): string {
  return normalizeAllocationMethodKey(row.method_key ?? row.method_label);
}

function normalizeAllocationLabFilters(value: Partial<AllocationLabFilterState>): AllocationLabFilterState {
  const status =
    value.status === 'reference' || value.status === 'review' || value.status === 'blocked' ? value.status : 'all';
  const gate = value.gate === 'reference' || value.gate === 'review' || value.gate === 'blocked' ? value.gate : 'all';
  return {
    compositionId: value.compositionId && value.compositionId !== 'all' ? String(value.compositionId) : 'all',
    method: value.method && value.method !== 'all' ? normalizeAllocationMethodKey(String(value.method)) : 'all',
    status,
    gate,
  };
}

function readAllocationLabFiltersFromHash(): { filters: AllocationLabFilterState; hasQuery: boolean } {
  const [, queryString = ''] = String(window.location.hash ?? '').split('?');
  const params = new URLSearchParams(queryString);
  return {
    filters: normalizeAllocationLabFilters({
      compositionId: params.get('composition_id') ?? undefined,
      method: params.get('method') ?? undefined,
      status: params.get('status') as AllocationLabFilterState['status'],
      gate: params.get('gate') as AllocationLabFilterState['gate'],
    }),
    hasQuery: params.has('composition_id') || params.has('method') || params.has('status') || params.has('gate'),
  };
}

function readSavedAllocationLabFilters(): AllocationLabFilterState | null {
  try {
    const raw = window.localStorage?.getItem(COMPOSITION_LAB_VIEW_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return normalizeAllocationLabFilters(JSON.parse(raw) as Partial<AllocationLabFilterState>);
  } catch {
    return null;
  }
}

function writeAllocationLabHash(filters: AllocationLabFilterState): void {
  const normalized = normalizeAllocationLabFilters(filters);
  const params = new URLSearchParams();
  if (normalized.status !== 'all') {
    params.set('status', normalized.status);
  }
  if (normalized.compositionId !== 'all') {
    params.set('composition_id', normalized.compositionId);
  }
  if (normalized.method !== 'all') {
    params.set('method', normalized.method);
  }
  if (normalized.gate !== 'all') {
    params.set('gate', normalized.gate);
  }
  const path = `/compositions/lab${params.toString() ? `?${params.toString()}` : ''}`;
  if (window.location.hash !== `#${path}`) {
    goTo(path);
  }
}

function filterAllocationJobs(
  rows: ApiCompositionGlobalAllocationJobListItem[],
  filters: AllocationLabFilterState,
): ApiCompositionGlobalAllocationJobListItem[] {
  return rows.filter((row) => {
    if (filters.compositionId !== 'all' && row.composition_id !== filters.compositionId) {
      return false;
    }
    if (filters.method !== 'all' && allocationJobMethodValue(row) !== filters.method) {
      return false;
    }
    if (filters.status !== 'all' && allocationJobStatus(row) !== filters.status) {
      return false;
    }
    if (filters.gate !== 'all' && allocationJobGateStatus(row) !== filters.gate) {
      return false;
    }
    return true;
  });
}

function uniqueOptions<T>(
  rows: T[],
  getValue: (row: T) => string | null | undefined,
  getLabel: (row: T) => string | null | undefined,
): Array<{ label: string; value: string }> {
  const seen = new Set<string>();
  const options: Array<{ label: string; value: string }> = [];
  rows.forEach((row) => {
    const value = String(getValue(row) ?? '').trim();
    if (!value || seen.has(value)) {
      return;
    }
    seen.add(value);
    options.push({ value, label: String(getLabel(row) ?? value) });
  });
  return options;
}

function LoadingRows({ colSpan }: { colSpan: number }): JSX.Element {
  return (
    <tr>
      <td colSpan={colSpan}>
        <div className="composition-global-index__empty">正在读取运行态记录...</div>
      </td>
    </tr>
  );
}

function EmptyRows({ colSpan, message }: { colSpan: number; message: string }): JSX.Element {
  return (
    <tr>
      <td colSpan={colSpan}>
        <div className="composition-global-index__empty">{message}</div>
      </td>
    </tr>
  );
}

function StatusPill({ children, tone = 'neutral' }: { children: string; tone?: Tone }): JSX.Element {
  return <span className={`composition-global-index__pill composition-global-index__pill--${tone}`}>{children}</span>;
}

function proxyContextLine(context: ApiCompositionProxyContext): string {
  const parts = [
    context.target_symbol ? `目标 ${context.target_symbol}` : null,
    context.proxy_symbol ? `代理 ${context.proxy_symbol}` : null,
    context.horizon_label ? `周期 ${context.horizon_label}` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.join(' · ') || '代理关系待确认';
}

function proxyContextPayload(context?: ApiCompositionProxyContext): ApiCompositionProxyConfirmationPayload | null {
  if (!context?.proxy_signature) {
    return null;
  }
  return {
    leg_id: context.leg_id ?? null,
    target_symbol: context.target_symbol ?? null,
    proxy_symbol: context.proxy_symbol ?? null,
    horizon_label: context.horizon_label ?? null,
    proxy_signature: context.proxy_signature,
    coverage_window: context.coverage_window ?? {},
    reason: '用户在状态标签弹层确认代理覆盖。',
    confirmed_by: 'local_operator',
  };
}

function debugFactsText(facts?: Record<string, unknown>): string {
  const entries = Object.entries(facts ?? {});
  if (entries.length === 0) {
    return '暂无额外审计事实。';
  }
  return entries
    .map(([key, value]) => {
      const readable = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
      return `${key}: ${readable}`;
    })
    .join('\n');
}

function CompositionDiagnosisDialog({
  item,
  onClose,
  onCompleted,
}: {
  item: CompositionDiagnosisTarget;
  onClose: () => void;
  onCompleted: () => void;
}): JSX.Element {
  const api = useApiClient();
  const [dialogItem, setDialogItem] = useState<CompositionDiagnosisTarget>(item);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const compositionId = compositionIdFromDiagnosisTarget(dialogItem);
  const diagnosis = primaryCompositionDiagnosis(dialogItem);
  const actions = normalizedDiagnosisActions(diagnosis);
  const proxyContexts = diagnosis.proxy_context ?? [];
  const primaryProxyContext = proxyContexts.find((context) => context.proxy_source === 'unconfirmed') ?? proxyContexts[0];

  useEffect(() => {
    setDialogItem(item);
    setActionStatus(null);
  }, [item]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function handleAction(action: ApiCompositionStatusAction): Promise<void> {
    if (action.enabled === false) {
      return;
    }
    if (action.action_kind === 'open_new_tab') {
      const openResult = openActionRoute(action.route ?? `/compositions/${encodeURIComponent(compositionId)}`);
      if (openResult === 'new_tab') {
        setActionStatus('已在新标签页打开处理入口。');
      }
      return;
    }
    if (action.action_kind === 'inspect') {
      if (action.route) {
        const openResult = openActionRoute(action.route);
        if (openResult === 'new_tab') {
          setActionStatus('已在新标签页打开处理入口。');
        }
      } else if (action.action_key === 'inspect_source_evidence') {
        openActionRoute(`/compositions/workbench?composition_id=${encodeURIComponent(compositionId)}`);
      } else {
        setActionStatus('代理来源、覆盖区间和审计事实已在当前弹层展示。');
      }
      return;
    }
    setBusyAction(action.action_key);
    setActionStatus(null);
    try {
      if (action.action_key === 'confirm_proxy_coverage') {
        const payload = proxyContextPayload(primaryProxyContext);
        if (!payload || !api.confirmCompositionProxy) {
          setActionStatus('当前没有可保存的代理确认记录。');
          return;
        }
        const updated = await api.confirmCompositionProxy(compositionId, payload);
        setDialogItem(updated);
        setActionStatus('代理覆盖已确认；同一代理方案不再提醒。');
        onCompleted();
        return;
      }
      if (action.action_key === 'refresh_return_quality' || action.action_key === 'refresh_diagnostics') {
        if (!api.refreshCompositionDiagnostics) {
          setActionStatus('当前运行环境不支持在线刷新诊断。');
          return;
        }
        const updated = await api.refreshCompositionDiagnostics(compositionId);
        setDialogItem(updated);
        setActionStatus('状态标签已重新计算。');
        onCompleted();
        return;
      }
      if (action.action_key === 'refresh_source_freezes') {
        if (!api.refreshCompositionSourceFreezes) {
          setActionStatus('当前运行环境不支持在线重新冻结来源指纹。');
          return;
        }
        const updated = await api.refreshCompositionSourceFreezes(compositionId, {
          reason: diagnosis.action,
          confirmed_by: 'operator',
        });
        setDialogItem(updated);
        setActionStatus('来源指纹已重新冻结；状态标签已重新计算。');
        onCompleted();
        return;
      }
      setActionStatus('该动作需要在对应页面完成，已保留为审计提示。');
    } catch (caught) {
      setActionStatus(`动作执行失败：${(caught as Error).message}`);
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="composition-global-index__dialog-backdrop" onClick={onClose} role="presentation">
      <section
        aria-label={`${diagnosis.issue_type}状态标签`}
        aria-modal="true"
        className="composition-global-index__dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="composition-global-index__dialog-header">
          <div>
            <span className="composition-global-index__eyebrow">状态标签</span>
            <h2>{diagnosis.issue_type}</h2>
          </div>
          <StatusPill tone={diagnosisTone(diagnosis) as Tone}>{diagnosis.diagnosis_label}</StatusPill>
        </header>

        <div className="composition-global-index__diagnosis-sections">
          <section>
            <h3>前台判定说明</h3>
            <p>{diagnosis.frontend_explanation}</p>
            {diagnosis.system_disposition ? (
              <p className="composition-global-index__system-disposition">{diagnosis.system_disposition}</p>
            ) : null}
          </section>
          <section>
            <h3>动作</h3>
            <p>{diagnosis.action}</p>
            {proxyContexts.length > 0 ? (
              <div className="composition-global-index__proxy-list">
                {proxyContexts.map((context) => (
                  <article key={context.proxy_signature}>
                    <strong>{proxyContextLine(context)}</strong>
                    {context.explanation ? <span>{context.explanation}</span> : null}
                  </article>
                ))}
              </div>
            ) : null}
            <div className="composition-global-index__dialog-actions">
              {actions.length === 0 ? <span>当前无需处理。</span> : null}
              {actions.map((action) => (
                <button
                  className={
                    action.action_kind === 'execute'
                      ? 'composition-global-index__primary-button'
                      : 'composition-global-index__ghost-button'
                  }
                  disabled={busyAction !== null || action.enabled === false}
                  key={action.action_key}
                  onClick={() => void handleAction(action)}
                  type="button"
                >
                  {busyAction === action.action_key ? '处理中...' : action.label}
                </button>
              ))}
            </div>
            {actionStatus ? <p className="composition-global-index__action-status">{actionStatus}</p> : null}
          </section>
          <section>
            <h3>解决判定</h3>
            <p>{diagnosis.resolution_criteria}</p>
          </section>
        </div>

        <details className="composition-global-index__debug-facts">
          <summary>审计事实</summary>
          <pre>{debugFactsText(diagnosis.debug_facts)}</pre>
        </details>

        <footer className="composition-global-index__dialog-footer">
          <button className="composition-global-index__ghost-button" onClick={onClose} type="button">
            关闭
          </button>
        </footer>
      </section>
    </div>
  );
}

function Hero({
  actions,
  chips,
  eyebrow,
  summary,
  title,
}: {
  actions?: JSX.Element;
  chips: string[];
  eyebrow: string;
  summary: string;
  title: string;
}): JSX.Element {
  return (
    <section className="composition-global-index__hero">
      <div className="composition-global-index__hero-copy">
        <span className="composition-global-index__eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{summary}</p>
        <div className="composition-global-index__chip-row">
          {chips.map((chip, index) => (
            <StatusPill key={chip} tone={index === 0 ? 'good' : index === 1 ? 'warning' : index === 2 ? 'info' : 'neutral'}>
              {chip}
            </StatusPill>
          ))}
        </div>
      </div>
      {actions ? (
        <div className="composition-global-index__hero-actions" aria-label={`${title}操作区`}>
          {actions}
        </div>
      ) : null}
    </section>
  );
}

function MetricGrid({ metrics }: { metrics: Metric[] }): JSX.Element {
  return (
    <section className="composition-global-index__metrics" aria-label="页面概览">
      {metrics.map((metric) => {
        const className = `composition-global-index__metric ${metric.accent ? 'composition-global-index__metric--accent' : ''}`;
        const content = (
          <>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.detail}</small>
          </>
        );
        return metric.onSelect ? (
          <button
            aria-label={metric.ariaLabel ?? metric.label}
            className={className}
            data-ui="composition-global-index-metric-decision"
            key={metric.label}
            onClick={metric.onSelect}
            type="button"
          >
            {content}
          </button>
        ) : (
          <article className={className} key={metric.label}>
            {content}
          </article>
        );
      })}
    </section>
  );
}

function PanelShell({
  children,
  countLabel,
  description,
  title,
}: {
  children: JSX.Element | JSX.Element[];
  countLabel: string;
  description: string;
  title: string;
}): JSX.Element {
  return (
    <section className="composition-global-index__panel">
      <div className="composition-global-index__panel-header">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <StatusPill tone="good">{countLabel}</StatusPill>
      </div>
      {children}
    </section>
  );
}

function Toolbar({
  filters,
  actionLabel,
  actionStatus,
  onAction,
  onFilterChange,
  onSecondaryAction,
  secondaryActionLabel,
}: {
  filters: ToolbarFilter[];
  actionLabel: string;
  actionStatus?: string | null;
  onAction?: () => void;
  onFilterChange?: (key: string, value: string) => void;
  onSecondaryAction?: () => void;
  secondaryActionLabel?: string;
}): JSX.Element {
  return (
    <div className="composition-global-index__toolbar">
      <div className="composition-global-index__filters" aria-label="筛选条件">
        {filters.map((filter) => (
          filter.options ? (
            <label className="composition-global-index__filter" key={filter.label}>
              <span>{filter.label}</span>
              <select
                aria-label={`${filter.label}筛选`}
                onChange={(event) => onFilterChange?.(filter.key, event.target.value)}
                value={filter.value}
              >
                {filter.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="composition-global-index__filter" key={filter.label}>
              <span>{filter.label}</span>
              {filter.value}
            </span>
          )
        ))}
      </div>
      <div className="composition-global-index__toolbar-actions">
        {secondaryActionLabel ? (
          <button className="composition-global-index__ghost-button" onClick={onSecondaryAction} type="button">
            {secondaryActionLabel}
          </button>
        ) : null}
        <button className="composition-global-index__ghost-button" onClick={onAction} type="button">
          {actionLabel}
        </button>
        {actionStatus ? <span className="composition-global-index__save-status">{actionStatus}</span> : null}
      </div>
    </div>
  );
}

function CompositionListTable({
  archivingCompositionId,
  compositions,
  loading,
  onArchiveRequest,
  onDiagnosisOpen,
}: {
  archivingCompositionId?: string | null;
  compositions: ApiCompositionListItem[];
  loading: boolean;
  onArchiveRequest: (item: ApiCompositionListItem) => void;
  onDiagnosisOpen: (item: ApiCompositionListItem) => void;
}): JSX.Element {
  return (
    <table className="composition-global-index__table" aria-label="组合列表">
      <thead>
        <tr>
          <th>组合</th>
          <th>状态标签</th>
          <th>10Y年化/夏普/回撤</th>
          <th>周期完整度</th>
          <th>状态待办</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {loading ? <LoadingRows colSpan={6} /> : null}
        {!loading && compositions.length === 0 ? <EmptyRows colSpan={6} message="暂无符合当前筛选的组合记录。" /> : null}
        {!loading
          ? compositions.map((item) => {
              const pendingDecisionCount = compositionDecisionActionCount(item);
              const diagnosis = primaryCompositionDiagnosis(item);
              const metricWindow = formatCompositionMetricWindow(item);
              return (
                <tr key={item.id}>
                  <td>
                    <div className="composition-global-index__name-cell">
                      <div className="composition-global-index__name-line">
                        <strong>{item.name}</strong>
                        <StatusPill tone={String(item.status ?? '').toUpperCase() === 'ACTIVE' ? 'good' : 'warning'}>
                          {formatCompositionVersionTag(item.version_label)}
                        </StatusPill>
                      </div>
                      <span>
                        {item.id} · {item.leg_count} 条腿 · {rebalanceFrequencyLabel(item.rebalance_frequency)}
                      </span>
                    </div>
                  </td>
                  <td>
                    <button
                      className="composition-global-index__status-button"
                      onClick={() => onDiagnosisOpen(item)}
                      type="button"
                    >
                      <StatusPill tone={diagnosisTone(diagnosis) as Tone}>{diagnosis.diagnosis_label}</StatusPill>
                    </button>
                  </td>
                  <td>
                    <div className="composition-global-index__value-stack">
                      <strong>{formatRatioAsPercent(item.annualized_return, { signed: true })}</strong>
                      <span>夏普 {formatSharpe(item.sharpe)} · 回撤 {formatRatioAsPercent(item.max_drawdown, { forceNegative: true })}</span>
                      {metricWindow ? <span>{metricWindow}</span> : null}
                    </div>
                  </td>
                  <td>
                    <PeriodCoverageCell item={item} />
                  </td>
                  <td>
                    <div className="composition-global-index__value-stack">
                      <StatusPill tone={pendingDecisionCount > 0 ? decisionTone(item) : 'neutral'}>
                        {pendingDecisionCount > 0 ? `${pendingDecisionCount} 项` : '无'}
                      </StatusPill>
                      {pendingDecisionCount > 0 ? <span>{decisionLabel(item)}</span> : null}
                    </div>
                  </td>
                  <td>
                    <div className="composition-global-index__row-actions">
                      <button
                        className="composition-global-index__text-button"
                        onClick={() => goTo(`/compositions/${encodeURIComponent(item.id)}`)}
                        type="button"
                      >
                        查看详情
                      </button>
                      <button
                        className="composition-global-index__text-button composition-global-index__text-button--danger"
                        disabled={archivingCompositionId === item.id}
                        onClick={() => onArchiveRequest(item)}
                        type="button"
                      >
                        {archivingCompositionId === item.id ? '归档中...' : '归档'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })
          : null}
      </tbody>
    </table>
  );
}

function CompositionArchiveDialog({
  error,
  item,
  onCancel,
  onConfirm,
  saving,
}: {
  error: string | null;
  item: ApiCompositionListItem;
  onCancel: () => void;
  onConfirm: () => void;
  saving: boolean;
}): JSX.Element {
  return (
    <div className="composition-global-index__dialog-backdrop" role="presentation">
      <div
        aria-label="确认归档组合"
        aria-modal="true"
        className="composition-global-index__dialog composition-global-index__archive-dialog"
        role="dialog"
      >
        <div className="composition-global-index__dialog-header">
          <div>
            <p className="composition-global-index__dialog-eyebrow">归档确认</p>
            <h2>确认归档组合</h2>
          </div>
          <button
            aria-label="关闭归档确认"
            className="composition-global-index__text-button"
            disabled={saving}
            onClick={onCancel}
            type="button"
          >
            关闭
          </button>
        </div>
        <div className="composition-global-index__archive-copy">
          <p>
            归档后该组合会从组合列表和默认运营视图隐藏，历史回测、冻结来源与审计证据不会被物理清除。
          </p>
          <p>
            资产库引用计数会在下一次读取时按非归档组合重新计算；该组合的 {item.leg_count} 条腿将不再计入当前引用数。
          </p>
        </div>
        <dl className="composition-global-index__archive-summary">
          <div>
            <dt>组合名称</dt>
            <dd>{item.name}</dd>
          </div>
          <div>
            <dt>稳定 ID</dt>
            <dd>{item.id}</dd>
          </div>
        </dl>
        {error ? (
          <div className="composition-global-index__error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="composition-global-index__dialog-footer">
          <button
            className="composition-global-index__ghost-button"
            disabled={saving}
            onClick={onCancel}
            type="button"
          >
            取消
          </button>
          <button
            className="composition-global-index__danger-button"
            disabled={saving}
            onClick={onConfirm}
            type="button"
          >
            {saving ? '归档中...' : '确认归档'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CompositionBacktestRunDeleteDialog({
  error,
  item,
  onCancel,
  onConfirm,
  saving,
}: {
  error: string | null;
  item: ApiCompositionGlobalBacktestRunListItem;
  onCancel: () => void;
  onConfirm: () => void;
  saving: boolean;
}): JSX.Element {
  const runId = item.run_id ?? item.id;
  return (
    <div className="composition-global-index__dialog-backdrop" role="presentation">
      <div
        aria-label="删除组合回测"
        aria-modal="true"
        className="composition-global-index__dialog composition-global-index__archive-dialog"
        role="dialog"
      >
        <div className="composition-global-index__dialog-header">
          <div>
            <p className="composition-global-index__dialog-eyebrow">删除确认</p>
            <h2>删除组合回测</h2>
          </div>
          <button
            aria-label="关闭删除确认"
            className="composition-global-index__text-button"
            disabled={saving}
            onClick={onCancel}
            type="button"
          >
            关闭
          </button>
        </div>
        <div className="composition-global-index__archive-copy">
          <p>
            确认后这条组合回测会被逻辑删除，并从全局回测列表、组合详情历史和订单入口隐藏。
          </p>
          <p>
            后端仍保留审计字段与原始记录标记，不会物理清除已生成的证据。
          </p>
        </div>
        <dl className="composition-global-index__archive-summary">
          <div>
            <dt>组合名称</dt>
            <dd>{item.composition_name ?? item.composition_id}</dd>
          </div>
          <div>
            <dt>稳定 ID</dt>
            <dd>{runId}</dd>
          </div>
        </dl>
        {error ? (
          <div className="composition-global-index__error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="composition-global-index__dialog-footer">
          <button
            className="composition-global-index__ghost-button"
            disabled={saving}
            onClick={onCancel}
            type="button"
          >
            取消
          </button>
          <button
            className="composition-global-index__danger-button"
            disabled={saving}
            onClick={onConfirm}
            type="button"
          >
            {saving ? '删除中...' : '确认删除'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BacktestRunTable({
  deletingRunId,
  loading,
  onDeleteRequest,
  onPressureWindowSelect,
  rows,
  selectedPressureRunId,
}: {
  deletingRunId?: string | null;
  loading: boolean;
  onDeleteRequest: (item: ApiCompositionGlobalBacktestRunListItem) => void;
  onPressureWindowSelect: (item: ApiCompositionGlobalBacktestRunListItem) => void;
  rows: ApiCompositionGlobalBacktestRunListItem[];
  selectedPressureRunId: string | null;
}): JSX.Element {
  return (
    <table className="composition-global-index__table composition-global-index__table--compact composition-global-index__table--backtests" aria-label="组合回测列表">
      <thead>
        <tr>
          <th>回测id</th>
          <th>组合名</th>
          <th>时间周期</th>
          <th>压力窗口</th>
          <th>年化收益</th>
          <th>夏普</th>
          <th>回撤</th>
          <th>运行时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {loading ? <LoadingRows colSpan={9} /> : null}
        {!loading && rows.length === 0 ? <EmptyRows colSpan={9} message="暂无可重载的组合回测记录。" /> : null}
        {!loading
          ? rows.map((row) => {
              const runId = backtestRunStableId(row);
              const scenario = backtestScenarioValue(row);
              const runTime = row.completed_at ?? row.created_at;
              const isSelectedPressureRun = selectedPressureRunId === runId;
              return (
                <tr key={row.id}>
                  <td>
                    <span className="composition-global-index__run-id">{runId}</span>
                  </td>
                  <td>
                    <div className="composition-global-index__name-cell">
                      <strong>{row.composition_name ?? row.composition_id}</strong>
                      <span className="composition-global-index__version-label">{formatCompositionVersionTag(row.composition_version_label)}</span>
                    </div>
                  </td>
                  <td>
                    <span className="composition-global-index__plain-cell">{backtestPeriodLabel(row)}</span>
                  </td>
                  <td>
                    <button
                      aria-label={`查看 ${scenario}压力窗口详情`}
                      aria-pressed={isSelectedPressureRun}
                      className="composition-global-index__plain-cell composition-global-index__pressure-window"
                      onClick={() => onPressureWindowSelect(row)}
                      type="button"
                    >
                      {scenario}
                    </button>
                  </td>
                  <td>
                    <strong className="composition-global-index__metric-cell">{formatRatioAsPercent(row.annualized_return, { signed: true })}</strong>
                  </td>
                  <td>
                    <strong className="composition-global-index__metric-cell">{formatSharpe(row.sharpe)}</strong>
                  </td>
                  <td>
                    <strong className="composition-global-index__metric-cell">
                      {formatRatioAsPercent(row.max_drawdown, { forceNegative: true })}
                    </strong>
                  </td>
                  <td>
                    <span className="composition-global-index__run-time">{formatRunTime(runTime)}</span>
                  </td>
                  <td>
                    <div className="composition-global-index__row-actions">
                      <button
                        className="composition-global-index__text-button"
                        onClick={() =>
                          goTo(`/compositions/${encodeURIComponent(row.composition_id)}/backtest-runs/${encodeURIComponent(runId)}`)
                        }
                        type="button"
                      >
                        查看
                      </button>
                      <button
                        className="composition-global-index__text-button composition-global-index__text-button--danger"
                        disabled={deletingRunId === runId}
                        onClick={() => onDeleteRequest(row)}
                        type="button"
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })
          : null}
      </tbody>
    </table>
  );
}

function AllocationJobTable({
  loading,
  onDiagnosisOpen,
  rows,
}: {
  loading: boolean;
  onDiagnosisOpen: (item: ApiCompositionGlobalAllocationJobListItem) => void;
  rows: ApiCompositionGlobalAllocationJobListItem[];
}): JSX.Element {
  return (
    <table className="composition-global-index__table composition-global-index__table--lab" aria-label="组合实验室作业列表">
      <colgroup>
        <col className="composition-global-index__lab-col-task" />
        <col className="composition-global-index__lab-col-method" />
        <col className="composition-global-index__lab-col-performance" />
        <col className="composition-global-index__lab-col-gate" />
        <col className="composition-global-index__lab-col-cost" />
        <col className="composition-global-index__lab-col-action" />
      </colgroup>
      <thead>
        <tr>
          <th>任务</th>
          <th>优化方法</th>
          <th>预期绩效</th>
          <th>状态标签门禁</th>
          <th>迁移成本</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {loading ? <LoadingRows colSpan={6} /> : null}
        {!loading && rows.length === 0 ? <EmptyRows colSpan={6} message="暂无可查看的配置实验作业。" /> : null}
        {!loading
          ? rows.map((row) => {
              const jobId = row.job_id ?? row.id;
              const gateStatus = allocationJobGateStatus(row);
              const blocked = gateStatus === 'blocked';
              const diagnosis = primaryCompositionDiagnosis(row);
              return (
                <tr key={row.id}>
                  <td>
                    <div className="composition-global-index__name-cell">
                      <div className="composition-global-index__name-line">
                        <strong>{row.composition_name ?? row.composition_id}</strong>
                        <StatusPill tone={statusTone(row.status)}>
                          {formatCompositionVersionTag(row.composition_version_label)}
                        </StatusPill>
                      </div>
                      <span>{jobId} · {formatDate(row.completed_at ?? row.created_at)}</span>
                    </div>
                  </td>
                  <td>
                    <div className="composition-global-index__value-stack">
                      <strong>{allocationMethodLabel(row.method_key ?? row.method_label)}</strong>
                      <span>{allocationDetailLabel(row.method_detail ?? row.evidence_label)}</span>
                    </div>
                  </td>
                  <td>
                    <div className="composition-global-index__value-stack composition-global-index__performance-stack">
                      <strong>Δ年化 {formatRatioAsPercent(row.annualized_return_delta, { signed: true })}</strong>
                      <span>
                        Δ夏普 {formatSignedDecimal(row.sharpe_delta)} · Δ回撤{' '}
                        {formatRatioAsPercent(row.max_drawdown_delta, { signed: true })}
                      </span>
                      <span>
                        参考 {allocationMethodLabel(row.best_candidate_label ?? row.method_key ?? row.method_label)} · 候选{' '}
                        {formatNumber(row.candidate_count, '0')} 个
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="composition-global-index__value-stack">
                      <button
                        className="composition-global-index__status-button"
                        onClick={() => onDiagnosisOpen(row)}
                        type="button"
                      >
                        <StatusPill tone={blocked ? 'danger' : diagnosisTone(diagnosis) as Tone}>
                          {diagnosis.diagnosis_label}
                        </StatusPill>
                      </button>
                      <span>{row.promotion_gate_label ?? (gateStatus === 'blocked' ? '状态需复核' : '测试参考')}</span>
                    </div>
                  </td>
                  <td>
                    <div className="composition-global-index__value-stack">
                      <strong>{formatBps(row.migration_cost_bps)}</strong>
                      <span>迁移后夏普改善 {formatSignedDecimal(row.sharpe_delta)}</span>
                    </div>
                  </td>
                  <td>
                    <button
                      className="composition-global-index__text-button"
                      onClick={() =>
                        goTo(`/compositions/${encodeURIComponent(row.composition_id)}/allocation-jobs/${encodeURIComponent(jobId)}`)
                      }
                      type="button"
                    >
                      查看结果
                    </button>
                  </td>
                </tr>
              );
            })
          : null}
      </tbody>
    </table>
  );
}

function CompositionDecisionDialog({
  compositions,
  onClose,
  onDiagnosisOpen,
}: {
  compositions: ApiCompositionListItem[];
  onClose: () => void;
  onDiagnosisOpen: (item: ApiCompositionListItem) => void;
}): JSX.Element {
  const decisions = compositions.filter(compositionNeedsDecision);
  const decisionCount = decisions.reduce((total, item) => total + compositionDecisionActionCount(item), 0);
  return (
    <div className="composition-global-index__dialog-backdrop" onClick={onClose} role="presentation">
      <section
        aria-label="状态待处理"
        aria-modal="true"
        className="composition-global-index__dialog composition-global-index__decision-dialog"
        data-ui="composition-decision-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="composition-global-index__dialog-header">
          <div>
            <span className="composition-global-index__eyebrow">组合队列</span>
            <h2>状态待处理</h2>
          </div>
          <StatusPill tone={decisionCount > 0 ? 'warning' : 'neutral'}>{`${formatNumber(decisionCount)} 项`}</StatusPill>
        </header>
        <div className="composition-global-index__rail-list">
          {decisions.length === 0 ? (
            <article className="composition-global-index__queue-item">
              <header>
                <strong>暂无状态待处理事项</strong>
                <StatusPill>已清空</StatusPill>
              </header>
              <p>当前筛选范围内没有版本更新或来源复核提醒。</p>
            </article>
          ) : null}
          {decisions.map((item) => {
            const diagnosis = primaryCompositionDiagnosis(item);
            const canOpenDiagnosis = diagnosisNeedsAction(diagnosis);
            return (
              <article className="composition-global-index__queue-item" key={item.id}>
                <header>
                  <strong>{item.name}</strong>
                  <StatusPill tone={decisionTone(item)}>{decisionLabel(item)}</StatusPill>
                </header>
                <p>{decisionSummary(item)}</p>
                <div className="composition-global-index__dialog-actions">
                  {canOpenDiagnosis ? (
                    <button
                      className="composition-global-index__text-button"
                      onClick={() => {
                        onClose();
                        onDiagnosisOpen(item);
                      }}
                      type="button"
                    >
                      查看状态标签
                    </button>
                  ) : null}
                  <button
                    className="composition-global-index__text-button"
                    onClick={() => goTo(`/compositions/${encodeURIComponent(item.id)}`)}
                    type="button"
                  >
                    查看组合
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        <footer className="composition-global-index__dialog-footer">
          <button className="composition-global-index__ghost-button" onClick={onClose} type="button">
            关闭
          </button>
        </footer>
      </section>
    </div>
  );
}

function ScenarioRail({
  rows,
  selectedRun,
}: {
  rows: ApiCompositionGlobalBacktestRunListItem[];
  selectedRun: ApiCompositionGlobalBacktestRunListItem | null;
}): JSX.Element {
  const scenarioRows = uniqueOptions(rows, backtestScenarioValue, backtestScenarioValue)
    .map((option) => rows.find((row) => backtestScenarioValue(row) === option.value))
    .filter((row): row is ApiCompositionGlobalBacktestRunListItem => Boolean(row))
    .slice(0, 4);
  return (
    <aside className="composition-global-index__rail-card">
      <header>
        <h2>压力窗口</h2>
        <p>展示回撤与修复表现。</p>
      </header>
      {selectedRun ? (
        <section className="composition-global-index__scenario-summary" aria-label="当前压力窗口">
          <header>
            <strong>{backtestScenarioValue(selectedRun)}</strong>
            <StatusPill tone={statusTone(selectedRun.scenario_status_label)}>
              {scenarioStatusLabel(selectedRun.scenario_status_label)}
            </StatusPill>
          </header>
          <p>
            {backtestRunStableId(selectedRun)} · {selectedRun.composition_name ?? selectedRun.composition_id} · {scenarioPeriodLabel(selectedRun)}
          </p>
          <div className="composition-global-index__mini-grid">
            <div>
              <span>窗口回撤</span>
              <strong>{formatRatioAsPercent(selectedRun.scenario_drawdown ?? selectedRun.max_drawdown, { forceNegative: true })}</strong>
            </div>
            <div>
              <span>基准回撤</span>
              <strong>{formatRatioAsPercent(selectedRun.scenario_benchmark_drawdown, { forceNegative: true })}</strong>
            </div>
            <div>
              <span>修复周期</span>
              <strong>{formatScenarioRecovery(selectedRun)}</strong>
            </div>
            <div>
              <span>相对抗跌</span>
              <strong>{formatStressPoints(selectedRun.scenario_defensive_delta)}</strong>
            </div>
          </div>
          {selectedRun.scenario_source ? <p className="composition-global-index__scenario-source">{selectedRun.scenario_source}</p> : null}
        </section>
      ) : (
        <p className="composition-global-index__scenario-hint">点击左侧列表中的压力窗口查看对应回测的极端行情表现。</p>
      )}
      <div className="composition-global-index__rail-list">
        {scenarioRows.length === 0 ? (
          <article className="composition-global-index__queue-item">
            <header>
              <strong>暂无压力场景记录</strong>
              <StatusPill>待定位</StatusPill>
            </header>
            <p>等待持久化回测返回可定位的压力窗口。</p>
          </article>
        ) : null}
        {scenarioRows.map((row) => (
          <article
            className={[
              'composition-global-index__queue-item',
              'composition-global-index__scenario-item',
            ].filter(Boolean).join(' ')}
            key={row.id}
          >
            <header>
              <strong>{backtestScenarioValue(row)}</strong>
              <StatusPill tone={statusTone(row.scenario_status_label)}>
                {scenarioStatusLabel(row.scenario_status_label)}
              </StatusPill>
            </header>
            <p>
              {row.composition_name ?? row.composition_id} · {scenarioPeriodLabel(row)}
            </p>
            <div className="composition-global-index__scenario-item-metrics">
              <span>回撤 {formatRatioAsPercent(row.scenario_drawdown ?? row.max_drawdown, { forceNegative: true })}</span>
              <span>相对 {formatStressPoints(row.scenario_defensive_delta)}</span>
            </div>
          </article>
        ))}
      </div>
    </aside>
  );
}

function useCompositions(): PageStatus & { reload: () => void; rows: ApiCompositionListItem[] } {
  const api = useApiClient();
  const [rows, setRows] = useState<ApiCompositionListItem[]>([]);
  const [status, setStatus] = useState<PageStatus>({ loading: true, error: null });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      if (!api.listCompositions) {
        setStatus({ loading: false, error: '暂无可读取的组合摘要。' });
        return;
      }
      try {
        setStatus({ loading: true, error: null });
        if (reloadKey === 0) {
          await new Promise((resolve) => window.setTimeout(resolve, FIRST_SCREEN_DEFER_MS));
        }
        if (cancelled) {
          return;
        }
        const response = await api.listCompositions();
        if (!cancelled) {
          setRows(response.filter((item) => item.status !== 'ARCHIVED'));
          setStatus({ loading: false, error: null });
        }
      } catch (caught) {
        if (!cancelled) {
          setStatus({ loading: false, error: `组合列表加载失败：${(caught as Error).message}` });
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [api, reloadKey]);

  return { ...status, reload: () => setReloadKey((value) => value + 1), rows };
}

function useBacktestRuns(): PageStatus & { reload: () => void; rows: ApiCompositionGlobalBacktestRunListItem[] } {
  const api = useApiClient();
  const [rows, setRows] = useState<ApiCompositionGlobalBacktestRunListItem[]>([]);
  const [status, setStatus] = useState<PageStatus>({ loading: true, error: null });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      if (!api.listCompositionBacktestRuns) {
        setRows([]);
        setStatus({ loading: false, error: null });
        return;
      }
      try {
        setStatus({ loading: true, error: null });
        const response = await api.listCompositionBacktestRuns();
        if (!cancelled) {
          setRows(response);
          setStatus({ loading: false, error: null });
        }
      } catch (caught) {
        if (!cancelled) {
          setStatus({ loading: false, error: `组合回测列表加载失败：${(caught as Error).message}` });
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [api, reloadKey]);

  return { ...status, reload: () => setReloadKey((value) => value + 1), rows };
}

function useAllocationJobs(): PageStatus & { reload: () => void; rows: ApiCompositionGlobalAllocationJobListItem[] } {
  const api = useApiClient();
  const [rows, setRows] = useState<ApiCompositionGlobalAllocationJobListItem[]>([]);
  const [status, setStatus] = useState<PageStatus>({ loading: true, error: null });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      if (!api.listCompositionAllocationJobs) {
        setRows([]);
        setStatus({ loading: false, error: null });
        return;
      }
      try {
        setStatus({ loading: true, error: null });
        const response = await api.listCompositionAllocationJobs();
        if (!cancelled) {
          setRows(response);
          setStatus({ loading: false, error: null });
        }
      } catch (caught) {
        if (!cancelled) {
          setStatus({ loading: false, error: `组合实验室加载失败：${(caught as Error).message}` });
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [api, reloadKey]);

  return { ...status, reload: () => setReloadKey((value) => value + 1), rows };
}

export function CompositionListIndexPage(): JSX.Element {
  const api = useApiClient();
  const { error, loading, reload, rows } = useCompositions();
  const [filters, setFilters] = useState<CompositionListFilterState>(() => initialCompositionListFilters());
  const [viewSaveStatus, setViewSaveStatus] = useState<string | null>(null);
  const [diagnosisItem, setDiagnosisItem] = useState<ApiCompositionListItem | null>(null);
  const [decisionDialogOpen, setDecisionDialogOpen] = useState(false);
  const [pendingArchiveItem, setPendingArchiveItem] = useState<ApiCompositionListItem | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archivingCompositionId, setArchivingCompositionId] = useState<string | null>(null);
  const filteredRows = useMemo(() => filterCompositions(rows, filters), [filters, rows]);
  const metrics = useMemo<Metric[]>(() => {
    const activeRows = rows.filter((item) => item.status === 'ACTIVE');
    const robustCount = rows.filter((item) => primaryCompositionDiagnosis(item).status === '稳健').length;
    const labReferenceCount = rows.filter((item) => Boolean((item.lab_summary as { job_id?: unknown } | null | undefined)?.job_id)).length;
    const statusActionTotal = rows.reduce((total, item) => total + compositionDecisionActionCount(item), 0);
    return [
      { label: '可运行组合', value: formatNumber(activeRows.length), detail: '已通过来源冻结与权重合计检查。', accent: true },
      { label: '稳健状态', value: formatNumber(robustCount), detail: '状态标签已关闭或无需处理。' },
      { label: '配置实验参考', value: formatNumber(labReferenceCount), detail: '结果仅用于测试比较，不进入待办队列。' },
      {
        label: '状态待处理',
        value: formatNumber(statusActionTotal),
        detail: '仅统计版本更新与来源复核，配置实验保持参考态。',
        ariaLabel: '查看状态待处理',
        onSelect: () => setDecisionDialogOpen(true),
      },
    ];
  }, [rows]);
  const statusActionTotal = rows.reduce((total, item) => total + compositionDecisionActionCount(item), 0);
  const draftCount = rows.filter((item) => item.status === 'DRAFT').length;
  const statusKnown = rows.filter((item) => primaryCompositionDiagnosis(item).diagnosis_label).length;
  const statusCoverage = rows.length > 0 ? `${Math.round((statusKnown / rows.length) * 100)}%` : '0%';
  function updateFilters(next: CompositionListFilterState): void {
    setFilters(next);
    setViewSaveStatus(null);
    writeCompositionListHash(next);
  }

  function requestArchive(item: ApiCompositionListItem): void {
    setArchiveError(null);
    setPendingArchiveItem(item);
  }

  function cancelArchive(): void {
    if (pendingArchiveItem && archivingCompositionId === pendingArchiveItem.id) {
      return;
    }
    setPendingArchiveItem(null);
    setArchiveError(null);
  }

  async function confirmArchive(): Promise<void> {
    if (!pendingArchiveItem) {
      return;
    }
    if (!api.updateComposition) {
      setArchiveError('当前运行时还未接入组合状态写入接口，无法归档组合。');
      return;
    }
    try {
      setArchiveError(null);
      setArchivingCompositionId(pendingArchiveItem.id);
      await api.updateComposition(pendingArchiveItem.id, { status: 'ARCHIVED' });
      setPendingArchiveItem(null);
      reload();
    } catch (caught) {
      setArchiveError(`归档组合失败：${(caught as Error).message}`);
    } finally {
      setArchivingCompositionId(null);
    }
  }

  return (
    <div className="composition-global-index-page" data-page-root="composition-global-list" data-route-root="compositions-list">
      <Hero
        actions={
          <button className="composition-global-index__primary-button" onClick={() => goTo('/compositions/workbench')} type="button">
            新建组合
          </button>
        }
        chips={[`正式组合 ${rows.filter((item) => item.status === 'ACTIVE').length} 个`, `状态待处理 ${statusActionTotal} 项`, `草稿版本 ${draftCount} 个`, `状态标签覆盖 ${statusCoverage}`]}
        eyebrow="组合中心"
        summary="集中查看组合状态标签与待处理事项，形成组合运营工作清单。"
        title="组合列表"
      />
      <MetricGrid metrics={metrics} />
      {error ? <div className="composition-global-index__error">{error}</div> : null}
      <div className="composition-global-index__layout composition-global-index__layout--wide">
        <PanelShell countLabel={`${filteredRows.length}/${rows.length} 条记录`} description="按组合摘要快速筛查，状态标签进入弹层查看原因和动作。" title="全部组合">
          <Toolbar
            actionLabel="保存视图"
            actionStatus={viewSaveStatus}
            filters={[
              {
                key: 'status',
                label: '状态',
                value: filters.status,
                options: [
                  { label: '全部', value: 'all' },
                  { label: '正式', value: 'ACTIVE' },
                  { label: '草稿', value: 'DRAFT' },
                ],
              },
              {
                key: 'evidenceGrade',
                label: '状态标签',
                value: filters.evidenceGrade,
                options: [
                  { label: '全部', value: 'all' },
                  { label: '稳健', value: 'A' },
                  { label: '待校准', value: 'B' },
                  { label: '失效', value: 'C' },
                ],
              },
              {
                key: 'decision',
                label: '待办',
                value: filters.decision,
                options: [
                  { label: '全部', value: 'all' },
                  { label: '待处理', value: 'pending' },
              { label: '版本更新', value: 'version_update' },
                ],
              },
            ]}
            onAction={() => {
              window.localStorage.setItem(COMPOSITION_LIST_VIEW_STORAGE_KEY, JSON.stringify(filters));
              setViewSaveStatus('已保存');
            }}
            onFilterChange={(key, value) => {
              updateFilters(normalizeCompositionListFilters({ ...filters, [key]: value } as Partial<CompositionListFilterState>));
            }}
            onSecondaryAction={() => updateFilters(DEFAULT_COMPOSITION_LIST_FILTERS)}
            secondaryActionLabel="重置筛选"
          />
          <CompositionListTable
            archivingCompositionId={archivingCompositionId}
            compositions={filteredRows}
            loading={loading}
            onArchiveRequest={requestArchive}
            onDiagnosisOpen={setDiagnosisItem}
          />
        </PanelShell>
      </div>
      {decisionDialogOpen ? (
        <CompositionDecisionDialog
          compositions={rows}
          onClose={() => setDecisionDialogOpen(false)}
          onDiagnosisOpen={setDiagnosisItem}
        />
      ) : null}
      {diagnosisItem ? (
        <CompositionDiagnosisDialog item={diagnosisItem} onClose={() => setDiagnosisItem(null)} onCompleted={reload} />
      ) : null}
      {pendingArchiveItem ? (
        <CompositionArchiveDialog
          error={archiveError}
          item={pendingArchiveItem}
          onCancel={cancelArchive}
          onConfirm={() => void confirmArchive()}
          saving={archivingCompositionId === pendingArchiveItem.id}
        />
      ) : null}
    </div>
  );
}

export function CompositionBacktestRunsIndexPage(): JSX.Element {
  const api = useApiClient();
  const { error, loading, reload, rows } = useBacktestRuns();
  const [filters, setFilters] = useState<BacktestRunFilterState>(() => readBacktestRunFiltersFromHash());
  const [selectedPressureRunId, setSelectedPressureRunId] = useState<string | null>(null);
  const [pendingDeleteRun, setPendingDeleteRun] = useState<ApiCompositionGlobalBacktestRunListItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const filteredRows = useMemo(() => sortBacktestRunsByRunTimeDesc(filterBacktestRuns(rows, filters)), [filters, rows]);
  const selectedPressureRun = useMemo(
    () => rows.find((row) => backtestRunStableId(row) === selectedPressureRunId || row.id === selectedPressureRunId) ?? null,
    [rows, selectedPressureRunId],
  );
  const completedRows = rows.filter((row) => ['COMPLETED', 'COMPLETED_WITH_WARNINGS'].includes(String(row.status).toUpperCase()));
  const scenarioCount = new Set(rows.filter((row) => row.scenario_label || row.scenario_id).map(backtestScenarioValue)).size;
  const orderCount = rows.reduce((total, row) => total + (row.order_count ?? 0), 0);
  const statusActionCount = rows.filter((row) => diagnosisNeedsAction(primaryCompositionDiagnosis(row))).length;
  const compositionOptions = useMemo(
    () => [
      { label: '全部', value: 'all' },
      ...uniqueOptions(rows, (row) => row.composition_id, (row) => row.composition_name ?? row.composition_id),
    ],
    [rows],
  );
  const scenarioOptions = useMemo(
    () => [
      { label: '全部', value: 'all' },
      ...uniqueOptions(rows, backtestScenarioValue, backtestScenarioValue),
    ],
    [rows],
  );
  const updateFilters = (nextFilters: BacktestRunFilterState): void => {
    const normalized = normalizeBacktestRunFilters(nextFilters);
    setFilters(normalized);
    writeBacktestRunHash(normalized);
  };
  const requestDelete = (item: ApiCompositionGlobalBacktestRunListItem): void => {
    setDeleteError(null);
    setPendingDeleteRun(item);
  };
  const cancelDelete = (): void => {
    if (pendingDeleteRun && deletingRunId === (pendingDeleteRun.run_id ?? pendingDeleteRun.id)) {
      return;
    }
    setPendingDeleteRun(null);
    setDeleteError(null);
  };
  const confirmDelete = async (): Promise<void> => {
    if (!pendingDeleteRun) {
      return;
    }
    if (!api.deleteCompositionBacktestRun) {
      setDeleteError('当前运行时还未接入组合回测删除接口，无法删除该记录。');
      return;
    }
    const runId = pendingDeleteRun.run_id ?? pendingDeleteRun.id;
    try {
      setDeleteError(null);
      setDeletingRunId(runId);
      await api.deleteCompositionBacktestRun(pendingDeleteRun.composition_id, runId);
      if (selectedPressureRunId === runId || selectedPressureRunId === pendingDeleteRun.id) {
        setSelectedPressureRunId(null);
      }
      setPendingDeleteRun(null);
      reload();
    } catch (caught) {
      setDeleteError(`删除组合回测失败：${(caught as Error).message}`);
    } finally {
      setDeletingRunId(null);
    }
  };
  return (
    <div className="composition-global-index-page" data-page-root="composition-global-backtest-runs" data-route-root="compositions-backtest-runs">
      <Hero
        chips={[`已完成 ${completedRows.length} 次`, `需复盘 ${rows.filter((row) => statusTone(row.scenario_status_label) === 'danger').length} 次`, `订单记录 ${orderCount} 笔`, '模拟订单需显式标记']}
        eyebrow="组合回测"
        summary="集中查看组合回测、压力窗口与运行时间。"
        title="组合回测列表"
      />
      <MetricGrid
        metrics={[
          { label: '稳定裁决', value: formatNumber(completedRows.length), detail: '10Y 或更长窗口通过核心门禁。', accent: true },
          { label: '压力窗口', value: formatNumber(scenarioCount), detail: '2008、2020、2022 可对照复盘。' },
          { label: '订单留痕', value: formatNumber(orderCount), detail: '组合建仓、再平衡与内部对冲。' },
          { label: '复核待处理', value: formatNumber(statusActionCount), detail: '代理覆盖、异常补值或样本窗口仍需处理。' },
        ]}
      />
      {error ? <div className="composition-global-index__error">{error}</div> : null}
      <div className="composition-global-index__layout">
        <PanelShell countLabel={`${filteredRows.length}/${rows.length} 条记录`} description="按组合版本快照查看运行结果。" title="回测运行">
          <Toolbar
            actionLabel="重置筛选"
            onAction={() => updateFilters(DEFAULT_BACKTEST_RUN_FILTERS)}
            onFilterChange={(key, value) => {
              updateFilters(normalizeBacktestRunFilters({ ...filters, [key]: value } as Partial<BacktestRunFilterState>));
            }}
            filters={[
              { key: 'compositionId', label: '组合', value: filters.compositionId, options: compositionOptions },
              { key: 'scenario', label: '压力窗口', value: filters.scenario, options: scenarioOptions },
            ]}
          />
          <div className="composition-global-index__table-scroll" aria-label="组合回测列表横向滚动区域">
            <BacktestRunTable
              deletingRunId={deletingRunId}
              loading={loading}
              onDeleteRequest={requestDelete}
              onPressureWindowSelect={(row) => setSelectedPressureRunId(backtestRunStableId(row))}
              rows={filteredRows}
              selectedPressureRunId={selectedPressureRunId}
            />
          </div>
        </PanelShell>
        <ScenarioRail rows={rows} selectedRun={selectedPressureRun} />
      </div>
      {pendingDeleteRun ? (
        <CompositionBacktestRunDeleteDialog
          error={deleteError}
          item={pendingDeleteRun}
          onCancel={cancelDelete}
          onConfirm={() => void confirmDelete()}
          saving={deletingRunId === (pendingDeleteRun.run_id ?? pendingDeleteRun.id)}
        />
      ) : null}
    </div>
  );
}

export function CompositionLabIndexPage(): JSX.Element {
  const { error, loading, reload, rows } = useAllocationJobs();
  const [filters, setFilters] = useState<AllocationLabFilterState>(() => {
    const parsed = readAllocationLabFiltersFromHash();
    return parsed.hasQuery ? parsed.filters : readSavedAllocationLabFilters() ?? parsed.filters;
  });
  const [viewSaveStatus, setViewSaveStatus] = useState<string | null>(null);
  const [diagnosisItem, setDiagnosisItem] = useState<CompositionDiagnosisTarget | null>(null);
  const filteredRows = useMemo(() => filterAllocationJobs(rows, filters), [filters, rows]);
  const sharpeValues = rows.map((row) => row.sharpe_delta).filter((value): value is number => typeof value === 'number');
  const medianSharpe = sharpeValues.length > 0 ? sharpeValues.sort((a, b) => a - b)[Math.floor(sharpeValues.length / 2)] : null;
  const enbValues = rows.map((row) => row.enb).filter((value): value is number => typeof value === 'number');
  const avgEnb = enbValues.length > 0 ? enbValues.reduce((total, value) => total + value, 0) / enbValues.length : null;
  const blocked = rows.reduce((total, row) => total + (row.policy_violation_count ?? 0), 0);
  const compositionOptions = useMemo(
    () => [
      { label: '全部', value: 'all' },
      ...uniqueOptions(rows, (row) => row.composition_id, (row) => row.composition_name ?? row.composition_id),
    ],
    [rows],
  );
  const methodOptions = useMemo(
    () => [
      { label: '全部', value: 'all' },
      ...uniqueOptions(rows, allocationJobMethodValue, (row) => allocationMethodLabel(row.method_key ?? row.method_label)),
    ],
    [rows],
  );
  const updateFilters = (nextFilters: AllocationLabFilterState): void => {
    const normalized = normalizeAllocationLabFilters(nextFilters);
    setFilters(normalized);
    setViewSaveStatus(null);
    writeAllocationLabHash(normalized);
  };
  return (
    <div className="composition-global-index-page" data-page-root="composition-global-lab" data-route-root="compositions-lab">
      <Hero
        chips={[`已完成作业 ${rows.length} 个`, `测试参考 ${rows.length} 个`, `政策违反 ${blocked} 项`, `不生成待办`]}
        eyebrow="配置实验室"
        summary="跨组合追踪资产配置实验，结果仅作为测试参考。"
        title="组合实验室"
      />
      <MetricGrid
        metrics={[
          { label: '测试参考作业', value: formatNumber(rows.length), detail: '配置实验只用于比较与复盘。', accent: true },
          { label: '扣费后 Sharpe 改善', value: medianSharpe === null ? '暂无' : medianSharpe.toFixed(2), detail: '按候选中位数计算。' },
          { label: '平均 ENB', value: avgEnb === null ? '暂无' : avgEnb.toFixed(1), detail: '用于确认候选分散度。' },
          { label: '需复核状态', value: formatNumber(blocked), detail: '现金下限、失效状态或政策违反，仅作参考提示。' },
        ]}
      />
      {error ? <div className="composition-global-index__error">{error}</div> : null}
      <div className="composition-global-index__layout composition-global-index__layout--wide">
        <PanelShell countLabel={`${filteredRows.length}/${rows.length} 条作业`} description="按组合、方法和参考状态集中查看配置实验。" title="实验作业列表">
          <Toolbar
            actionLabel="保存视图"
            actionStatus={viewSaveStatus}
            filters={[
              { key: 'compositionId', label: '组合', value: filters.compositionId, options: compositionOptions },
              { key: 'method', label: '优化方法', value: filters.method, options: methodOptions },
              {
                key: 'status',
                label: '状态',
                value: filters.status,
                options: [
                  { label: '全部', value: 'all' },
                  { label: '测试参考', value: 'reference' },
                  { label: '需复核', value: 'review' },
                  { label: '状态阻断', value: 'blocked' },
                ],
              },
              {
                key: 'gate',
                label: '门禁',
                value: filters.gate,
                options: [
                  { label: '全部', value: 'all' },
                  { label: '参考可用', value: 'reference' },
                  { label: '需复核', value: 'review' },
                  { label: '阻断', value: 'blocked' },
                ],
              },
            ]}
            onAction={() => {
              window.localStorage.setItem(COMPOSITION_LAB_VIEW_STORAGE_KEY, JSON.stringify(filters));
              setViewSaveStatus('已保存');
            }}
            onFilterChange={(key, value) => {
              updateFilters(normalizeAllocationLabFilters({ ...filters, [key]: value } as Partial<AllocationLabFilterState>));
            }}
            onSecondaryAction={() => updateFilters(DEFAULT_ALLOCATION_LAB_FILTERS)}
            secondaryActionLabel="重置筛选"
          />
          <AllocationJobTable loading={loading} onDiagnosisOpen={setDiagnosisItem} rows={filteredRows} />
        </PanelShell>
      </div>
      {diagnosisItem ? (
        <CompositionDiagnosisDialog item={diagnosisItem} onClose={() => setDiagnosisItem(null)} onCompleted={reload} />
      ) : null}
    </div>
  );
}

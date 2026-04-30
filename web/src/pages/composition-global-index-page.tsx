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

type Tone = 'good' | 'info' | 'warning' | 'danger' | 'neutral';

type Metric = {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
};

type PageStatus = {
  loading: boolean;
  error: string | null;
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
  status: 'all' | 'promotion_ready' | 'review' | 'blocked';
  gate: 'all' | 'pass' | 'review' | 'blocked';
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

function goTo(path: string): void {
  window.location.hash = path;
}

function openRouteInNewTab(route?: string | null): void {
  const normalized = String(route ?? '').trim();
  if (!normalized) {
    return;
  }
  const url = /^https?:\/\//i.test(normalized)
    ? normalized
    : `${window.location.origin}${window.location.pathname}#${normalized.startsWith('/') ? normalized : `/${normalized}`}`;
  window.open(url, '_blank', 'noopener,noreferrer');
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
  if (['active', 'completed', 'succeeded', 'ready', 'pass', 'promotion_ready'].includes(normalized)) {
    return 'good';
  }
  if (['running', 'queued', 'draft', 'review', 'watch', 'completed_with_warnings'].includes(normalized)) {
    return 'warning';
  }
  if (['failed', 'blocked', 'rejected', 'policy_violation'].includes(normalized)) {
    return 'danger';
  }
  return 'info';
}

function backtestStatusLabel(value?: string | null): string {
  const normalized = String(value ?? '').toUpperCase();
  if (normalized === 'COMPLETED') {
    return '完成';
  }
  if (normalized === 'COMPLETED_WITH_WARNINGS') {
    return '完成（待校准）';
  }
  if (normalized === 'RUNNING') {
    return '运行中';
  }
  if (normalized === 'FAILED') {
    return '失败';
  }
  return value ? String(value) : '状态待确认';
}

function backtestVerdictLabel(value?: string | null, status?: string | null): string {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === '10y stable') {
    return '10Y 稳定';
  }
  if (normalized === 'proxy evidence required') {
    return '代理覆盖待确认';
  }
  if (normalized === 'limited window') {
    return '样本窗口有限';
  }
  if (normalized === 'completed' || normalized === 'completed_with_warnings') {
    return backtestStatusLabel(value);
  }
  return value ? String(value) : backtestStatusLabel(status);
}

function backtestEvidenceLabel(value?: string | null, grade?: string | null): string {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return evidenceLabel(grade);
  }
  if (normalized === 'proxy_from_composition_detail_preview') {
    return '来自组合详情预演的代理覆盖';
  }
  if (normalized.includes('model instructions') || normalized.includes('not broker fills')) {
    return '模型调仓流水，非券商成交回报';
  }
  if (normalized === 'derived from full-window composition rebalance events and source return streams') {
    return '来自全窗口再平衡与来源收益流';
  }
  return String(value);
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

function compositionNeedsDecision(item: ApiCompositionListItem): boolean {
  const pendingCount = item.pending_decision_count ?? 0;
  return pendingCount > 0 || hasVersionUpdate(item) || needsSourceReview(item);
}

function decisionLabel(item: ApiCompositionListItem): string {
  return primaryCompositionDiagnosis(item).diagnosis_label;
}

function decisionTone(item: ApiCompositionListItem): Tone {
  return diagnosisTone(primaryCompositionDiagnosis(item)) as Tone;
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

function allocationJobGateStatus(row: ApiCompositionGlobalAllocationJobListItem): 'pass' | 'review' | 'blocked' {
  const explicit = String(row.gate_status ?? '').trim().toLowerCase();
  if (explicit === 'pass' || explicit === 'ready') {
    return 'pass';
  }
  if (explicit === 'blocked') {
    return 'blocked';
  }
  const gateLabel = String(row.promotion_gate_label ?? '').trim().toLowerCase();
  const blocked = (row.policy_violation_count ?? 0) > 0 || gateLabel.includes('阻断') || gateLabel.includes('blocked');
  if (blocked) {
    return 'blocked';
  }
  return (row.promotion_ready_count ?? 0) > 0 ? 'pass' : 'review';
}

function allocationJobStatus(row: ApiCompositionGlobalAllocationJobListItem): AllocationLabFilterState['status'] {
  const gateStatus = allocationJobGateStatus(row);
  if (gateStatus === 'blocked') {
    return 'blocked';
  }
  return (row.promotion_ready_count ?? 0) > 0 ? 'promotion_ready' : 'review';
}

function allocationJobMethodValue(row: ApiCompositionGlobalAllocationJobListItem): string {
  return normalizeAllocationMethodKey(row.method_key ?? row.method_label);
}

function normalizeAllocationLabFilters(value: Partial<AllocationLabFilterState>): AllocationLabFilterState {
  const status =
    value.status === 'promotion_ready' || value.status === 'review' || value.status === 'blocked' ? value.status : 'all';
  const gate = value.gate === 'pass' || value.gate === 'review' || value.gate === 'blocked' ? value.gate : 'all';
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
  item: ApiCompositionListItem;
  onClose: () => void;
  onCompleted: () => void;
}): JSX.Element {
  const api = useApiClient();
  const diagnosis = primaryCompositionDiagnosis(item);
  const actions = normalizedDiagnosisActions(diagnosis);
  const proxyContexts = diagnosis.proxy_context ?? [];
  const primaryProxyContext = proxyContexts.find((context) => context.proxy_source === 'unconfirmed') ?? proxyContexts[0];
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

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
      openRouteInNewTab(action.route ?? `/compositions/${encodeURIComponent(item.id)}`);
      setActionStatus('已在新标签页打开处理入口。');
      return;
    }
    if (action.action_kind === 'inspect') {
      setActionStatus('代理来源、覆盖区间和审计事实已在当前弹层展示。');
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
        await api.confirmCompositionProxy(item.id, payload);
        setActionStatus('代理覆盖已确认；同一代理方案不再提醒。');
        onCompleted();
        return;
      }
      if (action.action_key === 'refresh_return_quality' || action.action_key === 'refresh_diagnostics') {
        if (!api.refreshCompositionDiagnostics) {
          setActionStatus('当前运行环境不支持在线刷新诊断。');
          return;
        }
        await api.refreshCompositionDiagnostics(item.id);
        setActionStatus('状态标签已重新计算。');
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
      {metrics.map((metric) => (
        <article
          className={`composition-global-index__metric ${metric.accent ? 'composition-global-index__metric--accent' : ''}`}
          key={metric.label}
        >
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
          <small>{metric.detail}</small>
        </article>
      ))}
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
  compositions,
  loading,
  onDiagnosisOpen,
}: {
  compositions: ApiCompositionListItem[];
  loading: boolean;
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
          <th>待决策</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {loading ? <LoadingRows colSpan={6} /> : null}
        {!loading && compositions.length === 0 ? <EmptyRows colSpan={6} message="暂无符合当前筛选的组合记录。" /> : null}
        {!loading
          ? compositions.map((item) => {
              const pendingDecisionCount = item.pending_decision_count ?? (compositionNeedsDecision(item) ? 1 : 0);
              const diagnosis = primaryCompositionDiagnosis(item);
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
                    <button
                      className="composition-global-index__text-button"
                      onClick={() => goTo(`/compositions/${encodeURIComponent(item.id)}`)}
                      type="button"
                    >
                      查看详情
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

function BacktestRunTable({
  loading,
  onScenarioSelect,
  rows,
}: {
  loading: boolean;
  onScenarioSelect: (scenario: string, rowId?: string) => void;
  rows: ApiCompositionGlobalBacktestRunListItem[];
}): JSX.Element {
  return (
    <table className="composition-global-index__table composition-global-index__table--compact" aria-label="组合回测列表">
      <thead>
        <tr>
          <th>组合名</th>
          <th>时间周期</th>
          <th>状态标签</th>
          <th>压力窗口</th>
          <th>年化收益</th>
          <th>夏普</th>
          <th>回撤</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {loading ? <LoadingRows colSpan={8} /> : null}
        {!loading && rows.length === 0 ? <EmptyRows colSpan={8} message="暂无可重载的组合回测记录。" /> : null}
        {!loading
          ? rows.map((row) => {
              const runId = row.run_id ?? row.id;
              const scenario = backtestScenarioValue(row);
              const diagnosis = primaryCompositionDiagnosis(row);
              return (
                <tr key={row.id}>
                  <td>
                    <div className="composition-global-index__name-cell">
                      <div className="composition-global-index__name-line">
                        <strong>{row.composition_name ?? row.composition_id}</strong>
                        <StatusPill tone={statusTone(row.status)}>{row.composition_version_label ?? '版本快照待确认'}</StatusPill>
                      </div>
                      <span>{runId} · {formatDate(row.completed_at ?? row.created_at)}</span>
                    </div>
                  </td>
                  <td>
                    <StatusPill tone={statusTone(row.status)}>{backtestPeriodLabel(row)}</StatusPill>
                  </td>
                  <td>
                    <div className="composition-global-index__value-stack">
                      <StatusPill tone={diagnosisTone(diagnosis) as Tone}>{diagnosis.diagnosis_label}</StatusPill>
                      <span>{backtestVerdictLabel(row.verdict_label, row.status)} · {backtestEvidenceLabel(row.verdict_detail ?? row.evidence_label, row.evidence_grade)}</span>
                    </div>
                  </td>
                  <td>
                    <button
                      className="composition-global-index__scenario-button"
                      onClick={() => onScenarioSelect(scenario, row.id)}
                      type="button"
                    >
                      <StatusPill tone={statusTone(row.scenario_status_label)}>{scenario}</StatusPill>
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
                    <button
                      className="composition-global-index__text-button"
                      onClick={() =>
                        goTo(`/compositions/${encodeURIComponent(row.composition_id)}/backtest-runs/${encodeURIComponent(runId)}`)
                      }
                      type="button"
                    >
                      查看
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

function AllocationJobTable({
  loading,
  rows,
}: {
  loading: boolean;
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
                        最佳 {allocationMethodLabel(row.best_candidate_label ?? row.method_key ?? row.method_label)} · 候选{' '}
                        {formatNumber(row.candidate_count, '0')} / 可晋升 {formatNumber(row.promotion_ready_count, '0')}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="composition-global-index__value-stack">
                      <StatusPill tone={blocked ? 'danger' : diagnosisTone(diagnosis) as Tone}>
                        {diagnosis.diagnosis_label}
                      </StatusPill>
                      <span>{row.promotion_gate_label ?? (gateStatus === 'pass' ? '可通过' : '待审查')}</span>
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
                      进入审查
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

function DecisionRail({
  compositions,
  onDiagnosisOpen,
}: {
  compositions: ApiCompositionListItem[];
  onDiagnosisOpen: (item: ApiCompositionListItem) => void;
}): JSX.Element {
  const decisions = compositions.filter(compositionNeedsDecision).slice(0, 3);
  return (
    <aside className="composition-global-index__rail-card">
      <header>
        <h2>待决策事项</h2>
        <p>按状态标签、版本确认和候选晋升汇总。</p>
      </header>
      <div className="composition-global-index__rail-list">
        {decisions.length === 0 ? (
          <article className="composition-global-index__queue-item">
            <header>
              <strong>暂无待决策事项</strong>
              <StatusPill>已清空</StatusPill>
            </header>
            <p>当前筛选范围内没有待处理状态标签、版本更新或候选晋升提醒。</p>
          </article>
        ) : null}
        {decisions.map((item) => (
          <article className="composition-global-index__queue-item" key={item.id}>
            <header>
              <strong>{item.name}</strong>
              <StatusPill tone={decisionTone(item)}>{decisionLabel(item)}</StatusPill>
            </header>
            <p>{activityLabel(item.latest_activity_label)}</p>
            <button
              className="composition-global-index__text-button"
              onClick={() => onDiagnosisOpen(item)}
              type="button"
            >
              查看状态标签
            </button>
          </article>
        ))}
      </div>
    </aside>
  );
}

function ScenarioRail({
  onScenarioSelect,
  rows,
  selectedRunId,
  selectedScenario,
}: {
  onScenarioSelect: (scenario: string, rowId?: string) => void;
  rows: ApiCompositionGlobalBacktestRunListItem[];
  selectedRunId: string | null;
  selectedScenario: string;
}): JSX.Element {
  const scenarioRows = uniqueOptions(rows, backtestScenarioValue, backtestScenarioValue)
    .map((option) => rows.find((row) => backtestScenarioValue(row) === option.value))
    .filter((row): row is ApiCompositionGlobalBacktestRunListItem => Boolean(row))
    .slice(0, 4);
  const selectedRows =
    selectedScenario === 'all'
      ? rows
      : rows.filter((row) => backtestRowMatchesScenario(row, selectedScenario));
  const activeRow =
    selectedRunId
      ? selectedRows.find((row) => row.id === selectedRunId || row.run_id === selectedRunId) ??
        rows.find((row) => row.id === selectedRunId || row.run_id === selectedRunId) ??
        null
      : null;
  const activeScenario = activeRow ? backtestScenarioValue(activeRow) : '暂无压力窗口';
  const visibleScenarioRows = activeRow
    ? scenarioRows.filter((row) => row.id !== activeRow.id)
    : scenarioRows;
  return (
    <aside className="composition-global-index__rail-card">
      <header>
        <h2>压力窗口</h2>
        <p>选择窗口查看回撤与修复表现。</p>
      </header>
      {activeRow ? (
        <section className="composition-global-index__scenario-summary" aria-label="当前压力窗口">
          <header>
            <strong>{activeScenario}</strong>
            <StatusPill tone={statusTone(activeRow.scenario_status_label)}>
              {scenarioStatusLabel(activeRow.scenario_status_label)}
            </StatusPill>
          </header>
          <p>
            {activeRow.composition_name ?? activeRow.composition_id}
            {` · ${scenarioPeriodLabel(activeRow)}`}
          </p>
          <div className="composition-global-index__mini-grid">
            <div>
              <span>窗口回撤</span>
              <strong>{formatRatioAsPercent(activeRow.scenario_drawdown ?? activeRow.max_drawdown, { forceNegative: true })}</strong>
            </div>
            <div>
              <span>基准回撤</span>
              <strong>{formatRatioAsPercent(activeRow.scenario_benchmark_drawdown, { forceNegative: true })}</strong>
            </div>
            <div>
              <span>修复周期</span>
              <strong>{formatScenarioRecovery(activeRow)}</strong>
            </div>
            <div>
              <span>相对抗跌</span>
              <strong>{formatStressPoints(activeRow.scenario_defensive_delta)}</strong>
            </div>
          </div>
          {activeRow.scenario_source ? <p className="composition-global-index__scenario-source">{activeRow.scenario_source}</p> : null}
        </section>
      ) : (
        <p className="composition-global-index__scenario-hint">点击压力窗口查看该组合的极端行情表现。</p>
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
        {visibleScenarioRows.map((row) => (
          <button
            aria-label={`查看 ${backtestScenarioValue(row)}压力场景`}
            className={[
              'composition-global-index__queue-item',
              'composition-global-index__queue-button',
              'composition-global-index__scenario-item',
              activeRow?.id === row.id ? 'is-active' : '',
            ].filter(Boolean).join(' ')}
            key={row.id}
            onClick={() => onScenarioSelect(backtestScenarioValue(row), row.id)}
            type="button"
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
          </button>
        ))}
      </div>
    </aside>
  );
}

function PromotionRail({ rows }: { rows: ApiCompositionGlobalAllocationJobListItem[] }): JSX.Element {
  const reviewCandidate = rows.find((row) => (row.promotion_ready_count ?? 0) > 0) ?? rows[0];
  return (
    <aside className="composition-global-index__rail-card">
      <header>
        <h2>晋升审查</h2>
        <p>候选不能直接保存为正式版本，必须先生成草稿版本。</p>
      </header>
      {reviewCandidate ? (
        <article className="composition-global-index__review-card">
          <header>
            <strong>{allocationMethodLabel(reviewCandidate.method_key ?? reviewCandidate.method_label)}</strong>
            <StatusPill tone={diagnosisTone(primaryCompositionDiagnosis(reviewCandidate)) as Tone}>
              {primaryCompositionDiagnosis(reviewCandidate).diagnosis_label}
            </StatusPill>
          </header>
          <div className="composition-global-index__mini-grid">
            <div>
              <span>Δ夏普</span>
              <strong>{formatSignedDecimal(reviewCandidate.sharpe_delta)}</strong>
            </div>
            <div>
              <span>迁移成本</span>
              <strong>{formatBps(reviewCandidate.migration_cost_bps)}</strong>
            </div>
            <div>
              <span>约束违反</span>
              <strong>{formatNumber(reviewCandidate.policy_violation_count, '0')}</strong>
            </div>
          </div>
          <button
            className="composition-global-index__primary-button"
            disabled={(reviewCandidate.policy_violation_count ?? 0) > 0}
            type="button"
          >
            生成草稿版本
          </button>
          <button className="composition-global-index__ghost-button" type="button">
            创建决策包
          </button>
        </article>
      ) : (
        <article className="composition-global-index__queue-item">
          <header>
            <strong>暂无可审查候选</strong>
            <StatusPill>待作业</StatusPill>
          </header>
          <p>完成配置实验后，候选将在这里进入晋升审查。</p>
        </article>
      )}
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

function useBacktestRuns(): PageStatus & { rows: ApiCompositionGlobalBacktestRunListItem[] } {
  const api = useApiClient();
  const [rows, setRows] = useState<ApiCompositionGlobalBacktestRunListItem[]>([]);
  const [status, setStatus] = useState<PageStatus>({ loading: true, error: null });

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
  }, [api]);

  return { ...status, rows };
}

function useAllocationJobs(): PageStatus & { rows: ApiCompositionGlobalAllocationJobListItem[] } {
  const api = useApiClient();
  const [rows, setRows] = useState<ApiCompositionGlobalAllocationJobListItem[]>([]);
  const [status, setStatus] = useState<PageStatus>({ loading: true, error: null });

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
  }, [api]);

  return { ...status, rows };
}

export function CompositionListIndexPage(): JSX.Element {
  const { error, loading, reload, rows } = useCompositions();
  const [filters, setFilters] = useState<CompositionListFilterState>(() => initialCompositionListFilters());
  const [viewSaveStatus, setViewSaveStatus] = useState<string | null>(null);
  const [diagnosisItem, setDiagnosisItem] = useState<ApiCompositionListItem | null>(null);
  const filteredRows = useMemo(() => filterCompositions(rows, filters), [filters, rows]);
  const metrics = useMemo<Metric[]>(() => {
    const activeRows = rows.filter((item) => item.status === 'ACTIVE');
    const robustCount = rows.filter((item) => primaryCompositionDiagnosis(item).status === '稳健').length;
    const pendingCandidates = rows.reduce((total, item) => total + (item.promotion_candidate_count ?? 0), 0);
    const statusActionCount = rows.filter((item) => needsSourceReview(item) || hasVersionUpdate(item)).length;
    return [
      { label: '可运行组合', value: formatNumber(activeRows.length), detail: '已通过来源冻结与权重合计检查。', accent: true },
      { label: '稳健状态', value: formatNumber(robustCount), detail: '状态标签已关闭或无需处理。' },
      { label: '待晋升候选', value: formatNumber(pendingCandidates), detail: '来自已完成配置作业。' },
      { label: '待处理状态标签', value: formatNumber(statusActionCount), detail: '代理确认、冻结签名或策略版本仍需处理。' },
    ];
  }, [rows]);
  const pendingDecisions = rows.filter(compositionNeedsDecision).length;
  const draftCount = rows.filter((item) => item.status === 'DRAFT').length;
  const statusKnown = rows.filter((item) => primaryCompositionDiagnosis(item).diagnosis_label).length;
  const statusCoverage = rows.length > 0 ? `${Math.round((statusKnown / rows.length) * 100)}%` : '0%';
  function updateFilters(next: CompositionListFilterState): void {
    setFilters(next);
    setViewSaveStatus(null);
    writeCompositionListHash(next);
  }

  return (
    <div className="composition-global-index-page" data-page-root="composition-global-list" data-route-root="compositions-list">
      <Hero
        actions={
          <button className="composition-global-index__primary-button" onClick={() => goTo('/compositions/workbench')} type="button">
            新建组合
          </button>
        }
        chips={[`正式组合 ${rows.filter((item) => item.status === 'ACTIVE').length} 个`, `待决策 ${pendingDecisions} 项`, `草稿版本 ${draftCount} 个`, `状态标签覆盖 ${statusCoverage}`]}
        eyebrow="组合中心"
        summary="集中查看组合状态标签与待处理事项，形成组合运营工作清单。"
        title="组合列表"
      />
      <MetricGrid metrics={metrics} />
      {error ? <div className="composition-global-index__error">{error}</div> : null}
      <div className="composition-global-index__layout">
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
          <CompositionListTable compositions={filteredRows} loading={loading} onDiagnosisOpen={setDiagnosisItem} />
        </PanelShell>
        <DecisionRail compositions={filteredRows} onDiagnosisOpen={setDiagnosisItem} />
      </div>
      {diagnosisItem ? (
        <CompositionDiagnosisDialog item={diagnosisItem} onClose={() => setDiagnosisItem(null)} onCompleted={reload} />
      ) : null}
    </div>
  );
}

export function CompositionBacktestRunsIndexPage(): JSX.Element {
  const { error, loading, rows } = useBacktestRuns();
  const [filters, setFilters] = useState<BacktestRunFilterState>(() => readBacktestRunFiltersFromHash());
  const [selectedScenarioRunId, setSelectedScenarioRunId] = useState<string | null>(null);
  const filteredRows = useMemo(() => filterBacktestRuns(rows, filters), [filters, rows]);
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
  const statusOptions = useMemo(
    () => [
      { label: '全部', value: 'all' },
      ...uniqueOptions(rows, (row) => String(row.status ?? '').toUpperCase(), (row) => backtestStatusLabel(row.status)),
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
  const updateFilters = (nextFilters: BacktestRunFilterState, selectedRunId: string | null = null): void => {
    const normalized = normalizeBacktestRunFilters(nextFilters);
    setSelectedScenarioRunId(selectedRunId);
    setFilters(normalized);
    writeBacktestRunHash(normalized);
  };
  const selectScenario = (scenario: string, rowId?: string): void => {
    updateFilters(normalizeBacktestRunFilters({ ...filters, scenario }), rowId ?? null);
  };
  return (
    <div className="composition-global-index-page" data-page-root="composition-global-backtest-runs" data-route-root="compositions-backtest-runs">
      <Hero
        chips={[`已完成 ${completedRows.length} 次`, `需复盘 ${rows.filter((row) => statusTone(row.scenario_status_label) === 'danger').length} 次`, `订单记录 ${orderCount} 笔`, '模拟订单需显式标记']}
        eyebrow="组合回测"
        summary="集中查看组合回测、压力窗口与状态标签。"
        title="组合回测列表"
      />
      <MetricGrid
        metrics={[
          { label: '稳定裁决', value: formatNumber(completedRows.length), detail: '10Y 或更长窗口通过核心门禁。', accent: true },
          { label: '压力窗口', value: formatNumber(scenarioCount), detail: '2008、2020、2022 可联动复盘。' },
          { label: '订单留痕', value: formatNumber(orderCount), detail: '组合建仓、再平衡与内部对冲。' },
          { label: '状态待处理', value: formatNumber(statusActionCount), detail: '代理覆盖、异常补值或样本窗口仍需处理。' },
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
              { key: 'status', label: '状态', value: filters.status, options: statusOptions },
              { key: 'scenario', label: '压力窗口', value: filters.scenario, options: scenarioOptions },
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
            ]}
          />
          <BacktestRunTable loading={loading} onScenarioSelect={selectScenario} rows={filteredRows} />
        </PanelShell>
        <ScenarioRail
          onScenarioSelect={selectScenario}
          rows={rows}
          selectedRunId={selectedScenarioRunId}
          selectedScenario={filters.scenario}
        />
      </div>
    </div>
  );
}

export function CompositionLabIndexPage(): JSX.Element {
  const { error, loading, rows } = useAllocationJobs();
  const [filters, setFilters] = useState<AllocationLabFilterState>(() => {
    const parsed = readAllocationLabFiltersFromHash();
    return parsed.hasQuery ? parsed.filters : readSavedAllocationLabFilters() ?? parsed.filters;
  });
  const [viewSaveStatus, setViewSaveStatus] = useState<string | null>(null);
  const filteredRows = useMemo(() => filterAllocationJobs(rows, filters), [filters, rows]);
  const readyRows = rows.filter((row) => (row.promotion_ready_count ?? 0) > 0 && (row.policy_violation_count ?? 0) === 0);
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
        chips={[`已完成作业 ${rows.length} 个`, `待晋升候选 ${readyRows.length} 个`, `政策违反 ${blocked} 项`, `草稿版本待生成`]}
        eyebrow="配置实验室"
        summary="跨组合追踪资产配置实验，把有效前沿、候选权重、迁移成本和状态标签门禁收口到同一个晋升审查工作台。"
        title="组合实验室"
      />
      <MetricGrid
        metrics={[
          { label: '可晋升候选', value: formatNumber(readyRows.length), detail: '通过约束、状态标签和迁移成本预检。', accent: true },
          { label: '扣费后 Sharpe 改善', value: medianSharpe === null ? '暂无' : medianSharpe.toFixed(2), detail: '按候选中位数计算。' },
          { label: '平均 ENB', value: avgEnb === null ? '暂无' : avgEnb.toFixed(1), detail: '用于确认候选分散度。' },
          { label: '待修复门禁', value: formatNumber(blocked), detail: '现金下限、失效状态或政策违反。' },
        ]}
      />
      {error ? <div className="composition-global-index__error">{error}</div> : null}
      <div className="composition-global-index__layout">
        <PanelShell countLabel={`${filteredRows.length}/${rows.length} 条作业`} description="按组合、方法、候选状态和晋升门禁集中查看配置实验。" title="实验作业列表">
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
                  { label: '待晋升', value: 'promotion_ready' },
                  { label: '待审查', value: 'review' },
                  { label: '门禁阻断', value: 'blocked' },
                ],
              },
              {
                key: 'gate',
                label: '门禁',
                value: filters.gate,
                options: [
                  { label: '全部', value: 'all' },
                  { label: '可通过', value: 'pass' },
                  { label: '待审查', value: 'review' },
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
          <AllocationJobTable loading={loading} rows={filteredRows} />
        </PanelShell>
        <PromotionRail rows={filteredRows.length > 0 ? filteredRows : rows} />
      </div>
    </div>
  );
}

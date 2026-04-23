import { useDeferredValue, useMemo, useState, type CSSProperties } from 'react';
import { navigateTo } from '../../lib/appRouteContext';
import { formatRatio } from '../../lib/format';
import {
  cleanDisplayText,
  formatBenchmarkLabel,
  formatCompositionFactorDetail,
  formatCompositionFactorLabel,
  formatCompositionName,
  formatCompositionStatusLabel,
  formatCompositionVerdict,
  formatLegDisplayName,
  formatLegProofLabel,
  formatLegReferenceSummary,
  formatTagLabel,
} from '../../lib/compose-display';
import type {
  ApiCompositionCorrelationCell,
  ApiCompositionLegInput,
  ApiCompositionPreview,
  ApiCompositionPreviewLeg,
  ApiLegInventory,
  ApiLegInventoryRow,
  ApiLegType,
} from '../../types';
import './composition-workbench.css';

type PersistIntent = 'DRAFT' | 'ACTIVE';

type CompositionWorkbenchViewProps = {
  inventory: ApiLegInventory | null;
  preview: ApiCompositionPreview | null;
  compositionName: string;
  description: string;
  benchmarkLabel: string;
  rebalanceFrequency: string;
  selectedLegs: ApiCompositionLegInput[];
  loading?: boolean;
  previewLoading?: boolean;
  saving?: boolean;
  error?: string | null;
  modeLabel?: string | null;
  onCompositionNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onBenchmarkLabelChange: (value: string) => void;
  onRebalanceFrequencyChange: (value: string) => void;
  onAddLeg: (row: ApiLegInventoryRow) => void;
  onRemoveLeg: (sourceRefId: string) => void;
  onWeightChange: (sourceRefId: string, nextWeight: number) => void;
  onToggleLock: (sourceRefId: string) => void;
  onPersist: (intent: PersistIntent) => Promise<void>;
};

type SourceFilter = 'all' | ApiLegType;
type ReturnWindow = '3m' | '12m' | '24m';
type CorrelationInsight = {
  key: string;
  leftLabel: string;
  rightLabel: string;
  correlation: number;
  tone: 'warning' | 'accent';
};

const REBALANCE_OPTIONS = [
  { value: 'monthly', label: '月度再平衡' },
  { value: 'quarterly', label: '季度再平衡' },
  { value: 'semiannual', label: '半年再平衡' },
  { value: 'annual', label: '年度再平衡' },
] as const;
const RETURN_WINDOW_OPTIONS: Array<{ value: ReturnWindow; label: string; points: number }> = [
  { value: '3m', label: '3 个月', points: 3 },
  { value: '12m', label: '12 个月', points: 12 },
  { value: '24m', label: '24 个月', points: 24 },
];
const RADAR_AXIS_LABELS = ['分散度', '来源可信度', '成本控制', '收益增强', '维护节奏'] as const;

function clampWeight(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Number(value.toFixed(1))));
}

function getLegTypeLabel(value: string): string {
  switch (value) {
    case 'strategy':
      return '策略腿';
    case 'asset':
      return '资产腿';
    case 'cash':
      return '现金腿';
    default:
      return '来源腿';
  }
}

function getLegTypeClassName(value: string): string {
  return `composition-workbench-pill composition-workbench-pill--${value}`;
}

function getRowStatusLabel(value: string): string {
  return formatCompositionStatusLabel(value);
}

function getSourceStatusPriority(row: ApiLegInventoryRow): number {
  if (row.status === 'READY' || row.status === 'ACTIVE') {
    return 3;
  }
  if (row.status === 'STALE') {
    return 2;
  }
  if (row.attribute_tags.includes('needs_run')) {
    return 0;
  }
  return 1;
}

function getCadenceLabel(value?: string | null): string {
  const matched = REBALANCE_OPTIONS.find((item) => item.value === String(value || '').toLowerCase());
  return matched?.label ?? '维护节奏待确认';
}

function getInventoryRowDisplayName(row: ApiLegInventoryRow): string {
  return formatLegDisplayName({
    leg_kind: row.leg_type,
    name: row.name,
    source_ref_id: row.source_ref_id,
    config: row.config,
  });
}

function getInventoryRowReferenceLabel(row: ApiLegInventoryRow): string {
  return formatLegReferenceSummary(row.reference_summary, row.reference_count);
}

function getInventoryRowProofLabel(row: ApiLegInventoryRow): string {
  return formatLegProofLabel(row.proof_label, {
    leg_kind: row.leg_type,
    name: row.name,
    source_ref_id: row.source_ref_id,
    config: row.config,
  });
}

function getPreviewLegDisplayName(
  previewLeg: ApiCompositionPreviewLeg | null,
  draftLeg: ApiCompositionLegInput,
): string {
  return formatLegDisplayName({
    leg_kind: previewLeg?.leg_kind ?? draftLeg.leg_kind,
    display_name: previewLeg?.display_name ?? draftLeg.display_name,
    source_ref_id: draftLeg.source_ref_id,
    config: previewLeg?.config ?? draftLeg.config,
  });
}

function getPreviewLegProofText(
  previewLeg: ApiCompositionPreviewLeg | null,
  draftLeg: ApiCompositionLegInput,
): string {
  return formatLegProofLabel(previewLeg?.proof_label, {
    leg_kind: previewLeg?.leg_kind ?? draftLeg.leg_kind,
    display_name: previewLeg?.display_name ?? draftLeg.display_name,
    source_ref_id: draftLeg.source_ref_id,
    config: previewLeg?.config ?? draftLeg.config,
  });
}

function getChartPath(points: number[], width: number, height: number): string {
  return getChartCoordinates(points, width, height)
    .map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(' ');
}

function getChartCoordinates(points: number[], width: number, height: number): Array<{ x: number; y: number }> {
  if (!points.length) {
    return [];
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  return points.map((point, index) => {
    const x = 18 + (index / Math.max(points.length - 1, 1)) * (width - 36);
    const y = height - 18 - ((point - min) / range) * (height - 36);
    return { x, y };
  });
}

function getChartAreaPath(points: number[], width: number, height: number): string {
  const coordinates = getChartCoordinates(points, width, height);
  if (!coordinates.length) {
    return '';
  }
  const baseline = height - 18;
  const head = coordinates
    .map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(' ');
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  return `${head} L ${last.x.toFixed(2)} ${baseline.toFixed(2)} L ${first.x.toFixed(2)} ${baseline.toFixed(2)} Z`;
}

function getDrawdownAreaPath(points: number[], width: number, height: number): string {
  const coordinates = getChartCoordinates(points, width, height);
  if (coordinates.length < 3) {
    return '';
  }
  let runningPeak = points[0] ?? 0;
  const drawdownFlags = points.map((point) => {
    runningPeak = Math.max(runningPeak, point);
    return runningPeak - point > 0.002;
  });
  let start = drawdownFlags.findIndex(Boolean);
  let end = drawdownFlags.length - 1 - [...drawdownFlags].reverse().findIndex(Boolean);
  if (start < 0 || end < start) {
    start = Math.max(1, Math.floor(coordinates.length * 0.4));
    end = Math.min(coordinates.length - 1, Math.max(start + 1, Math.ceil(coordinates.length * 0.68)));
  }
  const segment = coordinates.slice(start, end + 1);
  const baseline = height - 18;
  const head = segment
    .map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${(y + 18).toFixed(2)}`)
    .join(' ');
  const first = segment[0];
  const last = segment[segment.length - 1];
  return `${head} L ${last.x.toFixed(2)} ${baseline.toFixed(2)} L ${first.x.toFixed(2)} ${baseline.toFixed(2)} Z`;
}

function getRadarPoints(scores: number[], radius = 42): string {
  return scores
    .map((score, index) => {
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(scores.length, 1);
      const scaledRadius = radius * (Math.max(0, Math.min(score, 100)) / 100);
      const x = 50 + Math.cos(angle) * scaledRadius;
      const y = 50 + Math.sin(angle) * scaledRadius;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

function getRadarAxisPoints(radius = 42): string {
  return RADAR_AXIS_LABELS.map((_, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / RADAR_AXIS_LABELS.length;
    const x = 50 + Math.cos(angle) * radius;
    const y = 50 + Math.sin(angle) * radius;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
}

function getRadarFactorScore(
  label: string,
  factors: Array<{ label: string; key: string; score: number }>,
  fallbackScore: number,
  maintenanceBps: number,
): number {
  const normalizedLabel = label.toLowerCase();
  const matched = factors.find((factor) => {
    const key = factor.key.toLowerCase();
    const factorLabel = factor.label.toLowerCase();
    return factorLabel.includes(normalizedLabel) || normalizedLabel.includes(factorLabel) || key.includes(normalizedLabel);
  });
  if (matched) {
    return matched.score;
  }
  if (label === '成本控制') {
    return Math.max(64, Math.min(94, 100 - maintenanceBps));
  }
  return fallbackScore;
}

function buildMatrixKey(left: string, right: string): string {
  return [left, right].sort().join('::');
}

function buildCorrelationLookup(cells: ApiCompositionCorrelationCell[]): Map<string, number> {
  return new Map(cells.map((cell) => [buildMatrixKey(cell.x_key, cell.y_key), cell.correlation]));
}

function getCorrelationToneClass(value: number): string {
  if (value >= 0.995) {
    return 'composition-workbench-correlation-cell--self';
  }
  if (value >= 0.7) {
    return 'composition-workbench-correlation-cell--hot';
  }
  if (value >= 0.2) {
    return 'composition-workbench-correlation-cell--mid';
  }
  if (value < 0) {
    return 'composition-workbench-correlation-cell--negative';
  }
  return 'composition-workbench-correlation-cell--low';
}

function getCorrelationPairLabel(value: number): string {
  if (value >= 0.7) {
    return '高相关';
  }
  if (value <= -0.2) {
    return '负相关';
  }
  if (Math.abs(value) <= 0.25) {
    return '低相关';
  }
  return '中性相关';
}

function getPreviewLeg(
  draftLeg: ApiCompositionLegInput,
  preview?: ApiCompositionPreview | null,
): ApiCompositionPreviewLeg | null {
  if (!preview) {
    return null;
  }
  return (
    preview.normalized_legs.find(
      (item) =>
        item.source_ref_id === draftLeg.source_ref_id &&
        item.leg_kind === draftLeg.leg_kind,
    ) ?? null
  );
}

function getCorrelationInsights(preview: ApiCompositionPreview | null): CorrelationInsight[] {
  if (!preview || preview.normalized_legs.length < 2) {
    return [];
  }
  const labelByKey = new Map(
    preview.normalized_legs.map((leg) => [
      leg.id,
      formatLegDisplayName({
        leg_kind: leg.leg_kind,
        display_name: leg.display_name,
        source_ref_id: leg.source_ref_id,
        config: leg.config,
      }),
    ]),
  );
  return preview.correlation_matrix
    .filter((cell) => cell.x_key !== cell.y_key)
    .filter((cell) => Math.abs(cell.correlation) >= 0.55)
    .map((cell): CorrelationInsight => ({
      key: buildMatrixKey(cell.x_key, cell.y_key),
      leftLabel: labelByKey.get(cell.x_key) ?? cell.x_key,
      rightLabel: labelByKey.get(cell.y_key) ?? cell.y_key,
      correlation: cell.correlation,
      tone: cell.correlation >= 0.7 ? 'warning' : 'accent',
    }))
    .filter((item, index, source) => source.findIndex((candidate) => candidate.key === item.key) === index)
    .sort((left, right) => Math.abs(right.correlation) - Math.abs(left.correlation))
    .slice(0, 4);
}

function getRiskContributionLabel(weightPct: number, contributionPct: number): string {
  if (contributionPct >= weightPct * 1.35) {
    return '风险占用偏高';
  }
  if (contributionPct <= Math.max(weightPct * 0.7, 1)) {
    return '风险贡献克制';
  }
  return '风险分布均衡';
}

function getTypeWeightSummary(legs: ApiCompositionLegInput[]): Array<{ label: string; total: number; kind: ApiLegType }> {
  const totals = new Map<ApiLegType, number>([
    ['strategy', 0],
    ['asset', 0],
    ['cash', 0],
  ]);
  legs.forEach((leg) => {
    totals.set(leg.leg_kind, (totals.get(leg.leg_kind) ?? 0) + clampWeight(leg.weight_pct));
  });
  return [
    { kind: 'strategy', label: '策略腿', total: totals.get('strategy') ?? 0 },
    { kind: 'asset', label: '资产腿', total: totals.get('asset') ?? 0 },
    { kind: 'cash', label: '现金腿', total: totals.get('cash') ?? 0 },
  ];
}

export function CompositionWorkbenchView({
  inventory,
  preview,
  compositionName,
  description,
  benchmarkLabel,
  rebalanceFrequency,
  selectedLegs,
  loading,
  previewLoading,
  saving,
  error,
  modeLabel,
  onCompositionNameChange,
  onDescriptionChange,
  onBenchmarkLabelChange,
  onRebalanceFrequencyChange,
  onAddLeg,
  onRemoveLeg,
  onWeightChange,
  onToggleLock,
  onPersist,
}: CompositionWorkbenchViewProps): JSX.Element {
  const [activeType, setActiveType] = useState<SourceFilter>('all');
  const [activeTag, setActiveTag] = useState<string>('all');
  const [searchValue, setSearchValue] = useState('');
  const [scoreOpen, setScoreOpen] = useState(true);
  const [returnWindow, setReturnWindow] = useState<ReturnWindow>('12m');
  const [highlightedPair, setHighlightedPair] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(searchValue.trim().toLowerCase());

  const rows = inventory?.rows ?? [];
  const tags = [...(inventory ? inventory.filters.attribute_tags : [])]
    .sort((left, right) => right.count - left.count)
    .slice(0, 3);
  const addedSourceIds = new Set(selectedLegs.map((leg) => leg.source_ref_id));
  const filteredRows = rows.filter((row) => {
    if (activeType !== 'all' && row.leg_type !== activeType) {
      return false;
    }
    if (activeTag !== 'all' && !row.attribute_tags.includes(activeTag)) {
      return false;
    }
    if (!deferredSearch) {
      return true;
    }
    const haystack = [
      row.name,
      row.version_label,
      getInventoryRowProofLabel(row),
      getInventoryRowReferenceLabel(row),
      ...row.attribute_tags.map((tag) => cleanDisplayText(tag) ?? formatTagLabel(tag)),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(deferredSearch);
  }).sort((left, right) => {
    const leftId = left.source_ref_id ?? left.id;
    const rightId = right.source_ref_id ?? right.id;
    const addedDelta = Number(addedSourceIds.has(rightId)) - Number(addedSourceIds.has(leftId));
    if (addedDelta !== 0) {
      return addedDelta;
    }
    return getSourceStatusPriority(right) - getSourceStatusPriority(left);
  });

  const selectedPreviewLegs = selectedLegs.map((leg) => ({
    draft: leg,
    preview: getPreviewLeg(leg, preview),
  }));
  const riskContributionMap = useMemo(() => {
    const map = new Map<string, number>();
    if (preview) {
      preview.risk_contribution_preview.forEach((item) => {
        map.set(item.leg_id, item.contribution_pct);
        map.set(item.label, item.contribution_pct);
        map.set(
          formatLegDisplayName({
            display_name: item.label,
          }),
          item.contribution_pct,
        );
      });
    }
    return map;
  }, [preview]);
  const correlationLookup = useMemo(
    () => buildCorrelationLookup(preview?.correlation_matrix ?? []),
    [preview?.correlation_matrix],
  );
  const correlationInsights = useMemo(() => getCorrelationInsights(preview), [preview]);
  const typeWeightSummary = useMemo(() => getTypeWeightSummary(selectedLegs), [selectedLegs]);
  const chartWindowSize = RETURN_WINDOW_OPTIONS.find((item) => item.value === returnWindow)?.points ?? 12;
  const chartSeries = preview ? preview.returns_preview.map((item) => item.cumulative_return_pct).slice(-chartWindowSize) : [];
  const benchmarkSeries = preview
    ? preview.benchmark_series.map((item) => item.cumulative_return_pct)
        .slice(-chartWindowSize)
    : [];
  const returnsPath = getChartPath(chartSeries, 640, 280);
  const returnsAreaPath = getChartAreaPath(chartSeries, 640, 280);
  const drawdownAreaPath = getDrawdownAreaPath(chartSeries, 640, 280);
  const benchmarkPath = getChartPath(benchmarkSeries, 640, 280);
  const previewScore = preview ? preview.composition_score : null;
  const previewFactors = previewScore ? previewScore.factors : [];
  const radarFactors = RADAR_AXIS_LABELS.map((label) => ({
    label,
    score: getRadarFactorScore(
      label,
      previewFactors,
      previewScore?.score ?? 78,
      preview?.maintenance_cost_summary.total_estimated_bps ?? 0,
    ),
  }));
  const previewWeightSummary = preview ? preview.weight_summary : null;
  const previewMaintenanceSummary = preview ? preview.maintenance_cost_summary : null;
  const previewWarnings = preview ? preview.warnings : [];
  const previewAdvisories = preview ? preview.advisories : [];
  const previewNormalizedLegs = preview ? preview.normalized_legs : [];
  const joinedCount = selectedLegs.length;
  const totalWeight = previewWeightSummary?.total_weight_pct ?? 0;
  const residualWeight = previewWeightSummary?.residual_weight_pct ?? 0;
  const lockedWeight =
    previewWeightSummary?.locked_weight_pct ??
    selectedLegs.reduce((sum, leg) => sum + (leg.weight_locked ? clampWeight(leg.weight_pct) : 0), 0);
  const cashWeight = typeWeightSummary.find((item) => item.kind === 'cash')?.total ?? 0;
  const scoreValue = previewScore?.score ?? 0;
  const scoreRingStyle = {
    '--score-deg': `${Math.max(0, Math.min(scoreValue, 100)) * 3.6}deg`,
  } as CSSProperties;
  const availableCount = rows.length;
  const compositionHeading = compositionName.trim()
    ? formatCompositionName({ name: compositionName, benchmarkLabel })
    : '组合工作台';
  const resolvedBenchmarkLabel = formatBenchmarkLabel(benchmarkLabel);
  const previewVerdict = formatCompositionVerdict(previewScore?.verdict);
  const warningItems = previewWarnings.map((item) => cleanDisplayText(item) ?? item);
  const advisoryItems = previewAdvisories.map((item) => cleanDisplayText(item) ?? item);
  const heroSourceTarget = joinedCount > 0 ? joinedCount : availableCount;
  const maintenanceCostBps = previewMaintenanceSummary?.total_estimated_bps ?? 0;
  const activeRebalanceLabel = getCadenceLabel(rebalanceFrequency);
  const activeRebalanceShortLabel = activeRebalanceLabel.replace('再平衡', '');
  const primaryCorrelationInsight = correlationInsights[0] ?? null;
  const sourceCredibilityText = `${previewNormalizedLegs.length || selectedLegs.length} 条腿已冻结快照，当前可以形成正式组合版本。`;
  const correlationReminderText = primaryCorrelationInsight
    ? `${primaryCorrelationInsight.leftLabel} 与 ${primaryCorrelationInsight.rightLabel} ${getCorrelationPairLabel(primaryCorrelationInsight.correlation)}，是当前最主要的相关性风险来源。`
    : '当前结构暂无显著相关性警报。';
  const maintenanceJudgementText = cashWeight > 0
    ? `现金腿 ${cashWeight.toFixed(1)}% 可覆盖${activeRebalanceShortLabel}维护成本，当前结构稳定。`
    : `${activeRebalanceLabel}需要补齐现金缓冲后再保存正式组合。`;

  return (
    <div
      className="composition-workbench-page stack"
      data-page-root="composition-workbench"
      data-route-root="compositions"
    >
      <section className="composition-workbench-hero">
        <div className="composition-workbench-hero__copy">
          <p className="page-heading__eyebrow">组合工作台</p>
          <h1>{compositionHeading}</h1>
          <p>通过来源库读取已验证的策略腿、资产腿与现金腿，在同一工作台完成权重、再平衡与结构诊断。</p>
        </div>
        <div className="composition-workbench-hero__actions">
          <button className="ghost-button" onClick={() => navigateTo('/compositions')} type="button">
            返回
          </button>
          <button
            aria-label="顶部保存草稿"
            className="ghost-button"
            disabled={saving || selectedLegs.length === 0}
            onClick={() => {
              void onPersist('DRAFT');
            }}
            type="button"
          >
            保存草稿
          </button>
          <button
            aria-label="顶部保存组合"
            className="primary-button"
            disabled={saving || selectedLegs.length === 0}
            onClick={() => {
              void onPersist('ACTIVE');
            }}
            type="button"
          >
            {saving ? '保存中…' : '保存组合'}
          </button>
        </div>
        <div className="composition-workbench-hero__chips">
          <span className="composition-workbench-chip composition-workbench-chip--accent">
            来源 {joinedCount} / {Math.max(joinedCount, heroSourceTarget)} 可用
          </span>
          <span className="composition-workbench-chip">{getCadenceLabel(rebalanceFrequency)}</span>
          <span className="composition-workbench-chip">
            基准 {resolvedBenchmarkLabel}
          </span>
          {modeLabel ? (
            <span className="composition-workbench-chip">{modeLabel}</span>
          ) : null}
          {previewLoading ? (
            <span className="composition-workbench-chip">收益流预演更新中</span>
          ) : null}
        </div>
      </section>

      {error ? (
        <div className="error-banner" role="alert">
          {error}
        </div>
      ) : null}

      <div className="composition-workbench-main-grid">
        <section className="panel composition-workbench-panel composition-workbench-source-panel">
          <div className="panel-header composition-workbench-panel__header">
            <div>
              <h2>来源库</h2>
              <p className="composition-workbench-panel__copy">
                按相关性、收益特征与来源状态筛选候选腿，控制重复暴露并优化组合分散度。
              </p>
            </div>
            <span className="status-chip status-chip--soft">
              {rows.length} 条来源
            </span>
          </div>

          <article className="composition-workbench-recommendation-panel">
            <div className="composition-workbench-recommendation-panel__copy">
              <strong>主动推荐</strong>
              <span>结合相关性、冻结状态与近期表现推荐候选来源，优先补充分散化有效的腿部对象。</span>
            </div>
            <div className="composition-workbench-recommendation-list">
              <div className="composition-workbench-recommendation-item">
                <div>
                  <strong>低相关补位候选</strong>
                  <span>优先考虑低相关债券腿或现金缓冲，避免结构集中暴露。</span>
                </div>
                <span className="status-chip status-chip--success">推荐</span>
              </div>
              <div className="composition-workbench-recommendation-item">
                <div>
                  <strong>当前已加入 {joinedCount} 条来源</strong>
                  <span>左侧列表会自动把已加入对象切换到已加入状态，避免重复装配。</span>
                </div>
                <span className="status-chip status-chip--soft">已同步</span>
              </div>
            </div>
          </article>

          <div className="composition-workbench-toolbar">
            <div className="composition-workbench-filter-row" role="tablist" aria-label="来源类型">
              {(
                [
                  { key: 'all', label: '全部' },
                  { key: 'strategy', label: '策略腿' },
                  { key: 'asset', label: '资产腿' },
                  { key: 'cash', label: '现金腿' },
                ] as Array<{ key: SourceFilter; label: string }>
              ).map((item) => (
                <button
                  aria-selected={activeType === item.key}
                  className={activeType === item.key ? 'composition-workbench-filter composition-workbench-filter--active' : 'composition-workbench-filter'}
                  key={item.key}
                  onClick={() => setActiveType(item.key)}
                  role="tab"
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
            {tags.length ? (
              <div className="composition-workbench-filter-row" aria-label="属性标签">
                <button
                  className={activeTag === 'all' ? 'composition-workbench-filter composition-workbench-filter--active' : 'composition-workbench-filter'}
                  onClick={() => setActiveTag('all')}
                  type="button"
                >
                  常用标签
                </button>
                {tags.map((tag) => (
                  <button
                    className={activeTag === tag.value ? 'composition-workbench-filter composition-workbench-filter--active' : 'composition-workbench-filter'}
                    key={tag.value}
                    onClick={() => setActiveTag(tag.value)}
                    type="button"
                  >
                    {formatTagLabel(tag.value || cleanDisplayText(tag.label) || '')}
                  </button>
                ))}
              </div>
            ) : null}
            <input
              aria-label="搜索来源库"
              className="composition-workbench-search"
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="搜索名称、来源状态、回测 ID、属性标签或快照字段..."
              value={searchValue}
            />
          </div>

          <div className="composition-workbench-source-scroll composition-workbench-source-scroll--four-cards" aria-label="来源库候选策略滚动区" role="region">
            <div className="composition-workbench-source-list">
              {loading ? (
                <div className="composition-workbench-empty">正在加载来源库…</div>
              ) : filteredRows.length === 0 ? (
                <div className="composition-workbench-empty">当前筛选下没有可加入的来源。</div>
              ) : (
                filteredRows.map((row) => {
                  const added = addedSourceIds.has(row.source_ref_id ?? row.id);
                  const rowDisplayName = getInventoryRowDisplayName(row);
                  const rowReferenceLabel = getInventoryRowReferenceLabel(row);
                  const rowProofLabel = getInventoryRowProofLabel(row);
                  return (
                    <article className={added ? 'composition-workbench-source-card is-added' : 'composition-workbench-source-card'} key={row.id}>
                      <div className="composition-workbench-source-card__top">
                        <div>
                          <div className="composition-workbench-source-card__chips">
                            <span className={getLegTypeClassName(row.leg_type)}>
                              {getLegTypeLabel(row.leg_type)}
                            </span>
                            <span className="composition-workbench-chip">
                              {getRowStatusLabel(row.status)}
                            </span>
                          </div>
                          <strong>{rowDisplayName}</strong>
                          <p>{rowReferenceLabel}</p>
                        </div>
                        <button
                          className={added ? 'ghost-button composition-workbench-add-button is-added' : 'ghost-button composition-workbench-add-button'}
                          disabled={added}
                          onClick={() => onAddLeg(row)}
                          type="button"
                        >
                          {added ? '已加入' : '加入结构'}
                        </button>
                      </div>
                      <div className="composition-workbench-source-card__meta">
                        <span>{row.version_label || '版本待确认'}</span>
                        <span>{rowProofLabel}</span>
                      </div>
                      <div className="composition-workbench-source-card__tags">
                        {row.attribute_tags.slice(0, 3).map((tag) => (
                          <span className="composition-workbench-chip" key={tag}>
                            {formatTagLabel(tag)}
                          </span>
                        ))}
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>
        </section>

        <section className="panel composition-workbench-panel">
          <div className="panel-header composition-workbench-panel__header">
            <div>
              <h2>组合结构</h2>
              <p className="composition-workbench-panel__copy">
                在结构层同时观察权重分布、风险贡献与相关性预警，判断组合是否存在隐性集中暴露。
              </p>
            </div>
            <span className="status-chip status-chip--soft">
              共 {selectedLegs.length} 条腿
            </span>
          </div>

          <div className="composition-workbench-allocation-box">
            <div className="composition-workbench-allocation-box__header">
              <div>
                <h3>当前结构总览</h3>
                <p className="composition-workbench-panel__copy">
                  汇总总权重、锁定权重与现金占比，为再分配和再平衡设置提供基准。
                </p>
              </div>
              <span className="status-chip status-chip--success">
                {previewWeightSummary?.within_tolerance ? '权重闭合' : '待调权重'}
              </span>
            </div>
            <div className="composition-workbench-allocation-track" aria-hidden="true">
              {typeWeightSummary.map((item) => (
                <span
                  className={`composition-workbench-allocation-track__fill composition-workbench-allocation-track__fill--${item.kind}`}
                  key={item.kind}
                  style={{ width: `${Math.min(Math.max(item.total, 0), 100)}%` }}
                />
              ))}
            </div>
            <div className="composition-workbench-allocation-legend" aria-label="当前结构比例图标注">
              {typeWeightSummary.map((item) => (
                <span
                  className={`composition-workbench-legend-tag composition-workbench-legend-tag--${item.kind}`}
                  key={item.kind}
                >
                  {item.label} {item.total.toFixed(1)}%
                </span>
              ))}
            </div>
            <div className="composition-workbench-structure-summary">
              {typeWeightSummary.map((item) => (
                <article className="composition-workbench-summary-card" key={item.kind}>
                  <span>{item.label}</span>
                  <strong>{item.total.toFixed(1)}%</strong>
                  <div className="composition-workbench-summary-card__bar">
                    <span
                      className={`composition-workbench-summary-card__bar-fill composition-workbench-summary-card__bar-fill--${item.kind}`}
                      style={{ width: `${Math.min(item.total, 100)}%` }}
                    />
                  </div>
                </article>
              ))}
            </div>
            <div className="composition-workbench-hero__chips composition-workbench-hero__chips--tight">
              <span className="composition-workbench-chip">总权重 {totalWeight.toFixed(1)}%</span>
              <span className="composition-workbench-chip">锁定 {lockedWeight.toFixed(1)}%</span>
              <span className="composition-workbench-chip">现金 {cashWeight.toFixed(1)}%</span>
              <span className="composition-workbench-chip">
                残余 {residualWeight.toFixed(1)}%
              </span>
              <span className="composition-workbench-chip">相关性提醒 {correlationInsights.length} 条</span>
              <span className="composition-workbench-chip">维护成本 {previewMaintenanceSummary?.total_estimated_bps ?? 0} bps</span>
            </div>
          </div>

          <div className="composition-workbench-structure-list">
            {selectedPreviewLegs.length === 0 ? (
              <div className="composition-workbench-empty">
                先从左侧来源库加入至少一条腿，再开始配置权重与维护节奏。
              </div>
            ) : (
              selectedPreviewLegs.map(({ draft, preview: previewLeg }) => {
                const previewLegName = getPreviewLegDisplayName(previewLeg, draft);
                const previewLegProof = getPreviewLegProofText(previewLeg, draft);
                const riskContribution =
                  riskContributionMap.get(previewLeg?.id ?? '') ??
                  riskContributionMap.get(previewLegName) ??
                  0;
                const correlationAlert = correlationInsights.find((item) =>
                  item.key.includes(previewLeg?.id ?? draft.source_ref_id),
                );
                const highlighted =
                  highlightedPair &&
                  highlightedPair.includes(previewLeg?.id ?? draft.source_ref_id);
                const riskIsElevated = riskContribution >= clampWeight(draft.weight_pct) * 1.2;
                const legCardClassName = [
                  'composition-workbench-leg-card',
                  highlighted ? 'is-highlighted' : '',
                  draft.weight_locked ? 'composition-workbench-leg-card--focus' : '',
                  riskIsElevated ? 'composition-workbench-leg-card--pulse' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <article
                    className={legCardClassName}
                    key={draft.source_ref_id}
                  >
                    <div className="composition-workbench-leg-card__top">
                      <div>
                        <div className="composition-workbench-source-card__chips">
                          <span className={getLegTypeClassName(draft.leg_kind)}>
                            {getLegTypeLabel(draft.leg_kind)}
                          </span>
                          {previewLeg ? (
                            <span className="composition-workbench-chip">
                              {formatCompositionStatusLabel(previewLeg.status, previewLeg.status_label)}
                            </span>
                          ) : null}
                          {draft.weight_locked ? (
                            <span className="composition-workbench-chip composition-workbench-chip--accent">
                              已锁定
                            </span>
                          ) : null}
                        </div>
                        <strong>{previewLegName}</strong>
                        <p>
                          {previewLegProof || '等待收益流预演'}
                          {correlationAlert ? ` · ${getCorrelationPairLabel(correlationAlert.correlation)}` : ''}
                        </p>
                      </div>
                      <div className="composition-workbench-leg-card__actions">
                        <button
                          className={draft.weight_locked ? 'ghost-button composition-workbench-lock composition-workbench-lock--active' : 'ghost-button composition-workbench-lock'}
                          onClick={() => onToggleLock(draft.source_ref_id)}
                          type="button"
                        >
                          {draft.weight_locked ? '解锁权重' : '锁定权重'}
                        </button>
                        <button
                          className="ghost-button composition-workbench-remove"
                          onClick={() => onRemoveLeg(draft.source_ref_id)}
                          type="button"
                        >
                          移除
                        </button>
                      </div>
                    </div>

                    <div className="composition-workbench-weight-box">
                      <div className="composition-workbench-weight-box__head">
                        <span>当前权重</span>
                        <strong>{clampWeight(draft.weight_pct).toFixed(1)}%</strong>
                      </div>
                      <div className="composition-workbench-weight-box__subrow">
                        <span>{draft.weight_locked ? '锁定后其余腿自动再分配' : '动态分配中'}</span>
                        <span className={draft.weight_locked ? 'composition-workbench-lock-chip' : undefined}>
                          {draft.weight_locked ? '锁定权重' : '未锁定'}
                        </span>
                      </div>
                      <label className="composition-workbench-weight-track">
                        <span className="composition-workbench-sr-only">当前权重</span>
                        <input
                          max={100}
                          min={0}
                          onChange={(event) => onWeightChange(draft.source_ref_id, Number(event.target.value))}
                          step={0.5}
                          type="range"
                          value={clampWeight(draft.weight_pct)}
                        />
                        <span
                          className={`composition-workbench-weight-track__fill composition-workbench-weight-track__fill--${draft.leg_kind}`}
                          style={{ width: `${Math.min(clampWeight(draft.weight_pct), 100)}%` }}
                        />
                      </label>
                      <div className="composition-workbench-weight-box__risk-row">
                        <span>风险贡献 {riskContribution.toFixed(1)}%</span>
                        <span>{getRiskContributionLabel(clampWeight(draft.weight_pct), riskContribution)}</span>
                      </div>
                      <div className={riskIsElevated ? 'composition-workbench-risk-bar' : 'composition-workbench-risk-bar composition-workbench-risk-bar--low'}>
                        <span
                          className={riskContribution >= clampWeight(draft.weight_pct) * 1.35 ? 'composition-workbench-risk-bar__fill composition-workbench-risk-bar__fill--warning' : 'composition-workbench-risk-bar__fill'}
                          style={{ width: `${Math.min(Math.max(riskContribution, 4), 100)}%` }}
                        />
                      </div>
                    </div>

                    <div className="composition-workbench-weight-row">
                      <label className="composition-workbench-field composition-workbench-field--weight">
                        <span>权重</span>
                        <input
                          max={100}
                          min={0}
                          onChange={(event) => onWeightChange(draft.source_ref_id, Number(event.target.value))}
                          step={0.5}
                          type="range"
                          value={clampWeight(draft.weight_pct)}
                        />
                      </label>
                      <label className="composition-workbench-field composition-workbench-field--compact">
                        <span>输入</span>
                        <input
                          max={100}
                          min={0}
                          onChange={(event) => onWeightChange(draft.source_ref_id, Number(event.target.value))}
                          step={0.5}
                          type="number"
                          value={clampWeight(draft.weight_pct)}
                        />
                      </label>
                    </div>

                    <div className="composition-workbench-risk-row">
                      <div className="composition-workbench-risk-row__copy">
                        <span>风险贡献</span>
                        <strong>{riskContribution.toFixed(1)}%</strong>
                        <small>{getRiskContributionLabel(clampWeight(draft.weight_pct), riskContribution)}</small>
                      </div>
                      <div className="composition-workbench-risk-bar">
                        <span
                          className={riskContribution >= clampWeight(draft.weight_pct) * 1.35 ? 'composition-workbench-risk-bar__fill composition-workbench-risk-bar__fill--warning' : 'composition-workbench-risk-bar__fill'}
                          style={{ width: `${Math.min(Math.max(riskContribution, 4), 100)}%` }}
                        />
                      </div>
                    </div>

                    {previewLeg && previewLeg.attribute_tags.length ? (
                      <div className="composition-workbench-source-card__tags">
                        {previewLeg.attribute_tags.slice(0, 4).map((tag) => (
                          <span className="composition-workbench-chip" key={tag}>
                            {formatTagLabel(tag)}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })
            )}
          </div>
        </section>

        <aside className="panel composition-workbench-summary-rail">
          <div className="panel-header composition-workbench-panel__header">
            <div>
              <h2>摘要与诊断</h2>
              <p className="composition-workbench-panel__copy">
                集中呈现成立性、相关性与维护成本判断，作为正式保存前的最终复核区。
              </p>
            </div>
          </div>

          <label className="composition-workbench-field composition-workbench-config-field">
            <span>组合名称</span>
            <input
              onChange={(event) => onCompositionNameChange(event.target.value)}
              placeholder="例如：平衡收益组合"
              value={compositionName}
            />
          </label>

          <label className="composition-workbench-field composition-workbench-config-field">
            <span>组合描述</span>
            <input
              onChange={(event) => onDescriptionChange(event.target.value)}
              placeholder="概括来源构成、再平衡节奏与账户目标。"
              value={description}
            />
          </label>

          <article className="composition-workbench-score composition-workbench-score-card">
            <div className="panel-header composition-workbench-score-card__header">
              <div>
                <h3>成立性评分</h3>
                <p className="composition-workbench-panel__copy">
                  评分覆盖分散度、来源可信度、成本控制与收益增强，用于衡量当前结构的可落地性。
                </p>
              </div>
            </div>
            <div className="composition-workbench-score-card__hero">
              <button
                className="composition-workbench-score-ring score-ring score-ring--interactive"
                onClick={() => setScoreOpen((current) => !current)}
                style={scoreRingStyle}
                type="button"
              >
                <strong>{formatRatio(scoreValue)}</strong>
              </button>
              <div className="composition-workbench-score-card__chips">
                <span className="composition-workbench-chip composition-workbench-chip--accent">{previewVerdict}</span>
                <span className="composition-workbench-chip">{correlationInsights.length} 条相关性提醒</span>
                <span className="composition-workbench-chip">维护成本 {previewMaintenanceSummary?.total_estimated_bps ?? 0} bps</span>
              </div>
            </div>
            <span className="composition-workbench-score-footnote">
              基于最近 24 个月收益流代理与当前协方差矩阵计算。
            </span>
          </article>

          {scoreOpen ? (
            <article className="composition-workbench-radar-card">
              <div className="composition-workbench-radar-card__head">
                <strong>评分拆解</strong>
                <span>评分拆解显示分散度与收益增强是当前主要扣分项。</span>
              </div>
              <div className="composition-workbench-radar-layout">
                <svg className="composition-workbench-radar-svg" viewBox="0 0 100 100" aria-label="成立性评分五边形图">
                  <polygon
                    className="composition-workbench-radar-axis"
                    points={getRadarAxisPoints()}
                  />
                  {RADAR_AXIS_LABELS.map((_, index) => {
                    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / RADAR_AXIS_LABELS.length;
                    return (
                      <line
                        className="composition-workbench-radar-line"
                        key={`axis-${index}`}
                        x1="50"
                        x2={(50 + Math.cos(angle) * 42).toFixed(2)}
                        y1="50"
                        y2={(50 + Math.sin(angle) * 42).toFixed(2)}
                      />
                    );
                  })}
                  <polygon
                    className="composition-workbench-radar-fill"
                    points={getRadarPoints(radarFactors.map((factor) => factor.score))}
                  />
                </svg>
                <div className="composition-workbench-radar-list">
                  {radarFactors.map((factor) => (
                    <div className="composition-workbench-radar-item" key={factor.label}>
                      <span>{factor.label}</span>
                      <strong>{formatRatio(factor.score)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          ) : null}

          <article className="composition-workbench-summary-card composition-workbench-rebalance-card">
            <div className="panel-header composition-workbench-panel__header">
              <div>
                <h3>再平衡频次</h3>
                <p className="composition-workbench-panel__copy">
                  不同频次对应不同换手成本与现金缓冲需求，用于评估维护节奏是否匹配当前组合。
                </p>
              </div>
            </div>
            <div className="composition-workbench-filter-row composition-workbench-rebalance-options" role="group" aria-label="再平衡频次">
              {REBALANCE_OPTIONS.map((item) => (
                <button
                  aria-pressed={rebalanceFrequency === item.value}
                  className={rebalanceFrequency === item.value ? 'composition-workbench-filter composition-workbench-filter--active' : 'composition-workbench-filter'}
                  key={item.value}
                  onClick={() => onRebalanceFrequencyChange(item.value)}
                  type="button"
                >
                  {item.label.replace('再平衡', '')}
                </button>
              ))}
            </div>
            <span className="composition-workbench-score-footnote">
              当前采用{activeRebalanceLabel}，预计维护成本 {maintenanceCostBps} bps，现金腿可承接当前换手。
            </span>
          </article>

          <article className="composition-workbench-summary-card composition-workbench-summary-lines" aria-label="摘要区字段">
            <div className="composition-workbench-summary-line">
              <span>当前权重合计</span>
              <strong>{totalWeight.toFixed(1)}%</strong>
            </div>
            <div className="composition-workbench-summary-line">
              <span>锁定权重</span>
              <strong>{lockedWeight.toFixed(1)}%</strong>
            </div>
            <div className="composition-workbench-summary-line">
              <span>预计维护成本</span>
              <strong>{maintenanceCostBps} bps</strong>
            </div>
            <div className="composition-workbench-summary-line">
              <span>现金占比</span>
              <strong>{cashWeight.toFixed(1)}%</strong>
            </div>
          </article>

          <div className="composition-workbench-warning-list">
            {primaryCorrelationInsight ? (
              <button
                className="composition-workbench-warning-item composition-workbench-warning-item--interactive"
                onClick={() => setHighlightedPair((current) => (current === primaryCorrelationInsight.key ? null : primaryCorrelationInsight.key))}
                type="button"
              >
                <strong>相关性提醒</strong>
                <span>{correlationReminderText}</span>
              </button>
            ) : (
              <div className="composition-workbench-warning-item">
                <strong>相关性提醒</strong>
                <span>{correlationReminderText}</span>
              </div>
            )}
            <div className="composition-workbench-warning-item">
              <strong>来源可信度</strong>
              <span>{sourceCredibilityText}</span>
            </div>
            <div className="composition-workbench-warning-item">
              <strong>维护判断</strong>
              <span>{maintenanceJudgementText}</span>
            </div>
          </div>

          <label className="composition-workbench-field composition-workbench-benchmark-field composition-workbench-config-field">
            <span>基准说明</span>
            <input
              onChange={(event) => onBenchmarkLabelChange(event.target.value)}
              placeholder="例如：60/40 参考组合"
              value={benchmarkLabel}
            />
          </label>

          {(warningItems.length || advisoryItems.length) ? (
            <div className="composition-workbench-advisories composition-workbench-config-field">
              {warningItems.length ? (
                <article className="composition-workbench-callout composition-workbench-callout--warning">
                  <strong>风险提示</strong>
                  <ul>
                    {warningItems.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </article>
              ) : null}
              {advisoryItems.length ? (
                <article className="composition-workbench-callout">
                  <strong>组合建议</strong>
                  <ul>
                    {advisoryItems.map((advisory) => (
                      <li key={advisory}>{advisory}</li>
                    ))}
                  </ul>
                </article>
              ) : null}
            </div>
          ) : null}

          <div className="composition-workbench-save-dock composition-workbench-save-dock--module-bottom">
            <span className="composition-workbench-save-dock__note">
              保存区持续可见，便于在结构复核完成后立即提交当前组合版本。
            </span>
            <div className="composition-workbench-save-dock__actions">
              <button
                className="ghost-button"
                disabled={saving || selectedLegs.length === 0}
                onClick={() => {
                  void onPersist('DRAFT');
                }}
                type="button"
              >
                保存草稿
              </button>
              <button
                className="primary-button"
                disabled={saving || selectedLegs.length === 0}
                onClick={() => {
                  void onPersist('ACTIVE');
                }}
                type="button"
              >
                {saving ? '保存中…' : '保存组合'}
              </button>
            </div>
          </div>
        </aside>
      </div>

      <div className="composition-workbench-preview-grid">
        <section className="panel composition-workbench-panel">
          <div className="panel-header composition-workbench-panel__header">
            <div>
              <h2>收益流预览</h2>
              <p className="composition-workbench-panel__copy">
                用于保存前核对组合收益路径、基准偏离与回撤段落，不替代完整绩效分析。
              </p>
            </div>
          </div>

          <div className="composition-workbench-filter-row composition-workbench-return-window-row" aria-label="收益流时间段">
            {RETURN_WINDOW_OPTIONS.map((item) => (
              <button
                aria-pressed={returnWindow === item.value}
                className={returnWindow === item.value ? 'composition-workbench-filter composition-workbench-filter--active' : 'composition-workbench-filter'}
                key={item.value}
                onClick={() => setReturnWindow(item.value)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="composition-workbench-chart-legend">
            <span>基准：{resolvedBenchmarkLabel}</span>
            <span>回撤阴影用于识别当前结构在近期路径中的脆弱区间</span>
          </div>

          <div className="composition-workbench-chart-frame">
            <svg
              aria-label="组合收益流预览"
              className="composition-workbench-line-chart"
              viewBox="0 0 640 280"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="compositionWorkbenchReturnFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="rgba(31, 135, 123, 0.18)" />
                  <stop offset="100%" stopColor="rgba(31, 135, 123, 0)" />
                </linearGradient>
                <linearGradient id="compositionWorkbenchDrawdownFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="rgba(196, 92, 79, 0.18)" />
                  <stop offset="100%" stopColor="rgba(196, 92, 79, 0)" />
                </linearGradient>
              </defs>
              <line className="composition-workbench-grid-line" x1="18" x2="622" y1="248" y2="248" />
              <line className="composition-workbench-grid-line" x1="18" x2="18" y1="18" y2="248" />
              {returnsAreaPath ? (
                <path
                  className="composition-workbench-return-area"
                  d={returnsAreaPath}
                />
              ) : null}
              {drawdownAreaPath ? (
                <path
                  className="composition-workbench-drawdown-area"
                  d={drawdownAreaPath}
                />
              ) : null}
              {benchmarkPath ? (
                <path
                  className="composition-workbench-benchmark-path"
                  d={benchmarkPath}
                />
              ) : null}
              {returnsPath ? (
                <path
                  className="composition-workbench-returns-path"
                  d={returnsPath}
                />
              ) : null}
            </svg>
          </div>

          <div className="composition-workbench-legend">
            <span className="composition-workbench-legend__item composition-workbench-legend__item--strategy">
              组合累计收益
            </span>
            <span className="composition-workbench-legend__item composition-workbench-legend__item--benchmark">
              基准虚线
            </span>
            <span className="composition-workbench-legend__item composition-workbench-legend__item--drawdown">
              回撤阴影
            </span>
          </div>
        </section>

        <section className="panel composition-workbench-panel">
          <div className="panel-header composition-workbench-panel__header">
            <div>
              <h2>相关性预览</h2>
              <p className="composition-workbench-panel__copy">
                用矩阵做结构体检。腿数在 6 条以内保留数值，方便快速识别高相关或对冲关系。
              </p>
            </div>
          </div>

          {previewNormalizedLegs.length ? (
            <div className="composition-workbench-correlation-matrix">
              <div className="composition-workbench-correlation-header">
                <span />
                {previewNormalizedLegs.map((leg) => (
                  <span key={`head-${leg.id}`}>
                    {formatLegDisplayName({
                      leg_kind: leg.leg_kind,
                      display_name: leg.display_name,
                      source_ref_id: leg.source_ref_id,
                      config: leg.config,
                    })}
                  </span>
                ))}
              </div>
              {previewNormalizedLegs.map((row) => (
                <div className="composition-workbench-correlation-row" key={row.id}>
                  <span>
                    {formatLegDisplayName({
                      leg_kind: row.leg_kind,
                      display_name: row.display_name,
                      source_ref_id: row.source_ref_id,
                      config: row.config,
                    })}
                  </span>
                  {previewNormalizedLegs.map((column) => {
                    const value = correlationLookup.get(buildMatrixKey(row.id, column.id)) ?? 0;
                    const cellKey = buildMatrixKey(row.id, column.id);
                    const active = highlightedPair === cellKey;
                    return (
                      <button
                        className={`${getCorrelationToneClass(value)}${active ? ' is-active' : ''}`}
                        key={cellKey}
                        onClick={() => setHighlightedPair((current) => (current === cellKey ? null : cellKey))}
                        type="button"
                      >
                        {previewNormalizedLegs.length <= 6 ? value.toFixed(2) : ''}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <div className="composition-workbench-empty">待预演结果返回后展示相关性矩阵。</div>
          )}
        </section>
      </div>
    </div>
  );
}

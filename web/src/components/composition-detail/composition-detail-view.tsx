import { useMemo, useState } from 'react';
import { navigateTo } from '../../lib/appRouteContext';
import { formatDateTime, formatRatio } from '../../lib/format';
import {
  cleanDisplayText,
  formatComposePercent,
  formatCompositionHeroCopy,
  formatCompositionKpiLabel,
  formatCompositionName,
  formatLegDisplayName,
} from '../../lib/compose-display';
import type {
  ApiCompositionCorrelationCell,
  ApiCompositionDetail,
  ApiCompositionKpi,
  ApiCompositionRiskContribution,
  ApiCompositionSourceFreeze,
} from '../../types';
import './composition-detail.css';

type PerformanceMode = 'cumulative' | 'spread';
type CorrelationMode = 'current' | 'stress';

type CompositionDetailViewProps = {
  detail: ApiCompositionDetail | null;
  loading?: boolean;
  error?: string | null;
  approvedPreview?: boolean;
};

function getToneClassName(tone?: string | null): string {
  switch (String(tone || '').toLowerCase()) {
    case 'positive':
    case 'success':
      return 'composition-detail-kpi-card__insight composition-detail-kpi-card__insight--positive';
    case 'warning':
    case 'warm':
      return 'composition-detail-kpi-card__insight composition-detail-kpi-card__insight--warning';
    case 'critical':
    case 'danger':
      return 'composition-detail-kpi-card__insight composition-detail-kpi-card__insight--critical';
    case 'blue':
      return 'composition-detail-kpi-card__insight composition-detail-kpi-card__insight--blue';
    default:
      return 'composition-detail-kpi-card__insight composition-detail-kpi-card__insight--neutral';
  }
}

function getPoint(index: number, total: number, value: number, min: number, max: number, width: number, height: number, padding = 18): { x: number; y: number } {
  const range = max - min || 1;
  const x = padding + (index / Math.max(total - 1, 1)) * (width - padding * 2);
  const y = height - padding - ((value - min) / range) * (height - padding * 2);
  return { x, y };
}

function buildLinePath(values: number[], width: number, height: number, min?: number, max?: number): string {
  if (!values.length) {
    return '';
  }
  const domainMin = min ?? Math.min(...values);
  const domainMax = max ?? Math.max(...values);
  return values
    .map((value, index) => {
      const point = getPoint(index, values.length, value, domainMin, domainMax, width, height);
      return `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    })
    .join(' ');
}

function buildAreaPath(values: number[], width: number, height: number, baselineValue: number, min: number, max: number): string {
  if (!values.length) {
    return '';
  }
  const line = buildLinePath(values, width, height, min, max);
  const start = getPoint(0, values.length, baselineValue, min, max, width, height);
  const end = getPoint(values.length - 1, values.length, baselineValue, min, max, width, height);
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} ${line.slice(1)} L ${end.x.toFixed(2)} ${end.y.toFixed(2)} Z`;
}

function buildMatrixKey(left: string, right: string): string {
  return [left, right].sort().join('::');
}

function getCorrelationClassName(value: number): string {
  if (value >= 0.7) {
    return 'composition-detail-matrix-cell composition-detail-matrix-cell--high';
  }
  if (value <= -0.2) {
    return 'composition-detail-matrix-cell composition-detail-matrix-cell--inverse';
  }
  if (Math.abs(value) <= 0.25) {
    return 'composition-detail-matrix-cell composition-detail-matrix-cell--low';
  }
  return 'composition-detail-matrix-cell composition-detail-matrix-cell--mid';
}

function getEvidenceKindLabel(value: string): string {
  switch (value) {
    case 'strategy_projection':
      return '策略投影冻结';
    case 'asset_snapshot':
      return '资产快照冻结';
    default:
      return '来源冻结';
  }
}

function getCadenceLabel(value?: string | null): string {
  switch (String(value || '').toLowerCase()) {
    case 'monthly':
      return '月度再平衡';
    case 'quarterly':
      return '季度再平衡';
    case 'semiannual':
      return '半年再平衡';
    case 'annual':
      return '年度再平衡';
    default:
      return '维护节奏待确认';
  }
}

function getIntervalDays(value?: string | null): number {
  switch (String(value || '').toLowerCase()) {
    case 'monthly':
      return 30;
    case 'quarterly':
      return 90;
    case 'semiannual':
      return 182;
    case 'annual':
      return 365;
    default:
      return 90;
  }
}

function getDaysSince(value: string): number {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) {
    return 0;
  }
  const current = Date.now();
  return Math.max(0, Math.floor((current - then) / (1000 * 60 * 60 * 24)));
}

function getStressCorrelation(value: number): number {
  if (value >= 0) {
    return Math.min(1, value * 0.65 + 0.25);
  }
  return Number((value * 0.55).toFixed(2));
}

function getDisplayText(value?: string | null, fallback = '待确认'): string {
  return cleanDisplayText(value) ?? fallback;
}

function getNarrativeText(value?: string | null, fallback = '待确认'): string {
  const text = cleanDisplayText(value);
  if (!text) {
    return fallback;
  }
  if (/^cadence modeled as quarterly\.?$/i.test(text)) {
    return '当前按季度再平衡节奏建模。';
  }
  if (
    /^phase 1 analytics are deterministic placeholders when live composition analytics are unavailable\.?$/i.test(
      text,
    )
  ) {
    return '当实时组合分析暂不可用时，这里先展示第一阶段的确定性占位分析。';
  }
  if (
    /^scenario outputs are deterministic phase 1 approximations built from sleeve mix and cadence\.?$/i.test(
      text,
    )
  ) {
    return '情景输出当前采用第一阶段近似值，基于腿结构配比与再平衡节奏推导。';
  }
  return text;
}

function formatKpiValue(kpi: ApiCompositionKpi): string {
  if (typeof kpi.value === 'string') {
    return getDisplayText(kpi.value);
  }

  switch (kpi.key) {
    case 'annualized_return':
    case 'volatility':
    case 'tracking_spread':
    case 'locked_weight':
    case 'residual_weight':
      return formatComposePercent(kpi.value);
    case 'max_drawdown':
      return formatComposePercent(kpi.value, { forceNegative: true });
    case 'estimated_cost':
    case 'cash_buffer':
      return `${Number(kpi.value).toFixed(Math.abs(kpi.value) >= 10 ? 0 : 1)} bps`;
    case 'leg_count':
      return `${Math.round(kpi.value)}`;
    default:
      return formatRatio(kpi.value);
  }
}

function formatKpiDetail(kpi: ApiCompositionKpi): string {
  return getDisplayText(kpi.detail, '维持当前组合口径。');
}

function getScenarioLabel(value: unknown, fallback: string): string {
  return getDisplayText(typeof value === 'string' ? value : null, fallback);
}

function getScenarioDrawdown(value: unknown): string {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return formatComposePercent(numeric, { forceNegative: true });
}

function buildCorrelationLookup(cells: ApiCompositionCorrelationCell[], mode: CorrelationMode): Map<string, number> {
  return new Map(
    cells.map((cell) => [
      buildMatrixKey(cell.x_key, cell.y_key),
      mode === 'stress' ? getStressCorrelation(cell.correlation) : cell.correlation,
    ]),
  );
}

function getHighCorrelationPairs(detail: ApiCompositionDetail, mode: CorrelationMode): Array<{ key: string; label: string; value: number }> {
  const labelLookup = new Map(
    detail.normalized_legs.map((leg) => [
      leg.id,
      formatLegDisplayName({
        leg_kind: leg.leg_kind,
        display_name: leg.display_name,
        source_ref_id: leg.source_ref_id,
        config: leg.config,
      }),
    ]),
  );
  return detail.correlation_matrix
    .filter((cell) => cell.x_key !== cell.y_key)
    .map((cell) => {
      const value = mode === 'stress' ? getStressCorrelation(cell.correlation) : cell.correlation;
      return {
        key: buildMatrixKey(cell.x_key, cell.y_key),
        label: `${labelLookup.get(cell.x_key) ?? cell.x_key} / ${labelLookup.get(cell.y_key) ?? cell.y_key}`,
        value,
      };
    })
    .filter((item) => item.value >= 0.7)
    .filter((item, index, source) => source.findIndex((candidate) => candidate.key === item.key) === index)
    .sort((left, right) => right.value - left.value)
    .slice(0, 4);
}

function getRiskFlag(item: ApiCompositionRiskContribution): string {
  if (item.contribution_pct >= item.weight_pct * 1.35) {
    return '风险占用偏高';
  }
  if (item.contribution_pct <= Math.max(item.weight_pct * 0.7, 1)) {
    return '风险效率较高';
  }
  return '权重与风险接近';
}

function getScatterPoint(
  item: ApiCompositionRiskContribution,
  volatilityRange: { min: number; max: number },
  contributionRange: { min: number; max: number },
): { x: number; y: number } {
  const width = 360;
  const height = 260;
  const padding = 28;
  const xRange = volatilityRange.max - volatilityRange.min || 1;
  const yRange = contributionRange.max - contributionRange.min || 1;
  const x = padding + ((item.volatility_pct - volatilityRange.min) / xRange) * (width - padding * 2);
  const y =
    height -
    padding -
    ((item.contribution_pct - contributionRange.min) / yRange) * (height - padding * 2);
  return { x, y };
}

function getDrawerRows(evidence: ApiCompositionSourceFreeze): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ['冻结类型', getEvidenceKindLabel(evidence.freeze_ref_type)],
    ['冻结标识', evidence.freeze_ref_id],
    ['哈希摘要', evidence.freeze_hash],
    ['捕获时间', formatDateTime(evidence.captured_at)],
  ];
  Object.entries(evidence.snapshot ?? {}).forEach(([key, value]) => {
    rows.push([key.replace(/_/g, ' '), getDisplayText(String(value))]);
  });
  return rows;
}

const approvedKpis = [
  { label: '总收益', value: '+18.4%', detail: '最近 24 个月，含再平衡后真实路径', tone: 'accent' },
  { label: '年化', value: '9.8%', detail: '超基准 2.1%', tone: 'neutral' },
  { label: '波动', value: '6.2%', detail: '低于纯风险资产', tone: 'neutral' },
  { label: '最大回撤', value: '-4.8%', detail: '恢复期 73 个交易日', tone: 'neutral' },
  { label: '现金占比', value: '20%', detail: '用于换手缓冲', tone: 'neutral' },
  { label: '夏普比率（Sharpe）', value: '1.21', detail: '收益效率高于 60/40', tone: 'neutral' },
  { label: '索提诺比率（Sortino）', value: '1.68', detail: '下行保护更稳定', tone: 'neutral' },
];

const approvedSources = [
  {
    id: 'strategy',
    title: '策略腿来源',
    status: '已冻结',
    ref: 'BT-240321 · 参数版本 P-20260418',
    hash: '6F3A',
    detail: '最近一次验证通过，回测、参数版本与冻结时间可以连起来复核。',
  },
  {
    id: 'bond',
    title: '债券腿来源',
    status: '可信',
    ref: 'Bond-UST10Y-20260421 · 净价 / 全价 / 到期收益率（YTM） / 应计利息',
    hash: '2C91',
    detail: '关键字段已连同快照 ID 一起冻结，避免后续重刷后口径漂移。',
  },
  {
    id: 'etf',
    title: 'ETF 篮子来源',
    status: '稳定',
    ref: 'Basket-ETF-Core-20260421 · 权重快照',
    hash: '91AD',
    detail: 'ETF 权重篮子与历史窗口一并冻结，可回看当时的构成和样本边界。',
  },
  {
    id: 'cash',
    title: '现金腿来源',
    status: '已冻结',
    ref: 'Cash-Rule-Quarterly-001 · 维护规则版本',
    hash: '7DB4',
    detail: '现金腿阈值、再平衡条件与成本吸收规则已固化，不依赖临时手工判断。',
  },
];

const approvedRiskRows = [
  {
    label: '宏观轮动策略',
    weight: 32,
    legType: '策略腿',
    statusTone: 'success',
    returnContribution: 38,
    riskContribution: 60,
    riskNote: '明显高于权重占比',
    trackTone: 'high',
    chips: [
      { label: '近期表现优', tone: 'accent' },
      { label: '与 ETF 高相关', tone: 'warning' },
    ],
    linkAfter: true,
  },
  {
    label: '核心 ETF 篮子',
    weight: 24,
    legType: '资产腿',
    statusTone: 'neutral',
    returnContribution: 17,
    riskContribution: 23,
    riskNote: '与策略腿联动偏高',
    trackTone: 'medium',
    chips: [
      { label: '月度权重重建', tone: 'neutral' },
      { label: '对冲价值偏弱', tone: 'warning' },
    ],
  },
  {
    label: '10Y 国债稳定腿',
    weight: 24,
    legType: '资产腿',
    statusTone: 'neutral',
    returnContribution: 21,
    riskContribution: 12,
    riskNote: '明显低于权重占比',
    trackTone: 'low',
    chips: [
      { label: '稳定器', tone: 'accent' },
      { label: '到期收益率（YTM）/ 久期（Duration） 已冻结', tone: 'neutral' },
    ],
  },
  {
    label: '现金缓冲规则',
    weight: 20,
    legType: '现金腿',
    statusTone: 'neutral',
    returnContribution: 6,
    riskContribution: 5,
    riskNote: '主要吸收调仓成本',
    trackTone: 'low',
    chips: [
      { label: '换手缓冲', tone: 'neutral' },
      { label: '成本吸收', tone: 'neutral' },
    ],
  },
];

const approvedCurrentMatrix = [
  ['1.00', '0.29', '0.74', '-0.06'],
  ['0.29', '1.00', '0.18', '0.24'],
  ['0.74', '0.18', '1.00', '0.05'],
  ['-0.06', '0.24', '0.05', '1.00'],
];
const approvedStressMatrix = [
  ['1.00', '0.42', '0.88', '0.02'],
  ['0.42', '1.00', '0.31', '0.28'],
  ['0.88', '0.31', '1.00', '0.12'],
  ['0.02', '0.28', '0.12', '1.00'],
];

function getApprovedMatrixTone(value: string): string {
  const numeric = Number(value);
  if (numeric >= 0.7) {
    return 'tone-hot';
  }
  if (numeric >= 0.25) {
    return 'tone-b';
  }
  if (numeric < 0) {
    return 'tone-c';
  }
  return numeric === 1 ? 'tone-a' : 'tone-d';
}

function getApprovedChipClassName(tone: string): string {
  if (tone === 'accent') {
    return 'chip chip--accent';
  }
  if (tone === 'warning') {
    return 'chip chip--warning';
  }
  if (tone === 'danger') {
    return 'chip chip--danger';
  }
  return 'chip';
}

function ApprovedCompositionDetailPreview(): JSX.Element {
  const [performanceMode, setPerformanceMode] = useState<'cumulative' | 'excess' | 'rebalance' | 'drawdown'>('cumulative');
  const [correlationMode, setCorrelationMode] = useState<CorrelationMode>('current');
  const [selectedSource, setSelectedSource] = useState<(typeof approvedSources)[number] | null>(null);
  const matrix = correlationMode === 'stress' ? approvedStressMatrix : approvedCurrentMatrix;

  return (
    <div
      className="composition-detail-page composition-detail-approved stack"
      data-page-root="composition-detail"
      data-route-root="compositions"
    >
      <section className="composition-detail-hero composition-detail-approved-hero">
        <div className="composition-detail-hero__copy">
          <h1>平衡收益组合</h1>
          <p>4 条腿、季度再平衡、来源已冻结。收益路径、风险归因与来源快照共同刻画组合当前的持有质量。</p>
          <div className="composition-detail-hero__chips">
            <span className="status-chip status-chip--success">冻结来源快照</span>
            <span className="status-chip status-chip--soft">季度再平衡</span>
            <span className="status-chip status-chip--soft">来源 4 / 4 稳定</span>
            <span className="status-chip status-chip--soft">可追溯维护成本</span>
          </div>
        </div>
        <div className="composition-detail-hero__actions">
          <button className="ghost-button" type="button">复制组合</button>
          <button className="ghost-button" type="button">重新平衡</button>
          <button
            className="primary-button"
            onClick={() => navigateTo('/compositions/workbench?composition_id=detail')}
            type="button"
          >
            编辑组合
          </button>
        </div>
      </section>

      <section className="panel composition-detail-kpi-panel composition-detail-approved-kpi-panel">
        <div className="composition-detail-kpi-grid">
          {approvedKpis.map((kpi) => (
            <article
              className={kpi.tone === 'accent' ? 'composition-detail-kpi-card composition-detail-kpi-card--accent' : 'composition-detail-kpi-card'}
              key={kpi.label}
            >
              <div className="composition-detail-kpi-card__head">
                <span>{kpi.label}</span>
              </div>
              <strong>{kpi.value}</strong>
              <p>{kpi.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="composition-detail-main-grid">
        <div className="composition-detail-main-column">
          <section className="panel composition-detail-panel composition-detail-approved-performance">
            <div className="panel-header composition-detail-panel__header composition-detail-approved-performance-header">
              <div>
                <h2>累计收益流</h2>
                <p className="composition-detail-panel__copy">
                  在同一视图核对组合收益、基准偏离、回撤区间与再平衡影响，评估组合表现的稳定性。
                </p>
              </div>
              <div className="composition-detail-approved-panel-actions">
                <span className="chip chip--accent">最近 24 个月</span>
                <span className="chip">基准：60/40 经典组合</span>
              </div>
            </div>

            <div className="composition-detail-approved-detail-toolbar">
              <div className="composition-detail-approved-chip-row">
                {[
                  ['cumulative', '累计收益', 'accent'],
                  ['excess', '超额收益', 'neutral'],
                  ['rebalance', '再平衡点', 'neutral'],
                  ['drawdown', '回撤阴影', 'danger'],
                ].map(([mode, label, tone]) => (
                  <button
                    aria-pressed={performanceMode === mode}
                    className={performanceMode === mode ? getApprovedChipClassName(tone) : 'chip'}
                    key={mode}
                    onClick={() => setPerformanceMode(mode as typeof performanceMode)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="composition-detail-approved-detail-inline-note">
                累计收益与超额收益共用同一套时间轴；再平衡点用于复核当次调仓成本与现金缓冲效果。
              </span>
            </div>

            <div className="composition-detail-chart-frame composition-detail-approved-chart-frame">
              <svg aria-label="组合累计收益图" className="composition-detail-approved-chart" viewBox="0 0 1000 320" preserveAspectRatio="xMidYMid meet">
                <defs>
                  <linearGradient id="approvedReturnFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="rgba(31, 135, 123, 0.18)" />
                    <stop offset="100%" stopColor="rgba(31, 135, 123, 0)" />
                  </linearGradient>
                  <linearGradient id="approvedDrawdownFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="rgba(196, 92, 79, 0.16)" />
                    <stop offset="100%" stopColor="rgba(196, 92, 79, 0)" />
                  </linearGradient>
                </defs>
                <path d="M0 266 L126 266 L252 258 L378 250 L504 256 L632 248 L758 240 L884 246 L1000 238 L1000 320 L0 320 Z" fill="url(#approvedDrawdownFill)" />
                <path d="M0 238 L142 230 L284 216 L426 188 L568 160 L710 126 L852 96 L1000 74 L1000 320 L0 320 Z" fill="url(#approvedReturnFill)" />
                <polyline fill="none" stroke="#4c78c7" strokeDasharray="10 8" strokeWidth="4" points="0,244 142,240 284,234 426,222 568,208 710,194 852,184 1000,178" />
                <polyline fill="none" stroke="#1f877b" strokeWidth="5" points="0,238 142,230 284,216 426,188 568,160 710,126 852,96 1000,74" />
                <line x1="284" y1="112" x2="284" y2="286" stroke="rgba(31, 135, 123, 0.22)" strokeDasharray="4 6" />
                <line x1="710" y1="112" x2="710" y2="286" stroke="rgba(31, 135, 123, 0.22)" strokeDasharray="4 6" />
                <circle cx="284" cy="216" r="7" fill="#ffffff" stroke="#1f877b" strokeWidth="4" />
                <circle cx="710" cy="126" r="7" fill="#ffffff" stroke="#1f877b" strokeWidth="4" />
                <rect x="342" y="66" rx="14" ry="14" width="190" height="58" fill="#ffffff" stroke="rgba(229, 231, 235, 0.96)" />
                <text x="362" y="90" fill="#111827" fontSize="14" fontWeight="700">2025-03 再平衡</text>
                <text x="362" y="112" fill="#64748b" fontSize="12">现金腿吸收调仓损耗 12 bps</text>
              </svg>
            </div>

            <article className="composition-detail-approved-mini-chart">
              <div className="composition-detail-approved-mini-chart-meta">
                <strong>超额收益</strong>
                <span>组合 - 60/40 基准。正区间越稳，说明这套腿结构在该阶段贡献了真实超额收益（Alpha）。</span>
              </div>
              <svg viewBox="0 0 1000 60" preserveAspectRatio="xMidYMid meet">
                <line x1="0" y1="30" x2="1000" y2="30" stroke="rgba(148, 163, 184, 0.42)" strokeDasharray="4 6" />
                <polyline fill="none" stroke="#4c78c7" strokeWidth="4" points="0,40 142,39 284,37 426,31 568,22 710,16 852,12 1000,9" />
              </svg>
            </article>

            <div className="composition-detail-approved-bottom-tabs">
              <span className="chip chip--accent">组合实线</span>
              <span className="chip chip--asset">60/40 基准虚线</span>
              <span className="chip">再平衡点</span>
              <span className="chip chip--danger">回撤阴影</span>
            </div>

            <article className="composition-detail-approved-rebalance-card">
              <strong>再平衡点</strong>
              <span>
                2025-03 与 2025-09 为再平衡窗口；点位信息用于复核当次调仓损耗、现金缓冲吸收比例与仓位变化。
              </span>
            </article>
          </section>

          <div className="composition-detail-approved-analysis-grid">
            <section className="panel composition-detail-panel">
              <div className="panel-header composition-detail-panel__header">
                <div>
                  <h2>风险与归因</h2>
                  <p className="composition-detail-panel__copy">
                    从收益贡献、风险贡献与效率分布三个维度判断各腿对组合的真实作用。
                  </p>
                </div>
              </div>

              <article className="composition-detail-approved-scatter-shell">
                <div className="composition-detail-approved-scatter-meta">
                  <strong>风险收益散点</strong>
                  <span>横轴看波动贡献，纵轴看收益贡献。右上角是高效率腿，右下角是“白占仓位”的低效腿。</span>
                </div>
                <svg className="composition-detail-approved-scatter" viewBox="0 0 520 220" preserveAspectRatio="xMidYMid meet">
                  <line x1="62" y1="182" x2="476" y2="182" stroke="rgba(148, 163, 184, 0.42)" />
                  <line x1="62" y1="24" x2="62" y2="182" stroke="rgba(148, 163, 184, 0.42)" />
                  <line x1="62" y1="100" x2="476" y2="100" stroke="rgba(148, 163, 184, 0.24)" strokeDasharray="4 6" />
                  <circle cx="314" cy="64" r="11" fill="#1f877b" />
                  <text x="332" y="60" fill="#111827" fontSize="13" fontWeight="700">宏观策略</text>
                  <circle cx="394" cy="136" r="11" fill="#c45c4f" />
                  <text x="412" y="132" fill="#111827" fontSize="13" fontWeight="700">ETF 篮子</text>
                  <circle cx="224" cy="84" r="11" fill="#4c78c7" />
                  <text x="242" y="80" fill="#111827" fontSize="13" fontWeight="700">10Y 国债</text>
                  <circle cx="116" cy="152" r="11" fill="#d7b47d" />
                  <text x="134" y="148" fill="#111827" fontSize="13" fontWeight="700">现金腿</text>
                </svg>
                <div className="composition-detail-approved-chip-row">
                  <span className="chip chip--accent">高效率腿：宏观策略 / 10Y 国债</span>
                  <span className="chip chip--warning">效率偏低：ETF 篮子</span>
                </div>
              </article>

              <div className="composition-detail-approved-snapshot-list">
                {approvedRiskRows.map((item) => (
                  <div className="composition-detail-approved-risk-block" key={item.label}>
                    <article className="composition-detail-approved-snapshot-card">
                      <div className="composition-detail-approved-snapshot-head">
                        <strong>{item.label} · {item.weight}%</strong>
                        <span className={item.statusTone === 'success' ? 'status-chip status-chip--success' : 'status-chip'}>{item.legType}</span>
                      </div>
                      <div className="composition-detail-approved-structure-meta">
                        <div className="composition-detail-approved-weight-subrow">
                          <span>收益贡献 {item.returnContribution}%</span>
                          <span>权重 {item.weight}%</span>
                        </div>
                        <div className="composition-detail-approved-risk-row">
                          <span>风险贡献 {item.riskContribution}%</span>
                          <span>{item.riskNote}</span>
                        </div>
                        <div className={`composition-detail-approved-risk-track composition-detail-approved-risk-track--${item.trackTone}`}>
                          <span style={{ width: item.trackTone === 'medium' ? '48%' : item.trackTone === 'low' ? item.label.includes('现金') ? '14%' : '26%' : '60%' }} />
                        </div>
                        <div className="composition-detail-approved-chip-row">
                          {item.chips.map((chip) => (
                            <span className={getApprovedChipClassName(chip.tone)} key={chip.label}>{chip.label}</span>
                          ))}
                        </div>
                      </div>
                    </article>
                    {item.linkAfter ? (
                      <div className="composition-detail-approved-leg-link">
                        <span className="composition-detail-approved-leg-link__line" />
                        <span className="composition-detail-approved-leg-link__chip">高相关预警</span>
                        <span className="composition-detail-approved-leg-link__line" />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>

            <section className="panel composition-detail-panel">
              <div className="panel-header composition-detail-panel__header">
                <div>
                  <h2>相关性矩阵</h2>
                  <p className="composition-detail-panel__copy">
                    常态相关性先告诉你“平时像不像在分散”，压力相关性再揭示极端时期会不会一起失效。
                  </p>
                </div>
              </div>
              <div className="composition-detail-approved-chip-row">
                <button
                  className={correlationMode === 'current' ? 'chip chip--accent' : 'chip'}
                  onClick={() => setCorrelationMode('current')}
                  type="button"
                >
                  常态相关性
                </button>
                <button
                  className={correlationMode === 'stress' ? 'chip chip--accent' : 'chip'}
                  onClick={() => setCorrelationMode('stress')}
                  type="button"
                >
                  极端行情相关性
                </button>
                <span className="chip chip--danger">高相关预警</span>
              </div>
              <div className="composition-detail-approved-matrix-wrap">
                <div className="composition-detail-approved-heatmap" aria-label="相关性热力矩阵">
                  {matrix.flat().map((value, index) => (
                    <span className={getApprovedMatrixTone(value)} key={`${value}-${index}`}>
                      {value}
                    </span>
                  ))}
                </div>
                <article className="composition-detail-approved-matrix-hover-card">
                  <strong>压力切换</strong>
                  <span>
                    切到极端行情相关性后，策略腿 × ETF 腿会从 {approvedCurrentMatrix[0][2]} 升至 {approvedStressMatrix[0][2]}。
                  </span>
                  <svg viewBox="0 0 150 88" preserveAspectRatio="none">
                    <path d="M14 70 C44 58, 78 36, 136 18" fill="none" stroke="#c45c4f" strokeWidth="2.5" />
                    <circle cx="18" cy="68" r="4" fill="#c45c4f" />
                    <circle cx="48" cy="58" r="4" fill="#c45c4f" />
                    <circle cx="82" cy="40" r="4" fill="#c45c4f" />
                    <circle cx="120" cy="24" r="4" fill="#c45c4f" />
                  </svg>
                </article>
              </div>
              <article className="composition-detail-approved-matrix-note-card">
                <strong>高相关预警</strong>
                <span>
                  当矩阵中出现大于 0.70 的正相关时，组合结构区会在对应两条腿之间拉出淡红连线，提醒研究员不要被表面上的“多腿数量”误导。
                </span>
              </article>
            </section>
          </div>

          <section className="panel composition-detail-panel composition-detail-approved-scenario-panel">
            <div className="panel-header composition-detail-panel__header">
              <div>
                <h2>情景分析</h2>
                <p className="composition-detail-panel__copy">
                  把底部留白让给决策型问题：如果极端历史重演，这个组合预计会怎么跌、多久修复、哪条腿会先失效。
                </p>
              </div>
            </div>
            <div className="composition-detail-scenario-grid composition-detail-approved-scenario-grid">
              {[
                ['2008 金融危机重演', '预计组合跌幅约 -11.6%，主要压力集中在策略腿与 ETF 腿同步回撤阶段，10Y 国债与现金腿承担主要缓冲。', '恢复期约 7.5 个月', 'warning'],
                ['2020 流动性危机重演', '预计组合跌幅约 -8.2%，现金腿先吸收换手冲击，组合整体修复速度快于纯风险资产篮子。', '恢复期约 4.2 个月', 'accent'],
                ['2022 加息冲击重演', '预计组合跌幅约 -6.4%，压力主要来自策略腿与 ETF 腿相关性抬升，债券腿的稳定作用低于常态期。', '需切到压力相关性复核', 'danger'],
              ].map(([title, body, tag, tone]) => (
                <article className="composition-detail-scenario-card composition-detail-approved-scenario-card" key={title}>
                  <strong>{title}</strong>
                  <span>{body}</span>
                  <div className="composition-detail-approved-chip-row">
                    <span className={getApprovedChipClassName(tone)}>{tag}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>

        <aside className="composition-detail-rail">
          <section className="panel composition-detail-panel composition-detail-rail-panel">
            <div className="panel-header composition-detail-panel__header">
              <div>
                <h2>来源快照</h2>
              </div>
            </div>
            <div className="composition-detail-evidence-list">
              {approvedSources.map((source) => (
                <button
                  className={selectedSource?.id === source.id ? 'composition-detail-evidence-card composition-detail-approved-source-card is-active' : 'composition-detail-evidence-card composition-detail-approved-source-card'}
                  key={source.id}
                  onClick={() => setSelectedSource(source)}
                  type="button"
                >
                  <div className="composition-detail-evidence-card__head">
                    <strong>{source.title}</strong>
                    <span className={source.id === 'strategy' || source.id === 'bond' ? 'status-chip status-chip--success' : 'status-chip'}>{source.status}</span>
                  </div>
                  <div className="composition-detail-approved-source-line">
                    <span>{source.ref}</span>
                    <span className="composition-detail-shield">盾牌哈希 {source.hash}</span>
                  </div>
                  <span className="composition-detail-approved-source-detail">{source.detail}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel composition-detail-panel composition-detail-rail-panel">
            <div className="panel-header composition-detail-panel__header">
              <div>
                <h2>再平衡与成本</h2>
              </div>
            </div>
            <article className="composition-detail-cost-card">
              <div className="composition-detail-risk-card__head">
                <strong>距离下一个再平衡窗口</strong>
                <span>11 天</span>
              </div>
              <div className="composition-detail-progress">
                <span style={{ width: '68%' }} />
              </div>
              <p>季度窗口前仍保留 11 天。当前现金腿缓冲仍足够，暂不需要为降低换手而提前动作。</p>
            </article>
            <article className="composition-detail-note-card">
              预计成本 12 bps。最近一次再平衡中，现金腿实际吸收了约 7 bps 的换手冲击。
            </article>
            <article className="composition-detail-note-card">
              当前组合结构成立，但策略腿与 ETF 腿相关性偏高。进入窗口前应先复核压力相关性。
            </article>
          </section>

          <section className="panel composition-detail-panel composition-detail-rail-panel">
            <div className="panel-header composition-detail-panel__header">
              <div>
                <h2>深入分析入口</h2>
              </div>
            </div>
            <div className="composition-detail-action-list">
              <button className="ghost-button" type="button">策略子视图</button>
              <button className="ghost-button" type="button">运行子视图</button>
              <button className="ghost-button" type="button">优化子视图</button>
              <button
                className="primary-button"
                onClick={() => navigateTo('/compositions/workbench?composition_id=detail')}
                type="button"
              >
                编辑组合
              </button>
            </div>
          </section>
        </aside>
      </div>

      {selectedSource ? (
        <div
          className="composition-detail-drawer-shell"
          onClick={() => setSelectedSource(null)}
          role="presentation"
        >
          <aside
            aria-label="来源快照详情"
            className="composition-detail-drawer"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="composition-detail-drawer__header">
              <div>
                <p className="page-heading__eyebrow">来源快照</p>
                <h2>{selectedSource.title}</h2>
                <p>{selectedSource.ref}</p>
              </div>
              <button className="ghost-button" onClick={() => setSelectedSource(null)} type="button">
                关闭
              </button>
            </div>
            <div className="composition-detail-drawer__summary">
              <span className="composition-detail-shield">盾牌哈希 {selectedSource.hash}</span>
              <span>{selectedSource.status}</span>
              <span>{selectedSource.id}</span>
            </div>
            <p>{selectedSource.detail}</p>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

export function CompositionDetailView({
  detail,
  loading,
  error,
  approvedPreview,
}: CompositionDetailViewProps): JSX.Element {
  const [performanceMode, setPerformanceMode] = useState<PerformanceMode>('cumulative');
  const [correlationMode, setCorrelationMode] = useState<CorrelationMode>('current');
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);

  if (approvedPreview) {
    return <ApprovedCompositionDetailPreview />;
  }

  const selectedEvidence = detail
    ? detail.source_evidence.find((item) => item.id === selectedEvidenceId) ?? null
    : null;
  const cumulativeSeries = detail ? detail.returns_preview.map((item) => item.cumulative_return_pct) : [];
  const benchmarkSeries = detail
    ? detail.benchmark_series.map((item) => item.cumulative_return_pct)
    : [];
  const spreadSeries = detail ? detail.spread_series.map((item) => item.spread_pct) : [];
  const drawdownSeries = useMemo(() => {
    let peak = Number.NEGATIVE_INFINITY;
    return cumulativeSeries.map((value) => {
      peak = Math.max(peak, value);
      return value - peak;
    });
  }, [cumulativeSeries]);
  const cumulativeMin = Math.min(...[0, ...cumulativeSeries, ...benchmarkSeries]);
  const cumulativeMax = Math.max(...[0, ...cumulativeSeries, ...benchmarkSeries, 0.01]);
  const spreadMin = Math.min(...[0, ...spreadSeries, -0.01]);
  const spreadMax = Math.max(...[0, ...spreadSeries, 0.01]);
  const performancePath =
    performanceMode === 'cumulative'
      ? buildLinePath(cumulativeSeries, 640, 320, cumulativeMin, cumulativeMax)
      : buildLinePath(spreadSeries, 640, 320, spreadMin, spreadMax);
  const benchmarkPath =
    performanceMode === 'cumulative'
      ? buildLinePath(benchmarkSeries, 640, 320, cumulativeMin, cumulativeMax)
      : '';
  const spreadArea =
    performanceMode === 'spread'
      ? buildAreaPath(spreadSeries, 640, 320, 0, spreadMin, spreadMax)
      : '';
  const drawdownBandArea =
    performanceMode === 'cumulative'
      ? buildAreaPath(drawdownSeries, 640, 120, 0, Math.min(...drawdownSeries, -0.001), 0)
      : '';

  const correlationLookup = useMemo(
    () => buildCorrelationLookup(detail?.correlation_matrix ?? [], correlationMode),
    [detail?.correlation_matrix, correlationMode],
  );
  const highCorrelationPairs = useMemo(
    () => (detail ? getHighCorrelationPairs(detail, correlationMode) : []),
    [detail, correlationMode],
  );

  const elapsedDays = detail ? getDaysSince(detail.updated_at) : 0;
  const cadenceDays = getIntervalDays(detail?.rebalance_frequency);
  const rebalanceProgress = Math.min(100, Math.round((elapsedDays / cadenceDays) * 100));
  const rebalanceRemaining = Math.max(0, cadenceDays - elapsedDays);
  const snapshotPath = detail?.source_evidence.some((item) =>
    String(item.freeze_ref_id ?? '').toLowerCase().includes('bond'),
  )
    ? '/snapshots?tab=bond'
    : '/snapshots';

  if (loading) {
    return (
      <div className="composition-detail-page stack" data-page-root="composition-detail" data-route-root="compositions">
        <section className="page-heading">
          <p className="page-heading__eyebrow">组合详情</p>
          <h1>加载组合详情中…</h1>
          <p>正在拉取收益流、风险归因与来源冻结证据。</p>
        </section>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="composition-detail-page stack" data-page-root="composition-detail" data-route-root="compositions">
        <section className="page-heading">
          <p className="page-heading__eyebrow">组合详情</p>
          <h1>组合详情</h1>
          <p>这里用于集中查看收益、风险、来源冻结与维护判断。</p>
        </section>
        <div className="error-banner" role="alert">
          {error || '当前组合不存在。'}
        </div>
      </div>
    );
  }

  const volatilityValues = detail.risk_contribution_preview.map((item) => item.volatility_pct);
  const contributionValues = detail.risk_contribution_preview.map((item) => item.contribution_pct);
  const volatilityRange = {
    min: Math.min(...volatilityValues, 0),
    max: Math.max(...volatilityValues, 1),
  };
  const contributionRange = {
    min: Math.min(...contributionValues, 0),
    max: Math.max(...contributionValues, 1),
  };
  const legDisplayNameById = new Map(
    detail.normalized_legs.map((leg) => [
      leg.id,
      formatLegDisplayName({
        leg_kind: leg.leg_kind,
        display_name: leg.display_name,
        source_ref_id: leg.source_ref_id,
        config: leg.config,
      }),
    ]),
  );
  const stableSourceCount = detail.normalized_legs.filter((leg) =>
    ['READY', 'ACTIVE'].includes(String(leg.status ?? '').toUpperCase()),
  ).length;
  const heroTitle = formatCompositionName({
    name: detail.hero_summary.title || detail.name,
    benchmarkLabel: detail.hero_summary.benchmark_label ?? detail.benchmark_definition?.label,
    status: detail.status,
  });
  const heroCopy = formatCompositionHeroCopy({
    description: detail.description,
    legCount: detail.hero_summary.leg_count,
    rebalanceFrequency: detail.rebalance_frequency,
  });
  return (
    <div
      className="composition-detail-page stack"
      data-page-root="composition-detail"
      data-route-root="compositions"
    >
      <section className="composition-detail-hero">
        <div className="composition-detail-hero__copy">
          <p className="page-heading__eyebrow">组合详情</p>
          <h1>{heroTitle}</h1>
          <p>{heroCopy}</p>
          <div className="composition-detail-hero__chips">
            <span className="status-chip status-chip--success">冻结来源快照</span>
            <span className="status-chip status-chip--soft">{getCadenceLabel(detail.rebalance_frequency)}</span>
            <span className="status-chip status-chip--soft">
              来源 {stableSourceCount} / {detail.hero_summary.leg_count} 稳定
            </span>
            <span className="status-chip status-chip--soft">可追溯维护成本</span>
          </div>
        </div>
        <div className="composition-detail-hero__actions">
          <button
            className="ghost-button"
            onClick={() => navigateTo('/compositions')}
            type="button"
          >
            返回组合仪表板
          </button>
          <button
            className="primary-button"
            onClick={() => navigateTo(`/compositions/workbench?composition_id=${encodeURIComponent(detail.id)}`)}
            type="button"
          >
            编辑组合
          </button>
        </div>
      </section>

      <section className="panel composition-detail-kpi-panel">
        <div className="composition-detail-kpi-grid">
          {detail.kpis.slice(0, 7).map((kpi) => (
            <article className="composition-detail-kpi-card" key={kpi.key}>
              <div className="composition-detail-kpi-card__head">
                <span>{formatCompositionKpiLabel(kpi.key, kpi.label)}</span>
                {kpi.unit ? <small>{kpi.unit}</small> : null}
              </div>
              <strong>{formatKpiValue(kpi)}</strong>
              <p className={getToneClassName(kpi.tone)}>{formatKpiDetail(kpi)}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="composition-detail-main-grid">
        <div className="composition-detail-main-column">
          <section className="panel composition-detail-panel">
            <div className="panel-header composition-detail-panel__header">
              <div>
                <h2>累计收益流</h2>
                <p className="composition-detail-panel__copy">
                  在同一视图核对组合收益、基准偏离、回撤区间与再平衡影响，评估组合表现的稳定性。
                </p>
              </div>
              <div className="composition-detail-toggle-row" role="tablist" aria-label="收益视图">
                <button
                  aria-selected={performanceMode === 'cumulative'}
                  className={performanceMode === 'cumulative' ? 'composition-detail-toggle composition-detail-toggle--active' : 'composition-detail-toggle'}
                  onClick={() => setPerformanceMode('cumulative')}
                  role="tab"
                  type="button"
                >
                  累计收益
                </button>
                <button
                  aria-selected={performanceMode === 'spread'}
                  className={performanceMode === 'spread' ? 'composition-detail-toggle composition-detail-toggle--active' : 'composition-detail-toggle'}
                  onClick={() => setPerformanceMode('spread')}
                  role="tab"
                  type="button"
                >
                  超额收益
                </button>
              </div>
            </div>

            <div className="composition-detail-chart-frame">
              <svg aria-label="组合表现主图" className="composition-detail-chart" viewBox="0 0 640 320">
                <line className="composition-detail-grid-line" x1="18" x2="622" y1="280" y2="280" />
                <line className="composition-detail-grid-line" x1="18" x2="18" y1="18" y2="280" />
                {performanceMode === 'spread' && spreadArea ? (
                  <path className="composition-detail-spread-area" d={spreadArea} />
                ) : null}
                {performanceMode === 'cumulative' && drawdownBandArea ? (
                  <path className="composition-detail-drawdown-area" d={drawdownBandArea} transform="translate(0, 188)" />
                ) : null}
                {benchmarkPath ? <path className="composition-detail-benchmark-path" d={benchmarkPath} /> : null}
                {performancePath ? (
                  <path
                    className={performanceMode === 'cumulative' ? 'composition-detail-performance-path' : 'composition-detail-spread-path'}
                    d={performancePath}
                  />
                ) : null}
                {detail.rebalance_markers.map((marker) => {
                  const index = Math.max(0, Math.min(marker.index, (performanceMode === 'spread' ? spreadSeries.length : cumulativeSeries.length) - 1));
                  const series = performanceMode === 'spread' ? spreadSeries : cumulativeSeries;
                  const pointValue = series[index] ?? 0;
                  const point =
                    performanceMode === 'cumulative'
                      ? getPoint(index, cumulativeSeries.length || 1, pointValue, cumulativeMin, cumulativeMax, 640, 320)
                      : getPoint(index, spreadSeries.length || 1, pointValue, spreadMin, spreadMax, 640, 320);
                  return (
                    <g key={`${marker.label}-${marker.index}`}>
                      <circle className="composition-detail-marker" cx={point.x} cy={point.y} r="4.5">
                        <title>
                          {marker.label} · 预计调仓损耗 {detail.maintenance_cost_summary.trade_cost_bps} bps
                        </title>
                      </circle>
                    </g>
                  );
                })}
              </svg>
            </div>

            <div className="composition-detail-legend">
              {performanceMode === 'cumulative' ? (
                <>
                  <span className="composition-detail-legend__item composition-detail-legend__item--strategy">组合累计收益</span>
                  <span className="composition-detail-legend__item composition-detail-legend__item--benchmark">基准虚线</span>
                  <span className="composition-detail-legend__item composition-detail-legend__item--drawdown">回撤阴影</span>
                </>
              ) : (
                <span className="composition-detail-legend__item composition-detail-legend__item--spread">组合相对基准超额收益</span>
              )}
            </div>
          </section>

          <section className="panel composition-detail-panel">
            <div className="panel-header composition-detail-panel__header">
              <div>
                <h2>风险与归因</h2>
                <p className="composition-detail-panel__copy">
                  从收益贡献、风险贡献与效率分布三个维度判断各腿对组合的真实作用。
                </p>
              </div>
            </div>

            <div className="composition-detail-risk-grid">
              <div className="composition-detail-risk-list">
                {detail.risk_contribution_preview.map((item) => (
                  <article className="composition-detail-risk-card" key={item.leg_id}>
                    <div className="composition-detail-risk-card__head">
                      <div>
                        <strong>{legDisplayNameById.get(item.leg_id) ?? getDisplayText(item.label)}</strong>
                        <p>{getRiskFlag(item)}</p>
                      </div>
                      <span className="status-chip status-chip--soft">{item.weight_pct.toFixed(1)}%</span>
                    </div>
                    <div className="composition-detail-risk-card__meta">
                      <span>波动占用 {item.volatility_pct.toFixed(1)}%</span>
                      <span>风险贡献 {item.contribution_pct.toFixed(1)}%</span>
                    </div>
                    <div className="composition-detail-risk-card__bar">
                      <span
                        className={item.contribution_pct >= item.weight_pct * 1.35 ? 'composition-detail-risk-card__bar-fill composition-detail-risk-card__bar-fill--warning' : 'composition-detail-risk-card__bar-fill'}
                        style={{ width: `${Math.min(Math.max(item.contribution_pct, 4), 100)}%` }}
                      />
                    </div>
                  </article>
                ))}
              </div>

              <div className="composition-detail-scatter-shell">
                <svg aria-label="风险贡献散点图" className="composition-detail-scatter" viewBox="0 0 360 260">
                  <line className="composition-detail-grid-line" x1="28" x2="332" y1="220" y2="220" />
                  <line className="composition-detail-grid-line" x1="28" x2="28" y1="24" y2="220" />
                  {detail.risk_contribution_preview.map((item) => {
                    const point = getScatterPoint(item, volatilityRange, contributionRange);
                    const pointLabel = legDisplayNameById.get(item.leg_id) ?? getDisplayText(item.label);
                    return (
                      <g key={item.leg_id}>
                        <circle className="composition-detail-scatter__dot" cx={point.x} cy={point.y} r="8">
                          <title>
                            {pointLabel} · 波动占用 {item.volatility_pct.toFixed(1)}% · 风险贡献 {item.contribution_pct.toFixed(1)}%
                          </title>
                        </circle>
                        <text className="composition-detail-scatter__label" x={point.x + 10} y={point.y - 10}>
                          {pointLabel}
                        </text>
                      </g>
                    );
                  })}
                </svg>
                <div className="composition-detail-scatter-note">
                  <span>横轴：波动占用</span>
                  <span>纵轴：风险贡献</span>
                </div>
              </div>
            </div>
          </section>

          <section className="panel composition-detail-panel">
            <div className="panel-header composition-detail-panel__header">
              <div>
                <h2>相关性矩阵</h2>
                <p className="composition-detail-panel__copy">
                  支持当前窗口与压力代理切换，用于识别极端环境下可能同步波动的来源。
                </p>
              </div>
              <div className="composition-detail-toggle-row" role="tablist" aria-label="相关性视图">
                <button
                  aria-selected={correlationMode === 'current'}
                  className={correlationMode === 'current' ? 'composition-detail-toggle composition-detail-toggle--active' : 'composition-detail-toggle'}
                  onClick={() => setCorrelationMode('current')}
                  role="tab"
                  type="button"
                >
                  当前窗口
                </button>
                <button
                  aria-selected={correlationMode === 'stress'}
                  className={correlationMode === 'stress' ? 'composition-detail-toggle composition-detail-toggle--active' : 'composition-detail-toggle'}
                  onClick={() => setCorrelationMode('stress')}
                  role="tab"
                  type="button"
                >
                  压力代理
                </button>
              </div>
            </div>

            <div className="composition-detail-matrix">
              <div className="composition-detail-matrix__header">
                <span />
                {detail.normalized_legs.map((leg) => (
                  <span key={`head-${leg.id}`}>{legDisplayNameById.get(leg.id) ?? leg.display_name}</span>
                ))}
              </div>
              {detail.normalized_legs.map((row) => (
                <div className="composition-detail-matrix__row" key={row.id}>
                  <span>{legDisplayNameById.get(row.id) ?? row.display_name}</span>
                  {detail.normalized_legs.map((column) => {
                    const value = correlationLookup.get(buildMatrixKey(row.id, column.id)) ?? 0;
                    return (
                      <div className={getCorrelationClassName(value)} key={buildMatrixKey(row.id, column.id)}>
                        {detail.normalized_legs.length <= 6 ? value.toFixed(2) : ''}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {highCorrelationPairs.length ? (
              <div className="composition-detail-alert-list">
                {highCorrelationPairs.map((item) => (
                  <article className="composition-detail-alert-card" key={item.key}>
                    <strong>{item.label}</strong>
                    <span>{item.value.toFixed(2)}</span>
                  </article>
                ))}
              </div>
            ) : null}
          </section>

          <section className="panel composition-detail-panel">
            <div className="panel-header composition-detail-panel__header">
              <div>
                <h2>情景分析</h2>
                <p className="composition-detail-panel__copy">
                  用基准场景与压力场景快速复核组合在极端阶段的可能跌幅与分散效果。
                </p>
              </div>
            </div>

            <div className="composition-detail-scenario-grid">
              <article className="composition-detail-scenario-card">
                <strong>{getScenarioLabel(detail.scenario_summary.base_case.label, '基准场景')}</strong>
                <span>
                  预计跌幅 {getScenarioDrawdown(detail.scenario_summary.base_case.expected_drawdown_pct)}
                </span>
              </article>
              <article className="composition-detail-scenario-card composition-detail-scenario-card--stress">
                <strong>{getScenarioLabel(detail.scenario_summary.stress_case.label, '压力场景')}</strong>
                <span>
                  预计跌幅 {getScenarioDrawdown(detail.scenario_summary.stress_case.expected_drawdown_pct)}
                </span>
              </article>
            </div>

            {detail.scenario_summary.dispersion_note ? (
              <p className="composition-detail-panel__copy">
                {getNarrativeText(detail.scenario_summary.dispersion_note)}
              </p>
            ) : null}
          </section>
        </div>

        <aside className="composition-detail-rail">
          <section className="panel composition-detail-panel composition-detail-rail-panel">
            <div className="panel-header composition-detail-panel__header">
              <div>
                <h2>来源快照</h2>
                <p className="composition-detail-panel__copy">
                  所有正式组合都固定来源与哈希摘要，便于回看当时的版本口径。
                </p>
              </div>
            </div>

            <div className="composition-detail-evidence-list">
              {detail.source_evidence.map((evidence) => (
                <button
                  className={selectedEvidenceId === evidence.id ? 'composition-detail-evidence-card is-active' : 'composition-detail-evidence-card'}
                  key={evidence.id}
                  onClick={() => setSelectedEvidenceId(evidence.id)}
                  type="button"
                >
                  <div className="composition-detail-evidence-card__head">
                    <div>
                      <strong>
                        {legDisplayNameById.get(evidence.leg_id) ??
                          formatLegDisplayName({ display_name: evidence.display_name })}
                      </strong>
                      <p>{getEvidenceKindLabel(evidence.freeze_ref_type)}</p>
                    </div>
                    <span className="composition-detail-shield">
                      #{evidence.freeze_hash}
                    </span>
                  </div>
                  <span>{formatDateTime(evidence.captured_at)}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel composition-detail-panel composition-detail-rail-panel">
            <div className="panel-header composition-detail-panel__header">
              <div>
                <h2>再平衡与成本</h2>
                <p className="composition-detail-panel__copy">
                  维护节奏、预计成本与下一个检查窗口统一收敛在右侧证据栏。
                </p>
              </div>
            </div>

            <article className="composition-detail-cost-card">
              <strong>{getCadenceLabel(detail.rebalance_frequency)}</strong>
              <p>距离下一个检查窗口约 {rebalanceRemaining} 天。</p>
              <div className="composition-detail-progress">
                <span style={{ width: `${rebalanceProgress}%` }} />
              </div>
              <div className="composition-detail-cost-list">
                <span>费率 {detail.maintenance_cost_summary.expense_ratio_bps} bps</span>
                <span>换手预算 {detail.maintenance_cost_summary.turnover_budget_bps} bps</span>
                <span>交易成本 {detail.maintenance_cost_summary.trade_cost_bps} bps</span>
                <span>预计总计 {detail.maintenance_cost_summary.total_estimated_bps} bps</span>
              </div>
            </article>

            <div className="composition-detail-note-list">
              {detail.maintenance_cost_summary.notes.map((note) => (
                <article className="composition-detail-note-card" key={note}>
                  {getNarrativeText(note)}
                </article>
              ))}
            </div>
          </section>

          <section className="panel composition-detail-panel composition-detail-rail-panel">
            <div className="panel-header composition-detail-panel__header">
              <div>
                <h2>深入分析入口</h2>
                <p className="composition-detail-panel__copy">
                  延续已批准的工作流，用抽屉查看来源细节，用工作台继续维护结构。
                </p>
              </div>
            </div>

            <div className="composition-detail-action-list">
              {detail.deep_link_actions.map((action) => {
                switch (action) {
                  case 'open_composition_workbench':
                    return (
                  <button
                        className="ghost-button"
                        key={action}
                        onClick={() => navigateTo(`/compositions/workbench?composition_id=${encodeURIComponent(detail.id)}`)}
                        type="button"
                      >
                        编辑组合
                      </button>
                    );
                  case 'open_leg_inventory':
                    return (
                      <button
                        className="ghost-button"
                        key={action}
                        onClick={() => navigateTo('/legs')}
                        type="button"
                      >
                        返回策略资产库
                      </button>
                    );
                  case 'inspect_source_evidence':
                    if (!detail.source_evidence.length) {
                      return null;
                    }
                    return (
                      <button
                        className="ghost-button"
                        key={action}
                        onClick={() => setSelectedEvidenceId(detail.source_evidence[0].id)}
                        type="button"
                      >
                        打开来源子视图
                      </button>
                    );
                  case 'refresh_snapshots':
                    return (
                      <button
                        className="ghost-button"
                        key={action}
                        onClick={() => navigateTo(snapshotPath)}
                        type="button"
                      >
                        查看数据快照
                      </button>
                    );
                  default:
                    return null;
                }
              })}
            </div>
          </section>
        </aside>
      </div>

      {selectedEvidence ? (
        <div
          className="composition-detail-drawer-shell"
          onClick={() => setSelectedEvidenceId(null)}
          role="presentation"
        >
          <aside
            aria-label="来源子视图"
            className="composition-detail-drawer"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="composition-detail-drawer__header">
              <div>
                <p className="page-heading__eyebrow">来源子视图</p>
                <h2>
                  {legDisplayNameById.get(selectedEvidence.leg_id) ??
                    formatLegDisplayName({ display_name: selectedEvidence.display_name })}
                </h2>
                <p>{getEvidenceKindLabel(selectedEvidence.freeze_ref_type)}</p>
              </div>
              <button className="ghost-button" onClick={() => setSelectedEvidenceId(null)} type="button">
                关闭
              </button>
            </div>
            <div className="composition-detail-drawer__summary">
              <span className="composition-detail-shield">#{selectedEvidence.freeze_hash}</span>
              <span>{formatDateTime(selectedEvidence.captured_at)}</span>
              <span>{selectedEvidence.freeze_ref_id}</span>
            </div>
            <div className="composition-detail-drawer__grid">
              {getDrawerRows(selectedEvidence).map(([label, value]) => (
                <div className="composition-detail-drawer__row" key={`${label}-${value}`}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

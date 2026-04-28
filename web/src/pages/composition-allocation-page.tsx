import { useEffect, useMemo, useState } from 'react';
import { useApiClient } from '../lib/demoStoreContext';
import './composition-allocation-page.css';

type AllocationIntentKey = 'min-vol' | 'risk-parity' | 'max-sharpe' | 'expert';
type TurnoverBand = 'low' | 'medium' | 'high';
type HistoryPreset = '3y' | '5y' | '10y' | 'custom';

type AllocationLeg = {
  id: string;
  name: string;
  role: string;
  currentWeight: number;
  minWeight: number;
  maxWeight: number;
  locked: boolean;
  expectedReturn: number;
  riskContribution: number;
};

type AllocationModel = {
  compositionName: string;
  benchmarkLabel: string;
  dataQualityLabel: string;
  updatedLabel: string;
  legs: AllocationLeg[];
};

type AllocationCandidate = {
  id: string;
  label: string;
  intentKey: AllocationIntentKey;
  annualReturn: number;
  volatility: number;
  sharpe: number;
  netSharpe: number;
  enb: number;
  turnover: number;
  migrationCostBps: number;
  stress: string;
  verdict: string;
  violation?: string;
  weights: Array<{ legId: string; weight: number; risk: number }>;
};

type FrontierPoint = {
  id: string;
  label: string;
  annualReturn: number;
  volatility: number;
  left: number;
  top: number;
  type?: 'current' | 'benchmark' | 'min-vol' | 'max-sharpe' | 'risk-parity';
  weights: Array<{ legId: string; weight: number }>;
};

const INTENTS: Array<{
  key: AllocationIntentKey;
  label: string;
  meta: string;
  body: string;
  badge: string;
}> = [
  {
    key: 'min-vol',
    label: '波动最小',
    meta: 'Min Vol + Historical',
    body: '优先压低组合波动和尾部回撤，适合防守稳健目标。',
    badge: '防守',
  },
  {
    key: 'risk-parity',
    label: '风险平价',
    meta: 'Risk Parity',
    body: '让每条腿承担更接近的风险贡献，不展示预期收益列。',
    badge: '均衡',
  },
  {
    key: 'max-sharpe',
    label: '收益最大',
    meta: 'Max Sharpe + Historical',
    body: '在约束内追求更高扣费后 Sharpe，并显性展示换手摩擦。',
    badge: '进攻',
  },
  {
    key: 'expert',
    label: '专家模式',
    meta: 'MVO / BL / Manual Override',
    body: '展开收益假设、协方差模型、半衰期和估计窗口。',
    badge: '专家',
  },
];

const HISTORY_PRESETS: Array<{ key: HistoryPreset; label: string }> = [
  { key: '3y', label: '3年' },
  { key: '5y', label: '5年' },
  { key: '10y', label: '10年' },
  { key: 'custom', label: '自定义' },
];

const TURNOVER_BANDS: Array<{ key: TurnoverBand; label: string; value: number }> = [
  { key: 'low', label: '低', value: 10 },
  { key: 'medium', label: '中', value: 18 },
  { key: 'high', label: '高', value: 30 },
];

const DEFAULT_MODEL: AllocationModel = {
  compositionName: '全天候研究组合',
  benchmarkLabel: '60/40 Benchmark',
  dataQualityLabel: '收益流已对齐',
  updatedLabel: '本地配置草稿',
  legs: [
    {
      id: 'alpha-core',
      name: 'Alpha Core',
      role: '策略腿',
      currentWeight: 38,
      minWeight: 20,
      maxWeight: 45,
      locked: false,
      expectedReturn: 11.8,
      riskContribution: 42,
    },
    {
      id: 'qqq-grid',
      name: 'QQQ Grid',
      role: '策略腿',
      currentWeight: 22,
      minWeight: 10,
      maxWeight: 30,
      locked: false,
      expectedReturn: 13.4,
      riskContribution: 31,
    },
    {
      id: 'tbill',
      name: 'T-Bill',
      role: '资产腿',
      currentWeight: 30,
      minWeight: 20,
      maxWeight: 45,
      locked: true,
      expectedReturn: 4.7,
      riskContribution: 20,
    },
    {
      id: 'cash',
      name: 'Cash',
      role: '现金腿',
      currentWeight: 10,
      minWeight: 10,
      maxWeight: 10,
      locked: true,
      expectedReturn: 3.1,
      riskContribution: 7,
    },
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function formatPct(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`;
}

function formatSignedPct(value: number, digits = 1): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

function normalizeLegs(rawDetail: unknown): AllocationLeg[] {
  if (!isRecord(rawDetail) || !Array.isArray(rawDetail.normalized_legs)) {
    return DEFAULT_MODEL.legs;
  }

  const normalized = rawDetail.normalized_legs
    .filter(isRecord)
    .map((leg, index): AllocationLeg => {
      const weight = asNumber(leg.weight_pct, DEFAULT_MODEL.legs[index]?.currentWeight ?? 0);
      const name = asString(leg.display_name, DEFAULT_MODEL.legs[index]?.name ?? `资产腿 ${index + 1}`);
      const kind = asString(leg.leg_kind, 'asset');
      const locked = Boolean(leg.weight_locked);
      const defaultLeg = DEFAULT_MODEL.legs[index] ?? DEFAULT_MODEL.legs[0];
      const role = kind === 'cash' ? '现金腿' : kind === 'strategy' ? '策略腿' : '资产腿';
      return {
        id: asString(leg.id, `leg-${index + 1}`),
        name,
        role,
        currentWeight: weight,
        minWeight: locked ? weight : Math.max(0, Math.round(weight * 0.45)),
        maxWeight: locked ? weight : Math.min(70, Math.max(weight + 8, Math.round(weight * 1.35))),
        locked,
        expectedReturn: defaultLeg.expectedReturn,
        riskContribution: Math.max(5, Math.min(76, asNumber(leg.contribution_pct, defaultLeg.riskContribution))),
      };
    });

  return normalized.length >= 2 ? normalized : DEFAULT_MODEL.legs;
}

function normalizeComposition(rawDetail: unknown): AllocationModel {
  if (!isRecord(rawDetail)) {
    return DEFAULT_MODEL;
  }

  const benchmark = isRecord(rawDetail.benchmark_definition)
    ? asString(rawDetail.benchmark_definition.label, DEFAULT_MODEL.benchmarkLabel)
    : DEFAULT_MODEL.benchmarkLabel;
  const quality = isRecord(rawDetail.return_quality_summary)
    ? asString(rawDetail.return_quality_summary.status, DEFAULT_MODEL.dataQualityLabel)
    : DEFAULT_MODEL.dataQualityLabel;

  return {
    compositionName: asString(rawDetail.name, DEFAULT_MODEL.compositionName),
    benchmarkLabel: benchmark,
    dataQualityLabel: quality === 'verified' ? '收益流已验证' : quality,
    updatedLabel: asString(rawDetail.updated_at, DEFAULT_MODEL.updatedLabel).slice(0, 10),
    legs: normalizeLegs(rawDetail),
  };
}

function buildCovarianceRows(legs: AllocationLeg[]): Array<{ row: AllocationLeg; cells: Array<{ leg: AllocationLeg; value: number }> }> {
  return legs.map((row, rowIndex) => ({
    row,
    cells: legs.map((leg, cellIndex) => {
      if (rowIndex === cellIndex) {
        return { leg, value: 1 };
      }
      const bothGrowth = row.role === '策略腿' && leg.role === '策略腿';
      const hasCash = row.role === '现金腿' || leg.role === '现金腿';
      const hasDefensive = row.name.toLowerCase().includes('bill') || leg.name.toLowerCase().includes('bill');
      const value = hasCash ? 0.02 : hasDefensive ? -0.14 + (rowIndex + cellIndex) * 0.02 : bothGrowth ? 0.86 : 0.24;
      return { leg, value: Number(value.toFixed(2)) };
    }),
  }));
}

function buildCandidateWeights(legs: AllocationLeg[], mode: AllocationIntentKey): Array<{ legId: string; weight: number; risk: number }> {
  const total = Math.max(1, legs.reduce((sum, leg) => sum + leg.currentWeight, 0));
  return legs.map((leg, index) => {
    const current = (leg.currentWeight / total) * 100;
    const defensiveBump = leg.name.toLowerCase().includes('bill') || leg.role === '现金腿' ? 8 : -4;
    const parityBump = leg.role === '策略腿' ? -2 : 4;
    const sharpeBump = leg.role === '策略腿' ? 6 : -6;
    const bump = mode === 'min-vol' ? defensiveBump : mode === 'risk-parity' ? parityBump : mode === 'max-sharpe' ? sharpeBump : 0;
    const weight = Math.max(5, Math.min(60, current + bump));
    return {
      legId: leg.id,
      weight: Number(weight.toFixed(1)),
      risk: Number(Math.max(5, Math.min(76, leg.riskContribution + (mode === 'max-sharpe' && index === 0 ? 18 : 0))).toFixed(1)),
    };
  });
}

function buildCandidates(legs: AllocationLeg[]): AllocationCandidate[] {
  return [
    {
      id: 'min-vol',
      label: 'Min Vol 候选',
      intentKey: 'min-vol',
      annualReturn: 10.8,
      volatility: 6.9,
      sharpe: 1.18,
      netSharpe: 1.15,
      enb: 3.0,
      turnover: 22,
      migrationCostBps: 15,
      stress: '2020 疫情回撤 -3.1% · 优于 Current',
      verdict: '最符合防守目标，成本可接受。',
      weights: buildCandidateWeights(legs, 'min-vol'),
    },
    {
      id: 'risk-parity',
      label: 'Risk Parity 候选',
      intentKey: 'risk-parity',
      annualReturn: 11.4,
      volatility: 7.8,
      sharpe: 1.24,
      netSharpe: 1.21,
      enb: 3.2,
      turnover: 18,
      migrationCostBps: 12,
      stress: '2020 疫情回撤 -3.6% · 优于 Current',
      verdict: '收益风险改善足以覆盖摩擦。',
      weights: buildCandidateWeights(legs, 'risk-parity'),
    },
    {
      id: 'max-sharpe',
      label: 'Max Sharpe 候选',
      intentKey: 'max-sharpe',
      annualReturn: 13.2,
      volatility: 10.4,
      sharpe: 1.31,
      netSharpe: 1.25,
      enb: 1.3,
      turnover: 36,
      migrationCostBps: 24,
      stress: '2020 疫情回撤 -6.8% · 劣于目标',
      verdict: '压力表现与分散度不符合防守目标。',
      violation: 'Cash 权重 8% 低于政策下限；Alpha 风险贡献高于 55% 警戒。',
      weights: buildCandidateWeights(legs, 'max-sharpe'),
    },
  ];
}

function buildFrontierPoints(legs: AllocationLeg[]): FrontierPoint[] {
  const baseWeights = legs.map((leg) => ({ legId: leg.id, weight: leg.currentWeight }));
  return [
    { id: 'frontier-01', label: 'Frontier 01', annualReturn: 9.8, volatility: 6.2, left: 22, top: 67, weights: baseWeights },
    { id: 'frontier-02', label: 'Frontier 02', annualReturn: 10.4, volatility: 6.8, left: 31, top: 58, weights: baseWeights },
    { id: 'frontier-custom', label: '自定义候选', annualReturn: 11.8, volatility: 8.3, left: 45, top: 43, weights: buildCandidateWeights(legs, 'risk-parity').map((item) => ({ legId: item.legId, weight: item.weight })) },
    { id: 'frontier-04', label: 'Frontier 04', annualReturn: 12.4, volatility: 9.4, left: 58, top: 35, weights: buildCandidateWeights(legs, 'max-sharpe').map((item) => ({ legId: item.legId, weight: item.weight })) },
    { id: 'current', label: 'Current', annualReturn: 10.9, volatility: 8.7, left: 52, top: 53, type: 'current', weights: baseWeights },
    { id: 'benchmark', label: 'Benchmark', annualReturn: 8.7, volatility: 10.4, left: 68, top: 69, type: 'benchmark', weights: baseWeights },
    { id: 'min-vol', label: 'Min Vol', annualReturn: 10.8, volatility: 6.9, left: 34, top: 52, type: 'min-vol', weights: buildCandidateWeights(legs, 'min-vol').map((item) => ({ legId: item.legId, weight: item.weight })) },
    { id: 'max-sharpe', label: 'Max Sharpe', annualReturn: 13.2, volatility: 10.4, left: 74, top: 28, type: 'max-sharpe', weights: buildCandidateWeights(legs, 'max-sharpe').map((item) => ({ legId: item.legId, weight: item.weight })) },
    { id: 'risk-parity', label: 'Risk Parity', annualReturn: 11.4, volatility: 7.8, left: 46, top: 40, type: 'risk-parity', weights: buildCandidateWeights(legs, 'risk-parity').map((item) => ({ legId: item.legId, weight: item.weight })) },
  ];
}

function useAllocationModel(compositionId: string): {
  model: AllocationModel;
  loading: boolean;
  warning: string | null;
} {
  const api = useApiClient();
  const [rawDetail, setRawDetail] = useState<unknown | null>(null);
  const [loading, setLoading] = useState(true);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      if (!api.getCompositionDetail) {
        setLoading(false);
        setWarning('组合详情接口未接入，已使用本地配置草稿。');
        return;
      }
      try {
        setLoading(true);
        setWarning(null);
        const detail = await api.getCompositionDetail(compositionId);
        if (!cancelled) {
          setRawDetail(detail);
        }
      } catch (caught) {
        if (!cancelled) {
          setWarning(`组合详情读取失败，已使用本地配置草稿：${(caught as Error).message}`);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [api, compositionId]);

  return {
    model: useMemo(() => normalizeComposition(rawDetail), [rawDetail]),
    loading,
    warning,
  };
}

function PageHero({
  compositionId,
  jobId,
  model,
  mode,
}: {
  compositionId: string;
  jobId?: string;
  model: AllocationModel;
  mode: 'config' | 'result';
}): JSX.Element {
  return (
    <section className="composition-allocation-hero" aria-label="组合实验室头部">
      <div className="composition-allocation-hero__copy">
        <p className="composition-allocation-eyebrow">组合资产配置</p>
        <h1>{mode === 'config' ? '组合优化实验室' : '组合优化结果'}</h1>
        <p>
          {mode === 'config'
            ? '用投资意图、风险边界和约束预检生成组合候选，专业参数按需展开。'
            : '先判断候选是否匹配目标，再核对有效前沿、压力表现、扣费后 Sharpe 和迁移成本。'}
        </p>
        <div className="composition-allocation-chip-row">
          <span className="composition-allocation-chip composition-allocation-chip--accent">资产配置</span>
          <span className="composition-allocation-chip">{model.compositionName}</span>
          <span className="composition-allocation-chip composition-allocation-chip--blue">
            Benchmark: {model.benchmarkLabel}
          </span>
        </div>
      </div>
      <div className="composition-allocation-route-card">
        <span>当前路径</span>
        <strong>
          {mode === 'config'
            ? `#/compositions/${compositionId}/allocation-lab`
            : `#/compositions/${compositionId}/allocation-jobs/${jobId ?? ':jobId'}`}
        </strong>
        <small>{model.dataQualityLabel} · {model.updatedLabel}</small>
      </div>
    </section>
  );
}

function StatusBanner({ loading, warning }: { loading: boolean; warning: string | null }): JSX.Element | null {
  if (!loading && !warning) {
    return null;
  }
  return (
    <div className={warning ? 'composition-allocation-banner composition-allocation-banner--warning' : 'composition-allocation-banner'}>
      {warning ?? '正在载入组合腿部与基准信息。'}
    </div>
  );
}

function IntentSelector({
  intent,
  onIntentChange,
}: {
  intent: AllocationIntentKey;
  onIntentChange: (intent: AllocationIntentKey) => void;
}): JSX.Element {
  return (
    <section className="composition-allocation-panel composition-allocation-panel--span-2">
      <div className="composition-allocation-panel__header">
        <div>
          <h2>1. 选择你的目标</h2>
          <p>默认只暴露投研意图，后台由父合同映射算法和数据来源。</p>
        </div>
        <span className="composition-allocation-status composition-allocation-status--good">
          当前意图：{INTENTS.find((item) => item.key === intent)?.label}
        </span>
      </div>
      <div className="composition-allocation-intents" role="list">
        {INTENTS.map((item) => (
          <button
            className={
              item.key === intent
                ? 'composition-allocation-intent-card composition-allocation-intent-card--active'
                : 'composition-allocation-intent-card'
            }
            key={item.key}
            onClick={() => onIntentChange(item.key)}
            type="button"
          >
            <span>{item.badge}</span>
            <strong>{item.label}</strong>
            <em>{item.meta}</em>
            <p>{item.body}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

function RiskBoundaryPanel({
  historyPreset,
  onHistoryPresetChange,
  onRiskTargetChange,
  onTurnoverChange,
  riskTarget,
  turnover,
}: {
  historyPreset: HistoryPreset;
  onHistoryPresetChange: (preset: HistoryPreset) => void;
  onRiskTargetChange: (value: number) => void;
  onTurnoverChange: (band: TurnoverBand) => void;
  riskTarget: number;
  turnover: TurnoverBand;
}): JSX.Element {
  const turnoverValue = TURNOVER_BANDS.find((item) => item.key === turnover)?.value ?? 18;
  return (
    <section className="composition-allocation-panel">
      <div className="composition-allocation-panel__header">
        <div>
          <h2>2. 风险偏好与边界</h2>
          <p>滑块表达目标波动率，常用窗口和换手档位保持一眼可读。</p>
        </div>
        <span className="composition-allocation-status composition-allocation-status--good">{riskTarget}% ± 2%</span>
      </div>
      <label className="composition-allocation-slider">
        <span>目标波动率</span>
        <input
          aria-label="目标波动率"
          max={10}
          min={6}
          onChange={(event) => onRiskTargetChange(Number(event.target.value))}
          step={0.5}
          type="range"
          value={riskTarget}
        />
        <strong>{riskTarget}%</strong>
      </label>
      <div className="composition-allocation-segments" aria-label="历史回溯窗口">
        <span>历史回溯窗口</span>
        {HISTORY_PRESETS.map((item) => (
          <button
            className={historyPreset === item.key ? 'is-active' : ''}
            key={item.key}
            onClick={() => onHistoryPresetChange(item.key)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="composition-allocation-segments" aria-label="最大换手率">
        <span>最大换手率</span>
        {TURNOVER_BANDS.map((item) => (
          <button
            className={turnover === item.key ? 'is-active' : ''}
            key={item.key}
            onClick={() => onTurnoverChange(item.key)}
            type="button"
          >
            {item.label} {item.value}%
          </button>
        ))}
      </div>
      <div className="composition-allocation-summary-line">
        <span>预检摘要</span>
        <strong>目标波动 {riskTarget}% · {historyPreset === '10y' ? '10年窗口' : '自定义窗口'} · 换手 {turnoverValue}%</strong>
      </div>
    </section>
  );
}

function ConstraintPanel({ legs, riskTarget, turnover }: { legs: AllocationLeg[]; riskTarget: number; turnover: TurnoverBand }): JSX.Element {
  const lockedCash = legs.find((leg) => leg.role === '现金腿')?.currentWeight ?? 10;
  const turnoverValue = TURNOVER_BANDS.find((item) => item.key === turnover)?.value ?? 18;
  const candidateCount = turnover === 'low' ? 28 : turnover === 'high' ? 64 : 48;
  return (
    <section className="composition-allocation-panel">
      <div className="composition-allocation-panel__header">
        <div>
          <h2>3. 约束预检</h2>
          <p>常用限制以可点击 chip 呈现，完整上下限只在微调入口里展开。</p>
        </div>
        <span className="composition-allocation-status composition-allocation-status--good">
          可生成 {candidateCount} 个候选方案
        </span>
      </div>
      <div className="composition-allocation-constraint-chips">
        <button type="button">Cash {formatPct(lockedCash)} · 点击修改</button>
        <button type="button">单次调仓上限 {turnoverValue}% · 点击修改</button>
        <button type="button">目标波动 {riskTarget}% ± 2%</button>
        <button type="button">代理数据门禁开启</button>
      </div>
    </section>
  );
}

function AssetAdjustmentPanel({
  expertMode,
  legs,
}: {
  expertMode: boolean;
  legs: AllocationLeg[];
}): JSX.Element {
  const [activeLegId, setActiveLegId] = useState<string>('');
  const activeLeg = legs.find((leg) => leg.id === activeLegId) ?? legs[0];

  return (
    <section className="composition-allocation-panel composition-allocation-panel--span-2">
      <div className="composition-allocation-panel__header">
        <div>
          <h2>资产微调</h2>
          <p>默认只展示当前权重、优化自由度和微调入口，不把底层上下限铺满表格。</p>
        </div>
      </div>
      <div className="composition-allocation-table-shell">
        <table className="composition-allocation-table">
          <thead>
            <tr>
              <th>资产腿</th>
              <th>当前权重</th>
              <th>优化自由度</th>
              <th>微调入口</th>
            </tr>
          </thead>
          <tbody>
            {legs.map((leg) => (
              <tr key={leg.id}>
                <td>
                  <strong>{leg.name}</strong>
                  <span>{leg.role}</span>
                </td>
                <td>{formatPct(leg.currentWeight)}</td>
                <td>
                  <span
                    className={
                      leg.locked
                        ? 'composition-allocation-status composition-allocation-status--warning'
                        : 'composition-allocation-status composition-allocation-status--good'
                    }
                  >
                    {leg.locked ? '锁定' : '开放'}
                  </span>
                </td>
                <td>
                  <button
                    className="composition-allocation-link-button"
                    onClick={() => setActiveLegId(leg.id)}
                    type="button"
                  >
                    微调 {leg.name}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {activeLegId && activeLeg ? (
        <div className="composition-allocation-popover" data-ui="allocation-constraint-popover">
          <span className="composition-allocation-status composition-allocation-status--info">约束气泡</span>
          <strong>{activeLeg.name}</strong>
          <div className="composition-allocation-popover__grid">
            <span>下限 {formatPct(activeLeg.minWeight)}</span>
            <span>上限 {formatPct(activeLeg.maxWeight)}</span>
            <span>{activeLeg.locked ? '锁定权重' : '可优化'}</span>
            {expertMode ? <span>预期年化收益 {formatPct(activeLeg.expectedReturn, 1)}</span> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function EvidenceRail({
  expertMode,
  legs,
  onExpertOpen,
}: {
  expertMode: boolean;
  legs: AllocationLeg[];
  onExpertOpen: () => void;
}): JSX.Element {
  const lockedWeight = legs.filter((leg) => leg.locked).reduce((sum, leg) => sum + leg.currentWeight, 0);
  const residual = Math.max(0, 100 - lockedWeight);
  const covarianceRows = buildCovarianceRows(legs);
  return (
    <aside className="composition-allocation-rail">
      <section className="composition-allocation-panel">
        <div className="composition-allocation-panel__header composition-allocation-panel__header--compact">
          <div>
            <h2>算法设置</h2>
            <p>默认折叠，专家模式展开后编辑底层参数。</p>
          </div>
          <button className="composition-allocation-ghost-button" onClick={onExpertOpen} type="button">
            打开设置
          </button>
        </div>
        <div className="composition-allocation-setting-summary">
          <span>数据来源 <strong>Historical</strong></span>
          <span>协方差模型 <strong>Ledoit-Wolf</strong></span>
          <span>高级项 <strong>{expertMode ? '已展开' : '已折叠'}</strong></span>
        </div>
        {expertMode ? (
          <div className="composition-allocation-expert-settings" data-ui="allocation-expert-settings">
            <label>
              MVO 模式
              <select aria-label="MVO 模式" defaultValue="min_vol">
                <option value="min_vol">Min Vol</option>
                <option value="max_sharpe">Max Sharpe</option>
                <option value="manual">Manual Override</option>
              </select>
            </label>
            <label>
              协方差模型
              <select aria-label="协方差模型" defaultValue="ledoit_wolf">
                <option value="sample">Sample Covariance</option>
                <option value="ledoit_wolf">Ledoit-Wolf</option>
                <option value="constant_correlation">Shrinkage to Constant Correlation</option>
              </select>
            </label>
            <label>
              半衰期
              <input aria-label="半衰期" defaultValue="36 月" />
            </label>
            <label>
              估计窗口
              <input aria-label="估计窗口" defaultValue="120 月" />
            </label>
            <label>
              Black-Litterman 观点
              <input aria-label="Black-Litterman 观点" defaultValue="保持默认市场隐含收益" />
            </label>
            <button className="composition-allocation-link-button" type="button">
              基于历史填充预期年化收益
            </button>
          </div>
        ) : (
          <p className="composition-allocation-muted">
            专家展开项：Manual Override、Black-Litterman、半衰期、估计窗口和协方差收缩参数。
          </p>
        )}
      </section>

      <section className="composition-allocation-panel">
        <span className="composition-allocation-status composition-allocation-status--info">Residual Budget</span>
        <strong className="composition-allocation-large-number">剩余 {formatPct(residual)} 权重可优化</strong>
        <p>
          锁定腿保持政策约束，算法主要在开放腿之间分配剩余预算，并保留现金缓冲。
        </p>
      </section>

      <section className="composition-allocation-panel">
        <div className="composition-allocation-panel__header">
          <div>
            <h2>协方差热力图</h2>
            <p>过去 120 个月相关性，保留专业证据但不抢占主配置视线。</p>
          </div>
        </div>
        <div className="composition-allocation-heatmap" aria-label="协方差热力图">
          <span />
          {legs.map((leg) => (
            <span className="composition-allocation-heatmap__axis" key={`x-${leg.id}`}>{leg.name}</span>
          ))}
          {covarianceRows.map(({ row, cells }) => (
            <div className="composition-allocation-heatmap__row" key={row.id}>
              <span className="composition-allocation-heatmap__axis">{row.name}</span>
              {cells.map((cell) => (
                <span
                  className={
                    cell.value >= 0.7
                      ? 'composition-allocation-heatmap__cell composition-allocation-heatmap__cell--hot'
                      : cell.value < 0
                        ? 'composition-allocation-heatmap__cell composition-allocation-heatmap__cell--cool'
                        : 'composition-allocation-heatmap__cell'
                  }
                  key={`${row.id}-${cell.leg.id}`}
                >
                  {cell.value.toFixed(2)}
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}

function FrontierChart({
  currentPointId,
  onPointClick,
  onPointHover,
  points,
  selectedPointId,
}: {
  currentPointId?: string;
  onPointClick?: (point: FrontierPoint) => void;
  onPointHover?: (point: FrontierPoint) => void;
  points: FrontierPoint[];
  selectedPointId?: string;
}): JSX.Element {
  return (
    <div className="composition-allocation-frontier" data-ui="allocation-frontier">
      <span className="composition-allocation-frontier__axis composition-allocation-frontier__axis--y">预期收益</span>
      <span className="composition-allocation-frontier__axis composition-allocation-frontier__axis--x">年化波动</span>
      <div className="composition-allocation-frontier__curve" />
      {points.map((point) => {
        const isSpecial = Boolean(point.type);
        const className = [
          'composition-allocation-frontier__point',
          isSpecial ? `composition-allocation-frontier__point--${point.type}` : '',
          selectedPointId === point.id ? 'is-selected' : '',
          currentPointId === point.id ? 'is-current-hover' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <button
            aria-label={`${point.label} frontier point`}
            className={className}
            key={point.id}
            onClick={() => onPointClick?.(point)}
            onMouseEnter={() => onPointHover?.(point)}
            onFocus={() => onPointHover?.(point)}
            style={{ left: `${point.left}%`, top: `${point.top}%` }}
            type="button"
          >
            {point.type === 'current' ? '★' : null}
          </button>
        );
      })}
      <div className="composition-allocation-frontier__legend">
        <span>★ Current</span>
        <span>红圈 Benchmark</span>
        <span>绿色有效前沿</span>
      </div>
    </div>
  );
}

function FrontierPreviewPanel({ legs }: { legs: AllocationLeg[] }): JSX.Element {
  const points = buildFrontierPoints(legs);
  return (
    <section className="composition-allocation-panel">
      <div className="composition-allocation-panel__header">
        <div>
          <h2>候选点分布预览</h2>
          <p>有效前沿预览包含 Benchmark 点，避免只和当前组合比较。</p>
        </div>
      </div>
      <FrontierChart points={points} />
    </section>
  );
}

export function CompositionAllocationConfigPage({
  compositionId,
}: {
  compositionId: string;
}): JSX.Element {
  const { loading, model, warning } = useAllocationModel(compositionId);
  const [intent, setIntent] = useState<AllocationIntentKey>('min-vol');
  const [riskTarget, setRiskTarget] = useState(8);
  const [historyPreset, setHistoryPreset] = useState<HistoryPreset>('10y');
  const [turnover, setTurnover] = useState<TurnoverBand>('medium');
  const expertMode = intent === 'expert';

  return (
    <main
      className="composition-allocation-page"
      data-page-root="composition-allocation-config"
      data-route-root="compositions"
    >
      <PageHero compositionId={compositionId} mode="config" model={model} />
      <StatusBanner loading={loading} warning={warning} />
      <div className="composition-allocation-layout">
        <div className="composition-allocation-main">
          <IntentSelector intent={intent} onIntentChange={setIntent} />
          <RiskBoundaryPanel
            historyPreset={historyPreset}
            onHistoryPresetChange={setHistoryPreset}
            onRiskTargetChange={setRiskTarget}
            onTurnoverChange={setTurnover}
            riskTarget={riskTarget}
            turnover={turnover}
          />
          <ConstraintPanel legs={model.legs} riskTarget={riskTarget} turnover={turnover} />
          <AssetAdjustmentPanel expertMode={expertMode} legs={model.legs} />
          <div className="composition-allocation-actions">
            <button className="composition-allocation-ghost-button" type="button">保存为模板</button>
            <button className="composition-allocation-ghost-button" type="button">复核约束</button>
            <button className="composition-allocation-primary-button" type="button">
              开始生成候选方案
            </button>
          </div>
        </div>
        <EvidenceRail expertMode={expertMode} legs={model.legs} onExpertOpen={() => setIntent('expert')} />
        <FrontierPreviewPanel legs={model.legs} />
      </div>
    </main>
  );
}

function CandidateBars({
  candidate,
  legs,
}: {
  candidate: AllocationCandidate;
  legs: AllocationLeg[];
}): JSX.Element {
  return (
    <div className="composition-allocation-weight-bars">
      {candidate.weights.map((weight) => {
        const leg = legs.find((item) => item.id === weight.legId);
        return (
          <div className="composition-allocation-weight-row composition-allocation-weight-row--dual" key={weight.legId}>
            <span>{leg?.name ?? weight.legId}</span>
            <div className="composition-allocation-dual-track">
              <i className="composition-allocation-dual-track__risk" style={{ width: `${weight.risk}%` }} />
              <i className="composition-allocation-dual-track__weight" style={{ width: `${weight.weight}%` }} />
            </div>
            <strong>{formatPct(weight.weight, 1)} / {formatPct(weight.risk, 1)}</strong>
          </div>
        );
      })}
    </div>
  );
}

function CandidateCard({
  candidate,
  intent,
  legs,
}: {
  candidate: AllocationCandidate;
  intent: AllocationIntentKey;
  legs: AllocationLeg[];
}): JSX.Element {
  const isBest = candidate.intentKey === (intent === 'expert' ? 'min-vol' : intent);
  return (
    <article
      className={isBest ? 'composition-allocation-candidate composition-allocation-candidate--best' : 'composition-allocation-candidate'}
      data-ui={isBest ? 'intent-aligned-candidate' : undefined}
    >
      <div className="composition-allocation-candidate__topline">
        <div>
          <strong>{candidate.label}</strong>
          {isBest ? <span className="composition-allocation-badge">最符合你的目标</span> : null}
        </div>
        <span className={candidate.enb < 3 ? 'composition-allocation-enb composition-allocation-enb--warning' : 'composition-allocation-enb'}>
          ENB {candidate.enb.toFixed(1)}
        </span>
      </div>
      <CandidateBars candidate={candidate} legs={legs} />
      <div className="composition-allocation-metric-strip">
        <span>名义 Sharpe {candidate.sharpe.toFixed(2)}</span>
        <span>扣费后 Sharpe {candidate.netSharpe.toFixed(2)}</span>
        <span>{candidate.stress}</span>
      </div>
      <p className={candidate.enb < 3 ? 'composition-allocation-warning-copy' : ''}>
        {candidate.enb < 3 ? '风险过于集中：' : ''}
        {candidate.verdict}
      </p>
      {candidate.violation ? <div className="composition-allocation-violation">{candidate.violation}</div> : null}
      <div className="composition-allocation-candidate__actions">
        <button className="composition-allocation-ghost-button" type="button">查看 diff</button>
        <button className="composition-allocation-primary-button" type="button">晋升为 v1.3</button>
      </div>
    </article>
  );
}

function HoverSnapshot({
  legs,
  point,
}: {
  legs: AllocationLeg[];
  point: FrontierPoint;
}): JSX.Element {
  return (
    <aside className="composition-allocation-hover-card" data-ui="frontier-weight-snapshot">
      <span className="composition-allocation-status composition-allocation-status--info">Hover Frontier Point</span>
      <strong>
        {point.label} · {formatPct(point.volatility, 1)} 波动 / {formatPct(point.annualReturn, 1)} 收益
      </strong>
      <div className="composition-allocation-weight-bars">
        {point.weights.map((weight) => {
          const leg = legs.find((item) => item.id === weight.legId);
          return (
            <div className="composition-allocation-weight-row" key={weight.legId}>
              <span>{leg?.name ?? weight.legId}</span>
              <div className="composition-allocation-bar">
                <i style={{ width: `${Math.min(100, weight.weight)}%` }} />
              </div>
              <strong>{formatPct(weight.weight, 1)}</strong>
            </div>
          );
        })}
      </div>
      <p>点击浅色点后生成临时自定义候选，可保存为实验候选或继续探索。</p>
    </aside>
  );
}

function IncrementalBacktestPanel(): JSX.Element {
  return (
    <section className="composition-allocation-panel composition-allocation-panel--span-2">
      <div className="composition-allocation-panel__header">
        <div>
          <h2>主要来自 T-Bill 防守权重提高 · Incremental Backtest</h2>
          <p>v1.3 最近 6 个月净值差额 +0.42pt，最近一次回调最大回撤从 -4.4% 降到 -3.1%。</p>
        </div>
        <span className="composition-allocation-status composition-allocation-status--good">v1.3 小幅占优</span>
      </div>
      <div className="composition-allocation-diff-grid">
        <article>
          <h3>净值差额线</h3>
          <div className="composition-allocation-mini-chart composition-allocation-mini-chart--spread" />
          <p>升级后相对 Current 的累计差额更稳，不靠单一高波动腿贡献。</p>
        </article>
        <article>
          <h3>动态回撤对比</h3>
          <div className="composition-allocation-mini-chart composition-allocation-mini-chart--drawdown" />
          <p>新方案在最近一次市场回调中修复更快，符合“波动最小”意图。</p>
        </article>
      </div>
    </section>
  );
}

function MigrationCostPanel({ candidates }: { candidates: AllocationCandidate[] }): JSX.Element {
  return (
    <section className="composition-allocation-panel composition-allocation-panel--span-2">
      <div className="composition-allocation-panel__header">
        <div>
          <h2>迁移成本归因</h2>
          <p>预估摩擦按来源拆解，让换手对效率的稀释可见。</p>
        </div>
      </div>
      <div className="composition-allocation-table-shell">
        <table className="composition-allocation-table">
          <thead>
            <tr>
              <th>方案</th>
              <th>单向换手</th>
              <th>预估摩擦</th>
              <th>名义 Sharpe</th>
              <th>扣费后 Sharpe</th>
              <th>判断</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((candidate) => (
              <tr key={candidate.id}>
                <td>{candidate.label}</td>
                <td>{formatPct(candidate.turnover)}</td>
                <td>{candidate.migrationCostBps} bps</td>
                <td>{candidate.sharpe.toFixed(2)}</td>
                <td>{candidate.netSharpe.toFixed(2)}</td>
                <td>
                  {candidate.id === 'risk-parity'
                    ? '8 bps 来自 Alpha 调减冲击成本，4 bps 来自 T-Bill 增持手续费。'
                    : candidate.verdict}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function CompositionAllocationResultPage({
  compositionId,
  intent = 'min-vol',
  jobId,
}: {
  compositionId: string;
  intent?: AllocationIntentKey;
  jobId: string;
}): JSX.Element {
  const { loading, model, warning } = useAllocationModel(compositionId);
  const candidates = useMemo(() => buildCandidates(model.legs), [model.legs]);
  const frontierPoints = useMemo(() => buildFrontierPoints(model.legs), [model.legs]);
  const [hoveredPoint, setHoveredPoint] = useState<FrontierPoint>(frontierPoints[0]);
  const [customPoint, setCustomPoint] = useState<FrontierPoint | null>(null);

  useEffect(() => {
    setHoveredPoint(frontierPoints[0]);
  }, [frontierPoints]);

  const selectedIntent = intent === 'expert' ? 'min-vol' : intent;
  const bestCandidate = candidates.find((candidate) => candidate.intentKey === selectedIntent) ?? candidates[0];

  return (
    <main
      className="composition-allocation-page"
      data-page-root="composition-allocation-result"
      data-route-root="compositions"
    >
      <PageHero compositionId={compositionId} jobId={jobId} mode="result" model={model} />
      <StatusBanner loading={loading} warning={warning} />
      <section className="composition-allocation-verdict">
        <span className="composition-allocation-status composition-allocation-status--good">目标对齐</span>
        <strong>{bestCandidate.label} 是当前最符合你的目标的晋升候选。</strong>
        <p>
          Current 与 Benchmark 同屏对照，候选排序先匹配配置意图，再展示 ENB、压力快照和扣费后 Sharpe。
        </p>
      </section>
      <div className="composition-allocation-results-grid">
        <section className="composition-allocation-panel composition-allocation-panel--frontier">
          <div className="composition-allocation-panel__header">
            <div>
              <h2>有效前沿 · Current / Benchmark / 可点击沙盘</h2>
              <p>星标 Current 带脉冲光圈，红圈是 Benchmark。Hover 查看权重，点击生成自定义候选。</p>
            </div>
            <span className="composition-allocation-status composition-allocation-status--good">
              当前意图：{INTENTS.find((item) => item.key === selectedIntent)?.label}
            </span>
          </div>
          <FrontierChart
            currentPointId={hoveredPoint.id}
            onPointClick={(point) => {
              setCustomPoint(point);
              setHoveredPoint(point);
            }}
            onPointHover={setHoveredPoint}
            points={frontierPoints}
            selectedPointId={customPoint?.id}
          />
          <div className="composition-allocation-phase-strip">
            <span><strong>Current</strong> 收益 10.9% / 波动 8.7%</span>
            <span><strong>Benchmark</strong> 收益 8.7% / 波动 10.4%</span>
            <span className="is-active"><strong>{bestCandidate.label.replace(' 候选', '')}</strong> 收益 {formatPct(bestCandidate.annualReturn, 1)} / 波动 {formatPct(bestCandidate.volatility, 1)}</span>
          </div>
          <HoverSnapshot legs={model.legs} point={hoveredPoint} />
        </section>

        <aside className="composition-allocation-panel">
          <div className="composition-allocation-panel__header">
            <div>
              <h2>候选卡 · 意图对齐排序</h2>
              <p>每张卡展示权重与风险贡献双条、ENB、压力快照和扣费后 Sharpe。</p>
            </div>
          </div>
          <div className="composition-allocation-candidate-list">
            {candidates.map((candidate) => (
              <CandidateCard candidate={candidate} intent={intent} key={candidate.id} legs={model.legs} />
            ))}
            {customPoint ? (
              <article className="composition-allocation-candidate composition-allocation-candidate--custom" data-ui="custom-frontier-candidate">
                <div className="composition-allocation-candidate__topline">
                  <strong>自定义候选 · 曲线点击生成</strong>
                  <span className="composition-allocation-enb composition-allocation-enb--warning">ENB 2.8</span>
                </div>
                <div className="composition-allocation-metric-strip">
                  <span>波动 {formatPct(customPoint.volatility, 1)}</span>
                  <span>收益 {formatPct(customPoint.annualReturn, 1)}</span>
                  <span>扣费后 Sharpe 1.19</span>
                </div>
                <HoverSnapshot legs={model.legs} point={customPoint} />
                <p className="composition-allocation-warning-copy">低于 3.0，风险略集中；可继续点选曲线左侧候选降低集中度。</p>
                <div className="composition-allocation-candidate__actions">
                  <button className="composition-allocation-ghost-button" type="button">继续探索</button>
                  <button className="composition-allocation-primary-button" type="button">保存为实验候选</button>
                </div>
              </article>
            ) : null}
          </div>
        </aside>
        <IncrementalBacktestPanel />
        <MigrationCostPanel candidates={candidates} />
      </div>
      <div className="composition-allocation-footnote">
        <span>Current vs Benchmark</span>
        <strong>最近 6 个月相对 Current {formatSignedPct(0.42)}，压力窗口最大回撤改善 1.3pt。</strong>
      </div>
    </main>
  );
}

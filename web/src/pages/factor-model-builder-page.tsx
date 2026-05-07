import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './factor-phase2-pages.css';

type FactorDirection = 'HIGH_IS_GOOD' | 'LOW_IS_GOOD';

export type FactorModelOption = {
  id: string;
  displayName: string;
  family: string;
  categoryLabel?: string;
  rankIcLabel?: string;
  irLabel?: string;
  rankIc?: number | null;
  ir?: number | null;
  sourceLabel: string;
  diagnosticStatus: string;
  pitCoveragePct: number;
  defaultWeight: number;
  defaultDirection: FactorDirection;
};

export type FactorModelSelection = {
  factorId: string;
  weightPct: number;
  direction: FactorDirection;
};

export type FactorModelNeutralizationConfig = {
  enabled: boolean;
  taxonomy: string;
  level: string;
  method: string;
};

export type FactorModelPreviewPayload = {
  modelName: string;
  factors: FactorModelSelection[];
  neutralization: FactorModelNeutralizationConfig;
  rebalanceFrequency: string;
};

export type FactorModelPreviewWeight = {
  factorId: string;
  weightPct: number;
  normalizedWeightPct: number;
  direction: FactorDirection;
  diagnosticStatus?: string;
};

export type FactorModelScorePoint = {
  symbol: string;
  score: number;
  coveragePct: number;
};

export type FactorModelNeutralizationPreview = {
  enabled: boolean;
  method: string;
  status: string;
  blockers: string[];
  industryField?: string | null;
  taxonomy?: string | null;
  coveredSymbolCount?: number | null;
  missingSymbolCount?: number | null;
  sourceNames?: string[];
};

export type FactorModelRiskItem = {
  code: string;
  severity?: string;
  message: string;
  label?: string;
  category?: string;
  factor_id?: string;
};

export type FactorModelStrategyCreationRisk = {
  can_create?: boolean;
  warning_count?: number;
  blocked_count?: number;
  warnings?: FactorModelRiskItem[];
  hard_blockers?: FactorModelRiskItem[];
  summary_label?: string;
  summary?: string;
};

export type FactorModelPreview = {
  status: string;
  coveragePct: number;
  factorCount: number;
  readyFactorCount: number;
  universeSymbolCount: number;
  turnoverPct: number;
  scoreSpread: number;
  scorePreview: FactorModelScorePoint[];
  normalizedWeights: FactorModelPreviewWeight[];
  pitBlockers: string[];
  neutralizationStatus: FactorModelNeutralizationPreview;
  warnings: string[];
  strategyCreationRisk?: FactorModelStrategyCreationRisk;
  strategy_creation_risk?: FactorModelStrategyCreationRisk;
};

export type FactorModelCreateResponse = {
  strategy_id: string;
  parameter_version_id?: string;
};

export type FactorModelBuilderApi = {
  previewFactorModel?: (payload: FactorModelPreviewPayload) => Promise<FactorModelPreview>;
  createFactorModel?: (payload: FactorModelPreviewPayload) => Promise<FactorModelCreateResponse>;
};

export type FactorModelBuilderPageProps = {
  api?: FactorModelBuilderApi;
  autoPreviewDelayMs?: number;
  factors?: FactorModelOption[];
  initialPrefill?: {
    source?: string;
    factorIds: string[];
    weights: number[];
    directions: string[];
    modelName?: string;
  };
  useDefaultFallback?: boolean;
  defaultSelectAll?: boolean;
  onCreated?: (strategyId: string) => void;
};

const DEFAULT_MODEL_NAME = '多因子核心模型';
const FACTOR_ORDER = [
  's_mom_12m1m_rank',
  's_val_ep_ltm_raw',
  's_qlty_fcfy_ttm_raw',
  's_vol_252d_rank',
  's_size_cur_log',
] as const;

const FACTOR_DESIGN: Record<string, { displayName: string; family: string; weightPct: number; direction: FactorDirection }> = {
  s_mom_12m1m_rank: {
    displayName: '12-1月截面动量排名',
    family: '动量',
    weightPct: 30,
    direction: 'HIGH_IS_GOOD',
  },
  s_val_ep_ltm_raw: {
    displayName: '滚动市盈率倒数 (LTM)',
    family: '估值',
    weightPct: 20,
    direction: 'HIGH_IS_GOOD',
  },
  s_qlty_fcfy_ttm_raw: {
    displayName: '自由现金流收益率 (TTM)',
    family: '质量',
    weightPct: 20,
    direction: 'HIGH_IS_GOOD',
  },
  s_vol_252d_rank: {
    displayName: '252日年化波动率排名',
    family: '低波',
    weightPct: 15,
    direction: 'LOW_IS_GOOD',
  },
  s_size_cur_log: {
    displayName: '即时对数总市值',
    family: '规模',
    weightPct: 15,
    direction: 'LOW_IS_GOOD',
  },
};

const DEFAULT_FACTORS: FactorModelOption[] = FACTOR_ORDER.map((id) => {
  const design = FACTOR_DESIGN[id];
  return {
    id,
    displayName: design.displayName,
    family: design.family,
    sourceLabel: '系统默认',
    diagnosticStatus: '可诊断',
    pitCoveragePct: 94,
    defaultWeight: design.weightPct,
    defaultDirection: design.direction,
  };
});

const REBALANCE_OPTIONS = [
  { value: 'monthly', label: '每月', summary: '每月复核一次多因子组合权重。' },
  { value: 'quarterly', label: '每季度', summary: '每季度复核一次，降低调仓干扰。' },
  { value: 'semiannual', label: '每半年', summary: '每半年复核一次，适合低换手组合。' },
  { value: 'yearly', label: '每年', summary: '每年复核一次，强调长期持仓稳定性。' },
  { value: 'never', label: '从不', summary: '创建后不按固定周期触发再平衡。' },
] as const;

function pct(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

function designFactor(factor: FactorModelOption): FactorModelOption {
  const design = FACTOR_DESIGN[factor.id];
  if (!design) return factor;
  return {
    ...factor,
    displayName: factor.displayName || design.displayName,
    family: factor.family || design.family,
    categoryLabel: factor.categoryLabel || factor.family || design.family,
    defaultWeight: Number.isFinite(factor.defaultWeight) ? factor.defaultWeight : design.weightPct,
    defaultDirection: factor.defaultDirection || design.direction,
  };
}

function factorMetricTags(factor: FactorModelOption): Array<{ key: string; label: string }> {
  const category = factor.categoryLabel || factor.family || '自定义';
  return [
    { key: 'category', label: `类别 ${category}` },
    { key: 'rank-ic', label: factor.rankIcLabel || 'Rank IC 待诊断' },
    { key: 'ir', label: factor.irLabel || 'IR 待诊断' },
  ];
}

function FactorMetricTags({ factor, context }: { factor: FactorModelOption; context: string }): JSX.Element {
  return (
    <div className="factor-model-card-tags" aria-label={`${factor.displayName}${context}标签`}>
      {factorMetricTags(factor).map((tag) => (
        <span className={`factor-model-metric-chip factor-model-metric-chip--${tag.key}`} key={`${factor.id}-${tag.key}`}>
          {tag.label}
        </span>
      ))}
    </div>
  );
}

function finiteMetric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function irValue(factor: FactorModelOption): number | null {
  const directValue = finiteMetric(factor.ir);
  if (directValue !== null) return directValue;
  const labelMatch = factor.irLabel?.match(/-?\d+(?:\.\d+)?/);
  return labelMatch ? finiteMetric(labelMatch[0]) : null;
}

function factorOrderIndex(factor: FactorModelOption): number {
  const index = FACTOR_ORDER.indexOf(factor.id as (typeof FACTOR_ORDER)[number]);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function compareFactorsByAbsIr(left: FactorModelOption, right: FactorModelOption): number {
  const leftIr = irValue(left);
  const rightIr = irValue(right);
  const leftScore = leftIr === null ? Number.NEGATIVE_INFINITY : Math.abs(leftIr);
  const rightScore = rightIr === null ? Number.NEGATIVE_INFINITY : Math.abs(rightIr);
  if (leftScore !== rightScore) return rightScore - leftScore;
  const orderDiff = factorOrderIndex(left) - factorOrderIndex(right);
  if (orderDiff !== 0) return orderDiff;
  return left.displayName.localeCompare(right.displayName, 'zh-Hans-CN');
}

function modelBasket(factors: FactorModelOption[], useDefaultFallback = true): FactorModelOption[] {
  const sourceFactors = factors.length ? factors : useDefaultFallback ? DEFAULT_FACTORS : [];
  return sourceFactors.map(designFactor).sort(compareFactorsByAbsIr);
}

function normalizeSelections(factors: FactorModelOption[], useDefaultFallback = true): FactorModelSelection[] {
  const basket = modelBasket(factors, useDefaultFallback);
  const draftSelections = basket.map((factor) => ({
    factorId: factor.id,
    weightPct: factor.defaultWeight,
    direction: factor.defaultDirection,
  }));
  const totalWeight = draftSelections.reduce((total, selection) => total + selection.weightPct, 0);
  if (Math.round(totalWeight) === 100) {
    return draftSelections;
  }
  const equalWeight = basket.length ? 100 / basket.length : 0;
  return draftSelections.map((selection) => ({
    ...selection,
    weightPct: Number(equalWeight.toFixed(2)),
  }));
}

function normalizePrefillDirection(value: string | undefined, fallback: FactorDirection): FactorDirection {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'LOW_IS_GOOD' || normalized === 'LOW_IS_BETTER') return 'LOW_IS_GOOD';
  if (normalized === 'HIGH_IS_GOOD' || normalized === 'HIGH_IS_BETTER') return 'HIGH_IS_GOOD';
  return fallback;
}

function localizePreviewStatus(status: string): string {
  if (status === 'READY') return '通过';
  if (status === 'BLOCKED') return '阻断';
  if (status === 'LOCAL_PENDING_API_PREVIEW') return '本地校验';
  return status || '待预览';
}

function blockerLabel(blocker: string): string {
  const normalized = blocker.trim();
  if (!normalized) return '未知门禁阻塞';
  if (normalized === 'MISSING_INDUSTRY_PIT') return '行业 PIT 字段缺失';
  if (normalized === 'PIT_BLOCKED') return 'PIT 证据不足';
  if (normalized === 'FUTURE_FUNCTION') return '未来函数';
  if (normalized === 'UNREPLAYABLE_FIELD') return '不可回放字段';
  if (normalized === 'CURRENT_ONLY_DATA') return '当前态数据';
  if (normalized === 'UNSAFE_EXPRESSION') return '不安全表达式';
  if (normalized === 'MISSING_AVAILABLE_AT') return '缺少 available_at';
  if (normalized === 'HIGH_CORRELATION') return '高相关提示';
  if (normalized === 'LOCAL_API_UNAVAILABLE') return '预览接口不可用';
  return normalized.replaceAll('_', ' ');
}

function localizeRiskText(value: string): string {
  return value
    .replaceAll('unsafe expression', '不安全表达式')
    .replaceAll('current-only 数据', '当前态数据')
    .replaceAll('READY', '通过')
    .replaceAll('BLOCKED', '阻断')
    .replaceAll('MULTI_FACTOR', '多因子策略');
}

function riskItemLabel(item: FactorModelRiskItem): string {
  return localizeRiskText(item.label || item.message || blockerLabel(item.code));
}

function previewStrategyRisk(preview: FactorModelPreview): FactorModelStrategyCreationRisk | null {
  return preview.strategyCreationRisk ?? preview.strategy_creation_risk ?? null;
}

function buildLocalPreview(
  selectedFactors: FactorModelOption[],
  selectedSelections: FactorModelSelection[],
  neutralizationEnabled: boolean,
  previewError: string | null,
): FactorModelPreview {
  const weightBase = selectedSelections.reduce((total, selection) => total + Math.abs(selection.weightPct), 0);
  const lowPitFactors = selectedFactors.filter((factor) => factor.pitCoveragePct < 80);
  const coveragePct = selectedFactors.length ? Math.min(...selectedFactors.map((factor) => factor.pitCoveragePct)) : 0;
  const localHardBlockers: FactorModelRiskItem[] = [
    ...lowPitFactors.map((factor) => ({
      code: 'PIT_BLOCKED',
      severity: 'blocker',
      label: `${factor.displayName} PIT 覆盖不足`,
      message: `${factor.displayName} PIT 覆盖不足`,
      factor_id: factor.id,
    })),
    ...(previewError ? [{
      code: 'LOCAL_API_UNAVAILABLE',
      severity: 'blocker',
      label: '预览接口不可用',
      message: previewError,
    }] : []),
  ];
  return {
    status: lowPitFactors.length || previewError ? 'BLOCKED' : 'LOCAL_PENDING_API_PREVIEW',
    coveragePct,
    factorCount: selectedSelections.length,
    readyFactorCount: selectedSelections.length - lowPitFactors.length,
    universeSymbolCount: 0,
    turnoverPct: 0,
    scoreSpread: 0,
    scorePreview: [],
    normalizedWeights: selectedSelections.map((selection) => ({
      factorId: selection.factorId,
      weightPct: selection.weightPct,
      normalizedWeightPct: weightBase > 0 ? (Math.abs(selection.weightPct) / weightBase) * 100 : 0,
      direction: selection.direction,
    })),
    pitBlockers: [
      ...lowPitFactors.map((factor) => `${factor.displayName} PIT 覆盖不足`),
      ...(previewError ? ['LOCAL_API_UNAVAILABLE'] : []),
    ],
    neutralizationStatus: {
      enabled: neutralizationEnabled,
      method: 'industry',
      status: previewError ? 'NOT_EXECUTED_PREVIEW_API_UNAVAILABLE' : 'LOCAL_PENDING_API_PREVIEW',
      blockers: previewError ? ['LOCAL_API_UNAVAILABLE'] : [],
    },
    warnings: previewError ? [previewError] : [],
    strategyCreationRisk: {
      can_create: localHardBlockers.length === 0 && !previewError,
      warning_count: 0,
      blocked_count: localHardBlockers.length,
      warnings: [],
      hard_blockers: localHardBlockers,
      summary_label: localHardBlockers.length ? '存在硬阻断' : '等待预览接口确认风险',
    },
  };
}

function previewTone(status: string, blockers: string[]): 'good' | 'warn' | 'bad' {
  if (status === 'READY' && blockers.length === 0) return 'good';
  if (blockers.length > 0 || status === 'BLOCKED') return 'bad';
  return 'warn';
}

function coverageAdvice(value: number, pending: boolean): string {
  if (pending) return '等待预览结果后评估样本有效性。';
  if (value >= 90) return '覆盖稳健，可进入门禁复核。';
  if (value >= 80) return '覆盖可用，建议检查低覆盖因子。';
  return '覆盖偏低，先补齐 PIT 样本。';
}

function turnoverAdvice(value: number, pending: boolean): string {
  if (pending) return '等待预览结果后评估调仓压力。';
  if (value <= 15) return '换手温和，成本压力可控。';
  if (value <= 30) return '换手适中，建议复核成本假设。';
  return '换手偏高，建议降低高频信号权重。';
}

function scoreSpreadAdvice(value: number, pending: boolean): string {
  if (pending) return '等待预览结果后评估分层能力。';
  if (value >= 1) return '分层清晰，可继续检查尾部风险。';
  if (value >= 0.4) return '分层可用，建议观察边际样本。';
  return '分层偏弱，建议调整权重或方向。';
}

export function FactorModelBuilderPage({
  api,
  autoPreviewDelayMs = 0,
  factors = DEFAULT_FACTORS,
  initialPrefill,
  useDefaultFallback = true,
  defaultSelectAll = true,
  onCreated,
}: FactorModelBuilderPageProps): JSX.Element {
  const basketFactors = useMemo(() => modelBasket(factors, useDefaultFallback), [factors, useDefaultFallback]);
  const [modelName, setModelName] = useState(DEFAULT_MODEL_NAME);
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    defaultSelectAll ? basketFactors.map((factor) => factor.id) : [],
  );
  const [selections, setSelections] = useState<FactorModelSelection[]>(() => normalizeSelections(factors, useDefaultFallback));
  const [neutralizationEnabled, setNeutralizationEnabled] = useState(false);
  const [rebalanceFrequency, setRebalanceFrequency] = useState('monthly');
  const [preview, setPreview] = useState<FactorModelPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const previewRequestSeq = useRef(0);
  const prefillAppliedRef = useRef('');

  const selectedFactors = useMemo(
    () => basketFactors.filter((factor) => selectedIds.includes(factor.id)),
    [basketFactors, selectedIds],
  );
  const selectedSelections = useMemo(
    () => selections.filter((selection) => selectedIds.includes(selection.factorId)),
    [selectedIds, selections],
  );
  const weightTotal = selectedSelections.reduce((total, selection) => total + selection.weightPct, 0);
  const minPitCoverage = selectedFactors.length
    ? Math.min(...selectedFactors.map((factor) => factor.pitCoveragePct))
    : 0;
  const weightBlocked = Math.round(weightTotal) !== 100;
  const modelNameBlocked = modelName.trim().length === 0;

  const neutralization: FactorModelNeutralizationConfig = useMemo(() => ({
    enabled: neutralizationEnabled,
    taxonomy: 'GICS',
    level: 'Level 1',
    method: 'ZScore 后残差化',
  }), [neutralizationEnabled]);

  const payload: FactorModelPreviewPayload = useMemo(() => ({
    modelName: modelName.trim(),
    factors: selectedSelections,
    neutralization,
    rebalanceFrequency,
  }), [modelName, neutralization, rebalanceFrequency, selectedSelections]);
  const payloadKey = useMemo(() => JSON.stringify(payload), [payload]);
  const prefillKey = useMemo(() => JSON.stringify(initialPrefill ?? null), [initialPrefill]);
  const localPreview = useMemo(
    () => buildLocalPreview(selectedFactors, selectedSelections, neutralizationEnabled, previewError),
    [neutralizationEnabled, previewError, selectedFactors, selectedSelections],
  );
  const activePreview = preview ?? localPreview;
  const neutralizationBlockers = activePreview.neutralizationStatus.blockers;
  const strategyRisk = previewStrategyRisk(activePreview);
  const explicitStrategyRisk = strategyRisk !== null;
  const strategyHardBlockers = strategyRisk?.hard_blockers ?? [];
  const strategyWarnings = [
    ...(strategyRisk?.warnings ?? []),
    ...(!strategyRisk ? activePreview.warnings.map((warning) => ({
      code: 'PREVIEW_WARNING',
      severity: 'warning',
      label: warning,
      message: warning,
    })) : []),
  ];
  const pitBlocked = activePreview.pitBlockers.length > 0 || minPitCoverage < 80;
  const neutralizationBlocked =
    neutralizationEnabled &&
    (neutralizationBlockers.length > 0 || activePreview.neutralizationStatus.status.startsWith('NOT_EXECUTED'));
  const legacyPreviewBlocked =
    Boolean(previewError) ||
    activePreview.status === 'BLOCKED' ||
    pitBlocked ||
    neutralizationBlocked;
  const policyHardBlocked =
    strategyHardBlockers.length > 0 ||
    (strategyRisk?.can_create === false && strategyHardBlockers.length === 0) ||
    (!explicitStrategyRisk && legacyPreviewBlocked);
  const previewBlocked =
    activePreview.status === 'LOCAL_PENDING_API_PREVIEW' ||
    policyHardBlocked;
  const canCreate =
    Boolean(api?.createFactorModel) &&
    !modelNameBlocked &&
    selectedFactors.length > 0 &&
    !weightBlocked &&
    !previewBlocked &&
    !isCreating &&
    !isPreviewing;
  const toggleFactor = (factor: FactorModelOption): void => {
    setSelectedIds((current) => {
      if (current.includes(factor.id)) {
        return current.filter((id) => id !== factor.id);
      }
      return [...current, factor.id];
    });
  };

  useEffect(() => {
    if (!initialPrefill?.factorIds.length) return;
    const availableIds = new Set(basketFactors.map((factor) => factor.id));
    const nextIds = initialPrefill.factorIds.filter((factorId) => availableIds.has(factorId));
    if (!nextIds.length) return;
    const appliedKey = `${prefillKey}:${nextIds.join('|')}`;
    if (prefillAppliedRef.current === appliedKey) return;
    prefillAppliedRef.current = appliedKey;
    setSelectedIds(nextIds);
    setSelections((current) => {
      const currentById = new Map(current.map((selection) => [selection.factorId, selection]));
      return basketFactors.map((factor) => {
        const prefillIndex = initialPrefill.factorIds.indexOf(factor.id);
        const existing = currentById.get(factor.id);
        const defaultSelection = existing ?? {
          factorId: factor.id,
          weightPct: factor.defaultWeight,
          direction: factor.defaultDirection,
        };
        if (prefillIndex === -1) return defaultSelection;
        const weight = initialPrefill.weights[prefillIndex];
        return {
          factorId: factor.id,
          weightPct: Number.isFinite(weight) ? Math.max(0, Math.min(100, Number(weight))) : defaultSelection.weightPct,
          direction: normalizePrefillDirection(initialPrefill.directions[prefillIndex], defaultSelection.direction),
        };
      });
    });
    if (initialPrefill.modelName) {
      setModelName(initialPrefill.modelName);
    }
    setNotice('治理队列已代入因子与建议权重，当前仍为待审查草稿。');
  }, [basketFactors, initialPrefill, prefillKey]);

  const updateWeight = (factorId: string, rawValue: string): void => {
    const value = Math.max(0, Math.min(100, Number(rawValue) || 0));
    setSelections((current) =>
      current.map((selection) =>
        selection.factorId === factorId ? { ...selection, weightPct: value } : selection,
      ),
    );
  };

  const runPreview = useCallback(async (announce = true): Promise<void> => {
    const requestSeq = previewRequestSeq.current + 1;
    previewRequestSeq.current = requestSeq;
    setIsPreviewing(true);
    setPreviewError(null);
    if (selectedFactors.length === 0 || selectedSelections.length === 0) {
      if (previewRequestSeq.current === requestSeq) {
        setPreview(buildLocalPreview(selectedFactors, selectedSelections, neutralizationEnabled, null));
        setIsPreviewing(false);
        if (announce) setNotice('暂无可预览因子。');
      }
      return;
    }
    if (!api?.previewFactorModel) {
      if (previewRequestSeq.current === requestSeq) {
        setPreview(buildLocalPreview(selectedFactors, selectedSelections, neutralizationEnabled, null));
        setIsPreviewing(false);
        if (announce) setNotice('已完成本地权重与 PIT 校验；未连接打分预览接口。');
      }
      return;
    }
    try {
      const response = await api.previewFactorModel(payload);
      if (previewRequestSeq.current !== requestSeq) return;
      setPreview(response);
      if (announce) setNotice('已通过预览接口刷新多因子打分和门禁状态。');
    } catch {
      if (previewRequestSeq.current !== requestSeq) return;
      const message = '预览接口不可用，当前不能物化策略。';
      setPreviewError(message);
      setPreview(buildLocalPreview(selectedFactors, selectedSelections, neutralizationEnabled, message));
      if (announce) setNotice(message);
    } finally {
      if (previewRequestSeq.current === requestSeq) {
        setIsPreviewing(false);
      }
    }
  }, [api, neutralizationEnabled, payload, selectedFactors, selectedSelections]);

  useEffect(() => {
    setPreview(null);
    if (autoPreviewDelayMs > 0) {
      const timer = window.setTimeout(() => {
        void runPreview(false);
      }, autoPreviewDelayMs);
      return () => window.clearTimeout(timer);
    }
    void runPreview(false);
    return undefined;
  }, [autoPreviewDelayMs, payloadKey, runPreview]);

  const saveDraft = (): void => {
    setNotice('草稿已保存。');
  };

  const createModel = async (): Promise<void> => {
    if (!api?.createFactorModel) {
      setNotice('创建接口不可用，当前不能物化策略。');
      return;
    }
    if (!canCreate) return;
    setIsCreating(true);
    try {
      const response = await api.createFactorModel(payload);
      setNotice(`已创建多因子策略：${response.strategy_id}`);
      if (onCreated) {
        onCreated(response.strategy_id);
      } else if (typeof window !== 'undefined') {
        window.location.hash = `#/strategies/${response.strategy_id}`;
      }
    } finally {
      setIsCreating(false);
    }
  };

  const neutralizationValue = neutralizationBlocked
    ? '未执行'
    : activePreview.neutralizationStatus.enabled
      ? '已执行'
      : '未启用';
  const neutralizationPitValue = neutralizationBlockers.length
    ? neutralizationBlockers.map(blockerLabel).join('、')
    : activePreview.neutralizationStatus.enabled
      ? '可用'
      : '未启用';
  const policyBlockers = Array.from(
    new Set([
      ...(strategyHardBlockers.length ? strategyHardBlockers.map(riskItemLabel) : []),
      ...(!explicitStrategyRisk ? activePreview.pitBlockers.map(blockerLabel) : []),
      ...(!explicitStrategyRisk ? neutralizationBlockers.map(blockerLabel) : []),
      ...(strategyRisk?.can_create === false && strategyHardBlockers.length === 0 ? ['策略创建风险策略阻断'] : []),
      ...(previewError ? ['预览接口不可用'] : []),
    ]),
  ).filter(Boolean);
  const inputBlockers = Array.from(
    new Set([
      ...(modelNameBlocked ? ['策略名称未填写'] : []),
      ...(weightBlocked ? [`权重合计为 ${pct(weightTotal, 0)}`] : []),
    ]),
  ).filter(Boolean);
  const warningLabels = Array.from(new Set(strategyWarnings.map(riskItemLabel).filter(Boolean)));
  const strategyRiskLabel =
    typeof strategyRisk?.summary_label === 'string' && strategyRisk.summary_label.trim()
      ? strategyRisk.summary_label
      : null;
  const strategyRiskSummary =
    typeof strategyRisk?.summary === 'string' && strategyRisk.summary.trim()
      ? strategyRisk.summary
      : null;
  const riskSummaryTone: 'good' | 'warn' | 'bad' = policyBlockers.length || inputBlockers.length
    ? 'bad'
    : warningLabels.length
      ? 'warn'
      : 'good';
  const pitSoftenedForAdmission =
    explicitStrategyRisk &&
    strategyRisk?.blocked_count === 0 &&
    strategyRiskLabel === '低风险准入' &&
    activePreview.pitBlockers.length > 0;
  const pitGateValue = pitBlocked ? (pitSoftenedForAdmission ? '低风险提示' : '阻断') : '通过';
  const pitGateTone: 'good' | 'warn' | 'bad' = pitBlocked ? (pitSoftenedForAdmission ? 'warn' : 'bad') : 'good';
  const pricePitValue = minPitCoverage < 80 ? (pitSoftenedForAdmission ? '低风险提示' : '阻断') : '通过';
  const pricePitTone: 'good' | 'warn' | 'bad' = minPitCoverage < 80 ? (pitSoftenedForAdmission ? 'warn' : 'bad') : 'good';
  const selectedRebalanceOption =
    REBALANCE_OPTIONS.find((option) => option.value === rebalanceFrequency) ?? REBALANCE_OPTIONS[0];
  const gateRows: Array<{ label: string; value: string; tone: 'good' | 'warn' | 'bad' }> = [
    { label: '基础面 available_at 校验', value: pitGateValue, tone: pitGateTone },
    { label: '价格与 Universe PIT', value: pricePitValue, tone: pricePitTone },
    { label: '行业中性化', value: neutralizationValue, tone: neutralizationBlocked ? 'bad' : 'good' },
    { label: '行业 PIT 状态', value: neutralizationPitValue, tone: neutralizationBlocked ? 'bad' : 'good' },
    { label: '策略名称', value: modelNameBlocked ? '待填写' : '已填写', tone: modelNameBlocked ? 'bad' : 'good' },
    { label: '权重合计', value: pct(weightTotal, 0), tone: weightBlocked ? 'bad' : 'good' },
    { label: '再平衡配置', value: selectedRebalanceOption.label, tone: 'good' },
    { label: '预览状态', value: localizePreviewStatus(activePreview.status), tone: previewTone(activePreview.status, policyBlockers) },
    {
      label: '实盘准入',
      value: policyBlockers.length ? '阻断' : strategyRiskLabel ?? (warningLabels.length ? '风险提示' : '低风险'),
      tone: riskSummaryTone,
    },
    { label: '策略类型', value: '多因子策略', tone: 'good' },
  ];
  const riskTitle = policyBlockers.length
    ? '存在硬阻断'
    : inputBlockers.length
      ? '创建信息待补'
    : warningLabels.length
      ? strategyRiskLabel ?? '可创建，需确认风险'
      : '可创建，无新增风险';
  const riskCopy = policyBlockers.length
    ? `不能创建：${policyBlockers.join('；')}。`
    : inputBlockers.length
      ? `当前阻塞：${inputBlockers.join('；')}。`
    : strategyRiskSummary
      ? strategyRiskSummary
    : warningLabels.length
      ? `可创建但需提示：${warningLabels.join('；')}。`
      : activePreview.status === 'READY'
        ? `预览接口返回通过：${activePreview.readyFactorCount}/${activePreview.factorCount} 个因子可用，覆盖 ${pct(activePreview.coveragePct)}。`
        : '等待预览接口返回 PIT、权重、中性化与打分样本。';
  const scorePending = isPreviewing && !preview;
  const scoreCards = [
    { label: '有效覆盖率', value: scorePending ? '读取中' : pct(activePreview.coveragePct), note: coverageAdvice(activePreview.coveragePct, scorePending) },
    { label: '预估换手', value: scorePending ? '读取中' : pct(activePreview.turnoverPct), note: turnoverAdvice(activePreview.turnoverPct, scorePending) },
    { label: '得分分布跨度', value: scorePending ? '读取中' : activePreview.scoreSpread.toFixed(2), note: scoreSpreadAdvice(activePreview.scoreSpread, scorePending) },
  ];
  const scoreBars = activePreview.scorePreview.slice(0, 10);
  const scoreValues = scoreBars.map((item) => item.score);
  const minScore = scoreValues.length ? Math.min(...scoreValues) : 0;
  const maxScore = scoreValues.length ? Math.max(...scoreValues) : 0;
  const scoreSpan = Math.max(maxScore - minScore, 0.0001);

  return (
    <main className="factor-phase2-page factor-model-builder-page" data-page-root="factor-model-builder">
      <section className="factor-phase2-hero" aria-labelledby="factor-model-title">
        <div>
          <p className="factor-phase2-hero__eyebrow">多因子策略</p>
          <h1 id="factor-model-title">多因子策略创建</h1>
          <p>
            从系统默认因子和已验证人工因子中选择信号，配置权重、方向和行业中性化，零写入预览覆盖率、打分分布和换手，再物化为可回测策略。
          </p>
        </div>
        <div className="factor-phase2-actions" aria-label="多因子策略创建操作">
          <button className="factor-phase2-button" type="button" onClick={saveDraft}>
            保存草稿
          </button>
          <button className="factor-phase2-button" type="button" disabled={isPreviewing} onClick={() => void runPreview()}>
            {isPreviewing ? '预览中' : '预览打分'}
          </button>
          <button
            className="factor-phase2-button factor-phase2-button--primary"
            type="button"
            disabled={!canCreate}
            onClick={() => void createModel()}
          >
            创建可回测策略
          </button>
        </div>
      </section>

      {initialPrefill?.factorIds.length ? (
        <section className="factor-model-prefill-banner" aria-label="治理队列代入提示">
          <div>
            <strong>治理队列已代入</strong>
            <span>
              已选 {selectedIds.length} 个因子与建议权重，进入创建页后仍需预览、门禁和人工确认。
            </span>
          </div>
          <span className="factor-phase2-chip factor-phase2-chip--info">草稿 / 待审查</span>
        </section>
      ) : null}

      <section className="factor-phase2-workbench factor-phase2-workbench--model" aria-label="多因子模型工作台">
        <section className="factor-phase2-panel" aria-labelledby="factor-model-select">
          <div className="factor-phase2-panel__header">
            <div>
              <h2 id="factor-model-select">选择因子</h2>
              <p>只允许可诊断或沙盒可跑的因子参与预览。</p>
            </div>
          </div>
          <div className="factor-phase2-panel__body">
            <label className="factor-model-name-control">
              <span>策略名称</span>
              <input
                aria-label="策略名称"
                maxLength={80}
                onChange={(event) => setModelName(event.target.value)}
                placeholder="输入策略名称"
                type="text"
                value={modelName}
              />
            </label>
            <div className="factor-phase2-list factor-model-selector-list">
              {basketFactors.length === 0 ? (
                <div className="factor-empty-state">因子接口未返回可用因子，当前无法创建策略。</div>
              ) : null}
              {basketFactors.map((factor) => {
                const isSelected = selectedIds.includes(factor.id);
                return (
                  <div className={`factor-pick${isSelected ? '' : ' factor-pick--inactive'}`} key={factor.id}>
                    <input
                      aria-label={`选择${factor.displayName}`}
                      checked={isSelected}
                      onChange={() => toggleFactor(factor)}
                      type="checkbox"
                    />
                    <div>
                      <strong>{factor.displayName}</strong>
                      <span className="factor-id">{factor.id}</span>
                      <FactorMetricTags factor={factor} context="选择卡片" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="factor-phase2-panel" aria-labelledby="factor-model-preview">
          <div className="factor-phase2-panel__header">
            <div>
              <h2 id="factor-model-preview">权重与打分预览</h2>
              <p>MAD/Winsorize、ZScore、方向调整和行业中性化统一由表达式引擎执行。</p>
            </div>
            <span className="factor-phase2-chip factor-phase2-chip--good">零写入预览</span>
          </div>
          <div className="factor-phase2-panel__body">
            <div className="score-grid">
              {scoreCards.map((card) => (
                <div className="score-card" key={card.label}>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                  <small>{card.note}</small>
                </div>
              ))}
            </div>
            <div className="factor-model-weight-controls" aria-label="已选择因子权重操作条">
              {selectedFactors.map((factor) => {
                const selection = selectedSelections.find((item) => item.factorId === factor.id);
                const weight = selection?.weightPct ?? factor.defaultWeight;
                return (
                  <div className="factor-model-weight-row" key={factor.id}>
                    <div className="factor-model-weight-row__meta">
                      <div className="factor-model-weight-row__title">
                        <strong>{factor.displayName}</strong>
                        <span className="factor-id">{factor.id}</span>
                      </div>
                      <FactorMetricTags factor={factor} context="权重卡片" />
                    </div>
                    <div className="factor-weight-control factor-weight-control--preview">
                      <label htmlFor={`factor-weight-${factor.id}`}>权重</label>
                      <input
                        aria-label={`${factor.displayName}权重滑块`}
                        id={`factor-weight-${factor.id}`}
                        max="100"
                        min="0"
                        onChange={(event) => updateWeight(factor.id, event.target.value)}
                        step="1"
                        type="range"
                        value={weight}
                      />
                      <input
                        aria-label={`${factor.displayName}权重`}
                        inputMode="numeric"
                        max="100"
                        min="0"
                        onChange={(event) => updateWeight(factor.id, event.target.value)}
                        type="number"
                        value={weight}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="factor-model-governance-row" aria-label="再平衡与行业中性化配置">
              <div className="factor-model-rebalance-control" role="group" aria-labelledby="factor-model-rebalance-label">
                <div className="factor-model-rebalance-control__header">
                  <span id="factor-model-rebalance-label">再平衡配置</span>
                  <small>{selectedRebalanceOption.summary}</small>
                </div>
                <div className="factor-model-rebalance-options">
                  {REBALANCE_OPTIONS.map((option) => (
                    <label
                      className={`factor-model-rebalance-option${option.value === rebalanceFrequency ? ' factor-model-rebalance-option--active' : ''}`}
                      key={option.value}
                    >
                      <input
                        checked={option.value === rebalanceFrequency}
                        name="factor-model-rebalance-frequency"
                        onChange={() => setRebalanceFrequency(option.value)}
                        type="radio"
                        value={option.value}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="neutral-block">
                <div className="neutral-title">
                  <div>
                    <strong>启用行业中性化</strong>
                    <span className="factor-id">GICS · PIT 行业字段</span>
                  </div>
                  <button
                    aria-label={neutralizationEnabled ? '关闭行业中性化' : '启用行业中性化'}
                    aria-pressed={neutralizationEnabled}
                    className={`switch${neutralizationEnabled ? '' : ' switch--off'}`}
                    onClick={() => setNeutralizationEnabled((current) => !current)}
                    type="button"
                  >
                    <span className="sr-only">{neutralizationEnabled ? '行业中性化已启用' : '行业中性化已关闭'}</span>
                  </button>
                </div>
                <div className="neutral-grid">
                  <div className="neutral-card">
                    <strong>覆盖</strong>
                    <span>{neutralizationPitValue === '可用' ? '行业 PIT 可用' : neutralizationPitValue}</span>
                  </div>
                  <div className="neutral-card">
                    <strong>阶段</strong>
                    <span>{neutralizationBlocked ? `未执行：${neutralizationPitValue}` : neutralizationEnabled ? '打分前行业残差化' : '保留原始截面分'}</span>
                  </div>
                  <div className="neutral-card">
                    <strong>缺口</strong>
                    <span>{activePreview.warnings[0] ?? (neutralizationEnabled ? '无缺口，允许物化' : '未启用，无需行业 PIT')}</span>
                  </div>
                </div>
              </div>
            </div>
            <svg viewBox="0 0 680 150" width="100%" height="150" role="img" aria-label="多因子得分分布">
              <rect x="0" y="0" width="680" height="150" rx="14" fill="#f9fafb" />
              <line x1="36" y1="118" x2="650" y2="118" stroke="#d7e1e5" />
              {scoreBars.length ? scoreBars.map((point, index) => {
                const height = 24 + ((point.score - minScore) / scoreSpan) * 68;
                const x = 70 + index * 48;
                const y = 118 - height;
                const fill = index < 2 ? '#dbeafe' : index < 4 ? '#9dd6cf' : index < 7 ? '#1f877b' : '#bfdbfe';
                return <rect key={`${point.symbol}-${index}`} x={x} y={y} width="38" height={height} rx="5" fill={fill} />;
              }) : (
                <text x="236" y="78" fill="#64748b" fontSize="13" fontWeight="600">等待预览接口返回样本</text>
              )}
              <text x="70" y="138" fill="#64748b" fontSize="12">{scoreBars[0]?.symbol ?? '低分'}</text>
              <text x="408" y="138" fill="#64748b" fontSize="12">{scoreBars[scoreBars.length - 1]?.symbol ?? '高分'}</text>
              <text x="244" y="20" fill="#176b61" fontSize="13" fontWeight="700">
                {scoreBars.length ? `样本 ${scoreBars.length} 个 · 分布跨度 ${activePreview.scoreSpread.toFixed(2)}` : '零写入打分样本'}
              </text>
            </svg>
          </div>
        </section>

        <section className="factor-phase2-panel" aria-labelledby="factor-model-gates">
          <div className="factor-phase2-panel__header">
            <div>
              <h2 id="factor-model-gates">策略创建风险</h2>
              <p>区分风险提示与硬阻断；高相关只提示，PIT 与表达式问题才阻断。</p>
            </div>
          </div>
          <div className="factor-phase2-panel__body">
            <div className="audit-list">
              {gateRows.map((row) => (
                <div className="audit-row" key={row.label}>
                  <span>{row.label}</span>
                  <span className={`factor-phase2-chip factor-phase2-chip--${row.tone}`}>{row.value}</span>
                </div>
              ))}
            </div>
            <div className={`strategy-risk-module strategy-risk-module--${riskSummaryTone}`} aria-label="策略创建风险模块">
              <div className="strategy-risk-summary">
                <span className={`factor-phase2-chip factor-phase2-chip--${riskSummaryTone}`}>{riskTitle}</span>
                <p>{riskCopy}</p>
              </div>
              {policyBlockers.length ? (
                <div className="strategy-risk-list" aria-label="硬阻断">
                  <strong>硬阻断</strong>
                  {policyBlockers.slice(0, 4).map((blocker) => <span key={blocker}>{blocker}</span>)}
                </div>
              ) : null}
              {warningLabels.length ? (
                <div className="strategy-risk-list strategy-risk-list--warning" aria-label="风险提示">
                  <strong>风险提示</strong>
                  {warningLabels.slice(0, 4).map((warning) => <span key={warning}>{warning}</span>)}
                </div>
              ) : null}
              {!policyBlockers.length && !warningLabels.length ? (
                <div className="strategy-risk-list strategy-risk-list--clear">
                  <strong>创建口径</strong>
                  <span>当前没有高相关、诊断过期或硬阻断；创建后进入既有回测链路。</span>
                </div>
              ) : null}
            </div>
            <button
              className="factor-phase2-button factor-phase2-button--primary factor-model-submit"
              disabled={!canCreate}
              type="button"
              onClick={() => void createModel()}
            >
              创建可回测策略
            </button>
          </div>
        </section>
      </section>

      <p className="sr-only" role="status">{notice ?? ''}</p>
    </main>
  );
}

export default FactorModelBuilderPage;

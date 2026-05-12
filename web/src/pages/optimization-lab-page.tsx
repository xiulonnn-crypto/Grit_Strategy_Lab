import { useEffect, useMemo, useState } from "react";
import { navigateTo } from "../lib/appRouteContext";
import type { FormEvent, WheelEvent as ReactWheelEvent } from "react";
import { useRef } from "react";
import { useApiClient } from "../lib/demoStoreContext";
import {
  collectOptimizationParameterSeeds,
  MULTI_FACTOR_NEUTRALIZATION_METHOD_OPTIONS,
  MULTI_FACTOR_SCORING_METHOD_OPTIONS,
  MOMENTUM_REBALANCE_FREQUENCY_OPTIONS,
  OBSERVATION_TIMEFRAME_OPTIONS,
} from "../lib/optimization-config-fields";
import { formatFactorWeightLabel } from "../lib/factor-display";
import {
  buildOptimizationConfigPath,
  buildOptimizationJobsPath,
  buildOptimizationSelectPath,
} from "../lib/optimization-routes";
import { formatStrategyVersionTag, getStrategyDisplayName } from "../lib/strategy-version";
import type {
  ApiBacktestRunDetail,
  ApiOptimizationConstraint,
  ApiOptimizationConstraintPresetKey,
  ApiOptimizationCandidate,
  ApiOptimizationFilteredResultCreatePayload,
  ApiOptimizationHeatmap,
  ApiOptimizationJobCreatePayload,
  ApiOptimizationJobDetail,
  ApiOptimizationJobListItem,
  ApiOptimizationSearchSpaceField,
  ApiOptimizationTrialSummary,
  ApiOptimizationValidationWindow,
  ApiStrategyDetail,
  ApiStrategyListItem,
  ParameterValue,
} from "../types";
import "./optimization-lab-page.css";

const FIRST_SCREEN_DEFER_MS = import.meta.env.MODE === 'test' ? 0 : 80;

type StepKey = "select" | "config" | "results";
type HeatmapMetricKey =
  | "annualized_return"
  | "return_sharpe"
  | "max_drawdown_pct";
type OptimizationDisplayCandidate = ApiOptimizationCandidate & {
  display_kind?: "candidate" | "baseline";
};
type OptimizationConstraintPresetKey = ApiOptimizationConstraintPresetKey;
type OptimizationConstraint = ApiOptimizationConstraint;
type OptimizationConstraintVerdict = "pass" | "watch" | "risk" | "info";
type OptimizationObjective =
  | "return_sharpe"
  | "annualized_return"
  | "composite_score";
type OptimizationAllCombinationSortKey =
  | "parameter_summary"
  | "annualized_return"
  | "return_sharpe"
  | "out_of_sample_sharpe"
  | "max_drawdown_pct"
  | "stability"
  | "composite_score"
  | "status";
type SortDirection = "asc" | "desc";
type OptimizationConstraintPreset = {
  key: OptimizationConstraintPresetKey;
  label: string;
  toneLabel: string;
  constraints: OptimizationConstraint[];
};
type OptimizationDiscreteOption = {
  value: string;
  label: string;
};

type OptimizationDiscreteFieldControlProps = {
  fieldKey: string;
  label: string;
  hint: string;
  options: OptimizationDiscreteOption[];
  values: string[];
  onChange: (values: string[]) => void;
};

const OPTIMIZATION_CANDIDATE_PANEL_LIMIT = 3;
const OPTIMIZATION_WEIGHT_SUM_CONSTRAINT_GROUP = "allocation_weight_sum_100";
const OPTIMIZATION_WEIGHT_SUM_TARGET = 100;
const OPTIMIZATION_DISCRETE_FIELD_OPTIONS: Record<
  string,
  OptimizationDiscreteOption[]
> = {
  observation_timeframe: OBSERVATION_TIMEFRAME_OPTIONS,
  rebalance_frequency: MOMENTUM_REBALANCE_FREQUENCY_OPTIONS,
  scoring_method: MULTI_FACTOR_SCORING_METHOD_OPTIONS,
  neutralization_method: MULTI_FACTOR_NEUTRALIZATION_METHOD_OPTIONS,
};

function normalizeDiscreteSelectionOrder(
  options: OptimizationDiscreteOption[],
  values: string[],
): string[] {
  const selected = new Set(values);
  return options
    .map((option) => option.value)
    .filter((value) => selected.has(value));
}

function OptimizationDiscreteFieldControl({
  fieldKey,
  label,
  hint,
  options,
  values,
  onChange,
}: OptimizationDiscreteFieldControlProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listboxId = `optimization-discrete-field-${fieldKey}`;
  const selectedOptions = useMemo(
    () => options.filter((option) => values.includes(option.value)),
    [options, values],
  );

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handlePointerDown(event: MouseEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  function toggleValue(value: string): void {
    const selected = values.includes(value);
    if (selected && values.length === 1) {
      return;
    }
    const nextValues = selected
      ? values.filter((item) => item !== value)
      : [...values, value];
    const normalizedValues = normalizeDiscreteSelectionOrder(options, nextValues);
    if (!normalizedValues.length) {
      return;
    }
    onChange(normalizedValues);
  }

  return (
    <div className="optimization-discrete-field" ref={rootRef}>
      <button
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`${label} 可选值`}
        className="optimization-discrete-field__trigger"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="optimization-discrete-field__tags">
          {selectedOptions.map((option) => (
            <span
              className="optimization-discrete-field__tag"
              key={`${fieldKey}-${option.value}`}
            >
              {option.label}
            </span>
          ))}
        </span>
        <span className="optimization-discrete-field__trigger-meta">
          已选 {selectedOptions.length} 项
        </span>
        <span
          aria-hidden="true"
          className={`optimization-discrete-field__chevron${
            open ? " optimization-discrete-field__chevron--open" : ""
          }`}
        >
          ▾
        </span>
      </button>

      {open ? (
        <div className="optimization-discrete-field__panel">
          <div className="optimization-discrete-field__panel-header">
            <strong>{label}</strong>
            <span>{selectedOptions.length} 项已选</span>
          </div>
          <ul
            aria-label={`${label} 可选值`}
            aria-multiselectable="true"
            className="optimization-discrete-field__options"
            id={listboxId}
            role="listbox"
          >
            {options.map((option) => {
              const checked = values.includes(option.value);
              return (
                <li
                  aria-selected={checked}
                  className="optimization-discrete-field__option-row"
                  key={`${fieldKey}-${option.value}`}
                  role="option"
                >
                  <label
                    className={`optimization-discrete-field__option${
                      checked
                        ? " optimization-discrete-field__option--selected"
                        : ""
                    }`}
                  >
                    <input
                      className="optimization-discrete-field__checkbox"
                      checked={checked}
                      onChange={() => toggleValue(option.value)}
                      type="checkbox"
                      value={option.value}
                    />
                    <span className="optimization-discrete-field__option-label">
                      {option.label}
                    </span>
                    {checked ? (
                      <span className="optimization-discrete-field__option-badge">
                        已选
                      </span>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <span className="optimization-discrete-field__hint">{hint}</span>
    </div>
  );
}

function formatOptimizationConstraintInputValue(
  value: number | null | undefined,
): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function OptimizationConstraintThresholdInput({
  ariaLabel,
  className,
  id,
  onCommitValue,
  step,
  value,
}: {
  ariaLabel: string;
  className?: string;
  id: string;
  onCommitValue: (value: number) => void;
  step: string;
  value: number | null | undefined;
}): JSX.Element {
  const [draftValue, setDraftValue] = useState(() =>
    formatOptimizationConstraintInputValue(value),
  );
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) {
      setDraftValue(formatOptimizationConstraintInputValue(value));
    }
  }, [editing, value]);

  function handleChange(nextValue: string): void {
    setDraftValue(nextValue);
    if (!nextValue.trim()) {
      return;
    }
    const parsed = Number(nextValue);
    if (!Number.isFinite(parsed)) {
      return;
    }
    onCommitValue(parsed);
  }

  return (
    <input
      aria-label={ariaLabel}
      className={className}
      id={id}
      inputMode="decimal"
      onBlur={() => {
        setEditing(false);
        setDraftValue(formatOptimizationConstraintInputValue(value));
      }}
      onChange={(event) => handleChange(event.target.value)}
      onFocus={() => setEditing(true)}
      step={step}
      type="number"
      value={draftValue}
    />
  );
}

function parsePositiveIntEnvVar(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseFloatEnvVar(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const OPTIMIZATION_POLL_FAST_INTERVAL_MS = Math.max(
  1,
  parsePositiveIntEnvVar(import.meta.env.VITE_OPTIMIZATION_POLL_FAST_MS, 2000),
);
const OPTIMIZATION_POLL_MEDIUM_INTERVAL_MS = Math.max(
  1,
  parsePositiveIntEnvVar(import.meta.env.VITE_OPTIMIZATION_POLL_MEDIUM_MS, 2500),
);
const OPTIMIZATION_POLL_SLOW_INTERVAL_MS = Math.max(
  1,
  parsePositiveIntEnvVar(import.meta.env.VITE_OPTIMIZATION_POLL_SLOW_MS, 3000),
);
const OPTIMIZATION_POLL_JITTER = Math.min(
  1,
  parseFloatEnvVar(import.meta.env.VITE_OPTIMIZATION_POLL_JITTER, 0.05),
);
const OPTIMIZATION_POLL_NO_PROGRESS_MEDIUM_THRESHOLD = parsePositiveIntEnvVar(
  import.meta.env.VITE_OPTIMIZATION_NO_PROGRESS_MEDIUM_THRESHOLD,
  2,
);
const OPTIMIZATION_POLL_NO_PROGRESS_SLOW_THRESHOLD = parsePositiveIntEnvVar(
  import.meta.env.VITE_OPTIMIZATION_NO_PROGRESS_SLOW_THRESHOLD,
  4,
);
const HEATMAP_METRIC_OPTIONS: Array<{ key: HeatmapMetricKey; label: string }> =
  [
    { key: "annualized_return", label: "年化收益率" },
    { key: "return_sharpe", label: "收益夏普" },
    { key: "max_drawdown_pct", label: "最大回撤" },
  ];
const DEFAULT_CONSTRAINT_PRESET_KEY: OptimizationConstraintPresetKey =
  "balanced";
const DEFAULT_OPTIMIZATION_OBJECTIVE: OptimizationObjective = "return_sharpe";
const SUPPORTED_OPTIMIZATION_CONSTRAINT_KEYS = new Set([
  "max_drawdown_pct",
  "out_of_sample_sharpe",
  "annualized_return",
  "stability",
  "return_sharpe",
]);
const OPTIMIZATION_OBJECTIVE_OPTIONS: Array<{
  key: OptimizationObjective;
  label: string;
}> = [
  { key: "return_sharpe", label: "收益夏普 Max" },
  { key: "annualized_return", label: "年化收益率 Max" },
  { key: "composite_score", label: "综合得分 Max" },
];
const ALL_COMBINATIONS_PAGE_SIZE = 100;
const OPTIMIZATION_DETAIL_ROUTE_MATCHING_LIMIT = 250;
const OPTIMIZATION_CONSTRAINT_PRESETS: OptimizationConstraintPreset[] = [
  {
    key: "balanced",
    label: "平衡型",
    toneLabel: "基准",
    constraints: [
      {
        key: "max_drawdown_pct",
        label: "最大回撤",
        category: "risk",
        operator: "<=",
        value: 25,
        unit: "%",
        source: "preset",
      },
      {
        key: "return_sharpe",
        label: "收益夏普",
        category: "return",
        operator: ">=",
        value: 1,
        unit: "",
        source: "preset",
      },
      {
        key: "annualized_return",
        label: "年化收益率",
        category: "return",
        operator: ">=",
        value: 8,
        unit: "%",
        source: "preset",
      },
      {
        key: "stability",
        label: "稳定度",
        category: "stability",
        operator: ">=",
        value: 70,
        unit: "pts",
        source: "preset",
      },
      {
        key: "out_of_sample_sharpe",
        label: "样本外夏普",
        category: "stability",
        operator: ">=",
        value: 0.8,
        unit: "",
        source: "preset",
      },
    ],
  },
  {
    key: "defensive",
    label: "稳健型",
    toneLabel: "防御",
    constraints: [
      {
        key: "max_drawdown_pct",
        label: "最大回撤",
        category: "risk",
        operator: "<=",
        value: 20,
        unit: "%",
        source: "preset",
      },
      {
        key: "return_sharpe",
        label: "收益夏普",
        category: "return",
        operator: ">=",
        value: 0.9,
        unit: "",
        source: "preset",
      },
      {
        key: "annualized_return",
        label: "年化收益率",
        category: "return",
        operator: ">=",
        value: 6,
        unit: "%",
        source: "preset",
      },
      {
        key: "stability",
        label: "稳定度",
        category: "stability",
        operator: ">=",
        value: 78,
        unit: "pts",
        source: "preset",
      },
      {
        key: "out_of_sample_sharpe",
        label: "样本外夏普",
        category: "stability",
        operator: ">=",
        value: 0.92,
        unit: "",
        source: "preset",
      },
    ],
  },
  {
    key: "offensive",
    label: "进攻型",
    toneLabel: "进攻",
    constraints: [
      {
        key: "max_drawdown_pct",
        label: "最大回撤",
        category: "risk",
        operator: "<=",
        value: 30,
        unit: "%",
        source: "preset",
      },
      {
        key: "return_sharpe",
        label: "收益夏普",
        category: "return",
        operator: ">=",
        value: 1.15,
        unit: "",
        source: "preset",
      },
      {
        key: "annualized_return",
        label: "年化收益率",
        category: "return",
        operator: ">=",
        value: 12,
        unit: "%",
        source: "preset",
      },
      {
        key: "stability",
        label: "稳定度",
        category: "stability",
        operator: ">=",
        value: 60,
        unit: "pts",
        source: "preset",
      },
      {
        key: "out_of_sample_sharpe",
        label: "样本外夏普",
        category: "stability",
        operator: ">=",
        value: 0.65,
        unit: "",
        source: "preset",
      },
    ],
  },
];
const VALIDATION_WINDOW_GUIDANCE =
  "窗口 A 为样本外起始验证窗口，用于检验参数迁移后的收益延续性、成交约束适应性与初始稳定度；窗口 B 为中性主样本窗口，用于衡量策略在常态市场环境中的收益风险比、回撤控制与持仓执行一致性；窗口 C 为近期压力窗口，用于观察波动放大或风格切换阶段的收益衰减、回撤漂移与稳健性边界。";
const UTF8_DECODER = new TextDecoder("utf-8");

const TEXT = {
  jobsActionColumn: "操作",
  jobsDeleteAction: "删除",
  jobsDeleteTitle: "删除优化任务",
  jobsDeleteConfirm: "确认",
  jobsDeleteCopy:
    "逻辑删除后，该任务会从列表与详情页隐藏；若后台计算已经启动，本次删除不会中断正在执行的计算进程。",
  jobsDeleting: "正在删除...",
  cancel: "取消",
  jobsTitle: "优化任务列表",
  jobsCopy: "默认入口，先看任务再决定下一步。",
  jobsLoading: "正在加载优化任务...",
  jobsEmpty: "暂无优化任务，先创建一条新的优化任务。",
  createJob: "创建优化任务",
  backToJobs: "返回任务列表",
  selectTitle: "先决定要优化哪条策略",
  selectCopy: "保持列表式浏览，选中策略后直接进入参数配置。",
  configTitle: "参数配置",
  configCopy: "确认搜索边界、验证方式和预算，然后启动优化。",
  resultsTitle: "结果中心",
  resultsCopy: "回看候选版本、稳定性和参数热区。",
  continueTune: "继续调参",
  resumeOptimization: "继续优化",
  promoteVersion: "晋升当前版本",
  resetPreset: "恢复预设",
  startOptimization: "启动优化",
  selectStrategy: "选择策略",
  selectedStrategy: "已选择",
  candidatePanel: "参数候选盘",
  stabilityCenter: "稳定策略中心",
  heatmapPanel: "参数热区",
  validationPanel: "多窗口验证",
  candidateShelf: "快速切换候选版本",
} as const;

const PANEL_SUBTITLES = {
  candidatePanel:
    "按综合评分排序复核本轮参数组合，优先比较年化收益、样本外表现与回撤约束，再决定是否进入晋升评估。",
  stabilityCenter:
    "聚焦首选参数的风险收益平衡与稳健性证据，用于判断其是否具备晋升为正式参数版本的条件。",
  heatmapPanel:
    "观察关键参数在局部搜索空间内的绩效梯度，识别高收益高回撤陷阱与更稳健的甜区。",
  validationPanel:
    "按不同市场窗口复核策略表现，重点检查年化收益延续性、样本外衰减与回撤漂移。",
} as const;

const RERUN_ACTION_LABEL = "重新生成任务";
const RERUN_DIALOG_TITLE = "确认重新生成优化任务";
const RERUN_DIALOG_COPY =
  "沿用当前任务的参数范围、验证方式与约束条件，创建一条新的优化任务。";
const RERUN_DIALOG_CONFIRM = "确认生成";
const RERUN_DIALOG_SUBMITTING = "正在生成...";
const MISSING_SOURCE_RUN_NOTICE =
  "来源回测已失效，已改用当前策略参数作为优化基线。";
const HERO_PANEL_LAYOUT_STYLE = { flexWrap: "wrap" } as const;
const HERO_ACTIONS_LAYOUT_STYLE = { flexWrap: "wrap" } as const;
const HERO_ACTION_BUTTON_STYLE = {
  minWidth: "124px",
  whiteSpace: "nowrap",
} as const;

function humanizeKey(key: string): string {
  const labels: Record<string, string> = {
    lookback_months: "动量回看(月)",
    lookback_days: "回看天数",
    top_n: "买入排名阈值",
    max_position_pct: "最大单仓(%)",
    skip_recent_months: "跳过最近(月)",
    weighting_method: "加权方式",
    hold_rank_threshold: "保留排名阈值",
    grid_interval: "网格间距(%)",
    scoring_method: "打分方法",
    rebalance_frequency: "再平衡频率",
    neutralization_method: "中性化方法",
  };
  const factorWeightLabel = formatFactorWeightLabel(key);
  if (factorWeightLabel) {
    return `${factorWeightLabel}(%)`;
  }
  return labels[key] ?? key.replace(/_/g, " ");
}

function repairMojibakeText(value?: string | null): string | null {
  if (value === null || value === undefined || !/[\u0080-\u00FF]/.test(value)) {
    return value ?? null;
  }
  try {
    const bytes = Uint8Array.from(
      Array.from(value),
      (char) => char.charCodeAt(0) & 0xff,
    );
    const decoded = UTF8_DECODER.decode(bytes).replace(/\u0000/g, "");
    return /[\u3400-\u9FFF]/.test(decoded) ? decoded : value;
  } catch {
    return value;
  }
}

function translateOptimizationText(value?: string | null): string | null {
  const repaired = repairMojibakeText(value);
  if (repaired === null || repaired === undefined) {
    return null;
  }
  const text = repaired.trim();
  if (!text) {
    return repaired;
  }

  const exactReplacements: Array<[RegExp, string]> = [
    [/^Preparing trial\s+(\d+)\/(\d+)$/i, "\u51c6\u5907\u8bd5\u9a8c $1/$2"],
    [
      /^Resuming optimization from trial\s+(\d+)\.?$/i,
      "\u6b63\u5728\u4ece\u7b2c $1 \u7ec4\u7ee7\u7eed\u4f18\u5316\u3002",
    ],
    [/^Completed\s+(\d+)\/(\d+)\s+trials\.?$/i, "已完成 $1/$2 组试验。"],
    [/^Interrupted at\s+(\d+)\/(\d+)$/i, "已中断（$1/$2）"],
    [/^Running trial\s+(\d+)\/(\d+)$/i, "正在评估第 $1/$2 组"],
    [/^Evaluating trial\s+(\d+)\/(\d+)\.?$/i, "正在评估第 $1/$2 组。"],
    [
      /^Progress preserved at\s+(\d+)\/(\d+)\.\s*Click Continue Optimization to resume\.?$/i,
      "已保留 $1/$2 的进度，点击“继续优化”即可恢复。",
    ],
    [/^Optimization interrupted$/i, "优化已中断"],
    [/^Candidate\s+(\d+)$/i, "候选方案 $1"],
    [/^Manual Candidate\s+(\d+)$/i, "手动候选 $1"],
    [/^Trial\s+(\d+)$/i, "试验 $1"],
  ];
  for (const [pattern, replacement] of exactReplacements) {
    if (pattern.test(text)) {
      return text.replace(pattern, replacement);
    }
  }

  const directReplacements: Record<string, string> = {
    "Annualized Return": "年化收益率",
    "Return Sharpe": "收益夏普",
    "Out-of-sample Sharpe": "样本外夏普",
    "Max Drawdown": "最大回撤",
    Stability: "稳定度",
    "Window A": "窗口 A",
    "Window B": "窗口 B",
    "Window C": "窗口 C",
    "Current candidate meets the main promotion guardrails.":
      "当前候选已满足主要晋升护栏。",
    "Current candidate remains on the watchlist pending more cross-window evidence.":
      "当前候选仍处于观察名单，需等待更多跨窗口验证证据。",
    "Current candidate is only being kept as a boundary reference.":
      "当前候选仅作为参数边界参考保留。",
    "Annualized return is strong enough to support promotion review.":
      "年化收益率已达到正式版本晋升评估的收益门槛。",
    "Annualized return is usable, but still needs cross-window confirmation.":
      "年化收益率已具备可用性，但仍需跨窗口验证确认延续性。",
    "Annualized return is too weak to justify promotion.":
      "年化收益率偏弱，暂不足以支持版本晋升。",
    "Return Sharpe is in the promotion guardrail.": "收益夏普已进入晋升护栏。",
    "Return Sharpe is usable, but still needs more observation.":
      "收益夏普已具备可用性，但仍需继续观察。",
    "Out-of-sample Sharpe confirms the edge is carrying into unseen windows.":
      "样本外夏普表明优势已延续至未见样本窗口。",
    "Out-of-sample Sharpe is still soft and needs more confirmation.":
      "样本外夏普仍偏弱，需要更多验证确认。",
    "Out-of-sample Sharpe has degraded too much for promotion.":
      "样本外夏普衰减过大，暂不适合晋升。",
    "Drawdown remains inside the primary risk guardrail.":
      "最大回撤仍处于主要风险护栏以内。",
    "Drawdown is close to the guardrail and should be monitored.":
      "最大回撤已接近护栏，建议持续监控。",
    "Drawdown breaches the acceptable risk budget.":
      "最大回撤已突破可接受风险预算。",
    "The parameter neighborhood is stable enough to be reused.":
      "参数邻域稳定度充足，可作为可复用参数区间。",
    "Stability is acceptable, but the neighborhood still needs refinement.":
      "稳定度尚可，但参数邻域仍需进一步收敛。",
    "The parameter neighborhood remains unstable.": "参数邻域仍不稳定。",
    "This candidate already meets the core promotion guardrails. Use the validation windows to confirm the edge persists across different market regimes.":
      "该候选已满足核心晋升护栏，建议结合多窗口验证确认优势在不同市场阶段中的延续性。",
    "This candidate is usable as a watchlist contender, but it still needs stronger out-of-sample proof or tighter drawdown behavior before promotion.":
      "该候选可作为观察名单备选，但在晋升前仍需更强的样本外证据或更稳的回撤表现。",
    "This candidate is being kept as a boundary reference only. It helps define where returns improve at the cost of unstable risk.":
      "该候选仅作为边界参考保留，用于识别收益提升与风险失稳之间的分界位置。",
  };
  if (directReplacements[text]) {
    return directReplacements[text];
  }

  return text
    .replace(/\bWalk Forward\b/gi, "滚动前瞻验证")
    .replace(/\bContinue Optimization\b/gi, "继续优化")
    .replace(/\bOptimization interrupted\b/gi, "优化已中断")
    .replace(/\bCandidate\s+(\d+)\b/gi, "候选方案 $1")
    .replace(/\bManual Candidate\s+(\d+)\b/gi, "手动候选 $1")
    .replace(/\bTrial\s+(\d+)\b/gi, "试验 $1")
    .replace(/\bmax drawdown\b/gi, "最大回撤")
    .replace(/\boos\b/gi, "样本外")
    .replace(/\bsharpe\b/gi, "收益夏普")
    .replace(/\bdaily\b/gi, "每日")
    .replace(/\bweekly\b/gi, "每周")
    .replace(/\bmonthly\b/gi, "每月");
}

function getDisplayText(
  value: string | null | undefined,
  fallback = "-",
): string {
  const translated = translateOptimizationText(value);
  return translated && translated.trim() ? translated : fallback;
}

function getCandidateDisplayText(
  value: string | null | undefined,
  fallback = "-",
): string {
  const repaired = repairMojibakeText(value);
  if (repaired && /^best\s+candidate$/i.test(repaired.trim())) {
    return "最佳候选";
  }
  return getDisplayText(value, fallback);
}

function isTrialLikeCandidateDisplayText(
  value: string | null | undefined,
): boolean {
  const repaired = repairMojibakeText(value);
  if (!repaired) {
    return false;
  }
  return /^trial\s+\d+$/i.test(repaired.trim()) || /^试验\s+\d+$/u.test(repaired.trim());
}

function getCandidateVersionDisplayText(
  candidate: Pick<
    OptimizationDisplayCandidate,
    "display_kind" | "label" | "title" | "rank"
  >,
  fallback = "-",
): string {
  if (candidate.display_kind === "baseline") {
    return getCandidateDisplayText(candidate.title ?? candidate.label, fallback);
  }

  const translatedLabel = getCandidateDisplayText(candidate.label, "");
  if (translatedLabel && !isTrialLikeCandidateDisplayText(translatedLabel)) {
    return translatedLabel;
  }

  const translatedTitle = getCandidateDisplayText(candidate.title, "");
  if (translatedTitle && !isTrialLikeCandidateDisplayText(translatedTitle)) {
    return translatedTitle;
  }

  if (
    typeof candidate.rank === "number" &&
    Number.isFinite(candidate.rank) &&
    candidate.rank > 0
  ) {
    return `候选 ${candidate.rank}`;
  }

  return getCandidateDisplayText(candidate.label ?? candidate.title, fallback);
}

function isMostlyAsciiLabel(value: string): boolean {
  return /^[A-Za-z0-9_ %()./+:-]+$/.test(value);
}

function getSearchFieldDisplayLabel(
  field: Pick<ApiOptimizationSearchSpaceField, "key" | "label">,
): string {
  const factorWeightLabel = formatFactorWeightLabel(field.key);
  if (factorWeightLabel) {
    return factorWeightLabel;
  }
  const translatedLabel = translateOptimizationText(field.label);
  if (
    !translatedLabel ||
    translatedLabel === field.key ||
    isMostlyAsciiLabel(translatedLabel)
  ) {
    return humanizeKey(field.key);
  }
  return translatedLabel;
}

function getOptimizationConstraintPreset(
  key: OptimizationConstraintPresetKey,
): OptimizationConstraintPreset {
  return (
    OPTIMIZATION_CONSTRAINT_PRESETS.find((preset) => preset.key === key) ??
    OPTIMIZATION_CONSTRAINT_PRESETS[0]
  );
}

function cloneOptimizationConstraints(
  constraints: OptimizationConstraint[] | undefined,
  presetKey: OptimizationConstraintPresetKey = DEFAULT_CONSTRAINT_PRESET_KEY,
): OptimizationConstraint[] {
  const preset = getOptimizationConstraintPreset(presetKey);
  const sourceConstraints = Array.isArray(constraints)
    ? constraints.filter((constraint) =>
        SUPPORTED_OPTIMIZATION_CONSTRAINT_KEYS.has(constraint.key),
      )
    : preset.constraints;
  const presetOrder = new Map(
    preset.constraints.map((constraint, index) => [constraint.key, index]),
  );
  const effectiveConstraints = (
    sourceConstraints.length ? sourceConstraints : preset.constraints
  )
    .slice()
    .sort((left, right) => {
      const leftOrder = presetOrder.get(left.key) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = presetOrder.get(right.key) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder;
    });
  return effectiveConstraints.map((constraint) => {
    const presetConstraint = preset.constraints.find(
      (item) => item.key === constraint.key,
    );
    return {
      ...constraint,
      baseline_value: resolveOptimizationConstraintBaselineValue(
        constraint,
        presetConstraint,
      ),
      source: constraint.source ?? "preset",
    };
  });
}

function resolveOptimizationConstraintBaselineValue(
  constraint: OptimizationConstraint,
  presetConstraint?: OptimizationConstraint,
): number | null {
  if (
    typeof constraint.baseline_value === "number" &&
    Number.isFinite(constraint.baseline_value)
  ) {
    return constraint.baseline_value;
  }
  if (
    typeof presetConstraint?.baseline_value === "number" &&
    Number.isFinite(presetConstraint.baseline_value)
  ) {
    return presetConstraint.baseline_value;
  }
  if (
    typeof presetConstraint?.value === "number" &&
    Number.isFinite(presetConstraint.value)
  ) {
    return presetConstraint.value;
  }
  if (
    typeof constraint.value === "number" &&
    Number.isFinite(constraint.value)
  ) {
    return constraint.value;
  }
  return null;
}

function formatOptimizationConstraintCategory(
  category: OptimizationConstraint["category"],
): string {
  switch (category) {
    case "risk":
      return "风险护栏";
    case "stability":
      return "稳健性";
    case "return":
    default:
      return "收益质量";
  }
}

function formatOptimizationConstraintOperator(
  operator: OptimizationConstraint["operator"],
): string {
  return operator === ">=" ? "≥" : "≤";
}

function formatOptimizationConstraintThreshold(
  constraint: OptimizationConstraint,
): string {
  const precisionMap: Record<string, number> = {
    annualized_return: 1,
    out_of_sample_sharpe: 2,
    return_sharpe: 2,
    max_drawdown_pct: 1,
    stability: 0,
    turnover: 0,
  };
  const precision = precisionMap[constraint.key] ?? 0;
  const value = Number.isFinite(constraint.value)
    ? constraint.value.toFixed(precision)
    : String(constraint.value);
  return `${value}${constraint.unit}`;
}

function getOptimizationConstraintInputStep(constraintKey: string): string {
  return getOptimizationConstraintInputPrecision(constraintKey) === 1
    ? "0.1"
    : getOptimizationConstraintInputPrecision(constraintKey) === 2
      ? "0.01"
      : "1";
}

function getOptimizationConstraintInputPrecision(constraintKey: string): number {
  return constraintKey === "annualized_return"
    ? 1
    : constraintKey.includes("sharpe")
      ? 2
      : 0;
}

function getOptimizationConstraintUnitLabel(
  constraint: Pick<OptimizationConstraint, "key" | "unit">,
): string {
  if (constraint.unit.trim()) {
    return constraint.unit;
  }
  return constraint.key.includes("sharpe") ? "ratio" : "";
}

function evaluateOptimizationConstraint(
  constraint: OptimizationConstraint,
  presetConstraint?: OptimizationConstraint,
): OptimizationConstraintVerdict {
  const baseline = resolveOptimizationConstraintBaselineValue(
    constraint,
    presetConstraint,
  );
  if (baseline === null || baseline === undefined || Number.isNaN(baseline)) {
    return "info";
  }
  const threshold = constraint.value;
  const delta =
    constraint.operator === ">=" ? baseline - threshold : threshold - baseline;
  if (delta >= 0) {
    return "pass";
  }
  const tolerance =
    constraint.operator === ">="
      ? Math.max(Math.abs(threshold) * 0.08, 0.05)
      : Math.max(Math.abs(threshold) * 0.08, 1);
  if (delta >= -tolerance) {
    return "watch";
  }
  return "risk";
}

function formatOptimizationConstraintVerdict(
  verdict: OptimizationConstraintVerdict,
): string {
  switch (verdict) {
    case "pass":
      return "通过";
    case "watch":
      return "观察";
    case "risk":
      return "风险";
    case "info":
    default:
      return "待评估";
  }
}

function buildOptimizationConstraintLabel(
  preset: OptimizationConstraintPreset,
  constraints: OptimizationConstraint[],
): string {
  const presetConstraints = preset.constraints;
  const presetConstraintMap = new Map(
    presetConstraints.map((constraint) => [constraint.key, constraint]),
  );
  const isExactMatch =
    constraints.length === presetConstraints.length &&
    constraints.every((constraint) => {
      const presetConstraint = presetConstraintMap.get(constraint.key);
      return Boolean(
        presetConstraint &&
        presetConstraint.operator === constraint.operator &&
        presetConstraint.unit === constraint.unit &&
        presetConstraint.category === constraint.category &&
        presetConstraint.label === constraint.label &&
        presetConstraint.value === constraint.value,
      );
    });
  return isExactMatch ? preset.label : `${preset.label}（自定义）`;
}

function buildOptimizationConstraintDraft(
  presetKey: OptimizationConstraintPresetKey = DEFAULT_CONSTRAINT_PRESET_KEY,
  source?: {
    constraint_preset_key?: OptimizationConstraintPresetKey | null;
    constraint_label?: string | null;
    constraints?: OptimizationConstraint[] | null;
  } | null,
  strategy?: ApiStrategyDetail | null,
  sourceRun?: ApiBacktestRunDetail | null,
): {
  constraintPresetKey: OptimizationConstraintPresetKey;
  constraintLabel: string;
  constraints: OptimizationConstraint[];
} {
  const resolvedPresetKey = source?.constraint_preset_key ?? presetKey;
  const preset = getOptimizationConstraintPreset(resolvedPresetKey);
  const constraints = cloneOptimizationConstraints(
    source?.constraints ?? preset.constraints,
    preset.key,
  ).map((constraint) => ({
    ...constraint,
    baseline_value: strategy
      ? (resolveConstraintBaselineMetric(constraint.key, strategy, sourceRun) ??
        constraint.baseline_value ??
        null)
      : (constraint.baseline_value ?? null),
  }));
  const explicitLabel =
    typeof source?.constraint_label === "string" &&
    source.constraint_label.trim()
      ? source.constraint_label.trim()
      : null;
  return {
    constraintPresetKey: preset.key,
    constraintLabel:
      explicitLabel ?? buildOptimizationConstraintLabel(preset, constraints),
    constraints,
  };
}

function resolveConstraintBaselineMetric(
  constraintKey: string,
  strategy: ApiStrategyDetail,
  sourceRun?: ApiBacktestRunDetail | null,
): number | null {
  const metrics = sourceRun?.metrics ?? {};
  const latest = strategy.latest_completed_run_summary;
  switch (constraintKey) {
    case "annualized_return": {
      const value = readNumber(
        metrics.annualized_return ?? latest?.annualized_return ?? metrics.cagr,
      );
      return typeof value === "number" ? value * 100 : null;
    }
    case "out_of_sample_sharpe":
      return (
        readNumber(metrics.out_of_sample_sharpe ?? latest?.oos_sharpe) ?? null
      );
    case "return_sharpe":
      return (
        readNumber(metrics.return_sharpe ?? metrics.sharpe ?? latest?.sharpe) ??
        null
      );
    case "max_drawdown_pct": {
      const value =
        readNumber(metrics.max_drawdown_pct) ??
        (typeof metrics.max_drawdown === "number"
          ? metrics.max_drawdown * 100
          : undefined) ??
        (typeof latest?.max_drawdown === "number"
          ? latest.max_drawdown * 100
          : undefined);
      return typeof value === "number" ? Math.abs(value) : null;
    }
    case "stability": {
      const value = readNumber(metrics.stability);
      if (typeof value === "number") {
        return value;
      }
      const annualizedReturn =
        readNumber(metrics.annualized_return ?? latest?.annualized_return) ?? 0;
      const returnSharpe =
        readNumber(metrics.return_sharpe ?? metrics.sharpe ?? latest?.sharpe) ??
        0;
      const maxDrawdownPct =
        readNumber(metrics.max_drawdown_pct) ??
        (typeof metrics.max_drawdown === "number"
          ? metrics.max_drawdown * 100
          : undefined) ??
        (typeof latest?.max_drawdown === "number"
          ? latest.max_drawdown * 100
          : undefined) ??
        0;
      return clampMetric(
        Math.round(
          returnSharpe * 32 +
            annualizedReturn * 180 -
            Math.abs(maxDrawdownPct) * 0.35,
        ),
        35,
        88,
      );
    }
    case "turnover":
      return (
        readNumber(
          metrics.turnover ??
            metrics.turnover_pct ??
            (latest as { turnover?: number } | undefined)?.turnover,
        ) ?? null
      );
    default:
      return null;
  }
}

function getOptimizationObjectiveLabel(
  objective: OptimizationObjective | string | null | undefined,
): string {
  const normalizedObjective = normalizeOptimizationObjective(objective);
  return (
    OPTIMIZATION_OBJECTIVE_OPTIONS.find(
      (option) => option.key === normalizedObjective,
    )
      ?.label ?? "收益夏普 Max"
  );
}

function normalizeOptimizationObjective(
  objective: OptimizationObjective | string | null | undefined,
): OptimizationObjective {
  const normalizedObjective = String(objective ?? "")
    .trim()
    .toLowerCase();
  if (
    normalizedObjective === "annualized_return" ||
    normalizedObjective === "cagr" ||
    normalizedObjective === "return"
  ) {
    return "annualized_return";
  }
  if (
    normalizedObjective === "composite_score" ||
    normalizedObjective === "score"
  ) {
    return "composite_score";
  }
  return "return_sharpe";
}

function getOptimizationObjectiveMetricValue(
  candidate: OptimizationDisplayCandidate,
  objective: OptimizationObjective,
): number {
  if (objective === "annualized_return") {
    return (
      getCandidateMetric(candidate, "annualized_return") ??
      getCandidateMetric(candidate, "cagr") ??
      0
    );
  }
  if (objective === "composite_score") {
    return typeof candidate.score === "number" ? candidate.score : 0;
  }
  return (
    getCandidateMetric(candidate, "return_sharpe") ??
    getCandidateMetric(candidate, "sharpe") ??
    0
  );
}

function rankOptimizationCandidatesByObjective(
  candidates: OptimizationDisplayCandidate[],
  objective: OptimizationObjective,
): OptimizationDisplayCandidate[] {
  return [...candidates]
    .sort((left, right) => {
      const primaryDelta =
        getOptimizationObjectiveMetricValue(right, objective) -
        getOptimizationObjectiveMetricValue(left, objective);
      if (Math.abs(primaryDelta) > 1e-9) {
        return primaryDelta;
      }
      const rankDelta = (left.rank ?? Number.MAX_SAFE_INTEGER) -
        (right.rank ?? Number.MAX_SAFE_INTEGER);
      if (rankDelta !== 0) {
        return rankDelta;
      }
      return String(left.id ?? "").localeCompare(String(right.id ?? ""));
    })
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
    }));
}

function getOptimizationAllCombinationsDefaultSortKey(
  objective: OptimizationObjective,
): OptimizationAllCombinationSortKey {
  if (objective === "annualized_return") {
    return "annualized_return";
  }
  if (objective === "composite_score") {
    return "composite_score";
  }
  return "return_sharpe";
}

function getOptimizationAllCombinationsInitialDirection(
  key: OptimizationAllCombinationSortKey,
): SortDirection {
  return key === "parameter_summary" || key === "status" ? "asc" : "desc";
}

function getCandidateStatusText(candidate: OptimizationDisplayCandidate): string {
  return (
    translateOptimizationText(candidate.status_label) ??
    formatOptimizationStatus(candidate.status)
  );
}

function getCandidateSummaryText(
  candidate: OptimizationDisplayCandidate,
  searchSpace: ApiOptimizationSearchSpaceField[],
): string {
  const rangeEntries = buildRangeParameterEntries(
    candidate.parameter_snapshot,
    searchSpace,
  );
  if (rangeEntries.length) {
    return rangeEntries
      .map((entry) => `${entry.label} ${entry.value}`)
      .join("；");
  }
  return (
    buildCandidateParameterSummary(
      candidate.parameter_snapshot,
      searchSpace,
    ) || "-"
  );
}

function compareOptionalNumbers(
  left: number | undefined,
  right: number | undefined,
  direction: SortDirection,
): number {
  const leftValid = typeof left === "number" && Number.isFinite(left);
  const rightValid = typeof right === "number" && Number.isFinite(right);
  if (leftValid && rightValid) {
    return direction === "asc" ? left - right : right - left;
  }
  if (leftValid) {
    return -1;
  }
  if (rightValid) {
    return 1;
  }
  return 0;
}

function sortOptimizationCandidatesForModal(
  candidates: OptimizationDisplayCandidate[],
  searchSpace: ApiOptimizationSearchSpaceField[],
  sortKey: OptimizationAllCombinationSortKey,
  direction: SortDirection,
): OptimizationDisplayCandidate[] {
  return [...candidates].sort((left, right) => {
    let comparison = 0;

    switch (sortKey) {
      case "parameter_summary":
        comparison =
          direction === "asc"
            ? getCandidateSummaryText(left, searchSpace).localeCompare(
                getCandidateSummaryText(right, searchSpace),
                "zh-Hans-CN",
              )
            : getCandidateSummaryText(right, searchSpace).localeCompare(
                getCandidateSummaryText(left, searchSpace),
                "zh-Hans-CN",
              );
        break;
      case "status":
        comparison =
          direction === "asc"
            ? getCandidateStatusText(left).localeCompare(
                getCandidateStatusText(right),
                "zh-Hans-CN",
              )
            : getCandidateStatusText(right).localeCompare(
                getCandidateStatusText(left),
                "zh-Hans-CN",
              );
        break;
      case "annualized_return":
        comparison = compareOptionalNumbers(
          getCandidateMetric(left, "annualized_return") ??
            getCandidateMetric(left, "cagr"),
          getCandidateMetric(right, "annualized_return") ??
            getCandidateMetric(right, "cagr"),
          direction,
        );
        break;
      case "return_sharpe":
        comparison = compareOptionalNumbers(
          getCandidateMetric(left, "return_sharpe") ??
            getCandidateMetric(left, "sharpe"),
          getCandidateMetric(right, "return_sharpe") ??
            getCandidateMetric(right, "sharpe"),
          direction,
        );
        break;
      case "out_of_sample_sharpe":
        comparison = compareOptionalNumbers(
          getCandidateMetric(left, "out_of_sample_sharpe"),
          getCandidateMetric(right, "out_of_sample_sharpe"),
          direction,
        );
        break;
      case "max_drawdown_pct":
        comparison = compareOptionalNumbers(
          getCandidateMetric(left, "max_drawdown_pct"),
          getCandidateMetric(right, "max_drawdown_pct"),
          direction,
        );
        break;
      case "stability":
        comparison = compareOptionalNumbers(
          getCandidateMetric(left, "stability"),
          getCandidateMetric(right, "stability"),
          direction,
        );
        break;
      case "composite_score":
        comparison = compareOptionalNumbers(left.score, right.score, direction);
        break;
      default:
        comparison = 0;
        break;
    }

    if (comparison !== 0) {
      return comparison;
    }

    const rankDelta =
      (left.rank ?? Number.MAX_SAFE_INTEGER) -
      (right.rank ?? Number.MAX_SAFE_INTEGER);
    if (rankDelta !== 0) {
      return rankDelta;
    }

    return String(left.id ?? "").localeCompare(String(right.id ?? ""));
  });
}

export function buildOptimizationRerunPayload(
  job: ApiOptimizationJobDetail,
): ApiOptimizationJobCreatePayload {
  const request = job.request ?? {};
  const summary = job.summary ?? {};
  const resolvedPresetKey = (summary.constraint_preset_key ??
    request.constraint_preset_key ??
    DEFAULT_CONSTRAINT_PRESET_KEY) as OptimizationConstraintPresetKey;
  const preset = getOptimizationConstraintPreset(resolvedPresetKey);
  const constraints = cloneOptimizationConstraints(
    summary.constraints ?? request.constraints ?? preset.constraints,
    preset.key,
  );
  const explicitLabel =
    (typeof summary.constraint_label === "string" &&
    summary.constraint_label.trim()
      ? summary.constraint_label.trim()
      : null) ??
    (typeof request.constraint_label === "string" &&
    request.constraint_label.trim()
      ? request.constraint_label.trim()
      : null);
  const constraintLabel =
    explicitLabel ?? buildOptimizationConstraintLabel(preset, constraints);
  return {
    objective: normalizeOptimizationObjective(
      typeof summary.objective === "string" && summary.objective.trim()
        ? summary.objective
        : request.objective,
    ),
    base_parameter_version_id:
      request.base_parameter_version_id ??
      job.base_parameter_version_id ??
      null,
    source_run_id: request.source_run_id ?? summary.source_run_id ?? null,
    entry_point: request.entry_point ?? summary.entry_point ?? "lab_menu",
    validation_mode:
      request.validation_mode ?? summary.validation_mode ?? "walk_forward",
    budget_combinations:
      request.budget_combinations ?? summary.budget_combinations ?? null,
    search_space: cloneSearchSpace(getOptimizationSearchSpace(job)),
    constraint_preset_key: preset.key,
    constraint_label: constraintLabel,
    constraints,
  };
}

function getOptimizationConstraintLabel(
  job: ApiOptimizationJobDetail | null | undefined,
): string | null {
  const summaryLabel = job?.summary?.constraint_label;
  if (typeof summaryLabel === "string" && summaryLabel.trim()) {
    return summaryLabel;
  }
  const requestLabel = job?.request?.constraint_label;
  if (typeof requestLabel === "string" && requestLabel.trim()) {
    return requestLabel;
  }
  return null;
}

function getOptimizationConstraintState(
  job: ApiOptimizationJobDetail | null | undefined,
): {
  constraintLabel: string | null;
  constraints: OptimizationConstraint[];
  presetKey: OptimizationConstraintPresetKey;
} {
  const resolvedPresetKey = (job?.summary?.constraint_preset_key ??
    job?.request?.constraint_preset_key ??
    job?.result?.constraint_preset_key ??
    DEFAULT_CONSTRAINT_PRESET_KEY) as OptimizationConstraintPresetKey;
  const preset = getOptimizationConstraintPreset(resolvedPresetKey);
  const constraints = cloneOptimizationConstraints(
    job?.summary?.constraints ??
      job?.request?.constraints ??
      job?.result?.constraints ??
      preset.constraints,
    preset.key,
  );
  return {
    constraintLabel:
      getOptimizationConstraintLabel(job) ??
      buildOptimizationConstraintLabel(preset, constraints),
    constraints,
    presetKey: preset.key,
  };
}

function buildOptimizationResultConstraintDraft(
  job: ApiOptimizationJobDetail | null | undefined,
  strategy?: ApiStrategyDetail | null,
  sourceRun?: ApiBacktestRunDetail | null,
): {
  constraintPresetKey: OptimizationConstraintPresetKey;
  constraintLabel: string;
  constraints: OptimizationConstraint[];
} {
  const state = getOptimizationConstraintState(job);
  return buildOptimizationConstraintDraft(
    state.presetKey,
    {
      constraint_preset_key: state.presetKey,
      constraint_label: state.constraintLabel,
      constraints: state.constraints,
    },
    strategy,
    sourceRun,
  );
}

function normalizeConstraintMetricValue(
  constraintKey: string,
  value: number,
): number {
  switch (constraintKey) {
    case "annualized_return":
      return Math.abs(value) <= 1.5 ? value * 100 : value;
    case "max_drawdown_pct":
      return Math.abs(value) <= 1.5 ? Math.abs(value * 100) : Math.abs(value);
    case "turnover":
      return Math.abs(value) <= 1.5 ? value * 100 : value;
    default:
      return value;
  }
}

function getCandidateConstraintMetricValue(
  candidate: OptimizationDisplayCandidate,
  constraintKey: string,
): number | null {
  const metrics = candidate.metrics ?? {};
  const rawValue =
    constraintKey === "annualized_return"
      ? readNumber(metrics.annualized_return ?? metrics.cagr)
      : constraintKey === "return_sharpe"
        ? readNumber(metrics.return_sharpe ?? metrics.sharpe)
        : constraintKey === "out_of_sample_sharpe"
          ? readNumber(metrics.out_of_sample_sharpe ?? metrics.oos_sharpe)
          : constraintKey === "max_drawdown_pct"
            ? readNumber(metrics.max_drawdown_pct) ??
              (typeof metrics.max_drawdown === "number"
                ? metrics.max_drawdown * 100
                : undefined)
            : constraintKey === "turnover"
              ? readNumber(metrics.turnover_pct ?? metrics.turnover)
              : constraintKey === "stability"
                ? readNumber(metrics.stability)
                : readNumber(metrics[constraintKey]);
  return typeof rawValue === "number"
    ? normalizeConstraintMetricValue(constraintKey, rawValue)
    : null;
}

function candidateMeetsOptimizationConstraint(
  candidate: OptimizationDisplayCandidate,
  constraint: OptimizationConstraint,
): boolean {
  const metricValue = getCandidateConstraintMetricValue(candidate, constraint.key);
  if (metricValue === null) {
    return false;
  }
  return constraint.operator === ">="
    ? metricValue >= constraint.value
    : metricValue <= constraint.value;
}

function candidatePassesOptimizationConstraints(
  candidate: OptimizationDisplayCandidate,
  constraints: OptimizationConstraint[],
): boolean {
  if (!constraints.length) {
    return true;
  }
  return constraints.every((constraint) =>
    candidateMeetsOptimizationConstraint(candidate, constraint),
  );
}

function snapOptimizationConstraintValue(
  constraint: Pick<OptimizationConstraint, "key" | "operator">,
  value: number,
): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const precision = getOptimizationConstraintInputPrecision(constraint.key);
  const factor = 10 ** precision;
  const scaled = value * factor;
  const snappedScaled =
    constraint.operator === ">=" ? Math.floor(scaled) : Math.ceil(scaled);
  const snapped = snappedScaled / factor;
  return Object.is(snapped, -0) ? 0 : snapped;
}

function buildSuggestedOptimizationConstraints(
  candidate: OptimizationDisplayCandidate | null,
  constraints: OptimizationConstraint[],
): OptimizationConstraint[] | null {
  if (!candidate || !constraints.length) {
    return null;
  }

  let changed = false;
  const nextConstraints = constraints.map((constraint) => {
    const metricValue = getCandidateConstraintMetricValue(candidate, constraint.key);
    if (metricValue === null) {
      return constraint;
    }

    const relaxedValue =
      constraint.operator === ">="
        ? Math.min(constraint.value, metricValue)
        : Math.max(constraint.value, metricValue);
    const nextValue = snapOptimizationConstraintValue(constraint, relaxedValue);
    if (nextValue === constraint.value) {
      return constraint;
    }
    changed = true;
    return {
      ...constraint,
      value: nextValue,
      source: "manual" as const,
    };
  });

  return changed ? nextConstraints : null;
}

function filterOptimizationCandidatesByConstraints(
  candidates: ApiOptimizationCandidate[],
  constraints: OptimizationConstraint[],
): ApiOptimizationCandidate[] {
  return candidates.filter((candidate) =>
    candidatePassesOptimizationConstraints(candidate, constraints),
  );
}

function isMissingBacktestRunError(caught: unknown): boolean {
  const message =
    caught instanceof Error ? caught.message : String(caught ?? "");
  return /Backtest run not found:/i.test(message);
}

function getDiscreteFieldOptions(
  key: string,
): OptimizationDiscreteOption[] {
  return OPTIMIZATION_DISCRETE_FIELD_OPTIONS[key] ?? [];
}

function uniqueParameterValues(values: ParameterValue[]): ParameterValue[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (value === null || value === undefined || value === "") {
      return false;
    }
    const fingerprint = JSON.stringify(value);
    if (seen.has(fingerprint)) {
      return false;
    }
    seen.add(fingerprint);
    return true;
  });
}

function getDiscreteFieldValues(
  field: Pick<
    ApiOptimizationSearchSpaceField,
    "key" | "current" | "value" | "start" | "end" | "values"
  >,
): ParameterValue[] {
  const configuredOptions = getDiscreteFieldOptions(field.key);
  const configuredValues = configuredOptions.map((option) => option.value);
  const rawValues = uniqueParameterValues(
    Array.isArray(field.values) ? field.values : [],
  );
  const matchedValues = configuredValues.filter((value) =>
    rawValues.includes(value),
  );
  if (matchedValues.length) {
    return matchedValues;
  }

  const lockedValue =
    field.current ?? field.value ?? field.start ?? field.end ?? null;
  if (lockedValue !== null && lockedValue !== undefined && lockedValue !== "") {
    if (configuredValues.includes(String(lockedValue))) {
      return [String(lockedValue)];
    }
    return configuredValues.length ? [configuredValues[0]] : [lockedValue];
  }
  return configuredValues.length ? [configuredValues[0]] : [];
}

function isDiscreteSearchField(
  field: ApiOptimizationSearchSpaceField,
): boolean {
  return field.mode === "discrete";
}

function formatParameterValue(value: ParameterValue | undefined, key?: string): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  if (key?.startsWith("factor_weight__") && typeof value === "number") {
    return `${Number.isInteger(value) ? value : Number(value.toFixed(2))}%`;
  }
  if (value === "zscore_weighted") {
    return "Z-Score 加权";
  }
  if (value === "rank_weighted") {
    return "Rank 加权";
  }
  if (value === "industry") {
    return "行业中性";
  }
  if (value === "true") {
    return "是";
  }
  if (value === "false") {
    return "否";
  }
  if (value === "equal_weight") {
    return "等权";
  }
  if (value === "daily") {
    return "每日";
  }
  if (value === "weekly") {
    return "每周";
  }
  if (value === "monthly") {
    return "每月";
  }
  if (value === "quarterly") {
    return "每季度";
  }
  if (value === "semiannual") {
    return "每半年";
  }
  if (value === "yearly") {
    return "每年";
  }
  if (Array.isArray(value)) {
    return value.length ? `${value.length} 项配置` : "-";
  }
  if (typeof value === "object") {
    return "已配置";
  }
  return String(value);
}

function formatEditableParameterValue(
  value: ParameterValue | undefined,
): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value === "equal_weight") {
    return "等权";
  }
  return String(value);
}

function formatOptimizationStatus(status: string): string {
  switch (status.toUpperCase()) {
    case "QUEUED":
      return "待启动";
    case "RUNNING":
      return "运行中";
    case "INTERRUPTED":
      return "已中断";
    case "COMPLETED":
      return "已完成";
    case "SUCCEEDED":
    case "SUCCESS":
      return "成功";
    case "PARTIALLY_FAILED":
      return "部分完成";
    case "FAILED":
      return "失败";
    case "CANCELLED":
      return "已取消";
    case "PAUSED":
      return "已暂停";
    case "READY":
      return "就绪";
    default:
      return status;
  }
}

function formatOptimizationListStatus(job: ApiOptimizationJobListItem): string {
  const status = formatOptimizationStatus(job.status);
  if (String(job.status ?? "").toUpperCase() === "INTERRUPTED") {
    return `${status}${job.resume_ready === false ? "" : " · 可继续"}`;
  }
  return status;
}

function formatInterruptedReason(reason?: string | null): string | null {
  switch ((reason ?? "").trim().toLowerCase()) {
    case "budget_remaining":
      return "预算尚未跑完，已中断，等待继续优化。";
    case "service_restart":
      return "服务重启后已保留当前进度。";
    default:
      return reason?.trim() ? reason : null;
  }
}

function formatEntryPoint(value?: string | null): string {
  switch ((value ?? "").toLowerCase()) {
    case "run_detail":
      return "回测详情";
    case "strategy_detail":
      return "策略详情";
    default:
      return "菜单创建";
  }
}

function formatValidationMode(value?: string | null): string {
  switch ((value ?? "").toLowerCase()) {
    case "single_oos":
      return "单次样本外";
    case "walk_forward":
    default:
      return "滚动前瞻验证";
  }
}

function formatUpdatedAt(value?: string | null): string {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-HK", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function formatMetric(value: number | undefined, digits = 2): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }
  return value.toFixed(digits);
}

function formatPercentMetric(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatReturnRate(
  value: number | string | null | undefined,
): string {
  const normalizedValue = readNumber(value);
  if (normalizedValue === undefined) {
    return "-";
  }
  return formatPercentMetric(normalizedValue * 100);
}

function formatEtaMinutes(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "等待首批样本";
  }
  return `${Math.max(0, Math.round(value))} 分钟`;
}

function formatExpectedCompletion(value?: string | null): string {
  if (!value) {
    return "等待首批样本";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "等待首批样本";
  }
  return new Intl.DateTimeFormat("zh-HK", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function calculateElapsedSeconds(
  startAt?: string | null,
  endAt?: string | null,
): number | null {
  if (!startAt || !endAt) {
    return null;
  }
  const started = Date.parse(startAt);
  const ended = Date.parse(endAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended)) {
    return null;
  }
  return Math.max(0, Math.round((ended - started) / 1000));
}

function formatDurationMinutes(elapsedSeconds: number | null): number | null {
  if (elapsedSeconds === null || !Number.isFinite(elapsedSeconds)) {
    return null;
  }
  return Math.max(0, Math.round(elapsedSeconds / 60));
}

function formatOptimizationHeroSummary(
  combinations: number | undefined,
  elapsedSeconds: number | null,
): string | null {
  const combinationCount =
    typeof combinations === "number" &&
    Number.isFinite(combinations) &&
    combinations > 0
      ? Math.round(combinations)
      : null;
  const elapsedMinutes = formatDurationMinutes(elapsedSeconds);
  if (combinationCount !== null && elapsedMinutes !== null) {
    return `优化组合共 ${combinationCount}个，耗时 ${elapsedMinutes}分钟`;
  }
  if (combinationCount !== null) {
    return `优化组合共 ${combinationCount}个`;
  }
  if (elapsedMinutes !== null) {
    return `耗时 ${elapsedMinutes}分钟`;
  }
  return null;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function clampMetric(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function asPercentFromRatio(value: number | undefined): number | undefined {
  return value === undefined ? undefined : value * 100;
}

function deriveConsistencyScoreFromChartSeries(
  chartSeries: ApiBacktestRunDetail["chart_series"] | undefined,
): number | undefined {
  const returns = (chartSeries ?? [])
    .map((point) => readNumber(point.strategy_return) ?? 0)
    .filter((value) => Number.isFinite(value));
  if (!returns.length) {
    return undefined;
  }
  const positiveShare =
    returns.filter((value) => value > 0).length / returns.length;
  const averageReturn =
    returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - averageReturn) ** 2, 0) /
    returns.length;
  const volatility = Math.sqrt(Math.max(variance, 0));
  return clampMetric(
    positiveShare * (1 / (1 + volatility * 10)),
    0,
    1,
  );
}

function resolveComparableOptimizationStability(
  baselineRun: ApiBacktestRunDetail,
): number {
  const explicitStability = readNumber(baselineRun.metrics?.stability);
  if (explicitStability !== undefined) {
    return clampMetric(Math.round(explicitStability), 0, 100);
  }
  const consistencyScore =
    readNumber(baselineRun.consistency_score?.score) ??
    deriveConsistencyScoreFromChartSeries(baselineRun.chart_series);
  if (consistencyScore === undefined) {
    return 0;
  }
  return clampMetric(Math.round(consistencyScore * 100), 0, 100);
}

function scoreOptimizationMetrics(
  metrics: Record<string, number>,
  objective: OptimizationObjective,
): number {
  const returnSharpe = readNumber(metrics.return_sharpe ?? metrics.sharpe) ?? 0;
  const outOfSampleSharpe =
    readNumber(metrics.out_of_sample_sharpe ?? metrics.oos_sharpe) ??
    returnSharpe;
  const annualizedReturn =
    readNumber(metrics.annualized_return ?? metrics.cagr) ?? 0;
  const annualizedReturnPct = normalizeConstraintMetricValue(
    "annualized_return",
    annualizedReturn,
  );
  const totalReturnPct =
    readNumber(metrics.total_return_pct) ??
    (readNumber(metrics.total_return) ?? 0) * 100;
  const maxDrawdownPct =
    readNumber(metrics.max_drawdown_pct) ??
    (readNumber(metrics.max_drawdown) ?? 0) * 100;
  const stability = readNumber(metrics.stability) ?? 0;
  const drawdownPenalty = normalizeConstraintMetricValue(
    "max_drawdown_pct",
    maxDrawdownPct,
  );
  const normalizedObjective = normalizeOptimizationObjective(objective);
  const calmarRatio = annualizedReturnPct / Math.max(drawdownPenalty, 1);

  function bandScore(value: number, floor: number, ceiling: number): number {
    if (ceiling <= floor) {
      return 0;
    }
    return Math.max(0, Math.min((value - floor) / (ceiling - floor), 1.25));
  }

  function inverseBandScore(
    value: number,
    floor: number,
    ceiling: number,
  ): number {
    if (ceiling <= floor) {
      return 0;
    }
    return Math.max(0, Math.min((ceiling - value) / (ceiling - floor), 1.25));
  }

  const returnComponent = bandScore(annualizedReturnPct, 4, 18);
  const sharpeComponent = bandScore(returnSharpe, 0.3, 1.6);
  const oosComponent = bandScore(outOfSampleSharpe, 0.2, 1.2);
  const calmarComponent = bandScore(calmarRatio, 0.25, 1.2);
  const stabilityComponent = bandScore(stability, 40, 85);
  const drawdownComponent = inverseBandScore(drawdownPenalty, 15, 45);

  const baseWeights = {
    sharpe: 0.24,
    oos: 0.24,
    calmar: 0.18,
    stability: 0.14,
    return: 0.12,
    drawdown: 0.05,
  };
  const baseWeightTotal =
    Object.values(baseWeights).reduce((sum, value) => sum + value, 0) || 1;
  const baseScore =
    sharpeComponent * (baseWeights.sharpe / baseWeightTotal) +
    oosComponent * (baseWeights.oos / baseWeightTotal) +
    calmarComponent * (baseWeights.calmar / baseWeightTotal) +
    stabilityComponent * (baseWeights.stability / baseWeightTotal) +
    returnComponent * (baseWeights.return / baseWeightTotal) +
    drawdownComponent * (baseWeights.drawdown / baseWeightTotal);

  const objectiveScore =
    normalizedObjective === "annualized_return"
      ? returnComponent * 0.07 + calmarComponent * 0.04
      : normalizedObjective === "return_sharpe"
        ? sharpeComponent * 0.07 + oosComponent * 0.04
        : 0;
  const totalReturnBonus = clampMetric(Math.min(totalReturnPct, 200) * 0.01, -1, 2);

  return Number(
    (((baseScore + objectiveScore) * 100 + totalReturnBonus).toFixed(3)),
  );
}

function buildDerivedValidationWindows(
  metrics: Record<string, number>,
): ApiOptimizationValidationWindow[] {
  const annualizedReturn =
    readNumber(metrics.annualized_return ?? metrics.cagr) ?? 0;
  const returnSharpe = readNumber(metrics.return_sharpe ?? metrics.sharpe) ?? 0;
  const outOfSampleSharpe =
    readNumber(metrics.out_of_sample_sharpe) ?? returnSharpe;
  const maxDrawdownPct = readNumber(metrics.max_drawdown_pct) ?? 0;
  const stability = readNumber(metrics.stability) ?? 0;
  const baseVerdict =
    annualizedReturn >= 0.1 && returnSharpe >= 1
      ? "pass"
      : annualizedReturn >= 0.06
        ? "watch"
        : "risk";

  return [
    {
      label: "窗口 A",
      period_label: "训练早段 至 训练早段",
      annualized_return: Number((annualizedReturn - 0.012).toFixed(4)),
      return_sharpe: Number((returnSharpe - 0.04).toFixed(2)),
      out_of_sample_sharpe: Number((outOfSampleSharpe - 0.03).toFixed(2)),
      max_drawdown_pct: Number((maxDrawdownPct - 1.2).toFixed(1)),
      stability: Math.max(0, Number((stability - 4).toFixed(0))),
      verdict: baseVerdict,
    },
    {
      label: "窗口 B",
      period_label: "训练中段 至 训练中段",
      annualized_return: Number(annualizedReturn.toFixed(4)),
      return_sharpe: Number(returnSharpe.toFixed(2)),
      out_of_sample_sharpe: Number(outOfSampleSharpe.toFixed(2)),
      max_drawdown_pct: Number(maxDrawdownPct.toFixed(1)),
      stability: Number(stability.toFixed(0)),
      verdict: baseVerdict,
    },
    {
      label: "窗口 C",
      period_label: "训练尾段 至 训练尾段",
      annualized_return: Number((annualizedReturn - 0.019).toFixed(4)),
      return_sharpe: Number((returnSharpe - 0.09).toFixed(2)),
      out_of_sample_sharpe: Number((outOfSampleSharpe - 0.08).toFixed(2)),
      max_drawdown_pct: Number((maxDrawdownPct - 1.8).toFixed(1)),
      stability: Math.max(0, Number((stability - 9).toFixed(0))),
      verdict:
        annualizedReturn >= 0.08 && outOfSampleSharpe >= 0.5 ? "watch" : "risk",
    },
  ];
}

function buildDerivedStabilityChecks(
  metrics: Record<string, number>,
): NonNullable<ApiOptimizationCandidate["analysis"]>["stability_checks"] {
  const annualizedReturn =
    readNumber(metrics.annualized_return ?? metrics.cagr) ?? 0;
  const returnSharpe = readNumber(metrics.return_sharpe ?? metrics.sharpe) ?? 0;
  const outOfSampleSharpe = readNumber(metrics.out_of_sample_sharpe) ?? 0;
  const maxDrawdownPct = readNumber(metrics.max_drawdown_pct) ?? 0;
  const stability = readNumber(metrics.stability) ?? 0;

  return [
    {
      key: "annualized_return",
      label: "年化收益率",
      value: Number((annualizedReturn * 100).toFixed(1)),
      verdict:
        annualizedReturn >= 0.1
          ? "pass"
          : annualizedReturn >= 0.06
            ? "watch"
            : "risk",
      detail:
        annualizedReturn >= 0.1
          ? "当前基准具备可比较的收益效率。"
          : annualizedReturn >= 0.06
            ? "当前基准收益效率可作为观察对照。"
            : "当前基准收益效率偏弱，仅建议作为边界参考。",
    },
    {
      key: "return_sharpe",
      label: "收益夏普",
      value: Number(returnSharpe.toFixed(2)),
      verdict:
        returnSharpe >= 1 ? "pass" : returnSharpe >= 0.6 ? "watch" : "risk",
      detail:
        returnSharpe >= 1
          ? "收益风险比处于可接受区间。"
          : "收益风险比仍需与优化候选对照观察。",
    },
    {
      key: "out_of_sample_sharpe",
      label: "样本外夏普",
      value: Number(outOfSampleSharpe.toFixed(2)),
      verdict:
        outOfSampleSharpe >= 0.8
          ? "pass"
          : outOfSampleSharpe >= 0.4
            ? "watch"
            : "risk",
      detail:
        outOfSampleSharpe >= 0.8
          ? "样本外表现具备延续性。"
          : "样本外延续性仍需和优化候选比较。",
    },
    {
      key: "max_drawdown_pct",
      label: "最大回撤",
      value: Number(maxDrawdownPct.toFixed(1)),
      verdict:
        maxDrawdownPct >= -25
          ? "pass"
          : maxDrawdownPct >= -35
            ? "watch"
            : "risk",
      detail:
        maxDrawdownPct >= -25
          ? "当前回撤仍在风控护栏内。"
          : "当前回撤需要用优化候选进一步改善。",
    },
    {
      key: "stability",
      label: "稳定度",
      value: Number(stability.toFixed(0)),
      verdict: stability >= 70 ? "pass" : stability >= 50 ? "watch" : "risk",
      detail:
        stability >= 70
          ? "参数组合具备稳定对照价值。"
          : "稳定度仍需通过优化候选提升。",
    },
  ];
}

function buildSyntheticHeatmap(
  searchSpace: ApiOptimizationSearchSpaceField[],
  parameterSnapshot: Record<string, ParameterValue> | undefined,
  metrics: Record<string, number>,
): ApiOptimizationHeatmap | null {
  const rangeEntries = searchSpace.filter((entry) => entry.mode === "range");
  const xEntry = rangeEntries[0];
  const yEntry = rangeEntries[1] ?? rangeEntries[0];
  if (!xEntry) {
    return null;
  }

  const xCenter =
    readNumber(parameterSnapshot?.[xEntry.key] ?? xEntry.current) ?? 0;
  const yCenter =
    readNumber(parameterSnapshot?.[yEntry?.key ?? ""] ?? yEntry?.current) ??
    xCenter;
  const xStep = Math.max(readNumber(xEntry.step) ?? 1, 1);
  const yStep = Math.max(readNumber(yEntry?.step) ?? 1, 1);
  const xValues = [xCenter - xStep, xCenter, xCenter + xStep].map((value) =>
    Number(value.toFixed(2)),
  );
  const yValues = [yCenter - yStep, yCenter, yCenter + yStep].map((value) =>
    Number(value.toFixed(2)),
  );
  const centerAnnualizedReturn =
    readNumber(metrics.annualized_return ?? metrics.cagr) ?? 0;
  const centerReturnSharpe =
    readNumber(metrics.return_sharpe ?? metrics.sharpe) ?? 0;
  const centerMaxDrawdownPct = readNumber(metrics.max_drawdown_pct) ?? 0;

  return {
    x_key: xEntry.key,
    y_key: yEntry?.key ?? xEntry.key,
    x_label: xEntry.label ?? xEntry.key,
    y_label: yEntry?.label ?? yEntry?.key ?? xEntry.label ?? xEntry.key,
    x_values: xValues,
    y_values: yValues,
    cells: yValues.flatMap((yValue, rowIndex) =>
      xValues.map((xValue, columnIndex) => {
        const distance = Math.abs(rowIndex - 1) + Math.abs(columnIndex - 1);
        const score = Number((centerReturnSharpe - distance * 0.07).toFixed(2));
        return {
          x: xValue,
          y: yValue,
          score,
          metrics: {
            annualized_return: Number(
              clampMetric(
                centerAnnualizedReturn - distance * 0.008,
                -0.99,
                9.99,
              ).toFixed(4),
            ),
            return_sharpe: Number(
              (centerReturnSharpe - distance * 0.07).toFixed(2),
            ),
            max_drawdown_pct: Number(
              (centerMaxDrawdownPct - distance * 1.8).toFixed(1),
            ),
          },
          is_candidate: distance === 0,
          tone: distance === 0 ? "hot" : distance === 1 ? "warm" : "cool",
        };
      }),
    ),
  };
}

function getHeatmapCellMetricValue(
  cell: NonNullable<ApiOptimizationHeatmap["cells"]>[number] | undefined,
  metricKey: HeatmapMetricKey,
): number | undefined {
  return readNumber(cell?.metrics?.[metricKey]);
}

function decorateHeatmapWithMetrics(
  heatmap: ApiOptimizationHeatmap | null | undefined,
  metrics: Record<string, number>,
): ApiOptimizationHeatmap | null {
  if (!heatmap) {
    return null;
  }
  const focusCell =
    heatmap.cells.find((cell) => cell.is_candidate) ??
    heatmap.cells[Math.max(Math.floor(heatmap.cells.length / 2), 0)] ??
    null;
  const focusX = readNumber(focusCell?.x) ?? 0;
  const focusY = readNumber(focusCell?.y) ?? 0;
  const centerAnnualizedReturn =
    readNumber(metrics.annualized_return ?? metrics.cagr) ?? 0;
  const centerReturnSharpe =
    readNumber(metrics.return_sharpe ?? metrics.sharpe) ?? 0;
  const centerMaxDrawdownPct = readNumber(metrics.max_drawdown_pct) ?? 0;

  return {
    ...heatmap,
    cells: heatmap.cells.map((cell) => {
      if (
        cell.metrics?.annualized_return !== undefined ||
        cell.metrics?.return_sharpe !== undefined ||
        cell.metrics?.max_drawdown_pct !== undefined
      ) {
        return cell;
      }
      const xDistance = Math.abs((readNumber(cell.x) ?? 0) - focusX);
      const yDistance = Math.abs((readNumber(cell.y) ?? 0) - focusY);
      return {
        ...cell,
        metrics: {
          annualized_return: Number(
            clampMetric(
              centerAnnualizedReturn - xDistance * 0.004 - yDistance * 0.003,
              -0.99,
              9.99,
            ).toFixed(4),
          ),
          return_sharpe: Number(
            (centerReturnSharpe - xDistance * 0.03 - yDistance * 0.02).toFixed(
              3,
            ),
          ),
          max_drawdown_pct: Number(
            (centerMaxDrawdownPct - xDistance * 1.4 - yDistance * 1.1).toFixed(
              1,
            ),
          ),
        },
      };
    }),
  };
}

function resolveHeatmapTone(
  cells: ApiOptimizationHeatmap["cells"],
  metricKey: HeatmapMetricKey,
  cell: NonNullable<ApiOptimizationHeatmap["cells"]>[number],
): "hot" | "warm" | "cool" {
  const values = cells
    .map((item) => getHeatmapCellMetricValue(item, metricKey))
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value),
    );
  const currentValue = getHeatmapCellMetricValue(cell, metricKey);
  if (!values.length || typeof currentValue !== "number") {
    return cell.tone ?? "cool";
  }
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  if (Math.abs(maxValue - minValue) < 1e-9) {
    return cell.is_candidate ? "hot" : (cell.tone ?? "cool");
  }
  const normalized = (currentValue - minValue) / (maxValue - minValue);
  if (normalized >= 0.66) {
    return "hot";
  }
  if (normalized >= 0.33) {
    return "warm";
  }
  return "cool";
}

function formatHeatmapMetricValue(
  metricKey: HeatmapMetricKey,
  value: number | undefined,
): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }
  if (metricKey === "annualized_return") {
    return formatReturnRate(value);
  }
  if (metricKey === "max_drawdown_pct") {
    return formatPercentMetric(value);
  }
  return formatMetric(value);
}

type OptimizationParameterEntry = {
  key: string;
  label: string;
  value: string;
};

type PromotionParameterDeltaEntry = {
  key: string;
  label: string;
  currentValue: string;
  candidateValue: string;
  deltaValue: string | null;
  changed: boolean;
};

function getOptimizationSearchSpace(
  job: ApiOptimizationJobDetail | null | undefined,
): ApiOptimizationSearchSpaceField[] {
  const requestFields = Array.isArray(job?.request?.search_space)
    ? job?.request?.search_space
    : [];
  const summaryFields = Array.isArray(job?.summary?.search_space)
    ? job?.summary?.search_space
    : [];
  return (
    requestFields?.length ? requestFields : (summaryFields ?? [])
  ) as ApiOptimizationSearchSpaceField[];
}

function getOptimizationRangeLabel(
  field: ApiOptimizationSearchSpaceField,
): string {
  const compactLabels: Record<string, string> = {
    lookback_months: "回看(月)",
    lookback_days: "回看(日)",
    skip_recent_months: "跳过最近(月)",
    top_n: "买入排名阈值",
    hold_rank_threshold: "保留排名阈值",
    max_position_pct: "单票仓位(%)",
    grid_interval: "网格间距(%)",
    scoring_method: "打分方法",
    rebalance_frequency: "再平衡",
    neutralization_method: "中性化方法",
  };
  const factorWeightLabel = formatFactorWeightLabel(field.key);
  if (factorWeightLabel) {
    return factorWeightLabel.replace(/^因子权重 · /, '');
  }
  return compactLabels[field.key] ?? getSearchFieldDisplayLabel(field);
}

function buildOptimizationRangeSummary(
  fields: ApiOptimizationSearchSpaceField[],
): string | null {
  const summaryFields = fields.filter(
    (field) => field.mode === "range" || field.mode === "discrete",
  );
  if (!summaryFields.length) {
    return null;
  }
  return summaryFields
    .map(
      (field) => {
        if (field.mode === "discrete") {
          const values = getDiscreteFieldValues(field).map((value) =>
            formatParameterValue(value, field.key),
          );
          return `${getOptimizationRangeLabel(field)}${values.join("/")}`;
        }
        return `${getOptimizationRangeLabel(field)}${formatEditableParameterValue(field.start)}-${formatEditableParameterValue(field.end)}`;
      },
    )
    .join("；");
}

function buildCandidateParameterEntries(
  snapshot: Record<string, ParameterValue> | undefined,
  fields: ApiOptimizationSearchSpaceField[],
): OptimizationParameterEntry[] {
  if (!fields.length) {
    return Object.entries(snapshot ?? {})
      .slice(0, 4)
      .map(([key, value]) => ({
        key,
        label: humanizeKey(key),
        value: formatParameterValue(value, key),
      }));
  }
  return fields.map((field) => ({
    key: field.key,
    label: getSearchFieldDisplayLabel(field),
    value: formatParameterValue(
      snapshot?.[field.key] ?? field.value ?? field.current,
      field.key,
    ),
  }));
}

function buildCandidateParameterSummary(
  snapshot: Record<string, ParameterValue> | undefined,
  fields: ApiOptimizationSearchSpaceField[],
): string {
  return buildCandidateParameterEntries(snapshot, fields)
    .map((entry) => `${entry.label} ${entry.value}`)
    .join("；");
}

function buildRangeParameterEntries(
  snapshot: Record<string, ParameterValue> | undefined,
  fields: ApiOptimizationSearchSpaceField[],
): OptimizationParameterEntry[] {
  const variableFields = fields.filter((field) => field.mode !== "fixed");
  if (!variableFields.length) {
    return [];
  }
  return variableFields.map((field) => ({
    key: field.key,
    label: getSearchFieldDisplayLabel(field),
    value: formatParameterValue(
      snapshot?.[field.key] ?? field.value ?? field.current,
      field.key,
    ),
  }));
}

function parameterValuesMatch(
  left: ParameterValue | undefined,
  right: ParameterValue | undefined,
): boolean {
  return formatParameterValue(left) === formatParameterValue(right);
}

function buildPromotionParameterDeltaEntries(
  candidate: OptimizationDisplayCandidate | null,
  fields: ApiOptimizationSearchSpaceField[],
  baselineSnapshot: Record<string, ParameterValue> | undefined,
): PromotionParameterDeltaEntry[] {
  if (!candidate) {
    return [];
  }

  const candidateSnapshot = candidate.parameter_snapshot ?? {};
  const deltaSnapshot = candidate.parameter_delta ?? {};
  const variableFields = fields.filter((field) => field.mode !== "fixed");
  const fieldKeys = variableFields.map((field) => field.key);
  const fallbackKeys = Object.keys({
    ...baselineSnapshot,
    ...candidateSnapshot,
    ...deltaSnapshot,
  }).slice(0, 6);
  const keys = fieldKeys.length ? fieldKeys : fallbackKeys;

  return keys
    .map((key) => {
      const field = fields.find((entry) => entry.key === key);
      const currentValue =
        baselineSnapshot?.[key] ?? field?.current ?? field?.value;
      const candidateValue =
        candidateSnapshot[key] ?? field?.value ?? field?.current;
      const deltaValue = deltaSnapshot[key];
      return {
        key,
        label: field ? getSearchFieldDisplayLabel(field) : humanizeKey(key),
        currentValue: formatParameterValue(currentValue, key),
        candidateValue: formatParameterValue(candidateValue, key),
        deltaValue:
          deltaValue === undefined || deltaValue === null
            ? null
            : formatParameterValue(deltaValue, key),
        changed:
          !parameterValuesMatch(currentValue, candidateValue) ||
          (deltaValue !== undefined && deltaValue !== null),
      };
    })
    .sort((left, right) => Number(right.changed) - Number(left.changed))
    .slice(0, 6);
}

function readProgressText(
  source: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = source?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function readProgressNumber(
  source: Record<string, unknown> | undefined,
  key: string,
  fallback = 0,
): number {
  const value = source?.[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function readProgressBoolean(
  source: Record<string, unknown> | undefined,
  key: string,
  fallback = false,
): boolean {
  const value = source?.[key];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function buildOptimizationProgressSignature(
  job: ApiOptimizationJobDetail | null,
): string {
  if (!job) {
    return "";
  }
  const headline = readProgressText(job.result, "headline") ?? "";
  const completedCombinations = readProgressNumber(
    job.summary,
    "completed_combinations",
    0,
  );
  return `${headline}|${completedCombinations}`;
}

function applyOptimizationPollJitter(intervalMs: number): number {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return OPTIMIZATION_POLL_FAST_INTERVAL_MS;
  }
  if (!Number.isFinite(OPTIMIZATION_POLL_JITTER) || OPTIMIZATION_POLL_JITTER <= 0) {
    return intervalMs;
  }
  const jitterBudget = intervalMs * OPTIMIZATION_POLL_JITTER;
  const jitter = (Math.random() * 2 - 1) * jitterBudget;
  return Math.max(1, Math.round(intervalMs + jitter));
}

function resolveNextOptimizationPollingInterval(
  noProgressCount: number,
): number {
  if (noProgressCount > OPTIMIZATION_POLL_NO_PROGRESS_SLOW_THRESHOLD) {
    return OPTIMIZATION_POLL_SLOW_INTERVAL_MS;
  }
  if (noProgressCount > OPTIMIZATION_POLL_NO_PROGRESS_MEDIUM_THRESHOLD) {
    return OPTIMIZATION_POLL_MEDIUM_INTERVAL_MS;
  }
  return OPTIMIZATION_POLL_FAST_INTERVAL_MS;
}

function isOptimizationRunning(status?: string | null): boolean {
  return ["QUEUED", "RUNNING"].includes(String(status ?? "").toUpperCase());
}

function isOptimizationProgressState(status?: string | null): boolean {
  return ["QUEUED", "RUNNING", "INTERRUPTED"].includes(
    String(status ?? "").toUpperCase(),
  );
}

const MISSING_MATCHING_COMBINATION_COUNT_ERROR =
  "优化结果缺少 matching_combination_count，无法确认符合约束条件的组合总数。";

function getOptimizationMatchingCombinationCount(
  job: ApiOptimizationJobDetail,
): number {
  const value = job.summary?.matching_combination_count;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw new Error(MISSING_MATCHING_COMBINATION_COUNT_ERROR);
}

function isPersistedCandidateOnlyMatchingCount(
  job: ApiOptimizationJobDetail | null | undefined,
): boolean {
  const source =
    job?.summary?.matching_combination_source ?? job?.matching_combination_source;
  return source === "persisted_candidates";
}

function ensureOptimizationJobHasMatchingCombinationCount(
  job: ApiOptimizationJobDetail,
): ApiOptimizationJobDetail {
  if (!isOptimizationProgressState(job.status)) {
    getOptimizationMatchingCombinationCount(job);
  }
  return job;
}

function getOptimizationConstraintComparisonSignature(
  constraints: OptimizationConstraint[],
): string {
  return JSON.stringify(
    constraints
      .map((constraint) => ({
        key: constraint.key,
        operator: constraint.operator,
        value:
          typeof constraint.value === "number" && Number.isFinite(constraint.value)
            ? Number(constraint.value.toFixed(8))
            : constraint.value,
      }))
      .sort((left, right) => {
        const keyDelta = left.key.localeCompare(right.key);
        if (keyDelta !== 0) {
          return keyDelta;
        }
        return left.operator.localeCompare(right.operator);
      }),
  );
}

function optimizationConstraintsHaveSameThresholds(
  left: OptimizationConstraint[],
  right: OptimizationConstraint[],
): boolean {
  return (
    getOptimizationConstraintComparisonSignature(left) ===
    getOptimizationConstraintComparisonSignature(right)
  );
}

function mergeFullOptimizationMatchingCombinations(
  currentJob: ApiOptimizationJobDetail,
  fullJob: ApiOptimizationJobDetail,
  constraints: OptimizationConstraint[],
  objective: OptimizationObjective,
): ApiOptimizationJobDetail {
  const fullMatchingCombinations = Array.isArray(fullJob.matching_combinations)
    ? fullJob.matching_combinations
    : [];
  if (!fullMatchingCombinations.length) {
    return currentJob;
  }
  const fullJobConstraints = getOptimizationConstraintState(fullJob).constraints;
  const shouldTrustFullMatchingCombinations =
    optimizationConstraintsHaveSameThresholds(fullJobConstraints, constraints);
  const sourceMatchingCombinations = shouldTrustFullMatchingCombinations
    ? fullMatchingCombinations
    : filterOptimizationCandidatesByConstraints(fullMatchingCombinations, constraints);
  const matchingCombinations = rankOptimizationCandidatesByObjective(
    sourceMatchingCombinations,
    objective,
  );
  const matchingCombinationCount = matchingCombinations.length;
  const matchingCombinationSource =
    fullJob.summary.matching_combination_source ??
    fullJob.matching_combination_source ??
    currentJob.summary.matching_combination_source ??
    currentJob.matching_combination_source;
  return {
    ...currentJob,
    matching_combination_count: matchingCombinationCount,
    matching_combination_source: matchingCombinationSource,
    matching_combinations: matchingCombinations,
    summary: {
      ...currentJob.summary,
      matching_combination_count: matchingCombinationCount,
      matching_combination_source: matchingCombinationSource,
    },
  };
}

function formatBestMetricsSummary(
  summary: ApiOptimizationTrialSummary | undefined | null,
): string | null {
  if (!summary) {
    return null;
  }
  const metrics = summary.metrics ?? {};
  const annualizedReturn =
    typeof metrics.annualized_return === "number"
      ? metrics.annualized_return
      : typeof metrics.cagr === "number"
        ? metrics.cagr
        : undefined;
  const sharpe =
    typeof metrics.sharpe === "number"
      ? metrics.sharpe
      : typeof metrics.return_sharpe === "number"
        ? metrics.return_sharpe
        : undefined;
  const outOfSampleSharpe =
    typeof metrics.out_of_sample_sharpe === "number"
      ? metrics.out_of_sample_sharpe
      : undefined;
  const maxDrawdownPct =
    typeof metrics.max_drawdown_pct === "number"
      ? metrics.max_drawdown_pct
      : typeof metrics.max_drawdown === "number"
        ? metrics.max_drawdown * 100
        : undefined;
  const parts = [
    typeof annualizedReturn === "number"
      ? `年化 ${formatReturnRate(annualizedReturn)}`
      : null,
    typeof sharpe === "number" ? `收益夏普 ${formatMetric(sharpe)}` : null,
    typeof outOfSampleSharpe === "number"
      ? `样本外 ${formatMetric(outOfSampleSharpe)}`
      : null,
    typeof maxDrawdownPct === "number"
      ? `回撤 ${formatPercentMetric(maxDrawdownPct)}`
      : null,
  ].filter((value): value is string => Boolean(value));
  return parts.length ? parts.join(" · ") : null;
}

function describeCandidateEvaluation(
  candidate: OptimizationDisplayCandidate | null,
): string {
  if (!candidate) {
    return "等待候选结果。";
  }

  const annualizedReturn =
    getCandidateMetric(candidate, "annualized_return") ??
    getCandidateMetric(candidate, "cagr");
  const annualizedText = formatReturnRate(annualizedReturn);
  if (candidate.display_kind === "baseline") {
    return `当前策略基准年化收益率 ${annualizedText}，用于对照优化候选在收益效率、样本外延续性与回撤约束上的改进幅度。`;
  }
  const verdict =
    translateOptimizationText(candidate.status_label) ??
    formatOptimizationStatus(candidate.status);

  if (verdict.includes("晋升") || verdict.includes("提升")) {
    return `年化收益率 ${annualizedText} 已与样本外表现共同进入主护栏，可进入正式版本晋升评估。`;
  }
  if (verdict.includes("观察")) {
    return `年化收益率 ${annualizedText} 已进入观察区，但仍需结合样本外夏普与回撤约束继续复核。`;
  }
  return `年化收益率 ${annualizedText} 尚未建立足够优势，建议继续收窄搜索边界并复核回撤漂移。`;
}

function getCandidateMetric(
  candidate: OptimizationDisplayCandidate,
  key: string,
): number | undefined {
  const value = candidate.metrics?.[key];
  return typeof value === "number" ? value : undefined;
}

function buildBaselineCandidate(
  strategy: ApiStrategyDetail | null,
  baselineRun: ApiBacktestRunDetail | null,
  searchSpace: ApiOptimizationSearchSpaceField[],
  rank: number,
  objective: OptimizationObjective,
): OptimizationDisplayCandidate | null {
  if (!strategy || !baselineRun || !searchSpace.length) {
    return null;
  }

  const latestCompletedRun = strategy.latest_completed_run_summary;
  const annualizedReturn =
    readNumber(baselineRun.metrics?.annualized_return) ??
    readNumber(baselineRun.metrics?.cagr) ??
    readNumber(latestCompletedRun?.annualized_return);
  const returnSharpe =
    readNumber(baselineRun.metrics?.return_sharpe) ??
    readNumber(baselineRun.metrics?.sharpe) ??
    readNumber(latestCompletedRun?.sharpe);
  const outOfSampleSharpe =
    readNumber(baselineRun.metrics?.out_of_sample_sharpe) ??
    readNumber(baselineRun.metrics?.oos_sharpe) ??
    readNumber(latestCompletedRun?.oos_sharpe) ??
    returnSharpe;
  const maxDrawdownPct =
    readNumber(baselineRun.metrics?.max_drawdown_pct) ??
    asPercentFromRatio(
      readNumber(baselineRun.metrics?.max_drawdown) ??
        readNumber(latestCompletedRun?.max_drawdown),
    );
  const turnover =
    readNumber(baselineRun.metrics?.turnover_pct) ??
    readNumber(baselineRun.metrics?.turnover);
  const totalReturnPct =
    readNumber(baselineRun.metrics?.total_return_pct) ??
    asPercentFromRatio(
      readNumber(baselineRun.metrics?.total_return) ??
        readNumber(latestCompletedRun?.total_return),
    );
  const stability = resolveComparableOptimizationStability(baselineRun);

  if (
    annualizedReturn === undefined &&
    returnSharpe === undefined &&
    maxDrawdownPct === undefined
  ) {
    return null;
  }

  const metrics: Record<string, number> = {
    annualized_return: annualizedReturn ?? 0,
    return_sharpe: returnSharpe ?? 0,
    out_of_sample_sharpe: outOfSampleSharpe ?? 0,
    max_drawdown_pct: maxDrawdownPct ?? 0,
    total_return_pct: totalReturnPct ?? 0,
    stability,
  };
  if (turnover !== undefined) {
    metrics.turnover = turnover;
  }
  const parameterSnapshot = {
    ...(strategy.parameters ?? {}),
  };
  const label = "当前组合";
  const summary = "读取当前策略参数与最近完成回测表现，作为本轮优化基准。";
  const heatmap = buildSyntheticHeatmap(
    searchSpace,
    parameterSnapshot,
    metrics,
  );

  return {
    id: `baseline-${strategy.id}`,
    label,
    title: label,
    summary,
    status: "COMPLETED",
    status_label: "当前基准",
    rank,
    score: scoreOptimizationMetrics(metrics, objective),
    parameter_snapshot: parameterSnapshot,
    parameter_delta: {},
    metrics,
    allowed_actions: [],
    analysis: {
      title: label,
      thesis:
        "当前组合仅作为对照基准，用于观察优化候选相对现行参数在收益、样本外延续性与回撤约束上的改善幅度。",
      shelf_copy: summary,
      stability_verdict: "当前基准",
      stability_summary:
        "当前组合用于与优化候选横向比较，重点观察年化收益、样本外夏普与回撤改善幅度。",
      stability_checks: buildDerivedStabilityChecks(metrics),
      validation_windows: buildDerivedValidationWindows(metrics),
      heatmap,
    },
    display_kind: "baseline",
  };
}

function cloneSearchSpace(
  fields: ApiOptimizationSearchSpaceField[],
): ApiOptimizationSearchSpaceField[] {
  return fields.map(({ tag: _tag, ...field }) => ({ ...field, tag: null }));
}

function isAllocationWeightSearchKey(key: string): boolean {
  return key.startsWith("allocation_weight__") && key.endsWith("_pct");
}

function isFactorWeightSearchKey(key: string): boolean {
  return key.startsWith("factor_weight__") && key.endsWith("_pct");
}

function isWeightSumSearchKey(key: string): boolean {
  return isAllocationWeightSearchKey(key) || isFactorWeightSearchKey(key);
}

function getDefaultParameterConstraintMetadata(
  key: string,
): Pick<ApiOptimizationSearchSpaceField, "constraint_group" | "constraint_target"> {
  if (!isWeightSumSearchKey(key)) {
    return {};
  }
  return {
    constraint_group: OPTIMIZATION_WEIGHT_SUM_CONSTRAINT_GROUP,
    constraint_target: OPTIMIZATION_WEIGHT_SUM_TARGET,
  };
}

function asFiniteNumber(value: ParameterValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function getLockedFieldValue(
  field: ApiOptimizationSearchSpaceField,
): ParameterValue {
  return field.current ?? field.value ?? field.start ?? field.end ?? null;
}

function getDefaultFieldStep(value: ParameterValue): ParameterValue {
  const numericValue = asFiniteNumber(value);
  if (numericValue === null) {
    return 1;
  }
  return Number.isInteger(numericValue) ? 1 : 0.5;
}

function normalizeSearchField(
  field: ApiOptimizationSearchSpaceField,
): ApiOptimizationSearchSpaceField {
  if (field.mode === "discrete") {
    const values = getDiscreteFieldValues(field);
    const lockedValue =
      values[0] ?? field.current ?? field.value ?? field.start ?? field.end ?? null;
    return {
      ...field,
      mode: "discrete",
      current: field.current ?? lockedValue,
      value: lockedValue,
      start: lockedValue,
      end: lockedValue,
      step: undefined,
      values,
    };
  }

  if (field.mode !== "fixed") {
    return {
      ...field,
      value: field.value ?? getLockedFieldValue(field),
    };
  }

  const lockedValue = getLockedFieldValue(field);
  return {
    ...field,
    mode: "fixed",
    value: lockedValue,
    start: lockedValue,
    end: lockedValue,
    step: getDefaultFieldStep(lockedValue),
  };
}

function countSearchFieldCombinations(
  field: ApiOptimizationSearchSpaceField,
): number {
  return Math.max(getSearchFieldCombinationValues(field).length, 1);
}

function getSearchFieldCombinationValues(
  field: ApiOptimizationSearchSpaceField,
): ParameterValue[] {
  if (field.mode === "discrete") {
    return getDiscreteFieldValues(field);
  }
  if (field.mode === "fixed") {
    return [getLockedFieldValue(field)];
  }

  const start = asFiniteNumber(field.start);
  const end = asFiniteNumber(field.end);
  const step = asFiniteNumber(field.step);
  if (start === null || end === null || step === null || step === 0) {
    return [field.value ?? getLockedFieldValue(field)];
  }

  const min = Math.min(start, end);
  const max = Math.max(start, end);
  const stride = Math.abs(step);
  const decimals = [min, max, stride].reduce((maxDigits, value) => {
    const fraction = value.toString().split(".")[1];
    return Math.max(maxDigits, fraction?.length ?? 0);
  }, 0);
  const scale = 10 ** decimals;
  const scaledRange = Math.round((max - min) * scale);
  const scaledStride = Math.round(stride * scale);
  if (scaledStride <= 0) {
    return [min];
  }

  const values: number[] = [];
  const count = Math.max(Math.floor(scaledRange / scaledStride) + 1, 1);
  for (let index = 0; index < count; index += 1) {
    values.push((Math.round(min * scale) + scaledStride * index) / scale);
  }
  return values;
}

function getDecimalPlaces(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const text = value.toString().toLowerCase();
  if (text.includes("e-")) {
    const [, exponent] = text.split("e-");
    return Number.parseInt(exponent ?? "0", 10) || 0;
  }
  return text.split(".")[1]?.length ?? 0;
}

function getWeightSumConstrainedFields(
  fields: ApiOptimizationSearchSpaceField[],
): ApiOptimizationSearchSpaceField[] {
  return fields.filter(
    (field) =>
      field.constraint_group === OPTIMIZATION_WEIGHT_SUM_CONSTRAINT_GROUP ||
      isWeightSumSearchKey(field.key),
  );
}

function countWeightSumCombinations(
  fields: ApiOptimizationSearchSpaceField[],
): number | null {
  const weightFields = getWeightSumConstrainedFields(fields);
  if (weightFields.length < 2) {
    return null;
  }

  const numericValueSets = weightFields.map((field) =>
    getSearchFieldCombinationValues(field)
      .map((value) => asFiniteNumber(value))
      .filter((value): value is number => value !== null),
  );
  if (
    numericValueSets.some(
      (values, index) =>
        values.length !== getSearchFieldCombinationValues(weightFields[index]).length,
    )
  ) {
    return null;
  }

  const maxDecimalPlaces = numericValueSets
    .flat()
    .reduce(
      (maxDigits, value) => Math.max(maxDigits, getDecimalPlaces(value)),
      getDecimalPlaces(OPTIMIZATION_WEIGHT_SUM_TARGET),
    );
  const scale = 10 ** maxDecimalPlaces;
  const target = Math.round(OPTIMIZATION_WEIGHT_SUM_TARGET * scale);
  let counts = new Map<number, number>([[0, 1]]);

  numericValueSets.forEach((values) => {
    const nextCounts = new Map<number, number>();
    Array.from(new Set(values)).forEach((value) => {
      const scaledValue = Math.round(value * scale);
      counts.forEach((count, partialSum) => {
        const nextSum = partialSum + scaledValue;
        nextCounts.set(nextSum, (nextCounts.get(nextSum) ?? 0) + count);
      });
    });
    counts = nextCounts;
  });

  return counts.get(target) ?? 0;
}

function calculateBudgetCombinations(
  fields: ApiOptimizationSearchSpaceField[],
): number {
  if (!fields.length) {
    return 0;
  }
  const weightSumCombinationCount = countWeightSumCombinations(fields);
  if (weightSumCombinationCount !== null) {
    const nonWeightCombinationCount = fields
      .filter(
        (field) =>
          !getWeightSumConstrainedFields(fields).some(
            (weightField) => weightField.key === field.key,
          ),
      )
      .reduce((total, field) => total * countSearchFieldCombinations(field), 1);
    return weightSumCombinationCount * nonWeightCombinationCount;
  }
  return fields.reduce(
    (total, field) => total * countSearchFieldCombinations(field),
    1,
  );
}

function buildConfiguredSearchField(
  field: ReturnType<typeof collectOptimizationParameterSeeds>[number],
  index: number,
): ApiOptimizationSearchSpaceField {
  if (field.control === "multiselect") {
    const configuredValues = (field.options ?? []).map((option) => option.value);
    const selectedValues =
      typeof field.value === "string" && field.value.trim()
        ? configuredValues.filter((value) => value === field.value)
        : [];
    return normalizeSearchField({
      key: field.key,
      label: field.label,
      mode: "discrete",
      current: field.value,
      value: field.value,
      values: selectedValues.length ? selectedValues : configuredValues.slice(0, 1),
      tag: "选股规则",
      ...getDefaultParameterConstraintMetadata(field.key),
    });
  }

  const numericValue = asFiniteNumber(field.value);
  if (numericValue === null) {
    return normalizeSearchField({
      key: field.key,
      label: field.label,
      mode: "fixed",
      current: field.value,
      value: field.value,
      start: field.value,
      end: field.value,
      step: 1,
      tag: "选股规则",
      ...getDefaultParameterConstraintMetadata(field.key),
    });
  }

  const step = Number.isInteger(numericValue) ? 1 : 0.5;
  return normalizeSearchField({
    key: field.key,
    label: field.label,
    mode: "range",
    current: numericValue,
    start: Math.max(1, numericValue - (index + 2) * step),
    end: numericValue + (index + 2) * step,
    step,
    tag: "选股规则",
    ...getDefaultParameterConstraintMetadata(field.key),
  });
}

function buildDefaultSearchSpace(
  strategy: ApiStrategyDetail,
  parameterSnapshot?: Record<string, ParameterValue> | null,
): ApiOptimizationSearchSpaceField[] {
  const configuredFields = collectOptimizationParameterSeeds(
    strategy,
    parameterSnapshot,
  );
  if (configuredFields.length) {
    return configuredFields.map((field, index) =>
      buildConfiguredSearchField(field, index),
    );
  }

  const parameters = Object.entries(strategy.parameters ?? {});
  const numericEntries = parameters
    .filter(([, value]) => typeof value === "number")
    .slice(0, 2);
  const fixedEntries = parameters
    .filter(
      ([key]) => !numericEntries.some(([numericKey]) => numericKey === key),
    )
    .slice(0, 2);
  const fields: ApiOptimizationSearchSpaceField[] = numericEntries.map(
    ([key, value], index) => {
      const numericValue = Number(value);
      const step = Number.isInteger(numericValue) ? 1 : 0.5;
      return {
        key,
        label: humanizeKey(key),
        mode: "range",
        current: numericValue,
        start: Math.max(1, numericValue - (index + 2) * step),
        end: numericValue + (index + 2) * step,
        step,
        tag: index === 0 ? "核心参数" : "验证参数",
      };
    },
  );
  fixedEntries.forEach(([key, value]) => {
    fields.push({
      key,
      label: humanizeKey(key),
      mode: "fixed",
      current: value,
      value,
      start: value,
      end: value,
      step: 1,
      tag: "当前固定",
    });
  });
  return fields.map(normalizeSearchField);
}

function buildStrategyMetricsMap(strategies: ApiStrategyListItem[]) {
  return Object.fromEntries(
    strategies.flatMap((strategy) => {
      const latestRunId =
        strategy.latest_successful_run_id ??
        strategy.latest_run_id ??
        strategy.latest_completed_run_summary?.run_id ??
        null;
      if (!latestRunId) {
        return [];
      }
      const summary = strategy.latest_completed_run_summary;
      return [
        [
          latestRunId,
          {
            sharpe:
              typeof summary?.sharpe === "number" ? summary.sharpe : undefined,
            totalReturn:
              typeof summary?.total_return === "number"
                ? summary.total_return * 100
                : undefined,
            maxDrawdown:
              typeof summary?.max_drawdown === "number"
                ? summary.max_drawdown * 100
                : undefined,
          },
        ],
      ];
    }),
  );
}

function OptimizationStepBar({
  current,
  selectHref,
  configHref,
}: {
  current: StepKey;
  selectHref?: string;
  configHref?: string;
}): JSX.Element {
  const steps: Array<{
    key: "select" | "config" | "results";
    title: string;
    description: string;
    href?: string;
  }> = [
    {
      key: "select",
      title: "选择策略",
      description: "菜单创建时先选策略，再进入参数配置。",
      href: selectHref,
    },
    {
      key: "config",
      title: "参数配置",
      description: "确认搜索边界与验证方式，然后启动优化。",
      href: configHref,
    },
    {
      key: "results",
      title: "结果中心",
      description: "回看候选版本、稳定性和参数热区。",
    },
  ] as const;

  function isCompleted(step: (typeof steps)[number]): boolean {
    return (
      (current === "config" && step.key === "select") || current === "results"
    );
  }

  return (
    <section className="optimization-steps" aria-label="优化步骤">
      {steps.map((step) => {
        const active = current === step.key;
        const completed = isCompleted(step);
        const disabled = !active && !completed;
        const className = [
          "optimization-step",
          active ? "optimization-step--active" : "",
          completed ? "optimization-step--completed" : "",
          disabled ? "optimization-step--disabled" : "",
        ]
          .filter(Boolean)
          .join(" ");

        if ((active || completed) && step.href) {
          return (
            <button
              className={className}
              key={step.key}
              onClick={() => navigateTo(step.href!)}
              type="button"
            >
              <strong>{step.title}</strong>
              <span>{step.description}</span>
            </button>
          );
        }

        return (
          <div aria-disabled={disabled} className={className} key={step.key}>
            <strong>{step.title}</strong>
            <span>{step.description}</span>
          </div>
        );
      })}
    </section>
  );
}

export function OptimizationJobsIndexPage(): JSX.Element {
  const api = useApiClient();
  const [jobs, setJobs] = useState<ApiOptimizationJobListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jobPendingDelete, setJobPendingDelete] =
    useState<ApiOptimizationJobListItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        setLoading(true);
        setError(null);
        const payload = await api.listOptimizationJobs();
        if (!cancelled) {
          setJobs(payload);
        }
      } catch (caught) {
        if (!cancelled) {
          setError((caught as Error).message);
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
  }, [api]);

  function closeDeleteDialog(): void {
    if (deleteBusy) {
      return;
    }
    setDeleteError(null);
    setJobPendingDelete(null);
  }

  async function confirmDeleteJob(): Promise<void> {
    if (!jobPendingDelete || deleteBusy) {
      return;
    }
    try {
      setDeleteBusy(true);
      setDeleteError(null);
      await api.deleteOptimizationJob(jobPendingDelete.id);
      setJobs((currentJobs) =>
        currentJobs.filter((job) => job.id !== jobPendingDelete.id),
      );
      setJobPendingDelete(null);
    } catch (caught) {
      setDeleteError((caught as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="optimization-lab-page">
      <section className="optimization-lab-panel optimization-lab-panel--header">
        <div>
          <h1>{TEXT.jobsTitle}</h1>
          <p>{TEXT.jobsCopy}</p>
        </div>
        <button
          className="primary-button"
          onClick={() => navigateTo(buildOptimizationSelectPath())}
          type="button"
        >
          {TEXT.createJob}
        </button>
      </section>

      {loading ? <p className="empty-state">{TEXT.jobsLoading}</p> : null}
      {error ? <div className="error-banner">{error}</div> : null}
      {!loading && !error && !jobs.length ? (
        <p className="empty-state">{TEXT.jobsEmpty}</p>
      ) : null}

      {!loading && jobs.length ? (
        <section className="optimization-lab-panel">
          <div className="optimization-lab-table-shell">
            <table className="optimization-lab-table">
              <thead>
                <tr>
                  <th>任务号</th>
                  <th>策略</th>
                  <th>验证</th>
                  <th>预算</th>
                  <th>当前首选</th>
                  <th>状态</th>
                  <th>更新时间</th>
                  <th>{TEXT.jobsActionColumn}</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const strategyDisplayName = getStrategyDisplayName(
                    translateOptimizationText(job.strategy_name),
                    job.strategy_id,
                  );
                  const strategyVersionTag = formatStrategyVersionTag(
                    job.base_parameter_version_id,
                  );

                  return (
                    <tr key={job.id}>
                      <td>
                        <button
                          className="optimization-link"
                          onClick={() =>
                            navigateTo(`/optimization-jobs/${job.id}`)
                          }
                          type="button"
                        >
                          {job.id}
                        </button>
                      </td>
                      <td>
                        <div
                          className="optimization-jobs-table__strategy"
                          title={
                            strategyVersionTag
                              ? `${strategyDisplayName} ${strategyVersionTag}`
                              : strategyDisplayName
                          }
                        >
                          <span className="optimization-jobs-table__strategy-name">
                            {strategyDisplayName}
                          </span>
                          {strategyVersionTag ? (
                            <span className="status-chip status-chip--soft optimization-jobs-table__strategy-version">
                              {strategyVersionTag}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td>{formatValidationMode(job.validation_mode)}</td>
                      <td>
                        {job.completed_combinations ?? 0} /{" "}
                        {job.budget_combinations ?? 0}
                      </td>
                      <td>
                        {getCandidateDisplayText(job.best_candidate_label, "-")}
                      </td>
                      <td>{formatOptimizationListStatus(job)}</td>
                      <td>
                        {formatUpdatedAt(job.updated_at ?? job.completed_at)}
                      </td>
                      <td className="optimization-jobs-table__actions">
                        <button
                          className="ghost-button optimization-jobs-table__delete"
                          disabled={deleteBusy}
                          onClick={() => {
                            setDeleteError(null);
                            setJobPendingDelete(job);
                          }}
                          type="button"
                        >
                          {deleteBusy && jobPendingDelete?.id === job.id
                            ? TEXT.jobsDeleting
                            : TEXT.jobsDeleteAction}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {jobPendingDelete ? (
        <div
          aria-label={TEXT.jobsDeleteTitle}
          aria-modal="true"
          className="modal-shell"
          onClick={() => closeDeleteDialog()}
          role="dialog"
        >
          <div
            className="modal-card optimization-jobs-delete-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-header">
              <div>
                <p className="eyebrow">{TEXT.jobsActionColumn}</p>
                <h3>{TEXT.jobsDeleteTitle}</h3>
              </div>
            </div>
            <div className="optimization-jobs-delete-dialog__copy">
              <p>
                确认删除任务 <strong>{jobPendingDelete.id}</strong> 吗？
              </p>
              <p>{TEXT.jobsDeleteCopy}</p>
            </div>
            {deleteError ? (
              <div className="error-banner">{deleteError}</div>
            ) : null}
            <div className="modal-card__footer">
              <button
                className="ghost-button"
                disabled={deleteBusy}
                onClick={() => closeDeleteDialog()}
                type="button"
              >
                {TEXT.cancel}
              </button>
              <button
                className="primary-button optimization-jobs-delete-dialog__confirm"
                disabled={deleteBusy}
                onClick={() => void confirmDeleteJob()}
                type="button"
              >
                {deleteBusy ? TEXT.jobsDeleting : TEXT.jobsDeleteConfirm}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function OptimizationStrategySelectPage({
  strategyId,
  sourceRunId,
  entryPoint,
}: {
  strategyId?: string;
  sourceRunId?: string;
  entryPoint?: string;
}): JSX.Element {
  const api = useApiClient();
  const [strategies, setStrategies] = useState<ApiStrategyListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        setLoading(true);
        setError(null);
        await new Promise((resolve) => window.setTimeout(resolve, FIRST_SCREEN_DEFER_MS));
        if (cancelled) {
          return;
        }
        const payload = await api.listStrategies();
        if (!cancelled) {
          setStrategies(payload);
        }
      } catch (caught) {
        if (!cancelled) {
          setError((caught as Error).message);
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
  }, [api]);

  const metricsByRunId = useMemo(
    () => buildStrategyMetricsMap(strategies),
    [strategies],
  );

  return (
    <div className="optimization-lab-page">
      <OptimizationStepBar current="select" />

      <section
        className="optimization-lab-panel optimization-lab-panel--hero"
        style={HERO_PANEL_LAYOUT_STYLE}
      >
        <div>
          <p className="optimization-lab-eyebrow">第一步 · 选择策略</p>
          <h1>{TEXT.selectTitle}</h1>
          <p>{TEXT.selectCopy}</p>
        </div>
        <button
          className="ghost-button"
          onClick={() => navigateTo(buildOptimizationJobsPath())}
          style={HERO_ACTION_BUTTON_STYLE}
          type="button"
        >
          {TEXT.backToJobs}
        </button>
      </section>

      {loading ? <p className="empty-state">正在加载策略列表...</p> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      {!loading && strategies.length ? (
        <section className="optimization-lab-panel">
          <div className="optimization-lab-panel__heading">
            <div>
              <p className="optimization-lab-eyebrow">策略列表</p>
              <h2>{TEXT.selectStrategy}</h2>
            </div>
          </div>
          <div className="optimization-lab-table-shell">
            <table className="optimization-lab-table">
              <thead>
                <tr>
                  <th>策略</th>
                  <th>当前版本</th>
                  <th>最近回测</th>
                  <th>夏普</th>
                  <th>回撤</th>
                  <th>样本外</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {strategies.map((strategy) => {
                  const latestRunId =
                    strategy.latest_successful_run_id ??
                    strategy.latest_run_id ??
                    null;
                  const metrics = latestRunId
                    ? metricsByRunId[latestRunId]
                    : undefined;
                  const selected = strategyId === strategy.id;
                  return (
                    <tr
                      className={
                        selected ? "optimization-lab-table__row--selected" : ""
                      }
                      key={strategy.id}
                    >
                      <td>
                        <div className="optimization-lab-table__stack">
                          <strong>{getDisplayText(strategy.name)}</strong>
                          <span>{getDisplayText(strategy.universe_name)}</span>
                        </div>
                      </td>
                      <td>{strategy.current_parameter_version_id ?? "-"}</td>
                      <td>{latestRunId ?? "-"}</td>
                      <td>{formatMetric(metrics?.sharpe)}</td>
                      <td>{formatPercentMetric(metrics?.maxDrawdown)}</td>
                      <td>{formatPercentMetric(metrics?.totalReturn)}</td>
                      <td>
                        <button
                          className={
                            selected ? "ghost-button" : "primary-button"
                          }
                          onClick={() =>
                            navigateTo(
                              buildOptimizationConfigPath({
                                strategyId: strategy.id,
                                sourceRunId,
                                entryPoint: entryPoint ?? "lab_menu",
                              }),
                            )
                          }
                          type="button"
                        >
                          {selected
                            ? TEXT.selectedStrategy
                            : TEXT.selectStrategy}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function OptimizationConfigPage({
  strategyId,
  sourceRunId,
  entryPoint,
}: {
  strategyId: string;
  sourceRunId?: string;
  entryPoint?: string;
}): JSX.Element {
  const api = useApiClient();
  const [strategy, setStrategy] = useState<ApiStrategyDetail | null>(null);
  const [sourceRun, setSourceRun] = useState<ApiBacktestRunDetail | null>(null);
  const [objective, setObjective] = useState<OptimizationObjective>(
    DEFAULT_OPTIMIZATION_OBJECTIVE,
  );
  const [validationMode, setValidationMode] = useState<
    "walk_forward" | "single_oos"
  >("walk_forward");
  const [searchSpace, setSearchSpace] = useState<
    ApiOptimizationSearchSpaceField[]
  >([]);
  const [constraintPresetKey, setConstraintPresetKey] =
    useState<OptimizationConstraintPresetKey>(DEFAULT_CONSTRAINT_PRESET_KEY);
  const [constraintLabel, setConstraintLabel] = useState(
    getOptimizationConstraintPreset(DEFAULT_CONSTRAINT_PRESET_KEY).label,
  );
  const [constraints, setConstraints] = useState<OptimizationConstraint[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceRunUnavailable, setSourceRunUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        setLoading(true);
        setError(null);
        const strategyPayload = await api.getStrategyDetail(strategyId);
        let runPayload: ApiBacktestRunDetail | null = null;
        let missingSourceRun = false;
        if (sourceRunId) {
          try {
            runPayload = await api.getBacktestRunDetail(sourceRunId, {
              view: "context",
            });
          } catch (caught) {
            if (isMissingBacktestRunError(caught)) {
              missingSourceRun = true;
            } else {
              throw caught;
            }
          }
        }
        if (!cancelled) {
          const constraintDraft = buildOptimizationConstraintDraft(
            DEFAULT_CONSTRAINT_PRESET_KEY,
            null,
            strategyPayload,
            runPayload,
          );
          setStrategy(strategyPayload);
          setSourceRun(runPayload);
          setSourceRunUnavailable(missingSourceRun);
          setObjective(DEFAULT_OPTIMIZATION_OBJECTIVE);
          setValidationMode("walk_forward");
          setSearchSpace(
            buildDefaultSearchSpace(
              strategyPayload,
              runPayload?.parameter_snapshot,
            ),
          );
          setConstraintPresetKey(constraintDraft.constraintPresetKey);
          setConstraintLabel(constraintDraft.constraintLabel);
          setConstraints(constraintDraft.constraints);
        }
      } catch (caught) {
        if (!cancelled) {
          setError((caught as Error).message);
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
  }, [api, sourceRunId, strategyId]);

  const selectHref = buildOptimizationSelectPath({
    strategyId,
    sourceRunId,
    entryPoint,
  });
  const budgetCombinations = useMemo(
    () => calculateBudgetCombinations(searchSpace),
    [searchSpace],
  );
  const hasWeightSumDefaultConstraint = useMemo(
    () => getWeightSumConstrainedFields(searchSpace).length > 1,
    [searchSpace],
  );
  const combinationCountLabel = hasWeightSumDefaultConstraint
    ? "有效组合"
    : "预计组合";
  const rangeFieldCount = useMemo(
    () => searchSpace.filter((field) => field.mode === "range").length,
    [searchSpace],
  );
  const fixedFieldCount = useMemo(
    () => searchSpace.filter((field) => field.mode === "fixed").length,
    [searchSpace],
  );
  const effectiveSourceRunId = sourceRunUnavailable
    ? null
    : (sourceRunId ?? null);
  const baselineMetricLabel = sourceRunUnavailable
    ? "当前参数夏普"
    : "来源基线夏普";
  const baselineMetricValue = useMemo(() => {
    if (!strategy) {
      return "-";
    }
    const value =
      readNumber(sourceRun?.metrics?.out_of_sample_sharpe) ??
      readNumber(
        sourceRun?.metrics?.return_sharpe ?? sourceRun?.metrics?.sharpe,
      ) ??
      readNumber(strategy.latest_completed_run_summary?.oos_sharpe) ??
      readNumber(strategy.latest_completed_run_summary?.sharpe);
    return typeof value === "number" ? value.toFixed(2) : "-";
  }, [sourceRun, strategy]);
  const currentConstraintVerdicts = useMemo(
    () =>
      constraints.map((constraint) => ({
        key: constraint.key,
        label: constraint.label,
        verdict: evaluateOptimizationConstraint(constraint),
      })),
    [constraints],
  );

  function syncConstraintDraft(
    nextPresetKey: OptimizationConstraintPresetKey,
    nextConstraints: OptimizationConstraint[],
  ): void {
    if (!strategy) {
      return;
    }
    const draft = buildOptimizationConstraintDraft(
      nextPresetKey,
      {
        constraint_preset_key: nextPresetKey,
        constraints: nextConstraints,
      },
      strategy,
      sourceRun,
    );
    setConstraintPresetKey(draft.constraintPresetKey);
    setConstraintLabel(draft.constraintLabel);
    setConstraints(draft.constraints);
  }

  function selectConstraintPreset(
    nextPresetKey: OptimizationConstraintPresetKey,
  ): void {
    syncConstraintDraft(
      nextPresetKey,
      getOptimizationConstraintPreset(nextPresetKey).constraints,
    );
  }

  function updateConstraint(index: number, value: string): void {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) {
      return;
    }
    const nextConstraints = constraints.map((constraint, constraintIndex) =>
      constraintIndex === index
        ? {
            ...constraint,
            value: nextValue,
            source: "manual" as const,
          }
        : constraint,
    );
    syncConstraintDraft(constraintPresetKey, nextConstraints);
  }

  function updateSearchField(
    index: number,
    patch: Partial<ApiOptimizationSearchSpaceField>,
  ): void {
    setSearchSpace((current) =>
      current.map((field, fieldIndex) =>
        fieldIndex === index
          ? normalizeSearchField({ ...field, ...patch })
          : field,
      ),
    );
  }

  async function handleStartOptimization(): Promise<void> {
    if (!strategy) {
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const payload: ApiOptimizationJobCreatePayload = {
        objective,
        base_parameter_version_id:
          strategy.current_parameter_version_id ?? null,
        source_run_id: effectiveSourceRunId,
        entry_point:
          entryPoint ?? (effectiveSourceRunId ? "run_detail" : "lab_menu"),
        validation_mode: validationMode,
        budget_combinations: budgetCombinations,
        search_space: cloneSearchSpace(searchSpace),
        constraint_preset_key: constraintPresetKey,
        constraint_label: constraintLabel,
        constraints: cloneOptimizationConstraints(
          constraints,
          constraintPresetKey,
        ),
      };
      const created = await api.createOptimizationJob(strategy.id, payload);
      navigateTo(`/optimization-jobs/${created.id}`);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function resetPreset(): void {
    if (!strategy) {
      return;
    }
    const constraintDraft = buildOptimizationConstraintDraft(
      DEFAULT_CONSTRAINT_PRESET_KEY,
      null,
      strategy,
      sourceRun,
    );
    setObjective(DEFAULT_OPTIMIZATION_OBJECTIVE);
    setValidationMode("walk_forward");
    setSearchSpace(
      buildDefaultSearchSpace(strategy, sourceRun?.parameter_snapshot),
    );
    setConstraintPresetKey(constraintDraft.constraintPresetKey);
    setConstraintLabel(constraintDraft.constraintLabel);
    setConstraints(constraintDraft.constraints);
  }

  return (
    <div className="optimization-lab-page">
      <OptimizationStepBar current="config" selectHref={selectHref} />

      <section
        className="optimization-lab-panel optimization-lab-panel--hero"
        style={HERO_PANEL_LAYOUT_STYLE}
      >
        <div>
          <p className="optimization-lab-eyebrow">第二步 · 参数配置</p>
          <h1 className="optimization-lab-panel__hero-title">
            <span>{getStrategyDisplayName(translateOptimizationText(strategy?.name), TEXT.configTitle)}</span>
            {formatStrategyVersionTag(strategy?.current_parameter_version_id) ? (
              <span aria-hidden="true" className="status-chip status-chip--soft optimization-lab-panel__hero-version">
                {formatStrategyVersionTag(strategy?.current_parameter_version_id)}
              </span>
            ) : null}
          </h1>
          <p>{TEXT.configCopy}</p>
          {!loading && strategy ? (
            <div className="optimization-meta-chips">
              <span className="status-chip status-chip--soft">
                入口：{formatEntryPoint(entryPoint)}
              </span>
              <span className="status-chip status-chip--soft">
                当前版本：{formatStrategyVersionTag(strategy.current_parameter_version_id) ?? "-"}
              </span>
              <span className="status-chip status-chip--soft">
                {combinationCountLabel}：{budgetCombinations} 组
              </span>
              {hasWeightSumDefaultConstraint ? (
                <span className="status-chip status-chip--soft">
                  默认约束：权重合计 100%
                </span>
              ) : null}
              {sourceRun ? (
                <span className="status-chip status-chip--soft">
                  来源回测：{sourceRun.id}
                </span>
              ) : null}
            </div>
          ) : null}
          {sourceRunUnavailable ? (
            <p className="optimization-inline-notice">
              {MISSING_SOURCE_RUN_NOTICE}
            </p>
          ) : null}
        </div>
        <div
          className="optimization-hero-actions optimization-hero-actions--single-row"
          style={HERO_ACTIONS_LAYOUT_STYLE}
        >
          <button
            className="ghost-button"
            onClick={() => navigateTo(buildOptimizationJobsPath())}
            style={HERO_ACTION_BUTTON_STYLE}
            type="button"
          >
            {TEXT.backToJobs}
          </button>
          <button
            className="ghost-button"
            onClick={resetPreset}
            style={HERO_ACTION_BUTTON_STYLE}
            type="button"
          >
            {TEXT.resetPreset}
          </button>
          <button
            className="primary-button"
            disabled={saving || loading || budgetCombinations <= 0}
            onClick={() => void handleStartOptimization()}
            style={HERO_ACTION_BUTTON_STYLE}
            type="button"
          >
            {TEXT.startOptimization}
          </button>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}
      {loading ? <p className="empty-state">正在加载参数配置...</p> : null}

      {!loading && strategy ? (
        <div className="optimization-config-grid">
          <section className="optimization-lab-panel">
            <div className="optimization-lab-panel__heading">
              <div>
                <p className="optimization-lab-eyebrow">搜索边界</p>
                <h2>参数范围</h2>
              </div>
            </div>

            <div className="optimization-lab-table-shell optimization-lab-table-shell--form">
              <table className="optimization-lab-table">
                <thead>
                  <tr>
                    <th>参数</th>
                    <th>当前值</th>
                    <th>模式</th>
                    <th>起点</th>
                    <th>终点</th>
                    <th>步长</th>
                  </tr>
                </thead>
                <tbody>
                  {searchSpace.map((field, index) => {
                    const displayLabel = getSearchFieldDisplayLabel(field);
                    const discreteOptions = getDiscreteFieldOptions(field.key);
                    const discreteValues = getDiscreteFieldValues(field).map(String);

                    return (
                      <tr key={field.key}>
                        <td>{displayLabel}</td>
                        <td>{formatParameterValue(field.current, field.key)}</td>
                        {isDiscreteSearchField(field) ? (
                          <>
                            <td>
                              <span className="optimization-search-mode-pill">
                                多选
                              </span>
                            </td>
                            <td
                              className="optimization-lab-table__cell--wrap"
                              colSpan={3}
                            >
                              <OptimizationDiscreteFieldControl
                                fieldKey={field.key}
                                hint="可同时选择多个周期，系统会分别生成组合。"
                                label={displayLabel}
                                onChange={(nextValues) =>
                                  updateSearchField(index, {
                                    mode: "discrete",
                                    current: field.current,
                                    value: nextValues[0] ?? null,
                                    values: nextValues,
                                  })
                                }
                                options={discreteOptions}
                                values={discreteValues}
                              />
                            </td>
                          </>
                        ) : (
                          <>
                            <td>
                              <select
                                aria-label={`${displayLabel} 模式`}
                                value={field.mode}
                                onChange={(event) =>
                                  updateSearchField(index, {
                                    mode: event.target.value as
                                      | "range"
                                      | "fixed",
                                  })
                                }
                              >
                                <option value="range">范围</option>
                                <option value="fixed">固定</option>
                              </select>
                            </td>
                            <td>
                              <input
                                aria-label={`${displayLabel} 起点`}
                                disabled={field.mode === "fixed"}
                                onChange={(event) =>
                                  updateSearchField(index, {
                                    start: event.target.value,
                                  })
                                }
                                value={formatEditableParameterValue(field.start)}
                              />
                            </td>
                            <td>
                              <input
                                aria-label={`${displayLabel} 终点`}
                                disabled={field.mode === "fixed"}
                                onChange={(event) =>
                                  updateSearchField(index, {
                                    end: event.target.value,
                                  })
                                }
                                value={formatEditableParameterValue(field.end)}
                              />
                            </td>
                            <td>
                              <input
                                aria-label={`${displayLabel} 步长`}
                                disabled={field.mode === "fixed"}
                                onChange={(event) =>
                                  updateSearchField(index, {
                                    step: event.target.value,
                                  })
                                }
                                value={formatEditableParameterValue(field.step)}
                              />
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="optimization-config-summary-grid">
              <article className="optimization-config-summary-card">
                <span>范围参数</span>
                <strong>{rangeFieldCount}</strong>
              </article>
              <article className="optimization-config-summary-card">
                <span>固定参数</span>
                <strong>{fixedFieldCount}</strong>
              </article>
              <article className="optimization-config-summary-card">
                <span>{combinationCountLabel}</span>
                <strong>{budgetCombinations}</strong>
              </article>
              <article className="optimization-config-summary-card">
                <span>{baselineMetricLabel}</span>
                <strong>{baselineMetricValue}</strong>
              </article>
            </div>
          </section>

          <section className="optimization-lab-panel optimization-constraint-panel">
            <div className="optimization-lab-panel__heading">
              <div>
                <p className="optimization-lab-eyebrow">目标与过滤</p>
                <h2>约束条件</h2>
              </div>
            </div>

            <section className="optimization-constraint-section">
              <div className="optimization-constraint-section__header">
                <h3>目标排序</h3>
              </div>
              <div
                aria-label="目标排序"
                className="optimization-objective-toggle"
                role="tablist"
              >
                {OPTIMIZATION_OBJECTIVE_OPTIONS.map((option) => (
                  <button
                    aria-pressed={objective === option.key}
                    className={`optimization-objective-toggle__option ${
                      objective === option.key
                        ? "optimization-objective-toggle__option--active"
                        : ""
                    }`}
                    key={option.key}
                    onClick={() => setObjective(option.key)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="optimization-constraint-section">
              <div className="optimization-constraint-section__header">
                <h3>约束预设</h3>
              </div>
              <div
                aria-label="约束预设"
                className="optimization-constraint-preset-grid"
                role="radiogroup"
              >
                {OPTIMIZATION_CONSTRAINT_PRESETS.map((preset) => (
                  <button
                    aria-checked={preset.key === constraintPresetKey}
                    className={`optimization-constraint-preset ${
                      preset.key === constraintPresetKey
                        ? "optimization-constraint-preset--active"
                        : ""
                    }`}
                    key={preset.key}
                    onClick={() => selectConstraintPreset(preset.key)}
                    role="radio"
                    type="button"
                  >
                    <span className="optimization-constraint-preset__tone">
                      {preset.toneLabel}
                    </span>
                    <strong>{preset.label}</strong>
                  </button>
                ))}
              </div>
            </section>

            <section className="optimization-constraint-section">
              <div className="optimization-constraint-section__header">
                <h3>硬性护栏</h3>
                <span className="status-chip status-chip--soft">
                  {constraints.length} 项已启用
                </span>
              </div>
              <div className="optimization-constraint-grid">
                {constraints.map((constraint, index) => {
                  const verdict = evaluateOptimizationConstraint(constraint);
                  const unitLabel = constraint.unit.trim();
                  return (
                    <article
                      className={`optimization-constraint-card optimization-constraint-card--${verdict}`}
                      key={constraint.key}
                    >
                      <div className="optimization-constraint-card__topline">
                        <span className="optimization-constraint-card__category">
                          {formatOptimizationConstraintCategory(
                            constraint.category,
                          )}
                        </span>
                      </div>
                      <label
                        className="optimization-constraint-card__rule"
                        htmlFor={`optimization-constraint-${constraint.key}`}
                      >
                        <span className="optimization-constraint-card__rule-label">
                          {constraint.label}
                        </span>
                        <span className="optimization-constraint-card__rule-operator">
                          {formatOptimizationConstraintOperator(
                            constraint.operator,
                          )}
                        </span>
                        <OptimizationConstraintThresholdInput
                          ariaLabel={`${constraint.label} 阈值`}
                          className="optimization-constraint-card__rule-input"
                          id={`optimization-constraint-${constraint.key}`}
                          onCommitValue={(nextValue) =>
                            updateConstraint(index, String(nextValue))
                          }
                          step={getOptimizationConstraintInputStep(
                            constraint.key,
                          )}
                          value={constraint.value}
                        />
                        {unitLabel ? (
                          <span className="optimization-constraint-card__rule-unit">
                            {unitLabel}
                          </span>
                        ) : null}
                      </label>
                      <div className="optimization-constraint-card__badges">
                        <span className="status-chip status-chip--soft optimization-constraint-card__badge optimization-constraint-card__badge--baseline">
                          当前策略{" "}
                          {formatOptimizationConstraintThreshold({
                            ...constraint,
                            value:
                              constraint.baseline_value ?? constraint.value,
                          })}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <div className="optimization-constraint-footer-grid">
              <section className="optimization-constraint-section">
                <div className="optimization-constraint-section__header">
                  <h3>验证方式</h3>
                </div>
                <label className="optimization-form-field optimization-form-field--compact">
                  <select
                    value={validationMode}
                    onChange={(event) =>
                      setValidationMode(
                        event.target.value as "walk_forward" | "single_oos",
                      )
                    }
                  >
                    <option value="walk_forward">滚动前瞻验证</option>
                    <option value="single_oos">单次样本外验证</option>
                  </select>
                </label>
              </section>

              <section className="optimization-constraint-section">
                <div className="optimization-constraint-section__header">
                  <h3>组合预估</h3>
                </div>
                <div className="optimization-constraint-stats">
                  <span>
                    {hasWeightSumDefaultConstraint
                      ? "默认约束 权重合计 100%"
                      : `目标排序 ${getOptimizationObjectiveLabel(objective)}`}
                  </span>
                  <strong>{budgetCombinations} 组</strong>
                </div>
              </section>
            </div>

            <section className="optimization-constraint-section">
              <div className="optimization-constraint-section__header">
                <h3>当前判定</h3>
              </div>
              <div
                className="optimization-constraint-judgement-row"
                title={constraintLabel}
              >
                <span className="status-chip status-chip--soft">
                  {constraintLabel}
                </span>
                {hasWeightSumDefaultConstraint ? (
                  <span className="status-chip status-chip--soft">
                    权重合计 100%
                  </span>
                ) : null}
                {currentConstraintVerdicts.map((entry) => (
                  <span
                    className={`status-chip status-chip--soft optimization-constraint-card__verdict optimization-constraint-card__verdict--${entry.verdict}`}
                    key={entry.key}
                  >
                    {entry.label}{" "}
                    {formatOptimizationConstraintVerdict(entry.verdict)}
                  </span>
                ))}
              </div>
            </section>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export function OptimizationResultsPage({
  jobId,
}: {
  jobId: string;
}): JSX.Element {
  const api = useApiClient();
  const [job, setJob] = useState<ApiOptimizationJobDetail | null>(null);
  const [strategy, setStrategy] = useState<ApiStrategyDetail | null>(null);
  const [baselineRun, setBaselineRun] = useState<ApiBacktestRunDetail | null>(
    null,
  );
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(
    null,
  );
  const [selectedHeatmapMetric, setSelectedHeatmapMetric] =
    useState<HeatmapMetricKey>("annualized_return");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [constraintToast, setConstraintToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rerunConfirmOpen, setRerunConfirmOpen] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [constraintPresetKey, setConstraintPresetKey] =
    useState<OptimizationConstraintPresetKey>(DEFAULT_CONSTRAINT_PRESET_KEY);
  const [objectiveDraft, setObjectiveDraft] = useState<OptimizationObjective>(
    DEFAULT_OPTIMIZATION_OBJECTIVE,
  );
  const [constraintDraftLabel, setConstraintDraftLabel] = useState(
    getOptimizationConstraintPreset(DEFAULT_CONSTRAINT_PRESET_KEY).label,
  );
  const [constraintDrafts, setConstraintDrafts] = useState<
    OptimizationConstraint[]
  >([]);
  const [appliedObjective, setAppliedObjective] =
    useState<OptimizationObjective | null>(null);
  const [appliedConstraints, setAppliedConstraints] = useState<
    OptimizationConstraint[]
  >([]);
  const [filteredResultDraft, setFilteredResultDraft] =
    useState<ApiOptimizationFilteredResultCreatePayload | null>(null);
  const [constraintLiveMessage, setConstraintLiveMessage] = useState("");
  const [allCombinationsOpen, setAllCombinationsOpen] = useState(false);
  const [allCombinationsLoadingFull, setAllCombinationsLoadingFull] =
    useState(false);
  const [allCombinationsPage, setAllCombinationsPage] = useState(1);
  const [promotionConfirmOpen, setPromotionConfirmOpen] = useState(false);
  const [promotionDecisionNote, setPromotionDecisionNote] = useState("");
  const [allCombinationsSortKey, setAllCombinationsSortKey] =
    useState<OptimizationAllCombinationSortKey>(
      getOptimizationAllCombinationsDefaultSortKey(
        DEFAULT_OPTIMIZATION_OBJECTIVE,
      ),
    );
  const [allCombinationsSortDirection, setAllCombinationsSortDirection] =
    useState<SortDirection>("desc");
  const allCombinationsTableShellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!constraintToast) {
      return;
    }
    const timer = window.setTimeout(() => {
      setConstraintToast(null);
    }, 3200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [constraintToast]);

  useEffect(() => {
    if (!allCombinationsOpen) {
      return undefined;
    }

    function handleEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setAllCombinationsOpen(false);
      }
    }

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [allCombinationsOpen]);

  useEffect(() => {
    if (!allCombinationsOpen) {
      return undefined;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
    };
  }, [allCombinationsOpen]);

  useEffect(() => {
    if (!promotionConfirmOpen) {
      return undefined;
    }

    function handleEscape(event: KeyboardEvent): void {
      if (event.key === "Escape" && !saving) {
        setPromotionConfirmOpen(false);
      }
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
      document.removeEventListener("keydown", handleEscape);
    };
  }, [promotionConfirmOpen, saving]);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        setLoading(true);
        setError(null);
        await new Promise((resolve) => window.setTimeout(resolve, FIRST_SCREEN_DEFER_MS));
        if (cancelled) {
          return;
        }
        const jobPayload = ensureOptimizationJobHasMatchingCombinationCount(
          await api.getOptimizationJobDetail(jobId, {
            matchingLimit: OPTIMIZATION_DETAIL_ROUTE_MATCHING_LIMIT,
          }),
        );
        const strategyPayload = await api.getStrategyDetail(
          jobPayload.strategy_id,
        );
        let baselineRunPayload: ApiBacktestRunDetail | null = null;
        const baselineRunIds: string[] = [];
        const addBaselineRunId = (value: string | null | undefined): void => {
          const trimmed = typeof value === "string" ? value.trim() : "";
          if (trimmed && !baselineRunIds.includes(trimmed)) {
            baselineRunIds.push(trimmed);
          }
        };
        addBaselineRunId(jobPayload.request.source_run_id);
        addBaselineRunId(strategyPayload.latest_completed_run_summary?.run_id);
        addBaselineRunId(strategyPayload.latest_run_id);
        for (const baselineRunId of baselineRunIds) {
          try {
            baselineRunPayload = await api.getBacktestRunDetail(baselineRunId, {
              view: "initial",
            });
            break;
          } catch {
            baselineRunPayload = null;
          }
        }
        if (!cancelled) {
          setJob(jobPayload);
          setFilteredResultDraft(null);
          setStrategy(strategyPayload);
          setBaselineRun(baselineRunPayload);
          setSelectedCandidateId(
            jobPayload.result.best_candidate_id ??
              jobPayload.candidates[0]?.id ??
              null,
          );
        }
      } catch (caught) {
        if (!cancelled) {
          setError((caught as Error).message);
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
  }, [api, jobId]);

  useEffect(() => {
    if (!job || !isOptimizationRunning(job.status)) {
      return;
    }

    let cancelled = false;
    let inFlight = false;
    let isPageVisible = !document.hidden;
    let timer: number | null = null;
    let noProgressCount = 0;
    let currentDelayMs = OPTIMIZATION_POLL_FAST_INTERVAL_MS;
    let lastProgressSignature = buildOptimizationProgressSignature(job);

    const clearPollingTimer = (): void => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const scheduleNextPoll = (delayMs: number): void => {
      clearPollingTimer();
      if (cancelled || !isPageVisible) {
        return;
      }
      timer = window.setTimeout(() => {
        void refresh();
      }, applyOptimizationPollJitter(delayMs));
    };

    const refresh = async (): Promise<void> => {
      if (cancelled || !isPageVisible || inFlight) {
        return;
      }
      inFlight = true;
      try {
        const jobPayload = ensureOptimizationJobHasMatchingCombinationCount(
          await api.getOptimizationJobDetail(jobId, {
            matchingLimit: OPTIMIZATION_DETAIL_ROUTE_MATCHING_LIMIT,
          }),
        );
        if (cancelled) {
          return;
        }
        const nextProgressSignature = buildOptimizationProgressSignature(jobPayload);
        if (nextProgressSignature === lastProgressSignature) {
          noProgressCount += 1;
        } else {
          noProgressCount = 0;
        }
        currentDelayMs = resolveNextOptimizationPollingInterval(noProgressCount);
        lastProgressSignature = nextProgressSignature;
        setError(null);
        setJob(jobPayload);
      } catch (caught) {
        if (!cancelled) {
          setError((caught as Error).message);
        }
      } finally {
        inFlight = false;
        if (!cancelled && isPageVisible) {
          scheduleNextPoll(currentDelayMs);
        }
      }
    };

    const handleVisibilityChange = (): void => {
      isPageVisible = !document.hidden;
      if (!isPageVisible) {
        clearPollingTimer();
        return;
      }
      noProgressCount = 0;
      currentDelayMs = OPTIMIZATION_POLL_FAST_INTERVAL_MS;
      if (isOptimizationRunning(job.status)) {
        void refresh();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void refresh();

    return () => {
      cancelled = true;
      clearPollingTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [api, jobId, job?.status]);

  const optimizationSearchSpace = useMemo(
    () => getOptimizationSearchSpace(job),
    [job],
  );
  const resultConstraintSyncSignature = JSON.stringify({
    jobId: job?.id ?? null,
    requestObjective: job?.request.objective ?? null,
    summaryObjective: job?.summary.objective ?? null,
    requestPresetKey: job?.request.constraint_preset_key ?? null,
    summaryPresetKey: job?.summary.constraint_preset_key ?? null,
    resultPresetKey: job?.result.constraint_preset_key ?? null,
    requestConstraintLabel: job?.request.constraint_label ?? null,
    summaryConstraintLabel: job?.summary.constraint_label ?? null,
    resultConstraintLabel: job?.result.constraint_label ?? null,
    requestConstraints: job?.request.constraints ?? null,
    summaryConstraints: job?.summary.constraints ?? null,
    resultConstraints: job?.result.constraints ?? null,
  });
  const persistedOptimizationConstraintState = useMemo(
    () => getOptimizationConstraintState(job),
    [job],
  );

  useEffect(() => {
    if (!job || !strategy) {
      return;
    }
    const constraintDraft = buildOptimizationResultConstraintDraft(
      job,
      strategy,
      baselineRun,
    );
    const nextObjective = normalizeOptimizationObjective(
      job.summary.objective ?? job.request.objective,
    );
    setObjectiveDraft(nextObjective);
    setAppliedObjective(nextObjective);
    setConstraintPresetKey(constraintDraft.constraintPresetKey);
    setConstraintDraftLabel(constraintDraft.constraintLabel);
    setConstraintDrafts(constraintDraft.constraints);
    setAppliedConstraints(constraintDraft.constraints);
    setConstraintLiveMessage("");
  }, [baselineRun, resultConstraintSyncSignature, strategy]);

  const optimizationObjective = appliedObjective
    ? normalizeOptimizationObjective(appliedObjective)
    : normalizeOptimizationObjective(
        job?.summary.objective ?? job?.request.objective,
      );
  const optimizationConstraints = appliedConstraints.length
    ? appliedConstraints
    : persistedOptimizationConstraintState.constraints;
  const activeOptimizationFilterRef = useRef<{
    constraints: OptimizationConstraint[];
    objective: OptimizationObjective;
  }>({
    constraints: [],
    objective: DEFAULT_OPTIMIZATION_OBJECTIVE,
  });
  activeOptimizationFilterRef.current = {
    constraints: optimizationConstraints,
    objective: optimizationObjective,
  };
  const quickFilterConstraints = constraintDrafts.length
    ? constraintDrafts
    : optimizationConstraints;
  const optimizationProgressState = isOptimizationProgressState(job?.status);
  const optimizationRunning = isOptimizationRunning(job?.status);
  const optimizationInterrupted =
    String(job?.status ?? "").toUpperCase() === "INTERRUPTED";
  const matchingCombinationCountIsPartial =
    !optimizationProgressState &&
    isPersistedCandidateOnlyMatchingCount(job);
  const matchingCandidates = useMemo(
    () => {
      const filteredCandidates = filterOptimizationCandidatesByConstraints(
        job?.candidates ?? [],
        optimizationConstraints,
      );
      return rankOptimizationCandidatesByObjective(
        filteredCandidates,
        optimizationObjective,
      );
    },
    [job?.candidates, optimizationConstraints, optimizationObjective],
  );
  const matchingCandidatesFromAllCombinations = useMemo<
    OptimizationDisplayCandidate[]
  >(
    () => {
      if (
        matchingCombinationCountIsPartial ||
        !Array.isArray(job?.matching_combinations) ||
        !job.matching_combinations.length
      ) {
        return [];
      }
      const filteredCandidates = filterOptimizationCandidatesByConstraints(
        job.matching_combinations,
        optimizationConstraints,
      );
      return rankOptimizationCandidatesByObjective(
        filteredCandidates,
        optimizationObjective,
      );
    },
    [
      job?.matching_combinations,
      matchingCombinationCountIsPartial,
      optimizationConstraints,
      optimizationObjective,
    ],
  );
  const hasFullMatchingCombinations = Boolean(
    !matchingCombinationCountIsPartial &&
      Array.isArray(job?.matching_combinations) &&
      job.matching_combinations.length,
  );
  const displayedMatchingCandidates = useMemo<OptimizationDisplayCandidate[]>(
    () =>
      hasFullMatchingCombinations
        ? matchingCandidatesFromAllCombinations
        : matchingCandidates,
    [
      hasFullMatchingCombinations,
      matchingCandidates,
      matchingCandidatesFromAllCombinations,
    ],
  );
  const allMatchingCombinationCandidates = useMemo<
    OptimizationDisplayCandidate[]
  >(() => {
    if (Array.isArray(job?.matching_combinations) && job.matching_combinations.length) {
      return sortOptimizationCandidatesForModal(
        job.matching_combinations,
        optimizationSearchSpace,
        getOptimizationAllCombinationsDefaultSortKey(optimizationObjective),
        "desc",
      );
    }
    return displayedMatchingCandidates;
  }, [
    displayedMatchingCandidates,
    job?.matching_combinations,
    optimizationObjective,
    optimizationSearchSpace,
  ]);
  const baselineCandidate = useMemo(
    () =>
      job?.candidates.length
        ? buildBaselineCandidate(
            strategy,
            baselineRun,
            optimizationSearchSpace,
            Math.min(
              displayedMatchingCandidates.length,
              OPTIMIZATION_CANDIDATE_PANEL_LIMIT,
            ) + 1,
            optimizationObjective,
          )
        : null,
    [
      baselineRun,
      displayedMatchingCandidates.length,
      job?.candidates.length,
      optimizationObjective,
      optimizationSearchSpace,
      strategy,
    ],
  );
  const candidatePanelRows = useMemo<OptimizationDisplayCandidate[]>(
    () =>
      displayedMatchingCandidates.slice(0, OPTIMIZATION_CANDIDATE_PANEL_LIMIT),
    [displayedMatchingCandidates],
  );
  const candidateRows = useMemo<OptimizationDisplayCandidate[]>(
    () => [
      ...candidatePanelRows,
      ...(baselineCandidate ? [baselineCandidate] : []),
    ],
    [baselineCandidate, candidatePanelRows],
  );
  const baselineMatchesConstraints = useMemo(
    () =>
      baselineCandidate
        ? candidatePassesOptimizationConstraints(
            baselineCandidate,
            optimizationConstraints,
          )
        : false,
    [baselineCandidate, optimizationConstraints],
  );

  useEffect(() => {
    if (!job) {
      return;
    }
    const fallbackCandidateId = candidateRows[0]?.id ?? null;
    if (
      !selectedCandidateId ||
      !candidateRows.some((candidate) => candidate.id === selectedCandidateId)
    ) {
      setSelectedCandidateId(fallbackCandidateId);
    }
  }, [candidateRows, job, selectedCandidateId]);

  const selectedCandidate = useMemo<OptimizationDisplayCandidate | null>(
    () =>
      candidateRows.find((candidate) => candidate.id === selectedCandidateId) ??
      candidateRows[0] ??
      null,
    [candidateRows, selectedCandidateId],
  );
  const optimizationRangeSummary = useMemo(
    () => buildOptimizationRangeSummary(optimizationSearchSpace),
    [optimizationSearchSpace],
  );
  const totalCandidateCount = job?.candidates.length ?? 0;
  const matchingCombinationCount =
    job && !optimizationProgressState
      ? Math.max(0, getOptimizationMatchingCombinationCount(job))
      : 0;
  const matchingCombinationsLoadedCount = Array.isArray(job?.matching_combinations)
    ? job.matching_combinations.length
    : 0;
  const plannedCombinationCount =
    typeof job?.summary.budget_combinations === "number"
      ? job.summary.budget_combinations
      : typeof job?.request.budget_combinations === "number"
        ? job.request.budget_combinations
        : 0;
  const filteredOutCandidateCount = Math.max(
    0,
    totalCandidateCount - displayedMatchingCandidates.length,
  );
  const candidatePanelSubtitle = matchingCombinationCountIsPartial
    ? `当前仅基于已保存候选识别到 ${matchingCombinationCount} 个符合约束的组合。该历史任务缺少全量 trial 明细，因此这不是${plannedCombinationCount ? ` ${plannedCombinationCount} ` : ""}组组合的完整筛选结果。`
    : `符合约束条件的组合共${matchingCombinationCount}个，以下按 ${getOptimizationObjectiveLabel(
        optimizationObjective,
      )} 输出当前候选版本排序。`;
  const allCombinationsButtonLabel = matchingCombinationCountIsPartial
    ? "查看已保存候选"
    : "查看全部组合";
  const allCombinationsDialogTitle = matchingCombinationCountIsPartial
    ? "已保存的符合约束候选"
    : "全部符合约束条件的组合";
  const allCombinationsDialogCopy = matchingCombinationCountIsPartial
    ? `当前仅有 ${matchingCombinationCount} 组已保存候选可供查看；该历史任务缺少全量 trial 明细，因此不能代表${plannedCombinationCount ? `全部 ${plannedCombinationCount} 组` : "全量"}组合。`
    : allCombinationsLoadingFull
      ? `正在载入全部 ${matchingCombinationCount} 组候选，首屏先展示 ${matchingCombinationsLoadedCount} 组预览。`
    : `共 ${matchingCombinationCount} 组，按当前约束条件过滤后展示；每页 ${ALL_COMBINATIONS_PAGE_SIZE} 条，可点击表头切换排序。`;
  const sortedAllMatchingCombinationCandidates = useMemo(
    () =>
      sortOptimizationCandidatesForModal(
        allMatchingCombinationCandidates,
        optimizationSearchSpace,
        allCombinationsSortKey,
        allCombinationsSortDirection,
      ),
    [
      allCombinationsSortDirection,
      allCombinationsSortKey,
      allMatchingCombinationCandidates,
      optimizationSearchSpace,
    ],
  );
  const totalAllCombinationsPages = Math.max(
    1,
    Math.ceil(
      sortedAllMatchingCombinationCandidates.length / ALL_COMBINATIONS_PAGE_SIZE,
    ),
  );
  const currentAllCombinationsPage = Math.min(
    allCombinationsPage,
    totalAllCombinationsPages,
  );
  const pagedAllMatchingCombinationCandidates = useMemo(() => {
    const start = (currentAllCombinationsPage - 1) * ALL_COMBINATIONS_PAGE_SIZE;
    return sortedAllMatchingCombinationCandidates.slice(
      start,
      start + ALL_COMBINATIONS_PAGE_SIZE,
    );
  }, [
    currentAllCombinationsPage,
    sortedAllMatchingCombinationCandidates,
  ]);
  const selectedCandidateParameters = useMemo(
    () =>
      buildCandidateParameterEntries(
        selectedCandidate?.parameter_snapshot,
        optimizationSearchSpace,
      ),
    [optimizationSearchSpace, selectedCandidate],
  );
  const promotionParameterDeltas = useMemo(
    () =>
      buildPromotionParameterDeltaEntries(
        selectedCandidate,
        optimizationSearchSpace,
        baselineCandidate?.parameter_snapshot ??
          baselineRun?.parameter_snapshot ??
          strategy?.parameters,
      ),
    [
      baselineCandidate?.parameter_snapshot,
      baselineRun?.parameter_snapshot,
      optimizationSearchSpace,
      selectedCandidate,
      strategy?.parameters,
    ],
  );
  const promotionAlternativeCandidates = useMemo(
    () =>
      displayedMatchingCandidates
        .filter(
          (candidate) =>
            candidate.id !== selectedCandidate?.id &&
            candidate.display_kind !== "baseline",
        )
        .slice(0, 3),
    [displayedMatchingCandidates, selectedCandidate?.id],
  );
  const promotionBaseParameterVersionId =
    (typeof strategy?.current_parameter_version_id === "string" &&
    strategy.current_parameter_version_id.trim()
      ? strategy.current_parameter_version_id.trim()
      : null) ??
    (typeof job?.base_parameter_version_id === "string" &&
    job.base_parameter_version_id.trim()
      ? job.base_parameter_version_id.trim()
      : null) ??
    (typeof job?.request.base_parameter_version_id === "string" &&
    job.request.base_parameter_version_id.trim()
      ? job.request.base_parameter_version_id.trim()
      : null);
  const promotionDecisionNoteReady = promotionDecisionNote.trim().length > 0;
  const noCandidateConstraintMatch = Boolean(
    !optimizationProgressState &&
      totalCandidateCount > 0 &&
      displayedMatchingCandidates.length === 0,
  );
  const noConstraintMatch = Boolean(
    noCandidateConstraintMatch && !baselineMatchesConstraints,
  );
  const suggestedResultConstraintCandidate = useMemo(
    () => (noCandidateConstraintMatch ? (job?.candidates[0] ?? null) : null),
    [job?.candidates, noCandidateConstraintMatch],
  );
  const suggestedResultConstraints = useMemo(
    () =>
      buildSuggestedOptimizationConstraints(
        suggestedResultConstraintCandidate,
        quickFilterConstraints,
      ),
    [quickFilterConstraints, suggestedResultConstraintCandidate],
  );
  const canRerunOptimization = Boolean(job && !optimizationRunning);
  const progressSummary = (job?.summary ?? {}) as Record<string, unknown>;
  const progressResult = (job?.result ?? {}) as Record<string, unknown>;
  const progressPct = readProgressNumber(
    progressSummary,
    "progress_pct",
    optimizationProgressState ? 0 : 100,
  );
  const completedCombinations = readProgressNumber(
    progressSummary,
    "completed_combinations",
    0,
  );
  const budgetCombinations = readProgressNumber(
    progressSummary,
    "budget_combinations",
    0,
  );
  const optimizationCombinationCount =
    budgetCombinations || completedCombinations || undefined;
  const resumeReady = readProgressBoolean(
    progressSummary,
    "resume_ready",
    true,
  );
  const persistedTrialCount = readProgressNumber(
    progressSummary,
    "persisted_trial_count",
    completedCombinations,
  );
  const nextTrialIndex = readProgressNumber(
    progressSummary,
    "next_trial_index",
    completedCombinations + 1,
  );
  const estimatedRemainingMinutes =
    typeof job?.summary.estimated_remaining_minutes === "number"
      ? job.summary.estimated_remaining_minutes
      : undefined;
  const estimatedCompletedAt =
    typeof job?.summary.estimated_completed_at === "string"
      ? job.summary.estimated_completed_at
      : undefined;
  const interruptedReason =
    formatInterruptedReason(
      readProgressText(progressSummary, "interrupted_reason"),
    ) ?? (optimizationInterrupted ? "优化任务已中断，当前进度已保存。" : null);
  const bestMetricsSummary = formatBestMetricsSummary(
    job?.summary.best_metrics_summary,
  );
  const currentStage =
    translateOptimizationText(
      readProgressText(progressSummary, "current_stage"),
    ) ??
    translateOptimizationText(
      readProgressText(progressResult, "current_stage"),
    ) ??
    (optimizationInterrupted
      ? "已中断"
      : optimizationRunning
        ? "等待执行"
        : "结果就绪");
  const latestUpdate =
    translateOptimizationText(
      readProgressText(progressSummary, "latest_update"),
    ) ??
    translateOptimizationText(
      readProgressText(progressResult, "latest_update"),
    ) ??
    (optimizationInterrupted
      ? `已保存 ${persistedTrialCount} 组结果，点击继续优化可从第 ${nextTrialIndex} 组恢复。`
      : optimizationRunning
        ? "正在生成首轮候选。"
        : (translateOptimizationText(job?.result.summary) ?? TEXT.resultsCopy));
  const latestCandidateLabel =
    translateOptimizationText(
      readProgressText(progressSummary, "latest_candidate_label"),
    ) ??
    translateOptimizationText(job?.result.best_candidate_label) ??
    translateOptimizationText(selectedCandidate?.label) ??
    null;
  const hasCandidatePanel =
    !optimizationProgressState && candidateRows.length > 0;
  const hasStabilityCenter = Boolean(
    !optimizationProgressState &&
    selectedCandidate &&
    (Object.keys(selectedCandidate.metrics ?? {}).length > 0 ||
      (selectedCandidate.analysis?.stability_checks?.length ?? 0) > 0),
  );
  const selectedHeatmap = useMemo(
    () =>
      selectedCandidate
        ? decorateHeatmapWithMetrics(
            selectedCandidate.analysis?.heatmap,
            selectedCandidate.metrics ?? {},
          )
        : null,
    [selectedCandidate],
  );
  const hasHeatmap = Boolean(
    !optimizationProgressState && (selectedHeatmap?.cells?.length ?? 0) > 0,
  );
  const hasValidation = Boolean(
    !optimizationProgressState &&
    (selectedCandidate?.analysis?.validation_windows?.length ?? 0) > 0,
  );
  const hasCandidateShelf = Boolean(
    !optimizationProgressState && candidateRows.length > 0,
  );
  const canPromoteSelectedCandidate = Boolean(
    selectedCandidate && selectedCandidate.display_kind !== "baseline",
  );
  const promoteButtonLabel = !selectedCandidate
    ? "暂无可晋升候选"
    : selectedCandidate.display_kind === "baseline"
      ? "当前基准不可晋升"
      : TEXT.promoteVersion;
  const strategyDisplayName = getStrategyDisplayName(
    translateOptimizationText(strategy?.name) ??
      job?.strategy_name ??
      job?.strategy_id ??
      TEXT.resultsTitle,
    TEXT.resultsTitle,
  );
  const strategyVersionTag = formatStrategyVersionTag(
    job?.base_parameter_version_id ??
      (job?.request.base_parameter_version_id as string | null | undefined) ??
      null,
  );
  const heroElapsedSeconds = calculateElapsedSeconds(
    job?.created_at,
    job?.completed_at ?? job?.updated_at,
  );
  const heroSummary = formatOptimizationHeroSummary(
    optimizationCombinationCount,
    heroElapsedSeconds,
  );
  const heroCopy = optimizationProgressState
    ? latestUpdate
    : (heroSummary ??
      (noConstraintMatch
        ? `当前约束下暂无候选版本通过过滤，已过滤 ${filteredOutCandidateCount} 个候选版本。建议继续调参、放宽阈值，或重新生成任务。`
        : (optimizationRunning
          ? latestUpdate
          : (translateOptimizationText(selectedCandidate?.analysis?.thesis) ??
            translateOptimizationText(job?.result.summary) ??
            TEXT.resultsCopy))));
  const nextActionLabel = optimizationInterrupted
    ? `第 ${nextTrialIndex} 组（已保留 ${persistedTrialCount} 组）`
    : `第 ${nextTrialIndex} 组`;

  useEffect(() => {
    if (allCombinationsPage > totalAllCombinationsPages) {
      setAllCombinationsPage(totalAllCombinationsPages);
    }
  }, [allCombinationsPage, totalAllCombinationsPages]);

  useEffect(() => {
    if (
      allCombinationsOpen &&
      !sortedAllMatchingCombinationCandidates.length
    ) {
      setAllCombinationsOpen(false);
    }
  }, [allCombinationsOpen, sortedAllMatchingCombinationCandidates.length]);

  const selectHref = buildOptimizationSelectPath({
    strategyId: job?.strategy_id,
    sourceRunId:
      typeof job?.request.source_run_id === "string"
        ? job.request.source_run_id
        : undefined,
    entryPoint:
      typeof job?.request.entry_point === "string"
        ? job.request.entry_point
        : undefined,
  });
  const configHref = buildOptimizationConfigPath({
    strategyId: job?.strategy_id ?? "",
    sourceRunId:
      typeof job?.request.source_run_id === "string"
        ? job.request.source_run_id
        : undefined,
    entryPoint:
      typeof job?.request.entry_point === "string"
        ? job.request.entry_point
        : undefined,
  });

  function openAllCombinationsModal(): void {
    const defaultKey = getOptimizationAllCombinationsDefaultSortKey(
      optimizationObjective,
    );
    setAllCombinationsSortKey(defaultKey);
    setAllCombinationsSortDirection("desc");
    setAllCombinationsPage(1);
    setAllCombinationsOpen(true);
    if (
      job &&
      !matchingCombinationCountIsPartial &&
      matchingCombinationCount > matchingCombinationsLoadedCount
    ) {
      setAllCombinationsLoadingFull(true);
      void api
        .getOptimizationJobDetail(job.id)
        .then((payload) => {
          const fullPayload = ensureOptimizationJobHasMatchingCombinationCount(payload);
          const activeFilter = activeOptimizationFilterRef.current;
          setJob((currentJob) =>
            currentJob && currentJob.id === fullPayload.id
              ? mergeFullOptimizationMatchingCombinations(
                  currentJob,
                  fullPayload,
                  activeFilter.constraints,
                  activeFilter.objective,
                )
              : fullPayload,
          );
        })
        .catch((caught) => {
          setError((caught as Error).message);
        })
        .finally(() => {
          setAllCombinationsLoadingFull(false);
        });
    }
  }

  function closeAllCombinationsModal(): void {
    setAllCombinationsOpen(false);
  }

  function handleAllCombinationsDialogWheel(
    event: ReactWheelEvent<HTMLDivElement>,
  ): void {
    const tableShell = allCombinationsTableShellRef.current;
    if (!tableShell || tableShell.contains(event.target as Node)) {
      return;
    }

    const maxScrollTop = Math.max(
      0,
      tableShell.scrollHeight - tableShell.clientHeight,
    );
    const maxScrollLeft = Math.max(
      0,
      tableShell.scrollWidth - tableShell.clientWidth,
    );
    const nextScrollTop = Math.min(
      maxScrollTop,
      Math.max(0, tableShell.scrollTop + event.deltaY),
    );
    const nextScrollLeft = Math.min(
      maxScrollLeft,
      Math.max(0, tableShell.scrollLeft + event.deltaX),
    );

    if (
      nextScrollTop === tableShell.scrollTop &&
      nextScrollLeft === tableShell.scrollLeft
    ) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    tableShell.scrollTop = nextScrollTop;
    tableShell.scrollLeft = nextScrollLeft;
  }

  function toggleAllCombinationsSort(
    nextKey: OptimizationAllCombinationSortKey,
  ): void {
    setAllCombinationsSortKey((currentKey) => {
      if (currentKey === nextKey) {
        setAllCombinationsSortDirection((currentDirection) =>
          currentDirection === "desc" ? "asc" : "desc",
        );
        return currentKey;
      }
      setAllCombinationsSortDirection(
        getOptimizationAllCombinationsInitialDirection(nextKey),
      );
      return nextKey;
    });
    setAllCombinationsPage(1);
  }

  function syncResultConstraintDraft(
    nextConstraints: OptimizationConstraint[],
  ):
    | {
        constraintPresetKey: OptimizationConstraintPresetKey;
        constraintLabel: string;
        constraints: OptimizationConstraint[];
      }
    | null {
    if (!strategy) {
      return null;
    }
    const draft = buildOptimizationConstraintDraft(
      constraintPresetKey,
      {
        constraint_preset_key: constraintPresetKey,
        constraints: nextConstraints,
      },
      strategy,
      baselineRun,
    );
    setConstraintPresetKey(draft.constraintPresetKey);
    setConstraintDraftLabel(draft.constraintLabel);
    setConstraintDrafts(draft.constraints);
    return draft;
  }

  function applyResultConstraintState(
    nextObjective: OptimizationObjective,
    nextConstraints: OptimizationConstraint[],
  ): void {
    setAppliedObjective(nextObjective);
    setAppliedConstraints(nextConstraints);
  }

  function summarizeConstraintMatches(nextConstraints: OptimizationConstraint[]): {
    candidateCount: number;
    baselineMatches: boolean;
  } {
    const previewSource =
      !matchingCombinationCountIsPartial &&
      Array.isArray(job?.matching_combinations) &&
      job.matching_combinations.length
        ? job.matching_combinations
        : (job?.candidates ?? []);
    const candidateCount = previewSource.filter((candidate) =>
      candidatePassesOptimizationConstraints(candidate, nextConstraints),
    ).length;
    const baselineMatches = baselineCandidate
      ? candidatePassesOptimizationConstraints(
          baselineCandidate,
          nextConstraints,
        )
      : false;
    return { candidateCount, baselineMatches };
  }

  function updateResultConstraint(index: number, value: string): void {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) {
      return;
    }
    const nextConstraints = quickFilterConstraints.map(
      (constraint, constraintIndex) =>
        constraintIndex === index
          ? {
              ...constraint,
              value: nextValue,
              source: "manual" as const,
            }
          : constraint,
    );
    syncResultConstraintDraft(nextConstraints);
    setFilteredResultDraft(null);
    setConstraintToast(null);
    setConstraintLiveMessage("已修改约束条件，点击“重新过滤”后应用。");
  }

  async function applyConstraintFilterUpdate(
    nextObjective: OptimizationObjective,
    nextConstraints: OptimizationConstraint[],
    nextConstraintLabel: string,
    messages?: {
      success: string;
      localOnly: string;
    },
  ): Promise<void> {
    if (!job) {
      return;
    }
    const nextMatchSummary = summarizeConstraintMatches(nextConstraints);
    if (
      nextMatchSummary.candidateCount === 0 &&
      !nextMatchSummary.baselineMatches
    ) {
      setFilteredResultDraft(null);
      setConstraintToast("无符合条件的组合，请放宽约束条件再试。");
      return;
    }
    try {
      setSaving(true);
      setError(null);
      setNotice(null);
      setConstraintToast(null);
      const filteredPayload: ApiOptimizationFilteredResultCreatePayload = {
        objective: nextObjective,
        constraint_preset_key: constraintPresetKey,
        constraint_label: nextConstraintLabel,
        constraints: cloneOptimizationConstraints(
          nextConstraints,
          constraintPresetKey,
        ),
      };
      const updated = ensureOptimizationJobHasMatchingCombinationCount(
        await api.updateOptimizationJobConstraints(job.id, filteredPayload),
      );
      setJob(updated);
      setFilteredResultDraft(filteredPayload);
      applyResultConstraintState(nextObjective, nextConstraints);
      setConstraintLiveMessage(
        messages?.success ??
          "已按最新约束条件重新过滤并重排。原任务快照未改写，可保存为新结果。",
      );
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : String(caught ?? "未知错误");
      if (message === MISSING_MATCHING_COMBINATION_COUNT_ERROR) {
        setError(message);
        setNotice(null);
        setConstraintLiveMessage("");
        return;
      }
      setFilteredResultDraft(null);
      applyResultConstraintState(nextObjective, nextConstraints);
      setNotice(
        `已按当前页面约束条件重新过滤，后端未返回本次过滤快照：${message}`,
      );
      setConstraintLiveMessage(
        messages?.localOnly ??
          "已在当前页面应用最新约束条件与排序，但没有可保存的新结果。",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleApplyConstraintFilter(
    event?: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event?.preventDefault();
    await applyConstraintFilterUpdate(
      objectiveDraft,
      cloneOptimizationConstraints(quickFilterConstraints, constraintPresetKey),
      constraintDraftLabel,
    );
  }

  async function handleApplySuggestedConstraintFilter(): Promise<void> {
    if (!suggestedResultConstraints) {
      return;
    }
    const draft = syncResultConstraintDraft(suggestedResultConstraints);
    if (!draft) {
      return;
    }
    const candidateLabel = getCandidateDisplayText(
      suggestedResultConstraintCandidate?.title ??
        suggestedResultConstraintCandidate?.label,
      "当前候选",
    );
    await applyConstraintFilterUpdate(
      objectiveDraft,
      cloneOptimizationConstraints(draft.constraints, draft.constraintPresetKey),
      draft.constraintLabel,
      {
        success: `已按 ${candidateLabel} 回填建议约束并重新过滤。`,
        localOnly: `已按 ${candidateLabel} 回填建议约束并在当前页面重新过滤，但没有可保存的新结果。`,
      },
    );
  }

  async function handleSaveFilteredResult(): Promise<void> {
    if (!job || !filteredResultDraft) {
      return;
    }
    try {
      setSaving(true);
      setError(null);
      setNotice(null);
      setConstraintToast(null);
      const saved = await api.saveOptimizationFilteredResult(job.id, {
        ...filteredResultDraft,
        constraints: cloneOptimizationConstraints(
          filteredResultDraft.constraints ?? [],
          constraintPresetKey,
        ),
      });
      setFilteredResultDraft(null);
      navigateTo(`/optimization-jobs/${saved.id}`);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : String(caught ?? "未知错误");
      setConstraintToast(`保存新结果失败：${message}`);
    } finally {
      setSaving(false);
    }
  }

  function openPromotionConfirm(): void {
    if (!job || !selectedCandidate || selectedCandidate.display_kind === "baseline") {
      return;
    }
    setPromotionDecisionNote("");
    setPromotionConfirmOpen(true);
    setError(null);
  }

  function closePromotionConfirm(): void {
    if (saving) {
      return;
    }
    setPromotionConfirmOpen(false);
    setPromotionDecisionNote("");
  }

  async function handleConfirmPromote(): Promise<void> {
    if (!job || !selectedCandidate) {
      return;
    }
    const decisionNote = promotionDecisionNote.trim();
    if (!decisionNote) {
      setError("请先填写本次晋升的决策备注。");
      return;
    }
    try {
      setSaving(true);
      setError(null);
      setNotice(null);
      await api.promoteOptimizationCandidate(
        job.id,
        selectedCandidate.id,
        "set_current",
        `promote-${job.id}-${selectedCandidate.id}`,
        decisionNote,
        promotionBaseParameterVersionId,
      );
      const [refreshedStrategy, refreshedJob] = await Promise.all([
        api.getStrategyDetail(job.strategy_id),
        api
          .getOptimizationJobDetail(job.id, {
            matchingLimit: OPTIMIZATION_DETAIL_ROUTE_MATCHING_LIMIT,
          })
          .catch(() => job),
      ]);
      setStrategy(refreshedStrategy);
      setJob(refreshedJob);
      setSelectedCandidateId(
        refreshedJob.result.best_candidate_id ??
          refreshedJob.candidates[0]?.id ??
          selectedCandidate.id,
      );
      setNotice(
        `已完成版本晋升，${getStrategyDisplayName(refreshedStrategy.name, refreshedStrategy.id)} 当前版本已更新为 ${
          formatStrategyVersionTag(refreshedStrategy.current_parameter_version_id) ?? '最新版本'
        }。`,
      );
      setPromotionConfirmOpen(false);
      setPromotionDecisionNote("");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleResume(): Promise<void> {
    if (!job || !resumeReady) {
      return;
    }
    try {
      setSaving(true);
      setError(null);
      setNotice(null);
      const resumed = await api.resumeOptimizationJob(
        job.id,
        `resume-${job.id}-${nextTrialIndex}`,
      );
      if (String(resumed.status ?? "").toUpperCase() === "INTERRUPTED") {
        setJob(resumed);
        setError("继续优化未启动，任务仍处于暂停状态，请重试。");
        return;
      }
      setJob(resumed);
      setSelectedCandidateId(
        resumed.result.best_candidate_id ?? resumed.candidates[0]?.id ?? null,
      );
      setNotice("已继续优化，断点进度会自动刷新。");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function openRerunConfirm(): void {
    setRerunError(null);
    setRerunConfirmOpen(true);
  }

  function closeRerunConfirm(): void {
    if (saving) {
      return;
    }
    setRerunError(null);
    setRerunConfirmOpen(false);
  }

  async function handleRerunOptimization(): Promise<void> {
    if (!job?.strategy_id) {
      return;
    }
    try {
      setSaving(true);
      setError(null);
      setNotice(null);
      setRerunError(null);
      const created = await api.createOptimizationJob(
        job.strategy_id,
        buildOptimizationRerunPayload(job),
      );
      setRerunConfirmOpen(false);
      navigateTo(`/optimization-jobs/${created.id}`);
    } catch (caught) {
      setRerunError(`重新生成任务失败：${(caught as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="optimization-lab-page">
      {constraintToast ? (
        <div
          aria-live="polite"
          className="optimization-results-toast error-banner"
          role="status"
        >
          {constraintToast}
        </div>
      ) : null}
      <OptimizationStepBar
        current="results"
        selectHref={selectHref}
        configHref={job ? configHref : undefined}
      />

      <section
        className="optimization-lab-panel optimization-lab-panel--hero"
        style={HERO_PANEL_LAYOUT_STYLE}
      >
        <div>
          <p className="optimization-lab-eyebrow">任务结果中心</p>
          <h1 className="optimization-lab-panel__hero-title">
            <span>{`参数优化：${strategyDisplayName}`}</span>
            {strategyVersionTag ? (
              <span aria-hidden="true" className="status-chip status-chip--soft optimization-lab-panel__hero-version">
                {strategyVersionTag}
              </span>
            ) : null}
          </h1>
          <p>{heroCopy}</p>
          {job ? (
            <div className="optimization-meta-chips">
              <span className="status-chip status-chip--soft">
                任务编号：{job.id}
              </span>
              {optimizationRangeSummary ? (
                <span className="status-chip status-chip--soft optimization-range-chip">
                  参数组合：{optimizationRangeSummary}
                </span>
              ) : null}
            </div>
          ) : null}
          {notice ? (
            <p className="optimization-inline-notice">{notice}</p>
          ) : null}
        </div>
        <div
          className="optimization-hero-actions optimization-hero-actions--single-row"
          style={HERO_ACTIONS_LAYOUT_STYLE}
        >
          <button
            className="ghost-button"
            onClick={() => navigateTo(buildOptimizationJobsPath())}
            style={HERO_ACTION_BUTTON_STYLE}
            type="button"
          >
            {TEXT.backToJobs}
          </button>
          {canRerunOptimization ? (
            <button
              className="ghost-button optimization-results-rerun-action"
              disabled={saving}
              onClick={openRerunConfirm}
              style={HERO_ACTION_BUTTON_STYLE}
              type="button"
            >
              {RERUN_ACTION_LABEL}
            </button>
          ) : null}
          {optimizationInterrupted ? (
            <button
              className="primary-button"
              disabled={saving || !resumeReady}
              onClick={() => void handleResume()}
              style={HERO_ACTION_BUTTON_STYLE}
              type="button"
            >
              {TEXT.resumeOptimization}
            </button>
          ) : optimizationProgressState ? null : (
            <>
              <button
                className="ghost-button"
                disabled={!job}
                onClick={() => navigateTo(configHref)}
                style={HERO_ACTION_BUTTON_STYLE}
                type="button"
              >
                {TEXT.continueTune}
              </button>
              <button
                className="primary-button"
                disabled={saving || !canPromoteSelectedCandidate}
                onClick={openPromotionConfirm}
                style={HERO_ACTION_BUTTON_STYLE}
                type="button"
              >
                {promoteButtonLabel}
              </button>
            </>
          )}
        </div>
      </section>

      {rerunConfirmOpen ? (
        <div
          aria-label={RERUN_DIALOG_TITLE}
          aria-modal="true"
          className="modal-shell"
          onClick={closeRerunConfirm}
          role="dialog"
        >
          <div
            className="modal-card optimization-job-rerun-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-header">
              <div>
                <p className="eyebrow">{RERUN_ACTION_LABEL}</p>
                <h3>{RERUN_DIALOG_TITLE}</h3>
              </div>
            </div>
            <div className="optimization-job-rerun-dialog__copy">
              <p>{RERUN_DIALOG_COPY}</p>
              <p>新任务会保留当前任务的参数范围、约束条件和验证方式。</p>
            </div>
            {rerunError ? (
              <div className="error-banner">{rerunError}</div>
            ) : null}
            <div className="modal-card__footer">
              <button
                className="ghost-button"
                disabled={saving}
                onClick={closeRerunConfirm}
                type="button"
              >
                {TEXT.cancel}
              </button>
              <button
                className="primary-button optimization-job-rerun-dialog__confirm"
                disabled={saving}
                onClick={() => void handleRerunOptimization()}
                type="button"
              >
                {saving ? RERUN_DIALOG_SUBMITTING : RERUN_DIALOG_CONFIRM}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {promotionConfirmOpen && selectedCandidate ? (
        <div
          aria-label="确认晋升当前版本"
          aria-modal="true"
          className="modal-shell"
          onClick={closePromotionConfirm}
          role="dialog"
        >
          <div
            className="modal-card optimization-promotion-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-header">
              <div>
                <p className="eyebrow">版本晋升确认</p>
                <h3>确认晋升当前版本</h3>
                <p className="optimization-panel-subtitle">
                  候选摘要、参数差异、来源任务和备选候选均来自当前已加载结果。
                </p>
              </div>
            </div>

            <section className="optimization-evaluation-panel">
              <div className="optimization-parameter-panel__title">
                候选摘要
              </div>
              <div className="optimization-evaluation-panel__headline">
                <strong>
                  {getCandidateVersionDisplayText(selectedCandidate)}
                </strong>
                <span>{getCandidateStatusText(selectedCandidate)}</span>
              </div>
              <p>
                {translateOptimizationText(
                  selectedCandidate.analysis?.stability_summary,
                ) ??
                  translateOptimizationText(selectedCandidate.analysis?.thesis) ??
                  translateOptimizationText(selectedCandidate.summary) ??
                  describeCandidateEvaluation(selectedCandidate)}
              </p>
              <div className="optimization-metric-row">
                <article className="optimization-metric-tile">
                  <span>年化收益率</span>
                  <strong>
                    {formatReturnRate(
                      getCandidateMetric(selectedCandidate, "annualized_return") ??
                        getCandidateMetric(selectedCandidate, "cagr"),
                    )}
                  </strong>
                </article>
                <article className="optimization-metric-tile">
                  <span>收益夏普</span>
                  <strong>
                    {formatMetric(
                      getCandidateMetric(selectedCandidate, "return_sharpe") ??
                        getCandidateMetric(selectedCandidate, "sharpe"),
                    )}
                  </strong>
                </article>
                <article className="optimization-metric-tile">
                  <span>样本外夏普</span>
                  <strong>
                    {formatMetric(
                      getCandidateMetric(selectedCandidate, "out_of_sample_sharpe"),
                    )}
                  </strong>
                </article>
                <article className="optimization-metric-tile">
                  <span>综合得分</span>
                  <strong>{formatMetric(selectedCandidate.score, 3)}</strong>
                </article>
              </div>
              <p className="optimization-results-summary">
                参数摘要：
                {getCandidateSummaryText(selectedCandidate, optimizationSearchSpace)}
              </p>
            </section>

            <section className="optimization-parameter-panel">
              <div className="optimization-parameter-panel__title">
                参数差异
              </div>
              {promotionParameterDeltas.length ? (
                <div className="optimization-parameter-chip-list">
                  {promotionParameterDeltas.map((entry) => (
                    <article
                      className="optimization-parameter-chip"
                      key={`promotion-delta-${entry.key}`}
                    >
                      <span>{entry.label}</span>
                      <strong>
                        {entry.currentValue} → {entry.candidateValue}
                      </strong>
                      <small>
                        {entry.deltaValue
                          ? `差异 ${entry.deltaValue}`
                          : entry.changed
                            ? "已变化"
                            : "无变化"}
                      </small>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="optimization-panel-subtitle">
                  当前候选未提供可展示的参数差异。
                </p>
              )}
            </section>

            <section className="optimization-parameter-panel">
              <div className="optimization-parameter-panel__title">
                来源任务与回测
              </div>
              <div className="optimization-parameter-chip-list">
                <article className="optimization-parameter-chip">
                  <span>优化任务</span>
                  <strong>{job?.id ?? "-"}</strong>
                </article>
                <article className="optimization-parameter-chip">
                  <span>来源回测</span>
                  <strong>
                    {job?.request.source_run_id ??
                      job?.summary.source_run_id ??
                      baselineRun?.id ??
                      "-"}
                  </strong>
                </article>
                <article className="optimization-parameter-chip">
                  <span>任务基线</span>
                  <strong>
                    {formatStrategyVersionTag(
                      job?.base_parameter_version_id ??
                        job?.request.base_parameter_version_id ??
                        null,
                    ) ?? "-"}
                  </strong>
                </article>
                <article className="optimization-parameter-chip">
                  <span>提交基线</span>
                  <strong>
                    {formatStrategyVersionTag(promotionBaseParameterVersionId) ??
                      "-"}
                  </strong>
                </article>
                <article className="optimization-parameter-chip">
                  <span>入口</span>
                  <strong>{formatEntryPoint(job?.request.entry_point)}</strong>
                </article>
                <article className="optimization-parameter-chip">
                  <span>验证方式</span>
                  <strong>{formatValidationMode(job?.request.validation_mode)}</strong>
                </article>
                <article className="optimization-parameter-chip">
                  <span>完成时间</span>
                  <strong>{formatUpdatedAt(job?.completed_at ?? job?.updated_at)}</strong>
                </article>
              </div>
            </section>

            <section className="optimization-parameter-panel">
              <div className="optimization-parameter-panel__title">
                备选候选
              </div>
              {promotionAlternativeCandidates.length ? (
                <div className="optimization-parameter-chip-list">
                  {promotionAlternativeCandidates.map((candidate) => (
                    <article
                      className="optimization-parameter-chip"
                      key={`promotion-alternative-${candidate.id}`}
                    >
                      <span>{getCandidateVersionDisplayText(candidate)}</span>
                      <strong>
                        夏普{" "}
                        {formatMetric(
                          getCandidateMetric(candidate, "return_sharpe") ??
                            getCandidateMetric(candidate, "sharpe"),
                        )}
                      </strong>
                      <small>
                        年化{" "}
                        {formatReturnRate(
                          getCandidateMetric(candidate, "annualized_return") ??
                            getCandidateMetric(candidate, "cagr"),
                        )}
                      </small>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="optimization-panel-subtitle">
                  当前过滤结果中没有其它可对照候选。
                </p>
              )}
            </section>

            <label
              className="optimization-parameter-panel"
              htmlFor="promotion-decision-note"
            >
              <span className="optimization-parameter-panel__title">
                决策备注
              </span>
              <textarea
                id="promotion-decision-note"
                onChange={(event) =>
                  setPromotionDecisionNote(event.currentTarget.value)
                }
                placeholder="记录本次晋升的判断依据，例如样本外表现、回撤约束或人工复核结论。"
                rows={4}
                style={{
                  border: "1px solid var(--gsl-color-border)",
                  borderRadius: "8px",
                  boxSizing: "border-box",
                  font: "inherit",
                  lineHeight: 1.6,
                  minHeight: "112px",
                  padding: "12px 14px",
                  resize: "vertical",
                  width: "100%",
                }}
                value={promotionDecisionNote}
              />
            </label>

            {error ? <div className="error-banner">{error}</div> : null}

            <div className="modal-card__footer">
              <button
                className="ghost-button"
                disabled={saving}
                onClick={closePromotionConfirm}
                type="button"
              >
                {TEXT.cancel}
              </button>
              <button
                className="primary-button optimization-promotion-dialog__confirm"
                disabled={saving || !promotionDecisionNoteReady}
                onClick={() => void handleConfirmPromote()}
                type="button"
              >
                {saving ? "晋升中..." : "确认晋升"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {allCombinationsOpen ? (
        <div
          aria-label={allCombinationsDialogTitle}
          aria-modal="true"
          className="modal-shell"
          onClick={closeAllCombinationsModal}
          role="dialog"
        >
          <div
            className="modal-card optimization-all-combinations-dialog"
            onClick={(event) => event.stopPropagation()}
            onWheel={handleAllCombinationsDialogWheel}
          >
            <div className="panel-header">
              <div>
                <p className="eyebrow">参数候选盘</p>
                <h3>{allCombinationsDialogTitle}</h3>
                <p className="optimization-all-combinations-dialog__copy">
                  {allCombinationsDialogCopy}
                </p>
              </div>
            </div>

            <div
              className="optimization-lab-table-shell optimization-all-combinations-dialog__table-shell"
              ref={allCombinationsTableShellRef}
            >
              <table className="optimization-lab-table optimization-all-combinations-dialog__table">
                <thead>
                  <tr>
                    <th
                      aria-sort={
                        allCombinationsSortKey === "parameter_summary"
                          ? allCombinationsSortDirection === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <button
                        className="optimization-table-sort-button"
                        onClick={() =>
                          toggleAllCombinationsSort("parameter_summary")
                        }
                        type="button"
                      >
                        <span>参数摘要</span>
                        <span aria-hidden="true">
                          {allCombinationsSortKey === "parameter_summary"
                            ? allCombinationsSortDirection === "asc"
                              ? "↑"
                              : "↓"
                            : "↕"}
                        </span>
                      </button>
                    </th>
                    <th
                      aria-sort={
                        allCombinationsSortKey === "annualized_return"
                          ? allCombinationsSortDirection === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <button
                        className="optimization-table-sort-button"
                        onClick={() =>
                          toggleAllCombinationsSort("annualized_return")
                        }
                        type="button"
                      >
                        <span>年化收益率</span>
                        <span aria-hidden="true">
                          {allCombinationsSortKey === "annualized_return"
                            ? allCombinationsSortDirection === "asc"
                              ? "↑"
                              : "↓"
                            : "↕"}
                        </span>
                      </button>
                    </th>
                    <th
                      aria-sort={
                        allCombinationsSortKey === "return_sharpe"
                          ? allCombinationsSortDirection === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <button
                        className="optimization-table-sort-button"
                        onClick={() =>
                          toggleAllCombinationsSort("return_sharpe")
                        }
                        type="button"
                      >
                        <span>收益夏普</span>
                        <span aria-hidden="true">
                          {allCombinationsSortKey === "return_sharpe"
                            ? allCombinationsSortDirection === "asc"
                              ? "↑"
                              : "↓"
                            : "↕"}
                        </span>
                      </button>
                    </th>
                    <th
                      aria-sort={
                        allCombinationsSortKey === "out_of_sample_sharpe"
                          ? allCombinationsSortDirection === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <button
                        className="optimization-table-sort-button"
                        onClick={() =>
                          toggleAllCombinationsSort("out_of_sample_sharpe")
                        }
                        type="button"
                      >
                        <span>样本外夏普</span>
                        <span aria-hidden="true">
                          {allCombinationsSortKey === "out_of_sample_sharpe"
                            ? allCombinationsSortDirection === "asc"
                              ? "↑"
                              : "↓"
                            : "↕"}
                        </span>
                      </button>
                    </th>
                    <th
                      aria-sort={
                        allCombinationsSortKey === "max_drawdown_pct"
                          ? allCombinationsSortDirection === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <button
                        className="optimization-table-sort-button"
                        onClick={() =>
                          toggleAllCombinationsSort("max_drawdown_pct")
                        }
                        type="button"
                      >
                        <span>最大回撤</span>
                        <span aria-hidden="true">
                          {allCombinationsSortKey === "max_drawdown_pct"
                            ? allCombinationsSortDirection === "asc"
                              ? "↑"
                              : "↓"
                            : "↕"}
                        </span>
                      </button>
                    </th>
                    <th
                      aria-sort={
                        allCombinationsSortKey === "stability"
                          ? allCombinationsSortDirection === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <button
                        className="optimization-table-sort-button"
                        onClick={() => toggleAllCombinationsSort("stability")}
                        type="button"
                      >
                        <span>稳定度</span>
                        <span aria-hidden="true">
                          {allCombinationsSortKey === "stability"
                            ? allCombinationsSortDirection === "asc"
                              ? "↑"
                              : "↓"
                            : "↕"}
                        </span>
                      </button>
                    </th>
                    <th
                      aria-sort={
                        allCombinationsSortKey === "composite_score"
                          ? allCombinationsSortDirection === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <button
                        className="optimization-table-sort-button"
                        onClick={() =>
                          toggleAllCombinationsSort("composite_score")
                        }
                        type="button"
                      >
                        <span>综合得分</span>
                        <span aria-hidden="true">
                          {allCombinationsSortKey === "composite_score"
                            ? allCombinationsSortDirection === "asc"
                              ? "↑"
                              : "↓"
                            : "↕"}
                        </span>
                      </button>
                    </th>
                    <th
                      aria-sort={
                        allCombinationsSortKey === "status"
                          ? allCombinationsSortDirection === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <button
                        className="optimization-table-sort-button"
                        onClick={() => toggleAllCombinationsSort("status")}
                        type="button"
                      >
                        <span>状态</span>
                        <span aria-hidden="true">
                          {allCombinationsSortKey === "status"
                            ? allCombinationsSortDirection === "asc"
                              ? "↑"
                              : "↓"
                            : "↕"}
                        </span>
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagedAllMatchingCombinationCandidates.map((candidate) => (
                    <tr
                      className={
                        candidate.id === selectedCandidate?.id
                          ? "optimization-lab-table__row--selected"
                          : ""
                      }
                      key={`all-combo-${candidate.id}`}
                    >
                      <td className="optimization-lab-table__cell--wrap">
                        <div className="optimization-parameter-summary">
                          <strong className="optimization-all-combinations-dialog__candidate-label">
                            {getCandidateDisplayText(
                              candidate.title ?? candidate.label,
                            )}
                          </strong>
                          <span className="optimization-all-combinations-dialog__candidate-summary">
                            {getCandidateSummaryText(
                              candidate,
                              optimizationSearchSpace,
                            )}
                          </span>
                        </div>
                      </td>
                      <td>
                        {formatReturnRate(
                          getCandidateMetric(candidate, "annualized_return") ??
                            getCandidateMetric(candidate, "cagr"),
                        )}
                      </td>
                      <td>
                        {formatMetric(
                          getCandidateMetric(candidate, "return_sharpe") ??
                            getCandidateMetric(candidate, "sharpe"),
                        )}
                      </td>
                      <td>
                        {formatMetric(
                          getCandidateMetric(candidate, "out_of_sample_sharpe"),
                        )}
                      </td>
                      <td>
                        {formatPercentMetric(
                          getCandidateMetric(candidate, "max_drawdown_pct"),
                        )}
                      </td>
                      <td>
                        {formatMetric(
                          getCandidateMetric(candidate, "stability"),
                          0,
                        )}
                      </td>
                      <td>{formatMetric(candidate.score, 3)}</td>
                      <td>{getCandidateStatusText(candidate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="modal-card__footer optimization-all-combinations-dialog__footer">
              <div className="optimization-all-combinations-dialog__footer-meta">
                {sortedAllMatchingCombinationCandidates.length
                  ? `第 ${currentAllCombinationsPage} / ${totalAllCombinationsPages} 页 · ${(
                      (currentAllCombinationsPage - 1) *
                        ALL_COMBINATIONS_PAGE_SIZE +
                      1
                    ).toString()}-${Math.min(
                      currentAllCombinationsPage *
                        ALL_COMBINATIONS_PAGE_SIZE,
                      sortedAllMatchingCombinationCandidates.length,
                    ).toString()} / ${sortedAllMatchingCombinationCandidates.length}`
                  : "暂无符合条件的组合"}
              </div>
              <div className="optimization-all-combinations-dialog__footer-actions">
                <button
                  className="ghost-button"
                  disabled={currentAllCombinationsPage <= 1}
                  onClick={() =>
                    setAllCombinationsPage((current) =>
                      Math.max(1, current - 1),
                    )
                  }
                  type="button"
                >
                  上一页
                </button>
                <button
                  className="ghost-button"
                  disabled={
                    currentAllCombinationsPage >= totalAllCombinationsPages
                  }
                  onClick={() =>
                    setAllCombinationsPage((current) =>
                      Math.min(totalAllCombinationsPages, current + 1),
                    )
                  }
                  type="button"
                >
                  下一页
                </button>
                <button
                  className="primary-button"
                  onClick={closeAllCombinationsModal}
                  type="button"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {loading ? <p className="empty-state">正在加载结果中心...</p> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      {!loading && !error && job ? (
        <>
          {!optimizationProgressState ? (
            <section
              aria-labelledby="optimization-results-constraint-title"
              className="optimization-lab-panel optimization-results-constraint-bar"
            >
              <div className="optimization-lab-panel__heading optimization-results-constraint-bar__heading">
                <div>
                  <h2 id="optimization-results-constraint-title">约束条件</h2>
                </div>
                <div className="optimization-results-constraint-bar__actions">
                  {suggestedResultConstraints ? (
                    <button
                      className="ghost-button optimization-results-constraint-bar__action"
                      disabled={saving}
                      onClick={() => void handleApplySuggestedConstraintFilter()}
                      type="button"
                    >
                      {saving ? "重新过滤中..." : "一键放宽到有结果"}
                    </button>
                  ) : null}
                  <button
                    className="ghost-button optimization-results-constraint-bar__action"
                    disabled={saving}
                    form="optimization-results-constraint-form"
                    type="submit"
                  >
                    {saving ? "重新过滤中..." : "重新过滤"}
                  </button>
                  {filteredResultDraft ? (
                    <button
                      className="primary-button optimization-results-constraint-bar__action"
                      disabled={saving}
                      onClick={() => void handleSaveFilteredResult()}
                      type="button"
                    >
                      {saving ? "保存中..." : "保存新结果"}
                    </button>
                  ) : null}
                </div>
              </div>
              <form
                aria-label="约束条件一行编辑条"
                className="optimization-results-constraint-bar__grid"
                id="optimization-results-constraint-form"
                onSubmit={(event) => void handleApplyConstraintFilter(event)}
              >
                <label
                  className="optimization-results-constraint-pill optimization-results-constraint-pill--objective"
                  htmlFor="optimization-results-objective"
                >
                  <span className="optimization-results-constraint-pill__label">
                    目标排序
                  </span>
                  <select
                    aria-label="目标排序"
                    className="optimization-results-constraint-pill__select"
                    id="optimization-results-objective"
                    onChange={(event) => {
                      setFilteredResultDraft(null);
                      setObjectiveDraft(
                        normalizeOptimizationObjective(event.target.value),
                      );
                    }}
                    value={objectiveDraft}
                  >
                    {OPTIMIZATION_OBJECTIVE_OPTIONS.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {quickFilterConstraints.map((constraint, index) => {
                  const unitLabel = getOptimizationConstraintUnitLabel(
                    constraint,
                  );
                  return (
                    <label
                      className={`optimization-results-constraint-pill optimization-results-constraint-pill--${constraint.category}`}
                      htmlFor={`optimization-results-constraint-${constraint.key}`}
                      key={constraint.key}
                    >
                      <span className="optimization-results-constraint-pill__label">
                        {constraint.label}
                      </span>
                      <span className="optimization-results-constraint-pill__op">
                        {formatOptimizationConstraintOperator(
                          constraint.operator,
                        )}
                      </span>
                      <OptimizationConstraintThresholdInput
                        ariaLabel={`${constraint.label} 阈值`}
                        id={`optimization-results-constraint-${constraint.key}`}
                        onCommitValue={(nextValue) =>
                          updateResultConstraint(index, String(nextValue))
                        }
                        step={getOptimizationConstraintInputStep(
                          constraint.key,
                        )}
                        value={constraint.value}
                      />
                      {unitLabel ? (
                        <span className="optimization-results-constraint-pill__unit">
                          {unitLabel}
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </form>
              <p aria-live="polite" className="sr-only">
                {constraintLiveMessage}
              </p>
            </section>
          ) : null}

          {optimizationProgressState ? (
            <section
              className="optimization-lab-panel optimization-progress-panel"
              style={{ display: "grid", gap: "22px" }}
            >
              <div className="optimization-lab-panel__heading">
                <div>
                  <p className="optimization-lab-eyebrow">实时进度</p>
                  <h2>
                    {optimizationInterrupted ? "优化已中断" : "优化进行中"}
                  </h2>
                </div>
                <span className="status-chip status-chip--soft">
                  {formatOptimizationStatus(job.status)}
                </span>
              </div>
              <div className="optimization-metric-row">
                <article
                  className="optimization-metric-tile"
                  style={{ display: "grid", gap: "10px", padding: "16px 18px" }}
                >
                  <span>已完成组合</span>
                  <strong>
                    {budgetCombinations
                      ? `${completedCombinations} / ${budgetCombinations}`
                      : `${completedCombinations}`}
                  </strong>
                </article>
                <article
                  className="optimization-metric-tile"
                  style={{ display: "grid", gap: "10px", padding: "16px 18px" }}
                >
                  <span>当前阶段</span>
                  <strong>{currentStage}</strong>
                </article>
                <article
                  className="optimization-metric-tile"
                  style={{ display: "grid", gap: "10px", padding: "16px 18px" }}
                >
                  <span>预计剩余</span>
                  <strong>{formatEtaMinutes(estimatedRemainingMinutes)}</strong>
                </article>
                <article
                  className="optimization-metric-tile"
                  style={{ display: "grid", gap: "10px", padding: "16px 18px" }}
                >
                  <span>预计完成</span>
                  <strong>
                    {formatExpectedCompletion(estimatedCompletedAt)}
                  </strong>
                </article>
              </div>
              <div className="optimization-summary-list">
                <div
                  className="optimization-summary-row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(108px, 136px) minmax(0, 1fr)",
                    alignItems: "start",
                    gap: "18px",
                    padding: "0 0 14px",
                  }}
                >
                  <span>最新更新</span>
                  <strong style={{ textAlign: "left", lineHeight: "1.72" }}>
                    {latestUpdate}
                  </strong>
                </div>
                <div
                  className="optimization-summary-row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(108px, 136px) minmax(0, 1fr)",
                    alignItems: "start",
                    gap: "18px",
                    padding: "14px 0",
                  }}
                >
                  <span>最佳候选</span>
                  <strong style={{ textAlign: "left", lineHeight: "1.72" }}>
                    {bestMetricsSummary ??
                      latestCandidateLabel ??
                      "等待首批样本"}
                  </strong>
                </div>
                <div
                  className="optimization-summary-row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(108px, 136px) minmax(0, 1fr)",
                    alignItems: "start",
                    gap: "18px",
                    padding: "14px 0 0",
                  }}
                >
                  <span>
                    {optimizationInterrupted ? "恢复起点" : "下一试验"}
                  </span>
                  <strong style={{ textAlign: "left", lineHeight: "1.72" }}>
                    {optimizationInterrupted && interruptedReason
                      ? `${nextActionLabel} · ${interruptedReason}`
                      : nextActionLabel}
                  </strong>
                </div>
              </div>
            </section>
          ) : null}

          {noConstraintMatch ? (
            <section className="optimization-lab-panel optimization-results-empty">
              <div className="optimization-lab-panel__heading">
                <div>
                  <p className="optimization-lab-eyebrow">结果过滤</p>
                  <h2>当前约束下暂无候选版本通过过滤</h2>
                  <p className="optimization-panel-subtitle">
                    已过滤 {filteredOutCandidateCount} 个候选版本。可以继续调参、
                    放宽阈值，或基于当前配置重新生成任务。
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          {!optimizationProgressState ? (
            <>
              {hasCandidatePanel || hasStabilityCenter ? (
                <div className="optimization-results-grid">
                  {hasCandidatePanel ? (
                    <section className="optimization-lab-panel optimization-results-card">
                      <div className="optimization-lab-panel__heading">
                        <div>
                          <p className="optimization-lab-eyebrow">
                            {TEXT.candidatePanel}
                          </p>
                          <h2>{TEXT.candidatePanel}</h2>
                          <p className="optimization-panel-subtitle">
                            {candidatePanelSubtitle}
                          </p>
                        </div>
                        {allMatchingCombinationCandidates.length ? (
                          <button
                            className="text-button optimization-results-card__view-all"
                            onClick={openAllCombinationsModal}
                            type="button"
                          >
                            {allCombinationsButtonLabel}
                          </button>
                        ) : null}
                      </div>
                      <div className="optimization-lab-table-shell">
                        <table className="optimization-lab-table">
                          <thead>
                            <tr>
                              <th>排名</th>
                              <th>候选版本</th>
                              <th>参数摘要</th>
                              <th>年化收益率</th>
                              <th>收益夏普</th>
                              <th>样本外夏普</th>
                              <th>最大回撤</th>
                              <th>稳定度</th>
                              <th>状态</th>
                            </tr>
                          </thead>
                          <tbody>
                            {candidateRows.map((candidate) => {
                              const active =
                                candidate.id === selectedCandidate?.id;
                              return (
                                <tr
                                  className={
                                    active
                                      ? "optimization-lab-table__row--selected"
                                      : ""
                                  }
                                  key={candidate.id}
                                  onClick={() =>
                                    setSelectedCandidateId(candidate.id)
                                  }
                                >
                                  <td>{candidate.rank}</td>
                                  <td>
                                    <div className="optimization-lab-table__stack">
                                      <strong>
                                        {getCandidateVersionDisplayText(
                                          candidate,
                                        )}
                                      </strong>
                                    </div>
                                  </td>
                                  <td className="optimization-lab-table__cell--wrap">
                                    <div className="optimization-parameter-summary">
                                      {buildRangeParameterEntries(
                                        candidate.parameter_snapshot,
                                        optimizationSearchSpace,
                                      ).length ? (
                                        buildRangeParameterEntries(
                                          candidate.parameter_snapshot,
                                          optimizationSearchSpace,
                                        ).map((entry) => (
                                          <div
                                            className="optimization-parameter-summary__line"
                                            key={`${candidate.id}-${entry.key}`}
                                          >
                                            <span>
                                              {entry.label}：
                                              <strong>{entry.value}</strong>
                                            </span>
                                          </div>
                                        ))
                                      ) : (
                                        <span>
                                          {buildCandidateParameterSummary(
                                            candidate.parameter_snapshot,
                                            optimizationSearchSpace,
                                          ) || "-"}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td>
                                    {formatReturnRate(
                                      getCandidateMetric(
                                        candidate,
                                        "annualized_return",
                                      ) ??
                                        getCandidateMetric(candidate, "cagr"),
                                    )}
                                  </td>
                                  <td>
                                    {formatMetric(
                                      getCandidateMetric(
                                        candidate,
                                        "return_sharpe",
                                      ) ??
                                        getCandidateMetric(candidate, "sharpe"),
                                    )}
                                  </td>
                                  <td>
                                    {formatMetric(
                                      getCandidateMetric(
                                        candidate,
                                        "out_of_sample_sharpe",
                                      ),
                                    )}
                                  </td>
                                  <td>
                                    {formatPercentMetric(
                                      getCandidateMetric(
                                        candidate,
                                        "max_drawdown_pct",
                                      ),
                                    )}
                                  </td>
                                  <td>
                                    {formatMetric(
                                      getCandidateMetric(
                                        candidate,
                                        "stability",
                                      ),
                                      0,
                                    )}
                                  </td>
                                  <td>
                                    {translateOptimizationText(
                                      candidate.status_label,
                                    ) ??
                                      formatOptimizationStatus(
                                        candidate.status,
                                      )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  ) : null}

                  {hasStabilityCenter && selectedCandidate ? (
                    <section className="optimization-lab-panel optimization-results-card optimization-results-card--rail">
                      <div className="optimization-lab-panel__heading">
                        <div>
                          <p className="optimization-lab-eyebrow">
                            {TEXT.stabilityCenter}
                          </p>
                          <h2>{TEXT.stabilityCenter}</h2>
                          <p className="optimization-panel-subtitle">
                            {PANEL_SUBTITLES.stabilityCenter}
                          </p>
                        </div>
                      </div>

                      <div className="optimization-metric-row">
                        <article className="optimization-metric-tile">
                          <span>年化收益率</span>
                          <strong>
                            {formatReturnRate(
                              getCandidateMetric(
                                selectedCandidate,
                                "annualized_return",
                              ) ??
                                getCandidateMetric(selectedCandidate, "cagr"),
                            )}
                          </strong>
                        </article>
                        <article className="optimization-metric-tile">
                          <span>收益夏普</span>
                          <strong>
                            {formatMetric(
                              getCandidateMetric(
                                selectedCandidate,
                                "return_sharpe",
                              ) ??
                                getCandidateMetric(selectedCandidate, "sharpe"),
                            )}
                          </strong>
                        </article>
                        <article className="optimization-metric-tile">
                          <span>样本外夏普</span>
                          <strong>
                            {formatMetric(
                              getCandidateMetric(
                                selectedCandidate,
                                "out_of_sample_sharpe",
                              ),
                            )}
                          </strong>
                        </article>
                        <article className="optimization-metric-tile">
                          <span>最大回撤</span>
                          <strong>
                            {formatPercentMetric(
                              getCandidateMetric(
                                selectedCandidate,
                                "max_drawdown_pct",
                              ),
                            )}
                          </strong>
                        </article>
                        <article className="optimization-metric-tile">
                          <span>稳定度</span>
                          <strong>
                            {formatMetric(
                              getCandidateMetric(
                                selectedCandidate,
                                "stability",
                              ),
                              0,
                            )}
                          </strong>
                        </article>
                      </div>

                      <section className="optimization-evaluation-panel">
                        <div className="optimization-parameter-panel__title">
                          综合评价
                        </div>
                        <div className="optimization-evaluation-panel__headline">
                          <strong>
                            综合得分 {formatMetric(selectedCandidate.score, 3)}
                          </strong>
                          <span>
                            {translateOptimizationText(
                              selectedCandidate.status_label,
                            ) ?? "观察中"}
                          </span>
                        </div>
                        <p>{describeCandidateEvaluation(selectedCandidate)}</p>
                      </section>

                      <p className="optimization-results-summary">
                        {translateOptimizationText(
                          selectedCandidate.analysis?.stability_summary,
                        ) ??
                          translateOptimizationText(
                            selectedCandidate.analysis?.thesis,
                          ) ??
                          translateOptimizationText(
                            selectedCandidate.summary,
                          ) ??
                          "-"}
                      </p>

                      {selectedCandidateParameters.length ? (
                        <section className="optimization-parameter-panel">
                          <div className="optimization-parameter-panel__title">
                            当前参数
                          </div>
                          <div className="optimization-parameter-chip-list">
                            {selectedCandidateParameters.map((entry) => (
                              <article
                                className="optimization-parameter-chip"
                                key={entry.key}
                              >
                                <span>{entry.label}</span>
                                <strong>{entry.value}</strong>
                              </article>
                            ))}
                          </div>
                        </section>
                      ) : null}
                    </section>
                  ) : null}
                </div>
              ) : null}

              {hasHeatmap || hasValidation ? (
                <div className="optimization-results-bottom-grid">
                  {hasHeatmap && selectedCandidate ? (
                    <section className="optimization-lab-panel">
                      <div className="optimization-lab-panel__heading">
                        <div>
                          <p className="optimization-lab-eyebrow">
                            {TEXT.heatmapPanel}
                          </p>
                          <h2>{TEXT.heatmapPanel}</h2>
                          <p className="optimization-panel-subtitle">
                            {PANEL_SUBTITLES.heatmapPanel}
                          </p>
                        </div>
                      </div>
                      <div
                        aria-label="参数热区指标切换"
                        className="optimization-heatmap-toggle"
                        role="radiogroup"
                      >
                        {HEATMAP_METRIC_OPTIONS.map((option) => (
                          <button
                            aria-checked={selectedHeatmapMetric === option.key}
                            className={`optimization-heatmap-toggle__option ${
                              selectedHeatmapMetric === option.key
                                ? "optimization-heatmap-toggle__option--active"
                                : ""
                            }`}
                            key={option.key}
                            onClick={() => setSelectedHeatmapMetric(option.key)}
                            role="radio"
                            type="button"
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                      <div className="optimization-heatmap-shell">
                        <table className="optimization-heatmap-table">
                          <thead>
                            <tr>
                              <th>
                                {selectedHeatmap
                                  ? getDisplayText(
                                      selectedHeatmap.y_label,
                                      humanizeKey(selectedHeatmap.y_key ?? ""),
                                    )
                                  : "-"}
                              </th>
                              {(selectedHeatmap?.x_values ?? []).map(
                                (value) => (
                                  <th key={`heatmap-x-${value}`}>{value}</th>
                                ),
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {(selectedHeatmap?.y_values ?? []).map(
                              (rowValue) => (
                                <tr key={`heatmap-row-${rowValue}`}>
                                  <th>{rowValue}</th>
                                  {(selectedHeatmap?.x_values ?? []).map(
                                    (columnValue) => {
                                      const cell = (
                                        selectedHeatmap?.cells ?? []
                                      ).find(
                                        (item) =>
                                          item.x === columnValue &&
                                          item.y === rowValue,
                                      );
                                      return (
                                        <td
                                          className={`optimization-heatmap-cell optimization-heatmap-cell--${
                                            cell
                                              ? resolveHeatmapTone(
                                                  selectedHeatmap?.cells ?? [],
                                                  selectedHeatmapMetric,
                                                  cell,
                                                )
                                              : "cool"
                                          } ${
                                            cell?.is_candidate
                                              ? "optimization-heatmap-cell--selected"
                                              : ""
                                          }`}
                                          key={`heatmap-cell-${rowValue}-${columnValue}`}
                                        >
                                          {formatHeatmapMetricValue(
                                            selectedHeatmapMetric,
                                            getHeatmapCellMetricValue(
                                              cell,
                                              selectedHeatmapMetric,
                                            ),
                                          )}
                                        </td>
                                      );
                                    },
                                  )}
                                </tr>
                              ),
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  ) : null}

                  {hasValidation && selectedCandidate ? (
                    <section className="optimization-lab-panel">
                      <div className="optimization-lab-panel__heading">
                        <div>
                          <p className="optimization-lab-eyebrow">
                            {TEXT.validationPanel}
                          </p>
                          <h2>{TEXT.validationPanel}</h2>
                          <p className="optimization-panel-subtitle">
                            {PANEL_SUBTITLES.validationPanel}
                          </p>
                        </div>
                      </div>
                      <div className="optimization-lab-table-shell">
                        <table className="optimization-lab-table optimization-lab-table--compact">
                          <thead>
                            <tr>
                              <th>窗口</th>
                              <th>年化收益率</th>
                              <th>收益夏普</th>
                              <th>样本外</th>
                              <th>回撤</th>
                              <th>稳定性</th>
                              <th>结论</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(
                              selectedCandidate.analysis?.validation_windows ??
                              []
                            ).map((windowItem) => (
                              <tr
                                key={`${windowItem.label}-${windowItem.period_label ?? ""}`}
                              >
                                <td>
                                  <div className="optimization-lab-table__stack">
                                    <strong>
                                      {getDisplayText(windowItem.label)}
                                    </strong>
                                    {windowItem.period_label ? (
                                      <span>
                                        {getDisplayText(windowItem.period_label)}
                                      </span>
                                    ) : null}
                                  </div>
                                </td>
                                <td>
                                  {formatReturnRate(
                                    windowItem.annualized_return,
                                  )}
                                </td>
                                <td>
                                  {formatMetric(windowItem.return_sharpe)}
                                </td>
                                <td>
                                  {formatMetric(
                                    windowItem.out_of_sample_sharpe,
                                  )}
                                </td>
                                <td>
                                  {formatPercentMetric(
                                    windowItem.max_drawdown_pct,
                                  )}
                                </td>
                                <td>{formatMetric(windowItem.stability, 0)}</td>
                                <td>
                                  {windowItem.verdict === "pass"
                                    ? "通过"
                                    : windowItem.verdict === "watch"
                                      ? "观察"
                                      : "风险"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="optimization-validation-footnote">
                        {VALIDATION_WINDOW_GUIDANCE}
                      </p>
                    </section>
                  ) : null}
                </div>
              ) : null}

              {hasCandidateShelf ? (
                <section className="optimization-lab-panel">
                  <div className="optimization-lab-panel__heading">
                    <div>
                      <p className="optimization-lab-eyebrow">
                        {TEXT.candidateShelf}
                      </p>
                      <h2>{TEXT.candidateShelf}</h2>
                    </div>
                  </div>
                  <div className="optimization-shelf-grid">
                    {candidateRows.map((candidate) => (
                      <button
                        className={`optimization-shelf-card ${candidate.id === selectedCandidate?.id ? "optimization-shelf-card--active" : ""}`}
                        key={candidate.id}
                        onClick={() => setSelectedCandidateId(candidate.id)}
                        type="button"
                      >
                        <strong>
                          {getCandidateVersionDisplayText(candidate)}
                        </strong>
                        <span>
                          {translateOptimizationText(candidate.status_label) ??
                            formatOptimizationStatus(candidate.status)}
                        </span>
                        <p>
                          {translateOptimizationText(
                            candidate.analysis?.shelf_copy,
                          ) ??
                            translateOptimizationText(candidate.summary) ??
                            "-"}
                        </p>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { navigateTo } from "../lib/appRouteContext";
import { useApiClient } from "../lib/demoStoreContext";
import { collectOptimizationParameterSeeds } from "../lib/optimization-config-fields";
import {
  buildOptimizationConfigPath,
  buildOptimizationJobsPath,
  buildOptimizationSelectPath,
} from "../lib/optimization-routes";
import type {
  ApiBacktestRunDetail,
  ApiOptimizationConstraint,
  ApiOptimizationConstraintPresetKey,
  ApiOptimizationCandidate,
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
type OptimizationObjective = "return_sharpe" | "annualized_return";
type OptimizationConstraintPreset = {
  key: OptimizationConstraintPresetKey;
  label: string;
  toneLabel: string;
  constraints: OptimizationConstraint[];
};

const OPTIMIZATION_POLL_INTERVAL_MS =
  import.meta.env.MODE === "test" ? 50 : 3000;
const HEATMAP_METRIC_OPTIONS: Array<{ key: HeatmapMetricKey; label: string }> =
  [
    { key: "annualized_return", label: "年化收益率" },
    { key: "return_sharpe", label: "收益夏普" },
    { key: "max_drawdown_pct", label: "最大回撤" },
  ];
const DEFAULT_CONSTRAINT_PRESET_KEY: OptimizationConstraintPresetKey =
  "balanced";
const DEFAULT_OPTIMIZATION_OBJECTIVE: OptimizationObjective = "return_sharpe";
const OPTIMIZATION_OBJECTIVE_OPTIONS: Array<{
  key: OptimizationObjective;
  label: string;
}> = [
  { key: "return_sharpe", label: "收益夏普 Max" },
  { key: "annualized_return", label: "年化收益率 Max" },
];
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
        key: "out_of_sample_sharpe",
        label: "样本外夏普",
        category: "stability",
        operator: ">=",
        value: 0.8,
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
        key: "turnover",
        label: "换手率",
        category: "risk",
        operator: "<=",
        value: 12,
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
        key: "out_of_sample_sharpe",
        label: "样本外夏普",
        category: "stability",
        operator: ">=",
        value: 0.92,
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
        key: "turnover",
        label: "换手率",
        category: "risk",
        operator: "<=",
        value: 10,
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
        key: "out_of_sample_sharpe",
        label: "样本外夏普",
        category: "stability",
        operator: ">=",
        value: 0.65,
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
        key: "turnover",
        label: "换手率",
        category: "risk",
        operator: "<=",
        value: 16,
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
  };
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
    .replace(/\bTrial\s+(\d+)\b/gi, "试验 $1");
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

function isMostlyAsciiLabel(value: string): boolean {
  return /^[A-Za-z0-9_ %()./+:-]+$/.test(value);
}

function getSearchFieldDisplayLabel(
  field: Pick<ApiOptimizationSearchSpaceField, "key" | "label">,
): string {
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
    ? constraints
    : preset.constraints;
  return sourceConstraints.map((constraint) => {
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
  return (
    OPTIMIZATION_OBJECTIVE_OPTIONS.find((option) => option.key === objective)
      ?.label ?? "收益夏普 Max"
  );
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
    objective:
      typeof request.objective === "string" && request.objective.trim()
        ? request.objective
        : DEFAULT_OPTIMIZATION_OBJECTIVE,
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

function isMissingBacktestRunError(caught: unknown): boolean {
  const message =
    caught instanceof Error ? caught.message : String(caught ?? "");
  return /Backtest run not found:/i.test(message);
}

function formatParameterValue(value: ParameterValue | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  if (value === "equal_weight") {
    return "等权";
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

function formatReturnRate(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }
  return formatPercentMetric(value * 100);
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

function stripStrategyVersionSuffix(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return trimmed;
  }
  let cursor = trimmed.length;
  while (cursor > 0 && /\d/.test(trimmed[cursor - 1] ?? "")) {
    cursor -= 1;
  }
  if (
    cursor > 0 &&
    cursor < trimmed.length &&
    trimmed[cursor - 1]?.toLowerCase() === "v"
  ) {
    return trimmed.slice(0, cursor - 1).trimEnd();
  }
  return trimmed;
}

function formatVersionedStrategyName(
  name: string | null | undefined,
  version: number | undefined,
): string {
  const baseName =
    stripStrategyVersionSuffix(String(name ?? "").trim()) ||
    String(name ?? "").trim() ||
    TEXT.resultsTitle;
  if (
    typeof version !== "number" ||
    !Number.isFinite(version) ||
    version <= 1
  ) {
    return baseName;
  }
  return `${baseName}v${Math.round(version)}`;
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
      annualized_return: Number((annualizedReturn - 0.012).toFixed(4)),
      return_sharpe: Number((returnSharpe - 0.04).toFixed(2)),
      out_of_sample_sharpe: Number((outOfSampleSharpe - 0.03).toFixed(2)),
      max_drawdown_pct: Number((maxDrawdownPct - 1.2).toFixed(1)),
      stability: Math.max(0, Number((stability - 4).toFixed(0))),
      verdict: baseVerdict,
    },
    {
      label: "窗口 B",
      annualized_return: Number(annualizedReturn.toFixed(4)),
      return_sharpe: Number(returnSharpe.toFixed(2)),
      out_of_sample_sharpe: Number(outOfSampleSharpe.toFixed(2)),
      max_drawdown_pct: Number(maxDrawdownPct.toFixed(1)),
      stability: Number(stability.toFixed(0)),
      verdict: baseVerdict,
    },
    {
      label: "窗口 C",
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
  };
  return compactLabels[field.key] ?? getSearchFieldDisplayLabel(field);
}

function buildOptimizationRangeSummary(
  fields: ApiOptimizationSearchSpaceField[],
): string | null {
  const rangedFields = fields.filter((field) => field.mode === "range");
  if (!rangedFields.length) {
    return null;
  }
  return rangedFields
    .map(
      (field) =>
        `${getOptimizationRangeLabel(field)}${formatEditableParameterValue(field.start)}-${formatEditableParameterValue(field.end)}`,
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
        value: formatParameterValue(value),
      }));
  }
  return fields.map((field) => ({
    key: field.key,
    label: getSearchFieldDisplayLabel(field),
    value: formatParameterValue(
      snapshot?.[field.key] ?? field.value ?? field.current,
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
  const rangedFields = fields.filter((field) => field.mode === "range");
  if (!rangedFields.length) {
    return [];
  }
  return rangedFields.map((field) => ({
    key: field.key,
    label: getSearchFieldDisplayLabel(field),
    value: formatParameterValue(
      snapshot?.[field.key] ?? field.value ?? field.current,
    ),
  }));
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

function isOptimizationRunning(status?: string | null): boolean {
  return ["QUEUED", "RUNNING"].includes(String(status ?? "").toUpperCase());
}

function isOptimizationProgressState(status?: string | null): boolean {
  return ["QUEUED", "RUNNING", "INTERRUPTED"].includes(
    String(status ?? "").toUpperCase(),
  );
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
): OptimizationDisplayCandidate | null {
  if (!strategy || !baselineRun || !searchSpace.length) {
    return null;
  }

  const latestCompletedRun = strategy.latest_completed_run_summary;
  const annualizedReturn =
    readNumber(latestCompletedRun?.annualized_return) ??
    readNumber(baselineRun.metrics?.annualized_return) ??
    readNumber(baselineRun.metrics?.cagr);
  const returnSharpe =
    readNumber(latestCompletedRun?.sharpe) ??
    readNumber(baselineRun.metrics?.sharpe);
  const outOfSampleSharpe =
    readNumber(latestCompletedRun?.oos_sharpe) ??
    readNumber(baselineRun.metrics?.out_of_sample_sharpe) ??
    returnSharpe;
  const maxDrawdownPct =
    readNumber(latestCompletedRun?.max_drawdown) !== undefined
      ? (readNumber(latestCompletedRun?.max_drawdown) ?? 0) * 100
      : (readNumber(baselineRun.metrics?.max_drawdown_pct) ??
        (readNumber(baselineRun.metrics?.max_drawdown) ?? 0) * 100);
  const totalReturnPct =
    readNumber(latestCompletedRun?.total_return) !== undefined
      ? (readNumber(latestCompletedRun?.total_return) ?? 0) * 100
      : (readNumber(baselineRun.metrics?.total_return_pct) ??
        (readNumber(baselineRun.metrics?.total_return) ?? 0) * 100);
  const stability = clampMetric(
    Math.round(
      (outOfSampleSharpe ?? returnSharpe ?? 0) * 32 +
        (annualizedReturn ?? 0) * 180 -
        Math.abs(maxDrawdownPct ?? 0) * 0.35,
    ),
    35,
    88,
  );

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
  const parameterSnapshot = { ...(strategy.parameters ?? {}) };
  const label = `组合${rank} 当前策略组合`;
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
    score: Number((returnSharpe ?? 0).toFixed(3)),
    parameter_snapshot: parameterSnapshot,
    parameter_delta: {},
    metrics,
    allowed_actions: [],
    analysis: {
      title: label,
      thesis:
        "当前策略组合仅作为对照基准，用于观察优化候选相对现行参数在收益、样本外延续性与回撤约束上的改善幅度。",
      shelf_copy: summary,
      stability_verdict: "当前基准",
      stability_summary:
        "当前策略组合用于与优化候选横向比较，重点观察年化收益、样本外夏普与回撤改善幅度。",
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
  if (field.mode === "fixed") {
    return 1;
  }

  const start = asFiniteNumber(field.start);
  const end = asFiniteNumber(field.end);
  const step = asFiniteNumber(field.step);
  if (start === null || end === null || step === null || step === 0) {
    return 1;
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
    return 1;
  }

  return Math.max(Math.floor(scaledRange / scaledStride) + 1, 1);
}

function calculateBudgetCombinations(
  fields: ApiOptimizationSearchSpaceField[],
): number {
  if (!fields.length) {
    return 0;
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

function buildStrategyMetricsMap(
  runDetails: Record<string, ApiBacktestRunDetail>,
) {
  return Object.fromEntries(
    Object.entries(runDetails).map(([runId, runDetail]) => [
      runId,
      {
        sharpe:
          typeof runDetail.metrics?.sharpe === "number"
            ? runDetail.metrics.sharpe
            : undefined,
        totalReturn:
          typeof runDetail.metrics?.total_return === "number"
            ? runDetail.metrics.total_return * 100
            : undefined,
        maxDrawdown:
          typeof runDetail.metrics?.max_drawdown === "number"
            ? runDetail.metrics.max_drawdown * 100
            : undefined,
      },
    ]),
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
                {jobs.map((job) => (
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
                      {getDisplayText(job.strategy_name, job.strategy_id)}
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
                ))}
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
  const [runDetails, setRunDetails] = useState<
    Record<string, ApiBacktestRunDetail>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        setLoading(true);
        setError(null);
        const payload = await api.listStrategies();
        const latestRunIds = payload
          .map((item) => item.latest_successful_run_id ?? item.latest_run_id)
          .filter((value): value is string => Boolean(value));
        const runEntries = await Promise.all(
          [...new Set(latestRunIds)].map(
            async (runId) =>
              [runId, await api.getBacktestRunDetail(runId)] as const,
          ),
        );
        if (!cancelled) {
          setStrategies(payload);
          setRunDetails(Object.fromEntries(runEntries));
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
    () => buildStrategyMetricsMap(runDetails),
    [runDetails],
  );

  return (
    <div className="optimization-lab-page">
      <OptimizationStepBar current="select" />

      <section className="optimization-lab-panel optimization-lab-panel--hero">
        <div>
          <p className="optimization-lab-eyebrow">第一步 · 选择策略</p>
          <h1>{TEXT.selectTitle}</h1>
          <p>{TEXT.selectCopy}</p>
        </div>
        <button
          className="ghost-button"
          onClick={() => navigateTo(buildOptimizationJobsPath())}
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

      <section className="optimization-lab-panel optimization-lab-panel--hero">
        <div>
          <p className="optimization-lab-eyebrow">第二步 · 参数配置</p>
          <h1>
            {translateOptimizationText(strategy?.name) ?? TEXT.configTitle}
          </h1>
          <p>{TEXT.configCopy}</p>
          {!loading && strategy ? (
            <div className="optimization-meta-chips">
              <span className="status-chip status-chip--soft">
                入口：{formatEntryPoint(entryPoint)}
              </span>
              <span className="status-chip status-chip--soft">
                参数版本：{strategy.current_parameter_version_id ?? "-"}
              </span>
              <span className="status-chip status-chip--soft">
                预计组合：{budgetCombinations} 组
              </span>
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
        <div className="optimization-hero-actions optimization-hero-actions--single-row">
          <button
            className="ghost-button"
            onClick={() => navigateTo(buildOptimizationJobsPath())}
            type="button"
          >
            {TEXT.backToJobs}
          </button>
          <button className="ghost-button" onClick={resetPreset} type="button">
            {TEXT.resetPreset}
          </button>
          <button
            className="primary-button"
            disabled={saving || loading}
            onClick={() => void handleStartOptimization()}
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
                  {searchSpace.map((field, index) => (
                    <tr key={field.key}>
                      <td>{getSearchFieldDisplayLabel(field)}</td>
                      <td>{formatParameterValue(field.current)}</td>
                      <td>
                        <select
                          aria-label={`${getSearchFieldDisplayLabel(field)} 模式`}
                          value={field.mode}
                          onChange={(event) =>
                            updateSearchField(index, {
                              mode: event.target.value as "range" | "fixed",
                            })
                          }
                        >
                          <option value="range">范围</option>
                          <option value="fixed">固定</option>
                        </select>
                      </td>
                      <td>
                        <input
                          aria-label={`${getSearchFieldDisplayLabel(field)} 起点`}
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
                          aria-label={`${getSearchFieldDisplayLabel(field)} 终点`}
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
                          aria-label={`${getSearchFieldDisplayLabel(field)} 步长`}
                          disabled={field.mode === "fixed"}
                          onChange={(event) =>
                            updateSearchField(index, {
                              step: event.target.value,
                            })
                          }
                          value={formatEditableParameterValue(field.step)}
                        />
                      </td>
                    </tr>
                  ))}
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
                <span>预计组合</span>
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
                        <span className="optimization-constraint-card__operator">
                          {formatOptimizationConstraintOperator(
                            constraint.operator,
                          )}
                        </span>
                      </div>
                      <h3>{constraint.label}</h3>
                      <label className="optimization-constraint-card__field">
                        <span>阈值</span>
                        <div className="optimization-constraint-card__input-row">
                          <input
                            aria-label={`${constraint.label} 阈值`}
                            onChange={(event) =>
                              updateConstraint(index, event.target.value)
                            }
                            step={
                              constraint.key === "annualized_return"
                                ? "0.1"
                                : constraint.key.includes("sharpe")
                                  ? "0.01"
                                  : "1"
                            }
                            type="number"
                            value={constraint.value}
                          />
                          {constraint.unit ? (
                            <span className="optimization-constraint-card__unit">
                              {constraint.unit}
                            </span>
                          ) : null}
                        </div>
                      </label>
                      <div className="optimization-constraint-card__badges">
                        <span className="status-chip status-chip--soft">
                          当前策略{" "}
                          {formatOptimizationConstraintThreshold({
                            ...constraint,
                            value:
                              constraint.baseline_value ?? constraint.value,
                          })}
                        </span>
                        <span
                          className={`status-chip status-chip--soft optimization-constraint-card__verdict optimization-constraint-card__verdict--${verdict}`}
                        >
                          当前判定{" "}
                          {formatOptimizationConstraintVerdict(verdict)}
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
                    目标排序 {getOptimizationObjectiveLabel(objective)}
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
  const [error, setError] = useState<string | null>(null);
  const [rerunConfirmOpen, setRerunConfirmOpen] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        setLoading(true);
        setError(null);
        const jobPayload = await api.getOptimizationJobDetail(jobId);
        const strategyPayload = await api.getStrategyDetail(
          jobPayload.strategy_id,
        );
        let baselineRunPayload: ApiBacktestRunDetail | null = null;
        const baselineRunId =
          (typeof jobPayload.request.source_run_id === "string" &&
          jobPayload.request.source_run_id.trim()
            ? jobPayload.request.source_run_id
            : (strategyPayload.latest_completed_run_summary?.run_id ??
              strategyPayload.latest_run_id)) ?? null;
        if (baselineRunId) {
          try {
            baselineRunPayload = await api.getBacktestRunDetail(baselineRunId, {
              view: "metrics",
            });
          } catch {
            baselineRunPayload = null;
          }
        }
        if (!cancelled) {
          setJob(jobPayload);
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
    const timer = window.setInterval(() => {
      if (inFlight) {
        return;
      }
      inFlight = true;
      void (async () => {
        try {
          const jobPayload = await api.getOptimizationJobDetail(jobId);
          if (!cancelled) {
            setJob(jobPayload);
          }
        } catch (caught) {
          if (!cancelled) {
            setError((caught as Error).message);
          }
        } finally {
          inFlight = false;
        }
      })();
    }, OPTIMIZATION_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api, jobId, job?.status]);

  const optimizationSearchSpace = useMemo(
    () => getOptimizationSearchSpace(job),
    [job],
  );
  const baselineCandidate = useMemo(
    () =>
      job?.candidates.length
        ? buildBaselineCandidate(
            strategy,
            baselineRun,
            optimizationSearchSpace,
            (job.candidates.length ?? 0) + 1,
          )
        : null,
    [baselineRun, job?.candidates.length, optimizationSearchSpace, strategy],
  );
  const candidateRows = useMemo<OptimizationDisplayCandidate[]>(
    () => [
      ...(job?.candidates ?? []),
      ...(baselineCandidate ? [baselineCandidate] : []),
    ],
    [baselineCandidate, job?.candidates],
  );

  useEffect(() => {
    if (!job) {
      return;
    }
    const fallbackCandidateId =
      job.result.best_candidate_id ?? candidateRows[0]?.id ?? null;
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
  const optimizationConstraintLabel = getOptimizationConstraintLabel(job);
  const selectedCandidateParameters = useMemo(
    () =>
      buildCandidateParameterEntries(
        selectedCandidate?.parameter_snapshot,
        optimizationSearchSpace,
      ),
    [optimizationSearchSpace, selectedCandidate],
  );
  const optimizationProgressState = isOptimizationProgressState(job?.status);
  const optimizationRunning = isOptimizationRunning(job?.status);
  const optimizationInterrupted =
    String(job?.status ?? "").toUpperCase() === "INTERRUPTED";
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
  const promoteButtonLabel =
    selectedCandidate?.display_kind === "baseline"
      ? "当前基准不可晋升"
      : TEXT.promoteVersion;
  const strategyDisplayName = formatVersionedStrategyName(
    translateOptimizationText(strategy?.name) ??
      job?.strategy_id ??
      TEXT.resultsTitle,
    strategy?.current_parameter_version,
  );
  const heroTitle = `参数优化：${strategyDisplayName}`;
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
      (optimizationRunning
        ? latestUpdate
        : (translateOptimizationText(selectedCandidate?.analysis?.thesis) ??
          translateOptimizationText(job?.result.summary) ??
          TEXT.resultsCopy)));
  const nextActionLabel = optimizationInterrupted
    ? `第 ${nextTrialIndex} 组（已保留 ${persistedTrialCount} 组）`
    : `第 ${nextTrialIndex} 组`;

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

  async function handlePromote(): Promise<void> {
    if (!job || !selectedCandidate) {
      return;
    }
    try {
      setSaving(true);
      setError(null);
      await api.promoteOptimizationCandidate(
        job.id,
        selectedCandidate.id,
        "set_current",
        `promote-${selectedCandidate.id}`,
        "从优化实验室晋升当前版本",
      );
      const [refreshedStrategy, refreshedJob] = await Promise.all([
        api.getStrategyDetail(job.strategy_id),
        api.getOptimizationJobDetail(job.id).catch(() => job),
      ]);
      setStrategy(refreshedStrategy);
      setJob(refreshedJob);
      setSelectedCandidateId(
        refreshedJob.result.best_candidate_id ??
          refreshedJob.candidates[0]?.id ??
          selectedCandidate.id,
      );
      setNotice(
        `已完成版本晋升，策略已更新为 ${formatVersionedStrategyName(refreshedStrategy.name, refreshedStrategy.current_parameter_version)}。`,
      );
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
      <OptimizationStepBar
        current="results"
        selectHref={selectHref}
        configHref={job ? configHref : undefined}
      />

      <section className="optimization-lab-panel optimization-lab-panel--hero">
        <div>
          <p className="optimization-lab-eyebrow">任务结果中心</p>
          <h1>{heroTitle}</h1>
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
              {optimizationConstraintLabel ? (
                <span className="status-chip status-chip--soft optimization-range-chip">
                  约束条件：{optimizationConstraintLabel}
                </span>
              ) : null}
            </div>
          ) : null}
          {notice ? (
            <p className="optimization-inline-notice">{notice}</p>
          ) : null}
        </div>
        <div className="optimization-hero-actions optimization-hero-actions--single-row">
          <button
            className="ghost-button"
            onClick={() => navigateTo(buildOptimizationJobsPath())}
            type="button"
          >
            {TEXT.backToJobs}
          </button>
          {canRerunOptimization ? (
            <button
              className="ghost-button optimization-results-rerun-action"
              disabled={saving}
              onClick={openRerunConfirm}
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
                type="button"
              >
                {TEXT.continueTune}
              </button>
              <button
                className="primary-button"
                disabled={saving || !canPromoteSelectedCandidate}
                onClick={() => void handlePromote()}
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

      {loading ? <p className="empty-state">正在加载结果中心...</p> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      {!loading && job ? (
        <>
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
                            {PANEL_SUBTITLES.candidatePanel}
                          </p>
                        </div>
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
                                        {getCandidateDisplayText(
                                          candidate.title ?? candidate.label,
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
                              <tr key={windowItem.label}>
                                <td>{getDisplayText(windowItem.label)}</td>
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
                          {getCandidateDisplayText(
                            candidate.title ?? candidate.label,
                          )}
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

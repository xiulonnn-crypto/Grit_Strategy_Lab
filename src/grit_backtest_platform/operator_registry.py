from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Iterable, Mapping


DEFAULT_OPERATOR_WINDOW_SPACE = [3, 5, 10, 21, 63, 126, 252]
DEFAULT_ENABLED_OPERATORS = ["TS_Return", "TS_Rank", "TS_Corr"]
DEFAULT_OPERATOR_DEPTH = 2
DEFAULT_DAILY_FORMULA_BUDGET = 10_000
DEFAULT_COMPUTE_BACKEND = "pandas_bottleneck"
DEFAULT_MIN_PERIODS_POLICY = "TS 默认 min_periods=n；TS_Return 需要 n+1 个有效观测；不足输出 NaN。"
DEFAULT_BLOCKED_FIELD_POLICY = "排除 DATA_SOURCE_BLOCKED 字段；缺失 L1 保持 NaN。"
DEFAULT_COMPOSITION_PUBLISH_BOUNDARY = "D2_QUARANTINE_ONLY"
COMPOSITION_METHOD_TYPES = (
    "LINEAR_WEIGHTING",
    "RATIO_RISK_ADJUSTED",
    "RESIDUAL_ORTHOGONAL",
    "RANK_POOLING",
    "FFBLEND_STYLE",
    "DIVERGENCE_PENALTY",
    "TIME_SERIES_DENOISE",
)
DEFAULT_COMPOSITION_METHODS: tuple[dict[str, Any], ...] = (
    {
        "id": "linear_weighting",
        "label": "线性加权合成",
        "theme": "风格复合",
        "method_type": "LINEAR_WEIGHTING",
        "enabled": True,
        "formula_template": "F3 = sum(w_i * ZScore(F2_i))",
        "source_factor_ids": ["s_mom_6m_rank", "s_qlty_roe_ltm_raw", "s_val_cfp_ltm_raw"],
        "params": {"weight_mode": "equal", "dynamic_window": 21, "dynamic_weighting_enabled": False},
        "publish_boundary": DEFAULT_COMPOSITION_PUBLISH_BOUNDARY,
    },
    {
        "id": "ratio_risk_adjusted",
        "label": "比例/风险调整合成",
        "theme": "风险调节",
        "method_type": "RATIO_RISK_ADJUSTED",
        "enabled": True,
        "formula_template": "F3 = Rank(F2_alpha) / max(Rank(F2_risk), denominator_floor)",
        "source_factor_ids": [
            "s_mom_6m_rank",
            "s_vol_252d_rank",
            "s_val_cfp_ltm_raw",
            "s_vol_downside_252d_rank",
        ],
        "params": {"denominator_floor": 0.05, "rank_space": True},
        "publish_boundary": DEFAULT_COMPOSITION_PUBLISH_BOUNDARY,
    },
    {
        "id": "residual_orthogonal",
        "label": "残差/正交化合成",
        "theme": "残差/中性化",
        "method_type": "RESIDUAL_ORTHOGONAL",
        "enabled": True,
        "formula_template": "F3 = Residual(F2_A, by=F2_B)",
        "source_factor_ids": ["s_liq_amihud_20d_rank", "s_size_cur_log"],
        "params": {"rolling_window": 252, "rebalance_frequency": "MONTHLY"},
        "publish_boundary": DEFAULT_COMPOSITION_PUBLISH_BOUNDARY,
    },
    {
        "id": "rank_pooling",
        "label": "排名均值/交集法",
        "theme": "均衡严选",
        "method_type": "RANK_POOLING",
        "enabled": True,
        "formula_template": "F3 = Rank(F2_A) + Rank(F2_B)",
        "source_factor_ids": ["s_mom_6m_rank", "s_qlty_roe_ltm_raw"],
        "params": {"rank_direction": "HIGH_IS_BETTER", "top_pct": 0.10, "intersection_policy": "SUM_AND_INTERSECT"},
        "publish_boundary": DEFAULT_COMPOSITION_PUBLISH_BOUNDARY,
    },
    {
        "id": "ffblend_style",
        "label": "FFBlend 风格融合",
        "theme": "风格复合",
        "method_type": "FFBLEND_STYLE",
        "enabled": True,
        "formula_template": "F3 = FFBlend(Value, Momentum, Quality, Size)",
        "source_factor_ids": ["s_val_cfp_ltm_raw", "s_mom_6m_rank", "s_qlty_roe_ltm_raw", "s_size_cur_log"],
        "params": {"style_buckets": ["Value", "Momentum", "Quality", "Size"], "single_style_cap": 0.45, "decay": 0.94},
        "publish_boundary": DEFAULT_COMPOSITION_PUBLISH_BOUNDARY,
    },
    {
        "id": "divergence_penalty",
        "label": "背离惩罚",
        "theme": "背离惩罚",
        "method_type": "DIVERGENCE_PENALTY",
        "enabled": False,
        "formula_template": "F3 = Rank(primary) - penalty * Rank(control)",
        "source_factor_ids": ["s_mom_6m_rank", "s_vol_downside_252d_rank"],
        "params": {"penalty": 0.35, "control_role": "risk"},
        "publish_boundary": DEFAULT_COMPOSITION_PUBLISH_BOUNDARY,
    },
    {
        "id": "ts_denoise",
        "label": "时序降噪",
        "theme": "时序降噪",
        "method_type": "TIME_SERIES_DENOISE",
        "enabled": False,
        "formula_template": "F3 = TsRank(signal, 252)",
        "source_factor_ids": ["s_mom_6m_rank"],
        "params": {"smoothing_window": 252, "denoise_method": "TsRank"},
        "publish_boundary": DEFAULT_COMPOSITION_PUBLISH_BOUNDARY,
    },
)
DEFAULT_GOVERNANCE_PROTOCOL = {
    "wnzt_standard_flow": True,
    "winsorize_enabled": True,
    "neutralize_enabled": True,
    "zscore_enabled": True,
    "ts_smooth_enabled": True,
    "orthogonalization_enabled": False,
    "turnover_filter_enabled": False,
}


def default_composition_methods() -> list[dict[str, Any]]:
    return [
        {
            **method,
            "source_factor_ids": list(method.get("source_factor_ids") or []),
            "params": dict(method.get("params") or {}),
        }
        for method in DEFAULT_COMPOSITION_METHODS
    ]


def _normalize_composition_method(raw: Mapping[str, Any], defaults: Mapping[str, Any]) -> dict[str, Any]:
    merged = {**dict(defaults), **dict(raw)}
    method_id = str(merged.get("id") or "").strip()
    if not method_id:
        raise ValueError("composition method id must not be empty")
    method_type = str(merged.get("method_type") or "").strip().upper()
    if method_type not in COMPOSITION_METHOD_TYPES:
        raise ValueError(f"unsupported composition method_type: {method_type}")
    enabled = merged.get("enabled")
    if not isinstance(enabled, bool):
        raise ValueError(f"composition method {method_id} enabled must be a boolean")
    publish_boundary = str(merged.get("publish_boundary") or "").strip().upper()
    if publish_boundary != DEFAULT_COMPOSITION_PUBLISH_BOUNDARY:
        raise ValueError("composition method publish_boundary must be D2_QUARANTINE_ONLY")
    params = merged.get("params")
    if not isinstance(params, Mapping):
        raise ValueError(f"composition method {method_id} params must be an object")
    normalized_params = dict(params)
    if method_type == "RATIO_RISK_ADJUSTED":
        floor = normalized_params.get("denominator_floor", normalized_params.get("floor"))
        if floor is None:
            raise ValueError("RATIO_RISK_ADJUSTED requires denominator_floor")
        try:
            floor_value = float(floor)
        except (TypeError, ValueError) as exc:
            raise ValueError("RATIO_RISK_ADJUSTED denominator_floor must be numeric") from exc
        if floor_value <= 0:
            raise ValueError("RATIO_RISK_ADJUSTED denominator_floor must be positive")
        normalized_params["denominator_floor"] = floor_value
    return {
        "id": method_id,
        "label": str(merged.get("label") or method_id).strip(),
        "theme": str(merged.get("theme") or "").strip(),
        "method_type": method_type,
        "enabled": enabled,
        "formula_template": str(merged.get("formula_template") or "").strip(),
        "source_factor_ids": [
            str(item).strip()
            for item in (merged.get("source_factor_ids") or [])
            if str(item).strip()
        ],
        "params": normalized_params,
        "publish_boundary": DEFAULT_COMPOSITION_PUBLISH_BOUNDARY,
    }


def normalize_composition_methods(value: Any = None) -> list[dict[str, Any]]:
    defaults = default_composition_methods()
    if not value:
        return defaults
    if not isinstance(value, list):
        raise ValueError("composition_methods must be a list")
    default_by_id = {str(method["id"]): method for method in defaults}
    raw_by_id: dict[str, Mapping[str, Any]] = {}
    extras: list[Mapping[str, Any]] = []
    for item in value:
        if not isinstance(item, Mapping):
            raise ValueError("composition_methods entries must be objects")
        method_id = str(item.get("id") or "").strip()
        if method_id in default_by_id:
            raw_by_id[method_id] = item
        else:
            extras.append(item)
    normalized = [
        _normalize_composition_method(raw_by_id.get(str(default["id"]), {}), default)
        for default in defaults
    ]
    normalized.extend(_normalize_composition_method(item, {}) for item in extras)
    return normalized


@dataclass(frozen=True)
class OperatorDefinition:
    operator_id: str
    display_name: str
    operator_group: str
    definition: str
    economic_meaning: str
    input_types: tuple[str, ...]
    output_dimension: str
    default_params: Mapping[str, Any]
    allowed_window_space: tuple[int, ...]
    min_periods_rule: str
    domain_rules: Mapping[str, Any]

    def to_dict(self, *, enabled: bool = False) -> dict[str, Any]:
        payload = asdict(self)
        payload["input_types"] = list(self.input_types)
        payload["default_params"] = dict(self.default_params)
        payload["allowed_window_space"] = list(self.allowed_window_space)
        payload["domain_rules"] = dict(self.domain_rules)
        payload["enabled"] = bool(enabled)
        return payload


def _ts(
    operator_id: str,
    definition: str,
    economic_meaning: str,
    *,
    default_n: int = 21,
    min_periods_rule: str | None = None,
    inputs: tuple[str, ...] = ("time_series",),
) -> OperatorDefinition:
    return OperatorDefinition(
        operator_id=operator_id,
        display_name=operator_id,
        operator_group="TS",
        definition=definition,
        economic_meaning=economic_meaning,
        input_types=inputs,
        output_dimension="symbol_date",
        default_params={"n": default_n},
        allowed_window_space=tuple(DEFAULT_OPERATOR_WINDOW_SPACE),
        min_periods_rule=min_periods_rule or "min_periods = n; insufficient history returns NaN",
        domain_rules={"nan_policy": "propagate", "future_reference": "forbidden"},
    )


def operator_definitions() -> list[OperatorDefinition]:
    return [
        _ts("TS_Mean", "mean(x[t-n+1:t])", "平滑单标的历史水平，降低日度噪声。"),
        _ts("TS_Std", "std(x[t-n+1:t])", "度量单标的历史波动与稳定性。"),
        _ts("TS_Max", "max(x[t-n+1:t])", "识别窗口内历史高点。"),
        _ts("TS_Min", "min(x[t-n+1:t])", "识别窗口内历史低点。"),
        _ts("TS_Delta", "x[t] - x[t-n]", "度量窗口端点变化。"),
        _ts("TS_Return", "x[t] / x[t-n] - 1", "度量价格或字段的窗口收益。", min_periods_rule="min_periods = n + 1; insufficient history returns NaN"),
        _ts("TS_Rank", "rank(x[t] within x[t-n+1:t])", "衡量当前值在自身历史窗口中的相对位置。"),
        _ts("TS_Skew", "skew(x[t-n+1:t])", "度量历史分布偏度。"),
        _ts("TS_Kurt", "kurtosis(x[t-n+1:t])", "度量历史分布尾部厚度。"),
        OperatorDefinition(
            "CS_Rank",
            "CS_Rank",
            "CS",
            "rank_i(x_i[t])",
            "比较同一日期不同标的的相对强弱。",
            ("cross_section",),
            "symbol_date",
            {},
            tuple(DEFAULT_OPERATOR_WINDOW_SPACE),
            "min_periods = cross_section_valid_count >= 2",
            {"nan_policy": "exclude_then_restore_nan"},
        ),
        OperatorDefinition(
            "CS_ZScore",
            "CS_ZScore",
            "CS",
            "(x_i[t] - mean_cs(x[t])) / std_cs(x[t])",
            "将截面数值标准化，便于跨字段比较。",
            ("cross_section",),
            "symbol_date",
            {},
            tuple(DEFAULT_OPERATOR_WINDOW_SPACE),
            "min_periods = cross_section_valid_count >= 2",
            {"nan_policy": "exclude_then_restore_nan"},
        ),
        OperatorDefinition(
            "CS_Scale",
            "CS_Scale",
            "CS",
            "x_i[t] / sum_j(abs(x_j[t]))",
            "压缩截面量纲，保留方向与相对权重。",
            ("cross_section",),
            "symbol_date",
            {},
            tuple(DEFAULT_OPERATOR_WINDOW_SPACE),
            "min_periods = cross_section_valid_count >= 1",
            {"nan_policy": "exclude_then_restore_nan"},
        ),
        OperatorDefinition(
            "CS_Neutral",
            "CS_Neutral",
            "CS",
            "residual(x_i[t] ~ group_i)",
            "剔除行业、市值或其他分组暴露。",
            ("cross_section", "group"),
            "symbol_date",
            {"group": "industry"},
            tuple(DEFAULT_OPERATOR_WINDOW_SPACE),
            "min_periods = group_valid_count >= 2",
            {"nan_policy": "exclude_then_restore_nan"},
        ),
        _ts("TS_Corr", "corr(x[t-n+1:t], y[t-n+1:t])", "度量两个字段在历史窗口中的协动。", inputs=("time_series", "time_series")),
        _ts("TS_Cov", "cov(x[t-n+1:t], y[t-n+1:t])", "度量两个字段的窗口协方差。", inputs=("time_series", "time_series")),
        _ts("Reg_Slope", "slope(y[t-n+1:t] ~ x[t-n+1:t])", "估计单标的窗口 Beta 或敏感度。", inputs=("time_series", "time_series")),
        _ts("Reg_Resid", "residual_t(y ~ x over n)", "提取剔除线性解释后的特异残差。", inputs=("time_series", "time_series")),
        OperatorDefinition("Sign", "Sign", "NONLINEAR", "sign(x)", "保留方向，压缩幅度。", ("numeric",), "same_as_input", {}, tuple(DEFAULT_OPERATOR_WINDOW_SPACE), "min_periods = 1", {"nan_policy": "propagate"}),
        OperatorDefinition("Abs", "Abs", "NONLINEAR", "abs(x)", "衡量偏离强度，不区分方向。", ("numeric",), "same_as_input", {}, tuple(DEFAULT_OPERATOR_WINDOW_SPACE), "min_periods = 1", {"nan_policy": "propagate"}),
        OperatorDefinition("Log", "Log", "NONLINEAR", "log(x)", "压缩右偏分布，要求输入为正。", ("numeric",), "same_as_input", {}, tuple(DEFAULT_OPERATOR_WINDOW_SPACE), "min_periods = 1", {"nan_policy": "non_positive_to_nan"}),
        OperatorDefinition("If_Then_Else", "If_Then_Else", "NONLINEAR", "if condition then a else b", "表达阈值型或状态型因子逻辑。", ("condition", "numeric", "numeric"), "same_as_input", {}, tuple(DEFAULT_OPERATOR_WINDOW_SPACE), "min_periods = 1", {"nan_policy": "condition_nan_to_nan"}),
        OperatorDefinition("Signed_Power", "Signed_Power", "NONLINEAR", "sign(x) * abs(x)^p", "放大强信号同时保留方向。", ("numeric",), "same_as_input", {"p": 2}, tuple(DEFAULT_OPERATOR_WINDOW_SPACE), "min_periods = 1", {"nan_policy": "propagate"}),
        _ts("Decay_Linear", "weighted_mean(x, weights=1..n)", "对近期观测赋予更高权重。"),
        _ts("High_Day", "argmax_day(x[t-n+1:t])", "度量距窗口高点的位置。"),
        _ts("Sum_Out_Of", "count(x[t-n+1:t] > 0)", "统计窗口内信号触发次数。"),
    ]


def default_operator_config() -> dict[str, Any]:
    return {
        "enabled_operators": list(DEFAULT_ENABLED_OPERATORS),
        "window_space": list(DEFAULT_OPERATOR_WINDOW_SPACE),
        "default_depth": DEFAULT_OPERATOR_DEPTH,
        "daily_formula_budget": DEFAULT_DAILY_FORMULA_BUDGET,
        "compute_backend": DEFAULT_COMPUTE_BACKEND,
        "min_periods_policy": DEFAULT_MIN_PERIODS_POLICY,
        "blocked_field_policy": DEFAULT_BLOCKED_FIELD_POLICY,
        "governance_protocol": dict(DEFAULT_GOVERNANCE_PROTOCOL),
        "composition_methods": default_composition_methods(),
        "notes": "",
    }


def normalize_operator_config(payload: Mapping[str, Any] | None = None) -> dict[str, Any]:
    raw = dict(payload or {})
    defaults = default_operator_config()
    registry_ids = {item.operator_id for item in operator_definitions()}
    enabled = [str(item).strip() for item in raw.get("enabled_operators", defaults["enabled_operators"]) if str(item).strip()]
    unknown = sorted(set(enabled) - registry_ids)
    if unknown:
        raise ValueError(f"unknown operators: {', '.join(unknown)}")
    windows = [int(item) for item in raw.get("window_space", defaults["window_space"])]
    if not windows or any(item <= 0 for item in windows):
        raise ValueError("window_space must contain positive integers")
    allowed_windows = set(DEFAULT_OPERATOR_WINDOW_SPACE)
    invalid_windows = [item for item in windows if item not in allowed_windows]
    if invalid_windows:
        raise ValueError(f"unsupported windows: {invalid_windows}")
    depth = int(raw.get("default_depth", defaults["default_depth"]))
    if depth < 1 or depth > 8:
        raise ValueError("default_depth must be between 1 and 8")
    daily_formula_budget = int(raw.get("daily_formula_budget", defaults["daily_formula_budget"]))
    if daily_formula_budget < 1 or daily_formula_budget > DEFAULT_DAILY_FORMULA_BUDGET:
        raise ValueError("daily_formula_budget must be between 1 and 10000")
    compute_backend = str(raw.get("compute_backend") or defaults["compute_backend"]).strip()
    if compute_backend != DEFAULT_COMPUTE_BACKEND:
        raise ValueError(f"unsupported compute_backend: {compute_backend}")
    raw_protocol = raw.get("governance_protocol")
    protocol = dict(DEFAULT_GOVERNANCE_PROTOCOL)
    if isinstance(raw_protocol, Mapping):
        for key in DEFAULT_GOVERNANCE_PROTOCOL:
            if key in raw_protocol:
                protocol[key] = bool(raw_protocol[key])
    return {
        "enabled_operators": enabled,
        "window_space": sorted(dict.fromkeys(windows)),
        "default_depth": depth,
        "daily_formula_budget": daily_formula_budget,
        "compute_backend": compute_backend,
        "min_periods_policy": str(raw.get("min_periods_policy") or defaults["min_periods_policy"]),
        "blocked_field_policy": str(raw.get("blocked_field_policy") or defaults["blocked_field_policy"]),
        "governance_protocol": protocol,
        "composition_methods": normalize_composition_methods(raw.get("composition_methods") or defaults["composition_methods"]),
        "notes": str(raw.get("notes") or ""),
    }


def registry_items_for_config(config: Mapping[str, Any]) -> list[dict[str, Any]]:
    enabled = set(str(item) for item in config.get("enabled_operators", []))
    windows = tuple(int(item) for item in config.get("window_space", DEFAULT_OPERATOR_WINDOW_SPACE))
    items: list[dict[str, Any]] = []
    for definition in operator_definitions():
        item = definition.to_dict(enabled=definition.operator_id in enabled)
        item["allowed_window_space"] = list(windows if definition.operator_group in {"TS"} else definition.allowed_window_space)
        items.append(item)
    return items


def operator_ids(items: Iterable[Mapping[str, Any]]) -> list[str]:
    return [str(item.get("operator_id") or "") for item in items if str(item.get("operator_id") or "")]

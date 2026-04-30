from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any, Mapping, Sequence


DEFAULT_ALLOWED_ACTIONS = [
    "edit_prompt",
    "override_field",
    "prepare_confirmation",
    "materialize",
]


@dataclass(slots=True)
class TemplateField:
    key: str
    label: str
    kind: str
    default: Any = None


@dataclass(slots=True)
class StrategyTemplate:
    key: str
    name: str
    description: str
    prompt_hints: tuple[str, ...]
    top_level_defaults: dict[str, Any]
    parameter_defaults: dict[str, Any]
    fields: list[TemplateField] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "name": self.name,
            "description": self.description,
            "prompt_hints": list(self.prompt_hints),
            "top_level_defaults": dict(self.top_level_defaults),
            "parameter_defaults": dict(self.parameter_defaults),
            "fields": [asdict(field) for field in self.fields],
        }


STRATEGY_TYPE_TITLES = {
    "GENERAL": "通用策略",
    "GRID": "网格交易策略",
    "MOMENTUM": "动量 / 趋势跟随策略",
    "MEAN_REVERSION": "均值回归策略",
    "BUY_AND_HOLD": "定投策略",
    "ASSET_ALLOCATION": "资产配置型",
}


STRATEGY_TEMPLATES: dict[str, StrategyTemplate] = {
    "GENERAL": StrategyTemplate(
        key="GENERAL",
        name="General Strategy",
        description="Free-form drafting workspace before a concrete template is inferred.",
        prompt_hints=("策略",),
        top_level_defaults={"strategy_type": "GENERAL", "universe_name": "", "rebalance_frequency": None},
        parameter_defaults={},
    ),
    "ASSET_ALLOCATION": StrategyTemplate(
        key="ASSET_ALLOCATION",
        name="Global Allocation",
        description="Multi-asset target weight, rebalance, and cost simulation strategy.",
        prompt_hints=("asset allocation", "risk parity", "global allocation", "资产配置", "风险平价"),
        top_level_defaults={
            "strategy_type": "ASSET_ALLOCATION",
            "universe_name": "Global Allocation",
            "rebalance_frequency": "quarterly",
        },
        parameter_defaults={
            "strategy_name": "全球资产配置策略",
            "strategy_description": "多资产风险预算、目标权重、再平衡与成本假设。",
            "benchmark_symbol": "SPY",
            "capital": 100000,
            "allocation_assets": [],
            "investment_mode": "all_in",
            "contribution_amount": 1000,
            "investment_frequency": "monthly",
            "rebalance_enabled": True,
            "rebalance_frequency": "quarterly",
            "rebalance_threshold_pct": 5,
            "cost_model_enabled": True,
            "fee_bps": 1.5,
            "slippage_bps": 2.5,
            "expense_ratio_bps": 8,
        },
        fields=[
            TemplateField("strategy_name", "策略名称", "string"),
            TemplateField("strategy_description", "策略说明", "string"),
            TemplateField("benchmark_symbol", "基准", "enum", "SPY"),
            TemplateField("capital", "初始资金(USD)", "number"),
            TemplateField("allocation_assets", "资产清单", "json"),
            TemplateField("investment_mode", "配置类型", "enum", "all_in"),
            TemplateField("contribution_amount", "定投金额(USD)", "number"),
            TemplateField("investment_frequency", "定投频率", "enum", "monthly"),
            TemplateField("rebalance_enabled", "再平衡开关", "boolean", True),
            TemplateField("rebalance_frequency", "再平衡频率", "enum", "quarterly"),
            TemplateField("rebalance_threshold_pct", "偏离阈值(%)", "number"),
            TemplateField("cost_model_enabled", "成本模拟", "boolean", True),
            TemplateField("fee_bps", "交易费(bps)", "number"),
            TemplateField("slippage_bps", "滑点(bps)", "number"),
            TemplateField("expense_ratio_bps", "持有成本(bps)", "number"),
        ],
    ),
    "GRID": StrategyTemplate(
        key="GRID",
        name="Grid Strategy",
        description="Grid accumulation / trim strategy around a single target symbol.",
        prompt_hints=("网格", "grid"),
        top_level_defaults={"strategy_type": "GRID", "universe_name": "", "rebalance_frequency": "never"},
        parameter_defaults={
            "strategy_name": None,
            "strategy_description": None,
            "benchmark_symbol": "SPY",
            "initial_position": None,
            "grid_interval": None,
            "buy_size_pct": None,
            "sell_step_pct": None,
            "sell_size_pct": None,
            "max_stop_loss_pct": None,
            "capital": None,
        },
        fields=[
            TemplateField("strategy_name", "策略名称", "string"),
            TemplateField("strategy_description", "策略描述", "string"),
            TemplateField("benchmark_symbol", "基准", "enum", "SPY"),
            TemplateField("initial_position", "初始仓位(%)", "number"),
            TemplateField("grid_interval", "下跌间距(%)", "number"),
            TemplateField("buy_size_pct", "下跌买入仓位(%)", "number"),
            TemplateField("sell_step_pct", "上涨间距(%)", "number"),
            TemplateField("sell_size_pct", "上涨卖出仓位(%)", "number"),
            TemplateField("max_stop_loss_pct", "最大止损仓位(%)", "number"),
            TemplateField("capital", "本金", "number"),
        ],
    ),
    "MOMENTUM": StrategyTemplate(
        key="MOMENTUM",
        name="Momentum Rotation",
        description="Cross-sectional momentum rotation over a broad stock universe.",
        prompt_hints=("动量", "momentum"),
        top_level_defaults={"strategy_type": "MOMENTUM", "universe_name": "", "rebalance_frequency": None},
        parameter_defaults={
            "strategy_name": None,
            "strategy_description": None,
            "benchmark_symbol": "SPY",
            "lookback_months": None,
            "skip_recent_months": None,
            "top_n": None,
            "hold_rank_threshold": None,
            "weighting_method": None,
            "rebalance_anchor_dates": None,
            "capital": None,
        },
        fields=[
            TemplateField("strategy_name", "策略名称", "string"),
            TemplateField("strategy_description", "策略描述", "string"),
            TemplateField("benchmark_symbol", "基准", "enum", "SPY"),
            TemplateField("lookback_months", "回看(月)", "integer"),
            TemplateField("skip_recent_months", "跳过最近(月)", "integer"),
            TemplateField("top_n", "买入排名阈值", "integer"),
            TemplateField("hold_rank_threshold", "保留排名阈值", "integer"),
            TemplateField("weighting_method", "权重方法", "string"),
            TemplateField("rebalance_anchor_dates", "调仓锚点", "string"),
            TemplateField("capital", "初始资金(USD)", "number"),
        ],
    ),
    "MEAN_REVERSION": StrategyTemplate(
        key="MEAN_REVERSION",
        name="Mean Reversion",
        description="Mean reversion strategy around a target symbol or universe.",
        prompt_hints=("均值回归", "mean reversion", "reversion"),
        top_level_defaults={"strategy_type": "MEAN_REVERSION", "universe_name": "", "rebalance_frequency": "never"},
        parameter_defaults={
            "strategy_name": None,
            "strategy_description": None,
            "benchmark_symbol": "SPY",
            "observation_timeframe": None,
            "trading_logic": None,
            "bollinger_period": None,
            "rsi_period": None,
            "rsi_buy_threshold": None,
            "rsi_sell_threshold": None,
            "atr_period": None,
            "take_profit_atr": None,
            "stop_loss_atr": None,
            "long_entry_size_pct": None,
            "short_entry_size_pct": None,
            "capital": None,
        },
        fields=[
            TemplateField("strategy_name", "策略名称", "string"),
            TemplateField("strategy_description", "策略描述", "string"),
            TemplateField("benchmark_symbol", "基准", "enum", "SPY"),
            TemplateField("observation_timeframe", "观察周期", "enum", "daily"),
            TemplateField("trading_logic", "交易逻辑", "string"),
            TemplateField("bollinger_period", "布林带周期", "integer"),
            TemplateField("rsi_period", "RSI周期", "integer"),
            TemplateField("rsi_buy_threshold", "RSI超卖阈值", "number"),
            TemplateField("rsi_sell_threshold", "RSI超买阈值", "number"),
            TemplateField("atr_period", "ATR周期", "integer"),
            TemplateField("take_profit_atr", "止盈倍数(ATR)", "number"),
            TemplateField("stop_loss_atr", "止损倍数(ATR)", "number"),
            TemplateField("long_entry_size_pct", "买入仓位(%)", "number"),
            TemplateField("short_entry_size_pct", "卖出仓位(%)", "number"),
            TemplateField("capital", "初始资金(USD)", "number"),
        ],
    ),
    "BUY_AND_HOLD": StrategyTemplate(
        key="BUY_AND_HOLD",
        name="DCA Strategy",
        description="Periodic ETF accumulation strategy.",
        prompt_hints=("定投", "buy and hold", "dca"),
        top_level_defaults={"strategy_type": "BUY_AND_HOLD", "universe_name": "", "rebalance_frequency": "never"},
        parameter_defaults={
            "strategy_name": None,
            "strategy_description": None,
            "benchmark_symbol": "SPY",
            "contribution_amount": None,
            "investment_frequency": "monthly",
        },
        fields=[
            TemplateField("strategy_name", "策略名称", "string"),
            TemplateField("strategy_description", "策略描述", "string"),
            TemplateField("benchmark_symbol", "基准", "enum", "SPY"),
            TemplateField("contribution_amount", "定投金额(USD)", "number"),
            TemplateField("investment_frequency", "定投频率", "enum", "monthly"),
        ],
    ),
}


TEMPLATE_REGISTRY = STRATEGY_TEMPLATES

FIELD_LABEL_OVERRIDES = {
    "contribution_anchor": "定投执行锚点",
    "dynamic_investment_logic": "动态定投逻辑",
}

DYNAMIC_BUY_AND_HOLD_MULTIPLIER_BANDS: tuple[tuple[str, str], ...] = (
    ("极度高估", ">90%"),
    ("温和高估", "70%-90%"),
    ("合理区间", "30%-70%"),
    ("低估区间", "10%-30%"),
    ("极度低估", "<10%"),
)

DYNAMIC_BUY_AND_HOLD_PROXY_KEY = "nasdaq100"
DYNAMIC_BUY_AND_HOLD_METRIC_KEY = "pe_ttm_percentile_10y"
DYNAMIC_BUY_AND_HOLD_RULES = [
    {"min_percentile": 90.0, "max_percentile": 100.0, "multiplier": 0.5},
    {"min_percentile": 70.0, "max_percentile": 90.0, "multiplier": 0.8},
    {"min_percentile": 30.0, "max_percentile": 70.0, "multiplier": 1.0},
    {"min_percentile": 10.0, "max_percentile": 30.0, "multiplier": 1.5},
    {"min_percentile": 0.0, "max_percentile": 10.0, "multiplier": 2.0},
]


def confirmation_field_label(key: str, fallback: str | None = None) -> str:
    normalized_key = str(key or "").strip()
    return FIELD_LABEL_OVERRIDES.get(normalized_key, fallback or normalized_key)


def template_catalog() -> list[dict[str, Any]]:
    return [template.to_dict() for template in STRATEGY_TEMPLATES.values()]


list_templates = template_catalog


def _messages_to_text(messages: Sequence[Mapping[str, Any]] | str) -> str:
    if isinstance(messages, str):
        return messages
    parts = [str(item.get("content") or "") for item in messages]
    return "\n".join(part for part in parts if part).strip()


def _field(label: str, key: str, value: Any = None, source: str = "system_default") -> dict[str, Any]:
    return {"label": label, "key": key, "value": value, "source": source}


def blank_confirmation_fields(strategy_type: str) -> dict[str, list[dict[str, Any]]]:
    normalized_type = str(strategy_type or "GENERAL").upper()
    template = STRATEGY_TEMPLATES.get(normalized_type, STRATEGY_TEMPLATES["GENERAL"])
    top_level = [
        _field("策略类型", "strategy_type", template.top_level_defaults.get("strategy_type"), "system_default"),
        _field("股票池", "universe_name", template.top_level_defaults.get("universe_name"), "system_default"),
        _field("再平衡频次", "rebalance_frequency", template.top_level_defaults.get("rebalance_frequency"), "system_default"),
    ]
    parameters = [
        _field(field.label, field.key, template.parameter_defaults.get(field.key), "system_default")
        for field in template.fields
    ]
    return {"top_level": top_level, "parameters": parameters}


def _coerce_number(raw: str) -> int | float:
    value = float(raw)
    return int(value) if value.is_integer() else value


def _extract_number(text: str, patterns: Sequence[str]) -> int | None:
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return int(match.group(1))
    return None


def _extract_numeric(text: str, patterns: Sequence[str]) -> int | float | None:
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return _coerce_number(match.group(1))
    return None


def _extract_anchor_dates(text: str) -> str | None:
    matches = re.findall(r"(\d{1,2})[./月-](\d{1,2})", text)
    if len(matches) < 2:
        return None
    anchors = []
    for month, day in matches[:2]:
        anchors.append(f"{int(month):02d}-{int(day):02d}")
    return ",".join(anchors)


def detect_universe(messages: Sequence[Mapping[str, Any]] | str) -> tuple[str, str | None, list[dict[str, Any]]]:
    text = _messages_to_text(messages)
    buy_ticker_match = re.search(
        r"(?:买入|围绕|交易)\s*([A-Za-z]{1,10})\s*(?:-?\d+(?:\.\d+)?)?%\s*(?:仓位)?",
        text,
        flags=re.IGNORECASE,
    )
    if buy_ticker_match:
        return buy_ticker_match.group(1).upper(), "user_input", []
    generic_ticker_match = re.search(
        r"(?<![A-Za-z])(QQQ|SPY|DIA|IWM|AAPL|MSFT|NVDA|TSLA|META|GOOGL|AMZN)(?![A-Za-z])",
        text,
        flags=re.IGNORECASE,
    )
    if generic_ticker_match:
        return generic_ticker_match.group(1).upper(), "user_input", []
    ticker_match = re.search(r"目标\s*([A-Za-z]{1,10})", text, flags=re.IGNORECASE)
    if ticker_match:
        return ticker_match.group(1).upper(), "user_input", []
    generic_ticker_match = re.search(r"\b(QQQ|SPY|DIA|IWM|AAPL|MSFT|NVDA|TSLA|META|GOOGL|AMZN)\b", text, flags=re.IGNORECASE)
    if generic_ticker_match:
        return generic_ticker_match.group(1).upper(), "user_input", []
    if "标普" in text and "成分股" in text:
        return "标普500成分股", "user_input", []
    if "纳指" in text and "成分股" in text:
        return "纳指100成分股", "user_input", []
    return "", None, []


def _detect_strategy_type(text: str, forced_type: str | None = None) -> str:
    if forced_type and forced_type.upper() != "GENERAL":
        return forced_type.upper()
    lowered = text.lower()
    if re.search(r"(每下跌|每跌|下跌).*(买入)", text) and re.search(r"(每上涨|每涨|上涨).*(卖出)", text):
        return "GRID"
    if "网格" in text or "grid" in lowered:
        return "GRID"
    if "动量" in text or "momentum" in lowered:
        return "MOMENTUM"
    if "资产配置" in text or "风险平价" in text or "asset allocation" in lowered or "risk parity" in lowered:
        return "ASSET_ALLOCATION"
    return forced_type.upper() if forced_type else "GENERAL"


def _extract_grid_payload(text: str) -> tuple[dict[str, Any], dict[str, Any]]:
    universe_name, universe_source, _ = detect_universe(text)
    top_level = {
        "strategy_type": ("GRID", "user_input"),
        "universe_name": (universe_name, universe_source or "system_default"),
        "rebalance_frequency": (None, "system_default"),
    }
    parameters = {
        "initial_position": (
            _extract_numeric(
                text,
                [
                    r"初始买入\s*(-?\d+(?:\.\d+)?)%",
                    r"初始仓位\s*(-?\d+(?:\.\d+)?)%",
                    r"买入(?:[A-Za-z]{1,10})?\s*(-?\d+(?:\.\d+)?)%\s*仓位",
                ],
            ),
            "user_input",
        ),
        "grid_interval": (_extract_numeric(text, [r"每跌\s*(-?\d+(?:\.\d+)?)%", r"下跌\s*(-?\d+(?:\.\d+)?)%"]), "user_input"),
        "buy_size_pct": (
            _extract_numeric(
                text,
                [
                    r"每跌\s*-?\d+(?:\.\d+)?%\s*买入\s*(-?\d+(?:\.\d+)?)%",
                    r"下跌\s*-?\d+(?:\.\d+)?%\s*买入\s*(-?\d+(?:\.\d+)?)%",
                ],
            ),
            "user_input",
        ),
        "sell_step_pct": (_extract_numeric(text, [r"每涨\s*(-?\d+(?:\.\d+)?)%", r"上涨\s*(-?\d+(?:\.\d+)?)%"]), "user_input"),
        "sell_size_pct": (
            _extract_numeric(
                text,
                [
                    r"每涨\s*-?\d+(?:\.\d+)?%\s*卖出\s*(-?\d+(?:\.\d+)?)%",
                    r"上涨\s*-?\d+(?:\.\d+)?%\s*卖出\s*(-?\d+(?:\.\d+)?)%",
                    r"卖出\s*(-?\d+(?:\.\d+)?)%",
                ],
            ),
            "user_input",
        ),
        "max_stop_loss_pct": (
            _extract_numeric(
                text,
                [
                    r"最大止损(?:仓位)?\s*(-?\d+(?:\.\d+)?)%",
                    r"止损(?:仓位)?\s*(-?\d+(?:\.\d+)?)%",
                    r"单笔亏损达到\s*(-?\d+(?:\.\d+)?)%",
                ],
            ),
            "user_input",
        ),
        "capital": (_extract_number(text, [r"本金\s*(\d+)"]), "user_input"),
    }
    return top_level, parameters


def _format_extracted_value(value: int | float | None) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _build_grid_strategy_description(
    *,
    text: str,
    universe_name: str,
    capital: int | None,
    initial_position: int | float | None,
    grid_interval: int | float | None,
    buy_size_pct: int | float | None,
    sell_step_pct: int | float | None,
    sell_size_pct: int | float | None,
) -> str | None:
    if not text.strip():
        return None

    extracted_values = [
        universe_name,
        capital,
        initial_position,
        grid_interval,
        buy_size_pct,
        sell_step_pct,
        sell_size_pct,
    ]
    if not any(value not in (None, "", []) for value in extracted_values):
        return None

    details: list[str] = []
    if capital is not None:
        details.append(f"本金{_format_extracted_value(capital)}")

    details.append(f"围绕{universe_name}执行网格交易" if universe_name else "执行网格交易")

    if initial_position is not None:
        details.append(f"初始仓位{_format_extracted_value(initial_position)}%")

    if grid_interval is not None and buy_size_pct is not None:
        details.append(
            f"每下跌{_format_extracted_value(grid_interval)}%买入{_format_extracted_value(buy_size_pct)}%"
        )
    elif grid_interval is not None:
        details.append(f"下跌间距{_format_extracted_value(grid_interval)}%")

    if sell_step_pct is not None and sell_size_pct is not None:
        details.append(
            f"每上涨{_format_extracted_value(sell_step_pct)}%卖出{_format_extracted_value(sell_size_pct)}%"
        )
    elif sell_step_pct is not None:
        details.append(f"上涨间距{_format_extracted_value(sell_step_pct)}%")

    return "，".join(details) + "。"


def _infer_benchmark_symbol(universe_name: str) -> tuple[str, str]:
    normalized = str(universe_name or "").strip().upper()
    if normalized in {"SPY", "QQQ"}:
        return normalized, "system_inference"
    return "SPY", "system_default"


def _extract_frequency_value(text: str, *, default: str | None = None) -> tuple[str | None, str]:
    lowered = text.lower()
    if "每月" in text or "月度" in text or "monthly" in lowered:
        return "monthly", "user_input"
    if "每周" in text or "weekly" in lowered:
        return "weekly", "user_input"
    if "每天" in text or "每日" in text or "daily" in lowered:
        return "daily", "user_input"
    if "每季" in text or "季度" in text or "quarterly" in lowered:
        return "quarterly", "user_input"
    if "每年" in text or "年度" in text or "yearly" in lowered:
        return "yearly", "user_input"
    return default, "system_default"


def _investment_frequency_label(value: str | None) -> str:
    return {
        "daily": "每日",
        "weekly": "每周",
        "monthly": "月度",
        "quarterly": "季度",
        "yearly": "年度",
    }.get(str(value or "").lower(), "定期")


def _buy_and_hold_anchor_prefix(value: str | None) -> str:
    return {
        "daily": "每日",
        "weekly": "每周",
        "monthly": "每月",
        "quarterly": "每季度",
        "yearly": "每年",
    }.get(str(value or "").lower(), "")


def _normalize_dynamic_buy_and_hold_range(value: str | None, fallback: str) -> str:
    normalized = re.sub(r"\s+", "", str(value or ""))
    if not normalized:
        return fallback
    return (
        normalized
        .replace("％", "%")
        .replace("~", "-")
        .replace("至", "-")
        .replace("—", "-")
        .replace("–", "-")
    )


def _is_dynamic_buy_and_hold_prompt(text: str) -> bool:
    compact = re.sub(r"\s+", "", text or "")
    upper_compact = compact.upper()
    if "动态定投" in compact:
        return True
    if "倍率" not in compact:
        return False
    return any(
        token in upper_compact
        for token in (
            "PE",
            "TTM",
        )
    ) or any(token in compact for token in ("估值", "百分位", "极度高估", "极度低估"))


def _extract_buy_and_hold_anchor(text: str, investment_frequency: str | None) -> str | None:
    compact = re.sub(r"\s+", "", text or "")
    match = re.search(r"(每(?:日|天|周|月|季|年)[^，。\n]*?第(?:一|1)个交易日)", compact)
    if match:
        return match.group(1).replace("固定", "").replace("首个交易日", "第一个交易日") or None
    if "首个交易日" in compact or "第一个交易日" in compact:
        prefix = _buy_and_hold_anchor_prefix(investment_frequency)
        return f"{prefix}第一个交易日" if prefix else "第一个交易日"
    return None


def _extract_dynamic_buy_and_hold_logic(text: str, universe_name: str | None) -> str | None:
    if not _is_dynamic_buy_and_hold_prompt(text):
        return None
    compact = (
        re.sub(r"\s+", "", text or "")
        .replace("（", "(")
        .replace("）", ")")
        .replace("：", ":")
    )
    target = str(universe_name or "").strip() or "目标标的"
    upper_compact = compact.upper()
    if re.search(r"滚动10年PE(?:\(TTM\))?", compact, re.IGNORECASE):
        metric = f"{target}滚动10年PE(TTM)百分位"
    elif "PE(TTM)" in upper_compact:
        metric = f"{target}PE(TTM)估值百分位"
    elif "PE" in upper_compact:
        metric = f"{target}PE估值百分位"
    else:
        metric = f"{target}估值百分位"

    bands: list[str] = []
    for label, fallback_range in DYNAMIC_BUY_AND_HOLD_MULTIPLIER_BANDS:
        match = re.search(
            rf"{label}(?:\(([^()]+)\))?:倍率([0-9]+(?:\.[0-9]+)?)x?",
            compact,
            re.IGNORECASE,
        )
        if not match:
            continue
        range_text = _normalize_dynamic_buy_and_hold_range(match.group(1), fallback_range)
        multiplier = match.group(2)
        bands.append(f"{label}{range_text}乘{multiplier}x")

    if bands:
        return f"读取{metric}：{'；'.join(bands)}"
    return f"读取{metric}，按估值区间动态调整定投倍率"


def _build_buy_and_hold_strategy_name(
    universe_name: str,
    investment_frequency: str | None,
    *,
    dynamic_investment_logic: str | None = None,
) -> str | None:
    normalized_universe = str(universe_name or "").strip()
    if dynamic_investment_logic:
        return " ".join(part for part in (normalized_universe, "动态定投策略") if part) or "动态定投策略"
    if not normalized_universe:
        return None
    frequency_label = _investment_frequency_label(investment_frequency)
    return f"{normalized_universe} {frequency_label}定投策略"


def _build_buy_and_hold_strategy_description(
    *,
    text: str,
    universe_name: str,
    contribution_amount: int | float | None,
    investment_frequency: str | None,
    contribution_anchor: str | None = None,
    dynamic_investment_logic: str | None = None,
) -> str | None:
    if not text.strip():
        return None
    details: list[str] = []
    if universe_name:
        details.append(f"围绕{universe_name}执行{_investment_frequency_label(investment_frequency)}定投")
    else:
        details.append(f"执行{_investment_frequency_label(investment_frequency)}定投")
    if contribution_amount is not None:
        amount_prefix = "每期基准买入" if dynamic_investment_logic else "每期买入"
        details.append(f"{amount_prefix}{_format_extracted_value(contribution_amount)}USD")
    if contribution_anchor:
        details.append(f"按{contribution_anchor}执行")
    elif "第一个交易日" in text:
        details.append("按每期首个交易日执行")
    if dynamic_investment_logic:
        details.append(dynamic_investment_logic)
    if "持有" in text:
        details.append("长期持有")
    return "，".join(details) + "。"


def _build_mean_reversion_strategy_description(
    *,
    text: str,
    universe_name: str,
    observation_timeframe: str | None,
    bollinger_period: int | None,
    rsi_period: int | None,
    rsi_buy_threshold: int | float | None,
    rsi_sell_threshold: int | float | None,
    atr_period: int | None,
    take_profit_atr: int | float | None,
    stop_loss_atr: int | float | None,
    long_entry_size_pct: int | float | None,
    short_entry_size_pct: int | float | None,
) -> str | None:
    if not text.strip():
        return None
    details: list[str] = []
    timeframe_label = {
        "daily": "日线",
        "weekly": "周线",
        "monthly": "月线",
    }.get(str(observation_timeframe or "").lower(), "")
    target = f"{universe_name}{timeframe_label}" if universe_name and timeframe_label else universe_name or timeframe_label or "目标标的"
    details.append(f"观察{target}，执行均值回归交易")
    indicator_bits: list[str] = []
    if bollinger_period is not None:
        indicator_bits.append(f"{bollinger_period}日布林带")
    if rsi_period is not None:
        indicator_bits.append(f"RSI({rsi_period})")
    if atr_period is not None:
        indicator_bits.append(f"ATR({atr_period})")
    if indicator_bits:
        details.append(f"使用{'、'.join(indicator_bits)}识别超买超卖与动态风控")
    entry_bits: list[str] = []
    if long_entry_size_pct is not None:
        buy_trigger = "跌破布林带下轨"
        if rsi_buy_threshold is not None and rsi_period is not None:
            buy_trigger += f"且RSI({rsi_period})<{_format_extracted_value(rsi_buy_threshold)}"
        entry_bits.append(f"空仓时{buy_trigger}买入{_format_extracted_value(long_entry_size_pct)}%")
    if short_entry_size_pct is not None:
        sell_trigger = "突破布林带上轨"
        if rsi_sell_threshold is not None and rsi_period is not None:
            sell_trigger += f"且RSI({rsi_period})>{_format_extracted_value(rsi_sell_threshold)}"
        entry_bits.append(f"空仓时{sell_trigger}卖出{_format_extracted_value(short_entry_size_pct)}%")
    if entry_bits:
        details.append("；".join(entry_bits))
    exit_bits: list[str] = []
    if take_profit_atr is not None:
        exit_bits.append(f"{_format_extracted_value(take_profit_atr)}倍ATR止盈")
    if stop_loss_atr is not None:
        exit_bits.append(f"{_format_extracted_value(stop_loss_atr)}倍ATR止损")
    if exit_bits:
        details.append("，".join(exit_bits))
    return "，".join(details) + "。"


def _build_mean_reversion_trading_logic_summary(
    *,
    universe_name: str,
    observation_timeframe: str | None,
    bollinger_period: int | None,
    rsi_period: int | None,
    rsi_buy_threshold: int | float | None,
    rsi_sell_threshold: int | float | None,
    atr_period: int | None,
    take_profit_atr: int | float | None,
    stop_loss_atr: int | float | None,
    long_entry_size_pct: int | float | None,
    short_entry_size_pct: int | float | None,
) -> str | None:
    timeframe_label = {
        "daily": "日线",
        "weekly": "周线",
        "monthly": "月线",
    }.get(str(observation_timeframe or "").lower(), "")
    target = f"{universe_name}{timeframe_label}" if universe_name and timeframe_label else universe_name or timeframe_label or "目标标的"

    logic_bits: list[str] = [f"观察{target}"]
    indicator_bits: list[str] = []
    if bollinger_period is not None:
        indicator_bits.append(f"{bollinger_period}日布林带")
    if rsi_period is not None:
        indicator_bits.append(f"RSI({rsi_period})")
    if atr_period is not None:
        indicator_bits.append(f"ATR({atr_period})")
    if indicator_bits:
        logic_bits.append(f"通过{' + '.join(indicator_bits)}识别超买超卖与动态风控")

    entry_bits: list[str] = []
    if long_entry_size_pct is not None:
        buy_trigger = "跌破布林带下轨"
        if rsi_period is not None and rsi_buy_threshold is not None:
            buy_trigger += f"且RSI({rsi_period})<{_format_extracted_value(rsi_buy_threshold)}"
        entry_bits.append(f"{buy_trigger}时买入{_format_extracted_value(long_entry_size_pct)}%")
    if short_entry_size_pct is not None:
        sell_trigger = "突破布林带上轨"
        if rsi_period is not None and rsi_sell_threshold is not None:
            sell_trigger += f"且RSI({rsi_period})>{_format_extracted_value(rsi_sell_threshold)}"
        entry_bits.append(f"{sell_trigger}时卖出{_format_extracted_value(short_entry_size_pct)}%")
    if entry_bits:
        logic_bits.append("；".join(entry_bits))

    exit_bits: list[str] = []
    if take_profit_atr is not None:
        exit_bits.append(f"{_format_extracted_value(take_profit_atr)}倍ATR止盈")
    if stop_loss_atr is not None:
        exit_bits.append(f"{_format_extracted_value(stop_loss_atr)}倍ATR止损")
    if exit_bits:
        logic_bits.append("，".join(exit_bits))

    return "；".join(bit for bit in logic_bits if bit) if logic_bits else None


def _extract_mean_reversion_timeframe(text: str) -> tuple[str | None, str]:
    lowered = text.lower()
    if "日线" in text or "daily" in lowered:
        return "daily", "user_input"
    if "周线" in text or "weekly" in lowered:
        return "weekly", "user_input"
    if "月线" in text or "每月" in text or "monthly" in lowered:
        return "monthly", "user_input"
    return None, "system_default"


def _extract_mean_reversion_strategy_name(text: str, universe_name: str) -> tuple[str | None, str]:
    explicit = re.search(r"([A-Za-z0-9\u4e00-\u9fff]+?均值回归策略)", text)
    if explicit:
        return explicit.group(1).strip(), "user_input"
    if universe_name:
        return _default_strategy_name({"strategy_type": "MEAN_REVERSION", "universe_name": universe_name}), "system_inference"
    return None, "system_default"


def detect_universe(messages: Sequence[Mapping[str, Any]] | str) -> tuple[str, str | None, list[dict[str, Any]]]:
    text = _messages_to_text(messages)
    buy_ticker_match = re.search(
        r"(?:买入|围绕|交易|标的(?:为|是)?|股票池(?:为|是)?|目标)\s*([A-Za-z]{1,10})\s*(?:-?\d+(?:\.\d+)?)?%\s*(?:仓位)?",
        text,
        flags=re.IGNORECASE,
    )
    if buy_ticker_match:
        return buy_ticker_match.group(1).upper(), "user_input", []

    generic_ticker_match = re.search(
        r"(?<![A-Za-z])(QQQ|SPY|DIA|IWM|AAPL|MSFT|NVDA|TSLA|META|GOOGL|AMZN)(?![A-Za-z])",
        text,
        flags=re.IGNORECASE,
    )
    if generic_ticker_match:
        return generic_ticker_match.group(1).upper(), "user_input", []

    ticker_match = re.search(r"网格\s*([A-Za-z]{1,10})", text, flags=re.IGNORECASE)
    if ticker_match:
        return ticker_match.group(1).upper(), "user_input", []

    generic_ticker_match = re.search(
        r"\b(QQQ|SPY|DIA|IWM|AAPL|MSFT|NVDA|TSLA|META|GOOGL|AMZN)\b",
        text,
        flags=re.IGNORECASE,
    )
    if generic_ticker_match:
        return generic_ticker_match.group(1).upper(), "user_input", []

    if "标普" in text and "成分股" in text:
        return "标普500成分股", "user_input", []
    if ("纳指" in text or "纳斯达克" in text) and "成分股" in text:
        return "纳斯达克100成分股", "user_input", []
    return "", None, []


def _detect_strategy_type(text: str, forced_type: str | None = None) -> str:
    if forced_type and forced_type.upper() != "GENERAL":
        return forced_type.upper()
    lowered = text.lower()
    if re.search(r"(每下跌|每跌|下跌|网格).*(买入)", text) and re.search(r"(每上涨|每涨|上涨).*(卖出)", text):
        return "GRID"
    if "网格" in text or "grid" in lowered:
        return "GRID"
    if "均值回归" in text or "回归均值" in text or "mean reversion" in lowered or "reversion" in lowered:
        return "MEAN_REVERSION"
    if "动量" in text or "momentum" in lowered:
        return "MOMENTUM"
    if "资产配置" in text or "风险平价" in text or "asset allocation" in lowered or "risk parity" in lowered:
        return "ASSET_ALLOCATION"
    if "定投" in text or "buy and hold" in lowered or "dca" in lowered:
        return "BUY_AND_HOLD"
    if re.search(r"每(月|周|日|天|季|年).*(买入)", text):
        return "BUY_AND_HOLD"
    return forced_type.upper() if forced_type else "GENERAL"


def _extract_grid_payload(text: str) -> tuple[dict[str, Any], dict[str, Any]]:
    universe_name, universe_source, _ = detect_universe(text)
    initial_position = _extract_numeric(
        text,
        [
            r"初始买入(?:[A-Za-z]{1,10})?\s*(-?\d+(?:\.\d+)?)%\s*仓位",
            r"初始仓位\s*(-?\d+(?:\.\d+)?)%",
            r"买入(?:[A-Za-z]{1,10})\s*(-?\d+(?:\.\d+)?)%\s*仓位",
        ],
    )
    grid_interval = _extract_numeric(
        text,
        [
            r"每下跌\s*(-?\d+(?:\.\d+)?)%",
            r"每跌\s*(-?\d+(?:\.\d+)?)%",
            r"下跌\s*(-?\d+(?:\.\d+)?)%",
        ],
    )
    buy_size_pct = _extract_numeric(
        text,
        [
            r"每下跌\s*-?\d+(?:\.\d+)?%\s*买入\s*(-?\d+(?:\.\d+)?)%",
            r"每跌\s*-?\d+(?:\.\d+)?%\s*买入\s*(-?\d+(?:\.\d+)?)%",
            r"下跌\s*-?\d+(?:\.\d+)?%\s*买入\s*(-?\d+(?:\.\d+)?)%",
        ],
    )
    sell_step_pct = _extract_numeric(
        text,
        [
            r"每上涨\s*(-?\d+(?:\.\d+)?)%",
            r"每涨\s*(-?\d+(?:\.\d+)?)%",
            r"上涨\s*(-?\d+(?:\.\d+)?)%",
        ],
    )
    sell_size_pct = _extract_numeric(
        text,
        [
            r"每上涨\s*-?\d+(?:\.\d+)?%\s*卖出\s*(-?\d+(?:\.\d+)?)%",
            r"每涨\s*-?\d+(?:\.\d+)?%\s*卖出\s*(-?\d+(?:\.\d+)?)%",
            r"上涨\s*-?\d+(?:\.\d+)?%\s*卖出\s*(-?\d+(?:\.\d+)?)%",
            r"卖出\s*(-?\d+(?:\.\d+)?)%",
        ],
    )
    max_stop_loss_pct = _extract_numeric(
        text,
        [
            r"最大止损(?:仓位)?\s*(-?\d+(?:\.\d+)?)%",
            r"止损(?:仓位)?\s*(-?\d+(?:\.\d+)?)%",
            r"单笔亏损达到\s*(-?\d+(?:\.\d+)?)%",
        ],
    )
    capital = _extract_number(text, [r"本金\s*(\d+)"])
    strategy_name = (
        _default_strategy_name({"strategy_type": "GRID", "universe_name": universe_name})
        if universe_name
        else None
    )
    strategy_description = _build_grid_strategy_description(
        text=text,
        universe_name=universe_name,
        capital=capital,
        initial_position=initial_position,
        grid_interval=grid_interval,
        buy_size_pct=buy_size_pct,
        sell_step_pct=sell_step_pct,
        sell_size_pct=sell_size_pct,
    )

    top_level = {
        "strategy_type": ("GRID", "user_input"),
        "universe_name": (universe_name, universe_source or "system_default"),
        "rebalance_frequency": ("never", "system_default"),
    }
    parameters = {
        "strategy_name": (strategy_name, "system_inference"),
        "strategy_description": (strategy_description, "system_inference"),
        "initial_position": (initial_position, "user_input"),
        "grid_interval": (grid_interval, "user_input"),
        "buy_size_pct": (buy_size_pct, "user_input"),
        "sell_step_pct": (sell_step_pct, "user_input"),
        "sell_size_pct": (sell_size_pct, "user_input"),
        "max_stop_loss_pct": (max_stop_loss_pct, "user_input"),
        "capital": (capital, "user_input"),
    }
    return top_level, parameters


def _extract_momentum_payload(text: str) -> tuple[dict[str, Any], dict[str, Any]]:
    universe_name, universe_source, _ = detect_universe(text)
    weighting_method = None
    if "各成分10%" in text or "等权" in text or "equal" in text.lower():
        weighting_method = "equal_weight"
    anchors = _extract_anchor_dates(text)
    top_level = {
        "strategy_type": ("MOMENTUM", "user_input"),
        "universe_name": (universe_name, universe_source or "system_default"),
        "rebalance_frequency": ("每半年" if anchors else None, "user_input" if anchors else "system_default"),
    }
    parameters = {
        "lookback_months": (_extract_number(text, [r"过去\s*(\d+)\s*个月", r"回看\s*(\d+)\s*个月"]), "user_input"),
        "skip_recent_months": (_extract_number(text, [r"移除最近\s*(\d+)\s*个月", r"跳过最近\s*(\d+)\s*个月"]), "user_input"),
        "top_n": (_extract_number(text, [r"前\s*(\d+)\s*名", r"选前\s*(\d+)\s*名"]), "user_input"),
        "weighting_method": (weighting_method, "user_input" if weighting_method else "system_default"),
        "rebalance_anchor_dates": (anchors, "user_input" if anchors else "system_default"),
    }
    return top_level, parameters


def _extract_momentum_payload_v2(text: str) -> tuple[dict[str, Any], dict[str, Any]]:
    universe_name, universe_source, _ = detect_universe(text)
    lowered = text.lower()

    def infer_benchmark() -> tuple[str, str]:
        normalized = str(universe_name or "").strip().upper()
        if normalized in {"SPY", "QQQ"}:
            return normalized, "system_inference"
        if "标普" in str(universe_name or "") or "SP500" in normalized or "S&P" in normalized:
            return "SPY", "system_inference"
        if "纳指" in str(universe_name or "") or "纳斯达克" in str(universe_name or "") or "NASDAQ" in normalized:
            return "QQQ", "system_inference"
        return "SPY", "system_default"

    explicit_name = None
    for line in [segment.strip() for segment in text.splitlines() if segment.strip()]:
        if "策略" in line:
            explicit_name = line
            break

    lookback_months = _extract_number(
        text,
        [
            r"前\s*(\d+)\s*个月\s*[-到至]\s*前\s*\d+\s*个月",
            r"过去\s*(\d+)\s*个月",
            r"回看\s*(\d+)\s*个月",
        ],
    )
    skip_recent_months = _extract_number(
        text,
        [
            r"前\d+\s*个月\s*[-到至]\s*前\s*(\d+)\s*个月",
            r"移除最近\s*(\d+)\s*个月",
            r"跳过最近\s*(\d+)\s*个月",
            r"前\d+\s*个月[^\n，。；]*前\s*(\d+)\s*个月",
        ],
    )
    top_n = _extract_number(text, [r"排行前\s*(\d+)\s*名", r"排名前\s*(\d+)\s*名", r"前\s*(\d+)\s*名"])
    hold_rank_threshold = _extract_number(
        text,
        [
            r"若不在前\s*(\d+)\s*名",
            r"不在前\s*(\d+)\s*名",
            r"跌出前\s*(\d+)\s*名",
            r"移除持仓[^\n，。；]*前\s*(\d+)\s*名",
        ],
    )
    capital = _extract_numeric(text, [r"初始(?:资金|本金)?\s*(\d+(?:\.\d+)?)", r"本金\s*(\d+(?:\.\d+)?)"])
    weighting_method = (
        "equal_weight"
        if "等权" in text or "均分仓位" in text or "均分持仓" in text or "按数量均分" in text or "equal weight" in lowered or "equal_weight" in lowered
        else None
    )
    frequency = (
        "semiannual"
        if "每半年" in text or "半年一次" in text or "每半年1次" in text or "semiannual" in lowered or "semi-annual" in lowered
        else None
    )
    frequency_source = "user_input" if frequency else "system_default"
    if not frequency:
        frequency, frequency_source = _extract_frequency_value(text, default=None)

    anchor_labels: list[str] = []
    if re.search(r"1月第\s*1\s*个交易日|1月第一个交易日", text):
        anchor_labels.append("每年01月第1个交易日")
    if re.search(r"7月第\s*1\s*个交易日|7月第一个交易日", text):
        anchor_labels.append("07月第1个交易日")
    anchors = "；".join(anchor_labels) if anchor_labels else _extract_anchor_dates(text)
    if anchors and not frequency:
        frequency, frequency_source = "semiannual", "user_input"

    benchmark_symbol, benchmark_source = infer_benchmark()

    if explicit_name:
        strategy_name = explicit_name
    elif "标普" in str(universe_name or ""):
        strategy_name = "标普动量策略"
    elif "纳指" in str(universe_name or "") or "纳斯达克" in str(universe_name or ""):
        strategy_name = "纳指动量策略"
    elif universe_name:
        strategy_name = f"{universe_name} 动量策略"
    else:
        strategy_name = None

    description_bits: list[str] = []
    if universe_name:
        description_bits.append(f"在{universe_name}内做横截面动量轮动")
    else:
        description_bits.append("做横截面动量轮动")
    if frequency == "semiannual" and anchors:
        description_bits.append(f"每半年按{anchors}调仓")
    elif anchors:
        description_bits.append(f"按{anchors}调仓")
    elif frequency:
        description_bits.append(f"按{frequency}调仓")
    if lookback_months is not None:
        if skip_recent_months is not None:
            description_bits.append(f"按前{lookback_months}个月剔除最近{skip_recent_months}个月收益排序")
        else:
            description_bits.append(f"按前{lookback_months}个月收益排序")
    if top_n is not None:
        description_bits.append(f"买入或保留前{top_n}名")
    if hold_rank_threshold is not None:
        description_bits.append(f"跌出前{hold_rank_threshold}名移除")
    if weighting_method == "equal_weight":
        description_bits.append("持仓按数量等权分配")
    if capital is not None:
        description_bits.append(f"初始资金{_format_extracted_value(capital)}USD")
    strategy_description = "，".join(description_bits) + "。" if description_bits else None

    top_level = {
        "strategy_type": ("MOMENTUM", "user_input"),
        "universe_name": (universe_name, universe_source or "system_default"),
        "rebalance_frequency": (frequency, frequency_source),
    }
    parameters = {
        "strategy_name": (strategy_name, "user_input" if explicit_name else "system_inference"),
        "strategy_description": (strategy_description, "system_inference"),
        "benchmark_symbol": (benchmark_symbol, benchmark_source),
        "lookback_months": (lookback_months, "user_input"),
        "skip_recent_months": (skip_recent_months, "user_input"),
        "top_n": (top_n, "user_input"),
        "hold_rank_threshold": (hold_rank_threshold, "user_input"),
        "weighting_method": (weighting_method, "user_input" if weighting_method else "system_default"),
        "rebalance_anchor_dates": (anchors, "user_input" if anchors else "system_default"),
        "capital": (capital, "user_input"),
    }
    return top_level, parameters


def _extract_buy_and_hold_payload(text: str) -> tuple[dict[str, Any], dict[str, Any]]:
    universe_name, universe_source, _ = detect_universe(text)
    contribution_amount = _extract_numeric(
        text,
        [
            r"(?:每月|每周|每日|每天|每季|季度|每年)[^，。\n]*买入(?:[A-Za-z]{1,10})?\s*(\d+(?:\.\d+)?)\s*(?:USD|usd|美元|元)?",
            r"定投\s*(\d+(?:\.\d+)?)\s*(?:USD|usd|美元|元)?",
            r"买入(?:[A-Za-z]{1,10})?\s*(\d+(?:\.\d+)?)\s*(?:USD|usd|美元|元)",
        ],
    )
    investment_frequency, frequency_source = _extract_frequency_value(text, default="monthly")
    contribution_anchor = _extract_buy_and_hold_anchor(text, investment_frequency)
    dynamic_investment_logic = _extract_dynamic_buy_and_hold_logic(text, universe_name)
    benchmark_symbol, benchmark_source = _infer_benchmark_symbol(universe_name)
    strategy_name = _build_buy_and_hold_strategy_name(
        universe_name,
        investment_frequency,
        dynamic_investment_logic=dynamic_investment_logic,
    )
    strategy_description = _build_buy_and_hold_strategy_description(
        text=text,
        universe_name=universe_name,
        contribution_amount=contribution_amount,
        investment_frequency=investment_frequency,
        contribution_anchor=contribution_anchor,
        dynamic_investment_logic=dynamic_investment_logic,
    )

    top_level = {
        "strategy_type": ("BUY_AND_HOLD", "user_input"),
        "universe_name": (universe_name, universe_source or "system_default"),
        "rebalance_frequency": ("never", "system_default"),
    }
    parameters = {
        "strategy_name": (strategy_name, "system_inference"),
        "strategy_description": (strategy_description, "system_inference"),
        "benchmark_symbol": (benchmark_symbol, benchmark_source),
        "contribution_amount": (contribution_amount, "user_input"),
        "investment_frequency": (investment_frequency, frequency_source),
        "contribution_anchor": (contribution_anchor, "user_input" if contribution_anchor else "system_default"),
        "dynamic_investment_logic": (
            dynamic_investment_logic,
            "system_inference" if dynamic_investment_logic else "system_default",
        ),
        "dynamic_investment_proxy_key": (
            DYNAMIC_BUY_AND_HOLD_PROXY_KEY if dynamic_investment_logic else None,
            "system_inference" if dynamic_investment_logic else "system_default",
        ),
        "dynamic_investment_metric_key": (
            DYNAMIC_BUY_AND_HOLD_METRIC_KEY if dynamic_investment_logic else None,
            "system_inference" if dynamic_investment_logic else "system_default",
        ),
        "dynamic_investment_rules": (
            list(DYNAMIC_BUY_AND_HOLD_RULES) if dynamic_investment_logic else None,
            "system_inference" if dynamic_investment_logic else "system_default",
        ),
    }
    return top_level, parameters


def _extract_mean_reversion_payload(text: str) -> tuple[dict[str, Any], dict[str, Any]]:
    universe_name, universe_source, _ = detect_universe(text)
    benchmark_symbol, benchmark_source = _infer_benchmark_symbol(universe_name)
    rebalance_frequency, rebalance_source = _extract_frequency_value(text, default="never")
    observation_timeframe, observation_timeframe_source = _extract_mean_reversion_timeframe(text)
    bollinger_period = _extract_number(
        text,
        [
            r"(\d+)\s*日布林带",
            r"(\d+)\s*周期\s*布林带",
            r"布林带\s*\(?\s*(\d+)\s*\)?",
        ],
    )
    rsi_period = _extract_number(
        text,
        [
            r"RSI\s*\(\s*(\d+)\s*\)",
            r"(\d+)\s*周期\s*RSI",
            r"RSI\s*(\d+)",
        ],
    )
    rsi_buy_threshold = _extract_numeric(
        text,
        [
            r"RSI\s*\(\s*\d+\s*\)\s*[＜<]\s*(-?\d+(?:\.\d+)?)",
            r"RSI\s*\(\s*\d+\s*\)\s*小于\s*(-?\d+(?:\.\d+)?)",
        ],
    )
    rsi_sell_threshold = _extract_numeric(
        text,
        [
            r"RSI\s*\(\s*\d+\s*\)\s*[＞>]\s*(-?\d+(?:\.\d+)?)",
            r"RSI\s*\(\s*\d+\s*\)\s*大于\s*(-?\d+(?:\.\d+)?)",
        ],
    )
    atr_period = _extract_number(
        text,
        [
            r"(\d+)\s*周期\s*ATR",
            r"ATR\s*\(\s*(\d+)\s*\)",
            r"ATR\s*(\d+)",
        ],
    )
    take_profit_atr = _extract_numeric(
        text,
        [
            r"盈利达到\s*(-?\d+(?:\.\d+)?)\s*倍\s*ATR",
            r"止盈(?:达到|为)?\s*(-?\d+(?:\.\d+)?)\s*倍\s*ATR",
        ],
    )
    stop_loss_atr = _extract_numeric(
        text,
        [
            r"亏损达到\s*(-?\d+(?:\.\d+)?)\s*倍\s*ATR",
            r"止损(?:达到|为)?\s*(-?\d+(?:\.\d+)?)\s*倍\s*ATR",
        ],
    )
    long_entry_size_pct = _extract_numeric(
        text,
        [
            r"跌破布林带下轨[^\n，。；;]*?买入\s*(-?\d+(?:\.\d+)?)%",
            r"RSI\s*\(\s*\d+\s*\)\s*[＜<]\s*-?\d+(?:\.\d+)?[^\n，。；;]*?买入\s*(-?\d+(?:\.\d+)?)%",
        ],
    )
    short_entry_size_pct = _extract_numeric(
        text,
        [
            r"突破布林带上轨[^\n，。；;]*?卖出\s*(-?\d+(?:\.\d+)?)%",
            r"RSI\s*\(\s*\d+\s*\)\s*[＞>]\s*-?\d+(?:\.\d+)?[^\n，。；;]*?卖出\s*(-?\d+(?:\.\d+)?)%",
        ],
    )
    capital = _extract_numeric(
        text,
        [
            r"初始(?:资金|本金)?\s*(\d+(?:\.\d+)?)\s*(?:USD|usd|美元|刀)?",
            r"本金\s*(\d+(?:\.\d+)?)",
        ],
    )
    strategy_name, strategy_name_source = _extract_mean_reversion_strategy_name(text, universe_name)
    logic_bits: list[str] = []
    if universe_name or observation_timeframe:
        timeframe_label = {
            "daily": "日线",
            "weekly": "周线",
            "monthly": "月线",
        }.get(str(observation_timeframe or "").lower(), "")
        target = f"{universe_name}{timeframe_label}" if universe_name and timeframe_label else universe_name or timeframe_label or "目标标的"
        logic_bits.append(f"观察{target}")
    indicator_bits: list[str] = []
    if bollinger_period is not None:
        indicator_bits.append(f"{bollinger_period}日布林带")
    if rsi_period is not None:
        indicator_bits.append(f"RSI({rsi_period})")
    if indicator_bits:
        logic_bits.append(f"使用{' + '.join(indicator_bits)}识别超买超卖")
    if atr_period is not None:
        logic_bits.append(f"结合ATR({atr_period})动态止盈止损")
    if long_entry_size_pct is not None:
        trigger = "跌破布林带下轨"
        if rsi_period is not None and rsi_buy_threshold is not None:
            trigger += f"且RSI({rsi_period})<{_format_extracted_value(rsi_buy_threshold)}"
        logic_bits.append(f"空仓时{trigger}买入{_format_extracted_value(long_entry_size_pct)}%")
    if short_entry_size_pct is not None:
        trigger = "突破布林带上轨"
        if rsi_period is not None and rsi_sell_threshold is not None:
            trigger += f"且RSI({rsi_period})>{_format_extracted_value(rsi_sell_threshold)}"
        logic_bits.append(f"空仓时{trigger}卖出{_format_extracted_value(short_entry_size_pct)}%")
    if take_profit_atr is not None or stop_loss_atr is not None:
        exits: list[str] = []
        if take_profit_atr is not None:
            exits.append(f"{_format_extracted_value(take_profit_atr)}倍ATR止盈")
        if stop_loss_atr is not None:
            exits.append(f"{_format_extracted_value(stop_loss_atr)}倍ATR止损")
        logic_bits.append("，".join(exits))
    trading_logic = "；".join(logic_bits) if logic_bits else (text.strip()[:160] or None)
    strategy_description = _build_mean_reversion_strategy_description(
        text=text,
        universe_name=universe_name,
        observation_timeframe=observation_timeframe,
        bollinger_period=bollinger_period,
        rsi_period=rsi_period,
        rsi_buy_threshold=rsi_buy_threshold,
        rsi_sell_threshold=rsi_sell_threshold,
        atr_period=atr_period,
        take_profit_atr=take_profit_atr,
        stop_loss_atr=stop_loss_atr,
        long_entry_size_pct=long_entry_size_pct,
        short_entry_size_pct=short_entry_size_pct,
    )

    top_level = {
        "strategy_type": ("MEAN_REVERSION", "user_input"),
        "universe_name": (universe_name, universe_source or "system_default"),
        "rebalance_frequency": (rebalance_frequency, rebalance_source),
    }
    parameters = {
        "strategy_name": (strategy_name, strategy_name_source),
        "strategy_description": (strategy_description, "system_inference"),
        "benchmark_symbol": (benchmark_symbol, benchmark_source),
        "observation_timeframe": (observation_timeframe, observation_timeframe_source),
        "trading_logic": (trading_logic, "system_inference" if logic_bits else "user_input" if trading_logic else "system_default"),
        "bollinger_period": (bollinger_period, "user_input"),
        "rsi_period": (rsi_period, "user_input"),
        "rsi_buy_threshold": (rsi_buy_threshold, "user_input"),
        "rsi_sell_threshold": (rsi_sell_threshold, "user_input"),
        "atr_period": (atr_period, "user_input"),
        "take_profit_atr": (take_profit_atr, "user_input"),
        "stop_loss_atr": (stop_loss_atr, "user_input"),
        "long_entry_size_pct": (long_entry_size_pct, "user_input"),
        "short_entry_size_pct": (short_entry_size_pct, "user_input"),
        "capital": (capital, "user_input"),
    }
    return top_level, parameters


def _extract_mean_reversion_payload(text: str) -> tuple[dict[str, Any], dict[str, Any]]:
    universe_name, universe_source, _ = detect_universe(text)
    universe_name = str(universe_name or "").strip() or None
    benchmark_symbol, benchmark_source = _infer_benchmark_symbol(universe_name) if universe_name else (None, "system_default")
    rebalance_frequency, rebalance_source = _extract_frequency_value(text, default="never")
    observation_timeframe, observation_timeframe_source = _extract_mean_reversion_timeframe(text)
    bollinger_period = _extract_number(
        text,
        [
            r"(\d+)\s*日布林带",
            r"(\d+)\s*周期\s*布林带",
            r"布林带\s*\(?\s*(\d+)\s*\)?",
        ],
    )
    rsi_period = _extract_number(
        text,
        [
            r"RSI\s*\(\s*(\d+)\s*\)",
            r"(\d+)\s*周期\s*RSI",
            r"RSI\s*(\d+)",
        ],
    )
    rsi_buy_threshold = _extract_numeric(
        text,
        [
            r"RSI\s*\(\s*\d+\s*\)\s*[<＜]\s*(-?\d+(?:\.\d+)?)",
            r"RSI\s*\(\s*\d+\s*\)\s*低于\s*(-?\d+(?:\.\d+)?)",
        ],
    )
    rsi_sell_threshold = _extract_numeric(
        text,
        [
            r"RSI\s*\(\s*\d+\s*\)\s*[>＞]\s*(-?\d+(?:\.\d+)?)",
            r"RSI\s*\(\s*\d+\s*\)\s*高于\s*(-?\d+(?:\.\d+)?)",
        ],
    )
    atr_period = _extract_number(
        text,
        [
            r"(\d+)\s*周期\s*ATR",
            r"ATR\s*\(\s*(\d+)\s*\)",
            r"ATR\s*(\d+)",
        ],
    )
    take_profit_atr = _extract_numeric(
        text,
        [
            r"止盈(?:达到)?\s*(-?\d+(?:\.\d+)?)\s*倍\s*ATR",
            r"盈利达到\s*(-?\d+(?:\.\d+)?)\s*倍\s*ATR",
        ],
    )
    stop_loss_atr = _extract_numeric(
        text,
        [
            r"止损(?:达到)?\s*(-?\d+(?:\.\d+)?)\s*倍\s*ATR",
            r"亏损达到\s*(-?\d+(?:\.\d+)?)\s*倍\s*ATR",
        ],
    )
    shared_entry_size_pct = _extract_numeric(
        text,
        [
            r"买入仓位和卖出仓位(?:都)?改(?:成|为)\s*(-?\d+(?:\.\d+)?)%",
            r"买入和卖出仓位(?:都)?改(?:成|为)\s*(-?\d+(?:\.\d+)?)%",
            r"仓位(?:都)?改(?:成|为)\s*(-?\d+(?:\.\d+)?)%",
        ],
    )
    long_entry_size_pct = shared_entry_size_pct if shared_entry_size_pct is not None else _extract_numeric(
        text,
        [
            r"跌破布林带下轨[^\n，。；;]*?买入\s*(-?\d+(?:\.\d+)?)%",
            r"RSI\s*\(\s*\d+\s*\)\s*[<＜]\s*-?\d+(?:\.\d+)?[^\n，。；;]*?买入\s*(-?\d+(?:\.\d+)?)%",
            r"买入仓位(?:都)?改(?:成|为)\s*(-?\d+(?:\.\d+)?)%",
            r"买入(?:仓位)?调整(?:到|为)?\s*(-?\d+(?:\.\d+)?)%",
        ],
    )
    short_entry_size_pct = shared_entry_size_pct if shared_entry_size_pct is not None else _extract_numeric(
        text,
        [
            r"突破布林带上轨[^\n，。；;]*?卖出\s*(-?\d+(?:\.\d+)?)%",
            r"RSI\s*\(\s*\d+\s*\)\s*[>＞]\s*-?\d+(?:\.\d+)?[^\n，。；;]*?卖出\s*(-?\d+(?:\.\d+)?)%",
            r"卖出仓位(?:都)?改(?:成|为)\s*(-?\d+(?:\.\d+)?)%",
            r"卖出(?:仓位)?调整(?:到|为)?\s*(-?\d+(?:\.\d+)?)%",
        ],
    )
    capital = _extract_numeric(
        text,
        [
            r"初始(?:资金|本金)?\s*(\d+(?:\.\d+)?)\s*(?:USD|usd|刀|元)?",
            r"本金\s*(\d+(?:\.\d+)?)",
        ],
    )
    strategy_name, strategy_name_source = _extract_mean_reversion_strategy_name(text, universe_name or "")
    patch_message = bool(re.search(r"(改成|改为|调整|修改)", text))
    trading_logic = None if patch_message else _build_mean_reversion_trading_logic_summary(
        universe_name=universe_name or "",
        observation_timeframe=observation_timeframe,
        bollinger_period=bollinger_period,
        rsi_period=rsi_period,
        rsi_buy_threshold=rsi_buy_threshold,
        rsi_sell_threshold=rsi_sell_threshold,
        atr_period=atr_period,
        take_profit_atr=take_profit_atr,
        stop_loss_atr=stop_loss_atr,
        long_entry_size_pct=long_entry_size_pct,
        short_entry_size_pct=short_entry_size_pct,
    )
    strategy_description = None if patch_message else _build_mean_reversion_strategy_description(
        text=text,
        universe_name=universe_name or "",
        observation_timeframe=observation_timeframe,
        bollinger_period=bollinger_period,
        rsi_period=rsi_period,
        rsi_buy_threshold=rsi_buy_threshold,
        rsi_sell_threshold=rsi_sell_threshold,
        atr_period=atr_period,
        take_profit_atr=take_profit_atr,
        stop_loss_atr=stop_loss_atr,
        long_entry_size_pct=long_entry_size_pct,
        short_entry_size_pct=short_entry_size_pct,
    )

    top_level = {
        "strategy_type": ("MEAN_REVERSION", "user_input"),
        "universe_name": (universe_name, universe_source or "system_default"),
        "rebalance_frequency": (rebalance_frequency, rebalance_source),
    }
    parameters = {
        "strategy_name": (strategy_name, strategy_name_source),
        "strategy_description": (strategy_description, "system_inference"),
        "benchmark_symbol": (benchmark_symbol, benchmark_source),
        "observation_timeframe": (observation_timeframe, observation_timeframe_source),
        "trading_logic": (trading_logic, "system_inference" if trading_logic else "system_default"),
        "bollinger_period": (bollinger_period, "user_input"),
        "rsi_period": (rsi_period, "user_input"),
        "rsi_buy_threshold": (rsi_buy_threshold, "user_input"),
        "rsi_sell_threshold": (rsi_sell_threshold, "user_input"),
        "atr_period": (atr_period, "user_input"),
        "take_profit_atr": (take_profit_atr, "user_input"),
        "stop_loss_atr": (stop_loss_atr, "user_input"),
        "long_entry_size_pct": (long_entry_size_pct, "user_input"),
        "short_entry_size_pct": (short_entry_size_pct, "user_input"),
        "capital": (capital, "user_input"),
    }
    return top_level, parameters


def _set_value(
    entries: list[dict[str, Any]],
    key: str,
    ai_value: Any,
    ai_source: str,
    manual_conflicts: list[dict[str, Any]],
) -> None:
    for entry in entries:
        if entry["key"] != key:
            continue
        current_value = entry.get("value")
        current_source = entry.get("source") or "system_default"
        if current_source == "manual_override" and ai_value is not None and current_value != ai_value:
            manual_conflicts.append(
                {"key": key, "manual_value": current_value, "ai_value": ai_value, "reason": "manual_override_preserved"}
            )
            return
        if ai_value is not None:
            entry["value"] = ai_value
            entry["source"] = ai_source
        return
    entries.append({"key": key, "label": confirmation_field_label(key, key), "value": ai_value, "source": ai_source})


def _entry_value(entries: Sequence[Mapping[str, Any]], key: str) -> Any:
    for entry in entries:
        if entry.get("key") == key:
            return entry.get("value")
    return None


def _entry_label(entries: Sequence[Mapping[str, Any]], key: str, fallback: str | None = None) -> str:
    for entry in entries:
        if entry.get("key") == key:
            return str(entry.get("label") or confirmation_field_label(key, fallback or key))
    return confirmation_field_label(key, fallback or key)


def _default_strategy_name(top_level: Mapping[str, Any]) -> str:
    universe_name = str(top_level.get("universe_name") or "").strip()
    strategy_type = str(top_level.get("strategy_type") or "GENERAL").upper()
    title = STRATEGY_TYPE_TITLES.get(strategy_type, "策略")
    return f"{universe_name} {title}".strip() if universe_name else title


def _set_system_default(entries: list[dict[str, Any]], key: str, label: str, value: Any) -> None:
    for entry in entries:
        if entry.get("key") != key:
            continue
        entry["label"] = label
        current_source = str(entry.get("source") or "system_default")
        current_value = entry.get("value")
        if current_source == "manual_override":
            return
        if current_source == "user_input" and current_value not in (None, "", []):
            return
        if current_value in (None, "", []) or current_source == "system_default":
            entry["value"] = value
            entry["source"] = "system_default"
        return
    entries.append({"key": key, "label": label, "value": value, "source": "system_default"})


def _normalize_existing(existing: Mapping[str, Any] | None, strategy_type: str) -> dict[str, list[dict[str, Any]]]:
    if not existing:
        return blank_confirmation_fields(strategy_type)
    normalized = {
        "top_level": [dict(item) for item in existing.get("top_level", [])],
        "parameters": [dict(item) for item in existing.get("parameters", [])],
    }
    defaults = blank_confirmation_fields(strategy_type)
    existing_top_keys = {item["key"] for item in normalized["top_level"]}
    existing_param_keys = {item["key"] for item in normalized["parameters"]}
    for entry in defaults["top_level"]:
        for current in normalized["top_level"]:
            if current["key"] == entry["key"]:
                current["label"] = entry["label"]
        if entry["key"] not in existing_top_keys:
            normalized["top_level"].append(entry)
    for entry in defaults["parameters"]:
        for current in normalized["parameters"]:
            if current["key"] == entry["key"]:
                current["label"] = entry["label"]
        if entry["key"] not in existing_param_keys:
            normalized["parameters"].append(entry)
    return normalized


def _normalize_manual_conflicts(
    manual_conflicts: Sequence[Mapping[str, Any]],
    confirmation_fields: Mapping[str, Any],
) -> list[dict[str, Any]]:
    parameter_entries = list(confirmation_fields.get("parameters", []))
    top_level_entries = list(confirmation_fields.get("top_level", []))
    normalized: list[dict[str, Any]] = []
    for item in manual_conflicts:
        key = str(item.get("key") or "")
        label = _entry_label(parameter_entries, key, None)
        if label == key:
            label = _entry_label(top_level_entries, key, key)
        ai_value = item.get("ai_value")
        normalized.append(
            {
                "key": key,
                "label": label,
                "message": f"{label} 已保留人工修正值",
                "suggested_value": ai_value,
                "manual_value": item.get("manual_value"),
                "ai_value": ai_value,
                "reason": item.get("reason"),
            }
        )
    return normalized


def build_confirmation(
    messages: Sequence[Mapping[str, Any]] | str,
    *,
    existing: Mapping[str, Any] | None = None,
    forced_type: str | None = None,
) -> dict[str, Any]:
    text = _messages_to_text(messages)
    strategy_type = _detect_strategy_type(text, forced_type)
    confirmation_fields = _normalize_existing(existing, strategy_type)
    manual_conflicts: list[dict[str, Any]] = []

    if not text.strip() and existing is not None:
        top_level_payload = {
            "strategy_type": (strategy_type, "system_default"),
        }
        parameter_payload = {}
    elif strategy_type == "GRID":
        top_level_payload, parameter_payload = _extract_grid_payload(text)
    elif strategy_type == "MOMENTUM":
        top_level_payload, parameter_payload = _extract_momentum_payload_v2(text)
    elif strategy_type == "MEAN_REVERSION":
        top_level_payload, parameter_payload = _extract_mean_reversion_payload(text)
    elif strategy_type == "BUY_AND_HOLD":
        top_level_payload, parameter_payload = _extract_buy_and_hold_payload(text)
    else:
        universe_name, universe_source, _ = detect_universe(text)
        top_level_payload = {
            "strategy_type": (strategy_type, "system_default"),
            "universe_name": (universe_name, universe_source or "system_default"),
            "rebalance_frequency": (None, "system_default"),
        }
        parameter_payload = {}

    for key, (value, source) in top_level_payload.items():
        _set_value(confirmation_fields["top_level"], key, value, source, manual_conflicts)
    for key, (value, source) in parameter_payload.items():
        _set_value(confirmation_fields["parameters"], key, value, source, manual_conflicts)

    top_level = {
        "strategy_type": _entry_value(confirmation_fields["top_level"], "strategy_type") or strategy_type,
        "universe_name": _entry_value(confirmation_fields["top_level"], "universe_name") or "",
        "rebalance_frequency": _entry_value(confirmation_fields["top_level"], "rebalance_frequency"),
    }

    if strategy_type == "GRID":
        _set_system_default(
            confirmation_fields["parameters"],
            "strategy_name",
            "策略名称",
            _default_strategy_name(top_level),
        )
        _set_system_default(
            confirmation_fields["parameters"],
            "benchmark_symbol",
            "基准",
            "SPY",
        )
        _set_system_default(
            confirmation_fields["top_level"],
            "rebalance_frequency",
            "再平衡频次",
            "never",
        )
        top_level["rebalance_frequency"] = _entry_value(confirmation_fields["top_level"], "rebalance_frequency")
    elif strategy_type == "BUY_AND_HOLD":
        _set_system_default(
            confirmation_fields["parameters"],
            "strategy_name",
            "策略名称",
            _build_buy_and_hold_strategy_name(
                str(top_level.get("universe_name") or "").strip(),
                _entry_value(confirmation_fields["parameters"], "investment_frequency") or "monthly",
            )
            or _default_strategy_name(top_level),
        )
        benchmark_symbol, _ = _infer_benchmark_symbol(str(top_level.get("universe_name") or "").strip())
        _set_system_default(
            confirmation_fields["parameters"],
            "benchmark_symbol",
            "基准",
            benchmark_symbol,
        )
        _set_system_default(
            confirmation_fields["parameters"],
            "investment_frequency",
            "定投频率",
            "monthly",
        )
        _set_system_default(
            confirmation_fields["top_level"],
            "rebalance_frequency",
            "再平衡频次",
            "never",
        )
        top_level["rebalance_frequency"] = _entry_value(confirmation_fields["top_level"], "rebalance_frequency")
    elif strategy_type == "MEAN_REVERSION":
        _set_system_default(
            confirmation_fields["parameters"],
            "strategy_name",
            "策略名称",
            _default_strategy_name(top_level),
        )
        benchmark_symbol, _ = _infer_benchmark_symbol(str(top_level.get("universe_name") or "").strip())
        _set_system_default(
            confirmation_fields["parameters"],
            "benchmark_symbol",
            "基准",
            benchmark_symbol,
        )
        _set_system_default(
            confirmation_fields["top_level"],
            "rebalance_frequency",
            "再平衡频次",
            "never",
        )
        top_level["rebalance_frequency"] = _entry_value(confirmation_fields["top_level"], "rebalance_frequency")

    required_keys = {
        "GRID": [
            "universe_name",
            "strategy_name",
            "strategy_description",
            "initial_position",
            "grid_interval",
            "buy_size_pct",
            "sell_step_pct",
            "sell_size_pct",
            "max_stop_loss_pct",
        ],
        "MOMENTUM": [
            "universe_name",
            "strategy_name",
            "strategy_description",
            "benchmark_symbol",
            "lookback_months",
            "skip_recent_months",
            "top_n",
            "hold_rank_threshold",
            "weighting_method",
            "rebalance_anchor_dates",
            "capital",
        ],
        "MEAN_REVERSION": [
            "universe_name",
            "strategy_name",
            "strategy_description",
            "benchmark_symbol",
            "observation_timeframe",
            "trading_logic",
            "bollinger_period",
            "rsi_period",
            "rsi_buy_threshold",
            "rsi_sell_threshold",
            "atr_period",
            "take_profit_atr",
            "stop_loss_atr",
            "long_entry_size_pct",
            "short_entry_size_pct",
        ],
        "BUY_AND_HOLD": [
            "universe_name",
            "strategy_name",
            "strategy_description",
            "benchmark_symbol",
            "contribution_amount",
            "investment_frequency",
        ],
        "GENERAL": ["universe_name"],
    }
    pending_inputs: list[dict[str, Any]] = []
    for key in required_keys.get(strategy_type, []):
        if key == "universe_name":
            if not top_level.get("universe_name"):
                pending_inputs.append({"key": key, "label": "股票池", "message": "请补充股票池"})
            continue
        if _entry_value(confirmation_fields["parameters"], key) in (None, "", []):
            label = _entry_label(confirmation_fields["parameters"], key, key)
            pending_inputs.append({"key": key, "label": label, "message": f"请补充{label}"})

    manual_conflicts = _normalize_manual_conflicts(manual_conflicts, confirmation_fields)

    return {
        "top_level": top_level,
        "confirmation_fields": confirmation_fields,
        "pending_inputs": pending_inputs,
        "manual_conflicts": manual_conflicts,
    }


def merge_manual_overrides(parameters: Mapping[str, Any], manual_overrides: Mapping[str, Any] | None) -> dict[str, Any]:
    merged = dict(parameters)
    for key, value in (manual_overrides or {}).items():
        if value is not None:
            merged[key] = value
    return merged


def _flatten_parameters(confirmation_fields: Mapping[str, Any]) -> dict[str, Any]:
    flat: dict[str, Any] = {}
    for entry in confirmation_fields.get("parameters", []):
        flat[str(entry.get("key"))] = entry.get("value")
    return flat


def refresh_creation_state(
    prompt: str,
    *,
    previous_state: Mapping[str, Any] | None = None,
    template_key: str | None = None,
) -> dict[str, Any]:
    previous_state = dict(previous_state or {})
    existing = previous_state.get("confirmation_fields")
    payload = build_confirmation(prompt, existing=existing, forced_type=template_key or previous_state.get("strategy_type"))
    revision = int(previous_state.get("revision") or previous_state.get("parameter_revision") or 0) + 1
    return {
        "prompt": prompt,
        "summary": STRATEGY_TEMPLATES.get(payload["top_level"]["strategy_type"], STRATEGY_TEMPLATES["GENERAL"]).description,
        "template_key": payload["top_level"]["strategy_type"],
        "selected_template_key": payload["top_level"]["strategy_type"],
        "strategy_type": payload["top_level"]["strategy_type"],
        "suggested_name": f'{payload["top_level"].get("universe_name") or "Draft"} {payload["top_level"]["strategy_type"]}',
        "parameter_revision": revision,
        "revision": revision,
        "parameters": _flatten_parameters(payload["confirmation_fields"]),
        "normalized_parameters": _flatten_parameters(payload["confirmation_fields"]),
        "manual_overrides": {},
        "field_errors": {},
        "allowed_actions": list(DEFAULT_ALLOWED_ACTIONS),
        "artifacts": {"templates": template_catalog(), "confirmation": payload},
        "confirmation_fields": payload["confirmation_fields"],
        "pending_inputs": payload["pending_inputs"],
        "manual_conflicts": payload["manual_conflicts"],
        "universe_name": payload["top_level"].get("universe_name"),
        "rebalance_frequency": payload["top_level"].get("rebalance_frequency"),
    }


def repair_creation_session(session: Mapping[str, Any]) -> dict[str, Any]:
    repaired = dict(session)
    confirmation_fields = repaired.get("confirmation_fields") or blank_confirmation_fields(repaired.get("strategy_type", "GENERAL"))
    repaired.setdefault("status", "DRAFTING")
    repaired.setdefault("strategy_type", "GENERAL")
    repaired.setdefault("confirmation_fields", confirmation_fields)
    repaired.setdefault("pending_inputs", [])
    repaired.setdefault("manual_conflicts", [])
    repaired.setdefault("allowed_actions", list(DEFAULT_ALLOWED_ACTIONS))
    return repaired


extract_template_parameters = refresh_creation_state
refresh_creation_session_state = refresh_creation_state

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


STRATEGY_TEMPLATES: dict[str, StrategyTemplate] = {
    "GENERAL": StrategyTemplate(
        key="GENERAL",
        name="General Strategy",
        description="Free-form drafting workspace before a concrete template is inferred.",
        prompt_hints=("策略",),
        top_level_defaults={"strategy_type": "GENERAL", "universe_name": "", "rebalance_frequency": None},
        parameter_defaults={},
    ),
    "GRID": StrategyTemplate(
        key="GRID",
        name="Grid Strategy",
        description="Grid accumulation / trim strategy around a single target symbol.",
        prompt_hints=("网格", "grid"),
        top_level_defaults={"strategy_type": "GRID", "universe_name": "", "rebalance_frequency": None},
        parameter_defaults={
            "initial_position": None,
            "grid_interval": None,
            "buy_size_pct": None,
            "sell_step_pct": None,
            "sell_size_pct": None,
            "capital": None,
        },
        fields=[
            TemplateField("initial_position", "初始买入(%)", "number"),
            TemplateField("grid_interval", "每跌间距(%)", "number"),
            TemplateField("buy_size_pct", "每次加仓(%)", "number"),
            TemplateField("sell_step_pct", "每涨步长(%)", "number"),
            TemplateField("sell_size_pct", "每次减仓(%)", "number"),
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
            "lookback_months": None,
            "skip_recent_months": None,
            "top_n": None,
            "weighting_method": None,
            "rebalance_anchor_dates": None,
        },
        fields=[
            TemplateField("lookback_months", "回看(月)", "integer"),
            TemplateField("skip_recent_months", "跳过最近(月)", "integer"),
            TemplateField("top_n", "选股数量", "integer"),
            TemplateField("weighting_method", "权重方法", "string"),
            TemplateField("rebalance_anchor_dates", "调仓锚点", "string"),
        ],
    ),
}


TEMPLATE_REGISTRY = STRATEGY_TEMPLATES


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
        _field("标的范围", "universe_name", template.top_level_defaults.get("universe_name"), "system_default"),
        _field("调仓频率", "rebalance_frequency", template.top_level_defaults.get("rebalance_frequency"), "system_default"),
    ]
    parameters = [
        _field(field.label, field.key, template.parameter_defaults.get(field.key), "system_default")
        for field in template.fields
    ]
    return {"top_level": top_level, "parameters": parameters}


def _extract_number(text: str, patterns: Sequence[str]) -> int | None:
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return int(match.group(1))
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
    if "网格" in text or "grid" in lowered:
        return "GRID"
    if "动量" in text or "momentum" in lowered:
        return "MOMENTUM"
    return forced_type.upper() if forced_type else "GENERAL"


def _extract_grid_payload(text: str) -> tuple[dict[str, Any], dict[str, Any]]:
    universe_name, universe_source, _ = detect_universe(text)
    top_level = {
        "strategy_type": ("GRID", "user_input"),
        "universe_name": (universe_name, universe_source or "system_default"),
        "rebalance_frequency": (None, "system_default"),
    }
    parameters = {
        "initial_position": (_extract_number(text, [r"初始买入\s*(\d+)%", r"初始仓位\s*(\d+)%"]), "user_input"),
        "grid_interval": (_extract_number(text, [r"每跌\s*(\d+)%", r"下跌\s*(\d+)%"]), "user_input"),
        "buy_size_pct": (_extract_number(text, [r"每跌\s*\d+%\s*买入\s*(\d+)%", r"买入\s*(\d+)%"]), "user_input"),
        "sell_step_pct": (_extract_number(text, [r"每涨\s*(\d+)%", r"上涨\s*(\d+)%"]), "user_input"),
        "sell_size_pct": (_extract_number(text, [r"卖出\s*(\d+)%"]), "user_input"),
        "capital": (_extract_number(text, [r"本金\s*(\d+)"]), "user_input"),
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
    entries.append({"key": key, "label": key, "value": ai_value, "source": ai_source})


def _entry_value(entries: Sequence[Mapping[str, Any]], key: str) -> Any:
    for entry in entries:
        if entry.get("key") == key:
            return entry.get("value")
    return None


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
        if entry["key"] not in existing_top_keys:
            normalized["top_level"].append(entry)
    for entry in defaults["parameters"]:
        if entry["key"] not in existing_param_keys:
            normalized["parameters"].append(entry)
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

    if strategy_type == "GRID":
        top_level_payload, parameter_payload = _extract_grid_payload(text)
    elif strategy_type == "MOMENTUM":
        top_level_payload, parameter_payload = _extract_momentum_payload(text)
    else:
        universe_name, universe_source, _ = detect_universe(text)
        top_level_payload = {
            "strategy_type": ("GENERAL", "system_default"),
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

    required_keys = {
        "GRID": ["universe_name", "initial_position", "grid_interval", "buy_size_pct", "sell_step_pct", "sell_size_pct"],
        "MOMENTUM": [
            "universe_name",
            "lookback_months",
            "skip_recent_months",
            "top_n",
            "weighting_method",
            "rebalance_anchor_dates",
        ],
        "GENERAL": ["universe_name"],
    }
    pending_inputs: list[dict[str, Any]] = []
    for key in required_keys.get(strategy_type, []):
        if key == "universe_name":
            if not top_level.get("universe_name"):
                pending_inputs.append({"key": key, "label": "标的范围", "message": "请补充标的范围"})
            continue
        if _entry_value(confirmation_fields["parameters"], key) in (None, "", []):
            pending_inputs.append({"key": key, "label": key, "message": f"请补充 {key}"})

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

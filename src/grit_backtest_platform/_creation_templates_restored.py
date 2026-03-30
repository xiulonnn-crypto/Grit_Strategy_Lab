from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any, Mapping


DEFAULT_ALLOWED_ACTIONS = [
    "edit_prompt",
    "set_template",
    "override_field",
    "prepare_confirmation",
    "materialize",
]

DEFAULT_TEMPLATE_KEY = "momentum"


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
    default_parameters: dict[str, Any]
    fields: list[TemplateField] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "name": self.name,
            "description": self.description,
            "prompt_hints": list(self.prompt_hints),
            "default_parameters": dict(self.default_parameters),
            "fields": [asdict(field) for field in self.fields],
        }


STRATEGY_TEMPLATES: dict[str, StrategyTemplate] = {
    "momentum": StrategyTemplate(
        key="momentum",
        name="Cross-Sectional Momentum",
        description="Ranks symbols by trailing return and buys the leaders.",
        prompt_hints=("momentum", "trend", "leaders", "relative strength"),
        default_parameters={
            "template_key": "momentum",
            "lookback_days": 126,
            "holding_count": 10,
            "rebalance_frequency": "weekly",
            "universe_key": "sp500",
            "benchmark_symbol": "SPY",
        },
        fields=[
            TemplateField("lookback_days", "Lookback", "integer", 126),
            TemplateField("holding_count", "Holdings", "integer", 10),
            TemplateField("rebalance_frequency", "Rebalance", "enum", "weekly"),
            TemplateField("universe_key", "Universe", "string", "sp500"),
        ],
    ),
    "mean_reversion": StrategyTemplate(
        key="mean_reversion",
        name="Mean Reversion",
        description="Buys recent laggards on the assumption they mean-revert.",
        prompt_hints=("mean reversion", "oversold", "rebound", "contrarian"),
        default_parameters={
            "template_key": "mean_reversion",
            "lookback_days": 21,
            "holding_count": 10,
            "rebalance_frequency": "weekly",
            "universe_key": "sp500",
            "benchmark_symbol": "SPY",
            "entry_zscore": -1.5,
            "exit_zscore": 0.0,
        },
        fields=[
            TemplateField("lookback_days", "Lookback", "integer", 21),
            TemplateField("holding_count", "Holdings", "integer", 10),
            TemplateField("entry_zscore", "Entry Z", "number", -1.5),
            TemplateField("exit_zscore", "Exit Z", "number", 0.0),
            TemplateField("rebalance_frequency", "Rebalance", "enum", "weekly"),
        ],
    ),
    "quality_growth": StrategyTemplate(
        key="quality_growth",
        name="Quality Growth",
        description="Momentum-style ranking with slower turnover and stronger filters.",
        prompt_hints=("quality", "growth", "compounder", "high quality"),
        default_parameters={
            "template_key": "quality_growth",
            "lookback_days": 252,
            "holding_count": 15,
            "rebalance_frequency": "monthly",
            "universe_key": "sp500",
            "benchmark_symbol": "SPY",
        },
    ),
}

TEMPLATE_REGISTRY = STRATEGY_TEMPLATES


def template_catalog() -> list[dict[str, Any]]:
    return [template.to_dict() for template in STRATEGY_TEMPLATES.values()]


list_templates = template_catalog


def get_template(template_key: str | None) -> StrategyTemplate:
    key = (template_key or DEFAULT_TEMPLATE_KEY).strip().lower()
    return STRATEGY_TEMPLATES.get(key, STRATEGY_TEMPLATES[DEFAULT_TEMPLATE_KEY])


def select_template_for_prompt(prompt: str, template_key: str | None = None) -> StrategyTemplate:
    if template_key:
        return get_template(template_key)
    normalized = prompt.lower()
    for key, template in STRATEGY_TEMPLATES.items():
        if any(hint in normalized for hint in template.prompt_hints):
            return template
        if key.replace("_", " ") in normalized:
            return template
    return STRATEGY_TEMPLATES[DEFAULT_TEMPLATE_KEY]


select_strategy_template = select_template_for_prompt


def _extract_int(prompt: str, patterns: list[str], default: int) -> int:
    for pattern in patterns:
        match = re.search(pattern, prompt, flags=re.IGNORECASE)
        if match:
            return int(match.group(1))
    return default


def _extract_float(prompt: str, patterns: list[str], default: float) -> float:
    for pattern in patterns:
        match = re.search(pattern, prompt, flags=re.IGNORECASE)
        if match:
            return float(match.group(1))
    return default


def _extract_frequency(prompt: str, default: str) -> str:
    normalized = prompt.lower()
    if "monthly" in normalized or "month" in normalized or "每月" in normalized:
        return "monthly"
    if "daily" in normalized or "每天" in normalized:
        return "daily"
    return "weekly" if ("weekly" in normalized or "每周" in normalized or default == "weekly") else default


def _extract_universe(prompt: str, default: str) -> str:
    normalized = prompt.lower()
    if "nasdaq" in normalized:
        return "nasdaq100"
    if "russell" in normalized:
        return "russell1000"
    if "sp500" in normalized or "s&p 500" in normalized or "标普500" in normalized:
        return "sp500"
    return default


def _extract_name(prompt: str, template: StrategyTemplate) -> str:
    clean = re.sub(r"\s+", " ", prompt).strip()
    if not clean:
        return template.name
    if len(clean) <= 48:
        return clean
    return f"{template.name} Strategy"


def extract_parameters_from_prompt(prompt: str, template_key: str | None = None) -> dict[str, Any]:
    template = select_template_for_prompt(prompt, template_key)
    parameters = dict(template.default_parameters)
    parameters["lookback_days"] = _extract_int(
        prompt,
        [
            r"lookback(?:\s+of)?\s+(\d+)",
            r"(\d+)\s*(?:day|trading day)s?\s+lookback",
            r"过去\s*(\d+)\s*天",
        ],
        int(parameters.get("lookback_days") or 0),
    )
    parameters["holding_count"] = _extract_int(
        prompt,
        [
            r"(?:top|hold)\s+(\d+)",
            r"(\d+)\s*(?:stocks|names|holdings)",
            r"持有\s*(\d+)\s*只",
        ],
        int(parameters.get("holding_count") or 0),
    )
    parameters["rebalance_frequency"] = _extract_frequency(prompt, str(parameters.get("rebalance_frequency") or "weekly"))
    parameters["universe_key"] = _extract_universe(prompt, str(parameters.get("universe_key") or "sp500"))
    benchmark_match = re.search(r"\bbenchmark\s+([A-Z]{1,5})\b", prompt, flags=re.IGNORECASE)
    if benchmark_match:
        parameters["benchmark_symbol"] = benchmark_match.group(1).upper()
    if template.key == "mean_reversion":
        parameters["entry_zscore"] = _extract_float(
            prompt,
            [r"entry z(?:score)?\s*(-?\d+(?:\.\d+)?)", r"enter at\s*(-?\d+(?:\.\d+)?)"],
            float(parameters.get("entry_zscore") or -1.5),
        )
        parameters["exit_zscore"] = _extract_float(
            prompt,
            [r"exit z(?:score)?\s*(-?\d+(?:\.\d+)?)", r"exit at\s*(-?\d+(?:\.\d+)?)"],
            float(parameters.get("exit_zscore") or 0.0),
        )
    return parameters


def merge_manual_overrides(parameters: Mapping[str, Any], manual_overrides: Mapping[str, Any] | None) -> dict[str, Any]:
    merged = dict(parameters)
    for key, value in (manual_overrides or {}).items():
        if value is not None:
            merged[key] = value
    return merged


def refresh_creation_state(
    prompt: str,
    *,
    previous_state: Mapping[str, Any] | None = None,
    template_key: str | None = None,
) -> dict[str, Any]:
    previous_state = dict(previous_state or {})
    manual_overrides = dict(previous_state.get("manual_overrides") or {})
    template = select_template_for_prompt(prompt, template_key or previous_state.get("template_key"))
    extracted = extract_parameters_from_prompt(prompt, template.key)
    parameters = merge_manual_overrides(extracted, manual_overrides)
    revision = int(previous_state.get("parameter_revision") or 0) + 1
    return {
        "prompt": prompt,
        "summary": template.description,
        "template_key": template.key,
        "selected_template_key": template.key,
        "suggested_name": _extract_name(prompt, template),
        "parameter_revision": revision,
        "parameters": parameters,
        "normalized_parameters": parameters,
        "manual_overrides": manual_overrides,
        "field_errors": {},
        "allowed_actions": list(DEFAULT_ALLOWED_ACTIONS),
        "artifacts": {"templates": template_catalog()},
    }


def repair_creation_session(session: Mapping[str, Any]) -> dict[str, Any]:
    repaired = dict(session)
    template = select_template_for_prompt(
        str(repaired.get("prompt") or repaired.get("summary") or ""),
        str(repaired.get("template_key") or repaired.get("selected_template_key") or ""),
    )
    repaired.setdefault("status", "draft")
    repaired.setdefault("template_key", template.key)
    repaired.setdefault("selected_template_key", template.key)
    repaired.setdefault("parameters", dict(template.default_parameters))
    repaired.setdefault("normalized_parameters", dict(repaired["parameters"]))
    repaired.setdefault("manual_overrides", {})
    repaired.setdefault("field_errors", {})
    repaired.setdefault("allowed_actions", list(DEFAULT_ALLOWED_ACTIONS))
    repaired.setdefault("parameter_revision", 1)
    repaired.setdefault("artifacts", {"templates": template_catalog()})
    return repaired


extract_template_parameters = extract_parameters_from_prompt
refresh_creation_session_state = refresh_creation_state

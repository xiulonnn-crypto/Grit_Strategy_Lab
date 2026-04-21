from __future__ import annotations

from collections import deque
from copy import deepcopy
from itertools import product
import math
import multiprocessing as mp
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence
from uuid import uuid4

from ._runtime_memory import read_runtime_memory_status
from .backtest_metrics import build_consistency_score
from .creation_templates import (
    STRATEGY_TEMPLATES,
    DEFAULT_ALLOWED_ACTIONS,
    STRATEGY_TYPE_TITLES,
    _build_buy_and_hold_strategy_description,
    _build_grid_strategy_description,
    _build_mean_reversion_strategy_description,
    _build_mean_reversion_trading_logic_summary,
    blank_confirmation_fields,
    build_confirmation,
)
from .storage import SQLiteStorage, dumps, iso_now, is_snapshot_blocking, loads, utc_now


OPTIMIZATION_SELECTION_KEYS: dict[str, tuple[str, ...]] = {
    "GRID": ("initial_position", "grid_interval", "buy_size_pct", "sell_step_pct", "sell_size_pct"),
    "BUY_AND_HOLD": ("contribution_amount", "investment_frequency"),
    "MOMENTUM": (
        "lookback_months",
        "skip_recent_months",
        "top_n",
        "hold_rank_threshold",
        "rebalance_frequency",
        "weighting_method",
    ),
    "MEAN_REVERSION": (
        "observation_timeframe",
        "bollinger_period",
        "rsi_period",
        "rsi_buy_threshold",
        "rsi_sell_threshold",
        "long_entry_size_pct",
        "short_entry_size_pct",
    ),
}

OPTIMIZATION_IGNORED_KEYS = {
    "strategy_name",
    "strategy_description",
    "benchmark_symbol",
    "capital",
    "strategy_type",
    "universe_name",
}

OPTIMIZATION_CONSTRAINT_PRESET_LABELS: dict[str, str] = {
    "balanced": "平衡型",
    "defensive": "稳健型",
    "offensive": "进攻型",
}
OPTIMIZATION_DEFAULT_OBJECTIVE = "return_sharpe"
OPTIMIZATION_OBJECTIVE_ALIASES: dict[str, str] = {
    "sharpe": "return_sharpe",
    "return_sharpe": "return_sharpe",
    "sharpe_max": "return_sharpe",
    "return_sharpe_max": "return_sharpe",
    "annualized_return": "annualized_return",
    "annualized_return_max": "annualized_return",
    "cagr": "annualized_return",
    "return": "annualized_return",
    "total_return": "annualized_return",
    "score": "composite_score",
    "score_max": "composite_score",
    "composite_score": "composite_score",
    "composite_score_max": "composite_score",
}
OPTIMIZATION_SUPPORTED_CONSTRAINT_KEYS: tuple[str, ...] = (
    "max_drawdown_pct",
    "out_of_sample_sharpe",
    "annualized_return",
    "stability",
    "return_sharpe",
)

OPTIMIZATION_CONSTRAINT_PRESET_DEFAULTS: dict[str, tuple[dict[str, Any], ...]] = {
    "balanced": (
        {
            "key": "max_drawdown_pct",
            "label": "最大回撤",
            "category": "risk",
            "operator": "<=",
            "value": 25.0,
            "unit": "%",
        },
        {
            "key": "out_of_sample_sharpe",
            "label": "样本外夏普",
            "category": "stability",
            "operator": ">=",
            "value": 0.8,
            "unit": "",
        },
        {
            "key": "annualized_return",
            "label": "年化收益率",
            "category": "return",
            "operator": ">=",
            "value": 8.0,
            "unit": "%",
        },
        {
            "key": "stability",
            "label": "稳定度",
            "category": "stability",
            "operator": ">=",
            "value": 70.0,
            "unit": "pts",
        },
        {
            "key": "turnover",
            "label": "换手率",
            "category": "risk",
            "operator": "<=",
            "value": 12.0,
            "unit": "%",
        },
        {
            "key": "return_sharpe",
            "label": "收益夏普",
            "category": "return",
            "operator": ">=",
            "value": 1.0,
            "unit": "",
        },
    ),
    "defensive": (
        {
            "key": "max_drawdown_pct",
            "label": "最大回撤",
            "category": "risk",
            "operator": "<=",
            "value": 20.0,
            "unit": "%",
        },
        {
            "key": "out_of_sample_sharpe",
            "label": "样本外夏普",
            "category": "stability",
            "operator": ">=",
            "value": 0.92,
            "unit": "",
        },
        {
            "key": "annualized_return",
            "label": "年化收益率",
            "category": "return",
            "operator": ">=",
            "value": 6.0,
            "unit": "%",
        },
        {
            "key": "stability",
            "label": "稳定度",
            "category": "stability",
            "operator": ">=",
            "value": 78.0,
            "unit": "pts",
        },
        {
            "key": "turnover",
            "label": "换手率",
            "category": "risk",
            "operator": "<=",
            "value": 10.0,
            "unit": "%",
        },
        {
            "key": "return_sharpe",
            "label": "收益夏普",
            "category": "return",
            "operator": ">=",
            "value": 0.9,
            "unit": "",
        },
    ),
    "offensive": (
        {
            "key": "max_drawdown_pct",
            "label": "最大回撤",
            "category": "risk",
            "operator": "<=",
            "value": 30.0,
            "unit": "%",
        },
        {
            "key": "out_of_sample_sharpe",
            "label": "样本外夏普",
            "category": "stability",
            "operator": ">=",
            "value": 0.65,
            "unit": "",
        },
        {
            "key": "annualized_return",
            "label": "年化收益率",
            "category": "return",
            "operator": ">=",
            "value": 12.0,
            "unit": "%",
        },
        {
            "key": "stability",
            "label": "稳定度",
            "category": "stability",
            "operator": ">=",
            "value": 60.0,
            "unit": "pts",
        },
        {
            "key": "turnover",
            "label": "换手率",
            "category": "risk",
            "operator": "<=",
            "value": 16.0,
            "unit": "%",
        },
        {
            "key": "return_sharpe",
            "label": "收益夏普",
            "category": "return",
            "operator": ">=",
            "value": 1.15,
            "unit": "",
        },
    ),
    "balanced": (
        {
            "key": "max_drawdown_pct",
            "label": "最大回撤",
            "category": "risk",
            "operator": "<=",
            "value": 25.0,
            "unit": "%",
        },
        {
            "key": "out_of_sample_sharpe",
            "label": "样本外夏普",
            "category": "stability",
            "operator": ">=",
            "value": 0.8,
            "unit": "",
        },
        {
            "key": "annualized_return",
            "label": "年化收益率",
            "category": "return",
            "operator": ">=",
            "value": 8.0,
            "unit": "%",
        },
        {
            "key": "stability",
            "label": "稳定度",
            "category": "stability",
            "operator": ">=",
            "value": 70.0,
            "unit": "pts",
        },
        {
            "key": "return_sharpe",
            "label": "收益夏普",
            "category": "return",
            "operator": ">=",
            "value": 1.0,
            "unit": "",
        },
    ),
    "defensive": (
        {
            "key": "max_drawdown_pct",
            "label": "最大回撤",
            "category": "risk",
            "operator": "<=",
            "value": 20.0,
            "unit": "%",
        },
        {
            "key": "out_of_sample_sharpe",
            "label": "样本外夏普",
            "category": "stability",
            "operator": ">=",
            "value": 0.92,
            "unit": "",
        },
        {
            "key": "annualized_return",
            "label": "年化收益率",
            "category": "return",
            "operator": ">=",
            "value": 6.0,
            "unit": "%",
        },
        {
            "key": "stability",
            "label": "稳定度",
            "category": "stability",
            "operator": ">=",
            "value": 78.0,
            "unit": "pts",
        },
        {
            "key": "return_sharpe",
            "label": "收益夏普",
            "category": "return",
            "operator": ">=",
            "value": 0.9,
            "unit": "",
        },
    ),
    "offensive": (
        {
            "key": "max_drawdown_pct",
            "label": "最大回撤",
            "category": "risk",
            "operator": "<=",
            "value": 30.0,
            "unit": "%",
        },
        {
            "key": "out_of_sample_sharpe",
            "label": "样本外夏普",
            "category": "stability",
            "operator": ">=",
            "value": 0.65,
            "unit": "",
        },
        {
            "key": "annualized_return",
            "label": "年化收益率",
            "category": "return",
            "operator": ">=",
            "value": 12.0,
            "unit": "%",
        },
        {
            "key": "stability",
            "label": "稳定度",
            "category": "stability",
            "operator": ">=",
            "value": 60.0,
            "unit": "pts",
        },
        {
            "key": "return_sharpe",
            "label": "收益夏普",
            "category": "return",
            "operator": ">=",
            "value": 1.15,
            "unit": "",
        },
    ),
}

LEGACY_MOCK_OPTIMIZATION_LABELS = (
    "Top candidate",
    "Optimization ready",
    "High stability",
    "Risk balanced",
)
LEGACY_MOCK_OPTIMIZATION_LABELS_GARBLED = (
    "蝔喳?蝑銝剖?",
    "?脣?隡?蝥?",
    "?嗥?憓???",
    "颲寧?霂???",
)
LEGACY_MOCK_OPTIMIZATION_LABELS_ZH = (
    "稳定策略中心",
    "防守优先级",
    "收益增益版",
    "边界试验版",
)
OPTIMIZATION_PREPARED_CONTEXT_KEY = "__optimization_prepared_context"
OPTIMIZATION_RUNNER_CLAIM_PREFIX = "optimization_runner_claim:"
OPTIMIZATION_RUNNER_LEASE_SECONDS = 300.0
OPTIMIZATION_ETA_RECENT_COMPLETIONS_WINDOW = 8


class _OptimizationRunnerClaimLost(RuntimeError):
    pass


def _as_mapping(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, Mapping):
        return dict(value)
    if hasattr(value, "model_dump"):
        return dict(value.model_dump())
    if hasattr(value, "dict"):
        return dict(value.dict())
    return dict(vars(value))


def _build_optimization_window_metrics_payload(points: Sequence[Mapping[str, Any]]) -> dict[str, float]:
    rows = [dict(item) for item in points if item]
    if not rows:
        return {
            "total_return": 0.0,
            "annualized_return": 0.0,
            "annualized_volatility": 0.0,
            "sharpe": 0.0,
            "max_drawdown_pct": 0.0,
            "stability": 0.0,
        }

    returns = [float(row.get("strategy_return") or 0.0) for row in rows]
    total_growth = 1.0
    for value in returns:
        total_growth *= 1.0 + value
    total_return = total_growth - 1.0
    average_return = sum(returns) / len(returns) if returns else 0.0
    variance = sum((value - average_return) ** 2 for value in returns) / len(returns) if len(returns) > 1 else 0.0
    daily_volatility = math.sqrt(max(variance, 0.0))
    if daily_volatility > 1e-12:
        sharpe = average_return / daily_volatility * math.sqrt(252.0)
    elif average_return > 1e-12:
        sharpe = math.sqrt(252.0)
    elif average_return < -1e-12:
        sharpe = -math.sqrt(252.0)
    else:
        sharpe = 0.0
    annualized_return = total_growth ** (252.0 / len(returns)) - 1.0 if returns else 0.0
    annualized_volatility = daily_volatility * math.sqrt(252.0)
    max_drawdown_pct = min(float(row.get("drawdown") or 0.0) for row in rows)
    consistency_score = build_consistency_score(rows).get("score")
    try:
        stability = max(0.0, min(100.0, float(consistency_score or 0.0) * 100.0))
    except (TypeError, ValueError):
        stability = 0.0
    return {
        "total_return": total_return,
        "annualized_return": annualized_return,
        "annualized_volatility": annualized_volatility,
        "sharpe": sharpe,
        "max_drawdown_pct": max_drawdown_pct,
        "stability": stability,
    }


def _build_real_optimization_metrics_payload(
    preview: Mapping[str, Any],
    chart_series: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    preview_metrics = dict(preview.get("metrics") or {})
    normalized_chart_series = [dict(item) for item in chart_series if item]
    full_window = _build_optimization_window_metrics_payload(normalized_chart_series)
    out_of_sample = [row for row in normalized_chart_series if bool(row.get("is_oos"))]
    if not out_of_sample and normalized_chart_series:
        tail = max(1, len(normalized_chart_series) // 3)
        out_of_sample = normalized_chart_series[-tail:]
    oos_window = _build_optimization_window_metrics_payload(out_of_sample)

    total_return = _as_float(preview_metrics.get("total_return"), full_window["total_return"])
    annualized_return = _as_float(
        preview_metrics.get("annualized_return"),
        _as_float(preview_metrics.get("cagr"), full_window["annualized_return"]),
    )
    annualized_volatility = _as_float(
        preview_metrics.get("annualized_volatility"),
        full_window["annualized_volatility"],
    )
    sharpe = _as_float(preview_metrics.get("sharpe"), full_window["sharpe"])
    out_of_sample_sharpe = _as_float(
        preview_metrics.get("oos_sharpe"),
        oos_window["sharpe"] if out_of_sample else sharpe,
    )
    oos_cagr = _as_float(
        preview_metrics.get("oos_cagr"),
        oos_window["annualized_return"] if out_of_sample else annualized_return,
    )
    max_drawdown = _as_float(preview_metrics.get("max_drawdown"), full_window["max_drawdown_pct"] / 100.0)
    max_drawdown_pct = round(max_drawdown * 100.0, 1)
    stability = round(full_window["stability"], 0)

    return {
        **preview_metrics,
        "total_return": total_return,
        "total_return_pct": round(total_return * 100.0, 1),
        "cagr": _as_float(preview_metrics.get("cagr"), annualized_return),
        "annualized_return": annualized_return,
        "annualized_volatility": annualized_volatility,
        "sharpe": sharpe,
        "return_sharpe": sharpe,
        "oos_cagr": oos_cagr,
        "oos_sharpe": out_of_sample_sharpe,
        "out_of_sample_sharpe": out_of_sample_sharpe,
        "max_drawdown": max_drawdown,
        "max_drawdown_pct": max_drawdown_pct,
        "turnover": _as_float(preview_metrics.get("turnover")),
        "win_rate": _as_float(preview_metrics.get("win_rate")),
        "stability": stability,
    }


def _score_optimization_metrics_payload(metrics: Mapping[str, Any], objective: Any) -> float:
    return_sharpe = _as_float(metrics.get("return_sharpe"), _as_float(metrics.get("sharpe"), 0.0))
    out_of_sample_sharpe = _as_float(metrics.get("out_of_sample_sharpe"), return_sharpe)
    annualized_return_pct = _normalize_optimization_constraint_metric_value(
        "annualized_return",
        _as_float(metrics.get("annualized_return"), _as_float(metrics.get("cagr"), 0.0)),
    )
    total_return_pct = _as_float(metrics.get("total_return_pct"), _as_float(metrics.get("total_return"), 0.0) * 100.0)
    stability = _as_float(metrics.get("stability"), 0.0)
    drawdown_penalty = _normalize_optimization_constraint_metric_value(
        "max_drawdown_pct",
        _as_float(metrics.get("max_drawdown_pct"), _as_float(metrics.get("max_drawdown"), 0.0)),
    )
    normalized_objective = _normalize_optimization_objective(objective)
    calmar_ratio = annualized_return_pct / max(drawdown_penalty, 1.0)

    def band_score(value: float, floor: float, ceiling: float) -> float:
        if ceiling <= floor:
            return 0.0
        return max(0.0, min((value - floor) / (ceiling - floor), 1.25))

    def inverse_band_score(value: float, floor: float, ceiling: float) -> float:
        if ceiling <= floor:
            return 0.0
        return max(0.0, min((ceiling - value) / (ceiling - floor), 1.25))

    return_component = band_score(annualized_return_pct, 4.0, 18.0)
    sharpe_component = band_score(return_sharpe, 0.3, 1.6)
    oos_component = band_score(out_of_sample_sharpe, 0.2, 1.2)
    calmar_component = band_score(calmar_ratio, 0.25, 1.2)
    stability_component = band_score(stability, 40.0, 85.0)
    drawdown_component = inverse_band_score(drawdown_penalty, 15.0, 45.0)

    base_weights = {
        "sharpe": 0.24,
        "oos": 0.24,
        "calmar": 0.18,
        "stability": 0.14,
        "return": 0.12,
        "drawdown": 0.05,
    }
    base_weight_total = sum(base_weights.values()) or 1.0
    base_score = (
        sharpe_component * (base_weights["sharpe"] / base_weight_total)
        + oos_component * (base_weights["oos"] / base_weight_total)
        + calmar_component * (base_weights["calmar"] / base_weight_total)
        + stability_component * (base_weights["stability"] / base_weight_total)
        + return_component * (base_weights["return"] / base_weight_total)
        + drawdown_component * (base_weights["drawdown"] / base_weight_total)
    )
    if normalized_objective == "annualized_return":
        objective_score = return_component * 0.07 + calmar_component * 0.04
    elif normalized_objective == "return_sharpe":
        objective_score = sharpe_component * 0.07 + oos_component * 0.04
    else:
        objective_score = 0.0

    total_return_bonus = max(-1.0, min(total_return_pct, 200.0) * 0.01)
    return round((base_score + objective_score) * 100.0 + total_return_bonus, 3)


def _optimization_metrics_need_repair(metrics: Mapping[str, Any] | None) -> bool:
    payload = dict(metrics or {})
    if not payload:
        return True
    has_annualized_return = any(key in payload for key in ("annualized_return", "cagr"))
    has_drawdown = any(key in payload for key in ("max_drawdown_pct", "max_drawdown"))
    return not has_annualized_return or not has_drawdown


def _build_synthetic_optimization_preview_and_chart_series(
    parameter_snapshot: Mapping[str, Any],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    numeric_seed = 0.0
    for index, key in enumerate(sorted(parameter_snapshot)):
        value = parameter_snapshot.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)):
            numeric_seed += (index + 1) * float(value)
        else:
            numeric_seed += (index + 1) * float(len(str(value)))

    base_daily_return = 0.0008 + (numeric_seed % 7.0) * 0.00005
    oos_multiplier = 0.92 + (numeric_seed % 3.0) * 0.01
    chart_series: list[dict[str, Any]] = []
    equity = 100.0
    benchmark = 100.0
    for index in range(36):
        is_oos = index >= 24
        phase = index % 6
        strategy_return = base_daily_return + (phase - 2) * 0.00003 + (0.00004 if is_oos else 0.0)
        benchmark_return = strategy_return * oos_multiplier
        equity *= 1.0 + strategy_return
        benchmark *= 1.0 + benchmark_return
        chart_series.append(
            {
                "trade_date": f"2026-01-{index + 1:02d}",
                "equity": round(equity, 4),
                "benchmark": round(benchmark, 4),
                "drawdown": round(min(0.0, (equity / max(benchmark, 1e-9)) - 1.0) * 100.0, 4),
                "is_oos": is_oos,
                "strategy_return": round(strategy_return, 6),
                "benchmark_return": round(benchmark_return, 6),
            }
        )

    preview = {
        "metrics": {
            "total_return": round(equity / 100.0 - 1.0, 6),
            "cagr": round((equity / 100.0) ** (252.0 / len(chart_series)) - 1.0, 6),
            "annualized_return": round((equity / 100.0) ** (252.0 / len(chart_series)) - 1.0, 6),
            "annualized_volatility": round(0.01 + (numeric_seed % 5.0) * 0.001, 6),
            "sharpe": round(1.0 + numeric_seed / 100.0, 6),
            "max_drawdown": round(-0.04 - (numeric_seed % 5.0) * 0.004, 6),
            "turnover": round(0.01 + (numeric_seed % 4.0) * 0.001, 6),
            "win_rate": round(0.55 + (numeric_seed % 10.0) * 0.01, 6),
            "oos_cagr": round((equity / 100.0) ** (252.0 / len(chart_series)) - 1.0, 6) * 0.95,
            "oos_sharpe": round(0.9 + numeric_seed / 120.0, 6),
        }
    }
    return preview, chart_series


def _evaluate_optimization_trial_payload(
    parameter_snapshot: Mapping[str, Any],
    objective: Any,
) -> dict[str, Any]:
    preview, chart_series = _build_synthetic_optimization_preview_and_chart_series(parameter_snapshot)
    metrics = _build_real_optimization_metrics_payload(preview, chart_series)
    return {
        "parameter_snapshot": dict(parameter_snapshot),
        "metrics": metrics,
        "chart_series": chart_series,
        "score": _score_optimization_metrics_payload(metrics, objective),
    }


def _optimization_trial_worker_main(
    worker_id: int,
    command_queue: Any,
    result_queue: Any,
) -> None:
    while True:
        command = _as_mapping(command_queue.get())
        command_type = str(command.get("type") or "").strip().lower()
        if command_type == "shutdown":
            result_queue.put({"type": "worker_stopped", "worker_id": worker_id})
            return
        if command_type != "trial":
            continue

        trial_index = _as_int(command.get("trial_index"), 0)
        parameter_snapshot = dict(command.get("parameter_snapshot") or {})
        objective = command.get("objective")
        try:
            trial_result = _evaluate_optimization_trial_payload(parameter_snapshot, objective)
            result_queue.put(
                {
                    "type": "trial_result",
                    "worker_id": worker_id,
                    "trial_index": trial_index,
                    "parameter_snapshot": dict(trial_result.get("parameter_snapshot") or parameter_snapshot),
                    "metrics": dict(trial_result.get("metrics") or {}),
                    "score": trial_result.get("score"),
                    "error_message": None,
                }
            )
        except Exception as exc:
            result_queue.put(
                {
                    "type": "trial_result",
                    "worker_id": worker_id,
                    "trial_index": trial_index,
                    "parameter_snapshot": parameter_snapshot,
                    "metrics": {},
                    "score": 0.0,
                    "error_message": str(exc).strip() or exc.__class__.__name__,
                }
            )


def _field_map(entries: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(item.get("key")): item for item in entries}


def _upsert_field(entries: list[dict[str, Any]], key: str, label: str, value: Any, source: str) -> None:
    for entry in entries:
        if entry.get("key") == key:
            entry["value"] = value
            entry["source"] = source
            return
    entries.append({"key": key, "label": label, "value": value, "source": source})


def _top_level_from_confirmation(confirmation_fields: Mapping[str, Any], fallback: Mapping[str, Any] | None = None) -> dict[str, Any]:
    mapping = _field_map(list(confirmation_fields.get("top_level", [])))
    fallback = dict(fallback or {})
    return {
        "strategy_type": mapping.get("strategy_type", {}).get("value") or fallback.get("strategy_type") or "GENERAL",
        "universe_name": mapping.get("universe_name", {}).get("value") or fallback.get("universe_name") or "",
        "rebalance_frequency": mapping.get("rebalance_frequency", {}).get("value") or fallback.get("rebalance_frequency"),
    }


def _confirmation_entries(confirmation_fields: Mapping[str, Any] | None) -> list[dict[str, Any]]:
    fields = dict(confirmation_fields or {})
    return [*list(fields.get("top_level", [])), *list(fields.get("parameters", []))]


def _entry_index(confirmation_fields: Mapping[str, Any] | None) -> dict[str, dict[str, Any]]:
    entries: dict[str, dict[str, Any]] = {}
    for entry in _confirmation_entries(confirmation_fields):
        key = str(entry.get("key") or "").strip()
        if key:
            entries[key] = dict(entry)
    return entries


def _dedupe_top_level_parameters(confirmation_fields: Mapping[str, Any] | None) -> dict[str, list[dict[str, Any]]]:
    fields = dict(confirmation_fields or {})
    top_level = [dict(entry) for entry in fields.get("top_level", [])]
    top_level_keys = {
        str(entry.get("key") or "").strip()
        for entry in top_level
        if str(entry.get("key") or "").strip()
    }
    parameters = [
        dict(entry)
        for entry in fields.get("parameters", [])
        if str(entry.get("key") or "").strip() not in top_level_keys
    ]
    return {"top_level": top_level, "parameters": parameters}


def _conflict_index(conflicts: list[dict[str, Any]] | None) -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    for item in conflicts or []:
        key = str(item.get("key") or "").strip()
        if key:
            indexed[key] = dict(item)
    return indexed


def _stringify_tag_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() else str(value)
    return str(value).strip()


def _normalize_optimization_objective(objective: Any) -> str:
    normalized = str(objective or "").strip().lower()
    if not normalized:
        return OPTIMIZATION_DEFAULT_OBJECTIVE
    return OPTIMIZATION_OBJECTIVE_ALIASES.get(normalized, OPTIMIZATION_DEFAULT_OBJECTIVE)


def _normalize_optimization_constraints_payload(payload: Mapping[str, Any]) -> dict[str, Any]:
    preset_key = str(payload.get("constraint_preset_key") or "balanced").strip().lower()
    if preset_key not in OPTIMIZATION_CONSTRAINT_PRESET_LABELS:
        preset_key = "balanced"
    constraint_label = str(payload.get("constraint_label") or "").strip() or OPTIMIZATION_CONSTRAINT_PRESET_LABELS[preset_key]

    provided_constraints = payload.get("constraints")
    normalized_constraints: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    if isinstance(provided_constraints, list):
        for raw_entry in provided_constraints:
            try:
                entry = dict(raw_entry or {})
            except Exception:
                continue
            key = str(entry.get("key") or "").strip()
            if not key or key in seen_keys:
                continue
            if key not in OPTIMIZATION_SUPPORTED_CONSTRAINT_KEYS:
                continue
            seen_keys.add(key)
            normalized_constraints.append(
                {
                    "key": key,
                    "label": str(entry.get("label") or key).strip() or key,
                    "category": str(entry.get("category") or "general").strip() or "general",
                    "operator": str(entry.get("operator") or "<=").strip() or "<=",
                    "value": entry.get("value"),
                    "unit": str(entry.get("unit") or "").strip(),
                }
            )

    if not normalized_constraints:
        normalized_constraints = [dict(item) for item in OPTIMIZATION_CONSTRAINT_PRESET_DEFAULTS[preset_key]]

    return {
        "constraint_preset_key": preset_key,
        "constraint_label": constraint_label,
        "constraints": normalized_constraints,
    }


def _normalize_optimization_constraint_metric_value(constraint_key: str, value: float) -> float:
    normalized_key = str(constraint_key or "").strip()
    if normalized_key == "annualized_return":
        return value * 100.0 if abs(value) <= 1.5 else value
    if normalized_key == "max_drawdown_pct":
        normalized_value = value * 100.0 if abs(value) <= 1.5 else value
        return abs(normalized_value)
    if normalized_key == "turnover":
        return value * 100.0 if abs(value) <= 1.5 else value
    return value


def _optimization_constraint_metric_value(metrics: Mapping[str, Any], constraint_key: str) -> float | None:
    payload = _as_mapping(metrics)
    normalized_key = str(constraint_key or "").strip()
    raw_value: Any
    if normalized_key == "annualized_return":
        raw_value = payload.get("annualized_return", payload.get("cagr"))
    elif normalized_key == "return_sharpe":
        raw_value = payload.get("return_sharpe", payload.get("sharpe"))
    elif normalized_key == "out_of_sample_sharpe":
        raw_value = payload.get("out_of_sample_sharpe", payload.get("oos_sharpe"))
    elif normalized_key == "max_drawdown_pct":
        raw_value = payload.get("max_drawdown_pct")
        if raw_value is None:
            max_drawdown = payload.get("max_drawdown")
            raw_value = _as_float(max_drawdown, 0.0) * 100.0 if max_drawdown is not None else None
    elif normalized_key == "turnover":
        raw_value = payload.get("turnover_pct", payload.get("turnover"))
    elif normalized_key == "stability":
        raw_value = payload.get("stability")
    else:
        raw_value = payload.get(normalized_key)
    if raw_value is None:
        return None
    return _normalize_optimization_constraint_metric_value(normalized_key, _as_float(raw_value, 0.0))


def _optimization_metrics_satisfy_constraints(
    metrics: Mapping[str, Any],
    constraints: Sequence[Mapping[str, Any]],
) -> bool:
    normalized_constraints = [dict(item) for item in list(constraints or []) if item]
    if not normalized_constraints:
        return True
    for constraint in normalized_constraints:
        metric_value = _optimization_constraint_metric_value(metrics, str(constraint.get("key") or ""))
        if metric_value is None:
            return False
        threshold = _as_float(constraint.get("value"), 0.0)
        operator = str(constraint.get("operator") or "<=").strip() or "<="
        if operator == ">=":
            if metric_value < threshold:
                return False
        elif metric_value > threshold:
            return False
    return True


def _optimization_metrics_signature(metrics: Mapping[str, Any]) -> tuple[float, float, float, float, float, float, float]:
    payload = _as_mapping(metrics)
    return (
        round(_optimization_constraint_metric_value(payload, "annualized_return") or 0.0, 4),
        round(_optimization_constraint_metric_value(payload, "return_sharpe") or 0.0, 4),
        round(_optimization_constraint_metric_value(payload, "out_of_sample_sharpe") or 0.0, 4),
        round(_optimization_constraint_metric_value(payload, "max_drawdown_pct") or 0.0, 4),
        round(_optimization_constraint_metric_value(payload, "stability") or 0.0, 4),
        round(_optimization_constraint_metric_value(payload, "turnover") or 0.0, 4),
        round(_as_float(payload.get("total_return_pct"), _as_float(payload.get("total_return"), 0.0) * 100.0), 4),
    )


def _optimization_parameter_snapshot_signature(snapshot: Mapping[str, Any]) -> tuple[tuple[str, str], ...]:
    return tuple(
        sorted(
            (str(key), repr(value))
            for key, value in _as_mapping(snapshot).items()
        )
    )


def _is_default_optimization_candidate_label(label: Any) -> bool:
    candidate_label = str(label or "").strip()
    if not candidate_label:
        return True
    if candidate_label == "Best candidate":
        return True
    if candidate_label.startswith("Candidate "):
        return candidate_label.removeprefix("Candidate ").strip().isdigit()
    if candidate_label.startswith("候选 "):
        return candidate_label.removeprefix("候选 ").strip().isdigit()
    return False


def _optimization_candidate_projection_signature(candidate: Mapping[str, Any]) -> tuple[Any, ...]:
    payload = _as_mapping(candidate)
    return (
        _optimization_parameter_snapshot_signature(payload.get("parameter_snapshot") or {}),
        _optimization_metrics_signature(payload.get("metrics") or {}),
        round(_as_float(payload.get("score"), 0.0), 6),
    )


def _manual_conflict_changed(before: Mapping[str, Any] | None, after: Mapping[str, Any] | None) -> bool:
    if not after:
        return False
    if not before:
        return True
    for key in ("ai_value", "manual_value", "suggested_value", "message"):
        if _stringify_tag_value(before.get(key)) != _stringify_tag_value(after.get(key)):
            return True
    return False


def _as_float(value: Any, default: float = 0.0) -> float:
    if isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return default
        try:
            return float(stripped)
        except ValueError:
            return default
    return default


def _as_int(value: Any, default: int = 0) -> int:
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return default
        try:
            return int(float(stripped))
        except ValueError:
            return default
    return default


def _strip_strategy_version_suffix(name: Any) -> str:
    text = str(name or "").strip()
    if not text:
        return text
    cursor = len(text)
    while cursor > 0 and text[cursor - 1].isdigit():
        cursor -= 1
    if 0 < cursor < len(text) and text[cursor - 1].lower() == "v":
        return text[: cursor - 1].rstrip(" -")
    return text


def _format_versioned_strategy_name(name: Any, version: Any) -> str:
    base_name = _strip_strategy_version_suffix(name) or "策略"
    current_version = _as_int(version, 1)
    if current_version <= 1:
        return base_name
    return f"{base_name}v{current_version}"


def _display_strategy_name(name: Any, parameters: Mapping[str, Any] | None = None) -> str:
    parameter_name = _format_strategy_value((parameters or {}).get("strategy_name"))
    if parameter_name:
        return parameter_name
    base_name = _strip_strategy_version_suffix(name)
    if base_name:
        return base_name
    return _format_strategy_value(name) or "策略"


def _localize_optimization_text(value: Any) -> Any:
    text = str(value or "").strip()
    if not text:
        return value
    replacements = {
        "Annualized Return": "年化收益率",
        "Return Sharpe": "收益夏普",
        "Out-of-sample Sharpe": "样本外夏普",
        "Max Drawdown": "最大回撤",
        "Stability": "稳定度",
        "Window A": "窗口 A",
        "Window B": "窗口 B",
        "Window C": "窗口 C",
        "蝒 A": "窗口 A",
        "蝒 B": "窗口 B",
        "蝒 C": "窗口 C",
        "Current candidate meets the main promotion guardrails.": "当前候选已满足主要晋升护栏。",
        "Current candidate remains on the watchlist pending more cross-window evidence.": "当前候选仍处于观察名单，需等待更多跨窗口验证证据。",
        "Current candidate is only being kept as a boundary reference.": "当前候选仅作为参数边界参考保留。",
        "Annualized return is strong enough to support promotion review.": "年化收益率已达到正式版本晋升评估的收益门槛。",
        "Annualized return is usable, but still needs cross-window confirmation.": "年化收益率已具备可用性，但仍需跨窗口验证确认延续性。",
        "Annualized return is too weak to justify promotion.": "年化收益率偏弱，暂不足以支持版本晋升。",
        "Return Sharpe is in the promotion guardrail.": "收益夏普已进入晋升护栏。",
        "Return Sharpe is usable, but still needs more observation.": "收益夏普已具备可用性，但仍需继续观察。",
        "Out-of-sample Sharpe confirms the edge is carrying into unseen windows.": "样本外夏普表明优势已延续至未见样本窗口。",
        "Out-of-sample Sharpe is still soft and needs more confirmation.": "样本外夏普仍偏弱，需要更多验证确认。",
        "Out-of-sample Sharpe has degraded too much for promotion.": "样本外夏普衰减过大，暂不适合晋升。",
        "Drawdown remains inside the primary risk guardrail.": "最大回撤仍处于主要风险护栏以内。",
        "Drawdown is close to the guardrail and should be monitored.": "最大回撤已接近护栏，建议持续监控。",
        "Drawdown breaches the acceptable risk budget.": "最大回撤已突破可接受风险预算。",
        "The parameter neighborhood is stable enough to be reused.": "参数邻域稳定度充足，可作为可复用参数区间。",
        "Stability is acceptable, but the neighborhood still needs refinement.": "稳定度尚可，但参数邻域仍需进一步收敛。",
        "The parameter neighborhood remains unstable.": "参数邻域仍不稳定。",
        (
            "This candidate already meets the core promotion guardrails. "
            "Use the validation windows to confirm the edge persists across different market regimes."
        ): "该候选已满足核心晋升护栏，建议结合多窗口验证确认优势在不同市场阶段中的延续性。",
        (
            "This candidate is usable as a watchlist contender, but it still needs stronger out-of-sample proof "
            "or tighter drawdown behavior before promotion."
        ): "该候选可作为观察名单备选，但在晋升前仍需更强的样本外证据或更稳的回撤表现。",
        (
            "This candidate is being kept as a boundary reference only. "
            "It helps define where returns improve at the cost of unstable risk."
        ): "该候选仅作为边界参考保留，用于识别收益提升与风险失稳之间的分界位置。",
    }
    return replacements.get(text, text)


def _localize_optimization_analysis(analysis: Mapping[str, Any] | None) -> dict[str, Any]:
    payload = dict(analysis or {})
    if not payload:
        return {}
    for key in ("title", "thesis", "shelf_copy", "stability_verdict", "stability_summary"):
        if key in payload:
            payload[key] = _localize_optimization_text(payload.get(key))
    payload["stability_checks"] = [
        {
            **dict(item),
            "label": _localize_optimization_text(dict(item).get("label")),
            "detail": _localize_optimization_text(dict(item).get("detail")),
        }
        for item in list(payload.get("stability_checks") or [])
        if isinstance(item, Mapping)
    ]
    payload["validation_windows"] = [
        {
            **dict(item),
            "label": _localize_optimization_text(dict(item).get("label")),
        }
        for item in list(payload.get("validation_windows") or [])
        if isinstance(item, Mapping)
    ]
    return payload


class ContractConflictError(ValueError):
    def __init__(
        self,
        blocking_code: str,
        message: str,
        *,
        blocking_target: Mapping[str, Any] | None = None,
        next_action: str | None = None,
        extra: Mapping[str, Any] | None = None,
    ) -> None:
        detail = {
            "status": 409,
            "code": blocking_code,
            "blocking_code": blocking_code,
            "message": message,
            "blocking_target": dict(blocking_target or {}),
            "next_action": next_action,
        }
        if extra:
            detail.update(dict(extra))
        super().__init__(message)
        self.status_code = 409
        self.detail = detail


def _parameter_version_id(strategy_id: str, version_number: int) -> str:
    return f"{strategy_id}-v{version_number}"


def _format_strategy_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() else str(value)
    return str(value).strip()


def _coerce_optional_number(value: Any) -> int | float | None:
    if value in (None, "", []):
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    return int(numeric) if numeric.is_integer() else numeric


def _coerce_optional_int(value: Any) -> int | None:
    numeric = _coerce_optional_number(value)
    return int(numeric) if numeric is not None else None


def _parse_parameter_version_number(parameter_version_id: Any) -> int:
    raw = str(parameter_version_id or "").strip()
    if "-v" in raw:
        try:
            return int(raw.rsplit("-v", 1)[1])
        except (TypeError, ValueError):
            return 1
    return 1


def _summarize_revision_description(
    strategy_type: str,
    top_level: Mapping[str, Any],
    parameters: Mapping[str, Any],
    fallback: str | None = None,
) -> str | None:
    universe_name = _format_strategy_value(top_level.get("universe_name") or parameters.get("universe_name"))
    seed_text = (
        fallback
        or _format_strategy_value(parameters.get("strategy_name"))
        or universe_name
        or strategy_type
    )
    if strategy_type == "GRID":
        return _build_grid_strategy_description(
            text=seed_text,
            universe_name=universe_name,
            capital=parameters.get("capital"),
            initial_position=parameters.get("initial_position"),
            grid_interval=parameters.get("grid_interval"),
            buy_size_pct=parameters.get("buy_size_pct"),
            sell_step_pct=parameters.get("sell_step_pct"),
            sell_size_pct=parameters.get("sell_size_pct"),
        ) or fallback or None

    if strategy_type == "BUY_AND_HOLD":
        investment_frequency = _format_strategy_value(parameters.get("investment_frequency")).lower() or None
        return _build_buy_and_hold_strategy_description(
            text=seed_text,
            universe_name=universe_name,
            contribution_amount=parameters.get("contribution_amount"),
            investment_frequency=investment_frequency,
        ) or fallback or None

    if strategy_type == "MOMENTUM":
        bits: list[str] = []
        if universe_name:
            bits.append(f"Momentum strategy on {universe_name}")
        else:
            bits.append("Momentum strategy")
        rebalance = _format_strategy_value(top_level.get("rebalance_frequency"))
        rebalance_label = {
            "monthly": "monthly",
            "quarterly": "quarterly",
            "semiannual": "semiannual",
            "yearly": "yearly",
        }.get(rebalance.lower(), "")
        if rebalance_label:
            bits.append(f"rebalance {rebalance_label}")
        lookback = _format_strategy_value(parameters.get("lookback_months"))
        skip_recent = _format_strategy_value(parameters.get("skip_recent_months"))
        if lookback and skip_recent:
            bits.append(f"lookback {lookback} months, skip {skip_recent} month")
        top_n = _format_strategy_value(parameters.get("top_n"))
        hold_rank = _format_strategy_value(parameters.get("hold_rank_threshold"))
        if top_n and hold_rank:
            bits.append(f"buy top {top_n}, hold through rank {hold_rank}")
        weighting = _format_strategy_value(parameters.get("weighting_method")).lower()
        if weighting:
            bits.append(f"weighting {weighting}")
        capital = _format_strategy_value(parameters.get("capital"))
        if capital:
            bits.append(f"capital {capital} USD")
        return "; ".join(bit for bit in bits if bit) if bits else (fallback or None)

    if strategy_type == "MEAN_REVERSION":
        description = _build_mean_reversion_strategy_description(
            text=seed_text,
            universe_name=universe_name,
            observation_timeframe=_format_strategy_value(parameters.get("observation_timeframe")).lower() or None,
            bollinger_period=_coerce_optional_int(parameters.get("bollinger_period")),
            rsi_period=_coerce_optional_int(parameters.get("rsi_period")),
            rsi_buy_threshold=_coerce_optional_number(parameters.get("rsi_buy_threshold")),
            rsi_sell_threshold=_coerce_optional_number(parameters.get("rsi_sell_threshold")),
            atr_period=_coerce_optional_int(parameters.get("atr_period")),
            take_profit_atr=_coerce_optional_number(parameters.get("take_profit_atr")),
            stop_loss_atr=_coerce_optional_number(parameters.get("stop_loss_atr")),
            long_entry_size_pct=_coerce_optional_number(parameters.get("long_entry_size_pct")),
            short_entry_size_pct=_coerce_optional_number(parameters.get("short_entry_size_pct")),
        )
        if description:
            return description
        logic = _format_strategy_value(parameters.get("trading_logic"))
        if logic:
            return logic.rstrip(" .;")
        return fallback or None

    return fallback or None


def _summarize_revision_trading_logic(
    strategy_type: str,
    top_level: Mapping[str, Any],
    parameters: Mapping[str, Any],
    fallback: str | None = None,
) -> str | None:
    if strategy_type != "MEAN_REVERSION":
        return fallback or None

    return _build_mean_reversion_trading_logic_summary(
        universe_name=_format_strategy_value(top_level.get("universe_name") or parameters.get("universe_name")),
        observation_timeframe=_format_strategy_value(parameters.get("observation_timeframe")).lower() or None,
        bollinger_period=_coerce_optional_int(parameters.get("bollinger_period")),
        rsi_period=_coerce_optional_int(parameters.get("rsi_period")),
        rsi_buy_threshold=_coerce_optional_number(parameters.get("rsi_buy_threshold")),
        rsi_sell_threshold=_coerce_optional_number(parameters.get("rsi_sell_threshold")),
        atr_period=_coerce_optional_int(parameters.get("atr_period")),
        take_profit_atr=_coerce_optional_number(parameters.get("take_profit_atr")),
        stop_loss_atr=_coerce_optional_number(parameters.get("stop_loss_atr")),
        long_entry_size_pct=_coerce_optional_number(parameters.get("long_entry_size_pct")),
        short_entry_size_pct=_coerce_optional_number(parameters.get("short_entry_size_pct")),
    ) or fallback or None


def _normalize_parameter_history(
    strategy_id: str,
    history: list[dict[str, Any]],
    fallback_parameters: Mapping[str, Any],
    current_version: int,
) -> list[dict[str, Any]]:
    if not history:
        history = [
            {
                "version_number": current_version,
                "revision": 1,
                "created_at": None,
                "parameters": dict(fallback_parameters),
            }
        ]
    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(history, start=1):
        record = dict(item)
        version_number = int(record.get("version_number") or index)
        record["version_number"] = version_number
        record["parameter_version_id"] = str(record.get("parameter_version_id") or _parameter_version_id(strategy_id, version_number))
        record["parameters"] = dict(record.get("parameters") or fallback_parameters)
        normalized.append(record)
    return normalized


def _build_parameter_delta(
    baseline_parameters: Mapping[str, Any],
    parameter_snapshot: Mapping[str, Any],
) -> dict[str, Any]:
    delta: dict[str, Any] = {}
    for key in sorted(set(baseline_parameters) | set(parameter_snapshot)):
        baseline_value = baseline_parameters.get(key)
        candidate_value = parameter_snapshot.get(key)
        if baseline_value != candidate_value:
            delta[key] = candidate_value
    return delta


class BacktestPlatformService:
    def __init__(self, database_path: str | Path = "data/platform.sqlite3"):
        self.storage = SQLiteStorage(database_path)
        self._optimization_runner_lock = threading.Lock()
        self._optimization_runner_job_ids: set[str] = set()
        self._optimization_runner_owner_id = str(
            os.getenv("GRIT_OPTIMIZATION_RUNNER_OWNER_ID") or f"{os.getpid()}:{uuid4().hex[:12]}"
        )
        try:
            progress_snapshot_ttl = float(
                os.getenv("GRIT_OPTIMIZATION_PROGRESS_SNAPSHOT_TTL_SECONDS", "1").strip()
            )
        except (TypeError, ValueError):
            progress_snapshot_ttl = 1.0
        self._optimization_progress_snapshot_ttl_seconds = max(0.0, progress_snapshot_ttl)
        self._optimization_trial_progress_snapshot_cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._optimization_trial_progress_snapshot_cache_lock = threading.Lock()
        self._optimization_job_detail_metrics_lock = threading.Lock()
        self._optimization_job_detail_metrics: dict[str, int | float] = {
            "request_count": 0,
            "total_duration_ms": 0.0,
            "snapshot_query_count": 0,
            "snapshot_cache_hit_count": 0,
            "snapshot_cache_miss_count": 0,
        }
        self._normalize_existing_backtest_runs_to_temporary_once()

    def _new_id(self, prefix: str) -> str:
        return f"{prefix}_{uuid4().hex[:12]}"

    def _session_messages(self, session_id: str) -> list[dict[str, Any]]:
        rows = self.storage.fetch_all(
            """
            SELECT id, session_id, role, content, extracted_fields_json, created_at
            FROM strategy_creation_messages
            WHERE session_id = ?
            ORDER BY created_at ASC, id ASC
            """,
            (session_id,),
        )
        messages: list[dict[str, Any]] = []
        for row in rows:
            message = dict(row)
            message["extracted_tags"] = loads(message.pop("extracted_fields_json", None), [])
            messages.append(message)
        return messages

    def _decode_session_row(self, row: Mapping[str, Any]) -> dict[str, Any]:
        confirmation_fields = loads(row.get("confirmation_fields_json"), blank_confirmation_fields(row.get("strategy_type") or "GENERAL"))
        metadata = loads(row.get("metadata_json"), {})
        return {
            "id": row["id"],
            "status": row["status"],
            "strategy_type": row["strategy_type"],
            "universe_name": row["universe_name"],
            "rebalance_frequency": row.get("rebalance_frequency"),
            "prompt": row.get("prompt") or "",
            "revision": int(row.get("revision") or 1),
            "strategy_id": row.get("strategy_id"),
            "suggested_name": row.get("suggested_name"),
            "mode": str(metadata.get("mode") or "CREATE").upper(),
            "base_strategy_id": metadata.get("base_strategy_id"),
            "base_parameter_version_id": metadata.get("base_parameter_version_id"),
            "confirmation_fields": confirmation_fields,
            "pending_inputs": loads(row.get("pending_inputs_json"), []),
            "manual_conflicts": loads(row.get("manual_conflicts_json"), []),
            "allowed_actions": loads(row.get("allowed_actions_json"), list(DEFAULT_ALLOWED_ACTIONS)),
            "metadata": metadata,
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "top_level": _top_level_from_confirmation(
                confirmation_fields,
                {
                    "strategy_type": row.get("strategy_type"),
                    "universe_name": row.get("universe_name"),
                    "rebalance_frequency": row.get("rebalance_frequency"),
                },
            ),
        }

    def _decode_strategy_row(self, row: Mapping[str, Any]) -> dict[str, Any]:
        strategy = dict(row)
        strategy["parameters"] = loads(strategy.pop("parameters_json", None), {})
        strategy["confirmation_fields"] = loads(strategy.pop("confirmation_fields_json", None), {})
        strategy["allowed_actions"] = loads(strategy.pop("allowed_actions_json", None), [])
        strategy["name"] = _display_strategy_name(strategy.get("name"), strategy.get("parameters"))
        strategy["current_parameter_version"] = int(strategy.get("current_parameter_version") or 1)
        version_rows = self._strategy_parameter_version_rows(str(strategy["id"]))
        if version_rows:
            strategy["parameter_history"] = [
                {
                    "version_number": int(version_row.get("version_number") or index),
                    "parameter_version_id": str(
                        version_row.get("parameter_version_id")
                        or _parameter_version_id(str(strategy["id"]), int(version_row.get("version_number") or index))
                    ),
                    "revision": int(version_row.get("revision") or 1),
                    "created_at": version_row.get("created_at"),
                    "comment": version_row.get("comment"),
                    "parameters": loads(version_row.get("parameters_json"), strategy["parameters"]),
                }
                for index, version_row in enumerate(version_rows, start=1)
            ]
            strategy["current_parameter_version"] = max(
                strategy["current_parameter_version"],
                max(int(item["version_number"]) for item in strategy["parameter_history"]),
            )
        else:
            strategy["parameter_history"] = loads(strategy.pop("parameter_history_json", None), [])
            strategy["parameter_history"] = _normalize_parameter_history(
                str(strategy["id"]),
                list(strategy["parameter_history"]),
                strategy["parameters"],
                strategy["current_parameter_version"],
            )
        for entry in strategy["parameter_history"]:
            entry.setdefault("comment", None)
        strategy["current_parameter_version_id"] = _parameter_version_id(str(strategy["id"]), strategy["current_parameter_version"])
        return strategy

    def _seed_revision_confirmation_fields(self, base_strategy: Mapping[str, Any]) -> dict[str, list[dict[str, Any]]]:
        strategy_type = str(base_strategy.get("strategy_type") or "GENERAL").upper()
        seeded = _dedupe_top_level_parameters(blank_confirmation_fields(strategy_type))
        existing_entries = _entry_index(base_strategy.get("confirmation_fields"))
        default_entries = _entry_index(seeded)

        def resolve_label(key: str, fallback: str) -> str:
            return str(
                existing_entries.get(key, {}).get("label")
                or default_entries.get(key, {}).get("label")
                or fallback
            )

        def resolve_source(key: str, fallback: str) -> str:
            existing_source = str(existing_entries.get(key, {}).get("source") or "").strip()
            return existing_source or fallback

        strategy_parameters = dict(base_strategy.get("parameters") or {})
        top_level = {
            "strategy_type": strategy_type,
            "universe_name": (
                base_strategy.get("universe_name")
                or strategy_parameters.get("universe_name")
                or existing_entries.get("universe_name", {}).get("value")
                or ""
            ),
            "rebalance_frequency": (
                base_strategy.get("rebalance_frequency")
                or strategy_parameters.get("rebalance_frequency")
                or existing_entries.get("rebalance_frequency", {}).get("value")
            ),
        }
        strategy_parameters["strategy_name"] = (
            strategy_parameters.get("strategy_name")
            or base_strategy.get("name")
            or ""
        )
        strategy_parameters["benchmark_symbol"] = (
            strategy_parameters.get("benchmark_symbol")
            or base_strategy.get("benchmark_symbol")
            or "SPY"
        )
        summarized_description = _summarize_revision_description(
            strategy_type,
            top_level,
            strategy_parameters,
            fallback=_format_strategy_value(
                strategy_parameters.get("strategy_description") or base_strategy.get("description")
            )
            or None,
        )
        if summarized_description:
            strategy_parameters["strategy_description"] = summarized_description

        for key, value in top_level.items():
            _upsert_field(
                seeded["top_level"],
                key,
                resolve_label(key, key),
                value,
                resolve_source(
                    key,
                    "system_default" if key == "rebalance_frequency" else "user_input",
                ),
            )

        for key, value in strategy_parameters.items():
            if value is None:
                continue
            fallback_source = "user_input"
            if key in {"strategy_name", "strategy_description", "benchmark_symbol"}:
                fallback_source = "system_inference"
            _upsert_field(
                seeded["parameters"],
                key,
                resolve_label(key, key),
                value,
                resolve_source(key, fallback_source),
            )

        return _dedupe_top_level_parameters(seeded)

    def _apply_revision_payload_repairs(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        repaired = {
            "top_level": dict(payload.get("top_level") or {}),
            "confirmation_fields": deepcopy(payload.get("confirmation_fields") or {"top_level": [], "parameters": []}),
            "pending_inputs": [dict(item) for item in payload.get("pending_inputs", [])],
            "manual_conflicts": [dict(item) for item in payload.get("manual_conflicts", [])],
        }
        strategy_type = str(repaired["top_level"].get("strategy_type") or "GENERAL").upper()
        parameter_entries = repaired["confirmation_fields"].setdefault("parameters", [])
        parameters = {
            str(entry.get("key")): entry.get("value")
            for entry in parameter_entries
        }
        if strategy_type == "MEAN_REVERSION":
            description = _summarize_revision_description(
                strategy_type,
                repaired["top_level"],
                parameters,
                fallback=_format_strategy_value(parameters.get("strategy_description")) or None,
            )
            if description:
                _upsert_field(parameter_entries, "strategy_description", "?????????????", description, "system_inference")
            trading_logic = _summarize_revision_trading_logic(
                strategy_type,
                repaired["top_level"],
                parameters,
                fallback=_format_strategy_value(parameters.get("trading_logic")) or None,
            )
            if trading_logic:
                _upsert_field(parameter_entries, "trading_logic", "???????", trading_logic, "system_inference")

        parameter_index = {
            str(entry.get("key")): entry.get("value")
            for entry in repaired["confirmation_fields"].get("parameters", [])
        }
        top_level = _top_level_from_confirmation(repaired["confirmation_fields"], repaired["top_level"])
        repaired["top_level"] = top_level
        repaired["pending_inputs"] = [
            item
            for item in repaired["pending_inputs"]
            if (
                (item.get("key") == "universe_name" and top_level.get("universe_name") in (None, "", []))
                or (item.get("key") != "universe_name" and parameter_index.get(str(item.get("key"))) in (None, "", []))
            )
        ]
        return repaired

    def _decode_strategy_list_row(self, row: Mapping[str, Any]) -> dict[str, Any]:
        strategy = dict(row)
        strategy["parameters"] = loads(strategy.pop("parameters_json", None), {})
        strategy["name"] = _display_strategy_name(strategy.get("name"), strategy.get("parameters"))
        strategy["current_parameter_version"] = int(strategy.get("current_parameter_version") or 1)
        strategy["current_parameter_version_id"] = _parameter_version_id(
            str(strategy["id"]),
            strategy["current_parameter_version"],
        )
        return strategy

    def _summarize_strategy_sparkline(
        self,
        chart_series: list[dict[str, Any]],
        max_points: int = 48,
    ) -> list[dict[str, Any]]:
        if len(chart_series) <= max_points:
            return [
                {
                    "date": str(point.get("trade_date") or ""),
                    "equity": float(point.get("equity") or 0.0),
                    "is_oos": bool(point.get("is_oos") or False),
                }
                for point in chart_series
            ]

        last_index = len(chart_series) - 1
        step = last_index / max(max_points - 1, 1)
        sampled_indices = sorted({min(last_index, round(index * step)) for index in range(max_points)})
        return [
            {
                "date": str(chart_series[index].get("trade_date") or ""),
                "equity": float(chart_series[index].get("equity") or 0.0),
                "is_oos": bool(chart_series[index].get("is_oos") or False),
            }
            for index in sampled_indices
        ]

    def _build_strategy_latest_completed_run_summary(self, row: Mapping[str, Any]) -> dict[str, Any]:
        preview = loads(row.get("preview_json"), {})
        if not isinstance(preview, dict):
            preview = {}
        metrics = loads(row.get("metrics_json"), {})
        if not isinstance(metrics, dict):
            metrics = {}
        warnings = loads(row.get("warnings_json"), [])
        if not isinstance(warnings, list):
            warnings = []
        request = loads(row.get("request_json"), {})
        if not isinstance(request, dict):
            request = {}
        chart_series = loads(row.get("chart_series_json"), [])
        if not isinstance(chart_series, list):
            chart_series = []

        parameter_version_id = (
            preview.get("parameter_version_id")
            or request.get("parameter_version_id")
            or None
        )
        return {
            "run_id": row["id"],
            "parameter_version": _parse_parameter_version_number(parameter_version_id),
            "parameter_version_id": parameter_version_id,
            "status": row.get("status") or "COMPLETED",
            "total_return": float(metrics.get("total_return") or 0.0),
            "annualized_return": float(
                metrics.get("annualized_return", metrics.get("cagr") or 0.0) or 0.0
            ),
            "sharpe": float(metrics.get("sharpe") or 0.0),
            "max_drawdown": float(metrics.get("max_drawdown") or 0.0),
            "oos_total_return": float(metrics.get("oos_total_return", metrics.get("oos_return") or 0.0) or 0.0),
            "oos_annualized_return": float(
                metrics.get("oos_annualized_return", metrics.get("oos_cagr") or 0.0) or 0.0
            ),
            "oos_sharpe": float(metrics.get("oos_sharpe") or 0.0),
            "oos_max_drawdown": float(metrics.get("oos_max_drawdown") or 0.0),
            "warning_count": len(warnings),
            "execution_policy": str(request.get("execution_policy") or "T_CLOSE_TO_T1_OPEN"),
            "dataset_snapshot_id": str(request.get("dataset_snapshot_id") or ""),
            "universe_snapshot_id": str(request.get("universe_snapshot_id") or ""),
            "completed_at": row.get("completed_at"),
            "sparkline_points": self._summarize_strategy_sparkline(chart_series),
        }

    def _load_latest_completed_run_summaries(self, run_ids: list[str]) -> dict[str, dict[str, Any]]:
        normalized_ids = [str(run_id) for run_id in run_ids if run_id]
        if not normalized_ids:
            return {}

        placeholders = ", ".join("?" for _ in normalized_ids)
        rows = self.storage.fetch_all(
            f"""
            SELECT
                id,
                status,
                preview_json,
                metrics_json,
                warnings_json,
                request_json,
                chart_series_json,
                completed_at
            FROM backtest_runs
            WHERE id IN ({placeholders})
              AND deleted_at IS NULL
            """,
            tuple(normalized_ids),
        )
        return {
            str(row["id"]): self._build_strategy_latest_completed_run_summary(row)
            for row in rows
        }

    def _resolve_strategy_run_refs(self, strategy_id: str) -> dict[str, str | None]:
        row = self.storage.fetch_one(
            """
            SELECT
                (
                    SELECT id
                    FROM backtest_runs
                    WHERE strategy_id = ?
                      AND deleted_at IS NULL
                    ORDER BY COALESCE(completed_at, created_at) DESC, created_at DESC, id DESC
                    LIMIT 1
                ) AS latest_run_id,
                (
                    SELECT id
                    FROM backtest_runs
                    WHERE strategy_id = ?
                      AND deleted_at IS NULL
                      AND UPPER(COALESCE(status, '')) IN ('COMPLETED', 'COMPLETED_WITH_WARNINGS')
                    ORDER BY COALESCE(completed_at, created_at) DESC, created_at DESC, id DESC
                    LIMIT 1
                ) AS latest_successful_run_id
            """,
            (strategy_id, strategy_id),
        ) or {}
        return {
            "latest_run_id": row.get("latest_run_id"),
            "latest_successful_run_id": row.get("latest_successful_run_id"),
        }

    def _with_live_strategy_run_refs(self, row: Mapping[str, Any]) -> dict[str, Any]:
        strategy = dict(row)
        strategy_id = str(strategy.get("id") or "")
        if not strategy_id:
            return strategy
        strategy.update(self._resolve_strategy_run_refs(strategy_id))
        return strategy

    def _sync_strategy_run_refs(self, strategy_id: str) -> None:
        refs = self._resolve_strategy_run_refs(strategy_id)
        self.storage.execute(
            """
            UPDATE strategies
            SET latest_run_id = ?, latest_successful_run_id = ?
            WHERE id = ?
            """,
            (refs["latest_run_id"], refs["latest_successful_run_id"], strategy_id),
        )

    def _strategy_parameter_version_rows(self, strategy_id: str) -> list[dict[str, Any]]:
        try:
            return self.storage.fetch_all(
                """
                SELECT *
                FROM strategy_parameter_versions
                WHERE strategy_id = ?
                ORDER BY version_number ASC, revision ASC, created_at ASC, parameter_version_id ASC
                """,
                (strategy_id,),
            )
        except Exception:
            return []

    def _persist_strategy_parameter_version(
        self,
        strategy_id: str,
        *,
        version_number: int,
        revision: int,
        parameters: Mapping[str, Any],
        created_at: str,
        comment: str | None = None,
    ) -> None:
        self.storage.insert_json_row(
            "strategy_parameter_versions",
            {
                "parameter_version_id": _parameter_version_id(strategy_id, version_number),
                "strategy_id": strategy_id,
                "version_number": version_number,
                "revision": revision,
                "comment": comment,
                "parameters_json": dumps(dict(parameters)),
                "created_at": created_at,
            },
        )

    def _read_runtime_state(self, state_key: str) -> dict[str, Any]:
        row = self.storage.fetch_one("SELECT * FROM app_runtime_state WHERE state_key = ?", (state_key,))
        if not row:
            return {}
        return {
            "state_key": row["state_key"],
            "state_json": loads(row.get("state_json"), {}),
            "updated_at": row.get("updated_at"),
        }

    def _write_runtime_state(self, state_key: str, state: Mapping[str, Any]) -> None:
        now = iso_now()
        self.storage.insert_json_row(
            "app_runtime_state",
            {
                "state_key": state_key,
                "state_json": dumps(dict(state)),
                "updated_at": now,
            },
        )

    def _optimization_runner_claim_key(self, job_id: str) -> str:
        return f"{OPTIMIZATION_RUNNER_CLAIM_PREFIX}{job_id}"

    def _optimization_runner_claim_payload(self, job_id: str, *, heartbeat_at: str | None = None) -> dict[str, Any]:
        return {
            "job_id": job_id,
            "owner_id": self._optimization_runner_owner_id,
            "pid": os.getpid(),
            "heartbeat_at": heartbeat_at or self._optimization_timestamp_now(),
        }

    def _optimization_runner_process_is_active(self, pid: Any) -> bool:
        process_id = _as_int(pid, 0)
        if process_id <= 0:
            return False
        if process_id == os.getpid():
            return True
        try:
            os.kill(process_id, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        except OSError:
            return False
        return True

    def _optimization_runner_claim_is_stale(self, heartbeat_at: Any, *, pid: Any = None) -> bool:
        if pid is not None and not self._optimization_runner_process_is_active(pid):
            return True
        heartbeat_text = str(heartbeat_at or "").strip()
        if not heartbeat_text:
            return True
        try:
            heartbeat_value = datetime.fromisoformat(heartbeat_text.replace("Z", "+00:00"))
        except ValueError:
            return True
        return (utc_now() - heartbeat_value).total_seconds() >= OPTIMIZATION_RUNNER_LEASE_SECONDS

    def _try_acquire_optimization_runner_claim(self, job_id: str) -> bool:
        claim_key = self._optimization_runner_claim_key(job_id)
        heartbeat_at = self._optimization_timestamp_now()
        claim_payload = self._optimization_runner_claim_payload(job_id, heartbeat_at=heartbeat_at)
        with self.storage.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT state_json, updated_at FROM app_runtime_state WHERE state_key = ?",
                (claim_key,),
            ).fetchone()
            existing_state = loads(row.get("state_json"), {}) if row else {}
            existing_owner_id = str(existing_state.get("owner_id") or "").strip()
            existing_heartbeat_at = existing_state.get("heartbeat_at") or (row.get("updated_at") if row else None)
            if (
                existing_owner_id
                and existing_owner_id != self._optimization_runner_owner_id
                and not self._optimization_runner_claim_is_stale(
                    existing_heartbeat_at,
                    pid=existing_state.get("pid"),
                )
            ):
                return False
            conn.execute(
                """
                INSERT INTO app_runtime_state (state_key, state_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(state_key) DO UPDATE SET
                    state_json = excluded.state_json,
                    updated_at = excluded.updated_at
                """,
                (claim_key, dumps(claim_payload), heartbeat_at),
            )
        return True

    def _refresh_optimization_runner_claim(self, job_id: str) -> bool:
        claim_key = self._optimization_runner_claim_key(job_id)
        heartbeat_at = self._optimization_timestamp_now()
        with self.storage.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT state_json FROM app_runtime_state WHERE state_key = ?",
                (claim_key,),
            ).fetchone()
            if not row:
                return False
            claim_state = loads(row.get("state_json"), {})
            if str(claim_state.get("owner_id") or "").strip() != self._optimization_runner_owner_id:
                return False
            claim_payload = {
                **claim_state,
                "job_id": job_id,
                "owner_id": self._optimization_runner_owner_id,
                "pid": os.getpid(),
                "heartbeat_at": heartbeat_at,
            }
            conn.execute(
                "UPDATE app_runtime_state SET state_json = ?, updated_at = ? WHERE state_key = ?",
                (dumps(claim_payload), heartbeat_at, claim_key),
            )
        return True

    def _release_optimization_runner_claim(self, job_id: str) -> None:
        claim_key = self._optimization_runner_claim_key(job_id)
        with self.storage.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT state_json FROM app_runtime_state WHERE state_key = ?",
                (claim_key,),
            ).fetchone()
            if not row:
                return
            claim_state = loads(row.get("state_json"), {})
            if str(claim_state.get("owner_id") or "").strip() != self._optimization_runner_owner_id:
                return
            conn.execute("DELETE FROM app_runtime_state WHERE state_key = ?", (claim_key,))

    def _clear_optimization_runner_claim(self, job_id: str) -> None:
        claim_key = self._optimization_runner_claim_key(job_id)
        with self.storage.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute("DELETE FROM app_runtime_state WHERE state_key = ?", (claim_key,))

    def _adopt_optimization_runner_claim(self, job_id: str, pid: int) -> bool:
        claim_key = self._optimization_runner_claim_key(job_id)
        heartbeat_at = self._optimization_timestamp_now()
        with self.storage.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT state_json FROM app_runtime_state WHERE state_key = ?",
                (claim_key,),
            ).fetchone()
            if not row:
                return False
            claim_state = loads(row.get("state_json"), {})
            if str(claim_state.get("owner_id") or "").strip() != self._optimization_runner_owner_id:
                return False
            claim_payload = {
                **claim_state,
                "job_id": job_id,
                "owner_id": self._optimization_runner_owner_id,
                "pid": int(pid),
                "heartbeat_at": heartbeat_at,
            }
            conn.execute(
                "UPDATE app_runtime_state SET state_json = ?, updated_at = ? WHERE state_key = ?",
                (dumps(claim_payload), heartbeat_at, claim_key),
            )
        return True

    def _optimization_runner_mode(self) -> str:
        configured = str(os.getenv("GRIT_OPTIMIZATION_RUNNER_MODE") or "").strip().lower()
        if configured in {"thread", "subprocess"}:
            return configured
        if os.getenv("PYTEST_CURRENT_TEST"):
            return "thread"
        return "subprocess"

    def _optimization_worker_project_root(self) -> Path:
        return Path(__file__).resolve().parents[2]

    def _optimization_worker_src_root(self) -> Path:
        return Path(__file__).resolve().parents[1]

    def _build_optimization_runner_subprocess_command(self, job_id: str) -> tuple[list[str], dict[str, str], Path]:
        project_root = self._optimization_worker_project_root()
        src_root = self._optimization_worker_src_root()
        env = os.environ.copy()
        existing_pythonpath = str(env.get("PYTHONPATH") or "").strip()
        env["PYTHONPATH"] = (
            f"{src_root}{os.pathsep}{existing_pythonpath}" if existing_pythonpath else str(src_root)
        )
        env["GRIT_BACKTEST_DB"] = str(self.storage.path)
        env["GRIT_OPTIMIZATION_RUNNER_OWNER_ID"] = self._optimization_runner_owner_id
        command = [
            sys.executable,
            "-m",
            "grit_backtest_platform.main",
            "run-optimization",
            "--db-path",
            str(self.storage.path),
            "--job-id",
            job_id,
        ]
        return command, env, project_root

    def run_optimization_job_worker(self, job_id: str) -> bool:
        row = self.storage.fetch_one(
            "SELECT * FROM optimization_jobs WHERE id = ? AND deleted_at IS NULL",
            (job_id,),
        )
        if not row:
            raise KeyError(f"Optimization job not found: {job_id}")
        strategy_id = str(row.get("strategy_id") or "").strip()
        if not strategy_id:
            raise ValueError("Optimization job is missing strategy_id")
        payload = loads(row.get("request_json"), {})
        existing_candidates = list(loads(row.get("candidates_json"), []))
        created_at = str(row.get("created_at") or iso_now())
        if not self._try_acquire_optimization_runner_claim(job_id):
            return False
        try:
            self._run_real_optimization_job(
                job_id,
                strategy_id,
                payload,
                created_at=created_at,
                existing_candidates=existing_candidates,
                recovered=True,
            )
        finally:
            self._release_optimization_runner_claim(job_id)
        return True

    def _optimization_trial_progress_snapshot(
        self,
        job_id: str,
        job_updated_at: str | None = None,
    ) -> dict[str, Any]:
        snapshot_key = f"{job_id}:{str(job_updated_at or '').strip()}"
        ttl_seconds = self._optimization_progress_snapshot_ttl_seconds
        should_cache = ttl_seconds > 0.0 and bool(snapshot_key)
        now = time.perf_counter()
        with self._optimization_job_detail_metrics_lock:
            self._optimization_job_detail_metrics["snapshot_query_count"] += 1
        cache_hit = False
        if should_cache:
            with self._optimization_trial_progress_snapshot_cache_lock:
                expired_keys = [
                    cache_key
                    for cache_key, (cached_at, _)
                    in self._optimization_trial_progress_snapshot_cache.items()
                    if now - cached_at > ttl_seconds
                ]
                for cache_key in expired_keys:
                    self._optimization_trial_progress_snapshot_cache.pop(cache_key, None)
                cached = self._optimization_trial_progress_snapshot_cache.get(snapshot_key)
                if cached is not None and (now - cached[0]) <= ttl_seconds:
                    cache_hit = True
                    with self._optimization_job_detail_metrics_lock:
                        self._optimization_job_detail_metrics["snapshot_cache_hit_count"] += 1
                    return dict(cached[1])
        row = self.storage.fetch_one(
            """
            SELECT
                COUNT(*) AS persisted_trial_count,
                MAX(trial_index) AS max_trial_index,
                MAX(completed_at) AS latest_completed_at
            FROM optimization_job_trials
            WHERE job_id = ?
            """,
            (job_id,),
        )
        if not row:
            snapshot = {
                "persisted_trial_count": 0,
                "next_trial_index": 1,
                "completed_combinations": 0,
                "latest_completed_at": None,
            }
            if should_cache:
                with self._optimization_trial_progress_snapshot_cache_lock:
                    self._optimization_trial_progress_snapshot_cache[snapshot_key] = (now, dict(snapshot))
            if not cache_hit:
                with self._optimization_job_detail_metrics_lock:
                    self._optimization_job_detail_metrics["snapshot_cache_miss_count"] += 1
            return snapshot
        persisted_trial_count = _as_int(row.get("persisted_trial_count"), 0)
        max_trial_index = _as_int(row.get("max_trial_index"), 0)
        next_trial_index = max(1, max_trial_index + 1)
        latest_completed_at = str(row.get("latest_completed_at") or "").strip() or None
        snapshot = {
            "persisted_trial_count": persisted_trial_count,
            "next_trial_index": next_trial_index,
            "completed_combinations": persisted_trial_count,
            "latest_completed_at": latest_completed_at,
        }
        if should_cache:
            with self._optimization_trial_progress_snapshot_cache_lock:
                self._optimization_trial_progress_snapshot_cache[snapshot_key] = (now, dict(snapshot))
        if not cache_hit:
            with self._optimization_job_detail_metrics_lock:
                self._optimization_job_detail_metrics["snapshot_cache_miss_count"] += 1
        return snapshot

    def _optimization_trial_best_summary_snapshot(self, job_id: str) -> dict[str, Any] | None:
        successful_trials = [
            dict(trial)
            for trial in self._load_optimization_trials(
                job_id,
                include_chart_series=False,
                include_metrics_json=True,
            )
            if str(trial.get("status") or "").upper() == "SUCCEEDED"
        ]
        return self._best_optimization_trial_summary(successful_trials)

    def _normalize_existing_backtest_runs_to_temporary_once(self) -> int:
        migration_key = "backtest_runs_force_temporary_once_v1"
        migration_state = self._read_runtime_state(migration_key)
        if migration_state.get("state_json", {}).get("applied"):
            return int(migration_state.get("state_json", {}).get("converted_count") or 0)

        rows = self.storage.fetch_all("SELECT id, is_permanent, request_json FROM backtest_runs")
        converted = 0
        now = iso_now()
        for row in rows:
            request_payload = loads(row.get("request_json"), {})
            needs_update = bool(int(row.get("is_permanent") or 0)) or request_payload.get("is_permanent") is not False
            request_payload["is_permanent"] = False
            if needs_update:
                self.storage.execute(
                    "UPDATE backtest_runs SET is_permanent = 0, request_json = ?, updated_at = ? WHERE id = ?",
                    (dumps(request_payload), now, row["id"]),
                )
                converted += 1

        self._write_runtime_state(
            migration_key,
            {
                "applied": True,
                "applied_at": now,
                "converted_count": converted,
            },
        )
        return converted

    def _write_strategy_record(
        self,
        strategy_row: Mapping[str, Any],
        *,
        parameter_history: list[dict[str, Any]],
        current_version: int,
        comment: str | None = None,
    ) -> None:
        row = dict(strategy_row)
        row["current_parameter_version"] = current_version
        row["parameter_history_json"] = dumps(parameter_history)
        row["updated_at"] = iso_now()
        self.storage.insert_json_row("strategies", row)
        strategy_id = str(row["id"])
        for entry in parameter_history:
            version_number = int(entry.get("version_number") or 1)
            self._persist_strategy_parameter_version(
                strategy_id,
                version_number=version_number,
                revision=int(entry.get("revision") or 1),
                parameters=entry.get("parameters") or {},
                created_at=str(entry.get("created_at") or row["updated_at"]),
                comment=entry.get("comment") if entry.get("comment") is not None else (comment if version_number == current_version else None),
            )

    def _cleanup_path_within_workspace(self, path: Path) -> None:
        try:
            resolved = path.resolve(strict=False)
        except Exception:
            return
        workspace_root = self.storage.path.parent.resolve(strict=False)
        try:
            resolved.relative_to(workspace_root)
        except ValueError:
            return
        if resolved.is_dir():
            shutil.rmtree(resolved, ignore_errors=True)
        elif resolved.exists():
            try:
                resolved.unlink()
            except FileNotFoundError:
                pass

    def _cleanup_run_artifacts(self, run_id: str, artifact_paths: list[Any]) -> None:
        for artifact_path in artifact_paths:
            if not artifact_path:
                continue
            self._cleanup_path_within_workspace(Path(str(artifact_path)))
        self._cleanup_path_within_workspace(self.storage.path.parent / "web" / "dist" / "plots" / run_id)

    def purge_expired_temporary_runs(self) -> int:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        rows = self.storage.fetch_all(
            """
            SELECT *
            FROM backtest_runs
            WHERE COALESCE(is_permanent, 1) = 0
              AND deleted_at IS NULL
            ORDER BY created_at ASC
            """
        )
        removed = 0
        deleted_at = iso_now()
        affected_strategy_ids: set[str] = set()
        for row in rows:
            created_at = str(row.get("created_at") or "")
            try:
                created_value = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            except ValueError:
                continue
            if created_value >= cutoff:
                continue
            self._cleanup_run_artifacts(str(row["id"]), loads(row.get("artifact_paths_json"), []))
            self.storage.execute(
                """
                UPDATE backtest_runs
                SET status = ?, deleted_at = ?, deleted_reason = ?, artifact_paths_json = ?, updated_at = ?
                WHERE id = ?
                """,
                ("DELETED", deleted_at, "temporary_run_ttl_24h", "[]", deleted_at, row["id"]),
            )
            affected_strategy_ids.add(str(row.get("strategy_id") or ""))
            removed += 1
        for strategy_id in sorted(item for item in affected_strategy_ids if item):
            self._sync_strategy_run_refs(strategy_id)
        self._write_runtime_state(
            "cleanup_audit",
            {
                "last_cleanup_count": removed,
                "last_cleanup_at": iso_now(),
            },
        )
        return removed

    def _normalize_backtest_run_detail_view(self, view: str | None) -> str:
        normalized = str(view or "full").strip().lower()
        if normalized in {"full", "initial", "context", "trades", "metrics"}:
            return normalized
        return "full"

    def _backtest_run_json_columns(
        self,
        *,
        view: str = "full",
        include_trade_audit: bool = False,
    ) -> list[str]:
        normalized_view = self._normalize_backtest_run_detail_view(view)
        if normalized_view == "initial":
            columns = [
                "warnings_json",
                "metrics_json",
                "parameter_snapshot_json",
                "drawdown_events_json",
                "rolling_metrics_json",
                "monthly_returns_json",
                "chart_series_json",
                "trades_json",
                "trade_audit_items_json",
            ]
        elif normalized_view == "context":
            columns = [
                "request_json",
                "preview_json",
                "parameter_snapshot_json",
                "environment_summary_json",
                "trade_audit_items_json",
            ]
        elif normalized_view == "trades":
            columns = [
                "trades_json",
            ]
        elif normalized_view == "metrics":
            columns = [
                "metrics_json",
            ]
        else:
            columns = [
                "warnings_json",
                "request_json",
                "preview_json",
                "metrics_json",
                "parameter_snapshot_json",
                "environment_summary_json",
                "relative_metrics_json",
                "consistency_score_json",
                "risk_metrics_json",
                "drawdown_events_json",
                "rolling_metrics_json",
                "monthly_returns_json",
                "chart_series_json",
                "trades_json",
                "artifact_paths_json",
                "trade_audit_items_json",
            ]
        if include_trade_audit and "trade_audit_json" not in columns:
            columns.append("trade_audit_json")
        return columns

    def _decode_run_row(
        self,
        row: Mapping[str, Any],
        *,
        view: str = "full",
        include_trade_audit: bool = False,
    ) -> dict[str, Any]:
        run = dict(row)
        columns = self._backtest_run_json_columns(view=view, include_trade_audit=include_trade_audit)
        for column in columns:
            decoded_name = column.removesuffix("_json")
            default: Any = [] if decoded_name in {
                "warnings",
                "drawdown_events",
                "rolling_metrics",
                "monthly_returns",
                "chart_series",
                "trades",
                "artifact_paths",
                "trade_audit_items",
                "trade_audit",
            } else {}
            run[decoded_name] = loads(run.pop(column, None), default)
        run["is_permanent"] = bool(int(run.get("is_permanent") or 0))
        return run

    def _backtest_run_select_columns(
        self,
        *,
        view: str = "full",
        include_trade_audit: bool = False,
    ) -> str:
        columns = [
            "id",
            "strategy_id",
            "status",
            "source_run_id",
            "request_kind",
            "is_permanent",
            "start_date",
            "end_date",
            "effective_date",
            "oos_start_date",
            "coverage_ratio",
            "coverage_days",
            "trades_count",
            "error_message",
            "deleted_at",
            "deleted_reason",
            "created_at",
            "updated_at",
            "completed_at",
        ]
        insert_at = columns.index("trades_count")
        for json_column in self._backtest_run_json_columns(view=view, include_trade_audit=include_trade_audit):
            columns.insert(insert_at, json_column)
            insert_at += 1
        return ", ".join(columns)

    def _decode_run_list_row(self, row: Mapping[str, Any]) -> dict[str, Any]:
        preview = loads(row.get("preview_json"), {})
        if not isinstance(preview, dict):
            preview = {}
        request = loads(row.get("request_json"), {})
        if not isinstance(request, dict):
            request = {}
        metrics = loads(row.get("metrics_json"), {})
        if not isinstance(metrics, dict):
            metrics = {}
        parameter_snapshot = loads(row.get("parameter_snapshot_json"), {})
        if not isinstance(parameter_snapshot, dict):
            parameter_snapshot = {}
        warnings = loads(row.get("warnings_json"), [])
        if not isinstance(warnings, list):
            warnings = []
        parameter_version_id = preview.get("parameter_version_id") or request.get("parameter_version_id")

        return {
            "id": row["id"],
            "strategy_id": row["strategy_id"],
            "strategy_name": _display_strategy_name(row.get("strategy_name"), parameter_snapshot),
            "status": row["status"],
            "start_date": row.get("start_date"),
            "end_date": row.get("end_date"),
            "effective_date": row.get("effective_date"),
            "oos_start_date": row.get("oos_start_date"),
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
            "completed_at": row.get("completed_at"),
            "metrics": metrics,
            "warnings": warnings,
            "preview": {
                "effective_date": preview.get("effective_date"),
                "effective_start_date": preview.get("effective_start_date"),
                "effective_end_date": preview.get("effective_end_date"),
                "oos_start_date": preview.get("oos_start_date"),
                "data_segment_type": preview.get("data_segment_type"),
                "parameter_version_id": parameter_version_id,
            },
            "data_segment_type": preview.get("data_segment_type"),
            "parameter_version_id": parameter_version_id,
            "is_permanent": bool(int(row.get("is_permanent") or 0)),
            "source_run_id": row.get("source_run_id"),
            "trades_count": row.get("trades_count"),
        }

    def _flatten_confirmation(self, confirmation_fields: Mapping[str, Any], top_level: Mapping[str, Any]) -> dict[str, Any]:
        parameters = {str(item.get("key")): item.get("value") for item in confirmation_fields.get("parameters", [])}
        parameters["strategy_type"] = top_level.get("strategy_type")
        parameters["universe_name"] = top_level.get("universe_name")
        parameters["rebalance_frequency"] = top_level.get("rebalance_frequency")
        return parameters

    def _session_allowed_actions(self, status: str) -> list[str]:
        if status == "LOCKED":
            return ["run_backtest", "refresh_snapshots", "open_strategy"]
        if status == "READY_FOR_CONFIRMATION":
            return ["override_field", "materialize", "edit_prompt"]
        if status == "NEEDS_INPUT":
            return ["edit_prompt", "override_field", "prepare_confirmation"]
        return list(DEFAULT_ALLOWED_ACTIONS)

    def _build_suggested_name(self, top_level: Mapping[str, Any]) -> str:
        universe_name = str(top_level.get("universe_name") or "").strip()
        strategy_type = str(top_level.get("strategy_type") or "GENERAL").upper()
        strategy_label = STRATEGY_TYPE_TITLES.get(strategy_type, strategy_type)
        return " ".join(part for part in [universe_name, strategy_label] if part) or strategy_label

    def _build_message_extracted_tags(
        self,
        before_session: Mapping[str, Any],
        after_session: Mapping[str, Any],
    ) -> list[dict[str, str]]:
        before_entries = _entry_index(before_session.get("confirmation_fields"))
        after_entries = _entry_index(after_session.get("confirmation_fields"))
        before_conflicts = _conflict_index(before_session.get("manual_conflicts"))
        after_conflicts = _conflict_index(after_session.get("manual_conflicts"))
        ordered_keys = [str(entry.get("key") or "").strip() for entry in _confirmation_entries(after_session.get("confirmation_fields"))]
        tags: list[dict[str, str]] = []
        seen: set[str] = set()

        for key in ordered_keys:
            if not key or key in seen or key == "strategy_type":
                continue

            after_entry = after_entries.get(key)
            if not after_entry:
                continue

            label = str(after_entry.get("label") or key)
            after_value = _stringify_tag_value(after_entry.get("value"))
            after_source = str(after_entry.get("source") or "")
            before_entry = before_entries.get(key, {})
            before_value = _stringify_tag_value(before_entry.get("value"))
            before_source = str(before_entry.get("source") or "")
            synced_changed = (
                after_source in {"user_input", "system_inference"}
                and bool(after_value)
                and (after_value != before_value or after_source != before_source)
            )

            after_conflict = after_conflicts.get(key)
            before_conflict = before_conflicts.get(key)
            conflict_changed = (
                after_source == "manual_override"
                and _manual_conflict_changed(before_conflict, after_conflict)
            )

            if synced_changed:
                tags.append(
                    {
                        "key": key,
                        "label": label,
                        "value": after_value,
                        "status": "synced",
                    }
                )
                seen.add(key)
                continue

            if conflict_changed:
                manual_value = _stringify_tag_value(
                    after_conflict.get("manual_value") if after_conflict else after_entry.get("value")
                )
                if manual_value:
                    tags.append(
                        {
                            "key": key,
                            "label": label,
                            "value": manual_value,
                            "status": "manual_override_preserved",
                        }
                    )
                    seen.add(key)

        return tags

    def _backfill_missing_message_extracted_tags(self, session_id: str, strategy_type: str | None = None) -> bool:
        session_row = self.storage.fetch_one("SELECT * FROM strategy_creation_sessions WHERE id = ?", (session_id,))
        session_meta = self._decode_session_row(session_row) if session_row else None
        revision_base_confirmation = None
        if session_meta and str(session_meta.get("mode") or "").upper() == "REVISION" and session_meta.get("base_strategy_id"):
            try:
                revision_base_confirmation = self._seed_revision_confirmation_fields(
                    self.get_strategy_detail(str(session_meta["base_strategy_id"]))
                )
            except KeyError:
                revision_base_confirmation = None
        rows = self.storage.fetch_all(
            """
            SELECT id, role, content, extracted_fields_json, created_at
            FROM strategy_creation_messages
            WHERE session_id = ?
            ORDER BY created_at ASC, id ASC
            """,
            (session_id,),
        )
        if not rows:
            return False

        forced_type = str(strategy_type or "").upper() or None
        if forced_type == "GENERAL":
            forced_type = None

        running_messages: list[dict[str, Any]] = []
        current_confirmation = deepcopy(revision_base_confirmation) if revision_base_confirmation else None
        updated = False

        for row in rows:
            before_payload = build_confirmation(
                running_messages,
                existing=current_confirmation,
                forced_type=forced_type,
            )
            if revision_base_confirmation:
                before_payload = self._apply_revision_payload_repairs(before_payload)
            running_messages.append({"role": row.get("role"), "content": row.get("content")})
            after_payload = build_confirmation(
                running_messages,
                existing=before_payload["confirmation_fields"],
                forced_type=forced_type,
            )
            if revision_base_confirmation:
                after_payload = self._apply_revision_payload_repairs(after_payload)
            current_confirmation = after_payload["confirmation_fields"]

            existing_tags = loads(row.get("extracted_fields_json"), [])
            if str(row.get("role") or "") == "user":
                tags = self._build_message_extracted_tags(
                    {
                        "confirmation_fields": before_payload["confirmation_fields"],
                        "manual_conflicts": before_payload["manual_conflicts"],
                    },
                    {
                        "confirmation_fields": after_payload["confirmation_fields"],
                        "manual_conflicts": after_payload["manual_conflicts"],
                    },
                )
                if tags != existing_tags:
                    self.storage.execute(
                        "UPDATE strategy_creation_messages SET extracted_fields_json = ? WHERE id = ?",
                        (dumps(tags), row["id"]),
                    )
                    updated = True

        return updated

    def _parameter_snapshot_for_version(self, strategy: Mapping[str, Any], parameter_version_id: str | None = None) -> dict[str, Any]:
        if not parameter_version_id:
            return dict(strategy.get("parameters") or {})
        for entry in strategy.get("parameter_history", []):
            if entry.get("parameter_version_id") == parameter_version_id:
                return dict(entry.get("parameters") or {})
        raise KeyError(f"Parameter version not found: {parameter_version_id}")

    def _resolve_expected_base_parameter_version_id(
        self,
        strategy: Mapping[str, Any],
        *sources: Any,
    ) -> str | None:
        for source in sources:
            candidate = str(source or "").strip()
            if candidate:
                return candidate
        current = str(strategy.get("current_parameter_version_id") or "").strip()
        return current or None

    def _assert_base_parameter_version_is_fresh(
        self,
        strategy: Mapping[str, Any],
        expected_base_parameter_version_id: str | None,
        *,
        blocking_target_id: str,
    ) -> str:
        current_base_parameter_version_id = str(strategy.get("current_parameter_version_id") or "").strip()
        if (
            expected_base_parameter_version_id
            and current_base_parameter_version_id
            and expected_base_parameter_version_id != current_base_parameter_version_id
        ):
            raise ContractConflictError(
                "stale_base_parameter_version",
                "The strategy has moved to a newer parameter version.",
                blocking_target={"type": "strategy", "id": blocking_target_id},
                next_action="refresh_strategy_detail",
                extra={
                    "expected_base_parameter_version_id": expected_base_parameter_version_id,
                    "current_parameter_version_id": current_base_parameter_version_id,
                },
            )
        return current_base_parameter_version_id

    def _build_candidate_record(
        self,
        *,
        strategy: Mapping[str, Any],
        parameter_snapshot: Mapping[str, Any],
        base_parameter_version_id: str | None,
        label: str | None = None,
        metrics: Mapping[str, Any] | None = None,
        summary: str | None = None,
        rank: int | None = None,
        score: float | None = None,
        status: str = "SUCCEEDED",
        title: str | None = None,
        status_label: str | None = None,
        analysis: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        snapshot = dict(parameter_snapshot)
        if not snapshot:
            raise ValueError("parameter_snapshot is required")
        candidate_rank = rank if rank is not None else 1
        candidate_label = self._canonical_optimization_candidate_label(label, candidate_rank)
        return {
            "id": self._new_id("trial"),
            "label": candidate_label,
            "status": status,
            "rank": candidate_rank,
            "score": score,
            "summary": summary,
            "metrics": dict(metrics or {}),
            "base_parameter_version_id": base_parameter_version_id,
            "parameter_snapshot": snapshot,
            "parameter_delta": _build_parameter_delta(strategy.get("parameters") or {}, snapshot),
            "allowed_actions": ["promote_candidate", "create_copy"] if status == "SUCCEEDED" else [],
            "title": title,
            "status_label": status_label,
            "analysis": dict(analysis or {}),
        }

    def _canonical_optimization_candidate_label(self, label: Any, rank: int | None) -> str:
        normalized_rank = rank if isinstance(rank, int) and rank > 0 else 1
        fallback = f"候选 {normalized_rank}"
        candidate_label = str(label or "").strip()
        if not candidate_label:
            return fallback
        if any(ord(char) < 32 or 0x7F <= ord(char) <= 0x9F or 0xE000 <= ord(char) <= 0xF8FF for char in candidate_label):
            return fallback
        if candidate_label.count("?") >= 2:
            return fallback
        return candidate_label

    def _normalize_optimization_candidate(
        self,
        strategy: Mapping[str, Any],
        candidate: Mapping[str, Any],
        *,
        rank: int,
        base_parameter_version_id: str | None,
    ) -> dict[str, Any]:
        strategy_parameters = dict(strategy.get("parameters") or {})
        parameter_snapshot = dict(candidate.get("parameter_snapshot") or strategy_parameters)
        parameter_delta = _build_parameter_delta(strategy_parameters, parameter_snapshot)
        metrics = {
            str(key): float(value)
            for key, value in dict(candidate.get("metrics") or {}).items()
            if isinstance(value, (int, float)) and not isinstance(value, bool)
        }
        score = candidate.get("score")
        if not isinstance(score, (int, float)) or isinstance(score, bool):
            score = metrics.get("sharpe") or metrics.get("total_return") or 0.0
        normalized_rank = int(candidate.get("rank") or rank)
        return {
            "id": str(candidate.get("id") or self._new_id("trial")),
            "label": self._canonical_optimization_candidate_label(candidate.get("label"), normalized_rank),
            "summary": candidate.get("summary"),
            "status": str(candidate.get("status") or "SUCCEEDED"),
            "rank": normalized_rank,
            "score": float(score),
            "parameter_snapshot": parameter_snapshot,
            "parameter_delta": parameter_delta,
            "metrics": metrics,
            "base_parameter_version_id": str(
                candidate.get("base_parameter_version_id")
                or base_parameter_version_id
                or ""
            )
            or None,
            "allowed_actions": list(
                candidate.get("allowed_actions")
                or (["promote_candidate", "create_copy"] if str(candidate.get("status") or "SUCCEEDED") == "SUCCEEDED" else [])
            ),
            "title": candidate.get("title"),
            "status_label": candidate.get("status_label"),
            "analysis": _localize_optimization_analysis(candidate.get("analysis")),
        }

    def _normalize_optimization_search_space(
        self,
        strategy: Mapping[str, Any],
        payload: Mapping[str, Any],
    ) -> list[dict[str, Any]]:
        provided = payload.get("search_space")
        if isinstance(provided, list) and provided:
            normalized_entries: list[dict[str, Any]] = []
            for raw_entry in provided:
                entry = dict(raw_entry or {})
                key = str(entry.get("key") or "").strip()
                if not key:
                    continue
                mode = str(entry.get("mode") or "fixed").strip().lower()
                normalized_mode = "range" if mode == "range" else "discrete" if mode == "discrete" else "fixed"
                values = entry.get("values")
                normalized_values = (
                    [item for item in values if item not in (None, "")]
                    if isinstance(values, list)
                    else None
                )
                normalized_entries.append(
                    {
                        "key": key,
                        "label": str(entry.get("label") or key),
                        "mode": normalized_mode,
                        "current": entry.get("current"),
                        "start": entry.get("start", entry.get("value")),
                        "end": entry.get("end", entry.get("value")),
                        "step": entry.get("step"),
                        "value": entry.get("value", entry.get("current")),
                        "values": normalized_values,
                        "tag": entry.get("tag"),
                    }
                )
            if normalized_entries:
                return normalized_entries

        parameters = dict(strategy.get("parameters") or {})
        strategy_type = str(strategy.get("strategy_type") or parameters.get("strategy_type") or "GENERAL").upper()
        template = STRATEGY_TEMPLATES.get(strategy_type, STRATEGY_TEMPLATES["GENERAL"])
        template_entries = {field.key: field for field in getattr(template, "fields", [])}
        confirmation_entries = _entry_index(strategy.get("confirmation_fields"))
        preferred_keys = [
            key
            for key in OPTIMIZATION_SELECTION_KEYS.get(strategy_type, ())
            if key in parameters and key not in OPTIMIZATION_IGNORED_KEYS
        ]
        candidate_keys = preferred_keys or [
            key for key in parameters.keys() if key not in OPTIMIZATION_IGNORED_KEYS
        ]

        def resolve_label(key: str) -> str:
            return str(
                confirmation_entries.get(key, {}).get("label")
                or getattr(template_entries.get(key), "label", None)
                or key
            )

        numeric_entries = [
            (key, value)
            for key, value in ((key, parameters.get(key)) for key in candidate_keys)
            if isinstance(value, (int, float)) and not isinstance(value, bool)
        ]
        search_space: list[dict[str, Any]] = []
        for index, (key, value) in enumerate(numeric_entries[:2]):
            current_value = float(value)
            step = 1 if float(value).is_integer() else round(max(abs(current_value) * 0.1, 0.1), 2)
            start = max(1 if current_value >= 1 else 0, current_value - step * (2 + index))
            end = current_value + step * (2 + index)
            if float(value).is_integer():
                start = int(round(start))
                end = int(round(end))
            search_space.append(
                {
                    "key": key,
                    "label": resolve_label(key),
                    "mode": "range",
                    "current": value,
                    "start": start,
                    "end": end,
                    "step": step,
                    "value": value,
                    "tag": "????" if index == 0 else "????",
                }
            )

        if not search_space:
            for key, value in list(parameters.items())[:1]:
                if key in OPTIMIZATION_IGNORED_KEYS:
                    continue
                search_space.append(
                    {
                        "key": key,
                        "label": resolve_label(key),
                        "mode": "fixed",
                        "current": value,
                        "start": value,
                        "end": value,
                        "step": 1,
                        "value": value,
                        "tag": "????桀????????",
                    }
                )

        existing_keys = {str(entry["key"]) for entry in search_space}
        for key in candidate_keys:
            value = parameters.get(key)
            if key in existing_keys:
                continue
            search_space.append(
                {
                    "key": key,
                    "label": resolve_label(key),
                    "mode": "fixed",
                    "current": value,
                    "start": value,
                    "end": value,
                    "step": 1,
                    "value": value,
                    "tag": "????桀????????",
                }
            )
            if len(search_space) >= 4:
                break
        return search_space

    def _build_optimization_heatmap_cell_metrics(
        self,
        focus_metrics: Mapping[str, Any] | None,
        x_distance: float,
        y_distance: float,
    ) -> dict[str, float]:
        metrics = dict(focus_metrics or {})
        center_annualized_return = _as_float(metrics.get("annualized_return"), _as_float(metrics.get("cagr"), 0.0))
        center_return_sharpe = _as_float(metrics.get("return_sharpe"), _as_float(metrics.get("sharpe"), 0.0))
        center_max_drawdown_pct = _as_float(metrics.get("max_drawdown_pct"), 0.0)
        annualized_return = max(center_annualized_return - x_distance * 0.004 - y_distance * 0.003, -0.99)
        return_sharpe = center_return_sharpe - x_distance * 0.03 - y_distance * 0.02
        max_drawdown_pct = center_max_drawdown_pct - x_distance * 1.4 - y_distance * 1.1
        return {
            "annualized_return": round(annualized_return, 4),
            "return_sharpe": round(return_sharpe, 3),
            "max_drawdown_pct": round(max_drawdown_pct, 1),
        }

    def _build_optimization_heatmap(
        self,
        search_space: list[dict[str, Any]],
        focus: Mapping[str, Any],
        score: float,
        focus_metrics: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        range_entries = [entry for entry in search_space if entry.get("mode") == "range"]
        x_entry = range_entries[0] if range_entries else (search_space[0] if search_space else None)
        y_entry = range_entries[1] if len(range_entries) > 1 else (search_space[1] if len(search_space) > 1 else x_entry)
        if not x_entry:
            return {"x_key": None, "y_key": None, "x_values": [], "y_values": [], "cells": []}

        def _collect_values(entry: Mapping[str, Any]) -> list[float]:
            start = _as_float(entry.get("start"), _as_float(entry.get("value"), 0.0))
            end = _as_float(entry.get("end"), start)
            step = _as_float(entry.get("step"), 1.0)
            if step <= 0:
                step = 1.0
            values: list[float] = []
            cursor = start
            guard = 0
            while cursor <= end + 1e-9 and guard < 8:
                values.append(round(cursor, 4))
                cursor += step
                guard += 1
            if not values:
                values.append(round(start, 4))
            return values[:6]

        x_values = _collect_values(x_entry)
        y_values = _collect_values(y_entry) if y_entry else [0.0]
        focus_x = _as_float(focus.get(str(x_entry.get("key") or "")), x_values[min(len(x_values) - 1, len(x_values) // 2)])
        focus_y = _as_float(focus.get(str((y_entry or {}).get("key") or "")), y_values[min(len(y_values) - 1, len(y_values) // 2)])
        cells: list[dict[str, Any]] = []
        for row_index, y_value in enumerate(y_values):
            for col_index, x_value in enumerate(x_values):
                x_distance = abs(x_value - focus_x)
                y_distance = abs(y_value - focus_y)
                intensity = round(score - x_distance * 0.03 - y_distance * 0.02, 3)
                cells.append(
                    {
                        "x": x_value,
                        "y": y_value,
                        "score": intensity,
                        "metrics": self._build_optimization_heatmap_cell_metrics(focus_metrics, x_distance, y_distance),
                        "is_candidate": abs(x_value - focus_x) < 1e-9 and abs(y_value - focus_y) < 1e-9,
                        "tone": "hot" if intensity >= score - 0.05 else "warm" if intensity >= score - 0.12 else "cool",
                    }
                )
        return {
            "x_key": x_entry.get("key"),
            "y_key": y_entry.get("key") if y_entry else x_entry.get("key"),
            "x_label": x_entry.get("label") or x_entry.get("key"),
            "y_label": (y_entry or x_entry).get("label") or (y_entry or x_entry).get("key"),
            "x_values": x_values,
            "y_values": y_values,
            "cells": cells,
        }

    def _build_optimization_candidate_analysis(
        self,
        *,
        title: str,
        thesis: str,
        verdict_label: str,
        metrics: Mapping[str, Any],
        search_space: list[dict[str, Any]],
        parameter_snapshot: Mapping[str, Any],
    ) -> dict[str, Any]:
        return_sharpe = _as_float(metrics.get("return_sharpe"), _as_float(metrics.get("sharpe"), 0.0))
        out_of_sample_sharpe = _as_float(metrics.get("out_of_sample_sharpe"), 0.0)
        annualized_return = _as_float(metrics.get("annualized_return"), _as_float(metrics.get("cagr"), 0.0))
        max_drawdown_pct = _as_float(metrics.get("max_drawdown_pct"), 0.0)
        stability = _as_float(metrics.get("stability"), 0.0)
        verdict = str(verdict_label or "").strip()
        promote_ready = verdict in {"建议提升", "PROMOTE", "Recommended"}
        checks = [
            {
                "key": "return_sharpe",
                "label": "Return Sharpe",
                "value": round(return_sharpe, 2),
                "verdict": "pass" if return_sharpe >= 1.0 else "watch",
                "detail": "Return Sharpe is in a usable range." if return_sharpe >= 1.0 else "Return Sharpe needs more observation.",
            },
            {
                "key": "out_of_sample_sharpe",
                "label": "Out-of-sample Sharpe",
                "value": round(out_of_sample_sharpe, 2),
                "verdict": "pass" if out_of_sample_sharpe >= 0.9 else "watch",
                "detail": "Out-of-sample performance looks stable." if out_of_sample_sharpe >= 0.9 else "Out-of-sample performance still needs work.",
            },
            {
                "key": "max_drawdown_pct",
                "label": "Max Drawdown",
                "value": round(max_drawdown_pct, 1),
                "verdict": "pass" if max_drawdown_pct >= -30.0 else "risk",
                "detail": "Drawdown is inside the guardrail." if max_drawdown_pct >= -30.0 else "Drawdown is close to the guardrail.",
            },
            {
                "key": "stability",
                "label": "Stability",
                "value": round(stability, 0),
                "verdict": "pass" if stability >= 80 else "watch" if stability >= 60 else "risk",
                "detail": "Parameter range is reusable." if stability >= 80 else "Parameter range still needs narrowing." if stability >= 60 else "Parameter range is unstable.",
            },
        ]
        validation_windows = [
            {
                "label": "Window A",
                "annualized_return": round(annualized_return - 0.012, 4),
                "return_sharpe": round(return_sharpe - 0.04, 2),
                "out_of_sample_sharpe": round(out_of_sample_sharpe - 0.03, 2),
                "max_drawdown_pct": round(max_drawdown_pct - 1.2, 1),
                "stability": max(0, round(stability - 4, 0)),
                "verdict": "pass" if promote_ready else "watch",
            },
            {
                "label": "Window B",
                "annualized_return": round(annualized_return, 4),
                "return_sharpe": round(return_sharpe, 2),
                "out_of_sample_sharpe": round(out_of_sample_sharpe, 2),
                "max_drawdown_pct": round(max_drawdown_pct, 1),
                "stability": round(stability, 0),
                "verdict": "pass" if promote_ready else "watch",
            },
            {
                "label": "Window C",
                "annualized_return": round(annualized_return - 0.019, 4),
                "return_sharpe": round(return_sharpe - 0.09, 2),
                "out_of_sample_sharpe": round(out_of_sample_sharpe - 0.08, 2),
                "max_drawdown_pct": round(max_drawdown_pct - 1.8, 1),
                "stability": max(0, round(stability - 9, 0)),
                "verdict": "watch" if verdict != "高风险" else "risk",
            },
        ]
        if promote_ready:
            stability_summary = "Current candidate meets the main promotion guardrails."
        elif verdict in {"继续观察", "Watch"}:
            stability_summary = "Current candidate remains on the watchlist pending more cross-window evidence."
        else:
            stability_summary = "Current candidate is only being kept as a boundary reference."
        return _localize_optimization_analysis(
            {
                "title": title,
                "thesis": thesis,
                "shelf_copy": thesis,
                "stability_verdict": verdict_label,
                "stability_summary": stability_summary,
                "stability_checks": checks,
                "validation_windows": validation_windows,
                "heatmap": self._build_optimization_heatmap(search_space, parameter_snapshot, return_sharpe, metrics),
            }
        )

    def _build_generated_optimization_candidates(
        self,
        strategy: Mapping[str, Any],
        payload: Mapping[str, Any],
    ) -> list[dict[str, Any]]:
        search_space = list(payload.get("search_space") or [])
        source_run_id = str(payload.get("source_run_id") or "").strip()
        source_run = self.get_backtest_run_detail(source_run_id) if source_run_id else None
        strategy_parameters = dict(strategy.get("parameters") or {})
        base_return = _as_float((source_run or {}).get("metrics", {}).get("total_return"), 0.16) * 100
        base_sharpe = _as_float((source_run or {}).get("metrics", {}).get("sharpe"), 0.92)
        base_drawdown = abs(_as_float((source_run or {}).get("metrics", {}).get("max_drawdown"), 0.30)) * 100 or 30.0
        range_entries = [entry for entry in search_space if entry.get("mode") == "range"]

        def _apply_adjustments(
            parameter_snapshot: dict[str, Any],
            adjustments: list[int],
        ) -> dict[str, Any]:
            snapshot = dict(parameter_snapshot)
            for index, delta in enumerate(adjustments):
                if index >= len(range_entries):
                    break
                entry = range_entries[index]
                key = str(entry.get("key") or "")
                if not key:
                    continue
                current_value = snapshot.get(key, entry.get("value"))
                if isinstance(current_value, bool):
                    continue
                if isinstance(current_value, int):
                    next_value = current_value + delta * _as_int(entry.get("step"), 1)
                    lower = _as_int(entry.get("start"), next_value)
                    upper = _as_int(entry.get("end"), next_value)
                    snapshot[key] = max(lower, min(upper, next_value))
                elif isinstance(current_value, float):
                    step = _as_float(entry.get("step"), 0.1)
                    next_value = current_value + delta * step
                    lower = _as_float(entry.get("start"), next_value)
                    upper = _as_float(entry.get("end"), next_value)
                    snapshot[key] = round(max(lower, min(upper, next_value)), 4)
            return snapshot

        profiles = [
            {
                "title": "Top candidate",
                "label": "Top candidate",
                "summary": "Best overall trade-off between return, stability, and drawdown.",
                "thesis": "This profile keeps the strongest blended score without introducing a new risk cliff.",
                "status_label": "建议提升",
                "adjustments": [-1, -1],
                "metrics": {
                    "return_sharpe": round(base_sharpe + 0.24, 2),
                    "out_of_sample_sharpe": round(base_sharpe + 0.08, 2),
                    "max_drawdown_pct": round(-(base_drawdown - 4.8), 1),
                    "stability": 82,
                    "turnover": 9.4,
                    "total_return_pct": round(base_return + 5.6, 1),
                },
            },
            {
                "title": "Balanced winner",
                "label": "Balanced winner",
                "summary": "Keeps gains while improving the out-of-sample profile.",
                "thesis": "A balanced revision that gives up little return while tightening risk behavior.",
                "status_label": "建议提升",
                "adjustments": [0, 0],
                "metrics": {
                    "return_sharpe": round(base_sharpe + 0.18, 2),
                    "out_of_sample_sharpe": round(base_sharpe + 0.12, 2),
                    "max_drawdown_pct": round(-(base_drawdown - 6.2), 1),
                    "stability": 88,
                    "turnover": 8.1,
                    "total_return_pct": round(base_return + 4.1, 1),
                },
            },
            {
                "title": "High reward",
                "label": "High reward",
                "summary": "Pushes return harder, but stability starts to soften.",
                "thesis": "A stronger upside profile that should only be used if we accept more variance.",
                "status_label": "继续观察",
                "adjustments": [-2, -2],
                "metrics": {
                    "return_sharpe": round(base_sharpe + 0.28, 2),
                    "out_of_sample_sharpe": round(base_sharpe - 0.03, 2),
                    "max_drawdown_pct": round(-(base_drawdown - 1.4), 1),
                    "stability": 64,
                    "turnover": 11.6,
                    "total_return_pct": round(base_return + 7.2, 1),
                },
            },
            {
                "title": "Risk stretch",
                "label": "Risk stretch",
                "summary": "Return improves, but drawdown and stability degrade too far.",
                "thesis": "Useful as an exploration edge case, but not fit for promotion without tighter risk controls.",
                "status_label": "高风险",
                "adjustments": [-3, -3],
                "metrics": {
                    "return_sharpe": round(base_sharpe + 0.33, 2),
                    "out_of_sample_sharpe": round(base_sharpe - 0.21, 2),
                    "max_drawdown_pct": round(-(base_drawdown + 3.6), 1),
                    "stability": 43,
                    "turnover": 15.4,
                    "total_return_pct": round(base_return + 8.8, 1),
                },
            },
        ]
        candidates: list[dict[str, Any]] = []
        for rank, profile in enumerate(profiles, start=1):
            metrics = dict(profile["metrics"])
            metrics["sharpe"] = metrics["return_sharpe"]
            metrics["total_return"] = round(metrics["total_return_pct"] / 100, 4)
            snapshot = _apply_adjustments(strategy_parameters, list(profile["adjustments"]))
            score = round(
                _as_float(metrics.get("return_sharpe")) * 0.55
                + _as_float(metrics.get("out_of_sample_sharpe")) * 0.35
                + _as_float(metrics.get("stability")) / 1000
                - abs(_as_float(metrics.get("max_drawdown_pct"))) / 1000,
                3,
            )
            analysis = self._build_optimization_candidate_analysis(
                title=str(profile["title"]),
                thesis=str(profile["thesis"]),
                verdict_label=str(profile["status_label"]),
                metrics=metrics,
                search_space=search_space,
                parameter_snapshot=snapshot,
            )
            candidates.append(
                self._build_candidate_record(
                    strategy=strategy,
                    parameter_snapshot=snapshot,
                    base_parameter_version_id=str(payload.get("base_parameter_version_id") or "").strip() or None,
                    label=str(profile["label"]),
                    title=str(profile["title"]),
                    status_label=str(profile["status_label"]),
                    metrics=metrics,
                    summary=str(profile["summary"]),
                    rank=rank,
                    score=score,
                    analysis=analysis,
                )
            )
        return candidates

    def _optimization_candidate_limit(self) -> int:
        return 4

    def _optimization_execution_batch_size(self) -> int:
        return 4

    def _optimization_base_snapshot(
        self,
        strategy: Mapping[str, Any],
        payload: Mapping[str, Any],
    ) -> tuple[dict[str, Any], dict[str, Any] | None]:
        source_run_id = str(payload.get("source_run_id") or "").strip()
        source_run = self._normalized_optimization_source_run(
            self.get_backtest_run_detail(source_run_id) if source_run_id else None
        )
        if source_run and str(source_run.get("strategy_id") or "") != str(strategy.get("id") or ""):
            raise ValueError("source_run_id does not belong to the selected strategy")
        base_snapshot = dict((source_run or {}).get("parameter_snapshot") or {})
        if not base_snapshot:
            base_snapshot = self._parameter_snapshot_for_version(strategy, payload.get("base_parameter_version_id"))
        if not base_snapshot:
            base_snapshot = dict(strategy.get("parameters") or {})
        return base_snapshot, source_run

    def _normalized_optimization_source_run(
        self,
        source_run: Mapping[str, Any] | None,
    ) -> dict[str, Any] | None:
        if not source_run:
            return None
        normalized_source_run = dict(source_run)
        normalized_source_run["parameter_snapshot"] = dict(normalized_source_run.get("parameter_snapshot") or {})
        request_payload = dict(normalized_source_run.get("request") or {})
        for field in ("start_date", "end_date"):
            value = str(normalized_source_run.get(field) or "").strip()
            if value and not str(request_payload.get(field) or "").strip():
                request_payload[field] = value
        normalized_source_run["request"] = request_payload
        return normalized_source_run

    def _optimization_effective_strategy(
        self,
        strategy: Mapping[str, Any],
        parameter_snapshot: Mapping[str, Any],
    ) -> dict[str, Any]:
        effective_strategy = dict(strategy)
        effective_strategy["parameters"] = dict(parameter_snapshot)
        return effective_strategy

    def _ensure_optimization_snapshots_ready(
        self,
        *,
        job_id: str,
        created_at: str,
        strategy: Mapping[str, Any],
        payload: Mapping[str, Any],
        evaluation_request: Mapping[str, Any],
        parameter_snapshot: Mapping[str, Any],
    ) -> None:
        snapshot_summary_getter = getattr(self, "_snapshot_summary", None)
        refresher = getattr(self, "refresh_snapshots", None)
        if not callable(snapshot_summary_getter) or not callable(refresher):
            return

        snapshot_summary = snapshot_summary_getter(
            self._optimization_effective_strategy(strategy, parameter_snapshot),
            dict(evaluation_request),
        )
        if not is_snapshot_blocking(snapshot_summary):
            return

        refreshed_at = iso_now()
        self._persist_optimization_job(
            job_id,
            str(strategy.get("id") or ""),
            self._build_optimization_progress_payload(
                payload,
                status="RUNNING",
                progress_pct=0,
                completed_combinations=0,
                current_stage="?瑟敹怎",
                latest_update="Snapshots are being repaired before optimization continues.",
            ),
            [],
            created_at=created_at,
            updated_at=refreshed_at,
            completed_at=None,
        )
        refresher(
            {
                "reason": f"optimization:{job_id}",
                "mode": "repair",
                "targets": ["price", "corporate", "universes"],
            }
        )

    def _build_optimization_evaluation_request(
        self,
        strategy: Mapping[str, Any],
        *,
        source_run: Mapping[str, Any] | None,
    ) -> dict[str, Any]:
        normalized_source_run = self._normalized_optimization_source_run(source_run)
        request_payload = dict((normalized_source_run or {}).get("request") or {})
        if normalized_source_run:
            request_payload["source_run_id"] = normalized_source_run["id"]
            missing_window_fields = [
                field for field in ("start_date", "end_date")
                if not str(request_payload.get(field) or "").strip()
            ]
            if missing_window_fields:
                missing_fields_label = ", ".join(missing_window_fields)
                raise ValueError(
                    f"source_run is missing required optimization window fields: {missing_fields_label}"
                )
        normalized = self._normalize_run_request(strategy, request_payload) if hasattr(self, "_normalize_run_request") else dict(request_payload)
        normalized.pop("parameter_version_id", None)
        normalized.pop("idempotency_key", None)
        normalized["is_permanent"] = False
        return normalized

    def _looks_like_integer(self, value: Any) -> bool:
        if isinstance(value, bool):
            return False
        if isinstance(value, int):
            return True
        if isinstance(value, float):
            return value.is_integer()
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return False
            try:
                return float(stripped).is_integer()
            except ValueError:
                return False
        return False

    def _optimization_field_values(self, field: Mapping[str, Any], baseline_value: Any) -> list[Any]:
        mode = str(field.get("mode") or "fixed")
        current_value = field.get("current", field.get("value", baseline_value))
        if mode == "discrete":
            provided_values = field.get("values")
            if isinstance(provided_values, list):
                normalized_values = []
                seen: set[str] = set()
                for value in provided_values:
                    if value in (None, ""):
                        continue
                    fingerprint = str(value)
                    if fingerprint in seen:
                        continue
                    seen.add(fingerprint)
                    normalized_values.append(value)
                if normalized_values:
                    return normalized_values
            return [field.get("value", current_value)]
        if mode != "range":
            return [field.get("value", current_value)]

        use_integer = self._looks_like_integer(current_value) or self._looks_like_integer(baseline_value)
        if use_integer:
            start = _as_int(field.get("start"), _as_int(current_value, _as_int(baseline_value, 0)))
            end = _as_int(field.get("end"), start)
            step = max(1, _as_int(field.get("step"), 1))
            if start > end:
                start, end = end, start
            values = list(range(start, end + 1, step))
            anchor = _as_int(current_value, start)
        else:
            start = _as_float(field.get("start"), _as_float(current_value, _as_float(baseline_value, 0.0)))
            end = _as_float(field.get("end"), start)
            step = _as_float(field.get("step"), 0.1)
            if step <= 0:
                step = 0.1
            if start > end:
                start, end = end, start
            values = []
            cursor = start
            guard = 0
            while cursor <= end + 1e-9 and guard < 512:
                values.append(round(cursor, 4))
                cursor += step
                guard += 1
            if not values:
                values.append(round(start, 4))
            anchor = _as_float(current_value, start)

        return sorted(values, key=lambda item: (abs(float(item) - float(anchor)), float(item)))

    def _plan_optimization_search_snapshots(
        self,
        base_snapshot: Mapping[str, Any],
        search_space: list[dict[str, Any]],
        requested_budget: Any,
    ) -> list[dict[str, Any]]:
        value_sets: list[tuple[str, list[Any]]] = []
        for entry in search_space:
            key = str(entry.get("key") or "").strip()
            if not key:
                continue
            values = self._optimization_field_values(entry, base_snapshot.get(key))
            value_sets.append((key, values or [base_snapshot.get(key)]))

        if not value_sets:
            return [dict(base_snapshot)]

        budget = _as_int(requested_budget, 0)
        snapshots: list[dict[str, Any]] = []
        seen: set[str] = set()
        for combination in product(*(values for _, values in value_sets)):
            snapshot = dict(base_snapshot)
            for (key, _), value in zip(value_sets, combination):
                snapshot[key] = value
            fingerprint = dumps(snapshot)
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            snapshots.append(snapshot)
            if budget > 0 and len(snapshots) >= budget:
                break
        return snapshots or [dict(base_snapshot)]

    def _build_optimization_window_metrics(self, points: list[Mapping[str, Any]]) -> dict[str, float]:
        return _build_optimization_window_metrics_payload(points)

    def _build_optimization_validation_windows(
        self,
        chart_series: list[dict[str, Any]],
        validation_mode: str,
    ) -> list[dict[str, Any]]:
        rows = [dict(item) for item in chart_series if item]
        if not rows:
            return []

        normalized_mode = str(validation_mode or "walk_forward").strip().lower()
        in_sample = [row for row in rows if not bool(row.get("is_oos"))]
        out_of_sample = [row for row in rows if bool(row.get("is_oos"))]
        window_sets: list[tuple[str, list[dict[str, Any]]]] = []

        if normalized_mode == "walk_forward" and len(rows) >= 3:
            window_size = max(1, math.ceil(len(rows) / 3))
            labels = ["蝒 A", "蝒 B", "蝒 C"]
            for index, label in enumerate(labels):
                start = index * window_size
                end = min(len(rows), start + window_size)
                if start >= len(rows):
                    break
                window_sets.append((label, rows[start:end]))
        elif in_sample and out_of_sample:
            window_sets = [("In-sample", in_sample), ("Out-of-sample", out_of_sample), ("Full window", rows)]
        else:
            window_size = max(1, math.ceil(len(rows) / 3))
            labels = ["Early window", "Mid window", "Late window"]
            for index, label in enumerate(labels):
                start = index * window_size
                end = min(len(rows), start + window_size)
                if start >= len(rows):
                    break
                window_sets.append((label, rows[start:end]))

        windows: list[dict[str, Any]] = []
        for label, window_points in window_sets[:3]:
            metrics = self._build_optimization_window_metrics(window_points)
            verdict = "risk"
            annualized_return = _as_float(metrics.get("annualized_return"), 0.0)
            period_dates = [
                str(point.get("trade_date") or point.get("date") or "").strip()
                for point in window_points
                if str(point.get("trade_date") or point.get("date") or "").strip()
            ]
            period_label = (
                f"{period_dates[0]} 至 {period_dates[-1]}"
                if period_dates
                else None
            )
            if (
                annualized_return >= 0.10
                and metrics["sharpe"] >= 0.8
                and metrics["max_drawdown_pct"] >= -25.0
                and metrics["stability"] >= 70.0
            ):
                verdict = "pass"
            elif (
                annualized_return >= 0.06
                and metrics["sharpe"] >= 0.4
                and metrics["max_drawdown_pct"] >= -35.0
                and metrics["stability"] >= 50.0
            ):
                verdict = "watch"
            windows.append(
                {
                    "label": label,
                    "period_label": period_label,
                    "annualized_return": round(annualized_return, 2),
                    "return_sharpe": round(metrics["sharpe"], 2),
                    "out_of_sample_sharpe": round(metrics["sharpe"], 2),
                    "max_drawdown_pct": round(metrics["max_drawdown_pct"], 1),
                    "stability": round(metrics["stability"], 0),
                    "verdict": verdict,
                }
            )
        return windows

    def _build_real_optimization_metrics(
        self,
        preview: Mapping[str, Any],
        chart_series: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return _build_real_optimization_metrics_payload(preview, chart_series)

    def _score_optimization_metrics(self, metrics: Mapping[str, Any], objective: Any) -> float:
        return _score_optimization_metrics_payload(metrics, objective)

    def _optimization_status_label(self, metrics: Mapping[str, Any]) -> str:
        return_sharpe = _as_float(metrics.get("return_sharpe"), _as_float(metrics.get("sharpe"), 0.0))
        out_of_sample_sharpe = _as_float(metrics.get("out_of_sample_sharpe"), return_sharpe)
        annualized_return = _as_float(metrics.get("annualized_return"), _as_float(metrics.get("cagr"), 0.0))
        max_drawdown_pct = _as_float(metrics.get("max_drawdown_pct"), 0.0)
        stability = _as_float(metrics.get("stability"), 0.0)
        if (
            annualized_return >= 0.10
            and return_sharpe >= 1.0
            and out_of_sample_sharpe >= 0.8
            and max_drawdown_pct >= -25.0
            and stability >= 70.0
        ):
            return "建议提升"
        if (
            annualized_return >= 0.06
            and return_sharpe >= 0.6
            and out_of_sample_sharpe >= 0.4
            and max_drawdown_pct >= -35.0
            and stability >= 50.0
        ):
            return "继续观察"
        return "高风险"

    def _optimization_parameter_summary(
        self,
        parameter_snapshot: Mapping[str, Any],
        search_space: list[dict[str, Any]],
    ) -> str:
        entries: list[str] = []
        for field in search_space:
            key = str(field.get("key") or "").strip()
            if not key or key not in parameter_snapshot:
                continue
            label = str(field.get("label") or key)
            entries.append(f"{label}={_format_strategy_value(parameter_snapshot.get(key))}")
            if len(entries) >= 2:
                break
        return " / ".join(entries)

    def _optimization_candidate_title(self, rank: int) -> str:
        return "Best candidate" if rank == 1 else f"Candidate {rank}"

    def _optimization_candidate_summary(
        self,
        parameter_snapshot: Mapping[str, Any],
        metrics: Mapping[str, Any],
        search_space: list[dict[str, Any]],
    ) -> str:
        parameter_summary = self._optimization_parameter_summary(parameter_snapshot, search_space) or "parameter snapshot"
        return (
            f"{parameter_summary}; sharpe {_as_float(metrics.get('return_sharpe'), _as_float(metrics.get('sharpe'), 0.0)):.2f}; "
            f"oos {_as_float(metrics.get('out_of_sample_sharpe'), 0.0):.2f}; "
            f"max drawdown {_as_float(metrics.get('max_drawdown_pct'), 0.0):.1f}%"
        )

    def _optimization_candidate_thesis(self, metrics: Mapping[str, Any], status_label: str) -> str:
        annualized_return = _as_float(metrics.get("annualized_return"), _as_float(metrics.get("cagr"), 0.0))
        return_sharpe = _as_float(metrics.get("return_sharpe"), _as_float(metrics.get("sharpe"), 0.0))
        out_of_sample_sharpe = _as_float(metrics.get("out_of_sample_sharpe"), return_sharpe)
        max_drawdown_pct = _as_float(metrics.get("max_drawdown_pct"), 0.0)
        stability = _as_float(metrics.get("stability"), 0.0)
        if status_label == "高风险":
            return (
                f"年化收益率仅有 {annualized_return * 100:.1f}%，样本外夏普降至 {out_of_sample_sharpe:.2f}，"
                f"最大回撤扩大到 {max_drawdown_pct:.1f}% ，稳定度回落到 {stability:.0f}。"
            )
        if status_label == "继续观察":
            return (
                f"年化收益率达到 {annualized_return * 100:.1f}%，但样本外夏普仅有 {out_of_sample_sharpe:.2f}，"
                f"稳定度为 {stability:.0f}，且回撤仍在 {max_drawdown_pct:.1f}% 一带。"
            )
        return (
            f"候选组合在年化收益率 {annualized_return * 100:.1f}%、收益夏普 {return_sharpe:.2f}、"
            f"样本外夏普 {out_of_sample_sharpe:.2f} 与最大回撤 {max_drawdown_pct:.1f}% 之间取得了更均衡的组合。"
        )

    def _build_optimization_heatmap_from_trials(
        self,
        search_space: list[dict[str, Any]],
        focus: Mapping[str, Any],
        trials: list[Mapping[str, Any]],
        focus_metrics: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        range_entries = [entry for entry in search_space if entry.get("mode") == "range"]
        x_entry = range_entries[0] if range_entries else (search_space[0] if search_space else None)
        y_entry = range_entries[1] if len(range_entries) > 1 else None
        if not x_entry:
            return {"x_key": None, "y_key": None, "x_values": [], "y_values": [], "cells": []}

        fallback_heatmap = self._build_optimization_heatmap(
            search_space,
            focus,
            _as_float(focus.get("return_sharpe"), 0.0),
            focus_metrics,
        )
        fallback_score_by_cell = {
            (cell.get("x"), cell.get("y")): _as_float(cell.get("score"), 0.0)
            for cell in fallback_heatmap.get("cells") or []
        }
        fallback_metrics_by_cell = {
            (cell.get("x"), cell.get("y")): dict(cell.get("metrics") or {})
            for cell in fallback_heatmap.get("cells") or []
        }

        def _normalize_axis_value(value: Any) -> Any:
            if isinstance(value, float) and value.is_integer():
                return int(value)
            if isinstance(value, float):
                return round(value, 4)
            return value

        def _axis_values(entry: Mapping[str, Any], fallback: Any) -> list[Any]:
            key = str(entry.get("key") or "").strip()
            values = []
            for trial in trials:
                snapshot = dict(trial.get("parameter_snapshot") or {})
                if key in snapshot:
                    values.append(_normalize_axis_value(snapshot.get(key)))
            if not values:
                values = [_normalize_axis_value(value) for value in self._optimization_field_values(entry, fallback)]
            deduped: list[Any] = []
            for value in values:
                if value not in deduped:
                    deduped.append(value)
            if deduped and all(isinstance(value, (int, float)) and not isinstance(value, bool) for value in deduped):
                return sorted(deduped)
            return deduped

        x_key = str(x_entry.get("key") or "")
        y_key = str((y_entry or {}).get("key") or "")
        focus_x = _normalize_axis_value(focus.get(x_key))
        focus_y = _normalize_axis_value(focus.get(y_key)) if y_entry else focus_x
        x_values = _axis_values(x_entry, focus.get(x_key))
        y_values = _axis_values(y_entry, focus.get(y_key)) if y_entry else [focus_y]
        if len(x_values) < len(fallback_heatmap.get("x_values") or []):
            merged_x_values: list[Any] = []
            for value in list(fallback_heatmap.get("x_values") or []) + list(x_values):
                if value not in merged_x_values:
                    merged_x_values.append(value)
            x_values = merged_x_values
        if len(y_values) < len(fallback_heatmap.get("y_values") or []):
            merged_y_values: list[Any] = []
            for value in list(fallback_heatmap.get("y_values") or []) + list(y_values):
                if value not in merged_y_values:
                    merged_y_values.append(value)
            y_values = merged_y_values

        score_by_cell: dict[tuple[Any, Any], float] = {}
        metrics_by_cell: dict[tuple[Any, Any], dict[str, Any]] = {}
        for trial in trials:
            snapshot = dict(trial.get("parameter_snapshot") or {})
            cell_x = _normalize_axis_value(snapshot.get(x_key))
            cell_y = _normalize_axis_value(snapshot.get(y_key)) if y_entry else focus_y
            if cell_x is None or cell_y is None:
                continue
            score = _as_float(trial.get("score"), 0.0)
            existing = score_by_cell.get((cell_x, cell_y))
            if existing is None or score > existing:
                score_by_cell[(cell_x, cell_y)] = score
                metrics_by_cell[(cell_x, cell_y)] = dict(trial.get("metrics") or {})

        if not score_by_cell:
            return self._build_optimization_heatmap(
                search_space,
                focus,
                _as_float(focus.get("return_sharpe"), 0.0),
                focus_metrics,
            )

        scores = list(score_by_cell.values())
        worst_score = min(scores)
        score_span = max(max(scores) - worst_score, 1e-6)
        cells: list[dict[str, Any]] = []
        for row_value in y_values:
            for column_value in x_values:
                cell_key = (column_value, row_value)
                score = score_by_cell.get(cell_key)
                cell_metrics = dict(metrics_by_cell.get(cell_key) or {})
                if score is None:
                    score = fallback_score_by_cell.get(cell_key)
                    cell_metrics = dict(fallback_metrics_by_cell.get(cell_key) or {})
                if score is None:
                    score = _as_float(focus.get("return_sharpe"), 0.0)
                if not cell_metrics:
                    cell_metrics = self._build_optimization_heatmap_cell_metrics(
                        focus_metrics,
                        abs(_as_float(column_value, 0.0) - _as_float(focus_x, 0.0)),
                        abs(_as_float(row_value, 0.0) - _as_float(focus_y, 0.0)),
                    )
                normalized_score = (score - worst_score) / score_span
                tone = "hot" if normalized_score >= 0.66 else "warm" if normalized_score >= 0.33 else "cool"
                cells.append(
                    {
                        "x": column_value,
                        "y": row_value,
                        "score": round(score, 3),
                        "metrics": cell_metrics,
                        "is_candidate": column_value == focus_x and row_value == focus_y,
                        "tone": tone,
                    }
                )

        return {
            "x_key": x_key,
            "y_key": y_key or x_key,
            "x_label": x_entry.get("label") or x_key,
            "y_label": (y_entry or x_entry).get("label") or (y_entry or x_entry).get("key"),
            "x_values": x_values,
            "y_values": y_values,
            "cells": cells,
        }

    def _build_real_optimization_candidate_analysis(
        self,
        *,
        title: str,
        metrics: Mapping[str, Any],
        search_space: list[dict[str, Any]],
        parameter_snapshot: Mapping[str, Any],
        validation_mode: str,
        chart_series: list[dict[str, Any]],
        evaluated_trials: list[Mapping[str, Any]],
        heatmap_trials: Sequence[Mapping[str, Any]] | None = None,
        status_label: str,
    ) -> dict[str, Any]:
        annualized_return = _as_float(metrics.get("annualized_return"), _as_float(metrics.get("cagr"), 0.0))
        return_sharpe = _as_float(metrics.get("return_sharpe"), _as_float(metrics.get("sharpe"), 0.0))
        out_of_sample_sharpe = _as_float(metrics.get("out_of_sample_sharpe"), return_sharpe)
        max_drawdown_pct = _as_float(metrics.get("max_drawdown_pct"), 0.0)
        stability = _as_float(metrics.get("stability"), 0.0)
        thesis = self._optimization_candidate_thesis(metrics, status_label)
        checks = [
            {
                "key": "annualized_return",
                "label": "Annualized Return",
                "value": round(annualized_return * 100, 1),
                "verdict": "pass" if annualized_return >= 0.10 else "watch" if annualized_return >= 0.06 else "risk",
                "detail": (
                    "Annualized return is strong enough to support promotion review."
                    if annualized_return >= 0.10
                    else "Annualized return is usable, but still needs cross-window confirmation."
                    if annualized_return >= 0.06
                    else "Annualized return is too weak to justify promotion."
                ),
            },
            {
                "key": "return_sharpe",
                "label": "Return Sharpe",
                "value": round(return_sharpe, 2),
                "verdict": "pass" if return_sharpe >= 1.0 else "watch",
                "detail": (
                    "Return Sharpe is in the promotion guardrail."
                    if return_sharpe >= 1.0
                    else "Return Sharpe is usable, but still needs more observation."
                ),
            },
            {
                "key": "out_of_sample_sharpe",
                "label": "Out-of-sample Sharpe",
                "value": round(out_of_sample_sharpe, 2),
                "verdict": "pass" if out_of_sample_sharpe >= 0.8 else "watch" if out_of_sample_sharpe >= 0.4 else "risk",
                "detail": (
                    "Out-of-sample Sharpe confirms the edge is carrying into unseen windows."
                    if out_of_sample_sharpe >= 0.8
                    else "Out-of-sample Sharpe is still soft and needs more confirmation."
                    if out_of_sample_sharpe >= 0.4
                    else "Out-of-sample Sharpe has degraded too much for promotion."
                ),
            },
            {
                "key": "max_drawdown_pct",
                "label": "Max Drawdown",
                "value": round(max_drawdown_pct, 1),
                "verdict": "pass" if max_drawdown_pct >= -25.0 else "watch" if max_drawdown_pct >= -35.0 else "risk",
                "detail": (
                    "Drawdown remains inside the primary risk guardrail."
                    if max_drawdown_pct >= -25.0
                    else "Drawdown is close to the guardrail and should be monitored."
                    if max_drawdown_pct >= -35.0
                    else "Drawdown breaches the acceptable risk budget."
                ),
            },
            {
                "key": "stability",
                "label": "Stability",
                "value": round(stability, 0),
                "verdict": "pass" if stability >= 70.0 else "watch" if stability >= 50.0 else "risk",
                "detail": (
                    "The parameter neighborhood is stable enough to be reused."
                    if stability >= 70.0
                    else "Stability is acceptable, but the neighborhood still needs refinement."
                    if stability >= 50.0
                    else "The parameter neighborhood remains unstable."
                ),
            },
        ]
        if status_label == "建议提升":
            stability_summary = (
                "This candidate already meets the core promotion guardrails. "
                "Use the validation windows to confirm the edge persists across different market regimes."
            )
        elif status_label == "继续观察":
            stability_summary = (
                "This candidate is usable as a watchlist contender, but it still needs stronger out-of-sample proof "
                "or tighter drawdown behavior before promotion."
            )
        else:
            stability_summary = (
                "This candidate is being kept as a boundary reference only. "
                "It helps define where returns improve at the cost of unstable risk."
            )
        return _localize_optimization_analysis(
            {
                "title": title,
                "thesis": thesis,
                "shelf_copy": thesis,
                "stability_verdict": status_label,
                "stability_summary": stability_summary,
                "stability_checks": checks,
                "validation_windows": self._build_optimization_validation_windows(chart_series, validation_mode),
                "heatmap": self._build_optimization_heatmap_from_trials(
                    search_space,
                    parameter_snapshot,
                    [dict(trial) for trial in list(heatmap_trials or evaluated_trials)],
                    metrics,
                ),
            }
        )

    def _build_optimization_trial_preview_and_chart_series(
        self,
        strategy: Mapping[str, Any],
        evaluation_request: Mapping[str, Any],
        payload: Mapping[str, Any],
        parameter_snapshot: Mapping[str, Any],
    ) -> dict[str, Any]:
        effective_strategy = self._optimization_effective_strategy(strategy, parameter_snapshot)
        preview, chart_series, _ = self._simulate_run(effective_strategy, evaluation_request)
        metrics = self._build_real_optimization_metrics(preview, chart_series)
        return {
            "parameter_snapshot": dict(parameter_snapshot),
            "metrics": metrics,
            "chart_series": chart_series,
            "score": self._score_optimization_metrics(metrics, payload.get("objective")),
        }

    def _optimization_metric_from_trial(
        self,
        trial: Mapping[str, Any],
        key: str,
        *fallback_keys: str,
    ) -> float:
        metrics = _as_mapping(trial.get("metrics"))
        value = metrics.get(key)
        if value is None:
            value = trial.get(key)
        if value is None:
            for fallback_key in fallback_keys:
                fallback_value = metrics.get(fallback_key)
                if fallback_value is None:
                    fallback_value = trial.get(fallback_key)
                if fallback_value is not None:
                    value = fallback_value
                    break
        return _as_float(value, 0.0)

    def _optimization_status_rank(self, metrics: Mapping[str, Any]) -> float:
        return_sharpe = _as_float(metrics.get("return_sharpe"), _as_float(metrics.get("sharpe"), 0.0))
        out_of_sample_sharpe = _as_float(metrics.get("out_of_sample_sharpe"), return_sharpe)
        annualized_return = _as_float(metrics.get("annualized_return"), _as_float(metrics.get("cagr"), 0.0))
        max_drawdown_pct = _as_float(metrics.get("max_drawdown_pct"), 0.0)
        stability = _as_float(metrics.get("stability"), 0.0)
        if (
            annualized_return >= 0.10
            and return_sharpe >= 1.0
            and out_of_sample_sharpe >= 0.8
            and max_drawdown_pct >= -25.0
            and stability >= 70.0
        ):
            return 2.0
        if (
            annualized_return >= 0.06
            and return_sharpe >= 0.6
            and out_of_sample_sharpe >= 0.4
            and max_drawdown_pct >= -35.0
            and stability >= 50.0
        ):
            return 1.0
        return 0.0

    def _optimization_trial_primary_metric(
        self,
        trial: Mapping[str, Any],
        objective: Any = None,
    ) -> float:
        normalized_objective = _normalize_optimization_objective(objective)
        metrics = _as_mapping(trial.get("metrics"))
        if normalized_objective == "annualized_return":
            return _as_float(metrics.get("annualized_return"), _as_float(metrics.get("cagr"), 0.0))
        if normalized_objective == "composite_score":
            return _as_float(trial.get("score"), 0.0)
        return self._optimization_metric_from_trial(trial, "return_sharpe", "sharpe")

    def _optimization_trial_rank_key(
        self,
        trial: Mapping[str, Any],
        objective: Any = None,
    ) -> tuple[float, int]:
        trial_index = _as_int(trial.get("trial_index"), 0)
        return (
            self._optimization_trial_primary_metric(trial, objective),
            -trial_index,
        )

    def _update_optimization_trial_metrics(
        self,
        job_id: str,
        trial_index: int,
        metrics: Mapping[str, Any],
    ) -> None:
        metrics_payload = dict(metrics or {})
        return_sharpe = _as_float(
            metrics_payload.get("return_sharpe"),
            _as_float(metrics_payload.get("sharpe"), 0.0),
        )
        oos_sharpe = _as_float(
            metrics_payload.get("out_of_sample_sharpe"),
            _as_float(metrics_payload.get("oos_sharpe"), 0.0),
        )
        total_return_pct = _as_float(
            metrics_payload.get("total_return_pct"),
            _as_float(metrics_payload.get("total_return"), 0.0) * 100.0,
        )
        stability = _as_float(metrics_payload.get("stability"), 0.0)
        self.storage.execute(
            """
            UPDATE optimization_job_trials
            SET metrics_json = ?, return_sharpe = ?, oos_sharpe = ?, total_return_pct = ?, stability = ?
            WHERE job_id = ? AND trial_index = ?
            """,
            (
                dumps(metrics_payload),
                return_sharpe,
                oos_sharpe,
                total_return_pct,
                stability,
                job_id,
                int(trial_index),
            ),
        )

    def _repair_optimization_trial_metrics(
        self,
        job_id: str,
        trial_index: int,
        metrics: Mapping[str, Any],
        *,
        chart_series: Sequence[Mapping[str, Any]] | None = None,
        persist: bool = False,
    ) -> dict[str, Any]:
        current_metrics = dict(metrics or {})
        if not _optimization_metrics_need_repair(current_metrics):
            return current_metrics
        normalized_chart_series = [dict(item) for item in list(chart_series or []) if item]
        if not normalized_chart_series:
            return current_metrics
        repaired_metrics = _build_real_optimization_metrics_payload(
            {"metrics": current_metrics},
            normalized_chart_series,
        )
        if persist and repaired_metrics != current_metrics:
            self._update_optimization_trial_metrics(job_id, trial_index, repaired_metrics)
        return repaired_metrics

    def _normalize_optimization_heatmap_axis_value(self, value: Any) -> Any:
        if isinstance(value, float) and value.is_integer():
            return int(value)
        if isinstance(value, float):
            return round(value, 4)
        return value

    def _optimization_runtime_state(
        self,
        search_space: Sequence[Mapping[str, Any]],
        objective: Any = None,
    ) -> dict[str, Any]:
        range_entries = [
            dict(entry)
            for entry in list(search_space or [])
            if str(_as_mapping(entry).get("mode") or "").strip().lower() == "range"
        ]
        x_entry = range_entries[0] if range_entries else (_as_mapping(search_space[0]) if search_space else {})
        y_entry = range_entries[1] if len(range_entries) > 1 else {}
        x_key = str(_as_mapping(x_entry).get("key") or "").strip() or None
        y_key = str(_as_mapping(y_entry).get("key") or "").strip() or x_key
        return {
            "candidate_limit": self._optimization_candidate_limit(),
            "objective": _normalize_optimization_objective(objective),
            "top_trials": [],
            "x_key": x_key,
            "y_key": y_key,
            "cell_winners": {},
            "x_values": set(),
            "y_values": set(),
        }

    def _optimization_runtime_observe_trial(
        self,
        runtime_state: dict[str, Any],
        trial: Mapping[str, Any],
    ) -> None:
        if str(trial.get("status") or "").upper() != "SUCCEEDED":
            return

        top_trials = list(runtime_state.get("top_trials") or [])
        candidate_limit = _as_int(runtime_state.get("candidate_limit"), self._optimization_candidate_limit())
        trial_copy = dict(trial)
        trial_index = _as_int(trial_copy.get("trial_index"), 0)
        if trial_index > 0:
            top_trials = [
                item
                for item in top_trials
                if _as_int(_as_mapping(item).get("trial_index"), 0) != trial_index
            ]
        top_trials.append(trial_copy)
        objective = runtime_state.get("objective")
        top_trials.sort(
            key=lambda item: self._optimization_trial_rank_key(item, objective),
            reverse=True,
        )
        runtime_state["top_trials"] = top_trials[: max(1, candidate_limit)]

        x_key = str(runtime_state.get("x_key") or "").strip()
        y_key = str(runtime_state.get("y_key") or "").strip() or x_key
        if not x_key or not y_key:
            return
        parameter_snapshot = dict(trial_copy.get("parameter_snapshot") or {})
        x_value = self._normalize_optimization_heatmap_axis_value(parameter_snapshot.get(x_key))
        y_value = self._normalize_optimization_heatmap_axis_value(parameter_snapshot.get(y_key))
        if x_value is None or y_value is None:
            return
        x_values = runtime_state.setdefault("x_values", set())
        y_values = runtime_state.setdefault("y_values", set())
        cell_winners = runtime_state.setdefault("cell_winners", {})
        if not isinstance(x_values, set):
            x_values = set(list(x_values or []))
            runtime_state["x_values"] = x_values
        if not isinstance(y_values, set):
            y_values = set(list(y_values or []))
            runtime_state["y_values"] = y_values
        if not isinstance(cell_winners, dict):
            cell_winners = dict(cell_winners or {})
            runtime_state["cell_winners"] = cell_winners
        x_values.add(x_value)
        y_values.add(y_value)
        rank_key = self._optimization_trial_rank_key(trial_copy, objective)
        cell_key = (x_value, y_value)
        existing = _as_mapping(cell_winners.get(cell_key))
        existing_rank = self._optimization_trial_rank_key(existing, objective) if existing else None
        if existing is None or existing_rank is None or rank_key > existing_rank:
            cell_winners[cell_key] = {
                "x": x_value,
                "y": y_value,
                "score": _as_float(trial_copy.get("score"), 0.0),
                "metrics": dict(trial_copy.get("metrics") or {}),
                "status": "SUCCEEDED",
            }

    def _optimization_runtime_seed(
        self,
        runtime_state: dict[str, Any],
        trials: Sequence[Mapping[str, Any]],
    ) -> None:
        for trial in list(trials or []):
            self._optimization_runtime_observe_trial(runtime_state, trial)

    def _optimization_runtime_top_trials(
        self,
        runtime_state: dict[str, Any],
    ) -> list[dict[str, Any]]:
        return [dict(item) for item in list(runtime_state.get("top_trials") or [])]

    def _optimization_runtime_best_summary(
        self,
        runtime_state: dict[str, Any],
    ) -> dict[str, Any] | None:
        top_trials = self._optimization_runtime_top_trials(runtime_state)
        if not top_trials:
            return None
        return self._optimization_trial_summary(top_trials[0])

    def _optimization_runtime_heatmap_summary(
        self,
        runtime_state: dict[str, Any],
    ) -> dict[str, Any] | None:
        x_key = str(runtime_state.get("x_key") or "").strip()
        y_key = str(runtime_state.get("y_key") or "").strip()
        if not x_key or not y_key:
            return None
        x_values = list(runtime_state.get("x_values") or [])
        y_values = list(runtime_state.get("y_values") or [])
        cell_winners = runtime_state.get("cell_winners") or {}
        if not x_values or not y_values or not cell_winners:
            return None
        if all(isinstance(value, (int, float)) and not isinstance(value, bool) for value in x_values):
            x_values = sorted(x_values)
        else:
            x_values = sorted(x_values, key=lambda item: str(item))
        if all(isinstance(value, (int, float)) and not isinstance(value, bool) for value in y_values):
            y_values = sorted(y_values)
        else:
            y_values = sorted(y_values, key=lambda item: str(item))
        cells = [
            {
                "x": cell.get("x"),
                "y": cell.get("y"),
                "score": _as_float(cell.get("score"), 0.0),
                "metrics": dict(cell.get("metrics") or {}),
            }
            for cell in list(cell_winners.values())
        ]
        if all(
            isinstance(item.get("x"), (int, float)) and isinstance(item.get("y"), (int, float))
            for item in cells
        ):
            cells.sort(key=lambda item: (_as_float(item.get("y"), 0.0), _as_float(item.get("x"), 0.0)))
        else:
            cells.sort(key=lambda item: (str(item.get("y")), str(item.get("x"))))
        return {
            "x_key": x_key,
            "y_key": y_key,
            "x_values": x_values,
            "y_values": y_values,
            "cells": cells,
        }

    def _optimization_heatmap_trials_from_summary(
        self,
        heatmap_summary: Mapping[str, Any] | None,
    ) -> list[dict[str, Any]]:
        summary = _as_mapping(heatmap_summary)
        x_key = str(summary.get("x_key") or "").strip()
        y_key = str(summary.get("y_key") or "").strip() or x_key
        if not x_key or not y_key:
            return []
        trials: list[dict[str, Any]] = []
        for index, cell in enumerate(list(summary.get("cells") or []), start=1):
            cell_mapping = _as_mapping(cell)
            parameter_snapshot = {
                x_key: cell_mapping.get("x"),
                y_key: cell_mapping.get("y"),
            }
            trials.append(
                {
                    "trial_index": index,
                    "status": "SUCCEEDED",
                    "parameter_snapshot": parameter_snapshot,
                    "metrics": dict(cell_mapping.get("metrics") or {}),
                    "score": _as_float(cell_mapping.get("score"), 0.0),
                    "chart_series": [],
                }
            )
        return trials

    def _optimization_with_full_metrics(
        self,
        job_id: str,
        trials: Sequence[Mapping[str, Any]],
    ) -> list[dict[str, Any]]:
        trial_indices = [
            _as_int(trial.get("trial_index"), 0)
            for trial in list(trials or [])
            if _as_int(trial.get("trial_index"), 0) > 0
        ]
        if not trial_indices:
            return [dict(trial) for trial in list(trials or [])]
        full_trials = self._load_optimization_trials(
            job_id,
            include_chart_series=False,
            trial_indices=trial_indices,
            include_metrics_json=True,
        )
        full_trial_by_index = {
            _as_int(trial.get("trial_index"), 0): dict(trial)
            for trial in full_trials
            if _as_int(trial.get("trial_index"), 0) > 0
        }
        merged_trials: list[dict[str, Any]] = []
        for trial in list(trials or []):
            trial_index = _as_int(trial.get("trial_index"), 0)
            merged = dict(trial)
            full_trial = full_trial_by_index.get(trial_index)
            if full_trial is not None:
                merged["metrics"] = dict(full_trial.get("metrics") or {})
            merged_trials.append(merged)
        return merged_trials

    def _rank_optimization_trials(
        self,
        trials: list[dict[str, Any]],
        objective: Any = None,
    ) -> list[dict[str, Any]]:
        normalized_objective = _normalize_optimization_objective(objective)
        return sorted(
            [dict(item) for item in trials],
            key=lambda item: self._optimization_trial_rank_key(item, normalized_objective),
            reverse=True,
        )

    def _rerank_optimization_candidate_records(
        self,
        candidates: Sequence[Mapping[str, Any]],
        objective: Any = None,
    ) -> list[dict[str, Any]]:
        ranked_candidates = self._rank_optimization_trials(
            [dict(candidate) for candidate in list(candidates or [])],
            objective,
        )
        normalized_candidates: list[dict[str, Any]] = []
        for rank, candidate in enumerate(ranked_candidates, start=1):
            candidate_copy = dict(candidate)
            candidate_copy["rank"] = rank
            normalized_candidates.append(candidate_copy)
        return normalized_candidates

    def _optimization_candidate_constraints(self, payload: Mapping[str, Any]) -> list[dict[str, Any]]:
        return list(_normalize_optimization_constraints_payload(payload).get("constraints") or [])

    def _optimization_trial_passes_constraints(
        self,
        trial: Mapping[str, Any],
        constraints: Sequence[Mapping[str, Any]],
    ) -> bool:
        return _optimization_metrics_satisfy_constraints(
            _as_mapping(trial.get("metrics")),
            constraints,
        )

    def _optimization_job_has_persisted_trials(self, job_id: str) -> bool:
        return (
            self.storage.fetch_one(
                "SELECT 1 AS has_trials FROM optimization_job_trials WHERE job_id = ? LIMIT 1",
                (job_id,),
            )
            is not None
        )

    def _count_optimization_candidate_snapshots_matching_constraints(
        self,
        candidates: Sequence[Mapping[str, Any]],
        constraints: Sequence[Mapping[str, Any]],
    ) -> int:
        normalized_constraints = [dict(item) for item in list(constraints or []) if item]
        match_count = 0
        for candidate in list(candidates or []):
            payload = _as_mapping(candidate)
            if str(payload.get("status") or "SUCCEEDED").upper() != "SUCCEEDED":
                continue
            if self._optimization_trial_passes_constraints(payload, normalized_constraints):
                match_count += 1
        return match_count

    def _count_optimization_trials_matching_constraints(
        self,
        job_id: str,
        constraints: Sequence[Mapping[str, Any]],
    ) -> int:
        rows = self.storage.fetch_all(
            """
            SELECT
                status,
                metrics_json,
                return_sharpe,
                oos_sharpe,
                total_return_pct,
                stability
            FROM optimization_job_trials
            WHERE job_id = ?
            """,
            (job_id,),
        )
        normalized_constraints = [dict(item) for item in list(constraints or []) if item]
        if not rows:
            job_row = self.storage.fetch_one(
                "SELECT candidates_json FROM optimization_jobs WHERE id = ?",
                (job_id,),
            )
            if not job_row:
                return 0
            return self._count_optimization_candidate_snapshots_matching_constraints(
                list(loads(job_row.get("candidates_json"), [])),
                normalized_constraints,
            )
        match_count = 0
        for row in rows:
            if str(row.get("status") or "SUCCEEDED").upper() != "SUCCEEDED":
                continue
            metrics_payload = loads(row.get("metrics_json"), {})
            metrics = dict(metrics_payload or {})
            return_sharpe = _as_float(
                row.get("return_sharpe"),
                _as_float(metrics.get("return_sharpe"), _as_float(metrics.get("sharpe"), 0.0)),
            )
            oos_sharpe = _as_float(
                row.get("oos_sharpe"),
                _as_float(metrics.get("out_of_sample_sharpe"), _as_float(metrics.get("oos_sharpe"), 0.0)),
            )
            total_return_pct = _as_float(
                row.get("total_return_pct"),
                _as_float(metrics.get("total_return_pct"), _as_float(metrics.get("total_return"), 0.0) * 100.0),
            )
            stability = _as_float(row.get("stability"), _as_float(metrics.get("stability"), 0.0))
            metrics["return_sharpe"] = return_sharpe
            metrics.setdefault("sharpe", return_sharpe)
            metrics["out_of_sample_sharpe"] = oos_sharpe
            metrics["oos_sharpe"] = oos_sharpe
            metrics["total_return_pct"] = total_return_pct
            metrics["stability"] = stability
            if self._optimization_trial_passes_constraints({"metrics": metrics}, normalized_constraints):
                match_count += 1
        return match_count

    def _select_optimization_candidate_trials(
        self,
        trials: Sequence[Mapping[str, Any]],
        payload: Mapping[str, Any],
    ) -> list[dict[str, Any]]:
        successful_trials = [
            dict(trial)
            for trial in list(trials or [])
            if str(_as_mapping(trial).get("status") or "SUCCEEDED").upper() == "SUCCEEDED"
        ]
        ranked_trials = self._rank_optimization_trials(successful_trials, payload.get("objective"))
        constraints = self._optimization_candidate_constraints(payload)
        selected_trials: list[dict[str, Any]] = []
        seen_metric_signatures: set[tuple[float, float, float, float, float, float, float]] = set()
        for require_constraint_match in (True, False):
            for trial in ranked_trials:
                if self._optimization_trial_passes_constraints(trial, constraints) != require_constraint_match:
                    continue
                metric_signature = _optimization_metrics_signature(trial.get("metrics") or {})
                if metric_signature in seen_metric_signatures:
                    continue
                seen_metric_signatures.add(metric_signature)
                selected_trials.append(dict(trial))
                if len(selected_trials) >= self._optimization_candidate_limit():
                    return selected_trials
        return selected_trials

    def _build_optimization_candidates_from_trial_pool(
        self,
        *,
        job_id: str | None,
        strategy: Mapping[str, Any],
        payload: Mapping[str, Any],
        trials: Sequence[Mapping[str, Any]],
        heatmap_trials: Sequence[Mapping[str, Any]] | None = None,
        existing_candidates: Sequence[Mapping[str, Any]] | None = None,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        selected_trials = self._select_optimization_candidate_trials(trials, payload)
        selected_indices = [
            _as_int(trial.get("trial_index"), 0)
            for trial in selected_trials
            if _as_int(trial.get("trial_index"), 0) > 0
        ]
        if job_id and selected_indices:
            selected_trials = self._merge_optimization_trial_chart_series(
                selected_trials,
                self._load_optimization_trial_chart_series_map(job_id, selected_indices),
            )
        candidates = self._build_optimization_candidate_records(
            strategy,
            payload,
            selected_trials,
            heatmap_trials=heatmap_trials or trials,
            preserve_trial_order=True,
        )
        existing_id_by_snapshot = {
            _optimization_parameter_snapshot_signature(candidate.get("parameter_snapshot") or {}): str(candidate.get("id") or "").strip()
            for candidate in list(existing_candidates or [])
            if str(_as_mapping(candidate).get("id") or "").strip()
        }
        for candidate in candidates:
            existing_id = existing_id_by_snapshot.get(
                _optimization_parameter_snapshot_signature(candidate.get("parameter_snapshot") or {})
            )
            if existing_id:
                candidate["id"] = existing_id
        preserved_candidate_ids = {
            str(candidate.get("id") or "").strip()
            for candidate in candidates
            if str(candidate.get("id") or "").strip()
        }
        next_rank = len(candidates) + 1
        for existing_candidate in list(existing_candidates or []):
            existing_candidate_map = _as_mapping(existing_candidate)
            existing_id = str(existing_candidate_map.get("id") or "").strip()
            if not existing_id or existing_id in preserved_candidate_ids:
                continue
            if _is_default_optimization_candidate_label(existing_candidate_map.get("label")):
                continue
            normalized_existing_candidate = self._normalize_optimization_candidate(
                strategy,
                existing_candidate_map,
                rank=next_rank,
                base_parameter_version_id=(
                    str(
                        existing_candidate_map.get("base_parameter_version_id")
                        or payload.get("base_parameter_version_id")
                        or ""
                    ).strip()
                    or None
                ),
            )
            normalized_existing_candidate["id"] = existing_id
            candidates.append(normalized_existing_candidate)
            preserved_candidate_ids.add(existing_id)
            next_rank += 1
        return candidates, selected_trials

    def _build_optimization_candidate_records(
        self,
        strategy: Mapping[str, Any],
        payload: Mapping[str, Any],
        trials: list[dict[str, Any]],
        *,
        heatmap_trials: Sequence[Mapping[str, Any]] | None = None,
        preserve_trial_order: bool = False,
    ) -> list[dict[str, Any]]:
        ranked_trials = (
            [dict(item) for item in trials]
            if preserve_trial_order
            else self._rank_optimization_trials(trials, payload.get("objective"))
        )
        heatmap_source_trials = [dict(item) for item in list(heatmap_trials or ranked_trials)]
        search_space = list(payload.get("search_space") or [])
        validation_mode = str(payload.get("validation_mode") or "walk_forward")
        candidates: list[dict[str, Any]] = []
        for rank, trial in enumerate(ranked_trials[: self._optimization_candidate_limit()], start=1):
            status_label = self._optimization_status_label(trial.get("metrics") or {})
            title = self._optimization_candidate_title(rank)
            summary = self._optimization_candidate_summary(
                trial.get("parameter_snapshot") or {},
                trial.get("metrics") or {},
                search_space,
            )
            analysis = self._build_real_optimization_candidate_analysis(
                title=title,
                metrics=trial.get("metrics") or {},
                search_space=search_space,
                parameter_snapshot=trial.get("parameter_snapshot") or {},
                validation_mode=validation_mode,
                chart_series=list(trial.get("chart_series") or []),
                evaluated_trials=ranked_trials,
                heatmap_trials=heatmap_source_trials,
                status_label=status_label,
            )
            candidates.append(
                self._build_candidate_record(
                    strategy=strategy,
                    parameter_snapshot=trial.get("parameter_snapshot") or {},
                    base_parameter_version_id=str(payload.get("base_parameter_version_id") or "").strip() or None,
                    label=f"候选 {rank}",
                    title=title,
                    status_label=status_label,
                    metrics=trial.get("metrics") or {},
                    summary=summary,
                    rank=rank,
                    score=_as_float(trial.get("score"), 0.0),
                    analysis=analysis,
                )
            )
        return candidates

    def _repair_optimization_job_candidates(
        self,
        *,
        job: Mapping[str, Any],
        strategy: Mapping[str, Any],
        raw_candidates: Sequence[Mapping[str, Any]],
        normalized_search_space: Sequence[Mapping[str, Any]],
    ) -> tuple[list[dict[str, Any]], dict[str, Any] | None, bool]:
        best_metrics_summary = _as_mapping(_as_mapping(job.get("summary")).get("best_metrics_summary"))
        candidate_list = [dict(candidate) for candidate in list(raw_candidates or [])]
        needs_repair = any(
            _optimization_metrics_need_repair(_as_mapping(candidate).get("metrics"))
            for candidate in candidate_list
        )
        if best_metrics_summary and _optimization_metrics_need_repair(best_metrics_summary.get("metrics")):
            needs_repair = True

        job_id = str(job.get("id") or "").strip()
        if not job_id:
            return candidate_list, (best_metrics_summary or None), False

        trials = self._load_optimization_trials(
            job_id,
            include_chart_series=False,
            include_metrics_json=True,
        )
        successful_trials = [
            dict(trial)
            for trial in trials
            if str(trial.get("status") or "").upper() == "SUCCEEDED"
        ]
        if not successful_trials:
            return candidate_list, (best_metrics_summary or None), False

        repaired_trials = [dict(trial) for trial in successful_trials]
        if needs_repair:
            chart_series_by_index = self._load_optimization_trial_chart_series_map(
                job_id,
                [
                    _as_int(trial.get("trial_index"), 0)
                    for trial in successful_trials
                    if _as_int(trial.get("trial_index"), 0) > 0
                ],
            )
            repaired_trials = []
            for trial in successful_trials:
                trial_copy = dict(trial)
                trial_index = _as_int(trial_copy.get("trial_index"), 0)
                chart_series = list(chart_series_by_index.get(trial_index) or [])
                if chart_series:
                    trial_copy["chart_series"] = chart_series
                    trial_copy["metrics"] = self._repair_optimization_trial_metrics(
                        job_id,
                        trial_index,
                        trial_copy.get("metrics") or {},
                        chart_series=chart_series,
                        persist=True,
                    )
                repaired_trials.append(trial_copy)

        candidate_payload = {
            **dict(_as_mapping(job.get("request"))),
            "search_space": list(normalized_search_space or []),
            "base_parameter_version_id": job.get("base_parameter_version_id"),
            "validation_mode": (
                _as_mapping(job.get("summary")).get("validation_mode")
                or _as_mapping(job.get("request")).get("validation_mode")
                or "walk_forward"
            ),
        }
        rebuilt_candidates, selected_trials = self._build_optimization_candidates_from_trial_pool(
            job_id=job_id,
            strategy=strategy,
            payload=candidate_payload,
            trials=repaired_trials,
            heatmap_trials=repaired_trials,
            existing_candidates=candidate_list,
        )
        rebuilt_best_metrics_summary = self._best_optimization_trial_summary(
            selected_trials or repaired_trials,
            candidate_payload.get("objective"),
        )
        rebuilt_any = needs_repair or (
            [
                _optimization_candidate_projection_signature(candidate)
                for candidate in candidate_list
            ]
            != [
                _optimization_candidate_projection_signature(candidate)
                for candidate in rebuilt_candidates
            ]
        )
        if not rebuilt_any:
            return candidate_list, (best_metrics_summary or rebuilt_best_metrics_summary or None), False
        return rebuilt_candidates, rebuilt_best_metrics_summary, True

    def _build_optimization_job_summary(
        self,
        payload: Mapping[str, Any],
        candidates: list[dict[str, Any]],
    ) -> dict[str, Any]:
        status = str(payload.get("status") or "COMPLETED").upper()
        eta_active = status == "RUNNING"
        baseline_parameter_version_id = str(payload.get("base_parameter_version_id") or "").strip() or None
        budget_combinations = _as_int(payload.get("budget_combinations"), max(len(candidates) * 10, 24))
        completed_combinations = _as_int(
            payload.get("completed_combinations"),
            budget_combinations if status == "COMPLETED" else min(budget_combinations, len(candidates)),
        )
        summary = {
            "objective": payload.get("objective") or "sharpe",
            "candidate_count": len(candidates),
            "matching_combination_count": payload.get("matching_combination_count"),
            "baseline_parameter_version_id": baseline_parameter_version_id,
            "entry_point": payload.get("entry_point") or "lab_menu",
            "validation_mode": payload.get("validation_mode") or "walk_forward",
            "source_run_id": payload.get("source_run_id"),
            "budget_combinations": budget_combinations,
            "completed_combinations": completed_combinations,
            "search_space": list(payload.get("search_space") or []),
        }
        summary["status"] = status
        summary["progress_pct"] = min(100, max(0, _as_int(payload.get("progress_pct"), 100 if status == "COMPLETED" else 0)))
        summary["current_stage"] = payload.get("current_stage") or ("Result ready" if status == "COMPLETED" else "Running")
        summary["latest_update"] = payload.get("latest_update") or (
            "Optimization completed." if status == "COMPLETED" else "Optimization in progress."
        )
        best_metrics_summary = _as_mapping(payload.get("best_metrics_summary"))
        latest_candidate_label = self._canonical_optimization_candidate_label(
            payload.get("latest_candidate_label"),
            _as_int(best_metrics_summary.get("trial_index"), 1),
        )
        if latest_candidate_label:
            summary["latest_candidate_label"] = latest_candidate_label
        return summary

    def _build_optimization_job_result(
        self,
        payload: Mapping[str, Any],
        candidates: list[dict[str, Any]],
    ) -> dict[str, Any]:
        status = str(payload.get("status") or "COMPLETED").upper()
        baseline_parameter_version_id = str(payload.get("base_parameter_version_id") or "").strip() or None
        progress_pct = min(100, max(0, _as_int(payload.get("progress_pct"), 100 if status == "COMPLETED" else 0)))
        if status in {"QUEUED", "RUNNING", "INTERRUPTED"}:
            headline = self._canonical_optimization_candidate_label(
                payload.get("latest_candidate_label"),
                _as_int(_as_mapping(payload.get("best_metrics_summary")).get("trial_index"), 1),
            )
            return {
                "best_candidate_id": None,
                "best_candidate_label": None,
                "baseline_parameter_version_id": baseline_parameter_version_id,
                "headline": headline if headline else "Optimization in progress",
                "summary": str(payload.get("latest_update") or "").strip() or "Optimization in progress.",
                "stability_verdict": None,
                "status": status,
                "progress_pct": progress_pct,
                "current_stage": payload.get("current_stage") or ("Interrupted" if status == "INTERRUPTED" else "Running"),
                "latest_update": payload.get("latest_update") or "Optimization in progress.",
                "estimated_remaining_minutes": payload.get("estimated_remaining_minutes"),
                "estimated_completed_at": payload.get("estimated_completed_at"),
            }

        best_candidate = candidates[0] if candidates else None
        best_analysis = dict((best_candidate or {}).get("analysis") or {})
        headline = best_analysis.get("title") if best_candidate else None
        summary = best_candidate.get("summary") if best_candidate else None
        if not summary:
            summary = str(payload.get("latest_update") or "").strip() or "Optimization completed."
        return {
            "best_candidate_id": best_candidate.get("id") if best_candidate else None,
            "best_candidate_label": self._canonical_optimization_candidate_label(
                best_candidate.get("label"),
                _as_int(best_candidate.get("rank"), 1),
            )
            if best_candidate
            else None,
            "baseline_parameter_version_id": baseline_parameter_version_id,
            "headline": headline,
            "summary": summary,
            "stability_verdict": best_analysis.get("stability_verdict") if best_candidate else None,
            "status": status,
            "progress_pct": progress_pct,
            "current_stage": payload.get("current_stage") or "Result ready",
            "latest_update": payload.get("latest_update") or summary,
            "estimated_remaining_minutes": payload.get("estimated_remaining_minutes"),
            "estimated_completed_at": payload.get("estimated_completed_at"),
        }

    def _hydrate_optimization_job(self, row: Mapping[str, Any]) -> dict[str, Any]:
        job = dict(row)
        job["request"] = loads(job.pop("request_json", None), {})
        job["summary"] = loads(job.pop("summary_json", None), {})
        job["result"] = loads(job.pop("result_json", None), {})
        raw_candidates = loads(job.pop("candidates_json", None), [])
        constraint_payload = _normalize_optimization_constraints_payload(
            {
                "constraint_preset_key": job["request"].get("constraint_preset_key")
                or job["summary"].get("constraint_preset_key")
                or job["result"].get("constraint_preset_key"),
                "constraint_label": job["request"].get("constraint_label")
                or job["summary"].get("constraint_label")
                or job["result"].get("constraint_label"),
                "constraints": job["request"].get("constraints")
                or job["summary"].get("constraints")
                or job["result"].get("constraints"),
            }
        )
        job["request"].update(constraint_payload)
        job["summary"].update(constraint_payload)
        job["result"].update(constraint_payload)
        normalized_objective = _normalize_optimization_objective(
            job["summary"].get("objective") or job["request"].get("objective")
        )
        job["request"]["objective"] = normalized_objective
        job["summary"]["objective"] = normalized_objective
        job["base_parameter_version_id"] = job["request"].get("base_parameter_version_id")
        raw_request = dict(job["request"])
        raw_summary = dict(job["summary"])
        raw_result = dict(job["result"])
        summary_status = str(
            job["summary"].get("status")
            or job.get("status")
            or job["request"].get("status")
            or job["result"].get("status")
            or "COMPLETED"
        ).upper()
        matching_combination_source = str(
            job["summary"].get("matching_combination_source")
            or job["request"].get("matching_combination_source")
            or ""
        ).strip() or None
        running_like = summary_status in {"QUEUED", "RUNNING", "INTERRUPTED"}
        eta_active = summary_status == "RUNNING"
        progress_default = 100 if summary_status == "COMPLETED" else 0
        job["summary"]["status"] = summary_status
        job["summary"].setdefault(
            "progress_pct",
            _as_int(
                job["request"].get("progress_pct"),
                _as_int(job["result"].get("progress_pct"), progress_default),
            ),
        )
        job["summary"].setdefault(
            "current_stage",
            job["request"].get("current_stage")
            or job["result"].get("current_stage")
            or ("Result ready" if summary_status == "COMPLETED" else "Running"),
        )
        job["summary"].setdefault(
            "latest_update",
            job["request"].get("latest_update")
            or job["result"].get("latest_update")
            or job["result"].get("summary")
            or ("Optimization completed." if summary_status == "COMPLETED" else "Optimization in progress."),
        )
        strategy = self.get_strategy_detail(str(job["strategy_id"]))
        job["strategy_name"] = _display_strategy_name(
            row.get("strategy_name") or strategy.get("name"),
            strategy.get("parameters"),
        )
        normalized_search_space = self._normalize_optimization_search_space(
            strategy,
            {"search_space": job["request"].get("search_space") or job["summary"].get("search_space")},
        )
        if normalized_search_space:
            job["request"]["search_space"] = normalized_search_space
            job["summary"]["search_space"] = normalized_search_space
        normalized_candidates: list[dict[str, Any]] = []
        for index, candidate in enumerate(raw_candidates, start=1):
            normalized_candidate = self._normalize_optimization_candidate(
                strategy,
                candidate,
                rank=index,
                base_parameter_version_id=job["base_parameter_version_id"],
            )
            analysis = dict(normalized_candidate.get("analysis") or {})
            heatmap = dict(analysis.get("heatmap") or {})
            if normalized_search_space and not heatmap.get("cells"):
                analysis["heatmap"] = self._build_optimization_heatmap(
                    normalized_search_space,
                    normalized_candidate.get("parameter_snapshot") or {},
                    _as_float(
                        normalized_candidate.get("metrics", {}).get("return_sharpe"),
                        _as_float(
                            normalized_candidate.get("metrics", {}).get("sharpe"),
                            _as_float(normalized_candidate.get("score"), 0.0),
                        ),
                    ),
                    normalized_candidate.get("metrics") or {},
                )
            if analysis:
                normalized_candidate["analysis"] = analysis
            normalized_candidates.append(normalized_candidate)
        job["candidates"] = normalized_candidates
        best_candidate = normalized_candidates[0] if normalized_candidates else None
        if best_candidate:
            job["result"]["best_candidate_label"] = best_candidate.get("label")
            best_metrics_summary = _as_mapping(job["summary"].get("best_metrics_summary"))
            if best_metrics_summary:
                best_metrics_summary["label"] = self._canonical_optimization_candidate_label(
                    best_candidate.get("label"),
                    _as_int(best_candidate.get("rank"), _as_int(best_metrics_summary.get("trial_index"), 1)),
                )
                best_metrics_summary["trial_index"] = _as_int(
                    best_candidate.get("rank"),
                    _as_int(best_metrics_summary.get("trial_index"), 0),
                )
                job["summary"]["best_metrics_summary"] = best_metrics_summary
        return job
    def _is_legacy_mock_optimization_job_row(self, row: Mapping[str, Any]) -> bool:
        request = loads(row.get("request_json"), {})
        summary = loads(row.get("summary_json"), {})
        result = loads(row.get("result_json"), {})
        candidates = loads(row.get("candidates_json"), [])
        labels = tuple(str(candidate.get("label") or "").strip() for candidate in candidates[:4])
        if labels in {
            LEGACY_MOCK_OPTIMIZATION_LABELS,
            LEGACY_MOCK_OPTIMIZATION_LABELS_GARBLED,
            LEGACY_MOCK_OPTIMIZATION_LABELS_ZH,
        }:
            return True

        first_candidate = dict(candidates[0] or {}) if candidates else {}
        if (
            len(candidates) == 1
            and str(first_candidate.get("label") or "").strip() == "Baseline + 1"
            and not _as_mapping(first_candidate.get("metrics"))
            and not summary.get("budget_combinations")
            and not request.get("validation_mode")
            and not result.get("headline")
        ):
            return True
        return False

    def _purge_legacy_mock_optimization_jobs(self) -> list[str]:
        rows = self.storage.fetch_all(
            """
            SELECT id, request_json, summary_json, result_json, candidates_json
            FROM optimization_jobs
            WHERE deleted_at IS NULL
            """
        )
        legacy_ids = [
            str(row.get("id") or "")
            for row in rows
            if row.get("id") and self._is_legacy_mock_optimization_job_row(row)
        ]
        if not legacy_ids:
            return []
        placeholders = ", ".join("?" for _ in legacy_ids)
        self.storage.execute(
            f"DELETE FROM optimization_jobs WHERE id IN ({placeholders})",
            tuple(legacy_ids),
        )
        return legacy_ids

    def _decode_optimization_job_list_row(self, row: Mapping[str, Any]) -> dict[str, Any]:
        request = loads(row.get("request_json"), {})
        if not isinstance(request, dict):
            request = {}
        summary = loads(row.get("summary_json"), {})
        if not isinstance(summary, dict):
            summary = {}
        result = loads(row.get("result_json"), {})
        if not isinstance(result, dict):
            result = {}
        constraint_payload = _normalize_optimization_constraints_payload(
            {
                "constraint_preset_key": request.get("constraint_preset_key")
                or summary.get("constraint_preset_key")
                or result.get("constraint_preset_key"),
                "constraint_label": request.get("constraint_label")
                or summary.get("constraint_label")
                or result.get("constraint_label"),
                "constraints": request.get("constraints") or summary.get("constraints") or result.get("constraints"),
            }
        )
        request = {**request, **constraint_payload}
        summary = {**summary, **constraint_payload}
        result = {**result, **constraint_payload}

        status = str(
            row.get("status")
            or summary.get("status")
            or request.get("status")
            or result.get("status")
            or "COMPLETED"
        ).upper()
        running_like = status in {"QUEUED", "RUNNING", "INTERRUPTED"}
        eta_active = status == "RUNNING"
        progress_default = 0 if running_like else 100
        budget_combinations = _as_int(summary.get("budget_combinations"), _as_int(request.get("budget_combinations"), 0))
        completed_combinations = _as_int(
            summary.get("completed_combinations"),
            _as_int(request.get("completed_combinations"), 0 if running_like else budget_combinations),
        )
        persisted_trial_count = _as_int(
            summary.get("persisted_trial_count"),
            _as_int(request.get("persisted_trial_count"), completed_combinations),
        )
        next_trial_index = _as_int(
            summary.get("next_trial_index"),
            _as_int(request.get("next_trial_index"), completed_combinations + 1),
        )
        estimated_remaining_minutes = None
        estimated_completed_at = None
        if eta_active:
            estimated_remaining_minutes = summary.get("estimated_remaining_minutes")
            if estimated_remaining_minutes is None:
                estimated_remaining_minutes = result.get("estimated_remaining_minutes")
            estimated_completed_at = summary.get("estimated_completed_at") or result.get("estimated_completed_at")
        elif not running_like:
            estimated_remaining_minutes = 0
            estimated_completed_at = str(row.get("completed_at") or row.get("updated_at") or "").strip() or None

        best_metrics_summary_payload = _as_mapping(summary.get("best_metrics_summary"))
        best_metrics_summary = (
            self._normalized_optimization_trial_summary(best_metrics_summary_payload)
            if best_metrics_summary_payload
            else None
        )
        best_summary_trial_index = _as_int(_as_mapping(best_metrics_summary).get("trial_index"), 1)
        if best_metrics_summary is not None:
            best_metrics_summary["label"] = self._canonical_optimization_candidate_label(
                best_metrics_summary.get("label"),
                best_summary_trial_index,
            )
        normalized_result = dict(result)
        best_candidate_label = normalized_result.get("best_candidate_label")
        if best_candidate_label is not None:
            normalized_result["best_candidate_label"] = self._canonical_optimization_candidate_label(
                best_candidate_label,
                best_summary_trial_index,
            )
        normalized_best_candidate_label = normalized_result.get("best_candidate_label")
        if best_metrics_summary is not None:
            best_metrics_summary["label"] = normalized_best_candidate_label or self._canonical_optimization_candidate_label(
                best_metrics_summary.get("label"),
                best_summary_trial_index,
            )
        if summary.get("current_stage") is not None:
            current_stage = summary.get("current_stage")
        elif request.get("current_stage") is not None:
            current_stage = request.get("current_stage")
        elif result.get("current_stage") is not None:
            current_stage = result.get("current_stage")
        elif status == "COMPLETED":
            current_stage = "Result ready"
        elif status == "INTERRUPTED":
            current_stage = "Interrupted"
        elif status == "QUEUED":
            current_stage = "Queued"
        else:
            current_stage = "Running"

        latest_update = (
            summary.get("latest_update")
            or request.get("latest_update")
            or result.get("latest_update")
            or result.get("summary")
        )
        if latest_update is None:
            latest_update = "Optimization in progress." if running_like else "Optimization completed."

        return {
            "id": row["id"],
            "strategy_id": row["strategy_id"],
            "strategy_name": (
                _display_strategy_name(row.get("strategy_name"))
                if str(row.get("strategy_name") or "").strip()
                else None
            ),
            "status": status,
            "request": request,
            "summary": {
                **summary,
                "status": status,
                "budget_combinations": budget_combinations,
                "completed_combinations": completed_combinations,
                "progress_pct": _as_int(
                    summary.get("progress_pct"),
                    _as_int(result.get("progress_pct"), _as_int(request.get("progress_pct"), progress_default)),
                ),
                "current_stage": current_stage,
                "latest_update": latest_update,
                "estimated_remaining_minutes": estimated_remaining_minutes,
                "estimated_completed_at": estimated_completed_at,
                "resume_ready": bool(summary.get("resume_ready")) or status == "INTERRUPTED",
                "persisted_trial_count": persisted_trial_count,
                "next_trial_index": next_trial_index,
                "interrupted_reason": summary.get("interrupted_reason") or request.get("interrupted_reason"),
                "best_metrics_summary": best_metrics_summary,
            },
            "result": normalized_result,
            "base_parameter_version_id": str(
                request.get("base_parameter_version_id") or summary.get("baseline_parameter_version_id") or ""
            ).strip()
            or None,
            "constraint_preset_key": summary.get("constraint_preset_key") or request.get("constraint_preset_key"),
            "constraint_label": summary.get("constraint_label") or request.get("constraint_label"),
            "constraints": summary.get("constraints") or request.get("constraints"),
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
            "completed_at": row.get("completed_at"),
        }

    def _project_optimization_job_list_item(self, job: Mapping[str, Any]) -> dict[str, Any]:
        request = dict(job.get("request") or {})
        summary = dict(job.get("summary") or {})
        result = dict(job.get("result") or {})
        return {
            "id": job["id"],
            "strategy_id": job["strategy_id"],
            "strategy_name": job.get("strategy_name"),
            "status": job.get("status"),
            "entry_point": summary.get("entry_point") or request.get("entry_point") or "lab_menu",
            "validation_mode": summary.get("validation_mode") or request.get("validation_mode") or "walk_forward",
            "source_run_id": summary.get("source_run_id") or request.get("source_run_id"),
            "budget_combinations": summary.get("budget_combinations"),
            "completed_combinations": summary.get("completed_combinations"),
            "best_candidate_id": result.get("best_candidate_id"),
            "best_candidate_label": result.get("best_candidate_label"),
            "base_parameter_version_id": job.get("base_parameter_version_id"),
            "constraint_preset_key": summary.get("constraint_preset_key") or request.get("constraint_preset_key"),
            "constraint_label": summary.get("constraint_label") or request.get("constraint_label"),
            "constraints": summary.get("constraints") or request.get("constraints"),
            "progress_pct": summary.get("progress_pct"),
            "current_stage": summary.get("current_stage"),
            "latest_update": summary.get("latest_update"),
            "estimated_remaining_minutes": summary.get("estimated_remaining_minutes"),
            "estimated_completed_at": summary.get("estimated_completed_at"),
            "resume_ready": summary.get("resume_ready"),
            "persisted_trial_count": summary.get("persisted_trial_count"),
            "next_trial_index": summary.get("next_trial_index"),
            "interrupted_reason": summary.get("interrupted_reason"),
            "best_metrics_summary": summary.get("best_metrics_summary"),
            "created_at": job.get("created_at"),
            "updated_at": job.get("updated_at"),
            "completed_at": job.get("completed_at"),
        }

    def list_optimization_jobs(self) -> list[dict[str, Any]]:
        self._purge_legacy_mock_optimization_jobs()
        rows = self.storage.fetch_all(
            """
            SELECT
                optimization_jobs.rowid AS _rowid,
                optimization_jobs.id,
                optimization_jobs.strategy_id,
                optimization_jobs.status,
                optimization_jobs.request_json,
                optimization_jobs.summary_json,
                optimization_jobs.result_json,
                optimization_jobs.created_at,
                optimization_jobs.updated_at,
                optimization_jobs.completed_at,
                strategies.name AS strategy_name
            FROM optimization_jobs
            LEFT JOIN strategies ON strategies.id = optimization_jobs.strategy_id
            WHERE optimization_jobs.deleted_at IS NULL
            ORDER BY optimization_jobs.updated_at DESC, optimization_jobs.created_at DESC, optimization_jobs.rowid DESC
            """
        )
        return [self._project_optimization_job_list_item(self._decode_optimization_job_list_row(row)) for row in rows]

    def _persist_optimization_job(
        self,
        job_id: str,
        strategy_id: str,
        payload: Mapping[str, Any],
        candidates: list[dict[str, Any]],
        *,
        created_at: str,
        updated_at: str | None = None,
        completed_at: str | None = None,
    ) -> None:
        status = str(payload.get("status") or "COMPLETED").upper()
        baseline_parameter_version_id = str(
            payload.get("base_parameter_version_id")
            or ""
        ) or None
        normalized_candidates = sorted(
            [dict(candidate) for candidate in candidates],
            key=lambda item: int(item.get("rank") or 0) or 0,
        )
        for index, candidate in enumerate(normalized_candidates, start=1):
            candidate_rank = _as_int(candidate.get("rank"), index)
            candidate["rank"] = candidate_rank
            candidate["label"] = self._canonical_optimization_candidate_label(candidate.get("label"), candidate_rank)
        persisted_payload = {
            key: value
            for key, value in {
                **dict(payload),
                "base_parameter_version_id": baseline_parameter_version_id,
            }.items()
            if not str(key).startswith("__optimization_")
        }
        if "latest_candidate_label" in persisted_payload:
            persisted_payload["latest_candidate_label"] = self._canonical_optimization_candidate_label(
                persisted_payload.get("latest_candidate_label"),
                _as_int(_as_mapping(persisted_payload.get("best_metrics_summary")).get("trial_index"), 1),
            )
        summary = self._build_optimization_job_summary(persisted_payload, normalized_candidates)
        result = self._build_optimization_job_result(persisted_payload, normalized_candidates)
        persisted_updated_at = updated_at or iso_now()
        persisted_completed_at = completed_at
        if persisted_completed_at is None and status not in {"QUEUED", "RUNNING"}:
            persisted_completed_at = persisted_updated_at
        self.storage.insert_json_row(
            "optimization_jobs",
            {
                "id": job_id,
                "strategy_id": strategy_id,
                "status": status,
                "request_json": dumps(persisted_payload),
                "summary_json": dumps(summary),
                "result_json": dumps(result),
                "candidates_json": dumps(normalized_candidates),
                "created_at": created_at,
                "updated_at": persisted_updated_at,
                "completed_at": persisted_completed_at,
            },
        )

    def _optimization_step_delay_seconds(self) -> float:
        configured_value = os.environ.get("GRIT_OPTIMIZATION_STEP_DELAY_SECONDS")
        if configured_value is not None:
            try:
                return max(0.0, float(configured_value))
            except ValueError:
                pass
        return 0.02 if "PYTEST_CURRENT_TEST" in os.environ else 0.0

    def _optimization_completed_combinations(self, budget_combinations: int, progress_pct: int, minimum: int = 0) -> int:
        if budget_combinations <= 0:
            return 0
        estimated = round(budget_combinations * max(progress_pct, 0) / 100)
        floor = 1 if progress_pct > 0 else 0
        return min(budget_combinations, max(minimum, floor, estimated))

    def _build_optimization_progress_payload(
        self,
        payload: Mapping[str, Any],
        *,
        status: str,
        progress_pct: int,
        completed_combinations: int,
        current_stage: str,
        latest_update: str,
        latest_candidate_label: str | None = None,
    ) -> dict[str, Any]:
        progress_payload = {
            **dict(payload),
            **_normalize_optimization_constraints_payload(payload),
            "status": status,
            "progress_pct": progress_pct,
            "completed_combinations": completed_combinations,
            "current_stage": current_stage,
            "latest_update": latest_update,
        }
        if latest_candidate_label:
            progress_payload["latest_candidate_label"] = latest_candidate_label
        return progress_payload

    def _run_optimization_job(
        self,
        job_id: str,
        strategy_id: str,
        payload: Mapping[str, Any],
        *,
        created_at: str,
    ) -> None:
        published_candidates: list[dict[str, Any]] = []
        try:
            strategy = self.get_strategy_detail(strategy_id)
            normalized_payload = {
                **dict(payload),
                "search_space": self._normalize_optimization_search_space(strategy, payload),
            }
            normalized_payload.update(_normalize_optimization_constraints_payload(normalized_payload))
            candidates = self._build_generated_optimization_candidates(strategy, normalized_payload)
            budget_combinations = _as_int(
                normalized_payload.get("budget_combinations"),
                max(len(candidates) * 10, 24),
            )
            progress_plan = [
                {
                    "status": "RUNNING",
                    "progress_pct": 16,
                    "candidate_count": 0,
                    "current_stage": "Preparing search queue",
                    "latest_update": "Building the first batch of optimization trials.",
                },
                {
                    "status": "RUNNING",
                    "progress_pct": 44,
                    "candidate_count": 1,
                    "current_stage": "Evaluating candidates",
                    "latest_update": f"First candidate {candidates[0]['label']} is now available for review.",
                },
                {
                    "status": "RUNNING",
                    "progress_pct": 68,
                    "candidate_count": 2,
                    "current_stage": "Cross-window validation",
                    "latest_update": f"Leading candidate {candidates[0]['label']} is being checked across validation windows.",
                },
                {
                    "status": "RUNNING",
                    "progress_pct": 88,
                    "candidate_count": 3,
                    "current_stage": "Ranking candidates",
                    "latest_update": "Scoring and ranking the leading candidates.",
                },
                {
                    "status": "COMPLETED",
                    "progress_pct": 100,
                    "candidate_count": len(candidates),
                    "current_stage": "Result ready",
                    "latest_update": f"Optimization finished after {budget_combinations} combinations. Top candidate is {candidates[0]['label']}.",
                },
            ]
            delay_seconds = self._optimization_step_delay_seconds()
            for index, stage in enumerate(progress_plan):
                time.sleep(delay_seconds)
                published_candidates = candidates[: int(stage["candidate_count"])]
                progress_payload = self._build_optimization_progress_payload(
                    normalized_payload,
                    status=str(stage["status"]),
                    progress_pct=int(stage["progress_pct"]),
                    completed_combinations=self._optimization_completed_combinations(
                        budget_combinations,
                        int(stage["progress_pct"]),
                        minimum=len(published_candidates),
                    ),
                    current_stage=str(stage["current_stage"]),
                    latest_update=str(stage["latest_update"]),
                    latest_candidate_label=published_candidates[0]["label"] if published_candidates else None,
                )
                persisted_at = iso_now()
                self._persist_optimization_job(
                    job_id,
                    strategy_id,
                    progress_payload,
                    published_candidates,
                    created_at=created_at,
                    updated_at=persisted_at,
                    completed_at=persisted_at if index == len(progress_plan) - 1 else None,
                )
        except Exception as exc:
            failed_at = iso_now()
            failure_payload = self._build_optimization_progress_payload(
                payload,
                status="FAILED",
                progress_pct=100,
                completed_combinations=len(published_candidates),
                current_stage="Optimization failed",
                latest_update=f"Optimization failed: {str(exc).strip() or exc.__class__.__name__}",
                latest_candidate_label=published_candidates[0]["label"] if published_candidates else None,
            )
            self._persist_optimization_job(
                job_id,
                strategy_id,
                failure_payload,
                published_candidates,
                created_at=created_at,
                updated_at=failed_at,
                completed_at=failed_at,
            )

    def _run_real_optimization_job(
        self,
        job_id: str,
        strategy_id: str,
        payload: Mapping[str, Any],
        *,
        created_at: str,
        existing_candidates: list[dict[str, Any]] | None = None,
        recovered: bool = False,
    ) -> None:
        published_candidates: list[dict[str, Any]] = [dict(candidate) for candidate in (existing_candidates or [])]
        try:
            strategy = self.get_strategy_detail(strategy_id)
            normalized_payload = {
                **dict(payload),
                "search_space": self._normalize_optimization_search_space(strategy, payload),
            }
            self._assert_base_parameter_version_is_fresh(
                strategy,
                self._resolve_expected_base_parameter_version_id(
                    strategy,
                    normalized_payload.get("base_parameter_version_id"),
                ),
                blocking_target_id=strategy_id,
            )
            base_snapshot, source_run = self._optimization_base_snapshot(strategy, normalized_payload)
            if source_run:
                normalized_payload["source_run_id"] = str(source_run.get("id") or normalized_payload.get("source_run_id") or "")
            planned_snapshots = self._plan_optimization_search_snapshots(
                base_snapshot,
                list(normalized_payload.get("search_space") or []),
                normalized_payload.get("budget_combinations"),
            )
            budget_combinations = max(1, len(planned_snapshots))
            normalized_payload["budget_combinations"] = budget_combinations
            resume_completed = 0
            if recovered and str(payload.get("status") or "").upper() == "RUNNING":
                resume_completed = min(
                    _as_int(payload.get("completed_combinations"), 0),
                    max(0, budget_combinations - 1),
                )
                if resume_completed > 0:
                    resumed_at = iso_now()
                    self._persist_optimization_job(
                        job_id,
                        strategy_id,
                        self._build_optimization_progress_payload(
                            normalized_payload,
                            status="RUNNING",
                            progress_pct=round(resume_completed / budget_combinations * 100),
                            completed_combinations=resume_completed,
                            current_stage=f"恢复进度 {resume_completed}/{budget_combinations}",
                            latest_update=(
                                f"已恢复此前保留的优化进度，当前完成 {resume_completed} / "
                                f"{budget_combinations} 组组合。"
                            ),
                            latest_candidate_label=published_candidates[0]["label"] if published_candidates else None,
                        ),
                        published_candidates,
                        created_at=created_at,
                        updated_at=resumed_at,
                        completed_at=None,
                    )
            evaluation_request = self._build_optimization_evaluation_request(
                strategy,
                source_run=source_run,
            )
            self._ensure_optimization_snapshots_ready(
                job_id=job_id,
                created_at=created_at,
                strategy=strategy,
                payload=normalized_payload,
                evaluation_request=evaluation_request,
                parameter_snapshot=base_snapshot,
            )
            successful_trials: list[dict[str, Any]] = []
            failed_trials = 0
            last_error_message: str | None = None
            delay_seconds = self._optimization_step_delay_seconds()

            for index, parameter_snapshot in enumerate(planned_snapshots, start=1):
                current_label = self._optimization_parameter_summary(
                    parameter_snapshot,
                    list(normalized_payload.get("search_space") or []),
                ) or f"组合 {index}"
                if index <= resume_completed:
                    replaying_at = iso_now()
                    self._persist_optimization_job(
                        job_id,
                        strategy_id,
                        self._build_optimization_progress_payload(
                            normalized_payload,
                            status="RUNNING",
                            progress_pct=round(resume_completed / budget_combinations * 100),
                            completed_combinations=resume_completed,
                            current_stage=f"重建候选盘 {index}/{resume_completed}",
                            latest_update=(
                                f"正在根据已完成结果重建候选盘，第 {index} / {resume_completed} 组，"
                                f"恢复后的总进度 {resume_completed} / {budget_combinations}。"
                            ),
                            latest_candidate_label=published_candidates[0]["label"] if published_candidates else None,
                        ),
                        published_candidates,
                        created_at=created_at,
                        updated_at=replaying_at,
                        completed_at=None,
                    )
                if index > resume_completed:
                    started_at = iso_now()
                    self._persist_optimization_job(
                        job_id,
                        strategy_id,
                        self._build_optimization_progress_payload(
                            normalized_payload,
                            status="RUNNING",
                            progress_pct=round((index - 1) / budget_combinations * 100),
                            completed_combinations=index - 1,
                            current_stage=f"执行试验 {index}/{budget_combinations}",
                            latest_update=(
                                f"正在执行第 {index} / {budget_combinations} 组组合，"
                                f"当前参数 {current_label}。"
                            ),
                            latest_candidate_label=published_candidates[0]["label"] if published_candidates else None,
                        ),
                        published_candidates,
                        created_at=created_at,
                        updated_at=started_at,
                        completed_at=None,
                    )
                try:
                    if bool(normalized_payload.get("simulate_partial_failure")) and index == len(planned_snapshots):
                        raise RuntimeError("simulated optimization failure")
                    successful_trials.append(
                        self._evaluate_optimization_trial(
                            strategy,
                            evaluation_request,
                            normalized_payload,
                            parameter_snapshot,
                        )
                    )
                    last_error_message = None
                except Exception as exc:
                    failed_trials += 1
                    last_error_message = str(exc).strip() or exc.__class__.__name__

                if index <= resume_completed:
                    continue

                published_candidates, _ = self._build_optimization_candidates_from_trial_pool(
                    job_id=job_id,
                    strategy=strategy,
                    payload=normalized_payload,
                    trials=successful_trials,
                )
                progress_pct = round(index / budget_combinations * 100)
                status = "RUNNING"
                current_stage = f"执行试验 {index}/{budget_combinations}"
                latest_update = (
                    f"第 {index} / {budget_combinations} 组组合已完成，"
                    f"当前参数 {current_label}。"
                )
                if index == budget_combinations:
                    status = "COMPLETED" if failed_trials == 0 else "PARTIALLY_FAILED" if published_candidates else "FAILED"
                    current_stage = (
                        "优化已完成"
                        if status == "COMPLETED"
                        else "部分组合失败"
                        if status == "PARTIALLY_FAILED"
                        else "优化失败"
                    )
                    if published_candidates:
                        latest_update = (
                            f"全部 {budget_combinations} 组组合已执行完成，"
                            f"最佳候选为 {published_candidates[0]['label']}。"
                        )
                    else:
                        latest_update = f"全部 {budget_combinations} 组组合执行结束，但未形成有效候选。"
                        if last_error_message:
                            latest_update = f"{latest_update} 最后错误：{last_error_message}"

                progress_payload = self._build_optimization_progress_payload(
                    normalized_payload,
                    status=status,
                    progress_pct=progress_pct,
                    completed_combinations=index,
                    current_stage=current_stage,
                    latest_update=latest_update,
                    latest_candidate_label=published_candidates[0]["label"] if published_candidates else None,
                )
                persisted_at = iso_now()
                self._persist_optimization_job(
                    job_id,
                    strategy_id,
                    progress_payload,
                    published_candidates,
                    created_at=created_at,
                    updated_at=persisted_at,
                    completed_at=persisted_at if index == budget_combinations else None,
                )
                if index < budget_combinations:
                    time.sleep(delay_seconds)
        except Exception as exc:
            failed_at = iso_now()
            failure_payload = self._build_optimization_progress_payload(
                payload,
                status="FAILED",
                progress_pct=100,
                completed_combinations=len(published_candidates),
                current_stage="优化失败",
                latest_update=f"优化任务执行失败：{exc}",
                latest_candidate_label=published_candidates[0]["label"] if published_candidates else None,
            )
            self._persist_optimization_job(
                job_id,
                strategy_id,
                failure_payload,
                published_candidates,
                created_at=created_at,
                updated_at=failed_at,
                completed_at=failed_at,
            )

    def _persist_session_state(
        self,
        base_row: Mapping[str, Any],
        payload: Mapping[str, Any],
        *,
        status: str,
        messages: list[dict[str, Any]],
    ) -> dict[str, Any]:
        session_record = {
            "id": base_row["id"],
            "status": status,
            "strategy_type": payload["top_level"]["strategy_type"],
            "universe_name": payload["top_level"].get("universe_name") or "",
            "rebalance_frequency": payload["top_level"].get("rebalance_frequency"),
            "prompt": messages[-1]["content"] if messages else str(base_row.get("prompt") or ""),
            "revision": int(base_row.get("revision") or 1),
            "strategy_id": base_row.get("strategy_id"),
            "suggested_name": self._build_suggested_name(payload["top_level"]),
            "confirmation_fields_json": dumps(payload["confirmation_fields"]),
            "pending_inputs_json": dumps(payload["pending_inputs"]),
            "manual_conflicts_json": dumps(payload["manual_conflicts"]),
            "allowed_actions_json": dumps(self._session_allowed_actions(status)),
            "metadata_json": base_row.get("metadata_json") or dumps({}),
            "created_at": base_row["created_at"],
            "updated_at": iso_now(),
        }
        self.storage.insert_json_row("strategy_creation_sessions", session_record)
        decoded = self._decode_session_row(session_record)
        decoded["messages"] = messages
        decoded["top_level"] = dict(payload["top_level"])
        return decoded

    def _hydrate_session(self, session_id: str) -> dict[str, Any]:
        row = self.storage.fetch_one("SELECT * FROM strategy_creation_sessions WHERE id = ?", (session_id,))
        if not row:
            raise KeyError(f"Creation session not found: {session_id}")
        messages = self._session_messages(session_id)
        decoded = self._decode_session_row(row)
        revision_base_confirmation = None
        if (
            str(decoded.get("mode") or "").upper() == "REVISION"
            and decoded.get("base_strategy_id")
        ):
            try:
                base_strategy = self.get_strategy_detail(str(decoded["base_strategy_id"]))
                revision_base_confirmation = self._seed_revision_confirmation_fields(base_strategy)
                merged_confirmation = deepcopy(revision_base_confirmation)
                for bucket_name in ("top_level", "parameters"):
                    for entry in decoded.get("confirmation_fields", {}).get(bucket_name, []):
                        key = str(entry.get("key") or "").strip()
                        if not key:
                            continue
                        value = entry.get("value")
                        source = str(entry.get("source") or "system_default")
                        if bucket_name == "top_level" and source != "manual_override":
                            continue
                        if bucket_name == "parameters" and source != "manual_override" and value in (None, "", []):
                            continue
                        _upsert_field(
                            merged_confirmation[bucket_name],
                            key,
                            str(entry.get("label") or key),
                            value,
                            source,
                        )
                decoded["confirmation_fields"] = merged_confirmation
                decoded["strategy_type"] = str(base_strategy.get("strategy_type") or decoded.get("strategy_type") or "GENERAL").upper()
                decoded["universe_name"] = base_strategy.get("universe_name") or decoded.get("universe_name") or ""
                decoded["rebalance_frequency"] = base_strategy.get("rebalance_frequency")
            except KeyError:
                pass
        decoded["confirmation_fields"] = _dedupe_top_level_parameters(decoded["confirmation_fields"])
        forced_type = decoded["strategy_type"] if str(decoded.get("strategy_type") or "").upper() != "GENERAL" else None
        payload = build_confirmation(
            messages,
            existing=decoded["confirmation_fields"],
            forced_type=forced_type,
        )
        if revision_base_confirmation:
            payload = self._apply_revision_payload_repairs(payload)
        if decoded["status"] == "LOCKED":
            status = "LOCKED"
        elif not messages:
            status = "DRAFTING"
        else:
            status = "READY_FOR_CONFIRMATION" if not payload["pending_inputs"] else "NEEDS_INPUT"
        hydrated = self._persist_session_state(row, payload, status=status, messages=messages)
        if self._backfill_missing_message_extracted_tags(session_id, hydrated.get("strategy_type")):
            hydrated["messages"] = self._session_messages(session_id)
        hydrated["strategy_id"] = decoded.get("strategy_id")
        hydrated["suggested_name"] = hydrated.get("suggested_name") or decoded.get("suggested_name")
        return hydrated

    def create_creation_session(self, request: Any | None = None) -> dict[str, Any]:
        payload = _as_mapping(request)
        session_id = self._new_id("cs")
        mode = str(payload.get("mode") or "CREATE").upper()
        base_strategy_id = payload.get("base_strategy_id")
        base_parameter_version_id = payload.get("base_parameter_version_id")
        base_strategy = None
        if mode == "REVISION" and base_strategy_id:
            base_strategy = self.get_strategy_detail(str(base_strategy_id))
        strategy_type = str(
            payload.get("strategy_type")
            or (base_strategy or {}).get("strategy_type")
            or "GENERAL"
        ).upper()
        confirmation_fields = (
            self._seed_revision_confirmation_fields(base_strategy)
            if base_strategy and mode == "REVISION"
            else deepcopy((base_strategy or {}).get("confirmation_fields") or blank_confirmation_fields(strategy_type))
        )
        now = iso_now()
        self.storage.insert_json_row(
            "strategy_creation_sessions",
            {
                "id": session_id,
                "status": "DRAFTING",
                "strategy_type": strategy_type,
                "universe_name": (base_strategy or {}).get("universe_name") or "",
                "rebalance_frequency": (base_strategy or {}).get("rebalance_frequency"),
                "prompt": "",
                "revision": 1,
                "strategy_id": None,
                "suggested_name": (base_strategy or {}).get("name"),
                "confirmation_fields_json": dumps(confirmation_fields),
                "pending_inputs_json": dumps([]),
                "manual_conflicts_json": dumps([]),
                "allowed_actions_json": dumps(self._session_allowed_actions("DRAFTING")),
                "metadata_json": dumps(
                    {
                        "mode": mode,
                        "base_strategy_id": str(base_strategy_id) if base_strategy_id else None,
                        "base_parameter_version_id": str(
                            base_parameter_version_id
                            or (base_strategy or {}).get("current_parameter_version_id")
                            or ""
                        )
                        or None,
                    }
                ),
                "created_at": now,
                "updated_at": now,
            },
        )
        return self.get_creation_session(session_id)

    start_creation_session = create_creation_session

    def get_creation_session(self, session_id: str) -> dict[str, Any]:
        return self._hydrate_session(session_id)

    def append_creation_message(self, session_id: str, message: Any) -> dict[str, Any]:
        if not self.storage.fetch_one("SELECT id FROM strategy_creation_sessions WHERE id = ?", (session_id,)):
            raise KeyError(f"Creation session not found: {session_id}")
        body = _as_mapping(message)
        content = str(body.get("content") or "").strip()
        if not content:
            raise ValueError("Creation message content is required")
        before_session = self.get_creation_session(session_id)
        message_id = self._new_id("msg")
        role = str(body.get("role") or "user")
        self.storage.insert_json_row(
            "strategy_creation_messages",
            {
                "id": message_id,
                "session_id": session_id,
                "role": role,
                "content": content,
                "extracted_fields_json": dumps([]),
                "created_at": iso_now(),
            },
        )
        after_session = self.get_creation_session(session_id)
        if role == "user":
            tags = self._build_message_extracted_tags(before_session, after_session)
            self.storage.execute(
                "UPDATE strategy_creation_messages SET extracted_fields_json = ? WHERE id = ?",
                (dumps(tags), message_id),
            )
            return self.get_creation_session(session_id)
        return after_session

    def prepare_confirmation(self, session_id: str, request: Any | None = None) -> dict[str, Any]:
        del request
        return self.get_creation_session(session_id)

    def update_creation_confirmation(self, session_id: str, request: Any) -> dict[str, Any]:
        return self.update_confirmation(session_id, request)

    def update_confirmation(self, session_id: str, request: Any) -> dict[str, Any]:
        row = self.storage.fetch_one("SELECT * FROM strategy_creation_sessions WHERE id = ?", (session_id,))
        if not row:
            raise KeyError(f"Creation session not found: {session_id}")
        session = self._decode_session_row(row)
        payload = _as_mapping(request)
        confirmation_fields = deepcopy(session["confirmation_fields"])
        strategy_type = str(
            payload.get("strategy_type")
            or payload.get("core", {}).get("strategy_type")
            or _field_map(confirmation_fields["top_level"]).get("strategy_type", {}).get("value")
            or session["strategy_type"]
        ).upper()

        if strategy_type != session["strategy_type"]:
            fresh = blank_confirmation_fields(strategy_type)
            merged_top = fresh["top_level"]
            merged_params = fresh["parameters"]
            for entry in confirmation_fields.get("top_level", []):
                if entry.get("source") == "manual_override":
                    _upsert_field(merged_top, entry["key"], entry.get("label", entry["key"]), entry.get("value"), "manual_override")
            for entry in confirmation_fields.get("parameters", []):
                if entry.get("source") == "manual_override":
                    _upsert_field(merged_params, entry["key"], entry.get("label", entry["key"]), entry.get("value"), "manual_override")
            confirmation_fields = {"top_level": merged_top, "parameters": merged_params}

        top_level_overrides = {
            "strategy_type": strategy_type,
            "universe_name": payload.get("core", {}).get("universe_name"),
            "rebalance_frequency": payload.get("core", {}).get("rebalance_frequency"),
        }
        for key, value in top_level_overrides.items():
            if value is None:
                continue
            label = {"strategy_type": "蝑蝐餃?", "universe_name": "???", "rebalance_frequency": "靚?憸?"}[key]
            _upsert_field(confirmation_fields["top_level"], key, label, value, "manual_override")

        for bucket_name in ("core", "logic", "parameters"):
            bucket = payload.get(bucket_name, {})
            for key, value in bucket.items():
                if value is None or key in {"strategy_type", "universe_name", "rebalance_frequency"}:
                    continue
                _upsert_field(confirmation_fields["parameters"], key, key, value, "manual_override")

        confirmation_fields = _dedupe_top_level_parameters(confirmation_fields)

        label_map = {
            str(entry.get("key")): str(entry.get("label") or entry.get("key"))
            for entry in _confirmation_entries(blank_confirmation_fields(strategy_type))
        }
        for bucket_name in ("top_level", "parameters"):
            for entry in confirmation_fields.get(bucket_name, []):
                key = str(entry.get("key") or "")
                if key in label_map:
                    entry["label"] = label_map[key]

        messages = self._session_messages(session_id)
        rebuilt = build_confirmation(messages, existing=confirmation_fields, forced_type=strategy_type)
        status = "READY_FOR_CONFIRMATION" if not rebuilt["pending_inputs"] else "NEEDS_INPUT"
        revision = max(int(row.get("revision") or 1) + 1, int(payload.get("revision") or 1))
        self.storage.insert_json_row(
            "strategy_creation_sessions",
            {
                "id": session_id,
                "status": status,
                "strategy_type": rebuilt["top_level"]["strategy_type"],
                "universe_name": rebuilt["top_level"].get("universe_name") or "",
                "rebalance_frequency": rebuilt["top_level"].get("rebalance_frequency"),
                "prompt": messages[-1]["content"] if messages else str(row.get("prompt") or ""),
                "revision": revision,
                "strategy_id": row.get("strategy_id"),
                "suggested_name": self._build_suggested_name(rebuilt["top_level"]),
                "confirmation_fields_json": dumps(rebuilt["confirmation_fields"]),
                "pending_inputs_json": dumps(rebuilt["pending_inputs"]),
                "manual_conflicts_json": dumps(rebuilt["manual_conflicts"]),
                "allowed_actions_json": dumps(self._session_allowed_actions(status)),
                "metadata_json": row.get("metadata_json") or dumps({}),
                "created_at": row["created_at"],
                "updated_at": iso_now(),
            },
        )
        return self.get_creation_session(session_id)

    def materialize_strategy(self, session_id: str, request: Any) -> dict[str, Any]:
        payload = _as_mapping(request)
        if not payload.get("idempotency_key"):
            raise ValueError("idempotency_key is required")
        session = self.get_creation_session(session_id)
        if session.get("strategy_id"):
            return self.get_strategy_detail(str(session["strategy_id"]))

        now = iso_now()
        top_level = session["top_level"]
        parameters = self._flatten_confirmation(session["confirmation_fields"], top_level)
        strategy_name = str(
            parameters.get("strategy_name")
            or session.get("suggested_name")
            or self._build_suggested_name(top_level)
        ).strip() or self._build_suggested_name(top_level)
        raw_description = parameters.get("strategy_description")
        strategy_description = str(raw_description).strip() if raw_description is not None else ""
        benchmark_symbol = str(parameters.get("benchmark_symbol") or "SPY").strip().upper() or "SPY"
        session_mode = str(session.get("mode") or "CREATE").upper()
        if session_mode == "REVISION":
            base_strategy_id = session.get("base_strategy_id")
            if not base_strategy_id:
                raise ValueError("Revision session is missing base_strategy_id")
            base_strategy = self.get_strategy_detail(str(base_strategy_id))
            expected_base = str(
                payload.get("base_parameter_version_id")
                or session.get("base_parameter_version_id")
                or ""
            ) or None
            current_base = str(base_strategy.get("current_parameter_version_id") or "")
            if expected_base and expected_base != current_base:
                raise ContractConflictError(
                    "stale_base_parameter_version",
                    "The strategy has moved to a newer parameter version.",
                    blocking_target={"type": "strategy", "id": str(base_strategy_id)},
                    next_action="refresh_strategy_detail",
                    extra={
                        "expected_base_parameter_version_id": expected_base,
                        "current_parameter_version_id": current_base,
                    },
                )

            strategy_row = self.storage.fetch_one("SELECT * FROM strategies WHERE id = ?", (base_strategy_id,))
            assert strategy_row is not None
            current_version = int(strategy_row.get("current_parameter_version") or 1)
            next_version = current_version + 1
            parameter_history = _normalize_parameter_history(
                str(base_strategy_id),
                loads(strategy_row.get("parameter_history_json"), []),
                loads(strategy_row.get("parameters_json"), {}),
                current_version,
            )
            parameter_history.append(
                {
                    "version_number": next_version,
                    "parameter_version_id": _parameter_version_id(str(base_strategy_id), next_version),
                    "revision": session["revision"],
                    "created_at": now,
                    "comment": payload.get("comment"),
                    "parameters": parameters,
                }
            )
            strategy_row["parameters_json"] = dumps(parameters)
            strategy_row["confirmation_fields_json"] = dumps(session["confirmation_fields"])
            strategy_row["name"] = strategy_name
            strategy_row["description"] = strategy_description or strategy_row.get("description")
            strategy_row["benchmark_symbol"] = benchmark_symbol
            strategy_row["universe_name"] = top_level.get("universe_name") or strategy_row.get("universe_name") or ""
            strategy_row["rebalance_frequency"] = top_level.get("rebalance_frequency")
            self._write_strategy_record(
                strategy_row,
                parameter_history=parameter_history,
                current_version=next_version,
                comment=payload.get("comment"),
            )
            strategy_id = str(base_strategy_id)
        else:
            strategy_id = self._new_id("strat")
            version_history = [
                {
                    "version_number": 1,
                    "parameter_version_id": _parameter_version_id(strategy_id, 1),
                    "revision": session["revision"],
                    "created_at": now,
                    "comment": payload.get("comment"),
                    "parameters": parameters,
                }
            ]
            strategy_row = {
                "id": strategy_id,
                "name": strategy_name,
                "description": strategy_description or None,
                "strategy_type": top_level["strategy_type"],
                "universe_name": top_level.get("universe_name") or "",
                "rebalance_frequency": top_level.get("rebalance_frequency"),
                "lifecycle_status": "ACTIVE",
                "dataset_snapshot_id": None,
                "universe_snapshot_id": None,
                "benchmark_symbol": benchmark_symbol,
                "parameters_json": dumps(parameters),
                "confirmation_fields_json": dumps(session["confirmation_fields"]),
                "allowed_actions_json": dumps(["run_backtest", "refresh_snapshots", "edit_parameters"]),
                "latest_run_id": None,
                "latest_successful_run_id": None,
                "created_at": now,
                "updated_at": now,
            }
            self._write_strategy_record(strategy_row, parameter_history=version_history, current_version=1, comment=payload.get("comment"))

        row = self.storage.fetch_one("SELECT * FROM strategy_creation_sessions WHERE id = ?", (session_id,))
        assert row is not None
        self.storage.insert_json_row(
            "strategy_creation_sessions",
            {
                "id": session_id,
                "status": "LOCKED",
                "strategy_type": row["strategy_type"],
                "universe_name": row["universe_name"],
                "rebalance_frequency": row.get("rebalance_frequency"),
                "prompt": row.get("prompt") or "",
                "revision": row.get("revision") or 1,
                "strategy_id": strategy_id,
                "suggested_name": strategy_row["name"],
                "confirmation_fields_json": row["confirmation_fields_json"],
                "pending_inputs_json": row["pending_inputs_json"],
                "manual_conflicts_json": row["manual_conflicts_json"],
                "allowed_actions_json": dumps(self._session_allowed_actions("LOCKED")),
                "metadata_json": row.get("metadata_json") or dumps({}),
                "created_at": row["created_at"],
                "updated_at": now,
            },
        )
        return self.get_strategy_detail(strategy_id)

    def list_strategies(self) -> list[dict[str, Any]]:
        rows = self.storage.fetch_all(
            """
            SELECT
                id,
                name,
                description,
                strategy_type,
                universe_name,
                rebalance_frequency,
                lifecycle_status,
                (
                    SELECT backtest_runs.id
                    FROM backtest_runs
                    WHERE backtest_runs.strategy_id = strategies.id
                      AND backtest_runs.deleted_at IS NULL
                    ORDER BY COALESCE(backtest_runs.completed_at, backtest_runs.created_at) DESC,
                             backtest_runs.created_at DESC,
                             backtest_runs.id DESC
                    LIMIT 1
                ) AS latest_run_id,
                (
                    SELECT backtest_runs.id
                    FROM backtest_runs
                    WHERE backtest_runs.strategy_id = strategies.id
                      AND backtest_runs.deleted_at IS NULL
                      AND UPPER(COALESCE(backtest_runs.status, '')) IN ('COMPLETED', 'COMPLETED_WITH_WARNINGS')
                    ORDER BY COALESCE(backtest_runs.completed_at, backtest_runs.created_at) DESC,
                             backtest_runs.created_at DESC,
                             backtest_runs.id DESC
                    LIMIT 1
                ) AS latest_successful_run_id,
                (
                    SELECT optimization_jobs.id
                    FROM optimization_jobs
                    WHERE optimization_jobs.strategy_id = strategies.id
                      AND optimization_jobs.deleted_at IS NULL
                    ORDER BY optimization_jobs.created_at DESC
                    LIMIT 1
                ) AS latest_optimization_job_id,
                current_parameter_version,
                dataset_snapshot_id,
                universe_snapshot_id,
                benchmark_symbol,
                created_at,
                updated_at,
                parameters_json
            FROM strategies
            ORDER BY updated_at DESC, created_at DESC
            """
        )
        strategies = [self._decode_strategy_list_row(row) for row in rows]
        latest_successful_run_ids = [
            str(strategy.get("latest_successful_run_id") or "")
            for strategy in strategies
            if strategy.get("latest_successful_run_id")
        ]
        latest_completed_run_summaries = self._load_latest_completed_run_summaries(latest_successful_run_ids)
        for strategy in strategies:
            latest_successful_run_id = str(strategy.get("latest_successful_run_id") or "")
            strategy["latest_completed_run_summary"] = (
                latest_completed_run_summaries.get(latest_successful_run_id)
                if latest_successful_run_id
                else None
            )
        return strategies

    def get_strategy_detail(self, strategy_id: str) -> dict[str, Any]:
        row = self.storage.fetch_one("SELECT * FROM strategies WHERE id = ?", (strategy_id,))
        if not row:
            raise KeyError(f"Strategy not found: {strategy_id}")
        return self._decode_strategy_row(self._with_live_strategy_run_refs(row))

    get_strategy = get_strategy_detail

    def update_strategy(self, strategy_id: str, request: Any) -> dict[str, Any]:
        row = self.storage.fetch_one("SELECT * FROM strategies WHERE id = ?", (strategy_id,))
        if not row:
            raise KeyError(f"Strategy not found: {strategy_id}")
        payload = _as_mapping(request)
        updated = dict(row)
        for key in ("name", "description", "dataset_snapshot_id", "universe_snapshot_id"):
            if payload.get(key) is not None:
                updated[key] = payload[key]
        if payload.get("lifecycle_status") is not None:
            updated["lifecycle_status"] = payload["lifecycle_status"]
        updated["updated_at"] = iso_now()
        self.storage.insert_json_row("strategies", updated)
        return self.get_strategy_detail(strategy_id)

    def list_backtest_runs(self, limit: int | None = None, status: str | None = None) -> list[dict[str, Any]]:
        sql = """
            SELECT
                backtest_runs.id,
                backtest_runs.strategy_id,
                strategies.name AS strategy_name,
                backtest_runs.status,
                backtest_runs.start_date,
                backtest_runs.end_date,
                backtest_runs.effective_date,
                backtest_runs.oos_start_date,
                backtest_runs.warnings_json,
                backtest_runs.request_json,
                backtest_runs.preview_json,
                backtest_runs.metrics_json,
                backtest_runs.parameter_snapshot_json,
                backtest_runs.source_run_id,
                backtest_runs.is_permanent,
                backtest_runs.trades_count,
                backtest_runs.created_at,
                backtest_runs.updated_at,
                backtest_runs.completed_at
            FROM backtest_runs
            LEFT JOIN strategies ON strategies.id = backtest_runs.strategy_id
            WHERE backtest_runs.deleted_at IS NULL
        """
        params: list[Any] = []
        if status:
            sql += " AND backtest_runs.status = ?"
            params.append(status)
        sql += " ORDER BY COALESCE(backtest_runs.completed_at, backtest_runs.created_at) DESC"
        if limit:
            sql += " LIMIT ?"
            params.append(limit)
        rows = self.storage.fetch_all(sql, params)
        return [self._decode_run_list_row(row) for row in rows]

    def get_backtest_run(
        self,
        run_id: str,
        *,
        view: str = "full",
        include_trade_audit: bool = True,
    ) -> dict[str, Any]:
        normalized_view = self._normalize_backtest_run_detail_view(view)
        row = self.storage.fetch_one(
            f"SELECT {self._backtest_run_select_columns(view=normalized_view, include_trade_audit=include_trade_audit)} "
            "FROM backtest_runs WHERE id = ? AND deleted_at IS NULL",
            (run_id,),
        )
        if not row:
            raise KeyError(f"Backtest run not found: {run_id}")
        return self._decode_run_row(row, view=normalized_view, include_trade_audit=include_trade_audit)

    def get_backtest_run_detail(self, run_id: str, view: str = "full") -> dict[str, Any]:
        run = self.get_backtest_run(run_id, view=view, include_trade_audit=False)
        run["legacy_demo_run"] = False
        return run

    def get_backtest_run_trades(self, run_id: str, page: int = 1, page_size: int = 50, segment: str = "all") -> dict[str, Any]:
        run = self.get_backtest_run(run_id, view="trades", include_trade_audit=False)
        trades = list(run.get("trades", []))
        normalized_segment = str(segment or "all").upper()
        if normalized_segment in {"IS", "OOS"}:
            trades = [item for item in trades if str(item.get("segment") or "").upper() == normalized_segment]
        total = len(trades)
        start = max(page - 1, 0) * page_size
        end = start + page_size
        return {"items": trades[start:end], "page": page, "page_size": page_size, "total": total}

    def clone_backtest_run(self, run_id: str, request: Any) -> dict[str, Any]:
        run = self.get_backtest_run_detail(run_id)
        payload = _as_mapping(request)
        cloned_payload = dict(run.get("request") or {})
        cloned_payload.update(payload)
        cloned_payload.setdefault("source_run_id", run_id)
        cloned_payload.setdefault("is_permanent", False)
        return self.submit_backtest_run(str(run["strategy_id"]), cloned_payload)

    def delete_backtest_run(self, run_id: str) -> dict[str, Any]:
        run = self.get_backtest_run(run_id, view="full", include_trade_audit=False)
        status = str(run.get("status") or "").upper()
        if status in {"QUEUED", "RUNNING"}:
            raise ContractConflictError(
                "BACKTEST_RUN_DELETE_ACTIVE",
                "Running or queued backtest runs cannot be deleted",
                blocking_target={"run_id": run_id},
            )

        deleted_at = iso_now()
        self.storage.execute(
            """
            UPDATE backtest_runs
            SET status = ?, deleted_at = ?, deleted_reason = ?, updated_at = ?
            WHERE id = ? AND deleted_at IS NULL
            """,
            ("DELETED", deleted_at, "manual_delete", deleted_at, run_id),
        )
        strategy_id = str(run.get("strategy_id") or "").strip()
        if strategy_id:
            self._sync_strategy_run_refs(strategy_id)
        return {
            "id": run_id,
            "deleted_at": deleted_at,
            "deleted_reason": "manual_delete",
        }

    def get_workspace_overview(self) -> dict[str, Any]:
        strategies = self.list_strategies()
        recent_runs = self.list_backtest_runs(limit=5)
        latest_job = self.storage.fetch_one(
            "SELECT * FROM optimization_jobs WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1"
        )
        return {
            "workspace_name": "Grit 策略工作台",
            "subtitle": "集中查看策略研究、回测运行与参数优化任务，帮助你快速定位最新实验进展。",
            "strategy_count": len(strategies),
            "active_run_count": len([item for item in recent_runs if item.get("status") == "RUNNING"]),
            "running_optimization_count": 1
            if latest_job and str(latest_job.get("status") or "").upper() in {"QUEUED", "RUNNING"}
            else 0,
            "latest_strategy_id": strategies[0]["id"] if strategies else None,
            "latest_backtest_run_id": recent_runs[0]["id"] if recent_runs else None,
            "latest_optimization_job_id": latest_job["id"] if latest_job else None,
            "top_momentum_warning": "近期高动量组合波动有所放大，建议结合参数热区与多窗口验证结果复核回撤承受区间。",
            "quick_actions": ["open_creation", "start_backtest", "open_optimization"],
        }

    def get_snapshot_overview(self) -> dict[str, Any]:
        jobs = self.storage.fetch_all("SELECT * FROM snapshot_refresh_jobs ORDER BY created_at DESC LIMIT 1")
        latest_job = self._decode_snapshot_refresh_job(jobs[0]) if jobs else None
        return {
            "overall_status": "INCOMPLETE" if latest_job is None else str(latest_job.get("status") or "INCOMPLETE").upper(),
            "last_refreshed_at": latest_job.get("completed_at") if latest_job else None,
            "dataset_snapshots": [],
            "universe_snapshots": [],
            "latest_job": latest_job,
            "blocking_code": "SNAPSHOT_REFRESH_REQUIRED",
            "blocking_target": "data_snapshots",
            "message": "当前尚未完成快照刷新，请先刷新数据快照后再进入策略回测或优化流程。",
            "allowed_actions": ["refresh_snapshots"],
        }

    def refresh_snapshots(self, request: Any | None = None) -> dict[str, Any]:
        payload = _as_mapping(request)
        now = iso_now()
        job = {
            "id": self._new_id("snap"),
            "status": "INCOMPLETE",
            "request": payload,
            "summary": {
                "status": "INCOMPLETE",
                "symbol_count": 0,
                "row_count": 0,
                "blocking": True,
                "blocking_code": "SNAPSHOT_REFRESH_REQUIRED",
                "blocking_target": "data_snapshots",
            },
            "warnings": ["No market data repository is attached"],
            "errors": [],
            "created_at": now,
            "updated_at": now,
            "started_at": now,
            "completed_at": now,
        }
        self.storage.insert_json_row(
            "snapshot_refresh_jobs",
            {
                "id": job["id"],
                "status": job["status"],
                "request_json": dumps(job["request"]),
                "summary_json": dumps(job["summary"]),
                "warnings_json": dumps(job["warnings"]),
                "errors_json": dumps(job["errors"]),
                "created_at": now,
                "updated_at": now,
                "started_at": now,
                "completed_at": now,
            },
        )
        overview = self.get_snapshot_overview()
        overview["latest_job"] = job
        overview["last_refreshed_at"] = now
        return overview

    def _decode_snapshot_refresh_job(self, row: Mapping[str, Any] | None) -> dict[str, Any] | None:
        if not row:
            return None
        summary = loads(row.get("summary_json"), {})
        return {
            **dict(row),
            "request": loads(row.get("request_json"), {}),
            "summary": summary,
            "warnings": loads(row.get("warnings_json"), []),
            "errors": loads(row.get("errors_json"), []),
            "current_stage": summary.get("current_stage"),
            "current_stage_label": summary.get("current_stage_label"),
            "heartbeat_at": summary.get("heartbeat_at"),
            "progress": summary.get("progress"),
        }

    def _start_optimization_job_runner(
        self,
        job_id: str,
        strategy_id: str,
        payload: Mapping[str, Any],
        *,
        created_at: str,
        existing_candidates: list[dict[str, Any]] | None = None,
        recovered: bool = False,
        claim_acquired: bool = False,
    ) -> bool:
        runner_mode = self._optimization_runner_mode()
        with self._optimization_runner_lock:
            if job_id in self._optimization_runner_job_ids:
                return False
            self._optimization_runner_job_ids.add(job_id)
        if not claim_acquired and not self._try_acquire_optimization_runner_claim(job_id):
            with self._optimization_runner_lock:
                self._optimization_runner_job_ids.discard(job_id)
            return False

        try:
            if runner_mode == "thread":
                def run() -> None:
                    try:
                        self._run_real_optimization_job(
                            job_id,
                            strategy_id,
                            deepcopy(dict(payload)),
                            created_at=created_at,
                            existing_candidates=deepcopy(existing_candidates or []),
                            recovered=recovered,
                        )
                    finally:
                        with self._optimization_runner_lock:
                            self._optimization_runner_job_ids.discard(job_id)
                        self._release_optimization_runner_claim(job_id)

                threading.Thread(
                    target=run,
                    name=f"optimization-job-{job_id}",
                    daemon=True,
                ).start()
                return True

            command, env, cwd = self._build_optimization_runner_subprocess_command(job_id)
            popen_kwargs: dict[str, Any] = {
                "cwd": str(cwd),
                "env": env,
                "stdout": subprocess.DEVNULL,
                "stderr": subprocess.DEVNULL,
            }
            if os.name == "nt":
                popen_kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            process = subprocess.Popen(command, **popen_kwargs)
            self._adopt_optimization_runner_claim(job_id, int(process.pid))
        except Exception:
            with self._optimization_runner_lock:
                self._optimization_runner_job_ids.discard(job_id)
            self._release_optimization_runner_claim(job_id)
            raise
        with self._optimization_runner_lock:
            self._optimization_runner_job_ids.discard(job_id)
        return True

    def create_optimization_job(self, strategy_id: str, request: Any | None = None) -> dict[str, Any]:
        strategy = self.get_strategy_detail(strategy_id)
        payload = _as_mapping(request)
        now = iso_now()
        job_id = self._new_id("opt")
        baseline_parameter_version_id = str(
            payload.get("base_parameter_version_id")
            or strategy.get("current_parameter_version_id")
            or ""
        ) or None
        source_run_id = str(payload.get("source_run_id") or strategy.get("latest_successful_run_id") or "").strip() or None
        normalized_payload = {
            **payload,
            "objective": _normalize_optimization_objective(payload.get("objective")),
            "base_parameter_version_id": baseline_parameter_version_id,
            "source_run_id": source_run_id,
            "entry_point": payload.get("entry_point") or "lab_menu",
            "validation_mode": payload.get("validation_mode") or "walk_forward",
            "status": "QUEUED",
            "progress_pct": 0,
            "completed_combinations": 0,
            "current_stage": "任务已创建",
            "latest_update": "优化任务已创建，正在准备参数组合与评估快照。",
        }
        normalized_payload["search_space"] = self._normalize_optimization_search_space(strategy, normalized_payload)
        normalized_payload.update(_normalize_optimization_constraints_payload(normalized_payload))
        self._persist_optimization_job(
            job_id,
            strategy_id,
            normalized_payload,
            [],
            created_at=now,
            updated_at=now,
            completed_at=None,
        )
        self._start_optimization_job_runner(
            job_id,
            strategy_id,
            normalized_payload,
            created_at=now,
        )
        return self.get_optimization_job_detail(job_id)

    def get_optimization_job_detail(self, job_id: str) -> dict[str, Any]:
        start_time = time.perf_counter()
        row = self.storage.fetch_one(
            "SELECT * FROM optimization_jobs WHERE id = ? AND deleted_at IS NULL",
            (job_id,),
        )
        if not row:
            duration_ms = (time.perf_counter() - start_time) * 1000.0
            with self._optimization_job_detail_metrics_lock:
                self._optimization_job_detail_metrics["request_count"] += 1
                self._optimization_job_detail_metrics["total_duration_ms"] += duration_ms
            raise KeyError(f"Optimization job not found: {job_id}")
        job = self._hydrate_optimization_job(row)
        duration_ms = (time.perf_counter() - start_time) * 1000.0
        with self._optimization_job_detail_metrics_lock:
            self._optimization_job_detail_metrics["request_count"] += 1
            self._optimization_job_detail_metrics["total_duration_ms"] += duration_ms
        return job

    def get_optimization_job_detail_metrics(self) -> dict[str, Any]:
        with self._optimization_job_detail_metrics_lock:
            request_count = int(self._optimization_job_detail_metrics.get("request_count", 0))
            total_duration_ms = float(
                self._optimization_job_detail_metrics.get("total_duration_ms", 0.0)
            )
            snapshot_query_count = int(
                self._optimization_job_detail_metrics.get("snapshot_query_count", 0)
            )
            snapshot_cache_hit_count = int(
                self._optimization_job_detail_metrics.get("snapshot_cache_hit_count", 0)
            )
            snapshot_cache_miss_count = int(
                self._optimization_job_detail_metrics.get("snapshot_cache_miss_count", 0)
            )
        return {
            "request_count": request_count,
            "avg_duration_ms": total_duration_ms / request_count if request_count else 0.0,
            "snapshot_query_count": snapshot_query_count,
            "snapshot_cache_hit_count": snapshot_cache_hit_count,
            "snapshot_cache_miss_count": snapshot_cache_miss_count,
            "snapshot_cache_hit_rate": (
                snapshot_cache_hit_count / (snapshot_cache_hit_count + snapshot_cache_miss_count)
            ) if (snapshot_cache_hit_count + snapshot_cache_miss_count) else 0.0,
        }

    def _build_optimization_job_persist_payload(
        self,
        job: Mapping[str, Any],
    ) -> dict[str, Any]:
        request = dict(job.get("request") or {})
        summary = dict(job.get("summary") or {})
        result = dict(job.get("result") or {})
        status = str(
            job.get("status")
            or summary.get("status")
            or request.get("status")
            or result.get("status")
            or "COMPLETED"
        ).upper()
        latest_candidate_label = (
            summary.get("latest_candidate_label")
            or result.get("best_candidate_label")
            or result.get("headline")
        )
        latest_update = (
            summary.get("latest_update")
            or result.get("latest_update")
            or result.get("summary")
            or request.get("latest_update")
        )
        return {
            **request,
            "objective": _normalize_optimization_objective(
                summary.get("objective") or request.get("objective")
            ),
            "status": status,
            "base_parameter_version_id": job.get("base_parameter_version_id")
            or request.get("base_parameter_version_id"),
            "budget_combinations": summary.get("budget_combinations")
            or request.get("budget_combinations"),
            "completed_combinations": summary.get("completed_combinations")
            or request.get("completed_combinations"),
            "progress_pct": summary.get("progress_pct")
            if summary.get("progress_pct") is not None
            else result.get("progress_pct"),
            "current_stage": summary.get("current_stage")
            or result.get("current_stage"),
            "latest_update": latest_update,
            "estimated_remaining_minutes": summary.get("estimated_remaining_minutes")
            if summary.get("estimated_remaining_minutes") is not None
            else result.get("estimated_remaining_minutes"),
            "estimated_completed_at": summary.get("estimated_completed_at")
            or result.get("estimated_completed_at"),
            "resume_ready": summary.get("resume_ready"),
            "persisted_trial_count": summary.get("persisted_trial_count"),
            "next_trial_index": summary.get("next_trial_index"),
            "interrupted_reason": summary.get("interrupted_reason")
            or request.get("interrupted_reason"),
            "best_metrics_summary": summary.get("best_metrics_summary"),
            "latest_candidate_label": latest_candidate_label,
            "matching_combination_count": summary.get("matching_combination_count"),
            "matching_combinations": summary.get("matching_combinations"),
            "matching_combination_source": summary.get("matching_combination_source"),
        }

    def update_optimization_job_constraints(
        self,
        job_id: str,
        request: Any,
    ) -> dict[str, Any]:
        job = self.get_optimization_job_detail(job_id)
        status = str(job.get("status") or "").upper()
        if status in {"QUEUED", "RUNNING", "INTERRUPTED"}:
            raise ValueError("Only completed optimization jobs can be re-filtered.")
        payload = _as_mapping(request)
        persisted_payload = self._build_optimization_job_persist_payload(job)
        next_objective = _normalize_optimization_objective(
            payload.get("objective")
            or job["summary"].get("objective")
            or job["request"].get("objective")
        )
        next_preset_key = payload.get("constraint_preset_key") or job["summary"].get(
            "constraint_preset_key"
        ) or job["request"].get("constraint_preset_key")
        next_constraints = payload.get("constraints")
        if next_constraints is None:
            next_constraints = job["summary"].get("constraints") or job["request"].get("constraints")
        next_constraint_payload = _normalize_optimization_constraints_payload(
            {
                "constraint_preset_key": next_preset_key,
                "constraint_label": payload.get("constraint_label"),
                "constraints": next_constraints,
            }
        )
        reranked_candidates = self._rerank_optimization_candidate_records(
            job.get("candidates", []),
            next_objective,
        )
        strategy = self.get_strategy_detail(str(job["strategy_id"]))
        matching_trials = self._load_optimization_trials(
            job_id,
            include_chart_series=False,
            include_metrics_json=True,
        )
        if matching_trials:
            matching_combinations = self._build_optimization_matching_combination_candidates(
                strategy=strategy,
                payload={
                    **persisted_payload,
                    **next_constraint_payload,
                    "objective": next_objective,
                },
                trials=matching_trials,
            )
            matching_combination_source = "all_trials"
        else:
            matching_combinations = [
                dict(candidate)
                for candidate in reranked_candidates
                if self._optimization_trial_passes_constraints(
                    candidate,
                    next_constraint_payload.get("constraints") or [],
                )
            ]
            matching_combination_source = "persisted_candidates"
        persisted_payload.update(next_constraint_payload)
        persisted_payload["objective"] = next_objective
        persisted_payload["best_metrics_summary"] = None
        persisted_payload["latest_candidate_label"] = None
        persisted_payload["matching_combination_count"] = len(
            matching_combinations,
        )
        persisted_payload["matching_combinations"] = matching_combinations
        persisted_payload["matching_combination_source"] = (
            matching_combination_source
        )
        self._persist_optimization_job(
            job_id,
            str(job["strategy_id"]),
            persisted_payload,
            reranked_candidates,
            created_at=str(job["created_at"]),
            updated_at=iso_now(),
            completed_at=(
                str(job.get("completed_at") or "").strip()
                or str(job.get("updated_at") or "").strip()
                or None
            ),
        )
        return self.get_optimization_job_detail(job_id)

    def delete_optimization_job(self, job_id: str) -> dict[str, Any]:
        row = self.storage.fetch_one(
            "SELECT id FROM optimization_jobs WHERE id = ? AND deleted_at IS NULL",
            (job_id,),
        )
        if not row:
            raise KeyError(f"Optimization job not found: {job_id}")
        deleted_at = iso_now()
        deleted_reason = "user_deleted"
        self.storage.execute(
            """
            UPDATE optimization_jobs
            SET status = ?, deleted_at = ?, deleted_reason = ?, updated_at = ?
            WHERE id = ? AND deleted_at IS NULL
            """,
            ("DELETED", deleted_at, deleted_reason, deleted_at, job_id),
        )
        return {
            "id": job_id,
            "deleted_at": deleted_at,
            "deleted_reason": deleted_reason,
        }

    def create_optimization_candidate(self, job_id: str, request: Any) -> dict[str, Any]:
        payload = _as_mapping(request)
        parameter_snapshot = dict(payload.get("parameter_snapshot") or {})
        if not parameter_snapshot:
            raise ValueError("parameter_snapshot is required")
        job = self.get_optimization_job_detail(job_id)
        strategy = self.get_strategy_detail(str(job["strategy_id"]))
        expected_base_parameter_version_id = self._resolve_expected_base_parameter_version_id(
            strategy,
            payload.get("base_parameter_version_id"),
            job.get("base_parameter_version_id"),
        )
        self._assert_base_parameter_version_is_fresh(
            strategy,
            expected_base_parameter_version_id,
            blocking_target_id=str(job["strategy_id"]),
        )
        source_run_id = str(
            job["request"].get("source_run_id")
            or strategy.get("latest_successful_run_id")
            or ""
        ).strip()
        source_run: dict[str, Any] | None = None
        if source_run_id:
            try:
                source_run = self.get_backtest_run_detail(source_run_id)
            except KeyError:
                source_run = None
        if source_run is not None:
            evaluation_request = self._build_optimization_evaluation_request(
                strategy,
                source_run=source_run,
            )
            evaluated_trial = self._evaluate_optimization_trial(
                strategy,
                evaluation_request,
                {
                    **dict(job["request"]),
                    "base_parameter_version_id": expected_base_parameter_version_id,
                },
                parameter_snapshot,
            )
        else:
            evaluated_trial = _evaluate_optimization_trial_payload(
                parameter_snapshot,
                job["request"].get("objective"),
            )
        candidate_metrics = dict(evaluated_trial.get("metrics") or {})
        candidate_metrics.update(dict(payload.get("metrics") or {}))
        candidate_score = payload.get("score")
        if not isinstance(candidate_score, (int, float)) or isinstance(candidate_score, bool):
            candidate_score = self._score_optimization_metrics(
                candidate_metrics,
                job["request"].get("objective"),
            )
        candidates = [dict(candidate) for candidate in job.get("candidates", [])]
        new_candidate = self._normalize_optimization_candidate(
            strategy,
            {
                "id": self._new_id("trial"),
                "label": payload.get("label"),
                "summary": payload.get("summary"),
                "status": "SUCCEEDED",
                "rank": len(candidates) + 1,
                "score": candidate_score,
                "parameter_snapshot": parameter_snapshot,
                "metrics": candidate_metrics,
                "base_parameter_version_id": expected_base_parameter_version_id,
            },
            rank=len(candidates) + 1,
            base_parameter_version_id=expected_base_parameter_version_id,
        )
        candidates.append(new_candidate)
        self._persist_optimization_job(
            job_id,
            str(job["strategy_id"]),
            {
                **job["request"],
                "base_parameter_version_id": expected_base_parameter_version_id,
            },
            candidates,
            created_at=str(job["created_at"]),
        )
        return self.get_optimization_job_detail(job_id)

    def promote_trial(self, job_id: str, trial_id: str, request: Any) -> dict[str, Any]:
        job = self.get_optimization_job_detail(job_id)
        candidate = self._resolve_optimization_candidate_for_action(job, trial_id)
        if not candidate:
            raise KeyError(f"Optimization candidate not found: {trial_id}")
        payload = _as_mapping(request)
        strategy = self.get_strategy_detail(str(job["strategy_id"]))
        expected_base = self._resolve_expected_base_parameter_version_id(
            strategy,
            payload.get("base_parameter_version_id"),
            candidate.get("base_parameter_version_id"),
            job.get("base_parameter_version_id"),
        )
        self._assert_base_parameter_version_is_fresh(
            strategy,
            expected_base,
            blocking_target_id=str(job["strategy_id"]),
        )

        promoted_parameters = dict(candidate.get("parameter_snapshot") or strategy.get("parameters") or {})
        promoted_rebalance_frequency = (
            promoted_parameters.get("rebalance_frequency") or strategy.get("rebalance_frequency")
        )
        if payload.get("mode") == "create_copy":
            now = iso_now()
            cloned_id = self._new_id("strat")
            version_history = [
                {
                    "version_number": 1,
                    "parameter_version_id": _parameter_version_id(cloned_id, 1),
                    "revision": 1,
                    "created_at": now,
                    "comment": payload.get("comment"),
                    "parameters": promoted_parameters,
                }
            ]
            self._write_strategy_record(
                {
                    "id": cloned_id,
                    "name": f'{strategy["name"]} Copy',
                    "description": strategy.get("description"),
                    "strategy_type": strategy["strategy_type"],
                    "universe_name": strategy["universe_name"],
                    "rebalance_frequency": promoted_rebalance_frequency,
                    "lifecycle_status": strategy.get("lifecycle_status", "ACTIVE"),
                    "dataset_snapshot_id": strategy.get("dataset_snapshot_id"),
                    "universe_snapshot_id": strategy.get("universe_snapshot_id"),
                    "benchmark_symbol": strategy.get("benchmark_symbol", "SPY"),
                    "parameters_json": dumps(promoted_parameters),
                    "confirmation_fields_json": dumps(strategy["confirmation_fields"]),
                    "allowed_actions_json": dumps(strategy["allowed_actions"]),
                    "latest_run_id": strategy.get("latest_run_id"),
                    "latest_successful_run_id": strategy.get("latest_successful_run_id"),
                    "created_at": now,
                    "updated_at": now,
                },
                parameter_history=version_history,
                current_version=1,
                comment=payload.get("comment"),
            )
            return self.get_strategy_detail(cloned_id)

        strategy_row = self.storage.fetch_one("SELECT * FROM strategies WHERE id = ?", (job["strategy_id"],))
        assert strategy_row is not None
        current_version = int(strategy_row.get("current_parameter_version") or 1)
        next_version = current_version + 1
        parameter_history = _normalize_parameter_history(
            str(job["strategy_id"]),
            loads(strategy_row.get("parameter_history_json"), []),
            loads(strategy_row.get("parameters_json"), {}),
            current_version,
        )
        parameter_history.append(
            {
                "version_number": next_version,
                "parameter_version_id": _parameter_version_id(str(job["strategy_id"]), next_version),
                "revision": current_version,
                "created_at": iso_now(),
                "comment": payload.get("comment"),
                "parameters": promoted_parameters,
            }
        )
        strategy_row["parameters_json"] = dumps(promoted_parameters)
        strategy_row["rebalance_frequency"] = promoted_rebalance_frequency
        strategy_row["name"] = _display_strategy_name(strategy_row.get("name"), promoted_parameters)
        self._write_strategy_record(
            strategy_row,
            parameter_history=parameter_history,
            current_version=next_version,
            comment=payload.get("comment"),
        )
        return self.get_strategy_detail(str(job["strategy_id"]))

    def _resolve_optimization_candidate_for_action(
        self,
        job: Mapping[str, Any],
        trial_id: str,
    ) -> dict[str, Any] | None:
        normalized_trial_id = str(trial_id or "").strip()
        if not normalized_trial_id:
            return None

        for collection_name in ("candidates", "matching_combinations"):
            candidate = next(
                (
                    item
                    for item in list(job.get(collection_name) or [])
                    if isinstance(item, Mapping) and str(item.get("id") or "").strip() == normalized_trial_id
                ),
                None,
            )
            if candidate is not None:
                return dict(candidate)

        strategy = self.get_strategy_detail(str(job["strategy_id"]))
        request_payload = _as_mapping(job.get("request"))
        summary_payload = _as_mapping(job.get("summary"))
        normalized_search_space = self._normalize_optimization_search_space(
            strategy,
            {
                "search_space": request_payload.get("search_space")
                or summary_payload.get("search_space"),
            },
        )
        base_parameter_version_id = str(
            job.get("base_parameter_version_id")
            or request_payload.get("base_parameter_version_id")
            or ""
        ).strip() or None
        trial_rows = self._load_optimization_trials(
            str(job["id"]),
            include_chart_series=False,
            include_metrics_json=True,
        )
        for trial in trial_rows:
            trial_index = _as_int(trial.get("trial_index"), 0)
            resolved_trial_id = str(
                trial.get("id")
                or (f"trial_{trial_index}" if trial_index > 0 else "")
            ).strip()
            if resolved_trial_id != normalized_trial_id:
                continue
            if str(trial.get("status") or "").upper() != "SUCCEEDED":
                return None

            parameter_snapshot = dict(trial.get("parameter_snapshot") or {})
            metrics = dict(trial.get("metrics") or {})
            label = f"Trial {trial_index}" if trial_index > 0 else None
            candidate = self._build_candidate_record(
                strategy=strategy,
                parameter_snapshot=parameter_snapshot,
                base_parameter_version_id=base_parameter_version_id,
                label=label,
                title=label,
                status="SUCCEEDED",
                status_label=self._optimization_status_label(metrics),
                metrics=metrics,
                summary=self._optimization_candidate_summary(
                    parameter_snapshot,
                    metrics,
                    normalized_search_space,
                ),
                rank=trial_index if trial_index > 0 else 1,
                score=_as_float(trial.get("score"), 0.0),
                analysis={},
            )
            candidate["id"] = resolved_trial_id
            candidate["allowed_actions"] = []
            candidate["analysis"] = {}
            return candidate
        return None

    def delete_optimization_candidate(self, job_id: str, trial_id: str) -> dict[str, Any]:
        job = self.get_optimization_job_detail(job_id)
        candidates = [candidate for candidate in job.get("candidates", []) if candidate.get("id") != trial_id]
        if len(candidates) == len(job.get("candidates", [])):
            raise KeyError(f"Optimization candidate not found: {trial_id}")
        for index, candidate in enumerate(candidates, start=1):
            candidate["rank"] = index
        self._persist_optimization_job(
            job_id,
            str(job["strategy_id"]),
            {
                **job["request"],
                "base_parameter_version_id": job.get("base_parameter_version_id"),
            },
            candidates,
            created_at=str(job["created_at"]),
        )
        return self.get_optimization_job_detail(job_id)

    def get_workspace_overview(self, include_cleanup_audit: bool = False) -> dict[str, Any]:
        strategy_count_row = self.storage.fetch_one("SELECT COUNT(*) AS count FROM strategies")
        active_run_count_row = self.storage.fetch_one(
            "SELECT COUNT(*) AS count FROM backtest_runs WHERE deleted_at IS NULL AND status = ?",
            ("RUNNING",),
        )
        latest_strategy = self.storage.fetch_one(
            "SELECT id FROM strategies ORDER BY updated_at DESC, created_at DESC LIMIT 1"
        )
        latest_run = self.storage.fetch_one(
            """
            SELECT id
            FROM backtest_runs
            WHERE deleted_at IS NULL
            ORDER BY COALESCE(completed_at, created_at) DESC
            LIMIT 1
            """
        )
        latest_job = self.storage.fetch_one(
            "SELECT * FROM optimization_jobs WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1"
        )
        overview = {
            "workspace_name": "Grit Strategy Lab",
            "subtitle": "Creation, backtest, and optimization workspace for local strategy recovery.",
            "strategy_count": int((strategy_count_row or {}).get("count") or 0),
            "active_run_count": int((active_run_count_row or {}).get("count") or 0),
            "running_optimization_count": 1
            if latest_job and str(latest_job.get("status") or "").upper() in {"QUEUED", "RUNNING"}
            else 0,
            "latest_strategy_id": latest_strategy["id"] if latest_strategy else None,
            "latest_backtest_run_id": latest_run["id"] if latest_run else None,
            "latest_optimization_job_id": latest_job["id"] if latest_job else None,
            "top_momentum_warning": "Refresh snapshots before trusting any newly materialized momentum strategy.",
            "quick_actions": ["open_creation", "start_backtest", "open_optimization"],
        }
        if include_cleanup_audit:
            runtime_state = self._read_runtime_state("cleanup_audit")
            overview["last_cleanup_count"] = int(runtime_state.get("state_json", {}).get("last_cleanup_count") or 0)
        return overview

    def _load_optimization_trials(
        self,
        job_id: str,
        *,
        include_chart_series: bool = True,
        trial_indices: Sequence[int] | None = None,
        include_metrics_json: bool = True,
    ) -> list[dict[str, Any]]:
        chart_series_column = "chart_series_json" if include_chart_series else "NULL AS chart_series_json"
        metrics_column = "metrics_json" if include_metrics_json else "NULL AS metrics_json"
        normalized_trial_indices = [
            int(index)
            for index in list(trial_indices or [])
            if isinstance(index, int) or (isinstance(index, str) and str(index).strip().isdigit())
        ]
        trial_filter = ""
        params: list[Any] = [job_id]
        if normalized_trial_indices:
            placeholders = ", ".join("?" for _ in normalized_trial_indices)
            trial_filter = f" AND trial_index IN ({placeholders})"
            params.extend(normalized_trial_indices)
        rows = self.storage.fetch_all(
            f"""
            SELECT
                job_id,
                trial_index,
                status,
                parameter_snapshot_json,
                {metrics_column},
                {chart_series_column},
                score,
                return_sharpe,
                oos_sharpe,
                total_return_pct,
                stability,
                error_message,
                started_at,
                completed_at
            FROM optimization_job_trials
            WHERE job_id = ?
            {trial_filter}
            ORDER BY trial_index ASC
            """,
            tuple(params),
        )
        trials: list[dict[str, Any]] = []
        for row in rows:
            metrics_payload = loads(row.get("metrics_json"), {}) if include_metrics_json else {}
            metrics = dict(metrics_payload or {})
            return_sharpe = _as_float(
                row.get("return_sharpe"),
                _as_float(metrics.get("return_sharpe"), _as_float(metrics.get("sharpe"), 0.0)),
            )
            oos_sharpe = _as_float(
                row.get("oos_sharpe"),
                _as_float(metrics.get("out_of_sample_sharpe"), _as_float(metrics.get("oos_sharpe"), 0.0)),
            )
            total_return_pct = _as_float(
                row.get("total_return_pct"),
                _as_float(metrics.get("total_return_pct"), _as_float(metrics.get("total_return"), 0.0) * 100.0),
            )
            stability = _as_float(row.get("stability"), _as_float(metrics.get("stability"), 0.0))
            metrics["return_sharpe"] = return_sharpe
            metrics.setdefault("sharpe", return_sharpe)
            metrics["out_of_sample_sharpe"] = oos_sharpe
            metrics["oos_sharpe"] = oos_sharpe
            metrics["total_return_pct"] = total_return_pct
            metrics["stability"] = stability
            trials.append(
                {
                    "job_id": str(row.get("job_id") or job_id),
                    "trial_index": _as_int(row.get("trial_index"), 0),
                    "status": str(row.get("status") or "PENDING").upper(),
                    "parameter_snapshot": loads(row.get("parameter_snapshot_json"), {}),
                    "metrics": metrics,
                    "chart_series": loads(row.get("chart_series_json"), []) if include_chart_series else [],
                    "score": _as_float(row.get("score"), 0.0),
                    "error_message": row.get("error_message"),
                    "started_at": row.get("started_at"),
                    "completed_at": row.get("completed_at"),
                }
            )
        return trials

    def _optimization_top_trial_indices(
        self,
        trials: Sequence[Mapping[str, Any]],
        *,
        limit: int | None = None,
        objective: Any = None,
    ) -> list[int]:
        candidate_limit = limit if isinstance(limit, int) and limit > 0 else self._optimization_candidate_limit()
        successful_trials = [dict(trial) for trial in trials if str(trial.get("status") or "").upper() == "SUCCEEDED"]
        ranked_trials = self._rank_optimization_trials(successful_trials, objective)
        selected_indices: list[int] = []
        for trial in ranked_trials[:candidate_limit]:
            trial_index = _as_int(trial.get("trial_index"), 0)
            if trial_index > 0:
                selected_indices.append(trial_index)
        return selected_indices

    def _load_optimization_trial_chart_series_map(
        self,
        job_id: str,
        trial_indices: Sequence[int],
    ) -> dict[int, list[dict[str, Any]]]:
        normalized_indices = [
            int(index)
            for index in list(trial_indices or [])
            if isinstance(index, int) or (isinstance(index, str) and str(index).strip().isdigit())
        ]
        if not normalized_indices:
            return {}
        trials = self._load_optimization_trials(
            job_id,
            include_chart_series=True,
            trial_indices=normalized_indices,
            include_metrics_json=False,
        )
        return {
            _as_int(trial.get("trial_index"), 0): list(trial.get("chart_series") or [])
            for trial in trials
            if _as_int(trial.get("trial_index"), 0) > 0 and list(trial.get("chart_series") or [])
        }

    def _merge_optimization_trial_chart_series(
        self,
        trials: Sequence[Mapping[str, Any]],
        chart_series_by_index: Mapping[int, Sequence[Mapping[str, Any]] | Sequence[dict[str, Any]]],
    ) -> list[dict[str, Any]]:
        merged_trials: list[dict[str, Any]] = []
        for trial in trials:
            merged_trial = dict(trial)
            trial_index = _as_int(merged_trial.get("trial_index"), 0)
            merged_trial["chart_series"] = list(chart_series_by_index.get(trial_index) or merged_trial.get("chart_series") or [])
            merged_trials.append(merged_trial)
        return merged_trials

    def _persist_optimization_trial(
        self,
        job_id: str,
        trial_index: int,
        *,
        status: str,
        parameter_snapshot: Mapping[str, Any],
        metrics: Mapping[str, Any],
        chart_series: list[Mapping[str, Any]] | list[dict[str, Any]],
        score: float | int | None,
        error_message: str | None,
        started_at: str | None,
        completed_at: str | None,
    ) -> None:
        metrics_payload = dict(metrics or {})
        return_sharpe = _as_float(
            metrics_payload.get("return_sharpe"),
            _as_float(metrics_payload.get("sharpe"), 0.0),
        )
        oos_sharpe = _as_float(
            metrics_payload.get("out_of_sample_sharpe"),
            _as_float(metrics_payload.get("oos_sharpe"), 0.0),
        )
        total_return_pct = _as_float(
            metrics_payload.get("total_return_pct"),
            _as_float(metrics_payload.get("total_return"), 0.0) * 100.0,
        )
        stability = _as_float(metrics_payload.get("stability"), 0.0)
        self.storage.insert_json_row(
            "optimization_job_trials",
            {
                "job_id": job_id,
                "trial_index": int(trial_index),
                "status": str(status or "PENDING").upper(),
                "parameter_snapshot_json": dumps(dict(parameter_snapshot or {})),
                "metrics_json": dumps(metrics_payload),
                "chart_series_json": dumps(list(chart_series or [])),
                "score": None if score is None else float(score),
                "return_sharpe": return_sharpe,
                "oos_sharpe": oos_sharpe,
                "total_return_pct": total_return_pct,
                "stability": stability,
                "error_message": error_message,
                "started_at": started_at,
                "completed_at": completed_at,
            },
        )

    def _optimization_parallel_min_trials(self) -> int:
        return 8

    def _optimization_parallel_worker_cap(self) -> int:
        cpu_count = os.cpu_count() or 1
        return min(max(1, cpu_count - 1), 8)

    def _optimization_memory_status(self) -> dict[str, float]:
        return read_runtime_memory_status()

    def _optimization_initial_parallel_worker_target(
        self,
        base_cap: int,
        *,
        memory_status: Mapping[str, Any] | None = None,
    ) -> int:
        if base_cap <= 1:
            return 1
        status = dict(memory_status or self._optimization_memory_status())
        system_ratio = _as_float(status.get("system_memory_ratio"), 0.0)
        process_ratio = _as_float(status.get("process_memory_ratio"), 0.0)
        if system_ratio >= 0.80 or process_ratio >= 0.60:
            return 1
        if system_ratio >= 0.70 or process_ratio >= 0.45:
            return min(base_cap, 2)
        if system_ratio >= 0.60 or process_ratio >= 0.30:
            return min(base_cap, 4)
        return base_cap

    def _optimization_adjust_parallel_worker_target(
        self,
        current_target: int,
        *,
        base_cap: int,
        memory_status: Mapping[str, Any],
        safe_sample_streak: int,
    ) -> tuple[int, int]:
        system_ratio = _as_float(memory_status.get("system_memory_ratio"), 0.0)
        process_ratio = _as_float(memory_status.get("process_memory_ratio"), 0.0)
        if system_ratio >= 0.90 or process_ratio >= 0.60:
            return 1, 0
        if system_ratio >= 0.80:
            return max(1, current_target - 1), 0
        if system_ratio <= 0.65 and process_ratio <= 0.45:
            next_safe_streak = safe_sample_streak + 1
            if next_safe_streak >= 3 and current_target < base_cap:
                return min(base_cap, current_target + 1), 0
            return current_target, next_safe_streak
        return current_target, 0

    def _optimization_can_use_parallel_controller(
        self,
        pending_evaluations: Sequence[tuple[int, Mapping[str, Any]]],
    ) -> bool:
        del pending_evaluations
        # The real evaluator currently depends on in-process service state and snapshot context.
        # Keep multiprocessing disabled until child workers can produce the same real metrics.
        return False

    def _optimization_trial_record(
        self,
        *,
        job_id: str,
        trial_index: int,
        status: str,
        parameter_snapshot: Mapping[str, Any],
        metrics: Mapping[str, Any],
        score: float | int | None,
        error_message: str | None,
        started_at: str | None,
        completed_at: str | None,
    ) -> dict[str, Any]:
        return {
            "job_id": job_id,
            "trial_index": int(trial_index),
            "status": str(status or "PENDING").upper(),
            "parameter_snapshot": dict(parameter_snapshot or {}),
            "metrics": dict(metrics or {}),
            "chart_series": [],
            "score": None if score is None else float(score),
            "error_message": error_message,
            "started_at": started_at,
            "completed_at": completed_at,
        }

    def _run_sequential_optimization_trials(
        self,
        *,
        job_id: str,
        strategy: Mapping[str, Any],
        evaluation_request: Mapping[str, Any],
        request_payload: Mapping[str, Any],
        pending_evaluations: Sequence[tuple[int, Mapping[str, Any]]],
        trial_records: dict[int, dict[str, Any]],
        budget_combinations: int,
        publish_progress: Any,
        delay_seconds: float = 0.0,
        prepared_context: Mapping[str, Any] | None = None,
        runtime_state: dict[str, Any] | None = None,
    ) -> tuple[dict[int, dict[str, Any]], int]:
        failures = 0
        normalized_pending = [
            (int(trial_index), dict(parameter_snapshot))
            for trial_index, parameter_snapshot in pending_evaluations
        ]
        for offset, (trial_index, parameter_snapshot) in enumerate(normalized_pending):
            trial_started_at = self._optimization_timestamp_now()
            try:
                trial_result = self._evaluate_optimization_trial(
                    strategy,
                    evaluation_request,
                    request_payload,
                    parameter_snapshot,
                    prepared_context=prepared_context,
                )
                trial_status = "SUCCEEDED"
                error_message = None
            except Exception as exc:
                failures += 1
                trial_status = "FAILED"
                trial_result = {
                    "parameter_snapshot": dict(parameter_snapshot),
                    "metrics": {},
                    "chart_series": [],
                    "score": 0.0,
                }
                error_message = str(exc).strip() or exc.__class__.__name__

            trial_parameter_snapshot = dict(trial_result.get("parameter_snapshot") or parameter_snapshot)
            trial_metrics = dict(trial_result.get("metrics") or {})
            trial_score = trial_result.get("score")
            trial_completed_at = self._optimization_timestamp_now()
            self._persist_optimization_trial(
                job_id,
                trial_index,
                status=trial_status,
                parameter_snapshot=trial_parameter_snapshot,
                metrics=trial_metrics,
                chart_series=[],
                score=trial_score,
                error_message=error_message,
                started_at=trial_started_at,
                completed_at=trial_completed_at,
            )
            trial_records[trial_index] = self._optimization_trial_record(
                job_id=job_id,
                trial_index=trial_index,
                status=trial_status,
                parameter_snapshot=trial_parameter_snapshot,
                metrics=trial_metrics,
                score=trial_score,
                error_message=error_message,
                started_at=trial_started_at,
                completed_at=trial_completed_at,
            )
            completed_count = len(trial_records)
            if runtime_state is not None:
                self._optimization_runtime_observe_trial(runtime_state, trial_records[trial_index])
                best_summary = self._optimization_runtime_best_summary(runtime_state)
            else:
                best_summary = self._best_optimization_trial_summary(
                    list(trial_records.values()),
                    request_payload.get("objective"),
                )
            remaining = normalized_pending[offset + 1 :]
            next_trial_index = remaining[0][0] if remaining else completed_count + 1
            publish_progress(
                completed_count=completed_count,
                best_summary=best_summary,
                next_trial_index=next_trial_index,
                current_stage=(
                    f"Running trial {next_trial_index}/{budget_combinations}"
                    if remaining
                    else f"Running trial {budget_combinations}/{budget_combinations}"
                ),
                latest_update=f"Completed {completed_count}/{budget_combinations} trials.",
            )
            if delay_seconds:
                time.sleep(delay_seconds)
        return trial_records, failures

    def _run_parallel_optimization_trials(
        self,
        *,
        job_id: str,
        request_payload: Mapping[str, Any],
        pending_evaluations: Sequence[tuple[int, Mapping[str, Any]]],
        trial_records: dict[int, dict[str, Any]],
        budget_combinations: int,
        publish_progress: Any,
        runtime_state: dict[str, Any] | None = None,
    ) -> tuple[dict[int, dict[str, Any]], int, list[tuple[int, dict[str, Any]]], str | None]:
        normalized_pending: deque[tuple[int, dict[str, Any]]] = deque(
            (int(trial_index), dict(parameter_snapshot))
            for trial_index, parameter_snapshot in pending_evaluations
        )
        if not normalized_pending:
            return trial_records, 0, [], None

        base_cap = min(self._optimization_parallel_worker_cap(), len(normalized_pending))
        memory_status = self._optimization_memory_status()
        target_worker_count = min(
            base_cap,
            self._optimization_initial_parallel_worker_target(
                base_cap,
                memory_status=memory_status,
            ),
        )
        if target_worker_count <= 1:
            return trial_records, 0, list(normalized_pending), "Parallel workers were skipped because memory pressure was already too high."

        spawn_context = mp.get_context("spawn")
        result_queue = spawn_context.Queue()
        workers: dict[int, dict[str, Any]] = {}
        next_worker_id = 0
        failures = 0
        safe_sample_streak = 0
        fallback_reason: str | None = None
        last_sample_at = time.monotonic()

        def current_remaining() -> list[tuple[int, dict[str, Any]]]:
            remaining = list(normalized_pending)
            for worker in workers.values():
                current_task = worker.get("current_task")
                if current_task:
                    remaining.append(
                        (
                            int(current_task["trial_index"]),
                            dict(current_task["parameter_snapshot"] or {}),
                        )
                    )
            return sorted(remaining, key=lambda item: item[0])

        def close_worker(
            worker_id: int,
            *,
            terminate: bool = False,
        ) -> None:
            worker = workers.pop(worker_id, None)
            if worker is None:
                return
            process = worker.get("process")
            command_queue = worker.get("command_queue")
            try:
                if terminate and process is not None and process.is_alive():
                    process.terminate()
                if process is not None:
                    process.join(timeout=0.5)
            except Exception:
                pass
            if terminate:
                try:
                    if process is not None and process.is_alive():
                        process.kill()
                        process.join(timeout=0.5)
                except Exception:
                    pass
            close_queue = getattr(command_queue, "close", None)
            if callable(close_queue):
                try:
                    close_queue()
                except Exception:
                    pass

        def request_worker_shutdown(worker: Mapping[str, Any]) -> None:
            if worker.get("shutdown_sent"):
                return
            command_queue = worker.get("command_queue")
            if worker.get("current_task") is not None:
                worker["retire_after_task"] = True
                return
            try:
                command_queue.put({"type": "shutdown"})
                worker["shutdown_sent"] = True
            except Exception:
                worker["shutdown_sent"] = True

        def start_worker() -> None:
            nonlocal next_worker_id
            worker_id = next_worker_id + 1
            command_queue = spawn_context.Queue()
            process = spawn_context.Process(
                target=_optimization_trial_worker_main,
                args=(worker_id, command_queue, result_queue),
                name=f"opt-worker-{job_id}-{worker_id}",
                daemon=True,
            )
            process.start()
            workers[worker_id] = {
                "id": worker_id,
                "process": process,
                "command_queue": command_queue,
                "current_task": None,
                "shutdown_sent": False,
                "retire_after_task": False,
            }
            next_worker_id = worker_id

        def reconcile_dead_workers() -> None:
            nonlocal fallback_reason
            for worker_id, worker in list(workers.items()):
                process = worker.get("process")
                exitcode = None if process is None else process.exitcode
                if exitcode is None:
                    continue
                current_task = worker.get("current_task")
                if current_task is not None and fallback_reason is None:
                    fallback_reason = (
                        f"Parallel worker {worker_id} exited unexpectedly. "
                        "Continuing with single-worker mode."
                    )
                close_worker(worker_id)

        def sync_worker_target() -> None:
            nonlocal fallback_reason
            reconcile_dead_workers()
            if fallback_reason:
                return
            active_tasks = sum(1 for worker in workers.values() if worker.get("current_task") is not None)
            desired_workers = min(
                target_worker_count,
                max(active_tasks, len(normalized_pending) + active_tasks),
            )
            while len(workers) < desired_workers:
                try:
                    start_worker()
                except Exception as exc:
                    fallback_reason = (
                        "Parallel workers failed to start. "
                        f"Continuing with single-worker mode: {str(exc).strip() or exc.__class__.__name__}"
                    )
                    return
            excess = max(0, len(workers) - target_worker_count)
            if excess <= 0:
                return
            idle_workers = [worker for worker in workers.values() if worker.get("current_task") is None and not worker.get("shutdown_sent")]
            for worker in idle_workers[:excess]:
                request_worker_shutdown(worker)
            remaining_excess = max(
                0,
                len([worker for worker in workers.values() if not worker.get("shutdown_sent")]) - target_worker_count,
            )
            if remaining_excess <= 0:
                return
            busy_workers = [worker for worker in workers.values() if worker.get("current_task") is not None and not worker.get("shutdown_sent")]
            for worker in busy_workers[:remaining_excess]:
                worker["retire_after_task"] = True

        try:
            sync_worker_target()
            while (normalized_pending or any(worker.get("current_task") is not None for worker in workers.values())) and not fallback_reason:
                for worker in list(workers.values()):
                    if worker.get("shutdown_sent") or worker.get("retire_after_task") or worker.get("current_task") is not None:
                        continue
                    if not normalized_pending:
                        break
                    trial_index, parameter_snapshot = normalized_pending.popleft()
                    worker["current_task"] = {
                        "trial_index": trial_index,
                        "parameter_snapshot": dict(parameter_snapshot),
                        "started_at": self._optimization_timestamp_now(),
                    }
                    try:
                        worker["command_queue"].put(
                            {
                                "type": "trial",
                                "trial_index": trial_index,
                                "parameter_snapshot": dict(parameter_snapshot),
                                "objective": request_payload.get("objective"),
                            }
                        )
                    except Exception as exc:
                        normalized_pending.appendleft((trial_index, dict(parameter_snapshot)))
                        worker["current_task"] = None
                        fallback_reason = (
                            "Parallel worker communication failed. "
                            f"Continuing with single-worker mode: {str(exc).strip() or exc.__class__.__name__}"
                        )
                        break

                reconcile_dead_workers()
                if fallback_reason:
                    break

                result: dict[str, Any] | None = None
                try:
                    result = result_queue.get(timeout=0.2)
                except queue.Empty:
                    result = None

                if result is not None:
                    result_type = str(result.get("type") or "").strip().lower()
                    worker_id = _as_int(result.get("worker_id"), 0)
                    if result_type == "worker_stopped":
                        close_worker(worker_id)
                    elif result_type == "trial_result":
                        worker = workers.get(worker_id)
                        current_task = dict((worker or {}).get("current_task") or {})
                        if worker is not None:
                            worker["current_task"] = None
                        trial_index = _as_int(result.get("trial_index"), _as_int(current_task.get("trial_index"), 0))
                        parameter_snapshot = dict(result.get("parameter_snapshot") or current_task.get("parameter_snapshot") or {})
                        trial_started_at = str(current_task.get("started_at") or self._optimization_timestamp_now())
                        trial_completed_at = self._optimization_timestamp_now()
                        error_message = str(result.get("error_message") or "").strip() or None
                        trial_status = "FAILED" if error_message else "SUCCEEDED"
                        if trial_status == "FAILED":
                            failures += 1
                        trial_metrics = dict(result.get("metrics") or {})
                        trial_score = result.get("score")
                        self._persist_optimization_trial(
                            job_id,
                            trial_index,
                            status=trial_status,
                            parameter_snapshot=parameter_snapshot,
                            metrics=trial_metrics,
                            chart_series=[],
                            score=trial_score,
                            error_message=error_message,
                            started_at=trial_started_at,
                            completed_at=trial_completed_at,
                        )
                        trial_records[trial_index] = self._optimization_trial_record(
                            job_id=job_id,
                            trial_index=trial_index,
                            status=trial_status,
                            parameter_snapshot=parameter_snapshot,
                            metrics=trial_metrics,
                            score=trial_score,
                            error_message=error_message,
                            started_at=trial_started_at,
                            completed_at=trial_completed_at,
                        )
                        completed_count = len(trial_records)
                        if runtime_state is not None:
                            self._optimization_runtime_observe_trial(runtime_state, trial_records[trial_index])
                            best_summary = self._optimization_runtime_best_summary(runtime_state)
                        else:
                            best_summary = self._best_optimization_trial_summary(
                                list(trial_records.values()),
                                request_payload.get("objective"),
                            )
                        next_indices = [trial[0] for trial in normalized_pending]
                        next_indices.extend(
                            _as_int(worker_state.get("current_task", {}).get("trial_index"), 0)
                            for worker_state in workers.values()
                            if worker_state.get("current_task")
                        )
                        next_indices = [index for index in next_indices if index > 0]
                        next_trial_index = min(next_indices) if next_indices else completed_count + 1
                        publish_progress(
                            completed_count=completed_count,
                            best_summary=best_summary,
                            next_trial_index=next_trial_index,
                            current_stage=(
                                f"Running trial {next_trial_index}/{budget_combinations}"
                                if next_indices
                                else f"Running trial {budget_combinations}/{budget_combinations}"
                            ),
                            latest_update=f"Completed {completed_count}/{budget_combinations} trials.",
                        )
                        if worker is not None and worker.get("retire_after_task"):
                            request_worker_shutdown(worker)

                now = time.monotonic()
                if result is not None or now - last_sample_at >= 1.0:
                    memory_status = self._optimization_memory_status()
                    target_worker_count, safe_sample_streak = self._optimization_adjust_parallel_worker_target(
                        target_worker_count,
                        base_cap=base_cap,
                        memory_status=memory_status,
                        safe_sample_streak=safe_sample_streak,
                    )
                    last_sample_at = now
                    sync_worker_target()

            remaining_trials = current_remaining() if fallback_reason else []
            return trial_records, failures, remaining_trials, fallback_reason
        finally:
            for worker_id, worker in list(workers.items()):
                if not worker.get("shutdown_sent") and worker.get("current_task") is None:
                    request_worker_shutdown(worker)
            deadline = time.monotonic() + 1.0
            while workers and time.monotonic() < deadline:
                try:
                    result = result_queue.get(timeout=0.1)
                except queue.Empty:
                    result = None
                if result is not None and str(result.get("type") or "").strip().lower() == "worker_stopped":
                    close_worker(_as_int(result.get("worker_id"), 0))
                    continue
                reconcile_dead_workers()
            for worker_id in list(workers):
                close_worker(worker_id, terminate=True)
            close_result_queue = getattr(result_queue, "close", None)
            if callable(close_result_queue):
                try:
                    close_result_queue()
                except Exception:
                    pass

    def _optimization_trial_summary(self, trial: Mapping[str, Any]) -> dict[str, Any]:
        trial_index = _as_int(trial.get("trial_index"), 0)
        return {
            "trial_index": trial_index,
            "label": f"Trial {trial_index}" if trial_index else "Trial",
            "status": str(trial.get("status") or "PENDING").upper(),
            "parameter_snapshot": dict(trial.get("parameter_snapshot") or {}),
            "metrics": dict(trial.get("metrics") or {}),
            "score": _as_float(trial.get("score"), 0.0),
            "error_message": trial.get("error_message"),
            "started_at": trial.get("started_at"),
            "completed_at": trial.get("completed_at"),
        }

    def _build_optimization_matching_combination_candidates(
        self,
        *,
        strategy: Mapping[str, Any],
        payload: Mapping[str, Any],
        trials: Sequence[Mapping[str, Any]],
    ) -> list[dict[str, Any]]:
        search_space = list(payload.get("search_space") or [])
        base_parameter_version_id = (
            str(payload.get("base_parameter_version_id") or "").strip() or None
        )
        constraints = self._optimization_candidate_constraints(payload)
        successful_trials = [
            dict(trial)
            for trial in list(trials or [])
            if str(trial.get("status") or "").upper() == "SUCCEEDED"
        ]
        ranked_trials = self._rank_optimization_trials(
            successful_trials,
            payload.get("objective"),
        )
        matching_candidates: list[dict[str, Any]] = []
        for rank, trial in enumerate(ranked_trials, start=1):
            if not self._optimization_trial_passes_constraints(trial, constraints):
                continue
            metrics = dict(trial.get("metrics") or {})
            parameter_snapshot = dict(trial.get("parameter_snapshot") or {})
            trial_index = _as_int(trial.get("trial_index"), rank)
            label = f"Trial {trial_index}" if trial_index > 0 else f"Trial {rank}"
            candidate = self._build_candidate_record(
                strategy=strategy,
                parameter_snapshot=parameter_snapshot,
                base_parameter_version_id=base_parameter_version_id,
                label=label,
                title=label,
                status=str(trial.get("status") or "SUCCEEDED").upper(),
                status_label=self._optimization_status_label(metrics),
                metrics=metrics,
                summary=self._optimization_candidate_summary(
                    parameter_snapshot,
                    metrics,
                    search_space,
                ),
                rank=len(matching_candidates) + 1,
                score=_as_float(trial.get("score"), 0.0),
                analysis={},
            )
            candidate["id"] = str(trial.get("id") or f"trial_{trial_index or rank}")
            candidate["allowed_actions"] = []
            candidate["analysis"] = {}
            matching_candidates.append(candidate)
        return matching_candidates

    def _normalized_optimization_trial_summary(self, trial: Mapping[str, Any]) -> dict[str, Any]:
        summary = self._optimization_trial_summary(trial)
        label = str(trial.get("label") or "").strip()
        if label:
            summary["label"] = label
        return summary

    def _optimization_timestamp_now(self) -> str:
        return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    def _best_optimization_trial_summary(
        self,
        trials: list[Mapping[str, Any]],
        objective: Any = None,
    ) -> dict[str, Any] | None:
        successful_trials = [dict(trial) for trial in trials if str(trial.get("status") or "").upper() == "SUCCEEDED"]
        if not successful_trials:
            return None
        ranked = self._rank_optimization_trials(successful_trials, objective)
        if not ranked:
            return None
        return self._optimization_trial_summary(ranked[0])

    def _optimization_eta_projection(
        self,
        trials: list[Mapping[str, Any]],
        *,
        budget_combinations: int,
        completed_combinations: int,
    ) -> dict[str, Any]:
        completed_records: list[tuple[datetime, datetime, float]] = []
        for trial in trials:
            started_at = trial.get("started_at")
            completed_at = trial.get("completed_at")
            if not started_at or not completed_at:
                continue
            try:
                started = datetime.fromisoformat(str(started_at).replace("Z", "+00:00"))
                completed = datetime.fromisoformat(str(completed_at).replace("Z", "+00:00"))
            except ValueError:
                continue
            duration = (completed - started).total_seconds()
            if duration >= 0:
                completed_records.append((started, completed, duration))

        remaining_trials = max(0, budget_combinations - completed_combinations)
        if remaining_trials <= 0:
            estimated_completed_at = datetime.now(timezone.utc)
            return {
                "estimated_remaining_minutes": 0,
                "estimated_completed_at": estimated_completed_at.isoformat().replace("+00:00", "Z"),
            }

        if not completed_records:
            return {"estimated_remaining_minutes": None, "estimated_completed_at": None}

        completed_records.sort(key=lambda item: item[1])
        recent_records = completed_records[-OPTIMIZATION_ETA_RECENT_COMPLETIONS_WINDOW:]
        per_trial_projection: float | None = None

        if len(recent_records) >= 2:
            first_started = min(started for started, _, _ in recent_records)
            last_completed = max(completed for _, completed, _ in recent_records)
            wall_clock_span = max(0.0, (last_completed - first_started).total_seconds())
            if wall_clock_span > 0:
                per_trial_projection = wall_clock_span / len(recent_records)

        if per_trial_projection is None:
            completed_durations = [duration for _, _, duration in recent_records if duration > 0]
            if not completed_durations:
                return {"estimated_remaining_minutes": None, "estimated_completed_at": None}
            per_trial_projection = (sum(completed_durations) / len(completed_durations)) + self._optimization_step_delay_seconds()

        projected_seconds = remaining_trials * per_trial_projection
        estimated_completed_at = datetime.now(timezone.utc) + timedelta(seconds=projected_seconds)
        return {
            "estimated_remaining_minutes": int(math.ceil(projected_seconds / 60.0)) if projected_seconds > 0 else 0,
            "estimated_completed_at": estimated_completed_at.isoformat().replace("+00:00", "Z"),
        }

    def _persist_optimization_job(
        self,
        job_id: str,
        strategy_id: str,
        payload: Mapping[str, Any],
        candidates: list[dict[str, Any]],
        *,
        created_at: str,
        updated_at: str | None = None,
        completed_at: str | None = None,
    ) -> None:
        status = str(payload.get("status") or "COMPLETED").upper()
        baseline_parameter_version_id = str(payload.get("base_parameter_version_id") or "").strip() or None
        normalized_candidates = sorted(
            [dict(candidate) for candidate in candidates],
            key=lambda item: int(item.get("rank") or 0) or 0,
        )
        persisted_payload = {
            key: value
            for key, value in {
                **dict(payload),
                "base_parameter_version_id": baseline_parameter_version_id,
            }.items()
            if not str(key).startswith("__optimization_")
        }
        persisted_payload.update(_normalize_optimization_constraints_payload(persisted_payload))
        summary = self._build_optimization_job_summary(persisted_payload, normalized_candidates)
        result = self._build_optimization_job_result(persisted_payload, normalized_candidates)
        persisted_updated_at = updated_at or iso_now()
        persisted_completed_at = completed_at
        if persisted_completed_at is None and status not in {"QUEUED", "RUNNING", "INTERRUPTED"}:
            persisted_completed_at = persisted_updated_at
        self.storage.insert_json_row(
            "optimization_jobs",
            {
                "id": job_id,
                "strategy_id": strategy_id,
                "status": status,
                "request_json": dumps(persisted_payload),
                "summary_json": dumps(summary),
                "result_json": dumps(result),
                "candidates_json": dumps(normalized_candidates),
                "created_at": created_at,
                "updated_at": persisted_updated_at,
                "completed_at": persisted_completed_at,
            },
        )

    def _build_optimization_job_summary(
        self,
        payload: Mapping[str, Any],
        candidates: list[dict[str, Any]],
    ) -> dict[str, Any]:
        status = str(payload.get("status") or "COMPLETED").upper()
        eta_active = status == "RUNNING"
        baseline_parameter_version_id = str(payload.get("base_parameter_version_id") or "").strip() or None
        budget_combinations = _as_int(payload.get("budget_combinations"), max(len(candidates) * 10, 24))
        completed_combinations = _as_int(
            payload.get("completed_combinations"),
            budget_combinations if status == "COMPLETED" else min(budget_combinations, len(candidates)),
        )
        persisted_trial_count = _as_int(payload.get("persisted_trial_count"), len(candidates))
        next_trial_index = _as_int(payload.get("next_trial_index"), completed_combinations + 1)
        constraint_payload = _normalize_optimization_constraints_payload(payload)
        matching_combinations = [
            dict(item)
            for item in list(payload.get("matching_combinations") or [])
            if isinstance(item, Mapping)
        ]
        summary = {
            "objective": _normalize_optimization_objective(payload.get("objective")),
            "candidate_count": len(candidates),
            "matching_combination_count": _as_int(
                payload.get("matching_combination_count"),
                len(matching_combinations),
            ),
            "matching_combinations": matching_combinations,
            "baseline_parameter_version_id": baseline_parameter_version_id,
            "entry_point": payload.get("entry_point") or "lab_menu",
            "validation_mode": payload.get("validation_mode") or "walk_forward",
            "source_run_id": payload.get("source_run_id"),
            "budget_combinations": budget_combinations,
            "completed_combinations": completed_combinations,
            "persisted_trial_count": persisted_trial_count,
            "next_trial_index": next_trial_index,
            "resume_ready": bool(payload.get("resume_ready")) or status == "INTERRUPTED",
            "interrupted_reason": payload.get("interrupted_reason"),
            "search_space": list(payload.get("search_space") or []),
            **constraint_payload,
        }
        matching_combination_source = str(
            payload.get("matching_combination_source") or ""
        ).strip()
        if matching_combination_source:
            summary["matching_combination_source"] = matching_combination_source
        summary["status"] = status
        summary["progress_pct"] = min(100, max(0, _as_int(payload.get("progress_pct"), 100 if status == "COMPLETED" else 0)))
        estimated_remaining_minutes = payload.get("estimated_remaining_minutes") if eta_active else None
        if estimated_remaining_minutes is None and status not in {"QUEUED", "RUNNING", "INTERRUPTED"}:
            estimated_remaining_minutes = 0
        if estimated_remaining_minutes is not None:
            summary["estimated_remaining_minutes"] = _as_int(estimated_remaining_minutes, 0)
        estimated_completed_at = (
            str(payload.get("estimated_completed_at") or "").strip() or None
            if eta_active or status not in {"QUEUED", "RUNNING", "INTERRUPTED"}
            else None
        )
        if estimated_completed_at:
            summary["estimated_completed_at"] = estimated_completed_at
        heartbeat_at = str(payload.get("heartbeat_at") or "").strip() or None
        if heartbeat_at:
            summary["heartbeat_at"] = heartbeat_at
        if payload.get("current_stage") is not None:
            summary["current_stage"] = payload.get("current_stage")
        elif status == "COMPLETED":
            summary["current_stage"] = "Result ready"
        elif status == "INTERRUPTED":
            summary["current_stage"] = f"Interrupted at {completed_combinations}/{budget_combinations}"
        else:
            summary["current_stage"] = f"Running trial {next_trial_index}/{budget_combinations}"

        if payload.get("latest_update") is not None:
            summary["latest_update"] = payload.get("latest_update")
        elif status == "COMPLETED":
            summary["latest_update"] = "Optimization completed."
        elif status == "INTERRUPTED":
            summary["latest_update"] = f"Progress preserved at {completed_combinations}/{budget_combinations}. Click Continue Optimization to resume."
        else:
            summary["latest_update"] = f"Evaluating trial {next_trial_index}/{budget_combinations}."

        best_metrics_summary = payload.get("best_metrics_summary")
        if best_metrics_summary is None and candidates:
            best_candidate = candidates[0]
            best_metrics_summary = self._normalized_optimization_trial_summary(
                {
                    "trial_index": best_candidate.get("rank"),
                    "label": best_candidate.get("label"),
                    "status": best_candidate.get("status") or "SUCCEEDED",
                    "parameter_snapshot": dict(best_candidate.get("parameter_snapshot") or {}),
                    "metrics": dict(best_candidate.get("metrics") or {}),
                    "score": _as_float(best_candidate.get("score"), 0.0),
                    "error_message": best_candidate.get("error_message"),
                    "started_at": best_candidate.get("started_at"),
                    "completed_at": best_candidate.get("completed_at"),
                }
            )
        normalized_best_metrics_summary = None
        if best_metrics_summary is not None:
            normalized_best_metrics_summary = self._normalized_optimization_trial_summary(best_metrics_summary)
            summary["best_metrics_summary"] = normalized_best_metrics_summary

        latest_candidate_label = self._canonical_optimization_candidate_label(
            payload.get("latest_candidate_label"),
            _as_int(_as_mapping(summary.get("best_metrics_summary")).get("trial_index"), 1),
        )
        if latest_candidate_label:
            summary["latest_candidate_label"] = latest_candidate_label
        elif normalized_best_metrics_summary and normalized_best_metrics_summary.get("label"):
            summary["latest_candidate_label"] = str(normalized_best_metrics_summary.get("label"))
        return summary

    def _build_optimization_job_result(
        self,
        payload: Mapping[str, Any],
        candidates: list[dict[str, Any]],
    ) -> dict[str, Any]:
        status = str(payload.get("status") or "COMPLETED").upper()
        eta_active = status == "RUNNING"
        baseline_parameter_version_id = str(payload.get("base_parameter_version_id") or "").strip() or None
        progress_pct = min(100, max(0, _as_int(payload.get("progress_pct"), 100 if status == "COMPLETED" else 0)))
        constraint_payload = _normalize_optimization_constraints_payload(payload)
        if status in {"QUEUED", "RUNNING", "INTERRUPTED"}:
            headline = self._canonical_optimization_candidate_label(
                payload.get("latest_candidate_label"),
                _as_int(_as_mapping(payload.get("best_metrics_summary")).get("trial_index"), 1),
            )
            return {
                "best_candidate_id": None,
                "best_candidate_label": None,
                "baseline_parameter_version_id": baseline_parameter_version_id,
                "headline": headline if headline else "Optimization in progress",
                "summary": str(payload.get("latest_update") or "").strip() or "Optimization in progress.",
                "stability_verdict": None,
                "status": status,
                "progress_pct": progress_pct,
                "current_stage": payload.get("current_stage") or ("Interrupted" if status == "INTERRUPTED" else "Running"),
                "latest_update": payload.get("latest_update") or "Optimization in progress.",
                "estimated_remaining_minutes": payload.get("estimated_remaining_minutes") if eta_active else None,
                "estimated_completed_at": payload.get("estimated_completed_at") if eta_active else None,
                **constraint_payload,
            }

        best_candidate = candidates[0] if candidates else None
        best_analysis = dict((best_candidate or {}).get("analysis") or {})
        headline = best_analysis.get("title") if best_candidate else None
        summary = best_candidate.get("summary") if best_candidate else None
        if not summary:
            summary = str(payload.get("latest_update") or "").strip() or "Optimization completed."
        return {
            "best_candidate_id": best_candidate.get("id") if best_candidate else None,
            "best_candidate_label": self._canonical_optimization_candidate_label(
                best_candidate.get("label"),
                _as_int(best_candidate.get("rank"), 1),
            )
            if best_candidate
            else None,
            "baseline_parameter_version_id": baseline_parameter_version_id,
            "headline": headline,
            "summary": summary,
            "stability_verdict": best_analysis.get("stability_verdict") if best_candidate else None,
            "status": status,
            "progress_pct": progress_pct,
            "current_stage": payload.get("current_stage") or "Result ready",
            "latest_update": payload.get("latest_update") or summary,
            "estimated_remaining_minutes": payload.get("estimated_remaining_minutes"),
            "estimated_completed_at": payload.get("estimated_completed_at"),
            **constraint_payload,
        }

    def _hydrate_optimization_job(self, row: Mapping[str, Any]) -> dict[str, Any]:
        job = dict(row)
        job["request"] = loads(job.pop("request_json", None), {})
        job["summary"] = loads(job.pop("summary_json", None), {})
        job["result"] = loads(job.pop("result_json", None), {})
        raw_candidates = loads(job.pop("candidates_json", None), [])
        constraint_payload = _normalize_optimization_constraints_payload(
            {
                "constraint_preset_key": job["request"].get("constraint_preset_key")
                or job["summary"].get("constraint_preset_key")
                or job["result"].get("constraint_preset_key"),
                "constraint_label": job["request"].get("constraint_label")
                or job["summary"].get("constraint_label")
                or job["result"].get("constraint_label"),
                "constraints": job["request"].get("constraints")
                or job["summary"].get("constraints")
                or job["result"].get("constraints"),
            }
        )
        job["request"].update(constraint_payload)
        job["summary"].update(constraint_payload)
        job["result"].update(constraint_payload)
        normalized_objective = _normalize_optimization_objective(
            job["summary"].get("objective") or job["request"].get("objective")
        )
        job["request"]["objective"] = normalized_objective
        job["summary"]["objective"] = normalized_objective
        job["base_parameter_version_id"] = job["request"].get("base_parameter_version_id")
        raw_request = dict(job["request"])
        raw_summary = dict(job["summary"])
        raw_result = dict(job["result"])
        summary_status = str(
            job["summary"].get("status")
            or job.get("status")
            or job["request"].get("status")
            or job["result"].get("status")
            or "COMPLETED"
        ).upper()
        matching_combination_source = str(
            job["summary"].get("matching_combination_source")
            or job["request"].get("matching_combination_source")
            or ""
        ).strip() or None
        running_like = summary_status in {"QUEUED", "RUNNING", "INTERRUPTED"}
        eta_active = summary_status == "RUNNING"
        progress_default = 100 if summary_status == "COMPLETED" else 0
        job["summary"]["status"] = summary_status
        if not running_like and job["summary"].get("matching_combination_count") is None:
            job["summary"]["matching_combination_count"] = (
                self._count_optimization_trials_matching_constraints(
                    str(job["id"]),
                    constraint_payload.get("constraints") or [],
                )
            )
        job["summary"].setdefault(
            "progress_pct",
            _as_int(
                job["request"].get("progress_pct"),
                _as_int(job["result"].get("progress_pct"), progress_default),
            ),
        )
        job["summary"].setdefault(
            "current_stage",
            job["request"].get("current_stage")
            or job["result"].get("current_stage")
            or ("Result ready" if summary_status == "COMPLETED" else "Running"),
        )
        job["summary"].setdefault(
            "latest_update",
            job["request"].get("latest_update")
            or job["result"].get("latest_update")
            or job["result"].get("summary")
            or ("Optimization completed." if summary_status == "COMPLETED" else "Optimization in progress."),
        )
        raw_search_space = job["request"].get("search_space") or job["summary"].get("search_space")
        budget_default = max(len(raw_candidates), 1) if (raw_candidates or not running_like) else 0
        budget_combinations = _as_int(
            job["summary"].get("budget_combinations"),
            _as_int(job["request"].get("budget_combinations"), budget_default),
        )
        completed_default = 0 if running_like else budget_combinations
        completed_combinations = _as_int(
            job["summary"].get("completed_combinations"),
            _as_int(job["request"].get("completed_combinations"), completed_default),
        )
        persisted_trial_count = _as_int(
            job["summary"].get("persisted_trial_count"),
            _as_int(job["request"].get("persisted_trial_count"), completed_combinations),
        )
        next_trial_index = _as_int(
            job["summary"].get("next_trial_index"),
            _as_int(job["request"].get("next_trial_index"), completed_combinations + 1),
        )
        estimated_remaining_minutes = None
        estimated_completed_at = None
        if eta_active:
            estimated_remaining_minutes = job["summary"].get("estimated_remaining_minutes")
            if estimated_remaining_minutes is None:
                estimated_remaining_minutes = job["request"].get("estimated_remaining_minutes")
            if estimated_remaining_minutes is None:
                estimated_remaining_minutes = job["result"].get("estimated_remaining_minutes")
            estimated_completed_at = (
                str(
                    job["summary"].get("estimated_completed_at")
                    or job["request"].get("estimated_completed_at")
                    or job["result"].get("estimated_completed_at")
                    or ""
                ).strip()
                or None
            )
        elif not running_like:
            estimated_remaining_minutes = 0
            estimated_completed_at = (
                str(
                    job["summary"].get("estimated_completed_at")
                    or job["request"].get("estimated_completed_at")
                    or job["result"].get("estimated_completed_at")
                    or job.get("completed_at")
                    or job.get("updated_at")
                    or ""
                ).strip()
                or None
            )
        heartbeat_at = str(job["summary"].get("heartbeat_at") or job.get("updated_at") or "").strip() or None
        best_metrics_summary = (
            job["summary"].get("best_metrics_summary")
            if job["summary"].get("best_metrics_summary") is not None
            else job["request"].get("best_metrics_summary")
        )
        if best_metrics_summary is not None:
            job["summary"]["best_metrics_summary"] = self._normalized_optimization_trial_summary(best_metrics_summary)
        elif "best_metrics_summary" in job["summary"]:
            job["summary"]["best_metrics_summary"] = None
        job["summary"]["budget_combinations"] = budget_combinations
        job["summary"]["completed_combinations"] = completed_combinations
        job["summary"]["persisted_trial_count"] = persisted_trial_count
        job["summary"]["next_trial_index"] = next_trial_index
        job["summary"].setdefault("resume_ready", summary_status == "INTERRUPTED")
        if summary_status == "INTERRUPTED" and not job["summary"].get("interrupted_reason"):
            job["summary"]["interrupted_reason"] = job["request"].get("interrupted_reason") or "service_restart"
        if estimated_remaining_minutes is not None:
            job["summary"]["estimated_remaining_minutes"] = _as_int(estimated_remaining_minutes, 0)
        else:
            job["summary"]["estimated_remaining_minutes"] = None
        if estimated_completed_at:
            job["summary"]["estimated_completed_at"] = estimated_completed_at
        else:
            job["summary"]["estimated_completed_at"] = None
        if heartbeat_at:
            job["summary"]["heartbeat_at"] = heartbeat_at
        if (
            "progress_pct" not in raw_summary
            and "progress_pct" not in raw_request
            and "progress_pct" not in raw_result
            and budget_combinations > 0
        ):
            job["summary"]["progress_pct"] = min(
                100,
                max(0, int(round((completed_combinations / budget_combinations) * 100))),
            )

        def sync_job_projection() -> None:
            job["progress_pct"] = job["summary"].get("progress_pct", 0)
            job["current_stage"] = job["summary"].get("current_stage")
            job["latest_update"] = job["summary"].get("latest_update")
            job["estimated_remaining_minutes"] = job["summary"].get("estimated_remaining_minutes")
            job["estimated_completed_at"] = job["summary"].get("estimated_completed_at")
            job["resume_ready"] = job["summary"].get("resume_ready")
            job["persisted_trial_count"] = job["summary"].get("persisted_trial_count")
            job["next_trial_index"] = job["summary"].get("next_trial_index")
            job["interrupted_reason"] = job["summary"].get("interrupted_reason")
            job["best_metrics_summary"] = job["summary"].get("best_metrics_summary")
            job["matching_combination_count"] = job["summary"].get("matching_combination_count")
            job["matching_combination_source"] = job["summary"].get("matching_combination_source")
            job["matching_combinations"] = list(job["summary"].get("matching_combinations") or [])
            job["constraint_preset_key"] = job["summary"].get("constraint_preset_key") or job["request"].get("constraint_preset_key")
            job["constraint_label"] = job["summary"].get("constraint_label") or job["request"].get("constraint_label")
            job["constraints"] = job["summary"].get("constraints") or job["request"].get("constraints")

        def has_running_projection_value(key: str) -> bool:
            for source in (raw_summary, raw_request, raw_result):
                if key not in source:
                    continue
                value = source.get(key)
                if value is None:
                    continue
                if isinstance(value, str) and not value.strip():
                    continue
                return True
            return False

        running_projection_present = summary_status == "QUEUED" or any(
            has_running_projection_value(key)
            for key in (
                "best_metrics_summary",
                "heartbeat_at",
            )
        ) or (
            eta_active
            and any(
                has_running_projection_value(key)
                for key in (
                    "estimated_remaining_minutes",
                    "estimated_completed_at",
                )
            )
        )
        strategy: dict[str, Any] | None = None
        if running_like:
            normalized_search_space = [
                dict(item)
                for item in list(raw_search_space or [])
                if isinstance(item, Mapping)
            ]
        else:
            strategy = self.get_strategy_detail(str(job["strategy_id"]))
            normalized_search_space = self._normalize_optimization_search_space(
                strategy,
                {"search_space": raw_search_space},
            )
        if strategy is None:
            strategy = self.get_strategy_detail(str(job["strategy_id"]))
        has_persisted_trials = self._optimization_job_has_persisted_trials(
            str(job["id"])
        )
        job["strategy_name"] = _display_strategy_name(
            row.get("strategy_name") or job.get("strategy_name") or strategy.get("name"),
            strategy.get("parameters"),
        )
        if normalized_search_space:
            job["request"]["search_space"] = normalized_search_space
            job["summary"]["search_space"] = normalized_search_space
        job["matching_combinations"] = list(job["summary"].get("matching_combinations") or [])
        if job["matching_combinations"]:
            job["summary"]["matching_combination_count"] = len(job["matching_combinations"])
        if not matching_combination_source and job["matching_combinations"]:
            matching_combination_source = (
                "all_trials" if has_persisted_trials else "persisted_candidates"
            )
        if matching_combination_source:
            job["summary"]["matching_combination_source"] = (
                matching_combination_source
            )

        def build_matching_combinations_from_candidate_records(
            candidate_records: Sequence[Mapping[str, Any]],
        ) -> list[dict[str, Any]]:
            ranked_records = self._rerank_optimization_candidate_records(
                candidate_records,
                normalized_objective,
            )
            normalized_records: list[dict[str, Any]] = []
            for index, record in enumerate(ranked_records, start=1):
                normalized_record = self._normalize_optimization_candidate(
                    strategy,
                    record,
                    rank=index,
                    base_parameter_version_id=job["base_parameter_version_id"],
                )
                normalized_record["analysis"] = {}
                normalized_record["allowed_actions"] = []
                normalized_records.append(normalized_record)
            return [
                record
                for record in normalized_records
                if self._optimization_trial_passes_constraints(
                    record,
                    constraint_payload.get("constraints") or [],
                )
            ]

        if not running_like and raw_candidates:
            candidate_metrics_need_repair = any(
                _optimization_metrics_need_repair(_as_mapping(candidate).get("metrics"))
                for candidate in raw_candidates
            )
            if _optimization_metrics_need_repair(
                _as_mapping(job["summary"].get("best_metrics_summary")).get("metrics")
            ):
                candidate_metrics_need_repair = True
            top_persisted_candidate = _as_mapping(raw_candidates[0])
            top_matching_combination = _as_mapping(
                (job["matching_combinations"] or [None])[0]
            )
            candidate_selection_mismatch = (
                has_persisted_trials
                and matching_combination_source == "all_trials"
                and bool(top_matching_combination)
                and _optimization_parameter_snapshot_signature(
                    top_persisted_candidate.get("parameter_snapshot") or {}
                )
                != _optimization_parameter_snapshot_signature(
                    top_matching_combination.get("parameter_snapshot") or {}
                )
            )
            # Refresh completed jobs when the persisted candidate selection no
            # longer matches the all-trial winner under the current objective.
            should_repair_candidates = (
                candidate_metrics_need_repair
                or not job["matching_combinations"]
                or candidate_selection_mismatch
            )
            if should_repair_candidates:
                repaired_candidates, repaired_best_summary, repaired_any = self._repair_optimization_job_candidates(
                    job=job,
                    strategy=strategy or self.get_strategy_detail(str(job["strategy_id"])),
                    raw_candidates=raw_candidates,
                    normalized_search_space=normalized_search_space,
                )
                if repaired_any:
                    raw_candidates = repaired_candidates
                    if repaired_best_summary is not None:
                        job["summary"]["best_metrics_summary"] = repaired_best_summary
                    self._persist_optimization_job(
                        str(job["id"]),
                        str(job["strategy_id"]),
                        {
                            **dict(job["request"]),
                            "status": summary_status,
                            "progress_pct": job["summary"].get("progress_pct"),
                            "completed_combinations": job["summary"].get("completed_combinations"),
                            "persisted_trial_count": job["summary"].get("persisted_trial_count"),
                            "next_trial_index": job["summary"].get("next_trial_index"),
                            "resume_ready": job["summary"].get("resume_ready"),
                            "interrupted_reason": job["summary"].get("interrupted_reason"),
                            "best_metrics_summary": repaired_best_summary,
                            "current_stage": job["summary"].get("current_stage"),
                            "latest_update": job["summary"].get("latest_update"),
                            "latest_candidate_label": (
                                repaired_candidates[0].get("label")
                                if repaired_candidates
                                else job["summary"].get("latest_candidate_label")
                            ),
                            "estimated_remaining_minutes": job["summary"].get("estimated_remaining_minutes"),
                            "estimated_completed_at": job["summary"].get("estimated_completed_at"),
                            "heartbeat_at": job["summary"].get("heartbeat_at"),
                            "budget_combinations": job["summary"].get("budget_combinations"),
                            "search_space": normalized_search_space,
                        },
                        repaired_candidates,
                        created_at=str(job["created_at"]),
                        updated_at=iso_now(),
                        completed_at=str(job.get("completed_at") or "").strip() or None,
                    )
            if not job["matching_combinations"]:
                job["matching_combinations"] = build_matching_combinations_from_candidate_records(
                    raw_candidates,
                )
                matching_combination_source = "persisted_candidates"
                expected_matching_count = _as_int(
                    job["summary"].get("matching_combination_count"),
                    len(job["matching_combinations"]),
                )
                if (
                    expected_matching_count > len(job["matching_combinations"])
                    or (not job["matching_combinations"] and not raw_candidates)
                ):
                    trial_records = self._load_optimization_trials(
                        str(job["id"]),
                        include_chart_series=False,
                        include_metrics_json=True,
                    )
                    if trial_records:
                        job["matching_combinations"] = (
                            self._build_optimization_matching_combination_candidates(
                                strategy=strategy,
                                payload=job["request"],
                                trials=trial_records,
                            )
                        )
                        matching_combination_source = "all_trials"
                job["summary"]["matching_combinations"] = list(
                    job["matching_combinations"],
                )
                job["summary"]["matching_combination_count"] = len(
                    job["matching_combinations"],
                )
                job["summary"]["matching_combination_source"] = (
                    matching_combination_source
                )

        if running_like and running_projection_present:
            if summary_status in {"QUEUED", "RUNNING", "INTERRUPTED"}:
                progress_snapshot = self._optimization_trial_progress_snapshot(
                    str(job["id"]),
                    str(job.get("updated_at") or ""),
                )
                summary_completed = _as_int(job["summary"].get("completed_combinations"), 0)
                summary_persisted = _as_int(job["summary"].get("persisted_trial_count"), summary_completed)
                snapshot_completed = _as_int(progress_snapshot.get("completed_combinations"), summary_completed)
                snapshot_persisted = _as_int(progress_snapshot.get("persisted_trial_count"), summary_persisted)
                snapshot_ahead = snapshot_completed > summary_completed or snapshot_persisted > summary_persisted
                if snapshot_ahead:
                    job["summary"]["completed_combinations"] = snapshot_completed
                    job["summary"]["persisted_trial_count"] = snapshot_persisted
                    job["summary"]["next_trial_index"] = _as_int(
                        progress_snapshot.get("next_trial_index"),
                        snapshot_completed + 1,
                    )
                    budget_value = _as_int(job["summary"].get("budget_combinations"), 0)
                    if budget_value > 0:
                        job["summary"]["progress_pct"] = min(
                            100,
                            max(0, int(round((snapshot_completed / budget_value) * 100))),
                        )
                        if summary_status == "RUNNING":
                            job["summary"]["current_stage"] = (
                                f"Running trial {job['summary']['next_trial_index']}/{budget_value}"
                            )
                            job["summary"]["latest_update"] = (
                                f"Completed {snapshot_completed}/{budget_value} trials."
                            )
                        elif summary_status == "INTERRUPTED":
                            job["summary"]["current_stage"] = (
                                f"Interrupted at {snapshot_completed}/{budget_value}"
                            )
                            job["summary"]["latest_update"] = (
                                f"Progress preserved at {snapshot_completed}/{budget_value}. "
                                "Click Continue Optimization to resume."
                            )
                        else:
                            job["summary"]["current_stage"] = (
                                f"Preparing trial {job['summary']['next_trial_index']}/{budget_value}"
                            )
                            job["summary"]["latest_update"] = (
                                f"Resuming optimization from trial {job['summary']['next_trial_index']}."
                            )
                    latest_completed_at = str(progress_snapshot.get("latest_completed_at") or "").strip() or None
                    if latest_completed_at:
                        job["summary"]["heartbeat_at"] = latest_completed_at
                if snapshot_completed > 0 and (snapshot_ahead or not job["summary"].get("best_metrics_summary")):
                    best_summary_snapshot = self._optimization_trial_best_summary_snapshot(str(job["id"]))
                    if best_summary_snapshot is not None:
                        job["summary"]["best_metrics_summary"] = best_summary_snapshot
                        job["summary"]["latest_candidate_label"] = self._canonical_optimization_candidate_label(
                            job["summary"].get("latest_candidate_label") or best_summary_snapshot.get("label"),
                            _as_int(best_summary_snapshot.get("trial_index"), 1),
                        )
            running_headline = self._canonical_optimization_candidate_label(
                job["summary"].get("latest_candidate_label") or job["result"].get("headline"),
                _as_int(_as_mapping(job["summary"].get("best_metrics_summary")).get("trial_index"), 1),
            ) or (
                "Optimization interrupted" if summary_status == "INTERRUPTED" else "Optimization in progress"
            )
            job["candidates"] = []
            job["result"] = {
                **job["result"],
                "best_candidate_id": None,
                "best_candidate_label": None,
                "headline": running_headline,
                "summary": job["result"].get("summary") or job["summary"].get("latest_update"),
                "stability_verdict": None,
                "status": summary_status,
                "progress_pct": job["summary"].get("progress_pct", 0),
                "current_stage": job["summary"].get("current_stage"),
                "latest_update": job["summary"].get("latest_update"),
                "estimated_remaining_minutes": job["summary"].get("estimated_remaining_minutes"),
                "estimated_completed_at": job["summary"].get("estimated_completed_at"),
            }
            sync_job_projection()
            return job

        if not running_like and raw_candidates:
            ranked_candidates = self._rerank_optimization_candidate_records(
                raw_candidates,
                normalized_objective,
            )
            normalized_candidates: list[dict[str, Any]] = []
            for index, candidate in enumerate(ranked_candidates, start=1):
                normalized_candidate = self._normalize_optimization_candidate(
                    strategy or self.get_strategy_detail(str(job["strategy_id"])),
                    candidate,
                    rank=index,
                    base_parameter_version_id=job["base_parameter_version_id"],
                )
                analysis = dict(normalized_candidate.get("analysis") or {})
                heatmap = dict(analysis.get("heatmap") or {})
                if normalized_search_space and not heatmap.get("cells"):
                    analysis["heatmap"] = self._build_optimization_heatmap(
                        normalized_search_space,
                        normalized_candidate.get("parameter_snapshot") or {},
                        _as_float(
                            normalized_candidate.get("metrics", {}).get("return_sharpe"),
                            _as_float(
                                normalized_candidate.get("metrics", {}).get("sharpe"),
                                _as_float(normalized_candidate.get("score"), 0.0),
                            ),
                        ),
                        normalized_candidate.get("metrics") or {},
                    )
                if analysis:
                    normalized_candidate["analysis"] = analysis
                normalized_candidates.append(normalized_candidate)
            job["candidates"] = normalized_candidates
            job["summary"]["candidate_count"] = len(normalized_candidates)
            matching_candidates = [
                candidate
                for candidate in normalized_candidates
                if self._optimization_trial_passes_constraints(
                    candidate,
                    constraint_payload.get("constraints") or [],
                )
            ]
            best_candidate = (
                matching_candidates[0]
                if matching_candidates
                else (normalized_candidates[0] if normalized_candidates else None)
            )
            if best_candidate:
                job["summary"]["best_metrics_summary"] = self._normalized_optimization_trial_summary(
                    {
                        "trial_index": best_candidate.get("rank"),
                        "label": best_candidate.get("label"),
                        "status": best_candidate.get("status") or "SUCCEEDED",
                        "parameter_snapshot": dict(best_candidate.get("parameter_snapshot") or {}),
                        "metrics": dict(best_candidate.get("metrics") or {}),
                        "score": _as_float(best_candidate.get("score"), 0.0),
                        "error_message": best_candidate.get("error_message"),
                        "started_at": best_candidate.get("started_at"),
                        "completed_at": best_candidate.get("completed_at"),
                    }
                )
            if best_candidate:
                best_analysis = dict(best_candidate.get("analysis") or {})
                best_label = self._canonical_optimization_candidate_label(
                    best_candidate.get("label"),
                    _as_int(best_candidate.get("rank"), 1),
                )
                job["result"] = {
                    **job["result"],
                    "best_candidate_id": best_candidate.get("id"),
                    "best_candidate_label": best_label,
                    "headline": job["result"].get("headline") or best_analysis.get("title"),
                    "summary": job["result"].get("summary") or best_candidate.get("summary"),
                    "stability_verdict": job["result"].get("stability_verdict") or best_analysis.get("stability_verdict"),
                }
            job["result"] = {
                **job["result"],
                "status": summary_status,
                "progress_pct": job["summary"].get("progress_pct", 100),
                "current_stage": job["summary"].get("current_stage"),
                "latest_update": job["summary"].get("latest_update"),
                "estimated_remaining_minutes": job["summary"].get("estimated_remaining_minutes"),
                "estimated_completed_at": job["summary"].get("estimated_completed_at"),
            }
            sync_job_projection()
            return job

        if not running_like and summary_status in {"FAILED", "PARTIALLY_FAILED"}:
            job["candidates"] = []
            job["summary"]["candidate_count"] = 0
            if not job["matching_combinations"]:
                failed_trials = self._load_optimization_trials(
                    str(job["id"]),
                    include_chart_series=False,
                    include_metrics_json=True,
                )
                job["matching_combinations"] = (
                    self._build_optimization_matching_combination_candidates(
                        strategy=strategy,
                        payload=job["request"],
                        trials=failed_trials,
                    )
                )
                job["summary"]["matching_combinations"] = list(
                    job["matching_combinations"],
                )
                job["summary"]["matching_combination_count"] = len(
                    job["matching_combinations"],
                )
                job["summary"]["matching_combination_source"] = "all_trials"
            job["result"] = {
                **job["result"],
                "status": summary_status,
                "progress_pct": job["summary"].get("progress_pct", 100),
                "current_stage": job["summary"].get("current_stage"),
                "latest_update": job["summary"].get("latest_update"),
                "estimated_remaining_minutes": job["summary"].get("estimated_remaining_minutes"),
                "estimated_completed_at": job["summary"].get("estimated_completed_at"),
            }
            sync_job_projection()
            return job

        trials = self._load_optimization_trials(
            str(job["id"]),
            include_chart_series=False,
            include_metrics_json=False,
        )
        if not running_like:
            trials = self._merge_optimization_trial_chart_series(
                trials,
                self._load_optimization_trial_chart_series_map(
                    str(job["id"]),
                    self._optimization_top_trial_indices(
                        trials,
                        objective=normalized_objective,
                    ),
                ),
            )
        persisted_trial_count = len(trials)
        next_trial_index = max([int(trial.get("trial_index") or 0) for trial in trials], default=0) + 1
        if persisted_trial_count:
            job["summary"]["persisted_trial_count"] = persisted_trial_count
            job["summary"]["next_trial_index"] = next_trial_index
        else:
            job["summary"].setdefault("persisted_trial_count", persisted_trial_count)
            job["summary"].setdefault("next_trial_index", next_trial_index)
        job["summary"].setdefault("resume_ready", summary_status == "INTERRUPTED")
        if summary_status == "INTERRUPTED" and not job["summary"].get("interrupted_reason"):
            job["summary"]["interrupted_reason"] = job["request"].get("interrupted_reason") or "service_restart"

        if not job["summary"].get("best_metrics_summary"):
            best_summary = self._best_optimization_trial_summary(trials, normalized_objective)
            if best_summary is not None:
                job["summary"]["best_metrics_summary"] = best_summary
        if job["summary"].get("best_metrics_summary"):
            job["summary"]["best_metrics_summary"] = self._normalized_optimization_trial_summary(
                job["summary"]["best_metrics_summary"]
            )

        budget_combinations = _as_int(
            job["summary"].get("budget_combinations"),
            _as_int(job["request"].get("budget_combinations"), max(persisted_trial_count, 1)),
        )
        persisted_completed_count = sum(1 for trial in trials if trial.get("started_at") and trial.get("completed_at"))
        completed_combinations = (
            persisted_completed_count
            if persisted_trial_count
            else _as_int(job["summary"].get("completed_combinations"), 0)
        )
        if eta_active:
            eta_projection = self._optimization_eta_projection(
                trials,
                budget_combinations=budget_combinations,
                completed_combinations=completed_combinations,
            )
        elif running_like:
            eta_projection = {
                "estimated_remaining_minutes": None,
                "estimated_completed_at": None,
            }
        else:
            terminal_completed_at = (
                str(job.get("completed_at") or job.get("updated_at") or "").strip() or None
            )
            eta_projection = {
                "estimated_remaining_minutes": 0,
                "estimated_completed_at": terminal_completed_at,
            }
        job["summary"]["completed_combinations"] = completed_combinations
        job["summary"].update(eta_projection)
        job["progress_pct"] = job["summary"].get("progress_pct", 0)
        job["current_stage"] = job["summary"].get("current_stage")
        job["latest_update"] = job["summary"].get("latest_update")
        job["estimated_remaining_minutes"] = job["summary"].get("estimated_remaining_minutes")
        job["estimated_completed_at"] = job["summary"].get("estimated_completed_at")
        job["resume_ready"] = job["summary"].get("resume_ready")
        job["persisted_trial_count"] = job["summary"].get("persisted_trial_count")
        job["next_trial_index"] = job["summary"].get("next_trial_index")
        job["interrupted_reason"] = job["summary"].get("interrupted_reason")
        job["best_metrics_summary"] = job["summary"].get("best_metrics_summary")
        job["matching_combination_count"] = job["summary"].get("matching_combination_count")

        if running_like:
            running_headline = self._canonical_optimization_candidate_label(
                job["summary"].get("latest_candidate_label") or job["result"].get("headline"),
                _as_int(_as_mapping(job["summary"].get("best_metrics_summary")).get("trial_index"), 1),
            ) or (
                "Optimization interrupted" if summary_status == "INTERRUPTED" else "Optimization in progress"
            )
            job["candidates"] = []
            job["result"] = {
                **job["result"],
                "best_candidate_id": None,
                "best_candidate_label": None,
                "headline": running_headline,
                "stability_verdict": None,
                "status": summary_status,
                "progress_pct": job["summary"].get("progress_pct", 0),
                "current_stage": job["summary"].get("current_stage"),
                "latest_update": job["summary"].get("latest_update"),
                "estimated_remaining_minutes": job["summary"].get("estimated_remaining_minutes"),
                "estimated_completed_at": job["summary"].get("estimated_completed_at"),
            }
            job["constraint_preset_key"] = job["summary"].get("constraint_preset_key") or job["request"].get("constraint_preset_key")
            job["constraint_label"] = job["summary"].get("constraint_label") or job["request"].get("constraint_label")
            job["constraints"] = job["summary"].get("constraints") or job["request"].get("constraints")
            return job

        if strategy is None:
            strategy = self.get_strategy_detail(str(job["strategy_id"]))
        ranked_candidates = self._rerank_optimization_candidate_records(
            raw_candidates,
            normalized_objective,
        )
        normalized_candidates: list[dict[str, Any]] = []
        for index, candidate in enumerate(ranked_candidates, start=1):
            normalized_candidate = self._normalize_optimization_candidate(
                strategy,
                candidate,
                rank=index,
                base_parameter_version_id=job["base_parameter_version_id"],
            )
            analysis = dict(normalized_candidate.get("analysis") or {})
            heatmap = dict(analysis.get("heatmap") or {})
            if normalized_search_space and not heatmap.get("cells"):
                analysis["heatmap"] = self._build_optimization_heatmap(
                    normalized_search_space,
                    normalized_candidate.get("parameter_snapshot") or {},
                    _as_float(
                        normalized_candidate.get("metrics", {}).get("return_sharpe"),
                        _as_float(
                            normalized_candidate.get("metrics", {}).get("sharpe"),
                            _as_float(normalized_candidate.get("score"), 0.0),
                        ),
                    ),
                    normalized_candidate.get("metrics") or {},
                )
            if analysis:
                normalized_candidate["analysis"] = analysis
            normalized_candidates.append(normalized_candidate)
        job["candidates"] = normalized_candidates
        matching_candidates = [
            candidate
            for candidate in normalized_candidates
            if self._optimization_trial_passes_constraints(
                candidate,
                constraint_payload.get("constraints") or [],
            )
        ]
        best_candidate = (
            matching_candidates[0]
            if matching_candidates
            else (normalized_candidates[0] if normalized_candidates else None)
        )
        if best_candidate:
            job["summary"]["best_metrics_summary"] = self._normalized_optimization_trial_summary(
                {
                    "trial_index": best_candidate.get("rank"),
                    "label": best_candidate.get("label"),
                    "status": best_candidate.get("status") or "SUCCEEDED",
                    "parameter_snapshot": dict(best_candidate.get("parameter_snapshot") or {}),
                    "metrics": dict(best_candidate.get("metrics") or {}),
                    "score": _as_float(best_candidate.get("score"), 0.0),
                    "error_message": best_candidate.get("error_message"),
                    "started_at": best_candidate.get("started_at"),
                    "completed_at": best_candidate.get("completed_at"),
                }
            )
        if best_candidate:
            job["result"]["best_candidate_id"] = best_candidate.get("id")
            job["result"]["best_candidate_label"] = self._canonical_optimization_candidate_label(
                best_candidate.get("label"),
                _as_int(best_candidate.get("rank"), 1),
            )
        job["result"] = {
            **job["result"],
            "estimated_remaining_minutes": job["summary"].get("estimated_remaining_minutes"),
            "estimated_completed_at": job["summary"].get("estimated_completed_at"),
        }
        if not job["matching_combinations"]:
            detailed_trials = self._optimization_with_full_metrics(
                str(job["id"]),
                trials,
            )
            job["matching_combinations"] = (
                self._build_optimization_matching_combination_candidates(
                    strategy=strategy,
                    payload=job["request"],
                    trials=detailed_trials,
                )
            )
            job["summary"]["matching_combinations"] = list(
                job["matching_combinations"],
            )
            job["summary"]["matching_combination_count"] = len(
                job["matching_combinations"],
            )
            job["summary"]["matching_combination_source"] = "all_trials"
        job["progress_pct"] = job["summary"].get("progress_pct", 0)
        job["current_stage"] = job["summary"].get("current_stage")
        job["latest_update"] = job["summary"].get("latest_update")
        job["estimated_remaining_minutes"] = job["summary"].get("estimated_remaining_minutes")
        job["estimated_completed_at"] = job["summary"].get("estimated_completed_at")
        job["best_metrics_summary"] = job["summary"].get("best_metrics_summary")
        job["matching_combination_count"] = job["summary"].get("matching_combination_count")
        job["constraint_preset_key"] = job["summary"].get("constraint_preset_key") or job["request"].get("constraint_preset_key")
        job["constraint_label"] = job["summary"].get("constraint_label") or job["request"].get("constraint_label")
        job["constraints"] = job["summary"].get("constraints") or job["request"].get("constraints")
        return job

    def _build_optimization_trial_preview_and_chart_series(
        self,
        strategy: Mapping[str, Any],
        evaluation_request: Mapping[str, Any],
        payload: Mapping[str, Any],
        parameter_snapshot: Mapping[str, Any],
        *,
        prepared_context: Mapping[str, Any] | None = None,
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        effective_strategy = self._optimization_effective_strategy(strategy, parameter_snapshot)
        if prepared_context is None:
            cached_prepared_context = payload.get(OPTIMIZATION_PREPARED_CONTEXT_KEY) if isinstance(payload, dict) else None
            if isinstance(cached_prepared_context, dict):
                prepared_context = cached_prepared_context
            else:
                prepare_context = getattr(type(self), "_prepare_backtest_run_context", None)
                if callable(prepare_context):
                    prepared_context = prepare_context(self, effective_strategy, evaluation_request)
                    if isinstance(payload, dict):
                        payload[OPTIMIZATION_PREPARED_CONTEXT_KEY] = prepared_context
        simulate_from_prepared = getattr(self, "_simulate_run_from_prepared_context", None)
        if prepared_context is not None and callable(simulate_from_prepared):
            preview, chart_series, _ = simulate_from_prepared(
                effective_strategy,
                evaluation_request,
                prepared_context,
            )
        else:
            preview, chart_series, _ = self._simulate_run(effective_strategy, evaluation_request)
        return preview, chart_series

    def _evaluate_optimization_trial(
        self,
        strategy: Mapping[str, Any],
        evaluation_request: Mapping[str, Any],
        payload: Mapping[str, Any],
        parameter_snapshot: Mapping[str, Any],
        *,
        prepared_context: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        preview, chart_series = self._build_optimization_trial_preview_and_chart_series(
            strategy,
            evaluation_request,
            payload,
            parameter_snapshot,
            prepared_context=prepared_context,
        )
        metrics = self._build_real_optimization_metrics(preview, chart_series)
        return {
            "parameter_snapshot": dict(parameter_snapshot),
            "metrics": metrics,
            "chart_series": chart_series,
            "score": self._score_optimization_metrics(metrics, payload.get("objective")),
        }

    def _backfill_optimization_top_trial_chart_series(
        self,
        job_id: str,
        strategy: Mapping[str, Any],
        evaluation_request: Mapping[str, Any],
        payload: Mapping[str, Any],
        trials: Sequence[Mapping[str, Any]],
        *,
        prepared_context: Mapping[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        trial_records = {
            _as_int(trial.get("trial_index"), 0): dict(trial)
            for trial in trials
            if _as_int(trial.get("trial_index"), 0) > 0
        }
        top_trial_indices = self._optimization_top_trial_indices(
            list(trial_records.values()),
            objective=payload.get("objective"),
        )
        persisted_chart_series = self._load_optimization_trial_chart_series_map(job_id, top_trial_indices)
        for trial_index in top_trial_indices:
            trial = trial_records.get(trial_index)
            if trial is None or str(trial.get("status") or "").upper() != "SUCCEEDED":
                continue
            chart_series = list(trial.get("chart_series") or persisted_chart_series.get(trial_index) or [])
            repaired_metrics = self._repair_optimization_trial_metrics(
                job_id,
                trial_index,
                trial.get("metrics") or {},
                chart_series=chart_series,
                persist=bool(chart_series),
            )
            if not chart_series:
                _, chart_series = self._build_optimization_trial_preview_and_chart_series(
                    strategy,
                    evaluation_request,
                    payload,
                    dict(trial.get("parameter_snapshot") or {}),
                    prepared_context=prepared_context,
                )
                repaired_metrics = self._repair_optimization_trial_metrics(
                    job_id,
                    trial_index,
                    repaired_metrics,
                    chart_series=chart_series,
                    persist=False,
                )
                self._persist_optimization_trial(
                    job_id,
                    trial_index,
                    status=str(trial.get("status") or "SUCCEEDED"),
                    parameter_snapshot=dict(trial.get("parameter_snapshot") or {}),
                    metrics=repaired_metrics,
                    chart_series=chart_series,
                    score=trial.get("score"),
                    error_message=str(trial.get("error_message") or "").strip() or None,
                    started_at=str(trial.get("started_at") or "").strip() or None,
                    completed_at=str(trial.get("completed_at") or "").strip() or None,
                )
            trial["metrics"] = repaired_metrics
            trial["chart_series"] = list(chart_series)
        return [trial_records[index] for index in sorted(trial_records)]

    def _run_real_optimization_job(
        self,
        job_id: str,
        strategy_id: str,
        payload: Mapping[str, Any],
        *,
        created_at: str,
        existing_candidates: list[dict[str, Any]] | None = None,
        recovered: bool = False,
    ) -> None:
        del existing_candidates, recovered
        strategy: dict[str, Any] | None = None
        try:
            strategy = self.get_strategy_detail(strategy_id)
            request_payload = deepcopy(dict(payload))
            request_payload["search_space"] = self._normalize_optimization_search_space(strategy, request_payload)
            request_payload.update(_normalize_optimization_constraints_payload(request_payload))
            base_snapshot, source_run = self._optimization_base_snapshot(strategy, request_payload)
            search_space = list(request_payload.get("search_space") or [])
            requested_budget = _as_int(request_payload.get("budget_combinations"), 0)
            budget_combinations = requested_budget if requested_budget > 0 else max(1, len(search_space) or 1)
            planned_snapshots = self._plan_optimization_search_snapshots(base_snapshot, search_space, budget_combinations)
            if not planned_snapshots:
                planned_snapshots = [dict(base_snapshot)]
            budget_combinations = min(max(1, budget_combinations), len(planned_snapshots))
            planned_snapshots = planned_snapshots[:budget_combinations]
            persisted_trials = {
                trial["trial_index"]: trial
                for trial in self._load_optimization_trials(
                    job_id,
                    include_chart_series=False,
                    include_metrics_json=False,
                )
            }
            pending_evaluations = [
                (trial_index, parameter_snapshot)
                for trial_index, parameter_snapshot in enumerate(planned_snapshots, start=1)
                if trial_index not in persisted_trials
            ]
            planned_evaluations = pending_evaluations
            evaluation_request = self._build_optimization_evaluation_request(strategy, source_run=source_run)
            self._ensure_optimization_snapshots_ready(
                job_id=job_id,
                created_at=created_at,
                strategy=strategy,
                payload=request_payload,
                evaluation_request=evaluation_request,
                parameter_snapshot=base_snapshot,
            )
            runtime_state = self._optimization_runtime_state(
                search_space,
                request_payload.get("objective"),
            )
            self._optimization_runtime_seed(runtime_state, list(persisted_trials.values()))

            def ensure_runner_claim() -> None:
                if not self._refresh_optimization_runner_claim(job_id):
                    raise _OptimizationRunnerClaimLost(job_id)

            if len(persisted_trials) >= budget_combinations:
                final_trials = self._backfill_optimization_top_trial_chart_series(
                    job_id,
                    strategy,
                    evaluation_request,
                    request_payload,
                    list(persisted_trials.values()),
                )
                successful_trials = [trial for trial in final_trials if str(trial.get("status") or "").upper() == "SUCCEEDED"]
                best_summary = self._optimization_runtime_best_summary(runtime_state) or self._best_optimization_trial_summary(
                    final_trials,
                    request_payload.get("objective"),
                )
                final_status = "COMPLETED" if len(successful_trials) == len(final_trials) else "PARTIALLY_FAILED" if successful_trials else "FAILED"
                heatmap_trials = self._optimization_heatmap_trials_from_summary(
                    self._optimization_runtime_heatmap_summary(runtime_state)
                )
                if not heatmap_trials:
                    heatmap_trials = [dict(trial) for trial in successful_trials]
                final_candidates, _ = self._build_optimization_candidates_from_trial_pool(
                    job_id=job_id,
                    strategy=strategy,
                    payload={
                        **request_payload,
                        "best_metrics_summary": best_summary,
                        "completed_combinations": len(final_trials),
                        "persisted_trial_count": len(final_trials),
                        "next_trial_index": len(final_trials) + 1,
                        "resume_ready": False,
                    },
                    trials=successful_trials,
                    heatmap_trials=heatmap_trials,
                )
                matching_combinations = (
                    self._build_optimization_matching_combination_candidates(
                        strategy=strategy,
                        payload={
                            **request_payload,
                            "objective": request_payload.get("objective"),
                        },
                        trials=successful_trials,
                    )
                )
                ensure_runner_claim()
                self._persist_optimization_job(
                    job_id,
                    strategy_id,
                    {
                        **request_payload,
                        "status": final_status,
                        "progress_pct": 100,
                        "completed_combinations": len(final_trials),
                        "persisted_trial_count": len(final_trials),
                        "next_trial_index": len(final_trials) + 1,
                        "resume_ready": False,
                        "interrupted_reason": None,
                        "best_metrics_summary": best_summary,
                        "current_stage": "Result ready" if final_status == "COMPLETED" else "Partial result ready" if final_status == "PARTIALLY_FAILED" else "Failed",
                        "latest_update": "Optimization completed." if final_status == "COMPLETED" else "Optimization finished with partial failures." if final_status == "PARTIALLY_FAILED" else "Optimization failed.",
                        "latest_candidate_label": best_summary.get("label") if best_summary else None,
                        "matching_combination_count": len(matching_combinations),
                        "matching_combinations": matching_combinations,
                        "matching_combination_source": "all_trials",
                    },
                    final_candidates,
                    created_at=created_at,
                    updated_at=iso_now(),
                    completed_at=iso_now(),
                )
                return

            delay_seconds = self._optimization_step_delay_seconds()
            completed_count = len(persisted_trials)
            best_summary = self._optimization_runtime_best_summary(runtime_state)
            next_trial_index = planned_evaluations[0][0] if planned_evaluations else completed_count + 1
            trial_records = dict(persisted_trials)
            failures = 0
            last_progress_persisted_at = time.monotonic()
            last_progress_persisted_count = completed_count

            def publish_progress(
                *,
                completed_combinations: int,
                best_metrics_summary: Mapping[str, Any] | None,
                next_trial_index: int,
                current_stage: str,
                latest_update: str,
                force: bool = False,
            ) -> None:
                nonlocal last_progress_persisted_at, last_progress_persisted_count
                now_monotonic = time.monotonic()
                if not force and completed_combinations < budget_combinations:
                    if (
                        completed_combinations - last_progress_persisted_count < 5
                        and now_monotonic - last_progress_persisted_at < 1.0
                    ):
                        return
                eta_projection = self._optimization_eta_projection(
                    list(trial_records.values()),
                    budget_combinations=budget_combinations,
                    completed_combinations=completed_combinations,
                )
                ensure_runner_claim()
                heartbeat_at = self._optimization_timestamp_now()
                self._persist_optimization_job(
                    job_id,
                    strategy_id,
                    {
                        **request_payload,
                        "status": "RUNNING",
                        "progress_pct": round(completed_combinations / budget_combinations * 100) if budget_combinations else 0,
                        "completed_combinations": completed_combinations,
                        "persisted_trial_count": completed_combinations,
                        "next_trial_index": next_trial_index,
                        "resume_ready": False,
                        "interrupted_reason": None,
                        "best_metrics_summary": best_metrics_summary,
                        "current_stage": current_stage,
                        "latest_update": latest_update,
                        "latest_candidate_label": _as_mapping(best_metrics_summary).get("label") if best_metrics_summary else None,
                        "estimated_remaining_minutes": eta_projection.get("estimated_remaining_minutes"),
                        "estimated_completed_at": eta_projection.get("estimated_completed_at"),
                        "heartbeat_at": heartbeat_at,
                    },
                    [],
                    created_at=created_at,
                    updated_at=heartbeat_at,
                    completed_at=None,
                )
                last_progress_persisted_at = now_monotonic
                last_progress_persisted_count = completed_combinations

            publish_progress(
                completed_combinations=completed_count,
                best_metrics_summary=best_summary,
                next_trial_index=next_trial_index,
                current_stage=f"Running trial {next_trial_index}/{budget_combinations}",
                latest_update=f"Evaluating trial {next_trial_index}/{budget_combinations}.",
                force=True,
            )

            remaining_evaluations = [
                (int(trial_index), dict(parameter_snapshot))
                for trial_index, parameter_snapshot in planned_evaluations
            ]
            if self._optimization_can_use_parallel_controller(planned_evaluations):
                fallback_reason: str | None = None
                try:
                    trial_records, parallel_failures, remaining_evaluations, fallback_reason = (
                        self._run_parallel_optimization_trials(
                            job_id=job_id,
                            request_payload=request_payload,
                            pending_evaluations=remaining_evaluations,
                            trial_records=trial_records,
                            budget_combinations=budget_combinations,
                            runtime_state=runtime_state,
                            publish_progress=lambda **kwargs: publish_progress(
                                completed_combinations=int(kwargs["completed_count"]),
                                best_metrics_summary=kwargs["best_summary"],
                                next_trial_index=int(kwargs["next_trial_index"]),
                                current_stage=str(kwargs["current_stage"]),
                                latest_update=str(kwargs["latest_update"]),
                                force=bool(kwargs.get("force", False)),
                            ),
                        )
                    )
                    failures += parallel_failures
                except Exception as exc:
                    fallback_reason = (
                        "Parallel optimization controller failed. "
                        f"Continuing with single-worker mode: {str(exc).strip() or exc.__class__.__name__}"
                    )
                    remaining_evaluations = [
                        (trial_index, dict(parameter_snapshot))
                        for trial_index, parameter_snapshot in planned_evaluations
                        if trial_index not in trial_records
                    ]
                if fallback_reason and remaining_evaluations:
                    best_summary = self._optimization_runtime_best_summary(runtime_state)
                    next_trial_index = remaining_evaluations[0][0]
                    publish_progress(
                        completed_combinations=len(trial_records),
                        best_metrics_summary=best_summary,
                        next_trial_index=next_trial_index,
                        current_stage=f"Continuing sequentially at trial {next_trial_index}/{budget_combinations}",
                        latest_update=fallback_reason,
                        force=True,
                    )

            if remaining_evaluations:
                trial_records, sequential_failures = self._run_sequential_optimization_trials(
                    job_id=job_id,
                    strategy=strategy,
                    evaluation_request=evaluation_request,
                    request_payload=request_payload,
                    pending_evaluations=remaining_evaluations,
                    trial_records=trial_records,
                    budget_combinations=budget_combinations,
                    publish_progress=lambda **kwargs: publish_progress(
                        completed_combinations=int(kwargs["completed_count"]),
                        best_metrics_summary=kwargs["best_summary"],
                        next_trial_index=int(kwargs["next_trial_index"]),
                        current_stage=str(kwargs["current_stage"]),
                        latest_update=str(kwargs["latest_update"]),
                        force=bool(kwargs.get("force", False)),
                    ),
                    delay_seconds=delay_seconds,
                    runtime_state=runtime_state,
                )
                failures += sequential_failures

            final_trials = self._backfill_optimization_top_trial_chart_series(
                job_id,
                strategy,
                evaluation_request,
                request_payload,
                list(trial_records.values()),
            )
            completed_count = len(final_trials)
            successful_trials = [trial for trial in final_trials if str(trial.get("status") or "").upper() == "SUCCEEDED"]
            best_summary = self._optimization_runtime_best_summary(runtime_state) or self._best_optimization_trial_summary(
                final_trials,
                request_payload.get("objective"),
            )
            final_status = "COMPLETED" if len(successful_trials) == len(final_trials) and failures == 0 else "PARTIALLY_FAILED" if successful_trials else "FAILED"
            heatmap_trials = self._optimization_heatmap_trials_from_summary(
                self._optimization_runtime_heatmap_summary(runtime_state)
            )
            if not heatmap_trials:
                heatmap_trials = [dict(trial) for trial in successful_trials]
            final_candidates, _ = self._build_optimization_candidates_from_trial_pool(
                job_id=job_id,
                strategy=strategy,
                payload={
                    **request_payload,
                    "best_metrics_summary": best_summary,
                    "completed_combinations": completed_count,
                    "persisted_trial_count": completed_count,
                    "next_trial_index": completed_count + 1,
                    "resume_ready": False,
                },
                trials=successful_trials,
                heatmap_trials=heatmap_trials,
            )
            matching_combinations = (
                self._build_optimization_matching_combination_candidates(
                    strategy=strategy,
                    payload={
                        **request_payload,
                        "objective": request_payload.get("objective"),
                    },
                    trials=successful_trials,
                )
            )
            ensure_runner_claim()
            self._persist_optimization_job(
                job_id,
                strategy_id,
                {
                    **request_payload,
                    "status": final_status,
                    "progress_pct": 100,
                    "completed_combinations": completed_count,
                    "persisted_trial_count": completed_count,
                    "next_trial_index": completed_count + 1,
                    "resume_ready": False,
                    "interrupted_reason": None,
                    "best_metrics_summary": best_summary,
                    "current_stage": "Result ready" if final_status == "COMPLETED" else "Partial result ready" if final_status == "PARTIALLY_FAILED" else "Failed",
                    "latest_update": "Optimization completed." if final_status == "COMPLETED" else "Optimization finished with partial failures." if final_status == "PARTIALLY_FAILED" else "Optimization failed.",
                    "latest_candidate_label": best_summary.get("label") if best_summary else None,
                    "matching_combination_count": len(matching_combinations),
                    "matching_combinations": matching_combinations,
                    "matching_combination_source": "all_trials",
                },
                final_candidates,
                created_at=created_at,
                updated_at=iso_now(),
                completed_at=iso_now(),
            )
            return
        except _OptimizationRunnerClaimLost:
            return
        except Exception as exc:
            failed_at = iso_now()
            failed_trials = self._load_optimization_trials(job_id, include_chart_series=False)
            best_summary = self._best_optimization_trial_summary(
                failed_trials,
                request_payload.get("objective"),
            )
            successful_trials = [trial for trial in failed_trials if str(trial.get("status") or "").upper() == "SUCCEEDED"]
            if not self._refresh_optimization_runner_claim(job_id):
                return
            if strategy is None:
                strategy = self.get_strategy_detail(strategy_id)
            failure_candidates, _ = self._build_optimization_candidates_from_trial_pool(
                job_id=job_id,
                strategy=strategy,
                payload={
                    **dict(payload),
                    "best_metrics_summary": best_summary,
                },
                trials=successful_trials,
            )
            self._persist_optimization_job(
                job_id,
                strategy_id,
                {
                    **dict(payload),
                    "status": "FAILED",
                    "progress_pct": 100,
                    "completed_combinations": len(failed_trials),
                    "persisted_trial_count": len(failed_trials),
                    "next_trial_index": len(failed_trials) + 1,
                    "resume_ready": False,
                    "interrupted_reason": None,
                    "best_metrics_summary": best_summary,
                    "current_stage": "Failed",
                    "latest_update": f"Optimization failed: {str(exc).strip() or exc.__class__.__name__}",
                    "latest_candidate_label": best_summary.get("label") if best_summary else None,
                },
                failure_candidates,
                created_at=created_at,
                updated_at=failed_at,
                completed_at=failed_at,
            )

    def _list_incomplete_optimization_job_rows(self) -> list[Mapping[str, Any]]:
        return self.storage.fetch_all(
            """
            SELECT *
            FROM optimization_jobs
            WHERE status IN (?, ?)
              AND deleted_at IS NULL
            ORDER BY created_at ASC, id ASC
            """,
            ("QUEUED", "RUNNING"),
        )

    def interrupt_incomplete_optimization_jobs(self) -> list[str]:
        rows = self._list_incomplete_optimization_job_rows()
        interrupted_job_ids: list[str] = []
        for row in rows:
            hydrated_job = self._hydrate_optimization_job(row)
            job_id = str(hydrated_job.get("id") or "").strip()
            strategy_id = str(hydrated_job.get("strategy_id") or "").strip()
            if not job_id or not strategy_id:
                continue
            request_payload = dict(hydrated_job.get("request") or {})
            summary = dict(hydrated_job.get("summary") or {})
            interrupted_at = iso_now()
            budget_combinations = _as_int(
                summary.get("budget_combinations"),
                _as_int(request_payload.get("budget_combinations"), 0),
            )
            completed_combinations = _as_int(
                summary.get("completed_combinations"),
                _as_int(request_payload.get("completed_combinations"), 0),
            )
            persisted_trial_count = max(
                completed_combinations,
                _as_int(
                    summary.get("persisted_trial_count"),
                    _as_int(request_payload.get("persisted_trial_count"), completed_combinations),
                ),
            )
            next_trial_index = max(
                1,
                _as_int(
                    summary.get("next_trial_index"),
                    _as_int(request_payload.get("next_trial_index"), persisted_trial_count + 1),
                ),
            )
            interrupted_payload = {
                **request_payload,
                "status": "INTERRUPTED",
                "progress_pct": _as_int(
                    summary.get("progress_pct"),
                    _as_int(request_payload.get("progress_pct"), 0),
                ),
                "completed_combinations": completed_combinations,
                "persisted_trial_count": persisted_trial_count,
                "next_trial_index": next_trial_index,
                "current_stage": None,
                "latest_update": None,
                "resume_ready": True,
                "interrupted_reason": "service_restart",
            }
            if budget_combinations > 0:
                interrupted_payload["budget_combinations"] = budget_combinations
            if summary.get("best_metrics_summary") is not None:
                interrupted_payload["best_metrics_summary"] = summary.get("best_metrics_summary")
            if summary.get("latest_candidate_label") is not None:
                interrupted_payload["latest_candidate_label"] = summary.get("latest_candidate_label")
            self._persist_optimization_job(
                job_id,
                strategy_id,
                interrupted_payload,
                list(loads(row.get("candidates_json"), [])),
                created_at=str(row.get("created_at") or interrupted_at),
                updated_at=interrupted_at,
                completed_at=None,
            )
            self._clear_optimization_runner_claim(job_id)
            interrupted_job_ids.append(job_id)
        return interrupted_job_ids

    def resume_incomplete_optimization_jobs(self) -> list[str]:
        rows = self._list_incomplete_optimization_job_rows()
        resumed_job_ids: list[str] = []
        for row in rows:
            job_id = str(row.get("id") or "").strip()
            strategy_id = str(row.get("strategy_id") or "").strip()
            if not job_id or not strategy_id:
                continue
            payload = loads(row.get("request_json"), {})
            if not payload:
                continue
            payload.setdefault("status", str(row.get("status") or "QUEUED").upper())
            payload.setdefault("progress_pct", 0)
            payload.setdefault("completed_combinations", 0)
            payload.setdefault("current_stage", "任务已暂停")
            payload.setdefault("latest_update", "已保留优化进度，可在恢复后继续执行剩余组合。")
            payload.update(_normalize_optimization_constraints_payload(payload))
            existing_candidates = list(loads(row.get("candidates_json"), []))
            if not self._try_acquire_optimization_runner_claim(job_id):
                continue
            resumed_at = iso_now()
            try:
                self._persist_optimization_job(
                    job_id,
                    strategy_id,
                    self._build_optimization_progress_payload(
                        payload,
                        status=str(payload.get("status") or "QUEUED").upper(),
                        progress_pct=_as_int(payload.get("progress_pct"), 0),
                        completed_combinations=_as_int(payload.get("completed_combinations"), 0),
                        current_stage=str(payload.get("current_stage") or "任务已暂停"),
                        latest_update=str(payload.get("latest_update") or "已保留优化进度，可在恢复后继续执行剩余组合。"),
                        latest_candidate_label=(
                            str(existing_candidates[0].get("label") or "").strip()
                            if existing_candidates
                            else None
                        ),
                    ),
                    existing_candidates,
                    created_at=str(row.get("created_at") or resumed_at),
                    updated_at=resumed_at,
                    completed_at=None,
                )
                started = self._start_optimization_job_runner(
                    job_id,
                    strategy_id,
                    payload,
                    created_at=str(row.get("created_at") or iso_now()),
                    existing_candidates=existing_candidates,
                    recovered=True,
                    claim_acquired=True,
                )
            except Exception:
                self._release_optimization_runner_claim(job_id)
                raise
            if started:
                resumed_job_ids.append(job_id)
            else:
                self._release_optimization_runner_claim(job_id)
        return resumed_job_ids

    def resume_optimization_job(self, job_id: str, request: Any) -> dict[str, Any]:
        payload = _as_mapping(request)
        idempotency_key = str(payload.get("idempotency_key") or "").strip()
        if not idempotency_key:
            raise ValueError("idempotency_key is required")

        job = self.get_optimization_job_detail(job_id)
        status = str(job.get("status") or "").upper()
        request_payload = dict(job.get("request") or {})
        existing_resume_key = str(request_payload.get("resume_idempotency_key") or "").strip()
        if existing_resume_key and status in {"QUEUED", "RUNNING"}:
            if existing_resume_key == idempotency_key:
                return job
            raise ContractConflictError(
                "OPTIMIZATION_JOB_RESUME_IDEMPOTENCY_CONFLICT",
                "Optimization job was already resumed with a different idempotency key",
                blocking_target={"job_id": job_id},
            )
        if status != "INTERRUPTED":
            raise ContractConflictError(
                "OPTIMIZATION_JOB_NOT_RESUMABLE",
                "Only interrupted optimization jobs can be resumed",
                blocking_target={"job_id": job_id},
            )

        progress_snapshot = self._optimization_trial_progress_snapshot(
            job_id,
            str(job.get("updated_at") or ""),
        )
        summary = _as_mapping(job.get("summary"))
        budget_value = _as_int(
            summary.get("budget_combinations"),
            _as_int(request_payload.get("budget_combinations"), 1),
        )
        completed_combinations = max(
            _as_int(summary.get("completed_combinations"), 0),
            _as_int(progress_snapshot.get("completed_combinations"), 0),
        )
        persisted_trial_count = max(
            _as_int(summary.get("persisted_trial_count"), completed_combinations),
            _as_int(progress_snapshot.get("persisted_trial_count"), completed_combinations),
        )
        next_trial_index = max(
            1,
            _as_int(summary.get("next_trial_index"), completed_combinations + 1),
            _as_int(progress_snapshot.get("next_trial_index"), completed_combinations + 1),
        )
        progress_pct = _as_int(summary.get("progress_pct"), 0)
        if budget_value > 0:
            progress_pct = min(
                100,
                max(0, int(round((completed_combinations / budget_value) * 100))),
            )

        request_payload["resume_idempotency_key"] = idempotency_key
        request_payload["status"] = "RUNNING"
        request_payload["resume_ready"] = False
        request_payload["interrupted_reason"] = None
        request_payload["completed_combinations"] = completed_combinations
        request_payload["persisted_trial_count"] = persisted_trial_count
        request_payload["next_trial_index"] = next_trial_index
        request_payload["progress_pct"] = progress_pct
        request_payload["current_stage"] = f"Preparing trial {next_trial_index}/{budget_value}"
        request_payload["latest_update"] = f"Resuming optimization from trial {next_trial_index}."
        request_payload["estimated_remaining_minutes"] = None
        request_payload["estimated_completed_at"] = None
        request_payload["heartbeat_at"] = iso_now()
        request_payload.update(_normalize_optimization_constraints_payload(request_payload))

        now = iso_now()
        self._persist_optimization_job(
            job_id,
            str(job["strategy_id"]),
            request_payload,
            [],
            created_at=str(job.get("created_at") or now),
            updated_at=now,
            completed_at=None,
        )
        started = self._start_optimization_job_runner(
            job_id,
            str(job["strategy_id"]),
            request_payload,
            created_at=str(job.get("created_at") or now),
            recovered=True,
        )
        if not started:
            interrupted_payload = {
                **request_payload,
                "status": "INTERRUPTED",
                "resume_ready": True,
                "interrupted_reason": summary.get("interrupted_reason") or "service_restart",
                "current_stage": None,
                "latest_update": None,
                "estimated_remaining_minutes": None,
                "estimated_completed_at": None,
            }
            self._persist_optimization_job(
                job_id,
                str(job["strategy_id"]),
                interrupted_payload,
                [],
                created_at=str(job.get("created_at") or now),
                updated_at=iso_now(),
                completed_at=None,
            )
            raise ContractConflictError(
                "OPTIMIZATION_JOB_RESUME_START_FAILED",
                "Optimization job could not be resumed because another runner is still active",
                blocking_target={"job_id": job_id},
            )
        return self.get_optimization_job_detail(job_id)

    def _optimization_base_snapshot(
        self,
        strategy: Mapping[str, Any],
        payload: Mapping[str, Any],
    ) -> tuple[dict[str, Any], dict[str, Any] | None]:
        source_run_id = str(payload.get("source_run_id") or "").strip()
        source_run: dict[str, Any] | None = None
        if source_run_id:
            row = self.storage.fetch_one(
                """
                SELECT id, strategy_id, start_date, end_date, parameter_snapshot_json, request_json
                FROM backtest_runs
                WHERE id = ? AND deleted_at IS NULL
                """,
                (source_run_id,),
            )
            if row:
                if str(row.get("strategy_id") or "") != str(strategy.get("id") or ""):
                    raise ValueError("source_run_id does not belong to the selected strategy")
                source_run = self._normalized_optimization_source_run(
                    {
                        "id": row["id"],
                        "strategy_id": row["strategy_id"],
                        "start_date": row.get("start_date"),
                        "end_date": row.get("end_date"),
                        "parameter_snapshot": loads(row.get("parameter_snapshot_json"), {}),
                        "request": loads(row.get("request_json"), {}),
                    }
                )
        base_snapshot = dict((source_run or {}).get("parameter_snapshot") or {})
        if not base_snapshot:
            base_snapshot = self._parameter_snapshot_for_version(strategy, payload.get("base_parameter_version_id"))
        if not base_snapshot:
            base_snapshot = dict(strategy.get("parameters") or {})
        return base_snapshot, source_run

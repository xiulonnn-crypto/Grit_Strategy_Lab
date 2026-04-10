from __future__ import annotations

from copy import deepcopy
from itertools import product
import math
import os
import shutil
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping
from uuid import uuid4

from .backtest_metrics import build_consistency_score
from .creation_templates import STRATEGY_TEMPLATES, DEFAULT_ALLOWED_ACTIONS, STRATEGY_TYPE_TITLES, blank_confirmation_fields, build_confirmation
from .storage import SQLiteStorage, dumps, iso_now, is_snapshot_blocking, loads, utc_now


OPTIMIZATION_SELECTION_KEYS: dict[str, tuple[str, ...]] = {
    "GRID": ("initial_position", "grid_interval", "buy_size_pct", "sell_step_pct", "sell_size_pct"),
    "BUY_AND_HOLD": ("contribution_amount", "investment_frequency"),
    "MOMENTUM": ("lookback_months", "skip_recent_months", "top_n", "hold_rank_threshold", "weighting_method"),
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
    "rebalance_frequency",
}

LEGACY_MOCK_OPTIMIZATION_LABELS = (
    "稳定策略中心",
    "防守优先级",
    "收益增益版",
    "边界试验版",
)


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
    if strategy_type == "GRID":
        bits: list[str] = []
        if universe_name:
            bits.append(f"围绕{universe_name}执行网格交易")
        else:
            bits.append("执行网格交易")
        initial_position = _format_strategy_value(parameters.get("initial_position"))
        if initial_position:
            bits.append(f"初始仓位{initial_position}%")
        grid_interval = _format_strategy_value(parameters.get("grid_interval"))
        buy_size_pct = _format_strategy_value(parameters.get("buy_size_pct"))
        if grid_interval and buy_size_pct:
            bits.append(f"每下跌{grid_interval}%买入{buy_size_pct}%")
        sell_step_pct = _format_strategy_value(parameters.get("sell_step_pct"))
        sell_size_pct = _format_strategy_value(parameters.get("sell_size_pct"))
        if sell_step_pct and sell_size_pct:
            bits.append(f"每上涨{sell_step_pct}%卖出{sell_size_pct}%")
        return "，".join(bit for bit in bits if bit) + "。" if bits else (fallback or None)

    if strategy_type == "BUY_AND_HOLD":
        frequency_map = {
            "daily": "每日",
            "weekly": "每周",
            "monthly": "每月",
            "quarterly": "每季",
            "yearly": "每年",
        }
        investment_frequency = frequency_map.get(
            _format_strategy_value(parameters.get("investment_frequency")).lower(),
            "定期",
        )
        amount = _format_strategy_value(parameters.get("contribution_amount"))
        if universe_name and amount:
            return f"围绕{universe_name}执行{investment_frequency}定投，每期买入{amount}USD。"
        if universe_name:
            return f"围绕{universe_name}执行{investment_frequency}定投。"
        return fallback or None

    if strategy_type == "MOMENTUM":
        bits: list[str] = []
        if universe_name:
            bits.append(f"在{universe_name}中执行动量轮动")
        else:
            bits.append("执行动量轮动")
        rebalance = _format_strategy_value(top_level.get("rebalance_frequency"))
        rebalance_label = {
            "monthly": "每月",
            "quarterly": "每季度",
            "semiannual": "每半年",
            "yearly": "每年",
        }.get(rebalance.lower(), "")
        if rebalance_label:
            bits.append(f"按{rebalance_label}调仓")
        lookback = _format_strategy_value(parameters.get("lookback_months"))
        skip_recent = _format_strategy_value(parameters.get("skip_recent_months"))
        if lookback and skip_recent:
            bits.append(f"回看{lookback}个月并跳过最近{skip_recent}个月")
        top_n = _format_strategy_value(parameters.get("top_n"))
        hold_rank = _format_strategy_value(parameters.get("hold_rank_threshold"))
        if top_n and hold_rank:
            bits.append(f"买入前{top_n}名并保留前{hold_rank}名")
        weighting = _format_strategy_value(parameters.get("weighting_method")).lower()
        if weighting == "equal_weight":
            bits.append("持仓按数量等权分配")
        capital = _format_strategy_value(parameters.get("capital"))
        if capital:
            bits.append(f"初始资金{capital}USD")
        return "，".join(bit for bit in bits if bit) + "。" if bits else (fallback or None)

    if strategy_type == "MEAN_REVERSION":
        timeframe_label = {
            "daily": "日线",
            "weekly": "周线",
            "hourly": "小时线",
        }.get(_format_strategy_value(parameters.get("observation_timeframe")).lower(), "")
        target = f"{universe_name}{timeframe_label}" if universe_name and timeframe_label else universe_name or timeframe_label
        indicator_bits: list[str] = []
        bollinger_period = _format_strategy_value(parameters.get("bollinger_period"))
        if bollinger_period:
            indicator_bits.append(f"{bollinger_period}日布林带")
        rsi_period = _format_strategy_value(parameters.get("rsi_period"))
        if rsi_period:
            indicator_bits.append(f"RSI({rsi_period})")
        atr_period = _format_strategy_value(parameters.get("atr_period"))
        if atr_period:
            indicator_bits.append(f"ATR({atr_period})")
        risk_bits: list[str] = []
        take_profit_atr = _format_strategy_value(parameters.get("take_profit_atr"))
        if take_profit_atr:
            risk_bits.append(f"{take_profit_atr}倍ATR止盈")
        stop_loss_atr = _format_strategy_value(parameters.get("stop_loss_atr"))
        if stop_loss_atr:
            risk_bits.append(f"{stop_loss_atr}倍ATR止损")
        segments: list[str] = []
        if target:
            segments.append(f"观察{target}")
        if indicator_bits:
            segments.append(f"使用{'、'.join(indicator_bits)}识别超买超卖与动态风控")
        if risk_bits:
            segments.append("，".join(risk_bits))
        if segments:
            return "，".join(segments) + "。"
        logic = _format_strategy_value(parameters.get("trading_logic"))
        if logic:
            return logic.rstrip("。；") + "。"
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

    universe_name = _format_strategy_value(top_level.get("universe_name") or parameters.get("universe_name"))
    timeframe_label = {
        "daily": "日线",
        "weekly": "周线",
        "hourly": "小时线",
    }.get(_format_strategy_value(parameters.get("observation_timeframe")).lower(), "")
    target = f"{universe_name}{timeframe_label}" if universe_name and timeframe_label else universe_name or timeframe_label or "目标标的"

    segments: list[str] = [f"观察{target}"]
    indicator_bits: list[str] = []
    bollinger_period = _format_strategy_value(parameters.get("bollinger_period"))
    if bollinger_period:
        indicator_bits.append(f"{bollinger_period}日布林带")
    rsi_period = _format_strategy_value(parameters.get("rsi_period"))
    if rsi_period:
        indicator_bits.append(f"RSI({rsi_period})")
    atr_period = _format_strategy_value(parameters.get("atr_period"))
    if atr_period:
        indicator_bits.append(f"ATR({atr_period})")
    if indicator_bits:
        segments.append(f"通过{' + '.join(indicator_bits)}识别超买超卖与动态风控")

    entry_bits: list[str] = []
    long_entry_size_pct = _format_strategy_value(parameters.get("long_entry_size_pct"))
    rsi_buy_threshold = _format_strategy_value(parameters.get("rsi_buy_threshold"))
    if long_entry_size_pct:
        buy_trigger = "跌破布林带下轨"
        if rsi_period and rsi_buy_threshold:
            buy_trigger += f"且RSI({rsi_period})<{rsi_buy_threshold}"
        entry_bits.append(f"{buy_trigger}时买入{long_entry_size_pct}%")

    short_entry_size_pct = _format_strategy_value(parameters.get("short_entry_size_pct"))
    rsi_sell_threshold = _format_strategy_value(parameters.get("rsi_sell_threshold"))
    if short_entry_size_pct:
        sell_trigger = "突破布林带上轨"
        if rsi_period and rsi_sell_threshold:
            sell_trigger += f"且RSI({rsi_period})>{rsi_sell_threshold}"
        entry_bits.append(f"{sell_trigger}时卖出{short_entry_size_pct}%")
    if entry_bits:
        segments.append("；".join(entry_bits))

    exit_bits: list[str] = []
    take_profit_atr = _format_strategy_value(parameters.get("take_profit_atr"))
    if take_profit_atr:
        exit_bits.append(f"{take_profit_atr}倍ATR止盈")
    stop_loss_atr = _format_strategy_value(parameters.get("stop_loss_atr"))
    if stop_loss_atr:
        exit_bits.append(f"{stop_loss_atr}倍ATR止损")
    if exit_bits:
        segments.append("，".join(exit_bits))

    return "；".join(segment for segment in segments if segment) if segments else (fallback or None)


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
                _upsert_field(parameter_entries, "strategy_description", "策略描述", description, "system_inference")
            trading_logic = _summarize_revision_trading_logic(
                strategy_type,
                repaired["top_level"],
                parameters,
                fallback=_format_strategy_value(parameters.get("trading_logic")) or None,
            )
            if trading_logic:
                _upsert_field(parameter_entries, "trading_logic", "交易逻辑", trading_logic, "system_inference")

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

    def _decode_run_row(self, row: Mapping[str, Any]) -> dict[str, Any]:
        run = dict(row)
        for column in [
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
            "trade_audit_json",
        ]:
            decoded_name = column.removesuffix("_json")
            default: Any = [] if decoded_name in {
                "warnings",
                "drawdown_events",
                "rolling_metrics",
                "monthly_returns",
                "chart_series",
                "trades",
                "artifact_paths",
                "trade_audit",
            } else {}
            run[decoded_name] = loads(run.pop(column, None), default)
        run["is_permanent"] = bool(int(run.get("is_permanent") or 0))
        return run

    def _decode_run_list_row(self, row: Mapping[str, Any]) -> dict[str, Any]:
        preview = loads(row.get("preview_json"), {})
        if not isinstance(preview, dict):
            preview = {}
        metrics = loads(row.get("metrics_json"), {})
        if not isinstance(metrics, dict):
            metrics = {}
        warnings = loads(row.get("warnings_json"), [])
        if not isinstance(warnings, list):
            warnings = []

        return {
            "id": row["id"],
            "strategy_id": row["strategy_id"],
            "strategy_name": row.get("strategy_name"),
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
                "parameter_version_id": preview.get("parameter_version_id"),
            },
            "data_segment_type": preview.get("data_segment_type"),
            "parameter_version_id": preview.get("parameter_version_id"),
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
        candidate_label = label.strip() if isinstance(label, str) and label.strip() else f"Candidate {candidate_rank}"
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
        return {
            "id": str(candidate.get("id") or self._new_id("trial")),
            "label": str(candidate.get("label") or f"Candidate {rank}"),
            "summary": candidate.get("summary"),
            "status": str(candidate.get("status") or "SUCCEEDED"),
            "rank": int(candidate.get("rank") or rank),
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
            "analysis": dict(candidate.get("analysis") or {}),
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
                mode = str(entry.get("mode") or "fixed")
                normalized_entries.append(
                    {
                        "key": key,
                        "label": str(entry.get("label") or key),
                        "mode": "range" if mode == "range" else "fixed",
                        "current": entry.get("current"),
                        "start": entry.get("start", entry.get("value")),
                        "end": entry.get("end", entry.get("value")),
                        "step": entry.get("step"),
                        "value": entry.get("value", entry.get("current")),
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
                    "tag": "核心参数" if index == 0 else "验证参数",
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
                        "tag": "当前固定",
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
                    "tag": "当前固定",
                }
            )
            if len(search_space) >= 4:
                break
        return search_space

    def _build_optimization_heatmap(
        self,
        search_space: list[dict[str, Any]],
        focus: Mapping[str, Any],
        score: float,
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
                intensity = round(score - abs(x_value - focus_x) * 0.03 - abs(y_value - focus_y) * 0.02, 3)
                cells.append(
                    {
                        "x": x_value,
                        "y": y_value,
                        "score": intensity,
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
        max_drawdown_pct = _as_float(metrics.get("max_drawdown_pct"), 0.0)
        stability = _as_float(metrics.get("stability"), 0.0)
        promote_ready = verdict_label == "可晋升"
        checks = [
            {
                "key": "return_sharpe",
                "label": "收益夏普",
                "value": round(return_sharpe, 2),
                "verdict": "pass" if return_sharpe >= 1.0 else "watch",
                "detail": "收益表现进入稳定比较区间。" if return_sharpe >= 1.0 else "收益仍需继续观察。",
            },
            {
                "key": "out_of_sample_sharpe",
                "label": "样本外夏普",
                "value": round(out_of_sample_sharpe, 2),
                "verdict": "pass" if out_of_sample_sharpe >= 0.9 else "watch",
                "detail": "样本外窗口表现稳定。" if out_of_sample_sharpe >= 0.9 else "样本外表现还不够稳。",
            },
            {
                "key": "max_drawdown_pct",
                "label": "最大回撤",
                "value": round(max_drawdown_pct, 1),
                "verdict": "pass" if max_drawdown_pct >= -30.0 else "risk",
                "detail": "回撤保持在护栏内。" if max_drawdown_pct >= -30.0 else "回撤已触及当前护栏边界。",
            },
            {
                "key": "stability",
                "label": "稳定性",
                "value": round(stability, 0),
                "verdict": "pass" if stability >= 80 else "watch" if stability >= 60 else "risk",
                "detail": "参数区间可复用。" if stability >= 80 else "参数区间仍需继续收敛。" if stability >= 60 else "参数区间不稳定。",
            },
        ]
        validation_windows = [
            {
                "label": "窗口 A",
                "return_sharpe": round(return_sharpe - 0.04, 2),
                "out_of_sample_sharpe": round(out_of_sample_sharpe - 0.03, 2),
                "max_drawdown_pct": round(max_drawdown_pct - 1.2, 1),
                "stability": max(0, round(stability - 4, 0)),
                "verdict": "pass" if promote_ready else "watch",
            },
            {
                "label": "窗口 B",
                "return_sharpe": round(return_sharpe, 2),
                "out_of_sample_sharpe": round(out_of_sample_sharpe, 2),
                "max_drawdown_pct": round(max_drawdown_pct, 1),
                "stability": round(stability, 0),
                "verdict": "pass" if promote_ready else "watch",
            },
            {
                "label": "窗口 C",
                "return_sharpe": round(return_sharpe - 0.09, 2),
                "out_of_sample_sharpe": round(out_of_sample_sharpe - 0.08, 2),
                "max_drawdown_pct": round(max_drawdown_pct - 1.8, 1),
                "stability": max(0, round(stability - 9, 0)),
                "verdict": "watch" if verdict_label != "不建议" else "risk",
            },
        ]
        return {
            "title": title,
            "thesis": thesis,
            "shelf_copy": thesis,
            "stability_verdict": verdict_label,
            "stability_summary": "当前候选可以进入版本晋升判断。"
            if promote_ready
            else "当前候选保留价值明确，但还需要继续验证。"
            if verdict_label == "观察中"
            else "当前候选只保留为边界参考，不建议继续推进。",
            "stability_checks": checks,
            "validation_windows": validation_windows,
            "heatmap": self._build_optimization_heatmap(search_space, parameter_snapshot, return_sharpe),
        }

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
                "title": "稳定策略中心",
                "label": "稳定策略中心",
                "summary": "收益、样本外和回撤同时收敛，可直接进入晋升判断。",
                "thesis": "收益与样本外表现同时抬升，回撤明显收敛，是当前最均衡的首选版本。",
                "status_label": "可晋升",
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
                "title": "防守优先级",
                "label": "防守优先级",
                "summary": "样本外最稳，适合作为首选的防守对照版本。",
                "thesis": "样本外窗口最稳、回撤最小，适合作为首选的防守对照版本。",
                "status_label": "可晋升",
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
                "title": "收益增益版",
                "label": "收益增益版",
                "summary": "收益弹性更强，但样本外和回撤已经逼近当前护栏。",
                "thesis": "收益继续抬升，但样本外稳定性和回撤开始逼近风险阈值，需要继续观察。",
                "status_label": "观察中",
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
                "title": "边界试验版",
                "label": "边界试验版",
                "summary": "收益最高，但稳定性明显失真，只保留作边界参考。",
                "thesis": "收益最高，但样本外稳定性明显失真，已经偏离当前稳定工作区。",
                "status_label": "不建议",
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

    def _optimization_base_snapshot(
        self,
        strategy: Mapping[str, Any],
        payload: Mapping[str, Any],
    ) -> tuple[dict[str, Any], dict[str, Any] | None]:
        source_run_id = str(payload.get("source_run_id") or "").strip()
        source_run = self.get_backtest_run_detail(source_run_id) if source_run_id else None
        if source_run and str(source_run.get("strategy_id") or "") != str(strategy.get("id") or ""):
            raise ValueError("source_run_id does not belong to the selected strategy")
        base_snapshot = dict((source_run or {}).get("parameter_snapshot") or {})
        if not base_snapshot:
            base_snapshot = self._parameter_snapshot_for_version(strategy, payload.get("base_parameter_version_id"))
        if not base_snapshot:
            base_snapshot = dict(strategy.get("parameters") or {})
        return base_snapshot, source_run

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
                current_stage="刷新快照",
                latest_update="优化前检测到快照未就绪，正在自动刷新数据。",
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
        request_payload = dict((source_run or {}).get("request") or {})
        if source_run:
            request_payload["source_run_id"] = source_run["id"]
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
        rows = [dict(item) for item in points if item]
        if not rows:
            return {
                "total_return": 0.0,
                "annualized_return": 0.0,
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
        max_drawdown_pct = min(float(row.get("drawdown") or 0.0) for row in rows)
        stability = max(0.0, min(100.0, _as_float(build_consistency_score(rows).get("score")) * 100.0))
        return {
            "total_return": total_return,
            "annualized_return": annualized_return,
            "sharpe": sharpe,
            "max_drawdown_pct": max_drawdown_pct,
            "stability": stability,
        }

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
            labels = ["窗口 A", "窗口 B", "窗口 C"]
            for index, label in enumerate(labels):
                start = index * window_size
                end = min(len(rows), start + window_size)
                if start >= len(rows):
                    break
                window_sets.append((label, rows[start:end]))
        elif in_sample and out_of_sample:
            window_sets = [("样本内", in_sample), ("样本外", out_of_sample), ("全样本", rows)]
        else:
            window_size = max(1, math.ceil(len(rows) / 3))
            labels = ["前段样本", "中段样本", "后段样本"]
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
            if metrics["sharpe"] >= 0.9 and metrics["max_drawdown_pct"] >= -25.0 and metrics["stability"] >= 60.0:
                verdict = "pass"
            elif metrics["sharpe"] >= 0.4 and metrics["max_drawdown_pct"] >= -35.0:
                verdict = "watch"
            windows.append(
                {
                    "label": label,
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
        preview_metrics = dict(preview.get("metrics") or {})
        full_window = self._build_optimization_window_metrics(chart_series)
        out_of_sample = [row for row in chart_series if bool(row.get("is_oos"))]
        if not out_of_sample and chart_series:
            tail = max(1, len(chart_series) // 3)
            out_of_sample = chart_series[-tail:]
        oos_window = self._build_optimization_window_metrics(out_of_sample)

        total_return = _as_float(preview_metrics.get("total_return"), full_window["total_return"])
        annualized_return = _as_float(preview_metrics.get("annualized_return"), _as_float(preview_metrics.get("cagr"), full_window["annualized_return"]))
        sharpe = _as_float(preview_metrics.get("sharpe"), full_window["sharpe"])
        out_of_sample_sharpe = _as_float(preview_metrics.get("oos_sharpe"), oos_window["sharpe"] if out_of_sample else sharpe)
        max_drawdown = _as_float(preview_metrics.get("max_drawdown"), full_window["max_drawdown_pct"] / 100.0)
        max_drawdown_pct = round(max_drawdown * 100.0, 1)
        stability = round(full_window["stability"], 0)

        return {
            **preview_metrics,
            "total_return": total_return,
            "total_return_pct": round(total_return * 100.0, 1),
            "cagr": _as_float(preview_metrics.get("cagr"), annualized_return),
            "annualized_return": annualized_return,
            "sharpe": sharpe,
            "return_sharpe": sharpe,
            "oos_sharpe": out_of_sample_sharpe,
            "out_of_sample_sharpe": out_of_sample_sharpe,
            "max_drawdown": max_drawdown,
            "max_drawdown_pct": max_drawdown_pct,
            "turnover": _as_float(preview_metrics.get("turnover")),
            "win_rate": _as_float(preview_metrics.get("win_rate")),
            "stability": stability,
        }

    def _score_optimization_metrics(self, metrics: Mapping[str, Any], objective: Any) -> float:
        return_sharpe = _as_float(metrics.get("return_sharpe"), _as_float(metrics.get("sharpe"), 0.0))
        out_of_sample_sharpe = _as_float(metrics.get("out_of_sample_sharpe"), return_sharpe)
        total_return_pct = _as_float(metrics.get("total_return_pct"), _as_float(metrics.get("total_return"), 0.0) * 100.0)
        stability = _as_float(metrics.get("stability"), 0.0)
        drawdown_penalty = abs(_as_float(metrics.get("max_drawdown_pct"), 0.0))
        normalized_objective = str(objective or "sharpe").strip().lower()
        if normalized_objective in {"return", "total_return", "annualized_return", "cagr"}:
            score = total_return_pct * 0.04 + out_of_sample_sharpe * 0.2 + stability / 1000.0 - drawdown_penalty / 200.0
        else:
            score = (
                return_sharpe * 0.55
                + out_of_sample_sharpe * 0.30
                + total_return_pct / 200.0
                + stability / 1000.0
                - drawdown_penalty / 200.0
            )
        return round(score, 3)

    def _optimization_status_label(self, metrics: Mapping[str, Any]) -> str:
        return_sharpe = _as_float(metrics.get("return_sharpe"), _as_float(metrics.get("sharpe"), 0.0))
        out_of_sample_sharpe = _as_float(metrics.get("out_of_sample_sharpe"), return_sharpe)
        max_drawdown_pct = _as_float(metrics.get("max_drawdown_pct"), 0.0)
        stability = _as_float(metrics.get("stability"), 0.0)
        if return_sharpe >= 1.0 and out_of_sample_sharpe >= 0.8 and max_drawdown_pct >= -25.0 and stability >= 70.0:
            return "建议提升"
        if return_sharpe >= 0.6 and out_of_sample_sharpe >= 0.4 and max_drawdown_pct >= -35.0 and stability >= 50.0:
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
        return "当前首选组合" if rank == 1 else f"候选组合 {rank}"

    def _optimization_candidate_summary(
        self,
        parameter_snapshot: Mapping[str, Any],
        metrics: Mapping[str, Any],
        search_space: list[dict[str, Any]],
    ) -> str:
        parameter_summary = self._optimization_parameter_summary(parameter_snapshot, search_space) or "参数组合"
        return (
            f"{parameter_summary}；夏普 {_as_float(metrics.get('return_sharpe'), _as_float(metrics.get('sharpe'), 0.0)):.2f}，"
            f"样本外 {_as_float(metrics.get('out_of_sample_sharpe'), 0.0):.2f}，"
            f"回撤 {_as_float(metrics.get('max_drawdown_pct'), 0.0):.1f}%。"
        )

    def _optimization_candidate_thesis(self, metrics: Mapping[str, Any], status_label: str) -> str:
        return_sharpe = _as_float(metrics.get("return_sharpe"), _as_float(metrics.get("sharpe"), 0.0))
        out_of_sample_sharpe = _as_float(metrics.get("out_of_sample_sharpe"), return_sharpe)
        max_drawdown_pct = _as_float(metrics.get("max_drawdown_pct"), 0.0)
        stability = _as_float(metrics.get("stability"), 0.0)
        if status_label == "建议提升":
            return (
                f"这组参数在真实回测中给出了 {return_sharpe:.2f} 的夏普和 {out_of_sample_sharpe:.2f} 的样本外夏普，"
                f"最大回撤控制在 {max_drawdown_pct:.1f}% 左右，稳定度 {stability:.0f}。"
            )
        if status_label == "继续观察":
            return (
                f"这组参数提升了收益/风险表现，但样本外夏普 {out_of_sample_sharpe:.2f} 与稳定度 {stability:.0f} "
                f"仍需要更多验证，当前最大回撤为 {max_drawdown_pct:.1f}%。"
            )
        return (
            f"这组参数虽然形成了可执行结果，但样本外强度与回撤控制不够理想："
            f"夏普 {return_sharpe:.2f}，样本外 {out_of_sample_sharpe:.2f}，回撤 {max_drawdown_pct:.1f}%。"
        )

    def _build_optimization_heatmap_from_trials(
        self,
        search_space: list[dict[str, Any]],
        focus: Mapping[str, Any],
        trials: list[Mapping[str, Any]],
    ) -> dict[str, Any]:
        range_entries = [entry for entry in search_space if entry.get("mode") == "range"]
        x_entry = range_entries[0] if range_entries else (search_space[0] if search_space else None)
        y_entry = range_entries[1] if len(range_entries) > 1 else None
        if not x_entry:
            return {"x_key": None, "y_key": None, "x_values": [], "y_values": [], "cells": []}

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

        score_by_cell: dict[tuple[Any, Any], float] = {}
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

        if not score_by_cell:
            return self._build_optimization_heatmap(search_space, focus, _as_float(focus.get("return_sharpe"), 0.0))

        scores = list(score_by_cell.values())
        worst_score = min(scores)
        score_span = max(max(scores) - worst_score, 1e-6)
        cells: list[dict[str, Any]] = []
        for row_value in y_values:
            for column_value in x_values:
                cell_key = (column_value, row_value)
                if cell_key not in score_by_cell:
                    continue
                score = score_by_cell[cell_key]
                normalized_score = (score - worst_score) / score_span
                tone = "hot" if normalized_score >= 0.66 else "warm" if normalized_score >= 0.33 else "cool"
                cells.append(
                    {
                        "x": column_value,
                        "y": row_value,
                        "score": round(score, 3),
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
        status_label: str,
    ) -> dict[str, Any]:
        return_sharpe = _as_float(metrics.get("return_sharpe"), _as_float(metrics.get("sharpe"), 0.0))
        out_of_sample_sharpe = _as_float(metrics.get("out_of_sample_sharpe"), return_sharpe)
        max_drawdown_pct = _as_float(metrics.get("max_drawdown_pct"), 0.0)
        stability = _as_float(metrics.get("stability"), 0.0)
        thesis = self._optimization_candidate_thesis(metrics, status_label)
        checks = [
            {
                "key": "return_sharpe",
                "label": "收益夏普",
                "value": round(return_sharpe, 2),
                "verdict": "pass" if return_sharpe >= 1.0 else "watch",
                "detail": "全样本的风险调整收益保持在可接受区间。" if return_sharpe >= 1.0 else "全样本表现已经形成改善，但仍需要更多优势空间。",
            },
            {
                "key": "out_of_sample_sharpe",
                "label": "样本外夏普",
                "value": round(out_of_sample_sharpe, 2),
                "verdict": "pass" if out_of_sample_sharpe >= 0.8 else "watch" if out_of_sample_sharpe >= 0.4 else "risk",
                "detail": "样本外验证仍能保留主要边际。" if out_of_sample_sharpe >= 0.8 else "样本外表现还在，但衰减已经开始出现。" if out_of_sample_sharpe >= 0.4 else "样本外表现偏弱，存在过拟合风险。",
            },
            {
                "key": "max_drawdown_pct",
                "label": "最大回撤",
                "value": round(max_drawdown_pct, 1),
                "verdict": "pass" if max_drawdown_pct >= -25.0 else "watch" if max_drawdown_pct >= -35.0 else "risk",
                "detail": "回撤仍在可接受区间。" if max_drawdown_pct >= -25.0 else "回撤有所放大，需要结合收益继续观察。" if max_drawdown_pct >= -35.0 else "回撤已经明显偏大，不适合直接晋升。",
            },
            {
                "key": "stability",
                "label": "稳定度",
                "value": round(stability, 0),
                "verdict": "pass" if stability >= 70.0 else "watch" if stability >= 50.0 else "risk",
                "detail": "收益路径较平稳，结果重复性较好。" if stability >= 70.0 else "稳定度中等，适合继续做增量验证。" if stability >= 50.0 else "收益路径波动较大，稳定性不足。",
            },
        ]
        if status_label == "建议提升":
            stability_summary = "这组参数在真实回测中的收益、样本外表现和回撤控制都达到了可晋升水位。"
        elif status_label == "继续观察":
            stability_summary = "这组参数已经给出真实改善，但稳定度和样本外强度还值得继续观察。"
        else:
            stability_summary = "这组参数虽然完成了真实评估，但风险收益比仍不足以支持直接晋升。"
        return {
            "title": title,
            "thesis": thesis,
            "shelf_copy": thesis,
            "stability_verdict": status_label,
            "stability_summary": stability_summary,
            "stability_checks": checks,
            "validation_windows": self._build_optimization_validation_windows(chart_series, validation_mode),
            "heatmap": self._build_optimization_heatmap_from_trials(search_space, parameter_snapshot, evaluated_trials),
        }

    def _evaluate_optimization_trial(
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

    def _rank_optimization_trials(self, trials: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return sorted(
            [dict(item) for item in trials],
            key=lambda item: (
                _as_float(item.get("score"), 0.0),
                _as_float(item.get("metrics", {}).get("return_sharpe"), _as_float(item.get("metrics", {}).get("sharpe"), 0.0)),
                _as_float(item.get("metrics", {}).get("out_of_sample_sharpe"), 0.0),
                _as_float(item.get("metrics", {}).get("total_return_pct"), 0.0),
            ),
            reverse=True,
        )

    def _build_optimization_candidate_records(
        self,
        strategy: Mapping[str, Any],
        payload: Mapping[str, Any],
        trials: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        ranked_trials = self._rank_optimization_trials(trials)
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

    def _build_optimization_job_summary(
        self,
        payload: Mapping[str, Any],
        candidates: list[dict[str, Any]],
    ) -> dict[str, Any]:
        status = str(payload.get("status") or "COMPLETED").upper()
        baseline_parameter_version_id = str(payload.get("base_parameter_version_id") or "").strip() or None
        budget_combinations = _as_int(payload.get("budget_combinations"), max(len(candidates) * 10, 24))
        completed_combinations = _as_int(
            payload.get("completed_combinations"),
            budget_combinations if status == "COMPLETED" else min(budget_combinations, len(candidates)),
        )
        summary = {
            "objective": payload.get("objective") or "sharpe",
            "candidate_count": len(candidates),
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
        summary["current_stage"] = payload.get("current_stage") or ("结果就绪" if status == "COMPLETED" else "等待执行")
        summary["latest_update"] = payload.get("latest_update") or ("优化结果已生成。" if status == "COMPLETED" else "优化任务已提交，等待执行。")
        latest_candidate_label = str(payload.get("latest_candidate_label") or "").strip() or None
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
        best_candidate = candidates[0] if candidates else None
        best_analysis = dict((best_candidate or {}).get("analysis") or {})
        progress_pct = min(100, max(0, _as_int(payload.get("progress_pct"), 100 if status == "COMPLETED" else 0)))
        headline = best_analysis.get("title") if best_candidate else ("优化进行中" if status in {"QUEUED", "RUNNING"} else None)
        summary = best_candidate.get("summary") if best_candidate else None
        if not summary and status in {"QUEUED", "RUNNING"}:
            summary = str(payload.get("latest_update") or "").strip() or "正在生成首轮候选。"
        return {
            "best_candidate_id": best_candidate.get("id") if best_candidate else None,
            "best_candidate_label": best_candidate.get("label") if best_candidate else None,
            "baseline_parameter_version_id": baseline_parameter_version_id,
            "headline": headline,
            "summary": summary,
            "stability_verdict": best_analysis.get("stability_verdict") if best_candidate else None,
            "status": status,
            "progress_pct": progress_pct,
            "current_stage": payload.get("current_stage") or ("结果就绪" if status == "COMPLETED" else "等待执行"),
            "latest_update": payload.get("latest_update") or summary,
        }

    def _hydrate_optimization_job(self, row: Mapping[str, Any]) -> dict[str, Any]:
        job = dict(row)
        job["request"] = loads(job.pop("request_json", None), {})
        job["summary"] = loads(job.pop("summary_json", None), {})
        job["result"] = loads(job.pop("result_json", None), {})
        raw_candidates = loads(job.pop("candidates_json", None), [])
        job["base_parameter_version_id"] = job["request"].get("base_parameter_version_id")
        summary_status = str(
            job["summary"].get("status")
            or job.get("status")
            or job["request"].get("status")
            or job["result"].get("status")
            or "COMPLETED"
        ).upper()
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
            or ("搜索已完成" if summary_status == "COMPLETED" else "任务已恢复"),
        )
        job["summary"].setdefault(
            "latest_update",
            job["request"].get("latest_update")
            or job["result"].get("latest_update")
            or job["result"].get("summary")
            or ("优化结果已生成。" if summary_status == "COMPLETED" else "优化任务已提交，等待执行。"),
        )
        strategy = self.get_strategy_detail(str(job["strategy_id"]))
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
                )
            if analysis:
                normalized_candidate["analysis"] = analysis
            normalized_candidates.append(normalized_candidate)
        job["candidates"] = normalized_candidates
        return job

    def _is_legacy_mock_optimization_job_row(self, row: Mapping[str, Any]) -> bool:
        request = loads(row.get("request_json"), {})
        summary = loads(row.get("summary_json"), {})
        result = loads(row.get("result_json"), {})
        candidates = loads(row.get("candidates_json"), [])
        labels = tuple(str(candidate.get("label") or "").strip() for candidate in candidates[:4])
        if labels == LEGACY_MOCK_OPTIMIZATION_LABELS:
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
            "SELECT id, request_json, summary_json, result_json, candidates_json FROM optimization_jobs"
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

    def _project_optimization_job_list_item(self, job: Mapping[str, Any]) -> dict[str, Any]:
        strategy = self.get_strategy_detail(str(job["strategy_id"]))
        request = dict(job.get("request") or {})
        summary = dict(job.get("summary") or {})
        result = dict(job.get("result") or {})
        return {
            "id": job["id"],
            "strategy_id": job["strategy_id"],
            "strategy_name": strategy.get("name"),
            "status": job.get("status"),
            "entry_point": summary.get("entry_point") or request.get("entry_point") or "lab_menu",
            "validation_mode": summary.get("validation_mode") or request.get("validation_mode") or "walk_forward",
            "source_run_id": summary.get("source_run_id") or request.get("source_run_id"),
            "budget_combinations": summary.get("budget_combinations"),
            "completed_combinations": summary.get("completed_combinations"),
            "best_candidate_id": result.get("best_candidate_id"),
            "best_candidate_label": result.get("best_candidate_label"),
            "base_parameter_version_id": job.get("base_parameter_version_id"),
            "created_at": job.get("created_at"),
            "updated_at": job.get("updated_at"),
            "completed_at": job.get("completed_at"),
        }

    def list_optimization_jobs(self) -> list[dict[str, Any]]:
        self._purge_legacy_mock_optimization_jobs()
        rows = self.storage.fetch_all(
            "SELECT rowid AS _rowid, * FROM optimization_jobs ORDER BY updated_at DESC, created_at DESC, rowid DESC"
        )
        return [self._project_optimization_job_list_item(self._hydrate_optimization_job(row)) for row in rows]

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
        persisted_payload = {
            **dict(payload),
            "base_parameter_version_id": baseline_parameter_version_id,
        }
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
        return 0.02 if "PYTEST_CURRENT_TEST" in os.environ else 0.45

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
                    "current_stage": "首轮搜索",
                    "latest_update": "已锁定搜索边界，正在展开参数搜索空间。",
                },
                {
                    "status": "RUNNING",
                    "progress_pct": 44,
                    "candidate_count": 1,
                    "current_stage": "首轮搜索",
                    "latest_update": f"已生成首个候选 {candidates[0]['label']}，开始扩展对照版本。",
                },
                {
                    "status": "RUNNING",
                    "progress_pct": 68,
                    "candidate_count": 2,
                    "current_stage": "稳定性验证",
                    "latest_update": f"正在验证 {candidates[0]['label']} 与备选版本的样本外稳定性。",
                },
                {
                    "status": "RUNNING",
                    "progress_pct": 88,
                    "candidate_count": 3,
                    "current_stage": "热区收敛",
                    "latest_update": "已收敛大部分热区，正在筛除边界候选。",
                },
                {
                    "status": "COMPLETED",
                    "progress_pct": 100,
                    "candidate_count": len(candidates),
                    "current_stage": "结果就绪",
                    "latest_update": f"已完成 {budget_combinations} 组组合，当前首选 {candidates[0]['label']}。",
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
                current_stage="优化失败",
                latest_update=f"优化任务中断：{exc}",
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
                            latest_update=f"检测到服务重启，正在恢复第 {resume_completed} / {budget_combinations} 组后的优化进度。",
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
                            current_stage=f"恢复历史进度 {index}/{resume_completed}",
                            latest_update=(
                                f"正在重新校验已完成的第 {index} / {resume_completed} 组，"
                                f"当前对外进度保持 {resume_completed} / {budget_combinations}。"
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
                            current_stage=f"评估组合 {index}/{budget_combinations}",
                            latest_update=f"正在开始第 {index} / {budget_combinations} 组评估：{current_label}。",
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

                published_candidates = self._build_optimization_candidate_records(
                    strategy,
                    normalized_payload,
                    successful_trials,
                )
                progress_pct = round(index / budget_combinations * 100)
                status = "RUNNING"
                current_stage = f"评估组合 {index}/{budget_combinations}"
                latest_update = f"已完成 {index} / {budget_combinations} 组，最近评估 {current_label}。"
                if index == budget_combinations:
                    status = "COMPLETED" if failed_trials == 0 else "PARTIALLY_FAILED" if published_candidates else "FAILED"
                    current_stage = "优化完成" if status == "COMPLETED" else "部分组合失败" if status == "PARTIALLY_FAILED" else "优化失败"
                    if published_candidates:
                        latest_update = f"真实评估完成，共运行 {budget_combinations} 组，当前首选 {published_candidates[0]['label']}。"
                    else:
                        latest_update = f"所有候选组合都执行失败，共尝试 {budget_combinations} 组。"
                        if last_error_message:
                            latest_update = f"{latest_update} 最近错误：{last_error_message}"

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
            label = {"strategy_type": "策略类型", "universe_name": "标的范围", "rebalance_frequency": "调仓频率"}[key]
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
                backtest_runs.preview_json,
                backtest_runs.metrics_json,
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

    def get_backtest_run(self, run_id: str) -> dict[str, Any]:
        row = self.storage.fetch_one("SELECT * FROM backtest_runs WHERE id = ? AND deleted_at IS NULL", (run_id,))
        if not row:
            raise KeyError(f"Backtest run not found: {run_id}")
        return self._decode_run_row(row)

    def get_backtest_run_detail(self, run_id: str) -> dict[str, Any]:
        run = self.get_backtest_run(run_id)
        run["legacy_demo_run"] = False
        return run

    def get_backtest_run_trades(self, run_id: str, page: int = 1, page_size: int = 50, segment: str = "all") -> dict[str, Any]:
        run = self.get_backtest_run(run_id)
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

    def get_workspace_overview(self) -> dict[str, Any]:
        strategies = self.list_strategies()
        recent_runs = self.list_backtest_runs(limit=5)
        latest_job = self.storage.fetch_one("SELECT * FROM optimization_jobs ORDER BY created_at DESC LIMIT 1")
        return {
            "workspace_name": "Grit 策略实验室",
            "subtitle": "以明确契约串联研究、确认、回测与参数提升。",
            "strategy_count": len(strategies),
            "active_run_count": len([item for item in recent_runs if item.get("status") == "RUNNING"]),
            "running_optimization_count": 1
            if latest_job and str(latest_job.get("status") or "").upper() in {"QUEUED", "RUNNING"}
            else 0,
            "latest_strategy_id": strategies[0]["id"] if strategies else None,
            "latest_backtest_run_id": recent_runs[0]["id"] if recent_runs else None,
            "latest_optimization_job_id": latest_job["id"] if latest_job else None,
            "top_momentum_warning": "有一个股票池快照未完成；在刷新之前，新的正式回测都会被阻止。",
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
            "message": "还没有生成快照。先刷新快照，再继续正式回测。",
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
        return {
            **dict(row),
            "request": loads(row.get("request_json"), {}),
            "summary": loads(row.get("summary_json"), {}),
            "warnings": loads(row.get("warnings_json"), []),
            "errors": loads(row.get("errors_json"), []),
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
    ) -> bool:
        with self._optimization_runner_lock:
            if job_id in self._optimization_runner_job_ids:
                return False
            self._optimization_runner_job_ids.add(job_id)

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

        threading.Thread(
            target=run,
            name=f"optimization-job-{job_id}",
            daemon=True,
        ).start()
        return True

    def resume_incomplete_optimization_jobs(self) -> list[str]:
        rows = self.storage.fetch_all(
            """
            SELECT *
            FROM optimization_jobs
            WHERE status IN (?, ?)
            ORDER BY created_at ASC, id ASC
            """,
            ("QUEUED", "RUNNING"),
        )
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
            payload.setdefault("current_stage", "任务已恢复")
            payload.setdefault("latest_update", "检测到服务重启，正在恢复优化任务。")
            existing_candidates = list(loads(row.get("candidates_json"), []))
            resumed_at = iso_now()
            self._persist_optimization_job(
                job_id,
                strategy_id,
                self._build_optimization_progress_payload(
                    payload,
                    status=str(payload.get("status") or "QUEUED").upper(),
                    progress_pct=_as_int(payload.get("progress_pct"), 0),
                    completed_combinations=_as_int(payload.get("completed_combinations"), 0),
                    current_stage=str(payload.get("current_stage") or "任务已恢复"),
                    latest_update=str(payload.get("latest_update") or "检测到服务重启，正在恢复优化任务。"),
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
            if self._start_optimization_job_runner(
                job_id,
                strategy_id,
                payload,
                created_at=str(row.get("created_at") or iso_now()),
                existing_candidates=existing_candidates,
                recovered=True,
            ):
                resumed_job_ids.append(job_id)
        return resumed_job_ids

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
            "objective": payload.get("objective") or "sharpe",
            "base_parameter_version_id": baseline_parameter_version_id,
            "source_run_id": source_run_id,
            "entry_point": payload.get("entry_point") or "lab_menu",
            "validation_mode": payload.get("validation_mode") or "walk_forward",
            "status": "QUEUED",
            "progress_pct": 0,
            "completed_combinations": 0,
            "current_stage": "任务已创建",
            "latest_update": "优化任务已创建，正在准备搜索队列。",
        }
        normalized_payload["search_space"] = self._normalize_optimization_search_space(strategy, normalized_payload)
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
        row = self.storage.fetch_one("SELECT * FROM optimization_jobs WHERE id = ?", (job_id,))
        if not row:
            raise KeyError(f"Optimization job not found: {job_id}")
        return self._hydrate_optimization_job(row)

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
        candidates = [dict(candidate) for candidate in job.get("candidates", [])]
        new_candidate = self._normalize_optimization_candidate(
            strategy,
            {
                "id": self._new_id("trial"),
                "label": payload.get("label"),
                "summary": payload.get("summary"),
                "status": "SUCCEEDED",
                "rank": len(candidates) + 1,
                "score": payload.get("score"),
                "parameter_snapshot": parameter_snapshot,
                "metrics": dict(payload.get("metrics") or {}),
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
        candidate = next((item for item in job.get("candidates", []) if item.get("id") == trial_id), None)
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
                    "rebalance_frequency": strategy.get("rebalance_frequency"),
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
        self._write_strategy_record(
            strategy_row,
            parameter_history=parameter_history,
            current_version=next_version,
            comment=payload.get("comment"),
        )
        return self.get_strategy_detail(str(job["strategy_id"]))

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
        latest_job = self.storage.fetch_one("SELECT * FROM optimization_jobs ORDER BY created_at DESC LIMIT 1")
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

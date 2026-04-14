from __future__ import annotations

import math
import os
import re
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence
from time import monotonic

from .backtest_engine import (
    BacktestConfig,
    _normalize_bars,
    _signal_score,
    prepare_backtest_inputs,
    run_backtest,
    run_backtest_prepared,
)
from .backtest_metrics import (
    build_run_detail_analysis,
    build_consistency_score,
    build_drawdown_events,
    build_monthly_returns,
    build_relative_metrics,
    build_risk_metrics,
    build_rolling_metrics,
    metric_summary,
)
from .fallback_provider import UnconfiguredFallbackProvider
from .market_data_repository import (
    DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID,
    DATASET_PRICE_SNAPSHOT_ID,
    CoverageSummary,
    MarketDataRepository,
)
from ._runtime_memory import read_runtime_memory_status
from .snapshot_recovery import (
    import_legacy_market_data_backup,
    import_snapshot_cold_backup,
    probe_lab2_snapshot_assets,
    probe_workspace_market_data_assets,
)
from .service import BacktestPlatformService, _as_mapping
from .storage import dumps, iso_now, is_snapshot_blocking, loads
from .universe_history import (
    ANCHOR_SCHEDULE,
    NASDAQ100_UNIVERSE_SNAPSHOT_ID,
    SP500_UNIVERSE_KEY,
    SP500_UNIVERSE_SNAPSHOT_ID,
    collect_snapshot_symbols,
    default_universe_history_providers,
)
from .yahoo_provider import YahooMarketDataProvider
DEFAULT_UNIVERSE_SYMBOLS = {
    "SP500": ["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "AMD", "AVGO", "COST"],
    "NASDAQ100": ["QQQ", "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "AMD", "AVGO"],
}


SNAPSHOT_START_DATE = date(1996, 1, 1)
READY_SNAPSHOT_ACTIONS = ["refresh_snapshots", "start_backtest"]
BLOCKED_SNAPSHOT_ACTIONS = ["refresh_snapshots"]
SNAPSHOT_MARKET_DATA_MAX_WORKERS = 12
SNAPSHOT_MARKET_DATA_REPAIR_MAX_WORKERS = 2
SNAPSHOT_REPAIR_SYMBOL_BATCH_SIZE = 12
SNAPSHOT_LATEST_SYMBOL_BATCH_SIZE = 64
SNAPSHOT_REFRESH_RUNTIME_STATE_KEY = "snapshot_refresh_runtime"
LONGBRIDGE_MIN_HISTORY_DATE = date(2010, 6, 1)
SNAPSHOT_MEMORY_USAGE_LIMIT = 0.80
SNAPSHOT_SYSTEM_MEMORY_EMERGENCY_LIMIT = 0.95
SNAPSHOT_REFRESH_HEARTBEAT_INTERVAL_SECONDS = 1.0
SNAPSHOT_REFRESH_HEARTBEAT_GRACE_SECONDS = 30.0
SNAPSHOT_REFRESH_WORKER_DISCOVERY_TIMEOUT_SECONDS = 3.0
DIRECT_REFRESH_SYMBOL_PATTERN = re.compile(r"^[A-Z][A-Z0-9.-]{0,11}$")


class SnapshotBlockingError(ValueError):
    def __init__(self, summary: Mapping[str, Any]):
        detail = {
            "status": 409,
            "code": "snapshot_blocked",
            "message": "Snapshot refresh is required before this view can be used.",
            "blocking_code": "SNAPSHOT_REFRESH_REQUIRED",
            "blocking_target": "data_snapshots",
            "next_action": "refresh_snapshots",
            "snapshot_summary": dict(summary),
        }
        super().__init__(detail["message"])
        self.status_code = 409
        self.detail = detail


class SnapshotMemoryPressureError(RuntimeError):
    pass


def _default_market_data_path(database_path: str | Path) -> Path:
    path = Path(database_path)
    return path.with_name(f"{path.stem}_market_data.sqlite3")


def _coerce_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _pct_change(current: Any, base: Any) -> float:
    base_value = _coerce_float(base)
    current_value = _coerce_float(current)
    if abs(base_value) <= 1e-9:
        return 0.0
    return round((current_value / base_value - 1.0) * 100.0, 4)


def _segment_for_trade_window(opened_at: str, closed_at: str, oos_start_date: str | None) -> str:
    if oos_start_date and max(str(opened_at), str(closed_at)) >= str(oos_start_date):
        return "OOS"
    return "IS"


def _equity_before_trade(chart_point: Mapping[str, Any] | None) -> float:
    if not chart_point:
        return 0.0
    equity_after = _coerce_float(chart_point.get("equity"))
    strategy_return = _coerce_float(chart_point.get("strategy_return"))
    if equity_after <= 0:
        return 0.0
    denominator = 1.0 + strategy_return
    if abs(denominator) <= 1e-9:
        return equity_after
    return equity_after / denominator


def _enrich_trade_records_with_execution_values(
    run: Mapping[str, Any],
    trades: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    chart_points_by_date = {
        str(point.get("trade_date") or ""): point
        for point in run.get("chart_series") or []
        if str(point.get("trade_date") or "")
    }
    enriched: list[dict[str, Any]] = []
    open_positions: dict[str, dict[str, float]] = {}
    for item in trades:
        trade = dict(item)
        action = str(trade.get("action") or trade.get("side") or "").strip()
        if action and not trade.get("side"):
            trade["side"] = action.upper()

        quantity = trade.get("quantity")
        net_amount = trade.get("net_amount")

        trade_date = str(
            trade.get("trade_date")
            or trade.get("fill_date")
            or trade.get("signal_date")
            or ""
        ).strip()
        price = _coerce_float(trade.get("price"))
        delta_weight = abs(_coerce_float(trade.get("weight_after")) - _coerce_float(trade.get("weight_before")))
        equity_before = _equity_before_trade(chart_points_by_date.get(trade_date))
        traded_notional = equity_before * delta_weight if equity_before > 0 and delta_weight > 0 else 0.0

        if net_amount in (None, "") and traded_notional > 0:
            trade["net_amount"] = round(traded_notional, 4)
        if quantity in (None, "") and traded_notional > 0 and price > 0:
            trade["quantity"] = round(traded_notional / price, 6)

        symbol = str(trade.get("symbol") or "").upper()
        side = str(trade.get("side") or action).upper()
        resolved_quantity = _coerce_float(trade.get("quantity"))
        position = open_positions.get(symbol, {"quantity": 0.0, "avg_price": 0.0})
        open_quantity = _coerce_float(position.get("quantity"))
        average_price = _coerce_float(position.get("avg_price"))

        if side == "BUY" and resolved_quantity > 0 and price > 0:
            next_quantity = open_quantity + resolved_quantity
            if next_quantity > 0:
                total_cost = open_quantity * average_price + resolved_quantity * price
                open_positions[symbol] = {
                    "quantity": next_quantity,
                    "avg_price": total_cost / next_quantity,
                }
        elif side == "SELL" and resolved_quantity > 0:
            if trade.get("pnl_contribution") in (None, "") and open_quantity > 0 and average_price > 0 and price > 0:
                trade["pnl_contribution"] = _pct_change(price, average_price)
            if trade.get("pnl_amount") in (None, "") and open_quantity > 0 and average_price > 0 and price > 0:
                trade["pnl_amount"] = round((price - average_price) * resolved_quantity, 4)
            remaining_quantity = max(open_quantity - resolved_quantity, 0.0)
            open_positions[symbol] = {
                "quantity": remaining_quantity,
                "avg_price": average_price if remaining_quantity > 1e-9 else 0.0,
            }

        enriched.append(trade)
    return enriched


class RealBacktestPlatformService(BacktestPlatformService):
    def __init__(
        self,
        database_path: str | Path = "data/platform.sqlite3",
        market_data_provider: Any | None = None,
        market_data_path: str | Path | None = None,
    ):
        super().__init__(database_path)
        self.market_data_provider = market_data_provider
        self.market_data_repository = MarketDataRepository(market_data_path or _default_market_data_path(database_path))
        self._snapshot_refresh_lock = threading.Lock()
        self._snapshot_refresh_thread: threading.Thread | None = None
        self._snapshot_refresh_process: subprocess.Popen[str] | None = None
        self._backtest_run_lock = threading.Lock()
        self._backtest_run_threads: dict[str, threading.Thread] = {}

    def _primary_market_data_provider(self) -> Any:
        return self.market_data_provider or YahooMarketDataProvider()

    def _provider_name(self, provider: Any) -> str:
        return str(getattr(provider, "provider_name", provider.__class__.__name__)).strip().lower()

    def _provider_is_current_window_enhancer(self, provider_name: str) -> bool:
        normalized = str(provider_name or "").strip().lower()
        return normalized in {"longbridge", "longbridge_static_info", "futu", "futu_rehab"} or normalized.startswith("futu")

    def _scoped_market_data_provider(self, *, mode: str, window_start: date) -> Any:
        provider = self._primary_market_data_provider()
        scoped_copy = getattr(provider, "scoped_copy", None)
        if not callable(scoped_copy):
            return provider
        excluded: set[str] = set()
        if mode == "full":
            excluded.update({"longbridge", "longbridge_static_info", "futu", "futu_rehab"})
        if window_start < LONGBRIDGE_MIN_HISTORY_DATE:
            excluded.update({"longbridge", "longbridge_static_info"})
        if not excluded:
            return provider
        return scoped_copy(exclude_provider_names=excluded)

    def _fallback_market_data_provider(self, primary_provider: Any | None = None) -> Any:
        if primary_provider is not None and getattr(primary_provider, "providers", None):
            return UnconfiguredFallbackProvider("Runtime market-data provider handles its own fallback chain.")
        provider = getattr(self.market_data_provider, "fallback_provider", None)
        if provider is not None:
            return provider
        return UnconfiguredFallbackProvider()

    def _universe_history_providers(self) -> list[Any]:
        providers = getattr(self.market_data_provider, "universe_history_providers", None)
        if providers:
            return list(providers)
        return list(default_universe_history_providers())

    def _normalize_snapshot_refresh_request(self, request: Any | None) -> tuple[dict[str, Any], str, list[str]]:
        payload = dict(_as_mapping(request))
        mode = str(payload.get("mode") or "incremental").strip().lower()
        if mode not in {"incremental", "repair", "full"}:
            raise ValueError("Snapshot refresh mode must be one of incremental, repair, or full.")

        raw_targets = payload.get("targets")
        normalized_targets: list[str] = []
        if raw_targets is None:
            normalized_targets = []
        elif isinstance(raw_targets, str):
            normalized_targets = [raw_targets]
        else:
            try:
                normalized_targets = [str(item) for item in raw_targets if str(item).strip()]
            except TypeError as exc:
                raise ValueError("Snapshot refresh targets must be a list of price, corporate, or universes.") from exc

        allowed_targets = {"price", "corporate", "universes"}
        cleaned_targets = [item.strip().lower() for item in normalized_targets if item.strip().lower() in allowed_targets]
        if normalized_targets and not cleaned_targets:
            raise ValueError("Snapshot refresh targets must include price, corporate, or universes.")
        if mode != "repair" or not cleaned_targets:
            cleaned_targets = ["price", "corporate", "universes"]
        payload["mode"] = mode
        payload["targets"] = cleaned_targets
        return payload, mode, cleaned_targets

    def _refresh_snapshot_message(self, mode: str) -> str:
        if mode == "repair":
            return "\u6b63\u5728\u4fee\u590d\u5feb\u7167\u7f3a\u53e3\uff0c\u9875\u9762\u4f1a\u81ea\u52a8\u66f4\u65b0\u3002\u5f53\u524d\u5148\u663e\u793a\u5df2\u6709\u6570\u636e\u3002"
        return "\u6b63\u5728\u5237\u65b0\u5feb\u7167\uff0c\u9875\u9762\u4f1a\u81ea\u52a8\u66f4\u65b0\u3002\u5f53\u524d\u5148\u663e\u793a\u5df2\u6709\u6570\u636e\u3002"

    def _build_snapshot_refresh_summary(
        self,
        *,
        overview: Mapping[str, Any],
        mode: str,
        targets: Sequence[str],
        symbol_count: int,
        row_count: int,
        status: str | None = None,
        message: str | None = None,
        blocking_code: str | None = None,
        blocking_target: str | None = None,
        refresh_stats: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        resolved_status = str(status or overview.get("overall_status") or "INCOMPLETE").upper()
        resolved_blocking = resolved_status != "READY"
        return {
            "status": resolved_status,
            "mode": mode,
            "targets": list(targets),
            "symbol_count": int(symbol_count),
            "row_count": int(row_count),
            "blocking": resolved_blocking,
            "blocking_code": blocking_code if blocking_code is not None else overview.get("blocking_code"),
            "blocking_target": blocking_target if blocking_target is not None else overview.get("blocking_target"),
            "message": message if message is not None else overview.get("message"),
            "dataset_snapshot_id": DATASET_PRICE_SNAPSHOT_ID,
            "universe_snapshot_ids": [SP500_UNIVERSE_SNAPSHOT_ID, NASDAQ100_UNIVERSE_SNAPSHOT_ID],
            "refresh_stats": dict(refresh_stats or {}),
        }

    def _build_snapshot_refresh_job(
        self,
        *,
        job_id: str,
        request: Mapping[str, Any],
        overview: Mapping[str, Any],
        mode: str,
        targets: Sequence[str],
        symbol_count: int,
        row_count: int,
        warnings: Sequence[str],
        errors: Sequence[str],
        created_at: str,
        started_at: str,
        completed_at: str | None,
        status: str | None = None,
        message: str | None = None,
        blocking_code: str | None = None,
        blocking_target: str | None = None,
        refresh_stats: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        resolved_status = str(status or overview.get("overall_status") or "INCOMPLETE").upper()
        updated_at = completed_at or started_at
        return {
            "id": job_id,
            "status": resolved_status,
            "request": dict(request),
            "summary": self._build_snapshot_refresh_summary(
                overview=overview,
                mode=mode,
                targets=targets,
                symbol_count=symbol_count,
                row_count=row_count,
                status=resolved_status,
                message=message,
                blocking_code=blocking_code,
                blocking_target=blocking_target,
                refresh_stats=refresh_stats,
            ),
            "warnings": sorted(set(str(item) for item in warnings if item)),
            "errors": [str(item) for item in errors if item],
            "created_at": created_at,
            "updated_at": updated_at,
            "started_at": started_at,
            "completed_at": completed_at,
        }

    def _normalized_universe_name(self, strategy: Mapping[str, Any]) -> str:
        universe_name = str(
            strategy.get("universe_name")
            or (strategy.get("parameters") or {}).get("universe_name")
            or ""
        ).strip()
        return universe_name.upper()

    def _normalize_refresh_symbol(self, value: Any) -> str | None:
        normalized = str(value or "").strip().upper()
        if not normalized or not normalized.isascii():
            return None
        if normalized.endswith(".US"):
            normalized = normalized[:-3]
        return normalized if DIRECT_REFRESH_SYMBOL_PATTERN.fullmatch(normalized) else None

    def _normalize_refresh_symbols(self, values: Sequence[Any]) -> list[str]:
        ordered: list[str] = []
        seen: set[str] = set()
        for item in values:
            normalized = self._normalize_refresh_symbol(item)
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            ordered.append(normalized)
        return ordered

    def _looks_like_direct_symbol(self, value: str) -> bool:
        return self._normalize_refresh_symbol(value) is not None

    def _direct_symbol_universe_symbol(self, strategy: Mapping[str, Any]) -> str | None:
        universe_name = self._normalized_universe_name(strategy)
        if universe_name in {"SP500", "S&P500", "SP-500", "NASDAQ100", "NASDAQ-100", "NDX100", "NDX-100"}:
            return None
        normalized_universe_symbol = self._normalize_refresh_symbol(universe_name)
        if normalized_universe_symbol:
            return normalized_universe_symbol
        if str(strategy.get("strategy_type") or "").upper() == "GRID":
            benchmark_symbol = str(
                strategy.get("benchmark_symbol")
                or (strategy.get("parameters") or {}).get("benchmark_symbol")
                or "QQQ"
            ).strip().upper()
            normalized_benchmark_symbol = self._normalize_refresh_symbol(benchmark_symbol)
            if normalized_benchmark_symbol:
                return normalized_benchmark_symbol
        return None

    def _uses_direct_symbol_universe(self, strategy: Mapping[str, Any]) -> bool:
        return self._direct_symbol_universe_symbol(strategy) is not None

    def _resolved_universe_snapshot_id(
        self,
        strategy: Mapping[str, Any],
        request_payload: Mapping[str, Any] | None = None,
    ) -> str | None:
        if self._uses_direct_symbol_universe(strategy):
            return None
        snapshot_id = (
            (request_payload or {}).get("universe_snapshot_id")
            or strategy.get("universe_snapshot_id")
            or self._default_universe_snapshot_id(strategy)
        )
        if snapshot_id is None:
            return None
        value = str(snapshot_id).strip()
        return value or None

    def _normalize_strategy_snapshot_bindings(self, strategy: Mapping[str, Any]) -> dict[str, Any]:
        normalized = dict(strategy)
        normalized["dataset_snapshot_id"] = str(normalized.get("dataset_snapshot_id") or DATASET_PRICE_SNAPSHOT_ID)
        normalized["universe_snapshot_id"] = self._resolved_universe_snapshot_id(normalized)
        return normalized

    def _default_universe_snapshot_id(self, strategy: Mapping[str, Any]) -> str:
        universe_name = self._normalized_universe_name(strategy)
        if universe_name in {"NASDAQ100", "NASDAQ-100", "NDX100", "NDX-100"}:
            return NASDAQ100_UNIVERSE_SNAPSHOT_ID
        if universe_name in {"SP500", "S&P500", "SP-500"}:
            return SP500_UNIVERSE_SNAPSHOT_ID
        return SP500_UNIVERSE_SNAPSHOT_ID

    def _dataset_snapshot_defaults(self) -> list[dict[str, Any]]:
        return [
            {
                "id": DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID,
                "name": "\u516c\u53f8\u884c\u4e3a\u6570\u636e",
                "status": "INCOMPLETE",
                "as_of": None,
                "freshness_label": "\u5c1a\u672a\u5237\u65b0",
                "start_date": SNAPSHOT_START_DATE.isoformat(),
                "end_date": None,
                "row_count": 0,
                "source": "",
                "fallback_source": None,
                "blocker": {
                    "code": "SNAPSHOT_REFRESH_REQUIRED",
                    "message": "\u8bf7\u5148\u5237\u65b0\u5feb\u7167\uff0c\u518d\u67e5\u770b\u516c\u53f8\u884c\u4e3a\u6570\u636e\u3002",
                },
            },
            {
                "id": DATASET_PRICE_SNAPSHOT_ID,
                "name": "\u80a1\u7968\u4ef7\u683c\u6570\u636e",
                "status": "INCOMPLETE",
                "as_of": None,
                "freshness_label": "\u5c1a\u672a\u5237\u65b0",
                "start_date": SNAPSHOT_START_DATE.isoformat(),
                "end_date": None,
                "row_count": 0,
                "source": "",
                "fallback_source": None,
                "blocker": {
                    "code": "SNAPSHOT_REFRESH_REQUIRED",
                    "message": "\u8bf7\u5148\u5237\u65b0\u5feb\u7167\uff0c\u518d\u67e5\u770b\u80a1\u7968\u4ef7\u683c\u6570\u636e\u3002",
                },
            },
        ]

    def _universe_snapshot_defaults(self) -> list[dict[str, Any]]:
        return [
            {
                "id": SP500_UNIVERSE_SNAPSHOT_ID,
                "name": "\u6807\u666e500",
                "status": "INCOMPLETE",
                "as_of": None,
                "freshness_label": "\u5c1a\u672a\u5237\u65b0",
                "window_start": SNAPSHOT_START_DATE.isoformat(),
                "window_end": None,
                "anchor_schedule": ANCHOR_SCHEDULE,
                "member_count": 0,
                "source": "",
                "fallback_source": None,
                "blocker": {
                    "code": "SNAPSHOT_REFRESH_REQUIRED",
                    "message": "\u8bf7\u5148\u5237\u65b0\u5feb\u7167\uff0c\u518d\u67e5\u770b\u6807\u666e500\u80a1\u7968\u6c60\u5feb\u7167\u3002",
                },
            },
            {
                "id": NASDAQ100_UNIVERSE_SNAPSHOT_ID,
                "name": "\u7eb3\u6307100",
                "status": "INCOMPLETE",
                "as_of": None,
                "freshness_label": "\u5c1a\u672a\u5237\u65b0",
                "window_start": SNAPSHOT_START_DATE.isoformat(),
                "window_end": None,
                "anchor_schedule": ANCHOR_SCHEDULE,
                "member_count": 0,
                "source": "",
                "fallback_source": None,
                "blocker": {
                    "code": "SNAPSHOT_REFRESH_REQUIRED",
                    "message": "\u8bf7\u5148\u5237\u65b0\u5feb\u7167\uff0c\u518d\u67e5\u770b\u7eb3\u6307100\u80a1\u7968\u6c60\u5feb\u7167\u3002",
                },
            },
        ]

    def _format_dataset_snapshot(self, item: Mapping[str, Any] | None, defaults: Mapping[str, Any]) -> dict[str, Any]:
        merged = {**defaults, **dict(item or {})}
        return {
            "id": merged["id"],
            "name": merged["name"],
            "status": str(merged.get("status") or "INCOMPLETE").upper(),
            "as_of": merged.get("as_of"),
            "freshness_label": merged.get("freshness_label"),
            "start_date": merged.get("start_date"),
            "end_date": merged.get("end_date"),
            "row_count": int(merged.get("row_count") or 0),
            "source": str(merged.get("source") or ""),
            "fallback_source": merged.get("fallback_source"),
            "blocker": dict(merged.get("blocker") or {}),
            "metadata": dict(merged.get("metadata") or {}),
        }

    def _format_universe_snapshot(self, item: Mapping[str, Any] | None, defaults: Mapping[str, Any]) -> dict[str, Any]:
        merged = {**defaults, **dict(item or {})}
        return {
            "id": merged["id"],
            "name": merged["name"],
            "status": str(merged.get("status") or "INCOMPLETE").upper(),
            "as_of": merged.get("as_of"),
            "freshness_label": merged.get("freshness_label"),
            "window_start": merged.get("window_start"),
            "window_end": merged.get("window_end"),
            "anchor_schedule": merged.get("anchor_schedule") or ANCHOR_SCHEDULE,
            "member_count": int(merged.get("member_count") or 0),
            "source": str(merged.get("source") or ""),
            "fallback_source": merged.get("fallback_source"),
            "blocker": dict(merged.get("blocker") or {}),
            "metadata": dict(merged.get("metadata") or {}),
        }

    def _snapshot_row_is_placeholder(self, row: Mapping[str, Any] | None, *, count_key: str) -> bool:
        if not row:
            return True
        count = int(row.get(count_key) or 0)
        if count > 0:
            return False
        return not any(
            (
                row.get("as_of"),
                str(row.get("source") or "").strip(),
                str(row.get("fallback_source") or "").strip(),
            )
        )

    def _snapshot_missing_symbols(self, snapshot: Mapping[str, Any] | None) -> list[str]:
        metadata = dict(snapshot.get("metadata") or {}) if snapshot else {}
        raw_symbols = metadata.get("missing_symbols") or []
        if not isinstance(raw_symbols, list):
            return []
        return self._normalize_refresh_symbols(raw_symbols)

    def _snapshot_repair_cursor(self, snapshot: Mapping[str, Any] | None) -> int:
        metadata = dict(snapshot.get("metadata") or {}) if snapshot else {}
        try:
            return max(0, int(metadata.get("repair_cursor") or 0))
        except (TypeError, ValueError):
            return 0

    def _latest_universe_symbols(self, snapshots: Sequence[Any]) -> list[str]:
        latest_by_universe: dict[str, Any] = {}
        for snapshot in snapshots:
            universe_key = str(getattr(snapshot, "universe_key", "") or "")
            if not universe_key:
                continue
            effective_date = getattr(snapshot, "effective_date", None)
            current = latest_by_universe.get(universe_key)
            if current is None or (effective_date and effective_date > getattr(current, "effective_date", None)):
                latest_by_universe[universe_key] = snapshot
        ordered: list[str] = []
        seen: set[str] = set()
        for universe_key in sorted(latest_by_universe):
            snapshot = latest_by_universe[universe_key]
            for symbol in getattr(snapshot, "normalized_symbols", []) or []:
                normalized = self._normalize_refresh_symbol(symbol)
                if not normalized or normalized in seen:
                    continue
                seen.add(normalized)
                ordered.append(normalized)
        return ordered

    def _repair_symbol_batch(self, symbols: Sequence[str], cursor: int, batch_size: int) -> tuple[list[str], int]:
        ordered = self._normalize_refresh_symbols(symbols)
        if not ordered:
            return [], 0
        normalized_cursor = cursor % len(ordered)
        selection = ordered[normalized_cursor : normalized_cursor + batch_size]
        if len(selection) < batch_size:
            selection.extend(ordered[: max(0, batch_size - len(selection))])
        deduped = list(dict.fromkeys(selection))
        next_cursor = (normalized_cursor + len(deduped)) % len(ordered)
        return deduped, next_cursor

    def _symbol_batches(self, symbols: Sequence[str], batch_size: int) -> list[list[str]]:
        ordered = self._normalize_refresh_symbols(symbols)
        if not ordered:
            return []
        normalized_batch_size = max(1, int(batch_size or 1))
        return [ordered[index : index + normalized_batch_size] for index in range(0, len(ordered), normalized_batch_size)]

    def _dataset_progress_metadata(
        self,
        *,
        symbol_coverage: Sequence[CoverageSummary | Mapping[str, Any]] | None,
        missing_symbols: Sequence[str] | None,
        existing_metadata: Mapping[str, Any] | None = None,
        covered_symbols: Sequence[str] | None = None,
        total_symbol_count_override: int | None = None,
        target_symbols: Sequence[str] | None = None,
    ) -> dict[str, Any]:
        metadata = dict(existing_metadata or {})
        if covered_symbols is None:
            covered_symbol_set = {
                str((item.symbol if isinstance(item, CoverageSummary) else item.get("symbol")) or "").strip().upper()
                for item in (symbol_coverage or [])
            }
        else:
            covered_symbol_set = {str(item or "").strip().upper() for item in covered_symbols if str(item or "").strip()}
        covered_symbol_set.discard("")
        missing_symbol_set = {str(item or "").strip().upper() for item in (missing_symbols or []) if str(item or "").strip()}
        target_symbol_set = {str(item or "").strip().upper() for item in (target_symbols or []) if str(item or "").strip()}
        if target_symbol_set:
            covered_symbol_set &= target_symbol_set
            missing_symbol_set &= target_symbol_set
        covered_symbol_count = len(covered_symbol_set)
        total_symbol_count = len(target_symbol_set) if target_symbol_set else len(covered_symbol_set | missing_symbol_set)

        legacy_symbol_count = metadata.get("legacy_symbol_count")
        try:
            fallback_count = int(legacy_symbol_count)
        except (TypeError, ValueError):
            fallback_count = 0
        if total_symbol_count_override is not None:
            try:
                explicit_total = max(0, int(total_symbol_count_override))
            except (TypeError, ValueError):
                explicit_total = 0
            if explicit_total > 0:
                total_symbol_count = max(
                    explicit_total,
                    len(target_symbol_set) if target_symbol_set else covered_symbol_count + len(missing_symbol_set),
                )
                metadata["target_symbol_count"] = explicit_total
        elif target_symbol_set:
            metadata["target_symbol_count"] = len(target_symbol_set)
        if not target_symbol_set:
            if covered_symbol_count == 0 and fallback_count > 0:
                covered_symbol_count = fallback_count
            if total_symbol_count == 0 and covered_symbol_count > 0:
                total_symbol_count = covered_symbol_count + len(missing_symbol_set)
            if total_symbol_count == 0 and fallback_count > 0:
                total_symbol_count = fallback_count
        if not target_symbol_set:
            forced_total_symbol_count = metadata.get("total_symbol_count")
            try:
                forced_total_count = int(forced_total_symbol_count)
            except (TypeError, ValueError):
                forced_total_count = 0
            if forced_total_count > 0:
                total_symbol_count = forced_total_count

        metadata["covered_symbol_count"] = covered_symbol_count
        metadata["total_symbol_count"] = total_symbol_count
        return metadata

    def _parse_snapshot_date(self, value: Any) -> date | None:
        raw = str(value or "").strip()
        if not raw:
            return None
        if "T" in raw:
            try:
                return datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
            except ValueError:
                raw = raw.split("T", 1)[0]
        try:
            return date.fromisoformat(raw[:10])
        except ValueError:
            return None

    def _parse_snapshot_timestamp(self, value: Any) -> datetime | None:
        raw = str(value or "").strip()
        if not raw:
            return None
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed

    def _snapshot_refresh_heartbeat_is_recent(
        self,
        latest_job: Mapping[str, Any] | None,
        *,
        now: datetime | None = None,
    ) -> bool:
        if not latest_job or str(latest_job.get("status") or "").upper() != "RUNNING":
            return False
        summary = dict(latest_job.get("summary") or {})
        heartbeat_at = (
            summary.get("heartbeat_at")
            or latest_job.get("updated_at")
            or latest_job.get("started_at")
        )
        heartbeat_dt = self._parse_snapshot_timestamp(heartbeat_at)
        if heartbeat_dt is None:
            return False
        current_dt = now or datetime.now(timezone.utc)
        return (current_dt - heartbeat_dt).total_seconds() <= SNAPSHOT_REFRESH_HEARTBEAT_GRACE_SECONDS

    def _latest_market_data_window_start(
        self,
        *,
        existing_price_snapshot: Mapping[str, Any] | None,
        existing_corporate_snapshot: Mapping[str, Any] | None,
        window_end: date,
    ) -> date:
        candidates: list[date] = []
        for snapshot in (existing_price_snapshot, existing_corporate_snapshot):
            if not snapshot:
                continue
            parsed = self._parse_snapshot_date(snapshot.get("end_date")) or self._parse_snapshot_date(snapshot.get("as_of"))
            if parsed:
                candidates.append(parsed)
        if not candidates:
            return SNAPSHOT_START_DATE
        latest_start = min(candidates)
        if latest_start < SNAPSHOT_START_DATE:
            return SNAPSHOT_START_DATE
        if latest_start > window_end:
            return window_end
        return latest_start

    def _memory_usage_limit(self) -> float:
        raw_value = os.getenv("GRIT_SNAPSHOT_MEMORY_LIMIT_RATIO")
        try:
            value = float(raw_value) if raw_value is not None else SNAPSHOT_MEMORY_USAGE_LIMIT
        except (TypeError, ValueError):
            value = SNAPSHOT_MEMORY_USAGE_LIMIT
        return min(max(value, 0.10), 0.95)

    def _snapshot_memory_status(self) -> dict[str, float]:
        return read_runtime_memory_status()

    def _raise_if_snapshot_memory_limit_exceeded(self, *, stage: str) -> None:
        memory_status = self._snapshot_memory_status()
        memory_limit = self._memory_usage_limit()
        system_ratio = float(memory_status.get("system_memory_ratio") or 0.0)
        process_ratio = float(memory_status.get("process_memory_ratio") or 0.0)
        if process_ratio < memory_limit and system_ratio < SNAPSHOT_SYSTEM_MEMORY_EMERGENCY_LIMIT:
            return
        raise SnapshotMemoryPressureError(
            "Snapshot refresh stopped to protect memory usage. "
            f"stage={stage}; "
            f"system={system_ratio:.1%}; "
            f"process={process_ratio:.1%}; "
            f"limit={memory_limit:.0%}"
        )

    def _effective_snapshot_worker_cap(self, requested_cap: int) -> int:
        if requested_cap <= 1:
            return 1
        memory_status = self._snapshot_memory_status()
        system_ratio = float(memory_status.get("system_memory_ratio") or 0.0)
        process_ratio = float(memory_status.get("process_memory_ratio") or 0.0)
        if system_ratio >= 0.75 or process_ratio >= 0.60:
            return 1
        if system_ratio >= 0.70 or process_ratio >= 0.45:
            return min(requested_cap, 2)
        if system_ratio >= 0.60 or process_ratio >= 0.30:
            return min(requested_cap, 4)
        return requested_cap

    def _canonical_progress_total_symbol_count(
        self,
        *,
        progress_target_symbols: Sequence[str],
        existing_price_snapshot: Mapping[str, Any] | None,
        existing_corporate_snapshot: Mapping[str, Any] | None,
        existing_price_coverage: Sequence[Mapping[str, Any]],
        existing_corporate_coverage: Sequence[Mapping[str, Any]],
        existing_price_missing: Sequence[str],
        existing_corporate_missing: Sequence[str],
    ) -> int:
        return len(
            self._canonical_progress_target_symbols(
                progress_target_symbols=progress_target_symbols,
                existing_price_coverage=existing_price_coverage,
                existing_corporate_coverage=existing_corporate_coverage,
                existing_price_missing=existing_price_missing,
                existing_corporate_missing=existing_corporate_missing,
            )
        )

    def _snapshot_progress_extra_symbols(self) -> set[str]:
        extras: set[str] = set()
        for strategy in self.list_strategies():
            direct_symbol = self._direct_symbol_universe_symbol(strategy)
            if direct_symbol:
                extras.add(direct_symbol)
            benchmark_symbol = str(
                strategy.get("benchmark_symbol")
                or (strategy.get("parameters") or {}).get("benchmark_symbol")
                or ""
            ).strip().upper()
            normalized_benchmark_symbol = self._normalize_refresh_symbol(benchmark_symbol)
            if normalized_benchmark_symbol:
                extras.add(normalized_benchmark_symbol)
        return extras

    def _canonical_progress_target_symbols(
        self,
        *,
        progress_target_symbols: Sequence[str],
        existing_price_coverage: Sequence[Mapping[str, Any]],
        existing_corporate_coverage: Sequence[Mapping[str, Any]],
        existing_price_missing: Sequence[str],
        existing_corporate_missing: Sequence[str],
    ) -> list[str]:
        target_symbols = {
            normalized_symbol
            for row in self.market_data_repository.load_universe_memberships()
            for normalized_symbol in [self._normalize_refresh_symbol(row.get("symbol"))]
            if normalized_symbol
        }
        target_symbols.update(self._snapshot_progress_extra_symbols())
        if target_symbols:
            return sorted(target_symbols)

        candidate_symbols = {
            normalized_symbol
            for item in progress_target_symbols
            for normalized_symbol in [self._normalize_refresh_symbol(item)]
            if normalized_symbol
        }
        candidate_symbols.update(
            normalized_symbol
            for item in existing_price_coverage
            for normalized_symbol in [self._normalize_refresh_symbol(item.get("symbol"))]
            if normalized_symbol
        )
        candidate_symbols.update(
            normalized_symbol
            for item in existing_corporate_coverage
            for normalized_symbol in [self._normalize_refresh_symbol(item.get("symbol"))]
            if normalized_symbol
        )
        candidate_symbols.update(
            normalized_symbol
            for item in [*existing_price_missing, *existing_corporate_missing]
            for normalized_symbol in [self._normalize_refresh_symbol(item)]
            if normalized_symbol
        )
        return sorted(candidate_symbols)

    def _latest_universe_membership_state(
        self,
        rows: Sequence[Mapping[str, Any]],
    ) -> tuple[str | None, set[str]]:
        latest_effective_date: str | None = None
        latest_symbols: set[str] = set()
        for row in rows:
            effective_date = str(row.get("effective_date") or "").strip()
            symbol = str(row.get("symbol") or "").strip().upper()
            if not effective_date or not symbol:
                continue
            if latest_effective_date is None or effective_date > latest_effective_date:
                latest_effective_date = effective_date
                latest_symbols = {symbol}
            elif effective_date == latest_effective_date:
                latest_symbols.add(symbol)
        return latest_effective_date, latest_symbols

    def _empty_dataset_provider_telemetry(self) -> dict[str, dict[str, Any]]:
        def _bucket() -> dict[str, Any]:
            return {
                "providers": {},
                "attempted_providers": set(),
                "skipped_providers": set(),
                "unavailable_providers": set(),
            }

        return {
            DATASET_PRICE_SNAPSHOT_ID: _bucket(),
            DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID: _bucket(),
        }

    def _provider_metric_bucket(
        self,
        telemetry: dict[str, dict[str, Any]],
        snapshot_id: str,
        provider_name: str,
    ) -> dict[str, Any]:
        snapshot_bucket = telemetry.setdefault(
            snapshot_id,
            {
                "providers": {},
                "attempted_providers": set(),
                "skipped_providers": set(),
                "unavailable_providers": set(),
            },
        )
        providers = snapshot_bucket.setdefault("providers", {})
        return providers.setdefault(
            provider_name,
            {
                "kinds": set(),
                "reasons": set(),
                "attempted_symbols": 0,
                "succeeded_symbols": 0,
                "selected_primary_symbols": 0,
                "succeeded_not_selected_symbols": 0,
                "failed_symbols": 0,
                "limited_symbols": 0,
                "skipped_symbols": 0,
                "empty_symbols": 0,
                "unavailable_symbols": 0,
            },
        )

    def _record_provider_result(
        self,
        telemetry: dict[str, dict[str, Any]],
        *,
        snapshot_id: str,
        result: Mapping[str, Any],
    ) -> None:
        provider_name = str(result.get("provider") or "").strip()
        if not provider_name:
            return
        status = str(result.get("status") or "unknown").strip().lower()
        kind = str(result.get("kind") or "unknown").strip().lower()
        snapshot_bucket = telemetry.setdefault(
            snapshot_id,
            {
                "providers": {},
                "attempted_providers": set(),
                "skipped_providers": set(),
                "unavailable_providers": set(),
            },
        )
        metric_bucket = self._provider_metric_bucket(telemetry, snapshot_id, provider_name)
        metric_bucket["kinds"].add(kind)
        detail = str(result.get("reason") or result.get("error") or "").strip()
        if detail:
            metric_bucket.setdefault("reasons", set()).add(detail)
        if status in {"succeeded", "failed", "empty"}:
            snapshot_bucket["attempted_providers"].add(provider_name)
            metric_bucket["attempted_symbols"] += 1
        if status == "succeeded":
            metric_bucket["succeeded_symbols"] += 1
            selection_status = str(result.get("selection_status") or "").strip().lower()
            if selection_status == "selected_primary":
                metric_bucket["selected_primary_symbols"] += 1
            elif selection_status == "succeeded_not_selected":
                metric_bucket["succeeded_not_selected_symbols"] += 1
        elif status == "failed":
            metric_bucket["failed_symbols"] += 1
        elif status == "limited":
            snapshot_bucket["attempted_providers"].add(provider_name)
            metric_bucket["attempted_symbols"] += 1
            metric_bucket["limited_symbols"] += 1
        elif status == "empty":
            metric_bucket["empty_symbols"] += 1
        elif status == "skipped":
            snapshot_bucket["skipped_providers"].add(provider_name)
            metric_bucket["skipped_symbols"] += 1
        elif status == "unavailable":
            snapshot_bucket["unavailable_providers"].add(provider_name)
            metric_bucket["unavailable_symbols"] += 1

    def _record_market_data_provider_metadata(
        self,
        telemetry: dict[str, dict[str, Any]],
        metadata: Mapping[str, Any] | None,
    ) -> None:
        if not isinstance(metadata, Mapping):
            return
        provider_results = metadata.get("provider_results") or []
        for item in provider_results:
            if not isinstance(item, Mapping):
                continue
            kind = str(item.get("kind") or "").strip().lower()
            if kind in {"history", "history_availability"}:
                self._record_provider_result(
                    telemetry,
                    snapshot_id=DATASET_PRICE_SNAPSHOT_ID,
                    result=item,
                )
            if kind in {"history", "history_availability", "earnings", "earnings_availability", "filings", "filings_availability"}:
                self._record_provider_result(
                    telemetry,
                    snapshot_id=DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID,
                    result=item,
                )

    def _merge_dataset_provider_telemetry(
        self,
        base: dict[str, dict[str, Any]],
        incoming: Mapping[str, Any] | None,
    ) -> dict[str, dict[str, Any]]:
        if not isinstance(incoming, Mapping):
            return base
        for snapshot_id, snapshot_payload in incoming.items():
            if not isinstance(snapshot_payload, Mapping):
                continue
            target_bucket = base.setdefault(
                str(snapshot_id),
                {
                    "providers": {},
                    "attempted_providers": set(),
                    "skipped_providers": set(),
                    "unavailable_providers": set(),
                },
            )
            for field in ("attempted_providers", "skipped_providers", "unavailable_providers"):
                target_bucket.setdefault(field, set()).update(
                    str(item)
                    for item in (snapshot_payload.get(field) or [])
                    if str(item).strip()
                )
            for provider_name, provider_payload in (snapshot_payload.get("providers") or {}).items():
                if not isinstance(provider_payload, Mapping):
                    continue
                metric_bucket = self._provider_metric_bucket(base, str(snapshot_id), str(provider_name))
                metric_bucket["kinds"].update(
                    str(item)
                    for item in (provider_payload.get("kinds") or [])
                    if str(item).strip()
                )
                metric_bucket.setdefault("reasons", set()).update(
                    str(item)
                    for item in (provider_payload.get("reasons") or [])
                    if str(item).strip()
                )
                for metric_name in (
                    "attempted_symbols",
                    "succeeded_symbols",
                    "selected_primary_symbols",
                    "succeeded_not_selected_symbols",
                    "failed_symbols",
                    "limited_symbols",
                    "skipped_symbols",
                    "empty_symbols",
                    "unavailable_symbols",
                ):
                    metric_bucket[metric_name] += int(provider_payload.get(metric_name) or 0)
        return base

    def _provider_row_breakdown(
        self,
        rows: Sequence[Mapping[str, Any]],
    ) -> dict[str, dict[str, int]]:
        breakdown: dict[str, dict[str, Any]] = {}
        for row in rows:
            provider_name = str(row.get("source") or "").strip()
            symbol = str(row.get("symbol") or "").strip().upper()
            if not provider_name:
                continue
            bucket = breakdown.setdefault(
                provider_name,
                {
                    "landed_row_count": 0,
                    "symbols": set(),
                },
            )
            bucket["landed_row_count"] += 1
            if symbol:
                bucket["symbols"].add(symbol)
        return {
            provider_name: {
                "landed_row_count": int(payload["landed_row_count"]),
                "landed_symbol_count": len(payload["symbols"]),
            }
            for provider_name, payload in breakdown.items()
        }

    def _finalize_dataset_provider_telemetry(
        self,
        telemetry: Mapping[str, Any] | None,
        *,
        price_bars: Sequence[Mapping[str, Any]],
        corporate_actions: Sequence[Mapping[str, Any]],
    ) -> dict[str, Any]:
        normalized: dict[str, Any] = {}
        landed_breakdowns = {
            DATASET_PRICE_SNAPSHOT_ID: self._provider_row_breakdown(price_bars),
            DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID: self._provider_row_breakdown(corporate_actions),
        }
        for snapshot_id in (DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID, DATASET_PRICE_SNAPSHOT_ID):
            payload = telemetry.get(snapshot_id) if isinstance(telemetry, Mapping) else None
            providers_payload = payload.get("providers") if isinstance(payload, Mapping) else {}
            normalized_providers: dict[str, Any] = {}
            provider_names = set((providers_payload or {}).keys()) | set(landed_breakdowns[snapshot_id].keys())
            for provider_name in sorted(provider_names):
                source_payload = (
                    providers_payload.get(provider_name)
                    if isinstance(providers_payload, Mapping)
                    else {}
                ) or {}
                landed_payload = landed_breakdowns[snapshot_id].get(provider_name) or {}
                normalized_providers[provider_name] = {
                    "kinds": sorted(
                        str(item)
                        for item in (source_payload.get("kinds") or [])
                        if str(item).strip()
                    ),
                    "reasons": sorted(
                        str(item)
                        for item in (source_payload.get("reasons") or [])
                        if str(item).strip()
                    ),
                    "attempted_symbols": int(source_payload.get("attempted_symbols") or 0),
                    "succeeded_symbols": int(source_payload.get("succeeded_symbols") or 0),
                    "selected_primary_symbols": int(source_payload.get("selected_primary_symbols") or 0),
                    "succeeded_not_selected_symbols": int(source_payload.get("succeeded_not_selected_symbols") or 0),
                    "failed_symbols": int(source_payload.get("failed_symbols") or 0),
                    "limited_symbols": int(source_payload.get("limited_symbols") or 0),
                    "skipped_symbols": int(source_payload.get("skipped_symbols") or 0),
                    "empty_symbols": int(source_payload.get("empty_symbols") or 0),
                    "unavailable_symbols": int(source_payload.get("unavailable_symbols") or 0),
                    "landed_row_count": int(landed_payload.get("landed_row_count") or 0),
                    "landed_symbol_count": int(landed_payload.get("landed_symbol_count") or 0),
                }
            normalized[snapshot_id] = {
                "attempted_providers": sorted(
                    str(item)
                    for item in ((payload or {}).get("attempted_providers") or [])
                    if str(item).strip()
                ),
                "skipped_providers": sorted(
                    str(item)
                    for item in ((payload or {}).get("skipped_providers") or [])
                    if str(item).strip()
                ),
                "unavailable_providers": sorted(
                    str(item)
                    for item in ((payload or {}).get("unavailable_providers") or [])
                    if str(item).strip()
                ),
                "providers": normalized_providers,
            }
        return normalized

    def _build_universe_provider_summary(
        self,
        *,
        snapshot_id: str,
        anchor_snapshots: Sequence[Any],
        membership_rows: Sequence[Mapping[str, Any]],
    ) -> dict[str, Any]:
        ordered_anchor_snapshots = sorted(anchor_snapshots, key=lambda item: item.effective_date)
        source_names = sorted({str(item.source) for item in ordered_anchor_snapshots if item.source})
        fallback_sources = sorted({str(item.fallback_source) for item in ordered_anchor_snapshots if item.fallback_source})
        latest_snapshot = ordered_anchor_snapshots[-1] if ordered_anchor_snapshots else None
        historical_provider = (
            str((latest_snapshot.metadata or {}).get("historical_constituent_provider") or "").strip()
            if latest_snapshot is not None
            else ""
        )
        probe_status = (
            str((latest_snapshot.metadata or {}).get("historical_constituent_probe_status") or "").strip()
            if latest_snapshot is not None
            else ""
        )
        probe_error = (
            str((latest_snapshot.metadata or {}).get("historical_constituent_probe_error") or "").strip()
            if latest_snapshot is not None
            else ""
        )
        providers: dict[str, Any] = {}
        attempted_providers = set(source_names)
        skipped_providers: set[str] = set()
        unavailable_providers: set[str] = set()
        if historical_provider:
            attempted_providers.add(historical_provider)
        if historical_provider and probe_status and probe_status != "available":
            skipped_providers.add(historical_provider)
            unavailable_providers.add(historical_provider)
        membership_breakdown = self._provider_row_breakdown(membership_rows)
        for provider_name in source_names:
            landed_anchor_count = sum(1 for item in ordered_anchor_snapshots if str(item.source or "") == provider_name)
            landed_payload = membership_breakdown.get(provider_name) or {}
            providers[provider_name] = {
                "status": "succeeded",
                "landed_anchor_count": int(landed_anchor_count),
                "landed_row_count": int(landed_payload.get("landed_row_count") or 0),
                "landed_symbol_count": int(landed_payload.get("landed_symbol_count") or 0),
            }
        if historical_provider:
            landed_anchor_count = sum(
                1
                for item in ordered_anchor_snapshots
                if str((item.metadata or {}).get("source_quality") or "").lower() == "historical_constituent_api"
            )
            provider_bucket = providers.setdefault(
                historical_provider,
                {
                    "status": "succeeded" if landed_anchor_count else "skipped",
                    "landed_anchor_count": 0,
                    "landed_row_count": 0,
                    "landed_symbol_count": 0,
                },
            )
            provider_bucket["status"] = (
                "succeeded"
                if landed_anchor_count
                else ("skipped" if probe_status and probe_status != "available" else provider_bucket.get("status"))
            )
            provider_bucket["probe_status"] = probe_status or ("available" if landed_anchor_count else "")
            if probe_error:
                provider_bucket["reasons"] = [probe_error]
            provider_bucket["landed_anchor_count"] = int(landed_anchor_count)
        return {
            "attempted_providers": sorted(attempted_providers),
            "skipped_providers": sorted(skipped_providers),
            "unavailable_providers": sorted(unavailable_providers),
            "source_names": source_names,
            "fallback_sources": fallback_sources,
            "providers": providers,
        }

    def _build_refresh_stats(
        self,
        *,
        price_bars: Sequence[Mapping[str, Any]],
        corporate_actions: Sequence[Mapping[str, Any]],
        grouped_universe_snapshots: Mapping[str, Sequence[Any]],
        memberships_by_snapshot: Mapping[str, Sequence[Mapping[str, Any]]],
        existing_universe_memberships: Mapping[str, Sequence[Mapping[str, Any]]],
        dataset_provider_telemetry: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        price_symbols = {
            str(item.get("symbol") or "").strip().upper()
            for item in price_bars
            if str(item.get("symbol") or "").strip()
        }
        corporate_symbols = {
            str(item.get("symbol") or "").strip().upper()
            for item in corporate_actions
            if str(item.get("symbol") or "").strip()
        }
        universes: dict[str, dict[str, Any]] = {}
        for snapshot_id, anchor_snapshots in grouped_universe_snapshots.items():
            ordered_anchor_snapshots = sorted(anchor_snapshots, key=lambda item: item.effective_date)
            if not ordered_anchor_snapshots:
                continue
            latest_snapshot = ordered_anchor_snapshots[-1]
            latest_anchor_date = latest_snapshot.effective_date.isoformat()
            latest_members = {
                str(row.get("symbol") or "").strip().upper()
                for row in memberships_by_snapshot.get(snapshot_id, [])
                if str(row.get("effective_date") or "") == latest_anchor_date and str(row.get("symbol") or "").strip()
            }
            previous_rows = list(existing_universe_memberships.get(snapshot_id) or [])
            previous_same_anchor = {
                str(row.get("symbol") or "").strip().upper()
                for row in previous_rows
                if str(row.get("effective_date") or "") == latest_anchor_date and str(row.get("symbol") or "").strip()
            }
            if previous_same_anchor:
                changed_rows = len(latest_members.symmetric_difference(previous_same_anchor))
            else:
                _, previous_latest_members = self._latest_universe_membership_state(previous_rows)
                changed_rows = (
                    len(latest_members.symmetric_difference(previous_latest_members))
                    if previous_latest_members
                    else len(latest_members)
                )
            universes[snapshot_id] = {
                "name": str(latest_snapshot.universe_name or snapshot_id),
                "updated_row_count": int(changed_rows),
                "latest_anchor_date": latest_anchor_date,
                "provider_summary": self._build_universe_provider_summary(
                    snapshot_id=snapshot_id,
                    anchor_snapshots=ordered_anchor_snapshots,
                    membership_rows=memberships_by_snapshot.get(snapshot_id, []),
                ),
            }
        dataset_provider_summary = self._finalize_dataset_provider_telemetry(
            dataset_provider_telemetry,
            price_bars=price_bars,
            corporate_actions=corporate_actions,
        )
        return {
            "datasets": {
                DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID: {
                    "name": "\u516c\u53f8\u884c\u4e3a\u6570\u636e",
                    "updated_symbol_count": int(len(corporate_symbols)),
                    "updated_row_count": int(len(corporate_actions)),
                    "provider_summary": dataset_provider_summary.get(DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID, {}),
                },
                DATASET_PRICE_SNAPSHOT_ID: {
                    "name": "\u80a1\u7968\u4ef7\u683c\u6570\u636e",
                    "updated_symbol_count": int(len(price_symbols)),
                    "updated_row_count": int(len(price_bars)),
                    "provider_summary": dataset_provider_summary.get(DATASET_PRICE_SNAPSHOT_ID, {}),
                },
            },
            "universes": universes,
        }

    def _collect_market_data_refresh_batch(
        self,
        *,
        symbols: Sequence[str],
        window_start: date,
        window_end: date,
        primary_provider: Any | None,
        fallback_provider: Any,
        fallback_availability: Any | None,
        worker_cap: int,
    ) -> dict[str, Any]:
        price_bars: list[dict[str, Any]] = []
        corporate_actions: list[dict[str, Any]] = []
        coverage_rows: list[CoverageSummary] = []
        corporate_coverage_rows: list[CoverageSummary] = []
        dataset_provider_telemetry = self._empty_dataset_provider_telemetry()
        missing_symbols: list[str] = []
        corporate_missing_symbols: list[str] = []
        warnings: list[str] = []
        errors: list[str] = []
        action_partial = False
        ordered_symbols = sorted({str(symbol or "").strip().upper() for symbol in symbols if str(symbol or "").strip()})
        synthetic_dates = self._business_days_between(window_start, window_end) if primary_provider is None else []
        self._raise_if_snapshot_memory_limit_exceeded(stage="market_data_batch_preflight")
        dynamic_worker_cap = self._effective_snapshot_worker_cap(worker_cap)
        max_workers = min(dynamic_worker_cap, len(ordered_symbols)) if ordered_symbols else 0
        with ThreadPoolExecutor(max_workers=max_workers or 1, thread_name_prefix="snapshot-market-data") as executor:
            futures = {
                executor.submit(
                    self._fetch_market_data_for_symbol,
                    symbol=symbol,
                    index=index,
                    window_start=window_start,
                    window_end=window_end,
                    primary_provider=primary_provider,
                    fallback_provider=fallback_provider,
                    fallback_availability=fallback_availability,
                    synthetic_dates=synthetic_dates,
                ): symbol
                for index, symbol in enumerate(ordered_symbols)
            }
            for future in as_completed(futures):
                symbol = futures[future]
                self._raise_if_snapshot_memory_limit_exceeded(stage=f"market_data_batch_collect:{symbol}")
                try:
                    fetch_result = future.result()
                except Exception as exc:
                    missing_symbols.append(symbol)
                    corporate_missing_symbols.append(symbol)
                    errors.append(f"{symbol}: unexpected refresh failure={exc}")
                    continue

                error = fetch_result.get("error")
                identity = fetch_result.get("identity")
                if isinstance(identity, Mapping) and identity.get("symbol"):
                    self.market_data_repository.upsert_symbol_identity(identity)
                error_metadata = dict(fetch_result.get("error_metadata") or {})
                self._record_market_data_provider_metadata(dataset_provider_telemetry, error_metadata)
                if error:
                    missing_symbols.append(symbol)
                    corporate_missing_symbols.append(symbol)
                    errors.append(str(error))
                    continue

                market_data = fetch_result.get("market_data")
                market_data_source = getattr(market_data, "source", None) or (
                    market_data.get("source") if isinstance(market_data, Mapping) else None
                )
                market_data_fallback_source = getattr(market_data, "fallback_source", None) or (
                    market_data.get("fallback_source") if isinstance(market_data, Mapping) else None
                )
                market_data_metadata = dict(
                    getattr(market_data, "metadata", None)
                    or (market_data.get("metadata") if isinstance(market_data, Mapping) else {})
                )
                self._record_market_data_provider_metadata(dataset_provider_telemetry, market_data_metadata)
                bars = list(
                    getattr(market_data, "bars", None)
                    or (market_data.get("bars", []) if isinstance(market_data, Mapping) else [])
                )
                actions = list(
                    getattr(market_data, "actions", None)
                    or (market_data.get("actions", []) if isinstance(market_data, Mapping) else [])
                )
                warning_items = list(
                    getattr(market_data, "warnings", None)
                    or (market_data.get("warnings", []) if isinstance(market_data, Mapping) else [])
                )
                warnings.extend(str(item) for item in warning_items if item)
                action_partial = action_partial or bool(
                    getattr(market_data, "partial", None)
                    or (market_data.get("partial") if isinstance(market_data, Mapping) else False)
                )
                if not bars:
                    missing_symbols.append(symbol)
                    corporate_missing_symbols.append(symbol)
                    continue

                normalized_bars: list[dict[str, Any]] = []
                for bar in bars:
                    normalized_bars.append(
                        {
                            "symbol": symbol,
                            "date": getattr(bar, "date", None) or bar.get("date"),
                            "open": getattr(bar, "open", None) if hasattr(bar, "open") else bar.get("open"),
                            "high": getattr(bar, "high", None) if hasattr(bar, "high") else bar.get("high"),
                            "low": getattr(bar, "low", None) if hasattr(bar, "low") else bar.get("low"),
                            "close": getattr(bar, "close", None) if hasattr(bar, "close") else bar.get("close"),
                            "adj_close": getattr(bar, "adj_close", None) if hasattr(bar, "adj_close") else bar.get("adj_close"),
                            "volume": getattr(bar, "volume", None) if hasattr(bar, "volume") else bar.get("volume"),
                            "source": market_data_source or getattr(primary_provider, "provider_name", "synthetic_seed"),
                            "fallback_source": market_data_fallback_source,
                            "metadata": market_data_metadata,
                        }
                    )
                normalized_actions = [
                    {
                        "symbol": symbol,
                        "date": str(item.get("date")),
                        "action_type": str(item.get("action_type") or item.get("type") or "unknown"),
                        "value": item.get("value"),
                        "source": str(
                            item.get("source")
                            or market_data_source
                            or getattr(primary_provider, "provider_name", "synthetic_seed")
                        ),
                        "fallback_source": item.get("fallback_source", market_data_fallback_source),
                        "payload": dict(item.get("payload") or {}),
                    }
                    for item in actions
                ]
                price_bars.extend(normalized_bars)
                corporate_actions.extend(normalized_actions)
                if normalized_actions:
                    action_dates = [
                        str(item.get("date") or "").strip()
                        for item in normalized_actions
                        if str(item.get("date") or "").strip()
                    ]
                    if not action_dates:
                        action_dates = [str(normalized_bars[0]["date"]), str(normalized_bars[-1]["date"])]
                    corporate_coverage_rows.append(
                        CoverageSummary(
                            symbol=symbol,
                            start_date=min(action_dates),
                            end_date=max(action_dates),
                            trade_days=len(normalized_actions),
                        )
                    )
                else:
                    corporate_missing_symbols.append(symbol)
                coverage_rows.append(
                    CoverageSummary(
                        symbol=symbol,
                        start_date=str(normalized_bars[0]["date"]),
                        end_date=str(normalized_bars[-1]["date"]),
                        trade_days=len(normalized_bars),
                    )
                )

        return {
            "price_bars": price_bars,
            "corporate_actions": corporate_actions,
            "coverage_rows": coverage_rows,
            "corporate_coverage_rows": corporate_coverage_rows,
            "missing_symbols": sorted(set(missing_symbols)),
            "corporate_missing_symbols": sorted(set(corporate_missing_symbols)),
            "warnings": warnings,
            "errors": errors,
            "action_partial": action_partial,
            "ordered_symbols": ordered_symbols,
            "dataset_provider_telemetry": dataset_provider_telemetry,
        }

    def _select_market_data_refresh_symbols(
        self,
        *,
        mode: str,
        targets: Sequence[str],
        universe_snapshots: Sequence[Any],
        existing_price_snapshot: Mapping[str, Any] | None,
        existing_corporate_snapshot: Mapping[str, Any] | None,
    ) -> tuple[list[str], dict[str, Any]]:
        metadata: dict[str, Any] = {"selection_mode": mode}
        if mode == "repair":
            existing_missing = list(
                dict.fromkeys(
                    [
                        *self._snapshot_missing_symbols(existing_price_snapshot),
                        *self._snapshot_missing_symbols(existing_corporate_snapshot),
                    ]
                )
            )
            if existing_missing:
                cursor = self._snapshot_repair_cursor(existing_price_snapshot or existing_corporate_snapshot)
                batch_size = max(1, SNAPSHOT_REPAIR_SYMBOL_BATCH_SIZE)
                selected, next_cursor = self._repair_symbol_batch(existing_missing, cursor, batch_size)
                latest_symbols = self._latest_universe_symbols(universe_snapshots) if "universes" in targets else []
                combined_selection = list(dict.fromkeys([*selected, *latest_symbols]))
                metadata.update(
                    {
                        "selection_mode": (
                            "repair_missing_symbols_batch_plus_latest_members"
                            if latest_symbols
                            else "repair_missing_symbols_batch"
                        ),
                        "existing_missing_symbol_count": len(existing_missing),
                        "selected_missing_symbols": selected,
                        "selected_latest_symbols": latest_symbols,
                        "selected_symbol_count": len(combined_selection),
                        "repair_cursor": next_cursor,
                    }
                )
                return combined_selection, metadata
            if "universes" in targets:
                latest_symbols = self._latest_universe_symbols(universe_snapshots)
                if latest_symbols:
                    metadata.update(
                        {
                            "selection_mode": "repair_latest_members",
                            "selected_symbol_count": len(latest_symbols),
                            "selected_latest_symbols": latest_symbols,
                            "existing_missing_symbol_count": len(existing_missing),
                        }
                    )
                    return latest_symbols, metadata
        if mode == "incremental":
            latest_symbols = self._latest_universe_symbols(universe_snapshots)
            if latest_symbols:
                metadata.update(
                    {
                        "selection_mode": "incremental_latest_members",
                        "selected_symbol_count": len(latest_symbols),
                    }
                )
                return latest_symbols, metadata
        symbols = collect_snapshot_symbols(list(universe_snapshots))
        metadata.update({"selection_mode": "full_snapshot_union", "selected_symbol_count": len(symbols)})
        return symbols, metadata

    def _coverage_rows_from_price_bars(self, price_bars: Iterable[Mapping[str, Any]]) -> list[CoverageSummary]:
        grouped_dates: dict[str, list[str]] = {}
        for bar in price_bars:
            symbol = str(bar.get("symbol") or "").upper()
            trade_date = str(bar.get("date") or "")
            if not symbol or not trade_date:
                continue
            grouped_dates.setdefault(symbol, []).append(trade_date)
        coverage_rows: list[CoverageSummary] = []
        for symbol, dates in grouped_dates.items():
            ordered_dates = sorted(dates)
            coverage_rows.append(
                CoverageSummary(
                    symbol=symbol,
                    start_date=ordered_dates[0],
                    end_date=ordered_dates[-1],
                    trade_days=len(ordered_dates),
                )
            )
        return coverage_rows

    def _stored_snapshot_symbols(self) -> set[str]:
        symbols: set[str] = set()
        for snapshot_id in (SP500_UNIVERSE_SNAPSHOT_ID, NASDAQ100_UNIVERSE_SNAPSHOT_ID):
            for row in self.market_data_repository.load_universe_memberships(universe_snapshot_id=snapshot_id):
                symbol = str(row.get("symbol") or "").upper()
                if symbol:
                    symbols.add(symbol)
        existing_price_rows = self.market_data_repository.load_dataset_snapshot_rows(DATASET_PRICE_SNAPSHOT_ID)
        for row in existing_price_rows.get("symbol_coverage") or []:
            symbol = str(row.get("symbol") or "").upper()
            if symbol:
                symbols.add(symbol)
        return symbols

    def _merge_price_snapshot_rows(
        self,
        existing_rows: Iterable[Mapping[str, Any]],
        refreshed_rows: Iterable[Mapping[str, Any]],
    ) -> list[dict[str, Any]]:
        merged: dict[tuple[str, str], dict[str, Any]] = {}
        for row in existing_rows:
            symbol = str(row.get("symbol") or "").upper()
            trade_date = str(row.get("date") or "")
            if symbol and trade_date:
                merged[(symbol, trade_date)] = {
                    "symbol": symbol,
                    "date": trade_date,
                    "open": row.get("open"),
                    "high": row.get("high"),
                    "low": row.get("low"),
                    "close": row.get("close"),
                    "adj_close": row.get("adj_close", row.get("close")),
                    "volume": row.get("volume"),
                    "source": row.get("source"),
                    "fallback_source": row.get("fallback_source"),
                    "metadata": dict(row.get("metadata") or {}),
                }
        for row in refreshed_rows:
            symbol = str(row.get("symbol") or "").upper()
            trade_date = str(row.get("date") or "")
            if symbol and trade_date:
                merged[(symbol, trade_date)] = {
                    "symbol": symbol,
                    "date": trade_date,
                    "open": row.get("open"),
                    "high": row.get("high"),
                    "low": row.get("low"),
                    "close": row.get("close"),
                    "adj_close": row.get("adj_close", row.get("close")),
                    "volume": row.get("volume"),
                    "source": row.get("source"),
                    "fallback_source": row.get("fallback_source"),
                    "metadata": dict(row.get("metadata") or {}),
                }
        return [merged[key] for key in sorted(merged)]

    def _merge_action_snapshot_rows(
        self,
        existing_rows: Iterable[Mapping[str, Any]],
        refreshed_rows: Iterable[Mapping[str, Any]],
    ) -> list[dict[str, Any]]:
        merged: dict[tuple[str, str, str], dict[str, Any]] = {}
        for row in existing_rows:
            symbol = str(row.get("symbol") or "").upper()
            event_date = str(row.get("date") or row.get("event_date") or "")
            event_type = str(row.get("action_type") or row.get("event_type") or "unknown")
            if symbol and event_date:
                merged[(symbol, event_date, event_type)] = {
                    "symbol": symbol,
                    "date": event_date,
                    "action_type": event_type,
                    "value": row.get("value"),
                    "source": row.get("source"),
                    "fallback_source": row.get("fallback_source"),
                    "payload": dict(row.get("payload") or {}),
                }
        for row in refreshed_rows:
            symbol = str(row.get("symbol") or "").upper()
            event_date = str(row.get("date") or row.get("event_date") or "")
            event_type = str(row.get("action_type") or row.get("event_type") or "unknown")
            if symbol and event_date:
                merged[(symbol, event_date, event_type)] = {
                    "symbol": symbol,
                    "date": event_date,
                    "action_type": event_type,
                    "value": row.get("value"),
                    "source": row.get("source"),
                    "fallback_source": row.get("fallback_source"),
                    "payload": dict(row.get("payload") or {}),
                }
        return [merged[key] for key in sorted(merged)]

    def _merge_coverage_rows(
        self,
        existing_rows: Iterable[CoverageSummary | Mapping[str, Any]],
        refreshed_rows: Iterable[CoverageSummary | Mapping[str, Any]],
    ) -> list[CoverageSummary]:
        merged: dict[str, CoverageSummary] = {}
        for row in existing_rows:
            item = row if isinstance(row, Mapping) else {
                "symbol": row.symbol,
                "start_date": row.start_date,
                "end_date": row.end_date,
                "trade_days": row.trade_days,
            }
            symbol = str(item.get("symbol") or "").upper()
            if not symbol:
                continue
            merged[symbol] = CoverageSummary(
                symbol=symbol,
                start_date=item.get("start_date"),
                end_date=item.get("end_date"),
                trade_days=int(item.get("trade_days") or 0),
            )
        for row in refreshed_rows:
            item = row if isinstance(row, Mapping) else {
                "symbol": row.symbol,
                "start_date": row.start_date,
                "end_date": row.end_date,
                "trade_days": row.trade_days,
            }
            symbol = str(item.get("symbol") or "").upper()
            if not symbol:
                continue
            merged[symbol] = CoverageSummary(
                symbol=symbol,
                start_date=item.get("start_date"),
                end_date=item.get("end_date"),
                trade_days=int(item.get("trade_days") or 0),
            )
        return [merged[key] for key in sorted(merged)]

    def _persist_market_dataset_snapshots(
        self,
        *,
        as_of: str,
        mode: str,
        snapshot_window_start: date,
        window_end: date,
        selection_metadata: Mapping[str, Any],
        existing_price_snapshot: Mapping[str, Any] | None,
        existing_corporate_snapshot: Mapping[str, Any] | None,
        existing_price_rows: Mapping[str, Any],
        existing_corporate_rows: Mapping[str, Any],
        price_bars: Sequence[Mapping[str, Any]],
        corporate_actions: Sequence[Mapping[str, Any]],
        coverage_rows: Sequence[CoverageSummary],
        corporate_coverage_rows: Sequence[CoverageSummary],
        effective_missing_symbols: Sequence[str],
        effective_corporate_missing_symbols: Sequence[str],
        action_partial: bool,
        canonical_target_symbols: Sequence[str],
        canonical_total_symbol_count: int,
        default_source_name: str,
        default_fallback_name: str | None,
        cold_backup_result: Mapping[str, Any] | None = None,
        recovery_report: Any | None = None,
        running: bool = False,
    ) -> None:
        def summarize_source(values: Sequence[str], default: str) -> str:
            cleaned = [str(value) for value in values if str(value or "").strip()]
            if not cleaned:
                return default
            return cleaned[0] if len(cleaned) == 1 else "mixed_sources"

        def summarize_fallback(values: Sequence[str], fallback_default: str | None = None) -> str | None:
            cleaned = [str(value) for value in values if str(value or "").strip()]
            if cleaned:
                return cleaned[0] if len(cleaned) == 1 else "mixed_fallbacks"
            return fallback_default

        merge_existing_market_data = mode in {"incremental", "repair"}
        freshness_label = "后台更新中" if running else "刚刚刷新"
        price_sources = sorted({str(item.get("source") or "") for item in price_bars if item.get("source")})
        price_fallback_sources = sorted(
            {str(item.get("fallback_source") or "") for item in price_bars if item.get("fallback_source")}
        )
        action_sources = sorted({str(item.get("source") or "") for item in corporate_actions if item.get("source")})
        action_fallback_sources = sorted(
            {str(item.get("fallback_source") or "") for item in corporate_actions if item.get("fallback_source")}
        )
        price_source_name = summarize_source(price_sources, default_source_name)
        price_fallback_name = summarize_fallback(price_fallback_sources, default_fallback_name)
        action_source_name = summarize_source(action_sources, default_source_name)
        action_fallback_name = summarize_fallback(action_fallback_sources, default_fallback_name)

        price_status = "READY" if price_bars and not effective_missing_symbols else ("FAILED" if not price_bars else "INCOMPLETE")
        corporate_status = "READY"
        if not corporate_actions:
            corporate_status = "FAILED" if not price_bars else "INCOMPLETE"
        elif action_partial or effective_corporate_missing_symbols:
            corporate_status = "INCOMPLETE"

        existing_price_snapshot = dict(existing_price_snapshot or {})
        existing_corporate_snapshot = dict(existing_corporate_snapshot or {})
        existing_price_coverage = list(existing_price_rows.get("symbol_coverage") or [])
        existing_corporate_actions = list(existing_corporate_rows.get("corporate_actions") or [])
        existing_corporate_coverage = list(existing_corporate_rows.get("symbol_coverage") or [])

        merged_coverage_rows = (
            self._merge_coverage_rows(existing_price_coverage, coverage_rows)
            if merge_existing_market_data
            else list(coverage_rows)
        )
        price_start_date = (
            min(str(item.start_date) for item in merged_coverage_rows if getattr(item, "start_date", None))
            if merged_coverage_rows
            else (existing_price_snapshot.get("start_date") or snapshot_window_start.isoformat())
        )
        price_end_date = (
            max(str(item.end_date) for item in merged_coverage_rows if getattr(item, "end_date", None))
            if merged_coverage_rows
            else (existing_price_snapshot.get("end_date") or window_end.isoformat())
        )
        price_snapshot_writer = (
            self.market_data_repository.merge_dataset_snapshot
            if merge_existing_market_data
            else self.market_data_repository.replace_dataset_snapshot
        )
        if price_bars:
            price_snapshot_writer(
                {
                    "id": DATASET_PRICE_SNAPSHOT_ID,
                    "name": "股票价格数据",
                    "status": price_status,
                    "as_of": as_of,
                    "freshness_label": freshness_label,
                    "start_date": price_start_date,
                    "end_date": price_end_date,
                    "row_count": len(price_bars),
                    "source": price_source_name,
                    "fallback_source": price_fallback_name,
                    "blocker": {}
                    if price_status == "READY"
                    else {
                        "code": "PRICE_SNAPSHOT_INCOMPLETE" if price_bars else "PRICE_SNAPSHOT_FAILED",
                        "message": (
                            "价格快照仍在补齐中，新的价格行会继续增量写入。"
                            if running
                            else "Price snapshot is still incomplete. Please retry after the missing symbols are repaired."
                        ),
                    },
                    "metadata": self._dataset_progress_metadata(
                        symbol_coverage=merged_coverage_rows,
                        missing_symbols=effective_missing_symbols,
                        existing_metadata={
                            "missing_symbols": list(effective_missing_symbols),
                            "source_names": price_sources,
                            "fallback_sources": price_fallback_sources,
                            "cold_backup_result": cold_backup_result or {},
                            "recovery_report": recovery_report.as_dict() if recovery_report else {},
                            "target_symbol_count": canonical_total_symbol_count,
                            **dict(selection_metadata),
                        },
                        total_symbol_count_override=canonical_total_symbol_count,
                        target_symbols=canonical_target_symbols,
                    ),
                },
                price_bars=list(price_bars),
                symbol_coverage=merged_coverage_rows,
            )
            if merge_existing_market_data:
                corrected_price_metadata = self._dataset_progress_metadata(
                    symbol_coverage=self.market_data_repository.load_dataset_symbol_coverage(DATASET_PRICE_SNAPSHOT_ID),
                    missing_symbols=effective_missing_symbols,
                    existing_metadata={
                        "missing_symbols": list(effective_missing_symbols),
                        "source_names": price_sources,
                        "fallback_sources": price_fallback_sources,
                        "cold_backup_result": cold_backup_result or {},
                        "recovery_report": recovery_report.as_dict() if recovery_report else {},
                        "target_symbol_count": canonical_total_symbol_count,
                        **dict(selection_metadata),
                    },
                    total_symbol_count_override=canonical_total_symbol_count,
                    target_symbols=canonical_target_symbols,
                )
                self.market_data_repository.merge_dataset_snapshot(
                    {
                        "id": DATASET_PRICE_SNAPSHOT_ID,
                        "name": "股票价格数据",
                        "status": price_status,
                        "as_of": as_of,
                        "freshness_label": freshness_label,
                        "start_date": price_start_date,
                        "end_date": price_end_date,
                        "row_count": self.market_data_repository.count_dataset_snapshot_rows(DATASET_PRICE_SNAPSHOT_ID)["price_bars"],
                        "source": price_source_name,
                        "fallback_source": price_fallback_name,
                        "blocker": {}
                        if price_status == "READY"
                        else {
                            "code": "PRICE_SNAPSHOT_INCOMPLETE" if price_bars else "PRICE_SNAPSHOT_FAILED",
                            "message": (
                                "价格快照仍在补齐中，新的价格行会继续增量写入。"
                                if running
                                else "Price snapshot is still incomplete. Please retry after the missing symbols are repaired."
                            ),
                        },
                        "metadata": corrected_price_metadata,
                    },
                )

        merged_corporate_coverage = (
            self._merge_coverage_rows(existing_corporate_coverage, corporate_coverage_rows)
            if merge_existing_market_data
            else list(corporate_coverage_rows)
        )
        corporate_start_date = (
            min(str(item.start_date) for item in merged_corporate_coverage if getattr(item, "start_date", None))
            if merged_corporate_coverage
            else (
                min(str(item.get("date")) for item in corporate_actions if item.get("date"))
                if corporate_actions
                else (existing_corporate_snapshot.get("start_date") or snapshot_window_start.isoformat())
            )
        )
        corporate_end_date = (
            max(str(item.end_date) for item in merged_corporate_coverage if getattr(item, "end_date", None))
            if merged_corporate_coverage
            else (
                max(str(item.get("date")) for item in corporate_actions if item.get("date"))
                if corporate_actions
                else (existing_corporate_snapshot.get("end_date") or window_end.isoformat())
            )
        )
        preserve_existing_corporate_snapshot = (
            merge_existing_market_data
            and not corporate_actions
            and bool(existing_corporate_snapshot)
            and int(existing_corporate_snapshot.get("row_count") or 0) > 0
        )
        corporate_snapshot_writer = (
            self.market_data_repository.merge_dataset_snapshot
            if merge_existing_market_data
            else self.market_data_repository.replace_dataset_snapshot
        )
        if (corporate_actions or not existing_corporate_actions) and not preserve_existing_corporate_snapshot:
            corporate_snapshot_writer(
                {
                    "id": DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID,
                    "name": "公司行为数据",
                    "status": corporate_status,
                    "as_of": as_of,
                    "freshness_label": freshness_label,
                    "start_date": corporate_start_date,
                    "end_date": corporate_end_date,
                    "row_count": len(corporate_actions),
                    "source": action_source_name,
                    "fallback_source": action_fallback_name,
                    "blocker": {}
                    if corporate_status == "READY"
                    else {
                        "code": "CORPORATE_ACTIONS_INCOMPLETE" if corporate_actions else "CORPORATE_ACTIONS_FAILED",
                        "message": (
                            "公司行为快照仍在补齐中，新的事件会继续增量写入。"
                            if running
                            else "Corporate action snapshot is still incomplete. Please retry after the missing events are repaired."
                        ),
                    },
                    "metadata": self._dataset_progress_metadata(
                        symbol_coverage=merged_corporate_coverage,
                        missing_symbols=effective_corporate_missing_symbols,
                        existing_metadata={
                            "missing_symbols": list(effective_corporate_missing_symbols),
                            "partial": action_partial,
                            "source_names": action_sources,
                            "fallback_sources": action_fallback_sources,
                            "cold_backup_result": cold_backup_result or {},
                            "recovery_report": recovery_report.as_dict() if recovery_report else {},
                            "progress_metric": "corporate_action_symbols",
                            "target_symbol_count": canonical_total_symbol_count,
                            "selected_symbol_count": canonical_total_symbol_count,
                            **dict(selection_metadata),
                        },
                        covered_symbols=[str(item.get("symbol") or "") for item in corporate_actions],
                        total_symbol_count_override=canonical_total_symbol_count,
                        target_symbols=canonical_target_symbols,
                    ),
                },
                corporate_actions=list(corporate_actions),
                symbol_coverage=merged_corporate_coverage,
            )
            if merge_existing_market_data:
                corrected_corporate_rows = self.market_data_repository.summarize_dataset_symbols(
                    DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID
                )
                corrected_corporate_coverage = self.market_data_repository.load_dataset_symbol_coverage(
                    DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID
                )
                self.market_data_repository.merge_dataset_snapshot(
                    {
                        "id": DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID,
                        "name": "公司行为数据",
                        "status": corporate_status,
                        "as_of": as_of,
                        "freshness_label": freshness_label,
                        "start_date": corporate_start_date,
                        "end_date": corporate_end_date,
                        "row_count": self.market_data_repository.count_dataset_snapshot_rows(
                            DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID
                        )["corporate_actions"],
                        "source": action_source_name,
                        "fallback_source": action_fallback_name,
                        "blocker": {}
                        if corporate_status == "READY"
                        else {
                            "code": "CORPORATE_ACTIONS_INCOMPLETE" if corporate_actions else "CORPORATE_ACTIONS_FAILED",
                            "message": (
                                "公司行为快照仍在补齐中，新的事件会继续增量写入。"
                                if running
                                else "Corporate action snapshot is still incomplete. Please retry after the missing events are repaired."
                            ),
                        },
                        "metadata": self._dataset_progress_metadata(
                            symbol_coverage=corrected_corporate_coverage or corrected_corporate_rows,
                            missing_symbols=effective_corporate_missing_symbols,
                            existing_metadata={
                                "missing_symbols": list(effective_corporate_missing_symbols),
                                "partial": action_partial,
                                "source_names": action_sources,
                                "fallback_sources": action_fallback_sources,
                                "cold_backup_result": cold_backup_result or {},
                                "recovery_report": recovery_report.as_dict() if recovery_report else {},
                                "progress_metric": "corporate_action_symbols",
                                "target_symbol_count": canonical_total_symbol_count,
                                "selected_symbol_count": canonical_total_symbol_count,
                                **dict(selection_metadata),
                            },
                            covered_symbols=[str(item.get("symbol") or "") for item in corrected_corporate_rows],
                            total_symbol_count_override=canonical_total_symbol_count,
                            target_symbols=canonical_target_symbols,
                        ),
                    },
                )
        elif preserve_existing_corporate_snapshot:
            preserved_actions = [
                {
                    "symbol": str(item.get("symbol") or ""),
                    "date": str(item.get("date") or item.get("event_date") or ""),
                    "action_type": str(item.get("action_type") or item.get("event_type") or "unknown"),
                    "value": item.get("value"),
                    "source": item.get("source"),
                    "fallback_source": item.get("fallback_source"),
                    "payload": dict(item.get("payload") or {}),
                }
                for item in existing_corporate_actions
            ]
            self.market_data_repository.replace_dataset_snapshot(
                {
                    "id": DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID,
                    "name": "公司行为数据",
                    "status": "STALE" if not running else "RUNNING",
                    "as_of": existing_corporate_snapshot.get("as_of") or as_of,
                    "freshness_label": "继续使用已有快照" if not running else freshness_label,
                    "start_date": existing_corporate_snapshot.get("start_date") or snapshot_window_start.isoformat(),
                    "end_date": existing_corporate_snapshot.get("end_date") or window_end.isoformat(),
                    "row_count": len(preserved_actions),
                    "source": str(existing_corporate_snapshot.get("source") or "") or "existing_snapshot_rows",
                    "fallback_source": action_fallback_name or existing_corporate_snapshot.get("fallback_source"),
                    "blocker": {
                        "code": "CORPORATE_ACTIONS_INCOMPLETE",
                        "message": (
                            "公司行为快照继续沿用已有结果，本轮尚未抓到新增事件。"
                            if running
                            else "Corporate action snapshot stayed on the previous rows because this refresh did not return new events."
                        ),
                    },
                    "metadata": self._dataset_progress_metadata(
                        symbol_coverage=existing_corporate_coverage or corporate_coverage_rows,
                        missing_symbols=effective_corporate_missing_symbols,
                        existing_metadata={
                            **dict(existing_corporate_snapshot.get("metadata") or {}),
                            "missing_symbols": list(effective_corporate_missing_symbols),
                            "partial": action_partial,
                            "cold_backup_result": cold_backup_result or {},
                            "recovery_report": recovery_report.as_dict() if recovery_report else {},
                            "preserved_existing_snapshot": True,
                            "progress_metric": "corporate_action_symbols",
                            "target_symbol_count": canonical_total_symbol_count,
                            "selected_symbol_count": canonical_total_symbol_count,
                            **dict(selection_metadata),
                        },
                        covered_symbols=[str(item.get("symbol") or "") for item in preserved_actions],
                        total_symbol_count_override=canonical_total_symbol_count,
                        target_symbols=canonical_target_symbols,
                    ),
                },
                corporate_actions=preserved_actions,
                symbol_coverage=existing_corporate_coverage or coverage_rows,
            )

    def _restore_dataset_snapshots_from_snapshot_rows(self, *, as_of: str) -> list[str]:
        restored_ids: list[str] = []
        dataset_rows = {str(item["id"]): item for item in self.market_data_repository.list_dataset_snapshots()}
        for defaults in self._dataset_snapshot_defaults():
            snapshot_id = str(defaults["id"])
            existing_row = dataset_rows.get(snapshot_id)
            if not self._snapshot_row_is_placeholder(existing_row, count_key="row_count"):
                continue
            snapshot_rows = self.market_data_repository.load_dataset_snapshot_rows(snapshot_id)
            price_bars = list(snapshot_rows.get("price_bars") or [])
            corporate_actions = list(snapshot_rows.get("corporate_actions") or [])
            coverage_rows = list(snapshot_rows.get("symbol_coverage") or [])
            preferred_freshness_label = (
                existing_row.get("freshness_label")
                if existing_row
                and existing_row.get("freshness_label")
                and str(existing_row.get("freshness_label")) not in {"freshness_pending", "pending", "\u5c1a\u672a\u5237\u65b0"}
                else "\u5df2\u4ece\u73b0\u6709\u5feb\u7167\u6062\u590d"
            )
            if snapshot_id == DATASET_PRICE_SNAPSHOT_ID and price_bars:
                effective_coverage = coverage_rows or self._coverage_rows_from_price_bars(price_bars)
                self.market_data_repository.replace_dataset_snapshot(
                    {
                        "id": snapshot_id,
                        "name": "\u80a1\u7968\u4ef7\u683c\u6570\u636e",
                        "status": str(existing_row.get("status") or "STALE") if existing_row else "STALE",
                        "as_of": existing_row.get("as_of") if existing_row and existing_row.get("as_of") else as_of,
                        "freshness_label": preferred_freshness_label,
                        "start_date": (
                            existing_row.get("start_date")
                            if existing_row and existing_row.get("start_date")
                            else min(str(row.get("date")) for row in price_bars if row.get("date"))
                        ),
                        "end_date": (
                            existing_row.get("end_date")
                            if existing_row and existing_row.get("end_date")
                            else max(str(row.get("date")) for row in price_bars if row.get("date"))
                        ),
                        "row_count": len(price_bars),
                        "source": (
                            str(existing_row.get("source") or "")
                            if existing_row and existing_row.get("source")
                            else str(price_bars[0].get("source") or "existing_snapshot_rows")
                        ),
                        "fallback_source": (
                            existing_row.get("fallback_source")
                            if existing_row and existing_row.get("fallback_source")
                            else price_bars[0].get("fallback_source")
                        ),
                        "blocker": dict(existing_row.get("blocker") or {}) if existing_row else {},
                        "metadata": self._dataset_progress_metadata(
                            symbol_coverage=effective_coverage,
                            missing_symbols=(dict(existing_row.get("metadata") or {}).get("missing_symbols") if existing_row else []),
                            existing_metadata={
                                **(dict(existing_row.get("metadata") or {}) if existing_row else {}),
                                "restored_from": "dataset_price_bars",
                            },
                        ),
                    },
                    price_bars=price_bars,
                    symbol_coverage=effective_coverage,
                )
                restored_ids.append(snapshot_id)
            elif snapshot_id == DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID and corporate_actions:
                restored_actions = [
                    {
                        "symbol": str(item.get("symbol") or ""),
                        "date": str(item.get("date") or item.get("event_date") or ""),
                        "action_type": str(item.get("action_type") or item.get("event_type") or "unknown"),
                        "value": item.get("value"),
                        "source": item.get("source"),
                        "fallback_source": item.get("fallback_source"),
                        "payload": dict(item.get("payload") or {}),
                    }
                    for item in corporate_actions
                ]
                self.market_data_repository.replace_dataset_snapshot(
                    {
                        "id": snapshot_id,
                        "name": "\u516c\u53f8\u884c\u4e3a\u6570\u636e",
                        "status": str(existing_row.get("status") or "STALE") if existing_row else "STALE",
                        "as_of": existing_row.get("as_of") if existing_row and existing_row.get("as_of") else as_of,
                        "freshness_label": preferred_freshness_label,
                        "start_date": (
                            existing_row.get("start_date")
                            if existing_row and existing_row.get("start_date")
                            else min(str(row.get("date")) for row in restored_actions if row.get("date"))
                        ),
                        "end_date": (
                            existing_row.get("end_date")
                            if existing_row and existing_row.get("end_date")
                            else max(str(row.get("date")) for row in restored_actions if row.get("date"))
                        ),
                        "row_count": len(restored_actions),
                        "source": (
                            str(existing_row.get("source") or "")
                            if existing_row and existing_row.get("source")
                            else str(restored_actions[0].get("source") or "existing_snapshot_rows")
                        ),
                        "fallback_source": (
                            existing_row.get("fallback_source")
                            if existing_row and existing_row.get("fallback_source")
                            else restored_actions[0].get("fallback_source")
                        ),
                        "blocker": dict(existing_row.get("blocker") or {}) if existing_row else {},
                        "metadata": self._dataset_progress_metadata(
                            symbol_coverage=coverage_rows,
                            missing_symbols=(dict(existing_row.get("metadata") or {}).get("missing_symbols") if existing_row else []),
                            existing_metadata={
                                **(dict(existing_row.get("metadata") or {}) if existing_row else {}),
                                "restored_from": "dataset_corporate_actions",
                            },
                            covered_symbols=[str(item.get("symbol") or "") for item in restored_actions],
                        ),
                    },
                    corporate_actions=restored_actions,
                    symbol_coverage=coverage_rows,
                )
                restored_ids.append(snapshot_id)
        return restored_ids

    def _restore_universe_snapshots_from_memberships(self, *, as_of: str) -> list[str]:
        restored_ids: list[str] = []
        universe_rows = {str(item["id"]): item for item in self.market_data_repository.list_universe_snapshots()}
        for defaults in self._universe_snapshot_defaults():
            snapshot_id = str(defaults["id"])
            existing_row = universe_rows.get(snapshot_id)
            if not self._snapshot_row_is_placeholder(existing_row, count_key="member_count"):
                continue
            memberships = self.market_data_repository.load_universe_memberships(universe_snapshot_id=snapshot_id)
            if not memberships:
                continue
            latest_effective_date = max(str(item.get("effective_date")) for item in memberships if item.get("effective_date"))
            latest_members = [item for item in memberships if str(item.get("effective_date")) == latest_effective_date]
            preferred_freshness_label = (
                existing_row.get("freshness_label")
                if existing_row
                and existing_row.get("freshness_label")
                and str(existing_row.get("freshness_label")) not in {"freshness_pending", "pending", "\u5c1a\u672a\u5237\u65b0"}
                else "\u5df2\u4ece\u73b0\u6709\u5feb\u7167\u6062\u590d"
            )
            source_names = sorted({str(item.get("source") or "") for item in memberships if item.get("source")})
            fallback_sources = sorted({str(item.get("fallback_source") or "") for item in memberships if item.get("fallback_source")})
            self.market_data_repository.replace_universe_snapshot(
                {
                    "id": snapshot_id,
                    "universe_key": existing_row.get("universe_key") if existing_row and existing_row.get("universe_key") else defaults["id"],
                    "name": defaults["name"],
                    "status": str(existing_row.get("status") or "INCOMPLETE") if existing_row else "INCOMPLETE",
                    "as_of": existing_row.get("as_of") if existing_row and existing_row.get("as_of") else as_of,
                    "freshness_label": preferred_freshness_label,
                    "window_start": existing_row.get("window_start") if existing_row and existing_row.get("window_start") else min(str(item.get("effective_date")) for item in memberships if item.get("effective_date")),
                    "window_end": existing_row.get("window_end") if existing_row and existing_row.get("window_end") else latest_effective_date,
                    "anchor_schedule": existing_row.get("anchor_schedule") if existing_row and existing_row.get("anchor_schedule") else ANCHOR_SCHEDULE,
                    "member_count": len(latest_members),
                    "source": source_names[0] if len(source_names) == 1 else ("mixed_sources" if source_names else str(existing_row.get("source") or "")),
                    "fallback_source": fallback_sources[0] if len(fallback_sources) == 1 else ("mixed_fallbacks" if fallback_sources else existing_row.get("fallback_source") if existing_row else None),
                    "blocker": dict(existing_row.get("blocker") or {}) if existing_row else {},
                    "metadata": {
                        **(dict(existing_row.get("metadata") or {}) if existing_row else {}),
                        "restored_from": "universe_membership_snapshots",
                        "latest_effective_date": latest_effective_date,
                    },
                },
                memberships=memberships,
            )
            restored_ids.append(snapshot_id)
        return restored_ids

    def _overall_snapshot_status(self, dataset_snapshots: list[dict[str, Any]], universe_snapshots: list[dict[str, Any]]) -> str:
        statuses = [str(item.get("status") or "INCOMPLETE").upper() for item in [*dataset_snapshots, *universe_snapshots]]
        if not statuses:
            return "INCOMPLETE"
        if any(status == "FAILED" for status in statuses):
            return "FAILED"
        if any(status == "INCOMPLETE" for status in statuses):
            return "INCOMPLETE"
        if any(status == "STALE" for status in statuses):
            return "STALE"
        return "READY" if all(status == "READY" for status in statuses) else "INCOMPLETE"

    """
    def _snapshot_blocking_detail(
        self,
        dataset_snapshots: list[dict[str, Any]],
        universe_snapshots: list[dict[str, Any]],
        latest_job: Mapping[str, Any] | None,
    ) -> tuple[str | None, str | None, str, list[str]]:
        for item in [*dataset_snapshots, *universe_snapshots]:
            status = str(item.get("status") or "INCOMPLETE").upper()
            blocker = dict(item.get("blocker") or {})
            if status == "READY" and not blocker:
                continue
            blocker_code = str(
                blocker.get("code") or ("SNAPSHOT_REFRESH_FAILED" if status == "FAILED" else "SNAPSHOT_REFRESH_REQUIRED")
            )
            return (
                blocker_code,
                str(blocker.get("target") or item["id"]),
                self._snapshot_status_message(
                    blocker_code,
                    default_message=str(blocker.get("message") or f"{item['name']} snapshot data is not ready yet."),
                    item_name=str(item.get("name") or ""),
                ),
                BLOCKED_SNAPSHOT_ACTIONS,
            )
        if latest_job and str(latest_job.get("status") or "").upper() not in {"", "READY"}:
            summary = latest_job.get("summary") or {}
            summary_code = str(summary.get("blocking_code") or "SNAPSHOT_REFRESH_REQUIRED")
            return (
                summary_code,
                str(summary.get("blocking_target") or "data_snapshots"),
                self._snapshot_status_message(
                    summary_code,
                    default_message=str(summary.get("message") or "Snapshot data is partially available and still refreshing."),
                ),
                BLOCKED_SNAPSHOT_ACTIONS,
            )
        return (None, None, "Snapshot data is ready for use.", READY_SNAPSHOT_ACTIONS)

    def _snapshot_status_message(
        self,
        code: str | None,
        *,
        default_message: str,
        item_name: str | None = None,
    ) -> str:
        normalized = str(code or "").upper()
        messages = {
            "CORPORATE_ACTIONS_INCOMPLETE": "Corporate actions snapshot is incomplete.",
            "CORPORATE_ACTIONS_PENDING": "Corporate actions snapshot is waiting for refresh.",
            "CORPORATE_ACTIONS_FAILED": "Corporate actions snapshot refresh failed.",
            "PRICE_SNAPSHOT_INCOMPLETE": "Price snapshot is incomplete.",
            "PRICE_SNAPSHOT_FAILED": "Price snapshot refresh failed.",
            "UNIVERSE_HISTORY_INCOMPLETE": "Universe history snapshot is incomplete.",
            "UNIVERSE_HISTORY_FAILED": "Universe history snapshot refresh failed.",
            "LIVE_REFRESH_PENDING": "A live refresh is running in the background.",
            "SNAPSHOT_REFRESH_REQUIRED": "Please refresh snapshots before using this view.",
            "SNAPSHOT_REFRESH_INTERRUPTED": "Snapshot refresh was interrupted. Please run it again.",
            "SNAPSHOT_REFRESH_FAILED": "Snapshot refresh failed. Please retry.",
        }
        if normalized in messages:
            return messages[normalized]
        if default_message:
            return default_message
        if item_name:
            return f"{item_name} snapshot data is not ready yet."
        return "Snapshot data is partially available and still refreshing."

    """

    def _snapshot_blocking_detail(
        self,
        dataset_snapshots: list[dict[str, Any]],
        universe_snapshots: list[dict[str, Any]],
        latest_job: Mapping[str, Any] | None,
    ) -> tuple[str | None, str | None, str, list[str]]:
        for item in [*dataset_snapshots, *universe_snapshots]:
            status = str(item.get("status") or "INCOMPLETE").upper()
            blocker = dict(item.get("blocker") or {})
            if status == "READY" and not blocker:
                continue
            blocker_code = str(
                blocker.get("code") or ("SNAPSHOT_REFRESH_FAILED" if status == "FAILED" else "SNAPSHOT_REFRESH_REQUIRED")
            )
            return (
                blocker_code,
                str(blocker.get("target") or item["id"]),
                self._snapshot_status_message(
                    blocker_code,
                    default_message=str(blocker.get("message") or f"{item['name']} snapshot data is not ready yet."),
                    item_name=str(item.get("name") or ""),
                ),
                BLOCKED_SNAPSHOT_ACTIONS,
            )
        if latest_job and str(latest_job.get("status") or "").upper() not in {"", "READY"}:
            summary = dict(latest_job.get("summary") or {})
            summary_code = str(summary.get("blocking_code") or "SNAPSHOT_REFRESH_REQUIRED")
            return (
                summary_code,
                str(summary.get("blocking_target") or "data_snapshots"),
                self._snapshot_status_message(
                    summary_code,
                    default_message=str(summary.get("message") or "Snapshot data is not ready yet. Please refresh snapshots before using this view."),
                ),
                BLOCKED_SNAPSHOT_ACTIONS,
            )
        return (None, None, "Snapshot data is ready enough to continue. You can refresh again later if you want the latest data.", READY_SNAPSHOT_ACTIONS)

    def _snapshot_status_message(
        self,
        code: str | None,
        *,
        default_message: str,
        item_name: str | None = None,
    ) -> str:
        normalized = str(code or "").upper()
        messages = {
            "CORPORATE_ACTIONS_INCOMPLETE": "Corporate action data is partially available, but the snapshot is not complete yet.",
            "CORPORATE_ACTIONS_PENDING": "Corporate action data has not been built yet. Run refresh to populate it.",
            "CORPORATE_ACTIONS_FAILED": "Corporate action data refresh failed.",
            "PRICE_SNAPSHOT_INCOMPLETE": "Price data is partially available, but historical gaps still remain.",
            "PRICE_SNAPSHOT_FAILED": "Price data refresh failed.",
            "UNIVERSE_HISTORY_INCOMPLETE": "Universe history is partially available, but some historical anchors are still missing.",
            "UNIVERSE_HISTORY_FAILED": "Universe history refresh failed and no usable historical anchors are available.",
            "LIVE_REFRESH_PENDING": "A background refresh is still pending. The page is showing the locally recovered snapshot first.",
            "SNAPSHOT_REFRESH_REQUIRED": "Please refresh snapshots before using this view.",
            "SNAPSHOT_REFRESH_INTERRUPTED": "Snapshot refresh was interrupted. Please run it again.",
            "SNAPSHOT_REFRESH_FAILED": "Snapshot refresh failed. Check the errors and try again.",
        }
        if normalized in messages:
            return messages[normalized]
        if default_message:
            return default_message
        if item_name:
            return f"{item_name} needs a snapshot refresh before it can be used."
        return "Snapshot refresh is required before this view can be used."

    def _seed_dataset_snapshots_from_legacy_cache(self, *, as_of: str) -> dict[str, Any] | None:
        dataset_rows = {str(item["id"]): item for item in self.market_data_repository.list_dataset_snapshots()}
        needs_price_snapshot = self._snapshot_row_is_placeholder(
            dataset_rows.get(DATASET_PRICE_SNAPSHOT_ID),
            count_key="row_count",
        )
        needs_actions_snapshot = self._snapshot_row_is_placeholder(
            dataset_rows.get(DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID),
            count_key="row_count",
        )
        if not needs_price_snapshot and not needs_actions_snapshot:
            return None

        legacy_bars_by_symbol = self.market_data_repository.load_bars()
        legacy_actions = self.market_data_repository.load_actions()
        coverage_rows = [CoverageSummary(**row) for row in self.market_data_repository.list_coverage()]

        price_bars: list[dict[str, Any]] = []
        snapshot_start_dates: list[str] = []
        snapshot_end_dates: list[str] = []
        for symbol, rows in legacy_bars_by_symbol.items():
            if not rows:
                continue
            ordered_rows = sorted(rows, key=lambda item: str(item.get("date") or ""))
            snapshot_start_dates.append(str(ordered_rows[0].get("date") or ""))
            snapshot_end_dates.append(str(ordered_rows[-1].get("date") or ""))
            for row in ordered_rows:
                price_bars.append(
                    {
                        "symbol": str(symbol),
                        "date": str(row.get("date") or ""),
                        "open": row.get("open"),
                        "high": row.get("high"),
                        "low": row.get("low"),
                        "close": row.get("close"),
                        "adj_close": row.get("adj_close", row.get("close")),
                        "volume": row.get("volume"),
                        "source": "legacy_local_cache",
                        "fallback_source": "live_refresh_pending",
                        "metadata": {"restored_from": "market_bars"},
                    }
                )

        if not price_bars:
            return None

        corporate_actions = [
            {
                "symbol": str(action.get("symbol") or ""),
                "date": str(action.get("date") or ""),
                "action_type": str(action.get("action_type") or "unknown"),
                "value": action.get("value"),
                "source": "legacy_local_cache",
                "fallback_source": "live_refresh_pending",
                "payload": dict(action.get("payload") or {}),
            }
            for action in legacy_actions
        ]
        snapshot_start = min(snapshot_start_dates) if snapshot_start_dates else SNAPSHOT_START_DATE.isoformat()
        snapshot_end = max(snapshot_end_dates) if snapshot_end_dates else None

        if needs_price_snapshot:
            self.market_data_repository.replace_dataset_snapshot(
                {
                    "id": DATASET_PRICE_SNAPSHOT_ID,
                    "name": "\u80a1\u7968\u4ef7\u683c\u6570\u636e",
                    "status": "STALE",
                    "as_of": as_of,
                    "freshness_label": "\u5df2\u4ece\u672c\u5730\u7f13\u5b58\u6062\u590d",
                    "start_date": snapshot_start,
                    "end_date": snapshot_end,
                    "row_count": len(price_bars),
                    "source": "legacy_local_cache",
                    "fallback_source": "live_refresh_pending",
                    "blocker": {
                        "code": "LIVE_REFRESH_PENDING",
                        "message": "\u5df2\u5148\u6062\u590d\u672c\u5730\u4ef7\u683c\u7f13\u5b58\uff0c\u540e\u7eed\u4f1a\u7ee7\u7eed\u5728\u7ebf\u8865\u9f50\u7f3a\u5931\u80a1\u7968\u3002",
                    },
                    "metadata": self._dataset_progress_metadata(
                        symbol_coverage=coverage_rows,
                        missing_symbols=[],
                        existing_metadata={
                            "restored_from": "market_bars",
                            "legacy_symbol_count": len(coverage_rows),
                        },
                    ),
                },
                price_bars=price_bars,
                symbol_coverage=coverage_rows,
            )

        if needs_actions_snapshot:
            actions_status = "STALE" if corporate_actions else "INCOMPLETE"
            actions_blocker = (
                {
                    "code": "LIVE_REFRESH_PENDING",
                    "message": "\u5df2\u5148\u6062\u590d\u672c\u5730\u516c\u53f8\u884c\u4e3a\u6570\u636e\uff0c\u540e\u7eed\u4f1a\u7ee7\u7eed\u5728\u7ebf\u8865\u9f50\u7f3a\u5931\u4e8b\u4ef6\u3002",
                }
                if corporate_actions
                else {
                    "code": "CORPORATE_ACTIONS_PENDING",
                    "message": "\u672c\u5730\u6682\u65f6\u6ca1\u6709\u516c\u53f8\u884c\u4e3a\u5feb\u7167\uff0c\u70b9\u51fb\u5237\u65b0\u540e\u4f1a\u4ece\u5df2\u914d\u7f6e\u7684\u6570\u636e\u6e90\u7ee7\u7eed\u8865\u9f50\u3002",
                }
            )
            self.market_data_repository.replace_dataset_snapshot(
                {
                    "id": DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID,
                    "name": "\u516c\u53f8\u884c\u4e3a\u6570\u636e",
                    "status": actions_status,
                    "as_of": as_of,
                    "freshness_label": "\u5df2\u4ece\u672c\u5730\u7f13\u5b58\u6062\u590d" if corporate_actions else "\u5c1a\u672a\u5237\u65b0",
                    "start_date": snapshot_start,
                    "end_date": snapshot_end,
                    "row_count": len(corporate_actions),
                    "source": "legacy_local_cache",
                    "fallback_source": "live_refresh_pending",
                    "blocker": actions_blocker,
                    "metadata": self._dataset_progress_metadata(
                        symbol_coverage=coverage_rows,
                        missing_symbols=[],
                        existing_metadata={
                            "restored_from": "market_actions",
                            "legacy_symbol_count": len(coverage_rows),
                        },
                    ),
                },
                corporate_actions=corporate_actions,
            )

        return {
            "price_row_count": len(price_bars),
            "coverage_symbol_count": len(coverage_rows),
            "actions_row_count": len(corporate_actions),
        }

    def _upsert_snapshot_refresh_job(self, job: Mapping[str, Any]) -> None:
        self.storage.insert_json_row(
            "snapshot_refresh_jobs",
            {
                "id": job["id"],
                "status": job["status"],
                "request_json": dumps(job.get("request") or {}),
                "summary_json": dumps(job.get("summary") or {}),
                "warnings_json": dumps(list(job.get("warnings") or [])),
                "errors_json": dumps(list(job.get("errors") or [])),
                "created_at": job["created_at"],
                "updated_at": job["updated_at"],
                "started_at": job.get("started_at"),
                "completed_at": job.get("completed_at"),
            },
        )

    def _load_snapshot_refresh_runtime_state(self) -> dict[str, Any] | None:
        row = self.storage.fetch_one(
            "SELECT state_json FROM app_runtime_state WHERE state_key = ?",
            (SNAPSHOT_REFRESH_RUNTIME_STATE_KEY,),
        )
        if not row:
            return None
        state = loads(row.get("state_json"), {})
        return dict(state or {})

    def _write_snapshot_refresh_runtime_state(
        self,
        *,
        job_id: str,
        pid: int | None,
        mode: str,
        targets: Sequence[str],
        current_stage: str | None = None,
        current_stage_label: str | None = None,
        progress: Mapping[str, Any] | None = None,
        heartbeat_at: str | None = None,
    ) -> None:
        existing_state = self._load_snapshot_refresh_runtime_state() or {}
        resolved_pid = int(pid or existing_state.get("pid") or 0)
        state = {
            **existing_state,
            "job_id": job_id,
            "mode": mode,
            "targets": list(targets),
        }
        if resolved_pid > 0:
            state["pid"] = resolved_pid
        if current_stage is not None:
            state["current_stage"] = current_stage
        if current_stage_label is not None:
            state["current_stage_label"] = current_stage_label
        if progress is not None:
            state["progress"] = dict(progress)
        state["heartbeat_at"] = heartbeat_at or iso_now()
        self.storage.insert_json_row(
            "app_runtime_state",
            {
                "state_key": SNAPSHOT_REFRESH_RUNTIME_STATE_KEY,
                "state_json": dumps(state),
                "updated_at": str(state["heartbeat_at"]),
            },
        )

    def _clear_snapshot_refresh_runtime_state(self, job_id: str | None = None) -> None:
        state = self._load_snapshot_refresh_runtime_state()
        if job_id and state and str(state.get("job_id") or "") != job_id:
            return
        self.storage.execute(
            "DELETE FROM app_runtime_state WHERE state_key = ?",
            (SNAPSHOT_REFRESH_RUNTIME_STATE_KEY,),
        )

    def _refresh_snapshot_stage_message(self, mode: str, stage_label: str | None = None) -> str:
        base_message = self._refresh_snapshot_message(mode)
        if not stage_label:
            return base_message
        return f"{base_message} 当前阶段：{stage_label}。"

    def _merge_snapshot_refresh_job_runtime_fields(
        self,
        job: Mapping[str, Any],
        *,
        existing_job: Mapping[str, Any] | None = None,
        heartbeat_at: str | None = None,
        current_stage: str | None = None,
        current_stage_label: str | None = None,
        progress: Mapping[str, Any] | None = None,
        message: str | None = None,
    ) -> dict[str, Any]:
        merged_job = dict(job)
        existing_summary = dict((existing_job or {}).get("summary") or {})
        summary = {
            **existing_summary,
            **dict(merged_job.get("summary") or {}),
        }
        if heartbeat_at:
            summary["heartbeat_at"] = heartbeat_at
            merged_job["updated_at"] = heartbeat_at
        if current_stage is not None:
            summary["current_stage"] = current_stage
        if current_stage_label is not None:
            summary["current_stage_label"] = current_stage_label
        if progress is not None:
            summary["progress"] = dict(progress)
        if message is not None:
            summary["message"] = message
        merged_job["summary"] = summary
        return merged_job

    def _persist_snapshot_refresh_heartbeat(
        self,
        *,
        job_id: str,
        request: Mapping[str, Any],
        mode: str,
        targets: Sequence[str],
        created_at: str,
        started_at: str,
        symbol_count: int,
        row_count: int,
        warnings: Sequence[str],
        errors: Sequence[str],
        current_stage: str,
        current_stage_label: str,
        progress: Mapping[str, Any] | None = None,
        heartbeat_at: str | None = None,
        message: str | None = None,
        refresh_stats: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        heartbeat_value = str(heartbeat_at or iso_now())
        stage_message = str(message or self._refresh_snapshot_stage_message(mode, current_stage_label))
        existing_row = self.storage.fetch_one(
            "SELECT * FROM snapshot_refresh_jobs WHERE id = ?",
            (job_id,),
        )
        existing_job = self._decode_snapshot_refresh_job(existing_row)
        if existing_job and str(existing_job.get("status") or "").upper() != "RUNNING":
            return dict(existing_job)

        overview = {
            "overall_status": "RUNNING",
            "blocking_code": "SNAPSHOT_REFRESH_RUNNING",
            "blocking_target": "data_snapshots",
            "message": stage_message,
        }
        running_job = self._build_snapshot_refresh_job(
            job_id=job_id,
            request=request,
            overview=overview,
            mode=mode,
            targets=targets,
            symbol_count=symbol_count,
            row_count=row_count,
            warnings=warnings,
            errors=errors,
            created_at=created_at,
            started_at=started_at,
            completed_at=None,
            status="RUNNING",
            message=stage_message,
            blocking_code="SNAPSHOT_REFRESH_RUNNING",
            blocking_target="data_snapshots",
            refresh_stats=refresh_stats,
        )
        running_job = self._merge_snapshot_refresh_job_runtime_fields(
            running_job,
            existing_job=existing_job,
            heartbeat_at=heartbeat_value,
            current_stage=current_stage,
            current_stage_label=current_stage_label,
            progress=progress,
            message=stage_message,
        )
        running_job["status"] = "RUNNING"
        existing_warnings = [str(item) for item in (existing_job.get("warnings") or [])] if existing_job else []
        existing_errors = [str(item) for item in (existing_job.get("errors") or [])] if existing_job else []
        running_job["warnings"] = sorted(
            set(
                str(item)
                for item in [*existing_warnings, *(str(item) for item in warnings)]
                if item
            )
        )
        running_job["errors"] = [
            str(item)
            for item in [*existing_errors, *(str(item) for item in errors)]
            if item
        ]
        running_job["updated_at"] = heartbeat_value
        running_job["completed_at"] = None
        self._upsert_snapshot_refresh_job(running_job)
        self._write_snapshot_refresh_runtime_state(
            job_id=job_id,
            pid=os.getpid(),
            mode=mode,
            targets=targets,
            current_stage=current_stage,
            current_stage_label=current_stage_label,
            progress=progress,
            heartbeat_at=heartbeat_value,
        )
        return running_job

    def _pid_is_running(self, pid: int) -> bool:
        if pid <= 0:
            return False
        if os.name == "nt":
            import ctypes
            from ctypes import wintypes

            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            STILL_ACTIVE = 259
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
            if not handle:
                return False
            try:
                exit_code = wintypes.DWORD()
                if not kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
                    return False
                return int(exit_code.value) == STILL_ACTIVE
            finally:
                kernel32.CloseHandle(handle)
        try:
            os.kill(pid, 0)
        except OSError:
            return False
        return True

    def _snapshot_refresh_process_is_active(self, job_id: str) -> bool:
        active_process = self._snapshot_refresh_process
        if active_process is not None:
            if active_process.poll() is None:
                runtime_state = self._load_snapshot_refresh_runtime_state()
                if not runtime_state or str(runtime_state.get("job_id") or "") == job_id:
                    return True
            else:
                self._snapshot_refresh_process = None

        runtime_state = self._load_snapshot_refresh_runtime_state()
        if not runtime_state or str(runtime_state.get("job_id") or "") != job_id:
            return self._find_snapshot_refresh_worker_pid(job_id) is not None
        pid = int(runtime_state.get("pid") or 0)
        if self._pid_is_running(pid):
            return True
        if self._find_snapshot_refresh_worker_pid(job_id) is not None:
            return True
        self._clear_snapshot_refresh_runtime_state(job_id)
        return False

    def _find_snapshot_refresh_worker_pid(self, job_id: str) -> int | None:
        if os.name != "nt" or not job_id:
            return None
        powershell = (
            "$jobId = '{job_id}'; "
            "$proc = Get-CimInstance Win32_Process | "
            "Where-Object {{ $_.CommandLine -like '*grit_backtest_platform.main refresh-snapshots*' "
            "-and $_.CommandLine -like \"*--job-id $jobId*\" }} | "
            "Select-Object -First 1 -ExpandProperty ProcessId; "
            "if ($proc) {{ Write-Output $proc }}"
        ).format(job_id=job_id)
        try:
            result = subprocess.run(
                ["powershell", "-NoProfile", "-Command", powershell],
                capture_output=True,
                text=True,
                timeout=SNAPSHOT_REFRESH_WORKER_DISCOVERY_TIMEOUT_SECONDS,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except Exception:
            return None
        if result.returncode != 0:
            return None
        output = str(result.stdout or "").strip()
        if not output:
            return None
        try:
            return int(output.splitlines()[0].strip())
        except ValueError:
            return None

    def _start_snapshot_refresh_subprocess(
        self,
        *,
        job: Mapping[str, Any],
        payload: Mapping[str, Any],
        mode: str,
        targets: Sequence[str],
    ) -> None:
        project_root = Path(__file__).resolve().parents[2]
        source_root = project_root / "src"
        environment = os.environ.copy()
        python_path = str(source_root)
        if environment.get("PYTHONPATH"):
            python_path = f"{source_root}{os.pathsep}{environment['PYTHONPATH']}"
        environment["PYTHONPATH"] = python_path

        command = [
            sys.executable,
            "-m",
            "grit_backtest_platform.main",
            "refresh-snapshots",
            "--db-path",
            str(self.storage.path),
            "--mode",
            mode,
            "--job-id",
            str(job["id"]),
            "--job-created-at",
            str(job["created_at"]),
            "--job-started-at",
            str(job["started_at"]),
        ]
        reason = payload.get("reason")
        if reason is not None:
            command.extend(["--reason", str(reason)])
        if targets:
            command.extend(["--targets", ",".join(str(item) for item in targets)])

        process = subprocess.Popen(
            command,
            cwd=str(project_root),
            env=environment,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        self._snapshot_refresh_process = process
        self._write_snapshot_refresh_runtime_state(
            job_id=str(job["id"]),
            pid=int(process.pid),
            mode=mode,
            targets=targets,
        )

    def _recover_interrupted_snapshot_job(self, latest_job: Mapping[str, Any] | None) -> dict[str, Any] | None:
        if not latest_job:
            return None
        if str(latest_job.get("status") or "").upper() != "RUNNING":
            return dict(latest_job)

        active_thread = self._snapshot_refresh_thread
        if active_thread and active_thread.is_alive():
            return dict(latest_job)
        if self._snapshot_refresh_heartbeat_is_recent(latest_job):
            return dict(latest_job)
        if self._snapshot_refresh_process_is_active(str(latest_job.get("id") or "")):
            return dict(latest_job)

        recovered_at = iso_now()
        summary = dict(latest_job.get("summary") or {})
        warnings = list(latest_job.get("warnings") or [])
        if "Background snapshot refresh was interrupted before completion." not in warnings:
            warnings.append("Background snapshot refresh was interrupted before completion.")
        recovered_job = {
            **dict(latest_job),
            "status": "FAILED",
            "summary": {
                **summary,
                "status": "FAILED",
                "blocking": True,
                "blocking_code": "SNAPSHOT_REFRESH_INTERRUPTED",
                "blocking_target": "data_snapshots",
                "message": "Background snapshot refresh was interrupted before completion. Please run refresh again.",
            },
            "warnings": warnings,
            "errors": list(latest_job.get("errors") or []),
            "updated_at": recovered_at,
            "completed_at": recovered_at,
        }
        self._clear_snapshot_refresh_runtime_state(str(latest_job.get("id") or ""))
        self._upsert_snapshot_refresh_job(recovered_job)
        return recovered_job

    def start_snapshot_refresh(self, request: Any | None = None) -> dict[str, Any]:
        payload, mode, targets = self._normalize_snapshot_refresh_request(request)
        now = iso_now()
        seeded_legacy_snapshot = (
            self._seed_dataset_snapshots_from_legacy_cache(as_of=now)
            if {"price", "corporate"} & set(targets)
            else None
        )

        with self._snapshot_refresh_lock:
            latest = self.storage.fetch_one("SELECT * FROM snapshot_refresh_jobs ORDER BY created_at DESC LIMIT 1")
            latest_job = self._recover_interrupted_snapshot_job(self._decode_snapshot_refresh_job(latest))
            if latest_job and str(latest_job.get("status") or "").upper() == "RUNNING":
                return self._build_snapshot_overview(latest_job)

            overview = self._build_snapshot_overview()
            warnings: list[str] = []
            if seeded_legacy_snapshot:
                warnings.append(
                    "Seeded dataset snapshots from legacy local cache "
                    f"({seeded_legacy_snapshot['price_row_count']} price rows across "
                    f"{seeded_legacy_snapshot['coverage_symbol_count']} symbols)."
                )
            job = self._build_snapshot_refresh_job(
                job_id=self._new_id("snap"),
                request=payload,
                overview=overview,
                mode=mode,
                targets=targets,
                symbol_count=len(overview.get("dataset_snapshots") or []),
                row_count=sum(int(item.get("row_count") or 0) for item in overview.get("dataset_snapshots") or []),
                warnings=warnings,
                errors=[],
                created_at=now,
                started_at=now,
                completed_at=None,
                status="RUNNING",
                message=self._refresh_snapshot_message(mode),
                blocking_code=overview.get("blocking_code") or "SNAPSHOT_REFRESH_RUNNING",
                blocking_target=overview.get("blocking_target") or "data_snapshots",
            )
            self._upsert_snapshot_refresh_job(job)
            response_overview = {
                **overview,
                "overall_status": "RUNNING",
                "latest_job": job,
                "message": self._refresh_snapshot_message(mode),
                "allowed_actions": [],
            }

            if "PYTEST_CURRENT_TEST" in os.environ:
                def runner() -> None:
                    try:
                        runner_payload = {
                            **payload,
                            "_job_id": job["id"],
                            "_job_created_at": job["created_at"],
                            "_job_started_at": job["started_at"],
                        }
                        result = self.refresh_snapshots(runner_payload)
                        persisted_row = self.storage.fetch_one(
                            "SELECT * FROM snapshot_refresh_jobs WHERE id = ?",
                            (job["id"],),
                        )
                        persisted_job = self._decode_snapshot_refresh_job(persisted_row)
                        if persisted_job and str(persisted_job.get("status") or "").upper() != "RUNNING":
                            return
                        result_overview = result if isinstance(result, Mapping) else self._build_snapshot_overview()
                        completed_at = iso_now()
                        completed_job = self._build_snapshot_refresh_job(
                            job_id=job["id"],
                            request=payload,
                            overview=result_overview,
                            mode=mode,
                            targets=targets,
                            symbol_count=len(result_overview.get("dataset_snapshots") or []),
                            row_count=sum(
                                int(item.get("row_count") or 0) for item in result_overview.get("dataset_snapshots") or []
                            ),
                            warnings=job["warnings"],
                            errors=[],
                            created_at=job["created_at"],
                            started_at=job["started_at"],
                            completed_at=completed_at,
                        )
                        self._upsert_snapshot_refresh_job(completed_job)
                    except Exception as exc:
                        failed_at = iso_now()
                        failed_overview = self._build_snapshot_overview()
                        failed_job = self._build_snapshot_refresh_job(
                            job_id=job["id"],
                            request=payload,
                            overview=failed_overview,
                            mode=mode,
                            targets=targets,
                            symbol_count=len(failed_overview.get("dataset_snapshots") or []),
                            row_count=sum(
                                int(item.get("row_count") or 0) for item in failed_overview.get("dataset_snapshots") or []
                            ),
                            warnings=job["warnings"],
                            errors=[str(exc)],
                            created_at=job["created_at"],
                            started_at=job["started_at"],
                            completed_at=failed_at,
                            status="FAILED",
                            message=f"Snapshot refresh failed: {exc}",
                            blocking_code="SNAPSHOT_REFRESH_FAILED",
                            blocking_target="data_snapshots",
                        )
                        self._upsert_snapshot_refresh_job(failed_job)
                    finally:
                        with self._snapshot_refresh_lock:
                            self._snapshot_refresh_thread = None

                thread = threading.Thread(target=runner, name=f"snapshot-refresh-{job['id']}", daemon=True)
                self._snapshot_refresh_thread = thread
                thread.start()
                # Give fast test doubles time to persist a terminal job state before tight polling begins.
                thread.join(0.2)
            else:
                self._start_snapshot_refresh_subprocess(
                    job=job,
                    payload=payload,
                    mode=mode,
                    targets=targets,
                )

        return response_overview

    def _build_snapshot_overview(self, latest_job: Mapping[str, Any] | None = None) -> dict[str, Any]:
        restored_at = iso_now()
        self._seed_dataset_snapshots_from_legacy_cache(as_of=restored_at)
        self._restore_dataset_snapshots_from_snapshot_rows(as_of=restored_at)
        self._restore_universe_snapshots_from_memberships(as_of=restored_at)
        latest_job = self._recover_interrupted_snapshot_job(latest_job)
        raw_dataset_rows = {str(item["id"]): dict(item) for item in self.market_data_repository.list_dataset_snapshots()}
        canonical_target_symbols = self._canonical_progress_target_symbols(
            progress_target_symbols=[],
            existing_price_coverage=[],
            existing_corporate_coverage=[],
            existing_price_missing=[],
            existing_corporate_missing=[],
        )
        price_row = self._backfill_dataset_snapshot_progress(
            raw_dataset_rows.get(DATASET_PRICE_SNAPSHOT_ID),
            target_symbols=canonical_target_symbols,
        )
        price_total_symbol_count = dict(price_row.get("metadata") or {}).get("total_symbol_count")
        corporate_row = self._backfill_dataset_snapshot_progress(
            raw_dataset_rows.get(DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID),
            total_symbol_count_hint=price_total_symbol_count,
            target_symbols=canonical_target_symbols,
        )
        dataset_rows = {
            DATASET_PRICE_SNAPSHOT_ID: price_row,
            DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID: corporate_row,
        }
        universe_rows = {str(item["id"]): item for item in self.market_data_repository.list_universe_snapshots()}
        dataset_snapshots = [
            self._format_dataset_snapshot(dataset_rows.get(defaults["id"]), defaults)
            for defaults in self._dataset_snapshot_defaults()
        ]
        universe_snapshots = [
            self._format_universe_snapshot(universe_rows.get(defaults["id"]), defaults)
            for defaults in self._universe_snapshot_defaults()
        ]
        timestamps = [
            str(value)
            for value in [
                *(item.get("as_of") for item in dataset_snapshots),
                *(item.get("as_of") for item in universe_snapshots),
                latest_job.get("completed_at") if latest_job else None,
                latest_job.get("updated_at")
                if latest_job and str(latest_job.get("status") or "").upper() != "RUNNING"
                else None,
            ]
            if value
        ]
        blocking_code, blocking_target, message, allowed_actions = self._snapshot_blocking_detail(
            dataset_snapshots,
            universe_snapshots,
            latest_job,
        )
        overall_status = self._overall_snapshot_status(dataset_snapshots, universe_snapshots)
        if latest_job and str(latest_job.get("status") or "").upper() == "RUNNING":
            overall_status = "RUNNING"
            running_summary = dict(latest_job.get("summary") or {})
            message = str(
                running_summary.get("message")
                or self._refresh_snapshot_message(
                    str((latest_job.get("request") or {}).get("mode") or "incremental")
                )
            )
            allowed_actions = []
        return {
            "overall_status": overall_status,
            "last_refreshed_at": max(timestamps) if timestamps else None,
            "dataset_snapshots": dataset_snapshots,
            "universe_snapshots": universe_snapshots,
            "latest_job": dict(latest_job) if latest_job else None,
            "blocking_code": blocking_code,
            "blocking_target": blocking_target,
            "message": message,
            "allowed_actions": allowed_actions,
        }

    def _backfill_dataset_snapshot_progress(
        self,
        item: Mapping[str, Any] | None,
        *,
        total_symbol_count_hint: int | None = None,
        target_symbols: Sequence[str] | None = None,
    ) -> dict[str, Any]:
        row = dict(item or {})
        metadata = dict(row.get("metadata") or {})
        covered_symbol_count = metadata.get("covered_symbol_count")
        total_symbol_count = metadata.get("total_symbol_count")
        row_count = int(row.get("row_count") or 0)
        if not target_symbols and row.get("id") != DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID and (
            isinstance(covered_symbol_count, int)
            and isinstance(total_symbol_count, int)
            and (total_symbol_count > 0 or row_count == 0)
        ):
            row["metadata"] = metadata
            return row

        snapshot_id = str(row.get("id") or "")
        if not snapshot_id:
            row["metadata"] = metadata
            return row

        if snapshot_id == DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID:
            symbol_coverage = list(self.market_data_repository.summarize_dataset_symbols(snapshot_id))
            if not isinstance(metadata.get("total_symbol_count"), int) or int(metadata.get("total_symbol_count") or 0) <= 0:
                price_snapshot = next(
                    (
                        dict(item)
                        for item in self.market_data_repository.list_dataset_snapshots()
                        if str(item.get("id")) == DATASET_PRICE_SNAPSHOT_ID
                    ),
                    None,
                )
                price_metadata = dict((price_snapshot or {}).get("metadata") or {})
                try:
                    price_total_symbol_count = int(price_metadata.get("total_symbol_count") or 0)
                except (TypeError, ValueError):
                    price_total_symbol_count = 0
                if price_total_symbol_count > 0:
                    metadata["total_symbol_count"] = price_total_symbol_count
        else:
            symbol_coverage = list(self.market_data_repository.load_dataset_symbol_coverage(snapshot_id))
            if not symbol_coverage:
                symbol_coverage = list(self.market_data_repository.summarize_dataset_symbols(snapshot_id))

        row["metadata"] = self._dataset_progress_metadata(
            symbol_coverage=symbol_coverage,
            missing_symbols=metadata.get("missing_symbols"),
            existing_metadata=metadata,
            total_symbol_count_override=(
                total_symbol_count_hint if snapshot_id == DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID else None
            ),
            target_symbols=target_symbols,
        )
        return row

    def _sync_strategy_snapshot_bindings(self, *, updated_at: str) -> None:
        rows = self.storage.fetch_all("SELECT * FROM strategies")
        for row in rows:
            normalized_row = self._normalize_strategy_snapshot_bindings(row)
            dataset_snapshot_id = normalized_row.get("dataset_snapshot_id")
            universe_snapshot_id = normalized_row.get("universe_snapshot_id")
            changed = False
            if row.get("dataset_snapshot_id") != dataset_snapshot_id:
                row["dataset_snapshot_id"] = dataset_snapshot_id
                changed = True
            if row.get("universe_snapshot_id") != universe_snapshot_id:
                row["universe_snapshot_id"] = universe_snapshot_id
                changed = True
            if changed:
                row["updated_at"] = updated_at
                self.storage.insert_json_row("strategies", row)

    def _select_dataset_snapshot(self, dataset_snapshot_id: str) -> dict[str, Any]:
        for item in self.market_data_repository.list_dataset_snapshots():
            if str(item.get("id")) == dataset_snapshot_id:
                return dict(item)
        raise KeyError(f"Dataset snapshot not found: {dataset_snapshot_id}")

    def _select_universe_snapshot(self, universe_snapshot_id: str) -> dict[str, Any]:
        for item in self.market_data_repository.list_universe_snapshots():
            if str(item.get("id")) == universe_snapshot_id:
                return dict(item)
        raise KeyError(f"Universe snapshot not found: {universe_snapshot_id}")

    def _load_snapshot_price_bars(
        self,
        dataset_snapshot_id: str,
        symbols: Iterable[str],
        *,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> dict[str, list[dict[str, Any]]]:
        wanted = [str(symbol).upper() for symbol in symbols if symbol]
        rows = self.market_data_repository.load_dataset_price_bars(
            dataset_snapshot_id,
            wanted,
            start_date=start_date,
            end_date=end_date,
        )
        bars_by_symbol: dict[str, list[dict[str, Any]]] = {symbol: [] for symbol in dict.fromkeys(wanted)}
        for symbol, series in rows.items():
            normalized_symbol = str(symbol).upper()
            bars_by_symbol.setdefault(normalized_symbol, [])
            for row in series:
                bars_by_symbol[normalized_symbol].append(
                    {
                        "date": str(row.get("date") or ""),
                        "open": row.get("open"),
                        "high": row.get("high"),
                        "low": row.get("low"),
                        "close": row.get("close"),
                        "adj_close": row.get("adj_close"),
                        "volume": row.get("volume"),
                    }
                )
        return bars_by_symbol

    def _business_days(self, count: int, start: date = date(2024, 1, 2)) -> list[date]:
        days: list[date] = []
        cursor = start
        while len(days) < count:
            if cursor.weekday() < 5:
                days.append(cursor)
            cursor += timedelta(days=1)
        return days

    def _business_days_between(self, start: date, end: date) -> list[date]:
        days: list[date] = []
        cursor = start
        while cursor <= end:
            if cursor.weekday() < 5:
                days.append(cursor)
            cursor += timedelta(days=1)
        return days

    def _synthetic_bars(self, symbol: str, index: int, dates: list[date]) -> list[dict[str, Any]]:
        base = 80.0 + index * 12.5
        price = base
        bars: list[dict[str, Any]] = []
        for day_index, current_date in enumerate(dates):
            drift = 0.00035 + (index % 7) * 0.00004
            cycle = 0.006 * math.sin((day_index + index * 3) / 17.0)
            shock = 0.003 * math.cos((day_index + index) / 9.0)
            daily_return = drift + cycle + shock
            open_price = price
            close_price = max(5.0, open_price * (1.0 + daily_return))
            high = max(open_price, close_price) * (1.0 + 0.0025)
            low = min(open_price, close_price) * (1.0 - 0.0025)
            volume = 1_000_000 + index * 120_000 + day_index * 500
            bars.append(
                {
                    "date": current_date.isoformat(),
                    "open": round(open_price, 4),
                    "high": round(high, 4),
                    "low": round(low, 4),
                    "close": round(close_price, 4),
                    "adj_close": round(close_price, 4),
                    "volume": float(volume),
                }
            )
            price = close_price
        return bars

    def _synthetic_actions(self, symbol: str, index: int, dates: list[date]) -> list[dict[str, Any]]:
        if not dates:
            return []
        midpoint = dates[len(dates) // 2]
        latest = dates[-1]
        return [
            {
                "symbol": symbol,
                "date": midpoint.isoformat(),
                "action_type": "dividend",
                "value": round(0.1 + (index % 5) * 0.05, 4),
                "source": "synthetic_seed",
                "fallback_source": None,
                "payload": {"mode": "offline_seed"},
            },
            {
                "symbol": symbol,
                "date": latest.isoformat(),
                "action_type": "earnings",
                "value": None,
                "source": "synthetic_seed",
                "fallback_source": None,
                "payload": {"mode": "offline_seed", "quarter": "latest"},
            },
        ]

    def _fetch_market_data_for_symbol(
        self,
        *,
        symbol: str,
        index: int,
        window_start: date,
        window_end: date,
        primary_provider: Any | None,
        fallback_provider: Any,
        fallback_availability: Any | None,
        synthetic_dates: list[date],
    ) -> dict[str, Any]:
        identity = None
        resolve_identity = getattr(primary_provider, "resolve_identity", None) if primary_provider is not None else None
        if callable(resolve_identity):
            try:
                identity = resolve_identity(symbol)
            except Exception:
                identity = None

        if primary_provider is None:
            return {
                "symbol": symbol,
                "market_data": {
                    "source": "synthetic_seed",
                    "fallback_source": None,
                    "bars": self._synthetic_bars(symbol, index, synthetic_dates),
                    "actions": self._synthetic_actions(symbol, index, synthetic_dates),
                    "warnings": [],
                    "partial": False,
                    "metadata": {"mode": "offline_seed"},
                },
                "identity": identity,
                "error": None,
            }

        try:
            market_data = primary_provider.fetch_history(symbol, window_start, window_end)
            return {
                "symbol": symbol,
                "market_data": market_data,
                "identity": identity,
                "error": None,
                "error_metadata": {},
            }
        except Exception as primary_error:
            error_metadata = dict(getattr(primary_error, "metadata", {}) or {})
            if fallback_availability and bool(fallback_availability.available):
                try:
                    market_data = fallback_provider.fetch_history(symbol, window_start, window_end)
                    return {
                        "symbol": symbol,
                        "market_data": market_data,
                        "identity": identity,
                        "error": None,
                        "error_metadata": error_metadata,
                    }
                except Exception as fallback_error:
                    return {
                        "symbol": symbol,
                        "market_data": None,
                        "identity": identity,
                        "error": f"{symbol}: primary={primary_error}; fallback={fallback_error}",
                        "error_metadata": error_metadata,
                    }
            reason = fallback_availability.reason if fallback_availability else "Fallback provider unavailable."
            return {
                "symbol": symbol,
                "market_data": None,
                "identity": identity,
                "error": f"{symbol}: primary={primary_error}; fallback={reason}",
                "error_metadata": error_metadata,
            }

    def _all_refresh_symbols(self) -> list[str]:
        symbols = {"SPY", "QQQ"}
        for bucket in DEFAULT_UNIVERSE_SYMBOLS.values():
            symbols.update(bucket)
        for strategy in self.list_strategies():
            universe_name = str(strategy.get("universe_name") or "").strip()
            normalized_universe_symbol = self._normalize_refresh_symbol(universe_name)
            if normalized_universe_symbol:
                symbols.add(normalized_universe_symbol)
        return sorted(self._normalize_refresh_symbols(symbols))

    def _resolve_universe_symbols(
        self,
        strategy: Mapping[str, Any],
        request_payload: Mapping[str, Any] | None = None,
    ) -> list[str]:
        direct_symbol = self._direct_symbol_universe_symbol(strategy)
        if direct_symbol:
            return [direct_symbol]

        universe_snapshot_id = self._resolved_universe_snapshot_id(strategy, request_payload)
        if universe_snapshot_id:
            memberships = self.market_data_repository.load_universe_memberships(
                universe_snapshot_id=universe_snapshot_id,
            )
            if memberships:
                requested_end_date = str((request_payload or {}).get("end_date") or date.today().isoformat())
                eligible_dates = sorted(
                    {
                        str(item.get("effective_date"))
                        for item in memberships
                        if str(item.get("effective_date")) <= requested_end_date
                    }
                )
                target_date = eligible_dates[-1] if eligible_dates else str(memberships[-1].get("effective_date"))
                symbols = [
                    str(item.get("symbol") or "").upper()
                    for item in memberships
                    if str(item.get("effective_date")) == target_date
                ]
                if symbols:
                    return symbols

        universe_name = self._normalized_universe_name(strategy)
        if universe_name in {"SP500", "S&P500", "SP-500"}:
            return list(DEFAULT_UNIVERSE_SYMBOLS["SP500"])
        if universe_name in {"NASDAQ100", "NASDAQ-100", "NDX100", "NDX-100"}:
            return list(DEFAULT_UNIVERSE_SYMBOLS["NASDAQ100"])
        normalized_universe_symbol = self._normalize_refresh_symbol(universe_name)
        if normalized_universe_symbol:
            return [normalized_universe_symbol]
        return ["QQQ"] if str(strategy.get("strategy_type")) == "GRID" else list(DEFAULT_UNIVERSE_SYMBOLS["SP500"])

    def _snapshot_summary_context(self, strategy: Mapping[str, Any], request_payload: Mapping[str, Any]) -> dict[str, Any]:
        benchmark_symbol = str(strategy.get("benchmark_symbol") or "SPY").upper()
        symbols = [str(symbol).upper() for symbol in self._resolve_universe_symbols(strategy, request_payload)]
        dataset_snapshot_id = str(request_payload.get("dataset_snapshot_id") or DATASET_PRICE_SNAPSHOT_ID)
        direct_symbol_universe = self._uses_direct_symbol_universe(strategy)
        universe_snapshot_id = self._resolved_universe_snapshot_id(strategy, request_payload)
        supporting_dataset_id = DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID
        universe_membership_symbols: list[str] = []
        try:
            price_dataset = self._select_dataset_snapshot(dataset_snapshot_id)
        except KeyError:
            return {
                "blocking_summary": {
                    "status": "INCOMPLETE",
                    "dataset_snapshot_id": dataset_snapshot_id,
                    "universe_snapshot_id": universe_snapshot_id,
                    "supporting_dataset_snapshot_id": supporting_dataset_id,
                    "symbol_count": 0,
                    "row_count": 0,
                    "benchmark_trade_days": 0,
                    "coverage_days": 0,
                    "blocking": True,
                    "blocking_code": "SNAPSHOT_REFRESH_REQUIRED",
                    "blocking_target": "data_snapshots",
                    "message": "Snapshot data is not ready yet. Refresh snapshots before running this flow.",
                }
            }

        corporate_dataset: dict[str, Any] | None
        try:
            corporate_dataset = self._select_dataset_snapshot(supporting_dataset_id)
        except KeyError:
            corporate_dataset = None

        universe_snapshot: dict[str, Any] | None = None
        if universe_snapshot_id:
            try:
                universe_snapshot = self._select_universe_snapshot(universe_snapshot_id)
            except KeyError:
                return {
                    "blocking_summary": {
                        "status": "INCOMPLETE",
                        "dataset_snapshot_id": dataset_snapshot_id,
                        "universe_snapshot_id": universe_snapshot_id,
                        "supporting_dataset_snapshot_id": supporting_dataset_id,
                        "symbol_count": 0,
                        "row_count": 0,
                        "benchmark_trade_days": 0,
                        "coverage_days": 0,
                        "blocking": True,
                        "blocking_code": "SNAPSHOT_REFRESH_REQUIRED",
                        "blocking_target": "data_snapshots",
                        "message": "Snapshot data is not ready yet. Refresh snapshots before running this flow.",
                    }
                }
            memberships = self.market_data_repository.load_universe_memberships(universe_snapshot_id=universe_snapshot_id)
            if memberships:
                requested_end_date = str(request_payload.get("end_date") or date.today().isoformat())
                eligible_dates = sorted(
                    {
                        str(item.get("effective_date"))
                        for item in memberships
                        if str(item.get("effective_date")) <= requested_end_date
                    }
                )
                target_date = eligible_dates[-1] if eligible_dates else str(memberships[-1].get("effective_date"))
                universe_membership_symbols = [
                    str(item.get("symbol") or "").upper()
                    for item in memberships
                    if str(item.get("effective_date")) == target_date
                ]

        return {
            "benchmark_symbol": benchmark_symbol,
            "symbols": symbols,
            "dataset_snapshot_id": dataset_snapshot_id,
            "direct_symbol_universe": direct_symbol_universe,
            "universe_snapshot_id": universe_snapshot_id,
            "supporting_dataset_id": supporting_dataset_id,
            "price_dataset": price_dataset,
            "corporate_dataset": corporate_dataset,
            "universe_snapshot": universe_snapshot,
            "universe_membership_symbols": universe_membership_symbols,
            "start_date": request_payload.get("start_date"),
            "end_date": request_payload.get("end_date"),
        }

    def _build_snapshot_summary_from_context(
        self,
        context: Mapping[str, Any],
        bars: Mapping[str, list[dict[str, Any]]],
    ) -> dict[str, Any]:
        benchmark_symbol = str(context.get("benchmark_symbol") or "SPY").upper()
        symbols = [str(symbol).upper() for symbol in context.get("symbols") or []]
        dataset_snapshot_id = str(context.get("dataset_snapshot_id") or DATASET_PRICE_SNAPSHOT_ID)
        direct_symbol_universe = bool(context.get("direct_symbol_universe"))
        universe_snapshot_id = context.get("universe_snapshot_id")
        supporting_dataset_id = context.get("supporting_dataset_id") or DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID
        price_dataset = dict(context.get("price_dataset") or {})
        corporate_dataset = dict(context.get("corporate_dataset") or {}) if context.get("corporate_dataset") else None
        universe_snapshot = dict(context.get("universe_snapshot") or {}) if context.get("universe_snapshot") else None
        universe_membership_symbols = [str(symbol).upper() for symbol in context.get("universe_membership_symbols") or []]
        benchmark_trade_days = len(bars.get(benchmark_symbol, []))
        available_symbols = [symbol for symbol in symbols if bars.get(symbol)]
        row_count = sum(len(series) for series in bars.values())
        coverage_days = (
            benchmark_trade_days
            if direct_symbol_universe
            else sum(len(series) for symbol, series in bars.items() if symbol != benchmark_symbol)
        )
        blocking_items = []
        all_requested_symbols_available = len(available_symbols) == len(symbols)
        price_snapshot_ready_for_request = benchmark_trade_days > 0 and bool(available_symbols)
        universe_snapshot_ready_for_request = direct_symbol_universe or bool(universe_membership_symbols)
        required_snapshots = []
        if not price_snapshot_ready_for_request:
            required_snapshots.append(price_dataset)
        if universe_snapshot is not None and not universe_snapshot_ready_for_request:
            required_snapshots.append(universe_snapshot)
        for item in required_snapshots:
            if str(item.get("status") or "INCOMPLETE").upper() != "READY":
                blocking_items.append(item)
        blocking = bool(blocking_items) or benchmark_trade_days == 0 or not available_symbols
        blocker = dict(blocking_items[0].get("blocker") or {}) if blocking_items else {}
        status = "READY"
        if blocking_items:
            statuses = [str(item.get("status") or "INCOMPLETE").upper() for item in blocking_items]
            status = "FAILED" if "FAILED" in statuses else ("INCOMPLETE" if "INCOMPLETE" in statuses else "STALE")
        elif benchmark_trade_days == 0 or not available_symbols:
            status = "INCOMPLETE"
        corporate_status = str(corporate_dataset.get("status") or "INCOMPLETE").upper() if corporate_dataset else "NOT_REQUIRED"
        universe_status = str(universe_snapshot.get("status") or "INCOMPLETE").upper() if universe_snapshot else "NOT_REQUIRED"
        message = blocker.get("message") or (
            "Snapshot is partially available. Review the blocker details for the remaining gaps."
            if blocking
            else "Snapshot is available for request."
        )
        if (
            not blocking
            and price_snapshot_ready_for_request
            and (str(price_dataset.get("status") or "INCOMPLETE").upper() != "READY" or not all_requested_symbols_available)
        ):
            message = "Price snapshot is still incomplete. The run can proceed using the currently available symbols."
        elif (
            not blocking
            and universe_snapshot is not None
            and universe_snapshot_ready_for_request
            and universe_status != "READY"
        ):
            message = "Universe history snapshot is still incomplete. The run can proceed using the latest available anchor membership."
        elif (
            not blocking
            and corporate_status != "READY"
        ):
            message = "Corporate action snapshot is still incomplete. The run can proceed, but formal backtests may still be limited."
        return {
            "status": status,
            "dataset_snapshot_id": dataset_snapshot_id,
            "universe_snapshot_id": universe_snapshot_id,
            "supporting_dataset_snapshot_id": supporting_dataset_id,
            "symbol_count": len(available_symbols),
            "row_count": row_count,
            "benchmark_trade_days": benchmark_trade_days,
            "coverage_days": coverage_days,
            "blocking": blocking,
            "blocking_code": blocker.get("code") or ("SNAPSHOT_REFRESH_REQUIRED" if blocking else None),
            "blocking_target": blocker.get("target") or (blocking_items[0]["id"] if blocking_items else None),
            "message": message,
            "price_dataset_status": str(price_dataset.get("status") or "INCOMPLETE").upper(),
            "corporate_actions_status": corporate_status,
            "universe_status": universe_status,
            "latest_trade_date": bars.get(benchmark_symbol, [{}])[-1].get("date") if bars.get(benchmark_symbol) else None,
        }

    def _snapshot_summary(self, strategy: Mapping[str, Any], request_payload: Mapping[str, Any]) -> dict[str, Any]:
        context = self._snapshot_summary_context(strategy, request_payload)
        blocking_summary = context.get("blocking_summary")
        if blocking_summary:
            return dict(blocking_summary)

        requested_symbols = list(dict.fromkeys([str(context.get("benchmark_symbol") or "SPY").upper(), *list(context.get("symbols") or [])]))
        bars = self._load_snapshot_price_bars(
            str(context.get("dataset_snapshot_id") or DATASET_PRICE_SNAPSHOT_ID),
            requested_symbols,
            start_date=context.get("start_date"),
            end_date=context.get("end_date"),
        )
        return self._build_snapshot_summary_from_context(context, bars)

    def refresh_snapshots(self, request: Any | None = None) -> dict[str, Any]:
        raw_payload = dict(_as_mapping(request))
        existing_job_id = str(raw_payload.pop("_job_id", "") or "") or None
        existing_job_created_at = str(raw_payload.pop("_job_created_at", "") or "") or None
        existing_job_started_at = str(raw_payload.pop("_job_started_at", "") or "") or None
        payload, mode, targets = self._normalize_snapshot_refresh_request(raw_payload)
        started_at = iso_now()
        job_id = existing_job_id or self._new_id("snap")
        job_created_at = existing_job_created_at or started_at
        job_started_at = existing_job_started_at or started_at
        refresh_universes = "universes" in targets
        refresh_market_data = bool({"price", "corporate"} & set(targets))
        seeded_legacy_snapshot = (
            self._seed_dataset_snapshots_from_legacy_cache(as_of=started_at) if refresh_market_data else None
        )
        existing_corporate_snapshot = next(
            (
                dict(item)
                for item in self.market_data_repository.list_dataset_snapshots()
                if str(item.get("id")) == DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID
            ),
            None,
        )
        existing_price_snapshot = next(
            (
                dict(item)
                for item in self.market_data_repository.list_dataset_snapshots()
                if str(item.get("id")) == DATASET_PRICE_SNAPSHOT_ID
            ),
            None,
        )
        existing_price_coverage = list(self.market_data_repository.load_dataset_symbol_coverage(DATASET_PRICE_SNAPSHOT_ID))
        existing_corporate_coverage = list(
            self.market_data_repository.load_dataset_symbol_coverage(DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID)
        )
        existing_universe_memberships = {
            SP500_UNIVERSE_SNAPSHOT_ID: self.market_data_repository.load_universe_memberships(
                universe_snapshot_id=SP500_UNIVERSE_SNAPSHOT_ID
            ),
            NASDAQ100_UNIVERSE_SNAPSHOT_ID: self.market_data_repository.load_universe_memberships(
                universe_snapshot_id=NASDAQ100_UNIVERSE_SNAPSHOT_ID
            ),
        }
        existing_price_rows = {"price_bars": [], "symbol_coverage": existing_price_coverage}
        existing_corporate_rows = self.market_data_repository.load_dataset_snapshot_rows(
            DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID
        )
        snapshot_window_start = SNAPSHOT_START_DATE
        window_end = date.today()
        warnings: list[str] = []
        errors: list[str] = []
        self._raise_if_snapshot_memory_limit_exceeded(stage="refresh_preflight")
        if seeded_legacy_snapshot:
            warnings.append(
                "Seeded dataset snapshots from legacy local cache "
                f"({seeded_legacy_snapshot['price_row_count']} price rows across "
                f"{seeded_legacy_snapshot['coverage_symbol_count']} symbols)."
            )

        last_heartbeat_monotonic = 0.0

        universe_snapshots: list[Any] = []
        heartbeat_at = iso_now()
        self._persist_snapshot_refresh_heartbeat(
            job_id=job_id,
            request=payload,
            mode=mode,
            targets=targets,
            created_at=job_created_at,
            started_at=job_started_at,
            symbol_count=0,
            row_count=0,
            warnings=warnings,
            errors=errors,
            current_stage="preflight",
            current_stage_label="准备刷新快照",
            progress={"mode": mode, "targets": list(targets)},
            heartbeat_at=heartbeat_at,
            refresh_stats={},
        )
        last_heartbeat_monotonic = monotonic()
        for provider in (self._universe_history_providers() if refresh_universes else []):
            universe_snapshots.extend(provider.load_snapshots(snapshot_window_start, window_end))

        memberships_by_snapshot: dict[str, list[dict[str, Any]]] = {}
        grouped_universe_snapshots: dict[str, list[Any]] = {}
        for snapshot in universe_snapshots:
            snapshot_id = (
                SP500_UNIVERSE_SNAPSHOT_ID
                if str(snapshot.universe_key) == SP500_UNIVERSE_KEY
                else NASDAQ100_UNIVERSE_SNAPSHOT_ID
            )
            grouped_universe_snapshots.setdefault(snapshot_id, [])
            grouped_universe_snapshots[snapshot_id].append(snapshot)
            memberships_by_snapshot.setdefault(snapshot_id, [])
            memberships_by_snapshot[snapshot_id].extend(
                {
                    "effective_date": snapshot.effective_date.isoformat(),
                    "symbol": symbol,
                    "raw_symbol": symbol,
                    "membership_status": "ACTIVE",
                    "source": snapshot.source,
                    "fallback_source": snapshot.fallback_source,
                    "metadata": dict(snapshot.metadata),
                }
                for symbol in snapshot.normalized_symbols
            )
        for snapshot_id, anchor_snapshots in grouped_universe_snapshots.items():
            ordered_anchor_snapshots = sorted(anchor_snapshots, key=lambda item: item.effective_date)
            latest_snapshot = ordered_anchor_snapshots[-1]
            latest_anchor_date = latest_snapshot.effective_date.isoformat()
            source_quality_breakdown: dict[str, int] = {}
            historical_anchor_count = 0
            for item in ordered_anchor_snapshots:
                source_quality = str((item.metadata or {}).get("source_quality") or "").lower()
                source_quality_breakdown[source_quality or "unknown"] = (
                    source_quality_breakdown.get(source_quality or "unknown", 0) + 1
                )
                if source_quality in {"historical_revision_snapshot", "historical_constituent_api"} and not item.fallback_source:
                    historical_anchor_count += 1
            total_anchor_count = len(ordered_anchor_snapshots)
            latest_members = [
                row
                for row in memberships_by_snapshot.get(snapshot_id, [])
                if str(row.get("effective_date")) == latest_anchor_date
            ]
            source_names = sorted({str(item.source) for item in ordered_anchor_snapshots if item.source})
            fallback_sources = sorted(
                {str(item.fallback_source) for item in ordered_anchor_snapshots if item.fallback_source}
            )
            universe_status = (
                "READY"
                if total_anchor_count and historical_anchor_count == total_anchor_count
                else ("FAILED" if not latest_members else "INCOMPLETE")
            )
            if universe_status != "READY":
                probe_status = str((latest_snapshot.metadata or {}).get("historical_constituent_probe_status") or "").strip()
                if probe_status and probe_status != "available":
                    warnings.append(
                        f"{latest_snapshot.universe_name}: FMP historical constituent {probe_status.replace('_', ' ')}; "
                        f"fell back to {latest_snapshot.source} ({historical_anchor_count}/{total_anchor_count})."
                    )
                else:
                    warnings.append(
                        f"{latest_snapshot.universe_name}: historical anchors {historical_anchor_count}/{total_anchor_count} came from revision history."
                    )
            self.market_data_repository.replace_universe_snapshot(
                {
                    "id": snapshot_id,
                    "universe_key": latest_snapshot.universe_key,
                    "name": latest_snapshot.universe_name,
                    "status": universe_status,
                    "as_of": started_at,
                    "freshness_label": (
                        "Historical anchors are complete"
                        if universe_status == "READY"
                        else f"Historical anchors are still being repaired ({historical_anchor_count}/{total_anchor_count})"
                    ),
                    "window_start": snapshot_window_start.isoformat(),
                    "window_end": window_end.isoformat(),
                    "anchor_schedule": latest_snapshot.anchor_schedule or ANCHOR_SCHEDULE,
                    "member_count": len(latest_members) if latest_members else len(latest_snapshot.normalized_symbols),
                    "source": source_names[0] if len(source_names) == 1 else "mixed_sources",
                    "fallback_source": (
                        None
                        if not fallback_sources
                        else (fallback_sources[0] if len(fallback_sources) == 1 else "mixed_fallbacks")
                    ),
                    "blocker": {}
                    if universe_status == "READY"
                    else {
                        "code": "UNIVERSE_HISTORY_INCOMPLETE" if latest_members else "UNIVERSE_HISTORY_FAILED",
                        "message": (
                            "Universe history is partially available, but some historical anchors are still missing."
                            if latest_members
                            else "Universe history refresh failed and no usable historical anchors are available."
                        ),
                    },
                    "metadata": {
                        "source_page_title": latest_snapshot.source_page_title,
                        "source_revision_id": latest_snapshot.source_revision_id,
                        "latest_anchor_date": latest_anchor_date,
                        "anchor_count": total_anchor_count,
                        "historical_anchor_count": historical_anchor_count,
                        "fallback_anchor_count": total_anchor_count - historical_anchor_count,
                        "historical_constituent_provider": (latest_snapshot.metadata or {}).get("historical_constituent_provider"),
                        "historical_constituent_probe_status": (latest_snapshot.metadata or {}).get("historical_constituent_probe_status"),
                        "source_quality_breakdown": source_quality_breakdown,
                        "source_names": source_names,
                        "fallback_sources": fallback_sources,
                        **dict(latest_snapshot.metadata),
                    },
                },
                memberships=memberships_by_snapshot.get(snapshot_id, []),
            )

        universe_refresh_stats = self._build_refresh_stats(
            price_bars=[],
            corporate_actions=[],
            grouped_universe_snapshots=grouped_universe_snapshots,
            memberships_by_snapshot=memberships_by_snapshot,
            existing_universe_memberships=existing_universe_memberships,
        )
        self._persist_snapshot_refresh_heartbeat(
            job_id=job_id,
            request=payload,
            mode=mode,
            targets=targets,
            created_at=job_created_at,
            started_at=job_started_at,
            symbol_count=0,
            row_count=0,
            warnings=warnings,
            errors=errors,
            current_stage="universe_snapshots",
            current_stage_label="股票池历史锚点已落库",
            progress={
                "universes": len(grouped_universe_snapshots),
                "anchors": sum(len(items) for items in grouped_universe_snapshots.values()),
            },
            heartbeat_at=iso_now(),
            refresh_stats=universe_refresh_stats,
        )
        last_heartbeat_monotonic = monotonic()

        if not refresh_market_data:
            self._sync_strategy_snapshot_bindings(updated_at=started_at)
            preview_overview = self._build_snapshot_overview()
            completed_at = iso_now()
            refresh_stats = self._build_refresh_stats(
                price_bars=[],
                corporate_actions=[],
                grouped_universe_snapshots=grouped_universe_snapshots,
                memberships_by_snapshot=memberships_by_snapshot,
                existing_universe_memberships=existing_universe_memberships,
            )
            job = self._build_snapshot_refresh_job(
                job_id=job_id,
                request=payload,
                overview=preview_overview,
                mode=mode,
                targets=targets,
                symbol_count=0,
                row_count=0,
                warnings=warnings,
                errors=errors,
                created_at=job_created_at,
                started_at=job_started_at,
                completed_at=completed_at,
                refresh_stats=refresh_stats,
            )
            self._upsert_snapshot_refresh_job(job)
            if existing_job_id:
                self._clear_snapshot_refresh_runtime_state(job_id)
            return self.get_snapshot_overview()

        selected_symbols, selection_metadata = self._select_market_data_refresh_symbols(
            mode=mode,
            targets=targets,
            universe_snapshots=universe_snapshots,
            existing_price_snapshot=existing_price_snapshot,
            existing_corporate_snapshot=existing_corporate_snapshot,
        )
        if selection_metadata.get("selection_mode") == "repair_missing_symbols_batch":
            warnings.append(
                "Repair run scoped to "
                f"{len(selection_metadata.get('selected_missing_symbols') or [])} unresolved symbols "
                f"out of {selection_metadata.get('existing_missing_symbol_count') or 0}."
            )
        symbols = set(selected_symbols)
        if not symbols:
            symbols.update(self._stored_snapshot_symbols())
        symbols.update({"SPY", "QQQ"})
        for strategy in self.list_strategies():
            universe_name = str(strategy.get("universe_name") or "").strip().upper()
            if universe_name and universe_name.replace(".", "").isalnum():
                symbols.add(universe_name)

        latest_batch_symbols = set(symbols)
        repair_batch_symbols = set()
        if mode == "repair":
            latest_batch_symbols = {
                str(symbol or "").strip().upper()
                for symbol in (selection_metadata.get("selected_latest_symbols") or [])
                if str(symbol or "").strip()
            }
            repair_batch_symbols = {
                str(symbol or "").strip().upper()
                for symbol in (selection_metadata.get("selected_missing_symbols") or [])
                if str(symbol or "").strip()
            }
            if not latest_batch_symbols and not repair_batch_symbols:
                latest_batch_symbols = set(symbols)

        extras = {"SPY", "QQQ"}
        for strategy in self.list_strategies():
            universe_name = str(strategy.get("universe_name") or "").strip().upper()
            if universe_name and universe_name.replace(".", "").isalnum():
                extras.add(universe_name)

        if mode == "repair":
            latest_batch_symbols.update(extras)
        else:
            latest_batch_symbols = set(symbols) | extras

        progress_target_symbols = latest_batch_symbols | repair_batch_symbols
        if not progress_target_symbols:
            progress_target_symbols = set(symbols) | extras

        existing_price_missing = self._snapshot_missing_symbols(existing_price_snapshot)
        existing_corporate_missing = self._snapshot_missing_symbols(existing_corporate_snapshot)
        canonical_target_symbols = self._canonical_progress_target_symbols(
            progress_target_symbols=sorted(progress_target_symbols),
            existing_price_coverage=existing_price_coverage,
            existing_corporate_coverage=existing_corporate_coverage,
            existing_price_missing=existing_price_missing,
            existing_corporate_missing=existing_corporate_missing,
        )
        canonical_total_symbol_count = len(canonical_target_symbols)
        existing_missing_set = set(existing_price_missing) | set(existing_corporate_missing)

        latest_window_start = (
            self._latest_market_data_window_start(
                existing_price_snapshot=existing_price_snapshot,
                existing_corporate_snapshot=existing_corporate_snapshot,
                window_end=window_end,
            )
            if mode in {"incremental", "repair"}
            else snapshot_window_start
        )

        price_bars: list[dict[str, Any]] = []
        corporate_actions: list[dict[str, Any]] = []
        coverage_rows: list[CoverageSummary] = []
        corporate_coverage_rows: list[CoverageSummary] = []
        dataset_provider_telemetry = self._empty_dataset_provider_telemetry()
        missing_symbol_set: set[str] = set()
        corporate_missing_symbol_set: set[str] = set()
        action_partial = False
        ordered_symbols = sorted(progress_target_symbols)
        attempted_repair_symbols: set[str] = set()
        attempted_latest_symbols: set[str] = set()

        representative_provider = None
        representative_fallback_availability = None
        if mode == "repair":
            representative_provider = self._scoped_market_data_provider(
                mode="incremental",
                window_start=latest_window_start,
            )
            representative_fallback_provider = self._fallback_market_data_provider(representative_provider)
            representative_fallback_availability = (
                representative_fallback_provider.availability()
                if hasattr(representative_fallback_provider, "availability")
                else None
            )
        elif refresh_market_data:
            representative_provider = self._scoped_market_data_provider(
                mode=mode,
                window_start=latest_window_start if mode == "incremental" else snapshot_window_start,
            )
            representative_fallback_provider = self._fallback_market_data_provider(representative_provider)
            representative_fallback_availability = (
                representative_fallback_provider.availability()
                if hasattr(representative_fallback_provider, "availability")
                else None
            )

        default_source_name = str(
            getattr(representative_provider, "provider_name", "synthetic_seed")
            if representative_provider is not None
            else "synthetic_seed"
        )
        default_fallback_name = (
            representative_fallback_availability.provider_name
            if representative_fallback_availability
            else None
        )

        def current_missing_state() -> tuple[list[str], list[str]]:
            if mode == "repair":
                return (
                    sorted((existing_missing_set - attempted_repair_symbols) | set(missing_symbol_set)),
                    sorted((existing_missing_set - attempted_repair_symbols) | set(corporate_missing_symbol_set)),
                )
            return (sorted(missing_symbol_set), sorted(corporate_missing_symbol_set))

        def current_refresh_stats() -> dict[str, Any]:
            return self._build_refresh_stats(
                price_bars=price_bars,
                corporate_actions=corporate_actions,
                grouped_universe_snapshots=grouped_universe_snapshots,
                memberships_by_snapshot=memberships_by_snapshot,
                existing_universe_memberships=existing_universe_memberships,
                dataset_provider_telemetry=dataset_provider_telemetry,
            )

        def persist_partial_dataset_state() -> None:
            effective_missing_symbols, effective_corporate_missing_symbols = current_missing_state()
            if not price_bars and not corporate_actions:
                return
            self._persist_market_dataset_snapshots(
                as_of=iso_now(),
                mode=mode,
                snapshot_window_start=snapshot_window_start,
                window_end=window_end,
                selection_metadata=selection_metadata,
                existing_price_snapshot=existing_price_snapshot,
                existing_corporate_snapshot=existing_corporate_snapshot,
                existing_price_rows=existing_price_rows,
                existing_corporate_rows=existing_corporate_rows,
                price_bars=price_bars,
                corporate_actions=corporate_actions,
                coverage_rows=coverage_rows,
                corporate_coverage_rows=corporate_coverage_rows,
                effective_missing_symbols=effective_missing_symbols,
                effective_corporate_missing_symbols=effective_corporate_missing_symbols,
                action_partial=action_partial,
                canonical_target_symbols=canonical_target_symbols,
                canonical_total_symbol_count=canonical_total_symbol_count,
                default_source_name=default_source_name,
                default_fallback_name=default_fallback_name,
                cold_backup_result=None,
                recovery_report=None,
                running=True,
            )

        def emit_heartbeat(
            *,
            current_stage: str,
            current_stage_label: str,
            progress: Mapping[str, Any] | None = None,
            force: bool = False,
        ) -> None:
            nonlocal last_heartbeat_monotonic
            now_monotonic = monotonic()
            if not force and (now_monotonic - last_heartbeat_monotonic) < SNAPSHOT_REFRESH_HEARTBEAT_INTERVAL_SECONDS:
                return
            self._persist_snapshot_refresh_heartbeat(
                job_id=job_id,
                request=payload,
                mode=mode,
                targets=targets,
                created_at=job_created_at,
                started_at=job_started_at,
                symbol_count=len(coverage_rows),
                row_count=len(price_bars) + len(corporate_actions),
                warnings=warnings,
                errors=errors,
                current_stage=current_stage,
                current_stage_label=current_stage_label,
                progress=progress,
                heartbeat_at=iso_now(),
                refresh_stats=current_refresh_stats(),
            )
            last_heartbeat_monotonic = now_monotonic

        emit_heartbeat(
            current_stage="selection",
            current_stage_label="已确定本轮刷新目标",
            force=True,
            progress={
                "latest_symbol_count": len(latest_batch_symbols),
                "repair_symbol_count": len(repair_batch_symbols),
                "target_symbol_count": canonical_total_symbol_count,
            },
        )

        def consume_batch_result(batch_result: dict[str, Any]) -> None:
            nonlocal price_bars, corporate_actions, coverage_rows, corporate_coverage_rows, action_partial, dataset_provider_telemetry
            warnings.extend(str(item) for item in (batch_result.get("warnings") or []) if item)
            errors.extend(str(item) for item in (batch_result.get("errors") or []) if item)
            price_bars = self._merge_price_snapshot_rows(price_bars, batch_result.get("price_bars") or [])
            corporate_actions = self._merge_action_snapshot_rows(
                corporate_actions,
                batch_result.get("corporate_actions") or [],
            )
            coverage_rows = self._merge_coverage_rows(coverage_rows, batch_result.get("coverage_rows") or [])
            corporate_coverage_rows = self._merge_coverage_rows(
                corporate_coverage_rows,
                batch_result.get("corporate_coverage_rows") or [],
            )
            missing_symbol_set.update(
                str(item or "").strip().upper()
                for item in (batch_result.get("missing_symbols") or [])
                if str(item or "").strip()
            )
            corporate_missing_symbol_set.update(
                str(item or "").strip().upper()
                for item in (batch_result.get("corporate_missing_symbols") or [])
                if str(item or "").strip()
            )
            action_partial = action_partial or bool(batch_result.get("action_partial"))
            dataset_provider_telemetry = self._merge_dataset_provider_telemetry(
                dataset_provider_telemetry,
                batch_result.get("dataset_provider_telemetry"),
            )

        if mode == "repair":
            if latest_batch_symbols:
                latest_primary_provider = self._scoped_market_data_provider(
                    mode="incremental",
                    window_start=latest_window_start,
                )
                latest_fallback_provider = self._fallback_market_data_provider(latest_primary_provider)
                latest_fallback_availability = (
                    latest_fallback_provider.availability()
                    if hasattr(latest_fallback_provider, "availability")
                    else None
                )
                latest_symbol_batches = self._symbol_batches(
                    sorted(latest_batch_symbols),
                    SNAPSHOT_LATEST_SYMBOL_BATCH_SIZE,
                )
                for batch_index, latest_symbol_batch in enumerate(latest_symbol_batches, start=1):
                    consume_batch_result(
                        self._collect_market_data_refresh_batch(
                            symbols=latest_symbol_batch,
                            window_start=latest_window_start,
                            window_end=window_end,
                            primary_provider=latest_primary_provider,
                            fallback_provider=latest_fallback_provider,
                            fallback_availability=latest_fallback_availability,
                            worker_cap=SNAPSHOT_MARKET_DATA_MAX_WORKERS,
                        )
                    )
                    attempted_latest_symbols.update(latest_symbol_batch)
                    persist_partial_dataset_state()
                    emit_heartbeat(
                        current_stage="latest_market_data",
                        current_stage_label="正在抓取最新窗口数据",
                        force=True,
                        progress={
                            "phase": "latest_market_data",
                            "completed_batches": batch_index,
                            "total_batches": len(latest_symbol_batches),
                            "completed_symbols": len(attempted_latest_symbols),
                            "total_symbols": len(latest_batch_symbols),
                            "persisted_row_count": len(price_bars) + len(corporate_actions),
                        },
                    )
            if repair_batch_symbols:
                repair_primary_provider = self._scoped_market_data_provider(
                    mode="repair",
                    window_start=snapshot_window_start,
                )
                repair_fallback_provider = self._fallback_market_data_provider(repair_primary_provider)
                repair_fallback_availability = (
                    repair_fallback_provider.availability()
                    if hasattr(repair_fallback_provider, "availability")
                    else None
                )
                repair_symbol_batches = self._symbol_batches(
                    sorted(repair_batch_symbols),
                    SNAPSHOT_REPAIR_SYMBOL_BATCH_SIZE,
                )
                for batch_index, repair_symbol_batch in enumerate(repair_symbol_batches, start=1):
                    consume_batch_result(
                        self._collect_market_data_refresh_batch(
                            symbols=repair_symbol_batch,
                            window_start=snapshot_window_start,
                            window_end=window_end,
                            primary_provider=repair_primary_provider,
                            fallback_provider=repair_fallback_provider,
                            fallback_availability=repair_fallback_availability,
                            worker_cap=SNAPSHOT_MARKET_DATA_REPAIR_MAX_WORKERS,
                        )
                    )
                    attempted_repair_symbols.update(repair_symbol_batch)
                    persist_partial_dataset_state()
                    emit_heartbeat(
                        current_stage="repair_market_data",
                        current_stage_label="正在修复历史缺口数据",
                        force=True,
                        progress={
                            "phase": "repair_market_data",
                            "completed_batches": batch_index,
                            "total_batches": len(repair_symbol_batches),
                            "completed_symbols": len(attempted_repair_symbols),
                            "total_symbols": len(repair_batch_symbols),
                            "persisted_row_count": len(price_bars) + len(corporate_actions),
                        },
                    )
        else:
            market_data_window_start = latest_window_start if mode == "incremental" else snapshot_window_start
            primary_provider = self._scoped_market_data_provider(
                mode=mode,
                window_start=market_data_window_start,
            )
            fallback_provider = self._fallback_market_data_provider(primary_provider)
            fallback_availability = (
                fallback_provider.availability()
                if hasattr(fallback_provider, "availability")
                else None
            )
            latest_symbol_batches = self._symbol_batches(
                sorted(latest_batch_symbols),
                SNAPSHOT_LATEST_SYMBOL_BATCH_SIZE,
            )
            for batch_index, latest_symbol_batch in enumerate(latest_symbol_batches, start=1):
                consume_batch_result(
                    self._collect_market_data_refresh_batch(
                        symbols=latest_symbol_batch,
                        window_start=market_data_window_start,
                        window_end=window_end,
                        primary_provider=primary_provider,
                        fallback_provider=fallback_provider,
                        fallback_availability=fallback_availability,
                        worker_cap=SNAPSHOT_MARKET_DATA_MAX_WORKERS,
                    )
                )
                attempted_latest_symbols.update(latest_symbol_batch)
                persist_partial_dataset_state()
                emit_heartbeat(
                    current_stage="latest_market_data",
                    current_stage_label="正在抓取最新窗口数据",
                    force=True,
                    progress={
                        "phase": "latest_market_data",
                        "completed_batches": batch_index,
                        "total_batches": len(latest_symbol_batches),
                        "completed_symbols": len(attempted_latest_symbols),
                        "total_symbols": len(latest_batch_symbols),
                        "persisted_row_count": len(price_bars) + len(corporate_actions),
                    },
                )

        effective_missing_symbols, effective_corporate_missing_symbols = current_missing_state()
        recovery_report = None
        cold_backup_result = None
        if effective_missing_symbols or effective_corporate_missing_symbols:
            recovery_report = probe_lab2_snapshot_assets()
            warnings.extend(recovery_report.notes)
            if recovery_report.usable_assets:
                cold_backup_result = import_snapshot_cold_backup(self.market_data_repository, recovery_report.usable_assets[0])
                warnings.append(f"Cold backup import attempted from {recovery_report.usable_assets[0]}.")
            else:
                warnings.append("No usable cold backup snapshot database found under Lab2.")
        emit_heartbeat(
            current_stage="finalizing",
            current_stage_label="正在整理最终快照",
            force=True,
            progress={
                "phase": "finalizing",
                "persisted_row_count": len(price_bars) + len(corporate_actions),
                "price_missing_symbol_count": len(effective_missing_symbols),
                "corporate_missing_symbol_count": len(effective_corporate_missing_symbols),
            },
        )
        self._persist_market_dataset_snapshots(
            as_of=started_at,
            mode=mode,
            snapshot_window_start=snapshot_window_start,
            window_end=window_end,
            selection_metadata=selection_metadata,
            existing_price_snapshot=existing_price_snapshot,
            existing_corporate_snapshot=existing_corporate_snapshot,
            existing_price_rows=existing_price_rows,
            existing_corporate_rows=existing_corporate_rows,
            price_bars=price_bars,
            corporate_actions=corporate_actions,
            coverage_rows=coverage_rows,
            corporate_coverage_rows=corporate_coverage_rows,
            effective_missing_symbols=effective_missing_symbols,
            effective_corporate_missing_symbols=effective_corporate_missing_symbols,
            action_partial=action_partial,
            canonical_target_symbols=canonical_target_symbols,
            canonical_total_symbol_count=canonical_total_symbol_count,
            default_source_name=default_source_name,
            default_fallback_name=default_fallback_name,
            cold_backup_result=cold_backup_result,
            recovery_report=recovery_report,
            running=False,
        )

        self._sync_strategy_snapshot_bindings(updated_at=started_at)
        preview_overview = self._build_snapshot_overview()
        completed_at = iso_now()
        refresh_stats = self._build_refresh_stats(
            price_bars=price_bars,
            corporate_actions=corporate_actions,
            grouped_universe_snapshots=grouped_universe_snapshots,
            memberships_by_snapshot=memberships_by_snapshot,
            existing_universe_memberships=existing_universe_memberships,
            dataset_provider_telemetry=dataset_provider_telemetry,
        )
        job = self._build_snapshot_refresh_job(
            job_id=job_id,
            request=payload,
            overview=preview_overview,
            mode=mode,
            targets=targets,
            symbol_count=len(coverage_rows),
            row_count=len(price_bars) + len(corporate_actions),
            warnings=warnings,
            errors=errors,
            created_at=job_created_at,
            started_at=job_started_at,
            completed_at=completed_at,
            refresh_stats=refresh_stats,
        )
        self._upsert_snapshot_refresh_job(job)
        if existing_job_id:
            self._clear_snapshot_refresh_runtime_state(job_id)
        return self.get_snapshot_overview()

    def get_snapshot_overview(self) -> dict[str, Any]:
        latest = self.storage.fetch_one("SELECT * FROM snapshot_refresh_jobs ORDER BY created_at DESC LIMIT 1")
        return self._build_snapshot_overview(self._decode_snapshot_refresh_job(latest))

    def list_strategies(self) -> list[dict[str, Any]]:
        return [self._normalize_strategy_snapshot_bindings(strategy) for strategy in super().list_strategies()]

    def get_strategy_detail(self, strategy_id: str) -> dict[str, Any]:
        return self._normalize_strategy_snapshot_bindings(super().get_strategy_detail(strategy_id))

    def _engine_parameters(self, strategy: Mapping[str, Any]) -> dict[str, Any]:
        parameters = dict(strategy.get("parameters") or {})
        strategy_type = str(strategy.get("strategy_type") or parameters.get("strategy_type") or "MOMENTUM").upper()
        parameters["template_key"] = strategy_type.lower()
        if strategy_type == "MOMENTUM":
            parameters.setdefault("top_n", 5)
            parameters.setdefault("holding_count", int(parameters.get("top_n") or 5))
            parameters.setdefault("lookback_days", int(parameters.get("lookback_months") or 12) * 21)
            parameters.setdefault("rebalance_frequency", "monthly")
        elif strategy_type == "GRID":
            parameters.setdefault("holding_count", 1)
            parameters.setdefault("top_n", 1)
            parameters.setdefault("lookback_days", 21)
            parameters.setdefault("rebalance_frequency", "never")
        parameters.setdefault("benchmark_symbol", str(strategy.get("benchmark_symbol") or "SPY"))
        return parameters

    def _normalize_run_request(self, strategy: Mapping[str, Any], payload: Mapping[str, Any]) -> dict[str, Any]:
        normalized = dict(payload)
        normalized["data_segment_type"] = str(normalized.get("data_segment_type") or "FULL").upper()
        normalized["parameter_version_id"] = str(
            normalized.get("parameter_version_id")
            or strategy.get("current_parameter_version_id")
            or ""
        ) or None
        normalized["dataset_snapshot_id"] = str(
            normalized.get("dataset_snapshot_id")
            or strategy.get("dataset_snapshot_id")
            or DATASET_PRICE_SNAPSHOT_ID
        )
        normalized["execution_policy"] = str(
            normalized.get("execution_policy")
            or "T_CLOSE_TO_T1_OPEN"
        )
        normalized["universe_snapshot_id"] = self._resolved_universe_snapshot_id(strategy, normalized)
        normalized["is_permanent"] = bool(normalized.get("is_permanent", False))
        return normalized

    def _strategy_for_run(self, strategy: Mapping[str, Any], request_payload: Mapping[str, Any]) -> dict[str, Any]:
        resolved = dict(strategy)
        resolved["parameters"] = self._parameter_snapshot_for_version(strategy, request_payload.get("parameter_version_id"))
        resolved["selected_parameter_version_id"] = request_payload.get("parameter_version_id")
        return resolved

    def _trade_audit_commentary(
        self,
        *,
        pnl_pct: float,
        max_favorable_excursion_pct: float,
        max_adverse_excursion_pct: float,
        slippage_cost_pct: float,
    ) -> str:
        if pnl_pct > 0 and abs(max_adverse_excursion_pct) <= max(max_favorable_excursion_pct * 0.5, 0.5):
            return "Held the favorable move without taking deep heat."
        if pnl_pct > 0:
            return "Captured profit, but the path included meaningful give-back before exit."
        if abs(max_adverse_excursion_pct) > max(max_favorable_excursion_pct, 0.5):
            return "Heat outweighed follow-through before the position could recover."
        if slippage_cost_pct > 0:
            return "Trade was marginal and execution costs consumed a visible share of the edge."
        return "Trade was chopped before a decisive extension developed."

    def _build_trade_audit_record(
        self,
        *,
        run_id: str,
        strategy: Mapping[str, Any],
        request_payload: Mapping[str, Any],
        symbol: str,
        episode_index: int,
        entry_event: Mapping[str, Any],
        exit_event: Mapping[str, Any],
        events: list[Mapping[str, Any]],
        raw_bars: list[dict[str, Any]],
        oos_start_date: str | None,
    ) -> dict[str, Any]:
        entry_date = str(entry_event.get("trade_date"))
        exit_date = str(exit_event.get("trade_date"))
        normalized_bars = _normalize_bars(raw_bars)
        entry_index = next((index for index, bar in enumerate(normalized_bars) if bar.date == entry_date), 0)
        exit_index = next((index for index, bar in enumerate(normalized_bars) if bar.date == exit_date), len(normalized_bars) - 1)
        window_start = max(entry_index - 5, 0)
        window_end = max(exit_index + 1, window_start + 1)
        window_bars = [
            {
                "date": raw_bars[index].get("date"),
                "open": raw_bars[index].get("open"),
                "high": raw_bars[index].get("high"),
                "low": raw_bars[index].get("low"),
                "close": raw_bars[index].get("close"),
                "adj_close": raw_bars[index].get("adj_close"),
                "volume": raw_bars[index].get("volume"),
            }
            for index in range(window_start, min(window_end, len(raw_bars)))
        ]
        if not window_bars:
            synthetic_price = _coerce_float(entry_event.get("price"), 0.0)
            window_bars = [
                {
                    "date": entry_date,
                    "open": synthetic_price,
                    "high": synthetic_price,
                    "low": synthetic_price,
                    "close": synthetic_price,
                    "adj_close": synthetic_price,
                    "volume": 0.0,
                }
            ]

        entry_price = _coerce_float(entry_event.get("price"), _coerce_float(window_bars[max(entry_index - window_start, 0)].get("open")))
        exit_price = _coerce_float(exit_event.get("price"), _coerce_float(window_bars[-1].get("close"), entry_price))
        episode_bars = [bar for bar in window_bars if str(bar.get("date")) >= entry_date and str(bar.get("date")) <= exit_date]
        if not episode_bars:
            episode_bars = list(window_bars)

        max_favorable_excursion_pct = max(
            (_pct_change(bar.get("high", bar.get("close")), entry_price) for bar in episode_bars),
            default=0.0,
        )
        max_adverse_excursion_pct = min(
            (_pct_change(bar.get("low", bar.get("close")), entry_price) for bar in episode_bars),
            default=0.0,
        )
        pnl_pct = _pct_change(exit_price, entry_price)
        turnover = sum(
            abs(_coerce_float(item.get("weight_after")) - _coerce_float(item.get("weight_before")))
            for item in events
        )
        execution_bps = _coerce_float(request_payload.get("slippage_bps")) + _coerce_float(request_payload.get("fee_bps"))
        slippage_cost_pct = round((execution_bps / 10000.0) * turnover * 100.0, 4)

        engine_parameters = self._engine_parameters(strategy)
        signal_score = None
        if normalized_bars and 0 <= entry_index < len(normalized_bars):
            signal_score = _signal_score(
                normalized_bars,
                entry_index,
                max(int(engine_parameters.get("lookback_days") or 21), 5),
                str(engine_parameters.get("template_key") or strategy.get("strategy_type") or "momentum"),
            )
        commentary = self._trade_audit_commentary(
            pnl_pct=pnl_pct,
            max_favorable_excursion_pct=max_favorable_excursion_pct,
            max_adverse_excursion_pct=max_adverse_excursion_pct,
            slippage_cost_pct=slippage_cost_pct,
        )
        mfe_mae_ratio = round(
            max_favorable_excursion_pct / abs(max_adverse_excursion_pct),
            4,
        ) if abs(max_adverse_excursion_pct) > 1e-9 else 0.0
        trade_id = f"{run_id}:{symbol}:{episode_index}"
        segment = _segment_for_trade_window(entry_date, exit_date, oos_start_date)
        return {
            "trade_id": trade_id,
            "symbol": symbol,
            "segment": segment,
            "opened_at": entry_date,
            "closed_at": exit_date,
            "pnl_pct": pnl_pct,
            "max_favorable_excursion_pct": round(max_favorable_excursion_pct, 4),
            "max_adverse_excursion_pct": round(max_adverse_excursion_pct, 4),
            "slippage_cost_pct": slippage_cost_pct,
            "commentary": commentary,
            "price_series": window_bars,
            "trigger_snapshot": {
                "symbol": symbol,
                "template_key": str(engine_parameters.get("template_key") or strategy.get("strategy_type") or "momentum"),
                "lookback_days": int(engine_parameters.get("lookback_days") or 21),
                "rebalance_frequency": str(engine_parameters.get("rebalance_frequency") or "weekly"),
                "parameter_version_id": request_payload.get("parameter_version_id"),
                "entry_weight_after": round(_coerce_float(entry_event.get("weight_after")), 4),
                "signal_score": round(float(signal_score), 6) if signal_score is not None else None,
                "reason": entry_event.get("reason"),
            },
            "risk_evaluation": {
                "max_favorable_excursion_pct": round(max_favorable_excursion_pct, 4),
                "max_adverse_excursion_pct": round(max_adverse_excursion_pct, 4),
                "mfe_mae_ratio": mfe_mae_ratio,
                "slippage_cost_pct": slippage_cost_pct,
                "commentary": commentary,
            },
            "entry_marker": {"date": entry_date, "price": round(entry_price, 4)},
            "exit_marker": {"date": exit_date, "price": round(exit_price, 4)},
            "chart_band": {
                "start_date": entry_date,
                "end_date": exit_date,
                "color": "rgba(22,163,74,0.22)" if pnl_pct >= 0 else "rgba(220,38,38,0.22)",
                "pnl_pct": pnl_pct,
            },
        }

    def _build_trade_audits(
        self,
        *,
        run_id: str,
        strategy: Mapping[str, Any],
        request_payload: Mapping[str, Any],
        trades: list[dict[str, Any]],
        oos_start_date: str | None,
    ) -> list[dict[str, Any]]:
        symbols = sorted({str(item.get("symbol") or "").upper() for item in trades if item.get("symbol")})
        if not symbols:
            return []
        dataset_snapshot_id = str(request_payload.get("dataset_snapshot_id") or DATASET_PRICE_SNAPSHOT_ID)
        bars_by_symbol = self._load_snapshot_price_bars(dataset_snapshot_id, symbols)
        open_episodes: dict[str, dict[str, Any]] = {}
        episode_indexes: dict[str, int] = {}
        audits: list[dict[str, Any]] = []

        for trade in trades:
            symbol = str(trade.get("symbol") or "").upper()
            if not symbol:
                continue
            weight_before = _coerce_float(trade.get("weight_before"))
            weight_after = _coerce_float(trade.get("weight_after"))
            if weight_before <= 1e-9 and weight_after > 1e-9:
                episode_indexes[symbol] = episode_indexes.get(symbol, 0) + 1
                open_episodes[symbol] = {
                    "index": episode_indexes[symbol],
                    "entry_event": dict(trade),
                    "events": [dict(trade)],
                }
                continue
            if symbol not in open_episodes:
                continue
            open_episodes[symbol]["events"].append(dict(trade))
            if weight_after <= 1e-9:
                audits.append(
                    self._build_trade_audit_record(
                        run_id=run_id,
                        strategy=strategy,
                        request_payload=request_payload,
                        symbol=symbol,
                        episode_index=int(open_episodes[symbol]["index"]),
                        entry_event=open_episodes[symbol]["entry_event"],
                        exit_event=dict(trade),
                        events=list(open_episodes[symbol]["events"]),
                        raw_bars=list(bars_by_symbol.get(symbol, [])),
                        oos_start_date=oos_start_date,
                    )
                )
                del open_episodes[symbol]

        for symbol, episode in open_episodes.items():
            raw_bars = list(bars_by_symbol.get(symbol, []))
            if not raw_bars:
                continue
            audits.append(
                self._build_trade_audit_record(
                    run_id=run_id,
                    strategy=strategy,
                    request_payload=request_payload,
                    symbol=symbol,
                    episode_index=int(episode["index"]),
                    entry_event=episode["entry_event"],
                    exit_event={
                        "trade_date": raw_bars[-1]["date"],
                        "price": raw_bars[-1].get("close"),
                    },
                    events=list(episode["events"]),
                    raw_bars=raw_bars,
                    oos_start_date=oos_start_date,
                )
            )

        audits.sort(key=lambda item: (item["opened_at"], item["symbol"], item["trade_id"]))
        return audits

    def _build_trade_audit_items(
        self,
        trade_audits: Sequence[Mapping[str, Any]] | Sequence[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for item in trade_audits:
            items.append(
                {
                    "trade_id": str(item.get("trade_id") or ""),
                    "symbol": str(item.get("symbol") or ""),
                    "segment": str(item.get("segment") or ""),
                    "opened_at": item.get("opened_at"),
                    "closed_at": item.get("closed_at"),
                    "pnl_pct": float(item.get("pnl_pct") or 0.0),
                    "max_favorable_excursion_pct": float(item.get("max_favorable_excursion_pct") or 0.0),
                    "max_adverse_excursion_pct": float(item.get("max_adverse_excursion_pct") or 0.0),
                    "slippage_cost_pct": float(item.get("slippage_cost_pct") or 0.0),
                    "commentary": str(item.get("commentary") or ""),
                }
            )
        return items

    def _load_or_backfill_trade_audit_items(self, run_id: str) -> list[dict[str, Any]]:
        row = self.storage.fetch_one(
            "SELECT trade_audit_items_json, trade_audit_json FROM backtest_runs WHERE id = ? AND deleted_at IS NULL",
            (run_id,),
        )
        if not row:
            return []

        items = loads(row.get("trade_audit_items_json"), [])
        if isinstance(items, list) and items:
            return [dict(item) for item in items if isinstance(item, Mapping)]

        trade_audits = loads(row.get("trade_audit_json"), [])
        if not isinstance(trade_audits, list) or not trade_audits:
            return []

        projected_items = self._build_trade_audit_items(trade_audits)
        self.storage.execute(
            "UPDATE backtest_runs SET trade_audit_items_json = ?, updated_at = ? WHERE id = ?",
            (dumps(projected_items), iso_now(), run_id),
        )
        return projected_items

    def _rolling_metrics_need_rebuild(self, rolling_metrics: Sequence[Mapping[str, Any]] | Sequence[dict[str, Any]]) -> bool:
        if not rolling_metrics:
            return True
        latest = rolling_metrics[-1]
        return not (
            int(latest.get("window_days") or 0) == 252
            and latest.get("trailing_252_return") is not None
            and latest.get("trailing_252_sharpe") is not None
        )

    def _downsample_detail_series(
        self,
        points: Sequence[Mapping[str, Any]] | Sequence[dict[str, Any]],
        *,
        max_points: int,
        keep_indexes: Sequence[int] | None = None,
    ) -> list[dict[str, Any]]:
        materialized = [dict(point or {}) for point in points]
        total = len(materialized)
        if total <= max_points:
            return materialized

        preserved_indexes = {
            int(index)
            for index in (keep_indexes or [])
            if isinstance(index, int) and 0 <= int(index) < total
        }
        preserved_indexes.update({0, total - 1})

        remaining_slots = max(max_points - len(preserved_indexes), 0)
        if remaining_slots > 0:
            divisor = max(remaining_slots - 1, 1)
            for position in range(remaining_slots):
                sample_index = round(position * (total - 1) / divisor)
                preserved_indexes.add(sample_index)

        ordered_indexes = sorted(preserved_indexes)
        if len(ordered_indexes) <= max_points:
            return [materialized[index] for index in ordered_indexes]

        boundary_indexes = sorted(
            index for index in preserved_indexes if index in {0, total - 1} or index in set(keep_indexes or [])
        )
        boundary_set = set(boundary_indexes)
        remaining_budget = max(max_points - len(boundary_indexes), 0)
        filler_candidates = [index for index in ordered_indexes if index not in boundary_set]
        sampled_fillers: set[int] = set()
        if remaining_budget > 0 and filler_candidates:
            divisor = max(remaining_budget - 1, 1)
            for position in range(remaining_budget):
                sampled_fillers.add(
                    filler_candidates[round(position * (len(filler_candidates) - 1) / divisor)]
                )
        final_indexes = sorted(boundary_set | sampled_fillers)
        return [materialized[index] for index in final_indexes]

    def _prepare_backtest_run_context(
        self,
        strategy: Mapping[str, Any],
        request_payload: Mapping[str, Any],
    ) -> dict[str, Any]:
        context = self._snapshot_summary_context(strategy, request_payload)
        blocking_summary = context.get("blocking_summary")
        if blocking_summary:
            raise SnapshotBlockingError(blocking_summary)

        benchmark_symbol = str(context.get("benchmark_symbol") or strategy.get("benchmark_symbol") or "SPY").upper()
        symbols = [str(symbol).upper() for symbol in context.get("symbols") or self._resolve_universe_symbols(strategy, request_payload)]
        dataset_snapshot_id = str(context.get("dataset_snapshot_id") or request_payload.get("dataset_snapshot_id") or DATASET_PRICE_SNAPSHOT_ID)
        requested_symbols = list(dict.fromkeys([*symbols, benchmark_symbol]))
        raw_bars = self._load_snapshot_price_bars(
            dataset_snapshot_id,
            requested_symbols,
            start_date=context.get("start_date"),
            end_date=context.get("end_date"),
        )
        snapshot_summary = self._build_snapshot_summary_from_context(context, raw_bars)
        if is_snapshot_blocking(snapshot_summary):
            raise SnapshotBlockingError(snapshot_summary)
        bars_by_symbol = {
            symbol: list(raw_bars.get(symbol, []))
            for symbol in symbols
        }
        benchmark_bars = list(raw_bars.get(benchmark_symbol, []))
        config = BacktestConfig(
            start_date=request_payload.get("start_date"),
            end_date=request_payload.get("end_date"),
            benchmark_symbol=benchmark_symbol,
        )
        prepared_inputs = prepare_backtest_inputs(
            bars_by_symbol,
            config=config,
            benchmark_bars=benchmark_bars,
        )
        return {
            "benchmark_symbol": benchmark_symbol,
            "symbols": symbols,
            "snapshot_summary": snapshot_summary,
            "dataset_snapshot_id": request_payload.get("dataset_snapshot_id"),
            "universe_snapshot_id": request_payload.get("universe_snapshot_id"),
            "config": config,
            "prepared_inputs": prepared_inputs,
        }

    def _simulate_run_from_prepared_context(
        self,
        strategy: Mapping[str, Any],
        request_payload: Mapping[str, Any],
        prepared_context: Mapping[str, Any],
    ) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
        benchmark_symbol = str(prepared_context.get("benchmark_symbol") or strategy.get("benchmark_symbol") or "SPY").upper()
        symbols = list(prepared_context.get("symbols") or self._resolve_universe_symbols(strategy, request_payload))
        snapshot_summary = dict(prepared_context.get("snapshot_summary") or self._snapshot_summary(strategy, request_payload))
        result = run_backtest_prepared(
            prepared_context["prepared_inputs"],
            config=prepared_context.get("config"),
            parameters=self._engine_parameters(strategy),
        )

        benchmark_equity = 100.0
        chart_series: list[dict[str, Any]] = []
        for point in result.daily_performance:
            benchmark_equity *= 1.0 + float(point.benchmark_return or 0.0)
            chart_series.append(
                {
                    "trade_date": point.date,
                    "equity": round(float(point.equity), 4),
                    "benchmark": round(benchmark_equity, 4),
                    "drawdown": round(float(point.drawdown) * 100.0, 4),
                    "is_oos": not bool(point.in_sample),
                    "strategy_return": float(point.strategy_return or 0.0),
                    "benchmark_return": float(point.benchmark_return or 0.0),
                }
            )

        trades = []
        for item in result.trades:
            segment = "OOS" if result.oos_start_date and item.date >= result.oos_start_date else "IS"
            trade = asdict(item)
            trade["trade_date"] = trade.pop("date")
            trade["segment"] = segment
            trades.append(trade)

        warnings = list(result.warnings)
        if result.coverage_ratio < 0.8:
            warnings.append("Coverage below 80%")
        summary = metric_summary(asdict(result.metrics))
        preview = {
            "strategy_id": strategy["id"],
            "effective_date": result.effective_date,
            "oos_start_date": result.oos_start_date,
            "coverage_ratio": result.coverage_ratio,
            "coverage_days": result.coverage_days,
            "data_segment_type": str(request_payload.get("data_segment_type") or "FULL").upper(),
            "dataset_snapshot_id": prepared_context.get("dataset_snapshot_id"),
            "universe_snapshot_id": prepared_context.get("universe_snapshot_id"),
            "warnings": warnings,
            "snapshot_summary": snapshot_summary,
            "metrics": summary,
            "parameter_snapshot": dict(strategy.get("parameters") or {}),
            "parameter_version_id": request_payload.get("parameter_version_id"),
            "environment_summary": {
                "benchmark_symbol": benchmark_symbol,
                "universe_name": strategy.get("universe_name"),
                "universe_size": len(symbols),
                "symbols": symbols,
                "dataset_snapshot_id": prepared_context.get("dataset_snapshot_id"),
                "universe_snapshot_id": prepared_context.get("universe_snapshot_id"),
            },
            "blind_test_zone": {"label": "Blind Test Zone", "oos_start_date": result.oos_start_date},
        }
        return preview, chart_series, trades

    def _simulate_run(self, strategy: Mapping[str, Any], request_payload: Mapping[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
        prepared_context = self._prepare_backtest_run_context(strategy, request_payload)
        return self._simulate_run_from_prepared_context(strategy, request_payload, prepared_context)

    def preview_backtest_run(self, strategy_id: str, request: Any | None = None) -> dict[str, Any]:
        strategy = self.get_strategy_detail(strategy_id)
        payload = self._normalize_run_request(strategy, _as_mapping(request))
        effective_strategy = self._strategy_for_run(strategy, payload)
        preview, _, _ = self._simulate_run(effective_strategy, payload)
        return preview

    preview_backtest = preview_backtest_run

    def _build_pending_backtest_preview(
        self,
        strategy: Mapping[str, Any],
        request_payload: Mapping[str, Any],
    ) -> dict[str, Any]:
        parameter_snapshot = dict(
            self._parameter_snapshot_for_version(strategy, request_payload.get("parameter_version_id"))
            or {}
        )
        return {
            "warnings": [],
            "effective_start_date": request_payload.get("start_date"),
            "effective_end_date": request_payload.get("end_date"),
            "data_segment_type": request_payload.get("data_segment_type"),
            "dataset_snapshot_id": request_payload.get("dataset_snapshot_id"),
            "universe_snapshot_id": request_payload.get("universe_snapshot_id"),
            "parameter_version_id": request_payload.get("parameter_version_id"),
            "execution_policy": request_payload.get("execution_policy"),
            "parameter_snapshot": parameter_snapshot,
            "environment_summary": {
                "benchmark_symbol": str(strategy.get("benchmark_symbol") or "SPY"),
                "universe_name": strategy.get("universe_name"),
                "symbols": [],
                "dataset_snapshot_id": request_payload.get("dataset_snapshot_id"),
                "universe_snapshot_id": request_payload.get("universe_snapshot_id"),
            },
            "snapshot_summary": {
                "status": "PENDING",
                "blocking": False,
                "dataset_snapshot_id": request_payload.get("dataset_snapshot_id"),
                "universe_snapshot_id": request_payload.get("universe_snapshot_id"),
            },
        }

    def _build_backtest_run_row(
        self,
        *,
        run_id: str,
        strategy_id: str,
        status: str,
        request_payload: Mapping[str, Any],
        created_at: str,
        updated_at: str,
        preview: Mapping[str, Any] | None = None,
        metrics: Mapping[str, Any] | None = None,
        parameter_snapshot: Mapping[str, Any] | None = None,
        environment_summary: Mapping[str, Any] | None = None,
        relative_metrics: Mapping[str, Any] | None = None,
        consistency_score: Mapping[str, Any] | None = None,
        risk_metrics: Mapping[str, Any] | None = None,
        drawdown_events: Sequence[Mapping[str, Any]] | None = None,
        rolling_metrics: Sequence[Mapping[str, Any]] | None = None,
        monthly_returns: Sequence[Mapping[str, Any]] | None = None,
        chart_series: Sequence[Mapping[str, Any]] | None = None,
        trades: Sequence[Mapping[str, Any]] | None = None,
        trade_audit_items: Sequence[Mapping[str, Any]] | None = None,
        trade_audit: Sequence[Mapping[str, Any]] | None = None,
        warnings: Sequence[str] | None = None,
        error_message: str | None = None,
        completed_at: str | None = None,
        coverage_ratio: float | None = None,
        coverage_days: int | None = None,
    ) -> dict[str, Any]:
        preview_payload = dict(preview or {})
        parameter_snapshot_payload = dict(
            parameter_snapshot
            or preview_payload.get("parameter_snapshot")
            or {}
        )
        environment_summary_payload = dict(
            environment_summary
            or preview_payload.get("environment_summary")
            or {}
        )
        trade_rows = list(trades or [])
        trade_audit_item_rows = list(trade_audit_items or [])
        trade_audit_rows = list(trade_audit or [])
        return {
            "id": run_id,
            "strategy_id": strategy_id,
            "status": status,
            "source_run_id": request_payload.get("source_run_id"),
            "request_kind": "official",
            "is_permanent": 1 if bool(request_payload.get("is_permanent", False)) else 0,
            "start_date": request_payload.get("start_date"),
            "end_date": request_payload.get("end_date"),
            "effective_date": preview_payload.get("effective_date"),
            "oos_start_date": preview_payload.get("oos_start_date"),
            "coverage_ratio": coverage_ratio if coverage_ratio is not None else preview_payload.get("coverage_ratio"),
            "coverage_days": coverage_days if coverage_days is not None else preview_payload.get("coverage_days"),
            "warnings_json": dumps(list(warnings or preview_payload.get("warnings") or [])),
            "request_json": dumps(dict(request_payload)),
            "preview_json": dumps(preview_payload),
            "metrics_json": dumps(dict(metrics or preview_payload.get("metrics") or {})),
            "parameter_snapshot_json": dumps(parameter_snapshot_payload),
            "environment_summary_json": dumps(environment_summary_payload),
            "relative_metrics_json": dumps(dict(relative_metrics or {})),
            "consistency_score_json": dumps(dict(consistency_score or {})),
            "risk_metrics_json": dumps(dict(risk_metrics or {})),
            "drawdown_events_json": dumps(list(drawdown_events or [])),
            "rolling_metrics_json": dumps(list(rolling_metrics or [])),
            "monthly_returns_json": dumps(list(monthly_returns or [])),
            "chart_series_json": dumps(list(chart_series or [])),
            "trades_json": dumps(trade_rows),
            "artifact_paths_json": dumps([]),
            "trade_audit_items_json": dumps(trade_audit_item_rows),
            "trade_audit_json": dumps(trade_audit_rows),
            "trades_count": len(trade_rows),
            "error_message": error_message,
            "created_at": created_at,
            "updated_at": updated_at,
            "completed_at": completed_at,
        }

    def _set_latest_run_reference(
        self,
        *,
        strategy_id: str,
        run_id: str,
        updated_at: str,
        mark_successful: bool,
    ) -> None:
        strategy_row = self.storage.fetch_one("SELECT * FROM strategies WHERE id = ?", (strategy_id,))
        if strategy_row is None:
            return
        if not strategy_row.get("latest_run_id") or str(strategy_row.get("latest_run_id") or "") == run_id:
            strategy_row["latest_run_id"] = run_id
        if mark_successful:
            strategy_row["latest_successful_run_id"] = run_id
        strategy_row["updated_at"] = updated_at
        self.storage.insert_json_row("strategies", strategy_row)

    def _run_backtest_submission(
        self,
        *,
        run_id: str,
        strategy_id: str,
        strategy: Mapping[str, Any],
        request_payload: Mapping[str, Any],
        created_at: str,
    ) -> None:
        running_at = iso_now()
        running_preview = self._build_pending_backtest_preview(strategy, request_payload)
        self.storage.insert_json_row(
            "backtest_runs",
            self._build_backtest_run_row(
                run_id=run_id,
                strategy_id=strategy_id,
                status="RUNNING",
                request_payload=request_payload,
                created_at=created_at,
                updated_at=running_at,
                preview=running_preview,
                parameter_snapshot=running_preview.get("parameter_snapshot") or {},
                environment_summary=running_preview.get("environment_summary") or {},
            ),
        )
        try:
            effective_strategy = self._strategy_for_run(strategy, request_payload)
            preview, chart_series, trades = self._simulate_run(effective_strategy, request_payload)
            completed_at = iso_now()
            metrics = preview["metrics"]
            trade_audit = self._build_trade_audits(
                run_id=run_id,
                strategy=effective_strategy,
                request_payload=request_payload,
                trades=trades,
                oos_start_date=preview.get("oos_start_date"),
            )
            trade_audit_items = self._build_trade_audit_items(trade_audit)
            self.storage.insert_json_row(
                "backtest_runs",
                self._build_backtest_run_row(
                    run_id=run_id,
                    strategy_id=strategy_id,
                    status="COMPLETED_WITH_WARNINGS" if preview["warnings"] else "COMPLETED",
                    request_payload=request_payload,
                    created_at=created_at,
                    updated_at=completed_at,
                    preview=preview,
                    metrics=metrics,
                    parameter_snapshot=preview.get("parameter_snapshot") or {},
                    environment_summary=preview.get("environment_summary") or {},
                    relative_metrics=build_relative_metrics(chart_series),
                    consistency_score=build_consistency_score(chart_series),
                    risk_metrics=build_risk_metrics(metrics, chart_series),
                    drawdown_events=build_drawdown_events(chart_series, preview.get("oos_start_date")),
                    rolling_metrics=build_rolling_metrics(chart_series, 252),
                    monthly_returns=build_monthly_returns(chart_series, preview.get("oos_start_date")),
                    chart_series=chart_series,
                    trades=trades,
                    trade_audit_items=trade_audit_items,
                    trade_audit=trade_audit,
                    warnings=preview.get("warnings") or [],
                    completed_at=completed_at,
                    coverage_ratio=preview.get("coverage_ratio"),
                    coverage_days=preview.get("coverage_days"),
                ),
            )
            self._set_latest_run_reference(
                strategy_id=strategy_id,
                run_id=run_id,
                updated_at=completed_at,
                mark_successful=True,
            )
        except Exception as exc:
            failed_at = iso_now()
            failed_preview = self._build_pending_backtest_preview(strategy, request_payload)
            self.storage.insert_json_row(
                "backtest_runs",
                self._build_backtest_run_row(
                    run_id=run_id,
                    strategy_id=strategy_id,
                    status="FAILED",
                    request_payload=request_payload,
                    created_at=created_at,
                    updated_at=failed_at,
                    preview=failed_preview,
                    parameter_snapshot=failed_preview.get("parameter_snapshot") or {},
                    environment_summary=failed_preview.get("environment_summary") or {},
                    error_message=str(exc),
                    completed_at=failed_at,
                ),
            )
            self._set_latest_run_reference(
                strategy_id=strategy_id,
                run_id=run_id,
                updated_at=failed_at,
                mark_successful=False,
            )
        finally:
            with self._backtest_run_lock:
                self._backtest_run_threads.pop(run_id, None)

    def _start_backtest_run_runner(
        self,
        *,
        run_id: str,
        strategy_id: str,
        strategy: Mapping[str, Any],
        request_payload: Mapping[str, Any],
        created_at: str,
    ) -> bool:
        with self._backtest_run_lock:
            existing_thread = self._backtest_run_threads.get(run_id)
            if existing_thread and existing_thread.is_alive():
                return False
            thread = threading.Thread(
                target=self._run_backtest_submission,
                kwargs={
                    "run_id": run_id,
                    "strategy_id": strategy_id,
                    "strategy": dict(strategy),
                    "request_payload": dict(request_payload),
                    "created_at": created_at,
                },
                name=f"backtest-run-{run_id}",
                daemon=True,
            )
            self._backtest_run_threads[run_id] = thread
            thread.start()
        return True

    def resume_incomplete_backtest_runs(self) -> list[str]:
        rows = self.storage.fetch_all(
            """
            SELECT *
            FROM backtest_runs
            WHERE deleted_at IS NULL AND status IN (?, ?)
            ORDER BY created_at ASC, id ASC
            """,
            ("QUEUED", "RUNNING"),
        )
        resumed_run_ids: list[str] = []
        for row in rows:
            run_id = str(row.get("id") or "").strip()
            strategy_id = str(row.get("strategy_id") or "").strip()
            if not run_id or not strategy_id:
                continue
            request_payload = loads(row.get("request_json"), {})
            if not request_payload:
                failed_at = iso_now()
                self.storage.execute(
                    "UPDATE backtest_runs SET status = ?, error_message = ?, updated_at = ?, completed_at = ? WHERE id = ?",
                    ("FAILED", "Missing request payload for resumed backtest run.", failed_at, failed_at, run_id),
                )
                continue
            try:
                strategy = self.get_strategy_detail(strategy_id)
            except KeyError:
                failed_at = iso_now()
                self.storage.execute(
                    "UPDATE backtest_runs SET status = ?, error_message = ?, updated_at = ?, completed_at = ? WHERE id = ?",
                    ("FAILED", f"Strategy not found: {strategy_id}", failed_at, failed_at, run_id),
                )
                continue
            if self._start_backtest_run_runner(
                run_id=run_id,
                strategy_id=strategy_id,
                strategy=strategy,
                request_payload=request_payload,
                created_at=str(row.get("created_at") or iso_now()),
            ):
                resumed_run_ids.append(run_id)
        return resumed_run_ids

    def submit_backtest_run(self, strategy_id: str, request: Any) -> dict[str, Any]:
        strategy = self.get_strategy_detail(strategy_id)
        payload = self._normalize_run_request(strategy, _as_mapping(request))
        if not payload.get("idempotency_key"):
            raise ValueError("idempotency_key is required")
        run_id = self._new_id("run")
        now = iso_now()
        pending_preview = self._build_pending_backtest_preview(strategy, payload)
        self.storage.insert_json_row(
            "backtest_runs",
            self._build_backtest_run_row(
                run_id=run_id,
                strategy_id=strategy_id,
                status="QUEUED",
                request_payload=payload,
                created_at=now,
                updated_at=now,
                preview=pending_preview,
                parameter_snapshot=pending_preview.get("parameter_snapshot") or {},
                environment_summary=pending_preview.get("environment_summary") or {},
            ),
        )
        strategy_row = self.storage.fetch_one("SELECT * FROM strategies WHERE id = ?", (strategy_id,))
        if strategy_row is not None:
            strategy_row["latest_run_id"] = run_id
            strategy_row["updated_at"] = now
            self.storage.insert_json_row("strategies", strategy_row)
        self._start_backtest_run_runner(
            run_id=run_id,
            strategy_id=strategy_id,
            strategy=strategy,
            request_payload=payload,
            created_at=now,
        )
        return self.get_backtest_run_detail(run_id)

    create_backtest_run = submit_backtest_run

    def _build_inflight_run_detail_analysis(self) -> dict[str, Any]:
        return {
            "subtitle": "回测正在执行，页面会自动刷新；你可以先查看已锁定的区间与配置。",
            "kpi_cards": [],
            "decision_rail": {
                "score": 0,
                "label": "回测状态",
                "items": [
                    {
                        "key": "execution_state",
                        "title": "执行状态",
                        "body": "回测已提交，后台正在生成业绩曲线、指标与交易明细。",
                        "tone": "neutral",
                    },
                    {
                        "key": "refresh_state",
                        "title": "刷新方式",
                        "body": "当前页面会自动刷新；结果一旦生成，图表和证据会自动回填。",
                        "tone": "neutral",
                    },
                    {
                        "key": "next_action",
                        "title": "下一步动作",
                        "body": "你可以先查看当前配置与提交区间，无需停留在提交页等待。",
                        "tone": "neutral",
                    },
                ],
            },
        }

    def get_backtest_run_detail(self, run_id: str, view: str = "full") -> dict[str, Any]:
        normalized_view = self._normalize_backtest_run_detail_view(view)
        run = super().get_backtest_run_detail(run_id, view=normalized_view)
        chart_series = list(run.get("chart_series") or [])
        if normalized_view in {"full", "initial"}:
            rolling_metrics = list(run.get("rolling_metrics") or [])
            if chart_series and self._rolling_metrics_need_rebuild(rolling_metrics):
                # Rebuild rolling metrics at read time so historical runs created with
                # the old 21-day/volatility payload immediately regain 252-day
                # rolling return and rolling Sharpe without requiring a rerun.
                run["rolling_metrics"] = build_rolling_metrics(chart_series, 252)
            else:
                run["rolling_metrics"] = rolling_metrics
        if normalized_view in {"full", "context"}:
            request_payload = dict(run.get("request") or {})
            request_payload["execution_policy"] = str(
                request_payload.get("execution_policy")
                or "T_CLOSE_TO_T1_OPEN"
            )
            run["request"] = request_payload
            if run.get("preview"):
                preview_payload = dict(run.get("preview") or {})
                preview_payload["execution_policy"] = str(
                    preview_payload.get("execution_policy")
                    or request_payload.get("execution_policy")
                    or "T_CLOSE_TO_T1_OPEN"
                )
                run["preview"] = preview_payload
            run["snapshot_summary"] = run.get("preview", {}).get("snapshot_summary", {})
            run["data_segment_type"] = (
                run.get("preview", {}).get("data_segment_type")
                or run.get("request", {}).get("data_segment_type")
                or "FULL"
            )
            run["dataset_snapshot_id"] = (
                run.get("preview", {}).get("dataset_snapshot_id")
                or run.get("request", {}).get("dataset_snapshot_id")
            )
            run["universe_snapshot_id"] = (
                run.get("preview", {}).get("universe_snapshot_id")
                or run.get("request", {}).get("universe_snapshot_id")
            )
            run["parameter_version_id"] = (
                run.get("preview", {}).get("parameter_version_id")
                or run.get("request", {}).get("parameter_version_id")
            )
            trade_audit_items = list(run.get("trade_audit_items") or [])
            if not trade_audit_items:
                trade_audit_items = self._load_or_backfill_trade_audit_items(run_id)
            run["trade_audit_items"] = trade_audit_items
        if normalized_view == "full":
            run["trades"] = _enrich_trade_records_with_execution_values(run, run.get("trades") or [])
        if normalized_view in {"full", "initial"}:
            if str(run.get("status") or "").upper() in {"QUEUED", "RUNNING"}:
                run["analysis"] = self._build_inflight_run_detail_analysis()
            else:
                run["analysis"] = build_run_detail_analysis(run)
        if normalized_view == "initial":
            keep_indexes: list[int] = []
            if chart_series:
                min_drawdown_index = min(
                    range(len(chart_series)),
                    key=lambda index: float(chart_series[index].get("drawdown") or 0.0),
                )
                keep_indexes.append(min_drawdown_index)
                first_oos_index = next(
                    (
                        index
                        for index, point in enumerate(chart_series)
                        if bool(point.get("is_oos"))
                    ),
                    None,
                )
                if isinstance(first_oos_index, int):
                    keep_indexes.append(first_oos_index)
            run["chart_series"] = self._downsample_detail_series(
                chart_series,
                max_points=480,
                keep_indexes=keep_indexes,
            )
            run["rolling_metrics"] = self._downsample_detail_series(
                run.get("rolling_metrics") or [],
                max_points=480,
            )
            run.pop("trade_audit_items", None)
        return run

    def save_backtest_run(self, run_id: str) -> dict[str, Any]:
        run = super().get_backtest_run_detail(run_id)
        if bool(run.get("is_permanent")):
            return self.get_backtest_run_detail(run_id)

        request_payload = dict(run.get("request") or {})
        request_payload["is_permanent"] = True
        now = iso_now()
        self.storage.execute(
            "UPDATE backtest_runs SET is_permanent = 1, request_json = ?, updated_at = ? WHERE id = ?",
            (dumps(request_payload), now, run_id),
        )
        return self.get_backtest_run_detail(run_id)

    def get_backtest_run_trades(self, run_id: str, page: int = 1, page_size: int = 50, segment: str = "all") -> dict[str, Any]:
        run = super().get_backtest_run(run_id, view="full", include_trade_audit=False)
        trades = _enrich_trade_records_with_execution_values(run, run.get("trades") or [])
        normalized_segment = str(segment or "all").upper()
        if normalized_segment in {"IS", "OOS"}:
            trades = [item for item in trades if str(item.get("segment") or "").upper() == normalized_segment]
        page_size = max(int(page_size), 1)
        page = max(int(page), 1)
        total = len(trades)
        start = (page - 1) * page_size
        end = start + page_size
        total_pages = max(1, math.ceil(total / page_size)) if total else 1
        return {
            "items": trades[start:end],
            "page": page,
            "page_size": page_size,
            "total": total,
            "total_pages": total_pages,
        }

    def get_backtest_trade_audit(self, run_id: str, trade_id: str) -> dict[str, Any]:
        run = super().get_backtest_run(run_id, view="full", include_trade_audit=True)
        for audit in run.get("trade_audit", []):
            if str(audit.get("trade_id")) == trade_id:
                return audit
        raise KeyError(f"Trade audit not found: {trade_id}")

    def clone_backtest_run(self, run_id: str, request: Any) -> dict[str, Any]:
        run = self.get_backtest_run_detail(run_id)
        payload = dict(run.get("request") or {})
        payload.update(_as_mapping(request))
        payload["source_run_id"] = run_id
        if not payload.get("idempotency_key"):
            payload["idempotency_key"] = self._new_id("clone")
        payload.setdefault("is_permanent", False)
        return self.submit_backtest_run(str(run["strategy_id"]), payload)


RealBacktestService = RealBacktestPlatformService
BacktestRealService = RealBacktestPlatformService

from __future__ import annotations

import math
import os
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from .backtest_engine import BacktestConfig, _normalize_bars, _signal_score, run_backtest
from .backtest_metrics import (
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
SNAPSHOT_REPAIR_SYMBOL_BATCH_SIZE = 24
SNAPSHOT_REFRESH_RUNTIME_STATE_KEY = "snapshot_refresh_runtime"


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

    def _primary_market_data_provider(self) -> Any:
        return self.market_data_provider or YahooMarketDataProvider()

    def _fallback_market_data_provider(self) -> Any:
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
            return "正在修复快照，页面会自动更新。当前先显示已有数据。"
        return "正在刷新快照，页面会自动更新。当前先显示已有数据。"

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

    def _direct_symbol_universe_symbol(self, strategy: Mapping[str, Any]) -> str | None:
        universe_name = self._normalized_universe_name(strategy)
        if universe_name in {"SP500", "S&P500", "SP-500", "NASDAQ100", "NASDAQ-100", "NDX100", "NDX-100"}:
            return None
        if universe_name and universe_name.replace(".", "").isalnum():
            return universe_name
        if str(strategy.get("strategy_type") or "").upper() == "GRID":
            benchmark_symbol = str(
                strategy.get("benchmark_symbol")
                or (strategy.get("parameters") or {}).get("benchmark_symbol")
                or "QQQ"
            ).strip().upper()
            if benchmark_symbol.replace(".", "").isalnum():
                return benchmark_symbol
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
                "name": "公司行为数据",
                "status": "INCOMPLETE",
                "as_of": None,
                "freshness_label": "尚未刷新",
                "start_date": SNAPSHOT_START_DATE.isoformat(),
                "end_date": None,
                "row_count": 0,
                "source": "",
                "fallback_source": None,
                "blocker": {"code": "SNAPSHOT_REFRESH_REQUIRED", "message": "公司行为数据尚未刷新。"},
            },
            {
                "id": DATASET_PRICE_SNAPSHOT_ID,
                "name": "股票价格数据",
                "status": "INCOMPLETE",
                "as_of": None,
                "freshness_label": "尚未刷新",
                "start_date": SNAPSHOT_START_DATE.isoformat(),
                "end_date": None,
                "row_count": 0,
                "source": "",
                "fallback_source": None,
                "blocker": {"code": "SNAPSHOT_REFRESH_REQUIRED", "message": "股票价格数据尚未刷新。"},
            },
        ]

    def _universe_snapshot_defaults(self) -> list[dict[str, Any]]:
        return [
            {
                "id": SP500_UNIVERSE_SNAPSHOT_ID,
                "name": "标普500",
                "status": "INCOMPLETE",
                "as_of": None,
                "freshness_label": "尚未刷新",
                "window_start": SNAPSHOT_START_DATE.isoformat(),
                "window_end": None,
                "anchor_schedule": ANCHOR_SCHEDULE,
                "member_count": 0,
                "source": "",
                "fallback_source": None,
                "blocker": {"code": "SNAPSHOT_REFRESH_REQUIRED", "message": "标普500 股票池尚未刷新。"},
            },
            {
                "id": NASDAQ100_UNIVERSE_SNAPSHOT_ID,
                "name": "纳指100",
                "status": "INCOMPLETE",
                "as_of": None,
                "freshness_label": "尚未刷新",
                "window_start": SNAPSHOT_START_DATE.isoformat(),
                "window_end": None,
                "anchor_schedule": ANCHOR_SCHEDULE,
                "member_count": 0,
                "source": "",
                "fallback_source": None,
                "blocker": {"code": "SNAPSHOT_REFRESH_REQUIRED", "message": "纳指100 股票池尚未刷新。"},
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
        seen: set[str] = set()
        ordered: list[str] = []
        for item in raw_symbols:
            symbol = str(item or "").strip().upper()
            if not symbol or symbol in seen:
                continue
            seen.add(symbol)
            ordered.append(symbol)
        return ordered

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
                normalized = str(symbol or "").strip().upper()
                if not normalized or normalized in seen:
                    continue
                seen.add(normalized)
                ordered.append(normalized)
        return ordered

    def _repair_symbol_batch(self, symbols: Sequence[str], cursor: int, batch_size: int) -> tuple[list[str], int]:
        ordered = [str(item or "").strip().upper() for item in symbols if str(item or "").strip()]
        if not ordered:
            return [], 0
        normalized_cursor = cursor % len(ordered)
        selection = ordered[normalized_cursor : normalized_cursor + batch_size]
        if len(selection) < batch_size:
            selection.extend(ordered[: max(0, batch_size - len(selection))])
        deduped = list(dict.fromkeys(selection))
        next_cursor = (normalized_cursor + len(deduped)) % len(ordered)
        return deduped, next_cursor

    def _dataset_progress_metadata(
        self,
        *,
        symbol_coverage: Sequence[CoverageSummary | Mapping[str, Any]] | None,
        missing_symbols: Sequence[str] | None,
        existing_metadata: Mapping[str, Any] | None = None,
        covered_symbols: Sequence[str] | None = None,
        total_symbol_count_override: int | None = None,
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
        covered_symbol_count = len(covered_symbol_set)
        total_symbol_count = len(covered_symbol_set | missing_symbol_set)

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
                total_symbol_count = max(explicit_total, covered_symbol_count + len(missing_symbol_set))
                metadata["target_symbol_count"] = explicit_total
        if covered_symbol_count == 0 and fallback_count > 0:
            covered_symbol_count = fallback_count
        if total_symbol_count == 0 and covered_symbol_count > 0:
            total_symbol_count = covered_symbol_count + len(missing_symbol_set)
        if total_symbol_count == 0 and fallback_count > 0:
            total_symbol_count = fallback_count
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
        missing_symbols: list[str] = []
        corporate_missing_symbols: list[str] = []
        warnings: list[str] = []
        errors: list[str] = []
        action_partial = False
        ordered_symbols = sorted({str(symbol or "").strip().upper() for symbol in symbols if str(symbol or "").strip()})
        synthetic_dates = self._business_days_between(window_start, window_end) if primary_provider is None else []
        max_workers = min(worker_cap, len(ordered_symbols)) if ordered_symbols else 0
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
            if snapshot_id == DATASET_PRICE_SNAPSHOT_ID and price_bars:
                preferred_freshness_label = (
                    existing_row.get("freshness_label")
                    if existing_row
                    and existing_row.get("freshness_label")
                    and str(existing_row.get("freshness_label")) not in {"freshness_pending", "pending", "尚未刷新"}
                    else "已从现有快照恢复"
                )
                self.market_data_repository.replace_dataset_snapshot(
                    {
                        "id": snapshot_id,
                        "name": "股票价格数据",
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
                            symbol_coverage=coverage_rows or self._coverage_rows_from_price_bars(price_bars),
                            missing_symbols=(dict(existing_row.get("metadata") or {}).get("missing_symbols") if existing_row else []),
                            existing_metadata={
                                **(dict(existing_row.get("metadata") or {}) if existing_row else {}),
                                "restored_from": "dataset_price_bars",
                            },
                        ),
                    },
                    price_bars=price_bars,
                    symbol_coverage=coverage_rows or self._coverage_rows_from_price_bars(price_bars),
                )
                restored_ids.append(snapshot_id)
            elif snapshot_id == DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID and corporate_actions:
                preferred_freshness_label = (
                    existing_row.get("freshness_label")
                    if existing_row
                    and existing_row.get("freshness_label")
                    and str(existing_row.get("freshness_label")) not in {"freshness_pending", "pending", "尚未刷新"}
                    else "已从现有快照恢复"
                )
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
                        "name": "公司行为数据",
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
                and str(existing_row.get("freshness_label")) not in {"freshness_pending", "pending", "尚未刷新"}
                else "已从现有快照恢复"
            )
            source_names = sorted({str(item.get("source") or "") for item in memberships if item.get("source")})
            fallback_sources = sorted(
                {str(item.get("fallback_source") or "") for item in memberships if item.get("fallback_source")}
            )
            self.market_data_repository.replace_universe_snapshot(
                {
                    "id": snapshot_id,
                    "universe_key": (
                        existing_row.get("universe_key")
                        if existing_row and existing_row.get("universe_key")
                        else snapshot_id
                    ),
                    "name": defaults["name"],
                    "status": str(existing_row.get("status") or "INCOMPLETE") if existing_row else "INCOMPLETE",
                    "as_of": existing_row.get("as_of") if existing_row and existing_row.get("as_of") else as_of,
                    "freshness_label": preferred_freshness_label,
                    "window_start": min(str(item.get("effective_date")) for item in memberships if item.get("effective_date")),
                    "window_end": max(str(item.get("effective_date")) for item in memberships if item.get("effective_date")),
                    "anchor_schedule": (
                        existing_row.get("anchor_schedule")
                        if existing_row and existing_row.get("anchor_schedule")
                        else ANCHOR_SCHEDULE
                    ),
                    "member_count": len(latest_members),
                    "source": (
                        str(existing_row.get("source") or "")
                        if existing_row and existing_row.get("source")
                        else (source_names[0] if len(source_names) == 1 else "existing_snapshot_rows")
                    ),
                    "fallback_source": (
                        existing_row.get("fallback_source")
                        if existing_row and existing_row.get("fallback_source")
                        else (fallback_sources[0] if len(fallback_sources) == 1 else None)
                    ),
                    "blocker": dict(existing_row.get("blocker") or {}) if existing_row else {},
                    "metadata": {
                        **(dict(existing_row.get("metadata") or {}) if existing_row else {}),
                        "restored_from": "universe_membership_snapshots",
                        "latest_anchor_date": latest_effective_date,
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
                    default_message=str(blocker.get("message") or f"{item['name']} 当前仍未准备好。"),
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
                    default_message=str(summary.get("message") or "当前快照仍未准备好，暂时不能继续正式回测。"),
                ),
                BLOCKED_SNAPSHOT_ACTIONS,
            )
        return (None, None, "快照已准备好，可以继续正式回测。", READY_SNAPSHOT_ACTIONS)

    def _snapshot_status_message(
        self,
        code: str | None,
        *,
        default_message: str,
        item_name: str | None = None,
    ) -> str:
        normalized = str(code or "").upper()
        messages = {
            "CORPORATE_ACTIONS_INCOMPLETE": "公司行为数据部分可用，正式回测仍会受限。",
            "CORPORATE_ACTIONS_PENDING": "公司行为数据还没生成，刷新后会继续补齐。",
            "CORPORATE_ACTIONS_FAILED": "公司行为数据刷新失败，请稍后重试。",
            "PRICE_SNAPSHOT_INCOMPLETE": "价格数据已部分可用，但仍有历史缺口待修复。",
            "PRICE_SNAPSHOT_FAILED": "价格数据刷新失败，请稍后重试。",
            "UNIVERSE_HISTORY_INCOMPLETE": "股票池历史成分部分可用，完整点时成分仍在补齐。",
            "UNIVERSE_HISTORY_FAILED": "股票池历史成分刷新失败，当前没有可用的正式锚点。",
            "LIVE_REFRESH_PENDING": "后台更新中，页面会先显示本地已恢复的数据。",
            "SNAPSHOT_REFRESH_REQUIRED": "还没有生成完整快照，请先刷新快照。",
            "SNAPSHOT_REFRESH_INTERRUPTED": "后台刷新中断了，请重新触发一次刷新。",
            "SNAPSHOT_REFRESH_FAILED": "快照刷新失败，请查看错误后重试。",
        }
        if normalized in messages:
            return messages[normalized]
        if default_message:
            return default_message
        if item_name:
            return f"{item_name} 当前仍未准备好。"
        return "当前快照仍未准备好，暂时不能继续正式回测。"

    def _seed_dataset_snapshots_from_legacy_cache(self, *, as_of: str) -> dict[str, Any] | None:
        self._restore_dataset_snapshots_from_snapshot_rows(as_of=as_of)
        existing_rows = {str(item["id"]): item for item in self.market_data_repository.list_dataset_snapshots()}
        needs_price_snapshot = self._snapshot_row_is_placeholder(
            existing_rows.get(DATASET_PRICE_SNAPSHOT_ID),
            count_key="row_count",
        )
        needs_actions_snapshot = self._snapshot_row_is_placeholder(
            existing_rows.get(DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID),
            count_key="row_count",
        )
        if not needs_price_snapshot and not needs_actions_snapshot:
            return None

        legacy_bars_by_symbol = self.market_data_repository.load_bars()
        if not legacy_bars_by_symbol:
            recovery_report = probe_workspace_market_data_assets(
                self.market_data_repository.path.parent,
                exclude_paths=(self.market_data_repository.path,),
            )
            if recovery_report.usable_assets:
                import_legacy_market_data_backup(self.market_data_repository, recovery_report.usable_assets[0])
                legacy_bars_by_symbol = self.market_data_repository.load_bars()
            if not legacy_bars_by_symbol:
                return None

        legacy_actions = self.market_data_repository.load_actions()
        legacy_coverages = {
            str(item.get("symbol") or "").upper(): dict(item) for item in self.market_data_repository.list_coverage()
        }
        snapshot_start_dates: list[str] = []
        snapshot_end_dates: list[str] = []
        coverage_rows: list[CoverageSummary] = []
        price_bars: list[dict[str, Any]] = []

        for symbol, bars in legacy_bars_by_symbol.items():
            if not bars:
                continue
            coverage = legacy_coverages.get(symbol, {})
            start_date = str(coverage.get("start_date") or bars[0].get("date") or SNAPSHOT_START_DATE.isoformat())
            end_date = str(coverage.get("end_date") or bars[-1].get("date") or start_date)
            snapshot_start_dates.append(start_date)
            snapshot_end_dates.append(end_date)
            coverage_rows.append(
                CoverageSummary(
                    symbol=symbol,
                    start_date=start_date,
                    end_date=end_date,
                    trade_days=int(coverage.get("trade_days") or len(bars)),
                )
            )
            for bar in bars:
                price_bars.append(
                    {
                        "symbol": symbol,
                        "date": str(bar.get("date")),
                        "open": bar.get("open"),
                        "high": bar.get("high"),
                        "low": bar.get("low"),
                        "close": bar.get("close"),
                        "adj_close": bar.get("adj_close", bar.get("close")),
                        "volume": bar.get("volume"),
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
                "date": str(action.get("date")),
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
                    "name": "股票价格数据",
                    "status": "STALE",
                    "as_of": as_of,
                    "freshness_label": "已从本地缓存恢复",
                    "start_date": snapshot_start,
                    "end_date": snapshot_end,
                    "row_count": len(price_bars),
                    "source": "legacy_local_cache",
                    "fallback_source": "live_refresh_pending",
                    "blocker": {
                        "code": "LIVE_REFRESH_PENDING",
                        "message": "已先恢复本地价格缓存，完整在线刷新仍在补齐。",
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
                    "message": "已先恢复本地公司行为缓存，完整在线刷新仍在补齐。",
                }
                if corporate_actions
                else {
                    "code": "CORPORATE_ACTIONS_PENDING",
                    "message": "本地暂时没有公司行为快照，刷新后会继续补齐。",
                }
            )
            self.market_data_repository.replace_dataset_snapshot(
                {
                    "id": DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID,
                    "name": "公司行为数据",
                    "status": actions_status,
                    "as_of": as_of,
                    "freshness_label": "已从本地缓存恢复" if corporate_actions else "等待在线补齐",
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
                symbol_coverage=coverage_rows,
            )

        return {
            "price_row_count": len(price_bars),
            "corporate_action_count": len(corporate_actions),
            "coverage_symbol_count": len(coverage_rows),
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
        pid: int,
        mode: str,
        targets: Sequence[str],
    ) -> None:
        self.storage.insert_json_row(
            "app_runtime_state",
            {
                "state_key": SNAPSHOT_REFRESH_RUNTIME_STATE_KEY,
                "state_json": dumps(
                    {
                        "job_id": job_id,
                        "pid": int(pid),
                        "mode": mode,
                        "targets": list(targets),
                    }
                ),
                "updated_at": iso_now(),
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
                timeout=15,
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
        if self._snapshot_refresh_process_is_active(str(latest_job.get("id") or "")):
            return dict(latest_job)

        recovered_at = iso_now()
        summary = dict(latest_job.get("summary") or {})
        warnings = list(latest_job.get("warnings") or [])
        if "后台刷新在完成前中断了。" not in warnings:
            warnings.append("后台刷新在完成前中断了。")
        recovered_job = {
            **dict(latest_job),
            "status": "FAILED",
            "summary": {
                **summary,
                "status": "FAILED",
                "blocking": True,
                "blocking_code": "SNAPSHOT_REFRESH_INTERRUPTED",
                "blocking_target": "data_snapshots",
                "message": "后台刷新在完成前中断了，请重新触发一次刷新。",
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
        self._restore_universe_snapshots_from_memberships(as_of=restored_at)
        latest_job = self._recover_interrupted_snapshot_job(latest_job)
        raw_dataset_rows = {str(item["id"]): dict(item) for item in self.market_data_repository.list_dataset_snapshots()}
        price_row = self._backfill_dataset_snapshot_progress(raw_dataset_rows.get(DATASET_PRICE_SNAPSHOT_ID))
        price_total_symbol_count = dict(price_row.get("metadata") or {}).get("total_symbol_count")
        corporate_row = self._backfill_dataset_snapshot_progress(
            raw_dataset_rows.get(DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID),
            total_symbol_count_hint=price_total_symbol_count,
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
            message = self._refresh_snapshot_message(
                str((latest_job.get("request") or {}).get("mode") or "incremental")
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
    ) -> dict[str, Any]:
        row = dict(item or {})
        metadata = dict(row.get("metadata") or {})
        covered_symbol_count = metadata.get("covered_symbol_count")
        total_symbol_count = metadata.get("total_symbol_count")
        row_count = int(row.get("row_count") or 0)
        if row.get("id") != DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID and (
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
            return {"symbol": symbol, "market_data": market_data, "identity": identity, "error": None}
        except Exception as primary_error:
            if fallback_availability and bool(fallback_availability.available):
                try:
                    market_data = fallback_provider.fetch_history(symbol, window_start, window_end)
                    return {"symbol": symbol, "market_data": market_data, "identity": identity, "error": None}
                except Exception as fallback_error:
                    return {
                        "symbol": symbol,
                        "market_data": None,
                        "identity": identity,
                        "error": f"{symbol}: primary={primary_error}; fallback={fallback_error}",
                    }
            reason = fallback_availability.reason if fallback_availability else "Fallback provider unavailable."
            return {
                "symbol": symbol,
                "market_data": None,
                "identity": identity,
                "error": f"{symbol}: primary={primary_error}; fallback={reason}",
            }

    def _all_refresh_symbols(self) -> list[str]:
        symbols = {"SPY", "QQQ"}
        for bucket in DEFAULT_UNIVERSE_SYMBOLS.values():
            symbols.update(bucket)
        for strategy in self.list_strategies():
            universe_name = str(strategy.get("universe_name") or "").strip()
            if universe_name and universe_name.isascii() and universe_name.replace(".", "").isalnum():
                symbols.add(universe_name.upper())
        return sorted(symbols)

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
        if universe_name and universe_name.replace(".", "").isalnum():
            return [universe_name]
        return ["QQQ"] if str(strategy.get("strategy_type")) == "GRID" else list(DEFAULT_UNIVERSE_SYMBOLS["SP500"])

    def _snapshot_summary(self, strategy: Mapping[str, Any], request_payload: Mapping[str, Any]) -> dict[str, Any]:
        benchmark_symbol = str(strategy.get("benchmark_symbol") or "SPY").upper()
        symbols = [str(symbol).upper() for symbol in self._resolve_universe_symbols(strategy, request_payload)]
        dataset_snapshot_id = str(request_payload.get("dataset_snapshot_id") or DATASET_PRICE_SNAPSHOT_ID)
        direct_symbol_universe = self._uses_direct_symbol_universe(strategy)
        universe_snapshot_id = self._resolved_universe_snapshot_id(strategy, request_payload)
        supporting_dataset_id = DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID
        try:
            price_dataset = self._select_dataset_snapshot(dataset_snapshot_id)
        except KeyError:
            return {
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
                "message": "快照记录还没生成，请先刷新快照。",
            }

        corporate_dataset: dict[str, Any] | None
        try:
            corporate_dataset = self._select_dataset_snapshot(supporting_dataset_id)
        except KeyError:
            corporate_dataset = None
            if not direct_symbol_universe:
                return {
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
                    "message": "快照记录还没生成，请先刷新快照。",
                }

        universe_snapshot: dict[str, Any] | None = None
        if universe_snapshot_id:
            try:
                universe_snapshot = self._select_universe_snapshot(universe_snapshot_id)
            except KeyError:
                return {
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
                    "message": "快照记录还没生成，请先刷新快照。",
                }

        requested_symbols = list(dict.fromkeys([benchmark_symbol, *symbols]))
        bars = self._load_snapshot_price_bars(
            dataset_snapshot_id,
            requested_symbols,
            start_date=request_payload.get("start_date"),
            end_date=request_payload.get("end_date"),
        )
        benchmark_trade_days = len(bars.get(benchmark_symbol, []))
        available_symbols = [symbol for symbol in symbols if bars.get(symbol)]
        row_count = sum(len(series) for series in bars.values())
        coverage_days = (
            benchmark_trade_days
            if direct_symbol_universe
            else sum(len(series) for symbol, series in bars.items() if symbol != benchmark_symbol)
        )
        blocking_items = []
        price_snapshot_ready_for_request = benchmark_trade_days > 0 and len(available_symbols) == len(symbols)
        required_snapshots = []
        if not price_snapshot_ready_for_request:
            required_snapshots.append(price_dataset)
        if not direct_symbol_universe and corporate_dataset is not None:
            required_snapshots.append(corporate_dataset)
        if universe_snapshot is not None:
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
        message = blocker.get("message") or ("快照还没准备好，暂时不能提交正式回测。" if blocking else "快照已准备好。")
        if (
            not blocking
            and price_snapshot_ready_for_request
            and str(price_dataset.get("status") or "INCOMPLETE").upper() != "READY"
        ):
            message = "当前策略所需的价格数据已可用于回测；其余符号仍在后台补齐。"
        elif (
            not blocking
            and direct_symbol_universe
            and corporate_status != "READY"
        ):
            message = "价格快照已准备好，单标的测试可继续；公司行为快照仍在补齐。"
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
        existing_price_rows = self.market_data_repository.load_dataset_snapshot_rows(DATASET_PRICE_SNAPSHOT_ID)
        existing_corporate_rows = self.market_data_repository.load_dataset_snapshot_rows(DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID)
        window_start = SNAPSHOT_START_DATE
        window_end = date.today()
        primary_provider = self._primary_market_data_provider() if refresh_market_data else None
        fallback_provider = self._fallback_market_data_provider() if refresh_market_data else UnconfiguredFallbackProvider()
        fallback_availability = fallback_provider.availability() if refresh_market_data and hasattr(fallback_provider, "availability") else None
        warnings: list[str] = []
        errors: list[str] = []
        if seeded_legacy_snapshot:
            warnings.append(
                "Seeded dataset snapshots from legacy local cache "
                f"({seeded_legacy_snapshot['price_row_count']} price rows across "
                f"{seeded_legacy_snapshot['coverage_symbol_count']} symbols)."
            )

        universe_snapshots: list[Any] = []
        for provider in (self._universe_history_providers() if refresh_universes else []):
            universe_snapshots.extend(provider.load_snapshots(window_start, window_end))

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
            historical_anchor_count = sum(
                1
                for item in ordered_anchor_snapshots
                if str((item.metadata or {}).get("source_quality") or "").lower() == "historical_revision_snapshot"
                and not item.fallback_source
            )
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
                        "历史锚点已刷新"
                        if universe_status == "READY"
                        else f"历史锚点补齐中 ({historical_anchor_count}/{total_anchor_count})"
                    ),
                    "window_start": window_start.isoformat(),
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
                            "股票池历史成分仍在补齐，当前还不能视为完整的点时成分快照。"
                            if latest_members
                            else "股票池历史成分刷新失败，当前没有可用的锚点成员数据。"
                        ),
                    },
                    "metadata": {
                        "source_page_title": latest_snapshot.source_page_title,
                        "source_revision_id": latest_snapshot.source_revision_id,
                        "latest_anchor_date": latest_anchor_date,
                        "anchor_count": total_anchor_count,
                        "historical_anchor_count": historical_anchor_count,
                        "fallback_anchor_count": total_anchor_count - historical_anchor_count,
                        "source_names": source_names,
                        "fallback_sources": fallback_sources,
                        **dict(latest_snapshot.metadata),
                    },
                },
                memberships=memberships_by_snapshot.get(snapshot_id, []),
            )

        if not refresh_market_data:
            self._sync_strategy_snapshot_bindings(updated_at=started_at)
            preview_overview = self._build_snapshot_overview()
            completed_at = iso_now()
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

        batch_results: list[dict[str, Any]] = []
        if mode == "repair":
            if latest_batch_symbols:
                recent_window_start = self._latest_market_data_window_start(
                    existing_price_snapshot=existing_price_snapshot,
                    existing_corporate_snapshot=existing_corporate_snapshot,
                    window_end=window_end,
                )
                batch_results.append(
                    self._collect_market_data_refresh_batch(
                        symbols=sorted(latest_batch_symbols),
                        window_start=recent_window_start,
                        window_end=window_end,
                        primary_provider=primary_provider,
                        fallback_provider=fallback_provider,
                        fallback_availability=fallback_availability,
                        worker_cap=SNAPSHOT_MARKET_DATA_MAX_WORKERS,
                    )
                )
            if repair_batch_symbols:
                batch_results.append(
                    self._collect_market_data_refresh_batch(
                        symbols=sorted(repair_batch_symbols),
                        window_start=window_start,
                        window_end=window_end,
                        primary_provider=primary_provider,
                        fallback_provider=fallback_provider,
                        fallback_availability=fallback_availability,
                        worker_cap=SNAPSHOT_MARKET_DATA_REPAIR_MAX_WORKERS,
                    )
                )
        else:
            batch_results.append(
                self._collect_market_data_refresh_batch(
                    symbols=sorted(latest_batch_symbols),
                    window_start=window_start,
                    window_end=window_end,
                    primary_provider=primary_provider,
                    fallback_provider=fallback_provider,
                    fallback_availability=fallback_availability,
                    worker_cap=SNAPSHOT_MARKET_DATA_MAX_WORKERS,
                )
            )

        price_bars: list[dict[str, Any]] = []
        corporate_actions: list[dict[str, Any]] = []
        coverage_rows: list[CoverageSummary] = []
        corporate_coverage_rows: list[CoverageSummary] = []
        missing_symbol_set: set[str] = set()
        corporate_missing_symbol_set: set[str] = set()
        action_partial = False
        ordered_symbols = sorted(progress_target_symbols)
        for batch_result in batch_results:
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
            missing_symbol_set.update(str(item or "").strip().upper() for item in (batch_result.get("missing_symbols") or []) if str(item or "").strip())
            corporate_missing_symbol_set.update(
                str(item or "").strip().upper()
                for item in (batch_result.get("corporate_missing_symbols") or [])
                if str(item or "").strip()
            )
            action_partial = action_partial or bool(batch_result.get("action_partial"))

        missing_symbols = sorted(missing_symbol_set)
        corporate_missing_symbols = sorted(corporate_missing_symbol_set)
        existing_price_missing = self._snapshot_missing_symbols(existing_price_snapshot)
        existing_corporate_missing = self._snapshot_missing_symbols(existing_corporate_snapshot)
        attempted_symbol_set = set(progress_target_symbols)
        if mode == "repair":
            existing_missing_set = set(existing_price_missing) | set(existing_corporate_missing)
            attempted_missing_set = repair_batch_symbols or set(selection_metadata.get("selected_missing_symbols") or ordered_symbols)
            effective_missing_symbols = sorted((existing_missing_set - attempted_missing_set) | set(missing_symbols))
            effective_corporate_missing_symbols = sorted((existing_missing_set - attempted_missing_set) | set(corporate_missing_symbols))
        else:
            effective_missing_symbols = list(missing_symbols)
            effective_corporate_missing_symbols = list(corporate_missing_symbols)
        price_sources = sorted({str(item.get("source") or "") for item in price_bars if item.get("source")})
        price_fallback_sources = sorted(
            {str(item.get("fallback_source") or "") for item in price_bars if item.get("fallback_source")}
        )
        action_sources = sorted({str(item.get("source") or "") for item in corporate_actions if item.get("source")})
        action_fallback_sources = sorted(
            {str(item.get("fallback_source") or "") for item in corporate_actions if item.get("fallback_source")}
        )

        recovery_report = None
        cold_backup_result = None
        if effective_missing_symbols:
            recovery_report = probe_lab2_snapshot_assets()
            warnings.extend(recovery_report.notes)
            if recovery_report.usable_assets:
                cold_backup_result = import_snapshot_cold_backup(self.market_data_repository, recovery_report.usable_assets[0])
                warnings.append(f"Cold backup import attempted from {recovery_report.usable_assets[0]}.")
            else:
                warnings.append("No usable cold backup snapshot database found under Lab2.")

        def summarize_source(values: list[str], default: str) -> str:
            cleaned = [value for value in values if value]
            if not cleaned:
                return default
            return cleaned[0] if len(cleaned) == 1 else "mixed_sources"

        def summarize_fallback(values: list[str], fallback_default: str | None = None) -> str | None:
            cleaned = [value for value in values if value]
            if cleaned:
                return cleaned[0] if len(cleaned) == 1 else "mixed_fallbacks"
            return fallback_default

        default_source_name = str(
            getattr(primary_provider, "provider_name", "synthetic_seed") if primary_provider is not None else "synthetic_seed"
        )
        default_fallback_name = (
            fallback_availability.provider_name if (effective_missing_symbols or action_partial) and fallback_availability else None
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

        merged_price_bars = (
            self._merge_price_snapshot_rows(existing_price_rows.get("price_bars") or [], price_bars)
            if mode == "repair"
            else list(price_bars)
        )
        merged_coverage_rows = (
            self._merge_coverage_rows(existing_price_rows.get("symbol_coverage") or [], coverage_rows)
            if mode == "repair"
            else list(coverage_rows)
        )

        if merged_price_bars:
            self.market_data_repository.replace_dataset_snapshot(
                {
                    "id": DATASET_PRICE_SNAPSHOT_ID,
                    "name": "股票价格数据",
                    "status": price_status,
                    "as_of": started_at,
                    "freshness_label": "刚刚刷新",
                    "start_date": window_start.isoformat(),
                    "end_date": window_end.isoformat(),
                    "row_count": len(merged_price_bars),
                    "source": price_source_name,
                    "fallback_source": price_fallback_name,
                    "blocker": {} if price_status == "READY" else {
                        "code": "PRICE_SNAPSHOT_INCOMPLETE" if price_bars else "PRICE_SNAPSHOT_FAILED",
                        "message": "价格数据已部分可用，但仍有历史符号缺口待修复。",
                    },
                    "metadata": self._dataset_progress_metadata(
                        symbol_coverage=merged_coverage_rows,
                        missing_symbols=effective_missing_symbols,
                        existing_metadata={
                            "missing_symbols": effective_missing_symbols,
                            "source_names": price_sources,
                            "fallback_sources": price_fallback_sources,
                            "cold_backup_result": cold_backup_result or {},
                            "recovery_report": recovery_report.as_dict() if recovery_report else {},
                            "target_symbol_count": len(progress_target_symbols),
                            **selection_metadata,
                        },
                        total_symbol_count_override=len(progress_target_symbols),
                    ),
                },
                price_bars=merged_price_bars,
                symbol_coverage=merged_coverage_rows,
            )
        existing_corporate_actions = list(existing_corporate_rows.get("corporate_actions") or [])
        existing_corporate_coverage = list(existing_corporate_rows.get("symbol_coverage") or [])
        merged_corporate_actions = (
            self._merge_action_snapshot_rows(existing_corporate_actions, corporate_actions)
            if mode == "repair"
            else list(corporate_actions)
        )
        merged_corporate_coverage = (
            self._merge_coverage_rows(existing_corporate_coverage, corporate_coverage_rows)
            if mode == "repair"
            else list(corporate_coverage_rows)
        )
        if merged_corporate_actions or not existing_corporate_actions:
            self.market_data_repository.replace_dataset_snapshot(
                {
                    "id": DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID,
                    "name": "公司行为数据",
                    "status": corporate_status,
                    "as_of": started_at,
                    "freshness_label": "刚刚刷新",
                    "start_date": window_start.isoformat(),
                    "end_date": window_end.isoformat(),
                    "row_count": len(merged_corporate_actions),
                    "source": action_source_name,
                    "fallback_source": action_fallback_name,
                    "blocker": {} if corporate_status == "READY" else {
                        "code": "CORPORATE_ACTIONS_INCOMPLETE" if merged_corporate_actions else "CORPORATE_ACTIONS_FAILED",
                        "message": "公司行为数据已部分可用，但仍有事件缺口待修复。",
                    },
                    "metadata": self._dataset_progress_metadata(
                        symbol_coverage=merged_corporate_coverage,
                        missing_symbols=effective_corporate_missing_symbols,
                        existing_metadata={
                            "missing_symbols": effective_corporate_missing_symbols,
                            "partial": action_partial,
                            "source_names": action_sources,
                            "fallback_sources": action_fallback_sources,
                            "cold_backup_result": cold_backup_result or {},
                            "recovery_report": recovery_report.as_dict() if recovery_report else {},
                            "progress_metric": "corporate_action_symbols",
                            "target_symbol_count": len(progress_target_symbols),
                            "selected_symbol_count": len(progress_target_symbols),
                            **selection_metadata,
                        },
                        covered_symbols=[str(item.get("symbol") or "") for item in merged_corporate_actions],
                        total_symbol_count_override=len(progress_target_symbols),
                    ),
                },
                corporate_actions=merged_corporate_actions,
                symbol_coverage=merged_corporate_coverage,
            )
        else:
            warnings.append("在线刷新没有返回新的公司行为事件，因此保留了上一次较完整的快照。")
            preserved_blocker = {
                "code": "CORPORATE_ACTIONS_INCOMPLETE",
                "message": "公司行为数据未被新的空结果覆盖，当前继续沿用上一版更完整的快照。",
            }
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
                    "status": "STALE",
                    "as_of": existing_corporate_snapshot.get("as_of") if existing_corporate_snapshot else started_at,
                    "freshness_label": "继续使用已有快照",
                    "start_date": existing_corporate_snapshot.get("start_date") if existing_corporate_snapshot else window_start.isoformat(),
                    "end_date": existing_corporate_snapshot.get("end_date") if existing_corporate_snapshot else window_end.isoformat(),
                    "row_count": len(preserved_actions),
                    "source": (
                        str(existing_corporate_snapshot.get("source") or "")
                        if existing_corporate_snapshot and existing_corporate_snapshot.get("source")
                        else "existing_snapshot_rows"
                    ),
                    "fallback_source": action_fallback_name or (
                        existing_corporate_snapshot.get("fallback_source") if existing_corporate_snapshot else None
                    ),
                    "blocker": preserved_blocker,
                    "metadata": self._dataset_progress_metadata(
                        symbol_coverage=existing_corporate_coverage or corporate_coverage_rows,
                        missing_symbols=effective_corporate_missing_symbols,
                        existing_metadata={
                            **(dict(existing_corporate_snapshot.get("metadata") or {}) if existing_corporate_snapshot else {}),
                            "missing_symbols": effective_corporate_missing_symbols,
                            "partial": action_partial,
                            "cold_backup_result": cold_backup_result or {},
                            "recovery_report": recovery_report.as_dict() if recovery_report else {},
                            "preserved_existing_snapshot": True,
                            "progress_metric": "corporate_action_symbols",
                            "target_symbol_count": len(progress_target_symbols),
                            "selected_symbol_count": len(progress_target_symbols),
                            **selection_metadata,
                        },
                        covered_symbols=[str(item.get("symbol") or "") for item in preserved_actions],
                        total_symbol_count_override=len(progress_target_symbols),
                    ),
                },
                corporate_actions=preserved_actions,
                symbol_coverage=existing_corporate_coverage or coverage_rows,
            )

        self._sync_strategy_snapshot_bindings(updated_at=started_at)
        preview_overview = self._build_snapshot_overview()
        completed_at = iso_now()
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
        normalized["is_permanent"] = bool(normalized.get("is_permanent", True))
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

    def _simulate_run(self, strategy: Mapping[str, Any], request_payload: Mapping[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
        benchmark_symbol = str(strategy.get("benchmark_symbol") or "SPY").upper()
        symbols = self._resolve_universe_symbols(strategy, request_payload)
        snapshot_summary = self._snapshot_summary(strategy, request_payload)
        if is_snapshot_blocking(snapshot_summary):
            raise SnapshotBlockingError(snapshot_summary)

        dataset_snapshot_id = str(request_payload.get("dataset_snapshot_id") or DATASET_PRICE_SNAPSHOT_ID)
        bars_by_symbol = self._load_snapshot_price_bars(
            dataset_snapshot_id,
            symbols,
            start_date=request_payload.get("start_date"),
            end_date=request_payload.get("end_date"),
        )
        benchmark_bars = self._load_snapshot_price_bars(
            dataset_snapshot_id,
            [benchmark_symbol],
            start_date=request_payload.get("start_date"),
            end_date=request_payload.get("end_date"),
        ).get(benchmark_symbol, [])
        result = run_backtest(
            bars_by_symbol,
            config=BacktestConfig(
                start_date=request_payload.get("start_date"),
                end_date=request_payload.get("end_date"),
                benchmark_symbol=benchmark_symbol,
            ),
            parameters=self._engine_parameters(strategy),
            benchmark_bars=benchmark_bars,
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
            "dataset_snapshot_id": request_payload.get("dataset_snapshot_id"),
            "universe_snapshot_id": request_payload.get("universe_snapshot_id"),
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
                "dataset_snapshot_id": request_payload.get("dataset_snapshot_id"),
                "universe_snapshot_id": request_payload.get("universe_snapshot_id"),
            },
            "blind_test_zone": {"label": "Blind Test Zone", "oos_start_date": result.oos_start_date},
        }
        return preview, chart_series, trades

    def preview_backtest_run(self, strategy_id: str, request: Any | None = None) -> dict[str, Any]:
        strategy = self.get_strategy_detail(strategy_id)
        payload = self._normalize_run_request(strategy, _as_mapping(request))
        effective_strategy = self._strategy_for_run(strategy, payload)
        preview, _, _ = self._simulate_run(effective_strategy, payload)
        return preview

    preview_backtest = preview_backtest_run

    def submit_backtest_run(self, strategy_id: str, request: Any) -> dict[str, Any]:
        strategy = self.get_strategy_detail(strategy_id)
        payload = self._normalize_run_request(strategy, _as_mapping(request))
        if not payload.get("idempotency_key"):
            raise ValueError("idempotency_key is required")
        effective_strategy = self._strategy_for_run(strategy, payload)
        preview, chart_series, trades = self._simulate_run(effective_strategy, payload)
        run_id = self._new_id("run")
        now = iso_now()
        metrics = preview["metrics"]
        trade_audit = self._build_trade_audits(
            run_id=run_id,
            strategy=effective_strategy,
            request_payload=payload,
            trades=trades,
            oos_start_date=preview.get("oos_start_date"),
        )
        row = {
            "id": run_id,
            "strategy_id": strategy_id,
            "status": "COMPLETED_WITH_WARNINGS" if preview["warnings"] else "COMPLETED",
            "source_run_id": payload.get("source_run_id"),
            "request_kind": "official",
            "is_permanent": 1 if bool(payload.get("is_permanent", True)) else 0,
            "start_date": payload.get("start_date"),
            "end_date": payload.get("end_date"),
            "effective_date": preview.get("effective_date"),
            "oos_start_date": preview.get("oos_start_date"),
            "coverage_ratio": preview.get("coverage_ratio"),
            "coverage_days": preview.get("coverage_days"),
            "warnings_json": dumps(preview["warnings"]),
            "request_json": dumps(payload),
            "preview_json": dumps(preview),
            "metrics_json": dumps(metrics),
            "parameter_snapshot_json": dumps(preview["parameter_snapshot"]),
            "environment_summary_json": dumps(preview["environment_summary"]),
            "relative_metrics_json": dumps(build_relative_metrics(chart_series)),
            "consistency_score_json": dumps(build_consistency_score(chart_series)),
            "risk_metrics_json": dumps(build_risk_metrics(metrics, chart_series)),
            "drawdown_events_json": dumps(build_drawdown_events(chart_series, preview.get("oos_start_date"))),
            "rolling_metrics_json": dumps(build_rolling_metrics(chart_series, 21)),
            "monthly_returns_json": dumps(build_monthly_returns(chart_series, preview.get("oos_start_date"))),
            "chart_series_json": dumps(chart_series),
            "trades_json": dumps(trades),
            "artifact_paths_json": dumps([]),
            "trade_audit_json": dumps(trade_audit),
            "trades_count": len(trades),
            "error_message": None,
            "created_at": now,
            "updated_at": now,
            "completed_at": now,
        }
        self.storage.insert_json_row("backtest_runs", row)

        strategy_row = self.storage.fetch_one("SELECT * FROM strategies WHERE id = ?", (strategy_id,))
        assert strategy_row is not None
        strategy_row["latest_run_id"] = run_id
        strategy_row["latest_successful_run_id"] = run_id
        strategy_row["updated_at"] = now
        self.storage.insert_json_row("strategies", strategy_row)
        return self.get_backtest_run_detail(run_id)

    create_backtest_run = submit_backtest_run

    def get_backtest_run_detail(self, run_id: str) -> dict[str, Any]:
        run = super().get_backtest_run_detail(run_id)
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
        run["trade_audit_items"] = [
            {
                "trade_id": item["trade_id"],
                "symbol": item["symbol"],
                "segment": item["segment"],
                "opened_at": item["opened_at"],
                "closed_at": item["closed_at"],
                "pnl_pct": item["pnl_pct"],
                "max_favorable_excursion_pct": item["max_favorable_excursion_pct"],
                "max_adverse_excursion_pct": item["max_adverse_excursion_pct"],
                "slippage_cost_pct": item["slippage_cost_pct"],
                "commentary": item["commentary"],
            }
            for item in run.get("trade_audit", [])
        ]
        run.pop("trade_audit", None)
        return run

    def get_backtest_run_trades(self, run_id: str, page: int = 1, page_size: int = 50, segment: str = "all") -> dict[str, Any]:
        return super().get_backtest_run_trades(run_id, page=page, page_size=page_size, segment=segment)

    def get_backtest_trade_audit(self, run_id: str, trade_id: str) -> dict[str, Any]:
        run = super().get_backtest_run_detail(run_id)
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

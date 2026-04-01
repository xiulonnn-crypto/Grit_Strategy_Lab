from __future__ import annotations

import math
import threading
from dataclasses import asdict
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Iterable, Mapping

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
from .snapshot_recovery import import_snapshot_cold_backup, probe_lab2_snapshot_assets
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
    "标普500成分股": ["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "AMD", "AVGO", "COST"],
    "纳指100成分股": ["QQQ", "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "AMD", "AVGO"],
}


SNAPSHOT_START_DATE = date(1996, 1, 1)
READY_SNAPSHOT_ACTIONS = ["refresh_snapshots", "start_backtest"]
BLOCKED_SNAPSHOT_ACTIONS = ["refresh_snapshots"]


class SnapshotBlockingError(ValueError):
    def __init__(self, summary: Mapping[str, Any]):
        detail = {
            "status": 409,
            "code": "snapshot_blocked",
            "message": "快照还没准备好，暂时不能提交正式回测。",
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

    def _default_universe_snapshot_id(self, strategy: Mapping[str, Any]) -> str:
        strategy_type = str(strategy.get("strategy_type") or "").upper()
        universe_name = str(strategy.get("universe_name") or "").upper()
        benchmark_symbol = str(strategy.get("benchmark_symbol") or "").upper()
        if strategy_type == "GRID" or universe_name == "QQQ" or benchmark_symbol == "QQQ":
            return NASDAQ100_UNIVERSE_SNAPSHOT_ID
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
        }

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
            return (
                str(blocker.get("code") or ("SNAPSHOT_REFRESH_FAILED" if status == "FAILED" else "SNAPSHOT_REFRESH_REQUIRED")),
                str(blocker.get("target") or item["id"]),
                str(blocker.get("message") or f"{item['name']} 还没准备好。"),
                BLOCKED_SNAPSHOT_ACTIONS,
            )
        if latest_job and str(latest_job.get("status") or "").upper() not in {"", "READY"}:
            summary = latest_job.get("summary") or {}
            return (
                str(summary.get("blocking_code") or "SNAPSHOT_REFRESH_REQUIRED"),
                str(summary.get("blocking_target") or "data_snapshots"),
                str(summary.get("message") or "快照还没准备好，暂时不能提交正式回测。"),
                BLOCKED_SNAPSHOT_ACTIONS,
            )
        return (None, None, "快照已准备好，可以继续正式回测。", READY_SNAPSHOT_ACTIONS)

    def _seed_dataset_snapshots_from_legacy_cache(self, *, as_of: str) -> dict[str, Any] | None:
        existing_rows = {str(item["id"]): item for item in self.market_data_repository.list_dataset_snapshots()}
        needs_price_snapshot = DATASET_PRICE_SNAPSHOT_ID not in existing_rows
        needs_actions_snapshot = DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID not in existing_rows
        if not needs_price_snapshot and not needs_actions_snapshot:
            return None

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
                    "metadata": {
                        "restored_from": "market_bars",
                        "legacy_symbol_count": len(coverage_rows),
                    },
                },
                price_bars=price_bars,
                symbol_coverage=coverage_rows,
            )

        if needs_actions_snapshot:
            actions_status = "STALE" if corporate_actions else "INCOMPLETE"
            actions_blocker = (
                {
                    "code": "LIVE_REFRESH_PENDING",
                    "message": "已从本地缓存恢复公司行为数据，完整在线刷新仍在补齐。",
                }
                if corporate_actions
                else {
                    "code": "CORPORATE_ACTIONS_PENDING",
                    "message": "本地暂时没有公司行为快照，已先恢复价格数据供页面查看。",
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
                    "metadata": {
                        "restored_from": "market_actions",
                        "legacy_symbol_count": len(coverage_rows),
                    },
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

    def start_snapshot_refresh(self, request: Any | None = None) -> dict[str, Any]:
        payload = _as_mapping(request)
        now = iso_now()
        seeded_legacy_snapshot = self._seed_dataset_snapshots_from_legacy_cache(as_of=now)

        with self._snapshot_refresh_lock:
            active_thread = self._snapshot_refresh_thread
            if active_thread and active_thread.is_alive():
                latest = self.storage.fetch_one("SELECT * FROM snapshot_refresh_jobs ORDER BY created_at DESC LIMIT 1")
                return self._build_snapshot_overview(self._decode_snapshot_refresh_job(latest))

            overview = self._build_snapshot_overview()
            warnings: list[str] = []
            if seeded_legacy_snapshot:
                warnings.append(
                    "Seeded dataset snapshots from legacy local cache "
                    f"({seeded_legacy_snapshot['price_row_count']} price rows across "
                    f"{seeded_legacy_snapshot['coverage_symbol_count']} symbols)."
                )
            job = {
                "id": self._new_id("snap"),
                "status": "RUNNING",
                "request": payload,
                "summary": {
                    "status": "RUNNING",
                    "symbol_count": len(overview.get("dataset_snapshots") or []),
                    "row_count": sum(int(item.get("row_count") or 0) for item in overview.get("dataset_snapshots") or []),
                    "blocking": True,
                    "blocking_code": overview.get("blocking_code") or "SNAPSHOT_REFRESH_RUNNING",
                    "blocking_target": overview.get("blocking_target") or "data_snapshots",
                    "message": "快照刷新已开始，页面会自动更新。",
                },
                "warnings": warnings,
                "errors": [],
                "created_at": now,
                "updated_at": now,
                "started_at": now,
                "completed_at": None,
            }
            self._upsert_snapshot_refresh_job(job)
            response_overview = self._build_snapshot_overview(job)

            def runner() -> None:
                try:
                    self.refresh_snapshots(payload)
                except Exception as exc:
                    failed_at = iso_now()
                    failed_overview = self._build_snapshot_overview()
                    failed_job = {
                        **job,
                        "status": "FAILED",
                        "summary": {
                            "status": "FAILED",
                            "symbol_count": len(failed_overview.get("dataset_snapshots") or []),
                            "row_count": sum(
                                int(item.get("row_count") or 0) for item in failed_overview.get("dataset_snapshots") or []
                            ),
                            "blocking": True,
                            "blocking_code": "SNAPSHOT_REFRESH_FAILED",
                            "blocking_target": "data_snapshots",
                            "message": f"快照刷新失败：{exc}",
                        },
                        "warnings": list(job["warnings"]),
                        "errors": [str(exc)],
                        "updated_at": failed_at,
                        "completed_at": failed_at,
                    }
                    self._upsert_snapshot_refresh_job(failed_job)
                finally:
                    with self._snapshot_refresh_lock:
                        self._snapshot_refresh_thread = None

            thread = threading.Thread(target=runner, name=f"snapshot-refresh-{job['id']}", daemon=True)
            self._snapshot_refresh_thread = thread
            thread.start()

        return response_overview

    def _build_snapshot_overview(self, latest_job: Mapping[str, Any] | None = None) -> dict[str, Any]:
        self._seed_dataset_snapshots_from_legacy_cache(as_of=iso_now())
        dataset_rows = {str(item["id"]): item for item in self.market_data_repository.list_dataset_snapshots()}
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
            message = "正在刷新快照，页面会自动更新。当前先显示已有数据。"
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

    def _sync_strategy_snapshot_bindings(self, *, updated_at: str) -> None:
        rows = self.storage.fetch_all("SELECT * FROM strategies")
        for row in rows:
            dataset_snapshot_id = str(row.get("dataset_snapshot_id") or DATASET_PRICE_SNAPSHOT_ID)
            universe_snapshot_id = str(row.get("universe_snapshot_id") or self._default_universe_snapshot_id(row))
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
        rows = self.market_data_repository.load_dataset_snapshot_rows(dataset_snapshot_id).get("price_bars", [])
        wanted = {str(symbol).upper() for symbol in symbols if symbol}
        bars_by_symbol: dict[str, list[dict[str, Any]]] = {symbol: [] for symbol in wanted}
        for row in rows:
            symbol = str(row.get("symbol") or "").upper()
            if wanted and symbol not in wanted:
                continue
            trade_date = str(row.get("date") or "")
            if start_date and trade_date < str(start_date):
                continue
            if end_date and trade_date > str(end_date):
                continue
            bars_by_symbol.setdefault(symbol, []).append(
                {
                    "date": trade_date,
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
        universe_snapshot_id = str(
            (request_payload or {}).get("universe_snapshot_id")
            or strategy.get("universe_snapshot_id")
            or self._default_universe_snapshot_id(strategy)
        )
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

        universe_name = str(strategy.get("universe_name") or "").strip()
        if universe_name in DEFAULT_UNIVERSE_SYMBOLS:
            return list(DEFAULT_UNIVERSE_SYMBOLS[universe_name])
        if universe_name and universe_name.replace(".", "").isalnum() and universe_name.upper() not in {"SP500", "S&P500"}:
            return [universe_name.upper()]
        return ["QQQ"] if str(strategy.get("strategy_type")) == "GRID" else list(DEFAULT_UNIVERSE_SYMBOLS["标普500成分股"])

    def _snapshot_summary(self, strategy: Mapping[str, Any], request_payload: Mapping[str, Any]) -> dict[str, Any]:
        benchmark_symbol = str(strategy.get("benchmark_symbol") or "SPY").upper()
        symbols = [str(symbol).upper() for symbol in self._resolve_universe_symbols(strategy, request_payload)]
        dataset_snapshot_id = str(request_payload.get("dataset_snapshot_id") or DATASET_PRICE_SNAPSHOT_ID)
        universe_snapshot_id = str(request_payload.get("universe_snapshot_id") or self._default_universe_snapshot_id(strategy))
        supporting_dataset_id = DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID
        try:
            price_dataset = self._select_dataset_snapshot(dataset_snapshot_id)
            corporate_dataset = self._select_dataset_snapshot(supporting_dataset_id)
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

        requested_symbols = [benchmark_symbol, *symbols]
        bars = self._load_snapshot_price_bars(
            dataset_snapshot_id,
            requested_symbols,
            start_date=request_payload.get("start_date"),
            end_date=request_payload.get("end_date"),
        )
        benchmark_trade_days = len(bars.get(benchmark_symbol, []))
        available_symbols = [symbol for symbol in symbols if bars.get(symbol)]
        row_count = sum(len(series) for series in bars.values())
        coverage_days = sum(len(series) for symbol, series in bars.items() if symbol != benchmark_symbol)
        blocking_items = []
        for item in (price_dataset, corporate_dataset, universe_snapshot):
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
            "message": blocker.get("message") or ("快照还没准备好，暂时不能提交正式回测。" if blocking else "快照已准备好。"),
            "price_dataset_status": str(price_dataset.get("status") or "INCOMPLETE").upper(),
            "corporate_actions_status": str(corporate_dataset.get("status") or "INCOMPLETE").upper(),
            "universe_status": str(universe_snapshot.get("status") or "INCOMPLETE").upper(),
            "latest_trade_date": bars.get(benchmark_symbol, [{}])[-1].get("date") if bars.get(benchmark_symbol) else None,
        }

    def refresh_snapshots(self, request: Any | None = None) -> dict[str, Any]:
        payload = _as_mapping(request)
        started_at = iso_now()
        seeded_legacy_snapshot = self._seed_dataset_snapshots_from_legacy_cache(as_of=started_at)
        window_start = SNAPSHOT_START_DATE
        window_end = date.today()
        primary_provider = self._primary_market_data_provider()
        fallback_provider = self._fallback_market_data_provider()
        fallback_availability = fallback_provider.availability() if hasattr(fallback_provider, "availability") else None
        warnings: list[str] = []
        errors: list[str] = []
        if seeded_legacy_snapshot:
            warnings.append(
                "Seeded dataset snapshots from legacy local cache "
                f"({seeded_legacy_snapshot['price_row_count']} price rows across "
                f"{seeded_legacy_snapshot['coverage_symbol_count']} symbols)."
            )

        universe_snapshots: list[Any] = []
        for provider in self._universe_history_providers():
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

        symbols = set(collect_snapshot_symbols(universe_snapshots))
        symbols.update({"SPY", "QQQ"})
        for strategy in self.list_strategies():
            universe_name = str(strategy.get("universe_name") or "").strip().upper()
            if universe_name and universe_name.replace(".", "").isalnum():
                symbols.add(universe_name)

        price_bars: list[dict[str, Any]] = []
        corporate_actions: list[dict[str, Any]] = []
        coverage_rows: list[CoverageSummary] = []
        missing_symbols: list[str] = []
        action_partial = False
        synthetic_dates = self._business_days_between(window_start, window_end) if primary_provider is None else []
        for index, symbol in enumerate(sorted(symbols)):
            market_data = None
            if primary_provider is None:
                synthetic_bars = self._synthetic_bars(symbol, index, synthetic_dates)
                synthetic_actions = self._synthetic_actions(symbol, index, synthetic_dates)
                market_data = {
                    "source": "synthetic_seed",
                    "fallback_source": None,
                    "bars": synthetic_bars,
                    "actions": synthetic_actions,
                    "warnings": [],
                    "partial": False,
                    "metadata": {"mode": "offline_seed"},
                }
            else:
                try:
                    market_data = primary_provider.fetch_history(symbol, window_start, window_end)
                except Exception as primary_error:
                    if fallback_availability and bool(fallback_availability.available):
                        try:
                            market_data = fallback_provider.fetch_history(symbol, window_start, window_end)
                        except Exception as fallback_error:
                            errors.append(f"{symbol}: primary={primary_error}; fallback={fallback_error}")
                    else:
                        reason = fallback_availability.reason if fallback_availability else "Fallback provider unavailable."
                        errors.append(f"{symbol}: primary={primary_error}; fallback={reason}")
                    if market_data is None:
                        missing_symbols.append(symbol)
                        continue

            market_data_source = getattr(market_data, "source", None) or (
                market_data.get("source") if isinstance(market_data, Mapping) else None
            )
            market_data_fallback_source = getattr(market_data, "fallback_source", None) or (
                market_data.get("fallback_source") if isinstance(market_data, Mapping) else None
            )
            market_data_metadata = dict(getattr(market_data, "metadata", None) or (
                market_data.get("metadata") if isinstance(market_data, Mapping) else {}
            ))
            bars = list(getattr(market_data, "bars", None) or (market_data.get("bars", []) if isinstance(market_data, Mapping) else []))
            actions = list(getattr(market_data, "actions", None) or (market_data.get("actions", []) if isinstance(market_data, Mapping) else []))
            warning_items = list(getattr(market_data, "warnings", None) or (market_data.get("warnings", []) if isinstance(market_data, Mapping) else []))
            warnings.extend(str(item) for item in warning_items if item)
            action_partial = action_partial or bool(getattr(market_data, "partial", None) or (
                market_data.get("partial") if isinstance(market_data, Mapping) else False
            ))
            if not bars:
                missing_symbols.append(symbol)
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
                    "source": str(item.get("source") or market_data_source or getattr(primary_provider, "provider_name", "synthetic_seed")),
                    "fallback_source": item.get("fallback_source", market_data_fallback_source),
                    "payload": dict(item.get("payload") or {}),
                }
                for item in actions
            ]
            price_bars.extend(normalized_bars)
            corporate_actions.extend(normalized_actions)
            coverage_rows.append(
                CoverageSummary(
                    symbol=symbol,
                    start_date=str(normalized_bars[0]["date"]),
                    end_date=str(normalized_bars[-1]["date"]),
                    trade_days=len(normalized_bars),
                )
            )

        recovery_report = None
        cold_backup_result = None
        if missing_symbols:
            recovery_report = probe_lab2_snapshot_assets()
            warnings.extend(recovery_report.notes)
            if recovery_report.usable_assets:
                cold_backup_result = import_snapshot_cold_backup(self.market_data_repository, recovery_report.usable_assets[0])
                warnings.append(f"Cold backup import attempted from {recovery_report.usable_assets[0]}.")
            else:
                warnings.append("No usable cold backup snapshot database found under Lab2.")

        source_name = str(getattr(primary_provider, "provider_name", "synthetic_seed") if primary_provider is not None else "synthetic_seed")
        fallback_name = None
        if missing_symbols or action_partial:
            fallback_name = fallback_availability.provider_name if fallback_availability else "fallback_unavailable"

        price_status = "READY" if price_bars and not missing_symbols else ("FAILED" if not price_bars else "INCOMPLETE")
        corporate_status = "READY"
        if not corporate_actions:
            corporate_status = "FAILED" if not price_bars else "INCOMPLETE"
        elif action_partial or missing_symbols:
            corporate_status = "INCOMPLETE"

        if price_bars:
            self.market_data_repository.replace_dataset_snapshot(
                {
                    "id": DATASET_PRICE_SNAPSHOT_ID,
                    "name": "股票价格数据",
                    "status": price_status,
                    "as_of": started_at,
                    "freshness_label": "刚刚刷新",
                    "start_date": window_start.isoformat(),
                    "end_date": window_end.isoformat(),
                    "row_count": len(price_bars),
                    "source": source_name,
                    "fallback_source": fallback_name,
                    "blocker": {} if price_status == "READY" else {
                        "code": "PRICE_SNAPSHOT_INCOMPLETE" if price_bars else "PRICE_SNAPSHOT_FAILED",
                        "message": "股票价格数据尚未完整刷新，正式回测仍然阻塞。",
                    },
                    "metadata": {
                        "missing_symbols": missing_symbols,
                        "cold_backup_result": cold_backup_result or {},
                        "recovery_report": recovery_report.as_dict() if recovery_report else {},
                    },
                },
                price_bars=price_bars,
                symbol_coverage=coverage_rows,
            )
        self.market_data_repository.replace_dataset_snapshot(
            {
                "id": DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID,
                "name": "公司行为数据",
                "status": corporate_status,
                "as_of": started_at,
                "freshness_label": "刚刚刷新",
                "start_date": window_start.isoformat(),
                "end_date": window_end.isoformat(),
                "row_count": len(corporate_actions),
                "source": source_name,
                "fallback_source": fallback_name,
                "blocker": {} if corporate_status == "READY" else {
                    "code": "CORPORATE_ACTIONS_INCOMPLETE" if corporate_actions else "CORPORATE_ACTIONS_FAILED",
                    "message": "公司行为数据缺少完整兜底，正式回测仍然阻塞。",
                },
                "metadata": {
                    "missing_symbols": missing_symbols,
                    "partial": action_partial,
                    "cold_backup_result": cold_backup_result or {},
                    "recovery_report": recovery_report.as_dict() if recovery_report else {},
                },
            },
            corporate_actions=corporate_actions,
            symbol_coverage=coverage_rows,
        )

        self._sync_strategy_snapshot_bindings(updated_at=started_at)
        preview_overview = self._build_snapshot_overview()
        completed_at = iso_now()
        summary = {
            "status": preview_overview["overall_status"],
            "symbol_count": len(coverage_rows),
            "row_count": len(price_bars) + len(corporate_actions),
            "blocking": preview_overview["overall_status"] != "READY",
            "blocking_code": preview_overview.get("blocking_code"),
            "blocking_target": preview_overview.get("blocking_target"),
            "message": preview_overview.get("message"),
            "dataset_snapshot_id": DATASET_PRICE_SNAPSHOT_ID,
            "universe_snapshot_ids": [SP500_UNIVERSE_SNAPSHOT_ID, NASDAQ100_UNIVERSE_SNAPSHOT_ID],
        }
        job = {
            "id": self._new_id("snap"),
            "status": preview_overview["overall_status"],
            "request": payload,
            "summary": summary,
            "warnings": sorted(set(warnings)),
            "errors": errors,
            "created_at": started_at,
            "updated_at": completed_at,
            "started_at": started_at,
            "completed_at": completed_at,
        }
        self._upsert_snapshot_refresh_job(job)
        return self.get_snapshot_overview()

    def get_snapshot_overview(self) -> dict[str, Any]:
        latest = self.storage.fetch_one("SELECT * FROM snapshot_refresh_jobs ORDER BY created_at DESC LIMIT 1")
        return self._build_snapshot_overview(self._decode_snapshot_refresh_job(latest))

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
            parameters.setdefault("rebalance_frequency", "weekly")
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
        normalized["universe_snapshot_id"] = str(
            normalized.get("universe_snapshot_id")
            or strategy.get("universe_snapshot_id")
            or self._default_universe_snapshot_id(strategy)
        )
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

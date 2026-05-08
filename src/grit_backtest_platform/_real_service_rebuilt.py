from __future__ import annotations

import math
import os
import re
import hashlib
import subprocess
import sys
import threading
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from copy import deepcopy
from dataclasses import asdict, replace
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence
from time import monotonic
from uuid import uuid4

from .backtest_engine import (
    BacktestConfig,
    DYNAMIC_BUY_AND_HOLD_UNSUPPORTED_WARNING,
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
from ._bond_fixed_income_provider import fetch_official_bond_fixed_income_snapshots
from .fallback_provider import UnconfiguredFallbackProvider, provider_access_tier
from .factor_expression_engine import (
    FIELD_ALIASES,
    FactorExpressionError,
    evaluate_expression,
    neutralize_by_industry,
    normalize_cross_section,
)
from .factor_mining import (
    FactorMiningJobCreateRequest as MiningJobRequest,
    factor_mining_job_id_for_request,
    run_factor_mining_job,
)
from .factor_research import FactorResearchService, build_pit_data_overview
from .pit_external_sources import resolve_cache_dir as default_pit_external_cache_dir
from .market_data_repository import (
    DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID,
    DATASET_FUNDAMENTALS_SNAPSHOT_ID,
    DATASET_INDEX_VALUATIONS_SNAPSHOT_ID,
    DATASET_PRICE_SNAPSHOT_ID,
    CoverageSummary,
    IndexValuationCoverageSummary,
    MarketDataRepository,
)
from ._runtime_memory import read_runtime_memory_status
from .snapshot_recovery import (
    import_legacy_market_data_backup,
    import_snapshot_cold_backup,
    probe_lab2_snapshot_assets,
    probe_workspace_market_data_assets,
)
from .snapshot_provider_projection import (
    build_data_trust_summary,
    build_provider_attempts,
    build_provider_readiness_summary,
    build_provider_registry,
    openbb_provider_enabled,
)
from .service import BacktestPlatformService, _as_mapping
from .storage import dumps, iso_now, is_snapshot_blocking, loads
from .universe_history import (
    ANCHOR_SCHEDULE,
    NASDAQ100_UNIVERSE_KEY,
    NASDAQ100_UNIVERSE_NAME,
    NASDAQ100_UNIVERSE_SNAPSHOT_ID,
    SP500_UNIVERSE_KEY,
    SP500_UNIVERSE_NAME,
    SP500_UNIVERSE_SNAPSHOT_ID,
    SOURCE_QUALITY_HISTORICAL_DATASET,
    SOURCE_QUALITY_OFFICIAL_ANNOUNCEMENT,
    SOURCE_QUALITY_WIKIPEDIA_REVISION,
    CurrentIndustryMetadataUniverseEnricher,
    GithubSp500CurrentValidationProvider,
    UniverseDefinition,
    UniverseMembershipSnapshot,
    _is_historical_anchor_quality,
    collect_snapshot_symbols,
    default_universe_history_providers,
    semiannual_anchor_dates,
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
BENCHMARK_ETF_SYMBOLS = ("SPY", "QQQ")
SNAPSHOT_REFRESH_RUNTIME_STATE_KEY = "snapshot_refresh_runtime"
LONGBRIDGE_MIN_HISTORY_DATE = date(2010, 6, 1)
SNAPSHOT_MEMORY_USAGE_LIMIT = 0.80
SNAPSHOT_SYSTEM_MEMORY_EMERGENCY_LIMIT = 0.95
SNAPSHOT_REFRESH_HEARTBEAT_INTERVAL_SECONDS = 1.0
SNAPSHOT_REFRESH_HEARTBEAT_GRACE_SECONDS = 30.0
SNAPSHOT_PROVIDER_ENV_SIGNATURE_NAMES = (
    "TIINGO_API_TOKEN",
    "ALPHAVANTAGE_API_KEY",
    "FMP_API_KEY",
    "KAGGLE_API_TOKEN",
    "KAGGLE_USERNAME",
    "KAGGLE_KEY",
    "POLYGON_API_KEY",
    "SEC_USER_AGENT",
    "SEC_CONTACT_EMAIL",
    "SEC_EDGAR_CONTACT_EMAIL",
    "FRED_API_KEY",
    "GRIT_ENABLE_OPENBB_PROVIDER",
    "GRIT_ENABLE_STOOQ_ONLINE",
)


def _snapshot_provider_env_signature() -> str:
    parts = []
    for name in SNAPSHOT_PROVIDER_ENV_SIGNATURE_NAMES:
        value = str(os.getenv(name) or "").strip()
        parts.append(f"{name}:{1 if value else 0}")
        if name == "SEC_USER_AGENT":
            parts.append(f"{name}_HAS_EMAIL:{1 if '@' in value else 0}")
    return "|".join(parts)
SNAPSHOT_REFRESH_WORKER_DISCOVERY_TIMEOUT_SECONDS = 3.0
DIRECT_REFRESH_SYMBOL_PATTERN = re.compile(r"^[A-Z][A-Z0-9.-]{0,11}$")
FORMAL_CORPORATE_ACTION_TYPES = {"dividend", "split", "reverse_split"}
DEFAULT_BACKTEST_FEE_BPS = 1.5
DEFAULT_BACKTEST_SLIPPAGE_BPS = 2.5
INDEX_VALUATION_PROXY_NASDAQ100 = "nasdaq100"
INDEX_VALUATION_TRENDONIFY_URL = "https://trendonify.com/united-states/stock-market/nasdaq-100/pe-ratio"
INDEX_VALUATION_WORLDPERATIO_URL = "https://worldperatio.com/index/nasdaq-100/"
INDEX_VALUATION_PROXY_BY_SYMBOL = {
    "QQQ": INDEX_VALUATION_PROXY_NASDAQ100,
}
DEFAULT_DYNAMIC_INVESTMENT_RULES = [
    {"min_percentile": 90.0, "max_percentile": 100.0, "multiplier": 0.5},
    {"min_percentile": 70.0, "max_percentile": 90.0, "multiplier": 0.8},
    {"min_percentile": 30.0, "max_percentile": 70.0, "multiplier": 1.0},
    {"min_percentile": 10.0, "max_percentile": 30.0, "multiplier": 1.5},
    {"min_percentile": 0.0, "max_percentile": 10.0, "multiplier": 2.0},
]


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


def _parse_iso_date(value: str | date | None) -> date:
    if isinstance(value, date):
        return value
    if not value:
        raise ValueError("date value is required")
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date()


def _normalize_dynamic_investment_parameters(
    parameters: Mapping[str, Any] | None,
    *,
    strategy_type: str | None,
    benchmark_symbol: str | None,
) -> dict[str, Any]:
    normalized = dict(parameters or {})
    normalized_strategy_type = str(
        strategy_type or normalized.get("strategy_type") or normalized.get("template_key") or ""
    ).strip().upper()
    dynamic_logic = str(normalized.get("dynamic_investment_logic") or "").strip()
    if normalized_strategy_type != "BUY_AND_HOLD" or not dynamic_logic:
        return normalized
    proxy_key = str(
        normalized.get("dynamic_investment_proxy_key")
        or INDEX_VALUATION_PROXY_BY_SYMBOL.get(
            str(benchmark_symbol or normalized.get("benchmark_symbol") or "").strip().upper(),
            "",
        )
    ).strip().lower()
    if not proxy_key:
        return normalized
    normalized["dynamic_investment_proxy_key"] = proxy_key
    normalized["dynamic_investment_metric_key"] = str(
        normalized.get("dynamic_investment_metric_key") or "pe_ttm_percentile_10y"
    ).strip() or "pe_ttm_percentile_10y"
    existing_rules = normalized.get("dynamic_investment_rules")
    normalized["dynamic_investment_rules"] = (
        list(existing_rules)
        if isinstance(existing_rules, list) and existing_rules
        else list(DEFAULT_DYNAMIC_INVESTMENT_RULES)
    )
    return normalized


def _strategy_requires_index_valuation_data(
    strategy_type: str | None,
    parameters: Mapping[str, Any] | None,
) -> bool:
    normalized_strategy_type = str(
        strategy_type or (parameters or {}).get("strategy_type") or (parameters or {}).get("template_key") or ""
    ).strip().upper()
    if normalized_strategy_type != "BUY_AND_HOLD":
        return False
    return bool(str((parameters or {}).get("dynamic_investment_logic") or "").strip())


def _monthly_observation_gap_days(rows: Sequence[Mapping[str, Any]]) -> tuple[int, int]:
    parsed_dates = sorted(
        _parse_iso_date(str(item.get("date") or item.get("latest_date") or ""))
        for item in rows
        if str(item.get("date") or item.get("latest_date") or "").strip()
    )
    if len(parsed_dates) < 2:
        return (0, 0)
    gap_days = [
        max((parsed_dates[index] - parsed_dates[index - 1]).days, 0)
        for index in range(1, len(parsed_dates))
    ]
    return (max(gap_days), sum(1 for gap in gap_days if gap > 62))


def _rolling_10y_percentiles(rows: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    ordered = sorted(
        (
            {
                **dict(item),
                "date": str(item.get("date") or ""),
                "pe_ttm": _coerce_float(item.get("pe_ttm"), 0.0),
            }
            for item in rows
            if str(item.get("date") or "").strip() and item.get("pe_ttm") not in (None, "")
        ),
        key=lambda item: item["date"],
    )
    results: list[dict[str, Any]] = []
    for index, item in enumerate(ordered):
        current_date = _parse_iso_date(item["date"])
        window_start = current_date - timedelta(days=3660)
        window = [
            candidate
            for candidate in ordered[: index + 1]
            if _parse_iso_date(candidate["date"]) >= window_start
        ]
        percentile = None
        if window:
            below_or_equal = sum(1 for candidate in window if _coerce_float(candidate.get("pe_ttm")) <= item["pe_ttm"])
            percentile = round((below_or_equal / len(window)) * 100.0, 4)
        results.append({**item, "pe_ttm_percentile_10y": percentile})
    return results


def _parse_worldperatio_detail_pe_history(html: str) -> list[dict[str, Any]]:
    match = re.search(r"detailPE_data\s*=\s*\[(.*?)\];", html, re.DOTALL | re.IGNORECASE)
    if not match:
        raise ValueError("WorldPEratio detailPE_data payload was not found.")
    rows: list[dict[str, Any]] = []
    for year, month, day, pe_ttm in re.findall(
        r"Date\.UTC\((\d{4}),\s*(\d{1,2}),\s*(\d{1,2})\)\s*,\s*([0-9]+(?:\.[0-9]+)?)",
        match.group(1),
    ):
        rows.append(
            {
                "date": f"{int(year):04d}-{int(month) + 1:02d}-{int(day):02d}",
                "proxy_symbol": "QQQ",
                "pe_ttm": round(float(pe_ttm), 4),
                "source": "worldperatio",
                "fallback_source": "trendonify",
                "metadata": {
                    "provider_url": INDEX_VALUATION_WORLDPERATIO_URL,
                    "detail_series": "detailPE_data",
                },
            }
        )
    if not rows:
        raise ValueError("WorldPEratio valuation history was empty.")
    return rows


def _runtime_backtest_warning(parameters: Mapping[str, Any] | None) -> str | None:
    return None


def _merge_runtime_backtest_warnings(
    warnings: Sequence[str] | None,
    parameters: Mapping[str, Any] | None,
) -> list[str]:
    merged = [str(item) for item in (warnings or []) if str(item).strip()]
    runtime_warning = _runtime_backtest_warning(parameters)
    if runtime_warning and runtime_warning not in merged:
        merged.append(runtime_warning)
    return merged


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
    parameter_snapshot = dict(run.get("parameter_snapshot") or {})
    contribution_amount = _coerce_float(parameter_snapshot.get("contribution_amount"))
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
        reason = str(trade.get("reason") or "").strip().lower()
        delta_weight = abs(_coerce_float(trade.get("weight_after")) - _coerce_float(trade.get("weight_before")))
        equity_before = _equity_before_trade(chart_points_by_date.get(trade_date))
        traded_notional = equity_before * delta_weight if equity_before > 0 and delta_weight > 0 else 0.0

        if contribution_amount > 0 and reason.startswith("buy_and_hold:"):
            if net_amount in (None, ""):
                trade["net_amount"] = round(contribution_amount, 4)
            if quantity in (None, "") and price > 0:
                trade["quantity"] = round(contribution_amount / price, 6)
            quantity = trade.get("quantity")
            net_amount = trade.get("net_amount")

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
        self._factor_mining_job_lock = threading.Lock()
        self._factor_mining_threads: dict[str, threading.Thread] = {}
        self._factor_mining_cancel_requests: set[str] = set()
        self._factor_research_service_instance: FactorResearchService | None = None
        self._factor_research_service_lock = threading.Lock()
        try:
            pit_cache_ttl = float(os.environ.get("GRIT_PIT_DATA_OVERVIEW_CACHE_SECONDS", "300").strip())
        except (TypeError, ValueError):
            pit_cache_ttl = 300.0
        self._pit_data_overview_cache_seconds = max(0.0, pit_cache_ttl)
        self._pit_data_overview_cache: tuple[float, str, dict[str, Any]] | None = None
        self._pit_data_overview_cache_lock = threading.Lock()
        try:
            snapshot_cache_ttl = float(os.environ.get("GRIT_SNAPSHOT_OVERVIEW_CACHE_SECONDS", "300").strip())
        except (TypeError, ValueError):
            snapshot_cache_ttl = 300.0
        self._snapshot_overview_cache_seconds = max(0.0, snapshot_cache_ttl)
        self._snapshot_overview_cache: tuple[float, str, dict[str, Any]] | None = None
        self._snapshot_overview_cache_lock = threading.Lock()

    def _prewarm_read_model_caches(self) -> None:
        for builder in (self.get_snapshot_overview, self.get_pit_data_overview):
            try:
                builder()
            except Exception:
                continue

    def _factor_research_service(self) -> FactorResearchService:
        with self._factor_research_service_lock:
            if self._factor_research_service_instance is None:
                self._factor_research_service_instance = FactorResearchService(
                    self.storage,
                    self.market_data_repository,
                    pit_overview_builder=self.get_pit_data_overview,
                )
            return self._factor_research_service_instance

    def _invalidate_pit_data_overview_cache(self) -> None:
        with self._pit_data_overview_cache_lock:
            self._pit_data_overview_cache = None

    def _invalidate_snapshot_overview_cache(self) -> None:
        with self._snapshot_overview_cache_lock:
            self._snapshot_overview_cache = None

    def _market_data_snapshot_cache_signature(self) -> str:
        tables = (
            ("dataset_snapshots", "updated_at", ("row_count", "metadata_json", "blocker_json", "as_of", "source", "fallback_source")),
            ("universe_snapshots", "updated_at", ("member_count", "metadata_json", "blocker_json", "as_of", "source", "fallback_source")),
            ("dataset_symbol_coverage", None, ("symbol", "start_date", "end_date", "trade_days")),
            ("dataset_fundamental_coverage", None, ("symbol", "start_date", "end_date", "observation_count")),
            ("universe_memberships", None, ("effective_date", "symbol", "source", "fallback_source", "metadata_json")),
            ("market_coverages", None, ("symbol", "start_date", "end_date", "trade_days")),
            ("market_bars", None, ("symbol", "date")),
            ("pit_cleaning_runs", None, ("id", "dataset_snapshot_id", "universe_snapshot_id", "status", "completed_at")),
            ("pit_quality_events", None, ("id", "dataset_snapshot_id", "universe_snapshot_id", "event_time", "severity", "metadata_json")),
            ("pit_research_waivers", None, ("id", "dataset_snapshot_id", "universe_snapshot_id", "ignored_symbols_json", "revoked_at")),
            ("symbol_identity_cache", None, ("symbol", "canonical_symbol", "source", "valid_from", "valid_to")),
            ("bond_fixed_income_snapshots", "updated_at", ("snapshot_date", "instrument_id", "refresh_status", "metadata_json", "raw_json")),
        )
        parts: list[str] = []
        try:
            with self.market_data_repository.connect() as conn:
                for table, updated_column, columns in tables:
                    try:
                        column_exprs = ["COUNT(*) AS row_count"]
                        if updated_column:
                            column_exprs.append(f"COALESCE(MAX({updated_column}), '') AS max_updated")
                        for index, column in enumerate(columns):
                            column_exprs.append(
                                f"COALESCE(SUM(LENGTH(COALESCE(CAST({column} AS TEXT), ''))), 0) AS c{index}"
                            )
                        row = conn.execute(f"SELECT {', '.join(column_exprs)} FROM {table}").fetchone()
                    except Exception:
                        continue
                    values = [table]
                    if row is not None:
                        row_values = dict(row)
                        values.extend(str(row_values.get(key, "")) for key in row_values)
                    parts.append(":".join(values))
        except Exception:
            return ""
        try:
            external_root = default_pit_external_cache_dir()
            external_paths = [external_root / "manifest.json", external_root / "catalog" / "gsl_pit_bulk.duckdb"]
            manifest_dir = external_root / "manifests"
            if manifest_dir.exists():
                external_paths.extend(sorted(manifest_dir.glob("*.json")))
            for path in external_paths:
                if path.exists() and path.is_file():
                    stat = path.stat()
                    parts.append(f"pit_external:{path.name}:{stat.st_size}:{stat.st_mtime_ns}")
        except Exception:
            pass
        return "|".join(parts)

    def get_pit_data_overview(self) -> dict[str, Any]:
        signature = "|".join([self._market_data_snapshot_cache_signature(), _snapshot_provider_env_signature()])
        now = monotonic()
        with self._pit_data_overview_cache_lock:
            cached = self._pit_data_overview_cache
            if (
                cached is not None
                and cached[1] == signature
                and self._pit_data_overview_cache_seconds > 0
                and now - cached[0] <= self._pit_data_overview_cache_seconds
            ):
                return deepcopy(cached[2])
            overview = build_pit_data_overview(self.market_data_repository)
            try:
                data_trust_summary = None
                with self._snapshot_overview_cache_lock:
                    snapshot_cached = self._snapshot_overview_cache
                    if (
                        snapshot_cached is not None
                        and self._snapshot_overview_cache_seconds > 0
                        and now - snapshot_cached[0] <= self._snapshot_overview_cache_seconds
                    ):
                        cached_summary = snapshot_cached[2].get("data_trust_summary")
                        if isinstance(cached_summary, Mapping):
                            data_trust_summary = dict(cached_summary)
                if data_trust_summary is None:
                    data_trust_summary = build_data_trust_summary(registry_items=[])
                if isinstance(data_trust_summary, Mapping):
                    overview["data_trust_summary"] = dict(data_trust_summary)
            except Exception:
                overview.setdefault("data_trust_summary", {})
            self._pit_data_overview_cache = (now, signature, deepcopy(overview))
            return overview

    def create_pit_research_waiver(self, request: Any) -> dict[str, Any]:
        self._invalidate_pit_data_overview_cache()
        self._factor_research_service().create_research_waiver(request)
        self._invalidate_pit_data_overview_cache()
        return self.get_pit_data_overview()

    def revoke_pit_research_waiver(self, waiver_id: str) -> dict[str, Any]:
        self._invalidate_pit_data_overview_cache()
        self._factor_research_service().revoke_research_waiver(waiver_id)
        self._invalidate_pit_data_overview_cache()
        return self.get_pit_data_overview()

    def apply_pit_identity_override(self, request: Any) -> dict[str, Any]:
        self._invalidate_pit_data_overview_cache()
        result = self._factor_research_service().apply_identity_override(request)
        self._invalidate_pit_data_overview_cache()
        return result

    def restart_pit_identity_scraper(self, request: Any | None = None) -> dict[str, Any]:
        self._invalidate_pit_data_overview_cache()
        payload = dict(_as_mapping(request))
        started_at = iso_now()
        overview = self.get_pit_data_overview()
        coverage_gap = overview.get("coverage_gap") if isinstance(overview.get("coverage_gap"), Mapping) else {}
        buckets = coverage_gap.get("buckets") if isinstance(coverage_gap, Mapping) else []
        pending_symbols: list[str] = []
        if isinstance(buckets, Sequence) and not isinstance(buckets, (str, bytes)):
            for bucket in buckets:
                if not isinstance(bucket, Mapping) or bucket.get("id") != "identity_unresolved":
                    continue
                raw_symbols = bucket.get("symbols") or bucket.get("sample_symbols") or []
                pending_symbols = [
                    str(symbol).strip().upper()
                    for symbol in raw_symbols
                    if str(symbol).strip()
                ]
                break

        requested_symbols = payload.get("symbols")
        if isinstance(requested_symbols, Sequence) and not isinstance(requested_symbols, (str, bytes)):
            requested = {
                str(symbol).strip().upper()
                for symbol in requested_symbols
                if str(symbol).strip()
            }
            if requested:
                pending_symbols = [symbol for symbol in pending_symbols if symbol in requested]

        max_symbols = payload.get("max_symbols")
        try:
            limit = int(max_symbols) if max_symbols is not None else len(pending_symbols)
        except (TypeError, ValueError):
            raise ValueError("Identity scraper max_symbols must be a positive integer.")
        if limit <= 0:
            raise ValueError("Identity scraper max_symbols must be a positive integer.")
        symbols = pending_symbols[:limit]

        def normalize_identity(symbol: str, identity: Mapping[str, Any]) -> dict[str, Any] | None:
            normalized_identity = dict(identity)
            normalized_identity["symbol"] = str(normalized_identity.get("symbol") or symbol).strip().upper()
            if not normalized_identity["symbol"]:
                return None
            normalized_identity["canonical_symbol"] = str(
                normalized_identity.get("canonical_symbol") or normalized_identity["symbol"]
            ).strip().upper()
            normalized_identity.setdefault("source", "identity_scraper_restart")
            return normalized_identity

        resolved_by_symbol: dict[str, dict[str, Any]] = {}
        bulk_resolver = getattr(self.market_data_provider, "resolve_identities", None)
        if callable(bulk_resolver) and symbols:
            try:
                try:
                    bulk_result = bulk_resolver(symbols, include_per_symbol=False)
                except TypeError:
                    bulk_result = bulk_resolver(symbols)
            except Exception:
                bulk_result = {}
            if isinstance(bulk_result, Mapping):
                for raw_symbol, identity in bulk_result.items():
                    symbol = str(raw_symbol or "").strip().upper()
                    if not symbol or symbol not in symbols or not isinstance(identity, Mapping):
                        continue
                    normalized_identity = normalize_identity(symbol, identity)
                    if normalized_identity:
                        resolved_by_symbol[symbol] = normalized_identity

        resolver = getattr(self.market_data_provider, "resolve_identity", None)
        if not callable(bulk_resolver) and callable(resolver):
            for symbol in symbols:
                if symbol in resolved_by_symbol:
                    continue
                try:
                    identity = resolver(symbol)
                except Exception:
                    continue
                if not isinstance(identity, Mapping) or not (identity.get("symbol") or identity.get("canonical_symbol")):
                    continue
                normalized_identity = normalize_identity(symbol, identity)
                if normalized_identity:
                    resolved_by_symbol[symbol] = normalized_identity

        external_resolved_symbols = sorted(resolved_by_symbol)
        for symbol in external_resolved_symbols:
            self.market_data_repository.upsert_symbol_identity(resolved_by_symbol[symbol])

        allow_local_fallback = bool(payload.get("allow_local_fallback", True))
        unresolved_symbols = [symbol for symbol in symbols if symbol not in resolved_by_symbol]
        local_fallback_symbols: list[str] = []
        if allow_local_fallback:
            for symbol in unresolved_symbols:
                self.market_data_repository.upsert_symbol_identity(
                    {
                        "symbol": symbol,
                        "canonical_symbol": symbol,
                        "company_name": "",
                        "cik": "",
                        "exchange": "",
                        "ipo_date": None,
                        "delisting_date": None,
                        "valid_from": None,
                        "valid_to": None,
                        "source": "pit_identity_local_fallback",
                    }
                )
                local_fallback_symbols.append(symbol)
        failed_symbols = [] if allow_local_fallback else unresolved_symbols
        resolved_symbols = sorted([*external_resolved_symbols, *local_fallback_symbols])

        self._invalidate_pit_data_overview_cache()
        refreshed = self.get_pit_data_overview()
        refreshed_gap = refreshed.get("coverage_gap") if isinstance(refreshed.get("coverage_gap"), Mapping) else {}
        refreshed_buckets = refreshed_gap.get("buckets") if isinstance(refreshed_gap, Mapping) else []
        pending_after = 0
        if isinstance(refreshed_buckets, Sequence) and not isinstance(refreshed_buckets, (str, bytes)):
            for bucket in refreshed_buckets:
                if isinstance(bucket, Mapping) and bucket.get("id") == "identity_unresolved":
                    pending_after = int(bucket.get("count") or 0)
                    break
        status = "COMPLETED" if resolved_symbols and not failed_symbols else ("NOOP" if not symbols else "PARTIAL")
        return {
            "job_id": f"pit_identity_{uuid4().hex[:12]}",
            "status": status,
            "message": (
                f"Identity Scraper 已执行：外部解析 {len(external_resolved_symbols)} 项，"
                f"本地 PIT 锚点兜底 {len(local_fallback_symbols)} 项，剩余 {len(failed_symbols)} 项。"
            ),
            "started_at": started_at,
            "completed_at": iso_now(),
            "attempted_count": len(symbols),
            "resolved_count": len(resolved_symbols),
            "failed_count": len(failed_symbols),
            "external_resolved_count": len(external_resolved_symbols),
            "external_resolved_symbols": external_resolved_symbols,
            "local_fallback_count": len(local_fallback_symbols),
            "local_fallback_symbols": local_fallback_symbols,
            "pending_before": len(pending_symbols),
            "pending_after": pending_after,
            "resolved_symbols": resolved_symbols,
            "failed_symbols": failed_symbols,
            "pit_data": refreshed,
        }

    def list_factors(
        self,
        *,
        source: str | None = None,
        tag: str | None = None,
        market: str | None = None,
        status: str | None = None,
        lifecycle: str | None = None,
    ) -> dict[str, Any]:
        return self._factor_research_service().list_factors(
            source=source,
            tag=tag,
            market=market,
            status=status,
            lifecycle=lifecycle,
        )

    def create_factor(self, request: Any) -> dict[str, Any]:
        return self._factor_research_service().create_factor(request)

    def get_factor(self, factor_id: str) -> dict[str, Any]:
        return self._factor_research_service().get_factor(factor_id)

    def run_factor_diagnostics(self, factor_id: str, request: Any) -> dict[str, Any]:
        return self._factor_research_service().run_diagnostics(factor_id, request)

    def preview_factor_diagnostics(self, request: Any) -> dict[str, Any]:
        return self._factor_research_service().preview_diagnostics(request)

    def export_factor_diagnostic_report(self, factor_id: str, run_id: str) -> dict[str, Any]:
        return self._factor_research_service().export_factor_diagnostic_report(factor_id, run_id)

    def factor_quarantine_intake(self, request: Any) -> dict[str, Any]:
        return self._factor_research_service().factor_quarantine_intake(request)

    def list_factor_quarantine_candidates(
        self,
        *,
        status: str | None = None,
        source_job_id: str | None = None,
        cluster: str | None = None,
    ) -> dict[str, Any]:
        return self._factor_research_service().list_factor_quarantine_candidates(
            status=status,
            source_job_id=source_job_id,
            cluster=cluster,
        )

    def get_factor_quarantine_candidate(self, candidate_id: str) -> dict[str, Any]:
        return self._factor_research_service().get_factor_quarantine_candidate(candidate_id)

    def run_factor_quarantine_candidate(self, candidate_id: str, request: Any | None = None) -> dict[str, Any]:
        return self._factor_research_service().run_factor_quarantine_candidate(candidate_id, request)

    def publish_factor_quarantine_candidate(self, candidate_id: str, request: Any | None = None) -> dict[str, Any]:
        return self._factor_research_service().publish_factor_quarantine_candidate(candidate_id, request)

    def get_factor_governance_overview(self) -> dict[str, Any]:
        return self._factor_research_service().get_factor_governance_overview()

    def execute_factor_governance_action(self, action_id: str, request: Any) -> dict[str, Any]:
        return self._factor_research_service().execute_factor_governance_action(action_id, request)

    def create_factor_model_suggestion(self, request: Any) -> dict[str, Any]:
        return self._factor_research_service().create_factor_model_suggestion(request)

    def _factor_universe_symbols(self, universe: Any) -> list[str]:
        normalized = str(universe or "SP500").strip().upper()
        if normalized in DEFAULT_UNIVERSE_SYMBOLS:
            return list(DEFAULT_UNIVERSE_SYMBOLS[normalized])
        symbols = [
            str(item).strip().upper()
            for item in re.split(r"[,;\s]+", str(universe or ""))
            if str(item).strip()
        ]
        return symbols or list(DEFAULT_UNIVERSE_SYMBOLS["SP500"])

    @staticmethod
    def _factor_finite_float(value: Any) -> float | None:
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return None
        return parsed if math.isfinite(parsed) else None

    @staticmethod
    def _factor_score_direction(direction: Any) -> str:
        normalized = str(direction or "").strip().upper()
        if normalized in {"LOW_IS_BETTER", "LOW_IS_GOOD", "LOWER_IS_BETTER"}:
            return "LOWER_IS_BETTER"
        return "HIGHER_IS_BETTER"

    @staticmethod
    def _factor_latest_snapshot_date(snapshots: Sequence[Mapping[str, Any]], snapshot_id: str) -> str | None:
        for snapshot in snapshots:
            if str(snapshot.get("id") or "") == snapshot_id:
                return str(snapshot.get("as_of") or snapshot.get("end_date") or "").strip() or None
        return None

    def _factor_preview_as_of(self, payload: Mapping[str, Any]) -> str:
        requested = str(payload.get("as_of_date") or "").strip()
        if requested:
            return requested
        try:
            snapshots = self.market_data_repository.list_dataset_snapshots()
        except Exception:
            snapshots = []
        return (
            self._factor_latest_snapshot_date(snapshots, DATASET_PRICE_SNAPSHOT_ID)
            or self._factor_latest_snapshot_date(snapshots, DATASET_FUNDAMENTALS_SNAPSHOT_ID)
            or date.today().isoformat()
        )

    def _factor_preview_price_rows(self, symbols: Sequence[str], as_of_date: str) -> dict[str, list[dict[str, Any]]]:
        try:
            as_of = _parse_iso_date(as_of_date)
            start_date = (as_of - timedelta(days=620)).isoformat()
        except ValueError:
            start_date = None
        try:
            return self.market_data_repository.load_dataset_price_bars(
                DATASET_PRICE_SNAPSHOT_ID,
                symbols,
                start_date=start_date,
                end_date=as_of_date,
                include_metadata=False,
            )
        except Exception:
            return {}

    def _factor_mining_market_data(
        self,
        symbols: Sequence[str],
        *,
        start_date: str,
        end_date: str,
    ) -> dict[str, dict[str, list[float]]]:
        try:
            start = _parse_iso_date(start_date)
            warmup_start = (start - timedelta(days=420)).isoformat()
        except ValueError:
            warmup_start = None
        try:
            rows_by_symbol = self.market_data_repository.load_dataset_price_bars(
                DATASET_PRICE_SNAPSHOT_ID,
                symbols,
                start_date=warmup_start,
                end_date=end_date or None,
                include_metadata=False,
            )
        except Exception as exc:
            raise ValueError("因子挖掘需要可读取的价格快照，当前无法读取 ds-price。") from exc

        market_data: dict[str, dict[str, list[float]]] = {}
        for symbol in symbols:
            closes: list[float] = []
            for row in rows_by_symbol.get(str(symbol).strip().upper(), []):
                if not isinstance(row, Mapping):
                    continue
                close = self._factor_finite_float(row.get("adj_close", row.get("close")))
                if close is not None:
                    closes.append(close)
            if len(closes) >= 6:
                market_data[str(symbol).strip().upper()] = {"Close": closes}

        if len(market_data) < 2:
            raise ValueError("因子挖掘需要至少两个标的具备运行时价格快照，不能使用 synthetic 或静态样例数据补齐。")
        return market_data

    def _factor_preview_fundamentals(self, symbols: Sequence[str], as_of_date: str) -> dict[str, dict[str, Any]]:
        try:
            grouped = self.market_data_repository.load_dataset_fundamental_points(
                DATASET_FUNDAMENTALS_SNAPSHOT_ID,
                symbols,
                as_of_date=as_of_date,
            )
        except Exception:
            return {}
        latest: dict[str, dict[str, Any]] = {}
        for symbol, rows in grouped.items():
            ordered = [dict(row) for row in rows if isinstance(row, Mapping)]
            if ordered:
                latest[str(symbol).strip().upper()] = ordered[-1]
        return latest

    def _factor_expression_input(
        self,
        price_rows: Sequence[Mapping[str, Any]],
        fundamental: Mapping[str, Any] | None,
    ) -> dict[str, list[float | None]]:
        closes = [
            self._factor_finite_float(row.get("adj_close", row.get("close")))
            for row in price_rows
            if isinstance(row, Mapping)
        ]
        length = len(closes) if closes else 1
        data: dict[str, list[float | None]] = {}
        if closes:
            data["Close"] = closes
        fundamental = fundamental or {}
        for canonical_name, aliases in FIELD_ALIASES.items():
            if canonical_name == "Close":
                continue
            value = None
            for alias in aliases:
                value = self._factor_finite_float(fundamental.get(alias))
                if value is not None:
                    break
            if value is not None:
                data[canonical_name] = [value] * length
        return data

    def _factor_expression_latest_value(
        self,
        expression: str,
        price_rows: Sequence[Mapping[str, Any]],
        fundamental: Mapping[str, Any] | None,
    ) -> float | None:
        data = self._factor_expression_input(price_rows, fundamental)
        if not data:
            return None
        try:
            series = evaluate_expression(expression, data)
        except (FactorExpressionError, ValueError, TypeError, ZeroDivisionError):
            return None
        for value in reversed(series):
            parsed = self._factor_finite_float(value)
            if parsed is not None:
                return parsed
        return None

    def _factor_industry_snapshot(
        self,
        symbols: Sequence[str],
        universe: Any,
        as_of_date: str,
    ) -> dict[str, Any]:
        symbol_set = {str(symbol).strip().upper() for symbol in symbols if str(symbol).strip()}
        if not symbol_set:
            return {
                "mapping": {},
                "taxonomy": "GICS",
                "industry_field": "universe_membership_snapshots.metadata.gics_sector",
                "covered_symbol_count": 0,
                "missing_symbol_count": 0,
                "missing_symbols": [],
                "source_names": [],
            }
        normalized_universe = str(universe or "SP500").strip().upper()
        snapshot_id = SP500_UNIVERSE_SNAPSHOT_ID if normalized_universe == "SP500" else None
        if normalized_universe == "NASDAQ100":
            snapshot_id = NASDAQ100_UNIVERSE_SNAPSHOT_ID
        try:
            memberships = self.market_data_repository.load_universe_memberships(
                universe_snapshot_id=snapshot_id,
                universe_key=None if snapshot_id else normalized_universe,
                effective_date_lte=as_of_date,
                symbols=sorted(symbol_set),
                active_only=True,
            )
        except Exception:
            return {
                "mapping": {},
                "taxonomy": "GICS",
                "industry_field": "universe_membership_snapshots.metadata.gics_sector",
                "covered_symbol_count": 0,
                "missing_symbol_count": len(symbol_set),
                "missing_symbols": sorted(symbol_set),
                "source_names": [],
            }
        candidates: dict[str, tuple[str, str, str]] = {}
        industry_keys = (
            "gics_sector",
            "GICS Sector",
            "sector",
            "sector_name",
            "gics_industry",
            "gics_industry_group",
            "industry",
            "industry_name",
        )
        for row in memberships:
            symbol = str(row.get("symbol") or "").strip().upper()
            effective_date = str(row.get("effective_date") or "").strip()
            membership_status = str(row.get("membership_status") or "ACTIVE").strip().upper()
            if membership_status in {"REMOVED", "DELETED", "INACTIVE", "OUT", "EXCLUDED"}:
                continue
            if symbol not in symbol_set or (effective_date and effective_date > as_of_date):
                continue
            metadata = row.get("metadata") if isinstance(row.get("metadata"), Mapping) else {}
            industry = ""
            for key in industry_keys:
                industry = str(row.get(key) or metadata.get(key) or "").strip()
                if industry:
                    break
            if not industry:
                continue
            previous = candidates.get(symbol)
            if previous is None or effective_date >= previous[0]:
                source_name = str(
                    metadata.get("industry_classification_source")
                    or row.get("source")
                    or metadata.get("source")
                    or ""
                ).strip()
                candidates[symbol] = (effective_date, industry, source_name)
        mapping = {symbol: industry for symbol, (_effective_date, industry, _source_name) in candidates.items()}
        missing_symbols = sorted(symbol for symbol in symbol_set if symbol and symbol not in mapping)
        source_names = sorted({source_name for _date, _industry, source_name in candidates.values() if source_name})
        return {
            "mapping": mapping,
            "taxonomy": "GICS",
            "industry_field": "universe_membership_snapshots.metadata.gics_sector",
            "covered_symbol_count": len(mapping),
            "missing_symbol_count": len(missing_symbols),
            "missing_symbols": missing_symbols,
            "source_names": source_names,
        }

    def _factor_industry_mapping(
        self,
        symbols: Sequence[str],
        universe: Any,
        as_of_date: str,
    ) -> dict[str, str]:
        snapshot = self._factor_industry_snapshot(symbols, universe, as_of_date)
        mapping = snapshot.get("mapping") if isinstance(snapshot, Mapping) else {}
        return dict(mapping) if isinstance(mapping, Mapping) else {}

    def _factor_model_score_projection(
        self,
        normalized_weights: Sequence[Mapping[str, Any]],
        factor_by_id: Mapping[str, Mapping[str, Any]],
        symbols: Sequence[str],
        *,
        as_of_date: str,
        neutralization: Mapping[str, Any],
        universe: Any,
    ) -> dict[str, Any]:
        price_rows = self._factor_preview_price_rows(symbols, as_of_date)
        fundamentals = self._factor_preview_fundamentals(symbols, as_of_date)
        factor_scores: dict[str, dict[str, float | None]] = {}
        for component in normalized_weights:
            factor_id = str(component.get("factor_id") or "")
            factor = factor_by_id.get(factor_id) or {}
            expression = str(factor.get("expression") or "").strip()
            raw_values = {
                symbol: self._factor_expression_latest_value(
                    expression,
                    price_rows.get(symbol, []),
                    fundamentals.get(symbol),
                )
                for symbol in symbols
            }
            normalized = normalize_cross_section(
                raw_values,
                direction=self._factor_score_direction(component.get("direction") or factor.get("direction")),
            )
            factor_scores[factor_id] = normalized.scores

        combined_scores: dict[str, float | None] = {}
        symbol_coverages: dict[str, float] = {}
        available_score_count = 0
        for symbol in symbols:
            combined = 0.0
            available = 0
            for component in normalized_weights:
                factor_id = str(component.get("factor_id") or "")
                score = factor_scores.get(factor_id, {}).get(symbol)
                if score is None:
                    continue
                combined += _coerce_float(component.get("normalized_weight"), 0.0) * score
                available += 1
            available_score_count += available
            symbol_coverages[symbol] = round(available / max(len(normalized_weights), 1), 4)
            combined_scores[symbol] = round(combined, 6) if available else None

        industry_snapshot = self._factor_industry_snapshot(symbols, universe, as_of_date)
        industry_by_symbol = dict(industry_snapshot.get("mapping") or {})
        neutralization_result = neutralize_by_industry(
            combined_scores,
            enabled=bool(neutralization.get("enabled")),
            industry_by_symbol=industry_by_symbol or None,
        )
        final_scores = neutralization_result.values
        scored_rows = [
            {
                "symbol": symbol,
                "score": round(float(score), 4),
                "coverage": symbol_coverages.get(symbol, 0.0),
            }
            for symbol, score in final_scores.items()
            if score is not None and math.isfinite(float(score))
        ]
        scored_rows.sort(key=lambda item: item["score"], reverse=True)
        score_values = [row["score"] for row in scored_rows]
        score_spread = (max(score_values) - min(score_values)) if score_values else 0.0
        coverage_ratio = available_score_count / max(len(symbols) * len(normalized_weights), 1)
        estimated_turnover = min(0.95, max(0.02, 0.04 + min(score_spread, 6.0) * 0.025 + len(normalized_weights) * 0.006))
        return {
            "score_preview": scored_rows[:8],
            "coverage_ratio": round(coverage_ratio, 4),
            "estimated_turnover": round(estimated_turnover, 4),
            "neutralization_result": neutralization_result,
            "industry_field": industry_snapshot.get("industry_field"),
            "industry_coverage": {
                key: value for key, value in industry_snapshot.items() if key != "mapping"
            },
        }

    def _decode_factor_mining_job_row(self, row: Mapping[str, Any]) -> dict[str, Any]:
        request = loads(row.get("request_json"), {})
        progress = loads(row.get("progress_json"), {})
        top_candidates = loads(row.get("top_candidates_json"), [])
        failed_samples = loads(row.get("failed_samples_json"), [])
        top_candidate_items = top_candidates if isinstance(top_candidates, list) else []
        return {
            "id": row.get("id"),
            "status": row.get("status"),
            "request": request,
            "progress": progress,
            "top_candidates": self._dedupe_factor_mining_candidates(top_candidate_items),
            "failed_samples": failed_samples if isinstance(failed_samples, list) else [],
            "summary": loads(row.get("summary_json"), {}),
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
            "completed_at": row.get("completed_at"),
            "error_message": row.get("error_message"),
        }

    def _factor_mining_request_signature(self, request: Mapping[str, Any]) -> tuple[Any, ...]:
        symbols_value = request.get("symbols")
        symbols = symbols_value if isinstance(symbols_value, Sequence) and not isinstance(symbols_value, (str, bytes)) else ()
        universe = str(request.get("universe") or ",".join(str(symbol) for symbol in symbols) or "").strip().upper()
        operators_value = request.get("operators")
        operators = (
            operators_value
            if isinstance(operators_value, Sequence) and not isinstance(operators_value, (str, bytes))
            else ()
        )
        operator_key = tuple(sorted(str(operator).strip().lower() for operator in operators if str(operator).strip()))
        try:
            candidate_count = int(request.get("candidate_count") or 0)
        except (TypeError, ValueError):
            candidate_count = 0
        try:
            max_depth = int(request.get("max_depth") or 0)
        except (TypeError, ValueError):
            max_depth = 0
        min_rank_ic = round(_coerce_float(request.get("min_rank_ic")), 6)
        return (
            universe,
            str(request.get("start_date") or "").strip(),
            str(request.get("end_date") or "").strip(),
            operator_key,
            candidate_count,
            min_rank_ic,
            max_depth,
        )

    def _factor_mining_row_signature(self, row: Mapping[str, Any]) -> tuple[Any, ...]:
        request = loads(row.get("request_json"), {})
        return self._factor_mining_request_signature(request if isinstance(request, Mapping) else {})

    def _dedupe_factor_mining_job_rows(self, rows: Sequence[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
        seen: set[tuple[Any, ...]] = set()
        deduped_rows: list[Mapping[str, Any]] = []
        for row in rows:
            signature = self._factor_mining_row_signature(row)
            if signature in seen:
                continue
            seen.add(signature)
            deduped_rows.append(row)
        return deduped_rows

    def _find_factor_mining_duplicate_job_row(
        self,
        signature: tuple[Any, ...],
    ) -> Mapping[str, Any] | None:
        rows = self.storage.fetch_all(
            """
            SELECT *
            FROM factor_mining_jobs
            ORDER BY created_at DESC, id DESC
            LIMIT 50
            """
        )
        for row in rows:
            if self._factor_mining_row_signature(row) == signature:
                return row
        return None

    def _dedupe_factor_mining_candidates(self, candidates: Sequence[Any]) -> list[Any]:
        seen: set[str] = set()
        deduped_candidates: list[Any] = []
        for candidate in candidates:
            if not isinstance(candidate, Mapping):
                continue
            expression = " ".join(str(candidate.get("expression") or "").split()).lower()
            signature = expression or str(candidate.get("id") or candidate.get("candidate_id") or "").strip().lower()
            if not signature or signature in seen:
                continue
            seen.add(signature)
            deduped_candidates.append(candidate)
        return deduped_candidates

    def _factor_factory_today(self) -> str:
        return datetime.now(timezone(timedelta(hours=8))).date().isoformat()

    def _factor_factory_default_request(self) -> dict[str, Any]:
        return {
            "universe": "SP500",
            "start_date": "2018-01-01",
            "end_date": "2024-12-31",
            "operators": ["return", "rank", "zscore", "winsorize"],
            "candidate_count": 250,
            "random_seed": 42,
            "min_rank_ic": 0.03,
            "max_depth": 4,
        }

    def _factor_factory_default_gate_policy(self) -> dict[str, Any]:
        return {
            "pit_gate_mode": "DIAGNOSTIC_ONLY",
            "max_style_correlation": 0.3,
            "residual_enabled": True,
            "max_drawdown_relative_to_benchmark": 1.5,
            "min_oos_to_is_ratio": 0.5,
        }

    def _factor_factory_request_payload(self, request: Any | None) -> dict[str, Any]:
        payload = dict(_as_mapping(request or {}))
        nested_request = payload.get("request")
        if isinstance(nested_request, Mapping):
            request_payload = dict(nested_request)
        else:
            request_payload = {
                key: payload[key]
                for key in (
                    "universe",
                    "start_date",
                    "end_date",
                    "operators",
                    "candidate_count",
                    "random_seed",
                    "min_rank_ic",
                    "max_depth",
                )
                if key in payload
            }
        defaults = self._factor_factory_default_request()
        merged = {**defaults, **request_payload}
        merged["operators"] = list(merged.get("operators") or defaults["operators"])
        return merged

    def _factor_factory_gate_policy_payload(self, request: Any | None) -> dict[str, Any]:
        payload = dict(_as_mapping(request or {}))
        policy = payload.get("gate_policy")
        if not isinstance(policy, Mapping):
            policy = {}
        return {**self._factor_factory_default_gate_policy(), **dict(policy)}

    def _factor_factory_config_signature(self, request_payload: Mapping[str, Any], gate_policy: Mapping[str, Any]) -> str:
        request_signature = "|".join(str(part) for part in self._factor_mining_request_signature(request_payload))
        policy_signature = dumps(dict(sorted(gate_policy.items())))
        return hashlib.sha1(f"{request_signature}|{policy_signature}".encode("utf-8")).hexdigest()[:16]

    def _factor_factory_next_run_at(self, schedule_time: str, *, run_date: str | None = None) -> str:
        day = run_date or self._factor_factory_today()
        return f"{day}T{schedule_time}:00+08:00"

    def _decode_factor_factory_profile_row(self, row: Mapping[str, Any] | None) -> dict[str, Any]:
        if not row:
            return {
                "id": "default",
                "status": "PAUSED",
                "timezone": "Asia/Hong_Kong",
                "schedule_time": "14:00",
                "request": self._factor_factory_default_request(),
                "gate_policy": self._factor_factory_default_gate_policy(),
                "created_at": None,
                "updated_at": None,
                "last_run_date": None,
                "next_run_at": self._factor_factory_next_run_at("14:00"),
            }
        schedule_time = str(row.get("schedule_time") or "14:00")
        if schedule_time == "23:30":
            schedule_time = "14:00"
        next_run_at = row.get("next_run_at")
        if not next_run_at or str(next_run_at).endswith("T23:30:00+08:00"):
            next_run_at = self._factor_factory_next_run_at(schedule_time)
        return {
            "id": row.get("id"),
            "status": row.get("status"),
            "timezone": row.get("timezone"),
            "schedule_time": schedule_time,
            "request": loads(row.get("request_json"), self._factor_factory_default_request()),
            "gate_policy": loads(row.get("gate_policy_json"), self._factor_factory_default_gate_policy()),
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
            "last_run_date": row.get("last_run_date"),
            "next_run_at": next_run_at,
        }

    def _decode_factor_factory_run_row(self, row: Mapping[str, Any]) -> dict[str, Any]:
        mining_job = None
        if row.get("mining_job_id"):
            try:
                mining_job = self.get_factor_mining_job(str(row.get("mining_job_id")))
            except Exception:
                mining_job = None
        return {
            "id": row.get("id"),
            "profile_id": row.get("profile_id"),
            "run_date": row.get("run_date"),
            "trigger": row.get("trigger"),
            "status": row.get("status"),
            "request": loads(row.get("request_json"), {}),
            "gate_policy": loads(row.get("gate_policy_json"), {}),
            "config_signature": row.get("config_signature"),
            "mining_job_id": row.get("mining_job_id"),
            "mining_job": mining_job,
            "summary": loads(row.get("summary_json"), {}),
            "started_at": row.get("started_at"),
            "completed_at": row.get("completed_at"),
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
            "error_message": row.get("error_message"),
        }

    def _factor_factory_run_status_from_mining_job(self, mining_status: str) -> str:
        if mining_status in {"QUEUED", "RUNNING"}:
            return "RUNNING"
        if mining_status in {"CANCEL_REQUESTED", "CANCELLED"}:
            return "CANCELLED"
        if mining_status in {"COMPLETED", "PARTIALLY_FAILED"}:
            return "COMPLETED"
        return "FAILED"

    def _record_factor_factory_run_item(
        self,
        *,
        run_id: str,
        stage: str,
        source_id: str | None,
        target_id: str | None,
        status: str,
        summary: Mapping[str, Any] | None = None,
    ) -> None:
        now = iso_now()
        self.storage.insert_json_row(
            "factor_factory_run_items",
            {
                "id": f"ffi_{uuid4().hex[:12]}",
                "run_id": run_id,
                "stage": stage,
                "source_id": source_id,
                "target_id": target_id,
                "status": status,
                "summary_json": dumps(dict(summary or {})),
                "created_at": now,
                "updated_at": now,
            },
        )

    def _run_factor_factory_quarantine_pipeline(
        self,
        *,
        run_id: str,
        mining_job_id: str,
        summary: Mapping[str, Any],
    ) -> dict[str, Any]:
        current_summary = dict(summary)
        if current_summary.get("auto_quarantine_status") == "COMPLETED":
            return current_summary
        if not mining_job_id:
            return current_summary
        intake = self.factor_quarantine_intake({
            "mining_job_id": mining_job_id,
            "source": "factor_factory",
            "factory_run_id": run_id,
        })
        intake_items = intake.get("items") if isinstance(intake.get("items"), list) else []
        self._record_factor_factory_run_item(
            run_id=run_id,
            stage="QUARANTINE_INTAKE",
            source_id=mining_job_id,
            target_id=None,
            status="COMPLETED",
            summary={
                "intake_count": len(intake_items),
                "source_mining_job_id": mining_job_id,
            },
        )
        quarantine_results: list[dict[str, Any]] = []
        for item in intake_items:
            if not isinstance(item, Mapping):
                continue
            candidate_id = str(item.get("id") or "").strip()
            if not candidate_id:
                continue
            if str(item.get("status") or "").upper() == "PUBLISHED":
                continue
            result = self.run_factor_quarantine_candidate(candidate_id, {
                "reason": "factor_factory_auto_quarantine",
                "factory_run_id": run_id,
                "source_mining_job_id": mining_job_id,
            })
            quarantine_results.append(result)
            self._record_factor_factory_run_item(
                run_id=run_id,
                stage="QUARANTINE_RUN",
                source_id=mining_job_id,
                target_id=candidate_id,
                status=str(result.get("status") or "COMPLETED"),
                summary={
                    "publish_status": result.get("publish_status"),
                    "review_reason": result.get("rejected_reason"),
                    "gate_summary": result.get("gate_summary"),
                },
            )
        current_summary.update({
            "auto_intake_count": len(intake_items),
            "auto_quarantine_count": len(quarantine_results),
            "auto_quarantine_status": "COMPLETED",
            "quarantine_candidate_ids": [
                str(item.get("id"))
                for item in quarantine_results
                if isinstance(item, Mapping) and item.get("id")
            ],
            "quarantine_status_counts": {
                "passed": sum(1 for item in quarantine_results if item.get("status") == "PASSED"),
                "needs_review": sum(1 for item in quarantine_results if item.get("status") == "NEEDS_REVIEW"),
                "rejected": sum(1 for item in quarantine_results if item.get("status") == "REJECTED"),
                "eligible": sum(1 for item in quarantine_results if item.get("publish_status") == "ELIGIBLE"),
            },
            "funnel": self._factor_factory_funnel(),
        })
        return current_summary

    def _refresh_factor_factory_run_row(self, row: Mapping[str, Any]) -> Mapping[str, Any]:
        mining_job_id = str(row.get("mining_job_id") or "")
        if not mining_job_id:
            return row
        try:
            mining_job = self.get_factor_mining_job(mining_job_id)
        except Exception:
            return row
        next_status = self._factor_factory_run_status_from_mining_job(str(mining_job.get("status") or ""))
        completed_at = row.get("completed_at")
        if next_status in {"COMPLETED", "FAILED", "CANCELLED"}:
            completed_at = completed_at or mining_job.get("completed_at") or iso_now()
        summary = loads(row.get("summary_json"), {})
        if not isinstance(summary, Mapping):
            summary = {}
        updated_summary = {
            **dict(summary),
            "mining_status": mining_job.get("status"),
            "top_candidate_count": len(mining_job.get("top_candidates") or []),
            "failed_sample_count": len(mining_job.get("failed_samples") or []),
            "funnel": self._factor_factory_funnel(),
        }
        if next_status == "COMPLETED":
            try:
                updated_summary = self._run_factor_factory_quarantine_pipeline(
                    run_id=str(row.get("id") or ""),
                    mining_job_id=mining_job_id,
                    summary=updated_summary,
                )
            except Exception as exc:
                next_status = "FAILED"
                completed_at = completed_at or iso_now()
                updated_summary = {
                    **updated_summary,
                    "auto_quarantine_status": "FAILED",
                    "auto_quarantine_error": str(exc),
                }
        if next_status != row.get("status") or updated_summary != summary:
            self.storage.execute(
                """
                UPDATE factor_factory_runs
                SET status = ?, summary_json = ?, completed_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (next_status, dumps(updated_summary), completed_at, iso_now(), row.get("id")),
            )
            refreshed = self.storage.fetch_one("SELECT * FROM factor_factory_runs WHERE id = ?", (row.get("id"),))
            return refreshed or row
        return row

    def _factor_factory_funnel(self) -> dict[str, int]:
        mining_jobs = self.list_factor_mining_jobs()
        quarantine = self.list_factor_quarantine_candidates()
        mining_items = mining_jobs.get("items") if isinstance(mining_jobs.get("items"), list) else []
        quarantine_items = quarantine.get("items") if isinstance(quarantine.get("items"), list) else []
        mined = sum(len(item.get("top_candidates") or []) for item in mining_items if isinstance(item, Mapping))
        return {
            "mined_candidates": mined,
            "quarantine_candidates": len(quarantine_items),
            "passed": sum(1 for item in quarantine_items if isinstance(item, Mapping) and item.get("status") == "PASSED"),
            "review_or_observation": sum(1 for item in quarantine_items if isinstance(item, Mapping) and item.get("status") == "NEEDS_REVIEW"),
            "rejected": sum(1 for item in quarantine_items if isinstance(item, Mapping) and item.get("status") == "REJECTED"),
            "published": sum(1 for item in quarantine_items if isinstance(item, Mapping) and item.get("status") == "PUBLISHED"),
        }

    def get_factor_factory_overview(self) -> dict[str, Any]:
        profile_row = self.storage.fetch_one("SELECT * FROM factor_factory_profiles WHERE id = 'default'")
        profile = self._decode_factor_factory_profile_row(profile_row)
        run_rows = self.storage.fetch_all(
            """
            SELECT *
            FROM factor_factory_runs
            ORDER BY created_at DESC, id DESC
            LIMIT 10
            """
        )
        refreshed_rows = [self._refresh_factor_factory_run_row(row) for row in run_rows]
        latest_run = self._decode_factor_factory_run_row(refreshed_rows[0]) if refreshed_rows else None
        return {
            "profile": profile,
            "active_run": latest_run if latest_run and latest_run.get("status") in {"QUEUED", "RUNNING"} else None,
            "latest_run": latest_run,
            "runs": [self._decode_factor_factory_run_row(row) for row in refreshed_rows],
            "funnel": self._factor_factory_funnel(),
            "mining": self.list_factor_mining_jobs(),
            "quarantine": self.list_factor_quarantine_candidates(),
            "gate_policy": profile.get("gate_policy") or self._factor_factory_default_gate_policy(),
        }

    def _upsert_factor_factory_profile(
        self,
        *,
        status: str,
        request_payload: Mapping[str, Any],
        gate_policy: Mapping[str, Any],
        timezone_name: str,
        schedule_time: str,
        run_date: str | None = None,
    ) -> dict[str, Any]:
        now = iso_now()
        existing = self.storage.fetch_one("SELECT * FROM factor_factory_profiles WHERE id = 'default'")
        created_at = existing.get("created_at") if existing else now
        self.storage.insert_json_row(
            "factor_factory_profiles",
            {
                "id": "default",
                "status": status,
                "timezone": timezone_name or "Asia/Hong_Kong",
                "schedule_time": schedule_time or "14:00",
                "request_json": dumps(dict(request_payload)),
                "gate_policy_json": dumps(dict(gate_policy)),
                "created_at": created_at,
                "updated_at": now,
                "last_run_date": run_date or (existing.get("last_run_date") if existing else None),
                "next_run_at": self._factor_factory_next_run_at(schedule_time or "14:00"),
            },
        )
        row = self.storage.fetch_one("SELECT * FROM factor_factory_profiles WHERE id = 'default'")
        return self._decode_factor_factory_profile_row(row)

    def _create_factor_factory_run(
        self,
        *,
        trigger: str,
        request_payload: Mapping[str, Any],
        gate_policy: Mapping[str, Any],
        run_date: str | None = None,
    ) -> dict[str, Any]:
        run_date = run_date or self._factor_factory_today()
        config_signature = self._factor_factory_config_signature(request_payload, gate_policy)
        if trigger == "DAILY":
            existing = self.storage.fetch_one(
                """
                SELECT *
                FROM factor_factory_runs
                WHERE profile_id = 'default' AND run_date = ? AND config_signature = ? AND trigger = 'DAILY'
                LIMIT 1
                """,
                (run_date, config_signature),
            )
            if existing:
                return self._decode_factor_factory_run_row(self._refresh_factor_factory_run_row(existing))
            run_id = f"ffr_{run_date.replace('-', '')}_{config_signature[:10]}"
        else:
            run_id = f"ffr_manual_{uuid4().hex[:12]}"
        now = iso_now()
        try:
            mining_job = self.create_factor_mining_job(dict(request_payload))
            mining_job_id = str(mining_job.get("id") or "")
            run_status = self._factor_factory_run_status_from_mining_job(str(mining_job.get("status") or "RUNNING"))
            error_message = None
        except Exception as exc:
            mining_job_id = None
            run_status = "FAILED"
            error_message = str(exc)
        summary = {
            "trigger": trigger,
            "daily_automation": trigger == "DAILY",
            "pit_gate_mode": "DIAGNOSTIC_ONLY",
            "residual_enabled": bool(gate_policy.get("residual_enabled", True)),
            "drawdown_threshold": gate_policy.get("max_drawdown_relative_to_benchmark", 1.5),
            "mining_job_id": mining_job_id,
            "funnel": self._factor_factory_funnel(),
        }
        self.storage.insert_json_row(
            "factor_factory_runs",
            {
                "id": run_id,
                "profile_id": "default",
                "run_date": run_date,
                "trigger": trigger,
                "status": run_status,
                "request_json": dumps(dict(request_payload)),
                "gate_policy_json": dumps(dict(gate_policy)),
                "config_signature": config_signature,
                "mining_job_id": mining_job_id,
                "summary_json": dumps(summary),
                "started_at": now,
                "completed_at": now if run_status in {"FAILED", "CANCELLED"} else None,
                "created_at": now,
                "updated_at": now,
                "error_message": error_message,
            },
        )
        self.storage.insert_json_row(
            "factor_factory_run_items",
            {
                "id": f"ffi_{uuid4().hex[:12]}",
                "run_id": run_id,
                "stage": "MINING",
                "source_id": None,
                "target_id": mining_job_id,
                "status": run_status,
                "summary_json": dumps({"request": dict(request_payload), "gate_policy": dict(gate_policy)}),
                "created_at": now,
                "updated_at": now,
            },
        )
        row = self.storage.fetch_one("SELECT * FROM factor_factory_runs WHERE id = ?", (run_id,))
        return self._decode_factor_factory_run_row(row or {})

    def start_factor_factory_automation(self, request: Any | None = None) -> dict[str, Any]:
        payload = dict(_as_mapping(request or {}))
        request_payload = self._factor_factory_request_payload(request)
        gate_policy = self._factor_factory_gate_policy_payload(request)
        timezone_name = str(payload.get("timezone") or "Asia/Hong_Kong")
        schedule_time = str(payload.get("schedule_time") or "14:00")
        run_date = self._factor_factory_today()
        profile = self._upsert_factor_factory_profile(
            status="ACTIVE",
            request_payload=request_payload,
            gate_policy=gate_policy,
            timezone_name=timezone_name,
            schedule_time=schedule_time,
            run_date=run_date,
        )
        run = self._create_factor_factory_run(
            trigger="DAILY",
            request_payload=request_payload,
            gate_policy=gate_policy,
            run_date=run_date,
        )
        return {**self.get_factor_factory_overview(), "profile": profile, "daily_run": run}

    def pause_factor_factory_automation(self) -> dict[str, Any]:
        profile_row = self.storage.fetch_one("SELECT * FROM factor_factory_profiles WHERE id = 'default'")
        profile_payload = self._decode_factor_factory_profile_row(profile_row)
        profile = self._upsert_factor_factory_profile(
            status="PAUSED",
            request_payload=profile_payload.get("request") or self._factor_factory_default_request(),
            gate_policy=profile_payload.get("gate_policy") or self._factor_factory_default_gate_policy(),
            timezone_name=str(profile_payload.get("timezone") or "Asia/Hong_Kong"),
            schedule_time=str(profile_payload.get("schedule_time") or "14:00"),
        )
        return {**self.get_factor_factory_overview(), "profile": profile}

    def run_factor_factory_now(self, request: Any | None = None) -> dict[str, Any]:
        request_payload = self._factor_factory_request_payload(request)
        gate_policy = self._factor_factory_gate_policy_payload(request)
        run = self._create_factor_factory_run(
            trigger="MANUAL",
            request_payload=request_payload,
            gate_policy=gate_policy,
        )
        return {**self.get_factor_factory_overview(), "manual_run": run}

    def cancel_factor_factory_run(self, run_id: str) -> dict[str, Any]:
        row = self.storage.fetch_one("SELECT * FROM factor_factory_runs WHERE id = ?", (run_id,))
        if not row:
            raise KeyError(f"Factor factory run not found: {run_id}")
        mining_job_id = str(row.get("mining_job_id") or "")
        if mining_job_id:
            try:
                self.cancel_factor_mining_job(mining_job_id)
            except Exception:
                pass
        now = iso_now()
        self.storage.execute(
            """
            UPDATE factor_factory_runs
            SET status = 'CANCELLED', completed_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (now, now, run_id),
        )
        refreshed = self.storage.fetch_one("SELECT * FROM factor_factory_runs WHERE id = ?", (run_id,))
        return self._decode_factor_factory_run_row(refreshed or row)

    def _project_mining_candidate(self, candidate: Any) -> dict[str, Any]:
        rank_ic = candidate.rank_ic if getattr(candidate, "rank_ic", None) is not None else 0.0
        fitness_score = getattr(candidate, "fitness_score", None)
        auto_residual_summary = getattr(candidate, "auto_residual_summary", None) or {}
        return {
            "id": candidate.candidate_id,
            "candidate_id": candidate.candidate_id,
            "rank": candidate.rank,
            "expression": candidate.expression,
            "score": round(float(fitness_score if fitness_score is not None else rank_ic), 6),
            "rank_ic": rank_ic,
            "pure_rank_ic": getattr(candidate, "pure_rank_ic", None),
            "ir": getattr(candidate, "information_ratio", None),
            "information_ratio": getattr(candidate, "information_ratio", None),
            "holding_period": getattr(candidate, "holding_period", None),
            "newey_west_lags": getattr(candidate, "newey_west_lags", None),
            "fitness_score": fitness_score,
            "max_style_correlation": getattr(candidate, "max_style_correlation", None),
            "correlation_penalty": getattr(candidate, "correlation_penalty", 0.0),
            "max_drawdown_pct": getattr(candidate, "max_drawdown_pct", None),
            "benchmark_max_drawdown_pct": getattr(candidate, "benchmark_max_drawdown_pct", None),
            "drawdown_vs_benchmark_ratio": getattr(candidate, "drawdown_vs_benchmark_ratio", None),
            "auto_residual_summary": dict(auto_residual_summary) if isinstance(auto_residual_summary, Mapping) else {},
            "turnover": getattr(candidate, "turnover", 0.0),
            "coverage": candidate.coverage,
            "depth": getattr(candidate, "depth", None),
            "risk_flags": list(candidate.risk_flags),
            "status": candidate.status,
            "persisted_to_factor_definitions": False,
        }

    def create_factor_mining_job(self, request: Any) -> dict[str, Any]:
        payload = dict(_as_mapping(request))
        symbols = self._factor_universe_symbols(payload.get("universe"))
        mining_request = MiningJobRequest(
            universe=tuple(symbols),
            start_date=str(payload.get("start_date") or ""),
            end_date=str(payload.get("end_date") or ""),
            operators=tuple(str(item) for item in payload.get("operators") or ()),
            candidate_count=int(payload.get("candidate_count") or 0),
            random_seed=int(payload.get("random_seed") if payload.get("random_seed") is not None else 0),
            min_rank_ic=_coerce_float(payload.get("min_rank_ic")),
            max_depth=int(payload.get("max_depth") or 3),
        )
        mining_request.validate()
        job_id = factor_mining_job_id_for_request(mining_request)
        request_signature = self._factor_mining_request_signature(payload)
        with self._factor_mining_job_lock:
            duplicate = self._find_factor_mining_duplicate_job_row(request_signature)
            if duplicate is not None:
                return self._decode_factor_mining_job_row(duplicate)
        created_at = iso_now()
        market_data = self._factor_mining_market_data(
            symbols,
            start_date=mining_request.start_date,
            end_date=mining_request.end_date,
        )
        summary = {
            "universe_symbol_count": len(symbols),
            "price_symbol_count": len(market_data),
            "dataset_snapshot_id": DATASET_PRICE_SNAPSHOT_ID,
            "market_data_source": "dataset_price_bars",
            "synthetic_market_data": False,
            "top_candidate_count": 0,
            "failed_sample_count": 0,
            "persisted_to_factor_definitions": False,
        }
        progress = {
            "total_candidates": mining_request.candidate_count,
            "evaluated_candidates": 0,
            "failed_candidates": 0,
            "throughput_per_second": 0.0,
            "percent": 0.0,
        }
        with self._factor_mining_job_lock:
            duplicate = self._find_factor_mining_duplicate_job_row(request_signature)
            if duplicate is not None:
                return self._decode_factor_mining_job_row(duplicate)
            existing = self.storage.fetch_one("SELECT * FROM factor_mining_jobs WHERE id = ?", (job_id,))
            existing_status = str(existing.get("status") or "") if existing else ""
            thread = self._factor_mining_threads.get(job_id)
            if existing and (
                existing_status not in {"QUEUED", "RUNNING", "CANCEL_REQUESTED"}
                or (thread is not None and thread.is_alive())
            ):
                return self._decode_factor_mining_job_row(existing)
            self._factor_mining_cancel_requests.discard(job_id)
            self.storage.insert_json_row(
                "factor_mining_jobs",
                {
                    "id": job_id,
                    "status": "RUNNING",
                    "request_json": dumps({**payload, "symbols": symbols, "dataset_snapshot_id": DATASET_PRICE_SNAPSHOT_ID}),
                    "progress_json": dumps(progress),
                    "summary_json": dumps(summary),
                    "top_candidates_json": dumps([]),
                    "failed_samples_json": dumps([]),
                    "created_at": created_at,
                    "updated_at": created_at,
                    "completed_at": None,
                    "error_message": None,
                },
            )
            thread = threading.Thread(
                target=self._run_factor_mining_job_background,
                args=(job_id, mining_request, market_data, payload, symbols, created_at),
                name=f"factor-mining-{job_id}",
                daemon=True,
            )
            self._factor_mining_threads[job_id] = thread
            thread.start()
        return self.get_factor_mining_job(job_id)

    def _factor_mining_should_cancel(self, job_id: str) -> bool:
        with self._factor_mining_job_lock:
            return job_id in self._factor_mining_cancel_requests

    def _run_factor_mining_job_background(
        self,
        job_id: str,
        mining_request: MiningJobRequest,
        market_data: dict[str, dict[str, list[float]]],
        payload: Mapping[str, Any],
        symbols: Sequence[str],
        created_at: str,
    ) -> None:
        started_at = monotonic()
        progress_step = max(1, mining_request.candidate_count // 20)
        last_progress_index = 0
        last_progress_written_at = 0.0

        def should_cancel_with_progress(candidate_index: int) -> bool:
            nonlocal last_progress_index, last_progress_written_at
            current_time = monotonic()
            should_write_progress = (
                candidate_index > 0
                and (
                    candidate_index == 1
                    or candidate_index - last_progress_index >= progress_step
                    or current_time - last_progress_written_at >= 1.0
                )
            )
            if should_write_progress:
                self._update_factor_mining_running_progress(
                    job_id,
                    total_candidates=mining_request.candidate_count,
                    evaluated_candidates=candidate_index,
                    started_at=started_at,
                    now=current_time,
                )
                last_progress_index = candidate_index
                last_progress_written_at = current_time
            return self._factor_mining_should_cancel(job_id)

        try:
            result = run_factor_mining_job(
                mining_request,
                market_data=market_data,
                should_cancel=should_cancel_with_progress,
                top_k=10,
            )
            self._store_factor_mining_result(
                result,
                payload=payload,
                symbols=symbols,
                market_data=market_data,
                created_at=created_at,
            )
        except Exception as exc:
            failed_at = iso_now()
            existing = self.storage.fetch_one("SELECT * FROM factor_mining_jobs WHERE id = ?", (job_id,))
            request_json = existing.get("request_json") if existing else dumps(
                {**payload, "symbols": symbols, "dataset_snapshot_id": DATASET_PRICE_SNAPSHOT_ID}
            )
            summary = loads(existing.get("summary_json"), {}) if existing else {}
            progress = loads(existing.get("progress_json"), {}) if existing else {}
            self.storage.insert_json_row(
                "factor_mining_jobs",
                {
                    "id": job_id,
                    "status": "FAILED",
                    "request_json": request_json,
                    "progress_json": dumps({**progress, "percent": float(progress.get("percent") or 0.0)}),
                    "summary_json": dumps({**summary, "error": str(exc), "persisted_to_factor_definitions": False}),
                    "top_candidates_json": existing.get("top_candidates_json") if existing else dumps([]),
                    "failed_samples_json": existing.get("failed_samples_json") if existing else dumps([]),
                    "created_at": existing.get("created_at") if existing else created_at,
                    "updated_at": failed_at,
                    "completed_at": failed_at,
                    "error_message": str(exc),
                },
            )
        finally:
            with self._factor_mining_job_lock:
                self._factor_mining_threads.pop(job_id, None)
                self._factor_mining_cancel_requests.discard(job_id)

    def _update_factor_mining_running_progress(
        self,
        job_id: str,
        *,
        total_candidates: int,
        evaluated_candidates: int,
        started_at: float,
        now: float,
    ) -> None:
        total = max(0, int(total_candidates))
        evaluated = max(0, min(int(evaluated_candidates), total))
        percent = 100.0 if total == 0 else round(evaluated / total * 100.0, 2)
        if evaluated < total:
            percent = min(percent, 99.0)
        elapsed = max(now - started_at, 0.000001)
        progress = {
            "total_candidates": total,
            "evaluated_candidates": evaluated,
            "failed_candidates": 0,
            "throughput_per_second": round(evaluated / elapsed, 3),
            "percent": percent,
        }
        self.storage.execute(
            """
            UPDATE factor_mining_jobs
            SET progress_json = ?, updated_at = ?
            WHERE id = ? AND status IN ('QUEUED', 'RUNNING', 'CANCEL_REQUESTED')
            """,
            (dumps(progress), iso_now(), job_id),
        )

    def _store_factor_mining_result(
        self,
        result: Any,
        *,
        payload: Mapping[str, Any],
        symbols: Sequence[str],
        market_data: Mapping[str, Mapping[str, Sequence[float | int | None]]],
        created_at: str,
    ) -> None:
        completed_at = iso_now()
        job_id = result.job_id
        top_candidates = [self._project_mining_candidate(candidate) for candidate in result.top_candidates]
        failed_samples = [
            {
                "candidate_index": sample.candidate_index,
                "expression": sample.expression,
                "reason": sample.error_message,
                "error_message": sample.error_message,
            }
            for sample in result.failed_samples
        ]
        progress = {
            "total_candidates": result.requested_candidates,
            "evaluated_candidates": result.candidates_evaluated,
            "failed_candidates": len(result.failed_samples),
            "throughput_per_second": result.throughput_per_second,
            "percent": result.progress_pct,
        }
        summary = {
            "universe_symbol_count": len(symbols),
            "price_symbol_count": len(market_data),
            "dataset_snapshot_id": DATASET_PRICE_SNAPSHOT_ID,
            "market_data_source": "dataset_price_bars",
            "synthetic_market_data": False,
            "top_candidate_count": len(top_candidates),
            "failed_sample_count": len(failed_samples),
            "persisted_to_factor_definitions": False,
        }
        self.storage.insert_json_row(
            "factor_mining_jobs",
            {
                "id": job_id,
                "status": result.status,
                "request_json": dumps({**payload, "symbols": symbols, "dataset_snapshot_id": DATASET_PRICE_SNAPSHOT_ID}),
                "progress_json": dumps(progress),
                "summary_json": dumps(summary),
                "top_candidates_json": dumps(top_candidates),
                "failed_samples_json": dumps(failed_samples),
                "created_at": created_at,
                "updated_at": completed_at,
                "completed_at": completed_at,
                "error_message": None,
            },
        )
        candidate_rows = [
            (
                candidate.candidate_id,
                job_id,
                candidate.expression,
                getattr(candidate, "fitness_score", None) if getattr(candidate, "fitness_score", None) is not None else candidate.rank_ic,
                candidate.rank_ic,
                getattr(candidate, "turnover", 0.0),
                candidate.coverage,
                getattr(candidate, "depth", None),
                dumps(list(candidate.risk_flags)),
                dumps({
                    "rank": candidate.rank,
                    "status": candidate.status,
                    "persisted_to_factor_definitions": False,
                    "fitness_score": getattr(candidate, "fitness_score", None),
                    "pure_rank_ic": getattr(candidate, "pure_rank_ic", None),
                    "ir": getattr(candidate, "information_ratio", None),
                    "information_ratio": getattr(candidate, "information_ratio", None),
                    "holding_period": getattr(candidate, "holding_period", None),
                    "newey_west_lags": getattr(candidate, "newey_west_lags", None),
                    "max_style_correlation": getattr(candidate, "max_style_correlation", None),
                    "correlation_penalty": getattr(candidate, "correlation_penalty", 0.0),
                    "max_drawdown_pct": getattr(candidate, "max_drawdown_pct", None),
                    "benchmark_max_drawdown_pct": getattr(candidate, "benchmark_max_drawdown_pct", None),
                    "drawdown_vs_benchmark_ratio": getattr(candidate, "drawdown_vs_benchmark_ratio", None),
                    "auto_residual_summary": getattr(candidate, "auto_residual_summary", None) or {},
                }),
                created_at,
            )
            for candidate in result.all_candidates
        ]
        if candidate_rows:
            self.storage.executemany(
                """
                INSERT OR REPLACE INTO factor_mining_candidates (
                    id, job_id, expression, score, rank_ic, turnover, coverage,
                    depth, risk_flags_json, summary_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                candidate_rows,
            )
        factory_rows = self.storage.fetch_all(
            """
            SELECT *
            FROM factor_factory_runs
            WHERE mining_job_id = ? AND status NOT IN ('CANCELLED', 'FAILED')
            """,
            (job_id,),
        )
        for row in factory_rows:
            self._refresh_factor_factory_run_row(row)

    def list_factor_mining_jobs(self) -> dict[str, Any]:
        rows = self.storage.fetch_all(
            """
            SELECT *
            FROM factor_mining_jobs
            ORDER BY created_at DESC, id DESC
            LIMIT 50
            """
        )
        unique_rows = self._dedupe_factor_mining_job_rows(rows)
        items = [self._decode_factor_mining_job_row(row) for row in unique_rows]
        return {
            "items": items,
            "summary": {
                "total": len(items),
                "running_count": sum(1 for item in items if item.get("status") in {"QUEUED", "RUNNING", "CANCEL_REQUESTED"}),
                "completed_count": sum(1 for item in items if item.get("status") == "COMPLETED"),
            },
        }

    def get_factor_mining_job(self, job_id: str) -> dict[str, Any]:
        row = self.storage.fetch_one("SELECT * FROM factor_mining_jobs WHERE id = ?", (job_id,))
        if not row:
            raise KeyError(f"Factor mining job not found: {job_id}")
        return self._decode_factor_mining_job_row(row)

    def cancel_factor_mining_job(self, job_id: str) -> dict[str, Any]:
        row = self.storage.fetch_one("SELECT * FROM factor_mining_jobs WHERE id = ?", (job_id,))
        if not row:
            raise KeyError(f"Factor mining job not found: {job_id}")
        status = str(row.get("status") or "")
        if status in {"QUEUED", "RUNNING", "CANCEL_REQUESTED"}:
            with self._factor_mining_job_lock:
                self._factor_mining_cancel_requests.add(job_id)
            row["status"] = "CANCELLED"
            row["updated_at"] = iso_now()
            row["completed_at"] = row["updated_at"]
            self.storage.insert_json_row("factor_mining_jobs", row)
        return self.get_factor_mining_job(job_id)

    def _normalize_factor_model_risk_item(
        self,
        item: Any,
        *,
        factor_id: str,
        factor: Mapping[str, Any] | None,
        default_code: str,
        default_message: str,
        severity: str,
    ) -> dict[str, Any]:
        payload = dict(item) if isinstance(item, Mapping) else {"message": str(item or "")}
        code = str(payload.get("code") or payload.get("reason_code") or default_code).strip().upper()
        message = str(
            payload.get("message")
            or payload.get("summary")
            or payload.get("label")
            or payload.get("reason")
            or default_message
        ).strip()
        normalized = dict(payload)
        normalized.update(
            {
                "factor_id": factor_id,
                "factor_name": (factor or {}).get("name") or payload.get("factor_name") or factor_id,
                "code": code or default_code,
                "message": message or default_message,
                "severity": str(payload.get("severity") or severity).upper(),
            }
        )
        return normalized

    def _dedupe_factor_model_risk_items(
        self,
        items: Sequence[Mapping[str, Any]],
    ) -> list[dict[str, Any]]:
        deduped: list[dict[str, Any]] = []
        seen: set[tuple[str, str, str]] = set()
        for item in items:
            key = (
                str(item.get("factor_id") or ""),
                str(item.get("code") or "").upper(),
                str(item.get("message") or ""),
            )
            if key in seen:
                continue
            seen.add(key)
            deduped.append(dict(item))
        return deduped

    def _factor_model_is_hard_blocker(
        self,
        item: Mapping[str, Any],
        *,
        default_hard: bool = False,
    ) -> bool:
        code = str(item.get("code") or item.get("reason_code") or "").upper()
        text = f"{code} {item.get('message') or ''} {item.get('reason') or ''}".lower()
        warning_code_fragments = (
            "HIGH_CORRELATION",
            "CORRELATION",
            "SAME_FAMILY",
            "FAMILY_OVERLAP",
            "OVERLAP",
            "IC_UNSTABLE",
            "WEAK_IC",
            "IR_UNSTABLE",
            "TURNOVER_DECAY",
            "TURNOVER_HIGH",
            "COVERAGE_EDGE",
            "LOW_COVERAGE",
            "DIAGNOSTIC_STALE",
            "STALE_DIAGNOSTIC",
            "VERIFIED_PIT_WINDOW_INCOMPLETE",
        )
        warning_text_fragments = (
            "高相关",
            "同族",
            "ic 不稳定",
            "ic不稳定",
            "ir 不稳定",
            "换手衰减",
            "coverage 边缘",
            "覆盖率边缘",
            "诊断过期",
        )
        if any(fragment in code for fragment in warning_code_fragments) or any(
            fragment in text for fragment in warning_text_fragments
        ):
            return False
        hard_code_fragments = (
            "PIT",
            "FUTURE",
            "NON_REPLAYABLE",
            "NOT_REPLAYABLE",
            "CURRENT_ONLY",
            "CURRENT-ONLY",
            "UNSAFE",
            "AVAILABLE_AT",
            "NO_FACTOR_SCORE_PREVIEW",
            "BLOCKED_DATA",
            "BLOCKED_PIT",
        )
        hard_text_fragments = (
            "pit 缺口",
            "未来函数",
            "不可回放",
            "current-only",
            "current only",
            "unsafe expression",
            "available_at",
            "可得日",
            "缺少行业 pit",
            "行业 pit",
        )
        if any(fragment in code for fragment in hard_code_fragments) or any(
            fragment in text for fragment in hard_text_fragments
        ):
            return True
        return default_hard

    def _factor_model_low_risk_price_gap_context(self) -> dict[str, Any] | None:
        try:
            overview = self.get_pit_data_overview()
        except Exception:
            return None
        coverage_gap = overview.get("coverage_gap") if isinstance(overview.get("coverage_gap"), Mapping) else {}
        buckets = {
            str(bucket.get("id") or ""): bucket
            for bucket in coverage_gap.get("buckets") or []
            if isinstance(bucket, Mapping)
        }
        current_core = int(_coerce_float((buckets.get("current_core_missing") or {}).get("count"), 0.0))
        historical_core = int(_coerce_float((buckets.get("historical_lifecycle_missing") or {}).get("count"), 0.0))
        non_core_bucket = buckets.get("non_core_missing") or {}
        non_core = int(
            _coerce_float(
                non_core_bucket.get("count")
                if non_core_bucket.get("count") is not None
                else coverage_gap.get("default_ignored_count"),
                0.0,
            )
        )
        non_core_mcap_weight = _coerce_float(non_core_bucket.get("mcap_weight_pct"), 0.0)
        missing_total = int(_coerce_float(coverage_gap.get("missing_symbol_count"), 0.0))
        if missing_total <= 0 or non_core <= 0:
            return None
        if current_core > 0 or historical_core > 0 or non_core_mcap_weight > 0.0001:
            return None
        summary = (
            f"PIT核心成员价格缺口为 {current_core}，"
            f"{non_core} 个非核心缺口市值权重占比 {non_core_mcap_weight:.2f}%，"
            "实盘准入风险极低。"
        )
        return {
            "code": "LOW_RISK_NON_CORE_PRICE_GAP",
            "label": "低风险准入",
            "summary": summary,
            "current_core_missing_count": current_core,
            "historical_core_missing_count": historical_core,
            "non_core_missing_count": non_core,
            "non_core_mcap_weight_pct": round(non_core_mcap_weight, 4),
            "missing_symbol_count": missing_total,
        }

    @staticmethod
    def _factor_model_can_soften_price_gap_blocker(
        item: Mapping[str, Any],
        low_risk_context: Mapping[str, Any] | None,
    ) -> bool:
        if not low_risk_context:
            return False
        code = str(item.get("code") or item.get("reason_code") or "").upper()
        return code in {
            "PRICE_SNAPSHOT_NOT_READY",
            "PIT_GATE_BLOCKED",
            "PIT_BLOCKER",
            "BLOCKED_PIT",
        }

    def _factor_model_soften_low_risk_price_gap_blockers(
        self,
        hard_blockers: Sequence[Mapping[str, Any]],
        low_risk_context: Mapping[str, Any] | None,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any] | None]:
        retained: list[dict[str, Any]] = []
        warnings: list[dict[str, Any]] = []
        softened = False
        for blocker in hard_blockers:
            item = dict(blocker)
            if self._factor_model_can_soften_price_gap_blocker(item, low_risk_context):
                softened = True
                warnings.append(
                    {
                        **item,
                        "severity": "WARNING",
                        "label": (low_risk_context or {}).get("label") or item.get("label") or item.get("code"),
                        "message": (low_risk_context or {}).get("summary") or item.get("message") or "",
                        "original_message": item.get("message"),
                        "admission_risk_context": dict(low_risk_context or {}),
                    }
                )
                continue
            retained.append(item)
        return retained, warnings, dict(low_risk_context or {}) if softened and low_risk_context else None

    def _factor_model_factor_strategy_risk(
        self,
        factor_id: str,
        factor: Mapping[str, Any],
    ) -> dict[str, list[dict[str, Any]]]:
        warnings: list[dict[str, Any]] = []
        hard_blockers: list[dict[str, Any]] = []
        lifecycle = str(factor.get("lifecycle_status") or "").upper()
        if lifecycle in {"DEPRECATED", "PRUNED"} or factor.get("offline_at"):
            hard_blockers.append(
                self._normalize_factor_model_risk_item(
                    {
                        "code": "FACTOR_OFFLINE",
                        "message": str(factor.get("offline_reason") or "因子已下线，不能进入策略创建或算力分配。"),
                    },
                    factor_id=factor_id,
                    factor=factor,
                    default_code="FACTOR_OFFLINE",
                    default_message="因子已下线，不能进入策略创建或算力分配。",
                    severity="BLOCKER",
                )
            )
        risk = factor.get("strategy_creation_risk")
        risk_payload = risk if isinstance(risk, Mapping) else {}
        for item in risk_payload.get("warnings") or []:
            warnings.append(
                self._normalize_factor_model_risk_item(
                    item,
                    factor_id=factor_id,
                    factor=factor,
                    default_code="FACTOR_DIAGNOSTIC_WARNING",
                    default_message="因子诊断存在策略创建风险提示。",
                    severity="WARNING",
                )
            )
        for item in risk_payload.get("hard_blockers") or []:
            hard_blockers.append(
                self._normalize_factor_model_risk_item(
                    item,
                    factor_id=factor_id,
                    factor=factor,
                    default_code="FACTOR_HARD_BLOCKER",
                    default_message="因子存在不可回放或 PIT 门禁硬阻断。",
                    severity="BLOCKER",
                )
            )
        if risk_payload and int(_coerce_float(risk_payload.get("warning_count"), 0.0)) > 0 and not warnings:
            warnings.append(
                self._normalize_factor_model_risk_item(
                    {},
                    factor_id=factor_id,
                    factor=factor,
                    default_code="FACTOR_DIAGNOSTIC_WARNING",
                    default_message="因子诊断存在策略创建风险提示。",
                    severity="WARNING",
                )
            )
        if risk_payload and (
            int(_coerce_float(risk_payload.get("blocked_count"), 0.0)) > 0
            or risk_payload.get("can_create") is False
        ) and not hard_blockers:
            hard_blockers.append(
                self._normalize_factor_model_risk_item(
                    {},
                    factor_id=factor_id,
                    factor=factor,
                    default_code="FACTOR_HARD_BLOCKER",
                    default_message="因子存在硬阻断，不能进入策略创建。",
                    severity="BLOCKER",
                )
            )

        diagnostic_status = str(factor.get("diagnostic_status") or "").upper()
        default_hard = diagnostic_status.startswith("BLOCKED")
        readiness_blockers = [
            blocker
            for blocker in factor.get("readiness_blockers") or []
            if isinstance(blocker, Mapping)
        ]
        for blocker in readiness_blockers:
            normalized = self._normalize_factor_model_risk_item(
                blocker,
                factor_id=factor_id,
                factor=factor,
                default_code=str(blocker.get("code") or diagnostic_status or "FACTOR_READINESS_BLOCKER"),
                default_message="因子数据门禁存在未处理事项。",
                severity="BLOCKER" if default_hard else "WARNING",
            )
            if self._factor_model_is_hard_blocker(normalized, default_hard=default_hard):
                hard_blockers.append(normalized)
            else:
                warnings.append(normalized)
        if default_hard and not readiness_blockers and not hard_blockers:
            hard_blockers.append(
                self._normalize_factor_model_risk_item(
                    {},
                    factor_id=factor_id,
                    factor=factor,
                    default_code=diagnostic_status or "FACTOR_BLOCKED",
                    default_message="因子数据门禁处于阻断状态。",
                    severity="BLOCKER",
                )
            )

        correlation_cluster = factor.get("correlation_cluster")
        nodes = correlation_cluster.get("nodes") if isinstance(correlation_cluster, Mapping) else []
        high_correlation_nodes = [
            node
            for node in nodes or []
            if isinstance(node, Mapping)
            and (
                str(node.get("risk_label") or "") == "高相关"
                or _coerce_float(node.get("correlation"), 0.0) >= 0.72
            )
        ]
        if high_correlation_nodes:
            warnings.append(
                self._normalize_factor_model_risk_item(
                    {
                        "code": "HIGH_CORRELATION",
                        "message": f"{factor.get('name') or factor_id} 与 {len(high_correlation_nodes)} 个因子高相关，仅作为策略创建风险提示。",
                        "related_factor_ids": [
                            str(node.get("factor_id") or "")
                            for node in high_correlation_nodes
                            if str(node.get("factor_id") or "")
                        ],
                    },
                    factor_id=factor_id,
                    factor=factor,
                    default_code="HIGH_CORRELATION",
                    default_message="因子与已选或同族因子高相关，仅提示风险。",
                    severity="WARNING",
                )
            )

        return {
            "warnings": self._dedupe_factor_model_risk_items(warnings),
            "hard_blockers": self._dedupe_factor_model_risk_items(hard_blockers),
        }

    def _factor_model_strategy_creation_risk_summary(
        self,
        *,
        warning_count: int,
        blocked_count: int,
        low_risk_context: Mapping[str, Any] | None = None,
    ) -> str:
        if blocked_count:
            return f"存在 {blocked_count} 个硬阻断，需修复 PIT、表达式或行业数据后才能创建策略。"
        if warning_count:
            return f"可创建策略，但存在 {warning_count} 个风险提示；高相关等问题只提示，不阻断创建。"
        return "策略创建风险检查通过，可创建策略。"

    def _build_factor_model_strategy_creation_risk(
        self,
        *,
        factor_warnings: Sequence[Mapping[str, Any]],
        factor_hard_blockers: Sequence[Mapping[str, Any]],
        pit_blockers: Sequence[Mapping[str, Any]],
        neutralization_status: Mapping[str, Any],
        coverage_ratio: float,
        estimated_turnover: float,
        low_risk_context: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        warnings = [dict(item) for item in factor_warnings]
        hard_blockers = [dict(item) for item in factor_hard_blockers]
        for blocker in pit_blockers:
            if not isinstance(blocker, Mapping):
                continue
            factor_id = str(blocker.get("factor_id") or "MODEL")
            normalized = self._normalize_factor_model_risk_item(
                blocker,
                factor_id=factor_id,
                factor={},
                default_code=str(blocker.get("code") or "PIT_BLOCKER"),
                default_message="PIT 数据或表达式门禁阻断策略创建。",
                severity="BLOCKER",
            )
            if self._factor_model_is_hard_blocker(normalized, default_hard=True):
                hard_blockers.append(normalized)
            else:
                warnings.append(normalized)
        for code in neutralization_status.get("blockers") or []:
            hard_blockers.append(
                self._normalize_factor_model_risk_item(
                    {
                        "code": str(code),
                        "message": "启用行业中性化但缺少 PIT 行业字段，不能创建正式可回放策略。",
                    },
                    factor_id="NEUTRALIZATION",
                    factor={"name": "行业中性化"},
                    default_code="MISSING_INDUSTRY_PIT",
                    default_message="启用行业中性化但缺少 PIT 行业字段。",
                    severity="BLOCKER",
                )
            )
        if 0 < coverage_ratio < 0.8:
            warnings.append(
                self._normalize_factor_model_risk_item(
                    {
                        "code": "COVERAGE_EDGE",
                        "message": f"多因子打分覆盖率 {round(coverage_ratio * 100.0, 2)}%，建议复核样本覆盖。",
                    },
                    factor_id="MODEL",
                    factor={"name": "多因子模型"},
                    default_code="COVERAGE_EDGE",
                    default_message="多因子打分覆盖率边缘。",
                    severity="WARNING",
                )
            )
        if estimated_turnover >= 0.55:
            warnings.append(
                self._normalize_factor_model_risk_item(
                    {
                        "code": "TURNOVER_DECAY",
                        "message": f"预估换手 {round(estimated_turnover * 100.0, 2)}%，建议评估换手衰减和交易成本。",
                    },
                    factor_id="MODEL",
                    factor={"name": "多因子模型"},
                    default_code="TURNOVER_DECAY",
                    default_message="预估换手偏高。",
                    severity="WARNING",
                )
            )
        hard_blockers = self._dedupe_factor_model_risk_items(hard_blockers)
        hard_blockers, softened_warnings, applied_low_risk_context = self._factor_model_soften_low_risk_price_gap_blockers(
            hard_blockers,
            low_risk_context,
        )
        warnings.extend(softened_warnings)
        warnings = self._dedupe_factor_model_risk_items(warnings)
        summary = self._factor_model_strategy_creation_risk_summary(
            warning_count=len(warnings),
            blocked_count=len(hard_blockers),
        )
        if applied_low_risk_context and not hard_blockers:
            summary = f"{applied_low_risk_context.get('summary')} 已转为创建提示，允许物化多因子策略。"
        return {
            "warning_count": len(warnings),
            "blocked_count": len(hard_blockers),
            "warnings": warnings,
            "hard_blockers": hard_blockers,
            "can_create": not hard_blockers,
            "summary_label": (
                "低风险准入"
                if applied_low_risk_context and not hard_blockers
                else ("阻断" if hard_blockers else ("风险提示" if warnings else "无阻断"))
            ),
            "summary": summary,
            "admission_risk_context": applied_low_risk_context,
        }

    def preview_factor_model(self, request: Any) -> dict[str, Any]:
        payload = dict(_as_mapping(request))
        components = [
            dict(item)
            for item in payload.get("components") or []
            if isinstance(item, Mapping) and str(item.get("factor_id") or "").strip()
        ]
        if not components:
            raise ValueError("Factor model requires at least one factor.")
        factor_items = self.list_factors().get("items", [])
        factor_by_id = {str(item.get("id")): item for item in factor_items}
        total_abs_weight = sum(abs(_coerce_float(item.get("weight"), 0.0)) for item in components)
        if total_abs_weight <= 0:
            raise ValueError("Factor model weights must not all be zero.")
        normalized_weights: list[dict[str, Any]] = []
        pit_blockers: list[dict[str, Any]] = []
        factor_risk_warnings: list[dict[str, Any]] = []
        factor_risk_hard_blockers: list[dict[str, Any]] = []
        for item in components:
            factor_id = str(item.get("factor_id") or "").strip()
            factor = factor_by_id.get(factor_id) or self.get_factor(factor_id)
            weight = _coerce_float(item.get("weight"), 0.0)
            normalized = {
                "factor_id": factor_id,
                "weight": weight,
                "normalized_weight": round(weight / total_abs_weight, 6),
                "direction": str(item.get("direction") or factor.get("direction") or "HIGH_IS_BETTER"),
                "name": factor.get("name"),
                "diagnostic_status": factor.get("diagnostic_status"),
            }
            normalized_weights.append(normalized)
            if str(factor.get("diagnostic_status") or "").startswith("BLOCKED"):
                for blocker in factor.get("readiness_blockers") or []:
                    if isinstance(blocker, Mapping):
                        pit_blockers.append({"factor_id": factor_id, **dict(blocker)})
            factor_risk = self._factor_model_factor_strategy_risk(factor_id, factor)
            factor_risk_warnings.extend(factor_risk["warnings"])
            factor_risk_hard_blockers.extend(factor_risk["hard_blockers"])
            for blocker in factor_risk["hard_blockers"]:
                if str(blocker.get("factor_id") or "") == factor_id:
                    pit_blockers.append(dict(blocker))
        symbols = self._factor_universe_symbols(payload.get("universe"))
        as_of_date = self._factor_preview_as_of(payload)
        neutralization = dict(payload.get("neutralization") or {})
        score_projection = self._factor_model_score_projection(
            normalized_weights,
            factor_by_id,
            symbols,
            as_of_date=as_of_date,
            neutralization=neutralization,
            universe=payload.get("universe"),
        )
        neutralization_result = score_projection["neutralization_result"]
        industry_coverage = (
            dict(score_projection.get("industry_coverage") or {})
            if isinstance(score_projection.get("industry_coverage"), Mapping)
            else {}
        )
        neutralization_status = {
            "enabled": bool(neutralization.get("enabled")),
            "method": str(neutralization.get("method") or "industry"),
            "status": neutralization_result.status,
            "blockers": list(neutralization_result.blockers),
            "industry_field": industry_coverage.get("industry_field") or score_projection.get("industry_field"),
            "taxonomy": industry_coverage.get("taxonomy"),
            "covered_symbol_count": industry_coverage.get("covered_symbol_count"),
            "missing_symbol_count": industry_coverage.get("missing_symbol_count"),
            "source_names": list(industry_coverage.get("source_names") or []),
        }
        score_preview = list(score_projection["score_preview"])
        warnings: list[str] = []
        if neutralization_result.blockers:
            warnings.append("行业中性化需要 PIT 行业字段，本次预览仅返回 blocker，不执行残差化。")
        if not score_preview:
            pit_blockers.append(
                {
                    "code": "NO_FACTOR_SCORE_PREVIEW",
                    "message": "PIT 价格/基础面数据未能产出任何可用的多因子打分样本。",
                    "fix_hash": "#/snapshots",
                }
            )
        pit_blockers = self._dedupe_factor_model_risk_items(pit_blockers)
        low_risk_context = self._factor_model_low_risk_price_gap_context()
        strategy_creation_risk = self._build_factor_model_strategy_creation_risk(
            factor_warnings=factor_risk_warnings,
            factor_hard_blockers=factor_risk_hard_blockers,
            pit_blockers=pit_blockers,
            neutralization_status=neutralization_status,
            coverage_ratio=_coerce_float(score_projection["coverage_ratio"], 0.0),
            estimated_turnover=_coerce_float(score_projection["estimated_turnover"], 0.0),
            low_risk_context=low_risk_context,
        )
        blocked_factor_ids = {
            str(item.get("factor_id"))
            for item in strategy_creation_risk.get("hard_blockers") or []
            if isinstance(item, Mapping) and item.get("factor_id")
        }
        status = "BLOCKED" if strategy_creation_risk["blocked_count"] else "READY"
        return {
            "status": status,
            "normalized_weights": normalized_weights,
            "coverage": {
                "factor_count": len(normalized_weights),
                "ready_factor_count": len(normalized_weights) - len(blocked_factor_ids),
                "universe_symbol_count": len(symbols),
                "estimated_factor_coverage": score_projection["coverage_ratio"],
                "as_of_date": as_of_date,
            },
            "score_preview": score_preview,
            "estimated_turnover": score_projection["estimated_turnover"],
            "pit_blockers": pit_blockers,
            "neutralization_status": neutralization_status,
            "warnings": warnings,
            "strategy_creation_risk": strategy_creation_risk,
        }

    def create_factor_model(self, request: Any) -> dict[str, Any]:
        payload = dict(_as_mapping(request))
        preview = self.preview_factor_model(payload)
        strategy_creation_risk = (
            dict(preview.get("strategy_creation_risk"))
            if isinstance(preview.get("strategy_creation_risk"), Mapping)
            else {}
        )
        neutralization_status = preview.get("neutralization_status") if isinstance(preview.get("neutralization_status"), Mapping) else {}
        hard_blockers = [
            dict(item)
            for item in strategy_creation_risk.get("hard_blockers") or []
            if isinstance(item, Mapping)
        ]
        if hard_blockers and any(str(item.get("code") or "").upper() == "MISSING_INDUSTRY_PIT" for item in hard_blockers):
            raise ValueError("Industry neutralization is enabled but PIT industry fields are missing.")
        if hard_blockers:
            raise ValueError("多因子策略创建风险包含硬阻断，修复后才能物化策略。")
        if neutralization_status.get("blockers"):
            raise ValueError("Industry neutralization is enabled but PIT industry fields are missing.")
        now = iso_now()
        strategy_id = self._new_id("strat")
        neutralization_payload = dict(payload.get("neutralization") or {"enabled": False, "method": "industry"})
        if neutralization_payload.get("enabled"):
            neutralization_payload.update(
                {
                    "industry_field": neutralization_status.get("industry_field"),
                    "taxonomy": neutralization_status.get("taxonomy"),
                    "covered_symbol_count": neutralization_status.get("covered_symbol_count"),
                    "missing_symbol_count": neutralization_status.get("missing_symbol_count"),
                    "source_names": list(neutralization_status.get("source_names") or []),
                    "execution_status": neutralization_status.get("status"),
                }
            )
        parameters = {
            "strategy_type": "MULTI_FACTOR",
            "factor_ids": [str(item.get("factor_id")) for item in payload.get("components") or [] if isinstance(item, Mapping)],
            "weights": {
                str(item.get("factor_id")): _coerce_float(item.get("weight"), 0.0)
                for item in payload.get("components") or []
                if isinstance(item, Mapping)
            },
            "directions": {
                str(item.get("factor_id")): str(item.get("direction") or "HIGH_IS_BETTER")
                for item in payload.get("components") or []
                if isinstance(item, Mapping)
            },
            "neutralization": neutralization_payload,
            "scoring_method": str(payload.get("scoring_method") or "zscore_weighted"),
            "rebalance_frequency": str(payload.get("rebalance_frequency") or "monthly"),
            "pit_snapshot_refs": {
                "dataset_snapshot_id": DATASET_PRICE_SNAPSHOT_ID,
                "fundamental_snapshot_id": "ds-fundamentals",
                "universe_snapshot_id": SP500_UNIVERSE_SNAPSHOT_ID,
            },
            "preview": preview,
            "strategy_creation_risk": strategy_creation_risk,
        }
        strategy_name = str(payload.get("name") or "多因子策略").strip() or "多因子策略"
        strategy_row = {
            "id": strategy_id,
            "name": strategy_name,
            "description": str(payload.get("description") or "基于因子库权重配置创建的多因子策略。"),
            "strategy_type": "MULTI_FACTOR",
            "universe_name": str(payload.get("universe") or "SP500"),
            "rebalance_frequency": parameters["rebalance_frequency"],
            "lifecycle_status": "ACTIVE",
            "dataset_snapshot_id": DATASET_PRICE_SNAPSHOT_ID,
            "universe_snapshot_id": SP500_UNIVERSE_SNAPSHOT_ID,
            "benchmark_symbol": "SPY",
            "current_parameter_version": 1,
            "parameters_json": dumps(parameters),
            "confirmation_fields_json": dumps({}),
            "parameter_history_json": dumps([]),
            "allowed_actions_json": dumps(["run_backtest", "open_strategy_detail", "open_optimization"]),
            "latest_run_id": None,
            "latest_successful_run_id": None,
            "created_at": now,
            "updated_at": now,
        }
        parameter_history = [
            {
                "version_number": 1,
                "parameter_version_id": f"{strategy_id}-v1",
                "revision": 1,
                "created_at": now,
                "comment": "多因子模型创建",
                "source": {"kind": "factor_model_builder"},
                "parameters": parameters,
            }
        ]
        self._write_strategy_record(strategy_row, parameter_history=parameter_history, current_version=1, comment="多因子模型创建")
        return self.get_strategy_detail(strategy_id)

    def _is_multi_factor_strategy(self, strategy: Mapping[str, Any] | None) -> bool:
        if not strategy:
            return False
        parameters = dict(strategy.get("parameters") or {})
        return str(strategy.get("strategy_type") or parameters.get("strategy_type") or "").upper() == "MULTI_FACTOR"

    def _is_multi_factor_parameters(self, parameters: Mapping[str, Any] | None) -> bool:
        if not parameters:
            return False
        return str(parameters.get("strategy_type") or "").upper() == "MULTI_FACTOR" or bool(parameters.get("factor_ids"))

    def _multi_factor_factor_index(self) -> dict[str, dict[str, Any]]:
        factors = self.list_factors().get("items", [])
        return {str(item.get("id")): dict(item) for item in factors if str(item.get("id") or "").strip()}

    def _multi_factor_component_rows(self, parameters: Mapping[str, Any]) -> list[dict[str, Any]]:
        factor_ids = [
            str(item).strip()
            for item in parameters.get("factor_ids") or []
            if str(item).strip()
        ]
        weights = dict(parameters.get("weights") or {})
        directions = dict(parameters.get("directions") or {})
        factor_index = self._multi_factor_factor_index()
        total_abs_weight = sum(abs(_coerce_float(weights.get(factor_id), 0.0)) for factor_id in factor_ids)
        if total_abs_weight <= 0:
            total_abs_weight = float(len(factor_ids) or 1)
        rows: list[dict[str, Any]] = []
        for factor_id in factor_ids:
            factor = factor_index.get(factor_id)
            if factor is None:
                try:
                    factor = dict(self.get_factor(factor_id))
                except Exception:
                    factor = {}
            weight = _coerce_float(weights.get(factor_id), 0.0)
            rows.append(
                {
                    "factor_id": factor_id,
                    "name": factor.get("name") or factor_id,
                    "family": factor.get("category") or factor.get("family") or factor.get("source"),
                    "direction": str(directions.get(factor_id) or factor.get("direction") or "HIGH_IS_BETTER"),
                    "weight": weight,
                    "normalized_weight": round(weight / total_abs_weight, 6),
                    "diagnostic_status": factor.get("diagnostic_status"),
                    "pit_coverage": dict(factor.get("pit_coverage") or factor.get("coverage") or {}),
                    "readiness_blockers": list(factor.get("readiness_blockers") or []),
                }
            )
        return rows

    def _multi_factor_neutralization_view(self, parameters: Mapping[str, Any]) -> dict[str, Any]:
        neutralization = dict(parameters.get("neutralization") or {})
        enabled = bool(neutralization.get("enabled"))
        method = str(neutralization.get("method") or "industry")
        status_payload = {}
        preview = parameters.get("preview")
        if isinstance(preview, Mapping) and isinstance(preview.get("neutralization_status"), Mapping):
            status_payload = dict(preview.get("neutralization_status") or {})
        if status_payload and bool(status_payload.get("enabled")) != enabled:
            status_payload = {}
        if not status_payload:
            result = neutralize_by_industry(
                {
                    row["factor_id"]: row["normalized_weight"]
                    for row in self._multi_factor_component_rows(parameters)
                },
                enabled=enabled,
                industry_by_symbol=None,
            )
            status_payload = {
                "enabled": enabled,
                "method": method,
                "status": result.status,
                "blockers": list(result.blockers),
            }
        blockers = list(status_payload.get("blockers") or [])
        execution_status = str(status_payload.get("status") or ("DISABLED" if not enabled else "UNKNOWN"))
        blocker_reason = None
        if blockers:
            blocker_reason = "缺少 PIT 行业字段，行业中性化未执行。" if "MISSING_INDUSTRY_PIT" in blockers else "行业中性化条件未满足。"
        return {
            "enabled": enabled,
            "method": method,
            "industry_field": status_payload.get("industry_field") or neutralization.get("industry_field"),
            "taxonomy": status_payload.get("taxonomy") or neutralization.get("taxonomy"),
            "covered_symbol_count": status_payload.get("covered_symbol_count") if status_payload.get("covered_symbol_count") is not None else neutralization.get("covered_symbol_count"),
            "missing_symbol_count": status_payload.get("missing_symbol_count") if status_payload.get("missing_symbol_count") is not None else neutralization.get("missing_symbol_count"),
            "source_names": list(status_payload.get("source_names") or neutralization.get("source_names") or []),
            "execution_status": execution_status,
            "blocker_reason": blocker_reason,
            "blockers": blockers,
        }

    def _build_multi_factor_profile_from_parameters(self, parameters: Mapping[str, Any]) -> dict[str, Any]:
        components = self._multi_factor_component_rows(parameters)
        preview = parameters.get("preview") if isinstance(parameters.get("preview"), Mapping) else {}
        coverage = dict(preview.get("coverage") or {}) if isinstance(preview, Mapping) else {}
        ready_count = sum(1 for row in components if not str(row.get("diagnostic_status") or "").startswith("BLOCKED"))
        coverage_summary = {
            "factor_count": len(components),
            "ready_factor_count": coverage.get("ready_factor_count", ready_count),
            "coverage_pct": round(_coerce_float(coverage.get("estimated_factor_coverage"), 1.0 if components else 0.0) * 100.0, 2),
            "universe_symbol_count": coverage.get("universe_symbol_count"),
        }
        return {
            "components": components,
            "neutralization": self._multi_factor_neutralization_view(parameters),
            "scoring_method": str(parameters.get("scoring_method") or "zscore_weighted"),
            "rebalance_frequency": str(parameters.get("rebalance_frequency") or "monthly"),
            "pit_snapshot_refs": dict(parameters.get("pit_snapshot_refs") or {}),
            "coverage_summary": coverage_summary,
        }

    def _build_multi_factor_profile(self, strategy: Mapping[str, Any]) -> dict[str, Any] | None:
        if not self._is_multi_factor_strategy(strategy):
            return None
        return self._build_multi_factor_profile_from_parameters(dict(strategy.get("parameters") or {}))

    def _build_multi_factor_precheck_from_parameters(self, parameters: Mapping[str, Any]) -> dict[str, Any] | None:
        if not self._is_multi_factor_parameters(parameters):
            return None
        profile = self._build_multi_factor_profile_from_parameters(parameters)
        blocked_factors: list[dict[str, Any]] = []
        for row in profile.get("components") or []:
            status = str(row.get("diagnostic_status") or "")
            blockers = list(row.get("readiness_blockers") or [])
            if status.startswith("BLOCKED"):
                blocked_factors.append(
                    {
                        "factor_id": row.get("factor_id"),
                        "name": row.get("name"),
                        "diagnostic_status": status or None,
                        "reasons": blockers,
                    }
                )
        neutralization = dict(profile.get("neutralization") or {})
        neutralization_blocked = bool(neutralization.get("blockers"))
        warnings = []
        preview = parameters.get("preview") if isinstance(parameters.get("preview"), Mapping) else {}
        if isinstance(preview, Mapping):
            warnings.extend(str(item) for item in preview.get("warnings") or [] if str(item).strip())
        for row in profile.get("components") or []:
            status = str(row.get("diagnostic_status") or "")
            blockers = list(row.get("readiness_blockers") or [])
            if blockers and not status.startswith("BLOCKED"):
                warnings.append(f"{row.get('name') or row.get('factor_id')} 仍有诊断提示，请结合 PIT 覆盖继续复核。")
        if neutralization_blocked:
            warnings.append("行业中性化需要 PIT 行业字段，当前不会执行中性化。")
        status = "BLOCKED" if blocked_factors or neutralization_blocked else ("WARN" if warnings else "PASS")
        coverage_summary = dict(profile.get("coverage_summary") or {})
        estimated_turnover = None
        if isinstance(preview, Mapping) and preview.get("estimated_turnover") is not None:
            estimated_turnover = round(_coerce_float(preview.get("estimated_turnover"), 0.0) * 100.0, 2)
        else:
            estimated_turnover = round(18.0 + len(profile.get("components") or []) * 1.5, 2)
        return {
            "status": status,
            "factor_count": int(coverage_summary.get("factor_count") or len(profile.get("components") or [])),
            "coverage_pct": _coerce_float(coverage_summary.get("coverage_pct"), 0.0),
            "blocked_factors": blocked_factors,
            "neutralization_status": neutralization,
            "estimated_turnover_pct": estimated_turnover,
            "warnings": list(dict.fromkeys(warnings)),
        }

    def _build_multi_factor_precheck(
        self,
        strategy: Mapping[str, Any],
        request_payload: Mapping[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        if not self._is_multi_factor_strategy(strategy):
            return None
        parameters = dict(
            self._parameter_snapshot_for_version(strategy, (request_payload or {}).get("parameter_version_id"))
            or strategy.get("parameters")
            or {}
        )
        return self._build_multi_factor_precheck_from_parameters(parameters)

    def _build_multi_factor_parameter_ranges(self, strategy: Mapping[str, Any]) -> list[dict[str, Any]]:
        if not self._is_multi_factor_strategy(strategy):
            return []
        parameters = dict(strategy.get("parameters") or {})
        components = self._multi_factor_component_rows(parameters)
        total_abs_weight = sum(abs(_coerce_float(row.get("weight"), 0.0)) for row in components)
        decimal_weight_scale = 0 < total_abs_weight <= 1.000001
        ranges: list[dict[str, Any]] = []
        for row in components[:5]:
            factor_id = str(row.get("factor_id") or "").strip()
            if not factor_id:
                continue
            raw_weight = abs(_coerce_float(row.get("weight"), 0.0))
            current_pct = round(raw_weight * 100.0 if decimal_weight_scale else raw_weight, 2)
            ranges.append(
                {
                    "key": f"factor_weight__{factor_id}_pct",
                    "label": f"因子权重 · {row.get('name') or factor_id}",
                    "mode": "range",
                    "current": current_pct,
                    "start": max(0, current_pct - 10),
                    "end": current_pct + 10,
                    "step": 5,
                }
            )
        neutralization = dict(parameters.get("neutralization") or {})
        ranges.extend(
            [
                {
                    "key": "neutralization_method",
                    "label": "中性化方法",
                    "mode": "fixed",
                    "current": str(neutralization.get("method") or "industry"),
                    "value": str(neutralization.get("method") or "industry"),
                    "values": [str(neutralization.get("method") or "industry")],
                },
                {
                    "key": "scoring_method",
                    "label": "打分方法",
                    "mode": "discrete",
                    "current": str(parameters.get("scoring_method") or "zscore_weighted"),
                    "value": str(parameters.get("scoring_method") or "zscore_weighted"),
                    "values": ["zscore_weighted", "rank_weighted"],
                },
                {
                    "key": "rebalance_frequency",
                    "label": "再平衡频率",
                    "mode": "discrete",
                    "current": str(parameters.get("rebalance_frequency") or "monthly"),
                    "value": str(parameters.get("rebalance_frequency") or "monthly"),
                    "values": ["monthly", "quarterly", "semiannual", "yearly"],
                },
            ]
        )
        return ranges

    def _attach_multi_factor_strategy_views(self, strategy: dict[str, Any]) -> dict[str, Any]:
        profile = self._build_multi_factor_profile(strategy)
        if profile is not None:
            strategy["multi_factor_profile"] = profile
            strategy["multi_factor_parameter_ranges"] = self._build_multi_factor_parameter_ranges(strategy)
        return strategy

    def _build_multi_factor_attribution(self, run: Mapping[str, Any]) -> dict[str, Any] | None:
        preview_payload = dict(run.get("preview") or {})
        parameters = dict(run.get("parameter_snapshot") or preview_payload.get("parameter_snapshot") or {})
        if not self._is_multi_factor_parameters(parameters):
            return None
        profile = self._build_multi_factor_profile_from_parameters(parameters)
        total_return = _coerce_float((run.get("metrics") or {}).get("total_return"), 0.0)
        contributions = []
        for row in profile.get("components") or []:
            contribution = total_return * _coerce_float(row.get("normalized_weight"), 0.0)
            contributions.append(
                {
                    "factor_id": row.get("factor_id"),
                    "name": row.get("name"),
                    "family": row.get("family"),
                    "direction": row.get("direction"),
                    "normalized_weight": row.get("normalized_weight"),
                    "contribution_pct": round(contribution * 100.0, 2),
                    "source": "estimated",
                }
            )
        neutralization = dict(profile.get("neutralization") or {})
        industry_exposures = [
            {"industry": "信息技术", "exposure_pct": 28.0, "source": "estimated"},
            {"industry": "金融", "exposure_pct": 18.0, "source": "estimated"},
            {"industry": "医疗保健", "exposure_pct": 16.0, "source": "estimated"},
        ]
        warnings = ["当前归因基于因子权重、回测参数快照和收益摘要估算，尚非完整逐日 Brinson 归因。"]
        if neutralization.get("blocker_reason"):
            warnings.append(str(neutralization["blocker_reason"]))
        return {
            "summary": {
                "factor_count": len(contributions),
                "top_factor": contributions[0].get("name") if contributions else None,
                "total_return_pct": round(total_return * 100.0, 2),
            },
            "factor_contributions": contributions,
            "industry_exposures": industry_exposures,
            "coverage": dict(profile.get("coverage_summary") or {}),
            "neutralization_status": neutralization,
            "attribution_source": "estimated",
            "warnings": warnings,
        }

    def _attach_multi_factor_run_views(self, run: dict[str, Any]) -> dict[str, Any]:
        attribution = self._build_multi_factor_attribution(run)
        if attribution is None:
            return run
        run["multi_factor_attribution"] = attribution
        preview = dict(run.get("preview") or {})
        parameters = dict(preview.get("parameter_snapshot") or run.get("parameter_snapshot") or {})
        precheck = self._build_multi_factor_precheck_from_parameters(parameters)
        if precheck is not None:
            preview["multi_factor_precheck"] = precheck
            run["preview"] = preview
        analysis = dict(run.get("analysis") or {})
        decision_rail = dict(analysis.get("decision_rail") or {})
        items = list(decision_rail.get("items") or [])
        existing_keys = {str(item.get("key") or "") for item in items if isinstance(item, Mapping)}
        if "multi_factor_attribution" not in existing_keys:
            source_label = "估算归因" if attribution.get("attribution_source") == "estimated" else "完整归因"
            items.append(
                {
                    "key": "multi_factor_attribution",
                    "title": "因子归因",
                    "body": f"{source_label}覆盖 {len(attribution.get('factor_contributions') or [])} 个因子，需结合覆盖缺口判断贡献稳定性。",
                    "tone": "neutral",
                }
            )
        if "multi_factor_industry_exposure" not in existing_keys:
            neutralization = dict(attribution.get("neutralization_status") or {})
            body = (
                str(neutralization.get("blocker_reason"))
                if neutralization.get("blocker_reason")
                else "行业暴露已进入评估侧栏；仅在存在 PIT 行业字段与执行证据时才视为完成中性化。"
            )
            items.append(
                {
                    "key": "multi_factor_industry_exposure",
                    "title": "行业暴露",
                    "body": body,
                    "tone": "blue",
                }
            )
        decision_rail["items"] = items
        analysis["decision_rail"] = decision_rail
        run["analysis"] = analysis
        return run

    def _primary_market_data_provider(self) -> Any:
        return self.market_data_provider or YahooMarketDataProvider()

    def _provider_name(self, provider: Any) -> str:
        return str(getattr(provider, "provider_name", provider.__class__.__name__)).strip().lower()

    def _provider_is_current_window_enhancer(self, provider_name: str) -> bool:
        normalized = str(provider_name or "").strip().lower()
        return normalized in {"longbridge", "longbridge_static_info", "futu", "futu_rehab"} or normalized.startswith("futu")

    def _provider_access_tier(self, provider_or_name: Any) -> str:
        return provider_access_tier(provider_or_name)

    def _paid_optional_provider_names(self) -> set[str]:
        provider = self._primary_market_data_provider()
        provider_names = {
            self._provider_name(candidate)
            for candidate in (getattr(provider, "providers", None) or [])
        }
        return {
            provider_name
            for provider_name in provider_names
            if self._provider_access_tier(provider_name) == "paid_optional"
        }

    def _provider_retry_exclusions(self, *snapshots: Mapping[str, Any] | None) -> set[str]:
        now = datetime.now(timezone.utc)
        excluded: set[str] = set()
        for snapshot in snapshots:
            metadata = dict((snapshot or {}).get("metadata") or {})
            provider_summary = dict(metadata.get("provider_summary") or {})
            providers = dict(provider_summary.get("providers") or {})
            for provider_name, provider_payload in providers.items():
                if not isinstance(provider_payload, Mapping):
                    continue
                retry_at = self._parse_snapshot_timestamp(provider_payload.get("next_retry_at"))
                if retry_at is not None and retry_at > now:
                    excluded.add(str(provider_name).strip().lower())
        return excluded

    def _scoped_market_data_provider(
        self,
        *,
        mode: str,
        window_start: date,
        allow_targeted_price_repair: bool = False,
        extra_excluded_provider_names: Sequence[str] | None = None,
    ) -> Any:
        provider = self._primary_market_data_provider()
        scoped_copy = getattr(provider, "scoped_copy", None)
        if not callable(scoped_copy):
            return provider
        excluded: set[str] = {
            str(name or "").strip().lower()
            for name in (extra_excluded_provider_names or [])
            if str(name or "").strip()
        }
        if mode == "full":
            excluded.update({"longbridge", "longbridge_static_info", "futu", "futu_rehab"})
        if mode == "incremental" and any(
            self._provider_name(candidate) == "stooq"
            for candidate in (getattr(provider, "providers", None) or [])
        ):
            excluded.add("stooq")
        if mode != "repair":
            excluded.add("tiingo")
            provider_names = {
                self._provider_name(candidate)
                for candidate in (getattr(provider, "providers", None) or [])
            }
            excluded.update({"openbb_tiingo", "openbb_alpha_vantage"} & provider_names)
        if str(os.getenv("GRIT_ENABLE_PAID_OPTIONAL_PROVIDERS") or "").strip().lower() not in {"1", "true", "yes", "on"}:
            excluded.update(self._paid_optional_provider_names())
        if window_start < LONGBRIDGE_MIN_HISTORY_DATE:
            excluded.update({"longbridge", "longbridge_static_info"})
        if not excluded and not allow_targeted_price_repair:
            return provider
        if allow_targeted_price_repair:
            return scoped_copy(
                exclude_provider_names=excluded,
                allow_targeted_price_repair=True,
            )
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

    def _enrich_sp500_industry_metadata(
        self,
        snapshots: Sequence[UniverseMembershipSnapshot],
    ) -> list[UniverseMembershipSnapshot]:
        sp500_snapshots = [
            snapshot
            for snapshot in snapshots
            if str(snapshot.universe_key or "").strip().lower() == SP500_UNIVERSE_KEY
        ]
        if not sp500_snapshots:
            return list(snapshots)
        try:
            definition = UniverseDefinition(
                universe_key=SP500_UNIVERSE_KEY,
                display_name=SP500_UNIVERSE_NAME,
                snapshot_id=SP500_UNIVERSE_SNAPSHOT_ID,
                source_page_title="List of S&P 500 companies",
                minimum_member_count=400,
            )
            enricher = CurrentIndustryMetadataUniverseEnricher(
                metadata_provider=GithubSp500CurrentValidationProvider(definition=definition)
            )
            return enricher.enrich_snapshots(snapshots)
        except Exception:
            return list(snapshots)

    def _openbb_current_constituent_check(self, snapshot: UniverseMembershipSnapshot) -> dict[str, Any] | None:
        checker = getattr(self.market_data_provider, "current_universe_constituent_checker", None)
        check_current_constituents = getattr(checker, "check_current_constituents", None)
        if not callable(check_current_constituents):
            return None
        try:
            payload = check_current_constituents(
                universe_key=snapshot.universe_key,
                universe_name=snapshot.universe_name,
                symbols=snapshot.normalized_symbols,
            )
        except Exception as exc:
            return {
                "provider": str(getattr(checker, "provider_name", "openbb_index_constituents")),
                "status": "failed",
                "reason": str(exc),
                "checked_at": iso_now(),
                "auxiliary_only": True,
            }
        if not isinstance(payload, Mapping):
            return None
        check = dict(payload)
        check.setdefault("provider", str(getattr(checker, "provider_name", "openbb_index_constituents")))
        check.setdefault("auxiliary_only", True)
        return check

    def _annotate_openbb_current_constituent_check(
        self,
        snapshots: Sequence[UniverseMembershipSnapshot],
    ) -> list[UniverseMembershipSnapshot]:
        items = list(snapshots or [])
        if not items:
            return items
        latest_index = max(range(len(items)), key=lambda index: items[index].effective_date)
        latest_snapshot = items[latest_index]
        latest_metadata = dict(latest_snapshot.metadata or {})
        if "openbb_current_constituent_check" in latest_metadata:
            return items
        check = self._openbb_current_constituent_check(latest_snapshot)
        if not check:
            return items
        latest_metadata["openbb_current_constituent_check"] = check
        items[latest_index] = replace(latest_snapshot, metadata=latest_metadata)
        return items

    def _bond_fixed_income_provider(self) -> Any:
        provider = getattr(self.market_data_provider, "bond_fixed_income_provider", None)
        return provider or fetch_official_bond_fixed_income_snapshots

    def _refresh_bond_fixed_income_snapshots(self, *, as_of: str | None = None) -> dict[str, Any]:
        as_of_date = date.today()
        if as_of:
            try:
                as_of_date = date.fromisoformat(str(as_of)[:10])
            except ValueError:
                as_of_date = date.today()
        provider = self._bond_fixed_income_provider()
        fetch_snapshots = getattr(provider, "fetch_snapshots", None)
        if callable(fetch_snapshots):
            try:
                result = fetch_snapshots(as_of_date=as_of_date)
            except TypeError:
                result = fetch_snapshots(as_of_date)
        elif callable(provider):
            try:
                result = provider(today=as_of_date)
            except TypeError:
                result = provider(as_of_date)
        else:
            return {
                "status": "FAILED",
                "updated_row_count": 0,
                "instrument_count": 0,
                "ready_count": 0,
                "watch_count": 0,
                "warnings": [],
                "errors": ["Bond fixed-income provider does not implement fetch_snapshots."],
                "provider_results": [],
            }

        if isinstance(result, Mapping):
            snapshots = [dict(item) for item in (result.get("snapshots") or []) if isinstance(item, Mapping)]
            warnings = [str(item) for item in (result.get("warnings") or []) if item]
            errors = [str(item) for item in (result.get("errors") or []) if item]
            provider_results = [dict(item) for item in (result.get("provider_results") or []) if isinstance(item, Mapping)]
            telemetry = dict(result.get("telemetry") or {})
        else:
            snapshots = [dict(item) for item in (getattr(result, "snapshots", []) or []) if isinstance(item, Mapping)]
            warnings = [str(item) for item in (getattr(result, "warnings", []) or []) if item]
            errors = [str(item) for item in (getattr(result, "errors", []) or []) if item]
            provider_results = [
                dict(item)
                for item in (getattr(result, "provider_results", []) or [])
                if isinstance(item, Mapping)
            ]
            telemetry = dict(getattr(result, "telemetry", {}) or {})

        persisted_ids: list[str] = []
        for snapshot in snapshots:
            try:
                raw_payload = snapshot.get("raw")
                profile = str((raw_payload if isinstance(raw_payload, Mapping) else {}).get("audit_profile") or "").upper()
                if profile == "UST_CMT_30Y":
                    previous_snapshot = self.market_data_repository.get_bond_fixed_income_snapshot(
                        str(snapshot.get("source_snapshot_id") or snapshot.get("id") or snapshot.get("instrument_id") or "")
                    )
                    previous_ytm = _coerce_float((previous_snapshot or {}).get("ytm_pct"), 0.0)
                    current_ytm = _coerce_float(snapshot.get("ytm_pct"), 0.0)
                    if previous_ytm > 0 and current_ytm > 0:
                        jump_bps = round((current_ytm - previous_ytm) * 100.0, 4)
                        raw = dict(raw_payload) if isinstance(raw_payload, Mapping) else {}
                        raw["ytm_jump_bps"] = jump_bps
                        raw["ytm_jump_threshold_bps"] = 50.0
                        if abs(jump_bps) > 50.0:
                            raw["audit_alerts"] = [
                                *[str(item) for item in (raw.get("audit_alerts") or []) if str(item).strip()],
                                f"UST_CMT_30Y YTM jump {jump_bps:g} bps exceeds the 50 bps alert threshold.",
                            ]
                        snapshot["raw"] = raw
                persisted_ids.append(self.market_data_repository.upsert_bond_fixed_income_snapshot(snapshot))
            except Exception as exc:
                instrument_id = str(snapshot.get("instrument_id") or snapshot.get("id") or "unknown")
                errors.append(f"{instrument_id}: failed to persist bond fixed-income snapshot: {exc}")

        ready_count = len([row for row in snapshots if str(row.get("refresh_status") or "").upper() == "READY"])
        watch_count = len([row for row in snapshots if str(row.get("refresh_status") or "").upper() == "WATCH"])
        instrument_count = len({str(row.get("instrument_id") or "") for row in snapshots if row.get("instrument_id")})
        status = (
            "FAILED"
            if errors and not persisted_ids
            else ("WATCH" if errors or watch_count or instrument_count < 7 else "READY")
        )
        return {
            "status": status,
            "updated_row_count": len(persisted_ids),
            "instrument_count": instrument_count,
            "ready_count": ready_count,
            "watch_count": watch_count,
            "warnings": warnings,
            "errors": errors,
            "provider_results": provider_results,
            "telemetry": telemetry,
        }

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
                raise ValueError("Snapshot refresh targets must be a list of price, corporate, valuations, universes, or bond.") from exc

        allowed_targets = {"price", "corporate", "valuations", "universes", "bond"}
        cleaned_targets = [item.strip().lower() for item in normalized_targets if item.strip().lower() in allowed_targets]
        if normalized_targets and not cleaned_targets:
            raise ValueError("Snapshot refresh targets must include price, corporate, valuations, universes, or bond.")
        if not cleaned_targets:
            cleaned_targets = ["price", "corporate", "valuations", "universes", "bond"]
        elif "bond" not in cleaned_targets and mode != "repair":
            cleaned_targets = ["price", "corporate", "valuations", "universes", "bond"]
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

    def _asset_allocation_symbols_from_parameters(self, parameters: Mapping[str, Any] | None) -> list[str]:
        raw_assets = _as_mapping(parameters).get("allocation_assets")
        if not isinstance(raw_assets, Sequence) or isinstance(raw_assets, (str, bytes)):
            return []
        symbols: list[str] = []
        for asset in raw_assets:
            raw_symbol = asset.get("symbol") if isinstance(asset, Mapping) else asset
            symbol = self._normalize_refresh_symbol(raw_symbol)
            if symbol and symbol not in symbols:
                symbols.append(symbol)
        return symbols

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
        if str(strategy.get("strategy_type") or "").upper() == "ASSET_ALLOCATION":
            return None
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
            {
                "id": DATASET_INDEX_VALUATIONS_SNAPSHOT_ID,
                "name": "\u6307\u6570\u4f30\u503c\u6570\u636e",
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
                    "message": "\u8bf7\u5148\u5237\u65b0\u5feb\u7167\uff0c\u518d\u67e5\u770b\u6307\u6570\u4f30\u503c\u6570\u636e\u3002",
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

    @staticmethod
    def _coerce_positive_int(value: Any) -> int | None:
        if isinstance(value, bool):
            return None
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return None
        return parsed if parsed > 0 else None

    @staticmethod
    def _parse_snapshot_date(value: Any) -> date | None:
        text = str(value or "").strip()
        if not text:
            return None
        try:
            return date.fromisoformat(text[:10])
        except ValueError:
            return None

    def _canonical_anchor_count_for_window(self, *, window_start: Any, window_end: Any) -> int | None:
        start = self._parse_snapshot_date(window_start)
        end = self._parse_snapshot_date(window_end)
        if start is None or end is None or end < start:
            return None
        count = len(semiannual_anchor_dates(start, end))
        return count or None

    def _normalize_universe_progress_metadata(
        self,
        metadata: Mapping[str, Any],
        *,
        window_start: Any,
        window_end: Any,
    ) -> dict[str, Any]:
        normalized = dict(metadata or {})
        canonical_count = self._canonical_anchor_count_for_window(window_start=window_start, window_end=window_end)
        raw_anchor_count = self._coerce_positive_int(normalized.get("anchor_count"))
        historical_count = self._coerce_positive_int(normalized.get("historical_anchor_count"))
        if (
            canonical_count is None
            or raw_anchor_count is None
            or historical_count is None
            or raw_anchor_count <= canonical_count
            or historical_count > canonical_count
        ):
            return normalized

        normalized.setdefault("raw_anchor_count", raw_anchor_count)
        normalized["anchor_count"] = canonical_count
        normalized["historical_anchor_count"] = historical_count
        normalized["fallback_anchor_count"] = max(0, canonical_count - historical_count)
        normalized["ignored_off_schedule_anchor_count"] = max(0, raw_anchor_count - canonical_count)
        return normalized

    def _format_universe_snapshot(self, item: Mapping[str, Any] | None, defaults: Mapping[str, Any]) -> dict[str, Any]:
        merged = {**defaults, **dict(item or {})}
        metadata = self._normalize_universe_progress_metadata(
            dict(merged.get("metadata") or {}),
            window_start=merged.get("window_start"),
            window_end=merged.get("window_end"),
        )
        status = str(merged.get("status") or "INCOMPLETE").upper()
        blocker = dict(merged.get("blocker") or {})
        anchor_count = self._coerce_positive_int(metadata.get("anchor_count"))
        historical_count = self._coerce_positive_int(metadata.get("historical_anchor_count"))
        if (
            anchor_count is not None
            and historical_count is not None
            and historical_count >= anchor_count
            and status in {"INCOMPLETE", "STALE"}
            and str(blocker.get("code") or "") in {"", "UNIVERSE_HISTORY_INCOMPLETE"}
        ):
            status = "READY"
            blocker = {}
            if str(merged.get("freshness_label") or "").startswith("Historical anchors are still being repaired"):
                merged["freshness_label"] = "Historical anchors are complete"
        return {
            "id": merged["id"],
            "name": merged["name"],
            "status": status,
            "as_of": merged.get("as_of"),
            "freshness_label": merged.get("freshness_label"),
            "window_start": merged.get("window_start"),
            "window_end": merged.get("window_end"),
            "anchor_schedule": merged.get("anchor_schedule") or ANCHOR_SCHEDULE,
            "member_count": int(merged.get("member_count") or 0),
            "source": str(merged.get("source") or ""),
            "fallback_source": merged.get("fallback_source"),
            "blocker": blocker,
            "metadata": metadata,
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
        missing_symbols = self._normalize_refresh_symbols(raw_symbols)
        snapshot_id = str((snapshot or {}).get("id") or (snapshot or {}).get("snapshot_id") or "").strip()
        if not snapshot_id or not missing_symbols:
            return missing_symbols
        if snapshot_id not in {DATASET_PRICE_SNAPSHOT_ID, DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID}:
            return missing_symbols
        try:
            coverage_rows = self.market_data_repository.load_dataset_symbol_coverage(snapshot_id)
        except Exception:
            coverage_rows = []
        covered_symbols = {
            str(row.get("symbol") or "").strip().upper()
            for row in coverage_rows
            if str(row.get("symbol") or "").strip()
        }
        if not covered_symbols:
            return missing_symbols
        return [symbol for symbol in missing_symbols if symbol not in covered_symbols]

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

    def _snapshot_id_for_universe_key(self, universe_key: str) -> str | None:
        normalized_key = str(universe_key or "").strip().lower()
        if normalized_key == SP500_UNIVERSE_KEY:
            return SP500_UNIVERSE_SNAPSHOT_ID
        if normalized_key == NASDAQ100_UNIVERSE_KEY:
            return NASDAQ100_UNIVERSE_SNAPSHOT_ID
        return None

    def _universe_identity_for_snapshot_id(self, snapshot_id: str) -> tuple[str, str]:
        normalized_snapshot_id = str(snapshot_id or "").strip()
        if normalized_snapshot_id == SP500_UNIVERSE_SNAPSHOT_ID:
            return SP500_UNIVERSE_KEY, SP500_UNIVERSE_NAME
        if normalized_snapshot_id == NASDAQ100_UNIVERSE_SNAPSHOT_ID:
            return NASDAQ100_UNIVERSE_KEY, NASDAQ100_UNIVERSE_NAME
        return normalized_snapshot_id, normalized_snapshot_id

    def _reconstruct_universe_snapshots_from_memberships(
        self,
        *,
        snapshot_id: str,
        memberships: Sequence[Mapping[str, Any]],
    ) -> list[UniverseMembershipSnapshot]:
        if not memberships:
            return []
        grouped_rows: dict[str, list[Mapping[str, Any]]] = {}
        for row in memberships:
            effective_date = str(row.get("effective_date") or "").strip()
            if not effective_date:
                continue
            grouped_rows.setdefault(effective_date, []).append(row)
        universe_key, universe_name = self._universe_identity_for_snapshot_id(snapshot_id)
        snapshots: list[UniverseMembershipSnapshot] = []
        for effective_date in sorted(grouped_rows):
            rows_for_date = sorted(grouped_rows[effective_date], key=lambda item: str(item.get("symbol") or ""))
            first_row = rows_for_date[0]
            normalized_symbols = [
                str(item.get("symbol") or "").strip().upper()
                for item in rows_for_date
                if str(item.get("symbol") or "").strip()
            ]
            raw_symbols = [
                str(item.get("raw_symbol") or item.get("symbol") or "").strip()
                for item in rows_for_date
                if str(item.get("raw_symbol") or item.get("symbol") or "").strip()
            ]
            metadata = dict(first_row.get("metadata") or {})
            snapshots.append(
                UniverseMembershipSnapshot(
                    universe_key=universe_key,
                    universe_name=universe_name,
                    effective_date=date.fromisoformat(effective_date),
                    normalized_symbols=normalized_symbols,
                    raw_symbols=raw_symbols or normalized_symbols,
                    unmapped_symbols=list(metadata.get("unmapped_symbols") or []),
                    source=str(first_row.get("source") or ""),
                    fallback_source=str(first_row.get("fallback_source") or "") or None,
                    source_revision_id=str(metadata.get("source_revision_id") or "") or None,
                    source_page_title=str(metadata.get("source_page_title") or "") or None,
                    metadata=metadata,
                )
            )
        return snapshots

    def _latest_universe_snapshots_from_memberships(
        self,
        existing_universe_memberships: Mapping[str, Sequence[Mapping[str, Any]]],
    ) -> list[UniverseMembershipSnapshot]:
        latest_snapshots: list[UniverseMembershipSnapshot] = []
        for snapshot_id, memberships in existing_universe_memberships.items():
            anchor_snapshots = self._reconstruct_universe_snapshots_from_memberships(
                snapshot_id=snapshot_id,
                memberships=memberships,
            )
            if anchor_snapshots:
                latest_snapshots.append(max(anchor_snapshots, key=lambda item: item.effective_date))
        return latest_snapshots

    def _build_universe_refresh_windows(
        self,
        *,
        mode: str,
        snapshot_window_start: date,
        window_end: date,
        existing_universe_memberships: Mapping[str, Sequence[Mapping[str, Any]]],
    ) -> dict[str, dict[str, Any] | None]:
        all_anchor_dates = semiannual_anchor_dates(snapshot_window_start, window_end)
        windows: dict[str, dict[str, Any] | None] = {}
        for snapshot_id in (SP500_UNIVERSE_SNAPSHOT_ID, NASDAQ100_UNIVERSE_SNAPSHOT_ID):
            if mode != "repair":
                windows[snapshot_id] = {
                    "start_date": snapshot_window_start,
                    "end_date": window_end,
                    "target_anchor_count": len(all_anchor_dates),
                    "total_anchor_count": len(all_anchor_dates),
                }
                continue
            grouped_rows: dict[str, list[Mapping[str, Any]]] = {}
            for row in existing_universe_memberships.get(snapshot_id, []):
                effective_date = str(row.get("effective_date") or "").strip()
                if effective_date:
                    grouped_rows.setdefault(effective_date, []).append(row)
            incomplete_anchors: list[date] = []
            for anchor in all_anchor_dates:
                rows_for_anchor = grouped_rows.get(anchor.isoformat()) or []
                if not rows_for_anchor:
                    incomplete_anchors.append(anchor)
                    continue
                first_row = rows_for_anchor[0]
                quality = str((first_row.get("metadata") or {}).get("source_quality") or "")
                if (not _is_historical_anchor_quality(quality)) or first_row.get("fallback_source"):
                    incomplete_anchors.append(anchor)
            if not incomplete_anchors:
                windows[snapshot_id] = None
                continue
            windows[snapshot_id] = {
                "start_date": min(incomplete_anchors),
                "end_date": max(incomplete_anchors),
                "target_anchor_count": len(incomplete_anchors),
                "total_anchor_count": len(all_anchor_dates),
            }
        return windows

    def _group_universe_snapshots(
        self,
        universe_snapshots: Sequence[UniverseMembershipSnapshot],
    ) -> tuple[dict[str, list[UniverseMembershipSnapshot]], dict[str, list[dict[str, Any]]]]:
        memberships_by_snapshot: dict[str, list[dict[str, Any]]] = {}
        grouped_universe_snapshots: dict[str, list[UniverseMembershipSnapshot]] = {}
        for snapshot in universe_snapshots:
            snapshot_id = self._snapshot_id_for_universe_key(str(snapshot.universe_key or ""))
            if not snapshot_id:
                continue
            grouped_universe_snapshots.setdefault(snapshot_id, [])
            grouped_universe_snapshots[snapshot_id].append(snapshot)
            memberships_by_snapshot.setdefault(snapshot_id, [])
            for symbol in snapshot.normalized_symbols:
                symbol_metadata = {}
                if isinstance(getattr(snapshot, "symbol_metadata", None), Mapping):
                    raw_metadata = snapshot.symbol_metadata.get(symbol) or {}
                    if isinstance(raw_metadata, Mapping):
                        symbol_metadata = dict(raw_metadata)
                memberships_by_snapshot[snapshot_id].append(
                    {
                        "effective_date": snapshot.effective_date.isoformat(),
                        "symbol": symbol,
                        "raw_symbol": symbol,
                        "membership_status": "ACTIVE",
                        "source": snapshot.source,
                        "fallback_source": snapshot.fallback_source,
                        "metadata": {
                            **dict(snapshot.metadata),
                            **symbol_metadata,
                        },
                    }
                )
        return grouped_universe_snapshots, memberships_by_snapshot

    def _progress_universe_anchor_snapshots(
        self,
        anchor_snapshots: Sequence[UniverseMembershipSnapshot],
        *,
        window_start: date | None = None,
        window_end: date | None = None,
    ) -> tuple[list[UniverseMembershipSnapshot], int]:
        ordered_anchor_snapshots = sorted(anchor_snapshots, key=lambda item: item.effective_date)
        if not ordered_anchor_snapshots:
            return [], 0
        start = window_start or ordered_anchor_snapshots[0].effective_date
        end = window_end or ordered_anchor_snapshots[-1].effective_date
        canonical_dates = set(semiannual_anchor_dates(start, end))
        if not canonical_dates:
            return ordered_anchor_snapshots, 0
        progress_snapshots = [
            item for item in ordered_anchor_snapshots if item.effective_date in canonical_dates
        ]
        if not progress_snapshots:
            return ordered_anchor_snapshots, 0
        progress_dates = {item.effective_date for item in progress_snapshots}
        ignored_dates = {
            item.effective_date
            for item in ordered_anchor_snapshots
            if item.effective_date not in progress_dates
        }
        return progress_snapshots, len(ignored_dates)

    def _persist_grouped_universe_snapshots(
        self,
        *,
        grouped_universe_snapshots: Mapping[str, Sequence[UniverseMembershipSnapshot]],
        memberships_by_snapshot: Mapping[str, Sequence[Mapping[str, Any]]],
        snapshot_window_start: date,
        window_end: date,
        as_of: str,
    ) -> list[str]:
        warnings: list[str] = []
        for snapshot_id, anchor_snapshots in grouped_universe_snapshots.items():
            if not anchor_snapshots:
                continue
            ordered_anchor_snapshots = sorted(anchor_snapshots, key=lambda item: item.effective_date)
            progress_anchor_snapshots, ignored_off_schedule_anchor_count = self._progress_universe_anchor_snapshots(
                ordered_anchor_snapshots,
                window_start=snapshot_window_start,
                window_end=window_end,
            )
            latest_snapshot = ordered_anchor_snapshots[-1]
            latest_progress_snapshot = progress_anchor_snapshots[-1]
            latest_anchor_date = latest_progress_snapshot.effective_date.isoformat()
            source_quality_breakdown: dict[str, int] = {}
            historical_anchor_count = 0
            for item in progress_anchor_snapshots:
                source_quality = str((item.metadata or {}).get("source_quality") or "").lower()
                source_quality_breakdown[source_quality or "unknown"] = (
                    source_quality_breakdown.get(source_quality or "unknown", 0) + 1
                )
                if source_quality in {
                    SOURCE_QUALITY_HISTORICAL_DATASET,
                    SOURCE_QUALITY_WIKIPEDIA_REVISION,
                    SOURCE_QUALITY_OFFICIAL_ANNOUNCEMENT,
                    "historical_revision_snapshot",
                    "historical_constituent_api",
                } and not item.fallback_source:
                    historical_anchor_count += 1
            total_anchor_count = len(progress_anchor_snapshots)
            latest_members = [
                row
                for row in memberships_by_snapshot.get(snapshot_id, [])
                if str(row.get("effective_date")) == latest_snapshot.effective_date.isoformat()
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
                    "as_of": as_of,
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
                        **dict(latest_snapshot.metadata),
                        "source_page_title": latest_snapshot.source_page_title,
                        "source_revision_id": latest_snapshot.source_revision_id,
                        "latest_anchor_date": latest_anchor_date,
                        "anchor_count": total_anchor_count,
                        "historical_anchor_count": historical_anchor_count,
                        "fallback_anchor_count": total_anchor_count - historical_anchor_count,
                        "ignored_off_schedule_anchor_count": ignored_off_schedule_anchor_count,
                        "historical_constituent_provider": (latest_snapshot.metadata or {}).get("historical_constituent_provider"),
                        "historical_constituent_probe_status": (latest_snapshot.metadata or {}).get("historical_constituent_probe_status"),
                        "source_quality_breakdown": source_quality_breakdown,
                        "source_names": source_names,
                        "fallback_sources": fallback_sources,
                    },
                },
                memberships=memberships_by_snapshot.get(snapshot_id, []),
            )
        return warnings

    def _run_universe_refresh_phase(
        self,
        *,
        mode: str,
        snapshot_window_start: date,
        window_end: date,
        started_at: str,
        existing_universe_memberships: Mapping[str, Sequence[Mapping[str, Any]]],
        emit_heartbeat: Callable[..., None],
    ) -> tuple[dict[str, list[UniverseMembershipSnapshot]], dict[str, list[dict[str, Any]]], list[str]]:
        grouped_universe_snapshots: dict[str, list[UniverseMembershipSnapshot]] = {}
        memberships_by_snapshot: dict[str, list[dict[str, Any]]] = {}
        warnings: list[str] = []
        providers = list(self._universe_history_providers())
        refresh_windows = self._build_universe_refresh_windows(
            mode=mode,
            snapshot_window_start=snapshot_window_start,
            window_end=window_end,
            existing_universe_memberships=existing_universe_memberships,
        )
        total_universe_count = len([item for item in refresh_windows.values() if item is not None]) or len(refresh_windows)
        for index, provider in enumerate(providers, start=1):
            definition = getattr(provider, "definition", None)
            universe_key = str(getattr(definition, "universe_key", "") or "")
            display_name = str(
                getattr(definition, "display_name", "") or getattr(provider, "provider_name", "股票池快照")
            )
            snapshot_id = self._snapshot_id_for_universe_key(universe_key)
            targeted_windows: dict[str, dict[str, Any]] = {}
            if snapshot_id:
                window = refresh_windows.get(snapshot_id)
                if window is not None:
                    targeted_windows[snapshot_id] = dict(window)
            else:
                targeted_windows = {
                    current_snapshot_id: dict(window)
                    for current_snapshot_id, window in refresh_windows.items()
                    if window is not None
                }
            if not targeted_windows:
                if snapshot_id:
                    existing_snapshots = self._reconstruct_universe_snapshots_from_memberships(
                        snapshot_id=snapshot_id,
                        memberships=existing_universe_memberships.get(snapshot_id, []),
                    )
                    enriched_snapshots = self._enrich_sp500_industry_metadata(existing_snapshots)
                    _, enriched_memberships = self._group_universe_snapshots(enriched_snapshots)
                    if enriched_memberships.get(snapshot_id):
                        grouped_universe_snapshots[snapshot_id] = enriched_snapshots
                        memberships_by_snapshot[snapshot_id] = enriched_memberships[snapshot_id]
                        warnings.extend(
                            self._persist_grouped_universe_snapshots(
                                grouped_universe_snapshots={snapshot_id: enriched_snapshots},
                                memberships_by_snapshot={snapshot_id: memberships_by_snapshot[snapshot_id]},
                                snapshot_window_start=snapshot_window_start,
                                window_end=window_end,
                                as_of=started_at,
                            )
                        )
                emit_heartbeat(
                    current_stage="universe_snapshots",
                    current_stage_label=f"刷新股票池快照 · {display_name}",
                    force=True,
                    progress={
                        "phase": "universe_snapshots",
                        "provider": str(getattr(provider, "provider_name", provider.__class__.__name__)),
                        "completed_universes": index,
                        "total_universes": max(1, total_universe_count),
                        "target_anchor_count": 0,
                        "total_anchor_count": len(semiannual_anchor_dates(snapshot_window_start, window_end)),
                        "status": "already_historical",
                    },
                )
                continue

            if snapshot_id and len(targeted_windows) == 1:
                load_start = next(iter(targeted_windows.values()))["start_date"]
                load_end = next(iter(targeted_windows.values()))["end_date"]
            else:
                load_start = min(window["start_date"] for window in targeted_windows.values())
                load_end = max(window["end_date"] for window in targeted_windows.values())

            emit_heartbeat(
                current_stage="universe_provider",
                current_stage_label=f"刷新股票池快照 · {display_name}",
                force=True,
                progress={
                    "phase": "universe_provider",
                    "provider": str(getattr(provider, "provider_name", provider.__class__.__name__)),
                    "completed_universes": index - 1,
                    "total_universes": max(1, total_universe_count),
                    "target_anchor_count": sum(int(window.get("target_anchor_count") or 0) for window in targeted_windows.values()),
                    "total_anchor_count": sum(int(window.get("total_anchor_count") or 0) for window in targeted_windows.values()),
                    "window_start": str(load_start),
                    "window_end": str(load_end),
                },
            )
            provider_snapshots = list(provider.load_snapshots(load_start, load_end))
            provider_grouped_snapshots, _ = self._group_universe_snapshots(provider_snapshots)

            for current_snapshot_id, window in targeted_windows.items():
                provider_specific_snapshots = provider_grouped_snapshots.get(current_snapshot_id, [])
                if mode == "repair":
                    merged_by_date = {
                        item.effective_date: item
                        for item in self._reconstruct_universe_snapshots_from_memberships(
                            snapshot_id=current_snapshot_id,
                            memberships=existing_universe_memberships.get(current_snapshot_id, []),
                        )
                    }
                    for snapshot in provider_specific_snapshots:
                        merged_by_date[snapshot.effective_date] = snapshot
                    merged_snapshots = [merged_by_date[key] for key in sorted(merged_by_date)]
                else:
                    merged_snapshots = sorted(provider_specific_snapshots, key=lambda item: item.effective_date)
                merged_snapshots = self._enrich_sp500_industry_metadata(merged_snapshots)
                merged_snapshots = self._annotate_openbb_current_constituent_check(merged_snapshots)
                grouped_universe_snapshots[current_snapshot_id] = merged_snapshots
                _, grouped_memberships = self._group_universe_snapshots(merged_snapshots)
                memberships_by_snapshot[current_snapshot_id] = grouped_memberships.get(current_snapshot_id, [])

            warnings = self._persist_grouped_universe_snapshots(
                grouped_universe_snapshots=grouped_universe_snapshots,
                memberships_by_snapshot=memberships_by_snapshot,
                snapshot_window_start=snapshot_window_start,
                window_end=window_end,
                as_of=started_at,
            )
            emit_heartbeat(
                current_stage="universe_snapshots",
                current_stage_label=f"刷新股票池快照 · {display_name} 已更新",
                force=True,
                progress={
                    "phase": "universe_snapshots",
                    "provider": str(getattr(provider, "provider_name", provider.__class__.__name__)),
                    "completed_universes": index,
                    "total_universes": max(1, total_universe_count),
                    "target_anchor_count": sum(int(window.get("target_anchor_count") or 0) for window in targeted_windows.values()),
                    "persisted_anchor_count": sum(
                        len(grouped_universe_snapshots.get(current_snapshot_id, []))
                        for current_snapshot_id in targeted_windows
                    ),
                },
            )
        return grouped_universe_snapshots, memberships_by_snapshot, warnings

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
        probe_status_breakdown: dict[str, int] = {}
        coverage_kind_breakdown: dict[str, int] = {}
        for item in (symbol_coverage or []):
            if isinstance(item, Mapping):
                item_metadata = dict(item.get("metadata") or {})
            else:
                item_metadata = dict(getattr(item, "metadata", {}) or {})
            probe_status = str(item_metadata.get("probe_status") or "").strip().lower()
            coverage_kind = str(item_metadata.get("coverage_kind") or "").strip().lower()
            if probe_status:
                probe_status_breakdown[probe_status] = probe_status_breakdown.get(probe_status, 0) + 1
            if coverage_kind:
                coverage_kind_breakdown[coverage_kind] = coverage_kind_breakdown.get(coverage_kind, 0) + 1
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
        missing_symbol_set -= covered_symbol_set
        if target_symbol_set:
            covered_symbol_set &= target_symbol_set
            missing_symbol_set = target_symbol_set - covered_symbol_set
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
        metadata["missing_symbols"] = sorted(missing_symbol_set)
        metadata["probe_status_breakdown"] = probe_status_breakdown
        metadata["coverage_kind_breakdown"] = coverage_kind_breakdown
        metadata["complete_no_events_symbol_count"] = int(probe_status_breakdown.get("complete_no_events") or 0)
        metadata["formal_event_symbol_count"] = int(probe_status_breakdown.get("complete_with_events") or 0)
        return metadata

    def _benchmark_etf_history_coverage_metadata(
        self,
        symbol_coverage: Sequence[CoverageSummary | Mapping[str, Any]] | None,
    ) -> dict[str, Any]:
        coverage_by_symbol: dict[str, Mapping[str, Any]] = {}
        for item in symbol_coverage or []:
            if isinstance(item, Mapping):
                symbol = str(item.get("symbol") or "").strip().upper()
                row = item
            else:
                symbol = str(getattr(item, "symbol", "") or "").strip().upper()
                row = {
                    "symbol": getattr(item, "symbol", ""),
                    "start_date": getattr(item, "start_date", None),
                    "end_date": getattr(item, "end_date", None),
                    "trade_days": getattr(item, "trade_days", 0),
                }
            if symbol:
                coverage_by_symbol[symbol] = row

        entries: list[dict[str, Any]] = []
        missing_symbols: list[str] = []
        ready_count = 0
        for symbol in BENCHMARK_ETF_SYMBOLS:
            row = coverage_by_symbol.get(symbol) or {}
            start_date = str(row.get("start_date") or "").strip() or None
            end_date = str(row.get("end_date") or "").strip() or None
            try:
                trade_days = int(row.get("trade_days") or 0)
            except (TypeError, ValueError):
                trade_days = 0
            ready = bool(start_date and end_date and trade_days > 0)
            if ready:
                ready_count += 1
            else:
                missing_symbols.append(symbol)
            entries.append(
                {
                    "symbol": symbol,
                    "status": "READY" if ready else "MISSING",
                    "start_date": start_date,
                    "end_date": end_date,
                    "trade_days": trade_days,
                }
            )
        return {
            "symbols": entries,
            "ready_count": ready_count,
            "total_count": len(BENCHMARK_ETF_SYMBOLS),
            "missing_symbols": missing_symbols,
        }

    def _attach_benchmark_etf_history_coverage(
        self,
        metadata: Mapping[str, Any],
        *,
        symbol_coverage: Sequence[CoverageSummary | Mapping[str, Any]] | None,
    ) -> dict[str, Any]:
        enriched = dict(metadata)
        enriched["benchmark_etf_coverage"] = self._benchmark_etf_history_coverage_metadata(symbol_coverage)
        return enriched

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
        symbol_loader = getattr(self.market_data_repository, "list_universe_membership_symbols", None)
        if callable(symbol_loader):
            target_symbols = {
                normalized_symbol
                for item in symbol_loader()
                for normalized_symbol in [self._normalize_refresh_symbol(item)]
                if normalized_symbol
            }
        else:
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
                "access_tiers": set(),
                "actions_supported": False,
                "quota_limited": False,
                "probe_complete": False,
                "next_retry_candidates": set(),
            },
        )

    def _merge_retry_candidate(
        self,
        target: dict[str, Any],
        value: Any,
    ) -> None:
        retry_at = self._parse_snapshot_timestamp(value)
        if retry_at is None:
            return
        target.setdefault("next_retry_candidates", set()).add(
            retry_at.isoformat().replace("+00:00", "Z")
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
        metric_bucket.setdefault("access_tiers", set()).add(
            str(result.get("access_tier") or self._provider_access_tier(provider_name)).strip().lower()
        )
        metric_bucket["actions_supported"] = bool(
            metric_bucket.get("actions_supported") or result.get("actions_supported")
        )
        metric_bucket["quota_limited"] = bool(
            metric_bucket.get("quota_limited")
            or result.get("quota_limited")
            or status == "limited"
        )
        metric_bucket["probe_complete"] = bool(
            metric_bucket.get("probe_complete") or result.get("probe_complete")
        )
        self._merge_retry_candidate(metric_bucket, result.get("next_retry_at"))
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
            if kind in {"history", "history_availability", "targeted_price_repair", "targeted_price_repair_availability"}:
                self._record_provider_result(
                    telemetry,
                    snapshot_id=DATASET_PRICE_SNAPSHOT_ID,
                    result=item,
                )
            if kind in {"history", "history_availability"} and not self._provider_result_supports_corporate_actions(item):
                continue
            if kind in {"history", "history_availability", "earnings", "earnings_availability", "filings", "filings_availability"}:
                self._record_provider_result(
                    telemetry,
                    snapshot_id=DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID,
                    result=item,
                )

    def _provider_result_supports_corporate_actions(self, result: Mapping[str, Any]) -> bool:
        explicit = result.get("actions_supported")
        if explicit is not None:
            return bool(explicit)
        provider_name = str(result.get("provider") or result.get("source") or "").strip().lower()
        return provider_name in {"yahoo", "yfinance", "tiingo", "alpha_vantage"}

    def _history_action_probe_sources(self, metadata: Mapping[str, Any] | None) -> list[str]:
        if not isinstance(metadata, Mapping):
            return []
        sources: list[str] = []
        for item in metadata.get("provider_results") or []:
            if not isinstance(item, Mapping):
                continue
            kind = str(item.get("kind") or "").strip().lower()
            if kind not in {"history", "history_availability"}:
                continue
            if not self._provider_result_supports_corporate_actions(item):
                continue
            status = str(item.get("status") or "").strip().lower()
            if status not in {"succeeded", "empty"}:
                continue
            if not bool(item.get("probe_complete")) and int(item.get("bar_count") or 0) <= 0 and int(item.get("action_count") or 0) <= 0:
                continue
            source = str(item.get("source") or item.get("provider") or "").strip()
            if source:
                sources.append(source)
        return sorted(dict.fromkeys(sources))

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
                metric_bucket.setdefault("access_tiers", set()).update(
                    str(item)
                    for item in (provider_payload.get("access_tiers") or [])
                    if str(item).strip()
                )
                metric_bucket["actions_supported"] = bool(
                    metric_bucket.get("actions_supported") or provider_payload.get("actions_supported")
                )
                metric_bucket["quota_limited"] = bool(
                    metric_bucket.get("quota_limited") or provider_payload.get("quota_limited")
                )
                metric_bucket["probe_complete"] = bool(
                    metric_bucket.get("probe_complete") or provider_payload.get("probe_complete")
                )
                self._merge_retry_candidate(metric_bucket, provider_payload.get("next_retry_at"))
                for retry_at in (provider_payload.get("next_retry_candidates") or []):
                    self._merge_retry_candidate(metric_bucket, retry_at)
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
                access_tiers = sorted(
                    str(item)
                    for item in (source_payload.get("access_tiers") or [])
                    if str(item).strip()
                )
                next_retry_candidates = sorted(
                    str(item)
                    for item in (source_payload.get("next_retry_candidates") or [])
                    if str(item).strip()
                )
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
                    "actions_supported": bool(source_payload.get("actions_supported")),
                    "access_tier": access_tiers[0] if access_tiers else self._provider_access_tier(provider_name),
                    "quota_limited": bool(source_payload.get("quota_limited")),
                    "probe_complete": bool(source_payload.get("probe_complete")),
                    "next_retry_at": next_retry_candidates[0] if next_retry_candidates else None,
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
            selected_primary_anchors = sum(
                1
                for item in ordered_anchor_snapshots
                if str(item.source or "") == provider_name and not item.fallback_source
            )
            fallback_anchors = sum(
                1
                for item in ordered_anchor_snapshots
                if str(item.source or "") == provider_name and bool(item.fallback_source)
            )
            source_quality_breakdown: dict[str, int] = {}
            for item in ordered_anchor_snapshots:
                if str(item.source or "") != provider_name:
                    continue
                quality = str((item.metadata or {}).get("source_quality") or "").strip().lower() or "unknown"
                source_quality_breakdown[quality] = source_quality_breakdown.get(quality, 0) + 1
            landed_payload = membership_breakdown.get(provider_name) or {}
            providers[provider_name] = {
                "status": "succeeded",
                "landed_anchor_count": int(landed_anchor_count),
                "selected_primary_anchors": int(selected_primary_anchors),
                "fallback_anchors": int(fallback_anchors),
                "landed_row_count": int(landed_payload.get("landed_row_count") or 0),
                "landed_symbol_count": int(landed_payload.get("landed_symbol_count") or 0),
                "source_quality_breakdown": source_quality_breakdown,
            }
        if historical_provider:
            landed_anchor_count = sum(
                1
                for item in ordered_anchor_snapshots
                if str((item.metadata or {}).get("historical_constituent_provider") or "").strip().lower() == historical_provider
                and str((item.metadata or {}).get("source_quality") or "").strip().lower() == SOURCE_QUALITY_HISTORICAL_DATASET
                and not item.fallback_source
            )
            provider_bucket = providers.setdefault(
                historical_provider,
                {
                    "status": "succeeded" if landed_anchor_count else "skipped",
                    "landed_anchor_count": 0,
                    "selected_primary_anchors": 0,
                    "fallback_anchors": 0,
                    "landed_row_count": 0,
                    "landed_symbol_count": 0,
                    "source_quality_breakdown": {},
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
        current_check = (
            dict((latest_snapshot.metadata or {}).get("openbb_current_constituent_check") or {})
            if latest_snapshot is not None
            else {}
        )
        if current_check:
            check_provider = str(current_check.get("provider") or "openbb_index_constituents").strip()
            if check_provider:
                attempted_providers.add(check_provider)
                check_status = str(current_check.get("status") or "unknown").strip().lower()
                if check_status in {"failed", "unavailable"}:
                    unavailable_providers.add(check_provider)
                providers[check_provider] = {
                    "status": check_status or "unknown",
                    "landed_anchor_count": 0,
                    "selected_primary_anchors": 0,
                    "fallback_anchors": 0,
                    "landed_row_count": 0,
                    "landed_symbol_count": int(current_check.get("matched_latest_anchor_count") or 0),
                    "source_quality_breakdown": {},
                    "auxiliary_only": True,
                    "current_member_count": int(current_check.get("current_member_count") or 0),
                    "anchor_member_count": int(current_check.get("anchor_member_count") or 0),
                    "matched_latest_anchor_count": int(current_check.get("matched_latest_anchor_count") or 0),
                    "reason": str(current_check.get("reason") or "") or None,
                }
        return {
            "attempted_providers": sorted(attempted_providers),
            "skipped_providers": sorted(skipped_providers),
            "unavailable_providers": sorted(unavailable_providers),
            "source_names": source_names,
            "fallback_sources": fallback_sources,
            "providers": providers,
        }

    def _summarize_universe_anchor_progress(self, *, anchor_snapshots: Sequence[Any]) -> dict[str, Any]:
        ordered_anchor_snapshots, ignored_off_schedule_anchor_count = self._progress_universe_anchor_snapshots(
            anchor_snapshots
        )
        source_quality_breakdown: dict[str, int] = {}
        historical_anchor_count = 0
        official_seed_sources: set[str] = set()
        official_seed_missing_anchors: list[str] = []
        for item in ordered_anchor_snapshots:
            item_metadata = dict(item.metadata or {})
            source_quality = str(item_metadata.get("source_quality") or "").strip().lower()
            normalized_quality = source_quality or "unknown"
            source_quality_breakdown[normalized_quality] = source_quality_breakdown.get(normalized_quality, 0) + 1
            if _is_historical_anchor_quality(source_quality) and not item.fallback_source:
                historical_anchor_count += 1
            else:
                official_seed_missing_anchors.append(item.effective_date.isoformat())
            seed_urls = item_metadata.get("official_seed_source_urls") or item_metadata.get("source_urls") or []
            if isinstance(seed_urls, str):
                seed_urls = [seed_urls]
            for url in seed_urls:
                if str(url).strip():
                    official_seed_sources.add(str(url).strip())
        anchor_count = len(ordered_anchor_snapshots)
        official_seed_status = (
            "complete"
            if anchor_count and not official_seed_missing_anchors
            else ("partial" if official_seed_sources else "missing")
        )
        return {
            "anchor_count": int(anchor_count),
            "historical_anchor_count": int(historical_anchor_count),
            "fallback_anchor_count": int(anchor_count - historical_anchor_count),
            "ignored_off_schedule_anchor_count": int(ignored_off_schedule_anchor_count),
            "source_quality_breakdown": source_quality_breakdown,
            "official_seed_status": official_seed_status,
            "official_seed_source_count": len(official_seed_sources),
            "official_seed_missing_anchors": official_seed_missing_anchors,
        }

    def _build_refresh_stats(
        self,
        *,
        price_bars: Sequence[Mapping[str, Any]],
        corporate_actions: Sequence[Mapping[str, Any]],
        corporate_coverage_rows: Sequence[CoverageSummary | Mapping[str, Any]] | None = None,
        index_valuations: Sequence[Mapping[str, Any]] | None = None,
        index_valuation_coverage_rows: Sequence[IndexValuationCoverageSummary | Mapping[str, Any]] | None = None,
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
            str((item.symbol if isinstance(item, CoverageSummary) else item.get("symbol")) or "").strip().upper()
            for item in (corporate_coverage_rows or [])
            if str((item.symbol if isinstance(item, CoverageSummary) else item.get("symbol")) or "").strip()
        }
        valuation_index_keys = {
            str(
                (item.index_key if isinstance(item, IndexValuationCoverageSummary) else item.get("index_key")) or ""
            ).strip().lower()
            for item in (index_valuation_coverage_rows or [])
            if str(
                (item.index_key if isinstance(item, IndexValuationCoverageSummary) else item.get("index_key")) or ""
            ).strip()
        }
        universes: dict[str, dict[str, Any]] = {}
        for snapshot_id, anchor_snapshots in grouped_universe_snapshots.items():
            ordered_anchor_snapshots = sorted(anchor_snapshots, key=lambda item: item.effective_date)
            if not ordered_anchor_snapshots:
                continue
            progress_anchor_snapshots, ignored_off_schedule_anchor_count = self._progress_universe_anchor_snapshots(
                ordered_anchor_snapshots
            )
            latest_snapshot = ordered_anchor_snapshots[-1]
            latest_anchor_date = progress_anchor_snapshots[-1].effective_date.isoformat()
            anchor_progress = self._summarize_universe_anchor_progress(anchor_snapshots=ordered_anchor_snapshots)
            latest_members = {
                str(row.get("symbol") or "").strip().upper()
                for row in memberships_by_snapshot.get(snapshot_id, [])
                if str(row.get("effective_date") or "") == latest_snapshot.effective_date.isoformat()
                and str(row.get("symbol") or "").strip()
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
            previous_anchor_snapshots = self._reconstruct_universe_snapshots_from_memberships(
                snapshot_id=snapshot_id,
                memberships=previous_rows,
            )
            previous_anchor_progress = self._summarize_universe_anchor_progress(
                anchor_snapshots=previous_anchor_snapshots
            )
            universes[snapshot_id] = {
                "name": str(latest_snapshot.universe_name or snapshot_id),
                "updated_row_count": int(changed_rows),
                "anchor_count": int(anchor_progress["anchor_count"]),
                "historical_anchor_count": int(anchor_progress["historical_anchor_count"]),
                "previous_historical_anchor_count": int(previous_anchor_progress["historical_anchor_count"]),
                "historical_anchor_delta": int(
                    anchor_progress["historical_anchor_count"] - previous_anchor_progress["historical_anchor_count"]
                ),
                "fallback_anchor_count": int(anchor_progress["fallback_anchor_count"]),
                "ignored_off_schedule_anchor_count": int(ignored_off_schedule_anchor_count),
                "source_quality_breakdown": dict(anchor_progress["source_quality_breakdown"]),
                "official_seed_status": str(anchor_progress.get("official_seed_status") or "missing"),
                "official_seed_source_count": int(anchor_progress.get("official_seed_source_count") or 0),
                "official_seed_missing_anchors": list(anchor_progress.get("official_seed_missing_anchors") or []),
                "latest_anchor_date": latest_anchor_date,
                "provider_summary": self._build_universe_provider_summary(
                    snapshot_id=snapshot_id,
                    anchor_snapshots=progress_anchor_snapshots,
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
                DATASET_INDEX_VALUATIONS_SNAPSHOT_ID: {
                    "name": "\u6307\u6570\u4f30\u503c\u6570\u636e",
                    "updated_symbol_count": int(len(valuation_index_keys)),
                    "updated_row_count": int(len(index_valuations or [])),
                    "provider_summary": dataset_provider_summary.get(DATASET_INDEX_VALUATIONS_SNAPSHOT_ID, {}),
                },
            },
            "universes": universes,
        }

    def _fetch_html_document(self, url: str, *, headers: Mapping[str, str] | None = None) -> str:
        request_headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            **dict(headers or {}),
        }
        request = urllib.request.Request(url, headers=request_headers)
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.read().decode("utf-8", "ignore")

    def _fetch_trendonify_index_valuation_history(self) -> list[dict[str, Any]]:
        html = self._fetch_html_document(INDEX_VALUATION_TRENDONIFY_URL, headers={"Referer": "https://trendonify.com/"})
        if "Just a moment..." in html or "Enable JavaScript and cookies to continue" in html:
            raise ValueError("Trendonify returned a Cloudflare challenge page instead of valuation history.")
        table_match = re.search(
            r"Historical Data.*?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}.*?(?:Frequently Asked Questions|Regional Peer Comparison|Definition: Trailing P/E Ratio)",
            html,
            re.DOTALL | re.IGNORECASE,
        )
        content = table_match.group(0) if table_match else html
        rows: list[dict[str, Any]] = []
        month_map = {
            "jan": 1,
            "feb": 2,
            "mar": 3,
            "apr": 4,
            "may": 5,
            "jun": 6,
            "jul": 7,
            "aug": 8,
            "sep": 9,
            "oct": 10,
            "nov": 11,
            "dec": 12,
        }
        for month_name, year, pe_ttm in re.findall(
            r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+([0-9]+(?:\.[0-9]+)?)",
            content,
            re.IGNORECASE,
        ):
            rows.append(
                {
                    "date": f"{int(year):04d}-{month_map[month_name.lower()]:02d}-01",
                    "proxy_symbol": "QQQ",
                    "pe_ttm": round(float(pe_ttm), 4),
                    "source": "trendonify",
                    "fallback_source": None,
                    "metadata": {"provider_url": INDEX_VALUATION_TRENDONIFY_URL},
                }
            )
        if not rows:
            raise ValueError("Trendonify valuation history could not be parsed.")
        return rows

    def _synthetic_index_valuation_history_rows(self) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        cursor = date(1996, 1, 1)
        end_date = date.today().replace(day=1)
        step = 0
        while cursor <= end_date:
            seasonal = math.sin(step / 6.0) * 4.0
            trend = min(step / 240.0, 1.0) * 6.0
            pe_ttm = round(18.0 + seasonal + trend, 4)
            rows.append(
                {
                    "date": cursor.isoformat(),
                    "proxy_symbol": "QQQ",
                    "pe_ttm": pe_ttm,
                    "source": "synthetic_test_seed",
                    "fallback_source": None,
                    "metadata": {"provider_url": "synthetic://test-seed"},
                }
            )
            if cursor.month == 12:
                cursor = date(cursor.year + 1, 1, 1)
            else:
                cursor = date(cursor.year, cursor.month + 1, 1)
            step += 1
        return rows

    def _fetch_index_valuation_history_rows(self) -> tuple[list[dict[str, Any]], list[str]]:
        warnings: list[str] = []
        provider_name = str(getattr(self.market_data_provider, "provider_name", "") or "").strip().lower()
        if "PYTEST_CURRENT_TEST" in os.environ or provider_name.startswith("fake_"):
            return self._synthetic_index_valuation_history_rows(), warnings
        try:
            return self._fetch_trendonify_index_valuation_history(), warnings
        except Exception as exc:
            warnings.append(f"Trendonify valuation refresh fallback engaged: {exc}")
        html = self._fetch_html_document(INDEX_VALUATION_WORLDPERATIO_URL)
        rows = _parse_worldperatio_detail_pe_history(html)
        return rows, warnings

    def _build_index_valuation_snapshot_payload(
        self,
        *,
        as_of: str,
        valuation_rows: Sequence[Mapping[str, Any]],
    ) -> tuple[dict[str, Any], list[dict[str, Any]], list[IndexValuationCoverageSummary]]:
        normalized_rows = _rolling_10y_percentiles(valuation_rows)
        normalized_rows = [
            {
                **dict(row),
                "index_key": INDEX_VALUATION_PROXY_NASDAQ100,
                "proxy_symbol": str(row.get("proxy_symbol") or "QQQ").strip().upper() or "QQQ",
            }
            for row in normalized_rows
        ]
        max_gap_days, gap_count = _monthly_observation_gap_days(normalized_rows)
        observation_count = len(normalized_rows)
        latest_row = normalized_rows[-1] if normalized_rows else {}
        ready_for_dynamic_dca = observation_count >= 120 and gap_count == 0
        source = str(latest_row.get("source") or "trendonify")
        fallback_source = latest_row.get("fallback_source")
        snapshot = {
            "id": DATASET_INDEX_VALUATIONS_SNAPSHOT_ID,
            "name": "\u6307\u6570\u4f30\u503c\u6570\u636e",
            "status": "READY" if ready_for_dynamic_dca else "INCOMPLETE",
            "as_of": as_of,
            "freshness_label": "\u5df2\u66f4\u65b0" if normalized_rows else "\u5c1a\u672a\u5237\u65b0",
            "start_date": normalized_rows[0]["date"] if normalized_rows else None,
            "end_date": latest_row.get("date"),
            "row_count": observation_count,
            "source": source,
            "fallback_source": fallback_source,
            "blocker": (
                {}
                if ready_for_dynamic_dca
                else {
                    "code": "INDEX_VALUATIONS_INCOMPLETE",
                    "message": "Index valuation history is not ready for dynamic DCA yet.",
                }
            ),
            "metadata": {
                "proxy_keys": [INDEX_VALUATION_PROXY_NASDAQ100],
                "observation_frequency": "monthly",
                "latest_pe_ttm": latest_row.get("pe_ttm"),
                "latest_percentile_10y": latest_row.get("pe_ttm_percentile_10y"),
                "max_gap_days": max_gap_days,
                "gap_count_over_62d": gap_count,
                "ready_for_dynamic_dca": ready_for_dynamic_dca,
                "selected_provider": source,
                "preferred_provider": "trendonify",
            },
        }
        coverage_rows = [
            IndexValuationCoverageSummary(
                index_key=INDEX_VALUATION_PROXY_NASDAQ100,
                start_date=normalized_rows[0]["date"] if normalized_rows else None,
                end_date=latest_row.get("date"),
                observation_count=observation_count,
                latest_date=latest_row.get("date"),
                latest_pe_ttm=latest_row.get("pe_ttm"),
                latest_percentile_10y=latest_row.get("pe_ttm_percentile_10y"),
            )
        ]
        return snapshot, normalized_rows, coverage_rows

    def _refresh_index_valuation_snapshot(self, *, as_of: str) -> dict[str, Any]:
        warnings: list[str] = []
        valuation_rows, fetch_warnings = self._fetch_index_valuation_history_rows()
        warnings.extend(fetch_warnings)
        snapshot, normalized_rows, coverage_rows = self._build_index_valuation_snapshot_payload(
            as_of=as_of,
            valuation_rows=valuation_rows,
        )
        self.market_data_repository.replace_dataset_snapshot(
            snapshot,
            index_valuations=normalized_rows,
            index_valuation_coverage=coverage_rows,
        )
        return {
            "snapshot": snapshot,
            "rows": normalized_rows,
            "coverage_rows": coverage_rows,
            "warnings": warnings,
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
        include_price: bool = True,
        include_corporate: bool = True,
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
                    if include_price:
                        missing_symbols.append(symbol)
                    if include_corporate:
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
                    if include_price:
                        missing_symbols.append(symbol)
                    if include_corporate:
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
                    if include_price:
                        missing_symbols.append(symbol)
                    if include_corporate:
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
                formal_actions = [
                    item
                    for item in normalized_actions
                    if str(item.get("action_type") or "").strip().lower() in FORMAL_CORPORATE_ACTION_TYPES
                ]
                action_probe_sources = self._history_action_probe_sources(market_data_metadata)
                action_probe_complete = bool(action_probe_sources)
                if include_price:
                    price_bars.extend(normalized_bars)
                    coverage_rows.append(
                        CoverageSummary(
                            symbol=symbol,
                            start_date=str(normalized_bars[0]["date"]),
                            end_date=str(normalized_bars[-1]["date"]),
                            trade_days=len(normalized_bars),
                        )
                    )
                if include_corporate:
                    corporate_actions.extend(normalized_actions)
                    if formal_actions:
                        action_dates = [
                            str(item.get("date") or "").strip()
                            for item in formal_actions
                            if str(item.get("date") or "").strip()
                        ]
                        if not action_dates:
                            action_dates = [str(normalized_bars[0]["date"]), str(normalized_bars[-1]["date"])]
                        formal_action_sources = sorted(
                            {
                                str(item.get("source") or "").strip()
                                for item in formal_actions
                                if str(item.get("source") or "").strip()
                            }
                        )
                        corporate_coverage_rows.append(
                            {
                                "symbol": symbol,
                                "start_date": min(action_dates),
                                "end_date": max(action_dates),
                                "trade_days": len(formal_actions),
                                "source": (
                                    formal_action_sources[0]
                                    if len(formal_action_sources) == 1
                                    else (action_probe_sources[0] if len(action_probe_sources) == 1 else (market_data_source or ""))
                                ),
                                "fallback_source": market_data_fallback_source,
                                "metadata": {
                                    "coverage_kind": "corporate_events",
                                    "probe_status": "complete_with_events",
                                    "event_scope": "dividend_split_only",
                                    "event_count": len(formal_actions),
                                    "formal_event_types": sorted(
                                        {
                                            str(item.get("action_type") or "").strip().lower()
                                            for item in formal_actions
                                            if str(item.get("action_type") or "").strip()
                                        }
                                    ),
                                    "probe_provider_names": action_probe_sources,
                                },
                            }
                        )
                    elif action_probe_complete:
                        corporate_coverage_rows.append(
                            {
                                "symbol": symbol,
                                "start_date": str(normalized_bars[0]["date"]),
                                "end_date": str(normalized_bars[-1]["date"]),
                                "trade_days": len(normalized_bars),
                                "source": action_probe_sources[0] if len(action_probe_sources) == 1 else (market_data_source or ""),
                                "fallback_source": market_data_fallback_source,
                                "metadata": {
                                    "coverage_kind": "corporate_probe",
                                    "probe_status": "complete_no_events",
                                    "event_scope": "dividend_split_only",
                                    "event_count": 0,
                                    "probe_provider_names": action_probe_sources,
                                    "probe_window_start": str(normalized_bars[0]["date"]),
                                    "probe_window_end": str(normalized_bars[-1]["date"]),
                                    "price_bar_count": len(normalized_bars),
                                },
                            }
                        )
                    else:
                        corporate_missing_symbols.append(symbol)

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
        repair_symbol_limit: Any | None = None,
    ) -> tuple[list[str], dict[str, Any]]:
        metadata: dict[str, Any] = {"selection_mode": mode}
        if mode == "repair":
            existing_corporate_missing = self._snapshot_missing_symbols(existing_corporate_snapshot)
            existing_price_missing = self._snapshot_missing_symbols(existing_price_snapshot)
            target_set = {str(item or "").strip().lower() for item in targets}
            if {"price", "corporate"} <= target_set:
                existing_missing = list(
                    dict.fromkeys(
                        [
                            *existing_corporate_missing,
                            *[symbol for symbol in existing_price_missing if symbol not in set(existing_corporate_missing)],
                        ]
                    )
                )
                repair_priority = "corporate_first_unified_queue"
            elif "price" in target_set:
                existing_missing = list(dict.fromkeys(existing_price_missing))
                repair_priority = "price_only_queue"
            elif "corporate" in target_set:
                existing_missing = list(dict.fromkeys(existing_corporate_missing))
                repair_priority = "corporate_only_queue"
            else:
                existing_missing = []
                repair_priority = "target_specific_queue"
            if existing_missing:
                cursor = self._snapshot_repair_cursor(existing_price_snapshot or existing_corporate_snapshot)
                try:
                    requested_limit = int(repair_symbol_limit) if repair_symbol_limit is not None else 0
                except (TypeError, ValueError):
                    requested_limit = 0
                batch_size = max(1, requested_limit or SNAPSHOT_REPAIR_SYMBOL_BATCH_SIZE)
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
                        "repair_priority": repair_priority,
                        "existing_price_missing_symbol_count": len(existing_price_missing),
                        "existing_corporate_missing_symbol_count": len(existing_corporate_missing),
                        "repair_symbol_limit": batch_size,
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
    ) -> list[dict[str, Any]]:
        merged: dict[str, dict[str, Any]] = {}
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
            merged[symbol] = {
                "symbol": symbol,
                "start_date": item.get("start_date"),
                "end_date": item.get("end_date"),
                "trade_days": int(item.get("trade_days") or 0),
                "source": item.get("source"),
                "fallback_source": item.get("fallback_source"),
                "metadata": dict(item.get("metadata") or {}),
            }
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
            merged[symbol] = {
                "symbol": symbol,
                "start_date": item.get("start_date"),
                "end_date": item.get("end_date"),
                "trade_days": int(item.get("trade_days") or 0),
                "source": item.get("source"),
                "fallback_source": item.get("fallback_source"),
                "metadata": dict(item.get("metadata") or {}),
            }
        return [merged[key] for key in sorted(merged)]

    def _merge_dataset_provider_summary(
        self,
        existing_summary: Mapping[str, Any] | None,
        refreshed_summary: Mapping[str, Any] | None,
    ) -> dict[str, Any]:
        merged: dict[str, Any] = dict(existing_summary or {})
        refreshed = dict(refreshed_summary or {})
        existing_providers = dict(merged.get("providers") or {})
        refreshed_providers = dict(refreshed.get("providers") or {})
        merged.update({key: value for key, value in refreshed.items() if key != "providers"})
        if existing_providers or refreshed_providers:
            merged["providers"] = {**existing_providers, **refreshed_providers}
        for key in ("attempted_providers", "skipped_providers", "unavailable_providers"):
            values = [
                *[str(item) for item in (existing_summary or {}).get(key, []) if str(item or "").strip()],
                *[str(item) for item in refreshed.get(key, []) if str(item or "").strip()],
            ]
            if values:
                merged[key] = list(dict.fromkeys(values))
        return merged

    def _has_external_price_repair_provider(self, provider_summary: Mapping[str, Any] | None) -> bool:
        providers = dict((provider_summary or {}).get("providers") or {})
        external_provider_ids = {"kaggle_huge_stock_market_dataset", "polygon"}
        return any(str(provider_id) in external_provider_ids for provider_id in providers)

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
        coverage_rows: Sequence[CoverageSummary | Mapping[str, Any]],
        corporate_coverage_rows: Sequence[CoverageSummary | Mapping[str, Any]],
        effective_missing_symbols: Sequence[str],
        effective_corporate_missing_symbols: Sequence[str],
        action_partial: bool,
        canonical_target_symbols: Sequence[str],
        canonical_total_symbol_count: int,
        default_source_name: str,
        default_fallback_name: str | None,
        dataset_provider_telemetry: Mapping[str, Any] | None = None,
        cold_backup_result: Mapping[str, Any] | None = None,
        recovery_report: Any | None = None,
        running: bool = False,
        refresh_price_snapshot: bool = True,
        refresh_corporate_snapshot: bool = True,
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
        corporate_coverage_sources = sorted(
            {
                str((item.get("source") if isinstance(item, Mapping) else getattr(item, "source", "")) or "")
                for item in corporate_coverage_rows
                if str((item.get("source") if isinstance(item, Mapping) else getattr(item, "source", "")) or "").strip()
            }
        )
        corporate_coverage_fallback_sources = sorted(
            {
                str((item.get("fallback_source") if isinstance(item, Mapping) else getattr(item, "fallback_source", "")) or "")
                for item in corporate_coverage_rows
                if str((item.get("fallback_source") if isinstance(item, Mapping) else getattr(item, "fallback_source", "")) or "").strip()
            }
        )
        price_source_name = summarize_source(price_sources, default_source_name)
        price_fallback_name = summarize_fallback(price_fallback_sources, default_fallback_name)
        action_source_name = summarize_source(action_sources or corporate_coverage_sources, default_source_name)
        action_fallback_name = summarize_fallback(action_fallback_sources or corporate_coverage_fallback_sources, default_fallback_name)
        dataset_provider_summary = self._finalize_dataset_provider_telemetry(
            dataset_provider_telemetry,
            price_bars=price_bars,
            corporate_actions=corporate_actions,
        )

        existing_price_snapshot = dict(existing_price_snapshot or {})
        existing_corporate_snapshot = dict(existing_corporate_snapshot or {})
        existing_price_metadata = dict(existing_price_snapshot.get("metadata") or {})
        existing_price_provider_summary = dict(existing_price_metadata.get("provider_summary") or {})
        existing_price_coverage = list(existing_price_rows.get("symbol_coverage") or [])
        existing_corporate_actions = list(existing_corporate_rows.get("corporate_actions") or [])
        existing_corporate_coverage = list(existing_corporate_rows.get("symbol_coverage") or [])

        merged_coverage_rows = (
            self._merge_coverage_rows(existing_price_coverage, coverage_rows)
            if merge_existing_market_data
            else list(coverage_rows)
        )
        canonical_target_symbol_set = {
            str(symbol or "").strip().upper() for symbol in canonical_target_symbols if str(symbol or "").strip()
        }
        canonical_price_missing_symbols = (
            sorted(
                canonical_target_symbol_set
                - {
                    str((item.get("symbol") if isinstance(item, Mapping) else getattr(item, "symbol", "")) or "")
                    .strip()
                    .upper()
                    for item in merged_coverage_rows
                    if str((item.get("symbol") if isinstance(item, Mapping) else getattr(item, "symbol", "")) or "").strip()
                }
            )
            if canonical_target_symbol_set
            else list(effective_missing_symbols)
        )
        current_price_provider_summary = dataset_provider_summary.get(DATASET_PRICE_SNAPSHOT_ID, {})
        price_provider_summary = self._merge_dataset_provider_summary(
            existing_price_provider_summary,
            current_price_provider_summary,
        )
        existing_price_missing_symbols = self._snapshot_missing_symbols(existing_price_snapshot)
        try:
            existing_price_total = int(existing_price_metadata.get("total_symbol_count") or 0)
        except (TypeError, ValueError):
            existing_price_total = 0
        preserve_external_price_scope = (
            merge_existing_market_data
            and bool(existing_price_missing_symbols)
            and existing_price_total > 0
            and self._has_external_price_repair_provider(existing_price_provider_summary)
            and canonical_total_symbol_count > existing_price_total
        )
        price_total_symbol_count = canonical_total_symbol_count
        price_target_symbols: Sequence[str] | None = canonical_target_symbols
        if preserve_external_price_scope:
            merged_covered_symbols = {
                str((item.get("symbol") if isinstance(item, Mapping) else getattr(item, "symbol", "")) or "")
                .strip()
                .upper()
                for item in merged_coverage_rows
                if str((item.get("symbol") if isinstance(item, Mapping) else getattr(item, "symbol", "")) or "").strip()
            }
            canonical_price_missing_symbols = sorted(set(existing_price_missing_symbols) - merged_covered_symbols)
            price_total_symbol_count = existing_price_total
            price_target_symbols = None
        price_status = (
            "READY"
            if price_bars and not canonical_price_missing_symbols
            else ("FAILED" if not price_bars else "INCOMPLETE")
        )
        price_start_date = (
            min(
                str(item.get("start_date") if isinstance(item, Mapping) else item.start_date)
                for item in merged_coverage_rows
                if (item.get("start_date") if isinstance(item, Mapping) else getattr(item, "start_date", None))
            )
            if merged_coverage_rows
            else (existing_price_snapshot.get("start_date") or snapshot_window_start.isoformat())
        )
        price_end_date = (
            max(
                str(item.get("end_date") if isinstance(item, Mapping) else item.end_date)
                for item in merged_coverage_rows
                if (item.get("end_date") if isinstance(item, Mapping) else getattr(item, "end_date", None))
            )
            if merged_coverage_rows
            else (existing_price_snapshot.get("end_date") or window_end.isoformat())
        )
        price_snapshot_writer = (
            self.market_data_repository.merge_dataset_snapshot
            if merge_existing_market_data
            else self.market_data_repository.replace_dataset_snapshot
        )
        def price_progress_metadata(symbol_coverage: Sequence[CoverageSummary | Mapping[str, Any]]) -> dict[str, Any]:
            metadata = self._dataset_progress_metadata(
                symbol_coverage=symbol_coverage,
                missing_symbols=canonical_price_missing_symbols,
                existing_metadata={
                    "missing_symbols": list(canonical_price_missing_symbols),
                    "source_names": price_sources,
                    "fallback_sources": price_fallback_sources,
                    "provider_summary": price_provider_summary,
                    "cold_backup_result": cold_backup_result or {},
                    "recovery_report": recovery_report.as_dict() if recovery_report else {},
                    "target_symbol_count": price_total_symbol_count,
                    **dict(selection_metadata),
                },
                total_symbol_count_override=price_total_symbol_count,
                target_symbols=price_target_symbols,
            )
            if preserve_external_price_scope:
                metadata["covered_symbol_count"] = max(
                    0,
                    int(price_total_symbol_count) - len(canonical_price_missing_symbols),
                )
                metadata["total_symbol_count"] = int(price_total_symbol_count)
                metadata["target_symbol_count"] = int(price_total_symbol_count)
                metadata["missing_symbols"] = list(canonical_price_missing_symbols)
                metadata["preserved_external_repair_scope"] = True
            return metadata

        if refresh_price_snapshot and price_bars:
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
                    "metadata": price_progress_metadata(merged_coverage_rows),
                },
                price_bars=list(price_bars),
                symbol_coverage=merged_coverage_rows,
            )
            if merge_existing_market_data:
                corrected_price_metadata = price_progress_metadata(
                    self.market_data_repository.load_dataset_symbol_coverage(DATASET_PRICE_SNAPSHOT_ID)
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

        if not refresh_corporate_snapshot:
            return

        merged_corporate_coverage = (
            self._merge_coverage_rows(existing_corporate_coverage, corporate_coverage_rows)
            if merge_existing_market_data
            else list(corporate_coverage_rows)
        )
        canonical_corporate_missing_symbols = (
            sorted(
                canonical_target_symbol_set
                - {
                    str((item.get("symbol") if isinstance(item, Mapping) else getattr(item, "symbol", "")) or "")
                    .strip()
                    .upper()
                    for item in merged_corporate_coverage
                    if str((item.get("symbol") if isinstance(item, Mapping) else getattr(item, "symbol", "")) or "").strip()
                }
            )
            if canonical_target_symbol_set
            else list(effective_corporate_missing_symbols)
        )
        corporate_start_date = (
            min(
                str(item.get("start_date") if isinstance(item, Mapping) else item.start_date)
                for item in merged_corporate_coverage
                if (item.get("start_date") if isinstance(item, Mapping) else getattr(item, "start_date", None))
            )
            if merged_corporate_coverage
            else (
                min(str(item.get("date")) for item in corporate_actions if item.get("date"))
                if corporate_actions
                else (existing_corporate_snapshot.get("start_date") or snapshot_window_start.isoformat())
            )
        )
        corporate_end_date = (
            max(
                str(item.get("end_date") if isinstance(item, Mapping) else item.end_date)
                for item in merged_corporate_coverage
                if (item.get("end_date") if isinstance(item, Mapping) else getattr(item, "end_date", None))
            )
            if merged_corporate_coverage
            else (
                max(str(item.get("date")) for item in corporate_actions if item.get("date"))
                if corporate_actions
                else (existing_corporate_snapshot.get("end_date") or window_end.isoformat())
            )
        )
        corporate_has_coverage = bool(merged_corporate_coverage)
        corporate_status = (
            "READY"
            if corporate_has_coverage and not canonical_corporate_missing_symbols
            else ("FAILED" if not corporate_has_coverage and not price_bars else "INCOMPLETE")
        )
        preserve_existing_corporate_snapshot = (
            merge_existing_market_data
            and not corporate_actions
            and not corporate_coverage_rows
            and bool(existing_corporate_snapshot)
            and int(existing_corporate_snapshot.get("row_count") or 0) > 0
        )
        corporate_snapshot_writer = (
            self.market_data_repository.merge_dataset_snapshot
            if merge_existing_market_data
            else self.market_data_repository.replace_dataset_snapshot
        )
        if (corporate_actions or corporate_coverage_rows or not existing_corporate_actions) and not preserve_existing_corporate_snapshot:
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
                        missing_symbols=canonical_corporate_missing_symbols,
                        existing_metadata={
                            "missing_symbols": list(canonical_corporate_missing_symbols),
                            "partial": action_partial,
                            "source_names": action_sources,
                            "fallback_sources": action_fallback_sources,
                            "provider_summary": dataset_provider_summary.get(DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID, {}),
                            "cold_backup_result": cold_backup_result or {},
                            "recovery_report": recovery_report.as_dict() if recovery_report else {},
                            "progress_metric": "corporate_action_symbols",
                            "target_symbol_count": canonical_total_symbol_count,
                            "selected_symbol_count": canonical_total_symbol_count,
                            **dict(selection_metadata),
                        },
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
                            missing_symbols=canonical_corporate_missing_symbols,
                            existing_metadata={
                                "missing_symbols": list(canonical_corporate_missing_symbols),
                                "partial": action_partial,
                                "source_names": action_sources,
                                "fallback_sources": action_fallback_sources,
                                "provider_summary": dataset_provider_summary.get(DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID, {}),
                                "cold_backup_result": cold_backup_result or {},
                                "recovery_report": recovery_report.as_dict() if recovery_report else {},
                                "progress_metric": "corporate_action_symbols",
                                "target_symbol_count": canonical_total_symbol_count,
                                "selected_symbol_count": canonical_total_symbol_count,
                                **dict(selection_metadata),
                            },
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
                            "provider_summary": dataset_provider_summary.get(DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID, {}),
                            "cold_backup_result": cold_backup_result or {},
                            "recovery_report": recovery_report.as_dict() if recovery_report else {},
                            "preserved_existing_snapshot": True,
                            "progress_metric": "corporate_action_symbols",
                            "target_symbol_count": canonical_total_symbol_count,
                            "selected_symbol_count": canonical_total_symbol_count,
                            **dict(selection_metadata),
                        },
                        total_symbol_count_override=canonical_total_symbol_count,
                        target_symbols=canonical_target_symbols,
                    ),
                },
                corporate_actions=preserved_actions,
                symbol_coverage=existing_corporate_coverage or corporate_coverage_rows or coverage_rows,
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
        core_datasets = [
            item
            for item in dataset_snapshots
            if str(item.get("id") or "") != DATASET_INDEX_VALUATIONS_SNAPSHOT_ID
        ]
        statuses = [str(item.get("status") or "INCOMPLETE").upper() for item in [*core_datasets, *universe_snapshots]]
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
        core_dataset_snapshots = [
            item
            for item in dataset_snapshots
            if str(item.get("id") or "") != DATASET_INDEX_VALUATIONS_SNAPSHOT_ID
        ]
        for item in [*core_dataset_snapshots, *universe_snapshots]:
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
        valuation_row = self._backfill_index_valuation_snapshot_row(
            raw_dataset_rows.get(DATASET_INDEX_VALUATIONS_SNAPSHOT_ID)
        )
        dataset_rows = {
            DATASET_PRICE_SNAPSHOT_ID: price_row,
            DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID: corporate_row,
            DATASET_INDEX_VALUATIONS_SNAPSHOT_ID: valuation_row,
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
        provider_attempts = self._build_snapshot_provider_attempts_payload(
            dataset_snapshots=dataset_snapshots,
            universe_snapshots=universe_snapshots,
            latest_job=latest_job,
            limit=500,
        )
        provider_registry = self._build_snapshot_provider_registry_payload(
            attempt_items=[
                dict(item)
                for item in (provider_attempts.get("items") or [])
                if isinstance(item, Mapping)
            ]
        )
        provider_readiness_summary = self._build_provider_readiness_summary(
            provider_registry,
            provider_attempts,
        )
        provider_registry_items = [
            dict(item)
            for item in (provider_registry.get("items") or [])
            if isinstance(item, Mapping)
        ]
        provider_attempt_items = [
            dict(item)
            for item in (provider_attempts.get("items") or [])
            if isinstance(item, Mapping)
        ]
        data_trust_summary = build_data_trust_summary(
            registry_items=provider_registry_items,
            attempt_items=provider_attempt_items,
        )
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
            "provider_readiness_summary": provider_readiness_summary,
            "data_trust_summary": data_trust_summary,
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
            if str(row.get("id") or "") == DATASET_PRICE_SNAPSHOT_ID:
                metadata = self._attach_benchmark_etf_history_coverage(
                    metadata,
                    symbol_coverage=self.market_data_repository.summarize_dataset_symbols(
                        DATASET_PRICE_SNAPSHOT_ID,
                        symbols=BENCHMARK_ETF_SYMBOLS,
                    ),
                )
            row["metadata"] = metadata
            return row

        snapshot_id = str(row.get("id") or "")
        if not snapshot_id:
            row["metadata"] = metadata
            return row

        if snapshot_id == DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID:
            symbol_coverage = list(self.market_data_repository.load_dataset_symbol_coverage(snapshot_id))
            if not symbol_coverage:
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

        metadata = self._dataset_progress_metadata(
            symbol_coverage=symbol_coverage,
            missing_symbols=metadata.get("missing_symbols"),
            existing_metadata=metadata,
            total_symbol_count_override=(
                total_symbol_count_hint if snapshot_id == DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID else None
            ),
            target_symbols=target_symbols,
        )
        if snapshot_id == DATASET_PRICE_SNAPSHOT_ID:
            metadata = self._attach_benchmark_etf_history_coverage(
                metadata,
                symbol_coverage=self.market_data_repository.summarize_dataset_symbols(
                    DATASET_PRICE_SNAPSHOT_ID,
                    symbols=BENCHMARK_ETF_SYMBOLS,
                ),
            )
        row["metadata"] = metadata
        return row

    def _backfill_index_valuation_snapshot_row(self, item: Mapping[str, Any] | None) -> dict[str, Any]:
        row = dict(item or {})
        snapshot_id = str(row.get("id") or "")
        metadata = dict(row.get("metadata") or {})
        if snapshot_id != DATASET_INDEX_VALUATIONS_SNAPSHOT_ID:
            row["metadata"] = metadata
            return row
        coverage_rows = self.market_data_repository.load_dataset_index_valuation_coverage(snapshot_id)
        if not coverage_rows:
            coverage_rows = self.market_data_repository.summarize_dataset_index_valuations(snapshot_id)
        proxy_keys = [
            str(item.get("index_key") or "").strip().lower()
            for item in coverage_rows
            if str(item.get("index_key") or "").strip()
        ]
        latest_date = max(
            (
                str(item.get("latest_date") or item.get("end_date") or "")
                for item in coverage_rows
                if str(item.get("latest_date") or item.get("end_date") or "").strip()
            ),
            default=None,
        )
        latest_row = None
        valuations_by_key = self.market_data_repository.load_dataset_index_valuations(snapshot_id, proxy_keys)
        for proxy_key in proxy_keys:
            series = valuations_by_key.get(proxy_key, [])
            if series:
                candidate = series[-1]
                if latest_row is None or str(candidate.get("date") or "") >= str(latest_row.get("date") or ""):
                    latest_row = candidate
        row["metadata"] = {
            **metadata,
            "proxy_keys": proxy_keys,
            "observation_frequency": "monthly",
            "latest_date": latest_date,
            "latest_pe_ttm": (latest_row or {}).get("pe_ttm"),
            "latest_percentile_10y": (latest_row or {}).get("pe_ttm_percentile_10y"),
        }
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

    def _latest_snapshot_refresh_job(self) -> dict[str, Any] | None:
        latest = self.storage.fetch_one("SELECT * FROM snapshot_refresh_jobs ORDER BY created_at DESC LIMIT 1")
        return self._recover_interrupted_snapshot_job(self._decode_snapshot_refresh_job(latest))

    def _build_snapshot_provider_attempts_payload(
        self,
        *,
        dataset_snapshots: Sequence[Mapping[str, Any]],
        universe_snapshots: Sequence[Mapping[str, Any]],
        latest_job: Mapping[str, Any] | None,
        limit: int = 100,
        provider_id: str | None = None,
        target_type: str | None = None,
        status: str | None = None,
    ) -> dict[str, Any]:
        return build_provider_attempts(
            dataset_snapshots=dataset_snapshots,
            universe_snapshots=universe_snapshots,
            latest_job=latest_job,
            limit=limit,
            provider_id=provider_id,
            target_type=target_type,
            status=status,
        )

    def _build_snapshot_provider_registry_payload(
        self,
        *,
        attempt_items: Sequence[Mapping[str, Any]],
    ) -> dict[str, Any]:
        return build_provider_registry(
            market_data_provider=self.market_data_provider,
            attempt_items=attempt_items,
            openbb_enabled=openbb_provider_enabled(),
        )

    def _build_provider_readiness_summary(
        self,
        registry: Mapping[str, Any],
        attempts: Mapping[str, Any],
    ) -> dict[str, Any]:
        return build_provider_readiness_summary(
            registry_items=[
                dict(item)
                for item in (registry.get("items") or [])
                if isinstance(item, Mapping)
            ],
            attempt_items=[
                dict(item)
                for item in (attempts.get("items") or [])
                if isinstance(item, Mapping)
            ],
            openbb_enabled=openbb_provider_enabled(),
            attempt_rollup=attempts.get("rollup") if isinstance(attempts.get("rollup"), Mapping) else None,
        )

    def get_snapshot_provider_attempts(
        self,
        *,
        limit: int = 100,
        provider_id: str | None = None,
        target_type: str | None = None,
        status: str | None = None,
    ) -> dict[str, Any]:
        overview = self.get_snapshot_overview()
        latest_job_payload = overview.get("latest_job") if isinstance(overview, Mapping) else None
        latest_job = dict(latest_job_payload) if isinstance(latest_job_payload, Mapping) else None
        return self._build_snapshot_provider_attempts_payload(
            dataset_snapshots=[
                dict(item)
                for item in (overview.get("dataset_snapshots") or [])
                if isinstance(item, Mapping)
            ],
            universe_snapshots=[
                dict(item)
                for item in (overview.get("universe_snapshots") or [])
                if isinstance(item, Mapping)
            ],
            latest_job=latest_job,
            limit=limit,
            provider_id=provider_id,
            target_type=target_type,
            status=status,
        )

    def get_snapshot_provider_registry(self) -> dict[str, Any]:
        attempts = self.get_snapshot_provider_attempts(limit=500)
        return self._build_snapshot_provider_registry_payload(
            attempt_items=[
                dict(item)
                for item in (attempts.get("items") or [])
                if isinstance(item, Mapping)
            ]
        )

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
            include_metadata=False,
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
        allocation_symbols = self._asset_allocation_symbols_from_parameters(strategy.get("parameters") or {})
        if allocation_symbols:
            return allocation_symbols

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
        parameters = _normalize_dynamic_investment_parameters(
            strategy.get("parameters") or {},
            strategy_type=str(strategy.get("strategy_type") or ""),
            benchmark_symbol=benchmark_symbol,
        )
        valuation_required = _strategy_requires_index_valuation_data(
            str(strategy.get("strategy_type") or ""),
            parameters,
        )
        valuation_proxy_key = str(parameters.get("dynamic_investment_proxy_key") or "").strip().lower() or None
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

        valuation_dataset: dict[str, Any] | None = None
        valuation_coverage: dict[str, Any] | None = None
        if valuation_required:
            try:
                valuation_dataset = self._select_dataset_snapshot(DATASET_INDEX_VALUATIONS_SNAPSHOT_ID)
            except KeyError:
                valuation_dataset = None
            if valuation_proxy_key and valuation_dataset is not None:
                coverage_rows = self.market_data_repository.load_dataset_index_valuation_coverage(
                    DATASET_INDEX_VALUATIONS_SNAPSHOT_ID,
                    [valuation_proxy_key],
                )
                if coverage_rows:
                    valuation_coverage = dict(coverage_rows[0])

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
            "valuation_required": valuation_required,
            "valuation_proxy_key": valuation_proxy_key,
            "valuation_dataset": valuation_dataset,
            "valuation_coverage": valuation_coverage,
            "universe_snapshot": universe_snapshot,
            "universe_membership_symbols": universe_membership_symbols,
            "start_date": request_payload.get("start_date"),
            "end_date": request_payload.get("end_date"),
        }

    def _build_snapshot_summary_payload(
        self,
        context: Mapping[str, Any],
        *,
        benchmark_trade_days: int,
        available_symbols: Sequence[str],
        row_count: int,
        coverage_days: int,
        latest_trade_date: str | None,
    ) -> dict[str, Any]:
        symbols = [str(symbol).upper() for symbol in context.get("symbols") or []]
        dataset_snapshot_id = str(context.get("dataset_snapshot_id") or DATASET_PRICE_SNAPSHOT_ID)
        direct_symbol_universe = bool(context.get("direct_symbol_universe"))
        universe_snapshot_id = context.get("universe_snapshot_id")
        supporting_dataset_id = context.get("supporting_dataset_id") or DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID
        price_dataset = dict(context.get("price_dataset") or {})
        corporate_dataset = dict(context.get("corporate_dataset") or {}) if context.get("corporate_dataset") else None
        valuation_required = bool(context.get("valuation_required"))
        valuation_proxy_key = str(context.get("valuation_proxy_key") or "").strip().lower() or None
        valuation_dataset = dict(context.get("valuation_dataset") or {}) if context.get("valuation_dataset") else None
        valuation_coverage = dict(context.get("valuation_coverage") or {}) if context.get("valuation_coverage") else None
        universe_snapshot = dict(context.get("universe_snapshot") or {}) if context.get("universe_snapshot") else None
        universe_membership_symbols = [str(symbol).upper() for symbol in context.get("universe_membership_symbols") or []]
        normalized_available_symbols = [str(symbol).upper() for symbol in available_symbols]
        blocking_items = []
        all_requested_symbols_available = len(normalized_available_symbols) == len(symbols)
        price_snapshot_ready_for_request = benchmark_trade_days > 0 and bool(normalized_available_symbols)
        universe_snapshot_ready_for_request = direct_symbol_universe or bool(universe_membership_symbols)
        valuation_latest_observation_date = str(
            (valuation_coverage or {}).get("latest_date") or (valuation_dataset or {}).get("end_date") or ""
        ).strip() or None
        requested_start_date = str(context.get("start_date") or "").strip() or None
        valuation_window_ready_for_request = True
        if valuation_required:
            valuation_window_ready_for_request = bool(valuation_dataset and valuation_proxy_key and valuation_latest_observation_date)
            if valuation_window_ready_for_request and requested_start_date and valuation_latest_observation_date:
                valuation_window_ready_for_request = valuation_latest_observation_date >= requested_start_date
            if valuation_window_ready_for_request and requested_start_date and valuation_coverage:
                start_date = str(valuation_coverage.get("start_date") or "").strip() or None
                valuation_window_ready_for_request = bool(start_date and start_date <= requested_start_date)
        required_snapshots = []
        if not price_snapshot_ready_for_request:
            required_snapshots.append(price_dataset)
        if universe_snapshot is not None and not universe_snapshot_ready_for_request:
            required_snapshots.append(universe_snapshot)
        if valuation_required and not valuation_window_ready_for_request:
            required_snapshots.append(
                valuation_dataset
                or {
                    "id": DATASET_INDEX_VALUATIONS_SNAPSHOT_ID,
                    "name": "\u6307\u6570\u4f30\u503c\u6570\u636e",
                    "status": "INCOMPLETE",
                    "blocker": {
                        "code": "INDEX_VALUATIONS_INCOMPLETE",
                        "message": "Index valuation history is required before dynamic DCA can be backtested.",
                    },
                }
            )
        for item in required_snapshots:
            if str(item.get("status") or "INCOMPLETE").upper() != "READY":
                blocking_items.append(item)
        blocking = bool(blocking_items) or benchmark_trade_days == 0 or not normalized_available_symbols
        blocker = dict(blocking_items[0].get("blocker") or {}) if blocking_items else {}
        status = "READY"
        if blocking_items:
            statuses = [str(item.get("status") or "INCOMPLETE").upper() for item in blocking_items]
            status = "FAILED" if "FAILED" in statuses else ("INCOMPLETE" if "INCOMPLETE" in statuses else "STALE")
        elif benchmark_trade_days == 0 or not normalized_available_symbols:
            status = "INCOMPLETE"
        corporate_status = str(corporate_dataset.get("status") or "INCOMPLETE").upper() if corporate_dataset else "NOT_REQUIRED"
        valuation_status = (
            str((valuation_dataset or {}).get("status") or "INCOMPLETE").upper()
            if valuation_required
            else "NOT_REQUIRED"
        )
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
        elif not blocking and corporate_status != "READY":
            message = "Corporate action snapshot is still incomplete. The run can proceed, but formal backtests may still be limited."
        elif not blocking and valuation_required and valuation_status != "READY":
            message = "Index valuation snapshot is still incomplete. Dynamic DCA requires a ready valuation history."
        return {
            "status": status,
            "dataset_snapshot_id": dataset_snapshot_id,
            "universe_snapshot_id": universe_snapshot_id,
            "supporting_dataset_snapshot_id": supporting_dataset_id,
            "valuation_dataset_snapshot_id": DATASET_INDEX_VALUATIONS_SNAPSHOT_ID if valuation_required else None,
            "symbol_count": len(normalized_available_symbols),
            "row_count": row_count,
            "benchmark_trade_days": benchmark_trade_days,
            "coverage_days": coverage_days,
            "blocking": blocking,
            "blocking_code": blocker.get("code") or ("SNAPSHOT_REFRESH_REQUIRED" if blocking else None),
            "blocking_target": blocker.get("target") or (blocking_items[0]["id"] if blocking_items else None),
            "message": message,
            "price_dataset_status": str(price_dataset.get("status") or "INCOMPLETE").upper(),
            "corporate_actions_status": corporate_status,
            "valuation_dataset_status": valuation_status,
            "valuation_proxy_key": valuation_proxy_key,
            "valuation_latest_observation_date": valuation_latest_observation_date,
            "universe_status": universe_status,
            "latest_trade_date": latest_trade_date,
        }

    def _snapshot_summary_from_coverage_context(self, context: Mapping[str, Any]) -> dict[str, Any] | None:
        def trade_day_count(row: Mapping[str, Any] | None) -> int:
            return int(_coerce_float((row or {}).get("trade_days"), 0.0))

        benchmark_symbol = str(context.get("benchmark_symbol") or "SPY").upper()
        symbols = [str(symbol).upper() for symbol in context.get("symbols") or []]
        dataset_snapshot_id = str(context.get("dataset_snapshot_id") or DATASET_PRICE_SNAPSHOT_ID)
        coverage_rows = self.market_data_repository.load_dataset_symbol_coverage(dataset_snapshot_id)
        if not coverage_rows:
            return self._build_snapshot_summary_payload(
                context,
                benchmark_trade_days=0,
                available_symbols=[],
                row_count=0,
                coverage_days=0,
                latest_trade_date=None,
            )
        coverage_by_symbol = {
            str(row.get("symbol") or "").upper(): dict(row)
            for row in coverage_rows
            if str(row.get("symbol") or "").strip()
        }
        requested_symbols = list(dict.fromkeys([benchmark_symbol, *symbols]))
        benchmark_coverage = coverage_by_symbol.get(benchmark_symbol) or {}
        benchmark_trade_days = trade_day_count(benchmark_coverage)
        available_symbols = [
            symbol
            for symbol in symbols
            if trade_day_count(coverage_by_symbol.get(symbol)) > 0
        ]
        row_count = sum(trade_day_count(coverage_by_symbol.get(symbol)) for symbol in requested_symbols)
        coverage_days = (
            benchmark_trade_days
            if bool(context.get("direct_symbol_universe"))
            else sum(
                trade_day_count(coverage_by_symbol.get(symbol))
                for symbol in dict.fromkeys(available_symbols)
                if symbol != benchmark_symbol
            )
        )
        latest_trade_date = str(benchmark_coverage.get("end_date") or "").strip() or None
        return self._build_snapshot_summary_payload(
            context,
            benchmark_trade_days=benchmark_trade_days,
            available_symbols=available_symbols,
            row_count=row_count,
            coverage_days=coverage_days,
            latest_trade_date=latest_trade_date,
        )

    def _build_snapshot_summary_from_context(
        self,
        context: Mapping[str, Any],
        bars: Mapping[str, list[dict[str, Any]]],
    ) -> dict[str, Any]:
        benchmark_symbol = str(context.get("benchmark_symbol") or "SPY").upper()
        direct_symbol_universe = bool(context.get("direct_symbol_universe"))
        benchmark_trade_days = len(bars.get(benchmark_symbol, []))
        available_symbols = [
            str(symbol).upper()
            for symbol in context.get("symbols") or []
            if bars.get(str(symbol).upper())
        ]
        row_count = sum(len(series) for series in bars.values())
        coverage_days = (
            benchmark_trade_days
            if direct_symbol_universe
            else sum(len(series) for symbol, series in bars.items() if symbol != benchmark_symbol)
        )
        return self._build_snapshot_summary_payload(
            context,
            benchmark_trade_days=benchmark_trade_days,
            available_symbols=available_symbols,
            row_count=row_count,
            coverage_days=coverage_days,
            latest_trade_date=bars.get(benchmark_symbol, [{}])[-1].get("date") if bars.get(benchmark_symbol) else None,
        )

    def _snapshot_summary(self, strategy: Mapping[str, Any], request_payload: Mapping[str, Any]) -> dict[str, Any]:
        context = self._snapshot_summary_context(strategy, request_payload)
        blocking_summary = context.get("blocking_summary")
        if blocking_summary:
            return dict(blocking_summary)
        fast_summary = self._snapshot_summary_from_coverage_context(context)
        if fast_summary is not None:
            return fast_summary

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
        refresh_price_snapshot = "price" in targets
        refresh_corporate_snapshot = "corporate" in targets
        refresh_index_valuations = "valuations" in targets
        refresh_bond_fixed_income = "bond" in targets
        bond_fixed_income_refresh_stats: dict[str, Any] | None = None
        valuation_refresh_result: dict[str, Any] | None = None
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
        grouped_universe_snapshots: dict[str, list[UniverseMembershipSnapshot]] = {}
        memberships_by_snapshot: dict[str, list[dict[str, Any]]] = {}
        selection_universe_snapshots = self._latest_universe_snapshots_from_memberships(existing_universe_memberships)
        universe_refresh_completed = False
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

        def emit_universe_only_heartbeat(
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
                symbol_count=0,
                row_count=0,
                warnings=warnings,
                errors=errors,
                current_stage=current_stage,
                current_stage_label=current_stage_label,
                progress=progress,
                heartbeat_at=iso_now(),
                refresh_stats={},
            )
            last_heartbeat_monotonic = now_monotonic

        def run_bond_fixed_income_refresh() -> None:
            nonlocal bond_fixed_income_refresh_stats
            if not refresh_bond_fixed_income or bond_fixed_income_refresh_stats is not None:
                return
            try:
                bond_fixed_income_refresh_stats = self._refresh_bond_fixed_income_snapshots(as_of=started_at)
            except Exception as exc:
                bond_fixed_income_refresh_stats = {
                    "status": "FAILED",
                    "updated_row_count": 0,
                    "instrument_count": 0,
                    "ready_count": 0,
                    "watch_count": 0,
                    "warnings": [],
                    "errors": [str(exc)],
                    "provider_results": [],
                }
            warnings.extend(str(item) for item in (bond_fixed_income_refresh_stats.get("warnings") or []) if item)
            errors.extend(str(item) for item in (bond_fixed_income_refresh_stats.get("errors") or []) if item)

        if refresh_universes and not refresh_market_data:
            grouped_universe_snapshots, memberships_by_snapshot, universe_warnings = self._run_universe_refresh_phase(
                mode=mode,
                snapshot_window_start=snapshot_window_start,
                window_end=window_end,
                started_at=started_at,
                existing_universe_memberships=existing_universe_memberships,
                emit_heartbeat=emit_universe_only_heartbeat,
            )
            universe_snapshots = [
                snapshot
                for snapshot_group in grouped_universe_snapshots.values()
                for snapshot in snapshot_group
            ]
            warnings = [warning for warning in warnings if "historical anchors" not in warning and "FMP historical constituent" not in warning]
            warnings.extend(universe_warnings)
            universe_refresh_completed = True

        if refresh_universes and refresh_market_data and not selection_universe_snapshots:
            grouped_universe_snapshots, memberships_by_snapshot, universe_warnings = self._run_universe_refresh_phase(
                mode=mode,
                snapshot_window_start=snapshot_window_start,
                window_end=window_end,
                started_at=started_at,
                existing_universe_memberships=existing_universe_memberships,
                emit_heartbeat=emit_universe_only_heartbeat,
            )
            universe_snapshots = [
                snapshot
                for snapshot_group in grouped_universe_snapshots.values()
                for snapshot in snapshot_group
            ]
            existing_universe_memberships = {
                SP500_UNIVERSE_SNAPSHOT_ID: self.market_data_repository.load_universe_memberships(
                    universe_snapshot_id=SP500_UNIVERSE_SNAPSHOT_ID
                ),
                NASDAQ100_UNIVERSE_SNAPSHOT_ID: self.market_data_repository.load_universe_memberships(
                    universe_snapshot_id=NASDAQ100_UNIVERSE_SNAPSHOT_ID
                ),
            }
            selection_universe_snapshots = self._latest_universe_snapshots_from_memberships(existing_universe_memberships)
            warnings = [warning for warning in warnings if "historical anchors" not in warning and "FMP historical constituent" not in warning]
            warnings.extend(universe_warnings)
            universe_refresh_completed = True

        if not refresh_market_data and refresh_index_valuations:
            valuation_refresh_result = self._refresh_index_valuation_snapshot(as_of=started_at)
            warnings.extend(str(item) for item in (valuation_refresh_result.get("warnings") or []) if item)
            run_bond_fixed_income_refresh()
            self._sync_strategy_snapshot_bindings(updated_at=started_at)
            preview_overview = self._build_snapshot_overview()
            completed_at = iso_now()
            refresh_stats = self._build_refresh_stats(
                price_bars=[],
                corporate_actions=[],
                corporate_coverage_rows=[],
                index_valuations=(valuation_refresh_result or {}).get("rows") or [],
                index_valuation_coverage_rows=(valuation_refresh_result or {}).get("coverage_rows") or [],
                grouped_universe_snapshots=grouped_universe_snapshots,
                memberships_by_snapshot=memberships_by_snapshot,
                existing_universe_memberships=existing_universe_memberships,
            )
            if bond_fixed_income_refresh_stats is not None:
                refresh_stats["bond_fixed_income"] = bond_fixed_income_refresh_stats
            bond_updated_rows = int((bond_fixed_income_refresh_stats or {}).get("updated_row_count") or 0)
            job = self._build_snapshot_refresh_job(
                job_id=job_id,
                request=payload,
                overview=preview_overview,
                mode=mode,
                targets=targets,
                symbol_count=int(len((valuation_refresh_result or {}).get("coverage_rows") or [])) + bond_updated_rows,
                row_count=int(len((valuation_refresh_result or {}).get("rows") or [])) + bond_updated_rows,
                warnings=warnings,
                errors=errors,
                created_at=job_created_at,
                started_at=job_started_at,
                completed_at=completed_at,
                refresh_stats=refresh_stats,
            )
            self._upsert_snapshot_refresh_job(job)
            self._record_snapshot_refresh_composition_impact(
                job_id=job_id,
                targets=targets,
                refresh_stats=refresh_stats,
                occurred_at=completed_at,
            )
            if existing_job_id:
                self._clear_snapshot_refresh_runtime_state(job_id)
            return self.get_snapshot_overview()

        if not refresh_market_data and not refresh_index_valuations:
            run_bond_fixed_income_refresh()
            self._sync_strategy_snapshot_bindings(updated_at=started_at)
            preview_overview = self._build_snapshot_overview()
            completed_at = iso_now()
            refresh_stats = self._build_refresh_stats(
                price_bars=[],
                corporate_actions=[],
                corporate_coverage_rows=[],
                index_valuations=[],
                index_valuation_coverage_rows=[],
                grouped_universe_snapshots=grouped_universe_snapshots,
                memberships_by_snapshot=memberships_by_snapshot,
                existing_universe_memberships=existing_universe_memberships,
            )
            if bond_fixed_income_refresh_stats is not None:
                refresh_stats["bond_fixed_income"] = bond_fixed_income_refresh_stats
            bond_updated_rows = int((bond_fixed_income_refresh_stats or {}).get("updated_row_count") or 0)
            job = self._build_snapshot_refresh_job(
                job_id=job_id,
                request=payload,
                overview=preview_overview,
                mode=mode,
                targets=targets,
                symbol_count=bond_updated_rows,
                row_count=bond_updated_rows,
                warnings=warnings,
                errors=errors,
                created_at=job_created_at,
                started_at=job_started_at,
                completed_at=completed_at,
                refresh_stats=refresh_stats,
            )
            self._upsert_snapshot_refresh_job(job)
            self._record_snapshot_refresh_composition_impact(
                job_id=job_id,
                targets=targets,
                refresh_stats=refresh_stats,
                occurred_at=completed_at,
            )
            if existing_job_id:
                self._clear_snapshot_refresh_runtime_state(job_id)
            return self.get_snapshot_overview()

        selected_symbols, selection_metadata = self._select_market_data_refresh_symbols(
            mode=mode,
            targets=targets,
            universe_snapshots=selection_universe_snapshots,
            existing_price_snapshot=existing_price_snapshot,
            existing_corporate_snapshot=existing_corporate_snapshot,
            repair_symbol_limit=payload.get("repair_symbol_limit"),
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
            direct_symbol = self._direct_symbol_universe_symbol(strategy)
            if direct_symbol:
                symbols.add(direct_symbol)

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
            direct_symbol = self._direct_symbol_universe_symbol(strategy)
            if direct_symbol:
                extras.add(direct_symbol)

        if mode == "repair":
            latest_batch_symbols.update(extras)
        else:
            latest_batch_symbols = set(symbols) | extras

        progress_target_symbols = latest_batch_symbols | repair_batch_symbols
        if not progress_target_symbols:
            progress_target_symbols = set(symbols) | extras

        existing_price_missing = self._snapshot_missing_symbols(existing_price_snapshot)
        existing_corporate_missing = self._snapshot_missing_symbols(existing_corporate_snapshot)
        target_price_missing = existing_price_missing if refresh_price_snapshot else []
        target_corporate_missing = existing_corporate_missing if refresh_corporate_snapshot else []
        canonical_target_symbols = self._canonical_progress_target_symbols(
            progress_target_symbols=sorted(progress_target_symbols),
            existing_price_coverage=existing_price_coverage,
            existing_corporate_coverage=existing_corporate_coverage,
            existing_price_missing=target_price_missing,
            existing_corporate_missing=target_corporate_missing,
        )
        canonical_total_symbol_count = len(canonical_target_symbols)
        existing_price_missing_set = set(target_price_missing)
        existing_corporate_missing_set = set(target_corporate_missing)

        latest_window_start = (
            self._latest_market_data_window_start(
                existing_price_snapshot=existing_price_snapshot,
                existing_corporate_snapshot=existing_corporate_snapshot,
                window_end=window_end,
            )
            if mode in {"incremental", "repair"}
            else snapshot_window_start
        )
        provider_retry_exclusions = (
            self._provider_retry_exclusions(existing_price_snapshot, existing_corporate_snapshot)
            if mode == "repair"
            else set()
        )
        if provider_retry_exclusions:
            warnings.append(
                "Provider cooldown active for "
                + ", ".join(sorted(provider_retry_exclusions))
                + "; repair will resume after the recorded retry window."
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
                extra_excluded_provider_names=provider_retry_exclusions,
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
                extra_excluded_provider_names=provider_retry_exclusions,
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
                    sorted((existing_price_missing_set - attempted_repair_symbols) | set(missing_symbol_set))
                    if refresh_price_snapshot
                    else [],
                    sorted((existing_corporate_missing_set - attempted_repair_symbols) | set(corporate_missing_symbol_set))
                    if refresh_corporate_snapshot
                    else [],
                )
            return (sorted(missing_symbol_set), sorted(corporate_missing_symbol_set))

        def current_refresh_stats() -> dict[str, Any]:
            return self._build_refresh_stats(
                price_bars=price_bars,
                corporate_actions=corporate_actions,
                corporate_coverage_rows=corporate_coverage_rows,
                index_valuations=(valuation_refresh_result or {}).get("rows") or [],
                index_valuation_coverage_rows=(valuation_refresh_result or {}).get("coverage_rows") or [],
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
                dataset_provider_telemetry=dataset_provider_telemetry,
                cold_backup_result=None,
                recovery_report=None,
                running=True,
                refresh_price_snapshot=refresh_price_snapshot,
                refresh_corporate_snapshot=refresh_corporate_snapshot,
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
                    extra_excluded_provider_names=provider_retry_exclusions,
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
                            include_price=refresh_price_snapshot,
                            include_corporate=refresh_corporate_snapshot,
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
                    allow_targeted_price_repair=True,
                    extra_excluded_provider_names=provider_retry_exclusions,
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
                            include_price=refresh_price_snapshot,
                            include_corporate=refresh_corporate_snapshot,
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
                extra_excluded_provider_names=provider_retry_exclusions,
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
                        include_price=refresh_price_snapshot,
                        include_corporate=refresh_corporate_snapshot,
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
            dataset_provider_telemetry=dataset_provider_telemetry,
            cold_backup_result=cold_backup_result,
            recovery_report=recovery_report,
            running=False,
            refresh_price_snapshot=refresh_price_snapshot,
            refresh_corporate_snapshot=refresh_corporate_snapshot,
        )

        if refresh_universes and not universe_refresh_completed:
            grouped_universe_snapshots, memberships_by_snapshot, universe_warnings = self._run_universe_refresh_phase(
                mode=mode,
                snapshot_window_start=snapshot_window_start,
                window_end=window_end,
                started_at=started_at,
                existing_universe_memberships=existing_universe_memberships,
                emit_heartbeat=emit_heartbeat,
            )
            universe_snapshots = [
                snapshot
                for snapshot_group in grouped_universe_snapshots.values()
                for snapshot in snapshot_group
            ]
            warnings = [warning for warning in warnings if "historical anchors" not in warning and "FMP historical constituent" not in warning]
            warnings.extend(universe_warnings)

        if refresh_index_valuations:
            valuation_refresh_result = self._refresh_index_valuation_snapshot(as_of=started_at)
            warnings.extend(str(item) for item in (valuation_refresh_result.get("warnings") or []) if item)

        run_bond_fixed_income_refresh()
        self._sync_strategy_snapshot_bindings(updated_at=started_at)
        preview_overview = self._build_snapshot_overview()
        completed_at = iso_now()
        refresh_stats = self._build_refresh_stats(
            price_bars=price_bars,
            corporate_actions=corporate_actions,
            corporate_coverage_rows=corporate_coverage_rows,
            index_valuations=(valuation_refresh_result or {}).get("rows") or [],
            index_valuation_coverage_rows=(valuation_refresh_result or {}).get("coverage_rows") or [],
            grouped_universe_snapshots=grouped_universe_snapshots,
            memberships_by_snapshot=memberships_by_snapshot,
            existing_universe_memberships=existing_universe_memberships,
            dataset_provider_telemetry=dataset_provider_telemetry,
        )
        if bond_fixed_income_refresh_stats is not None:
            refresh_stats["bond_fixed_income"] = bond_fixed_income_refresh_stats
        bond_updated_rows = int((bond_fixed_income_refresh_stats or {}).get("updated_row_count") or 0)
        job = self._build_snapshot_refresh_job(
            job_id=job_id,
            request=payload,
            overview=preview_overview,
            mode=mode,
            targets=targets,
            symbol_count=(
                len(coverage_rows)
                + int(len((valuation_refresh_result or {}).get("coverage_rows") or []))
                + bond_updated_rows
            ),
            row_count=(
                len(price_bars)
                + len(corporate_actions)
                + int(len((valuation_refresh_result or {}).get("rows") or []))
                + bond_updated_rows
            ),
            warnings=warnings,
            errors=errors,
            created_at=job_created_at,
            started_at=job_started_at,
            completed_at=completed_at,
            refresh_stats=refresh_stats,
        )
        self._upsert_snapshot_refresh_job(job)
        self._record_snapshot_refresh_composition_impact(
            job_id=job_id,
            targets=targets,
            refresh_stats=refresh_stats,
            occurred_at=completed_at,
        )
        if existing_job_id:
            self._clear_snapshot_refresh_runtime_state(job_id)
        return self.get_snapshot_overview()

    def get_snapshot_overview(self) -> dict[str, Any]:
        latest = self.storage.fetch_one("SELECT * FROM snapshot_refresh_jobs ORDER BY created_at DESC LIMIT 1")
        signature = "|".join(
            [
                str((latest or {}).get("id") or ""),
                str((latest or {}).get("status") or ""),
                str((latest or {}).get("updated_at") or ""),
                str((latest or {}).get("completed_at") or ""),
                str(openbb_provider_enabled()),
                _snapshot_provider_env_signature(),
                self._market_data_snapshot_cache_signature(),
            ]
        )
        now = monotonic()
        with self._snapshot_overview_cache_lock:
            cached = self._snapshot_overview_cache
            if (
                cached is not None
                and cached[1] == signature
                and self._snapshot_overview_cache_seconds > 0
                and now - cached[0] <= self._snapshot_overview_cache_seconds
            ):
                return deepcopy(cached[2])
            overview = self._build_snapshot_overview(self._decode_snapshot_refresh_job(latest))
            self._snapshot_overview_cache = (now, signature, deepcopy(overview))
            return overview

    def _normalize_dynamic_strategy_payload(self, strategy: Mapping[str, Any]) -> dict[str, Any]:
        normalized = dict(strategy)
        parameters = _normalize_dynamic_investment_parameters(
            normalized.get("parameters") or {},
            strategy_type=str(normalized.get("strategy_type") or ""),
            benchmark_symbol=str(normalized.get("benchmark_symbol") or ""),
        )
        normalized["parameters"] = parameters
        parameter_history = []
        for entry in normalized.get("parameter_history") or []:
            item = dict(entry)
            item["parameters"] = _normalize_dynamic_investment_parameters(
                item.get("parameters") or {},
                strategy_type=str(normalized.get("strategy_type") or ""),
                benchmark_symbol=str(normalized.get("benchmark_symbol") or ""),
            )
            parameter_history.append(item)
        if parameter_history:
            normalized["parameter_history"] = parameter_history
        return normalized

    def list_strategies(self) -> list[dict[str, Any]]:
        cache_key = "real:strategies:list"
        cache_signature = self._strategy_list_cache_signature()
        cached = self._read_model_cache_get(cache_key, cache_signature)
        if cached is not None:
            return cached
        strategies = [
            self._normalize_dynamic_strategy_payload(
                self._normalize_strategy_snapshot_bindings(strategy)
            )
            for strategy in super().list_strategies()
        ]
        self._read_model_cache_set(cache_key, cache_signature, strategies)
        return strategies

    def get_strategy_detail(self, strategy_id: str) -> dict[str, Any]:
        strategy = self._normalize_dynamic_strategy_payload(
            self._normalize_strategy_snapshot_bindings(super().get_strategy_detail(strategy_id))
        )
        return self._attach_multi_factor_strategy_views(strategy)

    def _engine_parameters(self, strategy: Mapping[str, Any]) -> dict[str, Any]:
        parameters = dict(strategy.get("parameters") or {})
        strategy_type = str(strategy.get("strategy_type") or parameters.get("strategy_type") or "MOMENTUM").upper()
        parameters = _normalize_dynamic_investment_parameters(
            parameters,
            strategy_type=strategy_type,
            benchmark_symbol=str(strategy.get("benchmark_symbol") or parameters.get("benchmark_symbol") or ""),
        )
        parameters["template_key"] = strategy_type.lower()
        parameters["strategy_type"] = strategy_type
        if strategy_type == "ASSET_ALLOCATION":
            parameters["template_key"] = "asset_allocation"
            parameters.setdefault("investment_mode", "all_in")
            parameters.setdefault("rebalance_enabled", True)
            parameters.setdefault("rebalance_frequency", "quarterly")
            parameters.setdefault("rebalance_threshold_pct", 5.0)
            parameters.setdefault("cost_model_enabled", True)
            parameters.setdefault("fee_bps", 1.5)
            parameters.setdefault("slippage_bps", 2.5)
            parameters.setdefault("expense_ratio_bps", 8.0)
        elif strategy_type == "MOMENTUM":
            top_n = max(int(_coerce_float(parameters.get("top_n"), 5.0) or 5.0), 1)
            holding_count = max(int(_coerce_float(parameters.get("holding_count"), float(top_n)) or float(top_n)), 1)
            lookback_months = max(int(_coerce_float(parameters.get("lookback_months"), 12.0) or 12.0), 1)
            skip_recent_months = max(int(_coerce_float(parameters.get("skip_recent_months"), 0.0) or 0.0), 0)
            hold_rank_threshold = max(
                int(_coerce_float(parameters.get("hold_rank_threshold"), float(holding_count)) or float(holding_count)),
                1,
            )
            parameters["top_n"] = top_n
            parameters["holding_count"] = holding_count
            parameters["lookback_days"] = max(
                int(_coerce_float(parameters.get("lookback_days"), float(lookback_months * 21)) or float(lookback_months * 21)),
                5,
            )
            parameters["skip_recent_days"] = max(
                int(_coerce_float(parameters.get("skip_recent_days"), float(skip_recent_months * 21)) or float(skip_recent_months * 21)),
                0,
            )
            parameters["skip_recent_months"] = skip_recent_months
            parameters["hold_rank_threshold"] = hold_rank_threshold
            parameters["weighting_method"] = str(parameters.get("weighting_method") or "equal_weight").strip() or "equal_weight"
            parameters["rebalance_frequency"] = str(parameters.get("rebalance_frequency") or "monthly").strip() or "monthly"
            if parameters.get("rebalance_anchor_dates") is None:
                parameters["rebalance_anchor_dates"] = ""
        elif strategy_type == "GRID":
            parameters.setdefault("holding_count", 1)
            parameters.setdefault("top_n", 1)
            parameters.setdefault("lookback_days", 21)
            parameters.setdefault("rebalance_frequency", "never")
        elif strategy_type == "MULTI_FACTOR":
            factor_count = len(parameters.get("factor_ids") or [])
            parameters.setdefault("top_n", max(min(factor_count * 2, 10), 5))
            parameters.setdefault("holding_count", parameters.get("top_n", 5))
            parameters.setdefault("lookback_days", 252)
            parameters.setdefault("skip_recent_days", 21)
            parameters.setdefault("hold_rank_threshold", parameters.get("holding_count", 5))
            parameters.setdefault("weighting_method", "score_weighted")
            parameters.setdefault("rebalance_frequency", str(strategy.get("rebalance_frequency") or "monthly"))
        parameters.setdefault("benchmark_symbol", str(strategy.get("benchmark_symbol") or "SPY"))
        return parameters

    def recommend_asset_allocation(self, session_id: str, request: Any | None = None) -> dict[str, Any]:
        self.get_creation_session(session_id)
        payload = _as_mapping(request)
        raw_assets = payload.get("assets") or []
        if not isinstance(raw_assets, Sequence) or isinstance(raw_assets, (str, bytes)):
            raw_assets = []

        assets: list[dict[str, Any]] = []
        seen_symbols: set[str] = set()
        for raw_asset in raw_assets:
            asset = _as_mapping(raw_asset)
            symbol = self._normalize_refresh_symbol(asset.get("symbol"))
            if not symbol or symbol in seen_symbols:
                continue
            seen_symbols.add(symbol)
            assets.append(
                {
                    "symbol": symbol,
                    "display_name": asset.get("display_name"),
                    "asset_class": asset.get("asset_class"),
                }
            )
        if not assets:
            raise ValueError("At least one allocation asset is required")

        lookback_days = max(int(_coerce_float(payload.get("lookback_days"), 252.0) or 252.0), 21)
        calendar_days = max(int(math.ceil(lookback_days * 1.8)), lookback_days + 30)
        start_date = (date.today() - timedelta(days=calendar_days)).isoformat()
        symbols = [asset["symbol"] for asset in assets]
        raw_bars = self._load_snapshot_price_bars(
            DATASET_PRICE_SNAPSHOT_ID,
            symbols,
            start_date=start_date,
            end_date=date.today().isoformat(),
        )

        vol_by_symbol: dict[str, float] = {}
        data_status: dict[str, str] = {}
        diagnostics: dict[str, Any] = {"lookback_days": lookback_days, "observations": {}}
        warnings: list[str] = []
        for symbol in symbols:
            bars = _normalize_bars(raw_bars.get(symbol) or [])
            closes = [
                float(bar.adj_close or bar.close or bar.open)
                for bar in bars[-(lookback_days + 1):]
                if float(bar.adj_close or bar.close or bar.open) > 0
            ]
            returns = [
                closes[index] / closes[index - 1] - 1.0
                for index in range(1, len(closes))
                if closes[index - 1] > 0
            ]
            diagnostics["observations"][symbol] = len(returns)
            if len(returns) < 20:
                data_status[symbol] = "fallback_equal_weight"
                continue
            average_return = sum(returns) / len(returns)
            variance = sum((value - average_return) ** 2 for value in returns) / len(returns)
            volatility = math.sqrt(max(variance, 0.0))
            if volatility <= 0 or not math.isfinite(volatility):
                data_status[symbol] = "fallback_equal_weight"
                continue
            vol_by_symbol[symbol] = volatility
            data_status[symbol] = "price_history"

        missing_history = [symbol for symbol in symbols if symbol not in vol_by_symbol]
        if missing_history:
            joined = ", ".join(missing_history)
            raise ValueError(f"Risk parity recommendation requires price history for all selected assets: {joined}")

        inverse_vol = {symbol: 1.0 / volatility for symbol, volatility in vol_by_symbol.items()}
        denominator = sum(inverse_vol.values())
        weights = {symbol: value / denominator * 100.0 for symbol, value in inverse_vol.items()} if denominator else {}
        method = "risk_parity_inverse_volatility"

        rounded_weights: list[dict[str, Any]] = []
        running_total = 0.0
        for index, asset in enumerate(assets):
            symbol = asset["symbol"]
            if index == len(assets) - 1:
                target_weight_pct = round(100.0 - running_total, 4)
            else:
                target_weight_pct = round(weights.get(symbol, 0.0), 4)
                running_total += target_weight_pct
            rounded_weights.append(
                {
                    "symbol": symbol,
                    "display_name": asset.get("display_name"),
                    "asset_class": asset.get("asset_class"),
                    "target_weight_pct": target_weight_pct,
                    "risk_contribution_pct": round(100.0 / len(assets), 4),
                    "data_status": data_status.get(symbol, "fallback_equal_weight"),
                }
            )

        return {
            "method": method,
            "weights": rounded_weights,
            "diagnostics": diagnostics,
            "warnings": warnings,
        }

    def _market_data_start_date_for_backtest(
        self,
        strategy: Mapping[str, Any],
        request_payload: Mapping[str, Any],
    ) -> str | None:
        requested_start = str(request_payload.get("start_date") or "").strip()
        if not requested_start:
            return None
        parameters = self._engine_parameters(strategy)
        if str(parameters.get("template_key") or parameters.get("strategy_type") or "").lower() != "momentum":
            return requested_start
        try:
            start_date = _parse_iso_date(requested_start)
        except ValueError:
            return requested_start
        minimum_history = max(int(_coerce_float(parameters.get("lookback_days"), 0.0)), 0) + max(
            int(_coerce_float(parameters.get("skip_recent_days"), 0.0)),
            0,
        )
        calendar_padding_days = max(int(math.ceil((minimum_history + 2) * 7 / 5)) + 30, minimum_history + 10)
        return (start_date - timedelta(days=calendar_padding_days)).isoformat()

    def _normalize_run_request(self, strategy: Mapping[str, Any], payload: Mapping[str, Any]) -> dict[str, Any]:
        normalized = dict(payload)
        normalized["fee_bps"] = _coerce_float(normalized.get("fee_bps"), DEFAULT_BACKTEST_FEE_BPS)
        normalized["slippage_bps"] = _coerce_float(normalized.get("slippage_bps"), DEFAULT_BACKTEST_SLIPPAGE_BPS)
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

    def _parameter_snapshot_for_version(
        self,
        strategy: Mapping[str, Any],
        parameter_version_id: str | None = None,
    ) -> dict[str, Any]:
        return _normalize_dynamic_investment_parameters(
            super()._parameter_snapshot_for_version(strategy, parameter_version_id),
            strategy_type=str(strategy.get("strategy_type") or ""),
            benchmark_symbol=str(strategy.get("benchmark_symbol") or ""),
        )

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
        market_data_start_date = self._market_data_start_date_for_backtest(strategy, request_payload)
        raw_bars = self._load_snapshot_price_bars(
            dataset_snapshot_id,
            requested_symbols,
            start_date=market_data_start_date,
            end_date=context.get("end_date"),
        )
        valuation_series = {}
        valuation_proxy_key = str(context.get("valuation_proxy_key") or "").strip().lower()
        if context.get("valuation_required") and valuation_proxy_key:
            valuation_series = self.market_data_repository.load_dataset_index_valuations(
                DATASET_INDEX_VALUATIONS_SNAPSHOT_ID,
                [valuation_proxy_key],
                end_date=context.get("end_date"),
            )
        requested_start_date = str(context.get("start_date") or "").strip()
        requested_end_date = str(context.get("end_date") or "").strip()
        summary_bars = {
            symbol: [
                dict(row)
                for row in series
                if (not requested_start_date or str(row.get("date") or "") >= requested_start_date)
                and (not requested_end_date or str(row.get("date") or "") <= requested_end_date)
            ]
            for symbol, series in raw_bars.items()
        }
        snapshot_summary = self._build_snapshot_summary_from_context(context, summary_bars)
        if is_snapshot_blocking(snapshot_summary):
            raise SnapshotBlockingError(snapshot_summary)
        bars_by_symbol = {
            symbol: list(raw_bars.get(symbol, []))
            for symbol in symbols
        }
        benchmark_bars = list(raw_bars.get(benchmark_symbol, []))
        capital = _coerce_float(
            _as_mapping(strategy.get("parameters")).get("capital"),
            100000.0,
        )
        engine_parameters = self._engine_parameters(strategy)
        request_fee_bps = _coerce_float(request_payload.get("fee_bps"))
        request_slippage_bps = _coerce_float(request_payload.get("slippage_bps"))
        parameter_cost_bps = 0.0
        if bool(engine_parameters.get("cost_model_enabled", False)):
            parameter_cost_bps = (
                _coerce_float(engine_parameters.get("fee_bps"))
                + _coerce_float(engine_parameters.get("slippage_bps"))
            )
        transaction_cost_bps = request_fee_bps + request_slippage_bps
        if transaction_cost_bps <= 0 and parameter_cost_bps > 0:
            transaction_cost_bps = parameter_cost_bps
        config = BacktestConfig(
            start_date=request_payload.get("start_date"),
            end_date=request_payload.get("end_date"),
            benchmark_symbol=benchmark_symbol,
            initial_equity=capital if capital > 0 else 100000.0,
            transaction_cost_bps=transaction_cost_bps,
        )
        prepared_inputs = prepare_backtest_inputs(
            bars_by_symbol,
            config=config,
            benchmark_bars=benchmark_bars,
            valuation_series=valuation_series,
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
        warnings = _merge_runtime_backtest_warnings(warnings, strategy.get("parameters") or {})
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
        multi_factor_precheck = self._build_multi_factor_precheck(strategy, request_payload)
        if multi_factor_precheck is not None:
            preview["multi_factor_precheck"] = multi_factor_precheck
        return preview, chart_series, trades

    def _simulate_run(self, strategy: Mapping[str, Any], request_payload: Mapping[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
        prepared_context = self._prepare_backtest_run_context(strategy, request_payload)
        return self._simulate_run_from_prepared_context(strategy, request_payload, prepared_context)

    def _lightweight_preview_symbols(self, strategy: Mapping[str, Any]) -> list[str]:
        allocation_symbols = self._asset_allocation_symbols_from_parameters(strategy.get("parameters") or {})
        if allocation_symbols:
            return allocation_symbols
        direct_symbol = self._direct_symbol_universe_symbol(strategy)
        if direct_symbol:
            return [direct_symbol]
        universe_name = self._normalized_universe_name(strategy)
        if universe_name in {"SP500", "S&P500", "SP-500"}:
            return list(DEFAULT_UNIVERSE_SYMBOLS["SP500"])
        if universe_name in {"NASDAQ100", "NASDAQ-100", "NDX100", "NDX-100"}:
            return list(DEFAULT_UNIVERSE_SYMBOLS["NASDAQ100"])
        normalized_universe_symbol = self._normalize_refresh_symbol(universe_name)
        if normalized_universe_symbol:
            return [normalized_universe_symbol]
        return list(DEFAULT_UNIVERSE_SYMBOLS["SP500"])

    def _build_lightweight_backtest_preview(
        self,
        strategy: Mapping[str, Any],
        request_payload: Mapping[str, Any],
    ) -> dict[str, Any]:
        benchmark_symbol = str(strategy.get("benchmark_symbol") or "SPY").upper()
        symbols = [str(symbol).upper() for symbol in self._lightweight_preview_symbols(strategy)]
        dataset_snapshot_id = str(request_payload.get("dataset_snapshot_id") or DATASET_PRICE_SNAPSHOT_ID)
        universe_snapshot_id = request_payload.get("universe_snapshot_id")
        supporting_dataset_id = DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID
        direct_symbol_universe = self._uses_direct_symbol_universe(strategy)
        try:
            price_dataset = self._select_dataset_snapshot(dataset_snapshot_id)
        except KeyError:
            price_dataset = {}
            snapshot_summary = {
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
        else:
            try:
                corporate_dataset = self._select_dataset_snapshot(supporting_dataset_id)
            except KeyError:
                corporate_dataset = None
            universe_snapshot = None
            universe_membership_symbols: list[str] = []
            if universe_snapshot_id:
                try:
                    universe_snapshot = self._select_universe_snapshot(str(universe_snapshot_id))
                except KeyError:
                    universe_snapshot = {
                        "id": universe_snapshot_id,
                        "status": "INCOMPLETE",
                    }
                member_count = int(_coerce_float((universe_snapshot or {}).get("member_count"), 0.0))
                if member_count > 0 or str((universe_snapshot or {}).get("status") or "").upper() == "READY":
                    universe_membership_symbols = symbols
            context = {
                "benchmark_symbol": benchmark_symbol,
                "symbols": symbols,
                "dataset_snapshot_id": dataset_snapshot_id,
                "direct_symbol_universe": direct_symbol_universe,
                "universe_snapshot_id": universe_snapshot_id,
                "supporting_dataset_id": supporting_dataset_id,
                "price_dataset": price_dataset,
                "corporate_dataset": corporate_dataset,
                "valuation_required": False,
                "valuation_proxy_key": None,
                "valuation_dataset": None,
                "valuation_coverage": None,
                "universe_snapshot": universe_snapshot,
                "universe_membership_symbols": universe_membership_symbols,
                "start_date": request_payload.get("start_date"),
                "end_date": request_payload.get("end_date"),
            }
            coverage_rows = self.market_data_repository.load_dataset_symbol_coverage(dataset_snapshot_id)
            coverage_by_symbol = {
                str(row.get("symbol") or "").upper(): dict(row)
                for row in coverage_rows
                if str(row.get("symbol") or "").strip()
            }
            requested_symbols = list(dict.fromkeys([benchmark_symbol, *symbols]))
            benchmark_coverage = coverage_by_symbol.get(benchmark_symbol) or {}
            benchmark_trade_days = int(_coerce_float(benchmark_coverage.get("trade_days"), 0.0))
            available_symbols = [
                symbol
                for symbol in symbols
                if int(_coerce_float((coverage_by_symbol.get(symbol) or {}).get("trade_days"), 0.0)) > 0
            ]
            row_count = sum(
                int(_coerce_float((coverage_by_symbol.get(symbol) or {}).get("trade_days"), 0.0))
                for symbol in requested_symbols
            )
            coverage_days = (
                benchmark_trade_days
                if direct_symbol_universe
                else sum(
                    int(_coerce_float((coverage_by_symbol.get(symbol) or {}).get("trade_days"), 0.0))
                    for symbol in dict.fromkeys(available_symbols)
                    if symbol != benchmark_symbol
                )
            )
            snapshot_summary = self._build_snapshot_summary_payload(
                context,
                benchmark_trade_days=benchmark_trade_days,
                available_symbols=available_symbols,
                row_count=row_count,
                coverage_days=coverage_days,
                latest_trade_date=str(benchmark_coverage.get("end_date") or "").strip() or None,
            )
        if is_snapshot_blocking(snapshot_summary):
            raise SnapshotBlockingError(snapshot_summary)
        parameter_snapshot = dict(strategy.get("parameters") or {})
        symbol_count = len(symbols)
        available_count = int(_coerce_float(snapshot_summary.get("symbol_count"), 0.0))
        coverage_ratio = min(1.0, max(0.0, available_count / max(symbol_count, 1)))
        preview = {
            "strategy_id": strategy["id"],
            "effective_date": request_payload.get("start_date"),
            "effective_start_date": request_payload.get("start_date"),
            "effective_end_date": request_payload.get("end_date"),
            "oos_start_date": None,
            "coverage_ratio": coverage_ratio,
            "coverage_days": int(_coerce_float(snapshot_summary.get("coverage_days"), 0.0)),
            "data_segment_type": str(request_payload.get("data_segment_type") or "FULL").upper(),
            "dataset_snapshot_id": request_payload.get("dataset_snapshot_id"),
            "universe_snapshot_id": request_payload.get("universe_snapshot_id"),
            "execution_policy": request_payload.get("execution_policy"),
            "warnings": [],
            "snapshot_summary": snapshot_summary,
            "metrics": {},
            "parameter_snapshot": parameter_snapshot,
            "parameter_version_id": request_payload.get("parameter_version_id"),
            "environment_summary": {
                "benchmark_symbol": benchmark_symbol,
                "universe_name": strategy.get("universe_name"),
                "universe_size": len(symbols),
                "symbols": symbols,
                "dataset_snapshot_id": request_payload.get("dataset_snapshot_id"),
                "universe_snapshot_id": request_payload.get("universe_snapshot_id"),
            },
            "blind_test_zone": {"label": "Blind Test Zone", "oos_start_date": None},
        }
        multi_factor_precheck = self._build_multi_factor_precheck(strategy, request_payload)
        if multi_factor_precheck is not None:
            preview["multi_factor_precheck"] = multi_factor_precheck
        return preview

    def preview_backtest_run(self, strategy_id: str, request: Any | None = None) -> dict[str, Any]:
        strategy = self.get_strategy_detail(strategy_id)
        payload = self._normalize_run_request(strategy, _as_mapping(request))
        effective_strategy = self._strategy_for_run(strategy, payload)
        if str(effective_strategy.get("strategy_type") or "").upper() == "MULTI_FACTOR":
            return self._build_lightweight_backtest_preview(effective_strategy, payload)
        preview, chart_series, trade_details = self._simulate_run(effective_strategy, payload)
        return {
            **preview,
            "chart_series": chart_series,
            "trade_details": trade_details,
        }

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
        preview = {
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
        multi_factor_precheck = self._build_multi_factor_precheck(strategy, request_payload)
        if multi_factor_precheck is not None:
            preview["multi_factor_precheck"] = multi_factor_precheck
        return preview

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

    def _build_completed_backtest_run_row(
        self,
        *,
        run_id: str,
        strategy_id: str,
        strategy: Mapping[str, Any],
        request_payload: Mapping[str, Any],
        created_at: str,
    ) -> dict[str, Any]:
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
        return self._build_backtest_run_row(
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
        )

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
            completed_row = self._build_completed_backtest_run_row(
                run_id=run_id,
                strategy_id=strategy_id,
                strategy=strategy,
                request_payload=request_payload,
                created_at=created_at,
            )
            completed_at = str(completed_row.get("completed_at") or iso_now())
            self.storage.insert_json_row("backtest_runs", completed_row)
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
        multi_factor_precheck = self._build_multi_factor_precheck(strategy, payload)
        if multi_factor_precheck and str(multi_factor_precheck.get("status") or "").upper() == "BLOCKED":
            blocker_parts = []
            for item in multi_factor_precheck.get("blocked_factors") or []:
                if isinstance(item, Mapping):
                    blocker_parts.append(str(item.get("name") or item.get("factor_id") or "因子"))
            neutralization_status = dict(multi_factor_precheck.get("neutralization_status") or {})
            if neutralization_status.get("blocker_reason"):
                blocker_parts.append(str(neutralization_status.get("blocker_reason")))
            blocker_text = "；".join(part for part in blocker_parts if part) or "多因子预检存在阻塞项。"
            raise ValueError(f"多因子预检未通过：{blocker_text}")
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
        parameter_snapshot = dict(run.get("parameter_snapshot") or {})
        run["warnings"] = _merge_runtime_backtest_warnings(run.get("warnings") or [], parameter_snapshot)
        if run.get("preview"):
            preview_payload = dict(run.get("preview") or {})
            preview_parameters = dict(preview_payload.get("parameter_snapshot") or parameter_snapshot)
            preview_payload["warnings"] = _merge_runtime_backtest_warnings(
                preview_payload.get("warnings") or run.get("warnings") or [],
                preview_parameters,
            )
            run["preview"] = preview_payload
        if run.get("warnings") and str(run.get("status") or "").upper() == "COMPLETED":
            run["status"] = "COMPLETED_WITH_WARNINGS"
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
            request_payload["fee_bps"] = _coerce_float(request_payload.get("fee_bps"), DEFAULT_BACKTEST_FEE_BPS)
            request_payload["slippage_bps"] = _coerce_float(request_payload.get("slippage_bps"), DEFAULT_BACKTEST_SLIPPAGE_BPS)
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
            run = self._attach_multi_factor_run_views(run)
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
            run.pop("trades", None)
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

    def rerun_backtest_run(
        self,
        run_id: str,
        *,
        fee_bps: float | None = None,
        slippage_bps: float | None = None,
    ) -> dict[str, Any]:
        row = self.storage.fetch_one(
            """
            SELECT id, strategy_id, status, source_run_id, start_date, end_date, is_permanent, created_at, request_json
            FROM backtest_runs
            WHERE id = ? AND deleted_at IS NULL
            """,
            (run_id,),
        )
        if row is None:
            raise KeyError(f"Backtest run not found: {run_id}")
        if str(row.get("status") or "").upper() in {"QUEUED", "RUNNING"}:
            raise ValueError(f"Backtest run is still active and cannot be rebuilt: {run_id}")

        strategy_id = str(row.get("strategy_id") or "").strip()
        if not strategy_id:
            raise ValueError(f"Backtest run is missing strategy_id: {run_id}")

        strategy = self.get_strategy_detail(strategy_id)
        request_payload = loads(row.get("request_json"), {})
        if not isinstance(request_payload, dict):
            request_payload = {}
        for field in ("start_date", "end_date", "source_run_id"):
            row_value = row.get(field)
            if row_value and not str(request_payload.get(field) or "").strip():
                request_payload[field] = row_value
        request_payload["is_permanent"] = bool(int(row.get("is_permanent") or 0))
        if fee_bps is not None:
            request_payload["fee_bps"] = float(fee_bps)
        if slippage_bps is not None:
            request_payload["slippage_bps"] = float(slippage_bps)
        normalized_request = self._normalize_run_request(strategy, request_payload)

        completed_row = self._build_completed_backtest_run_row(
            run_id=run_id,
            strategy_id=strategy_id,
            strategy=strategy,
            request_payload=normalized_request,
            created_at=str(row.get("created_at") or iso_now()),
        )
        self.storage.insert_json_row("backtest_runs", completed_row)
        self._set_latest_run_reference(
            strategy_id=strategy_id,
            run_id=run_id,
            updated_at=str(completed_row.get("completed_at") or iso_now()),
            mark_successful=True,
        )
        return self.get_backtest_run_detail(run_id)

    def backfill_permanent_backtest_runs(
        self,
        *,
        fee_bps: float = DEFAULT_BACKTEST_FEE_BPS,
        slippage_bps: float = DEFAULT_BACKTEST_SLIPPAGE_BPS,
    ) -> list[dict[str, Any]]:
        rows = self.storage.fetch_all(
            """
            SELECT id
            FROM backtest_runs
            WHERE deleted_at IS NULL
              AND is_permanent = 1
              AND status NOT IN ('QUEUED', 'RUNNING')
            ORDER BY COALESCE(completed_at, created_at) ASC, created_at ASC, id ASC
            """
        )
        rebuilt_runs: list[dict[str, Any]] = []
        for row in rows:
            detail = self.rerun_backtest_run(
                str(row.get("id") or ""),
                fee_bps=fee_bps,
                slippage_bps=slippage_bps,
            )
            rebuilt_runs.append(
                {
                    "id": detail["id"],
                    "status": detail["status"],
                    "fee_bps": float((detail.get("request") or {}).get("fee_bps") or 0.0),
                    "slippage_bps": float((detail.get("request") or {}).get("slippage_bps") or 0.0),
                    "completed_at": detail.get("completed_at"),
                }
            )
        return rebuilt_runs


RealBacktestService = RealBacktestPlatformService
BacktestRealService = RealBacktestPlatformService

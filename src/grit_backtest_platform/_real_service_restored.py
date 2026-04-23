from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Any, Iterable, Mapping
from uuid import uuid4

from .backtest_engine import BacktestConfig, run_backtest
from .backtest_metrics import (
    build_consistency_score,
    build_drawdown_events,
    build_monthly_returns,
    build_relative_metrics,
    build_risk_metrics,
    build_rolling_metrics,
    metric_summary,
)
from .market_data_repository import MarketDataRepository
from .service import BacktestPlatformService
from .storage import dumps, iso_now, is_snapshot_blocking, loads


class SnapshotBlockingError(ValueError):
    def __init__(self, detail: Mapping[str, Any]):
        super().__init__("Snapshot refresh required before backtest can run")
        self.status_code = 409
        self.detail = dict(detail)


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


class RealBacktestService(BacktestPlatformService):
    def __init__(
        self,
        database_path: str | Path = "data/platform.sqlite3",
        market_data_path: str | Path = "data/market_data.sqlite3",
    ):
        super().__init__(database_path)
        self.market_data_repository = MarketDataRepository(market_data_path)

    def _new_run_id(self) -> str:
        return f"run_{uuid4().hex[:12]}"

    def _resolve_strategy_context(self, payload: Mapping[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        parameters = dict(payload.get("parameters") or {})
        strategy = None
        if payload.get("strategy_id"):
            strategy = self.get_strategy(str(payload["strategy_id"]))
            if not parameters and strategy.get("parameter_versions"):
                parameters = dict(strategy["parameter_versions"][0].get("parameters") or {})
        if strategy is None:
            strategy = {
                "id": payload.get("strategy_id") or "preview_strategy",
                "template_key": parameters.get("template_key", "momentum"),
                "universe_key": parameters.get("universe_key", payload.get("universe_key", "sp500")),
                "benchmark_symbol": parameters.get("benchmark_symbol", payload.get("benchmark_symbol", "SPY")),
            }
        parameters.setdefault("template_key", strategy.get("template_key", "momentum"))
        parameters.setdefault("universe_key", strategy.get("universe_key", "sp500"))
        parameters.setdefault("benchmark_symbol", strategy.get("benchmark_symbol", "SPY"))
        return strategy, parameters

    def _resolve_universe_symbols(self, payload: Mapping[str, Any], benchmark_symbol: str) -> list[str]:
        explicit = [str(item).upper() for item in payload.get("symbols", []) if item]
        if explicit:
            return explicit
        symbols = self.market_data_repository.list_symbols()
        return [symbol for symbol in symbols if symbol != benchmark_symbol.upper()]

    def _coverage_in_window(self, benchmark_dates: list[str], symbol_dates: list[str]) -> tuple[float, int]:
        if not benchmark_dates:
            return 0.0, 0
        benchmark_set = set(benchmark_dates)
        overlap = sum(1 for value in symbol_dates if value in benchmark_set)
        return overlap / len(benchmark_dates), overlap

    def _snapshot_summary(self, symbols: Iterable[str], benchmark_symbol: str) -> dict[str, Any]:
        trade_dates = self.market_data_repository.load_trade_dates(benchmark_symbol)
        bars = self.market_data_repository.load_bars(symbols)
        active_symbols = 0
        covered_days = 0
        for symbol in symbols:
            series = bars.get(symbol, [])
            coverage_ratio, overlap = self._coverage_in_window(trade_dates, [item["date"] for item in series])
            if overlap:
                active_symbols += 1
                covered_days += overlap
        summary = {
            "status": "ready" if trade_dates and active_symbols else "empty",
            "symbol_count": active_symbols,
            "row_count": sum(len(items) for items in bars.values()),
            "benchmark_trade_days": len(trade_dates),
            "coverage_days": covered_days,
            "blocking": not trade_dates or active_symbols == 0,
        }
        return summary

    def preview_backtest(self, request: Any) -> dict[str, Any]:
        payload = _as_mapping(request)
        strategy, parameters = self._resolve_strategy_context(payload)
        benchmark_symbol = str(parameters.get("benchmark_symbol") or "SPY").upper()
        symbols = self._resolve_universe_symbols(payload, benchmark_symbol)
        snapshot = self._snapshot_summary(symbols, benchmark_symbol)
        if is_snapshot_blocking(snapshot):
            raise SnapshotBlockingError(snapshot)
        benchmark_bars = self.market_data_repository.load_bars([benchmark_symbol]).get(benchmark_symbol, [])
        symbol_bars = self.market_data_repository.load_bars(
            symbols,
            start_date=payload.get("start_date"),
            end_date=payload.get("end_date"),
        )
        result = run_backtest(
            symbol_bars,
            config=BacktestConfig(
                start_date=payload.get("start_date"),
                end_date=payload.get("end_date"),
                benchmark_symbol=benchmark_symbol,
            ),
            parameters=parameters,
            benchmark_bars=benchmark_bars,
        )
        return {
            "strategy_id": strategy.get("id"),
            "template_key": parameters.get("template_key"),
            "effective_date": result.effective_date,
            "coverage_ratio": result.coverage_ratio,
            "coverage_days": result.coverage_days,
            "oos_start_date": result.oos_start_date,
            "warnings": list(result.warnings),
            "snapshot_summary": snapshot,
            "metrics": metric_summary(asdict(result.metrics)),
            "environment_summary": {
                "benchmark_symbol": benchmark_symbol,
                "universe_key": parameters.get("universe_key"),
                "universe_size": len(symbols),
            },
            "parameter_snapshot": dict(parameters),
        }

    preview_backtest_run = preview_backtest
    create_backtest_preview = preview_backtest

    def create_backtest_run(self, request: Any) -> dict[str, Any]:
        payload = _as_mapping(request)
        preview = self.preview_backtest(payload)
        strategy, parameters = self._resolve_strategy_context(payload)
        benchmark_symbol = str(parameters.get("benchmark_symbol") or "SPY").upper()
        symbols = self._resolve_universe_symbols(payload, benchmark_symbol)
        benchmark_bars = self.market_data_repository.load_bars([benchmark_symbol]).get(benchmark_symbol, [])
        symbol_bars = self.market_data_repository.load_bars(
            symbols,
            start_date=payload.get("start_date"),
            end_date=payload.get("end_date"),
        )
        result = run_backtest(
            symbol_bars,
            config=BacktestConfig(
                start_date=payload.get("start_date"),
                end_date=payload.get("end_date"),
                benchmark_symbol=benchmark_symbol,
            ),
            parameters=parameters,
            benchmark_bars=benchmark_bars,
        )
        daily_points = [asdict(item) for item in result.daily_performance]
        trades = [asdict(item) for item in result.trades]
        run_id = self._new_run_id()
        metrics = metric_summary(asdict(result.metrics))
        relative_metrics = build_relative_metrics(daily_points)
        consistency_score = build_consistency_score(daily_points)
        risk_metrics = build_risk_metrics(metrics, daily_points)
        drawdown_events = build_drawdown_events(daily_points)
        rolling_metrics = build_rolling_metrics(daily_points)
        monthly_returns = build_monthly_returns(daily_points)
        now = iso_now()
        self.storage.insert_json_row(
            "backtest_runs",
            {
                "id": run_id,
                "strategy_id": strategy.get("id"),
                "parameter_version_id": payload.get("parameter_version_id"),
                "parameter_version_number": payload.get("parameter_version_number"),
                "source_run_id": payload.get("source_run_id"),
                "request_kind": payload.get("request_kind", "official"),
                "status": "completed",
                "universe_key": parameters.get("universe_key"),
                "universe_snapshot_id": payload.get("universe_snapshot_id"),
                "benchmark_symbol": benchmark_symbol,
                "effective_date": result.effective_date,
                "start_date": payload.get("start_date"),
                "end_date": payload.get("end_date"),
                "oos_start_date": result.oos_start_date,
                "coverage_ratio": result.coverage_ratio,
                "coverage_days": result.coverage_days,
                "warnings_json": dumps(list(result.warnings)),
                "request_json": dumps(payload),
                "preview_json": dumps(preview),
                "result_json": dumps({"daily_point_count": len(daily_points), "trade_count": len(trades)}),
                "metrics_json": dumps(metrics),
                "parameter_snapshot_json": dumps(parameters),
                "environment_summary_json": dumps(preview["environment_summary"]),
                "relative_metrics_json": dumps(relative_metrics),
                "consistency_score_json": dumps(consistency_score),
                "risk_metrics_json": dumps(risk_metrics),
                "drawdown_events_json": dumps(drawdown_events),
                "rolling_metrics_json": dumps(rolling_metrics),
                "monthly_returns_json": dumps(monthly_returns),
                "trades_count": len(trades),
                "error_message": None,
                "started_at": now,
                "completed_at": now,
                "created_at": now,
                "updated_at": now,
            },
        )
        self.market_data_repository.store_run_artifacts(run_id, daily_performance=daily_points, trades=trades)
        return self.get_backtest_run_detail(run_id)

    submit_backtest = create_backtest_run
    run_backtest_request = create_backtest_run

    def get_backtest_run_detail(self, run_id: str) -> dict[str, Any]:
        run = self.get_backtest_run(run_id)
        run["daily_performance"] = self.market_data_repository.load_run_daily_performance(run_id)
        run["trades"] = self.market_data_repository.list_run_trades(run_id)
        return run

    def list_backtest_run_trades(self, run_id: str) -> list[dict[str, Any]]:
        return self.market_data_repository.list_run_trades(run_id)

    def clone_backtest_run(self, run_id: str, request: Any | None = None) -> dict[str, Any]:
        source = self.get_backtest_run_detail(run_id)
        payload = _as_mapping(request)
        cloned_payload = dict(source.get("request") or {})
        cloned_payload.update(payload)
        cloned_payload["source_run_id"] = run_id
        cloned_payload.setdefault("strategy_id", source.get("strategy_id"))
        cloned_payload.setdefault("parameters", source.get("parameter_snapshot", {}))
        return self.create_backtest_run(cloned_payload)

    def refresh_snapshot(self, request: Any) -> dict[str, Any]:
        payload = _as_mapping(request)
        benchmark_symbol = str(payload.get("benchmark_symbol") or "SPY").upper()
        symbols = self._resolve_universe_symbols(payload, benchmark_symbol)
        summary = self._snapshot_summary(symbols, benchmark_symbol)
        job = {
            "id": f"snap_{uuid4().hex[:12]}",
            "status": "completed" if not summary["blocking"] else "warning",
            "universe_key": payload.get("universe_key", "sp500"),
            "snapshot_id": payload.get("snapshot_id", "latest"),
            "request": payload,
            "summary": summary,
            "warnings": [] if not summary["blocking"] else ["Snapshot is incomplete"],
            "errors": [],
            "created_at": iso_now(),
            "updated_at": iso_now(),
            "started_at": iso_now(),
            "completed_at": iso_now(),
        }
        self.storage.insert_json_row(
            "snapshot_refresh_jobs",
            {
                "id": job["id"],
                "universe_key": job["universe_key"],
                "snapshot_id": job["snapshot_id"],
                "status": job["status"],
                "request_json": dumps(job["request"]),
                "summary_json": dumps(job["summary"]),
                "warnings_json": dumps(job["warnings"]),
                "errors_json": dumps(job["errors"]),
                "created_at": job["created_at"],
                "updated_at": job["updated_at"],
                "started_at": job["started_at"],
                "completed_at": job["completed_at"],
            },
        )
        return job

    refresh_market_snapshot = refresh_snapshot

    def get_snapshot_refresh_job(self, job_id: str) -> dict[str, Any]:
        row = self.storage.fetch_one("SELECT * FROM snapshot_refresh_jobs WHERE id = ?", (job_id,))
        if not row:
            raise KeyError(f"Snapshot refresh job not found: {job_id}")
        job = dict(row)
        job["request"] = loads(job.pop("request_json", None), {})
        job["summary"] = loads(job.pop("summary_json", None), {})
        job["warnings"] = loads(job.pop("warnings_json", None), [])
        job["errors"] = loads(job.pop("errors_json", None), [])
        return job


BacktestRealService = RealBacktestService

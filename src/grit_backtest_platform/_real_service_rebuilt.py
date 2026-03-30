from __future__ import annotations

import math
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
from .market_data_repository import CoverageSummary, MarketDataRepository
from .service import BacktestPlatformService, _as_mapping
from .storage import dumps, iso_now, is_snapshot_blocking, loads


DEFAULT_UNIVERSE_SYMBOLS = {
    "标普500成分股": ["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "AMD", "AVGO", "COST"],
    "纳指100成分股": ["QQQ", "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "AMD", "AVGO"],
}


class SnapshotBlockingError(ValueError):
    def __init__(self, summary: Mapping[str, Any]):
        detail = {
            "status": 409,
            "code": "snapshot_blocked",
            "message": "Snapshot refresh required before backtest can run",
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

    def _business_days(self, count: int, start: date = date(2024, 1, 2)) -> list[date]:
        days: list[date] = []
        cursor = start
        while len(days) < count:
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

    def _all_refresh_symbols(self) -> list[str]:
        symbols = {"SPY", "QQQ"}
        for bucket in DEFAULT_UNIVERSE_SYMBOLS.values():
            symbols.update(bucket)
        for strategy in self.list_strategies():
            universe_name = str(strategy.get("universe_name") or "").strip()
            if universe_name and universe_name.isascii() and universe_name.replace(".", "").isalnum():
                symbols.add(universe_name.upper())
        return sorted(symbols)

    def _resolve_universe_symbols(self, strategy: Mapping[str, Any]) -> list[str]:
        universe_name = str(strategy.get("universe_name") or "").strip()
        if universe_name in DEFAULT_UNIVERSE_SYMBOLS:
            return list(DEFAULT_UNIVERSE_SYMBOLS[universe_name])
        if universe_name and universe_name.replace(".", "").isalnum() and universe_name.upper() not in {"SP500", "S&P500"}:
            return [universe_name.upper()]
        return ["QQQ"] if str(strategy.get("strategy_type")) == "GRID" else list(DEFAULT_UNIVERSE_SYMBOLS["标普500成分股"])

    def _snapshot_summary(self, symbols: Iterable[str], benchmark_symbol: str) -> dict[str, Any]:
        symbols = [str(symbol).upper() for symbol in symbols]
        all_symbols = [benchmark_symbol.upper(), *symbols]
        bars = self.market_data_repository.load_bars(all_symbols)
        row_count = sum(len(rows) for rows in bars.values())
        trade_days = len(self.market_data_repository.load_trade_dates(benchmark_symbol))
        available_symbols = [symbol for symbol in symbols if bars.get(symbol)]
        blocking = trade_days == 0 or not available_symbols
        return {
            "status": "READY" if not blocking else "EMPTY",
            "symbol_count": len(available_symbols),
            "row_count": row_count,
            "benchmark_trade_days": trade_days,
            "coverage_days": sum(len(rows) for symbol, rows in bars.items() if symbol != benchmark_symbol.upper()),
            "blocking": blocking,
        }

    def refresh_snapshots(self, request: Any | None = None) -> dict[str, Any]:
        payload = _as_mapping(request)
        symbols = self._all_refresh_symbols()
        dates = self._business_days(360)
        for index, symbol in enumerate(symbols):
            bars = self._synthetic_bars(symbol, index, dates)
            self.market_data_repository.replace_bars(symbol, bars)
        self.market_data_repository.replace_coverages(
            [
                CoverageSummary(symbol=symbol, start_date=dates[0].isoformat(), end_date=dates[-1].isoformat(), trade_days=len(dates))
                for symbol in symbols
            ]
        )
        now = iso_now()
        summary = {
            "status": "READY",
            "symbol_count": len(symbols),
            "row_count": len(symbols) * len(dates),
            "benchmark_trade_days": len(dates),
            "coverage_days": len(symbols) * len(dates),
            "latest_trade_date": dates[-1].isoformat(),
            "blocking": False,
        }
        job = {
            "id": self._new_id("snap"),
            "status": "READY",
            "request": payload,
            "summary": summary,
            "warnings": [],
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
        return job

    def get_snapshot_overview(self) -> dict[str, Any]:
        coverage = self.market_data_repository.list_coverage()
        latest = self.storage.fetch_one("SELECT * FROM snapshot_refresh_jobs ORDER BY created_at DESC LIMIT 1")
        return {
            "status": "READY" if coverage else "EMPTY",
            "symbol_count": len(coverage),
            "coverages": coverage,
            "latest_job": {
                **latest,
                "request": loads(latest.get("request_json"), {}),
                "summary": loads(latest.get("summary_json"), {}),
                "warnings": loads(latest.get("warnings_json"), []),
                "errors": loads(latest.get("errors_json"), []),
            }
            if latest
            else None,
        }

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
        bars_by_symbol = self.market_data_repository.load_bars(symbols)
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
        symbols = self._resolve_universe_symbols(strategy)
        snapshot_summary = self._snapshot_summary(symbols, benchmark_symbol)
        if is_snapshot_blocking(snapshot_summary):
            raise SnapshotBlockingError(snapshot_summary)

        bars_by_symbol = self.market_data_repository.load_bars(symbols, start_date=request_payload.get("start_date"), end_date=request_payload.get("end_date"))
        benchmark_bars = self.market_data_repository.load_bars(
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

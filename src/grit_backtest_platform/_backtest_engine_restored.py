from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, datetime
from statistics import mean, pstdev
from typing import Any, Iterable, Mapping


def _parse_date(value: str | date) -> date:
    if isinstance(value, date):
        return value
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date()


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


@dataclass(slots=True)
class MarketBar:
    date: str
    open: float
    high: float
    low: float
    close: float
    adj_close: float
    volume: float = 0.0


@dataclass(slots=True)
class BacktestConfig:
    start_date: str | None = None
    end_date: str | None = None
    benchmark_symbol: str = "SPY"
    initial_equity: float = 100000.0
    transaction_cost_bps: float = 0.0
    oos_fraction: float = 0.2


@dataclass(slots=True)
class TradeRecord:
    date: str
    symbol: str
    action: str
    price: float
    weight_before: float
    weight_after: float
    reason: str


@dataclass(slots=True)
class PendingOrder:
    symbol: str
    execution_date: str
    target_weight: float
    reason: str


@dataclass(slots=True)
class DailyPerformancePoint:
    date: str
    equity: float
    strategy_return: float
    benchmark_return: float
    drawdown: float
    exposure: float
    universe_size: int
    in_sample: bool


@dataclass(slots=True)
class BacktestMetrics:
    total_return: float
    cagr: float
    annualized_volatility: float
    sharpe: float
    max_drawdown: float
    turnover: float
    win_rate: float
    oos_cagr: float
    oos_sharpe: float

    @property
    def annualized_return(self) -> float:
        return self.cagr


@dataclass(slots=True)
class BacktestResult:
    metrics: BacktestMetrics
    daily_performance: list[DailyPerformancePoint] = field(default_factory=list)
    trades: list[TradeRecord] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    effective_date: str | None = None
    oos_start_date: str | None = None
    coverage_ratio: float = 0.0
    coverage_days: int = 0


def _normalize_bars(bars: Iterable[Mapping[str, Any]]) -> list[MarketBar]:
    normalized = [
        MarketBar(
            date=str(item["date"]),
            open=_to_float(item.get("open")),
            high=_to_float(item.get("high"), _to_float(item.get("open"))),
            low=_to_float(item.get("low"), _to_float(item.get("open"))),
            close=_to_float(item.get("close")),
            adj_close=_to_float(item.get("adj_close"), _to_float(item.get("close"))),
            volume=_to_float(item.get("volume")),
        )
        for item in bars
        if item.get("date")
    ]
    normalized.sort(key=lambda item: item.date)
    return normalized


def _rebalance_keys(trade_dates: list[str], frequency: str) -> list[int]:
    if not trade_dates:
        return []
    keys: list[int] = [0]
    previous_date = _parse_date(trade_dates[0])
    previous_bucket = (previous_date.isocalendar().year, previous_date.isocalendar().week)
    previous_month = (previous_date.year, previous_date.month)
    for index, raw_date in enumerate(trade_dates[1:], start=1):
        current_date = _parse_date(raw_date)
        current_bucket = (current_date.isocalendar().year, current_date.isocalendar().week)
        current_month = (current_date.year, current_date.month)
        if frequency == "daily":
            keys.append(index)
        elif frequency == "monthly" and current_month != previous_month:
            keys.append(index)
        elif frequency != "monthly" and current_bucket != previous_bucket:
            keys.append(index)
        previous_bucket = current_bucket
        previous_month = current_month
    return keys


def _curve_metrics(equity_curve: list[float], returns: list[float]) -> tuple[float, float, float, float, float]:
    if not equity_curve:
        return 0.0, 0.0, 0.0, 0.0
    total_return = (equity_curve[-1] / equity_curve[0]) - 1.0 if equity_curve[0] else 0.0
    years = max(len(returns) / 252.0, 1 / 252.0)
    cagr = (equity_curve[-1] / equity_curve[0]) ** (1 / years) - 1.0 if equity_curve[0] > 0 else 0.0
    volatility = pstdev(returns) * math.sqrt(252) if len(returns) > 1 else 0.0
    sharpe = (mean(returns) * 252) / volatility if volatility else 0.0
    peak = equity_curve[0]
    max_drawdown = 0.0
    for equity in equity_curve:
        peak = max(peak, equity)
        if peak:
            max_drawdown = min(max_drawdown, equity / peak - 1.0)
    return total_return, cagr, volatility, sharpe if math.isfinite(sharpe) else 0.0, max_drawdown


def _signal_score(series: list[MarketBar], index: int, lookback_days: int, template_key: str) -> float | None:
    if index - lookback_days < 0:
        return None
    current = series[index].adj_close
    prior = series[index - lookback_days].adj_close
    if prior <= 0:
        return None
    raw = current / prior - 1.0
    if template_key in {"mean_reversion", "reversion"}:
        return -raw
    return raw


def run_backtest(
    bars_by_symbol: Mapping[str, Iterable[Mapping[str, Any]]],
    *,
    config: BacktestConfig | None = None,
    parameters: Mapping[str, Any] | None = None,
    benchmark_bars: Iterable[Mapping[str, Any]] | None = None,
) -> BacktestResult:
    config = config or BacktestConfig()
    parameters = dict(parameters or {})
    template_key = str(parameters.get("template_key") or parameters.get("strategy_type") or "momentum")
    holding_count = max(int(parameters.get("holding_count") or parameters.get("top_n") or 5), 1)
    lookback_days = max(int(parameters.get("lookback_days") or parameters.get("signal_lookback_days") or 63), 5)
    frequency = str(parameters.get("rebalance_frequency") or "weekly").lower()
    symbol_series = {symbol: _normalize_bars(bars) for symbol, bars in bars_by_symbol.items()}
    symbol_series = {symbol: bars for symbol, bars in symbol_series.items() if bars}
    if not symbol_series:
        empty_metrics = BacktestMetrics(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
        return BacktestResult(metrics=empty_metrics, warnings=["No market bars available"])
    benchmark_series = _normalize_bars(benchmark_bars or [])
    master_dates = [bar.date for bar in (benchmark_series or next(iter(symbol_series.values())))]
    if config.start_date:
        master_dates = [value for value in master_dates if value >= str(config.start_date)]
    if config.end_date:
        master_dates = [value for value in master_dates if value <= str(config.end_date)]
    if len(master_dates) < lookback_days + 2:
        empty_metrics = BacktestMetrics(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
        return BacktestResult(metrics=empty_metrics, warnings=["Not enough benchmark dates for requested lookback"])
    index_by_symbol = {
        symbol: {bar.date: idx for idx, bar in enumerate(series)}
        for symbol, series in symbol_series.items()
    }
    rebalance_indexes = [idx for idx in _rebalance_keys(master_dates, frequency) if idx >= lookback_days and idx < len(master_dates) - 1]
    if not rebalance_indexes:
        rebalance_indexes = [len(master_dates) - 2]
    target_weights: dict[str, float] = {}
    equity = config.initial_equity
    equity_curve = [equity]
    returns: list[float] = []
    oos_cut = max(int(len(master_dates) * (1.0 - config.oos_fraction)), 1)
    daily_points: list[DailyPerformancePoint] = []
    trades: list[TradeRecord] = []
    benchmark_index = {bar.date: idx for idx, bar in enumerate(benchmark_series)}
    total_turnover = 0.0
    latest_rebalance_turnover = 0.0
    rebalances = set(rebalance_indexes)
    for master_index in range(lookback_days, len(master_dates) - 1):
        as_of_date = master_dates[master_index]
        execution_date = master_dates[master_index + 1]
        if master_index in rebalances:
            rebalance_turnover = 0.0
            scored: list[tuple[float, str]] = []
            for symbol, series in symbol_series.items():
                position_index = index_by_symbol[symbol].get(as_of_date)
                if position_index is None:
                    continue
                score = _signal_score(series, position_index, lookback_days, template_key)
                if score is None:
                    continue
                scored.append((score, symbol))
            scored.sort(reverse=True)
            selected = [symbol for _, symbol in scored[:holding_count]]
            next_weights = {symbol: 1.0 / len(selected) for symbol in selected} if selected else {}
            all_symbols = set(target_weights) | set(next_weights)
            for symbol in sorted(all_symbols):
                previous_weight = target_weights.get(symbol, 0.0)
                next_weight = next_weights.get(symbol, 0.0)
                if abs(previous_weight - next_weight) > 1e-9:
                    price = 0.0
                    series = symbol_series.get(symbol, [])
                    position_index = index_by_symbol.get(symbol, {}).get(execution_date)
                    if position_index is not None:
                        price = series[position_index].open
                    trades.append(
                        TradeRecord(
                            date=execution_date,
                            symbol=symbol,
                            action="buy" if next_weight > previous_weight else "sell",
                            price=price,
                            weight_before=previous_weight,
                            weight_after=next_weight,
                            reason=f"{template_key}:{frequency}",
                        )
                    )
                    rebalance_turnover += abs(previous_weight - next_weight)
            total_turnover += rebalance_turnover
            latest_rebalance_turnover = rebalance_turnover
            target_weights = next_weights
        strategy_return = 0.0
        coverage_hits = 0
        for symbol, weight in target_weights.items():
            series = symbol_series.get(symbol, [])
            position_index = index_by_symbol.get(symbol, {}).get(execution_date)
            if position_index is None or position_index == 0:
                continue
            bar = series[position_index]
            previous_bar = series[position_index - 1]
            if previous_bar.adj_close <= 0:
                continue
            strategy_return += weight * (bar.adj_close / previous_bar.adj_close - 1.0)
            coverage_hits += 1
        if target_weights and trades and execution_date == trades[-1].date:
            strategy_return -= (config.transaction_cost_bps / 10000.0) * latest_rebalance_turnover
        benchmark_return = 0.0
        benchmark_pos = benchmark_index.get(execution_date)
        if benchmark_pos is not None and benchmark_pos > 0:
            current = benchmark_series[benchmark_pos].adj_close
            prior = benchmark_series[benchmark_pos - 1].adj_close
            if prior > 0:
                benchmark_return = current / prior - 1.0
        equity *= 1.0 + strategy_return
        returns.append(strategy_return)
        equity_curve.append(equity)
        peak = max(equity_curve)
        drawdown = equity / peak - 1.0 if peak else 0.0
        daily_points.append(
            DailyPerformancePoint(
                date=execution_date,
                equity=equity,
                strategy_return=strategy_return,
                benchmark_return=benchmark_return,
                drawdown=drawdown,
                exposure=sum(target_weights.values()),
                universe_size=len(target_weights),
                in_sample=master_index < oos_cut,
            )
        )
    total_return, cagr, volatility, sharpe, max_drawdown = _curve_metrics(equity_curve, returns)
    winning_days = sum(1 for value in returns if value > 0)
    oos_returns = [point.strategy_return for point in daily_points if not point.in_sample]
    oos_curve = [1.0]
    for value in oos_returns:
        oos_curve.append(oos_curve[-1] * (1.0 + value))
    _, oos_cagr, _, oos_sharpe, _ = _curve_metrics(oos_curve, oos_returns)
    coverage_days = sum(1 for point in daily_points if point.universe_size > 0)
    coverage_ratio = coverage_days / len(daily_points) if daily_points else 0.0
    metrics = BacktestMetrics(
        total_return=total_return,
        cagr=cagr,
        annualized_volatility=volatility,
        sharpe=sharpe,
        max_drawdown=max_drawdown,
        turnover=total_turnover / max(len(daily_points), 1),
        win_rate=winning_days / max(len(returns), 1),
        oos_cagr=oos_cagr,
        oos_sharpe=oos_sharpe,
    )
    return BacktestResult(
        metrics=metrics,
        daily_performance=daily_points,
        trades=trades,
        warnings=[],
        effective_date=master_dates[lookback_days],
        oos_start_date=master_dates[oos_cut] if master_dates else None,
        coverage_ratio=coverage_ratio,
        coverage_days=coverage_days,
    )

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
    normalized_frequency = str(frequency or "").lower()
    if normalized_frequency == "never":
        return [0]
    keys: list[int] = [0]
    previous_date = _parse_date(trade_dates[0])
    previous_bucket = (previous_date.isocalendar().year, previous_date.isocalendar().week)
    previous_month = (previous_date.year, previous_date.month)
    previous_quarter = (previous_date.year, (previous_date.month - 1) // 3)
    previous_half = (previous_date.year, 1 if previous_date.month <= 6 else 2)
    previous_year = previous_date.year
    for index, raw_date in enumerate(trade_dates[1:], start=1):
        current_date = _parse_date(raw_date)
        current_bucket = (current_date.isocalendar().year, current_date.isocalendar().week)
        current_month = (current_date.year, current_date.month)
        current_quarter = (current_date.year, (current_date.month - 1) // 3)
        current_half = (current_date.year, 1 if current_date.month <= 6 else 2)
        current_year = current_date.year
        if normalized_frequency == "daily":
            keys.append(index)
        elif normalized_frequency == "weekly" and current_bucket != previous_bucket:
            keys.append(index)
        elif normalized_frequency == "monthly" and current_month != previous_month:
            keys.append(index)
        elif normalized_frequency == "quarterly" and current_quarter != previous_quarter:
            keys.append(index)
        elif normalized_frequency == "semiannual" and current_half != previous_half:
            keys.append(index)
        elif normalized_frequency == "yearly" and current_year != previous_year:
            keys.append(index)
        elif normalized_frequency not in {"daily", "weekly", "monthly", "quarterly", "semiannual", "yearly"} and current_bucket != previous_bucket:
            keys.append(index)
        previous_bucket = current_bucket
        previous_month = current_month
        previous_quarter = current_quarter
        previous_half = current_half
        previous_year = current_year
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


def _clamp_weight(value: float) -> float:
    return max(0.0, min(1.0, value))


def _clamp_signed_weight(value: float) -> float:
    return max(-1.0, min(1.0, value))


def _tradeable_open(bar: MarketBar) -> float:
    if bar.open > 0:
        return bar.open
    if bar.close > 0:
        return bar.close
    return bar.adj_close


def _tradeable_close(bar: MarketBar) -> float:
    if bar.close > 0:
        return bar.close
    if bar.adj_close > 0:
        return bar.adj_close
    return bar.open


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


def _bollinger_bands(series: list[MarketBar], index: int, period: int, width: float = 2.0) -> tuple[float, float] | None:
    if period <= 1 or index + 1 < period:
        return None
    closes = [_tradeable_close(bar) for bar in series[index - period + 1 : index + 1]]
    if any(value <= 0 for value in closes):
        return None
    basis = mean(closes)
    deviation = pstdev(closes) if len(closes) > 1 else 0.0
    return basis + width * deviation, basis - width * deviation


def _rsi(series: list[MarketBar], index: int, period: int) -> float | None:
    if period <= 0 or index < period:
        return None
    gains: list[float] = []
    losses: list[float] = []
    for position in range(index - period + 1, index + 1):
        current = _tradeable_close(series[position])
        previous = _tradeable_close(series[position - 1])
        if current <= 0 or previous <= 0:
            return None
        delta = current - previous
        gains.append(max(delta, 0.0))
        losses.append(abs(min(delta, 0.0)))
    average_gain = sum(gains) / period
    average_loss = sum(losses) / period
    if average_loss <= 0:
        return 100.0 if average_gain > 0 else 50.0
    relative_strength = average_gain / average_loss
    return 100.0 - (100.0 / (1.0 + relative_strength))


def _atr(series: list[MarketBar], index: int, period: int) -> float | None:
    if period <= 0 or index < period:
        return None
    true_ranges: list[float] = []
    for position in range(index - period + 1, index + 1):
        bar = series[position]
        previous_close = _tradeable_close(series[position - 1])
        if previous_close <= 0:
            return None
        high = bar.high if bar.high > 0 else max(_tradeable_open(bar), _tradeable_close(bar))
        low = bar.low if bar.low > 0 else min(_tradeable_open(bar), _tradeable_close(bar))
        true_ranges.append(max(high - low, abs(high - previous_close), abs(low - previous_close)))
    return sum(true_ranges) / len(true_ranges) if true_ranges else None


def _run_grid_backtest(
    symbol_series: Mapping[str, list[MarketBar]],
    *,
    config: BacktestConfig,
    parameters: Mapping[str, Any],
    benchmark_series: list[MarketBar],
    master_dates: list[str],
) -> BacktestResult:
    primary_symbol = config.benchmark_symbol if config.benchmark_symbol in symbol_series else next(iter(symbol_series.keys()))
    primary_series = symbol_series.get(primary_symbol, [])
    if len(master_dates) < 2 or len(primary_series) < 2:
        empty_metrics = BacktestMetrics(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
        return BacktestResult(metrics=empty_metrics, warnings=["Not enough benchmark dates for requested range"])

    primary_index = {bar.date: idx for idx, bar in enumerate(primary_series)}
    benchmark_index = {bar.date: idx for idx, bar in enumerate(benchmark_series)}

    initial_weight = _clamp_weight(_to_float(parameters.get("initial_position"), 0.0) / 100.0)
    buy_trigger = max(_to_float(parameters.get("grid_interval"), 0.0) / 100.0, 0.0)
    buy_step = max(_to_float(parameters.get("buy_size_pct"), 0.0) / 100.0, 0.0)
    sell_trigger = max(_to_float(parameters.get("sell_step_pct"), 0.0) / 100.0, 0.0)
    sell_step = max(_to_float(parameters.get("sell_size_pct"), 0.0) / 100.0, 0.0)
    max_stop_loss_pct = _to_float(parameters.get("max_stop_loss_pct"), 0.0)

    equity = config.initial_equity
    equity_curve = [equity]
    returns: list[float] = []
    daily_points: list[DailyPerformancePoint] = []
    trades: list[TradeRecord] = []
    total_turnover = 0.0
    winning_days = 0
    position_weight = 0.0
    anchor_price: float | None = None
    entry_anchor_price: float | None = None
    oos_cut = max(int(len(master_dates) * (1.0 - config.oos_fraction)), 1)
    first_index = primary_index.get(master_dates[0])
    if first_index is not None and initial_weight > 0:
        first_bar = primary_series[first_index]
        first_open = _tradeable_open(first_bar)
        first_close = _tradeable_close(first_bar)
        if first_open > 0 and first_close > 0:
            position_weight = initial_weight
            anchor_price = first_open
            entry_anchor_price = first_open
            trades.append(
                TradeRecord(
                    date=master_dates[0],
                    symbol=primary_symbol,
                    action="buy",
                    price=first_open,
                    weight_before=0.0,
                    weight_after=position_weight,
                    reason="grid:init",
                )
            )
            total_turnover += position_weight
            strategy_return = position_weight * (first_close / first_open - 1.0)
            equity *= 1.0 + strategy_return
            returns.append(strategy_return)
            if strategy_return > 0:
                winning_days += 1
            equity_curve.append(equity)
            peak = max(equity_curve)
            drawdown = equity / peak - 1.0 if peak else 0.0
            benchmark_return = 0.0
            benchmark_pos = benchmark_index.get(master_dates[0])
            if benchmark_pos is not None:
                benchmark_bar = benchmark_series[benchmark_pos]
                benchmark_open = _tradeable_open(benchmark_bar)
                benchmark_close = _tradeable_close(benchmark_bar)
                if benchmark_open > 0 and benchmark_close > 0:
                    benchmark_return = benchmark_close / benchmark_open - 1.0
            daily_points.append(
                DailyPerformancePoint(
                    date=master_dates[0],
                    equity=equity,
                    strategy_return=strategy_return,
                    benchmark_return=benchmark_return,
                    drawdown=drawdown,
                    exposure=position_weight,
                    universe_size=1,
                    in_sample=0 < oos_cut,
                )
            )

    for index in range(1, len(master_dates)):
        execution_date = master_dates[index]
        previous_date = master_dates[index - 1]
        position_index = primary_index.get(execution_date)
        previous_index = primary_index.get(previous_date)
        if position_index is None or previous_index is None:
            continue

        bar = primary_series[position_index]
        previous_bar = primary_series[previous_index]
        execution_price = _tradeable_open(bar)
        previous_close = _tradeable_close(previous_bar)
        current_close = _tradeable_close(bar)
        previous_weight = position_weight
        trade_reason: str | None = None

        if entry_anchor_price and max_stop_loss_pct < 0 and previous_close <= entry_anchor_price * (1.0 + max_stop_loss_pct / 100.0) and position_weight > 0:
            position_weight = 0.0
            anchor_price = execution_price
            trade_reason = "grid:stop"
        elif anchor_price and buy_trigger > 0 and buy_step > 0 and position_weight < 1.0 and previous_close <= anchor_price * (1.0 - buy_trigger):
            position_weight = _clamp_weight(position_weight + buy_step)
            anchor_price = execution_price
            trade_reason = "grid:buy"
        elif anchor_price and sell_trigger > 0 and sell_step > 0 and position_weight > 0.0 and previous_close >= anchor_price * (1.0 + sell_trigger):
            position_weight = _clamp_weight(position_weight - sell_step)
            anchor_price = execution_price
            trade_reason = "grid:sell"

        if trade_reason and abs(position_weight - previous_weight) > 1e-9:
            trades.append(
                TradeRecord(
                    date=execution_date,
                    symbol=primary_symbol,
                    action="buy" if position_weight > previous_weight else "sell",
                    price=execution_price,
                    weight_before=previous_weight,
                    weight_after=position_weight,
                    reason=trade_reason,
                )
            )
            total_turnover += abs(position_weight - previous_weight)
            if position_weight <= 0:
                entry_anchor_price = None
            elif entry_anchor_price is None:
                entry_anchor_price = execution_price

        strategy_return = 0.0
        if previous_close > 0 and execution_price > 0:
            overnight_return = execution_price / previous_close - 1.0
            strategy_return += previous_weight * overnight_return
        if execution_price > 0 and current_close > 0:
            intraday_return = current_close / execution_price - 1.0
            strategy_return += position_weight * intraday_return
        equity *= 1.0 + strategy_return
        returns.append(strategy_return)
        if strategy_return > 0:
            winning_days += 1
        equity_curve.append(equity)
        peak = max(equity_curve)
        drawdown = equity / peak - 1.0 if peak else 0.0

        benchmark_return = 0.0
        benchmark_pos = benchmark_index.get(execution_date)
        if benchmark_pos is not None and benchmark_pos > 0:
            current = _tradeable_close(benchmark_series[benchmark_pos])
            prior = _tradeable_close(benchmark_series[benchmark_pos - 1])
            if prior > 0:
                benchmark_return = current / prior - 1.0

        daily_points.append(
            DailyPerformancePoint(
                date=execution_date,
                equity=equity,
                strategy_return=strategy_return,
                benchmark_return=benchmark_return,
                drawdown=drawdown,
                exposure=position_weight,
                universe_size=1,
                in_sample=index < oos_cut,
            )
        )

    total_return, cagr, volatility, sharpe, max_drawdown = _curve_metrics(equity_curve, returns)
    oos_returns = [point.strategy_return for point in daily_points if not point.in_sample]
    oos_curve = [1.0]
    for value in oos_returns:
        oos_curve.append(oos_curve[-1] * (1.0 + value))
    _, oos_cagr, _, oos_sharpe, _ = _curve_metrics(oos_curve, oos_returns)
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
        effective_date=master_dates[0] if master_dates else None,
        oos_start_date=master_dates[oos_cut] if master_dates and oos_cut < len(master_dates) else (master_dates[-1] if master_dates else None),
        coverage_ratio=1.0 if daily_points else 0.0,
        coverage_days=len(daily_points),
    )


def _run_mean_reversion_backtest(
    symbol_series: Mapping[str, list[MarketBar]],
    *,
    config: BacktestConfig,
    parameters: Mapping[str, Any],
    benchmark_series: list[MarketBar],
    master_dates: list[str],
) -> BacktestResult:
    primary_symbol = config.benchmark_symbol if config.benchmark_symbol in symbol_series else next(iter(symbol_series.keys()))
    primary_series = symbol_series.get(primary_symbol, [])
    if len(master_dates) < 2 or len(primary_series) < 2:
        empty_metrics = BacktestMetrics(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
        return BacktestResult(metrics=empty_metrics, warnings=["Not enough benchmark dates for requested range"])

    primary_index = {bar.date: idx for idx, bar in enumerate(primary_series)}
    benchmark_index = {bar.date: idx for idx, bar in enumerate(benchmark_series)}

    bollinger_period = max(int(parameters.get("bollinger_period") or 20), 2)
    bollinger_width = max(_to_float(parameters.get("bollinger_width"), 2.0), 0.5)
    rsi_period = max(int(parameters.get("rsi_period") or 6), 1)
    rsi_buy_threshold = _to_float(parameters.get("rsi_buy_threshold"), 30.0)
    rsi_sell_threshold = _to_float(parameters.get("rsi_sell_threshold"), 70.0)
    atr_period = max(int(parameters.get("atr_period") or 14), 1)
    take_profit_atr = max(_to_float(parameters.get("take_profit_atr"), 1.5), 0.0)
    stop_loss_atr = max(_to_float(parameters.get("stop_loss_atr"), 1.0), 0.0)
    long_entry_weight = _clamp_weight(_to_float(parameters.get("long_entry_size_pct"), 0.0) / 100.0)
    short_entry_weight = _clamp_weight(_to_float(parameters.get("short_entry_size_pct"), 0.0) / 100.0)

    equity = max(_to_float(parameters.get("capital"), config.initial_equity), 1.0)
    equity_curve = [equity]
    returns: list[float] = []
    daily_points: list[DailyPerformancePoint] = []
    trades: list[TradeRecord] = []
    total_turnover = 0.0
    winning_days = 0
    position_weight = 0.0
    entry_price: float | None = None
    effective_date: str | None = None
    oos_cut = max(int(len(master_dates) * (1.0 - config.oos_fraction)), 1)

    for index in range(1, len(master_dates)):
        execution_date = master_dates[index]
        previous_date = master_dates[index - 1]
        position_index = primary_index.get(execution_date)
        previous_index = primary_index.get(previous_date)
        if position_index is None or previous_index is None:
            continue

        current_bar = primary_series[position_index]
        previous_bar = primary_series[previous_index]
        execution_price = _tradeable_open(current_bar)
        previous_close = _tradeable_close(previous_bar)
        current_close = _tradeable_close(current_bar)
        signal_index = previous_index
        previous_weight = position_weight
        trade_reason: str | None = None

        if entry_price is not None and position_weight != 0.0:
            atr_value = _atr(primary_series, signal_index, atr_period)
            if atr_value is not None and atr_value > 0:
                if position_weight > 0:
                    take_profit_price = entry_price + take_profit_atr * atr_value if take_profit_atr > 0 else None
                    stop_loss_price = entry_price - stop_loss_atr * atr_value if stop_loss_atr > 0 else None
                    if take_profit_price is not None and previous_close >= take_profit_price:
                        position_weight = 0.0
                        entry_price = None
                        trade_reason = "mean_reversion:take_profit_long"
                    elif stop_loss_price is not None and previous_close <= stop_loss_price:
                        position_weight = 0.0
                        entry_price = None
                        trade_reason = "mean_reversion:stop_loss_long"
                else:
                    take_profit_price = entry_price - take_profit_atr * atr_value if take_profit_atr > 0 else None
                    stop_loss_price = entry_price + stop_loss_atr * atr_value if stop_loss_atr > 0 else None
                    if take_profit_price is not None and previous_close <= take_profit_price:
                        position_weight = 0.0
                        entry_price = None
                        trade_reason = "mean_reversion:take_profit_short"
                    elif stop_loss_price is not None and previous_close >= stop_loss_price:
                        position_weight = 0.0
                        entry_price = None
                        trade_reason = "mean_reversion:stop_loss_short"

        if trade_reason is None and position_weight == 0.0:
            bands = _bollinger_bands(primary_series, signal_index, bollinger_period, bollinger_width)
            rsi_value = _rsi(primary_series, signal_index, rsi_period)
            if bands is not None and rsi_value is not None and execution_price > 0:
                upper_band, lower_band = bands
                if long_entry_weight > 0 and previous_close <= lower_band and rsi_value < rsi_buy_threshold:
                    position_weight = _clamp_signed_weight(long_entry_weight)
                    entry_price = execution_price
                    trade_reason = "mean_reversion:long_entry"
                elif short_entry_weight > 0 and previous_close >= upper_band and rsi_value > rsi_sell_threshold:
                    position_weight = _clamp_signed_weight(-short_entry_weight)
                    entry_price = execution_price
                    trade_reason = "mean_reversion:short_entry"

        if trade_reason and abs(position_weight - previous_weight) > 1e-9:
            trades.append(
                TradeRecord(
                    date=execution_date,
                    symbol=primary_symbol,
                    action="buy" if position_weight > previous_weight else "sell",
                    price=execution_price,
                    weight_before=previous_weight,
                    weight_after=position_weight,
                    reason=trade_reason,
                )
            )
            total_turnover += abs(position_weight - previous_weight)
            if effective_date is None:
                effective_date = execution_date

        strategy_return = 0.0
        if previous_close > 0 and execution_price > 0:
            overnight_return = execution_price / previous_close - 1.0
            strategy_return += previous_weight * overnight_return
        if execution_price > 0 and current_close > 0:
            intraday_return = current_close / execution_price - 1.0
            strategy_return += position_weight * intraday_return
        if trade_reason:
            strategy_return -= (config.transaction_cost_bps / 10000.0) * abs(position_weight - previous_weight)

        equity *= 1.0 + strategy_return
        returns.append(strategy_return)
        if strategy_return > 0:
            winning_days += 1
        equity_curve.append(equity)
        peak = max(equity_curve)
        drawdown = equity / peak - 1.0 if peak else 0.0

        benchmark_return = 0.0
        benchmark_pos = benchmark_index.get(execution_date)
        if benchmark_pos is not None and benchmark_pos > 0:
            current = _tradeable_close(benchmark_series[benchmark_pos])
            prior = _tradeable_close(benchmark_series[benchmark_pos - 1])
            if prior > 0:
                benchmark_return = current / prior - 1.0

        daily_points.append(
            DailyPerformancePoint(
                date=execution_date,
                equity=equity,
                strategy_return=strategy_return,
                benchmark_return=benchmark_return,
                drawdown=drawdown,
                exposure=abs(position_weight),
                universe_size=1,
                in_sample=index < oos_cut,
            )
        )

    total_return, cagr, volatility, sharpe, max_drawdown = _curve_metrics(equity_curve, returns)
    oos_returns = [point.strategy_return for point in daily_points if not point.in_sample]
    oos_curve = [1.0]
    for value in oos_returns:
        oos_curve.append(oos_curve[-1] * (1.0 + value))
    _, oos_cagr, _, oos_sharpe, _ = _curve_metrics(oos_curve, oos_returns)
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
    fallback_effective_date = master_dates[1] if len(master_dates) > 1 else (master_dates[0] if master_dates else None)
    oos_start_date = master_dates[oos_cut] if master_dates and oos_cut < len(master_dates) else (master_dates[-1] if master_dates else None)
    return BacktestResult(
        metrics=metrics,
        daily_performance=daily_points,
        trades=trades,
        warnings=[],
        effective_date=effective_date or fallback_effective_date,
        oos_start_date=oos_start_date,
        coverage_ratio=1.0 if daily_points else 0.0,
        coverage_days=len(daily_points),
    )


def _run_buy_and_hold_backtest(
    symbol_series: Mapping[str, list[MarketBar]],
    *,
    config: BacktestConfig,
    parameters: Mapping[str, Any],
    benchmark_series: list[MarketBar],
    master_dates: list[str],
) -> BacktestResult:
    primary_symbol = config.benchmark_symbol if config.benchmark_symbol in symbol_series else next(iter(symbol_series.keys()))
    primary_series = symbol_series.get(primary_symbol, [])
    if not master_dates or not primary_series:
        empty_metrics = BacktestMetrics(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
        return BacktestResult(metrics=empty_metrics, warnings=["Not enough benchmark dates for requested range"])

    primary_index = {bar.date: idx for idx, bar in enumerate(primary_series)}
    benchmark_index = {bar.date: idx for idx, bar in enumerate(benchmark_series)}

    contribution_amount = _to_float(parameters.get("contribution_amount"), 0.0)
    frequency = str(parameters.get("investment_frequency") or parameters.get("rebalance_frequency") or "never").lower()
    if contribution_amount <= 0:
        contribution_amount = config.initial_equity
        frequency = "never"

    contribution_indexes = [idx for idx in _rebalance_keys(master_dates, frequency) if 0 <= idx < len(master_dates)]
    if not contribution_indexes:
        contribution_indexes = [0]
    contribution_set = set(contribution_indexes)

    cash = 0.0
    shares = 0.0
    total_contributed = 0.0
    prior_account_value = 0.0
    equity_curve = [1.0]
    returns: list[float] = []
    oos_cut = max(int(len(master_dates) * (1.0 - config.oos_fraction)), 1)
    daily_points: list[DailyPerformancePoint] = []
    trades: list[TradeRecord] = []
    total_turnover = 0.0
    coverage_days = 0
    effective_date: str | None = None
    warnings: list[str] = []

    for master_index, trade_date in enumerate(master_dates):
        position_index = primary_index.get(trade_date)
        if position_index is None:
            continue

        bar = primary_series[position_index]
        execution_price = bar.adj_close if bar.adj_close > 0 else _tradeable_open(bar)
        trade_flow = 0.0
        if master_index in contribution_set:
            trade_flow = contribution_amount
            market_value_before = shares * execution_price
            total_equity_before = cash + market_value_before
            weight_before = market_value_before / total_equity_before if total_equity_before > 0 else 0.0
            cash += contribution_amount
            total_contributed += contribution_amount

            if execution_price > 0:
                fee = cash * (config.transaction_cost_bps / 10000.0)
                deployable_cash = max(cash - fee, 0.0)
                purchased_shares = deployable_cash / execution_price if deployable_cash > 0 else 0.0
                shares += purchased_shares
                cash -= purchased_shares * execution_price + fee
                total_equity_after = cash + shares * execution_price
                weight_after = (shares * execution_price) / total_equity_after if total_equity_after > 0 else 0.0
                trades.append(
                    TradeRecord(
                        date=trade_date,
                        symbol=primary_symbol,
                        action="buy",
                        price=execution_price,
                        weight_before=weight_before,
                        weight_after=weight_after,
                        reason=f"buy_and_hold:{frequency}",
                    )
                )
                total_turnover += 1.0
                if effective_date is None:
                    effective_date = trade_date
            else:
                warnings.append(f"Skipped scheduled contribution on {trade_date} because no tradeable price was available.")

        mark_price = bar.adj_close if bar.adj_close > 0 else _tradeable_close(bar)
        account_value = cash + shares * mark_price
        nav_multiple = account_value / total_contributed if total_contributed > 0 else 1.0
        strategy_return = 0.0
        if prior_account_value > 0:
            strategy_return = (account_value - trade_flow - prior_account_value) / prior_account_value
        benchmark_return = 0.0
        benchmark_pos = benchmark_index.get(trade_date)
        if benchmark_pos is not None and benchmark_pos > 0:
            current = benchmark_series[benchmark_pos].adj_close
            prior = benchmark_series[benchmark_pos - 1].adj_close
            if prior > 0:
                benchmark_return = current / prior - 1.0

        returns.append(strategy_return)
        equity_curve.append(nav_multiple)
        peak = max(equity_curve)
        drawdown = nav_multiple / peak - 1.0 if peak else 0.0
        exposure = (shares * mark_price) / account_value if account_value > 0 else 0.0
        active = total_contributed > 0 and account_value > 0
        if active:
            coverage_days += 1
        daily_points.append(
            DailyPerformancePoint(
                date=trade_date,
                equity=nav_multiple,
                strategy_return=strategy_return,
                benchmark_return=benchmark_return,
                drawdown=drawdown,
                exposure=exposure,
                universe_size=1 if active else 0,
                in_sample=master_index < oos_cut,
            )
        )
        prior_account_value = account_value

    total_return, cagr, volatility, sharpe, max_drawdown = _curve_metrics(equity_curve, returns)
    winning_days = sum(1 for value in returns if value > 0)
    oos_returns = [point.strategy_return for point in daily_points if not point.in_sample]
    oos_curve = [1.0]
    for value in oos_returns:
        oos_curve.append(oos_curve[-1] * (1.0 + value))
    _, oos_cagr, _, oos_sharpe, _ = _curve_metrics(oos_curve, oos_returns)
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
    coverage_ratio = coverage_days / len(daily_points) if daily_points else 0.0
    return BacktestResult(
        metrics=metrics,
        daily_performance=daily_points,
        trades=trades,
        warnings=warnings,
        effective_date=effective_date,
        oos_start_date=master_dates[oos_cut] if master_dates and oos_cut < len(master_dates) else (master_dates[-1] if master_dates else None),
        coverage_ratio=coverage_ratio,
        coverage_days=coverage_days,
    )


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
    if str(template_key).lower() == "grid":
        return _run_grid_backtest(
            symbol_series,
            config=config,
            parameters=parameters,
            benchmark_series=benchmark_series,
            master_dates=master_dates,
        )
    if str(template_key).lower() in {"mean_reversion", "reversion"}:
        return _run_mean_reversion_backtest(
            symbol_series,
            config=config,
            parameters=parameters,
            benchmark_series=benchmark_series,
            master_dates=master_dates,
        )
    if str(template_key).lower() in {"buy_and_hold", "dca"}:
        return _run_buy_and_hold_backtest(
            symbol_series,
            config=config,
            parameters=parameters,
            benchmark_series=benchmark_series,
            master_dates=master_dates,
        )
    if len(master_dates) < lookback_days + 2:
        empty_metrics = BacktestMetrics(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
        return BacktestResult(metrics=empty_metrics, warnings=["Not enough benchmark dates for requested lookback"])
    index_by_symbol = {
        symbol: {bar.date: idx for idx, bar in enumerate(series)}
        for symbol, series in symbol_series.items()
    }
    rebalance_indexes = [idx for idx in _rebalance_keys(master_dates, frequency) if idx >= lookback_days and idx < len(master_dates) - 1]
    if not rebalance_indexes:
        rebalance_indexes = [min(max(lookback_days, 0), len(master_dates) - 2)]
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

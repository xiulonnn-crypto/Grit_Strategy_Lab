from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from statistics import mean, pstdev
from typing import Any, Iterable, Mapping


def _to_date(value: str | date | None) -> date | None:
    if value is None:
        return None
    if isinstance(value, date):
        return value
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date()


def _trade_date(point: Mapping[str, Any]) -> str | None:
    return point.get("trade_date") or point.get("date")


def _strategy_returns(points: list[Mapping[str, Any]]) -> list[float]:
    returns: list[float] = []
    previous_equity: float | None = None
    for point in points:
        if point.get("strategy_return") is not None:
            returns.append(float(point.get("strategy_return") or 0.0))
            continue
        equity = float(point.get("equity") or 0.0)
        if previous_equity and previous_equity > 0:
            returns.append(equity / previous_equity - 1.0)
        previous_equity = equity
    return returns


def metric_summary(metrics: Mapping[str, Any] | None) -> dict[str, Any]:
    metrics = dict(metrics or {})
    return {
        "total_return": float(metrics.get("total_return") or 0.0),
        "cagr": float(metrics.get("cagr") or 0.0),
        "annualized_return": float(metrics.get("annualized_return") or metrics.get("cagr") or 0.0),
        "annualized_volatility": float(metrics.get("annualized_volatility") or 0.0),
        "sharpe": float(metrics.get("sharpe") or 0.0),
        "max_drawdown": float(metrics.get("max_drawdown") or 0.0),
        "turnover": float(metrics.get("turnover") or 0.0),
        "win_rate": float(metrics.get("win_rate") or 0.0),
        "oos_cagr": float(metrics.get("oos_cagr") or 0.0),
        "oos_sharpe": float(metrics.get("oos_sharpe") or 0.0),
    }


def build_relative_metrics(points: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    rows = list(points)
    strategy = [float(point.get("strategy_return") or 0.0) for point in rows]
    benchmark = [float(point.get("benchmark_return") or 0.0) for point in rows]
    excess = [lhs - rhs for lhs, rhs in zip(strategy, benchmark)]
    capture = sum(strategy) / sum(benchmark) if benchmark and abs(sum(benchmark)) > 1e-9 else 0.0
    return {
        "alpha_proxy": sum(excess),
        "average_excess_return": mean(excess) if excess else 0.0,
        "capture_ratio": capture,
    }


def build_consistency_score(points: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    returns = _strategy_returns(list(points))
    positive_share = sum(1 for value in returns if value > 0) / len(returns) if returns else 0.0
    volatility = pstdev(returns) if len(returns) > 1 else 0.0
    score = max(0.0, min(1.0, positive_share * (1.0 / (1.0 + volatility * 10.0))))
    return {"score": score, "positive_day_share": positive_share}


def build_risk_metrics(
    metrics: Mapping[str, Any] | Iterable[Mapping[str, Any]],
    points: Iterable[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    if points is None and not isinstance(metrics, Mapping):
        points = metrics
        metrics = {}
    elif points is None:
        points = []
    returns = _strategy_returns(list(points))
    downside = [value for value in returns if value < 0]
    downside_dev = pstdev(downside) if len(downside) > 1 else (abs(downside[0]) if downside else 0.0)
    return {
        "max_drawdown": float(metrics.get("max_drawdown") or 0.0),
        "annualized_volatility": float(metrics.get("annualized_volatility") or 0.0),
        "downside_deviation": downside_dev,
        "worst_day": min(returns) if returns else 0.0,
    }


def build_drawdown_events(
    points: Iterable[Mapping[str, Any]],
    oos_start_date: str | None = None,
) -> list[dict[str, Any]]:
    rows = list(points)
    events: list[dict[str, Any]] = []
    current_start: str | None = None
    trough = 0.0
    trough_date: str | None = None
    for point in rows:
        drawdown = float(point.get("drawdown") or 0.0)
        point_date = _trade_date(point)
        if drawdown < 0 and current_start is None:
            current_start = point_date
            trough = drawdown
            trough_date = point_date
            continue
        if current_start is None:
            continue
        if drawdown < trough:
            trough = drawdown
            trough_date = point_date
        if drawdown >= 0:
            events.append(
                {
                    "start_date": current_start,
                    "trough_date": trough_date,
                    "drawdown_pct": round(trough * 100.0 if abs(trough) <= 1 else trough, 4),
                    "recovery_date": point_date,
                    "status": "recovered",
                    "segment": "OOS" if oos_start_date and point_date and point_date >= oos_start_date else "IS",
                }
            )
            current_start = None
            trough = 0.0
            trough_date = None
    if current_start is not None:
        events.append(
            {
                "start_date": current_start,
                "trough_date": trough_date,
                "drawdown_pct": round(trough * 100.0 if abs(trough) <= 1 else trough, 4),
                "recovery_date": None,
                "status": "unrecovered",
                "segment": "OOS" if oos_start_date and current_start >= oos_start_date else "IS",
            }
        )
    return events


def build_rolling_metrics(points: Iterable[Mapping[str, Any]], window: int | None = 21) -> list[dict[str, Any]]:
    if window is None or window <= 1:
        return []
    rows = list(points)
    if len(rows) < window:
        return []
    rolling: list[dict[str, Any]] = []
    returns = _strategy_returns(rows)
    for index in range(window - 1, len(rows)):
        chunk = returns[index - window + 1 : index + 1]
        rolling.append(
            {
                "trade_date": _trade_date(rows[index]),
                "window_return_pct": round(sum(chunk) * 100.0, 4),
                "window_volatility_pct": round((pstdev(chunk) if len(chunk) > 1 else 0.0) * 100.0, 4),
            }
        )
    return rolling


def build_monthly_returns(
    points: Iterable[Mapping[str, Any]],
    oos_start_date: str | None = None,
) -> list[dict[str, Any]]:
    buckets: dict[str, Mapping[str, Any]] = {}
    for point in points:
        point_date = _to_date(_trade_date(point))
        if point_date is None:
            continue
        buckets[point_date.strftime("%Y-%m")] = dict(point)

    monthly: list[dict[str, Any]] = []
    previous_equity: float | None = None
    for month in sorted(buckets):
        point = buckets[month]
        equity = float(point.get("equity") or 0.0)
        trade_date = _trade_date(point)
        if previous_equity and previous_equity > 0:
            return_pct = round((equity / previous_equity - 1.0) * 100.0, 4)
        else:
            return_pct = None
        segment = "OOS" if (point.get("is_oos") or (oos_start_date and trade_date and trade_date >= oos_start_date)) else "IS"
        monthly.append({"month": month, "trade_date": trade_date, "return_pct": return_pct, "segment": segment})
        previous_equity = equity
    return monthly

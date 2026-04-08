from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from math import sqrt
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


def _drawdown_pct(point: Mapping[str, Any]) -> float:
    drawdown = float(point.get("drawdown") or 0.0)
    # Chart series already stores drawdown in percentage points, while
    # engine daily points store it as a ratio.
    if point.get("trade_date") and not point.get("date"):
        return drawdown
    return drawdown * 100.0 if abs(drawdown) <= 1 else drawdown


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
    trough_point: Mapping[str, Any] | None = None
    for point in rows:
        drawdown = float(point.get("drawdown") or 0.0)
        point_date = _trade_date(point)
        if drawdown < 0 and current_start is None:
            current_start = point_date
            trough = drawdown
            trough_date = point_date
            trough_point = point
            continue
        if current_start is None:
            continue
        if drawdown < trough:
            trough = drawdown
            trough_date = point_date
            trough_point = point
        if drawdown >= 0:
            events.append(
                {
                    "start_date": current_start,
                    "trough_date": trough_date,
                    "drawdown_pct": round(_drawdown_pct(trough_point or {"date": trough_date, "drawdown": trough}), 4),
                    "recovery_date": point_date,
                    "status": "recovered",
                    "segment": "OOS" if oos_start_date and point_date and point_date >= oos_start_date else "IS",
                }
            )
            current_start = None
            trough = 0.0
            trough_date = None
            trough_point = None
    if current_start is not None:
        events.append(
            {
                "start_date": current_start,
                "trough_date": trough_date,
                "drawdown_pct": round(_drawdown_pct(trough_point or {"date": trough_date, "drawdown": trough}), 4),
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


def _return_series(points: Iterable[Mapping[str, Any]], key: str) -> list[float]:
    return [float(point.get(key) or 0.0) for point in points]


def _curve_return_series(points: Iterable[Mapping[str, Any]], key: str) -> list[float]:
    returns: list[float] = []
    previous_value: float | None = None
    for point in points:
        current_value = float(point.get(key) or 0.0)
        if previous_value is not None and previous_value > 0 and current_value > 0:
            returns.append(current_value / previous_value - 1.0)
        if current_value > 0:
            previous_value = current_value
    return returns


def _compound_return(returns: Iterable[float]) -> float:
    equity = 1.0
    for value in returns:
        equity *= 1.0 + float(value)
    return equity - 1.0


def _series_total_return(points: Iterable[Mapping[str, Any]], key: str) -> float:
    return _compound_return(_return_series(points, key))


def _curve_total_return(points: Iterable[Mapping[str, Any]], key: str) -> float:
    rows = [point for point in points if float(point.get(key) or 0.0) > 0]
    if len(rows) < 2:
        return 0.0
    first_value = float(rows[0].get(key) or 0.0)
    last_value = float(rows[-1].get(key) or 0.0)
    if first_value <= 0:
        return 0.0
    return last_value / first_value - 1.0


def _annualized_sharpe(returns: Iterable[float]) -> float:
    rows = list(returns)
    if len(rows) < 2:
        return 0.0
    volatility = pstdev(rows)
    if abs(volatility) <= 1e-9:
        return 0.0
    return mean(rows) / volatility * sqrt(252.0)


def _max_drawdown_from_series(points: Iterable[Mapping[str, Any]], key: str) -> float:
    peak: float | None = None
    max_drawdown = 0.0
    for point in points:
        equity = float(point.get(key) or 0.0)
        if equity <= 0:
            continue
        if peak is None or equity > peak:
            peak = equity
        if peak and peak > 0:
            max_drawdown = min(max_drawdown, equity / peak - 1.0)
    return max_drawdown


def _segment_points(
    points: Iterable[Mapping[str, Any]],
    *,
    oos: bool,
    oos_start_date: str | None = None,
) -> list[Mapping[str, Any]]:
    rows: list[Mapping[str, Any]] = []
    for point in points:
        is_oos = bool(point.get("is_oos"))
        point_date = _trade_date(point)
        if not is_oos and oos_start_date and point_date:
            is_oos = point_date >= oos_start_date
        if is_oos == oos:
            rows.append(point)
    return rows


def _segment_trade_counts(run_detail: Mapping[str, Any]) -> tuple[int, int]:
    trade_items = list(
        run_detail.get("trades")
        or run_detail.get("trade_details")
        or run_detail.get("trade_audit_items")
        or []
    )
    if not trade_items:
        return int(run_detail.get("trades_count") or 0), 0
    train_count = 0
    test_count = 0
    oos_start_date = str(run_detail.get("oos_start_date") or "") or None
    for item in trade_items:
        segment = str(item.get("segment") or "").upper()
        if not segment:
            trade_date = str(item.get("trade_date") or item.get("opened_at") or item.get("closed_at") or "")
            segment = "OOS" if oos_start_date and trade_date and trade_date >= oos_start_date else "IS"
        if segment == "OOS":
            test_count += 1
        else:
            train_count += 1
    return train_count, test_count


def _format_signed_percent(value: float | None, *, decimals: int = 1) -> str:
    if value is None:
        return "—"
    return f"{value * 100.0:+.{decimals}f}%"


def _format_percent(value: float | None, *, decimals: int = 1) -> str:
    if value is None:
        return "—"
    return f"{value * 100.0:.{decimals}f}%"


def _format_decimal(value: float | None, *, decimals: int = 2, signed: bool = False) -> str:
    if value is None:
        return "—"
    sign = "+" if signed else ""
    return f"{value:{sign}.{decimals}f}"


def _trend_direction(delta: float, *, better_when_lower: bool = False) -> str:
    if abs(delta) <= 1e-9:
        return "flat"
    improved = delta < 0 if better_when_lower else delta > 0
    return "up" if improved else "down"


def _insight_payload(text: str, *, tone: str = "neutral", state: str = "ok") -> tuple[str, str, str]:
    return text, tone, state


def _build_subtitle(
    *,
    oos_total_return: float,
    benchmark_total_return: float,
    strategy_drawdown: float,
    benchmark_drawdown: float,
    oos_trade_count: int,
) -> str:
    beats_benchmark = oos_total_return >= benchmark_total_return
    drawdown_stable = abs(strategy_drawdown) <= max(abs(benchmark_drawdown), 1e-9) * 1.1
    if beats_benchmark and drawdown_stable:
        return "测试集收益仍跑赢基准，回撤也维持在可控区间。"
    if beats_benchmark:
        return "测试集收益仍领先基准，但回撤扩张需要继续验证。"
    if oos_trade_count < 20:
        return "测试集样本偏少，当前结论更适合继续观察而不是直接放大。"
    return "测试集表现弱于训练期，建议先复核参数稳定性与出场逻辑。"


def _build_total_return_card(
    *,
    points: list[Mapping[str, Any]],
    oos_points: list[Mapping[str, Any]],
) -> dict[str, Any]:
    strategy_total_return = _curve_total_return(points, "equity")
    benchmark_total_return = _curve_total_return(points, "benchmark")
    delta = strategy_total_return - benchmark_total_return
    oos_total_return = _curve_total_return(oos_points, "equity") if oos_points else 0.0
    oos_benchmark_return = _curve_total_return(oos_points, "benchmark") if oos_points else 0.0
    if delta >= 0:
        insight = _insight_payload("收益保持领先，建议继续核查 Beta 暴露是否过高。", tone="positive")
    else:
        insight = _insight_payload("收益落后基准，建议回看持仓集中度与择时节奏。", tone="warning", state="warning")
    return {
        "key": "total_return",
        "label": "总收益",
        "primary_text": _format_signed_percent(strategy_total_return),
        "trend_direction": _trend_direction(delta),
        "trend_text": f"{'↑' if delta >= 0 else '↓'} {abs(delta) * 100.0:.1f}% vs 基准",
        "compare_text": f"基准: {_format_signed_percent(benchmark_total_return)} | 差值: {_format_signed_percent(delta)} | 测试集: {_format_signed_percent(oos_total_return - oos_benchmark_return)}",
        "insight_text": insight[0],
        "insight_tone": insight[1],
        "state": insight[2],
    }


def _build_sharpe_card(
    *,
    points: list[Mapping[str, Any]],
    oos_points: list[Mapping[str, Any]],
) -> dict[str, Any]:
    strategy_sharpe = _annualized_sharpe(_curve_return_series(points, "equity"))
    benchmark_sharpe = _annualized_sharpe(_curve_return_series(points, "benchmark"))
    oos_sharpe = _annualized_sharpe(_curve_return_series(oos_points, "equity")) if oos_points else 0.0
    delta = strategy_sharpe - benchmark_sharpe
    if oos_sharpe < strategy_sharpe - 0.3:
        insight = _insight_payload("测试集夏普回落明显，建议收缩参数寻优空间。", tone="warning", state="warning")
    elif delta >= 0:
        insight = _insight_payload("风险回报优于基准，可继续观察是否具备跨阶段一致性。", tone="positive")
    else:
        insight = _insight_payload("风险回报落后基准，建议增加低相关性过滤因子。", tone="warning", state="warning")
    return {
        "key": "sharpe",
        "label": "夏普比率",
        "primary_text": _format_decimal(strategy_sharpe, decimals=2),
        "trend_direction": _trend_direction(delta),
        "trend_text": f"{'↑' if delta >= 0 else '↓'} {_format_decimal(abs(delta), decimals=2)}",
        "compare_text": f"基准: {_format_decimal(benchmark_sharpe, decimals=2)} | 差值: {_format_decimal(delta, decimals=2, signed=True)} | 测试集: {_format_decimal(oos_sharpe, decimals=2)}",
        "insight_text": insight[0],
        "insight_tone": insight[1],
        "state": insight[2],
    }


def _build_drawdown_card(
    *,
    metrics: Mapping[str, Any],
    points: list[Mapping[str, Any]],
) -> dict[str, Any]:
    strategy_drawdown = float(metrics.get("max_drawdown") or 0.0)
    benchmark_drawdown = _max_drawdown_from_series(points, "benchmark")
    advantage = abs(benchmark_drawdown) - abs(strategy_drawdown)
    drawdown_ratio = abs(strategy_drawdown) / max(abs(benchmark_drawdown), 1e-9) if benchmark_drawdown else 0.0
    if benchmark_drawdown and drawdown_ratio > 1.5:
        insight = _insight_payload("强制核查平仓逻辑与止损单设置。", tone="warning", state="warning")
    elif advantage >= 0:
        insight = _insight_payload("风控表现优于基准，可评估是否适度提升仓位。", tone="positive")
    else:
        insight = _insight_payload("回撤明显高于基准，建议先优化出场与仓位控制。", tone="warning", state="warning")
    return {
        "key": "max_drawdown",
        "label": "最大回撤",
        "primary_text": _format_signed_percent(strategy_drawdown),
        "trend_direction": _trend_direction(abs(strategy_drawdown) - abs(benchmark_drawdown), better_when_lower=True),
        "trend_text": ("↑ " if advantage >= 0 else "↓ ") + f"{abs(advantage) * 100.0:.1f}% 风控差异",
        "compare_text": f"基准: {_format_signed_percent(benchmark_drawdown)} | 差值: {_format_signed_percent(advantage)}",
        "insight_text": insight[0],
        "insight_tone": insight[1],
        "state": insight[2],
    }


def _build_rolling_return_card(points: list[Mapping[str, Any]]) -> dict[str, Any]:
    window = 252
    returns = _curve_return_series(points, "equity")
    benchmark_returns = _curve_return_series(points, "benchmark")
    if len(returns) < window or len(benchmark_returns) < window:
        insight = _insight_payload("延长回测时间窗口以获取稳健结论。", tone="neutral", state="insufficient_data")
        return {
            "key": "rolling_252_return",
            "label": "最新252日滚动收益",
            "primary_text": "—",
            "trend_direction": "flat",
            "trend_text": "样本不足",
            "compare_text": "基准: — | 差值: —",
            "insight_text": insight[0],
            "insight_tone": insight[1],
            "state": insight[2],
        }
    strategy_rolling = _compound_return(returns[-window:])
    benchmark_rolling = _compound_return(benchmark_returns[-window:])
    delta = strategy_rolling - benchmark_rolling
    if delta >= 0:
        insight = _insight_payload("滚动收益仍领先基准，可继续观察近期斜率是否放缓。", tone="positive")
    else:
        insight = _insight_payload("滚动收益转弱，建议拉长窗口确认是否为阶段性噪声。", tone="warning", state="warning")
    return {
        "key": "rolling_252_return",
        "label": "最新252日滚动收益",
        "primary_text": _format_signed_percent(strategy_rolling),
        "trend_direction": _trend_direction(delta),
        "trend_text": f"{'↑' if delta >= 0 else '↓'} {abs(delta) * 100.0:.1f}% vs 基准",
        "compare_text": f"基准: {_format_signed_percent(benchmark_rolling)} | 差值: {_format_signed_percent(delta)}",
        "insight_text": insight[0],
        "insight_tone": insight[1],
        "state": insight[2],
    }


def _build_trade_count_card(
    *,
    run_detail: Mapping[str, Any],
    train_trade_count: int,
    test_trade_count: int,
) -> dict[str, Any]:
    total_trade_count = int(run_detail.get("trades_count") or (train_trade_count + test_trade_count))
    coverage_days = int(run_detail.get("coverage_days") or 0)
    average_daily_trade_count = total_trade_count / coverage_days if coverage_days > 0 else 0.0
    if average_daily_trade_count > 20:
        insight = _insight_payload("检查佣金摩擦，确认是否为过度交易。", tone="warning", state="warning")
    elif test_trade_count < 20:
        insight = _insight_payload("样本量偏小，警惕随机性导致的过拟合。", tone="warning", state="warning")
    else:
        insight = _insight_payload("样本量处于可读区间，可继续查看测试集逐笔证据。", tone="neutral")
    return {
        "key": "trade_count",
        "label": "交易数",
        "primary_text": str(total_trade_count),
        "trend_direction": "flat",
        "trend_text": f"训练集 {train_trade_count} / 测试集 {test_trade_count}",
        "compare_text": f"训练集: {train_trade_count} | 测试集: {test_trade_count}",
        "insight_text": insight[0],
        "insight_tone": insight[1],
        "state": insight[2],
    }


def build_run_detail_analysis(run_detail: Mapping[str, Any]) -> dict[str, Any]:
    points = list(run_detail.get("chart_series") or [])
    metrics = metric_summary(run_detail.get("metrics"))
    oos_start_date = str(run_detail.get("oos_start_date") or "") or None
    oos_points = _segment_points(points, oos=True, oos_start_date=oos_start_date)
    train_points = _segment_points(points, oos=False, oos_start_date=oos_start_date)
    train_trade_count, test_trade_count = _segment_trade_counts(run_detail)

    total_return_card = _build_total_return_card(points=points, oos_points=oos_points)
    sharpe_card = _build_sharpe_card(points=points, oos_points=oos_points)
    drawdown_card = _build_drawdown_card(metrics=metrics, points=points)
    rolling_card = _build_rolling_return_card(points)
    trade_count_card = _build_trade_count_card(
        run_detail=run_detail,
        train_trade_count=train_trade_count,
        test_trade_count=test_trade_count,
    )

    strategy_total_return = _curve_total_return(points, "equity")
    benchmark_total_return = _curve_total_return(points, "benchmark")
    strategy_sharpe = _annualized_sharpe(_curve_return_series(points, "equity"))
    benchmark_sharpe = _annualized_sharpe(_curve_return_series(points, "benchmark"))
    strategy_drawdown = float(metrics.get("max_drawdown") or 0.0)
    benchmark_drawdown = _max_drawdown_from_series(points, "benchmark")
    train_total_return = _curve_total_return(train_points, "equity") if train_points else 0.0
    oos_total_return = _curve_total_return(oos_points, "equity") if oos_points else 0.0
    train_sharpe = _annualized_sharpe(_curve_return_series(train_points, "equity")) if train_points else 0.0
    oos_sharpe = _annualized_sharpe(_curve_return_series(oos_points, "equity")) if oos_points else 0.0
    degradation = (train_total_return - oos_total_return) > 0.10 or (train_sharpe - oos_sharpe) > 0.3

    score = 50
    score += 10 if strategy_total_return >= benchmark_total_return else -10
    score += 8 if strategy_sharpe >= benchmark_sharpe else -8
    score += 8 if abs(strategy_drawdown) <= abs(benchmark_drawdown) else -10
    score += -12 if degradation else 6
    score += -8 if test_trade_count < 20 else 4
    score = max(0, min(100, score))

    if strategy_total_return >= benchmark_total_return:
        result_item = {
            "key": "result_judgement",
            "title": "结果判断",
            "body": f"累计收益跑赢基准 {_format_percent(strategy_total_return - benchmark_total_return)}，方向仍成立。",
            "tone": "positive",
        }
    else:
        result_item = {
            "key": "result_judgement",
            "title": "结果判断",
            "body": f"累计收益落后基准 {_format_percent(benchmark_total_return - strategy_total_return)}，需要继续复核参数有效性。",
            "tone": "warning",
        }

    if abs(strategy_drawdown) > max(abs(benchmark_drawdown), 1e-9) * 1.5:
        risk_item = {
            "key": "risk_judgement",
            "title": "风险判断",
            "body": "回撤显著高于基准，优先核查止损、平仓与仓位约束。",
            "tone": "warning",
        }
    elif degradation:
        risk_item = {
            "key": "risk_judgement",
            "title": "风险判断",
            "body": "测试集表现弱于训练期，存在参数失效或阶段切换风险。",
            "tone": "warning",
        }
    else:
        risk_item = {
            "key": "risk_judgement",
            "title": "风险判断",
            "body": "回撤与测试集退化都处在可观察区间，风险尚可控。",
            "tone": "neutral",
        }

    next_action_body = "先查看测试集交易与证据，确认收益并非由少量样本偶然驱动。"
    if abs(strategy_drawdown) > max(abs(benchmark_drawdown), 1e-9) * 1.5:
        next_action_body = "先核查平仓逻辑与止损设置，再决定是否继续优化参数。"
    elif degradation:
        next_action_body = "建议收缩参数寻优空间，并对比上一版参数在测试集的稳定性。"
    elif test_trade_count < 20:
        next_action_body = "建议补充更长测试窗口或更多市场阶段后，再做放大判断。"

    return {
        "subtitle": _build_subtitle(
            oos_total_return=oos_total_return,
            benchmark_total_return=benchmark_total_return,
            strategy_drawdown=strategy_drawdown,
            benchmark_drawdown=benchmark_drawdown,
            oos_trade_count=test_trade_count,
        ),
        "kpi_cards": [
            total_return_card,
            sharpe_card,
            drawdown_card,
            rolling_card,
            trade_count_card,
        ],
        "decision_rail": {
            "score": score,
            "items": [
                result_item,
                risk_item,
                {
                    "key": "next_action",
                    "title": "下一步动作",
                    "body": next_action_body,
                    "tone": "neutral" if "建议" not in next_action_body else "warning",
                },
            ],
        },
    }

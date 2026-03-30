from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta


@dataclass(frozen=True)
class CoverageSummary:
    symbol: str
    first_trade_date: date | None
    last_trade_date: date | None
    expected_trade_days: int
    actual_trade_days: int
    coverage_pct: float
    max_gap_trading_days: int
    has_gap_warning: bool


def weekday_count(start: date, end: date) -> int:
    total = 0
    current = start
    while current <= end:
        if current.weekday() < 5:
            total += 1
        current += timedelta(days=1)
    return total


def max_weekday_gap(dates: list[date]) -> int:
    if len(dates) < 2:
        return 0
    max_gap = 0
    for previous, current in zip(dates, dates[1:]):
        cursor = previous + timedelta(days=1)
        gap = 0
        while cursor < current:
            if cursor.weekday() < 5:
                gap += 1
            cursor += timedelta(days=1)
        max_gap = max(max_gap, gap)
    return max_gap


def summarize_symbol_coverage(symbol: str, trade_dates: list[date], gap_warning_threshold: int = 5) -> CoverageSummary:
    ordered = sorted(set(trade_dates))
    if not ordered:
        return CoverageSummary(
            symbol=symbol,
            first_trade_date=None,
            last_trade_date=None,
            expected_trade_days=0,
            actual_trade_days=0,
            coverage_pct=0.0,
            max_gap_trading_days=0,
            has_gap_warning=False,
        )
    first_trade_date = ordered[0]
    last_trade_date = ordered[-1]
    expected_trade_days = weekday_count(first_trade_date, last_trade_date)
    actual_trade_days = len(ordered)
    coverage_pct = (actual_trade_days / expected_trade_days * 100.0) if expected_trade_days else 100.0
    max_gap = max_weekday_gap(ordered)
    return CoverageSummary(
        symbol=symbol,
        first_trade_date=first_trade_date,
        last_trade_date=last_trade_date,
        expected_trade_days=expected_trade_days,
        actual_trade_days=actual_trade_days,
        coverage_pct=coverage_pct,
        max_gap_trading_days=max_gap,
        has_gap_warning=max_gap > gap_warning_threshold,
    )


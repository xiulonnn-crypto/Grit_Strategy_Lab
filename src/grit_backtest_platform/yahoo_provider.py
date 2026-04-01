from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any

from .backtest_engine import MarketBar


YAHOO_CHART_ENDPOINT = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"


@dataclass(frozen=True)
class SymbolMarketData:
    symbol: str
    bars: list[MarketBar]
    actions: list[dict[str, Any]]
    source: str = "yahoo"
    fallback_source: str | None = None
    partial: bool = False
    warnings: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


class YahooMarketDataProvider:
    provider_name = "yahoo"

    def __init__(self, retries: int = 3, timeout: int = 20) -> None:
        self.retries = retries
        self.timeout = timeout

    def fetch_history(self, symbol: str, start_date: date, end_date: date) -> SymbolMarketData:
        period1 = int(datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc).timestamp())
        period2 = int(datetime.combine(end_date, datetime.max.time(), tzinfo=timezone.utc).timestamp())
        query = urllib.parse.urlencode(
            {
                "period1": period1,
                "period2": period2,
                "interval": "1d",
                "events": "div,splits",
                "includeAdjustedClose": "true",
            }
        )
        url = YAHOO_CHART_ENDPOINT.format(symbol=urllib.parse.quote(symbol.upper())) + f"?{query}"
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/json",
            },
        )

        last_error: Exception | None = None
        for attempt in range(self.retries):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                return self._parse_payload(symbol.upper(), payload)
            except (urllib.error.URLError, TimeoutError, ValueError, KeyError) as exc:
                last_error = exc
                if attempt >= self.retries - 1:
                    break
                time.sleep(1.2 * (attempt + 1))
        raise RuntimeError(f"Yahoo history request failed for {symbol}: {last_error}") from last_error

    def _parse_payload(self, symbol: str, payload: dict[str, Any]) -> SymbolMarketData:
        result = payload.get("chart", {}).get("result", [])
        if not result:
            error = payload.get("chart", {}).get("error") or {}
            message = error.get("description") or f"No chart result returned for {symbol}"
            raise RuntimeError(message)

        chart = result[0]
        timestamps = chart.get("timestamp") or []
        quote = ((chart.get("indicators") or {}).get("quote") or [{}])[0]
        adjusted = ((chart.get("indicators") or {}).get("adjclose") or [{}])[0].get("adjclose") or []
        opens = quote.get("open") or []
        highs = quote.get("high") or []
        lows = quote.get("low") or []
        closes = quote.get("close") or []
        volumes = quote.get("volume") or []
        events = chart.get("events") or {}

        warnings: list[str] = []
        dividends = {
            datetime.fromtimestamp(int(timestamp), tz=timezone.utc).date(): float(item.get("amount", 0.0))
            for timestamp, item in (events.get("dividends") or {}).items()
        }
        splits = {
            datetime.fromtimestamp(int(timestamp), tz=timezone.utc).date(): float(item.get("numerator", 1.0))
            / float(item.get("denominator", 1.0))
            for timestamp, item in (events.get("splits") or {}).items()
        }

        bars: list[MarketBar] = []
        actions: list[dict[str, Any]] = []
        skipped_rows = 0
        for index, timestamp in enumerate(timestamps):
            if index >= len(opens) or index >= len(closes) or index >= len(adjusted):
                skipped_rows += 1
                continue
            raw_open = opens[index]
            raw_close = closes[index]
            adj_close = adjusted[index]
            if raw_open is None or raw_close is None or adj_close is None:
                skipped_rows += 1
                continue
            trade_date = datetime.fromtimestamp(int(timestamp), tz=timezone.utc).date()
            close_value = float(raw_close)
            volume = float(volumes[index] if index < len(volumes) and volumes[index] is not None else 0.0)
            bars.append(
                MarketBar(
                    date=trade_date.isoformat(),
                    open=float(raw_open),
                    high=float(highs[index] if index < len(highs) and highs[index] is not None else raw_open),
                    low=float(lows[index] if index < len(lows) and lows[index] is not None else raw_open),
                    close=close_value,
                    adj_close=float(adj_close),
                    volume=volume,
                )
            )
            dividend = dividends.get(trade_date)
            if dividend:
                actions.append(
                    {
                        "date": trade_date.isoformat(),
                        "action_type": "dividend",
                        "value": dividend,
                        "source": self.provider_name,
                        "payload": {"amount": dividend},
                    }
                )
            split_ratio = splits.get(trade_date)
            if split_ratio and split_ratio != 1.0:
                actions.append(
                    {
                        "date": trade_date.isoformat(),
                        "action_type": "split",
                        "value": split_ratio,
                        "source": self.provider_name,
                        "payload": {"split_ratio": split_ratio},
                    }
                )

        coverage_note = "Yahoo chart endpoint only returns dividends and splits; earnings and other company events require a secondary source."
        warnings.append(coverage_note)
        if skipped_rows:
            warnings.append(f"Skipped {skipped_rows} Yahoo rows because required price fields were incomplete.")
        if not bars:
            raise RuntimeError(f"No usable daily bars returned for {symbol}")

        return SymbolMarketData(
            symbol=symbol,
            bars=bars,
            actions=actions,
            partial=bool(warnings),
            warnings=warnings,
            metadata={
                "provider": self.provider_name,
                "actions_partial": True,
                "coverage_limits": [coverage_note],
                "event_types": sorted({item["action_type"] for item in actions}),
                "bar_count": len(bars),
            },
        )

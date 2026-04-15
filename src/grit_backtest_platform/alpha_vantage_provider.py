from __future__ import annotations

import csv
import io
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from typing import Any

from .backtest_engine import MarketBar
from .fallback_provider import ProviderExecutionSignal
from .yahoo_provider import SymbolMarketData
from .fallback_provider import ProviderAvailability


ALPHAVANTAGE_QUERY_ENDPOINT = "https://www.alphavantage.co/query"
ALPHA_RATE_LIMIT_PHRASES = (
    "standard api call frequency",
    "thank you for using alpha vantage",
    "rate limit",
    "premium endpoint",
)


def _parse_float(value: Any, default: float | None = None) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


class AlphaVantageProvider:
    provider_name = "alpha_vantage"
    supports_targeted_price_repair = True

    def __init__(self, api_key: str | None = None, timeout: int = 20) -> None:
        self.api_key = str(api_key or os.getenv("ALPHAVANTAGE_API_KEY") or "").strip()
        self.timeout = timeout

    def availability(self) -> ProviderAvailability:
        return ProviderAvailability(
            provider_name=self.provider_name,
            available=bool(self.api_key),
            reason=None if self.api_key else "ALPHAVANTAGE_API_KEY is not configured.",
            metadata={"requires_key": True},
        )

    def _request_text(self, params: dict[str, Any]) -> str:
        if not self.api_key:
            raise RuntimeError("ALPHAVANTAGE_API_KEY is not configured.")
        query = dict(params)
        query["apikey"] = self.api_key
        url = ALPHAVANTAGE_QUERY_ENDPOINT + "?" + urllib.parse.urlencode(query)
        request = urllib.request.Request(url, headers={"Accept": "text/csv, application/json"})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return response.read().decode("utf-8")
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Alpha Vantage request failed: {exc}") from exc

    def _parse_rate_limit_payload(self, payload: str) -> None:
        lowered = payload.lower()
        if any(phrase in lowered for phrase in ALPHA_RATE_LIMIT_PHRASES):
            raise RuntimeError("Alpha Vantage rate limit reached: free-tier quota or pacing limit exceeded.")

    def fetch_earnings(self, symbol: str) -> list[dict[str, Any]]:
        payload = self._request_text({"function": "EARNINGS", "symbol": symbol.upper()})
        if payload.strip().startswith("{"):
            data = json.loads(payload)
            self._parse_rate_limit_payload(payload)
            if data.get("Error Message"):
                raise RuntimeError(str(data["Error Message"]))
            if data.get("Note") or data.get("Information"):
                raise RuntimeError(str(data.get("Note") or data.get("Information")))
        data = json.loads(payload)
        self._parse_rate_limit_payload(payload)
        earnings: list[dict[str, Any]] = []
        for period, key in (("quarterly", "quarterlyEarnings"), ("annual", "annualEarnings")):
            for row in data.get(key, []) or []:
                if not isinstance(row, dict):
                    continue
                earnings.append(
                    {
                        "period": period,
                        "fiscal_date_ending": row.get("fiscalDateEnding"),
                        "reported_date": row.get("reportedDate"),
                        "reported_eps": _parse_float(row.get("reportedEPS")),
                        "estimated_eps": _parse_float(row.get("estimatedEPS")),
                        "surprise": _parse_float(row.get("surprise")),
                        "surprise_percentage": _parse_float(row.get("surprisePercentage")),
                        "source": self.provider_name,
                    }
                )
        return earnings

    def fetch_listing_status(
        self,
        *,
        date: date | None = None,
        state: str | None = None,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"function": "LISTING_STATUS"}
        if date is not None:
            params["date"] = date.isoformat()
        if state:
            params["state"] = state
        payload = self._request_text(params)
        self._parse_rate_limit_payload(payload)
        if payload.strip().startswith("{"):
            data = json.loads(payload)
            if data.get("Error Message"):
                raise RuntimeError(str(data["Error Message"]))
            if data.get("Note") or data.get("Information"):
                raise RuntimeError(str(data.get("Note") or data.get("Information")))
        reader = csv.DictReader(io.StringIO(payload))
        rows: list[dict[str, Any]] = []
        for row in reader:
            if not row:
                continue
            normalized = {
                "symbol": str(row.get("symbol") or "").upper(),
                "company_name": row.get("name") or row.get("company_name") or "",
                "exchange": row.get("exchange") or "",
                "asset_type": row.get("assetType") or row.get("asset_type") or "",
                "ipo_date": row.get("ipoDate") or row.get("ipo_date") or None,
                "delisting_date": row.get("delistingDate") or row.get("delisting_date") or None,
                "status": row.get("status") or "",
                "source": self.provider_name,
            }
            if normalized["symbol"]:
                rows.append(normalized)
        return rows

    def resolve_identity(self, symbol: str) -> dict[str, Any] | None:
        normalized = symbol.upper()
        for state in ("active", "delisted", None):
            rows = self.fetch_listing_status(state=state)
            for row in rows:
                if row["symbol"] == normalized:
                    return {
                        "symbol": normalized,
                        "canonical_symbol": normalized,
                        "company_name": row.get("company_name") or "",
                        "cik": "",
                        "exchange": row.get("exchange") or "",
                        "ipo_date": row.get("ipo_date"),
                        "delisting_date": row.get("delisting_date"),
                        "source": self.provider_name,
                        "valid_from": None,
                        "valid_to": None,
                    }
        return None

    def fetch_history(self, symbol: str, start_date: date, end_date: date) -> Any:
        payload = self._request_text(
            {
                "function": "TIME_SERIES_DAILY_ADJUSTED",
                "symbol": symbol.upper(),
                "outputsize": "full",
            }
        )
        self._parse_rate_limit_payload(payload)
        data = json.loads(payload)
        if data.get("Error Message"):
            raise ProviderExecutionSignal(
                str(data["Error Message"]),
                status="failed",
                reason="symbol_invalid",
                metadata={"provider_symbol": symbol.upper(), "error_class": "symbol_invalid"},
            )
        if data.get("Note") or data.get("Information"):
            raise ProviderExecutionSignal(
                str(data.get("Note") or data.get("Information")),
                status="limited",
                reason="rate_limited",
                metadata={"provider_symbol": symbol.upper(), "error_class": "rate_limited"},
            )
        rows = data.get("Time Series (Daily)") or {}
        if not isinstance(rows, dict) or not rows:
            raise ProviderExecutionSignal(
                f"No Alpha Vantage daily adjusted rows returned for {symbol}",
                status="failed",
                reason="no_history",
                metadata={"provider_symbol": symbol.upper(), "error_class": "no_history"},
            )

        bars: list[MarketBar] = []
        for trade_date, row in rows.items():
            if not isinstance(row, dict):
                continue
            normalized_date = str(trade_date or "").strip()[:10]
            if not normalized_date or normalized_date < start_date.isoformat() or normalized_date > end_date.isoformat():
                continue
            open_value = _parse_float(row.get("1. open"))
            high_value = _parse_float(row.get("2. high"))
            low_value = _parse_float(row.get("3. low"))
            close_value = _parse_float(row.get("4. close"))
            adj_close = _parse_float(row.get("5. adjusted close"), close_value)
            volume = _parse_float(row.get("6. volume"), 0.0)
            if open_value is None or high_value is None or low_value is None or close_value is None:
                continue
            bars.append(
                MarketBar(
                    date=normalized_date,
                    open=float(open_value),
                    high=float(high_value),
                    low=float(low_value),
                    close=float(close_value),
                    adj_close=float(adj_close if adj_close is not None else close_value),
                    volume=float(volume or 0.0),
                )
            )
        if not bars:
            raise ProviderExecutionSignal(
                f"No Alpha Vantage daily adjusted rows matched {symbol} in the requested window",
                status="failed",
                reason="no_history",
                metadata={"provider_symbol": symbol.upper(), "error_class": "no_history"},
            )
        bars.sort(key=lambda item: item.date)
        return SymbolMarketData(
            symbol=symbol.upper(),
            bars=bars,
            actions=[],
            source=self.provider_name,
            fallback_source=None,
            partial=False,
            warnings=[],
            metadata={
                "provider": self.provider_name,
                "targeted_price_repair": True,
                "bar_count": len(bars),
                "adjusted_series": True,
            },
        )


AlphaVantageEventProvider = AlphaVantageProvider
AlphaVantageMarketDataProvider = AlphaVantageProvider

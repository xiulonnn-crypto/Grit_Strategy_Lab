from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from typing import Any

from .backtest_engine import MarketBar
from .fallback_provider import ProviderAvailability
from .yahoo_provider import SymbolMarketData


FMP_DELISTED_COMPANIES_ENDPOINT = "https://financialmodelingprep.com/stable/delisted-companies"
FMP_HISTORICAL_PRICE_ENDPOINT = "https://financialmodelingprep.com/stable/historical-price-eod/full"


def _parse_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _normalize_iso_date(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    return text[:10]


class FmpIdentityRepairProvider:
    provider_name = "fmp"

    def __init__(self, api_key: str | None = None, timeout: int = 20) -> None:
        self.api_key = str(api_key or os.getenv("FMP_API_KEY") or "").strip()
        self.timeout = timeout

    def availability(self) -> ProviderAvailability:
        return ProviderAvailability(
            provider_name=self.provider_name,
            available=bool(self.api_key),
            reason=None if self.api_key else "FMP_API_KEY is not configured.",
            metadata={"requires_key": True},
        )

    def _request_json(self, url: str, params: dict[str, Any] | None = None) -> Any:
        if not self.api_key:
            raise RuntimeError("FMP_API_KEY is not configured.")
        query = dict(params or {})
        query["apikey"] = self.api_key
        request_url = url + "?" + urllib.parse.urlencode(query)
        request = urllib.request.Request(request_url, headers={"Accept": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.URLError as exc:
            raise RuntimeError(f"FMP request failed: {exc}") from exc

    def fetch_delisted_companies(self) -> list[dict[str, Any]]:
        payload = self._request_json(FMP_DELISTED_COMPANIES_ENDPOINT)
        rows: list[dict[str, Any]] = []
        if isinstance(payload, list):
            source_rows = payload
        elif isinstance(payload, dict):
            source_rows = payload.get("data") or payload.get("historical") or payload.get("results") or []
        else:
            source_rows = []
        for row in source_rows:
            if not isinstance(row, dict):
                continue
            symbol = str(row.get("symbol") or row.get("ticker") or "").upper()
            if not symbol:
                continue
            rows.append(
                {
                    "symbol": symbol,
                    "canonical_symbol": symbol,
                    "company_name": row.get("companyName") or row.get("company_name") or row.get("name") or "",
                    "cik": str(row.get("cik") or row.get("cik_str") or ""),
                    "exchange": row.get("exchange") or "",
                    "ipo_date": row.get("ipoDate") or row.get("ipo_date"),
                    "delisting_date": row.get("delistedDate") or row.get("delistingDate") or row.get("date"),
                    "source": self.provider_name,
                    "valid_from": None,
                    "valid_to": None,
                }
            )
        return rows

    def resolve_identity(self, symbol: str) -> dict[str, Any] | None:
        normalized = symbol.upper()
        for row in self.fetch_delisted_companies():
            if row["symbol"] == normalized:
                return row
        return None

    def fetch_history(self, symbol: str, start_date: date, end_date: date) -> SymbolMarketData:
        payload = self._request_json(
            FMP_HISTORICAL_PRICE_ENDPOINT,
            {
                "symbol": symbol.upper(),
                "from": start_date.isoformat(),
                "to": end_date.isoformat(),
            },
        )
        if isinstance(payload, dict):
            source_rows = payload.get("historical") or payload.get("data") or payload.get("results") or []
        elif isinstance(payload, list):
            source_rows = payload
        else:
            source_rows = []

        bars: list[MarketBar] = []
        warnings: list[str] = []
        skipped_rows = 0
        for row in source_rows:
            if not isinstance(row, dict):
                skipped_rows += 1
                continue
            trade_date = _normalize_iso_date(row.get("date"))
            if not trade_date or trade_date < start_date.isoformat() or trade_date > end_date.isoformat():
                continue
            open_value = row.get("open")
            close_value = row.get("close")
            if open_value is None or close_value is None:
                skipped_rows += 1
                continue
            bars.append(
                MarketBar(
                    date=trade_date,
                    open=_parse_float(open_value),
                    high=_parse_float(row.get("high"), _parse_float(open_value)),
                    low=_parse_float(row.get("low"), _parse_float(open_value)),
                    close=_parse_float(close_value),
                    adj_close=_parse_float(row.get("adjClose", row.get("adj_close", close_value)), _parse_float(close_value)),
                    volume=_parse_float(row.get("volume")),
                )
            )
        if skipped_rows:
            warnings.append(f"Skipped {skipped_rows} FMP rows because required price fields were incomplete.")
        if not bars:
            raise RuntimeError(f"No usable historical price rows returned for {symbol}")
        return SymbolMarketData(
            symbol=symbol.upper(),
            bars=bars,
            actions=[],
            source=self.provider_name,
            fallback_source=None,
            partial=bool(warnings),
            warnings=warnings,
            metadata={
                "provider": self.provider_name,
                "bar_count": len(bars),
                "delisted_identity_available": bool(self.resolve_identity(symbol)),
            },
        )

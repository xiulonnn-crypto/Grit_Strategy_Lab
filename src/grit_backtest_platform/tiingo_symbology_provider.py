from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from .fallback_provider import ProviderAvailability


TIINGO_SEARCH_ENDPOINT = "https://api.tiingo.com/tiingo/utilities/search"


def _strip_symbol(symbol: str) -> tuple[str, str]:
    text = str(symbol or "").strip().upper()
    if not text:
        raise RuntimeError("Symbol is required.")
    if "." in text:
        base, region = text.rsplit(".", 1)
        if region == "US":
            return base, f"{base}.US"
        return base, text
    return text, f"{text}.US"


def _coerce_text(value: Any) -> str:
    return str(value or "").strip()


class TiingoSymbologyProvider:
    provider_name = "tiingo_symbology"

    def __init__(self, token: str | None = None, timeout: int = 20) -> None:
        self.token = str(token or os.getenv("TIINGO_API_TOKEN") or "").strip()
        self.timeout = timeout

    def availability(self) -> ProviderAvailability:
        return ProviderAvailability(
            provider_name=self.provider_name,
            available=bool(self.token),
            reason=None if self.token else "TIINGO_API_TOKEN is not configured.",
            metadata={"requires_token": True, "mode": "symbology_search"},
        )

    def _request_json(self, query: str) -> Any:
        if not self.token:
            raise RuntimeError("TIINGO_API_TOKEN is not configured.")
        params = urllib.parse.urlencode({"query": query, "token": self.token})
        url = f"{TIINGO_SEARCH_ENDPOINT}?{params}"
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Tiingo symbology request failed: {exc}") from exc

    def resolve_identity(self, symbol: str) -> dict[str, Any] | None:
        base_symbol, canonical_symbol = _strip_symbol(symbol)
        payload = self._request_json(base_symbol)
        if isinstance(payload, dict):
            rows = payload.get("results") or payload.get("data") or payload.get("securities") or []
        elif isinstance(payload, list):
            rows = payload
        else:
            rows = []
        if not rows:
            return None

        best_row: dict[str, Any] | None = None
        for row in rows:
            if not isinstance(row, dict):
                continue
            row_ticker = _coerce_text(row.get("ticker") or row.get("symbol") or row.get("tickerSymbol")).upper()
            if row_ticker == base_symbol or row_ticker == canonical_symbol:
                best_row = row
                break
            if best_row is None:
                best_row = row
        if best_row is None:
            return None

        row_ticker = _coerce_text(best_row.get("ticker") or best_row.get("symbol") or best_row.get("tickerSymbol")).upper()
        row_name = (
            best_row.get("name")
            or best_row.get("companyName")
            or best_row.get("description")
            or best_row.get("securityName")
            or base_symbol
        )
        exchange = best_row.get("exchangeCode") or best_row.get("exchange") or best_row.get("mic") or ""
        ipo_date = best_row.get("startDate") or best_row.get("firstDate") or best_row.get("listedDate") or ""
        delisting_date = best_row.get("endDate") or best_row.get("lastDate") or best_row.get("delistingDate") or ""
        canonical = _coerce_text(best_row.get("permaTicker") or best_row.get("tickerRegion") or best_row.get("canonicalSymbol"))
        if not canonical:
            canonical = canonical_symbol
        return {
            "symbol": base_symbol,
            "canonical_symbol": canonical,
            "company_name": row_name,
            "cik": str(best_row.get("cik") or best_row.get("cikStr") or ""),
            "exchange": exchange,
            "ipo_date": ipo_date,
            "delisting_date": delisting_date,
            "source": self.provider_name,
            "valid_from": None,
            "valid_to": None,
            "metadata": {
                "provider": self.provider_name,
                "symbology_only": True,
                "symbol": row_ticker or base_symbol,
            },
        }

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


TIINGO_DAILY_PRICES_ENDPOINT = "https://api.tiingo.com/tiingo/daily/{symbol}/prices"


def _to_iso_date(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    return text[:10]


def _parse_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


class TiingoMarketDataProvider:
    provider_name = "tiingo"
    supports_action_enrichment = True

    def __init__(self, token: str | None = None, retries: int = 3, timeout: int = 20) -> None:
        self.token = str(token or os.getenv("TIINGO_API_TOKEN") or "").strip()
        self.retries = retries
        self.timeout = timeout

    def availability(self) -> ProviderAvailability:
        return ProviderAvailability(
            provider_name=self.provider_name,
            available=bool(self.token),
            reason=None if self.token else "TIINGO_API_TOKEN is not configured.",
            metadata={"mode": "official_api", "requires_token": True},
        )

    def fetch_history(self, symbol: str, start_date: date, end_date: date) -> SymbolMarketData:
        if not self.token:
            raise RuntimeError("TIINGO_API_TOKEN is not configured.")
        query = urllib.parse.urlencode(
            {
                "startDate": start_date.isoformat(),
                "endDate": end_date.isoformat(),
            }
        )
        url = TIINGO_DAILY_PRICES_ENDPOINT.format(symbol=urllib.parse.quote(symbol.lower())) + f"?{query}"
        request = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Token {self.token}",
                "Accept": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
        )

        last_error: Exception | None = None
        for attempt in range(self.retries):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                return self._parse_payload(symbol.upper(), payload, start_date, end_date)
            except (urllib.error.URLError, TimeoutError, ValueError, KeyError) as exc:
                last_error = exc
                if attempt >= self.retries - 1:
                    break
        raise RuntimeError(f"Tiingo history request failed for {symbol}: {last_error}") from last_error

    def _parse_payload(
        self,
        symbol: str,
        payload: Any,
        start_date: date,
        end_date: date,
    ) -> SymbolMarketData:
        if isinstance(payload, dict) and (payload.get("detail") or payload.get("error")):
            message = str(payload.get("detail") or payload.get("error"))
            raise RuntimeError(message)
        if not isinstance(payload, list):
            raise RuntimeError(f"Unexpected Tiingo payload for {symbol}: {type(payload).__name__}")

        bars: list[MarketBar] = []
        actions: list[dict[str, Any]] = []
        skipped_rows = 0
        for row in payload:
            if not isinstance(row, dict):
                skipped_rows += 1
                continue
            trade_date = _to_iso_date(row.get("date"))
            if not trade_date or trade_date < start_date.isoformat() or trade_date > end_date.isoformat():
                continue
            open_value = row.get("open")
            close_value = row.get("close")
            if open_value is None or close_value is None:
                skipped_rows += 1
                continue
            high_value = row.get("high", open_value)
            low_value = row.get("low", open_value)
            adj_close = row.get("adjClose", row.get("adj_close", close_value))
            volume = row.get("adjVolume", row.get("volume", 0.0))
            bars.append(
                MarketBar(
                    date=trade_date,
                    open=_parse_float(open_value),
                    high=_parse_float(high_value, _parse_float(open_value)),
                    low=_parse_float(low_value, _parse_float(open_value)),
                    close=_parse_float(close_value),
                    adj_close=_parse_float(adj_close, _parse_float(close_value)),
                    volume=_parse_float(volume),
                )
            )
            dividend = _parse_float(row.get("divCash"), 0.0)
            if dividend > 0:
                actions.append(
                    {
                        "date": trade_date,
                        "action_type": "dividend",
                        "value": dividend,
                        "source": self.provider_name,
                        "payload": {"divCash": dividend},
                    }
                )
            split_factor = _parse_float(row.get("splitFactor"), 1.0)
            if split_factor > 1.0:
                action_type = "split"
            elif 0.0 < split_factor < 1.0:
                action_type = "reverse_split"
            else:
                action_type = None
            if action_type:
                actions.append(
                    {
                        "date": trade_date,
                        "action_type": action_type,
                        "value": split_factor,
                        "source": self.provider_name,
                        "payload": {"splitFactor": split_factor},
                    }
                )

        warnings: list[str] = []
        if skipped_rows:
            warnings.append(f"Skipped {skipped_rows} Tiingo rows because required price fields were incomplete.")
        if not bars:
            raise RuntimeError(f"No usable daily bars returned for {symbol}")
        return SymbolMarketData(
            symbol=symbol,
            bars=bars,
            actions=actions,
            source=self.provider_name,
            fallback_source=None,
            partial=bool(warnings),
            warnings=warnings,
            metadata={
                "provider": self.provider_name,
                "official_api": True,
                "bar_count": len(bars),
                "event_types": sorted({item["action_type"] for item in actions}),
                "actions_supported": True,
                "token_configured": True,
            },
        )

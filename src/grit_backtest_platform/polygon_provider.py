from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any

from .backtest_engine import MarketBar
from .fallback_provider import ProviderAvailability, ProviderExecutionSignal
from .yahoo_provider import SymbolMarketData


POLYGON_BASE_URL = "https://api.polygon.io"


@dataclass(frozen=True)
class PolygonResponseContext:
    url: str
    status_code: int | None = None
    retry_after: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)


class PolygonMarketDataProvider:
    provider_name = "polygon"
    supports_action_enrichment = True
    supports_targeted_price_repair = True

    def __init__(self, api_key: str | None = None, *, timeout: int = 30, retries: int = 2) -> None:
        self.api_key = str(api_key or os.getenv("POLYGON_API_KEY") or "").strip()
        self.timeout = int(timeout)
        self.retries = int(retries)
        self.metadata = {
            "access_tier": "paid_optional",
            "required_env_vars": ["POLYGON_API_KEY"],
            "provider": self.provider_name,
        }

    def availability(self) -> ProviderAvailability:
        if not self.api_key:
            return ProviderAvailability(
                provider_name=self.provider_name,
                available=False,
                reason="missing POLYGON_API_KEY",
                metadata={**self.metadata, "credential_status": "missing"},
            )
        return ProviderAvailability(
            provider_name=self.provider_name,
            available=True,
            metadata={**self.metadata, "credential_status": "present"},
        )

    def fetch_history(self, symbol: str, start_date: date, end_date: date) -> SymbolMarketData:
        normalized_symbol = str(symbol or "").strip().upper()
        if not normalized_symbol:
            raise ValueError("Polygon fetch_history requires a symbol.")
        price_payload = self._request_json(
            f"/v2/aggs/ticker/{urllib.parse.quote(normalized_symbol)}/range/1/day/{start_date.isoformat()}/{end_date.isoformat()}",
            {
                "adjusted": "true",
                "sort": "asc",
                "limit": "50000",
            },
        )
        bars = self._parse_aggregate_bars(price_payload)
        if not bars:
            raise RuntimeError(f"Polygon returned no adjusted daily bars for {normalized_symbol}.")
        actions = [
            *self.fetch_dividends(normalized_symbol, start_date, end_date),
            *self.fetch_splits(normalized_symbol, start_date, end_date),
        ]
        return SymbolMarketData(
            symbol=normalized_symbol,
            bars=bars,
            actions=actions,
            source=self.provider_name,
            partial=False,
            warnings=[],
            metadata={
                "provider": self.provider_name,
                "access_tier": "paid_optional",
                "actions_supported": True,
                "probe_complete": True,
                "bar_count": len(bars),
                "event_types": sorted({str(item.get("action_type")) for item in actions if item.get("action_type")}),
            },
        )

    def fetch_corporate_actions(self, symbol: str, start_date: date, end_date: date) -> list[dict[str, Any]]:
        normalized_symbol = str(symbol or "").strip().upper()
        return [
            *self.fetch_dividends(normalized_symbol, start_date, end_date),
            *self.fetch_splits(normalized_symbol, start_date, end_date),
        ]

    def resolve_identity(self, symbol: str) -> dict[str, Any] | None:
        normalized_symbol = str(symbol or "").strip().upper()
        if not normalized_symbol:
            return None
        try:
            payload = self._request_json(
                f"/v3/reference/tickers/{urllib.parse.quote(normalized_symbol)}",
                {},
            )
        except Exception:
            return {
                "symbol": normalized_symbol,
                "canonical_symbol": normalized_symbol,
                "source": self.provider_name,
            }
        result = payload.get("results") if isinstance(payload, dict) else {}
        if not isinstance(result, dict):
            result = {}
        return {
            "symbol": normalized_symbol,
            "canonical_symbol": str(result.get("ticker") or normalized_symbol).strip().upper(),
            "company_name": str(result.get("name") or ""),
            "exchange": str(result.get("primary_exchange") or ""),
            "ipo_date": result.get("list_date"),
            "delisting_date": result.get("delisted_utc"),
            "source": self.provider_name,
        }

    def fetch_dividends(self, symbol: str, start_date: date, end_date: date) -> list[dict[str, Any]]:
        payload = self._request_json(
            "/v3/reference/dividends",
            {
                "ticker": symbol,
                "ex_dividend_date.gte": start_date.isoformat(),
                "ex_dividend_date.lte": end_date.isoformat(),
                "limit": "1000",
                "sort": "ex_dividend_date",
            },
        )
        actions: list[dict[str, Any]] = []
        for item in payload.get("results") or []:
            if not isinstance(item, dict):
                continue
            event_date = item.get("ex_dividend_date") or item.get("pay_date")
            if not event_date:
                continue
            actions.append(
                {
                    "date": str(event_date)[:10],
                    "action_type": "dividend",
                    "value": item.get("cash_amount"),
                    "source": self.provider_name,
                    "payload": {
                        "ticker": item.get("ticker"),
                        "cash_amount": item.get("cash_amount"),
                        "currency": item.get("currency"),
                        "declaration_date": item.get("declaration_date"),
                        "record_date": item.get("record_date"),
                        "pay_date": item.get("pay_date"),
                    },
                }
            )
        return actions

    def fetch_splits(self, symbol: str, start_date: date, end_date: date) -> list[dict[str, Any]]:
        payload = self._request_json(
            "/v3/reference/splits",
            {
                "ticker": symbol,
                "execution_date.gte": start_date.isoformat(),
                "execution_date.lte": end_date.isoformat(),
                "limit": "1000",
                "sort": "execution_date",
            },
        )
        actions: list[dict[str, Any]] = []
        for item in payload.get("results") or []:
            if not isinstance(item, dict):
                continue
            event_date = item.get("execution_date")
            if not event_date:
                continue
            split_from = _to_float(item.get("split_from"))
            split_to = _to_float(item.get("split_to"))
            ratio = (split_to / split_from) if split_from and split_to else None
            actions.append(
                {
                    "date": str(event_date)[:10],
                    "action_type": "split",
                    "value": ratio,
                    "source": self.provider_name,
                    "payload": {
                        "ticker": item.get("ticker"),
                        "split_from": item.get("split_from"),
                        "split_to": item.get("split_to"),
                        "split_ratio": ratio,
                    },
                }
            )
        return actions

    def _parse_aggregate_bars(self, payload: dict[str, Any]) -> list[MarketBar]:
        rows = payload.get("results") if isinstance(payload, dict) else []
        bars: list[MarketBar] = []
        if not isinstance(rows, list):
            return bars
        for item in rows:
            if not isinstance(item, dict):
                continue
            timestamp = item.get("t")
            if timestamp is None:
                continue
            try:
                trade_date = datetime.fromtimestamp(float(timestamp) / 1000.0, tz=timezone.utc).date().isoformat()
            except Exception:
                continue
            close_value = _to_float(item.get("c"))
            if close_value is None:
                continue
            bars.append(
                MarketBar(
                    date=trade_date,
                    open=_to_float(item.get("o")) or close_value,
                    high=_to_float(item.get("h")) or close_value,
                    low=_to_float(item.get("l")) or close_value,
                    close=close_value,
                    adj_close=close_value,
                    volume=_to_float(item.get("v")) or 0.0,
                )
            )
        return bars

    def _request_json(self, path: str, params: dict[str, str]) -> dict[str, Any]:
        if not self.api_key:
            raise ProviderExecutionSignal(
                "Polygon API key is missing.",
                status="unavailable",
                reason="missing_credentials",
                metadata={"provider": self.provider_name, "required_env_vars": ["POLYGON_API_KEY"]},
            )
        query = dict(params)
        query["apiKey"] = self.api_key
        url = POLYGON_BASE_URL + path + "?" + urllib.parse.urlencode(query)
        last_error: Exception | None = None
        for attempt in range(max(1, self.retries)):
            request = urllib.request.Request(url, headers={"Accept": "application/json"})
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                last_error = exc
                if exc.code in {429, 503}:
                    retry_after = exc.headers.get("Retry-After")
                    raise ProviderExecutionSignal(
                        f"Polygon rate limit or service throttle for {path}.",
                        status="limited",
                        reason="quota_or_rate_limited",
                        metadata={
                            "provider": self.provider_name,
                            "quota_limited": True,
                            "retry_after": retry_after,
                        },
                    ) from exc
                if exc.code in {401, 403}:
                    raise ProviderExecutionSignal(
                        "Polygon credential was rejected.",
                        status="unavailable",
                        reason="invalid_credentials",
                        metadata={"provider": self.provider_name},
                    ) from exc
                if attempt >= self.retries - 1:
                    break
            except (urllib.error.URLError, TimeoutError, ValueError) as exc:
                last_error = exc
                if attempt >= self.retries - 1:
                    break
                time.sleep(1.0 + attempt)
        raise RuntimeError(f"Polygon request failed for {path}: {last_error}") from last_error


def _to_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None

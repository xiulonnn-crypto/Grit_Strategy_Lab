from __future__ import annotations

import csv
import io
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from typing import Any, Mapping

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
    supports_action_enrichment = True

    def __init__(self, api_key: str | None = None, timeout: int = 20) -> None:
        self.api_key = str(api_key or os.getenv("ALPHAVANTAGE_API_KEY") or "").strip()
        self.timeout = timeout

    def availability(self) -> ProviderAvailability:
        return ProviderAvailability(
            provider_name=self.provider_name,
            available=bool(self.api_key),
            reason=None if self.api_key else "ALPHAVANTAGE_API_KEY is not configured.",
            metadata={
                "requires_key": True,
                "access_tier": "free_account",
                "quota_limited": True,
                "daily_quota_hint": 25,
            },
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

    def _next_daily_retry_at(self) -> str:
        now = datetime.now(timezone.utc)
        next_day = datetime.combine(now.date() + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
        return next_day.isoformat().replace("+00:00", "Z")

    def _raise_rate_limited_signal(self, message: str) -> None:
        raise ProviderExecutionSignal(
            message,
            status="limited",
            reason="rate_limited",
            metadata={
                "provider_symbol": None,
                "error_class": "rate_limited",
                "quota_limited": True,
                "next_retry_at": self._next_daily_retry_at(),
            },
        )

    def _parse_rate_limit_payload(self, payload: str) -> None:
        lowered = payload.lower()
        if any(phrase in lowered for phrase in ALPHA_RATE_LIMIT_PHRASES):
            raise RuntimeError("Alpha Vantage rate limit reached: free-tier quota or pacing limit exceeded.")

    def _parse_symbol_error(self, data: Mapping[str, Any], *, symbol: str) -> None:
        error_message = str(data.get("Error Message") or "").strip()
        if error_message:
            raise ProviderExecutionSignal(
                error_message,
                status="failed",
                reason="symbol_invalid",
                metadata={"provider_symbol": symbol.upper(), "error_class": "symbol_invalid"},
            )
        note_message = str(data.get("Note") or data.get("Information") or "").strip()
        if note_message:
            raise ProviderExecutionSignal(
                note_message,
                status="limited",
                reason="rate_limited",
                metadata={
                    "provider_symbol": symbol.upper(),
                    "error_class": "rate_limited",
                    "quota_limited": True,
                    "next_retry_at": self._next_daily_retry_at(),
                },
            )

    def _request_json_payload(self, params: dict[str, Any], *, symbol: str) -> dict[str, Any]:
        payload = self._request_text(params)
        self._parse_rate_limit_payload(payload)
        data = json.loads(payload)
        if not isinstance(data, dict):
            raise ProviderExecutionSignal(
                f"Unexpected Alpha Vantage payload type for {symbol}: {type(data).__name__}",
                status="failed",
                reason="unexpected_payload",
                metadata={"provider_symbol": symbol.upper(), "error_class": "unexpected_payload"},
            )
        self._parse_symbol_error(data, symbol=symbol)
        return data

    def _normalize_action_date(self, value: Any) -> str:
        text = str(value or "").strip()
        if not text:
            return ""
        if "T" in text:
            return text[:10]
        for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y/%m/%d"):
            try:
                return datetime.strptime(text[:10], fmt).date().isoformat()
            except ValueError:
                continue
        return text[:10]

    def _parse_dividend_actions(
        self,
        payload: Mapping[str, Any],
        *,
        symbol: str,
        start_date: date,
        end_date: date,
    ) -> list[dict[str, Any]]:
        rows = payload.get("data") or payload.get("dividends") or payload.get("historical") or []
        actions: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            event_date = self._normalize_action_date(
                row.get("ex_dividend_date") or row.get("date") or row.get("record_date")
            )
            if not event_date or event_date < start_date.isoformat() or event_date > end_date.isoformat():
                continue
            amount = _parse_float(
                row.get("amount")
                or row.get("dividend_amount")
                or row.get("cash_amount")
                or row.get("value")
            )
            if amount is None or amount <= 0:
                continue
            actions.append(
                {
                    "date": event_date,
                    "action_type": "dividend",
                    "value": float(amount),
                    "source": self.provider_name,
                    "payload": {
                        "cash": float(amount),
                        "ex_dividend_date": event_date,
                        "record_date": self._normalize_action_date(row.get("record_date")),
                        "payment_date": self._normalize_action_date(row.get("payment_date")),
                        "declaration_date": self._normalize_action_date(row.get("declaration_date")),
                    },
                }
            )
        return actions

    def _split_ratio(self, row: Mapping[str, Any]) -> float | None:
        direct_ratio = _parse_float(row.get("split_factor") or row.get("split_coefficient") or row.get("ratio"))
        if direct_ratio is not None and direct_ratio > 0:
            return float(direct_ratio)
        split_from = _parse_float(row.get("split_from") or row.get("from_factor"))
        split_to = _parse_float(row.get("split_to") or row.get("to_factor"))
        if split_from and split_to and split_from > 0:
            return float(split_to / split_from)
        numerator = _parse_float(row.get("numerator"))
        denominator = _parse_float(row.get("denominator"))
        if denominator and numerator and denominator > 0:
            return float(numerator / denominator)
        return None

    def _parse_split_actions(
        self,
        payload: Mapping[str, Any],
        *,
        symbol: str,
        start_date: date,
        end_date: date,
    ) -> list[dict[str, Any]]:
        rows = payload.get("data") or payload.get("splits") or payload.get("historical") or []
        actions: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            event_date = self._normalize_action_date(
                row.get("effective_date") or row.get("date") or row.get("execution_date")
            )
            if not event_date or event_date < start_date.isoformat() or event_date > end_date.isoformat():
                continue
            ratio = self._split_ratio(row)
            if ratio is None or ratio <= 0 or abs(ratio - 1.0) < 1e-9:
                continue
            action_type = "split" if ratio > 1.0 else "reverse_split"
            actions.append(
                {
                    "date": event_date,
                    "action_type": action_type,
                    "value": float(ratio),
                    "source": self.provider_name,
                    "payload": {
                        "splitFactor": float(ratio),
                        "effective_date": event_date,
                        "split_from": _parse_float(row.get("split_from") or row.get("from_factor")),
                        "split_to": _parse_float(row.get("split_to") or row.get("to_factor")),
                    },
                }
            )
        return actions

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

    def fetch_corporate_actions(
        self,
        symbol: str,
        start_date: date,
        end_date: date,
    ) -> dict[str, Any]:
        normalized_symbol = symbol.upper()
        try:
            dividends_payload = self._request_json_payload(
                {"function": "DIVIDENDS", "symbol": normalized_symbol},
                symbol=normalized_symbol,
            )
            splits_payload = self._request_json_payload(
                {"function": "SPLITS", "symbol": normalized_symbol},
                symbol=normalized_symbol,
            )
        except ProviderExecutionSignal:
            raise
        except RuntimeError as exc:
            lowered = str(exc).lower()
            if "rate limit" in lowered:
                raise ProviderExecutionSignal(
                    str(exc),
                    status="limited",
                    reason="rate_limited",
                    metadata={
                        "provider_symbol": normalized_symbol,
                        "error_class": "rate_limited",
                        "quota_limited": True,
                        "next_retry_at": self._next_daily_retry_at(),
                    },
                ) from exc
            raise ProviderExecutionSignal(
                str(exc),
                status="failed",
                reason="request_failed",
                metadata={"provider_symbol": normalized_symbol, "error_class": "request_failed"},
            ) from exc

        actions = [
            *self._parse_dividend_actions(
                dividends_payload,
                symbol=normalized_symbol,
                start_date=start_date,
                end_date=end_date,
            ),
            *self._parse_split_actions(
                splits_payload,
                symbol=normalized_symbol,
                start_date=start_date,
                end_date=end_date,
            ),
        ]
        return {
            "actions": actions,
            "source": self.provider_name,
            "probe_complete": True,
            "metadata": {
                "provider": self.provider_name,
                "actions_supported": True,
                "probe_complete": True,
                "access_tier": "free_account",
                "quota_limited": False,
                "action_count": len(actions),
            },
        }

    def fetch_history(self, symbol: str, start_date: date, end_date: date) -> Any:
        normalized_symbol = symbol.upper()
        data = self._request_json_payload(
            {
                "function": "TIME_SERIES_DAILY_ADJUSTED",
                "symbol": normalized_symbol,
                "outputsize": "full",
            },
            symbol=normalized_symbol,
        )
        rows = data.get("Time Series (Daily)") or {}
        if not isinstance(rows, dict) or not rows:
            raise ProviderExecutionSignal(
                f"No Alpha Vantage daily adjusted rows returned for {symbol}",
                status="failed",
                reason="no_history",
                metadata={"provider_symbol": normalized_symbol, "error_class": "no_history"},
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
                metadata={"provider_symbol": normalized_symbol, "error_class": "no_history"},
            )
        bars.sort(key=lambda item: item.date)
        return SymbolMarketData(
            symbol=normalized_symbol,
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
                "access_tier": "free_account",
                "quota_limited": False,
            },
        )


AlphaVantageEventProvider = AlphaVantageProvider
AlphaVantageMarketDataProvider = AlphaVantageProvider

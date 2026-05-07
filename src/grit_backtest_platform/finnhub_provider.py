from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from typing import Any, Mapping

from .backtest_engine import MarketBar
from .fallback_provider import ProviderAvailability, ProviderExecutionSignal
from .yahoo_provider import SymbolMarketData


FINNHUB_BASE_URL = "https://finnhub.io/api/v1"


def _normalize_symbol(value: Any) -> str:
    return str(value or "").strip().upper()


def _normalize_api_key(value: Any) -> str:
    text = str(value or "").strip()
    if text.lower().startswith("bearer "):
        text = text[7:].strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in {"'", '"'}:
        text = text[1:-1].strip()
    return text


def _safe_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_date(value: Any) -> str:
    text = str(value or "").strip()
    return text[:10] if text else ""


class FinnhubProvider:
    provider_name = "finnhub"
    supports_targeted_price_repair = True

    def __init__(self, api_key: str | None = None, *, timeout: int = 20) -> None:
        self.api_key = _normalize_api_key(api_key or os.getenv("FINNHUB_API_KEY") or "")
        self.timeout = int(timeout)
        self._symbol_cache: dict[str, list[dict[str, Any]]] = {}
        self.metadata = {
            "access_tier": "free_account",
            "required_env_vars": ["FINNHUB_API_KEY"],
            "provider": self.provider_name,
            "targeted_price_repair": True,
        }

    def availability(self) -> ProviderAvailability:
        if not self.api_key:
            return ProviderAvailability(
                provider_name=self.provider_name,
                available=False,
                reason="FINNHUB_API_KEY is not configured.",
                metadata={**self.metadata, "credential_status": "missing"},
            )
        return ProviderAvailability(
            provider_name=self.provider_name,
            available=True,
            metadata={**self.metadata, "credential_status": "present", "quota_limited": True},
        )

    def resolve_identity(self, symbol: str) -> dict[str, Any] | None:
        normalized_symbol = _normalize_symbol(symbol)
        if not normalized_symbol:
            return None
        profile = self._profile_payload_for_symbol(normalized_symbol)
        listing = self._listing_row_for_symbol(normalized_symbol)
        if not profile and not listing:
            return None

        canonical_symbol = _normalize_symbol(
            profile.get("ticker")
            or profile.get("symbol")
            or (listing or {}).get("symbol")
            or normalized_symbol
        )
        company_name = str(
            profile.get("name")
            or (listing or {}).get("description")
            or (listing or {}).get("displaySymbol")
            or ""
        ).strip()
        exchange = str(profile.get("exchange") or (listing or {}).get("mic") or "").strip()
        identity = {
            "symbol": normalized_symbol,
            "canonical_symbol": canonical_symbol,
            "company_name": company_name,
            "cik": str(profile.get("cik") or "").strip(),
            "exchange": exchange,
            "ipo_date": _normalize_date(profile.get("ipo")),
            "delisting_date": None,
            "source": self.provider_name,
            "valid_from": _normalize_date(profile.get("ipo")) or None,
            "valid_to": None,
            "listing_status": "active" if listing else "profile_only",
            "finnhub_industry": str(profile.get("finnhubIndustry") or "").strip(),
        }
        return identity

    def resolve_identities(self, symbols: list[str] | tuple[str, ...] | set[str]) -> dict[str, dict[str, Any]]:
        requested = sorted({_normalize_symbol(symbol) for symbol in symbols if _normalize_symbol(symbol)})
        resolved: dict[str, dict[str, Any]] = {}
        for symbol in requested:
            identity = self.resolve_identity(symbol)
            if identity:
                resolved[symbol] = identity
        return resolved

    def fetch_listing_status(self, exchange: str = "US") -> list[dict[str, Any]]:
        normalized_exchange = str(exchange or "US").strip().upper() or "US"
        if normalized_exchange in self._symbol_cache:
            return [dict(item) for item in self._symbol_cache[normalized_exchange]]
        payload = self._request_json("/stock/symbol", {"exchange": normalized_exchange}, provider_symbol=normalized_exchange)
        rows: list[dict[str, Any]] = []
        for row in payload if isinstance(payload, list) else []:
            if not isinstance(row, dict):
                continue
            symbol = _normalize_symbol(row.get("symbol") or row.get("displaySymbol"))
            if not symbol:
                continue
            rows.append(dict(row))
        self._symbol_cache[normalized_exchange] = rows
        return [dict(item) for item in rows]

    def fetch_history(self, symbol: str, start_date: date, end_date: date) -> SymbolMarketData:
        normalized_symbol = _normalize_symbol(symbol)
        if not normalized_symbol:
            raise ValueError("Finnhub fetch_history requires a symbol.")
        if end_date < start_date:
            raise ValueError("Finnhub fetch_history requires end_date >= start_date.")

        payload = self._request_json(
            "/stock/candle",
            {
                "symbol": normalized_symbol,
                "resolution": "D",
                "from": int(datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc).timestamp()),
                "to": int(datetime.combine(end_date, datetime.max.time(), tzinfo=timezone.utc).timestamp()),
            },
            provider_symbol=normalized_symbol,
        )
        bars = self._parse_candle_payload(payload, symbol=normalized_symbol, start_date=start_date, end_date=end_date)
        if not bars:
            raise ProviderExecutionSignal(
                f"Finnhub returned no usable daily candles for {normalized_symbol}.",
                status="failed",
                reason="empty_response",
                metadata={"provider_symbol": normalized_symbol, "error_class": "empty_response"},
            )
        return SymbolMarketData(
            symbol=normalized_symbol,
            bars=bars,
            actions=[],
            source=self.provider_name,
            partial=True,
            warnings=["Finnhub candles are targeted price fallback rows; adjusted-close evidence is proxied by close."],
            metadata={
                "provider": self.provider_name,
                "provider_symbol": normalized_symbol,
                "bar_count": len(bars),
                "actions_supported": False,
                "targeted_price_repair": True,
                "adj_close_proxy": True,
            },
        )

    def _profile_payload_for_symbol(self, symbol: str) -> dict[str, Any]:
        for path in ("/stock/profile2", "/stock/profile"):
            try:
                payload = self._request_json(path, {"symbol": symbol}, provider_symbol=symbol)
            except ProviderExecutionSignal as exc:
                if exc.reason == "credential_rejected":
                    raise
                continue
            except Exception:
                continue
            if not isinstance(payload, dict):
                continue
            if any(payload.get(key) for key in ("ticker", "symbol", "name", "cik", "exchange", "ipo")):
                return dict(payload)
        return {}

    def _listing_row_for_symbol(self, symbol: str) -> dict[str, Any] | None:
        try:
            rows = self.fetch_listing_status("US")
        except Exception:
            return None
        normalized = _normalize_symbol(symbol)
        for row in rows:
            row_symbol = _normalize_symbol(row.get("symbol") or row.get("displaySymbol"))
            row_display = _normalize_symbol(row.get("displaySymbol"))
            if normalized in {row_symbol, row_display}:
                return dict(row)
        return None

    def _request_json(self, path: str, params: Mapping[str, Any], *, provider_symbol: str) -> Any:
        if not self.api_key:
            raise RuntimeError("FINNHUB_API_KEY is not configured.")
        text = self._request_text_with_auth_fallback(path, params, provider_symbol=provider_symbol)
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ProviderExecutionSignal(
                f"Finnhub returned malformed JSON for {provider_symbol}.",
                status="failed",
                reason="malformed_payload",
                metadata={"provider_symbol": provider_symbol, "error_class": "malformed_payload"},
            ) from exc
        self._raise_payload_signal(data, provider_symbol=provider_symbol)
        return data

    def _request_text_with_auth_fallback(
        self,
        path: str,
        params: Mapping[str, Any],
        *,
        provider_symbol: str,
    ) -> str:
        query = dict(params)
        query["token"] = self.api_key
        query_url = FINNHUB_BASE_URL + path + "?" + urllib.parse.urlencode(query)
        header_url = FINNHUB_BASE_URL + path + "?" + urllib.parse.urlencode(dict(params))
        requests = [
            urllib.request.Request(query_url, headers={"Accept": "application/json"}),
            urllib.request.Request(header_url, headers={"Accept": "application/json", "X-Finnhub-Token": self.api_key}),
        ]
        last_http_error: urllib.error.HTTPError | None = None
        for index, request in enumerate(requests):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    return response.read().decode("utf-8")
            except urllib.error.HTTPError as exc:
                last_http_error = exc
                status_code = int(getattr(exc, "code", 0) or 0)
                if status_code in {401, 403} and index < len(requests) - 1:
                    continue
                self._raise_http_signal(exc, provider_symbol=provider_symbol)
            except (urllib.error.URLError, TimeoutError) as exc:
                raise ProviderExecutionSignal(
                    f"Finnhub request failed for {provider_symbol}.",
                    status="failed",
                    reason="transient_request_failure",
                    metadata={"provider_symbol": provider_symbol, "error_class": type(exc).__name__},
                ) from exc
        if last_http_error is not None:
            self._raise_http_signal(last_http_error, provider_symbol=provider_symbol)
        raise ProviderExecutionSignal(
            f"Finnhub request failed for {provider_symbol}.",
            status="failed",
            reason="unexpected_auth_failure",
            metadata={"provider_symbol": provider_symbol, "error_class": "unexpected_auth_failure"},
        )

    def _raise_payload_signal(self, data: Any, *, provider_symbol: str) -> None:
        if not isinstance(data, dict):
            return
        error_message = str(data.get("error") or data.get("message") or "").strip()
        if error_message and not data.get("s"):
            reason = self._classify_auth_failure(error_message) if "access" in error_message.lower() or "token" in error_message.lower() or "key" in error_message.lower() else "provider_error"
            status = "skipped" if reason == "entitlement_required" else "failed"
            raise ProviderExecutionSignal(
                f"Finnhub returned an error for {provider_symbol}.",
                status=status,
                reason=reason,
                metadata={
                    "provider_symbol": provider_symbol,
                    "error_class": reason,
                    "provider_error_fingerprint": self._error_fingerprint(error_message),
                },
            )
        status = str(data.get("s") or "").strip().lower()
        if status == "ok" or not status:
            return
        if status == "no_data":
            raise ProviderExecutionSignal(
                f"Finnhub returned no data for {provider_symbol}.",
                status="failed",
                reason="empty_response",
                metadata={"provider_symbol": provider_symbol, "error_class": "empty_response"},
            )
        message = str(data.get("error") or data.get("message") or status).strip()
        raise ProviderExecutionSignal(
            f"Finnhub returned {status} for {provider_symbol}.",
            status="limited" if "limit" in message.lower() else "failed",
            reason="rate_limited" if "limit" in message.lower() else status,
            metadata={
                "provider_symbol": provider_symbol,
                "error_class": "rate_limited" if "limit" in message.lower() else status,
                "quota_limited": "limit" in message.lower(),
            },
        )

    def _raise_http_signal(self, exc: urllib.error.HTTPError, *, provider_symbol: str) -> None:
        status_code = int(getattr(exc, "code", 0) or 0)
        retry_after = str(getattr(exc, "headers", {}).get("Retry-After") or "").strip()
        if status_code in {401, 403}:
            error_body = self._read_http_error_body(exc)
            reason = self._classify_auth_failure(error_body)
        elif status_code == 404:
            error_body = self._read_http_error_body(exc)
            reason = "symbol_invalid"
        elif status_code == 429:
            error_body = self._read_http_error_body(exc)
            reason = "rate_limited"
        else:
            error_body = self._read_http_error_body(exc)
            reason = "http_error"
        metadata: dict[str, Any] = {
            "provider_symbol": provider_symbol,
            "error_class": reason,
            "status_code": status_code,
        }
        if error_body:
            metadata["provider_error_fingerprint"] = self._error_fingerprint(error_body)
        if status_code == 429:
            metadata["quota_limited"] = True
            metadata["next_retry_at"] = self._retry_after_to_utc(retry_after) if retry_after else self._next_minute_retry_at()
        status = "limited" if status_code == 429 else ("skipped" if reason == "entitlement_required" else "failed")
        raise ProviderExecutionSignal(
            f"Finnhub request failed for {provider_symbol} with HTTP {status_code}.",
            status=status,
            reason=reason,
            metadata=metadata,
        )

    def _read_http_error_body(self, exc: urllib.error.HTTPError) -> str:
        try:
            body = exc.read()
        except Exception:
            return ""
        if not body:
            return ""
        try:
            return body.decode("utf-8", errors="replace")
        except Exception:
            return str(body)

    def _classify_auth_failure(self, error_body: str) -> str:
        body = error_body.lower()
        if any(term in body for term in ("access to this resource", "do not have access", "no access", "not entitled", "permission")):
            return "entitlement_required"
        if any(term in body for term in ("invalid token", "invalid api", "wrong token", "token is invalid", "api key is invalid")):
            return "credential_rejected"
        if "api key" in body and any(term in body for term in ("access", "permission", "entitled")):
            return "entitlement_required"
        if "api key" in body:
            return "credential_rejected"
        return "credential_rejected"

    def _error_fingerprint(self, error_body: str) -> str:
        lowered = error_body.lower()
        if "access" in lowered or "permission" in lowered or "entitled" in lowered:
            return "access_denied"
        if "token" in lowered or "key" in lowered:
            return "token_error"
        if "limit" in lowered:
            return "rate_limited"
        try:
            payload = json.loads(error_body)
        except Exception:
            return "provider_error_body"
        if isinstance(payload, dict):
            for key in ("error", "message", "s"):
                value = str(payload.get(key) or "").strip().lower()
                if value:
                    if "access" in value:
                        return "access_denied"
                    if "token" in value or "key" in value:
                        return "token_error"
                    if "limit" in value:
                        return "rate_limited"
        return "provider_error_body"

    def _parse_candle_payload(
        self,
        payload: Any,
        *,
        symbol: str,
        start_date: date,
        end_date: date,
    ) -> list[MarketBar]:
        if not isinstance(payload, dict):
            return []
        timestamps = payload.get("t") or []
        opens = payload.get("o") or []
        highs = payload.get("h") or []
        lows = payload.get("l") or []
        closes = payload.get("c") or []
        volumes = payload.get("v") or []
        bars: list[MarketBar] = []
        for index, timestamp in enumerate(timestamps if isinstance(timestamps, list) else []):
            if index >= len(opens) or index >= len(highs) or index >= len(lows) or index >= len(closes):
                continue
            try:
                trade_date = datetime.fromtimestamp(float(timestamp), tz=timezone.utc).date()
            except Exception:
                continue
            if trade_date < start_date or trade_date > end_date:
                continue
            open_value = _safe_float(opens[index])
            high_value = _safe_float(highs[index])
            low_value = _safe_float(lows[index])
            close_value = _safe_float(closes[index])
            if None in {open_value, high_value, low_value, close_value}:
                continue
            volume_value = _safe_float(volumes[index] if index < len(volumes) else None)
            bars.append(
                MarketBar(
                    date=trade_date.isoformat(),
                    open=float(open_value),
                    high=float(high_value),
                    low=float(low_value),
                    close=float(close_value),
                    adj_close=float(close_value),
                    volume=float(volume_value or 0.0),
                )
            )
        bars.sort(key=lambda item: item.date)
        return bars

    def _retry_after_to_utc(self, retry_after: str) -> str:
        try:
            seconds = int(retry_after)
        except ValueError:
            return retry_after
        return (datetime.now(timezone.utc) + timedelta(seconds=max(seconds, 0))).isoformat().replace("+00:00", "Z")

    def _next_minute_retry_at(self) -> str:
        return (datetime.now(timezone.utc) + timedelta(seconds=60)).isoformat(timespec="seconds").replace("+00:00", "Z")

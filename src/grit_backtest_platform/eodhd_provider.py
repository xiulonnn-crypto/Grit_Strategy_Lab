from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from typing import Any, Mapping

from .backtest_engine import MarketBar
from .fallback_provider import ProviderAvailability, ProviderExecutionSignal
from .yahoo_provider import SymbolMarketData


EODHD_BASE_URL = "https://eodhd.com/api"
EODHD_TOKEN_ENV_NAMES = ("EODHD_API_TOKEN", "EODHD_API_KEY")
EODHD_DEFAULT_EXCHANGE = "US"


def _configured_token() -> str:
    for env_name in EODHD_TOKEN_ENV_NAMES:
        value = str(os.getenv(env_name) or "").strip()
        if value:
            return value
    return ""


def _exchange_code() -> str:
    return str(os.getenv("EODHD_EXCHANGE_CODE") or EODHD_DEFAULT_EXCHANGE).strip().upper() or EODHD_DEFAULT_EXCHANGE


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _safe_float(value: Any, default: float | None = None) -> float | None:
    try:
        if value in (None, ""):
            return default
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    parsed = _safe_float(value, None)
    return int(parsed) if parsed is not None else int(default)


def _normalize_symbol(value: str) -> str:
    return str(value or "").strip().upper()


def _provider_symbol_candidates(symbol: str, exchange: str | None = None) -> list[str]:
    normalized = _normalize_symbol(symbol)
    if not normalized:
        return []
    exchange_code = str(exchange or _exchange_code()).strip().upper()
    if normalized.endswith(f".{exchange_code}"):
        base = normalized[: -(len(exchange_code) + 1)]
    else:
        base = normalized

    base_variants = [base]
    hyphenated = base.replace(".", "-")
    if hyphenated not in base_variants:
        base_variants.append(hyphenated)

    candidates: list[str] = []
    for variant in base_variants:
        for provider_base in (variant, f"{variant}_old"):
            candidate = f"{provider_base}.{exchange_code}"
            if candidate not in candidates:
                candidates.append(candidate)
    return candidates


def _pick_value(row: Mapping[str, Any], *keys: str) -> Any:
    normalized = {str(key).strip().lower().replace("_", ""): key for key in row}
    for key in keys:
        if key in row and row[key] not in (None, ""):
            return row[key]
        row_key = normalized.get(str(key).strip().lower().replace("_", ""))
        if row_key is not None and row[row_key] not in (None, ""):
            return row[row_key]
    return None


def _parse_split_ratio(value: Any) -> float | None:
    text = str(value or "").strip()
    if not text:
        return None
    if "/" in text:
        left, right = text.split("/", 1)
        numerator = _safe_float(left, None)
        denominator = _safe_float(right, None)
        if numerator is None or denominator in (None, 0):
            return None
        return numerator / denominator
    return _safe_float(text, None)


def _classify_http_error(exc: urllib.error.HTTPError, *, provider_symbol: str) -> ProviderExecutionSignal:
    if exc.code in {401, 403}:
        return ProviderExecutionSignal(
            f"EODHD request rejected with HTTP {exc.code}",
            status="failed",
            reason="auth_failed",
            metadata={"provider_symbol": provider_symbol, "http_status": exc.code},
        )
    if exc.code == 404:
        return ProviderExecutionSignal(
            f"EODHD returned no endpoint data for {provider_symbol}",
            status="failed",
            reason="no_history",
            metadata={"provider_symbol": provider_symbol, "http_status": exc.code},
        )
    if exc.code == 429:
        return ProviderExecutionSignal(
            f"EODHD rate limit reached for {provider_symbol}",
            status="limited",
            reason="rate_limited",
            metadata={"provider_symbol": provider_symbol, "http_status": exc.code, "quota_limited": True},
        )
    return ProviderExecutionSignal(
        f"EODHD request failed with HTTP {exc.code}",
        status="failed",
        reason="transient_request_failure",
        metadata={"provider_symbol": provider_symbol, "http_status": exc.code},
    )


def _payload_message(payload: Any) -> str:
    if isinstance(payload, Mapping):
        for key in ("error", "warning", "message"):
            value = payload.get(key)
            if value not in (None, ""):
                return str(value)
    if isinstance(payload, list) and len(payload) == 1 and isinstance(payload[0], Mapping):
        return _payload_message(payload[0])
    return ""


def _classify_payload_message(message: str, *, provider_symbol: str) -> ProviderExecutionSignal | None:
    if not message:
        return None
    lowered = message.lower()
    if any(token in lowered for token in ("invalid", "forbidden", "token", "api key")):
        reason = "auth_failed"
        status = "failed"
        metadata = {"provider_symbol": provider_symbol}
    elif "free subscription" in lowered or "limited by one year" in lowered:
        reason = "subscription_history_limit"
        status = "limited"
        metadata = {
            "provider_symbol": provider_symbol,
            "entitlement_required": True,
            "quota_limited": False,
        }
    elif "limit" in lowered or "too many" in lowered:
        reason = "rate_limited"
        status = "limited"
        metadata = {"provider_symbol": provider_symbol, "quota_limited": True}
    else:
        reason = "provider_error"
        status = "failed"
        metadata = {"provider_symbol": provider_symbol}
    return ProviderExecutionSignal(
        message,
        status=status,
        reason=reason,
        metadata=metadata,
    )


class EodhdMarketDataProvider:
    provider_name = "eodhd"
    supports_action_enrichment = True

    def __init__(self, token: str | None = None, timeout: int = 20) -> None:
        self.token = str(token or _configured_token()).strip()
        self.timeout = int(timeout)
        self.exchange = _exchange_code()

    @property
    def metadata(self) -> dict[str, Any]:
        return {
            "access_tier": "paid_optional",
            "required_env_vars": ["EODHD_API_TOKEN"],
            "accepted_env_vars": list(EODHD_TOKEN_ENV_NAMES),
            "supports_delisted_symbols": True,
            "delisted_symbol_pattern": "{symbol}_old.US",
            "secret_persistence": "disabled",
        }

    def availability(self) -> ProviderAvailability:
        return ProviderAvailability(
            provider_name=self.provider_name,
            available=bool(self.token),
            reason=None if self.token else "Missing required environment variable: EODHD_API_TOKEN.",
            metadata=self.metadata,
        )

    def _url(self, path: str, *, provider_symbol: str, params: Mapping[str, Any] | None = None) -> str:
        query = {
            "api_token": self.token,
            "fmt": "json",
            **{key: value for key, value in dict(params or {}).items() if value is not None},
        }
        return (
            f"{EODHD_BASE_URL}/{path.strip('/')}/{urllib.parse.quote(provider_symbol)}"
            f"?{urllib.parse.urlencode(query)}"
        )

    def _request_json(self, url: str, *, provider_symbol: str) -> Any:
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Grit_Strategy_Lab EODHD provider",
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            raise _classify_http_error(exc, provider_symbol=provider_symbol) from exc
        except urllib.error.URLError as exc:
            raise ProviderExecutionSignal(
                f"EODHD request failed for {provider_symbol}: {exc}",
                status="failed",
                reason="transient_request_failure",
                metadata={"provider_symbol": provider_symbol},
            ) from exc
        payload = json.loads(raw or "null")
        payload_signal = _classify_payload_message(_payload_message(payload), provider_symbol=provider_symbol)
        if payload_signal is not None:
            raise payload_signal
        return payload

    def _fetch_eod_rows(self, provider_symbol: str, start_date: date, end_date: date) -> list[dict[str, Any]]:
        url = self._url(
            "eod",
            provider_symbol=provider_symbol,
            params={"from": start_date.isoformat(), "to": end_date.isoformat(), "period": "d"},
        )
        payload = self._request_json(url, provider_symbol=provider_symbol)
        if not isinstance(payload, list):
            return []
        return [dict(row) for row in payload if isinstance(row, Mapping)]

    def _fetch_action_rows(self, provider_symbol: str, start_date: date, end_date: date) -> tuple[list[dict[str, Any]], list[str]]:
        actions: list[dict[str, Any]] = []
        warnings: list[str] = []
        for endpoint, action_type in (("div", "dividend"), ("splits", "split")):
            url = self._url(
                endpoint,
                provider_symbol=provider_symbol,
                params={"from": start_date.isoformat(), "to": end_date.isoformat()},
            )
            try:
                payload = self._request_json(url, provider_symbol=provider_symbol)
            except ProviderExecutionSignal as exc:
                warnings.append(f"EODHD {endpoint}: {exc.reason}")
                continue
            if not isinstance(payload, list):
                continue
            for row in payload:
                if not isinstance(row, Mapping):
                    continue
                event_date = str(_pick_value(row, "date", "Date") or "")[:10]
                if not event_date or event_date < start_date.isoformat() or event_date > end_date.isoformat():
                    continue
                if action_type == "dividend":
                    value = _safe_float(_pick_value(row, "value", "amount", "dividend", "cash_dividend"), None)
                    if value is None:
                        continue
                    payload_value = {"amount": value, "provider_symbol": provider_symbol}
                else:
                    value = _parse_split_ratio(_pick_value(row, "split", "ratio", "split_ratio"))
                    if value is None or value == 1.0:
                        continue
                    payload_value = {"split_ratio": value, "provider_symbol": provider_symbol}
                event_type = action_type
                if action_type == "split" and value < 1.0:
                    event_type = "reverse_split"
                actions.append(
                    {
                        "date": event_date,
                        "action_type": event_type,
                        "value": value,
                        "source": self.provider_name,
                        "payload": payload_value,
                    }
                )
        return actions, warnings

    def _bars_from_rows(self, rows: list[dict[str, Any]], start_date: date, end_date: date) -> tuple[list[MarketBar], int]:
        bars: list[MarketBar] = []
        skipped = 0
        for row in rows:
            trade_date = str(_pick_value(row, "date", "Date") or "")[:10]
            if not trade_date or trade_date < start_date.isoformat() or trade_date > end_date.isoformat():
                continue
            open_value = _safe_float(_pick_value(row, "open", "Open"), None)
            high_value = _safe_float(_pick_value(row, "high", "High"), None)
            low_value = _safe_float(_pick_value(row, "low", "Low"), None)
            close_value = _safe_float(_pick_value(row, "close", "Close"), None)
            if None in {open_value, high_value, low_value, close_value}:
                skipped += 1
                continue
            adj_close_value = _safe_float(
                _pick_value(row, "adjusted_close", "adjustedClose", "adj_close", "Adj Close"),
                close_value,
            )
            bars.append(
                MarketBar(
                    date=trade_date,
                    open=float(open_value),
                    high=float(high_value),
                    low=float(low_value),
                    close=float(close_value),
                    adj_close=float(adj_close_value if adj_close_value is not None else close_value),
                    volume=float(_safe_int(_pick_value(row, "volume", "Volume"), 0)),
                )
            )
        bars.sort(key=lambda item: item.date)
        return bars, skipped

    def fetch_corporate_actions(self, symbol: str, start_date: date, end_date: date) -> dict[str, Any]:
        availability = self.availability()
        if not availability.available:
            raise ProviderExecutionSignal(
                str(availability.reason or "EODHD unavailable"),
                status="failed",
                reason="provider_unavailable",
                metadata=self.metadata,
            )
        warnings: list[str] = []
        for provider_symbol in _provider_symbol_candidates(symbol, self.exchange):
            actions, action_warnings = self._fetch_action_rows(provider_symbol, start_date, end_date)
            warnings.extend(action_warnings)
            if actions:
                return {
                    "actions": actions,
                    "source": self.provider_name,
                    "warnings": warnings,
                    "probe_complete": True,
                    "metadata": {
                        **self.metadata,
                        "provider_symbol": provider_symbol,
                        "fetched_at": _utc_now(),
                    },
                }
        return {
            "actions": [],
            "source": self.provider_name,
            "warnings": warnings,
            "probe_complete": True,
            "metadata": {**self.metadata, "provider_symbol_candidates": _provider_symbol_candidates(symbol, self.exchange)},
        }

    def fetch_history(self, symbol: str, start_date: date, end_date: date) -> SymbolMarketData:
        availability = self.availability()
        if not availability.available:
            raise ProviderExecutionSignal(
                str(availability.reason or "EODHD unavailable"),
                status="failed",
                reason="provider_unavailable",
                metadata={**self.metadata, "provider_symbol": _normalize_symbol(symbol)},
            )
        attempts: list[dict[str, Any]] = []
        last_error: ProviderExecutionSignal | None = None
        for provider_symbol in _provider_symbol_candidates(symbol, self.exchange):
            try:
                rows = self._fetch_eod_rows(provider_symbol, start_date, end_date)
            except ProviderExecutionSignal as exc:
                attempts.append({"provider_symbol": provider_symbol, "status": exc.status, "reason": exc.reason})
                last_error = exc
                if exc.reason == "no_history":
                    continue
                raise
            bars, skipped_rows = self._bars_from_rows(rows, start_date, end_date)
            attempts.append({"provider_symbol": provider_symbol, "status": "READY" if bars else "NO_ROWS", "row_count": len(bars)})
            if not bars:
                continue
            actions, action_warnings = self._fetch_action_rows(provider_symbol, start_date, end_date)
            warnings = list(action_warnings)
            if skipped_rows:
                warnings.append(f"Skipped {skipped_rows} EODHD rows because required price fields were incomplete.")
            return SymbolMarketData(
                symbol=_normalize_symbol(symbol),
                bars=bars,
                actions=actions,
                source=self.provider_name,
                partial=bool(warnings),
                warnings=warnings,
                metadata={
                    **self.metadata,
                    "provider": self.provider_name,
                    "provider_symbol": provider_symbol,
                    "provider_symbol_candidates": _provider_symbol_candidates(symbol, self.exchange),
                    "attempts": attempts,
                    "bar_count": len(bars),
                    "event_types": sorted({item["action_type"] for item in actions}),
                    "actions_supported": True,
                    "fetched_at": _utc_now(),
                },
            )
        if last_error is not None:
            raise ProviderExecutionSignal(
                str(last_error),
                status=last_error.status,
                reason=last_error.reason,
                metadata={**last_error.metadata, "attempts": attempts},
            ) from last_error
        raise ProviderExecutionSignal(
            f"No EODHD rows returned for {symbol}",
            status="failed",
            reason="no_history",
            metadata={"provider_symbol_candidates": _provider_symbol_candidates(symbol, self.exchange), "attempts": attempts},
        )

from __future__ import annotations

import importlib
import os
import threading
from datetime import date, datetime, timedelta, timezone
from typing import Any

from .backtest_engine import MarketBar
from .fallback_provider import ProviderAvailability, ProviderExecutionSignal
from .yahoo_provider import SymbolMarketData


LONGBRIDGE_MIN_HISTORY_DATE = date(2010, 6, 1)
_LONGBRIDGE_SDK_MODULES = ("longbridge.openapi", "longport.openapi")
_LONGBRIDGE_PROBE_SYMBOL = "AAPL.US"
_LONGBRIDGE_PROBE_DAYS = 14
_LONGBRIDGE_CLIENTS: dict[tuple[str, str, str], dict[str, Any]] = {}
_LONGBRIDGE_CLIENTS_LOCK = threading.Lock()
_LONGBRIDGE_SYMBOL_ALIASES = {
    "BRK-A": "BRK.A",
    "BRK-B": "BRK.B",
    "BF-A": "BF.A",
    "BF-B": "BF.B",
}
_LONGBRIDGE_SYMBOL_ALIASES_REVERSE = {value: key for key, value in _LONGBRIDGE_SYMBOL_ALIASES.items()}


def _read_env(*names: str) -> str:
    for name in names:
        value = os.getenv(name)
        if value and value.strip():
            return value.strip()
    return ""


def _canonical_us_symbol(symbol: str) -> str:
    text = str(symbol or "").strip().upper()
    if not text:
        raise RuntimeError("Symbol is required.")
    if "." in text:
        ticker, region = text.rsplit(".", 1)
        if region != "US":
            raise RuntimeError("Longbridge snapshot support is limited to US symbols.")
        base_symbol = ticker
    else:
        base_symbol = text
    normalized_base = _LONGBRIDGE_SYMBOL_ALIASES_REVERSE.get(base_symbol, base_symbol)
    return normalized_base


def _history_symbol_candidates(symbol: str) -> tuple[list[str], str]:
    base_symbol = _canonical_us_symbol(symbol)
    provider_symbols: list[str] = []
    aliased = _LONGBRIDGE_SYMBOL_ALIASES.get(base_symbol)
    if aliased:
        provider_symbols.append(aliased)
    elif "-" in base_symbol:
        left, right = base_symbol.split("-", 1)
        if left and right and len(right) <= 2 and left.replace(".", "").isalnum() and right.isalnum():
            provider_symbols.append(f"{left}.{right}")
    provider_symbols.append(base_symbol)
    ordered = [f"{candidate}.US" for candidate in dict.fromkeys(provider_symbols)]
    return ordered, base_symbol


def _load_sdk() -> Any:
    last_error: Exception | None = None
    for module_name in _LONGBRIDGE_SDK_MODULES:
        try:
            return importlib.import_module(module_name)
        except Exception as exc:  # pragma: no cover - fallback path is tested via fake modules
            last_error = exc
    raise ImportError("Longbridge OpenAPI SDK is not installed.") from last_error


def _as_mapping(item: Any) -> dict[str, Any]:
    if isinstance(item, dict):
        return dict(item)
    if hasattr(item, "_asdict"):
        try:
            return dict(item._asdict())
        except Exception:
            pass
    if hasattr(item, "__dict__"):
        try:
            return {key: value for key, value in vars(item).items() if not key.startswith("_")}
        except Exception:
            pass
    values: dict[str, Any] = {}
    for name in dir(item):
        if name.startswith("_"):
            continue
        try:
            value = getattr(item, name)
        except Exception:
            continue
        if callable(value):
            continue
        values[name] = value
    if values:
        return values
    return {}


def _extract_rows(payload: Any, *attribute_names: str) -> list[Any]:
    if isinstance(payload, dict):
        for name in attribute_names:
            value = payload.get(name)
            if value is not None:
                return list(value or [])
        if len(payload) == 1:
            only_value = next(iter(payload.values()))
            if isinstance(only_value, list):
                return list(only_value)
    for name in attribute_names:
        if hasattr(payload, name):
            value = getattr(payload, name)
            if value is not None:
                return list(value or [])
    if isinstance(payload, list):
        return list(payload)
    return []


def _coerce_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _coerce_date_text(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        return text[:10]
    if len(text) == 8 and text.isdigit():
        return f"{text[:4]}-{text[4:6]}-{text[6:8]}"
    return text[:10]


def _timestamp_to_date(value: Any) -> str:
    if value is None:
        return ""
    try:
        ts = int(float(value))
    except (TypeError, ValueError):
        return _coerce_date_text(value)
    return datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat()


def _get_enum_value(container: Any, *names: str, default: Any = 0) -> Any:
    if container is None:
        return default
    for name in names:
        if hasattr(container, name):
            return getattr(container, name)
    return default


def _call_static_info(ctx: Any, symbol: str) -> Any:
    static_info = getattr(ctx, "static_info", None)
    if not callable(static_info):
        raise RuntimeError("Longbridge static_info API is unavailable.")
    return static_info([symbol])


def _call_quote(ctx: Any, symbol: str) -> Any:
    quote = getattr(ctx, "quote", None)
    if not callable(quote):
        raise RuntimeError("Longbridge quote API is unavailable.")
    return quote([symbol])


def _call_history_by_date(ctx: Any, lb: Any, symbol: str, start_date: date, end_date: date) -> Any:
    period = _get_enum_value(getattr(lb, "Period", None), "Day", default=1000)
    adjust_type = _get_enum_value(getattr(lb, "AdjustType", None), "NoAdjust", default=0)
    history_by_date = getattr(ctx, "history_candlesticks_by_date", None)
    if callable(history_by_date):
        return history_by_date(symbol, period, adjust_type, start_date, end_date)
    candlesticks = getattr(ctx, "candlesticks", None)
    if callable(candlesticks):
        count = max(1, min(1000, (end_date - start_date).days + 5))
        return candlesticks(symbol, period, count, adjust_type)
    history_by_offset = getattr(ctx, "history_candlesticks_by_offset", None)
    if callable(history_by_offset):
        return history_by_offset(symbol, period, adjust_type, True, 1000, end_date)
    raise RuntimeError("Longbridge history candlestick API is unavailable.")


def _build_config(lb: Any, app_key: str, app_secret: str, access_token: str) -> Any:
    config_cls = getattr(lb, "Config", None)
    if config_cls is None:
        raise RuntimeError("Longbridge Config class is unavailable.")
    if hasattr(config_cls, "from_apikey"):
        return config_cls.from_apikey(app_key, app_secret, access_token)
    if hasattr(config_cls, "from_apikey_env"):
        return config_cls.from_apikey_env()
    if hasattr(config_cls, "from_env"):
        return config_cls.from_env()
    raise RuntimeError("Longbridge Config factory is unavailable.")


def _build_quote_context(lb: Any, config: Any) -> Any:
    quote_context = getattr(lb, "QuoteContext", None)
    if quote_context is None:
        raise RuntimeError("Longbridge QuoteContext is unavailable.")
    create = getattr(quote_context, "create", None)
    if callable(create):
        try:
            return create(config)
        except TypeError:
            pass
    return quote_context(config)


def _close_quote_context(ctx: Any) -> None:
    if ctx is None:
        return
    for method_name in ("close", "release", "destroy", "disconnect"):
        method = getattr(ctx, method_name, None)
        if callable(method):
            try:
                method()
            except Exception:
                pass
            return


def _credential_key(app_key: str, app_secret: str, access_token: str) -> tuple[str, str, str]:
    return app_key, app_secret, access_token


def _build_client_bundle(app_key: str, app_secret: str, access_token: str) -> dict[str, Any]:
    lb = _load_sdk()
    config = _build_config(lb, app_key, app_secret, access_token)
    ctx = _build_quote_context(lb, config)
    return {"sdk": lb, "config": config, "ctx": ctx, "probe_payload": None}


def _get_client_bundle(app_key: str, app_secret: str, access_token: str, *, reset: bool = False) -> dict[str, Any]:
    key = _credential_key(app_key, app_secret, access_token)
    with _LONGBRIDGE_CLIENTS_LOCK:
        if reset:
            cached = _LONGBRIDGE_CLIENTS.pop(key, None)
            if cached:
                _close_quote_context(cached.get("ctx"))
        cached = _LONGBRIDGE_CLIENTS.get(key)
        if cached is not None:
            return cached
        bundle = _build_client_bundle(app_key, app_secret, access_token)
        _LONGBRIDGE_CLIENTS[key] = bundle
        return bundle


def _is_connection_limit_error(exc: Exception) -> bool:
    return "connections limitation" in str(exc or "").lower()


def _is_quota_limited_error(exc: Exception) -> bool:
    detail = str(exc or "")
    return "301607" in detail or "out of limit" in detail.lower()


def _is_invalid_symbol_error(exc: Exception) -> bool:
    detail = str(exc or "")
    return "301600" in detail or "invalid symbol" in detail.lower()


class _LongbridgeBase:
    history_since = LONGBRIDGE_MIN_HISTORY_DATE

    def __init__(self) -> None:
        self.app_key = _read_env("LONGBRIDGE_APP_KEY", "LONGPORT_APP_KEY")
        self.app_secret = _read_env("LONGBRIDGE_APP_SECRET", "LONGPORT_APP_SECRET")
        self.access_token = _read_env("LONGBRIDGE_ACCESS_TOKEN", "LONGPORT_ACCESS_TOKEN")

    def _has_credentials(self) -> bool:
        return bool(self.app_key and self.app_secret and self.access_token)

    def _client_bundle(self, *, reset: bool = False) -> dict[str, Any]:
        if not self._has_credentials():
            raise RuntimeError("Longbridge credentials are not configured.")
        return _get_client_bundle(self.app_key, self.app_secret, self.access_token, reset=reset)

    def _probe_payload(self) -> dict[str, Any]:
        retried = False
        while True:
            bundle = self._client_bundle(reset=retried)
            cached_payload = bundle.get("probe_payload")
            if isinstance(cached_payload, dict) and cached_payload:
                return dict(cached_payload)
            try:
                lb = bundle["sdk"]
                ctx = bundle["ctx"]
                probe_symbol = _LONGBRIDGE_PROBE_SYMBOL
                quote_payload = _call_quote(ctx, probe_symbol)
                static_payload = _call_static_info(ctx, probe_symbol)
                recent_end = date.today()
                recent_start = recent_end - timedelta(days=_LONGBRIDGE_PROBE_DAYS)
                history_payload = _call_history_by_date(ctx, lb, probe_symbol, recent_start, recent_end)
                payload = {
                    "sdk_module": getattr(lb, "__name__", "longbridge.openapi"),
                    "quote_count": len(_extract_rows(quote_payload, "secu_quote", "quotes")),
                    "static_count": len(_extract_rows(static_payload, "secu_static_info", "static_info")),
                    "history_count": len(_extract_rows(history_payload, "candlesticks", "secu_candlesticks")),
                    "history_since": self.history_since.isoformat(),
                    "quote_authority_required": True,
                    "supports_current_latest_window": True,
                }
                bundle["probe_payload"] = dict(payload)
                return payload
            except Exception as exc:
                if not retried and _is_connection_limit_error(exc):
                    retried = True
                    continue
                raise

    def _availability_failure(self, reason: str, *, stage: str) -> ProviderAvailability:
        return ProviderAvailability(
            provider_name=self.provider_name,
            available=False,
            reason=reason,
            metadata={
                "stage": stage,
                "history_since": self.history_since.isoformat(),
                "quote_authority_required": True,
            },
        )


class LongbridgeQuoteProvider(_LongbridgeBase):
    provider_name = "longbridge"

    def availability(self) -> ProviderAvailability:
        if not self._has_credentials():
            return self._availability_failure("Longbridge credentials are not configured.", stage="credentials")
        try:
            return ProviderAvailability(
                provider_name=self.provider_name,
                available=True,
                metadata=self._probe_payload(),
            )
        except Exception:
            return self._availability_failure("Longbridge capability probe failed.", stage="probe")

    def fetch_history(self, symbol: str, start_date: date, end_date: date) -> SymbolMarketData:
        if not self._has_credentials():
            raise RuntimeError("Longbridge credentials are not configured.")
        if start_date < self.history_since:
            raise RuntimeError("Longbridge US history is available from 2010-06-01 onward.")

        normalized_symbols, base_symbol = _history_symbol_candidates(symbol)
        retried = False

        selected_symbol: str | None = None
        last_symbol_error: Exception | None = None
        bars: list[MarketBar] = []
        warnings: list[str] = []

        for normalized_symbol in normalized_symbols:
            symbol_rows_found = False
            symbol_bars: list[MarketBar] = []
            symbol_warnings: list[str] = []
            seen_dates: set[str] = set()
            current_start = start_date
            chunk_days = 720
            static_ok = False

            while True:
                try:
                    bundle = self._client_bundle(reset=retried)
                    ctx = bundle["ctx"]
                    static_rows = _extract_rows(_call_static_info(ctx, normalized_symbol), "secu_static_info", "static_info")
                    if static_rows:
                        static_ok = True
                    break
                except Exception as exc:
                    if not retried and _is_connection_limit_error(exc):
                        retried = True
                        continue
                    last_symbol_error = exc
                    if _is_invalid_symbol_error(exc):
                        break
                    raise ProviderExecutionSignal(
                        f"Longbridge static info probe failed for {base_symbol}: {exc}",
                        status="failed",
                        reason="static_info_probe_failed",
                        metadata={"provider_symbol": normalized_symbol},
                    ) from exc

            if not static_ok:
                continue

            while current_start <= end_date:
                current_end = min(end_date, current_start + timedelta(days=chunk_days))
                try:
                    bundle = self._client_bundle(reset=retried)
                    lb = bundle["sdk"]
                    ctx = bundle["ctx"]
                    payload = _call_history_by_date(ctx, lb, normalized_symbol, current_start, current_end)
                    rows = _extract_rows(payload, "candlesticks", "secu_candlesticks")
                    if not rows and isinstance(payload, dict):
                        rows = _extract_rows(payload, "data", "results")
                    chunk_count = 0
                    for row in rows:
                        row_map = _as_mapping(row)
                        trade_date = _timestamp_to_date(row_map.get("timestamp") or row_map.get("date"))
                        if not trade_date or trade_date in seen_dates:
                            continue
                        open_value = row_map.get("open")
                        close_value = row_map.get("close")
                        if open_value is None or close_value is None:
                            continue
                        symbol_bars.append(
                            MarketBar(
                                date=trade_date,
                                open=_coerce_float(open_value),
                                high=_coerce_float(row_map.get("high"), _coerce_float(open_value)),
                                low=_coerce_float(row_map.get("low"), _coerce_float(open_value)),
                                close=_coerce_float(close_value),
                                adj_close=_coerce_float(row_map.get("adj_close", close_value), _coerce_float(close_value)),
                                volume=_coerce_float(row_map.get("volume")),
                            )
                        )
                        seen_dates.add(trade_date)
                        chunk_count += 1
                    if chunk_count == 0:
                        symbol_warnings.append(
                            f"Longbridge returned no usable candlesticks for {normalized_symbol} between {current_start.isoformat()} and {current_end.isoformat()}."
                        )
                    else:
                        symbol_rows_found = True
                except Exception as exc:
                    if not retried and _is_connection_limit_error(exc):
                        retried = True
                        continue
                    last_symbol_error = exc
                    if _is_quota_limited_error(exc):
                        raise ProviderExecutionSignal(
                            f"Longbridge history is currently quota-limited for {base_symbol}: {exc}",
                            status="limited",
                            reason="history_kline_symbol_count_out_of_limit",
                            metadata={"provider_symbol": normalized_symbol, "error_code": "301607"},
                        ) from exc
                    if _is_invalid_symbol_error(exc):
                        symbol_bars = []
                        symbol_warnings = []
                        symbol_rows_found = False
                        break
                    symbol_warnings.append(
                        f"Longbridge history chunk {current_start.isoformat()} to {current_end.isoformat()} failed: {exc}"
                    )
                current_start = current_end + timedelta(days=1)

            if symbol_rows_found:
                bars = symbol_bars
                warnings = symbol_warnings
                selected_symbol = normalized_symbol
                break

        bars.sort(key=lambda item: item.date)
        if not bars:
            if last_symbol_error and _is_invalid_symbol_error(last_symbol_error):
                raise ProviderExecutionSignal(
                    f"Longbridge does not support symbol {base_symbol} for US history.",
                    status="skipped",
                    reason="unsupported_symbol_for_longbridge_history",
                    metadata={"provider_symbols": normalized_symbols},
                ) from last_symbol_error
            raise ProviderExecutionSignal(
                f"No usable Longbridge history rows returned for {base_symbol}",
                status="empty",
                reason="no_usable_longbridge_history_rows",
                metadata={"provider_symbols": normalized_symbols},
            )
        return SymbolMarketData(
            symbol=base_symbol,
            bars=bars,
            actions=[],
            source=self.provider_name,
            fallback_source=None,
            partial=bool(warnings),
            warnings=warnings,
            metadata={
                "provider": self.provider_name,
                "provider_symbol": selected_symbol or normalized_symbols[0],
                "official_api": True,
                "history_since": self.history_since.isoformat(),
                "bar_count": len(bars),
                "supports_current_latest_window": True,
                "supports_post_2010_history": True,
                "actions_supported": False,
            },
        )


class LongbridgeStaticInfoProvider(_LongbridgeBase):
    provider_name = "longbridge_static_info"

    def availability(self) -> ProviderAvailability:
        if not self._has_credentials():
            return self._availability_failure("Longbridge credentials are not configured.", stage="credentials")
        try:
            lb = _load_sdk()
            config = _build_config(lb, self.app_key, self.app_secret, self.access_token)
            ctx = _build_quote_context(lb, config)
            payload = _call_static_info(ctx, _LONGBRIDGE_PROBE_SYMBOL)
            rows = _extract_rows(payload, "secu_static_info", "static_info")
            if not rows:
                raise RuntimeError("Longbridge static_info probe returned no rows.")
            return ProviderAvailability(
                provider_name=self.provider_name,
                available=True,
                metadata={
                    "sdk_module": getattr(lb, "__name__", "longbridge.openapi"),
                    "static_count": len(rows),
                    "history_since": self.history_since.isoformat(),
                    "quote_authority_required": True,
                },
            )
        except Exception:
            return self._availability_failure("Longbridge static-info capability probe failed.", stage="probe")

    def resolve_identity(self, symbol: str) -> dict[str, Any] | None:
        if not self._has_credentials():
            return None
        normalized_symbols, base_symbol = _history_symbol_candidates(symbol)
        retried = False
        for normalized_symbol in normalized_symbols:
            while True:
                try:
                    bundle = self._client_bundle(reset=retried)
                    ctx = bundle["ctx"]
                    payload = _call_static_info(ctx, normalized_symbol)
                    rows = _extract_rows(payload, "secu_static_info", "static_info")
                    if not rows:
                        rows = _extract_rows(payload, "data", "results")
                    if not rows:
                        break
                    for row in rows:
                        row_map = _as_mapping(row)
                        row_symbol = str(row_map.get("symbol") or "").upper()
                        if row_symbol and row_symbol not in {normalized_symbol, base_symbol}:
                            continue
                        company_name = (
                            row_map.get("name_en")
                            or row_map.get("name_cn")
                            or row_map.get("name_hk")
                            or row_map.get("name")
                            or base_symbol
                        )
                        return {
                            "symbol": base_symbol,
                            "canonical_symbol": row_symbol or normalized_symbol,
                            "company_name": company_name,
                            "cik": str(row_map.get("cik") or row_map.get("cik_str") or ""),
                            "exchange": row_map.get("exchange") or "",
                            "ipo_date": row_map.get("listing_date") or row_map.get("ipo_date") or "",
                            "delisting_date": row_map.get("delisting_date") or row_map.get("delisted_date") or "",
                            "source": self.provider_name,
                            "valid_from": None,
                            "valid_to": None,
                            "metadata": {
                                "provider": self.provider_name,
                                "provider_symbol": normalized_symbol,
                                "symbol_region": "US",
                                "supports_current_latest_window": True,
                            },
                        }
                    break
                except Exception as exc:
                    if not retried and _is_connection_limit_error(exc):
                        retried = True
                        continue
                    if _is_invalid_symbol_error(exc):
                        break
                    raise
        return None

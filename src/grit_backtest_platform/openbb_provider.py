from __future__ import annotations

import importlib
import os
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Mapping, Sequence

from ._bond_fixed_income_provider import (
    _convexity_proxy,
    _modified_duration,
    fetch_official_bond_fixed_income_snapshots,
)
from .backtest_engine import MarketBar
from .fallback_provider import ProviderAvailability, ProviderExecutionSignal
from .yahoo_provider import SymbolMarketData


OPENBB_CREDENTIAL_ENV_MAP = {
    "TIINGO_API_TOKEN": "tiingo_token",
    "ALPHAVANTAGE_API_KEY": "alpha_vantage_api_key",
    "FMP_API_KEY": "fmp_api_key",
    "FRED_API_KEY": "fred_api_key",
}

OPENBB_PRICE_ENDPOINT = "openbb.equity.price.historical"
OPENBB_YIELD_CURVE_ENDPOINT = "openbb.fixedincome.government.yield_curve"
OPENBB_INDEX_CONSTITUENTS_ENDPOINT = "openbb.index.constituents"


def _load_obb() -> Any:
    module = importlib.import_module("openbb")
    return getattr(module, "obb")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _retry_after(hours: int = 4) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat(timespec="seconds").replace("+00:00", "Z")


def _normalize_key(value: Any) -> str:
    return str(value or "").strip().lower().replace(" ", "").replace("_", "").replace(".", "")


def _pick_value(row: Mapping[str, Any], *keys: str) -> Any:
    normalized_keys = {_normalize_key(key) for key in keys}
    for key in keys:
        if key in row and row[key] is not None:
            return row[key]
    for key, value in row.items():
        if _normalize_key(key) in normalized_keys and value is not None:
            return value
    return None


def _coerce_float(value: Any, default: float | None = 0.0) -> float | None:
    try:
        if value in (None, ""):
            return default
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return default


def _coerce_text(value: Any) -> str:
    return str(value or "").strip()


def _coerce_date(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    date_method = getattr(value, "date", None)
    if callable(date_method):
        try:
            candidate = date_method()
            if isinstance(candidate, date):
                return candidate.isoformat()
        except Exception:
            pass
    text = str(value or "").strip()
    if not text:
        return ""
    return text.replace("T", " ").split(" ", 1)[0][:10]


def _row_to_dict(row: Any) -> dict[str, Any]:
    if isinstance(row, Mapping):
        return dict(row)
    model_dump = getattr(row, "model_dump", None)
    if callable(model_dump):
        try:
            payload = model_dump()
            if isinstance(payload, Mapping):
                return dict(payload)
        except Exception:
            pass
    to_dict = getattr(row, "dict", None)
    if callable(to_dict):
        try:
            payload = to_dict()
            if isinstance(payload, Mapping):
                return dict(payload)
        except Exception:
            pass
    attrs = getattr(row, "__dict__", None)
    if isinstance(attrs, Mapping):
        return {str(key): value for key, value in attrs.items() if not str(key).startswith("_")}
    return {}


def _records_from_tabular(candidate: Any) -> list[dict[str, Any]]:
    reset_index = getattr(candidate, "reset_index", None)
    if callable(reset_index):
        try:
            candidate = reset_index()
        except Exception:
            pass
    if isinstance(candidate, list):
        return [payload for payload in (_row_to_dict(item) for item in candidate) if payload]
    if isinstance(candidate, tuple):
        return [payload for payload in (_row_to_dict(item) for item in candidate) if payload]
    if isinstance(candidate, Mapping):
        return [dict(candidate)]
    to_dict = getattr(candidate, "to_dict", None)
    if callable(to_dict):
        try:
            records = to_dict("records")
        except Exception:
            records = None
        if isinstance(records, list):
            return [payload for payload in (_row_to_dict(item) for item in records) if payload]
    values = getattr(candidate, "values", None)
    columns = list(getattr(candidate, "columns", []) or [])
    if values is not None and columns:
        try:
            rows = values.tolist()
        except Exception:
            rows = list(values)
        extracted: list[dict[str, Any]] = []
        for row in rows:
            if isinstance(row, Mapping):
                extracted.append(dict(row))
            elif isinstance(row, (list, tuple)):
                extracted.append({columns[index]: value for index, value in enumerate(row) if index < len(columns)})
        return extracted
    payload = _row_to_dict(candidate)
    return [payload] if payload else []


def _extract_obb_records(payload: Any) -> list[dict[str, Any]]:
    if payload is None:
        return []
    results = getattr(payload, "results", None)
    if results is not None:
        records = _records_from_tabular(results)
        if records:
            return records
    to_df = getattr(payload, "to_df", None)
    if callable(to_df):
        try:
            records = _records_from_tabular(to_df())
        except Exception:
            records = []
        if records:
            return records
    return _records_from_tabular(payload)


def _set_credential(credentials: Any, key: str, value: str) -> bool:
    if credentials is None:
        return False
    try:
        setattr(credentials, key, value)
        return True
    except Exception:
        pass
    if isinstance(credentials, dict):
        credentials[key] = value
        return True
    try:
        credentials[key] = value
        return True
    except Exception:
        return False


def _apply_openbb_credentials(obb: Any) -> list[str]:
    user = getattr(obb, "user", None)
    credentials = getattr(user, "credentials", None)
    configured: list[str] = []
    for env_name, credential_name in OPENBB_CREDENTIAL_ENV_MAP.items():
        value = os.getenv(env_name)
        if not value:
            continue
        if _set_credential(credentials, credential_name, value):
            configured.append(credential_name)
    return configured


def _availability_metadata(access_tier: str, openbb_provider: str, required_env_vars: Sequence[str]) -> dict[str, Any]:
    return {
        "access_tier": access_tier,
        "openbb_provider": openbb_provider,
        "required_env_vars": list(required_env_vars),
        "secret_persistence": "disabled",
    }


class OpenBBProviderBase:
    provider_name = "openbb"
    openbb_provider = ""
    required_env_vars: tuple[str, ...] = ()
    access_tier = "public"
    quota_limited = False

    def __init__(self) -> None:
        self._obb_module: Any | None = None

    @property
    def metadata(self) -> dict[str, Any]:
        return _availability_metadata(self.access_tier, self.openbb_provider, self.required_env_vars)

    def _missing_env_vars(self) -> list[str]:
        return [name for name in self.required_env_vars if not str(os.getenv(name) or "").strip()]

    def _obb(self) -> Any:
        if self._obb_module is None:
            self._obb_module = _load_obb()
        _apply_openbb_credentials(self._obb_module)
        return self._obb_module

    def availability(self) -> ProviderAvailability:
        missing = self._missing_env_vars()
        if missing:
            return ProviderAvailability(
                provider_name=self.provider_name,
                available=False,
                reason=f"Missing required environment variable(s): {', '.join(missing)}.",
                metadata=self.metadata,
            )
        try:
            self._obb()
        except Exception as exc:
            return ProviderAvailability(
                provider_name=self.provider_name,
                available=False,
                reason=f"OpenBB is not installed or not initialized: {exc}",
                metadata={**self.metadata, "requires_extra": "openbb-provider"},
            )
        return ProviderAvailability(provider_name=self.provider_name, available=True, metadata=self.metadata)

    def _classify_exception(self, symbol: str, exc: Exception) -> ProviderExecutionSignal:
        message = str(exc or "").strip() or f"{self.provider_name} request failed"
        lowered = message.lower()
        if any(token in lowered for token in ("429", "too many requests", "rate limit", "quota", "throttle")):
            return ProviderExecutionSignal(
                message,
                status="limited",
                reason="rate_limited",
                metadata={
                    "provider_symbol": symbol.upper(),
                    "quota_limited": True,
                    "next_retry_at": _retry_after(),
                    "openbb_provider": self.openbb_provider,
                },
            )
        if any(token in lowered for token in ("401", "403", "unauthorized", "forbidden", "api key", "apikey", "token")):
            return ProviderExecutionSignal(
                message,
                status="failed",
                reason="auth_failed",
                metadata={"provider_symbol": symbol.upper(), "openbb_provider": self.openbb_provider},
            )
        if any(token in lowered for token in ("no data", "no rows", "not found", "invalid symbol", "empty")):
            return ProviderExecutionSignal(
                message,
                status="failed",
                reason="no_history",
                metadata={"provider_symbol": symbol.upper(), "openbb_provider": self.openbb_provider},
            )
        return ProviderExecutionSignal(
            message,
            status="failed",
            reason="transient_request_failure",
            metadata={"provider_symbol": symbol.upper(), "openbb_provider": self.openbb_provider},
        )


class OpenBBHistoricalPriceProvider(OpenBBProviderBase):
    supports_action_enrichment = True
    supports_targeted_price_repair = False

    def _call_historical(self, symbol: str, start_date: date, end_date: date) -> Any:
        obb = self._obb()
        historical = obb.equity.price.historical
        kwargs = {
            "symbol": symbol.upper(),
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "provider": self.openbb_provider,
        }
        try:
            return historical(**kwargs)
        except TypeError:
            return historical(symbol.upper(), start_date.isoformat(), end_date.isoformat(), provider=self.openbb_provider)

    def fetch_history(self, symbol: str, start_date: date, end_date: date) -> SymbolMarketData:
        availability = self.availability()
        if not availability.available:
            raise ProviderExecutionSignal(
                str(availability.reason or f"{self.provider_name} unavailable"),
                status="failed",
                reason="provider_unavailable",
                metadata={**availability.metadata, "provider_symbol": symbol.upper()},
            )
        try:
            payload = self._call_historical(symbol, start_date, end_date)
        except ProviderExecutionSignal:
            raise
        except Exception as exc:
            raise self._classify_exception(symbol, exc) from exc

        records = _extract_obb_records(payload)
        if not records:
            raise ProviderExecutionSignal(
                f"No OpenBB history rows returned for {symbol}",
                status="failed",
                reason="no_history",
                metadata={"provider_symbol": symbol.upper(), "openbb_provider": self.openbb_provider},
            )

        bars: list[MarketBar] = []
        actions: list[dict[str, Any]] = []
        skipped_rows = 0
        for row in records:
            trade_date = _coerce_date(_pick_value(row, "date", "Date", "datetime", "timestamp"))
            if not trade_date or trade_date < start_date.isoformat() or trade_date > end_date.isoformat():
                continue
            open_value = _pick_value(row, "open", "Open")
            close_value = _pick_value(row, "close", "Close", "adj_close", "adjusted_close")
            if open_value is None or close_value is None:
                skipped_rows += 1
                continue
            high_value = _pick_value(row, "high", "High")
            low_value = _pick_value(row, "low", "Low")
            adj_close_value = _pick_value(row, "adj_close", "adjusted_close", "Adj Close", "adjclose")
            if adj_close_value is None:
                adj_close_value = close_value
            bars.append(
                MarketBar(
                    date=trade_date,
                    open=float(_coerce_float(open_value, 0.0) or 0.0),
                    high=float(_coerce_float(high_value, _coerce_float(open_value, 0.0)) or 0.0),
                    low=float(_coerce_float(low_value, _coerce_float(open_value, 0.0)) or 0.0),
                    close=float(_coerce_float(close_value, 0.0) or 0.0),
                    adj_close=float(_coerce_float(adj_close_value, _coerce_float(close_value, 0.0)) or 0.0),
                    volume=float(_coerce_float(_pick_value(row, "volume", "Volume"), 0.0) or 0.0),
                )
            )
            dividend = _coerce_float(
                _pick_value(row, "dividend", "dividends", "cash_dividend", "Cash Dividend"),
                0.0,
            )
            if dividend and dividend > 0:
                actions.append(
                    {
                        "date": trade_date,
                        "action_type": "dividend",
                        "value": dividend,
                        "source": self.provider_name,
                        "payload": {"amount": dividend, "openbb_provider": self.openbb_provider},
                    }
                )
            split_ratio = _coerce_float(
                _pick_value(row, "split_ratio", "split", "splits", "stock_splits", "Stock Splits", "split_factor"),
                0.0,
            )
            if split_ratio and split_ratio > 0 and split_ratio != 1.0:
                actions.append(
                    {
                        "date": trade_date,
                        "action_type": "split" if split_ratio > 1.0 else "reverse_split",
                        "value": split_ratio,
                        "source": self.provider_name,
                        "payload": {"split_ratio": split_ratio, "openbb_provider": self.openbb_provider},
                    }
                )

        if not bars:
            raise ProviderExecutionSignal(
                f"No usable OpenBB price rows returned for {symbol}",
                status="failed",
                reason="no_history",
                metadata={"provider_symbol": symbol.upper(), "openbb_provider": self.openbb_provider},
            )

        warnings: list[str] = []
        if skipped_rows:
            warnings.append(f"Skipped {skipped_rows} OpenBB rows because required price fields were incomplete.")
        bars.sort(key=lambda item: item.date)
        return SymbolMarketData(
            symbol=symbol.upper(),
            bars=bars,
            actions=actions,
            source=self.provider_name,
            fallback_source=None,
            partial=bool(warnings),
            warnings=warnings,
            metadata={
                "provider": self.provider_name,
                "openbb_provider": self.openbb_provider,
                "bar_count": len(bars),
                "event_types": sorted({item["action_type"] for item in actions}),
                "actions_supported": self.supports_action_enrichment,
            },
        )


class OpenBBYfinanceMarketDataProvider(OpenBBHistoricalPriceProvider):
    provider_name = "openbb_yfinance"
    openbb_provider = "yfinance"
    access_tier = "public"


class OpenBBTiingoMarketDataProvider(OpenBBHistoricalPriceProvider):
    provider_name = "openbb_tiingo"
    openbb_provider = "tiingo"
    required_env_vars = ("TIINGO_API_TOKEN",)
    access_tier = "free_account"
    quota_limited = True


class OpenBBFmpMarketDataProvider(OpenBBHistoricalPriceProvider):
    provider_name = "openbb_fmp"
    openbb_provider = "fmp"
    required_env_vars = ("FMP_API_KEY",)
    access_tier = "paid_optional"
    quota_limited = True


class OpenBBAlphaVantagePriceRepairProvider(OpenBBHistoricalPriceProvider):
    provider_name = "openbb_alpha_vantage"
    openbb_provider = "alpha_vantage"
    required_env_vars = ("ALPHAVANTAGE_API_KEY",)
    access_tier = "free_account"
    supports_action_enrichment = False
    supports_targeted_price_repair = True
    quota_limited = True


TENOR_TO_INSTRUMENT = {
    "2Y": ("UST_CMT_2Y", "UST2Y", "US Treasury CMT 2Y", "treasury_cmt", 2.0, "nominal"),
    "5Y": ("TIPS_5Y", "TIPS5Y", "US TIPS Real Yield 5Y", "tips_cmt", 5.0, "real"),
    "10Y": ("UST_CMT_10Y", "UST10Y", "US Treasury CMT 10Y", "treasury_cmt", 10.0, "nominal"),
    "30Y": ("UST_CMT_30Y", "UST30Y", "US Treasury CMT 30Y", "treasury_cmt", 30.0, "nominal"),
}

REAL_TENOR_TO_INSTRUMENT = {
    "5Y": ("TIPS_5Y", "TIPS5Y", "US TIPS Real Yield 5Y", "tips_cmt", 5.0, "real"),
    "10Y": ("TIPS_10Y", "TIPS10Y", "US TIPS Real Yield 10Y", "tips_cmt", 10.0, "real"),
}

NOMINAL_WIDE_FIELDS = {
    "UST_CMT_2Y": ("BC_2YEAR", "year_2", "year2", "two_year", "2y", "2_year", "2 year"),
    "UST_CMT_10Y": ("BC_10YEAR", "year_10", "year10", "ten_year", "10y", "10_year", "10 year"),
    "UST_CMT_30Y": ("BC_30YEAR", "year_30", "year30", "thirty_year", "30y", "30_year", "30 year"),
}

REAL_WIDE_FIELDS = {
    "TIPS_5Y": ("TC_5YEAR", "real_5y", "year_5", "year5", "5y", "5_year", "5 year"),
    "TIPS_10Y": ("TC_10YEAR", "real_10y", "year_10", "year10", "10y", "10_year", "10 year"),
}


def _normalize_tenor(value: Any) -> str:
    text = str(value or "").strip().upper().replace(" ", "")
    if not text:
        return ""
    replacements = {
        "2YEAR": "2Y",
        "2YEARS": "2Y",
        "2YR": "2Y",
        "5YEAR": "5Y",
        "5YEARS": "5Y",
        "5YR": "5Y",
        "10YEAR": "10Y",
        "10YEARS": "10Y",
        "10YR": "10Y",
        "30YEAR": "30Y",
        "30YEARS": "30Y",
        "30YR": "30Y",
    }
    return replacements.get(text, text)


def _curve_points_from_records(records: Sequence[Mapping[str, Any]], *, real: bool) -> dict[str, dict[str, Any]]:
    fields = REAL_WIDE_FIELDS if real else NOMINAL_WIDE_FIELDS
    points: dict[str, dict[str, Any]] = {}
    for row in records:
        snapshot_date = _coerce_date(_pick_value(row, "date", "Date", "time", "timestamp")) or date.today().isoformat()
        for instrument_id, field_names in fields.items():
            ytm = _coerce_float(_pick_value(row, *field_names), None)
            if ytm is None:
                continue
            points[instrument_id] = {"snapshot_date": snapshot_date, "ytm_pct": ytm, "raw_fields": dict(row)}
        tenor = _normalize_tenor(_pick_value(row, "tenor", "maturity", "maturity_label", "name"))
        ytm = _coerce_float(_pick_value(row, "rate", "value", "yield", "yield_rate", "close"), None)
        if not tenor or ytm is None:
            continue
        instrument_map = REAL_TENOR_TO_INSTRUMENT if real else TENOR_TO_INSTRUMENT
        mapped = instrument_map.get(tenor)
        if not mapped:
            continue
        instrument_id = mapped[0]
        points[instrument_id] = {"snapshot_date": snapshot_date, "ytm_pct": ytm, "raw_fields": dict(row)}
    return points


def _provider_source(openbb_provider: str) -> str:
    if openbb_provider == "federal_reserve":
        return "openbb_federal_reserve"
    if openbb_provider == "fred":
        return "openbb_fred"
    return f"openbb_{openbb_provider}"


def _instrument_profile(instrument_id: str) -> tuple[str, str, str, float, str]:
    for profile in list(TENOR_TO_INSTRUMENT.values()) + list(REAL_TENOR_TO_INSTRUMENT.values()):
        if profile[0] == instrument_id:
            return profile[1], profile[2], profile[3], profile[4], profile[5]
    return instrument_id, instrument_id, "treasury_cmt", 10.0, "nominal"


def _build_curve_snapshot(
    *,
    instrument_id: str,
    point: Mapping[str, Any],
    source: str,
    openbb_provider: str,
    fetched_at: str,
    breakeven_inflation_bps: float | None = None,
) -> dict[str, Any]:
    symbol, name, instrument_type, years, yield_basis = _instrument_profile(instrument_id)
    ytm = _coerce_float(point.get("ytm_pct"), 0.0) or 0.0
    snapshot_date = str(point.get("snapshot_date") or date.today().isoformat())[:10]
    snapshot_id = f"bond_fixed_income::{instrument_id}::{snapshot_date}::{source}"
    is_real = instrument_id.startswith("TIPS_")
    raw = {
        "provider": source,
        "openbb_provider": openbb_provider,
        "endpoint": OPENBB_YIELD_CURVE_ENDPOINT,
        "dataset": f"{openbb_provider}_{'real' if is_real else 'nominal'}_yield_curve",
        "fetched_at": fetched_at,
        "record_as_of": snapshot_date,
        "raw_fields": dict(point.get("raw_fields") or {}),
        "proxy_kind": "OPENBB_TIPS_REAL_CMT_PROXY" if is_real else "OPENBB_UST_CMT_PROXY",
        "yield_basis": yield_basis,
        "audit_profile": instrument_id,
        "tenor_label": instrument_id.rsplit("_", 1)[-1],
        "breakeven_inflation_bps": breakeven_inflation_bps,
        "audit_alerts": [],
        "tracking_status": "READY",
    }
    return {
        "id": snapshot_id,
        "instrument_id": instrument_id,
        "symbol": symbol,
        "name": name,
        "instrument_type": instrument_type,
        "currency": "USD",
        "snapshot_date": snapshot_date,
        "clean_price": 100.0,
        "net_price": 100.0,
        "dirty_price": 100.0,
        "full_price": 100.0,
        "accrued_interest": 0.0,
        "ytm_pct": ytm,
        "duration": _modified_duration(years, ytm),
        "convexity": _convexity_proxy(years, ytm),
        "source": source,
        "source_snapshot_id": snapshot_id,
        "refresh_status": "READY",
        "missing_fields": [],
        "inferred_fields": {
            "clean_price": "openbb_curve_par_proxy",
            "net_price": "openbb_curve_par_proxy",
            "dirty_price": "openbb_curve_par_proxy",
            "full_price": "openbb_curve_par_proxy",
            "accrued_interest": "openbb_curve_proxy",
            "duration": "openbb_curve_modified_duration_proxy",
            "convexity": "openbb_curve_convexity_proxy",
        },
        "raw": raw,
    }


class OpenBBBondFixedIncomeProvider(OpenBBProviderBase):
    provider_name = "openbb_bond_fixed_income"
    openbb_provider = "fixedincome"
    access_tier = "public"

    def __init__(
        self,
        official_provider: Callable[..., Any] | None = None,
        openbb_providers: Sequence[str] | None = None,
    ) -> None:
        super().__init__()
        self.official_provider = official_provider or fetch_official_bond_fixed_income_snapshots
        self.openbb_providers = tuple(openbb_providers or ("federal_reserve", "fred"))

    def _call_official(self, as_of_date: date) -> tuple[list[dict[str, Any]], list[str], list[str], dict[str, Any], list[dict[str, Any]]]:
        result = self.official_provider(today=as_of_date)
        if isinstance(result, Mapping):
            return (
                [dict(item) for item in (result.get("snapshots") or []) if isinstance(item, Mapping)],
                [str(item) for item in (result.get("warnings") or []) if item],
                [str(item) for item in (result.get("errors") or []) if item],
                dict(result.get("telemetry") or {}),
                [dict(item) for item in (result.get("provider_results") or []) if isinstance(item, Mapping)],
            )
        return (
            [dict(item) for item in (getattr(result, "snapshots", []) or []) if isinstance(item, Mapping)],
            [str(item) for item in (getattr(result, "warnings", []) or []) if item],
            [str(item) for item in (getattr(result, "errors", []) or []) if item],
            dict(getattr(result, "telemetry", {}) or {}),
            [dict(item) for item in (getattr(result, "provider_results", []) or []) if isinstance(item, Mapping)],
        )

    def _fetch_curve_points(self, *, openbb_provider: str, as_of_date: date, real: bool) -> dict[str, dict[str, Any]]:
        obb = self._obb()
        yield_curve = obb.fixedincome.government.yield_curve
        kwargs = {
            "date": as_of_date.isoformat(),
            "provider": openbb_provider,
            "yield_curve_type": "real" if real else "nominal",
        }
        try:
            payload = yield_curve(**kwargs)
        except TypeError:
            try:
                payload = yield_curve(provider=openbb_provider, yield_curve_type="real" if real else "nominal")
            except TypeError:
                payload = yield_curve(provider=openbb_provider)
        return _curve_points_from_records(_extract_obb_records(payload), real=real)

    def fetch_snapshots(self, *, as_of_date: date | None = None) -> dict[str, Any]:
        as_of = as_of_date or date.today()
        fetched_at = _utc_now()
        snapshots, warnings, errors, telemetry, provider_results = self._call_official(as_of)
        snapshots_by_instrument = {
            str(item.get("instrument_id") or ""): dict(item)
            for item in snapshots
            if str(item.get("instrument_id") or "").strip()
        }
        if not provider_results:
            for source in sorted({str(item.get("source") or "") for item in snapshots if str(item.get("source") or "")}):
                provider_results.append(
                    {
                        "provider": source,
                        "status": "succeeded",
                        "instrument_count": len([item for item in snapshots if str(item.get("source") or "") == source]),
                    }
                )

        for openbb_provider in self.openbb_providers:
            source = _provider_source(openbb_provider)
            if openbb_provider == "fred" and not str(os.getenv("FRED_API_KEY") or "").strip():
                provider_results.append(
                    {
                        "provider": source,
                        "status": "unavailable",
                        "reason": "Missing required environment variable(s): FRED_API_KEY.",
                        "instrument_count": 0,
                    }
                )
                continue
            try:
                nominal_points = self._fetch_curve_points(openbb_provider=openbb_provider, as_of_date=as_of, real=False)
                real_points = self._fetch_curve_points(openbb_provider=openbb_provider, as_of_date=as_of, real=True)
            except Exception as exc:
                provider_results.append(
                    {
                        "provider": source,
                        "status": "failed",
                        "reason": str(exc),
                        "instrument_count": 0,
                    }
                )
                warnings.append(f"{source}: OpenBB yield curve fetch failed: {exc}")
                continue

            filled = 0
            cross_checked = 0
            nominal_10y = _coerce_float((nominal_points.get("UST_CMT_10Y") or {}).get("ytm_pct"), None)
            for instrument_id, point in {**nominal_points, **real_points}.items():
                breakeven = None
                if instrument_id == "TIPS_10Y":
                    real_10y = _coerce_float(point.get("ytm_pct"), None)
                    if nominal_10y is not None and real_10y is not None:
                        breakeven = round((nominal_10y - real_10y) * 100.0, 4)
                if instrument_id in snapshots_by_instrument:
                    raw = dict(snapshots_by_instrument[instrument_id].get("raw") or {})
                    checks = [dict(item) for item in (raw.get("openbb_cross_checks") or []) if isinstance(item, Mapping)]
                    checks.append(
                        {
                            "provider": source,
                            "openbb_provider": openbb_provider,
                            "ytm_pct": point.get("ytm_pct"),
                            "snapshot_date": point.get("snapshot_date"),
                            "endpoint": OPENBB_YIELD_CURVE_ENDPOINT,
                        }
                    )
                    raw["openbb_cross_checks"] = checks
                    snapshots_by_instrument[instrument_id]["raw"] = raw
                    cross_checked += 1
                    continue
                snapshots_by_instrument[instrument_id] = _build_curve_snapshot(
                    instrument_id=instrument_id,
                    point=point,
                    source=source,
                    openbb_provider=openbb_provider,
                    fetched_at=fetched_at,
                    breakeven_inflation_bps=breakeven,
                )
                filled += 1
            provider_results.append(
                {
                    "provider": source,
                    "status": "succeeded" if filled or cross_checked else "empty",
                    "instrument_count": filled + cross_checked,
                    "filled_instrument_count": filled,
                    "cross_checked_instrument_count": cross_checked,
                    "endpoint": OPENBB_YIELD_CURVE_ENDPOINT,
                }
            )

        telemetry = dict(telemetry or {})
        telemetry["openbb_enabled"] = True
        telemetry["provider_results"] = provider_results
        return {
            "snapshots": list(snapshots_by_instrument.values()),
            "warnings": warnings,
            "errors": errors,
            "provider_results": provider_results,
            "telemetry": telemetry,
        }


class OpenBBCurrentUniverseConstituentCheckProvider(OpenBBProviderBase):
    provider_name = "openbb_index_constituents"
    openbb_provider = "fmp"
    required_env_vars = ("FMP_API_KEY",)
    access_tier = "paid_optional"

    def _symbol_for_universe(self, universe_key: str, universe_name: str) -> str:
        text = f"{universe_key} {universe_name}".lower()
        if "nasdaq" in text or "ndx" in text or "100" in text:
            return "nasdaq100"
        return "sp500"

    def check_current_constituents(
        self,
        *,
        universe_key: str,
        universe_name: str,
        symbols: Sequence[str],
    ) -> dict[str, Any]:
        availability = self.availability()
        if not availability.available:
            return {
                "provider": self.provider_name,
                "openbb_provider": self.openbb_provider,
                "status": "unavailable",
                "reason": availability.reason,
                "checked_at": _utc_now(),
                "auxiliary_only": True,
            }
        query_symbol = self._symbol_for_universe(universe_key, universe_name)
        try:
            payload = self._obb().index.constituents(symbol=query_symbol, provider=self.openbb_provider)
            records = _extract_obb_records(payload)
        except Exception as exc:
            return {
                "provider": self.provider_name,
                "openbb_provider": self.openbb_provider,
                "status": "failed",
                "reason": str(exc),
                "checked_at": _utc_now(),
                "auxiliary_only": True,
            }
        openbb_symbols = {
            _coerce_text(_pick_value(row, "symbol", "ticker", "Symbol", "Ticker")).upper()
            for row in records
        }
        openbb_symbols = {symbol for symbol in openbb_symbols if symbol}
        anchor_symbols = {_coerce_text(symbol).upper() for symbol in symbols if _coerce_text(symbol)}
        missing_from_openbb = sorted(anchor_symbols - openbb_symbols)
        extra_openbb_symbols = sorted(openbb_symbols - anchor_symbols)
        return {
            "provider": self.provider_name,
            "openbb_provider": self.openbb_provider,
            "status": "succeeded" if openbb_symbols else "empty",
            "checked_at": _utc_now(),
            "endpoint": OPENBB_INDEX_CONSTITUENTS_ENDPOINT,
            "query_symbol": query_symbol,
            "current_member_count": len(openbb_symbols),
            "anchor_member_count": len(anchor_symbols),
            "matched_latest_anchor_count": len(anchor_symbols & openbb_symbols),
            "missing_from_openbb": missing_from_openbb[:25],
            "extra_openbb_symbols": extra_openbb_symbols[:25],
            "auxiliary_only": True,
        }

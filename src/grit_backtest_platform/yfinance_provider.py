from __future__ import annotations

import importlib
from datetime import date, timedelta
from typing import Any

from .backtest_engine import MarketBar
from .fallback_provider import ProviderAvailability, ProviderExecutionSignal
from .yahoo_provider import SymbolMarketData


def _load_yfinance() -> Any:
    return importlib.import_module("yfinance")


def _coerce_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _coerce_text(value: Any) -> str:
    return str(value or "").strip()


def _pick_value(row: dict[str, Any], *keys: str) -> Any:
    normalized_keys = {
        str(key).strip().lower().replace(" ", "").replace("_", "").replace(".", "")
        for key in keys
    }
    for key in keys:
        if key in row and row[key] is not None:
            return row[key]
    for key, value in row.items():
        normalized = str(key).strip().lower().replace(" ", "").replace("_", "").replace(".", "")
        if normalized in normalized_keys and value is not None:
            return value
    return None


def _extract_records(payload: Any) -> list[dict[str, Any]]:
    if payload is None:
        return []
    candidate = payload
    reset_index = getattr(candidate, "reset_index", None)
    if callable(reset_index):
        try:
            candidate = reset_index()
        except Exception:
            candidate = payload
    if isinstance(candidate, list):
        return [dict(item) for item in candidate if isinstance(item, dict)]
    if isinstance(candidate, dict):
        return [dict(candidate)]
    to_dict = getattr(candidate, "to_dict", None)
    if callable(to_dict):
        try:
            records = to_dict("records")
        except Exception:
            records = None
        if isinstance(records, list):
            return [dict(item) for item in records if isinstance(item, dict)]
    values = getattr(candidate, "values", None)
    columns = list(getattr(candidate, "columns", []) or [])
    if values is not None and columns:
        try:
            rows = values.tolist()
        except Exception:
            rows = list(values)
        extracted: list[dict[str, Any]] = []
        for row in rows:
            if isinstance(row, dict):
                extracted.append(dict(row))
            elif isinstance(row, (list, tuple)):
                extracted.append(
                    {
                        columns[index]: value
                        for index, value in enumerate(row)
                        if index < len(columns)
                    }
                )
        return extracted
    return []


class YfinanceMarketDataProvider:
    provider_name = "yfinance"
    supports_action_enrichment = True

    def __init__(self) -> None:
        self._module: Any | None = None

    def _yfinance(self) -> Any:
        if self._module is None:
            self._module = _load_yfinance()
        return self._module

    def availability(self) -> ProviderAvailability:
        try:
            self._yfinance()
        except Exception:
            return ProviderAvailability(
                provider_name=self.provider_name,
                available=False,
                reason="yfinance is not installed.",
                metadata={"requires_module": "yfinance"},
            )
        return ProviderAvailability(
            provider_name=self.provider_name,
            available=True,
            metadata={"mode": "yahoo_family_fallback"},
        )

    def _classify_exception(self, symbol: str, exc: Exception) -> ProviderExecutionSignal:
        message = str(exc or "").strip() or "yfinance request failed"
        lowered = message.lower()
        if any(token in lowered for token in ("429", "too many requests", "rate limit", "blocked")):
            return ProviderExecutionSignal(
                message,
                status="limited",
                reason="rate_limited_or_blocked",
                metadata={"provider_symbol": symbol.upper(), "error_class": "rate_limited_or_blocked"},
            )
        if any(token in lowered for token in ("invalid", "not found", "missing symbol", "no matching")):
            return ProviderExecutionSignal(
                message,
                status="failed",
                reason="symbol_invalid",
                metadata={"provider_symbol": symbol.upper(), "error_class": "symbol_invalid"},
            )
        if any(token in lowered for token in ("no price data found", "possibly delisted", "no data found", "no timezone found")):
            return ProviderExecutionSignal(
                message,
                status="failed",
                reason="no_history",
                metadata={"provider_symbol": symbol.upper(), "error_class": "no_history"},
            )
        return ProviderExecutionSignal(
            message,
            status="failed",
            reason="transient_request_failure",
            metadata={"provider_symbol": symbol.upper(), "error_class": "transient_request_failure"},
        )

    def fetch_history(self, symbol: str, start_date: date, end_date: date) -> SymbolMarketData:
        try:
            yf = self._yfinance()
            ticker = yf.Ticker(symbol.upper())
            payload = ticker.history(
                start=start_date.isoformat(),
                end=(end_date + timedelta(days=1)).isoformat(),
                interval="1d",
                auto_adjust=False,
                actions=True,
            )
        except ProviderExecutionSignal:
            raise
        except Exception as exc:
            raise self._classify_exception(symbol, exc) from exc

        records = _extract_records(payload)
        if not records:
            raise ProviderExecutionSignal(
                f"No yfinance history rows returned for {symbol}",
                status="failed",
                reason="no_history",
                metadata={"provider_symbol": symbol.upper(), "error_class": "no_history"},
            )

        bars: list[MarketBar] = []
        actions: list[dict[str, Any]] = []
        skipped_rows = 0
        for row in records:
            trade_date = _coerce_text(_pick_value(row, "Date", "date", "Datetime", "datetime"))[:10]
            if not trade_date:
                skipped_rows += 1
                continue
            if trade_date < start_date.isoformat() or trade_date > end_date.isoformat():
                continue
            open_value = _pick_value(row, "Open", "open")
            close_value = _pick_value(row, "Close", "close")
            if open_value is None or close_value is None:
                skipped_rows += 1
                continue
            high_value = _pick_value(row, "High", "high")
            low_value = _pick_value(row, "Low", "low")
            adj_close = _pick_value(row, "Adj Close", "adj_close", "adjclose")
            if adj_close is None:
                adj_close = close_value
            volume = _pick_value(row, "Volume", "volume")
            bars.append(
                MarketBar(
                    date=trade_date,
                    open=_coerce_float(open_value),
                    high=_coerce_float(high_value, _coerce_float(open_value)),
                    low=_coerce_float(low_value, _coerce_float(open_value)),
                    close=_coerce_float(close_value),
                    adj_close=_coerce_float(adj_close, _coerce_float(close_value)),
                    volume=_coerce_float(volume),
                )
            )
            dividend = _coerce_float(_pick_value(row, "Dividends", "dividends"), 0.0)
            if dividend > 0:
                actions.append(
                    {
                        "date": trade_date,
                        "action_type": "dividend",
                        "value": dividend,
                        "source": self.provider_name,
                        "payload": {"amount": dividend},
                    }
                )
            split_ratio = _coerce_float(_pick_value(row, "Stock Splits", "stock_splits", "stocksplits"), 0.0)
            if split_ratio > 0 and split_ratio != 1.0:
                action_type = "split" if split_ratio > 1.0 else "reverse_split"
                actions.append(
                    {
                        "date": trade_date,
                        "action_type": action_type,
                        "value": split_ratio,
                        "source": self.provider_name,
                        "payload": {"split_ratio": split_ratio},
                    }
                )

        if not bars:
            raise ProviderExecutionSignal(
                f"No usable yfinance price rows returned for {symbol}",
                status="failed",
                reason="no_history",
                metadata={"provider_symbol": symbol.upper(), "error_class": "no_history"},
            )

        warnings: list[str] = []
        if skipped_rows:
            warnings.append(f"Skipped {skipped_rows} yfinance rows because required price fields were incomplete.")
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
                "bar_count": len(bars),
                "event_types": sorted({item["action_type"] for item in actions}),
                "actions_supported": True,
            },
        )

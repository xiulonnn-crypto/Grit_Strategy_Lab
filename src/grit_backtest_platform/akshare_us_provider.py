from __future__ import annotations

import importlib
from datetime import date
from typing import Any

from .backtest_engine import MarketBar
from .fallback_provider import ProviderAvailability
from .yahoo_provider import SymbolMarketData


def _load_akshare() -> Any:
    return importlib.import_module("akshare")


def _coerce_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _coerce_text(value: Any) -> str:
    return str(value or "").strip()


def _extract_records(payload: Any) -> list[dict[str, Any]]:
    if payload is None:
        return []
    if isinstance(payload, list):
        return [dict(row) for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict):
        for key in ("data", "records", "rows", "result"):
            value = payload.get(key)
            if isinstance(value, list):
                return [dict(row) for row in value if isinstance(row, dict)]
    to_dict = getattr(payload, "to_dict", None)
    if callable(to_dict):
        try:
            records = to_dict("records")
            if isinstance(records, list):
                return [dict(row) for row in records if isinstance(row, dict)]
        except Exception:
            pass
    values = getattr(payload, "values", None)
    if values is not None:
        try:
            rows = values.tolist()
        except Exception:
            rows = list(values)
        columns = list(getattr(payload, "columns", []) or [])
        extracted: list[dict[str, Any]] = []
        for row in rows:
            if isinstance(row, dict):
                extracted.append(dict(row))
            elif isinstance(row, (list, tuple)) and columns:
                extracted.append({columns[index]: value for index, value in enumerate(row) if index < len(columns)})
        return extracted
    return []


def _pick_value(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in row and row[key] is not None:
            return row[key]
    for key, value in row.items():
        normalized = str(key).strip().lower().replace(" ", "").replace("_", "")
        if normalized in {candidate.strip().lower().replace(" ", "").replace("_", "") for candidate in keys}:
            if value is not None:
                return value
    return None


class AkshareUsPriceProvider:
    provider_name = "akshare_us"

    def __init__(self) -> None:
        self._module: Any | None = None

    def _akshare(self) -> Any:
        if self._module is None:
            self._module = _load_akshare()
        return self._module

    def availability(self) -> ProviderAvailability:
        try:
            module = self._akshare()
        except Exception:
            return ProviderAvailability(
                provider_name=self.provider_name,
                available=False,
                reason="akshare is not installed.",
                metadata={"requires_module": "akshare"},
            )
        supported = any(callable(getattr(module, name, None)) for name in ("stock_us_daily", "stock_us_hist"))
        return ProviderAvailability(
            provider_name=self.provider_name,
            available=supported,
            reason=None if supported else "akshare US price helpers are unavailable.",
            metadata={"requires_module": "akshare", "supported_functions": ["stock_us_daily", "stock_us_hist"]},
        )

    def _fetch_records(self, symbol: str) -> list[dict[str, Any]]:
        module = self._akshare()
        base_symbol = symbol.split(".", 1)[0].upper()
        for function_name in ("stock_us_daily", "stock_us_hist"):
            fetcher = getattr(module, function_name, None)
            if not callable(fetcher):
                continue
            for candidate in (base_symbol, symbol.upper(), base_symbol.lower()):
                try:
                    payload = fetcher(candidate)
                except TypeError:
                    try:
                        payload = fetcher(candidate, None)
                    except TypeError:
                        continue
                except Exception:
                    continue
                records = _extract_records(payload)
                if records:
                    return records
        return []

    def fetch_history(self, symbol: str, start_date: date, end_date: date) -> SymbolMarketData:
        records = self._fetch_records(symbol)
        if not records:
            raise RuntimeError(f"No usable AkShare price rows returned for {symbol}")

        base_symbol = symbol.split(".", 1)[0].upper()
        bars: list[MarketBar] = []
        skipped_rows = 0
        for row in records:
            trade_date = _coerce_text(_pick_value(row, "date", "日期", "trade_date", "time"))
            if not trade_date:
                skipped_rows += 1
                continue
            trade_date = trade_date[:10]
            if trade_date < start_date.isoformat() or trade_date > end_date.isoformat():
                continue
            open_value = _pick_value(row, "open", "开盘")
            close_value = _pick_value(row, "close", "收盘")
            if open_value is None or close_value is None:
                skipped_rows += 1
                continue
            high_value = _pick_value(row, "high", "最高") or open_value
            low_value = _pick_value(row, "low", "最低") or open_value
            adj_close = _pick_value(row, "adj_close", "adjClose", "复权收盘", "收盘_复权", "复权")
            if adj_close is None:
                adj_close = close_value
            volume = _pick_value(row, "volume", "成交量") or 0.0
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

        if skipped_rows and not bars:
            raise RuntimeError(f"No usable AkShare price rows returned for {symbol}")
        if not bars:
            raise RuntimeError(f"No usable AkShare price rows returned for {symbol}")

        bars.sort(key=lambda item: item.date)
        return SymbolMarketData(
            symbol=base_symbol,
            bars=bars,
            actions=[],
            source=self.provider_name,
            fallback_source=None,
            partial=bool(skipped_rows),
            warnings=[
                "AkShare US price helpers do not emit company actions; price rows are normalized only."
            ]
            if skipped_rows
            else [],
            metadata={
                "provider": self.provider_name,
                "bar_count": len(bars),
                "supported_functions": ["stock_us_daily", "stock_us_hist"],
                "actions_supported": False,
            },
        )

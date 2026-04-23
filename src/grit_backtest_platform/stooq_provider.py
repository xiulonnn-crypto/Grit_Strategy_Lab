from __future__ import annotations

import csv
import io
import os
import threading
import zipfile
from datetime import date
from pathlib import Path
from typing import Any

from .backtest_engine import MarketBar
from .fallback_provider import ProviderAvailability, ProviderExecutionSignal
from .yahoo_provider import SymbolMarketData


DEFAULT_STOOQ_US_DAILY_ARCHIVE = "d_us_txt.zip"


def _project_stooq_archive_path() -> Path:
    return Path(__file__).resolve().parents[2] / "data" / "vendor" / "stooq" / DEFAULT_STOOQ_US_DAILY_ARCHIVE


def _downloads_stooq_archive_path() -> Path:
    return Path.home() / "Downloads" / DEFAULT_STOOQ_US_DAILY_ARCHIVE


def _default_stooq_archive_path() -> Path:
    project_archive_path = _project_stooq_archive_path()
    if project_archive_path.is_file():
        return project_archive_path
    return _downloads_stooq_archive_path()


def _configured_archive_path(explicit_path: str | Path | None = None) -> Path:
    configured = str(
        explicit_path
        or os.getenv("GRIT_STOOQ_US_DAILY_ZIP")
        or os.getenv("STOOQ_US_DAILY_ZIP")
        or ""
    ).strip()
    if configured:
        return Path(configured).expanduser()
    return _default_stooq_archive_path()


def _normalize_symbol(value: str) -> str:
    normalized = str(value or "").strip().upper()
    if normalized.endswith(".US"):
        normalized = normalized[:-3]
    return normalized


def _symbol_lookup_candidates(symbol: str) -> list[str]:
    normalized = _normalize_symbol(symbol)
    if not normalized:
        return []
    candidates = [normalized]
    dotted = normalized.replace("-", ".")
    hyphenated = normalized.replace(".", "-")
    if hyphenated not in candidates:
        candidates.append(hyphenated)
    if dotted not in candidates:
        candidates.append(dotted)
    return candidates


def _safe_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_trade_date(value: Any) -> str:
    text = str(value or "").strip()
    if len(text) == 8 and text.isdigit():
        return f"{text[0:4]}-{text[4:6]}-{text[6:8]}"
    return text[:10]


class StooqZipPriceProvider:
    provider_name = "stooq"

    def __init__(self, archive_path: str | Path | None = None) -> None:
        self.archive_path = _configured_archive_path(archive_path)
        self._entry_index: dict[str, str] | None = None
        self._index_lock = threading.Lock()

    def availability(self) -> ProviderAvailability:
        archive_exists = self.archive_path.is_file()
        return ProviderAvailability(
            provider_name=self.provider_name,
            available=archive_exists,
            reason=None if archive_exists else f"Stooq offline archive not found at {self.archive_path}.",
            metadata={
                "mode": "offline_zip",
                "archive_path": str(self.archive_path),
            },
        )

    def _ensure_archive_available(self) -> Path:
        if not self.archive_path.is_file():
            raise ProviderExecutionSignal(
                f"Stooq offline archive is unavailable for {self.archive_path}",
                status="failed",
                reason="offline_archive_unavailable",
                metadata={"archive_path": str(self.archive_path)},
            )
        return self.archive_path

    def _load_entry_index(self) -> dict[str, str]:
        with self._index_lock:
            if self._entry_index is not None:
                return self._entry_index
            archive_path = self._ensure_archive_available()
            index: dict[str, str] = {}
            with zipfile.ZipFile(archive_path) as archive:
                for info in archive.infolist():
                    if info.is_dir():
                        continue
                    filename = Path(info.filename).name.lower()
                    if not filename.endswith(".us.txt"):
                        continue
                    symbol = filename[:-7].upper()
                    if not symbol:
                        continue
                    index.setdefault(symbol, info.filename)
                    dotted = symbol.replace("-", ".")
                    if dotted and dotted not in index:
                        index[dotted] = info.filename
            self._entry_index = index
            return index

    def _entry_name_for_symbol(self, symbol: str) -> str:
        entry_index = self._load_entry_index()
        for candidate in _symbol_lookup_candidates(symbol):
            entry_name = entry_index.get(candidate)
            if entry_name:
                return entry_name
        raise ProviderExecutionSignal(
            f"Stooq archive does not contain {symbol}",
            status="failed",
            reason="symbol_invalid",
            metadata={"archive_path": str(self.archive_path), "provider_symbol": _normalize_symbol(symbol)},
        )

    def fetch_history(self, symbol: str, start_date: date, end_date: date) -> SymbolMarketData:
        archive_path = self._ensure_archive_available()
        entry_name = self._entry_name_for_symbol(symbol)
        bars: list[MarketBar] = []
        skipped_rows = 0
        with zipfile.ZipFile(archive_path) as archive:
            with archive.open(entry_name, "r") as handle:
                text_stream = io.TextIOWrapper(handle, encoding="utf-8")
                reader = csv.DictReader(text_stream)
                for row in reader:
                    trade_date = _normalize_trade_date(row.get("<DATE>"))
                    if not trade_date:
                        skipped_rows += 1
                        continue
                    if trade_date < start_date.isoformat() or trade_date > end_date.isoformat():
                        continue
                    open_value = _safe_float(row.get("<OPEN>"))
                    high_value = _safe_float(row.get("<HIGH>"))
                    low_value = _safe_float(row.get("<LOW>"))
                    close_value = _safe_float(row.get("<CLOSE>"))
                    volume_value = _safe_float(row.get("<VOL>"))
                    if None in {open_value, high_value, low_value, close_value}:
                        skipped_rows += 1
                        continue
                    bars.append(
                        MarketBar(
                            date=trade_date,
                            open=float(open_value),
                            high=float(high_value),
                            low=float(low_value),
                            close=float(close_value),
                            adj_close=float(close_value),
                            volume=float(volume_value or 0.0),
                        )
                    )
        if not bars:
            raise ProviderExecutionSignal(
                f"Stooq archive returned no rows for {symbol} in the requested window",
                status="failed",
                reason="no_history",
                metadata={
                    "archive_path": str(archive_path),
                    "provider_symbol": _normalize_symbol(symbol),
                    "entry_name": entry_name,
                },
            )
        bars.sort(key=lambda item: item.date)
        warnings: list[str] = []
        if skipped_rows:
            warnings.append(f"Skipped {skipped_rows} Stooq rows because required price fields were incomplete.")
        return SymbolMarketData(
            symbol=_normalize_symbol(symbol),
            bars=bars,
            actions=[],
            source=self.provider_name,
            fallback_source=None,
            partial=False,
            warnings=warnings,
            metadata={
                "provider": self.provider_name,
                "mode": "offline_zip",
                "bar_count": len(bars),
                "actions_supported": False,
                "adj_close_proxy": True,
                "archive_path": str(archive_path),
                "entry_name": entry_name,
            },
        )


StooqPriceProvider = StooqZipPriceProvider

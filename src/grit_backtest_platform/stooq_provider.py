from __future__ import annotations

import csv
import io
import json
import os
import threading
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from .backtest_engine import MarketBar
from .fallback_provider import ProviderAvailability, ProviderExecutionSignal
from .yahoo_provider import SymbolMarketData


DEFAULT_STOOQ_US_DAILY_ARCHIVE = "d_us_txt.zip"
STOOQ_ONLINE_ENABLE_VALUES = {"1", "true", "yes", "on"}
STOOQ_ONLINE_BASE_URL = "https://stooq.com/q/d/l/"
STOOQ_ONLINE_MANIFEST_VERSION = "stooq_online_symbol_cache_v1"


def _project_stooq_archive_path() -> Path:
    return Path(__file__).resolve().parents[2] / "data" / "vendor" / "stooq" / DEFAULT_STOOQ_US_DAILY_ARCHIVE


def _downloads_stooq_archive_path() -> Path:
    return Path.home() / "Downloads" / DEFAULT_STOOQ_US_DAILY_ARCHIVE


def _default_stooq_archive_path() -> Path:
    project_archive_path = _project_stooq_archive_path()
    if project_archive_path.is_file():
        return project_archive_path
    return _downloads_stooq_archive_path()


def _default_stooq_online_cache_dir() -> Path:
    return Path(__file__).resolve().parents[2] / ".tmp" / "pit-bulk-cache" / "stooq"


def _configured_online_cache_dir() -> Path:
    configured = str(os.getenv("GRIT_STOOQ_ONLINE_CACHE_DIR") or "").strip()
    if configured:
        return Path(configured).expanduser()
    return _default_stooq_online_cache_dir()


def _stooq_online_enabled() -> bool:
    return str(os.getenv("GRIT_ENABLE_STOOQ_ONLINE") or "").strip().lower() in STOOQ_ONLINE_ENABLE_VALUES


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


def _online_provider_symbol(symbol: str) -> str:
    normalized = _normalize_symbol(symbol).replace(".", "-")
    return f"{normalized}.US" if normalized else ""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


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


def _row_value(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in row:
            return row.get(key)
        upper = key.upper()
        if upper in row:
            return row.get(upper)
        lower = key.lower()
        if lower in row:
            return row.get(lower)
        bracketed = f"<{upper}>"
        if bracketed in row:
            return row.get(bracketed)
        for row_key, value in row.items():
            if str(row_key).strip().lower() == key.lower():
                return value
    return None


def _bars_from_stooq_rows(
    rows: list[dict[str, Any]],
    *,
    start_date: date,
    end_date: date,
) -> tuple[list[MarketBar], int]:
    bars: list[MarketBar] = []
    skipped_rows = 0
    for row in rows:
        trade_date = _normalize_trade_date(_row_value(row, "DATE"))
        if not trade_date:
            skipped_rows += 1
            continue
        if trade_date < start_date.isoformat() or trade_date > end_date.isoformat():
            continue
        open_value = _safe_float(_row_value(row, "OPEN"))
        high_value = _safe_float(_row_value(row, "HIGH"))
        low_value = _safe_float(_row_value(row, "LOW"))
        close_value = _safe_float(_row_value(row, "CLOSE"))
        volume_value = _safe_float(_row_value(row, "VOL", "VOLUME"))
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
    bars.sort(key=lambda item: item.date)
    return bars, skipped_rows


class StooqZipPriceProvider:
    provider_name = "stooq"

    def __init__(self, archive_path: str | Path | None = None) -> None:
        self.archive_path = _configured_archive_path(archive_path)
        self.online_cache_dir = _configured_online_cache_dir()
        self._entry_index: dict[str, str] | None = None
        self._index_lock = threading.Lock()

    def availability(self) -> ProviderAvailability:
        archive_exists = self.archive_path.is_file()
        online_enabled = _stooq_online_enabled()
        return ProviderAvailability(
            provider_name=self.provider_name,
            available=archive_exists or online_enabled,
            reason=(
                None
                if archive_exists
                else (
                    "Stooq online CSV fallback is enabled because the offline archive is unavailable."
                    if online_enabled
                    else f"Stooq offline archive not found at {self.archive_path}."
                )
            ),
            metadata={
                "mode": "offline_zip" if archive_exists else "online_csv",
                "archive_path": str(self.archive_path),
                "online_enabled": online_enabled,
                "online_cache_dir": str(self.online_cache_dir),
                "access_tier": "public",
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
        if not self.archive_path.is_file() and _stooq_online_enabled():
            return self._fetch_history_online(symbol, start_date, end_date)
        return self._fetch_history_from_zip(symbol, start_date, end_date)

    def _fetch_history_from_zip(self, symbol: str, start_date: date, end_date: date) -> SymbolMarketData:
        archive_path = self._ensure_archive_available()
        entry_name = self._entry_name_for_symbol(symbol)
        rows: list[dict[str, Any]] = []
        with zipfile.ZipFile(archive_path) as archive:
            with archive.open(entry_name, "r") as handle:
                text_stream = io.TextIOWrapper(handle, encoding="utf-8")
                reader = csv.DictReader(text_stream)
                rows = [dict(row) for row in reader]
        bars, skipped_rows = _bars_from_stooq_rows(rows, start_date=start_date, end_date=end_date)
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

    def _stooq_online_url(self, provider_symbol: str) -> str:
        query = urllib.parse.urlencode({"s": provider_symbol, "i": "d"})
        return f"{STOOQ_ONLINE_BASE_URL}?{query}"

    def _manifest_path(self) -> Path:
        return self.online_cache_dir / "manifest.json"

    def _load_manifest(self) -> dict[str, Any]:
        path = self._manifest_path()
        if not path.is_file():
            return {"version": STOOQ_ONLINE_MANIFEST_VERSION, "entries": {}}
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {"version": STOOQ_ONLINE_MANIFEST_VERSION, "entries": {}}
        if not isinstance(payload, dict):
            return {"version": STOOQ_ONLINE_MANIFEST_VERSION, "entries": {}}
        payload.setdefault("version", STOOQ_ONLINE_MANIFEST_VERSION)
        payload.setdefault("entries", {})
        return payload

    def _write_manifest_entry(self, symbol: str, entry: dict[str, Any]) -> None:
        self.online_cache_dir.mkdir(parents=True, exist_ok=True)
        manifest = self._load_manifest()
        entries = manifest.setdefault("entries", {})
        if isinstance(entries, dict):
            entries[_normalize_symbol(symbol)] = entry
        manifest["generated_at"] = _utc_now()
        manifest["secret_persistence"] = "disabled"
        self._manifest_path().write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )

    def _fetch_history_online(self, symbol: str, start_date: date, end_date: date) -> SymbolMarketData:
        provider_symbol = _online_provider_symbol(symbol)
        if not provider_symbol:
            raise ProviderExecutionSignal(
                "Stooq online fallback requires a non-empty symbol.",
                status="failed",
                reason="symbol_invalid",
                metadata={"mode": "online_csv"},
            )
        url = self._stooq_online_url(provider_symbol)
        try:
            with urllib.request.urlopen(url, timeout=20) as response:
                raw_bytes = response.read()
        except urllib.error.HTTPError as exc:
            self._write_manifest_entry(
                symbol,
                {
                    "provider_symbol": provider_symbol,
                    "status": "HTTP_ERROR",
                    "http_status": exc.code,
                    "source_url": url,
                    "cached_at": _utc_now(),
                },
            )
            raise ProviderExecutionSignal(
                f"Stooq online CSV returned HTTP {exc.code} for {provider_symbol}",
                status="failed",
                reason="http_error",
                metadata={"provider_symbol": provider_symbol, "http_status": exc.code, "source_url": url},
            ) from exc
        except Exception as exc:
            self._write_manifest_entry(
                symbol,
                {
                    "provider_symbol": provider_symbol,
                    "status": "FETCH_FAILED",
                    "source_url": url,
                    "cached_at": _utc_now(),
                    "reason": str(exc),
                },
            )
            raise ProviderExecutionSignal(
                f"Stooq online CSV failed for {provider_symbol}: {exc}",
                status="failed",
                reason="fetch_failed",
                metadata={"provider_symbol": provider_symbol, "source_url": url},
            ) from exc

        text = raw_bytes.decode("utf-8-sig", errors="replace")
        rows = [dict(row) for row in csv.DictReader(io.StringIO(text))]
        csv_cache_path = self.online_cache_dir / f"{_normalize_symbol(symbol).replace('.', '-')}.csv"
        self.online_cache_dir.mkdir(parents=True, exist_ok=True)
        csv_cache_path.write_bytes(raw_bytes)
        bars, skipped_rows = _bars_from_stooq_rows(rows, start_date=start_date, end_date=end_date)
        manifest_entry = {
            "provider_symbol": provider_symbol,
            "status": "READY" if bars else "NO_ROWS",
            "row_count": len(bars),
            "raw_row_count": len(rows),
            "skipped_row_count": skipped_rows,
            "source_url": url,
            "cache_file": str(csv_cache_path),
            "cached_at": _utc_now(),
        }
        self._write_manifest_entry(symbol, manifest_entry)
        if not rows:
            raise ProviderExecutionSignal(
                f"Stooq online CSV returned an empty file for {provider_symbol}",
                status="failed",
                reason="empty_response",
                metadata={"provider_symbol": provider_symbol, "source_url": url},
            )
        if not bars:
            raise ProviderExecutionSignal(
                f"Stooq online CSV returned no rows for {provider_symbol} in the requested window",
                status="failed",
                reason="no_history",
                metadata={"provider_symbol": provider_symbol, "source_url": url},
            )
        warnings: list[str] = []
        if skipped_rows:
            warnings.append(f"Skipped {skipped_rows} Stooq online rows because required price fields were incomplete.")
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
                "mode": "online_csv",
                "bar_count": len(bars),
                "actions_supported": False,
                "adj_close_proxy": True,
                "provider_symbol": provider_symbol,
                "source_url": url,
                "cache_manifest": str(self._manifest_path()),
            },
        )


StooqPriceProvider = StooqZipPriceProvider

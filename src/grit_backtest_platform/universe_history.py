from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import date, datetime, time as dt_time, timedelta, timezone
from html.parser import HTMLParser
from typing import Any

from .official_index_announcements import (
    OfficialAnnouncementChange,
    OfficialIndexAnnouncement,
    parse_nasdaq_annual_changes_release,
    parse_sp_global_constituent_change_release,
)
from .fmp_constituent_provider import FmpHistoricalConstituentUniverseHistoryProvider


ANCHOR_SCHEDULE = "01-01,07-01"
WIKIPEDIA_API_ENDPOINT = "https://en.wikipedia.org/w/api.php"
WIKIPEDIA_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
}
CURRENT_HTML_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml",
}

SP500_UNIVERSE_KEY = "sp500"
SP500_UNIVERSE_NAME = "标普500"
SP500_UNIVERSE_SNAPSHOT_ID = "un-sp500"
SP500_UNIVERSE_NAME = "标普500"
SP500_SOURCE_PAGE_TITLE = "List of S&P 500 companies"
SP500_UNIVERSE_NAME = "标普500"

NASDAQ100_UNIVERSE_KEY = "nasdaq100"
NASDAQ100_UNIVERSE_NAME = "纳指100"
NASDAQ100_UNIVERSE_SNAPSHOT_ID = "un-ndx100"
NASDAQ100_UNIVERSE_NAME = "纳指100"
NASDAQ100_SOURCE_PAGE_TITLE = "Nasdaq-100"
NASDAQ100_UNIVERSE_NAME = "纳指100"
SP500_CURRENT_FALLBACK_URL = "https://www.slickcharts.com/sp500"
NASDAQ100_CURRENT_FALLBACK_URL = "https://www.slickcharts.com/nasdaq100"

EXPLICIT_TICKER_MAP = {
    "BRK.B": "BRK-B",
    "BRK.B.": "BRK-B",
    "BRK.A": "BRK-A",
    "BF.B": "BF-B",
    "BF.B.": "BF-B",
    "BF.A": "BF-A",
}

STATIC_SP500_RAW_SYMBOLS = [
    "AAPL",
    "MSFT",
    "NVDA",
    "AMZN",
    "META*",
    "GOOGL[1]",
    "GOOG",
    "BRK.B",
    "LLY",
    "JPM",
    "XOM",
    "AVGO",
    "V",
    "BF.B",
]

STATIC_NASDAQ100_RAW_SYMBOLS = [
    "AAPL",
    "MSFT",
    "NVDA",
    "AMZN",
    "META",
    "GOOGL",
    "GOOG",
    "AVGO",
    "COST",
    "AMD",
    "NFLX",
    "ADBE",
    "PEP",
    "CSCO",
]

_SYMBOL_HEADER_ALIASES = {
    "symbol",
    "ticker",
    "ticker symbol",
    "ticker symbol(s)",
    "ticker symbols",
}


@dataclass(frozen=True)
class UniverseDefinition:
    universe_key: str
    display_name: str
    snapshot_id: str
    source_page_title: str
    minimum_member_count: int = 50


@dataclass(frozen=True)
class UniverseMembershipSnapshot:
    universe_key: str
    universe_name: str
    effective_date: date
    normalized_symbols: list[str]
    raw_symbols: list[str]
    unmapped_symbols: list[str]
    source: str
    fallback_source: str | None = None
    anchor_schedule: str = ANCHOR_SCHEDULE
    source_revision_id: str | None = None
    source_page_title: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ExtractedUniverseTable:
    headers: list[str]
    raw_symbols: list[str]
    normalized_symbols: list[str]
    unmapped_symbols: list[str]
    table_index: int


def current_fallback_url_for_definition(definition: UniverseDefinition) -> str | None:
    if definition.universe_key == SP500_UNIVERSE_KEY:
        return SP500_CURRENT_FALLBACK_URL
    if definition.universe_key == NASDAQ100_UNIVERSE_KEY:
        return NASDAQ100_CURRENT_FALLBACK_URL
    return None


class WikipediaTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[str]]] = []
        self._capture_depth = 0
        self._current_table: list[list[str]] = []
        self._current_row: list[str] = []
        self._current_cell_tag: str | None = None
        self._current_cell_text = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = {name: value or "" for name, value in attrs}
        class_name = attributes.get("class", "")
        if tag == "table" and "wikitable" in class_name:
            if self._capture_depth == 0:
                self._current_table = []
            self._capture_depth += 1
            return
        if self._capture_depth == 0:
            return
        if tag == "table":
            self._capture_depth += 1
            return
        if self._capture_depth == 1 and tag == "tr":
            self._current_row = []
            return
        if self._capture_depth == 1 and tag in {"th", "td"}:
            self._current_cell_tag = tag
            self._current_cell_text = ""
            return
        if self._capture_depth == 1 and tag == "br" and self._current_cell_tag:
            self._current_cell_text += " "

    def handle_data(self, data: str) -> None:
        if self._capture_depth and self._current_cell_tag:
            self._current_cell_text += data

    def handle_endtag(self, tag: str) -> None:
        if self._capture_depth == 0:
            return
        if self._capture_depth == 1 and self._current_cell_tag == tag:
            cell_text = " ".join(self._current_cell_text.split())
            self._current_row.append(cell_text)
            self._current_cell_tag = None
            self._current_cell_text = ""
            return
        if self._capture_depth == 1 and tag == "tr":
            if any(cell for cell in self._current_row):
                self._current_table.append(list(self._current_row))
            self._current_row = []
            return
        if tag == "table":
            self._capture_depth -= 1
            if self._capture_depth == 0 and self._current_table:
                self.tables.append(list(self._current_table))
                self._current_table = []


def semiannual_anchor_dates(start_date: date, end_date: date) -> list[date]:
    anchors: list[date] = []
    for year in range(start_date.year, end_date.year + 1):
        for month in (1, 7):
            anchor = date(year, month, 1)
            if start_date <= anchor <= end_date:
                anchors.append(anchor)
    return anchors


def normalize_wikipedia_ticker(raw_value: str) -> str | None:
    cleaned = (raw_value or "").strip().upper()
    cleaned = cleaned.replace("\u00A0", "").replace(" ", "")
    cleaned = re.sub(r"\[[^\]]+\]", "", cleaned)
    cleaned = re.sub(r"[\*?]+$", "", cleaned)
    cleaned = re.sub(r"\(.*?\)$", "", cleaned)
    cleaned = EXPLICIT_TICKER_MAP.get(cleaned, cleaned)
    cleaned = re.sub(r"(?<=\w)[./](?=[A-Z0-9]{1,2}$)", "-", cleaned)
    cleaned = re.sub(r"-(OLD|WI|WS|RT)$", "", cleaned)
    if not cleaned:
        return None
    if not re.fullmatch(r"[A-Z][A-Z0-9-]{0,9}", cleaned):
        return None
    return cleaned


def _normalize_static_members(raw_symbols: list[str]) -> tuple[list[str], list[str]]:
    normalized: list[str] = []
    unmapped: list[str] = []
    seen: set[str] = set()
    for raw_symbol in raw_symbols:
        normalized_symbol = normalize_wikipedia_ticker(raw_symbol)
        if normalized_symbol is None:
            unmapped.append(raw_symbol)
            continue
        if normalized_symbol in seen:
            continue
        seen.add(normalized_symbol)
        normalized.append(normalized_symbol)
    return normalized, unmapped


def _normalize_header(text: str) -> str:
    cleaned = re.sub(r"\[[^\]]+\]", "", text or "")
    cleaned = " ".join(cleaned.replace("\u00A0", " ").split()).strip().lower()
    return re.sub(r"[^a-z0-9]+", " ", cleaned).strip()


def extract_symbols_from_html(
    html: str,
    *,
    minimum_member_count: int,
) -> ExtractedUniverseTable:
    parser = WikipediaTableParser()
    parser.feed(html)
    candidates: list[ExtractedUniverseTable] = []
    for table_index, table_rows in enumerate(parser.tables):
        if len(table_rows) < 2:
            continue
        headers = table_rows[0]
        symbol_column = next(
            (
                index
                for index, header in enumerate(headers)
                if _normalize_header(header) in _SYMBOL_HEADER_ALIASES
                or "symbol" in _normalize_header(header)
                or "ticker" in _normalize_header(header)
            ),
            None,
        )
        if symbol_column is None:
            continue
        raw_symbols = [
            row[symbol_column]
            for row in table_rows[1:]
            if len(row) > symbol_column and row[symbol_column]
        ]
        normalized_symbols, unmapped_symbols = _normalize_static_members(raw_symbols)
        if not normalized_symbols:
            continue
        candidates.append(
            ExtractedUniverseTable(
                headers=list(headers),
                raw_symbols=list(raw_symbols),
                normalized_symbols=list(normalized_symbols),
                unmapped_symbols=list(unmapped_symbols),
                table_index=table_index,
            )
        )
    if not candidates:
        raise ValueError("No wikipedia constituents table with a symbol or ticker column was found.")
    best = max(candidates, key=lambda item: len(item.normalized_symbols))
    if len(best.normalized_symbols) < minimum_member_count:
        raise ValueError(
            f"Wikipedia constituents table looked too small ({len(best.normalized_symbols)} symbols < {minimum_member_count})."
        )
    return best


def extract_symbols_from_slickcharts_html(
    html: str,
    *,
    minimum_member_count: int,
) -> ExtractedUniverseTable:
    row_matches = re.findall(
        r"<tr><td>\d+</td><td[^>]*>.*?</td><td><a href=\"/symbol/([A-Z0-9.\-]+)\">([^<]+)</a></td>",
        html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    raw_symbols = [symbol_text or symbol_href for symbol_href, symbol_text in row_matches]
    normalized_symbols, unmapped_symbols = _normalize_static_members(raw_symbols)
    if len(normalized_symbols) < minimum_member_count:
        raise ValueError(
            f"Slickcharts current constituents looked too small ({len(normalized_symbols)} symbols < {minimum_member_count})."
        )
    return ExtractedUniverseTable(
        headers=["Company", "Symbol", "Weight"],
        raw_symbols=raw_symbols,
        normalized_symbols=normalized_symbols,
        unmapped_symbols=unmapped_symbols,
        table_index=0,
    )


def _snapshot_from_symbol_list(
    *,
    definition: UniverseDefinition,
    anchor: date,
    source: str,
    symbols: list[str],
    raw_symbols: list[str] | None = None,
    source_revision_id: str | None = None,
    source_page_title: str | None = None,
    fallback_source: str | None = None,
    source_quality: str,
    extra_metadata: dict[str, Any] | None = None,
) -> UniverseMembershipSnapshot:
    normalized = []
    unmapped: list[str] = []
    seen: set[str] = set()
    for raw_symbol in raw_symbols or symbols:
        normalized_symbol = normalize_wikipedia_ticker(raw_symbol)
        if normalized_symbol is None:
            unmapped.append(raw_symbol)
            continue
        if normalized_symbol in seen:
            continue
        seen.add(normalized_symbol)
        normalized.append(normalized_symbol)
    return UniverseMembershipSnapshot(
        universe_key=definition.universe_key,
        universe_name=definition.display_name,
        effective_date=anchor,
        normalized_symbols=list(normalized),
        raw_symbols=list(raw_symbols or normalized),
        unmapped_symbols=list(unmapped),
        source=source,
        fallback_source=fallback_source,
        source_revision_id=source_revision_id,
        source_page_title=source_page_title or definition.source_page_title,
        metadata={
            "coverage_mode": "point_in_time_anchor",
            "source_quality": source_quality,
            **dict(extra_metadata or {}),
        },
    )


class StaticUniverseHistoryProvider:
    provider_name = "static_seed"

    def __init__(
        self,
        *,
        definition: UniverseDefinition,
        raw_symbols: list[str],
        source: str = "static_seed",
    ) -> None:
        self.definition = definition
        self.raw_symbols = list(raw_symbols)
        self.source = source

    def load_snapshots(self, start_date: date, end_date: date) -> list[UniverseMembershipSnapshot]:
        normalized, unmapped = _normalize_static_members(self.raw_symbols)
        snapshots: list[UniverseMembershipSnapshot] = []
        for anchor in semiannual_anchor_dates(start_date, end_date):
            snapshots.append(
                UniverseMembershipSnapshot(
                    universe_key=self.definition.universe_key,
                    universe_name=self.definition.display_name,
                    effective_date=anchor,
                    normalized_symbols=list(normalized),
                    raw_symbols=list(self.raw_symbols),
                    unmapped_symbols=list(unmapped),
                    source=self.source,
                    source_page_title=self.definition.source_page_title,
                    source_revision_id=f"{self.source}-{anchor.isoformat()}",
                    metadata={
                        "coverage_mode": "point_in_time_anchor",
                        "source_quality": "static_seed_fallback",
                        "seed_quality": "partial_static_seed",
                        "seed_note": "Historical universe source is still incomplete; static seed used as the last resort.",
                    },
                )
            )
        return snapshots


class WikipediaRevisionUniverseHistoryProvider:
    provider_name = "wikipedia_revision_history"
    current_page_source_name = "wikipedia_current_page"
    secondary_current_source_name = "slickcharts_current_page"

    def __init__(
        self,
        *,
        definition: UniverseDefinition,
        official_provider: Any | None = None,
        fallback_provider: StaticUniverseHistoryProvider | None = None,
        retries: int = 3,
        timeout: int = 20,
    ) -> None:
        self.definition = definition
        self.official_provider = official_provider
        self.fallback_provider = fallback_provider
        self.retries = retries
        self.timeout = timeout
        self._parsed_revision_cache: dict[str, ExtractedUniverseTable] = {}
        self._current_page_cache: ExtractedUniverseTable | None = None

    def load_snapshots(self, start_date: date, end_date: date) -> list[UniverseMembershipSnapshot]:
        snapshots: list[UniverseMembershipSnapshot] = []
        previous_snapshot: UniverseMembershipSnapshot | None = None
        for anchor in semiannual_anchor_dates(start_date, end_date):
            snapshot = self._load_anchor_snapshot(anchor, previous_snapshot=previous_snapshot)
            snapshots.append(snapshot)
            previous_snapshot = snapshot
        return snapshots

    def _load_anchor_snapshot(
        self,
        anchor: date,
        *,
        previous_snapshot: UniverseMembershipSnapshot | None = None,
    ) -> UniverseMembershipSnapshot:
        try:
            return self._load_historical_snapshot(anchor)
        except Exception as historical_error:
            historical_message = str(historical_error)
        if self.official_provider is not None and previous_snapshot is not None:
            official_snapshot = self._load_official_snapshot(anchor, previous_snapshot=previous_snapshot)
            if official_snapshot is not None:
                return official_snapshot
        try:
            return self._load_current_page_snapshot(anchor, historical_message)
        except Exception as current_page_error:
            current_page_message = str(current_page_error)
        try:
            return self._load_secondary_current_page_snapshot(
                anchor,
                historical_message=historical_message,
                current_page_message=current_page_message,
            )
        except Exception as secondary_current_page_error:
            secondary_current_page_message = str(secondary_current_page_error)
        if self.fallback_provider is None:
            raise RuntimeError(
                f"Unable to load wikipedia or fallback universe history for {self.definition.display_name} at {anchor.isoformat()}."
            ) from current_page_error
        return self._load_static_fallback_snapshot(
            anchor,
            historical_message=historical_message,
            current_page_message=(
                f"{current_page_message}; secondary_current_page_error={secondary_current_page_message}"
            ),
        )

    def _load_official_snapshot(
        self,
        anchor: date,
        *,
        previous_snapshot: UniverseMembershipSnapshot,
    ) -> UniverseMembershipSnapshot | None:
        if self.official_provider is None:
            return None
        if str((previous_snapshot.metadata or {}).get("source_quality") or "").lower() != "historical_revision_snapshot":
            return None
        if previous_snapshot.fallback_source:
            return None
        return self.official_provider.load_anchor_snapshot(anchor, previous_snapshot=previous_snapshot)

    def _anchor_revision_timestamp(self, anchor: date) -> str:
        anchor_end = datetime.combine(anchor + timedelta(days=1), dt_time.min, tzinfo=timezone.utc) - timedelta(seconds=1)
        return anchor_end.strftime("%Y-%m-%dT%H:%M:%SZ")

    def _fetch_json(self, **params: str) -> dict[str, Any]:
        query = urllib.parse.urlencode(
            {
                "format": "json",
                "formatversion": "2",
                **params,
            }
        )
        request = urllib.request.Request(f"{WIKIPEDIA_API_ENDPOINT}?{query}", headers=WIKIPEDIA_HEADERS)
        last_error: Exception | None = None
        for attempt in range(self.retries):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                # Keep Wikipedia access deliberately paced to avoid 429 throttling
                # when we walk 30 years of semiannual anchors.
                time.sleep(0.15)
                return payload
            except urllib.error.HTTPError as exc:
                last_error = exc
                if exc.code == 429:
                    retry_after = exc.headers.get("Retry-After") if exc.headers else None
                    delay = min(max(float(retry_after or 0.0), 1.5 * (attempt + 1)), 4.0)
                    time.sleep(delay)
                    continue
                if attempt >= self.retries - 1:
                    break
                time.sleep(0.6 * (attempt + 1))
            except (urllib.error.URLError, TimeoutError, ValueError, KeyError) as exc:
                last_error = exc
                if attempt >= self.retries - 1:
                    break
                time.sleep(0.6 * (attempt + 1))
        raise RuntimeError(f"Wikipedia API request failed for {self.definition.display_name}: {last_error}") from last_error

    def _fetch_html(self, url: str) -> str:
        request = urllib.request.Request(url, headers=CURRENT_HTML_HEADERS)
        last_error: Exception | None = None
        for attempt in range(self.retries):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    html = response.read().decode("utf-8", errors="ignore")
                time.sleep(0.1)
                return html
            except urllib.error.HTTPError as exc:
                last_error = exc
                if exc.code == 429:
                    retry_after = exc.headers.get("Retry-After") if exc.headers else None
                    delay = min(max(float(retry_after or 0.0), 1.5 * (attempt + 1)), 4.0)
                    time.sleep(delay)
                    continue
                if attempt >= self.retries - 1:
                    break
                time.sleep(0.5 * (attempt + 1))
            except (urllib.error.URLError, TimeoutError, ValueError) as exc:
                last_error = exc
                if attempt >= self.retries - 1:
                    break
                time.sleep(0.5 * (attempt + 1))
        raise RuntimeError(f"Current-page fallback request failed for {self.definition.display_name}: {last_error}") from last_error

    def _lookup_revision(self, anchor: date) -> dict[str, Any]:
        payload = self._fetch_json(
            action="query",
            prop="revisions",
            titles=self.definition.source_page_title,
            rvlimit="1",
            rvdir="older",
            rvstart=self._anchor_revision_timestamp(anchor),
            rvprop="ids|timestamp",
        )
        pages = (payload.get("query") or {}).get("pages") or []
        page = pages[0] if pages else {}
        revisions = page.get("revisions") or []
        if not revisions:
            raise RuntimeError(
                f"No wikipedia revision found for {self.definition.display_name} at {anchor.isoformat()}."
            )
        return dict(revisions[0])

    def _parse_revision_table(self, revision_id: str) -> ExtractedUniverseTable:
        cached = self._parsed_revision_cache.get(revision_id)
        if cached is not None:
            return cached
        payload = self._fetch_json(
            action="parse",
            oldid=revision_id,
            prop="text",
        )
        html = (payload.get("parse") or {}).get("text")
        if not isinstance(html, str):
            raise RuntimeError(f"Wikipedia parse response did not include html for oldid={revision_id}.")
        parsed = extract_symbols_from_html(html, minimum_member_count=self.definition.minimum_member_count)
        self._parsed_revision_cache[revision_id] = parsed
        return parsed

    def _parse_current_page_table(self) -> ExtractedUniverseTable:
        if self._current_page_cache is not None:
            return self._current_page_cache
        payload = self._fetch_json(
            action="parse",
            page=self.definition.source_page_title,
            prop="text",
        )
        html = (payload.get("parse") or {}).get("text")
        if not isinstance(html, str):
            raise RuntimeError(f"Wikipedia parse response did not include html for page={self.definition.source_page_title}.")
        self._current_page_cache = extract_symbols_from_html(html, minimum_member_count=self.definition.minimum_member_count)
        return self._current_page_cache

    def _build_snapshot(
        self,
        *,
        anchor: date,
        extracted: ExtractedUniverseTable,
        source: str,
        fallback_source: str | None,
        source_revision_id: str | None,
        source_quality: str,
        extra_metadata: dict[str, Any],
    ) -> UniverseMembershipSnapshot:
        return UniverseMembershipSnapshot(
            universe_key=self.definition.universe_key,
            universe_name=self.definition.display_name,
            effective_date=anchor,
            normalized_symbols=list(extracted.normalized_symbols),
            raw_symbols=list(extracted.raw_symbols),
            unmapped_symbols=list(extracted.unmapped_symbols),
            source=source,
            fallback_source=fallback_source,
            source_revision_id=source_revision_id,
            source_page_title=self.definition.source_page_title,
            metadata={
                "coverage_mode": "point_in_time_anchor",
                "source_quality": source_quality,
                "table_headers": list(extracted.headers),
                "table_index": extracted.table_index,
                "raw_symbol_count": len(extracted.raw_symbols),
                **dict(extra_metadata),
            },
        )

    def _load_historical_snapshot(self, anchor: date) -> UniverseMembershipSnapshot:
        revision = self._lookup_revision(anchor)
        revision_id = str(revision.get("revid") or revision.get("oldid") or "")
        if not revision_id:
            raise RuntimeError(f"Wikipedia revision id missing for {self.definition.display_name} at {anchor.isoformat()}.")
        extracted = self._parse_revision_table(revision_id)
        return self._build_snapshot(
            anchor=anchor,
            extracted=extracted,
            source=self.provider_name,
            fallback_source=None,
            source_revision_id=revision_id,
            source_quality="historical_revision_snapshot",
            extra_metadata={
                "revision_timestamp": revision.get("timestamp"),
                "anchor_mode": "historical_revision",
            },
        )

    def _load_current_page_snapshot(
        self,
        anchor: date,
        historical_message: str,
    ) -> UniverseMembershipSnapshot:
        extracted = self._parse_current_page_table()
        return self._build_snapshot(
            anchor=anchor,
            extracted=extracted,
            source=self.current_page_source_name,
            fallback_source=self.provider_name,
            source_revision_id=None,
            source_quality="current_page_fallback",
            extra_metadata={
                "anchor_mode": "current_page_fallback",
                "historical_revision_error": historical_message,
            },
        )

    def _load_secondary_current_page_snapshot(
        self,
        anchor: date,
        *,
        historical_message: str,
        current_page_message: str,
    ) -> UniverseMembershipSnapshot:
        fallback_url = current_fallback_url_for_definition(self.definition)
        if not fallback_url:
            raise RuntimeError(f"No current-page fallback url configured for {self.definition.display_name}.")
        html = self._fetch_html(fallback_url)
        extracted = extract_symbols_from_slickcharts_html(html, minimum_member_count=self.definition.minimum_member_count)
        return self._build_snapshot(
            anchor=anchor,
            extracted=extracted,
            source=self.secondary_current_source_name,
            fallback_source=self.provider_name,
            source_revision_id=None,
            source_quality="secondary_current_page_fallback",
            extra_metadata={
                "anchor_mode": "secondary_current_page_fallback",
                "historical_revision_error": historical_message,
                "current_page_error": current_page_message,
                "current_fallback_url": fallback_url,
            },
        )

    def _load_static_fallback_snapshot(
        self,
        anchor: date,
        *,
        historical_message: str,
        current_page_message: str,
    ) -> UniverseMembershipSnapshot:
        fallback_snapshot = self.fallback_provider.load_snapshots(anchor, anchor)[0]
        metadata = dict(fallback_snapshot.metadata)
        metadata.update(
            {
                "historical_revision_error": historical_message,
                "current_page_error": current_page_message,
                "source_quality": "static_seed_fallback",
                "anchor_mode": "static_seed_fallback",
            }
        )
        return UniverseMembershipSnapshot(
            universe_key=fallback_snapshot.universe_key,
            universe_name=fallback_snapshot.universe_name,
            effective_date=fallback_snapshot.effective_date,
            normalized_symbols=list(fallback_snapshot.normalized_symbols),
            raw_symbols=list(fallback_snapshot.raw_symbols),
            unmapped_symbols=list(fallback_snapshot.unmapped_symbols),
            source=fallback_snapshot.source,
            fallback_source=self.current_page_source_name,
            source_revision_id=fallback_snapshot.source_revision_id,
            source_page_title=fallback_snapshot.source_page_title,
            metadata=metadata,
        )


class StaticSp500UniverseHistoryProvider(StaticUniverseHistoryProvider):
    def __init__(self, raw_symbols: list[str] | None = None) -> None:
        super().__init__(
            definition=UniverseDefinition(
                universe_key=SP500_UNIVERSE_KEY,
                display_name=SP500_UNIVERSE_NAME,
                snapshot_id=SP500_UNIVERSE_SNAPSHOT_ID,
                source_page_title=SP500_SOURCE_PAGE_TITLE,
                minimum_member_count=400,
            ),
            raw_symbols=list(raw_symbols or STATIC_SP500_RAW_SYMBOLS),
        )


class StaticNasdaq100UniverseHistoryProvider(StaticUniverseHistoryProvider):
    def __init__(self, raw_symbols: list[str] | None = None) -> None:
        super().__init__(
            definition=UniverseDefinition(
                universe_key=NASDAQ100_UNIVERSE_KEY,
                display_name=NASDAQ100_UNIVERSE_NAME,
                snapshot_id=NASDAQ100_UNIVERSE_SNAPSHOT_ID,
                source_page_title=NASDAQ100_SOURCE_PAGE_TITLE,
                minimum_member_count=80,
            ),
            raw_symbols=list(raw_symbols or STATIC_NASDAQ100_RAW_SYMBOLS),
        )


class OfficialAnnouncementUniverseHistoryProvider:
    provider_name = "official_announcement_history"
    source_kind = "official_announcement"
    archive_page_urls: list[str] = []
    archive_page_limit = 6
    relevant_index_names: tuple[str, ...] = ()

    def __init__(
        self,
        *,
        definition: UniverseDefinition,
        retries: int = 3,
        timeout: int = 20,
    ) -> None:
        self.definition = definition
        self.retries = retries
        self.timeout = timeout
        self._html_cache: dict[str, str] = {}
        self._announcement_cache: dict[str, OfficialIndexAnnouncement | None] = {}

    def _fetch_html(self, url: str) -> str:
        cached = self._html_cache.get(url)
        if cached is not None:
            return cached
        request = urllib.request.Request(url, headers=CURRENT_HTML_HEADERS)
        last_error: Exception | None = None
        for attempt in range(self.retries):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    html = response.read().decode("utf-8", errors="ignore")
                time.sleep(0.1)
                self._html_cache[url] = html
                return html
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError) as exc:
                last_error = exc
                if attempt >= self.retries - 1:
                    break
                time.sleep(0.5 * (attempt + 1))
        raise RuntimeError(f"Official announcement request failed for {url}: {last_error}") from last_error

    def _announcement_is_relevant(self, announcement: OfficialIndexAnnouncement) -> bool:
        if not self.relevant_index_names:
            return True
        relevant_names = {name.lower() for name in self.relevant_index_names}
        for change in announcement.changes:
            index_name = str(change.index_name or "").lower()
            if any(name in index_name for name in relevant_names):
                return True
        return False

    def _announcement_applies_to_previous_snapshot(
        self,
        announcement: OfficialIndexAnnouncement,
        previous_snapshot: UniverseMembershipSnapshot,
        anchor: date,
    ) -> bool:
        effective_date = announcement.effective_date
        if effective_date is None:
            return False
        if effective_date > anchor:
            return False
        if effective_date <= previous_snapshot.effective_date:
            return False
        return True

    def _apply_changes(
        self,
        *,
        anchor: date,
        previous_snapshot: UniverseMembershipSnapshot,
        announcement: OfficialIndexAnnouncement,
    ) -> UniverseMembershipSnapshot | None:
        if not self._announcement_is_relevant(announcement):
            return None
        normalized_symbols = list(previous_snapshot.normalized_symbols)
        seen = set(normalized_symbols)
        applied_change_count = 0
        additions: list[str] = []
        removals: list[str] = []
        for change in announcement.changes:
            if not self._change_applies_to_definition(change):
                continue
            normalized_symbol = normalize_wikipedia_ticker(change.symbol)
            if normalized_symbol is None:
                continue
            action = str(change.action or "").lower()
            if action == "addition":
                if normalized_symbol not in seen:
                    seen.add(normalized_symbol)
                    normalized_symbols.append(normalized_symbol)
                additions.append(normalized_symbol)
                applied_change_count += 1
            elif action == "deletion":
                if normalized_symbol in seen:
                    seen.remove(normalized_symbol)
                    normalized_symbols = [symbol for symbol in normalized_symbols if symbol != normalized_symbol]
                removals.append(normalized_symbol)
                applied_change_count += 1
        if not applied_change_count:
            return None
        return _snapshot_from_symbol_list(
            definition=self.definition,
            anchor=anchor,
            source=self.provider_name,
            source_revision_id=announcement.source_url,
            source_page_title=announcement.headline,
            symbols=list(normalized_symbols),
            raw_symbols=list(normalized_symbols),
            fallback_source=None,
            source_quality="historical_revision_snapshot",
            extra_metadata={
                "anchor_mode": "official_announcement",
                "official_source_kind": announcement.source_kind,
                "official_source_name": announcement.source_name,
                "official_source_url": announcement.source_url,
                "official_headline": announcement.headline,
                "official_published_date": announcement.published_date.isoformat() if announcement.published_date else None,
                "official_effective_date": announcement.effective_date.isoformat() if announcement.effective_date else None,
                "official_applied_from_anchor": previous_snapshot.effective_date.isoformat(),
                "official_change_count": applied_change_count,
                "official_additions": list(additions),
                "official_removals": list(removals),
                "official_previous_source_quality": (previous_snapshot.metadata or {}).get("source_quality"),
                "source_origin": "official_announcement",
            },
        )

    def load_anchor_snapshot(
        self,
        anchor: date,
        *,
        previous_snapshot: UniverseMembershipSnapshot,
    ) -> UniverseMembershipSnapshot | None:
        announcement = self._load_announcement(anchor, previous_snapshot=previous_snapshot)
        if announcement is None:
            return None
        if not self._announcement_applies_to_previous_snapshot(announcement, previous_snapshot, anchor):
            return None
        return self._apply_changes(anchor=anchor, previous_snapshot=previous_snapshot, announcement=announcement)

    def _change_applies_to_definition(self, change: OfficialAnnouncementChange) -> bool:
        raise NotImplementedError

    def _load_announcement(
        self,
        anchor: date,
        *,
        previous_snapshot: UniverseMembershipSnapshot,
    ) -> OfficialIndexAnnouncement | None:
        raise NotImplementedError


class NasdaqAnnouncementUniverseProvider(OfficialAnnouncementUniverseHistoryProvider):
    provider_name = "nasdaq_official_annual_changes"
    source_kind = "nasdaq_annual_changes"
    archive_page_urls = [
        "https://ir.nasdaq.com/news-and-events/press-releases",
    ]
    relevant_index_names = ("nasdaq-100",)

    def _change_applies_to_definition(self, change: OfficialAnnouncementChange) -> bool:
        index_name = str(change.index_name or "").lower()
        return "nasdaq-100" in index_name

    def _load_announcement(
        self,
        anchor: date,
        *,
        previous_snapshot: UniverseMembershipSnapshot,
    ) -> OfficialIndexAnnouncement | None:
        for archive_url in self.archive_page_urls:
            for page_index in range(self.archive_page_limit):
                page_url = archive_url if page_index == 0 else f"{archive_url}?page={page_index}"
                html = self._fetch_html(page_url)
                release_urls = re.findall(
                    r'href="(https://ir\.nasdaq\.com/news-releases/news-release-details/[^"]+)"',
                    html,
                )
                if not release_urls:
                    continue
                for release_url in release_urls:
                    cache_key = release_url
                    cached = self._announcement_cache.get(cache_key)
                    if cached is not None:
                        announcement = cached
                    else:
                        release_html = self._fetch_html(release_url)
                        announcement = parse_nasdaq_annual_changes_release(release_html, source_url=release_url)
                        self._announcement_cache[cache_key] = announcement
                    if announcement is None:
                        continue
                    if not self._announcement_applies_to_previous_snapshot(announcement, previous_snapshot, anchor):
                        continue
                    if self._announcement_is_relevant(announcement):
                        return announcement
        return None


class SpGlobalAnnouncementUniverseProvider(OfficialAnnouncementUniverseHistoryProvider):
    provider_name = "sp_global_official_constituent_change"
    source_kind = "sp_global_constituent_change"
    archive_page_urls = [
        "https://press.spglobal.com/index.php?l=50&o=0&s=2429",
    ]
    relevant_index_names = ("s&p 500",)

    def _change_applies_to_definition(self, change: OfficialAnnouncementChange) -> bool:
        index_name = str(change.index_name or "").lower()
        return "s&p 500" in index_name

    def _load_announcement(
        self,
        anchor: date,
        *,
        previous_snapshot: UniverseMembershipSnapshot,
    ) -> OfficialIndexAnnouncement | None:
        for archive_url in self.archive_page_urls:
            for page_index in range(self.archive_page_limit):
                if page_index == 0:
                    page_url = archive_url
                else:
                    page_url = re.sub(r"([?&])o=\d+", rf"\g<1>o={page_index * 50}", archive_url)
                    if page_url == archive_url:
                        separator = "&" if "?" in archive_url else "?"
                        page_url = f"{archive_url}{separator}o={page_index * 50}"
                html = self._fetch_html(page_url)
                release_candidates = re.findall(
                    r'<div class="wd_title"><a href="(https://press\.spglobal\.com/[^"]+)">([^<]+)</a>',
                    html,
                )
                if not release_candidates:
                    release_candidates = re.findall(
                        r'<a href="(https://press\.spglobal\.com/[^"]+)">([^<]+)</a>',
                        html,
                    )
                for release_url, title in release_candidates:
                    title_lc = title.lower()
                    if "s&p 500" not in title_lc and "join s&p 500" not in title_lc:
                        continue
                    cache_key = release_url
                    cached = self._announcement_cache.get(cache_key)
                    if cached is not None:
                        announcement = cached
                    else:
                        release_html = self._fetch_html(release_url)
                        announcement = parse_sp_global_constituent_change_release(
                            release_html,
                            source_url=release_url,
                        )
                        self._announcement_cache[cache_key] = announcement
                    if announcement is None:
                        continue
                    if not self._announcement_applies_to_previous_snapshot(announcement, previous_snapshot, anchor):
                        continue
                    if self._announcement_is_relevant(announcement):
                        return announcement
        return None


def static_universe_history_providers() -> list[StaticUniverseHistoryProvider]:
    return [
        StaticSp500UniverseHistoryProvider(),
        StaticNasdaq100UniverseHistoryProvider(),
    ]


def default_universe_history_providers() -> list[Any]:
    sp500_definition = UniverseDefinition(
        universe_key=SP500_UNIVERSE_KEY,
        display_name=SP500_UNIVERSE_NAME,
        snapshot_id=SP500_UNIVERSE_SNAPSHOT_ID,
        source_page_title=SP500_SOURCE_PAGE_TITLE,
        minimum_member_count=400,
    )
    nasdaq100_definition = UniverseDefinition(
        universe_key=NASDAQ100_UNIVERSE_KEY,
        display_name=NASDAQ100_UNIVERSE_NAME,
        snapshot_id=NASDAQ100_UNIVERSE_SNAPSHOT_ID,
        source_page_title=NASDAQ100_SOURCE_PAGE_TITLE,
        minimum_member_count=80,
    )
    sp500_wikipedia_provider = WikipediaRevisionUniverseHistoryProvider(
        definition=sp500_definition,
        official_provider=SpGlobalAnnouncementUniverseProvider(
            definition=sp500_definition,
        ),
        fallback_provider=StaticSp500UniverseHistoryProvider(),
    )
    nasdaq100_wikipedia_provider = WikipediaRevisionUniverseHistoryProvider(
        definition=nasdaq100_definition,
        official_provider=NasdaqAnnouncementUniverseProvider(
            definition=nasdaq100_definition,
        ),
        fallback_provider=StaticNasdaq100UniverseHistoryProvider(),
    )
    return [
        FmpHistoricalConstituentUniverseHistoryProvider(
            definition=sp500_definition,
            fallback_provider=sp500_wikipedia_provider,
        ),
        FmpHistoricalConstituentUniverseHistoryProvider(
            definition=nasdaq100_definition,
            fallback_provider=nasdaq100_wikipedia_provider,
        ),
    ]


def collect_snapshot_symbols(snapshots: list[UniverseMembershipSnapshot]) -> list[str]:
    ordered: list[str] = []
    seen: set[str] = set()
    for snapshot in snapshots:
        for symbol in snapshot.normalized_symbols:
            if symbol in seen:
                continue
            seen.add(symbol)
            ordered.append(symbol)
    return ordered

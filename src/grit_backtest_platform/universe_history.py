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


ANCHOR_SCHEDULE = "01-01,07-01"
WIKIPEDIA_API_ENDPOINT = "https://en.wikipedia.org/w/api.php"
WIKIPEDIA_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
}

SP500_UNIVERSE_KEY = "sp500"
SP500_UNIVERSE_NAME = "标普500"
SP500_UNIVERSE_SNAPSHOT_ID = "un-sp500"
SP500_SOURCE_PAGE_TITLE = "List of S&P 500 companies"

NASDAQ100_UNIVERSE_KEY = "nasdaq100"
NASDAQ100_UNIVERSE_NAME = "纳指100"
NASDAQ100_UNIVERSE_SNAPSHOT_ID = "un-ndx100"
NASDAQ100_SOURCE_PAGE_TITLE = "NASDAQ-100"

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

    def __init__(
        self,
        *,
        definition: UniverseDefinition,
        fallback_provider: StaticUniverseHistoryProvider | None = None,
        retries: int = 3,
        timeout: int = 20,
    ) -> None:
        self.definition = definition
        self.fallback_provider = fallback_provider
        self.retries = retries
        self.timeout = timeout
        self._parsed_revision_cache: dict[str, ExtractedUniverseTable] = {}
        self._current_page_cache: ExtractedUniverseTable | None = None

    def load_snapshots(self, start_date: date, end_date: date) -> list[UniverseMembershipSnapshot]:
        snapshots: list[UniverseMembershipSnapshot] = []
        for anchor in semiannual_anchor_dates(start_date, end_date):
            try:
                snapshots.append(self._load_historical_snapshot(anchor))
                continue
            except Exception as historical_error:
                historical_message = str(historical_error)
            try:
                snapshots.append(self._load_current_page_snapshot(anchor, historical_message))
                continue
            except Exception as current_page_error:
                current_page_message = str(current_page_error)
            if self.fallback_provider is None:
                raise RuntimeError(
                    f"Unable to load wikipedia or fallback universe history for {self.definition.display_name} at {anchor.isoformat()}."
                ) from current_page_error
            snapshots.append(
                self._load_static_fallback_snapshot(
                    anchor,
                    historical_message=historical_message,
                    current_page_message=current_page_message,
                )
            )
        return snapshots

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
                    return json.loads(response.read().decode("utf-8"))
            except (urllib.error.URLError, TimeoutError, ValueError, KeyError) as exc:
                last_error = exc
                if attempt >= self.retries - 1:
                    break
                time.sleep(0.6 * (attempt + 1))
        raise RuntimeError(f"Wikipedia API request failed for {self.definition.display_name}: {last_error}") from last_error

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


def static_universe_history_providers() -> list[StaticUniverseHistoryProvider]:
    return [
        StaticSp500UniverseHistoryProvider(),
        StaticNasdaq100UniverseHistoryProvider(),
    ]


def default_universe_history_providers() -> list[Any]:
    return [
        WikipediaRevisionUniverseHistoryProvider(
            definition=UniverseDefinition(
                universe_key=SP500_UNIVERSE_KEY,
                display_name=SP500_UNIVERSE_NAME,
                snapshot_id=SP500_UNIVERSE_SNAPSHOT_ID,
                source_page_title=SP500_SOURCE_PAGE_TITLE,
                minimum_member_count=400,
            ),
            fallback_provider=StaticSp500UniverseHistoryProvider(),
        ),
        WikipediaRevisionUniverseHistoryProvider(
            definition=UniverseDefinition(
                universe_key=NASDAQ100_UNIVERSE_KEY,
                display_name=NASDAQ100_UNIVERSE_NAME,
                snapshot_id=NASDAQ100_UNIVERSE_SNAPSHOT_ID,
                source_page_title=NASDAQ100_SOURCE_PAGE_TITLE,
                minimum_member_count=80,
            ),
            fallback_provider=StaticNasdaq100UniverseHistoryProvider(),
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

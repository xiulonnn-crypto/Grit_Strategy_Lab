from __future__ import annotations

import csv
import json
import io
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field, replace
from datetime import date, datetime, time as dt_time, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Mapping, Sequence

from .official_index_announcements import (
    OfficialAnnouncementChange,
    OfficialIndexAnnouncement,
    parse_nasdaq_annual_changes_release,
    parse_sp_global_constituent_change_release,
)
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
INTERNET_ARCHIVE_CDX_ENDPOINT = "https://web.archive.org/cdx/search/cdx"
INTERNET_ARCHIVE_ARCHIVED_PAGE_TEMPLATE = "https://web.archive.org/web/{timestamp}id_/{original_url}"

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

SOURCE_QUALITY_HISTORICAL_DATASET = "historical_dataset"
SOURCE_QUALITY_WIKIPEDIA_REVISION = "wikipedia_revision"
SOURCE_QUALITY_OFFICIAL_ANNOUNCEMENT = "official_announcement"
SOURCE_QUALITY_CURRENT_PAGE_FALLBACK = "current_page_fallback"
SOURCE_QUALITY_STATIC_FALLBACK = "static_fallback"

SOURCE_QUALITY_HISTORICAL_EQUIVALENTS = {
    SOURCE_QUALITY_HISTORICAL_DATASET,
    SOURCE_QUALITY_WIKIPEDIA_REVISION,
    SOURCE_QUALITY_OFFICIAL_ANNOUNCEMENT,
    "historical_revision_snapshot",
    "historical_constituent_api",
}

SP500_GITHUB_CURRENT_CONSTITUENTS_URL = (
    "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv"
)
NASDAQ100_CURATED_DATASET_URL_TEMPLATE = (
    "https://raw.githubusercontent.com/jmccarrell/n100tickers/main/src/"
    "nasdaq_100_ticker_history/n100-ticker-changes-{year}.yaml"
)
NASDAQ100_CURATED_DATASET_FIRST_YEAR = 2015
NASDAQ100_ARCHIVED_CANDIDATE_URLS = (
    "https://en.wikipedia.org/wiki/Nasdaq-100",
    "https://en.wikipedia.org/wiki/NASDAQ-100",
)
NASDAQ100_OFFICIAL_ACTIVITY_CANDIDATE_URLS = (
    "http://dynamic.nasdaq.com/dynamic/nasdaq100_activity.stm",
)
LOCAL_NASDAQ100_HISTORICAL_SEED_PATH = (
    Path(__file__).resolve().parent / "data" / "nasdaq100_historical_seed.json"
)


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
    symbol_metadata: dict[str, dict[str, Any]] = field(default_factory=dict)


@dataclass(frozen=True)
class ExtractedUniverseTable:
    headers: list[str]
    raw_symbols: list[str]
    normalized_symbols: list[str]
    unmapped_symbols: list[str]
    table_index: int
    symbol_metadata: dict[str, dict[str, Any]] = field(default_factory=dict)


@dataclass(frozen=True)
class Sp500ConstituentChangeEvent:
    effective_date: date
    additions: list[str]
    removals: list[str]
    source_row: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Nasdaq100ConstituentChangeEvent:
    effective_date: date
    additions: list[str]
    removals: list[str]
    source_row: list[str] = field(default_factory=list)


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


def next_semiannual_anchor(anchor: date) -> date:
    if anchor.month < 7:
        return date(anchor.year, 7, 1)
    return date(anchor.year + 1, 1, 1)


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


def _is_historical_anchor_quality(value: Any) -> bool:
    quality = str(value or "").strip().lower()
    return quality in SOURCE_QUALITY_HISTORICAL_EQUIVALENTS


def _normalize_header(text: str) -> str:
    cleaned = re.sub(r"\[[^\]]+\]", "", text or "")
    cleaned = " ".join(cleaned.replace("\u00A0", " ").split()).strip().lower()
    return re.sub(r"[^a-z0-9]+", " ", cleaned).strip()


def _clean_metadata_value(value: Any) -> str:
    return " ".join(str(value or "").replace("\u00A0", " ").split()).strip()


def _table_row_symbol_metadata(headers: Sequence[str], row: Sequence[str]) -> dict[str, Any]:
    metadata: dict[str, Any] = {}
    for index, header in enumerate(headers):
        if index >= len(row):
            continue
        value = _clean_metadata_value(row[index])
        if not value:
            continue
        normalized_header = _normalize_header(header)
        if normalized_header in {"security", "company", "company name", "constituent", "name"}:
            metadata["security_name"] = value
        elif normalized_header in {"gics sector", "sector"}:
            metadata["gics_sector"] = value
            metadata["sector"] = value
        elif normalized_header in {"gics sub industry", "sub industry", "gics subindustry"}:
            metadata["gics_sub_industry"] = value
            metadata["industry_name"] = value
        elif normalized_header in {"gics industry", "industry"}:
            metadata["gics_industry"] = value
            metadata["industry_name"] = value
        elif normalized_header in {"date first added", "date added"}:
            metadata["date_first_added"] = value
    if any(key in metadata for key in ("gics_sector", "sector", "gics_sub_industry", "gics_industry", "industry_name")):
        metadata.setdefault("industry_taxonomy", "GICS")
    return metadata


def _has_industry_metadata(metadata: Mapping[str, Any]) -> bool:
    industry_keys = (
        "gics_sector",
        "sector",
        "GICS Sector",
        "gics_industry",
        "gics_sub_industry",
        "industry",
        "industry_name",
    )
    return any(_clean_metadata_value(metadata.get(key)) for key in industry_keys)


def _enrich_symbol_metadata(
    symbol_metadata: Mapping[str, Mapping[str, Any]] | None,
    *,
    source: str,
    source_revision_id: str | None,
    anchor: date,
) -> dict[str, dict[str, Any]]:
    enriched: dict[str, dict[str, Any]] = {}
    for raw_symbol, raw_metadata in (symbol_metadata or {}).items():
        symbol = normalize_wikipedia_ticker(str(raw_symbol))
        if not symbol or not isinstance(raw_metadata, Mapping):
            continue
        metadata = {str(key): value for key, value in raw_metadata.items() if _clean_metadata_value(value)}
        if not metadata:
            continue
        if _has_industry_metadata(metadata):
            metadata.setdefault("industry_taxonomy", "GICS")
            metadata.setdefault("industry_classification_source", source)
            metadata.setdefault("industry_classification_effective_date", anchor.isoformat())
            if source_revision_id:
                metadata.setdefault("industry_classification_source_revision_id", source_revision_id)
        enriched[symbol] = metadata
    return enriched


def _strip_html_tags(value: str) -> str:
    without_tags = re.sub(r"<[^>]+>", " ", value or "")
    return " ".join(without_tags.replace("\u00A0", " ").split()).strip()


def _extract_symbols_from_legacy_list_sections(
    html: str,
    *,
    minimum_member_count: int,
) -> ExtractedUniverseTable | None:
    section_patterns = [
        r'<h2[^>]*id="Components"[^>]*>.*?</h2>(?P<body>.*?)(?=<div class="mw-heading mw-heading2"|<h2[^>]*id=|$)',
        r'<h2[^>]*id="NASDAQ-100"[^>]*>.*?</h2>(?P<body>.*?)(?=<div class="mw-heading mw-heading2"|<h2[^>]*id=|$)',
    ]
    best_symbols: list[str] = []
    best_raw_symbols: list[str] = []
    best_unmapped: list[str] = []
    for pattern in section_patterns:
        match = re.search(pattern, html or "", flags=re.IGNORECASE | re.DOTALL)
        if not match:
            continue
        body = match.group("body") or ""
        raw_symbols: list[str] = []
        for item_html in re.findall(r"<li\b[^>]*>(.*?)</li>", body, flags=re.IGNORECASE | re.DOTALL):
            text = _strip_html_tags(item_html)
            for ticker_match in re.finditer(r"\(\s*([A-Z][A-Z0-9.\-]{0,9})\s*\)", text):
                raw_symbols.append(ticker_match.group(1))
        normalized_symbols, unmapped_symbols = _normalize_static_members(raw_symbols)
        if len(normalized_symbols) > len(best_symbols):
            best_symbols = list(normalized_symbols)
            best_raw_symbols = list(raw_symbols)
            best_unmapped = list(unmapped_symbols)
    if len(best_symbols) < minimum_member_count:
        return None
    return ExtractedUniverseTable(
        headers=["Company", "Symbol"],
        raw_symbols=list(best_raw_symbols),
        normalized_symbols=list(best_symbols),
        unmapped_symbols=list(best_unmapped),
        table_index=-1,
    )


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
        raw_symbols: list[str] = []
        symbol_metadata: dict[str, dict[str, Any]] = {}
        for row in table_rows[1:]:
            if len(row) <= symbol_column or not row[symbol_column]:
                continue
            raw_symbol = row[symbol_column]
            raw_symbols.append(raw_symbol)
            normalized_symbol = normalize_wikipedia_ticker(raw_symbol)
            if not normalized_symbol:
                continue
            metadata = _table_row_symbol_metadata(headers, row)
            if metadata:
                symbol_metadata[normalized_symbol] = metadata
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
                symbol_metadata=symbol_metadata,
            )
        )
    if not candidates:
        legacy_section = _extract_symbols_from_legacy_list_sections(
            html,
            minimum_member_count=minimum_member_count,
        )
        if legacy_section is None:
            raise ValueError("No wikipedia constituents table with a symbol or ticker column was found.")
        return legacy_section
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


def extract_symbols_from_nasdaq_activity_html(
    html: str,
    *,
    minimum_member_count: int,
) -> ExtractedUniverseTable:
    row_matches = re.findall(
        r"symbol=([A-Z0-9.\-]+)[^>]*>\s*([A-Z0-9.\-]+)\s*</a>",
        html or "",
        flags=re.IGNORECASE,
    )
    raw_symbols: list[str] = []
    for symbol_href, symbol_text in row_matches:
        href_symbol = normalize_wikipedia_ticker(symbol_href)
        text_symbol = normalize_wikipedia_ticker(symbol_text)
        if href_symbol and text_symbol and href_symbol == text_symbol:
            raw_symbols.append(href_symbol)
    normalized_symbols, unmapped_symbols = _normalize_static_members(raw_symbols)
    if len(normalized_symbols) < minimum_member_count:
        raise ValueError(
            f"Archived Nasdaq activity page looked too small ({len(normalized_symbols)} symbols < {minimum_member_count})."
        )
    return ExtractedUniverseTable(
        headers=["Company Name", "Symbol", "% Of Index"],
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
    symbol_metadata: Mapping[str, Mapping[str, Any]] | None = None,
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
        symbol_metadata=_enrich_symbol_metadata(
            symbol_metadata,
            source=source,
            source_revision_id=source_revision_id,
            anchor=anchor,
        ),
    )


class SequentialUniverseSnapshotEnricher:
    def __init__(self, *providers: Any) -> None:
        self.providers = [provider for provider in providers if provider is not None]

    def enrich_snapshots(
        self,
        snapshots: Sequence[UniverseMembershipSnapshot],
    ) -> list[UniverseMembershipSnapshot]:
        updated_snapshots = list(snapshots)
        for provider in self.providers:
            enrich = getattr(provider, "enrich_snapshots", None)
            if not callable(enrich):
                continue
            updated_snapshots = list(enrich(updated_snapshots))
        return updated_snapshots


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
                        "source_quality": SOURCE_QUALITY_STATIC_FALLBACK,
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
        historical_dataset_provider: Any | None = None,
        current_validation_provider: Any | None = None,
        fallback_provider: StaticUniverseHistoryProvider | None = None,
        retries: int = 3,
        timeout: int = 20,
    ) -> None:
        self.definition = definition
        self.official_provider = official_provider
        self.historical_dataset_provider = historical_dataset_provider
        self.current_validation_provider = current_validation_provider
        self.fallback_provider = fallback_provider
        self.retries = retries
        self.timeout = timeout
        self._parsed_revision_cache: dict[str, ExtractedUniverseTable] = {}
        self._current_page_cache: ExtractedUniverseTable | None = None

    def load_snapshots(self, start_date: date, end_date: date) -> list[UniverseMembershipSnapshot]:
        requested_anchors = semiannual_anchor_dates(start_date, end_date)
        if not requested_anchors:
            return []
        load_end = end_date
        if self.historical_dataset_provider is not None:
            load_end = max(load_end, next_semiannual_anchor(requested_anchors[-1]))
        snapshots: list[UniverseMembershipSnapshot] = []
        previous_snapshot: UniverseMembershipSnapshot | None = None
        for anchor in semiannual_anchor_dates(start_date, load_end):
            snapshot = self._load_anchor_snapshot(anchor, previous_snapshot=previous_snapshot)
            snapshots.append(snapshot)
            previous_snapshot = snapshot
        if self.historical_dataset_provider is not None:
            snapshots = self.historical_dataset_provider.enrich_snapshots(snapshots)
        requested_anchor_set = set(requested_anchors)
        return [snapshot for snapshot in snapshots if snapshot.effective_date in requested_anchor_set]

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
        if self.current_validation_provider is not None:
            try:
                return self.current_validation_provider.load_anchor_snapshot(
                    anchor,
                    historical_message=historical_message,
                    current_page_message=current_page_message,
                )
            except Exception as current_validation_error:
                current_validation_message = str(current_validation_error)
        else:
            current_validation_message = ""
        try:
            return self._load_secondary_current_page_snapshot(
                anchor,
                historical_message=historical_message,
                current_page_message=(
                    f"{current_page_message}; current_validation_error={current_validation_message}"
                    if current_validation_message
                    else current_page_message
                ),
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
        if not _is_historical_anchor_quality((previous_snapshot.metadata or {}).get("source_quality")):
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
            symbol_metadata=_enrich_symbol_metadata(
                extracted.symbol_metadata,
                source=source,
                source_revision_id=source_revision_id,
                anchor=anchor,
            ),
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
            source_quality=SOURCE_QUALITY_WIKIPEDIA_REVISION,
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
        validation_metadata: dict[str, Any] = {}
        validator = getattr(self.current_validation_provider, "validate_current_symbols", None)
        if callable(validator):
            warnings = [str(item) for item in (validator(extracted.normalized_symbols) or []) if str(item).strip()]
            if warnings:
                validation_metadata["current_validation_warnings"] = warnings
            validation_metadata["current_validation_source"] = str(
                getattr(self.current_validation_provider, "provider_name", "current_validation")
            )
        return self._build_snapshot(
            anchor=anchor,
            extracted=extracted,
            source=self.current_page_source_name,
            fallback_source=self.provider_name,
            source_revision_id=None,
            source_quality=SOURCE_QUALITY_CURRENT_PAGE_FALLBACK,
            extra_metadata={
                "anchor_mode": "current_page_fallback",
                "historical_revision_error": historical_message,
                **validation_metadata,
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
            source_quality=SOURCE_QUALITY_CURRENT_PAGE_FALLBACK,
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
                "source_quality": SOURCE_QUALITY_STATIC_FALLBACK,
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
            symbol_metadata=dict(fallback_snapshot.symbol_metadata),
        )


class GithubSp500CurrentValidationProvider:
    provider_name = "github_sp500_current_dataset"

    def __init__(
        self,
        *,
        definition: UniverseDefinition,
        dataset_url: str = SP500_GITHUB_CURRENT_CONSTITUENTS_URL,
        retries: int = 3,
        timeout: int = 20,
    ) -> None:
        self.definition = definition
        self.dataset_url = dataset_url
        self.retries = retries
        self.timeout = timeout
        self._symbol_cache: list[str] | None = None
        self._row_cache: list[dict[str, str]] | None = None

    def _fetch_text(self) -> str:
        request = urllib.request.Request(self.dataset_url, headers=CURRENT_HTML_HEADERS)
        last_error: Exception | None = None
        for attempt in range(self.retries):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    return response.read().decode("utf-8", errors="ignore")
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError) as exc:
                last_error = exc
                if attempt >= self.retries - 1:
                    break
                time.sleep(0.4 * (attempt + 1))
        raise RuntimeError(f"GitHub S&P 500 current constituents request failed: {last_error}") from last_error

    def _load_rows(self) -> list[dict[str, str]]:
        if self._row_cache is not None:
            return [dict(row) for row in self._row_cache]
        text = self._fetch_text()
        reader = csv.DictReader(io.StringIO(text))
        rows = [{str(key): str(value or "") for key, value in row.items()} for row in reader]
        self._row_cache = [dict(row) for row in rows]
        return rows

    def _load_symbols(self) -> list[str]:
        if self._symbol_cache is not None:
            return list(self._symbol_cache)
        raw_symbols = [
            str(row.get("Symbol") or row.get("Ticker") or "").strip()
            for row in self._load_rows()
            if str(row.get("Symbol") or row.get("Ticker") or "").strip()
        ]
        normalized, _ = _normalize_static_members(raw_symbols)
        if len(normalized) < self.definition.minimum_member_count:
            raise RuntimeError(
                f"GitHub S&P 500 current constituents looked too small ({len(normalized)} symbols < {self.definition.minimum_member_count})."
            )
        self._symbol_cache = list(normalized)
        return list(self._symbol_cache)

    def _load_symbol_metadata(self) -> dict[str, dict[str, Any]]:
        symbol_metadata: dict[str, dict[str, Any]] = {}
        for row in self._load_rows():
            symbol = normalize_wikipedia_ticker(str(row.get("Symbol") or row.get("Ticker") or ""))
            if not symbol:
                continue
            headers = list(row.keys())
            metadata = _table_row_symbol_metadata(headers, [row.get(header, "") for header in headers])
            if metadata:
                symbol_metadata[symbol] = metadata
        return symbol_metadata

    def validate_current_symbols(self, symbols: list[str]) -> list[str]:
        dataset_symbols = set(self._load_symbols())
        current_symbols = {normalize_wikipedia_ticker(symbol) for symbol in symbols}
        current_symbols.discard(None)
        mismatch_count = len(dataset_symbols.symmetric_difference(set(current_symbols)))
        if mismatch_count == 0:
            return []
        return [f"GitHub current constituents mismatch detected ({mismatch_count} symbols)."]

    def load_anchor_snapshot(
        self,
        anchor: date,
        *,
        historical_message: str,
        current_page_message: str,
    ) -> UniverseMembershipSnapshot:
        symbols = self._load_symbols()
        return _snapshot_from_symbol_list(
            definition=self.definition,
            anchor=anchor,
            source=self.provider_name,
            source_revision_id=f"{self.provider_name}-{anchor.isoformat()}",
            source_page_title=self.definition.source_page_title,
            symbols=list(symbols),
            fallback_source=WikipediaRevisionUniverseHistoryProvider.provider_name,
            source_quality=SOURCE_QUALITY_CURRENT_PAGE_FALLBACK,
            extra_metadata={
                "anchor_mode": "github_current_dataset_fallback",
                "historical_revision_error": historical_message,
                "current_page_error": current_page_message,
                "current_validation_source": self.provider_name,
                "current_dataset_url": self.dataset_url,
            },
            symbol_metadata=self._load_symbol_metadata(),
        )


class CurrentIndustryMetadataUniverseEnricher:
    provider_name = "current_industry_metadata_enricher"

    def __init__(self, *, metadata_provider: Any) -> None:
        self.metadata_provider = metadata_provider

    def _load_metadata(self) -> dict[str, dict[str, Any]]:
        load_symbol_metadata = getattr(self.metadata_provider, "_load_symbol_metadata", None)
        if not callable(load_symbol_metadata):
            return {}
        raw_metadata = load_symbol_metadata()
        if not isinstance(raw_metadata, Mapping):
            return {}
        normalized_metadata: dict[str, dict[str, Any]] = {}
        for raw_symbol, metadata in raw_metadata.items():
            symbol = normalize_wikipedia_ticker(str(raw_symbol))
            if symbol and isinstance(metadata, Mapping):
                normalized_metadata[symbol] = dict(metadata)
        return normalized_metadata

    def enrich_snapshots(
        self,
        snapshots: Sequence[UniverseMembershipSnapshot],
    ) -> list[UniverseMembershipSnapshot]:
        current_metadata = self._load_metadata()
        if not current_metadata:
            return list(snapshots)
        enriched_snapshots: list[UniverseMembershipSnapshot] = []
        metadata_source = str(getattr(self.metadata_provider, "provider_name", self.provider_name))
        for snapshot in snapshots:
            snapshot_current_metadata = _enrich_symbol_metadata(
                {
                    symbol: current_metadata[symbol]
                    for symbol in snapshot.normalized_symbols
                    if symbol in current_metadata
                },
                source=metadata_source,
                source_revision_id=None,
                anchor=snapshot.effective_date,
            )
            merged_symbol_metadata: dict[str, dict[str, Any]] = {}
            enriched_count = 0
            for symbol in snapshot.normalized_symbols:
                existing = dict(snapshot.symbol_metadata.get(symbol) or {})
                current = snapshot_current_metadata.get(symbol)
                if current and not _has_industry_metadata(existing):
                    existing.update(current)
                    enriched_count += 1
                elif current:
                    for key, value in current.items():
                        existing.setdefault(key, value)
                if existing:
                    merged_symbol_metadata[symbol] = existing
            if not enriched_count:
                enriched_snapshots.append(snapshot)
                continue
            metadata = dict(snapshot.metadata or {})
            metadata.setdefault("industry_metadata_enrichment_source", metadata_source)
            metadata["industry_metadata_enriched_symbol_count"] = enriched_count
            enriched_snapshots.append(
                replace(
                    snapshot,
                    metadata=metadata,
                    symbol_metadata=merged_symbol_metadata,
                )
            )
        return enriched_snapshots


class WikipediaSp500ChangesUniverseHistoryProvider:
    provider_name = "wikipedia_sp500_changes_table"

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
        self._change_events_cache: list[Sp500ConstituentChangeEvent] | None = None

    def _fetch_html(self) -> str:
        query = urllib.parse.urlencode(
            {
                "format": "json",
                "formatversion": "2",
                "action": "parse",
                "page": self.definition.source_page_title,
                "prop": "text",
            }
        )
        request = urllib.request.Request(f"{WIKIPEDIA_API_ENDPOINT}?{query}", headers=WIKIPEDIA_HEADERS)
        last_error: Exception | None = None
        for attempt in range(self.retries):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                html = (payload.get("parse") or {}).get("text")
                if not isinstance(html, str):
                    raise RuntimeError(
                        f"Wikipedia parse response did not include html for page={self.definition.source_page_title}."
                    )
                time.sleep(0.15)
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
                time.sleep(0.6 * (attempt + 1))
            except (urllib.error.URLError, TimeoutError, ValueError, KeyError, RuntimeError) as exc:
                last_error = exc
                if attempt >= self.retries - 1:
                    break
                time.sleep(0.6 * (attempt + 1))
        raise RuntimeError(
            f"Wikipedia S&P 500 changes table request failed for {self.definition.display_name}: {last_error}"
        ) from last_error

    def _parse_change_events(self, html: str) -> list[Sp500ConstituentChangeEvent]:
        parser = WikipediaTableParser()
        parser.feed(html or "")
        selected_rows: list[list[str]] | None = None
        for table in parser.tables:
            if len(table) < 3:
                continue
            header_preview = " ".join(" ".join(row).lower() for row in table[:2])
            if "effective date" in header_preview and "added" in header_preview and "removed" in header_preview:
                selected_rows = table
                break
        if not selected_rows:
            raise RuntimeError("Wikipedia S&P 500 changes table was not found.")

        events: list[Sp500ConstituentChangeEvent] = []
        for row in selected_rows[2:]:
            if len(row) < 4:
                continue
            raw_effective_date = str(row[0] or "").strip()
            if not raw_effective_date:
                continue
            parsed_effective_date: date | None = None
            for fmt in ("%B %d, %Y", "%b %d, %Y"):
                try:
                    parsed_effective_date = datetime.strptime(raw_effective_date, fmt).date()
                    break
                except ValueError:
                    continue
            if parsed_effective_date is None:
                continue
            additions: list[str] = []
            removals: list[str] = []
            if len(row) > 1:
                normalized = normalize_wikipedia_ticker(row[1])
                if normalized:
                    additions.append(normalized)
            if len(row) > 3:
                normalized = normalize_wikipedia_ticker(row[3])
                if normalized:
                    removals.append(normalized)
            if not additions and not removals:
                continue
            events.append(
                Sp500ConstituentChangeEvent(
                    effective_date=parsed_effective_date,
                    additions=additions,
                    removals=removals,
                    source_row=list(row),
                )
            )
        if not events:
            raise RuntimeError("Wikipedia S&P 500 changes table did not expose usable change events.")
        return sorted(events, key=lambda item: item.effective_date)

    def _load_change_events(self) -> list[Sp500ConstituentChangeEvent]:
        if self._change_events_cache is None:
            self._change_events_cache = self._parse_change_events(self._fetch_html())
        return list(self._change_events_cache)

    def enrich_snapshots(
        self,
        snapshots: Sequence[UniverseMembershipSnapshot],
    ) -> list[UniverseMembershipSnapshot]:
        ordered_snapshots = sorted(snapshots, key=lambda item: item.effective_date)
        if not ordered_snapshots:
            return []
        baseline_snapshot: UniverseMembershipSnapshot | None = None
        baseline_index: int | None = None
        for index, snapshot in enumerate(ordered_snapshots):
            if _is_historical_anchor_quality((snapshot.metadata or {}).get("source_quality")) and not snapshot.fallback_source:
                baseline_snapshot = snapshot
                baseline_index = index
                break
        if baseline_snapshot is None or baseline_index is None or baseline_index == 0:
            return list(ordered_snapshots)

        change_events = self._load_change_events()
        oldest_change_date = min(item.effective_date for item in change_events)
        first_supported_anchor = next(
            (anchor for anchor in semiannual_anchor_dates(ordered_snapshots[0].effective_date, baseline_snapshot.effective_date) if anchor >= oldest_change_date),
            None,
        )
        if first_supported_anchor is None:
            return list(ordered_snapshots)

        baseline_symbols = list(dict.fromkeys(baseline_snapshot.normalized_symbols))
        baseline_anchor = baseline_snapshot.effective_date
        updated_snapshots = list(ordered_snapshots)

        for index in range(baseline_index - 1, -1, -1):
            current_snapshot = ordered_snapshots[index]
            anchor = current_snapshot.effective_date
            if anchor < first_supported_anchor:
                continue
            if _is_historical_anchor_quality((current_snapshot.metadata or {}).get("source_quality")) and not current_snapshot.fallback_source:
                continue

            state = set(baseline_symbols)
            applied_change_count = 0
            for event in change_events:
                if not (anchor < event.effective_date <= baseline_anchor):
                    continue
                for symbol in event.additions:
                    if symbol in state:
                        state.remove(symbol)
                    applied_change_count += 1
                for symbol in event.removals:
                    if symbol not in state:
                        state.add(symbol)
                    applied_change_count += 1
            reconstructed_symbols = sorted(state)
            if len(reconstructed_symbols) < self.definition.minimum_member_count:
                continue
            updated_snapshots[index] = _snapshot_from_symbol_list(
                definition=self.definition,
                anchor=anchor,
                source=self.provider_name,
                source_revision_id=f"{self.provider_name}-{anchor.isoformat()}",
                source_page_title=self.definition.source_page_title,
                symbols=reconstructed_symbols,
                fallback_source=None,
                source_quality=SOURCE_QUALITY_HISTORICAL_DATASET,
                extra_metadata={
                    "anchor_mode": "wikipedia_changes_backfill",
                    "historical_dataset_provider": self.provider_name,
                    "historical_dataset_url": f"https://en.wikipedia.org/wiki/{urllib.parse.quote(self.definition.source_page_title.replace(' ', '_'))}",
                    "historical_dataset_baseline_anchor": baseline_anchor.isoformat(),
                    "historical_dataset_oldest_change_date": oldest_change_date.isoformat(),
                    "historical_dataset_change_count": applied_change_count,
                    "source_origin": "historical_dataset",
                    "replaced_source_quality": (current_snapshot.metadata or {}).get("source_quality"),
                },
                symbol_metadata={
                    symbol: baseline_snapshot.symbol_metadata[symbol]
                    for symbol in reconstructed_symbols
                    if symbol in baseline_snapshot.symbol_metadata
                },
            )
        return updated_snapshots


class WikipediaNasdaq100ChangesUniverseHistoryProvider:
    provider_name = "wikipedia_nasdaq100_changes_table"

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
        self._change_events_cache: list[Nasdaq100ConstituentChangeEvent] | None = None

    def _fetch_html(self) -> str:
        query = urllib.parse.urlencode(
            {
                "format": "json",
                "formatversion": "2",
                "action": "parse",
                "page": self.definition.source_page_title,
                "prop": "text",
            }
        )
        request = urllib.request.Request(f"{WIKIPEDIA_API_ENDPOINT}?{query}", headers=WIKIPEDIA_HEADERS)
        last_error: Exception | None = None
        for attempt in range(self.retries):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                html = (payload.get("parse") or {}).get("text")
                if not isinstance(html, str):
                    raise RuntimeError(
                        f"Wikipedia parse response did not include html for page={self.definition.source_page_title}."
                    )
                time.sleep(0.15)
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
                time.sleep(0.6 * (attempt + 1))
            except (urllib.error.URLError, TimeoutError, ValueError, KeyError, RuntimeError) as exc:
                last_error = exc
                if attempt >= self.retries - 1:
                    break
                time.sleep(0.6 * (attempt + 1))
        raise RuntimeError(
            f"Wikipedia Nasdaq-100 changes table request failed for {self.definition.display_name}: {last_error}"
        ) from last_error

    def _parse_change_events(self, html: str) -> list[Nasdaq100ConstituentChangeEvent]:
        parser = WikipediaTableParser()
        parser.feed(html or "")
        selected_rows: list[list[str]] | None = None
        for table in parser.tables:
            if len(table) < 3:
                continue
            header_preview = " ".join(" ".join(row).lower() for row in table[:2])
            if "date" in header_preview and "added" in header_preview and "removed" in header_preview and "reason" in header_preview:
                selected_rows = table
                break
        if not selected_rows:
            raise RuntimeError("Wikipedia Nasdaq-100 changes table was not found.")

        events: list[Nasdaq100ConstituentChangeEvent] = []
        for row in selected_rows[2:]:
            if len(row) < 5:
                continue
            raw_effective_date = str(row[0] or "").strip()
            if not raw_effective_date:
                continue
            parsed_effective_date: date | None = None
            for fmt in ("%B %d, %Y", "%b %d, %Y"):
                try:
                    parsed_effective_date = datetime.strptime(raw_effective_date, fmt).date()
                    break
                except ValueError:
                    continue
            if parsed_effective_date is None:
                continue
            additions: list[str] = []
            removals: list[str] = []
            if len(row) > 1:
                normalized = normalize_wikipedia_ticker(row[1])
                if normalized:
                    additions.append(normalized)
            if len(row) > 3:
                normalized = normalize_wikipedia_ticker(row[3])
                if normalized:
                    removals.append(normalized)
            if not additions and not removals:
                continue
            events.append(
                Nasdaq100ConstituentChangeEvent(
                    effective_date=parsed_effective_date,
                    additions=additions,
                    removals=removals,
                    source_row=list(row),
                )
            )
        if not events:
            raise RuntimeError("Wikipedia Nasdaq-100 changes table did not expose usable change events.")
        return sorted(events, key=lambda item: item.effective_date)

    def _load_change_events(self) -> list[Nasdaq100ConstituentChangeEvent]:
        if self._change_events_cache is None:
            self._change_events_cache = self._parse_change_events(self._fetch_html())
        return list(self._change_events_cache)

    def enrich_snapshots(
        self,
        snapshots: Sequence[UniverseMembershipSnapshot],
    ) -> list[UniverseMembershipSnapshot]:
        ordered_snapshots = sorted(snapshots, key=lambda item: item.effective_date)
        if not ordered_snapshots:
            return []
        baseline_snapshot: UniverseMembershipSnapshot | None = None
        baseline_index: int | None = None
        for index, snapshot in enumerate(ordered_snapshots):
            if _is_historical_anchor_quality((snapshot.metadata or {}).get("source_quality")) and not snapshot.fallback_source:
                baseline_snapshot = snapshot
                baseline_index = index
                break
        if baseline_snapshot is None or baseline_index is None or baseline_index == 0:
            return list(ordered_snapshots)

        change_events = self._load_change_events()
        oldest_change_date = min(item.effective_date for item in change_events)
        first_supported_anchor = next(
            (
                anchor
                for anchor in semiannual_anchor_dates(ordered_snapshots[0].effective_date, baseline_snapshot.effective_date)
                if anchor >= oldest_change_date
            ),
            None,
        )
        if first_supported_anchor is None:
            return list(ordered_snapshots)

        baseline_symbols = list(dict.fromkeys(baseline_snapshot.normalized_symbols))
        baseline_anchor = baseline_snapshot.effective_date
        updated_snapshots = list(ordered_snapshots)

        for index in range(baseline_index - 1, -1, -1):
            current_snapshot = ordered_snapshots[index]
            anchor = current_snapshot.effective_date
            if anchor < first_supported_anchor:
                continue
            if _is_historical_anchor_quality((current_snapshot.metadata or {}).get("source_quality")) and not current_snapshot.fallback_source:
                continue

            state = set(baseline_symbols)
            applied_change_count = 0
            for event in change_events:
                if not (anchor < event.effective_date <= baseline_anchor):
                    continue
                for symbol in event.additions:
                    if symbol in state:
                        state.remove(symbol)
                    applied_change_count += 1
                for symbol in event.removals:
                    if symbol not in state:
                        state.add(symbol)
                    applied_change_count += 1
            reconstructed_symbols = sorted(state)
            if len(reconstructed_symbols) < self.definition.minimum_member_count:
                continue
            updated_snapshots[index] = _snapshot_from_symbol_list(
                definition=self.definition,
                anchor=anchor,
                source=self.provider_name,
                source_revision_id=f"{self.provider_name}-{anchor.isoformat()}",
                source_page_title=self.definition.source_page_title,
                symbols=reconstructed_symbols,
                fallback_source=None,
                source_quality=SOURCE_QUALITY_HISTORICAL_DATASET,
                extra_metadata={
                    "anchor_mode": "wikipedia_changes_backfill",
                    "historical_dataset_provider": self.provider_name,
                    "historical_dataset_url": f"https://en.wikipedia.org/wiki/{urllib.parse.quote(self.definition.source_page_title.replace(' ', '_'))}",
                    "historical_dataset_baseline_anchor": baseline_anchor.isoformat(),
                    "historical_dataset_oldest_change_date": oldest_change_date.isoformat(),
                    "historical_dataset_change_count": applied_change_count,
                    "source_origin": "historical_dataset",
                    "replaced_source_quality": (current_snapshot.metadata or {}).get("source_quality"),
                },
                symbol_metadata={
                    symbol: baseline_snapshot.symbol_metadata[symbol]
                    for symbol in reconstructed_symbols
                    if symbol in baseline_snapshot.symbol_metadata
                },
            )
        return updated_snapshots


class ArchivedNasdaq100UniverseHistoryProvider:
    provider_name = "internet_archive_wikipedia_snapshot"

    def __init__(
        self,
        *,
        definition: UniverseDefinition,
        candidate_urls: tuple[str, ...] = NASDAQ100_ARCHIVED_CANDIDATE_URLS,
        archive_window_days: int = 180,
        retries: int = 3,
        timeout: int = 20,
    ) -> None:
        self.definition = definition
        self.candidate_urls = tuple(candidate_urls)
        self.archive_window_days = archive_window_days
        self.retries = retries
        self.timeout = timeout
        self._text_cache: dict[str, str] = {}

    def _fetch_text(self, url: str) -> str:
        cached = self._text_cache.get(url)
        if cached is not None:
            return cached
        request = urllib.request.Request(url, headers=CURRENT_HTML_HEADERS)
        last_error: Exception | None = None
        for attempt in range(self.retries):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    text = response.read().decode("utf-8", errors="ignore")
                time.sleep(0.1)
                self._text_cache[url] = text
                return text
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError) as exc:
                last_error = exc
                if attempt >= self.retries - 1:
                    break
                time.sleep(0.5 * (attempt + 1))
        raise RuntimeError(f"Internet Archive request failed for {url}: {last_error}") from last_error

    def _lookup_archived_snapshot(self, source_url: str, anchor: date) -> tuple[str, str] | None:
        from_timestamp = (anchor - timedelta(days=self.archive_window_days)).strftime("%Y%m%d")
        to_timestamp = anchor.strftime("%Y%m%d") + "235959"
        query = urllib.parse.urlencode(
            {
                "url": source_url,
                "output": "json",
                "fl": "timestamp,original,statuscode,mimetype",
                "filter": ["statuscode:200", "mimetype:text/html"],
                "from": from_timestamp,
                "to": to_timestamp,
            },
            doseq=True,
        )
        payload = self._fetch_text(f"{INTERNET_ARCHIVE_CDX_ENDPOINT}?{query}")
        rows = json.loads(payload)
        if not isinstance(rows, list) or len(rows) <= 1:
            return None
        latest_timestamp = ""
        latest_original = ""
        for row in rows[1:]:
            if not isinstance(row, list) or len(row) < 2:
                continue
            timestamp = str(row[0] or "").strip()
            original = str(row[1] or "").strip()
            if not timestamp or not original:
                continue
            if timestamp > to_timestamp:
                continue
            if timestamp > latest_timestamp:
                latest_timestamp = timestamp
                latest_original = original
        if not latest_timestamp or not latest_original:
            return None
        return latest_timestamp, latest_original

    def _load_anchor_snapshot(self, anchor: date) -> UniverseMembershipSnapshot | None:
        best_candidate: tuple[str, str, str] | None = None
        for candidate_url in self.candidate_urls:
            snapshot = self._lookup_archived_snapshot(candidate_url, anchor)
            if snapshot is None:
                continue
            timestamp, original_url = snapshot
            if best_candidate is None or timestamp > best_candidate[0]:
                best_candidate = (timestamp, original_url, candidate_url)
        if best_candidate is None:
            return None
        timestamp, original_url, candidate_url = best_candidate
        archive_url = INTERNET_ARCHIVE_ARCHIVED_PAGE_TEMPLATE.format(
            timestamp=timestamp,
            original_url=original_url,
        )
        html = self._fetch_text(archive_url)
        extracted = extract_symbols_from_html(html, minimum_member_count=self.definition.minimum_member_count)
        if len(extracted.normalized_symbols) < self.definition.minimum_member_count:
            return None
        return _snapshot_from_symbol_list(
            definition=self.definition,
            anchor=anchor,
            source=self.provider_name,
            source_revision_id=f"{self.provider_name}-{anchor.isoformat()}",
            source_page_title=self.definition.source_page_title,
            symbols=list(extracted.normalized_symbols),
            raw_symbols=list(extracted.raw_symbols),
            fallback_source=None,
            source_quality=SOURCE_QUALITY_HISTORICAL_DATASET,
            extra_metadata={
                "anchor_mode": "archived_snapshot_backfill",
                "historical_dataset_provider": self.provider_name,
                "historical_dataset_url": archive_url,
                "archived_snapshot_url": archive_url,
                "archived_snapshot_timestamp": timestamp,
                "archived_source_url": candidate_url,
                "source_origin": "historical_dataset",
            },
            symbol_metadata=extracted.symbol_metadata,
        )

    def enrich_snapshots(
        self,
        snapshots: list[UniverseMembershipSnapshot],
    ) -> list[UniverseMembershipSnapshot]:
        updated_snapshots = list(snapshots)
        for index, current_snapshot in enumerate(snapshots):
            if _is_historical_anchor_quality((current_snapshot.metadata or {}).get("source_quality")) and not current_snapshot.fallback_source:
                continue
            try:
                archived_snapshot = self._load_anchor_snapshot(current_snapshot.effective_date)
            except Exception:
                archived_snapshot = None
            if archived_snapshot is None:
                continue
            metadata = dict(archived_snapshot.metadata or {})
            metadata["replaced_source_quality"] = (current_snapshot.metadata or {}).get("source_quality")
            updated_snapshots[index] = replace(archived_snapshot, metadata=metadata)
        return updated_snapshots


class ArchivedNasdaqOfficialActivityUniverseHistoryProvider(ArchivedNasdaq100UniverseHistoryProvider):
    provider_name = "internet_archive_nasdaq_official_activity"

    def __init__(
        self,
        *,
        definition: UniverseDefinition,
        candidate_urls: tuple[str, ...] = NASDAQ100_OFFICIAL_ACTIVITY_CANDIDATE_URLS,
        archive_window_days: int = 365,
        lookahead_window_days: int = 75,
        retries: int = 3,
        timeout: int = 20,
    ) -> None:
        super().__init__(
            definition=definition,
            candidate_urls=candidate_urls,
            archive_window_days=archive_window_days,
            retries=retries,
            timeout=timeout,
        )
        self.lookahead_window_days = lookahead_window_days

    def _lookup_archived_snapshot(self, source_url: str, anchor: date) -> tuple[str, str] | None:
        from_timestamp = (anchor - timedelta(days=self.archive_window_days)).strftime("%Y%m%d")
        to_timestamp = (anchor + timedelta(days=self.lookahead_window_days)).strftime("%Y%m%d") + "235959"
        query = urllib.parse.urlencode(
            {
                "url": source_url,
                "output": "json",
                "fl": "timestamp,original,statuscode,mimetype",
                "filter": ["statuscode:200", "mimetype:text/html"],
                "from": from_timestamp,
                "to": to_timestamp,
            },
            doseq=True,
        )
        payload = self._fetch_text(f"{INTERNET_ARCHIVE_CDX_ENDPOINT}?{query}")
        rows = json.loads(payload)
        if not isinstance(rows, list) or len(rows) <= 1:
            return None
        anchor_end = datetime.combine(anchor, dt_time.max, tzinfo=timezone.utc)
        best_candidate: tuple[int, float, str, str] | None = None
        for row in rows[1:]:
            if not isinstance(row, list) or len(row) < 2:
                continue
            timestamp = str(row[0] or "").strip()
            original = str(row[1] or "").strip()
            if not timestamp or not original:
                continue
            try:
                capture_dt = datetime.strptime(timestamp, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
            except ValueError:
                continue
            after_penalty = 0 if capture_dt <= anchor_end else 1
            distance_seconds = abs((capture_dt - anchor_end).total_seconds())
            candidate = (after_penalty, distance_seconds, timestamp, original)
            if best_candidate is None or candidate < best_candidate:
                best_candidate = candidate
        if best_candidate is None:
            return None
        return best_candidate[2], best_candidate[3]

    def _load_anchor_snapshot(self, anchor: date) -> UniverseMembershipSnapshot | None:
        best_candidate: tuple[str, str, str] | None = None
        for candidate_url in self.candidate_urls:
            snapshot = self._lookup_archived_snapshot(candidate_url, anchor)
            if snapshot is None:
                continue
            timestamp, original_url = snapshot
            if best_candidate is None or timestamp > best_candidate[0]:
                best_candidate = (timestamp, original_url, candidate_url)
        if best_candidate is None:
            return None
        timestamp, original_url, candidate_url = best_candidate
        archive_url = INTERNET_ARCHIVE_ARCHIVED_PAGE_TEMPLATE.format(
            timestamp=timestamp,
            original_url=original_url,
        )
        html = self._fetch_text(archive_url)
        extracted = extract_symbols_from_nasdaq_activity_html(
            html,
            minimum_member_count=self.definition.minimum_member_count,
        )
        if len(extracted.normalized_symbols) < self.definition.minimum_member_count:
            return None
        return _snapshot_from_symbol_list(
            definition=self.definition,
            anchor=anchor,
            source=self.provider_name,
            source_revision_id=f"{self.provider_name}-{anchor.isoformat()}",
            source_page_title=self.definition.source_page_title,
            symbols=list(extracted.normalized_symbols),
            raw_symbols=list(extracted.raw_symbols),
            fallback_source=None,
            source_quality=SOURCE_QUALITY_HISTORICAL_DATASET,
            extra_metadata={
                "anchor_mode": "archived_official_activity",
                "historical_dataset_provider": self.provider_name,
                "historical_dataset_url": archive_url,
                "archived_snapshot_url": archive_url,
                "archived_snapshot_timestamp": timestamp,
                "archived_source_url": candidate_url,
                "official_seed_status": "seeded",
                "official_seed_source_urls": [archive_url],
                "source_origin": "historical_dataset",
            },
            symbol_metadata=extracted.symbol_metadata,
        )


class LocalNasdaq100SeedUniverseHistoryProvider:
    provider_name = "local_nasdaq100_historical_seed"

    def __init__(
        self,
        *,
        definition: UniverseDefinition,
        seed_path: str | Path = LOCAL_NASDAQ100_HISTORICAL_SEED_PATH,
    ) -> None:
        self.definition = definition
        self.seed_path = Path(seed_path)
        self._seed_cache: dict[date, dict[str, Any]] | None = None

    def _load_seed_entries(self) -> dict[date, dict[str, Any]]:
        if self._seed_cache is not None:
            return dict(self._seed_cache)
        if not self.seed_path.exists():
            self._seed_cache = {}
            return {}
        payload = json.loads(self.seed_path.read_text(encoding="utf-8"))
        entries = payload if isinstance(payload, list) else payload.get("anchors") or []
        seed_map: dict[date, dict[str, Any]] = {}
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            effective_date_raw = str(entry.get("effective_date") or "").strip()
            if not effective_date_raw:
                continue
            try:
                effective_date = date.fromisoformat(effective_date_raw)
            except ValueError:
                continue
            raw_symbols = [str(item).strip() for item in (entry.get("symbols") or []) if str(item).strip()]
            normalized_symbols, unmapped_symbols = _normalize_static_members(raw_symbols)
            source_urls = entry.get("source_urls") or entry.get("source_url") or []
            if isinstance(source_urls, str):
                source_urls = [source_urls]
            source_urls = [str(url).strip() for url in source_urls if str(url).strip()]
            published_date = str(entry.get("published_date") or "").strip()
            provenance = str(entry.get("provenance") or "").strip()
            if (
                len(normalized_symbols) < self.definition.minimum_member_count
                or not source_urls
                or not published_date
                or not provenance
            ):
                continue
            seed_map[effective_date] = {
                "effective_date": effective_date,
                "raw_symbols": raw_symbols,
                "normalized_symbols": normalized_symbols,
                "unmapped_symbols": unmapped_symbols,
                "source_urls": source_urls,
                "published_date": published_date,
                "provenance": provenance,
                "additions": list(entry.get("additions") or []),
                "removals": list(entry.get("removals") or []),
            }
        self._seed_cache = dict(seed_map)
        return dict(seed_map)

    def _load_anchor_snapshot(self, anchor: date) -> UniverseMembershipSnapshot | None:
        seed_entry = self._load_seed_entries().get(anchor)
        if seed_entry is None:
            return None
        return _snapshot_from_symbol_list(
            definition=self.definition,
            anchor=anchor,
            source=self.provider_name,
            source_revision_id=f"{self.provider_name}-{anchor.isoformat()}",
            source_page_title=self.definition.source_page_title,
            symbols=list(seed_entry["normalized_symbols"]),
            raw_symbols=list(seed_entry["raw_symbols"]),
            fallback_source=None,
            source_quality=SOURCE_QUALITY_HISTORICAL_DATASET,
            extra_metadata={
                "anchor_mode": "local_historical_seed",
                "historical_dataset_provider": self.provider_name,
                "historical_dataset_url": seed_entry["source_urls"][0],
                "published_date": seed_entry["published_date"],
                "official_seed_status": "seeded",
                "official_seed_source_urls": list(seed_entry["source_urls"]),
                "official_additions": list(seed_entry["additions"]),
                "official_removals": list(seed_entry["removals"]),
                "provenance": seed_entry["provenance"],
                "source_origin": "historical_dataset",
            },
        )

    def enrich_snapshots(
        self,
        snapshots: Sequence[UniverseMembershipSnapshot],
    ) -> list[UniverseMembershipSnapshot]:
        updated_snapshots = list(snapshots)
        for index, current_snapshot in enumerate(snapshots):
            if _is_historical_anchor_quality((current_snapshot.metadata or {}).get("source_quality")) and not current_snapshot.fallback_source:
                continue
            replacement = self._load_anchor_snapshot(current_snapshot.effective_date)
            if replacement is None:
                continue
            metadata = dict(replacement.metadata or {})
            metadata["replaced_source_quality"] = (current_snapshot.metadata or {}).get("source_quality")
            updated_snapshots[index] = replace(replacement, metadata=metadata)
        return updated_snapshots


class CuratedNasdaq100UniverseHistoryProvider:
    provider_name = "github_nasdaq100_curated_history"

    def __init__(
        self,
        *,
        definition: UniverseDefinition,
        fallback_provider: Any,
        historical_dataset_provider: Any | None = None,
        archived_snapshot_provider: Any | None = None,
        dataset_url_template: str = NASDAQ100_CURATED_DATASET_URL_TEMPLATE,
        first_year: int = NASDAQ100_CURATED_DATASET_FIRST_YEAR,
        retries: int = 3,
        timeout: int = 20,
    ) -> None:
        self.definition = definition
        self.fallback_provider = fallback_provider
        self.historical_dataset_provider = historical_dataset_provider
        self.archived_snapshot_provider = archived_snapshot_provider
        self.dataset_url_template = dataset_url_template
        self.first_year = first_year
        self.retries = retries
        self.timeout = timeout
        self._year_cache: dict[int, dict[str, Any]] = {}

    def _fetch_text(self, url: str) -> str:
        request = urllib.request.Request(url, headers=CURRENT_HTML_HEADERS)
        last_error: Exception | None = None
        for attempt in range(self.retries):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    return response.read().decode("utf-8", errors="ignore")
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError) as exc:
                last_error = exc
                if attempt >= self.retries - 1:
                    break
                time.sleep(0.4 * (attempt + 1))
        raise RuntimeError(f"GitHub Nasdaq-100 curated dataset request failed for {url}: {last_error}") from last_error

    def _parse_year_payload(self, text: str) -> dict[str, Any]:
        year: int | None = None
        jan1_symbols: list[str] = []
        changes: dict[date, dict[str, list[str]]] = {}
        current_section: str | None = None
        current_change_date: date | None = None
        current_change_bucket: str | None = None
        for raw_line in text.splitlines():
            line = raw_line.rstrip()
            stripped = line.strip()
            if not stripped or stripped == "---" or stripped.startswith("#"):
                continue
            if not line.startswith(" "):
                current_change_date = None
                current_change_bucket = None
                if stripped.startswith("year:"):
                    year = int(stripped.split(":", 1)[1].strip())
                elif stripped.startswith("tickers_on_Jan_1:"):
                    current_section = "jan1"
                elif stripped.startswith("changes:"):
                    current_section = "changes"
                continue
            if current_section == "jan1":
                match = re.match(r"^\s*-\s*(.+?)\s*$", line)
                if match:
                    jan1_symbols.append(match.group(1).strip().strip("'\""))
                continue
            if current_section == "changes":
                match = re.match(r"^\s{2}'?(\d{4}-\d{2}-\d{2})'?:\s*$", line)
                if match:
                    current_change_date = date.fromisoformat(match.group(1))
                    changes.setdefault(current_change_date, {"difference": [], "union": []})
                    current_change_bucket = None
                    continue
                match = re.match(r"^\s{4}(difference|union):\s*$", line)
                if match and current_change_date is not None:
                    current_change_bucket = match.group(1)
                    continue
                match = re.match(r"^\s{6}-\s*(.+?)\s*$", line)
                if match and current_change_date is not None and current_change_bucket is not None:
                    changes[current_change_date][current_change_bucket].append(match.group(1).strip().strip("'\""))
        normalized_jan1, unmapped = _normalize_static_members(jan1_symbols)
        if year is None or not normalized_jan1:
            raise RuntimeError("Curated Nasdaq-100 dataset payload did not expose a valid year baseline.")
        normalized_changes: dict[date, dict[str, list[str]]] = {}
        for change_date, payload in changes.items():
            additions, _ = _normalize_static_members(list(payload.get("union") or []))
            deletions, _ = _normalize_static_members(list(payload.get("difference") or []))
            normalized_changes[change_date] = {"union": additions, "difference": deletions}
        return {
            "year": year,
            "tickers_on_jan_1": normalized_jan1,
            "raw_tickers_on_jan_1": jan1_symbols,
            "unmapped_jan_1_symbols": unmapped,
            "changes": normalized_changes,
        }

    def _load_year(self, year: int) -> dict[str, Any]:
        cached = self._year_cache.get(year)
        if cached is not None:
            return dict(cached)
        url = self.dataset_url_template.format(year=year)
        payload = self._parse_year_payload(self._fetch_text(url))
        payload["dataset_url"] = url
        self._year_cache[year] = dict(payload)
        return dict(payload)

    def _snapshot_from_year(self, anchor: date, year_payload: dict[str, Any]) -> UniverseMembershipSnapshot:
        state = list(year_payload["tickers_on_jan_1"])
        seen = set(state)
        applied_changes = 0
        for change_date in sorted(year_payload["changes"]):
            if change_date > anchor:
                continue
            payload = year_payload["changes"][change_date]
            for symbol in payload.get("difference", []):
                if symbol in seen:
                    seen.remove(symbol)
                    state = [item for item in state if item != symbol]
                applied_changes += 1
            for symbol in payload.get("union", []):
                if symbol not in seen:
                    seen.add(symbol)
                    state.append(symbol)
                applied_changes += 1
        return _snapshot_from_symbol_list(
            definition=self.definition,
            anchor=anchor,
            source=self.provider_name,
            source_revision_id=f"{self.provider_name}-{anchor.isoformat()}",
            source_page_title=self.definition.source_page_title,
            symbols=list(state),
            fallback_source=None,
            source_quality=SOURCE_QUALITY_HISTORICAL_DATASET,
            extra_metadata={
                "anchor_mode": "curated_historical_dataset",
                "historical_dataset_provider": "jmccarrell_n100tickers",
                "historical_dataset_year": int(year_payload["year"]),
                "historical_dataset_url": year_payload["dataset_url"],
                "historical_dataset_change_count": int(applied_changes),
            },
        )

    def load_snapshots(self, start_date: date, end_date: date) -> list[UniverseMembershipSnapshot]:
        requested_anchors = semiannual_anchor_dates(start_date, end_date)
        anchors = list(requested_anchors)
        if not anchors:
            return []
        load_end = end_date
        if self.historical_dataset_provider is not None:
            first_supported_anchor = date(self.first_year, 1, 1)
            load_end = max(load_end, first_supported_anchor)
            anchors = semiannual_anchor_dates(start_date, load_end)
        fallback_snapshots = {
            snapshot.effective_date: snapshot
            for snapshot in self.fallback_provider.load_snapshots(start_date, load_end)
        }
        snapshots: list[UniverseMembershipSnapshot] = []
        for anchor in anchors:
            if anchor.year < self.first_year:
                fallback_snapshot = fallback_snapshots.get(anchor)
                if fallback_snapshot is None:
                    raise RuntimeError(f"Fallback provider did not return anchor {anchor.isoformat()}.")
                snapshots.append(fallback_snapshot)
                continue
            try:
                year_payload = self._load_year(anchor.year)
                snapshots.append(self._snapshot_from_year(anchor, year_payload))
            except Exception as exc:
                fallback_snapshot = fallback_snapshots.get(anchor)
                if fallback_snapshot is None:
                    raise
                metadata = dict(fallback_snapshot.metadata or {})
                metadata.setdefault("historical_dataset_provider", "jmccarrell_n100tickers")
                metadata["historical_dataset_probe_status"] = "request_failed"
                metadata["historical_dataset_probe_error"] = str(exc)
                snapshots.append(replace(fallback_snapshot, metadata=metadata))
        if self.historical_dataset_provider is not None:
            snapshots = self.historical_dataset_provider.enrich_snapshots(snapshots)
        if self.archived_snapshot_provider is not None:
            snapshots = self.archived_snapshot_provider.enrich_snapshots(snapshots)
        requested_anchor_set = set(requested_anchors)
        return [snapshot for snapshot in snapshots if snapshot.effective_date in requested_anchor_set]


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
            source_quality=SOURCE_QUALITY_OFFICIAL_ANNOUNCEMENT,
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
            symbol_metadata={
                symbol: previous_snapshot.symbol_metadata[symbol]
                for symbol in normalized_symbols
                if symbol in previous_snapshot.symbol_metadata
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
    from .fmp_constituent_provider import FmpHistoricalConstituentUniverseHistoryProvider

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
    sp500_current_provider = GithubSp500CurrentValidationProvider(
        definition=sp500_definition,
    )
    sp500_industry_enricher = CurrentIndustryMetadataUniverseEnricher(
        metadata_provider=sp500_current_provider,
    )
    sp500_free_provider = WikipediaRevisionUniverseHistoryProvider(
        definition=sp500_definition,
        official_provider=SpGlobalAnnouncementUniverseProvider(
            definition=sp500_definition,
        ),
        historical_dataset_provider=SequentialUniverseSnapshotEnricher(
            WikipediaSp500ChangesUniverseHistoryProvider(
                definition=sp500_definition,
            ),
            sp500_industry_enricher,
        ),
        current_validation_provider=sp500_current_provider,
        fallback_provider=StaticSp500UniverseHistoryProvider(),
    )
    nasdaq100_wikipedia_provider = WikipediaRevisionUniverseHistoryProvider(
        definition=nasdaq100_definition,
        official_provider=NasdaqAnnouncementUniverseProvider(
            definition=nasdaq100_definition,
        ),
        fallback_provider=StaticNasdaq100UniverseHistoryProvider(),
    )
    nasdaq100_free_provider = CuratedNasdaq100UniverseHistoryProvider(
        definition=nasdaq100_definition,
        fallback_provider=nasdaq100_wikipedia_provider,
        historical_dataset_provider=WikipediaNasdaq100ChangesUniverseHistoryProvider(
            definition=nasdaq100_definition,
        ),
        archived_snapshot_provider=SequentialUniverseSnapshotEnricher(
            LocalNasdaq100SeedUniverseHistoryProvider(
                definition=nasdaq100_definition,
            ),
            ArchivedNasdaqOfficialActivityUniverseHistoryProvider(
                definition=nasdaq100_definition,
            ),
            ArchivedNasdaq100UniverseHistoryProvider(
                definition=nasdaq100_definition,
            ),
        ),
    )
    return [
        FmpHistoricalConstituentUniverseHistoryProvider(
            definition=sp500_definition,
            fallback_provider=sp500_free_provider,
            symbol_metadata_provider=sp500_current_provider,
        ),
        FmpHistoricalConstituentUniverseHistoryProvider(
            definition=nasdaq100_definition,
            fallback_provider=nasdaq100_free_provider,
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

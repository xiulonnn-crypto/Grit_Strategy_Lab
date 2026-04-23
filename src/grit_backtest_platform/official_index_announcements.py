from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from html.parser import HTMLParser
from typing import Any


def _collapse_whitespace(text: str) -> str:
    return " ".join((text or "").replace("\u00A0", " ").split()).strip()


class _HtmlTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style"}:
            self._skip_depth += 1
            return
        if self._skip_depth == 0 and tag in {"br", "p", "div", "tr", "li", "table", "section"}:
            self.parts.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"} and self._skip_depth:
            self._skip_depth -= 1
            return
        if self._skip_depth == 0 and tag in {"p", "div", "tr", "li", "table", "section"}:
            self.parts.append(" ")

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0:
            self.parts.append(data)

    def text(self) -> str:
        return _collapse_whitespace(" ".join(self.parts))


class _HtmlTableParser(HTMLParser):
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
        if tag == "table" and "wikitable" in class_name or tag == "table" and "prnbcc" in class_name or tag == "table":
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
            cell_text = _collapse_whitespace(self._current_cell_text)
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


@dataclass(frozen=True)
class OfficialAnnouncementChange:
    action: str
    symbol: str
    company_name: str | None = None
    index_name: str | None = None
    effective_date: date | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class OfficialIndexAnnouncement:
    source_kind: str
    source_name: str
    source_url: str
    headline: str
    effective_date: date | None
    published_date: date | None
    changes: list[OfficialAnnouncementChange]
    raw_text: str
    metadata: dict[str, Any] = field(default_factory=dict)


_TITLE_PATTERN = re.compile(r"<title>([^<]+)</title>", re.IGNORECASE | re.DOTALL)
_OG_TITLE_PATTERN = re.compile(
    r'<meta[^>]+property="og:title"[^>]+content="([^"]+)"',
    re.IGNORECASE | re.DOTALL,
)
_DATE_PATTERNS = [
    re.compile(r"\b([A-Z][a-z]{2,8}\.?\s+\d{1,2},\s+\d{4})\b"),
    re.compile(r"\b([A-Z][a-z]{2,8}\s+\d{1,2},\s+\d{4})\b"),
]
_TICKER_PAIR_PATTERN = re.compile(
    r"(?P<company>[A-Z][^()\n\r]{2,120}?)\s*\((?P<exchange>Nasdaq|NASDAQ|NYSE|NASD|NASDQ|Nasdaq GS|Nasdaq GM|Nasdaq CM|NYSE American|NYSE Arca|NASDAQ-NMS)\s*:\s*(?P<symbol>[A-Z0-9.\-]+)\)",
    re.IGNORECASE,
)


def html_to_text(html: str) -> str:
    extractor = _HtmlTextExtractor()
    extractor.feed(html or "")
    return extractor.text()


def extract_title(html: str) -> str | None:
    if match := _OG_TITLE_PATTERN.search(html or ""):
        return _collapse_whitespace(match.group(1))
    if match := _TITLE_PATTERN.search(html or ""):
        return _collapse_whitespace(match.group(1))
    return None


def _parse_date_candidates(text: str) -> date | None:
    for pattern in _DATE_PATTERNS:
        for match in pattern.finditer(text):
            raw_value = _collapse_whitespace(match.group(1)).replace(".", "")
            for fmt in ("%b %d, %Y", "%B %d, %Y"):
                try:
                    return datetime.strptime(raw_value, fmt).date()
                except ValueError:
                    continue
    return None


def extract_ticker_pairs(text: str) -> list[tuple[str, str, str | None]]:
    pairs: list[tuple[str, str, str | None]] = []
    seen: set[tuple[str, str]] = set()
    for match in _TICKER_PAIR_PATTERN.finditer(text or ""):
        company = _collapse_whitespace(match.group("company"))
        exchange = _collapse_whitespace(match.group("exchange"))
        symbol = _collapse_whitespace(match.group("symbol")).upper()
        key = (company.lower(), symbol)
        if key in seen:
            continue
        seen.add(key)
        pairs.append((company, symbol, exchange))
    return pairs


def extract_table_rows(html: str) -> list[list[str]]:
    parser = _HtmlTableParser()
    parser.feed(html or "")
    rows: list[list[str]] = []
    for table in parser.tables:
        rows.extend(table)
    return rows


def _collect_changes_from_block(
    *,
    text_block: str,
    action: str,
    index_name: str | None,
    effective_date: date | None,
) -> list[OfficialAnnouncementChange]:
    changes: list[OfficialAnnouncementChange] = []
    for company_name, symbol, exchange in extract_ticker_pairs(text_block):
        cleaned_company_name = re.sub(r"^(?:and|or|the)\s+", "", company_name, flags=re.IGNORECASE).strip()
        changes.append(
            OfficialAnnouncementChange(
                action=action,
                symbol=symbol,
                company_name=cleaned_company_name,
                index_name=index_name,
                effective_date=effective_date,
                metadata={"exchange": exchange} if exchange else {},
            )
        )
    return changes


def parse_nasdaq_annual_changes_release(html: str, *, source_url: str) -> OfficialIndexAnnouncement | None:
    text = html_to_text(html)
    headline = extract_title(html) or "Annual Changes to the Nasdaq-100 Index"
    if "Nasdaq-100" not in text and "Nasdaq 100" not in text:
        return None

    effective_date = None
    effective_match = re.search(
        r"effective(?: prior to market open on)?(?:\s+[A-Za-z]+)?(?:,)?\s+([A-Z][a-z]{2,8}\.?\s+\d{1,2},\s+\d{4})",
        text,
        flags=re.IGNORECASE,
    )
    if effective_match:
        raw_effective_date = _collapse_whitespace(effective_match.group(1)).replace(".", "")
        for fmt in ("%B %d, %Y", "%b %d, %Y"):
            try:
                effective_date = datetime.strptime(raw_effective_date, fmt).date()
                break
            except ValueError:
                continue

    additions_block = ""
    removals_block = ""
    additions_match = re.search(
        r"following .*? will be added to the Index:\s*(.*?)(?:As a result of the reconstitution|The following .*? will be removed from the Index:|About Nasdaq|$)",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    removals_match = re.search(
        r"following .*? will be removed from the Index:\s*(.*?)(?:About Nasdaq|$)",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if additions_match:
        additions_block = additions_match.group(1)
    if removals_match:
        removals_block = removals_match.group(1)

    changes = []
    changes.extend(_collect_changes_from_block(text_block=additions_block, action="addition", index_name="Nasdaq-100", effective_date=effective_date))
    changes.extend(_collect_changes_from_block(text_block=removals_block or "", action="deletion", index_name="Nasdaq-100", effective_date=effective_date))

    if not changes:
        return None

    published_date = _parse_date_candidates(headline + " " + text)
    return OfficialIndexAnnouncement(
        source_kind="nasdaq_annual_changes",
        source_name="Nasdaq official annual changes",
        source_url=source_url,
        headline=headline,
        effective_date=effective_date,
        published_date=published_date,
        changes=changes,
        raw_text=text,
        metadata={
            "release_family": "nasdaq_100_annual_reconstitution",
            "official_source": "Nasdaq Investor Relations",
        },
    )


def parse_sp_global_constituent_change_release(html: str, *, source_url: str) -> OfficialIndexAnnouncement | None:
    text = html_to_text(html)
    headline = extract_title(html) or "S&P constituent change announcement"
    if "S&P" not in text and "S&P Global" not in text:
        return None

    rows: list[OfficialAnnouncementChange] = []
    for row in extract_table_rows(html):
        if len(row) < 5:
            continue
        effective_raw, index_name, action, company_name, symbol = row[:5]
        if "s&p" not in index_name.lower():
            continue
        if action.lower() not in {"addition", "deletion"}:
            continue
        effective_date = None
        effective_clean = _collapse_whitespace(effective_raw).replace(".", "")
        for fmt in ("%b %d, %Y", "%B %d, %Y"):
            try:
                effective_date = datetime.strptime(effective_clean, fmt).date()
                break
            except ValueError:
                continue
        rows.append(
            OfficialAnnouncementChange(
                action="addition" if action.lower() == "addition" else "deletion",
                symbol=_collapse_whitespace(symbol).upper(),
                company_name=_collapse_whitespace(company_name),
                index_name=_collapse_whitespace(index_name),
                effective_date=effective_date,
            )
        )

    if not rows:
        # Fallback to text extraction for simplified sample HTML used in tests.
        row_text_pattern = re.compile(
            r"(?P<effective>[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}).*?"
            r"(?P<index>S&P\s+(?:500|100|MidCap 400|SmallCap 600)).*?"
            r"(?P<action>Addition|Deletion).*?"
            r"(?P<company>[A-Z][^()]{2,120}?)\s*\((?:NYSE|NASDAQ|Nasdaq|NASD)\s*:\s*(?P<symbol>[A-Z0-9.\-]+)\)",
            flags=re.IGNORECASE | re.DOTALL,
        )
        for match in row_text_pattern.finditer(text):
            effective_raw = _collapse_whitespace(match.group("effective")).replace(".", "")
            effective_date = None
            for fmt in ("%b %d, %Y", "%B %d, %Y"):
                try:
                    effective_date = datetime.strptime(effective_raw, fmt).date()
                    break
                except ValueError:
                    continue
            rows.append(
                OfficialAnnouncementChange(
                    action="addition" if match.group("action").lower() == "addition" else "deletion",
                    symbol=_collapse_whitespace(match.group("symbol")).upper(),
                    company_name=_collapse_whitespace(match.group("company")),
                    index_name=_collapse_whitespace(match.group("index")),
                    effective_date=effective_date,
                )
            )

    if not rows:
        return None

    published_date = _parse_date_candidates(headline + " " + text)
    effective_dates = [item.effective_date for item in rows if item.effective_date is not None]
    effective_date = max(effective_dates) if effective_dates else None
    return OfficialIndexAnnouncement(
        source_kind="sp_global_constituent_change",
        source_name="S&P Dow Jones Indices official constituent changes",
        source_url=source_url,
        headline=headline,
        effective_date=effective_date,
        published_date=published_date,
        changes=rows,
        raw_text=text,
        metadata={
            "release_family": "sp_global_constituent_changes",
            "official_source": "S&P Dow Jones Indices",
        },
    )

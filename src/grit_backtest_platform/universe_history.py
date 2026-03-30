from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

SP500_UNIVERSE_KEY = '\u6807\u666e500\u6210\u5206\u80a1'
SP500_UNIVERSE_SNAPSHOT_ID = 'un-sp500'
SP500_SOURCE_PAGE_TITLE = 'List of S&P 500 companies'

EXPLICIT_TICKER_MAP = {
    'BRK.B': 'BRK-B',
    'BRK.B.': 'BRK-B',
    'BRK.A': 'BRK-A',
    'BF.B': 'BF-B',
    'BF.B.': 'BF-B',
    'BF.A': 'BF-A',
}

STATIC_SP500_RAW_SYMBOLS = [
    'AAPL',
    'MSFT',
    'NVDA',
    'AMZN',
    'META*',
    'GOOGL[1]',
    'GOOG',
    'BRK.B',
    'LLY',
    'JPM',
    'XOM',
    'AVGO',
    'V',
    'BF.B',
]


@dataclass(frozen=True)
class UniverseMembershipSnapshot:
    universe_key: str
    effective_date: date
    normalized_symbols: list[str]
    raw_symbols: list[str]
    unmapped_symbols: list[str]
    source_revision_id: str | None = None
    source_page_title: str | None = None


def semiannual_anchor_dates(start_date: date, end_date: date) -> list[date]:
    anchors: list[date] = []
    for year in range(start_date.year, end_date.year + 1):
        for month in (1, 7):
            anchor = date(year, month, 1)
            if start_date <= anchor <= end_date:
                anchors.append(anchor)
    return anchors


def normalize_wikipedia_ticker(raw_value: str) -> str | None:
    cleaned = (raw_value or '').strip().upper()
    cleaned = cleaned.replace('\u00A0', '').replace(' ', '')
    cleaned = re.sub(r'\[[^\]]+\]', '', cleaned)
    cleaned = re.sub(r'[\*??]+$', '', cleaned)
    cleaned = re.sub(r'\(.*?\)$', '', cleaned)
    cleaned = EXPLICIT_TICKER_MAP.get(cleaned, cleaned)
    cleaned = re.sub(r'(?<=\w)[./](?=[A-Z0-9]{1,2}$)', '-', cleaned)
    cleaned = re.sub(r'-(OLD|WI|WS|RT)$', '', cleaned)
    if not cleaned:
        return None
    if not re.fullmatch(r'[A-Z][A-Z0-9-]{0,9}', cleaned):
        return None
    return cleaned


class StaticSp500UniverseHistoryProvider:
    def __init__(self, raw_symbols: list[str] | None = None) -> None:
        self.raw_symbols = list(raw_symbols or STATIC_SP500_RAW_SYMBOLS)

    def load_snapshots(self, start_date: date, end_date: date) -> list[UniverseMembershipSnapshot]:
        snapshots: list[UniverseMembershipSnapshot] = []
        for anchor in semiannual_anchor_dates(start_date, end_date):
            normalized: list[str] = []
            unmapped: list[str] = []
            seen: set[str] = set()
            for raw_symbol in self.raw_symbols:
                normalized_symbol = normalize_wikipedia_ticker(raw_symbol)
                if normalized_symbol is None:
                    unmapped.append(raw_symbol)
                    continue
                if normalized_symbol in seen:
                    continue
                seen.add(normalized_symbol)
                normalized.append(normalized_symbol)
            snapshots.append(
                UniverseMembershipSnapshot(
                    universe_key=SP500_UNIVERSE_KEY,
                    effective_date=anchor,
                    normalized_symbols=normalized,
                    raw_symbols=list(self.raw_symbols),
                    unmapped_symbols=unmapped,
                    source_revision_id=f'static-{anchor.isoformat()}',
                    source_page_title=SP500_SOURCE_PAGE_TITLE,
                )
            )
        return snapshots


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

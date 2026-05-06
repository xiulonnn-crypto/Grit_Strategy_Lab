from __future__ import annotations

import json
import urllib.error
from datetime import date

import grit_backtest_platform.universe_history as universe_history_module
from grit_backtest_platform.universe_history import (
    ANCHOR_SCHEDULE,
    ArchivedNasdaqOfficialActivityUniverseHistoryProvider,
    ArchivedNasdaq100UniverseHistoryProvider,
    CurrentIndustryMetadataUniverseEnricher,
    CuratedNasdaq100UniverseHistoryProvider,
    GithubSp500CurrentValidationProvider,
    LocalNasdaq100SeedUniverseHistoryProvider,
    NASDAQ100_UNIVERSE_KEY,
    NASDAQ100_UNIVERSE_NAME,
    NASDAQ100_UNIVERSE_SNAPSHOT_ID,
    NASDAQ100_SOURCE_PAGE_TITLE,
    SequentialUniverseSnapshotEnricher,
    SP500_UNIVERSE_KEY,
    SP500_UNIVERSE_NAME,
    SP500_UNIVERSE_SNAPSHOT_ID,
    SP500_SOURCE_PAGE_TITLE,
    SOURCE_QUALITY_CURRENT_PAGE_FALLBACK,
    SOURCE_QUALITY_HISTORICAL_DATASET,
    SOURCE_QUALITY_OFFICIAL_ANNOUNCEMENT,
    SOURCE_QUALITY_WIKIPEDIA_REVISION,
    NasdaqAnnouncementUniverseProvider,
    SpGlobalAnnouncementUniverseProvider,
    StaticNasdaq100UniverseHistoryProvider,
    StaticSp500UniverseHistoryProvider,
    UniverseDefinition,
    UniverseMembershipSnapshot,
    WikipediaNasdaq100ChangesUniverseHistoryProvider,
    WikipediaRevisionUniverseHistoryProvider,
    WikipediaSp500ChangesUniverseHistoryProvider,
    extract_symbols_from_html,
    extract_symbols_from_nasdaq_activity_html,
)


class _FakeHttpResponse:
    def __init__(self, payload: str) -> None:
        self.payload = payload.encode("utf-8")

    def read(self) -> bytes:
        return self.payload

    def __enter__(self) -> "_FakeHttpResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


def _baseline_snapshot(
    *,
    definition: UniverseDefinition,
    effective_date: date,
    symbols: list[str],
    source: str,
) -> UniverseMembershipSnapshot:
    return UniverseMembershipSnapshot(
        universe_key=definition.universe_key,
        universe_name=definition.display_name,
        effective_date=effective_date,
        normalized_symbols=list(symbols),
        raw_symbols=list(symbols),
        unmapped_symbols=[],
        source=source,
        fallback_source=None,
        anchor_schedule=ANCHOR_SCHEDULE,
        source_revision_id=f"{source}-{effective_date.isoformat()}",
        source_page_title=definition.source_page_title,
        metadata={
            "coverage_mode": "point_in_time_anchor",
            "source_quality": SOURCE_QUALITY_WIKIPEDIA_REVISION,
        },
    )


def _current_page_snapshot(
    *,
    definition: UniverseDefinition,
    effective_date: date,
    symbols: list[str],
    source: str,
    fallback_source: str,
) -> UniverseMembershipSnapshot:
    return UniverseMembershipSnapshot(
        universe_key=definition.universe_key,
        universe_name=definition.display_name,
        effective_date=effective_date,
        normalized_symbols=list(symbols),
        raw_symbols=list(symbols),
        unmapped_symbols=[],
        source=source,
        fallback_source=fallback_source,
        anchor_schedule=ANCHOR_SCHEDULE,
        source_revision_id=f"{source}-{effective_date.isoformat()}",
        source_page_title=definition.source_page_title,
        metadata={
            "coverage_mode": "point_in_time_anchor",
            "source_quality": SOURCE_QUALITY_CURRENT_PAGE_FALLBACK,
        },
    )


def test_sp500_wikipedia_table_extracts_per_symbol_gics_metadata():
    html = """
        <table class="wikitable">
          <tr>
            <th>Security</th><th>Symbol</th><th>GICS Sector</th><th>GICS Sub-Industry</th>
          </tr>
          <tr>
            <td>Apple Inc.</td><td>AAPL</td><td>Information Technology</td><td>Technology Hardware</td>
          </tr>
          <tr>
            <td>Amazon.com Inc.</td><td>AMZN</td><td>Consumer Discretionary</td><td>Broadline Retail</td>
          </tr>
        </table>
    """

    extracted = extract_symbols_from_html(html, minimum_member_count=2)

    assert extracted.normalized_symbols == ["AAPL", "AMZN"]
    assert extracted.symbol_metadata["AAPL"]["security_name"] == "Apple Inc."
    assert extracted.symbol_metadata["AAPL"]["gics_sector"] == "Information Technology"
    assert extracted.symbol_metadata["AAPL"]["gics_sub_industry"] == "Technology Hardware"
    assert extracted.symbol_metadata["AMZN"]["sector"] == "Consumer Discretionary"


def test_current_industry_metadata_enricher_adds_gics_to_historical_skeleton():
    class MetadataProvider:
        provider_name = "github_sp500_current_dataset"

        def _load_symbol_metadata(self):
            return {
                "AAPL": {
                    "gics_sector": "Information Technology",
                    "gics_sub_industry": "Technology Hardware",
                },
                "AMZN": {
                    "gics_sector": "Consumer Discretionary",
                    "gics_sub_industry": "Broadline Retail",
                },
            }

    definition = UniverseDefinition(
        universe_key=SP500_UNIVERSE_KEY,
        display_name=SP500_UNIVERSE_NAME,
        snapshot_id=SP500_UNIVERSE_SNAPSHOT_ID,
        source_page_title=SP500_SOURCE_PAGE_TITLE,
        minimum_member_count=2,
    )
    snapshot = _baseline_snapshot(
        definition=definition,
        effective_date=date(2026, 1, 1),
        symbols=["AAPL", "AMZN"],
        source="github_sp500_historical_components",
    )

    enriched = CurrentIndustryMetadataUniverseEnricher(metadata_provider=MetadataProvider()).enrich_snapshots([snapshot])

    assert enriched[0].symbol_metadata["AAPL"]["gics_sector"] == "Information Technology"
    assert enriched[0].symbol_metadata["AMZN"]["gics_sub_industry"] == "Broadline Retail"
    assert enriched[0].symbol_metadata["AAPL"]["industry_classification_effective_date"] == "2026-01-01"
    assert enriched[0].metadata["industry_metadata_enrichment_source"] == "github_sp500_current_dataset"


def test_nasdaq_official_annual_changes_apply_delta_after_revision_history(monkeypatch):
    definition = UniverseDefinition(
        universe_key=NASDAQ100_UNIVERSE_KEY,
        display_name=NASDAQ100_UNIVERSE_NAME,
        snapshot_id=NASDAQ100_UNIVERSE_SNAPSHOT_ID,
        source_page_title=NASDAQ100_SOURCE_PAGE_TITLE,
        minimum_member_count=3,
    )
    provider = WikipediaRevisionUniverseHistoryProvider(
        definition=definition,
        official_provider=NasdaqAnnouncementUniverseProvider(definition=definition, retries=1, timeout=1),
        fallback_provider=StaticNasdaq100UniverseHistoryProvider(raw_symbols=["AAPL", "MSFT", "NVDA"]),
        retries=1,
        timeout=1,
    )

    def fake_historical(anchor: date) -> UniverseMembershipSnapshot:
        if anchor == date(2025, 1, 1):
            return _baseline_snapshot(
                definition=definition,
                effective_date=anchor,
                symbols=["AAPL", "MSFT", "NVDA", "AMZN", "ILMN", "SMCI", "MRNA"],
                source=provider.provider_name,
            )
        raise RuntimeError("historical revision missing")

    def fake_current(*args, **kwargs):  # noqa: ANN001
        raise AssertionError("current-page fallback should not be used when official source is available")

    monkeypatch.setattr(provider, "_load_historical_snapshot", fake_historical)
    monkeypatch.setattr(provider, "_load_current_page_snapshot", fake_current)
    monkeypatch.setattr(provider, "_load_secondary_current_page_snapshot", fake_current)

    archive_html = """
        <html>
          <body>
            <a href="https://ir.nasdaq.com/news-releases/news-release-details/annual-changes-nasdaq-100-indexr-1">Annual Changes to the Nasdaq-100 Index</a>
          </body>
        </html>
    """
    release_html = """
        <html>
          <head>
            <title>Annual Changes to the Nasdaq-100 Index | Nasdaq, Inc.</title>
          </head>
          <body>
            <div class="field__item">Annual Changes to the Nasdaq-100 Index</div>
            <p align="left">Nasdaq (Nasdaq: NDAQ) today announced the results of the annual reconstitution of the Nasdaq-100 Index which will become effective prior to market open on Monday, June 16, 2025.</p>
            <p align="left">The following three companies will be added to the Index: Palantir Technologies Inc. (Nasdaq: PLTR), MicroStrategy Incorporated (Nasdaq: MSTR), and Axon Enterprise, Inc. (Nasdaq: AXON).</p>
            <p align="left">As a result of the reconstitution, the following three companies will be removed from the Index: Illumina, Inc. (Nasdaq: ILMN), Super Micro Computer, Inc. (Nasdaq: SMCI), and Moderna, Inc. (Nasdaq: MRNA).</p>
          </body>
        </html>
    """

    def fake_urlopen(request, timeout=0):
        if request.full_url.startswith("https://ir.nasdaq.com/news-and-events/press-releases"):
            return _FakeHttpResponse(archive_html)
        if request.full_url == "https://ir.nasdaq.com/news-releases/news-release-details/annual-changes-nasdaq-100-indexr-1":
            return _FakeHttpResponse(release_html)
        raise AssertionError(f"Unexpected Nasdaq request: {request.full_url}")

    monkeypatch.setattr(universe_history_module.urllib.request, "urlopen", fake_urlopen)

    snapshots = provider.load_snapshots(start_date=date(2025, 1, 1), end_date=date(2025, 7, 1))

    assert len(snapshots) == 2
    first_snapshot, second_snapshot = snapshots
    assert first_snapshot.source == provider.provider_name
    assert first_snapshot.metadata["source_quality"] == SOURCE_QUALITY_WIKIPEDIA_REVISION
    assert second_snapshot.source == "nasdaq_official_annual_changes"
    assert second_snapshot.fallback_source is None
    assert second_snapshot.metadata["source_quality"] == SOURCE_QUALITY_OFFICIAL_ANNOUNCEMENT
    assert second_snapshot.metadata["official_source_kind"] == "nasdaq_annual_changes"
    assert second_snapshot.metadata["official_additions"] == ["PLTR", "MSTR", "AXON"]
    assert second_snapshot.metadata["official_removals"] == ["ILMN", "SMCI", "MRNA"]
    assert "PLTR" in second_snapshot.normalized_symbols
    assert "MSTR" in second_snapshot.normalized_symbols
    assert "AXON" in second_snapshot.normalized_symbols
    assert "ILMN" not in second_snapshot.normalized_symbols
    assert "SMCI" not in second_snapshot.normalized_symbols
    assert "MRNA" not in second_snapshot.normalized_symbols


def test_sp_global_official_constituent_change_release_applies_table_rows(monkeypatch):
    definition = UniverseDefinition(
        universe_key=SP500_UNIVERSE_KEY,
        display_name=SP500_UNIVERSE_NAME,
        snapshot_id=SP500_UNIVERSE_SNAPSHOT_ID,
        source_page_title=SP500_SOURCE_PAGE_TITLE,
        minimum_member_count=3,
    )
    provider = WikipediaRevisionUniverseHistoryProvider(
        definition=definition,
        official_provider=SpGlobalAnnouncementUniverseProvider(definition=definition, retries=1, timeout=1),
        fallback_provider=StaticSp500UniverseHistoryProvider(raw_symbols=["AAPL", "MSFT", "NVDA"]),
        retries=1,
        timeout=1,
    )

    def fake_historical(anchor: date) -> UniverseMembershipSnapshot:
        if anchor == date(2025, 1, 1):
            return _baseline_snapshot(
                definition=definition,
                effective_date=anchor,
                symbols=["AAPL", "MSFT", "NVDA", "AMZN", "TSLA", "MTCH"],
                source=provider.provider_name,
            )
        raise RuntimeError("historical revision missing")

    def fake_current(*args, **kwargs):  # noqa: ANN001
        raise AssertionError("current-page fallback should not be used when official source is available")

    monkeypatch.setattr(provider, "_load_historical_snapshot", fake_historical)
    monkeypatch.setattr(provider, "_load_current_page_snapshot", fake_current)
    monkeypatch.setattr(provider, "_load_secondary_current_page_snapshot", fake_current)

    archive_html = """
        <html>
          <body>
            <div class="wd_title"><a href="https://press.spglobal.com/2025-03-06-Vertiv-Holdings-Lumentum-Holdings-Coherent-and-EchoStar-Set-to-Join-S-P-500">Vertiv Holdings, Lumentum Holdings, Coherent, and EchoStar Set to Join S&P 500</a></div>
          </body>
        </html>
    """
    release_html = """
        <html>
          <head>
            <title>Vertiv Holdings, Lumentum Holdings, Coherent, and EchoStar Set to Join S&P 500</title>
          </head>
          <body>
            <div class="wd_title wd_language_left">Vertiv Holdings, Lumentum Holdings, Coherent, and EchoStar Set to Join S&P 500</div>
            <ul type="disc">
              <li>The following changes to the S&P 500 will take effect before the market opens on Monday, March 23, 2025.</li>
            </ul>
            <table border="0" cellspacing="0" cellpadding="1" class="prnbcc">
              <tr>
                <td><p><span><b>Mar 23, 2025</b></span></p></td>
                <td><p><span>S&P 500</span></p></td>
                <td><p><span>Addition</span></p></td>
                <td><p><span>Vertiv Holdings</span></p></td>
                <td><p><span>VRT</span></p></td>
                <td><p><span>Industrials</span></p></td>
              </tr>
              <tr>
                <td><p><span><b>Mar 23, 2025</b></span></p></td>
                <td><p><span>S&P 500</span></p></td>
                <td><p><span>Deletion</span></p></td>
                <td><p><span>MTCH Group</span></p></td>
                <td><p><span>MTCH</span></p></td>
                <td><p><span>Communication Services</span></p></td>
              </tr>
            </table>
          </body>
        </html>
    """

    def fake_urlopen(request, timeout=0):
        if request.full_url == "https://press.spglobal.com/index.php?l=50&o=0&s=2429":
            return _FakeHttpResponse(archive_html)
        if request.full_url == "https://press.spglobal.com/2025-03-06-Vertiv-Holdings-Lumentum-Holdings-Coherent-and-EchoStar-Set-to-Join-S-P-500":
            return _FakeHttpResponse(release_html)
        raise AssertionError(f"Unexpected S&P request: {request.full_url}")

    monkeypatch.setattr(universe_history_module.urllib.request, "urlopen", fake_urlopen)

    snapshots = provider.load_snapshots(start_date=date(2025, 1, 1), end_date=date(2025, 7, 1))

    assert len(snapshots) == 2
    first_snapshot, second_snapshot = snapshots
    assert first_snapshot.source == provider.provider_name
    assert first_snapshot.metadata["source_quality"] == SOURCE_QUALITY_WIKIPEDIA_REVISION
    assert second_snapshot.source == "sp_global_official_constituent_change"
    assert second_snapshot.fallback_source is None
    assert second_snapshot.metadata["source_quality"] == SOURCE_QUALITY_OFFICIAL_ANNOUNCEMENT
    assert second_snapshot.metadata["official_source_kind"] == "sp_global_constituent_change"
    assert second_snapshot.metadata["official_additions"] == ["VRT"]
    assert second_snapshot.metadata["official_removals"] == ["MTCH"]
    assert "VRT" in second_snapshot.normalized_symbols
    assert "MTCH" not in second_snapshot.normalized_symbols


def test_official_announcements_do_not_override_fallback_baseline(monkeypatch):
    definition = UniverseDefinition(
        universe_key=NASDAQ100_UNIVERSE_KEY,
        display_name=NASDAQ100_UNIVERSE_NAME,
        snapshot_id=NASDAQ100_UNIVERSE_SNAPSHOT_ID,
        source_page_title=NASDAQ100_SOURCE_PAGE_TITLE,
        minimum_member_count=3,
    )
    provider = WikipediaRevisionUniverseHistoryProvider(
        definition=definition,
        official_provider=NasdaqAnnouncementUniverseProvider(definition=definition, retries=1, timeout=1),
        fallback_provider=StaticNasdaq100UniverseHistoryProvider(raw_symbols=["AAPL", "MSFT", "NVDA"]),
        retries=1,
        timeout=1,
    )

    def fake_historical(anchor: date) -> UniverseMembershipSnapshot:
        raise RuntimeError("historical revision missing")

    def fake_current(anchor: date, historical_message: str) -> UniverseMembershipSnapshot:
        return _current_page_snapshot(
            definition=definition,
            effective_date=anchor,
            symbols=["AAPL", "MSFT", "NVDA"],
            source=provider.current_page_source_name,
            fallback_source=provider.provider_name,
        )

    def fake_secondary(*args, **kwargs):  # noqa: ANN001
        raise AssertionError("secondary fallback should not be reached in this test")

    monkeypatch.setattr(provider, "_load_historical_snapshot", fake_historical)
    monkeypatch.setattr(provider, "_load_current_page_snapshot", fake_current)
    monkeypatch.setattr(provider, "_load_secondary_current_page_snapshot", fake_secondary)

    def fake_urlopen(request, timeout=0):
        raise urllib.error.URLError("official archive unavailable")

    monkeypatch.setattr(universe_history_module.urllib.request, "urlopen", fake_urlopen)

    snapshots = provider.load_snapshots(start_date=date(2025, 1, 1), end_date=date(2025, 7, 1))

    assert len(snapshots) == 2
    assert all(snapshot.source == provider.current_page_source_name for snapshot in snapshots)
    assert all(snapshot.fallback_source == provider.provider_name for snapshot in snapshots)
    assert all(snapshot.metadata["source_quality"] == SOURCE_QUALITY_CURRENT_PAGE_FALLBACK for snapshot in snapshots)


def test_nasdaq_curated_dataset_reconstructs_year_anchor_memberships(monkeypatch):
    definition = UniverseDefinition(
        universe_key=NASDAQ100_UNIVERSE_KEY,
        display_name=NASDAQ100_UNIVERSE_NAME,
        snapshot_id=NASDAQ100_UNIVERSE_SNAPSHOT_ID,
        source_page_title=NASDAQ100_SOURCE_PAGE_TITLE,
        minimum_member_count=3,
    )
    fallback_provider = WikipediaRevisionUniverseHistoryProvider(
        definition=definition,
        official_provider=NasdaqAnnouncementUniverseProvider(definition=definition, retries=1, timeout=1),
        fallback_provider=StaticNasdaq100UniverseHistoryProvider(raw_symbols=["AAPL", "MSFT", "NVDA"]),
        retries=1,
        timeout=1,
    )
    provider = CuratedNasdaq100UniverseHistoryProvider(
        definition=definition,
        fallback_provider=fallback_provider,
        first_year=2015,
        retries=1,
        timeout=1,
    )

    yaml_2024 = """
---
year: 2024
tickers_on_Jan_1:
  - AAPL
  - MSFT
  - SPLK
changes:
  '2024-03-18':
    difference:
      - SPLK
    union:
      - LIN
  '2024-11-18':
    difference:
      - MSFT
    union:
      - APP
"""

    monkeypatch.setattr(
        provider,
        "_fetch_text",
        lambda url: yaml_2024,
    )

    snapshots = provider.load_snapshots(start_date=date(2024, 1, 1), end_date=date(2024, 7, 1))

    assert len(snapshots) == 2
    january_snapshot, july_snapshot = snapshots
    assert january_snapshot.source == provider.provider_name
    assert january_snapshot.metadata["source_quality"] == "historical_dataset"
    assert january_snapshot.normalized_symbols == ["AAPL", "MSFT", "SPLK"]
    assert july_snapshot.normalized_symbols == ["AAPL", "MSFT", "LIN"]
    assert july_snapshot.metadata["historical_dataset_provider"] == "jmccarrell_n100tickers"


def test_nasdaq_curated_dataset_falls_back_before_supported_year(monkeypatch):
    definition = UniverseDefinition(
        universe_key=NASDAQ100_UNIVERSE_KEY,
        display_name=NASDAQ100_UNIVERSE_NAME,
        snapshot_id=NASDAQ100_UNIVERSE_SNAPSHOT_ID,
        source_page_title=NASDAQ100_SOURCE_PAGE_TITLE,
        minimum_member_count=3,
    )
    fallback_provider = WikipediaRevisionUniverseHistoryProvider(
        definition=definition,
        fallback_provider=StaticNasdaq100UniverseHistoryProvider(raw_symbols=["AAPL", "MSFT", "NVDA"]),
        retries=1,
        timeout=1,
    )
    provider = CuratedNasdaq100UniverseHistoryProvider(
        definition=definition,
        fallback_provider=fallback_provider,
        first_year=2015,
        retries=1,
        timeout=1,
    )

    def fake_historical(anchor: date) -> UniverseMembershipSnapshot:
        return _baseline_snapshot(
            definition=definition,
            effective_date=anchor,
            symbols=["AAPL", "MSFT", "NVDA", "AMZN"],
            source=fallback_provider.provider_name,
        )

    monkeypatch.setattr(fallback_provider, "_load_historical_snapshot", fake_historical)
    monkeypatch.setattr(
        fallback_provider,
        "_load_current_page_snapshot",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("current page fallback should not be used")),
    )
    monkeypatch.setattr(
        fallback_provider,
        "_load_secondary_current_page_snapshot",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("secondary fallback should not be used")),
    )

    snapshots = provider.load_snapshots(start_date=date(2014, 1, 1), end_date=date(2014, 7, 1))

    assert len(snapshots) == 2
    assert all(snapshot.source == fallback_provider.provider_name for snapshot in snapshots)
    assert all(snapshot.metadata["source_quality"] == SOURCE_QUALITY_WIKIPEDIA_REVISION for snapshot in snapshots)


def test_extract_symbols_from_html_supports_legacy_nasdaq_components_list():
    html = """
        <div class="mw-content-ltr mw-parser-output">
          <div class="mw-heading mw-heading2"><h2 id="Components">Components</h2></div>
          <p><i>This list is current as of December, 2005.</i></p>
          <ul>
            <li>Adobe Systems Incorporated (ADBE)</li>
            <li>Amazon.com, Inc. (AMZN)</li>
            <li>Apple Computer, Inc. (AAPL)</li>
          </ul>
        </div>
    """

    extracted = extract_symbols_from_html(html, minimum_member_count=3)

    assert extracted.headers == ["Company", "Symbol"]
    assert extracted.table_index == -1
    assert extracted.normalized_symbols == ["ADBE", "AMZN", "AAPL"]


def test_extract_symbols_from_html_supports_legacy_nasdaq_main_section_list():
    html = """
        <div class="mw-content-ltr mw-parser-output">
          <div class="mw-heading mw-heading2"><h2 id="NASDAQ-100">NASDAQ-100</h2></div>
          <p><i>Listed alphabetically with stock symbol.</i></p>
          <ul>
            <li>Adobe Systems Incorporated (ADBE)</li>
            <li>Amazon.com, Inc. (AMZN)</li>
            <li>Apple Computer, Inc. (AAPL)</li>
          </ul>
        </div>
    """

    extracted = extract_symbols_from_html(html, minimum_member_count=3)

    assert extracted.table_index == -1
    assert extracted.normalized_symbols == ["ADBE", "AMZN", "AAPL"]


def test_nasdaq_wikipedia_changes_backfill_uses_curated_2015_baseline(monkeypatch):
    definition = UniverseDefinition(
        universe_key=NASDAQ100_UNIVERSE_KEY,
        display_name=NASDAQ100_UNIVERSE_NAME,
        snapshot_id=NASDAQ100_UNIVERSE_SNAPSHOT_ID,
        source_page_title=NASDAQ100_SOURCE_PAGE_TITLE,
        minimum_member_count=3,
    )
    fallback_provider = WikipediaRevisionUniverseHistoryProvider(
        definition=definition,
        official_provider=NasdaqAnnouncementUniverseProvider(definition=definition, retries=1, timeout=1),
        fallback_provider=StaticNasdaq100UniverseHistoryProvider(raw_symbols=["AAPL", "MSFT", "NVDA"]),
        retries=1,
        timeout=1,
    )
    historical_dataset_provider = WikipediaNasdaq100ChangesUniverseHistoryProvider(
        definition=definition,
        retries=1,
        timeout=1,
    )
    provider = CuratedNasdaq100UniverseHistoryProvider(
        definition=definition,
        fallback_provider=fallback_provider,
        historical_dataset_provider=historical_dataset_provider,
        first_year=2015,
        retries=1,
        timeout=1,
    )

    def fake_historical(anchor: date) -> UniverseMembershipSnapshot:
        if anchor == date(2015, 1, 1):
            return _baseline_snapshot(
                definition=definition,
                effective_date=anchor,
                symbols=["AAPL", "MSFT", "TSLA", "AVGO"],
                source=fallback_provider.provider_name,
            )
        raise RuntimeError("historical revision missing")

    def fake_current(anchor: date, historical_message: str):  # noqa: ANN001
        return _current_page_snapshot(
            definition=definition,
            effective_date=anchor,
            symbols=["AAPL", "MSFT", "TSLA", "AVGO"],
            source=fallback_provider.current_page_source_name,
            fallback_source=fallback_provider.provider_name,
        )

    monkeypatch.setattr(fallback_provider, "_load_historical_snapshot", fake_historical)
    monkeypatch.setattr(fallback_provider, "_load_current_page_snapshot", fake_current)
    monkeypatch.setattr(
        fallback_provider,
        "_load_secondary_current_page_snapshot",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("secondary fallback should not be used")),
    )
    monkeypatch.setattr(
        provider,
        "_fetch_text",
        lambda url: """
---
year: 2015
tickers_on_Jan_1:
  - AAPL
  - MSFT
  - TSLA
  - AVGO
changes:
  '2015-03-16':
    difference:
      - TSLA
    union:
      - NVDA
""",
    )
    monkeypatch.setattr(
        historical_dataset_provider,
        "_load_change_events",
        lambda: [
            universe_history_module.Nasdaq100ConstituentChangeEvent(
                effective_date=date(2014, 6, 16),
                additions=["TSLA"],
                removals=["NVDA"],
                source_row=["June 16, 2014", "TSLA", "Tesla", "NVDA", "NVIDIA", "Index update"],
            ),
            universe_history_module.Nasdaq100ConstituentChangeEvent(
                effective_date=date(2014, 12, 15),
                additions=["AVGO"],
                removals=["ORCL"],
                source_row=["December 15, 2014", "AVGO", "Broadcom", "ORCL", "Oracle", "Annual reconstitution"],
            ),
            universe_history_module.Nasdaq100ConstituentChangeEvent(
                effective_date=date(2014, 3, 17),
                additions=["TSLA"],
                removals=["NVDA"],
                source_row=["March 17, 2014", "TSLA", "Tesla", "NVDA", "NVIDIA", "Index update"],
            ),
        ],
    )

    snapshots = provider.load_snapshots(start_date=date(2014, 1, 1), end_date=date(2014, 7, 1))

    assert len(snapshots) == 2
    january_snapshot, july_snapshot = snapshots
    assert january_snapshot.effective_date == date(2014, 1, 1)
    assert january_snapshot.source == fallback_provider.current_page_source_name
    assert january_snapshot.fallback_source == fallback_provider.provider_name
    assert july_snapshot.effective_date == date(2014, 7, 1)
    assert july_snapshot.source == "wikipedia_nasdaq100_changes_table"
    assert july_snapshot.metadata["source_quality"] == SOURCE_QUALITY_HISTORICAL_DATASET
    assert july_snapshot.metadata["historical_dataset_provider"] == "wikipedia_nasdaq100_changes_table"
    assert july_snapshot.metadata["historical_dataset_baseline_anchor"] == "2015-01-01"
    assert "TSLA" in july_snapshot.normalized_symbols
    assert "NVDA" not in july_snapshot.normalized_symbols
    assert "ORCL" in july_snapshot.normalized_symbols
    assert "AVGO" not in july_snapshot.normalized_symbols


def test_nasdaq_wikipedia_changes_backfill_extends_window_to_2015_baseline(monkeypatch):
    definition = UniverseDefinition(
        universe_key=NASDAQ100_UNIVERSE_KEY,
        display_name=NASDAQ100_UNIVERSE_NAME,
        snapshot_id=NASDAQ100_UNIVERSE_SNAPSHOT_ID,
        source_page_title=NASDAQ100_SOURCE_PAGE_TITLE,
        minimum_member_count=3,
    )
    fallback_provider = WikipediaRevisionUniverseHistoryProvider(
        definition=definition,
        official_provider=NasdaqAnnouncementUniverseProvider(definition=definition, retries=1, timeout=1),
        fallback_provider=StaticNasdaq100UniverseHistoryProvider(raw_symbols=["AAPL", "MSFT", "NVDA"]),
        retries=1,
        timeout=1,
    )
    historical_dataset_provider = WikipediaNasdaq100ChangesUniverseHistoryProvider(
        definition=definition,
        retries=1,
        timeout=1,
    )
    provider = CuratedNasdaq100UniverseHistoryProvider(
        definition=definition,
        fallback_provider=fallback_provider,
        historical_dataset_provider=historical_dataset_provider,
        first_year=2015,
        retries=1,
        timeout=1,
    )

    requested: list[date] = []

    def fake_historical(anchor: date) -> UniverseMembershipSnapshot:
        requested.append(anchor)
        if anchor == date(2015, 1, 1):
            return _baseline_snapshot(
                definition=definition,
                effective_date=anchor,
                symbols=["AAPL", "MSFT", "TSLA", "AVGO"],
                source=fallback_provider.provider_name,
            )
        raise RuntimeError("historical revision missing")

    def fake_current(anchor: date, historical_message: str):  # noqa: ANN001
        return _current_page_snapshot(
            definition=definition,
            effective_date=anchor,
            symbols=["AAPL", "MSFT", "TSLA", "AVGO"],
            source=fallback_provider.current_page_source_name,
            fallback_source=fallback_provider.provider_name,
        )

    monkeypatch.setattr(fallback_provider, "_load_historical_snapshot", fake_historical)
    monkeypatch.setattr(fallback_provider, "_load_current_page_snapshot", fake_current)
    monkeypatch.setattr(
        fallback_provider,
        "_load_secondary_current_page_snapshot",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("secondary fallback should not be used")),
    )
    monkeypatch.setattr(
        provider,
        "_fetch_text",
        lambda url: """
---
year: 2015
tickers_on_Jan_1:
  - AAPL
  - MSFT
  - TSLA
  - AVGO
changes: {}
""",
    )
    monkeypatch.setattr(
        historical_dataset_provider,
        "_load_change_events",
        lambda: [
            universe_history_module.Nasdaq100ConstituentChangeEvent(
                effective_date=date(2014, 6, 16),
                additions=["TSLA"],
                removals=["NVDA"],
                source_row=["June 16, 2014", "TSLA", "Tesla", "NVDA", "NVIDIA", "Index update"],
            ),
            universe_history_module.Nasdaq100ConstituentChangeEvent(
                effective_date=date(2014, 12, 15),
                additions=["AVGO"],
                removals=["ORCL"],
                source_row=["December 15, 2014", "AVGO", "Broadcom", "ORCL", "Oracle", "Annual reconstitution"],
            ),
        ],
    )

    snapshots = provider.load_snapshots(start_date=date(2014, 7, 1), end_date=date(2014, 7, 1))

    assert requested == [date(2014, 7, 1), date(2015, 1, 1)]
    assert len(snapshots) == 1
    snapshot = snapshots[0]
    assert snapshot.effective_date == date(2014, 7, 1)
    assert snapshot.source == "wikipedia_nasdaq100_changes_table"
    assert snapshot.metadata["historical_dataset_baseline_anchor"] == "2015-01-01"


def test_archived_nasdaq_snapshot_backfills_remaining_fallback_anchor(monkeypatch):
    definition = UniverseDefinition(
        universe_key=NASDAQ100_UNIVERSE_KEY,
        display_name=NASDAQ100_UNIVERSE_NAME,
        snapshot_id=NASDAQ100_UNIVERSE_SNAPSHOT_ID,
        source_page_title=NASDAQ100_SOURCE_PAGE_TITLE,
        minimum_member_count=3,
    )
    provider = ArchivedNasdaq100UniverseHistoryProvider(
        definition=definition,
        candidate_urls=("https://en.wikipedia.org/wiki/NASDAQ-100",),
        retries=1,
        timeout=1,
    )
    anchor = date(2003, 7, 1)
    original_snapshot = _current_page_snapshot(
        definition=definition,
        effective_date=anchor,
        symbols=["AAPL", "MSFT", "NVDA"],
        source="wikipedia_current_page",
        fallback_source="wikipedia_revision_history",
    )

    cdx_payload = json.dumps(
        [
            ["timestamp", "original", "statuscode", "mimetype"],
            ["20030615120000", "https://en.wikipedia.org/wiki/NASDAQ-100", "200", "text/html"],
        ]
    )
    archive_html = """
        <div class="mw-content-ltr mw-parser-output">
          <div class="mw-heading mw-heading2"><h2 id="NASDAQ-100">NASDAQ-100</h2></div>
          <ul>
            <li>Adobe Systems Incorporated (ADBE)</li>
            <li>Amazon.com, Inc. (AMZN)</li>
            <li>Apple Computer, Inc. (AAPL)</li>
          </ul>
        </div>
    """

    def fake_fetch_text(url: str) -> str:
        if "cdx/search/cdx" in url:
            return cdx_payload
        if "web/20030615120000id_" in url:
            return archive_html
        raise AssertionError(f"Unexpected URL {url}")

    monkeypatch.setattr(provider, "_fetch_text", fake_fetch_text)

    updated = provider.enrich_snapshots([original_snapshot])

    assert len(updated) == 1
    snapshot = updated[0]
    assert snapshot.source == provider.provider_name
    assert snapshot.fallback_source is None
    assert snapshot.metadata["source_quality"] == SOURCE_QUALITY_HISTORICAL_DATASET
    assert snapshot.metadata["anchor_mode"] == "archived_snapshot_backfill"
    assert snapshot.metadata["archived_snapshot_timestamp"] == "20030615120000"
    assert snapshot.metadata["replaced_source_quality"] == SOURCE_QUALITY_CURRENT_PAGE_FALLBACK
    assert snapshot.normalized_symbols == ["ADBE", "AMZN", "AAPL"]


def test_archived_nasdaq_snapshot_gracefully_keeps_fallback_when_archive_is_too_small(monkeypatch):
    definition = UniverseDefinition(
        universe_key=NASDAQ100_UNIVERSE_KEY,
        display_name=NASDAQ100_UNIVERSE_NAME,
        snapshot_id=NASDAQ100_UNIVERSE_SNAPSHOT_ID,
        source_page_title=NASDAQ100_SOURCE_PAGE_TITLE,
        minimum_member_count=3,
    )
    provider = ArchivedNasdaq100UniverseHistoryProvider(
        definition=definition,
        candidate_urls=("https://en.wikipedia.org/wiki/NASDAQ-100",),
        retries=1,
        timeout=1,
    )
    anchor = date(2003, 1, 1)
    original_snapshot = _current_page_snapshot(
        definition=definition,
        effective_date=anchor,
        symbols=["AAPL", "MSFT", "NVDA"],
        source="wikipedia_current_page",
        fallback_source="wikipedia_revision_history",
    )

    cdx_payload = json.dumps(
        [
            ["timestamp", "original", "statuscode", "mimetype"],
            ["20021231120000", "https://en.wikipedia.org/wiki/NASDAQ-100", "200", "text/html"],
        ]
    )
    archive_html = """
        <div class="mw-content-ltr mw-parser-output">
          <div class="mw-heading mw-heading2"><h2 id="NASDAQ-100">NASDAQ-100</h2></div>
          <ul>
            <li>Adobe Systems Incorporated (ADBE)</li>
            <li>Amazon.com, Inc. (AMZN)</li>
          </ul>
        </div>
    """

    def fake_fetch_text(url: str) -> str:
        if "cdx/search/cdx" in url:
            return cdx_payload
        if "web/20021231120000id_" in url:
            return archive_html
        raise AssertionError(f"Unexpected URL {url}")

    monkeypatch.setattr(provider, "_fetch_text", fake_fetch_text)

    updated = provider.enrich_snapshots([original_snapshot])

    assert updated == [original_snapshot]


def test_sp500_github_current_dataset_only_used_after_current_page_failure(monkeypatch):
    definition = UniverseDefinition(
        universe_key=SP500_UNIVERSE_KEY,
        display_name=SP500_UNIVERSE_NAME,
        snapshot_id=SP500_UNIVERSE_SNAPSHOT_ID,
        source_page_title=SP500_SOURCE_PAGE_TITLE,
        minimum_member_count=3,
    )
    current_validation_provider = GithubSp500CurrentValidationProvider(
        definition=definition,
        retries=1,
        timeout=1,
    )
    provider = WikipediaRevisionUniverseHistoryProvider(
        definition=definition,
        current_validation_provider=current_validation_provider,
        fallback_provider=StaticSp500UniverseHistoryProvider(raw_symbols=["AAPL", "MSFT", "NVDA"]),
        retries=1,
        timeout=1,
    )

    def fake_historical(anchor: date) -> UniverseMembershipSnapshot:
        raise RuntimeError("historical revision missing")

    monkeypatch.setattr(provider, "_load_historical_snapshot", fake_historical)
    monkeypatch.setattr(
        provider,
        "_load_current_page_snapshot",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("current page unavailable")),
    )
    monkeypatch.setattr(
        provider,
        "_load_secondary_current_page_snapshot",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("secondary fallback should not be used")),
    )
    monkeypatch.setattr(
        current_validation_provider,
        "_fetch_text",
        lambda: "Symbol,Security\nAAPL,Apple Inc.\nMSFT,Microsoft Corp.\nNVDA,NVIDIA Corp.\n",
    )

    snapshots = provider.load_snapshots(start_date=date(2026, 1, 1), end_date=date(2026, 1, 1))

    assert len(snapshots) == 1
    snapshot = snapshots[0]
    assert snapshot.source == "github_sp500_current_dataset"
    assert snapshot.fallback_source == provider.provider_name
    assert snapshot.metadata["source_quality"] == SOURCE_QUALITY_CURRENT_PAGE_FALLBACK


def test_sp500_wikipedia_changes_backfills_legacy_anchors_before_revision_history(monkeypatch):
    definition = UniverseDefinition(
        universe_key=SP500_UNIVERSE_KEY,
        display_name=SP500_UNIVERSE_NAME,
        snapshot_id=SP500_UNIVERSE_SNAPSHOT_ID,
        source_page_title=SP500_SOURCE_PAGE_TITLE,
        minimum_member_count=3,
    )
    historical_dataset_provider = WikipediaSp500ChangesUniverseHistoryProvider(
        definition=definition,
        retries=1,
        timeout=1,
    )
    provider = WikipediaRevisionUniverseHistoryProvider(
        definition=definition,
        historical_dataset_provider=historical_dataset_provider,
        fallback_provider=StaticSp500UniverseHistoryProvider(raw_symbols=["AAPL", "MSFT", "NVDA"]),
        retries=1,
        timeout=1,
    )

    def fake_historical(anchor: date) -> UniverseMembershipSnapshot:
        if anchor == date(2007, 7, 1):
            return _baseline_snapshot(
                definition=definition,
                effective_date=anchor,
                symbols=["AAPL", "MSFT", "GOOG"],
                source=provider.provider_name,
            )
        raise RuntimeError("historical revision missing")

    def fake_current(anchor: date, historical_message: str):  # noqa: ANN001
        return _current_page_snapshot(
            definition=definition,
            effective_date=anchor,
            symbols=["AAPL", "MSFT", "GOOG"],
            source=provider.current_page_source_name,
            fallback_source=provider.provider_name,
        )

    monkeypatch.setattr(provider, "_load_historical_snapshot", fake_historical)
    monkeypatch.setattr(provider, "_load_current_page_snapshot", fake_current)
    monkeypatch.setattr(
        historical_dataset_provider,
        "_load_change_events",
        lambda: [
            universe_history_module.Sp500ConstituentChangeEvent(
                effective_date=date(2006, 1, 10),
                additions=["IBM"],
                removals=["HPQ"],
                source_row=["January 10, 2006", "IBM", "IBM", "HPQ", "HP", "Market capitalization change"],
            ),
            universe_history_module.Sp500ConstituentChangeEvent(
                effective_date=date(2007, 3, 15),
                additions=["GOOG"],
                removals=["ORCL"],
                source_row=["March 15, 2007", "GOOG", "Google", "ORCL", "Oracle", "Market capitalization change"],
            )
        ],
    )

    snapshots = provider.load_snapshots(start_date=date(2007, 1, 1), end_date=date(2007, 7, 1))

    assert len(snapshots) == 2
    legacy_snapshot, revision_snapshot = snapshots
    assert legacy_snapshot.effective_date == date(2007, 1, 1)
    assert legacy_snapshot.source == "wikipedia_sp500_changes_table"
    assert legacy_snapshot.fallback_source is None
    assert legacy_snapshot.metadata["source_quality"] == SOURCE_QUALITY_HISTORICAL_DATASET
    assert legacy_snapshot.metadata["historical_dataset_provider"] == "wikipedia_sp500_changes_table"
    assert legacy_snapshot.metadata["historical_dataset_baseline_anchor"] == "2007-07-01"
    assert "ORCL" in legacy_snapshot.normalized_symbols
    assert "GOOG" not in legacy_snapshot.normalized_symbols
    assert revision_snapshot.source == provider.provider_name
    assert revision_snapshot.metadata["source_quality"] == SOURCE_QUALITY_WIKIPEDIA_REVISION


def test_sp500_wikipedia_changes_backfill_uses_next_anchor_outside_requested_window(monkeypatch):
    definition = UniverseDefinition(
        universe_key=SP500_UNIVERSE_KEY,
        display_name=SP500_UNIVERSE_NAME,
        snapshot_id=SP500_UNIVERSE_SNAPSHOT_ID,
        source_page_title=SP500_SOURCE_PAGE_TITLE,
        minimum_member_count=3,
    )
    historical_dataset_provider = WikipediaSp500ChangesUniverseHistoryProvider(
        definition=definition,
        retries=1,
        timeout=1,
    )
    provider = WikipediaRevisionUniverseHistoryProvider(
        definition=definition,
        historical_dataset_provider=historical_dataset_provider,
        fallback_provider=StaticSp500UniverseHistoryProvider(raw_symbols=["AAPL", "MSFT", "NVDA"]),
        retries=1,
        timeout=1,
    )

    requested: list[date] = []

    def fake_historical(anchor: date) -> UniverseMembershipSnapshot:
        requested.append(anchor)
        if anchor == date(2007, 7, 1):
            return _baseline_snapshot(
                definition=definition,
                effective_date=anchor,
                symbols=["AAPL", "MSFT", "GOOG"],
                source=provider.provider_name,
            )
        raise RuntimeError("historical revision missing")

    def fake_current(anchor: date, historical_message: str):  # noqa: ANN001
        return _current_page_snapshot(
            definition=definition,
            effective_date=anchor,
            symbols=["AAPL", "MSFT", "GOOG"],
            source=provider.current_page_source_name,
            fallback_source=provider.provider_name,
        )

    monkeypatch.setattr(provider, "_load_historical_snapshot", fake_historical)
    monkeypatch.setattr(provider, "_load_current_page_snapshot", fake_current)
    monkeypatch.setattr(
        historical_dataset_provider,
        "_load_change_events",
        lambda: [
            universe_history_module.Sp500ConstituentChangeEvent(
                effective_date=date(2006, 1, 10),
                additions=["IBM"],
                removals=["HPQ"],
                source_row=["January 10, 2006", "IBM", "IBM", "HPQ", "HP", "Market capitalization change"],
            ),
            universe_history_module.Sp500ConstituentChangeEvent(
                effective_date=date(2007, 3, 15),
                additions=["GOOG"],
                removals=["ORCL"],
                source_row=["March 15, 2007", "GOOG", "Google", "ORCL", "Oracle", "Market capitalization change"],
            ),
        ],
    )

    snapshots = provider.load_snapshots(start_date=date(2007, 1, 1), end_date=date(2007, 1, 1))

    assert requested == [date(2007, 1, 1), date(2007, 7, 1)]
    assert len(snapshots) == 1
    legacy_snapshot = snapshots[0]
    assert legacy_snapshot.effective_date == date(2007, 1, 1)
    assert legacy_snapshot.source == "wikipedia_sp500_changes_table"
    assert legacy_snapshot.metadata["historical_dataset_baseline_anchor"] == "2007-07-01"
    assert "ORCL" in legacy_snapshot.normalized_symbols
    assert "GOOG" not in legacy_snapshot.normalized_symbols


def test_extract_symbols_from_nasdaq_activity_html_parses_official_table():
    html = """
        <html>
          <body>
            <table>
              <tr><td>Apple</td><td><a href="/asp/quote.asp?symbol=AAPL&selected=AAPL">AAPL</a></td></tr>
              <tr><td>Microsoft</td><td><a href="/asp/quote.asp?symbol=MSFT&selected=MSFT">MSFT</a></td></tr>
              <tr><td>NVIDIA</td><td><a href="/asp/quote.asp?symbol=NVDA&selected=NVDA">NVDA</a></td></tr>
            </table>
          </body>
        </html>
    """

    extracted = extract_symbols_from_nasdaq_activity_html(html, minimum_member_count=3)

    assert extracted.normalized_symbols == ["AAPL", "MSFT", "NVDA"]
    assert extracted.raw_symbols == ["AAPL", "MSFT", "NVDA"]


def test_local_nasdaq100_seed_provider_replaces_fallback_anchor_when_provenance_complete(tmp_path):
    definition = UniverseDefinition(
        universe_key=NASDAQ100_UNIVERSE_KEY,
        display_name=NASDAQ100_UNIVERSE_NAME,
        snapshot_id=NASDAQ100_UNIVERSE_SNAPSHOT_ID,
        source_page_title=NASDAQ100_SOURCE_PAGE_TITLE,
        minimum_member_count=3,
    )
    seed_path = tmp_path / "nasdaq100-seed.json"
    seed_path.write_text(
        json.dumps(
            {
                "anchors": [
                    {
                        "effective_date": "1996-01-01",
                        "published_date": "1995-12-29",
                        "source_urls": ["https://example.com/official-1995-year-end"],
                        "provenance": "official_year_end_roster",
                        "symbols": ["AAPL", "MSFT", "ORCL"],
                        "additions": ["AAPL"],
                        "removals": ["OLD1"],
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    provider = LocalNasdaq100SeedUniverseHistoryProvider(definition=definition, seed_path=seed_path)
    original_snapshot = _current_page_snapshot(
        definition=definition,
        effective_date=date(1996, 1, 1),
        symbols=["QQQ", "MSFT", "ORCL"],
        source="wikipedia_current_page",
        fallback_source="wikipedia_revision_history",
    )

    updated = provider.enrich_snapshots([original_snapshot])

    assert len(updated) == 1
    assert updated[0].source == provider.provider_name
    assert updated[0].fallback_source is None
    assert updated[0].metadata["source_quality"] == SOURCE_QUALITY_HISTORICAL_DATASET
    assert updated[0].metadata["official_seed_status"] == "seeded"
    assert updated[0].metadata["official_seed_source_urls"] == [
        "https://example.com/official-1995-year-end"
    ]


def test_local_nasdaq100_seed_provider_skips_entries_without_provenance(tmp_path):
    definition = UniverseDefinition(
        universe_key=NASDAQ100_UNIVERSE_KEY,
        display_name=NASDAQ100_UNIVERSE_NAME,
        snapshot_id=NASDAQ100_UNIVERSE_SNAPSHOT_ID,
        source_page_title=NASDAQ100_SOURCE_PAGE_TITLE,
        minimum_member_count=3,
    )
    seed_path = tmp_path / "nasdaq100-seed-invalid.json"
    seed_path.write_text(
        json.dumps(
            {
                "anchors": [
                    {
                        "effective_date": "1996-01-01",
                        "published_date": "1995-12-29",
                        "source_urls": ["https://example.com/official-1995-year-end"],
                        "symbols": ["AAPL", "MSFT", "ORCL"],
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    provider = LocalNasdaq100SeedUniverseHistoryProvider(definition=definition, seed_path=seed_path)
    original_snapshot = _current_page_snapshot(
        definition=definition,
        effective_date=date(1996, 1, 1),
        symbols=["QQQ", "MSFT", "ORCL"],
        source="wikipedia_current_page",
        fallback_source="wikipedia_revision_history",
    )

    updated = provider.enrich_snapshots([original_snapshot])

    assert updated == [original_snapshot]


def test_archived_nasdaq_official_activity_provider_prefers_before_anchor_capture(monkeypatch):
    definition = UniverseDefinition(
        universe_key=NASDAQ100_UNIVERSE_KEY,
        display_name=NASDAQ100_UNIVERSE_NAME,
        snapshot_id=NASDAQ100_UNIVERSE_SNAPSHOT_ID,
        source_page_title=NASDAQ100_SOURCE_PAGE_TITLE,
        minimum_member_count=3,
    )
    provider = ArchivedNasdaqOfficialActivityUniverseHistoryProvider(
        definition=definition,
        archive_window_days=30,
        lookahead_window_days=30,
        retries=1,
        timeout=1,
    )
    cdx_payload = json.dumps(
        [
            ["timestamp", "original", "statuscode", "mimetype"],
            ["20260115120000", "http://dynamic.nasdaq.com/dynamic/nasdaq100_activity.stm", "200", "text/html"],
            ["20260122120000", "http://dynamic.nasdaq.com/dynamic/nasdaq100_activity.stm", "200", "text/html"],
        ]
    )
    archive_html = """
        <html>
          <body>
            <table>
              <tr><td>Apple</td><td><a href="/asp/quote.asp?symbol=AAPL&selected=AAPL">AAPL</a></td></tr>
              <tr><td>Microsoft</td><td><a href="/asp/quote.asp?symbol=MSFT&selected=MSFT">MSFT</a></td></tr>
              <tr><td>NVIDIA</td><td><a href="/asp/quote.asp?symbol=NVDA&selected=NVDA">NVDA</a></td></tr>
            </table>
          </body>
        </html>
    """

    def fake_fetch_text(url: str) -> str:
        if "cdx/search/cdx" in url:
            return cdx_payload
        if "web/20260115120000id_/" in url:
            return archive_html
        if "web/20260122120000id_/" in url:
            raise AssertionError("The provider should prefer the nearest capture before the anchor.")
        raise AssertionError(f"Unexpected URL {url}")

    monkeypatch.setattr(provider, "_fetch_text", fake_fetch_text)

    snapshot = provider._load_anchor_snapshot(date(2026, 1, 20))

    assert snapshot is not None
    assert snapshot.source == provider.provider_name
    assert snapshot.fallback_source is None
    assert snapshot.metadata["source_quality"] == SOURCE_QUALITY_HISTORICAL_DATASET
    assert snapshot.metadata["archived_snapshot_timestamp"] == "20260115120000"
    assert snapshot.metadata["official_seed_status"] == "seeded"


def test_sequential_universe_snapshot_enricher_preserves_seed_replacement():
    definition = UniverseDefinition(
        universe_key=NASDAQ100_UNIVERSE_KEY,
        display_name=NASDAQ100_UNIVERSE_NAME,
        snapshot_id=NASDAQ100_UNIVERSE_SNAPSHOT_ID,
        source_page_title=NASDAQ100_SOURCE_PAGE_TITLE,
        minimum_member_count=3,
    )
    original_snapshot = _current_page_snapshot(
        definition=definition,
        effective_date=date(1996, 1, 1),
        symbols=["QQQ", "MSFT", "ORCL"],
        source="wikipedia_current_page",
        fallback_source="wikipedia_revision_history",
    )

    class _SeedProvider:
        def enrich_snapshots(self, snapshots):
            current = snapshots[0]
            return [
                UniverseMembershipSnapshot(
                    universe_key=current.universe_key,
                    universe_name=current.universe_name,
                    effective_date=current.effective_date,
                    normalized_symbols=["AAPL", "MSFT", "ORCL"],
                    raw_symbols=["AAPL", "MSFT", "ORCL"],
                    unmapped_symbols=[],
                    source="local_seed",
                    fallback_source=None,
                    anchor_schedule=current.anchor_schedule,
                    source_revision_id="local-seed-1996-01-01",
                    source_page_title=current.source_page_title,
                    metadata={"source_quality": SOURCE_QUALITY_HISTORICAL_DATASET},
                )
            ]

    class _ArchiveProvider:
        def enrich_snapshots(self, snapshots):
            current = snapshots[0]
            if current.fallback_source:
                return [
                    UniverseMembershipSnapshot(
                        universe_key=current.universe_key,
                        universe_name=current.universe_name,
                        effective_date=current.effective_date,
                        normalized_symbols=["ARCHIVE1", "ARCHIVE2", "ARCHIVE3"],
                        raw_symbols=["ARCHIVE1", "ARCHIVE2", "ARCHIVE3"],
                        unmapped_symbols=[],
                        source="archive_override",
                        fallback_source=None,
                        anchor_schedule=current.anchor_schedule,
                        source_revision_id="archive-1996-01-01",
                        source_page_title=current.source_page_title,
                        metadata={"source_quality": SOURCE_QUALITY_HISTORICAL_DATASET},
                    )
                ]
            return snapshots

    updated = SequentialUniverseSnapshotEnricher(_SeedProvider(), _ArchiveProvider()).enrich_snapshots(
        [original_snapshot]
    )

    assert updated[0].source == "local_seed"
    assert updated[0].normalized_symbols == ["AAPL", "MSFT", "ORCL"]

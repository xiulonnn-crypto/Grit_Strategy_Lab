from __future__ import annotations

import urllib.error
from datetime import date

import grit_backtest_platform.universe_history as universe_history_module
from grit_backtest_platform.universe_history import (
    ANCHOR_SCHEDULE,
    NASDAQ100_UNIVERSE_KEY,
    NASDAQ100_UNIVERSE_NAME,
    NASDAQ100_UNIVERSE_SNAPSHOT_ID,
    NASDAQ100_SOURCE_PAGE_TITLE,
    SP500_UNIVERSE_KEY,
    SP500_UNIVERSE_NAME,
    SP500_UNIVERSE_SNAPSHOT_ID,
    SP500_SOURCE_PAGE_TITLE,
    NasdaqAnnouncementUniverseProvider,
    SpGlobalAnnouncementUniverseProvider,
    StaticNasdaq100UniverseHistoryProvider,
    StaticSp500UniverseHistoryProvider,
    UniverseDefinition,
    UniverseMembershipSnapshot,
    WikipediaRevisionUniverseHistoryProvider,
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
            "source_quality": "historical_revision_snapshot",
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
            "source_quality": "current_page_fallback",
        },
    )


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
    assert first_snapshot.metadata["source_quality"] == "historical_revision_snapshot"
    assert second_snapshot.source == "nasdaq_official_annual_changes"
    assert second_snapshot.fallback_source is None
    assert second_snapshot.metadata["source_quality"] == "historical_revision_snapshot"
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
    assert first_snapshot.metadata["source_quality"] == "historical_revision_snapshot"
    assert second_snapshot.source == "sp_global_official_constituent_change"
    assert second_snapshot.fallback_source is None
    assert second_snapshot.metadata["source_quality"] == "historical_revision_snapshot"
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
    assert all(snapshot.metadata["source_quality"] == "current_page_fallback" for snapshot in snapshots)

from __future__ import annotations

import json
import urllib.error
from datetime import date

import pytest

from grit_backtest_platform.fmp_constituent_provider import (
    FmpHistoricalConstituentUniverseHistoryProvider,
    FMP_SP500_CURRENT_ENDPOINT,
    FMP_SP500_HISTORICAL_ENDPOINT,
)
from grit_backtest_platform.universe_history import (
    CuratedNasdaq100UniverseHistoryProvider,
    GithubSp500CurrentValidationProvider,
    SP500_UNIVERSE_KEY,
    SP500_UNIVERSE_NAME,
    SP500_UNIVERSE_SNAPSHOT_ID,
    SP500_SOURCE_PAGE_TITLE,
    SOURCE_QUALITY_CURRENT_PAGE_FALLBACK,
    SOURCE_QUALITY_HISTORICAL_DATASET,
    SOURCE_QUALITY_WIKIPEDIA_REVISION,
    StaticSp500UniverseHistoryProvider,
    UniverseDefinition,
    UniverseMembershipSnapshot,
    WikipediaRevisionUniverseHistoryProvider,
    WikipediaSp500ChangesUniverseHistoryProvider,
    default_universe_history_providers,
)


class _FallbackNeverUsed:
    provider_name = "wikipedia_revision_history"

    def load_snapshots(self, start_date: date, end_date: date):  # noqa: ANN001
        raise AssertionError("fallback should not be used on successful FMP loads")


def _snapshot(
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
        source_revision_id=f"{source}-{effective_date.isoformat()}",
        source_page_title=definition.source_page_title,
        metadata={
            "coverage_mode": "point_in_time_anchor",
            "source_quality": SOURCE_QUALITY_WIKIPEDIA_REVISION,
        },
    )


def _definition(minimum_member_count: int = 3) -> UniverseDefinition:
    return UniverseDefinition(
        universe_key=SP500_UNIVERSE_KEY,
        display_name=SP500_UNIVERSE_NAME,
        snapshot_id=SP500_UNIVERSE_SNAPSHOT_ID,
        source_page_title=SP500_SOURCE_PAGE_TITLE,
        minimum_member_count=minimum_member_count,
    )


def test_fmp_historical_constituent_provider_reconstructs_semiannual_anchors(monkeypatch):
    definition = _definition()
    provider = FmpHistoricalConstituentUniverseHistoryProvider(
        definition=definition,
        fallback_provider=_FallbackNeverUsed(),
        api_key="test-key",
    )

    current_payload = [
        {"symbol": "AAPL"},
        {"symbol": "NVDA"},
        {"symbol": "TSLA"},
    ]
    historical_payload = [
        {"date": "2025-03-15", "action": "deletion", "symbol": "MSFT"},
        {"date": "2025-05-01", "action": "addition", "symbol": "TSLA"},
    ]

    def fake_request_json(url: str):  # noqa: ANN001
        if url == FMP_SP500_CURRENT_ENDPOINT:
            return current_payload
        if url == FMP_SP500_HISTORICAL_ENDPOINT:
            return historical_payload
        raise AssertionError(f"Unexpected FMP url: {url}")

    monkeypatch.setattr(provider, "_request_json", fake_request_json)

    snapshots = provider.load_snapshots(start_date=date(2025, 1, 1), end_date=date(2025, 7, 1))

    assert len(snapshots) == 2
    first_snapshot, second_snapshot = snapshots
    assert first_snapshot.source == provider.provider_name
    assert first_snapshot.fallback_source is None
    assert first_snapshot.metadata["source_quality"] == SOURCE_QUALITY_HISTORICAL_DATASET
    assert first_snapshot.metadata["historical_constituent_provider"] == "fmp"
    assert first_snapshot.metadata["historical_constituent_current_count"] == 3
    assert first_snapshot.metadata["historical_constituent_change_count"] == 2
    assert first_snapshot.metadata["historical_constituent_mode"] == "current_plus_changes"
    assert first_snapshot.normalized_symbols == ["AAPL", "MSFT", "NVDA"]
    assert second_snapshot.normalized_symbols == ["AAPL", "NVDA", "TSLA"]
    assert second_snapshot.metadata["historical_constituent_provider"] == "fmp"


@pytest.mark.parametrize(
    ("failure_mode", "expected_probe_status"),
    [
        ("429", "rate_limited"),
        ("402", "entitlement_unavailable"),
        ("403", "legacy_endpoint_unavailable"),
        ("malformed", "malformed_payload"),
    ],
)
def test_fmp_provider_gracefully_falls_back_to_existing_universe_chain(
    monkeypatch, failure_mode, expected_probe_status
):
    definition = _definition()
    fallback_provider = WikipediaRevisionUniverseHistoryProvider(
        definition=definition,
        fallback_provider=StaticSp500UniverseHistoryProvider(raw_symbols=["AAPL", "MSFT", "NVDA"]),
    )
    provider = FmpHistoricalConstituentUniverseHistoryProvider(
        definition=definition,
        fallback_provider=fallback_provider,
        api_key="test-key",
    )

    def fake_historical(anchor: date) -> UniverseMembershipSnapshot:
        return _snapshot(
            definition=definition,
            effective_date=anchor,
            symbols=["AAPL", "MSFT", "NVDA", "AMZN"],
            source=fallback_provider.provider_name,
        )

    monkeypatch.setattr(fallback_provider, "_load_historical_snapshot", fake_historical)
    monkeypatch.setattr(
        fallback_provider,
        "_load_current_page_snapshot",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("current-page fallback should not be used")),
    )
    monkeypatch.setattr(
        fallback_provider,
        "_load_secondary_current_page_snapshot",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("secondary fallback should not be used")),
    )

    if failure_mode == "malformed":
        monkeypatch.setattr(
            provider,
            "_request_json",
            lambda url: [{"name": "broken"}],  # noqa: ANN001
        )
    else:
        def raise_runtime_error(url: str):  # noqa: ANN001
            if failure_mode == "429":
                raise RuntimeError("FMP historical constituent API rate limited (429).")
            if failure_mode == "402":
                raise RuntimeError("FMP historical constituent API entitlement unavailable (402).")
            raise RuntimeError("FMP historical constituent legacy endpoint unavailable (403).")

        monkeypatch.setattr(provider, "_request_json", raise_runtime_error)

    snapshots = provider.load_snapshots(start_date=date(2025, 1, 1), end_date=date(2025, 7, 1))

    assert len(snapshots) == 2
    assert all(snapshot.source == fallback_provider.provider_name for snapshot in snapshots)
    assert all(snapshot.fallback_source is None for snapshot in snapshots)
    assert all(snapshot.metadata["source_quality"] == SOURCE_QUALITY_WIKIPEDIA_REVISION for snapshot in snapshots)
    assert all(snapshot.metadata["historical_constituent_provider"] == "fmp" for snapshot in snapshots)
    assert all(snapshot.metadata["historical_constituent_probe_status"] == expected_probe_status for snapshot in snapshots)
    assert snapshots[0].normalized_symbols == ["AAPL", "MSFT", "NVDA", "AMZN"]


def test_fmp_provider_marks_unconfigured_probe_status_on_fallback(monkeypatch):
    definition = _definition()
    fallback_provider = WikipediaRevisionUniverseHistoryProvider(
        definition=definition,
        fallback_provider=StaticSp500UniverseHistoryProvider(raw_symbols=["AAPL", "MSFT", "NVDA"]),
    )
    provider = FmpHistoricalConstituentUniverseHistoryProvider(
        definition=definition,
        fallback_provider=fallback_provider,
        api_key=None,
    )

    def fake_historical(anchor: date) -> UniverseMembershipSnapshot:
        return _snapshot(
            definition=definition,
            effective_date=anchor,
            symbols=["AAPL", "MSFT", "NVDA", "AMZN"],
            source=fallback_provider.provider_name,
        )

    monkeypatch.setattr(fallback_provider, "_load_historical_snapshot", fake_historical)
    monkeypatch.setattr(
        fallback_provider,
        "_load_current_page_snapshot",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("current-page fallback should not be used")),
    )
    monkeypatch.setattr(
        fallback_provider,
        "_load_secondary_current_page_snapshot",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("secondary fallback should not be used")),
    )

    snapshots = provider.load_snapshots(start_date=date(2025, 1, 1), end_date=date(2025, 7, 1))

    assert len(snapshots) == 2
    assert all(snapshot.metadata["historical_constituent_provider"] == "fmp" for snapshot in snapshots)
    assert all(snapshot.metadata["historical_constituent_probe_status"] == "unconfigured" for snapshot in snapshots)


def test_default_universe_history_providers_use_fmp_wrappers():
    providers = default_universe_history_providers()

    assert [provider.provider_name for provider in providers] == [
        "fmp_historical_constituent",
        "fmp_historical_constituent",
    ]
    sp500_provider, nasdaq_provider = providers
    assert isinstance(sp500_provider.fallback_provider, WikipediaRevisionUniverseHistoryProvider)
    assert isinstance(
        sp500_provider.fallback_provider.historical_dataset_provider,
        WikipediaSp500ChangesUniverseHistoryProvider,
    )
    assert isinstance(sp500_provider.fallback_provider.current_validation_provider, GithubSp500CurrentValidationProvider)
    assert isinstance(nasdaq_provider.fallback_provider, CuratedNasdaq100UniverseHistoryProvider)

from __future__ import annotations

import json
import sqlite3
import urllib.error
import urllib.parse
from datetime import date
from pathlib import Path

from grit_backtest_platform.fallback_provider import UnconfiguredFallbackProvider
from grit_backtest_platform.market_data_repository import MarketDataRepository
from grit_backtest_platform.snapshot_recovery import import_snapshot_cold_backup, probe_lab2_snapshot_assets
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
    StaticSp500UniverseHistoryProvider,
    StaticNasdaq100UniverseHistoryProvider,
    UniverseDefinition,
    WikipediaRevisionUniverseHistoryProvider,
    collect_snapshot_symbols,
    static_universe_history_providers,
)
from grit_backtest_platform.yahoo_provider import YahooMarketDataProvider


def test_snapshot_schema_persists_snapshot_scoped_records(tmp_path):
    repository = MarketDataRepository(tmp_path / "market.sqlite3")

    repository.replace_dataset_snapshot(
        {
            "id": "ds-price",
            "name": "股票价格数据",
            "status": "READY",
            "as_of": "2026-04-01",
            "freshness_label": "Freshly refreshed",
            "start_date": "1996-01-01",
            "end_date": "2026-04-01",
            "row_count": 2,
            "source": "yahoo",
            "fallback_source": "fallback_unavailable",
            "metadata": {"provider_mode": "primary_with_explicit_fallback_gap"},
        },
        price_bars=[
            {
                "symbol": "AAPL",
                "date": "2026-03-31",
                "open": 200.0,
                "high": 202.0,
                "low": 198.0,
                "close": 201.5,
                "adj_close": 201.5,
                "volume": 1_000_000,
                "source": "yahoo",
                "fallback_source": "fallback_unavailable",
            },
            {
                "symbol": "AAPL",
                "date": "2026-04-01",
                "open": 201.5,
                "high": 203.0,
                "low": 200.0,
                "close": 202.5,
                "adj_close": 202.5,
                "volume": 1_100_000,
                "source": "yahoo",
                "fallback_source": "fallback_unavailable",
            },
        ],
        symbol_coverage=[
            {
                "symbol": "AAPL",
                "start_date": "1996-01-01",
                "end_date": "2026-04-01",
                "trade_days": 7560,
                "source": "yahoo",
                "fallback_source": "fallback_unavailable",
                "metadata": {"coverage_kind": "price_daily"},
            }
        ],
    )
    repository.replace_dataset_snapshot(
        {
            "id": "ds-corporate-actions",
            "name": "公司行为数据",
            "status": "INCOMPLETE",
            "as_of": "2026-04-01",
            "freshness_label": "Freshly refreshed",
            "start_date": "1996-01-01",
            "end_date": "2026-04-01",
            "row_count": 1,
            "source": "yahoo",
            "fallback_source": "fallback_unavailable",
            "blocker": {"code": "fallback_unavailable", "message": "Secondary source not configured."},
            "metadata": {"provider_mode": "partial_primary"},
        },
        corporate_actions=[
            {
                "symbol": "AAPL",
                "date": "2026-04-01",
                "action_type": "dividend",
                "value": 0.24,
                "source": "yahoo",
                "fallback_source": "fallback_unavailable",
                "payload": {"amount": 0.24},
            }
        ],
    )
    repository.replace_universe_snapshot(
        {
            "id": "un-sp500",
            "universe_key": SP500_UNIVERSE_KEY,
            "name": "标普500",
            "status": "INCOMPLETE",
            "as_of": "2026-04-01",
            "freshness_label": "Anchored 01-01/07-01",
            "window_start": "1996-01-01",
            "window_end": "2026-04-01",
            "anchor_schedule": ANCHOR_SCHEDULE,
            "member_count": 2,
            "source": "static_seed",
            "fallback_source": "fallback_unavailable",
            "metadata": {"coverage_mode": "point_in_time_anchor"},
        },
        memberships=[
            {"effective_date": "2026-01-01", "symbol": "AAPL", "source": "static_seed"},
            {"effective_date": "2026-07-01", "symbol": "MSFT", "source": "static_seed"},
        ],
    )
    repository.replace_universe_snapshot(
        {
            "id": "un-ndx100",
            "universe_key": NASDAQ100_UNIVERSE_KEY,
            "name": "纳指100",
            "status": "INCOMPLETE",
            "as_of": "2026-04-01",
            "freshness_label": "Anchored 01-01/07-01",
            "window_start": "1996-01-01",
            "window_end": "2026-04-01",
            "anchor_schedule": ANCHOR_SCHEDULE,
            "member_count": 2,
            "source": "static_seed",
            "fallback_source": "fallback_unavailable",
            "metadata": {"coverage_mode": "point_in_time_anchor"},
        },
        memberships=[
            {"effective_date": "2026-01-01", "symbol": "AAPL", "source": "static_seed"},
            {"effective_date": "2026-07-01", "symbol": "NVDA", "source": "static_seed"},
        ],
    )

    counts = repository.snapshot_table_counts()
    assert counts["dataset_snapshots"] == 2
    assert counts["universe_snapshots"] == 2
    assert counts["dataset_price_bars"] == 2
    assert counts["dataset_corporate_actions"] == 1
    assert counts["dataset_symbol_coverage"] == 1
    assert counts["universe_membership_snapshots"] == 4

    dataset_snapshots = repository.list_dataset_snapshots()
    universe_snapshots = repository.list_universe_snapshots()
    corporate_actions = repository.load_dataset_snapshot_rows("ds-corporate-actions")["corporate_actions"]
    sp500_memberships = repository.load_universe_memberships(universe_key=SP500_UNIVERSE_KEY)

    assert dataset_snapshots[0]["fallback_source"] == "fallback_unavailable"
    assert dataset_snapshots[0]["metadata"]["provider_mode"] in {
        "primary_with_explicit_fallback_gap",
        "partial_primary",
    }
    assert corporate_actions[0]["payload"] == {"amount": 0.24}
    assert universe_snapshots[0]["anchor_schedule"] == ANCHOR_SCHEDULE
    assert {row["effective_date"] for row in sp500_memberships} == {"2026-01-01", "2026-07-01"}


def test_universe_history_generates_point_in_time_anchors_for_sp500_and_nasdaq100():
    providers = static_universe_history_providers()
    all_snapshots = []
    for provider in providers:
        snapshots = provider.load_snapshots(start_date=date(2025, 1, 1), end_date=date(2026, 7, 1))
        all_snapshots.extend(snapshots)

    assert len(all_snapshots) == 8
    assert {snapshot.anchor_schedule for snapshot in all_snapshots} == {ANCHOR_SCHEDULE}
    assert {snapshot.effective_date.isoformat() for snapshot in all_snapshots} == {
        "2025-01-01",
        "2025-07-01",
        "2026-01-01",
        "2026-07-01",
    }
    assert {snapshot.universe_key for snapshot in all_snapshots} == {SP500_UNIVERSE_KEY, NASDAQ100_UNIVERSE_KEY}
    assert all(snapshot.metadata["coverage_mode"] == "point_in_time_anchor" for snapshot in all_snapshots)
    assert collect_snapshot_symbols(all_snapshots)


class _FakeHttpResponse:
    def __init__(self, payload: str) -> None:
        self.payload = payload.encode("utf-8")

    def read(self) -> bytes:
        return self.payload

    def __enter__(self) -> "_FakeHttpResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


def _constituents_html(header: str, symbols: list[str]) -> str:
    rows = "".join(f"<tr><td>{symbol}</td><td>Test Co</td></tr>" for symbol in symbols)
    return f"<table class='wikitable'><tr><th>{header}</th><th>Security</th></tr>{rows}</table>"


def test_wikipedia_revision_provider_parses_historical_anchor_tables(monkeypatch):
    provider = WikipediaRevisionUniverseHistoryProvider(
        definition=UniverseDefinition(
            universe_key=SP500_UNIVERSE_KEY,
            display_name=SP500_UNIVERSE_NAME,
            snapshot_id=SP500_UNIVERSE_SNAPSHOT_ID,
            source_page_title=SP500_SOURCE_PAGE_TITLE,
            minimum_member_count=3,
        ),
        fallback_provider=StaticSp500UniverseHistoryProvider(raw_symbols=["AAPL", "MSFT", "NVDA"]),
    )

    def fake_urlopen(request, timeout=0):
        query = urllib.parse.parse_qs(urllib.parse.urlparse(request.full_url).query)
        if query.get("action") == ["query"]:
            return _FakeHttpResponse(
                json.dumps(
                    {
                        "query": {
                            "pages": [
                                {
                                    "revisions": [
                                        {"revid": 123, "timestamp": "2025-01-02T00:00:00Z"},
                                    ]
                                }
                            ]
                        }
                    }
                )
            )
        if query.get("action") == ["parse"] and query.get("oldid") == ["123"]:
            return _FakeHttpResponse(
                json.dumps(
                    {
                        "parse": {
                            "text": _constituents_html("Symbol", ["BRK.B[1]", "BF.B*", "GOOGL?", "AAPL"])
                        }
                    }
                )
            )
        raise AssertionError(f"Unexpected wikipedia request: {request.full_url}")

    monkeypatch.setattr(universe_history_module.urllib.request, "urlopen", fake_urlopen)

    snapshots = provider.load_snapshots(start_date=date(2025, 1, 1), end_date=date(2025, 7, 1))

    assert len(snapshots) == 2
    assert all(snapshot.source == provider.provider_name for snapshot in snapshots)
    assert all(snapshot.fallback_source is None for snapshot in snapshots)
    assert all(snapshot.metadata["source_quality"] == "historical_revision_snapshot" for snapshot in snapshots)
    assert snapshots[0].normalized_symbols[:3] == ["BRK-B", "BF-B", "GOOGL"]


def test_wikipedia_revision_provider_falls_back_to_current_page_when_history_is_unavailable(monkeypatch):
    provider = WikipediaRevisionUniverseHistoryProvider(
        definition=UniverseDefinition(
            universe_key=NASDAQ100_UNIVERSE_KEY,
            display_name=NASDAQ100_UNIVERSE_NAME,
            snapshot_id=NASDAQ100_UNIVERSE_SNAPSHOT_ID,
            source_page_title=NASDAQ100_SOURCE_PAGE_TITLE,
            minimum_member_count=3,
        ),
        fallback_provider=StaticNasdaq100UniverseHistoryProvider(raw_symbols=["AAPL", "MSFT", "NVDA"]),
    )

    def fake_urlopen(request, timeout=0):
        query = urllib.parse.parse_qs(urllib.parse.urlparse(request.full_url).query)
        if query.get("action") == ["query"]:
            raise urllib.error.URLError("history unavailable")
        if query.get("action") == ["parse"] and query.get("page") == [NASDAQ100_SOURCE_PAGE_TITLE]:
            return _FakeHttpResponse(
                json.dumps(
                    {
                        "parse": {
                            "text": _constituents_html("Ticker", ["AAPL", "MSFT", "NVDA", "AMZN"])
                        }
                    }
                )
            )
        raise AssertionError(f"Unexpected wikipedia request: {request.full_url}")

    monkeypatch.setattr(universe_history_module.urllib.request, "urlopen", fake_urlopen)

    snapshots = provider.load_snapshots(start_date=date(2026, 1, 1), end_date=date(2026, 1, 1))

    assert len(snapshots) == 1
    assert snapshots[0].source == provider.current_page_source_name
    assert snapshots[0].fallback_source == provider.provider_name
    assert snapshots[0].metadata["source_quality"] == "current_page_fallback"
    assert snapshots[0].normalized_symbols == ["AAPL", "MSFT", "NVDA", "AMZN"]


def test_wikipedia_revision_provider_uses_static_seed_as_last_resort(monkeypatch):
    provider = WikipediaRevisionUniverseHistoryProvider(
        definition=UniverseDefinition(
            universe_key=SP500_UNIVERSE_KEY,
            display_name=SP500_UNIVERSE_NAME,
            snapshot_id=SP500_UNIVERSE_SNAPSHOT_ID,
            source_page_title=SP500_SOURCE_PAGE_TITLE,
            minimum_member_count=2,
        ),
        fallback_provider=StaticSp500UniverseHistoryProvider(raw_symbols=["AAPL", "MSFT"]),
    )

    def fake_urlopen(request, timeout=0):
        raise urllib.error.URLError("network down")

    monkeypatch.setattr(universe_history_module.urllib.request, "urlopen", fake_urlopen)

    snapshots = provider.load_snapshots(start_date=date(2026, 1, 1), end_date=date(2026, 1, 1))

    assert len(snapshots) == 1
    assert snapshots[0].source == "static_seed"
    assert snapshots[0].fallback_source == provider.current_page_source_name
    assert snapshots[0].metadata["source_quality"] == "static_seed_fallback"
    assert snapshots[0].metadata["historical_revision_error"]
    assert snapshots[0].metadata["current_page_error"]


def test_yahoo_provider_parse_payload_surfaces_partial_and_source_metadata():
    provider = YahooMarketDataProvider()
    payload = {
        "chart": {
            "result": [
                {
                    "timestamp": [1711929600, 1712016000],
                    "indicators": {
                        "quote": [
                            {
                                "open": [190.0, None],
                                "high": [191.0, 192.0],
                                "low": [189.0, 188.0],
                                "close": [190.5, 191.5],
                                "volume": [1000, 1100],
                            }
                        ],
                        "adjclose": [{"adjclose": [190.2, 191.2]}],
                    },
                    "events": {
                        "dividends": {"1711929600": {"amount": 0.22}},
                        "splits": {"1711929600": {"numerator": 4, "denominator": 1}},
                    },
                }
            ]
        }
    }

    result = provider._parse_payload("AAPL", payload)

    assert result.source == "yahoo"
    assert result.partial is True
    assert result.warnings
    assert result.metadata["provider"] == "yahoo"
    assert result.metadata["actions_partial"] is True
    assert result.metadata["event_types"] == ["dividend", "split"]
    assert len(result.bars) == 1
    assert {action["action_type"] for action in result.actions} == {"dividend", "split"}
    assert all(action["source"] == "yahoo" for action in result.actions)


def test_lab2_probe_handles_corrupted_empty_and_importable_cold_backup(tmp_path):
    root = tmp_path / "Lab2"
    staging = root / "baseline_restore_staging"
    staging.mkdir(parents=True)

    corrupted_path = root / ".grit_backtest_platform.sqlite3"
    corrupted_path.write_bytes(b"not a database")

    empty_path = staging / ".grit_backtest_platform.sqlite3"
    sqlite3.connect(empty_path).close()

    usable_path = staging / "sqlite_probe_root.sqlite3"
    cold_backup_repo = MarketDataRepository(usable_path)
    cold_backup_repo.replace_dataset_snapshot(
        {
            "id": "ds-price",
            "name": "股票价格数据",
            "status": "READY",
            "as_of": "2026-04-01",
            "freshness_label": "Freshly refreshed",
            "start_date": "1996-01-01",
            "end_date": "2026-04-01",
            "row_count": 1,
            "source": "local_cold_backup",
            "fallback_source": "lab2",
        },
        price_bars=[
            {
                "symbol": "MSFT",
                "date": "2026-04-01",
                "open": 420.0,
                "high": 425.0,
                "low": 418.0,
                "close": 423.0,
                "adj_close": 423.0,
                "volume": 900_000,
                "source": "local_cold_backup",
                "fallback_source": "lab2",
            }
        ],
    )
    cold_backup_repo.replace_universe_snapshot(
        {
            "id": "un-sp500",
            "universe_key": SP500_UNIVERSE_KEY,
            "name": "标普500",
            "status": "READY",
            "as_of": "2026-04-01",
            "freshness_label": "Recovered from cold backup",
            "window_start": "1996-01-01",
            "window_end": "2026-04-01",
            "anchor_schedule": ANCHOR_SCHEDULE,
            "member_count": 1,
            "source": "local_cold_backup",
            "fallback_source": "lab2",
        },
        memberships=[
            {
                "effective_date": "2026-01-01",
                "symbol": "MSFT",
                "source": "local_cold_backup",
                "fallback_source": "lab2",
            }
        ],
    )

    report = probe_lab2_snapshot_assets(root)
    statuses = {str(Path(probe.path).relative_to(root)): probe.status for probe in report.probes}

    assert statuses[".grit_backtest_platform.sqlite3"] == "corrupted"
    assert statuses[r"baseline_restore_staging\.grit_backtest_platform.sqlite3"] == "empty"
    assert statuses[r"baseline_restore_staging\sqlite_probe_root.sqlite3"] == "usable"
    assert any("corrupted" in note.lower() for note in report.notes)
    assert str(usable_path) in report.usable_assets

    target_repository = MarketDataRepository(tmp_path / "target.sqlite3")
    imported = import_snapshot_cold_backup(target_repository, usable_path)

    assert imported["status"] == "imported"
    assert imported["imported_tables"]["dataset_snapshots"] >= 1
    assert target_repository.snapshot_table_counts()["dataset_price_bars"] == 1


def test_unconfigured_fallback_provider_surfaces_unavailable_metadata():
    provider = UnconfiguredFallbackProvider()

    availability = provider.availability()

    assert availability.provider_name == "fallback_unavailable"
    assert availability.available is False
    assert availability.metadata["mode"] == "unconfigured"

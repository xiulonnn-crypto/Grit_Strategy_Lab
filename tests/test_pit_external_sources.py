from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from grit_backtest_platform.pit_external_sources import (
    build_external_source_readiness,
    kaggle_credential_status,
    matrix_manifest_from_events,
    parse_sp500_matrix_csv,
)


def test_sp500_matrix_parser_normalizes_added_removed_rows(tmp_path):
    matrix_csv = tmp_path / "Historical Components.csv"
    matrix_csv.write_text(
        "Date,added_ticker,removed_ticker,company_name\n"
        "2001-01-02,ABK,,Ambac Financial\n"
        "2008-06-30,,ABK,Ambac Financial\n"
        "2015-03-18,BRK.B,,Berkshire Hathaway\n",
        encoding="utf-8",
    )

    events = parse_sp500_matrix_csv(
        matrix_csv,
        source_revision_id="unit-sha",
    )

    assert [event.symbol for event in events] == ["ABK", "ABK", "BRK-B"]
    assert [event.membership_status for event in events] == ["ACTIVE", "REMOVED", "ACTIVE"]
    assert events[0].as_membership_row()["metadata"]["source_revision_id"] == "unit-sha"

    manifest = matrix_manifest_from_events(
        events,
        source_url="https://github.com/fja05680/sp500",
        source_revision_id="unit-sha",
    )
    assert manifest["member_event_count"] == 3
    assert manifest["effective_start"] == "2001-01-02"
    assert manifest["effective_end"] == "2015-03-18"


def test_sp500_matrix_parser_supports_date_tickers_snapshots(tmp_path):
    matrix_csv = tmp_path / "Historical Components Snapshot.csv"
    matrix_csv.write_text(
        "date,tickers\n"
        '1996-01-02,"AAPL,BRK.B, AAPL,MSFT"\n'
        '1996-01-03,"AAPL,MSFT"\n',
        encoding="utf-8",
    )

    events = parse_sp500_matrix_csv(matrix_csv, source_revision_id="snapshot-sha")

    assert [(event.effective_date, event.symbol, event.membership_status) for event in events] == [
        ("1996-01-02", "AAPL", "MEMBER"),
        ("1996-01-02", "BRK-B", "MEMBER"),
        ("1996-01-02", "MSFT", "MEMBER"),
        ("1996-01-03", "AAPL", "MEMBER"),
        ("1996-01-03", "MSFT", "MEMBER"),
    ]


def test_kaggle_credential_status_rejects_wrapped_placeholder_tokens(tmp_path, monkeypatch):
    monkeypatch.setenv("KAGGLE_API_TOKEN", "<placeholder-token>")
    monkeypatch.delenv("KAGGLE_USERNAME", raising=False)
    monkeypatch.delenv("KAGGLE_KEY", raising=False)
    monkeypatch.setenv("KAGGLE_CONFIG_DIR", str(tmp_path / "kaggle-config"))

    status = kaggle_credential_status()

    assert status["credential_status"] == "invalid"
    assert "invalid_placeholder_wrapped" in status["invalid_reasons"]
    assert "placeholder-token" not in str(status)


def test_external_readiness_does_not_mark_empty_catalog_ready(tmp_path, monkeypatch):
    cache_dir = tmp_path / "pit-bulk-cache"
    (cache_dir / "catalog").mkdir(parents=True)
    (cache_dir / "catalog" / "gsl_pit_bulk.duckdb").write_bytes(b"")
    monkeypatch.setenv("KAGGLE_CONFIG_DIR", str(tmp_path / "kaggle-config"))
    monkeypatch.delenv("KAGGLE_API_TOKEN", raising=False)
    monkeypatch.delenv("KAGGLE_USERNAME", raising=False)
    monkeypatch.delenv("KAGGLE_KEY", raising=False)

    readiness = build_external_source_readiness(cache_dir=cache_dir)

    assert readiness["parquet_catalog_status"]["catalog_exists"] is True
    assert readiness["parquet_catalog_status"]["status"] == "MISSING"
    assert readiness["parquet_catalog_status"]["manifest_row_count"] == 0


def test_external_readiness_discovers_nested_legacy_cache_artifacts(tmp_path, monkeypatch):
    cache_dir = tmp_path / "pit-bulk-cache"
    (cache_dir / "catalog").mkdir(parents=True)
    (cache_dir / "manifests").mkdir()
    (cache_dir / "normalized").mkdir()
    nested_cache = cache_dir / "grit-pit-bulk-cache"
    (nested_cache / "catalog").mkdir(parents=True)
    (nested_cache / "catalog" / "gsl_pit_bulk.duckdb").write_bytes(b"catalog")
    (nested_cache / "normalized" / "pit_prices" / "symbol_prefix=A" / "year=2026").mkdir(parents=True)
    (nested_cache / "normalized" / "pit_prices" / "symbol_prefix=A" / "year=2026" / "data.parquet").write_bytes(b"parquet")
    (nested_cache / "manifests").mkdir()
    (nested_cache / "manifests" / "kaggle-normalized-catalog.json").write_text(
        "{"
        '"provider_id":"kaggle_huge_stock_market_dataset",'
        '"source_kind":"kaggle_bulk_normalized",'
        '"dataset_id":"borismarjanovic/price-volume-data-for-all-us-stocks-etfs",'
        '"row_count":123,'
        '"duckdb_catalog":"old-root/catalog/gsl_pit_bulk.duckdb",'
        '"parquet_path":"old-root/normalized/pit_prices"'
        "}",
        encoding="utf-8",
    )
    (nested_cache / "manifests" / "github-sp500-historical-components.json").write_text(
        "{"
        '"provider_id":"github_sp500_historical_components",'
        '"source_kind":"matrix",'
        '"member_event_count":456,'
        '"source_url":"https://github.com/fja05680/sp500"'
        "}",
        encoding="utf-8",
    )
    monkeypatch.setenv("KAGGLE_CONFIG_DIR", str(tmp_path / "kaggle-config"))

    readiness = build_external_source_readiness(cache_dir=cache_dir)

    assert readiness["cache_dir"] == str(nested_cache)
    assert readiness["kaggle_cache_manifest"]["status"] == "READY"
    assert readiness["kaggle_cache_manifest"]["manifest_count"] == 1
    assert readiness["matrix_coverage_status"]["status"] == "READY"
    assert readiness["matrix_coverage_status"]["member_event_count"] == 456
    assert readiness["parquet_catalog_status"]["status"] == "READY"
    assert readiness["parquet_catalog_status"]["parquet_file_count"] == 1
    assert readiness["parquet_catalog_status"]["manifest_row_count"] == 123


def test_diff_repair_symbol_extraction_prefers_full_repair_queue():
    script_path = Path(__file__).resolve().parents[1] / "scripts" / "pit_external_sources.py"
    spec = importlib.util.spec_from_file_location("pit_external_sources_script", script_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    symbols = module._queue_symbols(
        {
            "full_ready_repair_plan": {
                "queue_symbols": ["AAPL", "MSFT"],
                "queue_price_symbols": ["AAPL"],
                "queue_sample": [{"symbol": "AAPL"}, {"symbol": "OLD"}],
            },
            "coverage_gap": {
                "buckets": [
                    {"symbols": ["ZZZZ"], "symbol_details": [{"symbol": "BRK-B"}]},
                ],
            },
        }
    )

    assert symbols == ["AAPL"]


def test_diff_repair_symbol_extraction_prefers_coverage_gap_when_price_queue_absent():
    script_path = Path(__file__).resolve().parents[1] / "scripts" / "pit_external_sources.py"
    spec = importlib.util.spec_from_file_location("pit_external_sources_script_coverage", script_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    symbols = module._queue_symbols(
        {
            "full_ready_repair_plan": {
                "queue_symbols": ["AAPL", "MSFT", "CORPONLY"],
                "queue_sample": [{"symbol": "CORPONLY", "repair_targets": ["corporate_actions"]}],
            },
            "coverage_gap": {
                "buckets": [
                    {"symbols": ["NWS-A"], "symbol_details": [{"symbol": "VIA-B"}]},
                ],
            },
        }
    )

    assert symbols == ["NWS-A", "VIA-B"]


def test_diff_repair_catalog_symbol_aliases_cover_share_classes():
    script_path = Path(__file__).resolve().parents[1] / "scripts" / "pit_external_sources.py"
    spec = importlib.util.spec_from_file_location("pit_external_sources_script_alias", script_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    assert module._catalog_symbol_aliases("NWS-A")[:3] == ["NWS-A", "NWS_A", "NWSA"]
    assert "VIAB" in module._catalog_symbol_aliases("VIA-B")
    assert "BF-B" in module._catalog_symbol_aliases("BFB")


def test_diff_repair_catalog_lookup_maps_alias_to_canonical_and_dedupes_dates(tmp_path):
    duckdb = pytest.importorskip("duckdb")
    script_path = Path(__file__).resolve().parents[1] / "scripts" / "pit_external_sources.py"
    spec = importlib.util.spec_from_file_location("pit_external_sources_script_lookup", script_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    catalog = tmp_path / "catalog.duckdb"
    con = duckdb.connect(str(catalog))
    con.execute(
        """
        CREATE TABLE pit_prices (
          symbol VARCHAR,
          date DATE,
          open DOUBLE,
          high DOUBLE,
          low DOUBLE,
          close DOUBLE,
          adj_close DOUBLE,
          volume DOUBLE,
          source_file VARCHAR
        )
        """
    )
    con.execute(
        """
        INSERT INTO pit_prices VALUES
          ('NWSA', DATE '2013-06-24', 10, 11, 9, 10.5, 10.5, 1000, 'raw/a.txt'),
          ('NWSA', DATE '2013-06-24', 10, 11, 9, 10.5, 10.5, 1000, 'raw/b.txt'),
          ('NWSA', DATE '2013-06-25', 11, 12, 10, 11.5, 11.5, 1200, 'raw/a.txt')
        """
    )
    con.close()

    rows = module._query_catalog_rows(catalog, ["NWS-A"])

    assert len(rows["NWS-A"]) == 2
    assert rows["NWS-A"][0]["symbol"] == "NWS-A"
    assert rows["NWS-A"][0]["source_symbol"] == "NWSA"


def test_diff_repair_metadata_reconciliation_removes_repaired_symbols():
    script_path = Path(__file__).resolve().parents[1] / "scripts" / "pit_external_sources.py"
    spec = importlib.util.spec_from_file_location("pit_external_sources_script_reconcile", script_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    metadata = module._reconcile_price_snapshot_metadata(
        {
            "missing_symbols": ["AAPL", "MSFT", "ZZZZ"],
            "covered_symbol_count": 7,
            "total_symbol_count": 10,
            "existing_missing_symbol_count": 3,
            "selected_missing_symbols": ["AAPL", "ZZZZ"],
            "default_ignored_symbols": ["ZZZZ"],
        },
        ["aapl", "MSFT"],
    )

    assert metadata["missing_symbols"] == ["ZZZZ"]
    assert metadata["covered_symbol_count"] == 9
    assert metadata["existing_missing_symbol_count"] == 1
    assert metadata["selected_missing_symbols"] == ["ZZZZ"]
    assert metadata["default_ignored_symbols"] == ["ZZZZ"]
    assert metadata["last_external_repair_fixed_symbol_count"] == 2

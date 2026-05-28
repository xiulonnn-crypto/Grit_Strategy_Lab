from __future__ import annotations

import importlib.util
import json
import sqlite3
from pathlib import Path

import pytest


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "recovery" / "sqlite_backup_policy.py"
SPEC = importlib.util.spec_from_file_location("sqlite_backup_policy", SCRIPT_PATH)
assert SPEC and SPEC.loader
sqlite_backup_policy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sqlite_backup_policy)


def _create_market_db(path: Path) -> None:
    conn = sqlite3.connect(path)
    try:
        conn.executescript(
            """
            CREATE TABLE dataset_snapshots (
                id TEXT PRIMARY KEY,
                status TEXT,
                row_count INTEGER,
                updated_at TEXT,
                metadata_json TEXT
            );
            CREATE TABLE dataset_price_bars (
                dataset_snapshot_id TEXT,
                symbol TEXT,
                date TEXT,
                close REAL,
                source TEXT
            );
            CREATE TABLE dataset_symbol_coverage (
                dataset_snapshot_id TEXT,
                symbol TEXT,
                start_date TEXT,
                end_date TEXT,
                trade_days INTEGER,
                source TEXT
            );
            """
        )
        conn.execute(
            "INSERT INTO dataset_snapshots VALUES (?, ?, ?, ?, ?)",
            (
                "ds-price",
                "INCOMPLETE",
                3,
                "2026-05-28T00:00:00Z",
                json.dumps({"missing_symbols": ["AAA", "BBB"], "last_external_repair_at": "2026-05-28T00:00:00Z"}),
            ),
        )
        conn.executemany(
            "INSERT INTO dataset_price_bars VALUES (?, ?, ?, ?, ?)",
            [
                ("ds-price", "AAA", "2020-01-02", 10.0, "fixture"),
                ("ds-price", "BBB", "2020-01-02", 20.0, "fixture"),
            ],
        )
        conn.executemany(
            "INSERT INTO dataset_symbol_coverage VALUES (?, ?, ?, ?, ?, ?)",
            [
                ("ds-price", "AAA", "2020-01-02", "2020-01-02", 1, "fixture"),
                ("ds-price", "BBB", "2020-01-02", "2020-01-02", 1, "fixture"),
            ],
        )
        conn.commit()
    finally:
        conn.close()


def _create_workspace_db(path: Path) -> None:
    conn = sqlite3.connect(path)
    try:
        conn.execute("CREATE TABLE workspace_marker (id TEXT PRIMARY KEY)")
        conn.execute("INSERT INTO workspace_marker VALUES ('ok')")
        conn.commit()
    finally:
        conn.close()


def test_pit_price_preimage_exports_only_target_symbols(tmp_path: Path) -> None:
    market_db = tmp_path / "market.sqlite3"
    _create_market_db(market_db)

    result = sqlite_backup_policy.create_pit_price_preimage(
        market_db,
        tmp_path / "backup",
        symbols=["AAA"],
        argv=["test"],
    )

    preimage_path = Path(result["outputs"]["preimage"])
    manifest_path = Path(result["manifest_path"])
    preimage = json.loads(preimage_path.read_text(encoding="utf-8"))
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    assert preimage["kind"] == "pit-price-preimage"
    assert preimage["symbols"] == ["AAA"]
    assert set(preimage["dataset_price_bars"]) == {"AAA"}
    assert preimage["dataset_price_bars"]["AAA"][0]["close"] == 10.0
    assert set(preimage["dataset_symbol_coverage"]) == {"AAA"}
    assert manifest["kind"] == "pit-price-preimage"
    assert manifest["market_db"]["missing_symbols_count"] == 2
    assert manifest["row_counts"]["price_bars_by_symbol"] == {"AAA": 1}
    assert manifest["row_counts"]["price_bars_total"] == 1
    assert manifest["row_counts"]["coverage_by_symbol"] == {"AAA": 1}
    assert manifest["target_files"]["preimage"] == str(preimage_path)
    assert "It is not a full database backup." in manifest["restore_instructions"]


def test_full_pair_refuses_when_space_gate_would_be_violated(tmp_path: Path) -> None:
    workspace_db = tmp_path / "workspace.sqlite3"
    market_db = tmp_path / "market.sqlite3"
    _create_workspace_db(workspace_db)
    _create_market_db(market_db)
    destination = tmp_path / "full-backup"

    with pytest.raises(sqlite_backup_policy.BackupPolicyError):
        sqlite_backup_policy.create_full_pair_backup(
            workspace_db,
            market_db,
            destination,
            min_free_after_gb=1_000_000_000,
            argv=["test"],
        )

    assert not list(destination.glob("*.sqlite3"))


def test_full_pair_writes_manifest_with_restore_contract(tmp_path: Path) -> None:
    workspace_db = tmp_path / "workspace.sqlite3"
    market_db = tmp_path / "market.sqlite3"
    _create_workspace_db(workspace_db)
    _create_market_db(market_db)

    result = sqlite_backup_policy.create_full_pair_backup(
        workspace_db,
        market_db,
        tmp_path / "full-backup",
        min_free_after_gb=0,
        argv=["test"],
    )

    manifest = json.loads(Path(result["manifest_path"]).read_text(encoding="utf-8"))
    assert manifest["kind"] == "full-pair"
    assert len(manifest["outputs"]) == 2
    assert manifest["market_db"]["snapshot_row_count"] == 3
    assert manifest["space_gate"]["min_free_after_gb"] == 0
    assert "Stop the backend before restoring." in manifest["restore_instructions"]

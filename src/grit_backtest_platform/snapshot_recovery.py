from __future__ import annotations

import sqlite3
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from .market_data_repository import MarketDataRepository
from .storage import dumps, loads


DEFAULT_LAB2_ROOT = Path(r"C:\Fin\Grit_Strategy_Lab2")
SNAPSHOT_TABLES = {
    "dataset_snapshots",
    "universe_snapshots",
    "dataset_price_bars",
    "dataset_corporate_actions",
    "dataset_symbol_coverage",
    "universe_membership_snapshots",
}


@dataclass(frozen=True)
class SqliteAssetProbe:
    path: str
    exists: bool
    status: str
    size_bytes: int = 0
    table_count: int = 0
    tables: list[str] = field(default_factory=list)
    snapshot_tables: list[str] = field(default_factory=list)
    row_counts: dict[str, int] = field(default_factory=dict)
    error: str | None = None


@dataclass(frozen=True)
class SnapshotRecoveryReport:
    root: str
    probes: list[SqliteAssetProbe]
    usable_assets: list[str]
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "root": self.root,
            "probes": [asdict(probe) for probe in self.probes],
            "usable_assets": list(self.usable_assets),
            "notes": list(self.notes),
        }


def _candidate_sqlite_paths(root: Path) -> list[Path]:
    return [
        root / ".grit_backtest_platform.sqlite3",
        root / "baseline_restore_staging" / ".grit_backtest_platform.sqlite3",
        root / "baseline_restore_staging" / "sqlite_probe_root.sqlite3",
    ]


def _count_rows(conn: sqlite3.Connection, table_name: str) -> int:
    return int(conn.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0])


def probe_sqlite_asset(path: str | Path) -> SqliteAssetProbe:
    resolved = Path(path)
    if not resolved.exists():
        return SqliteAssetProbe(path=str(resolved), exists=False, status="missing")

    try:
        conn = sqlite3.connect(resolved)
        try:
            cursor = conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
            tables = [str(row[0]) for row in cursor.fetchall()]
            if not tables:
                return SqliteAssetProbe(
                    path=str(resolved),
                    exists=True,
                    status="empty",
                    size_bytes=resolved.stat().st_size,
                )
            snapshot_tables = sorted(SNAPSHOT_TABLES.intersection(tables))
            row_counts = {table_name: _count_rows(conn, table_name) for table_name in snapshot_tables}
            usable = any(count > 0 for count in row_counts.values())
            status = "usable" if usable else ("schema_only" if snapshot_tables else "non_snapshot")
            return SqliteAssetProbe(
                path=str(resolved),
                exists=True,
                status=status,
                size_bytes=resolved.stat().st_size,
                table_count=len(tables),
                tables=tables,
                snapshot_tables=snapshot_tables,
                row_counts=row_counts,
            )
        finally:
            conn.close()
    except sqlite3.DatabaseError as exc:
        message = str(exc)
        normalized = "corrupted" if "malformed" in message.lower() or "not a database" in message.lower() else "error"
        return SqliteAssetProbe(
            path=str(resolved),
            exists=True,
            status=normalized,
            size_bytes=resolved.stat().st_size,
            error=message,
        )
    except OSError as exc:
        return SqliteAssetProbe(
            path=str(resolved),
            exists=True,
            status="error",
            error=str(exc),
        )


def probe_lab2_snapshot_assets(root: str | Path = DEFAULT_LAB2_ROOT) -> SnapshotRecoveryReport:
    resolved_root = Path(root)
    probes = [probe_sqlite_asset(path) for path in _candidate_sqlite_paths(resolved_root)]
    usable_assets = [probe.path for probe in probes if probe.status == "usable"]
    notes: list[str] = []
    if not usable_assets:
        notes.append("No usable cold-backup snapshot database found under Lab2.")
    if any(probe.status == "corrupted" for probe in probes):
        notes.append("At least one Lab2 sqlite file is corrupted; do not treat it as a live source.")
    if any(probe.status == "empty" for probe in probes):
        notes.append("At least one Lab2 sqlite file is empty or uninitialized.")
    return SnapshotRecoveryReport(
        root=str(resolved_root),
        probes=probes,
        usable_assets=usable_assets,
        notes=notes,
    )


def import_snapshot_cold_backup(
    repository: MarketDataRepository,
    source_database_path: str | Path,
) -> dict[str, Any]:
    probe = probe_sqlite_asset(source_database_path)
    if probe.status != "usable":
        return {
            "status": "skipped",
            "source_database_path": str(source_database_path),
            "probe": asdict(probe),
            "imported_tables": {},
        }

    imported_tables: dict[str, int] = {}
    with sqlite3.connect(source_database_path) as source_conn:
        source_conn.row_factory = sqlite3.Row
        dataset_rows = [dict(row) for row in source_conn.execute("SELECT * FROM dataset_snapshots ORDER BY id").fetchall()]
        universe_rows = [dict(row) for row in source_conn.execute("SELECT * FROM universe_snapshots ORDER BY id").fetchall()]

        for dataset in dataset_rows:
            dataset_id = str(dataset["id"])
            price_bars = [
                dict(row)
                for row in source_conn.execute(
                    "SELECT * FROM dataset_price_bars WHERE dataset_snapshot_id = ? ORDER BY symbol, date",
                    (dataset_id,),
                ).fetchall()
            ]
            corporate_actions = [
                dict(row)
                for row in source_conn.execute(
                    """
                    SELECT * FROM dataset_corporate_actions
                    WHERE dataset_snapshot_id = ?
                    ORDER BY symbol, event_date, event_type
                    """,
                    (dataset_id,),
                ).fetchall()
            ]
            symbol_coverage = [
                dict(row)
                for row in source_conn.execute(
                    "SELECT * FROM dataset_symbol_coverage WHERE dataset_snapshot_id = ? ORDER BY symbol",
                    (dataset_id,),
                ).fetchall()
            ]
            repository.replace_dataset_snapshot(
                {
                    "id": dataset["id"],
                    "name": dataset["name"],
                    "status": dataset["status"],
                    "as_of": dataset["as_of"],
                    "freshness_label": dataset["freshness_label"],
                    "start_date": dataset["start_date"],
                    "end_date": dataset["end_date"],
                    "row_count": dataset["row_count"],
                    "source": dataset["source"],
                    "fallback_source": dataset["fallback_source"],
                    "blocker": loads(dataset.get("blocker_json"), {}),
                    "metadata": loads(dataset.get("metadata_json"), {}),
                    "created_at": dataset["created_at"],
                    "updated_at": dataset["updated_at"],
                },
                price_bars=[
                    {
                        "symbol": row["symbol"],
                        "date": row["date"],
                        "open": row["open"],
                        "high": row["high"],
                        "low": row["low"],
                        "close": row["close"],
                        "adj_close": row["adj_close"],
                        "volume": row["volume"],
                        "source": row["source"],
                        "fallback_source": row["fallback_source"],
                        "metadata": loads(row["metadata_json"], {}),
                    }
                    for row in price_bars
                ],
                corporate_actions=[
                    {
                        "symbol": row["symbol"],
                        "date": row["event_date"],
                        "action_type": row["event_type"],
                        "value": row["value"],
                        "source": row["source"],
                        "fallback_source": row["fallback_source"],
                        "payload": loads(row["payload_json"], {}),
                    }
                    for row in corporate_actions
                ],
                symbol_coverage=[
                    {
                        "symbol": row["symbol"],
                        "start_date": row["start_date"],
                        "end_date": row["end_date"],
                        "trade_days": row["trade_days"],
                        "source": row["source"],
                        "fallback_source": row["fallback_source"],
                        "metadata": loads(row["metadata_json"], {}),
                    }
                    for row in symbol_coverage
                ],
            )

        for universe in universe_rows:
            universe_id = str(universe["id"])
            memberships = [
                dict(row)
                for row in source_conn.execute(
                    """
                    SELECT * FROM universe_membership_snapshots
                    WHERE universe_snapshot_id = ?
                    ORDER BY effective_date, symbol
                    """,
                    (universe_id,),
                ).fetchall()
            ]
            repository.replace_universe_snapshot(
                {
                    "id": universe["id"],
                    "universe_key": universe["universe_key"],
                    "name": universe["name"],
                    "status": universe["status"],
                    "as_of": universe["as_of"],
                    "freshness_label": universe["freshness_label"],
                    "window_start": universe["window_start"],
                    "window_end": universe["window_end"],
                    "anchor_schedule": universe["anchor_schedule"],
                    "member_count": universe["member_count"],
                    "source": universe["source"],
                    "fallback_source": universe["fallback_source"],
                    "blocker": loads(universe.get("blocker_json"), {}),
                    "metadata": loads(universe.get("metadata_json"), {}),
                    "created_at": universe["created_at"],
                    "updated_at": universe["updated_at"],
                },
                memberships=[
                    {
                        "effective_date": row["effective_date"],
                        "symbol": row["symbol"],
                        "raw_symbol": row["raw_symbol"],
                        "membership_status": row["membership_status"],
                        "source": row["source"],
                        "fallback_source": row["fallback_source"],
                        "metadata": loads(row["metadata_json"], {}),
                    }
                    for row in memberships
                ],
            )

    imported_tables["dataset_snapshots"] = len(dataset_rows)
    imported_tables["universe_snapshots"] = len(universe_rows)
    imported_tables.update(repository.snapshot_table_counts())
    return {
        "status": "imported",
        "source_database_path": str(source_database_path),
        "probe": asdict(probe),
        "imported_tables": imported_tables,
    }

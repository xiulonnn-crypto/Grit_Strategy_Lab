from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_WORKSPACE_DB = REPO_ROOT / ".grit_backtest_platform.sqlite3"
DEFAULT_MARKET_DB = REPO_ROOT / ".grit_backtest_platform_market_data.sqlite3"
DEFAULT_RECOVERY_ROOT = REPO_ROOT / "artifacts" / "recovery"
DATASET_PRICE_SNAPSHOT_ID = "ds-price"


class BackupPolicyError(RuntimeError):
    pass


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def normalize_symbols(values: list[str] | None, symbol_file: str | None = None) -> list[str]:
    symbols: list[str] = []
    for value in values or []:
        symbols.extend(part.strip().upper() for part in value.replace(",", " ").split())
    if symbol_file:
        for line in Path(symbol_file).read_text(encoding="utf-8").splitlines():
            symbols.extend(part.strip().upper() for part in line.replace(",", " ").split())
    return sorted({symbol for symbol in symbols if symbol})


def resolve_under_repo(path: Path) -> Path:
    resolved = path.resolve()
    repo = REPO_ROOT.resolve()
    try:
        resolved.relative_to(repo)
    except ValueError as exc:
        raise BackupPolicyError(f"Refusing to write outside repository: {resolved}") from exc
    return resolved


def table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def rows_for_query(conn: sqlite3.Connection, query: str, params: tuple[Any, ...]) -> list[dict[str, Any]]:
    return [dict(row) for row in conn.execute(query, params).fetchall()]


def snapshot_baseline(db_path: Path) -> dict[str, Any]:
    baseline: dict[str, Any] = {
        "db_path": str(db_path),
        "exists": db_path.exists(),
        "size_bytes": db_path.stat().st_size if db_path.exists() else 0,
    }
    if not db_path.exists():
        return baseline
    with sqlite3.connect(f"file:{db_path.resolve().as_posix()}?mode=ro", uri=True) as conn:
        conn.row_factory = sqlite3.Row
        if not table_exists(conn, "dataset_snapshots"):
            baseline["dataset_snapshots_table"] = False
            return baseline
        row = conn.execute(
            "SELECT status, row_count, updated_at, metadata_json FROM dataset_snapshots WHERE id = ?",
            (DATASET_PRICE_SNAPSHOT_ID,),
        ).fetchone()
        if row is None:
            baseline["dataset_snapshot_id"] = DATASET_PRICE_SNAPSHOT_ID
            baseline["dataset_snapshot_found"] = False
            return baseline
        metadata = json.loads(row["metadata_json"] or "{}")
        baseline.update(
            {
                "dataset_snapshot_id": DATASET_PRICE_SNAPSHOT_ID,
                "dataset_snapshot_found": True,
                "snapshot_status": row["status"],
                "snapshot_row_count": row["row_count"],
                "snapshot_updated_at": row["updated_at"],
                "missing_symbols_count": len(metadata.get("missing_symbols") or []),
                "last_external_repair_at": metadata.get("last_external_repair_at"),
            }
        )
    return baseline


def ensure_space_for_full_backup(
    destination_root: Path,
    source_paths: list[Path],
    *,
    min_free_after_gb: float,
) -> dict[str, Any]:
    destination_root.mkdir(parents=True, exist_ok=True)
    usage = shutil.disk_usage(destination_root)
    required_bytes = sum(path.stat().st_size for path in source_paths if path.exists())
    projected_free_bytes = usage.free - required_bytes
    projected_free_gb = projected_free_bytes / (1024**3)
    result = {
        "free_before_gb": round(usage.free / (1024**3), 3),
        "required_gb": round(required_bytes / (1024**3), 3),
        "projected_free_after_gb": round(projected_free_gb, 3),
        "min_free_after_gb": min_free_after_gb,
    }
    if projected_free_gb < min_free_after_gb:
        raise BackupPolicyError(
            "Refusing full backup: projected free space "
            f"{projected_free_gb:.3f}GB is below min_free_after_gb={min_free_after_gb:.3f}GB"
        )
    return result


def sqlite_online_backup(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(f"file:{source.resolve().as_posix()}?mode=ro", uri=True) as source_conn:
        with sqlite3.connect(destination) as destination_conn:
            source_conn.backup(destination_conn)


def write_manifest(destination_dir: Path, manifest: dict[str, Any]) -> Path:
    destination_dir.mkdir(parents=True, exist_ok=True)
    path = destination_dir / "backup-manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return path


def create_full_pair_backup(
    workspace_db: Path,
    market_db: Path,
    destination_dir: Path,
    *,
    min_free_after_gb: float,
    argv: list[str],
) -> dict[str, Any]:
    destination_dir = resolve_under_repo(destination_dir)
    sources = [workspace_db, market_db]
    missing = [str(path) for path in sources if not path.exists()]
    if missing:
        raise BackupPolicyError(f"Cannot create full-pair backup; missing source DB(s): {missing}")
    space = ensure_space_for_full_backup(destination_dir, sources, min_free_after_gb=min_free_after_gb)
    outputs: dict[str, str] = {}
    for source in sources:
        destination = destination_dir / source.name
        sqlite_online_backup(source, destination)
        outputs[str(source)] = str(destination)
    manifest = {
        "kind": "full-pair",
        "generated_at": utc_now(),
        "argv": argv,
        "sources": [str(path) for path in sources],
        "source_dbs": {
            "workspace": str(workspace_db),
            "market": str(market_db),
        },
        "outputs": outputs,
        "target_files": outputs,
        "space_gate": space,
        "workspace_db": {
            "path": str(workspace_db),
            "size_bytes": workspace_db.stat().st_size,
        },
        "market_db": snapshot_baseline(market_db),
        "restore_instructions": [
            "Stop the backend before restoring.",
            "Copy the backed-up .grit_backtest_platform.sqlite3 and companion market-data DB back to the repository root.",
            "Restart through QuickStart-Grit.ps1 -ForceRestart and rerun runtime preflight.",
        ],
    }
    manifest_path = write_manifest(destination_dir, manifest)
    manifest["manifest_path"] = str(manifest_path)
    return manifest


def create_pit_price_preimage(
    market_db: Path,
    destination_dir: Path,
    *,
    symbols: list[str],
    argv: list[str],
) -> dict[str, Any]:
    if not symbols:
        raise BackupPolicyError("pit-price-preimage requires at least one symbol")
    if not market_db.exists():
        raise BackupPolicyError(f"Cannot create preimage; market DB is missing: {market_db}")
    destination_dir = resolve_under_repo(destination_dir)
    destination_dir.mkdir(parents=True, exist_ok=True)
    preimage_path = destination_dir / "pit-price-preimage.json"

    with sqlite3.connect(f"file:{market_db.resolve().as_posix()}?mode=ro", uri=True) as conn:
        conn.row_factory = sqlite3.Row
        dataset_snapshots = (
            rows_for_query(
                conn,
                "SELECT * FROM dataset_snapshots WHERE id = ?",
                (DATASET_PRICE_SNAPSHOT_ID,),
            )
            if table_exists(conn, "dataset_snapshots")
            else []
        )
        price_rows_by_symbol = {
            symbol: rows_for_query(
                conn,
                """
                SELECT *
                FROM dataset_price_bars
                WHERE dataset_snapshot_id = ? AND symbol = ?
                ORDER BY date
                """,
                (DATASET_PRICE_SNAPSHOT_ID, symbol),
            )
            if table_exists(conn, "dataset_price_bars")
            else []
            for symbol in symbols
        }
        coverage_rows_by_symbol = {
            symbol: rows_for_query(
                conn,
                """
                SELECT *
                FROM dataset_symbol_coverage
                WHERE dataset_snapshot_id = ? AND symbol = ?
                ORDER BY start_date, end_date
                """,
                (DATASET_PRICE_SNAPSHOT_ID, symbol),
            )
            if table_exists(conn, "dataset_symbol_coverage")
            else []
            for symbol in symbols
        }
        preimage = {
            "generated_at": utc_now(),
            "kind": "pit-price-preimage",
            "dataset_snapshot_id": DATASET_PRICE_SNAPSHOT_ID,
            "symbols": symbols,
            "market_db": str(market_db),
            "dataset_snapshots": dataset_snapshots,
            "dataset_price_bars": price_rows_by_symbol,
            "dataset_symbol_coverage": coverage_rows_by_symbol,
        }
    preimage_path.write_text(json.dumps(preimage, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    price_bar_counts = {symbol: len(rows) for symbol, rows in price_rows_by_symbol.items()}
    coverage_counts = {symbol: len(rows) for symbol, rows in coverage_rows_by_symbol.items()}
    manifest = {
        "kind": "pit-price-preimage",
        "generated_at": utc_now(),
        "argv": argv,
        "source_dbs": {
            "market": str(market_db),
        },
        "market_db": snapshot_baseline(market_db),
        "symbols": symbols,
        "outputs": {
            "preimage": str(preimage_path),
        },
        "target_files": {
            "preimage": str(preimage_path),
        },
        "row_counts": {
            "dataset_snapshots": len(dataset_snapshots),
            "price_bars_total": sum(price_bar_counts.values()),
            "price_bars_by_symbol": price_bar_counts,
            "coverage_total": sum(coverage_counts.values()),
            "coverage_by_symbol": coverage_counts,
        },
        "restore_instructions": [
            "This is a targeted preimage for ds-price rows only.",
            "Use it to inspect or manually restore the listed symbols' previous price bars and coverage rows.",
            "It is not a full database backup.",
        ],
    }
    manifest_path = write_manifest(destination_dir, manifest)
    manifest["manifest_path"] = str(manifest_path)
    return manifest


def default_destination(kind: str) -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return DEFAULT_RECOVERY_ROOT / f"{stamp}-{kind}"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Space-aware SQLite backup policy for Grit recovery tasks.")
    sub = parser.add_subparsers(dest="command", required=True)

    full = sub.add_parser("full-pair", help="Create an explicit full workspace + market-data DB backup pair.")
    full.add_argument("--workspace-db", default=str(DEFAULT_WORKSPACE_DB))
    full.add_argument("--market-db", default=str(DEFAULT_MARKET_DB))
    full.add_argument("--destination-dir")
    full.add_argument("--min-free-after-gb", type=float, default=25.0)
    full.add_argument("--json", action="store_true")

    preimage = sub.add_parser("pit-price-preimage", help="Back up only target ds-price rows before a PIT/L1 patch.")
    preimage.add_argument("--market-db", default=str(DEFAULT_MARKET_DB))
    preimage.add_argument("--destination-dir")
    preimage.add_argument("--symbol", action="append", default=[])
    preimage.add_argument("--symbols-file")
    preimage.add_argument("--json", action="store_true")

    baseline = sub.add_parser("baseline", help="Inspect the active market-data DB baseline.")
    baseline.add_argument("--market-db", default=str(DEFAULT_MARKET_DB))
    baseline.add_argument("--json", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "full-pair":
            destination = Path(args.destination_dir) if args.destination_dir else default_destination("full-pair")
            result = create_full_pair_backup(
                Path(args.workspace_db),
                Path(args.market_db),
                destination,
                min_free_after_gb=float(args.min_free_after_gb),
                argv=[Path(sys.argv[0]).name, *argv],
            )
        elif args.command == "pit-price-preimage":
            destination = Path(args.destination_dir) if args.destination_dir else default_destination("pit-price-preimage")
            result = create_pit_price_preimage(
                Path(args.market_db),
                destination,
                symbols=normalize_symbols(args.symbol, args.symbols_file),
                argv=[Path(sys.argv[0]).name, *argv],
            )
        elif args.command == "baseline":
            result = snapshot_baseline(Path(args.market_db))
        else:
            raise BackupPolicyError(f"Unsupported command: {args.command}")
    except BackupPolicyError as exc:
        payload = {"status": "error", "error": str(exc)}
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 2

    payload = {"status": "ok", "result": result}
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

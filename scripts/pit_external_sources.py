from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from grit_backtest_platform.market_data_repository import DATASET_PRICE_SNAPSHOT_ID, MarketDataRepository  # noqa: E402
from grit_backtest_platform.pit_external_sources import (  # noqa: E402
    KAGGLE_DATASET_RECOMMENDATIONS,
    KAGGLE_SEARCH_TERMS,
    default_cache_dir,
    matrix_manifest_from_events,
    parse_sp500_matrix_csv,
    preflight_report,
    write_external_source_manifest,
)
from grit_backtest_platform.storage import iso_now  # noqa: E402
from grit_backtest_platform.universe_history import SP500_UNIVERSE_KEY, SP500_UNIVERSE_NAME, SP500_UNIVERSE_SNAPSHOT_ID  # noqa: E402


def emit_json(payload: Mapping[str, Any]) -> None:
    rendered = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True)
    try:
        sys.stdout.buffer.write(rendered.encode("utf-8"))
        sys.stdout.buffer.write(b"\n")
    except AttributeError:
        print(rendered.encode("utf-8", errors="replace").decode("utf-8", errors="replace"))


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def read_json_url(url: str) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload if isinstance(payload, dict) else {}


def read_json_file(path: str | Path) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    return payload if isinstance(payload, dict) else {}


def kaggle_subprocess_env(cache_dir: str | Path | None = None) -> dict[str, str]:
    env = dict(os.environ)
    if not str(env.get("KAGGLE_CONFIG_DIR") or "").strip():
        root = Path(cache_dir) if cache_dir else default_cache_dir()
        config_dir = root / "kaggle-config"
        config_dir.mkdir(parents=True, exist_ok=True)
        env["KAGGLE_CONFIG_DIR"] = str(config_dir)
    return env


def load_pit_payload(args: argparse.Namespace) -> dict[str, Any]:
    if getattr(args, "pit_json", None):
        return read_json_file(args.pit_json)
    api_base = str(getattr(args, "api_base", "") or "").rstrip("/")
    if api_base:
        return read_json_url(f"{api_base}/pit-data")
    return {}


def summarize_pit_payload(payload: Mapping[str, Any]) -> dict[str, Any]:
    repair_plan = payload.get("full_ready_repair_plan") if isinstance(payload.get("full_ready_repair_plan"), Mapping) else {}
    coverage = payload.get("coverage") if isinstance(payload.get("coverage"), Mapping) else {}
    external = (
        payload.get("external_source_readiness")
        if isinstance(payload.get("external_source_readiness"), Mapping)
        else {}
    )
    remaining = (
        external.get("remaining_blockers_by_source")
        if isinstance(external.get("remaining_blockers_by_source"), Mapping)
        else {}
    )
    return {
        "overall_status": payload.get("overall_status"),
        "adjusted_price_status": payload.get("adjusted_price_status"),
        "corporate_action_status": payload.get("corporate_action_status"),
        "coverage_pct": coverage.get("coverage_pct"),
        "covered_symbol_count": coverage.get("covered_symbol_count"),
        "total_symbol_count": coverage.get("total_symbol_count"),
        "full_ready_queue_status": repair_plan.get("status"),
        "full_ready_queue_total_count": repair_plan.get("queue_total_count"),
        "full_ready_remaining_symbol_count": repair_plan.get("remaining_symbol_count"),
        "external_source_readiness": {
            "kaggle_auth_status": (external.get("kaggle_auth_status") or {}).get("credential_status"),
            "kaggle_cache_status": (external.get("kaggle_cache_manifest") or {}).get("status"),
            "matrix_coverage_status": (external.get("matrix_coverage_status") or {}).get("status"),
            "parquet_catalog_status": (external.get("parquet_catalog_status") or {}).get("status"),
            "polygon_status": (external.get("polygon_status") or {}).get("credential_status"),
            "critical_polygon_candidate_count": len(external.get("critical_polygon_candidates") or []),
            "remaining_blockers_by_source": {
                str(key): {
                    "status": value.get("status"),
                    "blocked_count": value.get("blocked_count"),
                }
                for key, value in remaining.items()
                if isinstance(value, Mapping)
            },
        },
    }


def command_preflight(args: argparse.Namespace) -> int:
    report = preflight_report(args.cache_dir)
    if args.api_base:
        try:
            report["pit_data_summary"] = summarize_pit_payload(read_json_url(f"{str(args.api_base).rstrip('/')}/pit-data"))
        except Exception as exc:
            report["pit_data_error"] = str(exc)
    emit_json(report)
    return 0


def command_kaggle_search(args: argparse.Namespace) -> int:
    kaggle_exe = args.kaggle or "kaggle"
    terms = args.terms or KAGGLE_SEARCH_TERMS
    results: list[dict[str, Any]] = []
    env = kaggle_subprocess_env(args.cache_dir)
    for term in terms:
        cmd = [kaggle_exe, "datasets", "list", "-s", term]
        completed = subprocess.run(cmd, text=True, capture_output=True, check=False, env=env)
        results.append(
            {
                "term": term,
                "command": " ".join(cmd),
                "exit_code": completed.returncode,
                "stdout": completed.stdout,
                "stderr": completed.stderr,
            }
        )
    emit_json(
        {
            "generated_at": utc_now(),
            "search_terms": terms,
            "results": results,
            "recommended_datasets": KAGGLE_DATASET_RECOMMENDATIONS,
        }
    )
    return 0 if all(item["exit_code"] == 0 for item in results) else 2


def command_kaggle_download(args: argparse.Namespace) -> int:
    dataset_id = str(args.dataset_id or "").strip()
    if not dataset_id:
        raise SystemExit("--dataset-id is required")
    cache_dir = Path(args.cache_dir or default_cache_dir())
    target_dir = cache_dir / "raw" / dataset_id.replace("/", "__")
    target_dir.mkdir(parents=True, exist_ok=True)
    kaggle_exe = args.kaggle or "kaggle"
    cmd = [kaggle_exe, "datasets", "download", "-d", dataset_id, "-p", str(target_dir)]
    if args.unzip:
        cmd.append("--unzip")
    completed = subprocess.run(cmd, text=True, capture_output=True, check=False, env=kaggle_subprocess_env(args.cache_dir))
    files = [path for path in target_dir.rglob("*") if path.is_file()]
    manifest = {
        "source_kind": "kaggle_bulk_dataset",
        "provider_id": "kaggle_huge_stock_market_dataset" if "borismarjanovic/" in dataset_id else "kaggle_delisted_bulk_archive",
        "dataset_id": dataset_id,
        "source_url": f"https://www.kaggle.com/datasets/{dataset_id}",
        "license": args.license or "verify_before_import",
        "downloaded_at": utc_now(),
        "raw_dir": str(target_dir),
        "file_count": len(files),
        "raw_size_bytes": sum(path.stat().st_size for path in files),
        "pit_mode": "price_only",
        "command_exit_code": completed.returncode,
        "command_stdout_tail": completed.stdout[-2000:],
        "command_stderr_tail": completed.stderr[-2000:],
    }
    manifest_path = write_external_source_manifest(
        manifest,
        cache_dir=cache_dir,
        manifest_id=f"kaggle-{dataset_id.replace('/', '__')}",
    )
    emit_json({**manifest, "manifest_path": str(manifest_path)})
    return completed.returncode


def _quote_sql(value: str) -> str:
    return "'" + value.replace("'", "''").replace("\\", "/") + "'"


def command_bulk_normalize(args: argparse.Namespace) -> int:
    try:
        import duckdb  # type: ignore
    except Exception as exc:
        raise SystemExit(f"duckdb is required for bulk normalization: {exc}")

    cache_dir = Path(args.cache_dir or default_cache_dir())
    input_dir = Path(args.input_dir) if args.input_dir else cache_dir / "raw"
    catalog_dir = cache_dir / "catalog"
    normalized_dir = cache_dir / "normalized"
    catalog_dir.mkdir(parents=True, exist_ok=True)
    normalized_dir.mkdir(parents=True, exist_ok=True)
    catalog_path = Path(args.catalog or catalog_dir / "gsl_pit_bulk.duckdb")
    csv_files = sorted(
        str(path)
        for pattern in ("*.csv", "*.txt")
        for path in input_dir.rglob(pattern)
        if path.is_file() and path.stat().st_size > 0
    )
    if not csv_files:
        raise SystemExit(f"No non-empty CSV/TXT files were found under {input_dir}")
    file_list_sql = "[" + ",".join(_quote_sql(path) for path in csv_files) + "]"
    con = duckdb.connect(str(catalog_path))
    con.execute(
        f"""
        CREATE OR REPLACE TABLE pit_prices AS
        WITH raw_prices AS (
          SELECT
            regexp_replace(regexp_extract(filename, '[^/\\\\]+$', 0), '\\.[^.]+$', '') AS file_symbol,
            Date,
            Open,
            High,
            Low,
            Close,
            Volume,
            filename
          FROM read_csv_auto({file_list_sql}, filename=true, union_by_name=true, ignore_errors=true)
        )
        SELECT
          upper(
            CASE
              WHEN lower(file_symbol) LIKE '%.us' THEN substr(file_symbol, 1, length(file_symbol) - 3)
              ELSE file_symbol
            END
          ) AS symbol,
          try_cast(Date AS DATE) AS date,
          try_cast(Open AS DOUBLE) AS open,
          try_cast(High AS DOUBLE) AS high,
          try_cast(Low AS DOUBLE) AS low,
          try_cast(Close AS DOUBLE) AS close,
          try_cast(Close AS DOUBLE) AS adj_close,
          try_cast(Volume AS DOUBLE) AS volume,
          filename AS source_file
        FROM raw_prices
        WHERE Date IS NOT NULL
        """
    )
    con.execute("CREATE INDEX IF NOT EXISTS idx_pit_prices_symbol_date ON pit_prices(symbol, date)")
    row_count = int(con.execute("SELECT COUNT(*) FROM pit_prices").fetchone()[0])
    symbol_count = int(con.execute("SELECT COUNT(DISTINCT symbol) FROM pit_prices").fetchone()[0])
    schema_rows = con.execute("DESCRIBE pit_prices").fetchall()
    schema_text = json.dumps(schema_rows, ensure_ascii=False, default=str)
    schema_fingerprint = hashlib.sha256(schema_text.encode("utf-8")).hexdigest()
    if args.write_parquet:
        parquet_path = normalized_dir / "pit_prices"
        parquet_path.mkdir(parents=True, exist_ok=True)
        con.execute(
            f"""
            COPY (
              SELECT *, substr(symbol, 1, 1) AS symbol_prefix, year(date) AS year
              FROM pit_prices
            )
            TO {_quote_sql(str(parquet_path))}
            (FORMAT PARQUET, PARTITION_BY (symbol_prefix, year), OVERWRITE_OR_IGNORE true)
            """
        )
    con.close()
    manifest = {
        "source_kind": "kaggle_bulk_normalized",
        "provider_id": "kaggle_huge_stock_market_dataset",
        "duckdb_catalog": str(catalog_path),
        "parquet_path": str(normalized_dir / "pit_prices") if args.write_parquet else None,
        "row_count": row_count,
        "symbol_count": symbol_count,
        "schema_fingerprint": schema_fingerprint,
        "last_imported_at": utc_now(),
        "pit_mode": "price_only",
    }
    manifest_path = write_external_source_manifest(manifest, cache_dir=cache_dir, manifest_id="kaggle-normalized-catalog")
    emit_json({**manifest, "manifest_path": str(manifest_path)})
    return 0


def _append_symbol(symbols: list[str], value: Any) -> None:
    symbol = str(value or "").strip().upper()
    if symbol:
        symbols.append(symbol)


def _coverage_gap_symbols(pit_payload: Mapping[str, Any]) -> list[str]:
    symbols: list[str] = []
    coverage_gap = pit_payload.get("coverage_gap") if isinstance(pit_payload.get("coverage_gap"), Mapping) else {}
    buckets = coverage_gap.get("buckets") if isinstance(coverage_gap, Mapping) else []
    if isinstance(buckets, Sequence) and not isinstance(buckets, (str, bytes)):
        for bucket in buckets:
            if not isinstance(bucket, Mapping):
                continue
            for value in bucket.get("symbols") or []:
                _append_symbol(symbols, value)
            for detail in bucket.get("symbol_details") or []:
                if isinstance(detail, Mapping):
                    _append_symbol(symbols, detail.get("symbol"))
    return list(dict.fromkeys(symbols))


def _queue_symbols(pit_payload: Mapping[str, Any]) -> list[str]:
    plan = pit_payload.get("full_ready_repair_plan") if isinstance(pit_payload.get("full_ready_repair_plan"), Mapping) else {}
    symbols: list[str] = []
    if isinstance(plan, Mapping):
        for value in plan.get("queue_price_symbols") or []:
            _append_symbol(symbols, value)
        if symbols:
            return list(dict.fromkeys(symbols))

    coverage_symbols = _coverage_gap_symbols(pit_payload)
    if coverage_symbols:
        return coverage_symbols

    if isinstance(plan, Mapping):
        for value in plan.get("queue_symbols") or []:
            _append_symbol(symbols, value)
        for key in ("queue", "repair_queue", "queue_sample"):
            rows = plan.get(key)
            if not isinstance(rows, Sequence) or isinstance(rows, (str, bytes)):
                continue
            for item in rows:
                if isinstance(item, Mapping):
                    targets = item.get("repair_targets")
                    if isinstance(targets, Sequence) and not isinstance(targets, (str, bytes)) and "price" not in targets:
                        continue
                    _append_symbol(symbols, item.get("symbol"))
                else:
                    _append_symbol(symbols, item)

    return list(dict.fromkeys(symbols))


def _catalog_symbol_aliases(symbol: str) -> list[str]:
    normalized = str(symbol or "").strip().upper()
    if not normalized:
        return []
    aliases = [normalized]
    replacements = [
        ("-", "_"),
        ("-", ""),
        (".", "_"),
        (".", "-"),
        (".", ""),
        ("_", "-"),
        ("_", ""),
        ("/", "_"),
        ("/", "-"),
        ("/", ""),
        (" ", "_"),
        (" ", "-"),
        (" ", ""),
    ]
    for old, new in replacements:
        if old in normalized:
            aliases.append(normalized.replace(old, new))
    if "-" not in normalized and "_" not in normalized and "." not in normalized and len(normalized) > 2:
        if normalized.endswith(("A", "B")):
            aliases.append(f"{normalized[:-1]}-{normalized[-1]}")
            aliases.append(f"{normalized[:-1]}_{normalized[-1]}")
    return list(dict.fromkeys(alias for alias in aliases if alias))


def _query_catalog_rows(catalog_path: Path, symbols: Sequence[str], *, limit_per_symbol: int = 100000) -> dict[str, list[dict[str, Any]]]:
    try:
        import duckdb  # type: ignore
    except Exception as exc:
        raise SystemExit(f"duckdb is required for diff repair: {exc}")
    if not catalog_path.exists():
        raise SystemExit(f"DuckDB catalog not found: {catalog_path}")
    con = duckdb.connect(str(catalog_path), read_only=True)
    grouped: dict[str, list[dict[str, Any]]] = {}
    for symbol in symbols:
        aliases = _catalog_symbol_aliases(symbol)
        if not aliases:
            grouped[symbol] = []
            continue
        placeholders = ", ".join("?" for _ in aliases)
        rows = con.execute(
            f"""
            SELECT source_symbol, cast(date AS VARCHAR) AS date, open, high, low, close, adj_close, volume, source_file
            FROM (
              SELECT
                symbol AS source_symbol,
                date,
                open,
                high,
                low,
                close,
                adj_close,
                volume,
                source_file,
                row_number() OVER (PARTITION BY symbol, date ORDER BY source_file) AS row_num
              FROM pit_prices
              WHERE symbol IN ({placeholders})
            )
            WHERE row_num = 1
            ORDER BY date ASC
            LIMIT ?
            """,
            [*aliases, int(limit_per_symbol)],
        ).fetchall()
        columns = [item[0] for item in con.description]
        fetched = [dict(zip(columns, row)) for row in rows]
        source_counts: dict[str, int] = {}
        for item in fetched:
            source_symbol = str(item.get("source_symbol") or "")
            source_counts[source_symbol] = source_counts.get(source_symbol, 0) + 1
        preferred_source = symbol if source_counts.get(symbol) else None
        if preferred_source is None and source_counts:
            preferred_source = max(source_counts.items(), key=lambda item: item[1])[0]
        canonical_rows: list[dict[str, Any]] = []
        for item in fetched:
            if preferred_source and item.get("source_symbol") != preferred_source:
                continue
            item["symbol"] = symbol
            canonical_rows.append(item)
        grouped[symbol] = canonical_rows
    con.close()
    return grouped


def _has_price_conflict(existing_rows: Sequence[Mapping[str, Any]], incoming_rows: Sequence[Mapping[str, Any]], *, threshold_pct: float) -> bool:
    existing_by_date = {
        str(item.get("date")): float(item.get("adj_close") if item.get("adj_close") is not None else item.get("close"))
        for item in existing_rows
        if item.get("date") and (item.get("adj_close") is not None or item.get("close") is not None)
    }
    checked = 0
    for row in incoming_rows:
        date_key = str(row.get("date") or "")
        if date_key not in existing_by_date:
            continue
        incoming_value = row.get("adj_close") if row.get("adj_close") is not None else row.get("close")
        try:
            incoming = float(incoming_value)
            existing = float(existing_by_date[date_key])
        except (TypeError, ValueError):
            continue
        if existing == 0:
            continue
        checked += 1
        if abs(incoming - existing) / abs(existing) * 100.0 > threshold_pct:
            return True
        if checked >= 5:
            break
    return False


def _reconcile_price_snapshot_metadata(metadata: Mapping[str, Any], repaired_symbols: Iterable[str]) -> dict[str, Any]:
    result = dict(metadata)
    repaired = {str(symbol or "").strip().upper() for symbol in repaired_symbols if str(symbol or "").strip()}
    if not repaired:
        return result
    missing_symbols = [
        str(symbol or "").strip().upper()
        for symbol in (result.get("missing_symbols") or [])
        if str(symbol or "").strip()
    ]
    if not missing_symbols:
        return result
    remaining_missing = [symbol for symbol in missing_symbols if symbol not in repaired]
    fixed_count = len(missing_symbols) - len(remaining_missing)
    result["missing_symbols"] = remaining_missing
    total_symbol_count = int(result.get("total_symbol_count") or 0)
    covered_symbol_count = int(result.get("covered_symbol_count") or 0)
    if total_symbol_count > 0:
        result["covered_symbol_count"] = max(covered_symbol_count, total_symbol_count - len(remaining_missing))
    else:
        result["covered_symbol_count"] = covered_symbol_count + fixed_count
    if "existing_missing_symbol_count" in result:
        result["existing_missing_symbol_count"] = len(remaining_missing)
    for key in ("selected_missing_symbols", "default_ignored_symbols"):
        if isinstance(result.get(key), Sequence) and not isinstance(result.get(key), (str, bytes)):
            result[key] = [
                str(symbol or "").strip().upper()
                for symbol in result.get(key) or []
                if str(symbol or "").strip() and str(symbol or "").strip().upper() not in repaired
            ]
    result["last_external_repair_fixed_symbol_count"] = fixed_count
    return result


def command_diff_repair(args: argparse.Namespace) -> int:
    pit_payload = load_pit_payload(args)
    symbols = [symbol.upper() for symbol in (args.symbols or [])] or _queue_symbols(pit_payload)
    symbols = symbols[: int(args.max_symbols or len(symbols) or 0)]
    if not symbols:
        emit_json({"status": "NOOP", "reason": "No PIT repair queue symbols were available."})
        return 0
    cache_dir = Path(args.cache_dir or default_cache_dir())
    catalog_path = Path(args.catalog or cache_dir / "catalog" / "gsl_pit_bulk.duckdb")
    grouped_rows = _query_catalog_rows(catalog_path, symbols)
    report: dict[str, Any] = {
        "generated_at": utc_now(),
        "status": "DRY_RUN" if not args.apply else "APPLIED",
        "catalog": str(catalog_path),
        "requested_symbol_count": len(symbols),
        "matched_symbol_count": len([symbol for symbol, rows in grouped_rows.items() if rows]),
        "symbols": [],
    }
    if not args.apply:
        for symbol, rows in grouped_rows.items():
            source_symbols = sorted({str(row.get("source_symbol") or symbol) for row in rows}) if rows else []
            report["symbols"].append(
                {
                    "symbol": symbol,
                    "matched_rows": len(rows),
                    "start_date": rows[0]["date"] if rows else None,
                    "end_date": rows[-1]["date"] if rows else None,
                    "source_symbols": source_symbols,
                    "would_apply": bool(rows),
                }
            )
        emit_json(report)
        return 0
    if not args.db:
        raise SystemExit("--db is required when --apply is set")
    repository = MarketDataRepository(Path(args.db))
    snapshot = next(
        (
            dict(item)
            for item in repository.list_dataset_snapshots()
            if str(item.get("id") or "") == DATASET_PRICE_SNAPSHOT_ID
        ),
        {
            "id": DATASET_PRICE_SNAPSHOT_ID,
            "name": "股票价格数据",
            "status": "INCOMPLETE",
            "source": "kaggle_bulk_cache",
            "metadata": {},
        },
    )
    existing = repository.load_dataset_price_bars(DATASET_PRICE_SNAPSHOT_ID, symbols, include_metadata=False)
    price_bars: list[dict[str, Any]] = []
    coverage: list[dict[str, Any]] = []
    conflicts: list[str] = []
    for symbol, rows in grouped_rows.items():
        if not rows:
            report["symbols"].append({"symbol": symbol, "matched_rows": 0, "applied_rows": 0})
            continue
        source_symbols = sorted({str(row.get("source_symbol") or symbol) for row in rows})
        if _has_price_conflict(existing.get(symbol, []), rows, threshold_pct=float(args.conflict_threshold_pct)):
            conflicts.append(symbol)
            report["symbols"].append(
                {
                    "symbol": symbol,
                    "matched_rows": len(rows),
                    "applied_rows": 0,
                    "source_symbols": source_symbols,
                    "status": "price_conflict",
                }
            )
            continue
        for row in rows:
            price_bars.append(
                {
                    "symbol": symbol,
                    "date": row["date"],
                    "open": row.get("open"),
                    "high": row.get("high"),
                    "low": row.get("low"),
                    "close": row.get("close"),
                    "adj_close": row.get("adj_close"),
                    "volume": row.get("volume"),
                    "source": "kaggle_bulk_cache",
                    "metadata": {"source_file": row.get("source_file"), "pit_external_repair": True},
                }
            )
        coverage.append(
            {
                "symbol": symbol,
                "start_date": rows[0]["date"],
                "end_date": rows[-1]["date"],
                "trade_days": len(rows),
                "source": "kaggle_bulk_cache",
                "metadata": {
                    "pit_mode": "price_only",
                    "normalized_catalog": str(catalog_path),
                    "source_symbols": source_symbols,
                },
            }
        )
        report["symbols"].append(
            {
                "symbol": symbol,
                "matched_rows": len(rows),
                "applied_rows": len(rows),
                "source_symbols": source_symbols,
                "status": "applied",
            }
        )
    metadata = _reconcile_price_snapshot_metadata(snapshot.get("metadata") or {}, [item["symbol"] for item in coverage])
    metadata.setdefault("provider_summary", {"providers": {}})
    provider_summary = metadata["provider_summary"]
    providers = provider_summary.setdefault("providers", {})
    providers["kaggle_huge_stock_market_dataset"] = {
        "status": "succeeded" if price_bars else "empty",
        "access_tier": "free_account",
        "landed_row_count": len(price_bars),
        "landed_symbol_count": len(coverage),
        "actions_supported": False,
        "pit_mode": "price_only",
        "reasons": ["local bulk cache diff repair"],
    }
    metadata["last_external_repair_at"] = utc_now()
    metadata["external_price_conflicts"] = conflicts
    snapshot.update(
        {
            "status": "READY" if not metadata.get("missing_symbols") else str(snapshot.get("status") or "INCOMPLETE"),
            "source": "kaggle_bulk_cache",
            "updated_at": iso_now(),
            "metadata": metadata,
        }
    )
    repository.merge_dataset_snapshot(snapshot, price_bars=price_bars, symbol_coverage=coverage)
    report["applied_row_count"] = len(price_bars)
    report["price_conflicts"] = conflicts
    emit_json(report)
    return 0


def command_ingest_matrix(args: argparse.Namespace) -> int:
    events = parse_sp500_matrix_csv(
        args.matrix_csv,
        source="github_sp500_historical_components",
        source_revision_id=args.source_revision_id,
    )
    manifest = matrix_manifest_from_events(
        events,
        source_url=args.source_url or "https://github.com/fja05680/sp500",
        source_revision_id=args.source_revision_id,
    )
    cache_dir = Path(args.cache_dir or default_cache_dir())
    manifest_path = write_external_source_manifest(
        manifest,
        cache_dir=cache_dir,
        manifest_id="github-sp500-historical-components",
    )
    if args.apply:
        if not args.db:
            raise SystemExit("--db is required when --apply is set")
        repository = MarketDataRepository(Path(args.db))
        memberships = [event.as_membership_row() for event in events]
        dates = [event.effective_date for event in events]
        repository.replace_universe_snapshot(
            {
                "id": SP500_UNIVERSE_SNAPSHOT_ID,
                "universe_key": SP500_UNIVERSE_KEY,
                "name": SP500_UNIVERSE_NAME,
                "status": "READY" if memberships else "INCOMPLETE",
                "as_of": max(dates) if dates else date.today().isoformat(),
                "freshness_label": "外部 Matrix 已导入" if memberships else "Matrix 无有效事件",
                "window_start": min(dates) if dates else None,
                "window_end": max(dates) if dates else None,
                "member_count": len(
                    {event.symbol for event in events if event.membership_status in {"ACTIVE", "MEMBER"}}
                ),
                "source": "github_sp500_historical_components",
                "metadata": {
                    **manifest,
                    "source_manifest_path": str(manifest_path),
                    "source_quality": "historical_components_matrix",
                },
            },
            memberships=memberships,
        )
    emit_json(
        {
            **manifest,
            "manifest_path": str(manifest_path),
            "applied": bool(args.apply),
        }
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="PIT external source utilities for Grit Strategy Lab.")
    parser.add_argument("--cache-dir", default=str(default_cache_dir()))
    sub = parser.add_subparsers(dest="command", required=True)

    preflight = sub.add_parser("preflight")
    preflight.add_argument("--api-base", default="")
    preflight.set_defaults(func=command_preflight)

    search = sub.add_parser("kaggle-search")
    search.add_argument("--terms", nargs="*")
    search.add_argument("--kaggle", default="kaggle")
    search.set_defaults(func=command_kaggle_search)

    download = sub.add_parser("kaggle-download")
    download.add_argument("--dataset-id", required=True)
    download.add_argument("--kaggle", default="kaggle")
    download.add_argument("--license", default="")
    download.add_argument("--unzip", action="store_true")
    download.set_defaults(func=command_kaggle_download)

    normalize = sub.add_parser("bulk-normalize")
    normalize.add_argument("--input-dir", default="")
    normalize.add_argument("--catalog", default="")
    normalize.add_argument("--write-parquet", action="store_true")
    normalize.set_defaults(func=command_bulk_normalize)

    repair = sub.add_parser("diff-repair")
    repair.add_argument("--api-base", default="")
    repair.add_argument("--pit-json", default="")
    repair.add_argument("--catalog", default="")
    repair.add_argument("--symbols", nargs="*")
    repair.add_argument("--max-symbols", type=int, default=0)
    repair.add_argument("--apply", action="store_true")
    repair.add_argument("--db", default="")
    repair.add_argument("--conflict-threshold-pct", type=float, default=25.0)
    repair.set_defaults(func=command_diff_repair)

    matrix = sub.add_parser("ingest-matrix")
    matrix.add_argument("--matrix-csv", required=True)
    matrix.add_argument("--source-url", default="https://github.com/fja05680/sp500")
    matrix.add_argument("--source-revision-id", default="")
    matrix.add_argument("--apply", action="store_true")
    matrix.add_argument("--db", default="")
    matrix.set_defaults(func=command_ingest_matrix)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())

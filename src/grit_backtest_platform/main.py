from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import uvicorn

from .api import build_runtime_market_data_provider, create_app
from .real_service import RealBacktestPlatformService
from .storage import iso_now

app = create_app()


def _default_db_path() -> Path:
    configured = os.getenv("GRIT_BACKTEST_DB")
    return Path(configured) if configured else Path.cwd() / ".grit_backtest_platform.sqlite3"


def _parse_refresh_targets(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [item.strip() for item in raw.split(",") if item.strip()]


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="grit_backtest_platform.main")
    parser.add_argument("command", nargs="?", default="serve", choices=["serve", "refresh-snapshots"])
    parser.add_argument("--reason", dest="reason", default=None)
    parser.add_argument("--mode", dest="mode", default="incremental", choices=["incremental", "repair", "full"])
    parser.add_argument("--targets", dest="targets", default=None)
    parser.add_argument("--db-path", dest="db_path", default=None)
    parser.add_argument("--job-id", dest="job_id", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--job-created-at", dest="job_created_at", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--job-started-at", dest="job_started_at", default=None, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    if args.command == "refresh-snapshots":
        service = RealBacktestPlatformService(
            args.db_path or _default_db_path(),
            market_data_provider=build_runtime_market_data_provider(),
        )
        payload: dict[str, object] = {"mode": args.mode}
        if args.reason is not None:
            payload["reason"] = args.reason
        targets = _parse_refresh_targets(args.targets)
        if targets:
            payload["targets"] = targets
        if args.job_id:
            payload["_job_id"] = args.job_id
        if args.job_created_at:
            payload["_job_created_at"] = args.job_created_at
        if args.job_started_at:
            payload["_job_started_at"] = args.job_started_at
        try:
            overview = service.refresh_snapshots(payload)
        except Exception as exc:
            if args.job_id:
                failed_at = iso_now()
                fallback_overview = service._build_snapshot_overview(None)  # type: ignore[attr-defined]
                failed_job = service._build_snapshot_refresh_job(  # type: ignore[attr-defined]
                    job_id=args.job_id,
                    request={key: value for key, value in payload.items() if not str(key).startswith("_job_")},
                    overview=fallback_overview,
                    mode=args.mode,
                    targets=targets or ["price", "corporate", "universes"],
                    symbol_count=len(fallback_overview.get("dataset_snapshots") or []),
                    row_count=sum(
                        int(item.get("row_count") or 0) for item in fallback_overview.get("dataset_snapshots") or []
                    ),
                    warnings=[],
                    errors=[str(exc)],
                    created_at=args.job_created_at or failed_at,
                    started_at=args.job_started_at or failed_at,
                    completed_at=failed_at,
                    status="FAILED",
                    message=f"Snapshot refresh failed: {exc}",
                    blocking_code="SNAPSHOT_REFRESH_FAILED",
                    blocking_target="data_snapshots",
                )
                service._upsert_snapshot_refresh_job(failed_job)  # type: ignore[attr-defined]
                service._clear_snapshot_refresh_runtime_state(args.job_id)  # type: ignore[attr-defined]
            raise
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps(overview, ensure_ascii=False))
        return

    uvicorn.run(app, host="0.0.0.0", port=8000)


if __name__ == "__main__":
    main()

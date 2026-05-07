from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Callable

import uvicorn

from .real_service import RealBacktestPlatformService
from .storage import iso_now
from ._real_service_rebuilt import DEFAULT_BACKTEST_FEE_BPS, DEFAULT_BACKTEST_SLIPPAGE_BPS


def _build_runtime_market_data_provider():
    from .api import build_runtime_market_data_provider

    return build_runtime_market_data_provider()


class _LazyRuntimeMarketDataProvider:
    def __init__(self, builder: Callable[[], Any]) -> None:
        self._builder = builder
        self._provider: Any | None = None

    def _resolve(self) -> Any:
        if self._provider is None:
            self._provider = self._builder()
        return self._provider

    def __getattr__(self, name: str) -> Any:
        return getattr(self._resolve(), name)


def _lazy_runtime_market_data_provider() -> _LazyRuntimeMarketDataProvider:
    return _LazyRuntimeMarketDataProvider(_build_runtime_market_data_provider)


class _LazyApp:
    def __init__(self) -> None:
        self._app = None

    def _resolve(self):
        if self._app is None:
            from .api import create_app

            self._app = create_app(
                market_data_provider=_lazy_runtime_market_data_provider(),
                startup_optimization_recovery_mode=os.getenv("GRIT_STARTUP_OPTIMIZATION_RECOVERY", "interrupt"),
            )
        return self._app

    async def __call__(self, scope, receive, send):
        await self._resolve()(scope, receive, send)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._resolve(), name)


app = _LazyApp()
_WINDOWS_MEMORY_JOB_HANDLE = None


def _default_db_path() -> Path:
    configured = os.getenv("GRIT_BACKTEST_DB")
    return Path(configured) if configured else Path.cwd() / ".grit_backtest_platform.sqlite3"


def _parse_refresh_targets(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [item.strip() for item in raw.split(",") if item.strip()]


def _configure_refresh_memory_guard() -> None:
    if os.name != "nt":
        return
    raw_ratio = os.getenv("GRIT_SNAPSHOT_MEMORY_LIMIT_RATIO")
    try:
        limit_ratio = float(raw_ratio) if raw_ratio is not None else 0.8
    except (TypeError, ValueError):
        limit_ratio = 0.8
    limit_ratio = min(max(limit_ratio, 0.10), 0.95)

    import ctypes
    from ctypes import wintypes

    class MEMORYSTATUSEX(ctypes.Structure):
        _fields_ = [
            ("dwLength", wintypes.DWORD),
            ("dwMemoryLoad", wintypes.DWORD),
            ("ullTotalPhys", ctypes.c_ulonglong),
            ("ullAvailPhys", ctypes.c_ulonglong),
            ("ullTotalPageFile", ctypes.c_ulonglong),
            ("ullAvailPageFile", ctypes.c_ulonglong),
            ("ullTotalVirtual", ctypes.c_ulonglong),
            ("ullAvailVirtual", ctypes.c_ulonglong),
            ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
        ]

    class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_longlong),
            ("PerJobUserTimeLimit", ctypes.c_longlong),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_void_p),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class IO_COUNTERS(ctypes.Structure):
        _fields_ = [
            ("ReadOperationCount", ctypes.c_ulonglong),
            ("WriteOperationCount", ctypes.c_ulonglong),
            ("OtherOperationCount", ctypes.c_ulonglong),
            ("ReadTransferCount", ctypes.c_ulonglong),
            ("WriteTransferCount", ctypes.c_ulonglong),
            ("OtherTransferCount", ctypes.c_ulonglong),
        ]

    class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
            ("IoInfo", IO_COUNTERS),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    memory_status = MEMORYSTATUSEX()
    memory_status.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    if not kernel32.GlobalMemoryStatusEx(ctypes.byref(memory_status)):
        return
    total_physical_bytes = int(memory_status.ullTotalPhys or 0)
    if total_physical_bytes <= 0:
        return

    JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x00000100
    JobObjectExtendedLimitInformation = 9
    job = kernel32.CreateJobObjectW(None, None)
    if not job:
        return
    info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY
    info.ProcessMemoryLimit = int(total_physical_bytes * limit_ratio)
    if not kernel32.SetInformationJobObject(
        job,
        JobObjectExtendedLimitInformation,
        ctypes.byref(info),
        ctypes.sizeof(info),
    ):
        kernel32.CloseHandle(job)
        return
    current_process = kernel32.GetCurrentProcess()
    if not kernel32.AssignProcessToJobObject(job, current_process):
        kernel32.CloseHandle(job)
        return

    global _WINDOWS_MEMORY_JOB_HANDLE
    _WINDOWS_MEMORY_JOB_HANDLE = job


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="grit_backtest_platform.main")
    parser.add_argument(
        "command",
        nargs="?",
        default="serve",
        choices=["serve", "refresh-snapshots", "run-optimization", "backfill-backtest-costs"],
    )
    parser.add_argument("--reason", dest="reason", default=None)
    parser.add_argument("--mode", dest="mode", default="incremental", choices=["incremental", "repair", "full"])
    parser.add_argument("--targets", dest="targets", default=None)
    parser.add_argument("--repair-symbol-limit", dest="repair_symbol_limit", type=int, default=None)
    parser.add_argument("--db-path", dest="db_path", default=None)
    parser.add_argument("--fee-bps", dest="fee_bps", type=float, default=DEFAULT_BACKTEST_FEE_BPS)
    parser.add_argument("--slippage-bps", dest="slippage_bps", type=float, default=DEFAULT_BACKTEST_SLIPPAGE_BPS)
    parser.add_argument("--job-id", dest="job_id", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--job-created-at", dest="job_created_at", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--job-started-at", dest="job_started_at", default=None, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    if args.command == "refresh-snapshots":
        _configure_refresh_memory_guard()
        service = RealBacktestPlatformService(
            args.db_path or _default_db_path(),
            market_data_provider=_lazy_runtime_market_data_provider(),
        )
        payload: dict[str, object] = {"mode": args.mode}
        if args.reason is not None:
            payload["reason"] = args.reason
        targets = _parse_refresh_targets(args.targets)
        if targets:
            payload["targets"] = targets
        if args.repair_symbol_limit is not None:
            payload["repair_symbol_limit"] = max(1, int(args.repair_symbol_limit))
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

    if args.command == "run-optimization":
        if not args.job_id:
            raise ValueError("--job-id is required for run-optimization")
        service = RealBacktestPlatformService(
            args.db_path or _default_db_path(),
            market_data_provider=_lazy_runtime_market_data_provider(),
        )
        started = service.run_optimization_job_worker(args.job_id)
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps({"job_id": args.job_id, "started": bool(started)}, ensure_ascii=False))
        return

    if args.command == "backfill-backtest-costs":
        service = RealBacktestPlatformService(
            args.db_path or _default_db_path(),
            market_data_provider=_lazy_runtime_market_data_provider(),
        )
        rebuilt_runs = service.backfill_permanent_backtest_runs(
            fee_bps=args.fee_bps,
            slippage_bps=args.slippage_bps,
        )
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
        print(
            json.dumps(
                {
                    "fee_bps": args.fee_bps,
                    "slippage_bps": args.slippage_bps,
                    "rebuilt_run_count": len(rebuilt_runs),
                    "runs": rebuilt_runs,
                },
                ensure_ascii=False,
            )
        )
        return

    uvicorn.run(app, host="0.0.0.0", port=8000)


if __name__ == "__main__":
    main()

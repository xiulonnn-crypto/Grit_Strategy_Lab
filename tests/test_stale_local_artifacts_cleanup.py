from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[1]
CLEANUP_SCRIPT = REPO_ROOT / "scripts" / "codex-clean-stale-local-artifacts.ps1"


def _touch_old(path: Path, *, days_old: int = 30) -> None:
    timestamp = time.time() - days_old * 24 * 60 * 60
    os.utime(path, (timestamp, timestamp))


def _write_bytes(path: Path, size: int = 16) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * size)


def _make_full_pair(directory: Path) -> None:
    _write_bytes(directory / ".grit_backtest_platform.sqlite3")
    _write_bytes(directory / ".grit_backtest_platform_market_data.sqlite3")


def test_recovery_cleanup_dry_run_protects_latest_and_manifests(tmp_path: Path) -> None:
    powershell = shutil.which("powershell") or shutil.which("powershell.exe") or shutil.which("pwsh")
    git = shutil.which("git")
    if powershell is None or git is None:
        pytest.skip("PowerShell and git are required for the cleanup script contract test")

    repo = tmp_path / "repo"
    scripts_dir = repo / "scripts"
    recovery = repo / "artifacts" / "recovery"
    scripts_dir.mkdir(parents=True)
    recovery.mkdir(parents=True)
    shutil.copy2(CLEANUP_SCRIPT, scripts_dir / CLEANUP_SCRIPT.name)

    subprocess.run([git, "init"], cwd=repo, check=True, capture_output=True, text=True)

    old_full = recovery / "l1-old-full-with-manifest"
    _make_full_pair(old_full)
    (old_full / "manifest.json").write_text("{}", encoding="utf-8")

    latest_full = recovery / "l1-latest-full-pair"
    _make_full_pair(latest_full)

    latest_targeted = recovery / "l1-latest-targeted-preimage"
    _write_bytes(latest_targeted / "pit-price-preimage.json")

    old_manifest_only = recovery / "l1-old-manifest-only"
    (old_manifest_only / "backup-manifest.json").parent.mkdir(parents=True, exist_ok=True)
    (old_manifest_only / "backup-manifest.json").write_text("{}", encoding="utf-8")

    tracked_note = recovery / "source-notes.md"
    tracked_note.write_text("keep this audit note\n", encoding="utf-8")
    subprocess.run([git, "add", "artifacts/recovery/source-notes.md"], cwd=repo, check=True, capture_output=True, text=True)

    for path in [old_full, *old_full.iterdir(), old_manifest_only, *old_manifest_only.iterdir(), tracked_note]:
        _touch_old(path)

    report_path = tmp_path / "cleanup-report.json"
    subprocess.run(
        [
            powershell,
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(scripts_dir / CLEANUP_SCRIPT.name),
            "-PruneExpired",
            "-ForceScan",
            "-Json",
            "-FullJson",
            "-OnlyRelativePathPrefix",
            "artifacts/recovery",
            "-RecoveryKeepNewest",
            "0",
            "-ReportPath",
            str(report_path),
        ],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    )

    report = json.loads(report_path.read_text(encoding="utf-8-sig"))
    planned_paths = {item["path"] for item in report["planned"]}
    skipped_by_path = {item["path"]: item for item in report["skipped"]}

    assert planned_paths == {
        "artifacts/recovery/l1-old-full-with-manifest/.grit_backtest_platform.sqlite3",
        "artifacts/recovery/l1-old-full-with-manifest/.grit_backtest_platform_market_data.sqlite3",
    }
    assert "artifacts/recovery/l1-old-full-with-manifest" not in planned_paths
    assert "artifacts/recovery/l1-old-full-with-manifest/manifest.json" not in planned_paths
    assert skipped_by_path["artifacts/recovery/l1-latest-full-pair"]["skipReason"] == "protected"
    assert skipped_by_path["artifacts/recovery/l1-latest-targeted-preimage"]["skipReason"] == "protected"
    assert skipped_by_path["artifacts/recovery/l1-old-manifest-only"]["skipReason"] == "protected"
    assert skipped_by_path["artifacts/recovery/l1-old-manifest-only"]["policy"] == "recovery-protected-manifest-evidence"
    assert skipped_by_path["artifacts/recovery/source-notes.md"]["skipReason"].startswith("git-tracked:")


def test_recovery_cleanup_apply_removes_only_eligible_recovery_db_payloads(tmp_path: Path) -> None:
    powershell = shutil.which("powershell") or shutil.which("powershell.exe") or shutil.which("pwsh")
    git = shutil.which("git")
    if powershell is None or git is None:
        pytest.skip("PowerShell and git are required for the cleanup script contract test")

    repo = tmp_path / "repo"
    scripts_dir = repo / "scripts"
    recovery = repo / "artifacts" / "recovery"
    scratch = repo / ".tmp"
    scripts_dir.mkdir(parents=True)
    recovery.mkdir(parents=True)
    scratch.mkdir(parents=True)
    shutil.copy2(CLEANUP_SCRIPT, scripts_dir / CLEANUP_SCRIPT.name)

    subprocess.run([git, "init"], cwd=repo, check=True, capture_output=True, text=True)

    old_full = recovery / "l1-old-full-with-manifest"
    _make_full_pair(old_full)
    (old_full / "manifest.json").write_text("{}", encoding="utf-8")

    latest_full = recovery / "l1-latest-full-pair"
    _make_full_pair(latest_full)

    latest_targeted = recovery / "l1-latest-targeted-preimage"
    _write_bytes(latest_targeted / "pit-price-preimage.json")

    outside_scope = scratch / "old-full-copy.sqlite3"
    _write_bytes(outside_scope)

    for path in [old_full, *old_full.iterdir(), outside_scope]:
        _touch_old(path)

    report_path = tmp_path / "cleanup-report.json"
    subprocess.run(
        [
            powershell,
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(scripts_dir / CLEANUP_SCRIPT.name),
            "-Apply",
            "-PruneExpired",
            "-ForceScan",
            "-Json",
            "-FullJson",
            "-OnlyRelativePathPrefix",
            "artifacts/recovery",
            "-RecoveryKeepNewest",
            "0",
            "-ReportPath",
            str(report_path),
        ],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    )

    report = json.loads(report_path.read_text(encoding="utf-8-sig"))
    removed_paths = {item["path"] for item in report["removed"]}

    assert removed_paths == {
        "artifacts/recovery/l1-old-full-with-manifest/.grit_backtest_platform.sqlite3",
        "artifacts/recovery/l1-old-full-with-manifest/.grit_backtest_platform_market_data.sqlite3",
    }
    assert (old_full / "manifest.json").exists()
    assert not (old_full / ".grit_backtest_platform.sqlite3").exists()
    assert not (old_full / ".grit_backtest_platform_market_data.sqlite3").exists()
    assert (latest_full / ".grit_backtest_platform.sqlite3").exists()
    assert (latest_full / ".grit_backtest_platform_market_data.sqlite3").exists()
    assert (latest_targeted / "pit-price-preimage.json").exists()
    assert outside_scope.exists()


def test_recovery_cleanup_blocks_when_active_db_points_under_recovery(tmp_path: Path) -> None:
    powershell = shutil.which("powershell") or shutil.which("powershell.exe") or shutil.which("pwsh")
    git = shutil.which("git")
    if powershell is None or git is None:
        pytest.skip("PowerShell and git are required for the cleanup script contract test")

    repo = tmp_path / "repo"
    scripts_dir = repo / "scripts"
    recovery = repo / "artifacts" / "recovery"
    scripts_dir.mkdir(parents=True)
    recovery.mkdir(parents=True)
    shutil.copy2(CLEANUP_SCRIPT, scripts_dir / CLEANUP_SCRIPT.name)

    subprocess.run([git, "init"], cwd=repo, check=True, capture_output=True, text=True)
    active_db = recovery / "active-runtime.sqlite3"
    _write_bytes(active_db)
    _write_bytes(recovery / "active-runtime_market_data.sqlite3")
    _write_bytes(recovery / "l1-old-full" / ".grit_backtest_platform_market_data.sqlite3")
    _touch_old(recovery / "l1-old-full")
    _touch_old(recovery / "l1-old-full" / ".grit_backtest_platform_market_data.sqlite3")

    report_path = tmp_path / "cleanup-report.json"
    env = {**os.environ, "GRIT_BACKTEST_DB": str(active_db)}
    completed = subprocess.run(
        [
            powershell,
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(scripts_dir / CLEANUP_SCRIPT.name),
            "-Apply",
            "-PruneExpired",
            "-ForceScan",
            "-Json",
            "-FullJson",
            "-OnlyRelativePathPrefix",
            "artifacts/recovery",
            "-ReportPath",
            str(report_path),
        ],
        cwd=repo,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == 2
    report = json.loads(report_path.read_text(encoding="utf-8-sig"))
    assert report["summary"]["activeDbGuardStatus"] == "blocked-active-db-under-recovery"
    assert report["summary"]["activeWorkspaceDbInRecovery"] is True
    assert report["planned"] == []
    assert (recovery / "l1-old-full" / ".grit_backtest_platform_market_data.sqlite3").exists()

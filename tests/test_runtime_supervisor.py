from __future__ import annotations

import importlib.util
import shutil
import threading
from pathlib import Path
from uuid import uuid4

import pytest


def _load_runtime_supervisor_module():
    module_path = Path(__file__).resolve().parents[1] / "scripts" / "runtime_supervisor.py"
    spec = importlib.util.spec_from_file_location("runtime_supervisor", module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


runtime_supervisor = _load_runtime_supervisor_module()


@pytest.fixture
def supervisor_workspace():
    root = Path(__file__).resolve().parents[1] / ".tmp" / "runtime-supervisor-unit" / uuid4().hex
    root.mkdir(parents=True, exist_ok=True)
    try:
        yield root
    finally:
        shutil.rmtree(root, ignore_errors=True)


def _new_supervisor(workspace):
    return runtime_supervisor.RuntimeSupervisor(
        repo_root=workspace,
        runtime_dir=workspace / ".tmp" / "runtime-supervisor",
    )


def test_concurrent_restart_intents_coalesce_during_cooldown(supervisor_workspace):
    supervisor = _new_supervisor(supervisor_workspace)
    results = []

    def submit_restart() -> None:
        results.append(
            supervisor.restart(
                "backend-api",
                requested_by="codex-thread",
                reason="unit-test",
                force=False,
            )
        )

    threads = [threading.Thread(target=submit_restart) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    statuses = sorted(result["status"] for result in results)
    assert statuses == ["accepted", "cooldown"]


def test_stale_lock_can_be_reclaimed_but_active_lock_cannot(supervisor_workspace, monkeypatch):
    supervisor = _new_supervisor(supervisor_workspace)
    running_pids = {111}
    monkeypatch.setattr(runtime_supervisor, "pid_is_running", lambda pid: int(pid or 0) in running_pids)

    first = supervisor.acquire_lock("backend-api", owner="thread-a", pid=111, ttl_seconds=300)
    blocked = supervisor.acquire_lock("backend-api", owner="thread-b", pid=222, ttl_seconds=300)
    running_pids.clear()
    reclaimed = supervisor.acquire_lock("backend-api", owner="thread-b", pid=222, ttl_seconds=300)

    assert first["acquired"] is True
    assert blocked["acquired"] is False
    assert blocked["status"] == "locked"
    assert reclaimed["acquired"] is True


def test_start_if_not_running_reuses_healthy_instance(supervisor_workspace, monkeypatch):
    supervisor = _new_supervisor(supervisor_workspace)

    def fake_healthcheck(service):
        return {
            "service": service,
            "tier": "singleton",
            "pid": 123,
            "pids": [123],
            "state": "running",
            "health": "healthy",
            "heartbeat_at": "2026-05-08T00:00:00Z",
            "owner": "supervisor",
            "last_command": None,
            "cooldown_until": None,
            "pending_intent_count": 0,
        }

    monkeypatch.setattr(supervisor, "healthcheck", fake_healthcheck)

    result = supervisor.start_if_not_running("backend-api", requested_by="codex-thread")

    assert result["status"] == "already_running"
    assert result["state"]["pid"] == 123


def test_force_quickstart_guard_records_restart_and_reclaims_lock(supervisor_workspace, monkeypatch):
    supervisor = _new_supervisor(supervisor_workspace)

    running_status = {
        "service": "quickstart",
        "tier": "exclusive",
        "pid": None,
        "pids": [],
        "state": "running",
        "health": "healthy",
        "heartbeat_at": "2026-05-08T00:00:00Z",
        "owner": "supervisor",
        "last_command": None,
        "cooldown_until": None,
        "pending_intent_count": 0,
    }

    monkeypatch.setattr(supervisor, "healthcheck", lambda service: dict(running_status, service=service))
    monkeypatch.setattr(runtime_supervisor, "pid_is_running", lambda pid: True)

    first = supervisor.acquire_lock("quickstart", owner="old-quickstart", pid=111, ttl_seconds=300)
    result = supervisor.guard_quickstart(
        owner_pid=222,
        requested_by="QuickStart-Grit.ps1",
        force=True,
        reason="snapshot provider credentials updated",
    )

    assert first["acquired"] is True
    assert result["allowed"] is True
    assert result["restart_intent"]["force"] is True
    assert result["restart_intent"]["reason"] == "snapshot provider credentials updated"
    assert result["lock"]["pid"] == 222

    with supervisor._connect() as conn:
        event = conn.execute(
            """
            SELECT service, command, status, requested_by, reason
            FROM supervisor_events
            WHERE service = 'quickstart' AND command = 'restart'
            ORDER BY id DESC
            LIMIT 1
            """
        ).fetchone()

    assert event is not None
    assert event["status"] == "accepted"
    assert event["requested_by"] == "QuickStart-Grit.ps1"
    assert event["reason"] == "snapshot provider credentials updated"


def test_process_owner_falls_back_to_repo_executable_path(supervisor_workspace, monkeypatch):
    supervisor = _new_supervisor(supervisor_workspace)
    repo_python = supervisor_workspace / ".python-runtime" / "python.exe"

    monkeypatch.setattr(supervisor, "process_executable_path", lambda pid: str(repo_python))
    monkeypatch.setattr(supervisor, "process_command_line", lambda pid: "")

    assert supervisor.process_is_repo_owned("backend-api", 321) is True


def test_frontend_status_accepts_repo_dist_fingerprint_when_command_line_is_unreadable(
    supervisor_workspace,
    monkeypatch,
):
    supervisor = _new_supervisor(supervisor_workspace)

    monkeypatch.setattr(supervisor, "port_listener_pids", lambda port: [789])
    monkeypatch.setattr(supervisor, "process_is_repo_owned", lambda service, pid: False)
    monkeypatch.setattr(supervisor, "http_healthy", lambda url: True)
    monkeypatch.setattr(supervisor, "http_contains_fingerprint", lambda url, fingerprints: True)

    status = supervisor.healthcheck("frontend-preview")

    assert status["state"] == "running"
    assert status["health"] == "healthy"
    assert status["pid"] == 789


def test_force_restart_records_reason_and_cooldown(supervisor_workspace):
    supervisor = _new_supervisor(supervisor_workspace)

    result = supervisor.restart(
        "backend-api",
        requested_by="codex-thread",
        reason="explicit operator force",
        force=True,
    )

    assert result["status"] == "accepted"
    assert result["force"] is True
    assert result["cooldown_until"]

    with supervisor._connect() as conn:
        event = conn.execute(
            """
            SELECT service, command, status, requested_by, reason, result_json
            FROM supervisor_events
            WHERE service = 'backend-api' AND command = 'restart'
            ORDER BY id DESC
            LIMIT 1
            """
        ).fetchone()

    assert event is not None
    assert event["status"] == "accepted"
    assert event["requested_by"] == "codex-thread"
    assert event["reason"] == "explicit operator force"
    assert "cooldown_until" in event["result_json"]


def test_snapshot_refresh_status_reads_existing_runtime_state(supervisor_workspace, monkeypatch):
    service_db = supervisor_workspace / "runtime.db"
    import sqlite3

    conn = sqlite3.connect(service_db)
    conn.execute(
        """
        CREATE TABLE app_runtime_state (
            state_key TEXT PRIMARY KEY,
            state_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        "INSERT INTO app_runtime_state VALUES (?, ?, ?)",
        (
            "snapshot_refresh_runtime",
            '{"job_id":"snap_unit","pid":456,"heartbeat_at":"2026-05-08T01:00:00Z"}',
            "2026-05-08T01:00:00Z",
        ),
    )
    conn.commit()
    conn.close()

    monkeypatch.setenv("GRIT_BACKTEST_DB", str(service_db))
    monkeypatch.setattr(runtime_supervisor, "pid_is_running", lambda pid: int(pid or 0) == 456)
    supervisor = _new_supervisor(supervisor_workspace)

    status = supervisor.healthcheck("snapshot-refresh")

    assert status["state"] == "running"
    assert status["health"] == "healthy"
    assert status["pid"] == 456
    assert status["runtime"]["job_id"] == "snap_unit"

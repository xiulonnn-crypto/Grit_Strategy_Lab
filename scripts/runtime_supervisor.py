from __future__ import annotations

import argparse
import ctypes
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RUNTIME_ROOT = REPO_ROOT / ".tmp" / "runtime-supervisor"
RUNTIME_ROOT_ENV = "GRIT_RUNTIME_SUPERVISOR_ROOT"
SNAPSHOT_REFRESH_RUNTIME_STATE_KEY = "snapshot_refresh_runtime"
OPTIMIZATION_RUNNER_CLAIM_PREFIX = "optimization_runner_claim:"


SERVICE_DEFINITIONS: dict[str, dict[str, Any]] = {
    "backend-api": {
        "tier": "singleton",
        "port": 8000,
        "health_url": "http://127.0.0.1:8000/healthz",
        "cooldown_seconds": 60,
        "owner_patterns": ["grit_backtest_platform.main:app", "grit_backtest_platform.main serve"],
        "aliases": ["backend-api:8000", "backend", "api"],
    },
    "frontend-preview": {
        "tier": "singleton",
        "port": 4173,
        "health_url": "http://127.0.0.1:4173/",
        "cooldown_seconds": 60,
        "owner_patterns": ["preview-server.mjs"],
        "health_fingerprints": ["Grit Backtest Platform"],
        "aliases": ["frontend-preview:4173", "frontend", "preview"],
    },
    "live-acceptance-backend": {
        "tier": "singleton",
        "port": 8010,
        "health_url": "http://127.0.0.1:8010/workspace/overview",
        "cooldown_seconds": 30,
        "owner_patterns": ["grit_backtest_platform.main:app", "--port 8010"],
        "aliases": ["live-acceptance-backend:8010", "live-acceptance"],
    },
    "snapshot-refresh": {
        "tier": "singleton",
        "cooldown_seconds": 120,
        "aliases": ["snapshot_refresh", "snapshots"],
    },
    "optimization-worker": {
        "tier": "singleton",
        "cooldown_seconds": 60,
        "aliases": ["optimization", "optimization-runner"],
    },
    "pit-identity-scraper": {
        "tier": "exclusive",
        "cooldown_seconds": 120,
        "aliases": ["identity-scraper", "pit_identity_scraper"],
    },
    "quickstart": {
        "tier": "exclusive",
        "cooldown_seconds": 90,
        "components": ["backend-api", "frontend-preview"],
        "aliases": ["quickstart:composite", "local-app"],
    },
}


ALIASES: dict[str, str] = {}
for _name, _definition in SERVICE_DEFINITIONS.items():
    ALIASES[_name] = _name
    for _alias in _definition.get("aliases", []):
        ALIASES[str(_alias).lower()] = _name


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utc_now().isoformat().replace("+00:00", "Z")


def parse_iso(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def loads(value: Any, default: Any) -> Any:
    try:
        return json.loads(value) if value else default
    except (TypeError, ValueError, json.JSONDecodeError):
        return default


def normalize_service(service: str) -> str:
    key = str(service or "").strip().lower()
    if key in ALIASES:
        return ALIASES[key]
    if ":" in key:
        base = key.split(":", 1)[0]
        if base in ALIASES:
            return ALIASES[base]
    valid = ", ".join(sorted(SERVICE_DEFINITIONS))
    raise ValueError(f"Unknown service '{service}'. Known services: {valid}")


def pid_is_running(pid: Any) -> bool:
    try:
        process_id = int(pid or 0)
    except (TypeError, ValueError):
        return False
    if process_id <= 0:
        return False
    if process_id == os.getpid():
        return True
    if os.name == "nt":
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        STILL_ACTIVE = 259
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, process_id)
        if not handle:
            return False
        try:
            exit_code = ctypes.c_ulong()
            if not kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
                return False
            return int(exit_code.value) == STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(process_id, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def runtime_root() -> Path:
    configured = os.getenv(RUNTIME_ROOT_ENV)
    return Path(configured) if configured else DEFAULT_RUNTIME_ROOT


def runtime_db_path(repo_root: Path) -> Path:
    configured = os.getenv("GRIT_BACKTEST_DB")
    return Path(configured) if configured else repo_root / ".grit_backtest_platform.sqlite3"


class RuntimeSupervisor:
    def __init__(self, repo_root: Path | None = None, runtime_dir: Path | None = None) -> None:
        self.repo_root = Path(repo_root or REPO_ROOT).resolve()
        self.runtime_dir = Path(runtime_dir or runtime_root()).resolve()
        self.state_dir = self.runtime_dir / "state"
        self.log_dir = self.runtime_dir / "logs"
        self.db_path = self.runtime_dir / "supervisor.sqlite3"
        self.runtime_dir.mkdir(parents=True, exist_ok=True)
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=30, isolation_level=None)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS supervisor_locks (
                    service TEXT PRIMARY KEY,
                    owner TEXT NOT NULL,
                    pid INTEGER NOT NULL,
                    acquired_at TEXT NOT NULL,
                    expires_at TEXT,
                    metadata_json TEXT NOT NULL DEFAULT '{}'
                );
                CREATE TABLE IF NOT EXISTS supervisor_intents (
                    id TEXT PRIMARY KEY,
                    service TEXT NOT NULL,
                    command TEXT NOT NULL,
                    requested_by TEXT NOT NULL,
                    reason TEXT,
                    force INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    result_json TEXT NOT NULL DEFAULT '{}'
                );
                CREATE TABLE IF NOT EXISTS supervisor_service_controls (
                    service TEXT PRIMARY KEY,
                    cooldown_until TEXT,
                    last_command TEXT,
                    last_command_at TEXT,
                    last_requested_by TEXT,
                    last_result_json TEXT NOT NULL DEFAULT '{}'
                );
                CREATE TABLE IF NOT EXISTS supervisor_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    service TEXT NOT NULL,
                    command TEXT NOT NULL,
                    status TEXT NOT NULL,
                    requested_by TEXT,
                    reason TEXT,
                    created_at TEXT NOT NULL,
                    result_json TEXT NOT NULL DEFAULT '{}'
                );
                """
            )

    def _control_row(self, conn: sqlite3.Connection, service: str) -> dict[str, Any]:
        row = conn.execute(
            "SELECT * FROM supervisor_service_controls WHERE service = ?",
            (service,),
        ).fetchone()
        return dict(row) if row else {}

    def _pending_count(self, conn: sqlite3.Connection, service: str) -> int:
        row = conn.execute(
            "SELECT COUNT(*) AS count FROM supervisor_intents WHERE service = ? AND status = 'pending'",
            (service,),
        ).fetchone()
        return int(row["count"] if row else 0)

    def _record_event(
        self,
        conn: sqlite3.Connection,
        *,
        service: str,
        command: str,
        status: str,
        requested_by: str | None = None,
        reason: str | None = None,
        result: dict[str, Any] | None = None,
        created_at: str | None = None,
    ) -> None:
        conn.execute(
            """
            INSERT INTO supervisor_events
                (service, command, status, requested_by, reason, created_at, result_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                service,
                command,
                status,
                requested_by or "",
                reason or "",
                created_at or iso_now(),
                dumps(result or {}),
            ),
        )

    def port_listener_pids(self, port: int) -> list[int]:
        if os.name == "nt":
            pattern = re.compile(rf"^\s*TCP\s+\S+:{int(port)}\s+\S+\s+LISTENING\s+(\d+)\s*$", re.I)
            try:
                output = subprocess.run(
                    ["netstat", "-ano", "-p", "TCP"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
            except Exception:
                return []
            pids: list[int] = []
            for line in output.stdout.splitlines():
                match = pattern.match(line)
                if match:
                    pid = int(match.group(1))
                    if pid not in pids:
                        pids.append(pid)
            return pids
        return []

    def process_command_line(self, pid: int) -> str:
        if os.name != "nt":
            return ""
        command = (
            f"$p = Get-CimInstance Win32_Process -Filter \"ProcessId = {int(pid)}\" "
            "-ErrorAction SilentlyContinue; if ($p) { $p.CommandLine }"
        )
        try:
            output = subprocess.run(
                ["powershell", "-NoProfile", "-Command", command],
                capture_output=True,
                text=True,
                timeout=5,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except Exception:
            return ""
        return str(output.stdout or "").strip()

    def process_executable_path(self, pid: int) -> str:
        if os.name != "nt":
            return ""
        command = f"(Get-Process -Id {int(pid)} -ErrorAction SilentlyContinue).Path"
        try:
            output = subprocess.run(
                ["powershell", "-NoProfile", "-Command", command],
                capture_output=True,
                text=True,
                timeout=5,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except Exception:
            return ""
        return str(output.stdout or "").strip()

    def process_is_repo_owned(self, service: str, pid: int) -> bool:
        executable_path = self.process_executable_path(pid)
        if executable_path:
            normalized_path = executable_path.replace("/", "\\").lower()
            repo_text = str(self.repo_root).replace("/", "\\").lower()
            if repo_text in normalized_path:
                return True

        command_line = self.process_command_line(pid)
        if not command_line:
            return False
        normalized = command_line.replace("/", "\\").lower()
        repo_text = str(self.repo_root).replace("/", "\\").lower()
        if repo_text in normalized:
            return True
        definition = SERVICE_DEFINITIONS[service]
        return all(
            str(pattern).lower() in normalized
            for pattern in definition.get("required_owner_patterns", [])
        ) or any(
            str(pattern).lower() in normalized
            for pattern in definition.get("owner_patterns", [])
        )

    def http_healthy(self, url: str, timeout_seconds: float = 2.0) -> bool:
        try:
            request = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
                return 200 <= int(response.status) < 500
        except (urllib.error.URLError, TimeoutError, OSError):
            return False

    def http_contains_fingerprint(self, url: str, fingerprints: list[str], timeout_seconds: float = 2.0) -> bool:
        if not fingerprints:
            return False
        try:
            request = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
                body = response.read(65536).decode("utf-8", errors="ignore")
        except (urllib.error.URLError, TimeoutError, OSError):
            return False
        return all(fingerprint in body for fingerprint in fingerprints)

    def _runtime_state_rows(self) -> list[dict[str, Any]]:
        path = runtime_db_path(self.repo_root)
        if not path.exists():
            return []
        try:
            conn = sqlite3.connect(path, timeout=3)
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT state_key, state_json, updated_at
                FROM app_runtime_state
                WHERE state_key = ?
                   OR state_key LIKE ?
                """,
                (SNAPSHOT_REFRESH_RUNTIME_STATE_KEY, f"{OPTIMIZATION_RUNNER_CLAIM_PREFIX}%"),
            ).fetchall()
            conn.close()
        except sqlite3.Error:
            return []
        return [dict(row) for row in rows]

    def _snapshot_refresh_runtime_state(self) -> dict[str, Any] | None:
        for row in self._runtime_state_rows():
            if row.get("state_key") == SNAPSHOT_REFRESH_RUNTIME_STATE_KEY:
                state = loads(row.get("state_json"), {})
                if isinstance(state, dict):
                    state.setdefault("heartbeat_at", row.get("updated_at"))
                    return state
        return None

    def _optimization_claim_states(self) -> list[dict[str, Any]]:
        claims: list[dict[str, Any]] = []
        for row in self._runtime_state_rows():
            key = str(row.get("state_key") or "")
            if not key.startswith(OPTIMIZATION_RUNNER_CLAIM_PREFIX):
                continue
            state = loads(row.get("state_json"), {})
            if isinstance(state, dict):
                state.setdefault("state_key", key)
                state.setdefault("heartbeat_at", row.get("updated_at"))
                claims.append(state)
        return claims

    def _base_status(self, service: str) -> dict[str, Any]:
        definition = SERVICE_DEFINITIONS[service]
        with self._connect() as conn:
            control = self._control_row(conn, service)
            pending_count = self._pending_count(conn, service)
        cooldown_until = control.get("cooldown_until")
        last_command = control.get("last_command")
        now_text = iso_now()
        return {
            "service": service,
            "tier": definition["tier"],
            "pid": None,
            "pids": [],
            "state": "unknown",
            "health": "unknown",
            "heartbeat_at": now_text,
            "owner": "supervisor",
            "last_command": last_command,
            "cooldown_until": cooldown_until,
            "pending_intent_count": pending_count,
        }

    def healthcheck(self, service_name: str) -> dict[str, Any]:
        service = normalize_service(service_name)
        definition = SERVICE_DEFINITIONS[service]
        if service == "quickstart":
            components = [self.healthcheck(component) for component in definition["components"]]
            running = all(component.get("state") == "running" for component in components)
            state = self._base_status(service)
            state.update(
                {
                    "components": components,
                    "state": "running" if running else "partial",
                    "health": "healthy" if running else "degraded",
                    "heartbeat_at": max(str(component.get("heartbeat_at") or "") for component in components),
                }
            )
            self.write_state_json(service, state)
            return state

        state = self._base_status(service)
        if service == "snapshot-refresh":
            runtime_state = self._snapshot_refresh_runtime_state()
            if runtime_state:
                pid = int(runtime_state.get("pid") or 0)
                active = bool(pid and pid_is_running(pid))
                state.update(
                    {
                        "pid": pid or None,
                        "pids": [pid] if pid else [],
                        "state": "running" if active else "stale",
                        "health": "healthy" if active else "stale",
                        "heartbeat_at": runtime_state.get("heartbeat_at") or state["heartbeat_at"],
                        "runtime": runtime_state,
                    }
                )
            else:
                state.update({"state": "stopped", "health": "unknown"})
            self.write_state_json(service, state)
            return state

        if service == "optimization-worker":
            claims = self._optimization_claim_states()
            live_claims = [claim for claim in claims if pid_is_running(claim.get("pid"))]
            pids = [int(claim.get("pid") or 0) for claim in live_claims if int(claim.get("pid") or 0) > 0]
            state.update(
                {
                    "pid": pids[0] if pids else None,
                    "pids": pids,
                    "state": "running" if live_claims else ("stale" if claims else "stopped"),
                    "health": "healthy" if live_claims else ("stale" if claims else "unknown"),
                    "active_claim_count": len(live_claims),
                    "claims": live_claims or claims,
                }
            )
            if claims:
                state["heartbeat_at"] = max(str(claim.get("heartbeat_at") or "") for claim in claims)
            self.write_state_json(service, state)
            return state

        port = int(definition.get("port") or 0)
        pids = self.port_listener_pids(port) if port else []
        repo_pids = [pid for pid in pids if self.process_is_repo_owned(service, pid)]
        health_url = str(definition.get("health_url") or "")
        healthy = bool(health_url and self.http_healthy(health_url))
        fingerprints = [str(item) for item in definition.get("health_fingerprints", [])]
        if pids and not repo_pids and healthy and self.http_contains_fingerprint(health_url, fingerprints):
            repo_pids = pids
        if pids and repo_pids and healthy:
            state.update({"pid": repo_pids[0], "pids": repo_pids, "state": "running", "health": "healthy"})
        elif pids and repo_pids:
            state.update({"pid": repo_pids[0], "pids": repo_pids, "state": "degraded", "health": "unhealthy"})
        elif pids:
            state.update({"pid": pids[0], "pids": pids, "state": "blocked", "health": "foreign_listener"})
        else:
            state.update({"state": "stopped", "health": "unknown"})
        self.write_state_json(service, state)
        return state

    def write_state_json(self, service: str, state: dict[str, Any]) -> None:
        state_path = self.state_dir / f"{service}.json"
        tmp_path = state_path.with_suffix(".json.tmp")
        tmp_path.write_text(dumps(state) + "\n", encoding="utf-8")
        tmp_path.replace(state_path)

    def acquire_lock(
        self,
        service_name: str,
        *,
        owner: str,
        pid: int,
        ttl_seconds: int = 300,
        metadata: dict[str, Any] | None = None,
        force_reclaim: bool = False,
    ) -> dict[str, Any]:
        service = normalize_service(service_name)
        now = iso_now()
        expires_at = datetime.fromtimestamp(time.time() + ttl_seconds, timezone.utc).isoformat().replace("+00:00", "Z")
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT * FROM supervisor_locks WHERE service = ?",
                (service,),
            ).fetchone()
            if row:
                lock = dict(row)
                lock_pid = int(lock.get("pid") or 0)
                lock_expiry = parse_iso(lock.get("expires_at"))
                still_valid = pid_is_running(lock_pid) and (lock_expiry is None or lock_expiry > utc_now())
                if still_valid and lock_pid != int(pid) and not force_reclaim:
                    return {
                        "service": service,
                        "acquired": False,
                        "status": "locked",
                        "owner": lock.get("owner"),
                        "pid": lock_pid,
                    }
            conn.execute(
                """
                INSERT INTO supervisor_locks (service, owner, pid, acquired_at, expires_at, metadata_json)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(service) DO UPDATE SET
                    owner = excluded.owner,
                    pid = excluded.pid,
                    acquired_at = excluded.acquired_at,
                    expires_at = excluded.expires_at,
                    metadata_json = excluded.metadata_json
                """,
                (service, owner, int(pid), now, expires_at, dumps(metadata or {})),
            )
            self._record_event(
                conn,
                service=service,
                command="lock",
                status="acquired",
                requested_by=owner,
                result={"pid": int(pid), "expires_at": expires_at},
                created_at=now,
            )
        return {"service": service, "acquired": True, "status": "acquired", "pid": int(pid), "expires_at": expires_at}

    def release_lock(self, service_name: str, *, owner: str | None = None, pid: int | None = None) -> dict[str, Any]:
        service = normalize_service(service_name)
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM supervisor_locks WHERE service = ?", (service,)).fetchone()
            if not row:
                return {"service": service, "released": False, "status": "missing"}
            lock = dict(row)
            if owner and str(lock.get("owner") or "") != owner:
                return {"service": service, "released": False, "status": "owner_mismatch"}
            if pid and int(lock.get("pid") or 0) != int(pid):
                return {"service": service, "released": False, "status": "pid_mismatch"}
            conn.execute("DELETE FROM supervisor_locks WHERE service = ?", (service,))
            self._record_event(conn, service=service, command="lock", status="released", requested_by=owner or "")
        return {"service": service, "released": True, "status": "released"}

    def guard_quickstart(
        self,
        *,
        owner_pid: int,
        requested_by: str = "quickstart",
        force: bool = False,
        reason: str | None = None,
    ) -> dict[str, Any]:
        quickstart_status = self.healthcheck("quickstart")
        if quickstart_status.get("state") == "running" and not force:
            return {
                "service": "quickstart",
                "allowed": False,
                "status": "already_running",
                "message": "QuickStart is already running; reusing the healthy backend and frontend preview.",
                "state": quickstart_status,
            }
        restart_intent = None
        if force:
            restart_intent = self.restart(
                "quickstart",
                requested_by=requested_by,
                reason=reason or "forced QuickStart guard",
                force=True,
            )
        acquired = self.acquire_lock(
            "quickstart",
            owner=requested_by,
            pid=int(owner_pid),
            ttl_seconds=12 * 60 * 60,
            metadata={"command": "quickstart-guard", "force": bool(force), "reason": reason or ""},
            force_reclaim=force,
        )
        if not acquired.get("acquired"):
            return {
                "service": "quickstart",
                "allowed": False,
                "status": "locked",
                "message": f"QuickStart startup is already owned by PID {acquired.get('pid')}.",
                "lock": acquired,
            }
        state = self._base_status("quickstart")
        state.update(
            {
                "pid": int(owner_pid),
                "pids": [int(owner_pid)],
                "state": "starting",
                "health": "pending",
                "last_command": "quickstart-guard",
            }
        )
        self.write_state_json("quickstart", state)
        result = {"service": "quickstart", "allowed": True, "status": "acquired", "lock": acquired}
        if restart_intent:
            result["restart_intent"] = restart_intent
        return result

    def _insert_intent(
        self,
        conn: sqlite3.Connection,
        *,
        service: str,
        command: str,
        requested_by: str,
        reason: str | None,
        force: bool,
        status: str,
        result: dict[str, Any] | None = None,
        created_at: str | None = None,
    ) -> dict[str, Any]:
        created = created_at or iso_now()
        intent_id = f"intent_{uuid4().hex[:12]}"
        payload = result or {}
        conn.execute(
            """
            INSERT INTO supervisor_intents
                (id, service, command, requested_by, reason, force, status, created_at, updated_at, result_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                intent_id,
                service,
                command,
                requested_by,
                reason or "",
                1 if force else 0,
                status,
                created,
                created,
                dumps(payload),
            ),
        )
        return {
            "id": intent_id,
            "service": service,
            "command": command,
            "requested_by": requested_by,
            "reason": reason,
            "force": bool(force),
            "status": status,
            **payload,
        }

    def start_if_not_running(
        self,
        service_name: str,
        *,
        requested_by: str = "codex",
        reason: str | None = None,
    ) -> dict[str, Any]:
        service = normalize_service(service_name)
        status = self.healthcheck(service)
        if status.get("state") == "running":
            result = {
                "service": service,
                "status": "already_running",
                "state": status,
                "message": "Existing healthy instance is running; no start intent was executed.",
            }
            with self._connect() as conn:
                self._record_event(
                    conn,
                    service=service,
                    command="start-if-not-running",
                    status="noop",
                    requested_by=requested_by,
                    reason=reason,
                    result=result,
                )
            return result
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            intent = self._insert_intent(
                conn,
                service=service,
                command="start-if-not-running",
                requested_by=requested_by,
                reason=reason,
                force=False,
                status="pending",
                result={"observed_state": status.get("state"), "observed_health": status.get("health")},
            )
            self._record_event(
                conn,
                service=service,
                command="start-if-not-running",
                status="pending",
                requested_by=requested_by,
                reason=reason,
                result=intent,
            )
        return intent

    def restart(
        self,
        service_name: str,
        *,
        requested_by: str = "codex",
        reason: str | None = None,
        force: bool = False,
    ) -> dict[str, Any]:
        service = normalize_service(service_name)
        definition = SERVICE_DEFINITIONS[service]
        cooldown_seconds = int(definition.get("cooldown_seconds") or 60)
        now = iso_now()
        cooldown_until = datetime.fromtimestamp(time.time() + cooldown_seconds, timezone.utc).isoformat().replace(
            "+00:00",
            "Z",
        )
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            control = self._control_row(conn, service)
            existing_cooldown = parse_iso(control.get("cooldown_until"))
            if existing_cooldown and existing_cooldown > utc_now() and not force:
                intent = self._insert_intent(
                    conn,
                    service=service,
                    command="restart",
                    requested_by=requested_by,
                    reason=reason,
                    force=False,
                    status="cooldown",
                    result={
                        "cooldown_until": control.get("cooldown_until"),
                        "coalesced": True,
                        "message": "Restart intent recorded during cooldown; no process was stopped.",
                    },
                    created_at=now,
                )
                self._record_event(
                    conn,
                    service=service,
                    command="restart",
                    status="cooldown",
                    requested_by=requested_by,
                    reason=reason,
                    result=intent,
                    created_at=now,
                )
                return intent
            result = {
                "cooldown_until": cooldown_until,
                "accepted": True,
                "message": "Restart intent accepted by supervisor; use drain or QuickStart guard for serialized execution.",
            }
            intent = self._insert_intent(
                conn,
                service=service,
                command="restart",
                requested_by=requested_by,
                reason=reason,
                force=force,
                status="accepted",
                result=result,
                created_at=now,
            )
            conn.execute(
                """
                INSERT INTO supervisor_service_controls
                    (service, cooldown_until, last_command, last_command_at, last_requested_by, last_result_json)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(service) DO UPDATE SET
                    cooldown_until = excluded.cooldown_until,
                    last_command = excluded.last_command,
                    last_command_at = excluded.last_command_at,
                    last_requested_by = excluded.last_requested_by,
                    last_result_json = excluded.last_result_json
                """,
                (service, cooldown_until, "restart", now, requested_by, dumps(result)),
            )
            self._record_event(
                conn,
                service=service,
                command="restart",
                status="accepted",
                requested_by=requested_by,
                reason=reason,
                result=intent,
                created_at=now,
            )
        state = self.healthcheck(service)
        state["last_command"] = "restart"
        state["cooldown_until"] = cooldown_until
        self.write_state_json(service, state)
        return intent

    def queue_intent(
        self,
        service_name: str,
        command: str,
        *,
        requested_by: str = "codex",
        reason: str | None = None,
        force: bool = False,
    ) -> dict[str, Any]:
        service = normalize_service(service_name)
        if command not in {"status", "healthcheck", "start-if-not-running", "restart", "reload-config", "reconnect"}:
            raise ValueError(f"Unsupported queued command: {command}")
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            intent = self._insert_intent(
                conn,
                service=service,
                command=command,
                requested_by=requested_by,
                reason=reason,
                force=force,
                status="pending",
            )
            self._record_event(
                conn,
                service=service,
                command=command,
                status="pending",
                requested_by=requested_by,
                reason=reason,
                result=intent,
            )
        return intent

    def drain(self, *, limit: int = 20) -> dict[str, Any]:
        drained: list[dict[str, Any]] = []
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            rows = conn.execute(
                """
                SELECT *
                FROM supervisor_intents
                WHERE status = 'pending'
                ORDER BY created_at ASC
                LIMIT ?
                """,
                (int(limit),),
            ).fetchall()
            for row in rows:
                intent = dict(row)
                result = {
                    "execution": "recorded",
                    "message": "Intent consumed by the local supervisor queue; destructive process changes require explicit force handling.",
                }
                updated_at = iso_now()
                conn.execute(
                    """
                    UPDATE supervisor_intents
                    SET status = 'drained', updated_at = ?, result_json = ?
                    WHERE id = ?
                    """,
                    (updated_at, dumps(result), intent["id"]),
                )
                self._record_event(
                    conn,
                    service=str(intent["service"]),
                    command=str(intent["command"]),
                    status="drained",
                    requested_by=str(intent["requested_by"] or ""),
                    reason=str(intent["reason"] or ""),
                    result=result,
                    created_at=updated_at,
                )
                drained.append({**intent, "status": "drained", "result": result})
        return {"drained_count": len(drained), "items": drained}

    def status(self, service_name: str | None = None) -> dict[str, Any] | list[dict[str, Any]]:
        if service_name:
            return self.healthcheck(service_name)
        return [self.healthcheck(service) for service in sorted(SERVICE_DEFINITIONS)]


def emit(payload: Any, *, json_output: bool) -> None:
    if json_output:
        print(dumps(payload))
        return
    if isinstance(payload, list):
        for item in payload:
            print(f"{item['service']}: {item['state']} ({item['health']})")
        return
    if isinstance(payload, dict):
        service = payload.get("service", "supervisor")
        status = payload.get("status") or payload.get("state") or "ok"
        print(f"{service}: {status}")
        message = payload.get("message")
        if message:
            print(message)
        return
    print(payload)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="runtime_supervisor")
    parser.add_argument("--json", action="store_true", dest="json_output")
    subparsers = parser.add_subparsers(dest="command", required=True)

    status_parser = subparsers.add_parser("status")
    status_parser.add_argument("service", nargs="?")

    health_parser = subparsers.add_parser("healthcheck")
    health_parser.add_argument("service")

    start_parser = subparsers.add_parser("start-if-not-running")
    start_parser.add_argument("service")
    start_parser.add_argument("--requested-by", default="codex")
    start_parser.add_argument("--reason", default=None)

    restart_parser = subparsers.add_parser("restart")
    restart_parser.add_argument("service")
    restart_parser.add_argument("--force", action="store_true")
    restart_parser.add_argument("--requested-by", default="codex")
    restart_parser.add_argument("--reason", default=None)

    queue_parser = subparsers.add_parser("queue")
    queue_parser.add_argument("queued_command")
    queue_parser.add_argument("service")
    queue_parser.add_argument("--force", action="store_true")
    queue_parser.add_argument("--requested-by", default="codex")
    queue_parser.add_argument("--reason", default=None)

    drain_parser = subparsers.add_parser("drain")
    drain_parser.add_argument("--limit", type=int, default=20)

    guard_parser = subparsers.add_parser("guard")
    guard_parser.add_argument("service", choices=["quickstart"])
    guard_parser.add_argument("--owner-pid", type=int, required=True)
    guard_parser.add_argument("--requested-by", default="quickstart")
    guard_parser.add_argument("--force", action="store_true")
    guard_parser.add_argument("--reason", default=None)

    lock_parser = subparsers.add_parser("lock")
    lock_subparsers = lock_parser.add_subparsers(dest="lock_command", required=True)
    acquire_parser = lock_subparsers.add_parser("acquire")
    acquire_parser.add_argument("service")
    acquire_parser.add_argument("--owner", default="codex")
    acquire_parser.add_argument("--pid", type=int, default=os.getpid())
    acquire_parser.add_argument("--ttl-seconds", type=int, default=300)
    release_parser = lock_subparsers.add_parser("release")
    release_parser.add_argument("service")
    release_parser.add_argument("--owner", default=None)
    release_parser.add_argument("--pid", type=int, default=None)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    supervisor = RuntimeSupervisor()
    try:
        if args.command == "status":
            payload = supervisor.status(args.service)
        elif args.command == "healthcheck":
            payload = supervisor.healthcheck(args.service)
        elif args.command == "start-if-not-running":
            payload = supervisor.start_if_not_running(
                args.service,
                requested_by=args.requested_by,
                reason=args.reason,
            )
        elif args.command == "restart":
            payload = supervisor.restart(
                args.service,
                requested_by=args.requested_by,
                reason=args.reason,
                force=args.force,
            )
        elif args.command == "queue":
            payload = supervisor.queue_intent(
                args.service,
                args.queued_command,
                requested_by=args.requested_by,
                reason=args.reason,
                force=args.force,
            )
        elif args.command == "drain":
            payload = supervisor.drain(limit=args.limit)
        elif args.command == "guard":
            payload = supervisor.guard_quickstart(
                owner_pid=args.owner_pid,
                requested_by=args.requested_by,
                force=args.force,
                reason=args.reason,
            )
        elif args.command == "lock":
            if args.lock_command == "acquire":
                payload = supervisor.acquire_lock(
                    args.service,
                    owner=args.owner,
                    pid=args.pid,
                    ttl_seconds=args.ttl_seconds,
                )
            else:
                payload = supervisor.release_lock(args.service, owner=args.owner, pid=args.pid)
        else:
            parser.error(f"Unsupported command: {args.command}")
            return 2
    except Exception as exc:
        payload = {"status": "error", "error": str(exc)}
        emit(payload, json_output=bool(args.json_output))
        return 1
    emit(payload, json_output=bool(args.json_output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

import ctypes
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

import pytest


REPO_ROOT = Path(__file__).resolve().parents[1]
POWERSHELL = shutil.which("powershell") or shutil.which("pwsh")

pytestmark = pytest.mark.skipif(
    os.name != "nt" or POWERSHELL is None,
    reason="The repository validation entry is a Windows PowerShell contract.",
)


FAKE_PYTEST_MODULE = """
import os
from pathlib import Path
import subprocess
import sys
import time

mode = os.environ.get("FAKE_PYTEST_MODE", "success")
print("probe-start", flush=True)
print("中文标准输出", flush=True)
if mode == "failure":
    print("probe-failure", file=sys.stderr, flush=True)
    print("中文错误输出", file=sys.stderr, flush=True)
    raise SystemExit(3)
if mode in {"timeout", "chatty_timeout"}:
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    Path(os.environ["FAKE_PID_PATH"]).write_text(
        f"{os.getpid()}\\n{child.pid}\\n",
        encoding="utf-8",
    )
    if mode == "chatty_timeout":
        counter = 0
        while True:
            print(f"chatty-{counter}", flush=True)
            counter += 1
    time.sleep(30)
print("probe-end", flush=True)
"""


def _stage_script(tmp_path: Path) -> tuple[Path, Path]:
    script_dir = tmp_path / "scripts"
    script_dir.mkdir()
    script_path = script_dir / "codex-test-backend.ps1"
    shutil.copy2(REPO_ROOT / "scripts" / "codex-test-backend.ps1", script_path)
    (tmp_path / "pytest.py").write_text(FAKE_PYTEST_MODULE, encoding="utf-8")
    report_path = tmp_path / "harness" / "reports" / "smoke" / "latest-backend.txt"
    return script_path, report_path


def _command(script_path: Path, timeout_seconds: int) -> list[str]:
    assert POWERSHELL is not None
    return [
        POWERSHELL,
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(script_path),
        "-PythonExecutable",
        sys.executable,
        "-TimeoutSeconds",
        str(timeout_seconds),
    ]


def _process_is_running(process_id: int) -> bool:
    process_query_limited_information = 0x1000
    still_active = 259
    handle = ctypes.windll.kernel32.OpenProcess(process_query_limited_information, False, process_id)
    if not handle:
        return False
    try:
        exit_code = ctypes.c_ulong()
        if not ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
            return False
        return exit_code.value == still_active
    finally:
        ctypes.windll.kernel32.CloseHandle(handle)


@pytest.mark.parametrize(
    ("mode", "expected_returncode", "expected_status", "expected_exit_code"),
    [
        ("success", 0, "PASSED", "0"),
        ("failure", 1, "FAILED", "3"),
    ],
)
def test_backend_entry_persists_terminal_status_and_streamed_output(
    tmp_path: Path,
    mode: str,
    expected_returncode: int,
    expected_status: str,
    expected_exit_code: str,
) -> None:
    script_path, report_path = _stage_script(tmp_path)
    environment = os.environ.copy()
    environment["FAKE_PYTEST_MODE"] = mode

    completed = subprocess.run(
        _command(script_path, timeout_seconds=10),
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=20,
        check=False,
    )

    report = report_path.read_text(encoding="utf-8")
    status_lines = [line.strip() for line in report.splitlines() if line.startswith("status = ")]
    assert completed.returncode == expected_returncode
    assert "report_schema = codex-backend-v2" in report
    assert status_lines == [f"status = {expected_status}"]
    assert "# Result" in report
    assert f"exit_code = {expected_exit_code}" in report
    assert "started_at = " in report
    assert "finished_at = " in report
    assert "elapsed_seconds = " in report
    assert "probe-start" in report
    assert "中文标准输出" in report
    if mode == "success":
        assert "probe-end" in report
    else:
        assert "[stderr] probe-failure" in report
        assert "[stderr] 中文错误输出" in report


@pytest.mark.parametrize("mode", ["timeout", "chatty_timeout"])
def test_backend_entry_overwrites_stale_report_before_work_and_times_out_process_tree(
    tmp_path: Path,
    mode: str,
) -> None:
    script_path, report_path = _stage_script(tmp_path)
    report_path.parent.mkdir(parents=True)
    report_path.write_text("OLD-SENTINEL\n", encoding="utf-8")
    environment = os.environ.copy()
    environment["FAKE_PYTEST_MODE"] = mode
    pid_path = tmp_path / "fake-processes.txt"
    environment["FAKE_PID_PATH"] = str(pid_path)
    started = time.monotonic()

    process = subprocess.Popen(
        _command(script_path, timeout_seconds=1),
        cwd=tmp_path,
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    try:
        running_report = ""
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if report_path.exists():
                running_report = report_path.read_text(encoding="utf-8")
                if (
                    "status = RUNNING" in running_report
                    and "probe-start" in running_report
                    and pid_path.exists()
                ):
                    break
            if process.poll() is not None:
                break
            time.sleep(0.05)

        assert "OLD-SENTINEL" not in running_report
        assert "status = RUNNING" in running_report
        assert "probe-start" in running_report

        process.communicate(timeout=15)
    finally:
        if process.poll() is None:
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                capture_output=True,
                check=False,
            )

    report = report_path.read_text(encoding="utf-8")
    status_lines = [line.strip() for line in report.splitlines() if line.startswith("status = ")]
    parent_pid, child_pid = [int(value) for value in pid_path.read_text(encoding="utf-8").splitlines()]
    assert process.returncode == 1
    assert time.monotonic() - started < 10
    assert status_lines == ["status = TIMED_OUT"]
    assert "# Result" in report
    assert "exit_code = -1" in report
    assert "cleanup_status = CONFIRMED" in report
    cleanup_method = next(
        line.removeprefix("cleanup_method = ")
        for line in report.splitlines()
        if line.startswith("cleanup_method = ")
    )
    assert cleanup_method in {
        "job-object-kill-on-close",
        "taskkill-tree",
        "cim-recursive",
    }
    assert "probe-end" not in report
    if mode == "chatty_timeout":
        assert "chatty-" in report
    assert _process_is_running(parent_pid) is False
    assert _process_is_running(child_pid) is False

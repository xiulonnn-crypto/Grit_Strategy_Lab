from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace


def _load_guard_module():
    module_path = Path(__file__).resolve().parents[1] / "conftest.py"
    spec = importlib.util.spec_from_file_location("repo_pytest_temp_guard", module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


guard = _load_guard_module()


def _config(basetemp: str | None = None, cache_dir: str = ".tmp/pytest-cache"):
    return SimpleNamespace(
        option=SimpleNamespace(basetemp=basetemp),
        getini=lambda name: cache_dir if name == "cache_dir" else None,
    )


def test_pytest_temp_guard_allows_tmp_paths() -> None:
    repo_root = Path(__file__).resolve().parents[1]

    assert guard._repo_temp_path_violation(".tmp/pytest/guard-run", repo_root) is None
    assert guard._repo_temp_path_violation(repo_root / ".tmp" / "pytest" / "guard-run", repo_root) is None


def test_pytest_temp_guard_rejects_root_relative_basetemp() -> None:
    repo_root = Path(__file__).resolve().parents[1]

    violation = guard._repo_temp_path_violation("pytesttmp-root-run", repo_root)

    assert violation is not None
    assert "inside the repo root" in violation
    assert ".tmp" in violation


def test_pytest_temp_guard_rejects_external_basetemp_when_project_tmp_is_required() -> None:
    repo_root = Path(__file__).resolve().parents[1]

    violation = guard._repo_temp_path_violation(
        repo_root.parent / "external-pytest",
        repo_root,
        require_project_tmp=True,
    )

    assert violation is not None
    assert "outside the project temp root" in violation
    assert ".tmp" in violation


def test_pytest_temp_guard_reports_basetemp_cache_and_env_paths() -> None:
    repo_root = Path(__file__).resolve().parents[1]

    errors = guard._collect_temp_guard_errors(
        _config(basetemp="pytesttmp-manual-run", cache_dir="pytest-cache-files-manual"),
        repo_root,
        env={
            "TEMP": str(repo_root / "pytest-cache-files-manual"),
            "TMP": str(repo_root.parent / "external-temp"),
            "TMPDIR": str(repo_root / ".tmp" / "python-temp"),
        },
    )

    assert len(errors) == 3
    assert errors[0].startswith("--basetemp:")
    assert errors[1].startswith("cache_dir:")
    assert errors[2].startswith("TEMP:")

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


def test_pytest_temp_defaults_use_project_runtime_when_no_basetemp() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    config = _config()
    env = {
        "PYTEST_DEBUG_TEMPROOT": str(repo_root.parent / "denied-pytest-temp"),
        "TMPDIR": "",
        "TEMP": str(repo_root.parent / "denied-python-temp"),
        "TMP": str(repo_root.parent / "denied-python-temp"),
    }

    guard._apply_pytest_temp_defaults(config, repo_root, env=env, process_id=12345)

    assert config.option.basetemp is None
    for name in ("PYTEST_DEBUG_TEMPROOT", "TMPDIR", "TEMP", "TMP"):
        assert guard._repo_temp_path_violation(env[name], repo_root, require_project_tmp=True) is None
        temp_path = Path(env[name])
        assert temp_path.name == "python-temp-12345"
        assert temp_path.parent.name == "pytest-runtime"
        assert temp_path.parent.parent.name == ".tmp"
    assert guard._collect_temp_guard_errors(config, repo_root, env=env) == []


def test_pytest_temp_defaults_preserve_repo_root_violations_for_guard() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    config = _config()
    bad_repo_temp = str(repo_root / "pytesttmp-manual-run")
    env = {
        "PYTEST_DEBUG_TEMPROOT": str(repo_root.parent / "denied-pytest-temp"),
        "TMPDIR": bad_repo_temp,
        "TEMP": str(repo_root.parent / "denied-python-temp"),
        "TMP": str(repo_root.parent / "denied-python-temp"),
    }

    guard._apply_pytest_temp_defaults(config, repo_root, env=env, process_id=12345)
    errors = guard._collect_temp_guard_errors(config, repo_root, env=env)

    assert env["TMPDIR"] == bad_repo_temp
    assert any(error.startswith("TMPDIR:") for error in errors)


def test_repo_tmp_path_helper_uses_project_runtime() -> None:
    repo_root = Path(__file__).resolve().parents[1]

    tmp_path = guard._make_repo_tmp_path(repo_root, "test path / with spaces", process_id=12345)

    assert tmp_path.exists()
    assert tmp_path.parent.name == "12345"
    assert tmp_path.parent.parent.name == "tmp-paths"
    assert tmp_path.parent.parent.parent.name == "pytest-runtime"
    assert tmp_path.parent.parent.parent.parent.name == ".tmp"
    assert "test_path_with_spaces" in tmp_path.name

from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path
from typing import Mapping, MutableMapping
from uuid import uuid4

import pytest


_ENV_TEMP_VARS = ("PYTEST_DEBUG_TEMPROOT", "TMPDIR", "TEMP", "TMP")
_PYTEST_TEMP_HINT = ".tmp/pytest-runtime/<run-name>"
_PYTEST_RUNTIME_DIR = ".tmp/pytest-runtime"
_PYTHON_TEMP_DIR = "python-temp"


def _resolve_for_repo(path_value: str | os.PathLike[str], repo_root: Path) -> Path:
    candidate = Path(path_value).expanduser()
    if not candidate.is_absolute():
        candidate = repo_root / candidate
    return candidate.resolve(strict=False)


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def _repo_temp_path_violation(
    path_value: object,
    repo_root: Path,
    *,
    require_project_tmp: bool = False,
) -> str | None:
    if not path_value:
        return None

    repo_root = repo_root.resolve(strict=False)
    allowed_temp_root = (repo_root / ".tmp").resolve(strict=False)
    resolved_path = _resolve_for_repo(str(path_value), repo_root)

    if _is_relative_to(resolved_path, allowed_temp_root):
        return None

    if _is_relative_to(resolved_path, repo_root):
        return (
            f"{resolved_path} is inside the repo root but outside {allowed_temp_root}. "
            f"Use {_PYTEST_TEMP_HINT} for pytest basetemp and temp roots."
        )

    if require_project_tmp:
        return (
            f"{resolved_path} is outside the project temp root {allowed_temp_root}. "
            f"Use {_PYTEST_TEMP_HINT} for pytest basetemp and temp roots."
        )

    return None


def _is_project_tmp_path(path_value: object, repo_root: Path) -> bool:
    if not path_value:
        return False
    repo_root = repo_root.resolve(strict=False)
    allowed_temp_root = (repo_root / ".tmp").resolve(strict=False)
    resolved_path = _resolve_for_repo(str(path_value), repo_root)
    return _is_relative_to(resolved_path, allowed_temp_root)


def _is_repo_local_non_tmp_path(path_value: object, repo_root: Path) -> bool:
    if not path_value:
        return False
    repo_root = repo_root.resolve(strict=False)
    allowed_temp_root = (repo_root / ".tmp").resolve(strict=False)
    resolved_path = _resolve_for_repo(str(path_value), repo_root)
    return _is_relative_to(resolved_path, repo_root) and not _is_relative_to(
        resolved_path,
        allowed_temp_root,
    )


def _apply_pytest_temp_defaults(
    config: pytest.Config,
    repo_root: Path,
    *,
    env: MutableMapping[str, str] | None = None,
    process_id: int | None = None,
) -> None:
    """Keep pytest and Python temp files inside the project sandbox by default."""

    env = os.environ if env is None else env
    repo_root = repo_root.resolve(strict=False)
    pid = process_id or os.getpid()
    runtime_root = repo_root / _PYTEST_RUNTIME_DIR
    python_temp = runtime_root / f"{_PYTHON_TEMP_DIR}-{pid}"

    python_temp.mkdir(parents=True, exist_ok=True)

    for name in _ENV_TEMP_VARS:
        value = env.get(name)
        if _is_project_tmp_path(value, repo_root):
            continue
        if _is_repo_local_non_tmp_path(value, repo_root):
            continue
        env[name] = str(python_temp)

    tempfile.tempdir = str(python_temp)


def _make_repo_tmp_path(repo_root: Path, node_name: str, process_id: int | None = None) -> Path:
    pid = process_id or os.getpid()
    safe_name = re.sub(r"[^A-Za-z0-9_.-]+", "_", node_name).strip("._-")[:40] or "test"
    root = repo_root.resolve(strict=False) / _PYTEST_RUNTIME_DIR / "tmp-paths" / str(pid)
    path = root / f"{safe_name}-{uuid4().hex}"
    path.mkdir(parents=True, exist_ok=False)
    return path


def _collect_temp_guard_errors(
    config: pytest.Config,
    repo_root: Path,
    env: Mapping[str, str] | None = None,
) -> list[str]:
    errors: list[str] = []
    env = os.environ if env is None else env

    basetemp = getattr(config.option, "basetemp", None)
    basetemp_violation = _repo_temp_path_violation(basetemp, repo_root, require_project_tmp=True)
    if basetemp_violation:
        errors.append(f"--basetemp: {basetemp_violation}")

    cache_dir_getter = getattr(config, "getini", None)
    if cache_dir_getter is not None:
        cache_dir_violation = _repo_temp_path_violation(
            cache_dir_getter("cache_dir"),
            repo_root,
            require_project_tmp=True,
        )
        if cache_dir_violation:
            errors.append(f"cache_dir: {cache_dir_violation}")

    for name in _ENV_TEMP_VARS:
        value = env.get(name)
        violation = _repo_temp_path_violation(value, repo_root)
        if violation:
            errors.append(f"{name}: {violation}")

    return errors


@pytest.hookimpl(tryfirst=True)
def pytest_configure(config: pytest.Config) -> None:
    repo_root = Path(config.rootpath)
    _apply_pytest_temp_defaults(config, repo_root)
    errors = _collect_temp_guard_errors(config, repo_root)
    if errors:
        joined = "\n- ".join(errors)
        raise pytest.UsageError(f"Refusing repo-root pytest temp paths:\n- {joined}")


@pytest.fixture
def tmp_path(request: pytest.FixtureRequest) -> Path:
    return _make_repo_tmp_path(Path(request.config.rootpath), request.node.name)

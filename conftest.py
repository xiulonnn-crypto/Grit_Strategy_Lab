from __future__ import annotations

import os
from pathlib import Path
from typing import Mapping

import pytest


_ENV_TEMP_VARS = ("PYTEST_DEBUG_TEMPROOT", "TMPDIR", "TEMP", "TMP")
_PYTEST_TEMP_HINT = ".tmp/pytest-runtime/<run-name>"


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


def pytest_configure(config: pytest.Config) -> None:
    repo_root = Path(config.rootpath)
    errors = _collect_temp_guard_errors(config, repo_root)
    if errors:
        joined = "\n- ".join(errors)
        raise pytest.UsageError(f"Refusing repo-root pytest temp paths:\n- {joined}")

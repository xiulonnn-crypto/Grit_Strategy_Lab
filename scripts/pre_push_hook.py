from __future__ import annotations

import argparse
import importlib.util
import os
import subprocess
import sys
from datetime import date
from pathlib import Path


_MANAGED_FILES = [
    "CHANGELOG.md",
    "src/grit_backtest_platform/_version.py",
]


def _load_workflow_module(repo_root: Path):
    workflow_path = repo_root / "src" / "grit_backtest_platform" / "release_workflow.py"
    spec = importlib.util.spec_from_file_location("grit_release_workflow", workflow_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load release workflow module from {workflow_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _truthy_env(name: str) -> bool:
    value = os.getenv(name)
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _managed_files_dirty(repo_root: Path) -> bool:
    completed = subprocess.run(
        ["git", "status", "--porcelain", "--", *_MANAGED_FILES],
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return bool(completed.stdout.strip())


def _git_stdout(repo_root: Path, args: list[str]) -> str | None:
    completed = subprocess.run(
        ["git", *args],
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if completed.returncode != 0:
        return None
    return completed.stdout.strip()


def _infer_minimum_revision(repo_root: Path) -> int:
    upstream = _git_stdout(repo_root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])
    if not upstream:
        return 1

    divergence = _git_stdout(repo_root, ["rev-list", "--left-right", "--count", f"{upstream}...HEAD"])
    if not divergence:
        return 1

    parts = divergence.split()
    if len(parts) != 2:
        return 1

    behind, ahead = (int(part) for part in parts)
    if behind == 0 and ahead == 0:
        return 2
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--repo-root", default=".")
    args, _ = parser.parse_known_args(argv)

    repo_root = Path(args.repo_root).resolve()
    try:
        release_date_value = os.getenv("GRIT_CHANGELOG_RELEASE_DATE")
        effective_date = date.fromisoformat(release_date_value) if release_date_value else None
        minimum_revision = _infer_minimum_revision(repo_root)
        workflow = _load_workflow_module(repo_root)
        result = workflow.prepare_push(
            repo_root,
            release=_truthy_env("GRIT_CHANGELOG_RELEASE"),
            release_version=os.getenv("GRIT_CHANGELOG_RELEASE_VERSION") or None,
            effective_date=effective_date,
            minimum_revision=minimum_revision,
        )
    except Exception as exc:
        print(f"pre-push: failed to prepare changelog metadata: {exc}", file=sys.stderr)
        return 1

    if result.changed or _managed_files_dirty(repo_root):
        prepared_label = result.snapshot_title or result.release_version or "push metadata"
        changed_files = ", ".join(_MANAGED_FILES)
        print(
            f"pre-push: prepared {prepared_label}; push is blocked until you commit the generated metadata update.",
            file=sys.stderr,
        )
        print(
            f"pre-push: review and commit {changed_files}, then rerun the same push command.",
            file=sys.stderr,
        )
        if result.commit_message:
            print(f"pre-push: suggested commit message: {result.commit_message}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

import argparse
import importlib.util
import os
import shutil
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


def _read_push_updates() -> list[list[str]]:
    if sys.stdin.isatty():
        return []

    updates: list[list[str]] = []
    for raw_line in sys.stdin:
        parts = raw_line.strip().split()
        if len(parts) >= 4:
            updates.append(parts[:4])
    return updates


def _remote_base_ref(push_updates: list[list[str]]) -> str | None:
    if len(push_updates) != 1:
        return None

    remote_sha = push_updates[0][3]
    if not remote_sha or set(remote_sha) == {"0"}:
        return None
    return remote_sha


def _run_fast_gate(repo_root: Path, remote: str | None, push_updates: list[list[str]]) -> int:
    script_path = repo_root / "scripts" / "codex-validate-fast.ps1"
    if not script_path.exists():
        print(f"pre-push: fast validation script is missing: {script_path}", file=sys.stderr)
        return 1

    powershell = shutil.which("powershell.exe") or shutil.which("powershell") or shutil.which("pwsh")
    if powershell is None:
        print("pre-push: PowerShell executable not found; cannot run fast validation.", file=sys.stderr)
        return 1

    command = [
        powershell,
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(script_path),
        "-Scope",
        "Committed",
        "-Remote",
        remote or "origin",
        "-SkipFetch",
    ]
    base_ref = _remote_base_ref(push_updates)
    if base_ref:
        command.extend(["-BaseRef", base_ref])

    completed = subprocess.run(command, cwd=repo_root, check=False)
    if completed.returncode == 2:
        print(
            "pre-push: not fast eligible; fast gate did not run broad impacted tests automatically.",
            file=sys.stderr,
        )
        print(
            "pre-push: run `powershell -ExecutionPolicy Bypass -File .\\scripts\\codex-validate-impact.ps1 -Scope Committed` "
            "for impacted validation, or `powershell -ExecutionPolicy Bypass -File .\\scripts\\codex-validate-full.ps1` "
            "for release/full validation.",
            file=sys.stderr,
        )
        print(
            "pre-push: for an urgent operator-approved push, rerun git push with --no-verify.",
            file=sys.stderr,
        )
    return completed.returncode


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
    parser.add_argument("remote", nargs="?")
    parser.add_argument("remote_url", nargs="?")
    args, _ = parser.parse_known_args(argv)

    repo_root = Path(args.repo_root).resolve()
    push_updates = _read_push_updates()
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
        print(
            "pre-push: CHANGELOG entries must be concise UTF-8 Chinese release notes and must not expose "
            "local paths, accounts, secrets, internal routes, raw payloads, stack traces, or source/test file lists.",
            file=sys.stderr,
        )
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

    return _run_fast_gate(repo_root, args.remote, push_updates)


if __name__ == "__main__":
    raise SystemExit(main())

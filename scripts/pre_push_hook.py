from __future__ import annotations

import argparse
import hashlib
import importlib.util
import os
import re
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


def _git_lines(repo_root: Path, args: list[str]) -> list[str]:
    completed = subprocess.run(
        ["git", *args],
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if completed.returncode != 0:
        return []
    return [line.strip().replace("\\", "/") for line in completed.stdout.splitlines() if line.strip()]


def _git_check(repo_root: Path, args: list[str]) -> tuple[bool, str]:
    completed = subprocess.run(
        ["git", *args],
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    output = "\n".join(part for part in (completed.stdout.strip(), completed.stderr.strip()) if part)
    return completed.returncode == 0, output


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


def _parse_gate_summary_text(text: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for line in text.splitlines():
        match = re.match(r"^-\s+([a-zA-Z0-9_]+):\s+(.*)$", line)
        if match:
            fields[match.group(1)] = match.group(2).strip()
    return fields


def _is_false(value: str | None) -> bool:
    return (value or "").strip().lower() == "false"


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _content_fingerprint_for_commit_range(
    repo_root: Path,
    *,
    base_sha: str,
    head_sha: str,
) -> str | None:
    changed_files = _git_lines(repo_root, ["diff", "--name-only", f"{base_sha}...{head_sha}"])
    if not changed_files:
        return _sha256_text("")

    entries: list[str] = []
    for path in sorted(set(changed_files)):
        blob_sha = _git_stdout(repo_root, ["rev-parse", "--verify", f"{head_sha}:{path}"])
        entries.append(f"{path}\t{blob_sha or '<missing>'}")
    return _sha256_text("\n".join(entries))


def _current_head_is_metadata_only_child(
    repo_root: Path,
    *,
    validated_head_sha: str | None,
    current_head_sha: str | None,
) -> tuple[bool, str]:
    if not validated_head_sha or not current_head_sha:
        return False, "missing validated or current HEAD"
    if validated_head_sha == current_head_sha:
        return False, "current HEAD already matches latest impact head"

    parent_line = _git_stdout(repo_root, ["rev-list", "--parents", "-n", "1", current_head_sha])
    parent_parts = parent_line.split() if parent_line else []
    if len(parent_parts) != 2:
        return False, "current HEAD is not a single-parent metadata commit"

    parent_sha = parent_parts[1]
    if parent_sha != validated_head_sha:
        return False, "current HEAD is not a direct child of latest impact head"

    commit_count = _git_stdout(repo_root, ["rev-list", "--count", f"{validated_head_sha}..{current_head_sha}"])
    if commit_count != "1":
        return False, "current HEAD is not a single metadata commit on top of latest impact head"

    changed_files = _git_lines(repo_root, ["diff", "--name-only", f"{validated_head_sha}..{current_head_sha}"])
    if not changed_files:
        return False, "metadata child has no changed files"

    managed_files = {path.replace("\\", "/") for path in _MANAGED_FILES}
    unmanaged_files = [path for path in changed_files if path not in managed_files]
    if unmanaged_files:
        return False, f"metadata child changed non-managed files: {', '.join(unmanaged_files)}"

    return True, f"current HEAD only adds generated push metadata: {', '.join(changed_files)}"


def _metadata_child_reuse_checks(
    repo_root: Path,
    *,
    validated_head_sha: str | None,
    current_head_sha: str | None,
    changelog_prepared: bool,
) -> tuple[bool, str]:
    if not changelog_prepared:
        return False, "push metadata was not prepared and validated in this pre-push run"
    if not validated_head_sha or not current_head_sha:
        return False, "missing validated or current HEAD"

    changed_files = _git_lines(repo_root, ["diff", "--name-only", f"{validated_head_sha}..{current_head_sha}"])
    if not changed_files:
        return False, "metadata child has no changed files to check"

    ok, output = _git_check(repo_root, ["diff", "--check", f"{validated_head_sha}..{current_head_sha}", "--", *changed_files])
    if not ok:
        return False, f"metadata child whitespace check failed: {output or '<no output>'}"

    return True, f"metadata child passed changelog preparation and whitespace checks: {', '.join(changed_files)}"


def _impact_gate_matches_push(
    fields: dict[str, str],
    *,
    report_text: str,
    expected_head_sha: str | None,
    expected_base_sha: str | None,
    metadata_child_reason: str | None = None,
    worktree_reuse_reason: str | None = None,
) -> tuple[bool, str]:
    if fields.get("status") != "ok":
        return False, f"latest impact status is {fields.get('status', '<missing>')}, not ok"
    scope = fields.get("scope")
    if scope not in {"Committed", "WorkingTree"}:
        return False, f"latest impact scope is {fields.get('scope', '<missing>')}, not Committed or reusable WorkingTree"
    if not _is_false(fields.get("plan_only")):
        return False, "latest impact was PlanOnly; full impacted tests did not run"
    if not _is_false(fields.get("skip_tests")):
        return False, "latest impact skipped tests"
    if expected_base_sha and fields.get("base_sha") != expected_base_sha:
        return False, "latest impact base_sha does not match the remote push base"
    if "duration=" not in report_text or "elapsed_seconds" not in fields:
        return False, "latest impact summary is missing step duration evidence"
    if scope == "WorkingTree":
        if worktree_reuse_reason:
            return True, f"latest WorkingTree impact evidence matches current push; {worktree_reuse_reason}"
        return False, "latest WorkingTree impact evidence lacks content-fingerprint reuse proof"
    if expected_head_sha and fields.get("head_sha") != expected_head_sha:
        if metadata_child_reason:
            return True, f"latest impact evidence matches validated parent; {metadata_child_reason}"
        return False, "latest impact head_sha does not match current HEAD"
    return True, "latest impact evidence matches current push"


def _working_tree_impact_reuse_checks(
    repo_root: Path,
    *,
    fields: dict[str, str],
    expected_base_sha: str | None,
    current_head_sha: str | None,
) -> tuple[bool, str]:
    if fields.get("scope") != "WorkingTree":
        return False, "latest impact was not a WorkingTree report"
    if not expected_base_sha:
        return False, "WorkingTree impact reuse requires a known remote push base"
    if not current_head_sha:
        return False, "WorkingTree impact reuse cannot resolve current HEAD"
    if fields.get("validation_content_basis") != "git-blob-map-v1":
        return False, "WorkingTree impact summary is missing git-blob-map-v1 content basis"
    expected_fingerprint = fields.get("validation_content_fingerprint")
    if not expected_fingerprint:
        return False, "WorkingTree impact summary is missing validation_content_fingerprint"
    if fields.get("head_sha") != expected_base_sha:
        return (
            False,
            "WorkingTree impact reuse requires the validated HEAD to equal the remote push base",
        )

    current_fingerprint = _content_fingerprint_for_commit_range(
        repo_root,
        base_sha=expected_base_sha,
        head_sha=current_head_sha,
    )
    if current_fingerprint != expected_fingerprint:
        return False, "WorkingTree impact content fingerprint does not match current committed push"

    return True, "content fingerprint matches the committed diff from remote base"


def _impact_gate_allows_push(
    repo_root: Path,
    *,
    expected_base_sha: str | None,
    changelog_prepared: bool = False,
) -> tuple[bool, str]:
    summary_path = repo_root / "harness" / "reports" / "smoke" / "latest-impact-gate.md"
    if not summary_path.exists():
        return False, f"latest impact summary is missing: {summary_path}"

    report_text = summary_path.read_text(encoding="utf-8")
    fields = _parse_gate_summary_text(report_text)
    head_sha = _git_stdout(repo_root, ["rev-parse", "HEAD"])
    metadata_child_reason: str | None = None
    worktree_reuse_reason: str | None = None

    if fields.get("scope") == "WorkingTree":
        worktree_reuse_ok, reuse_reason = _working_tree_impact_reuse_checks(
            repo_root,
            fields=fields,
            expected_base_sha=expected_base_sha,
            current_head_sha=head_sha,
        )
        if worktree_reuse_ok:
            worktree_reuse_reason = reuse_reason
        else:
            return False, reuse_reason
    else:
        metadata_child_ok, metadata_child_reason_candidate = _current_head_is_metadata_only_child(
            repo_root,
            validated_head_sha=fields.get("head_sha"),
            current_head_sha=head_sha,
        )
        if metadata_child_ok:
            extra_ok, extra_reason = _metadata_child_reuse_checks(
                repo_root,
                validated_head_sha=fields.get("head_sha"),
                current_head_sha=head_sha,
                changelog_prepared=changelog_prepared,
            )
            if extra_ok:
                metadata_child_reason = f"{metadata_child_reason_candidate}; {extra_reason}"
            else:
                return False, extra_reason
    return _impact_gate_matches_push(
        fields,
        report_text=report_text,
        expected_head_sha=head_sha,
        expected_base_sha=expected_base_sha,
        metadata_child_reason=metadata_child_reason,
        worktree_reuse_reason=worktree_reuse_reason,
    )


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

    impact_ok, impact_reason = _impact_gate_allows_push(
        repo_root,
        expected_base_sha=base_ref,
        changelog_prepared=True,
    )
    if impact_ok:
        print(f"pre-push: {impact_reason}; allowing push without rerunning fast gate.", file=sys.stderr)
        return 0

    completed = subprocess.run(command, cwd=repo_root, check=False)
    if completed.returncode == 2:
        impact_ok, impact_reason = _impact_gate_allows_push(
            repo_root,
            expected_base_sha=base_ref,
            changelog_prepared=True,
        )
        if impact_ok:
            print(
                f"pre-push: fast gate returned not-fast, but {impact_reason}; allowing push.",
                file=sys.stderr,
            )
            return 0
        print(
            "pre-push: not fast eligible; fast gate did not run broad impacted tests automatically.",
            file=sys.stderr,
        )
        print(f"pre-push: latest impact evidence was not reusable: {impact_reason}", file=sys.stderr)
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

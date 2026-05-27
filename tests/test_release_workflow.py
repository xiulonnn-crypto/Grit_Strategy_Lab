from __future__ import annotations

import importlib.util
import subprocess
import sys
from datetime import date
from pathlib import Path


def _load_prepare_push():
    module_path = Path(__file__).resolve().parents[1] / "src" / "grit_backtest_platform" / "release_workflow.py"
    spec = importlib.util.spec_from_file_location("grit_release_workflow", module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.prepare_push


prepare_push = _load_prepare_push()


def _load_pre_push_hook_module():
    module_path = Path(__file__).resolve().parents[1] / "scripts" / "pre_push_hook.py"
    spec = importlib.util.spec_from_file_location("grit_pre_push_hook", module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


pre_push_hook = _load_pre_push_hook_module()


REPO_ROOT = Path(__file__).resolve().parents[1]


def _git(repo_root: Path, *args: str) -> str:
    completed = subprocess.run(
        ["git", *args],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return completed.stdout.strip()


def _write_repo_files(repo_root: Path, changelog: str, version: str = "0.1.1") -> None:
    (repo_root / "src" / "grit_backtest_platform").mkdir(parents=True, exist_ok=True)
    (repo_root / "CHANGELOG.md").write_text(changelog, encoding="utf-8")
    (repo_root / "src" / "grit_backtest_platform" / "_version.py").write_text(
        "from __future__ import annotations\n\n"
        '__all__ = ["__version__"]\n\n'
        f'__version__ = "{version}"\n',
        encoding="utf-8",
    )


def _write_impact_summary(
    repo_root: Path,
    *,
    head_sha: str,
    base_sha: str = "",
    scope: str = "Committed",
    validation_content_fingerprint: str | None = None,
) -> None:
    summary_dir = repo_root / "harness" / "reports" / "smoke"
    summary_dir.mkdir(parents=True)
    lines = [
        "# Codex Impact Gate",
        "",
        "- status: ok",
        f"- scope: {scope}",
        "- plan_only: False",
        "- skip_tests: False",
        f"- head_sha: {head_sha}",
        f"- base_sha: {base_sha}",
    ]
    if validation_content_fingerprint is not None:
        lines.extend(
            [
                "- validation_content_basis: git-blob-map-v1",
                f"- validation_content_fingerprint: {validation_content_fingerprint}",
            ]
        )
    lines.extend(
        [
            "- elapsed_seconds: 12.3",
            "",
            "## Steps",
            "- [ok] backend targeted tests (duration=10.0s)",
            "",
        ]
    )
    (summary_dir / "latest-impact-gate.md").write_text("\n".join(lines), encoding="utf-8")


def _write_full_summary(
    repo_root: Path,
    *,
    head_sha: str,
    base_sha: str = "",
    target: str = "all",
    include_duration: bool = True,
) -> None:
    summary_dir = repo_root / "harness" / "reports" / "smoke"
    summary_dir.mkdir(parents=True)
    lines = [
        "# Codex Full Gate",
        "",
        "- status: ok",
        f"- target: {target}",
        "- elapsed_seconds: 123.4",
        f"- head_sha: {head_sha}",
        f"- base_sha: {base_sha}",
        "",
        "## Steps",
    ]
    if include_duration:
        lines.append("- [ok] backend fixed entry (duration=60.0s)")
    else:
        lines.append("- [ok] backend fixed entry")
    lines.append("")
    (summary_dir / "latest-full-gate.md").write_text("\n".join(lines), encoding="utf-8")


def test_pre_push_hook_uses_single_remote_sha_as_fast_gate_base() -> None:
    remote_sha = "1234567890abcdef1234567890abcdef12345678"

    assert (
        pre_push_hook._remote_base_ref(
            [["refs/heads/main", "abcdef", "refs/heads/main", remote_sha]]
        )
        == remote_sha
    )


def test_pre_push_hook_does_not_guess_base_for_new_or_multi_ref_push() -> None:
    assert (
        pre_push_hook._remote_base_ref(
            [["refs/heads/new", "abcdef", "refs/heads/new", "0000000000000000000000000000000000000000"]]
        )
        is None
    )
    assert (
        pre_push_hook._remote_base_ref(
            [
                ["refs/heads/a", "abcdef", "refs/heads/a", "1234567890abcdef1234567890abcdef12345678"],
                ["refs/heads/b", "fedcba", "refs/heads/b", "abcdef1234567890abcdef1234567890abcdef12"],
            ]
        )
        is None
    )


def test_pre_push_accepts_matching_impact_gate_evidence() -> None:
    fields = {
        "status": "ok",
        "scope": "Committed",
        "plan_only": "False",
        "skip_tests": "False",
        "head_sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "base_sha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "elapsed_seconds": "439.838",
    }

    ok, reason = pre_push_hook._impact_gate_matches_push(
        fields,
        report_text="## Steps\n- [ok] backend targeted tests (duration=405.4s)\n",
        expected_head_sha="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        expected_base_sha="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    )

    assert ok is True
    assert "matches" in reason


def test_pre_push_accepts_metadata_only_child_of_validated_impact_head() -> None:
    fields = {
        "status": "ok",
        "scope": "Committed",
        "plan_only": "False",
        "skip_tests": "False",
        "head_sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "base_sha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "elapsed_seconds": "439.838",
    }

    ok, reason = pre_push_hook._impact_gate_matches_push(
        fields,
        report_text="## Steps\n- [ok] backend targeted tests (duration=405.4s)\n",
        expected_head_sha="cccccccccccccccccccccccccccccccccccccccc",
        expected_base_sha="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        metadata_child_reason="current HEAD only adds generated push metadata: CHANGELOG.md",
    )

    assert ok is True
    assert "validated parent" in reason


def test_pre_push_accepts_matching_full_gate_evidence() -> None:
    fields = {
        "status": "ok",
        "target": "all",
        "head_sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "base_sha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "elapsed_seconds": "812.5",
    }

    ok, reason = pre_push_hook._full_gate_matches_push(
        fields,
        report_text="## Steps\n- [ok] backend fixed entry (duration=610.0s)\n",
        expected_head_sha="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        expected_base_sha="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    )

    assert ok is True
    assert "full evidence" in reason


def test_pre_push_accepts_metadata_only_child_of_validated_full_head(tmp_path: Path) -> None:
    _git(tmp_path, "init")
    _git(tmp_path, "config", "user.email", "test@example.com")
    _git(tmp_path, "config", "user.name", "Test User")
    _write_repo_files(
        tmp_path,
        """# 更新日志

## [Unreleased]

### 修复 (Fixed)

- **初始条目**: 用于测试发布元数据。
""",
    )
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-m", "feat: validated full parent")
    validated_head = _git(tmp_path, "rev-parse", "HEAD")
    _write_full_summary(tmp_path, head_sha=validated_head)

    _write_repo_files(
        tmp_path,
        """# 更新日志

## [Unreleased]

## [0.1.1-002] - 2026-04-15 - 修复

### 修复 (Fixed)

- **初始条目**: 用于测试发布元数据。
""",
    )
    _git(tmp_path, "add", "CHANGELOG.md", "src/grit_backtest_platform/_version.py")
    _git(tmp_path, "commit", "-m", "docs(changelog): snapshot 0.1.1-002")

    ok, reason = pre_push_hook._full_gate_allows_push(
        tmp_path,
        expected_base_sha=None,
        changelog_prepared=True,
    )

    assert ok is True
    assert "validated parent" in reason
    assert "whitespace" in reason


def test_pre_push_rejects_full_gate_without_duration_evidence() -> None:
    fields = {
        "status": "ok",
        "target": "all",
        "head_sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "base_sha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "elapsed_seconds": "812.5",
    }

    ok, reason = pre_push_hook._full_gate_matches_push(
        fields,
        report_text="## Steps\n- [ok] backend fixed entry\n",
        expected_head_sha="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        expected_base_sha="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    )

    assert ok is False
    assert "duration" in reason


def test_pre_push_accepts_reusable_working_tree_impact_after_commit(tmp_path: Path) -> None:
    _git(tmp_path, "init")
    _git(tmp_path, "config", "user.email", "test@example.com")
    _git(tmp_path, "config", "user.name", "Test User")
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "gate.py").write_text("VALUE = 1\n", encoding="utf-8")
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-m", "base")
    base_sha = _git(tmp_path, "rev-parse", "HEAD")

    (tmp_path / "src" / "gate.py").write_text("VALUE = 2\n", encoding="utf-8")
    (tmp_path / "src" / "new_gate.py").write_text("ENABLED = True\n", encoding="utf-8")
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-m", "feat: gate optimization")
    head_sha = _git(tmp_path, "rev-parse", "HEAD")
    fingerprint = pre_push_hook._content_fingerprint_for_commit_range(
        tmp_path,
        base_sha=base_sha,
        head_sha=head_sha,
    )
    _write_impact_summary(
        tmp_path,
        head_sha=base_sha,
        base_sha=base_sha,
        scope="WorkingTree",
        validation_content_fingerprint=fingerprint,
    )

    ok, reason = pre_push_hook._impact_gate_allows_push(
        tmp_path,
        expected_base_sha=base_sha,
        changelog_prepared=True,
    )

    assert ok is True
    assert "WorkingTree impact evidence" in reason
    assert "content fingerprint" in reason


def test_pre_push_rejects_working_tree_impact_when_content_changed(tmp_path: Path) -> None:
    _git(tmp_path, "init")
    _git(tmp_path, "config", "user.email", "test@example.com")
    _git(tmp_path, "config", "user.name", "Test User")
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "gate.py").write_text("VALUE = 1\n", encoding="utf-8")
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-m", "base")
    base_sha = _git(tmp_path, "rev-parse", "HEAD")

    (tmp_path / "src" / "gate.py").write_text("VALUE = 2\n", encoding="utf-8")
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-m", "feat: different gate change")
    _write_impact_summary(
        tmp_path,
        head_sha=base_sha,
        base_sha=base_sha,
        scope="WorkingTree",
        validation_content_fingerprint="0" * 64,
    )

    ok, reason = pre_push_hook._impact_gate_allows_push(
        tmp_path,
        expected_base_sha=base_sha,
        changelog_prepared=True,
    )

    assert ok is False
    assert "content fingerprint" in reason


def test_pre_push_rejects_stale_or_plan_only_impact_evidence() -> None:
    fields = {
        "status": "ok",
        "scope": "Committed",
        "plan_only": "True",
        "skip_tests": "False",
        "head_sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "base_sha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "elapsed_seconds": "1.2",
    }

    ok, reason = pre_push_hook._impact_gate_matches_push(
        fields,
        report_text="## Steps\n- [skip] tests (duration=1ms)\n",
        expected_head_sha="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        expected_base_sha="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    )

    assert ok is False
    assert "PlanOnly" in reason


def test_gate_self_test_plan_only_writes_non_latest_summary() -> None:
    fast_script = (REPO_ROOT / "scripts" / "codex-validate-fast.ps1").read_text(encoding="utf-8")
    impact_script = (REPO_ROOT / "scripts" / "codex-validate-impact.ps1").read_text(encoding="utf-8")

    assert "[string]$SummaryPath" in fast_script
    assert "[string]$SummaryPath" in impact_script
    assert "SummaryPath must stay under $reportRoot" in fast_script
    assert "$reportRootWithSeparator" in fast_script
    assert "$selfTestDir = Join-Path $reportDir 'self-test'" in fast_script
    assert "$selfTestSummaryPath = Join-Path $selfTestDir" in fast_script
    assert "'-SummaryPath', $selfTestSummaryPath" in fast_script
    assert "validation_content_fingerprint" in fast_script
    assert "Get-ValidationContentFingerprint" in fast_script
    assert "$parameters.SummaryPath = $SummaryPath" in impact_script


def test_publish_impact_wrapper_codifies_single_working_tree_gate_flow() -> None:
    script = (REPO_ROOT / "scripts" / "codex-publish-impact.ps1").read_text(encoding="utf-8")

    assert "codex-validate-impact.ps1" in script
    assert "'WorkingTree'" in script
    assert "'Committed'" in script
    assert "git $($Arguments -join ' ')" in script
    assert "@('diff', '--cached', '--check', '--')" in script
    assert "HEAD:$TargetBranch" in script
    assert "latest-push-attestation.md" in script
    assert "Invoke-GitCapture -Arguments @('status', '--porcelain')" in script
    assert "Get-GitLines -Arguments @('status', '--porcelain')" not in script


def test_publish_impact_wrapper_guards_trace_assets_and_external_push() -> None:
    script = (REPO_ROOT / "scripts" / "codex-publish-impact.ps1").read_text(encoding="utf-8")

    assert "ConfirmExternalPush" in script
    assert "AllowTraceCandidates" in script
    assert "FAIL|BLOCKED|NOT_CHECKED" in script
    assert "output/ui-artifact-trace/" in script
    assert "id-translation\\.csv" in script
    assert "suggested commit message:" in script
    assert "CHANGELOG.md" in script
    assert "src/grit_backtest_platform/_version.py" in script


def test_full_gate_summary_records_duration_and_git_context() -> None:
    script = (REPO_ROOT / "scripts" / "codex-validate-full.ps1").read_text(encoding="utf-8")

    assert "duration=$durationText" in script
    assert "- elapsed_seconds:" in script
    assert "- head_sha:" in script
    assert "- base_sha:" in script
    assert "git fetch" in script
    assert "ahead/behind" in script
    assert "SummaryPath must stay under" in script


def test_publish_full_wrapper_codifies_release_publish_flow() -> None:
    script = (REPO_ROOT / "scripts" / "codex-publish-full.ps1").read_text(encoding="utf-8")

    assert "codex-validate-full.ps1" in script
    assert "latest-full-push-attestation.md" in script
    assert "ConfirmExternalPush" in script
    assert "AllowTraceCandidates" in script
    assert "HEAD:$TargetBranch" in script
    assert "Invoke-PushWithMetadataLoop" in script
    assert "Invoke-FullGate" in script
    assert "'-Target', $Target" in script
    assert "IncludeLiveAcceptance" in script
    assert "StrictGlobalTypes" in script
    assert "CHANGELOG.md" in script
    assert "src/grit_backtest_platform/_version.py" in script
    assert "codex-publish-full only pushes after -Target all" in script


def test_pre_push_detects_single_generated_metadata_child(tmp_path: Path) -> None:
    _git(tmp_path, "init")
    _git(tmp_path, "config", "user.email", "test@example.com")
    _git(tmp_path, "config", "user.name", "Test User")
    _write_repo_files(
        tmp_path,
        """# 更新日志

## [Unreleased]

### 修复 (Fixed)

- **初始条目**: 用于测试发布元数据。
""",
    )
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-m", "feat: validated parent")
    validated_head = _git(tmp_path, "rev-parse", "HEAD")

    (tmp_path / "CHANGELOG.md").write_text(
        """# 更新日志

## [Unreleased]

## [0.1.1-001] - 2026-05-21 - 修复初始条目

### 修复 (Fixed)

- **初始条目**: 用于测试发布元数据。
""",
        encoding="utf-8",
    )
    _git(tmp_path, "add", "CHANGELOG.md")
    _git(tmp_path, "commit", "-m", "docs(changelog): snapshot 0.1.1-001")
    current_head = _git(tmp_path, "rev-parse", "HEAD")

    ok, reason = pre_push_hook._current_head_is_metadata_only_child(
        tmp_path,
        validated_head_sha=validated_head,
        current_head_sha=current_head,
    )

    assert ok is True
    assert "CHANGELOG.md" in reason


def test_pre_push_reuses_parent_impact_after_metadata_child_checks(tmp_path: Path) -> None:
    _git(tmp_path, "init")
    _git(tmp_path, "config", "user.email", "test@example.com")
    _git(tmp_path, "config", "user.name", "Test User")
    _write_repo_files(
        tmp_path,
        """# 更新日志

## [Unreleased]

### 修复 (Fixed)

- **推送元数据**: 用于测试父提交影响面证据复用。
""",
    )
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-m", "feat: validated parent")
    validated_head = _git(tmp_path, "rev-parse", "HEAD")
    _write_impact_summary(tmp_path, head_sha=validated_head)

    (tmp_path / "CHANGELOG.md").write_text(
        """# 更新日志

## [Unreleased]

## [0.1.1-001] - 2026-05-21 - 修复推送元数据

### 修复 (Fixed)

- **推送元数据**: 用于测试父提交影响面证据复用。
""",
        encoding="utf-8",
    )
    _git(tmp_path, "add", "CHANGELOG.md")
    _git(tmp_path, "commit", "-m", "docs(changelog): snapshot 0.1.1-001")

    ok, reason = pre_push_hook._impact_gate_allows_push(
        tmp_path,
        expected_base_sha=None,
        changelog_prepared=True,
    )

    assert ok is True
    assert "validated parent" in reason
    assert "whitespace" in reason


def test_pre_push_rejects_metadata_reuse_without_changelog_preparation(tmp_path: Path) -> None:
    _git(tmp_path, "init")
    _git(tmp_path, "config", "user.email", "test@example.com")
    _git(tmp_path, "config", "user.name", "Test User")
    _write_repo_files(
        tmp_path,
        """# 更新日志

## [Unreleased]

### 修复 (Fixed)

- **推送元数据**: 用于测试未校验元数据时拒绝复用。
""",
    )
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-m", "feat: validated parent")
    validated_head = _git(tmp_path, "rev-parse", "HEAD")
    _write_impact_summary(tmp_path, head_sha=validated_head)

    (tmp_path / "CHANGELOG.md").write_text(
        """# 更新日志

## [Unreleased]

## [0.1.1-001] - 2026-05-21 - 修复推送元数据

### 修复 (Fixed)

- **推送元数据**: 用于测试未校验元数据时拒绝复用。
""",
        encoding="utf-8",
    )
    _git(tmp_path, "add", "CHANGELOG.md")
    _git(tmp_path, "commit", "-m", "docs(changelog): snapshot 0.1.1-001")

    ok, reason = pre_push_hook._impact_gate_allows_push(
        tmp_path,
        expected_base_sha=None,
        changelog_prepared=False,
    )

    assert ok is False
    assert "not prepared" in reason


def test_pre_push_rejects_non_metadata_child(tmp_path: Path) -> None:
    _git(tmp_path, "init")
    _git(tmp_path, "config", "user.email", "test@example.com")
    _git(tmp_path, "config", "user.name", "Test User")
    _write_repo_files(
        tmp_path,
        """# 更新日志

## [Unreleased]

### 修复 (Fixed)

- **初始条目**: 用于测试发布元数据。
""",
    )
    (tmp_path / "src" / "non_metadata.py").write_text("VALUE = 1\n", encoding="utf-8")
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-m", "feat: validated parent")
    validated_head = _git(tmp_path, "rev-parse", "HEAD")

    (tmp_path / "src" / "non_metadata.py").write_text("VALUE = 2\n", encoding="utf-8")
    _git(tmp_path, "add", "src/non_metadata.py")
    _git(tmp_path, "commit", "-m", "feat: source child")
    current_head = _git(tmp_path, "rev-parse", "HEAD")

    ok, reason = pre_push_hook._current_head_is_metadata_only_child(
        tmp_path,
        validated_head_sha=validated_head,
        current_head_sha=current_head,
    )

    assert ok is False
    assert "non-managed" in reason


def test_pre_push_rejects_metadata_merge_child(tmp_path: Path) -> None:
    _git(tmp_path, "init")
    _git(tmp_path, "config", "user.email", "test@example.com")
    _git(tmp_path, "config", "user.name", "Test User")
    _write_repo_files(
        tmp_path,
        """# 更新日志

## [Unreleased]

### 修复 (Fixed)

- **初始条目**: 用于测试发布元数据。
""",
    )
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-m", "feat: validated parent")
    validated_head = _git(tmp_path, "rev-parse", "HEAD")

    _git(tmp_path, "checkout", "-b", "metadata-side")
    (tmp_path / "CHANGELOG.md").write_text(
        """# 更新日志

## [Unreleased]

## [0.1.1-001] - 2026-05-21 - 修复初始条目

### 修复 (Fixed)

- **初始条目**: 用于测试发布元数据。
""",
        encoding="utf-8",
    )
    _git(tmp_path, "add", "CHANGELOG.md")
    _git(tmp_path, "commit", "-m", "docs(changelog): snapshot 0.1.1-001")

    _git(tmp_path, "checkout", "master")
    _git(tmp_path, "merge", "--no-ff", "metadata-side", "-m", "merge metadata side")
    current_head = _git(tmp_path, "rev-parse", "HEAD")

    ok, reason = pre_push_hook._current_head_is_metadata_only_child(
        tmp_path,
        validated_head_sha=validated_head,
        current_head_sha=current_head,
    )

    assert ok is False
    assert "single-parent" in reason


def test_prepare_push_creates_revision_snapshot_and_resets_unreleased(tmp_path: Path) -> None:
    _write_repo_files(
        tmp_path,
        """# 更新日志

## [Unreleased]

### 修复 (Fixed)

- **组合保存提示**: 保存失败时会说明用户下一步该怎么处理。

## [0.1.1] - 2026-03-31

### 新增 (Added)

- **恢复基线**: 建立首个可运行版本。
""",
    )

    result = prepare_push(tmp_path, release=False, effective_date=date(2026, 4, 15))
    changelog = (tmp_path / "CHANGELOG.md").read_text(encoding="utf-8")

    assert result.mode == "revision"
    assert result.snapshot_title == "0.1.1-001"
    assert result.changed_files == ["CHANGELOG.md"]
    assert "## [Unreleased]\n\n## [0.1.1-001] - 2026-04-15 - 修复组合保存提示" in changelog
    assert "- **组合保存提示**: 保存失败时会说明用户下一步该怎么处理。" in changelog


def test_prepare_push_merges_duplicate_unreleased_and_increments_revision(tmp_path: Path) -> None:
    _write_repo_files(
        tmp_path,
        """# 更新日志

## [Unreleased]

### 新增 (Added)

- **资产候选说明**: 新增更清楚的资产选择解释。

## [0.1.1-001] - 2026-03-31

### 修复 (Fixed)

- **历史记录**: 旧版本记录保持可读。

## [0.1.1] - 2026-03-31

### 优化 (Changed)

- **启动流程**: 本地启动说明更清楚。

## [Unreleased]

### 修复 (Fixed)

- **组合保存提示**: 保存失败时会说明用户下一步该怎么处理。
""",
    )

    result = prepare_push(tmp_path, release=False, effective_date=date(2026, 4, 15))
    changelog = (tmp_path / "CHANGELOG.md").read_text(encoding="utf-8")

    assert result.snapshot_title == "0.1.1-002"
    assert changelog.count("## [Unreleased]") == 1
    assert "## [0.1.1-002] - 2026-04-15 - 新增资产候选说明，并修复组合保存提示" in changelog


def test_prepare_push_release_updates_version_file_and_dates(tmp_path: Path) -> None:
    _write_repo_files(
        tmp_path,
        """# 更新日志

## [Unreleased]

### 新增 (Added)

- **优化工作台**: 新增从配置到结果查看的完整工作流。

## [0.1.1] - 2026-03-31

### 新增 (Added)

- **恢复基线**: 建立首个可运行版本。
""",
        version="0.1.1",
    )

    result = prepare_push(
        tmp_path,
        release=True,
        release_version="0.1.2",
        effective_date=date(2026, 4, 15),
    )
    changelog = (tmp_path / "CHANGELOG.md").read_text(encoding="utf-8")
    version_text = (tmp_path / "src" / "grit_backtest_platform" / "_version.py").read_text(encoding="utf-8")

    assert result.mode == "release"
    assert result.snapshot_title == "0.1.2"
    assert result.release_version == "0.1.2"
    assert "## [0.1.2] - 2026-04-15 - 新增优化工作台" in changelog
    assert '__version__ = "0.1.2"' in version_text


def test_prepare_push_is_noop_when_unreleased_is_empty(tmp_path: Path) -> None:
    _write_repo_files(
        tmp_path,
        """# 更新日志

## [Unreleased]

## [0.1.1] - 2026-03-31

### 新增 (Added)

- **恢复基线**: 建立首个可运行版本。
""",
    )

    result = prepare_push(tmp_path, release=False, effective_date=date(2026, 4, 15))

    assert result.mode == "noop"
    assert result.changed is False
    assert result.changed_files == []


def test_prepare_push_rejects_theme_heading_inside_unreleased(tmp_path: Path) -> None:
    _write_repo_files(
        tmp_path,
        """# 更新日志

## [Unreleased]

### 体验提升

- **资产候选说明**: 新增更清楚的资产选择解释。

## [0.1.1] - 2026-03-31

### 新增 (Added)

- **恢复基线**: 建立首个可运行版本。
""",
    )

    try:
        prepare_push(tmp_path, release=False, effective_date=date(2026, 4, 15))
    except ValueError as exc:
        assert "unsupported subsection headings" in str(exc)
        assert "### 体验提升" in str(exc)
    else:
        raise AssertionError("prepare_push should reject theme headings inside Unreleased")


def test_prepare_push_rejects_sensitive_internal_bullet(tmp_path: Path) -> None:
    _write_repo_files(
        tmp_path,
        """# 更新日志

## [Unreleased]

### 修复 (Fixed)

- **调试路径**: 修复 C:\\Fin\\Project\\data.sqlite 中的测试记录。

## [0.1.1] - 2026-03-31

### 新增 (Added)

- **恢复基线**: 建立首个可运行版本。
""",
    )

    try:
        prepare_push(tmp_path, release=False, effective_date=date(2026, 4, 15))
    except ValueError as exc:
        assert "本机绝对路径" in str(exc)
    else:
        raise AssertionError("prepare_push should reject sensitive changelog bullets")


def test_prepare_push_honors_minimum_revision_for_backfilled_post_push_snapshot(
    tmp_path: Path,
) -> None:
    _write_repo_files(
        tmp_path,
        """# Changelog

## [Unreleased]

### Fixed

- **回填快照**: 后补推送不会复用已有编号。

## [0.1.1] - 2026-03-31

### Added

- **稳定版本**: 建立首个稳定记录。
""",
    )

    result = prepare_push(
        tmp_path,
        release=False,
        effective_date=date(2026, 4, 15),
        minimum_revision=2,
    )
    changelog = (tmp_path / "CHANGELOG.md").read_text(encoding="utf-8")

    assert result.mode == "revision"
    assert result.snapshot_title == "0.1.1-002"
    assert "## [Unreleased]\n\n## [0.1.1-002] - 2026-04-15 - 修复回填快照" in changelog
    assert "### 修复 (Fixed)" in changelog

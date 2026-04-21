from __future__ import annotations

import importlib.util
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


def _write_repo_files(repo_root: Path, changelog: str, version: str = "0.1.1") -> None:
    (repo_root / "src" / "grit_backtest_platform").mkdir(parents=True)
    (repo_root / "CHANGELOG.md").write_text(changelog, encoding="utf-8")
    (repo_root / "src" / "grit_backtest_platform" / "_version.py").write_text(
        'from __future__ import annotations\n\n'
        '__all__ = ["__version__"]\n\n'
        f'__version__ = "{version}"\n',
        encoding="utf-8",
    )


def test_prepare_push_creates_revision_snapshot_and_resets_unreleased(tmp_path: Path) -> None:
    _write_repo_files(
        tmp_path,
        """# 更新日志

## [未发布]

### 修复

- 修复优化结果过滤问题。

## [0.1.1] - 2026-03-31

### 新增

- 已发布内容。
""",
    )

    result = prepare_push(tmp_path, release=False, effective_date=date(2026, 4, 15))
    changelog = (tmp_path / "CHANGELOG.md").read_text(encoding="utf-8")

    assert result.mode == "revision"
    assert result.snapshot_title == "0.1.1-001"
    assert result.changed_files == ["CHANGELOG.md"]
    assert "## [Unreleased]\n\n## [0.1.1-001] - 2026-04-15" in changelog
    assert "- 修复优化结果过滤问题。" in changelog


def test_prepare_push_merges_duplicate_unreleased_and_increments_revision(tmp_path: Path) -> None:
    _write_repo_files(
        tmp_path,
        """# 更新日志

## [未发布]

### 新增

- 第一批改动。

## [0.1.1-001] - 2026-03-31

### 修复

- 之前的推送快照。

## [0.1.1] - 2026-03-31

### 变更

- 正式发版。

## [Unreleased]

### 修复

- 第二批改动。
""",
    )

    result = prepare_push(tmp_path, release=False, effective_date=date(2026, 4, 15))
    changelog = (tmp_path / "CHANGELOG.md").read_text(encoding="utf-8")

    assert result.snapshot_title == "0.1.1-002"
    assert changelog.count("## [Unreleased]") == 1
    assert "第一批改动" in changelog
    assert "第二批改动" in changelog
    assert "## [0.1.1-002] - 2026-04-15" in changelog


def test_prepare_push_release_updates_version_file_and_dates(tmp_path: Path) -> None:
    _write_repo_files(
        tmp_path,
        """# 更新日志

## [Unreleased]

### 新增

- 正式发布前的最后改动。

## [0.1.1] - 2026-03-31

### 新增

- 已发布内容。
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
    assert "## [0.1.2] - 2026-04-15" in changelog
    assert '__version__ = "0.1.2"' in version_text


def test_prepare_push_is_noop_when_unreleased_is_empty(tmp_path: Path) -> None:
    _write_repo_files(
        tmp_path,
        """# 更新日志

## [Unreleased]

## [0.1.1] - 2026-03-31

### 新增

- 已发布内容。
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

## [未发布]

### 快照刷新

- 这是不被允许的主题型小标题。

## [0.1.1] - 2026-03-31

### 新增

- 已发布内容。
""",
    )

    try:
        prepare_push(tmp_path, release=False, effective_date=date(2026, 4, 15))
    except ValueError as exc:
        assert "unsupported subsection headings" in str(exc)
        assert "### 快照刷新" in str(exc)
    else:
        raise AssertionError("prepare_push should reject theme headings inside Unreleased")


def test_prepare_push_honors_minimum_revision_for_backfilled_post_push_snapshot(
    tmp_path: Path,
) -> None:
    _write_repo_files(
        tmp_path,
        """# Changelog

## [Unreleased]

### Fixed

- Backfilled snapshot should not reuse 001.

## [0.1.1] - 2026-03-31

### Added

- Stable release entry.
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
    assert "## [Unreleased]\n\n## [0.1.1-002] - 2026-04-15" in changelog


def test_prepare_push_adds_one_line_summary_to_revision_snapshot(tmp_path: Path) -> None:
    _write_repo_files(
        tmp_path,
        """# Changelog

## [Unreleased]

### Changed

- **Objective ranking**: Keep primary metric ordering strict when re-filtering.
- **Constraint cleanup**: Remove the legacy turnover guard from the UI.

### Fixed

- **QuickStart preview**: Rebuild the preview bundle on cold start.
- **Candidate board**: Prevent the modal table from overflowing on desktop.

## [0.1.1] - 2026-03-31

### Added

- Stable release entry.
""",
    )

    prepare_push(tmp_path, release=False, effective_date=date(2026, 4, 15))
    changelog = (tmp_path / "CHANGELOG.md").read_text(encoding="utf-8")

    assert (
        "## [0.1.1-001] - 2026-04-15 - 调整Objective ranking、Constraint cleanup，并修复QuickStart preview、Candidate board"
        in changelog
    )
    assert (
        "### 优化 (Changed)\n\n- **Objective ranking**: Keep primary metric ordering strict when re-filtering."
        in changelog
    )
    assert "### 修复 (Fixed)\n\n- **QuickStart preview**: Rebuild the preview bundle on cold start." in changelog
    assert "> 摘要：" not in changelog


def test_prepare_push_adds_one_line_summary_to_release_snapshot(tmp_path: Path) -> None:
    _write_repo_files(
        tmp_path,
        """# Changelog

## [Unreleased]

### Added

- **Optimization Lab**: Add the first end-to-end optimization workspace flow.

## [0.1.1] - 2026-03-31

### Added

- Stable release entry.
""",
        version="0.1.1",
    )

    prepare_push(
        tmp_path,
        release=True,
        release_version="0.1.2",
        effective_date=date(2026, 4, 15),
    )
    changelog = (tmp_path / "CHANGELOG.md").read_text(encoding="utf-8")

    assert "## [0.1.2] - 2026-04-15 - 新增Optimization Lab" in changelog
    assert "### 新增 (Added)\n\n- **Optimization Lab**: Add the first end-to-end optimization workspace flow." in changelog
    assert "> 摘要：" not in changelog


def test_prepare_push_accepts_bilingual_unreleased_headings(tmp_path: Path) -> None:
    _write_repo_files(
        tmp_path,
        """# 更新日志

## [Unreleased]

### 优化 (Changed)

- **目标排序**: 保持重新过滤后的结果按主指标稳定排序。

### 修复 (Fixed)

- **预览冷启动**: 首次打开时主动重建前端预览产物。

## [0.1.1] - 2026-03-31

### 新增 (Added)

- 已发布内容。
""",
    )

    prepare_push(tmp_path, release=False, effective_date=date(2026, 4, 15))
    changelog = (tmp_path / "CHANGELOG.md").read_text(encoding="utf-8")

    assert "## [0.1.1-001] - 2026-04-15 - 调整目标排序，并修复预览冷启动" in changelog
    assert "### 优化 (Changed)\n\n- **目标排序**: 保持重新过滤后的结果按主指标稳定排序。" in changelog
    assert "### 修复 (Fixed)\n\n- **预览冷启动**: 首次打开时主动重建前端预览产物。" in changelog


def test_prepare_push_preserves_existing_heading_summary_on_history(tmp_path: Path) -> None:
    _write_repo_files(
        tmp_path,
        """# 更新日志

## [Unreleased]

### 修复 (Fixed)

- **结果页**: 修复历史任务结果计数口径。

## [0.1.1-001] - 2026-04-14 - 既有历史摘要

### 优化 (Changed)

- **旧条目**: 保留已有标题摘要，不在下次快照时丢失。

## [0.1.1] - 2026-03-31

### 新增 (Added)

- 已发布内容。
""",
    )

    prepare_push(tmp_path, release=False, effective_date=date(2026, 4, 15))
    changelog = (tmp_path / "CHANGELOG.md").read_text(encoding="utf-8")

    assert "## [0.1.1-001] - 2026-04-14 - 既有历史摘要" in changelog
    assert "## [0.1.1-002] - 2026-04-15 - 修复结果页" in changelog

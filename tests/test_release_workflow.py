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
    assert "## [Unreleased]\n\n## [0.1.1-001] - 2026-03-31" in changelog
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
    assert "## [0.1.1-002] - 2026-03-31" in changelog


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

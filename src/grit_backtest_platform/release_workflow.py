from __future__ import annotations

import argparse
import json
import re
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path
from typing import Sequence


_SECTION_HEADING_RE = re.compile(
    r"^## \[(?P<title>[^\]]+)\](?: - (?P<date>\d{4}-\d{2}-\d{2}))?\s*$",
    re.MULTILINE,
)
_STABLE_VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")
_REVISION_VERSION_RE = re.compile(r"^(?P<base>\d+\.\d+\.\d+)-(?P<revision>\d{3})$")
_UNRELEASED_TITLES = {"unreleased", "未发布"}
_ALLOWED_UNRELEASED_SUBHEADINGS = {
    "### Added",
    "### Changed",
    "### Deprecated",
    "### Removed",
    "### Fixed",
    "### Security",
    "### 新增",
    "### 变更",
    "### 已弃用",
    "### 移除",
    "### 修复",
    "### 安全",
}
_SUMMARY_PREFIX = "> 摘要："
_SUMMARY_HEADING_TO_KIND = {
    "### Added": "added",
    "### Changed": "changed",
    "### Deprecated": "deprecated",
    "### Removed": "removed",
    "### Fixed": "fixed",
    "### Security": "security",
}
_SUMMARY_KIND_TO_VERB = {
    "added": "新增",
    "changed": "调整",
    "deprecated": "标记弃用",
    "removed": "移除",
    "fixed": "修复",
    "security": "加固",
    "other": "同步",
}


@dataclass(frozen=True)
class ChangelogSection:
    title: str
    body: str
    entry_date: str | None = None


@dataclass(frozen=True)
class PreparePushResult:
    changed: bool
    mode: str
    snapshot_title: str | None
    release_version: str | None
    release_date: str | None
    changed_files: list[str]
    commit_message: str

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False)


def _is_unreleased_title(title: str) -> bool:
    return title.strip().lower() in _UNRELEASED_TITLES


def _normalize_body(body: str) -> str:
    return body.strip("\n")


def _body_has_meaningful_content(body: str) -> bool:
    for raw_line in body.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith(_SUMMARY_PREFIX):
            continue
        if line.startswith("### "):
            continue
        return True
    return False


def _strip_generated_summary(body: str) -> str:
    filtered_lines = [
        raw_line
        for raw_line in body.splitlines()
        if not raw_line.strip().startswith(_SUMMARY_PREFIX)
    ]
    return _normalize_body("\n".join(filtered_lines))


def _clean_summary_topic(text: str) -> str:
    cleaned = text.strip()
    if not cleaned:
        return ""
    cleaned = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", cleaned)
    cleaned = re.sub(r"`([^`]*)`", r"\1", cleaned)
    cleaned = re.sub(r"\*\*([^*]+)\*\*", r"\1", cleaned)
    cleaned = cleaned.strip(" -*\t")
    for delimiter in ("：", ":"):
        if delimiter in cleaned:
            cleaned = cleaned.split(delimiter, 1)[0].strip()
            break
    cleaned = re.split(r"[。；;，,]", cleaned, maxsplit=1)[0].strip()
    return cleaned.strip(" .。:：;；,，")


def _extract_summary_topic(line: str) -> str | None:
    bullet = line.strip()
    if not bullet.startswith("- "):
        return None
    topic = _clean_summary_topic(bullet[2:])
    return topic or None


def _format_summary_topics(topics: Sequence[str], *, limit: int = 2) -> str:
    unique_topics: list[str] = []
    for topic in topics:
        if topic and topic not in unique_topics:
            unique_topics.append(topic)
    if not unique_topics:
        return ""
    rendered = "、".join(unique_topics[:limit])
    if len(unique_topics) > limit:
        return f"{rendered}等"
    return rendered


def _build_summary_line(body: str) -> str | None:
    cleaned_body = _strip_generated_summary(body)
    topics_by_kind: dict[str, list[str]] = {}
    current_kind = "other"

    for raw_line in cleaned_body.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("### "):
            current_kind = _SUMMARY_HEADING_TO_KIND.get(line, "other")
            continue
        topic = _extract_summary_topic(line)
        if topic:
            topics_by_kind.setdefault(current_kind, []).append(topic)

    clauses: list[str] = []
    for kind in ("added", "changed", "fixed", "removed", "security", "deprecated", "other"):
        topics = topics_by_kind.get(kind)
        if not topics:
            continue
        rendered_topics = _format_summary_topics(topics)
        if not rendered_topics:
            continue
        clauses.append(f"{_SUMMARY_KIND_TO_VERB[kind]}{rendered_topics}")
        if len(clauses) == 2:
            break

    if not clauses:
        return None
    if len(clauses) == 1:
        return f"{_SUMMARY_PREFIX}本次快照{clauses[0]}。"
    return f"{_SUMMARY_PREFIX}本次快照{clauses[0]}，并{clauses[1]}。"


def _with_generated_summary(body: str) -> str:
    cleaned_body = _strip_generated_summary(body)
    if not _body_has_meaningful_content(cleaned_body):
        return cleaned_body
    summary_line = _build_summary_line(cleaned_body)
    if not summary_line:
        return cleaned_body
    return f"{summary_line}\n\n{cleaned_body}"


def _parse_sections(text: str) -> tuple[str, list[ChangelogSection]]:
    matches = list(_SECTION_HEADING_RE.finditer(text))
    if not matches:
        return text.rstrip() + "\n", []

    preamble = text[: matches[0].start()].rstrip() + "\n"
    sections: list[ChangelogSection] = []
    for index, match in enumerate(matches):
        next_start = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        body = text[match.end() : next_start]
        sections.append(
            ChangelogSection(
                title=match.group("title").strip(),
                entry_date=match.group("date"),
                body=_normalize_body(body),
            )
        )
    return preamble, sections


def _render_changelog(preamble: str, sections: Sequence[ChangelogSection]) -> str:
    parts: list[str] = [preamble.rstrip()]
    for section in sections:
        if parts[-1] != "":
            parts.append("")
        heading = f"## [{section.title}]"
        if section.entry_date:
            heading = f"{heading} - {section.entry_date}"
        parts.append(heading)
        body = _normalize_body(section.body)
        if body:
            parts.append("")
            parts.append(body)
    return "\n".join(parts).rstrip() + "\n"


def _merge_unreleased_sections(sections: Sequence[ChangelogSection]) -> str:
    bodies = [_normalize_body(section.body) for section in sections if _is_unreleased_title(section.title)]
    return "\n\n".join(body for body in bodies if body)


def _validate_unreleased_subheadings(sections: Sequence[ChangelogSection]) -> None:
    invalid_headings: list[str] = []
    for section in sections:
        if not _is_unreleased_title(section.title):
            continue
        for raw_line in section.body.splitlines():
            line = raw_line.strip()
            if not line.startswith("### "):
                continue
            if line not in _ALLOWED_UNRELEASED_SUBHEADINGS:
                invalid_headings.append(line)
    if invalid_headings:
        invalid_list = ", ".join(dict.fromkeys(invalid_headings))
        raise ValueError(
            "Unreleased contains unsupported subsection headings: "
            f"{invalid_list}. Use standard Keep a Changelog categories only."
        )


def _find_latest_stable_release(sections: Sequence[ChangelogSection]) -> ChangelogSection | None:
    for section in sections:
        if _STABLE_VERSION_RE.fullmatch(section.title):
            return section
    return None


def _next_revision_number(
    sections: Sequence[ChangelogSection],
    base_version: str,
    *,
    minimum_revision: int = 1,
) -> int:
    current_max = 0
    for section in sections:
        match = _REVISION_VERSION_RE.fullmatch(section.title)
        if match and match.group("base") == base_version:
            current_max = max(current_max, int(match.group("revision")))
    return max(current_max + 1, minimum_revision)


def _bump_patch(version: str) -> str:
    major, minor, patch = (int(part) for part in version.split("."))
    return f"{major}.{minor}.{patch + 1}"


def _read_version(version_path: Path) -> str | None:
    if not version_path.exists():
        return None
    match = re.search(
        r'^__version__\s*=\s*"(?P<version>\d+\.\d+\.\d+)"\s*$',
        version_path.read_text(encoding="utf-8"),
        re.MULTILINE,
    )
    return match.group("version") if match else None


def _render_version_file(version: str) -> str:
    return (
        'from __future__ import annotations\n\n'
        '__all__ = ["__version__"]\n\n'
        f'__version__ = "{version}"\n'
    )


def _write_text_if_changed(path: Path, content: str) -> bool:
    existing = path.read_text(encoding="utf-8") if path.exists() else None
    if existing == content:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return True


def prepare_push(
    repo_root: Path,
    *,
    release: bool,
    release_version: str | None = None,
    effective_date: date | None = None,
    minimum_revision: int = 1,
) -> PreparePushResult:
    changelog_path = repo_root / "CHANGELOG.md"
    version_path = repo_root / "src" / "grit_backtest_platform" / "_version.py"

    if not changelog_path.exists():
        raise FileNotFoundError(f"CHANGELOG not found: {changelog_path}")

    effective_date = effective_date or date.today()
    changelog_text = changelog_path.read_text(encoding="utf-8")
    preamble, sections = _parse_sections(changelog_text)
    _validate_unreleased_subheadings(sections)
    other_sections = [section for section in sections if not _is_unreleased_title(section.title)]
    unreleased_body = _merge_unreleased_sections(sections)
    latest_stable = _find_latest_stable_release(other_sections)
    current_version = _read_version(version_path)

    if release_version and not release:
        raise ValueError("ReleaseVersion requires release mode.")
    if minimum_revision < 1:
        raise ValueError("minimum_revision must be >= 1.")

    changed_files: list[str] = []
    snapshot_title: str | None = None
    snapshot_date: str | None = None
    mode = "noop"

    if release:
        base_version = latest_stable.title if latest_stable else current_version
        if base_version is None:
            raise ValueError("Cannot infer the current release version for a release push.")
        target_version = release_version or _bump_patch(base_version)
        if not _STABLE_VERSION_RE.fullmatch(target_version):
            raise ValueError(f"Invalid release version: {target_version}")
        if not _body_has_meaningful_content(unreleased_body):
            raise ValueError("Release requested but Unreleased has no entries.")
        snapshot_title = target_version
        snapshot_date = effective_date.isoformat()
        mode = "release"
        expected_version = target_version
        normalized_sections = [
            ChangelogSection(title="Unreleased", body=""),
            ChangelogSection(
                title=target_version,
                entry_date=snapshot_date,
                body=_with_generated_summary(unreleased_body),
            ),
            *other_sections,
        ]
    else:
        expected_version = latest_stable.title if latest_stable else current_version
        normalized_sections = [ChangelogSection(title="Unreleased", body="")]
        if _body_has_meaningful_content(unreleased_body):
            if latest_stable is None:
                raise ValueError("Cannot create a push revision without an existing stable release entry.")
            next_revision = _next_revision_number(
                other_sections,
                latest_stable.title,
                minimum_revision=minimum_revision,
            )
            snapshot_title = f"{latest_stable.title}-{next_revision:03d}"
            snapshot_date = effective_date.isoformat()
            mode = "revision"
            normalized_sections.append(
                ChangelogSection(
                    title=snapshot_title,
                    entry_date=snapshot_date,
                    body=_with_generated_summary(unreleased_body),
                )
            )
        normalized_sections.extend(other_sections)

    normalized_changelog = _render_changelog(preamble, normalized_sections)
    if _write_text_if_changed(changelog_path, normalized_changelog):
        changed_files.append("CHANGELOG.md")

    if expected_version:
        if _write_text_if_changed(version_path, _render_version_file(expected_version)):
            changed_files.append("src/grit_backtest_platform/_version.py")

    if mode == "release":
        commit_message = f"chore(release): {snapshot_title}"
    elif mode == "revision":
        commit_message = f"docs(changelog): snapshot {snapshot_title}"
    elif changed_files:
        commit_message = "chore(changelog): normalize push metadata"
    else:
        commit_message = ""

    return PreparePushResult(
        changed=bool(changed_files),
        mode=mode,
        snapshot_title=snapshot_title,
        release_version=expected_version,
        release_date=snapshot_date,
        changed_files=changed_files,
        commit_message=commit_message,
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Prepare CHANGELOG/version metadata before git push.")
    parser.add_argument("--repo-root", default=".", help="Repository root that contains CHANGELOG.md")
    parser.add_argument("--release", action="store_true", help="Cut a formal release instead of a push revision snapshot.")
    parser.add_argument("--release-version", help="Explicit stable semantic version to use for the release.")
    parser.add_argument("--date", dest="release_date", help="Override the effective date (YYYY-MM-DD).")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    effective_date = date.fromisoformat(args.release_date) if args.release_date else None
    result = prepare_push(
        Path(args.repo_root).resolve(),
        release=args.release,
        release_version=args.release_version,
        effective_date=effective_date,
    )
    print(result.to_json())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

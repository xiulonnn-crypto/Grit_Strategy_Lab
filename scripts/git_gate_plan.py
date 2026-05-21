from __future__ import annotations

import argparse
import fnmatch
import json
import re
import subprocess
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterable, Sequence


SCOPE_CHOICES = ("All", "Committed", "WorkingTree", "Auto")
MODE_CHOICES = ("fast", "impact")

EVIDENCE_PREFIXES = (
    "output/ui-artifact-trace/",
    "output/logs/grit-coder/",
    "harness/reports/",
    "designs/",
)
ARTIFACT_EVIDENCE_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".json",
    ".md",
    ".html",
    ".txt",
    ".log",
    ".csv",
}
DOCUMENTATION_EXTENSIONS = {
    ".md",
    ".mdx",
    ".rst",
    ".adoc",
    ".txt",
}
ROOT_DOCUMENTS = {
    "AGENTS.md",
    "ARCHITECTURE.md",
    "CHANGELOG.md",
    "CLAUDE.md",
    "DESIGN.md",
    "README.md",
    "TECHNICAL.md",
    "agent.md",
    "design.md",
}
CONTRACT_PATHS = {
    "src/grit_backtest_platform/api.py",
    "src/grit_backtest_platform/models.py",
    "web/src/types.ts",
    "web/src/lib/workspace-adapters.ts",
    "web/src/lib/demoStoreContext.tsx",
}
BACKEND_CONTRACT_PATHS = {
    "src/grit_backtest_platform/api.py",
    "src/grit_backtest_platform/models.py",
}
BACKEND_CONTRACT_OWNER_TESTS = (
    "tests/test_factor_research_api.py",
    "tests/test_backend_api.py",
    "tests/test_factor_mining_api.py",
    "tests/test_factor_factory_api.py",
    "tests/test_factor_quarantine_api.py",
)
ASYNC_LIFECYCLE_REPEAT_TESTS = (
    "tests/test_factor_mining_api.py::test_factor_mining_api_runs_one_thousand_candidates_without_factor_library_write",
)
ASYNC_LIFECYCLE_PATTERNS = (
    r"^src/grit_backtest_platform/api\.py$",
    r"^src/grit_backtest_platform/_real_service_rebuilt\.py$",
    r"factor_mining",
)
F1_F2_FRONTEND_OWNER_TESTS = (
    "factors.phase0.f1.test.tsx",
    "factor.model-builder.test.tsx",
    "factor.factory.test.tsx",
    "app.routes.foundation.test.tsx",
)
F1_F2_FRONTEND_PATTERNS = (
    r"^web/src/pages/factors-page\.(tsx|css)$",
    r"^web/src/pages/factor-factory-page\.tsx$",
    r"^web/src/pages/factor-model-builder-page\.tsx$",
    r"^web/src/lib/factor-display\.ts$",
    r"^web/src/types\.ts$",
    r"factor",
)
VALIDATION_TOOLING_PATTERNS = (
    "scripts/codex-validate-*.ps1",
    "scripts/git_gate_plan.py",
    "scripts/pre_push_hook.py",
    ".githooks/**",
    "pyproject.toml",
    "web/package.json",
    "web/package-lock.json",
)

FAST_BACKEND_OWNER_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (r"^src/grit_backtest_platform/factor_research\.py$", ("tests/test_factor_research_api.py",)),
    (
        r"^src/grit_backtest_platform/factor_expression_engine\.py$",
        ("tests/test_factor_expression_engine.py",),
    ),
    (r"^src/grit_backtest_platform/sec_edgar_provider\.py$", ("tests/test_market_data_provider_chain.py",)),
    (
        r"^src/grit_backtest_platform/_market_data_repository_restored\.py$",
        ("tests/test_market_data_provider_chain.py",),
    ),
)

FAST_FRONTEND_OWNER_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (r"^web/src/pages/optimization-lab-page\.(tsx|css)$", ("optimization.module.test.tsx",)),
    (r"^web/src/pages/factor-factory-page\.tsx$", ("factor.factory.test.tsx",)),
    (r"^web/src/pages/factor-phase2-pages\.css$", ("factor.factory.test.tsx",)),
    (r"^web/src/pages/factor-model-builder-page\.tsx$", ("factor.model-builder.test.tsx",)),
    (r"^web/src/pages/factors-page\.(tsx|css)$", ("factor.factory.test.tsx",)),
    (r"^web/src/pages/runs-index-page\.(tsx|css)$", ("runs.index.page.test.tsx",)),
    (r"^web/src/pages/strategy-detail-page\.tsx$", ("strategy.detail.page.test.tsx",)),
    (r"^web/src/pages/creation-template-page\.tsx$", ("creation-template.route.test.tsx",)),
    (r"^web/src/page-sections/snapshots-.*\.tsx$", ("snapshots.page.test.tsx",)),
    (r"^web/src/lib/factor-display\.ts$", ("factor.factory.test.tsx",)),
)

IMPACT_BACKEND_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (r"release_workflow|pre_push_hook|git_gate_plan|codex-validate", ("tests/test_release_workflow.py",)),
    (r"composition", ("tests/test_composition_api.py",)),
    (r"creation", ("tests/test_creation_session_refresh.py",)),
    (r"real_backtest|backtest", ("tests/test_real_backtest_api.py",)),
    (r"factor_research", ("tests/test_factor_research_api.py",)),
    (r"factor_expression", ("tests/test_factor_expression_engine.py",)),
    (r"factor_factory", ("tests/test_factor_factory_api.py",)),
    (r"factor_mining", ("tests/test_factor_mining_api.py",)),
    (r"factor_quarantine", ("tests/test_factor_quarantine_api.py",)),
    (r"multi_factor", ("tests/test_multi_factor_strategy_api.py",)),
    (r"optimization", ("tests/test_optimization_execution_resume.py", "tests/test_optimization_resume_api.py")),
    (r"runtime_supervisor", ("tests/test_runtime_supervisor.py",)),
    (r"strateg", ("tests/test_strategies_smoke.py",)),
    (r"snapshot|pit|provider|market_data|universe", ("tests/test_backend_api.py", "tests/test_snapshot_data_plane.py")),
)

IMPACT_FRONTEND_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (r"workspace", ("workspace.dashboard.test.tsx",)),
    (r"snapshots", ("snapshots.page.test.tsx",)),
    (
        r"composition",
        (
            "composition.dashboard.test.tsx",
            "composition.workbench.test.tsx",
            "composition.detail.test.tsx",
            "composition.global-index.test.tsx",
        ),
    ),
    (r"leg", ("leg.inventory.test.tsx",)),
    (
        r"factor",
        (
            "factor.factory.test.tsx",
            "factor.sandbox.test.tsx",
            "factor.quarantine.test.tsx",
            "factor.model-builder.test.tsx",
        ),
    ),
    (r"optimization", ("optimization.module.test.tsx",)),
    (r"creation", ("creation-template.route.test.tsx", "creation.flow.test.tsx")),
    (r"run-detail|runs", ("run-detail.page.test.tsx", "runs.index.page.test.tsx")),
    (
        r"shell|route|app-runtime|appRouteContext|demoStoreContext",
        ("app.routes.foundation.test.tsx", "shell-frame.page-heading.test.tsx"),
    ),
    (r"quickstart|preview-server", ("quickstart.preview.test.ts",)),
)


@dataclass
class GatePlan:
    mode: str
    scope: str
    raw_changed_files: list[str]
    evidence_asset_files: list[str]
    documentation_files: list[str]
    engineering_files: list[str]
    source_files: list[str]
    domains: list[str]
    contract_changed: bool
    validation_tooling_changed: bool
    eligible: bool
    ineligible_reasons: list[str]
    backend_tests: list[str]
    frontend_tests: list[str]
    python_compile_files: list[str]
    async_lifecycle_repeat_tests: list[str] = field(default_factory=list)
    validation_self_test_required: bool = False
    selection_reasons: dict[str, list[str]] = field(default_factory=dict)


def normalize_path(path: str) -> str:
    return path.strip().replace("\\", "/")


def unique(items: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        normalized = normalize_path(item)
        if normalized and normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return result


def _suffix(path: str) -> str:
    return Path(path).suffix.lower()


def is_evidence_asset(path: str) -> bool:
    path = normalize_path(path)
    if path.startswith(EVIDENCE_PREFIXES):
        return True
    if path.startswith("artifacts/") and _suffix(path) in ARTIFACT_EVIDENCE_EXTENSIONS:
        return True
    return False


def is_documentation(path: str) -> bool:
    path = normalize_path(path)
    if is_evidence_asset(path):
        return False
    if path in ROOT_DOCUMENTS:
        return True
    if path.startswith(("docs/", "harness/acceptance/")):
        return True
    return _suffix(path) in DOCUMENTATION_EXTENSIONS


def is_contract_path(path: str) -> bool:
    return normalize_path(path) in CONTRACT_PATHS


def is_backend_contract_path(path: str) -> bool:
    return normalize_path(path) in BACKEND_CONTRACT_PATHS


def is_validation_tooling(path: str) -> bool:
    path = normalize_path(path)
    return any(fnmatch.fnmatch(path, pattern) for pattern in VALIDATION_TOOLING_PATTERNS)


def is_backend_related(path: str) -> bool:
    path = normalize_path(path)
    return path.startswith("src/grit_backtest_platform/") or path.startswith("tests/") or path == "pyproject.toml"


def is_frontend_related(path: str) -> bool:
    path = normalize_path(path)
    return (
        path.startswith("web/src/")
        or path.startswith("web/scripts/")
        or path in {"web/package.json", "web/package-lock.json", "web/vite.config.ts", "web/preview-server.mjs"}
    )


def is_source_file(path: str) -> bool:
    path = normalize_path(path)
    if path.startswith("tests/") or re.search(r"\.test\.[tj]sx?$", path):
        return False
    return path.startswith(("src/", "web/src/", "web/scripts/", "scripts/")) or path in {
        "pyproject.toml",
        "web/package.json",
        "web/package-lock.json",
        "web/vite.config.ts",
        "web/preview-server.mjs",
    }


def is_backend_test(path: str) -> bool:
    path = normalize_path(path)
    return path.startswith("tests/test_") and path.endswith(".py")


def is_frontend_test(path: str) -> bool:
    path = normalize_path(path)
    return bool(re.match(r"^web/src/.+\.test\.[tj]sx?$", path))


def frontend_test_id(path: str) -> str:
    return normalize_path(path)[len("web/src/") :]


def impact_match_text(path: str) -> str:
    path = normalize_path(path)
    if path.startswith("src/grit_backtest_platform/"):
        return path[len("src/grit_backtest_platform/") :]
    return path


def add_selection(
    tests: list[str],
    reasons: dict[str, list[str]],
    selected_tests: Sequence[str],
    reason: str,
) -> None:
    for test in selected_tests:
        if test not in tests:
            tests.append(test)
        reasons.setdefault(test, [])
        if reason not in reasons[test]:
            reasons[test].append(reason)


def select_owner_tests(
    engineering_files: Sequence[str],
    mode: str,
    contract_changed: bool,
    validation_tooling_changed: bool,
) -> tuple[list[str], list[str], dict[str, list[str]], list[str]]:
    backend_tests: list[str] = []
    frontend_tests: list[str] = []
    reasons: dict[str, list[str]] = {}
    unmatched: list[str] = []

    for path in engineering_files:
        matched = False
        if is_backend_test(path):
            add_selection(backend_tests, reasons, (path,), f"changed backend test: {path}")
            matched = True
        elif is_frontend_test(path):
            add_selection(frontend_tests, reasons, (frontend_test_id(path),), f"changed frontend test: {path}")
            matched = True
        elif mode == "fast":
            for pattern, tests in FAST_BACKEND_OWNER_RULES:
                if re.search(pattern, path):
                    add_selection(backend_tests, reasons, tests, f"backend owner: {path}")
                    matched = True
                    break
            for pattern, tests in FAST_FRONTEND_OWNER_RULES:
                if re.search(pattern, path):
                    add_selection(frontend_tests, reasons, tests, f"frontend owner: {path}")
                    matched = True
                    break
        else:
            match_text = impact_match_text(path)
            for pattern, tests in IMPACT_BACKEND_RULES:
                if re.search(pattern, match_text):
                    add_selection(backend_tests, reasons, tests, f"backend impact: {path}")
                    matched = True
            for pattern, tests in IMPACT_FRONTEND_RULES:
                if re.search(pattern, match_text):
                    add_selection(frontend_tests, reasons, tests, f"frontend impact: {path}")
                    matched = True

        if not matched and mode == "fast" and not is_contract_path(path) and not is_validation_tooling(path):
            unmatched.append(path)

    if mode == "impact":
        backend_contract_changed = any(is_backend_contract_path(path) for path in engineering_files)
        if backend_contract_changed:
            add_selection(backend_tests, reasons, BACKEND_CONTRACT_OWNER_TESTS, "contract owner slice")
            add_selection(frontend_tests, reasons, ("app.routes.foundation.test.tsx",), "contract change")
        elif contract_changed:
            add_selection(frontend_tests, reasons, ("app.routes.foundation.test.tsx",), "frontend contract mirror change")
        if validation_tooling_changed:
            add_selection(backend_tests, reasons, ("tests/test_release_workflow.py",), "validation tooling change")
        if not backend_tests and any(is_backend_related(path) for path in engineering_files):
            add_selection(backend_tests, reasons, ("tests/test_backend_api.py",), "backend fallback")
        if not frontend_tests and any(is_frontend_related(path) for path in engineering_files):
            add_selection(frontend_tests, reasons, ("app.routes.foundation.test.tsx",), "frontend fallback")

    return backend_tests, frontend_tests, reasons, unmatched


def requires_async_lifecycle_repeat(engineering_files: Sequence[str]) -> bool:
    return any(
        re.search(pattern, normalize_path(path))
        for path in engineering_files
        for pattern in ASYNC_LIFECYCLE_PATTERNS
    )


def requires_f1_f2_frontend_owner_slice(engineering_files: Sequence[str]) -> bool:
    return any(
        re.search(pattern, normalize_path(path))
        for path in engineering_files
        for pattern in F1_F2_FRONTEND_PATTERNS
    )


def classify_domains(engineering_files: Sequence[str]) -> list[str]:
    domains: list[str] = []
    if any(is_backend_related(path) for path in engineering_files):
        domains.append("backend")
    if any(is_frontend_related(path) for path in engineering_files):
        domains.append("frontend")
    if any(is_validation_tooling(path) for path in engineering_files):
        domains.append("validation")
    return domains


def build_plan(mode: str, scope: str, changed_files: Sequence[str]) -> GatePlan:
    if mode not in MODE_CHOICES:
        raise ValueError(f"Unsupported mode: {mode}")
    if scope not in SCOPE_CHOICES:
        raise ValueError(f"Unsupported scope: {scope}")

    raw_changed_files = unique(changed_files)
    evidence_files = [path for path in raw_changed_files if is_evidence_asset(path)]
    documentation_files = [path for path in raw_changed_files if is_documentation(path)]
    engineering_files = [
        path for path in raw_changed_files if path not in evidence_files and path not in documentation_files
    ]
    source_files = [path for path in engineering_files if is_source_file(path)]
    domains = classify_domains(engineering_files)
    contract_changed = any(is_contract_path(path) for path in engineering_files)
    validation_tooling_changed = any(is_validation_tooling(path) for path in engineering_files)
    backend_tests, frontend_tests, reasons, unmatched = select_owner_tests(
        engineering_files,
        mode,
        contract_changed=contract_changed,
        validation_tooling_changed=validation_tooling_changed,
    )
    async_lifecycle_repeat_tests: list[str] = []
    if mode == "impact" and requires_async_lifecycle_repeat(engineering_files):
        async_lifecycle_repeat_tests = list(ASYNC_LIFECYCLE_REPEAT_TESTS)
        add_selection(
            backend_tests,
            reasons,
            ("tests/test_factor_mining_api.py",),
            "async lifecycle repeat owner",
        )
    if mode == "impact" and requires_f1_f2_frontend_owner_slice(engineering_files):
        add_selection(
            frontend_tests,
            reasons,
            F1_F2_FRONTEND_OWNER_TESTS,
            "F1/F2 frontend owner slice",
        )
    python_compile_files = [
        path
        for path in engineering_files
        if path.endswith(".py") and (path.startswith("src/") or path.startswith("scripts/"))
    ]

    ineligible_reasons: list[str] = []
    if mode == "fast":
        major_domains = [domain for domain in domains if domain in {"backend", "frontend"}]
        if len(engineering_files) > 20:
            ineligible_reasons.append(f"engineering_files={len(engineering_files)} exceeds fast limit 20")
        if len(source_files) > 12:
            ineligible_reasons.append(f"source_files={len(source_files)} exceeds fast limit 12")
        if len(backend_tests) > 2:
            ineligible_reasons.append(f"backend_tests={len(backend_tests)} exceeds fast limit 2")
        if len(frontend_tests) > 2:
            ineligible_reasons.append(f"frontend_tests={len(frontend_tests)} exceeds fast limit 2")
        if len(backend_tests) + len(frontend_tests) > 3:
            ineligible_reasons.append(f"total_tests={len(backend_tests) + len(frontend_tests)} exceeds fast limit 3")
        if len(major_domains) > 1:
            ineligible_reasons.append(f"cross-stack engineering domains: {', '.join(major_domains)}")
        if contract_changed:
            ineligible_reasons.append("contract files require impact gate")
        if validation_tooling_changed:
            ineligible_reasons.append("validation tooling changes require impact gate")
        for path in unmatched:
            ineligible_reasons.append(f"unmapped engineering file: {path}")

    eligible = len(ineligible_reasons) == 0
    return GatePlan(
        mode=mode,
        scope=scope,
        raw_changed_files=raw_changed_files,
        evidence_asset_files=evidence_files,
        documentation_files=documentation_files,
        engineering_files=engineering_files,
        source_files=source_files,
        domains=domains,
        contract_changed=contract_changed,
        validation_tooling_changed=validation_tooling_changed,
        eligible=eligible,
        ineligible_reasons=ineligible_reasons,
        backend_tests=backend_tests,
        frontend_tests=frontend_tests,
        python_compile_files=python_compile_files,
        async_lifecycle_repeat_tests=async_lifecycle_repeat_tests,
        validation_self_test_required=validation_tooling_changed,
        selection_reasons=reasons,
    )


def git_lines(repo_root: Path, args: Sequence[str]) -> list[str]:
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
    return [line.strip() for line in completed.stdout.splitlines() if line.strip()]


def collect_changed_files(
    repo_root: Path,
    scope: str,
    base_ref: str | None,
    since_last_validated: str | None = None,
) -> list[str]:
    files: list[str] = []
    include_committed = scope in {"All", "Committed", "Auto"}
    include_working_tree = scope in {"All", "WorkingTree", "Auto"}

    if include_committed:
        if since_last_validated:
            files.extend(git_lines(repo_root, ["diff", "--name-only", f"{since_last_validated}..HEAD"]))
        elif base_ref:
            files.extend(git_lines(repo_root, ["diff", "--name-only", f"{base_ref}...HEAD"]))
        elif scope == "Committed":
            files.extend(git_lines(repo_root, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]))

    if include_working_tree:
        files.extend(git_lines(repo_root, ["diff", "--name-only"]))
        files.extend(git_lines(repo_root, ["diff", "--cached", "--name-only"]))
        files.extend(git_lines(repo_root, ["ls-files", "--others", "--exclude-standard"]))

    return unique(files)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Plan Grit git validation gates.")
    parser.add_argument("--mode", choices=MODE_CHOICES, required=True)
    parser.add_argument("--scope", choices=SCOPE_CHOICES, default="All")
    parser.add_argument("--base-ref")
    parser.add_argument("--since-last-validated")
    parser.add_argument("--remote", default="origin")
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--changed-file", action="append", default=[])
    parser.add_argument("--pretty", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    changed_files = args.changed_file or collect_changed_files(
        repo_root,
        args.scope,
        args.base_ref,
        args.since_last_validated,
    )
    plan = build_plan(args.mode, args.scope, changed_files)
    payload = asdict(plan)
    print(json.dumps(payload, ensure_ascii=False, indent=2 if args.pretty else None))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

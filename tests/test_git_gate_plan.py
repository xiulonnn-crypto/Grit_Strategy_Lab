from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path


def _load_planner_module():
    module_path = Path(__file__).resolve().parents[1] / "scripts" / "git_gate_plan.py"
    spec = importlib.util.spec_from_file_location("git_gate_plan", module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


planner = _load_planner_module()


def test_fast_keeps_raw_count_but_excludes_evidence_assets_for_142_file_case() -> None:
    evidence = [f"output/ui-artifact-trace/proof-{index}/screen-{index}.png" for index in range(88)]
    docs = [
        "AGENTS.md",
        "ARCHITECTURE.md",
        "CHANGELOG.md",
        "CLAUDE.md",
        "README.md",
        "TECHNICAL.md",
        "design.md",
        "docs/factors-phase1-implementation-trace.md",
    ]
    engineering = [
        "scripts/codex-validate-fast.ps1",
        "scripts/pre_push_hook.py",
        "src/grit_backtest_platform/api.py",
        "src/grit_backtest_platform/models.py",
        "web/src/types.ts",
        "src/grit_backtest_platform/factor_research.py",
        "src/grit_backtest_platform/factor_expression_engine.py",
        "src/grit_backtest_platform/sec_edgar_provider.py",
        "tests/test_factor_research_api.py",
        "tests/test_factor_expression_engine.py",
        "web/src/pages/optimization-lab-page.tsx",
        "web/src/optimization.module.test.tsx",
    ] + [f"web/src/pages/generated-owner-{index}.tsx" for index in range(34)]

    plan = planner.build_plan("fast", "Committed", evidence + docs + engineering)

    assert len(plan.raw_changed_files) == 142
    assert len(plan.evidence_asset_files) == 88
    assert len(plan.documentation_files) == 8
    assert len(plan.engineering_files) == 46
    assert plan.eligible is False
    assert any("contract files" in reason for reason in plan.ineligible_reasons)
    assert any("validation tooling" in reason for reason in plan.ineligible_reasons)
    assert any("cross-stack" in reason for reason in plan.ineligible_reasons)


def test_fast_allows_docs_and_evidence_only_without_tests() -> None:
    plan = planner.build_plan(
        "fast",
        "Committed",
        [
            "CHANGELOG.md",
            "docs/release-note.md",
            "output/ui-artifact-trace/factor/final.png",
            "designs/factor-phase0-f1-operator-config/factor-phase0-f1-operator-ui-spec.md",
            "designs/factor-phase0-f1-operator-config/factor-factory-config-modal.png",
            "artifacts/acceptance/final-geometry.json",
        ],
    )

    assert plan.eligible is True
    assert plan.engineering_files == []
    assert plan.backend_tests == []
    assert plan.frontend_tests == []


def test_project_designs_directory_is_evidence_asset() -> None:
    plan = planner.build_plan(
        "fast",
        "Committed",
        [
            "designs/factor-phase0-f1-operator-config/approved.json",
            "designs/factor-phase0-f1-operator-config/factor-library-f1-raw-tab.png",
            "designs/factor-phase0-f1-operator-config/factor-phase0-f1-operator-ui-preview.html",
            "designs/another-approved-screen/spec.md",
        ],
    )

    assert plan.eligible is True
    assert len(plan.evidence_asset_files) == 4
    assert plan.documentation_files == []
    assert plan.engineering_files == []
    assert plan.backend_tests == []
    assert plan.frontend_tests == []


def test_fast_uses_single_frontend_owner_with_evidence_noise() -> None:
    plan = planner.build_plan(
        "fast",
        "Committed",
        [
            "web/src/pages/optimization-lab-page.tsx",
            "output/ui-artifact-trace/optimization/desktop.png",
            "output/ui-artifact-trace/optimization/geometry.json",
        ],
    )

    assert plan.eligible is True
    assert plan.evidence_asset_files == [
        "output/ui-artifact-trace/optimization/desktop.png",
        "output/ui-artifact-trace/optimization/geometry.json",
    ]
    assert plan.backend_tests == []
    assert plan.frontend_tests == ["optimization.module.test.tsx"]


def test_fast_uses_single_backend_owner() -> None:
    plan = planner.build_plan("fast", "Committed", ["src/grit_backtest_platform/factor_research.py"])

    assert plan.eligible is True
    assert plan.backend_tests == ["tests/test_factor_research_api.py"]
    assert plan.frontend_tests == []


def test_fast_changed_backend_test_runs_only_itself() -> None:
    plan = planner.build_plan("fast", "Committed", ["tests/test_factor_research_api.py"])

    assert plan.eligible is True
    assert plan.backend_tests == ["tests/test_factor_research_api.py"]
    assert plan.frontend_tests == []


def test_contract_change_moves_from_fast_to_impact_contract_smoke() -> None:
    fast_plan = planner.build_plan("fast", "Committed", ["web/src/types.ts"])
    impact_plan = planner.build_plan("impact", "Committed", ["web/src/types.ts"])

    assert fast_plan.eligible is False
    assert any("contract files" in reason for reason in fast_plan.ineligible_reasons)
    assert "tests/test_backend_api.py" in impact_plan.backend_tests
    assert "app.routes.foundation.test.tsx" in impact_plan.frontend_tests


def test_validation_tooling_change_moves_from_fast_to_impact_release_workflow() -> None:
    fast_plan = planner.build_plan("fast", "Committed", ["scripts/pre_push_hook.py"])
    impact_plan = planner.build_plan("impact", "Committed", ["scripts/pre_push_hook.py"])

    assert fast_plan.eligible is False
    assert any("validation tooling" in reason for reason in fast_plan.ineligible_reasons)
    assert impact_plan.backend_tests == ["tests/test_release_workflow.py"]


def test_unmapped_source_is_not_fast_but_impact_has_backend_fallback() -> None:
    fast_plan = planner.build_plan("fast", "Committed", ["src/grit_backtest_platform/_service_rebuilt.py"])
    impact_plan = planner.build_plan("impact", "Committed", ["src/grit_backtest_platform/_service_rebuilt.py"])

    assert fast_plan.eligible is False
    assert any("unmapped engineering file" in reason for reason in fast_plan.ineligible_reasons)
    assert impact_plan.backend_tests == ["tests/test_backend_api.py"]


def test_cli_plan_only_shape_outputs_json_without_running_tests() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    completed = subprocess.run(
        [
            sys.executable,
            str(repo_root / "scripts" / "git_gate_plan.py"),
            "--mode",
            "fast",
            "--scope",
            "Committed",
            "--changed-file",
            "web/src/pages/optimization-lab-page.tsx",
        ],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    payload = json.loads(completed.stdout)

    assert payload["eligible"] is True
    assert payload["frontend_tests"] == ["optimization.module.test.tsx"]

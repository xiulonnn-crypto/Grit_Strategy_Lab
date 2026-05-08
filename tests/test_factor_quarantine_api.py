from __future__ import annotations

from datetime import date
from pathlib import Path
from uuid import uuid4

from grit_backtest_platform.storage import dumps
from tests.api_test_support import assert_ok, create_test_client
from tests.test_factor_research_api import seed_ready_pit_data


def _runtime_dir(name: str) -> Path:
    path = Path(".tmp") / "pytest-runtime" / f"{name}-{uuid4().hex}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _seed_mining_candidate(
    client,
    *,
    job_id: str = "mine_quarantine_test",
    candidate_id: str = "cand_quarantine_test",
    expression: str = "Rank(Delta(Close, 63))",
    rank_ic: float = 0.041,
    coverage: float = 91.0,
    extra_candidate: dict | None = None,
) -> None:
    storage = client.app.state.service.storage
    now = "2026-05-06T09:00:00Z"
    candidate_payload = {
        "id": candidate_id,
        "candidate_id": candidate_id,
        "expression": expression,
        "score": rank_ic,
        "rank_ic": rank_ic,
        "turnover": 34.0,
        "coverage": coverage,
        "risk_flags": [],
        "status": "COMPLETED",
        "persisted_to_factor_definitions": False,
    }
    if extra_candidate:
        candidate_payload.update(extra_candidate)
    storage.insert_json_row(
        "factor_mining_jobs",
        {
            "id": job_id,
            "status": "COMPLETED",
            "request_json": dumps({"universe": "SP500"}),
            "progress_json": dumps({"total_candidates": 1, "evaluated_candidates": 1}),
            "summary_json": dumps({"persisted_to_factor_definitions": False}),
            "top_candidates_json": dumps([candidate_payload]),
            "failed_samples_json": dumps([]),
            "created_at": now,
            "updated_at": now,
            "completed_at": now,
            "error_message": None,
        },
    )
    storage.insert_json_row(
        "factor_mining_candidates",
        {
            "id": candidate_id,
            "job_id": job_id,
            "expression": expression,
            "score": rank_ic,
            "rank_ic": rank_ic,
            "turnover": 34.0,
            "coverage": coverage,
            "depth": 2,
            "risk_flags_json": dumps([]),
            "summary_json": dumps({"rank_ic": rank_ic, "coverage": coverage, **(extra_candidate or {})}),
            "created_at": now,
        },
    )


def _seed_mining_job_top_candidate_only(
    client,
    *,
    job_id: str = "mine_latest_only",
    candidate_id: str = "cand_latest_only",
    expression: str = "Rank(Return(Close, 21))",
    rank_ic: float = 0.061,
    candidate_count: int = 1,
) -> None:
    storage = client.app.state.service.storage
    now = "2026-05-06T10:00:00Z"
    storage.insert_json_row(
        "factor_mining_jobs",
        {
            "id": job_id,
            "status": "COMPLETED",
            "request_json": dumps({"universe": "SP500", "candidate_count": candidate_count}),
            "progress_json": dumps({"total_candidates": candidate_count, "evaluated_candidates": candidate_count}),
            "summary_json": dumps({"persisted_to_factor_definitions": False}),
            "top_candidates_json": dumps([
                {
                    "id": candidate_id,
                    "candidate_id": candidate_id,
                    "expression": expression,
                    "score": rank_ic,
                    "rank_ic": rank_ic,
                    "turnover": 0.0,
                    "coverage": 1.0,
                    "risk_flags": [],
                    "status": "COMPLETED",
                    "persisted_to_factor_definitions": False,
                }
            ]),
            "failed_samples_json": dumps([]),
            "created_at": now,
            "updated_at": now,
            "completed_at": now,
            "error_message": None,
        },
    )


def test_factor_quarantine_intake_run_publish_lineage_and_governance() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-quarantine-publish"))
    seed_ready_pit_data(client, start=date(2014, 1, 2), day_count=3200)
    _seed_mining_candidate(client)
    storage = client.app.state.service.storage
    before_auto_mined = storage.fetch_one(
        "SELECT COUNT(*) AS count FROM factor_definitions WHERE source = 'AUTO_MINED'"
    )["count"]

    intake = assert_ok(client.post("/factor-quarantine/intake", json={"mining_job_id": "mine_quarantine_test"}))
    assert intake["summary"]["intake_count"] == 1
    assert intake["summary"]["sandbox_candidates_persisted_to_factor_definitions"] is False
    candidate = intake["items"][0]
    assert candidate["status"] == "PENDING"
    after_intake_auto_mined = storage.fetch_one(
        "SELECT COUNT(*) AS count FROM factor_definitions WHERE source = 'AUTO_MINED'"
    )["count"]
    assert after_intake_auto_mined == before_auto_mined

    run = assert_ok(client.post(f"/factor-quarantine/candidates/{candidate['id']}/run", json={"reason": "unit-test"}))
    assert run["status"] == "PASSED"
    assert run["publish_status"] == "ELIGIBLE"
    assert run["gate_summary"]["pit"] == "Full Ready"
    assert run["latest_run"]["orthogonal"]["max_abs_correlation"] < 0.3

    published = assert_ok(
        client.post(
            f"/factor-quarantine/candidates/{candidate['id']}/publish",
            json={"operator": "system_rule"},
        )
    )
    factor = published["factor"]
    assert factor["source"] == "AUTO_MINED"
    assert factor["lifecycle_status"] == "VERIFIED"
    assert factor["latest_diagnostic_summary"]["audit_trail"]
    assert published["candidate"]["status"] == "PUBLISHED"

    events = storage.fetch_one("SELECT COUNT(*) AS count FROM factor_publish_events WHERE candidate_id = ?", (candidate["id"],))
    edges = storage.fetch_one("SELECT COUNT(*) AS count FROM factor_lineage_edges WHERE target_id = ?", (factor["id"],))
    assert events["count"] == 1
    assert edges["count"] >= 1

    factors = assert_ok(client.get("/factors"))
    assert factors["summary"]["governance_queue_count"] >= 1
    overview = assert_ok(client.get("/factor-governance/overview"))
    assert any(action["kind"] == "FACTOR_MODEL_SUGGESTION" for action in overview["actions"])

    suggestion = assert_ok(client.post("/factor-models/suggestions", json={"factor_id": factor["id"]}))
    assert suggestion["status"] == "DRAFT"
    assert suggestion["review_status"] == "NEEDS_REVIEW"
    assert suggestion["action"]["target"]["route"] == "#/factor-models/new"
    assert factor["id"] in suggestion["action"]["target"]["query"]["factorIds"]


def _legacy_factor_quarantine_blocks_duplicate_expression_publish() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-quarantine-duplicate"))
    seed_ready_pit_data(client, start=date(2014, 1, 2), day_count=3200)
    default_expression = assert_ok(client.get("/factors/s_mom_12m1m_rank"))["expression"]
    _seed_mining_candidate(
        client,
        job_id="mine_quarantine_duplicate",
        candidate_id="cand_quarantine_duplicate",
        expression=default_expression,
        rank_ic=0.052,
        coverage=91.0,
    )

    intake = assert_ok(client.post("/factor-quarantine/intake", json={"mining_job_id": "mine_quarantine_duplicate"}))
    candidate = intake["items"][0]
    run = assert_ok(client.post(f"/factor-quarantine/candidates/{candidate['id']}/run", json={}))

    assert run["status"] == "REJECTED"
    assert run["publish_status"] == "BLOCKED"
    assert "相关性超过 0.3" in run["rejected_reason"]


def test_factor_quarantine_blocks_duplicate_expression_publish() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-quarantine-duplicate-v2"))
    seed_ready_pit_data(client, start=date(2014, 1, 2), day_count=3200)
    default_expression = assert_ok(client.get("/factors/s_mom_12m1m_rank"))["expression"]
    _seed_mining_candidate(
        client,
        job_id="mine_quarantine_duplicate_v2",
        candidate_id="cand_quarantine_duplicate_v2",
        expression=default_expression,
        rank_ic=0.052,
        coverage=91.0,
    )

    intake = assert_ok(client.post("/factor-quarantine/intake", json={"mining_job_id": "mine_quarantine_duplicate_v2"}))
    candidate = intake["items"][0]
    run = assert_ok(client.post(f"/factor-quarantine/candidates/{candidate['id']}/run", json={}))

    assert run["status"] == "REJECTED"
    assert run["publish_status"] == "BLOCKED"
    assert "duplicated" in run["rejected_reason"]


def test_factor_quarantine_empty_intake_pulls_latest_sandbox_job_without_mock_publish() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-quarantine-latest-job"))
    _seed_mining_job_top_candidate_only(client)

    intake = assert_ok(client.post("/factor-quarantine/intake", json={}))

    assert intake["summary"]["intake_count"] == 1
    assert intake["summary"]["source_mining_job_id"] == "mine_latest_only"
    assert intake["summary"]["sandbox_candidates_persisted_to_factor_definitions"] is False
    candidate = intake["items"][0]
    assert candidate["status"] == "PENDING"
    assert candidate["publish_status"] == "BLOCKED"
    assert candidate["source_mining_job_id"] == "mine_latest_only"
    assert candidate["mining_candidate_id"] == "cand_latest_only"
    factors = client.app.state.service.storage.fetch_one(
        "SELECT COUNT(*) AS count FROM factor_definitions WHERE source = 'AUTO_MINED'"
    )
    assert factors["count"] == 0


def test_factor_quarantine_empty_intake_uses_sandbox_top_candidates_and_dedupes_expressions() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-quarantine-dedupe"))
    _seed_mining_job_top_candidate_only(
        client,
        job_id="mine_old_duplicate",
        candidate_id="cand_old_return_5",
        expression="Return(Close, 5)",
        rank_ic=0.05,
        candidate_count=100,
    )
    _seed_mining_job_top_candidate_only(
        client,
        job_id="mine_latest_duplicate",
        candidate_id="cand_latest_return_5",
        expression="Return(Close, 5)",
        rank_ic=0.06,
        candidate_count=101,
    )
    _seed_mining_job_top_candidate_only(
        client,
        job_id="mine_latest_unique",
        candidate_id="cand_latest_rank_21",
        expression="Rank(Return(Close, 21))",
        rank_ic=0.055,
        candidate_count=102,
    )

    intake = assert_ok(client.post("/factor-quarantine/intake", json={}))

    expressions = [item["expression"] for item in intake["items"]]
    assert expressions.count("Return(Close, 5)") == 1
    assert sorted(expressions) == ["Rank(Return(Close, 21))", "Return(Close, 5)"]
    listed = assert_ok(client.get("/factor-quarantine/candidates"))
    assert [item["expression"] for item in listed["items"]].count("Return(Close, 5)") == 1


def _legacy_factor_quarantine_pit_not_full_ready_enters_review_queue_not_rejected() -> None:
    return
    client, _db_path = create_test_client(_runtime_dir("factor-quarantine-pit-review"))
    _seed_mining_candidate(client, rank_ic=0.061, coverage=100.0)

    intake = assert_ok(client.post("/factor-quarantine/intake", json={"mining_job_id": "mine_quarantine_test"}))
    candidate = intake["items"][0]
    run = assert_ok(client.post(f"/factor-quarantine/candidates/{candidate['id']}/run", json={}))

    assert run["status"] == "PASSED"
    assert run["publish_status"] == "ELIGIBLE"
    assert "PIT 未达到 Full Ready" in run["rejected_reason"]
    assert run["publish_eligibility"]["status"] == "MANUAL_REVIEW_REQUIRED"


def test_factor_quarantine_pit_not_full_ready_is_diagnostic_only_and_publishable() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-quarantine-pit-diagnostic-only"))
    _seed_mining_candidate(client, rank_ic=0.061, coverage=100.0)

    intake = assert_ok(client.post("/factor-quarantine/intake", json={"mining_job_id": "mine_quarantine_test"}))
    candidate = intake["items"][0]
    run = assert_ok(client.post(f"/factor-quarantine/candidates/{candidate['id']}/run", json={}))

    assert run["status"] == "PASSED"
    assert run["publish_status"] == "ELIGIBLE"
    assert run["rejected_reason"] is None
    assert run["publish_eligibility"]["status"] == "ELIGIBLE"
    assert run["gate_summary"]["pit_gate_mode"] == "DIAGNOSTIC_ONLY"
    assert run["pit_evidence"]["promotion_eligible"] is True
    assert run["latest_run"]["summary"]["diagnostic_warnings"]

    published = assert_ok(
        client.post(
            f"/factor-quarantine/candidates/{candidate['id']}/publish",
            json={"operator": "system_rule"},
        )
    )
    assert published["factor"]["latest_diagnostic_summary"]["admission_pit_gate_mode"] == "DIAGNOSTIC_ONLY"


def test_factor_quarantine_drawdown_hard_gate_blocks_publish() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-quarantine-drawdown"))
    seed_ready_pit_data(client, start=date(2014, 1, 2), day_count=3200)
    _seed_mining_candidate(
        client,
        rank_ic=0.061,
        coverage=100.0,
        extra_candidate={
            "drawdown_vs_benchmark_ratio": 1.72,
            "max_drawdown_pct": 36.2,
            "benchmark_max_drawdown_pct": 21.0,
        },
    )

    intake = assert_ok(client.post("/factor-quarantine/intake", json={"mining_job_id": "mine_quarantine_test"}))
    candidate = intake["items"][0]
    run = assert_ok(client.post(f"/factor-quarantine/candidates/{candidate['id']}/run", json={}))

    assert run["status"] == "REJECTED"
    assert run["publish_status"] == "BLOCKED"
    assert run["gate_summary"]["max_drawdown_relative_to_benchmark"] >= 1.5
    assert "Max drawdown" in run["rejected_reason"]


def test_factor_quarantine_ir_uses_newey_west_holding_period_adjustment() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-quarantine-newey-west-ir"))
    seed_ready_pit_data(client, start=date(2014, 1, 2), day_count=3200)
    _seed_mining_candidate(
        client,
        expression="Return(Close, 63)",
        rank_ic=0.3697,
        coverage=100.0,
        extra_candidate={
            "holding_period": 63,
            "newey_west_lags": 62,
        },
    )

    intake = assert_ok(client.post("/factor-quarantine/intake", json={"mining_job_id": "mine_quarantine_test"}))
    candidate = intake["items"][0]
    run = assert_ok(client.post(f"/factor-quarantine/candidates/{candidate['id']}/run", json={}))

    assert candidate["candidate_metrics"]["ir"] == 0.9316
    assert candidate["candidate_metrics"]["ir"] < 2.0
    assert candidate["candidate_metrics"]["holding_period"] == 63
    assert run["latest_run"]["is_oos"]["ir_method"] == "newey_west_overlap_adjusted"
    assert run["latest_run"]["is_oos"]["naive_ir"] == 7.394
    assert run["latest_run"]["is_oos"]["newey_west_lags"] == 62


def test_factor_quarantine_auto_residual_rescues_style_correlation() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-quarantine-residual"))
    seed_ready_pit_data(client, start=date(2014, 1, 2), day_count=3200)
    _seed_mining_candidate(
        client,
        expression="Rank(Return(Close, 21))",
        rank_ic=0.061,
        coverage=100.0,
        extra_candidate={
            "max_style_correlation": 0.52,
            "correlation_penalty": 0.22,
            "auto_residual_summary": {
                "residual_expression": 'ZScore(Residual(s_mom_6m_rank, by="s_vol_252d_raw"))',
                "control_factor_id": "s_vol_252d_raw",
                "residual_rank_ic": 0.052,
            },
        },
    )

    intake = assert_ok(client.post("/factor-quarantine/intake", json={"mining_job_id": "mine_quarantine_test"}))
    candidate = intake["items"][0]
    run = assert_ok(client.post(f"/factor-quarantine/candidates/{candidate['id']}/run", json={}))

    assert run["status"] == "PASSED"
    assert run["publish_status"] == "ELIGIBLE"
    assert run["gate_summary"]["auto_residual"] == "PASSED"
    assert run["latest_run"]["orthogonal"]["max_abs_correlation"] < 0.3
    assert run["latest_run"]["orthogonal"]["auto_residual"]["residual_expression"].startswith("ZScore(Residual")


def test_factor_quarantine_intake_tolerates_legacy_duplicate_queue_rows() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-quarantine-legacy-duplicates"))
    _seed_mining_job_top_candidate_only(
        client,
        job_id="mine_latest_legacy",
        candidate_id="cand_latest_legacy",
        expression="Return(Close, 5)",
        rank_ic=0.06,
    )
    storage = client.app.state.service.storage
    now = "2026-05-06T11:00:00Z"
    for candidate_id, mining_candidate_id in (
        ("fq_legacy_return_5_a", "cand_legacy_a"),
        ("fq_legacy_return_5_b", "cand_latest_legacy"),
    ):
        storage.insert_json_row(
            "factor_quarantine_candidates",
            {
                "id": candidate_id,
                "mining_candidate_id": mining_candidate_id,
                "source_mining_job_id": "mine_older_legacy",
                "expression": "Return(Close, 5)",
                "status": "PENDING",
                "publish_status": "BLOCKED",
                "gate_summary_json": dumps({"pit": "PIT 待补证据"}),
                "cluster_id": "cluster_legacy",
                "candidate_metrics_json": dumps({"rank_ic": 0.04, "coverage": 100.0}),
                "failure_samples_json": dumps([]),
                "pit_evidence_json": dumps({"status": "BLOCKED"}),
                "publish_eligibility_json": dumps({"status": "BLOCKED"}),
                "target_factor_id": None,
                "created_at": now,
                "updated_at": now,
                "published_at": None,
                "rejected_reason": None,
            },
        )

    intake = assert_ok(client.post("/factor-quarantine/intake", json={}))
    listed = assert_ok(client.get("/factor-quarantine/candidates"))

    assert intake["summary"]["intake_count"] == 1
    assert [item["expression"] for item in listed["items"]].count("Return(Close, 5)") == 1

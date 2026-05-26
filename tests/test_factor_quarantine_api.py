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
    _seed_mining_candidate(
        client,
        extra_candidate={
            "target_layer": "L3",
            "source_factor_ids": ["s_mom_12m1m_rank", "s_val_ep_ltm_raw"],
            "recipe_family": "style_blend",
            "ir": 1.25,
        },
    )
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
    assert factor["latest_diagnostic_summary"]["naming_protocol_version"] == "factor_display_name_v4_structured"
    assert factor["latest_diagnostic_summary"]["publish_metadata"]["dedupe_strategy"] == "parameter_first_then_sha8"
    assert factor["latest_diagnostic_summary"]["publish_metadata"]["base_display_name_cn"]
    assert published["candidate"]["status"] == "PUBLISHED"

    events = storage.fetch_one("SELECT COUNT(*) AS count FROM factor_publish_events WHERE candidate_id = ?", (candidate["id"],))
    edges = storage.fetch_one("SELECT COUNT(*) AS count FROM factor_lineage_edges WHERE target_id = ?", (factor["id"],))
    assert events["count"] == 1
    assert edges["count"] >= 1

    factors = assert_ok(client.get("/factors"))
    assert factors["summary"]["governance_queue_count"] >= 1
    overview = assert_ok(client.get("/factor-governance/overview"))
    model_action = next(action for action in overview["actions"] if action["kind"] == "FACTOR_MODEL_SUGGESTION")
    assert model_action["factor_ids"] == [factor["id"]]
    assert model_action["suggested_weights"] == [
        {"factor_id": factor["id"], "weight_pct": 100.0, "direction": factor["direction"]}
    ]
    assert model_action["target"]["query"]["weights"] == "100"

    suggestion = assert_ok(client.post("/factor-models/suggestions", json={"factor_id": factor["id"]}))
    assert suggestion["status"] == "DRAFT"
    assert suggestion["review_status"] == "NEEDS_REVIEW"
    assert suggestion["action"]["target"]["route"] == "#/factor-models/new"
    assert factor["id"] in suggestion["action"]["target"]["query"]["factorIds"]


def test_factor_quarantine_intake_skips_raw_f2_without_wnzt_evidence() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-quarantine-raw-f2-wnzt"))
    seed_ready_pit_data(client, start=date(2014, 1, 2), day_count=3200)
    _seed_mining_candidate(
        client,
        job_id="mine_raw_f2_missing_wnzt",
        candidate_id="cand_raw_f2_missing_wnzt",
        expression="TS_Rank(TS_Return(f1_price_close, 21), 63)",
        rank_ic=0.052,
        coverage=98.0,
        extra_candidate={
            "raw_f2": True,
            "target_layer": "L2",
            "p_value": 0.02,
            "s_grade_correlation": 0.22,
        },
    )

    intake = assert_ok(client.post("/factor-quarantine/intake", json={"mining_job_id": "mine_raw_f2_missing_wnzt"}))

    assert intake["items"] == []
    assert intake["summary"]["intake_count"] == 0
    assert intake["summary"]["skipped_raw_f2_needs_refinement_count"] == 1
    queue = assert_ok(client.get("/factor-quarantine/candidates?source_job_id=mine_raw_f2_missing_wnzt"))
    assert queue["summary"]["total"] == 0


def test_factor_quarantine_publish_uses_chinese_auto_mined_name_from_id_and_formula() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-quarantine-publish-name"))
    seed_ready_pit_data(client, start=date(2014, 1, 2), day_count=3200)
    _seed_mining_candidate(
        client,
        job_id="mine_quarantine_name",
        candidate_id="cand_quarantine_name",
        expression="ZScore(Return(Close, 126))",
        rank_ic=0.061,
        coverage=100.0,
    )

    intake = assert_ok(client.post("/factor-quarantine/intake", json={"mining_job_id": "mine_quarantine_name"}))
    candidate = intake["items"][0]
    run = assert_ok(client.post(f"/factor-quarantine/candidates/{candidate['id']}/run", json={"reason": "unit-test"}))
    assert run["status"] == "PASSED"
    assert run["publish_status"] == "ELIGIBLE"

    published = assert_ok(
        client.post(
            f"/factor-quarantine/candidates/{candidate['id']}/publish",
            json={"operator": "system_rule"},
        )
    )
    factor = published["factor"]
    expected_name = "收益率 (126d) [Refined]"
    assert factor["id"] == "s_f2_mom_ret_126d_px"
    assert factor["name"] == expected_name
    assert "[Auto-Mined]" not in factor["name"]
    assert "自动挖掘" not in factor["name"]
    summary = factor["latest_diagnostic_summary"]
    assert summary["rank_ic"] == 0.061
    assert summary["ic_series"]
    assert summary["evidence_heatmap"]
    assert summary["group_returns"]
    assert summary["turnover_decay"]
    assert factor["ic_sparkline"]

    storage = client.app.state.service.storage
    with storage.connection() as conn:
        conn.execute(
            "UPDATE factor_definitions SET name = ? WHERE id = ?",
            ("自动挖掘动量标准化因子（126日收益）", factor["id"]),
        )
        conn.execute(
            "UPDATE factor_diagnostic_runs SET summary_json = ? WHERE factor_id = ?",
            (
                dumps({
                    "run_id": "fdiag_a_mom_auto_015d73d5_rank_publish",
                    "factor_id": factor["id"],
                    "factor_name": "自动挖掘动量标准化因子（126日收益）",
                    "status": "COMPLETED",
                    "rank_ic": 0.061,
                    "ic": 0.0561,
                    "ir": 0.42,
                    "coverage": 100.0,
                    "quarantine": {"candidate_id": candidate["id"]},
                    "promotion_eligible": True,
                }),
                factor["id"],
            ),
        )
    renamed_detail = assert_ok(client.get(f"/factors/{factor['id']}"))
    assert renamed_detail["name"] == expected_name
    assert renamed_detail["latest_diagnostic_summary"]["ic_series"]
    assert renamed_detail["latest_diagnostic_summary"]["evidence_heatmap"]
    assert renamed_detail["latest_diagnostic_summary"]["data_lineage"]["kind"] == "QUARANTINE_PUBLISH_SUMMARY"
    assert renamed_detail["ic_sparkline"]

    legacy_id = "a_mom_auto_015d73d5_rank"
    with storage.connection() as conn:
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.execute(
            "UPDATE factor_definitions SET id = ?, name = ? WHERE id = ?",
            (legacy_id, "[Auto-Mined] a_mom_auto_015d73d5_rank", factor["id"]),
        )
        conn.execute(
            "UPDATE factor_versions SET factor_id = ? WHERE factor_id = ?",
            (legacy_id, factor["id"]),
        )
        conn.execute(
            "UPDATE factor_diagnostic_runs SET factor_id = ? WHERE factor_id = ?",
            (legacy_id, factor["id"]),
        )
        conn.execute(
            "UPDATE factor_publish_events SET factor_id = ? WHERE factor_id = ?",
            (legacy_id, factor["id"]),
        )
        conn.execute(
            "UPDATE factor_lineage_edges SET target_id = ? WHERE target_id = ?",
            (legacy_id, factor["id"]),
        )
        conn.execute(
            "UPDATE factor_crowding_snapshots SET factor_id = ? WHERE factor_id = ?",
            (legacy_id, factor["id"]),
        )
        conn.execute(
            "UPDATE factor_quarantine_candidates SET target_factor_id = ? WHERE target_factor_id = ?",
            (legacy_id, factor["id"]),
        )
        conn.execute("PRAGMA foreign_keys = ON")
    detail = assert_ok(client.get(f"/factors/{factor['id']}"))
    assert detail["id"] == factor["id"]
    assert detail["name"] == expected_name
    factors = assert_ok(client.get("/factors"))
    listed = next(item for item in factors["items"] if item["id"] == factor["id"])
    assert listed["name"] == expected_name
    assert all(item["id"] != legacy_id for item in factors["items"])


def test_factor_quarantine_publish_uses_source_identity_for_complex_f2_fallbacks() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-quarantine-complex-f2-id"))
    seed_ready_pit_data(client, start=date(2014, 1, 2), day_count=3200)
    candidates = [
        (
            "mine_complex_f2_a",
            "cand_complex_f2_a",
            "Rank(s_mom_6m_rank / s_vol_downside_126d_raw)",
            "m_mom_longdra_126d_rank",
        ),
        (
            "mine_complex_f2_b",
            "cand_complex_f2_b",
            "TS_Rank(TS_Return(f1_financial_release_timing, 3), 3)",
            "f1_financial_release_timing",
        ),
    ]
    published_ids: list[str] = []
    for job_id, candidate_id, expression, source_factor_id in candidates:
        _seed_mining_candidate(
            client,
            job_id=job_id,
            candidate_id=candidate_id,
            expression=expression,
            rank_ic=0.055,
            coverage=100.0,
            extra_candidate={
                "target_layer": "L2",
                "source_factor_ids": [source_factor_id],
                "p_value": 0.02,
                "s_grade_correlation": 0.22,
                "oos_to_is_ratio": 0.72,
                "capacity_score": 0.8,
                "crowding_score": 0.2,
            },
        )
        intake = assert_ok(client.post("/factor-quarantine/intake", json={"mining_job_id": job_id}))
        candidate = intake["items"][0]
        run = assert_ok(client.post(f"/factor-quarantine/candidates/{candidate['id']}/run", json={"reason": "unit-test"}))
        assert run["status"] == "PASSED"
        published = assert_ok(client.post(f"/factor-quarantine/candidates/{candidate['id']}/publish"))
        published_ids.append(published["factor"]["id"])

    assert published_ids[0] == "s_f2_mom_raw_cur_m_mom_longdra_126d_rank"
    assert published_ids[1] == "s_f2_mom_raw_cur_f1_financial_release_timing"
    assert len(published_ids) == len(set(published_ids))


def test_factor_quarantine_preserves_composition_parent_lineage() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-quarantine-composition-lineage"))
    seed_ready_pit_data(client, start=date(2014, 1, 2), day_count=3200)
    expression = "s_mom_6m_rank * s_qlty_roe_ltm_raw"
    _seed_mining_candidate(
        client,
        job_id="mine_composition_lineage",
        candidate_id="cand_composition_lineage",
        expression=expression,
        rank_ic=0.061,
        coverage=100.0,
        extra_candidate={
            "source_factor_ids": ["s_mom_6m_rank", "s_qlty_roe_ltm_raw"],
            "recipe_kind": "template",
            "recipe_family": "style_blend",
            "orthogonality_intent": "quality_driven_momentum",
            "composition_metadata": {"publish_boundary": "manual_after_quarantine"},
            "max_style_correlation": 0.24,
            "drawdown_vs_benchmark_ratio": 1.1,
        },
    )

    intake = assert_ok(client.post("/factor-quarantine/intake", json={"mining_job_id": "mine_composition_lineage"}))
    candidate = intake["items"][0]
    metrics = candidate["candidate_metrics"]
    assert metrics["source_factor_ids"] == ["s_mom_6m_rank", "s_qlty_roe_ltm_raw"]
    assert metrics["recipe_family"] == "style_blend"

    storage = client.app.state.service.storage
    parent_edges = storage.fetch_one(
        """
        SELECT COUNT(*) AS count
        FROM factor_lineage_edges
        WHERE target_id = ? AND relation_type = 'COMPOSED_FROM'
        """,
        (candidate["id"],),
    )
    assert parent_edges["count"] == 2

    run = assert_ok(client.post(f"/factor-quarantine/candidates/{candidate['id']}/run", json={"reason": "unit-test"}))
    assert run["latest_run"]["orthogonal"]["source_factor_ids"] == ["s_mom_6m_rank", "s_qlty_roe_ltm_raw"]
    assert run["latest_run"]["summary"]["composition"]["publish_boundary"] == "manual_after_quarantine"
    assert run["target_layer"] == "L3"
    assert [item["label"] for item in run["composition_methods"]] == [
        "风格复合",
        "比例/风险调整（含估值锚定）",
        "排名均值/交集",
        "Fama-French 风格融合",
        "背离惩罚",
        "残差/中性化",
        "时序降噪",
    ]
    assert run["latest_run"]["summary"]["admission_report"]
    assert [item["check"] for item in run["latest_run"]["summary"]["admission_report"]] == [
        "OOS 衰减",
        "正交性",
        "极端压力",
        "换手率",
        "PIT 完整性",
    ]
    assert run["publish_status"] != "PUBLISHED"


def test_factor_quarantine_history_filters_and_l2_operator_chain_projection() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-quarantine-history-filters"))
    seed_ready_pit_data(client, start=date(2014, 1, 2), day_count=3200)
    _seed_mining_candidate(
        client,
        job_id="mine_refinement_chain",
        candidate_id="cand_refinement_chain",
        expression='ZScore(Residual(s_mom_6m_rank, by="s_vol_252d_raw"))',
        rank_ic=0.061,
        coverage=100.0,
        extra_candidate={
            "max_style_correlation": 0.52,
            "auto_residual_summary": {
                "residual_expression": 'ZScore(Residual(s_mom_6m_rank, by="s_vol_252d_raw"))',
                "control_factor_id": "s_vol_252d_raw",
                "residual_rank_ic": 0.052,
            },
        },
    )

    intake = assert_ok(client.post("/factor-quarantine/intake", json={"mining_job_id": "mine_refinement_chain"}))
    candidate = intake["items"][0]
    assert candidate["target_layer"] == "L2"
    assert [item["label"] for item in candidate["operator_chain"]] == [
        "Raw",
        "Winsorize",
        "Neutralize",
        "Z-Score",
        "Rank",
    ]
    run = assert_ok(client.post(f"/factor-quarantine/candidates/{candidate['id']}/run", json={"reason": "unit-test"}))
    assert run["latest_run"]["summary"]["scoring_detail"]["thresholds"]["recommended"]["RankIC"] == "> 0.025"
    assert run["latest_run"]["summary"]["admission_report"][0]["check"] == "OOS 衰减"

    by_name = assert_ok(client.get("/factor-quarantine/candidates?factor_name=Residual&result=PASS"))
    assert any(item["id"] == candidate["id"] for item in by_name["items"])
    by_date = assert_ok(client.get(f"/factor-quarantine/candidates?date={candidate['created_at'][:10]}"))
    assert any(item["id"] == candidate["id"] for item in by_date["items"])


def test_quarantine_history_date_filter_uses_latest_completed_run_date() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-quarantine-history-date"))
    seed_ready_pit_data(client, start=date(2014, 1, 2), day_count=3200)
    _seed_mining_candidate(
        client,
        job_id="mine_history_date",
        candidate_id="cand_history_date",
        expression="Rank(Return(Close, 21))",
        rank_ic=0.061,
        coverage=100.0,
    )

    intake = assert_ok(client.post("/factor-quarantine/intake", json={"mining_job_id": "mine_history_date"}))
    candidate = intake["items"][0]
    storage = client.app.state.service.storage
    storage.execute(
        """
        UPDATE factor_quarantine_candidates
        SET created_at = ?, updated_at = ?
        WHERE id = ?
        """,
        ("2026-05-01T09:00:00Z", "2026-05-01T09:00:00Z", candidate["id"]),
    )

    run = assert_ok(client.post(f"/factor-quarantine/candidates/{candidate['id']}/run", json={"reason": "date-filter"}))
    completed_date = run["latest_run"]["completed_at"][:10]

    by_completed_date = assert_ok(client.get(f"/factor-quarantine/candidates?date={completed_date}"))
    assert any(item["id"] == candidate["id"] for item in by_completed_date["items"])
    matched = next(item for item in by_completed_date["items"] if item["id"] == candidate["id"])
    assert matched["last_quarantine_at"][:10] == completed_date


def test_direct_raw_field_candidate_is_l1_and_gated_by_pit_admission() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-quarantine-l1-raw-field"))
    seed_ready_pit_data(client, start=date(2014, 1, 2), day_count=3200)
    _seed_mining_candidate(
        client,
        job_id="mine_l1_raw_field",
        candidate_id="cand_l1_raw_field",
        expression="Open",
        rank_ic=0.001,
        coverage=100.0,
        extra_candidate={
            "turnover": 0.0,
            "drawdown_vs_benchmark_ratio": 1.8,
            "max_style_correlation": 0.72,
        },
    )

    intake = assert_ok(client.post("/factor-quarantine/intake", json={"mining_job_id": "mine_l1_raw_field"}))
    candidate = intake["items"][0]
    assert candidate["target_layer"] == "L1"
    assert candidate["target_factor_id"] == "f1_px_open"
    assert candidate["scoring_detail"]["status"] == "PASS"
    assert candidate["scoring_detail"]["gate_basis"] == "PIT 准入审计"

    run = assert_ok(client.post(f"/factor-quarantine/candidates/{candidate['id']}/run", json={"reason": "unit-test"}))

    assert run["status"] == "PASSED"
    assert run["publish_status"] == "ELIGIBLE"
    assert run["gate_summary"]["gate_basis"] == "PIT_ADMISSION_ONLY"
    assert run["gate_summary"]["is"] == "PIT_ONLY"
    assert run["gate_summary"]["oos"] == "NOT_REQUIRED_FOR_L1"
    assert run["latest_run"]["summary"]["admission_report"][0]["check"] == "PIT 准入审计"
    assert "Rank IC" not in (run["rejected_reason"] or "")

    published = assert_ok(
        client.post(
            f"/factor-quarantine/candidates/{candidate['id']}/publish",
            json={"operator": "unit-test"},
        )
    )
    assert published["candidate"]["status"] == "PUBLISHED"
    assert published["candidate"]["target_layer"] == "L1"
    assert published["candidate"]["target_factor_id"] == "f1_px_open"
    assert published["factor"]["id"] == "f1_px_open"


def test_return_operator_candidate_is_l2_raw_signal_not_l1_pit_only() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-quarantine-return-l2"))
    seed_ready_pit_data(client, start=date(2014, 1, 2), day_count=3200)
    _seed_mining_candidate(
        client,
        job_id="mine_return_l2",
        candidate_id="cand_return_l2",
        expression="Return(Close, 5)",
        rank_ic=0.001,
        coverage=100.0,
        extra_candidate={
            "turnover": 0.0,
            "drawdown_vs_benchmark_ratio": 1.8,
            "max_style_correlation": 0.72,
            "target_layer": "L1",
        },
    )

    intake = assert_ok(client.post("/factor-quarantine/intake", json={"mining_job_id": "mine_return_l2"}))
    candidate = intake["items"][0]
    assert candidate["target_layer"] == "L2"
    assert candidate["scoring_detail"]["processing_status"] == "RAW_SIGNAL"
    assert candidate["scoring_detail"]["gate_basis"] == "RankIC / ICIR / Coverage / 风格与成本阈值"
    assert "W 去极值缺失" in candidate["scoring_detail"]["wnzt_missing"]

    run = assert_ok(client.post(f"/factor-quarantine/candidates/{candidate['id']}/run", json={"reason": "unit-test"}))

    assert run["status"] == "REJECTED"
    assert run["publish_status"] == "BLOCKED"
    assert run["gate_summary"]["target_layer"] == "L2"
    assert run["gate_summary"]["gate_basis"] == "PREDICTIVE_AND_QUARANTINE"
    assert run["gate_summary"]["is"] == "FAILED"
    assert run["gate_summary"]["oos"] != "NOT_REQUIRED_FOR_L1"
    assert run["latest_run"]["summary"]["admission_report"][0]["check"] == "OOS 衰减"
    assert any(row["check"] == "WNZT 透明度" and row["status"] == "WARN" for row in run["latest_run"]["summary"]["admission_report"])
    assert any(row["check"] == "逻辑冗余观察" and row["status"] == "WARN" for row in run["latest_run"]["summary"]["admission_report"])
    assert "PIT_ONLY" not in run["gate_summary"].values()


def test_return_operator_candidate_publishes_as_l2_atomic_raw_signal_with_risk_notes() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-quarantine-return-l2-publish"))
    seed_ready_pit_data(client, start=date(2014, 1, 2), day_count=3200)
    _seed_mining_candidate(
        client,
        job_id="mine_return_l2_publish",
        candidate_id="cand_return_l2_publish",
        expression="Return(Close, 5)",
        rank_ic=0.061,
        coverage=100.0,
        extra_candidate={
            "turnover": 12.0,
            "drawdown_vs_benchmark_ratio": 1.0,
            "max_style_correlation": 0.12,
            "target_layer": "L1",
        },
    )

    intake = assert_ok(client.post("/factor-quarantine/intake", json={"mining_job_id": "mine_return_l2_publish"}))
    candidate = intake["items"][0]
    assert candidate["target_layer"] == "L2"

    run = assert_ok(client.post(f"/factor-quarantine/candidates/{candidate['id']}/run", json={"reason": "unit-test"}))

    assert run["status"] == "PASSED"
    assert run["publish_status"] == "ELIGIBLE"
    assert run["gate_summary"]["target_layer"] == "L2"
    assert run["latest_run"]["summary"]["scoring_detail"]["processing_status"] == "RAW_SIGNAL"
    assert any(tag["code"] == "WNZT_MISSING" for tag in run["latest_run"]["risk_tags"])
    assert any(tag["code"] == "LOGIC_REDUNDANCY_WATCH" for tag in run["latest_run"]["risk_tags"])

    published = assert_ok(
        client.post(
            f"/factor-quarantine/candidates/{candidate['id']}/publish",
            json={"operator": "unit-test"},
        )
    )
    factor = published["factor"]
    assert factor["id"] == "s_f2_mom_ret_5d_px"
    assert factor["latest_diagnostic_summary"]["target_layer"] == "L2"
    assert factor["latest_diagnostic_summary"]["quarantine"]["target_layer"] == "L2"
    assert factor["latest_diagnostic_summary"]["quarantine"]["publish_naming_rule"] == "factor_display_name_v4"
    assert published["candidate"]["target_layer"] == "L2"


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
    assert "表达式与已有因子逻辑重复" in run["rejected_reason"]


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


def test_factor_quarantine_explicit_job_intake_preserves_source_batch_when_expression_published() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-quarantine-source-batch-published"))
    expression = "ZScore(Return(Close, 5))"
    storage = client.app.state.service.storage
    storage.insert_json_row(
        "factor_quarantine_candidates",
        {
            "id": "fq_published_return_5",
            "mining_candidate_id": "cand_old_return_5",
            "source_mining_job_id": "mine_old_return_5",
            "expression": expression,
            "status": "PUBLISHED",
            "publish_status": "PUBLISHED",
            "gate_summary_json": dumps({"pit": "Full Ready"}),
            "cluster_id": "cluster_published_return_5",
            "candidate_metrics_json": dumps({"rank_ic": 0.05, "coverage": 100.0}),
            "failure_samples_json": dumps([]),
            "pit_evidence_json": dumps({"status": "READY"}),
            "publish_eligibility_json": dumps({"status": "PUBLISHED"}),
            "target_factor_id": "s_f2_mom_ret_5d_px",
            "created_at": "2026-05-05T09:00:00Z",
            "updated_at": "2026-05-05T09:00:00Z",
            "published_at": "2026-05-05T09:00:00Z",
            "rejected_reason": None,
        },
    )
    _seed_mining_candidate(
        client,
        job_id="mine_current_return_5",
        candidate_id="cand_current_return_5",
        expression=expression,
        rank_ic=0.061,
        coverage=100.0,
    )

    intake = assert_ok(client.post("/factor-quarantine/intake", json={"mining_job_id": "mine_current_return_5"}))

    assert intake["summary"]["intake_count"] == 1
    candidate = intake["items"][0]
    assert candidate["id"] != "fq_published_return_5"
    assert candidate["source_mining_job_id"] == "mine_current_return_5"
    assert candidate["mining_candidate_id"] == "cand_current_return_5"
    assert candidate["status"] == "PENDING"
    source_queue = assert_ok(client.get("/factor-quarantine/candidates?source_job_id=mine_current_return_5"))
    assert source_queue["summary"]["total"] == 1
    published = storage.fetch_one("SELECT * FROM factor_quarantine_candidates WHERE id = ?", ("fq_published_return_5",))
    assert published["source_mining_job_id"] == "mine_old_return_5"
    assert published["status"] == "PUBLISHED"

    second_intake = assert_ok(client.post("/factor-quarantine/intake", json={"mining_job_id": "mine_current_return_5"}))
    assert second_intake["summary"]["intake_count"] == 1
    second_queue = assert_ok(client.get("/factor-quarantine/candidates?source_job_id=mine_current_return_5"))
    assert second_queue["summary"]["total"] == 1


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
    assert "最大回撤相对基准超过 1.5x" in run["rejected_reason"]
    assert "PIT Full Ready" not in run["rejected_reason"]


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

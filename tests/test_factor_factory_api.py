from __future__ import annotations

import json
from pathlib import Path
from uuid import uuid4

from grit_backtest_platform._real_service_rebuilt import FACTOR_FACTORY_SYNC_QUARANTINE_LIMIT
from grit_backtest_platform.factor_research import FactorResearchService
from grit_backtest_platform.storage import dumps
from tests.api_test_support import assert_ok, create_test_client
from tests.test_factor_mining_api import seed_factor_mining_price_snapshot, wait_for_factor_mining_job
from tests.test_pit_preprocessing_f1_catalog import _seed_price_snapshot_with_l1_gap


def _runtime_dir(name: str) -> Path:
    path = Path(".tmp") / "pytest-runtime" / f"{name}-{uuid4().hex}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _factory_payload(candidate_count: int = 8) -> dict:
    return {
        "schedule_time": "14:00",
        "timezone": "Asia/Hong_Kong",
        "request": {
            "universe": "AAPL,MSFT,NVDA,AMZN,JPM,XOM",
            "start_date": "2018-01-01",
            "end_date": "2024-12-31",
            "operators": ["return", "rank", "zscore"],
            "candidate_count": candidate_count,
            "random_seed": 17,
            "min_rank_ic": 0.0,
            "max_depth": 3,
            "generation_mode": "HYBRID_COMPOSITION",
            "source_factor_ids": [
                "s_mom_6m_rank",
                "s_qlty_roe_ltm_raw",
                "s_vol_252d_rank",
                "s_val_cfp_ltm_raw",
                "s_size_cur_log",
                "s_vol_downside_252d_rank",
                "s_liq_amihud_20d_rank",
            ],
            "recipe_families": [
                "style_blend",
                "risk_adjusted",
                "value_anchor",
                "divergence",
                "residual_neutralized",
                "ts_denoise",
            ],
            "exploration_budget": 4,
            "composition_policy": {
                "mode": "template_plus_exploration",
                "publish_boundary": "manual_after_quarantine",
            },
        },
        "gate_policy": {
            "pit_gate_mode": "DIAGNOSTIC_ONLY",
            "max_style_correlation": 0.3,
            "residual_enabled": True,
            "max_drawdown_relative_to_benchmark": 1.5,
            "min_oos_to_is_ratio": 0.6,
        },
    }


def _seed_online_f2_factor(
    client,
    *,
    factor_id: str,
    expression: str,
    name: str = "Online Raw F2 Momentum",
    source: str = "AUTO_MINED",
    lifecycle_status: str = "VERIFIED",
    diagnostic_status: str = "COMPLETED",
) -> None:
    now = "2026-05-20T08:00:00Z"
    summary = {
        "status": "COMPLETED",
        "rank_ic": 0.041,
        "pure_rank_ic": 0.041,
        "ir": 0.91,
        "coverage": 98.5,
        "turnover": 12.0,
    }
    with client.app.state.service.storage.connection() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO factor_definitions (
                id, name, market, universe, source, lifecycle_status, diagnostic_status,
                direction, frequency, expression, tags_json, data_requirements_json,
                institutional_note, created_by, created_at, updated_at
            )
            VALUES (?, ?, 'US', 'SP500', ?, ?, ?,
                'HIGH_IS_BETTER', 'DAILY', ?, ?, ?, ?, 'factor_factory_test', ?, ?)
            """,
            (
                factor_id,
                name,
                source,
                lifecycle_status,
                diagnostic_status,
                expression,
                json.dumps(["online", "f2"], ensure_ascii=False),
                json.dumps(["adj_close", "price_history", "returns"], ensure_ascii=False),
                "Online F2 seed for one-off refinement tests.",
                now,
                now,
            ),
        )
        conn.execute(
            """
            INSERT OR REPLACE INTO factor_versions (id, factor_id, version, expression, status, metadata_json, created_at)
            VALUES (?, ?, 1, ?, 'ACTIVE', '{}', ?)
            """,
            (f"{factor_id}-v1", factor_id, expression, now),
        )
        conn.execute(
            """
            INSERT OR REPLACE INTO factor_diagnostic_runs (
                id, factor_id, status, dataset_snapshot_id, universe_snapshot_id,
                request_json, summary_json, artifact_refs_json, created_at, completed_at
            )
            VALUES (?, ?, 'COMPLETED', 'ds-price', 'un-sp500', '{}', ?, '{}', ?, ?)
            """,
            (f"fdiag_{factor_id}", factor_id, json.dumps(summary), now, now),
        )


def _factory_payload_with_operator_snapshot(
    client,
    *,
    candidate_count: int = 8,
    daily_formula_budget: int = 12,
) -> dict:
    config = assert_ok(client.get("/factor-factory/operator-config"))
    draft = {
        **config["draft"],
        "enabled_operators": ["TS_Return", "TS_Rank"],
        "window_space": [5, 21],
        "daily_formula_budget": daily_formula_budget,
    }
    snapshot = assert_ok(client.post("/factor-factory/operator-config/snapshots", json=draft))
    payload = _factory_payload(candidate_count=candidate_count)
    payload["operator_config_snapshot_id"] = snapshot["snapshot_id"]
    payload["f1_catalog_snapshot_id"] = config["latest_f1_catalog_snapshot"]["snapshot_id"]
    return payload


def test_factor_factory_overview_and_daily_start_are_idempotent() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-factory-start"))
    seed_factor_mining_price_snapshot(client)
    payload = _factory_payload_with_operator_snapshot(client)

    initial = assert_ok(client.get("/factor-factory/overview"))
    assert initial["profile"]["status"] == "PAUSED"
    assert initial["profile"]["schedule_time"] == "14:00"
    assert initial["gate_policy"]["pit_gate_mode"] == "DIAGNOSTIC_ONLY"

    started = assert_ok(client.post("/factor-factory/automation/start", json=payload))
    assert started["profile"]["status"] == "ACTIVE"
    assert started["profile"]["timezone"] == "Asia/Hong_Kong"
    assert started["daily_run"]["trigger"] == "DAILY"
    assert started["daily_run"]["summary"]["daily_automation"] is True
    mining_job_id = started["daily_run"]["mining_job_id"]
    assert mining_job_id
    wait_for_factor_mining_job(client, mining_job_id)

    duplicate = assert_ok(client.post("/factor-factory/automation/start", json=payload))
    assert duplicate["daily_run"]["id"] == started["daily_run"]["id"]
    assert duplicate["funnel"]["mined_candidates"] >= 1


def test_factor_factory_run_auto_intakes_and_executes_quarantine() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-factory-auto-quarantine"))
    seed_factor_mining_price_snapshot(client)
    payload = _factory_payload_with_operator_snapshot(client, candidate_count=6, daily_formula_budget=12)

    run_now = assert_ok(client.post("/factor-factory/run-now", json=payload))
    mining_job_id = run_now["manual_run"]["mining_job_id"]
    assert mining_job_id
    wait_for_factor_mining_job(client, mining_job_id)

    overview = assert_ok(client.get("/factor-factory/overview"))
    summary = overview["latest_run"]["summary"]
    assert overview["latest_run"]["request"]["generation_mode"] == "HYBRID_COMPOSITION"
    assert summary["generation_mode"] == "OPERATOR_ENGINE"
    assert summary["operator_engine"]["backend"] == "pandas_bottleneck"
    operator_summary = summary["operator_engine"]
    assert operator_summary["deduped_formula_count"] >= 1
    assert operator_summary["raw_f2_batch_delivered_count"] == operator_summary["deduped_formula_count"]
    assert operator_summary["refined_f2_batch_delivered_count"] == operator_summary["raw_f2_batch_delivered_count"]
    assert operator_summary["f3_composition_candidate_count"] >= 1
    assert operator_summary["composition_methods"]
    assert operator_summary["raw_f2_batch_delivered_count"] >= operator_summary["top_preview_count"]
    assert operator_summary["top_preview_count"] == 6
    assert Path(operator_summary["artifact_refs"]["formula_manifest"]).exists()
    assert Path(operator_summary["artifact_refs"]["raw_f2_matrix"]).exists()
    assert summary["auto_quarantine_status"] == "COMPLETED"
    delivered_candidate_count = (
        operator_summary["refined_f2_batch_delivered_count"]
        + operator_summary.get("f3_composition_candidate_count", 0)
    )
    assert summary["auto_intake_count"] == delivered_candidate_count
    assert summary["auto_quarantine_count"] == delivered_candidate_count
    assert summary["auto_intake_skipped_raw_f2_needs_refinement_count"] == 0
    assert overview["phase2_contract"]["flow"] == "B1-B2-B3"
    assert overview["phase2_contract"]["l2_operator_chain"] == "F1 -> OperatorEngine -> Raw_F2 -> WNZT -> Refined F2"
    assert [row["kind"] for row in overview["task_rows"]] == ["mining", "composition"]
    assert {row["status"] for row in overview["task_rows"]} <= {"待开始", "进行中", "已完成"}
    assert overview["task_rows"][0]["target_layer"] == "L2"
    assert "因子挖掘任务" in overview["task_rows"][0]["title"]
    assert overview["task_rows"][0]["flow"] == ["F1", "算子展开", "Raw_F2", "WNZT", "Refined_F2"]
    assert overview["task_rows"][0]["metric_label"] == "Raw_F2因子交付量"
    assert overview["task_rows"][0]["metric_value"] == operator_summary["raw_f2_batch_delivered_count"]
    assert overview["task_rows"][0]["secondary_metric_label"] == "Refined_F2因子交付量"
    assert overview["task_rows"][0]["secondary_metric_value"] == operator_summary["refined_f2_batch_delivered_count"]
    assert overview["task_rows"][1]["target_layer"] == "L3"
    assert overview["task_rows"][1]["metric_label"] == "组合候选量"
    assert "因子组合任务" in overview["task_rows"][1]["title"]
    assert overview["monitor_summary"]["formula_count"] == operator_summary["deduped_formula_count"]
    assert overview["monitor_summary"]["initial_screen_pass_count"] == operator_summary["refined_f2_batch_delivered_count"]
    assert overview["scoring_candidates"] == []
    assert overview["quarantine_result_rows"]
    assert all(row["quarantine_result"] in {"PASS", "WARN", "FAIL"} for row in overview["quarantine_result_rows"])
    assert all("?" not in row["reason_summary"] for row in overview["quarantine_result_rows"][:10])
    assert all(row["target_layer"] != "L1" for row in overview["quarantine_result_rows"] if "Return(" in row["factor_name"])
    redundancy_pruning = overview["latest_run"]["summary"]["redundancy_pruning"]
    assert redundancy_pruning["status"] == "COMPLETED"
    publishable_factor_ids = [row["factor_id"] for row in overview["publishable_factors"]]
    assert len(publishable_factor_ids) == len(set(publishable_factor_ids))
    assert overview["publishable_factors"]
    publishable_names = [row["display_name_cn"] for row in overview["publishable_factors"]]
    assert len(publishable_names) == len(set(publishable_names))
    assert all(
        row["display_name_cn"] == row["base_display_name_cn"]
        for row in overview["publishable_factors"]
        if row.get("base_display_name_cn")
    )
    assert all(row.get("compact_display_name_cn") for row in overview["publishable_factors"])
    publishable = overview["publishable_factors"][0]
    assert publishable["candidate_metrics"]["rank_ic"]
    assert publishable["scoring_detail"]["predictive_power"]["rank_ic"]
    assert publishable["admission_report"]
    assert publishable["raw_expression"].startswith("TS_Rank(TS_Return(")
    assert publishable["refined_expression"] == publishable["expression"]

    quarantine = assert_ok(client.get(f"/factor-quarantine/candidates?source_job_id={mining_job_id}"))
    assert quarantine["items"]
    assert quarantine["summary"]["total"] == delivered_candidate_count
    assert quarantine["summary"]["page_size"] == 50
    assert len(quarantine["items"]) == min(50, delivered_candidate_count)
    assert {item["status"] for item in quarantine["items"]}.isdisjoint({"PENDING", "RUNNING"})
    assert all(item["publish_status"] != "PUBLISHED" for item in quarantine["items"])
    assert any(item["candidate_metrics"].get("source_factor_ids") for item in quarantine["items"])
    f3_item = next(item for item in quarantine["items"] if item["target_layer"] == "L3")
    f3_metrics = f3_item["candidate_metrics"]
    assert f3_metrics["composition_metadata"]["method_id"]
    assert f3_metrics["composition_metadata"]["method_type"] in {
        "LINEAR_WEIGHTING",
        "RATIO_RISK_ADJUSTED",
        "RESIDUAL_ORTHOGONAL",
        "RANK_POOLING",
        "FFBLEND_STYLE",
        "DIVERGENCE_PENALTY",
        "TIME_SERIES_DENOISE",
    }
    assert f3_metrics["composition_metadata"]["publish_boundary"] == "D2_QUARANTINE_ONLY"
    assert f3_metrics["persisted_to_factor_definitions"] is False
    assert f3_item["display_name_cn"] == f3_item["base_display_name_cn"]
    assert f3_item.get("compact_display_name_cn")
    raw_item = next(item for item in quarantine["items"] if item["target_layer"] == "L2")
    assert raw_item["display_name_cn"] == raw_item["base_display_name_cn"]
    assert raw_item.get("compact_display_name_cn")
    assert raw_item["candidate_metrics"]["raw_f2"] is True
    assert raw_item["candidate_metrics"]["refined_f2"] is True
    assert raw_item["wnzt_complete"] is True
    assert raw_item["raw_expression"].startswith("TS_Rank(TS_Return(")
    assert raw_item["refined_expression"] == raw_item["expression"]
    assert "Winsorize(" in raw_item["expression"]
    assert "Neutralize(" in raw_item["expression"]
    assert "ZScore(" in raw_item["expression"]
    assert raw_item["wnzt_missing"] == []
    assert "Raw_F2" not in str(raw_item.get("rejected_reason") or "")

    second_page = assert_ok(client.get(f"/factor-quarantine/candidates?source_job_id={mining_job_id}&page=2&page_size=50"))
    assert second_page["summary"]["page"] == 2
    assert second_page["summary"]["total"] == quarantine["summary"]["total"]


def test_factor_factory_overview_does_not_sync_large_existing_quarantine_batch() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-factory-large-existing-quarantine"))
    service = client.app.state.service
    now = "2099-01-01T00:00:00Z"
    run_id = "ffr_large_existing_quarantine"
    mining_job_id = "mine_op_large_existing_quarantine"
    operator_engine = {
        "backend": "pandas_bottleneck",
        "deduped_formula_count": 60,
        "generated_formula_count": 60,
        "raw_f2_batch_delivered_count": 60,
        "refined_f2_batch_delivered_count": 60,
        "top_preview_count": 50,
        "artifact_refs": {},
    }
    service.storage.insert_json_row(
        "factor_mining_jobs",
        {
            "id": mining_job_id,
            "status": "COMPLETED",
            "request_json": dumps({"operator_engine": operator_engine}),
            "progress_json": dumps({"current": 60, "total": 60}),
            "summary_json": dumps({"generation_mode": "OPERATOR_ENGINE", "operator_engine": operator_engine}),
            "top_candidates_json": dumps([]),
            "failed_samples_json": dumps([]),
            "created_at": now,
            "updated_at": now,
            "completed_at": now,
            "error_message": None,
        },
    )
    service.storage.insert_json_row(
        "factor_factory_runs",
        {
            "id": run_id,
            "profile_id": "default",
            "run_date": "2099-01-01",
            "trigger": "MANUAL",
            "status": "COMPLETED",
            "request_json": dumps({"generation_mode": "OPERATOR_ENGINE"}),
            "gate_policy_json": dumps({"pit_gate_mode": "DIAGNOSTIC_ONLY"}),
            "config_signature": "large-existing",
            "mining_job_id": mining_job_id,
            "summary_json": dumps({"operator_engine": operator_engine}),
            "started_at": now,
            "completed_at": now,
            "created_at": now,
            "updated_at": now,
            "error_message": None,
        },
    )
    old_run_id = "ffr_large_existing_quarantine_old"
    service.storage.insert_json_row(
        "factor_factory_runs",
        {
            "id": old_run_id,
            "profile_id": "default",
            "run_date": "2098-12-31",
            "trigger": "MANUAL",
            "status": "COMPLETED",
            "request_json": dumps({"generation_mode": "OPERATOR_ENGINE"}),
            "gate_policy_json": dumps({"pit_gate_mode": "DIAGNOSTIC_ONLY"}),
            "config_signature": "large-existing-old",
            "mining_job_id": mining_job_id,
            "summary_json": dumps({
                "operator_engine": operator_engine,
                "mining_status": "COMPLETED",
                "top_candidate_count": 0,
                "failed_sample_count": 0,
                "auto_quarantine_status": "COMPLETED",
                "funnel": {
                    "mined_candidates": 60,
                    "quarantine_candidates": 0,
                    "passed": 0,
                    "review_or_observation": 0,
                    "rejected": 0,
                    "published": 0,
                },
            }),
            "started_at": "2098-12-31T00:00:00Z",
            "completed_at": "2098-12-31T00:00:00Z",
            "created_at": "2098-12-31T00:00:00Z",
            "updated_at": "2098-12-31T00:00:00Z",
            "error_message": None,
        },
    )
    for index in range(FACTOR_FACTORY_SYNC_QUARANTINE_LIMIT + 1):
        service.storage.insert_json_row(
            "factor_quarantine_candidates",
            {
                "id": f"fq_large_existing_{index:03d}",
                "mining_candidate_id": f"cand_large_existing_{index:03d}",
                "source_mining_job_id": mining_job_id,
                "expression": f"ZScore(Neutralize(Winsorize(TS_Rank(TS_Return(Close, {index + 1}), 3), method=\"MAD\"), by=\"industry\"))",
                "status": "PASSED" if index == 0 else "PENDING",
                "publish_status": "ELIGIBLE" if index == 0 else "BLOCKED",
                "gate_summary_json": dumps({"target_layer": "L2", "redundancy_pruning": "PASSED"}),
                "cluster_id": f"large_existing_{index:03d}",
                "candidate_metrics_json": dumps({
                    "rank_ic": 0.04,
                    "ir": 0.2,
                    "coverage": 95.0,
                    "target_layer": "L2",
                    "raw_f2": True,
                    "refined_f2": True,
                    "wnzt_complete": True,
                    "pipeline_version": "raw_refined_f2_v2",
                }),
                "failure_samples_json": dumps([]),
                "pit_evidence_json": dumps({"status": "DIAGNOSTIC_ONLY"}),
                "publish_eligibility_json": dumps({"status": "BLOCKED", "reason": "等待有界检疫"}),
                "target_factor_id": None,
                "created_at": now,
                "updated_at": now,
                "published_at": None,
                "rejected_reason": None,
            },
        )

    original_intake = service.factor_quarantine_intake
    original_blockers = service._factor_factory_library_publish_blockers  # noqa: SLF001
    original_refresh = service._refresh_factor_factory_run_row  # noqa: SLF001
    original_list_mining_jobs = service.list_factor_mining_jobs
    original_get_mining_job = service.get_factor_mining_job
    refresh_calls = []
    list_mining_job_calls = 0
    get_mining_job_calls = 0

    def fail_if_sync_intake(_request):
        raise AssertionError("overview must not synchronously re-intake large existing quarantine batches")

    def fail_if_sync_blockers():
        raise AssertionError("overview must not synchronously build library blockers for partial large batches")

    def counted_refresh(row, **kwargs):
        refresh_calls.append(row.get("id"))
        return original_refresh(row, **kwargs)

    def counted_list_mining_jobs():
        nonlocal list_mining_job_calls
        list_mining_job_calls += 1
        return original_list_mining_jobs()

    def counted_get_mining_job(job_id):
        nonlocal get_mining_job_calls
        get_mining_job_calls += 1
        return original_get_mining_job(job_id)

    service.factor_quarantine_intake = fail_if_sync_intake
    service._factor_factory_library_publish_blockers = fail_if_sync_blockers  # noqa: SLF001
    service._refresh_factor_factory_run_row = counted_refresh  # noqa: SLF001
    service.list_factor_mining_jobs = counted_list_mining_jobs
    service.get_factor_mining_job = counted_get_mining_job
    try:
        overview = assert_ok(client.get("/factor-factory/overview"))
    finally:
        service.factor_quarantine_intake = original_intake
        service._factor_factory_library_publish_blockers = original_blockers  # noqa: SLF001
        service._refresh_factor_factory_run_row = original_refresh  # noqa: SLF001
        service.list_factor_mining_jobs = original_list_mining_jobs
        service.get_factor_mining_job = original_get_mining_job

    summary = overview["latest_run"]["summary"]
    assert summary["auto_quarantine_status"] == "PARTIAL"
    assert summary["auto_intake_count"] == FACTOR_FACTORY_SYNC_QUARANTINE_LIMIT + 1
    assert summary["auto_quarantine_count"] == 1
    assert summary["auto_quarantine_pending_count"] == FACTOR_FACTORY_SYNC_QUARANTINE_LIMIT
    assert summary["redundancy_pruning"]["status"] == "DEFERRED"
    assert summary["redundancy_pruning"]["reason"] == "existing_quarantine_exceeds_sync_limit"
    assert overview["publishable_factors"] == []
    assert refresh_calls == [run_id]
    assert list_mining_job_calls == 1
    assert get_mining_job_calls == 0


def test_factor_factory_refines_online_raw_f2_library_factors_to_quarantine() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-factory-online-raw-f2"))
    seed_factor_mining_price_snapshot(client)
    raw_factor_id = "s_f2_online_raw_mom_21d"
    raw_expression = "TS_Rank(Return(Close, 21), 63)"
    _seed_online_f2_factor(client, factor_id=raw_factor_id, expression=raw_expression)
    snapshot_payload = _factory_payload_with_operator_snapshot(client, candidate_count=4, daily_formula_budget=8)

    response = assert_ok(client.post(
        "/factor-factory/refine-online-raw-f2",
        json={
            "gate_policy": snapshot_payload["gate_policy"],
            "factor_ids": [raw_factor_id],
            "candidate_limit": 10,
            "operator_config_snapshot_id": snapshot_payload["operator_config_snapshot_id"],
            "f1_catalog_snapshot_id": snapshot_payload["f1_catalog_snapshot_id"],
        },
    ))

    run = response["online_raw_f2_run"]
    mining_job_id = run["mining_job_id"]
    assert run["summary"]["one_time_task"] is True
    assert run["summary"]["generation_mode"] == "ONLINE_RAW_F2_REFINEMENT"
    overview = assert_ok(client.get("/factor-factory/overview"))
    operator_summary = overview["latest_run"]["summary"]["operator_engine"]
    assert operator_summary["source"] == "online_factor_library_raw_f2"
    assert operator_summary["raw_f2_batch_delivered_count"] == 1
    assert operator_summary["refined_f2_batch_delivered_count"] == 1
    assert operator_summary["source_factor_ids"] == [raw_factor_id]

    manifest_path = Path(operator_summary["artifact_refs"]["formula_manifest"])
    assert manifest_path.exists()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["job_id"] == mining_job_id
    assert manifest["source_job_id"] == mining_job_id
    assert manifest["formula_count"] == 1
    assert manifest["refined_count"] == 1
    assert manifest["created_at"]
    assert manifest["hash"]

    quarantine = assert_ok(client.get(f"/factor-quarantine/candidates?source_job_id={mining_job_id}"))
    assert quarantine["summary"]["total"] == 1
    item = quarantine["items"][0]
    metrics = item["candidate_metrics"]
    assert metrics["source_factor_ids"] == [raw_factor_id]
    assert metrics["raw_expression"] == raw_expression
    assert metrics["refined_expression"] == item["expression"]
    assert metrics["artifact_refs"]["source_factor_id"] == raw_factor_id
    assert item["wnzt_complete"] is True
    assert item["target_layer"] == "L2"
    assert "Winsorize(" in item["expression"]
    assert "Neutralize(" in item["expression"]
    assert "ZScore(" in item["expression"]


def test_factor_factory_refines_all_raw_f2_library_scope_not_only_active() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-factory-all-raw-f2"))
    seed_factor_mining_price_snapshot(client)
    snapshot_payload = _factory_payload_with_operator_snapshot(client, candidate_count=4, daily_formula_budget=8)
    client.app.state.service._factor_research_service().ensure_default_factors()  # noqa: SLF001
    archived_raw_factor_id = "x_archived_blocked_raw_f2"
    _seed_online_f2_factor(
        client,
        factor_id=archived_raw_factor_id,
        expression="Return(Close, 9)",
        source="SYSTEM_SEED",
        lifecycle_status="PRUNED",
        diagnostic_status="BLOCKED_DATA",
    )
    active_alias_factor_id = "x_active_alias_raw_f2"
    _seed_online_f2_factor(
        client,
        factor_id=active_alias_factor_id,
        expression="Return(Close, 9)",
        source="AUTO_MINED",
        lifecycle_status="VERIFIED",
        diagnostic_status="COMPLETED",
    )
    rows = client.app.state.service.storage.fetch_all(
        """
        SELECT id, expression
        FROM factor_definitions
        WHERE deleted_at IS NULL
        """
    )
    expected_ids = {
        row["id"]
        for row in rows
        if FactorResearchService._factor_tier_key(row) == "F2"
        and FactorResearchService._factor_phase2_wnzt_missing(row.get("expression") or "")
    }
    assert "s_vol_252d_rank" in expected_ids
    assert archived_raw_factor_id in expected_ids
    assert active_alias_factor_id in expected_ids
    assert len(expected_ids) > 1

    response = assert_ok(client.post(
        "/factor-factory/refine-online-raw-f2",
        json={
            "gate_policy": snapshot_payload["gate_policy"],
            "candidate_limit": 100,
            "operator_config_snapshot_id": snapshot_payload["operator_config_snapshot_id"],
            "f1_catalog_snapshot_id": snapshot_payload["f1_catalog_snapshot_id"],
        },
    ))

    operator_summary = response["online_raw_f2_run"]["summary"]["operator_engine"]
    source_ids = set(operator_summary["source_factor_ids"])
    assert operator_summary["raw_f2_batch_delivered_count"] == len(expected_ids)
    assert operator_summary["refined_f2_batch_delivered_count"] == len(expected_ids)
    assert source_ids == expected_ids
    assert operator_summary["source_factor_scope"] == "all_raw_f2_factor_definitions"
    assert "s_vol_252d_rank" in source_ids
    assert archived_raw_factor_id in source_ids
    assert active_alias_factor_id in source_ids

    quarantine = assert_ok(client.get(f"/factor-quarantine/candidates?source_job_id={response['online_raw_f2_run']['mining_job_id']}&page_size=200"))
    quarantine_source_ids = {
        source_id
        for item in quarantine["items"]
        for source_id in item["candidate_metrics"].get("source_factor_ids", [])
    }
    assert source_ids == quarantine_source_ids
    assert any(
        {archived_raw_factor_id, active_alias_factor_id}.issubset(set(item["candidate_metrics"].get("source_factor_ids", [])))
        for item in quarantine["items"]
    )
    assert all(
        item["display_name_cn"] == item["base_display_name_cn"]
        for item in quarantine["items"]
        if item.get("base_display_name_cn")
    )
    overview = assert_ok(client.get("/factor-factory/overview"))
    publishable_names = [row["display_name_cn"] for row in overview["publishable_factors"]]
    assert len(publishable_names) == len(set(publishable_names))


def test_factor_factory_online_raw_f2_refinement_skips_already_refined_f2() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-factory-online-refined-skip"))
    seed_factor_mining_price_snapshot(client)
    refined_expression = 'ZScore(Neutralize(Winsorize(TS_Rank(Return(Close, 21), 63), method="MAD"), by="industry,market_cap"))'
    _seed_online_f2_factor(
        client,
        factor_id="s_f2_online_refined_mom_21d",
        expression=refined_expression,
        name="Online Refined F2 Momentum",
    )
    snapshot_payload = _factory_payload_with_operator_snapshot(client, candidate_count=4, daily_formula_budget=8)

    response = assert_ok(client.post(
        "/factor-factory/refine-online-raw-f2",
        json={
            "gate_policy": snapshot_payload["gate_policy"],
            "factor_ids": ["s_f2_online_refined_mom_21d"],
            "candidate_limit": 10,
            "operator_config_snapshot_id": snapshot_payload["operator_config_snapshot_id"],
            "f1_catalog_snapshot_id": snapshot_payload["f1_catalog_snapshot_id"],
        },
    ))

    run = response["online_raw_f2_run"]
    mining_job_id = run["mining_job_id"]
    operator_summary = run["summary"]["operator_engine"]
    assert operator_summary["raw_f2_batch_delivered_count"] == 0
    assert operator_summary["refined_f2_batch_delivered_count"] == 0
    manifest = json.loads(Path(operator_summary["artifact_refs"]["formula_manifest"]).read_text(encoding="utf-8"))
    assert manifest["formula_count"] == 0
    assert manifest["refined_count"] == 0
    quarantine = assert_ok(client.get(f"/factor-quarantine/candidates?source_job_id={mining_job_id}"))
    assert quarantine["summary"]["total"] == 0


def test_factor_factory_publishable_recomputes_complex_f2_identity_and_skips_existing_factor() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-factory-publishable-existing"))
    service = client.app.state.service
    storage = service.storage
    source_job_id = "mine_publishable_existing"
    existing_expression = (
        'ZScore(Neutralize(Winsorize(TS_Rank(TS_Return(f1_financial_release_timing, 3), 3), '
        'method="MAD"), by="industry,market_cap"))'
    )
    _seed_online_f2_factor(
        client,
        factor_id="s_f2_mom_raw_cur_f1_financial_release_timing",
        expression=existing_expression,
        name="Published timing factor",
    )
    now = "2026-05-20T09:30:00Z"
    candidate_rows = [
        (
            "fq_existing_identity",
            existing_expression,
            "f1_financial_release_timing",
            0.061,
        ),
        (
            "fq_new_identity",
            'ZScore(Neutralize(Winsorize(Rank(s_mom_6m_rank / s_vol_downside_126d_raw), method="MAD"), by="industry,market_cap"))',
            "m_mom_longdra_126d_rank",
            0.059,
        ),
    ]
    for candidate_id, expression, source_factor_id, score in candidate_rows:
        metrics = {
            "rank_ic": 0.05,
            "ir": 0.2,
            "score": score,
            "fitness_score": score,
            "target_layer": "L2",
            "source_factor_ids": [source_factor_id],
            "raw_f2": True,
            "refined_f2": True,
            "wnzt_complete": True,
            "pipeline_version": "raw_refined_f2_v2",
            "raw_expression": expression,
            "refined_expression": expression,
        }
        storage.insert_json_row(
            "factor_quarantine_candidates",
            {
                "id": candidate_id,
                "mining_candidate_id": candidate_id.replace("fq_", "rawf2_"),
                "source_mining_job_id": source_job_id,
                "expression": expression,
                "status": "PASSED",
                "publish_status": "ELIGIBLE",
                "gate_summary_json": dumps({"redundancy_pruning": "PASSED"}),
                "cluster_id": f"cluster_{candidate_id}",
                "candidate_metrics_json": dumps(metrics),
                "failure_samples_json": dumps([]),
                "pit_evidence_json": dumps({"status": "READY"}),
                "publish_eligibility_json": dumps({"status": "ELIGIBLE"}),
                "target_factor_id": "s_f2_mom_raw_cur_px",
                "created_at": now,
                "updated_at": now,
                "published_at": None,
                "rejected_reason": None,
            },
        )

    publishable = service._factor_factory_publishable_factors(  # noqa: SLF001
        source_mining_job_id=source_job_id,
        fallback_items=[],
    )

    by_candidate = {row["candidate_id"]: row for row in publishable}
    assert "fq_existing_identity" not in by_candidate
    assert by_candidate["fq_new_identity"]["factor_id"] == "s_f2_mom_raw_cur_m_mom_longdra_126d_rank"
    assert by_candidate["fq_new_identity"]["factor_id"] != "s_f2_mom_raw_cur_px"


def test_factor_factory_publishable_skips_existing_online_display_name_without_publish_event() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-factory-publishable-existing-name"))
    service = client.app.state.service
    storage = service.storage
    source_job_id = "mine_publishable_existing_name"
    now = "2026-05-26T09:30:00Z"
    _seed_online_f2_factor(
        client,
        factor_id="s_f2_mom_raw_cur_f1_price_close",
        expression='ZScore(Neutralize(Winsorize(TS_Rank(TS_Return(f1_price_close, 3), 5), method="MAD"), by="industry,market_cap"))',
        name="平滑收益率 (当前) [Raw]",
    )
    metrics = {
        "rank_ic": 0.05,
        "ir": 0.5,
        "score": 0.061,
        "fitness_score": 0.061,
        "target_layer": "L2",
        "source_factor_ids": ["f1_dollar_volume_base"],
        "raw_f2": True,
        "refined_f2": True,
        "wnzt_complete": True,
        "pipeline_version": "raw_refined_f2_v2",
        "raw_expression": 'ZScore(Neutralize(Winsorize(TS_Rank(TS_Return(f1_dollar_volume_base, 5), 5), method="MAD"), by="industry,market_cap"))',
        "refined_expression": 'ZScore(Neutralize(Winsorize(TS_Rank(TS_Return(f1_dollar_volume_base, 5), 5), method="MAD"), by="industry,market_cap"))',
    }
    storage.insert_json_row(
        "factor_quarantine_candidates",
        {
            "id": "fq_existing_online_name",
            "mining_candidate_id": "rawf2_existing_online_name",
            "source_mining_job_id": source_job_id,
            "expression": metrics["refined_expression"],
            "status": "PASSED",
            "publish_status": "ELIGIBLE",
            "gate_summary_json": dumps({"redundancy_pruning": "PASSED"}),
            "cluster_id": "cluster_existing_online_name",
            "candidate_metrics_json": dumps(metrics),
            "failure_samples_json": dumps([]),
            "pit_evidence_json": dumps({"status": "READY"}),
            "publish_eligibility_json": dumps({"status": "ELIGIBLE"}),
            "target_factor_id": "s_f2_mom_raw_cur_f1_dollar_volume_base",
            "created_at": now,
            "updated_at": now,
            "published_at": None,
            "rejected_reason": None,
        },
    )

    publishable = service._factor_factory_publishable_factors(  # noqa: SLF001
        source_mining_job_id=source_job_id,
        fallback_items=[],
    )

    assert publishable == []


def test_factor_factory_publishable_applies_online_prune_evidence_to_semantic_duplicates(monkeypatch) -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-factory-publishable-online-prune"))
    service = client.app.state.service
    storage = service.storage
    source_job_id = "mine_publishable_online_prune"
    now = "2026-05-21T09:30:00Z"
    online_expression = (
        'ZScore(Neutralize(Winsorize(TS_Rank(TS_Return(f1_financial_release_timing, 3), 3), '
        'method="MAD"), by="industry,market_cap"))'
    )
    _seed_online_f2_factor(
        client,
        factor_id="s_f2_mom_raw_cur_px",
        expression=online_expression,
        name="平滑收益率 (当前) [Raw]",
    )

    def insert_candidate(candidate_id: str, expression: str, source_factor_id: str, score: float) -> None:
        metrics = {
            "rank_ic": 0.05,
            "ir": 0.5,
            "score": score,
            "fitness_score": score,
            "target_layer": "L2",
            "source_factor_ids": [source_factor_id],
            "raw_f2": True,
            "refined_f2": True,
            "wnzt_complete": True,
            "pipeline_version": "raw_refined_f2_v2",
            "raw_expression": expression,
            "refined_expression": expression,
        }
        storage.insert_json_row(
            "factor_quarantine_candidates",
            {
                "id": candidate_id,
                "mining_candidate_id": candidate_id.replace("fq_", "rawf2_"),
                "source_mining_job_id": source_job_id,
                "expression": expression,
                "status": "PASSED",
                "publish_status": "ELIGIBLE",
                "gate_summary_json": dumps({"redundancy_pruning": "PASSED"}),
                "cluster_id": f"cluster_{candidate_id}",
                "candidate_metrics_json": dumps(metrics),
                "failure_samples_json": dumps([]),
                "pit_evidence_json": dumps({"status": "READY"}),
                "publish_eligibility_json": dumps({"status": "ELIGIBLE"}),
                "target_factor_id": "s_f2_mom_raw_cur_px",
                "created_at": now,
                "updated_at": now,
                "published_at": None,
                "rejected_reason": None,
            },
        )

    insert_candidate(
        "fq_semantic_21d",
        'TS_Rank(ZScore(Neutralize(Winsorize(TS_Return(f1_return_21d_base, 3), method="MAD"), by="industry,market_cap")), 3)',
        "f1_return_21d_base",
        0.061,
    )
    insert_candidate(
        "fq_semantic_current",
        'ZScore(Neutralize(Winsorize(TS_Rank(TS_Return(f1_price_close, 3), 3), method="MAD"), by="industry,market_cap"))',
        "f1_price_close",
        0.060,
    )
    insert_candidate(
        "fq_threshold_survivor",
        'ZScore(Neutralize(Winsorize(Rank(s_mom_6m_rank / s_vol_downside_126d_raw), method="MAD"), by="industry,market_cap"))',
        "m_mom_longdra_126d_rank",
        0.059,
    )
    storage.insert_json_row(
        "factor_publish_events",
        {
            "id": "fpe_online_current",
            "candidate_id": "fq_semantic_current",
            "factor_id": "s_f2_mom_raw_cur_px",
            "event_type": "AUTO_PUBLISH",
            "rule_version": "factor_quarantine_v2_0",
            "before_json": dumps({}),
            "after_json": dumps({"factor_id": "s_f2_mom_raw_cur_px"}),
            "created_by": "system_rule",
            "created_at": "2026-05-20T09:08:52Z",
        },
    )

    factor_service = service._factor_research_service()  # noqa: SLF001

    def governance_overview_stub() -> dict:
        return {
            "actions": [
                {
                    "kind": "PRUNE",
                    "command": "PRUNE",
                    "factor_ids": ["s_f2_mom_ret_21d_px"],
                    "criteria": {
                        "correlation": 0.94,
                        "threshold": 0.9,
                        "evidence_source": "MEASURED_DIAGNOSTIC_IC_SERIES",
                        "sample_count": 12,
                    },
                    "offline_detail": {
                        "operator_status_light": {
                            "candidate": {"key": "NTWZ", "completed": ["N", "T", "W", "Z"]},
                            "mvp": {"key": "NTWZ", "completed": ["N", "T", "W", "Z"]},
                            "same": True,
                        },
                        "comparison": {
                            "candidate": {
                                "factor_id": "s_f2_mom_ret_21d_px",
                                "factor_name": "平滑收益率 (21d) [Refined-Rank]",
                            },
                            "mvp": {
                                "factor_id": "s_f2_mom_raw_cur_px",
                                "factor_name": "平滑收益率 (当前) [Raw]",
                            },
                        },
                    },
                },
                {
                    "kind": "PRUNE",
                    "command": "PRUNE",
                    "factor_ids": ["s_f2_mom_raw_cur_m_mom_longdra_126d_rank"],
                    "criteria": {
                        "correlation": 0.94,
                        "threshold": 0.9,
                        "evidence_source": "FACTOR_LIBRARY_HEATMAP_PROXY",
                        "sample_count": 0,
                    },
                    "offline_detail": {
                        "operator_status_light": {
                            "candidate": {"key": "NTWZ", "completed": ["N", "T", "W", "Z"]},
                            "mvp": {"key": "NTWZ", "completed": ["N", "T", "W", "Z"]},
                            "same": True,
                        },
                        "comparison": {
                            "candidate": {
                                "factor_id": "s_f2_mom_raw_cur_m_mom_longdra_126d_rank",
                                "factor_name": "风险调整回报比 (126d) [Refined-Rank]",
                            },
                        },
                    },
                },
            ],
        }

    monkeypatch.setattr(factor_service, "get_factor_governance_overview", governance_overview_stub)

    publishable = service._factor_factory_publishable_factors(  # noqa: SLF001
        source_mining_job_id=source_job_id,
        fallback_items=[],
    )

    by_candidate = {row["candidate_id"]: row for row in publishable}
    assert "fq_semantic_21d" not in by_candidate
    assert "fq_semantic_current" not in by_candidate
    assert "fq_threshold_survivor" in by_candidate

    pruning = service._apply_factor_factory_redundancy_pruning(source_mining_job_id=source_job_id)  # noqa: SLF001
    assert pruning["library_pruned"] == 2

    rows = storage.fetch_all(
        """
        SELECT id, status, publish_status, gate_summary_json
        FROM factor_quarantine_candidates
        WHERE source_mining_job_id = ?
        """,
        (source_job_id,),
    )
    by_status = {row["id"]: row for row in rows}
    assert by_status["fq_semantic_21d"]["status"] == "REJECTED"
    assert by_status["fq_semantic_21d"]["publish_status"] == "BLOCKED"
    assert json.loads(by_status["fq_semantic_21d"]["gate_summary_json"])["redundancy_pruning"] == "FAILED"
    assert by_status["fq_semantic_current"]["status"] == "REJECTED"
    assert by_status["fq_semantic_current"]["publish_status"] == "BLOCKED"
    assert by_status["fq_threshold_survivor"]["status"] == "PASSED"
    assert by_status["fq_threshold_survivor"]["publish_status"] == "ELIGIBLE"


def test_factor_factory_publishable_ignores_prune_action_with_different_operator_status_light(monkeypatch) -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-factory-publishable-status-light"))
    service = client.app.state.service
    storage = service.storage
    source_job_id = "mine_publishable_status_light"
    now = "2026-05-22T09:30:00Z"
    expression = (
        'ZScore(Neutralize(Winsorize(TS_Rank(TS_Return(f1_return_21d_base, 3), 3), '
        'method="MAD"), by="industry,market_cap"))'
    )
    metrics = {
        "rank_ic": 0.05,
        "ir": 0.5,
        "score": 0.061,
        "fitness_score": 0.061,
        "target_layer": "L2",
        "source_factor_ids": ["f1_return_21d_base"],
        "raw_f2": True,
        "refined_f2": True,
        "wnzt_complete": True,
        "pipeline_version": "raw_refined_f2_v2",
        "raw_expression": expression,
        "refined_expression": expression,
    }
    storage.insert_json_row(
        "factor_quarantine_candidates",
        {
            "id": "fq_status_light_candidate",
            "mining_candidate_id": "rawf2_status_light_candidate",
            "source_mining_job_id": source_job_id,
            "expression": expression,
            "status": "PASSED",
            "publish_status": "ELIGIBLE",
            "gate_summary_json": dumps({"redundancy_pruning": "PASSED"}),
            "cluster_id": "cluster_status_light",
            "candidate_metrics_json": dumps(metrics),
            "failure_samples_json": dumps([]),
            "pit_evidence_json": dumps({"status": "READY"}),
            "publish_eligibility_json": dumps({"status": "ELIGIBLE"}),
            "target_factor_id": None,
            "created_at": now,
            "updated_at": now,
            "published_at": None,
            "rejected_reason": None,
        },
    )

    factor_service = service._factor_research_service()  # noqa: SLF001

    def governance_overview_stub() -> dict:
        return {
            "actions": [
                {
                    "id": "gq_prune_status_light_mismatch",
                    "kind": "PRUNE",
                    "command": "PRUNE",
                    "factor_ids": ["s_f2_mom_ret_21d_px"],
                    "criteria": {
                        "correlation": 0.94,
                        "threshold": 0.9,
                        "evidence_source": "MEASURED_DIAGNOSTIC_IC_SERIES",
                        "operator_status_light": {
                            "candidate": {"key": "NTWZ", "completed": ["N", "T", "W", "Z"]},
                            "mvp": {"key": "NONE", "completed": []},
                            "same": False,
                        },
                    },
                    "offline_detail": {
                        "comparison": {
                            "candidate": {
                                "factor_id": "s_f2_mom_ret_21d_px",
                                "factor_name": "平滑收益率 (21d) [Refined-Rank]",
                            },
                            "mvp": {
                                "factor_id": "s_f2_mom_raw_cur_px",
                                "factor_name": "平滑收益率 (当前) [Raw]",
                            },
                        },
                    },
                }
            ],
        }

    monkeypatch.setattr(factor_service, "get_factor_governance_overview", governance_overview_stub)

    publishable = service._factor_factory_publishable_factors(  # noqa: SLF001
        source_mining_job_id=source_job_id,
        fallback_items=[],
    )
    assert [row["candidate_id"] for row in publishable] == ["fq_status_light_candidate"]

    pruning = service._apply_factor_factory_redundancy_pruning(source_mining_job_id=source_job_id)  # noqa: SLF001
    assert pruning["library_pruned"] == 0
    current = storage.fetch_one(
        """
        SELECT status, publish_status
        FROM factor_quarantine_candidates
        WHERE id = 'fq_status_light_candidate'
        """
    )
    assert current["status"] == "PASSED"
    assert current["publish_status"] == "ELIGIBLE"


def test_factor_factory_publishable_keeps_same_cluster_heatmap_group_without_identity_evidence() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-factory-publishable-heatmap-group"))
    service = client.app.state.service
    storage = service.storage
    source_job_id = "mine_publishable_heatmap_group"
    now = "2026-05-22T09:30:00Z"

    def insert_candidate(candidate_id: str, expression: str, source_factor_id: str, score: float) -> None:
        metrics = {
            "rank_ic": 0.05,
            "ir": score * 10,
            "score": score,
            "fitness_score": score,
            "target_layer": "L2",
            "source_factor_ids": [source_factor_id],
            "raw_f2": True,
            "refined_f2": True,
            "wnzt_complete": True,
            "pipeline_version": "raw_refined_f2_v2",
            "raw_expression": expression,
            "refined_expression": expression,
        }
        storage.insert_json_row(
            "factor_quarantine_candidates",
            {
                "id": candidate_id,
                "mining_candidate_id": candidate_id.replace("fq_", "rawf2_"),
                "source_mining_job_id": source_job_id,
                "expression": expression,
                "status": "PASSED",
                "publish_status": "ELIGIBLE",
                "gate_summary_json": dumps({"redundancy_pruning": "PASSED"}),
                "cluster_id": f"cluster_{candidate_id}",
                "candidate_metrics_json": dumps(metrics),
                "failure_samples_json": dumps([]),
                "pit_evidence_json": dumps({"status": "READY"}),
                "publish_eligibility_json": dumps({"status": "ELIGIBLE"}),
                "target_factor_id": None,
                "created_at": now,
                "updated_at": now,
                "published_at": None,
                "rejected_reason": None,
            },
        )

    insert_candidate(
        "fq_smooth_return_21d",
        'ZScore(Neutralize(Winsorize(TS_Rank(TS_Return(f1_return_21d_base, 3), 3), method="MAD"), by="industry,market_cap"))',
        "f1_return_21d_base",
        0.061,
    )
    insert_candidate(
        "fq_smooth_return_current",
        'ZScore(Neutralize(Winsorize(TS_Rank(TS_Return(f1_price_close, 3), 5), method="MAD"), by="industry,market_cap"))',
        "f1_price_close",
        0.060,
    )
    insert_candidate(
        "fq_smooth_return_1d",
        'ZScore(Neutralize(Winsorize(TS_Rank(TS_Return(f1_return_1d_base, 21), 5), method="MAD"), by="industry,market_cap"))',
        "f1_return_1d_base",
        0.059,
    )

    publishable = service._factor_factory_publishable_factors(  # noqa: SLF001
        source_mining_job_id=source_job_id,
        fallback_items=[],
    )

    assert [row["candidate_id"] for row in publishable] == [
        "fq_smooth_return_21d",
        "fq_smooth_return_current",
        "fq_smooth_return_1d",
    ]

    pruning = service._apply_factor_factory_redundancy_pruning(source_mining_job_id=source_job_id)  # noqa: SLF001
    assert pruning["kept"] == 3
    assert pruning["pruned"] == 0

    rows = storage.fetch_all(
        """
        SELECT id, status, publish_status, candidate_metrics_json, gate_summary_json
        FROM factor_quarantine_candidates
        WHERE source_mining_job_id = ?
        """,
        (source_job_id,),
    )
    by_status = {row["id"]: row for row in rows}
    assert by_status["fq_smooth_return_21d"]["status"] == "PASSED"
    assert by_status["fq_smooth_return_current"]["status"] == "PASSED"
    assert by_status["fq_smooth_return_1d"]["publish_status"] == "ELIGIBLE"
    current_gate = json.loads(by_status["fq_smooth_return_current"]["gate_summary_json"])
    assert current_gate["redundancy_pruning"] == "PASSED"
    assert "redundancy_kept_candidate_id" not in current_gate


def test_factor_factory_run_now_does_not_enable_daily_automation() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-factory-run-now"))
    seed_factor_mining_price_snapshot(client)
    payload = _factory_payload_with_operator_snapshot(client, candidate_count=6, daily_formula_budget=12)

    paused = assert_ok(client.post("/factor-factory/automation/pause"))
    assert paused["profile"]["status"] == "PAUSED"

    run_now = assert_ok(client.post("/factor-factory/run-now", json=payload))
    assert run_now["profile"]["status"] == "PAUSED"
    assert run_now["manual_run"]["trigger"] == "MANUAL"
    assert run_now["manual_run"]["summary"]["daily_automation"] is False
    assert run_now["manual_run"]["summary"]["pit_gate_mode"] == "DIAGNOSTIC_ONLY"


def test_factor_factory_run_references_immutable_f1_and_operator_snapshots() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-factory-config-snapshot"))
    seed_factor_mining_price_snapshot(client)

    config = assert_ok(client.get("/factor-factory/operator-config"))
    assert config["latest_f1_catalog_snapshot"]["snapshot_id"]
    assert [item for item in config["registry_items"] if item["enabled"]]
    assert {item["operator_id"] for item in config["registry_items"] if item["enabled"]} == {
        "TS_Return",
        "TS_Rank",
        "TS_Corr",
    }

    snapshot = assert_ok(client.post("/factor-factory/operator-config/snapshots", json={
        **config["draft"],
        "enabled_operators": ["TS_Return", "TS_Rank"],
        "window_space": [5, 21],
        "daily_formula_budget": 12,
    }))
    assert snapshot["snapshot_id"]
    assert snapshot["enabled_operators"] == ["TS_Return", "TS_Rank"]
    assert snapshot["daily_formula_budget"] == 12
    assert snapshot["compute_backend"] == "pandas_bottleneck"

    payload = _factory_payload(candidate_count=6)
    payload["operator_config_snapshot_id"] = snapshot["snapshot_id"]
    payload["f1_catalog_snapshot_id"] = config["latest_f1_catalog_snapshot"]["snapshot_id"]
    run_now = assert_ok(client.post("/factor-factory/run-now", json=payload))
    summary = run_now["manual_run"]["summary"]
    request_snapshot = run_now["manual_run"]["request"]["config_snapshot"]

    assert summary["operator_config_snapshot_id"] == snapshot["snapshot_id"]
    assert summary["f1_catalog_snapshot_id"] == config["latest_f1_catalog_snapshot"]["snapshot_id"]
    assert summary["enabled_operators"] == ["TS_Return", "TS_Rank"]
    assert summary["daily_formula_budget"] == 12
    assert summary["compute_backend"] == "pandas_bottleneck"
    assert request_snapshot["operator_config_snapshot_id"] == snapshot["snapshot_id"]
    assert request_snapshot["f1_catalog_snapshot_id"] == config["latest_f1_catalog_snapshot"]["snapshot_id"]
    assert run_now["manual_run"]["config_signature"]


def test_factor_factory_composition_snapshot_drives_enabled_f3_methods_and_signature() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-factory-composition-snapshot"))
    seed_factor_mining_price_snapshot(client)

    config = assert_ok(client.get("/factor-factory/operator-config"))
    rank_pooling_methods = [
        {**method, "enabled": method["id"] == "rank_pooling"}
        for method in config["draft"]["composition_methods"]
    ]
    rank_pooling_snapshot = assert_ok(client.post("/factor-factory/operator-config/snapshots", json={
        **config["draft"],
        "enabled_operators": ["TS_Return", "TS_Rank"],
        "window_space": [5, 21],
        "daily_formula_budget": 4,
        "composition_methods": rank_pooling_methods,
    }))
    default_snapshot = assert_ok(client.post("/factor-factory/operator-config/snapshots", json={
        **config["draft"],
        "enabled_operators": ["TS_Return", "TS_Rank"],
        "window_space": [5, 21],
        "daily_formula_budget": 4,
    }))

    payload = _factory_payload(candidate_count=4)
    service = client.app.state.service
    rank_request = service._factor_factory_request_with_composition_config(  # noqa: SLF001
        payload["request"],
        {
            "operator_config_snapshot_id": rank_pooling_snapshot["snapshot_id"],
            "f1_catalog_snapshot_id": config["latest_f1_catalog_snapshot"]["snapshot_id"],
            **rank_pooling_snapshot,
        },
    )
    default_request = service._factor_factory_request_with_composition_config(  # noqa: SLF001
        payload["request"],
        {
            "operator_config_snapshot_id": default_snapshot["snapshot_id"],
            "f1_catalog_snapshot_id": config["latest_f1_catalog_snapshot"]["snapshot_id"],
            **default_snapshot,
        },
    )

    assert rank_request["recipe_families"] == ["rank_pooling"]
    assert [method["id"] for method in rank_request["composition_policy"]["composition_methods"]] == ["rank_pooling"]
    rank_signature = service._factor_factory_config_signature(rank_request, payload["gate_policy"], rank_pooling_snapshot)  # noqa: SLF001
    default_signature = service._factor_factory_config_signature(default_request, payload["gate_policy"], default_snapshot)  # noqa: SLF001
    assert rank_signature != default_signature

    payload["operator_config_snapshot_id"] = rank_pooling_snapshot["snapshot_id"]
    payload["f1_catalog_snapshot_id"] = config["latest_f1_catalog_snapshot"]["snapshot_id"]
    run_now = assert_ok(client.post("/factor-factory/run-now", json=payload))
    mining_job_id = run_now["manual_run"]["mining_job_id"]
    overview = assert_ok(client.get("/factor-factory/overview"))
    operator_summary = overview["latest_run"]["summary"]["operator_engine"]
    assert operator_summary["f3_composition_candidate_count"] == 1
    quarantine = assert_ok(client.get(f"/factor-quarantine/candidates?source_job_id={mining_job_id}"))
    method_ids = {
        item["candidate_metrics"]["composition_metadata"]["method_id"]
        for item in quarantine["items"]
        if item["target_layer"] == "L3"
    }
    f3_expressions = [
        item["expression"]
        for item in quarantine["items"]
        if item["target_layer"] == "L3"
    ]
    placeholders = ",".join("?" for _ in f3_expressions)
    direct_writes = service.storage.fetch_one(
        f"SELECT COUNT(*) AS count FROM factor_definitions WHERE expression IN ({placeholders})",
        tuple(f3_expressions),
    )["count"]
    assert method_ids == {"rank_pooling"}
    assert direct_writes == 0


def test_factor_factory_run_excludes_data_source_blocked_f1_fields() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-factory-blocked-f1"))
    _seed_price_snapshot_with_l1_gap(client)

    config = assert_ok(client.get("/factor-factory/operator-config"))
    snapshot = assert_ok(client.post("/factor-factory/operator-config/snapshots", json={
        **config["draft"],
        "enabled_operators": ["TS_Return", "TS_Rank"],
        "window_space": [5, 21],
        "daily_formula_budget": 3,
    }))

    payload = _factory_payload(candidate_count=3)
    payload["operator_config_snapshot_id"] = snapshot["snapshot_id"]
    payload["f1_catalog_snapshot_id"] = config["latest_f1_catalog_snapshot"]["snapshot_id"]
    payload["request"]["source_factor_ids"] = ["f1_price_close", "s_mom_6m_rank"]
    run_now = assert_ok(client.post("/factor-factory/run-now", json=payload))
    request = run_now["manual_run"]["request"]

    assert "f1_price_close" not in request["source_factor_ids"]
    assert "s_mom_6m_rank" in request["source_factor_ids"]
    assert request["excluded_source_factor_ids"] == ["f1_price_close"]
    assert request["blocked_field_policy"] == "排除 DATA_SOURCE_BLOCKED 字段；缺失 L1 保持 NaN。"


def test_factor_factory_cancel_marks_factory_run_cancelled() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-factory-cancel"))
    seed_factor_mining_price_snapshot(client)
    run_now = assert_ok(client.post(
        "/factor-factory/run-now",
        json=_factory_payload_with_operator_snapshot(client, candidate_count=6, daily_formula_budget=12),
    ))

    cancelled = assert_ok(client.post(f"/factor-factory/runs/{run_now['manual_run']['id']}/cancel"))

    assert cancelled["id"] == run_now["manual_run"]["id"]
    assert cancelled["status"] == "CANCELLED"

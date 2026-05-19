from __future__ import annotations

from pathlib import Path
from uuid import uuid4

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


def test_factor_factory_overview_and_daily_start_are_idempotent() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-factory-start"))
    seed_factor_mining_price_snapshot(client)

    initial = assert_ok(client.get("/factor-factory/overview"))
    assert initial["profile"]["status"] == "PAUSED"
    assert initial["profile"]["schedule_time"] == "14:00"
    assert initial["gate_policy"]["pit_gate_mode"] == "DIAGNOSTIC_ONLY"

    started = assert_ok(client.post("/factor-factory/automation/start", json=_factory_payload()))
    assert started["profile"]["status"] == "ACTIVE"
    assert started["profile"]["timezone"] == "Asia/Hong_Kong"
    assert started["daily_run"]["trigger"] == "DAILY"
    assert started["daily_run"]["summary"]["daily_automation"] is True
    mining_job_id = started["daily_run"]["mining_job_id"]
    assert mining_job_id
    wait_for_factor_mining_job(client, mining_job_id)

    duplicate = assert_ok(client.post("/factor-factory/automation/start", json=_factory_payload()))
    assert duplicate["daily_run"]["id"] == started["daily_run"]["id"]
    assert duplicate["funnel"]["mined_candidates"] >= 1


def test_factor_factory_run_auto_intakes_and_executes_quarantine() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-factory-auto-quarantine"))
    seed_factor_mining_price_snapshot(client)

    run_now = assert_ok(client.post("/factor-factory/run-now", json=_factory_payload(candidate_count=6)))
    mining_job_id = run_now["manual_run"]["mining_job_id"]
    assert mining_job_id
    wait_for_factor_mining_job(client, mining_job_id)

    overview = assert_ok(client.get("/factor-factory/overview"))
    summary = overview["latest_run"]["summary"]
    assert overview["latest_run"]["request"]["generation_mode"] == "HYBRID_COMPOSITION"
    assert summary["generation_mode"] == "OPERATOR_ENGINE"
    assert summary["operator_engine"]["backend"] == "pandas_bottleneck"
    assert summary["operator_engine"]["deduped_formula_count"] >= 1
    assert summary["auto_quarantine_status"] == "COMPLETED"
    assert summary["auto_intake_count"] >= 1
    assert summary["auto_quarantine_count"] >= 1
    assert overview["phase2_contract"]["flow"] == "B1-B2-B3"
    assert overview["phase2_contract"]["l2_operator_chain"] == "F1 -> OperatorEngine -> Raw_F2 -> WNZT -> Refined F2"
    assert [row["kind"] for row in overview["task_rows"]] == ["mining", "refinement", "quarantine"]
    assert {row["status"] for row in overview["task_rows"]} <= {"待开始", "进行中", "已完成"}
    assert overview["task_rows"][0]["target_layer"] == "L2"
    assert "每日挖掘任务" in overview["task_rows"][0]["title"]
    assert overview["monitor_summary"]["yesterday_formula_count"] >= 1
    assert overview["scoring_candidates"] == []
    assert overview["quarantine_result_rows"]
    assert all(row["quarantine_result"] in {"PASS", "WARN", "FAIL"} for row in overview["quarantine_result_rows"])
    assert all(row["target_layer"] != "L1" for row in overview["quarantine_result_rows"] if "Return(" in row["factor_name"])

    quarantine = assert_ok(client.get(f"/factor-quarantine/candidates?source_job_id={mining_job_id}"))
    assert quarantine["items"]
    assert {item["status"] for item in quarantine["items"]}.isdisjoint({"PENDING", "RUNNING"})
    assert all(item["publish_status"] != "PUBLISHED" for item in quarantine["items"])
    assert any(item["candidate_metrics"].get("source_factor_ids") for item in quarantine["items"])


def test_factor_factory_run_now_does_not_enable_daily_automation() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-factory-run-now"))
    seed_factor_mining_price_snapshot(client)

    paused = assert_ok(client.post("/factor-factory/automation/pause"))
    assert paused["profile"]["status"] == "PAUSED"

    run_now = assert_ok(client.post("/factor-factory/run-now", json=_factory_payload(candidate_count=6)))
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

    snapshot = assert_ok(client.post("/factor-factory/operator-config/snapshots", json=config["draft"]))
    assert snapshot["snapshot_id"]
    assert snapshot["enabled_operators"] == ["TS_Return", "TS_Rank", "TS_Corr"]
    assert snapshot["daily_formula_budget"] == 10000
    assert snapshot["compute_backend"] == "pandas_bottleneck"

    payload = _factory_payload(candidate_count=6)
    payload["operator_config_snapshot_id"] = snapshot["snapshot_id"]
    payload["f1_catalog_snapshot_id"] = config["latest_f1_catalog_snapshot"]["snapshot_id"]
    run_now = assert_ok(client.post("/factor-factory/run-now", json=payload))
    summary = run_now["manual_run"]["summary"]
    request_snapshot = run_now["manual_run"]["request"]["config_snapshot"]

    assert summary["operator_config_snapshot_id"] == snapshot["snapshot_id"]
    assert summary["f1_catalog_snapshot_id"] == config["latest_f1_catalog_snapshot"]["snapshot_id"]
    assert summary["enabled_operators"] == ["TS_Return", "TS_Rank", "TS_Corr"]
    assert summary["daily_formula_budget"] == 10000
    assert summary["compute_backend"] == "pandas_bottleneck"
    assert request_snapshot["operator_config_snapshot_id"] == snapshot["snapshot_id"]
    assert request_snapshot["f1_catalog_snapshot_id"] == config["latest_f1_catalog_snapshot"]["snapshot_id"]
    assert run_now["manual_run"]["config_signature"]


def test_factor_factory_run_excludes_data_source_blocked_f1_fields() -> None:
    client, _db_path = create_test_client(_runtime_dir("factor-factory-blocked-f1"))
    _seed_price_snapshot_with_l1_gap(client)

    config = assert_ok(client.get("/factor-factory/operator-config"))
    snapshot = assert_ok(client.post("/factor-factory/operator-config/snapshots", json=config["draft"]))

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
    run_now = assert_ok(client.post("/factor-factory/run-now", json=_factory_payload(candidate_count=6)))

    cancelled = assert_ok(client.post(f"/factor-factory/runs/{run_now['manual_run']['id']}/cancel"))

    assert cancelled["id"] == run_now["manual_run"]["id"]
    assert cancelled["status"] == "CANCELLED"

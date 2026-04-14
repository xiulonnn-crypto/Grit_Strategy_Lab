from __future__ import annotations

import time
from typing import get_args

from fastapi.testclient import TestClient

from grit_backtest_platform._storage_restored import SQLiteStorage
from grit_backtest_platform.api import create_app
from grit_backtest_platform.models import OptimizationJobStatus, ResumeOptimizationJobRequest

from tests.api_test_support import FakeMarketDataProvider, assert_ok, create_momentum_strategy, create_test_client
from tests.test_optimization_execution_resume import _seed_running_job


def test_optimization_job_status_includes_interrupted() -> None:
    assert "INTERRUPTED" in get_args(OptimizationJobStatus)


def test_resume_optimization_job_route_wires_payload_and_validates_idempotency_key(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    captured: dict[str, object] = {}

    def fake_resume_optimization_job(job_id: str, payload: ResumeOptimizationJobRequest):
        captured["job_id"] = job_id
        captured["payload"] = payload
        return {
            "id": job_id,
            "status": "INTERRUPTED",
            "resume_ready": True,
            "persisted_trial_count": 2,
            "next_trial_index": 3,
            "interrupted_reason": "service_restart",
            "best_metrics_summary": {"sharpe": 1.23},
            "constraint_preset_key": "balanced",
            "constraint_label": "平衡型",
            "constraints": [
                {
                    "key": "max_drawdown_pct",
                    "label": "Max drawdown",
                    "category": "risk",
                    "operator": "<=",
                    "value": 20,
                    "unit": "%",
                }
            ],
        }

    monkeypatch.setattr(service, "resume_optimization_job", fake_resume_optimization_job, raising=False)

    response = client.post("/optimization-jobs/opt_resume_001/resume", json={"idempotency_key": "resume-001"})
    payload = assert_ok(response)

    assert payload["id"] == "opt_resume_001"
    assert payload["status"] == "INTERRUPTED"
    assert payload["resume_ready"] is True
    assert payload["persisted_trial_count"] == 2
    assert payload["next_trial_index"] == 3
    assert payload["interrupted_reason"] == "service_restart"
    assert payload["best_metrics_summary"] == {"sharpe": 1.23}
    assert payload["constraint_preset_key"] == "balanced"
    assert payload["constraint_label"] == "平衡型"
    assert payload["constraints"][0]["key"] == "max_drawdown_pct"
    assert captured["job_id"] == "opt_resume_001"
    assert isinstance(captured["payload"], ResumeOptimizationJobRequest)
    assert captured["payload"].idempotency_key == "resume-001"

    missing_key = client.post("/optimization-jobs/opt_resume_001/resume", json={})
    assert missing_key.status_code == 422

    empty_key = client.post("/optimization-jobs/opt_resume_001/resume", json={"idempotency_key": ""})
    assert empty_key.status_code == 422


def test_optimization_job_trial_storage_schema_exists(tmp_path) -> None:
    storage = SQLiteStorage(tmp_path / "optimization_resume_schema.sqlite3")

    tables = {row["name"] for row in storage.fetch_all("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert "optimization_job_trials" in tables

    columns = storage.fetch_all("PRAGMA table_info(optimization_job_trials)")
    assert [row["name"] for row in columns] == [
        "job_id",
        "trial_index",
        "status",
        "parameter_snapshot_json",
        "metrics_json",
        "chart_series_json",
        "score",
        "return_sharpe",
        "oos_sharpe",
        "total_return_pct",
        "stability",
        "error_message",
        "started_at",
        "completed_at",
    ]

    index_rows = storage.fetch_all("PRAGMA index_list(optimization_job_trials)")
    unique_index = next(row for row in index_rows if row["name"] == "idx_optimization_job_trials_job_id_trial_index")
    assert unique_index["unique"] == 1

    index_columns = storage.fetch_all("PRAGMA index_info(idx_optimization_job_trials_job_id_trial_index)")
    assert [row["name"] for row in index_columns] == ["job_id", "trial_index"]


def test_resume_route_recovers_startup_interrupted_job_with_foreign_claim(tmp_path, monkeypatch) -> None:
    seed_client, db_path = create_test_client(tmp_path)
    seed_service = seed_client.app.state.service
    seed_service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(seed_client, idempotency_key="resume-api-startup-interrupt")["strategy"]
    job_id, _ = _seed_running_job(seed_service, strategy, completed_trials=2)
    foreign_claim = seed_service._optimization_runner_claim_payload(job_id)
    foreign_claim["owner_id"] = "foreign-owner"
    seed_service._write_runtime_state(seed_service._optimization_runner_claim_key(job_id), foreign_claim)
    seed_client.close()

    monkeypatch.setenv("GRIT_OPTIMIZATION_RUNNER_MODE", "thread")
    app = create_app(
        db_path,
        market_data_provider=FakeMarketDataProvider(),
        startup_optimization_recovery_mode="interrupt",
    )

    with TestClient(app) as restarted_client:
        service = restarted_client.app.state.service
        monkeypatch.setattr(service, "_optimization_step_delay_seconds", lambda: 0.0)

        interrupted = assert_ok(restarted_client.get(f"/optimization-jobs/{job_id}/detail"))
        assert interrupted["status"] == "INTERRUPTED"
        assert interrupted["resume_ready"] is True
        assert interrupted["persisted_trial_count"] == 2
        assert interrupted["next_trial_index"] == 3

        resumed = assert_ok(
            restarted_client.post(
                f"/optimization-jobs/{job_id}/resume",
                json={"idempotency_key": "resume-api-startup-interrupt"},
            )
        )
        assert resumed["status"] in {"QUEUED", "RUNNING"}

        deadline = time.monotonic() + 3.0
        final = resumed
        while time.monotonic() < deadline:
            final = assert_ok(restarted_client.get(f"/optimization-jobs/{job_id}/detail"))
            if final["status"] == "COMPLETED":
                break
            time.sleep(0.05)

        assert final["status"] == "COMPLETED", final
        assert final["resume_ready"] is False
        assert final["persisted_trial_count"] == 4
        assert final["summary"]["completed_combinations"] == 4
        assert final["summary"]["persisted_trial_count"] == 4
        assert final["summary"]["next_trial_index"] == 5

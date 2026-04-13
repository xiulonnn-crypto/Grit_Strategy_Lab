from __future__ import annotations

from typing import get_args

from grit_backtest_platform._storage_restored import SQLiteStorage
from grit_backtest_platform.models import OptimizationJobStatus, ResumeOptimizationJobRequest

from tests.api_test_support import assert_ok, create_test_client


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
        "error_message",
        "started_at",
        "completed_at",
    ]

    index_rows = storage.fetch_all("PRAGMA index_list(optimization_job_trials)")
    unique_index = next(row for row in index_rows if row["name"] == "idx_optimization_job_trials_job_id_trial_index")
    assert unique_index["unique"] == 1

    index_columns = storage.fetch_all("PRAGMA index_info(idx_optimization_job_trials_job_id_trial_index)")
    assert [row["name"] for row in index_columns] == ["job_id", "trial_index"]

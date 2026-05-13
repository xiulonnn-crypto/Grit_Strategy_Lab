from __future__ import annotations

from dataclasses import asdict
import threading
import time
from typing import Any, get_args

from fastapi.testclient import TestClient

from grit_backtest_platform._storage_restored import SQLiteStorage
from grit_backtest_platform.api import create_app
from grit_backtest_platform.backtest_engine import run_backtest_prepared
from grit_backtest_platform.models import BacktestRunStatus, ResumeBacktestRunRequest
from grit_backtest_platform.real_service import RealBacktestPlatformService

from tests.api_test_support import FakeMarketDataProvider, assert_ok, create_momentum_strategy, create_test_client, refresh_snapshots


START_DATE = "2024-03-01"
END_DATE = "2025-03-31"


def _wait_for_terminal_backtest(service: RealBacktestPlatformService, run_id: str, timeout_seconds: float = 5.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    latest = service.get_backtest_run_detail(run_id)
    while time.monotonic() < deadline and str(latest.get("status") or "").upper() in {"QUEUED", "RUNNING"}:
        time.sleep(0.02)
        latest = service.get_backtest_run_detail(run_id)
    return latest


def _build_checkpoint_snapshot(
    service: RealBacktestPlatformService,
    strategy: dict[str, Any],
    *,
    completed_steps: int = 2,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], Any]:
    request_payload = service._normalize_run_request(
        strategy,
        {
            "idempotency_key": f"checkpoint-seed-{completed_steps}",
            "start_date": START_DATE,
            "end_date": END_DATE,
            "parameter_version_id": strategy["current_parameter_version_id"],
        },
    )
    prepared_context = service._prepare_backtest_run_context(strategy, request_payload)
    checkpoints: list[dict[str, Any]] = []
    full_result = run_backtest_prepared(
        prepared_context["prepared_inputs"],
        config=prepared_context["config"],
        parameters=service._engine_parameters(strategy),
        checkpoint_callback=lambda state, daily_points, trades: checkpoints.append(
            {
                "state": dict(state),
                "daily_performance": [asdict(item) for item in daily_points],
                "trades": [asdict(item) for item in trades],
            }
        ),
        checkpoint_interval_steps=1,
    )
    assert len(checkpoints) >= completed_steps
    return request_payload, prepared_context, checkpoints[completed_steps - 1], full_result


def _seed_interrupted_run(
    service: RealBacktestPlatformService,
    strategy: dict[str, Any],
    *,
    run_id: str,
    status: str = "INTERRUPTED",
    completed_steps: int = 2,
) -> tuple[dict[str, Any], Any]:
    request_payload, _prepared_context, checkpoint_snapshot, full_result = _build_checkpoint_snapshot(
        service,
        strategy,
        completed_steps=completed_steps,
    )
    checkpoint_state = dict(checkpoint_snapshot["state"])
    seeded_request_payload = service._build_backtest_progress_request_payload(
        request_payload,
        status=status,
        checkpoint_state=checkpoint_state,
        resume_ready=status == "INTERRUPTED",
        interrupted_reason="service_restart" if status == "INTERRUPTED" else None,
    )
    recovery_context = service._build_backtest_checkpoint_recovery_context(
        "RUNNING",
        {"state": checkpoint_state},
        previous_updated_at="2026-05-13T10:00:00Z",
        restarted_at="2026-05-13T10:05:00Z",
    )
    preview = service._apply_backtest_checkpoint_state_to_preview(
        service._build_pending_backtest_preview(
            strategy,
            seeded_request_payload,
            recovery_context=recovery_context if status == "INTERRUPTED" else None,
        ),
        checkpoint_state,
    )
    service.storage.insert_json_row(
        "backtest_runs",
        service._build_backtest_run_row(
            run_id=run_id,
            strategy_id=strategy["id"],
            status=status,
            request_payload=seeded_request_payload,
            created_at="2026-05-13T09:55:00Z",
            updated_at="2026-05-13T10:05:00Z",
            preview=preview,
            parameter_snapshot=preview.get("parameter_snapshot") or {},
            environment_summary=preview.get("environment_summary") or {},
        ),
    )
    service._persist_backtest_checkpoint(
        run_id,
        stage="SIMULATING",
        state=checkpoint_state,
        daily_performance=checkpoint_snapshot["daily_performance"],
        trades=checkpoint_snapshot["trades"],
    )
    return request_payload, full_result


def test_backtest_run_status_includes_interrupted() -> None:
    assert "INTERRUPTED" in get_args(BacktestRunStatus)


def test_resume_backtest_run_route_wires_payload_and_validates_idempotency_key(tmp_path, monkeypatch) -> None:
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    captured: dict[str, object] = {}

    def fake_resume_backtest_run(run_id: str, payload: ResumeBacktestRunRequest):
        captured["run_id"] = run_id
        captured["payload"] = payload
        return {
            "id": run_id,
            "status": "INTERRUPTED",
            "resume_ready": True,
            "persisted_step_count": 2,
            "total_step_count": 4,
            "next_step_index": 3,
            "interrupted_reason": "service_restart",
        }

    monkeypatch.setattr(service, "resume_backtest_run", fake_resume_backtest_run, raising=False)

    response = client.post("/backtest-runs/run_resume_001/resume", json={"idempotency_key": "resume-001"})
    payload = assert_ok(response)

    assert payload["id"] == "run_resume_001"
    assert payload["status"] == "INTERRUPTED"
    assert payload["resume_ready"] is True
    assert payload["persisted_step_count"] == 2
    assert payload["total_step_count"] == 4
    assert payload["next_step_index"] == 3
    assert payload["interrupted_reason"] == "service_restart"
    assert captured["run_id"] == "run_resume_001"
    assert isinstance(captured["payload"], ResumeBacktestRunRequest)
    assert captured["payload"].idempotency_key == "resume-001"

    assert client.post("/backtest-runs/run_resume_001/resume", json={}).status_code == 422
    assert client.post("/backtest-runs/run_resume_001/resume", json={"idempotency_key": ""}).status_code == 422


def test_backtest_checkpoint_storage_schema_exists(tmp_path) -> None:
    storage = SQLiteStorage(tmp_path / "backtest_resume_schema.sqlite3")
    tables = {row["name"] for row in storage.fetch_all("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert "backtest_run_checkpoints" in tables
    assert "backtest_run_checkpoint_chunks" in tables

    checkpoint_columns = storage.fetch_all("PRAGMA table_info(backtest_run_checkpoints)")
    assert [row["name"] for row in checkpoint_columns] == [
        "run_id",
        "stage",
        "state_json",
        "created_at",
        "updated_at",
    ]

    chunk_columns = storage.fetch_all("PRAGMA table_info(backtest_run_checkpoint_chunks)")
    assert [row["name"] for row in chunk_columns] == [
        "run_id",
        "chunk_index",
        "daily_performance_json",
        "trades_json",
        "created_at",
    ]


def test_run_backtest_prepared_resumes_from_checkpoint_and_matches_full_result(tmp_path) -> None:
    client, _ = create_test_client(tmp_path)
    strategy = create_momentum_strategy(
        client,
        idempotency_key="backtest-resume-engine",
        universe_name="SPY",
        rebalance_frequency="monthly",
        top_n=1,
    )["strategy"]
    refresh_snapshots(client)
    service = client.app.state.service

    request_payload, prepared_context, checkpoint_snapshot, full_result = _build_checkpoint_snapshot(service, strategy, completed_steps=2)

    resumed_result = run_backtest_prepared(
        prepared_context["prepared_inputs"],
        config=prepared_context["config"],
        parameters=service._engine_parameters(strategy),
        resume_state=checkpoint_snapshot["state"],
        resume_daily_performance=checkpoint_snapshot["daily_performance"],
        resume_trades=checkpoint_snapshot["trades"],
        checkpoint_interval_steps=1,
    )

    assert len(checkpoint_snapshot["daily_performance"]) == 2
    assert len(resumed_result.daily_performance) == len(full_result.daily_performance)
    assert [point.date for point in resumed_result.daily_performance[:2]] == [
        item["date"] for item in checkpoint_snapshot["daily_performance"]
    ]
    assert [asdict(item) for item in resumed_result.trades] == [asdict(item) for item in full_result.trades]
    assert resumed_result.metrics == full_result.metrics
    assert request_payload["parameter_version_id"] == strategy["current_parameter_version_id"]


def test_api_startup_interrupt_mode_marks_running_backtest_runs_as_interrupted(tmp_path) -> None:
    seed_client, db_path = create_test_client(tmp_path)
    strategy = create_momentum_strategy(
        seed_client,
        idempotency_key="backtest-startup-interrupt",
        universe_name="SPY",
        rebalance_frequency="monthly",
        top_n=1,
    )["strategy"]
    refresh_snapshots(seed_client)
    seed_service = seed_client.app.state.service
    _seed_interrupted_run(seed_service, strategy, run_id="run_startup_interrupt", status="RUNNING")
    seed_client.close()

    app = create_app(
        db_path,
        market_data_provider=FakeMarketDataProvider(),
        startup_backtest_recovery_mode="interrupt",
    )
    with TestClient(app) as restarted_client:
        detail = assert_ok(restarted_client.get("/backtest-runs/run_startup_interrupt/detail"))

    assert detail["status"] == "INTERRUPTED"
    assert detail["resume_ready"] is True
    assert detail["interrupted_reason"] == "service_restart"
    assert detail["persisted_step_count"] == 2
    assert detail["total_step_count"] > 0
    assert detail["preview"]["environment_summary"]["execution_progress"]["persisted_step_count"] == 2


def test_resume_backtest_run_completes_from_checkpoint_without_restart_warning(tmp_path) -> None:
    client, _ = create_test_client(tmp_path)
    strategy = create_momentum_strategy(
        client,
        idempotency_key="backtest-resume-complete",
        universe_name="SPY",
        rebalance_frequency="monthly",
        top_n=1,
    )["strategy"]
    refresh_snapshots(client)
    service = client.app.state.service
    _seed_interrupted_run(service, strategy, run_id="run_resume_complete", status="INTERRUPTED")

    resumed = service.resume_backtest_run("run_resume_complete", {"idempotency_key": "resume-complete-001"})
    final = _wait_for_terminal_backtest(service, "run_resume_complete")

    assert resumed["status"] in {"QUEUED", "RUNNING"}
    assert final["status"] in {"COMPLETED", "COMPLETED_WITH_WARNINGS"}
    assert final["resume_ready"] is False
    assert final["interrupted_reason"] is None
    assert service._load_backtest_checkpoint_bundle("run_resume_complete") is None
    assert all("restarted from the beginning" not in warning for warning in final.get("warnings") or [])


def test_resume_incomplete_backtest_runs_does_not_start_duplicate_runners_across_services(tmp_path, monkeypatch) -> None:
    seed_client, db_path = create_test_client(tmp_path)
    strategy = create_momentum_strategy(
        seed_client,
        idempotency_key="backtest-cross-service-claim",
        universe_name="SPY",
        rebalance_frequency="monthly",
        top_n=1,
    )["strategy"]
    refresh_snapshots(seed_client)
    seed_service = seed_client.app.state.service
    request_payload = seed_service._normalize_run_request(
        strategy,
        {
            "idempotency_key": "backtest-cross-service-run",
            "start_date": START_DATE,
            "end_date": END_DATE,
            "parameter_version_id": strategy["current_parameter_version_id"],
        },
    )
    preview = seed_service._build_pending_backtest_preview(strategy, request_payload)
    seed_service.storage.insert_json_row(
        "backtest_runs",
        seed_service._build_backtest_run_row(
            run_id="run_cross_service_claim",
            strategy_id=strategy["id"],
            status="RUNNING",
            request_payload=request_payload,
            created_at="2026-05-13T09:00:00Z",
            updated_at="2026-05-13T09:30:00Z",
            preview=preview,
            parameter_snapshot=preview.get("parameter_snapshot") or {},
            environment_summary=preview.get("environment_summary") or {},
        ),
    )
    seed_client.close()

    service_a = RealBacktestPlatformService(db_path, market_data_provider=FakeMarketDataProvider())
    service_b = RealBacktestPlatformService(db_path, market_data_provider=FakeMarketDataProvider())
    started = threading.Event()
    release = threading.Event()
    executed_by: list[str] = []

    def make_fake_runner(label: str):
        def fake_runner(**kwargs) -> None:
            executed_by.append(label)
            started.set()
            release.wait(timeout=1.0)

        return fake_runner

    monkeypatch.setattr(service_a, "_run_backtest_submission", make_fake_runner("service_a"))
    monkeypatch.setattr(service_b, "_run_backtest_submission", make_fake_runner("service_b"))

    resumed_a = service_a.resume_incomplete_backtest_runs()
    assert started.wait(1.0)
    resumed_b = service_b.resume_incomplete_backtest_runs()

    assert resumed_a == ["run_cross_service_claim"]
    assert resumed_b == []
    assert executed_by == ["service_a"]

    release.set()
    deadline = time.monotonic() + 1.0
    while time.monotonic() < deadline and "run_cross_service_claim" in service_a._backtest_run_threads:
        time.sleep(0.01)

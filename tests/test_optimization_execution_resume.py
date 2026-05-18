from __future__ import annotations

import json
import sys
import threading
import time
from typing import Any

import pytest
from fastapi.testclient import TestClient

from grit_backtest_platform.api import create_app
from grit_backtest_platform.service import BacktestPlatformService, ContractConflictError

from tests.api_test_support import (
    FakeMarketDataProvider,
    create_momentum_strategy,
    create_optimization_job,
    create_test_client,
    submit_backtest,
)


SEARCH_SPACE = [
    {"key": "lookback_months", "label": "回看(月)", "mode": "range", "start": 5, "end": 6, "step": 1, "current": 6},
    {"key": "top_n", "label": "买入排名阈值", "mode": "range", "start": 3, "end": 4, "step": 1, "current": 4},
]

WIDE_SEARCH_SPACE = [
    {"key": "lookback_months", "label": "回看(月)", "mode": "range", "start": 4, "end": 6, "step": 1, "current": 6},
    {"key": "top_n", "label": "买入排名阈值", "mode": "range", "start": 3, "end": 4, "step": 1, "current": 4},
]

PARALLEL_SEARCH_SPACE = [
    {"key": "lookback_months", "label": "Lookback", "mode": "range", "start": 4, "end": 6, "step": 1, "current": 6},
    {"key": "top_n", "label": "Top N", "mode": "range", "start": 3, "end": 5, "step": 1, "current": 5},
]


def _sample_trial_result(parameter_snapshot: dict[str, Any], *, score: float) -> dict[str, Any]:
    lookback = float(parameter_snapshot.get("lookback_months") or 0)
    top_n = float(parameter_snapshot.get("top_n") or 0)
    sharpe = round(0.9 + score / 10.0, 2)
    return {
        "parameter_snapshot": dict(parameter_snapshot),
        "metrics": {
            "total_return": 0.12 + lookback / 100.0,
            "cagr": 0.1,
            "annualized_return": 0.1,
            "annualized_volatility": 0.05,
            "sharpe": sharpe,
            "max_drawdown": -0.08,
            "turnover": 0.0,
            "win_rate": 0.6,
            "oos_cagr": 0.09,
            "oos_sharpe": sharpe - 0.1,
            "total_return_pct": 12.0 + lookback,
            "return_sharpe": sharpe,
            "out_of_sample_sharpe": sharpe - 0.1,
            "max_drawdown_pct": -8.0,
            "stability": 70.0 + top_n,
        },
        "chart_series": [
            {
                "trade_date": "2026-01-01",
                "equity": 100.0 + score,
                "benchmark": 100.0,
                "drawdown": 0.0,
                "is_oos": False,
                "strategy_return": 0.0,
                "benchmark_return": 0.0,
            }
        ],
        "score": score,
    }


def _wide_snapshot_score(parameter_snapshot: dict[str, Any]) -> float:
    lookback = float(parameter_snapshot.get("lookback_months") or 0.0)
    top_n = float(parameter_snapshot.get("top_n") or 0.0)
    return round(lookback * 10.0 + top_n, 3)


def _seed_running_job(
    service,
    strategy: dict[str, Any],
    *,
    completed_trials: int = 2,
    constraint_preset_key: str | None = None,
    constraint_label: str | None = None,
    constraints: list[dict[str, Any]] | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    created_at = "2026-04-13T10:00:00Z"
    job_id = f"opt_seed_{completed_trials}"
    payload = {
        "objective": "sharpe",
        "base_parameter_version_id": strategy["current_parameter_version_id"],
        "entry_point": "lab_menu",
        "validation_mode": "walk_forward",
        "budget_combinations": 4,
        "search_space": SEARCH_SPACE,
        "status": "RUNNING",
        "progress_pct": 50,
        "completed_combinations": completed_trials,
        "current_stage": f"Running trial {completed_trials}/4",
        "latest_update": f"Completed {completed_trials}/4 trials.",
    }
    if constraint_preset_key is not None:
        payload["constraint_preset_key"] = constraint_preset_key
    if constraint_label is not None:
        payload["constraint_label"] = constraint_label
    if constraints is not None:
        payload["constraints"] = constraints
    service._persist_optimization_job(
        job_id,
        strategy["id"],
        payload,
        [],
        created_at=created_at,
        updated_at=created_at,
        completed_at=None,
    )
    planned = service._plan_optimization_search_snapshots(
        dict(strategy.get("parameters") or {}),
        SEARCH_SPACE,
        4,
    )
    for trial_index, snapshot in enumerate(planned[:completed_trials], start=1):
        sample = _sample_trial_result(snapshot, score=1.0 + trial_index / 10.0)
        service._persist_optimization_trial(
            job_id,
            trial_index,
            status="SUCCEEDED",
            parameter_snapshot=sample["parameter_snapshot"],
            metrics=sample["metrics"],
            chart_series=sample["chart_series"],
            score=sample["score"],
            error_message=None,
            started_at=created_at,
            completed_at=created_at,
        )
    return job_id, planned


def _seed_interrupted_job(
    service,
    strategy: dict[str, Any],
    *,
    completed_trials: int = 2,
    constraint_preset_key: str | None = None,
    constraint_label: str | None = None,
    constraints: list[dict[str, Any]] | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    job_id, planned = _seed_running_job(
        service,
        strategy,
        completed_trials=completed_trials,
        constraint_preset_key=constraint_preset_key,
        constraint_label=constraint_label,
        constraints=constraints,
    )
    budget_combinations = 4
    payload = {
        "objective": "sharpe",
        "base_parameter_version_id": strategy["current_parameter_version_id"],
        "entry_point": "lab_menu",
        "validation_mode": "walk_forward",
        "budget_combinations": budget_combinations,
        "search_space": SEARCH_SPACE,
        "status": "INTERRUPTED",
        "progress_pct": round(completed_trials / budget_combinations * 100),
        "completed_combinations": completed_trials,
        "persisted_trial_count": completed_trials,
        "next_trial_index": completed_trials + 1,
        "resume_ready": True,
        "interrupted_reason": "service_restart",
        "current_stage": f"Interrupted at {completed_trials}/{budget_combinations}",
        "latest_update": f"Progress preserved at {completed_trials}/{budget_combinations}. Click Continue Optimization to resume.",
    }
    if constraint_preset_key is not None:
        payload["constraint_preset_key"] = constraint_preset_key
    if constraint_label is not None:
        payload["constraint_label"] = constraint_label
    if constraints is not None:
        payload["constraints"] = constraints
    service._persist_optimization_job(
        job_id,
        strategy["id"],
        payload,
        [],
        created_at="2026-04-13T10:00:00Z",
        updated_at="2026-04-13T10:00:00Z",
        completed_at=None,
    )
    return job_id, planned


def _wait_for_terminal_job(service, job_id: str, *, timeout_seconds: float = 3.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    latest = service.get_optimization_job_detail(job_id)
    while time.monotonic() < deadline and str(latest.get("status") or "").upper() in {"QUEUED", "RUNNING"}:
        time.sleep(0.02)
        latest = service.get_optimization_job_detail(job_id)
    return latest


def test_resume_incomplete_optimization_jobs_resumes_running_jobs_after_restart(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-interrupted")["strategy"]

    job_id, planned = _seed_running_job(service, strategy, completed_trials=2)
    executed_snapshots: list[dict[str, Any]] = []

    def fake_trial(
        strategy_detail: dict[str, Any],
        evaluation_request: dict[str, Any],
        payload: dict[str, Any],
        parameter_snapshot: dict[str, Any],
        *,
        prepared_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        executed_snapshots.append(dict(parameter_snapshot))
        return _sample_trial_result(parameter_snapshot, score=1.8 + len(executed_snapshots) / 10.0)

    monkeypatch.setattr(service, "_evaluate_optimization_trial", fake_trial)
    monkeypatch.setattr(service, "_optimization_step_delay_seconds", lambda: 0.0)

    resumed = service.resume_incomplete_optimization_jobs()
    job = _wait_for_terminal_job(service, job_id)

    assert resumed == [job_id]
    assert job["status"] == "COMPLETED"
    assert job["summary"]["completed_combinations"] == 4
    assert job["summary"]["persisted_trial_count"] == 4
    assert job["summary"]["next_trial_index"] == 5
    assert job["summary"]["resume_ready"] is False
    assert job["summary"].get("interrupted_reason") is None
    assert job["summary"]["best_metrics_summary"]["parameter_snapshot"]["lookback_months"] in {5, 6}
    assert executed_snapshots == planned[2:]


def test_resumed_optimization_job_heartbeats_during_long_inflight_trial(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-inflight-heartbeat")["strategy"]

    job_id, planned = _seed_running_job(service, strategy, completed_trials=2)
    second_trial_started = threading.Event()
    release_second_trial = threading.Event()
    call_count = 0

    def fake_trial(
        strategy_detail: dict[str, Any],
        evaluation_request: dict[str, Any],
        payload: dict[str, Any],
        parameter_snapshot: dict[str, Any],
        *,
        prepared_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        nonlocal call_count
        call_count += 1
        if call_count == 2:
            second_trial_started.set()
            release_second_trial.wait(timeout=1.0)
        return _sample_trial_result(parameter_snapshot, score=1.8 + call_count / 10.0)

    monkeypatch.setattr(service, "_evaluate_optimization_trial", fake_trial)
    monkeypatch.setattr(service, "_optimization_step_delay_seconds", lambda: 0.0)
    monkeypatch.setattr(service, "_optimization_runner_heartbeat_seconds", lambda: 0.02)

    resumed = service.resume_incomplete_optimization_jobs()
    assert resumed == [job_id]
    assert second_trial_started.wait(1.0)

    inflight = service.get_optimization_job_detail(job_id)
    first_heartbeat = str(inflight["summary"].get("heartbeat_at") or "")
    assert inflight["status"] == "RUNNING"
    assert inflight["summary"]["completed_combinations"] == 3
    assert inflight["summary"]["next_trial_index"] == 4
    assert inflight["summary"]["current_stage"] == "Running trial 4/4"

    deadline = time.monotonic() + 1.0
    refreshed = inflight
    while time.monotonic() < deadline:
        time.sleep(0.03)
        refreshed = service.get_optimization_job_detail(job_id)
        if (
            str(refreshed["summary"].get("heartbeat_at") or "") != first_heartbeat
            and refreshed["summary"]["latest_update"] == "Evaluating trial 4/4."
        ):
            break

    assert refreshed["summary"]["completed_combinations"] == 3
    assert refreshed["summary"]["latest_update"] == "Evaluating trial 4/4."
    assert str(refreshed["summary"].get("heartbeat_at") or "") != first_heartbeat

    release_second_trial.set()
    job = _wait_for_terminal_job(service, job_id)
    assert job["status"] == "COMPLETED"
    assert job["summary"]["completed_combinations"] == 4
    assert call_count == 2
    assert planned[2:]


def test_resume_incomplete_optimization_jobs_preserves_constraint_contract_fields(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-constraints")["strategy"]
    constraints = [
        {
            "key": "max_drawdown_pct",
            "label": "Max drawdown",
            "category": "risk",
            "operator": "<=",
            "value": 18,
            "unit": "%",
        },
        {
            "key": "return_sharpe",
            "label": "Return Sharpe",
            "category": "performance",
            "operator": ">=",
            "value": 1.1,
            "unit": "score",
        },
    ]

    job_id, planned = _seed_running_job(
        service,
        strategy,
        completed_trials=2,
        constraint_preset_key="defensive",
        constraint_label="Defensive guardrails",
        constraints=constraints,
    )
    executed_snapshots: list[dict[str, Any]] = []

    def fake_trial(
        strategy_detail: dict[str, Any],
        evaluation_request: dict[str, Any],
        payload: dict[str, Any],
        parameter_snapshot: dict[str, Any],
        *,
        prepared_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        executed_snapshots.append(dict(parameter_snapshot))
        return _sample_trial_result(parameter_snapshot, score=1.8 + len(executed_snapshots) / 10.0)

    monkeypatch.setattr(service, "_evaluate_optimization_trial", fake_trial)
    monkeypatch.setattr(service, "_optimization_step_delay_seconds", lambda: 0.0)

    resumed = service.resume_incomplete_optimization_jobs()
    job = _wait_for_terminal_job(service, job_id)

    assert resumed == [job_id]
    assert job["status"] == "COMPLETED"
    assert job["constraint_preset_key"] == "defensive"
    assert job["constraint_label"] == "Defensive guardrails"
    assert job["constraints"] == constraints
    assert job["request"]["constraint_preset_key"] == "defensive"
    assert job["summary"]["constraint_preset_key"] == "defensive"
    assert job["summary"]["constraints"] == constraints
    assert job["result"]["constraint_preset_key"] == "defensive"
    assert job["result"]["constraints"] == constraints
    assert executed_snapshots == planned[2:]


def test_resume_incomplete_optimization_jobs_does_not_start_duplicate_runners_across_services(tmp_path, monkeypatch):
    seed_client, db_path = create_test_client(tmp_path)
    seed_service = seed_client.app.state.service
    seed_service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(seed_client, idempotency_key="opt-exec-cross-service")["strategy"]
    job_id, _ = _seed_running_job(seed_service, strategy, completed_trials=1)
    seed_client.close()

    service_a = BacktestPlatformService(db_path)
    service_b = BacktestPlatformService(db_path)
    started = threading.Event()
    release = threading.Event()
    executed_by: list[str] = []

    def make_fake_runner(label: str):
        def fake_runner(*args, **kwargs) -> None:
            executed_by.append(label)
            started.set()
            release.wait(timeout=1.0)

        return fake_runner

    monkeypatch.setattr(service_a, "_run_real_optimization_job", make_fake_runner("service_a"))
    monkeypatch.setattr(service_b, "_run_real_optimization_job", make_fake_runner("service_b"))

    resumed_a = service_a.resume_incomplete_optimization_jobs()
    assert started.wait(1.0)

    resumed_b = service_b.resume_incomplete_optimization_jobs()

    assert resumed_a == [job_id]
    assert resumed_b == []
    assert executed_by == ["service_a"]

    release.set()
    deadline = time.monotonic() + 1.0
    while time.monotonic() < deadline and job_id in service_a._optimization_runner_job_ids:
        time.sleep(0.01)

    assert job_id not in service_a._optimization_runner_job_ids


def test_resume_incomplete_optimization_jobs_reclaims_claim_from_dead_process(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-dead-claim")["strategy"]
    job_id, _ = _seed_running_job(service, strategy, completed_trials=1)

    service._write_runtime_state(
        service._optimization_runner_claim_key(job_id),
        {
            "job_id": job_id,
            "owner_id": "stale-owner",
            "pid": 99999999,
            "heartbeat_at": service._optimization_timestamp_now(),
        },
    )

    started = threading.Event()
    release = threading.Event()

    def fake_runner(*args, **kwargs) -> None:
        started.set()
        release.wait(timeout=1.0)

    monkeypatch.setattr(service, "_run_real_optimization_job", fake_runner)

    resumed = service.resume_incomplete_optimization_jobs()

    assert resumed == [job_id]
    assert started.wait(1.0)

    release.set()
    deadline = time.monotonic() + 1.0
    while time.monotonic() < deadline and job_id in service._optimization_runner_job_ids:
        time.sleep(0.01)

    assert job_id not in service._optimization_runner_job_ids


def test_interrupt_incomplete_optimization_jobs_preserves_progress_for_manual_resume(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-startup-interrupt")["strategy"]

    job_id, _ = _seed_running_job(service, strategy, completed_trials=2)

    interrupted = service.interrupt_incomplete_optimization_jobs()
    job = service.get_optimization_job_detail(job_id)

    assert interrupted == [job_id]
    assert job["status"] == "INTERRUPTED"
    assert job["summary"]["progress_pct"] == 50
    assert job["summary"]["completed_combinations"] == 2
    assert job["summary"]["persisted_trial_count"] == 2
    assert job["summary"]["next_trial_index"] == 3
    assert job["summary"]["resume_ready"] is True
    assert job["summary"]["interrupted_reason"] == "service_restart"
    assert job["summary"]["latest_update"] == "Progress preserved at 2/4. Click Continue Optimization to resume."
    assert job["resume_ready"] is True
    assert job["interrupted_reason"] == "service_restart"


def test_interrupt_clears_foreign_runner_claim_so_manual_resume_can_restart(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-clear-claim")["strategy"]

    job_id, _ = _seed_running_job(service, strategy, completed_trials=2)
    foreign_claim = service._optimization_runner_claim_payload(job_id)
    foreign_claim["owner_id"] = "foreign-owner"
    service._write_runtime_state(service._optimization_runner_claim_key(job_id), foreign_claim)

    runner_started = threading.Event()

    def fake_runner(*args, **kwargs) -> None:
        runner_started.set()

    monkeypatch.setattr(service, "_run_real_optimization_job", fake_runner)

    interrupted = service.interrupt_incomplete_optimization_jobs()
    resumed = service.resume_optimization_job(job_id, {"idempotency_key": "resume-after-interrupt"})

    assert interrupted == [job_id]
    assert resumed["status"] in {"QUEUED", "RUNNING"}
    assert runner_started.wait(1.0)


def test_api_startup_interrupt_mode_marks_running_optimization_jobs_as_interrupted(tmp_path):
    seed_client, db_path = create_test_client(tmp_path)
    seed_service = seed_client.app.state.service
    seed_service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(seed_client, idempotency_key="opt-exec-startup-mode")["strategy"]
    job_id, _ = _seed_running_job(seed_service, strategy, completed_trials=2)
    seed_client.close()

    app = create_app(
        db_path,
        market_data_provider=FakeMarketDataProvider(),
        startup_optimization_recovery_mode="interrupt",
    )
    with TestClient(app) as restarted_client:
        job = restarted_client.app.state.service.get_optimization_job_detail(job_id)

    assert job["status"] == "INTERRUPTED"
    assert job["summary"]["completed_combinations"] == 2
    assert job["summary"]["persisted_trial_count"] == 2
    assert job["summary"]["next_trial_index"] == 3
    assert job["summary"]["resume_ready"] is True
    assert job["summary"]["interrupted_reason"] == "service_restart"


def test_resume_continues_from_next_trial_without_rerunning_completed_trials(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-resume")["strategy"]
    job_id, planned = _seed_interrupted_job(service, strategy, completed_trials=2)

    executed_snapshots: list[dict[str, Any]] = []

    def fake_trial(
        strategy_detail: dict[str, Any],
        evaluation_request: dict[str, Any],
        payload: dict[str, Any],
        parameter_snapshot: dict[str, Any],
        *,
        prepared_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        executed_snapshots.append(dict(parameter_snapshot))
        return _sample_trial_result(parameter_snapshot, score=1.8 + len(executed_snapshots) / 10.0)

    monkeypatch.setattr(service, "_evaluate_optimization_trial", fake_trial)
    monkeypatch.setattr(service, "_optimization_step_delay_seconds", lambda: 0.0)

    resumed = service.resume_optimization_job(job_id, {"idempotency_key": "resume-once"})
    completed = _wait_for_terminal_job(service, job_id)

    assert resumed["status"] in {"QUEUED", "RUNNING"}
    assert executed_snapshots == planned[2:]
    assert completed["status"] == "COMPLETED"
    assert completed["summary"]["completed_combinations"] == 4
    assert completed["summary"]["persisted_trial_count"] == 4
    assert completed["summary"]["next_trial_index"] == 5
    assert len(service._load_optimization_trials(job_id)) == 4


def test_resume_optimization_job_returns_running_projection_from_persisted_trials(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-resume-projection")["strategy"]
    job_id, planned = _seed_interrupted_job(service, strategy, completed_trials=2)
    sample = _sample_trial_result(planned[2], score=1.5)
    service._persist_optimization_trial(
        job_id,
        3,
        status="SUCCEEDED",
        parameter_snapshot=sample["parameter_snapshot"],
        metrics=sample["metrics"],
        chart_series=sample["chart_series"],
        score=sample["score"],
        error_message=None,
        started_at="2026-04-13T10:03:00Z",
        completed_at="2026-04-13T10:03:00Z",
    )

    monkeypatch.setattr(service, "_start_optimization_job_runner", lambda *args, **kwargs: True)

    resumed = service.resume_optimization_job(job_id, {"idempotency_key": "resume-projection"})

    assert resumed["status"] == "RUNNING"
    assert resumed["resume_ready"] is False
    assert resumed["interrupted_reason"] is None
    assert resumed["summary"]["completed_combinations"] == 3
    assert resumed["summary"]["persisted_trial_count"] == 3
    assert resumed["summary"]["next_trial_index"] == 4
    assert resumed["summary"]["current_stage"] == "Preparing trial 4/4"
    assert resumed["summary"]["latest_update"] == "Resuming optimization from trial 4."


def test_budget_larger_than_batch_runs_to_completion_without_auto_pause(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-batch-pause")["strategy"]

    search_space = [
        {"key": "lookback_months", "label": "回看(月)", "mode": "range", "start": 4, "end": 6, "step": 1, "current": 6},
        {"key": "top_n", "label": "持仓数量", "mode": "range", "start": 3, "end": 4, "step": 1, "current": 4},
    ]
    planned = service._plan_optimization_search_snapshots(
        dict(strategy.get("parameters") or {}),
        search_space,
        6,
    )
    executed_snapshots: list[dict[str, Any]] = []

    def fake_trial(
        strategy_detail: dict[str, Any],
        evaluation_request: dict[str, Any],
        payload: dict[str, Any],
        parameter_snapshot: dict[str, Any],
        *,
        prepared_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        executed_snapshots.append(dict(parameter_snapshot))
        return _sample_trial_result(parameter_snapshot, score=1.3 + len(executed_snapshots) / 10.0)

    monkeypatch.setattr(service, "_evaluate_optimization_trial", fake_trial)
    monkeypatch.setattr(service, "_optimization_step_delay_seconds", lambda: 0.0)

    created = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=strategy["current_parameter_version_id"],
        budget_combinations=6,
        search_space=search_space,
    )

    assert created["status"] == "COMPLETED"
    assert created["summary"]["completed_combinations"] == 6
    assert created["summary"]["persisted_trial_count"] == 6
    assert created["summary"]["next_trial_index"] == 7
    assert created["summary"]["resume_ready"] is False
    assert created["completed_at"] is not None
    assert executed_snapshots == planned
    assert len(service._load_optimization_trials(created["id"])) == 6


def test_completed_optimization_only_persists_chart_series_for_top_candidates(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-topk-storage")["strategy"]

    planned = service._plan_optimization_search_snapshots(
        dict(strategy.get("parameters") or {}),
        WIDE_SEARCH_SPACE,
        6,
    )

    def fake_trial(
        strategy_detail: dict[str, Any],
        evaluation_request: dict[str, Any],
        payload: dict[str, Any],
        parameter_snapshot: dict[str, Any],
        *,
        prepared_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return _sample_trial_result(parameter_snapshot, score=_wide_snapshot_score(parameter_snapshot))

    monkeypatch.setattr(service, "_evaluate_optimization_trial", fake_trial)
    monkeypatch.setattr(service, "_optimization_step_delay_seconds", lambda: 0.0)

    created = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=strategy["current_parameter_version_id"],
        budget_combinations=6,
        search_space=WIDE_SEARCH_SPACE,
    )
    persisted_trials = service._load_optimization_trials(created["id"], include_chart_series=True)
    persisted_chart_indices = [
        int(trial["trial_index"])
        for trial in persisted_trials
        if list(trial.get("chart_series") or [])
    ]
    expected_top_indices = sorted(
        [
            trial_index
            for trial_index, _snapshot in sorted(
                enumerate(planned, start=1),
                key=lambda item: _wide_snapshot_score(item[1]),
                reverse=True,
            )[: service._optimization_candidate_limit()]
        ]
    )

    assert created["status"] == "COMPLETED"
    assert persisted_chart_indices == expected_top_indices
    assert len(persisted_chart_indices) == service._optimization_candidate_limit()
    assert all(
        not list(trial.get("chart_series") or [])
        for trial in persisted_trials
        if int(trial["trial_index"]) not in expected_top_indices
    )


def test_runtime_topk_and_heatmap_state_incrementally_tracks_successful_trials(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    runtime_state = service._optimization_runtime_state(PARALLEL_SEARCH_SPACE)

    planned = service._plan_optimization_search_snapshots(
        {"lookback_months": 6, "top_n": 5},
        PARALLEL_SEARCH_SPACE,
        9,
    )
    for trial_index, snapshot in enumerate(planned, start=1):
        sample = _sample_trial_result(snapshot, score=_wide_snapshot_score(snapshot))
        service._optimization_runtime_observe_trial(
            runtime_state,
            {
                "trial_index": trial_index,
                "status": "SUCCEEDED",
                "parameter_snapshot": sample["parameter_snapshot"],
                "metrics": sample["metrics"],
                "score": sample["score"],
            },
        )

    top_trials = service._optimization_runtime_top_trials(runtime_state)
    best_summary = service._optimization_runtime_best_summary(runtime_state)
    heatmap_summary = service._optimization_runtime_heatmap_summary(runtime_state)

    assert len(top_trials) == service._optimization_candidate_limit()
    assert best_summary is not None
    assert best_summary["trial_index"] == top_trials[0]["trial_index"]
    assert heatmap_summary is not None
    assert heatmap_summary["x_key"] == "lookback_months"
    assert heatmap_summary["y_key"] == "top_n"
    assert len(heatmap_summary["cells"]) == len(planned)


def test_optimization_trial_denormalized_metric_columns_are_written_and_loaded(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-denorm-columns")["strategy"]

    job_id, planned = _seed_running_job(service, strategy, completed_trials=1)
    first_snapshot = planned[0]
    expected = _sample_trial_result(first_snapshot, score=1.1)
    metrics = expected["metrics"]

    trial_row = service.storage.fetch_one(
        """
        SELECT return_sharpe, oos_sharpe, total_return_pct, stability
        FROM optimization_job_trials
        WHERE job_id = ? AND trial_index = 1
        """,
        (job_id,),
    )
    assert trial_row is not None
    assert pytest.approx(float(trial_row["return_sharpe"]), rel=1e-6) == float(metrics["return_sharpe"])
    assert pytest.approx(float(trial_row["oos_sharpe"]), rel=1e-6) == float(metrics["oos_sharpe"])
    assert pytest.approx(float(trial_row["total_return_pct"]), rel=1e-6) == float(metrics["total_return_pct"])
    assert pytest.approx(float(trial_row["stability"]), rel=1e-6) == float(metrics["stability"])

    loaded = service._load_optimization_trials(
        job_id,
        include_chart_series=False,
        include_metrics_json=False,
    )
    assert len(loaded) == 1
    loaded_metrics = loaded[0]["metrics"]
    assert pytest.approx(float(loaded_metrics["return_sharpe"]), rel=1e-6) == float(metrics["return_sharpe"])
    assert pytest.approx(float(loaded_metrics["oos_sharpe"]), rel=1e-6) == float(metrics["oos_sharpe"])
    assert pytest.approx(float(loaded_metrics["out_of_sample_sharpe"]), rel=1e-6) == float(metrics["oos_sharpe"])
    assert pytest.approx(float(loaded_metrics["total_return_pct"]), rel=1e-6) == float(metrics["total_return_pct"])
    assert pytest.approx(float(loaded_metrics["stability"]), rel=1e-6) == float(metrics["stability"])


def test_completed_job_detail_uses_zero_trial_fast_path_when_candidates_are_persisted(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-topk-detail")["strategy"]

    def fake_trial(
        strategy_detail: dict[str, Any],
        evaluation_request: dict[str, Any],
        payload: dict[str, Any],
        parameter_snapshot: dict[str, Any],
        *,
        prepared_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return _sample_trial_result(parameter_snapshot, score=_wide_snapshot_score(parameter_snapshot))

    monkeypatch.setattr(service, "_evaluate_optimization_trial", fake_trial)
    monkeypatch.setattr(service, "_optimization_step_delay_seconds", lambda: 0.0)

    created = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=strategy["current_parameter_version_id"],
        budget_combinations=6,
        search_space=WIDE_SEARCH_SPACE,
    )

    def fail_trial_loader(*args, **kwargs):
        raise AssertionError("completed detail should not reload optimization trials when candidates_json is present")

    monkeypatch.setattr(service, "_load_optimization_trials", fail_trial_loader)
    monkeypatch.setattr(service, "_load_optimization_trial_chart_series_map", fail_trial_loader)

    detail = service.get_optimization_job_detail(created["id"])

    assert detail["status"] == "COMPLETED"
    assert detail["summary"]["candidate_count"] == service._optimization_candidate_limit()
    assert len(detail["matching_combinations"]) == 6
    assert all(candidate["analysis"]["validation_windows"] for candidate in detail["candidates"])
    assert detail["summary"]["best_metrics_summary"] is not None
    assert detail["result"]["best_candidate_id"] is not None


def test_completed_job_detail_reports_total_matching_combinations_beyond_published_candidates(
    tmp_path,
    monkeypatch,
):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-match-count")["strategy"]

    def fake_trial(
        strategy_detail: dict[str, Any],
        evaluation_request: dict[str, Any],
        payload: dict[str, Any],
        parameter_snapshot: dict[str, Any],
        *,
        prepared_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return _sample_trial_result(parameter_snapshot, score=_wide_snapshot_score(parameter_snapshot))

    monkeypatch.setattr(service, "_evaluate_optimization_trial", fake_trial)
    monkeypatch.setattr(service, "_optimization_step_delay_seconds", lambda: 0.0)

    created = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=strategy["current_parameter_version_id"],
        budget_combinations=6,
        search_space=WIDE_SEARCH_SPACE,
    )

    detail = service.get_optimization_job_detail(created["id"])

    assert detail["status"] == "COMPLETED"
    assert detail["summary"]["candidate_count"] == service._optimization_candidate_limit()
    assert detail["summary"]["matching_combination_count"] == 6
    assert detail["summary"]["matching_combination_count"] > detail["summary"]["candidate_count"]
    assert len(detail["matching_combinations"]) == 6


def test_running_job_eta_falls_back_to_wall_clock_throughput_when_trial_durations_round_to_zero(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-eta-fallback")["strategy"]

    created_at = "2026-04-13T10:00:00Z"
    job_id = "opt_eta_zero_seconds"
    payload = {
        "objective": "sharpe",
        "base_parameter_version_id": strategy["current_parameter_version_id"],
        "entry_point": "lab_menu",
        "validation_mode": "walk_forward",
        "budget_combinations": 4,
        "search_space": SEARCH_SPACE,
        "status": "RUNNING",
        "progress_pct": 75,
        "completed_combinations": 3,
        "persisted_trial_count": 3,
        "next_trial_index": 4,
        "current_stage": "Running trial 4/4",
        "latest_update": "Completed 3/4 trials.",
    }
    service._persist_optimization_job(
        job_id,
        strategy["id"],
        payload,
        [],
        created_at=created_at,
        updated_at="2026-04-13T10:04:00Z",
        completed_at=None,
    )
    planned = service._plan_optimization_search_snapshots(
        dict(strategy.get("parameters") or {}),
        SEARCH_SPACE,
        4,
    )
    trial_stamps = [
        "2026-04-13T10:00:00Z",
        "2026-04-13T10:02:00Z",
        "2026-04-13T10:04:00Z",
    ]
    for trial_index, (snapshot, stamp) in enumerate(zip(planned[:3], trial_stamps, strict=False), start=1):
        sample = _sample_trial_result(snapshot, score=1.0 + trial_index / 10.0)
        service._persist_optimization_trial(
            job_id,
            trial_index,
            status="SUCCEEDED",
            parameter_snapshot=sample["parameter_snapshot"],
            metrics=sample["metrics"],
            chart_series=sample["chart_series"],
            score=sample["score"],
            error_message=None,
            started_at=stamp,
            completed_at=stamp,
        )

    monkeypatch.setattr(service, "_optimization_step_delay_seconds", lambda: 0.0)

    detail = service.get_optimization_job_detail(job_id)

    assert detail["summary"]["estimated_remaining_minutes"] == 2
    assert detail["summary"]["estimated_completed_at"] is not None
    assert detail["summary"]["best_metrics_summary"]["trial_index"] >= 1


def test_resume_is_idempotent_for_same_key_and_conflicts_for_new_key(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-resume-idempotent")["strategy"]
    job_id, _ = _seed_interrupted_job(service, strategy, completed_trials=2)

    monkeypatch.setattr(service, "_start_optimization_job_runner", lambda *args, **kwargs: True)

    resumed = service.resume_optimization_job(job_id, {"idempotency_key": "resume-once"})
    duplicate = service.resume_optimization_job(job_id, {"idempotency_key": "resume-once"})

    assert resumed["status"] == "RUNNING"
    assert duplicate["status"] == "RUNNING"
    assert duplicate["summary"]["resume_ready"] is False
    assert duplicate["request"]["resume_idempotency_key"] == "resume-once"

    with pytest.raises(ContractConflictError):
        service.resume_optimization_job(job_id, {"idempotency_key": "resume-again"})


def test_interrupted_job_allows_new_resume_key_after_prior_attempt(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-resume-stale-key")["strategy"]
    job_id, _ = _seed_interrupted_job(service, strategy, completed_trials=2)
    interrupted = service.get_optimization_job_detail(job_id)

    interrupted_payload = {
        **dict(interrupted["request"]),
        "status": "INTERRUPTED",
        "progress_pct": interrupted["summary"]["progress_pct"],
        "completed_combinations": interrupted["summary"]["completed_combinations"],
        "persisted_trial_count": interrupted["summary"]["persisted_trial_count"],
        "next_trial_index": interrupted["summary"]["next_trial_index"],
        "resume_ready": True,
        "interrupted_reason": interrupted["summary"]["interrupted_reason"],
        "current_stage": interrupted["summary"]["current_stage"],
        "latest_update": interrupted["summary"]["latest_update"],
        "best_metrics_summary": interrupted["summary"]["best_metrics_summary"],
        "resume_idempotency_key": "resume-old-attempt",
    }
    service._persist_optimization_job(
        job_id,
        strategy["id"],
        interrupted_payload,
        [],
        created_at=str(interrupted["created_at"]),
        updated_at=str(interrupted["updated_at"]),
        completed_at=None,
    )

    monkeypatch.setattr(service, "_start_optimization_job_runner", lambda *args, **kwargs: True)

    resumed = service.resume_optimization_job(job_id, {"idempotency_key": "resume-new-attempt"})

    assert resumed["status"] == "RUNNING"
    assert resumed["request"]["resume_idempotency_key"] == "resume-new-attempt"
    assert resumed["summary"]["next_trial_index"] == 3
    assert resumed["summary"]["resume_ready"] is False


def test_start_optimization_job_runner_uses_subprocess_worker_outside_pytest(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    popen_calls: list[tuple[list[str], dict[str, Any]]] = []

    class FakeProcess:
        pid = 43210

    def fake_popen(command, **kwargs):
        popen_calls.append((list(command), dict(kwargs)))
        return FakeProcess()

    monkeypatch.setenv("GRIT_OPTIMIZATION_RUNNER_MODE", "subprocess")
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    monkeypatch.setattr("grit_backtest_platform._service_rebuilt.subprocess.Popen", fake_popen)

    started = service._start_optimization_job_runner(
        "opt_subprocess_worker",
        "strat_subprocess_worker",
        {"status": "QUEUED"},
        created_at="2026-04-14T00:00:00Z",
    )

    assert started is True
    assert len(popen_calls) == 1
    command, kwargs = popen_calls[0]
    assert command[:4] == [sys.executable, "-m", "grit_backtest_platform.main", "run-optimization"]
    assert "--job-id" in command and "opt_subprocess_worker" in command
    assert kwargs["env"]["GRIT_BACKTEST_DB"] == str(service.storage.path)
    assert kwargs["env"]["GRIT_OPTIMIZATION_RUNNER_OWNER_ID"] == service._optimization_runner_owner_id
    claim_state = service._read_runtime_state(service._optimization_runner_claim_key("opt_subprocess_worker"))
    assert claim_state["state_json"]["pid"] == 43210


def test_run_optimization_job_worker_loads_persisted_job_and_releases_claim(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-worker-job")["strategy"]
    created_at = "2026-04-14T00:00:00Z"
    job_id = "opt_worker_job"
    payload = {
        "objective": "sharpe",
        "base_parameter_version_id": strategy["current_parameter_version_id"],
        "entry_point": "lab_menu",
        "validation_mode": "walk_forward",
        "budget_combinations": 2,
        "search_space": SEARCH_SPACE,
        "status": "QUEUED",
        "progress_pct": 0,
        "completed_combinations": 0,
        "current_stage": "Queued",
        "latest_update": "Queued",
    }
    service._persist_optimization_job(
        job_id,
        strategy["id"],
        payload,
        [{"id": "trial_001", "label": "Trial 1"}],
        created_at=created_at,
        updated_at=created_at,
        completed_at=None,
    )

    captured: dict[str, Any] = {}

    def fake_runner(
        runner_job_id: str,
        strategy_id: str,
        runner_payload: dict[str, Any],
        *,
        created_at: str,
        existing_candidates: list[dict[str, Any]] | None = None,
        recovered: bool = False,
    ) -> None:
        captured["job_id"] = runner_job_id
        captured["strategy_id"] = strategy_id
        captured["payload"] = dict(runner_payload)
        captured["created_at"] = created_at
        captured["existing_candidates"] = list(existing_candidates or [])
        captured["recovered"] = recovered

    monkeypatch.setattr(service, "_run_real_optimization_job", fake_runner)

    started = service.run_optimization_job_worker(job_id)

    assert started is True
    assert captured["job_id"] == job_id
    assert captured["strategy_id"] == strategy["id"]
    assert captured["payload"]["objective"] == "sharpe"
    assert captured["created_at"] == created_at
    assert captured["existing_candidates"] == [{"id": "trial_001", "label": "Trial 1"}]
    assert captured["recovered"] is True
    assert service._read_runtime_state(service._optimization_runner_claim_key(job_id)) == {}


def test_startup_resumes_stale_running_and_queued_jobs(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-startup")["strategy"]

    running_job_id, running_planned = _seed_running_job(service, strategy, completed_trials=1)
    queued_payload = {
        "objective": "sharpe",
        "base_parameter_version_id": strategy["current_parameter_version_id"],
        "entry_point": "lab_menu",
        "validation_mode": "walk_forward",
        "budget_combinations": 4,
        "search_space": SEARCH_SPACE,
        "status": "QUEUED",
        "progress_pct": 0,
        "completed_combinations": 0,
        "current_stage": "Queued",
        "latest_update": "Waiting to start.",
    }
    service._persist_optimization_job(
        "opt_seed_queued",
        strategy["id"],
        queued_payload,
        [],
        created_at="2026-04-13T10:01:00Z",
        updated_at="2026-04-13T10:01:00Z",
        completed_at=None,
    )

    def fake_trial(
        strategy_detail: dict[str, Any],
        evaluation_request: dict[str, Any],
        payload: dict[str, Any],
        parameter_snapshot: dict[str, Any],
        *,
        prepared_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return _sample_trial_result(parameter_snapshot, score=1.6)

    monkeypatch.setattr(service, "_evaluate_optimization_trial", fake_trial)
    monkeypatch.setattr(service, "_optimization_step_delay_seconds", lambda: 0.0)

    resumed = service.resume_incomplete_optimization_jobs()
    running_job = _wait_for_terminal_job(service, running_job_id)
    queued_job = _wait_for_terminal_job(service, "opt_seed_queued")

    assert resumed == [running_job_id, "opt_seed_queued"]
    assert running_job["status"] == "COMPLETED"
    assert queued_job["status"] == "COMPLETED"
    assert running_job["summary"]["resume_ready"] is False
    assert queued_job["summary"]["resume_ready"] is False
    assert running_job["summary"].get("interrupted_reason") is None
    assert queued_job["summary"].get("interrupted_reason") is None
    assert running_job["summary"]["persisted_trial_count"] == 4
    assert queued_job["summary"]["persisted_trial_count"] == 4
    assert len(service._load_optimization_trials(running_job_id)) == 4
    assert len(service._load_optimization_trials("opt_seed_queued")) == 4


def test_running_detail_stays_lightweight_without_full_candidates(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-lightweight")["strategy"]

    def slow_trial(
        strategy_detail: dict[str, Any],
        evaluation_request: dict[str, Any],
        payload: dict[str, Any],
        parameter_snapshot: dict[str, Any],
        *,
        prepared_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        time.sleep(0.08)
        return _sample_trial_result(parameter_snapshot, score=1.4)

    monkeypatch.setattr(service, "_evaluate_optimization_trial", slow_trial)
    monkeypatch.setattr(service, "_optimization_step_delay_seconds", lambda: 0.0)

    created = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=strategy["current_parameter_version_id"],
        budget_combinations=4,
        search_space=SEARCH_SPACE,
        wait_until_complete=False,
    )

    deadline = time.monotonic() + 2.0
    running = created
    while time.monotonic() < deadline:
        running = service.get_optimization_job_detail(created["id"])
        if running["status"] == "RUNNING" and running["summary"]["completed_combinations"] >= 1:
            break
        time.sleep(0.02)

    assert running["status"] == "RUNNING"
    assert running["summary"]["completed_combinations"] >= 1
    assert running["candidates"] == []
    assert running["result"]["best_candidate_id"] is None
    assert running["summary"]["best_metrics_summary"] is not None


def test_running_detail_uses_zero_scan_fast_path_from_job_summary(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-running-fast-path")["strategy"]

    planned = service._plan_optimization_search_snapshots(
        dict(strategy.get("parameters") or {}),
        SEARCH_SPACE,
        4,
    )
    sample = _sample_trial_result(planned[1], score=1.7)
    heartbeat_at = "2026-04-13T10:05:00Z"
    payload = {
        "objective": "sharpe",
        "base_parameter_version_id": strategy["current_parameter_version_id"],
        "entry_point": "lab_menu",
        "validation_mode": "walk_forward",
        "budget_combinations": 4,
        "search_space": SEARCH_SPACE,
        "status": "RUNNING",
        "progress_pct": 50,
        "completed_combinations": 2,
        "persisted_trial_count": 2,
        "next_trial_index": 3,
        "current_stage": "Running trial 3/4",
        "latest_update": "Completed 2/4 trials.",
        "estimated_remaining_minutes": 2,
        "estimated_completed_at": "2026-04-13T10:07:00Z",
        "heartbeat_at": heartbeat_at,
        "best_metrics_summary": {
            "trial_index": 2,
            "label": "Candidate 2",
            "status": "SUCCEEDED",
            "parameter_snapshot": sample["parameter_snapshot"],
            "metrics": sample["metrics"],
            "score": sample["score"],
            "started_at": heartbeat_at,
            "completed_at": heartbeat_at,
        },
    }
    service._persist_optimization_job(
        "opt_running_fast_path",
        strategy["id"],
        payload,
        [],
        created_at="2026-04-13T10:00:00Z",
        updated_at=heartbeat_at,
        completed_at=None,
    )

    def fail_trial_loader(*args, **kwargs):
        raise AssertionError("running detail should not scan optimization_job_trials when summary_json already has progress truth")

    monkeypatch.setattr(service, "_load_optimization_trials", fail_trial_loader)

    detail = service.get_optimization_job_detail("opt_running_fast_path")

    assert detail["status"] == "RUNNING"
    assert detail["candidates"] == []
    assert detail["summary"]["persisted_trial_count"] == 2
    assert detail["summary"]["next_trial_index"] == 3
    assert detail["summary"]["estimated_remaining_minutes"] == 2
    assert detail["summary"]["heartbeat_at"] == heartbeat_at
    assert detail["summary"]["best_metrics_summary"]["trial_index"] == 2
    assert detail["result"]["best_candidate_id"] is None


def test_running_detail_repairs_stale_summary_progress_from_trial_rows(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-running-progress-repair")["strategy"]

    planned = service._plan_optimization_search_snapshots(
        dict(strategy.get("parameters") or {}),
        SEARCH_SPACE,
        4,
    )
    heartbeat_at = "2026-04-13T10:05:00Z"
    payload = {
        "objective": "sharpe",
        "base_parameter_version_id": strategy["current_parameter_version_id"],
        "entry_point": "lab_menu",
        "validation_mode": "walk_forward",
        "budget_combinations": 4,
        "search_space": SEARCH_SPACE,
        "status": "RUNNING",
        "progress_pct": 50,
        "completed_combinations": 2,
        "persisted_trial_count": 2,
        "next_trial_index": 3,
        "current_stage": "Running trial 3/4",
        "latest_update": "Completed 2/4 trials.",
        "estimated_remaining_minutes": 2,
        "estimated_completed_at": "2026-04-13T10:07:00Z",
        "heartbeat_at": heartbeat_at,
        "best_metrics_summary": None,
    }
    service._persist_optimization_job(
        "opt_running_progress_repair",
        strategy["id"],
        payload,
        [],
        created_at="2026-04-13T10:00:00Z",
        updated_at=heartbeat_at,
        completed_at=None,
    )
    for trial_index, snapshot in enumerate(planned, start=1):
        sample = _sample_trial_result(snapshot, score=1.2 + trial_index / 10.0)
        completed_at = f"2026-04-13T10:0{trial_index}:00Z"
        service._persist_optimization_trial(
            "opt_running_progress_repair",
            trial_index,
            status="SUCCEEDED",
            parameter_snapshot=sample["parameter_snapshot"],
            metrics=sample["metrics"],
            chart_series=sample["chart_series"],
            score=sample["score"],
            error_message=None,
            started_at=completed_at,
            completed_at=completed_at,
        )

    detail = service.get_optimization_job_detail("opt_running_progress_repair")

    assert detail["status"] == "RUNNING"
    assert detail["summary"]["completed_combinations"] == 4
    assert detail["summary"]["persisted_trial_count"] == 4
    assert detail["summary"]["next_trial_index"] == 5
    assert detail["summary"]["progress_pct"] == 100
    assert detail["summary"]["current_stage"] == "Running trial 5/4"
    assert detail["summary"]["latest_update"] == "Completed 4/4 trials."
    assert detail["summary"]["heartbeat_at"] == "2026-04-13T10:04:00Z"
    assert detail["summary"]["best_metrics_summary"] is not None
    assert detail["summary"]["best_metrics_summary"]["trial_index"] == 4


def test_completed_detail_repairs_corrupted_candidate_metrics_from_trial_rows(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-detail-repair")["strategy"]

    job_id = "opt_completed_detail_metric_repair"
    created_at = "2026-04-13T10:00:00Z"
    chart_series = [
        {
            "trade_date": "2026-01-01",
            "equity": 101.0,
            "benchmark": 100.5,
            "drawdown": 0.0,
            "is_oos": False,
            "strategy_return": 0.01,
            "benchmark_return": 0.005,
        },
        {
            "trade_date": "2026-01-02",
            "equity": 99.99,
            "benchmark": 100.7,
            "drawdown": -0.01,
            "is_oos": False,
            "strategy_return": -0.01,
            "benchmark_return": 0.002,
        },
        {
            "trade_date": "2026-01-03",
            "equity": 103.99,
            "benchmark": 101.0,
            "drawdown": -0.005,
            "is_oos": False,
            "strategy_return": 0.04,
            "benchmark_return": 0.003,
        },
        {
            "trade_date": "2026-01-04",
            "equity": 106.07,
            "benchmark": 101.5,
            "drawdown": 0.0,
            "is_oos": True,
            "strategy_return": 0.02,
            "benchmark_return": 0.005,
        },
        {
            "trade_date": "2026-01-05",
            "equity": 104.48,
            "benchmark": 101.3,
            "drawdown": -0.015,
            "is_oos": True,
            "strategy_return": -0.015,
            "benchmark_return": -0.002,
        },
        {
            "trade_date": "2026-01-06",
            "equity": 108.66,
            "benchmark": 101.9,
            "drawdown": -0.003,
            "is_oos": True,
            "strategy_return": 0.04,
            "benchmark_return": 0.006,
        },
    ]
    full_metrics = service._build_real_optimization_metrics(
        {
            "metrics": {
                "sharpe": 1.05,
                "oos_sharpe": 0.91,
                "turnover": 0.12,
                "win_rate": 0.58,
            }
        },
        chart_series,
    )
    parameter_snapshot = dict(strategy.get("parameters") or {})
    full_trial = {
        "job_id": job_id,
        "trial_index": 1,
        "status": "SUCCEEDED",
        "parameter_snapshot": parameter_snapshot,
        "metrics": full_metrics,
        "chart_series": chart_series,
        "score": 1.234,
        "error_message": None,
        "started_at": created_at,
        "completed_at": created_at,
    }
    payload = {
        "objective": "sharpe",
        "base_parameter_version_id": strategy["current_parameter_version_id"],
        "entry_point": "lab_menu",
        "validation_mode": "walk_forward",
        "budget_combinations": 1,
        "search_space": SEARCH_SPACE,
        "status": "COMPLETED",
        "progress_pct": 100,
        "completed_combinations": 1,
        "persisted_trial_count": 1,
        "next_trial_index": 2,
        "current_stage": "Result ready",
        "latest_update": "Optimization completed.",
    }
    service._persist_optimization_job(
        job_id,
        strategy["id"],
        payload,
        [],
        created_at=created_at,
        updated_at=created_at,
        completed_at=created_at,
    )
    service._persist_optimization_trial(
        job_id,
        1,
        status="SUCCEEDED",
        parameter_snapshot=parameter_snapshot,
        metrics=full_metrics,
        chart_series=chart_series,
        score=full_trial["score"],
        error_message=None,
        started_at=created_at,
        completed_at=created_at,
    )
    candidates = service._build_optimization_candidate_records(
        strategy,
        {**payload, "best_metrics_summary": service._best_optimization_trial_summary([full_trial])},
        [full_trial],
        heatmap_trials=[full_trial],
    )
    best_summary = service._best_optimization_trial_summary([full_trial])
    service._persist_optimization_job(
        job_id,
        strategy["id"],
        {**payload, "best_metrics_summary": best_summary},
        candidates,
        created_at=created_at,
        updated_at=created_at,
        completed_at=created_at,
    )

    partial_metrics = {
        key: full_metrics[key]
        for key in (
            "return_sharpe",
            "sharpe",
            "out_of_sample_sharpe",
            "oos_sharpe",
            "total_return_pct",
            "stability",
        )
    }
    service.storage.execute(
        """
        UPDATE optimization_job_trials
        SET metrics_json = ?, return_sharpe = ?, oos_sharpe = ?, total_return_pct = ?, stability = ?
        WHERE job_id = ? AND trial_index = ?
        """,
        (
            json.dumps(partial_metrics),
            full_metrics["return_sharpe"],
            full_metrics["out_of_sample_sharpe"],
            full_metrics["total_return_pct"],
            full_metrics["stability"],
            job_id,
            1,
        ),
    )
    corrupted_candidates = [dict(candidates[0], metrics=partial_metrics)]
    corrupted_best_summary = {**best_summary, "metrics": partial_metrics}
    service._persist_optimization_job(
        job_id,
        strategy["id"],
        {**payload, "best_metrics_summary": corrupted_best_summary},
        corrupted_candidates,
        created_at=created_at,
        updated_at=created_at,
        completed_at=created_at,
    )

    detail = service.get_optimization_job_detail(job_id)

    assert detail["candidates"][0]["id"] == candidates[0]["id"]
    assert detail["candidates"][0]["metrics"]["annualized_return"] == pytest.approx(full_metrics["annualized_return"])
    assert detail["candidates"][0]["metrics"]["max_drawdown_pct"] == pytest.approx(full_metrics["max_drawdown_pct"])
    assert detail["summary"]["best_metrics_summary"]["metrics"]["annualized_return"] == pytest.approx(
        full_metrics["annualized_return"]
    )

    repaired_trial = service._load_optimization_trials(
        job_id,
        include_chart_series=False,
        trial_indices=[1],
        include_metrics_json=True,
    )[0]
    assert repaired_trial["metrics"]["annualized_return"] == pytest.approx(full_metrics["annualized_return"])
    assert repaired_trial["metrics"]["max_drawdown_pct"] == pytest.approx(full_metrics["max_drawdown_pct"])


def test_optimization_runtime_batches_running_summary_writes(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-heartbeat-batch")["strategy"]

    captured_writes: list[dict[str, Any]] = []
    original_persist_job = service._persist_optimization_job

    def tracking_persist_job(job_id: str, strategy_id: str, payload: dict[str, Any], candidates: list[dict[str, Any]], **kwargs):
        captured_writes.append(
            {
                "job_id": job_id,
                "strategy_id": strategy_id,
                "status": str(payload.get("status") or "").upper(),
                "completed_combinations": payload.get("completed_combinations"),
                "persisted_trial_count": payload.get("persisted_trial_count"),
                "candidate_count": len(candidates),
            }
        )
        return original_persist_job(job_id, strategy_id, payload, candidates, **kwargs)

    def fast_trial(
        strategy_detail: dict[str, Any],
        evaluation_request: dict[str, Any],
        payload: dict[str, Any],
        parameter_snapshot: dict[str, Any],
        *,
        prepared_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return _sample_trial_result(parameter_snapshot, score=_wide_snapshot_score(parameter_snapshot))

    monkeypatch.setattr(service, "_persist_optimization_job", tracking_persist_job)
    monkeypatch.setattr(service, "_evaluate_optimization_trial", fast_trial)
    monkeypatch.setattr(service, "_optimization_step_delay_seconds", lambda: 0.0)

    created = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=strategy["current_parameter_version_id"],
        budget_combinations=9,
        search_space=PARALLEL_SEARCH_SPACE,
    )

    job_writes = [entry for entry in captured_writes if entry["job_id"] == created["id"]]
    running_writes = [entry for entry in job_writes if entry["status"] == "RUNNING"]

    assert created["status"] == "COMPLETED"
    assert len(running_writes) < 9
    assert running_writes[0]["completed_combinations"] == 0
    assert any((entry["completed_combinations"] or 0) >= 5 for entry in running_writes)
    assert job_writes[-1]["status"] == "COMPLETED"
    assert job_writes[-1]["candidate_count"] == service._optimization_candidate_limit()


def test_optimization_path_skips_prepared_context_preload(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-context")["strategy"]

    prepare_calls: list[int] = []

    def counting_prepare(*args, **kwargs):
        prepare_calls.append(1)
        raise AssertionError("_prepare_backtest_run_context should not be used by optimization jobs")

    def fake_trial(
        strategy_detail: dict[str, Any],
        evaluation_request: dict[str, Any],
        payload: dict[str, Any],
        parameter_snapshot: dict[str, Any],
        *,
        prepared_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return _sample_trial_result(parameter_snapshot, score=1.6)

    monkeypatch.setattr(type(service), "_prepare_backtest_run_context", counting_prepare)
    monkeypatch.setattr(service, "_evaluate_optimization_trial", fake_trial)
    monkeypatch.setattr(service, "_backfill_optimization_top_trial_chart_series", lambda *args, **kwargs: list(args[4]))
    monkeypatch.setattr(service, "_optimization_step_delay_seconds", lambda: 0.0)

    job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=strategy["current_parameter_version_id"],
        budget_combinations=4,
        search_space=SEARCH_SPACE,
    )

    assert job["status"] == "COMPLETED"
    assert prepare_calls == []


def test_real_optimization_path_reuses_a_single_prepared_context(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-real-context-guard")["strategy"]

    original_prepare = type(service)._prepare_backtest_run_context
    prepare_calls: list[int] = []

    def counting_prepare(*args, **kwargs):
        prepare_calls.append(1)
        return original_prepare(*args, **kwargs)

    monkeypatch.setattr(type(service), "_prepare_backtest_run_context", counting_prepare)
    monkeypatch.setattr(service, "_optimization_step_delay_seconds", lambda: 0.0)

    job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=strategy["current_parameter_version_id"],
        budget_combinations=4,
        search_space=SEARCH_SPACE,
    )

    assert job["status"] == "COMPLETED"
    assert job["summary"]["completed_combinations"] == 4
    assert job["summary"]["persisted_trial_count"] == 4
    assert job["summary"]["next_trial_index"] == 5
    assert prepare_calls == [1]


def test_backfill_chart_series_does_not_prepare_context_implicitly(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-backfill-context-guard")["strategy"]
    planned = service._plan_optimization_search_snapshots(
        dict(strategy.get("parameters") or {}),
        SEARCH_SPACE,
        4,
    )
    job_id = "opt_backfill_context_guard"

    service._persist_optimization_job(
        job_id,
        strategy["id"],
        {
            "objective": "sharpe",
            "base_parameter_version_id": strategy["current_parameter_version_id"],
            "entry_point": "lab_menu",
            "validation_mode": "walk_forward",
            "budget_combinations": 4,
            "search_space": SEARCH_SPACE,
            "status": "RUNNING",
            "progress_pct": 100,
            "completed_combinations": 4,
            "persisted_trial_count": 4,
            "next_trial_index": 5,
            "current_stage": "Result ready",
            "latest_update": "Completed 4/4 trials.",
        },
        [],
        created_at="2026-04-13T10:00:00Z",
        updated_at="2026-04-13T10:00:00Z",
        completed_at=None,
    )

    for trial_index, snapshot in enumerate(planned, start=1):
        sample = _sample_trial_result(snapshot, score=_wide_snapshot_score(snapshot))
        service._persist_optimization_trial(
            job_id,
            trial_index,
            status="SUCCEEDED",
            parameter_snapshot=sample["parameter_snapshot"],
            metrics=sample["metrics"],
            chart_series=[],
            score=sample["score"],
            error_message=None,
            started_at="2026-04-13T10:00:00Z",
            completed_at="2026-04-13T10:00:00Z",
        )

    request_payload = {
        "objective": "sharpe",
        "search_space": SEARCH_SPACE,
        "validation_mode": "walk_forward",
    }
    evaluation_request = service._build_optimization_evaluation_request(strategy, source_run=None)
    prepared_context = type(service)._prepare_backtest_run_context(service, strategy, evaluation_request)
    request_payload["__optimization_prepared_context"] = prepared_context

    def fail_prepare(*args, **kwargs):
        raise AssertionError("_prepare_backtest_run_context should not be used during optimization chart backfill")

    monkeypatch.setattr(type(service), "_prepare_backtest_run_context", fail_prepare)

    final_trials = service._backfill_optimization_top_trial_chart_series(
        job_id,
        strategy,
        evaluation_request,
        request_payload,
        service._load_optimization_trials(job_id, include_chart_series=False),
    )

    assert len(final_trials) == 4
    top_trial_indices = service._optimization_top_trial_indices(final_trials)
    top_trials = [trial for trial in final_trials if int(trial["trial_index"]) in top_trial_indices]
    assert top_trials
    assert all(list(trial.get("chart_series") or []) for trial in top_trials)


def test_build_optimization_evaluation_request_backfills_source_run_window(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    strategy = create_momentum_strategy(client, idempotency_key="opt-eval-window-backfill")["strategy"]

    evaluation_request = service._build_optimization_evaluation_request(
        strategy,
        source_run={
            "id": "run_source_window",
            "request": {"data_segment_type": "FULL"},
            "start_date": "2018-01-02",
            "end_date": "2019-12-31",
        },
    )

    assert evaluation_request["source_run_id"] == "run_source_window"
    assert evaluation_request["start_date"] == "2018-01-02"
    assert evaluation_request["end_date"] == "2019-12-31"
    assert evaluation_request["is_permanent"] is False


def test_optimization_job_inherits_source_run_window_for_trial_evaluation(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-job-source-window")["strategy"]
    source_run = submit_backtest(
        client,
        strategy["id"],
        start_date="2018-01-02",
        end_date="2019-12-31",
        idempotency_key="run-opt-job-source-window",
    )

    captured_requests: list[dict[str, Any]] = []

    def fake_trial(
        strategy_detail: dict[str, Any],
        evaluation_request: dict[str, Any],
        payload: dict[str, Any],
        parameter_snapshot: dict[str, Any],
        *,
        prepared_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        captured_requests.append(dict(evaluation_request))
        return _sample_trial_result(parameter_snapshot, score=1.6)

    monkeypatch.setattr(service, "_evaluate_optimization_trial", fake_trial)
    monkeypatch.setattr(service, "_backfill_optimization_top_trial_chart_series", lambda *args, **kwargs: list(args[4]))
    monkeypatch.setattr(service, "_optimization_step_delay_seconds", lambda: 0.0)

    job = create_optimization_job(
        client,
        strategy["id"],
        source_run_id=source_run["id"],
        budget_combinations=1,
        search_space=[
            {
                "key": "lookback_months",
                "label": "回看(月)",
                "mode": "range",
                "start": 6,
                "end": 6,
                "step": 1,
                "current": 6,
            }
        ],
    )

    assert job["status"] == "COMPLETED"
    assert captured_requests
    assert captured_requests[0]["source_run_id"] == source_run["id"]
    assert captured_requests[0]["start_date"] == "2018-01-02"
    assert captured_requests[0]["end_date"] == "2019-12-31"


def test_default_optimization_path_keeps_parallel_controller_disabled(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-default-sequential")["strategy"]

    def fail_parallel_runner(**kwargs):
        raise AssertionError("_run_parallel_optimization_trials should stay disabled by default")

    monkeypatch.setattr(service, "_optimization_parallel_min_trials", lambda: 1)
    monkeypatch.setattr(service, "_run_parallel_optimization_trials", fail_parallel_runner)
    monkeypatch.setattr(service, "_optimization_step_delay_seconds", lambda: 0.0)

    created = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=strategy["current_parameter_version_id"],
        budget_combinations=9,
        search_space=PARALLEL_SEARCH_SPACE,
        timeout_seconds=10.0,
    )

    assert created["status"] == "COMPLETED"
    assert created["summary"]["completed_combinations"] == 9
    assert created["summary"]["persisted_trial_count"] == 9
    assert created["summary"]["next_trial_index"] == 10


def test_parallel_worker_target_policy_downshifts_and_recovers(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    assert service._optimization_initial_parallel_worker_target(
        8,
        memory_status={"system_memory_ratio": 0.55, "process_memory_ratio": 0.10},
    ) == 8
    assert service._optimization_initial_parallel_worker_target(
        8,
        memory_status={"system_memory_ratio": 0.61, "process_memory_ratio": 0.10},
    ) == 4
    assert service._optimization_initial_parallel_worker_target(
        8,
        memory_status={"system_memory_ratio": 0.71, "process_memory_ratio": 0.10},
    ) == 2
    assert service._optimization_initial_parallel_worker_target(
        8,
        memory_status={"system_memory_ratio": 0.81, "process_memory_ratio": 0.10},
    ) == 1

    target, safe_streak = service._optimization_adjust_parallel_worker_target(
        4,
        base_cap=8,
        memory_status={"system_memory_ratio": 0.82, "process_memory_ratio": 0.10},
        safe_sample_streak=0,
    )
    assert (target, safe_streak) == (3, 0)

    target, safe_streak = service._optimization_adjust_parallel_worker_target(
        3,
        base_cap=8,
        memory_status={"system_memory_ratio": 0.91, "process_memory_ratio": 0.10},
        safe_sample_streak=0,
    )
    assert (target, safe_streak) == (1, 0)

    target, safe_streak = service._optimization_adjust_parallel_worker_target(
        1,
        base_cap=8,
        memory_status={"system_memory_ratio": 0.60, "process_memory_ratio": 0.20},
        safe_sample_streak=0,
    )
    assert (target, safe_streak) == (1, 1)

    target, safe_streak = service._optimization_adjust_parallel_worker_target(
        target,
        base_cap=8,
        memory_status={"system_memory_ratio": 0.60, "process_memory_ratio": 0.20},
        safe_sample_streak=safe_streak,
    )
    assert (target, safe_streak) == (1, 2)

    target, safe_streak = service._optimization_adjust_parallel_worker_target(
        target,
        base_cap=8,
        memory_status={"system_memory_ratio": 0.60, "process_memory_ratio": 0.20},
        safe_sample_streak=safe_streak,
    )
    assert (target, safe_streak) == (2, 0)


def test_parallel_eta_uses_wall_clock_throughput_for_overlapping_trials(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    eta = service._optimization_eta_projection(
        [
            {"started_at": "2026-04-13T10:00:00Z", "completed_at": "2026-04-13T10:02:00Z"},
            {"started_at": "2026-04-13T10:00:05Z", "completed_at": "2026-04-13T10:02:05Z"},
            {"started_at": "2026-04-13T10:00:10Z", "completed_at": "2026-04-13T10:02:10Z"},
        ],
        budget_combinations=6,
        completed_combinations=3,
    )

    assert eta["estimated_remaining_minutes"] == 3
    assert eta["estimated_completed_at"] is not None


def test_eta_projection_prefers_recent_completion_window_over_old_history(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    eta = service._optimization_eta_projection(
        [
            {"started_at": "2026-04-13T09:00:00Z", "completed_at": "2026-04-13T09:10:00Z"},
            {"started_at": "2026-04-13T09:10:00Z", "completed_at": "2026-04-13T09:20:00Z"},
            {"started_at": "2026-04-13T10:20:00Z", "completed_at": "2026-04-13T10:21:00Z"},
            {"started_at": "2026-04-13T10:21:00Z", "completed_at": "2026-04-13T10:22:00Z"},
            {"started_at": "2026-04-13T10:22:00Z", "completed_at": "2026-04-13T10:23:00Z"},
            {"started_at": "2026-04-13T10:23:00Z", "completed_at": "2026-04-13T10:24:00Z"},
            {"started_at": "2026-04-13T10:24:00Z", "completed_at": "2026-04-13T10:25:00Z"},
            {"started_at": "2026-04-13T10:25:00Z", "completed_at": "2026-04-13T10:26:00Z"},
            {"started_at": "2026-04-13T10:26:00Z", "completed_at": "2026-04-13T10:27:00Z"},
            {"started_at": "2026-04-13T10:27:00Z", "completed_at": "2026-04-13T10:28:00Z"},
        ],
        budget_combinations=12,
        completed_combinations=10,
    )

    assert eta["estimated_remaining_minutes"] == 2
    assert eta["estimated_completed_at"] is not None


def test_eta_projection_ignores_resume_downtime_gap(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    eta = service._optimization_eta_projection(
        [
            {"started_at": "2026-05-15T08:38:08Z", "completed_at": "2026-05-15T08:43:12Z"},
            {"started_at": "2026-05-15T08:43:12Z", "completed_at": "2026-05-15T08:48:36Z"},
            {"started_at": "2026-05-15T09:05:38Z", "completed_at": "2026-05-15T09:10:58Z"},
            {"started_at": "2026-05-18T07:07:54Z", "completed_at": "2026-05-18T07:13:15Z"},
            {"started_at": "2026-05-18T07:13:15Z", "completed_at": "2026-05-18T07:18:30Z"},
            {"started_at": "2026-05-18T07:18:30Z", "completed_at": "2026-05-18T07:23:57Z"},
            {"started_at": "2026-05-18T07:23:57Z", "completed_at": "2026-05-18T07:29:00Z"},
            {"started_at": "2026-05-18T07:34:00Z", "completed_at": "2026-05-18T07:39:06Z"},
        ],
        budget_combinations=720,
        completed_combinations=19,
    )

    assert eta["estimated_remaining_minutes"] < 5000
    assert eta["estimated_completed_at"] is not None


def test_completed_detail_reports_active_execution_seconds_without_resume_gap(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-active-duration")["strategy"]
    planned = service._plan_optimization_search_snapshots(
        dict(strategy.get("parameters") or {}),
        SEARCH_SPACE,
        2,
    )
    job_id = "opt_active_duration_gap"
    service._persist_optimization_job(
        job_id,
        strategy["id"],
        {
            "objective": "sharpe",
            "base_parameter_version_id": strategy["current_parameter_version_id"],
            "entry_point": "lab_menu",
            "validation_mode": "walk_forward",
            "budget_combinations": 2,
            "completed_combinations": 2,
            "persisted_trial_count": 2,
            "next_trial_index": 3,
            "status": "COMPLETED",
            "progress_pct": 100,
            "search_space": SEARCH_SPACE,
        },
        [],
        created_at="2026-05-15T08:00:00Z",
        updated_at="2026-05-18T08:00:00Z",
        completed_at="2026-05-18T08:00:00Z",
    )
    for trial_index, (snapshot, started_at, completed_at) in enumerate(
        [
            (planned[0], "2026-05-15T08:00:00Z", "2026-05-15T08:05:00Z"),
            (planned[1], "2026-05-18T07:59:00Z", "2026-05-18T08:00:00Z"),
        ],
        start=1,
    ):
        sample = _sample_trial_result(snapshot, score=1.0 + trial_index / 10.0)
        service._persist_optimization_trial(
            job_id,
            trial_index,
            status="SUCCEEDED",
            parameter_snapshot=sample["parameter_snapshot"],
            metrics=sample["metrics"],
            chart_series=sample["chart_series"],
            score=sample["score"],
            error_message=None,
            started_at=started_at,
            completed_at=completed_at,
        )

    detail = service.get_optimization_job_detail(job_id)

    assert detail["summary"]["active_execution_seconds"] == pytest.approx(360.0)
    assert detail["result"]["active_execution_seconds"] == pytest.approx(360.0)
    assert detail["summary"]["active_execution_seconds"] < 24 * 60 * 60


def test_parallel_controller_falls_back_to_sequential_when_parallel_runner_errors(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-parallel-fallback")["strategy"]

    planned = service._plan_optimization_search_snapshots(
        dict(strategy.get("parameters") or {}),
        PARALLEL_SEARCH_SPACE,
        9,
    )
    executed_snapshots: list[dict[str, Any]] = []

    def fake_trial(
        strategy_detail: dict[str, Any],
        evaluation_request: dict[str, Any],
        payload: dict[str, Any],
        parameter_snapshot: dict[str, Any],
        *,
        prepared_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        executed_snapshots.append(dict(parameter_snapshot))
        return _sample_trial_result(parameter_snapshot, score=1.4 + len(executed_snapshots) / 10.0)

    def fake_parallel_runner(**kwargs):
        raise RuntimeError("parallel bootstrap failed")

    monkeypatch.setattr(service, "_evaluate_optimization_trial", fake_trial)
    monkeypatch.setattr(service, "_optimization_can_use_parallel_controller", lambda pending_evaluations: True)
    monkeypatch.setattr(service, "_run_parallel_optimization_trials", fake_parallel_runner)
    monkeypatch.setattr(service, "_optimization_step_delay_seconds", lambda: 0.0)

    created = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=strategy["current_parameter_version_id"],
        budget_combinations=9,
        search_space=PARALLEL_SEARCH_SPACE,
        timeout_seconds=10.0,
    )

    assert created["status"] == "COMPLETED"
    assert created["summary"]["completed_combinations"] == 9
    assert created["summary"]["persisted_trial_count"] == 9
    assert created["summary"]["next_trial_index"] == 10
    assert executed_snapshots == planned


def test_large_optimization_job_uses_parallel_controller_and_completes(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-parallel-smoke")["strategy"]

    original_parallel_runner = service._run_parallel_optimization_trials
    parallel_calls: list[int] = []

    def tracking_parallel_runner(**kwargs):
        parallel_calls.append(len(kwargs["pending_evaluations"]))
        return original_parallel_runner(**kwargs)

    monkeypatch.setattr(service, "_optimization_can_use_parallel_controller", lambda pending_evaluations: True)
    monkeypatch.setattr(service, "_optimization_parallel_min_trials", lambda: 1)
    monkeypatch.setattr(service, "_optimization_parallel_worker_cap", lambda: 2)
    monkeypatch.setattr(
        service,
        "_optimization_memory_status",
        lambda: {
            "total_physical_bytes": 1000.0,
            "available_physical_bytes": 500.0,
            "process_working_set_bytes": 50.0,
            "system_memory_ratio": 0.50,
            "process_memory_ratio": 0.05,
        },
    )
    monkeypatch.setattr(service, "_run_parallel_optimization_trials", tracking_parallel_runner)
    monkeypatch.setattr(service, "_optimization_step_delay_seconds", lambda: 0.0)

    created = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=strategy["current_parameter_version_id"],
        budget_combinations=9,
        search_space=PARALLEL_SEARCH_SPACE,
        timeout_seconds=15.0,
    )

    assert created["status"] == "COMPLETED"
    assert created["summary"]["completed_combinations"] == 9
    assert created["summary"]["persisted_trial_count"] == 9
    assert created["summary"]["next_trial_index"] == 10
    assert parallel_calls == [9]

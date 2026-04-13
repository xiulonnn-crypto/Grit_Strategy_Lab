from __future__ import annotations

import time
from typing import Any

import pytest

from grit_backtest_platform.service import ContractConflictError

from tests.api_test_support import create_momentum_strategy, create_optimization_job, create_test_client


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


def _seed_running_job(service, strategy: dict[str, Any], *, completed_trials: int = 2) -> tuple[str, list[dict[str, Any]]]:
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


def _seed_interrupted_job(service, strategy: dict[str, Any], *, completed_trials: int = 2) -> tuple[str, list[dict[str, Any]]]:
    job_id, planned = _seed_running_job(service, strategy, completed_trials=completed_trials)
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


def test_completed_job_detail_only_loads_chart_series_for_top_candidates(tmp_path, monkeypatch):
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

    original_loader = service._load_optimization_trials
    loader_calls: list[dict[str, Any]] = []

    def tracking_loader(job_id: str, *, include_chart_series: bool = True, trial_indices=None):
        loader_calls.append(
            {
                "job_id": job_id,
                "include_chart_series": include_chart_series,
                "trial_indices": None if trial_indices is None else list(trial_indices),
            }
        )
        return original_loader(job_id, include_chart_series=include_chart_series, trial_indices=trial_indices)

    monkeypatch.setattr(service, "_load_optimization_trials", tracking_loader)

    detail = service.get_optimization_job_detail(created["id"])
    full_curve_calls = [call for call in loader_calls if call["include_chart_series"]]

    assert detail["status"] == "COMPLETED"
    assert detail["summary"]["candidate_count"] == service._optimization_candidate_limit()
    assert all(candidate["analysis"]["validation_windows"] for candidate in detail["candidates"])
    assert loader_calls[0]["include_chart_series"] is False
    assert len(full_curve_calls) == 1
    assert len(full_curve_calls[0]["trial_indices"]) == service._optimization_candidate_limit()


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

    monkeypatch.setattr(service, "_start_optimization_job_runner", lambda *args, **kwargs: False)

    resumed = service.resume_optimization_job(job_id, {"idempotency_key": "resume-once"})
    duplicate = service.resume_optimization_job(job_id, {"idempotency_key": "resume-once"})

    assert resumed["status"] == "QUEUED"
    assert duplicate["status"] == "QUEUED"
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

    monkeypatch.setattr(service, "_start_optimization_job_runner", lambda *args, **kwargs: False)

    resumed = service.resume_optimization_job(job_id, {"idempotency_key": "resume-new-attempt"})

    assert resumed["status"] == "QUEUED"
    assert resumed["request"]["resume_idempotency_key"] == "resume-new-attempt"
    assert resumed["summary"]["next_trial_index"] == 3
    assert resumed["summary"]["resume_ready"] is True


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


def test_optimization_path_skips_prepared_context_preload(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    strategy = create_momentum_strategy(client, idempotency_key="opt-exec-context")["strategy"]

    prepare_calls: list[int] = []

    def counting_prepare(*args, **kwargs):
        prepare_calls.append(1)
        raise AssertionError("_prepare_backtest_run_context should not be used by optimization jobs")

    monkeypatch.setattr(service, "_prepare_backtest_run_context", counting_prepare)
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

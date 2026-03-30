from __future__ import annotations

from tests.api_test_support import (
    assert_ok,
    assert_workspace_overview_contract,
    create_momentum_strategy,
    create_optimization_candidate,
    create_optimization_job,
    create_test_client,
    draft_strategy_session,
    materialize_session,
    momentum_confirmation_payload,
)
from datetime import datetime, timedelta, timezone
from pathlib import Path


def test_workspace_overview_contract_is_exact_on_fresh_database(tmp_path):
    client, _ = create_test_client(tmp_path)

    overview = assert_ok(client.get("/workspace/overview"))

    assert_workspace_overview_contract(overview)
    assert overview["strategy_count"] == 0
    assert overview["latest_strategy_id"] is None
    assert overview["latest_backtest_run_id"] is None
    assert overview["latest_optimization_job_id"] is None


def test_workspace_overview_can_include_cleanup_audit_without_changing_default_contract(tmp_path):
    client, _ = create_test_client(tmp_path)

    overview = assert_ok(client.get("/workspace/overview?include_cleanup_audit=1"))

    assert_workspace_overview_contract(overview, include_cleanup_audit=True)
    assert overview["last_cleanup_count"] == 0


def test_creation_session_workflow_materializes_and_lists_strategy(tmp_path):
    client, _ = create_test_client(tmp_path)

    session = draft_strategy_session(
        client,
        strategy_type="MOMENTUM",
        message="momentum strategy for SPY",
        confirmation_payload=momentum_confirmation_payload(revision=1),
    )

    assert session["created"]["mode"] == "CREATE"
    assert session["hydrated"]["messages"][-1]["content"] == "momentum strategy for SPY"
    assert session["prepared"]["status"] == "NEEDS_INPUT"
    assert session["confirmed"]["revision"] == session["prepared"]["revision"] + 1

    materialized = assert_ok(
        materialize_session(
            client,
            session["session_id"],
            idempotency_key="materialize-workflow-1",
        )
    )
    strategy_id = materialized["id"]

    strategies = assert_ok(client.get("/strategies"))
    detail = assert_ok(client.get(f"/strategies/{strategy_id}/detail"))
    overview = assert_ok(client.get("/workspace/overview"))

    assert len(strategies) == 1
    assert strategies[0]["id"] == strategy_id
    assert detail["current_parameter_version"] == 1
    assert detail["parameter_history"][0]["parameter_version_id"] == detail["current_parameter_version_id"]
    assert detail["parameters"]["top_n"] == 1
    assert_workspace_overview_contract(overview)
    assert overview["latest_strategy_id"] == strategy_id


def test_revision_materialize_appends_parameter_version_without_creating_new_strategy(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="materialize-base-1")
    base_strategy = base["strategy"]
    strategy_count_before = len(assert_ok(client.get("/strategies")))
    base_parameter_version_id = base_strategy["current_parameter_version_id"]

    revision_session = draft_strategy_session(
        client,
        strategy_type="MOMENTUM",
        message="momentum strategy revision for SPY",
        confirmation_payload=momentum_confirmation_payload(revision=1, top_n=3),
        mode="REVISION",
        base_strategy_id=base_strategy["id"],
        base_parameter_version_id=base_parameter_version_id,
    )

    assert revision_session["created"]["mode"] == "REVISION"
    assert revision_session["hydrated"]["base_strategy_id"] == base_strategy["id"]
    assert revision_session["hydrated"]["base_parameter_version_id"] == base_parameter_version_id

    revised = assert_ok(
        materialize_session(
            client,
            revision_session["session_id"],
            idempotency_key="materialize-revision-1",
            base_parameter_version_id=base_parameter_version_id,
        )
    )
    strategies = assert_ok(client.get("/strategies"))

    assert revised["id"] == base_strategy["id"]
    assert len(strategies) == strategy_count_before
    assert revised["current_parameter_version"] == 2
    assert revised["current_parameter_version_id"] != base_parameter_version_id
    assert len(revised["parameter_history"]) == 2
    assert revised["parameter_history"][-1]["parameters"]["top_n"] == 3


def test_revision_materialize_rejects_stale_base_parameter_version(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="materialize-base-stale")
    base_strategy = base["strategy"]
    stale_base_parameter_version_id = base_strategy["current_parameter_version_id"]

    stale_session = draft_strategy_session(
        client,
        strategy_type="MOMENTUM",
        message="momentum stale revision for SPY",
        confirmation_payload=momentum_confirmation_payload(revision=1, top_n=2),
        mode="REVISION",
        base_strategy_id=base_strategy["id"],
        base_parameter_version_id=stale_base_parameter_version_id,
    )
    fresh_revision = create_momentum_strategy(
        client,
        mode="REVISION",
        base_strategy_id=base_strategy["id"],
        base_parameter_version_id=stale_base_parameter_version_id,
        top_n=4,
        idempotency_key="materialize-fresh-revision",
    )

    response = materialize_session(
        client,
        stale_session["session_id"],
        idempotency_key="materialize-stale-revision",
        base_parameter_version_id=stale_base_parameter_version_id,
    )

    assert response.status_code == 409
    payload = response.json()
    assert payload["code"] == "stale_base_parameter_version"
    assert payload["expected_base_parameter_version_id"] == stale_base_parameter_version_id
    assert payload["current_parameter_version_id"] == fresh_revision["strategy"]["current_parameter_version_id"]


def test_promote_trial_rejects_stale_base_parameter_version(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="materialize-base-promote")
    strategy = base["strategy"]
    stale_base_parameter_version_id = strategy["current_parameter_version_id"]
    job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=stale_base_parameter_version_id,
    )
    trial_id = job["candidates"][0]["id"]

    create_momentum_strategy(
        client,
        mode="REVISION",
        base_strategy_id=strategy["id"],
        base_parameter_version_id=stale_base_parameter_version_id,
        top_n=5,
        idempotency_key="materialize-promote-conflict",
    )

    response = client.post(
        f"/optimization-jobs/{job['id']}/candidates/{trial_id}/promote",
        json={
            "idempotency_key": "promote-stale-1",
            "mode": "set_current",
            "base_parameter_version_id": stale_base_parameter_version_id,
        },
    )

    assert response.status_code == 409
    payload = response.json()
    assert payload["code"] == "stale_base_parameter_version"
    assert payload["expected_base_parameter_version_id"] == stale_base_parameter_version_id


def test_create_optimization_candidate_returns_updated_job_detail_with_full_snapshot(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="materialize-base-candidate-create")
    strategy = base["strategy"]
    base_parameter_version_id = strategy["current_parameter_version_id"]
    job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=base_parameter_version_id,
    )
    parameter_snapshot = {**strategy["parameters"], "top_n": 8}

    updated_job = create_optimization_candidate(
        client,
        job["id"],
        label="Manual candidate",
        parameter_snapshot=parameter_snapshot,
        base_parameter_version_id=base_parameter_version_id,
        metrics={"sharpe": 1.42},
        summary="Raised top_n for comparison.",
    )

    created_candidate = updated_job["candidates"][-1]

    assert updated_job["summary"]["candidate_count"] == 2
    assert created_candidate["label"] == "Manual candidate"
    assert created_candidate["parameter_snapshot"] == parameter_snapshot
    assert created_candidate["parameter_delta"] == {"top_n": 8}
    assert created_candidate["metrics"]["sharpe"] == 1.42
    assert created_candidate["base_parameter_version_id"] == base_parameter_version_id


def test_create_optimization_candidate_snapshot_stays_stable_after_strategy_revision(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="materialize-base-candidate-stable")
    strategy = base["strategy"]
    base_parameter_version_id = strategy["current_parameter_version_id"]
    job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=base_parameter_version_id,
    )
    manual_snapshot = {**strategy["parameters"], "top_n": 6}

    updated_job = create_optimization_candidate(
        client,
        job["id"],
        label="Stable manual candidate",
        parameter_snapshot=manual_snapshot,
        base_parameter_version_id=base_parameter_version_id,
    )
    manual_candidate_id = updated_job["candidates"][-1]["id"]

    revised = create_momentum_strategy(
        client,
        mode="REVISION",
        base_strategy_id=strategy["id"],
        base_parameter_version_id=base_parameter_version_id,
        top_n=11,
        idempotency_key="materialize-candidate-stability-revision",
    )["strategy"]
    refreshed_job = assert_ok(client.get(f"/optimization-jobs/{job['id']}/detail"))
    manual_candidate = next(candidate for candidate in refreshed_job["candidates"] if candidate["id"] == manual_candidate_id)

    assert revised["current_parameter_version_id"] != base_parameter_version_id
    assert manual_candidate["parameter_snapshot"] == manual_snapshot
    assert manual_candidate["base_parameter_version_id"] == base_parameter_version_id


def test_promote_trial_set_current_appends_parameter_version_when_base_matches(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="materialize-base-promote-success")
    strategy = base["strategy"]
    base_parameter_version_id = strategy["current_parameter_version_id"]
    job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=base_parameter_version_id,
    )
    candidate = job["candidates"][0]

    promoted = assert_ok(
        client.post(
            f"/optimization-jobs/{job['id']}/candidates/{candidate['id']}/promote",
            json={
                "idempotency_key": "promote-success-1",
                "mode": "set_current",
                "base_parameter_version_id": base_parameter_version_id,
            },
        )
    )

    assert promoted["id"] == strategy["id"]
    assert promoted["current_parameter_version"] == 2
    assert promoted["parameters"] == candidate["parameter_snapshot"]
    assert promoted["parameter_history"][-1]["parameter_version_id"] == promoted["current_parameter_version_id"]


def _insert_backtest_run(
    client,
    *,
    run_id: str,
    strategy_id: str,
    created_at: str,
    is_permanent: int,
    artifact_paths: list[str],
) -> None:
    service = client.app.state.service
    service.storage.insert_json_row(
        "backtest_runs",
        {
            "id": run_id,
            "strategy_id": strategy_id,
            "status": "COMPLETED",
            "request_kind": "official",
            "is_permanent": is_permanent,
            "start_date": "2026-03-01",
            "end_date": "2026-03-15",
            "warnings_json": "[]",
            "request_json": "{}",
            "preview_json": "{}",
            "metrics_json": "{}",
            "parameter_snapshot_json": "{}",
            "environment_summary_json": "{}",
            "relative_metrics_json": "{}",
            "consistency_score_json": "{}",
            "risk_metrics_json": "{}",
            "drawdown_events_json": "[]",
            "rolling_metrics_json": "[]",
            "monthly_returns_json": "[]",
            "chart_series_json": "[]",
            "trades_json": "[]",
            "artifact_paths_json": str(artifact_paths).replace("'", '"'),
            "trade_audit_json": "[]",
            "trades_count": 0,
            "created_at": created_at,
            "updated_at": created_at,
            "completed_at": created_at,
        },
    )


def test_purge_expired_temporary_runs_deletes_only_old_temporary_runs_and_artifacts(tmp_path):
    client, db_path = create_test_client(tmp_path)
    strategy = create_momentum_strategy(client, idempotency_key="cleanup-base")["strategy"]
    service = client.app.state.service
    workspace_root = Path(db_path).parent
    old_created_at = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat(timespec="seconds").replace("+00:00", "Z")
    fresh_created_at = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(timespec="seconds").replace("+00:00", "Z")

    temp_old_run_id = "run_temp_old"
    temp_fresh_run_id = "run_temp_fresh"
    permanent_old_run_id = "run_perm_old"

    temp_old_file = workspace_root / "temp-artifacts" / "temp-old.html"
    temp_old_plot_dir = workspace_root / "web" / "dist" / "plots" / temp_old_run_id
    temp_fresh_file = workspace_root / "temp-artifacts" / "temp-fresh.html"
    permanent_old_file = workspace_root / "temp-artifacts" / "perm-old.html"

    temp_old_file.parent.mkdir(parents=True, exist_ok=True)
    temp_old_file.write_text("old", encoding="utf-8")
    temp_old_plot_dir.mkdir(parents=True, exist_ok=True)
    (temp_old_plot_dir / "plot.html").write_text("plot", encoding="utf-8")
    temp_fresh_file.write_text("fresh", encoding="utf-8")
    permanent_old_file.write_text("permanent", encoding="utf-8")

    _insert_backtest_run(
        client,
        run_id=temp_old_run_id,
        strategy_id=strategy["id"],
        created_at=old_created_at,
        is_permanent=0,
        artifact_paths=[str(temp_old_file)],
    )
    _insert_backtest_run(
        client,
        run_id=temp_fresh_run_id,
        strategy_id=strategy["id"],
        created_at=fresh_created_at,
        is_permanent=0,
        artifact_paths=[str(temp_fresh_file)],
    )
    _insert_backtest_run(
        client,
        run_id=permanent_old_run_id,
        strategy_id=strategy["id"],
        created_at=old_created_at,
        is_permanent=1,
        artifact_paths=[str(permanent_old_file)],
    )

    removed = service.purge_expired_temporary_runs()
    overview = assert_ok(client.get("/workspace/overview?include_cleanup_audit=1"))
    runs = assert_ok(client.get("/backtest-runs"))

    assert removed == 1
    assert overview["last_cleanup_count"] == 1
    assert temp_old_run_id not in [run["id"] for run in runs]
    assert temp_fresh_run_id in [run["id"] for run in runs]
    assert permanent_old_run_id in [run["id"] for run in runs]
    assert not temp_old_file.exists()
    assert not temp_old_plot_dir.exists()
    assert temp_fresh_file.exists()
    assert permanent_old_file.exists()


def test_delete_optimization_candidate_reorders_ranks_and_returns_updated_job_detail(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="materialize-base-delete")
    strategy = base["strategy"]
    base_parameter_version_id = strategy["current_parameter_version_id"]
    job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=base_parameter_version_id,
    )
    created = create_optimization_candidate(
        client,
        job["id"],
        label="Delete me",
        parameter_snapshot={**strategy["parameters"], "top_n": 9},
        base_parameter_version_id=base_parameter_version_id,
    )
    trial_id = next(candidate["id"] for candidate in created["candidates"] if candidate["label"] == "Delete me")

    updated = assert_ok(client.delete(f"/optimization-jobs/{job['id']}/candidates/{trial_id}"))

    assert updated["summary"]["candidate_count"] == 1
    assert [candidate["rank"] for candidate in updated["candidates"]] == [1]
    assert updated["candidates"][0]["id"] != trial_id
    assert updated["result"]["best_candidate_id"] == updated["candidates"][0]["id"]


def test_promote_trial_persists_comment_into_parameter_version_history(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="materialize-base-comment")
    strategy = base["strategy"]
    base_parameter_version_id = strategy["current_parameter_version_id"]
    job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=base_parameter_version_id,
    )
    candidate = job["candidates"][0]
    comment = "Adjusted stop loss for volatility"

    promoted = assert_ok(
        client.post(
            f"/optimization-jobs/{job['id']}/candidates/{candidate['id']}/promote",
            json={
                "idempotency_key": "promote-comment-1",
                "mode": "set_current",
                "base_parameter_version_id": base_parameter_version_id,
                "comment": comment,
            },
        )
    )

    service = client.app.state.service
    version_row = service.storage.fetch_one(
        "SELECT comment FROM strategy_parameter_versions WHERE strategy_id = ? AND version_number = ?",
        (strategy["id"], promoted["current_parameter_version"]),
    )

    assert promoted["parameter_history"][-1]["comment"] == comment
    assert version_row is not None
    assert version_row["comment"] == comment

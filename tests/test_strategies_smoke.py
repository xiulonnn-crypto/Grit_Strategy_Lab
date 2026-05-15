from fastapi.testclient import TestClient

import json
import sqlite3

from grit_backtest_platform.api import create_app
from tests.api_test_support import assert_ok, create_grid_strategy


def test_list_strategies_returns_200(tmp_path):
    client = TestClient(create_app(tmp_path / 'grit_backtest.sqlite3'))

    response = client.get('/strategies')

    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_strategy_library_returns_strategy_and_run_lists_once(tmp_path):
    db_path = tmp_path / 'grit_backtest.sqlite3'
    client = TestClient(create_app(db_path))
    created = create_grid_strategy(client, idempotency_key='strategy-library-list')["strategy"]
    strategy_id = created["id"]
    parameter_version_id = created["current_parameter_version_id"]
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            INSERT INTO backtest_runs (
                id, strategy_id, status, request_kind, is_permanent,
                start_date, end_date, effective_date, oos_start_date,
                coverage_ratio, coverage_days, warnings_json, request_json,
                preview_json, metrics_json, parameter_snapshot_json,
                environment_summary_json, relative_metrics_json, consistency_score_json,
                risk_metrics_json, drawdown_events_json, rolling_metrics_json,
                monthly_returns_json, chart_series_json, trades_json, artifact_paths_json,
                trade_audit_items_json, trade_audit_json, trades_count,
                created_at, updated_at, completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "run_strategy_library_10y",
                strategy_id,
                "COMPLETED",
                "official",
                1,
                "2016-03-24",
                "2026-03-24",
                "2016-03-24",
                "2024-03-21",
                1.0,
                2520,
                "[]",
                json.dumps({"parameter_version_id": parameter_version_id}),
                json.dumps({"parameter_version_id": parameter_version_id}),
                json.dumps({"annualized_return": 0.101, "sharpe": 1.18, "max_drawdown": -0.064}),
                "{}",
                "{}",
                "{}",
                "{}",
                "{}",
                "[]",
                "[]",
                "[]",
                "[]",
                "[]",
                "[]",
                "[]",
                "[]",
                42,
                "2026-04-28T13:22:00Z",
                "2026-04-28T13:22:00Z",
                "2026-04-28T13:22:00Z",
            ),
        )

    payload = assert_ok(client.get('/strategy-library'))

    assert set(payload) == {"strategies", "runs"}
    assert isinstance(payload["runs"], list)
    assert created["id"] in [item["id"] for item in payload["strategies"]]
    library_run = next(item for item in payload["runs"] if item["id"] == "run_strategy_library_10y")
    assert library_run["metrics"]["max_drawdown"] == -0.064


def test_archived_strategies_are_hidden_from_library_and_workspace_count(tmp_path):
    client = TestClient(create_app(tmp_path / 'grit_backtest.sqlite3'))
    created = create_grid_strategy(client, idempotency_key='archive-strategy-list')["strategy"]

    archived = assert_ok(
        client.patch(
            f"/strategies/{created['id']}",
            json={"lifecycle_status": "ARCHIVED"},
        )
    )
    strategies = assert_ok(client.get('/strategies'))
    overview = assert_ok(client.get('/workspace/overview'))

    assert archived["lifecycle_status"] == "ARCHIVED"
    assert created["id"] not in [item["id"] for item in strategies]
    assert overview["strategy_count"] == 0
    assert overview["latest_strategy_id"] is None


def test_strategy_archive_preview_blocks_active_strategy_leg_references(tmp_path):
    db_path = tmp_path / 'grit_backtest.sqlite3'
    client = TestClient(create_app(db_path))
    created = create_grid_strategy(client, idempotency_key='archive-strategy-reference')["strategy"]
    strategy_id = created["id"]
    parameter_version_id = created["current_parameter_version_id"]
    source_ref_id = f"strategy_leg::{strategy_id}::{parameter_version_id}"

    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            INSERT INTO compositions (
                id, name, status, benchmark_definition_json, cost_policy_json,
                summary_json, analysis_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "composition_strategy_reference",
                "Referenced composition",
                "ACTIVE",
                "{}",
                "{}",
                "{}",
                "{}",
                "2026-05-15T08:00:00Z",
                "2026-05-15T08:00:00Z",
            ),
        )
        connection.execute(
            """
            INSERT INTO composition_legs (
                id, composition_id, leg_kind, source_ref_id, source_ref_type,
                display_name, weight_pct, ordering, config_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "composition_leg_strategy_reference",
                "composition_strategy_reference",
                "strategy",
                source_ref_id,
                "strategy_projection",
                "Referenced strategy leg",
                100.0,
                1,
                "{}",
                "2026-05-15T08:00:00Z",
                "2026-05-15T08:00:00Z",
            ),
        )

    preview = assert_ok(client.get(f"/strategies/{strategy_id}/archive-preview"))
    blocked = client.post(f"/strategies/{strategy_id}/archive", json={"confirm": True})

    assert preview["can_archive"] is False
    assert preview["reference_count"] == 1
    assert preview["strategy_leg_reference_counts"][source_ref_id] == 1
    assert blocked.status_code == 409
    assert blocked.json()["blocking_code"] == "strategy_leg_reference_protected"


def test_strategy_archive_logically_deletes_runs_and_optimization_jobs(tmp_path):
    db_path = tmp_path / 'grit_backtest.sqlite3'
    client = TestClient(create_app(db_path))
    created = create_grid_strategy(client, idempotency_key='archive-strategy-cascade')["strategy"]
    strategy_id = created["id"]
    parameter_version_id = created["current_parameter_version_id"]

    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            INSERT INTO backtest_runs (
                id, strategy_id, status, request_kind, is_permanent,
                start_date, end_date, request_json, preview_json, metrics_json,
                created_at, updated_at, completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "run_archive_cascade",
                strategy_id,
                "COMPLETED",
                "official",
                1,
                "2016-03-24",
                "2026-03-24",
                json.dumps({"parameter_version_id": parameter_version_id}),
                json.dumps({"parameter_version_id": parameter_version_id}),
                json.dumps({"annualized_return": 0.101, "sharpe": 1.18}),
                "2026-05-15T08:00:00Z",
                "2026-05-15T08:00:00Z",
                "2026-05-15T08:00:00Z",
            ),
        )
        connection.execute(
            """
            INSERT INTO optimization_jobs (
                id, strategy_id, status, request_json, summary_json, result_json,
                candidates_json, created_at, updated_at, completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "opt_archive_cascade",
                strategy_id,
                "COMPLETED",
                "{}",
                "{}",
                "{}",
                "[]",
                "2026-05-15T08:00:00Z",
                "2026-05-15T08:00:00Z",
                "2026-05-15T08:00:00Z",
            ),
        )

    preview = assert_ok(client.get(f"/strategies/{strategy_id}/archive-preview"))
    archived = assert_ok(client.post(f"/strategies/{strategy_id}/archive", json={"confirm": True}))
    strategies = assert_ok(client.get("/strategies"))
    library = assert_ok(client.get("/strategy-library"))

    assert preview["can_archive"] is True
    assert preview["backtest_run_count"] == 1
    assert preview["optimization_job_count"] == 1
    assert archived["status"] == "ARCHIVED"
    assert archived["deleted_backtest_run_count"] == 1
    assert archived["deleted_optimization_job_count"] == 1
    assert strategy_id not in [item["id"] for item in strategies]
    assert strategy_id not in [item["id"] for item in library["strategies"]]
    assert "run_archive_cascade" not in [item["id"] for item in library["runs"]]

    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        strategy_row = connection.execute(
            "SELECT lifecycle_status FROM strategies WHERE id = ?",
            (strategy_id,),
        ).fetchone()
        run_row = connection.execute(
            "SELECT status, deleted_at, deleted_reason FROM backtest_runs WHERE id = ?",
            ("run_archive_cascade",),
        ).fetchone()
        job_row = connection.execute(
            "SELECT status, deleted_at, deleted_reason FROM optimization_jobs WHERE id = ?",
            ("opt_archive_cascade",),
        ).fetchone()

    assert strategy_row["lifecycle_status"] == "ARCHIVED"
    assert run_row["status"] == "DELETED"
    assert run_row["deleted_at"] is not None
    assert run_row["deleted_reason"] == "strategy_archived"
    assert job_row["status"] == "DELETED"
    assert job_row["deleted_at"] is not None
    assert job_row["deleted_reason"] == "strategy_archived"


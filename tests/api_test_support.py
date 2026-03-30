from __future__ import annotations

from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi.testclient import TestClient

from grit_backtest_platform.api import create_app


EXPECTED_WORKSPACE_OVERVIEW_KEYS = {
    "workspace_name",
    "subtitle",
    "strategy_count",
    "active_run_count",
    "running_optimization_count",
    "latest_strategy_id",
    "latest_backtest_run_id",
    "latest_optimization_job_id",
    "top_momentum_warning",
    "quick_actions",
}

GRID_MESSAGE = "grid strategy for QQQ"
MOMENTUM_MESSAGE = "momentum strategy for SPY equal 01/01 07/01"


def create_test_client(tmp_path: Path) -> tuple[TestClient, Path]:
    db_path = tmp_path / "test_backtest.db"
    return TestClient(create_app(db_path)), db_path


def assert_ok(response) -> dict[str, Any]:
    assert response.status_code == 200, response.text
    return response.json()


def assert_workspace_overview_contract(payload: dict[str, Any], *, include_cleanup_audit: bool = False) -> None:
    expected_keys = set(EXPECTED_WORKSPACE_OVERVIEW_KEYS)
    if include_cleanup_audit:
        expected_keys.add("last_cleanup_count")
    assert set(payload.keys()) == expected_keys
    assert len(payload) == len(expected_keys)


def momentum_confirmation_payload(
    *,
    revision: int,
    universe_name: str = "SPY",
    rebalance_frequency: str = "monthly",
    lookback_months: int = 6,
    skip_recent_months: int = 1,
    top_n: int = 1,
    weighting_method: str = "equal_weight",
    rebalance_anchor_dates: str = "01-01,07-01",
) -> dict[str, Any]:
    return {
        "revision": revision,
        "strategy_type": "MOMENTUM",
        "core": {
            "universe_name": universe_name,
            "rebalance_frequency": rebalance_frequency,
        },
        "logic": {},
        "parameters": {
            "lookback_months": lookback_months,
            "skip_recent_months": skip_recent_months,
            "top_n": top_n,
            "weighting_method": weighting_method,
            "rebalance_anchor_dates": rebalance_anchor_dates,
        },
    }


def grid_confirmation_payload(
    *,
    revision: int,
    universe_name: str = "QQQ",
    initial_position: int = 10,
    grid_interval: int = 2,
    buy_size_pct: int = 5,
    sell_step_pct: int = 5,
    sell_size_pct: int = 5,
    capital: int = 100000,
) -> dict[str, Any]:
    return {
        "revision": revision,
        "strategy_type": "GRID",
        "core": {
            "universe_name": universe_name,
        },
        "logic": {},
        "parameters": {
            "initial_position": initial_position,
            "grid_interval": grid_interval,
            "buy_size_pct": buy_size_pct,
            "sell_step_pct": sell_step_pct,
            "sell_size_pct": sell_size_pct,
            "capital": capital,
        },
    }


def draft_strategy_session(
    client: TestClient,
    *,
    strategy_type: str,
    message: str,
    confirmation_payload: dict[str, Any],
    mode: str = "CREATE",
    base_strategy_id: str | None = None,
    base_parameter_version_id: str | None = None,
) -> dict[str, Any]:
    session_create_payload: dict[str, Any] = {
        "strategy_type": strategy_type,
        "mode": mode,
    }
    if base_strategy_id:
        session_create_payload["base_strategy_id"] = base_strategy_id
    if base_parameter_version_id:
        session_create_payload["base_parameter_version_id"] = base_parameter_version_id
    created = assert_ok(client.post("/strategy-creation-sessions", json=session_create_payload))
    session_id = created["id"]
    appended = assert_ok(
        client.post(
            f"/strategy-creation-sessions/{session_id}/messages",
            json={"content": message},
        )
    )
    hydrated = assert_ok(client.get(f"/strategy-creation-sessions/{session_id}"))
    prepared = assert_ok(client.post(f"/strategy-creation-sessions/{session_id}/prepare-confirmation", json={}))
    patched_payload = dict(confirmation_payload)
    patched_payload["revision"] = int(prepared["revision"])
    confirmed = assert_ok(
        client.patch(
            f"/strategy-creation-sessions/{session_id}/confirmation",
            json=patched_payload,
        )
    )
    return {
        "session_id": session_id,
        "created": created,
        "appended": appended,
        "hydrated": hydrated,
        "prepared": prepared,
        "confirmed": confirmed,
    }


def materialize_session(
    client: TestClient,
    session_id: str,
    *,
    idempotency_key: str | None = None,
    name: str | None = None,
    description: str | None = None,
    base_parameter_version_id: str | None = None,
):
    payload: dict[str, Any] = {
        "idempotency_key": idempotency_key or f"materialize-{uuid4().hex[:8]}",
    }
    if name is not None:
        payload["name"] = name
    if description is not None:
        payload["description"] = description
    if base_parameter_version_id is not None:
        payload["base_parameter_version_id"] = base_parameter_version_id
    return client.post(f"/strategy-creation-sessions/{session_id}/materialize", json=payload)


def create_momentum_strategy(
    client: TestClient,
    *,
    mode: str = "CREATE",
    base_strategy_id: str | None = None,
    base_parameter_version_id: str | None = None,
    universe_name: str = "SPY",
    rebalance_frequency: str = "monthly",
    lookback_months: int = 6,
    skip_recent_months: int = 1,
    top_n: int = 1,
    weighting_method: str = "equal_weight",
    rebalance_anchor_dates: str = "01-01,07-01",
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    session = draft_strategy_session(
        client,
        strategy_type="MOMENTUM",
        message=MOMENTUM_MESSAGE,
        confirmation_payload=momentum_confirmation_payload(
            revision=1,
            universe_name=universe_name,
            rebalance_frequency=rebalance_frequency,
            lookback_months=lookback_months,
            skip_recent_months=skip_recent_months,
            top_n=top_n,
            weighting_method=weighting_method,
            rebalance_anchor_dates=rebalance_anchor_dates,
        ),
        mode=mode,
        base_strategy_id=base_strategy_id,
        base_parameter_version_id=base_parameter_version_id,
    )
    materialized = assert_ok(
        materialize_session(
            client,
            session["session_id"],
            idempotency_key=idempotency_key,
            base_parameter_version_id=base_parameter_version_id,
        )
    )
    return {**session, "strategy": materialized}


def create_grid_strategy(
    client: TestClient,
    *,
    universe_name: str = "QQQ",
    initial_position: int = 10,
    grid_interval: int = 2,
    buy_size_pct: int = 5,
    sell_step_pct: int = 5,
    sell_size_pct: int = 5,
    capital: int = 100000,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    session = draft_strategy_session(
        client,
        strategy_type="GRID",
        message=GRID_MESSAGE,
        confirmation_payload=grid_confirmation_payload(
            revision=1,
            universe_name=universe_name,
            initial_position=initial_position,
            grid_interval=grid_interval,
            buy_size_pct=buy_size_pct,
            sell_step_pct=sell_step_pct,
            sell_size_pct=sell_size_pct,
            capital=capital,
        ),
    )
    materialized = assert_ok(materialize_session(client, session["session_id"], idempotency_key=idempotency_key))
    return {**session, "strategy": materialized}


def create_optimization_job(
    client: TestClient,
    strategy_id: str,
    *,
    objective: str = "sharpe",
    base_parameter_version_id: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"objective": objective}
    if base_parameter_version_id is not None:
        payload["base_parameter_version_id"] = base_parameter_version_id
    return assert_ok(client.post(f"/strategies/{strategy_id}/optimization-jobs", json=payload))


def create_optimization_candidate(
    client: TestClient,
    job_id: str,
    *,
    parameter_snapshot: dict[str, Any],
    label: str | None = None,
    base_parameter_version_id: str | None = None,
    metrics: dict[str, float] | None = None,
    summary: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "parameter_snapshot": parameter_snapshot,
    }
    if label is not None:
        payload["label"] = label
    if base_parameter_version_id is not None:
        payload["base_parameter_version_id"] = base_parameter_version_id
    if metrics is not None:
        payload["metrics"] = metrics
    if summary is not None:
        payload["summary"] = summary
    return assert_ok(client.post(f"/optimization-jobs/{job_id}/candidates", json=payload))


def refresh_snapshots(client: TestClient) -> dict[str, Any]:
    return assert_ok(client.post("/admin/snapshot-refresh-jobs", json={}))


def preview_backtest(
    client: TestClient,
    strategy_id: str,
    *,
    start_date: str,
    end_date: str,
    data_segment_type: str | None = None,
    parameter_version_id: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"start_date": start_date, "end_date": end_date}
    if data_segment_type is not None:
        payload["data_segment_type"] = data_segment_type
    if parameter_version_id is not None:
        payload["parameter_version_id"] = parameter_version_id
    return assert_ok(client.post(f"/strategies/{strategy_id}/backtest-runs/preview", json=payload))


def submit_backtest(
    client: TestClient,
    strategy_id: str,
    *,
    start_date: str,
    end_date: str,
    data_segment_type: str | None = None,
    parameter_version_id: str | None = None,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "idempotency_key": idempotency_key or f"run-{uuid4().hex[:8]}",
        "start_date": start_date,
        "end_date": end_date,
    }
    if data_segment_type is not None:
        payload["data_segment_type"] = data_segment_type
    if parameter_version_id is not None:
        payload["parameter_version_id"] = parameter_version_id
    return assert_ok(client.post(f"/strategies/{strategy_id}/backtest-runs", json=payload))

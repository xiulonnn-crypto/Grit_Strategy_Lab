from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path
import time
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

from fastapi.testclient import TestClient

from grit_backtest_platform.api import create_app
from grit_backtest_platform.universe_history import (
    ANCHOR_SCHEDULE,
    NASDAQ100_UNIVERSE_KEY,
    NASDAQ100_UNIVERSE_NAME,
    SP500_UNIVERSE_KEY,
    SP500_UNIVERSE_NAME,
    UniverseMembershipSnapshot,
    semiannual_anchor_dates,
)


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
BUY_AND_HOLD_MESSAGE = "QQQ monthly dca strategy"

EXPECTED_SNAPSHOT_OVERVIEW_KEYS = {
    "overall_status",
    "last_refreshed_at",
    "dataset_snapshots",
    "universe_snapshots",
    "latest_job",
    "blocking_code",
    "blocking_target",
    "message",
    "allowed_actions",
    "bond_fixed_income",
}


class FakeMarketDataProvider:
    provider_name = "fake_yahoo"

    def __init__(self) -> None:
        self.fallback_provider = None
        self.universe_history_providers = [
            FakeUniverseHistoryProvider(
                universe_key=SP500_UNIVERSE_KEY,
                universe_name=SP500_UNIVERSE_NAME,
                symbols=["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "AVGO", "COST"],
            ),
            FakeUniverseHistoryProvider(
                universe_key=NASDAQ100_UNIVERSE_KEY,
                universe_name=NASDAQ100_UNIVERSE_NAME,
                symbols=["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "AMD", "NFLX"],
            ),
        ]

    def fetch_history(self, symbol: str, start_date: date, end_date: date) -> Any:
        effective_start = max(start_date, date(2024, 1, 1))
        bars = []
        cursor = effective_start
        price = 100.0 + (sum(ord(char) for char in symbol) % 17)
        day_index = 0
        while cursor <= end_date:
            if cursor.weekday() < 5:
                open_price = price
                close_price = round(open_price * (1.0 + 0.0007 + (day_index % 5) * 0.0001), 4)
                high_price = round(max(open_price, close_price) * 1.002, 4)
                low_price = round(min(open_price, close_price) * 0.998, 4)
                bars.append(
                    SimpleNamespace(
                        date=cursor.isoformat(),
                        open=round(open_price, 4),
                        high=high_price,
                        low=low_price,
                        close=close_price,
                        adj_close=close_price,
                        volume=float(1_000_000 + day_index * 100),
                    )
                )
                price = close_price
                day_index += 1
            cursor += timedelta(days=1)
        actions = [
            {"date": effective_start.isoformat(), "action_type": "dividend", "value": 0.25, "source": self.provider_name, "payload": {"amount": 0.25}},
            {"date": (effective_start + timedelta(days=30)).isoformat(), "action_type": "split", "value": 2.0, "source": self.provider_name, "payload": {"split_ratio": 2.0}},
            {"date": (effective_start + timedelta(days=60)).isoformat(), "action_type": "earnings", "value": None, "source": self.provider_name, "payload": {"reported": True}},
        ]
        return SimpleNamespace(
            symbol=symbol,
            bars=bars,
            actions=actions,
            source=self.provider_name,
            fallback_source=None,
            partial=False,
            warnings=[],
            metadata={"provider": self.provider_name, "bar_count": len(bars), "actions_partial": False},
        )


class FakeUniverseHistoryProvider:
    provider_name = "test_revision_history"

    def __init__(self, *, universe_key: str, universe_name: str, symbols: list[str]) -> None:
        self.universe_key = universe_key
        self.universe_name = universe_name
        self.symbols = list(symbols)

    def load_snapshots(self, start_date: date, end_date: date) -> list[UniverseMembershipSnapshot]:
        snapshots: list[UniverseMembershipSnapshot] = []
        for anchor in semiannual_anchor_dates(start_date, end_date):
            snapshots.append(
                UniverseMembershipSnapshot(
                    universe_key=self.universe_key,
                    universe_name=self.universe_name,
                    effective_date=anchor,
                    normalized_symbols=list(self.symbols),
                    raw_symbols=list(self.symbols),
                    unmapped_symbols=[],
                    source=self.provider_name,
                    fallback_source=None,
                    anchor_schedule=ANCHOR_SCHEDULE,
                    source_revision_id=f"{self.provider_name}-{anchor.isoformat()}",
                    source_page_title=f"{self.universe_name} test page",
                    metadata={
                        "coverage_mode": "point_in_time_anchor",
                        "source_quality": "historical_revision_snapshot",
                        "anchor_mode": "test_complete_history",
                    },
                )
            )
        return snapshots


def create_test_client(tmp_path: Path) -> tuple[TestClient, Path]:
    db_path = tmp_path / "test_backtest.db"
    return TestClient(create_app(db_path, market_data_provider=FakeMarketDataProvider())), db_path


def assert_ok(response) -> dict[str, Any]:
    assert response.status_code == 200, response.text
    return response.json()


def assert_workspace_overview_contract(payload: dict[str, Any], *, include_cleanup_audit: bool = False) -> None:
    expected_keys = set(EXPECTED_WORKSPACE_OVERVIEW_KEYS)
    if include_cleanup_audit:
        expected_keys.add("last_cleanup_count")
    assert set(payload.keys()) == expected_keys
    assert len(payload) == len(expected_keys)


def assert_snapshot_overview_contract(payload: dict[str, Any]) -> None:
    assert set(payload.keys()) == EXPECTED_SNAPSHOT_OVERVIEW_KEYS
    assert len(payload) == len(EXPECTED_SNAPSHOT_OVERVIEW_KEYS)


def momentum_confirmation_payload(
    *,
    revision: int,
    universe_name: str = "SPY",
    rebalance_frequency: str = "monthly",
    strategy_name: str = "SPY 动量策略",
    strategy_description: str = "围绕SPY执行动量轮动。",
    benchmark_symbol: str = "SPY",
    lookback_months: int = 6,
    skip_recent_months: int = 1,
    top_n: int = 1,
    hold_rank_threshold: int = 2,
    weighting_method: str = "equal_weight",
    rebalance_anchor_dates: str = "01-01,07-01",
    capital: int = 100000,
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
            "strategy_name": strategy_name,
            "strategy_description": strategy_description,
            "benchmark_symbol": benchmark_symbol,
            "lookback_months": lookback_months,
            "skip_recent_months": skip_recent_months,
            "top_n": top_n,
            "hold_rank_threshold": hold_rank_threshold,
            "weighting_method": weighting_method,
            "rebalance_anchor_dates": rebalance_anchor_dates,
            "capital": capital,
        },
    }


def grid_confirmation_payload(
    *,
    revision: int,
    universe_name: str = "QQQ",
    strategy_name: str = "QQQ 网格交易策略",
    strategy_description: str = "围绕QQQ做网格轮动。",
    benchmark_symbol: str = "SPY",
    rebalance_frequency: str = "never",
    initial_position: int = 10,
    grid_interval: int = 2,
    buy_size_pct: int = 5,
    sell_step_pct: int = 5,
    sell_size_pct: int = 5,
    max_stop_loss_pct: int = -4,
    capital: int = 100000,
) -> dict[str, Any]:
    return {
        "revision": revision,
        "strategy_type": "GRID",
        "core": {
            "universe_name": universe_name,
            "rebalance_frequency": rebalance_frequency,
        },
        "logic": {},
        "parameters": {
            "strategy_name": strategy_name,
            "strategy_description": strategy_description,
            "benchmark_symbol": benchmark_symbol,
            "initial_position": initial_position,
            "grid_interval": grid_interval,
            "buy_size_pct": buy_size_pct,
            "sell_step_pct": sell_step_pct,
            "sell_size_pct": sell_size_pct,
            "max_stop_loss_pct": max_stop_loss_pct,
            "capital": capital,
        },
    }


def buy_and_hold_confirmation_payload(
    *,
    revision: int,
    universe_name: str = "QQQ",
    strategy_name: str = "QQQ 月度定投策略",
    strategy_description: str = "围绕QQQ执行月度定投，每期买入1000USD，按每期首个交易日执行。",
    benchmark_symbol: str = "QQQ",
    contribution_amount: int = 1000,
    investment_frequency: str = "monthly",
) -> dict[str, Any]:
    return {
        "revision": revision,
        "strategy_type": "BUY_AND_HOLD",
        "core": {
            "universe_name": universe_name,
            "rebalance_frequency": "never",
        },
        "logic": {},
        "parameters": {
            "strategy_name": strategy_name,
            "strategy_description": strategy_description,
            "benchmark_symbol": benchmark_symbol,
            "contribution_amount": contribution_amount,
            "investment_frequency": investment_frequency,
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
    strategy_name: str = "QQQ 网格交易策略",
    strategy_description: str = "围绕QQQ做网格轮动。",
    benchmark_symbol: str = "SPY",
    rebalance_frequency: str = "never",
    initial_position: int = 10,
    grid_interval: int = 2,
    buy_size_pct: int = 5,
    sell_step_pct: int = 5,
    sell_size_pct: int = 5,
    max_stop_loss_pct: int = -4,
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
            strategy_name=strategy_name,
            strategy_description=strategy_description,
            benchmark_symbol=benchmark_symbol,
            rebalance_frequency=rebalance_frequency,
            initial_position=initial_position,
            grid_interval=grid_interval,
            buy_size_pct=buy_size_pct,
            sell_step_pct=sell_step_pct,
            sell_size_pct=sell_size_pct,
            max_stop_loss_pct=max_stop_loss_pct,
            capital=capital,
        ),
    )
    materialized = assert_ok(materialize_session(client, session["session_id"], idempotency_key=idempotency_key))
    return {**session, "strategy": materialized}


def create_buy_and_hold_strategy(
    client: TestClient,
    *,
    universe_name: str = "QQQ",
    strategy_name: str = "QQQ 月度定投策略",
    strategy_description: str = "围绕QQQ执行月度定投，每期买入1000USD，按每期首个交易日执行。",
    benchmark_symbol: str = "QQQ",
    contribution_amount: int = 1000,
    investment_frequency: str = "monthly",
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    session = draft_strategy_session(
        client,
        strategy_type="BUY_AND_HOLD",
        message=BUY_AND_HOLD_MESSAGE,
        confirmation_payload=buy_and_hold_confirmation_payload(
            revision=1,
            universe_name=universe_name,
            strategy_name=strategy_name,
            strategy_description=strategy_description,
            benchmark_symbol=benchmark_symbol,
            contribution_amount=contribution_amount,
            investment_frequency=investment_frequency,
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
    source_run_id: str | None = None,
    entry_point: str | None = None,
    validation_mode: str | None = None,
    budget_combinations: int | None = None,
    search_space: list[dict[str, Any]] | None = None,
    constraint_preset_key: str | None = None,
    constraint_label: str | None = None,
    constraints: list[dict[str, Any]] | None = None,
    wait_until_complete: bool = True,
    timeout_seconds: float = 5.0,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"objective": objective}
    if budget_combinations is None and search_space is None:
        budget_combinations = 4
    if base_parameter_version_id is not None:
        payload["base_parameter_version_id"] = base_parameter_version_id
    if source_run_id is not None:
        payload["source_run_id"] = source_run_id
    if entry_point is not None:
        payload["entry_point"] = entry_point
    if validation_mode is not None:
        payload["validation_mode"] = validation_mode
    if budget_combinations is not None:
        payload["budget_combinations"] = budget_combinations
    if search_space is not None:
        payload["search_space"] = search_space
    if constraint_preset_key is not None:
        payload["constraint_preset_key"] = constraint_preset_key
    if constraint_label is not None:
        payload["constraint_label"] = constraint_label
    if constraints is not None:
        payload["constraints"] = constraints
    created = assert_ok(client.post(f"/strategies/{strategy_id}/optimization-jobs", json=payload))
    if wait_until_complete and str(created.get("status") or "").upper() in {"QUEUED", "RUNNING"}:
        return wait_for_optimization_job(client, created["id"], timeout_seconds=timeout_seconds)
    return created


def wait_for_optimization_job(
    client: TestClient,
    job_id: str,
    *,
    timeout_seconds: float = 5.0,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    latest = assert_ok(client.get(f"/optimization-jobs/{job_id}/detail"))
    while time.monotonic() < deadline and str(latest.get("status") or "").upper() in {"QUEUED", "RUNNING"}:
        time.sleep(0.02)
        latest = assert_ok(client.get(f"/optimization-jobs/{job_id}/detail"))
    return latest


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


def refresh_snapshots(
    client: TestClient,
    *,
    reason: str | None = None,
    mode: str | None = None,
    targets: list[str] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    if reason is not None:
        payload["reason"] = reason
    if mode is not None:
        payload["mode"] = mode
    if targets is not None:
        payload["targets"] = targets
    return assert_ok(client.post("/admin/snapshot-refresh-jobs", json=payload))


def preview_backtest(
    client: TestClient,
    strategy_id: str,
    *,
    start_date: str,
    end_date: str,
    data_segment_type: str | None = None,
    parameter_version_id: str | None = None,
    fee_bps: float | None = None,
    slippage_bps: float | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"start_date": start_date, "end_date": end_date}
    if data_segment_type is not None:
        payload["data_segment_type"] = data_segment_type
    if parameter_version_id is not None:
        payload["parameter_version_id"] = parameter_version_id
    if fee_bps is not None:
        payload["fee_bps"] = fee_bps
    if slippage_bps is not None:
        payload["slippage_bps"] = slippage_bps
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
    fee_bps: float | None = None,
    slippage_bps: float | None = None,
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
    if fee_bps is not None:
        payload["fee_bps"] = fee_bps
    if slippage_bps is not None:
        payload["slippage_bps"] = slippage_bps
    submitted = assert_ok(client.post(f"/strategies/{strategy_id}/backtest-runs", json=payload))
    status = str(submitted.get("status") or "").upper()
    if status not in {"QUEUED", "RUNNING"}:
        return submitted

    run_id = str(submitted["id"])
    deadline = time.time() + 15.0
    latest = submitted
    while time.time() < deadline:
        latest = assert_ok(client.get(f"/backtest-runs/{run_id}/detail"))
        status = str(latest.get("status") or "").upper()
        if status not in {"QUEUED", "RUNNING"}:
            return latest
        time.sleep(0.05)
    raise AssertionError(f"Backtest run {run_id} did not finish within 15 seconds; latest status={status}")

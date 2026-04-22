from __future__ import annotations

from datetime import datetime, timezone
import json
from uuid import uuid4

from tests.api_test_support import assert_ok, create_momentum_strategy, create_test_client


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _seed_completed_run(client, strategy_id: str, parameter_version_id: str) -> str:
    run_id = f"run_{uuid4().hex[:10]}"
    timestamp = _iso_now()
    client.app.state.service.storage.insert_json_row(
        "backtest_runs",
        {
            "id": run_id,
            "strategy_id": strategy_id,
            "status": "COMPLETED",
            "request_json": json.dumps(
                {
                    "execution_policy": "T_CLOSE_TO_T1_OPEN",
                    "dataset_snapshot_id": "ds-price",
                    "universe_snapshot_id": "un-sp500",
                    "parameter_version_id": parameter_version_id,
                }
            ),
            "preview_json": json.dumps({"parameter_version_id": parameter_version_id}),
            "metrics_json": json.dumps(
                {
                    "total_return": 0.186,
                    "annualized_return": 0.114,
                    "sharpe": 1.23,
                    "max_drawdown": -0.082,
                    "oos_total_return": 0.051,
                    "oos_annualized_return": 0.041,
                    "oos_sharpe": 0.74,
                    "oos_max_drawdown": -0.035,
                }
            ),
            "warnings_json": json.dumps([]),
            "chart_series_json": json.dumps(
                [
                    {"trade_date": "2026-01-31", "equity": 100.0, "is_oos": False},
                    {"trade_date": "2026-02-28", "equity": 103.2, "is_oos": False},
                    {"trade_date": "2026-03-31", "equity": 106.8, "is_oos": True},
                ]
            ),
            "created_at": timestamp,
            "updated_at": timestamp,
            "completed_at": timestamp,
        },
    )
    return run_id


def _create_seed_legs(client):
    asset_leg = assert_ok(
        client.post(
            "/asset-legs",
            json={
                "name": "US Treasury ETF",
                "symbol": "IEF",
                "asset_kind": "BOND",
                "source_snapshot_id": "ds-price",
                "source_provider": "phase1_seed",
                "freeze_mode": "snapshot_locked",
                "notes": "Treasury ballast",
            },
        )
    )
    cash_leg = assert_ok(
        client.post(
            "/cash-legs",
            json={
                "name": "Cash Reserve",
                "cash_rule_kind": "TARGET_BUFFER",
                "buffer_bps": 35,
                "yield_source": "phase1_cash_proxy",
                "freeze_mode": "manual",
                "notes": "Settlement buffer",
            },
        )
    )
    return asset_leg, cash_leg


def test_leg_inventory_combines_strategy_projection_asset_and_cash_rows(tmp_path):
    client, _ = create_test_client(tmp_path)
    created = create_momentum_strategy(client, idempotency_key="composition-inventory-strategy")
    strategy = created["strategy"]
    run_id = _seed_completed_run(
        client,
        strategy["id"],
        strategy["current_parameter_version_id"],
    )
    asset_leg, cash_leg = _create_seed_legs(client)

    inventory = assert_ok(client.get("/leg-inventory"))

    assert inventory["counts"] == {"all": 3, "strategy": 1, "asset": 1, "cash": 1}
    strategy_row = next(row for row in inventory["rows"] if row["leg_type"] == "strategy")
    asset_row = next(row for row in inventory["rows"] if row["leg_type"] == "asset")
    cash_row = next(row for row in inventory["rows"] if row["leg_type"] == "cash")

    assert strategy_row["id"] == f"strategy_leg::{strategy['id']}::{strategy['current_parameter_version_id']}"
    assert strategy_row["proof_label"] == f"Latest eligible run {run_id}"
    assert strategy_row["is_orphan"] is False
    assert strategy_row["reference_count"] == 0
    assert strategy_row["config"]["parameter_version_id"] == strategy["current_parameter_version_id"]
    assert asset_row["id"] == asset_leg["id"]
    assert asset_row["config"]["source_snapshot_id"] == "ds-price"
    assert cash_row["id"] == cash_leg["id"]
    assert cash_row["config"]["buffer_bps"] == 35.0


def test_composition_preview_create_update_and_list_flow(tmp_path):
    client, _ = create_test_client(tmp_path)
    created = create_momentum_strategy(client, idempotency_key="composition-workflow-strategy")
    strategy = created["strategy"]
    _seed_completed_run(client, strategy["id"], strategy["current_parameter_version_id"])
    asset_leg, cash_leg = _create_seed_legs(client)

    inventory = assert_ok(client.get("/leg-inventory"))
    strategy_row = next(row for row in inventory["rows"] if row["leg_type"] == "strategy")

    preview_payload = {
        "name": "Balanced Overlay",
        "description": "Compose-first phase 1 validation",
        "benchmark_definition": {"label": "S&P 500", "symbol": "SPY"},
        "rebalance_frequency": "quarterly",
        "cost_policy": {
            "expense_ratio_bps": 11,
            "turnover_budget_bps": 42,
            "trade_cost_bps": 5,
        },
        "legs": [
            {
                "leg_kind": "strategy",
                "source_ref_id": strategy_row["id"],
                "weight_pct": 50,
                "weight_locked": True,
                "ordering": 1,
            },
            {
                "leg_kind": "asset",
                "source_ref_id": asset_leg["id"],
                "weight_pct": 30,
                "weight_locked": False,
                "ordering": 2,
            },
            {
                "leg_kind": "cash",
                "source_ref_id": cash_leg["id"],
                "weight_pct": 20,
                "weight_locked": False,
                "ordering": 3,
            },
        ],
    }

    preview = assert_ok(client.post("/compositions/preview", json=preview_payload))

    assert preview["weight_summary"]["total_weight_pct"] == 100.0
    assert preview["weight_summary"]["within_tolerance"] is True
    assert len(preview["normalized_legs"]) == 3
    assert len(preview["returns_preview"]) == 6
    assert len(preview["benchmark_series"]) == 6
    assert len(preview["spread_series"]) == 6
    assert len(preview["correlation_matrix"]) == 9
    assert len(preview["risk_contribution_preview"]) == 3
    assert len(preview["composition_score"]["factors"]) == 4

    created_composition = assert_ok(
        client.post("/compositions", json={**preview_payload, "status": "DRAFT"})
    )
    composition_id = created_composition["id"]

    assert created_composition["name"] == "Balanced Overlay"
    assert created_composition["status"] == "DRAFT"
    assert len(created_composition["source_evidence"]) == 3
    assert created_composition["hero_summary"]["benchmark_label"] == "S&P 500"
    assert created_composition["kpis"][0]["key"] == "composition_score"

    listed = assert_ok(client.get("/compositions"))
    list_item = next(item for item in listed if item["id"] == composition_id)
    assert list_item["leg_count"] == 3
    assert list_item["benchmark_label"] == "S&P 500"

    updated = assert_ok(
        client.patch(
            f"/compositions/{composition_id}",
            json={
                "name": "Balanced Overlay v2",
                "status": "ACTIVE",
                "legs": [
                    {
                        "leg_kind": "strategy",
                        "source_ref_id": strategy_row["id"],
                        "weight_pct": 45,
                        "weight_locked": True,
                        "ordering": 1,
                    },
                    {
                        "leg_kind": "asset",
                        "source_ref_id": asset_leg["id"],
                        "weight_pct": 35,
                        "weight_locked": False,
                        "ordering": 2,
                    },
                    {
                        "leg_kind": "cash",
                        "source_ref_id": cash_leg["id"],
                        "weight_pct": 20,
                        "weight_locked": False,
                        "ordering": 3,
                    },
                ],
            },
        )
    )

    assert updated["name"] == "Balanced Overlay v2"
    assert updated["status"] == "ACTIVE"
    assert updated["weight_summary"]["total_weight_pct"] == 100.0
    assert updated["normalized_legs"][0]["weight_pct"] == 45.0

    fetched = assert_ok(client.get(f"/compositions/{composition_id}"))
    assert fetched["id"] == composition_id
    assert fetched["name"] == "Balanced Overlay v2"
    assert fetched["status"] == "ACTIVE"
    assert len(fetched["source_evidence"]) == 3
    assert fetched["latest_activity_label"].startswith("Updated ")

    refreshed_inventory = assert_ok(client.get("/leg-inventory"))
    strategy_row_after = next(row for row in refreshed_inventory["rows"] if row["id"] == strategy_row["id"])
    assert strategy_row_after["reference_count"] == 1

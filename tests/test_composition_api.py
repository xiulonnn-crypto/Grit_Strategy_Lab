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


def _table_count(client, table_name: str) -> int:
    row = client.app.state.service.storage.fetch_one(f"SELECT COUNT(*) AS count FROM {table_name}")
    return int(row["count"])


def _seed_bond_snapshot(client, *, refresh_status: str = "READY", missing_fields: list[str] | None = None) -> str:
    return client.app.state.service.market_data_repository.upsert_bond_fixed_income_snapshot(
        {
            "id": "bond-fixture-us91282cgk18",
            "instrument_id": "US91282CGK18",
            "symbol": "T10Y",
            "isin": "US91282CGK18",
            "cusip": "91282CGK1",
            "name": "US Treasury 10Y Note",
            "instrument_type": "treasury",
            "currency": "USD",
            "snapshot_date": "2026-04-22",
            "maturity_date": "2036-02-15",
            "coupon_rate_pct": 4.125,
            "clean_price": 98.25,
            "net_price": 98.25,
            "dirty_price": 99.02,
            "full_price": 99.02,
            "accrued_interest": 0.77,
            "ytm_pct": 4.32,
            "duration": 8.1,
            "convexity": 0.82,
            "source": "bond_fixed_income",
            "refresh_status": refresh_status,
            "missing_fields": missing_fields or [],
            "inferred_fields": {"duration": "curve_fit"},
        }
    )


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


def test_leg_inventory_defaults_to_manual_asset_and_cash_rows_only(tmp_path):
    client, _ = create_test_client(tmp_path)
    created = create_momentum_strategy(client, idempotency_key="composition-inventory-strategy")
    strategy = created["strategy"]
    _seed_completed_run(
        client,
        strategy["id"],
        strategy["current_parameter_version_id"],
    )
    asset_leg, cash_leg = _create_seed_legs(client)

    inventory = assert_ok(client.get("/leg-inventory"))

    assert inventory["counts"] == {"all": 2, "strategy": 0, "asset": 1, "cash": 1}
    assert [row for row in inventory["rows"] if row["leg_type"] == "strategy"] == []
    asset_row = next(row for row in inventory["rows"] if row["leg_type"] == "asset")
    cash_row = next(row for row in inventory["rows"] if row["leg_type"] == "cash")

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
    strategy_leg_ref = f"strategy_leg::{strategy['id']}::{strategy['current_parameter_version_id']}"

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
                "source_ref_id": strategy_leg_ref,
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

    counts_before_preview = {
        "compositions": _table_count(client, "compositions"),
        "composition_legs": _table_count(client, "composition_legs"),
        "composition_source_freezes": _table_count(client, "composition_source_freezes"),
    }
    preview = assert_ok(client.post("/compositions/preview", json=preview_payload))
    counts_after_preview = {
        "compositions": _table_count(client, "compositions"),
        "composition_legs": _table_count(client, "composition_legs"),
        "composition_source_freezes": _table_count(client, "composition_source_freezes"),
    }

    assert counts_after_preview == counts_before_preview
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
    assert _table_count(client, "composition_source_freezes") == 3

    status_only = assert_ok(
        client.patch(f"/compositions/{composition_id}", json={"status": "ACTIVE"})
    )
    assert status_only["status"] == "ACTIVE"
    assert _table_count(client, "composition_source_freezes") == 3

    client.app.state.service.storage.execute(
        "UPDATE asset_leg_definitions SET name = ?, summary_json = ?, updated_at = ? WHERE id = ?",
        ("Drifted Treasury ETF", json.dumps({"notes": "live row drifted"}), _iso_now(), asset_leg["id"]),
    )
    frozen_detail = assert_ok(client.get(f"/compositions/{composition_id}"))
    frozen_asset = next(
        item
        for item in frozen_detail["source_evidence"]
        if item["freeze_ref_id"] == asset_leg["id"]
    )
    assert frozen_asset["snapshot"]["display_name"] == "US Treasury ETF"

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
                        "source_ref_id": strategy_leg_ref,
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
    assert all(row["id"] != strategy_leg_ref for row in refreshed_inventory["rows"])


def test_bond_snapshot_source_creates_asset_leg_and_fallback_is_rejected(tmp_path):
    client, _ = create_test_client(tmp_path)
    snapshot_ref = _seed_bond_snapshot(client)

    overview = assert_ok(client.get("/data-snapshots/overview"))
    bond = overview["bond_fixed_income"]
    eligible = next(item for item in bond["eligible_instruments"] if item["snapshot_ref"] == snapshot_ref)
    assert eligible["status"] == "READY"
    assert eligible["clean_price"] == 98.25
    assert eligible["field_status"]["duration"] == "INFERRED"

    created = assert_ok(
        client.post(
            "/asset-legs",
            json={
                "name": "10Y Treasury Snapshot Leg",
                "symbol": "T10Y",
                "asset_kind": "BOND",
                "source_snapshot_id": snapshot_ref,
                "source_provider": "bond_fixed_income",
                "freeze_mode": "snapshot_locked",
            },
        )
    )

    assert created["source_snapshot_id"] == snapshot_ref
    assert created["summary"]["bond_snapshot"]["ytm_pct"] == 4.32
    assert created["summary"]["bond_snapshot"]["field_status"]["duration"] == "INFERRED"

    rejected = client.post(
        "/asset-legs",
        json={
            "name": "Fallback Curve Proxy",
            "symbol": "UST10Y",
            "asset_kind": "BOND",
            "source_snapshot_id": "bond_fixed_income.curve_preview",
            "source_provider": "bond_fixed_income",
            "freeze_mode": "snapshot_locked",
        },
    )
    assert rejected.status_code == 400
    assert "fallback source" in rejected.json()["message"]
